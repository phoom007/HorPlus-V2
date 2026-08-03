import React, { useState, useEffect } from 'react';
import { Bill, Payment, Room } from '../../types';
import { StatusBadge, formatBaht, formatThaiDate } from '../../components/GlobalComponents';
import { Search, Filter, CheckCircle, XCircle, FileText, Banknote } from 'lucide-react';
import { api } from '../../lib/api';

export function PaymentsOwnerView({
  bills,
  rooms,
  dormitoryId,
  onUpdateBills
}: {
  bills: Bill[];
  rooms: Room[];
  dormitoryId: string;
  onUpdateBills?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'checking' | 'cash' | 'paid'>(() => {
    return (localStorage.getItem('payments_active_tab') as any) || 'checking';
  });

  const [loading, setLoading] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const checkingBills = bills.filter(b => b.status === 'checking');
  const unpaidBills = bills.filter(b => b.status === 'pending' || b.status === 'overdue' || b.status === 'unpaid');
  const paidBills = bills.filter(b => b.status === 'paid');

  const handleApprove = async (billId: string) => {
    setLoading(true);
    try {
      alert('Approved ' + billId);
      if (onUpdateBills) onUpdateBills();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason) return;
    setLoading(true);
    try {
      alert('Rejected ' + selectedBillId + ' for ' + rejectReason);
      setRejectModalOpen(false);
      setRejectReason('');
      if (onUpdateBills) onUpdateBills();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">รับชำระเงิน</h1>
          <p className="text-sm font-bold text-slate-500 mt-1">ตรวจสอบสลิปและบันทึกรับเงิน</p>
        </div>
      </div>

      <div className="flex bg-white rounded-2xl p-1.5 shadow-xs border border-slate-200">
        <button
          onClick={() => { setActiveTab('checking'); localStorage.setItem('payments_active_tab', 'checking'); }}
          className={`flex-1 py-2.5 px-4 text-xs sm:text-sm font-black rounded-xl transition-all ${
            activeTab === 'checking' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          รอตรวจสอบ ({checkingBills.length})
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
          ชำระแล้ว ({paidBills.length})
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {activeTab === 'checking' && (
          <div className="p-6">
            <h3 className="font-extrabold text-slate-800 mb-4">สลิปที่รอการตรวจสอบ</h3>
            {checkingBills.length === 0 ? (
              <p className="text-slate-400 text-sm py-8 text-center">ไม่มีสลิปที่รอตรวจสอบ</p>
            ) : (
              <div className="space-y-4">
                {checkingBills.map(bill => (
                  <div key={bill.id} className="border border-slate-200 rounded-2xl p-4 flex justify-between items-center">
                    <div>
                      <p className="font-bold text-slate-800">บิลเลขที่: {bill.id.substring(0, 8)}</p>
                      <p className="text-sm text-slate-500">ยอดเงิน: {formatBaht(bill.totalAmount)}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(bill.id)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all">
                        อนุมัติ
                      </button>
                      <button onClick={() => { setSelectedBillId(bill.id); setRejectModalOpen(true); }} className="bg-rose-100 text-rose-700 hover:bg-rose-200 px-4 py-2 rounded-xl text-xs font-bold transition-all">
                        ปฏิเสธ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Similar stubs for 'cash' and 'paid' tabs would go here */}
        {activeTab === 'cash' && (
          <div className="p-6">
            <h3 className="font-extrabold text-slate-800 mb-4">บิลที่ยังไม่ชำระ</h3>
            {unpaidBills.map(bill => (
              <div key={bill.id} className="border border-slate-200 rounded-2xl p-4 flex justify-between items-center mb-2">
                <div>
                  <p className="font-bold text-slate-800">บิลเลขที่: {bill.id.substring(0, 8)}</p>
                  <p className="text-sm text-slate-500">ยอดเงิน: {formatBaht(bill.totalAmount)}</p>
                </div>
                <button onClick={() => { alert('รับเงินสด'); }} className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-4 py-2 rounded-xl text-xs font-bold transition-all">
                  รับเงินสด
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {rejectModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6">
            <h3 className="text-lg font-black text-slate-900 mb-4">ปฏิเสธสลิปโอนเงิน</h3>
            <textarea
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:border-rose-500 focus:outline-none"
              rows={4}
              placeholder="ระบุเหตุผลที่ปฏิเสธ..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setRejectModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-xl">ยกเลิก</button>
              <button onClick={handleReject} disabled={!rejectReason} className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl disabled:opacity-50">ยืนยันการปฏิเสธ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
