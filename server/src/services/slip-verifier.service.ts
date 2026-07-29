import { InMemoryPaymentRepository } from '../db/repositories/payment.repository.js';

export interface SlipVerificationInput {
  dormitoryId: string;
  paymentId: string;
  evidenceId?: string;
  sha256?: string;
  transactionReference?: string;
  qrPayloadHash?: string;
  expectedAmount?: string;
  expectedReceiverAccount?: string;
}

export interface SlipVerificationResult {
  requiresManualReview: boolean;
  isValid: boolean;
  provider: string; // manual, mock, slipok
  providerReference?: string;
  verifiedAmount?: string;
  verifiedPaidAt?: Date;
  verifiedReceiver?: string;
  reason?: string;
  code?: string;
}

export interface SlipVerificationProvider {
  verify(input: SlipVerificationInput): Promise<SlipVerificationResult>;
}

export class ManualSlipVerificationProvider implements SlipVerificationProvider {
  public async verify(_input: SlipVerificationInput): Promise<SlipVerificationResult> {
    return {
      requiresManualReview: true,
      isValid: false,
      provider: 'manual',
      reason: 'Requires manual human review',
    };
  }
}

export class MockSlipVerificationProvider implements SlipVerificationProvider {
  private mockScenario: 'valid' | 'invalid' | 'amount_mismatch' | 'receiver_mismatch' | 'provider_unavailable' = 'valid';

  constructor(scenario: 'valid' | 'invalid' | 'amount_mismatch' | 'receiver_mismatch' | 'provider_unavailable' = 'valid') {
    this.mockScenario = scenario;
  }

  public setScenario(scenario: 'valid' | 'invalid' | 'amount_mismatch' | 'receiver_mismatch' | 'provider_unavailable') {
    this.mockScenario = scenario;
  }

  public async verify(input: SlipVerificationInput): Promise<SlipVerificationResult> {
    if (this.mockScenario === 'provider_unavailable') {
      return {
        requiresManualReview: true,
        isValid: false,
        provider: 'mock',
        code: 'SLIP_VERIFICATION_UNAVAILABLE',
        reason: 'Verification service temporarily unavailable',
      };
    }

    if (this.mockScenario === 'invalid') {
      return {
        requiresManualReview: false,
        isValid: false,
        provider: 'mock',
        code: 'SLIP_VERIFICATION_FAILED',
        reason: 'Invalid slip or fake payment evidence',
      };
    }

    if (this.mockScenario === 'amount_mismatch') {
      return {
        requiresManualReview: false,
        isValid: false,
        provider: 'mock',
        code: 'SLIP_AMOUNT_MISMATCH',
        verifiedAmount: '100.00',
        reason: 'Verified amount does not match expected bill amount',
      };
    }

    if (this.mockScenario === 'receiver_mismatch') {
      return {
        requiresManualReview: false,
        isValid: false,
        provider: 'mock',
        code: 'SLIP_RECEIVER_MISMATCH',
        reason: 'Verified receiver account does not match dormitory account',
      };
    }

    return {
      requiresManualReview: false,
      isValid: true,
      provider: 'mock',
      providerReference: `MOCK-SLIP-${Date.now()}`,
      verifiedAmount: input.expectedAmount || '1000.00',
      verifiedPaidAt: new Date(),
      verifiedReceiver: input.expectedReceiverAccount || 'Dormitory Account',
      reason: 'Verified successfully via mock provider',
    };
  }
}

export class SlipOkVerificationProviderSkeleton implements SlipVerificationProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string = process.env.SLIPOK_API_KEY || '', baseUrl: string = process.env.SLIPOK_API_BASE_URL || 'https://api.slipok.com/api/line/apikey') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  public async verify(_input: SlipVerificationInput): Promise<SlipVerificationResult> {
    if (!this.apiKey) {
      return {
        requiresManualReview: true,
        isValid: false,
        provider: 'slipok',
        code: 'SLIP_VERIFICATION_UNAVAILABLE',
        reason: 'SlipOK API key is not configured',
      };
    }

    // Skeleton implementation
    return {
      requiresManualReview: true,
      isValid: false,
      provider: 'slipok',
      reason: 'SlipOK live integration deferred to staging',
    };
  }
}

export class PaymentDuplicateDetectionService {
  private paymentRepo: InMemoryPaymentRepository;

  constructor(paymentRepo: InMemoryPaymentRepository) {
    this.paymentRepo = paymentRepo;
  }

  public async checkDuplicate(
    dormitoryId: string,
    params: {
      sha256?: string;
      transactionReference?: string;
      qrPayloadHash?: string;
    }
  ): Promise<{ isDuplicate: boolean; code?: string; message?: string }> {
    if (params.sha256) {
      const existingSha = await this.paymentRepo.findEvidenceBySha256(dormitoryId, params.sha256);
      if (existingSha) {
        return {
          isDuplicate: true,
          code: 'DUPLICATE_PAYMENT_EVIDENCE',
          message: 'หลักฐานการชำระเงินนี้เคยถูกใช้ในระบบแล้ว',
        };
      }
    }

    if (params.transactionReference) {
      const existingTx = await this.paymentRepo.findEvidenceByTransactionReference(dormitoryId, params.transactionReference);
      if (existingTx) {
        return {
          isDuplicate: true,
          code: 'DUPLICATE_TRANSACTION_REFERENCE',
          message: 'หมายเลขอ้างอิงรายการโอนนี้ถูกใช้ในระบบแล้ว',
        };
      }
    }

    if (params.qrPayloadHash) {
      const existingQr = await this.paymentRepo.findEvidenceByQrHash(dormitoryId, params.qrPayloadHash);
      if (existingQr) {
        return {
          isDuplicate: true,
          code: 'DUPLICATE_QR_REFERENCE',
          message: 'สลิปหรือรหัส QR นี้เคยถูกสแกนในระบบแล้ว',
        };
      }
    }

    return { isDuplicate: false };
  }
}
