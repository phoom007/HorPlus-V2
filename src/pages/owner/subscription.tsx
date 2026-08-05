import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  Building,
  Lock,
  Tag,
} from 'lucide-react';

interface SubscriptionPageProps {
  dormitoryId?: string;
}

export const SubscriptionPage: React.FC<SubscriptionPageProps> = ({ dormitoryId }) => {
  const [entitlements, setEntitlements] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  const activeDormId =
    dormitoryId ||
    sessionStorage.getItem('active_dormitory_selected_for_session') ||
    localStorage.getItem('selected_dormitory_id') ||
    '';

  const getCsrfToken = () => {
    const match = document.cookie.match(new RegExp('(^| )' + 'csrf-token' + '=([^;]+)'));
    if (match) return match[2];
    const match2 = document.cookie.match(new RegExp('(^| )' + 'horplus_csrf' + '=([^;]+)'));
    return match2 ? match2[2] : '';
  };

  const fetchEntitlements = async () => {
    if (!activeDormId) {
      setError('Dormitory context required');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/subscription/entitlements', {
        headers: {
          'x-dormitory-id': activeDormId,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || 'Failed to fetch subscription entitlements');
      }

      const json = await res.json();
      setEntitlements(json.data);
    } catch (err: any) {
      setError(err.message || 'Error loading subscription details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntitlements();
  }, [activeDormId]);

  const handleRedeemPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim() || !activeDormId) return;

    setPromoLoading(true);
    setPromoSuccess(null);
    setPromoError(null);

    const idempotencyKey = `promo-redeem-${activeDormId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      const res = await fetch('/api/v1/subscription/promo/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dormitory-id': activeDormId,
          'x-csrf-token': getCsrfToken(),
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({ code: promoCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || data?.message || 'Failed to redeem promo code');
      }

      setPromoSuccess(`Promo code HORPLUS redeemed! Trial extended by 60 days. New expiry: ${new Date(data.entitlements.expiresAt).toLocaleDateString('th-TH')}`);
      setEntitlements((prev: any) => ({ ...prev, ...data.entitlements }));
      setPromoCode('');
    } catch (err: any) {
      setPromoError(err.message || 'Failed to redeem promo code');
    } finally {
      setPromoLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mb-3" />
        <p className="text-sm font-medium text-slate-500">Loading subscription status & entitlements...</p>
      </div>
    );
  }

  if (error || !entitlements) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-6 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-base mb-1">Unable to Load Subscription</h3>
            <p className="text-sm">{error || 'Subscription details not found for this dormitory.'}</p>
            <button
              onClick={fetchEntitlements}
              className="mt-4 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition-all"
            >
              Retry
            </button>
          </div>
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
    reason,
  } = entitlements;

  const daysRemaining = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
  const usagePercentage = Math.min(100, Math.round((roomCount / roomLimit) * 100));

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Subscription / แพ็กเกจและการใช้งาน</h1>
          </div>
          <p className="text-sm text-slate-500 font-medium">
            จัดการสถานะแพ็กเกจ โควต้าห้องพัก และสิทธิ์การใช้งานของหอพัก
          </p>
        </div>
        <button
          onClick={fetchEntitlements}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Status
        </button>
      </div>

      {/* Read-Only Banner if Expired or Over Limit */}
      {isReadOnly && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 p-5 rounded-2xl flex items-start gap-4 shadow-sm">
          <Lock className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="font-extrabold text-sm uppercase tracking-wider text-amber-900">READ_ONLY Mode Active</h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-200 text-amber-900">RESTRICTED</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed font-medium">
              {reason || 'Dormitory operations are restricted to read-only. All data remains safe and visible, but new additions and modifications are blocked until subscription is active.'}
            </p>
          </div>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Current Plan Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current Plan</span>
              <span
                className={`text-xs font-black px-2.5 py-1 rounded-full uppercase tracking-wide ${
                  status === 'TRIAL'
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-100 text-rose-700 border border-rose-200'
                }`}
              >
                {status}
              </span>
            </div>
            <div>
              <h3 className="text-2xl font-black text-slate-900">{plan?.name || 'Free / Trial'}</h3>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {plan?.code === 'PAID' ? 'Standard Paid Subscription' : 'Trial Period (Max 10 rooms)'}
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Status:</span>
            <span className="font-bold text-slate-800">{isActive ? 'Active' : 'Expired / Read-Only'}</span>
          </div>
        </div>

        {/* Expiration & Countdown Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Expiration Date</span>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-slate-900">
                {expiresAt ? new Date(expiresAt).toLocaleDateString('th-TH') : '-'}
              </h3>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {isActive ? `${daysRemaining} days remaining` : 'Expired'}
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between text-xs font-medium">
            <span className="text-slate-500">Access Mode:</span>
            <span className={isReadOnly ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}>
              {isReadOnly ? 'Read-Only' : 'Full Access'}
            </span>
          </div>
        </div>

        {/* Room Quota Meter Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Room Usage Quota</span>
              <Building className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <h3 className="text-2xl font-black text-slate-900">{roomCount}</h3>
                <span className="text-slate-400 text-sm font-bold">/ {roomLimit} Rooms</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    isOverLimit ? 'bg-rose-500' : usagePercentage > 80 ? 'bg-amber-500' : 'bg-blue-600'
                  }`}
                  style={{ width: `${usagePercentage}%` }}
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 mt-4 flex items-center justify-between text-xs font-medium">
            <span className="text-slate-500">Remaining Quota:</span>
            <span className={remainingRooms === 0 ? 'text-rose-600 font-bold' : 'text-slate-800 font-bold'}>
              {remainingRooms} Rooms
            </span>
          </div>
        </div>
      </div>

      {/* Promo Code Redemption Section */}
      <div className="bg-gradient-to-br from-blue-900 via-indigo-900 to-slate-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span className="text-xs font-black uppercase tracking-wider text-blue-200">Exclusive Promo</span>
            </div>
            {promoRedeemed && (
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-extrabold border border-emerald-400/30">
                Already Redeemed
              </span>
            )}
          </div>

          <div>
            <h3 className="text-xl font-extrabold text-white">Redeem HORPLUS Trial Extension</h3>
            <p className="text-xs text-blue-200 mt-1 leading-relaxed max-w-2xl">
              Eligible Trial dormitories can redeem promo code <code className="font-mono bg-blue-800/80 px-2 py-0.5 rounded text-white font-bold">HORPLUS</code> once to instantly extend your 30-day trial by +60 days (total 90 days trial).
            </p>
          </div>

          {promoSuccess && (
            <div className="bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{promoSuccess}</span>
            </div>
          )}

          {promoError && (
            <div className="bg-rose-500/20 border border-rose-400/40 text-rose-200 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{promoError}</span>
            </div>
          )}

          <form onSubmit={handleRedeemPromo} className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Enter promo code"
              disabled={promoRedeemed || status !== 'TRIAL' || promoLoading}
              className="w-full sm:w-64 px-4 py-2.5 bg-white/10 border border-white/20 rounded-xl text-white placeholder-blue-300 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={promoRedeemed || status !== 'TRIAL' || promoLoading || !promoCode.trim()}
              className="w-full sm:w-auto px-6 py-2.5 bg-white text-blue-950 font-black rounded-xl text-sm hover:bg-blue-50 transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {promoLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-blue-950" />
              ) : promoRedeemed ? (
                'Already Redeemed'
              ) : (
                'Redeem Code'
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Package Catalog Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Subscription Packages Catalog</h2>
          <p className="text-xs text-slate-500 font-medium">
            แพ็กเกจสำหรับขยายโควต้าสูงสุด 150 ห้องพัก การเปิดใช้งานแพ็กเกจต้องดำเนินการผ่านเจ้าหน้าที่แพลตฟอร์ม
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {availablePackages.map((pkg: any) => (
            <div
              key={pkg.id}
              className={`p-6 rounded-2xl border flex flex-col justify-between transition-all ${
                pkg.enabled
                  ? 'bg-white border-blue-200 shadow-sm hover:border-blue-300'
                  : 'bg-slate-50 border-slate-200 opacity-60'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {pkg.durationMonths} Month{pkg.durationMonths > 1 ? 's' : ''}
                  </span>
                  {pkg.enabled ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-100 text-blue-700">
                      Standard Package
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-slate-200 text-slate-600">
                      Unpriced / Disabled
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black text-slate-900">
                      {pkg.price !== null ? pkg.price : 'Unpriced'}
                    </span>
                    {pkg.price !== null && <span className="text-xs font-bold text-slate-500">THB</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    {pkg.enabled ? 'Increase quota to 150 rooms' : 'Awaiting PO pricing decision'}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 mt-6">
                <div className="w-full py-2.5 px-4 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs flex items-center justify-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-500" />
                  <span>Awaiting platform activation</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
