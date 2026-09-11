/**
 * @license Apache-2.0
 * Payment Evidence Verification Service & Canonical Authority Resolvers
 */

import { getPrismaClient } from '../db/prisma.js';
import { PaymentEvidenceVerifier, UnconfiguredPaymentEvidenceVerifier } from '../integrations/payment-verification/payment-evidence-verifier.js';
import { PaymentEvidenceVerificationResult, VerifyEvidenceInput } from '../integrations/payment-verification/types.js';

const prisma = getPrismaClient();

export class PaymentVerificationService {
  private verifier: PaymentEvidenceVerifier;

  constructor(verifier?: PaymentEvidenceVerifier) {
    this.verifier = verifier ?? new UnconfiguredPaymentEvidenceVerifier();
  }

  /**
   * For testing or future provider injection
   */
  public setVerifier(verifier: PaymentEvidenceVerifier) {
    this.verifier = verifier;
  }

  /**
   * Executes verification check via active adapter (unconfigured in production for R3.8c)
   */
  async verifyEvidence(input: VerifyEvidenceInput): Promise<PaymentEvidenceVerificationResult> {
    return await this.verifier.verify(input);
  }

  /**
   * Persists verification metadata record in PostgreSQL
   */
  async recordVerificationInTx(
    tx: any,
    input: {
      dormitoryId: string;
      paymentId?: string;
      paymentGroupId?: string;
      result: PaymentEvidenceVerificationResult;
    }
  ) {
    if ((input.paymentId && input.paymentGroupId) || (!input.paymentId && !input.paymentGroupId)) {
      throw new Error('Exactly one of paymentId or paymentGroupId must be provided for verification record');
    }

    return await tx.paymentEvidenceVerification.create({
      data: {
        dormitoryId: input.dormitoryId,
        paymentId: input.paymentId ?? null,
        paymentGroupId: input.paymentGroupId ?? null,
        provider: input.result.provider,
        status: input.result.status,
        claimedTransferAt: input.result.claimedTransferAt ?? null,
        verifiedTransferAt: input.result.verifiedTransferAt ?? null,
        verifiedAmount: input.result.verifiedAmount ? input.result.verifiedAmount.toString() : null,
        providerReference: input.result.providerReference ?? null,
        payloadHash: input.result.payloadHash ?? null,
        verifiedAt: input.result.status === 'VERIFIED' ? new Date() : null,
      },
    });
  }
}

export const paymentVerificationService = new PaymentVerificationService();

/**
 * Canonical Authority Helper: resolveTrustedPaymentEffectiveAt
 * Rules:
 * 1. CASH: trusted server-recorded timestamp (now) is authoritative.
 * 2. BANK_TRANSFER / SLIP:
 *    - IF verification.status === 'VERIFIED' AND verifiedTransferAt exists from a trusted server adapter
 *      THEN trustedPaymentEffectiveAt = verifiedTransferAt
 *    - OTHERWISE: trustedPaymentEffectiveAt = null
 * 
 * CRITICAL: claimedTransferAt MUST NEVER be returned as trusted financial timing.
 */
export function resolveTrustedPaymentEffectiveAt(params: {
  method: string;
  serverRecordedAt?: Date | null;
  verification?: {
    status?: string | null;
    verifiedTransferAt?: Date | null;
    claimedTransferAt?: Date | null;
    provider?: string | null;
  } | null;
}): Date | null {
  if (params.method === 'CASH') {
    return params.serverRecordedAt ?? new Date();
  }

  if (
    params.verification?.status === 'VERIFIED' &&
    params.verification.verifiedTransferAt &&
    params.verification.provider !== 'NONE'
  ) {
    return new Date(params.verification.verifiedTransferAt);
  }

  return null;
}
