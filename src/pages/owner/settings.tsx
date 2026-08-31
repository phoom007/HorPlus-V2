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
  Calendar,
  Droplet,
  Zap,
  Users,
  RotateCw,
  SlidersHorizontal,
  PenTool,
  CheckCircle2,
  Layers,
  Copy,
  X,
  Lock,
  AlertCircle
} from 'lucide-react';
// Server-authoritative Settings page component

// Legacy mock-storage persistence is retained ONLY for Dormitory profile fields (dormitory name, address, contact phone, taxId, bank accounts) outside the Wave 1G model-backed Property Defaults and Billing Settings.
import { ConfirmDialog, SignaturePad } from '../../components/GlobalComponents';
import { getDataProvider } from '../../data/dataProvider';
import { Task009ApiAdapter } from '../../data/adapters/task009';
import { PropagationPreviewModal } from '../../components/PropagationPreviewModal';
import { VersionConflictModal } from '../../components/VersionConflictModal';
import { BillingCycleCalendarPicker } from '../../components/common/BillingCycleCalendarPicker';
import { getPaymentSettings, updatePaymentSettings, PaymentSettingsUpdatePayload } from '../../services/payment-settings.service';
import { getDormitoryProfile, updateDormitoryProfile, UpdateDormitoryProfilePayload } from '../../services/dormitory.service';
import { OwnerLineOaPage } from './line-oa';
import { queryClient, queryKeys } from '../../lib/queryClient';
import { Dormitory, CycleRates } from '../../types';
import {
  TieredRateEditor,
  CanonicalTierRecord,
  WATER_TIER_PRESET,
  ELECTRICITY_TIER_PRESET,
} from '../../components/settings/TieredRateEditor';

interface OwnerSettingsProps {
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onRefreshData: () => void;
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
  const digits = val.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
  if (digits.length <= 10) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10)}`;
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
};

// Bank account formatter (10 digits: XXX-X-XXXXX-X)
const formatBankAccount = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 9)}-${digits.slice(9)}`;
};

export const toCanonicalMode = (mode: string | undefined, type: 'water' | 'electricity' | 'common' | 'internet' | 'parking' | 'late'): string => {
  if (!mode) {
    if (type === 'water' || type === 'electricity') return 'per_unit';
    if (type === 'common' || type === 'internet' || type === 'parking') return 'per_room';
    if (type === 'late') return 'none';
  }
  const m = String(mode).toLowerCase();
  if (type === 'water' || type === 'electricity') {
    if (m === 'tiered') return 'tiered';
    if (m === 'unit' || m === 'per_unit') return 'per_unit';
    if (m === 'person' || m === 'per_person') return 'per_person';
    if (m === 'fixed' || m === 'flat') return 'fixed';
    return 'per_unit';
  }
  if (type === 'common' || type === 'internet') {
    if (m === 'free' || m === 'none') return 'free';
    if (m === 'person' || m === 'per_person') return 'per_person';
    if (m === 'room' || m === 'per_room') return 'per_room';
    return 'per_room';
  }
  if (type === 'parking') {
    if (m === 'free' || m === 'none') return 'free';
    if (m === 'vehicle' || m === 'per_vehicle') return 'per_vehicle';
    if (m === 'person' || m === 'per_person') return 'per_person';
    if (m === 'room' || m === 'per_room') return 'per_room';
    return 'per_room';
  }
  if (type === 'late') {
    if (m === 'free' || m === 'none') return 'none';
    if (m === 'per_day' || m === 'daily') return 'daily';
    if (m === 'fixed') return 'fixed';
    if (m === 'percentage') return 'percentage';
    return 'none';
  }
  return m;
};

const toNormalizedDecimalString = (val: any): string => {
  if (val === undefined || val === null || val === '') return '0.00';
  const s = String(val).trim();
  return s;
};

export const OwnerSettings: React.FC<OwnerSettingsProps> = ({
  onAddLog,
  onRefreshData,
  selectedCycle: propSelectedCycle,
  onCycleChange,
  availableCycles: propAvailableCycles,
  billingCycles: propBillingCycles,
}) => {
  const [dorm, setDorm] = useState<Dormitory>({ id: '', name: '' } as any);
  const [selectedCycle, setSelectedCycle] = useState<string>(propSelectedCycle || (typeof window !== 'undefined' ? sessionStorage.getItem('settings_selected_cycle') || '' : ''));
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);
  const [tempYear, setTempYear] = useState<number>(new Date().getFullYear());
  const DataProvider = getDataProvider();
  const [propertyVersion, setPropertyVersion] = useState<number>(1);
  const [billingVersion, setBillingVersion] = useState<number>(1);
  const selectedDormId = localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session') || '';

  const [fetchedCycles, setFetchedCycles] = useState<any[]>([]);
  const authoritativeCycles = (propAvailableCycles && propAvailableCycles.length > 0)
    ? propAvailableCycles
    : (propBillingCycles && propBillingCycles.length > 0)
    ? propBillingCycles
    : fetchedCycles;

  useEffect(() => {
    const dormId = selectedDormId || dorm?.id;
    if (dormId && (!propAvailableCycles || propAvailableCycles.length === 0)) {
      fetch(`/api/v1/billing-cycles`, { headers: { 'x-dormitory-id': dormId } })
        .then((res) => res.json())
        .then((json) => {
          if (Array.isArray(json.data) && json.data.length > 0) {
            setFetchedCycles(json.data);
            const savedCycle = sessionStorage.getItem('settings_selected_cycle');
            if (!selectedCycle && !savedCycle) {
              const currentOrFirst = json.data.find((c: any) => c.status === 'active' || c.status === 'open') || json.data[0];
              if (currentOrFirst?.cycleCode) {
                setSelectedCycle(currentOrFirst.cycleCode);
              }
            }
          }
        })
        .catch(() => {});
    }
  }, [selectedDormId, dorm?.id, propAvailableCycles]);

  const [isCycleLocked, setIsCycleLocked] = useState<boolean>(false);
  const [cycleLockReason, setCycleLockReason] = useState<string | null>(null);
  const [snapshotProvenance, setSnapshotProvenance] = useState<string>('TEMPLATE_DEFAULT');
  const [snapshotVersion, setSnapshotVersion] = useState<number>(1);
  const [currentCycleId, setCurrentCycleId] = useState<string>('');

  const [propertyMonthlyRent, setPropertyMonthlyRent] = useState<number>(0);
  const [propertyDepositAmount, setPropertyDepositAmount] = useState<number>(0);

  const [localWaterUnitRate, setLocalWaterUnitRate] = useState<string | number>('0.00');
  const [localElectricUnitRate, setLocalElectricUnitRate] = useState<string | number>('0.00');
  const [localCommonFee, setLocalCommonFee] = useState<string | number>('0.00');
  const [localInternetFee, setLocalInternetFee] = useState<string | number>('0.00');
  const [localParkingFee, setLocalParkingFee] = useState<string | number>('0.00');
  const [localLateFee, setLocalLateFee] = useState<string | number>('0.00');
  const [localDueDay, setLocalDueDay] = useState<number>(5);

  const [waterBillingMode, setWaterBillingMode] = useState<string>('per_unit');
  const [electricBillingMode, setElectricBillingMode] = useState<string>('per_unit');
  const [commonFeeMode, setCommonFeeMode] = useState<string>('per_room');
  const [internetFeeMode, setInternetFeeMode] = useState<string>('per_room');
  const [parkingFeeMode, setParkingFeeMode] = useState<string>('per_room');
  const [lateFeeType, setLateFeeType] = useState<string>('none');
  const [isLateFeeSectionExpanded, setIsLateFeeSectionExpanded] = useState<boolean>(false);

  const [waterTierRates, setWaterTierRates] = useState<CanonicalTierRecord[]>(WATER_TIER_PRESET);
  const [electricTierRates, setElectricTierRates] = useState<CanonicalTierRecord[]>(ELECTRICITY_TIER_PRESET);
  const [durableWaterTierRates, setDurableWaterTierRates] = useState<CanonicalTierRecord[] | null>(null);
  const [durableElectricTierRates, setDurableElectricTierRates] = useState<CanonicalTierRecord[] | null>(null);
  const [tierSaveError, setTierSaveError] = useState<string | null>(null);

  const currentDormId = selectedDormId || dorm?.id || '';
  const currentDormIdRef = useRef(currentDormId);
  currentDormIdRef.current = currentDormId;
  const currentCycleRef = useRef(selectedCycle);
  currentCycleRef.current = selectedCycle;

  const defaultsLoadedDormIdRef = useRef<string | null>(null);
  const snapshotLoadedContextRef = useRef<string | null>(null);
  const loadedSnapshotAuthorityRef = useRef<{
    dormId: string;
    cycleCode: string;
    cycleId: string;
    version: number;
  } | null>(null);


  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Propagation Preview & Conflict state
  const isPropagationPreviewOpeningRef = useRef(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [propagationChanges, setPropagationChanges] = useState<Record<string, any>>({});
  const [versionConflictState, setVersionConflictState] = useState<{
    isOpen: boolean;
    entityName: string;
    currentVersion: number;
    onRetry?: () => void;
  } | null>(null);

  const rawRateSnapshotRef = useRef<any>(null);
  const rawDormitoryBillingRef = useRef<any>(null);

  const applyComposedSettingsState = () => {
    const snapshot = rawRateSnapshotRef.current;
    const defaults = rawDormitoryBillingRef.current;

    if (!isUserTypingRef.current) {
      // 1. Active Mode Authority: selected snapshot takes absolute precedence
      let activeWMode = 'per_unit';
      let activeEMode = 'per_unit';

      if (snapshot?.waterBillingType) {
        activeWMode = toCanonicalMode(snapshot.waterBillingType, 'water');
      } else if (defaults?.waterBillingMode || defaults?.waterBillingType) {
        activeWMode = toCanonicalMode(defaults.waterBillingMode || defaults.waterBillingType, 'water');
      }

      if (snapshot?.electricityBillingType) {
        activeEMode = toCanonicalMode(snapshot.electricityBillingType, 'electricity');
      } else if (defaults?.electricBillingMode || defaults?.electricityBillingType) {
        activeEMode = toCanonicalMode(defaults.electricBillingMode || defaults.electricityBillingType, 'electricity');
      }

      setWaterBillingMode(activeWMode);
      setElectricBillingMode(activeEMode);

      // 2. Durable Inactive Tiers from DormitoryBillingSettings (explicit null clearing)
      const durableW = Array.isArray(defaults?.waterTierRates) && defaults.waterTierRates.length > 0
        ? defaults.waterTierRates
        : null;
      const durableE = Array.isArray(defaults?.electricityTierRates) && defaults.electricityTierRates.length > 0
        ? defaults.electricityTierRates
        : null;

      setDurableWaterTierRates(durableW);
      setDurableElectricTierRates(durableE);

      // 3. Tier Draft Composition (Section 5)
      if (activeWMode === 'tiered' && Array.isArray(snapshot?.waterTierRates) && snapshot.waterTierRates.length > 0) {
        setWaterTierRates(snapshot.waterTierRates);
      } else if (durableW) {
        setWaterTierRates(durableW);
      } else {
        setWaterTierRates(WATER_TIER_PRESET);
      }

      if (activeEMode === 'tiered' && Array.isArray(snapshot?.electricityTierRates) && snapshot.electricityTierRates.length > 0) {
        setElectricTierRates(snapshot.electricityTierRates);
      } else if (durableE) {
        setElectricTierRates(durableE);
      } else {
        setElectricTierRates(ELECTRICITY_TIER_PRESET);
      }
    }
  };

  const fetchCycleRateSnapshot = async (cycleCodeOrId: string) => {
    const requestDormId = selectedDormId || dorm?.id || '';
    const requestCycle = cycleCodeOrId;
    if (!requestDormId || !requestCycle) return;

    try {
      const res = await fetch(`/api/v1/billing-cycles/by-code/${requestCycle}/rate-snapshot`, {
        headers: { 'x-dormitory-id': requestDormId },
      });

      if (res.ok) {
        const json = await res.json();

        // Stale response guard: check AFTER body parsing (res.json()) has resolved
        if (currentDormIdRef.current !== requestDormId || currentCycleRef.current !== requestCycle) {
          return;
        }

        if (json.data) {
          const { cycle, rateSnapshot, isLocked: locked, lockReason } = json.data;
          snapshotLoadedContextRef.current = `${requestDormId}_${requestCycle}`;
          if (cycle?.id) setCurrentCycleId(cycle.id);
          setIsCycleLocked(Boolean(locked));
          setCycleLockReason(lockReason || null);

          if (rateSnapshot) {
            const ver = rateSnapshot.version || 1;
            setSnapshotVersion(ver);
            setSnapshotProvenance(rateSnapshot.source || 'TEMPLATE_DEFAULT');
            rawRateSnapshotRef.current = rateSnapshot;
            loadedSnapshotAuthorityRef.current = {
              dormId: requestDormId,
              cycleCode: requestCycle,
              cycleId: cycle?.id || '',
              version: ver,
            };

            if (!isUserTypingRef.current) {
              setLocalWaterUnitRate(rateSnapshot.waterRate ?? '0.00');
              setLocalElectricUnitRate(rateSnapshot.electricityRate ?? '0.00');
              setLocalCommonFee(rateSnapshot.commonFee ?? '0.00');
              setCommonFeeMode(toCanonicalMode(rateSnapshot.commonFeeMode, 'common'));
              setLocalInternetFee(rateSnapshot.internetFee ?? '0.00');
              setInternetFeeMode(toCanonicalMode(rateSnapshot.internetFeeMode, 'internet'));
              setLocalParkingFee(rateSnapshot.parkingFee ?? '0.00');
              setParkingFeeMode(toCanonicalMode(rateSnapshot.parkingFeeMode, 'parking'));
              setLocalLateFee(rateSnapshot.lateFeeValue ?? '0.00');
              setLateFeeType(toCanonicalMode(rateSnapshot.lateFeeType, 'late'));
            }

            applyComposedSettingsState();
          }
        }
      }
    } catch (err) {
      console.error('Error fetching cycle rate snapshot:', err);
    }
  };

  const handleSaveTierSettings = async (utilityType: 'water' | 'electricity', tiers: CanonicalTierRecord[]) => {
    const dormId = selectedDormId || dorm?.id;
    const cycle = selectedCycle;
    if (!dormId || !cycle || isCycleLocked) return;

    // Loading / Save Guard: Fail closed if authority for current context has not completed loading
    if (defaultsLoadedDormIdRef.current !== dormId || snapshotLoadedContextRef.current !== `${dormId}_${cycle}`) {
      console.warn('Cannot save tier settings: current context authority has not finished loading');
      return;
    }

    const requestDormId = dormId;
    setTierSaveError(null);
    setSaveStatus('saving');
    try {
      // 1. First persist to DormitoryBillingSettings (Durable Reusable Authority)
      if (DataProvider.properties) {
        const billingChanges: Record<string, any> = utilityType === 'water'
          ? { waterTierRates: tiers }
          : { electricityTierRates: tiers };

        const defRes = await DataProvider.properties.updateDormitoryDefaults({
          billing: {
            changes: billingChanges,
            expectedVersion: billingVersion,
          },
        });

        // Stale in-flight dormitory mutation guard
        if (currentDormIdRef.current !== requestDormId) {
          return;
        }

        if (!defRes.success) {
          const errCode = defRes.error?.code;
          if (errCode === 'VERSION_CONFLICT' || errCode === 'CONFLICT') {
            const conflictVer = (defRes.error?.details as any)?.currentVersion || billingVersion + 1;
            setVersionConflictState({
              isOpen: true,
              entityName: 'การตั้งค่าหอพัก (Dormitory Defaults)',
              currentVersion: conflictVer,
              onRetry: () => fetchDormitoryDefaults(),
            });
            setSaveStatus('idle');
            return;
          }
          const userMsg = defRes.error?.message || 'บันทึกการตั้งค่าหอพักไม่สำเร็จ กรุณาลองใหม่';
          setTierSaveError(userMsg);
          setSaveStatus('idle');
          console.error('Failed to update dormitory defaults:', defRes.error);
          return;
        }

        // Authoritative version sync: consume server-returned billing & synchronize raw ref
        const serverBilling = (defRes.data as any)?.billing;
        if (serverBilling && typeof serverBilling.version === 'number') {
          rawDormitoryBillingRef.current = serverBilling;
          setBillingVersion(serverBilling.version);
          setDurableWaterTierRates(
            Array.isArray(serverBilling.waterTierRates) && serverBilling.waterTierRates.length > 0
              ? serverBilling.waterTierRates
              : null
          );
          setDurableElectricTierRates(
            Array.isArray(serverBilling.electricityTierRates) && serverBilling.electricityTierRates.length > 0
              ? serverBilling.electricityTierRates
              : null
          );
        } else {
          if (utilityType === 'water') setDurableWaterTierRates(tiers);
          if (utilityType === 'electricity') setDurableElectricTierRates(tiers);
        }
      }

      // 2. Second persist to selected BillingRateSnapshot (Active Financial Authority)
      const overrides: Record<string, any> = utilityType === 'water'
        ? { waterBillingType: 'tiered', waterTierRates: tiers }
        : { electricityBillingType: 'tiered', electricityTierRates: tiers };

      const snapshotRes = await handleSaveCycleRateSettings(overrides);
      if (!snapshotRes.ok) {
        if (snapshotRes.reason !== 'VERSION_CONFLICT') {
          const userMsg = snapshotRes.error?.message || 'บันทึกอัตราขั้นบันไดสำหรับรอบบิลไม่สำเร็จ กรุณาลองใหม่';
          setTierSaveError(userMsg);
        }
        console.warn('Snapshot update failed during tier save:', snapshotRes.reason);
        return;
      }

      // Both authorities succeeded: clear any existing tier save error
      setTierSaveError(null);
    } catch (err: any) {
      console.error('Error saving tiered settings:', err);
      setTierSaveError('บันทึกอัตราขั้นบันไดไม่สำเร็จ กรุณาลองใหม่');
      setSaveStatus('idle');
    }
  };

  const handleSaveCycleRateSettings = async (overrides?: Record<string, any>): Promise<{ ok: boolean; reason?: string; error?: any }> => {
    const dormId = selectedDormId || dorm?.id;
    if (!dormId || isCycleLocked) return { ok: false, reason: 'LOCKED_OR_NO_DORM' };

    const targetCycleCode = selectedCycle;
    if (!targetCycleCode) return { ok: false, reason: 'NO_CYCLE' };

    const reqDormId = dormId;
    const reqCycleCode = targetCycleCode;

    // Central cycle-write guard: Fail closed unless snapshot authority is loaded for exact current context
    const loadedAuth = loadedSnapshotAuthorityRef.current;
    if (
      !loadedAuth ||
      loadedAuth.dormId !== reqDormId ||
      loadedAuth.cycleCode !== reqCycleCode ||
      snapshotLoadedContextRef.current !== `${reqDormId}_${reqCycleCode}`
    ) {
      console.warn('Cannot save cycle rate settings: current context authority has not finished loading');
      return { ok: false, reason: 'CONTEXT_NOT_READY' };
    }

    const targetCycleId = loadedAuth.cycleId;
    const targetExpectedVersion = loadedAuth.version;

    setSaveStatus('saving');
    try {
      const csrfMatch = document.cookie.match(/(?:csrf-token|horplus_csrf)=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

      const wMode = toCanonicalMode(overrides?.waterBillingType ?? waterBillingMode, 'water');
      const wRate = toNormalizedDecimalString(overrides?.waterRate ?? localWaterUnitRate);
      const eMode = toCanonicalMode(overrides?.electricityBillingType ?? electricBillingMode, 'electricity');
      const eRate = toNormalizedDecimalString(overrides?.electricityRate ?? localElectricUnitRate);

      const cMode = toCanonicalMode(overrides?.commonFeeMode ?? commonFeeMode, 'common');
      const cFee = cMode === 'free' ? '0.00' : toNormalizedDecimalString(overrides?.commonFee ?? localCommonFee);

      const iMode = toCanonicalMode(overrides?.internetFeeMode ?? internetFeeMode, 'internet');
      const iFee = iMode === 'free' ? '0.00' : toNormalizedDecimalString(overrides?.internetFee ?? localInternetFee);

      const pMode = toCanonicalMode(overrides?.parkingFeeMode ?? parkingFeeMode, 'parking');
      const pFee = pMode === 'free' ? '0.00' : toNormalizedDecimalString(overrides?.parkingFee ?? localParkingFee);

      const lType = toCanonicalMode(overrides?.lateFeeType ?? lateFeeType, 'late');
      const lValue = lType === 'none' ? '0.00' : toNormalizedDecimalString(overrides?.lateFeeValue ?? localLateFee);

      const payload: any = {
        waterBillingType: wMode,
        electricityBillingType: eMode,
        commonFee: cFee,
        commonFeeMode: cMode,
        internetFee: iFee,
        internetFeeMode: iMode,
        parkingFee: pFee,
        parkingFeeMode: pMode,
        lateFeeType: lType,
        lateFeeValue: lValue,
        expectedVersion: targetExpectedVersion,
      };

      if (wMode === 'tiered') {
        const tiersToSave = overrides?.waterTierRates ?? waterTierRates;
        payload.waterTierRates = tiersToSave;
        payload.waterRate = wRate;
      } else {
        payload.waterRate = wRate;
        payload.waterTierRates = null;
      }

      if (eMode === 'tiered') {
        const tiersToSave = overrides?.electricityTierRates ?? electricTierRates;
        payload.electricityTierRates = tiersToSave;
        payload.electricityRate = eRate;
      } else {
        payload.electricityRate = eRate;
        payload.electricityTierRates = null;
      }

      const endpoint = targetCycleId
        ? `/api/v1/billing-cycles/${targetCycleId}/rate-snapshot`
        : `/api/v1/billing-cycles/by-code/${reqCycleCode}/rate-snapshot`;

      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-dormitory-id': reqDormId,
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        setVersionConflictState({
          isOpen: true,
          entityName: `การตั้งค่ารอบบิล ${reqCycleCode}`,
          currentVersion: targetExpectedVersion + 1,
          onRetry: () => fetchCycleRateSnapshot(reqCycleCode),
        });
        setSaveStatus('idle');
        return { ok: false, reason: 'VERSION_CONFLICT' };
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson?.error?.message || 'บันทึกการตั้งค่ารอบบิลไม่สำเร็จ';
        setSaveStatus('idle');
        return { ok: false, reason: 'ERROR', error: new Error(msg) };
      }

      const dataJson = await res.json();

      // Stale in-flight snapshot mutation guard
      if (currentDormIdRef.current !== reqDormId || currentCycleRef.current !== reqCycleCode) {
        return { ok: true };
      }

      if (dataJson?.data?.rateSnapshot) {
        const newVer = dataJson.data.rateSnapshot.version || targetExpectedVersion + 1;
        setSnapshotVersion(newVer);
        setSnapshotProvenance(dataJson.data.rateSnapshot.source || 'MANUAL_OVERRIDE');
        rawRateSnapshotRef.current = dataJson.data.rateSnapshot;
        if (loadedSnapshotAuthorityRef.current) {
          loadedSnapshotAuthorityRef.current.version = newVer;
        }
      }

      isUserTypingRef.current = false;
      setSaveStatus('saved');
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      onAddLog('แก้ไขอัตราค่าบริการรอบบิล', `อัปเดตอัตราค่าบริการประจำเดือน ${reqCycleCode} สำเร็จ`, 'SETTINGS', reqDormId);

      // Targeted cache invalidation to propagate updated rates to Meter workspace live
      if (reqDormId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.billingCycles(reqDormId) });
        queryClient.invalidateQueries({ queryKey: ['meter', reqDormId] });
      }

      return { ok: true };
    } catch (err: any) {
      console.error('Error saving cycle rate settings:', err);
      setSaveStatus('idle');
      return { ok: false, reason: 'ERROR', error: err };
    }
  };

    const [initialValues, setInitialValues] = useState<{
    propertyMonthlyRent?: number;
    propertyDeposit?: number;
    waterRate?: number;
    electricityRate?: number;
  }>({});

  const isUserTypingRef = useRef(false);

  const [propertyDefaultTerms, setPropertyDefaultTerms] = useState<string>('');
  const [propertyPetPolicy, setPropertyPetPolicy] = useState<{ allowed: 'none' | 'conditional'; allowedTypes: string[] }>({
    allowed: 'none',
    allowedTypes: [],
  });
  const [ownerSignatureUrl, setOwnerSignatureUrl] = useState<string | null>(null);
  const [isSignaturePadOpen, setIsSignaturePadOpen] = useState<boolean>(false);
  const [isSavingRules, setIsSavingRules] = useState<boolean>(false);
  const [rulesSaveSuccess, setRulesSaveSuccess] = useState<string | null>(null);

  const fetchOwnerSignature = async (dormId: string) => {
    if (!dormId) return;
    try {
      const res = await fetch(`/api/v1/dormitories/${dormId}/signatures`, {
        headers: { 'x-dormitory-id': dormId },
      });
      if (res.ok) {
        setOwnerSignatureUrl(`/api/v1/dormitories/${dormId}/signatures?t=${Date.now()}`);
      } else {
        setOwnerSignatureUrl(null);
      }
    } catch {
      setOwnerSignatureUrl(null);
    }
  };

  const fetchDormitoryDefaults = async () => {
    const requestDormId = selectedDormId || dorm?.id || '';
    try {
      if (DataProvider.properties) {
        const res = await DataProvider.properties.getDormitoryDefaults();
        // Stale response guard: ignore if active dorm context has changed
        if (currentDormIdRef.current !== requestDormId) {
          return;
        }

        if (res.success && res.data) {
          defaultsLoadedDormIdRef.current = requestDormId;
          const initObj: any = {};
          if (res.data.property) {
            setPropertyVersion(res.data.property.version || 1);
            const rentVal = res.data.property.defaultMonthlyRent !== undefined ? res.data.property.defaultMonthlyRent : res.data.property.monthlyRent;
            if (rentVal !== undefined) {
              if (!isUserTypingRef.current) setPropertyMonthlyRent(Number(rentVal));
              initObj.propertyMonthlyRent = Number(rentVal);
            }
            const depVal = res.data.property.defaultDeposit !== undefined ? res.data.property.defaultDeposit : res.data.property.depositAmount;
            if (depVal !== undefined) {
              if (!isUserTypingRef.current) setPropertyDepositAmount(Number(depVal));
              initObj.propertyDeposit = Number(depVal);
            }
            if (res.data.property.defaultTerms !== undefined && !isUserTypingRef.current) {
              setPropertyDefaultTerms(res.data.property.defaultTerms || '');
            }
            if (res.data.property.petPolicy) {
              const rawPet = res.data.property.petPolicy;
              setPropertyPetPolicy(typeof rawPet === 'string' ? JSON.parse(rawPet) : rawPet);
            }
          }
          if (res.data.billing) {
            setBillingVersion(res.data.billing.version || 1);
            const waterVal = res.data.billing.waterRate !== undefined ? res.data.billing.waterRate : res.data.billing.waterUnitRate;
            if (waterVal !== undefined) {
              if (!isUserTypingRef.current) setLocalWaterUnitRate(Number(waterVal));
              initObj.waterRate = Number(waterVal);
            }
            const elecVal = res.data.billing.electricityRate !== undefined ? res.data.billing.electricityRate : res.data.billing.electricUnitRate;
            if (elecVal !== undefined) {
              if (!isUserTypingRef.current) setLocalElectricUnitRate(Number(elecVal));
              initObj.electricityRate = Number(elecVal);
            }
            if (res.data.billing.commonFee !== undefined && !isUserTypingRef.current) setLocalCommonFee(Number(res.data.billing.commonFee));
            if (res.data.billing.internetFee !== undefined && !isUserTypingRef.current) setLocalInternetFee(Number(res.data.billing.internetFee));
            if (res.data.billing.parkingFee !== undefined && !isUserTypingRef.current) setLocalParkingFee(Number(res.data.billing.parkingFee));
            if (res.data.billing.lateFeeDaily !== undefined && !isUserTypingRef.current) setLocalLateFee(Number(res.data.billing.lateFeeDaily));
            if (res.data.billing.dueDay !== undefined && !isUserTypingRef.current) setLocalDueDay(Number(res.data.billing.dueDay));

            rawDormitoryBillingRef.current = res.data.billing;
            applyComposedSettingsState();

            if (res.data.billing.commonFeeMode) setCommonFeeMode(res.data.billing.commonFeeMode);
            if (res.data.billing.internetFeeMode) setInternetFeeMode(res.data.billing.internetFeeMode);
            if (res.data.billing.parkingFeeMode) setParkingFeeMode(res.data.billing.parkingFeeMode);
            if (res.data.billing.lateFeeType) setLateFeeType(res.data.billing.lateFeeType);
          }
          setInitialValues(initObj);
        }
      }
    } catch (err) { }
  };

  const [lineOaConfig, setLineOaConfig] = useState<{
    connected: boolean;
    hasChannelSecret: boolean;
    hasAccessToken: boolean;
    lineOaId: string | null;
    channelId: string | null;
    accessTokenVerifiedAt: string | null;
    webhookVerifiedAt: string | null;
    webhookUrl: string | null;
  }>({
    connected: false,
    hasChannelSecret: false,
    hasAccessToken: false,
    lineOaId: '',
    channelId: '',
    accessTokenVerifiedAt: null,
    webhookVerifiedAt: null,
    webhookUrl: null
  });

  const [inputChannelId, setInputChannelId] = useState('');
  const [inputChannelSecret, setInputChannelSecret] = useState('');
  const [isSavingLineOa, setIsSavingLineOa] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [showLineOaModal, setShowLineOaModal] = useState(false);

  const fetchLineOaConfig = async () => {
    const dormId = localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session') || dorm?.id || '';
    if (!dormId) return;

    const res = await Task009ApiAdapter.getLineOaConfig(dormId);
    if (res.success && res.data) {
      setLineOaConfig(res.data);
      if (res.data.channelId) setInputChannelId(res.data.channelId);
    }
  };

  useEffect(() => {
    // Reset raw authorities, snapshot context authority, and durable tier state on dormitory change
    rawRateSnapshotRef.current = null;
    rawDormitoryBillingRef.current = null;
    defaultsLoadedDormIdRef.current = null;
    snapshotLoadedContextRef.current = null;
    loadedSnapshotAuthorityRef.current = null;
    setCurrentCycleId('');
    setDurableWaterTierRates(null);
    setDurableElectricTierRates(null);
    setWaterTierRates(WATER_TIER_PRESET);
    setElectricTierRates(ELECTRICITY_TIER_PRESET);
    setTierSaveError(null);
    isUserTypingRef.current = false;

    fetchDormitoryProfile();
    fetchDormitoryDefaults();
    fetchLineOaConfig();
    fetchPaymentSettings();
    if (selectedDormId) {
      fetchOwnerSignature(selectedDormId);
    }
  }, [selectedDormId]);

  useEffect(() => {
    if (selectedCycle) {
      rawRateSnapshotRef.current = null;
      snapshotLoadedContextRef.current = null;
      loadedSnapshotAuthorityRef.current = null;
      setCurrentCycleId('');
      setTierSaveError(null);
      isUserTypingRef.current = false;
      fetchCycleRateSnapshot(selectedCycle);
    }
  }, [selectedCycle, selectedDormId]);

  const handleSaveRulesAndPetPolicy = async () => {
    setIsSavingRules(true);
    setRulesSaveSuccess(null);
    try {
      const res = await DataProvider.properties.updateDormitoryDefaults({
        property: {
          changes: {
            defaultTerms: propertyDefaultTerms,
            petPolicy: propertyPetPolicy,
          },
          expectedVersion: propertyVersion,
        },
      });
      if (res.success) {
        setRulesSaveSuccess('บันทึกกฎระเบียบและนโยบายสัตว์เลี้ยงสำเร็จ');
        if (res.data?.property?.version) {
          setPropertyVersion(res.data.property.version);
        } else {
          setPropertyVersion(v => v + 1);
        }
        setTimeout(() => setRulesSaveSuccess(null), 4000);
        onAddLog('แก้ไขกฎระเบียบและนโยบายสัตว์เลี้ยง', 'อัปเดตข้อกำหนดหอพักและเงื่อนไขสัตว์เลี้ยงสำเร็จ', 'SETTINGS', selectedDormId);
      } else {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.code === 'VERSION_CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: 'กฎระเบียบและเงื่อนไขของหอพัก',
            currentVersion: (res.error as any).currentVersion || propertyVersion + 1,
            onRetry: () => fetchDormitoryDefaults(),
          });
        } else {
          alert(res.error?.message || 'บันทึกข้อมูลไม่สำเร็จ');
        }
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setIsSavingRules(false);
    }
  };

  const handleSaveOwnerSignature = async (signatureDataUrl: string) => {
    const dormId = selectedDormId || dorm?.id;
    if (!dormId) return;
    try {
      const blob = await (await fetch(signatureDataUrl)).blob();
      const formData = new FormData();
      formData.append('file', blob, 'signature.png');
      const csrfMatch = document.cookie.match(/(?:csrf-token|horplus_csrf)=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
      const res = await fetch(`/api/v1/dormitories/${dormId}/signatures`, {
        method: 'POST',
        headers: {
          'x-dormitory-id': dormId,
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'ไม่สามารถบันทึกลายเซ็นได้');
      }
      setOwnerSignatureUrl(`/api/v1/dormitories/${dormId}/signatures?t=${Date.now()}`);
      setIsSignaturePadOpen(false);
      onAddLog('บันทึกลายมือชื่อเจ้าของ', 'อัปเดตลายมือชื่อดิจิทัลของเจ้าของหอพักสำเร็จ', 'SETTINGS', dormId);
    } catch (err: any) {
      alert(err.message || 'บันทึกลายเซ็นไม่สำเร็จ');
    }
  };

  const handleSaveLineOaConfig = async () => {
    const dormId = localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session') || dorm?.id || '';
    if (!dormId) return;

    setIsSavingLineOa(true);
    const res = await Task009ApiAdapter.updateLineOaConfig(dormId, {
      channelId: inputChannelId,
      channelSecret: inputChannelSecret || undefined
    });
    setIsSavingLineOa(false);

    if (res.success && res.data) {
      setLineOaConfig(res.data);
      setInputChannelSecret('');
      onAddLog('ตั้งค่า LINE Official Account', 'อัปเดตข้อมูลเชื่อมต่อ LINE OA สำเร็จ', 'LineOA', dormId);
      alert('บันทึกการตั้งค่า LINE Official Account สำเร็จ!');
    } else {
      alert(res.error?.message || 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่า LINE OA');
    }
  };

  const handleDisconnectLineOa = async () => {
    const dormId = localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session') || dorm?.id || '';
    if (!dormId) return;

    const res = await Task009ApiAdapter.disconnectLineOa(dormId);
    if (res.success && res.data) {
      setLineOaConfig(res.data);
      onAddLog('ยกเลิกเชื่อมต่อ LINE OA', 'ยกเลิกการเชื่อมต่อ LINE Official Account', 'LineOA', dormId);
    }
  };

  const handleRotateWebhookKey = async () => {
    const dormId = localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session') || dorm?.id || '';
    if (!dormId) return;

    const res = await Task009ApiAdapter.rotateWebhookKey(dormId);
    if (res.success && res.data) {
      setLineOaConfig(res.data);
      alert('หมุนเวียน Webhook Opaque Key สำเร็จ!');
    } else {
      alert(res.error?.message || 'ไม่สามารถหมุนเวียน Webhook Key ได้');
    }
  };

  const getDirtyChanges = () => {
    const prop: Record<string, number> = {};
    const bill: Record<string, number> = {};

    const curWater = Number(localWaterUnitRate);
    const initWater = initialValues.waterRate ?? Number(dorm?.billingSettings?.waterRate || 0);
    if (!isNaN(curWater) && initialValues.waterRate !== undefined && curWater !== initWater) {
      bill.waterRate = curWater;
    }

    const curElectric = Number(localElectricUnitRate);
    const initElectric = initialValues.electricityRate ?? Number(dorm?.billingSettings?.electricityRate || 0);
    if (!isNaN(curElectric) && initialValues.electricityRate !== undefined && curElectric !== initElectric) {
      bill.electricityRate = curElectric;
    }

    const result: { property?: Record<string, number>; billing?: Record<string, number> } = {};
    if (Object.keys(prop).length > 0) result.property = prop;
    if (Object.keys(bill).length > 0) result.billing = bill;
    return result;
  };

  const dirtyChanges = getDirtyChanges();
  const hasDirtyFields = Object.keys(dirtyChanges).length > 0;

  const handleOpenPropagationPreview = async (changes: { property?: Record<string, any>; billing?: Record<string, any> }) => {
    if (!DataProvider.properties) return;
    isPropagationPreviewOpeningRef.current = true;
    setPropagationChanges(changes);
    setPreviewLoading(true);
    setIsPreviewOpen(true);
    try {
      const res = await DataProvider.properties.previewPropagation({
        scope: 'DORMITORY',
        changes
      });
      if (res.success && res.data) {
        setPreviewData(res.data);
      } else {
        alert(res.error?.message || 'ไม่สามารถพรีวิวการส่งต่อค่าได้');
        setIsPreviewOpen(false);
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการพรีวิว');
      setIsPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
      setTimeout(() => {
        isPropagationPreviewOpeningRef.current = false;
      }, 1000);
    }
  };

  const [applyResultState, setApplyResultState] = useState<any>(null);

  const handleConfirmPropagation = async () => {
    if (!DataProvider.properties) return;
    setPreviewLoading(true);
    try {
      const res = await DataProvider.properties.applyPropagation({
        scope: 'DORMITORY',
        changes: propagationChanges,
        expectedVersions: {
          property: propertyVersion,
          billing: billingVersion,
        },
        idempotencyKey: `idem-${Date.now()}`
      });
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: 'การส่งต่อค่าเริ่มต้น (Propagation)',
            currentVersion: (res.error?.details as any)?.currentVersion || Math.max(propertyVersion, billingVersion) + 1
          });
          setIsPreviewOpen(false);
          return;
        }
        throw new Error(res.error?.message || 'Failed to apply propagation');
      }
      onAddLog('ส่งต่อค่าเริ่มต้น', `ส่งต่อค่าไปยังห้องพักเรียบร้อยแล้ว`, 'Dormitory', dorm.id);
      setIsPreviewOpen(false);
      setApplyResultState(res.data?.data || res.data);
      await fetchDormitoryDefaults();
      onRefreshData();
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการส่งต่อค่า');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSaveBackendDormitoryDefaults = async (
    propChanges?: Record<string, any>,
    billingChanges?: Record<string, any>
  ) => {
    if (!DataProvider.properties || isPropagationPreviewOpeningRef.current || isPreviewOpen) return;
    setSaveStatus('saving');
    try {
      const payload: any = {};
      if (propChanges && Object.keys(propChanges).length > 0) {
        payload.property = {
          changes: propChanges,
          expectedVersion: propertyVersion
        };
      }
      if (billingChanges && Object.keys(billingChanges).length > 0) {
        payload.billing = {
          changes: billingChanges,
          expectedVersion: billingVersion
        };
      }

      if (Object.keys(payload).length === 0) {
        setSaveStatus('idle');
        return;
      }

      const res = await DataProvider.properties.updateDormitoryDefaults(payload);
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          const conflictVer = (res.error?.details as any)?.currentVersion || Math.max(propertyVersion, billingVersion) + 1;
          setVersionConflictState({
            isOpen: true,
            entityName: 'การตั้งค่าหอพัก (Dormitory Defaults)',
            currentVersion: conflictVer,
            onRetry: () => fetchDormitoryDefaults()
          });
          setSaveStatus('idle');
          return;
        }
        throw new Error(res.error?.message || 'Failed to update dormitory defaults');
      }

      isUserTypingRef.current = false;
      await fetchDormitoryDefaults();
      setSaveStatus('saved');
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);

      const dormId = selectedDormId || dorm?.id;
      if (dormId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.billingCycles(dormId) });
        queryClient.invalidateQueries({ queryKey: ['meter', dormId] });
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.buildings(dormId) });
      }
    } catch (err: any) {
      console.error('Error saving backend dormitory defaults:', err);
      setSaveStatus('idle');
    }
  };

  const minCycle = '2026-01'; // Oldest month of system usage

  const getMaxCycle = () => {
    const today = new Date();
    let y = today.getFullYear();
    let m = today.getMonth() + 1; // 1-indexed month

    // Allow up to current month + 1 month
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${y}-${mStr}`;
  };

  const maxCycle = getMaxCycle();

  // 'idle' | 'typing' | 'saving' | 'saved'
  const [saveStatus, setSaveStatus] = useState<'idle' | 'typing' | 'saving' | 'saved'>('idle');

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Local input states to avoid saving aggressively on every keystroke
  const [localName, setLocalName] = useState(dorm.name);
  const [localTaxId, setLocalTaxId] = useState(dorm.taxId || '');
  const [localPhone, setLocalPhone] = useState(dorm.phone || '');
  const [localPromptPay, setLocalPromptPay] = useState('');
  const [localPromptPayName, setLocalPromptPayName] = useState('');
  const [localAddress, setLocalAddress] = useState(dorm.address || '');
  const [localBankName, setLocalBankName] = useState('');
  const [localBankAccountNumber, setLocalBankAccountNumber] = useState('');
  const [localBankAccountName, setLocalBankAccountName] = useState('');
  const [paymentSaveError, setPaymentSaveError] = useState<string | null>(null);

  // Server state for profile change detection
  const [serverProfile, setServerProfile] = useState<{
    name: string;
    addressLine1: string;
    phone: string;
  }>({
    name: dorm.name || '',
    addressLine1: dorm.address || '',
    phone: dorm.phone || '',
  });

  // Server state for payment settings change detection
  const [serverPayment, setServerPayment] = useState<{
    promptPayMask: string;
    promptPayAccountName: string;
    bankAccountMask: string;
    bankCode: string;
    bankAccountName: string;
    promptPayType: 'mobile_phone' | 'national_id' | null;
  }>({
    promptPayMask: '',
    promptPayAccountName: '',
    bankAccountMask: '',
    bankCode: '',
    bankAccountName: '',
    promptPayType: null,
  });

  const fetchDormitoryProfile = async () => {
    if (!selectedDormId) return;
    try {
      const profile = await getDormitoryProfile(selectedDormId);
      if (profile) {
        setLocalName(profile.name || '');
        setLocalAddress(profile.addressLine1 || '');
        setLocalPhone(formatPhone(profile.phone || ''));
        setServerProfile({
          name: profile.name || '',
          addressLine1: profile.addressLine1 || '',
          phone: profile.phone || '',
        });
      }
    } catch (err: any) {
      console.error('Failed to fetch dormitory profile:', err);
    }
  };

  const fetchPaymentSettings = async () => {
    if (!selectedDormId) return;
    try {
      const settings = await getPaymentSettings(selectedDormId);
      if (settings) {
        const maskPP = settings.maskedPromptPayValue || '';
        const ppName = settings.promptPayAccountName || '';
        const maskAcc = settings.maskedBankAccountNumber || '';
        const bCode = settings.bankCode || '';
        const bName = settings.bankAccountName || '';

        setLocalPromptPay(maskPP);
        setLocalPromptPayName(ppName);
        setLocalBankName(bCode);
        setLocalBankAccountNumber(maskAcc);
        setLocalBankAccountName(bName);

        setServerPayment({
          promptPayMask: maskPP,
          promptPayAccountName: ppName,
          bankAccountMask: maskAcc,
          bankCode: bCode,
          bankAccountName: bName,
          promptPayType: settings.promptPayType || null,
        });
      }
    } catch (err: any) {
      console.error('Failed to fetch payment settings:', err);
    }
  };

  // Synchronize with external selected cycle from parent header
  useEffect(() => {
    if (propSelectedCycle) {
      setSelectedCycle(propSelectedCycle);
      const [year] = propSelectedCycle.split('-');
      setTempYear(parseInt(year) || 2026);
    }
  }, [propSelectedCycle]);



  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Authoritative REST API Profile Blur Handler
  const handleProfileBlur = async (field: 'name' | 'addressLine1' | 'phone', value: string) => {
    if (!selectedDormId) return;
    const rawVal = value.trim();
    const currentServerVal = field === 'phone' ? serverProfile.phone.replace(/\D/g, '') : serverProfile[field];
    const compareVal = field === 'phone' ? rawVal.replace(/\D/g, '') : rawVal;

    if (currentServerVal === compareVal) {
      setSaveStatus('idle');
      return;
    }

    const payload: UpdateDormitoryProfilePayload = {};
    if (field === 'name') payload.name = rawVal;
    if (field === 'addressLine1') payload.addressLine1 = rawVal;
    if (field === 'phone') payload.phone = rawVal.replace(/\D/g, '');

    setSaveStatus('saving');
    try {
      const updated = await updateDormitoryProfile(selectedDormId, payload);
      setLocalName(updated.name || '');
      setLocalAddress(updated.addressLine1 || '');
      setLocalPhone(formatPhone(updated.phone || ''));
      setServerProfile({
        name: updated.name || '',
        addressLine1: updated.addressLine1 || '',
        phone: updated.phone || '',
      });
      setSaveStatus('saved');
      onRefreshData();
    } catch (err: any) {
      console.error('Failed to update dormitory profile:', err);
      setSaveStatus('idle');
    }
  };

  // Authoritative REST API Payment Settings Blur Handler (Sends ONLY materially changed fields)
  const handlePaymentSettingsBlur = async (overrides?: Partial<{
    bankCode: string;
    bankAccountName: string;
    bankAccountNumber: string;
    promptPayValue: string;
    promptPayAccountName: string;
  }>) => {
    if (!selectedDormId) return;

    const currentPromptPay = overrides?.promptPayValue !== undefined ? overrides.promptPayValue : localPromptPay;
    const currentPromptPayName = overrides?.promptPayAccountName !== undefined ? overrides.promptPayAccountName : localPromptPayName;
    const currentBankCode = overrides?.bankCode !== undefined ? overrides.bankCode : localBankName;
    const currentBankAccountNumber = overrides?.bankAccountNumber !== undefined ? overrides.bankAccountNumber : localBankAccountNumber;
    const currentBankAccountName = overrides?.bankAccountName !== undefined ? overrides.bankAccountName : localBankAccountName;

    const payload: PaymentSettingsUpdatePayload = {};

    // 1. PromptPay changes: Only send promptPayValue + promptPayType if user typed a NEW unmasked number (no 'X')
    if (currentPromptPay !== serverPayment.promptPayMask) {
      if (currentPromptPay.trim() === '') {
        payload.promptPayValue = null;
        payload.promptPayType = null;
      } else if (!currentPromptPay.includes('X')) {
        const digits = currentPromptPay.replace(/\D/g, '');
        const detectedType: 'mobile_phone' | 'national_id' = digits.length === 13 ? 'national_id' : 'mobile_phone';
        payload.promptPayValue = currentPromptPay;
        payload.promptPayType = detectedType;
      }
    }

    // 1.1 PromptPay Account Name changes:
    if (currentPromptPayName !== serverPayment.promptPayAccountName) {
      payload.promptPayAccountName = currentPromptPayName || null;
    }

    // 2. Bank Code changes:
    if (currentBankCode !== serverPayment.bankCode) {
      payload.bankCode = currentBankCode || null;
    }

    // 3. Bank Account Name changes:
    if (currentBankAccountName !== serverPayment.bankAccountName) {
      payload.bankAccountName = currentBankAccountName || null;
    }

    // 4. Bank Account Number changes:
    if (currentBankAccountNumber !== serverPayment.bankAccountMask) {
      if (currentBankAccountNumber.trim() === '') {
        payload.bankAccountNumber = null;
      } else if (!currentBankAccountNumber.includes('X')) {
        payload.bankAccountNumber = currentBankAccountNumber;
      }
    }

    // Do not send empty PATCH if nothing changed
    if (Object.keys(payload).length === 0) {
      setSaveStatus('idle');
      return;
    }

    setSaveStatus('saving');
    setPaymentSaveError(null);
    try {
      const updated = await updatePaymentSettings(selectedDormId, payload);
      const maskPP = updated.maskedPromptPayValue || '';
      const ppName = updated.promptPayAccountName || '';
      const maskAcc = updated.maskedBankAccountNumber || '';
      const bCode = updated.bankCode || '';
      const bName = updated.bankAccountName || '';

      setLocalPromptPay(maskPP);
      setLocalPromptPayName(ppName);
      setLocalBankName(bCode);
      setLocalBankAccountNumber(maskAcc);
      setLocalBankAccountName(bName);

      setServerPayment({
        promptPayMask: maskPP,
        promptPayAccountName: ppName,
        bankAccountMask: maskAcc,
        bankCode: bCode,
        bankAccountName: bName,
        promptPayType: updated.promptPayType || null,
      });

      setSaveStatus('saved');
    } catch (err: any) {
      console.error('Payment settings save failed:', err);
      setSaveStatus('idle');
      setPaymentSaveError(err?.message || 'ไม่สามารถบันทึกข้อมูลการชำระเงินได้');
    }
  };

  const handleRateBlur = (field: string, value: any) => {
    const num = Number(value);
    if (isNaN(num)) return;
    handleSaveBackendDormitoryDefaults(undefined, { [field]: num });
  };

  const handleRateSelectChange = (field: string, value: any) => {
    handleSaveBackendDormitoryDefaults(undefined, { [field]: value });
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
    <div className="space-y-6">

      <div className="max-w-7xl mx-auto animate-in fade-in duration-300">
        {/* Unified elegant card: No border on mobile, border on desktop. Symmetrical heights & grid divided nicely */}
        <div className="bg-white rounded-3xl border-0 sm:border sm:border-slate-100 shadow-xs sm:shadow-sm p-6 sm:p-8">
          <div className="grid lg:grid-cols-2 gap-y-0 gap-x-0">

            {/* Column 1: ข้อมูลหอพักและจุดรับสแกนจ่ายเงิน */}
            <div className="space-y-5 pb-8 border-b border-slate-100 lg:border-b-0 lg:border-r lg:border-slate-100 lg:pb-0 lg:pr-10">
              <h4 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider justify-center lg:justify-start text-center lg:text-left">
                <Building className="w-4 h-4 text-indigo-600" />
                ข้อมูลเจ้าของหอพัก
              </h4>

              {/* ข้อมูลบัญชีและผู้รับเงิน */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* ชื่อหอพัก */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">ชื่อหอพัก *</label>
                  <input
                    type="text"
                    required
                    data-testid="dormitory-name-input"
                    value={localName}
                    onChange={(e) => {
                      setLocalName(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleProfileBlur('name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* เบอร์ติดต่อโทร */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">เบอร์ติดต่อโทร *</label>
                  <input
                    type="text"
                    required
                    data-testid="dormitory-phone-input"
                    value={localPhone}
                    placeholder="0XX-XXX-XXXX"
                    onChange={(e) => {
                      setLocalPhone(formatPhone(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleProfileBlur('phone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* เลขประจำตัวผู้เสียภาษี */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">
                    เลขประจำตัวผู้เสียภาษี <span className="text-[10px] text-amber-600 font-normal">(ยังไม่รองรับการแก้ไขออนไลน์)</span>
                  </label>
                  <input
                    type="text"
                    disabled
                    value={localTaxId}
                    placeholder="X-XXXX-XXXXX-XX-X"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-slate-50 text-slate-500 font-bold outline-none cursor-not-allowed text-xs"
                  />
                </div>

                {/* เลขพร้อมเพย์ (เบอร์ / บัตรปชช.) */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">เลขพร้อมเพย์ (เบอร์ / บัตรปชช.) *</label>
                  <input
                    type="text"
                    required
                    data-testid="promptpay-input"
                    value={localPromptPay}
                    onChange={(e) => {
                      setLocalPromptPay(formatPromptPay(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={() => handlePaymentSettingsBlur({ promptPayValue: localPromptPay })}
                    placeholder="เลขบัตรปชช. / เบอร์โทร"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold text-indigo-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* ชื่อบัญชีพร้อมเพย์ */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">ชื่อบัญชีพร้อมเพย์</label>
                  <input
                    type="text"
                    data-testid="promptpay-name-input"
                    value={localPromptPayName}
                    onChange={(e) => {
                      setLocalPromptPayName(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={() => handlePaymentSettingsBlur({ promptPayAccountName: localPromptPayName })}
                    placeholder="ชื่อบัญชีพร้อมเพย์ผู้รับเงิน"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* ธนาคาร */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">ธนาคาร *</label>
                  <select
                    value={localBankName}
                    data-testid="bank-code-select"
                    onChange={(e) => {
                      const newBank = e.target.value;
                      setLocalBankName(newBank);
                      handlePaymentSettingsBlur({ bankCode: newBank });
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  >
                    <option value="">-- เลือกธนาคาร --</option>
                    {[
                      'กรุงไทย (Krungthai)',
                      'กสิกรไทย (KBank)',
                      'กรุงเทพ (Bangkok)',
                      'ไทยพาณิชย์ (SCB)',
                      'กรุงศรีอยุธยา (Krungsri)',
                      'ทหารไทยธนชาต (ttb)',
                      'ยูโอบี (UOB)',
                      'ซีไอเอ็มบี ไทย (CIMB Thai)',
                      'แลนด์ แอนด์ เฮ้าส์ (LH Bank)',
                      'เกียรตินาคินภัทร (KKP)',
                      'ทิสโก้ (TISCO)',
                      'ไอซีบีซี (ICBC Thai)',
                      'ออมสิน (GSBk)',
                      'ธ.ก.ส. (BAAC)',
                      'ธอส. (GH Bank)',
                      'อิสลามแห่งประเทศไทย (IBANK)'
                    ].map((bank) => (
                      <option key={bank} value={bank}>
                        {bank}
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
                    data-testid="bank-account-number-input"
                    value={localBankAccountNumber}
                    disabled={!localBankName}
                    placeholder={localBankName ? "XXX-X-XXXXX-X" : "กรุณาเลือกธนาคารก่อน"}
                    onChange={(e) => {
                      setLocalBankAccountNumber(formatBankAccount(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={() => handlePaymentSettingsBlur({ bankAccountNumber: localBankAccountNumber })}
                    className={`w-full px-3 py-2 border border-gray-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs ${!localBankName ? 'opacity-50 bg-slate-50 cursor-not-allowed' : 'bg-white'
                      }`}
                  />
                </div>

                {/* ชื่อบัญชีธนาคาร */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">ชื่อบัญชีธนาคาร *</label>
                  <input
                    type="text"
                    required
                    data-testid="bank-account-name-input"
                    value={localBankAccountName}
                    placeholder="ชื่อบัญชีธนาคารผู้รับเงิน"
                    onChange={(e) => {
                      setLocalBankAccountName(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={() => handlePaymentSettingsBlur({ bankAccountName: localBankAccountName })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {paymentSaveError && (
                  <div data-testid="payment-save-error" className="p-2 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold">
                    {paymentSaveError}
                  </div>
                )}
              </div>

              <div className="space-y-1 text-xs">
                <label className="block font-semibold text-slate-700 text-center lg:text-left">ที่อยู่หอพัก</label>
                <textarea
                  required
                  value={localAddress}
                  onChange={(e) => {
                    setLocalAddress(e.target.value);
                    setSaveStatus('typing');
                  }}
                  onBlur={(e) => handleProfileBlur('addressLine1', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 h-20 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                />
              </div>

              {/* STEP 5: กฎระเบียบ, นโยบายสัตว์เลี้ยง, และลายมือชื่อเจ้าของหอพัก */}
              <div className="space-y-4 pt-4 border-t border-slate-100 text-xs">
                {/* 1. Owner Digital Signature */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-slate-800 flex items-center gap-1.5">
                      <PenTool className="w-4 h-4 text-indigo-600 shrink-0" />
                      ลายมือชื่อเจ้าของหอพัก (Digital Signature)
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsSignaturePadOpen(true)}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg transition-colors cursor-pointer text-[11px]"
                    >
                      {ownerSignatureUrl ? 'เปลี่ยนลายเซ็น' : '+ ลงลายมือชื่อ'}
                    </button>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center min-h-[70px]">
                    {ownerSignatureUrl ? (
                      <img
                        src={ownerSignatureUrl}
                        alt="Owner Signature"
                        className="max-h-16 object-contain"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs font-medium">ยังไม่มีลายมือชื่อเจ้าของหอพักในระบบ</span>
                    )}
                  </div>
                </div>

                {/* 2. Pet Policy */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="block font-bold text-slate-800 flex items-center gap-1.5">
                    🐾 นโยบายสัตว์เลี้ยง (Pet Policy)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label
                      onClick={() => setPropertyPetPolicy(prev => ({ ...prev, allowed: 'none' }))}
                      className={`p-2.5 rounded-xl border-2 cursor-pointer flex items-center gap-2 transition-all ${propertyPetPolicy.allowed === 'none'
                          ? 'border-indigo-600 bg-indigo-50/50 font-bold text-indigo-950'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                    >
                      <input
                        type="radio"
                        name="pet_policy_settings"
                        checked={propertyPetPolicy.allowed === 'none'}
                        onChange={() => { }}
                        className="w-3.5 h-3.5 text-indigo-600"
                      />
                      <span>ไม่อนุญาตเลี้ยงสัตว์</span>
                    </label>

                    <label
                      onClick={() => setPropertyPetPolicy(prev => ({ ...prev, allowed: 'conditional' }))}
                      className={`p-2.5 rounded-xl border-2 cursor-pointer flex items-center gap-2 transition-all ${propertyPetPolicy.allowed === 'conditional'
                          ? 'border-indigo-600 bg-indigo-50/50 font-bold text-indigo-950'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                    >
                      <input
                        type="radio"
                        name="pet_policy_settings"
                        checked={propertyPetPolicy.allowed === 'conditional'}
                        onChange={() => { }}
                        className="w-3.5 h-3.5 text-indigo-600"
                      />
                      <span>อนุญาตแบบมีเงื่อนไข</span>
                    </label>
                  </div>

                  {propertyPetPolicy.allowed === 'conditional' && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 mt-1 animate-in fade-in duration-150">
                      <span className="text-[11px] font-bold text-slate-700 block">ประเภทสัตว์เลี้ยงที่อนุญาต:</span>
                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        {[
                          { id: 'dog', label: 'สุนัข (Dog)' },
                          { id: 'cat', label: 'แมว (Cat)' },
                          { id: 'small_pet', label: 'สัตว์เล็ก (กระต่าย/หนู/นก)' },
                          { id: 'other', label: 'สัตว์แปลก (other)' },
                        ].map(type => {
                          const isChecked = (propertyPetPolicy.allowedTypes || []).includes(type.id);
                          return (
                            <label key={type.id} className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  const currentTypes = propertyPetPolicy.allowedTypes || [];
                                  const updated = e.target.checked
                                    ? [...currentTypes, type.id]
                                    : currentTypes.filter(t => t !== type.id);
                                  setPropertyPetPolicy(prev => ({ ...prev, allowedTypes: updated }));
                                }}
                                className="rounded text-indigo-600 w-3.5 h-3.5"
                              />
                              <span>{type.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Dormitory Rules & Terms */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-slate-800">
                      📜 กฎระเบียบและข้อกำหนดของหอพัก (Rules & Terms)
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">เวอร์ชัน: v{propertyVersion}</span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {[
                      'ห้ามส่งเสียงดังหลัง 22:00 น.',
                      'ห้ามสูบบุหรี่ในห้องพักและอาคาร',
                      'ห้ามดัดแปลงห้องพักโดยไม่ได้รับอนุญาต',
                      'ชำระค่าเช่าภายในกำหนดทุกเดือน',
                    ].map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setPropertyDefaultTerms(prev => {
                            const trimmed = (prev || '').trim();
                            return trimmed ? `${trimmed}\n- ${preset}` : `- ${preset}`;
                          });
                        }}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-[10px] transition-colors"
                      >
                        + {preset.slice(0, 20)}...
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={4}
                    value={propertyDefaultTerms}
                    onChange={(e) => setPropertyDefaultTerms(e.target.value)}
                    placeholder="ระบุข้อกำหนด กฎระเบียบ และเงื่อนไขการพักอาศัย..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 text-xs font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleSaveRulesAndPetPolicy}
                      disabled={isSavingRules}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingRules ? 'กำลังบันทึก...' : 'บันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง'}
                    </button>

                    {rulesSaveSuccess && (
                      <span className="text-xs font-bold text-emerald-600 animate-in fade-in">
                        ✓ {rulesSaveSuccess}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* LINE Official Account Connection Card (Clean Summary & CTA) */}
              <div className="pt-6 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-extrabold text-slate-900 flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
                    LINE Official Account (LINE OA)
                  </h5>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${lineOaConfig.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                    }`}>
                    {lineOaConfig.connected ? '● เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
                  </span>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">
                        {lineOaConfig.connected
                          ? (lineOaConfig.lineOaId ? `LINE Basic ID: ${lineOaConfig.lineOaId}` : 'เชื่อมต่อ Messaging API เรียบร้อย')
                          : 'ยังไม่ได้เชื่อมต่อ LINE OA'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {lineOaConfig.connected
                          ? 'ระบบเปิดใช้งานการส่งการแจ้งเตือนอัตโนมัติแล้ว'
                          : 'ตั้งค่า Channel ID & Secret เพื่อเปิดใช้งานการแจ้งเตือน'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowLineOaModal(true)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0 shadow-sm"
                    >
                      จัดการ LINE OA
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">LINE Channel ID</label>
                      <input
                        type="text"
                        data-testid="line-channel-id-input"
                        value={inputChannelId}
                        onChange={(e) => setInputChannelId(e.target.value)}
                        placeholder="1657XXXXXX"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">LINE Channel Secret</label>
                      <input
                        type="password"
                        data-testid="line-channel-secret-input"
                        value={inputChannelSecret}
                        onChange={(e) => setInputChannelSecret(e.target.value)}
                        placeholder={lineOaConfig.hasChannelSecret ? '••••••••••••••••' : 'Channel Secret'}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-indigo-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      data-testid="save-line-oa-button"
                      onClick={handleSaveLineOaConfig}
                      disabled={isSavingLineOa}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      {isSavingLineOa ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า LINE OA'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: การตั้งค่าอัตราส่วนต่างและการคำนวณ */}
            <div className="space-y-5 pt-8 lg:pt-0 lg:pl-10 relative">
              {/* Heading with integrated, clean Cycle selector (same line on PC, centered below title on Mobile) */}
              <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pb-3 border-b border-gray-100">
                <div>
                  <h4 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider text-center sm:text-left">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    การตั้งค่าอัตราค่าบริการตามรอบบิล
                  </h4>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-slate-500 font-bold">ที่มาของอัตรา:</span>
                    <span
                      data-testid="snapshot-provenance-badge"
                      className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        snapshotProvenance === 'MANUAL_OVERRIDE'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : snapshotProvenance === 'INHERITED'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      {snapshotProvenance === 'MANUAL_OVERRIDE'
                        ? 'กำหนดเองในงวดนี้ (Manual Override)'
                        : snapshotProvenance === 'INHERITED'
                        ? 'สืบทอดจากงวดก่อนหน้า (Inherited)'
                        : 'แม่แบบเริ่มต้นหอพัก (Template Default)'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <span className="text-[10px] font-extrabold text-slate-400 flex items-center gap-1 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    รอบงวดการคำนวณ
                  </span>

                  {/* Styled Cycle switcher with drop-modal */}
                  <div className="relative">
                    <button
                      onClick={() => setIsCycleModalOpen(true)}
                      className="flex items-center justify-between gap-2 px-3.5 py-1.5 border border-slate-200 hover:border-indigo-500 rounded-xl bg-white text-slate-800 font-extrabold shadow-2xs text-xs cursor-pointer transition-all w-48 sm:w-auto sm:min-w-[190px] whitespace-nowrap"
                      data-testid="button-cycle-calendar-settings"
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
                      availableCycles={authoritativeCycles}
                      onSelectCycle={(targetCycle) => {
                        sessionStorage.setItem('settings_selected_cycle', targetCycle);
                        setSelectedCycle(targetCycle);
                        if (onCycleChange) {
                          onCycleChange(targetCycle);
                        }
                      }}
                      align="right"
                    />
                  </div>
                </div>
              </div>

              {/* Cycle Locked Warning Banner */}
              {isCycleLocked && (
                <div
                  className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-start gap-2.5 text-amber-900"
                  data-testid="cycle-locked-banner"
                >
                  <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-black">รอบบิลนี้ถูกล็อคแล้ว (อ่านอย่างเดียว)</p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {cycleLockReason || 'งวดนี้มีรายการชำระเงินแล้ว จึงไม่สามารถแก้ไขค่าที่มีผลต่อบิลย้อนหลังได้'}
                    </p>
                  </div>
                </div>
              )}


              {/* Water Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <Droplet className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    อัตราค่าน้ำ (บาท) *
                  </label>
                  <input
                    type={waterBillingMode === 'tiered' ? 'text' : 'number'}
                    required={waterBillingMode !== 'tiered'}
                    disabled={isCycleLocked || waterBillingMode === 'tiered'}
                    value={waterBillingMode === 'tiered' ? 'คิดตามขั้นบันได' : localWaterUnitRate}
                    onChange={(e) => {
                      if (waterBillingMode === 'tiered') return;
                      isUserTypingRef.current = true;
                      setLocalWaterUnitRate(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => {
                      if (waterBillingMode === 'tiered') return;
                      handleSaveCycleRateSettings({ waterRate: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (waterBillingMode === 'tiered') return;
                      if (e.key === 'Enter') {
                        handleSaveCycleRateSettings({ waterRate: (e.target as HTMLInputElement).value });
                      }
                    }}
                    className={`w-full px-3 py-2 border border-gray-200 rounded-xl font-bold outline-none transition-all text-xs ${
                      waterBillingMode === 'tiered'
                        ? 'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 cursor-not-allowed border-dashed'
                        : 'bg-white text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-100'
                    }`}
                    data-testid="input-water-unit-rate"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าน้ำประปา</label>
                  <select
                    value={waterBillingMode}
                    disabled={isCycleLocked}
                    onChange={(e) => {
                      const newMode = toCanonicalMode(e.target.value, 'water');
                      setWaterBillingMode(newMode);
                      if (newMode === 'tiered') {
                        if (durableWaterTierRates && durableWaterTierRates.length > 0) {
                          setWaterTierRates(durableWaterTierRates);
                        } else {
                          setWaterTierRates(WATER_TIER_PRESET);
                        }
                      } else {
                        handleSaveCycleRateSettings({ waterBillingType: newMode });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                    data-testid="select-water-billing-mode"
                  >
                    <option value="per_unit">บาท/หน่วย</option>
                    <option value="per_person">บาท/คน</option>
                    <option value="tiered">คิดตามขั้นบันได (Tiered)</option>
                  </select>
                </div>
              </div>

              {/* Electric Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    อัตราค่าไฟฟ้า (บาท) *
                  </label>
                  <input
                    type={electricBillingMode === 'tiered' ? 'text' : 'number'}
                    required={electricBillingMode !== 'tiered'}
                    disabled={isCycleLocked || electricBillingMode === 'tiered'}
                    value={electricBillingMode === 'tiered' ? 'คิดตามขั้นบันได' : localElectricUnitRate}
                    onChange={(e) => {
                      if (electricBillingMode === 'tiered') return;
                      isUserTypingRef.current = true;
                      setLocalElectricUnitRate(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => {
                      if (electricBillingMode === 'tiered') return;
                      handleSaveCycleRateSettings({ electricityRate: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (electricBillingMode === 'tiered') return;
                      if (e.key === 'Enter') {
                        handleSaveCycleRateSettings({ electricityRate: (e.target as HTMLInputElement).value });
                      }
                    }}
                    className={`w-full px-3 py-2 border border-gray-200 rounded-xl font-bold outline-none transition-all text-xs ${
                      electricBillingMode === 'tiered'
                        ? 'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 cursor-not-allowed border-dashed'
                        : 'bg-white text-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-slate-100'
                    }`}
                    data-testid="input-electric-unit-rate"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าไฟฟ้า</label>
                  <select
                    value={electricBillingMode}
                    disabled={isCycleLocked}
                    onChange={(e) => {
                      const newMode = toCanonicalMode(e.target.value, 'electricity');
                      setElectricBillingMode(newMode);
                      if (newMode === 'tiered') {
                        if (durableElectricTierRates && durableElectricTierRates.length > 0) {
                          setElectricTierRates(durableElectricTierRates);
                        } else {
                          setElectricTierRates(ELECTRICITY_TIER_PRESET);
                        }
                      } else {
                        handleSaveCycleRateSettings({ electricityBillingType: newMode });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                    data-testid="select-electric-billing-mode"
                  >
                    <option value="per_unit">บาท/หน่วย</option>
                    <option value="per_person">บาท/คน</option>
                    <option value="tiered">คิดตามขั้นบันได (Tiered)</option>
                  </select>
                </div>
              </div>

              {/* Tier Save Error Banner */}
              {tierSaveError && (waterBillingMode === 'tiered' || electricBillingMode === 'tiered') && (
                <div
                  className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-2xl p-3 flex items-start gap-2.5 text-rose-800 dark:text-rose-200 text-xs"
                  data-testid="tier-save-error"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">ข้อผิดพลาดในการบันทึกอัตราขั้นบันได</p>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-0.5">{tierSaveError}</p>
                  </div>
                </div>
              )}

              {/* Tiered Rate Editors (Responsive 2-column on desktop / stacked on mobile) */}
              {(waterBillingMode === 'tiered' || electricBillingMode === 'tiered') && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1 pb-2">
                  {waterBillingMode === 'tiered' && (
                    <TieredRateEditor
                      utilityType="water"
                      tiers={waterTierRates}
                      onChange={setWaterTierRates}
                      onSave={(tiers) => handleSaveTierSettings('water', tiers)}
                      disabled={isCycleLocked}
                      isSaving={saveStatus === 'saving'}
                    />
                  )}
                  {electricBillingMode === 'tiered' && (
                    <TieredRateEditor
                      utilityType="electricity"
                      tiers={electricTierRates}
                      onChange={setElectricTierRates}
                      onSave={(tiers) => handleSaveTierSettings('electricity', tiers)}
                      disabled={isCycleLocked}
                      isSaving={saveStatus === 'saving'}
                    />
                  )}
                </div>
              )}

              {/* Common Fee Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ค่าส่วนกลาง (บาท) *
                  </label>
                  <input
                    type="number"
                    required
                    disabled={isCycleLocked || commonFeeMode === 'free'}
                    value={commonFeeMode === 'free' ? '0' : localCommonFee}
                    onChange={(e) => {
                      isUserTypingRef.current = true;
                      setLocalCommonFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleSaveCycleRateSettings({ commonFee: e.target.value })}
                    placeholder={commonFeeMode === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                    data-testid="input-common-fee"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าส่วนกลาง</label>
                  <select
                    value={commonFeeMode}
                    disabled={isCycleLocked}
                    onChange={(e) => {
                      const newMode = toCanonicalMode(e.target.value, 'common');
                      setCommonFeeMode(newMode);
                      if (newMode === 'free') setLocalCommonFee('0.00');
                      handleSaveCycleRateSettings({ commonFeeMode: newMode, commonFee: newMode === 'free' ? '0.00' : localCommonFee });
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100 cursor-pointer"
                    data-testid="select-common-fee-mode"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="per_room">บาท/ห้อง</option>
                    <option value="per_person">บาท/คน</option>
                  </select>
                </div>
              </div>

              {/* Internet Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-indigo-500" />
                    ค่าอินเทอร์เน็ต (บาท) *
                  </label>
                  <input
                    type="number"
                    required
                    disabled={isCycleLocked || internetFeeMode === 'free'}
                    value={internetFeeMode === 'free' ? '0' : localInternetFee}
                    onChange={(e) => {
                      isUserTypingRef.current = true;
                      setLocalInternetFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleSaveCycleRateSettings({ internetFee: e.target.value })}
                    placeholder={internetFeeMode === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                    data-testid="input-internet-fee"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าอินเทอร์เน็ต</label>
                  <select
                    value={internetFeeMode}
                    disabled={isCycleLocked}
                    onChange={(e) => {
                      const newMode = toCanonicalMode(e.target.value, 'internet');
                      setInternetFeeMode(newMode);
                      if (newMode === 'free') setLocalInternetFee('0.00');
                      handleSaveCycleRateSettings({ internetFeeMode: newMode, internetFee: newMode === 'free' ? '0.00' : localInternetFee });
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100 cursor-pointer"
                    data-testid="select-internet-fee-mode"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="per_room">บาท/ห้อง</option>
                    <option value="per_person">บาท/คน</option>
                  </select>
                </div>
              </div>

              {/* Parking Fee Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-purple-500" />
                    ค่าจอดรถ (บาท) *
                  </label>
                  <input
                    type="number"
                    required
                    disabled={isCycleLocked || parkingFeeMode === 'free'}
                    value={parkingFeeMode === 'free' ? '0' : localParkingFee}
                    onChange={(e) => {
                      isUserTypingRef.current = true;
                      setLocalParkingFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleSaveCycleRateSettings({ parkingFee: e.target.value })}
                    placeholder={parkingFeeMode === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                    data-testid="input-parking-fee"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าจอดรถ</label>
                  <select
                    value={parkingFeeMode || 'per_room'}
                    disabled={isCycleLocked}
                    onChange={(e) => {
                      const newMode = toCanonicalMode(e.target.value, 'parking');
                      setParkingFeeMode(newMode);
                      if (newMode === 'free') setLocalParkingFee('0.00');
                      handleSaveCycleRateSettings({ parkingFeeMode: newMode, parkingFee: newMode === 'free' ? '0.00' : localParkingFee });
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100 cursor-pointer"
                    data-testid="select-parking-fee-mode"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="per_room">บาท/ห้อง</option>
                    <option value="per_person">บาท/คน</option>
                    <option value="per_vehicle">บาท/คัน</option>
                  </select>
                </div>
              </div>

              {/* Collapsible Payment & Overdue Penalty Settings Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => setIsLateFeeSectionExpanded(prev => !prev)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-100/80 transition-colors cursor-pointer"
                  data-testid="toggle-late-fee-section"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="text-xs font-black text-slate-800">
                      กำหนดชำระและค่าปรับเกินกำหนด
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isLateFeeSectionExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isLateFeeSectionExpanded && (
                  <div className="p-4 pt-2 border-t border-slate-200/60 space-y-3.5 animate-in fade-in duration-150">
                    {/* 1. วันครบกำหนดชำระของทุกเดือน */}
                    <div className="space-y-1 text-xs">
                      <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        วันครบกำหนดชำระของทุกเดือน (วันที่ 1 - 28) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        required
                        value={localDueDay}
                        onChange={(e) => {
                          isUserTypingRef.current = true;
                          setLocalDueDay(Number(e.target.value));
                          setSaveStatus('typing');
                        }}
                        onBlur={(e) => {
                          const val = Math.max(1, Math.min(28, Number(e.target.value) || 5));
                          setLocalDueDay(val);
                          handleSaveBackendDormitoryDefaults(undefined, { dueDay: val });
                        }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                        data-testid="input-due-day"
                      />
                    </div>

                    {/* 2. รูปแบบค่าปรับเกินกำหนด */}
                    <div className="space-y-1 text-xs">
                      <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        รูปแบบค่าปรับเกินกำหนด
                      </label>
                      <select
                        value={lateFeeType || 'none'}
                        disabled={isCycleLocked}
                        onChange={(e) => {
                          const newType = toCanonicalMode(e.target.value, 'late');
                          setLateFeeType(newType);
                          if (newType === 'none') {
                            setLocalLateFee('0.00');
                          }
                          handleSaveCycleRateSettings({
                            lateFeeType: newType,
                            lateFeeValue: newType === 'none' ? '0.00' : (localLateFee === '0' || localLateFee === '0.00' ? '50.00' : localLateFee),
                          });
                        }}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100 cursor-pointer"
                        data-testid="select-late-fee-type"
                      >
                        {lateFeeType === 'percentage' && (
                          <option value="percentage" disabled hidden>
                            ไม่รองรับ (ร้อยละ)
                          </option>
                        )}
                        <option value="none">ไม่คิดค่าปรับ (ฟรี)</option>
                        <option value="daily">บาท/วัน</option>
                        <option value="fixed">คิดครั้งเดียว</option>
                      </select>
                      {lateFeeType === 'percentage' && (
                        <p className="text-[11px] text-rose-600 font-medium mt-1">
                          รูปแบบค่าปรับร้อยละไม่รองรับในระบบ กรุณาเลือกรูปแบบใหม่
                        </p>
                      )}
                    </div>

                    {/* 3. ค่าปรับเมื่อเกินวันกำหนด (บาท) */}
                    <div className="space-y-1 text-xs">
                      <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        ค่าปรับเมื่อเกินวันกำหนด (บาท) *
                      </label>
                      <input
                        type="number"
                        required
                        disabled={isCycleLocked || lateFeeType === 'none'}
                        value={lateFeeType === 'none' ? '0.00' : localLateFee}
                        onChange={(e) => {
                          isUserTypingRef.current = true;
                          setLocalLateFee(e.target.value);
                          setSaveStatus('typing');
                        }}
                        onBlur={(e) => {
                          if (lateFeeType !== 'none') {
                            handleSaveCycleRateSettings({ lateFeeValue: e.target.value });
                          }
                        }}
                        placeholder={lateFeeType === 'none' ? 'ฟรี' : '0.00'}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                        data-testid="input-late-fee"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Propagation Preview Action Button (Requirement 5) */}
              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  disabled={!hasDirtyFields}
                  onMouseDown={() => { isPropagationPreviewOpeningRef.current = true; }}
                  onClick={() => handleOpenPropagationPreview(dirtyChanges)}
                  className={`px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 ${!hasDirtyFields ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>แสดงตัวอย่างการส่งต่อค่า (Preview Propagation)</span>
                </button>
              </div>

            </div>

          </div>
        </div>
      </div>

      <PropagationPreviewModal
        isOpen={isPreviewOpen}
        previewData={previewData}
        onConfirm={handleConfirmPropagation}
        onCancel={() => setIsPreviewOpen(false)}
        isLoading={previewLoading}
      />

      {applyResultState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="propagation-result-modal">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-emerald-200 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">ผลการส่งต่อค่าเริ่มต้น</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 text-center">
                <div className="text-xs text-emerald-600 font-medium">ห้องที่ปรับปรุง</div>
                <div className="text-lg font-bold text-emerald-700" data-testid="applied-room-count">
                  {applyResultState.appliedRoomCount}
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
                <div className="text-xs text-blue-600 font-medium">รายการที่เปลี่ยน</div>
                <div className="text-lg font-bold text-blue-700" data-testid="applied-field-change-count">
                  {applyResultState.appliedFieldChangeCount}
                </div>
              </div>
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-center">
                <div className="text-xs text-amber-600 font-medium">ห้องที่ข้าม</div>
                <div className="text-lg font-bold text-amber-700" data-testid="skipped-room-count">
                  {applyResultState.skippedRoomCount}
                </div>
              </div>
              <div className="bg-rose-50 p-3 rounded-lg border border-rose-200 text-center">
                <div className="text-xs text-rose-600 font-medium">รายการที่ข้าม</div>
                <div className="text-lg font-bold text-rose-700" data-testid="skipped-field-change-count">
                  {applyResultState.skippedFieldChangeCount}
                </div>
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setApplyResultState(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors cursor-pointer"
                data-testid="btn-close-result"
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      )}

      {versionConflictState && (
        <VersionConflictModal
          isOpen={versionConflictState.isOpen}
          entityName={versionConflictState.entityName}
          staleVersion={versionConflictState.currentVersion - 1}
          latestVersion={versionConflictState.currentVersion}
          onReload={async () => {
            await fetchDormitoryDefaults();
            setVersionConflictState(null);
          }}
          onCancel={() => setVersionConflictState(null)}
          onRetry={versionConflictState.onRetry}
        />
      )}

      {/* Standalone LINE OA Modal */}
      {showLineOaModal && (
        <div className="fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-slate-50 rounded-3xl shadow-2xl overflow-hidden my-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowLineOaModal(false);
                fetchLineOaConfig();
              }}
              className="absolute top-4 right-4 z-10 p-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <OwnerLineOaPage
              dormitoryId={dorm?.id}
              onNavigateBack={() => {
                setShowLineOaModal(false);
                fetchLineOaConfig();
              }}
              onAddLog={onAddLog}
            />
          </div>
        </div>
      )}

      {/* Owner Digital Signature Drawing Modal */}
      {isSignaturePadOpen && (
        <div className="fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <PenTool className="w-4 h-4 text-indigo-600" />
                วาดลายมือชื่อดิจิทัลของเจ้าของหอพัก
              </h3>
              <button
                type="button"
                onClick={() => setIsSignaturePadOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              ลายมือชื่อนี้จะถูกประทับลงในสัญญาเช่าและใบเสร็จรับเงินอย่างเป็นทางการของหอพัก
            </p>
            <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200">
              <SignaturePad
                onSave={handleSaveOwnerSignature}
                onClear={() => { }}
                saveButtonText="บันทึกลายเซ็น"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
