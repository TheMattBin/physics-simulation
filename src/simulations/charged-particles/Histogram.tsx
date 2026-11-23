import { useEffect, useRef } from 'react';
import { syncCanvasSize } from '../../engine/math';

export interface HistogramSeries {
  label: string;
  color: string;
  counts: number[]; // all series share the same binning
}

export interface HistogramMarker {
  x: number;
  label: string;
  color: string;
}

interface HistogramProps {
  title: string;
  xUnit: string;
  xMin: number;
  xMax: number;
  xTicks: number[];
  series: HistogramSeries[];
  markers?: HistogramMarker[];
  footer?: string;
  version: number;
  height?: number;
}

/** Bar histogram on a Canvas; later series draw on top of earlier ones. */
export function Histogram({
  title,
  xUnit,
  xMin,
  xMax,
  xTicks,
  series,
  markers = [],
  footer,
  version,
  height = 170,
}: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height: h, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, h);

    const padL = 40;
    const padR = 12;
    const padT = 16;
    const padB = 22;
    const plotW = Math.max(10, width - padL - padR);
    const plotH = Math.max(10, h - padT - padB);
    const bins = series[0]?.counts.length ?? 0;
    let maxCount = 1;
    for (const s of series) for (const c of s.counts) maxCount = Math.max(maxCount, c);
    const toX = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * plotW;
    const toY = (c: number) => padT + plotH - (c / maxCount) * plotH;

    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.fillStyle = '#64748b';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const frac of [0, 0.5, 1]) {
      const y = padT + plotH * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(maxCount * frac)), padL - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of xTicks) {
      ctx.fillText(String(t), toX(t), padT + plotH + 6);
    }

    for (const m of markers) {
      const x = toX(m.x);
      ctx.save();
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = m.color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(m.label, x, padT - 4);
    }

    if (bins > 0) {
      const bw = plotW / bins;
      for (const s of series) {
        ctx.fillStyle = s.color;
        for (let i = 0; i < bins; i++) {
          const c = s.counts[i];
          if (c <= 0) continue;
          const y = toY(c);
          ctx.fillRect(padL + i * bw + 0.5, y, Math.max(1, bw - 1), padT + plotH - y);
        }
      }
    }
    ctx.restore();
  }, [series, markers, xMin, xMax, xTicks, version]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <h4 className="text-xs font-semibold tracking-wide text-slate-200">{title}</h4>
          <span className="font-mono text-[10px] text-slate-500">(x: {xUnit})</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      <canvas ref={canvasRef} style={{ height }} className="w-full rounded-lg border border-slate-800/70" />
      {footer && <p className="mt-2 text-[11px] leading-snug text-slate-500">{footer}</p>}
    </div>
  );
}
