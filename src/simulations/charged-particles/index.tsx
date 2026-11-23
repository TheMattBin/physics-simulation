import { useCallback, useEffect, useRef, useState } from 'react';
import { LabShell } from '../../components/LabShell';
import { LivePlot } from '../../components/LivePlot';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { RingBuffer } from '../../engine/ringBuffer';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import { Histogram } from './Histogram';
import { COLORS, GHOST_FADE, drawLab, speedColor, type Runtime } from './draw';
import {
  AMU,
  E_CHARGE,
  NEON_ISOTOPES,
  SELECTOR,
  SPECIES,
  SPECTROMETER,
  advanceParticle,
  cyclotronPeriod,
  driftVelocity,
  kineticEnergy,
  larmorRadius,
  launchUniform,
  massFromLanding,
  uniformStep,
  potentialEnergy,
  selectedSpeed,
  spawnBeamParticle,
  speciesById,
  type FieldParams,
  type Particle,
} from './physics';

type PresetId = 'cyclotron' | 'exb' | 'selector' | 'spectrometer';

const PRESETS: { id: PresetId; label: string; params: FieldParams }[] = [
  {
    id: 'cyclotron',
    label: 'Cyclotron Orbit',
    params: { scenario: 'uniform', speciesId: 'proton', v0: 100e3, E: 0, B: 0.02, B2: 0.3 },
  },
  {
    id: 'exb',
    label: 'E × B Drift',
    params: { scenario: 'uniform', speciesId: 'proton', v0: 0, E: 2000, B: 0.04, B2: 0.3 },
  },
  {
    id: 'selector',
    label: 'Velocity Selector',
    params: { scenario: 'selector', speciesId: 'proton', v0: 100e3, E: 500, B: 0.005, B2: 0.3 },
  },
  {
    id: 'spectrometer',
    label: 'Mass Spectrometer',
    params: { scenario: 'spectrometer', speciesId: 'proton', v0: 100e3, E: 30000, B: 0.3, B2: 0.3 },
  },
];

const SIM_PER_REAL = 1e-6; // 1 µs of physics per real second at 1x
const STEP_SIM_TIME = 0.02e-6;
const TRAIL_SPACING = 0.0008; // m between stored trail points
const TRAIL_CAP = 3000; // stored coordinates for the uniform-field trails
const MAX_GHOSTS = 80;
const MAX_HITS = 5000;
const PLOT_CAPACITY = 300;
const SPEED_BINS = 20;
const MASS_MIN = 19;
const MASS_MAX = 23;
const MASS_BINS = 100;

interface Diagnostics {
  e0: number;
  u0: number;
  keMax: number;
  maxErr: number;
  angle: number; // accumulated gyration angle of v − v_d (rad)
  tFlying: number;
  prevWx: number;
  prevWy: number;
  hasPrev: boolean;
}

interface LabState {
  rt: Runtime;
  step: number; // fixed Boris step for uniform-field runs (s)
  pending: number; // simulated time not yet integrated (less than one step)
  spawned: number;
  spawnBudget: number;
  emitted: number;
  detected: number;
  speedEmitted: number[];
  speedPassed: number[];
  passSum: number;
  passSumSq: number;
  massCounts: number[][];
  diag: Diagnostics;
}

function freshLab(p: FieldParams, withTwin: boolean): LabState {
  const primary = p.scenario === 'uniform' ? launchUniform(p, 1) : null;
  const twin = p.scenario === 'uniform' && withTwin ? launchUniform(p, -1) : null;
  const e0 = primary ? kineticEnergy(primary) + potentialEnergy(primary, p) : 0;
  return {
    step: primary ? uniformStep(primary, p) : 0,
    pending: 0,
    rt: {
      t: 0,
      primary,
      twin,
      primaryTrail: primary ? [primary.x, primary.y] : [],
      twinTrail: twin ? [twin.x, twin.y] : [],
      beam: [],
      ghosts: [],
      hits: [],
      transmitted: 0,
    },
    spawned: 0,
    spawnBudget: 0,
    emitted: 0,
    detected: 0,
    speedEmitted: new Array(SPEED_BINS).fill(0),
    speedPassed: new Array(SPEED_BINS).fill(0),
    passSum: 0,
    passSumSq: 0,
    massCounts: NEON_ISOTOPES.map(() => new Array(MASS_BINS).fill(0)),
    diag: {
      e0,
      u0: primary ? potentialEnergy(primary, p) : 0,
      keMax: primary ? kineticEnergy(primary) : 0,
      maxErr: 0,
      angle: 0,
      tFlying: 0,
      // Seed with the launch velocity (in the drift frame) so the first step's rotation counts.
      prevWx: primary ? primary.vx - driftVelocity(p.E, p.B) : 0,
      prevWy: primary ? primary.vy : 0,
      hasPrev: primary !== null,
    },
  };
}

function appendTrail(trail: number[], pt: Particle, cap?: number) {
  const n = trail.length;
  if (n >= 2 && Math.hypot(pt.x - trail[n - 2], pt.y - trail[n - 1]) < TRAIL_SPACING) return;
  trail.push(pt.x, pt.y);
  if (cap && trail.length > cap * 1.25) trail.splice(0, trail.length - cap);
}

function speedBin(v: number): number {
  const f = (v - SELECTOR.speedMin) / (SELECTOR.speedMax - SELECTOR.speedMin);
  return Math.min(SPEED_BINS - 1, Math.max(0, Math.floor(f * SPEED_BINS)));
}

interface Telemetry {
  version: number;
  t: number;
  speed: number;
  ke: number;
  measuredT: number | null;
  energyErr: number | null;
  emitted: number;
  transmitted: number;
  detected: number;
  passMean: number | null;
  passSd: number | null;
  speedEmitted: number[];
  speedPassed: number[];
  massCounts: number[][];
}

function snapshot(lab: LabState, version: number): Telemetry {
  const pr = lab.rt.primary;
  const d = lab.diag;
  const n = lab.rt.transmitted;
  const mean = n > 0 ? lab.passSum / n : null;
  return {
    version,
    t: lab.rt.t,
    speed: pr ? Math.hypot(pr.vx, pr.vy) : 0,
    ke: pr ? kineticEnergy(pr) : 0,
    measuredT: Math.abs(d.angle) > 0.3 ? (2 * Math.PI * d.tFlying) / Math.abs(d.angle) : null,
    energyErr: pr && d.keMax > 0 ? d.maxErr / d.keMax : null,
    emitted: lab.emitted,
    transmitted: n,
    detected: lab.detected,
    passMean: mean,
    passSd: mean !== null && n > 1 ? Math.sqrt(Math.max(0, lab.passSumSq / n - mean * mean)) : null,
    speedEmitted: lab.speedEmitted.slice(),
    speedPassed: lab.speedPassed.slice(),
    massCounts: lab.massCounts.map((c) => c.slice()),
  };
}

const eV = (joules: number) => joules / E_CHARGE;

function ToggleButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
        on
          ? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
          : 'border-slate-800 bg-slate-900 text-slate-400'
      }`}
    >
      {label}: {on ? 'ON' : 'OFF'}
    </button>
  );
}

export function ChargedParticlesLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<FieldParams>(PRESETS[0].params);
  const [presetId, setPresetId] = useState<PresetId>('cyclotron');
  const [showTwin, setShowTwin] = useState(false);
  const [showVectors, setShowVectors] = useState(true);
  const [showTheory, setShowTheory] = useState(true);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  const twinRef = useRef(showTwin);
  const labRef = useRef<LabState>(freshLab(PRESETS[0].params, false));
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const flagsRef = useRef({ showVectors, showTheory });
  flagsRef.current = { showVectors, showTheory };

  const [buffers] = useState(() => ({
    vx: new RingBuffer<number>(PLOT_CAPACITY),
    vy: new RingBuffer<number>(PLOT_CAPACITY),
    speed: new RingBuffer<number>(PLOT_CAPACITY),
    ke: new RingBuffer<number>(PLOT_CAPACITY),
    pe: new RingBuffer<number>(PLOT_CAPACITY),
    total: new RingBuffer<number>(PLOT_CAPACITY),
  }));
  const [telemetry, setTelemetry] = useState<Telemetry>(() => snapshot(labRef.current, 0));

  const publish = useCallback(() => {
    setTelemetry((prev) => snapshot(labRef.current, prev.version + 1));
  }, []);

  const pushSample = useCallback(() => {
    const lab = labRef.current;
    const pr = lab.rt.primary;
    if (!pr || pr.state !== 'flying') return;
    const ke = eV(kineticEnergy(pr));
    const pe = eV(potentialEnergy(pr, paramsRef.current) - lab.diag.u0);
    buffers.vx.push(pr.vx / 1000);
    buffers.vy.push(pr.vy / 1000);
    buffers.speed.push(Math.hypot(pr.vx, pr.vy) / 1000);
    buffers.ke.push(ke);
    buffers.pe.push(pe);
    buffers.total.push(ke + pe);
  }, [buffers]);

  const reset = useCallback(() => {
    labRef.current = freshLab(paramsRef.current, twinRef.current);
    for (const b of Object.values(buffers)) b.clear();
    pushSample();
    publish();
  }, [buffers, publish, pushSample]);

  /** Advances the whole lab by dt seconds of simulated time. */
  const advance = useCallback((dt: number) => {
    const lab = labRef.current;
    const rt = lab.rt;
    const p = paramsRef.current;

    if (p.scenario === 'uniform') {
      // Integrate whole fixed steps only; carry the remainder into the next frame.
      lab.pending += dt;
      const nSteps = Math.floor(lab.pending / lab.step);
      dt = nSteps * lab.step;
      lab.pending -= dt;
      const vd = driftVelocity(p.E, p.B);
      const d = lab.diag;
      const pr = rt.primary;
      if (pr && pr.state === 'flying' && nSteps > 0) {
        advanceParticle(pr, p, dt, (pt) => {
          appendTrail(rt.primaryTrail, pt, TRAIL_CAP);
          const ke = kineticEnergy(pt);
          d.keMax = Math.max(d.keMax, ke);
          d.maxErr = Math.max(d.maxErr, Math.abs(ke + potentialEnergy(pt, p) - d.e0));
          const wx = pt.vx - vd;
          const wy = pt.vy;
          if (d.hasPrev) {
            d.angle += Math.atan2(d.prevWx * wy - d.prevWy * wx, d.prevWx * wx + d.prevWy * wy);
          }
          d.prevWx = wx;
          d.prevWy = wy;
          d.hasPrev = true;
        }, lab.step);
        if (pr.state === 'flying') d.tFlying += dt;
        else appendTrail(rt.primaryTrail, pr);
      }
      if (rt.twin && rt.twin.state === 'flying' && nSteps > 0) {
        advanceParticle(rt.twin, p, dt, (pt) => appendTrail(rt.twinTrail, pt, TRAIL_CAP), lab.step);
      }
    } else {
      const g = p.scenario === 'selector' ? SELECTOR : SPECTROMETER;
      lab.spawnBudget += g.rate * dt;
      while (lab.spawnBudget >= 1) {
        lab.spawnBudget -= 1;
        const pt = spawnBeamParticle(p, lab.spawned++);
        lab.emitted++;
        if (p.scenario === 'selector') lab.speedEmitted[speedBin(pt.launchSpeed)]++;
        const color =
          p.scenario === 'selector' ? speedColor(pt.launchSpeed) : COLORS.isotopes[pt.speciesIndex];
        rt.beam.push({ pt, trail: [pt.x, pt.y], color });
      }

      const survivors: typeof rt.beam = [];
      for (const b of rt.beam) {
        advanceParticle(b.pt, p, dt, (pt) => appendTrail(b.trail, pt));
        if (b.pt.state === 'flying') {
          survivors.push(b);
          continue;
        }
        b.trail.push(b.pt.x, b.pt.y);
        rt.ghosts.push({ trail: b.trail, color: b.color, diedAt: rt.t });
        if (b.pt.state === 'transmitted') {
          rt.transmitted++;
          lab.speedPassed[speedBin(b.pt.launchSpeed)]++;
          const v = b.pt.launchSpeed / 1000;
          lab.passSum += v;
          lab.passSumSq += v * v;
        } else if (b.pt.state === 'detected' && b.pt.detectorD !== undefined) {
          lab.detected++;
          if (rt.hits.length < MAX_HITS) rt.hits.push({ y: b.pt.y, speciesIndex: b.pt.speciesIndex });
          const m = massFromLanding(b.pt.detectorD, p);
          const bin = Math.floor(((m - MASS_MIN) / (MASS_MAX - MASS_MIN)) * MASS_BINS);
          if (bin >= 0 && bin < MASS_BINS) lab.massCounts[b.pt.speciesIndex][bin]++;
        }
      }
      rt.beam = survivors;
      rt.ghosts = rt.ghosts.filter((gh) => rt.t - gh.diedAt < GHOST_FADE).slice(-MAX_GHOSTS);
    }
    rt.t += dt;
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    drawLab(ctx, width, height, paramsRef.current, labRef.current.rt, flagsRef.current);
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
        advance(rawDt * speedRef.current * SIM_PER_REAL);
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

  // Any change of fields, particle or scenario starts a fresh run.
  const applyParams = (next: FieldParams) => {
    paramsRef.current = next;
    setParams(next);
    reset();
  };
  const updateParams = (patch: Partial<FieldParams>) => applyParams({ ...paramsRef.current, ...patch });

  const loadPreset = (id: PresetId) => {
    const preset = PRESETS.find((pr) => pr.id === id);
    if (!preset) return;
    setPresetId(id);
    applyParams(preset.params);
    setRunning(true);
  };

  const handleStep = () => {
    setRunning(false);
    advance(STEP_SIM_TIME * speed);
    pushSample();
    publish();
    drawFrame();
  };

  const p = params;
  const species = speciesById(p.speciesId);
  const mass = species.massU * AMU;
  const charge = species.charge * E_CHARGE;
  const vd = driftVelocity(p.E, p.B);
  const rTheory = larmorRadius(mass, charge, Math.abs(p.v0 - Math.abs(vd)), p.B);
  const tTheory = cyclotronPeriod(mass, charge, p.B);
  const vSel = selectedSpeed(p);
  const tm = telemetry;

  const metrics =
    p.scenario === 'uniform' ? (
      <div className="grid grid-cols-2 gap-2.5">
        <MetricCard
          label="Speed |v|"
          value={(tm.speed / 1000).toFixed(2)}
          unit="km/s"
          color="#38bdf8"
          sublabel={`launched at ${(p.v0 / 1000).toFixed(0)} km/s`}
        />
        <MetricCard
          label="Kinetic Energy"
          value={eV(tm.ke).toFixed(2)}
          unit="eV"
          color="#f59e0b"
          sublabel={p.E === 0 ? 'B does no work: KE fixed' : 'trades with qφ; sum fixed'}
        />
        <MetricCard
          label="Larmor Radius r_L"
          value={Number.isFinite(rTheory) ? (rTheory * 100).toFixed(2) : '∞'}
          unit="cm"
          color={COLORS.bField}
          sublabel="r = m v⊥ / |q|B"
        />
        <MetricCard
          label="Cyclotron Period T"
          value={Number.isFinite(tTheory) ? (tTheory * 1e6).toFixed(3) : '∞'}
          unit="µs"
          color={COLORS.bField}
          sublabel={
            tm.measuredT !== null ? `measured ${(tm.measuredT * 1e6).toFixed(3)} µs` : 'T = 2πm / |q|B'
          }
        />
        <MetricCard
          label="E × B Drift v_d"
          value={(Math.abs(vd) / 1000).toFixed(2)}
          unit="km/s"
          color={COLORS.eField}
          sublabel="E / B, for any q or m"
        />
        <MetricCard
          label="Energy Check"
          value={tm.energyErr !== null ? tm.energyErr.toExponential(1) : '—'}
          color="#34d399"
          sublabel="|Δ(KE + qφ)| / KE_max"
        />
      </div>
    ) : p.scenario === 'selector' ? (
      <div className="grid grid-cols-2 gap-2.5">
        <MetricCard
          label="Selected Speed E/B"
          value={Number.isFinite(vSel) ? (vSel / 1000).toFixed(1) : '∞'}
          unit="km/s"
          color="#34d399"
          sublabel="same for any q or m"
        />
        <MetricCard
          label="Plate Voltage ΔV"
          value={(Math.abs(p.E) * (SELECTOR.plateTop - SELECTOR.plateBottom)).toFixed(0)}
          unit="V"
          color={COLORS.eField}
          sublabel="E = ΔV / d, d = 8 cm"
        />
        <MetricCard
          label="Transmitted"
          value={`${tm.transmitted} / ${tm.emitted}`}
          color="#38bdf8"
          sublabel={tm.emitted > 0 ? `${((100 * tm.transmitted) / tm.emitted).toFixed(1)}% of the beam` : 'waiting for ions'}
        />
        <MetricCard
          label="Passed Speeds"
          value={tm.passMean !== null ? tm.passMean.toFixed(1) : '—'}
          unit="km/s"
          color="#f59e0b"
          sublabel={tm.passSd !== null ? `spread ± ${tm.passSd.toFixed(1)} km/s` : 'mean of transmitted ions'}
        />
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-2.5">
        <MetricCard
          label="Selected Speed E/B₁"
          value={Number.isFinite(vSel) ? (vSel / 1000).toFixed(1) : '∞'}
          unit="km/s"
          color="#34d399"
          sublabel="all ions leave at this speed"
        />
        <MetricCard
          label="Ne-20 Orbit Radius"
          value={
            Number.isFinite(vSel)
              ? ((NEON_ISOTOPES[0].massU * AMU * vSel) / (E_CHARGE * p.B2) * 100).toFixed(2)
              : '∞'
          }
          unit="cm"
          color={COLORS.bField}
          sublabel="r = m v / q B₂"
        />
        <MetricCard
          label="Ions Detected"
          value={`${tm.detected} / ${tm.emitted}`}
          color="#38bdf8"
          sublabel="rest stopped by selector"
        />
        <MetricCard
          label="Ne-22 : Ne-20"
          value={(() => {
            const n20 = tm.massCounts[0].reduce((a, b) => a + b, 0);
            const n22 = tm.massCounts[2].reduce((a, b) => a + b, 0);
            return n20 > 0 ? (n22 / n20).toFixed(3) : '—';
          })()}
          color="#f59e0b"
          sublabel="natural abundance ≈ 0.102"
        />
      </div>
    );

  const belowCanvas =
    p.scenario === 'uniform' ? (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LivePlot
          title="Velocity of the particle"
          yUnit="km/s"
          height={150}
          version={tm.version}
          series={[
            { label: 'v_x', color: '#38bdf8', values: buffers.vx.toArray() },
            { label: 'v_y', color: '#a78bfa', values: buffers.vy.toArray() },
            { label: '|v|', color: '#e2e8f0', values: buffers.speed.toArray() },
          ]}
        />
        <LivePlot
          title="Energy since launch"
          yUnit="eV"
          height={150}
          version={tm.version}
          series={[
            { label: 'KE', color: '#f59e0b', values: buffers.ke.toArray() },
            { label: 'qΔφ', color: '#f472b6', values: buffers.pe.toArray() },
            { label: 'KE + qΔφ', color: '#34d399', values: buffers.total.toArray(), dashed: true },
          ]}
        />
      </div>
    ) : p.scenario === 'selector' ? (
      <Histogram
        title="Speed spectrum: emitted vs. through the slit"
        xUnit="km/s"
        xMin={SELECTOR.speedMin / 1000}
        xMax={SELECTOR.speedMax / 1000}
        xTicks={[50, 75, 100, 125, 150]}
        version={tm.version}
        series={[
          { label: 'Emitted', color: '#334155', counts: tm.speedEmitted },
          { label: 'Transmitted', color: '#34d399', counts: tm.speedPassed },
        ]}
        markers={
          Number.isFinite(vSel) && vSel >= SELECTOR.speedMin && vSel <= SELECTOR.speedMax
            ? [{ x: vSel / 1000, label: 'E/B', color: '#e2e8f0' }]
            : []
        }
        footer="Every ion is pushed one way by qE and the other way by qvB. They cancel only when v = E/B."
      />
    ) : (
      <Histogram
        title="Mass spectrum (calibrated with m = q B₂ D / 2v)"
        xUnit="u"
        xMin={MASS_MIN}
        xMax={MASS_MAX}
        xTicks={[19, 20, 21, 22, 23]}
        version={tm.version}
        series={NEON_ISOTOPES.map((iso, i) => ({
          label: iso.short,
          color: COLORS.isotopes[i],
          counts: tm.massCounts[i],
        }))}
        markers={NEON_ISOTOPES.map((iso, i) => ({
          x: iso.massU,
          label: iso.short,
          color: COLORS.isotopes[i],
        }))}
        footer="Ne-21 is only 0.27% of natural neon (about 1 ion in 370), so its peak takes a while to appear."
      />
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
        <div className="relative h-[310px] w-full sm:h-[470px]">
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
                      ? 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          {p.scenario !== 'spectrometer' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Particle</label>
              <div className="grid grid-cols-2 gap-1.5">
                {SPECIES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => updateParams({ speciesId: s.id })}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      p.speciesId === s.id
                        ? s.charge > 0
                          ? 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                          : 'border-sky-500/45 bg-sky-500/15 text-sky-200'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                m = {species.massU.toFixed(3)} u · q = {species.charge > 0 ? '+' : '−'}
                {Math.abs(species.charge)}e
              </p>
            </div>
          )}

          {p.scenario === 'uniform' && (
            <>
              <div className="flex flex-wrap gap-2">
                <ToggleButton
                  on={showTwin}
                  label="Opposite-Charge Twin"
                  onClick={() => {
                    twinRef.current = !twinRef.current;
                    setShowTwin(twinRef.current);
                    reset();
                  }}
                />
                <ToggleButton on={showVectors} label="Force Vectors" onClick={() => setShowVectors((v) => !v)} />
                <ToggleButton on={showTheory} label="Theory Orbit" onClick={() => setShowTheory((v) => !v)} />
              </div>
              <ParameterSlider
                label="Launch Speed (v₀)"
                value={p.v0 / 1000}
                min={0}
                max={300}
                step={1}
                precision={0}
                unit="km/s"
                onChange={(v) => updateParams({ v0: v * 1000 })}
              />
              <ParameterSlider
                label="Magnetic Field (B)"
                value={p.B * 1000}
                min={-50}
                max={50}
                step={0.5}
                precision={1}
                unit="mT"
                hint="+ points out of the page (⊙), − into the page (⊗)"
                onChange={(v) => updateParams({ B: v / 1000 })}
              />
              <ParameterSlider
                label="Electric Field (E)"
                value={p.E / 1000}
                min={-5}
                max={5}
                step={0.05}
                precision={2}
                unit="kV/m"
                hint="+ points up the page"
                onChange={(v) => updateParams({ E: v * 1000 })}
              />
            </>
          )}

          {p.scenario === 'selector' && (
            <>
              <ParameterSlider
                label="Electric Field (E)"
                value={p.E / 1000}
                min={0}
                max={2}
                step={0.01}
                precision={2}
                unit="kV/m"
                onChange={(v) => updateParams({ E: v * 1000 })}
              />
              <ParameterSlider
                label="Magnetic Field (B)"
                value={p.B * 1000}
                min={0}
                max={20}
                step={0.1}
                precision={1}
                unit="mT"
                hint="The beam contains every speed from 50 to 150 km/s"
                onChange={(v) => updateParams({ B: v / 1000 })}
              />
            </>
          )}

          {p.scenario === 'spectrometer' && (
            <>
              <ParameterSlider
                label="Selector Electric Field (E)"
                value={p.E / 1000}
                min={5}
                max={40}
                step={0.1}
                precision={1}
                unit="kV/m"
                onChange={(v) => updateParams({ E: v * 1000 })}
              />
              <ParameterSlider
                label="Selector Magnetic Field (B₁)"
                value={p.B * 1000}
                min={50}
                max={400}
                step={1}
                precision={0}
                unit="mT"
                hint="Raise E and B₁ together (same E/B₁) for sharper peaks but fewer ions"
                onChange={(v) => updateParams({ B: v / 1000 })}
              />
              <ParameterSlider
                label="Analyzer Magnetic Field (B₂)"
                value={p.B2 * 1000}
                min={200}
                max={600}
                step={1}
                precision={0}
                unit="mT"
                hint="Sample: natural neon gas, singly ionized (Ne-20, Ne-21, Ne-22)"
                onChange={(v) => updateParams({ B2: v / 1000 })}
              />
            </>
          )}
        </>
      }
    />
  );
}
