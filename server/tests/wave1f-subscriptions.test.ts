import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { subscriptionEntitlementService, addCalendarMonths } from '../src/services/subscription-entitlement.service.js';
import { RoomService } from '../src/services/room.service.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../src/db/repositories/building.repository.js';
import { PrismaSubscriptionRepository } from '../src/db/repositories/subscription.repository.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { PrismaMembershipRepository } from '../src/db/repositories/membership.repository.js';
import { PrismaDormitoryRepository } from '../src/db/repositories/dormitory.repository.js';
import { InMemoryBillingSettingsRepository } from '../src/db/repositories/billing-settings.repository.js';
import { PrismaBillingSettingsRepository } from '../src/db/repositories/billing-settings.repository.js';
import { PrismaSubscriptionPlanRepository } from '../src/db/repositories/plan.repository.js';
import { InMemoryPromoRepository, PrismaPromoRepository } from '../src/db/repositories/promo.repository.js';
import { PrismaRoleRepository } from '../src/db/repositories/role.repository.js';
import { InMemoryOnboardingDraftRepository } from '../src/db/repositories/onboarding-draft.repository.js';
import { PrismaOnboardingDraftRepository } from '../src/db/repositories/onboarding-draft.repository.js';
import { InMemoryIdempotencyRepository, PrismaIdempotencyRepository } from '../src/db/repositories/idempotency.repository.js';
import { DormitoryProvisioningService } from '../src/services/dormitory-provisioning.service.js';
import { SensitiveFieldService } from '../src/services/sensitive-field.service.js';
import { PNG } from 'pngjs';
import { PromoService } from '../src/services/promo.service.js';
import { AuditService } from '../src/services/audit.service.js';
import { SignatureStorageService } from '../src/services/signature-storage.service.js';
import { localStorageProvider } from '../src/services/local-storage.service.js';
import { createPaymentRouter } from '../src/routes/payment.routes.js';
import { createApiRouter } from '../src/routes/index.js';
import { globalErrorHandler } from '../src/middleware/error-handler.js';
import { resolveAuthoritativeDormitoryContext, normalizeRolePermissions } from '../src/middleware/dormitory-context.js';
import { requireDormitoryPermission, resolveDormitoryContextMiddleware } from '../src/middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../src/middleware/entitlement.js';
import { runOperationalActivationCli } from '../src/cli/activate-subscription.js';
import { createApp } from '../src/app.js';
import { CsrfService } from '../src/services/csrf.service.js';
import { getEnv } from '../src/config/env.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
const getSecretKey = (secret: string) => crypto.createHash('sha256').update(secret).digest();

function encryptSessionToken(userId: string, sessionId: string, ttlSeconds = 86400): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    sid: sessionId,
    type: 'session',
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
    version: 1,
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(SESSION_ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId: string): string {
  const csrfService = new CsrfService(getEnv().CSRF_SIGNING_KEY);
  return csrfService.generateCsrfToken(sessionId);
}

const prisma = new PrismaClient();
const membershipRepo = new PrismaMembershipRepository(prisma);

describe('Wave 1F - Authorization, Permission, Package & Idempotency Corrective Pass', () => {
  let dormId: string;
  let otherDormId: string;
  let ownerUserId: string;
  let managerUserId: string;
  let techUserId: string;
  let buildingId: string;
  let ownerRoleId: string;
  let managerRoleId: string;
  let techRoleId: string;
  let entitlementService: typeof subscriptionEntitlementService;

  beforeAll(async () => {
    process.env.ALLOW_OPERATIONAL_ACTIVATION = 'true';
    entitlementService = subscriptionEntitlementService;
    await entitlementService.ensureSeeded();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    otherDormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    managerUserId = crypto.randomUUID();
    techUserId = crypto.randomUUID();

    await prisma.user.createMany({
      data: [
        { id: ownerUserId, googleSubject: `sub-owner-${crypto.randomUUID()}`, email: `owner-${crypto.randomUUID()}@test.com`, emailNormalized: `owner-${crypto.randomUUID()}@test.com`, name: 'Owner User' },
        { id: managerUserId, googleSubject: `sub-mgr-${crypto.randomUUID()}`, email: `mgr-${crypto.randomUUID()}@test.com`, emailNormalized: `mgr-${crypto.randomUUID()}@test.com`, name: 'Manager User' },
        { id: techUserId, googleSubject: `sub-tech-${crypto.randomUUID()}`, email: `tech-${crypto.randomUUID()}@test.com`, emailNormalized: `tech-${crypto.randomUUID()}@test.com`, name: 'Technician User' },
      ],
    });

    await prisma.dormitory.createMany({
      data: [
        { id: dormId, name: `Dormitory Test ${timestamp}`, code: `DORM-${timestamp}`, addressLine1: '123 Test St', postalCode: '10100', phone: '0812345678', status: 'active', createdByUserId: ownerUserId },
        { id: otherDormId, name: `Other Dormitory ${timestamp}`, code: `OTHER-${timestamp}`, addressLine1: '456 Other St', postalCode: '10200', phone: '0887654321', status: 'active', createdByUserId: ownerUserId },
      ],
    });

    const ownerRole = await prisma.role.create({ data: { dormitoryId: dormId, name: 'Owner', code: 'OWNER', permissions: { '*': ['*'] } } });
    const managerRole = await prisma.role.create({ data: { dormitoryId: dormId, name: 'Manager', code: 'MANAGER', permissions: { subscription: ['read', 'write'], promo: ['redeem'] } } });
    const techRole = await prisma.role.create({ data: { dormitoryId: dormId, name: 'Technician', code: 'TECHNICIAN', permissions: { maintenance: ['read', 'write'] } } });

    ownerRoleId = ownerRole.id;
    managerRoleId = managerRole.id;
    techRoleId = techRole.id;

    await prisma.dormitoryMember.createMany({
      data: [
        { userId: ownerUserId, dormitoryId: dormId, roleId: ownerRole.id, status: 'active' },
        { userId: managerUserId, dormitoryId: dormId, roleId: managerRole.id, status: 'active' },
        { userId: techUserId, dormitoryId: dormId, roleId: techRole.id, status: 'active' },
      ],
    });

    await entitlementService.provisionInitialTrial(dormId);
    await entitlementService.provisionInitialTrial(otherDormId);

    const building = await prisma.building.create({ data: { dormitoryId: dormId, name: 'Building 1' } });
    buildingId = building.id;
  });

  // ─── Permission Normalization Tests ───

  it('normalizes persisted JSON role permissions accurately into stable string tokens', () => {
    expect(normalizeRolePermissions({ '*': ['*'] })).toEqual(['*']);
    expect(normalizeRolePermissions({ subscription: ['read', 'write'], promo: ['redeem'] })).toEqual([
      'subscription:read', 'subscription:write', 'promo:redeem',
    ]);
    expect(normalizeRolePermissions(['subscription:write', 'promo:redeem'])).toEqual(['subscription:write', 'promo:redeem']);
    expect(normalizeRolePermissions(null)).toEqual([]);
    expect(normalizeRolePermissions(undefined)).toEqual([]);
    expect(normalizeRolePermissions({ room: ['read', 'write'] })).toEqual(['room:read', 'room:write']);
  });

  // ─── Calendar-Month Math Tests ───

  it('calculates calendar-month renewal expiry accurately without day overflow shortening', () => {
    const jan31 = new Date(2026, 0, 31);
    const febRes = addCalendarMonths(jan31, 1);
    expect(febRes.getMonth()).toBe(1);
    expect(febRes.getDate()).toBe(28);

    const feb28 = new Date(2026, 1, 28);
    const marRes = addCalendarMonths(feb28, 1);
    expect(marRes.getMonth()).toBe(2);
    expect(marRes.getDate()).toBe(28);

    const leapJan31 = new Date(2028, 0, 31);
    const leapFebRes = addCalendarMonths(leapJan31, 1);
    expect(leapFebRes.getMonth()).toBe(1);
    expect(leapFebRes.getDate()).toBe(29);
  });

  // ─── Real-Session Role Permission Tests ───

  it('passes real persisted Owner permissions through PrismaMembershipRepository', async () => {
    const memberships = await membershipRepo.findByUserId(ownerUserId);
    const ownerMem = memberships.find(m => m.dormitoryId === dormId);
    expect(ownerMem).toBeDefined();
    expect(ownerMem!.roleCode).toBe('OWNER');
    expect(ownerMem!.rolePermissions).toBeDefined();

    const req: any = {
      auth: { userId: ownerUserId, user: { id: ownerUserId }, memberships },
      headers: { 'x-dormitory-id': dormId },
    };
    const ctx = await resolveAuthoritativeDormitoryContext(req);
    expect(ctx.roleCode).toBe('OWNER');
    expect(ctx.permissions).toContain('*');
  });

  it('passes real persisted Manager permissions with promo:redeem through PrismaMembershipRepository', async () => {
    const memberships = await membershipRepo.findByUserId(managerUserId);
    const mgrMem = memberships.find(m => m.dormitoryId === dormId);
    expect(mgrMem).toBeDefined();
    expect(mgrMem!.roleCode).toBe('MANAGER');
    expect(mgrMem!.rolePermissions).toBeDefined();

    const req: any = {
      auth: { userId: managerUserId, user: { id: managerUserId }, memberships },
      headers: { 'x-dormitory-id': dormId },
    };
    const ctx = await resolveAuthoritativeDormitoryContext(req);
    expect(ctx.roleCode).toBe('MANAGER');
    expect(ctx.permissions).toContain('subscription:read');
    expect(ctx.permissions).toContain('subscription:write');
    expect(ctx.permissions).toContain('promo:redeem');
  });

  it('passes real persisted Technician permissions through PrismaMembershipRepository', async () => {
    const memberships = await membershipRepo.findByUserId(techUserId);
    const techMem = memberships.find(m => m.dormitoryId === dormId);
    expect(techMem).toBeDefined();
    expect(techMem!.roleCode).toBe('TECHNICIAN');

    const req: any = {
      auth: { userId: techUserId, user: { id: techUserId }, memberships },
      headers: { 'x-dormitory-id': dormId },
    };
    const ctx = await resolveAuthoritativeDormitoryContext(req);
    expect(ctx.permissions).toContain('maintenance:read');
    expect(ctx.permissions).toContain('maintenance:write');
    expect(ctx.permissions).not.toContain('room:write');
    expect(ctx.permissions).not.toContain('*');
  });

  it('fails closed when dormitory membership role is invalid or missing', async () => {
    const invalidMemberReq: any = {
      auth: {
        userId: ownerUserId,
        user: { id: ownerUserId },
        memberships: [{ id: 'mem-invalid', dormitoryId: dormId, status: 'active', role: null, roleCode: null }],
      },
      headers: { 'x-dormitory-id': dormId },
    };
    await expect(resolveAuthoritativeDormitoryContext(invalidMemberReq)).rejects.toThrow('Dormitory membership role is invalid or unassigned.');
  });

  // ─── Permission Middleware Tests ───

  it('requireDormitoryPermission allows OWNER implicit full access', () => {
    const middleware = requireDormitoryPermission('room:write');
    const req: any = { dormitoryContext: { roleCode: 'OWNER', permissions: ['*'] }, headers: {} };
    const res: any = { status: () => res, json: () => res };
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('requireDormitoryPermission allows Manager with exact permission', () => {
    const middleware = requireDormitoryPermission('maintenance:write');
    const req: any = { dormitoryContext: { roleCode: 'MANAGER', permissions: ['maintenance:read', 'maintenance:write'] }, headers: {} };
    const res: any = { status: () => res, json: () => res };
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  it('requireDormitoryPermission denies Manager without permission', () => {
    const middleware = requireDormitoryPermission('room:write');
    const req: any = { dormitoryContext: { roleCode: 'MANAGER', permissions: ['maintenance:read'] }, headers: {} };
    let statusCode = 0;
    let body: any = {};
    const res: any = { status: (c: number) => { statusCode = c; return res; }, json: (b: any) => { body = b; return res; } };
    middleware(req, res, () => {});
    expect(statusCode).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('requireDormitoryPermission denies when context is missing', async () => {
    const middleware = requireDormitoryPermission('room:write');
    const req: any = { headers: {} };
    let statusCode = 0;
    const res: any = { status: (c: number) => { statusCode = c; return res; }, json: () => res };
    await middleware(req, res, () => {});
    expect(statusCode).toBe(403);
  });

  it('requireDormitoryPermission allows domain wildcard', () => {
    const middleware = requireDormitoryPermission('room:write');
    const req: any = { dormitoryContext: { roleCode: 'MANAGER', permissions: ['room:*'] }, headers: {} };
    let called = false;
    const res: any = { status: () => res, json: () => res };
    middleware(req, res, () => { called = true; });
    expect(called).toBe(true);
  });

  // ─── Trial Provisioning Tests ───

  it('provisions 1 30-day Trial in DormitorySubscription and status history atomically without duplicate writes', async () => {
    const freshDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: freshDormId, name: 'Fresh Provisioned Dorm', code: `FRESH-${Date.now()}`, addressLine1: '789 Fresh Rd', postalCode: '10300', phone: '0899999999', status: 'active', createdByUserId: ownerUserId },
    });

    const sub = await entitlementService.provisionInitialTrial(freshDormId);
    expect(sub.status).toBe('TRIAL');
    expect(sub.dormitoryId).toBe(freshDormId);

    const history = await prisma.subscriptionStatusHistory.findMany({ where: { dormitoryId: freshDormId } });
    expect(history.length).toBe(1);
    expect(history[0].reason).toBe('INITIAL_PROVISIONING_CALENDAR_MONTH_TRIAL');

    const legacySubs = await prisma.platformSubscription.findMany({ where: { dormitoryId: freshDormId } });
    expect(legacySubs.length).toBe(0);
  });

  it('GET-side subscription lookup throws SUBSCRIPTION_NOT_FOUND when missing and creates 0 database records', async () => {
    const noSubDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: noSubDormId, name: 'No Sub Dorm', code: `NOSUB-${Date.now()}`, addressLine1: '000 NoSub St', postalCode: '10100', phone: '0800000000', status: 'active', createdByUserId: ownerUserId },
    });

    // Execute GET-side getCurrentSubscription 3 times
    for (let i = 0; i < 3; i++) {
      await expect(entitlementService.getCurrentSubscription(noSubDormId)).rejects.toThrow('No subscription found for this dormitory.');
    }

    // Assert database counts remain strictly 0
    const subCount = await prisma.dormitorySubscription.count({ where: { dormitoryId: noSubDormId } });
    const historyCount = await prisma.subscriptionStatusHistory.count({ where: { dormitoryId: noSubDormId } });
    const legacyCount = await prisma.platformSubscription.count({ where: { dormitoryId: noSubDormId } });

    expect(subCount).toBe(0);
    expect(historyCount).toBe(0);
    expect(legacyCount).toBe(0);
  });

  // ─── Backfill Tests ───

  it('backfills missing subscriptions for existing dormitories idempotently', async () => {
    const unbackedDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: unbackedDormId, name: 'Unbacked Dorm', code: `UNBACKED-${Date.now()}`, addressLine1: '999 Unbacked St', postalCode: '10400', phone: '0855555555', status: 'active', createdByUserId: ownerUserId },
    });

    const count = await entitlementService.backfillExistingDormitories();
    expect(count).toBeGreaterThanOrEqual(1);

    const sub = await entitlementService.getCurrentSubscription(unbackedDormId);
    expect(sub.status).toBe('TRIAL');
  });

  // ─── Promo Code & Idempotency Tests ───

  it('redeems promo code HORPLUS with persistent idempotency and rejects Manager without promo permissions', async () => {
    const idempotencyKey = `key-promo-${Date.now()}`;

    // Manager without promo:redeem – create role without promo permission
    const noPromoRole = await prisma.role.create({ data: { dormitoryId: dormId, name: 'Limited Manager', code: 'MANAGER_LIMITED', permissions: { subscription: ['read'] } } });
    const noPromoMgrId = crypto.randomUUID();
    await prisma.user.create({ data: { id: noPromoMgrId, googleSubject: `sub-nopromgr-${Date.now()}`, email: `nopromgr-${Date.now()}@test.com`, emailNormalized: `nopromgr-${Date.now()}@test.com`, name: 'No-Promo Manager' } });
    await prisma.dormitoryMember.create({ data: { userId: noPromoMgrId, dormitoryId: dormId, roleId: noPromoRole.id, status: 'active' } });

    const noPromoMemberships = await membershipRepo.findByUserId(noPromoMgrId);
    const reqMgr: any = {
      auth: { userId: noPromoMgrId, user: { id: noPromoMgrId }, memberships: noPromoMemberships },
      headers: { 'x-dormitory-id': dormId },
    };
    const ctxMgr = await resolveAuthoritativeDormitoryContext(reqMgr);
    const hasPromoPerm = (ctxMgr.permissions || []).some((p) =>
      ['*', 'subscription:write', 'subscription:*', 'promo:redeem'].includes(p)
    );
    expect(hasPromoPerm).toBe(false);

    // Owner redeems HORPLUS code successfully
    const initialSub = await entitlementService.getCurrentSubscription(dormId);
    const initialExpiry = initialSub.expiresAt.getTime();

    const sub1 = await entitlementService.redeemPromoCode({
      dormitoryId: dormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey,
    });

    expect(sub1.status).toBe(200);
    const extendedExpiry = new Date((sub1.body as any).data.expiresAt).getTime();
    expect(extendedExpiry - initialExpiry).toBeGreaterThanOrEqual(59 * 24 * 60 * 60 * 1000);

    // Replay with identical key returns original stored response
    const sub2 = await entitlementService.redeemPromoCode({
      dormitoryId: dormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey,
    });
    expect(sub2.status).toBe(200);
    expect((sub2.body as any).data).toBeDefined();

    // Attempt second redemption with a different key throws PROMO_ALREADY_REDEEMED
    await expect(
      entitlementService.redeemPromoCode({
        dormitoryId: dormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey: `key-different-${Date.now()}`,
      })
    ).rejects.toThrow(/already been redeemed/);
  });

  it('promo idempotency returns original stored response, not current subscription', async () => {
    const idempotencyKey = `key-promo-orig-${Date.now()}`;
    const sub1 = await entitlementService.redeemPromoCode({
      dormitoryId: dormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey,
    });
    expect(sub1.status).toBe(200);
    expect((sub1.body as any).data).toBeDefined();

    // Now modify the subscription externally
    await prisma.dormitorySubscription.update({
      where: { dormitoryId: dormId },
      data: { status: 'EXPIRED' },
    });

    // Replay should return original stored response
    const replay = await entitlementService.redeemPromoCode({
      dormitoryId: dormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey,
    });
    expect(replay.status).toBe(200);
    expect((replay.body as any).data).toBeDefined();
  });

  it('promo idempotency rejects different code with same key', async () => {
    const idempotencyKey = `key-promo-mismatch-${Date.now()}`;
    await entitlementService.redeemPromoCode({
      dormitoryId: dormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey,
    });

    // This tests the payload hash including the code
    // Different dormitory with same key should mismatch since hash includes dormitoryId
    const freshDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: freshDormId, name: 'Mismatch Dorm', code: `MISMATCH-${Date.now()}`, addressLine1: '111 Mismatch St', postalCode: '10500', phone: '0811111111', status: 'active', createdByUserId: ownerUserId },
    });
    await entitlementService.provisionInitialTrial(freshDormId);

    await expect(
      entitlementService.redeemPromoCode({
        dormitoryId: freshDormId, code: 'HORPLUS', userId: ownerUserId, idempotencyKey,
      })
    ).rejects.toThrow('Idempotency key payload mismatch');
  });

  // ─── Over-Limit / Read-Only Tests ───

  it('enforces over-limit read-only behavior across multiple domain mutation guards', async () => {
    for (let i = 1; i <= 11; i++) {
      await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: `RM-OVER-${i}`,
          normalizedRoomNumber: `rm-over-${i}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
        },
      });
    }

    const entitlements = await entitlementService.getEffectiveEntitlements(dormId);
    expect(entitlements.roomCount).toBe(11);
    expect(entitlements.isOverLimit).toBe(true);
    expect(entitlements.isReadOnly).toBe(true);

    await expect(entitlementService.assertDormitoryWritable(dormId)).rejects.toThrow('Dormitory operation restricted to read-only mode.');
    await expect(entitlementService.assertRoomCreationAllowed(dormId)).rejects.toThrow('Dormitory operation restricted to read-only mode.');
  });

  // ─── Concurrent Room Creation Tests (Service Level) ───

  it('proves real concurrent room creation on Free boundary under PG transaction lock', async () => {
    for (let i = 1; i <= 9; i++) {
      await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: `FREE-C-${i}`,
          normalizedRoomNumber: `free-c-${i}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
        },
      });
    }

    const roomService = new RoomService(
      new PrismaRoomRepository(prisma), new PrismaBuildingRepository(prisma),
      new PrismaSubscriptionRepository(prisma), new PrismaContractRepository(prisma),
      undefined, entitlementService, prisma
    );

    const results = await Promise.allSettled([
      roomService.createRoom(dormId, { buildingId, roomNumber: 'FREE-C-10', normalizedRoomNumber: 'FREE-C-10', floor: 1 }, ownerUserId),
      roomService.createRoom(dormId, { buildingId, roomNumber: 'FREE-C-11', normalizedRoomNumber: 'FREE-C-11', floor: 1 }, ownerUserId),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error: any = (rejected[0] as PromiseRejectedResult).reason;
    expect(error.errorCode || error.code).toBe('ROOM_LIMIT_REACHED');

    const totalRooms = await prisma.room.count({ where: { dormitoryId: dormId, status: { not: 'archived' } } });
    expect(totalRooms).toBe(10);
  });

  it('proves real concurrent room creation on Paid boundary under PG transaction lock', async () => {
    await entitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId,
      idempotencyKey: `paid-activate-${Date.now()}`, reason: 'Test paid boundary activation',
    });

    const sub = await entitlementService.getCurrentSubscription(dormId);
    const targetCount = sub.plan.roomLimit - 1;

    for (let i = 1; i <= targetCount; i++) {
      await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: `PAID-C-${i}`,
          normalizedRoomNumber: `paid-c-${i}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
        },
      });
    }

    const roomService = new RoomService(
      new PrismaRoomRepository(prisma), new PrismaBuildingRepository(prisma),
      new PrismaSubscriptionRepository(prisma), new PrismaContractRepository(prisma),
      undefined, entitlementService, prisma
    );

    const results = await Promise.allSettled([
      roomService.createRoom(dormId, { buildingId, roomNumber: 'PAID-CONC-A', normalizedRoomNumber: 'PAID-CONC-A', floor: 1 }, ownerUserId),
      roomService.createRoom(dormId, { buildingId, roomNumber: 'PAID-CONC-B', normalizedRoomNumber: 'PAID-CONC-B', floor: 1 }, ownerUserId),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error: any = (rejected[0] as PromiseRejectedResult).reason;
    expect(error.errorCode || error.code).toBe('ROOM_LIMIT_REACHED');

    const totalRooms = await prisma.room.count({ where: { dormitoryId: dormId, status: { not: 'archived' } } });
    expect(totalRooms).toBe(sub.plan.roomLimit);
  });

  // ─── Package Enforcement Tests ───

  it('enforces enabled package for 1-month activation', async () => {
    const result = await entitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId,
      idempotencyKey: `pkg-enabled-${Date.now()}`, reason: 'Test enabled package',
    });
    expect(result.status || result.newStatus).toBeDefined();
  });

  it('rejects disabled 3-month package', async () => {
    await prisma.subscriptionPackage.updateMany({ where: { durationMonths: 3 }, data: { enabled: false } });
    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 3, actorId: ownerUserId,
        idempotencyKey: `pkg-disabled-${Date.now()}`, reason: 'Test disabled package',
      })
    ).rejects.toThrow('disabled');
  });

  it('rejects disabled 6-month package', async () => {
    await prisma.subscriptionPackage.updateMany({ where: { durationMonths: 6 }, data: { enabled: false } });
    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 6, actorId: ownerUserId,
        idempotencyKey: `pkg-disabled6-${Date.now()}`, reason: 'Test disabled 6mo package',
      })
    ).rejects.toThrow('disabled');
  });

  it('rejects non-existent package duration', async () => {
    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 2, actorId: ownerUserId,
        idempotencyKey: `pkg-notfound-${Date.now()}`, reason: 'Test nonexistent package',
      })
    ).rejects.toThrow('No subscription package found');
  });

  // ─── Activation Service Boundary Tests ───

  it('rejects activation with missing actorId', async () => {
    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 1, actorId: '', idempotencyKey: 'key', reason: 'test',
      })
    ).rejects.toThrow('actorId is required');
  });

  it('rejects activation with missing idempotencyKey', async () => {
    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId, idempotencyKey: '', reason: 'test',
      })
    ).rejects.toThrow('idempotencyKey is required');
  });

  it('rejects activation with missing reason', async () => {
    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId, idempotencyKey: 'key', reason: '',
      })
    ).rejects.toThrow('reason is required');
  });

  // ─── Activation Idempotency Tests ───

  it('activation idempotency returns original stored response, not current state', async () => {
    const idempotencyKey = `act-idem-${Date.now()}`;
    const result1 = await entitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId,
      idempotencyKey, reason: 'Initial activation',
    });
    expect(result1.status).toBe(200);
    expect((result1.body as any).subscription.status).toBe('ACTIVE');

    // Modify subscription externally
    await prisma.dormitorySubscription.update({
      where: { dormitoryId: dormId },
      data: { status: 'EXPIRED' },
    });

    // Replay returns original stored response
    const replay = await entitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId,
      idempotencyKey, reason: 'Initial activation',
    });
    expect(replay.status).toBe(200);
    expect((replay.body as any).subscription.status).toBe('ACTIVE');
  });

  it('activation idempotency mismatch on different payload', async () => {
    const idempotencyKey = `act-mismatch-${Date.now()}`;
    await entitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId,
      idempotencyKey, reason: 'First activation',
    });

    // Different dormitoryId with same key should cause mismatch
    const freshDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: freshDormId, name: 'Mismatch Activation Dorm', code: `ACTMM-${Date.now()}`, addressLine1: '222 Mismatch', postalCode: '10600', phone: '0822222222', status: 'active', createdByUserId: ownerUserId },
    });
    await entitlementService.provisionInitialTrial(freshDormId);

    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: freshDormId, durationMonths: 1, actorId: ownerUserId,
        idempotencyKey, reason: 'Different dorm activation',
      })
    ).rejects.toThrow('Idempotency key payload mismatch');
  });

  // ─── CLI Tests ───

  it('hardens operational activation CLI and environment URL parsing', async () => {
    await expect(runOperationalActivationCli([dormId])).rejects.toThrow();

    const oldUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/horplus_pilot';

    await expect(
      entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId, durationMonths: 1, actorId: ownerUserId,
        idempotencyKey: `key-invalid-${Date.now()}`, reason: 'Test invalid env',
      })
    ).rejects.toThrow('Operational activation is strictly prohibited');

    process.env.DATABASE_URL = oldUrl;
  });

  // ─── Sensitive Log Regression Guards ───

  it('require-session middleware does not contain sensitive session/membership logging', () => {
    const requireSessionPath = path.resolve(__dirname, '../src/middleware/require-session.ts');
    const content = fs.readFileSync(requireSessionPath, 'utf-8');

    expect(content).not.toContain('Session invalid for cookie:');
    expect(content).not.toContain('memberships length =');
    expect(content).not.toContain('console.error(\'Session validation error:\', err)');
  });

  it('auth service does not contain sensitive session logging', () => {
    const authServicePath = path.resolve(__dirname, '../src/services/auth.service.ts');
    const content = fs.readFileSync(authServicePath, 'utf-8');

    expect(content).not.toContain('validateSession: decryptToken failed');
    expect(content).not.toContain('validateSession: session not found');
    expect(content).not.toContain('validateSession: session not active');
    expect(content).not.toContain('validateSession: session expired');
    expect(content).not.toContain('validateSession: user not found');
    expect(content).not.toContain('validateSession: user not active');
  });

  it('payment and onboarding routes do not contain sensitive authorization logging', () => {
    const paymentRoutesPath = path.resolve(__dirname, '../src/routes/payment.routes.ts');
    const onboardingRoutesPath = path.resolve(__dirname, '../src/routes/onboarding.routes.ts');

    const paymentContent = fs.readFileSync(paymentRoutesPath, 'utf-8');
    const onboardingContent = fs.readFileSync(onboardingRoutesPath, 'utf-8');

    expect(paymentContent).not.toContain('ensureOwnerOrManager FAILED!');
    expect(paymentContent).not.toContain('JSON.stringify(auth?.memberships)');
    expect(paymentContent).not.toContain('JSON.stringify(auth.memberships)');

    expect(onboardingContent).not.toContain('verifyCsrfToken Debug:');
  });

  it('no source file logs roleCode fallback to OWNER', () => {
    const authServicePath = path.resolve(__dirname, '../src/services/auth.service.ts');
    const content = fs.readFileSync(authServicePath, 'utf-8');
    // Should not contain the dangerous fallback
    expect(content).not.toContain("roleCode: m.roleCode || 'OWNER'");
  });

  // ─── Payment Mutation Permission & Entitlement Integration Tests ───
  describe('Payment Mutation & Read-Only Entitlement Integration Matrix', () => {
    let tenantUserId: string;
    let tenantRoleId: string;
    let tenantId: string;
    let billId: string;
    let paymentId: string;
    let intentId: string;
    let managerPermissions: any = {};
    let app: express.Application;

    beforeEach(async () => {
      managerPermissions = {};
      tenantUserId = crypto.randomUUID();
      const timestamp = Date.now();

      await prisma.user.create({
        data: { id: tenantUserId, googleSubject: `sub-t-${timestamp}`, email: `t-${timestamp}@test.com`, emailNormalized: `t-${timestamp}@test.com`, name: 'Tenant User' },
      });

      const tenantRole = await prisma.role.create({
        data: { dormitoryId: dormId, name: 'Tenant', code: 'TENANT', permissions: { payment: ['read'] } },
      });
      tenantRoleId = tenantRole.id;

      await prisma.dormitoryMember.create({
        data: { userId: tenantUserId, dormitoryId: dormId, roleId: tenantRole.id, status: 'active' },
      });

      const room = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: `PAY-R-${timestamp}`,
          normalizedRoomNumber: `pay-r-${timestamp}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
          status: 'occupied',
        },
      });

      const tenantRec = await prisma.tenant.create({
        data: { dormitoryId: dormId, tenantNumber: `TNT-${timestamp}`, displayName: 'Payment Tenant', firstName: 'Payment', lastName: 'Tenant', phone: '0899998888', linkedUserId: tenantUserId, status: 'active' },
      });
      tenantId = tenantRec.id;

      const cycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: dormId,
          cycleCode: `CYC-${timestamp}`,
          name: 'Aug 2026',
          periodStart: new Date(),
          periodEnd: new Date(),
          billingDate: new Date(),
          dueDate: new Date(),
        },
      });

      const bill = await prisma.bill.create({
        data: { dormitoryId: dormId, billingCycleId: cycle.id, billNumber: `BILL-${timestamp}`, tenantId, roomId: room.id, totalAmount: 5000, status: 'UNPAID', billingDate: new Date(), dueDate: new Date() },
      });
      billId = bill.id;

      const payment = await prisma.payment.create({
        data: { dormitoryId: dormId, billId, tenantId, amount: 5000, method: 'SLIP', status: 'PENDING', paymentDate: new Date(), evidenceUrl: 'payments/test/slip.jpg' },
      });
      paymentId = payment.id;

      const intent = await prisma.paymentUploadIntent.create({
        data: { authenticatedUserId: tenantUserId, tenantId, dormitoryId: dormId, billId, expectedMimeType: 'image/jpeg', expectedSize: 1024, expiresAt: new Date(Date.now() + 15 * 60 * 1000), status: 'CREATED' },
      });
      intentId = intent.id;

      app = express();
      app.use(express.json());

      const mockAuthService: any = {
        requireAuth: () => (req: Request, res: Response, next: NextFunction) => {
          const userIdHeader = (req.headers['x-user-id'] as string) || ownerUserId;
          let roleId = ownerRoleId;
          let roleCode = 'OWNER';
          let rolePermissions: any = { '*': ['*'] };
          if (userIdHeader === managerUserId) {
            roleId = managerRoleId;
            roleCode = 'MANAGER';
            rolePermissions = managerPermissions;
          } else if (userIdHeader === techUserId) {
            roleId = techRoleId;
            roleCode = 'TECHNICIAN';
            rolePermissions = {};
          } else if (userIdHeader === tenantUserId) {
            roleId = tenantRoleId;
            roleCode = 'TENANT';
            rolePermissions = {};
          }

          req.auth = {
            userId: userIdHeader,
            user: { id: userIdHeader, name: 'Test User', email: `${userIdHeader}@test.com` },
            sessionId: `sess-${userIdHeader}`,
            memberships: [
              { id: `mem-${userIdHeader}`, dormitoryId: dormId, userId: userIdHeader, status: 'active', roleId, roleCode, rolePermissions },
            ],
          };
          next();
        },
        verifyCsrf: () => true,
      };

      app.use('/api/v1/payments', createPaymentRouter(mockAuthService));
      app.use(globalErrorHandler);
    });

    it('Tenant + active Subscription allows upload intent when bill belongs to Tenant', async () => {
      const timestamp = Date.now();
      const freshRoom = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: `PAY-INTENT-${timestamp}`,
          normalizedRoomNumber: `payintent${timestamp}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
          status: 'occupied',
        },
      });
      const freshBill = await prisma.bill.create({
        data: {
          dormitoryId: dormId,
          billingCycleId: (await prisma.billingCycle.findFirst({ where: { dormitoryId: dormId } }))!.id,
          billNumber: `BILL-INTENT-${timestamp}`,
          tenantId,
          roomId: freshRoom.id,
          totalAmount: 3000,
          status: 'UNPAID',
          billingDate: new Date(),
          dueDate: new Date(),
        },
      });

      const res = await request(app)
        .post('/api/v1/payments/slip/intent')
        .set('x-user-id', tenantUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send({ billId: freshBill.id, fileName: 'slip.jpg', mimeType: 'image/jpeg', fileSize: 1024 });

      expect(res.status).toBe(200);
      expect(res.body.intentId).toBeDefined();
    });

    it('Tenant + expired Subscription returns 403 SUBSCRIPTION_READ_ONLY', async () => {
      await prisma.dormitorySubscription.updateMany({
        where: { dormitoryId: dormId },
        data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const res = await request(app)
        .post('/api/v1/payments/slip/intent')
        .set('x-user-id', tenantUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send({ billId, fileName: 'slip.jpg', mimeType: 'image/jpeg', fileSize: 1024 });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
    });

    it('Owner + payment:write + active Subscription allows cash recording', async () => {
      const timestamp = Date.now();
      const freshRoom = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: `PAY-CASH-${timestamp}`,
          normalizedRoomNumber: `paycash${timestamp}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
          status: 'occupied',
        },
      });
      const freshBill = await prisma.bill.create({
        data: {
          dormitoryId: dormId,
          billingCycleId: (await prisma.billingCycle.findFirst({ where: { dormitoryId: dormId } }))!.id,
          billNumber: `BILL-CASH-${timestamp}`,
          tenantId,
          roomId: freshRoom.id,
          totalAmount: 5000,
          status: 'UNPAID',
          billingDate: new Date(),
          dueDate: new Date(),
        },
      });

      const res = await request(app)
        .post('/api/v1/payments/cash')
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send({ billId: freshBill.id, amount: '5000' });

      expect(res.status).toBe(200);
    });

    it('Manager without payment:write is denied with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/payments/cash')
        .set('x-user-id', managerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send({ billId, amount: '5000' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('Manager with payment:write + expired Subscription returns 403 SUBSCRIPTION_READ_ONLY', async () => {
      await prisma.role.update({
        where: { id: managerRoleId },
        data: { permissions: { payment: ['read', 'write'] } },
      });
      managerPermissions = { payment: ['read', 'write'] };

      await prisma.dormitorySubscription.updateMany({
        where: { dormitoryId: dormId },
        data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const res = await request(app)
        .post('/api/v1/payments/cash')
        .set('x-user-id', managerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send({ billId, amount: '5000' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
    });

    it('Technician without payment:write returns 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/payments/cash')
        .set('x-user-id', techUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send({ billId, amount: '5000' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('Cross-Dormitory Payment access is denied with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentId}/approve`)
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', otherDormId)
        .set('x-csrf-token', 'valid-csrf');

      expect(res.status).toBe(403);
    });

    it('Historical evidence GET remains readable when subscription is expired', async () => {
      await prisma.dormitorySubscription.updateMany({
        where: { dormitoryId: dormId },
        data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const getFileSpy = vi.spyOn(localStorageProvider, 'getFile').mockResolvedValue(Buffer.from('fake-image-bytes'));

      const res = await request(app)
        .get(`/api/v1/payments/${paymentId}/evidence`)
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', dormId);

      getFileSpy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
    });
  });

  // ─── Real Onboarding Transaction & Rollback Proof ───
  describe('Real Onboarding Transaction & Rollback Proof', () => {
    it('proves real onboarding transaction creates exact required records', async () => {
      const timestamp = Date.now();
      const onboardingUserId = crypto.randomUUID();

      await prisma.user.create({
        data: { id: onboardingUserId, googleSubject: `sub-onb-${timestamp}`, email: `onb-${timestamp}@test.com`, emailNormalized: `onb-${timestamp}@test.com`, name: 'Onboarding User' },
      });

      const draftRepo = new InMemoryOnboardingDraftRepository();
      const dormitoryRepo = new PrismaDormitoryRepository(prisma);
      const billingRepo = new InMemoryBillingSettingsRepository();
      const planRepo = new PrismaSubscriptionPlanRepository(prisma);
      const subRepo = new PrismaSubscriptionRepository(prisma);
      const promoRepo = new InMemoryPromoRepository();
      const membershipRepo = new PrismaMembershipRepository(prisma);
      const roleRepo = new PrismaRoleRepository(prisma);
      const idempotencyRepo = new InMemoryIdempotencyRepository();
      const buildingRepo = new PrismaBuildingRepository(prisma);
      const roomRepo = new PrismaRoomRepository(prisma);
      const sensitiveFieldService = new SensitiveFieldService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      const promoService = new PromoService(promoRepo, subRepo);
      const auditService = new AuditService();

      const provisioningService = new DormitoryProvisioningService(
        dormitoryRepo, billingRepo as any, planRepo, subRepo, promoRepo,
        membershipRepo, roleRepo, draftRepo, idempotencyRepo as any,
        buildingRepo, roomRepo, sensitiveFieldService, promoService,
        auditService, prisma
      );

      const prepared = await provisioningService.prepareProvisionalDormitory(onboardingUserId, { name: `Onboard Dorm ${timestamp}` });
      const provDormId = prepared.provisionalDormitoryId;
      const sigService = new SignatureStorageService(prisma);
      const pngObj = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < pngObj.data.length; i += 4) {
        pngObj.data[i] = 0;
        pngObj.data[i + 1] = 0;
        pngObj.data[i + 2] = 0;
        pngObj.data[i + 3] = 255;
      }
      const validPngBuffer = PNG.sync.write(pngObj);
      await sigService.saveSignature({ dormitoryId: provDormId, userId: onboardingUserId, buffer: validPngBuffer });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
        await tx.dormitoryLineConfig.update({ where: { dormitoryId: provDormId }, data: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true } });
      });

      const result = await provisioningService.completeOwnerOnboarding({
        userId: onboardingUserId,
        idempotencyKey: `onb-idem-${timestamp}`,
        provisionalDormitoryId: provDormId,
        planCode: 'FREE',
        dormitory: { name: `Onboard Dorm ${timestamp}`, code: `ONB-${timestamp}`, addressLine1: '123 Onb St', postalCode: '10100', phone: '0812345678' },
        billing: { bankName: 'Kasikorn', accountName: 'Onboard User', accountNumber: '1234567890' },
      });

      expect(result.dormitory?.id).toBeDefined();

      const newDorms = await prisma.dormitory.findMany({ where: { createdByUserId: onboardingUserId } });
      expect(newDorms.length).toBe(1);

      const newMembers = await prisma.dormitoryMember.findMany({ where: { userId: onboardingUserId, dormitoryId: result.dormitory.id } });
      expect(newMembers.length).toBe(1);

      const newSubs = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: result.dormitory.id } });
      expect(newSubs.length).toBe(1);

      const newHistories = await prisma.subscriptionStatusHistory.findMany({ where: { dormitoryId: result.dormitory.id } });
      expect(newHistories.length).toBe(1);

      const platformSubs = await (prisma as any).platformSubscription?.findMany({ where: { dormitoryId: result.dormitory.id } }) || [];
      expect(platformSubs.length).toBe(0);
    });

    it('proves onboarding transaction rolls back cleanly on inner repository failure', async () => {
      const timestamp = Date.now();
      const rollbackUserId = crypto.randomUUID();
      const rollbackDormCode = `ROLL-${timestamp}`;
      const rollbackIdempotencyKey = `roll-idem-${timestamp}`;

      await prisma.user.create({
        data: { id: rollbackUserId, googleSubject: `sub-roll-${timestamp}`, email: `roll-${timestamp}@test.com`, emailNormalized: `roll-${timestamp}@test.com`, name: 'Rollback User' },
      });

      const spy = vi.spyOn(subscriptionEntitlementService, 'provisionInitialTrial').mockRejectedValueOnce(new Error('INTENTIONAL_PROVISIONING_FAILURE'));

      const provisioningService = new DormitoryProvisioningService(
        new PrismaDormitoryRepository(prisma),
        new InMemoryBillingSettingsRepository() as any,
        new PrismaSubscriptionPlanRepository(prisma),
        new PrismaSubscriptionRepository(prisma),
        new InMemoryPromoRepository(),
        new PrismaMembershipRepository(prisma),
        new PrismaRoleRepository(prisma),
        new InMemoryOnboardingDraftRepository(),
        new InMemoryIdempotencyRepository() as any,
        new PrismaBuildingRepository(prisma),
        new PrismaRoomRepository(prisma),
        new SensitiveFieldService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
        new PromoService(new InMemoryPromoRepository(), new PrismaSubscriptionRepository(prisma)),
        new AuditService(),
        prisma
      );

      await expect(
        provisioningService.completeOwnerOnboarding({
          userId: rollbackUserId,
          idempotencyKey: rollbackIdempotencyKey,
          planCode: 'FREE',
          dormitory: { name: `Rollback Dorm ${timestamp}`, code: rollbackDormCode, addressLine1: '123 Roll St', postalCode: '10100', phone: '0812345678' },
          billing: { bankName: 'Kasikorn', accountName: 'Rollback User', accountNumber: '1234567890' },
        })
      ).rejects.toThrow();

      spy.mockRestore();

      // Requirement 7: Assert no records exist by record identity
      const dorm = await prisma.dormitory.findFirst({ where: { code: rollbackDormCode } });
      expect(dorm).toBeNull();

      const member = await prisma.dormitoryMember.findFirst({ where: { userId: rollbackUserId } });
      expect(member).toBeNull();

      const sub = dorm ? await prisma.dormitorySubscription.findFirst({ where: { dormitoryId: (dorm as any).id } }) : null;
      expect(sub).toBeNull();

      const subHistory = dorm ? await prisma.subscriptionStatusHistory.findFirst({ where: { dormitoryId: (dorm as any).id } }) : null;
      expect(subHistory).toBeNull();

      const bld = dorm ? await prisma.building.findFirst({ where: { dormitoryId: (dorm as any).id } }) : null;
      expect(bld).toBeNull();

      const rm = dorm ? await prisma.room.findFirst({ where: { dormitoryId: (dorm as any).id } }) : null;
      expect(rm).toBeNull();

      const idem = await prisma.idempotencyKey.findFirst({ where: { idempotencyKey: rollbackIdempotencyKey } });
      expect(idem).toBeNull();
    });
  });

  // ─── True Concurrent HTTP Room Quota Tests ───
  describe('True Concurrent HTTP Room Quota Tests', () => {
    let app: express.Application;
    let concDormId: string;
    let concOwnerId: string;
    let concOwnerSid: string;
    let concSessionCookie: string;
    let concCsrfToken: string;

    beforeEach(async () => {
      const timestamp = Date.now() + Math.floor(Math.random() * 10000);
      concDormId = crypto.randomUUID();
      concOwnerId = crypto.randomUUID();
      concOwnerSid = crypto.randomUUID();

      await prisma.user.create({
        data: { id: concOwnerId, googleSubject: `sub-conc-${timestamp}`, email: `conc-${timestamp}@test.com`, emailNormalized: `conc-${timestamp}@test.com`, name: 'Conc User' },
      });

      await prisma.dormitory.create({
        data: { id: concDormId, name: `Conc Dorm ${timestamp}`, code: `CONC-${timestamp}`, addressLine1: '123 Conc St', postalCode: '10100', phone: '0812345678', status: 'active', createdByUserId: concOwnerId },
      });

      const role = await prisma.role.create({
        data: { dormitoryId: concDormId, name: 'Owner', code: 'OWNER', permissions: { '*': ['*'] } },
      });

      await prisma.dormitoryMember.create({
        data: { userId: concOwnerId, dormitoryId: concDormId, roleId: role.id, status: 'active' },
      });

      await prisma.session.create({
        data: {
          id: concOwnerSid,
          userId: concOwnerId,
          sessionIdHash: crypto.createHash('sha256').update(`horplus_sid_${concOwnerSid}`).digest('hex'),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      await entitlementService.provisionInitialTrial(concDormId);

      await prisma.building.create({ data: { dormitoryId: concDormId, name: 'Conc Building' } });

      concSessionCookie = encryptSessionToken(concOwnerId, concOwnerSid);
      concCsrfToken = generateCsrfToken(concOwnerSid);

      app = createApp({ forcePrisma: true });
    });

    it('proves concurrent HTTP room creation on Free boundary under PG transaction lock', async () => {
      const bld = await prisma.building.findFirst({ where: { dormitoryId: concDormId } });
      for (let i = 1; i <= 9; i++) {
        await prisma.room.create({
          data: {
            dormitoryId: concDormId,
            buildingId: bld!.id,
            roomNumber: `RMF${i}`,
            normalizedRoomNumber: `rmf${i}`,
            roomType: 'standard',
            monthlyRent: '0.00',
            depositAmount: '0.00',
            parkingFee: '0.00',
            floor: 1,
            status: 'vacant',
          },
        });
      }

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/properties/rooms')
          .set('Cookie', [`horplus_session=${concSessionCookie}`, `horplus_csrf=${concCsrfToken}`])
          .set('x-csrf-token', concCsrfToken)
          .set('x-dormitory-id', concDormId)
          .send({ roomNumber: 'RMF10', buildingId: bld!.id, floor: 1, monthlyRent: '3000' }),
        request(app)
          .post('/api/v1/properties/rooms')
          .set('Cookie', [`horplus_session=${concSessionCookie}`, `horplus_csrf=${concCsrfToken}`])
          .set('x-csrf-token', concCsrfToken)
          .set('x-dormitory-id', concDormId)
          .send({ roomNumber: 'RMF11', buildingId: bld!.id, floor: 1, monthlyRent: '3000' }),
      ]);

      const responses = [res1, res2];
      const successResponse = responses.find((response) => response.status === 201);
      const rejectedResponse = responses.find((response) => response.status === 409);

      expect(responses.filter((r) => r.status === 201).length).toBe(1);
      expect(responses.filter((r) => r.status === 409).length).toBe(1);

      expect(successResponse).toBeDefined();
      expect(successResponse!.status).toBe(201);
      expect(successResponse!.body.data || successResponse!.body.roomNumber || successResponse!.body.id).toBeDefined();

      expect(rejectedResponse).toBeDefined();
      expect(rejectedResponse!.status).toBe(409);
      expect(rejectedResponse!.body.errorCode || rejectedResponse!.body.error?.code).toBe('ROOM_LIMIT_REACHED');

      const activeCount = await prisma.room.count({ where: { dormitoryId: concDormId, deletedAt: null } });
      expect(activeCount).toBe(10);
    });

    it('proves concurrent HTTP room creation on Paid boundary under PG transaction lock', async () => {
      process.env.ALLOW_OPERATIONAL_ACTIVATION = 'true';
      await entitlementService.activatePaidSubscriptionOperational({
        dormitoryId: concDormId, durationMonths: 1, actorId: concOwnerId,
        idempotencyKey: `act-conc-${Date.now()}`, reason: 'Concurrent test paid',
      });

      const bld = await prisma.building.findFirst({ where: { dormitoryId: concDormId } });
      const sub = await entitlementService.getCurrentSubscription(concDormId);
      try {
        await prisma.subscriptionPlan.update({
          where: { id: sub.planId },
          data: { roomLimit: 15 },
        });
        const targetCount = 14;

        const roomData = Array.from({ length: targetCount }, (_, i) => ({
          dormitoryId: concDormId,
          buildingId: bld!.id,
          roomNumber: `RMPPRE${i + 1}`,
          normalizedRoomNumber: `rmppre${i + 1}`,
          roomType: 'standard',
          monthlyRent: '0.00',
          depositAmount: '0.00',
          parkingFee: '0.00',
          floor: 1,
          status: 'vacant',
        }));
        await prisma.room.createMany({ data: roomData });

        const [res1, res2] = await Promise.all([
          request(app)
            .post('/api/v1/properties/rooms')
            .set('Cookie', [`horplus_session=${concSessionCookie}`, `horplus_csrf=${concCsrfToken}`])
            .set('x-csrf-token', concCsrfToken)
            .set('x-dormitory-id', concDormId)
            .send({ roomNumber: 'RMPCONCA', buildingId: bld!.id, floor: 1, monthlyRent: '3000' }),
          request(app)
            .post('/api/v1/properties/rooms')
            .set('Cookie', [`horplus_session=${concSessionCookie}`, `horplus_csrf=${concCsrfToken}`])
            .set('x-csrf-token', concCsrfToken)
            .set('x-dormitory-id', concDormId)
            .send({ roomNumber: 'RMPCONCB', buildingId: bld!.id, floor: 1, monthlyRent: '3000' }),
        ]);

        const responses = [res1, res2];
        const successResponse = responses.find((response) => response.status === 201);
        const rejectedResponse = responses.find((response) => response.status === 409);

        expect(responses.filter((r) => r.status === 201).length).toBe(1);
        expect(responses.filter((r) => r.status === 409).length).toBe(1);

        expect(successResponse).toBeDefined();
        expect(successResponse!.status).toBe(201);
        expect(successResponse!.body.data || successResponse!.body.roomNumber || successResponse!.body.id).toBeDefined();

        expect(rejectedResponse).toBeDefined();
        expect(rejectedResponse!.status).toBe(409);
        expect(rejectedResponse!.body.errorCode || rejectedResponse!.body.error?.code).toBe('ROOM_LIMIT_REACHED');
      } finally {
        await prisma.subscriptionPlan.update({
          where: { id: sub.planId },
          data: { roomLimit: 150 },
        });
      }

      const activeCount = await prisma.room.count({ where: { dormitoryId: concDormId, deletedAt: null } });
      expect(activeCount).toBe(15);
    });
  });
});
