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
  status: string;
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
