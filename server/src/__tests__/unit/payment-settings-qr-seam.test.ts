import { describe, it, expect, vi } from 'vitest';
import { PrismaBillingSettingsRepository } from '../../db/repositories/billing-settings.repository.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';

describe('Seam 2: Payment Settings Bank QR Code & Billing Settings Seam', () => {
  it('PrismaBillingSettingsRepository maps bankQrCode from database model to entity', async () => {
    const mockPrisma = {
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'bset-123',
          dormitoryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          billingDay: 25,
          dueDay: 5,
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
          commonFee: '0.00',
          internetFee: '0.00',
          parkingRate: '0.00',
          lateFeeType: 'none',
          lateFeeValue: '0.00',
          rentBillingType: 'monthly',
          cashAccepted: true,
          bankCode: 'SCB',
          bankAccountName: 'หอพักสุขใจ',
          bankAccountNumber: '123-4-56789-0',
          bankQrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };

    const repo = new PrismaBillingSettingsRepository(mockPrisma as any);
    const settings = await repo.findByDormitoryId('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(settings).not.toBeNull();
    expect(settings?.bankCode).toBe('SCB');
    expect(settings?.bankQrCode).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  });

  it('PrismaBillingSettingsRepository.update persists bankQrCode', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({
      id: 'bset-123',
      dormitoryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      billingDay: 25,
      dueDay: 5,
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFee: '0.00',
      internetFee: '0.00',
      parkingRate: '0.00',
      lateFeeType: 'none',
      lateFeeValue: '0.00',
      rentBillingType: 'monthly',
      cashAccepted: true,
      bankCode: 'KBANK',
      bankQrCode: 'data:image/png;base64,new_qr_code_data',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockPrisma = {
      dormitoryBillingSettings: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bset-123' }),
        update: mockUpdate,
      },
    };

    const repo = new PrismaBillingSettingsRepository(mockPrisma as any);
    const updated = await repo.update('a1b2c3d4-e5f6-7890-abcd-ef1234567890', {
      bankCode: 'KBANK',
      bankQrCode: 'data:image/png;base64,new_qr_code_data',
    } as any);

    expect(updated).not.toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { dormitoryId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      data: expect.objectContaining({
        bankCode: 'KBANK',
        bankQrCode: 'data:image/png;base64,new_qr_code_data',
      }),
    }));
  });
});
