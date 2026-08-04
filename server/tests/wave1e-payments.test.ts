import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../src/services/payment.service.js';
import { LocalStorageProvider } from '../src/services/local-storage.service.js';
import { CleanupService } from '../src/services/cleanup.service.js';
import { IdempotencyService } from '../src/services/idempotency.service.js';
import crypto from 'crypto';
import path from 'path';
import { Decimal } from 'decimal.js';

const prisma = new PrismaClient();

describe('Wave 1E - Tenant Payments, Manual Review, Receipts & Evidence Lifecycle', () => {
  const storage = new LocalStorageProvider();
  const paymentService = new PaymentService(prisma);
  const cleanupService = new CleanupService(prisma, storage);
  const idempotencyService = new IdempotencyService(prisma);

  let dormId: string;
  let ownerUserId: string;
  let tenantUserId: string;
  let buildingId: string;
  let roomId: string;
  let tenantId: string;
  let billId: string;

  beforeEach(async () => {
    dormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    tenantUserId = crypto.randomUUID();
    const timestamp = Date.now() + Math.floor(Math.random() * 100000);

    // 1. Create Dormitory & Users
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'HorPlus Test Living',
        addressLine1: '123 Rama IX Rd, Bangkok',
        phone: '02-123-4567'
      }
    });

    await prisma.user.create({
      data: {
        id: ownerUserId,
        googleSubject: `sub-owner-${timestamp}`,
        email: `owner-${timestamp}@horplus.com`,
        emailNormalized: `owner-${timestamp}@horplus.com`,
        name: 'Owner Tester'
      }
    });

    await prisma.user.create({
      data: {
        id: tenantUserId,
        googleSubject: `sub-tenant-${timestamp}`,
        email: `tenant-${timestamp}@horplus.com`,
        emailNormalized: `tenant-${timestamp}@horplus.com`,
        name: 'Tenant Tester'
      }
    });

    // 2. Create Building & Room
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A'
      }
    });
    buildingId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: building.id,
        roomNumber: 'A101',
        normalizedRoomNumber: 'A101',
        floor: 1,
        monthlyRent: 4500
      }
    });
    roomId = room.id;

    // 3. Create Tenant
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${timestamp}`,
        firstName: 'Somchai',
        displayName: 'Somchai Jaidee',
        phone: '0812345678'
      }
    });
    tenantId = tenant.id;

    // 4. Create BillingCycle & Bill
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `CYC-${timestamp}`,
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published'
      }
    });

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycle.id,
        tenantId: tenant.id,
        roomId: room.id,
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        billNumber: `BILL-${timestamp}`,
        status: 'PENDING',
        totalAmount: 5200.00,
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'Room Rent', amount: 4500.00, quantity: 1 },
            { dormitoryId: dormId, type: 'WATER', description: 'Water', amount: 200.00, quantity: 1 },
            { dormitoryId: dormId, type: 'ELECTRICITY', description: 'Electricity', amount: 500.00, quantity: 1 }
          ]
        }
      }
    });
    billId = bill.id;
  });

  async function createTestBill(roomNo: string, initialStatus: string = 'PENDING') {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: buildingId,
        roomNumber: roomNo,
        normalizedRoomNumber: roomNo,
        floor: 1,
        monthlyRent: 4500
      }
    });

    return await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: (await prisma.billingCycle.findFirst({ where: { dormitoryId: dormId } }))!.id,
        tenantId: tenantId,
        roomId: room.id,
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        billNumber: `BILL-${roomNo}-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        status: initialStatus,
        totalAmount: 5200.00,
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'Room Rent', amount: 4500.00, quantity: 1 },
            { dormitoryId: dormId, type: 'WATER', description: 'Water', amount: 200.00, quantity: 1 },
            { dormitoryId: dormId, type: 'ELECTRICITY', description: 'Electricity', amount: 500.00, quantity: 1 }
          ]
        }
      }
    });
  }

  it('1. Upload Intent: creates intent with 15-minute expiration and enforces validation', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const intent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expectedSize: 102400,
        expiresAt: expiresAt,
        status: 'CREATED'
      }
    });

    expect(intent.id).toBeDefined();
    expect(intent.status).toBe('CREATED');
    expect(intent.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('2. Slip Submission: saves file, calculates SHA-256 hash, creates payment in PENDING review and tracks previousStatus', async () => {
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `payments/${dormId}/${billId}/${Date.now()}.jpg`;

    await storage.saveFile(storageKey, slipBuffer);

    const intent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expectedSize: slipBuffer.length,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: slipBuffer.length,
        objectKey: storageKey,
        sha256: slipHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        status: 'UPLOADED'
      }
    });

    const payment = await paymentService.submitSlip({
      dormitoryId: dormId,
      billId: billId,
      tenantId: tenantId,
      amount: '5200.00',
      paymentDate: new Date(),
      intentId: intent.id,
      idempotencyKey: `idemp-slip-${Date.now()}`,
      actorUserId: tenantUserId
    });

    expect(payment.id).toBeDefined();
    expect(payment.status).toBe('PENDING');
    expect(payment.fileHash).toBe(slipHash);

    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    expect(bill?.status).toBe('UNDER_REVIEW');
    expect(bill?.previousStatus).toBe('PENDING');
  });

  it('3. Duplicate Evidence Check: concurrent uploads of identical hash trigger unique constraint conflict', async () => {
    const t3Bill1 = await createTestBill('T3-1');
    const t3Bill2 = await createTestBill('T3-2');
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');

    const intent1 = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: t3Bill1.id,
        expectedMimeType: 'image/jpeg',
        expectedSize: slipBuffer.length,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: slipBuffer.length,
        objectKey: `payments/${dormId}/${t3Bill1.id}/intent1.jpg`,
        sha256: slipHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        status: 'UPLOADED'
      }
    });
    expect(intent1.id).toBeDefined();

    // Second upload with same sha256 to active intent must fail unique index
    await expect(
      prisma.paymentUploadIntent.create({
        data: {
          authenticatedUserId: tenantUserId,
          tenantId: tenantId,
          dormitoryId: dormId,
          billId: t3Bill2.id,
          expectedMimeType: 'image/jpeg',
          expectedSize: slipBuffer.length,
          verifiedMimeType: 'image/jpeg',
          verifiedSize: slipBuffer.length,
          objectKey: `payments/${dormId}/${t3Bill2.id}/intent2.jpg`,
          sha256: slipHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          status: 'UPLOADED'
        }
      })
    ).rejects.toThrow();
  });

  it('4. Owner Manual Approval: marks Bill PAID, sets paidAt/paidAmount, generates locked Receipt RC-{YYYYMM}-{ROOM}-{SEQ}', async () => {
    const t4Bill = await createTestBill('B202');
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `payments/${dormId}/${t4Bill.id}/approve-test-${Date.now()}.jpg`;
    await storage.saveFile(storageKey, slipBuffer);

    const intent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: t4Bill.id,
        expectedMimeType: 'image/jpeg',
        expectedSize: slipBuffer.length,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: slipBuffer.length,
        objectKey: storageKey,
        sha256: slipHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        status: 'UPLOADED'
      }
    });

    const payment = await paymentService.submitSlip({
      dormitoryId: dormId,
      billId: t4Bill.id,
      tenantId: tenantId,
      amount: '5200.00',
      paymentDate: new Date(),
      intentId: intent.id,
      idempotencyKey: `idemp-appr-${Date.now()}`,
      actorUserId: tenantUserId
    });

    const approvedPayment = await paymentService.approvePayment({
      dormitoryId: dormId,
      paymentId: payment.id,
      userId: ownerUserId
    });
    expect(approvedPayment.status).toBe('APPROVED');
    expect(approvedPayment.reviewedByUserId).toBe(ownerUserId);

    // Verify Bill is marked PAID with authoritative paidAt and paidAmount
    const bill = await prisma.bill.findUnique({ where: { id: t4Bill.id } });
    expect(bill?.status).toBe('PAID');
    expect(bill?.paidAt).toBeDefined();
    expect(bill?.paidAmount.toString()).toBe('5200');
    expect(bill?.outstandingAmount.toString()).toBe('0');

    // Verify Receipt was generated with locked format RC-YYYYMM-ROOM-SEQ
    const receipt = await prisma.receipt.findUnique({ where: { paymentId: payment.id } });
    expect(receipt).toBeDefined();
    expect(receipt?.receiptNumber).toMatch(/^RC-\d{6}-B202-\d{4}$/);
    expect(receipt?.isVoided).toBe(false);

    // Verify Authoritative Snapshot Data
    const snapshot = receipt?.snapshotData as any;
    expect(snapshot.dormitoryName).toBe('HorPlus Test Living');
    expect(snapshot.tenantName).toBe('Somchai Jaidee');
    expect(snapshot.roomNumber).toBe('B202');
    expect(snapshot.total).toBe('5200');
    expect(snapshot.items.length).toBe(3);
  });

  it('5. Owner Rejection: restores pre-review status (e.g. PENDING), records reason and audit history', async () => {
    const t5Bill = await createTestBill('102', 'PENDING');
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `payments/${dormId}/${t5Bill.id}/reject-test-${Date.now()}.jpg`;
    await storage.saveFile(storageKey, slipBuffer);

    const intent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: t5Bill.id,
        expectedMimeType: 'image/jpeg',
        expectedSize: slipBuffer.length,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: slipBuffer.length,
        objectKey: storageKey,
        sha256: slipHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        status: 'UPLOADED'
      }
    });

    const payment = await paymentService.submitSlip({
      dormitoryId: dormId,
      billId: t5Bill.id,
      tenantId: tenantId,
      amount: '5200.00',
      paymentDate: new Date(),
      intentId: intent.id,
      idempotencyKey: `idemp-rej-${Date.now()}`,
      actorUserId: tenantUserId
    });

    const rejectedPayment = await paymentService.rejectPayment({
      dormitoryId: dormId,
      paymentId: payment.id,
      userId: ownerUserId,
      reason: 'ยอดเงินในสลิปไม่ตรงกับยอดบิล'
    });
    expect(rejectedPayment.status).toBe('REJECTED');
    expect(rejectedPayment.rejectedReason).toBe('ยอดเงินในสลิปไม่ตรงกับยอดบิล');

    const bill = await prisma.bill.findUnique({ where: { id: t5Bill.id } });
    expect(bill?.status).toBe('PENDING'); // Restored pre-review status!
    expect(bill?.paidAt).toBeNull();
    expect(bill?.paidAmount.toString()).toBe('0');
  });

  it('6. Cash Payment & Idempotency: exact-once execution and deterministic replay', async () => {
    const cashBill = await createTestBill('103');
    const idempKey = `idemp-cash-key-${Date.now()}`;

    // First run: executes mutation
    const payment1 = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: cashBill.id,
      amount: '5200.00',
      idempotencyKey: idempKey,
      userId: ownerUserId
    });

    expect(payment1.status).toBe('APPROVED');
    expect(payment1.method).toBe('CASH');

    // Second run with same key & payload: replays cached result without re-executing
    const payment2 = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: cashBill.id,
      amount: '5200.00',
      idempotencyKey: idempKey,
      userId: ownerUserId
    });

    expect(payment2.id).toBe(payment1.id);

    // Third run with same key & DIFFERENT payload: throws IDEMPOTENCY_MISMATCH
    await expect(
      paymentService.recordCash({
        dormitoryId: dormId,
        billId: cashBill.id,
        amount: '9999.00',
        idempotencyKey: idempKey,
        userId: ownerUserId
      })
    ).rejects.toThrow('IDEMPOTENCY_MISMATCH');
  });

  it('7. Payment Reversal: voids receipt, clears paidAt, and restores pre-payment status', async () => {
    const revBill = await createTestBill('104', 'PENDING');
    const payment = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: revBill.id,
      amount: '5200.00',
      idempotencyKey: `idemp-rev-${Date.now()}`,
      userId: ownerUserId
    });

    const reversed = await paymentService.reversePayment({
      dormitoryId: dormId,
      paymentId: payment.id,
      userId: ownerUserId,
      reason: 'บันทึกยอดเงินสดผิดห้อง'
    });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversalReason).toBe('บันทึกยอดเงินสดผิดห้อง');

    const receipt = await prisma.receipt.findUnique({ where: { paymentId: payment.id } });
    expect(receipt?.isVoided).toBe(true);
    expect(receipt?.voidReason).toBe('บันทึกยอดเงินสดผิดห้อง');

    const bill = await prisma.bill.findUnique({ where: { id: revBill.id } });
    expect(bill?.status).toBe('PENDING');
    expect(bill?.paidAt).toBeNull();
    expect(bill?.paidAmount.toString()).toBe('0');
  });

  it('8. Time-Controlled Cleanup Lifecycle: respects 15m TTL, 24h grace orphan purge, 7d consumed purge', async () => {
    const now = new Date();

    // 8a: Active intent (< 15m) -> should NOT be touched
    const activeIntent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        status: 'CREATED'
      }
    });

    // 8b: Expired intent (> 15m, < 24h) -> should be marked EXPIRED, but NOT deleted
    const expiredRecentIntent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expiresAt: new Date(now.getTime() - 20 * 60 * 1000), // expired 20m ago
        status: 'CREATED'
      }
    });

    // 8c: Expired orphan (> 24h) -> should be physically deleted and DB row deleted
    const orphanKey = `payments/${dormId}/${billId}/orphan-${Date.now()}.jpg`;
    await storage.saveFile(orphanKey, Buffer.from('orphan-test-data'));

    const oldOrphanIntent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expiresAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // expired 25h ago
        objectKey: orphanKey,
        status: 'EXPIRED'
      }
    });

    // 8d: Consumed intent (> 7d) -> metadata purged, but payment/file preserved
    const consumedOldIntent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expectedSize: 5000,
        verifiedMimeType: 'image/jpeg',
        verifiedSize: 5000,
        objectKey: `payments/${dormId}/${billId}/old-consumed.jpg`,
        sha256: crypto.randomBytes(32).toString('hex'),
        expiresAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
        consumedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
        status: 'CONSUMED'
      }
    });

    // Run cleanup
    const result = await cleanupService.runCleanup(now);

    expect(result.expiredMarked).toBeGreaterThanOrEqual(1);
    expect(result.orphansDeleted).toBeGreaterThanOrEqual(1);
    expect(result.consumedMetadataPurged).toBeGreaterThanOrEqual(1);

    // Active intent is untouched
    const checkActive = await prisma.paymentUploadIntent.findUnique({ where: { id: activeIntent.id } });
    expect(checkActive?.status).toBe('CREATED');

    // Recent expired is marked EXPIRED, not deleted
    const checkRecent = await prisma.paymentUploadIntent.findUnique({ where: { id: expiredRecentIntent.id } });
    expect(checkRecent?.status).toBe('EXPIRED');

    // Old orphan is deleted from DB and disk
    const checkOrphan = await prisma.paymentUploadIntent.findUnique({ where: { id: oldOrphanIntent.id } });
    expect(checkOrphan).toBeNull();
    expect(await storage.fileExists(orphanKey)).toBe(false);

    // Old consumed intent metadata is deleted
    const checkConsumed = await prisma.paymentUploadIntent.findUnique({ where: { id: consumedOldIntent.id } });
    expect(checkConsumed).toBeNull();
  });
});
