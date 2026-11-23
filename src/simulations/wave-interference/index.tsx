import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Waves } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { clamp, syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  WAVE_NX,
  WAVE_NY,
  WaveTank2D,
  type WavePreset,
  type WaveTelemetry,
} from './physics';

function waveToRGB(u: number, isGlass: boolean): [number, number, number] {
  const v = clamp(u * 1.65, -1, 1);
  const mag = Math.pow(Math.abs(v), 0.78);
  const baseR = isGlass ? 16 : 7;
  const baseG = isGlass ? 26 : 11;
  const baseB = isGlass ? 44 : 20;

  if (v >= 0) {
    // Positive crest -> electric cyan/white
    return [
      Math.round(baseR + mag * (56 + mag * 145)),
      Math.round(baseG + mag * 215),
      Math.round(baseB + mag * 235),
    ];
  }
  // Negative trough -> luminous magenta/rose
  return [
    Math.round(baseR + mag * 238),
    Math.round(baseG + mag * 72),
    Math.round(baseB + mag * 155),
  ];
}

export function WaveInterferenceLab({ meta }: { meta: SimulationEntry }) {
  const [preset, setPreset] = useState<WavePreset>('double-slit');
  const [frequency, setFrequency] = useState(0.055);
  const [slitSeparation, setSlitSeparation] = useState(24);
  const [slitWidth, setSlitWidth] = useState(6);
  const [phaseOffsetDeg, setPhaseOffsetDeg] = useState(0);
  const [refractiveIndex, setRefractiveIndex] = useState(1.65);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);
  const simRef = useRef<WaveTank2D>(new WaveTank2D());

  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const [telemetry, setTelemetry] = useState<WaveTelemetry>({
    wavelengthPx: 4.2,
    frequencyHz: 6.6,
    slitSeparation: 22,
    fringeSpacing: 20,
    peakIntensity: 0,
  });

  const reconfigure = useCallback(
    (patch: {
      preset?: WavePreset;
      frequency?: number;
      slitSeparation?: number;
      slitWidth?: number;
      phaseOffsetDeg?: number;
      refractiveIndex?: number;
    }) => {
      const sim = simRef.current;
      if (patch.frequency !== undefined) sim.frequency = patch.frequency;
      if (patch.slitSeparation !== undefined) sim.slitSeparation = patch.slitSeparation;
      if (patch.slitWidth !== undefined) sim.slitWidth = patch.slitWidth;
      if (patch.phaseOffsetDeg !== undefined) sim.phaseOffsetDeg = patch.phaseOffsetDeg;
      if (patch.refractiveIndex !== undefined) sim.refractiveIndex = patch.refractiveIndex;
      sim.configure(patch.preset ?? sim.preset);
      setTelemetry(sim.getTelemetry());
    },
    [],
  );

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!offscreenRef.current) {
      const off = document.createElement('canvas');
      off.width = WAVE_NX;
      off.height = WAVE_NY;
      offscreenRef.current = off;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        imgDataRef.current = offCtx.createImageData(WAVE_NX, WAVE_NY);
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
      if (sim.barrier[i] === 1) {
        data[p4] = 203;
        data[p4 + 1] = 213;
        data[p4 + 2] = 225;
        data[p4 + 3] = 255;
      } else {
        const isGlass = sim.cField[i] < 0.44;
        const [r, g, b] = waveToRGB(sim.u[i], isGlass);
        data[p4] = r;
        data[p4 + 1] = g;
        data[p4 + 2] = b;
        data[p4 + 3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Reserve right 16% strip for the live Optical Detector Screen Intensity Profile I(y)
    const screenW = Math.max(76, Math.round(width * 0.16));
    const tankW = width - screenW;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, tankW, height);

    // Subtle detector sensor vertical guide inside tank
    const detScreenX = ((WAVE_NX - 14) / WAVE_NX) * tankW;
    ctx.save();
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(detScreenX, 6);
    ctx.lineTo(detScreenX, height - 6);
    ctx.stroke();
    ctx.restore();

    // Right Panel: Detector Intensity I(y)
    ctx.fillStyle = '#060911';
    ctx.fillRect(tankW, 0, screenW, height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tankW, 0);
    ctx.lineTo(tankW, height);
    ctx.stroke();

    let maxI = 1e-4;
    for (let y = 6; y < WAVE_NY - 6; y++) {
      if (sim.detectorIntensity[y] > maxI) maxI = sim.detectorIntensity[y];
    }

    // Draw bright fringe strip + horizontal intensity curve
    const stripW = 10;
    const curveLeft = tankW + stripW + 6;
    const curveMaxW = Math.max(12, screenW - stripW - 14);

    ctx.beginPath();
    for (let y = 4; y < WAVE_NY - 4; y++) {
      const norm = clamp(sim.detectorIntensity[y] / maxI, 0, 1);
      const py = (y / WAVE_NY) * height;
      const rowH = height / WAVE_NY + 0.8;

      // Glowing optical fringe bar
      ctx.fillStyle = `rgba(56, 189, 248, ${(0.08 + norm * 0.92).toFixed(3)})`;
      ctx.fillRect(tankW + 2, py, stripW, rowH);

      const cx = curveLeft + norm * curveMaxW;
      if (y === 4) ctx.moveTo(cx, py);
      else ctx.lineTo(cx, py);
    }
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCREEN I(y)', tankW + screenW * 0.5, 16);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
    ctx.fillText('CYAN = CREST (+u) · MAGENTA = TROUGH (−u) · CLICK TANK TO DROP RIPPLE', 12, 16);

    if (sim.preset === 'refraction') {
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('n₁ = 1.00 (AIR)', 20, height - 12);
      ctx.textAlign = 'right';
      ctx.fillText(`n₂ = ${sim.refractiveIndex.toFixed(2)} (GLASS)`, tankW - 16, height - 12);
    }

    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let frame = 0;

    const loop = () => {
      if (runningRef.current) {
        const substeps = Math.max(1, Math.round(2 * speedRef.current));
        simRef.current.step(substeps);
        frame++;
        if (frame % 6 === 0) {
          setTelemetry(simRef.current.getTelemetry());
        }
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  const handleTankClick = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const tankW = rect.width - Math.max(76, Math.round(rect.width * 0.16));
    const localX = e.clientX - rect.left;
    if (localX > tankW) return;
    const gx = (localX / tankW) * WAVE_NX;
    const gy = ((e.clientY - rect.top) / rect.height) * WAVE_NY;
    simRef.current.dropRipple(gx, gy, 1.8);
    drawFrame();
  };

  const handleStep = () => {
    setRunning(false);
    simRef.current.step(2);
    setTelemetry(simRef.current.getTelemetry());
    drawFrame();
  };

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={handleStep}
      onReset={() => reconfigure({})}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative aspect-[190/102] w-full select-none bg-[#060911]">
          <canvas
            ref={canvasRef}
            onPointerDown={handleTankClick}
            className="h-full w-full cursor-pointer touch-none"
          />
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Wavelength (λ)"
            value={telemetry.wavelengthPx.toFixed(1)}
            unit="cells"
            color="#38bdf8"
            sublabel="λ = c / f"
          />
          <MetricCard
            label="Fringe Spacing (Δy)"
            value={preset === 'double-slit' ? telemetry.fringeSpacing.toFixed(1) : '—'}
            unit={preset === 'double-slit' ? 'cells' : ''}
            color="#f472b6"
            sublabel="Δy ≈ λL / d"
          />
          <MetricCard
            label="Slit / Source Sep (d)"
            value={slitSeparation.toFixed(0)}
            unit="cells"
            color="#a78bfa"
          />
          <MetricCard
            label="Glass Index (n₂)"
            value={preset === 'refraction' ? refractiveIndex.toFixed(2) : '1.00'}
            color="#34d399"
            sublabel={preset === 'refraction' ? `v₂ = c / ${refractiveIndex.toFixed(2)}` : 'Uniform medium'}
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Waves className="h-3.5 w-3.5 text-pink-400" />
              Optical Experiment Preset
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'double-slit', label: 'Double Slit' },
                  { id: 'two-sources', label: 'Two Point Sources' },
                  { id: 'single-slit', label: 'Single-Slit Diff.' },
                  { id: 'refraction', label: "Snell's Refraction" },
                ] as { id: WavePreset; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setPreset(opt.id);
                    reconfigure({ preset: opt.id });
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    preset === opt.id
                      ? 'border-pink-500/45 bg-pink-500/15 text-pink-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <ParameterSlider
            label="Wave Frequency (f)"
            value={frequency}
            min={0.025}
            max={0.095}
            step={0.005}
            precision={3}
            unit="cyc/ts"
            hint="Higher frequency shortens wavelength λ = c / f"
            onChange={(f) => {
              setFrequency(f);
              simRef.current.frequency = f;
              setTelemetry(simRef.current.getTelemetry());
            }}
          />

          <ParameterSlider
            label="Slit / Source Separation (d)"
            value={slitSeparation}
            min={10}
            max={44}
            step={2}
            precision={0}
            unit="cells"
            disabled={preset === 'single-slit' || preset === 'refraction'}
            hint="Wider separation d squeezes fringes closer (Δy ∝ 1/d)"
            onChange={(d) => {
              setSlitSeparation(d);
              reconfigure({ slitSeparation: d });
            }}
          />

          <ParameterSlider
            label="Slit Aperture Width (a)"
            value={slitWidth}
            min={4}
            max={20}
            step={2}
            precision={0}
            unit="cells"
            disabled={preset === 'two-sources' || preset === 'refraction'}
            hint="Narrower slits spread waves wider by Huygens diffraction"
            onChange={(w) => {
              setSlitWidth(w);
              reconfigure({ slitWidth: w });
            }}
          />

          <ParameterSlider
            label="Source Phase Offset (Δφ)"
            value={phaseOffsetDeg}
            min={0}
            max={360}
            step={15}
            precision={0}
            unit="°"
            disabled={preset !== 'two-sources'}
            hint="180° swaps bright central antinode into a dark nodal line"
            onChange={(deg) => {
              setPhaseOffsetDeg(deg);
              simRef.current.phaseOffsetDeg = deg;
            }}
          />

          <ParameterSlider
            label="Medium Refractive Index (n₂)"
            value={refractiveIndex}
            min={1.0}
            max={2.4}
            step={0.05}
            precision={2}
            disabled={preset !== 'refraction'}
            hint="Air: 1.0 · Water: 1.33 · Glass: 1.50 · Diamond: 2.42"
            onChange={(n) => {
              setRefractiveIndex(n);
              reconfigure({ refractiveIndex: n });
            }}
          />
        </>
      }
    />
  );
}
