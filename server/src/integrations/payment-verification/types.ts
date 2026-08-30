/**
 * @license Apache-2.0
 * Payment Evidence Verification Types
 * Provider-neutral domain models for future SlipOK or other verifiers.
 */

import { Decimal } from 'decimal.js';

export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'ERROR';

export interface PaymentEvidenceVerificationResult {
  provider: string;
  status: VerificationStatus;
  claimedTransferAt?: Date | null;
  verifiedTransferAt?: Date | null;
  verifiedAmount?: Decimal | null;
  providerReference?: string | null;
  payloadHash?: string | null;
  errorReason?: string | null;
}

export interface VerifyEvidenceInput {
  dormitoryId: string;
  evidenceObjectKey: string;
  expectedAmount?: Decimal;
  claimedTransferAt?: Date | null;
}
