/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Mobile Bottom Sheet Drawer
 * Supports touch & pointer drag-to-dismiss, dynamic backdrop fade, grab handle, and NO 'X' button.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface TenantBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxHeightClass?: string;
}

export const TenantBottomSheet: React.FC<TenantBottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxHeightClass = 'max-h-[88vh]',
}) => {
  const [startY, setStartY] = useState<number | null>(null);
  const [currentTranslateY, setCurrentTranslateY] = useState<number>(0);
  const isDraggingRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Pointer drag handling on grab handle
  const handleGrabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    setStartY(e.clientY);
  };

  const handleGrabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || startYRef.current === null) return;
    const deltaY = e.clientY - startYRef.current;
    if (deltaY > 0) {
      setCurrentTranslateY(deltaY);
    } else {
      setCurrentTranslateY(0);
    }
  };

  const handleGrabPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
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

  // Touch fallback on grab handle
  const handleHandleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
    startYRef.current = e.touches[0].clientY;
  };

  const handleHandleTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startYRef.current;
    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      setCurrentTranslateY(deltaY);
    }
  };

  const handleHandleTouchEnd = () => {
    if (currentTranslateY > 80) {
      onClose();
    }
    setStartY(null);
    setCurrentTranslateY(0);
    startYRef.current = null;
  };

  // Safe inner content drag check (only triggers if body is scrolled to the very top)
  const handleBodyTouchStart = (e: React.TouchEvent) => {
    if (bodyRef.current && bodyRef.current.scrollTop <= 0) {
      setStartY(e.touches[0].clientY);
      startYRef.current = e.touches[0].clientY;
    }
  };

  const handleBodyTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    if (bodyRef.current && bodyRef.current.scrollTop > 0) {
      setStartY(null);
      setCurrentTranslateY(0);
      startYRef.current = null;
      return;
    }
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startYRef.current;
    if (deltaY > 0) {
      if (e.cancelable) e.preventDefault();
      setCurrentTranslateY(deltaY);
    }
  };

  const backdropOpacity = Math.max(0, 1 - currentTranslateY / 320);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end max-w-md mx-auto animate-in fade-in duration-200">
      {/* Dynamic Backdrop */}
      <div
        data-testid="bottom-sheet-backdrop"
        style={{ opacity: backdropOpacity }}
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Sheet Content Drawer */}
      <div
        data-testid="tenant-bottom-sheet"
        style={{
          transform: `translateY(${currentTranslateY}px)`,
          transition: startY !== null || isDraggingRef.current ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className={`bg-white rounded-t-3xl border-t border-slate-100 shadow-2xl relative z-10 ${maxHeightClass} flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-250`}
      >
        {/* Grab Handle Header Bar (Clean pill, swipe-down, NO extra text labels) */}
        <div
          data-testid="bottom-sheet-grab-handle"
          onPointerDown={handleGrabPointerDown}
          onPointerMove={handleGrabPointerMove}
          onPointerUp={handleGrabPointerUp}
          onPointerCancel={handleGrabPointerUp}
          onTouchStart={handleHandleTouchStart}
          onTouchMove={handleHandleTouchMove}
          onTouchEnd={handleHandleTouchEnd}
          className="pt-3 pb-2 flex flex-col items-center shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
        >
          <div className="w-12 h-1.5 bg-slate-300 rounded-full transition-colors hover:bg-slate-400" />
        </div>

        {/* Optional Title Header (NO 'X' button) */}
        {title && (
          <div className="px-5 py-2 border-b border-slate-100/80 flex items-center justify-between shrink-0">
            <h3 className="font-black text-slate-900 text-sm tracking-tight">{title}</h3>
          </div>
        )}

        {/* Scrollable Body */}
        <div
          ref={bodyRef}
          onTouchStart={handleBodyTouchStart}
          onTouchMove={handleBodyTouchMove}
          onTouchEnd={handleHandleTouchEnd}
          className="p-5 overflow-y-auto flex-1 min-h-0 text-slate-700"
        >
          {children}
        </div>

        {/* Optional Sticky Footer */}
        {footer && (
          <div className="p-4 bg-white border-t border-slate-100 shrink-0 rounded-b-none">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
