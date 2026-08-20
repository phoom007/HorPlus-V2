import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bill, Room } from '../../types';
import { queryKeys, STALE_TIMES } from '../../lib/queryClient';
import { fetchAllPaginated } from '../../utils/fetch-paginated';
import { formatBaht } from '../../components/GlobalComponents';
import { CheckCircle, XCircle, FileText, Image as ImageIcon, RotateCcw, AlertCircle, Loader2 } from 'lucide-react';

export interface PaymentRecord {
  id: string;
  dormitoryId: string;
  billId: string;
  tenantId?: string;
  method: 'BANK_TRANSFER' | 'CASH' | 'PROMPTPAY';
  amount: number | string;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'REVERSED';
  paymentDate: string;
  evidenceUrl?: string;
  fileHash?: string;
  rejectedReason?: string;
  reversalReason?: string;
  reviewedAt?: string;
  createdAt: string;
  bill?: {
    id: string;
    billNumber: string;
    totalAmount: number | string;
    status: string;
    room?: { roomNumber: string };
    tenant?: { name: string; displayName?: string };
  };
  receipt?: {
    id: string;
    receiptNumber: string;
    isVoided: boolean;
  };
}

export async function fetchPayments(dormitoryId: string): Promise<PaymentRecord[]> {
  const pRes = await fetch(`/api/v1/payments?dormitoryId=${dormitoryId}`, {
    headers: { 'Accept': 'application/json', 'x-dormitory-id': dormitoryId },
    credentials: 'include',
  });
  if (!pRes.ok) {
    const errData = await pRes.json().catch(() => ({}));
    throw new Error(errData.error || `ไม่สามารถโหลดข้อมูลการชำระเงินได้ (HTTP ${pRes.status})`);
  }
  const pData = await pRes.json();
  return Array.isArray(pData) ? pData : (pData.data || []);
}

export async function fetchDailyInvoices(dormitoryId: string): Promise<any[]> {
  const dRes = await fetch(`/api/v1/daily-stays/invoices?dormitoryId=${dormitoryId}`, {
    headers: { 'Accept': 'application/json', 'x-dormitory-id': dormitoryId },
    credentials: 'include',
  });
  if (!dRes.ok) {
    const errData = await dRes.json().catch(() => ({}));
    throw new Error(errData.error || `ไม่สามารถโหลดข้อมูลบิลรายวันได้ (HTTP ${dRes.status})`);
  }
  const dData = await dRes.json();
  return Array.isArray(dData?.data) ? dData.data : (Array.isArray(dData) ? dData : []);
}

export function PaymentsOwnerView({
  bills: initialBills,
  rooms: _rooms,
  dormitoryId,
  onUpdateBills
}: {
  bills: Bill[];
  rooms: Room[];
  dormitoryId: string;
  onUpdateBills?: () => void;
}) {
  const queryClient = useQueryClient();
  const dormHeader = dormitoryId ? { 'x-dormitory-id': dormitoryId } : undefined;

  const [activeTab, setActiveTab] = useState<'checking' | 'cash' | 'paid'>(() => {
    return (localStorage.getItem('payments_active_tab') as any) || 'checking';
  });

  const paymentsQuery = useQuery({
    queryKey: queryKeys.payments(dormitoryId),
    queryFn: () => fetchPayments(dormitoryId),
    enabled: Boolean(dormitoryId),
    staleTime: STALE_TIMES.PAYMENTS,
  });

  const billsQuery = useQuery({
    queryKey: queryKeys.bills(dormitoryId),
    queryFn: () => fetchAllPaginated<Bill>('/api/v1/bills', { headers: dormHeader, credentials: 'include' }),
    enabled: Boolean(dormitoryId),
    staleTime: STALE_TIMES.BILLS,
  });

  const dailyInvoicesQuery = useQuery({
    queryKey: queryKeys.dailyInvoices(dormitoryId),
    queryFn: () => fetchDailyInvoices(dormitoryId),
    enabled: Boolean(dormitoryId),
    staleTime: STALE_TIMES.DAILY_INVOICES,
  });

  const payments: PaymentRecord[] = paymentsQuery.data || [];
  const bills: Bill[] = billsQuery.data || initialBills || [];
  const dailyInvoices: any[] = dailyInvoicesQuery.data || [];
  const loading = (paymentsQuery.isLoading && !paymentsQuery.data) || (billsQuery.isLoading && !billsQuery.data) || (dailyInvoicesQuery.isLoading && !dailyInvoicesQuery.data);
  const queryError = paymentsQuery.error ? (paymentsQuery.error as Error).message : billsQuery.error ? (billsQuery.error as Error).message : dailyInvoicesQuery.error ? (dailyInvoicesQuery.error as Error).message : null;

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const error = actionError || queryError;

  // Modal States
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reverseReason, setReverseReason] = useState('');
  const [evidenceBlobUrl, setEvidenceBlobUrl] = useState<string | null>(null);

  // Stable Idempotency Keys map (operationId -> idempotencyKey)
  const idempotencyKeysRef = useRef<Record<string, string>>({});

  const getIdempotencyKey = (opId: string): string => {
    if (!idempotencyKeysRef.current[opId]) {
      idempotencyKeysRef.current[opId] = crypto.randomUUID();
    }
    return idempotencyKeysRef.current[opId];
  };

  const clearIdempotencyKey = (opId: string) => {
    delete idempotencyKeysRef.current[opId];
  };

  const refetchPaymentsAndBills = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.payments(dormitoryId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bills(dormitoryId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dailyInvoices(dormitoryId) }),
    ]);
  };

  const showToast = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const getCsrfToken = () => {
    const match = document.cookie.match(/(?:csrf-token|horplus_csrf)=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  };
  // 1. Approve Payment (Server-confirmed only, stable idempotency key)
  const handleApprove = async (paymentId: string) => {
    const opKey = `approve-${paymentId}`;
    const idempKey = getIdempotencyKey(opKey);
    setActionLoading(paymentId);
    setActionError(null);

    try {
      const res = await fetch(`/api/v1/payments/${paymentId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrfToken(),
          'x-idempotency-key': idempKey
        }
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `การอนุมัติล้มเหลว (HTTP ${res.status})`);
      }

      clearIdempotencyKey(opKey);
      showToast('อนุมัติการชำระเงินและออกใบเสร็จรับเงินเรียบร้อยแล้ว');
      await refetchPaymentsAndBills();
      if (onUpdateBills) onUpdateBills();
    } catch (err: any) {
      setActionError(err.message || 'เกิดข้อผิดพลาดในการอนุมัติ');
    } finally {
      setActionLoading(null);
    }
  };

  // 2. Reject Payment (Server-confirmed only, stable idempotency key)
  const handleReject = async () => {
    if (!selectedPayment || !rejectReason.trim()) return;
    const paymentId = selectedPayment.id;
    const opKey = `reject-${paymentId}`;
    const idempKey = getIdempotencyKey(opKey);
    setActionLoading(paymentId);
    setActionError(null);

    try {
      const res = await fetch(`/api/v1/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrfToken(),
          'x-idempotency-key': idempKey
        },
        body: JSON.stringify({ reason: rejectReason.trim() })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `การปฏิเสธล้มเหลว (HTTP ${res.status})`);
      }

      clearIdempotencyKey(opKey);
      showToast('ปฏิเสธการชำระเงินเรียบร้อยแล้ว');
      setRejectModalOpen(false);
      setSelectedPayment(null);
      setRejectReason('');
      await refetchPaymentsAndBills();
      if (onUpdateBills) onUpdateBills();
    } catch (err: any) {
      setActionError(err.message || 'เกิดข้อผิดพลาดในการปฏิเสธ');
    } finally {
      setActionLoading(null);
    }
  };

  // 3. Record Cash (Server-confirmed only, stable idempotency key)
  const handleRecordCash = async (bill: Bill) => {
    const opKey = `cash-${bill.id}`;
    const idempKey = getIdempotencyKey(opKey);
    setActionLoading(bill.id);
    setActionError(null);

    try {
      const res = await fetch('/api/v1/payments/cash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrfToken(),
          'x-idempotency-key': idempKey
        },
        body: JSON.stringify({
          dormitoryId,
          billId: bill.id,
          amount: String(bill.totalAmount)
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `บันทึกรับเงินสดล้มเหลว (HTTP ${res.status})`);
      }

      clearIdempotencyKey(opKey);
      showToast('บันทึกรับเงินสดและออกใบเสร็จรับเงินสำเร็จ');
      await refetchPaymentsAndBills();
      if (onUpdateBills) onUpdateBills();
    } catch (err: any) {
      setActionError(err.message || 'เกิดข้อผิดพลาดในการบันทึกเงินสด');
    } finally {
      setActionLoading(null);
    }
  };

  // 4. Reverse Payment (Server-confirmed only, stable idempotency key)
  const handleReverse = async () => {
    if (!selectedPayment || !reverseReason.trim()) return;
    const paymentId = selectedPayment.id;
    const opKey = `reverse-${paymentId}`;
    const idempKey = getIdempotencyKey(opKey);
    setActionLoading(paymentId);
    setActionError(null);

    try {
      const res = await fetch(`/api/v1/payments/${paymentId}/reverse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrfToken(),
          'x-idempotency-key': idempKey
        },
        body: JSON.stringify({ reason: reverseReason.trim() })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `การย้อนกลับรายการล้มเหลว (HTTP ${res.status})`);
      }

      clearIdempotencyKey(opKey);
      showToast('ย้อนกลับรายการชำระเงินและยกเลิกใบเสร็จเรียบร้อยแล้ว');
      setReverseModalOpen(false);
      setSelectedPayment(null);
      setReverseReason('');
      await refetchPaymentsAndBills();
      if (onUpdateBills) onUpdateBills();
    } catch (err: any) {
      setActionError(err.message || 'เกิดข้อผิดพลาดในการย้อนกลับรายการ');
    } finally {
      setActionLoading(null);
    }
  };

  // 5. Preview Evidence
  const handlePreviewEvidence = async (payment: PaymentRecord) => {
    setSelectedPayment(payment);
    setEvidenceBlobUrl(null);
    setEvidenceModalOpen(true);
    try {
      const res = await fetch(`/api/v1/payments/${payment.id}/evidence`);
      if (res.ok) {
        const blob = await res.blob();
        setEvidenceBlobUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      console.error('Failed to load evidence image', err);
    }
  };

  // Only render authoritative records from backend
  const checkingPayments = payments.filter(p => p.status === 'PENDING' || p.status === 'UNDER_REVIEW');
  const unpaidBills = bills.filter(b => {
    const s = (b.status || '').toLowerCase();
    const hasActivePayment = payments.some(p => p.billId === b.id && ['PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(p.status));
    return (s === 'unpaid' || s === 'pending' || s === 'overdue' || s === 'issued' || s === 'published') && !hasActivePayment;
  });
  const paidPayments = payments.filter(p => p.status === 'APPROVED');

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">รับชำระเงิน</h1>
          <p className="text-sm font-bold text-slate-500 mt-1">ตรวจสอบสลิปโอนเงิน บันทึกเงินสด และจัดการใบเสร็จรับเงิน</p>
        </div>
      </div>

      {/* Toast Notifications */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-sm font-bold animate-in fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between gap-3 text-rose-800 text-sm font-bold animate-in fade-in">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => refetchPaymentsAndBills()}
            className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-900 text-xs font-black rounded-lg transition-colors border border-rose-300 shrink-0"
          >
            ลองใหม่ (Retry)
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-white rounded-2xl p-1.5 shadow-xs border border-slate-200">
        <button
          onClick={() => { setActiveTab('checking'); localStorage.setItem('payments_active_tab', 'checking'); }}
          className={`flex-1 py-2.5 px-4 text-xs sm:text-sm font-black rounded-xl transition-all ${
            activeTab === 'checking' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          รอตรวจสอบ ({checkingPayments.length})
        </button>
        <button
          onClick={() => { setActiveTab('cash'); localStorage.setItem('payments_active_tab', 'cash'); }}
          className={`flex-1 py-2.5 px-4 text-xs sm:text-sm font-black rounded-xl transition-all ${
            activeTab === 'cash' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          บันทึกเงินสด ({unpaidBills.length})
        </button>
        <button
          onClick={() => { setActiveTab('paid'); localStorage.setItem('payments_active_tab', 'paid'); }}
          className={`flex-1 py-2.5 px-4 text-xs sm:text-sm font-black rounded-xl transition-all ${
            activeTab === 'paid' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          ชำระแล้ว ({paidPayments.length})
        </button>
      </div>

      {/* Content Container */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[300px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <span className="font-bold text-sm">กำลังโหลดข้อมูล...</span>
          </div>
        ) : (
          <>
            {/* 1. Checking Tab */}
            {activeTab === 'checking' && (
              <div className="p-6">
                <h3 className="font-extrabold text-slate-800 mb-4 text-base">สลิปที่รอการตรวจสอบ</h3>
                {checkingPayments.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <p className="font-bold text-sm">ไม่มีสลิปที่รอตรวจสอบในขณะนี้</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {checkingPayments.map(p => (
                      <div key={p.id} className="border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-indigo-200 transition-all bg-slate-50/50">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-base">บิลเลขที่: {p.bill?.billNumber || p.billId.substring(0, 8)}</span>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">รอตรวจสอบ</span>
                          </div>
                          <p className="text-xs font-bold text-slate-500">
                            ห้อง: <span className="text-slate-700">{p.bill?.room?.roomNumber || 'N/A'}</span> • ผู้เช่า: <span className="text-slate-700">{p.bill?.tenant?.name || p.bill?.tenant?.displayName || 'ผู้เช่า'}</span>
                          </p>
                          <p className="text-xs font-bold text-slate-500">
                            ยอดเงิน: <span className="text-indigo-600 font-extrabold text-sm">{formatBaht(Number(p.amount))}</span> • วันที่โอน: {new Date(p.paymentDate).toLocaleDateString('th-TH')}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 w-full md:w-auto">
                          {p.evidenceUrl && (
                            <button
                              onClick={() => handlePreviewEvidence(p)}
                              className="flex-1 md:flex-none flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all"
                            >
                              <ImageIcon className="w-4 h-4" /> ดูสลิป
                            </button>
                          )}
                          <button
                            disabled={actionLoading !== null}
                            onClick={() => handleApprove(p.id)}
                            className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-black shadow-xs transition-all active:scale-95 disabled:opacity-50"
                          >
                            {actionLoading === p.id ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
                          </button>
                          <button
                            disabled={actionLoading !== null}
                            onClick={() => { setSelectedPayment(p); setRejectModalOpen(true); }}
                            className="flex-1 md:flex-none bg-rose-100 hover:bg-rose-200 text-rose-700 px-4 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. Cash Recording Tab */}
            {activeTab === 'cash' && (
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="font-extrabold text-slate-800 mb-4 text-base">บิลรายเดือนที่ยังไม่ชำระ (บันทึกรับเงินสด)</h3>
                  {unpaidBills.length === 0 ? (
                    <div className="text-center py-8 text-slate-400">
                      <p className="font-bold text-sm">ไม่มีบิลค้างชำระ</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {unpaidBills.map(bill => (
                        <div key={bill.id} className="border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-indigo-200 transition-all bg-white">
                          <div className="space-y-1">
                            <p className="font-black text-slate-900 text-base">บิลเลขที่: {bill.billNumber || bill.id.substring(0, 8)}</p>
                            <p className="text-xs font-bold text-slate-500">
                              ยอดเงิน: <span className="text-indigo-600 font-extrabold text-sm">{formatBaht(bill.totalAmount)}</span>
                            </p>
                          </div>
                          <button
                            disabled={actionLoading !== null}
                            onClick={() => handleRecordCash(bill)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-xs transition-all active:scale-95 disabled:opacity-50"
                          >
                            {actionLoading === bill.id ? 'กำลังบันทึก...' : 'รับเงินสด'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Daily Stay Invoices (Presentation Only - LOCAL-07 Batch 02) */}
                {dailyInvoices.length > 0 && (
                  <div className="pt-6 border-t border-slate-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                          รายวัน
                        </span>
                        <h3 className="font-extrabold text-slate-800 text-base">
                          ใบแจ้งหนี้ห้องพักรายวัน ({dailyInvoices.length})
                        </h3>
                      </div>
                      <span className="text-xs text-slate-400 font-medium">แสดงยอดตามข้อตกลงและยอดค้างชำระ</span>
                    </div>

                    <div className="space-y-3">
                      {dailyInvoices.map((inv: any) => (
                        <div
                          key={inv.id}
                          className="border border-amber-200/80 bg-amber-50/30 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-amber-300 transition-all"
                        >
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-black text-slate-900 text-base">
                                ใบแจ้งหนี้: {inv.invoiceNumber}
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                                รายวัน
                              </span>
                              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                inv.depositDeclaredStatus === 'PAID'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}>
                                มัดจำ: {inv.depositDeclaredStatus === 'PAID' ? 'จ่ายแล้ว (แจ้งไว้)' : 'ยังไม่จ่าย'}
                              </span>
                            </div>

                            <p className="text-xs font-bold text-slate-600">
                              ห้อง: <span className="text-indigo-600 font-extrabold">{inv.dailyStay?.room?.roomNumber || '-'}</span> • ผู้พัก: <span className="text-slate-800 font-extrabold">{inv.dailyStay?.tenant?.displayName || inv.dailyStay?.applicantFullName || '-'}</span>
                              {inv.dailyStay && (
                                <span className="text-slate-500 font-normal ml-2">
                                  (วันที่ {inv.dailyStay.startDate?.slice(0, 10)} ถึง {inv.dailyStay.endDate?.slice(0, 10)} รวม {inv.dailyStay.inclusiveDayCount} วัน)
                                </span>
                              )}
                            </p>

                            <div className="flex items-center gap-4 text-xs font-semibold text-slate-600 pt-1 flex-wrap">
                              <span>ค่าเช่ารายวัน: <strong className="text-slate-800">{formatBaht(Number(inv.totalRentAmount))}</strong></span>
                              <span>เงินประกัน/มัดจำ: <strong className="text-slate-800">{formatBaht(Number(inv.depositAmount))}</strong></span>
                              <span>ยอดตามข้อตกลง: <strong className="text-amber-900">{formatBaht(Number(inv.totalAgreedAmount))}</strong></span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-[11px] font-bold text-slate-500 block">ยอดคงเหลือที่ต้องชำระ</span>
                            <span className="text-lg font-black text-indigo-700">{formatBaht(Number(inv.outstandingAmount))}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3. Paid & Receipts Tab */}
            {activeTab === 'paid' && (
              <div className="p-6">
                <h3 className="font-extrabold text-slate-800 mb-4 text-base">ประวัติการรับชำระเงินที่อนุมัติแล้ว</h3>
                {paidPayments.length === 0 ? (
                  <div className="text-center py-16 text-slate-400">
                    <p className="font-bold text-sm">ยังไม่มีรายการรับชำระเงินที่อนุมัติแล้ว</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {paidPayments.map(p => (
                      <div key={p.id} className="border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-emerald-200 transition-all bg-emerald-50/20">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-base">บิลเลขที่: {p.bill?.billNumber || p.billId.substring(0, 8)}</span>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">ชำระแล้ว</span>
                            {p.receipt && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                {p.receipt.receiptNumber}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-slate-500">
                            ห้อง: <span className="text-slate-700">{p.bill?.room?.roomNumber || 'N/A'}</span> • ผู้เช่า: <span className="text-slate-700">{p.bill?.tenant?.name || p.bill?.tenant?.displayName || 'ผู้เช่า'}</span>
                          </p>
                          <p className="text-xs font-bold text-slate-500">
                            ยอดเงิน: <span className="text-emerald-700 font-black">{formatBaht(Number(p.amount))}</span> • ช่องทาง: {p.method === 'CASH' ? 'เงินสด' : 'โอนเงิน'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 w-full md:w-auto">
                          {p.receipt && (
                            <a
                              href={`/api/v1/receipts/${p.receipt.id}/html`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border border-indigo-200"
                            >
                              <FileText className="w-4 h-4" /> ดูใบเสร็จ
                            </a>
                          )}
                          <button
                            disabled={actionLoading !== null}
                            onClick={() => { setSelectedPayment(p); setReverseModalOpen(true); }}
                            className="flex items-center gap-1 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 px-3.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> ยกเลิก/ย้อนกลับ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModalOpen && selectedPayment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600">
              <XCircle className="w-6 h-6" />
              <h3 className="text-lg font-black text-slate-900">ปฏิเสธสลิปโอนเงิน</h3>
            </div>
            <p className="text-xs text-slate-500 font-bold">
              ระบุเหตุผลในการปฏิเสธ เพื่อแจ้งให้ผู้เช่าทราบและส่งหลักฐานใหม่:
            </p>
            <textarea
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:border-rose-500 focus:outline-none ring-rose-100 focus:ring-3 font-medium"
              rows={3}
              placeholder="เช่น ยอดเงินไม่ตรง, สลิปซ้ำ, สลิปไม่ชัดเจน..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setRejectModalOpen(false); setSelectedPayment(null); setRejectReason(''); }}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || actionLoading !== null}
                onClick={handleReject}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl transition-all disabled:opacity-50 shadow-xs"
              >
                {actionLoading ? 'กำลังส่งข้อมูล...' : 'ยืนยันปฏิเสธ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reverse Modal */}
      {reverseModalOpen && selectedPayment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-amber-600">
              <RotateCcw className="w-6 h-6" />
              <h3 className="text-lg font-black text-slate-900">ย้อนกลับรายการรับชำระเงิน</h3>
            </div>
            <p className="text-xs text-slate-500 font-bold">
              การย้อนกลับจะยกเลิกใบเสร็จรับเงิน (Void) และเปลี่ยนสถานะบิลกลับเป็นค้างชำระ:
            </p>
            <textarea
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:border-amber-500 focus:outline-none ring-amber-100 focus:ring-3 font-medium"
              rows={3}
              placeholder="ระบุเหตุผลในการยกเลิกหรือย้อนกลับรายการ..."
              value={reverseReason}
              onChange={e => setReverseReason(e.target.value)}
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setReverseModalOpen(false); setSelectedPayment(null); setReverseReason(''); }}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={!reverseReason.trim() || actionLoading !== null}
                onClick={handleReverse}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl transition-all disabled:opacity-50 shadow-xs"
              >
                {actionLoading ? 'กำลังส่งข้อมูล...' : 'ยืนยันย้อนกลับรายการ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evidence Preview Modal */}
      {evidenceModalOpen && selectedPayment && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-black text-slate-900">หลักฐานสลิปโอนเงิน</h3>
              <button
                onClick={() => { setEvidenceModalOpen(false); setSelectedPayment(null); setEvidenceBlobUrl(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <div className="rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 min-h-[250px] flex items-center justify-center">
              {evidenceBlobUrl ? (
                <img src={evidenceBlobUrl} alt="Payment Slip Evidence" className="max-h-[400px] w-auto object-contain mx-auto" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  <span className="text-xs font-bold">กำลังโหลดรูปสลิป...</span>
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => { setEvidenceModalOpen(false); setSelectedPayment(null); setEvidenceBlobUrl(null); }}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-black rounded-xl"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
