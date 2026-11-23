import { useEffect, useRef } from 'react';
import { syncCanvasSize } from '../../engine/math';
import { photonWavelength, seriesName, wavelengthColor } from './physics';

export interface EmittedLine {
  nUpper: number;
  nLower: number;
  count: number;
}

interface SpectrumStripProps {
  emitted: EmittedLine[];
  current: { nUpper: number; nLower: number; allowed: boolean } | null;
  height?: number;
}

const LMIN = 90;
const LMAX = 2000;

/** Hydrogen emission spectrum on a log-wavelength axis, with the visible band in colour. */
export function SpectrumStrip({ emitted, current, height = 160 }: SpectrumStripProps) {
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
    const padL = 10;
    const padR = 10;
    const top = 22;
    const bottom = h - 22;
    const pw = width - padL - padR;
    const toX = (nm: number) => padL + (Math.log(nm / LMIN) / Math.log(LMAX / LMIN)) * pw;

    // Visible band
    for (let nm = 380; nm <= 750; nm += 2) {
      ctx.fillStyle = wavelengthColor(nm);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(toX(nm), top, toX(nm + 2) - toX(nm) + 0.5, bottom - top);
    }
    ctx.globalAlpha = 1;
    ctx.font = '9.5px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const nm of [100, 200, 400, 700, 1000, 2000]) {
      if (nm < 2000) ctx.fillText(`${nm}`, toX(nm), bottom + 5);
      ctx.fillRect(toX(nm), bottom, 1, 3);
    }
    ctx.textAlign = 'right';
    ctx.fillText('λ (nm)', width - padR, bottom + 5);

    // Series reference lines (faint)
    for (let lo = 1; lo <= 3; lo++) {
      const lam: number[] = [];
      for (let up = lo + 1; up <= 7; up++) lam.push(photonWavelength(up, lo));
      ctx.fillStyle = '#334155';
      for (const l of lam) ctx.fillRect(toX(l), top + 14, 1, bottom - top - 14);
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(seriesName(lo), toX(Math.sqrt(lam[0] * lam[lam.length - 1])), top + 10);
    }

    // Emitted lines
    for (const e of emitted) {
      const l = photonWavelength(e.nUpper, e.nLower);
      const x = toX(l);
      ctx.save();
      ctx.fillStyle = wavelengthColor(l);
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.fillRect(x - 1.5, top + 14, 3, bottom - top - 14);
      ctx.restore();
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`×${e.count}`, x, bottom - 4);
    }

    // Line the current superposition would emit
    if (current) {
      const l = photonWavelength(current.nUpper, current.nLower);
      const x = toX(l);
      ctx.save();
      ctx.strokeStyle = current.allowed ? '#e2e8f0' : '#64748b';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top + 14);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = current.allowed ? '#e2e8f0' : '#64748b';
      ctx.textAlign = x > width - 90 ? 'right' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${l.toFixed(1)} nm${current.allowed ? '' : ' (forbidden)'}`, x + (x > width - 90 ? -4 : 4), top + 28);
    }
    ctx.restore();
  }, [emitted, current]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-200">Emission spectrum you have built</h4>
        <span className="font-mono text-[10px] text-slate-500">faint ticks: all lines up to n = 7</span>
      </div>
      <canvas ref={canvasRef} style={{ height }} className="w-full rounded-lg border border-slate-800/70" />
    </div>
  );
}
