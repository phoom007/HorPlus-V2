/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OwnerReports, formatThaiPhoneNumber, translateNotesToThai } from '../pages/owner/reports';
import { Room, Bill, Building, Contract, MaintenanceRequest } from '../types';

describe('OwnerReports UI — Building Isolation & CSV Export Tests', () => {
  afterEach(() => {
    cleanup();
  });
  const buildings: Building[] = [
    { id: 'bld-a', name: 'อาคาร A', floors: 3 } as any,
    { id: 'bld-b', name: 'อาคาร B', floors: 4 } as any,
  ];

  const rooms: Room[] = [
    { id: 'rm-101', roomNumber: '101', buildingId: 'bld-a', status: 'occupied', price: 4000, depositAmount: 5000 } as any,
    { id: 'rm-102', roomNumber: '102', buildingId: 'bld-a', status: 'vacant', price: 4000, depositAmount: 5000 } as any,
    { id: 'rm-201', roomNumber: '201', buildingId: 'bld-b', status: 'occupied', price: 6000, depositAmount: 8000 } as any,
    { id: 'rm-301', roomNumber: '301', buildingId: undefined, status: 'vacant', price: 3500, depositAmount: 4000 } as any,
  ];

  const contracts: Contract[] = [
    { id: 'ct-101', contractNumber: 'CT-101', roomId: 'rm-101', depositAmount: 5000, rentAmount: 4000, status: 'active' } as any,
    { id: 'ct-201', contractNumber: 'CT-201', roomId: 'rm-201', depositAmount: 8000, rentAmount: 6000, status: 'active' } as any,
  ];

  const repairs: MaintenanceRequest[] = [
    { id: 'rep-1', roomId: 'rm-101', cost: 450, status: 'completed', createdAt: '2026-08-05T10:00:00.000Z' } as any,
    { id: 'rep-2', roomId: 'rm-201', cost: 1200, status: 'completed', createdAt: '2026-08-12T14:00:00.000Z' } as any,
    { id: 'rep-3', roomId: undefined, cost: 3000, status: 'completed', createdAt: '2026-08-20T09:00:00.000Z' } as any,
  ];

  const bills: Bill[] = [
    {
      id: 'bill-101',
      roomId: 'rm-101',
      roomNumber: '101',
      cycleCode: '2026-08',
      status: 'paid',
      rentAmount: 4000,
      totalAmount: 4000,
      paidAmount: 4000,
      items: [{ category: 'rent', amount: 4000 }]
    } as any,
    {
      id: 'bill-201',
      roomId: 'rm-201',
      roomNumber: '201',
      cycleCode: '2026-08',
      status: 'pending',
      rentAmount: 6000,
      totalAmount: 6000,
      paidAmount: 0,
      items: [{ category: 'rent', amount: 6000 }]
    } as any,
  ];

  it('renders building dropdown with "หอพักรวมทุกอาคาร", buildings, and "ไม่ระบุอาคาร"', () => {
    render(
      <OwnerReports
        rooms={rooms}
        bills={bills}
        buildings={buildings}
        contracts={contracts}
        repairs={repairs}
        selectedCycleCode="2026-08"
      />
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeDefined();

    const options = Array.from(select.querySelectorAll('option')).map(o => o.textContent);
    expect(options).toContain('หอพักรวมทุกอาคาร');
    expect(options).toContain('อาคาร A');
    expect(options).toContain('อาคาร B');
    expect(options).toContain('ไม่ระบุอาคาร');
  });

  it('switches building and updates stats accurately', async () => {
    const { container } = render(
      <OwnerReports
        rooms={rooms}
        bills={bills}
        buildings={buildings}
        contracts={contracts}
        repairs={repairs}
        selectedCycleCode="2026-08"
      />
    );

    const select = screen.getByRole('combobox');

    // Select Building A
    fireEvent.change(select, { target: { value: 'bld-a' } });

    // In Building A:
    // Badge shows "อาคาร A"
    const badge = container.querySelector('.bg-blue-50.text-blue-600.text-\\[10px\\]');
    expect(badge?.textContent).toBe('อาคาร A');

    // Total rooms for Building A should be 2 (101, 102)
    expect(container.textContent).toContain('2');

    // Select "unspecified"
    fireEvent.change(select, { target: { value: 'unspecified' } });
    expect(badge?.textContent).toBe('ไม่ระบุอาคาร');
  });

  it('renders export popover with Excel and CSV tabs and 3 comprehensive options', () => {
    render(
      <OwnerReports
        rooms={rooms}
        bills={bills}
        buildings={buildings}
        contracts={contracts}
        repairs={repairs}
        selectedCycleCode="2026-08"
      />
    );

    // Find and click "ส่งออกรายงาน" button
    const exportBtn = screen.getByTitle(/ส่งออกข้อมูลรายเดือนหรือรายปีเป็นไฟล์ CSV/);
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn);

    // Check popover header and tabs
    expect(screen.getByText(/เลือกรูปแบบส่งออก/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Excel \(\.xlsx\)/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /CSV \(\.csv\)/ })).toBeDefined();
    expect(screen.getByText('1. รายงานประจำเดือนแบบสมบูรณ์')).toBeDefined();
    expect(screen.getByText('2. ตารางข้อมูลดิบรายห้อง (Clean Grid)')).toBeDefined();
    expect(screen.getByText(/3\. รายงานสรุปประจำปี/)).toBeDefined();
  });

  it('triggers CSV download with comprehensive raw grid and summary when clicking export option', async () => {
    const createdBlobs: { blob: Blob; fileName?: string }[] = [];
    const origCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = (blob: any) => {
      createdBlobs.push({ blob });
      return 'blob:test';
    };

    const { unmount } = render(
      <OwnerReports
        rooms={rooms}
        bills={bills}
        buildings={buildings}
        contracts={contracts}
        repairs={repairs}
        selectedCycleCode="2026-08"
      />
    );

    const exportBtn = screen.getByTitle(/ส่งออกข้อมูลรายเดือนหรือรายปีเป็นไฟล์ CSV/);

    // 1. Test Option 1: Monthly Full Report (CSV)
    fireEvent.click(exportBtn);
    const csvTab = screen.getByText('CSV (.csv)');
    fireEvent.click(csvTab);
    const fullBtn = screen.getByText('1. รายงานประจำเดือนแบบสมบูรณ์');
    fireEvent.click(fullBtn);

    expect(createdBlobs.length).toBe(1);
    expect(screen.getByTestId('toast-csv-export')).toBeDefined();
    const fullContent = await createdBlobs[0].blob.text();
    expect(fullContent.startsWith('\uFEFF')).toBe(true);
    expect(fullContent).toContain('=== รายงานสรุปการเงินและสถิติหอพัก');
    expect(fullContent).toContain('--- ส่วนที่ 1: สรุปภาพรวมสถิติและอัตราครองห้อง ---');
    expect(fullContent).toContain('--- ส่วนที่ 2: สรุปบัญชีรายรับและรายจ่ายประจำเดือน ---');
    expect(fullContent).toContain('--- ส่วนที่ 3: ตารางข้อมูลดิบรายห้องพักและรายการบิลโดยละเอียด');
    expect(fullContent).toContain('"ลำดับ","อาคาร","ชั้น","เลขห้อง","ชื่อผู้เช่า"');
    expect(fullContent).toContain('"รวมทั้งหมด"');

    // 2. Test Option 2: Clean Raw Grid (CSV)
    fireEvent.click(exportBtn);
    fireEvent.click(screen.getByText('CSV (.csv)'));
    const rawBtn = screen.getByText('2. ตารางข้อมูลดิบรายห้อง (Clean Grid)');
    fireEvent.click(rawBtn);

    expect(createdBlobs.length).toBe(2);
    const rawContent = await createdBlobs[1].blob.text();
    expect(rawContent.startsWith('\uFEFF"ลำดับ","อาคาร","ชั้น","เลขห้อง"')).toBe(true);
    expect(rawContent).toContain('"101"');
    expect(rawContent).toContain('"รวมทั้งหมด"');

    // 3. Test Option 3: Yearly Report (CSV)
    fireEvent.click(exportBtn);
    fireEvent.click(screen.getByText('CSV (.csv)'));
    const yearBtn = screen.getByText(/3\. รายงานสรุปประจำปี/);
    fireEvent.click(yearBtn);

    expect(createdBlobs.length).toBe(3);
    const yearContent = await createdBlobs[2].blob.text();
    expect(yearContent.startsWith('\uFEFF=== รายงานสรุปการเงินและสถิติหอพักประจำปี')).toBe(true);
    expect(yearContent).toContain('--- ส่วนที่ 1: สรุปภาพรวมรายรับรายจ่ายทั้งปี');
    expect(yearContent).toContain('--- ส่วนที่ 2: ตารางเปรียบเทียบผลการดำเนินงาน 12 เดือน');
    expect(yearContent).toContain('"มกราคม"');
    expect(yearContent).toContain('"รวมทั้งปี');

    // Restore
    window.URL.createObjectURL = origCreateObjectURL;
    unmount();
  });

  it('triggers Excel (.xlsx) download with multi-sheet workbook and styles', async () => {
    const createdBlobs: { blob: Blob; fileName?: string }[] = [];
    const origCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = (blob: any) => {
      createdBlobs.push({ blob });
      return 'blob:test-xlsx';
    };

    const { unmount } = render(
      <OwnerReports
        rooms={rooms}
        bills={bills}
        buildings={buildings}
        contracts={contracts}
        repairs={repairs}
        selectedCycleCode="2026-08"
      />
    );

    const exportBtn = screen.getByTitle(/ส่งออกข้อมูลรายเดือนหรือรายปีเป็นไฟล์ CSV/);

    // 1. Test Option 1: Monthly Full Report (Excel .xlsx default active tab)
    fireEvent.click(exportBtn);
    const fullBtn = screen.getByText('1. รายงานประจำเดือนแบบสมบูรณ์');
    fireEvent.click(fullBtn);

    // Wait for ExcelJS writeBuffer to finish
    await waitFor(() => expect(createdBlobs.length).toBe(1), { timeout: 3000 });
    expect(createdBlobs[0].blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(createdBlobs[0].blob.size).toBeGreaterThan(100);

    // 2. Test Option 2: Clean Raw Grid (Excel .xlsx)
    fireEvent.click(exportBtn);
    const rawBtn = screen.getByText('2. ตารางข้อมูลดิบรายห้อง (Clean Grid)');
    fireEvent.click(rawBtn);
    await waitFor(() => expect(createdBlobs.length).toBe(2), { timeout: 3000 });
    expect(createdBlobs[1].blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 3. Test Option 3: Yearly Report (Excel .xlsx)
    fireEvent.click(exportBtn);
    const yearBtn = screen.getByText(/3\. รายงานสรุปประจำปี/);
    fireEvent.click(yearBtn);
    await waitFor(() => expect(createdBlobs.length).toBe(3), { timeout: 3000 });
    expect(createdBlobs[2].blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    window.URL.createObjectURL = origCreateObjectURL;
    unmount();
  });

  it('aligns with dormitory settings, snapshots, separated categories, and exports 30-column CSV', async () => {
    const createdBlobs: { blob: Blob; fileName?: string }[] = [];
    const origCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = (blob: any) => {
      createdBlobs.push({ blob });
      return 'blob:test-settings';
    };

    const dormitory = {
      id: 'dorm-thai-1',
      name: 'สุขสบาย แมนชั่น',
      address: '123/45 ซอยพหลโยธิน 24 กทม.',
      phone: '0812345678',
      taxId: '0105559876543',
      waterUnitRate: 18,
      electricUnitRate: 8,
      commonFee: 200,
    };

    const billingCycles = [
      {
        id: 'cycle-2026-08',
        cycleCode: '2026-08',
        rateSnapshot: {
          waterRate: 18,
          electricityRate: 8,
          commonFee: 200,
          internetFee: 150,
          parkingFee: 100,
        },
      },
    ];

    const detailedTenants = [
      {
        id: 't-1',
        name: 'สมชาย สบายใจ',
        phone: '0891112222',
        coOccupants: [{ name: 'สมหญิง สบายใจ' }], // 2 people
        vehicles: [{ plate: 'กข 1234' }, { plate: '1กข 5678' }], // 2 vehicles
      },
    ];

    const detailedBills: Bill[] = [
      {
        id: 'bill-detail-1',
        roomId: 'rm-101',
        roomNumber: '101',
        cycleCode: '2026-08',
        status: 'paid',
        paymentMethod: 'promptpay',
        tenantId: 't-1',
        rentAmount: 4000,
        totalAmount: 4850,
        paidAmount: 4850,
        dueDate: '2026-08-05',
        paidAt: '2026-08-04',
        items: [
          { category: 'rent', amount: 4000 },
          { category: 'water', amount: 180, quantity: 10 },
          { category: 'electricity', amount: 320, quantity: 40 },
          { category: 'common_fee', amount: 200 },
          { category: 'internet_fee', amount: 150 },
          { category: 'parking', amount: 100 },
          { category: 'discount', amount: -100 },
        ],
      } as any,
    ];

    const { container, unmount } = render(
      <OwnerReports
        rooms={rooms}
        bills={detailedBills}
        buildings={buildings}
        tenants={detailedTenants as any}
        contracts={contracts}
        repairs={repairs}
        dormitory={dormitory}
        billingCycles={billingCycles}
        selectedCycleCode="2026-08"
      />
    );

    // Verify dormitory name is rendered in header
    expect(container.textContent).toContain('สุขสบาย แมนชั่น');

    // Verify UI Financial Ledger Table contains separated categories
    expect(container.textContent).toContain('4. รายรับค่าบริการส่วนกลาง (Common Area Fee)');
    expect(container.textContent).toContain('5. รายรับค่าบริการอินเทอร์เน็ต (Internet Fee)');
    expect(container.textContent).toContain('6. รายรับค่าที่จอดรถ (Parking Fee)');
    expect(container.textContent).toContain('ส่วนลดโปรโมชั่น / หักลดพิเศษ (Discounts)');

    // Trigger CSV Export
    const exportBtn = screen.getByTitle(/ส่งออกข้อมูลรายเดือนหรือรายปีเป็นไฟล์ CSV/);
    fireEvent.click(exportBtn);
    const csvTab = screen.getByText('CSV (.csv)');
    fireEvent.click(csvTab);
    const fullBtn = screen.getByText('1. รายงานประจำเดือนแบบสมบูรณ์');
    fireEvent.click(fullBtn);

    expect(createdBlobs.length).toBe(1);
    const content = await createdBlobs[0].blob.text();

    // 1. Verify Dormitory Metadata in CSV header
    expect(content).toContain('ชื่อหอพัก: สุขสบาย แมนชั่น');
    expect(content).toContain('123/45 ซอยพหลโยธิน 24 กทม.');
    expect(content).toContain('0812345678');
    expect(content).toContain('0105559876543');
    expect(content).toContain('เงื่อนไขอัตราค่าบริการรอบบิล: น้ำ 18 บาท/หน่วย | ไฟ 8 บาท/หน่วย | ส่วนกลาง 200 บาท | อินเทอร์เน็ต 150 บาท | ที่จอดรถ 100 บาท');

    // 2. Verify Section 2 separated categories
    expect(content).toContain('"4. ค่าส่วนกลาง (Common Fee)"');
    expect(content).toContain('"5. ค่าอินเทอร์เน็ต (Internet Fee)"');
    expect(content).toContain('"6. ค่าที่จอดรถ (Parking Fee)"');
    expect(content).toContain('"9. ส่วนลด (Discounts)",-100.00');

    // 3. Verify 30-Column CSV Raw Grid Header
    const rawHeaderLine = content.split('\n').find(line => line.includes('"ลำดับ","อาคาร","ชั้น","เลขห้อง"'));
    expect(rawHeaderLine).toBeDefined();
    const cols = rawHeaderLine!.split(',');
    expect(cols.length).toBe(30);
    expect(rawHeaderLine).toContain('"จำนวนผู้พักอาศัย (คน)"');
    expect(rawHeaderLine).toContain('"จำนวนยานพาหนะ (คัน)"');
    expect(rawHeaderLine).toContain('"ช่องทางการชำระเงิน"');
    expect(rawHeaderLine).toContain('"ส่วนลด (บาท)"');
    expect(rawHeaderLine).toContain('"เงินประกันสัญญา (บาท)"');

    // 4. Verify Raw Data Row has tenant counts, payment method, and leading zero preserved
    const row101 = content.split('\n').find(line => line.includes('"101"'));
    expect(row101).toBeDefined();
    const rowCols = row101!.split(',');
    expect(rowCols.length).toBe(30);
    expect(rowCols[5]).toBe('="0891112222"'); // Preserves leading 0 via formula for Excel
    expect(rowCols[6]).toBe('"2"'); // 2 people (somchai + somying)
    expect(rowCols[7]).toBe('"2"'); // 2 vehicles
    expect(rowCols[10]).toBe('"พร้อมเพย์ / สแกน QR"'); // promptpay payment method
    expect(rowCols[24]).toBe('-100.00'); // discount

    window.URL.createObjectURL = origCreateObjectURL;
    unmount();
  });

  it('unit test: formatThaiPhoneNumber handles 9-digit, country code, and normalizes leading 0', () => {
    // 9 digits without leading 0 -> normalized with 0
    expect(formatThaiPhoneNumber('812345678')).toBe('0812345678');
    expect(formatThaiPhoneNumber('912345678')).toBe('0912345678');
    // Already 10 digits with leading 0
    expect(formatThaiPhoneNumber('0812345678')).toBe('0812345678');
    // Country code +66
    expect(formatThaiPhoneNumber('+66812345678')).toBe('0812345678');
    expect(formatThaiPhoneNumber('66812345678')).toBe('0812345678');
    // Hyphens
    expect(formatThaiPhoneNumber('081-234-5678')).toBe('0812345678');
    // Number type
    expect(formatThaiPhoneNumber(812345678)).toBe('0812345678');
    // Null / undefined / empty
    expect(formatThaiPhoneNumber(null)).toBe('-');
    expect(formatThaiPhoneNumber(undefined)).toBe('-');
    expect(formatThaiPhoneNumber('-')).toBe('-');
  });

  it('unit test: translateNotesToThai converts English system codes to clear Thai descriptions', () => {
    expect(translateNotesToThai('OWNER_METER_SWITCH_OFF')).toBe('ปิดสวิตช์ออกบิลในหน้าจดมิเตอร์');
    expect(translateNotesToThai('Cancelled by staff')).toBe('ยกเลิกโดยเจ้าหน้าที่');
    expect(translateNotesToThai('Reissued due to meter correction')).toBe('ออกบิลใหม่เนื่องจากแก้ไขค่ามิเตอร์');
    expect(translateNotesToThai('MANUAL_CANCEL')).toBe('ยกเลิกรายการโดยเจ้าของหอ');
    expect(translateNotesToThai('VACANT_ROOM')).toBe('ห้องว่าง ไม่มีการออกบิล');
    expect(translateNotesToThai('TENANT_MOVED_OUT')).toBe('ผู้เช่าย้ายออกแล้ว');
    expect(translateNotesToThai('SYSTEM_RECALCULATED')).toBe('ระบบคำนวณบิลใหม่');
    expect(translateNotesToThai('DUPLICATE_BILL')).toBe('ยกเลิกเนื่องจากบิลซ้ำซ้อน');
    expect(translateNotesToThai('Rejected: Slip blurred')).toBe('ปฏิเสธการชำระเงิน: Slip blurred');
    expect(translateNotesToThai('Reversed: Mistake')).toBe('ยกเลิกการชำระเงิน: Mistake');
    expect(translateNotesToThai(null)).toBe('-');
    expect(translateNotesToThai('-')).toBe('-');
    expect(translateNotesToThai('ข้อความภาษาไทยเดิม')).toBe('ข้อความภาษาไทยเดิม');
  });
});


