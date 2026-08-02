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

import { OnboardingWizard } from './pages/onboarding/OnboardingWizard';

import { DemoPortal } from './pages/demo';
import { OwnerWorkspace } from './pages/owner';
import { TenantWorkspace } from './pages/tenant';

import {
  getDemoSession,
  clearDemoSession,
  setOwnerDemoSession,
  setTenantDemoSession
} from './demo/demoSession';

import { OwnerAuthGuard, TenantAuthGuard, AuthContext } from './router/guards';

import { User, Tenant } from './types';
import { ShieldAlert, Copy } from 'lucide-react';

const OwnerWorkspaceContainer: React.FC = () => {
  const navigate = useNavigate();
  const session = React.useContext(AuthContext);

  if (!session || session.userType !== 'owner' || !session.user) {
    return <Navigate to="/auth/owner" replace />;
  }

  const handleLogout = async () => {
    localStorage.removeItem('selected_dormitory_id');
    sessionStorage.removeItem('active_dormitory_selected_for_session');
    clearDemoSession();
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
  const session = getDemoSession();

  if (!session || session.userType !== 'tenant' || !session.tenant) {
    return <Navigate to="/demo" replace />;
  }

  const handleLogout = () => {
    clearDemoSession();
    navigate('/');
  };

  return <TenantWorkspace tenant={session.tenant} onLogout={handleLogout} />;
};

// Demo Portal Selector Wrapper
const DemoPortalContainer: React.FC = () => {
  const navigate = useNavigate();

  const handleSelectOwner = (user: User) => {
    setOwnerDemoSession(user);
    navigate('/owner/dashboard');
  };

  const handleSelectTenant = (tenant: Tenant) => {
    setTenantDemoSession(tenant);
    navigate('/tenant/dashboard');
  };

  const handleResetDatabase = () => {
    clearDemoSession();
    navigate('/demo');
  };

  return (
    <DemoPortal
      onSelectOwner={handleSelectOwner}
      onSelectTenant={handleSelectTenant}
      onShowGuide={() => navigate('/help')}
      onResetDatabase={handleResetDatabase}
    />
  );
};

export default function App() {
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Initial seed check & token verification
  useEffect(() => {

    // Check for SaaS token in query string
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
      const storedTokensStr = localStorage.getItem('juristic_access_tokens');
      const tokens = storedTokensStr ? JSON.parse(storedTokensStr) : [];
      const foundToken = tokens.find((t: any) => t.id === token);

      if (foundToken) {
        if (foundToken.status === 'deleted') {
          setTokenError('expired_revoked');
        } else {
          const roleIdMap = {
            owner: 'role-owner',
            manager: 'role-manager',
            staff: 'role-staff',
            tech: 'role-tech'
          };
          const roleNameMap = {
            owner: 'เจ้าของระบบ',
            manager: 'ผู้จัดการ',
            staff: 'เจ้าหน้าที่หอ',
            tech: 'ช่างซ่อม'
          };
          const resolvedRole = foundToken.role || 'staff';
          const mockUser: User = {
            id: `token-${resolvedRole}-${token}`,
            name: `ผู้ใช้สิทธิ์ด่วน SaaS (${roleNameMap[resolvedRole as keyof typeof roleNameMap] || 'พนักงาน'})`,
            avatar: resolvedRole === 'owner' 
              ? 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150'
              : resolvedRole === 'manager'
                ? 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'
                : 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
            roleId: roleIdMap[resolvedRole as keyof typeof roleIdMap] || 'role-staff',
            roleName: roleNameMap[resolvedRole as keyof typeof roleNameMap] || 'เจ้าหน้าที่หอ',
            email: `saas.${resolvedRole}@HorPlus.com`,
            description: 'เข้าสู่ระบบด้วยลิงก์สิทธิ์ด่วนสำเร็จ',
            createdAt: new Date().toISOString()
          };

          setOwnerDemoSession(mockUser);
          window.location.href = '/owner/dashboard';
        }
      } else {
        setTokenError('invalid');
      }
    }
  }, []);

  if (tokenError) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700/50 p-8 rounded-3xl max-w-md w-full text-center space-y-6 shadow-xl animate-in fade-in duration-200">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shadow-inner">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-extrabold text-white">หมดอายุ / ถูกตัดสิทธิ์แล้ว</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              ขออภัย ลิงก์สิทธิ์เข้าใช้ระบบด่วน SaaS (Token UUID) นี้หมดอายุการใช้งาน ถูกยกเลิก หรือถูกตัดสิทธิ์การเข้าถึงโดยเจ้าของโครงการแล้ว
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-700/30 p-4 rounded-2xl text-[10px] text-slate-400 font-mono break-all text-left">
            <span className="text-rose-400 font-bold block mb-1">สาเหตุความขัดข้อง:</span>
            {tokenError === 'invalid' ? 'ERR_TOKEN_NOT_FOUND (โทเค็นไม่ตรงกับฐานข้อมูลในระบบ)' : 'ERR_TOKEN_REVOKED (สิทธิ์เข้าถึงถูกยกเลิกถาวร)'}
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete('token');
                window.location.href = '/demo';
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
            >
              กลับสู่พอร์ทัลหลัก (Demo Portal)
            </button>
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                navigator.clipboard.writeText(url.toString()).then(() => {
                  alert('คัดลอกลิงก์เพื่อส่งให้ผู้จัดสรรตรวจสอบเรียบร้อยแล้ว');
                });
              }}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              คัดลอกลิงก์เพื่อส่งตรวจสอบ
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
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
        <Route path="/demo" element={<DemoPortalContainer />} />

        {/* Authentication Routes */}
        <Route
          path="/auth/owner"
          element={
            <OwnerLoginPage
              onLoginSuccess={(user) => {
                setOwnerDemoSession(user);
              }}
            />
          }
        />
        <Route path="/tenant/login" element={<Navigate to="/demo" replace />} />



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
  );
}
