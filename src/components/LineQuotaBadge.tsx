import React, { useState, useEffect } from 'react';
import { MessageSquare, X, AlertTriangle, Settings, Sparkles, Check } from 'lucide-react';
import { formatThaiDate } from './GlobalComponents';
import { LineLogo } from './LineLogo';

interface LineQuotaBadgeProps {
  dormitoryId?: string;
  isRegistrationMode?: boolean;
  hideIcon?: boolean;
  hideLabelText?: boolean;
  className?: string;
  onNavigateToLineConfig?: () => void;
}

export const LineQuotaBadge: React.FC<LineQuotaBadgeProps> = ({
  dormitoryId,
  isRegistrationMode = false,
  hideIcon = false,
  hideLabelText = false,
  className = '',
  onNavigateToLineConfig,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [lineConfig, setLineConfig] = useState<{
    connected: boolean;
    isReady: boolean;
    credentialsVerified: boolean;
    monthlyQuota: number;
    usedQuota: number;
    remainingQuota: number;
    notifyRepairRequest: boolean;
    notifyRepairCompleted: boolean;
    notifyPaymentReceived: boolean;
    notifyTenantRegister: boolean;
    notifyTenantApproved: boolean;
  }>({
    connected: false,
    isReady: false,
    credentialsVerified: false,
    monthlyQuota: 30,
    usedQuota: 0,
    remainingQuota: 30,
    notifyRepairRequest: true,
    notifyRepairCompleted: true,
    notifyPaymentReceived: true,
    notifyTenantRegister: true,
    notifyTenantApproved: true,
  });

  const fetchLineStatus = async () => {
    if (!dormitoryId || isRegistrationMode) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/dormitories/${dormitoryId}/line-oa`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json.config;
        if (data) {
          setLineConfig({
            connected: Boolean(data.connected),
            isReady: Boolean(data.isReady),
            credentialsVerified: Boolean(data.credentialsVerified),
            monthlyQuota: data.monthlyQuota ?? 30,
            usedQuota: data.usedQuota ?? 0,
            remainingQuota: data.remainingQuota ?? 30,
            notifyRepairRequest: data.notifyRepairRequest ?? true,
            notifyRepairCompleted: data.notifyRepairCompleted ?? true,
            notifyPaymentReceived: data.notifyPaymentReceived ?? true,
            notifyTenantRegister: data.notifyTenantRegister ?? true,
            notifyTenantApproved: data.notifyTenantApproved ?? true,
          });
        }
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRegistrationMode) {
      fetchLineStatus();
    }
  }, [dormitoryId, isRegistrationMode]);

  const handleTogglePref = async (key: 'notifyRepairRequest' | 'notifyRepairCompleted' | 'notifyPaymentReceived' | 'notifyTenantRegister' | 'notifyTenantApproved') => {
    if (!dormitoryId || !lineConfig.connected) return;
    const nextVal = !lineConfig[key];
    setLineConfig((prev) => ({ ...prev, [key]: nextVal }));

    try {
      setSavingPrefs(true);
      await fetch(`/api/v1/dormitories/${dormitoryId}/line-oa/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': (window as any).__HORPLUS_CSRF_TOKEN__ || '',
        },
        body: JSON.stringify({ [key]: nextVal }),
      });
    } catch {
      // Rollback on failure
      setLineConfig((prev) => ({ ...prev, [key]: !nextVal }));
    } finally {
      setSavingPrefs(false);
    }
  };

  const isConfigured = !isRegistrationMode && lineConfig.connected && lineConfig.isReady;
  const isPendingWebhook = !isRegistrationMode && lineConfig.connected && !lineConfig.isReady;
  const isExhausted = isConfigured && lineConfig.remainingQuota <= 0;
  const isWarning = isConfigured && lineConfig.remainingQuota <= 5 && !isExhausted;
  const usagePercent = Math.min(100, Math.round((lineConfig.usedQuota / lineConfig.monthlyQuota) * 100));

  // Next 1st of month calculation
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextResetDateStr = formatThaiDate(nextMonth.toISOString());

  // 1. REGISTRATION NOT COMPLETED: display "ยังไม่พร้อมใช้งาน", NOT clickable
  if (isRegistrationMode) {
    return (
      <div
        data-testid="header-line-status-pill"
        data-line-status="registration_pending"
        className={`group relative inline-flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed select-none opacity-85 ${className}`}
        title="ยังไม่พร้อมใช้งาน (กรุณาลงทะเบียนหอพักให้เสร็จก่อน)"
      >
        {!hideIcon && (
          <div className="relative flex items-center justify-center shrink-0">
            <LineLogo className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 rounded-sm opacity-60 grayscale" />
          </div>
        )}
        <div className="flex items-center gap-1 text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
          {!hideLabelText && (
            <span className="font-bold hidden xs:inline text-slate-500 whitespace-nowrap">
              LINE OA:
            </span>
          )}
          <span className="font-extrabold px-1.5 py-0.5 rounded-md leading-none whitespace-nowrap text-[9px] sm:text-[10.5px] bg-slate-200 text-slate-700">
            ยังไม่พร้อมใช้งาน
          </span>
        </div>
      </div>
    );
  }

  // 2. REGISTRATION COMPLETED: Clickable pill (shows quota if ready, or "รอเชื่อมต่อ Webhook" / "ยังไม่พร้อมใช้งาน")
  return (
    <>
      {/* LINE Quota Counter Button */}
      <button
        onClick={() => {
          if (!isConfigured && onNavigateToLineConfig) {
            onNavigateToLineConfig();
          } else {
            setIsOpen(true);
          }
        }}
        type="button"
        data-testid="header-line-status-pill"
        data-line-status={isConfigured ? 'ready' : isPendingWebhook ? 'webhook_pending' : 'unconfigured'}
        className={`group relative inline-flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border transition-all cursor-pointer select-none active:scale-95 ${!isConfigured
            ? 'bg-amber-50/90 border-amber-200/80 hover:bg-amber-100/90 text-amber-800'
            : isExhausted
              ? 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700'
              : isWarning
                ? 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-800'
                : 'bg-emerald-50/90 border-emerald-200/80 hover:bg-emerald-100/90 text-emerald-800'
          } ${className}`}
        title={
          isConfigured
            ? 'คลิกเพื่อดูรายละเอียดโควตา LINE'
            : isPendingWebhook
              ? 'คลิกเพื่อดูสถานะ Webhook LINE OA'
              : 'คลิกเพื่อตั้งค่า LINE OA'
        }
      >
        {/* LINE Icon / Attention indicator */}
        {!hideIcon && (
          <div className="relative flex items-center justify-center shrink-0">
            <LineLogo className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 rounded-sm ${!isConfigured ? 'opacity-85' : ''}`} />
            <span
              className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-white ${!isConfigured
                  ? 'bg-amber-500 animate-pulse'
                  : isExhausted
                    ? 'bg-rose-500 animate-ping'
                    : isWarning
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-emerald-500'
                }`}
            />
          </div>
        )}

        {/* Text Label & Badge */}
        <div className="flex items-center gap-1 text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
          {!hideLabelText && (
            <span className="font-bold hidden xs:inline text-slate-700 whitespace-nowrap">
              {isConfigured ? 'จำนวนการส่งข้อความ:' : 'LINE OA:'}
            </span>
          )}
          {isConfigured ? (
            <span
              className={`font-black px-1.5 py-0.5 rounded-md leading-none whitespace-nowrap text-[9px] sm:text-[10.5px] ${isExhausted
                  ? 'bg-rose-600 text-white'
                  : isWarning
                    ? 'bg-amber-600 text-white'
                    : 'bg-[#06C755] text-white'
                }`}
            >
              {lineConfig.remainingQuota}/{lineConfig.monthlyQuota}
            </span>
          ) : (
            <span className="font-bold px-1.5 py-0.5 rounded-md leading-none whitespace-nowrap text-[9px] sm:text-[10.5px] bg-amber-200 text-amber-900 animate-pulse">
              {isPendingWebhook ? 'รอเชื่อมต่อ Webhook' : 'ยังไม่พร้อมใช้งาน'}
            </span>
          )}
        </div>
      </button>

      {/* Details Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="fixed inset-0 cursor-default" onClick={() => setIsOpen(false)} />

          <div className="relative w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden z-10 animate-in zoom-in-95 duration-200">
            {/* Header banner */}
            <div
              className={`p-5 text-white relative ${isConfigured
                  ? 'bg-gradient-to-r from-[#06C755] to-emerald-600'
                  : 'bg-gradient-to-r from-amber-500 to-orange-600'
                }`}
            >
              <div className="absolute top-4 right-4 flex items-center gap-1.5">
                {onNavigateToLineConfig && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      onNavigateToLineConfig();
                    }}
                    className="p-1.5 px-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold"
                    title="แก้ไข LINE OA"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">แก้ไข LINE OA</span>
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
                  aria-label="ปิด"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/30 overflow-hidden shadow-xs">
                  <LineLogo className="w-7 h-7 shrink-0 rounded-xs" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight text-white leading-tight">
                    {isConfigured ? 'จำนวนการส่งข้อความ LINE' : isPendingWebhook ? 'รอเชื่อมต่อ Webhook' : 'LINE ยังไม่พร้อมใช้งาน'}
                  </h3>
                  <span className="text-[11px] font-bold text-white/90 block mt-0.5">
                    {isConfigured
                      ? `รีเซ็ตอัตโนมัติ ${lineConfig.monthlyQuota}/${lineConfig.monthlyQuota} ทุกวันที่ 1`
                      : isPendingWebhook
                        ? 'บันทึกข้อมูลแล้ว นำ Webhook URL ไปใส่ใน LINE Developers Console เพื่อเปิดใช้งาน'
                        : 'กรุณาเชื่อมต่อ Channel ID & Secret เพื่อเปิดใช้งาน'}
                  </span>
                </div>
              </div>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-4">
              {isConfigured ? (
                /* Configured View */
                <>
                  {/* Quota Exhaustion Warning (PO Decision A1) */}
                  {isExhausted && (
                    <div
                      data-testid="badge-quota-exhausted-banner"
                      className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-rose-900"
                    >
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <strong className="text-xs font-black text-rose-800 block">
                          จำนวนการส่งข้อความเดือนนี้หมดแล้ว
                        </strong>
                        <p className="text-[11px] text-rose-700 leading-relaxed font-medium">
                          ดำเนินการในระบบต่อได้ตามปกติ แต่ระบบจะไม่ส่งข้อความ LINE จนกว่าจะถึงรอบรีเซ็ตถัดไป
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Quota Warning Threshold (PO Decision A2: <= 5) */}
                  {isWarning && (
                    <div
                      data-testid="badge-quota-warning-banner"
                      className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-amber-900"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <strong className="text-xs font-black text-amber-800 block">
                          จำนวนการส่งข้อความใกล้หมดแล้ว (เหลือ ≤ 5 ข้อความ)
                        </strong>
                        <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                          จำนวนการส่งข้อความคงเหลือ {lineConfig.remainingQuota}/{lineConfig.monthlyQuota} ข้อความ
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">จำนวนการส่งข้อความคงเหลือเดือนนี้</span>
                      <span
                        className={`text-xs font-black px-2 py-0.5 rounded-full ${isExhausted
                            ? 'bg-rose-100 text-rose-700'
                            : isWarning
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                      >
                        {lineConfig.remainingQuota} / {lineConfig.monthlyQuota} ข้อความ
                      </span>
                    </div>

                    <div className="w-full h-2.5 bg-slate-200/80 rounded-full overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isExhausted
                            ? 'bg-rose-500'
                            : isWarning
                              ? 'bg-amber-500'
                              : 'bg-[#06C755]'
                          }`}
                        style={{ width: `${Math.max(5, 100 - usagePercent)}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold pt-1">
                      <span>ส่งไปแล้ว {lineConfig.usedQuota} ข้อความ</span>
                      <span>รีเซ็ตถัดไป: {nextResetDateStr}</span>
                    </div>
                  </div>

                  {/* 5 Event Preferences Toggle */}
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <LineLogo className="w-3.5 h-3.5 shrink-0 rounded-xs" />
                      <span>การแจ้งเตือนอัตโนมัติผ่าน LINE</span>
                    </span>
                    <div className="space-y-1.5 text-xs text-slate-600">
                      {[
                        { key: 'notifyRepairRequest' as const, label: 'แจ้งเตือนเมื่อมีคำขอแจ้งซ่อมใหม่' },
                        { key: 'notifyRepairCompleted' as const, label: 'แจ้งเตือนเมื่อซ่อมแซมเสร็จสิ้น' },
                        { key: 'notifyPaymentReceived' as const, label: 'แจ้งเตือนเมื่อได้รับยอดชำระเงิน' },
                        { key: 'notifyTenantRegister' as const, label: 'แจ้งเตือนเมื่อมีผู้เช่าใหม่ลงทะเบียน' },
                        { key: 'notifyTenantApproved' as const, label: 'แจ้งเตือนเมื่ออนุมัติผู้เช่าเข้าห้องพัก' },
                      ].map((item) => (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 cursor-pointer select-none hover:text-slate-900"
                        >
                          <input
                            type="checkbox"
                            checked={lineConfig[item.key]}
                            onChange={() => handleTogglePref(item.key)}
                            className="rounded text-[#06C755] focus:ring-[#06C755]"
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                /* Unconfigured View */
                <div className="space-y-4 text-center py-2">
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-left space-y-2">
                    <p className="text-xs font-bold text-amber-900">
                      {isPendingWebhook ? 'รอการเชื่อมต่อ Webhook จาก LINE Developers' : 'ยังไม่ได้เชื่อมต่อ LINE Official Account'}
                    </p>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      {isPendingWebhook
                        ? 'บันทึก Channel ID & Secret แล้ว แต่ระบบยังตรวจไม่พบการเปิดใช้งาน Webhook กรุณานำ Webhook URL ไปเชื่อมต่อใน LINE Developers Console เพื่อเริ่มรับส่งข้อมูล'
                        : 'ระบบจำเป็นต้องเชื่อมต่อ LINE Messaging API เพื่อเปิดใช้งานฟีเจอร์แจ้งเตือนอัตโนมัติไปยังผู้เช่าและเจ้าของหอพัก'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      if (onNavigateToLineConfig) {
                        onNavigateToLineConfig();
                      } else {
                        window.location.href = '/owner/line-oa';
                      }
                    }}
                    className="w-full py-2.5 bg-gradient-to-r from-[#06C755] to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md shadow-emerald-500/20 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <LineLogo className="w-4 h-4 shrink-0 rounded-xs" />
                    {isPendingWebhook ? 'ไปหน้าเชื่อมต่อ Webhook' : 'ตั้งค่า LINE OA ทันที'}
                  </button>
                </div>
              )}

              {/* Dismiss Button */}
              {isConfigured && (
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-full py-2.5 bg-[#06C755] hover:bg-emerald-600 text-white font-extrabold text-xs rounded-xl transition-colors shadow-md shadow-emerald-500/20 cursor-pointer text-center"
                >
                  ตกลง เข้าใจแล้ว
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default LineQuotaBadge;
