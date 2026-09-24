/**
 * Live Check for Card S3 on app.hor-plus.com
 * Verifies Tenant Data Isolation, Bill Scoping, QR Limits, and Cross-Dormitory Protection
 */

import fs from 'fs';

function getCredentials(role) {
  const content = fs.readFileSync('.agents/local/test-access.md', 'utf8');
  const blocks = content.split('### ');
  const block = blocks.find(b => b.startsWith(`${role}:`));
  if (!block) throw new Error(`Could not find credentials for role: ${role}`);
  const lines = block.split(/\r?\n/).map(l => l.trim());
  const cookieIdx = lines.findIndex(l => l.includes('Cookie (horplus_session)'));
  const csrfIdx = lines.findIndex(l => l.includes('CSRF Token (horplus_csrf)'));
  const session = lines[cookieIdx + 2];
  const csrf = lines[csrfIdx + 2];
  return { session, csrf };
}

async function main() {
  const tenantCreds = getCredentials('Tenant');
  const baseUrl = 'https://app.hor-plus.com';
  const taDormId = '20000001-0000-4000-8000-000000000002';
  const taTenantId = '97d61931-c8ef-4da0-aab7-1f6faae6536b';
  const taContractId = '67f78b4f-f1bf-4e51-846d-97eb6e0c6036';
  const taVisibleBillId = '8c878b01-46ac-4856-acb9-c722d53af670'; // Somchai's visible bill
  const foreignBillId = '4909779b-936f-40b1-86a5-757b150cd676'; // Belongs to another tenant

  console.log('=== Checking Card S3 Live Endpoints on app.hor-plus.com ===\n');

  // AC S3-1: TA Tenant Bills, Payments, Receipts, Utilities Scoping
  console.log('1. [AC S3-1] Verifying TA only sees TA own contract data');
  const resBills = await fetch(`${baseUrl}/api/v1/tenant-portal/bills`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /bills Status: ${resBills.status}`);
  const billsData = await resBills.json();
  const bills = Array.isArray(billsData) ? billsData : (billsData.data || billsData.bills || []);
  console.log(`Found ${bills.length} bills for TA`);
  
  const foreignBillsInList = bills.filter(b => b.contractId && b.contractId !== taContractId);
  console.log(`Foreign bills in TA list: ${foreignBillsInList.length}`);

  const resPayments = await fetch(`${baseUrl}/api/v1/tenant-portal/payments`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /payments Status: ${resPayments.status}`);
  const paymentsData = await resPayments.json();
  const payments = Array.isArray(paymentsData) ? paymentsData : (paymentsData.data || paymentsData.payments || []);
  console.log(`Found ${payments.length} payments for TA`);

  const resReceipts = await fetch(`${baseUrl}/api/v1/tenant-portal/receipts`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /receipts Status: ${resReceipts.status}`);
  const receiptsData = await resReceipts.json();
  const receipts = Array.isArray(receiptsData) ? receiptsData : (receiptsData.data || receiptsData.receipts || []);
  console.log(`Found ${receipts.length} receipts for TA`);

  const resUtilities = await fetch(`${baseUrl}/api/v1/tenant-portal/utilities`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /utilities Status: ${resUtilities.status}`);
  const utilitiesData = await resUtilities.json();
  console.log(`Utilities response success: ${utilitiesData.success}, readings count: ${utilitiesData.data?.readings?.length}`);

  const passS31 = resBills.status === 200 &&
                  foreignBillsInList.length === 0 &&
                  resPayments.status === 200 &&
                  resReceipts.status === 200 &&
                  resUtilities.status === 200 &&
                  utilitiesData.success === true;
  console.log(`Result S3-1: ${passS31 ? 'PASS' : 'FAIL'}\n`);

  // AC S3-2: Direct Access to Foreign Bill ID
  console.log('2. [AC S3-2] Direct access to foreign bill ID returns 404 with Thai message');
  const resForeignBill = await fetch(`${baseUrl}/api/v1/tenant-portal/bills/${foreignBillId}`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /bills/:foreignId Status: ${resForeignBill.status}`);
  const foreignBillData = await resForeignBill.json();
  console.log(`Response code: ${foreignBillData.error?.code}, message: ${foreignBillData.error?.message}`);

  const resForeignPaymentOpt = await fetch(`${baseUrl}/api/v1/tenant-portal/payment-options/${foreignBillId}`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /payment-options/:foreignId Status: ${resForeignPaymentOpt.status}`);
  const foreignPaymentOptData = await resForeignPaymentOpt.json();
  console.log(`Response code: ${foreignPaymentOptData.error?.code}, message: ${foreignPaymentOptData.error?.message}`);

  const resForeignQr = await fetch(`${baseUrl}/api/v1/tenant-portal/payment-options/${foreignBillId}/qr`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /payment-options/:foreignId/qr Status: ${resForeignQr.status}`);
  const foreignQrData = await resForeignQr.json();
  console.log(`Response code: ${foreignQrData.error?.code}, message: ${foreignQrData.error?.message}`);

  const passS32 = resForeignBill.status === 404 &&
                  foreignBillData.error?.code === 'TENANT_BILL_NOT_FOUND' &&
                  foreignBillData.error?.message?.includes('ไม่พบรายการบิลนี้') &&
                  resForeignPaymentOpt.status === 404 &&
                  resForeignQr.status === 404;
  console.log(`Result S3-2: ${passS32 ? 'PASS' : 'FAIL'}\n`);

  // AC S3-3: QR Amount Bounds and Multi-bill Ownership Validation
  console.log('3. [AC S3-3] QR amount limit check and multi-bill ownership check');
  // 3a. Amount exceeds outstanding (requesting 999999)
  const resExcessAmount = await fetch(`${baseUrl}/api/v1/tenant-portal/payment-options/${taVisibleBillId}/qr?amount=999999`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /payment-options/:id/qr?amount=999999 Status: ${resExcessAmount.status}`);
  const excessAmountData = await resExcessAmount.json();
  console.log(`Response code: ${excessAmountData.error?.code}, message: ${excessAmountData.error?.message}`);

  // 3b. Multi-bill with foreign bill included
  const resMultiBill = await fetch(`${baseUrl}/api/v1/tenant-portal/payment-options/${taVisibleBillId},${foreignBillId}/qr`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /payment-options/:myId,:foreignId/qr Status: ${resMultiBill.status}`);
  const multiBillData = await resMultiBill.json();
  console.log(`Response code: ${multiBillData.error?.code}, message: ${multiBillData.error?.message}`);

  // 3c. Valid QR request (returns SVG)
  const resValidQr = await fetch(`${baseUrl}/api/v1/tenant-portal/payment-options/${taVisibleBillId}/qr`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET valid QR Status: ${resValidQr.status}, Content-Type: ${resValidQr.headers.get('content-type')}`);
  const validQrText = await resValidQr.text();
  const isSvg = validQrText.includes('<svg') && validQrText.includes('</svg>');
  console.log(`Valid QR SVG received: ${isSvg}`);

  const passS33 = resExcessAmount.status === 400 &&
                  excessAmountData.error?.code === 'AMOUNT_EXCEEDS_OUTSTANDING' &&
                  excessAmountData.error?.message?.includes('เกินยอดค้างชำระ') &&
                  resMultiBill.status === 404 &&
                  resValidQr.status === 200 &&
                  isSvg === true;
  console.log(`Result S3-3: ${passS33 ? 'PASS' : 'FAIL'}\n`);

  // AC S3-4: Cross-dormitory Protection on GET /rooms
  console.log('4. [AC S3-4] GET /rooms dormitory scoping');
  const resRooms = await fetch(`${baseUrl}/api/v1/tenant-portal/rooms`, {
    headers: { Cookie: `horplus_session=${tenantCreds.session}` },
  });
  console.log(`GET /rooms Status: ${resRooms.status}`);
  const roomsData = await resRooms.json();
  console.log(`Rooms count: ${roomsData.rooms?.length}`);
  const foreignRooms = (roomsData.rooms || []).filter(r => r.dormitoryId && r.dormitoryId !== taDormId);
  console.log(`Foreign rooms: ${foreignRooms.length}`);

  const passS34 = resRooms.status === 200 &&
                  roomsData.success === true &&
                  foreignRooms.length === 0;
  console.log(`Result S3-4: ${passS34 ? 'PASS' : 'FAIL'}\n`);

  // AC S3-6: Query bounds (take: 50)
  console.log('5. [AC S3-6] Query bounds take <= 50');
  const passS36 = bills.length <= 50 && payments.length <= 50 && receipts.length <= 50;
  console.log(`Bills count: ${bills.length} <= 50, Payments: ${payments.length} <= 50, Receipts: ${receipts.length} <= 50`);
  console.log(`Result S3-6: ${passS36 ? 'PASS' : 'FAIL'}\n`);

  console.log('=== All S3 Live API Checks Summary ===');
  console.log(`S3-1 (TA Data Scoping): ${passS31 ? 'PASS' : 'FAIL'}`);
  console.log(`S3-2 (Foreign Bill 404): ${passS32 ? 'PASS' : 'FAIL'}`);
  console.log(`S3-3 (QR Bounds & Multi-bill): ${passS33 ? 'PASS' : 'FAIL'}`);
  console.log(`S3-4 (Cross-Dorm Scoping): ${passS34 ? 'PASS' : 'FAIL'}`);
  console.log(`S3-6 (Query Bounds <= 50): ${passS36 ? 'PASS' : 'FAIL'}`);

  if (!passS31 || !passS32 || !passS33 || !passS34 || !passS36) {
    process.exit(1);
  }
  console.log('\nALL S3 LIVE API CHECKS PASSED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('Fatal error during S3 live check:', err);
  process.exit(1);
});
