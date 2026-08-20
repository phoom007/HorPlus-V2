/**
 * Centralized Role Normalization Utility (Fail-Closed)
 * Strictly maps domain role names/codes to standard workspace roles.
 * Unresolved or missing roles return null (fail closed).
 */

export type WorkspaceRole = 'owner' | 'manager' | 'staff' | 'tenant';

export function normalizeRole(roleInput?: any): WorkspaceRole | null {
  if (!roleInput) return null;

  let r = '';
  if (typeof roleInput === 'string') {
    r = roleInput.trim();
  } else if (typeof roleInput === 'object') {
    r = roleInput.code || roleInput.roleCode || roleInput.name || roleInput.id || '';
  }

  if (!r) return null;

  const rUpper = r.toUpperCase();

  // OWNER
  if (
    rUpper === 'OWNER' ||
    r === 'role-owner' ||
    rUpper === 'ROLE-OWNER' ||
    r === 'owner' ||
    r === 'เจ้าของหอพัก' ||
    r === 'เจ้าของระบบ'
  ) {
    return 'owner';
  }

  // MANAGER
  if (
    rUpper === 'MANAGER' ||
    r === 'role-manager' ||
    rUpper === 'ROLE-MANAGER' ||
    r === 'manager' ||
    r === 'ผู้จัดการ'
  ) {
    return 'manager';
  }

  // STAFF / TECHNICIAN / HOUSEKEEPING
  if (
    rUpper === 'TECH' ||
    rUpper === 'TECHNICIAN' ||
    rUpper === 'HOUSEKEEPING' ||
    rUpper === 'STAFF' ||
    r === 'role-staff' ||
    r === 'role-tech' ||
    rUpper === 'ROLE-STAFF' ||
    rUpper === 'ROLE-TECH' ||
    r === 'staff' ||
    r === 'ช่างซ่อม' ||
    r === 'พนักงานทั่วไป'
  ) {
    return 'staff';
  }

  // TENANT
  if (rUpper === 'TENANT' || r === 'tenant' || r === 'ผู้เช่า') {
    return 'tenant';
  }

  // FAIL CLOSED
  return null;
}
