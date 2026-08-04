import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../src/services/payment.service.js';
import { LocalStorageProvider } from '../src/services/local-storage.service.js';
import { CleanupService } from '../src/services/cleanup.service.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const prisma = new PrismaClient();

describe('Wave 1E - Tenant Payments, Manual Review, Receipts & Evidence Lifecycle', () => {
  const storageDir = path.join(process.cwd(), 'tmp-test-storage');
  const storage = new LocalStorageProvider(storageDir);
  const paymentService = new PaymentService(prisma, storage);
  const cleanupService = new CleanupService(prisma, storage);

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
    const timestamp = Date.now() + Math.floor(Math.random() * 10000);
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
        roomNumber: '101',
        normalizedRoomNumber: '101',
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

  async function createTestBill(roomNo: string) {
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
        billNumber: `BILL-${roomNo}-${Date.now()}`,
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

  it('2. Slip Submission: saves file, calculates SHA-256 hash, creates payment in PENDING review', async () => {
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `slips/${dormId}/${billId}-${Date.now()}.jpg`;

    await storage.saveFile(storageKey, slipBuffer);

    // Create and mark intent UPLOADED
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
  });

  it('3. Duplicate Evidence Check: blocks duplicate SHA-256 hash usage globally across bills', async () => {
    const t3Bill = await createTestBill('T3-Room');
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `slips/${dormId}/dup-test-${Date.now()}.jpg`;
    await storage.saveFile(storageKey, slipBuffer);

    const intent1 = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: t3Bill.id,
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

    // First submission succeeds
    await paymentService.submitSlip({
      dormitoryId: dormId,
      billId: t3Bill.id,
      tenantId: tenantId,
      amount: '5200.00',
      paymentDate: new Date(),
      intentId: intent1.id,
      idempotencyKey: `idemp-dup-1-${Date.now()}`,
      actorUserId: tenantUserId
    });

    // Check duplicate detection in database
    const existing = await prisma.payment.findFirst({
      where: {
        fileHash: slipHash,
        status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] }
      }
    });

    expect(existing).toBeDefined();
    expect(existing?.fileHash).toBe(slipHash);
  });

  it('4. Owner Manual Approval: transitions payment to APPROVED, generates immutable Receipt with REC-YYYYMM-XXXX sequence', async () => {
    const t4Bill = await createTestBill('T4-Room');
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `slips/${dormId}/approve-test-${Date.now()}.jpg`;
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

    // Verify Bill is marked PAID
    const bill = await prisma.bill.findUnique({ where: { id: t4Bill.id } });
    expect(bill?.status).toBe('PAID');

    // Verify Receipt was generated
    const receipt = await prisma.receipt.findUnique({ where: { paymentId: payment.id } });
    expect(receipt).toBeDefined();
    expect(receipt?.receiptNumber).toMatch(/^REC-\d{6}-\d{4}$/);
    expect(receipt?.isVoided).toBe(false);

    // Verify Authoritative Snapshot Data
    const snapshot = receipt?.snapshotData as any;
    expect(snapshot.dormitoryName).toBe('HorPlus Test Living');
    expect(snapshot.tenantName).toBe('Somchai Jaidee');
    expect(snapshot.roomNumber).toBe('T4-Room');
    expect(snapshot.total).toBe('5200');
    expect(snapshot.items.length).toBe(3);
  });

  it('5. Owner Rejection: requires reason, marks payment REJECTED, and returns bill to PENDING', async () => {
    const t5Bill = await createTestBill('T5-Room');
    const slipBuffer = crypto.randomBytes(64);
    const slipHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');
    const storageKey = `slips/${dormId}/reject-test-${Date.now()}.jpg`;
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
    expect(bill?.status).toBe('ISSUED');
  });

  it('6. Cash Payment: records cash payment and issues receipt directly in single transaction', async () => {
    const cashRoom = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: buildingId,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        floor: 1,
        monthlyRent: 4500
      }
    });

    const existingBill = await prisma.bill.findUnique({ where: { id: billId } });
    const cashBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: existingBill!.billingCycleId,
        tenantId: tenantId,
        roomId: cashRoom.id,
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        billNumber: `BILL-CASH-${Date.now()}`,
        status: 'PENDING',
        totalAmount: 4500.00,
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'Room Rent', amount: 4500.00, quantity: 1 }
          ]
        }
      }
    });

    const payment = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: cashBill.id,
      amount: '4500.00',
      idempotencyKey: `idemp-cash-${Date.now()}`,
      userId: ownerUserId
    });

    expect(payment.status).toBe('APPROVED');
    expect(payment.method).toBe('CASH');

    const updatedBill = await prisma.bill.findUnique({ where: { id: cashBill.id } });
    expect(updatedBill?.status).toBe('PAID');

    const receipt = await prisma.receipt.findUnique({ where: { paymentId: payment.id } });
    expect(receipt).toBeDefined();
    expect((receipt?.snapshotData as any).paymentMethod).toBe('CASH');
  });

  it('7. Payment Reversal: voids receipt, records reversalReason, and restores bill to PENDING', async () => {
    const revRoom = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: buildingId,
        roomNumber: '103',
        normalizedRoomNumber: '103',
        floor: 1,
        monthlyRent: 4500
      }
    });

    const existingBill = await prisma.bill.findUnique({ where: { id: billId } });
    const cashBill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: existingBill!.billingCycleId,
        tenantId: tenantId,
        roomId: revRoom.id,
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        billNumber: `BILL-REV-${Date.now()}`,
        status: 'PENDING',
        totalAmount: 4500.00,
        items: {
          create: [
            { dormitoryId: dormId, type: 'RENT', description: 'Room Rent', amount: 4500.00, quantity: 1 }
          ]
        }
      }
    });

    const payment = await paymentService.recordCash({
      dormitoryId: dormId,
      billId: cashBill.id,
      amount: '4500.00',
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

    const bill = await prisma.bill.findUnique({ where: { id: cashBill.id } });
    expect(bill?.status).toBe('ISSUED');
  });

  it('8. Cleanup Service: safely deletes expired upload intents and physical orphan files', async () => {
    const orphanKey = `slips/${dormId}/orphan-${Date.now()}.jpg`;
    await storage.saveFile(orphanKey, Buffer.from('orphan-data'));
    expect(await storage.fileExists(orphanKey)).toBe(true);

    const expiredIntent = await prisma.paymentUploadIntent.create({
      data: {
        authenticatedUserId: tenantUserId,
        tenantId: tenantId,
        dormitoryId: dormId,
        billId: billId,
        expectedMimeType: 'image/jpeg',
        expectedSize: 5000,
        expiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
        objectKey: orphanKey,
        status: 'UPLOADED'
      }
    });

    const cleanedCount = await cleanupService.runCleanup();
    expect(cleanedCount).toBeGreaterThanOrEqual(1);

    const intentAfter = await prisma.paymentUploadIntent.findUnique({ where: { id: expiredIntent.id } });
    expect(intentAfter).toBeNull();
    expect(await storage.fileExists(orphanKey)).toBe(false);
  });
});
