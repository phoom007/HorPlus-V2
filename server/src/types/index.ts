export interface ErrorDetail {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]> | null;
  requestId: string;
  timestamp: string;
}

export interface StandardErrorEnvelope {
  error: ErrorDetail;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly code: string;
  public readonly fieldErrors?: Record<string, string[]> | null;

  constructor(message: string, statusCode = 500, errorCode = 'INTERNAL_ERROR', fieldErrors?: Record<string, string[]> | null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.code = errorCode;
    this.fieldErrors = fieldErrors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]> | null) {
    super(message, 400, 'VALIDATION_ERROR', fieldErrors);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'ไม่พบเส้นทางหรือทรัพยากรที่ร้องขอ') {
    super(message, 404, 'ROUTE_NOT_FOUND');
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(message: string, errorCode = 'DEPENDENCY_UNAVAILABLE') {
    super(message, 503, errorCode);
  }
}
