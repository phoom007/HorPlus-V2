import React from 'react';
import { AlertTriangle, RefreshCw, X, RotateCcw } from 'lucide-react';

interface VersionConflictModalProps {
  isOpen: boolean;
  currentVersion?: number;
  onReload: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

export const VersionConflictModal: React.FC<VersionConflictModalProps> = ({
  isOpen,
  currentVersion,
  onReload,
  onCancel,
  onRetry,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="version-conflict-modal">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 border border-amber-200">
        <div className="flex items-center space-x-3 text-amber-600 mb-4">
          <AlertTriangle className="w-8 h-8 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">ตรวจพบการแก้ไขข้อมูลซ้ำซ้อน</h3>
            <p className="text-xs text-gray-500">
              {currentVersion ? `เวอร์ชันปัจจุบันในระบบคือ v${currentVersion}` : 'ข้อมูลถูกแก้ไขโดยผู้อื่นในขณะที่คุณกำลังทำรายการ'}
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          ข้อมูลนี้ถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลล่าสุดก่อนทำรายการใหม่อีกครั้ง เพื่อป้องกันการบันทึกข้อมูลทับซ้อนกัน
        </p>

        <div className="flex flex-col space-y-2">
          <button
            onClick={onReload}
            className="w-full flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors"
            data-testid="btn-reload-latest"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            โหลดข้อมูลล่าสุด
          </button>
          <div className="flex space-x-2">
            <button
              onClick={onRetry}
              className="flex-1 flex items-center justify-center px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md text-sm font-medium transition-colors"
              data-testid="btn-retry-edit"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              ลองแก้ไขใหม่
            </button>
            <button
              onClick={onCancel}
              className="flex-1 flex items-center justify-center px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-md text-sm font-medium transition-colors"
              data-testid="btn-cancel-edit"
            >
              <X className="w-4 h-4 mr-1.5" />
              ยกเลิกการแก้ไข
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
