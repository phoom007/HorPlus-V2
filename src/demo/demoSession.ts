/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User, Tenant } from '../types';
import { seedDatabase } from '../data/mockData';

export interface DemoSession {
  sessionId: string;
  userType: 'owner' | 'tenant';
  user?: User;
  tenant?: Tenant;
  dormitoryId?: string;
  role?: string;
  createdAt: string;
  expiresAt: string;
  isDemo: true;
}

export interface OnboardingDraft {
  step: number;
  dormitoryName: string;
  dormitoryType: string;
  address: string;
  province: string;
  district: string;
  zipcode: string;
  phone: string;
  email: string;
  buildingCount: number;
  approxRoomCount: number;
  billingDate: number;
  dueDate: number;
  waterRate: number;
  electricRate: number;
  commonFee: number;
  internetFee: number;
  lateFeePerDay: number;
  promptPayType: string;
  promptPayNumber: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  cashOnly: boolean;
  selectedPlan: string;
  promoCode: string;
  isPromoApplied: boolean;
  termsAccepted: boolean;
  updatedAt: string;
}

const SESSION_KEY = 'HorPlus_demo_session';
const ONBOARDING_KEY = 'HorPlus_demo_onboarding';
const INVITES_KEY = 'HorPlus_demo_invites';
const ROUTE_KEY = 'HorPlus_demo_route';

export const initialOnboardingDraft: OnboardingDraft = {
  step: 1,
  dormitoryName: '',
  dormitoryType: 'หอพักสตรี/ชายทั่วไป',
  address: '',
  province: 'กรุงเทพมหานคร',
  district: '',
  zipcode: '',
  phone: '',
  email: '',
  buildingCount: 1,
  approxRoomCount: 20,
  billingDate: 25,
  dueDate: 5,
  waterRate: 18,
  electricRate: 8,
  commonFee: 200,
  internetFee: 0,
  lateFeePerDay: 50,
  promptPayType: 'mobile',
  promptPayNumber: '',
  accountName: '',
  bankName: 'ธนาคารกสิกรไทย',
  accountNumber: '',
  cashOnly: false,
  selectedPlan: 'micro',
  promoCode: '',
  isPromoApplied: false,
  termsAccepted: false,
  updatedAt: new Date().toISOString()
};

export function getDemoSession(): DemoSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      clearDemoSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setOwnerDemoSession(user: User): DemoSession {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const session: DemoSession = {
    sessionId: `sess_owner_${Date.now()}`,
    userType: 'owner',
    user,
    role: (user as any).role || (user.roleId === 'role-owner' ? 'owner' : 'staff'),
    dormitoryId: 'dorm-001',
    createdAt: new Date().toISOString(),
    expiresAt: expires,
    isDemo: true
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function setTenantDemoSession(tenant: Tenant): DemoSession {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const session: DemoSession = {
    sessionId: `sess_tenant_${Date.now()}`,
    userType: 'tenant',
    tenant,
    dormitoryId: 'dorm-001',
    createdAt: new Date().toISOString(),
    expiresAt: expires,
    isDemo: true
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function clearDemoSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getOnboardingDraft(): OnboardingDraft {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return { ...initialOnboardingDraft };
    return { ...initialOnboardingDraft, ...JSON.parse(raw) };
  } catch {
    return { ...initialOnboardingDraft };
  }
}

export function saveOnboardingDraft(draft: Partial<OnboardingDraft>): OnboardingDraft {
  const current = getOnboardingDraft();
  const updated = {
    ...current,
    ...draft,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(updated));
  return updated;
}

export function clearOnboardingDraft(): void {
  localStorage.removeItem(ONBOARDING_KEY);
}

export function resetAllHorPlusDemoData(): void {
  // Clear HorPlus demo storage keys
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem(INVITES_KEY);
  localStorage.removeItem(ROUTE_KEY);
  
  // Re-seed mock database cleanly
  seedDatabase(true);
}
