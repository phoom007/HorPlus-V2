/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getDemoSession, setOwnerDemoSession } from '../demo/demoSession';
import { getUsers } from '../data/mockData';

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
    return <Navigate to="/auth/owner" replace />;
  }

  const userMemberships = session.memberships || [];
  const membershipCount = userMemberships.length;

  if (membershipCount === 0) {
    if (location.pathname !== '/owner/register') {
      return <Navigate to="/owner/register" replace />;
    }
  } else {
    // User has 1 or more memberships -> forbid accessing initial onboarding page (/owner/register)
    if (location.pathname === '/owner/register') {
      return <Navigate to="/auth/owner" replace />;
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
      return <Navigate to="/auth/owner" replace />;
    }
  }

  return (
    <AuthContext.Provider value={session}>
      {children || <Outlet />}
    </AuthContext.Provider>
  );
};

export const TenantAuthGuard: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const session = getDemoSession();
  if (!session || session.userType !== 'tenant' || !session.tenant) {
    return <Navigate to="/demo" replace />;
  }
  return <>{children || <Outlet />}</>;
};

export const PublicOnlyGuard: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const session = getDemoSession();
  if (session && session.userType === 'owner' && session.user) {
    return <Navigate to="/owner/dashboard" replace />;
  }
  if (session && session.userType === 'tenant' && session.tenant) {
    return <Navigate to="/tenant/dashboard" replace />;
  }
  return <>{children || <Outlet />}</>;
};
