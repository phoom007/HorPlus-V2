/**
 * @license Apache-2.0
 * HORPLUS-V2 Owner Round 2.4I: Logo Editor Modal
 * Crop, Pan, Zoom (50%–300%), Rotate (90° steps), Live Previews & Binary Blob/File Export.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  RotateCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  Building2,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';

export interface LogoEditorModalProps {
  isOpen: boolean;
  imageFile: File | null;
  onClose: () => void;
  onConfirm: (processedFile: File) => Promise<void> | void;
  isSubmitting?: boolean;
}

const CROP_SIZE = 280; // Size of the square crop preview workspace in px
const EXPORT_SIZE = 512; // High-resolution export dimension in px

export function getClampedPan(
  pan: { x: number; y: number },
  zoom: number,
  rotation: number,
  imageElement: HTMLImageElement | null
): { x: number; y: number } {
  if (!imageElement) return { x: 0, y: 0 };

  const isRotated90or270 = rotation === 90 || rotation === 270;
  const naturalW = isRotated90or270 ? imageElement.height : imageElement.width;
  const naturalH = isRotated90or270 ? imageElement.width : imageElement.height;
  const aspect = naturalW / naturalH;

  let baseW = CROP_SIZE;
  let baseH = CROP_SIZE;
  if (aspect > 1) {
    baseW = CROP_SIZE * aspect;
  } else {
    baseH = CROP_SIZE / aspect;
  }

  const scale = Math.max(1, zoom / 100);
  const currentW = baseW * scale;
  const currentH = baseH * scale;

  const maxPanX = Math.max(0, (currentW - CROP_SIZE) / 2);
  const maxPanY = Math.max(0, (currentH - CROP_SIZE) / 2);

  return {
    x: Math.min(maxPanX, Math.max(-maxPanX, pan.x)),
    y: Math.min(maxPanY, Math.max(-maxPanY, pan.y)),
  };
}

export const LogoEditorModal: React.FC<LogoEditorModalProps> = ({
  isOpen,
  imageFile,
  onClose,
  onConfirm,
  isSubmitting = false,
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);

  // Transform states
  const [zoom, setZoom] = useState<number>(100); // 50% to 300%
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270

  // Dragging state (Pointer Events)
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  // Dedicated preview state (object URL generated from rendering)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const prevPreviewUrlRef = useRef<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1. Load image when file changes
  useEffect(() => {
    if (!imageFile) {
      setImageSrc(null);
      setImageElement(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setImageSrc(objectUrl);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImageElement(img);
      // Reset transformations on new image load
      setZoom(100);
      setPan({ x: 0, y: 0 });
      setRotation(0);
    };
    img.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);

  // 2. Render canvas helper
  const drawToCanvas = useCallback(
    (canvas: HTMLCanvasElement, targetSize: number) => {
      if (!imageElement) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = targetSize;
      canvas.height = targetSize;

      ctx.clearRect(0, 0, targetSize, targetSize);

      ctx.save();
      // Move origin to center of target canvas
      ctx.translate(targetSize / 2, targetSize / 2);

      // Apply rotation (degrees to radians)
      ctx.rotate((rotation * Math.PI) / 180);

      // Scale factor
      const effectiveZoom = Math.max(100, zoom);
      const scale = effectiveZoom / 100;
      ctx.scale(scale, scale);

      // Apply clamped pan scaled relative to targetSize vs CROP_SIZE
      const clamped = getClampedPan(pan, effectiveZoom, rotation, imageElement);
      const panScale = targetSize / CROP_SIZE;
      const effectivePanX = (rotation === 90 ? clamped.y : rotation === 180 ? -clamped.x : rotation === 270 ? -clamped.y : clamped.x) * panScale;
      const effectivePanY = (rotation === 90 ? -clamped.x : rotation === 180 ? -clamped.y : rotation === 270 ? clamped.x : clamped.y) * panScale;

      // Calculate base image dimensions to fit/cover nicely
      const imgAspect = imageElement.width / imageElement.height;
      let drawW = targetSize;
      let drawH = targetSize;

      if (imgAspect > 1) {
        drawW = targetSize * imgAspect;
      } else {
        drawH = targetSize / imgAspect;
      }

      ctx.drawImage(
        imageElement,
        -drawW / 2 + effectivePanX / scale,
        -drawH / 2 + effectivePanY / scale,
        drawW,
        drawH
      );

      ctx.restore();
    },
    [imageElement, zoom, pan, rotation]
  );

  // 3. Update dedicated preview when transform changes
  useEffect(() => {
    if (!imageElement || !isOpen) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }

    const canvas = canvasRef.current;
    drawToCanvas(canvas, 200);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      if (prevPreviewUrlRef.current) {
        URL.revokeObjectURL(prevPreviewUrlRef.current);
      }
      prevPreviewUrlRef.current = url;
      setPreviewUrl(url);
    }, 'image/png');

    return () => {
      if (prevPreviewUrlRef.current) {
        URL.revokeObjectURL(prevPreviewUrlRef.current);
        prevPreviewUrlRef.current = null;
      }
    };
  }, [imageElement, zoom, pan, rotation, isOpen, drawToCanvas]);

  // Pointer event handlers for drag / pan
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      if ((e.target as HTMLElement).setPointerCapture) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    } catch {}
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const newPan = {
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    };
    setPan(getClampedPan(newPan, zoom, rotation, imageElement));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        if ((e.target as HTMLElement).releasePointerCapture) {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
      } catch {}
      setIsDragging(false);
    }
  };

  const handleRotate = () => {
    setRotation((prev) => {
      const nextRot = (prev + 90) % 360;
      setPan((p) => getClampedPan(p, zoom, nextRot, imageElement));
      return nextRot;
    });
  };

  const handleReset = () => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleConfirm = () => {
    if (!imageElement) return;

    const exportCanvas = document.createElement('canvas');
    drawToCanvas(exportCanvas, EXPORT_SIZE);

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'dormitory-logo.png', {
        type: 'image/png',
        lastModified: Date.now(),
      });
      onConfirm(file);
    }, 'image/png');
  };

  if (!isOpen || !imageFile) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-5 sm:p-7 space-y-5 shadow-2xl relative text-slate-800 flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shrink-0">
              <ImageIcon className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                ปรับแต่งรูปโลโก้หอพัก
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                ลากเพื่อเลื่อนตำแหน่ง ปรับย่อ/ขยาย และหมุนภาพให้พอดีกับกรอบ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace & Previews Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Main Crop Workspace (Left Column) */}
          <div className="md:col-span-7 flex flex-col items-center space-y-4">
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`relative overflow-hidden border-2 border-dashed border-indigo-400 rounded-2xl bg-slate-100 flex items-center justify-center select-none touch-none ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              style={{ width: `${CROP_SIZE}px`, height: `${CROP_SIZE}px` }}
            >
              {imageSrc && (
                <div
                  className="absolute transition-transform duration-75 ease-out origin-center"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom / 100})`,
                  }}
                >
                  <img
                    src={imageSrc}
                    alt="Workspace"
                    className="pointer-events-none max-w-none select-none"
                    style={{
                      width: `${CROP_SIZE}px`,
                      height: `${CROP_SIZE}px`,
                      objectFit: 'contain',
                    }}
                    draggable={false}
                  />
                </div>
              )}

              {/* Grid guide overlay */}
              <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-indigo-300/40">
                <div className="border-r border-b border-indigo-300/30" />
                <div className="border-r border-b border-indigo-300/30" />
                <div className="border-b border-indigo-300/30" />
                <div className="border-r border-b border-indigo-300/30" />
                <div className="border-r border-b border-indigo-300/30" />
                <div className="border-b border-indigo-300/30" />
                <div className="border-r border-indigo-300/30" />
                <div className="border-r border-indigo-300/30" />
                <div />
              </div>
            </div>

            {/* Controls Bar: Zoom, Rotate, Reset */}
            <div className="w-full max-w-[280px] space-y-3">
              {/* Zoom Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                  <span className="flex items-center gap-1">
                    <ZoomOut className="w-3.5 h-3.5 text-slate-400" />
                    ย่อ/ขยาย
                  </span>
                  <span className="font-mono text-indigo-600 font-bold">{zoom}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setZoom((prev) => Math.max(100, prev - 10))}
                    className="p-1 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                    title="ย่อ"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min={100}
                    max={300}
                    step={1}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="flex-1 accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setZoom((prev) => Math.min(300, prev + 10))}
                    className="p-1 text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                    title="ขยาย"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Action Buttons: Rotate 90 & Reset */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleRotate}
                  className="flex-1 py-1.5 px-2.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 font-extrabold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer border border-slate-200"
                >
                  <RotateCw className="w-3.5 h-3.5 text-indigo-500" />
                  หมุน 90°
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold text-[11px] rounded-xl flex items-center justify-center gap-1 transition cursor-pointer border border-slate-200"
                  title="รีเซ็ตค่าเริ่มต้น"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  รีเซ็ต
                </button>
              </div>
            </div>
          </div>

          {/* Real-time Previews (Right Column) */}
          <div className="md:col-span-5 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-4">
            <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              ตัวอย่างการแสดงผลจริง
            </h4>

            {/* 1. Circular / Avatar Preview */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 block">1. รูปโปรไฟล์ / ไอคอนกลม</span>
              <div className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-slate-200">
                <div className="w-12 h-12 rounded-full overflow-hidden border border-indigo-200 bg-slate-50 flex items-center justify-center shrink-0 shadow-2xs">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Avatar Preview" className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-6 h-6 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">หอพักตัวอย่าง</p>
                  <p className="text-[10px] text-slate-400">มุมมองผู้เช่า & เมนูหลัก</p>
                </div>
              </div>
            </div>

            {/* 2. Rounded-Square Preview */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 block">2. กรอบสี่เหลี่ยม / ตัวเลือกหอพัก</span>
              <div className="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-slate-200">
                <div className="w-12 h-12 rounded-xl overflow-hidden border border-indigo-200 bg-slate-50 flex items-center justify-center shrink-0 shadow-2xs">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Square Preview" className="w-full h-full object-contain p-0.5" />
                  ) : (
                    <Building2 className="w-6 h-6 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">Dormitory Picker</p>
                  <p className="text-[10px] text-slate-400">หน้าเลือกหอพัก</p>
                </div>
              </div>
            </div>

            {/* 3. Document / Bill / Receipt Preview */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-slate-400 block">3. หัวบิล & ใบเสร็จรับเงิน</span>
              <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
                      {previewUrl ? (
                        <img src={previewUrl} alt="Doc Preview" className="w-full h-full object-contain" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-300" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-extrabold text-slate-800 truncate leading-none">ใบเสร็จรับเงิน</p>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5 leading-none">RC-202609-101-0001</p>
                    </div>
                  </div>
                  <span className="text-[9px] font-extrabold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                    ชำระแล้ว
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>ยอดสุทธิ:</span>
                  <span className="font-bold text-slate-900">฿ 4,500</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="py-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !imageElement}
            className="py-2.5 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{isSubmitting ? 'กำลังบันทึก...' : 'เสร็จสิ้น'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
