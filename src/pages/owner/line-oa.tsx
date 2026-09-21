import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Copy,
  Check,
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
  Eye,
  EyeOff,
  LayoutGrid,
} from 'lucide-react';
import { Task009ApiAdapter } from '../../data/adapters/task009';
import { LineLogo } from '../../components/LineLogo';

interface OwnerLineOaPageProps {
  dormitoryId?: string;
  onNavigateBack?: () => void;
  isModal?: boolean;
  onClose?: () => void;
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
}

export const OwnerLineOaPage: React.FC<OwnerLineOaPageProps> = ({
  dormitoryId,
  onNavigateBack,
  isModal,
  onClose,
  onAddLog,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingLine, setTestingLine] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lineStatusMsg, setLineStatusMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [isEditingCredentials, setIsEditingCredentials] = useState(false);
  const [syncingRichMenu, setSyncingRichMenu] = useState(false);
  const [syncRichMenuResult, setSyncRichMenuResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Form inputs
  const [channelId, setChannelId] = useState('');
  const [channelSecret, setChannelSecret] = useState('');
  const [showSecret, setShowSecret] = useState(true);
  const [maskedDisplay, setMaskedDisplay] = useState('');
  const [hasOpenedConsoleTab, setHasOpenedConsoleTab] = useState(false);
  const maskTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (maskTimerRef.current) {
        clearTimeout(maskTimerRef.current);
      }
    };
  }, []);

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

  const dormId = dormitoryId || (typeof window !== 'undefined' ? (localStorage.getItem('horplus_current_dormitory_id') || localStorage.getItem('selected_dormitory_id')) : '') || 'dorm-fresh-01';

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const normalizeWebhookUrl = (url: string | null | undefined, ready = false): string => {
    if (!url) {
      return ready && currentOrigin ? `${currentOrigin}/api/v1/line/webhook/${dormId}` : '';
    }
    if (currentOrigin && (currentOrigin.includes('.trycloudflare.com') || currentOrigin.includes('ngrok'))) {
      const pathPart = url.replace(/^https?:\/\/[^/]+/, '');
      return `${currentOrigin}${pathPart}`;
    }
    return url;
  };

  const formatLineId = (id?: string | null): string => {
    if (!id) return '';
    const clean = id.replace(/^@+/, '');
    return clean ? `@${clean}` : '';
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      const res = await Task009ApiAdapter.getLineOaConfig(dormId);
      if (res.data) {
        setConfig({
          ...res.data,
          webhookUrl: normalizeWebhookUrl(res.data.webhookUrl),
        });
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

  const handleTestLineConnection = async () => {
    if (!channelId.trim() || (!channelSecret.trim() && !config.hasChannelSecret)) {
      setLineStatusMsg({ type: 'error', msg: 'กรุณากรอก Channel ID และ Channel Secret ให้ครบถ้วน' });
      return;
    }

    setTestingLine(true);
    setLineStatusMsg(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // 1. Update & verify credentials
      const updateRes = await Task009ApiAdapter.updateLineOaConfig(dormId, {
        channelId: channelId.trim(),
        channelSecret: channelSecret.trim() || undefined,
      });

      if (updateRes.error) {
        setLineStatusMsg({
          type: 'error',
          msg: updateRes.error.message || 'ไม่สามารถเชื่อมต่อ LINE OA ได้ กรุณาตรวจสอบ Channel ID และ Channel Secret',
        });
        return;
      }

      if (updateRes.data) {
        let currentConf = {
          ...updateRes.data,
          webhookUrl: normalizeWebhookUrl(updateRes.data.webhookUrl),
        };
        const effectiveWebhook = currentConf.webhookUrl || normalizeWebhookUrl('', true);
        if (!currentConf.webhookUrl) {
          currentConf = { ...currentConf, webhookUrl: effectiveWebhook };
        }
        setConfig(currentConf);
        if (onAddLog) {
          onAddLog('ตั้งค่า LINE Official Account', 'อัปเดตข้อมูลเชื่อมต่อ LINE OA สำเร็จ', 'LineOA', dormId);
        }

        // 2. Also test webhook endpoint readiness if webhook is set
        try {
          const webhookTestRes = await Task009ApiAdapter.testWebhookEndpoint(dormId);
          if (webhookTestRes.data) {
            currentConf = {
              ...webhookTestRes.data,
              webhookUrl: normalizeWebhookUrl(webhookTestRes.data.webhookUrl) || effectiveWebhook,
            };
            setConfig(currentConf);
          }
        } catch {
          // Webhook test may fail if owner hasn't pasted it in LINE Developers Console yet
        }

        if (currentConf.isReady) {
          setLineStatusMsg({ type: 'success', msg: 'เชื่อมต่อ LINE OA และ Webhook สมบูรณ์แล้ว!' });
          setIsEditingCredentials(false);
        } else {
          setLineStatusMsg({
            type: 'success',
            msg: '',
          });
        }
      }
    } catch (err: any) {
      setLineStatusMsg({
        type: 'error',
        msg: err.message || 'เกิดข้อผิดพลาดในการตรวจสอบสถานะ LINE OA',
      });
    } finally {
      setTestingLine(false);
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
        setConfig({
          ...res.data,
          webhookUrl: normalizeWebhookUrl(res.data.webhookUrl),
        });
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
        setConfig({
          ...res.data,
          webhookUrl: normalizeWebhookUrl(res.data.webhookUrl),
        });
        setSuccessMessage('หมุนเวียนคีย์ Webhook ใหม่เรียบร้อยแล้ว');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการหมุนเวียนคีย์ Webhook');
    } finally {
      setRotatingKey(false);
    }
  };

  const handleSyncRichMenu = async () => {
    setSyncingRichMenu(true);
    setSyncRichMenuResult(null);
    try {
      const res = await Task009ApiAdapter.syncRichMenus(dormId);
      if (res.error) {
        setSyncRichMenuResult({
          type: 'error',
          msg: res.error.message || 'ไม่สามารถซิงค์ Rich Menu ได้ กรุณาตรวจสอบการเชื่อมต่อ LINE OA',
        });
      } else {
        setSyncRichMenuResult({
          type: 'success',
          msg: 'ซิงค์ Rich Menu (เมนูเจ้าของ 3 ปุ่ม และเมนูผู้เช่า 2 ปุ่ม) ไปยัง LINE เรียบร้อยแล้ว!',
        });
        if (onAddLog) {
          onAddLog('ซิงค์ Rich Menu LINE OA', 'สร้างและอัปโหลด Rich Menu สำเร็จ', 'LineOA', dormId);
        }
      }
    } catch (err: any) {
      setSyncRichMenuResult({
        type: 'error',
        msg: err.message || 'เกิดข้อผิดพลาดในการซิงค์ Rich Menu',
      });
    } finally {
      setSyncingRichMenu(false);
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
        setMaskedDisplay('');
        if (maskTimerRef.current) {
          clearTimeout(maskTimerRef.current);
          maskTimerRef.current = null;
        }
        setIsEditingCredentials(false);
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

  const isConfiguredAndReady = Boolean(config.connected && config.isReady);
  const showStep6View = !isConfiguredAndReady || isEditingCredentials;
  const isWebhookReady = Boolean(config.connected || config.credentialsVerified);
  const isBotVerified = Boolean(config.connected || config.credentialsVerified || (config.botDisplayName && config.botPictureUrl));
  const effectiveWebhookUrl = normalizeWebhookUrl(config.webhookUrl, isWebhookReady);
  const effectiveChannelId = (channelId || config.channelId || '').trim();

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 pb-24">
      {/* Header Bar (LOA-04 Responsive Layout across 3 devices) */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {!isModal && (
            <button
              onClick={onNavigateBack || (() => window.history.back())}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer shrink-0"
              title="ย้อนกลับ"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 flex items-center gap-2 truncate">
              <LineLogo className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
              <span className="truncate">ตั้งค่า LINE Official Account (LINE OA)</span>
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate hidden xs:block">
              ตั้งค่าการเชื่อมต่อ LINE Messaging API และการแจ้งเตือนอัตโนมัติ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowHelpModal(true)}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="ดูวิธีตั้งค่า LINE OA"
          >
            <HelpCircle className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="hidden sm:inline">ดูวิธีตั้งค่า LINE OA</span>
            <span className="sm:hidden font-extrabold">วิธีตั้งค่า</span>
          </button>

          {isModal && (
            <button
              onClick={onClose || onNavigateBack}
              className="p-1.5 sm:p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              title="ปิดหน้าต่าง"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
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

      {/* VIEW A: Step 6 Credentials Form (LOA-05 De-cluttered without heavy outer green box) */}
      {showStep6View && (
        <div className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-5">

          {/* Bot Profile Header Card */}
          <div className="p-3 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden">
                {isBotVerified && config.botPictureUrl ? (
                  <img
                    src={config.botPictureUrl}
                    alt={config.botDisplayName || 'LINE OA'}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <LineLogo className={`w-6 h-6 shrink-0 rounded-xs ${!isBotVerified ? 'opacity-60 grayscale' : ''}`} />
                )}
              </div>
              <div className="min-w-0">
                <h4 className="text-xs sm:text-sm font-black text-slate-800 truncate">
                  {isBotVerified
                    ? (config.botDisplayName || 'LINE Official Account')
                    : 'ยังไม่ได้เชื่อมต่อ LINE Official Account'}
                </h4>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <span className="text-[11px] text-slate-500 font-bold">LINE ID:</span>
                  <span className={`text-[11px] font-black px-2 py-0.5 rounded-md ${isBotVerified
                    ? 'text-emerald-800 bg-emerald-100/90'
                    : 'text-slate-500 bg-slate-100'
                    }`}>
                    {isBotVerified
                      ? (formatLineId(config.lineOaId) || 'เชื่อมต่อแล้ว')
                      : 'ยังไม่ได้ตรวจสอบ'}
                  </span>
                </div>
              </div>
            </div>

            <div className="shrink-0">
              <span className={`px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 ${isBotVerified
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${isBotVerified ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {isBotVerified ? 'เชื่อมต่อสำเร็จ' : 'ยังไม่ได้ตรวจสอบ'}
              </span>
            </div>
          </div>

          {/* Form Fields (LOA-07 Concise labels) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                LINE Channel ID
              </label>
              <input
                type="text"
                value={channelId}
                onChange={(e) => {
                  setChannelId(e.target.value);
                  setHasOpenedConsoleTab(false);
                  setLineStatusMsg(null);
                  setConfig((prev) => ({
                    ...prev,
                    connected: false,
                    isReady: false,
                    credentialsVerified: false,
                    botDisplayName: null,
                    botPictureUrl: null,
                    lineOaId: null,
                    webhookUrl: null,
                  }));
                }}
                placeholder="เช่น 1657889900"
                className="w-full px-3.5 py-2 text-xs bg-slate-50/60 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-none font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                LINE Channel Secret
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={showSecret ? channelSecret : maskedDisplay}
                  onChange={(e) => {
                    setLineStatusMsg(null);
                    setConfig((prev) => ({
                      ...prev,
                      connected: false,
                      isReady: false,
                      credentialsVerified: false,
                      botDisplayName: null,
                      botPictureUrl: null,
                      lineOaId: null,
                      webhookUrl: null,
                    }));
                    const inputVal = e.target.value;

                    if (showSecret) {
                      setChannelSecret(inputVal);
                      setMaskedDisplay('•'.repeat(inputVal.length));
                      return;
                    }

                    // Masked mode with last-character preview
                    if (maskTimerRef.current) {
                      clearTimeout(maskTimerRef.current);
                      maskTimerRef.current = null;
                    }

                    if (!inputVal) {
                      setChannelSecret('');
                      setMaskedDisplay('');
                      return;
                    }

                    const prevLen = maskedDisplay.length;
                    const newLen = inputVal.length;
                    let newSecret = channelSecret;

                    if (newLen > prevLen) {
                      // Characters added (typing or pasting)
                      const addedCount = newLen - prevLen;
                      const addedText = inputVal.slice(-addedCount);

                      if (!inputVal.includes('•')) {
                        // Pasted full string or replaced selection without bullets
                        newSecret = inputVal;
                      } else {
                        newSecret = channelSecret + addedText;
                      }

                      setChannelSecret(newSecret);

                      // Show last character before turning into •
                      const lastChar = newSecret.slice(-1);
                      const masked = '•'.repeat(newSecret.length - 1) + lastChar;
                      setMaskedDisplay(masked);

                      maskTimerRef.current = setTimeout(() => {
                        setMaskedDisplay('•'.repeat(newSecret.length));
                      }, 800);
                    } else if (newLen < prevLen) {
                      // Characters deleted (backspace or cut)
                      const deletedCount = prevLen - newLen;
                      newSecret = channelSecret.slice(0, Math.max(0, channelSecret.length - deletedCount));
                      setChannelSecret(newSecret);
                      setMaskedDisplay('•'.repeat(newSecret.length));
                    } else {
                      setMaskedDisplay('•'.repeat(newSecret.length));
                    }
                  }}
                  onCopy={(e) => {
                    if (!showSecret) {
                      e.preventDefault();
                    }
                  }}
                  onCut={(e) => {
                    if (!showSecret) {
                      e.preventDefault();
                    }
                  }}
                  placeholder={config.hasChannelSecret ? '(บันทึกไว้แล้ว - กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน)' : 'e4d8f9c2a1b3c4d5e6f7...'}
                  className="w-full pl-3.5 pr-10 py-2 text-xs bg-slate-50/60 border border-slate-200 rounded-xl focus:bg-white focus:border-emerald-500 outline-none font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (maskTimerRef.current) {
                      clearTimeout(maskTimerRef.current);
                      maskTimerRef.current = null;
                    }
                    if (showSecret) {
                      setShowSecret(false);
                      setMaskedDisplay('•'.repeat(channelSecret.length));
                    } else {
                      setShowSecret(true);
                    }
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  title={showSecret ? 'กำลังแสดงรหัส (คลิกเพื่อซ่อน)' : 'กำลังซ่อนรหัส (คลิกเพื่อแสดง)'}
                  aria-label={showSecret ? 'กำลังแสดงรหัส (คลิกเพื่อซ่อน)' : 'กำลังซ่อนรหัส (คลิกเพื่อแสดง)'}
                >
                  {showSecret ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Webhook URL Section (LOA-06 Immediate display, LOA-07 Concise copywriting & LOA-23 Label Parity) */}
          <div className="pt-1">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              <span>LINE Webhook URL </span>
              <span className="text-[11px] font-normal text-slate-400">
                (นำ Webhook URL ไปใส่และเปิด Use Webhook ใน{' '}
                <a
                  href={
                    config.connected && effectiveChannelId
                      ? `https://developers.line.biz/console/channel/${effectiveChannelId}/messaging-api`
                      : 'https://developers.line.biz/console/'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 hover:text-emerald-800 font-bold underline decoration-emerald-400 inline-flex items-center gap-0.5 transition-colors"
                  title={
                    config.connected && effectiveChannelId
                      ? 'เปิด LINE Developers Console > Messaging API ในแท็บใหม่'
                      : 'เปิด LINE Developers Console ในแท็บใหม่'
                  }
                >
                  <span>LINE Developers Console &gt; Messaging API</span>
                  <ExternalLink className="w-3 h-3 text-emerald-600 shrink-0" />
                </a>
                )
              </span>
            </label>

            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  readOnly
                  value={isWebhookReady ? effectiveWebhookUrl : ''}
                  placeholder="จะแสดงขึ้นหลังกดทดสอบสถานะผ่าน"
                  className={`w-full px-3.5 py-2 text-xs rounded-xl outline-none font-mono transition-all border ${isWebhookReady
                    ? 'bg-emerald-50/80 text-emerald-800 border-emerald-300 font-bold select-all'
                    : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed placeholder:font-sans placeholder:text-slate-400 placeholder:text-xs'
                    }`}
                />
              </div>

              <button
                type="button"
                disabled={!isWebhookReady}
                onClick={() => {
                  if (effectiveWebhookUrl) {
                    navigator.clipboard.writeText(effectiveWebhookUrl);
                    setCopiedWebhook(true);
                    setTimeout(() => setCopiedWebhook(false), 2000);

                    // LOA-13: Open LINE Developers Console Messaging API in new tab after 2 seconds on first click if Channel ID is present
                    if (!hasOpenedConsoleTab && effectiveChannelId) {
                      setHasOpenedConsoleTab(true);
                      setTimeout(() => {
                        window.open(
                          `https://developers.line.biz/console/channel/${effectiveChannelId}/messaging-api`,
                          '_blank',
                          'noopener,noreferrer'
                        );
                      }, 2000);
                    }
                  }
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-2xs ${isWebhookReady
                  ? copiedWebhook
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-95'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                  }`}
                title={isWebhookReady ? 'คัดลอก Webhook URL' : 'กรุณากรอกข้อมูลและกดทดสอบสถานะก่อน'}
              >
                {copiedWebhook ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 font-extrabold">คัดลอกแล้ว!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-200" />
                    <span>คัดลอก</span>
                  </>
                )}
              </button>
            </div>

            {!isWebhookReady ? (
              <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1 font-medium">
                <span>* กรุณากรอก Channel ID และ Channel Secret แล้วกดทดสอบตรวจสถานะ</span>
              </p>
            ) : (
              <p className="text-[11px] text-emerald-700 mt-1.5 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>คัดลอก Webhook URL เพื่อนำไปเชื่อมต่อให้พร้อมใช้งาน</span>
              </p>
            )}
          </div>

          {/* Actions: Test Button & Cancel Edit (F-02) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestLineConnection}
                disabled={testingLine}
                className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${testingLine ? 'animate-spin' : ''}`} />
                <span>{testingLine ? 'กำลังทดสอบสัญญาณ...' : 'ทดสอบตรวจสถานะ LINE OA'}</span>
              </button>

              {isEditingCredentials && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingCredentials(false);
                    setLineStatusMsg(null);
                    setChannelSecret('');
                    setMaskedDisplay('');
                    if (maskTimerRef.current) {
                      clearTimeout(maskTimerRef.current);
                      maskTimerRef.current = null;
                    }
                  }}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
                >
                  ยกเลิกการแก้ไข
                </button>
              )}
            </div>

            {lineStatusMsg && (
              <span className={`text-xs font-bold ${lineStatusMsg.type === 'success' ? 'text-emerald-700' : 'text-rose-600'}`}>
                {lineStatusMsg.msg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* VIEW B: Full Management View (Only Shown when Connected & Webhook is Ready) */}
      {isConfiguredAndReady && !isEditingCredentials && (
        <>
          {/* 1. Status Card with Quota, Edit Button & Disconnect */}
          <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                  สถานะการเชื่อมต่อ
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-black border bg-emerald-100 text-emerald-800 border-emerald-300">
                    พร้อมใช้งาน (READY)
                  </span>
                  <span className="text-xs text-slate-500 font-medium">เชื่อมต่อและทดสอบ Webhook สมบูรณ์แล้ว</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  โควตาเดือนนี้: <strong className="text-emerald-600">{config.remainingQuota}/{config.monthlyQuota}</strong>
                </span>
                <button
                  onClick={() => setIsEditingCredentials(true)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Settings className="w-3.5 h-3.5" />
                  แก้ไขข้อมูลเชื่อมต่อ
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={saving}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl border border-rose-200 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  ยกเลิกเชื่อมต่อ
                </button>
              </div>
            </div>

            {config.lineOaId && (
              <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-slate-700">LINE OA Basic ID:</span>
                  <span className="font-mono font-black text-emerald-800">{formatLineId(config.lineOaId)}</span>
                </div>
                {config.botDisplayName && (
                  <span className="text-slate-500 font-medium">ชื่อบอท: {config.botDisplayName}</span>
                )}
              </div>
            )}
          </div>

          {/* 2. Webhook URL Configuration */}
          <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <LineLogo className="w-4 h-4 shrink-0 rounded-xs" />
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

            {effectiveWebhookUrl ? (
              <div className="space-y-3">
                <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-xs rounded-2xl break-all border border-slate-800 select-all">
                  {effectiveWebhookUrl}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(effectiveWebhookUrl || '');
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

          {/* 3. Rich Menu Management */}
          <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4 text-emerald-600 shrink-0" />
                  เมนูลัด LINE Official Account (Rich Menu)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  ระบบจะสร้าง Rich Menu 2500x843 px อัตโนมัติ: เมนู 3 ปุ่มสำหรับเจ้าของหอพัก และเมนู 2 ปุ่มสำหรับผู้เช่า
                </p>
              </div>

              <button
                type="button"
                onClick={handleSyncRichMenu}
                disabled={syncingRichMenu}
                className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap shadow-2xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${syncingRichMenu ? 'animate-spin text-emerald-600' : ''}`} />
                <span>{syncingRichMenu ? 'กำลังซิงค์ Rich Menu...' : 'ซิงค์ Rich Menu ไปยัง LINE'}</span>
              </button>
            </div>

            {syncRichMenuResult && (
              <div
                className={`p-3 rounded-2xl text-xs font-medium flex items-center gap-2 ${
                  syncRichMenuResult.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {syncRichMenuResult.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{syncRichMenuResult.msg}</span>
              </div>
            )}
          </div>

          {/* 4. Event Notification Preferences */}
          <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <LineLogo className="w-4 h-4 shrink-0 rounded-xs" />
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
        </>
      )}

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
