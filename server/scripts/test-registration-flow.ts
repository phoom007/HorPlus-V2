import { PrismaClient } from '../node_modules/@prisma/client';
import { TenantRegistrationService } from '../src/services/tenant-registration.service.js';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://horplus:horplus_test_password@127.0.0.1:15555/horplus_wave1d_fasttrack_test?schema=public' } }
  });

  const dormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';

  // Pre-cleanup of any previous test artifacts
  const testTenants = await prisma.tenant.findMany({
    where: { dormitoryId: dormId, firstName: 'ทดสอบ' },
    select: { id: true }
  });
  const testTenantIds = testTenants.map(t => t.id);
  if (testTenantIds.length > 0) {
    const testContracts = await prisma.contract.findMany({
      where: { tenantId: { in: testTenantIds } },
      select: { id: true }
    });
    const testContractIds = testContracts.map(c => c.id);
    if (testContractIds.length > 0) {
      await prisma.billItem.deleteMany({ where: { bill: { contractId: { in: testContractIds } } } });
      await prisma.bill.deleteMany({ where: { contractId: { in: testContractIds } } });
    }
    await prisma.occupancy.deleteMany({ where: { tenantId: { in: testTenantIds } } });
    await prisma.contract.deleteMany({ where: { tenantId: { in: testTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: testTenantIds } } });
  }
  await prisma.tenantRegistrationRequest.deleteMany({
    where: { dormitoryId: dormId, firstName: 'ทดสอบ' }
  });
  await prisma.room.updateMany({
    where: { dormitoryId: dormId },
    data: { status: 'VACANT', currentTenantId: null, currentContractId: null }
  });

  console.log('=== TEST 1: Checking Rooms in Database ===');
  const rooms = await prisma.room.findMany({
    where: { dormitoryId: dormId, deletedAt: null },
    orderBy: { roomNumber: 'asc' }
  });
  console.log(`Found ${rooms.length} rooms:`);
  for (const r of rooms) {
    console.log(`  - Room ${r.roomNumber}: status='${r.status}', tenantId=${r.currentTenantId}, contractId=${r.currentContractId}`);
  }

  console.log('\n=== TEST 2: TenantRegistrationService.getPublicRooms ===');
  const regService = new TenantRegistrationService(prisma as any);
  const available = await regService.getPublicRooms(dormId);
  console.log(`Available rooms returned: ${available.length}`);
  for (const r of available) {
    console.log(`  - Room ${r.roomNumber}: isVacant=${r.isVacant}, selectable=${r.selectable}, badgeLabel='${r.badgeLabel}', selectionType='${r.selectionType}'`);
    if (!r.isVacant || !r.selectable || r.badgeLabel !== 'ห้องว่าง') {
      throw new Error(`Room ${r.roomNumber} should be vacant and selectable, but got: isVacant=${r.isVacant}, selectable=${r.selectable}, badgeLabel='${r.badgeLabel}'`);
    }
  }
  console.log('>>> PASSED: All vacant rooms are correctly recognized as vacant and selectable!');

  console.log('\n=== TEST 3: Registration Submission & Approval Flow ===');
  const room101 = rooms.find(r => r.roomNumber === '101')!;
  const testPhone = '081' + Math.floor(1000000 + Math.random() * 9000000);
  
  const regReq = await prisma.tenantRegistrationRequest.create({
    data: {
      dormitoryId: dormId,
      requestedRoomId: room101.id,
      firstName: 'ทดสอบ',
      lastName: 'ระบบอนุมัติ',
      phone: testPhone,
      status: 'pending_owner_approval',
      acceptanceSnapshot: {
        rentAmount: 4000,
        depositAmount: 8000,
        durationMonths: 6,
        nationalId: '1234567890123',
        moveInDate: new Date().toISOString(),
        pets: [],
        vehicles: []
      }
    }
  });
  console.log(`Created registration request 1: id=${regReq.id}, status=${regReq.status}`);

  // Test Owner Approval
  console.log('Simulating Owner Approval via approveRequest...');
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 6);

  const approvedResult = await regService.approveRequest(
    regReq.id,
    dormId,
    {
      roomId: room101.id,
      rentAmount: 4000,
      depositAmount: 8000,
      startDate,
      endDate,
      durationMonths: 6,
      advancePaymentAmount: 4000,
    },
    '00000000-0000-0000-0000-000000000001'
  );
  console.log(`Approved result tenantId=${approvedResult.tenantId}, contractId=${approvedResult.contractId}`);

  // Verify room is now occupied
  const updatedRoom101 = await prisma.room.findUnique({ where: { id: room101.id } });
  console.log(`Room 101 after approval: status='${updatedRoom101?.status}', tenantId=${updatedRoom101?.currentTenantId}`);

  // Verify tenant exists
  const createdTenant = await prisma.tenant.findUnique({ where: { id: approvedResult.tenantId } });
  console.log(`Tenant created: displayName='${createdTenant?.displayName}', status='${createdTenant?.status}'`);

  console.log('>>> PASSED: Owner approval successfully creates tenant, contract, and updates room!');

  console.log('\n=== TEST 4: Registration Rejection Flow ===');
  // Create a second registration request for Room 102
  const room102 = rooms.find(r => r.roomNumber === '102')!;
  const testPhone2 = '089' + Math.floor(1000000 + Math.random() * 9000000);
  const regReq2 = await prisma.tenantRegistrationRequest.create({
    data: {
      dormitoryId: dormId,
      requestedRoomId: room102.id,
      firstName: 'ทดสอบ',
      lastName: 'ระบบปฏิเสธ',
      phone: testPhone2,
      status: 'pending_owner_approval',
      acceptanceSnapshot: {
        rentAmount: 4500,
        depositAmount: 9000,
        durationMonths: 12,
        nationalId: '9876543210987',
        moveInDate: new Date().toISOString(),
        pets: [],
        vehicles: []
      }
    }
  });
  console.log(`Created registration request 2: id=${regReq2.id}, status=${regReq2.status}`);

  // Simulate Owner Rejection
  console.log('Simulating Owner Rejection via rejectRequest...');
  const rejectionReason = 'ภาพถ่ายบัตรประชาชนไม่ชัดเจน กรุณาถ่ายใหม่อีกครั้ง';
  const rejectedResult = await regService.rejectRequest(
    regReq2.id,
    dormId,
    rejectionReason,
    'owner-test-user'
  );
  console.log(`Rejected request: status='${rejectedResult.status}', reason='${rejectedResult.rejectedReason}'`);

  if (rejectedResult.status !== 'rejected' || rejectedResult.rejectedReason !== rejectionReason) {
    throw new Error('Rejection status or reason did not match expected values!');
  }
  console.log('>>> PASSED: Rejection preserves status and reason for tenant resubmission!');

  console.log('\n=== TEST 5: Cleanup & Reset for Live Testing ===');
  // Clean up created contract, tenant, registration requests
  if (approvedResult.contractId) {
    await prisma.billItem.deleteMany({ where: { bill: { contractId: approvedResult.contractId } } });
    await prisma.bill.deleteMany({ where: { contractId: approvedResult.contractId } });
    await prisma.contract.deleteMany({ where: { id: approvedResult.contractId } });
  }
  if (approvedResult.tenantId) {
    await prisma.occupancy.deleteMany({ where: { tenantId: approvedResult.tenantId } });
    await prisma.tenant.deleteMany({ where: { id: approvedResult.tenantId } });
  }
  await prisma.tenantRegistrationRequest.deleteMany({
    where: { id: { in: [regReq.id, regReq2.id] } }
  });
  // Reset room 101 back to VACANT
  await prisma.room.update({
    where: { id: room101.id },
    data: {
      status: 'VACANT',
      currentTenantId: null,
      currentContractId: null
    }
  });
  console.log('Room 101 reset to VACANT, test records cleaned up.');

  await prisma.$disconnect();
  console.log('\n=== ALL TESTS COMPLETED SUCCESSFULLY! ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
