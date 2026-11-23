import { useEffect, useRef } from 'react';
import { syncCanvasSize } from '../engine/math';

export interface PlotSeries {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

interface LivePlotProps {
  title: string;
  yUnit?: string;
  series: PlotSeries[];
  minY?: number;
  maxY?: number;
  height?: number;
  version: number;
}

export function LivePlot({
  title,
  yUnit = '',
  series,
  minY,
  maxY,
  height = 148,
  version,
}: LivePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height: h, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, h);

    const padLeft = 44;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 16;
    const plotW = Math.max(10, width - padLeft - padRight);
    const plotH = Math.max(10, h - padTop - padBottom);

    // Determine Y bounds
    let lo = minY ?? Infinity;
    let hi = maxY ?? -Infinity;
    if (minY === undefined || maxY === undefined) {
      for (const s of series) {
        for (let i = 0; i < s.values.length; i++) {
          const v = s.values[i];
          if (Number.isFinite(v)) {
            if (minY === undefined && v < lo) lo = v;
            if (maxY === undefined && v > hi) hi = v;
          }
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (Math.abs(hi - lo) < 1e-6) {
      lo -= 1;
      hi += 1;
    } else if (minY === undefined || maxY === undefined) {
      const margin = (hi - lo) * 0.1;
      if (minY === undefined) lo -= margin;
      if (maxY === undefined) hi += margin;
    }

    const toY = (v: number) => padTop + plotH - ((v - lo) / (hi - lo)) * plotH;

    // Horizontal gridlines & labels
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const frac = i / ticks;
      const val = hi - frac * (hi - lo);
      const y = padTop + frac * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      const label = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(1);
      ctx.fillText(label, padLeft - 6, y);
    }

    // Zero reference line if visible
    if (lo < 0 && hi > 0) {
      const y0 = toY(0);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.beginPath();
      ctx.moveTo(padLeft, y0);
      ctx.lineTo(width - padRight, y0);
      ctx.stroke();
    }

    // Plot series
    for (const s of series) {
      const n = s.values.length;
      if (n < 2) continue;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.75;
      if (s.dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padLeft + (i / Math.max(1, n - 1)) * plotW;
        const y = toY(s.values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }, [series, minY, maxY, version]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <h4 className="text-xs font-semibold tracking-wide text-slate-200">{title}</h4>
          {yUnit && <span className="font-mono text-[10px] text-slate-500">({yUnit})</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ height }}
        className="w-full rounded-lg border border-slate-800/70"
      />
    </div>
  );
}
