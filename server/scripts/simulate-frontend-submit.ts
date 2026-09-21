async function main() {
  const dormId = 'eb729e0a-4502-4df5-8e25-c60b247fc64b';
  
  // 1. Fetch public rooms first to get Room 101 ID
  const roomsRes = await fetch(`http://localhost:3001/api/v1/tenant-registrations/public-rooms?dormitoryId=${dormId}`);
  const roomsJson = await roomsRes.json();
  const room101 = roomsJson.data.find((r: any) => r.roomNumber === '101');
  console.log('Room 101 from public-rooms:', room101?.id, room101?.roomNumber, room101?.status);

  // 2. Simulate what TenantRegisterView sends
  const payload = {
    dormitoryId: dormId,
    requestedRoomId: room101.id,
    firstName: 'ผู้เช่า',
    lastName: 'ทดสอบระบบ',
    phone: '0812345678',
    agreedTerms: true,
    signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAZCAYAAABtnU33AAAA5UlEQVR4AeXBQW7CMAAAwV3//89bH3JAVQUFHMWIGStepTbJBxm8oXKKDzJ4U+UUH2KwQOUUH2CwSOUUmxssVDnFxqxYTY1fKtmAFSupcUclFxospMYDalxosIgaNyormSorOahxESv+Q43NVfLA4MsMvszgy1jxDDVuVPIktUkOahwquUONQyVPGryhkhdUTnGo5KDGH9TUOFTyAiueoTbJAmqTHNT4h0peZMWV1CY5qHFHJW+w4mpqk9xQ40YlC1ixA7VJTjbYROUUJxtspHKKEw02UznFSQYbqpziBINNVU6x2A+h6qMPoP01EgAAAABJRU5ErkJggg==',
    expectedPolicyVersion: 1,
    rentalPlan: 'monthly',
    proposedRent: 4500,
    proposedDeposit: 4500,
    durationMonths: 12,
    startDate: '2026-10-01',
    citizenId: '1234567890123',
    birthDate: '2000-01-01',
    address: '123 ถนนสุขุมวิท กรุงเทพฯ',
    emergencyContact: {
      name: 'ผู้ติดต่อฉุกเฉิน',
      relationship: 'บิดา',
      phone: '0898765432'
    },
    terms: 'สัญญาเช่าห้อง 101...'
  };

  console.log('\nSending POST /api/v1/tenant-registrations...');
  const res = await fetch('http://localhost:3001/api/v1/tenant-registrations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Dormitory-Id': dormId
    },
    body: JSON.stringify(payload)
  });

  console.log('HTTP Status:', res.status);
  const data = await res.json();
  console.log('Response Body:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
