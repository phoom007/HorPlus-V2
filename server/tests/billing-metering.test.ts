import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Billing, Metering & Rate Management API (TASK 013)', () => {
  let app: ReturnType<typeof createApp>;
  let authCookie: string;
  let csrfToken: string;
  const dormitoryId = 'dorm-001';

  let roomId: string;
  let tenantId: string;
  let contractId: string;
  let cycleId: string;
  let billId: string;

  beforeAll(async () => {
    app = createApp();

    // 1. Auth login
    const authRes = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: 'valid-owner-token', intent: 'owner' });

    expect(authRes.status).toBe(200);
    const cookies = authRes.headers['set-cookie'] || [];
    authCookie = cookies.join('; ');
    csrfToken = authRes.body.data.csrfToken;

    // 2. Setup Room
    const roomRes = await request(app)
      .post('/api/v1/properties/rooms')
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('x-dormitory-id', dormitoryId)
      .send({
        roomNumber: 'B101',
        floor: 1,
        monthlyRent: '5000.00',
        initialWaterReading: '100.00',
        initialElectricityReading: '500.00',
      });
    expect(roomRes.status).toBe(201);
    roomId = roomRes.body.data.id;

    // 3. Setup Tenant
    const tenantRes = await request(app)
      .post('/api/v1/tenants')
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('x-dormitory-id', dormitoryId)
      .send({
        firstName: 'Somchai',
        lastName: 'Jaidee',
        phone: '0812345678',
      });
    expect(tenantRes.status).toBe(201);
    tenantId = tenantRes.body.data.id;

    // 4. Setup Contract & Activate
    const contractRes = await request(app)
      .post('/api/v1/contracts')
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('x-dormitory-id', dormitoryId)
      .send({
        roomId,
        tenantId,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        rentAmount: '5000.00',
      });
    expect(contractRes.status).toBe(201);
    contractId = contractRes.body.data.id;

    const activateRes = await request(app)
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set('Cookie', authCookie)
      .set('x-csrf-token', csrfToken)
      .set('x-dormitory-id', dormitoryId)
      .send({});
    expect(activateRes.status).toBe(200);
  });

  // --- 1. BILLING CYCLE API ---
  describe('Billing Cycle API', () => {
    it('should create a billing cycle with rate snapshot', async () => {
      const res = await request(app)
        .post('/api/v1/billing-cycles')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          cycleCode: '2026-01',
          name: 'รอบประจำเดือน มกราคม 2569',
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          billingDate: '2026-01-25',
          dueDate: '2026-02-05',
          rateSnapshot: {
            waterRate: '18.00',
            electricityRate: '7.00',
            commonFee: '200.00',
            internetFee: '300.00',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.cycle.cycleCode).toBe('2026-01');
      expect(res.body.data.rateSnapshot.waterRate).toBe('18.00');
      expect(res.body.data.rateSnapshot.electricityRate).toBe('7.00');
      cycleId = res.body.data.cycle.id;
    });

    it('should reject duplicate billing cycle code', async () => {
      const res = await request(app)
        .post('/api/v1/billing-cycles')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          cycleCode: '2026-01',
          name: 'รอบซ้ำ',
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          billingDate: '2026-02-25',
          dueDate: '2026-03-05',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_CYCLE_CODE');
    });

    it('should reject overlapping billing cycle dates', async () => {
      const res = await request(app)
        .post('/api/v1/billing-cycles')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          cycleCode: '2026-01-overlap',
          name: 'รอบคาบเกี่ยว',
          periodStart: '2026-01-15',
          periodEnd: '2026-02-15',
          billingDate: '2026-01-28',
          dueDate: '2026-02-05',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('OVERLAPPING_BILLING_CYCLE');
    });

    it('should list billing cycles', async () => {
      const res = await request(app)
        .get('/api/v1/billing-cycles')
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should get billing cycle details by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/billing-cycles/${cycleId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.cycle.id).toBe(cycleId);
      expect(res.body.data.rateSnapshot).not.toBeNull();
    });

    it('should lock billing cycle', async () => {
      const res = await request(app)
        .post(`/api/v1/billing-cycles/${cycleId}/lock`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('locked');
    });
  });

  // --- 2. METER DEVICES & READINGS API ---
  describe('Meter Devices & Readings API', () => {
    let secondCycleId: string;

    beforeAll(async () => {
      // Create second cycle for reading tests
      const cycleRes = await request(app)
        .post('/api/v1/billing-cycles')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          cycleCode: '2026-02',
          name: 'รอบประจำเดือน กุมภาพันธ์ 2569',
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
          billingDate: '2026-02-25',
          dueDate: '2026-03-05',
          rateSnapshot: {
            waterRate: '20.00',
            electricityRate: '8.00',
            commonFee: '200.00',
          },
        });
      expect(cycleRes.status).toBe(201);
      secondCycleId = cycleRes.body.data.cycle.id;
    });

    it('should create meter devices for room', async () => {
      const waterRes = await request(app)
        .post('/api/v1/meters/devices')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId,
          type: 'water',
          meterNumber: 'WM-B101',
          initialReading: '100.00',
        });
      expect(waterRes.status).toBe(201);
      expect(waterRes.body.data.meterNumber).toBe('WM-B101');

      const elecRes = await request(app)
        .post('/api/v1/meters/devices')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId,
          type: 'electricity',
          meterNumber: 'EM-B101',
          initialReading: '500.00',
        });
      expect(elecRes.status).toBe(201);
      expect(elecRes.body.data.meterNumber).toBe('EM-B101');
    });

    it('should list meter devices for room', async () => {
      const res = await request(app)
        .get(`/api/v1/meters/devices/room/${roomId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    it('should submit bulk meter readings', async () => {
      const res = await request(app)
        .post('/api/v1/meters/readings/bulk')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId: secondCycleId,
          readings: [
            {
              roomId,
              meterType: 'water',
              previousReading: '100.00',
              currentReading: '110.00', // 10 units
            },
            {
              roomId,
              meterType: 'electricity',
              previousReading: '500.00',
              currentReading: '600.00', // 100 units
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.data[0].usageUnits).toBe('10.00');
      expect(res.body.data[1].usageUnits).toBe('100.00');
    });

    it('should reject meter reading where current < previous', async () => {
      const res = await request(app)
        .post('/api/v1/meters/readings/bulk')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId: secondCycleId,
          readings: [
            {
              roomId,
              meterType: 'water',
              previousReading: '100.00',
              currentReading: '50.00',
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_METER_READING');
    });

    it('should handle meter replacement', async () => {
      const res = await request(app)
        .post('/api/v1/meters/replace')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          roomId,
          meterType: 'water',
          oldMeterFinalReading: '115.00',
          newMeterNumber: 'WM-B101-NEW',
          newMeterInitialReading: '0.00',
          reason: 'มิเตอร์ชำรุด',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.oldDevice.status).toBe('replaced');
      expect(res.body.data.newDevice.status).toBe('active');
      expect(res.body.data.newDevice.meterNumber).toBe('WM-B101-NEW');
      expect(res.body.data.replacement.reason).toBe('มิเตอร์ชำรุด');
    });
  });

  // --- 3. BILL GENERATION & INVOICING API ---
  describe('Bill Generation & Invoicing API', () => {
    let thirdCycleId: string;

    beforeAll(async () => {
      const cycleRes = await request(app)
        .post('/api/v1/billing-cycles')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          cycleCode: '2026-03',
          name: 'รอบประจำเดือน มีนาคม 2569',
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          billingDate: '2026-03-25',
          dueDate: '2026-04-05',
          rateSnapshot: {
            waterRate: '18.00',
            electricityRate: '7.00',
            commonFee: '200.00',
            internetFee: '100.00',
          },
        });
      expect(cycleRes.status).toBe(201);
      thirdCycleId = cycleRes.body.data.cycle.id;

      // Submit readings
      await request(app)
        .post('/api/v1/meters/readings/bulk')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId: thirdCycleId,
          readings: [
            {
              roomId,
              meterType: 'water',
              previousReading: '0.00',
              currentReading: '10.00', // 10 units * 18 = 180
            },
            {
              roomId,
              meterType: 'electricity',
              previousReading: '600.00',
              currentReading: '700.00', // 100 units * 7 = 700
            },
          ],
        });
    });

    it('should generate bill preview for room', async () => {
      const res = await request(app)
        .get(`/api/v1/bills/preview?billingCycleId=${thirdCycleId}&roomId=${roomId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.rentAmount).toBe('5000.00');
      expect(res.body.data.waterAmount).toBe('180.00');
      expect(res.body.data.electricityAmount).toBe('700.00');
      expect(res.body.data.commonFee).toBe('200.00');
      expect(res.body.data.internetFee).toBe('100.00');
      // Subtotal = 5000 + 180 + 700 + 200 + 100 = 6180.00
      expect(res.body.data.subtotal).toBe('6180.00');
    });

    it('should generate bill for room contract', async () => {
      const res = await request(app)
        .post('/api/v1/bills/generate')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId: thirdCycleId,
          contractId,
          roomId,
          tenantId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.bill.subtotal).toBe('6180.00');
      expect(res.body.data.bill.totalAmount).toBe('6180.00');
      expect(res.body.data.bill.status).toBe('unpaid');
      billId = res.body.data.bill.id;
    });

    it('should reject duplicate bill for same contract and cycle', async () => {
      const res = await request(app)
        .post('/api/v1/bills/generate')
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          billingCycleId: thirdCycleId,
          contractId,
          roomId,
          tenantId,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BILL_ALREADY_EXISTS_FOR_CONTRACT');
    });

    it('should fetch bill details with line items', async () => {
      const res = await request(app)
        .get(`/api/v1/bills/${billId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.bill.id).toBe(billId);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    it('should fetch billing summary stats', async () => {
      const res = await request(app)
        .get(`/api/v1/bills/summary?billingCycleId=${thirdCycleId}`)
        .set('Cookie', authCookie)
        .set('x-dormitory-id', dormitoryId);

      expect(res.status).toBe(200);
      expect(res.body.data.totalBills).toBe(1);
      expect(res.body.data.totalAmount).toBe('6180.00');
      expect(res.body.data.outstandingAmount).toBe('6180.00');
    });

    it('should cancel bill with reason', async () => {
      const res = await request(app)
        .post(`/api/v1/bills/${billId}/cancel`)
        .set('Cookie', authCookie)
        .set('x-csrf-token', csrfToken)
        .set('x-dormitory-id', dormitoryId)
        .send({
          reason: 'คำนวณส่วนลดผิดพลาด ต้องออกใบแจ้งหนี้ใหม่',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(res.body.data.cancellationReason).toBe('คำนวณส่วนลดผิดพลาด ต้องออกใบแจ้งหนี้ใหม่');
    });
  });
});
