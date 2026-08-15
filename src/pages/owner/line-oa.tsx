import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Copy,
  CheckCircle2,
  AlertCircle,
  X,
  HelpCircle,
  ExternalLink,
  RefreshCw,
  Trash2,
  ChevronLeft,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { Task009ApiAdapter } from '../../data/adapters/task009';

interface OwnerLineOaPageProps {
  dormitoryId?: string;
  onNavigateBack?: () => void;
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
}

export const OwnerLineOaPage: React.FC<OwnerLineOaPageProps> = ({
  dormitoryId,
  onNavigateBack,
  onAddLog,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form inputs
  const [channelId, setChannelId] = useState('');
  const [channelSecret, setChannelSecret] = useState('');

  // Status & Preferences
  const [config, setConfig] = useState<{
    connected: boolean;
    isReady: boolean;
    credentialsVerified: boolean;
    webhookEndpointSet: boolean;
    webhookTestSucceeded: boolean;
    webhookActive: boolean;
    hasChannelSecret: boolean;
    hasAccessToken: boolean;
    isPublicWebhookConfigured?: boolean;
    webhookOriginError?: string | null;
    lineOaId: string | null;
    channelId: string | null;
    botUserId?: string | null;
    botDisplayName?: string | null;
    botPictureUrl?: string | null;
    botPremiumId?: string | null;
    botChatMode?: string | null;
    webhookUrl: string | null;
    notifyRepairRequest: boolean;
    notifyRepairCompleted: boolean;
    notifyPaymentReceived: boolean;
    notifyTenantRegister: boolean;
    notifyTenantApproved: boolean;
    monthlyQuota: number;
    usedQuota: number;
    remainingQuota: number;
  }>({
    connected: false,
    isReady: false,
    credentialsVerified: false,
    webhookEndpointSet: false,
    webhookTestSucceeded: false,
    webhookActive: false,
    hasChannelSecret: false,
    hasAccessToken: false,
    isPublicWebhookConfigured: false,
    lineOaId: null,
    channelId: null,
    webhookUrl: null,
    notifyRepairRequest: true,
    notifyRepairCompleted: true,
    notifyPaymentReceived: true,
    notifyTenantRegister: true,
    notifyTenantApproved: true,
    monthlyQuota: 30,
    usedQuota: 0,
    remainingQuota: 30,
  });

  const dormId = dormitoryId || localStorage.getItem('horplus_current_dormitory_id') || 'dorm-fresh-01';

  const loadConfig = async () => {
    try {
      setLoading(true);
      const res = await Task009ApiAdapter.getLineOaConfig(dormId);
      if (res.data) {
        setConfig(res.data);
        if (res.data.channelId) {
          setChannelId(res.data.channelId);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'ไม่สามารถโหลดข้อมูลการเชื่อมต่อ LINE OA ได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [dormId]);

  const handleSaveCredentials = async () => {
    if (!channelId.trim() || (!channelSecret.trim() && !config.hasChannelSecret)) {
      setErrorMessage('กรุณาระบุ LINE Channel ID และ Channel Secret');
      return;
    }

    try {
      setSaving(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const res = await Task009ApiAdapter.updateLineOaConfig(dormId, {
        channelId: channelId.trim(),
        channelSecret: channelSecret.trim() || undefined,
      });

      if (res.error) {
        setErrorMessage(res.error.message || 'เกิดข้อผิดพลาดในการตรวจสอบและบันทึก LINE OA');
      } else if (res.data) {
        setConfig(res.data);
        setChannelSecret('');
        setSuccessMessage('ตรวจสอบและบันทึกข้อมูล LINE OA สำเร็จ!');
        if (onAddLog) {
          onAddLog('ตั้งค่า LINE Official Account', 'อัปเดตข้อมูลเชื่อมต่อ LINE OA สำเร็จ', 'LineOA', dormId);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ LINE OA');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    try {
      setTestingWebhook(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const res = await Task009ApiAdapter.testWebhookEndpoint(dormId);
      if (res.error) {
        setErrorMessage(res.error.message || 'การทดสอบ Webhook ล้มเหลว');
      } else if (res.data) {
        setConfig(res.data);
        setSuccessMessage('ทดสอบ Webhook สำเร็จ! พร้อมรับข้อความแจ้งเตือน');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการทดสอบ Webhook');
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleRotateWebhook = async () => {
    if (!window.confirm('คุณต้องการหมุนเวียนคีย์ Webhook หรือไม่? (ต้องนำ URL ใหม่ไปอัปเดตใน LINE Developers Console)')) {
      return;
    }

    try {
      setRotatingKey(true);
      setErrorMessage(null);
      const res = await Task009ApiAdapter.rotateWebhookKey(dormId);
      if (res.error) {
        setErrorMessage(res.error.message || 'ไม่สามารถหมุนเวียนคีย์ Webhook ได้');
      } else if (res.data) {
        setConfig(res.data);
        setSuccessMessage('หมุนเวียนคีย์ Webhook ใหม่เรียบร้อยแล้ว');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการหมุนเวียนคีย์ Webhook');
    } finally {
      setRotatingKey(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('คุณต้องการยกเลิกการเชื่อมต่อ LINE Official Account หรือไม่?')) {
      return;
    }

    try {
      setSaving(true);
      const res = await Task009ApiAdapter.disconnectLineOa(dormId);
      if (res.data) {
        setConfig(res.data);
        setChannelId('');
        setChannelSecret('');
        setSuccessMessage('ยกเลิกการเชื่อมต่อ LINE OA เรียบร้อยแล้ว');
        if (onAddLog) {
          onAddLog('ยกเลิกเชื่อมต่อ LINE OA', 'ยกเลิกการเชื่อมต่อ LINE Official Account', 'LineOA', dormId);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการยกเลิกการเชื่อมต่อ');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePreference = async (key: 'notifyRepairRequest' | 'notifyRepairCompleted' | 'notifyPaymentReceived' | 'notifyTenantRegister' | 'notifyTenantApproved') => {
    const nextVal = !config[key];
    setConfig((prev) => ({ ...prev, [key]: nextVal }));

    try {
      await fetch(`/api/v1/dormitories/${dormId}/line-oa/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': (window as any).__HORPLUS_CSRF_TOKEN__ || '',
        },
        body: JSON.stringify({ [key]: nextVal }),
      });
    } catch {
      setConfig((prev) => ({ ...prev, [key]: !nextVal }));
    }
  };

  // Status Calculation
  let statusBadge = {
    label: 'ยังไม่ได้ตั้งค่า (NOT CONFIGURED)',
    color: 'bg-slate-100 text-slate-700 border-slate-200',
    description: 'ยังไม่ได้เชื่อมต่อ Messaging API',
  };

  if (config.isReady) {
    statusBadge = {
      label: 'พร้อมใช้งาน (READY)',
      color: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      description: 'เชื่อมต่อและทดสอบ Webhook สมบูรณ์แล้ว',
    };
  } else if (config.credentialsVerified && !config.webhookActive) {
    statusBadge = {
      label: 'Webhook ยังไม่พร้อม (WEBHOOK NOT READY)',
      color: 'bg-amber-100 text-amber-800 border-amber-300',
      description: 'ยืนยัน Token แล้ว แต่ Webhook ยังไม่เปิดใช้งาน',
    };
  } else if (config.credentialsVerified) {
    statusBadge = {
      label: 'ยืนยันสำเร็จ (VERIFIED)',
      color: 'bg-blue-100 text-blue-800 border-blue-300',
      description: 'Channel ID และ Secret ถูกต้อง',
    };
  } else if (config.channelId && !config.credentialsVerified) {
    statusBadge = {
      label: 'ข้อมูลไม่ถูกต้อง (INVALID)',
      color: 'bg-rose-100 text-rose-800 border-rose-300',
      description: 'Channel ID หรือ Secret ไม่ถูกต้อง',
    };
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 pb-24">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateBack || (() => window.history.back())}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="ย้อนกลับ"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-[#06C755]" />
              จัดการ LINE Official Account (LINE OA)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              ตั้งค่าการเชื่อมต่อ LINE Messaging API และการแจ้งเตือนอัตโนมัติ
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowHelpModal(true)}
          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <HelpCircle className="w-4 h-4 text-indigo-600" />
          ดูวิธีตั้งค่า LINE OA
        </button>
      </div>

      {/* Notifications / Alerts */}
      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-xs text-rose-800 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-semibold">{errorMessage}</div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-rose-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3 text-xs text-emerald-800 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-semibold">{successMessage}</div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-emerald-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. Status Card */}
      <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
              สถานะการเชื่อมต่อ
            </span>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-black border ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
              <span className="text-xs text-slate-500 font-medium">{statusBadge.description}</span>
            </div>
          </div>

          {config.connected && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                โควตาเดือนนี้: <strong className="text-emerald-600">{config.remainingQuota}/{config.monthlyQuota}</strong>
              </span>
              <button
                onClick={handleDisconnect}
                disabled={saving}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl border border-rose-200 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                ยกเลิกเชื่อมต่อ
              </button>
            </div>
          )}
        </div>

        {config.lineOaId && (
          <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="font-bold text-slate-700">LINE OA Basic ID:</span>
              <span className="font-mono font-black text-emerald-800">{config.lineOaId}</span>
            </div>
            {config.botDisplayName && (
              <span className="text-slate-500 font-medium">ชื่อบอท: {config.botDisplayName}</span>
            )}
          </div>
        )}
      </div>

      {/* 2. Credentials Configuration */}
      <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Settings className="w-4 h-4 text-indigo-600" />
          ข้อมูล Messaging API จาก LINE Developers Console
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              Channel ID <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="1657XXXXXX (ตัวเลข 10 หลัก)"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700">
              Channel Secret <span className="text-rose-500">*</span>{' '}
              {config.hasChannelSecret && <span className="text-emerald-600 font-semibold">(บันทึกแล้ว)</span>}
            </label>
            <input
              type="password"
              value={channelSecret}
              onChange={(e) => setChannelSecret(e.target.value)}
              placeholder={config.hasChannelSecret ? '••••••••••••••••••••••••••••••••' : 'ป้อน Channel Secret 32 หลัก'}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:border-indigo-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSaveCredentials}
            disabled={saving}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl transition-all shadow-md shadow-indigo-500/20 cursor-pointer disabled:opacity-50"
          >
            {saving ? 'กำลังตรวจสอบและบันทึก...' : 'ตรวจสอบและบันทึกการเชื่อมต่อ'}
          </button>
        </div>
      </div>

      {/* 3. Webhook URL Configuration */}
      <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            Webhook URL สำหรับนำไปใส่ใน LINE Developers Console
          </h2>
          <button
            onClick={handleRotateWebhook}
            disabled={rotatingKey}
            className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rotatingKey ? 'animate-spin' : ''}`} />
            หมุนเวียนคีย์ (Rotate Key)
          </button>
        </div>

        {config.webhookUrl ? (
          <div className="space-y-3">
            <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-xs rounded-2xl break-all border border-slate-800 select-all">
              {config.webhookUrl}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(config.webhookUrl || '');
                  setCopiedWebhook(true);
                  setTimeout(() => setCopiedWebhook(false), 2000);
                }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                {copiedWebhook ? 'คัดลอกเรียบร้อย!' : 'คัดลอก Webhook URL'}
              </button>

              <button
                onClick={handleTestWebhook}
                disabled={testingWebhook}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${testingWebhook ? 'animate-spin' : ''}`} />
                {testingWebhook ? 'กำลังทดสอบ Webhook...' : 'ทดสอบ Webhook ทันที'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-500 text-center">
            Webhook URL จะแสดงขึ้นเมื่อระบบเตรียมความพร้อมของหอพักเรียบร้อย
          </div>
        )}
      </div>

      {/* 4. Event Notification Preferences */}
      <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
        <h2 className="text-sm font-black text-slate-900">
          กำหนดการแจ้งเตือนอัตโนมัติผ่าน LINE (Event Preferences)
        </h2>
        <p className="text-xs text-slate-500 -mt-2">
          เลือกประเภทเหตุการณ์ที่ต้องการให้ระบบส่งข้อความแจ้งเตือนอัตโนมัติไปยัง LINE
        </p>

        <div className="space-y-2.5 pt-1">
          {[
            { key: 'notifyRepairRequest' as const, title: 'คำขอแจ้งซ่อมใหม่', desc: 'แจ้งเตือนเมื่อผู้เช่าส่งคำขอแจ้งซ่อมเข้ามาในระบบ' },
            { key: 'notifyRepairCompleted' as const, title: 'งานแจ้งซ่อมเสร็จสิ้น', desc: 'แจ้งเตือนผู้เช่าเมื่อช่างดำเนินการซ่อมเสร็จเรียบร้อย' },
            { key: 'notifyPaymentReceived' as const, title: 'ได้รับยอดชำระเงิน', desc: 'แจ้งเตือนเมื่อระบบบันทึกหรือยืนยันการรับชำระเงินบิล' },
            { key: 'notifyTenantRegister' as const, title: 'ผู้เช่าใหม่ลงทะเบียน', desc: 'แจ้งเตือนเจ้าของ/ผู้จัดการเมื่อมีผู้เช่ากรอกฟอร์มลงทะเบียน' },
            { key: 'notifyTenantApproved' as const, title: 'อนุมัติผู้เช่าเข้าห้องพัก', desc: 'แจ้งเตือนผู้เช่าเมื่อได้รับการอนุมัติและสร้างสัญญา' },
          ].map((item) => (
            <label
              key={item.key}
              className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-2xl flex items-start gap-3 cursor-pointer select-none transition-colors"
            >
              <input
                type="checkbox"
                checked={config[item.key]}
                onChange={() => handleTogglePreference(item.key)}
                className="mt-0.5 rounded text-[#06C755] focus:ring-[#06C755] w-4 h-4"
              />
              <div>
                <span className="text-xs font-bold text-slate-800 block">{item.title}</span>
                <span className="text-[11px] text-slate-500">{item.desc}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="fixed inset-0 cursor-default" onClick={() => setShowHelpModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl z-10 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-indigo-600" />
                วิธีตั้งค่า LINE Official Account
              </h3>
              <button onClick={() => setShowHelpModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-100 font-medium">
                1. เข้าสู่ <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline inline-flex items-center gap-1">LINE Developers Console <ExternalLink className="w-3 h-3" /></a> แล้วเลือกหรือสร้าง Provider
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                2. สร้าง Channel ประเภท <strong>Messaging API</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                3. ในแท็บ <strong>Basic settings</strong> ให้คัดลอก <strong>Channel ID</strong> และ <strong>Channel Secret</strong> มาวางในช่องด้านบน
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                4. ในแท็บ <strong>Messaging API</strong> นำ <strong>Webhook URL</strong> จากระบบ HorPlus ไปวาง และเปิดใช้งาน <strong>Use Webhook</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                5. ใน LINE Official Account Manager ให้ปิดฟังก์ชัน <strong>Auto-reply messages</strong> (ข้อความตอบกลับอัตโนมัติ) เพื่อให้บอท HorPlus ตอบกลับได้อย่างถูกต้อง
              </div>
            </div>

            <button
              onClick={() => setShowHelpModal(false)}
              className="w-full py-2.5 bg-indigo-600 text-white font-extrabold text-xs rounded-xl hover:bg-indigo-700 transition-colors"
            >
              เข้าใจแล้ว ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default OwnerLineOaPage;
