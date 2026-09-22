import { describe, it, expect } from 'vitest';
import { resolveAuthoritativeDormitoryContext } from '../../middleware/dormitory-context.js';
import { AppError } from '../../types/index.js';

describe('Ticket 03: Dormitory Context Header Fallback & Graceful Degradation', () => {
  const validDormId = '20000001-0000-4000-8000-000000000002';

  it('gracefully falls back to activeMemberships[0] when header x-dormitory-id is non-UUID (e.g. "dorm-1")', async () => {
    const mockReq: any = {
      auth: {
        user: { id: 'user-owner-123' },
        memberships: [
          {
            id: 'mem-1',
            dormitoryId: validDormId,
            roleCode: 'OWNER',
            status: 'active',
            rolePermissions: ['*'],
          },
        ],
      },
      headers: {
        'x-dormitory-id': 'dorm-1', // Legacy or mock non-UUID header
      },
    };

    const context = await resolveAuthoritativeDormitoryContext(mockReq);

    expect(context).toBeDefined();
    expect(context.dormitoryId).toBe(validDormId);
    expect(context.roleCode).toBe('OWNER');
  });

  it('still throws INVALID_ID_FORMAT if explicit route param is malformed', async () => {
    const mockReq: any = {
      auth: {
        user: { id: 'user-owner-123' },
        memberships: [
          {
            id: 'mem-1',
            dormitoryId: validDormId,
            roleCode: 'OWNER',
            status: 'active',
            rolePermissions: ['*'],
          },
        ],
      },
      params: {
        dormitoryId: 'not-a-valid-uuid',
      },
      headers: {},
    };

    await expect(resolveAuthoritativeDormitoryContext(mockReq)).rejects.toThrow(
      'รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID'
    );
  });
});
