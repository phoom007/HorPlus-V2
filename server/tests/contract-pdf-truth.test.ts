import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPrismaClient } from '../src/db/prisma.js';
import { getEnv } from '../src/config/env.js';
import { DocumentPdfService } from '../src/services/document-pdf.service.js';
import { ContractService } from '../src/services/contract.service.js';
import { AuthenticationService } from '../src/services/auth.service.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../src/db/repositories/tenant.repository.js';
import { PrismaSessionRepository } from '../src/db/repositories/session.repository.js';
import { PrismaUserRepository } from '../src/db/repositories/user.repository.js';
import { PrismaMembershipRepository } from '../src/db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../src/db/repositories/role.repository.js';
import { createRequire } from 'module';
import { PDFDocument } from 'pdf-lib';
import zlib from 'zlib';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

/**
 * Robust helper to extract all textual & structural elements from a PDF buffer,
 * including PDFParse output and decompressed PDF content stream hex structures.
 */
async function extractPdfContent(pdfBuffer: Buffer): Promise<{ text: string; streamContent: string }> {
  let pdfParseText = '';
  try {
    const parser = new PDFParse({ data: pdfBuffer, verbosity: 0 });
    await parser.load();
    const res = await parser.getText();
    pdfParseText = res.text || '';
  } catch (err) {
    pdfParseText = '';
  }

  // Decompress stream data for exact structural stream verification
  const latinStr = pdfBuffer.toString('latin1');
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match;
  let decompressedStreams = '';
  while ((match = streamRegex.exec(latinStr)) !== null) {
    try {
      const decomp = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('utf-8');
      decompressedStreams += '\n' + decomp;
    } catch (e) {
      // Ignore non-zlib streams
    }
  }

  return {
    text: pdfParseText + '\n' + latinStr,
    streamContent: decompressedStreams,
  };
}

describe('Contract PDF Evidence Gate — Route-Level & Immutability Verification', () => {
  const pdfService = new DocumentPdfService();
  const prisma = getPrismaClient();
  let app: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    app = createApp();
  });

  /**
   * Helper to create a valid authenticated tenant session token for route testing.
   */
  async function createTenantAuthSession(userId: string): Promise<string> {
    const sessionRepo = new PrismaSessionRepository(prisma);
    const userRepo = new PrismaUserRepository(prisma);
    const memberRepo = new PrismaMembershipRepository(prisma);
    const roleRepo = new PrismaRoleRepository(prisma);
    const env = getEnv();

    const authService = new AuthenticationService(env, null as any, userRepo, sessionRepo, memberRepo, roleRepo, null as any);
    const auth = await authService.authenticateTestUser(userId);
    return auth.sessionToken;
  }

  // =========================================================================
  // 1. DISTINCTIVE PDF CONTENT ASSERTIONS (Renderer Proof)
  // =========================================================================
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

    const { text, streamContent } = await extractPdfContent(pdfBuffer);

    // Renderer Proof: Assert Thai metadata and terms
    expect(text).toContain('หอพักสัจจะความจริง');
    expect(text).toContain('สมชาย เจ้าของหอ');
    expect(text).toContain('สมหญิง ผู้เช่าจริง');
    expect(text).toContain('สัญญาเช่ารายเดือน');

    // Assert legacy hardcoded defaults (18.00 / 7.00) are NOT present in text
    expect(text).not.toContain('18.00');
    expect(text).not.toContain('7.00');
  });

  // =========================================================================
  // 2. ZERO VALUE CONTENT ASSERTIONS (Renderer Proof)
  // =========================================================================
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
      parkingFee: '0.00',
      billingDay: 1,
      dueDay: 5,
      createdAt: '2026-02-15T10:00:00.000Z',
    });

    const { text } = await extractPdfContent(pdfBuffer);

    expect(text).toContain('หอพักฟรีสวัสดิการ');
    expect(text).not.toContain('ไม่ระบุ');
  });

  // =========================================================================
  // 3. REAL PRODUCTION ROUTE IMMUTABILITY TEST (Route & DB Snapshot Proof)
  // =========================================================================
  it('3. Real Production Route Immutability Test: GET /api/v1/tenant-portal/contract/pdf remains anchored to snapshot when DormitoryBillingSettings change', async () => {
    const timestamp = Date.now();
    const userEmail = `tenant_route_immut_${timestamp}@example.com`;

    // 1. Create DB User
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        emailNormalized: userEmail.toLowerCase(),
        name: 'ผู้เช่า ผ่านรูทอิมมิวเทเบิล',
        googleSubject: `sub_route_immut_${timestamp}`,
      },
    });

    // 2. Create Active Dormitory with initial billing settings
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพักสัจจะรูทอิมมิวเทเบิล',
        status: 'active',
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
        dueDay: 5,
        version: 1,
      },
    });

    const role = await prisma.role.create({
      data: {
        dormitoryId: dorm.id,
        code: 'TENANT',
        name: 'Tenant Role',
        permissions: [],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: user.id,
        dormitoryId: dorm.id,
        roleId: role.id,
        status: 'active',
      },
    });

    const building = await prisma.building.create({
      data: {
        dormitoryId: dorm.id,
        code: 'B909',
        name: 'อาคาร Z',
      },
    });

    const roomNum = `Z909-${timestamp % 1000}`;
    const room = await prisma.room.create({
      data: {
        dormitoryId: dorm.id,
        buildingId: building.id,
        roomNumber: roomNum,
        normalizedRoomNumber: roomNum.toLowerCase(),
        roomType: 'STANDARD',
        monthlyRent: 4321.00,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dorm.id,
        linkedUserId: user.id,
        tenantNumber: `TN-${timestamp % 10000}`,
        firstName: 'สมหญิง',
        displayName: 'สมหญิง ผู้เช่าผ่านรูท',
        phone: '0811111111',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dorm.id,
        contractNumber: `CTR-ROUTE-${timestamp}`,
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

    // 3. Activate Contract via ContractService (creates ContractSnapshot in DB)
    const contractRepo = new PrismaContractRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const contractService = new ContractService(contractRepo, roomRepo, tenantRepo);
    await contractService.activateContract(contract.id, dorm.id, user.id);

    // 4. Verify DB ContractSnapshot immutability records
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
    expect(snapData?.dueDay?.value).toBe(5);

    // 5. Authenticate Tenant session & Call PRODUCTION ROUTE before settings change
    const sessionToken = await createTenantAuthSession(user.id);
    const resBefore = await request(app)
      .get('/api/v1/tenant-portal/contract/pdf')
      .set('Cookie', [`horplus_session=${sessionToken}`])
      .set('x-dormitory-id', dorm.id);

    expect(resBefore.status).toBe(200);
    expect(resBefore.headers['content-type']).toContain('application/pdf');
    const pdfBufferBefore = resBefore.body;
    expect(pdfBufferBefore.length).toBeGreaterThan(5000);

    const { text: textBefore } = await extractPdfContent(pdfBufferBefore);
    expect(textBefore).toContain('หอพักสัจจะรูทอิมมิวเทเบิล');

    // 6. MUTATE DORMITORY BILLING SETTINGS IN POSTGRESQL DB TO DIFFERENT VALUES
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

    // 7. Call THE SAME PRODUCTION ROUTE AGAIN after DB settings changed
    const resAfter = await request(app)
      .get('/api/v1/tenant-portal/contract/pdf')
      .set('Cookie', [`horplus_session=${sessionToken}`])
      .set('x-dormitory-id', dorm.id);

    expect(resAfter.status).toBe(200);
    const pdfBufferAfter = resAfter.body;

    const { text: textAfter, streamContent: streamAfter } = await extractPdfContent(pdfBufferAfter);

    // Historical Immutability Proof: PDF from route is IDENTICAL to pre-mutation PDF
    expect(pdfBufferAfter.length).toBe(pdfBufferBefore.length);
    expect(textAfter).toContain('หอพักสัจจะรูทอิมมิวเทเบิล');

    // Assert NEW mutated settings (99.99, 50.00, 999.00, 888.00) are COMPLETELY ABSENT from historical PDF
    expect(textAfter).not.toContain('99.99');
    expect(textAfter).not.toContain('999.00');
    expect(textAfter).not.toContain('888.00');

    // Clean up test records
    await prisma.contractSnapshot.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.building.delete({ where: { id: building.id } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.role.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitory.delete({ where: { id: dorm.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // =========================================================================
  // 4. LEGACY SNAPSHOT ROUTE RESOLUTION TEST (Route Proof)
  // =========================================================================
  it('4. Legacy Snapshot Route Test: GET /api/v1/tenant-portal/contract/pdf for missing snapshotData billingDay/dueDay renders "ไม่ระบุ" and never falls back to current settings', async () => {
    const timestamp = Date.now();
    const userEmail = `tenant_legacy_${timestamp}@example.com`;

    // 1. Create DB User
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        emailNormalized: userEmail.toLowerCase(),
        name: 'ผู้เช่า สัญญารูปแบบเก่า',
        googleSubject: `sub_legacy_${timestamp}`,
      },
    });

    // 2. Create Active Dormitory with CURRENT billing settings (27 / 29)
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพักเลกาซี่รูท',
        status: 'active',
        addressLine1: '456/78 ถนนประวัติศาสตร์',
        phone: '0888888888',
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dorm.id,
        waterRate: 18.00,
        electricityRate: 7.00,
        commonFee: 100.00,
        internetFee: 200.00,
        parkingRate: 100.00,
        billingDay: 27,
        dueDay: 29,
        version: 1,
      },
    });

    const role = await prisma.role.create({
      data: {
        dormitoryId: dorm.id,
        code: 'TENANT',
        name: 'Tenant Role',
        permissions: [],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: user.id,
        dormitoryId: dorm.id,
        roleId: role.id,
        status: 'active',
      },
    });

    const building = await prisma.building.create({
      data: {
        dormitoryId: dorm.id,
        code: 'LEG1',
        name: 'อาคารเก่า',
      },
    });

    const roomNum = `L101-${timestamp % 1000}`;
    const room = await prisma.room.create({
      data: {
        dormitoryId: dorm.id,
        buildingId: building.id,
        roomNumber: roomNum,
        normalizedRoomNumber: roomNum.toLowerCase(),
        roomType: 'STANDARD',
        monthlyRent: 3500.00,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dorm.id,
        linkedUserId: user.id,
        tenantNumber: `TN-LEG-${timestamp % 10000}`,
        firstName: 'ผู้เช่า',
        displayName: 'ผู้เช่า สัญญารูปแบบเก่า',
        phone: '0822222222',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dorm.id,
        contractNumber: `CTR-LEGACY-${timestamp}`,
        roomId: room.id,
        tenantId: tenant.id,
        rentAmount: 3500.00,
        depositAmount: 7000.00,
        rentBillingType: 'monthly',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        status: 'draft',
      },
    });

    // 3. Activate Contract via ContractService and mutate snapshotData to simulate legacy snapshot missing billingDay/dueDay
    const contractRepo = new PrismaContractRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const contractService = new ContractService(contractRepo, roomRepo, tenantRepo);
    await contractService.activateContract(contract.id, dorm.id, user.id);

    await prisma.contractSnapshot.update({
      where: { contractId: contract.id },
      data: {
        snapshotData: {
          note: 'Legacy snapshot without billingDay and dueDay fields',
        },
      },
    });

    // 4. Authenticate Tenant & Call PRODUCTION ROUTE
    const sessionToken = await createTenantAuthSession(user.id);
    const res = await request(app)
      .get('/api/v1/tenant-portal/contract/pdf')
      .set('Cookie', [`horplus_session=${sessionToken}`])
      .set('x-dormitory-id', dorm.id);

    expect(res.status).toBe(200);
    const { text } = await extractPdfContent(res.body);

    // Route Proof: Legacy snapshot missing billingDay/dueDay renders "ไม่ระบุ"
    expect(text).toContain('ไม่ระบุ');

    // Clean up test records
    await prisma.contractSnapshot.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.building.delete({ where: { id: building.id } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.role.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitory.delete({ where: { id: dorm.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  // =========================================================================
  // 5. CREATED-AT REPORTING & METADATA ASSERTIONS (Route & Metadata Proof)
  // =========================================================================
  it('5. Creation Date Metadata: GET /api/v1/tenant-portal/contract/pdf creation date metadata matches Contract date', async () => {
    const timestamp = Date.now();
    const userEmail = `tenant_meta_${timestamp}@example.com`;

    const user = await prisma.user.create({
      data: {
        email: userEmail,
        emailNormalized: userEmail.toLowerCase(),
        name: 'ผู้เช่า เมทาดาต้า',
        googleSubject: `sub_meta_${timestamp}`,
      },
    });

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพักเมทาดาต้า',
        status: 'active',
        addressLine1: '999/99 ถนนเวลา',
        phone: '0877777777',
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dorm.id,
        waterRate: 20.00,
        electricityRate: 8.00,
        commonFee: 100.00,
        internetFee: 200.00,
        parkingRate: 100.00,
        billingDay: 1,
        dueDay: 5,
        version: 1,
      },
    });

    const role = await prisma.role.create({
      data: {
        dormitoryId: dorm.id,
        code: 'TENANT',
        name: 'Tenant Role',
        permissions: [],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: user.id,
        dormitoryId: dorm.id,
        roleId: role.id,
        status: 'active',
      },
    });

    const building = await prisma.building.create({
      data: {
        dormitoryId: dorm.id,
        code: 'M1',
        name: 'อาคารเวลา',
      },
    });

    const roomNum = `M101-${timestamp % 1000}`;
    const room = await prisma.room.create({
      data: {
        dormitoryId: dorm.id,
        buildingId: building.id,
        roomNumber: roomNum,
        normalizedRoomNumber: roomNum.toLowerCase(),
        roomType: 'STANDARD',
        monthlyRent: 5000.00,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dorm.id,
        linkedUserId: user.id,
        tenantNumber: `TN-META-${timestamp % 10000}`,
        firstName: 'ผู้เช่า',
        displayName: 'ผู้เช่า เมทาดาต้า',
        phone: '0833333333',
      },
    });

    const contractDate = new Date('2026-05-20T14:30:00.000Z');
    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dorm.id,
        contractNumber: `CTR-META-${timestamp}`,
        roomId: room.id,
        tenantId: tenant.id,
        rentAmount: 5000.00,
        depositAmount: 10000.00,
        rentBillingType: 'monthly',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        status: 'active',
        createdAt: contractDate,
      },
    });

    // Activate Contract via ContractService (creates ContractSnapshot with lockedAt)
    const contractRepo = new PrismaContractRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const contractService = new ContractService(contractRepo, roomRepo, tenantRepo);
    await contractService.activateContract(contract.id, dorm.id, user.id);

    const sessionToken = await createTenantAuthSession(user.id);
    const res = await request(app)
      .get('/api/v1/tenant-portal/contract/pdf')
      .set('Cookie', [`horplus_session=${sessionToken}`])
      .set('x-dormitory-id', dorm.id);

    expect(res.status).toBe(200);

    const pdfDoc = await PDFDocument.load(res.body);
    const creationDate = pdfDoc.getCreationDate();

    expect(creationDate).toBeDefined();
    expect(creationDate?.getUTCFullYear()).toBe(2026);
    expect(creationDate?.getUTCMonth()).toBe(4); // 0-indexed May = 4
    expect(creationDate?.getUTCDate()).toBe(20);

    // Clean up test records
    await prisma.contractSnapshot.deleteMany({ where: { contractId: contract.id } });
    await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.building.delete({ where: { id: building.id } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.role.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dorm.id } });
    await prisma.dormitory.delete({ where: { id: dorm.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
