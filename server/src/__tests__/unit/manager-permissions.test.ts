import { describe, it, expect } from 'vitest';
import { resolveAuthoritativeDormitoryContext, normalizeRolePermissions } from '../../middleware/dormitory-context.js';

describe('Manager Role Permissions Policy (MGR-01 - MGR-03)', () => {
  const mockDormitoryId = '20000001-0000-4000-8000-000000000002';

  it('assigns full operational permissions for MANAGER role in resolveAuthoritativeDormitoryContext', async () => {
    const mockReq: any = {
      auth: {
        user: { id: 'user-manager-123' },
        memberships: [
          {
            id: 'mem-mgr-1',
            dormitoryId: mockDormitoryId,
            roleCode: 'MANAGER',
            status: 'active',
            rolePermissions: ['dormitory:view'],
          },
        ],
      },
      headers: {
        'x-dormitory-id': mockDormitoryId,
      },
    };

    const context = await resolveAuthoritativeDormitoryContext(mockReq);

    expect(context.roleCode).toBe('MANAGER');
    expect(context.dormitoryId).toBe(mockDormitoryId);

    const perms = context.permissions;

    // 1. Meters Domain
    expect(perms).toContain('meter:write');
    expect(perms).toContain('meters:write');
    expect(perms).toContain('meter:read');
    expect(perms).toContain('meters:view');
    expect(perms).toContain('meters:record');

    // 2. Billing & Bills Domain (including F-01 billing_settings:view/read)
    expect(perms).toContain('billing:write');
    expect(perms).toContain('billing:view');
    expect(perms).toContain('billing:manage');
    expect(perms).toContain('bills:generate');
    expect(perms).toContain('bills:create');
    expect(perms).toContain('bills:write');
    expect(perms).toContain('bills:cancel');
    expect(perms).toContain('bills:view');
    expect(perms).toContain('billing_cycles:create');
    expect(perms).toContain('billing_settings:view');
    expect(perms).toContain('billing_settings:read');

    // 3. Payments & Receipts Domain
    expect(perms).toContain('payment:write');
    expect(perms).toContain('payments:write');
    expect(perms).toContain('payments:manage');
    expect(perms).toContain('payments:view');
    expect(perms).toContain('payments:create');
    expect(perms).toContain('receipt:write');
    expect(perms).toContain('receipts:manage');
    expect(perms).toContain('receipts:view');

    // 4. Property Domain (Rooms & Buildings)
    expect(perms).toContain('room:write');
    expect(perms).toContain('rooms:write');
    expect(perms).toContain('rooms:create');
    expect(perms).toContain('rooms:update');
    expect(perms).toContain('rooms:delete');
    expect(perms).toContain('rooms:view');
    expect(perms).toContain('building:write');
    expect(perms).toContain('buildings:write');
    expect(perms).toContain('buildings:create');
    expect(perms).toContain('buildings:view');

    // 5. Tenants, Contracts, Occupancy, Move-Out, Settlements
    expect(perms).toContain('tenant:write');
    expect(perms).toContain('tenants:write');
    expect(perms).toContain('tenants:view');
    expect(perms).toContain('tenants:create');
    expect(perms).toContain('contract:write');
    expect(perms).toContain('contracts:write');
    expect(perms).toContain('contracts:view');
    expect(perms).toContain('contracts:create');
    expect(perms).toContain('occupancy:write');
    expect(perms).toContain('moveout:write');
    expect(perms).toContain('settlement:write');

    // 6. Maintenance Domain
    expect(perms).toContain('maintenance:write');
    expect(perms).toContain('maintenance:create');
    expect(perms).toContain('maintenance:update');
    expect(perms).toContain('maintenance:close');
    expect(perms).toContain('maintenance:view');

    // 7. Announcements Domain
    expect(perms).toContain('announcement:write');
    expect(perms).toContain('announcements:write');
    expect(perms).toContain('announcements:create');
    expect(perms).toContain('announcements:delete');
    expect(perms).toContain('announcements:view');

    // 8. Reports & Billboard Domain
    expect(perms).toContain('reports:view');
    expect(perms).toContain('billboard:view');
    expect(perms).toContain('analytics:view');

    // 9. LINE OA Configuration Domain (MLD-01)
    expect(perms).toContain('line_oa:view');
    expect(perms).toContain('line_oa:read');
    expect(perms).toContain('line_oa:write');
    expect(perms).toContain('line_oa:manage');

    // 10. Negative Assertions: Owner-Only Boundaries (MGR-02, SEC-02)
    expect(perms).not.toContain('*');
    expect(perms).not.toContain('payment_settings:view');
    expect(perms).not.toContain('payment_settings:read');
    expect(perms).not.toContain('payment_settings:update');
    expect(perms).not.toContain('payment_settings:write');
    expect(perms).not.toContain('staff:manage');
    expect(perms).not.toContain('users:manage');
    expect(perms).not.toContain('access_grants:manage');
    expect(perms).not.toContain('subscription:*');
    expect(perms).not.toContain('subscription:view');
    expect(perms).not.toContain('subscription:read');
    expect(perms).not.toContain('subscription:write');
    expect(perms).not.toContain('subscription:manage');
    expect(perms).not.toContain('dormitory:delete');
    expect(perms).not.toContain('dormitory:transfer');
  });

  it('strips global wildcard * even if injected in raw permissions for MANAGER', async () => {
    const mockReq: any = {
      auth: {
        user: { id: 'user-manager-wildcard' },
        memberships: [
          {
            id: 'mem-mgr-2',
            dormitoryId: mockDormitoryId,
            roleCode: 'MANAGER',
            status: 'active',
            rolePermissions: ['*', 'payment_settings:view', 'staff:manage'],
          },
        ],
      },
      headers: {
        'x-dormitory-id': mockDormitoryId,
      },
    };

    const context = await resolveAuthoritativeDormitoryContext(mockReq);
    expect(context.permissions).not.toContain('*');
    expect(context.permissions).not.toContain('payment_settings:view');
    expect(context.permissions).not.toContain('staff:manage');
  });
});
