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
