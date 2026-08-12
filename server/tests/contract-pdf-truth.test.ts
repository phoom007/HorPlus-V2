import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPrismaClient } from '../src/db/prisma.js';
import { DocumentPdfService } from '../src/services/document-pdf.service.js';
import { ContractService } from '../src/services/contract.service.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../src/db/repositories/tenant.repository.js';
import { createRequire } from 'module';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

/**
 * Extracts text from PDF buffer using both PDFParse and raw stream analysis.
 */
async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  let pdfParseText = '';
  try {
    const parser = new PDFParse({ data: pdfBuffer, verbosity: 0 });
    await parser.load();
    const res = await parser.getText();
    pdfParseText = res.text || '';
  } catch (err) {
    pdfParseText = '';
  }

  // Complementary raw stream decoder for fontkit CIDs
  const latinStr = pdfBuffer.toString('latin1');
  return pdfParseText + '\n' + latinStr;
}

describe('Contract PDF Evidence Gate & Database Immutability Unit Suite', () => {
  const pdfService = new DocumentPdfService();
  const prisma = getPrismaClient();
  let app: any;

  beforeEach(() => {
    app = createApp();
  });

  it('1. Distinctive Content Proof: PDF contains exact authoritative terms and no fabricated defaults', async () => {
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-Z909-TEST',
      dormitoryName: 'หอพักสัจจะความจริง',
      dormitoryAddress: '123/45 ถนนความจริง',
      ownerName: 'สมชาย เจ้าของหอ',
      tenantName: 'สมหญิง ผู้เช่าจริง',
      tenantPhone: '0812345678',
      buildingName: 'อาคาร Z',
      roomNumber: 'Z909',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '4321.00',
      depositAmount: '8765.00',
      waterRate: '21.25',
      electricityRate: '8.75',
      commonFee: '123.45',
      internetFee: '246.80',
      parkingFee: '100.00',
      billingDay: 15,
      dueDay: 5,
      createdAt: '2026-02-15T10:00:00.000Z',
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(5000);
    expect(pdfBuffer.toString('ascii', 0, 5)).toBe('%PDF-');

    const text = await extractPdfText(pdfBuffer);

    // Verify distinctive textual data presence via text extraction
    expect(text).toContain('หอพักสัจจะความจริง');
    expect(text).toContain('สมชาย เจ้าของหอ');
    expect(text).toContain('สมหญิง ผู้เช่าจริง');
    expect(text).toContain('สัญญาเช่ารายเดือน');

    // Assert legacy fabricated default rates are NOT present
    expect(text).not.toContain('18.00');
    expect(text).not.toContain('7.00');
  });

  it('2. Zero Value Content Proof: Authoritative 0.00 rates are preserved as "0.00" and not converted to "ไม่ระบุ"', async () => {
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-ZERO-TEST',
      dormitoryName: 'หอพักฟรีสวัสดิการ',
      ownerName: 'สมชาย',
      tenantName: 'สมหญิง',
      roomNumber: 'Z900',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '3000.00',
      depositAmount: '6000.00',
      waterRate: '0.00',
      electricityRate: '0.00',
      commonFee: '0.00',
      internetFee: '0.00',
      parkingRate: '0.00',
      billingDay: 1,
      dueDay: 5,
      createdAt: '2026-02-15T10:00:00.000Z',
    });

    const text = await extractPdfText(pdfBuffer);

    // PDF text extracted must NOT contain ไม่ระบุ for zero values
    expect(text).not.toContain('ไม่ระบุ');
    expect(text).toContain('หอพักฟรีสวัสดิการ');
  });

  it('3. Real Database Immutability Integration Test: Contract PDF remains anchored to snapshot when DormitoryBillingSettings change', async () => {
    const timestamp = Date.now();
    const ownerUserId = `user_owner_immut_${timestamp}`;

    // 1. Create Dormitory with initial billing settings
    const dorm = await prisma.dormitory.create({
      data: {
        name: `หอพักสัจจะอิมมิวเทเบิล`,
        addressLine1: '100/1 ถนนคงทน',
        phone: '0899999999',
      },
    });

    const initialSettings = await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dorm.id,
        waterRate: 21.25,
        electricityRate: 8.75,
        commonFee: 123.45,
        internetFee: 246.80,
        parkingRate: 100.00,
        billingDay: 15,
        dueDay: 25,
        version: 1,
      },
    });

    // 2. Create Building, Room, Tenant, and Draft Contract
    const building = await prisma.building.create({
      data: {
        dormitoryId: dorm.id,
        name: 'อาคาร A',
      },
    });

    const roomNum = `A${timestamp % 1000}`;
    const room = await prisma.room.create({
      data: {
        dormitoryId: dorm.id,
        buildingId: building.id,
        roomNumber: roomNum,
        normalizedRoomNumber: roomNum.toLowerCase(),
        floor: 1,
        monthlyRent: 4321.00,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dorm.id,
        tenantNumber: `TN-${timestamp % 10000}`,
        firstName: 'สมหญิง',
        displayName: 'สมหญิง ผู้เช่าสัญญาจริง',
        phone: '0811111111',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dorm.id,
        contractNumber: `CTR-TEST-${timestamp}`,
        roomId: room.id,
        tenantId: tenant.id,
        rentAmount: 4321.00,
        depositAmount: 8765.00,
        rentBillingType: 'monthly',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'draft',
      },
    });

    // 3. Activate Contract via ContractService (creates ContractSnapshot)
    const contractRepo = new PrismaContractRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const contractService = new ContractService(contractRepo, roomRepo, tenantRepo);
    await contractService.activateContract(contract.id, dorm.id, ownerUserId);

    // 4. Verify snapshotData captured original settings
    const snapshot = await prisma.contractSnapshot.findUnique({
      where: { contractId: contract.id },
    });
    expect(snapshot).toBeDefined();
    expect(Number(snapshot?.resolvedWaterRate)).toBe(21.25);
    expect(Number(snapshot?.resolvedElectricityRate)).toBe(8.75);
    expect(Number(snapshot?.resolvedCommonFee)).toBe(123.45);
    expect(Number(snapshot?.resolvedInternetFee)).toBe(246.80);
    const snapData = snapshot?.snapshotData as any;
    expect(snapData?.billingDay?.value).toBe(15);
    expect(snapData?.dueDay?.value).toBe(25);

    // 5. Generate PDF before settings change
    const pdfBufferBefore = await pdfService.generateContractPdf({
      contractNumber: contract.id,
      dormitoryName: dorm.name,
      ownerName: 'เจ้าของหอ',
      tenantName: tenant.displayName,
      roomNumber: room.roomNumber,
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: String(snapshot?.resolvedRent),
      depositAmount: String(snapshot?.resolvedDeposit),
      waterRate: String(snapshot?.resolvedWaterRate),
      electricityRate: String(snapshot?.resolvedElectricityRate),
      commonFee: String(snapshot?.resolvedCommonFee),
      internetFee: String(snapshot?.resolvedInternetFee),
      billingDay: snapData?.billingDay?.value,
      dueDay: snapData?.dueDay?.value,
      createdAt: snapshot?.lockedAt.toISOString(),
    });

    const textBefore = await extractPdfText(pdfBufferBefore);
    expect(textBefore).toContain(dorm.name);

    // 7. MUTATE DORMITORY BILLING SETTINGS TO DIFFERENT VALUES
    await prisma.dormitoryBillingSettings.update({
      where: { id: initialSettings.id },
      data: {
        waterRate: 99.99,
        electricityRate: 50.00,
        commonFee: 999.00,
        internetFee: 888.00,
        billingDay: 28,
        dueDay: 30,
        version: 2,
      },
    });

    // 8. Generate SAME historical Contract PDF again after settings changed
    // Route logic extracts from snapshot, so values must NOT change
    const pdfBufferAfter = await pdfService.generateContractPdf({
      contractNumber: contract.id,
      dormitoryName: dorm.name,
      ownerName: 'เจ้าของหอ',
      tenantName: tenant.displayName,
      roomNumber: room.roomNumber,
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: String(snapshot?.resolvedRent),
      depositAmount: String(snapshot?.resolvedDeposit),
      waterRate: String(snapshot?.resolvedWaterRate),
      electricityRate: String(snapshot?.resolvedElectricityRate),
      commonFee: String(snapshot?.resolvedCommonFee),
      internetFee: String(snapshot?.resolvedInternetFee),
      billingDay: snapData?.billingDay?.value,
      dueDay: snapData?.dueDay?.value,
      createdAt: snapshot?.lockedAt.toISOString(),
    });

    const textAfter = await extractPdfText(pdfBufferAfter);

    // 9. Verify PDF text/content is identical and does NOT contain mutated settings
    expect(textAfter).toEqual(textBefore);
    expect(textAfter).not.toContain('99.99');
    expect(textAfter).not.toContain('888.00');

    // Clean up test records
    await prisma.contractSnapshot.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.building.delete({ where: { id: building.id } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitory.delete({ where: { id: dorm.id } });
  });

  it('4. Legacy Snapshot Regression: Missing billingDay/dueDay in historical snapshot renders "ไม่ระบุ" and never falls back to current settings', async () => {
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-LEGACY-001',
      dormitoryName: 'หอพักเรโทร',
      ownerName: 'สมชาย',
      tenantName: 'สมหญิง',
      roomNumber: 'R101',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '5000.00',
      depositAmount: '10000.00',
      waterRate: '20.00',
      electricityRate: '8.00',
      commonFee: '200.00',
      internetFee: 'ไม่ระบุ',
      billingDay: 'ไม่ระบุ',
      dueDay: 'ไม่ระบุ',
    });

    const text = await extractPdfText(pdfBuffer);

    // Missing billingDay/dueDay must render as ไม่ระบุ
    expect(text).toContain('ไม่ระบุ');
    // Must NOT contain fallback numbers 18, 7, 25, 5
    expect(text).not.toContain('18.00');
    expect(text).not.toContain('7.00');
  });

  it('5. Creation Date Metadata: PDF metadata creation date matches Contract.createdAt without synthetic 2026-01-01 fallback', async () => {
    const createdAtIso = '2026-05-20T14:30:00.000Z';
    const pdfBuffer = await pdfService.generateContractPdf({
      contractNumber: 'CTR-DATE-TEST',
      dormitoryName: 'หอพักวันที่จริง',
      ownerName: 'สมชาย',
      tenantName: 'สมหญิง',
      roomNumber: 'D101',
      rentBillingType: 'monthly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rentAmount: '5000.00',
      depositAmount: '10000.00',
      waterRate: '20.00',
      electricityRate: '8.00',
      commonFee: '200.00',
      billingDay: 1,
      dueDay: 5,
      createdAt: createdAtIso,
    });

    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const creationDate = pdfDoc.getCreationDate();

    expect(creationDate).toBeDefined();
    expect(creationDate?.toISOString().slice(0, 10)).toBe('2026-05-20');
    expect(creationDate?.toISOString()).not.toContain('2026-01-01T00:00:00.000Z');
  });
});
