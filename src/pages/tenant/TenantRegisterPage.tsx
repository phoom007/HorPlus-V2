/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Building2, CheckCircle2, User, Phone, FileText, Send, AlertCircle, ArrowLeft } from 'lucide-react';
import { getDataProvider } from '../../data/dataProvider';
import { Room } from '../../types';
import { submitTenantRegistrationRequest } from '../../data/adapters/api';

export const TenantRegisterPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<any | null>(null);

  const [requestedRoomId, setRequestedRoomId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');

  const [hasSigned, setHasSigned] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    const loadRooms = async () => {
      try {
        const allRooms = await getDataProvider().rooms.getAll();
        const vacantRooms = allRooms.filter((r) => r.status === 'vacant');
        setRooms(vacantRooms);
        if (vacantRooms.length > 0) {
          setRequestedRoomId(vacantRooms[0].id);
        }
      } catch (err: any) {
        setErrorText('ไม่สามารถโหลดข้อมูลห้องพักได้');
      } finally {
        setLoading(false);
      }
    };
    loadRooms();
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

    try {
      const res = await submitTenantRegistrationRequest({
        requestedRoomId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        note: note.trim() || undefined,
      });

      if (res.success && res.data) {
        setSuccessData(res.data);
      } else {
        setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการส่งคำขอลงทะเบียน');
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

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 sm:px-6">
      <div className="max-w-xl mx-auto bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 p-6 text-white text-center relative">
          <Building2 className="w-10 h-10 mx-auto mb-2 opacity-90" />
          <h1 className="text-xl font-black">ลงทะเบียนจองห้องพักผู้เช่า (Local Portal)</h1>
          <p className="text-xs text-indigo-150 mt-1">HorPlus-V2 Dormitory Management System</p>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8">
          {successData ? (
            <div className="text-center space-y-4 py-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto animate-bounce" />
              <h2 className="text-lg font-black text-slate-800">ส่งคำขอลงทะเบียนเรียบร้อยแล้ว!</h2>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                คำขอของคุณได้รับการบันทึกเข้าสู่ระบบ PostgreSQL แล้ว อยู่ระหว่างรอเจ้าของหอพักตรวจสอบและอนุมัติ
              </p>
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl text-left text-xs space-y-2 font-mono">
                <div><span className="text-gray-400">Request ID:</span> <span className="font-bold text-indigo-600">{successData.id}</span></div>
                <div><span className="text-gray-400">ชื่อผู้สมัคร:</span> <span className="font-bold">{successData.firstName} {successData.lastName}</span></div>
                <div><span className="text-gray-400">เบอร์โทร:</span> <span className="font-bold">{successData.phone}</span></div>
                <div><span className="text-gray-400">สถานะ:</span> <span className="font-bold text-amber-600 uppercase">{successData.status}</span></div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSuccessData(null);
                  setFirstName('');
                  setLastName('');
                  setPhone('');
                  setNote('');
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
                        ห้อง {r.roomNumber} (ชั้น {r.floor || 1}) - ค่าเช่า ฿{r.price?.toLocaleString() || 4500}/เดือน
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-rose-600 italic">ไม่มีห้องว่างพร้อมให้ลงทะเบียนในขณะนี้</p>
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

              {/* Digital Signature */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-slate-700">ลายมือชื่อดิจิทัล (Digital Signature)</label>
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
                disabled={rooms.length === 0}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
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
