import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

export interface CelebrationFireworksOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  autoDismissMs?: number;
  title?: string;
  subtitle?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  alpha: number;
  decay: number;
  gravity: number;
  shape: 'circle' | 'rect';
  rotation: number;
  rotationSpeed: number;
}

const COLORS = [
  '#10B981', // emerald-500
  '#34D399', // emerald-400
  '#F59E0B', // amber-500
  '#FBBF24', // amber-400
  '#6366F1', // indigo-500
  '#8B5CF6', // purple-500
  '#EC4899', // pink-500
  '#38BDF8', // sky-400
  '#FFFFFF', // white
];

export const CelebrationFireworksOverlay: React.FC<CelebrationFireworksOverlayProps> = ({
  isOpen,
  onClose,
  autoDismissMs = 3500,
  title = '🎉 ยินดีด้วย! คุณได้รับสิทธิ์ใช้งานฟรี 1 เดือน',
  subtitle = 'อัปเกรดเป็น HORPLUS PRO เรียบร้อยแล้ว',
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const exitTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsExiting(false);
      return;
    }

    setIsExiting(false);

    // Fade-out trigger before complete dismiss
    const fadeOutDelay = Math.max(0, autoDismissMs - 500);
    exitTimerRef.current = setTimeout(() => {
      setIsExiting(true);
    }, fadeOutDelay);

    // Auto-dismiss timer with cleanup
    if (autoDismissMs > 0) {
      timerRef.current = setTimeout(() => {
        onClose();
      }, autoDismissMs);
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth || 800);
    let height = (canvas.height = window.innerHeight || 600);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth || 800;
      height = canvas.height = window.innerHeight || 600;
    };
    window.addEventListener('resize', handleResize);

    const particles: Particle[] = [];

    const createBurst = (originX: number, originY: number, count = 45) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 7 + 2;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          radius: Math.random() * 4 + 2,
          alpha: 1,
          decay: Math.random() * 0.015 + 0.01,
          gravity: 0.12,
          shape: Math.random() > 0.5 ? 'rect' : 'circle',
          rotation: Math.random() * Math.PI,
          rotationSpeed: (Math.random() - 0.5) * 0.2,
        });
      }
    };

    // Trigger initial bursts from varied locations
    createBurst(width * 0.25, height * 0.35, 50);
    createBurst(width * 0.75, height * 0.35, 50);
    createBurst(width * 0.5, height * 0.25, 60);

    // Staggered follow-up burst
    const staggerTimeout1 = setTimeout(() => {
      createBurst(width * 0.35, height * 0.45, 40);
      createBurst(width * 0.65, height * 0.45, 40);
    }, 400);

    const staggerTimeout2 = setTimeout(() => {
      createBurst(width * 0.5, height * 0.3, 50);
    }, 800);

    // Animation Loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.98;
        p.alpha -= p.decay;
        p.rotation += p.rotationSpeed;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        if (p.shape === 'rect') {
          ctx.fillRect(-p.radius, -p.radius * 1.5, p.radius * 2, p.radius * 3);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (particles.length > 0) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    // F-02: Cleanup lifecycle hook
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      clearTimeout(staggerTimeout1);
      clearTimeout(staggerTimeout2);
    };
  }, [isOpen, autoDismissMs, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[100] overflow-hidden"
      aria-hidden="false"
    >
      {/* Background fireworks canvas (non-blocking) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none w-full h-full"
      />

      {/* Non-blocking Celebratory Toast + Fade at Top Center */}
      <aside
        role="status"
        aria-live="polite"
        aria-label="แจ้งเตือนการรับสิทธิ์ใช้งานสำเร็จ"
        className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none w-[92vw] max-w-md transition-all duration-500 ease-out transform ${
          isExiting
            ? 'opacity-0 -translate-y-4 scale-95'
            : 'opacity-100 translate-y-0 scale-100'
        }`}
      >
        <div className="bg-white/95 backdrop-blur-md border-2 border-emerald-400 shadow-xl shadow-emerald-950/10 rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 flex items-center gap-3.5">
          {/* Celebratory Badge Icon */}
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/20 relative">
            <span className="text-xl sm:text-2xl animate-bounce">🎉</span>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center shadow-xs">
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          </div>

          {/* 2-line Thai Copywriting */}
          <div className="min-w-0 flex-1">
            <h4 className="text-xs sm:text-sm font-black text-slate-900 truncate">
              {title}
            </h4>
            <p className="text-[11px] sm:text-xs text-emerald-700 font-bold truncate mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
};
