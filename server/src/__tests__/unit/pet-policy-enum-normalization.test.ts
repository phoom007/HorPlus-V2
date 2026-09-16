import { describe, it, expect } from 'vitest';
import { CompleteOnboardingInputSchema } from '../../types/onboarding-validation.js';

describe('TDD Slice 1: Onboarding Pet Policy Enum Normalization', () => {
  const minimalValidPayload = {
    dormitory: {
      name: 'หอพักทดสอบ TDD',
    },
    billing: {
      dueDay: 5,
    },
    planCode: 'FREE',
    packageIntentId: '00000000-0000-4000-8000-000000000000',
  };

  it('RED: parses and normalizes "small_pets" to "small_pet" and "exotic" to "other" without throwing ZodError', () => {
    const payloadWithAlternateEnums = {
      ...minimalValidPayload,
      petPolicy: {
        allowed: 'conditional',
        allowedTypes: ['dog', 'small_pets', 'cat', 'exotic'],
      },
    };

    const parsed = CompleteOnboardingInputSchema.parse(payloadWithAlternateEnums);

    expect(parsed.petPolicy).toBeDefined();
    expect(parsed.petPolicy?.allowed).toBe('conditional');
    // Must normalize to canonical enums
    expect(parsed.petPolicy?.allowedTypes).toEqual(['dog', 'small_pet', 'cat', 'other']);
  });

  it('rejects truly invalid pet types like "elephant"', () => {
    const invalidPayload = {
      ...minimalValidPayload,
      petPolicy: {
        allowed: 'conditional',
        allowedTypes: ['elephant'],
      },
    };

    expect(() => CompleteOnboardingInputSchema.parse(invalidPayload)).toThrow();
  });
});
