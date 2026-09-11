import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { getPrismaClient } from '../db/prisma.js';
import { createApp } from '../app.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getEnv, resetCachedEnv } from '../config/env.js';
import { PrismaUserRepository } from '../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../db/repositories/role.repository.js';
import { PrismaTenantRepository } from '../db/repositories/tenant.repository.js';
import { processAndSecureTenantDocument } from '../services/image-security.service.js';
import { tenantRegistrationService } from '../services/tenant-registration.service.js';
import { LocalStorageProvider, getCanonicalSignatureStorageDir } from '../services/signature-storage.service.js';

describe('Tenant Phase 3 Step 3C.5B: Security Boundary & Authority Tests', () => {
  const prisma = getPrismaClient();
  const tenantRepo = new PrismaTenantRepository(prisma);
  let app: any;
  let authService: any;

  let ownerUserId: string;
  let dormId: string;
  let buildingId: string;
  let roomId: string;
  let sessionCookie: string;
  let csrfToken: string;

  // 1x1 valid PNG buffer
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  let validPdfBuffer: Buffer;
  const createdRegistrationIds: string[] = [];
  const createdTenantIds: string[] = [];
  const createdContractIds: string[] = [];
  const createdDailyStayIds: string[] = [];
  const createdObjectKeys: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    // Create a real valid PDF buffer using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 400]);
    page.drawText('Thai Citizen ID Document Verification');
    const pdfBytes = await pdfDoc.save();
    validPdfBuffer = Buffer.from(pdfBytes);

    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {}, logSecurityEvent: async () => {} } as any;

    authService = new AuthenticationService(
      getEnv(),
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService
    );

    app = createApp({ customAuthService: authService, forcePrisma: true });

    // Setup Owner and Dormitory
    const owner = await prisma.user.create({
      data: {
        googleSubject: `sub-step3c5b-${Date.now()}`,
        email: `owner-step3c5b-${Date.now()}@example.com`,
        emailNormalized: `owner-step3c5b-${Date.now()}@example.com`.toLowerCase(),
        name: 'Step 3C5B Owner',
        status: 'active',
      },
    });
    ownerUserId = owner.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: `Step 3C5B Dorm ${Date.now()}`,
        addressLine1: '888 Security Road',
        status: 'active',
        createdByUserId: ownerUserId,
      },
    });
    dormId = dorm.id;

    const role = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId: dormId,
        roleId: role.id,
        status: 'active',
      },
    });

    const auth = await authService.authenticateTestUser(ownerUserId);
    sessionCookie = `horplus_session=${auth.sessionToken}; horplus_csrf=${auth.csrfToken}`;
    csrfToken = auth.csrfToken;

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Security Building',
        monthlyDeposit: 5000,
        termDeposit: 10000,
        dailyDeposit: 500,
        depositAmount: 5000,
      },
    });
    buildingId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: buildingId,
        roomNumber: 'SEC-101',
        normalizedRoomNumber: 'SEC-101',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
        depositAmount: 5000,
        monthlyDeposit: 5000,
        termDeposit: 10000,
        dailyDeposit: 500,
      },
    });
    roomId = room.id;

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        dueDay: 5,
      },
    });

    await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'กันยายน 2026',
        cycleCode: '2026-09',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
        billingDate: new Date('2026-09-25T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        status: 'OPEN',
      },
    });
  });

  afterAll(async () => {
    try {
      const storage = new LocalStorageProvider();
      for (const key of createdObjectKeys) {
        await storage.deleteFile(key).catch(() => {});
      }
      for (const id of createdDailyStayIds) {
        await prisma.dailyStay.deleteMany({ where: { id } }).catch(() => {});
      }
      for (const id of createdContractIds) {
        await prisma.contract.deleteMany({ where: { id } }).catch(() => {});
      }
      for (const id of createdRegistrationIds) {
        await prisma.tenantRegistrationRequest.deleteMany({ where: { id } }).catch(() => {});
      }
      for (const id of createdTenantIds) {
        await prisma.occupancy.deleteMany({ where: { tenantId: id } }).catch(() => {});
        await prisma.tenant.deleteMany({ where: { id } }).catch(() => {});
      }
      if (roomId) await prisma.room.deleteMany({ where: { id: roomId } }).catch(() => {});
      if (buildingId) await prisma.building.deleteMany({ where: { id: buildingId } }).catch(() => {});
      if (dormId) {
        await prisma.bill.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
        await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
        await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
        await prisma.ownerSignature.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
        await prisma.role.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
        await prisma.dormitory.deleteMany({ where: { id: dormId } }).catch(() => {});
      }
      if (ownerUserId) {
        await prisma.session.deleteMany({ where: { userId: ownerUserId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: ownerUserId } }).catch(() => {});
      }
    } catch {}
  });

  describe('Part 1: Document Security Pipeline (`processAndSecureTenantDocument`)', () => {
    it('1.1 Accepts valid PNG and converts cleanly to sanitized WebP', async () => {
      const result = await processAndSecureTenantDocument(validPngBuffer);
      expect(result.mimeType).toBe('image/webp');
      expect(result.extension).toBe('.webp');
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('1.2 Accepts valid PDF and returns clean application/pdf binary with page count', async () => {
      const result = await processAndSecureTenantDocument(validPdfBuffer);
      expect(result.mimeType).toBe('application/pdf');
      expect(result.extension).toBe('.pdf');
      expect(result.pageCount).toBe(1);
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('1.3 Rejects malicious PDF containing /JavaScript active content', async () => {
      const maliciousPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /JavaScript 3 0 R >> >>\nendobj\n%%EOF');
      await expect(processAndSecureTenantDocument(maliciousPdf)).rejects.toThrow(/disallowed active content/i);
    });

    it('1.4 Rejects malicious PDF containing /Launch active content', async () => {
      const maliciousPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Action /S /Launch >>\nendobj\n%%EOF');
      await expect(processAndSecureTenantDocument(maliciousPdf)).rejects.toThrow(/disallowed active content/i);
    });

    it('1.5 Rejects malicious PDF containing /EmbeddedFiles active content', async () => {
      const maliciousPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /EmbeddedFiles 2 0 R >>\nendobj\n%%EOF');
      await expect(processAndSecureTenantDocument(maliciousPdf)).rejects.toThrow(/disallowed active content/i);
    });

    it('1.6 Rejects corrupted/unparseable PDF', async () => {
      const corruptPdf = Buffer.from('%PDF-1.4 corrupted invalid content not a real pdf body');
      await expect(processAndSecureTenantDocument(corruptPdf)).rejects.toThrow(/Failed to parse PDF document/i);
    });

    it('1.7 Rejects PDF exceeding maximum allowable page count (>10 pages)', async () => {
      const multiPageDoc = await PDFDocument.create();
      for (let i = 0; i < 11; i++) {
        multiPageDoc.addPage([100, 100]);
      }
      const multiPageBytes = await multiPageDoc.save();
      const multiPageBuffer = Buffer.from(multiPageBytes);

      await expect(processAndSecureTenantDocument(multiPageBuffer)).rejects.toThrow(/exceeds maximum allowable page count/i);
    });

    it('1.8 Rejects file exceeding 5MB limit', async () => {
      const hugeBuffer = Buffer.alloc(5 * 1024 * 1024 + 10);
      await expect(processAndSecureTenantDocument(hugeBuffer)).rejects.toThrow(/exceeds maximum limit of 5 MB/i);
    });

    it('1.9 Rejects disguised non-document vectors (SVG, HTML, XML, EXE)', async () => {
      const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      await expect(processAndSecureTenantDocument(svgBuffer)).rejects.toThrow(/Unsupported or invalid file format/i);

      const htmlBuffer = Buffer.from('<html><body><script>malware()</script></body></html>');
      await expect(processAndSecureTenantDocument(htmlBuffer)).rejects.toThrow(/Unsupported or invalid file format/i);

      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
      await expect(processAndSecureTenantDocument(exeBuffer)).rejects.toThrow(/Unsupported or invalid file format/i);
    });
  });

  describe('Part 2: Pending Registration Identity Document API & Adoption on Approval', () => {
    let registrationId: string;

    beforeAll(async () => {
      // Create a pending registration request
      const reg = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId: dormId,
          requestedRoomId: roomId,
          firstName: 'สมบูรณ์',
          lastName: 'พร้อมตรวจ',
          phone: '0819998877',
          status: 'pending_owner_approval',
          submittedAt: new Date(),
          acceptanceSnapshot: {
            rentalPlan: 'monthly',
            proposedRent: 4500,
            proposedDeposit: 5000,
            durationMonths: 12,
            citizenId: '1-1004-99999-99-9',
          },
        },
      });
      registrationId = reg.id;
      createdRegistrationIds.push(registrationId);
    });

    it('2.1 Rejects unauthenticated upload to pending registration document endpoint', async () => {
      const res = await request(app)
        .post(`/api/v1/tenant-registrations/${registrationId}/identity-document`)
        .set('X-Dormitory-Id', dormId)
        .attach('file', validPdfBuffer, 'id_card.pdf');

      expect(res.status).toBe(401);
    });

    it('2.2 Uploads valid PDF identity document to pending registration', async () => {
      const res = await request(app)
        .post(`/api/v1/tenant-registrations/${registrationId}/identity-document`)
        .set('Cookie', [sessionCookie])
        .set('X-Dormitory-Id', dormId)
        .set('x-csrf-token', csrfToken)
        .attach('file', validPdfBuffer, 'id_card.pdf');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('requestId', registrationId);
      expect(res.body.data).toHaveProperty('hasIdentityDocument', true);
      expect(res.body.data).toHaveProperty('mimeType', 'application/pdf');
      expect(res.body.data).toHaveProperty('extension', '.pdf');
      expect(res.body.data).toHaveProperty('objectKey');

      createdObjectKeys.push(res.body.data.objectKey);

      // Verify acceptanceSnapshot was updated with document metadata
      const regInDb = await prisma.tenantRegistrationRequest.findUnique({
        where: { id: registrationId },
      });
      const snap = regInDb?.acceptanceSnapshot as any;
      expect(snap.idCardDocument).toBeDefined();
      expect(snap.idCardDocument.mimeType).toBe('application/pdf');
      expect(snap.idCardDocument.objectKey).toBe(res.body.data.objectKey);
    });

    it('2.3 Streams identity document with application/pdf and security headers', async () => {
      const res = await request(app)
        .get(`/api/v1/tenant-registrations/${registrationId}/identity-document`)
        .set('Cookie', [sessionCookie])
        .set('X-Dormitory-Id', dormId);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('2.4 Approving pending registration promotes identity document to canonical Tenant record', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/tenant-registrations/${registrationId}/approve`)
        .set('Cookie', [sessionCookie])
        .set('X-Dormitory-Id', dormId)
        .set('x-csrf-token', csrfToken)
        .send({
          roomId: roomId,
          startDate: '2026-09-01',
          endDate: '2027-08-31',
          durationMonths: 12,
          rentAmount: 4500,
          depositAmount: 5000,
          advancePaymentAmount: 0,
          rentalType: 'MONTHLY',
          requireTenantConfirmation: false,
        });

      if (approveRes.status !== 200) {
        console.log('409 BODY:', approveRes.status, approveRes.body);
      }
      expect(approveRes.status).toBe(200);
      const approvedTenantId = approveRes.body.data.tenant.id;
      createdTenantIds.push(approvedTenantId);
      if (approveRes.body.data.contractId) {
        createdContractIds.push(approveRes.body.data.contractId);
      }

      // Check that canonical Tenant in database inherited idCardObjectKey and metadata
      const canonicalTenant = await prisma.tenant.findUnique({
        where: { id: approvedTenantId },
      });
      expect(canonicalTenant).not.toBeNull();
      expect(canonicalTenant?.idCardObjectKey).toBeDefined();
      expect(canonicalTenant?.idCardObjectKey).toMatch(/identity-documents\//);
      expect(canonicalTenant?.idCardMimeType).toBe('application/pdf');

      // Check that GET /api/v1/tenants/:id/identity-document streams the promoted document
      const streamRes = await request(app)
        .get(`/api/v1/tenants/${approvedTenantId}/identity-document`)
        .set('Cookie', [sessionCookie])
        .set('X-Dormitory-Id', dormId);

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toContain('application/pdf');
      expect(streamRes.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('Part 3: Historical Rental Type Authority & Lifecycles', () => {
    it('3.1 Accurately identifies pure daily tenant without contract', async () => {
      // Create a tenant with only DailyStay
      const dailyTenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `TDAY-${Date.now().toString().slice(-4)}`,
          firstName: 'วันชัย',
          lastName: 'รายวันแท้',
          displayName: 'วันชัย รายวันแท้',
          phone: '0891112233',
          status: 'active',
        },
      });
      createdTenantIds.push(dailyTenant.id);

      const stay = await prisma.dailyStay.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: dailyTenant.id,
          requestSource: 'WALK_IN',
          applicantFullName: 'วันชัย รายวันแท้',
          applicantPhone: '0891112233',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-05'),
          status: 'ACTIVE',
          inclusiveDayCount: 4,
          dailyRateAmount: 500,
          totalRentAmount: 2000,
          depositAmount: 500,
        },
      });
      createdDailyStayIds.push(stay.id);

      const found = await tenantRepo.findById(dailyTenant.id, dormId);
      expect(found).not.toBeNull();
      expect(found?.rentalType).toBe('DAILY');
    });

    it('3.2 Correctly resolves later Monthly contract when tenant had earlier Daily stay (no historical overwrite)', async () => {
      // Create a tenant with past daily stay from Jan 2026, but later active Monthly contract from Feb 2026
      const mixedTenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `TMIX-${Date.now().toString().slice(-4)}`,
          firstName: 'มานะ',
          lastName: 'เปลี่ยนเป็นรายเดือน',
          displayName: 'มานะ เปลี่ยนเป็นรายเดือน',
          phone: '0892223344',
          status: 'active',
        },
      });
      createdTenantIds.push(mixedTenant.id);

      // Past daily stay in Jan
      const pastStay = await prisma.dailyStay.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: mixedTenant.id,
          requestSource: 'WALK_IN',
          applicantFullName: 'มานะ เปลี่ยนเป็นรายเดือน',
          applicantPhone: '0892223344',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-01-05'),
          status: 'CHECKED_OUT',
          inclusiveDayCount: 4,
          dailyRateAmount: 500,
          totalRentAmount: 2000,
          depositAmount: 500,
        },
      });
      createdDailyStayIds.push(pastStay.id);

      // Later monthly contract in Feb - Dec
      const laterContract = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: mixedTenant.id,
          contractNumber: `CTR-MIX-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-02-01'),
          endDate: new Date('2026-12-31'),
          durationMonths: 11,
          rentAmount: 4500,
          depositAmount: 5000,
        },
      });
      createdContractIds.push(laterContract.id);

      const found = await tenantRepo.findById(mixedTenant.id, dormId);
      expect(found).not.toBeNull();
      // Must resolve to monthly contract, NOT daily!
      expect(found?.rentalType).toBe('MONTHLY');
      expect(found?.rentalPlan).toBe('monthly');
      expect(found?.requestedDurationMonths).toBe(11);
      expect(found?.roomId).toBe(roomId);
    });
  });

  describe('Part 4: Owner Signature Presentation & Historical Fallback', () => {
    let sigFileName: string;
    let contractWithFrozenSigId: string;
    let contractHistoricalNullSigId: string;

    beforeAll(async () => {
      const storageDir = getCanonicalSignatureStorageDir();
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      sigFileName = `owner-sig-test-${Date.now()}.png`;
      fs.writeFileSync(path.join(storageDir, sigFileName), validPngBuffer);

      // Create Settings current owner signature for dormitory
      await prisma.ownerSignature.create({
        data: {
          dormitory: { connect: { id: dormId } },
          objectKey: sigFileName,
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          mimeType: 'image/png',
          byteSize: validPngBuffer.length,
          isCurrent: true,
          signedBy: { connect: { id: ownerUserId } },
        },
      });

      // Tenant for signature tests
      const sigTenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `TSIGTEST-${Date.now().toString().slice(-4)}`,
          firstName: 'สิทธิชัย',
          lastName: 'ลายเซ็นต์',
          displayName: 'สิทธิชัย ลายเซ็นต์',
          phone: '0815556677',
          status: 'active',
        },
      });
      createdTenantIds.push(sigTenant.id);

      // Contract A: has frozen owner signature
      const contractA = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: sigTenant.id,
          contractNumber: `CTR-FROZEN-${Date.now()}`,
          status: 'active',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          durationMonths: 12,
          rentAmount: 4500,
          depositAmount: 5000,
          ownerSignature: sigFileName,
        },
      });
      contractWithFrozenSigId = contractA.id;
      createdContractIds.push(contractA.id);

      // Contract B: historical with ownerSignature: null
      const contractB = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: roomId,
          tenantId: sigTenant.id,
          contractNumber: `CTR-NULLSIG-${Date.now()}`,
          status: 'active',
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-12-31'),
          durationMonths: 12,
          rentAmount: 4500,
          depositAmount: 5000,
          ownerSignature: null,
        },
      });
      contractHistoricalNullSigId = contractB.id;
      createdContractIds.push(contractB.id);
    });

    afterAll(() => {
      const storageDir = getCanonicalSignatureStorageDir();
      const p = path.join(storageDir, sigFileName);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    });

    it('4.1 Streams frozen owner signature from contract', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${dormId}/contracts/${contractWithFrozenSigId}/owner-signature`)
        .set('Cookie', [sessionCookie])
        .set('X-Dormitory-Id', dormId);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.body).toEqual(validPngBuffer);
    });

    it('4.2 Falls back to Settings current owner signature for historical contract WITHOUT mutating DB', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${dormId}/contracts/${contractHistoricalNullSigId}/owner-signature`)
        .set('Cookie', [sessionCookie])
        .set('X-Dormitory-Id', dormId);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.body).toEqual(validPngBuffer);

      // Crucial: check that the database contract record was NOT mutated
      const contractInDb = await prisma.contract.findUnique({
        where: { id: contractHistoricalNullSigId },
      });
      expect(contractInDb?.ownerSignature).toBeNull();
    });
  });
});
