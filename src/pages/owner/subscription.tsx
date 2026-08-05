/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building2,
  Gift,
  Sparkles,
  RefreshCw,
  ShieldAlert,
  ArrowUpRight,
  Lock,
} from 'lucide-react';

export interface SubscriptionProps {
  dormitoryId?: string;
  onRefresh?: () => void;
}

export function SubscriptionPage({ dormitoryId }: SubscriptionProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<any>(null);
  const [promoCode, setPromoCode] = useState('HORPLUS');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [activateLoading, setActivateLoading] = useState(false);
  const [activateSuccess, setActivateSuccess] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  const getCsrfToken = () => {
    const match = document.cookie.match(/(?:csrf-token|horplus_csrf)=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : (window as any).__CSRF_TOKEN || '';
  };

  const fetchEntitlements = async () => {
    setLoading(true);
    setError(null);
    try {
      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id');
      const headers: Record<string, string> = {};
      if (activeDormId) {
        headers['x-dormitory-id'] = activeDormId;
      }

      const res = await fetch('/api/v1/subscription/entitlements', {
        headers,
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Failed to fetch subscription entitlements (${res.status})`);
      }

      const data = await res.json();
      setEntitlements(data);
    } catch (err: any) {
      setError(err.message || 'Error loading subscription entitlements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntitlements();
  }, [dormitoryId]);

  const handleRedeemPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;

    setPromoLoading(true);
    setPromoSuccess(null);
    setPromoError(null);

    try {
      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-csrf-token': getCsrfToken(),
      };
      if (activeDormId) {
        headers['x-dormitory-id'] = activeDormId;
      }

      const res = await fetch('/api/v1/subscription/promo/redeem', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ code: promoCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || data?.message || 'Failed to redeem promo code');
      }

      setPromoSuccess(`Promo code HORPLUS redeemed! Trial extended by 60 days. New expiry: ${new Date(data.entitlements.expiresAt).toLocaleDateString()}`);
      setEntitlements(data.entitlements);
    } catch (err: any) {
      setPromoError(err.message || 'Failed to redeem promo code');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleActivatePaid = async (durationMonths: number) => {
    setActivateLoading(true);
    setActivateSuccess(null);
    setActivateError(null);

    try {
      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-csrf-token': getCsrfToken(),
      };
      if (activeDormId) {
        headers['x-dormitory-id'] = activeDormId;
      }

      const res = await fetch('/api/v1/subscription/activate', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ durationMonths }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || data?.message || 'Failed to activate paid package');
      }

      setActivateSuccess(`Activated ${durationMonths}-month Paid Package! Expiry: ${new Date(data.entitlements.expiresAt).toLocaleDateString()}`);
      setEntitlements(data.entitlements);
    } catch (err: any) {
      setActivateError(err.message || 'Failed to activate package');
    } finally {
      setActivateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-4" />
        <p className="text-sm font-semibold text-slate-600">Loading subscription status & entitlements...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
          <h3 className="text-lg font-bold text-rose-900">Subscription Read Failure</h3>
          <p className="text-sm text-rose-700">{error}</p>
          <button
            onClick={fetchEntitlements}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 text-white font-semibold rounded-xl text-sm hover:bg-rose-700 transition-colors shadow-sm"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    plan,
    status,
    isActive,
    isReadOnly,
    isOverLimit,
    roomLimit,
    roomCount,
    remainingRooms,
    expiresAt,
    promoRedeemed,
    availablePackages = [],
  } = entitlements || {};

  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  const now = new Date();
  const diffDays = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const roomUsagePercent = Math.min(100, Math.round((roomCount / roomLimit) * 100));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Read-Only Banner */}
      {isReadOnly && (
        <div className="bg-gradient-to-r from-rose-600 to-red-700 text-white rounded-2xl p-5 shadow-lg border border-rose-500 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-xl shrink-0 backdrop-blur-xs">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h4 className="font-extrabold text-base">READ_ONLY Mode Active</h4>
              <p className="text-xs text-rose-100 mt-0.5">
                Your subscription has expired. Business data mutations (creating rooms, tenants, contracts, bills, payments) are restricted. Historical data remains fully accessible.
              </p>
            </div>
          </div>
          <a
            href="#packages"
            className="shrink-0 px-4 py-2 bg-white text-rose-700 font-bold rounded-xl text-xs hover:bg-rose-50 transition-all shadow-md"
          >
            Upgrade / Renew Now
          </a>
        </div>
      )}

      {/* Over Limit Warning */}
      {isOverLimit && !isReadOnly && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-5 shadow-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">Room Count Exceeds Plan Limit</h4>
            <p className="text-xs text-amber-800 mt-0.5">
              Current room count ({roomCount}) exceeds your {plan?.name} limit ({roomLimit}). Upgrade to Plan B (Paid) to restore room creation.
            </p>
          </div>
        </div>
      )}

      {/* Header & Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Current Plan Card */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Current Plan</span>
            <span
              className={`text-xs font-black px-2.5 py-1 rounded-full uppercase tracking-wide ${
                status === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : status === 'TRIAL'
                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                  : 'bg-rose-100 text-rose-700 border border-rose-200'
              }`}
            >
              {status}
            </span>
          </div>

          <div>
            <h3 className="text-2xl font-black text-slate-900">{plan?.name || 'Free / Trial'}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {plan?.type === 'PAID' ? 'Unlimited business suite with 150 room capacity' : 'Standard starter tier with 10 room quota'}
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Plan Code:</span>
            <span className="font-mono font-bold text-slate-800">{plan?.code}</span>
          </div>
        </div>

        {/* Expiration Card */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Expiration Date</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>

          <div>
            <h3 className="text-2xl font-black text-slate-900">
              {expiryDate ? expiryDate.toLocaleDateString() : 'N/A'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {isActive ? `${diffDays} day(s) remaining` : 'Subscription expired'}
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Timezone:</span>
            <span className="font-mono font-bold text-slate-800">Asia/Bangkok</span>
          </div>
        </div>

        {/* Room Quota Card */}
        <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Room Usage</span>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <h3 className="text-2xl font-black text-slate-900">
                {roomCount} <span className="text-sm font-semibold text-slate-400">/ {roomLimit}</span>
              </h3>
              <span className="text-xs font-bold text-slate-600">{remainingRooms} remaining</span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  isOverLimit
                    ? 'bg-rose-500'
                    : roomUsagePercent > 80
                    ? 'bg-amber-500'
                    : 'bg-blue-600'
                }`}
                style={{ width: `${roomUsagePercent}%` }}
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold">Over-Limit Status:</span>
            <span className={`font-bold ${isOverLimit ? 'text-rose-600' : 'text-emerald-600'}`}>
              {isOverLimit ? 'YES (Creation blocked)' : 'NO (Normal)'}
            </span>
          </div>
        </div>
      </div>

      {/* Promo Code Redemption Section */}
      <div className="bg-gradient-to-br from-blue-900 to-indigo-900 text-white rounded-2xl p-6 shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Gift className="w-48 h-48 text-white" />
        </div>

        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-blue-500/30 text-blue-200 text-xs font-black uppercase tracking-wider border border-blue-400/30">
              Special Promo Offer
            </span>
            {promoRedeemed && (
              <span className="px-2.5 py-0.5 rounded-md bg-emerald-500/30 text-emerald-200 text-xs font-black uppercase tracking-wider border border-emerald-400/30">
                Redeemed
              </span>
            )}
          </div>

          <h3 className="text-xl font-extrabold">Redeem HORPLUS Trial Extension</h3>
          <p className="text-xs text-blue-100 leading-relaxed">
            Eligible Trial dormitories can redeem the code <code className="font-mono bg-blue-800/60 px-1.5 py-0.5 rounded text-white font-bold">HORPLUS</code> once to instantly extend your 30-day trial by +60 days for a total 90-day trial period.
          </p>

          <form onSubmit={handleRedeemPromo} className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Enter promo code"
              disabled={promoRedeemed || status !== 'TRIAL' || promoLoading}
              className="w-full sm:w-64 px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={promoRedeemed || status !== 'TRIAL' || promoLoading || !promoCode.trim()}
              className="w-full sm:w-auto px-6 py-2.5 bg-white text-blue-950 font-black rounded-xl text-sm hover:bg-blue-50 transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {promoLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {promoRedeemed ? 'Already Redeemed' : 'Redeem Code'}
            </button>
          </form>

          {promoSuccess && (
            <div className="bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 p-3 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{promoSuccess}</span>
            </div>
          )}

          {promoError && (
            <div className="bg-rose-500/20 border border-rose-400/40 text-rose-100 p-3 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{promoError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Available Packages Section */}
      <div id="packages" className="space-y-4 pt-4">
        <div>
          <h3 className="text-lg font-black text-slate-900">Subscription Package Catalog</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Upgrade your dormitory to Plan B (Paid) for up to 150 rooms capacity. Prices are locked by Product Owner specifications.
          </p>
        </div>

        {activateSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-sm flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{activateSuccess}</span>
          </div>
        )}

        {activateError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-sm flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{activateError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* 1 Month Package (Enabled) */}
          <div className="bg-white border-2 border-blue-600 rounded-2xl p-5 shadow-md flex flex-col justify-between space-y-4 relative">
            <span className="absolute -top-3 right-4 px-2.5 py-0.5 bg-blue-600 text-white font-black text-[10px] uppercase rounded-full tracking-wider shadow-xs">
              Approved Price
            </span>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-blue-600">
                <CreditCard className="w-5 h-5" />
                <span className="font-extrabold text-sm">1 Month</span>
              </div>
              <div>
                <div className="text-3xl font-black text-slate-900">189 <span className="text-xs font-bold text-slate-500">THB</span></div>
                <p className="text-[11px] text-slate-500 mt-1">Full Plan B (150 Rooms)</p>
              </div>
            </div>

            <button
              onClick={() => handleActivatePaid(1)}
              disabled={activateLoading}
              className="w-full py-2.5 bg-blue-600 text-white font-bold rounded-xl text-xs hover:bg-blue-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {activateLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
              Activate 1 Month
            </button>
          </div>

          {/* Unpriced Durations (3, 6, 12, 24 Months - Disabled) */}
          {[3, 6, 12, 24].map((duration) => (
            <div key={duration} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 opacity-75">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-extrabold text-sm">{duration} Months</span>
                  <Lock className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-400">Unpriced</div>
                  <p className="text-[11px] text-slate-400 mt-1">Price decision pending from PO</p>
                </div>
              </div>

              <button
                disabled
                className="w-full py-2.5 bg-slate-200 text-slate-400 font-bold rounded-xl text-xs cursor-not-allowed text-center"
              >
                Disabled
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
