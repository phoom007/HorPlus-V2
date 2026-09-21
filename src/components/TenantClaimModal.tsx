/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * TenantClaimModal (LOCAL-07 Batch 02)
 * Privacy-masked candidate discovery & single-input tenant self-claim modal.
 */

import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, UserCheck, Phone, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { httpRequest } from '../data/httpClient';

interface TenantClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  dormitoryId: string;
  roomNumber: string;
  roomId?: string;
  initialClaimInput?: string;
  allowAdditionalRoom?: boolean;
  onSuccess: (message: string) => void;
}

export const TenantClaimModal: React.FC<TenantClaimModalProps> = ({
  isOpen,
  onClose,
  dormitoryId,
  roomNumber,
  roomId,
  initialClaimInput,
  allowAdditionalRoom = false,
  onSuccess,
}) => {
  const [loadingCandidate, setLoadingCandidate] = useState(false);
  const [candidate, setCandidate] = useState<any | null>(null);
  const [claimInput, setClaimInput] = useState(initialClaimInput || '');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Drag-to-dismiss gesture state
  const [startY, setStartY] = useState<number | null>(null);
  const [currentTranslateY, setCurrentTranslateY] = useState<number>(0);
  const isDraggingRef = useRef(false);
  const startYRef = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    setStartY(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || startYRef.current === null) return;
    const deltaY = e.clientY - startYRef.current;
    setCurrentTranslateY(deltaY > 0 ? deltaY : 0);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (currentTranslateY > 80) {
      onClose();
    }
    setStartY(null);
    setCurrentTranslateY(0);
    startYRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
    startYRef.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const deltaY = e.touches[0].clientY - startYRef.current;
    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      setCurrentTranslateY(deltaY);
    } else {
      setCurrentTranslateY(0);
    }
  };

  const handleTouchEnd = () => {
    if (currentTranslateY > 80) {
      onClose();
    }
    setStartY(null);
    setCurrentTranslateY(0);
    startYRef.current = null;
  };

  // Fetch candidate discovery
  useEffect(() => {
    if (isOpen && (roomNumber || roomId)) {
      setClaimInput(initialClaimInput || '');
      setErrorText(null);
      setCandidate(null);
      setLoadingCandidate(true);
      const dormId = dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');
      const query = new URLSearchParams();
      if (dormId) query.set('dormitoryId', dormId);
      if (roomNumber) query.set('roomNumber', roomNumber);
      if (roomId) query.set('roomId', roomId);

      httpRequest<any>('GET', `/api/v1/tenant-claims/candidate?${query.toString()}`)
        .then((res: any) => {
          if (res.data?.hasCandidate) {
            setCandidate(res.data);
          } else {
            setCandidate(null);
          }
        })
        .catch(() => {
          setCandidate(null);
        })
        .finally(() => {
          setLoadingCandidate(false);
        });
    }
  }, [isOpen, dormitoryId, roomNumber, roomId]);

  if (!isOpen) return null;

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimInput.trim()) {
      setErrorText('กรุณากรอกชื่อ-นามสกุล หรือ เบอร์โทรศัพท์');
      return;
    }

    setSubmitting(true);
    setErrorText(null);

    try {
      await httpRequest('POST', '/api/v1/tenant-claims/claim', {
        dormitoryId,
        roomNumber,
        roomId: roomId || undefined,
        claimInput: claimInput.trim(),
        allowAdditionalRoom: allowAdditionalRoom || undefined,
      });

      onSuccess('ยืนยันสิทธิ์ผู้เช่าสำเร็จเรียบร้อยแล้ว');
      onClose();
    } catch (err: any) {
      setErrorText(err.message || 'ไม่พบข้อมูลผู้เช่าที่ตรงกับข้อมูลที่ระบุ');
    } finally {
      setSubmitting(false);
    }
  };

  const backdropOpacity = Math.max(0, 1 - currentTranslateY / 320);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      style={{ opacity: backdropOpacity }}
    >
      <div
        data-testid="tenant-claim-bottom-sheet"
        data-modal-container="true"
        id="tenant-claim-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: `translateY(${currentTranslateY}px)`,
          transition: startY !== null || isDraggingRef.current ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="bg-white rounded-t-[32px] rounded-b-none shadow-2xl max-w-md w-full mx-auto overflow-hidden border-t border-slate-100 max-h-[90vh] flex flex-col animate-in slide-in-from-bottom duration-300"
      >
        {/* Mobile Drag Handle Bar */}
        <div
          data-testid="bottom-sheet-grab-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="pt-3.5 pb-2 flex justify-center bg-indigo-50/50 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <div className="w-12 h-1.5 bg-slate-300 rounded-full" />
        </div>

        {/* Header (No 'X' button, matches other bottom sheets) */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
          <div>
            <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              <span>ยืนยันสิทธิ์ผู้เช่าห้อง {roomNumber || candidate?.roomNumber || ''}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              ยืนยันตัวตนเพื่อเชื่อมต่อบัญชีเข้ากับห้องพัก
            </p>
          </div>
        </div>

        {/* Error notification */}
        {errorText && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs font-bold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{errorText}</span>
          </div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {loadingCandidate ? (
            <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <span>กำลังตรวจสอบข้อมูลห้องพัก...</span>
            </div>
          ) : candidate ? (
            <>
              {/* Masked candidate info box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  ข้อมูลผู้เช่าที่ลงทะเบียนไว้ในระบบ
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">ชื่อ-นามสกุล:</span>
                  <span className="font-extrabold text-slate-800 text-sm">
                    {candidate.maskedName}
                  </span>
                </div>
                {candidate.maskedPhone && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-bold">เบอร์โทรศัพท์:</span>
                    <span className="font-bold text-slate-700">{candidate.maskedPhone}</span>
                  </div>
                )}
              </div>

              {/* Single Claim Input */}
              <form onSubmit={handleSubmitClaim} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    กรอกชื่อ-นามสกุล หรือ เบอร์โทรศัพท์เต็มของคุณ <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น นายสมชาย ใจดี หรือ 083-123-4567"
                    value={claimInput}
                    onChange={(e) => setClaimInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    ระบบจะจับคู่ข้อมูลอย่างปลอดภัยเพื่อยืนยันว่าคุณคือผู้เช่าห้องนี้จริง
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    data-testid="tenant-claim-submit-btn"
                    disabled={submitting}
                    className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-600/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>กำลังยืนยันสิทธิ์...</span>
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>ยืนยันสิทธิ์ผู้เช่า</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="p-6 text-center text-slate-500 bg-slate-50 border border-slate-100 rounded-2xl">
              <p className="font-bold">ไม่พบข้อมูลผู้เช่าที่รอเชื่อมต่อในห้องพักนี้</p>
              <p className="text-[11px] text-slate-400 mt-1">
                หากท่านเป็นผู้เช่าใหม่ กรุณาติดต่อเจ้าของหอพักเพื่อลงทะเบียนเข้าพัก
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
