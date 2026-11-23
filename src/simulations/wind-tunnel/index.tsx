import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Wind, Paintbrush, Eraser, Trash2 } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { LivePlot } from '../../components/LivePlot';
import { RingBuffer } from '../../engine/ringBuffer';
import { clamp, syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  GRID_NX,
  GRID_NY,
  WindTunnelLBM,
  type ObstaclePreset,
  type VizMode,
  type WindTunnelTelemetry,
} from './physics';

function mapVorticityRGB(curl: number): [number, number, number] {
  // Deep obsidian at 0; glowing cyan/sky for negative curl, glowing amber/coral for positive curl
  const v = clamp(curl * 26, -1, 1);
  const mag = Math.pow(Math.abs(v), 0.78);
  if (v >= 0) {
    return [
      Math.round(7 + mag * 244),
      Math.round(11 + mag * (165 - mag * 75)),
      Math.round(20 + mag * (35 + mag * 70)),
    ];
  }
  return [
    Math.round(7 + mag * 42),
    Math.round(11 + mag * 195),
    Math.round(20 + mag * 232),
  ];
}

function mapSpeedRGB(speed: number, u0: number): [number, number, number] {
  const t = clamp(speed / Math.max(0.05, u0 * 1.9), 0, 1);
  if (t < 0.35) {
    const u = t / 0.35;
    return [
      Math.round(8 + u * 16),
      Math.round(14 + u * 66),
      Math.round(30 + u * 125),
    ];
  }
  if (t < 0.7) {
    const u = (t - 0.35) / 0.35;
    return [
      Math.round(24 + u * 30),
      Math.round(80 + u * 135),
      Math.round(155 + u * 65),
    ];
  }
  const u = (t - 0.7) / 0.3;
  return [
    Math.round(54 + u * 198),
    Math.round(215 - u * 45),
    Math.round(220 - u * 140),
  ];
}

function mapPressureRGB(rho: number): [number, number, number] {
  // LBM pressure p = rho / 3; deviations around 1.0 are small (~ +/- 0.03)
  const v = clamp((rho - 1.0) * 52, -1, 1);
  const mag = Math.pow(Math.abs(v), 0.8);
  if (v >= 0) {
    // High pressure stagnation zone -> warm amber/coral
    return [
      Math.round(14 + mag * 238),
      Math.round(20 + mag * 110),
      Math.round(34 + mag * 55),
    ];
  }
  // Low pressure suction zone -> cool indigo/cyan
  return [
    Math.round(14 + mag * 75),
    Math.round(20 + mag * 115),
    Math.round(34 + mag * 218),
  ];
}

export function WindTunnelLab({ meta }: { meta: SimulationEntry }) {
  const [preset, setPreset] = useState<ObstaclePreset>('cylinder');
  const [angleDeg, setAngleDeg] = useState(12);
  const [inletSpeed, setInletSpeed] = useState(0.105);
  const [viscosity, setViscosity] = useState(0.012);
  const [vizMode, setVizMode] = useState<VizMode>('vorticity');
  const [showSmoke, setShowSmoke] = useState(true);
  const [showForces, setShowForces] = useState(true);
  const [drawTool, setDrawTool] = useState<'none' | 'paint' | 'erase'>('paint');
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const simRef = useRef<WindTunnelLBM>(new WindTunnelLBM());

  const cdBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));
  const clBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));

  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const vizModeRef = useRef(vizMode);
  vizModeRef.current = vizMode;
  const showSmokeRef = useRef(showSmoke);
  showSmokeRef.current = showSmoke;
  const showForcesRef = useRef(showForces);
  showForcesRef.current = showForces;
  const paintingRef = useRef(false);

  const [telemetry, setTelemetry] = useState<WindTunnelTelemetry & { plotVersion: number }>({
    reynolds: 192,
    cd: 0,
    cl: 0,
    dragForce: 0,
    liftForce: 0,
    characteristicLen: 22,
    stepCount: 0,
    plotVersion: 0,
  });

  const applyPreset = useCallback((nextPreset: ObstaclePreset, nextAngle: number) => {
    setPreset(nextPreset);
    simRef.current.setPreset(nextPreset, nextAngle);
    simRef.current.resetFlow();
    cdBufRef.current.clear();
    clBufRef.current.clear();
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!offscreenRef.current) {
      const off = document.createElement('canvas');
      off.width = GRID_NX;
      off.height = GRID_NY;
      offscreenRef.current = off;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        imageDataRef.current = offCtx.createImageData(GRID_NX, GRID_NY);
      }
    }

    const off = offscreenRef.current;
    const offCtx = off.getContext('2d');
    const imgData = imageDataRef.current;
    if (!offCtx || !imgData) return;

    const sim = simRef.current;
    const pixels = imgData.data;
    const mode = vizModeRef.current;
    const u0 = sim.inletSpeed;

    for (let i = 0; i < sim.size; i++) {
      const p4 = i * 4;
      if (sim.barrier[i] === 1) {
        pixels[p4] = 203;
        pixels[p4 + 1] = 213;
        pixels[p4 + 2] = 225;
        pixels[p4 + 3] = 255;
      } else {
        let rgb: [number, number, number];
        if (mode === 'vorticity') {
          rgb = mapVorticityRGB(sim.curl[i]);
        } else if (mode === 'speed') {
          rgb = mapSpeedRGB(Math.hypot(sim.ux[i], sim.uy[i]), u0);
        } else {
          rgb = mapPressureRGB(sim.rho[i]);
        }
        pixels[p4] = rgb[0];
        pixels[p4 + 1] = rgb[1];
        pixels[p4 + 2] = rgb[2];
        pixels[p4 + 3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Smooth upscale of LBM field
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, width, height);

    const sx = width / GRID_NX;
    const sy = height / GRID_NY;

    // Optional wind-tunnel smoke tracers
    if (showSmokeRef.current) {
      ctx.fillStyle = 'rgba(248, 250, 252, 0.72)';
      for (let i = 0; i < sim.tracers.length; i++) {
        const tr = sim.tracers[i];
        const px = tr.x * sx;
        const py = tr.y * sy;
        const gx = Math.min(GRID_NX - 2, Math.max(1, Math.floor(tr.x)));
        const gy = Math.min(GRID_NY - 2, Math.max(1, Math.floor(tr.y)));
        const idx = gy * GRID_NX + gx;
        const vx = sim.ux[idx] * sx * 18;
        const vy = sim.uy[idx] * sy * 18;
        ctx.strokeStyle = 'rgba(241, 245, 249, 0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px - vx, py - vy);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }

    // Optional Aerodynamic Drag & Lift Force Vectors
    if (showForcesRef.current) {
      const tel = sim.getTelemetry();
      const ox = sim.obstacleCenterX * sx;
      const oy = sim.obstacleCenterY * sy;

      const drawVector = (dx: number, dy: number, color: string, label: string) => {
        const len = Math.hypot(dx, dy);
        if (len < 6) return;
        const ex = ox + dx;
        const ey = oy + dy;

        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 8 * Math.cos(ang - 0.45), ey - 8 * Math.sin(ang - 0.45));
        ctx.lineTo(ex - 8 * Math.cos(ang + 0.45), ey - 8 * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.font = 'bold 10px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillText(label, ex + (dx >= 0 ? 6 : -28), ey + (dy < 0 ? -6 : 12));
        ctx.restore();
      };

      const dragPx = clamp(tel.cd * 34, -95, 95);
      const liftPx = clamp(-tel.cl * 42, -95, 95); // screen Y down -> negative is upward lift
      drawVector(dragPx, 0, '#fb7185', `F_D`);
      drawVector(0, liftPx, '#34d399', `F_L`);
    }

    // Inlet arrows & HUD legend
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.2;
    for (let k = 1; k <= 5; k++) {
      const y = (k / 6) * height;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(24, y);
      ctx.lineTo(19, y - 3);
      ctx.moveTo(24, y);
      ctx.lineTo(19, y + 3);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    const modeLabel =
      mode === 'vorticity'
        ? 'VORTICITY (∇ × u) · CYAN = CW / AMBER = CCW'
        : mode === 'speed'
          ? 'VELOCITY MAGNITUDE |u|'
          : 'PRESSURE FIELD (CORAL = HIGH / BLUE = SUCTION)';
    ctx.fillText(modeLabel, 12, 18);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.fillText('DRAG ON CANVAS TO PAINT / ERASE OBSTACLE', width - 12, height - 10);

    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let frame = 0;

    const loop = () => {
      if (runningRef.current) {
        const substeps = Math.max(2, Math.round(8 * speedRef.current));
        simRef.current.step(substeps);
        frame++;
        if (frame % 3 === 0) {
          const tel = simRef.current.getTelemetry();
          cdBufRef.current.push(tel.cd);
          clBufRef.current.push(tel.cl);
          setTelemetry((prev) => ({ ...tel, plotVersion: prev.plotVersion + 1 }));
        }
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  const paintFromPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drawTool === 'none') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const gx = ((e.clientX - rect.left) / rect.width) * GRID_NX;
    const gy = ((e.clientY - rect.top) / rect.height) * GRID_NY;
    simRef.current.paintObstacle(gx, gy, 3.2, drawTool === 'paint');
    setPreset('custom');
    drawFrame();
  };

  const handleStep = () => {
    setRunning(false);
    simRef.current.step(8);
    const tel = simRef.current.getTelemetry();
    cdBufRef.current.push(tel.cd);
    clBufRef.current.push(tel.cl);
    setTelemetry((prev) => ({ ...tel, plotVersion: prev.plotVersion + 1 }));
    drawFrame();
  };

  const handleReset = () => {
    simRef.current.resetFlow();
    cdBufRef.current.clear();
    clBufRef.current.clear();
    const tel = simRef.current.getTelemetry();
    setTelemetry((prev) => ({ ...tel, plotVersion: prev.plotVersion + 1 }));
    drawFrame();
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
      extraToolbar={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDrawTool((t) => (t === 'paint' ? 'none' : 'paint'))}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
              drawTool === 'paint'
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Paintbrush className="h-3.5 w-3.5" /> Draw
          </button>
          <button
            type="button"
            onClick={() => setDrawTool((t) => (t === 'erase' ? 'none' : 'erase'))}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
              drawTool === 'erase'
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eraser className="h-3.5 w-3.5" /> Erase
          </button>
          <button
            type="button"
            onClick={() => {
              simRef.current.clearObstacles();
              setPreset('custom');
            }}
            title="Clear all obstacles"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      }
      canvas={
        <div className="relative aspect-[220/96] w-full select-none bg-[#070b14]">
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              paintingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              paintFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (paintingRef.current) paintFromPointer(e);
            }}
            onPointerUp={() => {
              paintingRef.current = false;
            }}
            onPointerCancel={() => {
              paintingRef.current = false;
            }}
            className={`h-full w-full touch-none ${
              drawTool === 'none' ? 'cursor-default' : 'cursor-crosshair'
            }`}
          />
        </div>
      }
      belowCanvas={
        <LivePlot
          title="Aerodynamic Force Coefficients (Momentum Exchange)"
          yUnit="C_D, C_L"
          height={150}
          version={telemetry.plotVersion}
          series={[
            { label: 'Drag Coeff C_D', color: '#fb7185', values: cdBufRef.current.toArray() },
            { label: 'Lift Coeff C_L', color: '#34d399', values: clBufRef.current.toArray() },
          ]}
        />
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Reynolds Number"
            value={telemetry.reynolds.toFixed(0)}
            unit="Re"
            color="#a78bfa"
            sublabel={
              telemetry.reynolds < 48
                ? 'Steady Laminar Regime'
                : 'Unsteady Vortex Shedding'
            }
          />
          <MetricCard
            label="Drag Coeff (C_D)"
            value={telemetry.cd.toFixed(2)}
            color="#fb7185"
            sublabel="Streamwise resistance"
          />
          <MetricCard
            label="Lift Coeff (C_L)"
            value={telemetry.cl.toFixed(2)}
            color="#34d399"
            sublabel="Oscillates w/ vortex street"
          />
          <MetricCard
            label="Lift / Drag (L/D)"
            value={
              Math.abs(telemetry.cd) > 0.05
                ? (telemetry.cl / Math.abs(telemetry.cd)).toFixed(2)
                : '—'
            }
            color="#38bdf8"
            sublabel="Aerodynamic efficiency"
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Wind className="h-3.5 w-3.5 text-violet-400" />
              Test Body Geometry
            </label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {(
                [
                  { id: 'cylinder', label: 'Cylinder' },
                  { id: 'airfoil', label: 'Airfoil' },
                  { id: 'teardrop', label: 'Teardrop' },
                  { id: 'plate', label: 'Flat Plate' },
                  { id: 'car', label: 'Car Coupe' },
                ] as { id: ObstaclePreset; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => applyPreset(opt.id, angleDeg)}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                    preset === opt.id
                      ? 'border-violet-500/45 bg-violet-500/15 text-violet-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Field Visualization</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'vorticity', label: 'Vorticity' },
                  { id: 'speed', label: 'Velocity' },
                  { id: 'pressure', label: 'Pressure' },
                ] as { id: VizMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setVizMode(m.id)}
                  className={`rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                    vizMode === m.id
                      ? 'border-sky-500/45 bg-sky-500/15 text-sky-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowSmoke((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showSmoke
                  ? 'border-slate-500/60 bg-slate-800 text-slate-100'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              Smoke Rake: {showSmoke ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setShowForces((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showForces
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              Force Vectors: {showForces ? 'ON' : 'OFF'}
            </button>
          </div>

          <ParameterSlider
            label="Angle of Attack (α)"
            value={angleDeg}
            min={-25}
            max={35}
            step={1}
            precision={0}
            unit="°"
            disabled={preset === 'cylinder' || preset === 'custom'}
            hint="Pitch airfoil, plate, or teardrop into the freestream"
            onChange={(deg) => {
              setAngleDeg(deg);
              if (preset !== 'cylinder' && preset !== 'custom') {
                simRef.current.setPreset(preset, deg);
              }
            }}
          />

          <ParameterSlider
            label="Wind Tunnel Speed (u₀)"
            value={inletSpeed}
            min={0.04}
            max={0.135}
            step={0.005}
            precision={3}
            unit="lu/ts"
            hint="Kept below Ma < 0.25 for incompressible LBM accuracy"
            onChange={(u) => {
              setInletSpeed(u);
              simRef.current.inletSpeed = u;
            }}
          />

          <ParameterSlider
            label="Kinematic Viscosity (ν)"
            value={viscosity}
            min={0.007}
            max={0.075}
            step={0.001}
            precision={3}
            unit="lu²/ts"
            hint="Higher ν → lower Re (laminar) · Lower ν → higher Re (vortex street)"
            onChange={(nu) => {
              setViscosity(nu);
              simRef.current.viscosity = nu;
            }}
          />
        </>
      }
    />
  );
}
