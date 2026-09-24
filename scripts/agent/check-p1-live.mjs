import fs from 'fs';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor

function getCredentials(role) {
  const content = fs.readFileSync('.agents/local/test-access.md', 'utf8');
  const blocks = content.split('### ');
  const block = blocks.find((b) => b.startsWith(`${role}:`));
  if (!block) throw new Error(`Could not find credentials for role: ${role}`);
  const lines = block.split(/\r?\n/).map((l) => l.trim());
  const cookieIdx = lines.findIndex((l) => l.includes('Cookie (horplus_session)'));
  const csrfIdx = lines.findIndex((l) => l.includes('CSRF Token (horplus_csrf)'));
  const session = lines[cookieIdx + 2];
  const csrf = lines[csrfIdx + 2];
  return { session, csrf };
}

async function run() {
  const prisma = getPrismaClient();
  const taCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  console.log('=== Card P1 Live API & DB Verification on https://app.hor-plus.com ===');

  // 0. Health check
  const healthRes = await fetch(`${BASE_URL}/api/v1/health/readiness`);
  const healthJson = await healthRes.json();
  console.log('[Health] Readiness:', healthRes.status, JSON.stringify(healthJson));
  if (healthRes.status !== 200) throw new Error('Pilot readiness check failed');

  // Resolve TA profile
  const taProfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  });
  const taProf = await taProfRes.json();
  console.log('[TA Profile] Status:', taProfRes.status, 'Tenant ID:', taProf.id, 'Name:', taProf.name);
  if (taProfRes.status !== 200 || !taProf.id) {
    throw new Error('Failed to resolve TA profile');
  }
  const taTenantId = taProf.id;

  // Find another tenant (TD or Somsak) to test cross-tenant guard
  const otherTenant = await prisma.tenant.findFirst({
    where: { dormitoryId: DORM_ID, id: { not: taTenantId }, status: 'active' },
  });
  if (!otherTenant) throw new Error('Could not find another active tenant for cross-tenant tests');
  console.log('[Other Tenant] ID:', otherTenant.id, 'Name:', otherTenant.displayName || otherTenant.firstName);

  // ----------------------------------------------------
  // AC P1-1: Emergency contact read-only for tenant, owner editable
  // ----------------------------------------------------
  console.log('\n--- Checking AC P1-1 (Emergency Contact Scope) ---');
  // Tenant attempts to mutate emergency contact via PATCH /profile
  const patchEmergencyRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      emergencyContact: { name: 'ผู้ติดต่อฉุกเฉินแฮกเกอร์', phone: '0899999999', relationship: 'คนแปลกหน้า' },
    }),
  });
  console.log('[P1-1] Tenant PATCH /profile with emergencyContact status:', patchEmergencyRes.status);
  // Verify in DB that emergency contact is unchanged
  const dbEmergencyBefore = await prisma.tenantEmergencyContact.findMany({
    where: { tenantId: taTenantId },
  });
  const hasHackerContact = dbEmergencyBefore.some((c) => c.name === 'ผู้ติดต่อฉุกเฉินแฮกเกอร์');
  if (hasHackerContact) throw new Error('Security defect: Tenant was able to mutate emergency contact directly via PATCH /profile!');
  console.log('[P1-1] DB Check: Tenant cannot mutate emergency contact via PATCH /profile (PASS)');

  // Owner updates/adds emergency contact for TA from Owner Portal
  let contactToUpdate = dbEmergencyBefore[0];
  const updatedEmergencyName = 'คุณแม่ สมหญิง ใจดี';
  const updatedEmergencyPhone = '0819998888';
  if (contactToUpdate) {
    const ownerUpdateRes = await fetch(`${BASE_URL}/api/v1/tenants/${taTenantId}/emergency-contacts/${contactToUpdate.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-csrf-token': ownerCreds.csrf,
      },
      body: JSON.stringify({
        name: updatedEmergencyName,
        relationship: 'มารดา',
        phone: updatedEmergencyPhone,
      }),
    });
    console.log('[P1-1] Owner PUT emergency-contact status:', ownerUpdateRes.status);
    if (ownerUpdateRes.status !== 200) throw new Error(`Owner failed to update emergency contact: ${ownerUpdateRes.status}`);
  } else {
    const ownerCreateRes = await fetch(`${BASE_URL}/api/v1/tenants/${taTenantId}/emergency-contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-csrf-token': ownerCreds.csrf,
      },
      body: JSON.stringify({
        name: updatedEmergencyName,
        relationship: 'มารดา',
        phone: updatedEmergencyPhone,
      }),
    });
    console.log('[P1-1] Owner POST emergency-contact status:', ownerCreateRes.status);
    if (ownerCreateRes.status !== 201) throw new Error(`Owner failed to create emergency contact: ${ownerCreateRes.status}`);
  }

  // Tenant re-fetches profile: verified updated emergency contact is visible
  const taProfReloadRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  });
  const taProfReload = await taProfReloadRes.json();
  const visibleEmergency = taProfReload.emergencyContact || taProfReload.emergencyContacts?.[0];
  console.log('[P1-1] Tenant re-fetched profile emergencyContact:', visibleEmergency?.name, visibleEmergency?.phone);
  if (visibleEmergency?.name !== updatedEmergencyName) {
    throw new Error(`Owner updated emergency contact not reflected in tenant profile: ${visibleEmergency?.name}`);
  }
  console.log('[P1-1] PASS: Emergency contact read-only for tenant, updated by owner and verified in tenant view.');

  // ----------------------------------------------------
  // AC P1-2: Tenant updates vehicles & pets via PATCH /profile + in-app notification
  // ----------------------------------------------------
  console.log('\n--- Checking AC P1-2 (Vehicles, Pets & In-App Notification) ---');
  const testVehicles = [{ type: 'MOTORCYCLE', licensePlate: '1กข 8888 กทม' }];
  const testPets = [{ type: 'CAT', name: 'น้องส้ม', breed: 'ไทย' }];
  const patchProfileRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      vehicles: testVehicles,
      pets: testPets,
    }),
  });
  const patchProfileJson = await patchProfileRes.json();
  console.log('[P1-2] Tenant PATCH /profile status:', patchProfileRes.status, 'Vehicles:', patchProfileJson.vehicles?.length, 'Pets:', patchProfileJson.pets?.length);
  if (patchProfileRes.status !== 200) throw new Error(`PATCH /profile failed: ${patchProfileRes.status}`);

  // Reload profile from API to verify persistence
  const taProfVehicleReload = await (await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  })).json();
  if (!taProfVehicleReload.vehicles?.some((v) => v.licensePlate === '1กข 8888 กทม')) {
    throw new Error('Vehicles not persisted in tenant profile');
  }
  if (!taProfVehicleReload.pets?.some((p) => p.name === 'น้องส้ม')) {
    throw new Error('Pets not persisted in tenant profile');
  }

  // Check in-app notification in DB
  const profileNotification = await prisma.staffNotification.findFirst({
    where: {
      dormitoryId: DORM_ID,
      category: 'TENANT_PROFILE_UPDATED',
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('[P1-2] In-App Notification in DB:', profileNotification?.title, '-', profileNotification?.message);
  if (!profileNotification) throw new Error('In-app notification for TENANT_PROFILE_UPDATED was not created');
  console.log('[P1-2] PASS: Vehicles and pets updated, persisted across reload, and in-app notification logged.');

  // ----------------------------------------------------
  // AC P1-3: Tenant adds and removes co-occupants via /co-occupants + in-app notification
  // ----------------------------------------------------
  console.log('\n--- Checking AC P1-3 (Co-Occupants Add & Remove + Notification) ---');
  const addCoRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/co-occupants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      name: 'นายสมหมาย ร่วมพัก',
      relationship: 'น้องชาย',
      phone: '0891234567',
    }),
  });
  const addCoJson = await addCoRes.json();
  const coOccupantId = addCoJson.data?.id || addCoJson.coOccupant?.id;
  console.log('[P1-3] POST /co-occupants status:', addCoRes.status, 'CoOccupant ID:', coOccupantId);
  if (addCoRes.status !== 201 || !coOccupantId) {
    throw new Error(`Failed to add co-occupant: ${addCoRes.status} ${JSON.stringify(addCoJson)}`);
  }

  // Verify in DB and tenant profile reload
  const dbCoBeforeDelete = await prisma.tenantCoOccupant.findUnique({ where: { id: coOccupantId } });
  if (!dbCoBeforeDelete || dbCoBeforeDelete.name !== 'นายสมหมาย ร่วมพัก') {
    throw new Error('Co-occupant not found in DB');
  }

  // Verify in-app notification for add
  const addNotification = await prisma.staffNotification.findFirst({
    where: {
      dormitoryId: DORM_ID,
      category: 'TENANT_CO_OCCUPANT_UPDATED',
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('[P1-3] Add Co-Occupant In-App Notification:', addNotification?.title, '-', addNotification?.message);
  if (!addNotification || !addNotification.message.includes('เพิ่มผู้พักร่วม: นายสมหมาย ร่วมพัก')) {
    throw new Error('In-app notification for adding co-occupant not found or title/message mismatch');
  }

  // Delete co-occupant
  const delCoRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/co-occupants/${coOccupantId}`, {
    method: 'DELETE',
    headers: {
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
  });
  console.log('[P1-3] DELETE /co-occupants/:id status:', delCoRes.status);
  if (delCoRes.status !== 200) throw new Error(`Failed to delete co-occupant: ${delCoRes.status}`);

  // Verify in-app notification for delete
  const delNotification = await prisma.staffNotification.findFirst({
    where: {
      dormitoryId: DORM_ID,
      category: 'TENANT_CO_OCCUPANT_UPDATED',
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('[P1-3] Delete Co-Occupant In-App Notification:', delNotification?.title, '-', delNotification?.message);
  if (!delNotification || !delNotification.message.includes('ลบผู้พักร่วม: นายสมหมาย ร่วมพัก')) {
    throw new Error('In-app notification for deleting co-occupant not found or title/message mismatch');
  }
  console.log('[P1-3] PASS: Co-occupant added, verified in DB, deleted, and in-app notifications logged.');

  // ----------------------------------------------------
  // AC P1-4: Attempting to mutate room, rent, contract via PATCH /profile leaves DB unchanged
  // ----------------------------------------------------
  console.log('\n--- Checking AC P1-4 (Immutable Fields Guard) ---');
  const dbContractBefore = await prisma.contract.findFirst({
    where: { tenantId: taTenantId, status: 'active' },
  });
  if (!dbContractBefore) throw new Error('Active contract not found for TA');
  const rentBefore = Number(dbContractBefore.rentAmount);
  const roomIdBefore = dbContractBefore.roomId;

  const patchForbiddenRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      monthlyRent: 1,
      depositAmount: 0,
      roomNumber: '999',
      roomId: '00000000-0000-0000-0000-000000000000',
    }),
  });
  console.log('[P1-4] Tenant PATCH /profile with forbidden fields status:', patchForbiddenRes.status);

  // Check DB contract
  const dbContractAfter = await prisma.contract.findFirst({
    where: { tenantId: taTenantId, status: 'active' },
  });
  if (!dbContractAfter || Number(dbContractAfter.rentAmount) !== rentBefore || dbContractAfter.roomId !== roomIdBefore) {
    throw new Error('Security defect: Tenant was able to modify contract rent or room via PATCH /profile!');
  }
  console.log('[P1-4] PASS: Contract rent and room remained unchanged in DB after forbidden field submission.');

  // ----------------------------------------------------
  // AC P1-5: Invalid phone format rejected with 400 and clear Thai message
  // ----------------------------------------------------
  console.log('\n--- Checking AC P1-5 (Invalid Phone Validation) ---');
  const invalidPhoneRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/co-occupants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      name: 'ผู้พักร่วม เบอร์ผิด',
      relationship: 'เพื่อน',
      phone: '12345',
    }),
  });
  const invalidPhoneJson = await invalidPhoneRes.json();
  console.log('[P1-5] Invalid phone POST /co-occupants status:', invalidPhoneRes.status, 'Body:', JSON.stringify(invalidPhoneJson));
  if (invalidPhoneRes.status !== 400) {
    throw new Error(`Expected 400 Bad Request for invalid phone, got ${invalidPhoneRes.status}`);
  }
  const errorStr = JSON.stringify(invalidPhoneJson);
  if (!errorStr.includes('เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก') || !errorStr.includes('0')) {
    throw new Error(`Expected Thai validation error message, got: ${errorStr}`);
  }
  console.log('[P1-5] PASS: Invalid phone rejected with 400 and Thai validation message.');

  // ----------------------------------------------------
  // AC P1-6: Cross-tenant modification rejected with 403 Forbidden
  // ----------------------------------------------------
  console.log('\n--- Checking AC P1-6 (Cross-Tenant Guard) ---');
  // Attempt to submit other tenant's ID in PATCH /profile
  const crossPatchRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      tenantId: otherTenant.id,
      vehicles: [{ type: 'CAR', licensePlate: '9999' }],
    }),
  });
  const crossPatchJson = await crossPatchRes.json();
  console.log('[P1-6] Cross-tenant PATCH /profile status:', crossPatchRes.status, 'Body:', JSON.stringify(crossPatchJson));
  if (crossPatchRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for cross-tenant PATCH /profile, got ${crossPatchRes.status}`);
  }

  // Attempt to submit other tenant's ID in POST /co-occupants
  const crossCoRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/co-occupants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `horplus_session=${taCreds.session}`,
      'x-csrf-token': taCreds.csrf,
    },
    body: JSON.stringify({
      tenantId: otherTenant.id,
      name: 'สวมรอยเพิ่มผู้พักร่วม',
      relationship: 'ผู้บุกรุก',
      phone: '0812345678',
    }),
  });
  const crossCoJson = await crossCoRes.json();
  console.log('[P1-6] Cross-tenant POST /co-occupants status:', crossCoRes.status, 'Body:', JSON.stringify(crossCoJson));
  if (crossCoRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for cross-tenant POST /co-occupants, got ${crossCoRes.status}`);
  }

  // Verify other tenant's data in DB was not touched
  const otherCoInDb = await prisma.tenantCoOccupant.findFirst({
    where: { tenantId: otherTenant.id, name: 'สวมรอยเพิ่มผู้พักร่วม' },
  });
  if (otherCoInDb) throw new Error('Security defect: Cross-tenant co-occupant was written to DB!');
  console.log('[P1-6] PASS: Cross-tenant requests rejected with 403 Forbidden and DB unmolested.');

  console.log('\n=== ALL CARD P1 LIVE CHECKS PASSED SUCCESSFULLY ===');
  process.exit(0);
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
