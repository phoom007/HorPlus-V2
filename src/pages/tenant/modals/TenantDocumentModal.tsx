/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Modals: Document Viewer & Download (ดูและดาวน์โหลดเอกสาร)
 * Refactored to Mobile Bottom Sheet with soft neutral minimal styling and no 'X' button.
 */

import React from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { TenantBottomSheet } from '../components/TenantBottomSheet';

export interface TenantDocumentModalProps {
  selectedDocModal: {
    title: string;
    subtitle: string;
    category: string;
    fileName: string;
    content: string;
    docType?: string;
    docId?: string;
    pdfUrl?: string;
  } | null;
  onClose: () => void;
  handleDownloadDoc: (title: string, fileName: string, content: string, docType?: string, docId?: string) => void;
}

export const TenantDocumentModal: React.FC<TenantDocumentModalProps> = ({
  selectedDocModal,
  onClose,
  handleDownloadDoc,
}) => {
  if (!selectedDocModal) return null;

  const isPdf = selectedDocModal.fileName?.endsWith('.pdf') || selectedDocModal.category?.includes('สัญญา') || Boolean(selectedDocModal.pdfUrl);

  const handleOpenPdf = () => {
    if (selectedDocModal.pdfUrl) {
      window.open(selectedDocModal.pdfUrl, '_blank');
    } else {
      window.open('/api/v1/tenant-portal/contract/pdf', '_blank');
    }
  };

  return (
    <TenantBottomSheet
      isOpen={Boolean(selectedDocModal)}
      onClose={onClose}
      title={selectedDocModal.category}
      maxHeightClass="max-h-[85vh]"
    >
      <div className="space-y-4 font-sans text-xs">
        <div className="border-b border-slate-100 pb-2">
          <h4 className="font-extrabold text-slate-900 text-sm">{selectedDocModal.title}</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">{selectedDocModal.subtitle}</p>
        </div>

        {/* Minimal soft neutral document preview card (replacing old bg-slate-900) */}
        <div className="p-4 bg-slate-50 text-slate-800 rounded-2xl text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto border border-slate-200/80 shadow-2xs">
          {selectedDocModal.content}
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            ปิด
          </button>

          <div className="flex items-center gap-2">
            {isPdf && (
              <button
                type="button"
                onClick={handleOpenPdf}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>เปิดดู PDF</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                handleDownloadDoc(
                  selectedDocModal.title,
                  selectedDocModal.fileName,
                  selectedDocModal.content,
                  selectedDocModal.docType,
                  selectedDocModal.docId
                )
              }
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4 stroke-[2]" />
              <span>ดาวน์โหลดเอกสาร</span>
            </button>
          </div>
        </div>
      </div>
    </TenantBottomSheet>
  );
};
