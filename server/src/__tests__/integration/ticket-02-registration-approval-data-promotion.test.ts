import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '../../db/prisma.js';
import { TenantRegistrationService } from '../../services/tenant-registration.service.js';

describe('Ticket 02: Registration Financial & Profile Data Promotion Integration Test', () => {
  const prisma = getPrismaClient();
  const regService = new TenantRegistrationService();

  const dormId = crypto.randomUUID();
  const buildingId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();

  beforeAll(async () => {
    // 1. Create owner user & dormitory
    await prisma.user.create({
      data: {
        id: ownerUserId,
        email: `owner-${Date.now()}@example.com`,
        emailNormalized: `owner-${Date.now()}@example.com`,
        name: 'เจ้าของหอพัก ทดสอบ Ticket 02',
        googleSubject: `g-sub-${Date.now()}-${Math.random()}`,
      },
    });

    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: 'หอพัก TheRICH Apartment ทดสอบ Ticket 02',
      },
    });

    await prisma.building.create({
      data: {
        id: buildingId,
        dormitoryId: dormId,
        name: 'อาคาร A',
        floorCount: 4,
        termMonths: 5,
      },
    });

    await prisma.room.create({
      data: {
        id: roomId,
        dormitoryId: dormId,
        buildingId,
        roomNumber: 'A-101',
        normalizedRoomNumber: 'A101',
        status: 'vacant',
        monthlyRent: 4000,
        monthlyDeposit: 4000,
        termRent: 17500,
        termDeposit: 2500,
        dailyDeposit: 500,
        depositAmount: 2500,
      },
    });

    await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'รอบกันยายน 2026',
        cycleCode: '2026-09',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
        billingDate: new Date('2026-09-25T00:00:00.000Z'),
        dueDate: new Date('2026-10-05T00:00:00.000Z'),
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: dormId } } });
      await prisma.bill.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenantVehicle.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenantCoOccupant.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.occupancy.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitory.deleteMany({ where: { id: dormId } });
      await prisma.user.deleteMany({ where: { id: ownerUserId } });
    } catch (e) {
      console.warn('Cleanup error:', e);
    }
  });

  it('promotes proposedRent = 0, contact email, multiple vehicles, structured pets, and ID card to Tenant & Contract', async () => {
    const regReqId = crypto.randomUUID();
    const testEmail = `tenant-${Date.now()}@test.com`;

    // Create registration request with custom rent = 0, email, 2 vehicles, pets, and ID card
    await prisma.tenantRegistrationRequest.create({
      data: {
        id: regReqId,
        dormitoryId: dormId,
        requestedRoomId: roomId,
        firstName: 'ภพสดนพนน',
        lastName: '-',
        phone: '0865989895',
        status: 'pending_owner_approval',
        acceptanceSnapshot: {
          prefix: 'นาย',
          firstName: 'ภพสดนพนน',
          lastName: '-',
          email: testEmail,
          phone: '0865989895',
          rentalType: 'TERM',
          rentalPlan: 'term',
          proposedRent: 0,
          proposedDeposit: 2500,
          startDate: '2026-09-01',
          endDate: '2027-01-01',
          durationMonths: 4,
          idCardImageUrl: 'id-cards/phoom-idcard-upload.jpg',
          vehicles: [
            { type: 'car', brand: 'Toyota', licensePlate: '1กข-1111' },
            { type: 'motorcycle', brand: 'Honda', licensePlate: 'Hondaaa' },
          ],
          pets: [
            { type: 'dog', name: 'บัดดี้' },
            { type: 'cat', name: 'ไมโล' },
          ],
          coOccupants: [
            { name: 'ทดสอบ', phone: '0656565656', relationship: 'ผู้พักร่วม' },
            { name: 'เทส', phone: '0431616161', relationship: 'ผู้พักร่วม' },
          ],
        },
      },
    });

    // Owner approves with rentAmount = 0
    const approvePayload = {
      roomId,
      rentalType: 'TERM',
      rentalPlan: 'term',
      startDate: '2026-09-01',
      endDate: '2027-01-01',
      durationMonths: 4,
      rentAmount: 0,
      depositAmount: 2500,
      requireTenantConfirmation: false,
    };

    const approveResult = await regService.approveRequest(regReqId, dormId, approvePayload, ownerUserId);
    expect(approveResult).toBeDefined();

    // 1. Verify Contract rent is 0 (not 17500)
    const contract = await prisma.contract.findFirst({
      where: { dormitoryId: dormId, roomId },
    });
    expect(contract).toBeDefined();
    expect(Number(contract!.rentAmount)).toBe(0);
    expect(Number(contract!.depositAmount)).toBe(2500);

    // 2. Verify Tenant profile has email
    const tenant = await prisma.tenant.findFirst({
      where: { dormitoryId: dormId, phone: '0865989895' },
      include: {
        vehicles: true,
        coOccupants: true,
      },
    });
    expect(tenant).toBeDefined();
    expect(tenant!.email).toBe(testEmail);

    // 3. Verify ALL registered vehicles are preserved (2 vehicles, not 1)
    expect(tenant!.vehicles.length).toBe(2);
    const plates = tenant!.vehicles.map(v => v.licensePlate);
    expect(plates).toContain('1กข-1111');
    expect(plates).toContain('Hondaaa');

    // 4. Verify ID card document was promoted
    expect(tenant!.idCardObjectKey).toBe('id-cards/phoom-idcard-upload.jpg');

    // 5. Verify pets were normalized in petInfo
    expect(tenant!.petInfo).toBeDefined();
    const petData = tenant!.petInfo as any;
    expect(petData.pets?.length).toBe(2);
    expect(petData.hasPet).toBe(true);

    // 6. Verify co-occupants are active
    expect(tenant!.coOccupants.length).toBe(2);
  });
});
