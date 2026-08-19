/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams
} from 'react-router-dom';

import { LandingPage } from './pages/public/LandingPage';
import { FeaturesPage } from './pages/public/FeaturesPage';
import { PricingPage } from './pages/public/PricingPage';
import { HowItWorksPage } from './pages/public/HowItWorksPage';
import { HelpPage } from './pages/public/HelpPage';
import { TermsPage } from './pages/public/TermsPage';
import { PrivacyPage } from './pages/public/PrivacyPage';

import { OwnerLoginPage } from './pages/auth/OwnerLoginPage';
import { StaffAccessPage } from './pages/StaffAccessPage';

import { OnboardingWizard } from './pages/onboarding/OnboardingWizard';

import { OwnerWorkspace } from './pages/owner';
import { TenantWorkspace } from './pages/tenant';
import { TenantRegisterPage } from './pages/tenant/TenantRegisterPage';

import { OwnerAuthGuard, TenantAuthGuard, AuthContext } from './router/guards';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, clearDormitoryQueryCache } from './lib/queryClient';
import { meterDraftStore } from './lib/meterDraftStore';

import { User } from './types';
import { ShieldAlert, Copy } from 'lucide-react';

const OwnerWorkspaceContainer: React.FC = () => {
  const navigate = useNavigate();
  const session = React.useContext(AuthContext);

  if (!session || session.userType !== 'owner' || !session.user) {
    return <Navigate to="/auth/owner" replace />;
  }

  const handleLogout = async () => {
    localStorage.removeItem('selected_dormitory_id');
    localStorage.removeItem('registered_dorm_profile');
    sessionStorage.removeItem('active_dormitory_selected_for_session');
    clearDormitoryQueryCache();
    meterDraftStore.clearAllDrafts();
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    navigate('/auth/owner');
  };

  return <OwnerWorkspace user={session.user} onLogout={handleLogout} />;
};

// Wrapper for Protected Tenant Workspace
const TenantWorkspaceContainer: React.FC = () => {
  const navigate = useNavigate();
  const session = React.useContext(AuthContext);

  if (!session || session.userType !== 'tenant' || !session.tenant) {
    return <Navigate to="/" replace />;
  }

  const handleLogout = () => {
    try {
      fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    navigate('/');
  };

  return <TenantWorkspace tenant={session.tenant} onLogout={handleLogout} />;
};

export default function App() {
  const [tokenError, setTokenError] = useState<string | null>(null);

  const isDemoAllowed =
    (import.meta as any).env?.VITE_ENABLE_DEMO === 'true' &&
    (import.meta as any).env?.MODE !== 'production';

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public Pages */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route
            path="/demo"
            element={
              isDemoAllowed ? (
                <React.Suspense fallback={<div>Loading...</div>}>
                  <Navigate to="/" replace />
                </React.Suspense>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          {/* Authentication Routes */}
          <Route
            path="/auth/owner"
            element={
              <OwnerLoginPage
                onLoginSuccess={() => {
                  // Handled via server session
                }}
              />
            }
          />
          <Route path="/register" element={<Navigate to="/auth/owner" replace />} />
          <Route path="/tenant/login" element={<Navigate to="/" replace />} />
          <Route path="/tenant/register" element={<TenantRegisterPage />} />
          <Route path="/tenant/claim" element={<TenantRegisterPage />} />
          <Route path="/tenant/daily-request" element={<TenantRegisterPage />} />
          <Route path="/staff-access" element={<StaffAccessPage />} />

          {/* Owner Onboarding Redirect to Owner Register */}
          <Route path="/onboarding/*" element={<Navigate to="/owner/register" replace />} />

          {/* Owner Workspace (Protected) */}
          <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
          <Route
            path="/owner/*"
            element={
              <OwnerAuthGuard>
                <OwnerWorkspaceContainer />
              </OwnerAuthGuard>
            }
          />

          {/* Tenant Workspace (Protected) */}
          <Route path="/tenant" element={<Navigate to="/tenant/dashboard" replace />} />
          <Route
            path="/tenant/*"
            element={
              <TenantAuthGuard>
                <TenantWorkspaceContainer />
              </TenantAuthGuard>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

