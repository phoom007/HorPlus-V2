/**
 * @license Apache-2.0
 * Global React Error Boundary
 * Catches uncaught runtime render exceptions and displays a polite mobile-first fallback UI
 * instead of leaving users with a blank white screen.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught application error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  public render() {
    if (this.state.hasError) {
      const isDev = Boolean(
        (import.meta as any).env?.DEV ||
        (import.meta as any).env?.MODE !== 'production' ||
        typeof window !== 'undefined' && window.location.hostname.includes('localhost')
      );

      return (
        <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-800">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-6 sm:p-8 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200">
            {/* Warning Icon Badge */}
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-600 mb-4 shadow-sm">
              <AlertTriangle className="w-8 h-8 stroke-[2.2]" />
            </div>

            {/* Title & Description */}
            <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
              {this.props.fallbackTitle || 'เกิดข้อผิดพลาดในการโหลดข้อมูล'}
            </h2>
            <p className="text-xs text-slate-500 font-medium leading-relaxed mt-2 mb-6 max-w-xs">
              {this.props.fallbackMessage ||
                'ระบบพบปัญหาชั่วคราวในการแสดงผล กรุณากดปุ่มเพื่อโหลดหน้าใหม่อีกครั้ง หรือติดต่อผู้ดูแลหอพักหากยังคงพบปัญหา'}
            </p>

            {/* Action Buttons */}
            <div className="w-full space-y-2.5">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-black rounded-xl text-xs shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 stroke-[2.5]" />
                <span>โหลดหน้าใหม่อีกครั้ง</span>
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Home className="w-4 h-4 text-slate-500" />
                <span>กลับสู่หน้าหลัก</span>
              </button>
            </div>

            {/* Developer Details (Dev / Non-Prod mode) */}
            {isDev && this.state.error && (
              <div className="w-full mt-6 text-left border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <span>รายละเอียดเชิงเทคนิค (Dev Mode)</span>
                  {this.state.showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {this.state.showDetails && (
                  <div className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-xl text-[10px] font-mono overflow-x-auto max-h-48 whitespace-pre-wrap leading-relaxed">
                    <p className="text-rose-400 font-bold mb-1">{this.state.error.toString()}</p>
                    {this.state.error.stack && (
                      <p className="text-slate-400 text-[9px]">{this.state.error.stack}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
