import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Property, Tenant, Contract & Occupancy Management API (TASK 012)', () => {
  let app: ReturnType<typeof createApp>;
  let authCookie: string;
  let csrfToken: string;
  const dormitoryId = 'dorm-001';

  beforeAll(async () => {
    app = createApp();

    // Perform login to acquire session cookie & csrf token
    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] || [];
    authCookie = cookies.join('; ');
    csrfToken = res.body.data.csrfToken;
  });

  // --- 1. BUILDINGS API ---
  describe('Building API', () => {
    let createdBuildingId: string;

    it('should create a building successfully', async () => {
      const res = await request(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          name: 'Building A',
          code: 'A',
          floorCount: 5,
          description: 'Main Building',
        });

      if (res.status !== 201) {
        console.error('CREATE BUILDING ERROR:', res.status, JSON.stringify(res.body));
      }
      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Building A');
      expect(res.body.data.code).toBe('A');
      createdBuildingId = res.body.data.id;
    });

    it('should reject duplicate building name in same dormitory', async () => {
      const res = await request(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          name: 'Building A',
          code: 'A2',
          floorCount: 3,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BUILDING_NAME_ALREADY_EXISTS');
    });

    it('should list buildings with pagination', async () => {
      const res = await request(app)
        .get('/api/v1/properties/buildings')
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should update building details', async () => {
      const res = await request(app)
        .put(`/api/v1/properties/buildings/${createdBuildingId}`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          description: 'Updated Description for Building A',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Updated Description for Building A');
    });
  });

  // --- 2. ROOMS API & PLAN LIMITS ---
  describe('Room API & Room Limits', () => {
    let buildingId: string;
    let createdRoomId: string;

    beforeAll(async () => {
      // Create a building
      const bRes = await request(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({ name: `Bldg-${Date.now()}`, floorCount: 4 });

      buildingId = bRes.body.data.id;
    });

    it('should create a room successfully', async () => {
      const res = await request(app)
        .post('/api/v1/properties/rooms')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          buildingId,
          roomNumber: '101',
          floor: 1,
          monthlyRent: '5500.00',
          depositAmount: '11000.00',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.roomNumber).toBe('101');
      expect(res.body.data.monthlyRent).toBe('5500.00');
      createdRoomId = res.body.data.id;
    });

    it('should reject duplicate room number in same dormitory', async () => {
      const res = await request(app)
        .post('/api/v1/properties/rooms')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          buildingId,
          roomNumber: '101',
          floor: 1,
          monthlyRent: '5500.00',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROOM_NUMBER_ALREADY_EXISTS');
    });

    it('should update room details and check optimistic lock version', async () => {
      const roomRes = await request(app)
        .get(`/api/v1/properties/rooms/${createdRoomId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      const currentVersion = roomRes.body.data.version;

      const res = await request(app)
        .put(`/api/v1/properties/rooms/${createdRoomId}`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          monthlyRent: '6000.00',
          version: currentVersion,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.monthlyRent).toBe('6000.00');
      expect(res.body.data.version).toBe(currentVersion + 1);
    });
  });

  // --- 3. TENANTS API & SENSITIVE FIELD PROTECTION ---
  describe('Tenant API & Sensitive Data', () => {
    let createdTenantId: string;

    it('should create tenant with encrypted national ID & masked response', async () => {
      const res = await request(app)
        .post('/api/v1/tenants')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          firstName: 'Somchai',
          lastName: 'Jaidee',
          phone: '0812345678',
          nationalId: '1234567890123',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.firstName).toBe('Somchai');
      expect(res.body.data.nationalIdMasked).toBe('1-2345-XXXXX-12-3');
      expect(res.body.data.nationalIdEncrypted).not.toBe('1234567890123');
      createdTenantId = res.body.data.id;
    });

    it('should add co-occupants, emergency contacts, and vehicles', async () => {
      // Co-occupant
      const coRes = await request(app)
        .post(`/api/v1/tenants/${createdTenantId}/co-occupants`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          name: 'Somsri Jaidee',
          relationship: 'Spouse',
        });

      expect(coRes.status).toBe(201);
      expect(coRes.body.data.name).toBe('Somsri Jaidee');

      // Emergency Contact
      const ecRes = await request(app)
        .post(`/api/v1/tenants/${createdTenantId}/emergency-contacts`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          name: 'Mana Jaidee',
          phone: '0899999999',
          relationship: 'Parent',
        });

      expect(ecRes.status).toBe(201);
      expect(ecRes.body.data.phone).toBe('0899999999');

      // Vehicle
      const vRes = await request(app)
        .post(`/api/v1/tenants/${createdTenantId}/vehicles`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          type: 'car',
          licensePlate: '1กข1234',
          province: 'Bangkok',
        });

      expect(vRes.status).toBe(201);
      expect(vRes.body.data.licensePlate).toBe('1กข1234');
    });

    it('should retrieve full tenant details including child entities', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${createdTenantId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.id).toBe(createdTenantId);
      expect(res.body.data.coOccupants.length).toBe(1);
      expect(res.body.data.emergencyContacts.length).toBe(1);
      expect(res.body.data.vehicles.length).toBe(1);
    });
  });

  // --- 4. CONTRACT LIFECYCLE & OVERLAP PREVENTION ---
  describe('Contract Lifecycle & Half-Open Overlap Validation', () => {
    let roomId: string;
    let tenantId: string;
    let contractId: string;

    beforeAll(async () => {
      // Create room & tenant
      const rRes = await request(app)
        .post('/api/v1/properties/rooms')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({ roomNumber: `R-${Date.now()}`, floor: 2, monthlyRent: '5000.00' });

      roomId = rRes.body.data.id;

      const tRes = await request(app)
        .post('/api/v1/tenants')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({ firstName: 'Pranee', phone: '0822222222' });

      tenantId = tRes.body.data.id;
    });

    it('should create draft contract successfully', async () => {
      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId,
          tenantId,
          startDate: '2026-02-01',
          endDate: '2026-08-01',
          durationMonths: 6,
          rentAmount: '5000.00',
          depositAmount: '10000.00',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.roomId).toBe(roomId);
      contractId = res.body.data.id;
    });

    it('should activate contract & move-in tenant, updating room status to occupied', async () => {
      const res = await request(app)
        .post(`/api/v1/contracts/${contractId}/activate`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({ ownerSignature: 'owner_sig_data' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');

      // Verify room status updated
      const roomRes = await request(app)
        .get(`/api/v1/properties/rooms/${roomId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(roomRes.body.data.status).toBe('occupied');
      expect(roomRes.body.data.currentTenantId).toBe(tenantId);
      expect(roomRes.body.data.currentContractId).toBe(contractId);
    });

    it('should reject overlapping contract creation (2026-05-01 to 2026-11-01 overlaps 2026-02-01 to 2026-08-01)', async () => {
      // Create another tenant
      const t2Res = await request(app)
        .post('/api/v1/tenants')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({ firstName: 'Kanya', phone: '0833333333' });

      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId,
          tenantId: t2Res.body.data.id,
          startDate: '2026-05-01',
          endDate: '2026-11-01',
          rentAmount: '5000.00',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONTRACT_OVERLAP');
    });

    it('should ALLOW boundary touching contract (starting on 2026-08-01 when current ends on 2026-08-01 under [start, end))', async () => {
      const t2Res = await request(app)
        .post('/api/v1/tenants')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({ firstName: 'Anan', phone: '0844444444' });

      const res = await request(app)
        .post('/api/v1/contracts')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId,
          tenantId: t2Res.body.data.id,
          startDate: '2026-08-01',
          endDate: '2027-02-01',
          rentAmount: '5000.00',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('draft');
    });

    it('should extend contract successfully', async () => {
      const res = await request(app)
        .post(`/api/v1/contracts/${contractId}/extend`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          newEndDate: '2027-02-01',
          reason: 'Extended by 6 months',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.endDate).toContain('2027-02-01');
    });

    it('should terminate contract and vacate room', async () => {
      const res = await request(app)
        .post(`/api/v1/contracts/${contractId}/terminate`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          terminationEffectiveDate: '2026-07-31',
          terminationReason: 'Tenant requested early move-out',
          depositRefundAmount: '10000.00',
          nextRoomStatus: 'vacant',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('terminated');

      // Verify room status reset to vacant
      const roomRes = await request(app)
        .get(`/api/v1/properties/rooms/${roomId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(roomRes.body.data.status).toBe('vacant');
      expect(roomRes.body.data.currentTenantId).toBeNull();
      expect(roomRes.body.data.currentContractId).toBeNull();
    });
  });

  // --- 5. OCCUPANCY SUMMARY & FLOOR PLAN ---
  describe('Occupancy Summary & Floor Plan API', () => {
    it('should return occupancy summary metrics', async () => {
      const res = await request(app)
        .get('/api/v1/occupancy/summary')
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('totalRooms');
      expect(res.body.data).toHaveProperty('occupancyRate');
      expect(res.body.data).toHaveProperty('buildingsSummary');
    });

    it('should return hierarchical floor plan view', async () => {
      const res = await request(app)
        .get('/api/v1/occupancy/floor-plan')
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
