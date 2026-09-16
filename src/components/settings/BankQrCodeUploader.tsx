/**
 * Bank QR Code Uploader Component
 * Provides identical UI across Owner Settings and Dormitory Registration (Step 4).
 * Supports image file upload, drag-and-drop, client-side compression,
 * preview bar with thumbnail, deletion, and full-screen preview modal overlay.
 * @license Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Upload, Trash2, X } from 'lucide-react';

export const compressImage = (
  dataUrl: string,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.75
): Promise<string> => {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      return resolve(dataUrl);
    }
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
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(dataUrl);
        }
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

export interface BankQrCodeUploaderProps {
  qrCodeUrl?: string | null;
  onQrCodeChange: (newUrl: string) => void;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

export const BankQrCodeUploader: React.FC<BankQrCodeUploaderProps> = ({
  qrCodeUrl,
  onQrCodeChange,
  onRemove,
  disabled = false,
  className = '',
  label = 'QRCode ธนาคาร (ไม่บังคับ)',
  onError,
  onSuccess,
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      const err = 'กรุณาเลือกไฟล์รูปภาพ (PNG, JPG, WebP)';
      if (onError) onError(err);
      else alert(err);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const rawDataUrl = (e.target?.result as string) || '';
      try {
        const compressed = await compressImage(rawDataUrl, 800, 800, 0.75);
        onQrCodeChange(compressed);
        if (onSuccess) onSuccess('อัปโหลด QRCode ธนาคารสำเร็จ');
      } catch {
        onQrCodeChange(rawDataUrl);
        if (onSuccess) onSuccess('อัปโหลด QRCode ธนาคารสำเร็จ');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    onQrCodeChange('');
    if (onRemove) onRemove();
  };

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-slate-700">
          {label}
        </label>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        disabled={disabled}
        data-testid="input-bank-qr-file"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
          }
          e.target.value = '';
        }}
      />

      {qrCodeUrl ? (
        <div
          data-testid="container-bank-qr-preview"
          className={`w-full h-10 px-2.5 py-1 border rounded-xl flex items-center justify-between shadow-2xs ${
            disabled ? 'border-slate-200 bg-slate-100 opacity-60' : 'border-indigo-200/90 bg-white'
          }`}
        >
          <button
            type="button"
            disabled={disabled}
            data-testid="btn-bank-qr-preview"
            onClick={() => setIsPreviewOpen(true)}
            className={`flex items-center gap-2 text-left group min-w-0 flex-1 mr-1 ${
              disabled ? 'cursor-not-allowed pointer-events-none' : 'cursor-pointer'
            }`}
            title="คลิกเพื่อดูรูปภาพขนาดเต็ม"
          >
            <img
              src={qrCodeUrl}
              alt="Bank QR Code"
              className="w-7 h-7 object-contain rounded-md border border-slate-200 bg-slate-50 p-0.5 shrink-0 group-hover:scale-105 transition-transform"
              referrerPolicy="no-referrer"
            />
            <span className="font-bold text-slate-700 text-xs truncate group-hover:text-indigo-600 transition-colors">
              มีรูป QRCode แล้ว
            </span>
          </button>
          <button
            type="button"
            disabled={disabled}
            data-testid="btn-bank-qr-remove"
            onClick={handleRemove}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${
              disabled
                ? 'text-slate-300 cursor-not-allowed pointer-events-none'
                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer'
            }`}
            title="ลบรูป QRCode"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          data-testid="btn-bank-qr-upload"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFile(e.dataTransfer.files[0]);
            }
          }}
          className={`w-full h-10 px-3 py-2 border rounded-xl flex items-center justify-center gap-2 transition-all font-bold text-xs group ${
            disabled
              ? 'opacity-50 bg-slate-100 border-slate-200 cursor-not-allowed pointer-events-none text-slate-400'
              : 'border-dashed border-slate-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/40 text-slate-500 hover:text-indigo-600 cursor-pointer'
          }`}
        >
          <Upload className={`w-4 h-4 transition-colors shrink-0 ${disabled ? 'text-slate-300' : 'text-slate-400 group-hover:text-indigo-600'}`} />
          <span className="truncate">อัปโหลดรูปภาพ QRCode</span>
        </button>
      )}

      {/* Full-Screen QR Modal Overlay */}
      {isPreviewOpen && qrCodeUrl && (
        <div
          data-testid="modal-bank-qr-overlay"
          className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200 cursor-zoom-out"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid="btn-close-bank-qr-modal"
              className="absolute -top-10 right-0 z-[10000] text-white/75 hover:text-white transition-all cursor-pointer p-1 hover:scale-110 active:scale-95 flex items-center justify-center"
              onClick={() => setIsPreviewOpen(false)}
              title="ปิด"
            >
              <X className="w-8 h-8 stroke-[1.5]" />
            </button>

            <img
              src={qrCodeUrl}
              alt="QRCode ธนาคารขนาดเต็ม"
              className="max-w-[90vw] md:max-w-lg max-h-[80vh] md:max-h-[85vh] h-auto w-auto rounded-3xl shadow-2xl border border-white/10 select-none cursor-zoom-out transition-transform duration-300 hover:scale-[1.01] bg-white p-3 object-contain"
              onClick={() => setIsPreviewOpen(false)}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
