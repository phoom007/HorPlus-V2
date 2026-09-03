/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  ArrowLeft,
  X,
  Plus,
  MapPin,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { initialUsers } from '../../data/mockData';
import { User as UserType } from '../../types';

interface OwnerLoginPageProps {
  onLoginSuccess: (user: UserType) => void;
}

const DormitoryPickerLogo: React.FC<{ dormitoryId: string; name?: string; logoUrl?: string | null }> = ({
  dormitoryId,
  name,
  logoUrl,
}) => {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Amendment 3: Canonical current-logo authority is public endpoint GET /api/v1/dormitories/:dormitoryId/logo
  const src = logoUrl || `/api/v1/dormitories/${dormitoryId}/logo`;

  if (hasError) {
    return <Building2 className="w-6 h-6 text-indigo-500" />;
  }

  return (
    <>
      {!isLoaded && <Building2 className="w-6 h-6 text-indigo-500 animate-pulse" />}
      <img
        src={src}
        alt={name || 'Dormitory'}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          isLoaded ? 'opacity-100' : 'opacity-0 absolute'
        }`}
      />
    </>
  );
};

export const OwnerLoginPage: React.FC<OwnerLoginPageProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();
  const [showPicker, setShowPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const maxDorms = 10;
  const [userMemberships, setUserMemberships] = useState<any[]>([]);
  const isQuotaFull = userMemberships.length >= maxDorms;

  const rawClientId = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID || '';
  const isGoogleConfigured = Boolean(rawClientId && !rawClientId.includes('PENDING_REAL_CREDENTIALS'));

  const ownerUser = initialUsers.find(u => u.roleId === 'role-owner') || initialUsers[0];

  const loadCanonicalDormitories = async () => {
    try {
      // 1. Canonical authenticated GET /api/v1/dormitories provides authoritative hasLogo & logoUrl
      const dormRes = await fetch('/api/v1/dormitories', { credentials: 'include' });
      if (dormRes.ok) {
        const dormJson = await dormRes.json();
        const dorms = dormJson.data || [];
        if (dorms.length >= 1) {
          const mapped = dorms.map((d: any) => ({
            id: d.id,
            dormitoryId: d.id,
            dormitoryName: d.name,
            name: d.name,
            code: d.code,
            type: d.type,
            roleCode: d.roleCode || 'OWNER',
            status: d.status || 'Active',
            hasLogo: d.hasLogo,
            logoUrl: d.logoUrl,
          }));
          setUserMemberships(mapped);
          setShowPicker(true);
          return mapped;
        }
      }
    } catch {
      // fallback
    }

    // 2. Fallback to /api/v1/auth/session
    try {
      const sessRes = await fetch('/api/v1/auth/session', { credentials: 'include' });
      if (sessRes.ok) {
        const sessJson = await sessRes.json();
        if (sessJson?.data?.user) {
          const memberships = sessJson.data.memberships || sessJson.data.user.memberships || [];
          if (memberships.length >= 1) {
            setUserMemberships(memberships);
            setShowPicker(true);
            return memberships;
          }
        }
      }
    } catch {}

    return null;
  };

  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref');
    if (refParam) {
      sessionStorage.setItem('horplus_referral_code', refParam);
    }

    loadCanonicalDormitories();
  }, []);

  const handleSelectDormitory = (dorm: any) => {
    setIsLoading(true);
    const targetId = dorm.dormitoryId || dorm.id;
    if (targetId) {
      localStorage.setItem('selected_dormitory_id', targetId);
      sessionStorage.setItem('active_dormitory_selected_for_session', targetId);
    }
    setTimeout(() => {
      onLoginSuccess(ownerUser);
      setIsLoading(false);
      navigate('/owner/dashboard');
    }, 300);
  };

  const handleNewOwnerOnboarding = () => {
    if (isQuotaFull) return;
    navigate('/owner/dormitories/new');
  };

  const handleGoogleAuthSuccess = async (credentialResponse: any) => {
    setErrorMessage(null);
    try {
      setIsLoading(true);
      sessionStorage.removeItem('active_dormitory_selected_for_session');

      const urlParams = new URLSearchParams(window.location.search);
      const refParam = urlParams.get('ref') || sessionStorage.getItem('horplus_referral_code') || '';
      const refQuery = refParam ? `?ref=${encodeURIComponent(refParam)}` : '';

      const res = await fetch('/api/v1/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          idToken: credentialResponse.credential,
          intent: 'owner',
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error?.message || 'Login failed');
      }

      const loaded = await loadCanonicalDormitories();
      if (!loaded || loaded.length === 0) {
        if (result.data?.onboardingRequired) {
          navigate(`/owner/register${refQuery}`);
        } else {
          const memberships = result.data?.memberships || [];
          setUserMemberships(memberships);
          setShowPicker(true);
        }
      }
    } catch (err: any) {
      console.error('Google Auth Failed', err);
      setErrorMessage(err.message || 'Google Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const dormAvatars = [
    'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=300',
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=300',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=300',
    'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=300',
    'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=300'
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      <div className="p-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-indigo-600 font-bold bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-2xs hover:shadow-xs transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>กลับสู่หน้าหลัก</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200/90 p-6 sm:p-10 rounded-3xl max-w-md w-full space-y-8 shadow-xl relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Logo & Header */}
          <div className="text-center space-y-3 relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-400 p-3.5 text-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25">
              <Building2 className="w-9 h-9" />
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">เข้าสู่ระบบเจ้าของหอพัก</h2>
              <p className="text-xs text-slate-500 font-medium">
                ลงชื่อเข้าใช้งานด้วยบัญชี Google เพื่อจัดการหอพักของคุณ
              </p>
            </div>
          </div>

          {/* Error / Fail-Closed Alert Banner */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-center gap-2 font-medium animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Configuration Missing Banner (Fail-Closed) */}
          {!isGoogleConfigured && !errorMessage && (
            <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl text-xs text-amber-900 flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Google Login is temporarily unavailable. Please contact the system administrator.</span>
            </div>
          )}

          {/* Google Sign In Button */}
          {isGoogleConfigured && (
            <div className="space-y-3 relative flex justify-center w-full">
              <div className="w-full flex justify-center p-1 bg-white">
                <GoogleLogin
                  onSuccess={handleGoogleAuthSuccess}
                  onError={() => {
                    setErrorMessage('Google Login was cancelled or failed. Please try again.');
                  }}
                  shape="pill"
                  size="large"
                  text="signin_with"
                  width="350"
                />
              </div>
            </div>
          )}

          <div className="pt-2 text-center text-[10px] text-slate-400 space-y-1">
            <div className="flex justify-center gap-3 font-semibold text-slate-500">
              <Link to="/terms" className="hover:underline">Terms of Service</Link>
              <span>•</span>
              <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Light-Themed Multi-Dormitory Profile Manager Modal */}
      {showPicker && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
          <div className="bg-white border border-slate-200/90 rounded-3xl max-w-2xl w-full p-5 sm:p-8 space-y-6 shadow-2xl relative text-slate-800 max-h-[92vh] flex flex-col">
            <button
              onClick={() => setShowPicker(false)}
              className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-3 pr-8">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">เลือกหอพัก</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    เลือกหอพักเพื่อเข้าสู่ระบบจัดการ
                  </p>
                </div>
              </div>

              <div className="p-2.5 sm:p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    O
                  </div>
                  <div className="min-w-0">
                    <span className="font-extrabold text-slate-800 text-xs block truncate">Owner Account</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 rounded-full">
                    {userMemberships.length} / {maxDorms} หอพัก
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-thin">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {userMemberships.map((membership) => {
                  return (
                    <div
                      key={membership.id}
                      onClick={() => handleSelectDormitory(membership)}
                      className="bg-white hover:bg-slate-50/90 border border-slate-200 hover:border-indigo-400 rounded-2xl p-3.5 transition-all duration-200 cursor-pointer shadow-2xs hover:shadow-md group relative flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-xl overflow-hidden border border-indigo-100 shadow-2xs group-hover:scale-105 transition-transform bg-slate-50 flex items-center justify-center relative">
                            <DormitoryPickerLogo
                              dormitoryId={membership.dormitoryId || membership.id}
                              name={membership.dormitoryName || membership.name}
                              logoUrl={membership.logoUrl}
                            />
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full" title="เปิดใช้งานอยู่" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-black text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                            {membership.dormitoryName || membership.name}
                          </h4>

                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">HorPlus Dormitory</span>
                          </p>

                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-md">
                              {membership.status || 'Active'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-400 text-[10px]">สิทธิ์: {membership.roleCode}</span>
                        <span className="text-indigo-600 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                          <span>เข้าจัดการ</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  );
                })}

                {!isQuotaFull && (
                  <div
                    onClick={handleNewOwnerOnboarding}
                    className="bg-indigo-50/30 hover:bg-indigo-50/60 border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-2xl p-3.5 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center text-center space-y-1.5 min-h-[120px] group"
                  >
                    <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                      <Plus className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-indigo-950">เพิ่มหอพักใหม่</h4>
                      <p className="text-[10px] text-indigo-600 font-medium">
                        โควตาคงเหลือ {maxDorms - userMemberships.length} แห่ง
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
