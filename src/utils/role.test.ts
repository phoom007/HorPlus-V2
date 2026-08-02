import { describe, it, expect } from 'vitest';
import { normalizeRole } from './role';

describe('normalizeRole Utility (Fail-Closed)', () => {
  it('maps valid owner roles correctly', () => {
    expect(normalizeRole('OWNER')).toBe('owner');
    expect(normalizeRole('role-owner')).toBe('owner');
    expect(normalizeRole('เจ้าของหอพัก')).toBe('owner');
  });

  it('maps valid manager roles correctly', () => {
    expect(normalizeRole('MANAGER')).toBe('manager');
    expect(normalizeRole('role-manager')).toBe('manager');
    expect(normalizeRole('ผู้จัดการ')).toBe('manager');
  });

  it('maps valid staff roles correctly', () => {
    expect(normalizeRole('STAFF')).toBe('staff');
    expect(normalizeRole('TECHNICIAN')).toBe('staff');
    expect(normalizeRole('role-staff')).toBe('staff');
  });

  it('fails closed (returns null) for missing or unresolved roles', () => {
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole(null)).toBeNull();
    expect(normalizeRole('')).toBeNull();
    expect(normalizeRole('UNKNOWN_ROLE_123')).toBeNull();
    expect(normalizeRole('INVALID_PERMISSION_ELEVATION')).toBeNull();
  });
});
