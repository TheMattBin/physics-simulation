import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Flame, Snowflake, Shield, Cpu, Eraser } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { LivePlot } from '../../components/LivePlot';
import { RingBuffer } from '../../engine/ringBuffer';
import { clamp, syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  HEAT_NX,
  HEAT_NY,
  HeatEquation2D,
  type HeatPreset,
  type HeatTelemetry,
} from './physics';

type HeatBrush = 'heat' | 'cold' | 'insulator' | 'copper' | 'clear';

/**
 * Perceptual inferno/magma-inspired thermal colormap for 0°C -> 100°C.
 */
function tempToRGB(tempC: number): [number, number, number] {
  const t = clamp(tempC / 100, 0, 1);
  if (t < 0.25) {
    const u = t / 0.25;
    return [
      Math.round(8 + u * 26),
      Math.round(18 + u * 55),
      Math.round(52 + u * 125),
    ];
  }
  if (t < 0.5) {
    const u = (t - 0.25) / 0.25;
    return [
      Math.round(34 + u * 130),
      Math.round(73 - u * 25),
      Math.round(177 - u * 45),
    ];
  }
  if (t < 0.78) {
    const u = (t - 0.5) / 0.28;
    return [
      Math.round(164 + u * 86),
      Math.round(48 + u * 105),
      Math.round(132 - u * 100),
    ];
  }
  const u = (t - 0.78) / 0.22;
  return [
    Math.round(250 + u * 5),
    Math.round(153 + u * 97),
    Math.round(32 + u * 168),
  ];
}

const MATERIAL_NAMES = ['Steel', 'Copper (Fast)', 'Glass (Slow)', 'Insulator'];

export function HeatConductionLab({ meta }: { meta: SimulationEntry }) {
  const [preset, setPreset] = useState<HeatPreset>('dipole');
  const [brush, setBrush] = useState<HeatBrush>('heat');
  const [brushSize, setBrushSize] = useState(4);
  const [diffusivityScale, setDiffusivityScale] = useState(1.0);
  const [showFlux, setShowFlux] = useState(true);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [probe, setProbe] = useState<{ x: number; y: number; temp: number; mat: string } | null>(
    null,
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const simRef = useRef<HeatEquation2D>(new HeatEquation2D());

  const meanBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));
  const spreadBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));

  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const showFluxRef = useRef(showFlux);
  showFluxRef.current = showFlux;
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const paintingRef = useRef(false);

  const [telemetry, setTelemetry] = useState<HeatTelemetry & { plotVersion: number }>({
    meanTemp: 22,
    minTemp: 0,
    maxTemp: 100,
    thermalSpread: 100,
    simTime: 0,
    plotVersion: 0,
  });

  const loadPreset = useCallback((p: HeatPreset) => {
    setPreset(p);
    simRef.current.loadPreset(p);
    meanBufRef.current.clear();
    spreadBufRef.current.clear();
    const tel = simRef.current.getTelemetry();
    meanBufRef.current.push(tel.meanTemp);
    spreadBufRef.current.push(tel.thermalSpread);
    setTelemetry((prev) => ({ ...tel, plotVersion: prev.plotVersion + 1 }));
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!offscreenRef.current) {
      const off = document.createElement('canvas');
      off.width = HEAT_NX;
      off.height = HEAT_NY;
      offscreenRef.current = off;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        imgDataRef.current = offCtx.createImageData(HEAT_NX, HEAT_NY);
      }
    }

    const off = offscreenRef.current;
    const offCtx = off.getContext('2d');
    const imgData = imgDataRef.current;
    if (!offCtx || !imgData) return;

    const sim = simRef.current;
    const data = imgData.data;

    for (let i = 0; i < sim.size; i++) {
      const p4 = i * 4;
      const m = sim.material[i];
      if (m === 3) {
        // Dark ceramic insulator wall with subtle slate tint
        data[p4] = 30;
        data[p4 + 1] = 41;
        data[p4 + 2] = 59;
        data[p4 + 3] = 255;
      } else {
        const [r, g, b] = tempToRGB(sim.temp[i]);
        // Subtle copper metallic highlight tint if painted as copper
        data[p4] = m === 1 ? Math.min(255, r + 14) : r;
        data[p4 + 1] = g;
        data[p4 + 2] = m === 2 ? Math.min(255, b + 16) : b;
        data[p4 + 3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, width, height);

    const sx = width / HEAT_NX;
    const sy = height / HEAT_NY;

    // Optional Fourier Heat Flux Vectors q = -k grad(T)
    if (showFluxRef.current) {
      const step = 8;
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
      ctx.fillStyle = 'rgba(248, 250, 252, 0.65)';
      ctx.lineWidth = 1.1;

      for (let y = 4; y < HEAT_NY - 4; y += step) {
        for (let x = 4; x < HEAT_NX - 4; x += step) {
          const i = y * HEAT_NX + x;
          if (sim.material[i] === 3) continue;
          const dTdx = (sim.temp[i + 1] - sim.temp[i - 1]) * 0.5;
          const dTdy = (sim.temp[i + HEAT_NX] - sim.temp[i - HEAT_NX]) * 0.5;
          const qx = -dTdx;
          const qy = -dTdy;
          const mag = Math.hypot(qx, qy);
          if (mag < 0.35) continue;

          const len = Math.min(13, 3 + Math.log1p(mag) * 4.5);
          const ox = (x + 0.5) * sx;
          const oy = (y + 0.5) * sy;
          const ux = (qx / mag) * len;
          const uy = (qy / mag) * len;

          ctx.beginPath();
          ctx.moveTo(ox - ux * 0.4, oy - uy * 0.4);
          ctx.lineTo(ox + ux * 0.6, oy + uy * 0.6);
          ctx.stroke();

          const ang = Math.atan2(uy, ux);
          const ex = ox + ux * 0.6;
          const ey = oy + uy * 0.6;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - 3.5 * Math.cos(ang - 0.5), ey - 3.5 * Math.sin(ang - 0.5));
          ctx.lineTo(ex - 3.5 * Math.cos(ang + 0.5), ey - 3.5 * Math.sin(ang + 0.5));
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Material lane labels for Bimetallic Race preset
    if (presetRef.current === 'bimetallic-race') {
      ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
      ctx.font = 'bold 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('COPPER (High α)', width - 14, height * 0.17);
      ctx.fillText('STEEL (Medium α)', width - 14, height * 0.50);
      ctx.fillText('GLASS (Low α)', width - 14, height * 0.83);
    }

    // Colorbar legend in top-left
    const barW = 120;
    const barH = 8;
    const bx = 12;
    const by = 12;
    for (let k = 0; k < barW; k++) {
      const [r, g, b] = tempToRGB((k / (barW - 1)) * 100);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(bx + k, by, 1.5, barH);
    }
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, barW, barH);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0°C', bx, by + 20);
    ctx.textAlign = 'right';
    ctx.fillText('100°C', bx + barW, by + 20);

    ctx.restore();
  }, []);

  useEffect(() => {
    const initial = simRef.current.getTelemetry();
    meanBufRef.current.push(initial.meanTemp);
    spreadBufRef.current.push(initial.thermalSpread);
    setTelemetry((prev) => ({ ...initial, plotVersion: prev.plotVersion + 1 }));

    let rafId = 0;
    let frame = 0;

    const loop = () => {
      if (runningRef.current) {
        const substeps = Math.max(1, Math.round(6 * speedRef.current));
        simRef.current.step(substeps);
        frame++;
        if (frame % 4 === 0) {
          const tel = simRef.current.getTelemetry();
          meanBufRef.current.push(tel.meanTemp);
          spreadBufRef.current.push(tel.thermalSpread);
          setTelemetry((prev) => ({ ...tel, plotVersion: prev.plotVersion + 1 }));
        }
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  const getGridCoords = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const gx = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * HEAT_NX), 0, HEAT_NX - 1);
    const gy = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * HEAT_NY), 0, HEAT_NY - 1);
    return { gx, gy };
  };

  const handlePointer = (e: PointerEvent<HTMLCanvasElement>, isPaint: boolean) => {
    const coords = getGridCoords(e);
    if (!coords) return;
    if (isPaint) {
      simRef.current.paint(coords.gx, coords.gy, brushSize, brush);
      drawFrame();
    }
    const idx = coords.gy * HEAT_NX + coords.gx;
    setProbe({
      x: coords.gx,
      y: coords.gy,
      temp: simRef.current.temp[idx],
      mat: MATERIAL_NAMES[simRef.current.material[idx]] ?? 'Steel',
    });
  };

  const handleStep = () => {
    setRunning(false);
    simRef.current.step(6);
    const tel = simRef.current.getTelemetry();
    meanBufRef.current.push(tel.meanTemp);
    spreadBufRef.current.push(tel.thermalSpread);
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
      onReset={() => loadPreset(preset)}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative aspect-[136/84] w-full select-none bg-[#070b14]">
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              paintingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              handlePointer(e, true);
            }}
            onPointerMove={(e) => handlePointer(e, paintingRef.current)}
            onPointerUp={() => {
              paintingRef.current = false;
            }}
            onPointerLeave={() => {
              paintingRef.current = false;
              setProbe(null);
            }}
            className="h-full w-full cursor-crosshair touch-none"
          />
          {probe && (
            <div className="pointer-events-none absolute right-3 bottom-3 rounded-lg border border-slate-700/80 bg-[#060911]/90 px-2.5 py-1 font-mono text-[11px] text-slate-200">
              ({probe.x}, {probe.y}) · {probe.mat} ·{' '}
              <span className="text-amber-300">{probe.temp.toFixed(1)}°C</span>
            </div>
          )}
        </div>
      }
      belowCanvas={
        <LivePlot
          title="Thermal Relaxation & Equilibrium Tracking"
          yUnit="°C"
          minY={0}
          maxY={105}
          height={148}
          version={telemetry.plotVersion}
          series={[
            { label: 'Mean Plate Temp', color: '#f59e0b', values: meanBufRef.current.toArray() },
            {
              label: 'Max − Min Gradient ΔT',
              color: '#38bdf8',
              values: spreadBufRef.current.toArray(),
              dashed: true,
            },
          ]}
        />
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Mean Temperature"
            value={telemetry.meanTemp.toFixed(1)}
            unit="°C"
            color="#f59e0b"
          />
          <MetricCard
            label="Gradient ΔT"
            value={telemetry.thermalSpread.toFixed(1)}
            unit="°C"
            color="#38bdf8"
            sublabel="0°C = full equilibrium"
          />
          <MetricCard
            label="Peak / Minimum"
            value={`${telemetry.maxTemp.toFixed(0)} / ${telemetry.minTemp.toFixed(0)}`}
            unit="°C"
            color="#fb7185"
          />
          <MetricCard
            label="Elapsed Sim Time"
            value={telemetry.simTime.toFixed(1)}
            unit="τ"
            color="#34d399"
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Plate Experiment Preset</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'dipole', label: 'Dipole + Baffle' },
                  { id: 'bimetallic-race', label: 'Material Race' },
                  { id: 'insulated-maze', label: 'Thermal Maze' },
                  { id: 'hot-spot', label: 'Gaussian Pulse' },
                ] as { id: HeatPreset; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => loadPreset(opt.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    preset === opt.id
                      ? 'border-amber-500/45 bg-amber-500/15 text-amber-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Canvas Paint Brush</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'heat', label: 'Hot (100°C)', icon: Flame, active: 'border-rose-500/50 bg-rose-500/15 text-rose-300' },
                  { id: 'cold', label: 'Cold (0°C)', icon: Snowflake, active: 'border-sky-500/50 bg-sky-500/15 text-sky-300' },
                  { id: 'insulator', label: 'Insulator', icon: Shield, active: 'border-slate-500/60 bg-slate-700/40 text-slate-100' },
                  { id: 'copper', label: 'Copper Path', icon: Cpu, active: 'border-amber-500/50 bg-amber-500/15 text-amber-300' },
                  { id: 'clear', label: 'Clear / Steel', icon: Eraser, active: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' },
                ] as const
              ).map((b) => {
                const Icon = b.icon;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBrush(b.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      brush === b.id
                        ? b.active
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFlux((v) => !v)}
            className={`w-full rounded-lg border py-1.5 text-xs font-medium transition-colors ${
              showFlux
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
          >
            Fourier Heat Flux Arrows (q = −k∇T): {showFlux ? 'ON' : 'OFF'}
          </button>

          <ParameterSlider
            label="Brush Radius"
            value={brushSize}
            min={2}
            max={10}
            step={1}
            precision={0}
            unit="cells"
            onChange={setBrushSize}
          />

          <ParameterSlider
            label="Thermal Diffusivity Scale (α)"
            value={diffusivityScale}
            min={0.2}
            max={1.05}
            step={0.05}
            precision={2}
            unit="×"
            hint="Scales rate of conductive spread across all materials"
            onChange={(val) => {
              setDiffusivityScale(val);
              simRef.current.diffusivityScale = val;
            }}
          />
        </>
      }
    />
  );
}
