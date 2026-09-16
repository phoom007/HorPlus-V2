/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Building,
  DollarSign,
  Wifi,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Calendar,
  Droplet,
  Zap,
  Users,
  RotateCw,
  SlidersHorizontal,
  PenTool,
  CheckCircle2,
  QrCode,
  Landmark,
  Wallet,
  PawPrint,
  FileText,
  Check,
  Plus,
  Percent,
  Receipt,
  CreditCard,
  ScrollText,
  Upload,
  Trash2,
  X
} from 'lucide-react';
import {
  getDormitory,
  saveDormitory,
  getDormitoryRatesForCycle,
  seedDatabase
} from '../../data/mockData';
import { ConfirmDialog, SignaturePad } from '../../components/GlobalComponents';
import { TieredRateEditor, CanonicalTierRecord, WATER_TIER_PRESET, ELECTRICITY_TIER_PRESET } from '../../components/settings/TieredRateEditor';
import { DormitoryLogoUploader } from '../../components/settings/DormitoryLogoUploader';
import { VersionConflictModal } from '../../components/VersionConflictModal';
import {
  getDormitoryProfile,
  updateDormitoryProfile,
  getDormitorySignatureUrl,
  uploadDormitorySignature,
  deleteDormitorySignature
} from '../../services/dormitory.service';
import { getBillingSettings, updateBillingSettings } from '../../services/billing-settings.service';
import { getPaymentSettings, updatePaymentSettings, PaymentSettingsUpdatePayload } from '../../services/payment-settings.service';
import { ApiPropertyAdapter } from '../../data/adapters/api';
import { queryClient, queryKeys } from '../../lib/queryClient';
import { onboardingClient } from '../../data/onboardingClient';
import { getCsrfTokenFromCookie } from '../../data/httpClient';
import { BillingCycleCalendarPicker } from '../../components/BillingCycleCalendarPicker';
import {
  CANONICAL_PRESET_DORM_RULES,
  formatNumberedRules,
  toggleRuleInNumberedList,
  isRuleActive,
} from '../../constants/presetRules';
import { BankQrCodeUploader } from '../../components/settings/BankQrCodeUploader';
import { normalizeBankCode, SUPPORTED_BANKS } from '../../utils/bank-helper';

export function toCanonicalMode(rawMode: string | undefined | null, utilityType?: string): string {
  if (!rawMode) return 'per_unit';
  const m = String(rawMode).trim().toLowerCase();
  if (m === 'tiered') return 'tiered';
  if (m === 'unit' || m === 'per_unit') return 'per_unit';
  if (m === 'person' || m === 'per_person') return 'per_person';
  if (m === 'fixed' || m === 'flat' || m === 'flat_rate' || m === 'room' || m === 'per_room') {
    if (utilityType === 'late') return 'fixed';
    if (utilityType === 'parking') return 'per_room';
    return 'fixed';
  }
  if (m === 'vehicle' || m === 'per_vehicle') return 'per_vehicle';
  if (m === 'daily' || m === 'per_day') return 'daily';
  if (m === 'free' || m === 'none') {
    if (utilityType === 'late') return 'none';
    return 'free';
  }
  return m;
}

export const toNormalizedDecimalString = (val: any): string => {
  if (val === undefined || val === null || val === '') return '0.00';
  return String(val).trim();
};

export interface OwnerSettingsProps {
  dormitory?: Dormitory;
  dormitoryId?: string;
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
  onRefreshData?: () => void;
  selectedCycle?: string;
  onCycleChange?: (cycle: string) => void;
  availableCycles?: any[];
  billingCycles?: any[];
}

// Thai phone number formatter: 0XX-XXX-XXXX (strictly starts with 0)
const formatPhone = (val: string) => {
  let digits = val.replace(/\D/g, '');

  // Enforce starting with '0' if any digit is typed
  if (digits.length > 0 && !digits.startsWith('0')) {
    digits = '0' + digits;
  }
  digits = digits.slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

// PromptPay formatter: Phone (10 digits) or Citizen ID/Tax ID (13 digits: X-XXXX-XXXXX-XX-X)
const formatPromptPay = (val: string) => {
  if (!val) return '';
  if (val.includes('X')) return val;
  const digits = val.replace(/\D/g, '');
  if (digits.length <= 10) {
    let phoneDigits = digits;
    if (phoneDigits.length > 0 && !phoneDigits.startsWith('0')) {
      phoneDigits = '0' + phoneDigits;
    }
    phoneDigits = phoneDigits.slice(0, 10);
    if (phoneDigits.length <= 3) return phoneDigits;
    if (phoneDigits.length <= 6) return `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3)}`;
    return `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
  } else {
    const idDigits = digits.slice(0, 13);
    if (idDigits.length <= 1) return idDigits;
    if (idDigits.length <= 5) return `${idDigits.slice(0, 1)}-${idDigits.slice(1)}`;
    if (idDigits.length <= 10) return `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-${idDigits.slice(5)}`;
    if (idDigits.length <= 12) return `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-${idDigits.slice(5, 10)}-${idDigits.slice(10)}`;
    return `${idDigits.slice(0, 1)}-${idDigits.slice(1, 5)}-${idDigits.slice(5, 10)}-${idDigits.slice(10, 12)}-${idDigits.slice(12)}`;
  }
};

// Tax ID/Citizen ID formatter (13 digits: X-XXXX-XXXXX-XX-X)
const formatTaxId = (val: string) => {
  if (!val) return '';
  if (val.includes('X')) return val;
  const digits = val.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
  if (digits.length <= 10) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10)}`;
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
};

// Bank account formatter (10 digits: XXX-X-XXXXX-X)
const formatBankAccount = (val: string) => {
  if (!val) return '';
  if (val.includes('X')) return val;
  const digits = val.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 9)}-${digits.slice(9)}`;
};

// Image compression helper for QR codes and logos
const compressImage = (dataUrl: string, maxWidth = 800, maxHeight = 800, quality = 0.75): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

export const OwnerSettings: React.FC<OwnerSettingsProps> = ({
  dormitory: dormProp,
  dormitoryId: propDormitoryId,
  onAddLog,
  onRefreshData,
  selectedCycle: propSelectedCycle,
  onCycleChange,
  availableCycles,
  billingCycles,
}) => {
  const [dorm, setDorm] = useState<Dormitory>(dormProp || getDormitory(propDormitoryId));
  const activeDormId =
    propDormitoryId ||
    dormProp?.id ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') : null) ||
    dorm.id;

  const [ownerSignatureUrl, setOwnerSignatureUrl] = useState<string | null>(dormProp?.ownerSignature || dorm.ownerSignature || null);

  useEffect(() => {
    if (dormProp) {
      setDorm((prev) => ({
        ...prev,
        ...dormProp,
        bankName: dormProp.bankName ?? prev.bankName,
        bankAccountNumber: dormProp.bankAccountNumber ?? prev.bankAccountNumber,
        bankAccountName: dormProp.bankAccountName ?? prev.bankAccountName,
        bankQrCode: dormProp.bankQrCode ?? prev.bankQrCode,
        promptPayNumber: dormProp.promptPayNumber ?? prev.promptPayNumber,
        promptPayName: dormProp.promptPayName ?? prev.promptPayName,
      }));
    }
  }, [dormProp]);

  useEffect(() => {
    let isMounted = true;
    getDormitorySignatureUrl(activeDormId)
      .then((url) => {
        if (isMounted) {
          setOwnerSignatureUrl(url || dormProp?.ownerSignature || dorm.ownerSignature || null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setOwnerSignatureUrl(dormProp?.ownerSignature || dorm.ownerSignature || null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [activeDormId, dormProp?.ownerSignature]);

  const [selectedCycle, setSelectedCycle] = useState<string>(propSelectedCycle || '2026-07');
  const activeCycle = propSelectedCycle || selectedCycle;
  const [prevRenderCycle, setPrevRenderCycle] = useState<string>(activeCycle);
  const [prevRenderDormId, setPrevRenderDormId] = useState<string>(activeDormId);

  const [currentCycleId, setCurrentCycleId] = useState<string>('');
  const [isCycleLocked, setIsCycleLocked] = useState<boolean>(false);
  const [cycleLockReason, setCycleLockReason] = useState<string | null>(null);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState<boolean>(false);
  const [isSnapshotReady, setIsSnapshotReady] = useState<boolean>(false);
  const [snapshotVersion, setSnapshotVersion] = useState<number>(1);
  const [snapshotProvenance, setSnapshotProvenance] = useState<string>('TEMPLATE_DEFAULT');
  const [propertyVersion, setPropertyVersion] = useState<number>(1);
  const [billingVersion, setBillingVersion] = useState<number>(1);
  const [tierSaveError, setTierSaveError] = useState<string | null>(null);
  const [versionConflictState, setVersionConflictState] = useState<{
    isOpen: boolean;
    entityName: string;
    currentVersion: number;
    onRetry?: () => void;
  } | null>(null);

  // Durable Tier Rates (across cycle switches)
  const [durableWaterTierRates, setDurableWaterTierRates] = useState<CanonicalTierRecord[] | null>(null);
  const [durableElectricTierRates, setDurableElectricTierRates] = useState<CanonicalTierRecord[] | null>(null);

  // Active Utility Modes & Rates
  const [waterBillingMode, setWaterBillingMode] = useState<string>('per_unit');
  const [electricBillingMode, setElectricBillingMode] = useState<string>('per_unit');
  const [commonFeeMode, setCommonFeeMode] = useState<string>('room');
  const [internetFeeMode, setInternetFeeMode] = useState<string>('free');
  const [parkingFeeMode, setParkingFeeMode] = useState<string>('per_room');
  const [lateFeeType, setLateFeeType] = useState<string>('daily');

  const [waterTierRates, setWaterTierRates] = useState<CanonicalTierRecord[]>(WATER_TIER_PRESET);
  const [electricTierRates, setElectricTierRates] = useState<CanonicalTierRecord[]>(ELECTRICITY_TIER_PRESET);

  // Local scalar input strings
  const [localWaterUnitRate, setLocalWaterUnitRate] = useState<string>('18.00');
  const [localElectricUnitRate, setLocalElectricUnitRate] = useState<string>('7.00');
  const [localCommonFee, setLocalCommonFee] = useState<string>('0.00');
  const [localInternetFee, setLocalInternetFee] = useState<string>('0.00');
  const [localParkingFee, setLocalParkingFee] = useState<string>('0.00');
  const [localLateFee, setLocalLateFee] = useState<string>('0.00');
  const [isLateFeeSectionOpen, setIsLateFeeSectionOpen] = useState<boolean>(false);

  // Year / Cycle Modal
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);
  const [tempYear, setTempYear] = useState(2026);
  const minCycle = '2026-01';
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [resetSuccessNotice, setResetSuccessNotice] = useState(false);

  // Synchronous prop/context transition check during render
  if (activeCycle !== prevRenderCycle) {
    setPrevRenderCycle(activeCycle);
    setSelectedCycle(activeCycle);
    setIsSnapshotLoading(true);
    setIsSnapshotReady(false);
    setTierSaveError(null);
  }

  if (activeDormId !== prevRenderDormId) {
    setPrevRenderDormId(activeDormId);
    setDurableWaterTierRates(null);
    setDurableElectricTierRates(null);
    setWaterTierRates(WATER_TIER_PRESET);
    setElectricTierRates(ELECTRICITY_TIER_PRESET);
    setIsSnapshotLoading(true);
    setIsSnapshotReady(false);
    setTierSaveError(null);
  }

  // Refs for tracking context and preventing race conditions
  const currentDormIdRef = useRef<string>(activeDormId);
  const currentCycleRef = useRef<string>(activeCycle);
  const prevDormIdRef = useRef<string>(activeDormId);
  const defaultsLoadedDormIdRef = useRef<string | null>(null);
  const snapshotLoadedContextRef = useRef<string | null>(null);
  const loadedSnapshotAuthorityRef = useRef<{
    dormId: string;
    cycleCode: string;
    cycleId: string;
    version: number;
  } | null>(null);
  const isUserTypingRef = useRef<boolean>(false);
  const propertyAdapterRef = useRef<ApiPropertyAdapter>(new ApiPropertyAdapter());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update current refs synchronously on every render
  currentDormIdRef.current = activeDormId;
  currentCycleRef.current = activeCycle;

  // 'idle' | 'typing' | 'saving' | 'saved'
  const [saveStatus, setSaveStatus] = useState<'idle' | 'typing' | 'saving' | 'saved'>('idle');

  // Section Mode switcher: 'payment' vs 'policy_rules'
  const [activeSectionTab, setActiveSectionTab] = useState<'payment' | 'policy_rules'>('payment');

  // Pet policy & Rules states
  const DEFAULT_DORM_RULES = formatNumberedRules(
    CANONICAL_PRESET_DORM_RULES.slice(0, 5).map((r) => r.cleanText)
  );

  const [petAllowed, setPetAllowed] = useState<'none' | 'conditional'>(
    dorm.petPolicy?.allowed === 'none' ? 'none' : 'conditional'
  );
  const [petAllowedTypes, setPetAllowedTypes] = useState<string[]>(
    dorm.petPolicy?.allowedTypes && dorm.petPolicy.allowedTypes.length > 0
      ? dorm.petPolicy.allowedTypes
      : ['cat', 'small_pets']
  );
  const [rulesText, setRulesText] = useState<string>(
    dorm.rulesTemplate || dorm.dormRules || DEFAULT_DORM_RULES
  );
  const [rulesSavedNotice, setRulesSavedNotice] = useState(false);

  // Local inputs
  const [activePaymentTab, setActivePaymentTab] = useState<'promptpay' | 'bank'>('promptpay');
  const [localName, setLocalName] = useState(dorm.name);
  const [localLogoUrl, setLocalLogoUrl] = useState(dorm.logoUrl || '');
  const [localTaxId, setLocalTaxId] = useState(dorm.taxId || '');
  const [localPhone, setLocalPhone] = useState(dorm.phone || '');
  const [localPromptPay, setLocalPromptPay] = useState(dorm.promptPayNumber || '');
  const [localPromptPayName, setLocalPromptPayName] = useState(dorm.promptPayName || '');
  const [localAddress, setLocalAddress] = useState(dorm.address || '');
  const [localBankName, setLocalBankName] = useState(dorm.bankName || '');
  const [localBankAccountNumber, setLocalBankAccountNumber] = useState(dorm.bankAccountNumber || '');
  const [localBankAccountName, setLocalBankAccountName] = useState(dorm.bankAccountName || dorm.promptPayName || '');
  const [localBankQrCode, setLocalBankQrCode] = useState(dorm.bankQrCode || '');
  const [isPreviewQrModalOpen, setIsPreviewQrModalOpen] = useState(false);
  const bankQrInputRef = useRef<HTMLInputElement>(null);

  // Toast with debounce and smooth fade
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastFadeRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    if (toastFadeRef.current) clearTimeout(toastFadeRef.current);
    setIsToastFading(false);
    setToastMessage(msg);
    toastFadeRef.current = setTimeout(() => {
      setIsToastFading(true);
      toastTimeoutRef.current = setTimeout(() => {
        setToastMessage(null);
        setIsToastFading(false);
      }, 500);
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (toastFadeRef.current) clearTimeout(toastFadeRef.current);
    };
  }, []);

  const [localDueDay, setLocalDueDay] = useState<string | number>(dorm.dueDay ?? 5);
  const [vatEnabled, setVatEnabled] = useState<boolean>(dorm.vatSettings?.enabled ?? false);
  const [vatRate, setVatRate] = useState<number>(dorm.vatSettings?.rate ?? 7);
  const [vatAppliedCategories, setVatAppliedCategories] = useState<string[]>(
    dorm.vatSettings?.appliedCategories ?? ['rent', 'water', 'electricity', 'commonFee', 'internetFee', 'parking', 'fine', 'other']
  );

  const handleResetDemoData = () => {
    seedDatabase(true);
    if (onRefreshData) onRefreshData();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('storage'));
    if (onAddLog) onAddLog('รีเซ็ตระบบ', 'รีเซ็ตข้อมูลสาธิตทั้งหมดกลับเป็นชุดเริ่มต้นเรียบร้อยแล้ว', 'System', 'system-root');
    setResetSuccessNotice(true);
    setTimeout(() => setResetSuccessNotice(false), 5000);
  };

  const getMaxCycle = () => {
    const today = new Date();
    let y = today.getFullYear();
    let m = today.getMonth() + 1;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${y}-${mStr}`;
  };

  const maxCycle = getMaxCycle();

  // Cross-dorm isolation: reset states when activeDormId changes
  useEffect(() => {
    if (prevDormIdRef.current !== activeDormId) {
      prevDormIdRef.current = activeDormId;
      setDurableWaterTierRates(null);
      setDurableElectricTierRates(null);
      setWaterTierRates(WATER_TIER_PRESET);
      setElectricTierRates(ELECTRICITY_TIER_PRESET);
      defaultsLoadedDormIdRef.current = null;
      snapshotLoadedContextRef.current = null;
      loadedSnapshotAuthorityRef.current = null;
    }
  }, [activeDormId]);

  // Context switch reset: clear saving status and tier error
  useEffect(() => {
    setSaveStatus('idle');
    setTierSaveError(null);
  }, [selectedCycle, activeDormId]);

  // Synchronize with external selected cycle from parent header
  useEffect(() => {
    if (propSelectedCycle) {
      setSelectedCycle(propSelectedCycle);
      const [year] = propSelectedCycle.split('-');
      setTempYear(parseInt(year) || 2026);
    }
  }, [propSelectedCycle]);

  // Synchronize local states with main state on load or change
  useEffect(() => {
    setLocalName(dorm.name);
    setLocalLogoUrl(dorm.logoUrl || '');
    setLocalAddress(dorm.address || '');
    setLocalTaxId(formatTaxId(dorm.taxId || ''));
    setLocalPhone(formatPhone(dorm.phone || ''));
    if (dorm.promptPayNumber !== undefined) setLocalPromptPay(formatPromptPay(dorm.promptPayNumber || ''));
    if (dorm.promptPayName !== undefined) setLocalPromptPayName(dorm.promptPayName || '');
    if (dorm.bankName !== undefined) setLocalBankName(dorm.bankName || '');
    if (dorm.bankAccountNumber !== undefined) setLocalBankAccountNumber(formatBankAccount(dorm.bankAccountNumber || ''));
    if (dorm.bankAccountName !== undefined) setLocalBankAccountName(dorm.bankAccountName || dorm.promptPayName || '');
    if (dorm.bankQrCode !== undefined) setLocalBankQrCode(dorm.bankQrCode || '');
    setLocalDueDay(dorm.dueDay ?? 5);
    if (dorm.petPolicy) {
      setPetAllowed(dorm.petPolicy.allowed === 'none' ? 'none' : 'conditional');
      if (dorm.petPolicy.allowedTypes && dorm.petPolicy.allowedTypes.length > 0) {
        setPetAllowedTypes(dorm.petPolicy.allowedTypes);
      }
    }
    if (dorm.rulesTemplate || dorm.dormRules) {
      setRulesText(dorm.rulesTemplate || dorm.dormRules || DEFAULT_DORM_RULES);
    }
    if (dorm.vatSettings) {
      setVatEnabled(dorm.vatSettings.enabled ?? false);
      setVatRate(dorm.vatSettings.rate ?? 7);
      if (dorm.vatSettings.appliedCategories) {
        setVatAppliedCategories(dorm.vatSettings.appliedCategories);
      }
    }
  }, [dorm.id, dorm.name, dorm.logoUrl, dorm.address, dorm.taxId, dorm.phone, dorm.promptPayNumber, dorm.promptPayName, dorm.bankName, dorm.bankAccountNumber, dorm.bankAccountName, dorm.bankQrCode, dorm.petPolicy, dorm.rulesTemplate, dorm.dormRules, dorm.dueDay, dorm.vatSettings]);

  const handleBankQrCodeUpload = (file: File) => {
    if (!file || !file.type.startsWith('image/')) {
      alert('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const rawDataUrl = e.target?.result as string;
      const compressed = await compressImage(rawDataUrl, 800, 800, 0.75);
      setLocalBankQrCode(compressed);
      const updated: Dormitory = {
        ...dorm,
        bankQrCode: compressed,
        updatedAt: new Date().toISOString()
      };
      setDorm(updated);
      triggerSaveNow(updated);
      showToast('อัปโหลด QRCode ธนาคารสำเร็จ');
      if (onAddLog) {
        onAddLog('อัปเดต QRCode ธนาคาร', 'อัปโหลด QRCode บัญชีธนาคารสำหรับรับเงิน', 'Dormitory', dorm.id);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBankQrCode = () => {
    setLocalBankQrCode('');
    const updated: Dormitory = {
      ...dorm,
      bankQrCode: '',
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    triggerSaveNow(updated);
    showToast('ลบ QRCode ธนาคารเรียบร้อยแล้ว');
    if (onAddLog) {
      onAddLog('ลบ QRCode ธนาคาร', 'ลบ QRCode บัญชีธนาคารสำหรับรับเงิน', 'Dormitory', dorm.id);
    }
  };

  const handleToggleVatEnabled = (nextEnabled: boolean) => {
    if (isCycleLocked) return;
    setVatEnabled(nextEnabled);
    const vatPayload = {
      enabled: nextEnabled,
      rate: vatRate,
      appliedCategories: vatAppliedCategories
    };
    const updated = {
      ...dorm,
      vatSettings: vatPayload,
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    triggerSaveNow(updated);

    updateBillingSettings(activeDormId, { vatSettings: vatPayload }).catch((err) => {
      console.error('Failed to update billing VAT settings:', err);
    });
  };

  const handleToggleVatCategory = (catKey: string) => {
    if (isCycleLocked) return;
    let nextCats: string[];
    if (vatAppliedCategories.includes(catKey)) {
      nextCats = vatAppliedCategories.filter((c) => c !== catKey);
    } else {
      nextCats = [...vatAppliedCategories, catKey];
    }
    setVatAppliedCategories(nextCats);
    const vatPayload = {
      enabled: vatEnabled,
      rate: vatRate,
      appliedCategories: nextCats
    };
    const updated = {
      ...dorm,
      vatSettings: vatPayload,
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    triggerSaveNow(updated);

    updateBillingSettings(activeDormId, { vatSettings: vatPayload }).catch((err) => {
      console.error('Failed to update billing VAT settings:', err);
    });
  };

  const handleToggleAllVatCategories = (selectAll: boolean) => {
    if (isCycleLocked) return;
    const allKeys = ['rent', 'water', 'electricity', 'commonFee', 'internetFee', 'parking', 'fine', 'other'];
    const nextCats = selectAll ? allKeys : [];
    setVatAppliedCategories(nextCats);
    const vatPayload = {
      enabled: vatEnabled,
      rate: vatRate,
      appliedCategories: nextCats
    };
    const updated = {
      ...dorm,
      vatSettings: vatPayload,
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    triggerSaveNow(updated);

    updateBillingSettings(activeDormId, { vatSettings: vatPayload }).catch((err) => {
      console.error('Failed to update billing VAT settings:', err);
    });
  };

  const handleDueDayChange = (raw: string) => {
    // Allow empty string while user is deleting to retype
    if (raw === '') {
      setLocalDueDay('');
      setSaveStatus('typing');
      return;
    }
    // Filter non-digits
    const cleanDigits = raw.replace(/\D/g, '');
    if (!cleanDigits) return;
    const num = parseInt(cleanDigits, 10);
    // If greater than 28, clamp strictly to 28
    if (num > 28) {
      setLocalDueDay(28);
    } else {
      setLocalDueDay(num);
    }
    setSaveStatus('typing');
  };

  const handleDueDayBlur = (raw: string | number) => {
    let num = typeof raw === 'string' ? parseInt(raw.replace(/\D/g, ''), 10) : raw;
    if (isNaN(num) || num < 1) {
      num = 1;
    } else if (num > 28) {
      num = 28;
    }
    setLocalDueDay(num);

    propertyAdapterRef.current.updateDormitoryDefaults({
      billing: {
        changes: { dueDay: num },
        expectedVersion: billingVersion,
      },
    }).then(res => {
      if (res?.data?.billing?.version) setBillingVersion(res.data.billing.version);
    }).catch(() => { });

    updateBillingSettings(activeDormId, { dueDay: num }).catch(() => { });
    handleGlobalFieldBlur('dueDay', num);
  };

  const handleTogglePetType = (typeKey: string) => {
    const canonicalKey = typeKey === 'small_pets' ? 'small_pet' : (typeKey === 'exotic' ? 'other' : typeKey);
    const hasType = petAllowedTypes.some(t =>
      t === canonicalKey ||
      (canonicalKey === 'small_pet' && t === 'small_pets') ||
      (canonicalKey === 'other' && t === 'exotic')
    );
    if (hasType) {
      setPetAllowedTypes(petAllowedTypes.filter((t) =>
        t !== canonicalKey &&
        !(canonicalKey === 'small_pet' && t === 'small_pets') &&
        !(canonicalKey === 'other' && t === 'exotic')
      ));
    } else {
      setPetAllowedTypes([...petAllowedTypes, canonicalKey]);
    }
  };

  const rulesScrollRef = useRef<HTMLDivElement>(null);

  const scrollRules = (direction: 'left' | 'right') => {
    if (rulesScrollRef.current) {
      rulesScrollRef.current.scrollBy({
        left: direction === 'left' ? -200 : 200,
        behavior: 'smooth'
      });
    }
  };

  const PRESET_RULES = CANONICAL_PRESET_DORM_RULES.map((r) => ({
    label: r.label,
    fullText: r.cleanText,
  }));

  const handleAddQuickRule = (ruleText: string) => {
    const updated = toggleRuleInNumberedList(rulesText, ruleText);
    setRulesText(updated);
  };

  const handleSavePetAndRules = () => {
    const canonicalAllowedTypes = (petAllowed === 'conditional' ? petAllowedTypes : []).map((t) => {
      if (t === 'small_pets') return 'small_pet';
      if (t === 'exotic') return 'other';
      return t;
    });
    const nextPolicy = {
      allowed: petAllowed,
      allowedTypes: canonicalAllowedTypes,
    };
    const updated: Dormitory = {
      ...dorm,
      petPolicy: nextPolicy,
      rulesTemplate: rulesText,
      dormRules: rulesText,
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    triggerSaveNow(updated);
    if (onRefreshData) onRefreshData();
    if (onAddLog) {
      onAddLog('บันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง', 'อัปเดตนโยบายสัตว์เลี้ยงและกฎระเบียบหอพัก', 'settings', dorm.id);
    }
    setRulesSavedNotice(true);
    setTimeout(() => {
      setRulesSavedNotice(false);
    }, 2500);

    propertyAdapterRef.current.updateDormitoryDefaults({
      property: {
        expectedVersion: propertyVersion,
        changes: {
          petPolicy: nextPolicy,
          defaultTerms: rulesText
        }
      }
    }).then((res) => {
      if (res && res.success && res.data?.property?.version) {
        setPropertyVersion(res.data.property.version);
      }
    }).catch((err) => {
      console.error('Failed to update property defaults for pet policy and rules:', err);
    });
  };

  const handleLogoChange = (newLogoUrl: string | null) => {
    setLocalLogoUrl(newLogoUrl);
    setDorm(prev => ({
      ...prev,
      logoUrl: newLogoUrl || undefined,
    }));
    setSaveStatus('saved');
    showToast('บันทึกโลโก้หอพักเรียบร้อยแล้ว');
    if (onAddLog) {
      onAddLog('อัปเดตโลโก้หอพัก', newLogoUrl ? 'บันทึกโลโก้ใหม่' : 'ลบโลโก้หอพัก', 'settings', activeDormId);
    }
  };

  // Immediate save with debounce/status reset
  const triggerSaveNow = (updatedDorm: Dormitory) => {
    setSaveStatus('saving');
    saveDormitory(updatedDorm);
    if (onRefreshData) onRefreshData();

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus('saved');
      showToast('บันทึกข้อมูลเรียบร้อยแล้ว');
      if (onAddLog) {
        onAddLog('แก้ไขตั้งค่าระบบส่วนกลาง', `บันทึกการตั้งค่าอัตราบริการของงวด ${getShortCycleLabel(selectedCycle)} เรียบร้อยแล้ว`, 'Dormitory', updatedDorm.id);
      }
    }, 600);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Authoritative data loading: Dormitory defaults, billing settings, payment settings, profile
  const fetchDormitoryDefaults = async () => {
    const targetDormId = activeDormId;
    try {
      const res = await propertyAdapterRef.current.getDormitoryDefaults({ dormitoryId: targetDormId });
      if (res && res.success && res.data) {
        if (res.data.property?.version) setPropertyVersion(res.data.property.version);
        if (res.data.billing?.version) setBillingVersion(res.data.billing.version);
        if (res.data.property) {
          const p = res.data.property;
          if (p.petPolicy) {
            setPetAllowed(p.petPolicy.allowed === 'none' ? 'none' : 'conditional');
            if (Array.isArray(p.petPolicy.allowedTypes)) {
              setPetAllowedTypes(p.petPolicy.allowedTypes);
            }
          }
          if (p.defaultTerms || p.terms) {
            setRulesText(p.defaultTerms || p.terms);
          }
        }
        if (res.data.billing) {
          const b = res.data.billing;
          if (b.waterTierRates && Array.isArray(b.waterTierRates)) {
            setWaterTierRates(b.waterTierRates);
            setDurableWaterTierRates(b.waterTierRates);
          }
          if (b.electricityTierRates && Array.isArray(b.electricityTierRates)) {
            setElectricTierRates(b.electricityTierRates);
            setDurableElectricTierRates(b.electricityTierRates);
          }
          if (b.dueDay != null) setLocalDueDay(b.dueDay);
          if (b.waterBillingType) setWaterBillingMode(toCanonicalMode(b.waterBillingType, 'water'));
          if (b.electricityBillingType) setElectricBillingMode(toCanonicalMode(b.electricityBillingType, 'electricity'));
          if (b.vatSettings) {
            setVatEnabled(Boolean(b.vatSettings.enabled));
            setVatRate(b.vatSettings.rate ?? 7);
            if (Array.isArray(b.vatSettings.appliedCategories)) {
              setVatAppliedCategories(b.vatSettings.appliedCategories);
            }
          }
        }
      }
    } catch {
      // Handled gracefully
    }

    try {
      const billingRes = await getBillingSettings(targetDormId);
      if (billingRes && billingRes.data) {
        const bs = billingRes.data;
        if (bs.dueDay != null) setLocalDueDay(bs.dueDay);
        if (bs.waterBillingMode) setWaterBillingMode(toCanonicalMode(bs.waterBillingMode, 'water'));
        if (bs.electricBillingMode) setElectricBillingMode(toCanonicalMode(bs.electricBillingMode, 'electricity'));
        if (bs.waterTierRates && Array.isArray(bs.waterTierRates)) {
          setWaterTierRates(bs.waterTierRates);
          setDurableWaterTierRates(bs.waterTierRates);
        }
        if (bs.electricityTierRates && Array.isArray(bs.electricityTierRates)) {
          setElectricTierRates(bs.electricityTierRates);
          setDurableElectricTierRates(bs.electricityTierRates);
        }
        if (bs.vatSettings) {
          setVatEnabled(Boolean(bs.vatSettings.enabled));
          setVatRate(bs.vatSettings.rate ?? 7);
          if (bs.vatSettings.appliedCategories) {
            setVatAppliedCategories(bs.vatSettings.appliedCategories);
          }
        }
      }
    } catch {
      // Handled gracefully
    }

    try {
      const payRes = await getPaymentSettings(targetDormId);
      if (payRes) {
        const canonicalBank = payRes.bankCode ? normalizeBankCode(payRes.bankCode) : '';
        const ppVal = payRes.maskedPromptPayValue || payRes.promptPayValue || '';
        const ppName = payRes.promptPayAccountName || '';
        const baNum = payRes.maskedBankAccountNumber || payRes.bankAccountNumber || '';
        const baName = payRes.bankAccountName || '';
        const bQr = payRes.bankQrCode || '';

        if (ppVal) {
          setLocalPromptPay(ppVal);
        }
        if (ppName) {
          setLocalPromptPayName(ppName);
        }
        if (canonicalBank) {
          setLocalBankName(canonicalBank);
          if (!payRes.promptPayType) {
            setActivePaymentTab('bank');
          }
        }
        if (baNum) {
          setLocalBankAccountNumber(baNum);
        }
        if (baName) {
          setLocalBankAccountName(baName);
        }
        if (bQr) {
          setLocalBankQrCode(bQr);
        }

        setDorm((prev) => ({
          ...prev,
          bankName: canonicalBank || prev.bankName,
          bankAccountNumber: baNum || prev.bankAccountNumber,
          bankAccountName: baName || prev.bankAccountName,
          bankQrCode: bQr || prev.bankQrCode,
          promptPayNumber: ppVal || prev.promptPayNumber,
          promptPayName: ppName || prev.promptPayName,
        }));
      }
    } catch {
      // Handled gracefully
    }

    try {
      const profileRes = await getDormitoryProfile(targetDormId);
      if (profileRes) {
        if (profileRes.name) setLocalName(profileRes.name);
        if (profileRes.addressLine1) setLocalAddress(profileRes.addressLine1);
        if (profileRes.phone) setLocalPhone(profileRes.phone);
        if (profileRes.logoUrl) setLocalLogoUrl(profileRes.logoUrl);
        setDorm(prev => ({
          ...prev,
          name: profileRes.name || prev.name,
          address: profileRes.addressLine1 || prev.address,
          phone: profileRes.phone || prev.phone,
          taxId: profileRes.taxId || prev.taxId,
          logoUrl: profileRes.logoUrl || prev.logoUrl,
        }));
      }
    } catch {
      // Handled gracefully
    }
  };

  // Authoritative cycle snapshot loading
  const fetchCycleRateSnapshot = async () => {
    const targetDormId = activeDormId;
    const targetCycleCode = activeCycle;
    setIsSnapshotLoading(true);

    try {
      let cycleId = '';
      let isLocked = false;
      let lockReason: string | null = null;

      const cycleFromProp = (availableCycles || []).find((c: any) => (c.cycleCode || c.id) === targetCycleCode);
      if (cycleFromProp) {
        cycleId = cycleFromProp.id;
        if (cycleFromProp.isLocked) isLocked = true;
      }

      if (currentDormIdRef.current !== targetDormId || currentCycleRef.current !== targetCycleCode) {
        return;
      }

      setCurrentCycleId(cycleId);

      const csrfToken = getCsrfTokenFromCookie();
      const snapshotRes = await fetch(`/api/v1/billing-cycles/by-code/${targetCycleCode}/rate-snapshot`, {
        headers: {
          'X-Dormitory-Id': targetDormId,
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        credentials: 'include',
      });

      if (currentDormIdRef.current !== targetDormId || currentCycleRef.current !== targetCycleCode) {
        return;
      }

      if (snapshotRes.ok) {
        const json = await snapshotRes.json();

        if (currentDormIdRef.current !== targetDormId || currentCycleRef.current !== targetCycleCode) {
          return;
        }

        const snap = json.data?.rateSnapshot;
        if (snap) {
          setSnapshotVersion(snap.version ?? 1);
          setIsCycleLocked(Boolean(json.data.isLocked || isLocked));
          setCycleLockReason(json.data.lockReason || lockReason);
          setSnapshotProvenance(snap.source || 'TEMPLATE_DEFAULT');

          if (snap.waterBillingType) {
            setWaterBillingMode(toCanonicalMode(snap.waterBillingType, 'water'));
          }
          if (snap.waterRate != null) {
            setLocalWaterUnitRate(String(snap.waterRate));
          }
          if (snap.electricityBillingType) {
            setElectricBillingMode(toCanonicalMode(snap.electricityBillingType, 'electricity'));
          }
          if (snap.electricityRate != null) {
            setLocalElectricUnitRate(String(snap.electricityRate));
          }
          if (snap.parkingFeeMode) {
            setParkingFeeMode(toCanonicalMode(snap.parkingFeeMode, 'parking'));
          }
          if (snap.lateFeeType) {
            setLateFeeType(toCanonicalMode(snap.lateFeeType, 'late'));
          }
          if (snap.waterTierRates && Array.isArray(snap.waterTierRates)) {
            setWaterTierRates(snap.waterTierRates);
          }
          if (snap.electricityTierRates && Array.isArray(snap.electricityTierRates)) {
            setElectricTierRates(snap.electricityTierRates);
          }
          if (durableWaterTierRates) {
            setWaterTierRates(durableWaterTierRates);
          }
          if (durableElectricTierRates) {
            setElectricTierRates(durableElectricTierRates);
          }
        }
      }
    } catch {
      // Handled gracefully
    } finally {
      if (currentDormIdRef.current === targetDormId && currentCycleRef.current === targetCycleCode) {
        setIsSnapshotReady(true);
        setIsSnapshotLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchDormitoryDefaults();
  }, [activeDormId]);

  useEffect(() => {
    setIsSnapshotReady(false);
    fetchCycleRateSnapshot();
  }, [activeDormId, activeCycle]);

  // Rate snapshot mutation handler
  const handleSaveCycleRateSettings = async (overrides: any = {}) => {
    const targetCycleCode = activeCycle;
    const targetDormId = activeDormId;
    const targetCycleId = currentCycleId;

    const nextWaterMode = overrides.waterBillingMode ?? waterBillingMode;
    const nextWaterRate = overrides.waterRate ?? localWaterUnitRate;
    const nextElectricMode = overrides.electricBillingMode ?? electricBillingMode;
    const nextElectricRate = overrides.electricityRate ?? localElectricUnitRate;
    const nextParkingMode = overrides.parkingFeeMode ?? parkingFeeMode;
    const nextLateType = overrides.lateFeeType ?? lateFeeType;

    const payload: any = {
      expectedVersion: snapshotVersion,
      waterBillingType: nextWaterMode,
      waterRate: String(nextWaterRate),
      waterTierRates: nextWaterMode === 'tiered' ? (durableWaterTierRates ?? waterTierRates) : null,
      electricityBillingType: nextElectricMode,
      electricityRate: String(nextElectricRate),
      electricityTierRates: nextElectricMode === 'tiered' ? (durableElectricTierRates ?? electricTierRates) : null,
      parkingFeeMode: nextParkingMode,
      lateFeeType: nextLateType,
    };

    setSaveStatus('saving');

    const endpoint = targetCycleId
      ? `/api/v1/billing-cycles/${targetCycleId}/rate-snapshot`
      : `/api/v1/billing-cycles/by-code/${targetCycleCode}/rate-snapshot`;

    try {
      const csrfToken = getCsrfTokenFromCookie();
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Dormitory-Id': targetDormId,
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      // Context check after fetch resolves
      if (currentCycleRef.current !== targetCycleCode || currentDormIdRef.current !== targetDormId) {
        return;
      }

      if (response.status === 409) {
        if (currentCycleRef.current === targetCycleCode && currentDormIdRef.current === targetDormId) {
          setVersionConflictState({
            isOpen: true,
            entityName: 'การตั้งค่ารอบบิล',
            currentVersion: snapshotVersion + 1,
            onRetry: () => fetchCycleRateSnapshot(),
          });
        }
        setSaveStatus('idle');
        return;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        // Context check after error json resolves
        if (currentCycleRef.current !== targetCycleCode || currentDormIdRef.current !== targetDormId) {
          return;
        }
        setTierSaveError(errData.error?.message || 'บันทึกข้อมูลไม่สำเร็จ');
        setSaveStatus('idle');
        return;
      }

      const res = await response.json();

      // Context check after response json resolves
      if (currentCycleRef.current !== targetCycleCode || currentDormIdRef.current !== targetDormId) {
        return;
      }

      if (res.data?.rateSnapshot?.version) {
        setSnapshotVersion(res.data.rateSnapshot.version);
      }
      setSaveStatus('saved');
      showToast('บันทึกอัตราค่าบริการเรียบร้อยแล้ว');
      if (onAddLog) {
        onAddLog('แก้ไขตั้งค่าระบบส่วนกลาง', `บันทึกการตั้งค่าอัตราบริการของงวด ${getShortCycleLabel(targetCycleCode)} เรียบร้อยแล้ว`, 'Dormitory', targetDormId);
      }

      propertyAdapterRef.current.updateDormitoryDefaults({
        dormitoryId: targetDormId,
        billing: {
          expectedVersion: billingVersion,
          changes: {
            waterUnitRate: Number(nextWaterRate) || 0,
            waterBillingType: nextWaterMode,
            electricUnitRate: Number(nextElectricRate) || 0,
            electricityBillingType: nextElectricMode,
            parkingFeeMode: nextParkingMode,
            lateFeeType: nextLateType,
          },
        },
      }).then((defRes) => {
        if (defRes?.data?.billing?.version) setBillingVersion(defRes.data.billing.version);
      }).catch(() => { });

      updateBillingSettings(targetDormId, {
        waterUnitRate: Number(nextWaterRate) || 0,
        waterBillingMode: nextWaterMode,
        electricUnitRate: Number(nextElectricRate) || 0,
        electricBillingMode: nextElectricMode,
        parkingFeeMode: nextParkingMode,
        lateFeeType: nextLateType,
      }).catch(() => { });

    } catch (err: any) {
      if (currentCycleRef.current === targetCycleCode && currentDormIdRef.current === targetDormId) {
        setTierSaveError(err.message || 'บันทึกข้อมูลไม่สำเร็จ');
        setSaveStatus('idle');
      }
    }
  };

  const handleRateBlur = (field: string, value: any) => {
    if (!isSnapshotReady || isSnapshotLoading || isCycleLocked) return;
    const valStr = String(value).trim();
    let nextWater = localWaterUnitRate;
    let nextElectric = localElectricUnitRate;
    let nextCommon = localCommonFee;
    let nextInternet = localInternetFee;
    let nextParking = localParkingFee;
    let nextLate = localLateFee;

    if (field === 'waterRate' || field === 'waterUnitRate') {
      nextWater = valStr;
      setLocalWaterUnitRate(valStr);
    } else if (field === 'electricityRate' || field === 'electricUnitRate') {
      nextElectric = valStr;
      setLocalElectricUnitRate(valStr);
    } else if (field === 'commonFee') {
      nextCommon = valStr;
      setLocalCommonFee(valStr);
    } else if (field === 'internetFee') {
      nextInternet = valStr;
      setLocalInternetFee(valStr);
    } else if (field === 'parkingFee') {
      nextParking = valStr;
      setLocalParkingFee(valStr);
    } else if (field === 'lateFeeDaily') {
      nextLate = valStr;
      setLocalLateFee(valStr);
    }

    handleSaveCycleRateSettings({
      waterRate: nextWater,
      electricityRate: nextElectric,
      commonFee: Number(nextCommon) || 0,
      internetFee: Number(nextInternet) || 0,
      parkingFee: Number(nextParking) || 0,
      lateFeeDaily: Number(nextLate) || 0,
    });
  };

  const handleRateSelectChange = (field: string, value: any) => {
    if (isCycleLocked) return;
    if (field === 'waterBillingMode') {
      const val = toCanonicalMode(value, 'water');
      setWaterBillingMode(val);
      if (val === 'tiered' && durableWaterTierRates) {
        setWaterTierRates(durableWaterTierRates);
      }
      handleSaveCycleRateSettings({ waterBillingMode: val });
    } else if (field === 'electricBillingMode') {
      const val = toCanonicalMode(value, 'electricity');
      setElectricBillingMode(val);
      if (val === 'tiered' && durableElectricTierRates) {
        setElectricTierRates(durableElectricTierRates);
      }
      handleSaveCycleRateSettings({ electricBillingMode: val });
    } else if (field === 'parkingFeeMode') {
      const val = toCanonicalMode(value, 'parking');
      setParkingFeeMode(val);
      handleSaveCycleRateSettings({ parkingFeeMode: val });
    } else if (field === 'lateFeeType') {
      const val = toCanonicalMode(value, 'late');
      setLateFeeType(val);
      handleSaveCycleRateSettings({ lateFeeType: val });
    } else if (field === 'commonFeeMode') {
      setCommonFeeMode(value);
      handleSaveCycleRateSettings({ commonFeeMode: value });
    } else if (field === 'internetFeeMode') {
      setInternetFeeMode(value);
      handleSaveCycleRateSettings({ internetFeeMode: value });
    }
  };

  const handleSaveTierSettings = async (utilityType: 'water' | 'electricity', tiersToSave: CanonicalTierRecord[]) => {
    setTierSaveError(null);
    setSaveStatus('saving');
    try {
      const isWater = utilityType === 'water';
      if (isWater) {
        setDurableWaterTierRates(tiersToSave);
        setWaterTierRates(tiersToSave);
      } else {
        setDurableElectricTierRates(tiersToSave);
        setElectricTierRates(tiersToSave);
      }

      const defaultsRes = await propertyAdapterRef.current.updateDormitoryDefaults({
        dormitoryId: activeDormId,
        billing: {
          expectedVersion: billingVersion,
          changes: isWater ? { waterTierRates: tiersToSave } : { electricityTierRates: tiersToSave },
        },
      });
      if (defaultsRes?.data?.billing?.version) {
        setBillingVersion(defaultsRes.data.billing.version);
      }

      const targetCycleId = currentCycleId || selectedCycle;
      const rateSnapshotPayload: any = {
        expectedVersion: snapshotVersion,
        waterBillingType: waterBillingMode,
        waterRate: localWaterUnitRate,
        waterTierRates: isWater ? tiersToSave : (durableWaterTierRates ?? waterTierRates),
        electricityBillingType: electricBillingMode,
        electricityRate: localElectricUnitRate,
        electricityTierRates: !isWater ? tiersToSave : (durableElectricTierRates ?? electricTierRates),
        parkingFeeMode: parkingFeeMode,
        lateFeeType: lateFeeType,
      };

      const csrfToken = getCsrfTokenFromCookie();
      const res = await fetch(`/api/v1/billing-cycles/${targetCycleId}/rate-snapshot`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Dormitory-Id': activeDormId,
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify(rateSnapshotPayload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.data?.rateSnapshot?.version) {
          setSnapshotVersion(data.data.rateSnapshot.version);
        }
      }

      await updateBillingSettings(activeDormId, isWater ? { waterTierRates: tiersToSave } : { electricityTierRates: tiersToSave });

      setSaveStatus('saved');
      showToast(`บันทึกอัตราขั้นบันได${isWater ? 'น้ำประปา' : 'ไฟฟ้า'}เรียบร้อยแล้ว`);
      if (onAddLog) {
        onAddLog('บันทึกอัตราขั้นบันได', `บันทึกอัตราขั้นบันได${isWater ? 'น้ำประปา' : 'ไฟฟ้า'}`, 'settings', activeDormId);
      }
    } catch (err: any) {
      setSaveStatus('idle');
      setTierSaveError(err.message || 'เกิดข้อผิดพลาดในการบันทึกอัตราขั้นบันได');
    }
  };

  const handleGlobalFieldBlur = async (key: keyof Dormitory, value: any) => {
    const rawVal = typeof value === 'string' ? value.trim() : value;

    const updated = {
      ...dorm,
      [key]: rawVal,
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    setSaveStatus('saving');

    try {
      if (['name', 'address', 'phone', 'taxId'].includes(key as string)) {
        if (key === 'name') {
          await updateDormitoryProfile(activeDormId, { name: rawVal });
        } else if (key === 'address') {
          await updateDormitoryProfile(activeDormId, { addressLine1: rawVal });
        } else if (key === 'phone') {
          await updateDormitoryProfile(activeDormId, { phone: rawVal });
        } else if (key === 'taxId') {
          await updateDormitoryProfile(activeDormId, { taxId: rawVal });
        }
        setSaveStatus('saved');
        showToast('บันทึกข้อมูลเรียบร้อยแล้ว');
      } else if (['bankName', 'bankAccountNumber', 'bankAccountName', 'promptPayNumber', 'promptPayName', 'bankQrCode'].includes(key as string)) {
        const targetPromptPay = key === 'promptPayNumber' ? rawVal : localPromptPay;
        const targetPromptPayName = key === 'promptPayName' ? rawVal : localPromptPayName;
        const targetBankCode = key === 'bankName' ? rawVal : localBankName;
        const targetBankAccountNumber = key === 'bankAccountNumber' ? rawVal : localBankAccountNumber;
        const targetBankAccountName = key === 'bankAccountName' ? rawVal : localBankAccountName;
        const targetBankQr = key === 'bankQrCode' ? rawVal : localBankQrCode;

        const cleanDigits = (s: string | undefined | null) => (s ? s.replace(/\D/g, '') : '');
        const cleanPP = (!targetPromptPay || targetPromptPay.includes('X')) ? undefined : (cleanDigits(targetPromptPay) || null);
        const ppType = cleanPP === undefined ? undefined : (!cleanPP ? null : (cleanPP.length === 13 ? 'national_id' : 'mobile_phone'));
        const cleanBA = (!targetBankAccountNumber || targetBankAccountNumber.includes('X')) ? undefined : (cleanDigits(targetBankAccountNumber) || null);

        const paymentPayload: PaymentSettingsUpdatePayload = {};
        if (cleanPP !== undefined) {
          paymentPayload.promptPayValue = cleanPP;
          paymentPayload.promptPayType = ppType;
        }
        if (targetPromptPayName !== undefined) {
          paymentPayload.promptPayAccountName = targetPromptPayName || null;
        }
        if (targetBankCode !== undefined) {
          paymentPayload.bankCode = normalizeBankCode(targetBankCode) || null;
        }
        if (cleanBA !== undefined) {
          paymentPayload.bankAccountNumber = cleanBA;
        }
        if (targetBankAccountName !== undefined) {
          paymentPayload.bankAccountName = targetBankAccountName || null;
        }
        if (targetBankQr !== undefined) {
          paymentPayload.bankQrCode = targetBankQr || null;
        }

        if (Object.keys(paymentPayload).length > 0) {
          const updatedPay = await updatePaymentSettings(activeDormId, paymentPayload);
          if (updatedPay) {
            const canonicalBank = updatedPay.bankCode ? normalizeBankCode(updatedPay.bankCode) : '';
            const baNum = updatedPay.maskedBankAccountNumber || updatedPay.bankAccountNumber || '';
            const baName = updatedPay.bankAccountName || '';
            const ppVal = updatedPay.maskedPromptPayValue || updatedPay.promptPayValue || '';
            const ppName = updatedPay.promptPayAccountName || '';
            const bQr = updatedPay.bankQrCode || '';

            if (canonicalBank) setLocalBankName(canonicalBank);
            if (baNum) setLocalBankAccountNumber(baNum);
            if (baName) setLocalBankAccountName(baName);
            if (ppVal) setLocalPromptPay(ppVal);
            if (ppName) setLocalPromptPayName(ppName);
            setLocalBankQrCode(bQr);

            setDorm((prev) => ({
              ...prev,
              bankName: canonicalBank || prev.bankName,
              bankAccountNumber: baNum || prev.bankAccountNumber,
              bankAccountName: baName || prev.bankAccountName,
              bankQrCode: bQr,
              promptPayNumber: ppVal || prev.promptPayNumber,
              promptPayName: ppName || prev.promptPayName,
            }));
          }
          setSaveStatus('saved');
          showToast('บันทึกข้อมูลเรียบร้อยแล้ว');
        }
      } else if (key === 'dueDay') {
        setSaveStatus('saved');
        showToast('บันทึกวันครบกำหนดชำระเรียบร้อยแล้ว');
      } else {
        setSaveStatus('saved');
        showToast('บันทึกข้อมูลเรียบร้อยแล้ว');
      }
    } catch (e) {
      console.error('Failed to persist setting to backend:', e);
      setSaveStatus('idle');
    }
  };

  const getShortCycleLabel = (cycle: string) => {
    const [yearStr, monthStr] = cycle.split('-');
    const mIndex = parseInt(monthStr) - 1;
    const thaiShortMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    if (mIndex >= 0 && mIndex < 12) {
      return `${thaiShortMonths[mIndex]} ${parseInt(yearStr) + 543}`;
    }
    return cycle;
  };

  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Toast Notification (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
      {toastMessage && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${isToastFading
            ? 'opacity-0 translate-y-3 pointer-events-none'
            : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="max-w-7xl mx-auto animate-in fade-in duration-300 w-full min-w-0">
        {/* Unified elegant card: Responsive padding, rounded corners, and grid */}
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-100/80 sm:border-slate-100 shadow-xs sm:shadow-sm p-4 sm:p-6 lg:p-8 w-full min-w-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-y-8 lg:gap-y-0 gap-x-0 min-w-0">

            {/* Column 1: ข้อมูลหอพักและจุดรับสแกนจ่ายเงิน */}
            <div className="space-y-5 pb-8 border-b border-slate-100 lg:border-b-0 lg:border-r lg:border-slate-100 lg:pb-0 lg:pr-8 xl:pr-10 min-w-0">
              <h4 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider text-left">
                <Building className="w-4 h-4 text-indigo-600 shrink-0" />
                ข้อมูลเจ้าของหอพัก
              </h4>

              {/* อัปโหลด Logo หอพัก (ไม่บังคับ) พร้อมเครื่องมือ Crop / Zoom และจำลอง 3 อุปกรณ์ */}
              <DormitoryLogoUploader
                dormitoryId={activeDormId}
                logoUrl={localLogoUrl}
                dormName={localName}
                onLogoChange={handleLogoChange}
                onError={(msg) => showToast(msg)}
              />

              {/* ข้อมูลทั่วไปของหอพัก */}
              <div className="grid grid-cols-1 gap-3 text-xs">
                {/* ชื่อหอพัก */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">ชื่อหอพัก *</label>
                  <input
                    type="text"
                    required
                    value={localName}
                    onChange={(e) => {
                      setLocalName(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('name', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>
              </div>

              {/* ที่อยู่หอพัก */}
              <div className="space-y-1 text-xs">
                <label className="block font-semibold text-slate-700 text-left">ที่อยู่หอพัก</label>
                <textarea
                  required
                  value={localAddress}
                  placeholder="ที่อยู่ เลขที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด รหัสไปรษณีย์"
                  onChange={(e) => {
                    setLocalAddress(e.target.value);
                    setSaveStatus('typing');
                  }}
                  onBlur={(e) => handleGlobalFieldBlur('address', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 h-16 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-sans font-prompt"
                />
              </div>

              {/* สลับโหมดการแสดงผล: ตั้งค่าบัญชีรับเงิน vs กฎระเบียบ & นโยบายสัตว์เลี้ยง */}
              <div className="pt-2 space-y-4">
                {/* แถบสลับโหมดหลัก: แบ่งครึ่ง 50/50 สองฝั่งเสมอกัน สวยงาม สมดุล ไม่ชิดซ้าย */}
                <div className="grid grid-cols-2 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveSectionTab('payment')}
                    className={`pb-2.5 text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer relative ${activeSectionTab === 'payment'
                      ? 'text-indigo-600 font-extrabold'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <Wallet className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>ตั้งค่าบัญชีรับเงิน</span>
                    {(localPromptPay || (localBankName && localBankAccountNumber)) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="ตั้งค่าแล้ว" />
                    )}
                    {activeSectionTab === 'payment' && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSectionTab('policy_rules')}
                    className={`pb-2.5 text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer relative ${activeSectionTab === 'policy_rules'
                      ? 'text-indigo-600 font-extrabold'
                      : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <PawPrint className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>กฎระเบียบ & สัตว์เลี้ยง</span>
                    {activeSectionTab === 'policy_rules' && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />
                    )}
                  </button>
                </div>

                {/* โหมด 1: ตั้งค่าบัญชีรับเงิน (พร้อมเพย์ / ธนาคาร) */}
                {activeSectionTab === 'payment' && (
                  <div className="space-y-3.5 animate-in fade-in duration-200">
                    {/* 1. ช่องทางรับชำระ อยู่ด้านบนเหมือน นโยบายสัตว์เลี้ยง (Pet Policy) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <CreditCard className="w-4 h-4 text-indigo-600" />
                          <span>ช่องทางรับชำระ</span>
                        </label>
                      </div>

                      {/* ตัวเลือกแบบ Radio 2 ตัวเลือก เหมือน นโยบายสัตว์เลี้ยง */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* ตัวเลือก 1: พร้อมเพย์ (PromptPay) */}
                        <button
                          type="button"
                          onClick={() => setActivePaymentTab('promptpay')}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer text-left ${activePaymentTab === 'promptpay'
                            ? 'border-2 border-indigo-600 bg-indigo-50/20 text-indigo-950 shadow-2xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                            }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${activePaymentTab === 'promptpay'
                              ? 'border-indigo-600 bg-white'
                              : 'border-slate-300 bg-white'
                              }`}
                          >
                            {activePaymentTab === 'promptpay' && (
                              <span className="w-2 h-2 rounded-full bg-indigo-600" />
                            )}
                          </span>
                          <QrCode className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span className="truncate">พร้อมเพย์</span>
                          {localPromptPay && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 ml-auto" title="ตั้งค่าแล้ว" />
                          )}
                        </button>

                        {/* ตัวเลือก 2: โอนผ่านบัญชีธนาคาร (Bank Transfer) */}
                        <button
                          type="button"
                          onClick={() => setActivePaymentTab('bank')}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer text-left ${activePaymentTab === 'bank'
                            ? 'border-2 border-indigo-600 bg-indigo-50/20 text-indigo-950 shadow-2xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                            }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${activePaymentTab === 'bank'
                              ? 'border-indigo-600 bg-white'
                              : 'border-slate-300 bg-white'
                              }`}
                          >
                            {activePaymentTab === 'bank' && (
                              <span className="w-2 h-2 rounded-full bg-indigo-600" />
                            )}
                          </span>
                          <Landmark className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span className="truncate">โอนผ่านบัญชีธนาคาร</span>
                          {localBankName && localBankAccountNumber && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 ml-auto" title="ตั้งค่าแล้ว" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* กรอบแสดงข้อมูลที่กำลังเลือก ให้เห็นชัดเจนว่าเกี่ยวข้องกัน */}
                    {activePaymentTab === 'promptpay' && (
                      <div className="p-3.5 sm:p-4 rounded-xl border border-indigo-200/90 bg-indigo-50/20 shadow-2xs space-y-3 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between pb-2 border-b border-indigo-100/70">
                          <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                            <QrCode className="w-3.5 h-3.5 text-indigo-600" />
                            ข้อมูลบัญชีพร้อมเพย์ (PromptPay)
                          </span>
                          <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                            พร้อมใช้งาน
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {/* เลขพร้อมเพย์ (เบอร์ / บัตรปชช.) */}
                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700">เลขพร้อมเพย์ (เบอร์ / บัตรปชช.) *</label>
                            <input
                              type="text"
                              required
                              data-testid="input-promptpay-number"
                              value={localPromptPay}
                              onChange={(e) => {
                                setLocalPromptPay(formatPromptPay(e.target.value));
                                setSaveStatus('typing');
                              }}
                              onBlur={(e) => handleGlobalFieldBlur('promptPayNumber', e.target.value)}
                              placeholder="0XX-XXX-XXXX หรือ X-XXXX-..."
                              className="w-full h-10 px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                            />
                          </div>

                          {/* ชื่อบัญชีพร้อมเพย์ */}
                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700">ชื่อบัญชีพร้อมเพย์ *</label>
                            <input
                              type="text"
                              required
                              value={localPromptPayName}
                              placeholder="ชื่อ-นามสกุล ผู้รับเงินพร้อมเพย์"
                              onChange={(e) => {
                                setLocalPromptPayName(e.target.value);
                                if (!localBankAccountName) {
                                  setLocalBankAccountName(e.target.value);
                                }
                                setSaveStatus('typing');
                              }}
                              onBlur={(e) => handleGlobalFieldBlur('promptPayName', e.target.value)}
                              className="w-full h-10 px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tab 2: โอนผ่านบัญชีธนาคาร (Bank Transfer) */}
                    {activePaymentTab === 'bank' && (
                      <div className="p-3.5 sm:p-4 rounded-xl border border-indigo-200/90 bg-indigo-50/20 shadow-2xs space-y-3 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between pb-2 border-b border-indigo-100/70">
                          <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                            <Landmark className="w-3.5 h-3.5 text-indigo-600" />
                            ข้อมูลบัญชีธนาคาร (Bank Account)
                          </span>
                          <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
                            พร้อมใช้งาน
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          {/* ธนาคาร */}
                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700">ธนาคาร *</label>
                            <select
                              value={normalizeBankCode(localBankName)}
                              onChange={(e) => {
                                const newBank = e.target.value;
                                setLocalBankName(newBank);
                                handleGlobalFieldBlur('bankName', newBank);
                              }}
                              className="w-full h-10 px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-sans font-prompt"
                            >
                              <option value="">-- เลือกธนาคาร --</option>
                              {SUPPORTED_BANKS.map((b) => (
                                <option key={b.code} value={b.code}>
                                  {b.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* เลขบัญชีธนาคาร */}
                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700">เลขบัญชีธนาคาร *</label>
                            <input
                              type="text"
                              required
                              value={localBankAccountNumber}
                              disabled={!normalizeBankCode(localBankName)}
                              placeholder={normalizeBankCode(localBankName) ? "XXX-X-XXXXX-X" : "กรุณาเลือกธนาคารก่อน"}
                              onChange={(e) => {
                                setLocalBankAccountNumber(formatBankAccount(e.target.value));
                                setSaveStatus('typing');
                              }}
                              onBlur={(e) => handleGlobalFieldBlur('bankAccountNumber', e.target.value)}
                              className={`w-full h-10 px-3 py-2 border border-slate-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-sans font-prompt ${!normalizeBankCode(localBankName) ? 'opacity-50 bg-slate-100 cursor-not-allowed' : 'bg-white'
                                }`}
                            />
                          </div>

                          {/* ชื่อบัญชีธนาคาร */}
                          <div className="space-y-1">
                            <label className="block font-semibold text-slate-700">ชื่อบัญชีธนาคาร *</label>
                            <input
                              type="text"
                              required
                              value={localBankAccountName}
                              disabled={!normalizeBankCode(localBankName)}
                              placeholder={normalizeBankCode(localBankName) ? "ชื่อบัญชีธนาคารผู้รับเงิน" : "กรุณาเลือกธนาคารก่อน"}
                              onChange={(e) => {
                                setLocalBankAccountName(e.target.value);
                                setSaveStatus('typing');
                              }}
                              onBlur={(e) => handleGlobalFieldBlur('bankAccountName', e.target.value)}
                              className={`w-full h-10 px-3 py-2 border border-slate-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs font-sans font-prompt ${!normalizeBankCode(localBankName) ? 'opacity-50 bg-slate-100 cursor-not-allowed' : 'bg-white'
                                }`}
                            />
                          </div>

                          {/* QRCode ธนาคาร (ไม่บังคับ) */}
                          <BankQrCodeUploader
                            disabled={!normalizeBankCode(localBankName)}
                            qrCodeUrl={localBankQrCode}
                            onQrCodeChange={(newQr) => {
                              setLocalBankQrCode(newQr);
                              handleGlobalFieldBlur('bankQrCode', newQr || '');
                              if (newQr) {
                                showToast('อัปโหลด QRCode ธนาคารสำเร็จ');
                                if (onAddLog) onAddLog('อัปเดต QRCode ธนาคาร', 'อัปโหลด QRCode บัญชีธนาคารสำหรับรับเงิน', 'Dormitory', activeDormId);
                              } else {
                                showToast('ลบ QRCode ธนาคารเรียบร้อยแล้ว');
                                if (onAddLog) onAddLog('ลบ QRCode ธนาคาร', 'ลบ QRCode บัญชีธนาคารสำหรับรับเงิน', 'Dormitory', activeDormId);
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* โหมด 2: นโยบายสัตว์เลี้ยง และ กฎระเบียบข้อกำหนดหอพัก (จากรูปภาพ) */}
                {activeSectionTab === 'policy_rules' && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    {/* 1. นโยบายสัตว์เลี้ยง (Pet Policy) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <PawPrint className="w-4 h-4 text-indigo-600" />
                          <span>นโยบายสัตว์เลี้ยง (Pet Policy)</span>
                        </label>
                      </div>

                      {/* ตัวเลือกแบบ Radio 2 ตัวเลือก */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* ตัวเลือก: ไม่อนุญาตเลี้ยงสัตว์ */}
                        <button
                          type="button"
                          onClick={() => setPetAllowed('none')}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer text-left ${petAllowed === 'none'
                            ? 'border-2 border-indigo-600 bg-indigo-50/20 text-indigo-950 shadow-2xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                            }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${petAllowed === 'none'
                              ? 'border-indigo-600 bg-white'
                              : 'border-slate-300 bg-white'
                              }`}
                          >
                            {petAllowed === 'none' && (
                              <span className="w-2 h-2 rounded-full bg-indigo-600" />
                            )}
                          </span>
                          <span>ไม่อนุญาตเลี้ยงสัตว์</span>
                        </button>

                        {/* ตัวเลือก: อนุญาตแบบมีเงื่อนไข */}
                        <button
                          type="button"
                          onClick={() => setPetAllowed('conditional')}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer text-left ${petAllowed === 'conditional'
                            ? 'border-2 border-indigo-600 bg-indigo-50/20 text-indigo-950 shadow-2xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                            }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-all ${petAllowed === 'conditional'
                              ? 'border-indigo-600 bg-white'
                              : 'border-slate-300 bg-white'
                              }`}
                          >
                            {petAllowed === 'conditional' && (
                              <span className="w-2 h-2 rounded-full bg-indigo-600" />
                            )}
                          </span>
                          <span>อนุญาตแบบมีเงื่อนไข</span>
                        </button>
                      </div>

                      {/* ประเภทสัตว์เลี้ยงที่อนุญาต (แสดงเมื่อเลือกอนุญาตแบบมีเงื่อนไข) */}
                      {petAllowed === 'conditional' && (
                        <div className="bg-slate-50/80 p-3.5 rounded-2xl border border-slate-200/90 space-y-2.5 animate-in fade-in duration-150">
                          <div className="text-xs font-bold text-slate-700">
                            ประเภทสัตว์เลี้ยงที่อนุญาต:
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs">
                            {/* สุนัข (Dog) */}
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <span
                                onClick={() => handleTogglePetType('dog')}
                                className={`w-4 h-4 rounded flex items-center justify-center transition-all ${petAllowedTypes.includes('dog')
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-300 bg-white'
                                  }`}
                              >
                                {petAllowedTypes.includes('dog') && (
                                  <Check className="w-3 h-3 stroke-[3]" />
                                )}
                              </span>
                              <span
                                onClick={() => handleTogglePetType('dog')}
                                className="font-medium text-slate-700"
                              >
                                สุนัข (Dog)
                              </span>
                            </label>

                            {/* แมว (Cat) */}
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <span
                                onClick={() => handleTogglePetType('cat')}
                                className={`w-4 h-4 rounded flex items-center justify-center transition-all ${petAllowedTypes.includes('cat')
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-300 bg-white'
                                  }`}
                              >
                                {petAllowedTypes.includes('cat') && (
                                  <Check className="w-3 h-3 stroke-[3]" />
                                )}
                              </span>
                              <span
                                onClick={() => handleTogglePetType('cat')}
                                className="font-medium text-slate-700"
                              >
                                แมว (Cat)
                              </span>
                            </label>

                            {/* สัตว์เล็ก (กระต่าย/หนู/นก) */}
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <span
                                onClick={() => handleTogglePetType('small_pet')}
                                className={`w-4 h-4 rounded flex items-center justify-center transition-all ${petAllowedTypes.some(t => t === 'small_pet' || t === 'small_pets')
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-300 bg-white'
                                  }`}
                              >
                                {petAllowedTypes.some(t => t === 'small_pet' || t === 'small_pets') && (
                                  <Check className="w-3 h-3 stroke-[3]" />
                                )}
                              </span>
                              <span
                                onClick={() => handleTogglePetType('small_pet')}
                                className="font-medium text-slate-700"
                              >
                                สัตว์เล็ก (กระต่าย/หนู/นก)
                              </span>
                            </label>

                            {/* สัตว์แปลก (other) */}
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <span
                                onClick={() => handleTogglePetType('other')}
                                className={`w-4 h-4 rounded flex items-center justify-center transition-all ${petAllowedTypes.some(t => t === 'other' || t === 'exotic')
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-300 bg-white'
                                  }`}
                              >
                                {petAllowedTypes.some(t => t === 'other' || t === 'exotic') && (
                                  <Check className="w-3 h-3 stroke-[3]" />
                                )}
                              </span>
                              <span
                                onClick={() => handleTogglePetType('other')}
                                className="font-medium text-slate-700"
                              >
                                สัตว์แปลก (Other)
                              </span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 2. กฎระเบียบและข้อกำหนดของหอพัก (Rules & Terms) */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <ScrollText className="w-4 h-4 text-indigo-600" />
                          <span>กฎระเบียบและข้อกำหนดของหอพัก (Rules & Terms)</span>
                        </label>
                      </div>

                      {/* Quick Chips แทรกข้อกำหนดอัตโนมัติ: แถวเดียว เลื่อนง่าย ไม่รกหน้าจอ */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => scrollRules('left')}
                          className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-2xs"
                          title="เลื่อนซ้าย"
                          aria-label="เลื่อนซ้าย"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>

                        <div
                          ref={rulesScrollRef}
                          onWheel={(e) => {
                            if (e.deltaY !== 0 && rulesScrollRef.current) {
                              rulesScrollRef.current.scrollLeft += e.deltaY;
                            }
                          }}
                          className="flex items-center gap-1.5 overflow-x-auto py-0.5 scroll-smooth no-scrollbar select-none"
                          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                        >
                          {PRESET_RULES.map((item, idx) => {
                            const isAdded = isRuleActive(rulesText, item.fullText);
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleAddQuickRule(item.fullText)}
                                disabled={isAdded}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer shrink-0 flex items-center gap-1 whitespace-nowrap ${isAdded
                                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/60'
                                  : 'bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200/80 active:scale-98'
                                  }`}
                                title={isAdded ? 'เพิ่มข้อกำหนดนี้แล้ว' : 'คลิกเพื่อเพิ่มข้อกำหนดนี้'}
                              >
                                {isAdded ? (
                                  <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <Plus className="w-3 h-3 text-indigo-500 shrink-0" />
                                )}
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => scrollRules('right')}
                          className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-2xs"
                          title="เลื่อนขวา"
                          aria-label="เลื่อนขวา"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* กล่องข้อความกฎระเบียบ */}
                      <textarea
                        value={rulesText}
                        onChange={(e) => setRulesText(e.target.value)}
                        rows={6}
                        placeholder="ระบุกฎระเบียบและข้อตกลงหอพักข้อละ 1 บรรทัด..."
                        className="w-full p-3 text-xs leading-relaxed border border-slate-200 rounded-xl bg-white text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-y font-sans h-36"
                      />

                      {/* ปุ่มบันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง */}
                      <div className="pt-1 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={handleSavePetAndRules}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {rulesSavedNotice ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-300" />
                              <span>บันทึกเรียบร้อยแล้ว</span>
                            </>
                          ) : (
                            <span>บันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง</span>
                          )}
                        </button>

                        {rulesSavedNotice && (
                          <span className="text-xs font-semibold text-emerald-600 animate-in fade-in">
                            บันทึกข้อมูลเรียบร้อยแล้ว
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Digital Signature of Owner / Niti Dorm */}
              <div className="space-y-2 text-xs pt-3 border-t border-slate-100">
                <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  ลายมือชื่อเจ้าของหอพัก (สำหรับลงชื่อในสัญญาเช่า)
                </label>
                {(ownerSignatureUrl || dorm.ownerSignature) ? (
                  <div className="space-y-2">
                    <div className="relative border border-slate-200 rounded-2xl overflow-hidden bg-white h-40 flex items-center justify-center p-3">
                      <img
                        src={ownerSignatureUrl || dorm.ownerSignature}
                        alt="ลายเซ็นเจ้าของหอพัก"
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute top-2 left-2 pointer-events-none text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/80 flex items-center gap-1 shadow-2xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>บันทึกลายเซ็นแล้ว</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 font-medium">
                        ลายเซ็นนี้จะแสดงในสัญญาเช่าอัตโนมัติ
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteDormitorySignature(activeDormId);
                          } catch (err) {
                            console.warn('Backend delete signature error:', err);
                          }
                          const updated = { ...dorm, ownerSignature: undefined, updatedAt: new Date().toISOString() };
                          setDorm(updated);
                          setOwnerSignatureUrl(null);
                          triggerSaveNow(updated);
                          showToast('ลบลายเซ็นหอพักเรียบร้อยแล้ว');
                          if (onRefreshData) onRefreshData();
                        }}
                        className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer font-bold flex items-center gap-1 border border-rose-200 bg-rose-50/50"
                      >
                        <span>ลบและเซ็นใหม่</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <SignaturePad
                    onSave={async (dataUrl) => {
                      try {
                        await uploadDormitorySignature(activeDormId, dataUrl);
                      } catch (err) {
                        console.warn('Backend upload signature error:', err);
                      }
                      const updated = { ...dorm, ownerSignature: dataUrl, updatedAt: new Date().toISOString() };
                      setDorm(updated);
                      setOwnerSignatureUrl(dataUrl);
                      triggerSaveNow(updated);
                      showToast('บันทึกลายเซ็นเรียบร้อยแล้ว');
                      if (onRefreshData) onRefreshData();
                    }}
                    onClear={() => {
                      setOwnerSignatureUrl(null);
                      const updated = { ...dorm, ownerSignature: undefined, updatedAt: new Date().toISOString() };
                      setDorm(updated);
                      triggerSaveNow(updated);
                    }}
                  />
                )}
              </div>
            </div>

            {/* Column 2: การตั้งค่าอัตราส่วนต่างและการคำนวณ */}
            <div className="space-y-5 lg:pl-8 xl:pl-10 min-w-0 relative">
              {/* Heading with integrated, clean Cycle selector (same line on PC, responsive on Mobile) */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2.5 pb-3 border-b border-gray-100">
                <h4 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider text-left">
                  <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
                  การตั้งค่า
                </h4>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                  <span className="text-[10px] font-extrabold text-slate-400 flex items-center gap-1 whitespace-nowrap shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    รอบงวดการคำนวณ
                  </span>

                  {/* Styled Cycle switcher with standard BillingCycleCalendarPicker */}
                  <div className="relative">
                    <button
                      onClick={() => setIsCycleModalOpen(true)}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 border border-slate-200 hover:border-indigo-500 rounded-xl bg-white text-slate-800 font-extrabold shadow-2xs text-xs cursor-pointer transition-all w-auto min-w-[160px] sm:min-w-[180px]"
                    >
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        ประจำเดือน {getShortCycleLabel(selectedCycle)}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>

                    <BillingCycleCalendarPicker
                      isOpen={isCycleModalOpen}
                      onClose={() => setIsCycleModalOpen(false)}
                      selectedCycleCode={selectedCycle}
                      availableCycles={(billingCycles && billingCycles.length > 0 ? billingCycles : availableCycles) || []}
                      minCycle={minCycle}
                      maxCycle={maxCycle}
                      onSelectCycle={(targetCycle) => {
                        setSelectedCycle(targetCycle);
                        if (onCycleChange) {
                          onCycleChange(targetCycle);
                        }
                        setIsCycleModalOpen(false);
                      }}
                      align="right"
                    />
                  </div>

                </div>
              </div>

              <span data-testid="snapshot-provenance-badge" className="hidden">{snapshotProvenance}</span>
              {tierSaveError && (
                <div data-testid="tier-save-error" className="text-xs text-rose-600 font-bold p-2 bg-rose-50 rounded-xl border border-rose-200">
                  {tierSaveError}
                </div>
              )}

              {/* Water Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs pt-1">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                    <Droplet className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>{waterBillingMode === 'tiered' ? 'อัตราค่าน้ำขั้นต้น (บาท)' : 'อัตราค่าน้ำ (บาท) *'}</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    data-testid="input-water-unit-rate"
                    required
                    disabled={waterBillingMode === 'tiered' || isSnapshotLoading || isCycleLocked}
                    value={localWaterUnitRate}
                    onChange={(e) => {
                      setLocalWaterUnitRate(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('waterRate', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-60 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 truncate">รูปแบบค่าน้ำ</label>
                  <select
                    data-testid="select-water-billing-mode"
                    disabled={isSnapshotLoading || isCycleLocked}
                    value={waterBillingMode}
                    onChange={(e) => handleRateSelectChange('waterBillingMode', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                  >
                    <option value="per_unit">บาท/หน่วย</option>
                    <option value="per_person">บาท/คน</option>
                    <option value="fixed">บาท/ห้อง</option>
                    <option value="tiered">คิดตามขั้นบันได</option>
                  </select>
                </div>
              </div>

              {/* Water Tiered Editor if tiered selected */}
              {waterBillingMode === 'tiered' && (
                <div className="pt-1 pb-1">
                  <TieredRateEditor
                    utilityType="water"
                    type="water"
                    accentColor="blue"
                    tiers={waterTierRates}
                    disabled={isSnapshotLoading || isCycleLocked}
                    onChange={(newTiers) => {
                      setWaterTierRates(newTiers);
                      setSaveStatus('typing');
                    }}
                    onSave={(savedTiers) => handleSaveTierSettings('water', savedTiers)}
                  />
                </div>
              )}

              {/* Electric Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>{electricBillingMode === 'tiered' ? 'อัตราค่าไฟฟ้าขั้นต้น (บาท)' : 'อัตราค่าไฟฟ้า (บาท) *'}</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    data-testid="input-electric-unit-rate"
                    required
                    disabled={electricBillingMode === 'tiered' || isSnapshotLoading || isCycleLocked}
                    value={localElectricUnitRate}
                    onChange={(e) => {
                      setLocalElectricUnitRate(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('electricityRate', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-60 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 truncate">รูปแบบค่าไฟฟ้า</label>
                  <select
                    data-testid="select-electric-billing-mode"
                    disabled={isSnapshotLoading || isCycleLocked}
                    value={electricBillingMode}
                    onChange={(e) => handleRateSelectChange('electricBillingMode', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                  >
                    <option value="per_unit">บาท/หน่วย</option>
                    <option value="per_person">บาท/คน</option>
                    <option value="fixed">บาท/ห้อง</option>
                    <option value="tiered">คิดตามขั้นบันได</option>
                  </select>
                </div>
              </div>

              {/* Electric Tiered Editor if tiered selected */}
              {electricBillingMode === 'tiered' && (
                <div className="pt-1 pb-1">
                  <TieredRateEditor
                    utilityType="electricity"
                    type="electricity"
                    accentColor="amber"
                    tiers={electricTierRates}
                    disabled={isSnapshotLoading || isCycleLocked}
                    onChange={(newTiers) => {
                      setElectricTierRates(newTiers);
                      setSaveStatus('typing');
                    }}
                    onSave={(savedTiers) => handleSaveTierSettings('electricity', savedTiers)}
                  />
                </div>
              )}

              {/* Common Fee Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                    <Users className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>ค่าส่วนกลาง (บาท) *</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    data-testid="input-common-fee"
                    required
                    disabled={commonFeeMode === 'free' || isSnapshotLoading || isCycleLocked}
                    value={commonFeeMode === 'free' ? '0.00' : localCommonFee}
                    onChange={(e) => {
                      setLocalCommonFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('commonFee', e.target.value)}
                    placeholder={commonFeeMode === 'free' ? 'ฟรี' : '0.00'}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 truncate">รูปแบบค่าส่วนกลาง</label>
                  <select
                    data-testid="select-common-fee-mode"
                    disabled={isSnapshotLoading || isCycleLocked}
                    value={commonFeeMode}
                    onChange={(e) => handleRateSelectChange('commonFeeMode', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="room">บาท/ห้อง</option>
                    <option value="person">บาท/คน</option>
                  </select>
                </div>
              </div>

              {/* Internet Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                    <Wifi className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span>ค่าอินเทอร์เน็ต (บาท) *</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    data-testid="input-internet-fee"
                    required
                    disabled={internetFeeMode === 'free' || isSnapshotLoading || isCycleLocked}
                    value={internetFeeMode === 'free' ? '0.00' : localInternetFee}
                    onChange={(e) => {
                      setLocalInternetFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('internetFee', e.target.value)}
                    placeholder={internetFeeMode === 'free' ? 'ฟรี' : '0.00'}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 truncate">รูปแบบค่าอินเทอร์เน็ต</label>
                  <select
                    data-testid="select-internet-fee-mode"
                    disabled={isSnapshotLoading || isCycleLocked}
                    value={internetFeeMode}
                    onChange={(e) => handleRateSelectChange('internetFeeMode', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="room">บาท/ห้อง</option>
                    <option value="person">บาท/คน</option>
                  </select>
                </div>
              </div>

              {/* Parking Fee Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                    <Building className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    <span>ค่าจอดรถ (บาท) *</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    data-testid="input-parking-fee"
                    required
                    disabled={parkingFeeMode === 'free' || isSnapshotLoading || isCycleLocked}
                    value={parkingFeeMode === 'free' ? '0.00' : localParkingFee}
                    onChange={(e) => {
                      setLocalParkingFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('parkingFee', e.target.value)}
                    placeholder={parkingFeeMode === 'free' ? 'ฟรี' : '0.00'}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 truncate">รูปแบบค่าจอดรถ</label>
                  <select
                    data-testid="select-parking-fee-mode"
                    disabled={isSnapshotLoading || isCycleLocked}
                    value={parkingFeeMode}
                    onChange={(e) => handleRateSelectChange('parkingFeeMode', e.target.value)}
                    className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="per_room">บาท/ห้อง</option>
                    <option value="per_vehicle">บาท/คัน</option>
                    <option value="per_person">บาท/คน</option>
                  </select>
                </div>
              </div>

              {/* Collapsible Section: กำหนดชำระและค่าปรับเกินกำหนด */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  data-testid="toggle-late-fee-section"
                  onClick={() => setIsLateFeeSectionOpen(!isLateFeeSectionOpen)}
                  className="w-full flex items-center justify-between py-2 text-left group cursor-pointer"
                >
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>กำหนดชำระและค่าปรับเกินกำหนด</span>
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isLateFeeSectionOpen ? 'rotate-180 text-slate-600' : ''
                      }`}
                  />
                </button>

                {isLateFeeSectionOpen && (
                  <div className="space-y-4 pt-2">
                    {/* Late Fee Penalty Settings */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                      <div className="space-y-1">
                        <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span>ค่าปรับเมื่อเกินวันกำหนด (บาท) *</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          data-testid="input-late-fee"
                          required
                          disabled={lateFeeType === 'none' || lateFeeType === 'free' || isCycleLocked}
                          value={lateFeeType === 'none' || lateFeeType === 'free' ? '0.00' : localLateFee}
                          onChange={(e) => {
                            setLocalLateFee(e.target.value);
                            setSaveStatus('typing');
                          }}
                          onBlur={(e) => handleRateBlur('lateFeeDaily', e.target.value)}
                          placeholder={lateFeeType === 'none' || lateFeeType === 'free' ? 'ฟรี' : '0.00'}
                          className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block font-semibold text-slate-700 truncate">รูปแบบค่าปรับเกินกำหนด</label>
                        <select
                          data-testid="select-late-fee-type"
                          disabled={isCycleLocked}
                          value={lateFeeType}
                          onChange={(e) => {
                            const val = toCanonicalMode(e.target.value, 'late');
                            setLateFeeType(val);
                            handleRateSelectChange('lateFeeType', val);
                          }}
                          className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                        >
                          <option value="none">ไม่คิดค่าปรับ (ฟรี)</option>
                          <option value="daily">บาท/วัน</option>
                          <option value="fixed">คิดครั้งเดียว</option>
                        </select>
                      </div>
                    </div>

                    {/* Due Date Settings / วันครบกำหนดชำระเงิน */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs">
                      <div className="space-y-1">
                        <label className="block font-semibold text-slate-700 flex items-center gap-1.5 truncate">
                          <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span>วันครบกำหนดชำระ (วัน) *</span>
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type="text"
                            inputMode="numeric"
                            data-testid="input-due-day"
                            pattern="[0-9]*"
                            required
                            disabled={isCycleLocked}
                            value={localDueDay}
                            onChange={(e) => handleDueDayChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(e.key) &&
                                !/^[0-9]$/.test(e.key)
                              ) {
                                e.preventDefault();
                              }
                            }}
                            onBlur={(e) => handleDueDayBlur(e.target.value)}
                            placeholder="5"
                            className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                          />
                          <span className="absolute right-3 text-xs font-semibold text-slate-400 pointer-events-none">
                            ของทุกเดือน
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="block font-semibold text-slate-700 truncate">เลือกวันครบกำหนด</label>
                        <select
                          disabled={isSnapshotLoading || isCycleLocked}
                          value={Number(localDueDay) >= 1 && Number(localDueDay) <= 28 ? Number(localDueDay) : 'custom'}
                          onChange={(e) => {
                            if (e.target.value !== 'custom') {
                              const val = Number(e.target.value);
                              setLocalDueDay(val);
                              handleDueDayBlur(val);
                            }
                          }}
                          className="w-full h-10 px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer truncate disabled:opacity-60 disabled:bg-slate-100"
                        >
                          {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                            <option key={day} value={day}>
                              วันที่ {day} ของทุกเดือน
                            </option>
                          ))}
                          {(Number(localDueDay) < 1 || Number(localDueDay) > 28) && (
                            <option value="custom">กำหนดเอง (วันที่ {localDueDay})</option>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* VAT 7% Calculation Settings / การคิดภาษีมูลค่าเพิ่ม VAT 7% */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs shrink-0">
                      <Percent className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">คิด VAT {vatRate}%</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${vatEnabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                          }`}>
                          {vatEnabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">คำนวณภาษีมูลค่าเพิ่ม 7% รวมในใบแจ้งหนี้อัตโนมัติ</p>
                    </div>
                  </div>

                  {/* Toggle Button */}
                  <button
                    type="button"
                    data-testid="toggle-vat-7"
                    disabled={isSnapshotLoading || isCycleLocked}
                    onClick={() => handleToggleVatEnabled(!vatEnabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isSnapshotLoading || isCycleLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                      } ${vatEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    title={isCycleLocked ? 'รอบบิลนี้ถูกล็อคแล้วเนื่องจากมีการชำระเงิน' : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${vatEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                    />
                  </button>
                </div>

                {/* Checklist of categories when VAT 7% is enabled */}
                {vatEnabled && (
                  <div className="mt-2 p-3 bg-slate-50/80 border border-slate-200/80 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                        เลือกรายการค่าบริการที่ต้องการคิด VAT 7%
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          disabled={isSnapshotLoading || isCycleLocked}
                          onClick={() => handleToggleAllVatCategories(true)}
                          className={`font-semibold transition-colors ${isSnapshotLoading || isCycleLocked ? 'text-slate-400 cursor-not-allowed' : 'text-indigo-600 hover:text-indigo-800 cursor-pointer'
                            }`}
                        >
                          เลือกทั้งหมด
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          disabled={isSnapshotLoading || isCycleLocked}
                          onClick={() => handleToggleAllVatCategories(false)}
                          className={`font-medium transition-colors ${isSnapshotLoading || isCycleLocked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-500 hover:text-slate-700 cursor-pointer'
                            }`}
                        >
                          ล้างค่า
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {[
                        { key: 'rent', label: 'ค่าเช่าห้องพัก', desc: 'ค่าเช่ารายเทอม / รายเดือน / รายวัน' },
                        { key: 'water', label: 'ค่าน้ำ', desc: 'คิดตามหน่วยหรือเหมาจ่าย' },
                        { key: 'electricity', label: 'ค่าไฟฟ้า', desc: 'คิดตามหน่วยหรือเหมาจ่าย' },
                        { key: 'commonFee', label: 'ค่าส่วนกลาง', desc: 'ค่าบำรุงรักษาส่วนกลาง' },
                        { key: 'internetFee', label: 'ค่าอินเทอร์เน็ต / Wi-Fi', desc: 'ค่าบริการอินเทอร์เน็ต' },
                        { key: 'parking', label: 'ค่าที่จอดรถ', desc: 'ค่าจอดรถยนต์ / มอเตอร์ไซค์' },
                        { key: 'fine', label: 'ค่าปรับชำระล่าช้า', desc: 'ค่าปรับเกินกำหนดชำระ' },
                        { key: 'other', label: 'ค่าใช้จ่ายอื่นๆ', desc: 'ค่าทำความสะอาด, ค่าคีย์การ์ด ฯลฯ' }
                      ].map((item) => {
                        const isChecked = vatAppliedCategories.includes(item.key);
                        return (
                          <label
                            key={item.key}
                            onClick={() => {
                              if (isSnapshotLoading || isCycleLocked) return;
                              handleToggleVatCategory(item.key);
                            }}
                            className={`flex items-start gap-2.5 p-2 rounded-lg border transition-all ${isSnapshotLoading || isCycleLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                              } ${isChecked
                                ? 'bg-white border-indigo-300 shadow-xs'
                                : 'bg-white/60 border-slate-200 hover:bg-white text-slate-500'
                              }`}
                          >
                            <div className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center border transition-all ${isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                              }`}>
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className={`block font-semibold leading-tight text-xs ${isChecked ? 'text-slate-800' : 'text-slate-600'}`}>
                                {item.label}
                              </span>
                              <span className="block text-[10.5px] text-slate-400 truncate leading-tight mt-0.5">
                                {item.desc}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>
        </div>
      </div>



      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={handleResetDemoData}
        title="ยืนยันการรีเซ็ตข้อมูลสาธิต"
        message="การรีเซ็ตจะลบข้อมูลที่สร้างหรือแก้ไขใน Prototype บน Browser นี้ และนำข้อมูลตัวอย่างเริ่มต้นกลับมา การดำเนินการนี้ไม่สามารถย้อนกลับได้"
        confirmText="ยืนยันรีเซ็ตข้อมูล"
        cancelText="ยกเลิก"
        type="danger"
      />

      <VersionConflictModal
        isOpen={Boolean(versionConflictState?.isOpen)}
        entityName={versionConflictState?.entityName}
        currentVersion={versionConflictState?.currentVersion ?? snapshotVersion}
        onReload={() => {
          setVersionConflictState(null);
          fetchCycleRateSnapshot();
        }}
        onCancel={() => setVersionConflictState(null)}
        onRetry={versionConflictState?.onRetry}
      />

    </div>
  );
};
