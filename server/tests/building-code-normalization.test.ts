import { describe, it, expect } from 'vitest';
import {
  OnboardingBuildingInputSchema,
  BuildingSchema,
  CompleteOnboardingInputSchema,
} from '../src/types/onboarding-validation.js';
import { normalizeOnboardingDraftPayload } from '../src/services/onboarding-draft-normalizer.js';

describe('Server-Side Building Code Uppercase Canonicalization', () => {
  it('canonicalizes lowercase building code and roomPrefix to uppercase in OnboardingBuildingInputSchema', () => {
    const raw = {
      id: 'b-1',
      name: 'อาคาร a',
      code: 'a',
      roomPrefix: 'a',
      floorsCount: 1,
      roomsPerFloor: 5,
    };

    const parsed = OnboardingBuildingInputSchema.parse(raw);
    expect(parsed.code).toBe('A');
    expect(parsed.roomPrefix).toBe('A');
  });

  it('canonicalizes multi-character lowercase building code "ab" and "b1" to uppercase', () => {
    const raw = {
      id: 'b-2',
      name: 'อาคาร ab',
      code: 'ab',
      roomPrefix: 'b1',
      floorsCount: 2,
    };

    const parsed = OnboardingBuildingInputSchema.parse(raw);
    expect(parsed.code).toBe('AB');
    expect(parsed.roomPrefix).toBe('B1');
  });

  it('preserves non-English / Thai characters without corruption', () => {
    const raw = {
      id: 'b-3',
      name: 'อาคาร ตึก1',
      code: 'ตึก1',
      roomPrefix: 'ตึก1',
      floorsCount: 1,
    };

    const parsed = OnboardingBuildingInputSchema.parse(raw);
    expect(parsed.code).toBe('ตึก1');
    expect(parsed.roomPrefix).toBe('ตึก1');
  });

  it('canonicalizes BuildingSchema code to uppercase', () => {
    const raw = {
      name: 'Building Test',
      code: 'c',
      floorCount: 3,
    };

    const parsed = BuildingSchema.parse(raw);
    expect(parsed.code).toBe('C');
  });

  it('normalizes draft payload roomPrefix to uppercase via normalizeOnboardingDraftPayload', () => {
    const rawDraft = {
      dormitoryName: 'Test Draft Dorm',
      buildings: [
        {
          id: 'b-1',
          name: 'อาคาร a',
          roomPrefix: 'a',
          totalFloors: 1,
          roomsPerFloor: 3,
        },
      ],
    };

    const normalized = normalizeOnboardingDraftPayload(rawDraft);
    expect(normalized.buildings[0].roomPrefix).toBe('A');
  });

  it('canonicalizes building code and roomPrefix in CompleteOnboardingInputSchema', () => {
    const rawPayload = {
      dormitory: {
        name: 'Dorm Uppercase Test',
        province: 'กรุงเทพมหานคร',
        phone: '0812345678',
      },
      billing: {
        dueDay: 15,
        waterBillingType: 'unit',
        waterRate: '18',
        electricityBillingType: 'unit',
        electricityRate: '7',
      },
      buildings: [
        {
          id: 'b-1',
          name: 'อาคาร a',
          code: 'a',
          roomPrefix: 'a',
          floorsCount: 1,
          roomsPerFloor: 2,
        },
      ],
      rooms: [
        {
          buildingId: 'b-1',
          roomNumber: 'A101',
          floor: 1,
          monthlyRent: 3500,
        },
      ],
      planCode: 'FREE',
      packageIntentId: '00000000-0000-0000-0000-000000000001',
    };

    const parsed = CompleteOnboardingInputSchema.parse(rawPayload);
    expect(parsed.buildings?.[0].code).toBe('A');
    expect(parsed.buildings?.[0].roomPrefix).toBe('A');
    // Manual roomNumber remains as entered
    expect(parsed.rooms?.[0].roomNumber).toBe('A101');
  });
});
