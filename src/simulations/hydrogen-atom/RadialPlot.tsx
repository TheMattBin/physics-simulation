import { useEffect, useMemo, useRef } from 'react';
import { syncCanvasSize } from '../../engine/math';
import { HCOLORS } from './draw';
import { meanRadius, radialDistribution, type Orbital } from './physics';

interface RadialPlotProps {
  primary: Orbital;
  partner: Orbital | null;
  rMax: number;
  height?: number;
}

/** Radial probability P(r) = r²R(r)², with Bohr's orbit radius and ⟨r⟩ marked. */
export function RadialPlot({ primary, partner, rMax, height = 160 }: RadialPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const curves = useMemo(
    () => ({
      a: radialDistribution(primary.n, primary.l, 900),
      b: partner ? radialDistribution(partner.n, partner.l, 900) : null,
    }),
    [primary, partner],
  );

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
    const padL = 12;
    const padR = 10;
    const padT = 10;
    const padB = 20;
    const pw = width - padL - padR;
    const ph = h - padT - padB;
    let pMax = 0;
    for (const c of [curves.a, curves.b]) if (c) for (let i = 0; i < c.P.length; i++) if (c.r[i] <= rMax) pMax = Math.max(pMax, c.P[i]);
    const toX = (r: number) => padL + (r / rMax) * pw;
    const toY = (p: number) => padT + ph - (p / (pMax * 1.08)) * ph;

    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = rMax > 60 ? 20 : rMax > 25 ? 10 : rMax > 10 ? 5 : 2;
    for (let r = 0; r <= rMax; r += step) if (toX(r) < width - padR - 44) ctx.fillText(`${r}`, toX(r), padT + ph + 5);
    ctx.textAlign = 'right';
    ctx.fillText('r (a₀)', width - padR, padT + ph + 5);

    const curve = (c: { r: Float64Array; P: Float64Array }, color: string, fill: boolean) => {
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(0));
      for (let i = 0; i < c.r.length && c.r[i] <= rMax; i++) ctx.lineTo(toX(c.r[i]), toY(c.P[i]));
      if (fill) {
        ctx.lineTo(toX(Math.min(rMax, c.r[c.r.length - 1])), toY(0));
        ctx.closePath();
        ctx.fillStyle = 'rgba(163, 230, 53, 0.18)';
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    };
    if (curves.b && partner) {
      ctx.save();
      ctx.setLineDash([5, 3]);
      curve(curves.b, HCOLORS.partner, false);
      ctx.restore();
    }
    curve(curves.a, HCOLORS.primary, true);

    const marker = (r: number, color: string, label: string, dashed: boolean, row: number) => {
      if (r > rMax) return;
      ctx.save();
      ctx.strokeStyle = color;
      if (dashed) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(toX(r), padT);
      ctx.lineTo(toX(r), padT + ph);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, toX(r) + 4, padT + 2 + row * 12);
    };
    marker(primary.n ** 2, HCOLORS.bohr, `Bohr n²a₀ = ${primary.n ** 2}`, true, 0);
    marker(meanRadius(primary.n, primary.l), '#e2e8f0', `<r> = ${meanRadius(primary.n, primary.l)}`, true, 1);
    ctx.restore();
  }, [curves, primary, partner, rMax]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-200">Radial probability P(r) = r²|R(r)|²</h4>
        <span className="font-mono text-[10px] text-slate-500">zeros = radial nodes · 1 a₀ = 0.0529 nm</span>
      </div>
      <canvas ref={canvasRef} style={{ height }} className="w-full rounded-lg border border-slate-800/70" />
    </div>
  );
}
