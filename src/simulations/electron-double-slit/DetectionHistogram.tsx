import { useEffect, useRef } from 'react';
import { syncCanvasSize } from '../../engine/math';
import { SCOLORS, formatLength } from './draw';
import type { Pattern } from './physics';

interface DetectionHistogramProps {
  pattern: Pattern;
  counts: number[]; // per bin, across [−halfWidth, +halfWidth]
  total: number;
  version: number;
  height?: number;
}

/** Counts per bin from detected electrons, against the |ψ|² prediction scaled to the same total. */
export function DetectionHistogram({ pattern, counts, total, version, height = 170 }: DetectionHistogramProps) {
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
    const padR = 10;
    const padT = 10;
    const padB = 20;
    const pw = width - padL - padR;
    const ph = h - padT - padB;
    const bins = counts.length;
    const W = pattern.halfWidth;

    // Expected counts per bin: total × ∫_bin |ψ|² / ∫ |ψ|²
    const n = pattern.X.length;
    const expected = new Float64Array(bins);
    const expectedNoI = new Float64Array(bins);
    let sumI = 0;
    let sumN = 0;
    for (let i = 0; i < n; i++) {
      sumI += pattern.I[i];
      sumN += pattern.noInterference[i];
    }
    for (let i = 0; i < n; i++) {
      const b = Math.min(bins - 1, Math.floor(((pattern.X[i] + W) / (2 * W)) * bins));
      expected[b] += pattern.I[i];
      expectedNoI[b] += pattern.noInterference[i];
    }
    const scale = total > 0 ? total : 1;
    for (let b = 0; b < bins; b++) {
      expected[b] = (expected[b] / (sumI || 1)) * scale;
      expectedNoI[b] = (expectedNoI[b] / (sumN || 1)) * scale;
    }
    let yMax = 1;
    for (let b = 0; b < bins; b++) yMax = Math.max(yMax, counts[b], expected[b]);
    const toY = (v: number) => padT + ph - (v / (yMax * 1.08)) * ph;
    const bw = pw / bins;

    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const frac of [0, 0.5, 1]) {
      const v = yMax * 1.08 * frac;
      ctx.fillText(total > 0 ? `${Math.round(v)}` : frac.toFixed(1), padL - 6, toY(v));
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.beginPath();
      ctx.moveTo(padL, toY(v));
      ctx.lineTo(width - padR, toY(v));
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(163, 230, 53, 0.75)';
    for (let b = 0; b < bins; b++) {
      if (counts[b] <= 0) continue;
      const y = toY(counts[b]);
      ctx.fillRect(padL + b * bw, y, Math.max(1, bw - 0.5), padT + ph - y);
    }

    const line = (arr: Float64Array, color: string, dashed: boolean) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let b = 0; b < bins; b++) {
        const x = padL + (b + 0.5) * bw;
        if (b === 0) ctx.moveTo(x, toY(arr[b]));
        else ctx.lineTo(x, toY(arr[b]));
      }
      ctx.stroke();
      ctx.restore();
    };
    line(expectedNoI, '#f59e0b', true);
    line(expected, SCOLORS.theory, false);

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`−${formatLength(W)}`, padL + 24, padT + ph + 5);
    ctx.fillText('0', padL + pw / 2, padT + ph + 5);
    ctx.fillText(`+${formatLength(W)}`, padL + pw - 24, padT + ph + 5);
    ctx.restore();
  }, [pattern, counts, total, version]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-200">Where the electrons landed</h4>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-lime-400/80" /> detected
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-200" /> |ψ|² prediction
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> no interference (|ψ₁|² + |ψ₂|²)
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ height }} className="w-full rounded-lg border border-slate-800/70" />
    </div>
  );
}
