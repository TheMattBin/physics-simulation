import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, TrendingUp } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { LivePlot, type PlotSeries } from '../../components/LivePlot';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { RingBuffer } from '../../engine/ringBuffer';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import { FORCE_COLORS, drawLab } from './draw';
import {
  NUDGE_SPEED,
  computeForces,
  initialState,
  stepNewton,
  trackLimits,
  type ForceBreakdown,
  type NewtonParams,
  type NewtonState,
} from './physics';

type PresetId = 'ramp' | 'table' | 'pulley' | 'atwood';

const PRESETS: { id: PresetId; label: string; params: NewtonParams }[] = [
  {
    id: 'ramp',
    label: 'Block on Ramp',
    params: {
      scenario: 'incline',
      ropeAttached: false,
      m1: 5,
      m2: 3,
      thetaDeg: 20,
      muS: 0.45,
      muK: 0.3,
      appliedForce: 0,
      gravity: 9.81,
    },
  },
  {
    id: 'table',
    label: 'Push on Table',
    params: {
      scenario: 'incline',
      ropeAttached: false,
      m1: 5,
      m2: 3,
      thetaDeg: 0,
      muS: 0.5,
      muK: 0.3,
      appliedForce: 0,
      gravity: 9.81,
    },
  },
  {
    id: 'pulley',
    label: 'Ramp + Hanging Mass',
    params: {
      scenario: 'incline',
      ropeAttached: true,
      m1: 4,
      m2: 3.5,
      thetaDeg: 30,
      muS: 0.3,
      muK: 0.2,
      appliedForce: 0,
      gravity: 9.81,
    },
  },
  {
    id: 'atwood',
    label: 'Atwood Machine',
    params: {
      scenario: 'atwood',
      ropeAttached: true,
      m1: 2,
      m2: 2.2,
      thetaDeg: 0,
      muS: 0,
      muK: 0,
      appliedForce: 0,
      gravity: 9.81,
    },
  },
];

const PLOT_CAPACITY = 360; // ~12 s of history at one sample every 2 frames
const RAMP_RATE = 4; // N/s for the automatic push ramp
const MAX_APPLIED = 80; // N
const STEP_DT = 1 / 30;

interface Buffers {
  friction: RingBuffer<number>;
  applied: RingBuffer<number>;
  tension: RingBuffer<number>;
  net: RingBuffer<number>;
  velocity: RingBuffer<number>;
  accel: RingBuffer<number>;
}

function createBuffers(): Buffers {
  return {
    friction: new RingBuffer(PLOT_CAPACITY),
    applied: new RingBuffer(PLOT_CAPACITY),
    tension: new RingBuffer(PLOT_CAPACITY),
    net: new RingBuffer(PLOT_CAPACITY),
    velocity: new RingBuffer(PLOT_CAPACITY),
    accel: new RingBuffer(PLOT_CAPACITY),
  };
}

interface Telemetry {
  t: number;
  v: number;
  forces: ForceBreakdown;
  plotVersion: number;
}

function snapshot(st: NewtonState, p: NewtonParams, plotVersion: number): Telemetry {
  return { t: st.t, v: st.v, forces: computeForces(st, p), plotVersion };
}

function signed(value: number, digits = 2): string {
  const v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${v > 0 ? '+' : v < 0 ? '−' : ' '}${Math.abs(v).toFixed(digits)}`;
}

function LedgerRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-slate-400">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </dt>
      <dd className="text-slate-200">{signed(value)} N</dd>
    </div>
  );
}

function ToggleButton({
  on,
  onClick,
  children,
  tone,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
  tone: 'pink' | 'violet' | 'slate';
}) {
  const active = {
    pink: 'border-pink-500/40 bg-pink-500/15 text-pink-300',
    violet: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
    slate: 'border-slate-500/50 bg-slate-500/15 text-slate-200',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
        on ? active : 'border-slate-800 bg-slate-900 text-slate-400'
      }`}
    >
      {children}: {on ? 'ON' : 'OFF'}
    </button>
  );
}

export function NewtonsLawsLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<NewtonParams>(PRESETS[0].params);
  const [presetId, setPresetId] = useState<PresetId>('ramp');
  const [showComponents, setShowComponents] = useState(false);
  const [showPairs, setShowPairs] = useState(false);
  const [ramping, setRamping] = useState(false);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [buffers] = useState(createBuffers);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // paramsRef is the loop's source of truth (the push ramp advances it every frame);
  // React state mirrors it for the sliders, so it is only ever written alongside setParams.
  const paramsRef = useRef(params);
  const stateRef = useRef<NewtonState>(initialState(PRESETS[0].params));
  const rampingRef = useRef(false);
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const flagsRef = useRef({ showComponents, showPairs });
  flagsRef.current = { showComponents, showPairs };

  const [telemetry, setTelemetry] = useState<Telemetry>(() =>
    snapshot(stateRef.current, paramsRef.current, 0),
  );

  const pushSample = useCallback(() => {
    const st = stateRef.current;
    const fb = computeForces(st, paramsRef.current);
    buffers.friction.push(fb.friction);
    buffers.applied.push(fb.applied);
    buffers.tension.push(fb.tension);
    buffers.net.push(fb.net1);
    buffers.velocity.push(st.v);
    buffers.accel.push(fb.acceleration);
  }, [buffers]);

  const publish = useCallback(() => {
    setTelemetry((prev) => snapshot(stateRef.current, paramsRef.current, prev.plotVersion + 1));
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    drawLab(ctx, width, height, paramsRef.current, stateRef.current, flagsRef.current);
    ctx.restore();
  }, []);

  const resetMotion = useCallback(
    (startS?: number) => {
      const st = initialState(paramsRef.current);
      stateRef.current = startS === undefined ? st : { ...st, s: startS };
      for (const b of Object.values(buffers)) b.clear();
      pushSample();
      publish();
    },
    [buffers, pushSample, publish],
  );

  const commitParams = (next: NewtonParams) => {
    paramsRef.current = next;
    setParams(next);
  };

  const stopRamp = () => {
    rampingRef.current = false;
    setRamping(false);
  };

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let frame = 0;

    const loop = (now: number) => {
      const rawDt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        const dt = rawDt * speedRef.current;
        const wasRamping = rampingRef.current;
        let p = paramsRef.current;
        if (wasRamping) {
          p = { ...p, appliedForce: Math.min(MAX_APPLIED, p.appliedForce + RAMP_RATE * dt) };
          paramsRef.current = p;
        }

        stateRef.current = stepNewton(stateRef.current, p, dt);

        let rampEnded = false;
        if (wasRamping) {
          const atTop = stateRef.current.s >= trackLimits(p).max - 1e-6;
          if (p.appliedForce >= MAX_APPLIED || atTop) {
            rampingRef.current = false;
            setRamping(false);
            rampEnded = true;
          }
        }

        frame++;
        if (frame % 2 === 0) pushSample();
        if (frame % 4 === 0 || rampEnded) {
          publish();
          if (wasRamping) setParams(paramsRef.current);
        }
      }

      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame, publish, pushSample]);

  const updateParams = (patch: Partial<NewtonParams>) => {
    const next = { ...paramsRef.current, ...patch };
    // Kinetic friction can never exceed static friction.
    if (patch.muS !== undefined && next.muK > next.muS) next.muK = next.muS;
    if (patch.muK !== undefined) next.muK = Math.min(next.muK, next.muS);
    commitParams(next);
    publish(); // keep readouts live while paused
  };

  const loadPreset = (id: PresetId) => {
    const preset = PRESETS.find((pr) => pr.id === id);
    if (!preset) return;
    stopRamp();
    setPresetId(id);
    commitParams(preset.params);
    resetMotion();
    setRunning(true);
  };

  const toggleRamp = () => {
    if (rampingRef.current) {
      stopRamp();
      return;
    }
    const next = { ...paramsRef.current, appliedForce: 0 };
    commitParams(next);
    // Start near the low end of the track so the push has the most room to accelerate the block.
    resetMotion(trackLimits(next).min + 0.25);
    rampingRef.current = true;
    setRamping(true);
    setRunning(true);
  };

  const nudge = (dir: 1 | -1) => {
    const st = stateRef.current;
    stateRef.current = { ...st, v: st.v + dir * NUDGE_SPEED };
    publish();
  };

  const handleStep = () => {
    setRunning(false);
    stateRef.current = stepNewton(stateRef.current, paramsRef.current, STEP_DT * speed);
    pushSample();
    publish();
    drawFrame();
  };

  const fb = telemetry.forces;
  const atwood = params.scenario === 'atwood';
  const hasRope = fb.hasRope;
  const g = params.gravity;
  const thetaCritical = (Math.atan(params.muS) * 180) / Math.PI;

  const frictionSublabel =
    fb.regime === 'static'
      ? `static · ${Math.round((fb.gripUsed ?? 0) * 100)}% of μ_s·N used`
      : fb.regime === 'kinetic'
        ? 'kinetic · μ_k·N'
        : fb.regime === 'end-stop'
          ? 'held at end stop'
          : 'frictionless';

  const forceSeries: PlotSeries[] = atwood
    ? [
        { label: 'Tension T', color: FORCE_COLORS.tension, values: buffers.tension.toArray() },
        { label: 'Net ΣF on m₁', color: FORCE_COLORS.net, values: buffers.net.toArray() },
      ]
    : [
        { label: 'Friction f', color: FORCE_COLORS.friction, values: buffers.friction.toArray() },
        { label: 'Applied F', color: FORCE_COLORS.applied, values: buffers.applied.toArray() },
        ...(hasRope
          ? [{ label: 'Tension T', color: FORCE_COLORS.tension, values: buffers.tension.toArray() }]
          : []),
        { label: 'Net ΣF', color: FORCE_COLORS.net, values: buffers.net.toArray() },
      ];

  const axisNote = atwood
    ? '+ = m₁ moving up'
    : hasRope
      ? '+ = up-slope, toward pulley'
      : params.thetaDeg < 0.05
        ? '+ = to the right'
        : '+ = up-slope';

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={handleStep}
      onReset={() => {
        stopRamp();
        resetMotion();
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative h-[620px] w-full sm:h-[470px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LivePlot
            title={`Forces on m₁ (${axisNote})`}
            yUnit="N"
            height={150}
            version={telemetry.plotVersion}
            series={forceSeries}
          />
          <LivePlot
            title="Motion of m₁"
            yUnit="m/s · m/s²"
            height={150}
            version={telemetry.plotVersion}
            series={[
              { label: 'Velocity v', color: FORCE_COLORS.velocity, values: buffers.velocity.toArray() },
              {
                label: 'Acceleration a',
                color: '#a78bfa',
                values: buffers.accel.toArray(),
                dashed: true,
              },
            ]}
          />
        </div>
      }
      metrics={
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Acceleration a"
              value={signed(fb.acceleration)}
              unit="m/s²"
              color={FORCE_COLORS.velocity}
              sublabel={
                atwood
                  ? `a / g = ${((Math.abs(fb.acceleration) / Math.max(1e-9, g)) * 100).toFixed(1)}%`
                  : hasRope
                    ? 'ΣF / (m₁ + m₂)'
                    : 'ΣF / m₁'
              }
            />
            <MetricCard
              label="Velocity v"
              value={signed(telemetry.v)}
              unit="m/s"
              color={FORCE_COLORS.velocity}
              sublabel={`t = ${telemetry.t.toFixed(2)} s`}
            />
            {atwood ? (
              <>
                <MetricCard
                  label="Tension T"
                  value={fb.tension.toFixed(2)}
                  unit="N"
                  color={FORCE_COLORS.tension}
                  sublabel={`between m₁g = ${fb.weight1.toFixed(1)} and m₂g = ${fb.weight2.toFixed(1)}`}
                />
                <MetricCard
                  label="Theory a"
                  value={signed(((params.m2 - params.m1) * g) / (params.m1 + params.m2))}
                  unit="m/s²"
                  color="#a78bfa"
                  sublabel="(m₂ − m₁)g / (m₁ + m₂)"
                />
              </>
            ) : (
              <>
                <MetricCard
                  label="Friction |f|"
                  value={Math.abs(fb.friction).toFixed(2)}
                  unit="N"
                  color={FORCE_COLORS.friction}
                  sublabel={frictionSublabel}
                />
                <MetricCard
                  label="Normal Force N"
                  value={fb.normal.toFixed(2)}
                  unit="N"
                  color={FORCE_COLORS.normal}
                  sublabel="= m₁g cos θ"
                />
                {hasRope ? (
                  <MetricCard
                    label="Tension T"
                    value={fb.tension.toFixed(2)}
                    unit="N"
                    color={FORCE_COLORS.tension}
                    sublabel={`m₂g = ${fb.weight2.toFixed(1)} N`}
                  />
                ) : (
                  <MetricCard
                    label="Critical Angle θ_c"
                    value={thetaCritical.toFixed(1)}
                    unit="°"
                    color="#a78bfa"
                    sublabel="tan θ_c = μ_s (slips above it)"
                  />
                )}
                <MetricCard
                  label="Net Force ΣF on m₁"
                  value={signed(fb.net1)}
                  unit="N"
                  color={FORCE_COLORS.net}
                  sublabel={`= m₁a = ${signed(params.m1 * fb.acceleration)} N`}
                />
              </>
            )}
          </div>

          <div className="rounded-lg border border-slate-800/90 bg-[#080d18] p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              ΣF = ma ledger · m₁ ({axisNote})
            </div>
            <dl className="space-y-1 font-mono text-[11px] tabular-nums">
              {Math.abs(fb.applied) > 0.005 && (
                <LedgerRow label="Applied push F" value={fb.applied} color={FORCE_COLORS.applied} />
              )}
              {hasRope && <LedgerRow label="Tension T" value={fb.tension} color={FORCE_COLORS.tension} />}
              <LedgerRow
                label={atwood ? 'Weight −m₁g' : 'Gravity −m₁g sin θ'}
                value={fb.weightParallel}
                color={FORCE_COLORS.weight}
              />
              {!atwood && (
                <LedgerRow
                  label={`Friction (${
                    fb.regime === 'kinetic'
                      ? 'kinetic'
                      : fb.regime === 'frictionless'
                        ? 'none'
                        : 'static'
                  })`}
                  value={fb.friction}
                  color={FORCE_COLORS.friction}
                />
              )}
              {Math.abs(fb.stopReaction) > 0.005 && (
                <LedgerRow label="End stop R" value={fb.stopReaction} color={FORCE_COLORS.stop} />
              )}
              <div className="my-1.5 border-t border-slate-800" />
              <div className="flex items-center justify-between gap-3 font-semibold">
                <dt className="text-emerald-300">ΣF</dt>
                <dd className="text-emerald-300">{signed(fb.net1)} N</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">m₁ · a</dt>
                <dd className="text-slate-200">{signed(params.m1 * fb.acceleration)} N</dd>
              </div>
              {hasRope && (
                <div className="flex items-center justify-between gap-3 pt-1 text-slate-500">
                  <dt>m₂: m₂g − T = m₂a</dt>
                  <dd>
                    {signed(fb.net2)} = {signed(params.m2 * fb.acceleration)} N
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      }
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
                      ? 'border-sky-500/45 bg-sky-500/15 text-sky-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!atwood && (
              <ToggleButton
                on={showComponents}
                onClick={() => setShowComponents((v) => !v)}
                tone="pink"
              >
                W Components
              </ToggleButton>
            )}
            <ToggleButton on={showPairs} onClick={() => setShowPairs((v) => !v)} tone="violet">
              3rd-Law Pairs
            </ToggleButton>
            {!atwood && (
              <ToggleButton
                on={params.ropeAttached}
                onClick={() => {
                  stopRamp();
                  commitParams({ ...paramsRef.current, ropeAttached: !paramsRef.current.ropeAttached });
                  resetMotion();
                }}
                tone="slate"
              >
                Rope + m₂
              </ToggleButton>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              Nudge (Δv = {NUDGE_SPEED.toFixed(1)} m/s)
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => nudge(-1)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
                {atwood ? 'm₁ down' : params.thetaDeg < 0.05 && !hasRope ? 'Left' : 'Down-slope'}
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
              >
                {atwood ? 'm₁ up' : params.thetaDeg < 0.05 && !hasRope ? 'Right' : 'Up-slope'}
                <ChevronsRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {!atwood && (
            <>
              <ParameterSlider
                label="Applied Push (F)"
                value={params.appliedForce}
                min={-MAX_APPLIED}
                max={MAX_APPLIED}
                step={0.5}
                precision={1}
                unit="N"
                hint="+ pushes up-slope (toward the pulley), − pushes down-slope"
                onChange={(appliedForce) => {
                  stopRamp();
                  updateParams({ appliedForce });
                }}
              />
              <button
                type="button"
                onClick={toggleRamp}
                className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  ramping
                    ? 'animate-pulse border-amber-400/60 bg-amber-500/25 text-amber-200'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                {ramping
                  ? `Ramping push… ${params.appliedForce.toFixed(1)} N (click to stop)`
                  : `Ramp Push from 0 N (+${RAMP_RATE} N/s)`}
              </button>
              <ParameterSlider
                label="Incline Angle (θ)"
                value={params.thetaDeg}
                min={0}
                max={60}
                step={0.5}
                precision={1}
                unit="°"
                onChange={(thetaDeg) => updateParams({ thetaDeg })}
              />
              <ParameterSlider
                label="Static Friction (μ_s)"
                value={params.muS}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                onChange={(muS) => updateParams({ muS })}
              />
              <ParameterSlider
                label="Kinetic Friction (μ_k)"
                value={params.muK}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                hint="Capped at μ_s: sliding friction never exceeds the static limit"
                onChange={(muK) => updateParams({ muK })}
              />
            </>
          )}

          <ParameterSlider
            label={atwood ? 'Left Mass (m₁)' : 'Block Mass (m₁)'}
            value={params.m1}
            min={0.5}
            max={10}
            step={0.1}
            precision={1}
            unit="kg"
            onChange={(m1) => updateParams({ m1 })}
          />
          {hasRope && (
            <ParameterSlider
              label={atwood ? 'Right Mass (m₂)' : 'Hanging Mass (m₂)'}
              value={params.m2}
              min={0.5}
              max={10}
              step={0.1}
              precision={1}
              unit="kg"
              onChange={(m2) => updateParams({ m2 })}
            />
          )}
          <ParameterSlider
            label="Gravity (g)"
            value={params.gravity}
            min={1.62}
            max={24.79}
            step={0.01}
            precision={2}
            unit="m/s²"
            hint="Moon: 1.62 · Earth: 9.81 · Jupiter: 24.79"
            onChange={(gravity) => updateParams({ gravity })}
          />
        </>
      }
    />
  );
}
