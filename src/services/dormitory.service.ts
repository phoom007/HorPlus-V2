/**
 * Dormitory Profile Shared API Client Service
 * Uses authoritative shared httpRequest client (handles CSRF, credentials, headers, error throwing).
 * @license Apache-2.0
 */

import { httpRequest } from '../data/httpClient';

export interface DormitoryProfileDTO {
  id: string;
  name: string;
  code: string;
  type: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
  logoUrl?: string | null;
  hasLogo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateDormitoryProfilePayload {
  name?: string;
  type?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  taxId?: string | null;
}

export async function getDormitoryProfile(dormitoryId: string): Promise<DormitoryProfileDTO> {
  const res = await httpRequest<{ data: DormitoryProfileDTO }>('GET', `/dormitories/${dormitoryId}`, undefined, {
    dormitoryId,
  });
  return res.data;
}

export async function updateDormitoryProfile(
  dormitoryId: string,
  payload: UpdateDormitoryProfilePayload
): Promise<DormitoryProfileDTO> {
  const res = await httpRequest<{ data: DormitoryProfileDTO }>('PATCH', `/dormitories/${dormitoryId}`, payload, {
    dormitoryId,
  });
  return res.data;
}

export async function getDormitorySignatureUrl(dormitoryId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/v1/dormitories/${dormitoryId}/signature`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'x-dormitory-id': dormitoryId,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function uploadDormitorySignature(
  dormitoryId: string,
  signatureBase64: string
): Promise<{ success: boolean; data?: any }> {
  const res = await httpRequest<{ data?: any }>(
    'POST',
    `/dormitories/${dormitoryId}/signature`,
    { signatureBase64 },
    { dormitoryId }
  );
  return { success: true, data: res.data };
}

export async function deleteDormitorySignature(dormitoryId: string): Promise<boolean> {
  const res = await httpRequest<{ success: boolean; deactivated?: boolean }>(
    'DELETE',
    `/dormitories/${dormitoryId}/signature`,
    undefined,
    { dormitoryId }
  );
  return res?.success ?? false;
}
