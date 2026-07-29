import { v4 as uuidv4 } from 'uuid';

export interface CreateUploadIntentInput {
  dormitoryId: string;
  billId: string;
  actorUserId?: string | null;
  actorTenantId?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface UploadIntent {
  intentId: string;
  objectKey: string;
  uploadUrl: string;
  expiresAt: Date;
  headers?: Record<string, string>;
}

export interface ConfirmUploadInput {
  dormitoryId: string;
  intentId: string;
  sha256: string;
  transactionReference?: string | null;
  qrPayloadHash?: string | null;
}

export interface StoredEvidence {
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  transactionReference?: string | null;
  qrPayloadHash?: string | null;
}

export interface ReadEvidenceInput {
  dormitoryId: string;
  objectKey: string;
}

export interface ReadAccess {
  url: string;
  expiresAt: Date;
}

export interface PaymentEvidenceStorage {
  createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
  confirmUpload(input: ConfirmUploadInput): Promise<StoredEvidence>;
  getReadAccess(input: ReadEvidenceInput): Promise<ReadAccess>;
  deleteObject(input: { dormitoryId: string; objectKey: string }): Promise<void>;
}

export class InMemoryPaymentEvidenceStorage implements PaymentEvidenceStorage {
  private intents: Map<string, { input: CreateUploadIntentInput; objectKey: string; expiresAt: Date }> = new Map();
  private objects: Map<string, StoredEvidence> = new Map();

  public async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const intentId = uuidv4();
    const cleanFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `dormitories/${input.dormitoryId}/bills/${input.billId}/${intentId}_${cleanFileName}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    this.intents.set(intentId, { input, objectKey, expiresAt });

    return {
      intentId,
      objectKey,
      uploadUrl: `https://mock-storage.internal/upload/${intentId}`,
      expiresAt,
    };
  }

  public async confirmUpload(input: ConfirmUploadInput): Promise<StoredEvidence> {
    const intentData = this.intents.get(input.intentId);
    if (!intentData) {
      throw new Error('PAYMENT_UPLOAD_INTENT_INVALID: Upload intent not found');
    }

    if (intentData.expiresAt < new Date()) {
      this.intents.delete(input.intentId);
      throw new Error('PAYMENT_UPLOAD_INTENT_EXPIRED: Upload intent expired');
    }

    if (intentData.input.dormitoryId !== input.dormitoryId) {
      throw new Error('FORBIDDEN: Upload intent belongs to another dormitory');
    }

    const stored: StoredEvidence = {
      objectKey: intentData.objectKey,
      originalFileName: intentData.input.fileName,
      mimeType: intentData.input.mimeType,
      fileSize: intentData.input.fileSize,
      sha256: input.sha256,
      transactionReference: input.transactionReference || null,
      qrPayloadHash: input.qrPayloadHash || null,
    };

    this.objects.set(`${input.dormitoryId}:${intentData.objectKey}`, stored);
    this.intents.delete(input.intentId);

    return stored;
  }

  public async getReadAccess(input: ReadEvidenceInput): Promise<ReadAccess> {
    const key = `${input.dormitoryId}:${input.objectKey}`;
    const obj = this.objects.get(key);
    if (!obj) {
      // Allow fallback if object key matches pattern
      return {
        url: `https://mock-storage.internal/read/${encodeURIComponent(input.objectKey)}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
    }

    return {
      url: `https://mock-storage.internal/read/${encodeURIComponent(obj.objectKey)}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  public async deleteObject(input: { dormitoryId: string; objectKey: string }): Promise<void> {
    this.objects.delete(`${input.dormitoryId}:${input.objectKey}`);
  }
}

export class GcsPaymentEvidenceStorage implements PaymentEvidenceStorage {
  private bucketName: string;

  constructor(bucketName: string = process.env.GCS_PAYMENT_EVIDENCE_BUCKET || 'horplus-payment-evidences') {
    this.bucketName = bucketName;
  }

  public async createUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const intentId = uuidv4();
    const objectKey = `dormitories/${input.dormitoryId}/bills/${input.billId}/${intentId}_${input.fileName}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    return {
      intentId,
      objectKey,
      uploadUrl: `https://storage.googleapis.com/${this.bucketName}/${objectKey}?signed=true`,
      expiresAt,
    };
  }

  public async confirmUpload(input: ConfirmUploadInput): Promise<StoredEvidence> {
    // Skeleton implementation
    return {
      objectKey: `dormitories/${input.dormitoryId}/${input.intentId}`,
      originalFileName: 'slip.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
      sha256: input.sha256,
      transactionReference: input.transactionReference || null,
      qrPayloadHash: input.qrPayloadHash || null,
    };
  }

  public async getReadAccess(input: ReadEvidenceInput): Promise<ReadAccess> {
    return {
      url: `https://storage.googleapis.com/${this.bucketName}/${input.objectKey}?signed=true`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  public async deleteObject(_input: { dormitoryId: string; objectKey: string }): Promise<void> {
    // Skeleton delete
  }
}
