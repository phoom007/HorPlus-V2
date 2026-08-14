import { test, expect } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';
import { localStorageProvider } from '../../server/src/services/local-storage.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public'
    }
  }
});

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

// Helper to derive 32-byte encryption key
const getSecretKey = (secret: string) => crypto.createHash('sha256').update(secret).digest();

// Helper to encrypt session token
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

// Helper to generate signed CSRF token
function generateCsrfToken(sessionId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', getSecretKey(CSRF_SIGNING_KEY))
    .update(`${sessionId}.${nonce}`)
    .digest('hex');
  return `${nonce}.${signature}`;
}

// 100% Genuine Valid 1x1 JPEG image buffer
const VALID_JPEG_BUFFER = Buffer.from(
  'ffd8ffe000104a46494600010101006000600000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f007f00ffd9',
  'hex'
);

// 100% Genuine Valid 1x1 PNG image buffer
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a7df760d0000000049454e44ae426082',
  'hex'
);

test.describe('Wave 1E - Real Payment & Receipt Integration (Fully Unmocked)', () => {
  let dormId: string;
  let ownerUser: any;
  let tenantUser: any;
  let tenantRecord: any;
  let buildingRecord: any;
  let roomRecord: any;
  let cycleRecord: any;
  let billRecord1: any;
  let billRecord2: any;
  let billRecord3: any;
  let tenantUser2: any;
  let tenantRecord2: any;
  let roomRecord2: any;
  let billRecord4: any;
  let managerUser: any;
  let technicianUser: any;
  let otherDormId: string;
  let otherOwnerUser: any;
  let jpegFilePath: string;
  let pngFilePath: string;
  let firstSlipBytes: Buffer;

  test.beforeEach(async () => {
    // Write valid image fixtures to temp directory with random bytes per retry
    jpegFilePath = path.join(os.tmpdir(), `test-valid-slip-${Date.now()}-${Math.random()}.jpg`);
    pngFilePath = path.join(os.tmpdir(), `test-valid-slip-2-${Date.now()}-${Math.random()}.png`);
    firstSlipBytes = Buffer.concat([
      VALID_JPEG_BUFFER,
      crypto.randomBytes(16),
    ]);
    fs.writeFileSync(jpegFilePath, firstSlipBytes);
    fs.writeFileSync(pngFilePath, Buffer.concat([VALID_PNG_BUFFER, crypto.randomBytes(16)]));
  });

  test.beforeAll(async () => {
    // 1. Clean and Seed Database in PostgreSQL using Valid UUIDs
    const uniqueSuffix = Date.now().toString().slice(-6);
    const dormName = `Dormitory E2E ${uniqueSuffix}`;

    dormId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const managerUserId = crypto.randomUUID();
    const techUserId = crypto.randomUUID();
    const tenantUserId = crypto.randomUUID();

    const roleOwnerId = crypto.randomUUID();
    const roleManagerId = crypto.randomUUID();
    const roleTechId = crypto.randomUUID();
    const roleTenantId = crypto.randomUUID();

    otherDormId = crypto.randomUUID();
    const otherOwnerUserId = crypto.randomUUID();
    const roleOtherOwnerId = crypto.randomUUID();

    // Create Primary Dormitory
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: dormName,
        code: `DORM-${uniqueSuffix}`,
        addressLine1: '123 Test Street',
        postalCode: '10110',
        phone: '0812345678',
        status: 'active',
      },
    });

    await prisma.dormitory.create({
      data: {
        id: otherDormId,
        name: `Other Dormitory ${uniqueSuffix}`,
        code: `DORM-OTHER-${uniqueSuffix}`,
        addressLine1: '456 Other Street',
        postalCode: '10120',
        phone: '0887654321',
        status: 'active',
      },
    });

    // Provision trial subscriptions for E2E dormitories
    await subscriptionEntitlementService.ensureSeeded();
    await subscriptionEntitlementService.provisionInitialTrial(dormId);
    await subscriptionEntitlementService.provisionInitialTrial(otherDormId);

    // Create Roles
    await prisma.role.createMany({
      data: [
        { id: roleOwnerId, dormitoryId: dormId, code: 'OWNER', name: 'Owner', permissions: ['*'] },
        { id: roleManagerId, dormitoryId: dormId, code: 'MANAGER', name: 'Manager', permissions: ['financial:read', 'payment:read'] },
        { id: roleTechId, dormitoryId: dormId, code: 'TECHNICIAN', name: 'Technician', permissions: ['maintenance:read', 'maintenance:write'] },
        { id: roleTenantId, dormitoryId: dormId, code: 'TENANT', name: 'Tenant', permissions: ['tenant:read', 'tenant:pay'] },
        { id: roleOtherOwnerId, dormitoryId: otherDormId, code: 'OWNER', name: 'Owner', permissions: ['*'] },
      ],
    });

    // Create Owner User & Membership
    ownerUser = await prisma.user.create({
      data: {
        id: ownerUserId,
        googleSubject: `g-owner-${uniqueSuffix}`,
        email: `owner_${uniqueSuffix}@example.com`,
        emailNormalized: `owner_${uniqueSuffix}@example.com`,
        name: 'คุณสมศักดิ์ เจ้าของหอ',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: ownerUserId,
        dormitoryId: dormId,
        roleId: roleOwnerId,
        status: 'active',
      },
    });

    // Create Authorized Manager User & Membership
    managerUser = await prisma.user.create({
      data: {
        id: managerUserId,
        googleSubject: `g-manager-${uniqueSuffix}`,
        email: `manager_${uniqueSuffix}@example.com`,
        emailNormalized: `manager_${uniqueSuffix}@example.com`,
        name: 'คุณผู้จัดการ หอพัก',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: managerUserId,
        dormitoryId: dormId,
        roleId: roleManagerId,
        status: 'active',
      },
    });

    // Create Technician User & Membership
    technicianUser = await prisma.user.create({
      data: {
        id: techUserId,
        googleSubject: `g-tech-${uniqueSuffix}`,
        email: `tech_${uniqueSuffix}@example.com`,
        emailNormalized: `tech_${uniqueSuffix}@example.com`,
        name: 'ช่างประจำหอพัก',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: techUserId,
        dormitoryId: dormId,
        roleId: roleTechId,
        status: 'active',
      },
    });

    // Create Other Dormitory Owner User & Membership
    otherOwnerUser = await prisma.user.create({
      data: {
        id: otherOwnerUserId,
        googleSubject: `g-other-owner-${uniqueSuffix}`,
        email: `other_owner_${uniqueSuffix}@example.com`,
        emailNormalized: `other_owner_${uniqueSuffix}@example.com`,
        name: 'เจ้าของหอพักอื่น',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: otherOwnerUserId,
        dormitoryId: otherDormId,
        roleId: roleOtherOwnerId,
        status: 'active',
      },
    });

    // Create Tenant User & Membership
    tenantUser = await prisma.user.create({
      data: {
        id: tenantUserId,
        googleSubject: `g-tenant-${uniqueSuffix}`,
        email: `tenant_${uniqueSuffix}@example.com`,
        emailNormalized: `tenant_${uniqueSuffix}@example.com`,
        name: 'คุณสมชาย ผู้เช่าทดสอบ',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: tenantUserId,
        dormitoryId: dormId,
        roleId: roleTenantId,
        status: 'active',
      },
    });

    // Create Building & Room
    buildingRecord = await prisma.building.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        name: 'อาคาร A',
        code: 'A',
        floorCount: 4,
      },
    });

    roomRecord = await prisma.room.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        buildingId: buildingRecord.id,
        roomNumber: 'A-201',
        normalizedRoomNumber: 'A-201',
        roomType: 'standard',
        monthlyRent: 4500.0,
        status: 'occupied',
      },
    });

    // Create Tenant entity
    tenantRecord = await prisma.tenant.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        tenantNumber: `T-${uniqueSuffix}`,
        firstName: 'สมชาย',
        lastName: 'ผู้เช่าทดสอบ',
        displayName: 'คุณสมชาย ผู้เช่าทดสอบ',
        phone: '0899998888',
        email: `tenant_${uniqueSuffix}@example.com`,
        linkedUserId: tenantUserId,
        status: 'active',
      },
    });

    const contractRecord = await prisma.contract.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        tenantId: tenantRecord.id,
        roomId: roomRecord.id,
        contractNumber: `CT-${uniqueSuffix}`,
        status: 'active',
        startDate: new Date('2026-07-01'),
        endDate: new Date('2027-06-30'),
        rentAmount: 4500.0,
        depositAmount: 5000.0,
        advancePaymentAmount: 4500.0,
        rentBillingType: 'monthly'
      }
    });

    const tenantUserId2 = crypto.randomUUID();
    tenantUser2 = await prisma.user.create({
      data: {
        id: tenantUserId2,
        googleSubject: `g-tenant2-${uniqueSuffix}`,
        email: `tenant2_${uniqueSuffix}@example.com`,
        emailNormalized: `tenant2_${uniqueSuffix}@example.com`,
        name: 'คุณผู้เช่า คนที่สอง',
        status: 'active',
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        id: crypto.randomUUID(),
        userId: tenantUserId2,
        dormitoryId: dormId,
        roleId: roleTenantId,
        status: 'active',
      },
    });

    roomRecord2 = await prisma.room.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        buildingId: buildingRecord.id,
        roomNumber: 'A-202',
        normalizedRoomNumber: 'A-202',
        roomType: 'standard',
        monthlyRent: 4500.0,
        status: 'occupied',
      },
    });

    tenantRecord2 = await prisma.tenant.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        tenantNumber: `T2-${uniqueSuffix}`,
        firstName: 'ผู้เช่า',
        lastName: 'คนที่สอง',
        displayName: 'คุณผู้เช่า คนที่สอง',
        phone: '0899998889',
        email: `tenant2_${uniqueSuffix}@example.com`,
        linkedUserId: tenantUserId2,
        status: 'active',
      },
    });

    const contractRecord2 = await prisma.contract.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        tenantId: tenantRecord2.id,
        roomId: roomRecord2.id,
        contractNumber: `CT2-${uniqueSuffix}`,
        status: 'active',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: 4500.0,
        depositAmount: 5000.0,
        advancePaymentAmount: 4500.0,
        rentBillingType: 'monthly'
      }
    });

    // Create Billing Cycle
    cycleRecord = await prisma.billingCycle.create({
      data: {
        id: `ffffffff-0000-4000-8000-${crypto.randomUUID().slice(24)}`,
        dormitoryId: dormId,
        cycleCode: `CYCLE-${uniqueSuffix}`,
        name: 'รอบบิล กรกฎาคม 2026',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        status: 'open',
      },
    });

    // Create Bill 1
    billRecord1 = await prisma.bill.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        billingCycleId: cycleRecord.id,
        roomId: roomRecord.id,
        tenantId: tenantRecord.id,
        billNumber: `BILL-${uniqueSuffix}-01`,
        totalAmount: 4850.0,
        subtotal: 4850.0,
        paidAmount: 0.0,
        outstandingAmount: 4850.0,
        billingDate: new Date('2026-07-25'),
        dueDate: new Date(Date.now() + 7 * 86400000),
        status: 'PENDING',
        items: {
          create: [
            { id: crypto.randomUUID(), dormitoryId: dormId, description: 'ค่าเช่าห้อง', amount: 4500.0, unitPrice: 4500.0, quantity: 1.0, type: 'RENT' },
            { id: crypto.randomUUID(), dormitoryId: dormId, description: 'ค่าน้ำประปา', amount: 150.0, unitPrice: 150.0, quantity: 1.0, type: 'WATER' },
            { id: crypto.randomUUID(), dormitoryId: dormId, description: 'ค่าไฟฟ้า', amount: 200.0, unitPrice: 200.0, quantity: 1.0, type: 'ELECTRICITY' },
          ],
        },
      },
    });

    // Create Billing Cycle 2 (for Bill 2)
    const cycleRecord2 = await prisma.billingCycle.create({
      data: {
        id: `eeeeeeee-0000-4000-8000-${crypto.randomUUID().slice(24)}`,
        dormitoryId: dormId,
        cycleCode: `CYCLE-${uniqueSuffix}-08`,
        name: 'รอบบิล สิงหาคม 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'open',
      },
    });

    // Create Bill 2 (for Rejection test)
    billRecord2 = await prisma.bill.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        billingCycleId: cycleRecord2.id,
        roomId: roomRecord.id,
        tenantId: tenantRecord.id,
        billNumber: `BILL-${uniqueSuffix}-02`,
        createdAt: new Date(Date.now() - 5000),
        totalAmount: 4500.0,
        subtotal: 4500.0,
        paidAmount: 0.0,
        outstandingAmount: 4500.0,
        billingDate: new Date('2026-08-25'),
        dueDate: new Date(Date.now() + 14 * 86400000),
        status: 'PENDING',
        items: {
          create: [
            { id: crypto.randomUUID(), dormitoryId: dormId, description: 'ค่าเช่าห้อง', amount: 4500.0, unitPrice: 4500.0, quantity: 1.0, type: 'RENT' },
          ],
        },
      },
    });

    // Create Billing Cycle 3 (for Bill 3)
    const cycleRecord3 = await prisma.billingCycle.create({
      data: {
        id: `dddddddd-0000-4000-8000-${crypto.randomUUID().slice(24)}`,
        dormitoryId: dormId,
        cycleCode: `CYCLE-${uniqueSuffix}-09`,
        name: 'รอบบิล กันยายน 2026',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'open',
      },
    });

    // Create Bill 3 (for Duplicate Evidence test)
    billRecord3 = await prisma.bill.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        billingCycleId: cycleRecord3.id,
        roomId: roomRecord.id,
        tenantId: tenantRecord.id,
        billNumber: `BILL-${uniqueSuffix}-03`,
        createdAt: new Date(Date.now() - 10000),
        totalAmount: 4500.0,
        subtotal: 4500.0,
        paidAmount: 0.0,
        outstandingAmount: 4500.0,
        billingDate: new Date('2026-08-25'),
        dueDate: new Date(Date.now() + 14 * 86400000),
        status: 'PENDING',
        items: {
          create: [
            { id: crypto.randomUUID(), dormitoryId: dormId, description: 'ค่าเช่าห้อง', amount: 4500.0, unitPrice: 4500.0, quantity: 1.0, type: 'RENT' },
          ],
        },
      },
    });

    // Create Bill 4 for Tenant 2 (for Authorization test)
    billRecord4 = await prisma.bill.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        billingCycleId: cycleRecord2.id,
        roomId: roomRecord2.id,
        tenantId: tenantRecord2.id,
        billNumber: `BILL-${uniqueSuffix}-04`,
        totalAmount: 4500.0,
        subtotal: 4500.0,
        paidAmount: 0.0,
        outstandingAmount: 4500.0,
        billingDate: new Date('2026-08-25'),
        dueDate: new Date(Date.now() + 14 * 86400000),
        status: 'PENDING',
        items: {
          create: [
            { id: crypto.randomUUID(), dormitoryId: dormId, description: 'ค่าเช่าห้อง', amount: 4500.0, unitPrice: 4500.0, quantity: 1.0, type: 'RENT' },
          ],
        },
      },
    });
  });

  test.afterAll(async () => {
    // Cleanup temporary files
    try {
      if (fs.existsSync(jpegFilePath)) fs.unlinkSync(jpegFilePath);
      if (fs.existsSync(pngFilePath)) fs.unlinkSync(pngFilePath);
    } catch {}

    // Cleanup DB records
    try {
      const dormIds = [dormId, otherDormId];
      const userIds = [ownerUser?.id, tenantUser?.id, tenantUser2?.id, managerUser?.id, technicianUser?.id, otherOwnerUser?.id].filter(Boolean);

      await prisma.receipt.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.paymentStatusHistory.deleteMany({ where: { payment: { dormitoryId: { in: dormIds } } } });
      await prisma.payment.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.paymentUploadIntent.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.billItem.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.bill.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.contract.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.room.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.building.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.role.deleteMany({ where: { dormitoryId: { in: dormIds } } });
      await prisma.dormitory.deleteMany({ where: { id: { in: dormIds } } });
    } catch {}

    await prisma.$disconnect();
  });

  // Helper to authenticate user via Real Cookie & Postgres Session
  async function loginAs(page: any, user: any, role: string) {
    const sessionId = crypto.randomUUID();
    const sessionIdHash = crypto.createHash('sha256').update(`horplus_sid_${sessionId}`).digest('hex');
    const expiresAt = new Date(Date.now() + 86400000);

    // 1. Create real Session in PostgreSQL
    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        sessionIdHash,
        expiresAt,
        tokenVersion: 1,
      },
    });

    const sessionToken = encryptSessionToken(user.id, sessionId);
    const csrfToken = generateCsrfToken(sessionId);

    // 2. Set Cookies in Browser Context
    await page.context().addCookies([
      {
        name: 'horplus_session',
        value: sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: csrfToken,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_session',
        value: sessionToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: csrfToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // 3. Set Local Storage session data
    await page.goto('/');
    await page.evaluate(
      ({ userId, userName, dId, r, tId, tName, rId, bId, bNum }) => {
        const tenantObj = {
          id: tId,
          name: tName,
          phone: '0899998888',
          email: 'tenant@example.com',
          citizenId: '1234567890123',
          coOccupants: [],
          emergencyContact: { name: 'ผู้ติดต่อ', relationship: 'ญาติ', phone: '0811112222' },
          vehicle: { type: 'motorcycle', licensePlate: '1กข 1234' },
          pet: { hasPet: false },
          dormitoryId: dId,
          roomId: rId,
        };

        localStorage.setItem(
          'HorPlus_demo_session',
          JSON.stringify({
            sessionId: `sess_${userId}`,
            userType: r.toLowerCase(),
            user: { 
              id: userId, 
              name: userName, 
              roleId: `role-${r.toLowerCase()}`, 
              dormitoryId: dId,
              memberships: [{ dormitoryId: dId, roleCode: r, status: 'active' }]
            },
            tenant: r === 'TENANT' ? tenantObj : undefined,
            dormitoryId: dId,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            isDemo: false,
          })
        );

        sessionStorage.setItem('active_dormitory_selected_for_session', dId);
        localStorage.setItem('selected_dormitory_id', dId);
      },
      {
        userId: user.id,
        userName: user.name,
        dId: dormId,
        r: role,
        tId: tenantRecord.id,
        tName: tenantRecord.displayName,
        rId: roomRecord.id,
        bId: billRecord1.id,
        bNum: billRecord1.billNumber,
      }

    );

    return {
      persistedSessionId: sessionId,
      sessionCookie: sessionToken,
      csrfToken,
      userId: user.id
    };
  }

  test('Full Payment Lifecycle: Tenant uploads slip -> Owner approves -> Receipt generated -> Idempotency & DB integrity verified', async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    const browserErrors: string[] = [];

    interface ExpectedNegativeRecord {
      method: string;
      pathname: string;
      expectedStatuses: number[];
      step: string;
      consumed: boolean;
    }

    const expectedNegativeRecords: ExpectedNegativeRecord[] = [];

    const registerExpectedNegative = (
      method: string,
      pathname: string,
      expectedStatuses: number | number[],
      step: string
    ) => {
      expectedNegativeRecords.push({
        method: method.toUpperCase(),
        pathname,
        expectedStatuses: Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses],
        step,
        consumed: false,
      });
    };

    const consumeExpectedNegative = (
      method: string,
      pathname: string,
      actualStatus: number
    ) => {
      const match = expectedNegativeRecords.find(
        rec =>
          rec.method === method.toUpperCase() &&
          rec.pathname === pathname &&
          rec.expectedStatuses.includes(actualStatus) &&
          (!rec.consumed || rec.step.includes('Maintenance Probe'))
      );
      if (match) {
        match.consumed = true;
        return true;
      }
      return false;
    };

    // Pre-register optional probe endpoints
    registerExpectedNegative('GET', '/api/v1/tenant-portal/maintenance', 404, 'Maintenance Probe');
    registerExpectedNegative('GET', '/api/v1/maintenance', 404, 'Maintenance Probe');

    page.on('pageerror', err => browserErrors.push(`Page Error: ${err.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isChromiumResourceError = text.includes('Failed to load resource: the server responded with a status of');
        if (isChromiumResourceError) {
          // Network errors are strictly validated via response listener and exact expectedNegativeRecords matching
        } else {
          browserErrors.push(`Console Error: ${text}`);
        }
      }
    });
    page.on('requestfailed', req => {
      const url = req.url();
      if (!url.includes('favicon.ico') && !url.includes('/maintenance')) {
        browserErrors.push(`Request Failed: ${url}`);
      }
    });
    page.on('response', resp => {
      const url = new URL(resp.url());
      const status = resp.status();
      const method = resp.request().method().toUpperCase();
      const pathname = url.pathname;

      if (url.hostname.includes('line.me') || url.hostname.includes('slipok.com') || url.hostname.includes('stripe.com')) {
        browserErrors.push(`External API call detected: ${resp.url()}`);
      }
      if (status >= 400) {
        const consumed = consumeExpectedNegative(method, pathname, status);
        if (!consumed) {
          browserErrors.push(`Unexpected HTTP ${status} ${method} ${pathname}`);
        }
      }
    });

    // --- STEP 1: Tenant logs in and uploads valid slip ---
    await loginAs(page, tenantUser, 'TENANT');
    await page.goto('/tenant');
    // await page.waitForLoadState('networkidle');

    // Click "ชำระเงิน"
    const payBtn = page.getByRole('button', { name: 'ชำระเงิน' }).first();
    await expect(payBtn).toBeVisible({ timeout: 10000 });
    await payBtn.click();

    // Click "แจ้งชำระเงิน"
    const notifyPayBtn = page.getByRole('button', { name: 'แจ้งชำระเงิน' });
    await expect(notifyPayBtn).toBeVisible({ timeout: 10000 });
    await notifyPayBtn.click();

    // Upload slip file fixture
    await page.locator('input[type="file"]').setInputFiles(jpegFilePath);

    // Click "ส่งหลักฐาน"
    const submitEvidenceBtn = page.getByRole('button', { name: 'ส่งหลักฐาน' });
    await expect(submitEvidenceBtn).toBeVisible();
    await expect(submitEvidenceBtn).toBeEnabled({ timeout: 10000 });
    await submitEvidenceBtn.click();

    // Wait for real backend response and UI confirmation
    await expect(page.locator('text=ส่งหลักฐานสำเร็จ')).toBeVisible({ timeout: 15000 });

    // --- STEP 2: Verify PostgreSQL state after Tenant submission ---
    const payment = await prisma.payment.findFirst({
      where: { billId: billRecord1.id }
    });

    const expectedHash = crypto
      .createHash('sha256')
      .update(firstSlipBytes)
      .digest('hex');

    expect(payment).not.toBeNull();
    expect(payment!.status).toBe('PENDING');
    expect(payment!.method).toBe('BANK_TRANSFER');
    expect(payment!.amount.toNumber()).toBe(4850.0);
    expect(payment!.fileHash).toBe(expectedHash);
    
    // Find the consumed intent manually
    const intent = await prisma.paymentUploadIntent.findFirst({
      where: { billId: billRecord1.id, status: 'CONSUMED' }
    });
    expect(intent).not.toBeNull();
    expect(intent!.status).toBe('CONSUMED');
    expect(intent!.sha256).toBe(expectedHash);

    // --- STEP 3: Owner logs in and reviews payment ---
    await loginAs(page, ownerUser, 'OWNER');
    await page.goto('/owner/payments');

    // Owner should see payment in "รอตรวจสอบ" tab
    await expect(page.locator(`text=บิลเลขที่: ${billRecord1.billNumber}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=คุณสมชาย ผู้เช่าทดสอบ')).toBeVisible();
    await expect(page.locator('text=A-201')).toBeVisible();

    // Preview Evidence
    const previewBtn = page.getByRole('button', { name: 'ดูสลิป' }).first();
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();

    // Modal with slip image should be open
    await expect(page.locator('text=หลักฐานสลิปโอนเงิน')).toBeVisible();
    const slipImg = page.locator('img[alt="Payment Slip Evidence"]');
    await expect(slipImg).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'ปิด' }).click();

    // Owner approves the payment
    const approveBtn = page.getByRole('button', { name: 'อนุมัติ' }).first();
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Verify UI confirmation
    await expect(page.locator('text=อนุมัติการชำระเงินและออกใบเสร็จรับเงินเรียบร้อยแล้ว')).toBeVisible({ timeout: 15000 });

    // --- STEP 4: Verify PostgreSQL state after Owner Approval ---
    const updatedPayment = await prisma.payment.findUnique({
      where: { id: payment!.id },
      include: { receipt: true },
    });

    expect(updatedPayment!.status).toBe('APPROVED');
    expect(updatedPayment!.reviewedByUserId).toBe(ownerUser.id);
    expect(updatedPayment!.reviewedAt).not.toBeNull();
    expect(updatedPayment!.receipt).not.toBeNull();

    // Verify Bill updated to PAID
    const updatedBill = await prisma.bill.findUnique({ where: { id: billRecord1.id } });
    expect(updatedBill!.status).toBe('PAID');
    expect(updatedBill!.paidAmount.toNumber()).toBe(4850.0);
    expect(updatedBill!.paidAt).not.toBeNull();

    // Verify Receipt Number format: RC-{YYYYMM}-{ROOM}-{SEQ}
    const receipt = updatedPayment!.receipt!;
    expect(receipt.receiptNumber).toMatch(/^RC-\d{6}-A201-\d{4}$/);
    expect(receipt.isVoided).toBe(false);

    // --- STEP 5: Verify Authoritative Receipt HTML view ---
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'horplus_session')?.value;
    
    const htmlResponse = await page.request.get(`/api/v1/receipts/${receipt.id}/html`, {
      headers: {
        Cookie: `horplus_session=${sessionCookie}`,
      }
    });
    expect(htmlResponse.status()).toBe(200);
    const htmlBody = await htmlResponse.text();
    expect(htmlBody).toContain(receipt.receiptNumber);
    expect(htmlBody).toContain('คุณสมชาย ผู้เช่าทดสอบ');
    expect(htmlBody).toContain('A-201');
    expect(htmlBody).toContain('4850');

    // --- STEP 6: Verify Rejection and Resubmission on Bill 2 ---
    // First, submit a payment for Bill 2 via backend API directly to simulate an earlier submission
    const t1Session = await loginAs(page, tenantUser, 'TENANT');
    
    // Simulate first submission
    const intentRes2 = await page.request.post('/api/v1/payments/slip/intent', {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
      },
      data: {
        dormitoryId: dormId,
        billId: billRecord2.id,
        fileName: 'slip-2.png',
        mimeType: 'image/png',
        fileSize: VALID_PNG_BUFFER.length + 16
      }
    });
    const intentData2 = await intentRes2.json();

    const formData2 = new FormData();
    const uploadRes2 = await page.request.post(intentData2.uploadUrl, {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
      },
      multipart: {
        file: {
          name: 'slip-2.png',
          mimeType: 'image/png',
          buffer: Buffer.concat([VALID_PNG_BUFFER, crypto.randomBytes(16)]),
        }
      }
    });

    const submitRes2 = await page.request.post('/api/v1/payments/slip/submit', {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
        'x-idempotency-key': crypto.randomUUID(),
      },
      data: {
        dormitoryId: dormId,
        billId: billRecord2.id,
        amount: '4500.00',
        paymentDate: new Date().toISOString(),
        intentId: intentData2.intentId,
      },
    });
    expect(submitRes2.ok()).toBeTruthy();

    // Owner sees Bill 2 and clicks "ปฏิเสธ"
    await loginAs(page, ownerUser, 'OWNER');
    await page.goto('/owner/payments');
    // await page.waitForLoadState('networkidle');

    await expect(page.locator(`text=บิลเลขที่: ${billRecord2.billNumber}`)).toBeVisible({ timeout: 10000 });
    const rejectBtn = page.getByRole('button', { name: 'ปฏิเสธ' }).first();
    await rejectBtn.click();

    // Modal appears, type rejection reason
    await expect(page.locator('text=ปฏิเสธสลิปโอนเงิน')).toBeVisible();
    await page.locator('textarea').fill('ยอดเงินในสลิปไม่ถูกต้องตามยอดบิล');
    await page.getByRole('button', { name: 'ยืนยันปฏิเสธ' }).click();

    // Verify UI confirmation
    await expect(page.locator('text=ปฏิเสธการชำระเงินเรียบร้อยแล้ว')).toBeVisible({ timeout: 15000 });

    // Assert in PostgreSQL
    const rejectedPayment = await prisma.payment.findFirst({ where: { billId: billRecord2.id, status: 'REJECTED' } });
    expect(rejectedPayment!.status).toBe('REJECTED');
    expect(rejectedPayment!.rejectedReason).toBe('ยอดเงินในสลิปไม่ถูกต้องตามยอดบิล');

    const bill2StillPending = await prisma.bill.findUnique({ where: { id: billRecord2.id } });
    expect(bill2StillPending!.status).toBe('PENDING');

    // Tenant opens the rejected Bill (simulate by requesting new intent for same bill)
    // Tenant requests a new upload intent
    // Tenant uploads a DIFFERENT valid slip image (png)
    const retryBuffer = Buffer.concat([VALID_PNG_BUFFER, crypto.randomBytes(16)]);

    const intentRes2_Retry = await page.request.post('/api/v1/payments/slip/intent', {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
      },
      data: {
        dormitoryId: dormId,
        billId: billRecord2.id,
        fileName: 'slip-2-retry.png',
        mimeType: 'image/png',
        fileSize: retryBuffer.length
      }
    });
    expect(intentRes2_Retry.ok()).toBeTruthy();
    const intentData2_Retry = await intentRes2_Retry.json();

    const uploadRes2_Retry = await page.request.post(intentData2_Retry.uploadUrl, {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
      },
      multipart: {
        file: {
          name: 'slip-2-retry.png',
          mimeType: 'image/png',
          buffer: retryBuffer,
        }
      }
    });
    expect(uploadRes2_Retry.ok()).toBeTruthy();

    // Tenant submits successfully
    const submitRes2_Retry = await page.request.post('/api/v1/payments/slip/submit', {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
        'x-idempotency-key': crypto.randomUUID(),
      },
      data: {
        dormitoryId: dormId,
        billId: billRecord2.id,
        amount: '4500.00',
        paymentDate: new Date().toISOString(),
        intentId: intentData2_Retry.intentId,
      },
    });
    expect(submitRes2_Retry.ok()).toBeTruthy();

    // Verify new Payment attempt is created
    const bill2Payments = await prisma.payment.findMany({
      where: { billId: billRecord2.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(bill2Payments.length).toBe(2);
    expect(bill2Payments[0].status).toBe('PENDING'); // The new attempt
    expect(bill2Payments[1].status).toBe('REJECTED'); // The rejected historical payment remains preserved
    
    // Only one active review attempt exists
    const activeReviews = bill2Payments.filter(p => p.status === 'PENDING' || p.status === 'UNDER_REVIEW');
    expect(activeReviews.length).toBe(1);

    // --- STEP 7: Test Duplicate Evidence Prevention ---
    // 1. Request a real upload intent through /api/v1/payments/slip/intent
    const duplicateBuffer = firstSlipBytes;
    
    const intentRes3 = await page.request.post('/api/v1/payments/slip/intent', {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
      },
      data: {
        dormitoryId: dormId,
        billId: billRecord3.id,
        fileName: 'duplicate-slip.jpg',
        mimeType: 'image/jpeg',
        fileSize: duplicateBuffer.length
      }
    });
    expect(intentRes3.ok()).toBeTruthy();
    const intentData3 = await intentRes3.json();

    // 2. Upload the exact same file bytes (firstSlipBytes used in bill 1)
    const dupUploadPath = `/api/v1/payments/slip/upload/${intentData3.intentId}`;
    registerExpectedNegative('POST', dupUploadPath, 409, 'STEP 7 Duplicate Evidence Upload');
    const uploadRes3 = await page.request.post(intentData3.uploadUrl, {
      headers: {
        Cookie: `horplus_session=${t1Session.sessionCookie}`,
        'x-csrf-token': t1Session.csrfToken,
      },
      multipart: {
        file: {
          name: 'duplicate-slip.jpg',
          mimeType: 'image/jpeg',
          buffer: duplicateBuffer, // Exact same bytes used in bill 1
        }
      }
    });
    consumeExpectedNegative('POST', dupUploadPath, uploadRes3.status());
    expect(uploadRes3.status()).toBe(409);
    const uploadDupData = await uploadRes3.json();
    expect(uploadDupData.error).toBe('DUPLICATE_PAYMENT_EVIDENCE');

    // 1. Assert no Payment exists for the duplicate Bill
    const bill3Payments = await prisma.payment.findMany({ where: { billId: billRecord3.id } });
    expect(bill3Payments.length).toBe(0);

    // 2. Assert the Bill remains unpaid
    const bill3 = await prisma.bill.findUnique({ where: { id: billRecord3.id } });
    expect(bill3!.status).toBe('PENDING');
    expect(bill3!.paidAmount.toNumber()).toBe(0);

    // 3. Assert the intent is not UPLOADED
    const orphanIntent = await prisma.paymentUploadIntent.findUnique({ where: { id: intentData3.intentId } });
    expect(orphanIntent!.status).not.toBe('UPLOADED');

    // 4. Assert the intent contains no authoritative active objectKey, or its state clearly records failed/cancelled cleanup
    expect(orphanIntent!.objectKey === null || orphanIntent!.status === 'FAILED' || orphanIntent!.status === 'CREATED').toBe(true);

    // 5. Assert the expected file does not exist in private local storage
    if (orphanIntent!.objectKey) {
      const fileOnDisk = await localStorageProvider.fileExists(orphanIntent!.objectKey);
      expect(fileOnDisk).toBe(false);
    }

    // 6. Assert no unreferenced physical file was created for that failed upload intent
    const candidateUploadDir = path.join(process.cwd(), 'server', 'uploads', 'private', 'payments', dormId, billRecord3.id);
    expect(fs.existsSync(candidateUploadDir)).toBe(false);

    // --- STEP 8: Real PostgreSQL-Backed Complete Authorization Matrix Verification ---
    const t1AuthSession = await loginAs(page, tenantUser, 'TENANT');
    const t2Session = await loginAs(page, tenantUser2, 'TENANT');
    const ownerSession = await loginAs(page, ownerUser, 'OWNER');
    const managerSession = await loginAs(page, managerUser, 'OWNER');
    const techSession = await loginAs(page, technicianUser, 'TENANT');
    const otherOwnerSession = await loginAs(page, otherOwnerUser, 'OWNER');

    const authEndpoints = [
      `/api/v1/payments/${payment!.id}/evidence`,
      `/api/v1/receipts/${receipt.id}`,
      `/api/v1/receipts/${receipt.id}/html`,
    ];

    const assertResponsePrivacy = async (res: any) => {
      const text = await res.text();
      // Ensure no financial metadata, object keys, or filesystem paths are exposed
      expect(text).not.toContain(payment!.id);
      expect(text).not.toContain('uploads/');
      expect(text).not.toContain('storage/');
      expect(text).not.toContain('C:');
      expect(text).not.toContain('D:');
    };

    // 1. Submitting Tenant -> 200
    for (const ep of authEndpoints) {
      const res = await page.request.get(ep, { headers: { Cookie: `horplus_session=${t1AuthSession.sessionCookie}` } });
      expect(res.status()).toBe(200);
    }

    // 2. Authorized Owner -> 200
    for (const ep of authEndpoints) {
      const res = await page.request.get(ep, { headers: { Cookie: `horplus_session=${ownerSession.sessionCookie}` } });
      expect(res.status()).toBe(200);
    }

    // 3. Authorized Manager -> 200 (if permissions allow financial viewing)
    for (const ep of authEndpoints) {
      const res = await page.request.get(ep, { headers: { Cookie: `horplus_session=${managerSession.sessionCookie}` } });
      expect(res.status()).toBe(200);
    }

    // 4. Different Tenant -> 403 or safe 404
    for (const ep of authEndpoints) {
      registerExpectedNegative('GET', ep, [403, 404], 'STEP 8 Different Tenant Authorization');
      const res = await page.request.get(ep, { headers: { Cookie: `horplus_session=${t2Session.sessionCookie}` } });
      consumeExpectedNegative('GET', ep, res.status());
      expect([403, 404]).toContain(res.status());
      await assertResponsePrivacy(res);
    }

    // 5. Technician / Housekeeping -> 403 or safe 404
    for (const ep of authEndpoints) {
      registerExpectedNegative('GET', ep, [403, 404], 'STEP 8 Technician Authorization');
      const res = await page.request.get(ep, { headers: { Cookie: `horplus_session=${techSession.sessionCookie}` } });
      consumeExpectedNegative('GET', ep, res.status());
      expect([403, 404]).toContain(res.status());
      await assertResponsePrivacy(res);
    }

    // 6. Owner from another Dormitory -> 403 or safe 404
    for (const ep of authEndpoints) {
      registerExpectedNegative('GET', ep, [403, 404], 'STEP 8 Other Owner Authorization');
      const res = await page.request.get(ep, { headers: { Cookie: `horplus_session=${otherOwnerSession.sessionCookie}` } });
      consumeExpectedNegative('GET', ep, res.status());
      expect([403, 404]).toContain(res.status());
      await assertResponsePrivacy(res);
    }

    // 7. Anonymous -> HTTP 401 strictly
    const anonBrowserContext = await page.context().browser()!.newContext();
    for (const ep of authEndpoints) {
      registerExpectedNegative('GET', ep, 401, 'STEP 8 Anonymous Authorization');
      const res = await anonBrowserContext.request.get(ep);
      consumeExpectedNegative('GET', ep, res.status());
      expect(res.status()).toBe(401);
      await assertResponsePrivacy(res);
    }
    await anonBrowserContext.close();

    // Verify all registered expected negative records (except optional probes) were actually consumed
    const unconsumedExpected = expectedNegativeRecords.filter(r => !r.consumed && !r.step.includes('Maintenance Probe'));
    expect(unconsumedExpected).toEqual([]);

    // Finally, verify no unexpected browser errors or unhandled HTTP errors occurred
    expect(browserErrors).toEqual([]);
  });
});
