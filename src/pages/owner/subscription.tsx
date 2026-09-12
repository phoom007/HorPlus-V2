/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Check,
  CheckCircle2,
  Copy,
  Share2,
  Users,
  Clock,
  Building,
  Receipt,
  ShieldCheck,
  ArrowRight,
  Gift,
  Ticket,
  QrCode,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Zap,
  AlertCircle,
  ExternalLink,
  Crown,
  Flame,
  CheckCircle,
  X,
  Upload,
  RefreshCw,
  Award,
  Play,
  Pause,
  Image as ImageIcon,
  Plus,
  Trash2,
  Download,
  Infinity as InfinityIcon
} from 'lucide-react';
import { Room } from '../../types';
import { generatePromptPayQrDataUrl } from '../../utils/promptpay';
import { CelebrationOverlay } from '../../components/CelebrationOverlay';
import { downloadPromptPayCardImage } from '../../utils/promptpayCard';
import { httpRequest } from '../../data/httpClient';

interface OwnerSubscriptionProps {
  dormitoryId?: string;
  rooms?: Room[];
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
  onNavigate?: (tab: string) => void;
  onDetailViewChange?: (isOpen: boolean) => void;
}

interface PlanOption {
  id: string;
  name: string;
  tag: string;
  priceMonthly: number;
  maxRooms: number | string;
  slipQuota: string;
  lineQuota: string;
  description: string;
  features: string[];
  isCurrent?: boolean;
  isPopular?: boolean;
}

export interface DurationPricing {
  months: number;
  label: string;
  shortLabel: string;
  originalPrice?: number;
  price: number;
  perMonthPrice: number;
  badge?: string;
  days: number;
}

export const PRO_DURATIONS: DurationPricing[] = [
  { months: 1, label: '1 เดือน', shortLabel: '1 เดือน', originalPrice: 990, price: 189, perMonthPrice: 189, badge: 'ลด 81%', days: 30 },
  { months: 3, label: '3 เดือน', shortLabel: '3 เดือน', originalPrice: 2990, price: 529, perMonthPrice: 176, badge: 'ลด 82%', days: 90 },
  { months: 6, label: '6 เดือน', shortLabel: '6 เดือน', originalPrice: 5990, price: 999, perMonthPrice: 166, badge: 'ลด 83%', days: 180 },
  { months: 12, label: '12 เดือน', shortLabel: '12 เดือน', originalPrice: 10990, price: 1799, perMonthPrice: 150, badge: 'แนะนำ', days: 365 },
  { months: 24, label: '24 เดือน', shortLabel: '24 เดือน', originalPrice: 20000, price: 2999, perMonthPrice: 125, badge: 'คุ้มค่าที่สุด', days: 730 }
];

const AVAILABLE_PLANS: PlanOption[] = [
  {
    id: 'free',
    name: 'HORPLUS FREE',
    tag: 'ใช้งานฟรี',
    priceMonthly: 0,
    maxRooms: 10,
    slipQuota: 'ฟรี 5 ห้อง/เดือน',
    lineQuota: '30 ข้อความต่อเดือน',
    description: 'เหมาะสำหรับเริ่มต้นใช้งาน วางผัง และบริหารจัดการ 10 ห้องพักแรก',
    features: [
      'เปิดใช้งานได้พร้อมกัน 10 ห้องพักแรก',
      'สร้างตึกและห้องพักได้ไม่จำกัดเพื่อวางผัง',
      'ระบบบันทึกบัญชี ออกบิล และใบเสร็จรับเงินอัตโนมัติ',
      'โควตาข้อความแจ้งเตือน 30 ข้อความต่อเดือน'
    ]
  },
  {
    id: 'pro-1799',
    name: 'HORPLUS PRO',
    tag: 'แพ็กเกจแนะนำ',
    priceMonthly: 189,
    maxRooms: 150,
    slipQuota: 'ไม่จำกัด',
    lineQuota: '300 ข้อความต่อเดือน',
    description: 'ฟังก์ชันระบบบริหารจัดการหอพักเต็มรูปแบบ สำหรับผู้ประกอบการมืออาชีพ',
    features: [
      'รองรับสูงสุด 150 ห้องพัก',
      'โควตาข้อความแจ้งเตือน 300 ข้อความต่อเดือน',
      'ฟังก์ชันระบบบริหารจัดการหอพักเต็มรูปแบบ'
    ],
    isCurrent: true,
    isPopular: true
  }
];

export interface PricingCardData {
  id: string;
  planId: 'free' | 'pro';
  name: string;
  durationLabel: string;
  durationMonths: number;
  daysAdded: number;
  originalPrice?: number;
  price: number;
  perMonthPrice: number;
  discountBadge?: string;
  popular?: boolean;
  bestValue?: boolean;
  maxRooms: string;
  lineQuota: string;
  keyFeature: string;
}

export const ALL_PRICING_CARDS: PricingCardData[] = [
  {
    id: 'card-free',
    planId: 'free',
    name: 'HORPLUS FREE',
    durationLabel: 'ตลอดการใช้งาน',
    durationMonths: 0,
    daysAdded: 0,
    price: 0,
    perMonthPrice: 0,
    discountBadge: 'ฟรีถาวร',
    maxRooms: 'รองรับ 10 ห้องพักแรก',
    lineQuota: 'LINE แจ้งเตือน 30 ครั้ง/เดือน',
    keyFeature: 'ฟรีตรวจสลิป 5 ห้อง/เดือน'
  },
  {
    id: 'card-pro-1m',
    planId: 'pro',
    name: 'HORPLUS PRO',
    durationLabel: '1 เดือน',
    durationMonths: 1,
    daysAdded: 30,
    originalPrice: 990,
    price: 189,
    perMonthPrice: 189,
    discountBadge: 'ลด 81%',
    maxRooms: 'รองรับสูงสุด 150 ห้องพัก',
    lineQuota: 'LINE แจ้งเตือน 300 ครั้ง/เดือน',
    keyFeature: 'ตรวจสลิปอัตโนมัติ ไม่จำกัด'
  },
  {
    id: 'card-pro-3m',
    planId: 'pro',
    name: 'HORPLUS PRO',
    durationLabel: '3 เดือน',
    durationMonths: 3,
    daysAdded: 90,
    originalPrice: 2990,
    price: 529,
    perMonthPrice: 176,
    discountBadge: 'ลด 82%',
    maxRooms: 'รองรับสูงสุด 150 ห้องพัก',
    lineQuota: 'LINE แจ้งเตือน 300 ครั้ง/เดือน',
    keyFeature: 'ตรวจสลิปอัตโนมัติ ไม่จำกัด'
  },
  {
    id: 'card-pro-6m',
    planId: 'pro',
    name: 'HORPLUS PRO',
    durationLabel: '6 เดือน',
    durationMonths: 6,
    daysAdded: 180,
    originalPrice: 5990,
    price: 999,
    perMonthPrice: 166,
    discountBadge: 'ลด 83%',
    maxRooms: 'รองรับสูงสุด 150 ห้องพัก',
    lineQuota: 'LINE แจ้งเตือน 300 ครั้ง/เดือน',
    keyFeature: 'ตรวจสลิปอัตโนมัติ ไม่จำกัด'
  },
  {
    id: 'card-pro-12m',
    planId: 'pro',
    name: 'HORPLUS PRO',
    durationLabel: '12 เดือน',
    durationMonths: 12,
    daysAdded: 365,
    originalPrice: 10990,
    price: 1799,
    perMonthPrice: 150,
    popular: true,
    discountBadge: 'แนะนำ',
    maxRooms: 'รองรับสูงสุด 150 ห้องพัก',
    lineQuota: 'LINE แจ้งเตือน 300 ครั้ง/เดือน',
    keyFeature: 'ตรวจสลิปอัตโนมัติ ไม่จำกัด'
  },
  {
    id: 'card-pro-24m',
    planId: 'pro',
    name: 'HORPLUS PRO',
    durationLabel: '24 เดือน',
    durationMonths: 24,
    daysAdded: 730,
    originalPrice: 20000,
    price: 2999,
    perMonthPrice: 125,
    bestValue: true,
    discountBadge: 'คุ้มค่าที่สุด',
    maxRooms: 'รองรับสูงสุด 150 ห้องพัก',
    lineQuota: 'LINE แจ้งเตือน 300 ครั้ง/เดือน',
    keyFeature: 'ตรวจสลิปอัตโนมัติ ไม่จำกัด'
  }
];

export interface BillboardItem {
  id: string;
  imageUrl: string;
  title: string;
  description: string;
  tag: string;
}

export const DEFAULT_BILLBOARD_ADS: BillboardItem[] = [
  {
    id: 'billboard-1',
    imageUrl: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1600&auto=format&fit=crop&q=80',
    title: 'ระบบบริหารจัดการหอพัก HORPLUS ครบวงจร',
    description: 'จัดการห้องพัก ออกบิลค่าน้ำค่าไฟ และส่งแจ้งเตือนผู้เช่าผ่าน LINE อัตโนมัติ สะดวกรวดเร็ว',
    tag: 'ป้ายประชาสัมพันธ์'
  },
  {
    id: 'billboard-2',
    imageUrl: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1600&auto=format&fit=crop&q=80',
    title: 'แพ็กเกจ HORPLUS PRO 12 เดือน เพียง ฿1,799',
    description: 'เฉลี่ยเพียง ฿150 ต่อเดือน รองรับได้ถึง 150 ห้องพัก พร้อมโควตา LINE 300 ข้อความต่อเดือน',
    tag: 'โปรโมชั่นสุดคุ้ม'
  },
  {
    id: 'billboard-3',
    imageUrl: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=1600&auto=format&fit=crop&q=80',
    title: 'ระบบตรวจสอบสลิปและบันทึกบัญชีอัตโนมัติ',
    description: 'ตรวจจับสลิปโอนเงินทันที ป้องกันสลิปซ้ำหรือสลิปปลอม สรุปรายรับรายจ่ายแบบเรียลไทม์',
    tag: 'นวัตกรรมอัจฉริยะ'
  },
  {
    id: 'billboard-4',
    imageUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1600&auto=format&fit=crop&q=80',
    title: 'โปรแกรมแนะนำเพื่อน รับวันใช้งานฟรีทันที +30 วัน',
    description: 'แชร์รหัสแนะนำให้เพื่อนเจ้าของหอพัก รับโบนัสวันใช้งานและเหรียญสะสมสิทธิประโยชน์มากมาย',
    tag: 'สิทธิพิเศษหอพัก'
  }
];

export const OwnerSubscription: React.FC<OwnerSubscriptionProps> = ({
  dormitoryId,
  rooms,
  onAddLog,
  onNavigate,
  onDetailViewChange
}) => {
  // Subscription info state (defaults to neutral; populated authoritatively from API)
  const [subInfo, setSubInfo] = useState(() => ({
    planName: 'HORPLUS FREE',
    planId: 'free',
    daysLeft: 0,
    expiryDate: 'ฟรีถาวร',
    maxRooms: 10,
    currentRooms: 0,
    slipsChecked: 0,
    freeSlipsUsed: 0,
    autoRenew: false,
    lastPaymentDate: '-'
  }));

  // Referral info state (defaults to empty; populated authoritatively from API)
  const [referralInfo, setReferralInfo] = useState(() => ({
    code: '',
    link: '',
    invitedCount: 0,
    maxTarget: 10,
    rewardsClaimedDays: 0,
    coins: 0,
    history: [] as { id: string; dormName: string; date: string; status: 'pending' | 'completed'; reward: string }[]
  }));

  // Promo code / Subscription days bonus state
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountPercent?: number;
    discountAmount?: number;
    daysBonus?: number;
    coinsBonus?: number;
    description: string;
  } | null>(() => {
    try {
      const saved = localStorage.getItem('HorPlus_applied_promo');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch { }
    return null;
  });

  // Sync appliedPromo to localStorage
  useEffect(() => {
    try {
      if (appliedPromo) {
        localStorage.setItem('HorPlus_applied_promo', JSON.stringify(appliedPromo));
      } else {
        localStorage.removeItem('HorPlus_applied_promo');
      }
    } catch { }
  }, [appliedPromo]);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoSuccessMsg, setPromoSuccessMsg] = useState<string | null>(null);

  // Refresh status loading state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Billing duration selector
  const [durationMonths, setDurationMonths] = useState<number>(1);
  const [selectedPlanToRenew, setSelectedPlanToRenew] = useState<PlanOption>(
    AVAILABLE_PLANS.find(p => p.id === subInfo.planId) || AVAILABLE_PLANS[1]
  );

  // Full-page Payment View state (คล้ายเมนูงานแจ้งซ่อม ไม่ใช่แบบ popup)
  const [isPaymentViewOpen, setIsPaymentViewOpen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);

  // Slip upload and verification states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSlipFile, setSelectedSlipFile] = useState<File | null>(null);
  const [uploadedSlip, setUploadedSlip] = useState<string | null>(null);
  const [isVerifyingSlip, setIsVerifyingSlip] = useState(false);
  const [verifyStep, setVerifyStep] = useState(0); // 1: scanning, 2: checking bank, 3: success
  const [isVerifiedSuccess, setIsVerifiedSuccess] = useState(false);
  const [isCelebrationOpen, setIsCelebrationOpen] = useState(false);
  const [isDownloadingCard, setIsDownloadingCard] = useState(false);
  const [promptPayConfig, setPromptPayConfig] = useState<{
    promptPayId: string;
    accountName: string;
  }>({
    promptPayId: '0935098808',
    accountName: 'นายภูวนาท ทานาลาด'
  });
  const [successReceipt, setSuccessReceipt] = useState<{
    orderId: string;
    receiptNumber?: string;
    paidAmount: number;
    planName: string;
    durationMonths: number;
    daysAdded: number;
    previousDaysLeft?: number;
    newDaysLeft?: number;
    previousExpiryDate?: string;
    newExpiryDate: string;
    paidAt: string;
  } | null>(null);

  // Server packages and authoritative pricing quote state
  const [packagesList, setPackagesList] = useState<Array<{ id: string; durationMonths: number; price: string }>>([]);
  const [serverQuote, setServerQuote] = useState<{
    intentId?: string;
    finalPayableAmount?: number;
    promoDiscountAmount?: number;
    promoApplied?: boolean;
    promoCode?: string;
  } | null>(null);

  // Load PromptPay config, Current Subscription, and Referral/Wallet from server
  const fetchCurrentSubscription = async () => {
    try {
      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
      const res = await httpRequest<any>('GET', '/subscription/current', undefined, {
        dormitoryId: activeDormId || undefined
      });
      if (res && res.data) {
        const d = res.data;
        const planCode = d.plan?.code || (d.planId ? 'PAID' : 'FREE');
        const isPro = planCode === 'PAID';
        const expiresAt = d.expiresAt ? new Date(d.expiresAt) : null;
        const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)) : 0;
        const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const expiryStr = expiresAt ? `${expiresAt.getDate()} ${thaiMonths[expiresAt.getMonth()]} ${expiresAt.getFullYear() + 543}` : 'ฟรีถาวร';

        setSubInfo({
          planName: isPro ? 'HORPLUS PRO' : 'HORPLUS FREE',
          planId: isPro ? 'pro' : 'free',
          daysLeft,
          expiryDate: isPro ? expiryStr : 'ฟรีถาวร',
          maxRooms: isPro ? 150 : 10,
          currentRooms: typeof d.roomCount === 'number' ? d.roomCount : 0,
          slipsChecked: typeof d.slipsChecked === 'number' ? d.slipsChecked : 0,
          freeSlipsUsed: typeof d.slipsChecked === 'number' ? d.slipsChecked : 0,
          autoRenew: Boolean(d.autoRenew),
          lastPaymentDate: d.lastPaymentDate || '-'
        });
      }
    } catch (err) {
      console.warn('Failed to fetch subscription:', err);
    }
  };

  useEffect(() => {
    fetchCurrentSubscription();

    // Packages list
    httpRequest<any>('GET', '/subscription/packages')
      .then(res => {
        if (res && res.data?.packages) {
          setPackagesList(res.data.packages);
        }
      })
      .catch(() => { });

    // Payment Config
    httpRequest<any>('GET', '/subscription/config/payment')
      .then(res => {
        if (res && res.data) {
          setPromptPayConfig({
            promptPayId: res.data.promptPayId || '0935098808',
            accountName: res.data.accountName || 'นายภูวนาท ทานาลาด'
          });
        }
      })
      .catch(() => { });

    // Referral & Wallet
    httpRequest<any>('GET', '/referral/me')
      .then(res => {
        if (res && res.data) {
          setReferralInfo(prev => ({
            ...prev,
            code: res.data.referralCode || prev.code,
            link: res.data.referralLink || prev.link,
            invitedCount: res.data.totalInvited ?? prev.invitedCount,
          }));
        }
      })
      .catch(() => { });

    httpRequest<any>('GET', '/referral/wallet')
      .then(res => {
        if (res && res.data) {
          setReferralInfo(prev => ({
            ...prev,
            coins: res.data.coinBalance ?? prev.coins,
          }));
        }
      })
      .catch(() => { });

    // Billboards
    httpRequest<any>('GET', '/billboard')
      .then(res => {
        if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
          setBillboardAds(res.data);
        }
      })
      .catch(() => { });
  }, [dormitoryId]);

  // Sync detail view state with parent for full-screen layout
  useEffect(() => {
    if (onDetailViewChange) {
      onDetailViewChange(isPaymentViewOpen);
    }
  }, [isPaymentViewOpen, onDetailViewChange]);

  // Toast Notification state with smooth fade and appropriate background
  const [toastData, setToastData] = useState<{
    message: string;
    type?: 'success' | 'copy';
  } | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);
  const toastTimerRef = useRef<{ fade?: ReturnType<typeof setTimeout>; remove?: ReturnType<typeof setTimeout> }>({});

  const showToast = (message: string, type: 'success' | 'copy' = 'success', duration = 3000) => {
    if (toastTimerRef.current.fade) clearTimeout(toastTimerRef.current.fade);
    if (toastTimerRef.current.remove) clearTimeout(toastTimerRef.current.remove);

    setToastData({ message, type });
    setIsToastFading(false);

    toastTimerRef.current.fade = setTimeout(() => {
      setIsToastFading(true);
    }, Math.max(duration - 450, 1000));

    toastTimerRef.current.remove = setTimeout(() => {
      setToastData(null);
      setIsToastFading(false);
    }, duration);
  };

  const setShowSuccessToast = (msg: string | null) => {
    if (msg) showToast(msg, 'success', 3200);
    else {
      setIsToastFading(true);
      setTimeout(() => setToastData(null), 350);
    }
  };

  const setCopyToast = (msg: string | null) => {
    if (msg) showToast(msg, 'copy', 2500);
    else {
      setIsToastFading(true);
      setTimeout(() => setToastData(null), 350);
    }
  };

  const [isReferralCopied, setIsReferralCopied] = useState(false);
  const handleCopyReferral = () => {
    const link = referralInfo.link || 'http://127.0.0.1:5173/auth/owner?ref=441570';
    navigator.clipboard.writeText(link).then(() => {
      setIsReferralCopied(true);
      setCopyToast('คัดลอกลิงก์แนะนำเพื่อนแล้ว!');
      setTimeout(() => setIsReferralCopied(false), 2000);
    });
  };

  // Billboard ads state (persisted in localStorage)
  const [billboardAds, setBillboardAds] = useState<BillboardItem[]>(() => {
    try {
      const saved = localStorage.getItem('HorPlus_billboard_ads');
      if (saved) return JSON.parse(saved);
    } catch { }
    return DEFAULT_BILLBOARD_ADS;
  });
  const [currentBillboardIndex, setCurrentBillboardIndex] = useState(0);
  const [isBillboardPlaying, setIsBillboardPlaying] = useState(true);
  const [isBillboardHovered, setIsBillboardHovered] = useState(false);

  // Billboard custom image modal states
  const [isBillboardModalOpen, setIsBillboardModalOpen] = useState(false);
  const [newImageFile, setNewImageFile] = useState<string | null>(null);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageTitle, setNewImageTitle] = useState('');
  const [newImageDesc, setNewImageDesc] = useState('');
  const [newImageTag, setNewImageTag] = useState('');

  // 16:9 Billboard auto-rotation effect:
  // Visible hold: 3 seconds (3,000ms)
  // Fade transition: 0.5 seconds (500ms)
  // Total interval = 3,500ms
  useEffect(() => {
    if (!isBillboardPlaying || isBillboardHovered || billboardAds.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentBillboardIndex(prev => (prev + 1) % billboardAds.length);
    }, 3500);

    return () => clearInterval(timer);
  }, [isBillboardPlaying, isBillboardHovered, billboardAds.length]);

  // Swipe & Drag Gesture for Billboard Slider (รองรับการปัดด้วยนิ้วบน Touchscreen และลากผ่านเมาส์)
  const touchStartXRef = useRef<number | null>(null);
  const touchEndXRef = useRef<number | null>(null);
  const isMouseDownRef = useRef<boolean>(false);
  const mouseStartXRef = useRef<number | null>(null);
  const [isDraggingBillboard, setIsDraggingBillboard] = useState(false);

  const handleBillboardTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.targetTouches[0].clientX;
    touchEndXRef.current = e.targetTouches[0].clientX;
    setIsBillboardHovered(true);
  };

  const handleBillboardTouchMove = (e: React.TouchEvent) => {
    touchEndXRef.current = e.targetTouches[0].clientX;
  };

  const handleBillboardTouchEnd = () => {
    setIsBillboardHovered(false);
    if (touchStartXRef.current === null || touchEndXRef.current === null) return;
    const diff = touchStartXRef.current - touchEndXRef.current;
    const minSwipeDistance = 40; // threshold px
    if (diff > minSwipeDistance) {
      // Swiped Left -> Next image
      setCurrentBillboardIndex(prev => (prev + 1) % billboardAds.length);
    } else if (diff < -minSwipeDistance) {
      // Swiped Right -> Prev image
      setCurrentBillboardIndex(prev => (prev === 0 ? billboardAds.length - 1 : prev - 1));
    }
    touchStartXRef.current = null;
    touchEndXRef.current = null;
  };

  const handleBillboardMouseDown = (e: React.MouseEvent) => {
    isMouseDownRef.current = true;
    mouseStartXRef.current = e.clientX;
    setIsDraggingBillboard(true);
    setIsBillboardHovered(true);
  };

  const handleBillboardMouseUp = (e: React.MouseEvent) => {
    if (isMouseDownRef.current && mouseStartXRef.current !== null) {
      const diff = mouseStartXRef.current - e.clientX;
      const minSwipeDistance = 40;
      if (diff > minSwipeDistance) {
        // Dragged Left -> Next image
        setCurrentBillboardIndex(prev => (prev + 1) % billboardAds.length);
      } else if (diff < -minSwipeDistance) {
        // Dragged Right -> Prev image
        setCurrentBillboardIndex(prev => (prev === 0 ? billboardAds.length - 1 : prev - 1));
      }
    }
    isMouseDownRef.current = false;
    mouseStartXRef.current = null;
    setIsDraggingBillboard(false);
    setIsBillboardHovered(false);
  };

  const handleBillboardMouseLeave = () => {
    isMouseDownRef.current = false;
    mouseStartXRef.current = null;
    setIsDraggingBillboard(false);
    setIsBillboardHovered(false);
  };

  const handleAddBillboardAd = async () => {
    const finalImage = newImageFile || newImageUrl;
    if (!finalImage) return;

    const newAd: BillboardItem = {
      id: `billboard-${Date.now()}`,
      imageUrl: finalImage,
      title: newImageTitle.trim() || 'ป้ายโฆษณาหอพัก',
      description: newImageDesc.trim() || 'ป้ายประชาสัมพันธ์พิเศษแนวนอน 16:9',
      tag: newImageTag.trim() || 'ประชาสัมพันธ์'
    };

    try {
      const res = await httpRequest<any>('POST', '/billboard', newAd);
      if (res && res.data) {
        setBillboardAds(prev => [res.data, ...prev]);
      } else {
        setBillboardAds(prev => [newAd, ...prev]);
      }
    } catch {
      setBillboardAds(prev => [newAd, ...prev]);
    }

    setCurrentBillboardIndex(0);
    setNewImageFile(null);
    setNewImageUrl('');
    setNewImageTitle('');
    setNewImageDesc('');
    setNewImageTag('');
    setIsBillboardModalOpen(false);
    setShowSuccessToast('เพิ่มรูปภาพป้ายโฆษณา 16:9 สำเร็จแล้ว!');
    setTimeout(() => setShowSuccessToast(null), 3000);
  };

  const handleDeleteBillboardAd = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (billboardAds.length <= 1) {
      alert('จำเป็นต้องมีรูปภาพป้ายโฆษณาอย่างน้อย 1 รูป');
      return;
    }

    try {
      await httpRequest<any>('DELETE', `/billboard/${id}`);
    } catch (err) {
      console.error('Failed to delete billboard:', err);
    }

    const filtered = billboardAds.filter(ad => ad.id !== id);
    setBillboardAds(filtered);
    if (currentBillboardIndex >= filtered.length) {
      setCurrentBillboardIndex(0);
    }
  };

  const handleResetBillboardAds = async () => {
    try {
      const res = await httpRequest<any>('POST', '/billboard/reset');
      if (res && res.data) {
        setBillboardAds(res.data);
      } else {
        setBillboardAds(DEFAULT_BILLBOARD_ADS);
      }
    } catch {
      setBillboardAds(DEFAULT_BILLBOARD_ADS);
    }
    setCurrentBillboardIndex(0);
    setShowSuccessToast('รีเซ็ตเป็นป้ายโฆษณามาตรฐานเริ่มต้นแล้ว');
    setTimeout(() => setShowSuccessToast(null), 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewImageFile(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Real room count from props or fetched subInfo (never hardcoded 19)
  const currentRoomCount = rooms ? rooms.length : (subInfo.currentRooms ?? 0);

  // Helper for duration prices
  const getProDurationOption = (months: number) => {
    return PRO_DURATIONS.find(d => d.months === months) || PRO_DURATIONS[0];
  };

  const currentDurationOpt = getProDurationOption(durationMonths);
  const basePrice = currentDurationOpt.price;
  const promoDiscountAmount = serverQuote?.promoDiscountAmount !== undefined
    ? serverQuote.promoDiscountAmount
    : appliedPromo
      ? appliedPromo.discountPercent
        ? Math.round((basePrice * appliedPromo.discountPercent) / 100)
        : appliedPromo.discountAmount || 0
      : 0;
  const currentPrice = serverQuote?.finalPayableAmount !== undefined
    ? serverQuote.finalPayableAmount
    : Math.max(0, basePrice - promoDiscountAmount);

  // Synchronize server-authoritative quote whenever duration or promo changes in payment view
  useEffect(() => {
    if (isPaymentViewOpen) {
      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
      const pkg = packagesList.find(p => p.durationMonths === durationMonths);
      httpRequest<any>('POST', '/subscription/quote', {
        packageId: pkg?.id,
        promoCode: appliedPromo?.discountPercent ? appliedPromo.code : undefined,
        dormitoryId: activeDormId || undefined
      }).then(res => {
        if (res && res.data) {
          setServerQuote({
            intentId: res.data.intentId,
            finalPayableAmount: Number(res.data.finalPayableAmount),
            promoDiscountAmount: Number(res.data.promoDiscountAmount || 0),
            promoApplied: Boolean(res.data.promoApplied),
            promoCode: res.data.promoCode
          });
        }
      }).catch(err => {
        console.warn('Auto quote error:', err);
      });
    }
  }, [isPaymentViewOpen, durationMonths, appliedPromo?.code, appliedPromo?.discountPercent, packagesList, dormitoryId]);

  // Promo code actions: Redeem usage days (เพิ่มวันใช้งาน) or package discount (โค้ดส่วนลด)
  const handleApplyPromoCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = promoCodeInput.trim().toUpperCase();
    setPromoError(null);
    setPromoSuccessMsg(null);

    if (!cleanCode) {
      setPromoError('กรุณากรอกโค้ด');
      return;
    }

    // Check if the same code is already applied
    if (appliedPromo?.code === cleanCode) {
      setPromoCodeInput('');
      setPromoSuccessMsg(`โค้ด ${cleanCode} ใช้งานอยู่แล้ว`);
      showToast(`โค้ด ${cleanCode} ใช้งานอยู่แล้ว`, 'success');
      return;
    }

    try {
      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
      const redeemRes = await httpRequest<any>('POST', '/subscription/promo/redeem', { code: cleanCode }, {
        idempotencyKey: `promo-${cleanCode.toLowerCase()}-${Date.now()}`,
        dormitoryId: activeDormId || undefined
      });

      const promoResultData = redeemRes?.data?.promoResult || redeemRes?.data || {};
      const isDiscount = promoResultData.benefitType === 'PERCENT_DISCOUNT' || cleanCode === 'HNY2027';
      const candidateDiscountPercent = isDiscount ? (Number(promoResultData.benefitValue) || 10) : 0;

      if (isDiscount) {
        const currentDiscountPercent = appliedPromo?.discountPercent || 0;
        const discountAmount = Math.round((basePrice * candidateDiscountPercent) / 100);

        if (currentDiscountPercent > 0 && candidateDiscountPercent <= currentDiscountPercent) {
          // New code discount is lower or equal -> Voided from checkout, but quota is already consumed in DB!
          setPromoCodeInput('');
          setPromoSuccessMsg(`ใช้สิทธิ์โค้ด ${cleanCode} สำเร็จ แต่โค้ด ${appliedPromo!.code} ให้ส่วนลดมากกว่า (${currentDiscountPercent}%) ระบบจึงคงสิทธิ์ส่วนลดสูงสุดไว้ (สิทธิ์โค้ด ${cleanCode} ถูกบันทึกแล้ว)`);
          showToast(`โค้ด ${appliedPromo!.code} มีส่วนลดมากกว่า (${currentDiscountPercent}%) ระบบจึงคงโค้ดเดิมไว้ (สิทธิ์โค้ด ${cleanCode} ถูกใช้งานแล้ว)`, 'success');
          return;
        }

        // Higher discount code -> Override existing (old code was already redeemed in DB, now voided from checkout)
        const promoData = {
          code: cleanCode,
          discountPercent: candidateDiscountPercent,
          discountAmount,
          description: promoResultData.benefitLabel || `ส่วนลดแพ็กเกจ ${candidateDiscountPercent}%`
        };
        setAppliedPromo(promoData);
        setPromoCodeInput('');

        // Refresh quote for payment view
        const pkg = packagesList.find(p => p.durationMonths === durationMonths);
        httpRequest<any>('POST', '/subscription/quote', {
          packageId: pkg?.id,
          promoCode: cleanCode,
          dormitoryId: activeDormId || undefined
        }).then(quoteRes => {
          if (quoteRes && quoteRes.data) {
            const q = quoteRes.data;
            setServerQuote({
              intentId: q.intentId,
              finalPayableAmount: Number(q.finalPayableAmount),
              promoDiscountAmount: Number(q.promoDiscountAmount || 0),
              promoApplied: true,
              promoCode: cleanCode
            });
          }
        }).catch(() => {});

        const successText = currentDiscountPercent > 0
          ? `ใช้โค้ด ${cleanCode} สำเร็จ: ได้รับส่วนลด ${candidateDiscountPercent}% (-฿${discountAmount.toLocaleString()}) สูงกว่าโค้ดเดิม (โค้ดเดิมถูกยกเลิก)`
          : `ใช้โค้ด ${cleanCode} สำเร็จ: ได้รับส่วนลด ${candidateDiscountPercent}% (-฿${discountAmount.toLocaleString()})`;
        setPromoSuccessMsg(successText);
        showToast(`ใช้โค้ด ${cleanCode} สำเร็จ! ได้รับส่วนลด ${candidateDiscountPercent}%`, 'success');

        if (onAddLog) {
          onAddLog(
            'ใช้โค้ดส่วนลด',
            `ใช้รหัสโค้ด ${cleanCode} รับส่วนลด ${candidateDiscountPercent}% (-฿${discountAmount})`,
            'promo',
            cleanCode
          );
        }
      } else {
        // Benefit is extension days (e.g. HORPLUS)
        await fetchCurrentSubscription();
        const promoData = {
          code: cleanCode,
          daysBonus: promoResultData.bonusDays || 60,
          description: `เพิ่มวันใช้งานฟรี +${promoResultData.bonusDays || 60} วัน (2 เดือน) สำเร็จ`
        };
        setAppliedPromo(promoData);
        setPromoCodeInput('');
        setPromoSuccessMsg(`ใช้โค้ด ${cleanCode} สำเร็จ: เพิ่มวันใช้งาน +${promoData.daysBonus} วัน เรียบร้อยแล้ว`);
        showToast(`ใช้โค้ด ${cleanCode} สำเร็จ! เพิ่มวันใช้งาน +${promoData.daysBonus} วัน`, 'success');

        if (onAddLog) {
          onAddLog(
            'ใช้โค้ดเพิ่มวันใช้งาน',
            `ใช้รหัสโค้ด ${cleanCode} เพิ่มวันใช้งาน +${promoData.daysBonus} วัน`,
            'promo',
            cleanCode
          );
        }
      }
    } catch (err: any) {
      setPromoError(err.message || 'ไม่สามารถใช้โค้ดนี้ได้ หรือสิทธิ์ครบตามจำนวนที่กำหนดแล้ว');
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    try {
      localStorage.removeItem('HorPlus_applied_promo');
    } catch { }
    setServerQuote(null);
    setPromoSuccessMsg(null);
    setPromoError(null);
    setShowSuccessToast(null);
  };

  // Dynamic PromptPay QR generation using promptpay utility (EMVCo standard)
  useEffect(() => {
    if (isPaymentViewOpen) {
      setIsGeneratingQr(true);
      const ppId = promptPayConfig.promptPayId || '0935098808';
      generatePromptPayQrDataUrl(ppId, currentPrice)
        .then(url => {
          setQrCodeDataUrl(url);
          setIsGeneratingQr(false);
        })
        .catch(err => {
          console.error('Error generating QR:', err);
          setQrCodeDataUrl('');
          setIsGeneratingQr(false);
        });
    }
  }, [isPaymentViewOpen, currentPrice, promptPayConfig.promptPayId]);

  // Calculate new Thai expiry date string
  const calculateNewExpiryDate = (daysToAdd: number) => {
    const now = new Date();
    const baseTime = subInfo.planId === 'free' ? now.getTime() : now.getTime() + (subInfo.daysLeft * 86400000);
    const targetDate = new Date(baseTime + (daysToAdd * 86400000));
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    return `${targetDate.getDate()} ${thaiMonths[targetDate.getMonth()]} ${targetDate.getFullYear() + 543}`;
  };

  const handleSelectPricingCard = (card: PricingCardData) => {
    // HORPLUS FREE cannot be manually selected/purchased - system automatically downgrades to free upon expiration
    if (card.planId === 'free') {
      return;
    }
    setDurationMonths(card.durationMonths);
    setSelectedPlanToRenew(AVAILABLE_PLANS[1]);
    setUploadedSlip(null);
    setSelectedSlipFile(null);
    setIsVerifyingSlip(false);
    setIsVerifiedSuccess(false);
    setSuccessReceipt(null);
    setIsPaymentViewOpen(true);
  };

  const handleClosePaymentView = () => {
    setIsPaymentViewOpen(false);
    setUploadedSlip(null);
    setSelectedSlipFile(null);
    setIsVerifyingSlip(false);
    setIsVerifiedSuccess(false);
    setSuccessReceipt(null);
  };

  const handleCelebrationComplete = () => {
    setIsCelebrationOpen(false);
    handleClosePaymentView();
    fetchCurrentSubscription();
    setShowSuccessToast('🎉 ต่ออายุแพ็กเกจ HORPLUS PRO สำเร็จเรียบร้อยแล้ว!');
    setTimeout(() => setShowSuccessToast(null), 3500);
  };

  const handleCopyPromptPay = () => {
    const ppId = promptPayConfig.promptPayId || '0935098808';
    navigator.clipboard.writeText(ppId).then(() => {
      setCopyToast(`คัดลอกหมายเลขพร้อมเพย์ ${ppId} แล้ว!`);
      setTimeout(() => setCopyToast(null), 2500);
    });
  };

  const handleDownloadQr = async () => {
    if (!qrCodeDataUrl) return;
    const ppId = promptPayConfig.promptPayId || '0935098808';
    const accName = promptPayConfig.accountName || 'นายภูวนาท ทานาลาด';
    try {
      setIsDownloadingCard(true);
      setCopyToast('กำลังบันทึกรูป QR Code พร้อมรายละเอียด...');
      await downloadPromptPayCardImage({
        qrDataUrl: qrCodeDataUrl,
        promptPayId: ppId.length === 10 ? `${ppId.slice(0, 3)}-${ppId.slice(3, 6)}-${ppId.slice(6)}` : ppId,
        accountName: accName,
        amount: currentPrice,
        planName: 'HORPLUS PRO',
        durationLabel: currentDurationOpt.label
      });
      setCopyToast('บันทึกรูป QR Code พร้อมรายละเอียดเรียบร้อยแล้ว!');
      setTimeout(() => setCopyToast(null), 3000);
    } catch (err) {
      console.error('Failed to download full QR card, falling back to raw QR:', err);
      const a = document.createElement('a');
      a.href = qrCodeDataUrl;
      a.download = `PromptPay-${ppId}-${currentPrice}THB.png`;
      a.click();
      setCopyToast('บันทึกรูป QR Code แล้ว!');
      setTimeout(() => setCopyToast(null), 2500);
    } finally {
      setIsDownloadingCard(false);
    }
  };

  // Slip upload and real verification via backend API
  const handleSlipFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSlipFile(file);
    }
  };

  const handleSlipDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSlipFile(file);
    }
  };

  const processSlipFile = (file: File) => {
    setSelectedSlipFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setUploadedSlip(dataUrl);
      startSlipVerification(file);
    };
    reader.readAsDataURL(file);
  };

  const startSlipVerification = async (fileToUpload?: File) => {
    const targetFile = fileToUpload || selectedSlipFile;
    if (!targetFile) return;

    setIsVerifyingSlip(true);
    setVerifyStep(1);

    const activeDormId = sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';

    // Step 1: Scanning (UI animation)
    await new Promise(r => setTimeout(r, 600));
    setVerifyStep(2);

    // Step 2: Server Verification
    try {
      const formData = new FormData();
      formData.append('file', targetFile);
      formData.append('durationMonths', durationMonths.toString());
      if (serverQuote?.intentId) {
        formData.append('intentId', serverQuote.intentId);
      }
      if (appliedPromo?.code) {
        formData.append('promoCode', appliedPromo.code);
      }

      const activeDormId = dormitoryId || sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
      const json = await httpRequest<any>('POST', '/subscription/payment/slip', formData, {
        dormitoryId: activeDormId || undefined
      });

      if (!json || !json.success) {
        throw new Error(json?.message || 'เกิดข้อผิดพลาดในการตรวจสอบสลิป');
      }

      setVerifyStep(3);
      await new Promise(r => setTimeout(r, 400));

      const data = json.data;
      const daysToAdd = data.daysAdded || currentDurationOpt.days;
      const newExpDate = data.newExpiryDate;
      const orderId = data.orderId || `HP-SUB-${Date.now().toString().slice(-6)}`;

      await fetchCurrentSubscription();

      if (onAddLog) {
        onAddLog(
          'ต่ออายุแพ็กเกจ',
          `ต่ออายุ HORPLUS PRO (${durationMonths} เดือน เพิ่ม ${daysToAdd} วัน) ยอด ฿${Number(data.paidAmount).toLocaleString()} ผ่านพร้อมเพย์`,
          'subscription',
          orderId
        );
      }

      setSuccessReceipt({
        orderId,
        receiptNumber: data.receiptNumber,
        paidAmount: Number(data.paidAmount) || currentPrice,
        planName: 'HORPLUS PRO',
        durationMonths,
        daysAdded,
        previousDaysLeft: data.previousDaysLeft,
        newDaysLeft: data.newDaysLeft,
        previousExpiryDate: data.previousExpiryDate,
        newExpiryDate: newExpDate,
        paidAt: data.paidAt ? new Date(data.paidAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
      });

      setIsVerifyingSlip(false);
      setIsVerifiedSuccess(true);
      // แสดงเอฟเฟกต์เฉลิมฉลองการอัปเกรดเป็นกล่องการ์ดป๊อปอัป พร้อมเปรียบเทียบวันเดิมสู่วันใหม่ชัดเจน
      setIsCelebrationOpen(true);
    } catch (err: any) {
      setIsVerifyingSlip(false);
      setVerifyStep(0);
      setSelectedSlipFile(null);
      setUploadedSlip(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      alert(`การตรวจสอบสลิปล้มเหลว: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyToast(`คัดลอก ${label} แล้ว!`);
      setTimeout(() => setCopyToast(null), 2500);
    });
  };

  const handleOpenRenewModal = (plan: PlanOption) => {
    if (plan.id === 'free') return;
    setSelectedPlanToRenew(plan);
    setUploadedSlip(null);
    setIsVerifyingSlip(false);
    setIsVerifiedSuccess(false);
    setSuccessReceipt(null);
    setIsPaymentViewOpen(true);
  };

  // Handle refresh status button
  const handleRefreshStatus = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setShowSuccessToast('อัปเดตสถานะแพ็กเกจและโควต้าห้องพักเรียบร้อยแล้ว');
      setTimeout(() => setShowSuccessToast(null), 2500);
    }, 600);
  };

  // Full-page Payment View (คล้ายเมนูงานแจ้งซ่อม ไม่ใช่แบบ popup)
  if (isPaymentViewOpen) {
    return (
      <div className="w-full h-full min-h-0 flex flex-col bg-slate-50 animate-in fade-in duration-200">
        {/* Toast Notification (Soft White Backdrop-Blur with Smooth Fade) */}
        {toastData && (
          <div
            className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white/95 backdrop-blur-md text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-3 text-xs sm:text-sm font-bold transition-all duration-400 ease-in-out max-w-[92vw] sm:max-w-md ${isToastFading
              ? 'opacity-0 translate-y-3 scale-95 pointer-events-none'
              : 'opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-bottom-3 duration-300'
              }`}
          >
            <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${toastData.type === 'copy'
              ? 'bg-blue-50 text-blue-600 border border-blue-100'
              : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
              }`}>
              {toastData.type === 'copy' ? (
                <Check className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4.5 h-4.5" />
              )}
            </div>
            <span className="truncate">{toastData.message}</span>
          </div>
        )}

        {/* Top Header: Sticky with back button on top-leftmost */}
        <header className="shrink-0 bg-white border-b border-slate-200/80 px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between shadow-xs z-20 -mt-[1px]">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 font-sans">
            <button
              type="button"
              onClick={isVerifiedSuccess ? handleReturnToHome : handleClosePaymentView}
              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 -ml-2 rounded-xl text-slate-700 hover:text-blue-600 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer font-extrabold text-xs sm:text-sm shrink-0 group"
              title="ย้อนกลับ"
            >
              <span>กลับ</span>
            </button>

            <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0 stroke-[2.5]" />

            <span className="px-1.5 sm:px-2 py-1.5 text-slate-800 font-extrabold text-xs sm:text-sm shrink-0 select-none">
              ชำระเงินเพื่อต่ออายุแพ็กเกจ
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={isVerifiedSuccess ? handleReturnToHome : handleClosePaymentView}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              title="ปิดหน้าต่าง"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto min-h-0 px-3 sm:px-6 py-5 sm:py-6">
          {isVerifiedSuccess && successReceipt ? (
            /* Celebration Success Screen (Minimal) */
            <div className="max-w-md mx-auto space-y-4 pb-12 animate-in zoom-in-95 duration-200">
              <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3 ring-6 ring-emerald-50/60 text-emerald-600">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <h3 className="text-lg font-black text-slate-900 mb-0.5">
                  ต่ออายุแพ็กเกจสำเร็จ
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  ระบบตรวจสอบยอดเงินเข้าบัญชีเรียบร้อยแล้ว
                </p>

                {/* Receipt Details Box (แสดงแค่ข้อมูลจำเป็น: เวลาหมดอายุ, ยอดชำระ) */}
                <div className="mt-5 bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-left space-y-2.5 text-xs">
                  <div className="flex justify-between items-center pb-2.5 border-b border-slate-200/80">
                    <span className="text-slate-500 font-medium">เวลาหมดอายุ:</span>
                    <span className="font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                      {successReceipt.newExpiryDate}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-900">ยอดชำระ:</span>
                    <span className="text-base font-black text-blue-600">
                      ฿{successReceipt.paidAmount.toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Return Button (กดปุ่มกลับ ให้ไปยังเมนูหน้าแรก) */}
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={handleReturnToHome}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all cursor-pointer"
                  >
                    กลับสู่เมนูหน้าแรก
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Side-by-Side Minimal Layout */
            <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 pb-12 items-start">
              {/* Card 1: สรุปแพ็กเกจ & เลือกระยะเวลา (Top Left on desktop, 1st on mobile) */}
              <div className="order-1 bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-black text-slate-900">HORPLUS PRO</span>
                  </div>
                  <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                    สูงสุด 150 ห้อง
                  </span>
                </div>

                {/* Duration selector buttons */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">เลือกระยะเวลา:</span>
                    <span className="font-bold text-blue-600">
                      {currentDurationOpt.label} (+{currentDurationOpt.days} วัน)
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {PRO_DURATIONS.map(d => {
                      const discountPercent = appliedPromo?.discountPercent || 0;
                      const buttonDiscount = discountPercent > 0 ? Math.round((d.price * discountPercent) / 100) : 0;
                      const buttonPrice = discountPercent > 0 ? d.price - buttonDiscount : d.price;

                      return (
                        <button
                          key={d.months}
                          type="button"
                          onClick={() => setDurationMonths(d.months)}
                          className={`py-2 px-1 text-center rounded-xl border text-xs transition-all cursor-pointer ${durationMonths === d.months
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-black ring-2 ring-blue-500/20'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 font-bold'
                            }`}
                        >
                          <div className="text-[11px] leading-tight">{d.shortLabel}</div>
                          <div className="text-[10px] opacity-90 font-medium mt-0.5">฿{buttonPrice.toLocaleString()}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Price Summary */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-500 font-medium block">ยอดชำระ</span>
                    <span className="text-[11px] text-slate-400">
                      เฉลี่ย ฿{durationMonths > 0 ? Math.round(currentPrice / durationMonths).toLocaleString() : currentDurationOpt.perMonthPrice}/เดือน
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-blue-600">
                      ฿{currentPrice.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: พร้อมเพย์ QR Code (Right column spanning on desktop, 2nd on mobile) */}
              <div className="order-2 lg:row-span-2 bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-black text-slate-900">พร้อมเพย์ (PromptPay)</span>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    ใช้งานได้ทันที
                  </span>
                </div>

                {/* QR Code Container */}
                <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200/80 text-center space-y-3">
                  <div className="flex items-center justify-center py-0.5">
                    <img
                      src="https://upload.wikimedia.org/wikipedia/commons/2/28/Thai_QR_Logo.svg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original"
                      alt="Thai QR Payment"
                      className="h-8 sm:h-9 w-auto max-w-[150px] object-contain mx-auto drop-shadow-2xs"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  <div className="relative w-44 h-44 sm:w-48 sm:h-48 mx-auto bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-center">
                    {isGeneratingQr ? (
                      <div className="flex flex-col items-center gap-1.5 text-slate-400 text-xs">
                        <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                        <span>กำลังสร้าง QR...</span>
                      </div>
                    ) : qrCodeDataUrl ? (
                      <img
                        src={qrCodeDataUrl}
                        alt={`PromptPay ฿${currentPrice}`}
                        className="w-full h-full object-contain rounded-lg"
                      />
                    ) : (
                      <span className="text-xs text-slate-400">ไม่สามารถโหลด QR Code ได้</span>
                    )}
                  </div>

                  {/* Recipient info & amount */}
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-center gap-2">
                      <span className="font-mono font-black text-slate-800 text-sm">
                        {promptPayConfig.promptPayId.length === 10
                          ? `${promptPayConfig.promptPayId.slice(0, 3)}-${promptPayConfig.promptPayId.slice(3, 6)}-${promptPayConfig.promptPayId.slice(6)}`
                          : promptPayConfig.promptPayId}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyPromptPay}
                        className="p-1 text-slate-500 hover:text-blue-600 hover:bg-white rounded-md transition-colors cursor-pointer"
                        title="คัดลอกหมายเลขพร้อมเพย์"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-slate-600 font-medium text-[11px]">{promptPayConfig.accountName}</div>
                    <div className="text-blue-600 font-extrabold text-sm pt-0.5">
                      ฿{currentPrice.toLocaleString()} บาท
                    </div>
                  </div>

                  {/* Download QR button */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      disabled={isDownloadingCard}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer shadow-2xs disabled:opacity-60"
                    >
                      {isDownloadingCard ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{isDownloadingCard ? 'กำลังบันทึกรูป...' : 'บันทึกรูป QR Code'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 3: แนบสลิปโอนเงิน (Bottom Left on desktop, 3rd on mobile) */}
              <div className="order-3 bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-black text-slate-900">แนบสลิปโอนเงิน</span>
                  </div>
                  <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                    ตรวจสลิปอัตโนมัติ
                  </span>
                </div>

                {/* Hidden native file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleSlipFileSelect}
                  className="hidden"
                />

                {/* Verification Progress or Upload Area */}
                {isVerifyingSlip ? (
                  <div className="bg-slate-50 rounded-2xl p-4 border border-blue-300 text-center space-y-2.5">
                    <div className="relative w-14 h-14 mx-auto rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                      {uploadedSlip && <img src={uploadedSlip} alt="Slip" className="w-full h-full object-cover" />}
                      <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 text-white animate-spin" />
                      </div>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">กำลังตรวจสอบสลิป...</span>
                      <span className="text-[11px] text-blue-600 font-medium">
                        {verifyStep === 1 && 'อ่านข้อมูลสลิป'}
                        {verifyStep === 2 && `ตรวจยอด ฿${currentPrice.toLocaleString()}`}
                        {verifyStep === 3 && 'ความถูกต้องสมบูรณ์'}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-300"
                        style={{ width: verifyStep === 1 ? '35%' : verifyStep === 2 ? '75%' : '100%' }}
                      />
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleSlipDrop}
                    className="group p-5 rounded-2xl border-2 border-dashed border-slate-200 hover:border-blue-400 bg-slate-50/60 hover:bg-blue-50/20 text-center cursor-pointer transition-all"
                  >
                    <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center mx-auto mb-2 text-slate-400 group-hover:text-blue-600 transition-colors">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-800 block group-hover:text-blue-600 transition-colors">
                      คลิกแนบสลิป หรือลากไฟล์มาวาง
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium block mt-0.5">
                      JPG, PNG
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full space-y-6 animate-in fade-in duration-200">
      {/* Toast Notification (Soft White Backdrop-Blur with Smooth Fade) */}
      {toastData && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white/95 backdrop-blur-md text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-3 text-xs sm:text-sm font-bold transition-all duration-400 ease-in-out max-w-[92vw] sm:max-w-md ${isToastFading
            ? 'opacity-0 translate-y-3 scale-95 pointer-events-none'
            : 'opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${toastData.type === 'copy'
            ? 'bg-blue-50 text-blue-600 border border-blue-100'
            : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
            }`}>
            {toastData.type === 'copy' ? (
              <Check className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4.5 h-4.5" />
            )}
          </div>
          <span className="truncate">{toastData.message}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-start justify-between gap-3 pb-1">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
            <Crown className="w-6 h-6 text-blue-600 shrink-0" />
            <span>ต่อแพ็กเกจ</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            จัดการสถานะแพ็กเกจ โควตาห้องพัก และการต่ออายุสมาชิก
          </p>
        </div>

        <div className="shrink-0 pt-0.5 flex items-center gap-2">
          <button
            onClick={handleRefreshStatus}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 text-xs sm:text-sm font-bold text-slate-700 shadow-2xs transition-all cursor-pointer active:scale-95 disabled:opacity-70 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>รีเฟรชสถานะ</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: สรุปสถานะแพ็กเกจ 3 ช่อง */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
        {/* Card 1: แพ็กเกจปัจจุบัน */}
        <div className={`rounded-2xl p-4 sm:p-5 lg:p-6 flex flex-col justify-between transition-all duration-300 ${subInfo.planId !== 'free'
          ? 'border-0 bg-gradient-to-br from-[#FFF8EB] via-[#FFFDF7] to-[#FEF3D6] shadow-sm shadow-amber-900/5'
          : 'bg-white rounded-2xl border border-slate-200/80 shadow-xs'
          }`}>
          <div>
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <span className={`text-[11px] font-bold tracking-wider flex items-center gap-1.5 ${subInfo.planId !== 'free' ? 'text-amber-800/80' : 'text-slate-500'
                }`}>
                {subInfo.planId !== 'free' && <Crown className="w-3.5 h-3.5 text-amber-500 fill-amber-400 animate-pulse" />}
                <span>แพ็กเกจปัจจุบัน</span>
              </span>
              {subInfo.planId !== 'free' ? (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs flex items-center gap-1">
                  <Crown className="w-3 h-3 fill-white" />
                  <span>PRO</span>
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  ใช้งานอยู่
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl sm:text-2xl lg:text-[26px] font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>{subInfo.planId === 'free' ? 'HORPLUS FREE' : (subInfo.planName || 'HORPLUS PRO')}</span>
                {subInfo.planId !== 'free' && (
                  <Crown className="w-6 h-6 text-amber-500 fill-amber-400 shrink-0 drop-shadow-[0_2px_8px_rgba(245,158,11,0.5)] animate-bounce" />
                )}
              </h3>
            </div>
            <p className="text-xs sm:text-sm font-medium mt-1 flex items-center gap-1.5">
              {subInfo.planId !== 'free' ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="text-amber-900/75">แพ็กเกจขั้นสูงสุด สิทธิพิเศษ Pro</span>
                </>
              ) : (
                <span className="text-slate-500">แพ็กเกจเริ่มต้นใช้งาน</span>
              )}
            </p>
          </div>

          <div className={`mt-6 sm:mt-8 pt-3 sm:pt-4 flex items-center justify-between text-xs sm:text-sm ${subInfo.planId !== 'free' ? 'border-t border-amber-200/50' : 'border-t border-slate-100'
            }`}>
            <span className={subInfo.planId !== 'free' ? 'text-amber-900/70 font-medium' : 'text-slate-400 font-medium'}>วันหมดอายุ:</span>
            {subInfo.planId !== 'free' ? (
              <span className="text-amber-950 font-bold text-xs sm:text-sm flex items-center gap-1.5 bg-amber-100/80 px-2.5 py-0.5 rounded-md border border-amber-200/70 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>{subInfo.expiryDate || '1 ม.ค. 2570'}</span>
                <span className="text-amber-700 text-[11px] font-semibold">({subInfo.daysLeft} วัน)</span>
              </span>
            ) : (
              <span className="text-slate-800 font-bold text-xs sm:text-sm">ฟรีถาวร</span>
            )}
          </div>
        </div>

        {/* Card 2: จำนวนตรวจสลิป */}
        {(() => {
          const freeSlipsUsed = typeof subInfo.freeSlipsUsed === 'number' ? subInfo.freeSlipsUsed : 0;
          const slipsChecked = typeof subInfo.slipsChecked === 'number' ? subInfo.slipsChecked : 0;
          const isFree = subInfo.planId === 'free';
          const freeMax = 5;
          const freeRatio = Math.min(1, freeSlipsUsed / freeMax);
          const freePercent = Math.round(freeRatio * 100);

          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 lg:p-6 shadow-xs flex flex-col justify-between relative overflow-hidden group">
              <div>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-[11px] font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-slate-400" />
                    <span>จำนวนตรวจสลิป</span>
                  </span>
                  {isFree ? (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      FREE
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs flex items-center gap-1">
                      <Crown className="w-3 h-3 fill-white" />
                      <span>PRO</span>
                    </span>
                  )}
                </div>

                {isFree ? (
                  <>
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl lg:text-[26px] font-black text-slate-900 tracking-tight">
                          {freeSlipsUsed}
                        </span>
                        <span className="text-sm sm:text-base font-bold text-slate-400">
                          / {freeMax} สลิป
                        </span>
                      </div>
                      <span className="text-xs font-bold text-slate-500">
                        ใช้ไป {freePercent}%
                      </span>
                    </div>
                    {/* Progress bar matching Card 3 styling */}
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mt-3.5 p-0.5 border border-slate-200/80 shadow-inner relative">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-400 transition-all duration-700 ease-out shadow-xs shadow-emerald-500/20 relative overflow-hidden"
                        style={{ width: `${Math.max(4, freePercent)}%` }}
                      >
                        {/* Shimmer pulse effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl lg:text-[26px] font-black text-slate-900 tracking-tight">
                          {slipsChecked}
                        </span>
                        <span className="text-sm sm:text-base font-bold text-slate-400 flex items-center gap-1">
                          <span>/</span>
                          <span className="inline-flex items-center text-emerald-600 font-extrabold -mb-0.5">
                            <InfinityIcon className="w-5 h-5 stroke-[2.75] text-emerald-600 drop-shadow-2xs" />
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200/70 text-emerald-700">
                        <InfinityIcon className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span className="text-xs font-black">ไม่จำกัด</span>
                      </div>
                    </div>

                    {/* Pro Infinity Glowing Progress Bar matching Card 3 styling */}
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mt-3.5 p-0.5 border border-slate-200/80 shadow-inner relative">
                      <div
                        className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 shadow-xs shadow-emerald-500/25 relative overflow-hidden"
                      >
                        {/* Continuous Shimmer pulse effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/45 to-transparent animate-[pulse_1.5s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 sm:mt-8 pt-3 sm:pt-4 border-t border-slate-100 flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-400 font-medium">โควตาคงเหลือ:</span>
                <span className={isFree ? 'text-slate-800 font-bold' : 'text-emerald-600 font-bold flex items-center gap-1.5'}>
                  {isFree ? (
                    'ฟรี 5 สลิป/เดือน'
                  ) : (
                    <>
                      <span>ไม่จำกัด (PRO)</span>
                    </>
                  )}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Card 3: โควตาห้องพัก พร้อมหลอด Effect และสีเปลี่ยนตามสัดส่วน */}
        {(() => {
          const maxRooms = Number(subInfo.maxRooms || 150);
          const currentCount = currentRoomCount;
          const ratio = maxRooms > 0 ? (currentCount / maxRooms) : 0;
          const percentage = Math.min(100, Math.round(ratio * 100));
          const remainingRooms = Math.max(0, maxRooms - currentCount);
          const isFree = subInfo.planId === 'free';

          let barGradient = 'from-emerald-500 via-teal-500 to-emerald-400';
          let barShadow = 'shadow-emerald-500/20';

          if (percentage >= 90) {
            barGradient = 'from-rose-500 via-red-500 to-rose-400';
            barShadow = 'shadow-rose-500/20';
          } else if (percentage >= 70) {
            barGradient = 'from-amber-500 via-orange-500 to-amber-400';
            barShadow = 'shadow-amber-500/20';
          }

          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 lg:p-6 shadow-xs flex flex-col justify-between relative overflow-hidden group">
              <div>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <span className="text-[11px] font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-slate-400" />
                    <span>จำนวนห้องพัก</span>
                  </span>
                  {isFree ? (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      FREE
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs flex items-center gap-1">
                      <Crown className="w-3 h-3 fill-white" />
                      <span>PRO</span>
                    </span>
                  )}
                </div>

                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl sm:text-2xl lg:text-[26px] font-black text-slate-900 tracking-tight">
                      {currentCount}
                    </span>
                    <span className="text-sm sm:text-base font-bold text-slate-400">
                      / {maxRooms} ห้อง
                    </span>
                  </div>
                  <span className="text-xs font-bold text-slate-500">
                    ใช้ไป {percentage}%
                  </span>
                </div>

                {/* Progress Bar with glowing effect and dynamic colors */}
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden mt-3.5 p-0.5 border border-slate-200/80 shadow-inner relative">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-700 ease-out shadow-xs ${barShadow} relative overflow-hidden`}
                    style={{
                      width: `${Math.max(3, Math.min(100, percentage))}%`
                    }}
                  >
                    {/* Shimmer pulse effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
                  </div>
                </div>
              </div>

              <div className="mt-6 sm:mt-8 pt-3 sm:pt-4 border-t border-slate-100 flex items-center justify-between text-xs sm:text-sm">
                <span className="text-slate-400 font-medium">โควตาคงเหลือ:</span>
                <span className="text-slate-900 font-bold">
                  {remainingRooms} ห้อง
                </span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* SECTION 2: เลือกแพ็กเกจ (แสดงครบทุกการ์ด ทั้ง HORPLUS FREE และ HORPLUS PRO ทุกระยะเวลา) */}
      <div className="space-y-4 pt-2">
        {/* Pricing Cards Grid (Multi-Cards: 1 FREE + 5 PRO options) - รองรับ iPad แนวนอนแสดง 2 คอลัมน์ (xl:grid-cols-3) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6 pt-3">
          {ALL_PRICING_CARDS.map((card, cardIndex) => {
            const isFree = card.planId === 'free';
            const discountPercent = appliedPromo?.discountPercent || 0;
            const discountAmount = !isFree && discountPercent > 0
              ? Math.round((card.price * discountPercent) / 100)
              : 0;
            const effectivePrice = !isFree && discountPercent > 0
              ? card.price - discountAmount
              : card.price;
            const effectivePerMonthPrice = !isFree && discountPercent > 0 && card.durationMonths > 0
              ? Math.round(effectivePrice / card.durationMonths)
              : card.perMonthPrice;

            return (
              <div
                key={card.id}
                onClick={() => !isFree && handleSelectPricingCard(card)}
                className={`group relative rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all duration-300 ${isFree
                  ? 'bg-slate-50/70 border border-slate-200/90 shadow-2xs cursor-default opacity-90'
                  : 'bg-white border border-slate-200/90 hover:border-blue-400 shadow-xs hover:-translate-y-2 hover:shadow-xl cursor-pointer'
                  }`}
              >
                {/* Sweep Light Effect: ทั้งก่อนชี้ (Ambient Sweep วิ่งวนนุ่มนวลเป็นจังหวะ) และตอนชี้ / ตอนลากเมาส์ออก (Interactive Sweep Beam) */}
                {!isFree && (
                  <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none z-0">
                    {/* 1. ก่อนชี้: Ambient sweep light วิ่งวนเรื่อยๆ อย่างมีจังหวะตามลำดับการ์ด */}
                    <div
                      className="absolute inset-0 pointer-events-none animate-ambient-card-sweep flex items-center justify-center"
                      style={{ animationDelay: `${(cardIndex % 3) * 1.5}s` }}
                    >
                      <div className="w-32 h-[850px] bg-gradient-to-r from-transparent via-white/55 to-transparent pointer-events-none" />
                    </div>

                    {/* 2. ตอนชี้ และ ตอนลากเมาส์ออก: Interactive Sweep Beam วิ่งพาดผ่านตอน Hover และค่อยๆ วิ่งสะท้อนกลับสวยงามตอน Mouse Leave */}
                    <div className="card-sweep-beam" />
                  </div>
                )}

                {/* Top Badge (แสดงนอกกรอบ ไม่ถูกตัดขอบ) */}
                {card.discountBadge && (
                  <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-black px-4 py-1 rounded-full shadow-md flex items-center gap-1.5 whitespace-nowrap z-20 transition-transform duration-300 ${!isFree ? 'group-hover:scale-105' : ''} ${card.popular
                    ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white shadow-blue-500/30 ring-2 ring-white'
                    : card.bestValue
                      ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white shadow-amber-500/30 ring-2 ring-white'
                      : isFree
                        ? 'bg-slate-600 text-white ring-2 ring-white'
                        : 'bg-rose-500 text-white ring-2 ring-white'
                    }`}>
                    {card.popular && <Crown className="w-3.5 h-3.5 text-amber-300 animate-bounce" />}
                    {card.bestValue && <Crown className="w-3.5 h-3.5 text-amber-200 animate-bounce" />}
                    <span>{isFree ? 'ฟรีถาวร' : card.discountBadge}</span>
                  </div>
                )}

                <div className="relative z-10">
                  {/* Title & Duration */}
                  <div className="flex items-center justify-between mb-2 mt-1">
                    <h4 className={`text-lg font-black ${isFree ? 'text-slate-800' : 'text-slate-900 group-hover:text-blue-600 transition-colors'}`}>
                      {card.name}
                    </h4>
                    <span className={`text-xs font-black px-2.5 py-1 rounded-xl ${isFree ? 'bg-slate-200/70 text-slate-600' : 'bg-slate-100 text-slate-700 group-hover:bg-blue-50 group-hover:text-blue-700 transition-colors'}`}>
                      {card.durationLabel}
                    </span>
                  </div>

                  {/* Price Box with Animated Strikethrough and Pop */}
                  <div className={`py-4 px-4 rounded-2xl mb-4 border transition-all ${isFree
                    ? 'bg-white/80 border-slate-200/70'
                    : 'bg-slate-50/90 group-hover:bg-blue-50/50 border-slate-100 group-hover:border-blue-200/70'
                    }`}>
                    {isFree ? (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-3xl font-black text-slate-800">฿0</span>
                          <span className="text-xs text-slate-500 font-bold">/ ตลอดการใช้งาน</span>
                        </div>
                        <div className="text-[11px] font-bold text-slate-500 mt-1 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>ปรับเป็นแพ็กเกจนี้อัตโนมัติเมื่อหมดอายุ</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {/* Animated Strikethrough for full price */}
                        {card.originalPrice && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-bold">ราคาเต็ม</span>
                            <span className="relative inline-block text-xs font-black text-slate-400 font-mono tracking-tight">
                              ฿{card.originalPrice.toLocaleString()}
                              <span className="absolute left-0 top-1/2 w-full h-[2px] bg-rose-500 -rotate-6 transition-all duration-300 group-hover:scale-x-110 group-hover:bg-rose-600" />
                            </span>
                            <span className="text-[10px] font-black px-1.5 py-0.2 rounded-md bg-rose-100 text-rose-700 animate-pulse">
                              {discountPercent > 0 ? `ลด ${discountPercent}%` : 'ลดพิเศษ'}
                            </span>
                          </div>
                        )}

                        {/* Special Discounted Price */}
                        <div className="flex items-baseline justify-between gap-1 flex-wrap pt-0.5">
                          <div className="flex items-baseline gap-1">
                            <span className="text-sm font-bold text-slate-400">฿</span>
                            <span className="text-3xl sm:text-4xl font-black text-slate-900 group-hover:text-blue-600 group-hover:scale-105 transition-all tracking-tight">
                              {effectivePrice.toLocaleString()}
                            </span>
                            <span className="text-xs font-bold text-slate-500">
                              / {card.durationLabel}
                            </span>
                          </div>

                          <span className="text-xs font-black text-blue-700 bg-blue-100/90 px-2.5 py-1 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors shadow-2xs">
                            เฉลี่ย ฿ {effectivePerMonthPrice.toLocaleString()} / เดือน
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3 Checkmarked Specs (แบบติ๊กถูกเหมือนเดิม) */}
                  <div className="space-y-2.5 py-1 mb-5 text-xs text-slate-700">
                    <div className="flex items-center gap-2.5">
                      <span className={`p-0.5 rounded-full shrink-0 ${isFree ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                        <Check className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-bold text-slate-800">{card.maxRooms}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className={`p-0.5 rounded-full shrink-0 ${isFree ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                        <Check className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-bold text-slate-800">{card.lineQuota}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className={`p-0.5 rounded-full shrink-0 ${isFree ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                        <Check className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-bold text-slate-800">{card.keyFeature}</span>
                    </div>
                  </div>
                </div>

                {/* Card Action Button with Sliding Arrow or Disabled status */}
                <div className="relative z-10">
                  {isFree ? (
                    <button
                      type="button"
                      disabled
                      className="w-full py-3 px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 bg-slate-100 text-slate-400 border border-slate-200/80 cursor-not-allowed select-none"
                      title="ระบบจะปรับเป็นแพ็กเกจฟรีอัตโนมัติเมื่อแพ็กเกจปัจจุบันหมดอายุ"
                    >
                      <span>
                        {subInfo.planId === 'free'
                          ? 'ใช้งานแพ็กเกจนี้อยู่ (ปัจจุบัน)'
                          : 'ปรับเป็นแพ็กเกจนี้อัตโนมัติเมื่อหมดอายุ'}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectPricingCard(card);
                      }}
                      className={`w-full py-3 px-4 rounded-2xl text-xs font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 shadow-xs group-hover:shadow-md ${card.popular
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/25'
                        : card.bestValue
                          ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20'
                          : 'bg-blue-50 group-hover:bg-blue-600 text-blue-700 group-hover:text-white border border-blue-200 transition-colors'
                        }`}
                    >
                      <span>{`เลือกแพ็กเกจนี้ ฿${card.price.toLocaleString()}`}</span>
                      <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 3: โปรแกรมแนะนำเพื่อน & มีโค้ดส่วนลดหรือรหัสโปรโมชั่น (เรียงข้างกัน สมดุล ตอบสนองได้ดี) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        {/* กล่อง 1: โปรแกรมแนะนำเพื่อน */}
        <div className="bg-[#FFFDF6] border border-[#FDE68A] rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start gap-3.5 sm:gap-4">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#EA580C] flex items-center justify-center shrink-0 text-white shadow-xs">
                <Gift className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    โปรแกรมแนะนำเพื่อน
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] text-xs font-bold whitespace-nowrap">
                    แนะนำแล้ว {referralInfo.invitedCount} / {referralInfo.maxTarget} คน
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 font-medium mt-1 leading-relaxed">
                  แชร์รหัสให้เจ้าของหอพักอื่น รับ 10 Coins (฿10) เมื่อเพื่อนเปิดใช้งานหอพักแรก
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 bg-white rounded-2xl border border-[#FDE68A]/80 p-3 sm:p-3.5 flex items-center justify-between gap-2.5 shadow-2xs min-h-[58px]">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <span className="text-xs sm:text-sm font-bold text-slate-700 whitespace-nowrap shrink-0">
                รหัสคำเชิญของคุณ:
              </span>
              <button
                type="button"
                onClick={handleCopyReferral}
                title="คลิกเพื่อคัดลอกลิงก์แนะนำเพื่อน"
                className={`group inline-flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-xl border font-mono font-black text-sm sm:text-base tracking-wider transition-all duration-150 cursor-pointer active:scale-95 select-none shadow-2xs ${isReferralCopied
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-emerald-400/20'
                  : 'bg-[#FFFBEB] hover:bg-[#FEF3C7] border-[#FCD34D] text-[#78350F] hover:border-[#F59E0B]'
                  }`}
              >
                <span>{referralInfo.code || '441570'}</span>
                {isReferralCopied ? (
                  <Check className="w-4 h-4 text-emerald-600 stroke-[2.5] shrink-0" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#B45309] group-hover:text-[#92400E] shrink-0 transition-transform group-hover:scale-110" />
                )}
              </button>
            </div>

            <span className="text-xs font-semibold text-slate-400 hidden xs:inline-block">
              {isReferralCopied ? (
                <span className="text-emerald-600 font-bold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>คัดลอกลิงก์แล้ว</span>
                </span>
              ) : (
                'กดเพื่อคัดลอกลิงก์'
              )}
            </span>
          </div>
        </div>

        {/* กล่อง 2: มีโค้ดส่วนลดหรือรหัสโปรโมชั่น */}
        <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start gap-3.5 sm:gap-4">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0 text-white shadow-xs">
                <Ticket className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    มีโค้ดส่วนลดหรือรหัสโปรโมชั่น
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 font-medium mt-1 leading-relaxed">
                  กรอกโค้ดส่วนลดเพื่อรับสิทธิ์ลดราคา หรือสิทธิพิเศษเพิ่มเติม
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 bg-slate-50/90 rounded-2xl border border-slate-200/90 p-3 sm:p-3.5 flex flex-col justify-center gap-2 shadow-2xs min-h-[58px]">
            <form onSubmit={handleApplyPromoCode} className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  type="text"
                  value={promoCodeInput}
                  onChange={(e) => {
                    setPromoCodeInput(e.target.value.toUpperCase());
                    setPromoError(null);
                  }}
                  placeholder="กรอกโค้ด"
                  className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all uppercase tracking-wider h-10"
                />
                {promoCodeInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setPromoCodeInput('');
                      setPromoError(null);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs sm:text-sm px-4 sm:px-5 h-10 rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <span className="whitespace-nowrap">ใช้โค้ด</span>
              </button>
            </form>

            {/* แสดงผลลัพธ์ 1 บรรทัด เมื่อใช้โค้ดแล้ว */}
            {appliedPromo && (
              <div className="flex items-center justify-between gap-2 px-1 text-xs text-emerald-600 font-medium animate-in fade-in duration-200">
                <div className="flex items-center gap-1.5 min-w-0 truncate">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate">
                    {appliedPromo.discountPercent ? (
                      `สำเร็จ: ได้รับส่วนลด ${appliedPromo.discountPercent}%${appliedPromo.discountAmount ? `` : ''} เรียบร้อยแล้ว`
                    ) : (
                      `สำเร็จ: เพิ่มวันใช้งาน +${appliedPromo.daysBonus || 60} วัน เรียบร้อยแล้ว`
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRemovePromo}
                  className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer shrink-0 transition-colors"
                  title="ยกเลิกโค้ดนี้"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {promoError && (
              <div className="flex items-center gap-1.5 text-xs text-rose-600 font-medium px-1 truncate animate-in fade-in duration-200">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{promoError}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 5: ป้ายโฆษณา แนวนอน 16:9 (ค้าง 3 วิ + fade 0.5 วิ) */}
      <div className="space-y-3 pt-2">
        {/* 16:9 Billboard Display Frame - เลื่อนสลับรูปด้วยการปัดนิ้วหรือลากเมาส์ (Touch & Mouse Drag) */}
        <div
          onTouchStart={handleBillboardTouchStart}
          onTouchMove={handleBillboardTouchMove}
          onTouchEnd={handleBillboardTouchEnd}
          onMouseDown={handleBillboardMouseDown}
          onMouseUp={handleBillboardMouseUp}
          onMouseLeave={handleBillboardMouseLeave}
          onMouseEnter={() => setIsBillboardHovered(true)}
          className={`relative w-full aspect-[16/9] rounded-2xl sm:rounded-3xl overflow-hidden shadow-md sm:shadow-lg border border-slate-200 bg-slate-950 select-none transition-shadow ${isDraggingBillboard ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          title="ปัดซ้าย-ขวา ด้วยนิ้ว หรือลากด้วยเมาส์เพื่อเปลี่ยนรูปภาพ"
        >
          {/* Slides with 3s hold & 0.5s fade crossfade transition */}
          {billboardAds.map((ad, idx) => {
            const isActive = idx === currentBillboardIndex;
            return (
              <div
                key={ad.id}
                className={`absolute inset-0 w-full h-full transition-opacity duration-500 ease-in-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                  }`}
              >
                <img
                  src={ad.imageUrl}
                  alt={ad.title}
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none"
                />

                {/* Subtle gradient overlay & banner text: ในมุมมองมือถือ (sm:hidden) ไม่ต้องแสดงข้อความตามที่ระบุ */}
                <div className="hidden sm:flex absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent flex-col justify-end p-5 sm:p-8 md:p-10 text-white pointer-events-none">
                  <div className="max-w-3xl space-y-1.5 sm:space-y-2">
                    <span className="inline-block text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full bg-blue-600 text-white uppercase tracking-wider shadow-sm">
                      {ad.tag}
                    </span>
                    <h4 className="text-lg sm:text-2xl md:text-3xl font-black text-white leading-tight drop-shadow-md">
                      {ad.title}
                    </h4>
                    <p className="text-xs sm:text-sm md:text-base text-slate-200 font-medium line-clamp-2 leading-relaxed drop-shadow-sm max-w-2xl">
                      {ad.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* แทบ "x/4" ให้อยู่ตรงกลางรูป พื้นหลังสีขาว (Centered Indicators & Slide Counter with White Background) */}
        <div className="flex items-center justify-center mt-3 sm:mt-3.5">
          <div className="inline-flex items-center gap-2.5 bg-white text-slate-800 px-4 py-2 rounded-full border border-slate-200/90 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-center gap-1.5">
              {billboardAds.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentBillboardIndex(idx)}
                  className={`h-2 rounded-full transition-all cursor-pointer ${idx === currentBillboardIndex
                    ? 'w-6 bg-blue-600 shadow-xs'
                    : 'w-2 bg-slate-200 hover:bg-slate-300'
                    }`}
                  title={`ไปที่รูปที่ ${idx + 1}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: ใส่รูปภาพป้ายโฆษณา 16:9 */}
      {isBillboardModalOpen && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-3 sm:p-4 bg-slate-950/65 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-600 text-white">
                  <ImageIcon className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-sm font-black text-slate-900">จัดการรูปภาพป้ายโฆษณา 16:9</h4>
                  <p className="text-[11px] text-slate-500 font-medium">เพิ่มรูปภาพหรือแบนเนอร์ประชาสัมพันธ์</p>
                </div>
              </div>
              <button
                onClick={() => setIsBillboardModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
              {/* File upload or URL */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  เลือกไฟล์รูปภาพจากอุปกรณ์ (แนวนอน 16:9)
                </label>
                <label className="block border-2 border-dashed border-slate-200 hover:border-blue-500 rounded-2xl p-4 text-center cursor-pointer transition-colors bg-slate-50 hover:bg-blue-50/20">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
                  <span className="text-xs font-bold text-slate-700 block">คลิกเพื่อเลือกไฟล์รูปภาพ 16:9</span>
                  <span className="text-[10px] text-slate-400 font-medium">รองรับ JPG, PNG, WEBP</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Or image URL */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  หรือระบุ URL รูปภาพ
                </label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={newImageUrl}
                  onChange={e => setNewImageUrl(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
                />
              </div>

              {/* Preview */}
              {(newImageFile || newImageUrl) && (
                <div>
                  <span className="text-xs font-bold text-slate-700 block mb-1">ตัวอย่างภาพ 16:9</span>
                  <div className="w-full aspect-[16/9] rounded-xl overflow-hidden border border-slate-200 bg-slate-100 relative">
                    <img
                      src={newImageFile || newImageUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Titles */}
              <div className="space-y-2.5">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">หัวข้อโฆษณา / ป้ายประชาสัมพันธ์</label>
                  <input
                    type="text"
                    placeholder="เช่น โปรโมชั่นห้องพักพิเศษ หรือ HORPLUS PRO"
                    value={newImageTitle}
                    onChange={e => setNewImageTitle(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">คำบรรยายสั้น</label>
                  <input
                    type="text"
                    placeholder="เช่น สมัครวันนี้รับส่วนลดและสิทธิประโยชน์ฟรี"
                    value={newImageDesc}
                    onChange={e => setNewImageDesc(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">ป้ายกำกับ (Tag)</label>
                  <input
                    type="text"
                    placeholder="เช่น โปรโมชั่น, สิทธิพิเศษ"
                    value={newImageTag}
                    onChange={e => setNewImageTag(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 text-xs bg-white"
                  />
                </div>
              </div>

              {/* Existing ads list */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">รูปภาพในป้ายโฆษณาปัจจุบัน ({billboardAds.length})</span>
                  <button
                    type="button"
                    onClick={handleResetBillboardAds}
                    className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    รีเซ็ตเป็นค่าเริ่มต้น
                  </button>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {billboardAds.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <img src={item.imageUrl} alt="" className="w-12 h-7 object-cover rounded-md shrink-0" />
                        <div className="truncate">
                          <span className="text-xs font-bold text-slate-800 block truncate">{item.title}</span>
                          <span className="text-[10px] text-slate-400 block truncate">{item.tag}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteBillboardAd(item.id, e)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 cursor-pointer"
                        title="ลบภาพนี้"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <button
                type="button"
                onClick={() => setIsBillboardModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl cursor-pointer"
              >
                ปิด
              </button>
              <button
                type="button"
                disabled={!newImageFile && !newImageUrl}
                onClick={handleAddBillboardAd}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-extrabold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>บันทึกลงป้ายโฆษณา</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Celebration Card Popup with Before-and-After Transformation */}
      <CelebrationOverlay
        isOpen={isCelebrationOpen}
        planName="HORPLUS PRO"
        durationMonths={durationMonths}
        daysAdded={successReceipt?.daysAdded || currentDurationOpt.days}
        paidAmount={successReceipt?.paidAmount || currentPrice}
        previousDaysLeft={successReceipt?.previousDaysLeft ?? (subInfo.planId === 'free' ? 0 : subInfo.daysLeft)}
        newDaysLeft={successReceipt?.newDaysLeft}
        previousExpiryDate={successReceipt?.previousExpiryDate || subInfo.expiryDate}
        newExpiryDate={successReceipt?.newExpiryDate || calculateNewExpiryDate(currentDurationOpt.days)}
        orderId={successReceipt?.orderId}
        receiptNumber={successReceipt?.receiptNumber}
        onComplete={handleCelebrationComplete}
      />
    </div>
  );
};

export const SubscriptionPage = OwnerSubscription;
export default OwnerSubscription;
