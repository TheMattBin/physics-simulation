import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { syncCanvasSize, thermalColor, thermalRgba } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  analyzeCycle,
  sampleCycleAtPhase,
  type EngineCycleType,
  type EngineParams,
} from './physics';

interface GasDot {
  u: number; // normalized [0, 1] x inside cylinder
  v: number; // normalized [0, 1] y inside gas volume
  vx: number;
  vy: number;
}

function createGasDots(n: number): GasDot[] {
  const dots: GasDot[] = [];
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    const mag = 0.5 + Math.random() * 0.9;
    dots.push({
      u: 0.08 + Math.random() * 0.84,
      v: 0.08 + Math.random() * 0.84,
      vx: Math.cos(angle) * mag,
      vy: Math.sin(angle) * mag,
    });
  }
  return dots;
}

export function HeatEngineLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<EngineParams>({
    cycle: 'carnot',
    tHot: 850,
    tCold: 300,
    compressionRatio: 4.5,
    gamma: 1.4,
  });
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  const analysis = useMemo(() => analyzeCycle(params), [params]);
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(0);
  const dotsRef = useRef<GasDot[]>(createGasDots(64));
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const [liveState, setLiveState] = useState({
    V: analysis.vertices[0].V,
    P: analysis.vertices[0].P,
    T: analysis.vertices[0].T,
    strokeIndex: 0 as 0 | 1 | 2 | 3,
  });

  const drawFrame = useCallback((dtForDots: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cyc = analysisRef.current;
    const st = sampleCycleAtPhase(cyc, phaseRef.current);
    const activeStroke = cyc.strokes[st.strokeIndex];

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, height);

    const splitX = width * 0.43;

    // Divider line
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX, 14);
    ctx.lineTo(splitX, height - 14);
    ctx.stroke();

    // =========================================================
    // LEFT PANEL: ANIMATED PISTON CYLINDER & THERMAL RESERVOIR
    // =========================================================
    const cylW = Math.min(148, splitX * 0.56);
    const cylH = height * 0.56;
    const cylX = (splitX - cylW) * 0.5;
    const cylTop = height * 0.14;
    const cylBottom = cylTop + cylH;

    // Volume ratio maps piston height cleanly inside cylinder
    const vNorm = (st.V - cyc.vMin) / Math.max(0.01, cyc.vMax - cyc.vMin);
    const gasHeight = cylH * (0.24 + 0.72 * vNorm);
    const pistonY = cylBottom - gasHeight;
    const tempNorm = Math.min(1, Math.max(0, (st.T - 240) / 960));

    // Title
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('THERMODYNAMIC CYLINDER', splitX * 0.5, 24);

    // Gas glow fill
    const gasGrad = ctx.createLinearGradient(cylX, pistonY, cylX, cylBottom);
    gasGrad.addColorStop(0, thermalRgba(tempNorm, 0.14));
    gasGrad.addColorStop(1, thermalRgba(tempNorm, 0.32));
    ctx.fillStyle = gasGrad;
    ctx.fillRect(cylX + 3, pistonY, cylW - 6, gasHeight);

    // Animate & draw internal gas molecules (speed proportional to sqrt(T))
    const thermalSpeed = Math.sqrt(st.T / 300) * 1.15;
    const dots = dotsRef.current;
    ctx.fillStyle = thermalColor(tempNorm);
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      if (dtForDots > 0) {
        d.u += d.vx * thermalSpeed * dtForDots;
        d.v += d.vy * thermalSpeed * dtForDots;
        if (d.u < 0.05) {
          d.u = 0.05;
          d.vx = Math.abs(d.vx);
        } else if (d.u > 0.95) {
          d.u = 0.95;
          d.vx = -Math.abs(d.vx);
        }
        if (d.v < 0.05) {
          d.v = 0.05;
          d.vy = Math.abs(d.vy);
        } else if (d.v > 0.95) {
          d.v = 0.95;
          d.vy = -Math.abs(d.vy);
        }
      }
      const px = cylX + 6 + d.u * (cylW - 12);
      const py = pistonY + 6 + d.v * (gasHeight - 12);
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Piston head & rod
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.fillRect(cylX + 3, pistonY - 14, cylW - 6, 14);
    ctx.strokeRect(cylX + 3, pistonY - 14, cylW - 6, 14);

    // Rod going up to top bearing
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cylX + cylW * 0.5, pistonY - 14);
    ctx.lineTo(cylX + cylW * 0.5, cylTop - 16);
    ctx.stroke();

    // Cylinder walls (U-shape open at top)
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(cylX, cylTop - 6);
    ctx.lineTo(cylX, cylBottom);
    ctx.lineTo(cylX + cylW, cylBottom);
    ctx.lineTo(cylX + cylW, cylTop - 6);
    ctx.stroke();

    // Thermal Reservoir / Insulator Base Block
    const baseY = cylBottom + 12;
    const baseH = 38;
    let baseColor = '#1e293b';
    let baseBorder = '#475569';
    let baseLabel = 'ADIABATIC INSULATOR (Q = 0)';
    let baseTextColor = '#c4b5fd';

    if (activeStroke.heatFlow === 'in') {
      baseColor = 'rgba(244, 63, 94, 0.22)';
      baseBorder = '#fb7185';
      baseLabel = 'HEAT SOURCE Q_H → IN';
      baseTextColor = '#fda4af';
    } else if (activeStroke.heatFlow === 'out') {
      baseColor = 'rgba(56, 189, 248, 0.2)';
      baseBorder = '#38bdf8';
      baseLabel = 'HEAT SINK Q_C ← OUT';
      baseTextColor = '#7dd3fc';
    }

    ctx.fillStyle = baseColor;
    ctx.strokeStyle = baseBorder;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(cylX - 10, baseY, cylW + 20, baseH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = baseTextColor;
    ctx.font = 'bold 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(baseLabel, cylX + cylW * 0.5, baseY + 23);

    // Current stroke badge at bottom-left
    ctx.fillStyle = activeStroke.color;
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText(activeStroke.name, splitX * 0.5, height - 24);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(activeStroke.process, splitX * 0.5, height - 9);

    // =========================================================
    // RIGHT PANEL: LIVE P-V DIAGRAM + ENCLOSED NET WORK AREA
    // =========================================================
    const padL = splitX + 58;
    const padR = 24;
    const padT = 44;
    const padB = 46;
    const plotW = Math.max(80, width - padL - padR);
    const plotH = Math.max(80, height - padT - padB);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PRESSURE–VOLUME (P–V) DIAGRAM', padL + plotW * 0.5, 24);

    const vAxisMin = 0;
    const vAxisMax = cyc.vMax * 1.12;
    const pAxisMin = 0;
    const pAxisMax = cyc.pMax * 1.12;

    const toPX = (V: number) => padL + ((V - vAxisMin) / (vAxisMax - vAxisMin)) * plotW;
    const toPY = (P: number) => padT + plotH - ((P - pAxisMin) / (pAxisMax - pAxisMin)) * plotH;

    // Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      const y = padT + f * plotH;
      const pVal = pAxisMax * (1 - f);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(`${(pVal / 1000).toFixed(1)}`, padL - 8, y + 3);

      const x = padL + f * plotW;
      const vVal = vAxisMax * f;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(vVal.toFixed(1), x, padT + plotH + 16);
    }

    // Axes
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // Axis titles
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Volume V (L)', padL + plotW * 0.5, height - 10);

    ctx.save();
    ctx.translate(splitX + 16, padT + plotH * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Pressure P (MPa)', 0, 0);
    ctx.restore();

    // Shaded enclosed work area: W_net = ∮ P dV
    ctx.save();
    ctx.beginPath();
    cyc.curvePoints.forEach((pt, idx) => {
      const x = toPX(pt.V);
      const y = toPY(pt.P);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(52, 211, 153, 0.14)';
    ctx.fill();
    ctx.restore();

    // Stroke curves color-coded
    const pts = cyc.curvePoints;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const strokeMeta = cyc.strokes[a.strokeIndex];
      ctx.strokeStyle = strokeMeta.color;
      ctx.lineWidth = a.strokeIndex === st.strokeIndex ? 3.2 : 1.8;
      ctx.globalAlpha = a.strokeIndex === st.strokeIndex ? 1 : 0.65;
      ctx.beginPath();
      ctx.moveTo(toPX(a.V), toPY(a.P));
      ctx.lineTo(toPX(b.V), toPY(b.P));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Label net work inside loop centroid
    let cx = 0;
    let cy = 0;
    for (const pt of pts) {
      cx += toPX(pt.V);
      cy += toPY(pt.P);
    }
    cx /= pts.length;
    cy /= pts.length;
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`W = ${cyc.netWork.toFixed(2)} kJ`, cx, cy);

    // State vertices (1, 2, 3, 4)
    cyc.vertices.forEach((v, idx) => {
      const vx = toPX(v.V);
      const vy = toPY(v.P);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(vx, vy, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 9px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${idx + 1}`, vx, vy + 0.5);
    });
    ctx.textBaseline = 'alphabetic';

    // Active state marker dot with glow
    const dotX = toPX(st.V);
    const dotY = toPY(st.P);
    ctx.save();
    ctx.shadowColor = activeStroke.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = activeStroke.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let frame = 0;

    const loop = (now: number) => {
      const rawDt = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        phaseRef.current = (phaseRef.current + rawDt * speedRef.current * 0.16) % 1;
        drawFrame(rawDt * speedRef.current);
        frame++;
        if (frame % 4 === 0) {
          const st = sampleCycleAtPhase(analysisRef.current, phaseRef.current);
          setLiveState(st);
        }
      } else {
        drawFrame(0);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  const handleStep = () => {
    setRunning(false);
    phaseRef.current = (phaseRef.current + 0.025) % 1;
    const st = sampleCycleAtPhase(analysisRef.current, phaseRef.current);
    setLiveState(st);
    drawFrame(0.03);
  };

  const handleReset = () => {
    phaseRef.current = 0;
    const st = sampleCycleAtPhase(analysisRef.current, 0);
    setLiveState(st);
    drawFrame(0);
  };

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={handleStep}
      onReset={handleReset}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative h-[420px] w-full sm:h-[460px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {analysis.strokes.map((s) => {
            const active = liveState.strokeIndex === s.index;
            return (
              <div
                key={s.index}
                className={`rounded-xl border p-3 transition-all ${
                  active
                    ? 'border-slate-600 bg-slate-900/90 shadow-md'
                    : 'border-slate-800/80 bg-[#090e1a] opacity-70'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-mono text-[11px] font-semibold text-slate-200">
                    Stroke {s.index + 1}
                  </span>
                </div>
                <div className="mt-1 text-xs font-medium text-slate-300">{s.name.slice(5)}</div>
                <div className="mt-1 text-[11px] text-slate-500">{s.process}</div>
              </div>
            );
          })}
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Thermal Efficiency η"
            value={(analysis.efficiency * 100).toFixed(1)}
            unit="%"
            color="#34d399"
            sublabel={`Carnot Limit: ${(analysis.carnotLimit * 100).toFixed(1)}%`}
          />
          <MetricCard
            label="Net Work / Cycle"
            value={analysis.netWork.toFixed(2)}
            unit="kJ"
            color="#38bdf8"
            sublabel={`Q_H: ${analysis.qIn.toFixed(2)} · Q_C: ${analysis.qOut.toFixed(2)}`}
          />
          <MetricCard
            label="Live Pressure"
            value={(liveState.P / 1000).toFixed(2)}
            unit="MPa"
            color="#fb7185"
          />
          <MetricCard
            label="Live Temperature"
            value={liveState.T.toFixed(0)}
            unit="K"
            color="#f59e0b"
            sublabel={`V = ${liveState.V.toFixed(2)} L`}
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Engine Cycle Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'carnot', label: 'Carnot Cycle' },
                  { id: 'otto', label: 'Otto (IC Engine)' },
                ] as { id: EngineCycleType; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    phaseRef.current = 0;
                    setParams((p) => ({ ...p, cycle: opt.id }));
                  }}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    params.cycle === opt.id
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <ParameterSlider
            label={params.cycle === 'carnot' ? 'Hot Reservoir (T_H)' : 'Peak Combustion Temp (T₃)'}
            value={params.tHot}
            min={550}
            max={1400}
            step={10}
            precision={0}
            unit="K"
            onChange={(tHot) =>
              setParams((p) => ({ ...p, tHot: Math.max(tHot, p.tCold + 150) }))
            }
          />

          <ParameterSlider
            label={params.cycle === 'carnot' ? 'Cold Reservoir (T_C)' : 'Intake Temp (T₁)'}
            value={params.tCold}
            min={220}
            max={500}
            step={10}
            precision={0}
            unit="K"
            onChange={(tCold) =>
              setParams((p) => ({ ...p, tCold: Math.min(tCold, p.tHot - 150) }))
            }
          />

          <ParameterSlider
            label="Compression Ratio (r = V_max / V_min)"
            value={params.compressionRatio}
            min={2.5}
            max={9.0}
            step={0.1}
            precision={1}
            unit=":1"
            hint={
              params.cycle === 'otto'
                ? 'Directly governs Otto efficiency η = 1 − r^(1−γ)'
                : 'Sets total cylinder stroke volume'
            }
            onChange={(compressionRatio) => setParams((p) => ({ ...p, compressionRatio }))}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              Working Gas (Adiabatic Index γ = Cₚ / Cᵥ)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'Monatomic', val: 1.67, sub: '5/3 (He)' },
                { label: 'Diatomic', val: 1.4, sub: '7/5 (Air)' },
                { label: 'Polyatomic', val: 1.33, sub: '4/3 (CO₂)' },
              ].map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setParams((p) => ({ ...p, gamma: g.val }))}
                  className={`rounded-lg border px-2 py-1.5 text-center transition-colors ${
                    Math.abs(params.gamma - g.val) < 0.02
                      ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="text-[11px] font-medium">{g.label}</div>
                  <div className="font-mono text-[10px] text-slate-500">{g.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      }
    />
  );
}
