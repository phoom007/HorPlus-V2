/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '../data/httpClient';
import { Room, Tenant, Contract, Bill } from '../types';

export type TenantRequestCategory = 'registration' | 'move_out' | 'contract_expired' | 'contract_extension';

export interface TenantRequestItem {
  id: string;
  category: TenantRequestCategory;
  rentType?: 'monthly' | 'daily' | 'term';
  roomId?: string;
  roomNumber: string;
  roomType: string;
  floor: number;
  buildingName: string;
  tenantName: string;
  phone: string;
  idCard?: string;
  lineId?: string;
  lineName?: string;
  email?: string;
  requestedAt: string;
  moveInDate?: string;
  moveOutDate?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  stayDurationText?: string;
  extensionStartDate?: string;
  extensionEndDate?: string;
  deposit: number;
  monthlyRent: number;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
  reason?: string;
  bankInfo?: string;
  accountInfo?: string;
  contractId?: string;
  tenantId?: string;
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  vehicle?: {
    type: string;
    licensePlate: string;
    brand: string;
  };
  vehicles?: {
    id?: string;
    type: string;
    licensePlate: string;
    brand?: string;
  }[];
  pet?: {
    hasPet: boolean;
    type?: string;
    name?: string;
  };
  pets?: {
    id?: string;
    type: string;
    customType?: string;
    name?: string;
  }[];
  coOccupants?: {
    id?: string;
    name: string;
    phone: string;
    citizenId?: string;
    relationship?: string;
  }[];
  idCardPhotoMock?: string;
  idCardPhoto?: string;
  idCardUrl?: string;
  idCardFileName?: string;
  citizenId?: string;
  acceptanceSnapshot?: any;
  rentalType?: 'MONTHLY' | 'TERM' | 'DAILY';
  rentalPlan?: string;
}

export interface DashboardSubscriptionData {
  dormitoryId?: string;
  plan?: {
    code: string;
    name: string;
    type: string;
    roomLimit?: number;
  };
  status?: string;
  expiresAt?: string | null;
  slipsChecked?: number;
  roomCount?: number;
  isTrialEligible?: boolean;
}

export interface AuthoritativeFinancialSummary {
  unpaidBills: Bill[];
  totalUnpaidAmount: number;
  unpaidRoomsCount: number;
}

/**
 * Fetch pending tenant registrations from the backend API.
 */
export async function fetchTenantRegistrations(dormitoryId?: string): Promise<any[]> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  try {
    const res = await httpRequest<any>('GET', '/tenant-registrations', undefined, { headers });
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  } catch (err) {
    console.error('Failed to fetch tenant registrations:', err);
    return [];
  }
}

/**
 * Fetch tenant move-out requests from the backend API.
 */
export async function fetchMoveOutRequests(dormitoryId?: string): Promise<any[]> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  try {
    const res = await httpRequest<any>('GET', '/tenant-move-out-requests', undefined, { headers });
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  } catch {
    try {
      const fallback = await httpRequest<any>('GET', '/move-out/tenant-move-out-requests', undefined, { headers });
      if (Array.isArray(fallback)) return fallback;
      if (fallback && Array.isArray(fallback.data)) return fallback.data;
      return [];
    } catch (err) {
      console.error('Failed to fetch move-out requests:', err);
      return [];
    }
  }
}

/**
 * Fetch contract renewal requests from the backend API.
 */
export async function fetchContractRenewals(dormitoryId?: string): Promise<any[]> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  try {
    const res = await httpRequest<any>('GET', '/contract-renewals/requests', undefined, { headers });
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    return [];
  } catch (err) {
    console.error('Failed to fetch contract renewals:', err);
    return [];
  }
}

/**
 * Fetch current subscription status and remaining lifespan.
 */
export async function fetchCurrentSubscription(dormitoryId?: string): Promise<DashboardSubscriptionData | null> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  try {
    const res = await httpRequest<any>('GET', '/subscription/current', undefined, { headers });
    return res?.data || res || null;
  } catch {
    try {
      const fallback = await httpRequest<any>('GET', '/subscriptions/current', undefined, { headers });
      return fallback?.data || fallback || null;
    } catch (err) {
      console.error('Failed to fetch subscription details:', err);
      return null;
    }
  }
}

/**
 * Approve a tenant registration request.
 */
export async function approveTenantRegistration(
  dormitoryId: string | undefined,
  requestId: string,
  payload?: any
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  return await httpRequest('POST', `/tenant-registrations/${requestId}/approve`, payload || {}, { headers });
}

/**
 * Reject a tenant registration request.
 */
export async function rejectTenantRegistration(
  dormitoryId: string | undefined,
  requestId: string,
  reason?: string
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  return await httpRequest('POST', `/tenant-registrations/${requestId}/reject`, { reason }, { headers });
}

/**
 * Reassign room for a pending tenant registration request.
 */
export async function reassignTenantRegistrationRoom(
  dormitoryId: string | undefined,
  requestId: string,
  targetRoomId: string
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  return await httpRequest('POST', `/tenant-registrations/${requestId}/reassign-room`, { targetRoomId }, { headers });
}

/**
 * Approve a contract renewal request.
 */
export async function approveContractRenewal(
  dormitoryId: string | undefined,
  requestId: string,
  payload?: any
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  return await httpRequest('POST', `/contract-renewals/requests/${requestId}/approve`, payload || {}, { headers });
}

/**
 * Reject a contract renewal request.
 */
export async function rejectContractRenewal(
  dormitoryId: string | undefined,
  requestId: string,
  reason?: string
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  return await httpRequest('POST', `/contract-renewals/requests/${requestId}/reject`, { reason }, { headers });
}

/**
 * Terminate a tenancy / complete move-out request via administrative override.
 */
export async function terminateMoveOutTenancy(
  dormitoryId: string | undefined,
  requestId: string,
  payload: {
    actualEndedAt?: string;
    emergencyReason?: string;
    reviewedByUserId?: string;
    actorRole?: string;
  }
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  const body = {
    dormitoryId,
    emergencyReason: payload.emergencyReason || 'นิติดำเนินการเลิกเช่าคืนห้องพัก',
    actualEndedAt: payload.actualEndedAt || new Date().toISOString().split('T')[0],
    reviewedByUserId: payload.reviewedByUserId || 'system',
    actorRole: payload.actorRole || 'OWNER',
    ...payload,
  };
  try {
    return await httpRequest('POST', `/tenant-move-out-requests/${requestId}/emergency-terminate`, body, { headers });
  } catch {
    return await httpRequest('POST', `/move-out/tenant-move-out-requests/${requestId}/emergency-terminate`, body, { headers });
  }
}

/**
 * Update room details in backend database.
 */
export async function updateDashboardRoom(
  dormitoryId: string | undefined,
  roomId: string,
  changes: any,
  expectedVersion: number = 1
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  const body: Record<string, any> = {
    ...changes,
    expectedVersion,
  };
  if ('monthlyRent' in changes && changes.monthlyRent != null && changes.monthlyRent !== '') {
    body.monthlyRent = String(changes.monthlyRent);
  }
  if ('termRent' in changes && changes.termRent != null && changes.termRent !== '') {
    body.termRent = String(changes.termRent);
  }
  if ('dailyRent' in changes && changes.dailyRent != null && changes.dailyRent !== '') {
    body.dailyRent = String(changes.dailyRent);
  }
  if ('monthlyDeposit' in changes && changes.monthlyDeposit != null && changes.monthlyDeposit !== '') {
    body.monthlyDeposit = String(changes.monthlyDeposit);
  }
  if ('termDeposit' in changes && changes.termDeposit != null && changes.termDeposit !== '') {
    body.termDeposit = String(changes.termDeposit);
  }
  if ('dailyDeposit' in changes && changes.dailyDeposit != null && changes.dailyDeposit !== '') {
    body.dailyDeposit = String(changes.dailyDeposit);
  }
  return await httpRequest('PUT', `/properties/rooms/${roomId}`, body, { headers });
}

/**
 * Archive room from dashboard.
 */
export async function archiveDashboardRoom(
  dormitoryId: string | undefined,
  roomId: string,
  expectedVersion: number = 1
): Promise<any> {
  const headers = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;
  return await httpRequest('DELETE', `/properties/rooms/${roomId}`, { expectedVersion }, { headers });
}

/**
 * Helper to aggregate real requests from backend APIs and expiring contracts into a unified list.
 */
export function aggregateTenantRequests(params: {
  registrations?: any[];
  moveOutRequests?: any[];
  renewals?: any[];
  contracts?: Contract[];
  rooms?: Room[];
  tenants?: Tenant[];
}): TenantRequestItem[] {
  const {
    registrations = [],
    moveOutRequests = [],
    renewals = [],
    contracts = [],
    rooms = [],
    tenants = []
  } = params;

  const results: TenantRequestItem[] = [];
  const processedRoomCategories = new Set<string>();

  // 1. Backend Tenant Registrations
  registrations.forEach((reg) => {
    const room = rooms.find((r) => r.id === reg.requestedRoomId || r.roomNumber === reg.roomNumber || r.id === reg.roomId);
    const roomNumber = reg.roomNumber || room?.roomNumber || reg.room?.number || reg.room?.roomNumber || '101';
    const roomType = reg.roomType || room?.roomType || room?.type || 'Standard';
    const floor = reg.floor || room?.floor || 1;
    const buildingName = reg.buildingName || room?.buildingName || room?.building || 'อาคาร A';
    const fullName = reg.tenantName || [reg.firstName, reg.lastName].filter(Boolean).join(' ') || 'ผู้ขอเช่า';

    const snap = reg.acceptanceSnapshot || {};
    const effectiveCitizenId = reg.citizenId || snap.citizenId || reg.nationalId;
    const rawType = String(snap.rentalPlan || reg.rentalPlan || room?.rentCycle || 'monthly').toUpperCase();
    const rentType: 'monthly' | 'daily' | 'term' = rawType === 'DAILY' ? 'daily' : rawType === 'TERM' ? 'term' : 'monthly';
    const rentalType: 'MONTHLY' | 'TERM' | 'DAILY' = rawType === 'DAILY' ? 'DAILY' : rawType === 'TERM' ? 'TERM' : 'MONTHLY';
    const effectiveIdCardPhoto = snap.idCardImageUrl || reg.idCardPhoto || reg.idCardImageUrl || (reg.id ? `/api/v1/tenant-registrations/${reg.id}/identity-document` : undefined);
    const effectiveIdCardFileName = snap.idCardDocument?.filename || (snap.attachments && snap.attachments[0]?.name) || reg.idCardFileName;

    const reqItem: TenantRequestItem = {
      id: reg.id || `reg-${Date.now()}`,
      category: 'registration',
      rentType,
      rentalType,
      rentalPlan: snap.rentalPlan || reg.rentalPlan,
      roomId: room?.id || reg.requestedRoomId,
      roomNumber,
      roomType,
      floor,
      buildingName,
      tenantName: fullName,
      phone: reg.phone || '-',
      idCard: effectiveCitizenId,
      citizenId: effectiveCitizenId,
      lineId: reg.lineId,
      lineName: reg.lineDisplayName || reg.lineName,
      email: reg.email,
      requestedAt: reg.submittedAt ? new Date(reg.submittedAt).toISOString() : (reg.createdAt ? new Date(reg.createdAt).toISOString() : new Date().toISOString()),
      moveInDate: reg.startDate || reg.moveInDate || snap.startDate,
      contractStartDate: reg.startDate || snap.startDate,
      deposit: Number(reg.proposedDeposit ?? snap.proposedDeposit ?? snap.depositAmount ?? room?.depositAmount ?? 0),
      monthlyRent: Number(reg.proposedRent ?? snap.proposedRent ?? room?.monthlyRent ?? 0),
      status: reg.status === 'pending_owner_approval' ? 'pending' : ((reg.status || 'pending').toLowerCase() as any),
      note: reg.note,
      emergencyContact: reg.emergencyContact || snap.emergencyContact,
      vehicle: reg.vehicle || snap.vehicle,
      vehicles: reg.vehicles || snap.vehicles,
      pet: reg.pet || snap.pet,
      pets: reg.pets || snap.pets,
      coOccupants: reg.coOccupants || snap.coOccupants,
      idCardPhoto: effectiveIdCardPhoto,
      idCardUrl: effectiveIdCardPhoto,
      idCardFileName: effectiveIdCardFileName,
      acceptanceSnapshot: snap,
    };

    results.push(reqItem);
    processedRoomCategories.add(`registration-${roomNumber}`);
  });

  // 2. Backend Move-out Requests
  moveOutRequests.forEach((mo) => {
    const contract = contracts.find((c) => c.id === mo.contractId);
    const room = rooms.find((r) => r.id === mo.roomId || r.id === contract?.roomId);
    const tenant = tenants.find((t) => t.id === mo.tenantId || t.id === contract?.tenantId);
    const roomNumber = mo.roomNumber || room?.roomNumber || '101';

    const reqItem: TenantRequestItem = {
      id: mo.id || `moveout-${Date.now()}`,
      category: 'move_out',
      rentType: (contract?.rentType as any) || 'monthly',
      roomId: room?.id || mo.roomId,
      roomNumber,
      roomType: room?.roomType || room?.type || 'Standard',
      floor: room?.floor || 1,
      buildingName: room?.buildingName || room?.building || 'อาคาร A',
      tenantName: mo.tenantName || tenant?.name || 'ผู้เช่า',
      phone: mo.phone || tenant?.phone || '-',
      idCard: tenant?.citizenId,
      requestedAt: mo.createdAt ? new Date(mo.createdAt).toISOString() : new Date().toISOString(),
      moveOutDate: mo.intendedMoveOutDate || mo.moveOutDate,
      contractStartDate: contract?.startDate,
      contractEndDate: contract?.endDate,
      deposit: Number(contract?.depositAmount ?? room?.depositAmount ?? 0),
      monthlyRent: Number(contract?.monthlyRent ?? room?.monthlyRent ?? 0),
      status: (mo.status || 'pending').toLowerCase() as any,
      reason: mo.reason || 'ผู้เช่ายื่นความประสงค์ขอยกเลิกการเช่าห้องพัก',
      bankInfo: mo.bankInfo || mo.refundBank,
      accountInfo: mo.accountInfo || mo.refundAccount,
      contractId: contract?.id || mo.contractId,
      tenantId: tenant?.id || mo.tenantId,
    };

    results.push(reqItem);
    processedRoomCategories.add(`move_out-${roomNumber}`);
  });

  // 3. Backend Contract Renewal Requests
  renewals.forEach((ren) => {
    const contract = contracts.find((c) => c.id === ren.contractId);
    const room = rooms.find((r) => r.id === contract?.roomId);
    const tenant = tenants.find((t) => t.id === ren.tenantId || t.id === contract?.tenantId);
    const roomNumber = room?.roomNumber || ren.roomNumber || '101';

    const reqItem: TenantRequestItem = {
      id: ren.id || `renewal-${Date.now()}`,
      category: 'contract_extension',
      rentType: (contract?.rentType as any) || 'monthly',
      roomId: room?.id,
      roomNumber,
      roomType: room?.roomType || room?.type || 'Standard',
      floor: room?.floor || 1,
      buildingName: room?.buildingName || room?.building || 'อาคาร A',
      tenantName: ren.tenantName || tenant?.name || 'ผู้เช่า',
      phone: ren.phone || tenant?.phone || '-',
      idCard: tenant?.citizenId,
      requestedAt: ren.createdAt ? new Date(ren.createdAt).toISOString() : new Date().toISOString(),
      extensionStartDate: ren.requestedStartDate,
      stayDurationText: ren.requestedDurationMonths ? `${ren.requestedDurationMonths} เดือน` : undefined,
      contractStartDate: contract?.startDate,
      contractEndDate: contract?.endDate,
      deposit: Number(contract?.depositAmount ?? room?.depositAmount ?? 0),
      monthlyRent: Number(contract?.monthlyRent ?? room?.monthlyRent ?? 0),
      status: (ren.status || 'pending').toLowerCase() as any,
      reason: 'ผู้เช่ายื่นคำขอต่อสัญญาเช่า',
      contractId: contract?.id || ren.contractId,
      tenantId: tenant?.id || ren.tenantId,
    };

    results.push(reqItem);
    processedRoomCategories.add(`contract_extension-${roomNumber}`);
  });

  // 4. Contracts nearing expiration or waiting extension in database
  contracts.forEach((c) => {
    if (c.status === 'expired' || c.status === 'checking_out' || c.status === 'waiting_extension') {
      const room = rooms.find((r) => r.id === c.roomId);
      const tenant = tenants.find((t) => t.id === c.tenantId);
      const roomNumber = room?.roomNumber || '101';
      const isExpired = c.status === 'expired';
      const isExtension = c.status === 'waiting_extension';
      const cat: TenantRequestCategory = isExtension ? 'contract_extension' : (isExpired ? 'contract_expired' : 'move_out');

      if (!processedRoomCategories.has(`${cat}-${roomNumber}`)) {
        results.push({
          id: `contract-${c.id}`,
          category: cat,
          rentType: (c.rentType as any) || 'monthly',
          roomId: room?.id,
          roomNumber,
          roomType: room?.roomType || room?.type || 'Standard',
          floor: room?.floor || 1,
          buildingName: room?.buildingName || room?.building || 'อาคาร A',
          tenantName: tenant?.name || 'ผู้เช่า',
          phone: tenant?.phone || '-',
          idCard: tenant?.citizenId,
          requestedAt: c.endDate || new Date().toISOString(),
          contractStartDate: c.startDate,
          contractEndDate: c.endDate,
          moveOutDate: isExpired ? c.endDate : undefined,
          deposit: Number(c.depositAmount ?? room?.depositAmount ?? 0),
          monthlyRent: Number(c.monthlyRent ?? room?.monthlyRent ?? 0),
          status: 'pending',
          reason: isExtension ? 'ผู้เช่ายื่นคำขอต่อสัญญาเช่า' : (isExpired ? 'สัญญาเช่าครบกำหนดระยะเวลา' : 'ผู้เช่าแจ้งขอยกเลิกการเช่าห้องพัก'),
          note: isExtension ? 'รอนิติอนุมัติหรือทำเรื่องต่อสัญญาใหม่' : (isExpired ? 'สัญญาหมดอายุแล้ว รอดำเนินการต่อสัญญาหรือทำเรื่องคืนห้องพัก' : 'อยู่ระหว่างขั้นตอนการย้ายออก'),
          contractId: c.id,
          tenantId: tenant?.id,
        });
        processedRoomCategories.add(`${cat}-${roomNumber}`);
      }
    }
  });

  return results.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
}

/**
 * Strict Authoritative Financial Calculation:
 * Sums only active, uncollected bills in the selected billing cycle with zero estimation heuristics.
 */
export function calculateAuthoritativeUnpaidFinancials(
  bills: Bill[],
  rooms: Room[],
  selectedCycle?: string,
  billingCycleId?: string
): AuthoritativeFinancialSummary {
  // Filter bills matching the selected cycle
  const currentMonthBills = bills.filter((b) => {
    if (billingCycleId && b.billingCycleId) {
      return b.billingCycleId === billingCycleId;
    }
    if (selectedCycle) {
      return b.month === selectedCycle || (b as any).billingCycleCode === selectedCycle || (b as any).cycleCode === selectedCycle || (b as any).cycleId === selectedCycle;
    }
    return true;
  });

  // Authoritative uncollected bills: status is not paid / PAID and outstanding amount > 0
  const unpaidBills = currentMonthBills.filter((b) => {
    const statusNormalized = (b.status || '').toLowerCase();
    const isPaid = statusNormalized === 'paid';
    const amount = Number(b.outstandingAmount !== undefined ? b.outstandingAmount : (b.totalAmount - (b.paidAmount || 0)));
    return !isPaid && amount > 0;
  });

  // Calculate sum of exact outstanding amounts (zero +500 estimation)
  const totalUnpaidAmount = unpaidBills.reduce((acc, b) => {
    const amount = Number(b.outstandingAmount !== undefined ? b.outstandingAmount : (b.totalAmount - (b.paidAmount || 0)));
    return acc + (amount > 0 ? amount : 0);
  }, 0);

  return {
    unpaidBills,
    totalUnpaidAmount,
    unpaidRoomsCount: unpaidBills.length,
  };
}
