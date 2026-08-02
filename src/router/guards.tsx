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
    fetch('/api/v1/auth/session')
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

  // If user has active memberships, forbid accessing initial onboarding page (/owner/register)
  if (session.memberships && session.memberships.length >= 1) {
    if (location.pathname === '/owner/register') {
      return <Navigate to="/auth/owner" replace />;
    }
    const hasSelectedInSession = sessionStorage.getItem('active_dormitory_selected_for_session');
    if (!hasSelectedInSession) {
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
