import { describe, it, expect, vi } from 'vitest';
import { UpdateDormitoryInputSchema } from '../../types/onboarding-validation.js';
import { PrismaDormitoryRepository } from '../../db/repositories/dormitory.repository.js';

describe('Seam 1: Dormitory Profile DTO, Logo URL & TaxId Prisma Guard', () => {
  it('UpdateDormitoryInputSchema permits taxId and nullable addressLine1 without validation errors', () => {
    const validPayload = {
      name: 'หอพักสมบูรณ์สุข',
      addressLine1: '456/78 ถนนสุขุมวิท',
      taxId: '0105551234567',
      phone: '0812345678',
      email: 'owner@example.com',
    };

    const result = UpdateDormitoryInputSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taxId).toBe('0105551234567');
      expect(result.data.addressLine1).toBe('456/78 ถนนสุขุมวิท');
    }
  });

  it('PrismaDormitoryRepository maps logoUrl and hasLogo when logoObjectKey is present', async () => {
    const mockPrisma = {
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dorm-logo-123',
          name: 'หอพักเพชรไพลิน',
          code: 'DORM01',
          type: 'apartment',
          addressLine1: '99/1 ซอย 5',
          logoObjectKey: 'dormitories/dorm-logo-123/logo_abc.png',
          status: 'active',
          deletedAt: null,
          estimatedBuildingCount: 1,
          estimatedRoomCount: 20,
          timezone: 'Asia/Bangkok',
          currency: 'THB',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };

    const repo = new PrismaDormitoryRepository(mockPrisma as any);
    const dorm = await repo.findById('dorm-logo-123');

    expect(dorm).not.toBeNull();
    expect(dorm?.hasLogo).toBe(true);
    expect(dorm?.logoUrl).toBe('/api/v1/dormitories/dorm-logo-123/logo');
  });

  it('PrismaDormitoryRepository strips non-column fields (taxId, logoUrl) before calling prisma.dormitory.update', async () => {
    const mockUpdate = vi.fn().mockImplementation(({ where, data }) => {
      // Simulate Prisma strict model check: if taxId or logoUrl is passed, Prisma crashes
      if ('taxId' in data || 'logoUrl' in data || 'hasLogo' in data) {
        throw new Error("Unknown argument 'taxId'. Did you mean 'type'?");
      }
      return Promise.resolve({
        id: where.id,
        name: data.name || 'Updated Dorm',
        code: 'DORM01',
        type: 'apartment',
        addressLine1: data.addressLine1 || 'Default Address',
        logoObjectKey: null,
        status: 'active',
        deletedAt: null,
        estimatedBuildingCount: 1,
        estimatedRoomCount: 20,
        timezone: 'Asia/Bangkok',
        currency: 'THB',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const mockPrisma = {
      dormitory: {
        update: mockUpdate,
      },
    };

    const repo = new PrismaDormitoryRepository(mockPrisma as any);
    const updated = await repo.update('dorm-123', {
      name: 'หอพักสุขสราญ',
      addressLine1: '888 หมู่ 3',
      taxId: '1234567890123',
      logoUrl: '/fake/url',
    } as any);

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('หอพักสุขสราญ');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'dorm-123' },
      data: {
        name: 'หอพักสุขสราญ',
        addressLine1: '888 หมู่ 3',
      },
    });
  });
});
