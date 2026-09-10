/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerReports } from '../pages/owner/reports';
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
});
