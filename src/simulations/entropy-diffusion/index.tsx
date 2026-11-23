import { useCallback, useEffect, useRef, useState } from 'react';
import { DoorOpen, DoorClosed, Rewind, Flame, Snowflake } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { LivePlot } from '../../components/LivePlot';
import { RingBuffer } from '../../engine/ringBuffer';
import { syncCanvasSize, thermalColor } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  GasChamberSimulation,
  type EntropyScenario,
  type GasTelemetry,
} from './physics';

const WORLD_W = 760;
const WORLD_H = 420;

export function EntropyDiffusionLab({ meta }: { meta: SimulationEntry }) {
  const [scenario, setScenario] = useState<EntropyScenario>('free-expansion');
  const [particleCount, setParticleCount] = useState(280);
  const [temperature, setTemperature] = useState(1.0);
  const [colorMode, setColorMode] = useState<'speed' | 'species'>('speed');
  const [partitionClosed, setPartitionClosed] = useState(true);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [reversedNotice, setReversedNotice] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const histCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const simRef = useRef<GasChamberSimulation>(
    new GasChamberSimulation({
      count: 280,
      width: WORLD_W,
      height: WORLD_H,
      radius: 4.5,
      temperature: 1.0,
      scenario: 'free-expansion',
    }),
  );

  const entropyBufRef = useRef<RingBuffer<number>>(new RingBuffer(240));
  const leftFracBufRef = useRef<RingBuffer<number>>(new RingBuffer(240));

  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;

  const [telemetry, setTelemetry] = useState<GasTelemetry & { plotVersion: number }>({
    entropyNormalized: 0.78,
    entropyBits: 2.7,
    leftFraction: 1,
    meanTempLeft: 1,
    meanTempRight: 0,
    pressure: 0,
    meanSpeed: 0,
    speedBins: [],
    maxBinSpeed: 420,
    plotVersion: 0,
  });

  const resetSim = useCallback(
    (nextScenario = scenario, nextCount = particleCount, nextTemp = temperature) => {
      simRef.current.reset({
        count: nextCount,
        width: WORLD_W,
        height: WORLD_H,
        radius: nextCount > 360 ? 3.8 : 4.5,
        temperature: nextTemp,
        scenario: nextScenario,
      });
      setPartitionClosed(true);
      setReversedNotice(false);
      entropyBufRef.current.clear();
      leftFracBufRef.current.clear();

      const t = simRef.current.computeTelemetry();
      entropyBufRef.current.push(t.entropyNormalized * 100);
      leftFracBufRef.current.push(t.leftFraction * 100);
      setTelemetry((prev) => ({ ...t, plotVersion: prev.plotVersion + 1 }));
    },
    [scenario, particleCount, temperature],
  );

  const togglePartition = () => {
    const next = !simRef.current.partitionClosed;
    simRef.current.partitionClosed = next;
    setPartitionClosed(next);
  };

  const handleReverseVelocities = () => {
    simRef.current.reverseVelocities();
    setReversedNotice(true);
    window.setTimeout(() => setReversedNotice(false), 2200);
  };

  const drawHistogram = useCallback((t: GasTelemetry) => {
    const canvas = histCanvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, height);

    const bins = t.speedBins;
    if (bins.length === 0) {
      ctx.restore();
      return;
    }

    const padL = 12;
    const padR = 12;
    const padT = 14;
    const padB = 20;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxBin = Math.max(1, ...bins);
    const barW = plotW / bins.length;

    for (let i = 0; i < bins.length; i++) {
      const h = (bins[i] / maxBin) * plotH;
      const x = padL + i * barW;
      const y = padT + plotH - h;
      ctx.fillStyle = thermalColor(i / (bins.length - 1));
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 1.5, y, Math.max(2, barW - 3), h);
    }
    ctx.globalAlpha = 1;

    // Overlay 2D Maxwell-Boltzmann theoretical curve: f(v) = (v / sigma^2) * exp(-v^2 / (2 sigma^2))
    // For 2D MB, <v> = sigma * sqrt(pi/2) => sigma = <v> / 1.2533
    if (t.meanSpeed > 1) {
      const sigma = t.meanSpeed / Math.sqrt(Math.PI / 2);
      const binWidth = t.maxBinSpeed / bins.length;
      const totalN = bins.reduce((a, b) => a + b, 0);

      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      const samples = 64;
      for (let i = 0; i <= samples; i++) {
        const frac = i / samples;
        const v = frac * t.maxBinSpeed;
        const pdf = (v / (sigma * sigma)) * Math.exp(-(v * v) / (2 * sigma * sigma));
        const expectedCount = pdf * binWidth * totalN;
        const x = padL + frac * plotW;
        const y = padT + plotH - Math.min(1.08, expectedCount / maxBin) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0', padL, height - 5);
    ctx.textAlign = 'center';
    ctx.fillText('Molecular Speed v →', width / 2, height - 5);
    ctx.textAlign = 'right';
    ctx.fillText('2D Maxwell-Boltzmann (white)', width - padR, 11);

    ctx.restore();
  }, []);

  const drawChamber = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sim = simRef.current;
    const sx = width / sim.width;
    const sy = height / sim.height;
    const scale = Math.min(sx, sy);
    const offX = (width - sim.width * scale) * 0.5;
    const offY = (height - sim.height * scale) * 0.5;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#060911';
    ctx.fillRect(0, 0, width, height);

    ctx.translate(offX, offY);
    const boxW = sim.width * scale;
    const boxH = sim.height * scale;

    // Chamber interior & coarse entropy grid (8x4)
    ctx.fillStyle = '#090f1d';
    ctx.fillRect(0, 0, boxW, boxH);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    for (let gx = 1; gx < 8; gx++) {
      const x = (gx / 8) * boxW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, boxH);
      ctx.stroke();
    }
    for (let gy = 1; gy < 4; gy++) {
      const y = (gy / 4) * boxH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(boxW, y);
      ctx.stroke();
    }

    // Center divider / removable partition
    const midX = boxW * 0.5;
    if (sim.partitionClosed) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, boxH);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, boxH);
      ctx.stroke();
      ctx.restore();
    }

    // Particles
    const mode = colorModeRef.current;
    const rDraw = Math.max(2.2, sim.radius * scale);
    for (let i = 0; i < sim.count; i++) {
      const px = sim.x[i] * scale;
      const py = sim.y[i] * scale;

      if (mode === 'species') {
        ctx.fillStyle = sim.species[i] === 0 ? '#38bdf8' : '#f59e0b';
      } else {
        const speedVal = Math.hypot(sim.vx[i], sim.vy[i]);
        ctx.fillStyle = thermalColor(speedVal / 290);
      }

      ctx.beginPath();
      ctx.arc(px, py, rDraw, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer chamber frame
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, boxW, boxH);

    // Zone labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('CHAMBER A', 10, 16);
    ctx.textAlign = 'right';
    ctx.fillText('CHAMBER B', boxW - 10, 16);

    ctx.restore();
  }, []);

  useEffect(() => {
    const initial = simRef.current.computeTelemetry();
    entropyBufRef.current.push(initial.entropyNormalized * 100);
    leftFracBufRef.current.push(initial.leftFraction * 100);
    drawHistogram(initial);
    setTelemetry((prev) => ({ ...initial, plotVersion: prev.plotVersion + 1 }));

    let rafId = 0;
    let lastTime = performance.now();
    let frame = 0;

    const loop = (now: number) => {
      const rawDt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        simRef.current.step(rawDt * speedRef.current);
        frame++;
        if (frame % 4 === 0) {
          const t = simRef.current.computeTelemetry();
          entropyBufRef.current.push(t.entropyNormalized * 100);
          leftFracBufRef.current.push(t.leftFraction * 100);
          drawHistogram(t);
          setTelemetry((prev) => ({ ...t, plotVersion: prev.plotVersion + 1 }));
        }
      }
      drawChamber();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawChamber, drawHistogram]);

  const handleStep = () => {
    setRunning(false);
    simRef.current.step(0.016 * speed);
    const t = simRef.current.computeTelemetry();
    entropyBufRef.current.push(t.entropyNormalized * 100);
    leftFracBufRef.current.push(t.leftFraction * 100);
    drawHistogram(t);
    drawChamber();
    setTelemetry((prev) => ({ ...t, plotVersion: prev.plotVersion + 1 }));
  };

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={handleStep}
      onReset={() => resetSim()}
      onSpeedChange={setSpeed}
      extraToolbar={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={togglePartition}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              partitionClosed
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            {partitionClosed ? (
              <>
                <DoorOpen className="h-3.5 w-3.5" /> Remove Partition
              </>
            ) : (
              <>
                <DoorClosed className="h-3.5 w-3.5" /> Insert Partition
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleReverseVelocities}
            title="Invert every particle's velocity vector (v → -v)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-300 transition-colors hover:bg-violet-500/25"
          >
            <Rewind className="h-3.5 w-3.5" />
            Reverse v → −v
          </button>
        </div>
      }
      canvas={
        <div className="relative h-[370px] w-full sm:h-[410px]">
          <canvas ref={canvasRef} className="h-full w-full" />
          {reversedNotice && (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-violet-500/50 bg-violet-950/90 px-3.5 py-1 font-mono text-xs text-violet-200 shadow-lg">
              All velocities inverted: vᵢ → −vᵢ (watch chaos break time reversal)
            </div>
          )}
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LivePlot
            title="Macrostate Entropy & Chamber Balance"
            yUnit="%"
            minY={0}
            maxY={105}
            height={145}
            version={telemetry.plotVersion}
            series={[
              {
                label: 'Entropy S / S_max',
                color: '#34d399',
                values: entropyBufRef.current.toArray(),
              },
              {
                label: 'Particles in Left %',
                color: '#38bdf8',
                values: leftFracBufRef.current.toArray(),
                dashed: true,
              },
            ]}
          />
          <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wide text-slate-200">
                Speed Distribution Histogram
              </h4>
              <span className="font-mono text-[10px] text-slate-500">
                ⟨v⟩ = {telemetry.meanSpeed.toFixed(0)} px/s
              </span>
            </div>
            <canvas
              ref={histCanvasRef}
              style={{ height: 145 }}
              className="w-full rounded-lg border border-slate-800/70"
            />
          </div>
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Entropy (S / S_max)"
            value={(telemetry.entropyNormalized * 100).toFixed(1)}
            unit="%"
            color="#34d399"
            sublabel={`S = ${telemetry.entropyBits.toFixed(2)} k_B`}
          />
          <MetricCard
            label="Chamber A Share"
            value={(telemetry.leftFraction * 100).toFixed(1)}
            unit="%"
            color="#38bdf8"
            sublabel={`Equilibrium → 50.0%`}
          />
          <MetricCard
            label="Temp A / Temp B"
            value={`${telemetry.meanTempLeft.toFixed(2)} / ${telemetry.meanTempRight.toFixed(2)}`}
            unit="T*"
            color="#f59e0b"
          />
          <MetricCard
            label="Wall Pressure"
            value={telemetry.pressure.toFixed(1)}
            unit="p*"
            color="#fb7185"
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Initial Microstate Setup</label>
            <div className="grid grid-cols-1 gap-1.5">
              {(
                [
                  {
                    id: 'free-expansion',
                    label: 'Free Expansion (All in Chamber A)',
                  },
                  {
                    id: 'thermal-mixing',
                    label: 'Thermal Equilibrium (Hot A / Cold B)',
                  },
                  {
                    id: 'species-mixing',
                    label: 'Gibbs Mixing (Two Gas Species)',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setScenario(opt.id);
                    if (opt.id === 'species-mixing') setColorMode('species');
                    else setColorMode('speed');
                    resetSim(opt.id, particleCount, temperature);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                    scenario === opt.id
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => simRef.current.scaleTemperature(1.3)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
            >
              <Flame className="h-3.5 w-3.5" /> Add Heat (+30%)
            </button>
            <button
              type="button"
              onClick={() => simRef.current.scaleTemperature(0.75)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-500/20"
            >
              <Snowflake className="h-3.5 w-3.5" /> Cool (−25%)
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Particle Coloring</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setColorMode('speed')}
                className={`rounded-lg border py-1.5 text-xs font-medium ${
                  colorMode === 'speed'
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                By Speed (Thermal)
              </button>
              <button
                type="button"
                onClick={() => setColorMode('species')}
                className={`rounded-lg border py-1.5 text-xs font-medium ${
                  colorMode === 'species'
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                By Origin / Species
              </button>
            </div>
          </div>

          <ParameterSlider
            label="Particle Count (N)"
            value={particleCount}
            min={60}
            max={480}
            step={20}
            precision={0}
            hint="Higher N shrinks statistical fluctuations (~1/√N)"
            onChange={(n) => {
              setParticleCount(n);
              resetSim(scenario, n, temperature);
            }}
          />

          <ParameterSlider
            label="Initial Temperature Scale"
            value={temperature}
            min={0.3}
            max={2.4}
            step={0.1}
            precision={1}
            unit="T₀"
            onChange={(t) => {
              setTemperature(t);
              resetSim(scenario, particleCount, t);
            }}
          />
        </>
      }
    />
  );
}
