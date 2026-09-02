/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  HelpCircle,
  Info,
  RotateCw,
  Trash2,
  X,
  Plus,
  ArrowRight,
  Search,
  Filter,
  FileText
} from 'lucide-react';

// Format Helpers
export const formatBaht = (amount: number | string | undefined | null): string => {
  if (amount === undefined || amount === null || amount === '') return '฿\u00A00';
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (isNaN(num)) return '฿\u00A00';
  const isInteger = Number.isInteger(num) || num === Math.floor(num);
  const formatted = new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `฿\u00A0${formatted}`;
};

export const formatThaiDate = (isoString?: string, showTime = false): string => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '-';

  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear() + 543; // Buddhist Era

  let formatted = `${day} ${month} ${year}`;
  if (showTime) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    formatted += ` ${hours}:${minutes} น.`;
  }
  return formatted;
};

export const formatOwnerDate = (isoString?: string, showTime = false): string => {
  return formatThaiDate(isoString, showTime);
};

export const formatOwnerDateTime = (isoString?: string): string => {
  return formatThaiDate(isoString, true);
};

export const formatOwnerMonthYear = (cycleCodeOrIso?: string): string => {
  if (!cycleCodeOrIso) return '-';
  const parts = cycleCodeOrIso.split('-');
  if (parts.length < 2) return cycleCodeOrIso;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return cycleCodeOrIso;
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return `${months[month - 1]} ${year + 543}`;
};

export const formatCycleCode = formatOwnerMonthYear;

export const renderOptionalText = (val: any, fallback = '-'): string => {
  if (val === null || val === undefined) return fallback;
  const s = String(val).trim();
  return s === '' || s === 'ไม่มีข้อมูล' || s === 'ไม่มีบันทึกเพิ่มเติม' ? fallback : s;
};

export const formatMeterReadingDisplay = (val: string | number | null | undefined): string => {
  if (val === null || val === undefined || val === '') return '';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '';
  if (Number.isInteger(num)) {
    return num.toString();
  }
  const str = num.toFixed(2);
  return str.replace(/\.00$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
};

export const formatCountDisplay = (val: string | number | null | undefined): string => {
  if (val === null || val === undefined || val === '') return '0';
  const num = typeof val === 'number' ? val : parseInt(String(val).replace(/,/g, ''), 10);
  return isNaN(num) ? '0' : Math.max(0, num).toString();
};

export const normalizeMoneyInput = (val: string | number | null | undefined): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const clean = String(val).replace(/,/g, '').trim();
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
};

export const normalizeSingleDigitCount = (input: string | number): number => {
  if (typeof input === 'number') return Math.min(9, Math.max(0, Math.floor(input)));
  const digits = String(input).replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const lastDigit = digits[digits.length - 1];
  const parsed = parseInt(lastDigit, 10);
  return isNaN(parsed) ? 0 : Math.min(9, Math.max(0, parsed));
};

// Toast State Controller
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  removeToast: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />,
    error: <X className="w-5 h-5 text-rose-500 shrink-0" />,
    info: <Info className="w-5 h-5 text-blue-500 shrink-0" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
  };

  const bgColors = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-950',
    error: 'bg-rose-50 border-rose-200 text-rose-950',
    info: 'bg-blue-50 border-blue-200 text-blue-950',
    warning: 'bg-amber-50 border-amber-200 text-amber-950'
  };

  return (
    <div className={`pointer-events-auto flex gap-3 p-4 rounded-xl border shadow-lg transition-all duration-300 transform translate-y-0 ${bgColors[toast.type]}`}>
      {icons[toast.type]}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm leading-tight">{toast.title}</h4>
        {toast.message && <p className="text-xs mt-1 opacity-85 leading-normal">{toast.message}</p>}
      </div>
      <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

// StatusBadge
interface StatusBadgeProps {
  status: string;
  type: 'room' | 'bill' | 'contract' | 'maintenance' | 'urgency';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type }) => {
  let label = status;
  let classes = 'bg-gray-100 text-gray-700 border-gray-200';

  if (type === 'room') {
    switch (status) {
      case 'vacant':
        label = 'ว่าง';
        classes = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        break;
      case 'occupied':
        label = 'มีผู้เช่า';
        classes = 'bg-indigo-50 text-indigo-700 border-indigo-200';
        break;
      case 'reserved':
        label = 'จองแล้ว';
        classes = 'bg-amber-50 text-amber-700 border-amber-200';
        break;
      case 'maintenance':
        label = 'ปิดปรับปรุง';
        classes = 'bg-rose-50 text-rose-700 border-rose-200';
        break;
    }
  } else if (type === 'bill') {
    switch (status) {
      case 'draft':
        label = 'ยังไม่ออกบิล';
        classes = 'bg-gray-100 text-gray-600 border-gray-200';
        break;
      case 'pending':
        label = 'รอชำระเงิน';
        classes = 'bg-amber-50 text-amber-700 border-amber-200';
        break;
      case 'checking':
        label = 'รอตรวจสอบสลิป';
        classes = 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse';
        break;
      case 'paid':
        label = 'ชำระเงินแล้ว';
        classes = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        break;
      case 'overdue':
        label = 'เกินกำหนด';
        classes = 'bg-rose-50 text-rose-700 border-rose-200';
        break;
      case 'rejected':
        label = 'ปฏิเสธ (สลิปผิดพลาด)';
        classes = 'bg-red-50 text-red-700 border-red-200';
        break;
      case 'cancelled':
        label = 'ยกเลิกแล้ว';
        classes = 'bg-gray-200 text-gray-500 border-gray-300';
        break;
    }
  } else if (type === 'contract') {
    switch (status) {
      case 'draft':
        label = 'ร่างสัญญา';
        classes = 'bg-gray-100 text-gray-600 border-gray-200';
        break;
      case 'pending_signature':
        label = 'รอลงนาม';
        classes = 'bg-amber-50 text-amber-700 border-amber-200';
        break;
      case 'active':
        label = 'ใช้งานอยู่';
        classes = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        break;
      case 'expiring_soon':
        label = 'ใกล้หมดอายุ';
        classes = 'bg-rose-50 text-rose-700 border-rose-200';
        break;
      case 'expired':
        label = 'หมดอายุแล้ว';
        classes = 'bg-gray-200 text-gray-500 border-gray-300';
        break;
      case 'terminated':
        label = 'ยกเลิกก่อนกำหนด';
        classes = 'bg-red-100 text-red-700 border-red-200';
        break;
      case 'waiting_extension':
        label = 'รอต่อสัญญา';
        classes = 'bg-blue-50 text-blue-700 border-blue-200';
        break;
    }
  } else if (type === 'maintenance') {
    switch (status) {
      case 'submitted':
        label = 'ส่งเรื่องใหม่';
        classes = 'bg-blue-50 text-blue-700 border-blue-200';
        break;
      case 'accepted':
        label = 'รับเรื่องแล้ว';
        classes = 'bg-purple-50 text-purple-700 border-purple-200';
        break;
      case 'more_info':
        label = 'ขอข้อมูลเพิ่ม';
        classes = 'bg-amber-50 text-amber-700 border-amber-200';
        break;
      case 'scheduled':
        label = 'นัดหมายช่างแล้ว';
        classes = 'bg-cyan-50 text-cyan-700 border-cyan-200';
        break;
      case 'inprogress':
        label = 'กำลังซ่อมแซม';
        classes = 'bg-indigo-50 text-indigo-700 border-indigo-200';
        break;
      case 'waiting_parts':
        label = 'รออะไหล่';
        classes = 'bg-yellow-50 text-yellow-700 border-yellow-200';
        break;
      case 'completed':
        label = 'เสร็จสิ้น';
        classes = 'bg-emerald-50 text-emerald-700 border-emerald-200';
        break;
      case 'cancelled':
        label = 'ยกเลิกแล้ว';
        classes = 'bg-gray-100 text-gray-500 border-gray-300';
        break;
    }
  } else if (type === 'urgency') {
    switch (status) {
      case 'low':
        label = 'ปกติ / ทั่วไป';
        classes = 'bg-gray-100 text-gray-700 border-gray-300';
        break;
      case 'medium':
        label = 'ปานกลาง';
        classes = 'bg-amber-50 text-amber-700 border-amber-200';
        break;
      case 'high':
        label = 'ด่วน';
        classes = 'bg-rose-50 text-rose-700 border-rose-200';
        break;
      case 'emergency':
        label = 'ด่วนที่สุด!';
        classes = 'bg-red-500 text-white border-transparent animate-bounce';
        break;
    }
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 ${classes}`}>
      {label}
    </span>
  );
};

// StatCard
interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  onClick?: () => void;
  accentColor?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, description, onClick, accentColor = 'indigo' }) => {
  const borderColors: { [key: string]: string } = {
    indigo: 'border-l-indigo-500',
    emerald: 'border-l-emerald-500',
    rose: 'border-l-rose-500',
    amber: 'border-l-amber-500',
    cyan: 'border-l-cyan-500',
    slate: 'border-l-slate-500'
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white p-5 rounded-2xl border border-gray-100 border-l-4 ${borderColors[accentColor] || 'border-l-indigo-500'} shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer flex justify-between items-start`}
    >
      <div className="space-y-1">
        <p className="text-gray-500 text-xs font-medium">{title}</p>
        <p className="text-2xl font-semibold text-gray-900 tracking-tight">{value}</p>
        {description && <p className="text-gray-400 text-[10px] mt-1">{description}</p>}
      </div>
      <div className={`p-2.5 rounded-xl bg-${accentColor}-50 text-${accentColor}-600`}>
        {icon}
      </div>
    </div>
  );
};

// EmptyState
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, actionText, onAction }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white border border-dashed border-gray-200 rounded-3xl text-center max-w-lg mx-auto my-8">
      <div className="p-4 bg-gray-50 text-gray-400 rounded-full mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">{description}</p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors shadow-sm text-sm"
        >
          <Plus className="w-4 h-4" />
          {actionText}
        </button>
      )}
    </div>
  );
};

// ConfirmDialog
interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'primary';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'ยืนยัน',
  cancelText = 'ยกเลิก',
  type = 'primary'
}) => {
  if (!isOpen) return null;

  const colors = {
    primary: {
      btn: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      iconBg: 'bg-indigo-50 text-indigo-600',
      icon: <Info className="w-6 h-6" />
    },
    warning: {
      btn: 'bg-amber-600 hover:bg-amber-700 text-white',
      iconBg: 'bg-amber-50 text-amber-600',
      icon: <AlertTriangle className="w-6 h-6" />
    },
    danger: {
      btn: 'bg-rose-600 hover:bg-rose-700 text-white',
      iconBg: 'bg-rose-50 text-rose-600',
      icon: <Trash2 className="w-6 h-6" />
    }
  };

  const renderFormattedMessage = (msg: string) => {
    if (!msg) return null;
    const blocks = msg.split('\n\n').filter(Boolean);

    if (blocks.length === 1 && !msg.includes('\n')) {
      return <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mt-1.5">{msg}</p>;
    }

    return (
      <div className="space-y-2.5 mt-2">
        {blocks.map((block, bIdx) => {
          const lines = block.split('\n').filter(l => l.trim().length > 0);
          const isBulletList = lines.length > 0 && lines.every(l => {
            const trimmed = l.trim();
            return trimmed.startsWith('•') || trimmed.startsWith('·') || trimmed.startsWith('-');
          });

          if (isBulletList) {
            return (
              <div key={bIdx} className="bg-rose-50/80 border border-rose-100 rounded-2xl p-3 my-1">
                <ul className="space-y-1.5">
                  {lines.map((line, lIdx) => {
                    const textContent = line.trim().replace(/^[•·-]\s*/, '');
                    return (
                      <li key={lIdx} className="flex items-start gap-2 text-xs font-semibold text-rose-950 leading-snug">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 mt-1.5" />
                        <span>{textContent}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          }

          return (
            <p key={bIdx} className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
              {block}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-xs" onClick={onClose} />

      {/* Panel */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-slate-100 max-w-md w-full relative z-10 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex gap-3.5 items-start">
          <div className={`p-3 rounded-2xl shrink-0 ${colors[type].iconBg}`}>
            {colors[type].icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-black text-slate-900 leading-tight">{title}</h3>
            {renderFormattedMessage(message)}
          </div>
        </div>
        <div className="flex gap-2.5 mt-6 justify-end items-center">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-xs sm:text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl transition-all cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-5 py-2.5 text-xs sm:text-sm font-extrabold rounded-xl transition-all shadow-xs cursor-pointer ${colors[type].btn}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// Modal
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  transparentBg?: boolean;
  hideHeader?: boolean;
  zIndex?: string;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, size = 'md', transparentBg = false, hideHeader = false, zIndex = 'z-[500]' }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full m-4 h-[calc(100vh-32px)]'
  };

  return (
    <div className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 overflow-hidden`}>
      {/* Overlay */}
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} />

      {/* Content wrapper */}
      <div className={`${transparentBg ? 'bg-transparent border-transparent shadow-none' : 'bg-white border-gray-100 shadow-2xl'} rounded-3xl overflow-hidden w-full relative z-10 flex flex-col ${sizes[size]} animate-in fade-in duration-200 transform zoom-in-95 max-h-[90vh]`}>
        {/* Header */}
        {!hideHeader && (
          <div className="flex justify-between items-center p-5 border-b border-gray-100 shrink-0 bg-white rounded-t-3xl">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-50 text-gray-400 hover:text-gray-600 rounded-full transition-colors cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className={`${transparentBg ? 'p-0' : 'p-6'} overflow-y-auto flex-1 min-h-0`}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-4 bg-white border-t border-gray-100 shrink-0 rounded-b-3xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// SignaturePad Canvas Helper
interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear?: () => void;
  placeholder?: string;
  saveButtonText?: string;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({
  onSave,
  onClear,
  placeholder = 'ลงลายเซ็นที่นี่ (ใช้เมาส์หรือนิ้วลาก)',
  saveButtonText = 'บันทึกลายเซ็น'
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#312e81'; // Deep Indigo
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, []);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    // Support Touch & Mouse coordinates correctly inside iframe
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
      setHasDrawn(true);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (canvas && hasDrawn) {
      onSave(canvas.toDataURL());
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasDrawn(false);
        if (onClear) onClear();
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative border border-dashed border-gray-300 rounded-2xl overflow-hidden bg-slate-50">
        <canvas
          ref={canvasRef}
          width={400}
          height={160}
          className="w-full h-40 cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        <div className="absolute top-2 left-2 pointer-events-none text-[10px] text-gray-400 bg-white/80 px-2 py-0.5 rounded-full border border-gray-100">
          {placeholder}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={clearCanvas}
          disabled={!hasDrawn}
          className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-transparent rounded-xl transition-colors cursor-pointer font-semibold"
        >
          ล้างรูปภาพ
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasDrawn}
          className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          <span>{saveButtonText}</span>
        </button>
      </div>
    </div>
  );
};

// Stepper
interface StepperProps {
  steps: string[];
  currentStep: number;
}

export const Stepper: React.FC<StepperProps> = ({ steps, currentStep }) => {
  return (
    <div className="flex items-center w-full mb-6">
      {steps.map((step, idx) => {
        const isCompleted = idx < currentStep;
        const isActive = idx === currentStep;
        return (
          <React.Fragment key={idx}>
            {/* Step Circle */}
            <div className="flex flex-col items-center relative z-10">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-xs transition-colors border ${
                  isCompleted
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : isActive
                    ? 'bg-white border-indigo-600 text-indigo-600 shadow-sm font-semibold'
                    : 'bg-white border-gray-200 text-gray-400'
                }`}
              >
                {isCompleted ? <CheckCircle className="w-5 h-5 text-white" /> : idx + 1}
              </div>
              <span
                className={`text-[10px] mt-2 whitespace-nowrap absolute top-8 font-medium ${
                  isActive ? 'text-indigo-600 font-semibold' : isCompleted ? 'text-slate-700' : 'text-gray-400'
                }`}
              >
                {step}
              </span>
            </div>
            {/* Line connector */}
            {idx < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 transition-colors ${
                  idx < currentStep ? 'bg-indigo-600' : 'bg-gray-100'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Timeline for Maintenance
interface TimelineItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  user: string;
  statusIcon?: React.ReactNode;
}

export const Timeline: React.FC<{ items: TimelineItem[] }> = ({ items }) => {
  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {items.map((item, itemIdx) => (
          <li key={item.id}>
            <div className="relative pb-8">
              {itemIdx !== items.length - 1 ? (
                <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
              ) : null}
              <div className="relative flex space-x-3">
                <div>
                  <span className="h-8 w-8 rounded-full bg-slate-50 border border-gray-100 flex items-center justify-center ring-8 ring-white text-indigo-600 shrink-0">
                    {item.statusIcon || <Clock className="w-4 h-4 text-indigo-500" />}
                  </span>
                </div>
                <div className="flex-1 min-w-0 pt-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{item.title}</p>
                    <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                      {formatThaiDate(item.timestamp, true)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{item.description}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-1">ผู้ทำรายการ: {item.user}</p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export { OwnerDateInput, isoToThaiBe, thaiBeToIso } from './OwnerDateInput';
import { OwnerDateInput } from './OwnerDateInput';

// Thai DatePicker Wrapper (Buddhist Era)
interface ThaiDatePickerProps {
  value: string; // ISO date format YYYY-MM-DD
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}

export const ThaiDatePicker: React.FC<ThaiDatePickerProps> = ({
  value,
  onChange,
  label,
  required = false,
  min,
  max,
  disabled = false,
  className,
}) => {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-gray-700 truncate">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <OwnerDateInput
        value={value}
        onChange={onChange}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        className={className}
      />
    </div>
  );
};

// CurrencyInput
interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  required?: boolean;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({ value, onChange, label, required = false }) => {
  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/[^0-9.]/g, '');
    const num = parseFloat(rawValue);
    onChange(isNaN(num) ? 0 : num);
  };

  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-gray-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div className="relative rounded-xl shadow-xs">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span className="text-gray-400 text-xs font-medium">฿</span>
        </div>
        <input
          type="text"
          value={value || ''}
          onChange={handleNumberChange}
          placeholder="0.00"
          className="block w-full pl-7 pr-3 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white text-gray-800 text-sm font-medium"
        />
      </div>
    </div>
  );
};

// PrintView
interface PrintViewProps {
  children: React.ReactNode;
  title?: string;
  headerLeft?: React.ReactNode;
}

export const PrintView: React.FC<PrintViewProps> = ({ children, title = 'พิมพ์เอกสาร', headerLeft }) => {
  const contentRef = React.useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!contentRef.current) return;

    // Remove any pre-existing print container/styles idempotently
    const oldRoot = document.getElementById('horplus-print-root');
    if (oldRoot) oldRoot.remove();
    const oldStyle = document.getElementById('horplus-print-style');
    if (oldStyle) oldStyle.remove();

    // Create top-level print root attached directly to document.body
    const printRoot = document.createElement('div');
    printRoot.id = 'horplus-print-root';
    printRoot.className = 'printable-area';
    printRoot.innerHTML = contentRef.current.innerHTML;
    document.body.appendChild(printRoot);

    // Add print styles to isolate horplus-print-root and ensure single A4 page formatting
    const style = document.createElement('style');
    style.id = 'horplus-print-style';
    style.innerHTML = `
      @media print {
        body > *:not(#horplus-print-root) {
          display: none !important;
        }
        html, body {
          background: #ffffff !important;
          color: #0f172a !important;
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        #horplus-print-root,
        #horplus-print-root * {
          visibility: visible !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        #horplus-print-root {
          display: block !important;
          position: static !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 auto !important;
          padding: 0 !important;
          background: #ffffff !important;
          box-shadow: none !important;
          border: none !important;
          overflow: visible !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        #horplus-print-root .printable-area {
          background: #ffffff !important;
          box-shadow: none !important;
          border: none !important;
          padding: 0 !important;
          margin: 0 auto !important;
          max-width: 100% !important;
          overflow: visible !important;
        }
        @page {
          size: A4 portrait;
          margin: 12mm 15mm;
        }
      }
    `;
    document.head.appendChild(style);

    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      const root = document.getElementById('horplus-print-root');
      if (root) root.remove();
      const st = document.getElementById('horplus-print-style');
      if (st) st.remove();
    };

    window.addEventListener('afterprint', cleanup);

    // Trigger browser print on next frame after layout reflow
    requestAnimationFrame(() => {
      window.print();
    });
  };

  return (
    <div className="space-y-4">
      <div className={`flex ${headerLeft ? 'justify-between' : 'justify-end'} items-center print:hidden`}>
        {headerLeft && <div>{headerLeft}</div>}
        <button
          type="button"
          onClick={handlePrint}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          {title}
        </button>
      </div>
      <div
        ref={contentRef}
        className="printable-area print:bg-white print:p-0 print:m-0 print:shadow-none bg-slate-50 p-6 rounded-3xl border border-gray-100 shadow-inner overflow-hidden max-w-[21cm] mx-auto text-gray-900 font-sans"
      >
        {children}
      </div>
    </div>
  );
};

export { formatBillingUnit, formatBillingQuantity, formatBillingRate, resolveBillingDisplayUnit, isNonZeroAmount, filterNonZeroBillItems } from '../types';
