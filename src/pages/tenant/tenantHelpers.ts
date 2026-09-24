/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Shared Helper Utilities
 */
import { formatCanonicalLineItemDescription } from '../../utils/billPresentation';
import { sanitizeContractTerms } from '../../utils/contract-terms-sanitizer';
import { BillItem } from '../../types';

export const getBankBadgeInfo = (bankName: string) => {
  const name = bankName || 'กสิกรไทย (KBank)';
  if (name.includes('Krungthai') || name.includes('กรุงไทย') || name.toUpperCase().includes('KTB')) {
    return { label: 'KTB', bg: 'bg-sky-600 border-sky-500 text-white', name: 'ธนาคารกรุงไทย', logoUrl: '/images/banks/ktb.svg' };
  }
  if (name.includes('KBank') || name.includes('กสิกรไทย') || name.toUpperCase().includes('KBANK')) {
    return { label: 'KBANK', bg: 'bg-emerald-600 border-emerald-500 text-white', name: 'ธนาคารกสิกรไทย', logoUrl: '/images/banks/kbank.svg' };
  }
  if (name.includes('Bangkok') || name.includes('กรุงเทพ') || name.toUpperCase().includes('BBL')) {
    return { label: 'BBL', bg: 'bg-blue-900 border-blue-800 text-white', name: 'ธนาคารกรุงเทพ', logoUrl: '/images/banks/bbl.svg' };
  }
  if (name.includes('SCB') || name.includes('ไทยพาณิชย์')) {
    return { label: 'SCB', bg: 'bg-purple-800 border-purple-700 text-white', name: 'ธนาคารไทยพาณิชย์', logoUrl: '/images/banks/scb.svg' };
  }
  if (name.includes('Krungsri') || name.includes('กรุงศรี') || name.toUpperCase().includes('BAY')) {
    return { label: 'BAY', bg: 'bg-amber-400 border-amber-300 text-amber-950', name: 'ธนาคารกรุงศรีอยุธยา', logoUrl: '/images/banks/bay.svg' };
  }
  if (name.includes('ttb') || name.includes('ทหารไทยธนชาต') || name.toUpperCase().includes('TTB') || name.toUpperCase().includes('TMB')) {
    return { label: 'TTB', bg: 'bg-blue-600 border-blue-500 text-white', name: 'ธนาคารทหารไทยธนชาต', logoUrl: '/images/banks/ttb.svg' };
  }
  if (name.includes('UOB') || name.includes('ยูโอบี')) {
    return { label: 'UOB', bg: 'bg-sky-900 border-sky-800 text-white', name: 'ธนาคารยูโอบี', logoUrl: '/images/banks/uob.svg' };
  }
  if (name.includes('CIMB') || name.includes('ซีไอเอ็มบี')) {
    return { label: 'CIMB', bg: 'bg-red-700 border-red-600 text-white', name: 'ธนาคารซีไอเอ็มบี ไทย', logoUrl: '/images/banks/cimb.svg' };
  }
  if (name.includes('LH Bank') || name.includes('แลนด์ แอนด์ เฮ้าส์') || name.toUpperCase().includes('LHB')) {
    return { label: 'LHB', bg: 'bg-teal-700 border-teal-600 text-white', name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', logoUrl: '/images/banks/lhb.svg' };
  }
  if (name.includes('KKP') || name.includes('เกียรตินาคิน')) {
    return { label: 'KKP', bg: 'bg-violet-700 border-violet-600 text-white', name: 'ธนาคารเกียรตินาคินภัทร', logoUrl: '' };
  }
  if (name.includes('TISCO') || name.includes('ทิสโก้')) {
    return { label: 'TISCO', bg: 'bg-cyan-700 border-cyan-600 text-white', name: 'ธนาคารทิสโก้', logoUrl: '/images/banks/tisco.svg' };
  }
  if (name.includes('ICBC') || name.includes('ไอซีบีซี')) {
    return { label: 'ICBC', bg: 'bg-red-800 border-red-700 text-white', name: 'ธนาคารไอซีบีซี (ไทย)', logoUrl: '' };
  }
  if (name.includes('GSBk') || name.includes('GSB') || name.includes('ออมสิน')) {
    return { label: 'GSB', bg: 'bg-pink-500 border-pink-400 text-white', name: 'ธนาคารออมสิน', logoUrl: '/images/banks/gsb.svg' };
  }
  if (name.includes('BAAC') || name.includes('ธ.ก.ส.')) {
    return { label: 'BAAC', bg: 'bg-green-700 border-green-600 text-white', name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', logoUrl: '/images/banks/baac.svg' };
  }
  if (name.includes('GH Bank') || name.includes('ธอส.') || name.toUpperCase().includes('GHB')) {
    return { label: 'GHB', bg: 'bg-orange-500 border-orange-400 text-white', name: 'ธนาคารอาคารสงเคราะห์', logoUrl: '/images/banks/ghb.svg' };
  }
  if (name.includes('IBANK') || name.includes('อิสลาม')) {
    return { label: 'IBANK', bg: 'bg-emerald-800 border-emerald-700 text-white', name: 'ธนาคารอิสลามแห่งประเทศไทย', logoUrl: '/images/banks/ibank.svg' };
  }
  return { label: 'BANK', bg: 'bg-slate-700 border-slate-600 text-white', name: bankName, logoUrl: '' };
};

// Helper function to compress images using HTML5 Canvas to prevent localStorage quota issues
export const compressImage = (dataUrl: string, maxWidth = 800, maxHeight = 800, quality = 0.6): Promise<string> => {
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
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};

// Time-based Thai Greeting helper
export const getThaiGreeting = () => {
  const hours = new Date().getHours();
  if (hours >= 5 && hours < 12) return 'สวัสดีตอนเช้า 👋';
  if (hours >= 12 && hours < 17) return 'สวัสดีตอนบ่าย 👋';
  return 'สวัสดีตอนเย็น 👋';
};

// Convert Gregorian Date to BE Thai calendar date (e.g. 05 ก.ย. 2569)
export const formatToBeDate = (dateStr: string) => {
  if (!dateStr) return 'ไม่ระบุ';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'ไม่ระบุ';
    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const day = d.getDate().toString().padStart(2, '0');
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543;
    return `${day} ${month} ${year}`;
  } catch {
    return 'ไม่ระบุ';
  }
};

// Full Thai month date conversion (e.g., 02 ก.ค. 2569)
export const formatToBeFullDate = (dateStr: string) => {
  return formatToBeDate(dateStr);
};

// Translate cycle standard to Thai format (e.g. "2026-07", "202608", "INV-202608-..." to "สิงหาคม 2569")
export const formatThaiCycle = (cycleId?: string, fallbackDate?: string) => {
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const raw = String(cycleId || '').trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);

  if (!isUuid && raw) {
    // Case 1: Match YYYY-MM where year is 20xx or 25xx (e.g. "2026-08", "cycle-2026-08")
    const dashMatch = raw.match(/(?:^|[^\d])(20\d{2}|25\d{2})-(0?[1-9]|1[0-2])(?:[^\d]|$)/);
    if (dashMatch) {
      let year = parseInt(dashMatch[1], 10);
      if (year < 2500) year += 543;
      const mIdx = parseInt(dashMatch[2], 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${monthNames[mIdx]} ${year}`;
      }
    }

    // Case 2: Match YYYYMM where year is 20xx or 25xx (e.g. "INV-202607-011", "202608")
    const compactMatch = raw.match(/(?:^|[^\d])(20\d{2}|25\d{2})(0[1-9]|1[0-2])(?:[^\d]|$)/);
    if (compactMatch) {
      let year = parseInt(compactMatch[1], 10);
      if (year < 2500) year += 543;
      const mIdx = parseInt(compactMatch[2], 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${monthNames[mIdx]} ${year}`;
      }
    }
  }

  // Case 3: Fallback to date string if provided
  if (fallbackDate) {
    const d = new Date(fallbackDate);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear() + 543;
      return `${monthNames[d.getMonth()]} ${year}`;
    }
  }

  return 'รอบปัจจุบัน';
};

// Duration in months calculation helper
export const getContractDurationMonths = (start: string, end: string) => {
  try {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const yearsDiff = e.getFullYear() - s.getFullYear();
    const monthsDiff = e.getMonth() - s.getMonth();
    const total = yearsDiff * 12 + monthsDiff;
    return total > 0 ? total : null;
  } catch {
    return null;
  }
};

// Helper for Announcement Role Display
export const getAuthorRoleName = (rawAuthor?: string) => {
  if (!rawAuthor) return 'เจ้าของหอพัก';
  if (rawAuthor.includes('(') && rawAuthor.includes(')')) {
    const roleInParen = rawAuthor.split('(')[1].replace(')', '').trim();
    if (roleInParen.toLowerCase() === 'manager') return 'ผู้จัดการ';
    if (roleInParen.toLowerCase() === 'staff') return 'เจ้าหน้าที่/ช่าง';
    if (roleInParen.toLowerCase() === 'owner') return 'เจ้าของหอพัก';
  }
  return rawAuthor;
};

// Helper for formatting bill item descriptions
export function formatItemDescription(desc?: string): string {
  if (!desc) return '';
  const str = desc.trim();
  if (str.includes('อินเทอร์เน็ต') || str.includes('อินเตอร์เน็ต')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าอินเทอร์เน็ต (${match[1]})` : 'ค่าอินเทอร์เน็ต';
  }
  return str.replace(/ค่าไฟฟ้า\s*\([^)]*\)/, 'ค่าไฟฟ้า').replace(/ค่าน้ำ\s*\([^)]*\)/, 'ค่าน้ำ');
}

export function parseItemMetadata(metadata: unknown): Record<string, any> | null {
  if (!metadata) return null;
  if (typeof metadata === 'object') return metadata as Record<string, any>;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return null;
}

export function formatTenantBillItemLabel(
  item: BillItem | any,
  options?: { rentCycle?: 'monthly' | 'term' | 'daily' | string | null }
): string {
  if (!item) return '';
  const meta = parseItemMetadata(item.metadata);
  const baseDesc = formatCanonicalLineItemDescription(
    {
      type: item.type || item.itemType || item.category,
      category: item.category,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      metadata: meta,
    },
    options
  );

  const hasVat = Boolean(
    meta?.isTaxable ||
    item.isTaxable ||
    (meta?.vatAmount && Number(meta.vatAmount) > 0) ||
    (meta?.netAmount && Number(meta.netAmount) > Number(item.amount || 0))
  );

  return hasVat ? `${baseDesc} +VAT:` : `${baseDesc}:`;
}

export function getTenantBillItemAmount(item: BillItem | any): number {
  if (!item) return 0;
  const meta = parseItemMetadata(item.metadata);
  if (meta?.netAmount !== undefined && meta?.netAmount !== null && !isNaN(Number(meta.netAmount))) {
    return Number(meta.netAmount);
  }
  if (meta?.isTaxable && meta?.vatAmount !== undefined && meta?.vatAmount !== null && !isNaN(Number(meta.vatAmount))) {
    return Number(item.amount || 0) + Number(meta.vatAmount);
  }
  return Number(item.amount || 0);
}

export function getCanonicalBillKindLabel(bill: Bill | any): string {
  if (!bill) return 'บิลค่าใช้จ่าย';

  const kind = String(bill.billKind || '').toUpperCase();
  if (kind === 'DEPOSIT') {
    return 'บิลค่าประกัน / มัดจำ';
  }
  if (kind === 'RENT') {
    return 'บิลค่าเช่า';
  }
  if (kind === 'MONTHLY_UTILITY' || kind === 'LEGACY_COMBINED' || kind === 'COMBINED') {
    return 'บิลรายเดือน';
  }

  // Inspect items as intelligent fallback
  const items = Array.isArray(bill.items) ? bill.items : [];
  const isDeposit = items.some((it: any) => {
    const desc = String(it.description || '').toLowerCase();
    const type = String(it.type || it.itemType || it.category || '').toLowerCase();
    return desc.includes('มัดจำ') || desc.includes('ประกัน') || type.includes('deposit');
  });
  if (isDeposit) return 'บิลค่าประกัน / มัดจำ';

  const isDaily = items.some((it: any) => {
    const desc = String(it.description || '').toLowerCase();
    return desc.includes('รายวัน') || desc.includes('daily');
  });
  if (isDaily) return 'บิลค่าเช่ารายวัน';

  const hasRent = items.some((it: any) => {
    const desc = String(it.description || '').toLowerCase();
    const type = String(it.type || it.itemType || it.category || '').toLowerCase();
    return desc.includes('ค่าเช่า') || type === 'rent';
  });
  const hasUtilities = items.some((it: any) => {
    const desc = String(it.description || '').toLowerCase();
    const type = String(it.type || it.itemType || it.category || '').toLowerCase();
    return desc.includes('ค่าน้ำ') || desc.includes('ค่าไฟ') || desc.includes('ส่วนกลาง') ||
      type === 'water' || type === 'electricity' || type === 'utility';
  });

  if (hasRent && !hasUtilities) return 'บิลค่าเช่า';
  if (hasUtilities || hasRent) return 'บิลรายเดือน';

  return 'บิลค่าใช้จ่าย';
}

export function formatPaymentDateTime(paidAtStr?: string | null): string {
  if (!paidAtStr) return '';
  try {
    const d = new Date(paidAtStr);
    if (isNaN(d.getTime())) return '';
    const day = d.getDate();
    const monthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear() + 543;
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} เวลา ${hours}:${minutes} น.`;
  } catch {
    return '';
  }
}

export const CAR_BRANDS = [
  'Toyota',
  'Honda',
  'Isuzu',
  'Mazda',
  'Nissan',
  'Mitsubishi',
  'Ford',
  'Benz',
  'BMW',
  'Audi',
  'MG',
  'BYD',
  'Suzuki',
  'อื่นๆ',
];

export const MOTO_BRANDS = [
  'Honda',
  'Yamaha',
  'Vespa',
  'Suzuki',
  'GPX',
  'Kawasaki',
  'Ducati',
  'อื่นๆ',
];

export interface CanonicalPetGroupOption {
  id: 'dog' | 'cat' | 'small_pet' | 'other';
  label: string;
}

export const CANONICAL_PET_GROUP_OPTIONS: readonly CanonicalPetGroupOption[] = [
  { id: 'dog', label: 'สุนัข (Dog)' },
  { id: 'cat', label: 'แมว (Cat)' },
  { id: 'small_pet', label: 'สัตว์เล็ก (กระต่าย/หนู/นก)' },
  { id: 'other', label: 'สัตว์แปลก / อื่นๆ' },
] as const;

export function getEffectivePetPolicy(
  propertyDefaultsPolicy?: { allowed: string; allowedTypes?: string[] } | null
): { allowed: string; allowedTypes?: string[] } {
  if (propertyDefaultsPolicy?.allowed) {
    return propertyDefaultsPolicy;
  }
  return {
    allowed: 'none',
    allowedTypes: [],
  };
}

export function resolveAllowedPetOptions(
  petPolicy?: { allowed: string; allowedTypes?: string[] } | null
): CanonicalPetGroupOption[] {
  if (!petPolicy || petPolicy.allowed === 'none') return [];
  if (petPolicy.allowed === 'all') {
    return [...CANONICAL_PET_GROUP_OPTIONS];
  }
  if (!petPolicy.allowedTypes || petPolicy.allowedTypes.length === 0) {
    return [];
  }
  const allowedIds = new Set<string>();
  for (const t of petPolicy.allowedTypes) {
    const lower = (t || '').trim().toLowerCase();
    if (lower === 'dog' || lower === 'สุนัข' || lower === 'หมา') allowedIds.add('dog');
    else if (lower === 'cat' || lower === 'แมว') allowedIds.add('cat');
    else if (
      lower === 'small_pet' ||
      lower === 'small-pet' ||
      lower === 'small_pets' ||
      lower === 'สัตว์เล็ก'
    )
      allowedIds.add('small_pet');
    else if (
      lower === 'other' ||
      lower === 'others' ||
      lower === 'อื่นๆ' ||
      lower === 'สัตว์แปลก' ||
      lower === 'exotic'
    )
      allowedIds.add('other');
  }
  return CANONICAL_PET_GROUP_OPTIONS.filter((opt) => allowedIds.has(opt.id));
}

/**
 * Calculates contract end date based on start date and duration in months.
 * Formula: startDate + durationMonths - 1 day (e.g. 2027-01-01 + 4 mo -> 2027-04-30).
 */
export function calculateContractEndDate(startDateStr?: string | null, durationMonths?: number | null): string {
  if (!startDateStr || !durationMonths) return '';
  const d = new Date(startDateStr);
  if (isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + Number(durationMonths));
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Opens a print-ready window for the tenant lease contract matching Owner side template (PO Image 2).
 */
export function openTenantContractPrintWindow(
  contract: any,
  tenant: any,
  tenantRoom: any,
  dorm: any,
  options: { autoPrint?: boolean } = {}
): Window | null {
  if (!contract) return null;
  const autoPrint = options.autoPrint ?? false;
  const printWindow = window.open('', '_blank', 'width=850,height=950');
  if (!printWindow) return null;

  const formatThaiDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatBaht = (amount: number | string) => {
    const num = Number(amount) || 0;
    return `฿ ${num.toLocaleString('th-TH')}`;
  };

  const tenantName = tenant?.name || tenant?.displayName || 'ผู้เช่า';
  const tenantPhone = tenant?.phone || '-';
  const tenantCitizenId = tenant?.citizenId || tenant?.nationalIdMasked || tenant?.nationalId || '-';
  const roomNum = tenantRoom?.roomNumber || contract?.roomId || 'ไม่ระบุ';
  const roomFloor = tenantRoom?.floor ? ` (ชั้น ${tenantRoom.floor})` : '';
  const createdDate = contract?.createdAt ? contract.createdAt.split('T')[0] : contract?.startDate;
  const dormName = dorm?.name || 'หอพัก';
  const dormAddress = [
    dorm?.addressLine1 || dorm?.address,
    dorm?.subdistrict ? `ต.${dorm.subdistrict}` : '',
    dorm?.district ? `อ.${dorm.district}` : '',
    dorm?.province ? `จ.${dorm.province}` : '',
    dorm?.postalCode
  ].filter(Boolean).join(' ') || dorm?.address || '-';
  const rawBankName =
    dorm?.billingSettings?.bankAccountName ||
    dorm?.bankAccountName ||
    dorm?.paymentSettings?.bankAccountName ||
    dorm?.billingSettings?.promptPayAccountName ||
    dorm?.promptPayAccountName ||
    dorm?.promptPayName ||
    dorm?.ownerName;
  const lessorDisplayName = rawBankName ? `${rawBankName} (${dormName})` : (dorm?.name || 'ผู้ให้เช่า');
  const lessorSignerName = rawBankName || dormName || 'ผู้ให้เช่า';
  const isTermContract = contract?.rentBillingType === 'term' || contract?.rentalType === 'TERM' || contract?.rentalPlan === 'term';
  const coOccupantsList = contract?.coTenants || contract?.coOccupants || tenant?.coOccupants || [];
  const totalOccupants = 1 + (Array.isArray(coOccupantsList) ? coOccupantsList.length : 0);

  const tenantSigUrl = (contract.tenantSignature && (contract.tenantSignature.startsWith('http') || contract.tenantSignature.startsWith('data:')))
    ? contract.tenantSignature
    : '/api/v1/tenant-portal/contract/signatures/tenant';
  const ownerSigUrl = (contract.ownerSignature && (contract.ownerSignature.startsWith('http') || contract.ownerSignature.startsWith('data:')))
    ? contract.ownerSignature
    : (dorm?.ownerSignature && (dorm.ownerSignature.startsWith('http') || dorm.ownerSignature.startsWith('data:'))
      ? dorm.ownerSignature
      : '/api/v1/tenant-portal/contract/signatures/owner');

  const tenantSig = tenantSigUrl
    ? `<img src="${tenantSigUrl}" style="max-height: 44px; max-width: 140px; object-fit: contain;" alt="ลายเซ็นผู้เช่า" onerror="this.style.display='none';" />`
    : '<div style="height: 44px;"></div>';
  const ownerSig = ownerSigUrl
    ? `<img src="${ownerSigUrl}" style="max-height: 44px; max-width: 140px; object-fit: contain;" alt="ลายเซ็นผู้ให้เช่า" onerror="this.style.display='none';" />`
    : '<div style="height: 44px;"></div>';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>สัญญาเช่าห้องพักเลขที่ ${contract.contractNumber || 'CTR'} - ห้อง ${roomNum}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&family=Prompt:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        @page {
          size: A4;
          margin: 15mm;
        }
        * {
          box-sizing: border-box;
        }
        body {
          font-family: 'Sarabun', 'Prompt', system-ui, -apple-system, sans-serif;
          font-size: 14px;
          line-height: 1.7;
          color: #0f172a;
          background-color: #ffffff;
          margin: 0;
          padding: 24px;
        }
        .contract-container {
          max-width: 760px;
          margin: 0 auto;
          background: #ffffff;
        }
        .header-box {
          text-align: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 2px solid #0f172a;
        }
        .title {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px 0;
          letter-spacing: 0.5px;
        }
        .contract-no {
          font-size: 13px;
          font-weight: 600;
          color: #475569;
        }
        .content-section {
          margin-bottom: 18px;
          text-align: justify;
          text-justify: inter-word;
        }
        .highlight-box {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px 20px;
          margin: 18px 0;
        }
        .highlight-box ul {
          margin: 0;
          padding-left: 20px;
        }
        .highlight-box li {
          margin-bottom: 8px;
        }
        .highlight-box li:last-child {
          margin-bottom: 0;
        }
        .terms-box {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 14px 18px;
          margin-top: 8px;
          white-space: pre-line;
          color: #334155;
          font-size: 13px;
        }
        .signatures-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          margin-top: 36px;
          padding-top: 24px;
          border-top: 1px dashed #cbd5e1;
          page-break-inside: avoid;
          width: 100%;
          box-sizing: border-box;
        }
        .signature-block {
          text-align: center;
          max-width: 100%;
          overflow: hidden;
        }
        .signature-label {
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
          margin-bottom: 8px;
        }
        .signature-space {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
          overflow: hidden;
        }
        .signature-space img {
          max-height: 44px;
          max-width: 140px;
          object-fit: contain;
        }
        .signer-name {
          font-weight: 700;
          font-size: 13px;
          color: #0f172a;
          margin-top: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .no-print-bar {
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #f1f5f9;
          padding: 12px 18px;
          border-radius: 12px;
          border: 1px solid #cbd5e1;
        }
        .print-btn {
          padding: 9px 22px;
          background-color: #0f172a;
          color: #ffffff;
          border: none;
          border-radius: 10px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          font-family: inherit;
        }
        .print-btn:hover {
          background-color: #334155;
        }
        @media print {
          body {
            padding: 0;
            background: none;
          }
          .no-print-bar {
            display: none !important;
          }
          .contract-container {
            max-width: 100%;
          }
        }
      </style>
    </head>
    <body>
      <div class="no-print-bar">
        <div style="font-weight: 700; color: #1e293b; font-size: 14px;">
          📄 หนังสือสัญญาเช่าเลขที่: ${contract.contractNumber || 'CTR'} (ห้อง ${roomNum})
        </div>
        <button class="print-btn" onclick="window.print()">
          🖨️ พิมพ์เอกสารสัญญา
        </button>
      </div>

      <div class="contract-container">
        <div class="header-box">
          <h1 class="title">หนังสือสัญญาเช่าที่พักอาศัย</h1>
          <div class="contract-no">สัญญาเลขที่: ${contract.contractNumber || 'CTR'} &bull; อาคารหอพัก ${dormName}</div>
        </div>

        <div class="content-section">
          <p>
            สัญญาฉบับนี้ทำขึ้น ณ <strong>อาคารหอพัก ${dormName}</strong> ตั้งอยู่เลขที่ ${dormAddress} เมื่อวันที่ <strong>${formatThaiDate(createdDate)}</strong> ระหว่าง
            <strong>${lessorDisplayName} ("ผู้ให้เช่า")</strong> ฝ่ายหนึ่ง กับ
            <strong>คุณ${tenantName}</strong> (เลขประจำตัวประชาชน: <strong>${tenantCitizenId}</strong>, เบอร์โทรศัพท์: <strong>${tenantPhone}</strong>) ซึ่งต่อไปนี้ในสัญญาจะเรียกว่า "ผู้เช่า" อีกฝ่ายหนึ่ง
          </p>
          <p>
            ทั้งสองฝ่ายตกลงยินยอมทำสัญญาเช่าห้องพัก โดยมีข้อกำหนดและเงื่อนไขตามรายละเอียดดังต่อไปนี้:
          </p>
        </div>

        <div class="highlight-box">
          <ul>
            <li><strong>ข้อ 1. ทรัพย์สินที่เช่า:</strong> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข <strong>ห้อง ${roomNum}</strong> ของอาคาร <strong>${dormName}</strong> พร้อมอุปกรณ์ เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า และสิ่งอำนวยความสะดวกในสภาพเรียบร้อยสมบูรณ์</li>
            <li><strong>ข้อ 2. อัตราค่าเช่า เงินประกัน และการคืนเงิน:</strong> ผู้เช่าตกลงชำระค่าเช่าในอัตรา <strong>฿ ${formatBaht(contract.rentAmount || contract.monthlyRent || 0)} บาทต่อ${isTermContract ? 'เทอม' : 'เดือน'}</strong> กำหนดชำระตามรอบบิลที่หอพักกำหนด พร้อมวางเงินประกันความเสียหายจำนวน <strong>฿ ${formatBaht(contract.depositAmount || 0)} บาท</strong> โดยเงินประกันนี้จะได้รับคืนเมื่อสิ้นสุดสัญญาเช่า หลังจากหักค่าใช้จ่ายค้างชำระ หนี้สิน หรือค่าความเสียหายต่อทรัพย์สิน (ถ้ามี) ตามระเบียบและเงื่อนไขที่หอพักกำหนด</li>
            <li><strong>ข้อ 3. ระยะเวลาการเช่า:</strong> สัญญานี้มีกำหนดระยะเวลา <strong>${contract.durationMonths || 12} เดือน</strong> โดยเริ่มต้นตั้งแต่วันที่ <strong>${formatThaiDate(contract.startDate)}</strong> ถึงวันที่ <strong>${formatThaiDate(contract.endDate)}</strong></li>
            <li><strong>ข้อ 4. ยานพาหนะ สัตว์เลี้ยง และการใช้พื้นที่ส่วนกลาง:</strong> ผู้เช่าตกลงปฏิบัติตามระเบียบการจอดยานพาหนะ การนำสัตว์เลี้ยงเข้าพัก (หากหอพักอนุญาต) และการใช้พื้นที่ส่วนกลาง โดยต้องบันทึกข้อมูลยานพาหนะและสัตว์เลี้ยงลงในระบบของหอพักให้ถูกต้องตรงตามความเป็นจริง</li>
            <li><strong>ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม:</strong> ผู้เช่าตกลงแจ้งข้อมูลผู้พักอาศัยในห้องพักตามความเป็นจริง โดยในวันทำสัญญามีผู้เช่าหลักและผู้พักอาศัยร่วม รวมทั้งสิ้น <strong>${totalOccupants} คน</strong> หากมีการเปลี่ยนแปลงหรือมีผู้พักอาศัยร่วมเพิ่มเติมในภายหลัง ผู้เช่าจะต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าและบันทึกข้อมูลลงในระบบตามระเบียบของหอพัก</li>
          </ul>
        </div>

        <div class="content-section">
          <strong>ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:</strong>
          <div class="terms-box">${sanitizeContractTerms(contract.terms) || '1. ผู้เช่าตกลงชำระค่าเช่าและค่าสาธารณูปโภคตามกำหนดเวลา\n2. รักษาความสงบเรียบร้อยและไม่สร้างความเดือดร้อนรำคาญแก่ผู้อื่น\n3. ปฏิบัติตามระเบียบข้อบังคับของหอพักอย่างเคร่งครัด'}</div>
        </div>

        <div class="content-section" style="margin-top: 14px;">
          <p>
            สัญญานี้ทำขึ้นเป็นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาทั้งสองฝ่ายได้อ่านและเข้าใจข้อความโดยละเอียดแล้ว จึงได้ลงลายมือชื่อไว้เป็นหลักฐานสำคัญต่อหน้าพยาน
          </p>
        </div>

        <div class="signatures-grid">
          <div class="signature-block">
            <div class="signature-label">ลงชื่อ (ผู้ให้เช่า)</div>
            <div class="signature-space">${ownerSig}</div>
            <div class="signer-name">(${lessorSignerName})</div>
          </div>

          <div class="signature-block">
            <div class="signature-label">ลงชื่อ (ผู้เช่า)</div>
            <div class="signature-space">${tenantSig}</div>
            <div class="signer-name">(คุณ${tenantName})</div>
          </div>
        </div>
      </div>

      ${autoPrint ? `
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 400);
        };
      </script>
      ` : ''}
    </body>
    </html>
  `);
  printWindow.document.close();
  return printWindow;
}

/**
 * Opens a print-ready window for the tenant ID card matching Owner side template (PO Image 3).
 */
export function openTenantIdCardPrintWindow(
  tenant: any,
  photoUrl?: string | null,
  options: { autoPrint?: boolean } = {}
): Window | null {
  if (!tenant) return null;
  const autoPrint = options.autoPrint ?? false;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;

  const hasPhoto = Boolean(
    photoUrl &&
    photoUrl.trim() !== '' &&
    photoUrl !== 'MOCK_ID_CARD_BASE64'
  );

  const emergencyText = tenant.emergencyContact?.name
    ? `${tenant.emergencyContact.name} (${tenant.emergencyContact.relationship || '-'}) เบอร์: ${tenant.emergencyContact.phone || '-'}`
    : (tenant.emergencyContacts?.[0]?.name ? `${tenant.emergencyContacts[0].name} (${tenant.emergencyContacts[0].relationship || '-'}) เบอร์: ${tenant.emergencyContacts[0].phone || '-'}` : '-');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>สำเนาบัตรประจำตัวประชาชน - ${tenant.name || tenant.displayName || 'ผู้เช่า'}</title>
      <style>
        body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; line-height: 1.5; background: #ffffff; }
        .container { max-width: 650px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 16px; padding: 28px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #3b82f6; padding-bottom: 12px; }
        .title { font-size: 20px; font-weight: 800; color: #0f172a; }
        .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; font-weight: 600; }
        .card-frame { border: 2px dashed #94a3b8; border-radius: 12px; padding: 16px; text-align: center; background: #f8fafc; margin-bottom: 24px; min-height: 220px; flex-direction: column; display: flex; align-items: center; justify-content: center; }
        .card-img { max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .no-img { padding: 40px; color: #64748b; font-size: 14px; font-weight: bold; }
        .section-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; border-left: 4px solid #3b82f6; padding-left: 8px; }
        .info-grid { width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 20px; }
        .info-grid td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }
        .label { font-weight: 700; color: #475569; width: 38%; }
        .value { color: #0f172a; font-weight: 600; }
        .footer-note { text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
        @media print {
          body { padding: 0; background: none; }
          .container { border: none; box-shadow: none; padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="title">เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า</div>
          <div class="subtitle">ระบบบริหารจัดการหอพัก HorPlus</div>
        </div>
        
        <div class="card-frame">
          ${hasPhoto
            ? `<img src="${photoUrl}" class="card-img" alt="สำเนาบัตรประชาชน" />`
            : '<div class="no-img">( ไม่ได้แนบไฟล์ภาพถ่ายสำเนาบัตรประชาชน )</div>'}
        </div>

        <div class="section-title">ข้อมูลส่วนตัวผู้เช่า</div>
        <table class="info-grid">
          <tr><td class="label">ชื่อ-นามสกุล:</td><td class="value">${tenant.name || tenant.displayName || '-'}</td></tr>
          <tr><td class="label">เลขประจำตัวประชาชน:</td><td class="value">${tenant.citizenId || tenant.nationalIdMasked || '-'}</td></tr>
          <tr><td class="label">เบอร์โทรศัพท์:</td><td class="value">${tenant.phone || '-'}</td></tr>
          <tr><td class="label">อีเมล:</td><td class="value">${tenant.email || '-'}</td></tr>
          <tr><td class="label">ผู้ติดต่อฉุกเฉิน:</td><td class="value">${emergencyText}</td></tr>
        </table>

        <div class="footer-note">เอกสารนี้พิมพ์จากระบบบริหารจัดการหอพัก เมื่อ ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} น.</div>
      </div>
      ${autoPrint ? `
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 400);
        };
      </script>
      ` : ''}
    </body>
    </html>
  `);
  printWindow.document.close();
  return printWindow;
}
