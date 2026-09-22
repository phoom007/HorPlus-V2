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
import {
  extractTenantTokenFromUrl,
  extractLiffDestinationPath,
  cleanLiffStateFromUrl,
  isTokenConsumed,
  markTokenConsumed,
  isTicketConsumed,
  markTicketConsumed
} from './utils/liffToken';
import { initLiff } from './utils/liff';
import { TenantRegisterPage } from './pages/tenant/TenantRegisterPage';
import { OwnerDirectEntryPage } from './pages/owner/OwnerDirectEntryPage';

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
    sessionStorage.removeItem('is_direct_access_grant');
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

  useEffect(() => {
    initLiff().catch(() => {});

    // Allow OwnerDirectEntryPage to manage its own ticket extraction and handshake without race conditions
    if (window.location.pathname === '/owner/direct-entry') {
      return;
    }

    // 1. LIFF deep-link destination handling (when LINE passes liff.state to Endpoint URL)
    const destinationPath = extractLiffDestinationPath();
    if (destinationPath) {
      cleanLiffStateFromUrl();

      const tokenMatch = destinationPath.match(/(?:[?&])(?:t|token)=([^&#]+)/i);
      if (tokenMatch && tokenMatch[1]) {
        const rawToken = tokenMatch[1].trim();
        if (!isTokenConsumed(rawToken)) {
          markTokenConsumed(rawToken);
          window.location.replace(`/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(rawToken)}`);
          return;
        }
      }

      const ticketMatch = destinationPath.match(/(?:[?&])ticket=([^&#]+)/i);
      if (ticketMatch && ticketMatch[1]) {
        const rawTicket = ticketMatch[1].trim();
        if (!isTicketConsumed(rawTicket)) {
          markTicketConsumed(rawTicket);
          window.location.replace(`/api/v1/auth/line-direct-entry?ticket=${encodeURIComponent(rawTicket)}`);
          return;
        }
      }

      // If destinationPath points to where we already are (e.g. /tenant or /owner/home), do NOT call window.location.replace to prevent infinite reload loops
      const currentFull = window.location.pathname + window.location.search;
      if (destinationPath !== window.location.pathname && destinationPath !== currentFull) {
        window.history.replaceState({}, '', destinationPath);
      }
      return;
    }

    // 2. Direct owner ticket check on ANY path: ?ticket=
    const urlParams = new URLSearchParams(window.location.search);
    const ownerTicket = urlParams.get('ticket');
    if (ownerTicket && ownerTicket.trim()) {
      const rawTicket = ownerTicket.trim();
      cleanLiffStateFromUrl();
      if (!isTicketConsumed(rawTicket)) {
        markTicketConsumed(rawTicket);
        window.location.replace(`/api/v1/auth/line-direct-entry?ticket=${encodeURIComponent(rawTicket)}`);
        return;
      }
    }

    // 3. Direct tenant token check: ?t= or ?token= on ANY path
    const token = extractTenantTokenFromUrl({ ignoreConsumed: true });
    if (token) {
      markTokenConsumed(token);
      cleanLiffStateFromUrl();
      window.location.replace(`/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(token)}`);
      return;
    }
  }, []);

  // Global guard against LINE In-App Browser pull-to-close / swipe-down dismiss
  // Explicitly preserves custom Bottom Sheet swipe gestures
  useEffect(() => {
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!e.touches || e.touches.length === 0) return;
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - touchStartY;

      // Prevent LINE In-App Browser pull-to-close on Bottom Sheet drag gestures
      const target = e.target as HTMLElement | null;
      const isBottomSheet = Boolean(
        target?.closest(
          '[data-testid="tenant-bottom-sheet"], [data-testid="tenant-claim-bottom-sheet"], [data-bottom-sheet="true"], .bottom-sheet-container'
        )
      );
      if (isBottomSheet) {
        if (deltaY > 0 && e.cancelable) {
          e.preventDefault();
        }
        return;
      }

      // Find closest scrollable ancestor
      let el = target;
      let scrollable: HTMLElement | null = null;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        if (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight
        ) {
          scrollable = el;
          break;
        }
        el = el.parentElement;
      }

      // 1. If dragging on fixed/non-scrollable elements: prevent LINE pull-to-close
      if (!scrollable) {
        if (deltaY > 0 && e.cancelable) {
          e.preventDefault();
        }
        return;
      }

      // 2. If scrollable container is already at the top (scrollTop <= 0) and dragging downward:
      // prevent elastic overscroll bounce that causes LINE to close the in-app browser
      if (scrollable.scrollTop <= 0 && deltaY > 0) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

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
          <Route path="/owner/direct-entry" element={<OwnerDirectEntryPage />} />
          <Route path="/owner" element={<Navigate to="/owner/home" replace />} />
          <Route path="/owner/dashboard" element={<Navigate to="/owner/home" replace />} />
          <Route path="/owner/settings/line-oa" element={<Navigate to="/owner/line-oa" replace />} />
          <Route
            path="/owner/*"
            element={
              <OwnerAuthGuard>
                <OwnerWorkspaceContainer />
              </OwnerAuthGuard>
            }
          />

          {/* Tenant Workspace (Protected) */}
          <Route path="/tenant/tenant/*" element={<Navigate to="/tenant" replace />} />
          <Route path="/tenant/tenant" element={<Navigate to="/tenant" replace />} />
          <Route
            path="/tenant"
            element={
              <TenantAuthGuard>
                <TenantWorkspaceContainer />
              </TenantAuthGuard>
            }
          />
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

