'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { siteConfig } from '@/lib/site';
import { fetchHeroClusterViaIvcca } from '@/lib/hero-ivcca';
import type { GeneParticle } from '@/lib/hero-gene-layout';

const NODE_COLOR = siteConfig.colors.accent;
const EDGE_COLOR = siteConfig.colors.accentAlt;

function rotateY(p: GeneParticle, angle: number): GeneParticle {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    ...p,
    x: p.x * cos - p.z * sin,
    z: p.x * sin + p.z * cos,
  };
}

function rotateX(p: GeneParticle, angle: number): GeneParticle {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    ...p,
    y: p.y * cos - p.z * sin,
    z: p.y * sin + p.z * cos,
  };
}

function project(
  p: GeneParticle,
  w: number,
  h: number,
  fov: number
): { sx: number; sy: number; scale: number; depth: number } {
  const depth = Math.max(0.35, p.z + 3.2);
  const scale = fov / depth;
  return {
    sx: w / 2 + p.x * scale * w * 0.22,
    sy: h / 2 - p.y * scale * h * 0.22,
    scale,
    depth,
  };
}

export function GeneClusterVisualization() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<GeneParticle[]>([]);
  const edgesRef = useRef<[number, number][]>([]);
  const sizeRef = useRef({ w: 640, h: 360 });
  const mouseRef = useRef({ x: 0, y: 0 });
  const readyRef = useRef(false);
  const reduce = useReducedMotion();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { particles, edges } = await fetchHeroClusterViaIvcca();
        if (cancelled) return;
        particlesRef.current = particles;
        edgesRef.current = edges;
        readyRef.current = true;
        setStatus('ready');
      } catch (e) {
        console.error('GeneClusterVisualization:', e);
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : 'IVCCA cluster failed');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
      if (!readyRef.current || w < 8 || h < 8) return;

      const base = particlesRef.current;
      const edges = edgesRef.current;
      const tiltX = reduce ? 0.35 : 0.35 + mouseRef.current.y * 0.12;
      const tiltY = reduce ? time * 0.00035 : time * 0.00035 + mouseRef.current.x * 0.15;

      const rotated = base.map((p) => rotateX(rotateY(p, tiltY), tiltX));
      const projectedByIndex = rotated.map((p, index) => ({
        index,
        p,
        ...project(p, w, h, 2.8),
      }));
      const projectedSorted = [...projectedByIndex].sort((a, b) => a.depth - b.depth);

      ctx.clearRect(0, 0, w, h);

      for (const [i, j] of edges) {
        const pa = projectedByIndex[i];
        const pb = projectedByIndex[j];
        if (!pa || !pb) continue;
        const alpha = Math.min(pa.scale, pb.scale) * 0.22;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.strokeStyle = EDGE_COLOR;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 0.35 + alpha * 0.45;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      for (const { sx, sy, scale } of projectedSorted) {
        const radius = 0.55 * scale * 1.35;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 2.5);
        glow.addColorStop(0, NODE_COLOR + 'aa');
        glow.addColorStop(0.5, NODE_COLOR + '33');
        glow.addColorStop(1, NODE_COLOR + '00');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, radius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = NODE_COLOR;
        ctx.globalAlpha = Math.min(1, 0.4 + scale * 0.45);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    },
    [reduce]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let running = true;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const parent = canvas.parentElement;
    if (!parent) return;

    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      mouseRef.current = {
        x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((e.clientY - rect.top) / rect.height - 0.5) * 2,
      };
    };
    parent.addEventListener('mousemove', onMove);

    const loop = (time: number) => {
      if (!running) return;
      const { w, h } = sizeRef.current;
      draw(ctx, w, h, time);
      raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      draw(ctx, sizeRef.current.w, sizeRef.current.h, 0);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      parent.removeEventListener('mousemove', onMove);
    };
  }, [draw, reduce]);

  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    if (w >= 8 && h >= 8) draw(ctx, w, h, 0);
  }, [status, draw]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-label="IVCCA 3D gene cluster (correlation PCA)"
        role="img"
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0A0A0A]/60">
          <p className="text-sm text-zinc-400">Running IVCCA correlation &amp; PCA…</p>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0A0A0A]/85 px-6 text-center">
          <p className="text-sm text-red-400">{errorMsg}</p>
          <p className="text-xs text-zinc-500">
            Start the backend API (port 8000) so IVCCA can load hero-expression.csv.
          </p>
        </div>
      )}
    </>
  );
}
