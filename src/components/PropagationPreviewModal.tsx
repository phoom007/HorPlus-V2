import React from 'react';
import { PropagationPreviewResult } from '../types';
import { Layers, AlertCircle, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { SourceBadge } from './PropertyBadges';

interface PropagationPreviewModalProps {
  isOpen: boolean;
  previewData: PropagationPreviewResult | null;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const PropagationPreviewModal: React.FC<PropagationPreviewModalProps> = ({
  isOpen,
  previewData,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  if (!isOpen || !previewData) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="propagation-preview-modal">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center space-x-2 text-indigo-700">
            <Layers className="w-5 h-5" />
            <h3 className="text-lg font-semibold text-gray-900">พรีวิวผลกระทบการส่งต่อค่าเริ่มต้น (Propagation Preview)</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            &times;
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Summary counters grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-center">
              <div className="text-xs text-gray-500 font-medium">ห้องทั้งหมด</div>
              <div className="text-lg font-bold text-gray-800" data-testid="candidate-room-count">
                {previewData.candidateRoomCount}
              </div>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 text-center">
              <div className="text-xs text-emerald-600 font-medium">ห้องที่ปรับปรุง</div>
              <div className="text-lg font-bold text-emerald-700" data-testid="eligible-room-count">
                {previewData.eligibleRoomCount}
              </div>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
              <div className="text-xs text-blue-600 font-medium">รายการที่เปลี่ยน</div>
              <div className="text-lg font-bold text-blue-700" data-testid="eligible-field-change-count">
                {previewData.eligibleFieldChangeCount}
              </div>
            </div>
            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-center">
              <div className="text-xs text-amber-600 font-medium">ห้องที่ข้าม</div>
              <div className="text-lg font-bold text-amber-700" data-testid="skipped-room-count">
                {previewData.skippedRoomCount}
              </div>
            </div>
            <div className="bg-rose-50 p-3 rounded-lg border border-rose-200 text-center">
              <div className="text-xs text-rose-600 font-medium">รายการที่ข้าม</div>
              <div className="text-lg font-bold text-rose-700" data-testid="skipped-field-change-count">
                {previewData.skippedFieldChangeCount}
              </div>
            </div>
          </div>

          {/* Per-field row effects table */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">รายละเอียดการเปลี่ยนแปลงรายห้อง</h4>
            <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-100 text-gray-700 font-medium sticky top-0">
                  <tr>
                    <th className="p-2.5">ห้อง</th>
                    <th className="p-2.5">ฟิลด์</th>
                    <th className="p-2.5">ค่าเดิม</th>
                    <th className="p-2.5">ค่าใหม่</th>
                    <th className="p-2.5">แหล่งเดิม/ใหม่</th>
                    <th className="p-2.5">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {previewData.fieldEffects.map((item, idx) => (
                    <tr key={idx} className={item.eligible ? 'hover:bg-gray-50' : 'bg-amber-50/40 hover:bg-amber-50/70'} data-testid={`preview-row-${idx}`}>
                      <td className="p-2.5 font-medium text-gray-900">{item.roomNumber}</td>
                      <td className="p-2.5 text-gray-600">{item.field}</td>
                      <td className="p-2.5 text-gray-500">{String(item.oldEffectiveValue ?? '-')}</td>
                      <td className="p-2.5 font-semibold text-gray-800">{String(item.newEffectiveValue ?? '-')}</td>
                      <td className="p-2.5">
                        <div className="flex items-center space-x-1">
                          <SourceBadge source={item.sourceBefore} />
                          <ArrowRight className="w-3 h-3 text-gray-400" />
                          <SourceBadge source={item.sourceAfter} />
                        </div>
                      </td>
                      <td className="p-2.5">
                        {item.eligible ? (
                          <span className="inline-flex items-center text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> เปลี่ยนแปลง
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-amber-700 font-medium" title={item.skipReason}>
                            <XCircle className="w-3.5 h-3.5 mr-1" /> ข้าม ({item.skipReason === 'EXPLICIT_ROOM_OVERRIDE' ? 'มีค่าเฉพาะห้อง' : 'มีสัญญาที่ล็อกค่า'})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end space-x-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors"
            data-testid="btn-cancel-propagation"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading || previewData.eligibleFieldChangeCount === 0}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 flex items-center"
            data-testid="btn-confirm-propagation"
          >
            {isLoading ? 'กำลังนำไปใช้...' : 'ยืนยันและนำไปใช้'}
          </button>
        </div>
      </div>
    </div>
  );
};
