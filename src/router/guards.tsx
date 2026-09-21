/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  extractTenantTokenFromUrl,
  cleanLiffStateFromUrl,
  isTokenConsumed,
  markTokenConsumed
} from '../utils/liffToken';

export const AuthContext = React.createContext<any>(null);

export const OwnerAuthGuard: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [session, setSession] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch('/api/v1/auth/session', { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(json => {
        const payload = json.data;
        if (payload?.csrfToken && typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('horplus_csrf', payload.csrfToken);
        }
        if (payload && payload.user) {
          const memberships = payload.memberships || [];
          setSession({ 
            userType: 'owner', 
            user: { ...payload.user, memberships }, 
            memberships,
            dormitoryId: memberships[0]?.dormitoryId,
            onboardingRequired: payload.onboardingRequired 
          });
        } else {
          setSession(null);
        }
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading session...</div>;
  }

  if (!session || session.userType !== 'owner' || !session.user) {
    return <Navigate to={`/auth/owner${location.search}`} replace />;
  }

  const userMemberships = session.memberships || [];
  const activeMemberships = userMemberships.filter((m: any) => !m.status || String(m.status).toLowerCase() === 'active');
  const membershipCount = activeMemberships.length;

  if (session.onboardingRequired || membershipCount === 0) {
    if (location.pathname !== '/owner/register') {
      return <Navigate to={`/owner/register${location.search}`} replace />;
    }
  } else {
    // If authenticated owner is adding a new dormitory, allow access to add dorm route
    if (location.pathname === '/owner/dormitories/new' || location.pathname.startsWith('/owner/dormitories/new')) {
      return (
        <AuthContext.Provider value={session}>
          {children || <Outlet />}
        </AuthContext.Provider>
      );
    }

    // User has completed onboarding and has 1 or more memberships -> forbid accessing initial onboarding page (/owner/register)
    if (location.pathname === '/owner/register') {
      return <Navigate to={`/auth/owner${location.search}`} replace />;
    }

    const storedDormId = sessionStorage.getItem('active_dormitory_selected_for_session') 
      || localStorage.getItem('selected_dormitory_id');

    // Confirm storedDormId belongs to current active memberships (validate & reject stale/foreign values)
    const isStoredValid = storedDormId && userMemberships.some((m: any) => m.dormitoryId === storedDormId);

    let activeDormId: string | null = null;
    if (isStoredValid) {
      activeDormId = storedDormId;
    } else {
      if (storedDormId) {
        sessionStorage.removeItem('active_dormitory_selected_for_session');
        localStorage.removeItem('selected_dormitory_id');
      }
      // If exactly 1 membership, defaulting to that single membership is acceptable
      if (membershipCount === 1) {
        activeDormId = userMemberships[0].dormitoryId;
        localStorage.setItem('selected_dormitory_id', activeDormId!);
      } else {
        // BR-003: 2+ memberships with no valid stored selection -> MUST NOT use memberships[0]
        // Require explicit dormitory selection via login/selection UI
        activeDormId = null;
      }
    }

    if (!activeDormId) {
      return <Navigate to={`/auth/owner${location.search}`} replace />;
    }
  }

  return (
    <AuthContext.Provider value={session}>
      {children || <Outlet />}
    </AuthContext.Provider>
  );
};

export const TenantAuthGuard: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    // 1. Direct Entry Token Bridge: check if ?t= or ?token= or liff.state is present in URL
    const token = extractTenantTokenFromUrl();
    if (token) {
      if (!isTokenConsumed(token)) {
        markTokenConsumed(token);
        cleanLiffStateFromUrl();
        window.location.replace(`/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(token)}`);
        return;
      }
    }
    cleanLiffStateFromUrl();

    fetch('/api/v1/tenant-portal/profile', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        const rawTenant = json?.data?.tenant || (json?.id ? json : null);
        if (rawTenant) {
          const realFullName = (rawTenant.firstName && rawTenant.firstName !== '-')
            ? `${rawTenant.firstName} ${rawTenant.lastName && rawTenant.lastName !== '-' ? rawTenant.lastName : ''}`.trim()
            : '';
          const effectiveName = realFullName || rawTenant.displayName || rawTenant.name || 'ผู้เช่า';
          const tenantData = {
            ...rawTenant,
            name: effectiveName,
          };
          setSession({ userType: 'tenant', tenant: tenantData, user: tenantData });
        } else {
          setSession(null);
        }
      })
      .catch(() => {
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white font-sans text-xs">Loading tenant portal...</div>;
  }

  if (!session || session.userType !== 'tenant' || !session.tenant) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center font-sans">
        <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-3xl flex items-center justify-center mb-5 text-indigo-600 shadow-sm">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <h2 className="text-lg font-black text-slate-800 mb-2">ยินดีต้อนรับสู่ระบบผู้เช่า HorPlus</h2>
        <p className="text-slate-500 text-xs max-w-sm mb-6 leading-relaxed">
          ไม่พบข้อมูลเซสชันผู้เช่าในอุปกรณ์นี้ กรุณากดปุ่มเมนูใน LINE OA ของหอพักเพื่อเข้าสู่ระบบ หรือลงทะเบียนเช่าห้องพักใหม่
        </p>
        <div className="flex flex-col w-full max-w-xs gap-2.5">
          <a
            href="/tenant/register"
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black shadow-md shadow-indigo-200 text-center transition-all cursor-pointer"
          >
            ลงทะเบียนผู้เช่าใหม่
          </a>
          <button
            type="button"
            onClick={() => {
              try {
                if (typeof window !== 'undefined' && (window as any).liff) {
                  (window as any).liff.closeWindow();
                }
              } catch {}
              window.location.replace('/');
            }}
            className="w-full py-3 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-2xl text-xs font-bold text-center transition-all cursor-pointer"
          >
            กลับสู่หน้าหลัก
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={session}>
      {children || <Outlet />}
    </AuthContext.Provider>
  );
};

export const PublicOnlyGuard: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children || <Outlet />}</>;
};

