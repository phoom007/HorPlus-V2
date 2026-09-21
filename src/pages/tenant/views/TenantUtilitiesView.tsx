/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — SubView: Utilities (ค่าน้ำ / ค่าไฟ)
 * Features Grouped Bar Chart (recharts) for monthly water & power usage, with tenancy boundary isolation.
 */

import React from 'react';
import { ChevronLeft, Zap, Droplet, Building as BuildingIcon, BarChart3 } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { formatToBeDate } from '../tenantHelpers';

export interface TenantUtilitiesViewProps {
  tenantRoom: any;
  utilitiesData: any;
  contractStartDate?: string;
  hasRoom?: boolean;
  onBack: () => void;
}

export const TenantUtilitiesView: React.FC<TenantUtilitiesViewProps> = ({
  tenantRoom,
  utilitiesData,
  contractStartDate,
  hasRoom = Boolean(tenantRoom),
  onBack,
}) => {
  if (!tenantRoom || !hasRoom) {
    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
          <button
            onClick={onBack}
            className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
            aria-label="ย้อนกลับ"
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h3 className="text-xs font-black text-slate-900 text-center flex-1">ค่าน้ำ / ค่าไฟ</h3>
          <div className="w-7 flex justify-end shrink-0">
            <Zap className="w-5 h-5 text-amber-500" />
          </div>
        </div>

        <div className="py-24 text-center flex-1 flex items-center justify-center">
          <p className="text-slate-400 font-semibold text-xs">ยังไม่มีข้อมูลการใช้น้ำและไฟฟ้า</p>
        </div>
      </div>
    );
  }
  // PO Requirement Q6=A: Strictly filter readings on or after current tenant's contractStartDate
  const filteredReadings = (utilitiesData?.readings || []).filter((r: any) => {
    if (!contractStartDate) return true;
    const rdDate = new Date(r.readAt);
    const start = new Date(contractStartDate);
    if (isNaN(rdDate.getTime()) || isNaN(start.getTime())) return true;
    return rdDate >= start || (rdDate.getFullYear() === start.getFullYear() && rdDate.getMonth() >= start.getMonth());
  });

  // Group readings by month
  const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthlyDataMap = new Map<string, { month: string; rawDate: Date; electric: number; water: number }>();

  filteredReadings.forEach((rd: any) => {
    const d = new Date(rd.readAt);
    if (isNaN(d.getTime())) return;
    const shortYear = String((d.getFullYear() + 543) % 100).padStart(2, '0');
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = `${thaiMonths[d.getMonth()]} ${shortYear}`;

    if (!monthlyDataMap.has(monthKey)) {
      monthlyDataMap.set(monthKey, { month: monthLabel, rawDate: d, electric: 0, water: 0 });
    }
    const item = monthlyDataMap.get(monthKey)!;
    const units = Number(rd.usageUnits || 0);
    const mType = (rd.meterType || '').toLowerCase();
    if (mType === 'electric' || mType === 'electricity') {
      item.electric = units;
    } else if (mType === 'water') {
      item.water = units;
    }
  });

  // Include current cycle if latest data is present
  if (utilitiesData?.latestElectric || utilitiesData?.latestWater) {
    const now = new Date();
    const shortYear = String((now.getFullYear() + 543) % 100).padStart(2, '0');
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentLabel = `${thaiMonths[now.getMonth()]} ${shortYear}`;

    if (!monthlyDataMap.has(currentKey)) {
      monthlyDataMap.set(currentKey, {
        month: currentLabel,
        rawDate: now,
        electric: Number(utilitiesData?.latestElectric?.usageUnits || 0),
        water: Number(utilitiesData?.latestWater?.usageUnits || 0),
      });
    } else {
      const cur = monthlyDataMap.get(currentKey)!;
      if (utilitiesData?.latestElectric?.usageUnits && cur.electric === 0) {
        cur.electric = Number(utilitiesData.latestElectric.usageUnits);
      }
      if (utilitiesData?.latestWater?.usageUnits && cur.water === 0) {
        cur.water = Number(utilitiesData.latestWater.usageUnits);
      }
    }
  }

  const chartData = Array.from(monthlyDataMap.values())
    .sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime())
    .slice(-6);

  const waterMode = String(utilitiesData?.waterBillingType || 'per_unit').toLowerCase();
  const elecMode = String(utilitiesData?.electricityBillingType || 'per_unit').toLowerCase();
  const waterRate = Number(utilitiesData?.waterRate ?? utilitiesData?.latestWater?.unitPrice ?? 18);
  const elecRate = Number(utilitiesData?.electricityRate ?? utilitiesData?.latestElectric?.unitPrice ?? 8);
  const peopleCount = Math.max(1, Number(utilitiesData?.peopleCount || 1));

  const hasWaterRecorded = utilitiesData?.latestWater?.currentReading !== null &&
    utilitiesData?.latestWater?.currentReading !== undefined &&
    !(Number(utilitiesData?.latestWater?.previousReading) > 0 && Number(utilitiesData?.latestWater?.currentReading) === 0);
  const hasElecRecorded = utilitiesData?.latestElectric?.currentReading !== null &&
    utilitiesData?.latestElectric?.currentReading !== undefined &&
    !(Number(utilitiesData?.latestElectric?.previousReading) > 0 && Number(utilitiesData?.latestElectric?.currentReading) === 0);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Subview Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <button
          onClick={onBack}
          className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
          aria-label="ย้อนกลับ"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">ค่าน้ำ / ค่าไฟ</h3>
        <div className="w-7 flex justify-end shrink-0">
          <Zap className="w-5 h-5 text-amber-500" />
        </div>
      </div>

      <div className="p-4 space-y-4 pb-20 overflow-y-auto">
        {/* 1. Historical Usage Grouped Bar Chart (PO Q6=A) */}
        <div
          data-testid="utilities-usage-chart-card"
          className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-xl">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-extrabold text-xs text-slate-900">
                  สถิติการใช้งานน้ำ - ไฟฟ้าย้อนหลัง
                </h4>
                <p className="text-[9px] text-slate-400">หน่วยการใช้จริงในแต่ละเดือน</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[8px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
              ช่วงเวลาที่เข้าพัก
            </span>
          </div>

          {chartData.length > 0 ? (
            <div className="h-52 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 9, fill: '#64748b', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      fontSize: '10px',
                      fontWeight: 600,
                      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.07)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
                  <Bar
                    dataKey="electric"
                    name="⚡ ไฟฟ้า (หน่วย)"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                  />
                  <Bar
                    dataKey="water"
                    name="💧 น้ำประปา (หน่วย)"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-10 text-center text-slate-400 text-xs">
              ยังไม่มีประวัติการจดมิเตอร์ในช่วงเวลาการเช่าพัก
            </div>
          )}
        </div>

        {/* 2. ค่าไฟฟ้า Card */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-2xl">
                <Zap className="w-5 h-5 fill-amber-400" />
              </div>
              <div>
                <h4 className="font-black text-xs text-slate-900">ค่าไฟฟ้า (Electricity)</h4>
                <p className="text-[9px] text-slate-400">
                  {elecMode === 'per_person' || elecMode === 'person'
                    ? `คิดตามจำนวนคน (อัตรา ฿${elecRate.toLocaleString()} บาท/คน)`
                    : elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room'
                      ? `เหมาจ่ายรายเดือน (อัตราคงที่ ฿${elecRate.toLocaleString()} บาท/ห้อง)`
                      : elecMode === 'free' || elecMode === 'none'
                        ? 'ฟรี (ไม่มีค่าใช้จ่าย)'
                        : elecMode === 'tiered'
                          ? 'อัตราก้าวหน้า (คิดตามขั้นบันได)'
                          : `อัตราหน่วยละ ${elecRate} บาท`}
                </p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black border ${elecMode === 'free' || elecMode === 'none'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : elecMode === 'per_person' || elecMode === 'person'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : hasElecRecorded
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
              {elecMode === 'free' || elecMode === 'none'
                ? 'ฟรี'
                : elecMode === 'per_person' || elecMode === 'person'
                  ? 'ตามจำนวนคน'
                  : elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room'
                    ? 'เหมาจ่าย'
                    : hasElecRecorded
                      ? 'บันทึกแล้ว'
                      : 'รอจดมิเตอร์'}
            </span>
          </div>

          {/* Dynamic Content based on Billing Type */}
          {elecMode === 'per_person' || elecMode === 'person' ? (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
              <div className="p-2 bg-slate-50 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block">ผู้พักอาศัย</span>
                <span className="text-xs font-black text-slate-700">{peopleCount} คน</span>
              </div>
              <div className="p-2 bg-slate-50 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block">อัตราต่อคน</span>
                <span className="text-xs font-black text-slate-700">฿{elecRate.toLocaleString()}</span>
              </div>
              <div className="p-2 bg-amber-50/60 rounded-xl border border-amber-100">
                <span className="text-[9px] text-amber-600 font-bold block">รวมค่าไฟฟ้า</span>
                <span className="text-xs font-black text-amber-700">
                  ฿{(peopleCount * elecRate).toLocaleString()}
                </span>
              </div>
            </div>
          ) : elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room' ? (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-center">
              <div className="p-2 bg-slate-50 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block">รูปแบบการคิดเงิน</span>
                <span className="text-xs font-black text-slate-700">เหมาจ่ายรายเดือน</span>
              </div>
              <div className="p-2 bg-amber-50/60 rounded-xl border border-amber-100">
                <span className="text-[9px] text-amber-600 font-bold block">ยอดคงที่ต่อเดือน</span>
                <span className="text-xs font-black text-amber-700">฿{elecRate.toLocaleString()} บาท</span>
              </div>
            </div>
          ) : elecMode === 'free' || elecMode === 'none' ? (
            <div className="p-2.5 bg-slate-50 rounded-xl text-center text-slate-500 font-bold text-xs pt-2 border-t border-slate-100">
              ไม่มีค่าใช้จ่ายค่าไฟฟ้าในรอบบิลนี้
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
                <div className="p-2 bg-slate-50 rounded-xl">
                  <span className="text-[9px] text-slate-400 font-bold block">มิเตอร์ก่อน</span>
                  <span className="text-xs font-black text-slate-700">
                    {utilitiesData?.latestElectric?.previousReading ?? '-'}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 rounded-xl">
                  <span className="text-[9px] text-slate-400 font-bold block">มิเตอร์หลัง</span>
                  <span className="text-xs font-black text-slate-700">
                    {hasElecRecorded ? utilitiesData?.latestElectric?.currentReading : '-'}
                  </span>
                </div>
                <div className="p-2 bg-amber-50/60 rounded-xl border border-amber-100">
                  <span className="text-[9px] text-amber-600 font-bold block">จำนวนหน่วย</span>
                  <span className="text-xs font-black text-amber-700">
                    {hasElecRecorded ? `${utilitiesData?.latestElectric?.usageUnits} หน่วย` : '- หน่วย'}
                  </span>
                </div>
              </div>
              {elecMode === 'tiered' && Array.isArray(utilitiesData?.electricityTierRates) && (
                <div className="pt-1.5 flex flex-wrap gap-1.5 items-center justify-center">
                  {utilitiesData.electricityTierRates.map((tier: any, idx: number) => (
                    <span key={idx} className="px-2 py-0.5 bg-amber-50 text-amber-800 text-[8px] font-bold rounded-lg border border-amber-200/60">
                      {tier.upTo ? `<= ${tier.upTo} หน่วย: ฿${tier.rate}` : `> ถัดไป: ฿${tier.rate}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. ค่าน้ำประปา Card */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
                <Droplet className="w-5 h-5 fill-blue-400" />
              </div>
              <div>
                <h4 className="font-black text-xs text-slate-900">ค่าน้ำประปา (Water)</h4>
                <p className="text-[9px] text-slate-400">
                  {waterMode === 'per_person' || waterMode === 'person'
                    ? `คิดตามจำนวนคน (อัตรา ฿${waterRate.toLocaleString()} บาท/คน)`
                    : waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room'
                      ? `เหมาจ่ายรายเดือน (อัตราคงที่ ฿${waterRate.toLocaleString()} บาท/ห้อง)`
                      : waterMode === 'free' || waterMode === 'none'
                        ? 'ฟรี (ไม่มีค่าใช้จ่าย)'
                        : waterMode === 'tiered'
                          ? 'อัตราก้าวหน้า (คิดตามขั้นบันได)'
                          : `อัตราหน่วยละ ${waterRate} บาท`}
                </p>
              </div>
            </div>
            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black border ${waterMode === 'free' || waterMode === 'none'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : waterMode === 'per_person' || waterMode === 'person'
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : hasWaterRecorded
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
              {waterMode === 'free' || waterMode === 'none'
                ? 'ฟรี'
                : waterMode === 'per_person' || waterMode === 'person'
                  ? 'ตามจำนวนคน'
                  : waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room'
                    ? 'เหมาจ่าย'
                    : hasWaterRecorded
                      ? 'บันทึกแล้ว'
                      : 'รอจดมิเตอร์'}
            </span>
          </div>

          {/* Dynamic Content based on Billing Type */}
          {waterMode === 'per_person' || waterMode === 'person' ? (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
              <div className="p-2 bg-slate-50 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block">ผู้พักอาศัย</span>
                <span className="text-xs font-black text-slate-700">{peopleCount} คน</span>
              </div>
              <div className="p-2 bg-slate-50 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block">อัตราต่อคน</span>
                <span className="text-xs font-black text-slate-700">฿{waterRate.toLocaleString()}</span>
              </div>
              <div className="p-2 bg-blue-50/60 rounded-xl border border-blue-100">
                <span className="text-[9px] text-blue-600 font-bold block">รวมค่าน้ำประปา</span>
                <span className="text-xs font-black text-blue-700">
                  ฿{(peopleCount * waterRate).toLocaleString()}
                </span>
              </div>
            </div>
          ) : waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room' ? (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-center">
              <div className="p-2 bg-slate-50 rounded-xl">
                <span className="text-[9px] text-slate-400 font-bold block">รูปแบบการคิดเงิน</span>
                <span className="text-xs font-black text-slate-700">เหมาจ่ายรายเดือน</span>
              </div>
              <div className="p-2 bg-blue-50/60 rounded-xl border border-blue-100">
                <span className="text-[9px] text-blue-600 font-bold block">ยอดคงที่ต่อเดือน</span>
                <span className="text-xs font-black text-blue-700">฿{waterRate.toLocaleString()} บาท</span>
              </div>
            </div>
          ) : waterMode === 'free' || waterMode === 'none' ? (
            <div className="p-2.5 bg-slate-50 rounded-xl text-center text-slate-500 font-bold text-xs pt-2 border-t border-slate-100">
              ไม่มีค่าใช้จ่ายค่าน้ำประปาในรอบบิลนี้
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
                <div className="p-2 bg-slate-50 rounded-xl">
                  <span className="text-[9px] text-slate-400 font-bold block">มิเตอร์ก่อน</span>
                  <span className="text-xs font-black text-slate-700">
                    {utilitiesData?.latestWater?.previousReading ?? '-'}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 rounded-xl">
                  <span className="text-[9px] text-slate-400 font-bold block">มิเตอร์หลัง</span>
                  <span className="text-xs font-black text-slate-700">
                    {hasWaterRecorded ? utilitiesData?.latestWater?.currentReading : '-'}
                  </span>
                </div>
                <div className="p-2 bg-blue-50/60 rounded-xl border border-blue-100">
                  <span className="text-[9px] text-blue-600 font-bold block">จำนวนหน่วย</span>
                  <span className="text-xs font-black text-blue-700">
                    {hasWaterRecorded ? `${utilitiesData?.latestWater?.usageUnits} หน่วย` : '- หน่วย'}
                  </span>
                </div>
              </div>
              {waterMode === 'tiered' && Array.isArray(utilitiesData?.waterTierRates) && (
                <div className="pt-1.5 flex flex-wrap gap-1.5 items-center justify-center">
                  {utilitiesData.waterTierRates.map((tier: any, idx: number) => (
                    <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-800 text-[8px] font-bold rounded-lg border border-blue-200/60">
                      {tier.upTo ? `<= ${tier.upTo} หน่วย: ฿${tier.rate}` : `> ถัดไป: ฿${tier.rate}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. ประวัติการจดมิเตอร์ย้อนหลัง */}
        {filteredReadings && filteredReadings.length > 0 && (
          <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs space-y-2.5">
            <h4 className="text-xs font-black text-slate-800">ประวัติการจดมิเตอร์ย้อนหลัง</h4>
            <div className="space-y-2">
              {filteredReadings.slice(0, 6).map((rd: any) => (
                <div
                  key={rd.id}
                  className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl text-[10px]"
                >
                  <div className="flex items-center gap-2">
                    {['electric', 'electricity'].includes((rd.meterType || '').toLowerCase()) ? (
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <Droplet className="w-3.5 h-3.5 text-blue-500" />
                    )}
                    <span className="font-bold text-slate-700">
                      {['electric', 'electricity'].includes((rd.meterType || '').toLowerCase()) ? 'ค่าไฟ' : 'ค่าน้ำ'} (
                      {formatToBeDate(rd.readAt)})
                    </span>
                  </div>
                  <div className="font-black text-slate-800">
                    {rd.usageUnits} หน่วย ({rd.previousReading} ➔ {rd.currentReading})
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
