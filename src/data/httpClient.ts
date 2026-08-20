/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DomainError, DomainErrorCode } from './contracts';
import { getApiBaseUrl } from './dataMode';

export interface HttpClientOptions {
  headers?: Record<string, string>;
  dormitoryId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryOnSafeMethodCount?: number;
}

export class HttpClientError extends Error {
  public domainError: DomainError;

  constructor(domainError: DomainError) {
    super(domainError.message);
    this.name = 'HttpClientError';
    this.domainError = domainError;
  }
}

function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)horplus_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function mapStatusToDomainCode(status: number): DomainErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'RESOURCE_NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 503:
      return 'DEPENDENCY_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function getDefaultThaiErrorMessage(code: DomainErrorCode, status: number): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
    case 'UNAUTHORIZED':
      return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง';
    case 'FORBIDDEN':
      return 'คุณไม่มีสิทธิ์ดำเนินการทำรายการนี้';
    case 'DORMITORY_ACCESS_DENIED':
      return 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้';
    case 'RESOURCE_NOT_FOUND':
      return 'ไม่พบข้อมูลที่ต้องการในระบบ';
    case 'CONFLICT':
      return 'ข้อมูลมีความขัดแย้งหรือซ้ำซ้อนกับในระบบ';
    case 'CONTRACT_OVERLAP':
      return 'ช่วงเวลาสัญญาเช่าซ้ำซ้อนกับสัญญาอื่นในห้องพักเดียวกัน';
    case 'ROOM_LIMIT_EXCEEDED':
      return 'จำนวนห้องพักเกินโควต้าแพ็กเกจปัจจุบัน';
    case 'DUPLICATE_BILL':
      return 'มีการออกใบแจ้งหนี้สำหรับห้องและงวดนี้ไปแล้ว';
    case 'DUPLICATE_SLIP':
      return 'มีการแนบหลักฐานการชำระเงินสำหรับบิลนี้ไปแล้ว';
    case 'PAYMENT_ALREADY_PROCESSED':
      return 'รายการชำระเงินนี้ได้รับการดำเนินการไปแล้ว';
    case 'DEPENDENCY_UNAVAILABLE':
      return 'ระบบเซิร์ฟเวอร์ยังไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง';
    default:
      return `เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ (HTTP ${status})`;
  }
}

export function buildRequestUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  let cleanPath = path.replace(/^\//, '');
  if ((cleanBase.endsWith('/api/v1') || cleanBase === '/api/v1') && cleanPath.startsWith('api/v1/')) {
    cleanPath = cleanPath.substring(7);
  }
  return `${cleanBase}/${cleanPath}`;
}

export async function httpRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: any,
  options: HttpClientOptions = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  let url = buildRequestUrl(baseUrl, path);
  if (['GET', 'HEAD'].includes(method) && body && typeof body === 'object' && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) {
        params.append(k, String(v));
      }
    }
    const queryString = params.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const rawCallerHeaders = options.headers || {};
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    Accept: 'application/json',
    'X-Request-Id': `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  };

  // Extract any caller-supplied dormitory header case-insensitively and strip duplicate keys
  let callerDormId: string | undefined;
  for (const [k, v] of Object.entries(rawCallerHeaders)) {
    if (k.toLowerCase() === 'x-dormitory-id') {
      callerDormId = v;
    } else {
      headers[k] = v;
    }
  }

  // Authoritative dormitory resolution with fail-fast on conflicting non-empty IDs
  if (options.dormitoryId && callerDormId && options.dormitoryId !== callerDormId) {
    throw new Error(
      `Conflicting dormitory IDs provided in options.dormitoryId ("${options.dormitoryId}") and headers ("${callerDormId}")`
    );
  }

  const dormId =
    options.dormitoryId ||
    callerDormId ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') : undefined) ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('active_dormitory_selected_for_session') : undefined);

  if (dormId) {
    headers['X-Dormitory-Id'] = dormId;
  }

  if (options.idempotencyKey && ['POST', 'PUT', 'PATCH'].includes(method)) {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'x-idempotency-key') delete headers[k];
    }
    headers['X-Idempotency-Key'] = options.idempotencyKey;
  }

  // Automatic CSRF token injection for mutation operations
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const hasCsrf = Object.keys(headers).some((k) => k.toLowerCase() === 'x-csrf-token');
    if (!hasCsrf) {
      const csrfToken = getCsrfTokenFromCookie();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }
  }

  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const fetchOptions: RequestInit = {
    method,
    headers,
    credentials: 'include',
    signal: options.signal || controller.signal
  };

  if (!['GET', 'HEAD'].includes(method)) {
    if (isFormData) {
      fetchOptions.body = body;
    } else if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }
  }

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let responseData: any = null;

    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      const code = mapStatusToDomainCode(response.status);
      const serverMsg = typeof responseData === 'object' && responseData?.message
        ? responseData.message
        : (typeof responseData === 'object' && responseData?.error?.message ? responseData.error.message : getDefaultThaiErrorMessage(code, response.status));

      const errorObj: DomainError = {
        code,
        message: serverMsg,
        details: typeof responseData === 'object' ? responseData : { raw: responseData }
      };

      throw new HttpClientError(errorObj);
    }

    return responseData as T;
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err instanceof HttpClientError) {
      throw err;
    }

    if (err.name === 'AbortError') {
      throw new HttpClientError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'การเชื่อมต่อหมดเวลา (Request Timeout)'
      });
    }

    throw new HttpClientError({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ REST API ได้'
    });
  }
}
