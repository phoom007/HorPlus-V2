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
  CheckCircle2
} from 'lucide-react';
import {
  getDormitory,
  saveDormitory,
  getDormitoryRatesForCycle,
  seedDatabase
} from '../../data/mockData';
import { ConfirmDialog, SignaturePad } from '../../components/GlobalComponents';


import { Dormitory, CycleRates } from '../../types';

interface OwnerSettingsProps {
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onRefreshData: () => void;
  selectedCycle?: string;
  onCycleChange?: (cycle: string) => void;
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

export const OwnerSettings: React.FC<OwnerSettingsProps> = ({
  onAddLog,
  onRefreshData,
  selectedCycle: propSelectedCycle,
  onCycleChange
}) => {
  const [dorm, setDorm] = useState<Dormitory>(getDormitory());
  const [selectedCycle, setSelectedCycle] = useState<string>('2026-07');
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);
  const [tempYear, setTempYear] = useState(2026);

  const minCycle = '2026-01'; // Oldest month of system usage

  const [testingLine, setTestingLine] = useState(false);
  const [lineStatusMsg, setLineStatusMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    // Fetch initial LINE settings
    const fetchLineSettings = async () => {
      try {
        const csrfMatch = document.cookie.match(/horplus_csrf=([^;]+)/);
        const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
        const res = await fetch('/api/v1/integrations/line', {
          headers: { 'X-CSRF-Token': csrfToken }
        });
        if (res.ok) {
          const result = await res.json();
          if (result.data) {
            const data = result.data;
            let webhookStatus = 'pending';
            // Simple heuristic for webhook status
            if (data.status === 'connected') webhookStatus = 'verified';
            if (data.status === 'token_error') webhookStatus = 'failed';
            
          }
        }
      } catch (err) {
        console.error('Failed to fetch LINE settings', err);
      }
    };
    fetchLineSettings();
  }, []);


  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [resetSuccessNotice, setResetSuccessNotice] = useState(false);

  const handleResetDemoData = () => {
    seedDatabase(true);
    onRefreshData();
    window.dispatchEvent(new Event('storage'));
    onAddLog('รีเซ็ตระบบ', 'รีเซ็ตข้อมูลสาธิตทั้งหมดกลับเป็นชุดเริ่มต้นเรียบร้อยแล้ว', 'System', 'system-root');
    setResetSuccessNotice(true);
    setTimeout(() => setResetSuccessNotice(false), 5000);
  };

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
  const [localPromptPay, setLocalPromptPay] = useState(dorm.promptPayNumber || '');
  const [localPromptPayName, setLocalPromptPayName] = useState(dorm.promptPayName || '');
  const [localAddress, setLocalAddress] = useState(dorm.address || '');
  const [localBankName, setLocalBankName] = useState(dorm.bankName || '');
  const [localBankAccountNumber, setLocalBankAccountNumber] = useState(dorm.bankAccountNumber || '');
  const [localBankAccountName, setLocalBankAccountName] = useState(dorm.bankAccountName || dorm.promptPayName || '');

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
    setLocalAddress(dorm.address || '');
    setLocalTaxId(formatTaxId(dorm.taxId || ''));
    setLocalPhone(formatPhone(dorm.phone || ''));
    setLocalPromptPay(formatPromptPay(dorm.promptPayNumber || ''));
    setLocalPromptPayName(dorm.promptPayName || '');
    setLocalBankName(dorm.bankName || '');
    setLocalBankAccountNumber(formatBankAccount(dorm.bankAccountNumber || ''));
    setLocalBankAccountName(dorm.bankAccountName || dorm.promptPayName || '');
  }, [dorm.id, dorm.name, dorm.address, dorm.taxId, dorm.phone, dorm.promptPayNumber, dorm.promptPayName, dorm.bankName, dorm.bankAccountNumber, dorm.bankAccountName]);

  // Resolve currently active values for inputs depending on chosen cycle
  const currentRates = getDormitoryRatesForCycle(dorm, selectedCycle);

  const [localWaterUnitRate, setLocalWaterUnitRate] = useState<string | number>(currentRates.waterUnitRate);
  const [localElectricUnitRate, setLocalElectricUnitRate] = useState<string | number>(currentRates.electricUnitRate);
  const [localCommonFee, setLocalCommonFee] = useState<string | number>(currentRates.commonFee);
  const [localInternetFee, setLocalInternetFee] = useState<string | number>(currentRates.internetFee);
  const [localParkingFee, setLocalParkingFee] = useState<string | number>(currentRates.parkingFee ?? 100);
  const [localLateFee, setLocalLateFee] = useState<string | number>(currentRates.lateFeeDaily ?? dorm.lateFeeDaily ?? 100);

  useEffect(() => {
    setLocalWaterUnitRate(currentRates.waterUnitRate);
    setLocalElectricUnitRate(currentRates.electricUnitRate);
    setLocalCommonFee(currentRates.commonFee);
    setLocalInternetFee(currentRates.internetFee);
    setLocalParkingFee(currentRates.parkingFee ?? 100);
    setLocalLateFee(currentRates.lateFeeDaily ?? dorm.lateFeeDaily ?? 100);
  }, [selectedCycle, currentRates.waterUnitRate, currentRates.electricUnitRate, currentRates.commonFee, currentRates.internetFee, currentRates.parkingFee, currentRates.lateFeeDaily, dorm.lateFeeDaily]);

  // Performs immediate save
  const triggerSaveNow = (updatedDorm: Dormitory) => {
    setSaveStatus('saving');
    saveDormitory(updatedDorm);
    onRefreshData();

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus('saved');
      onAddLog('แก้ไขตั้งค่าระบบส่วนกลาง', `บันทึกการตั้งค่าอัตราบริการของงวด ${getShortCycleLabel(selectedCycle)} เรียบร้อยแล้ว`, 'Dormitory', updatedDorm.id);
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

  // Blur handlers to trigger save (Only triggers if values actually changed)
  const handleGlobalFieldBlur = (key: keyof Dormitory, value: any) => {
    const rawVal = typeof value === 'string' ? value.trim() : value;
    const dormRawVal = typeof dorm[key] === 'string' ? (dorm[key] as string).trim() : dorm[key];

    // Check if truly changed
    if (dormRawVal === rawVal) {
      setSaveStatus('idle');
      return;
    }

    const updated = {
      ...dorm,
      [key]: rawVal,
      updatedAt: new Date().toISOString()
    };
    setDorm(updated);
    triggerSaveNow(updated);
  };

  const handleRateBlur = (field: keyof CycleRates, value: any) => {
    // Only save if different from current value
    if (currentRates[field] === value) {
      setSaveStatus('idle');
      return;
    }

    const updatedDorm = { ...dorm };
    if (!updatedDorm.cycleSettings) {
      updatedDorm.cycleSettings = {};
    }

    if (!updatedDorm.cycleSettings[selectedCycle]) {
      const resolved = getDormitoryRatesForCycle(dorm, selectedCycle);
      updatedDorm.cycleSettings[selectedCycle] = { ...resolved };
    }
    updatedDorm.cycleSettings[selectedCycle] = {
      ...updatedDorm.cycleSettings[selectedCycle],
      [field]: value
    };
    (updatedDorm as any)[field] = value;

    updatedDorm.updatedAt = new Date().toISOString();
    setDorm(updatedDorm);
    triggerSaveNow(updatedDorm);
  };

  const handleRateSelectChange = (field: keyof CycleRates, value: any) => {
    // Dropdowns are saved immediately on change
    if (currentRates[field] === value) {
      setSaveStatus('idle');
      return;
    }

    const updatedDorm = { ...dorm };
    if (!updatedDorm.cycleSettings) {
      updatedDorm.cycleSettings = {};
    }

    if (!updatedDorm.cycleSettings[selectedCycle]) {
      const resolved = getDormitoryRatesForCycle(dorm, selectedCycle);
      updatedDorm.cycleSettings[selectedCycle] = { ...resolved };
    }
    updatedDorm.cycleSettings[selectedCycle] = {
      ...updatedDorm.cycleSettings[selectedCycle],
      [field]: value
    };
    (updatedDorm as any)[field] = value;

    updatedDorm.updatedAt = new Date().toISOString();
    setDorm(updatedDorm);
    triggerSaveNow(updatedDorm);
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
                    value={localName}
                    onChange={(e) => {
                      setLocalName(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* เบอร์ติดต่อโทร */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">เบอร์ติดต่อโทร *</label>
                  <input
                    type="text"
                    required
                    value={localPhone}
                    placeholder="0XX-XXX-XXXX"
                    onChange={(e) => {
                      setLocalPhone(formatPhone(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('phone', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* เลขประจำตัวผู้เสียภาษี */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">เลขประจำตัวผู้เสียภาษี</label>
                  <input
                    type="text"
                    value={localTaxId}
                    placeholder="X-XXXX-XXXXX-XX-X"
                    onChange={(e) => {
                      setLocalTaxId(formatTaxId(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('taxId', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* เลขพร้อมเพย์ (เบอร์ / บัตรปชช.) */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">เลขพร้อมเพย์ (เบอร์ / บัตรปชช.) *</label>
                  <input
                    type="text"
                    required
                    value={localPromptPay}
                    onChange={(e) => {
                      setLocalPromptPay(formatPromptPay(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('promptPayNumber', e.target.value)}
                    placeholder="เลขบัตรปชช. / เบอร์โทร"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold text-indigo-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
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
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                {/* ธนาคาร */}
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">ธนาคาร *</label>
                  <select
                    value={localBankName}
                    onChange={(e) => {
                      const newBank = e.target.value;
                      setLocalBankName(newBank);
                      handleGlobalFieldBlur('bankName', newBank);
                      if (!newBank) {
                        setLocalBankAccountNumber('');
                        handleGlobalFieldBlur('bankAccountNumber', '');
                      }
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
                    value={localBankAccountNumber}
                    disabled={!localBankName}
                    placeholder={localBankName ? "XXX-X-XXXXX-X" : "กรุณาเลือกธนาคารก่อน"}
                    onChange={(e) => {
                      setLocalBankAccountNumber(formatBankAccount(e.target.value));
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('bankAccountNumber', e.target.value)}
                    className={`w-full px-3 py-2 border border-gray-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs ${
                      !localBankName ? 'opacity-50 bg-slate-50 cursor-not-allowed' : 'bg-white'
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
                    placeholder="ชื่อบัญชีธนาคารผู้รับเงิน"
                    onChange={(e) => {
                      setLocalBankAccountName(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleGlobalFieldBlur('bankAccountName', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>
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
                  onBlur={(e) => handleGlobalFieldBlur('address', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 h-20 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                />
              </div>

              {/* Digital Signature of Owner / Niti Dorm */}
              <div className="space-y-2 text-xs pt-3 border-t border-slate-100">
                <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  ลายมือชื่อเจ้าของหอพัก (สำหรับลงชื่อในสัญญาเช่า)
                </label>
                {dorm.ownerSignature ? (
                  <div className="space-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> บันทึกลายเซ็นเรียบร้อยแล้ว
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { ...dorm, ownerSignature: undefined, updatedAt: new Date().toISOString() };
                          setDorm(updated);
                          saveDormitory(updated);
                          if (onRefreshData) onRefreshData();
                        }}
                        className="text-[10px] text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
                      >
                        ลบและเซ็นใหม่
                      </button>
                    </div>
                    <img
                      src={dorm.ownerSignature}
                      alt="ลายเซ็นนิติบุคคล"
                      className="h-16 max-w-full mx-auto object-contain border border-slate-200 rounded-xl bg-white p-2"
                    />
                  </div>
                ) : (
                  <SignaturePad
                    onSave={(dataUrl) => {
                      handleGlobalFieldBlur('ownerSignature', dataUrl);
                    }}
                    onClear={() => {
                      handleGlobalFieldBlur('ownerSignature', '');
                    }}
                  />
                )}
              </div>
            </div>

            {/* Column 2: การตั้งค่าอัตราส่วนต่างและการคำนวณ */}
            <div className="space-y-5 pt-8 lg:pt-0 lg:pl-10 relative">
              {/* Heading with integrated, clean Cycle selector (same line on PC, centered below title on Mobile) */}
              <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pb-3 border-b border-gray-100">
                <h4 className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5 uppercase tracking-wider text-center sm:text-left">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  การตั้งค่า
                </h4>

                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <span className="text-[10px] font-extrabold text-slate-400 flex items-center gap-1 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    รอบงวดการคำนวณ
                  </span>
                  
                  {/* Styled Cycle switcher with drop-modal just like in header */}
                  <div className="relative">
                    <button
                      onClick={() => setIsCycleModalOpen(true)}
                      className="flex items-center justify-between gap-2 px-3.5 py-1.5 border border-slate-200 hover:border-indigo-500 rounded-xl bg-white text-slate-800 font-extrabold shadow-2xs text-xs cursor-pointer transition-all w-48 sm:w-auto sm:min-w-[190px] whitespace-nowrap"
                    >
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        ประจำเดือน {getShortCycleLabel(selectedCycle)}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>

                    {/* Beautiful Calendar Grid Dropdown Modal */}
                    {isCycleModalOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-40 cursor-default" 
                          onClick={() => setIsCycleModalOpen(false)} 
                        />
                        
                        <div className="absolute right-1/2 translate-x-1/2 sm:translate-x-0 sm:right-0 top-full mt-2 bg-white p-5 rounded-3xl w-[300px] border border-slate-100 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200 text-left">
                          <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-black text-slate-800">เลือกงวดประจำเดือน</h3>
                            <button 
                              onClick={() => setIsCycleModalOpen(false)}
                              className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                            >
                              ปิด
                            </button>
                          </div>

                          {/* Year selector with arrows */}
                          <div className="flex items-center justify-between bg-slate-50 p-1 rounded-2xl border border-slate-100 mb-4">
                            <button 
                              onClick={() => {
                                const minYear = parseInt(minCycle.split('-')[0]);
                                setTempYear(prev => prev > minYear ? prev - 1 : prev);
                              }}
                              disabled={tempYear <= parseInt(minCycle.split('-')[0])}
                              className={`p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 rounded-xl transition-all cursor-pointer shadow-2xs ${
                                tempYear <= parseInt(minCycle.split('-')[0]) ? 'opacity-25 cursor-not-allowed' : ''
                              }`}
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-xs font-black text-slate-800">{tempYear + 543}</span>
                            <button 
                              onClick={() => {
                                const maxYear = parseInt(maxCycle.split('-')[0]);
                                setTempYear(prev => prev < maxYear ? prev + 1 : prev);
                              }}
                              disabled={tempYear >= parseInt(maxCycle.split('-')[0])}
                              className={`p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 rounded-xl transition-all cursor-pointer shadow-2xs ${
                                tempYear >= parseInt(maxCycle.split('-')[0]) ? 'opacity-25 cursor-not-allowed' : ''
                              }`}
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Grid of Months (3 columns, 4 rows) */}
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { val: '01', label: 'มกราคม' },
                              { val: '02', label: 'กุมภาพันธ์' },
                              { val: '03', label: 'มีนาคม' },
                              { val: '04', label: 'เมษายน' },
                              { val: '05', label: 'พฤษภาคม' },
                              { val: '06', label: 'มิถุนายน' },
                              { val: '07', label: 'กรกฎาคม' },
                              { val: '08', label: 'สิงหาคม' },
                              { val: '09', label: 'กันยายน' },
                              { val: '10', label: 'ตุลาคม' },
                              { val: '11', label: 'พฤศจิกายน' },
                              { val: '12', label: 'ธันวาคม' }
                            ].map((m) => {
                              const targetCycle = `${tempYear}-${m.val}`;
                              const isSelected = selectedCycle === targetCycle;
                              const isDisabled = targetCycle < minCycle || targetCycle > maxCycle;

                              return (
                                <button
                                  key={m.val}
                                  disabled={isDisabled}
                                  onClick={() => {
                                    setSelectedCycle(targetCycle);
                                    if (onCycleChange) {
                                      onCycleChange(targetCycle);
                                    }
                                    setIsCycleModalOpen(false);
                                  }}
                                  className={`py-1.5 px-1 text-[10px] font-bold rounded-xl transition-all text-center border ${
                                    isSelected
                                      ? 'bg-blue-600 border-blue-650 hover:bg-blue-700 text-white shadow-sm cursor-pointer'
                                      : isDisabled
                                      ? 'bg-slate-50 text-slate-300 border border-slate-100/50 cursor-not-allowed opacity-40'
                                      : 'bg-white hover:bg-slate-50 border border-slate-100 text-slate-600 hover:text-slate-800 cursor-pointer'
                                  }`}
                                >
                                  {m.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                </div>
              </div>

              {/* Water Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs pt-1">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <Droplet className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    อัตราค่าน้ำ (บาท) *
                  </label>
                  <input
                    type="number"
                    required
                    value={localWaterUnitRate}
                    onChange={(e) => {
                      setLocalWaterUnitRate(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('waterUnitRate', Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าน้ำประปา</label>
                  <select
                    value={currentRates.waterBillingMode}
                    onChange={(e) => handleRateSelectChange('waterBillingMode', e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  >
                    <option value="unit">บาท/หน่วย</option>
                    <option value="person">บาท/คน</option>
                    <option value="room">บาท/ห้อง</option>
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
                    type="number"
                    required
                    value={localElectricUnitRate}
                    onChange={(e) => {
                      setLocalElectricUnitRate(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('electricUnitRate', Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าไฟฟ้า</label>
                  <select
                    value={currentRates.electricBillingMode}
                    onChange={(e) => handleRateSelectChange('electricBillingMode', e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs"
                  >
                    <option value="unit">บาท/หน่วย</option>
                    <option value="person">บาท/คน</option>
                    <option value="room">บาท/ห้อง</option>
                  </select>
                </div>
              </div>

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
                    disabled={currentRates.commonFeeMode === 'free'}
                    value={currentRates.commonFeeMode === 'free' ? 0 : localCommonFee}
                    onChange={(e) => {
                      setLocalCommonFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('commonFee', Number(e.target.value))}
                    placeholder={currentRates.commonFeeMode === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าส่วนกลาง</label>
                  <select
                    value={currentRates.commonFeeMode}
                    onChange={(e) => handleRateSelectChange('commonFeeMode', e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="room">บาท/ห้อง</option>
                    <option value="person">บาท/คน</option>
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
                    disabled={currentRates.internetFeeMode === 'free'}
                    value={currentRates.internetFeeMode === 'free' ? 0 : localInternetFee}
                    onChange={(e) => {
                      setLocalInternetFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => handleRateBlur('internetFee', Number(e.target.value))}
                    placeholder={currentRates.internetFeeMode === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าอินเทอร์เน็ต</label>
                  <select
                    value={currentRates.internetFeeMode}
                    onChange={(e) => handleRateSelectChange('internetFeeMode', e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="room">บาท/ห้อง</option>
                    <option value="person">บาท/คน</option>
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
                    disabled={currentRates.parkingFeeMode === 'free'}
                    value={currentRates.parkingFeeMode === 'free' ? 0 : localParkingFee}
                    onChange={(e) => {
                      setLocalParkingFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => {
                      handleRateBlur('parkingFee', Number(e.target.value));
                      handleGlobalFieldBlur('parkingFee', Number(e.target.value));
                    }}
                    placeholder={currentRates.parkingFeeMode === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าจอดรถ</label>
                  <select
                    value={currentRates.parkingFeeMode || 'room'}
                    onChange={(e) => {
                      handleRateSelectChange('parkingFeeMode', e.target.value as any);
                      handleGlobalFieldBlur('parkingFeeMode', e.target.value);
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer"
                  >
                    <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                    <option value="room">บาท/ห้อง</option>
                    <option value="vehicle">บาท/คัน</option>
                  </select>
                </div>
              </div>

              {/* Late Fee Penalty Settings */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700 flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-rose-500" />
                    ค่าปรับเมื่อเกินวันกำหนด (บาท) *
                  </label>
                  <input
                    type="number"
                    required
                    disabled={currentRates.lateFeeType === 'free'}
                    value={currentRates.lateFeeType === 'free' ? 0 : localLateFee}
                    onChange={(e) => {
                      setLocalLateFee(e.target.value);
                      setSaveStatus('typing');
                    }}
                    onBlur={(e) => {
                      handleRateBlur('lateFeeDaily', Number(e.target.value));
                      handleGlobalFieldBlur('lateFeeDaily', Number(e.target.value));
                    }}
                    placeholder={currentRates.lateFeeType === 'free' ? 'ฟรี' : '0'}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-bold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-slate-700">รูปแบบค่าปรับเกินกำหนด</label>
                  <select
                    value={currentRates.lateFeeType || dorm.lateFeeType || 'per_day'}
                    onChange={(e) => {
                      handleRateSelectChange('lateFeeType', e.target.value as any);
                      handleGlobalFieldBlur('lateFeeType', e.target.value);
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-xs cursor-pointer"
                  >
                    <option value="free">ไม่คิดค่าปรับ (ฟรี)</option>
                    <option value="per_day">บาท/วัน</option>
                    <option value="fixed_once">คิดครั้งเดียว</option>
                  </select>
                </div>
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

    </div>
  );
};
