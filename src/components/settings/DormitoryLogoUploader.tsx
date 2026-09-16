/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Upload, Trash2, Loader2 } from 'lucide-react';
import { queryClient, queryKeys } from '../../lib/queryClient';
import { onboardingClient } from '../../data/onboardingClient';
import { LogoEditorModal } from '../LogoEditorModal';

export interface DormitoryLogoUploaderProps {
  provisionalDormitoryId?: string | null;
  dormitoryId?: string | null;
  dormName?: string;
  ensureProvisionalDormitoryId?: () => Promise<string>;
  logoUrl: string | null;
  onLogoChange: (newLogoUrl: string | null) => void;
  onError?: (msg: string) => void;
}

export const DormitoryLogoUploader: React.FC<DormitoryLogoUploaderProps> = ({
  provisionalDormitoryId,
  dormitoryId,
  dormName,
  ensureProvisionalDormitoryId,
  logoUrl,
  onLogoChange,
  onError,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolveDormitoryId = async (): Promise<string | null> => {
    if (ensureProvisionalDormitoryId) {
      return await ensureProvisionalDormitoryId();
    }
    const id = dormitoryId || provisionalDormitoryId ||
      localStorage.getItem('selected_dormitory_id') ||
      sessionStorage.getItem('active_dormitory_selected_for_session');
    return id || null;
  };

  const handleFile = (file: File) => {
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      if (onError) onError('รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPG และ WebP เท่านั้น');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      if (onError) onError('ขนาดไฟล์ต้องไม่เกิน 5MB');
      return;
    }

    // Open Logo Editor instead of immediate upload
    setEditorFile(file);
    setIsEditorOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmEdit = async (processedFile: File) => {
    try {
      setIsUploading(true);
      const dormId = await resolveDormitoryId();
      if (dormId) {
        const res = await onboardingClient.uploadLogo(dormId, processedFile);
        if (!res?.logoUrl) {
          throw new Error('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ');
        }

        onLogoChange(`${res.logoUrl}?t=${Date.now()}`);
        setIsEditorOpen(false);
        setEditorFile(null);

        // Invalidate dormitories query cache for immediate Dormitory Picker refresh
        queryClient.invalidateQueries({ queryKey: queryKeys.dormitories });
        queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.dormitory(dormId) });
      } else {
        // Standalone or local preview fallback
        const reader = new FileReader();
        reader.onload = () => {
          onLogoChange(reader.result as string);
          setIsEditorOpen(false);
          setEditorFile(null);
        };
        reader.readAsDataURL(processedFile);
      }
    } catch (err: any) {
      console.error('[LOGO_UPLOAD_FAILED]', err);
      if (onError) {
        onError(err.message || 'ไม่สามารถอัปโหลดโลโก้ได้ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    try {
      setIsUploading(true);
      const dormId = await resolveDormitoryId();
      if (dormId) {
        await onboardingClient.deleteLogo(dormId);
        onLogoChange(null);

        // Invalidate dormitories query cache for immediate Dormitory Picker fallback refresh
        queryClient.invalidateQueries({ queryKey: queryKeys.dormitories });
        queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.dormitory(dormId) });
      } else {
        onLogoChange(null);
      }
    } catch (err: any) {
      console.error('[LOGO_DELETE_FAILED]', err);
      if (onError) {
        onError(err.message || 'ไม่สามารถลบโลโก้ได้ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold text-slate-700">
          โลโก้หอพัก <span className="text-[10px] text-slate-400 font-normal">(ไม่บังคับ)</span>
        </label>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {logoUrl ? (
        <div
          onClick={() => !isUploading && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`flex items-center gap-3 p-3 bg-white border-2 rounded-2xl cursor-pointer transition ${isDragOver ? 'border-blue-500 bg-blue-50/50' : 'border-slate-200 hover:border-blue-400'
            } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div className="w-16 h-16 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
            <img src={logoUrl} alt="Dormitory Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-800">มีโลโก้หอพักแล้ว</p>
            <p className="text-[10px] text-slate-400">คลิกหรือลากไฟล์ใหม่มาวางที่นี่เพื่อเปลี่ยนรูปภาพ</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={isUploading}
              className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition cursor-pointer shrink-0"
            >
              เปลี่ยนรูป
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              disabled={isUploading}
              className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer shrink-0"
              title="ลบโลโก้"
              aria-label="ลบโลโก้"
            >
              <Trash2 className="w-4 h-4" />
              <span className="sr-only">ลบโลโก้</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !isUploading && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1.5 ${isDragOver
            ? 'border-blue-500 bg-blue-50/50'
            : 'border-slate-200 hover:border-blue-400 bg-white hover:bg-slate-50/50'
            } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          ) : (
            <Upload className="w-6 h-6 text-slate-400" />
          )}
          <div className="text-xs font-bold text-slate-700">
            {isUploading ? 'กำลังอัปโหลด...' : 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่'}
          </div>
          <div className="text-[10px] text-slate-400">รองรับไฟล์ PNG, JPG หรือ WebP ขนาดไม่เกิน 5MB</div>
        </div>
      )}

      <LogoEditorModal
        isOpen={isEditorOpen}
        imageFile={editorFile}
        onClose={() => {
          setIsEditorOpen(false);
          setEditorFile(null);
        }}
        onConfirm={handleConfirmEdit}
        isSubmitting={isUploading}
      />
    </div>
  );
};
