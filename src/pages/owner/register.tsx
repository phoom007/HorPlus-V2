import React, { useState, useRef, useEffect } from 'react';
import { 
  Building2, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  CreditCard, 
  ShieldCheck, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Trash2, 
  Zap, 
  Droplet, 
  Wifi, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  Save, 
  Check, 
  X, 
  Building as BuildingIcon,
  MessageSquare,
  PenTool,
  Upload,
  RefreshCw,
  Info,
  CheckCircle,
  Clock,
  HelpCircle,
  Users
} from 'lucide-react';
import { onboardingClient, CompleteOnboardingPayload } from '../../data/onboardingClient';

interface RegisterProps {
  onAddLog?: (action: string, details: string, module: string, targetId?: string) => void;
  onNavigate?: (tab: string) => void;
}

const BANK_OPTIONS = [
  'กรุงไทย (Krungthai)',
  'กสิกรไทย (KBank)',
  'กรุงเทพ (Bangkok)',
  'ไทยพาณิชย์ (SCB)',
  'กรุงศรีอยุธยา (Krungsri)',
  'ทหารไทยธนชาต (ttb)',
  'ยูโอบี (UOB)',
  'ออมสิน (GSB)',
  'ธ.ก.ส. (BAAC)',
];

const PROVINCE_OPTIONS = [
  'กรุงเทพมหานคร', 'เชียงใหม่', 'ชลบุรี', 'ขอนแก่น', 'นครราชสีมา', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'ภูเก็ต', 'สงขลา'
];

const REFERRAL_OPTIONS = [
  { id: 'facebook', label: 'Facebook / Social Media', icon: MessageSquare },
  { id: 'google', label: 'Google Search', icon: HelpCircle },
  { id: 'friend', label: 'เพื่อน / คนรู้จักแนะนำ', icon: Users },
  { id: 'other', label: 'อื่นๆ', icon: Sparkles }
];

export const OwnerRegister: React.FC<RegisterProps> = ({ onAddLog, onNavigate }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Provisional State
  const [provisionalDormitoryId, setProvisionalDormitoryId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  // Step 4: Signature States
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const hasDrawnRef = useRef(false);
  const [signatureSaved, setSignatureSaved] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);

  // Step 5: LINE OA States
  const [lineChannelId, setLineChannelId] = useState('');
  const [lineChannelSecret, setLineChannelSecret] = useState('');
  const [lineOaId, setLineOaId] = useState('');
  const [lineVerifying, setLineVerifying] = useState(false);
  const [lineStatus, setLineStatus] = useState<{
    credentialsVerified: boolean;
    webhookEndpointSet: boolean;
    webhookTestSucceeded: boolean;
    webhookActive: boolean;
    isReady: boolean;
  }>({
    credentialsVerified: false,
    webhookEndpointSet: false,
    webhookTestSucceeded: false,
    webhookActive: false,
    isReady: false,
  });

  const [selectedPlan, setSelectedPlan] = useState<'FREE' | 'PAID'>('FREE');
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(undefined);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoResult, setPromoResult] = useState<{
    valid: boolean;
    eligible: boolean;
    code: string;
    message: string;
    trialMonths: number;
    promoBonusMonths: number;
    totalTrialMonths: number;
  } | null>(null);
  const [catalogPackages, setCatalogPackages] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    setCatalogLoading(true);
    onboardingClient.getAvailablePackages()
      .then((res: any) => {
        const list = res.data || res || [];
        const pkgs = Array.isArray(list) ? list : [];
        setCatalogPackages(pkgs);
        setCatalogError(null);

        const pro = pkgs.find((p: any) => p.planCode === 'PAID' || p.plan?.code === 'PAID' || p.code === 'PRO' || p.planCode === 'PRO');
        if (pro) {
          setSelectedPackageId(pro.id);
        }
      })
      .catch(() => {
        setCatalogError('ไม่สามารถโหลดแพ็กเกจจากระบบได้ กรุณาลองใหม่อีกครั้ง');
      })
      .finally(() => {
        setCatalogLoading(false);
      });

    onboardingClient.getDraft()
      .then(async (res: any) => {
        const draft = res.data || res;
        if (draft && draft.payload && !draft.finalizedAt) {
          if (draft.payload.dormitoryName) {
            setFormData(prev => ({
              ...prev,
              ...draft.payload,
            }));
          }
          if (draft.provisionalDormitoryId) {
            setProvisionalDormitoryId(draft.provisionalDormitoryId);
            setSignatureSaved(true);
            try {
              const lineRes = await onboardingClient.getLineConfig(draft.provisionalDormitoryId);
              const raw = lineRes.data || lineRes;
              const config = raw.config || raw;
              const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
              const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
              const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
              const webhookActive = Boolean(config.webhookActive);
              const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;
              setLineStatus({
                credentialsVerified,
                webhookEndpointSet,
                webhookTestSucceeded,
                webhookActive,
                isReady,
              });
            } catch {}
          }
        }
      })
      .catch(() => {});
  }, []);

  const proPkg = catalogPackages.find((p: any) => p.planCode === 'PAID' || p.plan?.code === 'PAID' || p.code === 'PRO' || p.planCode === 'PRO');
  const proDisplayPrice = proPkg ? `${proPkg.price} ${proPkg.currency || 'THB'}` : null;

  // Terms Modal State
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [referralSource, setReferralSource] = useState('facebook');
  const [referralOtherText, setReferralOtherText] = useState('');

  // Form Data State
  const [formData, setFormData] = useState({
    dormitoryName: '',
    dormitoryType: 'อพาร์ตเมนต์',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    province: 'กรุงเทพมหานคร',
    postalCode: '10110',
    buildings: [
      {
        id: 'bld-1',
        name: 'อาคาร A',
        roomPrefix: 'A',
        floorsCount: 1,
        roomsPerFloor: 1,
        monthlyRent: 0,
        securityDeposit: 0,
      }
    ],
    utilities: {
      waterRate: 0,
      waterBillingMode: 'unit',
      electricRate: 0,
      electricBillingMode: 'unit',
      commonFeeRate: 0,
      commonFeeMode: 'free',
      internetRate: 0,
      internetFeeMode: 'free',
      parkingFeeRate: 0,
      parkingFeeMode: 'free',
    },
    paymentAccount: {
      bankName: '',
      accountNumber: '',
      accountName: '',
      promptPayId: '',
    },
    deposits: {
      dueDateDay: 5,
      lateFeeType: 'none',
      lateFeeAmount: 0,
    }
  });

  // Initialize Canvas Context
  useEffect(() => {
    if (currentStep === 4) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
      }
    }
  }, [currentStep]);

  // Handle Canvas Drawing
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    hasDrawnRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx?.beginPath();
    ctx?.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    hasDrawnRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx?.lineTo(clientX - rect.left, clientY - rect.top);
    ctx?.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    setSignatureSaved(false);
  };

  // Prepare Provisional Dormitory before Step 4
  const ensureProvisionalDormitory = async () => {
    if (provisionalDormitoryId) return provisionalDormitoryId;
    try {
      const draftRes = await onboardingClient.getDraft();
      const draft = draftRes.data || draftRes;
      if (draft && draft.provisionalDormitoryId) {
        setProvisionalDormitoryId(draft.provisionalDormitoryId);
        return draft.provisionalDormitoryId;
      }
    } catch {}
    try {
      const res = await onboardingClient.prepare({
        name: formData.dormitoryName || 'หอพักใหม่',
        addressLine1: formData.address,
        province: formData.province,
      });
      const dormId = res.data?.provisionalDormitoryId || res.provisionalDormitoryId;
      const webUrl = res.data?.webhookUrl || res.webhookUrl;
      setProvisionalDormitoryId(dormId);
      if (webUrl) setWebhookUrl(webUrl);
      return dormId;
    } catch (err: any) {
      setValidationError(err.message || 'ไม่สามารถเตรียมข้อมูลหอพักชั่วคราวได้');
      return null;
    }
  };

  // Upload Signature
  const handleSaveSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!hasDrawnRef.current) {
      setValidationError('กรุณาวาดลายเซ็นก่อนกดบันทึก');
      return;
    }

    const dormId = await ensureProvisionalDormitory();
    if (!dormId) return;

    setSignatureUploading(true);
    setValidationError(null);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setSignatureUploading(false);
        setValidationError('ไม่สามารถสร้างรูปภาพลายเซ็นได้');
        return;
      }

      const file = new File([blob], 'signature.png', { type: 'image/png' });
      const fd = new FormData();
      fd.append('file', file);

      try {
        await onboardingClient.uploadSignature(dormId, fd);
        setSignatureSaved(true);
        setValidationError(null);
      } catch (err: any) {
        setValidationError(err.message || 'เกิดข้อผิดพลาดในการบันทึกลายเซ็น');
      } finally {
        setSignatureUploading(false);
      }
    }, 'image/png');
  };

  // Handle LINE Credentials Update
  const handleSaveLineCredentials = async () => {
    if (!lineChannelId.trim() || !lineChannelSecret.trim()) {
      setValidationError('กรุณากรอก Channel ID และ Channel Secret');
      return;
    }

    const dormId = await ensureProvisionalDormitory();
    if (!dormId) return;

    setLineVerifying(true);
    setValidationError(null);

    try {
      const res = await onboardingClient.updateLineConfig(dormId, {
        channelId: lineChannelId.trim(),
        channelSecret: lineChannelSecret.trim(),
        lineOaId: lineOaId.trim() || undefined,
      });

      const raw = res.data || res;
      const config = raw.config || raw;
      const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
      const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
      const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      setLineStatus({
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        isReady,
      });

      if (config.webhookUrl) {
        setWebhookUrl(config.webhookUrl);
      }
    } catch (err: any) {
      setValidationError(err.message || 'การตรวจสอบ LINE Credentials ล้มเหลว');
    } finally {
      setLineVerifying(false);
    }
  };

  // Handle Set Webhook Endpoint
  const handleSetLineWebhook = async () => {
    if (!provisionalDormitoryId) return;
    setLineVerifying(true);
    try {
      const res = await onboardingClient.setLineWebhook(provisionalDormitoryId);
      const raw = res.data || res;
      const config = raw.config || raw;
      const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
      const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
      const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      setLineStatus({
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        isReady,
      });
    } catch (err: any) {
      setValidationError(err.message || 'ตั้งค่า Webhook Endpoint ไม่สำเร็จ');
    } finally {
      setLineVerifying(false);
    }
  };

  // Handle Test Webhook Endpoint
  const handleTestLineWebhook = async () => {
    if (!provisionalDormitoryId) return;
    setLineVerifying(true);
    try {
      const res = await onboardingClient.testLineWebhook(provisionalDormitoryId);
      const raw = res.data || res;
      const config = raw.config || raw;
      const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
      const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
      const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      setLineStatus({
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        isReady,
      });
    } catch (err: any) {
      setValidationError(err.message || 'ทดสอบ Webhook ไม่สำเร็จ');
    } finally {
      setLineVerifying(false);
    }
  };

  // Handle Promo Validation (Canonical Month-Native Preview DTO)
  const handleValidatePromo = async () => {
    if (!promoCodeInput.trim()) return;
    try {
      const res = await onboardingClient.validatePromo(promoCodeInput.trim().toUpperCase());
      const data = res.data || res;
      setPromoResult({
        valid: Boolean(data.valid || data.eligible),
        eligible: Boolean(data.eligible || data.valid),
        code: data.code || promoCodeInput.trim().toUpperCase(),
        message: data.message || (data.valid ? `ใช้งานรหัสโปรโมชันสำเร็จ (+${data.promoBonusMonths || 2} เดือน)` : 'รหัสไม่ถูกต้อง'),
        trialMonths: data.trialMonths || 1,
        promoBonusMonths: data.promoBonusMonths || 2,
        totalTrialMonths: data.totalTrialMonths || 3,
      });
    } catch (err: any) {
      setPromoResult({
        valid: false,
        eligible: false,
        code: promoCodeInput.trim().toUpperCase(),
        message: err.message || 'รหัสโปรโมชันไม่ถูกต้อง',
        trialMonths: 1,
        promoBonusMonths: 0,
        totalTrialMonths: 1,
      });
    }
  };

  // Step Navigation Validation
  const handleNextStep = async () => {
    setValidationError(null);

    let nextStepNum = currentStep;
    if (currentStep === 1) {
      if (!formData.dormitoryName.trim()) {
        setValidationError('กรุณากรอกชื่อหอพัก');
        return;
      }
      nextStepNum = 2;
      setCurrentStep(2);
    } else if (currentStep === 2) {
      nextStepNum = 3;
      setCurrentStep(3);
    } else if (currentStep === 3) {
      nextStepNum = 4;
      setCurrentStep(4);
    } else if (currentStep === 4) {
      const dormId = provisionalDormitoryId || await ensureProvisionalDormitory();
      if (!signatureSaved && !dormId) {
        setValidationError('กรุณากด "บันทึกลายเซ็น" ในขั้นตอนที่ 4 ก่อนดำเนินการต่อ');
        return;
      }
      nextStepNum = 5;
      setCurrentStep(5);
    } else if (currentStep === 5) {
      const dormId = provisionalDormitoryId || await ensureProvisionalDormitory();
      let isReady = lineStatus.isReady;
      if (!isReady && dormId) {
        try {
          const lineRes = await onboardingClient.getLineConfig(dormId);
          const raw = lineRes.data || lineRes;
          const config = raw.config || raw;
          const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
          const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
          const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
          const webhookActive = Boolean(config.webhookActive);
          isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;
          if (isReady) {
            setLineStatus({
              credentialsVerified,
              webhookEndpointSet,
              webhookTestSucceeded,
              webhookActive,
              isReady: true,
            });
          }
        } catch {}
      }

      if (!isReady) {
        setValidationError('กรุณาตั้งค่า LINE OA ให้ครบทุกขั้นตอนก่อนดำเนินการต่อ');
        return;
      }
      nextStepNum = 6;
      setCurrentStep(6);
    }

    onboardingClient.saveDraft(String(nextStepNum), {
      dormitoryName: formData.dormitoryName,
      address: formData.address,
      province: formData.province,
      ...formData,
    }, provisionalDormitoryId || undefined).catch(() => {});
  };

  // Finalize Registration (Step 6 -> Modal -> API)
  const handleFinalizeRegistration = async () => {
    setIsSubmitting(true);
    setValidationError(null);

    const rooms: any[] = [];
    formData.buildings.forEach((b) => {
      for (let f = 1; f <= b.floorsCount; f++) {
        for (let r = 1; r <= b.roomsPerFloor; r++) {
          const roomNumber = `${b.roomPrefix}${f}${r < 10 ? '0' + r : r}`;
          rooms.push({
            buildingId: b.id,
            roomNumber,
            floor: f,
            monthlyRent: Number(b.monthlyRent) || 0,
            depositAmount: Number(b.securityDeposit) || 0,
          });
        }
      }
    });

    const rawPp = formData.paymentAccount.promptPayId ? formData.paymentAccount.promptPayId.replace(/\D/g, '') : '';
    let inferredPpType: 'mobile_phone' | 'national_id' | undefined = undefined;
    if (rawPp.length === 10) inferredPpType = 'mobile_phone';
    else if (rawPp.length === 13) inferredPpType = 'national_id';

    const payload: CompleteOnboardingPayload = {
      provisionalDormitoryId: provisionalDormitoryId || undefined,
      packageId: selectedPlan === 'PAID' ? (selectedPackageId || proPkg?.id) : undefined,
      dormitory: {
        name: formData.dormitoryName,
        type: formData.dormitoryType,
        addressLine1: formData.address,
        province: formData.province,
        postalCode: formData.postalCode,
        phone: formData.phone,
        email: formData.email,
        estimatedBuildingCount: formData.buildings.length,
        estimatedRoomCount: rooms.length,
      },
      billing: {
        billingDay: 25,
        dueDay: formData.deposits.dueDateDay || 5,
        waterBillingType: 'per_unit',
        waterRate: String(formData.utilities.waterRate),
        electricityBillingType: 'per_unit',
        electricityRate: String(formData.utilities.electricRate),
        commonFee: String(formData.utilities.commonFeeRate),
        internetFee: String(formData.utilities.internetRate),
        lateFeeType: formData.deposits.lateFeeType,
        lateFeeValue: String(formData.deposits.lateFeeAmount),
        rentBillingType: 'monthly',
      },
      payment: {
        cashAccepted: true,
        promptPayType: inferredPpType,
        promptPayValue: rawPp || undefined,
        bankCode: formData.paymentAccount.bankName,
        bankAccountName: formData.paymentAccount.accountName,
        bankAccountNumber: formData.paymentAccount.accountNumber,
      },
      buildings: formData.buildings.map(b => ({
        id: b.id,
        name: b.name,
        code: b.roomPrefix,
        floorsCount: b.floorsCount,
        roomsPerFloor: b.roomsPerFloor,
      })),
      rooms,
      planCode: selectedPlan === 'PAID' ? 'PAID' : 'FREE',
      promoCode: promoResult?.valid ? (promoResult.code || 'HORPLUS') : undefined,
    };

    const idempotencyKey = `register-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      await onboardingClient.finalize(payload, idempotencyKey);
      setIsSavedSuccess(true);
      if (onAddLog) {
        onAddLog('CREATE_DORMITORY', `สร้างหอพัก ${formData.dormitoryName} สำเร็จ`, 'ONBOARDING');
      }
      setTimeout(() => {
        if (onNavigate) onNavigate('dashboard');
        window.location.href = '/owner/dashboard';
      }, 1500);
    } catch (err: any) {
      setValidationError(err.message || 'เกิดข้อผิดพลาดในการลงทะเบียนสร้างหอพัก');
    } finally {
      setIsSubmitting(false);
      setShowTermsModal(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white p-6 sm:p-8 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-bold text-blue-200">
            <Sparkles className="w-3.5 h-3.5" /> ระบบลงทะเบียนเจ้าของหอพัก (Master 6-Step Flow)
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">ลงทะเบียนตั้งค่าหอพักใหม่</h1>
          <p className="text-xs sm:text-sm text-blue-100/90 max-w-xl font-medium leading-relaxed">
            กรอกข้อมูลตั้งค่าหอพัก ลายเซ็นอิเล็กทรอนิกส์ และ LINE Official Account เพื่อเปิดใช้งานระบบทันที
          </p>
        </div>
      </div>

      {/* 6-Step Stepper Navigation */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
        <div className="grid grid-cols-6 gap-1 sm:gap-2 text-center">
          {[
            { step: 1, title: '1. ข้อมูลหอพัก', desc: 'ชื่อ & ที่อยู่' },
            { step: 2, title: '2. อาคาร & ห้อง', desc: 'โครงสร้างหอ' },
            { step: 3, title: '3. อัตราค่าน้ำไฟ', desc: 'ค่าบริการ' },
            { step: 4, title: '4. บัญชี & ลายเซ็น', desc: 'ผู้ถือสิทธิ์' },
            { step: 5, title: '5. LINE OA', desc: 'เชื่อมต่อไลน์' },
            { step: 6, title: '6. สรุป & แพ็กเกจ', desc: 'ยืนยันสิทธิ์' },
          ].map((s) => {
            const isActive = currentStep === s.step;
            const isDone = currentStep > s.step;
            return (
              <button
                key={s.step}
                data-testid={`step-button-${s.step}`}
                onClick={() => {
                  if (s.step < currentStep || isDone) setCurrentStep(s.step);
                }}
                className={`p-2.5 rounded-2xl transition-all text-left flex flex-col justify-between ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : isDone
                    ? 'bg-blue-50 text-blue-800 border border-blue-100 hover:bg-blue-100/80'
                    : 'bg-slate-50 text-slate-400 border border-slate-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-black uppercase tracking-wider ${isActive ? 'text-blue-200' : isDone ? 'text-blue-600' : 'text-slate-400'}`}>
                    STEP {s.step}
                  </span>
                  {isDone && <CheckCircle className="w-3.5 h-3.5 text-blue-600" />}
                </div>
                <span className="text-xs font-black truncate mt-1">{s.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Validation Alert */}
      {validationError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-rose-800 text-xs font-bold animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{validationError}</span>
          </div>
          <button onClick={() => setValidationError(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* STEP 1: Dormitory Details */}
      {currentStep === 1 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Building2 className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 1: ข้อมูลหอพัก & ที่อยู่</h3>
              <p className="text-xs text-slate-400 font-medium">ระบุชื่อหอพัก ข้อมูลติดต่อ และที่ตั้งสถานประกอบการ</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">ชื่อหอพัก / อพาร์ตเมนต์ <span className="text-rose-500">*</span></label>
              <input
                type="text"
                data-testid="input-dormitory-name"
                value={formData.dormitoryName}
                onChange={(e) => setFormData({ ...formData, dormitoryName: e.target.value })}
                placeholder="เช่น หอพักสุขใจ อพาร์ตเมนต์"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">ประเภทสถานประกอบการ</label>
              <select
                data-testid="select-dormitory-type"
                value={formData.dormitoryType}
                onChange={(e) => setFormData({ ...formData, dormitoryType: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              >
                <option value="อพาร์ตเมนต์">อพาร์ตเมนต์</option>
                <option value="หอพักนักศึกษา">หอพักนักศึกษา</option>
                <option value="คอนโดมิเนียม">คอนโดมิเนียม</option>
                <option value="บ้านเช่า">บ้านเช่า / ทาวน์เฮาส์</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">เบอร์โทรศัพท์ติดต่อ</label>
              <input
                type="text"
                data-testid="input-phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="081-234-5678"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">อีเมลติดต่อ</label>
              <input
                type="email"
                data-testid="input-email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="owner@example.com"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">ที่อยู่สถานประกอบการ</label>
              <input
                type="text"
                data-testid="input-address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="เลขที่ 123/45 ถนนพหลโยธิน แขวงลาดยาว เขตจตุจักร"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">จังหวัด</label>
              <select
                data-testid="select-province"
                value={formData.province}
                onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              >
                {PROVINCE_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">รหัสไปรษณีย์</label>
              <input
                type="text"
                data-testid="input-postal-code"
                value={formData.postalCode}
                onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                placeholder="10110"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Buildings & Rooms */}
      {currentStep === 2 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <BuildingIcon className="w-5 h-5 text-blue-600" />
              <div>
                <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 2: อาคาร & จำนวนห้องพัก</h3>
                <p className="text-xs text-slate-400 font-medium">เพิ่มอาคาร กำหนดจำนวนชั้น และจำนวนห้องต่อชั้น</p>
              </div>
            </div>
            <button
              type="button"
              data-testid="button-add-building"
              onClick={() => {
                const newId = `bld-${formData.buildings.length + 1}`;
                const charCode = 65 + formData.buildings.length;
                const letter = String.fromCharCode(charCode);
                setFormData({
                  ...formData,
                  buildings: [
                    ...formData.buildings,
                    {
                      id: newId,
                      name: `อาคาร ${letter}`,
                      roomPrefix: letter,
                      floorsCount: 4,
                      roomsPerFloor: 5,
                      monthlyRent: 4500,
                      securityDeposit: 5000,
                    }
                  ]
                });
              }}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> เพิ่มอาคาร
            </button>
          </div>

          <div className="space-y-4">
            {formData.buildings.map((b, idx) => (
              <div key={b.id} className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-blue-700 bg-blue-100/60 px-2.5 py-1 rounded-lg">
                    อาคารที่ {idx + 1}
                  </span>
                  {formData.buildings.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({
                          ...formData,
                          buildings: formData.buildings.filter(item => item.id !== b.id)
                        });
                      }}
                      className="text-rose-500 hover:text-rose-700 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">ชื่ออาคาร</label>
                    <input
                      type="text"
                      value={b.name}
                      onChange={(e) => {
                        const updated = [...formData.buildings];
                        updated[idx].name = e.target.value;
                        setFormData({ ...formData, buildings: updated });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">นำหน้านำห้อง (Prefix)</label>
                    <input
                      type="text"
                      value={b.roomPrefix}
                      onChange={(e) => {
                        const updated = [...formData.buildings];
                        updated[idx].roomPrefix = e.target.value;
                        setFormData({ ...formData, buildings: updated });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">จำนวนชั้น</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={b.floorsCount}
                      onChange={(e) => {
                        const updated = [...formData.buildings];
                        updated[idx].floorsCount = parseInt(e.target.value) || 1;
                        setFormData({ ...formData, buildings: updated });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">จำนวนห้อง / ชั้น</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={b.roomsPerFloor}
                      onChange={(e) => {
                        const updated = [...formData.buildings];
                        updated[idx].roomsPerFloor = parseInt(e.target.value) || 1;
                        setFormData({ ...formData, buildings: updated });
                      }}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3: Rates & Utilities */}
      {currentStep === 3 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Zap className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 3: อัตราค่าน้ำ ไฟฟ้า & ค่าบริการ</h3>
              <p className="text-xs text-slate-400 font-medium">กำหนดอัตราค่าน้ำ ค่าน้ำไฟ ค่าส่วนกลาง (รองรับค่า 0 บาท)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Water */}
            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl space-y-2">
              <label className="block font-black text-blue-900 flex items-center gap-1.5">
                <Droplet className="w-4 h-4 text-blue-600" /> ค่าน้ำประปา (บาท/หน่วย)
              </label>
              <input
                type="number"
                data-testid="input-water-rate"
                value={formData.utilities.waterRate}
                onChange={(e) => setFormData({ ...formData, utilities: { ...formData.utilities, waterRate: parseFloat(e.target.value) ?? 0 } })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-black text-slate-800 outline-none"
              />
            </div>

            {/* Electricity */}
            <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-2xl space-y-2">
              <label className="block font-black text-amber-900 flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-600" /> ค่าไฟฟ้า (บาท/หน่วย)
              </label>
              <input
                type="number"
                data-testid="input-electric-rate"
                value={formData.utilities.electricRate}
                onChange={(e) => setFormData({ ...formData, utilities: { ...formData.utilities, electricRate: parseFloat(e.target.value) ?? 0 } })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-black text-slate-800 outline-none"
              />
            </div>

            {/* Common Fee */}
            <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl space-y-2">
              <label className="block font-black text-emerald-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-emerald-600" /> ค่าส่วนกลาง (บาท/เดือน)
              </label>
              <input
                type="number"
                data-testid="input-common-fee"
                value={formData.utilities.commonFeeRate}
                onChange={(e) => setFormData({ ...formData, utilities: { ...formData.utilities, commonFeeRate: parseFloat(e.target.value) ?? 0 } })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-black text-slate-800 outline-none"
              />
            </div>

            {/* Internet */}
            <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2">
              <label className="block font-black text-indigo-900 flex items-center gap-1.5">
                <Wifi className="w-4 h-4 text-indigo-600" /> ค่าอินเทอร์เน็ต (บาท/เดือน)
              </label>
              <input
                type="number"
                data-testid="input-internet-fee"
                value={formData.utilities.internetRate}
                onChange={(e) => setFormData({ ...formData, utilities: { ...formData.utilities, internetRate: parseFloat(e.target.value) ?? 0 } })}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-black text-slate-800 outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: Payment Account & Owner Signature Canvas */}
      {currentStep === 4 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <PenTool className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 4: บัญชีรับชำระ & ลายเซ็นเจ้าของหอพัก</h3>
              <p className="text-xs text-slate-400 font-medium">ระบุข้อมูลบัญชีธนาคารสำหรับรับชำระเงิน และวาดลายเซ็นอิเล็กทรอนิกส์กำกับเอกสาร</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Bank Details */}
            <div className="space-y-4 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
              <h4 className="font-black text-slate-800 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-emerald-600" /> ข้อมูลบัญชีธนาคาร
              </h4>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ธนาคารที่รับโอน</label>
                <select
                  data-testid="select-bank-name"
                  value={formData.paymentAccount.bankName}
                  onChange={(e) => setFormData({ ...formData, paymentAccount: { ...formData.paymentAccount, bankName: e.target.value } })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                >
                  {BANK_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">เลขที่บัญชีธนาคาร</label>
                <input
                  type="text"
                  data-testid="input-account-number"
                  value={formData.paymentAccount.accountNumber}
                  onChange={(e) => setFormData({ ...formData, paymentAccount: { ...formData.paymentAccount, accountNumber: e.target.value } })}
                  placeholder="123-4-56789-0"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ชื่อบัญชีธนาคาร</label>
                <input
                  type="text"
                  data-testid="input-account-name"
                  value={formData.paymentAccount.accountName}
                  onChange={(e) => setFormData({ ...formData, paymentAccount: { ...formData.paymentAccount, accountName: e.target.value } })}
                  placeholder="นาย สมศักดิ์ ใจดี"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">เบอร์พร้อมเพย์ (PromptPay)</label>
                <input
                  type="text"
                  data-testid="input-promptpay"
                  value={formData.paymentAccount.promptPayId}
                  onChange={(e) => setFormData({ ...formData, paymentAccount: { ...formData.paymentAccount, promptPayId: e.target.value } })}
                  placeholder="0812345678"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                />
              </div>
            </div>

            {/* Signature Drawing Canvas */}
            <div className="space-y-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-slate-800 flex items-center gap-1.5">
                  <PenTool className="w-4 h-4 text-blue-600" /> วาดลายเซ็นอิเล็กทรอนิกส์ <span className="text-rose-500">*</span>
                </h4>
                {signatureSaved && (
                  <span data-testid="signature-status-saved" className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> บันทึกแล้ว
                  </span>
                )}
              </div>

              <div className="bg-white border-2 border-dashed border-slate-300 rounded-2xl p-2 relative">
                <canvas
                  ref={canvasRef}
                  width={380}
                  height={160}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-40 bg-white rounded-xl touch-none cursor-crosshair"
                />
                {!signatureSaved && (
                  <div className="absolute bottom-3 right-3 text-[10px] text-slate-400 font-bold pointer-events-none">
                    ใช้นิ้วหรือเมาส์วาดในกรอบนี้
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  data-testid="button-clear-signature"
                  onClick={clearCanvas}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-xs cursor-pointer"
                >
                  ล้างลายเซ็น
                </button>
                <button
                  type="button"
                  data-testid="button-save-signature"
                  onClick={handleSaveSignature}
                  disabled={signatureUploading}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {signatureUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>บันทึกลายเซ็น</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5: LINE Official Account Setup */}
      {currentStep === 5 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
              <div>
                <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 5: ตั้งค่า LINE Official Account</h3>
                <p className="text-xs text-slate-400 font-medium">เชื่อมต่อ Channel ID & Channel Secret สำหรับส่งการแจ้งเตือนผู้เช่า</p>
              </div>
            </div>

            {/* 4-State Readiness Indicator Badge */}
            <div data-testid="line-readiness-badge" className={`px-3 py-1.5 rounded-full text-xs font-black flex items-center gap-1.5 ${
              lineStatus.isReady ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
            }`}>
              {lineStatus.isReady ? 'พร้อมใช้งาน ✅' : 'รอดำเนินการ ⏳'}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Credentials Input */}
            <div className="space-y-4 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
              <h4 className="font-black text-slate-800">1. กรอก Channel Credentials</h4>

              <div>
                <label className="block font-bold text-slate-700 mb-1">LINE Channel ID <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  data-testid="input-line-channel-id"
                  value={lineChannelId}
                  onChange={(e) => setLineChannelId(e.target.value)}
                  placeholder="เช่น 2001234567"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">LINE Channel Secret <span className="text-rose-500">*</span></label>
                <input
                  type="password"
                  data-testid="input-line-channel-secret"
                  value={lineChannelSecret}
                  onChange={(e) => setLineChannelSecret(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none"
                />
              </div>

              <button
                type="button"
                data-testid="button-save-line-credentials"
                onClick={handleSaveLineCredentials}
                disabled={lineVerifying}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {lineVerifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>บันทึก & ยืนยัน LINE Credentials</span>
              </button>
            </div>

            {/* Webhook & Status */}
            <div className="space-y-4 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80">
              <h4 className="font-black text-slate-800">2. ตั้งค่า Webhook URL & ทดสอบ</h4>

              {webhookUrl && (
                <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 block">Webhook URL สำหรับนำไปใส่ใน LINE Developers Console:</span>
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="w-full text-[11px] font-mono font-bold text-slate-700 bg-slate-50 p-1.5 rounded border border-slate-200 outline-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="button-set-line-webhook"
                  onClick={handleSetLineWebhook}
                  disabled={lineVerifying || !lineStatus.credentialsVerified}
                  className="py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50"
                >
                  ตั้งค่า Webhook URL
                </button>
                <button
                  type="button"
                  data-testid="button-test-line-webhook"
                  onClick={handleTestLineWebhook}
                  disabled={lineVerifying || !lineStatus.webhookEndpointSet}
                  className="py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs cursor-pointer disabled:opacity-50"
                >
                  ทดสอบ Webhook
                </button>
              </div>

              {/* 4 Checks Status List */}
              <div className="space-y-2 pt-2 border-t border-slate-200 text-[11px] font-bold">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">1. Credentials Verified:</span>
                  <span className={lineStatus.credentialsVerified ? 'text-emerald-600' : 'text-slate-400'}>
                    {lineStatus.credentialsVerified ? 'ผ่าน ✅' : 'ยังไม่ผ่าน'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">2. Webhook Endpoint Set:</span>
                  <span className={lineStatus.webhookEndpointSet ? 'text-emerald-600' : 'text-slate-400'}>
                    {lineStatus.webhookEndpointSet ? 'ผ่าน ✅' : 'ยังไม่ผ่าน'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">3. Webhook Test Succeeded:</span>
                  <span className={lineStatus.webhookTestSucceeded ? 'text-emerald-600' : 'text-slate-400'}>
                    {lineStatus.webhookTestSucceeded ? 'ผ่าน ✅' : 'ยังไม่ผ่าน'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">4. Webhook Active:</span>
                  <span className={lineStatus.webhookActive ? 'text-emerald-600' : 'text-slate-400'}>
                    {lineStatus.webhookActive ? 'ผ่าน ✅' : 'ยังไม่ผ่าน'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: Package & Finalize */}
      {currentStep === 6 && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 6: เลือกแพ็กเกจ & ยืนยันเปิดใช้งาน</h3>
              <p className="text-xs text-slate-400 font-medium">เลือกแพ็กเกจการใช้งาน กรอกรหัสโปรโมชัน และยืนยันการลงทะเบียน</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* FREE Plan */}
            <div
              data-testid="plan-card-free"
              onClick={() => setSelectedPlan('FREE')}
              className={`p-5 rounded-2xl border-2 transition-all cursor-pointer space-y-3 ${
                selectedPlan === 'FREE' ? 'border-blue-600 bg-blue-50/50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">ทดลองใช้งาน (FREE)</span>
                {selectedPlan === 'FREE' && <CheckCircle className="w-5 h-5 text-blue-600" />}
              </div>
              <h4 className="text-xl font-black text-slate-900">FREE Plan</h4>
              <p className="text-xs text-slate-500 font-medium">ทดลองใช้งานฟรี 1 เดือนแรกเต็ม สำหรับหอพักขนาดเล็ก</p>
              <ul className="text-xs text-slate-700 font-bold space-y-1.5 pt-2 border-t border-slate-200">
                <li>• โควต้าห้องพักสูงสุด 10 ห้อง</li>
                <li>• โควต้าส่งข้อความ LINE OA 30 ข้อความ / เดือน</li>
                <li>• ทดลองใช้งานฟรี 1 เดือน</li>
              </ul>
            </div>

            {/* PRO Plan */}
            <div
              data-testid="plan-card-pro"
              onClick={() => {
                if (proPkg) {
                  setSelectedPlan('PAID');
                  setSelectedPackageId(proPkg.id);
                }
              }}
              className={`p-5 rounded-2xl border-2 transition-all space-y-3 ${
                !proPkg
                  ? 'opacity-60 cursor-not-allowed border-slate-200 bg-slate-50'
                  : selectedPlan === 'PAID'
                  ? 'border-indigo-600 bg-indigo-50/50 shadow-md cursor-pointer'
                  : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full">มืออาชีพ (HorPlus PRO)</span>
                {selectedPlan === 'PAID' && <CheckCircle className="w-5 h-5 text-indigo-600" />}
              </div>
              <div className="flex items-baseline gap-1">
                <h4 className="text-xl font-black text-slate-900">
                  {catalogLoading ? 'กำลังโหลดราคา...' : catalogError ? 'ไม่สามารถโหลดราคาได้' : (proDisplayPrice || 'ไม่สามารถโหลดราคาได้')}
                </h4>
                {proDisplayPrice && <span className="text-xs text-slate-500 font-bold">/ เดือน</span>}
              </div>
              <h4 className="text-sm font-bold text-slate-800">HorPlus PRO</h4>
              <p className="text-xs text-slate-500 font-medium">สำหรับหอพักขนาดกลาง-ใหญ่ที่ต้องการระบบบริหารแบบครบวงจร</p>
              <ul className="text-xs text-slate-700 font-bold space-y-1.5 pt-2 border-t border-slate-200">
                <li>• โควต้าห้องพักสูงสุด 150 ห้อง</li>
                <li>• โควต้าส่งข้อความ LINE OA 300 ข้อความ / เดือน</li>
                <li>• ปลดล็อกทุกฟีเจอร์พรีเมียม</li>
              </ul>
            </div>
          </div>

          {/* Promo Code Input */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" /> รหัสโปรโมชัน (Promo Code)
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                data-testid="input-promo-code"
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value)}
                placeholder="ใส่รหัส HORPLUS เพื่อรับทดลองใช้งานเพิ่ม 2 เดือน"
                className="flex-1 px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none uppercase"
              />
              <button
                type="button"
                data-testid="button-apply-promo"
                onClick={handleValidatePromo}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black cursor-pointer shadow-sm"
              >
                ใช้งานรหัส
              </button>
            </div>
            {promoResult && (
              <div data-testid="promo-result-message" className={`text-xs font-bold ${promoResult.valid ? 'text-emerald-600' : 'text-rose-600'}`}>
                <p>{promoResult.message}</p>
                {promoResult.valid && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                    (ทดลองใช้งานฟรี {promoResult.trialMonths} เดือน + โบนัสโปรโมชัน {promoResult.promoBonusMonths} เดือน = รวมใช้งานฟรี {promoResult.totalTrialMonths} เดือนเต็ม)
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="flex items-center justify-between bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
        <button
          type="button"
          data-testid="button-prev-step"
          onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
          disabled={currentStep === 1}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
        >
          <ArrowLeft className="w-4 h-4" /> ย้อนกลับ
        </button>

        {currentStep < 6 ? (
          <button
            type="button"
            data-testid="button-next-step"
            onClick={handleNextStep}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <span>ถัดไป</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            data-testid="button-finalize-onboarding"
            onClick={() => setShowTermsModal(true)}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-lg cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>ยืนยันสร้างหอพัก</span>
          </button>
        )}
      </div>

      {/* Terms & Confirmation Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100">
            <h3 className="text-base font-black text-slate-800">ยืนยันเงื่อนไข & สร้างหอพัก</h3>

            <label className="flex items-start gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                data-testid="checkbox-agreed-terms"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 rounded text-blue-600"
              />
              <span>ข้าพเจ้ายอมรับเงื่อนไขการใช้บริการและนโยบายความเป็นส่วนตัวของระบบ HorPlus</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                data-testid="button-confirm-finalize"
                disabled={!agreedTerms || isSubmitting}
                onClick={handleFinalizeRegistration}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md cursor-pointer disabled:opacity-40"
              >
                {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันสร้างหอพักทันที'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
