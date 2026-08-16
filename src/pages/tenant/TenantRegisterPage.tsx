/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Building2, CheckCircle2, User, Phone, FileText, Send, AlertCircle, ArrowLeft, ShieldCheck, Heart } from 'lucide-react';
import { getDataProvider } from '../../data/dataProvider';
import { Room } from '../../types';
import { submitTenantRegistrationRequest, getPublicDormitoryPolicy } from '../../data/adapters/api';

export const TenantRegisterPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<any | null>(null);

  const [policyData, setPolicyData] = useState<{
    dormitoryId: string;
    dormitoryName: string;
    defaultTerms: string;
    petPolicy: { allowed: string; allowedTypes?: string[] };
    version: number;
  }>({
    dormitoryId: '',
    dormitoryName: 'HorPlus Dormitory',
    defaultTerms: '',
    petPolicy: { allowed: 'none', allowedTypes: [] },
    version: 1,
  });

  const [requestedRoomId, setRequestedRoomId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [hasSigned, setHasSigned] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const allRooms = await getDataProvider().rooms.getAll();
      const vacantRooms = allRooms.filter((r) => r.status === 'vacant');
      setRooms(vacantRooms);
      if (vacantRooms.length > 0) {
        setRequestedRoomId(vacantRooms[0].id);
      }

      const policyRes = await getPublicDormitoryPolicy();
      if (policyRes.success && policyRes.data) {
        setPolicyData(policyRes.data);
      }
    } catch (err: any) {
      setErrorText('ไม่สามารถโหลดข้อมูลห้องพักหรือเงื่อนไขหอพักได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    setHasSigned(true);
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!requestedRoomId || !firstName.trim() || !lastName.trim() || !phone.trim()) {
      setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
      return;
    }

    if (!agreedTerms) {
      setErrorText('กรุณายอมรับกฎระเบียบและเงื่อนไขของหอพักก่อนส่งคำขอลงทะเบียน');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !hasSigned) {
      setErrorText('กรุณาลงลายมือชื่อดิจิทัลก่อนส่งคำขอลงทะเบียน');
      return;
    }

    const signatureBase64 = canvas.toDataURL('image/png');

    try {
      const res = await submitTenantRegistrationRequest({
        requestedRoomId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        note: note.trim() || undefined,
        agreedTerms: true,
        signatureBase64,
        expectedPolicyVersion: policyData.version,
      });

      if (res.success && res.data) {
        setSuccessData(res.data);
      } else {
        if (res.error?.code === 'POLICY_VERSION_MISMATCH') {
          setErrorText('กฎระเบียบหรือเงื่อนไขของหอพักมีการเปลี่ยนแปลง กรุณาตรวจสอบเงื่อนไขใหม่และส่งคำขออีกครั้ง');
          await loadData();
        } else {
          setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการส่งคำขอลงทะเบียน');
        }
      }
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-slate-500 font-bold text-sm">กำลังโหลดข้อมูลหอพัก...</p>
      </div>
    );
  }

  // Pet Policy label helper
  const petPolicyAllowed = policyData.petPolicy?.allowed === 'conditional' || policyData.petPolicy?.allowed === 'all';
  const petTypesText = Array.isArray(policyData.petPolicy?.allowedTypes) && policyData.petPolicy.allowedTypes.length > 0
    ? policyData.petPolicy.allowedTypes.map(t => {
      if (t === 'dog') return 'สุนัข';
      if (t === 'cat') return 'แมว';
      if (t === 'small_pet') return 'สัตว์เลี้ยงขนาดเล็ก';
      if (t === 'other') return 'อื่นๆ';
      return t;
    }).join(', ')
    : 'ไม่มีการระบุประเภท';

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 sm:px-6">
      <div className="max-w-xl mx-auto bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 p-6 text-white text-center relative">
          <Building2 className="w-10 h-10 mx-auto mb-2 opacity-90" />
          <h1 className="text-xl font-black">{policyData.dormitoryName || 'ลงทะเบียนจองห้องพักผู้เช่า'}</h1>
          <p className="text-xs text-indigo-150 mt-1">HorPlus-V2 Tenant Registration Portal</p>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8">
          {successData ? (
            <div className="text-center space-y-4 py-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto animate-bounce" />
              <h2 className="text-lg font-black text-slate-800">ส่งคำขอลงทะเบียนเรียบร้อยแล้ว!</h2>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                คำขอของคุณได้รับการบันทึกเข้าสู่ระบบ พร้อมบันทึกลายเซ็นและบันทึกประวัติการยอมรับเงื่อนไขเรียบร้อยแล้ว อยู่ระหว่างรอเจ้าของหอพักตรวจสอบและอนุมัติ
              </p>
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl text-left text-xs space-y-2 font-mono">
                <div><span className="text-gray-400">Request ID:</span> <span className="font-bold text-indigo-600">{successData.id}</span></div>
                <div><span className="text-gray-400">ชื่อผู้สมัคร:</span> <span className="font-bold">{successData.firstName} {successData.lastName}</span></div>
                <div><span className="text-gray-400">เบอร์โทร:</span> <span className="font-bold">{successData.phone}</span></div>
                <div><span className="text-gray-400">สถานะ:</span> <span className="font-bold text-amber-600 uppercase">{successData.status}</span></div>
                {successData.acceptanceSnapshotSha256 && (
                  <div><span className="text-gray-400">Snapshot SHA-256:</span> <span className="font-mono text-[10px] text-slate-500 block truncate">{successData.acceptanceSnapshotSha256}</span></div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSuccessData(null);
                  setFirstName('');
                  setLastName('');
                  setPhone('');
                  setNote('');
                  setAgreedTerms(false);
                  clearSignature();
                }}
                className="w-full py-3 bg-indigo-600 text-white font-bold text-xs rounded-xl hover:bg-indigo-700 transition-all"
              >
                ส่งคำขออื่นเพิ่มเติม
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorText && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorText}</span>
                </div>
              )}

              {/* Select Room */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">เลือกห้องพักที่ต้องการจอง *</label>
                {rooms.length > 0 ? (
                  <select
                    value={requestedRoomId}
                    onChange={(e) => setRequestedRoomId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl bg-white font-medium focus:ring-2 focus:ring-indigo-500"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        ห้อง {r.roomNumber} (ชั้น {r.floor || 1}) - ค่าเช่า ฿{(r.monthlyRent || (r as any).price)?.toLocaleString() || 4500}/เดือน
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={requestedRoomId}
                    onChange={(e) => setRequestedRoomId(e.target.value)}
                    placeholder="ระบุรหัสห้องพัก (เช่น A101)"
                    className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl bg-white font-medium focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>

              {/* Applicant Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อ *</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="สมชาย"
                    className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">นามสกุล *</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="ใจดี"
                    className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">เบอร์โทรศัพท์ติดต่อ *</label>
                <input
                  type="tel"
                  required
                  maxLength={12}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="0812345678"
                  className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">หมายเหตุเพิ่มเติม</label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ประสงค์ย้ายเข้าช่วงต้นเดือนหน้า..."
                  className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Dorm Rules & Pet Policy Section */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>กฎระเบียบและข้อกำหนดของหอพัก</span>
                </div>

                {/* Pet Policy */}
                <div className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Heart className="w-3.5 h-3.5 text-rose-500" />
                    <span className="font-bold text-slate-700">นโยบายสัตว์เลี้ยง:</span>
                  </div>
                  <span className={`font-bold px-2 py-0.5 rounded-md text-[11px] ${petPolicyAllowed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}>
                    {petPolicyAllowed ? `อนุญาต (${petTypesText})` : 'ไม่อนุญาตให้เลี้ยงสัตว์'}
                  </span>
                </div>

                {/* Rules Text */}
                <div className="p-3 bg-white border border-slate-200 rounded-xl max-h-36 overflow-y-auto text-xs text-slate-600 leading-relaxed font-sans whitespace-pre-line">
                  {policyData.defaultTerms || `1. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง
2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.
3. ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา
4. ห้ามนำบุคคลภายนอกมาพักค้างคืนโดยไม่แจ้งให้ทราบ
5. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพัก`}
                </div>

                {/* Acceptance Checkbox */}
                <label className="flex items-start gap-2.5 cursor-pointer pt-1 select-none">
                  <input
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={(e) => setAgreedTerms(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                  />
                  <span className="text-xs font-bold text-slate-800">
                    ข้าพเจ้าได้อ่านและยอมรับกฎระเบียบและเงื่อนไขของหอพัก <span className="text-rose-500">*</span>
                  </span>
                </label>
              </div>

              {/* Digital Signature */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    ลายมือชื่อดิจิทัลของผู้เช่า (Digital Signature) <span className="text-rose-500">*</span>
                  </label>
                  {hasSigned && (
                    <button type="button" onClick={clearSignature} className="text-[10px] text-rose-500 font-bold hover:underline">
                      ล้างลายเซ็น
                    </button>
                  )}
                </div>
                <div className="border-2 border-dashed border-gray-300 rounded-2xl bg-slate-50 relative overflow-hidden">
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={120}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-28 cursor-crosshair touch-none"
                  />
                  {!hasSigned && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-gray-400 text-xs font-medium">
                      เซ็นลายมือชื่อด้วยเมาส์หรือนิ้วมือที่นี่
                    </div>
                  )}
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={!requestedRoomId || !firstName || !lastName || !phone || !agreedTerms || !hasSigned}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                <span>ยืนยันและส่งคำขอลงทะเบียน</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default TenantRegisterPage;
