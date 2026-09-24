import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentPdfService } from '../../services/document-pdf.service';
import { createTenantPortalRouter } from '../../routes/tenant-portal.routes';

const mockPrisma: any = vi.hoisted(() => {
  const mp: any = {
    $transaction: vi.fn(async (cb: any) => cb(mp)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    tenant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    contract: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    contractSnapshot: {
      findFirst: vi.fn(),
    },
    occupancy: {
      findMany: vi.fn(),
    },
    dailyStay: {
      findMany: vi.fn(),
    },
    tenantCoOccupant: {
      count: vi.fn(),
    },
    room: {
      findUnique: vi.fn(),
    },
    dormitoryPropertyDefaults: {
      findUnique: vi.fn(),
    },
    ownerSignature: {
      findFirst: vi.fn(),
    },
    dormitory: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
  return mp;
});

vi.mock('../../db/prisma', () => ({
  prisma: mockPrisma,
  getPrismaClient: () => mockPrisma,
}));

function getRouteHandler(router: any, method: string, path: string) {
  const layer = router.stack.find(
    (s: any) => s.route && s.route.path === path && s.route.methods[method.toLowerCase()]
  );
  if (!layer) throw new Error(`Route not found: ${method} ${path}`);
  const handlers = layer.route.stack.map((st: any) => st.handle);
  return handlers[handlers.length - 1];
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, val: any) {
      this.headers[key.toLowerCase()] = val;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const mockAuthContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  memberships: [
    {
      dormitoryId: 'dorm-1',
      status: 'active',
      roleCode: 'TENANT',
    },
  ],
};

describe('Card C1: Tenant Contract View, Snapshot Resolution & PDF Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.tenant.findMany.mockResolvedValue([
      {
        id: 'tenant-a',
        dormitoryId: 'dorm-1',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        nationalId: '1100100200301',
        phone: '0812345678',
        status: 'active',
      },
    ]);
    mockPrisma.contract.findMany.mockResolvedValue([
      {
        id: 'con-a-1',
        tenantId: 'tenant-a',
        dormitoryId: 'dorm-1',
        roomId: 'room-101',
        contractNumber: 'CT-2026-101',
        status: 'active',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-08-31T00:00:00.000Z'),
        durationMonths: 12,
        rentBillingType: 'monthly',
        rentAmount: 3500,
        depositAmount: 7000,
        advancePaymentAmount: 0,
        terms: 'ห้ามสูบบุหรี่ในห้องพัก',
        tenantSignature: 'sig-tenant-data',
        ownerSignature: null,
        signedByTenantAt: new Date('2026-09-01T10:00:00.000Z'),
        signedByOwnerAt: new Date('2026-09-01T11:00:00.000Z'),
      },
    ]);
    mockPrisma.occupancy.findMany.mockResolvedValue([]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([]);
    mockPrisma.room.findUnique.mockResolvedValue({ id: 'room-101', roomNumber: '101' });
    mockPrisma.dormitoryPropertyDefaults.findUnique.mockResolvedValue({ defaultTerms: 'กฎระเบียบมาตรฐาน' });
    mockPrisma.ownerSignature.findFirst.mockResolvedValue({ id: 'owner-sig-1', isCurrent: true, objectKey: 'sig-owner' });
  });

  it('C1-1: GET /contract resolves contractSnapshot (rent, deposit, exactRoomNumber), coOccupantsCount, and signature proxy URLs', async () => {
    mockPrisma.contractSnapshot.findFirst.mockResolvedValue({
      resolvedRent: 4200,
      resolvedDeposit: 8400,
      exactRoomNumber: 'A-101-SNAP',
      resolvedWaterRate: 20,
      resolvedElectricityRate: 7,
    });
    mockPrisma.tenantCoOccupant.count.mockResolvedValue(2);

    const tenantPortalRouter = createTenantPortalRouter();
    const handler = getRouteHandler(tenantPortalRouter, 'get', '/contract');
    const req: any = { query: {}, headers: {}, auth: mockAuthContext };
    const res = createMockRes();
    const next = vi.fn();

    await handler(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 'con-a-1',
      contractNumber: 'CT-2026-101',
      roomNumber: 'A-101-SNAP',
      rentAmount: '4200',
      depositAmount: '8400',
      waterRate: '20',
      electricityRate: '7',
      coOccupantsCount: 2,
      tenantSignature: '/api/v1/tenant-portal/contract/signatures/tenant',
      ownerSignature: '/api/v1/tenant-portal/contract/signatures/owner',
    });
  });

  it('C1-2: DocumentPdfService.generateContractPdf generates a valid PDF buffer with Thai contract details', async () => {
    const pdfService = new DocumentPdfService();
    const buffer = await pdfService.generateContractPdf({
      dormitoryName: 'หอพักทดสอบ ฮอร์พลัส',
      dormitoryAddress: '99 ถนนพหลโยธิน กรุงเทพฯ',
      dormitoryPhone: '081-234-5678',
      contractNumber: 'CT-2026-101',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      tenantName: 'สมชาย ใจดี',
      tenantCitizenId: '1100100200301',
      tenantPhone: '0812345678',
      roomNumber: '101',
      buildingName: 'อาคาร A',
      floor: 1,
      rentAmount: 3500,
      depositAmount: 7000,
      waterRate: 18,
      electricityRate: 8,
      terms: '1. ห้ามส่งเสียงดังหลัง 22.00 น.\n2. รักษาความสะอาด',
      ownerName: 'ผู้จัดการหอพัก',
      coOccupantsCount: 1,
      signedByTenantAt: '2026-09-01T10:00:00.000Z',
      signedByOwnerAt: '2026-09-01T11:00:00.000Z',
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 7).toString('ascii')).toBe('%PDF-1.');
  });

  it('C1-3: GET /contract and GET /contract/pdf reject cross-tenant contractId or tenantId with 403 FORBIDDEN', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue({
      id: 'con-a-1',
      tenantId: 'tenant-a',
      dormitoryId: 'dorm-1',
    });

    const tenantPortalRouter = createTenantPortalRouter();
    const contractHandler = getRouteHandler(tenantPortalRouter, 'get', '/contract');
    const pdfHandler = getRouteHandler(tenantPortalRouter, 'get', '/contract/pdf');

    // Attempt to pass another tenant's contractId on /contract
    const req1: any = { query: { contractId: 'con-other-tenant-999' }, headers: {}, auth: mockAuthContext };
    const res1 = createMockRes();
    await contractHandler(req1, res1, vi.fn());
    expect(res1.statusCode).toBe(403);
    expect(res1.body.error.code).toBe('FORBIDDEN');

    // Attempt to pass another tenant's contractId on /contract/pdf
    const req2: any = { query: { contractId: 'con-other-tenant-999' }, headers: {}, auth: mockAuthContext };
    const res2 = createMockRes();
    await pdfHandler(req2, res2, vi.fn());
    expect(res2.statusCode).toBe(403);
    expect(res2.body.error.code).toBe('FORBIDDEN');

    // Attempt to pass another tenantId on /contract/pdf
    const req3: any = { query: { tenantId: 'tenant-b-other' }, headers: {}, auth: mockAuthContext };
    const res3 = createMockRes();
    await pdfHandler(req3, res3, vi.fn());
    expect(res3.statusCode).toBe(403);
    expect(res3.body.error.code).toBe('FORBIDDEN');
  });
});
