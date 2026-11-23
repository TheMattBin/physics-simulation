import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LabShell } from '../../components/LabShell';
import { LivePlot } from '../../components/LivePlot';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { RingBuffer } from '../../engine/ringBuffer';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import { QCOLORS, drawQuantum } from './draw';
import { TransmissionPlot } from './TransmissionPlot';
import {
  GRID,
  Schrodinger1D,
  advanceClassical,
  buildPotential,
  energySpread,
  freeWidth,
  groupVelocity,
  packetK0,
  packetStart,
  packetTransmission,
  transmission,
  type ClassicalState,
  type Potential,
  type QuantumParams,
} from './physics';

type PresetId = 'free' | 'tunnel' | 'over' | 'double';

const PRESETS: { id: PresetId; label: string; params: QuantumParams }[] = [
  { id: 'free', label: 'Free Wave Packet', params: { kind: 'free', E0: 5, sigma0: 0.6, V0: 6, width: 0.2, gap: 1 } },
  { id: 'tunnel', label: 'Tunneling Barrier', params: { kind: 'barrier', E0: 4, sigma0: 1, V0: 6, width: 0.2, gap: 1 } },
  { id: 'over', label: 'Over the Barrier', params: { kind: 'barrier', E0: 6, sigma0: 1, V0: 4, width: 0.3, gap: 1 } },
  { id: 'double', label: 'Resonant Double Barrier', params: { kind: 'double', E0: 2.38, sigma0: 3, V0: 5, width: 0.2, gap: 1 } },
];

const SIM_FS_PER_SECOND = 8;
const MAX_STEPS_PER_FRAME = 60;
const STEP_FS = 0.1;
const PLOT_CAPACITY = 300;

interface QLab {
  solver: Schrodinger1D;
  pot: Potential;
  classical: ClassicalState;
  x0: number;
  rhoMax: number;
  pending: number;
}

function freshLab(p: QuantumParams): QLab {
  const pot = buildPotential(p);
  const solver = new Schrodinger1D(pot);
  const x0 = packetStart(p, pot);
  solver.setGaussian(x0, p.sigma0, p.E0);
  return {
    solver,
    pot,
    classical: { x: x0, dir: 1 },
    x0,
    rhoMax: 1.15 / (Math.sqrt(2 * Math.PI) * p.sigma0),
    pending: 0,
  };
}

interface Telemetry {
  version: number;
  t: number;
  R: number;
  T: number;
  middle: number;
  meanX: number;
  sigmaX: number;
  probErr: number;
}

function snapshot(lab: QLab, version: number): Telemetry {
  const s = lab.solver;
  const o = s.observables(lab.pot);
  return {
    version,
    t: s.t,
    R: o.left + s.absorbedLeft,
    T: o.right + s.absorbedRight,
    middle: o.middle,
    meanX: o.meanX,
    sigmaX: o.sigmaX,
    probErr: Math.abs(o.inside + s.absorbedLeft + s.absorbedRight - 1),
  };
}

function ToggleButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
        on ? 'border-lime-500/40 bg-lime-500/15 text-lime-300' : 'border-slate-800 bg-slate-900 text-slate-400'
      }`}
    >
      {label}: {on ? 'ON' : 'OFF'}
    </button>
  );
}

export function QuantumTunnelingLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<QuantumParams>(PRESETS[1].params);
  const [presetId, setPresetId] = useState<PresetId>('tunnel');
  const [phaseColors, setPhaseColors] = useState(true);
  const [showReIm, setShowReIm] = useState(false);
  const [showClassical, setShowClassical] = useState(true);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  const labRef = useRef<QLab>(freshLab(PRESETS[1].params));
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const flagsRef = useRef({ phaseColors, showReIm, showClassical });
  flagsRef.current = { phaseColors, showReIm, showClassical };

  const [buffers] = useState(() => ({
    R: new RingBuffer<number>(PLOT_CAPACITY),
    T: new RingBuffer<number>(PLOT_CAPACITY),
    mid: new RingBuffer<number>(PLOT_CAPACITY),
    sum: new RingBuffer<number>(PLOT_CAPACITY),
    sigma: new RingBuffer<number>(PLOT_CAPACITY),
    sigmaTh: new RingBuffer<number>(PLOT_CAPACITY),
    x: new RingBuffer<number>(PLOT_CAPACITY),
    xTh: new RingBuffer<number>(PLOT_CAPACITY),
  }));
  const [telemetry, setTelemetry] = useState<Telemetry>(() => snapshot(labRef.current, 0));

  const pushSample = useCallback(() => {
    const lab = labRef.current;
    const p = paramsRef.current;
    const tm = snapshot(lab, 0);
    buffers.R.push(tm.R);
    buffers.T.push(tm.T);
    buffers.mid.push(tm.middle);
    buffers.sum.push(tm.R + tm.T + tm.middle);
    buffers.sigma.push(tm.sigmaX);
    buffers.sigmaTh.push(freeWidth(p.sigma0, tm.t));
    buffers.x.push(tm.meanX);
    buffers.xTh.push(lab.x0 + groupVelocity(p.E0) * tm.t);
  }, [buffers]);

  const publish = useCallback(() => {
    setTelemetry((prev) => snapshot(labRef.current, prev.version + 1));
  }, []);

  const reset = useCallback(() => {
    labRef.current = freshLab(paramsRef.current);
    for (const b of Object.values(buffers)) b.clear();
    pushSample();
    publish();
  }, [buffers, publish, pushSample]);

  const advance = useCallback((fs: number) => {
    const lab = labRef.current;
    lab.pending += fs;
    const n = Math.min(MAX_STEPS_PER_FRAME, Math.floor(lab.pending / GRID.dt));
    for (let i = 0; i < n; i++) lab.solver.step();
    lab.pending = n === MAX_STEPS_PER_FRAME ? 0 : lab.pending - n * GRID.dt;
    advanceClassical(lab.classical, paramsRef.current.E0, lab.pot, n * GRID.dt);
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const lab = labRef.current;
    const s = lab.solver;
    const o = s.observables(lab.pot);
    ctx.save();
    ctx.scale(dpr, dpr);
    drawQuantum(
      ctx,
      width,
      height,
      {
        solver: s,
        pot: lab.pot,
        params: paramsRef.current,
        classical: lab.classical,
        rhoMax: lab.rhoMax,
        R: o.left + s.absorbedLeft,
        T: o.right + s.absorbedRight,
        inside: o.inside,
      },
      flagsRef.current,
    );
    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      // The first rAF timestamp can precede the mount time, so clamp at zero.
      const rawDt = Math.max(0, Math.min(0.032, (now - lastTime) / 1000));
      lastTime = now;
      if (runningRef.current) {
        advance(rawDt * speedRef.current * SIM_FS_PER_SECOND);
        frame++;
        if (frame % 2 === 0) pushSample();
        if (frame % 4 === 0) publish();
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advance, drawFrame, publish, pushSample]);

  const applyParams = (next: QuantumParams) => {
    paramsRef.current = next;
    setParams(next);
    reset();
  };
  const updateParams = (patch: Partial<QuantumParams>) => applyParams({ ...paramsRef.current, ...patch });

  const loadPreset = (id: PresetId) => {
    const preset = PRESETS.find((pr) => pr.id === id);
    if (!preset) return;
    setPresetId(id);
    applyParams(preset.params);
    setRunning(true);
  };

  const handleStep = () => {
    setRunning(false);
    advance(STEP_FS * speed);
    pushSample();
    publish();
    drawFrame();
  };

  const p = params;
  const pot = useMemo(() => buildPotential(p), [p]);
  const theoryT = useMemo(() => packetTransmission(p, pot), [p, pot]);
  const planeT = useMemo(() => transmission(p.E0, pot), [p, pot]);
  const k0 = packetK0(p.E0);
  const lambda = (2 * Math.PI) / k0;
  const dE = energySpread(p);
  const vMax = Math.max(0, ...pot.regions.map((r) => r.V));
  const classicallyReflects = p.kind !== 'free' && p.E0 < vMax;
  const tm = telemetry;
  const free = p.kind === 'free';

  const metrics = free ? (
    <div className="grid grid-cols-2 gap-2.5">
      <MetricCard
        label="Position ⟨x⟩"
        value={tm.meanX.toFixed(2)}
        unit="nm"
        color={QCOLORS.real}
        sublabel={`theory ${(labRef.current.x0 + groupVelocity(p.E0) * tm.t).toFixed(2)} nm`}
      />
      <MetricCard
        label="Width σ(t)"
        value={tm.sigmaX.toFixed(3)}
        unit="nm"
        color={QCOLORS.density}
        sublabel={`theory ${freeWidth(p.sigma0, tm.t).toFixed(3)} nm`}
      />
      <MetricCard
        label="Δx·Δp / (ħ/2)"
        value={(tm.sigmaX / p.sigma0).toFixed(2)}
        color="#a78bfa"
        sublabel="≥ 1; equals 1 only at t = 0"
      />
      <MetricCard
        label="Group Velocity"
        value={groupVelocity(p.E0).toFixed(3)}
        unit="nm/fs"
        color={QCOLORS.real}
        sublabel="v = ħk₀ / m"
      />
      <MetricCard
        label="de Broglie λ"
        value={lambda.toFixed(3)}
        unit="nm"
        color={QCOLORS.imag}
        sublabel="λ = 2π / k₀ = h / p"
      />
      <MetricCard
        label="Probability Check"
        value={tm.probErr.toExponential(1)}
        color="#34d399"
        sublabel="|inside + absorbed − 1|"
      />
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-2.5">
      <MetricCard
        label="Reflected R"
        value={tm.R.toFixed(3)}
        color={QCOLORS.reflected}
        sublabel={`classical particle: ${classicallyReflects ? '1.000' : '0.000'}`}
      />
      <MetricCard
        label="Transmitted T"
        value={tm.T.toFixed(3)}
        color={QCOLORS.transmitted}
        sublabel={`theory ${theoryT.toFixed(3)} (whole packet)`}
      />
      <MetricCard
        label="Plane Wave T(E₀)"
        value={planeT.toFixed(3)}
        color="#a78bfa"
        sublabel="a single energy, no spread"
      />
      <MetricCard
        label="Energy Spread ΔE"
        value={`± ${dE.toFixed(2)}`}
        unit="eV"
        color={QCOLORS.potential}
        sublabel="narrower packets: wider ΔE"
      />
      <MetricCard
        label="de Broglie λ"
        value={lambda.toFixed(3)}
        unit="nm"
        color={QCOLORS.imag}
        sublabel={`barrier is ${(p.width / lambda).toFixed(2)} λ wide`}
      />
      <MetricCard
        label="Probability Check"
        value={tm.probErr.toExponential(1)}
        color="#34d399"
        sublabel="|R + T + P_barrier − 1|"
      />
    </div>
  );

  const belowCanvas = free ? (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <LivePlot
        title="Packet width σ(t)"
        yUnit="nm"
        height={150}
        version={tm.version}
        series={[
          { label: 'measured', color: QCOLORS.density, values: buffers.sigma.toArray() },
          { label: 'theory', color: '#e2e8f0', values: buffers.sigmaTh.toArray(), dashed: true },
        ]}
      />
      <LivePlot
        title="Packet centre ⟨x⟩(t)"
        yUnit="nm"
        height={150}
        version={tm.version}
        series={[
          { label: 'measured', color: QCOLORS.real, values: buffers.x.toArray() },
          { label: 'x₀ + v t', color: '#e2e8f0', values: buffers.xTh.toArray(), dashed: true },
        ]}
      />
    </div>
  ) : (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <LivePlot
        title="Where is the electron?"
        yUnit="probability"
        height={150}
        minY={0}
        maxY={1.05}
        version={tm.version}
        series={[
          { label: 'R', color: QCOLORS.reflected, values: buffers.R.toArray() },
          { label: 'T', color: QCOLORS.transmitted, values: buffers.T.toArray() },
          { label: 'in barrier', color: QCOLORS.potential, values: buffers.mid.toArray() },
          { label: 'total', color: '#e2e8f0', values: buffers.sum.toArray(), dashed: true },
        ]}
      />
      <TransmissionPlot params={p} pot={pot} measuredT={tm.T} />
    </div>
  );

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={handleStep}
      onReset={() => {
        reset();
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative h-[380px] w-full sm:h-[470px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={belowCanvas}
      metrics={metrics}
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Scenario</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => loadPreset(pr.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    presetId === pr.id
                      ? 'border-lime-500/45 bg-lime-500/15 text-lime-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <ToggleButton on={phaseColors} label="Phase Colours" onClick={() => setPhaseColors((v) => !v)} />
            <ToggleButton on={showReIm} label="Re / Im Parts" onClick={() => setShowReIm((v) => !v)} />
            <ToggleButton
              on={showClassical}
              label="Classical Particle"
              onClick={() => setShowClassical((v) => !v)}
            />
          </div>

          <ParameterSlider
            label="Packet Energy (E₀)"
            value={p.E0}
            min={0.5}
            max={15}
            step={0.01}
            precision={2}
            unit="eV"
            onChange={(E0) => updateParams({ E0 })}
          />
          <ParameterSlider
            label="Packet Width (σ₀)"
            value={p.sigma0}
            min={0.3}
            max={3}
            step={0.05}
            precision={2}
            unit="nm"
            hint="Narrow in space = broad in momentum and energy"
            onChange={(sigma0) => updateParams({ sigma0 })}
          />
          {!free && (
            <>
              <ParameterSlider
                label="Barrier Height (V₀)"
                value={p.V0}
                min={-10}
                max={15}
                step={0.1}
                precision={1}
                unit="eV"
                hint="Negative values make a potential well"
                onChange={(V0) => updateParams({ V0 })}
              />
              <ParameterSlider
                label="Barrier Width (a)"
                value={p.width}
                min={0.05}
                max={2}
                step={0.01}
                precision={2}
                unit="nm"
                onChange={(width) => updateParams({ width })}
              />
            </>
          )}
          {p.kind === 'double' && (
            <ParameterSlider
              label="Gap Between Barriers"
              value={p.gap}
              min={0.2}
              max={3}
              step={0.01}
              precision={2}
              unit="nm"
              onChange={(gap) => updateParams({ gap })}
            />
          )}
        </>
      }
    />
  );
}
