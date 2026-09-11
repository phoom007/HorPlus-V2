/**
 * @license Apache-2.0
 * Payment Evidence Verifier Interface & Default Provider
 */

import { PaymentEvidenceVerificationResult, VerifyEvidenceInput } from './types.js';

export interface PaymentEvidenceVerifier {
  verify(input: VerifyEvidenceInput): Promise<PaymentEvidenceVerificationResult>;
}

/**
 * Unconfigured / Default Verifier
 * Returns UNVERIFIED for standard manual workflow.
 * DOES NOT call SlipOK or any external provider.
 */
export class UnconfiguredPaymentEvidenceVerifier implements PaymentEvidenceVerifier {
  async verify(input: VerifyEvidenceInput): Promise<PaymentEvidenceVerificationResult> {
    return {
      provider: 'NONE',
      status: 'UNVERIFIED',
      claimedTransferAt: input.claimedTransferAt ?? null,
      verifiedTransferAt: null,
      verifiedAmount: null,
      providerReference: null,
      payloadHash: null,
    };
  }
}
