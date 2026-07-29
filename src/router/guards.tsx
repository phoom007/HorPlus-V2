/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getDemoSession, setOwnerDemoSession } from '../demo/demoSession';
import { getUsers } from '../data/mockData';

export const OwnerAuthGuard: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const session = getDemoSession();
  
  if (!session || session.userType !== 'owner' || !session.user) {
    if (location.pathname === '/owner/register') {
      const users = getUsers();
      const defaultOwner = users.find(u => u.roleId === 'role-owner') || users[0];
      setOwnerDemoSession(defaultOwner);
      return <>{children || <Outlet />}</>;
    }
    return <Navigate to="/auth/owner" replace />;
  }
  return <>{children || <Outlet />}</>;
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
