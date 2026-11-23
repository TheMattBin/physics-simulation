import { useEffect, useMemo, useRef } from 'react';
import { syncCanvasSize } from '../../engine/math';
import {
  ALPHA,
  energySpread,
  packetK0,
  transmission,
  type Potential,
  type QuantumParams,
} from './physics';
import { QCOLORS } from './draw';

interface TransmissionPlotProps {
  params: QuantumParams;
  pot: Potential;
  measuredT: number;
  height?: number;
}

/** T(E) for the current potential with the packet's energy distribution shaded underneath. */
export function TransmissionPlot({ params, pot, measuredT, height = 150 }: TransmissionPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const curve = useMemo(() => {
    const dE = energySpread(params);
    const vMax = Math.max(0, ...pot.regions.map((r) => r.V));
    const eMax = Math.max(params.E0 + 4 * dE, vMax * 1.4, params.E0 * 1.6, 1);
    const samples = 500;
    const Es: number[] = [];
    const Ts: number[] = [];
    const Ps: number[] = [];
    const k0 = packetK0(params.E0);
    const sk = 1 / (2 * params.sigma0);
    let pMax = 0;
    for (let i = 0; i <= samples; i++) {
      const E = (eMax * i) / samples;
      Es.push(E);
      Ts.push(transmission(Math.max(1e-6, E), pot));
      // Energy density of the packet: |φ(k)|² dk/dE with E = αk²
      const k = Math.sqrt(Math.max(1e-12, E / ALPHA));
      const P = (Math.exp(-((k - k0) ** 2) / (2 * sk * sk)) / (2 * ALPHA * k)) * (E > 0 ? 1 : 0);
      Ps.push(P);
      pMax = Math.max(pMax, P);
    }
    return { Es, Ts, Ps: Ps.map((v) => (pMax > 0 ? v / pMax : 0)), eMax, vMax };
  }, [params, pot]);

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

    const padL = 34;
    const padR = 10;
    const padT = 10;
    const padB = 20;
    const pw = width - padL - padR;
    const ph = h - padT - padB;
    const toX = (E: number) => padL + (E / curve.eMax) * pw;
    const toY = (v: number) => padT + ph - v * ph;

    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(padL, toY(v));
      ctx.lineTo(width - padR, toY(v));
      ctx.stroke();
      ctx.fillText(v.toFixed(1), padL - 5, toY(v));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = curve.eMax > 12 ? 4 : curve.eMax > 6 ? 2 : curve.eMax > 3 ? 1 : 0.5;
    for (let E = 0; E <= curve.eMax + 1e-9; E += step) ctx.fillText(`${+E.toFixed(1)}`, toX(E), padT + ph + 5);

    // Packet energy distribution
    ctx.fillStyle = 'rgba(163, 230, 53, 0.22)';
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(0));
    curve.Es.forEach((E, i) => ctx.lineTo(toX(E), toY(curve.Ps[i] * 0.95)));
    ctx.lineTo(toX(curve.eMax), toY(0));
    ctx.closePath();
    ctx.fill();

    // Barrier top
    if (curve.vMax > 0 && curve.vMax < curve.eMax) {
      ctx.save();
      ctx.strokeStyle = QCOLORS.potential;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(toX(curve.vMax), padT);
      ctx.lineTo(toX(curve.vMax), padT + ph);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = QCOLORS.potential;
      ctx.textAlign = 'left';
      ctx.fillText('V₀', toX(curve.vMax) + 4, padT + 2);
    }

    // T(E)
    ctx.strokeStyle = QCOLORS.transmitted;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    curve.Es.forEach((E, i) => {
      if (i === 0) ctx.moveTo(toX(E), toY(curve.Ts[i]));
      else ctx.lineTo(toX(E), toY(curve.Ts[i]));
    });
    ctx.stroke();

    // Measured packet transmission, drawn at E₀
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(toX(params.E0), toY(Math.min(1, measuredT)), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [curve, measuredT, params.E0]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <h4 className="text-xs font-semibold tracking-wide text-slate-200">Transmission spectrum T(E)</h4>
          <span className="font-mono text-[10px] text-slate-500">(x: eV)</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: QCOLORS.transmitted }} />
            plane wave T(E)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm bg-lime-400/40" />
            packet energies
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-200" />
            measured T
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ height }} className="w-full rounded-lg border border-slate-800/70" />
    </div>
  );
}
