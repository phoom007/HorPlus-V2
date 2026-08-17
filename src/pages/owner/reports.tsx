/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
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
import { Room, Bill, Building, Tenant, Contract } from '../../types';
import { calculateOwnerReports } from '../../utils/report-calculations';

interface OwnerReportsProps {
  rooms?: Room[];
  bills?: Bill[];
  buildings?: Building[];
  tenants?: Tenant[];
  contracts?: Contract[];
  selectedCycle?: string;
  onNavigate?: (tab: string, param?: string) => void;
}

const formatBaht = (val: number | string) => {
  const num = typeof val === 'string' ? parseFloat(val) || 0 : val || 0;
  return `฿ ${num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const calcOtherFees = (b: any) => {
  let feeSum = 0;
  if (typeof b.otherFees === 'number') {
    feeSum += b.otherFees;
  } else if (Array.isArray(b.otherFees)) {
    feeSum += b.otherFees.reduce((s: number, item: any) => s + (Number(item?.amount) || 0), 0);
  }
  const othItems = b.items?.filter((i: any) => ['other', 'repair', 'addon', 'cleaning'].includes(i.category || i.type))
    .reduce((s: number, i: any) => s + (Number(i?.amount) || 0), 0) || 0;
  return feeSum + othItems;
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

export const OwnerReports: React.FC<OwnerReportsProps> = ({
  rooms = [],
  bills = [],
  buildings = [],
  tenants = [],
  contracts = [],
  selectedCycle: propSelectedCycle,
  onNavigate
}) => {
  const currentYearStr = new Date().getFullYear().toString();
  const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0');
  const defaultCurrentCycle = `${currentYearStr}-${currentMonthStr}`;

  const [selectedYear, setSelectedYear] = useState(propSelectedCycle ? propSelectedCycle.split('-')[0] : currentYearStr);
  const [selectedBuilding, setSelectedBuilding] = useState('all');
  const [selectedCycleState, setSelectedCycleState] = useState<string>(propSelectedCycle || defaultCurrentCycle);
  const [showCsvPopover, setShowCsvPopover] = useState(false);

  const selectedCycle = selectedCycleState || propSelectedCycle || defaultCurrentCycle;

  // Month Names Mapping
  const monthNames: Record<string, string> = {
    '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
    '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
    '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
  };

  const fullMonthNames: Record<string, string> = {
    '01': 'มกราคม', '02': 'กุมภาพันธ์', '03': 'มีนาคม', '04': 'เมษายน',
    '05': 'พฤษภาคม', '06': 'มิถุนายน', '07': 'กรกฎาคม', '08': 'สิงหาคม',
    '09': 'กันยายน', '10': 'ตุลาคม', '11': 'พฤศจิกายน', '12': 'ธันวาคม'
  };

  // Available building options
  const buildingOptions = useMemo(() => {
    return buildings || [];
  }, [buildings]);

  // Execute canonical shared report calculations
  const reportData = useMemo(() => {
    return calculateOwnerReports({
      rooms,
      bills,
      buildings,
      tenants,
      contracts,
      selectedBuilding,
      selectedCycle,
      selectedYear,
    });
  }, [rooms, bills, buildings, tenants, contracts, selectedBuilding, selectedCycle, selectedYear]);

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
    fixedRentTotal,
    waterTotal,
    electricTotal,
    commonParkingTotal,
    otherServiceTotal,
    fineTotal,
    depositTotal,
    totalBilledThisMonth,
    totalRevenueThisMonth,
    totalUnpaidThisMonth,
    totalOverdueAmount,
    paidPercent,
    unpaidPercent,
    occupiedPercent,
    vacantPercent,
    arpu,
    yearBilledTotal,
    paidBillsRooms,
    unpaidBillsRooms,
  } = reportData;

  // Month-by-month historical data for AreaChart
  const revenueHistory = useMemo(() => {
    const defaultMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const monthlyDataMap: Record<string, { rent: number; water: number; elec: number; other: number; total: number }> = {};

    defaultMonths.forEach(m => {
      const cKey = `${selectedYear}-${m}`;
      monthlyDataMap[cKey] = { rent: 0, water: 0, elec: 0, other: 0, total: 0 };
    });

    filteredBills.forEach(b => {
      if (b.cycleId && b.cycleId.startsWith(selectedYear)) {
        if (!monthlyDataMap[b.cycleId]) {
          monthlyDataMap[b.cycleId] = { rent: 0, water: 0, elec: 0, other: 0, total: 0 };
        }
        const rentItem = b.items?.find(i => i.category === 'rent' || i.description?.includes('ค่าเช่า'));
        const rentVal = rentItem ? rentItem.amount : ((b as any).rentAmount || 0);

        const wItem = b.items?.find(i => i.category === 'water' || i.description?.includes('ค่าน้ำ'));
        const waterVal = wItem ? wItem.amount : ((b as any).waterAmount || 0);

        const elItem = b.items?.find(i => i.category === 'electricity' || i.category === 'electric' || i.description?.includes('ค่าไฟ'));
        const elecVal = elItem ? elItem.amount : ((b as any).electricAmount || 0);

        const pkItem = b.items?.find(i => i.category === 'parking');
        const parkingVal = pkItem ? pkItem.amount : ((b as any).parkingFee || 0);

        const otherVal = parkingVal + ((b as any).internetFee || 0) + ((b as any).commonFee || 0) + calcOtherFees(b);

        monthlyDataMap[b.cycleId].rent += rentVal;
        monthlyDataMap[b.cycleId].water += waterVal;
        monthlyDataMap[b.cycleId].elec += elecVal;
        monthlyDataMap[b.cycleId].other += otherVal;
        monthlyDataMap[b.cycleId].total += (b.totalAmount || (rentVal + waterVal + elecVal + otherVal));
      }
    });

    return Object.keys(monthlyDataMap).sort().map(cKey => {
      const mStr = cKey.split('-')[1] || '01';
      const name = monthNames[mStr] || cKey;
      const data = monthlyDataMap[cKey];
      return {
        cycleId: cKey,
        name,
        rent: data.rent,
        water: data.water,
        elec: data.elec,
        other: data.other,
        total: data.total
      };
    });
  }, [filteredBills, selectedYear]);

  // Export CSV Function (Mode: 'monthly' | 'yearly')
  const handleExportCSVMode = (mode: 'monthly' | 'yearly') => {
    setShowCsvPopover(false);
    const bObj = buildingOptions.find(b => b.id === selectedBuilding);
    const bName = selectedBuilding === 'all' ? 'ทุกตึก' : (bObj?.name || selectedBuilding);
    const currentMonthNum = selectedCycle.split('-')[1] || '07';
    const monthLabel = `${monthNames[currentMonthNum]} ${parseInt(selectedYear) + 543}`;
    const yearLabel = `${parseInt(selectedYear) + 543}`;

    let csv = `\uFEFFรายงานสรุปการเงินและสถิติหอพัก (${bName})\n`;
    
    if (mode === 'monthly') {
      csv += `ประเภทรายงาน: ประจำเดือน ${monthLabel} (รอบ ${selectedCycle})\n`;
      csv += `พิมพ์เมื่อวันที่: ${new Date().toLocaleString('th-TH')}\n\n`;
      csv += `ประเภทรายรับ,จำนวนเงิน (บาท)\n`;
      csv += `"ค่าเช่าห้องพัก",${fixedRentTotal}\n`;
      csv += `"ค่าไฟฟ้า",${electricTotal}\n`;
      csv += `"ค่าน้ำประปา",${waterTotal}\n`;
      csv += `"ส่วนกลาง / เน็ต / ที่จอด",${commonParkingTotal}\n`;
      csv += `"ค่าบริการอื่นๆ",${otherServiceTotal}\n`;
      csv += `"ค่าปรับชำระเกินกำหนด",${fineTotal}\n`;
      csv += `"ค่าประกัน / มัดจำ",${depositTotal}\n`;
      csv += `"รวมยอดจัดเก็บทั้งหมด",${totalBilledThisMonth}\n\n`;

      csv += `สถานะการชำระเงินประจำเดือน (${selectedCycle}):\n`;
      csv += `เลขห้อง,สถานะ,ยอดเงินชำระ (บาท)\n`;
      currentMonthBills.forEach(b => {
        const rm = rooms.find(r => r.id === b.roomId);
        csv += `"${rm?.roomNumber || 'ไม่ระบุ'}","${b.status === 'paid' ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}",${b.totalAmount}\n`;
      });
    } else {
      csv += `ประเภทรายงาน: ประจำปี ${yearLabel} (ปี ค.ศ. ${selectedYear})\n`;
      csv += `พิมพ์เมื่อวันที่: ${new Date().toLocaleString('th-TH')}\n\n`;
      csv += `เดือน,ค่าเช่าห้อง (บาท),ค่าน้ำประปา (บาท),ค่าไฟฟ้า (บาท),อื่นๆ/ส่วนกลาง (บาท),รวมจัดเก็บ (บาท)\n`;

      revenueHistory.forEach(r => {
        csv += `"${r.name}",${r.rent},${r.water},${r.elec},${r.other},${r.total}\n`;
      });
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = mode === 'monthly'
      ? `HorPlus_Report_Monthly_${selectedCycle}_${selectedBuilding}.csv`
      : `HorPlus_Report_Yearly_${selectedYear}_${selectedBuilding}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Category Percentages for Monthly Expense Breakdown
  const totalBreakdownBase = totalBilledThisMonth + depositTotal || 1;
  const rentPct = ((fixedRentTotal / totalBreakdownBase) * 100).toFixed(1);
  const elecPct = ((electricTotal / totalBreakdownBase) * 100).toFixed(1);
  const waterPct = ((waterTotal / totalBreakdownBase) * 100).toFixed(1);
  const commonPct = ((commonParkingTotal / totalBreakdownBase) * 100).toFixed(1);
  const otherPct = ((otherServiceTotal / totalBreakdownBase) * 100).toFixed(1);
  const finePct = ((fineTotal / totalBreakdownBase) * 100).toFixed(1);
  const depositPct = ((depositTotal / totalBreakdownBase) * 100).toFixed(1);

  const selectedCycleMonthNum = selectedCycle.split('-')[1] || '07';
  const displayMonthTh = monthNames[selectedCycleMonthNum] || 'ก.ค.';
  const displayYearTh = (parseInt(selectedCycle.split('-')[0] || selectedYear) + 543).toString();

  return (
    <div className="space-y-6">
      
      {/* HEADER CARD: 'วิเคราะห์การเงินและสถิติหอพัก' */}
      <div className="bg-white p-6 rounded-3xl border border-slate-100/80 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-start md:items-center relative">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-blue-50 text-[#2b64f6] rounded-2xl shadow-xs border border-blue-100 shrink-0">
            <BarChart4 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800 leading-tight">วิเคราะห์การเงินและสถิติหอพัก</h3>
            <p className="text-xs text-slate-400 font-medium mt-1 leading-none">
              สรุปรายงานผลประกอบการ กระแสเงินสด และอัตราครองห้องพักแบบ Sync ข้อมูลจริง
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
            </select>
          </div>

          {/* 2. Button: ส่งออก CSV with Popover */}
          <div className="relative">
            <button
              onClick={() => setShowCsvPopover(prev => !prev)}
              className="px-4 py-2 bg-[#2b64f6] hover:bg-blue-700 text-white font-extrabold text-xs rounded-2xl flex items-center justify-center gap-2 shadow-xs hover:shadow-md transition-all cursor-pointer"
              title="ส่งออกข้อมูลรายเดือนหรือรายปีเป็นไฟล์ CSV"
            >
              <Download className="w-4 h-4" />
              <span>ส่งออก CSV</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showCsvPopover ? 'rotate-180' : ''}`} />
            </button>

            {/* CSV Period Selection Mini Popover Card (Requirement 5) */}
            {showCsvPopover && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    <span>เลือกช่วงเวลาส่งออก CSV</span>
                  </span>
                  <button
                    onClick={() => setShowCsvPopover(false)}
                    className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <button
                    onClick={() => handleExportCSVMode('monthly')}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-blue-50 border border-slate-100 hover:border-blue-200 text-xs transition-all cursor-pointer group"
                  >
                    <p className="font-extrabold text-slate-800 group-hover:text-blue-700">
                      ประจำเดือน {displayMonthTh} {displayYearTh}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium">
                      (ข้อมูลงวด {selectedCycle} ของอาคารที่เลือก)
                    </p>
                  </button>

                  <button
                    onClick={() => handleExportCSVMode('yearly')}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 text-xs transition-all cursor-pointer group"
                  >
                    <p className="font-extrabold text-slate-800 group-hover:text-indigo-700">
                      ประจำปี {displayYearTh}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium">
                      (สรุปข้อมูล 12 เดือนของปี {selectedYear})
                    </p>
                  </button>
                </div>
              </div>
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
                  {buildingOptions.find(b => b.id === selectedBuilding)?.name || selectedBuilding}
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
              { label: `มูลค่าจัดเก็บรวมปี ${selectedYear}`, val: formatBaht(yearBilledTotal), pct: `ประจำปี ${selectedYear}`, sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'อัตราการครองห้องพัก', val: `${occupiedPercent}%`, pct: `เข้าพัก ${occupiedCount}/${totalRooms} ห้อง`, sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'ยอดค้างชำระสะสม', val: formatBaht(totalOverdueAmount), pct: 'ติดตามทวงถาม', sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'อัตราจัดเก็บชำระจริง', val: `${paidPercent}%`, pct: `รับแล้ว ${paidBills.length} บิล`, sub: `อัปเดตอ้างอิงงวด ${displayMonthTh} ${displayYearTh}` },
              { label: 'รายได้เฉลี่ยต่อห้อง (ARPU)', val: formatBaht(arpu), pct: 'เฉลี่ยรายห้อง', sub: `คำนวณจาก ${occupiedCount} ห้องที่มีผู้เช่า` },
              { label: 'ยอดประกันถือครองรวม', val: formatBaht(depositTotal), pct: 'หลักประกันสัญญา', sub: 'อ้างอิงสัญญาเช่าที่มีผลบังคับใช้' }
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

              {/* 3. ค่าน้ำประปา */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <Droplet className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                    <span>ค่าน้ำประปา</span>
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
                <span>สถิติมูลค่ารายรับรอบปี {selectedYear} แยกตามรายเดือน</span>
              </h4>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                กราฟเปรียบเทียบแนวโน้มรายรับรวมทุกประเภทเทียบกับค่าเช่าห้องพัก (อ้างอิงปี {selectedYear})
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
                    <stop offset="5%" stopColor="#2b64f6" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#2b64f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" tickFormatter={(val) => `${val/1000}k`} tickLine={false} axisLine={false} />
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
          <div>
            <h4 className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>รายงานสรุปผลประกอบการการเงิน (Financial Ledger Statement)</span>
            </h4>
            <p className="text-[10px] text-slate-400 mt-0.5 leading-none font-medium">
              บันทึกยอดสะสมจัดเก็บจำแนกประเภทบัญชีรายได้ครบถ้วน ประจำงวด {displayMonthTh} {displayYearTh}
            </p>
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
                    <div className="text-[10px] text-slate-400 font-medium">คิดตามยูนิตมิเตอร์จดประจำเดือน</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(electricTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-[9px] font-black border border-amber-100 whitespace-nowrap inline-flex items-center">ตามมิเตอร์จริง</span>
                  </td>
                </tr>

                {/* 3. Water */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">3. รายรับค่าน้ำประปา (Water Fee)</div>
                    <div className="text-[10px] text-slate-400 font-medium">คิดตามยูนิตมิเตอร์ หรือแบบเหมาจ่าย</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(waterTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-sky-50 text-sky-600 rounded-full text-[9px] font-black border border-sky-100 whitespace-nowrap inline-flex items-center">ตามมิเตอร์จริง</span>
                  </td>
                </tr>

                {/* 4. Common & Internet & Parking */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">4. รายรับค่าบริการส่วนกลาง / อินเทอร์เน็ต / ที่จอดรถ</div>
                    <div className="text-[10px] text-slate-400 font-medium">ค่าธรรมเนียมบำรุงรักษาส่วนกลาง ที่จอดรถ และสัญญาณเน็ต</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(commonParkingTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black border border-emerald-100 whitespace-nowrap inline-flex items-center">เหมาจ่ายรายเดือน</span>
                  </td>
                </tr>

                {/* 5. Other Services */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">5. รายรับค่าบริการอื่นๆ (Other Service Fees)</div>
                    <div className="text-[10px] text-slate-400 font-medium">คือค่าใช้จ่ายอื่นๆ ในหน้าจดมิเตอร์ / ค่าทำความสะอาด / ค่าบริการเพิ่ม</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(otherServiceTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-purple-50 text-purple-600 rounded-full text-[9px] font-black border border-purple-100 whitespace-nowrap inline-flex items-center">ตามรายการบันทึก</span>
                  </td>
                </tr>

                {/* 6. Fines & Penalties */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">6. รายรับค่าปรับชำระเกินกำหนด (Late Fines & Penalties)</div>
                    <div className="text-[10px] text-slate-400 font-medium">ค่าปรับกรณีชำระค่าเช่าเกินกำหนดวันดิวเดท</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(fineTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-rose-50 text-rose-600 rounded-full text-[9px] font-black border border-rose-100 whitespace-nowrap inline-flex items-center">เบี้ยปรับชำระช้า</span>
                  </td>
                </tr>

                {/* 7. Deposit & Security Guarantee */}
                <tr>
                  <td className="py-3 text-slate-700">
                    <div className="font-extrabold text-slate-900">7. รายรับเงินประกัน / เงินมัดจำสัญญา (Security Deposit)</div>
                    <div className="text-[10px] text-slate-400 font-medium">เงินประกันแรกเข้า ซึ่งจะหักจากค่ามัดจำ ถ้าเลิกเช่าแล้วคืนค่ามัดจำส่วนที่เหลือ</div>
                  </td>
                  <td className="py-3 text-right font-black text-slate-800">{formatBaht(depositTotal)}</td>
                  <td className="py-3 text-right">
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[9px] font-black border border-indigo-100 whitespace-nowrap inline-flex items-center">ถือครองเพื่อประกัน</span>
                  </td>
                </tr>

                {/* Total Summary Row */}
                <tr className="bg-slate-50/80 font-extrabold border-t-2 border-slate-200">
                  <td className="py-3.5 text-slate-900 pl-3">
                    <div className="font-black text-xs text-slate-900">รวมยอดรายรับจัดเก็บสะสมทั้งหมดในรอบนี้</div>
                    <div className="text-[10px] text-slate-500 font-normal">รวมรายรับบิลค่าเช่า + เงินประกัน/มัดจำสัญญา</div>
                  </td>
                  <td className="py-3.5 text-right text-[#2b64f6] font-black text-sm sm:text-base pr-3">
                    {formatBaht(totalBilledThisMonth + depositTotal)}
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

    </div>
  );
};
