/**
 * @license Apache-2.0
 * Ticket 01: Tenant Claim Access Grant & UUID Protection Integration Tests
 * Verifies that a tenant accessing via LINE OA Access Grant (synthetic userId `ag_user_<grant-uuid>`)
 * can claim a room without triggering UUID parsing errors, correctly links Tenant.lineFriendId,
 * enforces cardinality duplicate checks, and avoids invalid UUID operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '../../db/prisma.js';
import { TenantClaimService } from '../../services/tenant-claim.service.js';

describe('Ticket 01: Tenant Claim Access Grant UUID Protection', () => {
  const prisma = getPrismaClient();
  const tenantClaimService = new TenantClaimService(prisma);

  let dormitoryId: string;
  let buildingId: string;
  let roomId1: string;
  let roomId2: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let lineFriendId: string;
  let accessGrantId: string;
  let syntheticUserId: string;

  beforeAll(async () => {
    const stamp = Date.now();

    // 1. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm Claim AccessGrant Test ${stamp}`,
        status: 'active',
      },
    });
    dormitoryId = dorm.id;

    // 2. Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId,
        code: `B-${stamp}`,
        name: 'Building A',
        floorCount: 2,
        roomsPerFloor: 5,
      },
    });
    buildingId = building.id;

    // 3. Create Rooms
    const room1 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500.0,
        termDeposit: 5000.0,
        monthlyDeposit: 5000.0,
        dailyDeposit: 500.0,
      },
    });
    roomId1 = room1.id;

    const room2 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        roomType: 'standard',
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500.0,
        termDeposit: 5000.0,
        monthlyDeposit: 5000.0,
        dailyDeposit: 500.0,
      },
    });
    roomId2 = room2.id;

    // 4. Create Unlinked Tenants
    const tenant1 = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T101-${stamp}`,
        firstName: 'สมศักดิ์',
        lastName: 'รักสงบ',
        displayName: 'สมศักดิ์ รักสงบ',
        phone: '0812345678',
        status: 'active',
        linkedUserId: null,
        lineFriendId: null,
      },
    });
    tenant1Id = tenant1.id;

    const tenant2 = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T102-${stamp}`,
        firstName: 'สมศักดิ์',
        lastName: 'รักสงบ',
        displayName: 'สมศักดิ์ รักสงบ',
        phone: '0812345678',
        status: 'active',
        linkedUserId: null,
        lineFriendId: null,
      },
    });
    tenant2Id = tenant2.id;

    // 5. Create Active Occupancies for the rooms
    await prisma.occupancy.create({
      data: {
        dormitoryId,
        roomId: roomId1,
        tenantId: tenant1Id,
        status: 'ACTIVE',
      },
    });

    await prisma.occupancy.create({
      data: {
        dormitoryId,
        roomId: roomId2,
        tenantId: tenant2Id,
        status: 'ACTIVE',
      },
    });

    // 6. Create LINE Friend & Access Grant within RLS dormitory context
    const { lineFriend, grant } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;

      const lf = await tx.dormitoryLineFriend.create({
        data: {
          dormitoryId,
          lineUserIdHash: crypto.randomBytes(16).toString('hex'),
          lineUserIdEncrypted: 'enc_line_user_id',
          displayName: 'LINE User Somsak',
          friendStatus: 'FOLLOWING',
        },
      });

      const ag = await tx.dormitoryAccessGrant.create({
        data: {
          dormitoryId,
          lineFriendId: lf.id,
          tokenHash: crypto.randomBytes(32).toString('hex'),
          roleCode: 'TENANT',
          status: 'ACTIVE',
          createdByPrincipal: 'system_test',
        },
      });

      return { lineFriend: lf, grant: ag };
    });

    lineFriendId = lineFriend.id;
    accessGrantId = grant.id;
    syntheticUserId = `ag_user_${accessGrantId}`;
  });

  afterAll(async () => {
    // Clean up
    if (dormitoryId) {
      await prisma.occupancy.deleteMany({ where: { dormitoryId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId } });
      await prisma.room.deleteMany({ where: { dormitoryId } });
      await prisma.building.deleteMany({ where: { dormitoryId } });
      await prisma.dormitoryAccessGrant.deleteMany({ where: { dormitoryId } });
      await prisma.dormitoryLineFriend.deleteMany({ where: { dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId } });
      await prisma.role.deleteMany({ where: { dormitoryId } });
      await prisma.dormitory.delete({ where: { id: dormitoryId } }).catch(() => {});
    }
  });

  it('claims tenant successfully when userId is synthetic ag_user_<grant-uuid>', async () => {
    const result = await tenantClaimService.claimTenant(
      {
        dormitoryId,
        roomId: roomId1,
        claimInput: 'สมศักดิ์ รักสงบ',
      },
      syntheticUserId
    );

    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(tenant1Id);

    // Verify DB: Tenant.lineFriendId is updated to the grant's LINE Friend ID
    const updatedTenant = await prisma.tenant.findUnique({
      where: { id: tenant1Id },
    });
    expect(updatedTenant?.lineFriendId).toBe(lineFriendId);

    // Verify DB: Tenant.linkedUserId remains null (since syntheticUserId is not a real UUID)
    expect(updatedTenant?.linkedUserId).toBeNull();

    // Verify DB: DormitoryMember was NOT created with syntheticUserId
    const members = await prisma.dormitoryMember.findMany({
      where: {
        dormitoryId,
      },
    });
    expect(members.some((m) => (m as any).userId === syntheticUserId)).toBe(false);
  });

  it('prevents duplicate claim across rooms for same Access Grant lineFriendId without allowAdditionalRoom', async () => {
    // Somsak attempts to claim room 102 as well using the same Access Grant
    await expect(
      tenantClaimService.claimTenant(
        {
          dormitoryId,
          roomId: roomId2,
          claimInput: 'สมศักดิ์ รักสงบ',
          allowAdditionalRoom: false,
        },
        syntheticUserId
      )
    ).rejects.toMatchObject({
      code: 'CLAIM_USER_ALREADY_LINKED_IN_DORM',
    });

    // Verify room 102 tenant is still unlinked
    const t2 = await prisma.tenant.findUnique({ where: { id: tenant2Id } });
    expect(t2?.lineFriendId).toBeNull();
    expect(t2?.linkedUserId).toBeNull();
  });

  it('allows additional room claim for same Access Grant when allowAdditionalRoom is true', async () => {
    const result = await tenantClaimService.claimTenant(
      {
        dormitoryId,
        roomId: roomId2,
        claimInput: 'สมศักดิ์ รักสงบ',
        allowAdditionalRoom: true,
      },
      syntheticUserId
    );

    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(tenant2Id);

    // Verify room 102 tenant is now also linked to the same LINE Friend
    const updatedTenant2 = await prisma.tenant.findUnique({
      where: { id: tenant2Id },
    });
    expect(updatedTenant2?.lineFriendId).toBe(lineFriendId);
    expect(updatedTenant2?.linkedUserId).toBeNull();
  });

  it('supports standard UUID userId: links linkedUserId and creates DormitoryMember TENANT', async () => {
    // Create a regular user
    const stamp = Date.now();
    const regularUser = await prisma.user.create({
      data: {
        email: `regular_tenant_${stamp}@example.com`,
        emailNormalized: `regular_tenant_${stamp}@example.com`,
        name: 'นายสมปอง ดองใจ',
        googleSubject: `goog_reg_${stamp}`,
      },
    });

    // Create room 103 & tenant 3
    const room3 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: '103',
        normalizedRoomNumber: '103',
        roomType: 'standard',
        floor: 1,
        status: 'occupied',
        monthlyRent: 3500.0,
        termDeposit: 5000.0,
        monthlyDeposit: 5000.0,
        dailyDeposit: 500.0,
      },
    });

    const tenant3 = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T103-${stamp}`,
        firstName: 'สมปอง',
        lastName: 'ดองใจ',
        displayName: 'สมปอง ดองใจ',
        phone: '0898765432',
        status: 'active',
        linkedUserId: null,
        lineFriendId: null,
      },
    });

    await prisma.occupancy.create({
      data: {
        dormitoryId,
        roomId: room3.id,
        tenantId: tenant3.id,
        status: 'ACTIVE',
      },
    });

    const result = await tenantClaimService.claimTenant(
      {
        dormitoryId,
        roomId: room3.id,
        claimInput: 'สมปอง ดองใจ',
      },
      regularUser.id
    );

    expect(result.success).toBe(true);
    expect(result.tenantId).toBe(tenant3.id);

    // Verify DB: Tenant.linkedUserId is set to regularUser.id
    const updatedTenant3 = await prisma.tenant.findUnique({
      where: { id: tenant3.id },
    });
    expect(updatedTenant3?.linkedUserId).toBe(regularUser.id);
    expect(updatedTenant3?.lineFriendId).toBeNull();

    // Verify DB: DormitoryMember was created for regularUser
    const member = await prisma.dormitoryMember.findUnique({
      where: {
        user_dormitory_unique: {
          userId: regularUser.id,
          dormitoryId,
        },
      },
      include: { role: true },
    });
    expect(member).not.toBeNull();
    expect(member?.role.code).toBe('TENANT');
    expect(member?.status).toBe('active');
  });
});
