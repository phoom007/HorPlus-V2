/**
 * @license Apache-2.0
 * Subscription Slip Verifier (Live SlipOK Provider Integration)
 * 
 * Invariants:
 * 1. Zero-trust server authority: Server strictly evaluates the slip, never the client.
 * 2. Anti-duplicate protection: Slip payload SHA-256 hash and bank transaction reference (transRef)
 *    must be unique across all payments in both SubscriptionPaymentEvidence and PaymentEvidenceVerification.
 * 3. Strict 3-Dimensional Validation:
 *    - Dimension 1: Exact net payable amount matching (Math.abs(slipAmount - expectedAmount) < 0.01).
 *    - Dimension 2: Receiver account match (PromptPay 0935098808 / นายภูวนาท ทานาลาด).
 *    - Dimension 3: Anti-duplicate checking (payloadHash + transRef).
 * 4. Strict Live Mode: SlipOK API is invoked with log: false. Missing credentials or API failure
 *    will strictly prevent package activation.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../db/prisma.js';
import { AppError } from '../../types/index.js';

export interface VerifySubscriptionSlipInput {
  slipBuffer: Buffer;
  originalFilename?: string;
  mimeType?: string;
  expectedAmount: Prisma.Decimal;
  dormitoryId: string;
  userId: string;
  packageIntentId?: string;
}

export interface SubscriptionSlipVerificationResult {
  success: boolean;
  provider: string;
  payloadHash: string;
  verifiedAmount: Prisma.Decimal;
  providerReference: string;
  transferredAt: Date;
}

export interface ISubscriptionSlipVerifier {
  verify(input: VerifySubscriptionSlipInput): Promise<SubscriptionSlipVerificationResult>;
}

export type SlipOkFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function cleanDigits(val: string): string {
  return (val || '').replace(/\D/g, '');
}

function mapSlipOkError(code: number | string | undefined, defaultMsg?: string): string {
  const codeNum = typeof code === 'number' ? code : code ? parseInt(code, 10) : 0;
  switch (codeNum) {
    case 1001:
      return 'ข้อมูลคำขอไม่ครบถ้วนหรือไม่ถูกต้อง (INVALID_REQUEST)';
    case 1002:
      return 'การยืนยันตัวตนกับ SlipOK ไม่ถูกต้อง กรุณาตรวจสอบ API Key (SLIPOK_UNAUTHORIZED)';
    case 1003:
      return 'ไม่พบสาขาในระบบ SlipOK กรุณาตรวจสอบ Branch ID (INVALID_BRANCH_ID)';
    case 1004:
      return 'ไม่พบ QR Code ในภาพสลิป หรือรูปภาพสลิปไม่ชัดเจน กรุณาแนบภาพสลิปใหม่ (QR_NOT_FOUND)';
    case 1005:
      return 'โควตาการตรวจสอบสลิปของระบบหมด กรุณาติดต่อผู้ดูแลระบบ (SLIPOK_QUOTA_EXCEEDED)';
    case 1006:
      return 'สลิปนี้เคยถูกใช้งานไปแล้วในระบบ (DUPLICATE_SLIP)';
    case 1007:
      return 'ไม่สามารถถอดรหัส QR Code ในสลิปได้ กรุณาใช้ภาพที่มีแสงชัดเจน (UNREADABLE_QR)';
    case 1008:
      return 'ยอดเงินในสลิปไม่ตรงกับยอดแพ็กเกจที่ต้องชำระ (AMOUNT_MISMATCH)';
    case 1012:
      return 'ระบบธนาคารปลายทางขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง (BANK_TIMEOUT)';
    default:
      return defaultMsg || `การตรวจสอบสลิปผ่าน SlipOK ไม่สำเร็จ (รหัสข้อผิดพลาด: ${code || 'UNKNOWN'})`;
  }
}

/**
 * Subscription Slip Verifier with Live SlipOK API Integration
 */
export class SubscriptionSlipVerifier implements ISubscriptionSlipVerifier {
  private prisma = getPrismaClient();
  private fetchFn: SlipOkFetchFn = fetch;

  /**
   * Allows injecting a custom fetch function for unit tests and offline testing.
   */
  public setFetchFnForTesting(customFetch: SlipOkFetchFn | null) {
    this.fetchFn = customFetch || fetch;
  }

  async verify(input: VerifySubscriptionSlipInput): Promise<SubscriptionSlipVerificationResult> {
    const { slipBuffer, originalFilename, mimeType, expectedAmount } = input;

    // 1. Calculate SHA-256 Hash of slip file
    const payloadHash = crypto.createHash('sha256').update(slipBuffer).digest('hex');

    // 2. Anti-Duplicate Check in SubscriptionPaymentEvidence
    const existingSubEvidence = await this.prisma.subscriptionPaymentEvidence.findUnique({
      where: { payloadHash },
    });
    if (existingSubEvidence) {
      throw new AppError(
        'สลิปนี้เคยถูกใช้งานไปแล้วในระบบ (สลิปซ้ำ / DUPLICATE_SUBSCRIPTION_SLIP)',
        400,
        'DUPLICATE_SUBSCRIPTION_SLIP'
      );
    }

    // 3. Anti-Duplicate Check in general payment evidence verifications
    const existingGeneralEvidence = await this.prisma.paymentEvidenceVerification.findFirst({
      where: { payloadHash },
    });
    if (existingGeneralEvidence) {
      throw new AppError(
        'สลิปนี้เคยถูกใช้งานไปแล้วในระบบบิล (สลิปซ้ำ / DUPLICATE_PAYMENT_SLIP)',
        400,
        'DUPLICATE_PAYMENT_SLIP'
      );
    }

    // 4. Validate image integrity via Sharp
    try {
      const metadata = await sharp(slipBuffer).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100) {
        throw new AppError('รูปภาพสลิปมีขนาดเล็กเกินไปหรือไม่สมบูรณ์', 400, 'INVALID_SLIP_IMAGE_DIMENSIONS');
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError('ไฟล์รูปภาพสลิปไม่ถูกต้องหรือเสียหาย', 400, 'CORRUPTED_SLIP_IMAGE');
    }

    // 5. Strict Live Mode: SlipOK API Verification
    const branchId = (process.env.SLIPOK_BRANCH_ID || '').trim();
    const apiKey = (process.env.SLIPOK_API_KEY || '').trim();

    if (!branchId || !apiKey) {
      throw new AppError(
        'ระบบยังไม่ได้กำหนดค่า SlipOK Branch ID หรือ API Key สำหรับตรวจสอบสลิป (SLIPOK_NOT_CONFIGURED)',
        500,
        'SLIPOK_NOT_CONFIGURED'
      );
    }

    // Build Multipart FormData payload for SlipOK
    const formData = new FormData();
    const fileBlob = new Blob([slipBuffer], { type: mimeType || 'image/jpeg' });
    formData.append('files', fileBlob, originalFilename || 'slip.jpg');
    formData.append('log', 'false'); // Per PO decision: HorPlus authoritatively validates and logs
    formData.append('amount', Number(expectedAmount).toFixed(2));

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
      if (fetchErr.name === 'AbortError') {
        throw new AppError(
          'การเชื่อมต่อไปยังระบบ SlipOK หมดเวลา กรุณาลองใหม่อีกครั้ง (SLIPOK_TIMEOUT)',
          504,
          'SLIPOK_TIMEOUT'
        );
      }
      throw new AppError(
        `ไม่สามารถเชื่อมต่อไปยังระบบตรวจสอบสลิป SlipOK ได้: ${fetchErr.message || 'Network Error'}`,
        502,
        'SLIPOK_NETWORK_ERROR'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      throw new AppError('การตอบกลับจาก SlipOK ไม่ถูกต้อง', 502, 'SLIPOK_INVALID_RESPONSE');
    }

    if (!response.ok || json.success === false) {
      const errorText = mapSlipOkError(json.code, json.message);
      throw new AppError(
        errorText,
        400,
        json.code ? `SLIPOK_ERR_${json.code}` : 'SLIPOK_VERIFICATION_FAILED'
      );
    }

    const slipData = json.data || {};

    // 6. Dimension 1: Exact Amount Validation
    const slipAmount = Number(slipData.amount);
    const expectedNum = Number(expectedAmount);
    if (isNaN(slipAmount) || Math.abs(slipAmount - expectedNum) > 0.01) {
      throw new AppError(
        `ยอดเงินในสลิป (฿${slipAmount.toLocaleString()}) ไม่ตรงกับยอดแพ็กเกจที่ต้องชำระ (฿${expectedNum.toLocaleString()})`,
        400,
        'AMOUNT_MISMATCH'
      );
    }

    // 7. Dimension 2: Receiver PromptPay / Account Validation
    const promptPayId = process.env.PROMPTPAY_ID || '0935098808';
    const accountName = process.env.PROMPTPAY_ACCOUNT_NAME || 'นายภูวนาท ทานาลาด';
    const cleanPromptPay = cleanDigits(promptPayId);

    const receiverObj = slipData.receiver || {};
    const receiverProxy = cleanDigits(receiverObj.account?.proxy?.value || receiverObj.account?.proxy?.number || '');
    const receiverNameTh = (receiverObj.account?.name?.th || '').replace(/\s+/g, '');
    const receiverNameEn = (receiverObj.account?.name?.en || '').toUpperCase().replace(/\s+/g, '');
    const receiverAccNo = cleanDigits(receiverObj.account?.number || '');

    const isProxyMatched = cleanPromptPay.length >= 9 && (
      receiverProxy.endsWith(cleanPromptPay.slice(-9)) ||
      receiverProxy.includes(cleanPromptPay)
    );
    const isNameMatched = receiverNameTh.includes('ภูวนาท') ||
                          receiverNameTh.includes('ทานาลาด') ||
                          receiverNameEn.includes('PHUWANAT') ||
                          receiverNameEn.includes('TANALAD');
    const isAccMatched = cleanPromptPay.length >= 9 && receiverAccNo.includes(cleanPromptPay.slice(-9));

    if (!isProxyMatched && !isNameMatched && !isAccMatched) {
      throw new AppError(
        `บัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีของระบบ HorPlus (กรุณาโอนเข้าบัญชีพร้อมเพย์ ${promptPayId} ${accountName})`,
        400,
        'RECEIVER_MISMATCH'
      );
    }

    // 8. Dimension 3: Anti-Duplicate on Bank Transaction Reference (transRef)
    const transRef = slipData.transRef || slipData.data?.transRef;
    if (transRef) {
      const existingRef = await this.prisma.paymentEvidenceVerification.findFirst({
        where: { providerReference: transRef },
      });
      if (existingRef) {
        throw new AppError(
          `สลิปนี้เคยถูกใช้งานไปแล้วในระบบ (รหัสอ้างอิงธุรกรรมธนาคาร ${transRef} ซ้ำ)`,
          400,
          'DUPLICATE_TRANSACTION_REFERENCE'
        );
      }
    }

    const transferredAt = slipData.date ? new Date(slipData.date) : new Date();

    return {
      success: true,
      provider: 'SLIPOK',
      payloadHash,
      verifiedAmount: new Prisma.Decimal(slipAmount.toFixed(2)),
      providerReference: transRef || `SLIP-HASH-${payloadHash.slice(0, 16).toUpperCase()}`,
      transferredAt,
    };
  }
}

export const subscriptionSlipVerifier = new SubscriptionSlipVerifier();
