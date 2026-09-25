/**
 * @license Apache-2.0
 * Tenant Payment Evidence Verifier (Live SlipOK Provider Integration)
 *
 * Core Architecture & Security:
 * 1. Pluggable PaymentEvidenceVerifier implementing provider-neutral verification.
 * 2. Dimension 1: Exact Amount Validation against expected bill/group amount (0 discrepancy allowed).
 * 3. Dimension 2: Receiver PromptPay / Bank Account Validation strictly against DormitoryBillingSettings (N-03).
 *    NEVER mixes with HorPlus Platform PromptPay (0935098808).
 * 4. Image Security: Decompression bomb protection (max 4096x4096, max 16MP) and sanitization.
 * 5. Fail-Safe: When unconfigured (no API credentials or offline dev), returns UNVERIFIED allowing manual review/override.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { Decimal } from 'decimal.js';
import { getPrismaClient } from '../../db/prisma.js';
import { localStorageProvider } from '../../services/local-storage.service.js';
import { PaymentEvidenceVerifier } from './payment-evidence-verifier.js';
import { PaymentEvidenceVerificationResult, VerifyEvidenceInput } from './types.js';

export type SlipOkFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function cleanDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

export function normalizeThaiName(name: string | null | undefined): string {
  if (!name) return '';
  let str = name.trim().toLowerCase();
  // Strip common Thai titles / honorifics
  const prefixes = [
    /^นางสาว\s*/,
    /^น\.ส\.\s*/,
    /^น\.ส\s*/,
    /^นาย\s*/,
    /^นาง\s*/,
    /^ด\.ช\.\s*/,
    /^ด\.ญ\.\s*/,
    /^เด็กชาย\s*/,
    /^เด็กหญิง\s*/,
    /^บจก\.\s*/,
    /^บจก\s*/,
    /^บริษัท\s*/,
    /^หจก\.\s*/,
    /^หจก\s*/,
    /^ห้างหุ้นส่วนจำกัด\s*/,
    /^mr\.\s*/,
    /^mr\s*/,
    /^miss\s*/,
    /^ms\.\s*/,
    /^ms\s*/,
    /^mrs\.\s*/,
    /^mrs\s*/,
  ];
  for (const prefix of prefixes) {
    str = str.replace(prefix, '');
  }
  // Replace punctuation/dots with space, and collapse whitespace
  return str.replace(/[.,\-_/\\()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isSmartRecipientNameMatch(
  configuredName: string | null | undefined,
  slipReceiverName: string | null | undefined
): boolean {
  if (!configuredName || !slipReceiverName) return false;

  const normConf = normalizeThaiName(configuredName);
  const normSlip = normalizeThaiName(slipReceiverName);

  if (!normConf || !normSlip) return false;

  // 1. Exact match (without spaces)
  const compactConf = normConf.replace(/\s+/g, '');
  const compactSlip = normSlip.replace(/\s+/g, '');
  if (compactConf === compactSlip) return true;

  // 2. Tokenized matching (e.g. "ภูวนาท ทานาลาด" vs "ภูวนาท ท" or "ภูวนาท")
  const confTokens = normConf.split(' ').filter(t => t.length > 0);
  const slipTokens = normSlip.split(' ').filter(t => t.length > 0);

  if (confTokens.length === 0 || slipTokens.length === 0) return false;

  const confFirst = confTokens[0];
  const slipFirst = slipTokens[0];

  // If first names match (must be at least 2 chars)
  if (confFirst.length >= 2 && slipFirst.length >= 2 && (confFirst === slipFirst || confFirst.includes(slipFirst) || slipFirst.includes(confFirst))) {
    // If either side has only 1 token (e.g. "ภูวนาท"), and first name matches (>= 3 chars)
    if (confTokens.length === 1 || slipTokens.length === 1) {
      if (confFirst === slipFirst || (confFirst.length >= 3 && slipFirst.length >= 3 && (confFirst.startsWith(slipFirst) || slipFirst.startsWith(confFirst)))) {
        return true;
      }
    }

    // Both have last name tokens
    const confLast = confTokens.slice(1).join('');
    const slipLast = slipTokens.slice(1).join('');

    // Last name matches, or one is prefix of the other (e.g. "ท" is prefix of "ทานาลาด")
    if (confLast && slipLast) {
      const confStrip = confLast.replace(/^[เแโใไ]/, '');
      const slipStrip = slipLast.replace(/^[เแโใไ]/, '');
      if (
        confLast === slipLast ||
        confLast.startsWith(slipLast) ||
        slipLast.startsWith(confLast) ||
        confStrip.startsWith(slipLast) ||
        slipStrip.startsWith(confLast) ||
        confLast.startsWith(slipStrip) ||
        slipLast.startsWith(confStrip) ||
        confStrip.startsWith(slipStrip) ||
        slipStrip.startsWith(confStrip)
      ) {
        return true;
      }
    }
  }

  // Check substring containment if long enough (>= 4 chars)
  if (compactConf.length >= 4 && compactSlip.length >= 4) {
    if (compactConf.includes(compactSlip) || compactSlip.includes(compactConf)) {
      return true;
    }
  }

  return false;
}

function mapSlipOkError(code: number | string | undefined, defaultMsg?: string): string {
  const c = String(code);
  switch (c) {
    case '1001':
      return 'รูปแบบไฟล์สลิปไม่ถูกต้อง หรือไม่สามารถเปิดไฟล์รูปภาพได้';
    case '1002':
      return 'ขนาดไฟล์สลิปเกินขีดจำกัดที่กำหนด';
    case '1003':
      return 'ไม่พบคิวอาร์โค้ดในสลิป หรือไม่ใช่สลิปธนาคารมาตรฐาน';
    case '1004':
      return 'คิวอาร์โค้ดในสลิปไม่ถูกต้องหรือหมดอายุการใช้งาน';
    case '1005':
      return 'ไม่พบข้อมูลสลิปนี้ในเครือข่ายธนาคาร';
    case '1006':
      return 'สลิปนี้หมดอายุการตรวจสอบตามเกณฑ์ของธนาคาร';
    case '1007':
      return 'ข้อมูลในสลิปไม่ครบถ้วนหรือไม่สามารถระบุธุรกรรมได้';
    case '1008':
      return 'บัญชีธนาคารปลายทางไม่ตรงกับเงื่อนไข';
    case '1011':
      return 'สลิปนี้เคยถูกส่งตรวจสอบไปแล้ว (สลิปซ้ำ)';
    case '1012':
      return 'เครือข่ายธนาคารขัดข้องชั่วคราว ไม่สามารถตรวจสอบสลิปได้';
    case '1013':
      return 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ';
    default:
      return defaultMsg || `การตรวจสอบสลิปล้มเหลว (รหัส: ${code || 'UNKNOWN'})`;
  }
}

export class SlipOkPaymentEvidenceVerifier implements PaymentEvidenceVerifier {
  private prisma: any;
  private fetchFn: SlipOkFetchFn = fetch;
  private branchId?: string;
  private apiKey?: string;

  constructor(options?: {
    branchId?: string;
    apiKey?: string;
    prismaClient?: any;
    fetchFn?: SlipOkFetchFn;
  }) {
    this.branchId = options?.branchId;
    this.apiKey = options?.apiKey;
    this.prisma = options?.prismaClient || getPrismaClient();
    if (options?.fetchFn) {
      this.fetchFn = options.fetchFn;
    }
  }

  /**
   * For testing or custom mock fetch injection
   */
  public setFetchFnForTesting(customFetch: SlipOkFetchFn | null) {
    this.fetchFn = customFetch || fetch;
  }

  async verify(input: VerifyEvidenceInput): Promise<PaymentEvidenceVerificationResult> {
    const { dormitoryId, evidenceObjectKey, evidenceBuffer, expectedAmount, claimedTransferAt } = input;

    // 1. Obtain slip buffer
    let buffer: Buffer | null = evidenceBuffer || (input as any).fileBuffer || null;
    if (!buffer && evidenceObjectKey) {
      try {
        buffer = await localStorageProvider.getFile(evidenceObjectKey);
      } catch (err) {
        return {
          provider: 'SLIPOK',
          status: 'UNVERIFIED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: null,
          providerReference: null,
          payloadHash: input.payloadHash || null,
          errorReason: 'EVIDENCE_FILE_NOT_FOUND',
        };
      }
    }

    if (!buffer || buffer.length === 0) {
      return {
        provider: 'SLIPOK',
        status: 'UNVERIFIED',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: null,
        payloadHash: input.payloadHash || null,
        errorReason: 'MISSING_EVIDENCE_BUFFER',
      };
    }

    const payloadHash = input.payloadHash || crypto.createHash('sha256').update(buffer).digest('hex');

    // 2. Validate image via Sharp with Decompression Bomb Protection
    try {
      const metadata = await sharp(buffer, {
        failOnError: true,
        limitInputPixels: 16_777_216,
        sequentialRead: true,
      }).metadata();

      if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
        return {
          provider: 'SLIPOK',
          status: 'REJECTED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: null,
          providerReference: null,
          payloadHash,
          errorReason: 'INVALID_SLIP_IMAGE_DIMENSIONS',
        };
      }

      if (metadata.width > 4096 || metadata.height > 4096) {
        return {
          provider: 'SLIPOK',
          status: 'REJECTED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: null,
          providerReference: null,
          payloadHash,
          errorReason: 'DIMENSIONS_EXCEEDED',
        };
      }
    } catch (err: any) {
      return {
        provider: 'SLIPOK',
        status: 'REJECTED',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: null,
        payloadHash,
        errorReason: 'CORRUPTED_SLIP_IMAGE',
      };
    }

    // 3. Check API credentials (fail-safe to UNVERIFIED if unconfigured)
    const branchId = (this.branchId || process.env.SLIPOK_BRANCH_ID || '').trim();
    const apiKey = (this.apiKey || process.env.SLIPOK_API_KEY || '').trim();

    if (!branchId || !apiKey) {
      return {
        provider: 'SLIPOK',
        status: 'UNVERIFIED',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: null,
        payloadHash,
        errorReason: 'SLIPOK_NOT_CONFIGURED',
      };
    }

    // 4. Fetch Dormitory Billing Settings (Authoritative Receiver for N-03)
    const settings = await this.prisma.dormitoryBillingSettings.findFirst({
      where: { dormitoryId },
      select: {
        promptPayValue: true,
        promptPayAccountName: true,
        bankCode: true,
        bankAccountNumber: true,
        bankAccountName: true,
      },
    });

    const dormPromptPay = cleanDigits(settings?.promptPayValue);
    const dormBankAcc = cleanDigits(settings?.bankAccountNumber);

    // 5. Build Multipart FormData request for SlipOK
    const formData = new FormData();
    const fileBlob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('files', fileBlob, 'slip.jpg');
    formData.append('log', 'false');
    if (expectedAmount) {
      formData.append('amount', Number(expectedAmount.toString()).toFixed(2));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await this.fetchFn(`https://api.slipok.com/api/line/apikey/${branchId}`, {
        method: 'POST',
        headers: {
          'x-authorization': apiKey,
        },
        body: formData,
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      return {
        provider: 'SLIPOK',
        status: 'ERROR',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: null,
        payloadHash,
        errorReason: 'ระบบตรวจสอบสลิปขัดข้องชั่วคราว กรุณาแนบสลิปใหม่อีกครั้ง',
      };
    } finally {
      clearTimeout(timeoutId);
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      return {
        provider: 'SLIPOK',
        status: 'ERROR',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: null,
        payloadHash,
        errorReason: 'ระบบตรวจสอบสลิปขัดข้องชั่วคราว กรุณาแนบสลิปใหม่อีกครั้ง',
      };
    }

    const isSlipOkCode1014WithData = (json.code === 1014 || json.code === '1014') && json.data && json.data.transRef;
    if ((!response.ok || json.success === false) && !isSlipOkCode1014WithData) {
      // Fallback 2: Quota exhausted (HTTP 402, 429, or quota-related codes/messages)
      const isQuotaError =
        response.status === 402 ||
        response.status === 429 ||
        String(json?.code) === '1009' ||
        String(json?.code) === '1010' ||
        String(json?.message || '').toLowerCase().includes('quota') ||
        String(json?.message || '').toLowerCase().includes('credit');

      if (isQuotaError) {
        return {
          provider: 'SLIPOK',
          status: 'UNVERIFIED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: null,
          providerReference: json.data?.transRef || null,
          payloadHash,
          errorReason: 'SLIPOK_QUOTA_EXHAUSTED: โควตา SlipOK ของระบบหมด กรุณาตรวจสอบสลิปด้วยตนเอง',
        };
      }

      const errorText = mapSlipOkError(json.code, json.message);
      return {
        provider: 'SLIPOK',
        status: 'REJECTED',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: null,
        providerReference: json.data?.transRef || null,
        payloadHash,
        errorReason: errorText,
      };
    }

    const slipData = json.data || {};

    // 6. Dimension 1: Exact Amount Validation
    const slipAmount = Number(slipData.amount);
    if (expectedAmount) {
      const expectedNum = Number(expectedAmount.toString());
      if (isNaN(slipAmount) || Math.abs(slipAmount - expectedNum) > 0.01) {
        return {
          provider: 'SLIPOK',
          status: 'REJECTED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: !isNaN(slipAmount) ? new Decimal(slipAmount.toFixed(2)) : null,
          providerReference: slipData.transRef || null,
          payloadHash,
          errorReason: `AMOUNT_MISMATCH: ยอดเงินในสลิป (${slipAmount}) ไม่ตรงกับยอดที่ต้องชำระ (${expectedNum})`,
        };
      }
    }

    // 7. Dimension 2: Receiver PromptPay / Bank Account Validation & Smart Recipient Name Matching
    const receiverProxy = cleanDigits(slipData.receiver?.proxy?.value);
    const receiverAccNo = cleanDigits(slipData.receiver?.account?.value || slipData.receiver?.account?.number);

    const slipReceiverNameTh =
      slipData.receiver?.displayName ||
      slipData.receiver?.name ||
      slipData.receiver?.account?.name?.th ||
      slipData.receiver?.account?.name ||
      '';
    const slipReceiverNameEn =
      slipData.receiver?.account?.name?.en ||
      slipData.receiver?.name ||
      slipData.receiver?.displayName ||
      '';

    const isPromptPayNameMatched =
      isSmartRecipientNameMatch(settings?.promptPayAccountName, slipReceiverNameTh) ||
      isSmartRecipientNameMatch(settings?.promptPayAccountName, slipReceiverNameEn);
    const isBankAccountNameMatched =
      isSmartRecipientNameMatch(settings?.bankAccountName, slipReceiverNameTh) ||
      isSmartRecipientNameMatch(settings?.bankAccountName, slipReceiverNameEn);

    const isNameMatched = isPromptPayNameMatched || isBankAccountNameMatched;

    let isAccountMatched = false;
    if (dormPromptPay && dormPromptPay.length >= 4) {
      if (
        (receiverProxy && (dormPromptPay.endsWith(receiverProxy) || receiverProxy.endsWith(dormPromptPay.slice(-4)))) ||
        (receiverAccNo && (dormPromptPay.endsWith(receiverAccNo) || receiverAccNo.endsWith(dormPromptPay.slice(-4))))
      ) {
        isAccountMatched = true;
      }
    }

    if (!isAccountMatched && dormBankAcc && dormBankAcc.length >= 4) {
      if (
        (receiverAccNo && (dormBankAcc.endsWith(receiverAccNo) || receiverAccNo.endsWith(dormBankAcc.slice(-4)))) ||
        (receiverProxy && (dormBankAcc.endsWith(receiverProxy) || receiverProxy.endsWith(dormBankAcc.slice(-4))))
      ) {
        isAccountMatched = true;
      }
    }

    let isReceiverMatched = false;
    if (isAccountMatched && isNameMatched) {
      isReceiverMatched = true;
    } else if (isAccountMatched && !settings?.promptPayAccountName && !settings?.bankAccountName) {
      // Dormitory didn't configure account names, but account number matched
      isReceiverMatched = true;
    } else if (isAccountMatched && !slipReceiverNameTh && !slipReceiverNameEn) {
      // Slip didn't return receiver name, but account number matched
      isReceiverMatched = true;
    } else if (!isAccountMatched && isNameMatched) {
      // Name matched smartly (even if account numbers were masked or proxy differed)
      isReceiverMatched = true;
    } else if (isAccountMatched && (settings?.promptPayAccountName || settings?.bankAccountName) && (slipReceiverNameTh || slipReceiverNameEn)) {
      // Account number matched last digits, BUT names are explicitly present and do NOT match!
      isReceiverMatched = false;
    }

    // If neither PromptPay nor Bank Account is configured on dormitory, or neither matched
    if (!isReceiverMatched) {
      if (!dormPromptPay && !dormBankAcc && !settings?.promptPayAccountName && !settings?.bankAccountName) {
        // Dormitory has not configured receiver accounts in settings
        return {
          provider: 'SLIPOK',
          status: 'UNVERIFIED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: !isNaN(slipAmount) ? new Decimal(slipAmount.toFixed(2)) : null,
          providerReference: slipData.transRef || null,
          payloadHash,
          errorReason: 'DORMITORY_RECEIVER_NOT_CONFIGURED',
        };
      }

      return {
        provider: 'SLIPOK',
        status: 'REJECTED',
        claimedTransferAt: claimedTransferAt ?? null,
        verifiedTransferAt: null,
        verifiedAmount: !isNaN(slipAmount) ? new Decimal(slipAmount.toFixed(2)) : null,
        providerReference: slipData.transRef || null,
        payloadHash,
        errorReason: 'RECEIVER_MISMATCH: บัญชีผู้รับเงินหรือชื่อผู้รับในสลิปไม่ตรงกับบัญชีของหอพัก',
      };
    }

    // 8. Dimension 3: Duplicate Slip Prevention
    if (slipData.transRef) {
      const existingRef = await this.prisma.paymentEvidenceVerification.findFirst({
        where: {
          providerReference: slipData.transRef,
          status: { in: ['VERIFIED', 'APPROVED'] },
        },
      });
      if (existingRef) {
        return {
          provider: 'SLIPOK',
          status: 'REJECTED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: !isNaN(slipAmount) ? new Decimal(slipAmount.toFixed(2)) : null,
          providerReference: slipData.transRef,
          payloadHash,
          errorReason: 'สลิปนี้เคยถูกส่งตรวจสอบไปแล้ว (สลิปซ้ำ)',
        };
      }
    }

    if (payloadHash) {
      const existingHash = await this.prisma.paymentEvidenceVerification.findFirst({
        where: {
          payloadHash,
          status: { in: ['VERIFIED', 'APPROVED'] },
        },
      });
      if (existingHash) {
        return {
          provider: 'SLIPOK',
          status: 'REJECTED',
          claimedTransferAt: claimedTransferAt ?? null,
          verifiedTransferAt: null,
          verifiedAmount: !isNaN(slipAmount) ? new Decimal(slipAmount.toFixed(2)) : null,
          providerReference: slipData.transRef || null,
          payloadHash,
          errorReason: 'สลิปนี้เคยถูกส่งตรวจสอบไปแล้ว (สลิปซ้ำ)',
        };
      }
    }

    // Parse verified transfer date
    let verifiedTransferAt: Date = new Date();
    if (slipData.transDate && slipData.transTime) {
      // Format usually YYYYMMDD and HHmmss
      const d = String(slipData.transDate).replace(/\D/g, '');
      const t = String(slipData.transTime).replace(/\D/g, '');
      if (d.length === 8 && t.length >= 4) {
        const yr = parseInt(d.slice(0, 4), 10);
        const mo = parseInt(d.slice(4, 6), 10) - 1;
        const dy = parseInt(d.slice(6, 8), 10);
        const hr = parseInt(t.slice(0, 2), 10);
        const mn = parseInt(t.slice(2, 4), 10);
        const sc = t.length >= 6 ? parseInt(t.slice(4, 6), 10) : 0;
        verifiedTransferAt = new Date(Date.UTC(yr, mo, dy, hr - 7, mn, sc)); // convert Asia/Bangkok (+07) to UTC Date
      }
    } else if (slipData.transTimestamp) {
      verifiedTransferAt = new Date(slipData.transTimestamp);
    }

    return {
      provider: 'SLIPOK',
      status: 'VERIFIED',
      claimedTransferAt: claimedTransferAt ?? null,
      verifiedTransferAt,
      verifiedAmount: !isNaN(slipAmount) ? new Decimal(slipAmount.toFixed(2)) : (expectedAmount || null),
      providerReference: slipData.transRef || null,
      payloadHash,
      errorReason: null,
    };
  }
}
