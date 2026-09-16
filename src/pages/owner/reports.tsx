/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { httpRequest } from '../../data/httpClient';
import {
  TrendingUp,
  Download,
  Calendar,
  Building2 as BuildingIcon,
  BarChart4,
  DollarSign,
  CheckCircle2,
  CheckCircle,
  AlertTriangle,
  Home as HomeIcon,
  Zap,
  Droplet,
  Globe as GlobeIcon,
  Printer,
  Clock,
  X,
  FileText,
  FileSpreadsheet,
  ShieldCheck,
  Wrench,
  ChevronDown
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend
} from 'recharts';
import { Room, Bill, Building, Tenant, Contract, MaintenanceRequest as RepairRequest } from '../../types';
import { calculateOwnerReports, toSatangs, satangsToString } from '../../utils/report-calculations';
import { calculateCategoryStrictVat } from '../../utils/vat-calculator';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

interface OwnerReportsProps {
  rooms?: Room[];
  bills?: Bill[];
  buildings?: Building[];
  tenants?: Tenant[];
  contracts?: Contract[];
  repairs?: RepairRequest[];
  dormitory?: any;
  billingCycles?: any[];
  selectedBillingCycleId?: string; // Authoritative UUID
  selectedCycleCode?: string;      // Canonical YYYY-MM
  selectedCycle?: string;          // Backward compatibility
  onNavigate?: (tab: string, param?: string) => void;
}

const formatBaht = (val: number | string) => {
  const num = typeof val === 'string' ? parseFloat(val) || 0 : val || 0;
  return `฿ ${num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatThaiPhoneNumber = (phone: any): string => {
  if (!phone || phone === '-') return '-';
  const str = String(phone).trim();
  const digits = str.replace(/\D/g, '');
  if (!digits) return str || '-';

  // Thai phone numbers: 9 or 10 digits
  // If starts with country code 66 (e.g. 66812345678 or 6621234567)
  if (digits.startsWith('66') && digits.length >= 10) {
    return '0' + digits.slice(2);
  }
  // If 9 digits starting with mobile/landline prefix (e.g. 812345678, 912345678, 612345678, 2123456)
  if (digits.length === 9 && ['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(digits[0])) {
    return '0' + digits;
  }
  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }
  return str;
};

export const translateNotesToThai = (rawNote: any): string => {
  if (!rawNote || rawNote === '-' || String(rawNote).trim() === '') return '-';
  const trimmed = String(rawNote).trim();

  const dict: Record<string, string> = {
    'OWNER_METER_SWITCH_OFF': 'ปิดสวิตช์ออกบิลในหน้าจดมิเตอร์',
    'Cancelled by staff': 'ยกเลิกโดยเจ้าหน้าที่',
    'Reissued due to meter correction': 'ออกบิลใหม่เนื่องจากแก้ไขค่ามิเตอร์',
    'MANUAL_CANCEL': 'ยกเลิกรายการโดยเจ้าของหอ',
    'VACANT_ROOM': 'ห้องว่าง ไม่มีการออกบิล',
    'TENANT_MOVED_OUT': 'ผู้เช่าย้ายออกแล้ว',
    'SYSTEM_RECALCULATED': 'ระบบคำนวณบิลใหม่',
    'DUPLICATE_BILL': 'ยกเลิกเนื่องจากบิลซ้ำซ้อน',
    'PAYMENT_REVERSED': 'ยกเลิกรายการชำระเงิน',
    'REJECTED': 'ปฏิเสธการชำระเงิน',
    'SLIP_VERIFIED': 'ตรวจสอบสลิปการโอนเงินแล้ว',
    'CASH_PAYMENT': 'ชำระด้วยเงินสด ณ เคาน์เตอร์',
    'TRANSFER_PAYMENT': 'ชำระโดยการโอนเงินผ่านธนาคาร',
    'PROMPTPAY_PAYMENT': 'ชำระผ่านพร้อมเพย์ / สแกน QR',
    'OVERDUE_AUTO_PENALTY': 'ค่าปรับล่าช้าอัตโนมัติ'
  };

  if (dict[trimmed]) return dict[trimmed];

  if (trimmed.startsWith('Rejected:')) {
    const reason = trimmed.replace(/^Rejected:\s*/i, '');
    return `ปฏิเสธการชำระเงิน: ${dict[reason] || reason}`;
  }
  if (trimmed.startsWith('Reversed:')) {
    const reason = trimmed.replace(/^Reversed:\s*/i, '');
    return `ยกเลิกการชำระเงิน: ${dict[reason] || reason}`;
  }
  if (trimmed.toUpperCase().includes('OWNER_METER_SWITCH_OFF')) {
    return 'ปิดสวิตช์ออกบิลในหน้าจดมิเตอร์';
  }
  if (trimmed.toLowerCase().includes('cancelled by staff')) {
    return 'ยกเลิกโดยเจ้าหน้าที่';
  }
  if (trimmed.toLowerCase().includes('meter correction')) {
    return 'ออกบิลใหม่เนื่องจากแก้ไขค่ามิเตอร์';
  }

  return trimmed;
};

const CountUp: React.FC<{ value: number; prefix?: string }> = ({
  value,
  prefix = '฿ '
}) => {
  return (
    <span>
      {prefix}
      {value.toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}
    </span>
  );
};


// Helper for CSV cell escaping per RFC 4180
export const escapeCsv = (val: any): string => {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
};

export const fmtNum = (val: number | string | bigint | null | undefined): string => {
  const num = typeof val === 'bigint' ? Number(val) / 100 : Number(val || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

export const formatDateOnly = (d: any): string => {
  if (!d) return '-';
  try {
    const dt = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(dt.getTime())) return String(d);
    return dt.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
};

export const extractBillDetails = (
  b: any,
  context?: { rooms?: Room[]; buildings?: Building[]; tenants?: Tenant[]; vatSettings?: any }
) => {
  const rooms = context?.rooms || [];
  const buildings = context?.buildings || [];
  const tenants = context?.tenants || [];

  const rm = rooms.find(r => r.id === b.roomId || (b.roomNumber && r.roomNumber === b.roomNumber) || r.roomNumber === b.roomId);
  const bld = buildings.find(bldg => bldg.id === rm?.buildingId);
  const buildingName = bld ? bld.name : (rm?.buildingId ? rm.buildingId : 'ไม่ระบุอาคาร');
  const floorStr = rm?.floor !== undefined && rm?.floor !== null ? `${rm.floor}` : '-';
  const roomNumber = rm?.roomNumber || b.roomNumber || 'ไม่ระบุ';

  const tenant = tenants.find(t => t.id === b.tenantId || t.id === rm?.currentTenantId);
  const tenantName = tenant?.name || tenant?.displayName || b.tenant?.name || b.tenant?.displayName || '-';
  const rawPhone = tenant?.phone || b.tenant?.phone || '-';
  const tenantPhone = formatThaiPhoneNumber(rawPhone);

  // Occupants count (Primary tenant + Co-occupants)
  const peopleCount = 1 + (Array.isArray(tenant?.coOccupants) ? tenant.coOccupants.length : 0);

  // Vehicles count
  let vehicleCount = 0;
  if (Array.isArray(tenant?.vehicles) && tenant.vehicles.length > 0) {
    vehicleCount = tenant.vehicles.length;
  } else if (tenant?.vehicle?.plate || (tenant as any)?.vehiclePlate) {
    vehicleCount = 1;
  }

  const billNumber = b.billNumber || b.id || '-';

  const statusMap: Record<string, string> = {
    paid: 'ชำระแล้ว',
    unpaid: 'ยังไม่ชำระ',
    pending: 'รอชำระ',
    overdue: 'เกินกำหนดชำระ',
    partially_paid: 'ชำระบางส่วน',
    partial: 'ชำระบางส่วน',
    cancelled: 'ยกเลิก'
  };
  const statusLower = (b.status || '').toLowerCase();
  const statusStr = statusMap[statusLower] || b.status || 'ยังไม่ชำระ';

  // Payment method mapping
  const rawMethod = b.Payment?.[0]?.paymentMethod || b.payments?.[0]?.paymentMethod || b.paymentMethod || b.Payment?.[0]?.method || b.payments?.[0]?.method;
  const methodMap: Record<string, string> = {
    promptpay: 'พร้อมเพย์ / สแกน QR',
    prompt_pay: 'พร้อมเพย์ / สแกน QR',
    qr: 'พร้อมเพย์ / สแกน QR',
    bank_transfer: 'โอนผ่านธนาคาร',
    transfer: 'โอนผ่านธนาคาร',
    cash: 'เงินสด',
    credit_card: 'บัตรเครดิต',
    credit: 'บัตรเครดิต',
  };
  const paymentMethodStr = rawMethod
    ? (methodMap[String(rawMethod).toLowerCase()] || String(rawMethod))
    : (statusLower === 'paid' ? 'โอนเงิน / พร้อมเพย์' : '-');

  const dueDateStr = formatDateOnly(b.dueDate);
  const paidDateStr = formatDateOnly(b.paidAt || b.paymentDate);

  // Parse items
  const items = Array.isArray(b.items) ? b.items : [];

  // Rent
  let rentAmt = 0;
  const rentItem = items.find((i: any) => (i.category || i.type) === 'rent');
  if (rentItem) {
    rentAmt = Number(rentItem.amount || 0);
  } else if (b.rentAmount !== undefined && b.rentAmount !== null) {
    rentAmt = Number(b.rentAmount || 0);
  }

  // Water
  let waterAmt = 0;
  let waterUnits = 0;
  const waterItem = items.find((i: any) => (i.category || i.type) === 'water');
  if (waterItem) {
    waterAmt = Number(waterItem.amount || 0);
    waterUnits = Number(waterItem.quantity || waterItem.unitCount || waterItem.metadata?.usageUnits || 0);
  } else if (b.waterAmount !== undefined && b.waterAmount !== null) {
    waterAmt = Number(b.waterAmount || 0);
  }

  // Electricity
  let elecAmt = 0;
  let elecUnits = 0;
  const elecItem = items.find((i: any) => (i.category || i.type) === 'electricity' || (i.category || i.type) === 'electric');
  if (elecItem) {
    elecAmt = Number(elecItem.amount || 0);
    elecUnits = Number(elecItem.quantity || elecItem.unitCount || elecItem.metadata?.usageUnits || 0);
  } else if (b.electricAmount !== undefined && b.electricAmount !== null) {
    elecAmt = Number(b.electricAmount || 0);
  }

  // Common
  let commonAmt = 0;
  const commonItem = items.find((i: any) => ['common', 'common_fee', 'central'].includes(i.category || i.type));
  if (commonItem) {
    commonAmt = Number(commonItem.amount || 0);
  } else if (b.commonFee !== undefined && b.commonFee !== null) {
    commonAmt = Number(b.commonFee || 0);
  }

  // Internet
  let internetAmt = 0;
  const internetItem = items.find((i: any) => ['internet', 'wifi', 'net'].includes(i.category || i.type));
  if (internetItem) {
    internetAmt = Number(internetItem.amount || 0);
  } else if (b.internetFee !== undefined && b.internetFee !== null) {
    internetAmt = Number(b.internetFee || 0);
  }

  // Parking
  let parkingAmt = 0;
  const parkingItem = items.find((i: any) => ['parking', 'car_park', 'vehicle'].includes(i.category || i.type));
  if (parkingItem) {
    parkingAmt = Number(parkingItem.amount || 0);
  } else if (b.parkingFee !== undefined && b.parkingFee !== null) {
    parkingAmt = Number(b.parkingFee || 0);
  }

  // Other services
  let otherAmt = 0;
  const otherDescs: string[] = [];
  const otherItems = items.filter((i: any) => {
    const cat = (i.category || '').toLowerCase();
    const typ = (i.type || '').toLowerCase();
    const desc = (i.description || '').toLowerCase();
    if (desc.includes('ประกัน') || desc.includes('มัดจำ')) return false;
    const isOtherCat = ['other', 'other_fee', 'other_fees', 'repair', 'addon', 'cleaning'].includes(cat) ||
      ['other', 'other_fee', 'other_fees', 'repair', 'addon', 'cleaning'].includes(typ);
    const isOtherDesc = desc.includes('ค่าใช้จ่ายอื่น') || desc.includes('ก่อนย้ายออก') || desc.includes('ค่าบริการ') || desc.includes('ทำความสะอาด');
    return isOtherCat || isOtherDesc;
  });
  if (otherItems.length > 0) {
    otherItems.forEach((i: any) => {
      otherAmt += Number(i.amount || 0);
      if (i.description) otherDescs.push(i.description);
    });
  } else if (b.otherServicesAmount) {
    otherAmt = Number(b.otherServicesAmount || 0);
  }
  const otherDesc = otherDescs.length > 0 ? otherDescs.join('; ') : '-';

  // Fines
  let fineAmt = 0;
  const fineItems = items.filter((i: any) => {
    const cat = (i.category || '').toLowerCase();
    const typ = (i.type || '').toLowerCase();
    const desc = (i.description || '').toLowerCase();
    return ['fine', 'late_fee', 'late_fine'].includes(cat) ||
      ['fine', 'late_fee', 'late_fine'].includes(typ) ||
      desc.includes('ค่าปรับ') || desc.includes('ล่าช้า');
  });
  if (fineItems.length > 0) {
    fineAmt = fineItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  } else if (b.fineAmount) {
    fineAmt = Number(b.fineAmount || 0);
  }

  // Discounts
  let discountAmt = 0;
  const discItems = items.filter((i: any) => {
    const cat = (i.category || i.type || '').toLowerCase();
    const desc = (i.description || '').toLowerCase();
    return cat === 'discount' || desc.includes('ส่วนลด') || desc.includes('โปรโมชั่น');
  });
  if (discItems.length > 0) {
    discountAmt = discItems.reduce((s: number, i: any) => s + Math.abs(Number(i.amount || 0)), 0);
  } else if (b.discountAmount !== undefined && b.discountAmount !== null) {
    discountAmt = Math.abs(Number(b.discountAmount || 0));
  }

  // Deposit
  let depositAmt = 0;
  const depItem = items.find((i: any) => {
    const cat = (i.category || i.type || '').toLowerCase();
    const desc = (i.description || '').toLowerCase();
    return cat === 'deposit' || cat === 'security_deposit' || desc.includes('เงินประกัน') || desc.includes('มัดจำ');
  });
  if (depItem) {
    depositAmt = Number(depItem.amount || 0);
  } else if (b.depositAmount !== undefined && b.depositAmount !== null) {
    depositAmt = Number(b.depositAmount || 0);
  }

  // VAT and Net amounts
  let vatAmt = 0;
  if (b.vatAmount !== undefined && b.vatAmount !== null) {
    vatAmt = Number(b.vatAmount || 0);
  } else if (Array.isArray(items)) {
    items.forEach((it: any) => {
      if (it.metadata?.vatAmount) vatAmt += Number(it.metadata.vatAmount || 0);
    });
  }

  // Fallback calculation if vatAmt is 0 and cycle/dorm has VAT active
  if (vatAmt === 0 && (b.isVatActive || context?.vatSettings?.enabled) && Array.isArray(items) && items.length > 0) {
    const vatCalc = calculateCategoryStrictVat(items, context?.vatSettings || { enabled: true, rate: 7, appliedCategories: ['rent'] });
    if (vatCalc.isVatActive) {
      vatAmt = Number(vatCalc.vatAmount);
    }
  }

  const netTotalAmt = Number(b.totalAmount || 0);
  const subtotalAmt = b.subtotal !== undefined && b.subtotal !== null
    ? Number(b.subtotal)
    : Math.max(0, netTotalAmt - vatAmt);

  const totalBilled = netTotalAmt;
  const paidAmt = statusLower === 'paid'
    ? (Number(b.paidAmount) > 0 ? Number(b.paidAmount) : totalBilled)
    : Number(b.paidAmount || 0);
  const outstandingAmt = statusLower === 'paid'
    ? 0
    : (b.outstandingAmount !== undefined ? Number(b.outstandingAmount) : Math.max(0, totalBilled - paidAmt));

  const rawNotes = b.notes || b.cancellationReason || '-';
  const notes = translateNotesToThai(rawNotes);

  return {
    billId: b.id,
    roomNumber,
    buildingName,
    floorStr,
    tenantName,
    tenantPhone,
    peopleCount,
    vehicleCount,
    billNumber,
    statusStr,
    paymentMethodStr,
    dueDateStr,
    paidDateStr,
    rentAmt,
    waterUnits,
    waterAmt,
    elecUnits,
    elecAmt,
    commonAmt,
    internetAmt,
    parkingAmt,
    otherAmt,
    otherDesc,
    fineAmt,
    discountAmt,
    depositAmt,
    subtotalAmt,
    vatAmt,
    netTotalAmt,
    totalBilled,
    paidAmt,
    outstandingAmt,
    notes
  };
};

export const generateRawGridLines = (billDetailsList: ReturnType<typeof extractBillDetails>[]) => {
  const headers = [
    'ลำดับ',
    'อาคาร',
    'ชั้น',
    'เลขห้อง',
    'ชื่อผู้เช่า',
    'เบอร์โทรศัพท์',
    'จำนวนผู้พักอาศัย (คน)',
    'จำนวนยานพาหนะ (คัน)',
    'เลขที่บิล',
    'สถานะบิล',
    'ช่องทางการชำระเงิน',
    'วันครบกำหนดชำระ',
    'วันที่ชำระเงิน',
    'ค่าเช่าห้อง (บาท)',
    'หน่วยน้ำที่ใช้',
    'ค่าน้ำประปา (บาท)',
    'หน่วยไฟที่ใช้',
    'ค่าไฟฟ้า (บาท)',
    'ค่าส่วนกลาง (บาท)',
    'ค่าอินเทอร์เน็ต (บาท)',
    'ค่าที่จอดรถ (บาท)',
    'ค่าบริการอื่นๆ (บาท)',
    'รายละเอียดค่าบริการอื่นๆ',
    'ค่าปรับชำระเกินกำหนด (บาท)',
    'ส่วนลด (บาท)',
    'เงินประกันสัญญา (บาท)',
    'ยอดรวมก่อน VAT (บาท)',
    'ภาษีมูลค่าเพิ่ม 7% (บาท)',
    'ยอดรวมสุทธิ (บาท)',
    'ยอดชำระแล้ว (บาท)',
    'ยอดค้างชำระ (บาท)',
    'หมายเหตุ'
  ];

  let sumPeople = 0;
  let sumVehicles = 0;
  let sumRent = 0;
  let sumWaterUnits = 0;
  let sumWaterAmt = 0;
  let sumElecUnits = 0;
  let sumElecAmt = 0;
  let sumCommon = 0;
  let sumInternet = 0;
  let sumParking = 0;
  let sumOther = 0;
  let sumFine = 0;
  let sumDiscount = 0;
  let sumDeposit = 0;
  let sumSubtotal = 0;
  let sumVat = 0;
  let sumNetTotal = 0;
  let sumPaid = 0;
  let sumOutstanding = 0;

  const dataRows = billDetailsList.map((d, idx) => {
    sumPeople += d.peopleCount;
    sumVehicles += d.vehicleCount;
    sumRent += d.rentAmt;
    sumWaterUnits += d.waterUnits;
    sumWaterAmt += d.waterAmt;
    sumElecUnits += d.elecUnits;
    sumElecAmt += d.elecAmt;
    sumCommon += d.commonAmt;
    sumInternet += d.internetAmt;
    sumParking += d.parkingAmt;
    sumOther += d.otherAmt;
    sumFine += d.fineAmt;
    sumDiscount += d.discountAmt;
    sumDeposit += d.depositAmt;
    sumSubtotal += d.subtotalAmt;
    sumVat += d.vatAmt;
    sumNetTotal += d.netTotalAmt;
    sumPaid += d.paidAmt;
    sumOutstanding += d.outstandingAmt;

    return [
      escapeCsv(idx + 1),
      escapeCsv(d.buildingName),
      escapeCsv(d.floorStr),
      escapeCsv(d.roomNumber),
      escapeCsv(d.tenantName),
      d.tenantPhone !== '-' ? `="${d.tenantPhone}"` : `"-"`,
      escapeCsv(d.peopleCount),
      escapeCsv(d.vehicleCount),
      escapeCsv(d.billNumber),
      escapeCsv(d.statusStr),
      escapeCsv(d.paymentMethodStr),
      escapeCsv(d.dueDateStr),
      escapeCsv(d.paidDateStr),
      fmtNum(d.rentAmt),
      fmtNum(d.waterUnits),
      fmtNum(d.waterAmt),
      fmtNum(d.elecUnits),
      fmtNum(d.elecAmt),
      fmtNum(d.commonAmt),
      fmtNum(d.internetAmt),
      fmtNum(d.parkingAmt),
      fmtNum(d.otherAmt),
      escapeCsv(d.otherDesc),
      fmtNum(d.fineAmt),
      fmtNum(d.discountAmt > 0 ? -d.discountAmt : 0),
      fmtNum(d.depositAmt),
      fmtNum(d.subtotalAmt),
      fmtNum(d.vatAmt),
      fmtNum(d.netTotalAmt),
      fmtNum(d.paidAmt),
      fmtNum(d.outstandingAmt),
      escapeCsv(d.notes)
    ].join(',');
  });

  const totalRow = [
    escapeCsv('รวมทั้งหมด'),
    escapeCsv(''),
    escapeCsv(''),
    escapeCsv(`${billDetailsList.length} ห้อง`),
    escapeCsv(''),
    escapeCsv(''),
    escapeCsv(`${sumPeople} คน`),
    escapeCsv(`${sumVehicles} คัน`),
    escapeCsv(''),
    escapeCsv(''),
    escapeCsv(''),
    escapeCsv(''),
    escapeCsv(''),
    fmtNum(sumRent),
    fmtNum(sumWaterUnits),
    fmtNum(sumWaterAmt),
    fmtNum(sumElecUnits),
    fmtNum(sumElecAmt),
    fmtNum(sumCommon),
    fmtNum(sumInternet),
    fmtNum(sumParking),
    fmtNum(sumOther),
    escapeCsv(''),
    fmtNum(sumFine),
    fmtNum(sumDiscount > 0 ? -sumDiscount : 0),
    fmtNum(sumDeposit),
    fmtNum(sumSubtotal),
    fmtNum(sumVat),
    fmtNum(sumNetTotal),
    fmtNum(sumPaid),
    fmtNum(sumOutstanding),
    escapeCsv('')
  ].join(',');

  return {
    headerLine: headers.map(escapeCsv).join(','),
    dataRows,
    totalRow
  };
};

// Helper to calculate generous, auto-fitted column widths for any worksheet
export const autoFitColumns = (ws: ExcelJS.Worksheet, minWidths: number[] = []) => {
  ws.columns.forEach((column, colIdx) => {
    let maxVisualLen = 0;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      let str = '';
      const val = cell.value;
      if (typeof val === 'string') {
        str = val;
      } else if (typeof val === 'number') {
        str = val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (val && typeof val === 'object') {
        if ('result' in val && val.result != null) {
          str = typeof val.result === 'number'
            ? val.result.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : String(val.result);
        } else if ('formula' in val) {
          str = '999,999.00';
        }
      } else if (val != null) {
        str = String(val);
      }
      // Remove Thai combining vowel/tone marks for accurate character width
      const visual = str.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '');
      const len = Math.max(str.length * 0.85, visual.length);
      if (len > maxVisualLen) {
        maxVisualLen = len;
      }
    });

    const baseMin = minWidths[colIdx] || 14;
    // +6 padding for filter dropdown icon and comfortable margin
    const contentWidth = Math.ceil(maxVisualLen + 6);
    column.width = Math.max(baseMin, contentWidth);
  });
};

export const build30ColWorksheet = (ws: ExcelJS.Worksheet, details: ReturnType<typeof extractBillDetails>[]) => {
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1, topLeftCell: 'E2' }];

  const headers = [
    'ลำดับ', 'อาคาร', 'ชั้น', 'เลขห้อง', 'ชื่อผู้เช่า', 'เบอร์โทรศัพท์', 'จำนวนผู้พักอาศัย (คน)', 'จำนวนยานพาหนะ (คัน)',
    'เลขที่บิล', 'สถานะบิล', 'ช่องทางการชำระเงิน', 'วันครบกำหนดชำระ', 'วันที่ชำระเงิน',
    'ค่าเช่าห้อง (บาท)', 'หน่วยน้ำที่ใช้', 'ค่าน้ำประปา (บาท)', 'หน่วยไฟที่ใช้', 'ค่าไฟฟ้า (บาท)',
    'ค่าส่วนกลาง (บาท)', 'ค่าอินเทอร์เน็ต (บาท)', 'ค่าที่จอดรถ (บาท)', 'ค่าบริการอื่นๆ (บาท)', 'รายละเอียดค่าบริการอื่นๆ',
    'ค่าปรับชำระเกินกำหนด (บาท)', 'ส่วนลด (บาท)', 'เงินประกันสัญญา (บาท)',
    'ยอดรวมก่อน VAT (บาท)', 'ภาษีมูลค่าเพิ่ม 7% (บาท)', 'ยอดรวมสุทธิ (บาท)', 'ยอดชำระแล้ว (บาท)', 'ยอดค้างชำระ (บาท)', 'หมายเหตุ'
  ];

  const headerRow = ws.addRow(headers);
  headerRow.height = 36;

  const groupColors = [
    { start: 1, end: 8, fill: '1E293B' },  // Slate 800 (Room & Tenant info)
    { start: 9, end: 13, fill: '4338CA' }, // Indigo 700 (Bill status & payment)
    { start: 14, end: 18, fill: '0E7490' },// Cyan 700 (Rent & utilities)
    { start: 19, end: 23, fill: '047857' },// Emerald 700 (Common & add-on services)
    { start: 24, end: 26, fill: '7C3AED' },// Purple 700 (Fine, discount, deposit)
    { start: 27, end: 29, fill: '1D4ED8' }, // Royal Blue 700 (Summary totals with VAT)
    { start: 30, end: 32, fill: '0F172A' }  // Slate 900 (Settlement & Notes)
  ];

  groupColors.forEach(g => {
    for (let c = g.start; c <= g.end; c++) {
      const cell = headerRow.getCell(c);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF' + g.fill }
      };
      cell.font = {
        name: 'Sarabun',
        family: 2,
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } }
      };
    }
  });

  let sumPeople = 0;
  let sumVehicles = 0;
  let sumRent = 0;
  let sumWaterUnits = 0;
  let sumWaterAmt = 0;
  let sumElecUnits = 0;
  let sumElecAmt = 0;
  let sumCommon = 0;
  let sumInternet = 0;
  let sumParking = 0;
  let sumOther = 0;
  let sumFine = 0;
  let sumDiscount = 0;
  let sumDeposit = 0;
  let sumSubtotal = 0;
  let sumVat = 0;
  let sumNetTotal = 0;
  let sumPaid = 0;
  let sumOutstanding = 0;

  details.forEach((d, idx) => {
    const rIdx = idx + 2;
    sumPeople += d.peopleCount;
    sumVehicles += d.vehicleCount;
    sumRent += d.rentAmt;
    sumWaterUnits += d.waterUnits;
    sumWaterAmt += d.waterAmt;
    sumElecUnits += d.elecUnits;
    sumElecAmt += d.elecAmt;
    sumCommon += d.commonAmt;
    sumInternet += d.internetAmt;
    sumParking += d.parkingAmt;
    sumOther += d.otherAmt;
    sumFine += d.fineAmt;
    sumDiscount += d.discountAmt;
    sumDeposit += d.depositAmt;
    sumSubtotal += d.subtotalAmt;
    sumVat += d.vatAmt;
    sumNetTotal += d.netTotalAmt;
    sumPaid += d.paidAmt;
    sumOutstanding += d.outstandingAmt;

    const isEven = idx % 2 === 0;
    const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

    const row = ws.addRow([
      idx + 1,
      d.buildingName,
      d.floorStr,
      d.roomNumber,
      d.tenantName,
      d.tenantPhone,
      d.peopleCount,
      d.vehicleCount,
      d.billNumber,
      d.statusStr,
      d.paymentMethodStr,
      d.dueDateStr,
      d.paidDateStr,
      d.rentAmt,
      d.waterUnits,
      d.waterAmt,
      d.elecUnits,
      d.elecAmt,
      d.commonAmt,
      d.internetAmt,
      d.parkingAmt,
      d.otherAmt,
      d.otherDesc,
      d.fineAmt,
      d.discountAmt > 0 ? -d.discountAmt : 0,
      d.depositAmt,
      { formula: `N${rIdx}+P${rIdx}+R${rIdx}+S${rIdx}+T${rIdx}+U${rIdx}+V${rIdx}+X${rIdx}+Y${rIdx}+Z${rIdx}`, result: d.subtotalAmt },
      d.vatAmt,
      { formula: `AA${rIdx}+AB${rIdx}`, result: d.netTotalAmt },
      d.paidAmt,
      { formula: `MAX(0, AC${rIdx}-AD${rIdx})`, result: d.outstandingAmt },
      d.notes
    ]);

    row.height = 24;

    // Automatically hide rows with 'ยกเลิก' by default per PO request
    if (d.statusStr === 'ยกเลิก' || d.statusStr.includes('ยกเลิก')) {
      row.hidden = true;
    }

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rowBg }
      };
      cell.font = {
        name: 'Sarabun',
        family: 2,
        size: 10,
        color: { argb: 'FF1E293B' }
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if ([1, 2, 3, 4, 9, 12, 13].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (colNumber === 4) {
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF0F172A' } };
        }
      } else if (colNumber === 6) {
        // Explicit text format for phone numbers ensures Excel keeps leading 0
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.numFmt = '@';
      } else if (colNumber === 10) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (d.statusStr.includes('ชำระแล้ว')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF065F46' } };
        } else if (d.statusStr.includes('เกินกำหนด')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF92400E' } };
        } else if (d.statusStr.includes('ยังไม่ชำระ') || d.statusStr.includes('รอชำระ')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF991B1B' } };
        } else if (d.statusStr.includes('ยกเลิก')) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF64748B' } };
        }
      } else if ([7, 8, 15, 17].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
      } else if ([14, 16, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0.00';
        if (colNumber === 27) {
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF1E293B' } };
        } else if (colNumber === 28) {
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFD97706' } };
        } else if (colNumber === 29) {
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
        } else if (colNumber === 30) {
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF047857' } };
        } else if (colNumber === 31 && d.outstandingAmt > 0) {
          cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
        }
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    });
  });

  const startRow = 2;
  const endRow = Math.max(2, details.length + 1);

  // The Total row uses SUBTOTAL(9, ...) Excel formulas so editing numbers or filtering recalculates dynamically
  const totalRow = ws.addRow([
    'รวมทั้งหมด',
    '',
    '',
    `${details.length} ห้อง`,
    '',
    '',
    { formula: `SUBTOTAL(9, G${startRow}:G${endRow})`, result: sumPeople },
    { formula: `SUBTOTAL(9, H${startRow}:H${endRow})`, result: sumVehicles },
    '',
    '',
    '',
    '',
    '',
    { formula: `SUBTOTAL(9, N${startRow}:N${endRow})`, result: sumRent },
    { formula: `SUBTOTAL(9, O${startRow}:O${endRow})`, result: sumWaterUnits },
    { formula: `SUBTOTAL(9, P${startRow}:P${endRow})`, result: sumWaterAmt },
    { formula: `SUBTOTAL(9, Q${startRow}:Q${endRow})`, result: sumElecUnits },
    { formula: `SUBTOTAL(9, R${startRow}:R${endRow})`, result: sumElecAmt },
    { formula: `SUBTOTAL(9, S${startRow}:S${endRow})`, result: sumCommon },
    { formula: `SUBTOTAL(9, T${startRow}:T${endRow})`, result: sumInternet },
    { formula: `SUBTOTAL(9, U${startRow}:U${endRow})`, result: sumParking },
    { formula: `SUBTOTAL(9, V${startRow}:V${endRow})`, result: sumOther },
    '',
    { formula: `SUBTOTAL(9, X${startRow}:X${endRow})`, result: sumFine },
    { formula: `SUBTOTAL(9, Y${startRow}:Y${endRow})`, result: sumDiscount > 0 ? -sumDiscount : 0 },
    { formula: `SUBTOTAL(9, Z${startRow}:Z${endRow})`, result: sumDeposit },
    { formula: `SUBTOTAL(9, AA${startRow}:AA${endRow})`, result: sumSubtotal },
    { formula: `SUBTOTAL(9, AB${startRow}:AB${endRow})`, result: sumVat },
    { formula: `SUBTOTAL(9, AC${startRow}:AC${endRow})`, result: sumNetTotal },
    { formula: `SUBTOTAL(9, AD${startRow}:AD${endRow})`, result: sumPaid },
    { formula: `SUBTOTAL(9, AE${startRow}:AE${endRow})`, result: sumOutstanding },
    ''
  ]);

  totalRow.height = 28;
  totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' }
    };
    cell.font = {
      name: 'Sarabun',
      family: 2,
      size: 10,
      bold: true,
      color: { argb: 'FF0F172A' }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF64748B' } },
      bottom: { style: 'double', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };

    if ([1, 2, 3, 4].includes(colNumber)) {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    } else if ([7, 8, 15, 17].includes(colNumber)) {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0';
    } else if ([14, 16, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31].includes(colNumber)) {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = '#,##0.00';
      if (colNumber === 27) {
        cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF1E293B' } };
      } else if (colNumber === 28) {
        cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFD97706' } };
      } else if (colNumber === 29) {
        cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
      } else if (colNumber === 30) {
        cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF047857' } };
      } else if (colNumber === 31) {
        cell.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
      }
    }
  });

  // AutoFilter covers header row down to the last data row (excludes summary Total row)
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: endRow, column: 32 }
  };

  const baseMinWidths = [
    8,  // 1: ลำดับ
    14, // 2: อาคาร
    8,  // 3: ชั้น
    14, // 4: เลขห้อง
    26, // 5: ชื่อผู้เช่า
    18, // 6: เบอร์โทรศัพท์
    26, // 7: จำนวนผู้พักอาศัย (คน)
    25, // 8: จำนวนยานพาหนะ (คัน)
    22, // 9: เลขที่บิล
    18, // 10: สถานะบิล
    25, // 11: ช่องทางการชำระเงิน
    22, // 12: วันครบกำหนดชำระ
    20, // 13: วันที่ชำระเงิน
    22, // 14: ค่าเช่าห้อง (บาท)
    18, // 15: หน่วยน้ำที่ใช้
    22, // 16: ค่าน้ำประปา (บาท)
    18, // 17: หน่วยไฟที่ใช้
    22, // 18: ค่าไฟฟ้า (บาท)
    22, // 19: ค่าส่วนกลาง (บาท)
    24, // 20: ค่าอินเทอร์เน็ต (บาท)
    22, // 21: ค่าที่จอดรถ (บาท)
    24, // 22: ค่าบริการอื่นๆ (บาท)
    28, // 23: รายละเอียดค่าบริการอื่นๆ
    32, // 24: ค่าปรับชำระเกินกำหนด (บาท)
    18, // 25: ส่วนลด (บาท)
    26, // 26: เงินประกันสัญญา (บาท)
    26, // 27: ยอดรวมก่อน VAT (บาท)
    24, // 28: ภาษีมูลค่าเพิ่ม 7% (บาท)
    26, // 29: ยอดรวมสุทธิ (บาท)
    24, // 30: ยอดชำระแล้ว (บาท)
    24, // 31: ยอดค้างชำระ (บาท)
    36  // 32: หมายเหตุ
  ];

  autoFitColumns(ws, baseMinWidths);
};

export const OwnerReports: React.FC<OwnerReportsProps> = ({
  rooms = [],
  bills = [],
  buildings = [],
  tenants = [],
  contracts = [],
  repairs = [],
  dormitory,
  billingCycles = [],
  selectedBillingCycleId,
  selectedCycleCode,
  selectedCycle: propSelectedCycle,
  onNavigate
}) => {
  const currentYearStr = new Date().getFullYear().toString();
  const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0');
  const defaultCurrentCycle = `${currentYearStr}-${currentMonthStr}`;

  const effectiveCycleCode = selectedCycleCode || propSelectedCycle || defaultCurrentCycle;
  const [selectedYear, setSelectedYear] = useState(effectiveCycleCode ? effectiveCycleCode.split('-')[0] : currentYearStr);
  const [selectedBuilding, setSelectedBuilding] = useState('all');
  const [showExportPopover, setShowExportPopover] = useState(false);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [toastMessage, setToastMessage] = useState<string | null>(null);


  // Month Names Mapping
  const monthNames: Record<string, string> = {
    '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
    '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
    '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
  };

  // Available building options
  const buildingOptions = useMemo(() => {
    return buildings || [];
  }, [buildings]);

  const hasUnspecifiedRooms = useMemo(() => {
    return (rooms || []).some(r => !r.buildingId);
  }, [rooms]);

  // Execute canonical shared report calculations
  const reportData = useMemo(() => {
    return calculateOwnerReports({
      rooms,
      bills,
      buildings,
      tenants,
      contracts,
      repairs,
      selectedBuilding,
      selectedBillingCycleId,
      selectedCycleCode: effectiveCycleCode,
      selectedCycle: propSelectedCycle,
      selectedYear,
    });
  }, [rooms, bills, buildings, tenants, contracts, repairs, selectedBuilding, selectedBillingCycleId, effectiveCycleCode, propSelectedCycle, selectedYear]);

  // Resolve current active billing cycle object and rate snapshot
  const currentCycleObj = useMemo(() => {
    return (billingCycles || []).find((c: any) =>
      (selectedBillingCycleId && c.id === selectedBillingCycleId) ||
      (c.cycleCode && c.cycleCode === effectiveCycleCode) ||
      (c.id && c.id === effectiveCycleCode)
    );
  }, [billingCycles, selectedBillingCycleId, effectiveCycleCode]);

  // Fetch authoritative rate snapshot for effective cycle
  const [cycleRateSnapshotResponse, setCycleRateSnapshotResponse] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    if (!effectiveCycleCode) return;
    httpRequest<any>(
      'GET',
      `/api/v1/billing-cycles/by-code/${effectiveCycleCode}/rate-snapshot`,
      undefined,
      dormitory?.id ? { dormitoryId: dormitory.id } : undefined
    )
      .then((res) => {
        if (isMounted && res) {
          setCycleRateSnapshotResponse(res?.data || res);
        }
      })
      .catch(() => {
        // Fallback to props / cache
      });

    return () => {
      isMounted = false;
    };
  }, [effectiveCycleCode, dormitory?.id]);

  const activeSnapshot = useMemo(() => {
    const fromApi = cycleRateSnapshotResponse?.rateSnapshot || cycleRateSnapshotResponse;
    if (fromApi && (fromApi.waterBillingType || fromApi.waterRate !== undefined || fromApi.commonFee !== undefined)) {
      return fromApi;
    }
    if (currentCycleObj?.rateSnapshot) {
      return currentCycleObj.rateSnapshot;
    }
    return dormitory?.billingSettings || (dormitory as any)?.settings || null;
  }, [cycleRateSnapshotResponse, currentCycleObj, dormitory]);

  // Construct dynamic rate metadata based on authoritative cycle snapshot or fallback settings
  const rateMetadata = useMemo(() => {
    // 1. Water
    const waterType = (activeSnapshot?.waterBillingType || dormitory?.waterBillingType || 'per_unit').toLowerCase();
    const waterRateVal = activeSnapshot?.waterRate !== undefined ? activeSnapshot.waterRate : (dormitory?.waterUnitRate ?? '0');
    let waterBadge = 'ตามมิเตอร์จริง';
    let waterBadgeClass = 'bg-sky-50 text-sky-600 border-sky-100';
    let waterSubtitle = 'คิดตามยูนิตมิเตอร์จดประจำเดือน';
    let waterRateStr = `${waterRateVal} บาท/หน่วย`;
    let waterUnit = 'ตามมิเตอร์ / ห้อง';
    let waterExcelDesc = 'ตามหน่วยมิเตอร์น้ำ';

    if (waterType === 'per_person') {
      waterBadge = 'บาท/คน';
      waterBadgeClass = 'bg-sky-50 text-sky-600 border-sky-100';
      waterSubtitle = `คิดตามจำนวนผู้พักอาศัย (${waterRateVal} บาท/คน)`;
      waterRateStr = `${waterRateVal} บาท/คน`;
      waterUnit = 'บาท/คน / เดือน';
      waterExcelDesc = `คิดตามจำนวนคน (${waterRateVal} บาท/คน)`;
    } else if (waterType === 'fixed') {
      waterBadge = 'บาท/ห้อง';
      waterBadgeClass = 'bg-sky-50 text-sky-600 border-sky-100';
      waterSubtitle = `คิดอัตราคงที่ต่อห้อง (${waterRateVal} บาท/ห้อง)`;
      waterRateStr = `${waterRateVal} บาท/ห้อง`;
      waterUnit = 'บาท/ห้อง / เดือน';
      waterExcelDesc = `อัตราเหมาจ่าย (${waterRateVal} บาท/ห้อง)`;
    } else if (waterType === 'tiered') {
      waterBadge = 'คิดตามขั้นบันได';
      waterBadgeClass = 'bg-sky-50 text-sky-600 border-sky-100';
      waterSubtitle = 'คิดอัตราตามขั้นบันไดการใช้งานมิเตอร์น้ำ';
      waterRateStr = 'ตามขั้นบันได';
      waterUnit = 'ตามขั้นบันได';
      waterExcelDesc = 'ตามขั้นบันไดมิเตอร์น้ำ';
    } else if (waterType === 'free') {
      waterBadge = 'ไม่คิดค่าบริการ';
      waterBadgeClass = 'bg-emerald-50 text-emerald-600 border-emerald-100';
      waterSubtitle = 'ฟรี / ไม่คิดค่าน้ำประปาในงวดนี้';
      waterRateStr = 'ฟรี';
      waterUnit = 'ไม่คิดค่าบริการ';
      waterExcelDesc = 'ฟรีค่าน้ำประปา';
    } else {
      waterSubtitle = `คิดตามยูนิตมิเตอร์จดประจำเดือน (${waterRateVal} บาท/หน่วย)`;
    }

    // 2. Electricity
    const elecType = (activeSnapshot?.electricityBillingType || dormitory?.electricityBillingType || 'per_unit').toLowerCase();
    const elecRateVal = activeSnapshot?.electricityRate !== undefined ? activeSnapshot.electricityRate : (dormitory?.electricUnitRate ?? '0');
    let elecBadge = 'ตามมิเตอร์จริง';
    let elecBadgeClass = 'bg-amber-50 text-amber-700 border-amber-100';
    let elecSubtitle = 'คิดตามยูนิตมิเตอร์จดประจำเดือน';
    let elecRateStr = `${elecRateVal} บาท/หน่วย`;
    let elecUnit = 'ตามมิเตอร์ / ห้อง';
    let elecExcelDesc = 'ตามหน่วยมิเตอร์ไฟฟ้า';

    if (elecType === 'per_person') {
      elecBadge = 'บาท/คน';
      elecBadgeClass = 'bg-amber-50 text-amber-700 border-amber-100';
      elecSubtitle = `คิดตามจำนวนผู้พักอาศัย (${elecRateVal} บาท/คน)`;
      elecRateStr = `${elecRateVal} บาท/คน`;
      elecUnit = 'บาท/คน / เดือน';
      elecExcelDesc = `คิดตามจำนวนคน (${elecRateVal} บาท/คน)`;
    } else if (elecType === 'fixed') {
      elecBadge = 'บาท/ห้อง';
      elecBadgeClass = 'bg-amber-50 text-amber-700 border-amber-100';
      elecSubtitle = `คิดอัตราคงที่ต่อห้อง (${elecRateVal} บาท/ห้อง)`;
      elecRateStr = `${elecRateVal} บาท/ห้อง`;
      elecUnit = 'บาท/ห้อง / เดือน';
      elecExcelDesc = `อัตราเหมาจ่าย (${elecRateVal} บาท/ห้อง)`;
    } else if (elecType === 'tiered') {
      elecBadge = 'คิดตามขั้นบันได';
      elecBadgeClass = 'bg-amber-50 text-amber-700 border-amber-100';
      elecSubtitle = 'คิดอัตราตามขั้นบันไดการใช้งานมิเตอร์ไฟฟ้า';
      elecRateStr = 'ตามขั้นบันได';
      elecUnit = 'ตามขั้นบันได';
      elecExcelDesc = 'ตามขั้นบันไดมิเตอร์ไฟ';
    } else if (elecType === 'free') {
      elecBadge = 'ไม่คิดค่าบริการ';
      elecBadgeClass = 'bg-emerald-50 text-emerald-600 border-emerald-100';
      elecSubtitle = 'ฟรี / ไม่คิดค่าไฟฟ้าในงวดนี้';
      elecRateStr = 'ฟรี';
      elecUnit = 'ไม่คิดค่าบริการ';
      elecExcelDesc = 'ฟรีค่าไฟฟ้า';
    } else {
      elecSubtitle = `คิดตามยูนิตมิเตอร์จดประจำเดือน (${elecRateVal} บาท/หน่วย)`;
    }

    // 3. Common Fee
    const commonMode = (activeSnapshot?.commonFeeMode || dormitory?.commonFeeMode || 'per_room').toLowerCase();
    const commonRateVal = activeSnapshot?.commonFee !== undefined ? activeSnapshot.commonFee : (dormitory?.commonFee ?? '0');
    let commonBadge = 'บาท/ห้อง';
    let commonBadgeClass = 'bg-emerald-50 text-emerald-600 border-emerald-100';
    let commonSubtitle = `ค่าธรรมเนียมบำรุงรักษาส่วนกลาง (${commonRateVal} บาท/ห้อง)`;
    let commonRateStr = `${commonRateVal} บาท`;
    let commonUnit = 'ต่อห้อง / เดือน';
    let commonExcelDesc = `ค่าบริการพื้นที่ส่วนกลาง (${commonRateVal} บาท/ห้อง)`;

    if (commonMode === 'per_person') {
      commonBadge = 'บาท/คน';
      commonSubtitle = `ค่าบริการส่วนกลางตามจำนวนคน (${commonRateVal} บาท/คน)`;
      commonRateStr = `${commonRateVal} บาท/คน`;
      commonUnit = 'บาท/คน / เดือน';
      commonExcelDesc = `ค่าบริการส่วนกลางตามคน (${commonRateVal} บาท/คน)`;
    } else if (commonMode === 'free') {
      commonBadge = 'ไม่คิดค่าบริการ';
      commonSubtitle = 'ไม่คิดค่าบริการส่วนกลางในงวดนี้';
      commonRateStr = 'ฟรี';
      commonUnit = 'ไม่คิดค่าบริการ';
      commonExcelDesc = 'ฟรีค่าบริการส่วนกลาง';
    } else if (commonMode === 'per_room') {
      commonBadge = 'บาท/ห้อง';
      commonSubtitle = `ค่าธรรมเนียมบำรุงรักษาส่วนกลาง (${commonRateVal} บาท/ห้อง)`;
      commonRateStr = `${commonRateVal} บาท`;
      commonUnit = 'ต่อห้อง / เดือน';
      commonExcelDesc = `ค่าบริการส่วนกลางต่อห้อง (${commonRateVal} บาท/ห้อง)`;
    }

    // 4. Internet Fee
    const internetMode = (activeSnapshot?.internetFeeMode || dormitory?.internetFeeMode || 'per_room').toLowerCase();
    const internetRateVal = activeSnapshot?.internetFee !== undefined ? activeSnapshot.internetFee : (dormitory?.internetFee ?? '0');
    let internetBadge = 'บาท/ห้อง';
    let internetBadgeClass = 'bg-blue-50 text-blue-600 border-blue-100';
    let internetSubtitle = `ค่าบริการสัญญาณอินเทอร์เน็ต / Wi-Fi (${internetRateVal} บาท/ห้อง)`;
    let internetRateStr = `${internetRateVal} บาท`;
    let internetUnit = 'ต่อห้อง / เดือน';
    let internetExcelDesc = `ค่าบริการสัญญาณ WiFi (${internetRateVal} บาท/ห้อง)`;

    if (internetMode === 'per_person') {
      internetBadge = 'บาท/คน';
      internetSubtitle = `ค่าบริการสัญญาณ Wi-Fi ตามจำนวนคน (${internetRateVal} บาท/คน)`;
      internetRateStr = `${internetRateVal} บาท/คน`;
      internetUnit = 'บาท/คน / เดือน';
      internetExcelDesc = `ค่าบริการ WiFi ตามคน (${internetRateVal} บาท/คน)`;
    } else if (internetMode === 'free') {
      internetBadge = 'ไม่คิดค่าบริการ';
      internetBadgeClass = 'bg-emerald-50 text-emerald-600 border-emerald-100';
      internetSubtitle = 'ไม่คิดค่าบริการอินเทอร์เน็ตในงวดนี้';
      internetRateStr = 'ฟรี';
      internetUnit = 'ไม่คิดค่าบริการ';
      internetExcelDesc = 'ฟรีค่าอินเทอร์เน็ต';
    } else if (internetMode === 'per_room') {
      internetBadge = 'บาท/ห้อง';
      internetSubtitle = `ค่าบริการสัญญาณอินเทอร์เน็ต / Wi-Fi (${internetRateVal} บาท/ห้อง)`;
      internetRateStr = `${internetRateVal} บาท`;
      internetUnit = 'ต่อห้อง / เดือน';
      internetExcelDesc = `ค่าบริการ WiFi ต่อห้อง (${internetRateVal} บาท/ห้อง)`;
    }

    // 5. Parking Fee
    const parkingMode = (activeSnapshot?.parkingFeeMode || dormitory?.parkingFeeMode || 'per_room').toLowerCase();
    const parkingRateVal = activeSnapshot?.parkingFee !== undefined ? activeSnapshot.parkingFee : (dormitory?.parkingFee ?? '0');
    let parkingBadge = 'ตามยานพาหนะ/ห้อง';
    let parkingBadgeClass = 'bg-indigo-50 text-indigo-600 border-indigo-100';
    let parkingSubtitle = `ค่าบริการที่จอดรถยนต์ / รถจักรยานยนต์ (${parkingRateVal} บาท)`;
    let parkingRateStr = `${parkingRateVal} บาท`;
    let parkingUnit = 'ตามยานพาหนะ / ห้อง';
    let parkingExcelDesc = `ค่าบริการที่จอดรถ (${parkingRateVal} บาท)`;

    if (parkingMode === 'per_room') {
      parkingBadge = 'บาท/ห้อง';
      parkingSubtitle = `ค่าบริการที่จอดรถต่อห้อง (${parkingRateVal} บาท/ห้อง)`;
      parkingRateStr = `${parkingRateVal} บาท`;
      parkingUnit = 'ต่อห้อง / เดือน';
      parkingExcelDesc = `ค่าบริการที่จอดรถต่อห้อง (${parkingRateVal} บาท/ห้อง)`;
    } else if (parkingMode === 'per_vehicle') {
      parkingBadge = 'บาท/คัน';
      parkingSubtitle = `ค่าบริการที่จอดรถตามจำนวนยานพาหนะ (${parkingRateVal} บาท/คัน)`;
      parkingRateStr = `${parkingRateVal} บาท`;
      parkingUnit = 'ต่อคัน / เดือน';
      parkingExcelDesc = `ค่าบริการที่จอดรถตามคัน (${parkingRateVal} บาท/คัน)`;
    } else if (parkingMode === 'per_person') {
      parkingBadge = 'บาท/คน';
      parkingSubtitle = `ค่าบริการที่จอดรถตามจำนวนคน (${parkingRateVal} บาท/คน)`;
      parkingRateStr = `${parkingRateVal} บาท/คน`;
      parkingUnit = 'ต่อคน / เดือน';
      parkingExcelDesc = `ค่าบริการที่จอดรถตามคน (${parkingRateVal} บาท/คน)`;
    } else if (parkingMode === 'free') {
      parkingBadge = 'ไม่คิดค่าบริการ';
      parkingBadgeClass = 'bg-emerald-50 text-emerald-600 border-emerald-100';
      parkingSubtitle = 'ไม่คิดค่าบริการที่จอดรถในงวดนี้';
      parkingRateStr = 'ฟรี';
      parkingUnit = 'ไม่คิดค่าบริการ';
      parkingExcelDesc = 'ฟรีค่าที่จอดรถ';
    }

    // Provenance
    const isCustomOverride = activeSnapshot?.source === 'MANUAL_OVERRIDE';
    const snapshotProvenanceText = isCustomOverride ? 'อัตราเฉพาะรอบบิล' : 'อัตรามาตรฐานหอพัก';

    return {
      water: {
        type: waterType,
        rate: waterRateVal,
        badge: waterBadge,
        badgeClass: waterBadgeClass,
        subtitle: waterSubtitle,
        rateStr: waterRateStr,
        unit: waterUnit,
        excelDesc: waterExcelDesc,
      },
      electric: {
        type: elecType,
        rate: elecRateVal,
        badge: elecBadge,
        badgeClass: elecBadgeClass,
        subtitle: elecSubtitle,
        rateStr: elecRateStr,
        unit: elecUnit,
        excelDesc: elecExcelDesc,
      },
      common: {
        mode: commonMode,
        rate: commonRateVal,
        badge: commonBadge,
        badgeClass: commonBadgeClass,
        subtitle: commonSubtitle,
        rateStr: commonRateStr,
        unit: commonUnit,
        excelDesc: commonExcelDesc,
      },
      internet: {
        mode: internetMode,
        rate: internetRateVal,
        badge: internetBadge,
        badgeClass: internetBadgeClass,
        subtitle: internetSubtitle,
        rateStr: internetRateStr,
        unit: internetUnit,
        excelDesc: internetExcelDesc,
      },
      parking: {
        mode: parkingMode,
        rate: parkingRateVal,
        badge: parkingBadge,
        badgeClass: parkingBadgeClass,
        subtitle: parkingSubtitle,
        rateStr: parkingRateStr,
        unit: parkingUnit,
        excelDesc: parkingExcelDesc,
      },
      isCustomOverride,
      snapshotProvenanceText
    };
  }, [activeSnapshot, dormitory]);

  const {
    filteredRooms,
    filteredBills,
    currentMonthBills,
    paidBills,
    unpaidBills,
    totalRooms,
    occupiedCount,
    vacantCount,
    reservedCount,
    maintenanceCount,
    exactFixedRentTotal,
    exactWaterTotal,
    exactElectricTotal,
    exactCommonParkingTotal,
    exactCommonTotal,
    exactInternetTotal,
    exactParkingTotal,
    exactOtherServiceTotal,
    exactFineTotal,
    exactDiscountTotal,
    exactDepositTotal,
    exactDepositRefundTotal,
    exactTotalBilledThisMonth,
    exactTotalRevenueThisMonth,
    exactTotalUnpaidThisMonth,
    exactTotalOverdueAmount,
    exactTotalBilledPlusDeposit,
    exactYearBilledTotal,
    exactArpu,
    exactTotalRepairCostThisMonth,
    exactTotalRepairCostYear,
    exactNetIncomeThisMonth,
    fixedRentTotal,
    waterTotal,
    electricTotal,
    commonParkingTotal,
    commonTotal,
    internetTotal,
    parkingTotal,
    otherServiceTotal,
    fineTotal,
    discountTotal,
    depositTotal,
    depositRefundTotal,
    totalBilledThisMonth,
    totalRevenueThisMonth,
    totalUnpaidThisMonth,
    totalOverdueAmount,
    totalBilledPlusDeposit,
    totalRepairCostThisMonth,
    totalRepairCostYear,
    repairsCountThisMonth,
    repairsCountYear,
    paidPercent,
    unpaidPercent,
    occupiedPercent,
    vacantPercent,
    arpu,
    yearBilledTotal,
    paidBillsRooms,
    unpaidBillsRooms,
    monthlyRevenueHistory,
    breakdownPercentages,
  } = reportData;

  const currentVatSettings = useMemo(() => {
    return activeSnapshot?.vatSettings || dormitory?.billingSettings?.vatSettings || (dormitory as any)?.vatSettings || null;
  }, [activeSnapshot, dormitory]);

  const monthVatTotal = useMemo(() => {
    return (currentMonthBills || []).reduce((sum, b) => {
      if (b.vatAmount !== undefined && b.vatAmount !== null) {
        return sum + Number(b.vatAmount);
      }
      let itemVat = 0;
      (b.items || []).forEach((it: any) => {
        if (it.metadata?.vatAmount) itemVat += Number(it.metadata.vatAmount);
      });
      if (itemVat > 0) return sum + itemVat;

      if ((b.isVatActive || currentVatSettings?.enabled) && Array.isArray(b.items) && b.items.length > 0) {
        const vatCalc = calculateCategoryStrictVat(b.items, currentVatSettings || { enabled: true, rate: 7, appliedCategories: ['rent'] });
        if (vatCalc.isVatActive) {
          return sum + Number(vatCalc.vatAmount);
        }
      }
      return sum;
    }, 0);
  }, [currentMonthBills, currentVatSettings]);

  const {
    rentPct,
    elecPct,
    waterPct,
    commonParkingPct,
    commonPct: exactCommonPct,
    internetPct,
    parkingPct,
    otherPct,
    finePct,
    discountPct,
    depositPct,
  } = breakdownPercentages;
  const commonPct = commonParkingPct;

  const revenueHistory = monthlyRevenueHistory;

  const extractBillDetailsLocal = (b: any) => extractBillDetails(b, { rooms, buildings, tenants, vatSettings: currentVatSettings });

  // Export CSV Function (Mode: 'monthly-full' | 'monthly-raw' | 'monthly' | 'yearly')
  const handleExportCSVMode = (mode: 'monthly-full' | 'monthly-raw' | 'monthly' | 'yearly') => {
    setShowExportPopover(false);
    const bObj = buildingOptions.find(b => b.id === selectedBuilding);
    const bName = selectedBuilding === 'all'
      ? 'ทุกตึก'
      : (selectedBuilding === 'unspecified' ? 'ไม่ระบุอาคาร' : (bObj?.name || selectedBuilding));
    const currentMonthNum = effectiveCycleCode.split('-')[1] || '07';
    const monthLabel = `${monthNames[currentMonthNum]} ${parseInt(selectedYear) + 543}`;
    const yearLabel = `${parseInt(selectedYear) + 543}`;

    const dormName = dormitory?.name || 'หอพัก';
    const dormAddress = dormitory?.address || '-';
    const dormPhone = dormitory?.phone || '-';
    const dormTaxId = dormitory?.taxId || '';

    // Snapshot or settings rates summary
    const waterRateStr = rateMetadata.water.rateStr;
    const elecRateStr = rateMetadata.electric.rateStr;
    const commonRateStr = rateMetadata.common.rateStr;
    const internetRateStr = rateMetadata.internet.rateStr;
    const parkingRateStr = rateMetadata.parking.rateStr;

    let csv = '';
    let fileName = '';

    const billDetailsList = currentMonthBills.map(extractBillDetailsLocal).sort((a, b) => {
      if (a.buildingName !== b.buildingName) return a.buildingName.localeCompare(b.buildingName, 'th');
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (mode === 'monthly-raw') {
      // 1. Clean Raw Billing Grid only (Ready for Excel / Accounting Import)
      const grid = generateRawGridLines(billDetailsList);
      csv = `\uFEFF${grid.headerLine}\n${grid.dataRows.join('\n')}\n${grid.totalRow}\n`;
      fileName = `HorPlus_Billing_Raw_${effectiveCycleCode}_${selectedBuilding}.csv`;
    } else if (mode === 'yearly') {
      // 2. Yearly Comprehensive Report (Summary + 12-Month Table + Full-Year Raw Records)
      csv = `\uFEFF=== รายงานสรุปการเงินและสถิติหอพักประจำปี (${dormName} - ${bName}) ===\n`;
      csv += `ชื่อหอพัก: ${dormName}\n`;
      csv += `ที่อยู่: ${dormAddress}\n`;
      csv += `เบอร์โทรศัพท์: ${dormPhone}${dormTaxId ? ` | เลขประจำตัวผู้เสียภาษี: ${dormTaxId}` : ''}\n`;
      csv += `ประจำปี: พ.ศ. ${yearLabel} (ปี ค.ศ. ${selectedYear})\n`;
      csv += `พิมพ์เมื่อวันที่: ${new Date().toLocaleString('th-TH')}\n`;
      csv += `ขอบเขตข้อมูล: ${bName}\n\n`;

      csv += `--- ส่วนที่ 1: สรุปภาพรวมรายรับรายจ่ายทั้งปี (${selectedYear}) ---\n`;
      csv += `รายการ,จำนวนเงิน (บาท)\n`;
      csv += `"รวมยอดเรียกเก็บทั้งปี (Year Billed Total)",${exactYearBilledTotal}\n`;
      csv += `"รวมค่าใช้จ่ายงานซ่อมบำรุงทั้งปี",${exactTotalRepairCostYear}\n`;
      csv += `"จำนวนงานแจ้งซ่อมบำรุงทั้งปี",${repairsCountYear} รายการ\n\n`;

      csv += `--- ส่วนที่ 2: ตารางเปรียบเทียบผลการดำเนินงาน 12 เดือน (มกราคม - ธันวาคม) ---\n`;
      csv += `เดือน,ค่าเช่าห้อง (บาท),ค่าน้ำ (บาท),ค่าไฟฟ้า (บาท),ค่าส่วนกลาง (บาท),ค่าอินเทอร์เน็ต (บาท),ค่าที่จอดรถ (บาท),ค่าบริการอื่นๆ (บาท),ค่าปรับชำระเกินกำหนด (บาท),ส่วนลด (บาท),รวมยอดจัดเก็บ (บาท),ค่าใช้จ่ายซ่อมบำรุง (บาท),คืนเงินประกัน (บาท)\n`;

      let yrRent = 0n, yrWater = 0n, yrElec = 0n, yrCommon = 0n, yrInternet = 0n, yrParking = 0n, yrOther = 0n, yrFine = 0n, yrDiscount = 0n, yrTotal = 0n, yrRepair = 0n, yrRefund = 0n;
      monthlyRevenueHistory.forEach(r => {
        yrRent += toSatangs(r.exactRent);
        yrWater += toSatangs(r.exactWater);
        yrElec += toSatangs(r.exactElec);
        yrCommon += toSatangs(r.exactCommon || 0);
        yrInternet += toSatangs(r.exactInternet || 0);
        yrParking += toSatangs(r.exactParking || 0);
        yrOther += toSatangs(r.exactOther);
        yrFine += toSatangs(r.exactFine);
        yrDiscount += toSatangs(r.exactDiscount || 0);
        yrTotal += toSatangs(r.exactTotal);
        yrRepair += toSatangs(r.exactRepairCost || 0);
        yrRefund += toSatangs(r.exactDepositRefund || 0);

        csv += `"${r.fullName || r.name}",${r.exactRent},${r.exactWater},${r.exactElec},${r.exactCommon || '0.00'},${r.exactInternet || '0.00'},${r.exactParking || '0.00'},${r.exactOther},${r.exactFine},-${r.exactDiscount || '0.00'},${r.exactTotal},${r.exactRepairCost || '0.00'},${r.exactDepositRefund || '0.00'}\n`;
      });

      csv += `"รวมทั้งปี (${selectedYear})",${satangsToString(yrRent)},${satangsToString(yrWater)},${satangsToString(yrElec)},${satangsToString(yrCommon)},${satangsToString(yrInternet)},${satangsToString(yrParking)},${satangsToString(yrOther)},${satangsToString(yrFine)},-${satangsToString(yrDiscount)},${satangsToString(yrTotal)},${satangsToString(yrRepair)},${satangsToString(yrRefund)}\n\n`;

      // Year Bills Raw Data
      const yearBills = filteredBills.filter(b => {
        if (b.billingCycle?.cycleCode && b.billingCycle.cycleCode.startsWith(selectedYear)) return true;
        if (b.cycleId && b.cycleId.startsWith(selectedYear)) return true;
        if (b.cycleCode && b.cycleCode.startsWith(selectedYear)) return true;
        if (b.billingDate) {
          const dStr = typeof b.billingDate === 'string' ? b.billingDate : b.billingDate.toISOString?.();
          if (dStr && dStr.startsWith(selectedYear)) return true;
        }
        return false;
      });

      if (yearBills.length > 0) {
        const yearDetailsList = yearBills.map(extractBillDetailsLocal).sort((a, b) => {
          if (a.buildingName !== b.buildingName) return a.buildingName.localeCompare(b.buildingName, 'th');
          return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
        });
        const yGrid = generateRawGridLines(yearDetailsList);
        csv += `--- ส่วนที่ 3: ข้อมูลดิบรายการบิลตลอดทั้งปี (32 คอลัมน์) (${yearDetailsList.length} รายการ) ---\n`;
        csv += `${yGrid.headerLine}\n`;
        csv += `${yGrid.dataRows.join('\n')}\n`;
        csv += `${yGrid.totalRow}\n`;
      }

      fileName = `HorPlus_Report_Yearly_${selectedYear}_${selectedBuilding}.csv`;
    } else {
      // 3. Monthly Full Report (Summary Metadata + Occupancy + Financial Ledger + 30-Column Raw Grid)
      const grid = generateRawGridLines(billDetailsList);

      csv = `\uFEFF=== รายงานสรุปการเงินและสถิติหอพัก (${dormName} - ${bName}) ===\n`;
      csv += `ชื่อหอพัก: ${dormName}\n`;
      csv += `ที่อยู่: ${dormAddress}\n`;
      csv += `เบอร์โทรศัพท์: ${dormPhone}${dormTaxId ? ` | เลขประจำตัวผู้เสียภาษี: ${dormTaxId}` : ''}\n`;
      csv += `ประเภทรายงาน: ประจำเดือน ${monthLabel} (รอบบิล ${effectiveCycleCode})\n`;
      csv += `เงื่อนไขอัตราค่าบริการรอบบิล: น้ำ ${waterRateStr} | ไฟ ${elecRateStr} | ส่วนกลาง ${commonRateStr} | อินเทอร์เน็ต ${internetRateStr} | ที่จอดรถ ${parkingRateStr}\n`;
      csv += `พิมพ์เมื่อวันที่: ${new Date().toLocaleString('th-TH')}\n`;
      csv += `ขอบเขตข้อมูล: ${bName}\n\n`;

      csv += `--- ส่วนที่ 1: สรุปภาพรวมสถิติและอัตราครองห้อง ---\n`;
      csv += `รายการสถิติ,ข้อมูล,หน่วย\n`;
      csv += `"จำนวนห้องพักทั้งหมด",${totalRooms},"ห้อง"\n`;
      csv += `"ห้องพักที่มีผู้เช่า (Occupied)",${occupiedCount},"ห้อง (${occupiedPercent}%)"\n`;
      csv += `"ห้องว่าง (Vacant)",${vacantCount},"ห้อง (${vacantPercent}%)"\n`;
      csv += `"ห้องพักรอทำสัญญา / จอง",${reservedCount},"ห้อง"\n`;
      csv += `"ห้องพักปิดซ่อมบำรุง",${maintenanceCount},"ห้อง"\n`;
      csv += `"อัตราการจัดเก็บค่าเช่า (ชำระแล้ว)",${paidBillsRooms.length},"ห้อง (${paidPercent}% ของยอดเรียกเก็บ)"\n`;
      csv += `"บิลค้างชำระ / รอชำระ",${unpaidBillsRooms.length},"ห้อง (${unpaidPercent}% ของยอดเรียกเก็บ)"\n`;
      csv += `"ยอดค้างชำระเกินกำหนด (Overdue)",${exactTotalOverdueAmount},"บาท"\n`;
      csv += `"รายได้เฉลี่ยต่อห้องที่เช่า (ARPU)",${exactArpu},"บาท/ห้อง"\n\n`;

      csv += `--- ส่วนที่ 2: สรุปบัญชีรายรับและรายจ่ายประจำเดือน ---\n`;
      csv += `หมวดหมู่รายรับ/รายจ่าย,จำนวนเงิน (บาท),สัดส่วน (%)\n`;
      csv += `"1. ค่าเช่าห้องพัก",${exactFixedRentTotal},${rentPct}%\n`;
      csv += `"2. ค่าไฟฟ้า",${exactElectricTotal},${elecPct}%\n`;
      csv += `"3. ค่าน้ำประปา",${exactWaterTotal},${waterPct}%\n`;
      csv += `"4. ค่าส่วนกลาง (Common Fee)",${exactCommonTotal},${exactCommonPct}%\n`;
      csv += `"5. ค่าอินเทอร์เน็ต (Internet Fee)",${exactInternetTotal},${internetPct}%\n`;
      csv += `"6. ค่าที่จอดรถ (Parking Fee)",${exactParkingTotal},${parkingPct}%\n`;
      csv += `"7. ค่าบริการอื่นๆ (Other Service Fees)",${exactOtherServiceTotal},${otherPct}%\n`;
      csv += `"8. ค่าปรับชำระเกินกำหนด (Late Fines)",${exactFineTotal},${finePct}%\n`;
      csv += `"9. ส่วนลด (Discounts)",-${exactDiscountTotal},${discountPct}%\n`;
      csv += `"10. เงินประกัน / มัดจำสัญญา",${exactDepositTotal},${depositPct}%\n`;
      if (depositRefundTotal > 0) {
        csv += `"11. คืนเงินประกันสัญญาผู้เช่า",-${exactDepositRefundTotal},-\n`;
      }
      if (monthVatTotal > 0) {
        csv += `"ภาษีมูลค่าเพิ่ม 7% (ภ.พ.30)",${monthVatTotal.toFixed(2)},-\n`;
      }
      csv += `"รวมยอดเรียกเก็บตามบิล (Total Billed)",${exactTotalBilledThisMonth},100.0%\n`;
      csv += `"รวมรายรับจัดเก็บสะสมทั้งหมด",${exactTotalBilledPlusDeposit},-\n`;
      csv += `"รายรับที่ชำระจริงในรอบเดือน",${exactTotalRevenueThisMonth},-\n`;
      csv += `"ยอดค้างชำระคงเหลือรอบเดือน",${exactTotalUnpaidThisMonth},-\n`;
      csv += `"ค่าใช้จ่ายงานแจ้งซ่อมบำรุง",${exactTotalRepairCostThisMonth},-\n`;
      csv += `"กำไรสุทธิประจำรอบเดือน (Net Cashflow)",${exactNetIncomeThisMonth},-\n\n`;

      csv += `--- ส่วนที่ 3: ตารางข้อมูลดิบรายห้องพักและรายการบิลโดยละเอียด (32 คอลัมน์) (${billDetailsList.length} ห้อง) ---\n`;
      csv += `${grid.headerLine}\n`;
      csv += `${grid.dataRows.join('\n')}\n`;
      csv += `${grid.totalRow}\n`;

      fileName = `HorPlus_Report_Full_${effectiveCycleCode}_${selectedBuilding}.csv`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');
    link.download = safeFileName;
    link.setAttribute('download', safeFileName);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setToastMessage(`ส่งออกไฟล์ "${safeFileName}" เรียบร้อยแล้ว`);
    setTimeout(() => {
      try {
        if (typeof document !== 'undefined' && document.body?.contains(link)) {
          document.body.removeChild(link);
        }
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(url);
        }
      } catch {
        // Safe cleanup ignore
      }
    }, 1000);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Export Excel Function (Mode: 'monthly-full' | 'monthly-raw' | 'yearly')
  const handleExportExcelMode = async (mode: 'monthly-full' | 'monthly-raw' | 'yearly') => {
    setShowExportPopover(false);
    const bObj = buildingOptions.find(b => b.id === selectedBuilding);
    const bName = selectedBuilding === 'all'
      ? 'ทุกตึก'
      : (selectedBuilding === 'unspecified' ? 'ไม่ระบุอาคาร' : (bObj?.name || selectedBuilding));
    const currentMonthNum = effectiveCycleCode.split('-')[1] || '07';
    const monthLabel = `${monthNames[currentMonthNum]} ${parseInt(selectedYear) + 543}`;
    const yearLabel = `${parseInt(selectedYear) + 543}`;

    const dormName = dormitory?.name || 'หอพัก';
    const dormAddress = dormitory?.address || '-';
    const dormPhone = dormitory?.phone || '-';
    const dormTaxId = dormitory?.taxId || '';

    const waterRateStr = rateMetadata.water.rateStr;
    const elecRateStr = rateMetadata.electric.rateStr;
    const commonRateStr = rateMetadata.common.rateStr;
    const internetRateStr = rateMetadata.internet.rateStr;
    const parkingRateStr = rateMetadata.parking.rateStr;

    const billDetailsList = currentMonthBills.map(extractBillDetailsLocal).sort((a, b) => {
      if (a.buildingName !== b.buildingName) return a.buildingName.localeCompare(b.buildingName, 'th');
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'HorPlus Dormitory Management';
    wb.created = new Date();




    let fileName = '';
    let exportBills = currentMonthBills;

    if (mode === 'monthly-raw') {
      const ws = wb.addWorksheet('ตารางบิลรายห้อง 32 คอลัมน์');
      build30ColWorksheet(ws, billDetailsList);
      fileName = `HorPlus_Billing_Raw_${effectiveCycleCode}_${selectedBuilding}.xlsx`;
    } else if (mode === 'yearly') {
      const wsSummary = wb.addWorksheet('สรุปผลการดำเนินงาน 12 เดือน');
      wsSummary.views = [{ showGridLines: true }];

      wsSummary.columns = [
        { width: 4 },  // Margin
        { width: 22 }, // Month
        { width: 16 }, // Rent
        { width: 14 }, // Water
        { width: 14 }, // Elec
        { width: 14 }, // Common
        { width: 14 }, // Net
        { width: 14 }, // Parking
        { width: 16 }, // Other
        { width: 14 }, // Fine
        { width: 14 }, // Discount
        { width: 20 }, // Total Billed
        { width: 16 }, // Repair
        { width: 16 }  // Deposit Refund
      ];

      wsSummary.mergeCells('B2:N2');
      const titleCell = wsSummary.getCell('B2');
      titleCell.value = `รายงานสรุปผลการดำเนินงานประจำปี พ.ศ. ${yearLabel} (ปี ค.ศ. ${selectedYear}) - ${dormName} (${bName})`;
      titleCell.font = { name: 'Sarabun', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      wsSummary.getRow(2).height = 34;

      wsSummary.mergeCells('B3:N3');
      const metaCell = wsSummary.getCell('B3');
      metaCell.value = `ที่อยู่: ${dormAddress} | เบอร์โทรศัพท์: ${dormPhone}${dormTaxId ? ` | Tax ID: ${dormTaxId}` : ''} | พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}`;
      metaCell.font = { name: 'Sarabun', size: 9, italic: true, color: { argb: 'FF64748B' } };
      metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
      wsSummary.getRow(3).height = 20;

      const kpis = [
        { label: 'รวมยอดเรียกเก็บทั้งปี', val: Number(exactYearBilledTotal), color: 'FF1D4ED8' },
        { label: 'รวมค่าใช้จ่ายซ่อมบำรุงทั้งปี', val: Number(exactTotalRepairCostYear), color: 'FFDC2626' },
        { label: 'จำนวนงานแจ้งซ่อมทั้งปี', val: `${repairsCountYear} รายการ`, color: 'FF475569' }
      ];

      wsSummary.getRow(5).height = 18;
      wsSummary.mergeCells('B5:D5');
      wsSummary.getCell('B5').value = kpis[0].label;
      wsSummary.getCell('B5').font = { name: 'Sarabun', size: 9, bold: true, color: { argb: 'FF475569' } };
      wsSummary.getCell('B5').alignment = { horizontal: 'center' };

      wsSummary.mergeCells('F5:H5');
      wsSummary.getCell('F5').value = kpis[1].label;
      wsSummary.getCell('F5').font = { name: 'Sarabun', size: 9, bold: true, color: { argb: 'FF475569' } };
      wsSummary.getCell('F5').alignment = { horizontal: 'center' };

      wsSummary.mergeCells('J5:L5');
      wsSummary.getCell('J5').value = kpis[2].label;
      wsSummary.getCell('J5').font = { name: 'Sarabun', size: 9, bold: true, color: { argb: 'FF475569' } };
      wsSummary.getCell('J5').alignment = { horizontal: 'center' };

      wsSummary.getRow(6).height = 26;
      wsSummary.mergeCells('B6:D6');
      wsSummary.getCell('B6').value = kpis[0].val;
      wsSummary.getCell('B6').font = { name: 'Sarabun', size: 13, bold: true, color: { argb: kpis[0].color } };
      wsSummary.getCell('B6').alignment = { horizontal: 'center' };
      wsSummary.getCell('B6').numFmt = '฿ #,##0.00';

      wsSummary.mergeCells('F6:H6');
      wsSummary.getCell('F6').value = kpis[1].val;
      wsSummary.getCell('F6').font = { name: 'Sarabun', size: 13, bold: true, color: { argb: kpis[1].color } };
      wsSummary.getCell('F6').alignment = { horizontal: 'center' };
      wsSummary.getCell('F6').numFmt = '฿ #,##0.00';

      wsSummary.mergeCells('J6:L6');
      wsSummary.getCell('J6').value = kpis[2].val;
      wsSummary.getCell('J6').font = { name: 'Sarabun', size: 13, bold: true, color: { argb: kpis[2].color } };
      wsSummary.getCell('J6').alignment = { horizontal: 'center' };

      const yHeaders = [
        'เดือน', 'ค่าเช่าห้อง (บาท)', 'ค่าน้ำ (บาท)', 'ค่าไฟฟ้า (บาท)', 'ค่าส่วนกลาง (บาท)',
        'ค่าเน็ต (บาท)', 'ค่าที่จอดรถ (บาท)', 'ค่าบริการอื่นๆ (บาท)', 'ค่าปรับ (บาท)',
        'ส่วนลด (บาท)', 'รวมยอดจัดเก็บ (บาท)', 'ค่าซ่อมบำรุง (บาท)', 'คืนเงินประกัน (บาท)'
      ];
      const yHeaderRow = wsSummary.getRow(8);
      yHeaderRow.height = 26;
      yHeaders.forEach((h, i) => {
        const c = yHeaderRow.getCell(i + 2);
        c.value = h;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        c.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'medium', color: { argb: 'FF0F172A' } }
        };
      });

      let yrRent = 0n, yrWater = 0n, yrElec = 0n, yrCommon = 0n, yrInternet = 0n, yrParking = 0n, yrOther = 0n, yrFine = 0n, yrDiscount = 0n, yrTotal = 0n, yrRepair = 0n, yrRefund = 0n;

      monthlyRevenueHistory.forEach((r, idx) => {
        const rowIdx = 9 + idx;
        const row = wsSummary.getRow(rowIdx);
        row.height = 22;
        const isEven = idx % 2 === 0;
        const bg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

        yrRent += toSatangs(r.exactRent);
        yrWater += toSatangs(r.exactWater);
        yrElec += toSatangs(r.exactElec);
        yrCommon += toSatangs(r.exactCommon || 0);
        yrInternet += toSatangs(r.exactInternet || 0);
        yrParking += toSatangs(r.exactParking || 0);
        yrOther += toSatangs(r.exactOther);
        yrFine += toSatangs(r.exactFine);
        yrDiscount += toSatangs(r.exactDiscount || 0);
        yrTotal += toSatangs(r.exactTotal);
        yrRepair += toSatangs(r.exactRepairCost || 0);
        yrRefund += toSatangs(r.exactDepositRefund || 0);

        const rowValues = [
          r.fullName || r.name,
          Number(r.exactRent || 0),
          Number(r.exactWater || 0),
          Number(r.exactElec || 0),
          Number(r.exactCommon || 0),
          Number(r.exactInternet || 0),
          Number(r.exactParking || 0),
          Number(r.exactOther || 0),
          Number(r.exactFine || 0),
          Number(r.exactDiscount || 0) > 0 ? -Number(r.exactDiscount) : 0,
          Number(r.exactTotal || 0),
          Number(r.exactRepairCost || 0),
          Number(r.exactDepositRefund || 0)
        ];

        rowValues.forEach((val, i) => {
          const c = row.getCell(i + 2);
          c.value = val;
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          c.font = { name: 'Sarabun', size: 9, color: { argb: 'FF1E293B' } };
          c.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };

          if (i === 0) {
            c.alignment = { vertical: 'middle', horizontal: 'left' };
            c.font = { name: 'Sarabun', size: 9, bold: true };
          } else {
            c.alignment = { vertical: 'middle', horizontal: 'right' };
            c.numFmt = '#,##0.00';
            if (i === 10) {
              c.font = { name: 'Sarabun', size: 9, bold: true, color: { argb: 'FF1D4ED8' } };
            }
          }
        });
      });

      const yrTotalRow = wsSummary.getRow(9 + monthlyRevenueHistory.length);
      yrTotalRow.height = 26;
      const yrTotalStart = 9;
      const yrTotalEnd = 8 + monthlyRevenueHistory.length;
      const hasMonthlyData = monthlyRevenueHistory.length > 0;

      const yrTotals: any[] = [
        `รวมทั้งปี (${selectedYear})`,
        hasMonthlyData ? { formula: `SUM(C${yrTotalStart}:C${yrTotalEnd})`, result: Number(satangsToString(yrRent)) } : 0,
        hasMonthlyData ? { formula: `SUM(D${yrTotalStart}:D${yrTotalEnd})`, result: Number(satangsToString(yrWater)) } : 0,
        hasMonthlyData ? { formula: `SUM(E${yrTotalStart}:E${yrTotalEnd})`, result: Number(satangsToString(yrElec)) } : 0,
        hasMonthlyData ? { formula: `SUM(F${yrTotalStart}:F${yrTotalEnd})`, result: Number(satangsToString(yrCommon)) } : 0,
        hasMonthlyData ? { formula: `SUM(G${yrTotalStart}:G${yrTotalEnd})`, result: Number(satangsToString(yrInternet)) } : 0,
        hasMonthlyData ? { formula: `SUM(H${yrTotalStart}:H${yrTotalEnd})`, result: Number(satangsToString(yrParking)) } : 0,
        hasMonthlyData ? { formula: `SUM(I${yrTotalStart}:I${yrTotalEnd})`, result: Number(satangsToString(yrOther)) } : 0,
        hasMonthlyData ? { formula: `SUM(J${yrTotalStart}:J${yrTotalEnd})`, result: Number(satangsToString(yrFine)) } : 0,
        hasMonthlyData ? { formula: `SUM(K${yrTotalStart}:K${yrTotalEnd})`, result: Number(satangsToString(yrDiscount)) > 0 ? -Number(satangsToString(yrDiscount)) : 0 } : 0,
        hasMonthlyData ? { formula: `SUM(L${yrTotalStart}:L${yrTotalEnd})`, result: Number(satangsToString(yrTotal)) } : 0,
        hasMonthlyData ? { formula: `SUM(M${yrTotalStart}:M${yrTotalEnd})`, result: Number(satangsToString(yrRepair)) } : 0,
        hasMonthlyData ? { formula: `SUM(N${yrTotalStart}:N${yrTotalEnd})`, result: Number(satangsToString(yrRefund)) } : 0
      ];

      yrTotals.forEach((val, i) => {
        const c = yrTotalRow.getCell(i + 2);
        c.value = val;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        c.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF0F172A' } };
        c.border = {
          top: { style: 'thin', color: { argb: 'FF64748B' } },
          bottom: { style: 'double', color: { argb: 'FF0F172A' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        if (i === 0) {
          c.alignment = { vertical: 'middle', horizontal: 'left' };
        } else {
          c.alignment = { vertical: 'middle', horizontal: 'right' };
          c.numFmt = '#,##0.00';
          if (i === 10) {
            c.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
          }
        }
      });

      const yearBills = filteredBills.filter(b => {
        if (b.billingCycle?.cycleCode && b.billingCycle.cycleCode.startsWith(selectedYear)) return true;
        if (b.cycleId && b.cycleId.startsWith(selectedYear)) return true;
        if (b.cycleCode && b.cycleCode.startsWith(selectedYear)) return true;
        if (b.billingDate) {
          const dStr = typeof b.billingDate === 'string' ? b.billingDate : b.billingDate.toISOString?.();
          if (dStr && dStr.startsWith(selectedYear)) return true;
        }
        return false;
      });
      exportBills = yearBills;

      if (yearBills.length > 0) {
        const yearDetailsList = yearBills.map(extractBillDetailsLocal).sort((a, b) => {
          if (a.buildingName !== b.buildingName) return a.buildingName.localeCompare(b.buildingName, 'th');
          return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
        });
        const wsBills = wb.addWorksheet('ข้อมูลบิลทั้งปี 32 คอลัมน์');
        build30ColWorksheet(wsBills, yearDetailsList);
      }

      fileName = `HorPlus_Report_Yearly_${selectedYear}_${selectedBuilding}.xlsx`;
    } else {
      // mode === 'monthly-full'
      const wsSummary = wb.addWorksheet('สรุปภาพรวมการเงิน');
      wsSummary.views = [{ showGridLines: true }];

      wsSummary.columns = [
        { width: 4 },  // Margin
        { width: 38 }, // Title / Item Name
        { width: 22 }, // Value (Amount or Count)
        { width: 20 }, // Unit / Proportion %
        { width: 32 }  // Remark / Note
      ];

      wsSummary.mergeCells('B2:E2');
      const titleCell = wsSummary.getCell('B2');
      titleCell.value = `รายงานสรุปการเงินและสถิติหอพัก - ${dormName} (${bName})`;
      titleCell.font = { name: 'Sarabun', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      wsSummary.getRow(2).height = 36;

      wsSummary.mergeCells('B3:E3');
      const subCell = wsSummary.getCell('B3');
      subCell.value = `ประจำเดือน: ${monthLabel} (รอบบิล ${effectiveCycleCode}) | ขอบเขต: ${bName} | พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}`;
      subCell.font = { name: 'Sarabun', size: 9, italic: true, color: { argb: 'FF64748B' } };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      subCell.alignment = { vertical: 'middle', horizontal: 'center' };
      wsSummary.getRow(3).height = 22;

      wsSummary.mergeCells('B5:E5');
      const rateHeader = wsSummary.getCell('B5');
      rateHeader.value = 'เงื่อนไขอัตราค่าบริการรอบบิล (Billing Rates Snapshot)';
      rateHeader.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      rateHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
      rateHeader.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      wsSummary.getRow(5).height = 24;

      const rateRows = [
        ['ค่าน้ำประปา', rateMetadata.water.rateStr, rateMetadata.water.unit, ''],
        ['ค่าไฟฟ้า', rateMetadata.electric.rateStr, rateMetadata.electric.unit, ''],
        ['ค่าส่วนกลาง', rateMetadata.common.rateStr, rateMetadata.common.unit, ''],
        ['ค่าอินเทอร์เน็ต', rateMetadata.internet.rateStr, rateMetadata.internet.unit, ''],
        ['ค่าที่จอดรถ', rateMetadata.parking.rateStr, rateMetadata.parking.unit, '']
      ];

      rateRows.forEach((r, idx) => {
        const row = wsSummary.getRow(6 + idx);
        row.height = 22;
        const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
        r.forEach((val, i) => {
          const c = row.getCell(i + 2);
          c.value = val;
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          c.font = { name: 'Sarabun', size: 9, color: { argb: 'FF1E293B' } };
          c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
          c.alignment = { vertical: 'middle', horizontal: i === 1 ? 'right' : 'left' };
        });
      });

      const statStartRow = 12;
      wsSummary.mergeCells(`B${statStartRow}:E${statStartRow}`);
      const statHeader = wsSummary.getCell(`B${statStartRow}`);
      statHeader.value = 'สรุปภาพรวมสถิติและอัตราครองห้อง (Occupancy & Collection Stats)';
      statHeader.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      statHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      statHeader.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      wsSummary.getRow(statStartRow).height = 24;

      const statRows = [
        ['จำนวนห้องพักทั้งหมด', totalRooms, 'ห้อง', ''],
        ['ห้องพักที่มีผู้เช่า (Occupied)', occupiedCount, `${occupiedPercent}% ของทั้งหมด`, `${occupiedCount} ห้อง`],
        ['ห้องว่าง (Vacant)', vacantCount, `${vacantPercent}% ของทั้งหมด`, `${vacantCount} ห้อง`],
        ['ห้องพักรอทำสัญญา / จอง', reservedCount, 'ห้อง', ''],
        ['ห้องพักปิดซ่อมบำรุง', maintenanceCount, 'ห้อง', ''],
        ['อัตราการจัดเก็บค่าเช่า (ชำระแล้ว)', paidBillsRooms.length, `${paidPercent}% ของยอดเรียกเก็บ`, 'ชำระครบถ้วน'],
        ['บิลค้างชำระ / รอชำระ', unpaidBillsRooms.length, `${unpaidPercent}% ของยอดเรียกเก็บ`, 'รอการชำระ'],
        ['ยอดค้างชำระเกินกำหนด (Overdue)', Number(exactTotalOverdueAmount), 'บาท', 'เกินวันครบกำหนด'],
        ['รายได้เฉลี่ยต่อห้องที่เช่า (ARPU)', Number(exactArpu), 'บาท/ห้อง', 'คำนวณจากห้องที่มีผู้เช่า']
      ];

      statRows.forEach((r, idx) => {
        const row = wsSummary.getRow(statStartRow + 1 + idx);
        row.height = 22;
        const bg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC';
        r.forEach((val, i) => {
          const c = row.getCell(i + 2);
          c.value = val;
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          c.font = { name: 'Sarabun', size: 9, color: { argb: 'FF1E293B' } };
          c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
          if (i === 1) {
            c.alignment = { vertical: 'middle', horizontal: 'right' };
            if (typeof val === 'number') {
              c.numFmt = val > 1000 ? '#,##0.00' : '#,##0';
            }
          } else {
            c.alignment = { vertical: 'middle', horizontal: 'left' };
          }
        });
      });

      const finStartRow = statStartRow + statRows.length + 2;
      wsSummary.mergeCells(`B${finStartRow}:E${finStartRow}`);
      const finHeader = wsSummary.getCell(`B${finStartRow}`);
      finHeader.value = 'สรุปบัญชีรายรับและรายจ่ายประจำเดือน (Monthly Financial Ledger Statement)';
      finHeader.font = { name: 'Sarabun', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      finHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
      finHeader.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      wsSummary.getRow(finStartRow).height = 24;

      const ledgerRows: [string, number, string, string, boolean, string?][] = [
        ['1. ค่าเช่าห้องพัก', Number(exactFixedRentTotal), `${rentPct}%`, 'ค่าเช่าห้องตามสัญญา', false],
        ['2. ค่าไฟฟ้า', Number(exactElectricTotal), `${elecPct}%`, rateMetadata.electric.excelDesc, false],
        ['3. ค่าน้ำประปา', Number(exactWaterTotal), `${waterPct}%`, rateMetadata.water.excelDesc, false],
        ['4. ค่าบริการส่วนกลาง (Common Fee)', Number(exactCommonTotal), `${exactCommonPct}%`, rateMetadata.common.excelDesc, false],
        ['5. ค่าบริการอินเทอร์เน็ต (Internet Fee)', Number(exactInternetTotal), `${internetPct}%`, rateMetadata.internet.excelDesc, false],
        ['6. ค่าที่จอดรถ (Parking Fee)', Number(exactParkingTotal), `${parkingPct}%`, rateMetadata.parking.excelDesc, false],
        ['7. ค่าบริการอื่นๆ (Other Service Fees)', Number(exactOtherServiceTotal), `${otherPct}%`, 'ค่าบริการเสริม / ทำความสะอาด', false],
        ['8. ค่าปรับชำระเกินกำหนด (Late Fines)', Number(exactFineTotal), `${finePct}%`, 'ค่าปรับเกินวันดิวเดท', false],
        ['9. ส่วนลดโปรโมชั่น (Discounts)', -Number(exactDiscountTotal), `${discountPct}%`, 'รายการหักลดพิเศษ', false],
        ['10. เงินประกัน / มัดจำสัญญา', Number(exactDepositTotal), `${depositPct}%`, 'เงินประกันแรกเข้าทำสัญญา', false]
      ];

      if (depositRefundTotal > 0) {
        ledgerRows.push(['11. คืนเงินประกันสัญญาผู้เช่า', -Number(exactDepositRefundTotal), '-', 'จ่ายคืนเงินประกันเมื่อเลิกเช่า', false]);
      }

      if (monthVatTotal > 0) {
        ledgerRows.push(['ภาษีมูลค่าเพิ่ม 7% (ภ.พ.30)', monthVatTotal, '-', 'ภาษีขายตามหมวดที่เปิดใช้งาน VAT', false, 'FFD97706']);
      }
      ledgerRows.push(['รวมยอดเรียกเก็บตามบิล (Total Billed)', Number(exactTotalBilledThisMonth), '100.0%', 'ยอดรวมบิลประจำรอบเดือน', true, 'FF1D4ED8']);
      ledgerRows.push(['รวมรายรับจัดเก็บสะสมทั้งหมด', Number(exactTotalBilledPlusDeposit), '-', 'รวมบิล + เงินประกัน', true, 'FF1E40AF']);
      ledgerRows.push(['รายรับที่ชำระจริงในรอบเดือน', Number(exactTotalRevenueThisMonth), '-', 'ยอดรับชำระแล้ว', true, 'FF047857']);
      ledgerRows.push(['ยอดค้างชำระคงเหลือรอบเดือน', Number(exactTotalUnpaidThisMonth), '-', 'ยอดรอชำระคงเหลือ', true, 'FFB91C1C']);
      ledgerRows.push(['ค่าใช้จ่ายงานแจ้งซ่อมบำรุง', -Number(exactTotalRepairCostThisMonth), '-', 'ค่าใช้จ่ายซ่อมแซมห้องพัก', false]);
      ledgerRows.push(['กำไรสุทธิประจำรอบเดือน (Net Cashflow)', Number(exactNetIncomeThisMonth), '-', 'รายรับจริง - ค่าซ่อมบำรุง', true, 'FF1E3A8A']);

      ledgerRows.forEach((r, idx) => {
        const row = wsSummary.getRow(finStartRow + 1 + idx);
        row.height = r[4] ? 26 : 22;
        const bg = r[4] ? 'FFF1F5F9' : (idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC');

        const [itemLabel, itemVal, itemPct, itemDesc, isBold, color] = r;

        const cells = [
          { val: itemLabel, align: 'left', fmt: undefined },
          { val: itemVal, align: 'right', fmt: '#,##0.00' },
          { val: itemPct, align: 'center', fmt: undefined },
          { val: itemDesc, align: 'left', fmt: undefined }
        ];

        cells.forEach((cData, i) => {
          const c = row.getCell(i + 2);
          c.value = cData.val;
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          c.font = {
            name: 'Sarabun',
            size: 9,
            bold: isBold,
            color: { argb: color || (isBold ? 'FF0F172A' : 'FF1E293B') }
          };
          c.alignment = { vertical: 'middle', horizontal: cData.align as any };
          if (cData.fmt) c.numFmt = cData.fmt;
          c.border = {
            top: { style: isBold ? 'thin' : 'thin', color: { argb: isBold ? 'FF94A3B8' : 'FFE2E8F0' } },
            bottom: { style: isBold ? 'medium' : 'thin', color: { argb: isBold ? 'FF0F172A' : 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        });
      });

      const wsGrid = wb.addWorksheet('ตารางบิลรายห้อง 32 คอลัมน์');
      build30ColWorksheet(wsGrid, billDetailsList);

      fileName = `HorPlus_Report_Full_${effectiveCycleCode}_${selectedBuilding}.xlsx`;
    }

    const rawBuffer = await wb.xlsx.writeBuffer();
    let finalBlobPart: BlobPart = rawBuffer;

    // Post-process workbook XML with JSZip to inject default filter criteria (exclude 'ยกเลิก' by default)
    try {
      const zip = await JSZip.loadAsync(rawBuffer);
      const sheetFiles = Object.keys(zip.files).filter(name => name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml'));

      // Extract all active statuses (excluding 'ยกเลิก')
      const activeStatuses = Array.from(new Set(
        exportBills.map(b => {
          const sLower = (b.status || '').toLowerCase();
          const sMap: Record<string, string> = {
            paid: 'ชำระแล้ว',
            pending: 'ยังไม่ชำระ',
            unpaid: 'ยังไม่ชำระ',
            overdue: 'เกินกำหนด',
            partial: 'ชำระบางส่วน',
            cancelled: 'ยกเลิก'
          };
          return sMap[sLower] || b.status || 'ยังไม่ชำระ';
        })
      )).filter(s => s !== 'ยกเลิก');

      const filterStatusList = activeStatuses.length > 0
        ? activeStatuses
        : ['ชำระแล้ว', 'ยังไม่ชำระ', 'เกินกำหนด', 'ชำระบางส่วน'];

      const escapeXml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const filterTags = filterStatusList.map(s => `<filter val="${escapeXml(s)}"/>`).join('');
      const filterColXml = `<filterColumn colId="9"><filters blank="1">${filterTags}</filters></filterColumn>`;

      let modified = false;
      for (const sheetPath of sheetFiles) {
        let sheetXml = await zip.file(sheetPath)!.async('text');
        if (sheetXml.includes('<autoFilter ref="A1:')) {
          sheetXml = sheetXml.replace(/(<autoFilter ref="[^"]*")\/>/, `$1>${filterColXml}</autoFilter>`);
          zip.file(sheetPath, sheetXml);
          modified = true;
        }
      }

      if (modified) {
        finalBlobPart = await zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
      }
    } catch (zipErr) {
      console.warn('AutoFilter post-processing fallback:', zipErr);
    }

    const blob = finalBlobPart instanceof Blob
      ? finalBlobPart
      : new Blob([finalBlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');
    link.download = safeFileName;
    link.setAttribute('download', safeFileName);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setToastMessage(`ส่งออกไฟล์ Excel "${safeFileName}" เรียบร้อยแล้ว`);
    setTimeout(() => {
      try {
        if (typeof document !== 'undefined' && document.body?.contains(link)) {
          document.body.removeChild(link);
        }
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(url);
        }
      } catch {
        // Safe cleanup ignore
      }
    }, 1000);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const selectedCycleMonthNum = effectiveCycleCode.split('-')[1] || '07';
  const displayMonthTh = monthNames[selectedCycleMonthNum] || 'ก.ค.';
  const displayYearTh = (parseInt(effectiveCycleCode.split('-')[0] || selectedYear) + 543).toString();

  return (
    <div className="space-y-6">

      {/* HEADER CARD: 'วิเคราะห์การเงินและสถิติหอพัก' */}
      <div className="bg-white p-6 rounded-3xl border border-slate-100/80 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-start md:items-center relative">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-blue-50 text-[#2b64f6] rounded-2xl shadow-xs border border-blue-100 shrink-0">
            <BarChart4 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-black text-slate-800 leading-tight">วิเคราะห์การเงินและสถิติหอพัก</h3>
            </div>
            <p className="text-xs text-slate-400 font-medium mt-1 leading-none">
              สรุปรายงานผลการจัดเก็บของรอบบิล สถานะการจัดเก็บตามรอบบิล
            </p>
          </div>
        </div>

        {/* Requirements 3 & 5: EXACTLY 2 Controls (1. Dropdown 'หอพักรวมทุกอาคาร', 2. Button 'ส่งออก CSV') */}
        <div className="flex items-center gap-3 w-full md:w-auto mt-2 md:mt-0 relative">

          {/* 1. Dropdown: หอพักรวมทุกอาคาร */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-700 shadow-2xs">
            <BuildingIcon className="w-4 h-4 text-blue-600 shrink-0" />
            <select
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              className="bg-transparent focus:outline-none cursor-pointer font-extrabold text-slate-800"
            >
              <option value="all">หอพักรวมทุกอาคาร</option>
              {buildingOptions.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
              {hasUnspecifiedRooms && (
                <option value="unspecified">ไม่ระบุอาคาร</option>
              )}
            </select>
          </div>

          {/* 2. Button: ส่งออกรายงาน (.xlsx / .csv) with Popover */}
          <div className="relative">
            <button
              onClick={() => setShowExportPopover(prev => !prev)}
              className="px-4 py-2 bg-[#2b64f6] hover:bg-blue-700 text-white font-extrabold text-xs rounded-2xl flex items-center justify-center gap-2 shadow-xs hover:shadow-md transition-all cursor-pointer"
              title="ส่งออกข้อมูลรายเดือนหรือรายปีเป็นไฟล์ CSV หรือ Excel (.xlsx)"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
              <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-white/20 text-white">
                .xlsx / .csv
              </span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showExportPopover ? 'rotate-180' : ''}`} />
            </button>

            {/* Period & Format Selection Popover Card with Backdrop */}
            {showExportPopover && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowExportPopover(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-84 sm:w-96 bg-white border border-slate-200 p-4 rounded-2xl shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100">
                    <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                      <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                      <span>เลือกรูปแบบส่งออก CSV / Excel</span>
                    </span>
                    <button
                      onClick={() => setShowExportPopover(false)}
                      className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Format Selector Tabs: Excel (.xlsx) vs CSV (.csv) */}
                  <div className="flex rounded-xl bg-slate-100 p-1 mb-3">
                    <button
                      type="button"
                      onClick={() => setExportFormat('xlsx')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-black transition-all cursor-pointer ${exportFormat === 'xlsx'
                        ? 'bg-white text-emerald-700 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Excel (.xlsx)</span>
                      <span className="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-700 rounded-full font-black">
                        แนะนำ
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportFormat('csv')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-black transition-all cursor-pointer ${exportFormat === 'csv'
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-600" />
                      <span>CSV (.csv)</span>
                    </button>
                  </div>

                  {/* Options List for Selected Format */}
                  <div className="space-y-2">
                    {/* Option 1: Monthly Full Report */}
                    <button
                      onClick={() => exportFormat === 'xlsx' ? handleExportExcelMode('monthly-full') : handleExportCSVMode('monthly-full')}
                      className="w-full text-left p-3 rounded-xl hover:bg-blue-50/80 border border-slate-200/80 hover:border-blue-300 text-xs transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-extrabold text-slate-800 group-hover:text-blue-700 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          <span>รายงานประจำเดือนแบบสมบูรณ์</span>
                        </p>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${exportFormat === 'xlsx' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                          {exportFormat === 'xlsx' ? 'แนะนำ' : 'แนะนำ'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium mt-1">
                        {exportFormat === 'xlsx'
                          ? `สรุปสถิติ + บัญชีรายรับรายจ่าย + ข้อมูลดิบรายห้อง (งวด ${displayMonthTh} ${displayYearTh})`
                          : `สรุปสถิติ + บัญชีรายรับรายจ่าย + ข้อมูลดิบรายห้อง (งวด ${displayMonthTh} ${displayYearTh})`}
                      </p>
                    </button>

                    {/* Option 2: Clean Raw Grid */}
                    <button
                      onClick={() => exportFormat === 'xlsx' ? handleExportExcelMode('monthly-raw') : handleExportCSVMode('monthly-raw')}
                      className="w-full text-left p-3 rounded-xl hover:bg-emerald-50/80 border border-slate-200/80 hover:border-emerald-300 text-xs transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-extrabold text-slate-800 group-hover:text-emerald-700 flex items-center gap-1.5">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                          <span>ตารางข้อมูลดิบรายห้อง (Clean Grid)</span>
                        </p>
                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-md">
                          {exportFormat === 'xlsx' ? 'XLSX' : 'CSV'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium mt-1">
                        {exportFormat === 'xlsx'
                          ? 'ตารางข้อมูลบิลรายห้อง 32 คอลัมน์'
                          : 'ตารางข้อมูลบิลรายห้อง 32 คอลัมน์'}
                      </p>
                    </button>

                    {/* Option 3: Yearly Report */}
                    <button
                      onClick={() => exportFormat === 'xlsx' ? handleExportExcelMode('yearly') : handleExportCSVMode('yearly')}
                      className="w-full text-left p-3 rounded-xl hover:bg-indigo-50/80 border border-slate-200/80 hover:border-indigo-300 text-xs transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-extrabold text-slate-800 group-hover:text-indigo-700 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                          <span>รายงานสรุปประจำปี {displayYearTh}</span>
                        </p>
                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-md">
                          {exportFormat === 'xlsx' ? '12 เดือน' : '12 เดือน'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium mt-1">
                        {exportFormat === 'xlsx'
                          ? `สรุปการเงิน 12 เดือน (ม.ค. - ธ.ค.) พร้อมประวัติบิลรายปี ${displayYearTh}`
                          : `สรุปการเงิน 12 เดือน (ม.ค. - ธ.ค.) พร้อมประวัติบิลรายปี ${displayYearTh}`}
                      </p>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      {/* SECTION: SUMMARY METRICS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

        {/* 1. ยอดรวมจัดเก็บทั้งหมด (Main Collection Card) - 2/3 width */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden transition-all duration-300 min-h-[360px] flex flex-col justify-between">

          {/* Requirement 2: Overlay replacement inside card when clicking 'ชำระแล้ว' / 'ยังไม่ชำระ' */}
          <div className="space-y-4">
            <div className="absolute right-4 top-4 w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-lg">
              ฿
            </div>

            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-slate-400">ยอดรวมจัดเก็บทั้งหมด (รอบ {displayMonthTh} {displayYearTh})</p>
              {selectedBuilding !== 'all' && (
                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-black rounded-lg border border-blue-100">
                  {selectedBuilding === 'unspecified'
                    ? 'ไม่ระบุอาคาร'
                    : (buildingOptions.find(b => b.id === selectedBuilding)?.name || selectedBuilding)}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-col sm:flex-row sm:items-baseline gap-2">
              <span className="text-2xl xs:text-3xl sm:text-4xl font-black text-blue-600 tracking-tight whitespace-nowrap">
                {formatBaht(totalBilledThisMonth)}
              </span>
              {totalOverdueAmount > 0 && (
                <span className="text-xs font-bold text-rose-500 whitespace-nowrap">
                  (มียอดค้างชำระรวม {formatBaht(totalOverdueAmount)})
                </span>
              )}
            </div>

            {/* Separator */}
            <div className="my-4 border-t border-slate-100/80" />

            {/* สถานะรับชำระเงิน */}
            <div>
              <p className="text-xs font-bold text-slate-400 mb-3">สถานะการรับชำระเงินในรอบนี้</p>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="space-y-1 rounded-2xl p-3 border shadow-2xs min-w-0 bg-white border-slate-100">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                    <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />
                    <span className="truncate">ชำระแล้ว</span>
                  </div>
                  <p className="text-sm xs:text-base sm:text-lg font-black text-slate-800 whitespace-nowrap truncate">
                    {formatBaht(totalRevenueThisMonth)}
                  </p>
                  <p className="text-[10px] text-slate-400 font-semibold truncate">
                    {paidBills.length} ห้อง ({paidPercent}%)
                  </p>
                </div>

                <div className="space-y-1 rounded-2xl p-3 border shadow-2xs min-w-0 bg-white border-slate-100">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                    <span className="truncate">ยังไม่ชำระ</span>
                  </div>
                  <p className="text-sm xs:text-base sm:text-lg font-black text-slate-800 whitespace-nowrap truncate">
                    {formatBaht(totalUnpaidThisMonth)}
                  </p>
                  <p className="text-[10px] text-slate-400 font-semibold truncate">
                    {unpaidBills.length} ห้อง ({unpaidPercent}%)
                  </p>
                </div>
              </div>

              {/* Combined Progress Bar */}
              <div className="mt-4 w-full h-3 bg-rose-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-blue-600 h-full"
                  style={{ width: `${paidPercent}%` }}
                />
                <div
                  className="bg-rose-500 h-full"
                  style={{ width: `${unpaidPercent}%` }}
                />
              </div>
            </div>
          </div>

          {/* 6 Stat Cards in 2x3 grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            {[
              { label: `มูลค่าจัดเก็บรวมปี ${displayYearTh}`, val: formatBaht(yearBilledTotal), pct: `ประจำปี ${displayYearTh}`, sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'อัตราการครองห้องพัก', val: `${occupiedPercent}%`, pct: `เข้าพัก ${occupiedCount}/${totalRooms} ห้อง`, sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'ยอดค้างชำระสะสม', val: formatBaht(totalOverdueAmount), pct: 'ติดตามทวงถาม', sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'อัตราจัดเก็บชำระจริง', val: `${paidPercent}%`, pct: `รับแล้ว ${paidBills.length} บิล`, sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'รายได้เฉลี่ยต่อห้อง (ARPU)', val: formatBaht(arpu), pct: 'เฉลี่ยรายห้อง', sub: `คำนวณจาก ${occupiedCount} ห้องที่มีผู้เช่า` },
              { label: 'ยอดประกันถือครองรวม', val: formatBaht(depositTotal), pct: 'หลักประกันสัญญา', sub: 'อ้างอิงสัญญาเช่าที่มีผลบังคับใช้' },
              { label: 'ค่าใช้จ่ายแจ้งซ่อม (รอบนี้)', val: formatBaht(totalRepairCostThisMonth), pct: `${repairsCountThisMonth} งาน`, sub: `อ้างอิงรอบ ${displayMonthTh} ${displayYearTh}` },
              { label: `ค่าใช้จ่ายแจ้งซ่อมรวมปี ${displayYearTh}`, val: formatBaht(totalRepairCostYear), pct: `${repairsCountYear} งาน`, sub: `สรุปงานซ่อมสะสมปี ${displayYearTh}` }
            ].map((stat, i) => (
              <div key={i} className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between hover:border-slate-200 transition-all">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{stat.label}</span>
                <div className="flex items-baseline justify-between mt-2 gap-1">
                  <span className="text-base sm:text-lg lg:text-xl font-black text-slate-800 leading-none truncate">{stat.val}</span>
                  <span className="text-[10px] font-extrabold bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full text-slate-500 whitespace-nowrap shrink-0">{stat.pct}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-3 text-[9px] font-bold text-slate-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 stroke-[2.5] shrink-0" />
                  <span className="truncate">{stat.sub}</span>
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* 2. Occupancy & Category Split Stacked */}
        <div className="lg:col-span-1 space-y-6">

          {/* Occupancy Status Box */}
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800 mb-1">สถานะการใช้งานห้องพัก</h3>
              <p className="text-[10px] text-slate-400 font-medium">สถิติจำนวนห้องพักจำแนกตามสถานะ</p>
            </div>

            <div className="flex justify-center my-4">
              <div className="w-24 h-24 rounded-3xl bg-slate-50 flex flex-col items-center justify-center border border-slate-100 shadow-xs">
                <span className="text-2xl font-black text-slate-800">{totalRooms}</span>
                <span className="text-[10px] text-slate-400 font-bold block mt-0.5">ห้องทั้งหมด</span>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="flex justify-between items-center text-xs font-bold">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                  <span className="text-slate-500">มีผู้เช่าพัก ({occupiedCount} ห้อง)</span>
                </div>
                <span className="text-slate-800">{occupiedPercent}%</span>
              </div>

              <div className="flex justify-between items-center text-xs font-bold">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-slate-500">ว่างพร้อมเช่า ({vacantCount} ห้อง)</span>
                </div>
                <span className="text-slate-800">{vacantPercent}%</span>
              </div>

              <div className="flex justify-between items-center text-xs font-bold">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-slate-500">จอง/ปรับปรุง ({reservedCount + maintenanceCount} ห้อง)</span>
                </div>
                <span className="text-slate-800">
                  {totalRooms > 0 ? Math.round(((reservedCount + maintenanceCount) / totalRooms) * 100) : 0}%
                </span>
              </div>
            </div>
          </div>

          {/* REQUIREMENT 1: Monthly Expense Category Breakdown (Added 3 lines) */}
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-black text-slate-800">สัดส่วนค่าใช้จ่ายรายเดือน</h3>
                <p className="text-[10px] text-slate-400 font-medium">ภาพรวมยอดจัดเก็บจำแนกตามประเภท</p>
              </div>

              <button
                onClick={() => onNavigate?.('meters')}
                className="text-[9px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full font-bold transition-colors border border-blue-100 cursor-pointer"
              >
                ดูจดมิเตอร์
              </button>
            </div>

            <div className="space-y-3.5 pt-1">
              {/* 1. ค่าเช่าห้องพัก */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <HomeIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span>ค่าเช่าห้องพัก</span>
                  </div>
                  <span className="text-slate-800 font-black">
                    <CountUp value={fixedRentTotal} /> <span className="text-slate-400 font-semibold">({rentPct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${rentPct}%` }} />
                </div>
              </div>

              {/* 2. ค่าไฟฟ้า */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>ค่าไฟฟ้า</span>
                  </div>
                  <span className="text-slate-800 font-black">
                    <CountUp value={electricTotal} /> <span className="text-slate-400 font-semibold">({elecPct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${elecPct}%` }} />
                </div>
              </div>

              {/* 3. ค่าน้ำ */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Droplet className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                    <span>ค่าน้ำ</span>
                  </div>
                  <span className="text-slate-800 font-black">
                    <CountUp value={waterTotal} /> <span className="text-slate-400 font-semibold">({waterPct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: `${waterPct}%` }} />
                </div>
              </div>

              {/* 4. ส่วนกลาง / เน็ต / ที่จอด */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <GlobeIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>ส่วนกลาง / เน็ต / ที่จอด</span>
                  </div>
                  <span className="text-slate-800 font-black">
                    <CountUp value={commonParkingTotal} /> <span className="text-slate-400 font-semibold">({commonPct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${commonPct}%` }} />
                </div>
              </div>

              {/* Requirement 1.1: ค่าบริการอื่นๆ */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700 min-w-0">
                    <Wrench className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <span className="truncate" title="ค่าบริการอื่นๆ (ค่าใช้จ่ายอื่นๆ ในหน้าจดมิเตอร์)">ค่าบริการอื่นๆ</span>
                  </div>
                  <span className="text-slate-800 font-black shrink-0">
                    <CountUp value={otherServiceTotal} /> <span className="text-slate-400 font-semibold">({otherPct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-600 transition-all duration-300" style={{ width: `${otherPct}%` }} />
                </div>
              </div>

              {/* Requirement 1.2: ค่าปรับชำระเกินกำหนด */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>ค่าปรับชำระเกินกำหนด</span>
                  </div>
                  <span className="text-slate-800 font-black">
                    <CountUp value={fineTotal} /> <span className="text-slate-400 font-semibold">({finePct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 transition-all duration-300" style={{ width: `${finePct}%` }} />
                </div>
              </div>

              {/* Requirement 1.3: ค่าประกัน / มัดจำ */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700 min-w-0">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="truncate">ค่าประกัน / มัดจำ</span>
                  </div>
                  <span className="text-slate-800 font-black shrink-0">
                    <CountUp value={depositTotal} /> <span className="text-slate-400 font-semibold">({depositPct}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${depositPct}%` }} />
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Main Graph Chart & Financial Ledger Table Grid */}
      <div className="space-y-6">

        {/* Revenue Trends Chart (Full Width) */}
        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#2b64f6] shrink-0" />
                <span>สถิติมูลค่ารายรับรอบปี {displayYearTh} แยกตามรายเดือน</span>
              </h4>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                กราฟเปรียบเทียบแนวโน้มรายรับรวมทุกประเภทเทียบกับค่าเช่าห้องพัก (อ้างอิงปี {displayYearTh})
              </p>
            </div>
            <span className="text-[9px] font-bold bg-slate-50 border border-slate-100 text-slate-500 px-2.5 py-1 rounded-md uppercase tracking-wider self-start sm:self-auto">
              Line Chart
            </span>
          </div>

          <div className="h-64 sm:h-72 text-xs font-semibold">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2b64f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#2b64f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorRent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" tickFormatter={(val) => `${val / 1000}k`} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => formatBaht(Number(value))} contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #f1f5f9', fontWeight: 'bold' }} />
                <Legend iconType="circle" />
                <Area type="monotone" dataKey="total" name="รายรับรวมทุกประเภท" stroke="#2b64f6" fillOpacity={1} fill="url(#colorTotal)" strokeWidth={2.5} />
                <Area type="monotone" dataKey="rent" name="เฉพาะค่าเช่าห้อง" stroke="#10b981" fillOpacity={1} fill="url(#colorRent)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* REQUIREMENT 6: Financial Ledger Statement Table with ALL income categories */}
        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h4 className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>รายงานสรุปผลประกอบการการเงิน</span>
              </h4>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-none font-medium">
                บันทึกยอดสะสมจัดเก็บจำแนกประเภทบัญชี ประจำงวด {displayMonthTh} {displayYearTh}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto text-[11px] font-bold leading-relaxed no-scrollbar">
            <table className="w-full border-collapse min-w-[550px]">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 font-extrabold uppercase text-left text-[10px]">
                  <th className="pb-3.5">ประเภทบัญชีรายได้</th>
                  <th className="pb-3.5 text-right">ยอดรวมสะสมจริง (บาท)</th>
                  <th className="pb-3.5 text-right">สถานะรายการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/60">
                {/* 1. Fixed Rent */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">1. รายรับค่าเช่าห้องพักประเภทคงที่ (Fixed Rent)</div>
                    <div className="text-[10px] text-slate-400 font-medium">ค่าเช่ารายเดือนตามสัญญาเช่าปกติ</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(fixedRentTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black border border-emerald-100 whitespace-nowrap inline-flex items-center">รับรู้รายได้แล้ว</span>
                  </td>
                </tr>

                {/* 2. Electric */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">2. รายรับค่าไฟฟ้า (Electricity Fee)</div>
                    <div className="text-[10px] text-slate-400 font-medium">{rateMetadata.electric.subtitle}</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(electricTotal)}</td>
                  <td className="py-3 text-right">
                    <span className={`px-2.5 py-1 ${rateMetadata.electric.badgeClass} rounded-full text-[9px] font-black border whitespace-nowrap inline-flex items-center`}>
                      {rateMetadata.electric.badge}
                    </span>
                  </td>
                </tr>

                {/* 3. Water */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">3. รายรับค่าน้ำ (Water Fee)</div>
                    <div className="text-[10px] text-slate-400 font-medium">{rateMetadata.water.subtitle}</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(waterTotal)}</td>
                  <td className="py-3 text-right">
                    <span className={`px-2.5 py-1 ${rateMetadata.water.badgeClass} rounded-full text-[9px] font-black border whitespace-nowrap inline-flex items-center`}>
                      {rateMetadata.water.badge}
                    </span>
                  </td>
                </tr>

                {/* 4. Common Fee */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">4. รายรับค่าบริการส่วนกลาง (Common Area Fee)</div>
                    <div className="text-[10px] text-slate-400 font-medium">{rateMetadata.common.subtitle}</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(commonTotal)}</td>
                  <td className="py-3 text-right">
                    <span className={`px-2.5 py-1 ${rateMetadata.common.badgeClass} rounded-full text-[9px] font-black border whitespace-nowrap inline-flex items-center`}>
                      {rateMetadata.common.badge}
                    </span>
                  </td>
                </tr>

                {/* 5. Internet Fee */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">5. รายรับค่าบริการอินเทอร์เน็ต (Internet Fee)</div>
                    <div className="text-[10px] text-slate-400 font-medium">{rateMetadata.internet.subtitle}</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(internetTotal)}</td>
                  <td className="py-3 text-right">
                    <span className={`px-2.5 py-1 ${rateMetadata.internet.badgeClass} rounded-full text-[9px] font-black border whitespace-nowrap inline-flex items-center`}>
                      {rateMetadata.internet.badge}
                    </span>
                  </td>
                </tr>

                {/* 6. Parking Fee */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">6. รายรับค่าที่จอดรถ (Parking Fee)</div>
                    <div className="text-[10px] text-slate-400 font-medium">{rateMetadata.parking.subtitle}</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(parkingTotal)}</td>
                  <td className="py-3 text-right">
                    <span className={`px-2.5 py-1 ${rateMetadata.parking.badgeClass} rounded-full text-[9px] font-black border whitespace-nowrap inline-flex items-center`}>
                      {rateMetadata.parking.badge}
                    </span>
                  </td>
                </tr>

                {/* 7. Other Services */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">7. รายรับค่าบริการอื่นๆ (Other Service Fees)</div>
                    <div className="text-[10px] text-slate-400 font-medium">ค่าใช้จ่ายอื่นๆ ในหน้าจดมิเตอร์ / ค่าทำความสะอาด / ค่าบริการเพิ่ม</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(otherServiceTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-purple-50 text-purple-600 rounded-full text-[9px] font-black border border-purple-100 whitespace-nowrap inline-flex items-center">ตามรายการบันทึก</span>
                  </td>
                </tr>

                {/* 8. Fines & Penalties */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">8. รายรับค่าปรับชำระเกินกำหนด (Late Fines & Penalties)</div>
                    <div className="text-[10px] text-slate-400 font-medium">
                      {fineTotal > 0 ? 'ค่าปรับกรณีชำระค่าเช่าเกินกำหนดวันดิวเดท' : 'ไม่มียอดค้างชำระที่ถูกปรับในงวดนี้'}
                    </div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(fineTotal)}</td>
                  <td className="py-3 text-right">
                    <span className={`px-2.5 py-1 ${fineTotal > 0 ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-slate-50 text-slate-500 border-slate-200'} rounded-full text-[9px] font-black border whitespace-nowrap inline-flex items-center`}>
                      {fineTotal > 0 ? 'เบี้ยปรับชำระช้า' : 'ไม่มีค่าปรับ'}
                    </span>
                  </td>
                </tr>

                {/* 9. Discounts & Deductions */}
                {discountTotal > 0 && (
                  <tr>
                    <td className="py-3 text-slate-700">
                      <div className="font-extrabold text-slate-900">9. ส่วนลดโปรโมชั่น / หักลดพิเศษ (Discounts)</div>
                      <div className="text-[10px] text-slate-400 font-medium">ส่วนลดค่าเช่าหรือรายการโปรโมชั่นตามบิล</div>
                    </td>
                    <td className="py-3 text-right font-black text-emerald-600">-{formatBaht(discountTotal)}</td>
                    <td className="py-3 text-right">
                      <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black border border-emerald-100 whitespace-nowrap inline-flex items-center">รายการหักลด</span>
                    </td>
                  </tr>
                )}

                {/* 10. Deposit & Security Guarantee */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">{discountTotal > 0 ? '10' : '9'}. รายรับเงินประกัน / เงินมัดจำสัญญา (Security Deposit)</div>
                    <div className="text-[10px] text-slate-400 font-medium">เงินประกันแรกเข้า ซึ่งจะหักจากค่ามัดจำ ถ้าเลิกเช่าแล้วคืนค่ามัดจำส่วนที่เหลือ</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(depositTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[9px] font-black border border-indigo-100 whitespace-nowrap inline-flex items-center">ถือครองเพื่อประกัน</span>
                  </td>
                </tr>

                {/* 11. Deposit Refund (When applicable) */}
                {depositRefundTotal > 0 && (
                  <tr>
                    <td className="py-3 text-slate-700">
                      <div className="font-extrabold text-slate-900">{discountTotal > 0 ? '11' : '10'}. คืนเงินประกันสัญญาผู้เช่า (Deposit Refunded)</div>
                      <div className="text-[10px] text-slate-400 font-medium">ยอดเงินประกันที่คืนให้ผู้เช่าเมื่อสิ้นสุดสัญญาหลังหักค่าใช้จ่าย</div>
                    </td>
                    <td className="py-3 text-right font-black text-rose-600">-{formatBaht(depositRefundTotal)}</td>
                    <td className="py-3 text-right">
                      <span className="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-full text-[9px] font-black border border-rose-100 whitespace-nowrap inline-flex items-center">จ่ายคืนผู้เช่า</span>
                    </td>
                  </tr>
                )}

                {/* VAT 7% Row (ภ.พ.30) */}
                {monthVatTotal > 0 && (
                  <tr className="bg-amber-50/30 border-t border-amber-100/60">
                    <td className="py-3 text-slate-700">
                      <div className="font-extrabold text-amber-900 flex items-center gap-1.5">
                        <span>ภาษีมูลค่าเพิ่ม 7% (ภ.พ.30)</span>
                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[9px] font-black">+VAT 7%</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-medium">ภาษีขายเรียกเก็บตามหมวดที่เปิดใช้งาน VAT ในรอบบิลนี้</div>
                    </td>
                    <td className="py-3 text-right font-black text-amber-700">{formatBaht(monthVatTotal)}</td>
                    <td className="py-3 text-right">
                      <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-[9px] font-black border border-amber-200 whitespace-nowrap inline-flex items-center">
                        ภาษีขายนำส่ง
                      </span>
                    </td>
                  </tr>
                )}

                {/* Total Summary Row */}
                <tr className="bg-slate-50/80 font-extrabold border-t-2 border-slate-200">
                  <td className="py-3.5 text-slate-900 pl-3">
                    <div className="font-black text-xs text-slate-900">รวมยอดรายรับจัดเก็บสะสมทั้งหมดในรอบนี้</div>
                    <div className="text-[10px] text-slate-500 font-normal">
                      {depositRefundTotal > 0
                        ? 'รวมรายรับบิลค่าเช่า + เงินประกัน - เงินประกันคืนผู้เช่า'
                        : 'รวมรายรับบิลค่าเช่า + เงินประกัน/มัดจำสัญญา'}
                    </div>
                  </td>
                  <td className="py-3.5 text-right text-[#2b64f6] font-black text-sm sm:text-base pr-3">
                    {formatBaht(totalBilledPlusDeposit)}
                  </td>
                  <td className="py-3.5 text-right pr-3">
                    <span className="text-emerald-600 font-extrabold text-[10px] whitespace-nowrap inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>สถานะการเงินปกติ</span>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          data-testid="toast-csv-export"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
};
