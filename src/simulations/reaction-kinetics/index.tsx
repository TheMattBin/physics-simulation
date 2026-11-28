import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  drawArrhenius,
  drawConcentration,
  drawEnergyDistribution,
  drawEnergyProfile,
  drawReactor,
  type KineticsFrame,
} from './draw';
import {
  AREA,
  ReactionGas,
  effectiveBarrier,
  equilibriumConstant,
  equilibriumExtent,
  forwardRateConstant,
  fractionAbove,
  theoryFractionAbove,
  type ArrheniusPoint,
  type ConcMode,
  type KineticsParams,
} from './physics';

type PresetId = 'second' | 'excess' | 'catalyst' | 'runaway' | 'reversible';

const SECOND: KineticsParams = {
  nA: 150,
  nB: 150,
  temperature: 700,
  activationEnergy: 20,
  enthalpy: -5,
  stericFactor: 1,
  catalyst: false,
  catalystDrop: 10,
  thermal: 'isothermal',
  reversible: false,
};

const PRESETS: { id: PresetId; label: string; params: KineticsParams }[] = [
  { id: 'second', label: 'Equal A and B', params: SECOND },
  { id: 'excess', label: 'B in Excess', params: { ...SECOND, nA: 50, nB: 300 } },
  { id: 'catalyst', label: 'With Catalyst', params: { ...SECOND, catalyst: true } },
  {
    id: 'runaway',
    label: 'Thermal Runaway',
    params: { ...SECOND, nA: 130, nB: 130, temperature: 500, activationEnergy: 25, enthalpy: -25, thermal: 'adiabatic' },
  },
  { id: 'reversible', label: 'Reversible ⇌', params: { ...SECOND, activationEnergy: 15, enthalpy: -5, reversible: true } },
];

const PS_PER_SECOND = 25; // simulated picoseconds per real second at 1×
const MAX_MOLECULES = 360;
const PLOT_HEIGHT = 220;

function pointKey(p: KineticsParams): string {
  return `${effectiveBarrier(p)}|${p.stericFactor}|${p.nA + p.nB}`;
}

/** Half-life of the limiting reactant from the integrated second-order rate law. */
function halfLife(p: KineticsParams, T: number): number {
  const k = forwardRateConstant(T, p);
  const a = Math.min(p.nA, p.nB) / AREA;
  const b = Math.max(p.nA, p.nB) / AREA;
  if (k <= 0) return Infinity;
  if (Math.abs(b - a) < 1e-9) return 1 / (k * a);
  return Math.log(2 - a / b) / (k * (b - a));
}

interface Telemetry {
  version: number;
  time: number;
  T: number;
  counts: [number, number, number, number];
  k: number;
  kErr: number;
  kReactions: number;
  kDuration: number;
  kT: number;
  fracAbove: number;
  fracTheory: number;
  samples: number;
  collisionsPerReaction: number | null;
}

function readTelemetry(g: ReactionGas, version: number): Telemetry {
  const m = g.measuredRateConstant();
  return {
    version,
    time: g.time,
    T: g.smoothedT,
    counts: [...g.counts] as [number, number, number, number],
    k: m.k,
    kErr: m.error,
    kReactions: m.reactions,
    kDuration: m.duration,
    kT: m.T,
    fracAbove: fractionAbove(g.energySample(), effectiveBarrier(g.params)),
    fracTheory: theoryFractionAbove(g.sampleTemperatures(), effectiveBarrier(g.params)),
    samples: g.energyCount,
    collisionsPerReaction: g.window.reactions > 0 ? g.window.collisionsAB / g.window.reactions : null,
  };
}

export function ReactionKineticsLab({ meta }: { meta: SimulationEntry }) {
  const [presetId, setPresetId] = useState<PresetId | null>('second');
  const [params, setParams] = useState<KineticsParams>(SECOND);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [concMode, setConcMode] = useState<ConcMode>('conc');
  const [points, setPoints] = useState<ArrheniusPoint[]>([]);

  const seedRef = useRef(1);
  const gasRef = useRef<ReactionGas>(new ReactionGas(SECOND, seedRef.current));
  const [telemetry, setTelemetry] = useState<Telemetry>(() => readTelemetry(gasRef.current, 0));

  const reactorRef = useRef<HTMLCanvasElement | null>(null);
  const concRef = useRef<HTMLCanvasElement | null>(null);
  const distRef = useRef<HTMLCanvasElement | null>(null);
  const profileRef = useRef<HTMLCanvasElement | null>(null);
  const arrRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const concModeRef = useRef(concMode);
  concModeRef.current = concMode;
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const publish = useCallback(() => {
    setTelemetry((prev) => readTelemetry(gasRef.current, prev.version + 1));
  }, []);

  const restart = useCallback(
    (p: KineticsParams) => {
      seedRef.current += 1;
      gasRef.current = new ReactionGas(p, seedRef.current);
      publish();
    },
    [publish],
  );

  const drawAll = useCallback(() => {
    const f: KineticsFrame = {
      gas: gasRef.current,
      params: paramsRef.current,
      concMode: concModeRef.current,
      points: pointsRef.current,
      pointKey: pointKey(paramsRef.current),
    };
    const jobs: [HTMLCanvasElement | null, typeof drawReactor][] = [
      [reactorRef.current, drawReactor],
      [concRef.current, drawConcentration],
      [distRef.current, drawEnergyDistribution],
      [profileRef.current, drawEnergyProfile],
      [arrRef.current, drawArrhenius],
    ];
    for (const [canvas, draw] of jobs) {
      if (!canvas) continue;
      const { width, height, dpr } = syncCanvasSize(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.save();
      ctx.scale(dpr, dpr);
      draw(ctx, width, height, f);
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (runningRef.current) {
        const g = gasRef.current;
        g.advance(PS_PER_SECOND * speedRef.current * dt);
        frame++;
        if (frame % 5 === 0) publish();
      }
      drawAll();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawAll, publish]);

  /** Mixture or thermal-mode changes start a new run; barrier, ΔH, p, catalyst and bath T apply live. */
  const update = (patch: Partial<KineticsParams>) => {
    setPresetId(null);
    const prev = paramsRef.current;
    const next = { ...prev, ...patch };
    if (next.nA + next.nB > MAX_MOLECULES) {
      if (patch.nA !== undefined) next.nB = MAX_MOLECULES - next.nA;
      else next.nA = MAX_MOLECULES - next.nB;
    }
    const structural =
      next.nA !== prev.nA ||
      next.nB !== prev.nB ||
      next.thermal !== prev.thermal ||
      (next.thermal === 'adiabatic' && next.temperature !== prev.temperature);
    paramsRef.current = next;
    setParams(next);
    if (structural) restart(next);
    else gasRef.current.setParams(next);
  };

  const loadPreset = (id: PresetId) => {
    const pr = PRESETS.find((q) => q.id === id);
    if (!pr) return;
    setPresetId(id);
    paramsRef.current = pr.params;
    setParams(pr.params);
    restart(pr.params);
    setRunning(true);
  };

  const addPoint = () => {
    const m = gasRef.current.measuredRateConstant();
    if (m.reactions < 20 || m.k <= 0) return;
    setPoints((prev) => [
      ...prev,
      { T: m.T, k: m.k, error: m.error, reactions: m.reactions, key: pointKey(paramsRef.current) },
    ]);
    gasRef.current.resetWindow();
    publish();
  };

  const p = params;
  const tm = telemetry;
  const Ea = effectiveBarrier(p);
  const Tref = p.thermal === 'isothermal' ? p.temperature : tm.T;
  const kTheory = forwardRateConstant(Tref, p);
  const fracTheory = tm.fracTheory;
  const insulated = p.thermal === 'adiabatic';
  const tHalf = halfLife(p, p.thermal === 'isothermal' ? p.temperature : gasRef.current.initial.T);
  const nLimit = Math.min(gasRef.current.initial.nA, gasRef.current.initial.nB);
  const conversion = nLimit > 0 ? tm.counts[2] / nLimit : 0;
  const Keq = equilibriumConstant(Tref, p);
  const eqConversion =
    nLimit > 0 ? equilibriumExtent(Keq, gasRef.current.initial.nA, gasRef.current.initial.nB) / nLimit : 0;
  const [cA, cB, cC, cD] = tm.counts;
  const Qnow = cA * cB > 0 ? (cC * cD) / (cA * cB) : Infinity;
  const fmtK = (k: number) => (k >= 0.01 ? k.toFixed(4) : k.toExponential(2));

  const button = (active: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
      active ? 'border-teal-500/45 bg-teal-500/15 text-teal-200' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
    }`;
  const small = (active: boolean) =>
    `rounded-md border px-2 py-0.5 font-mono text-[11px] ${
      active ? 'border-teal-500/45 bg-teal-500/15 text-teal-200' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
    }`;

  const card = (ref: RefObject<HTMLCanvasElement | null>, header?: ReactNode) => (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      {header}
      <canvas ref={ref} style={{ height: PLOT_HEIGHT }} className="w-full rounded-lg border border-slate-800/70" />
    </div>
  );

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={() => {
        setRunning(false);
        gasRef.current.advance(2);
        publish();
      }}
      onReset={() => restart(paramsRef.current)}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative w-full" style={{ aspectRatio: '32 / 20' }}>
          <canvas ref={reactorRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {card(
            concRef,
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-medium text-slate-400">Plot</span>
              {(
                [
                  ['conc', 'amounts'],
                  ['ln', 'ln[A]'],
                  ['inv', '1/[A]'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setConcMode(id)} className={small(concMode === id)}>
                  {label}
                </button>
              ))}
            </div>,
          )}
          {card(
            arrRef,
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={addPoint}
                disabled={tm.kReactions < 20 || insulated}
                title={insulated ? 'Measure k with the heat bath on, so the temperature stays fixed' : 'Needs at least 20 reactions since the conditions last changed'}
                className="inline-flex items-center gap-1 rounded-md border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 font-mono text-[11px] text-teal-200 hover:bg-teal-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> Add k to plot
              </button>
              <button
                type="button"
                onClick={() => setPoints([])}
                disabled={points.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
              <span className="text-[11px] text-slate-500">
                {insulated
                  ? 'needs the heat bath (fixed T)'
                  : tm.kReactions < 20
                    ? `${tm.kReactions}/20 reactions measured`
                    : `${points.length} point${points.length === 1 ? '' : 's'}`}
              </span>
            </div>,
          )}
          {card(distRef)}
          {card(profileRef)}
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Elapsed Time"
            value={tm.time.toFixed(0)}
            unit="ps"
            color="#94a3b8"
            sublabel={`${PS_PER_SECOND * speed} ps of molecular time per second`}
          />
          <MetricCard
            label="Temperature"
            value={tm.T.toFixed(0)}
            unit="K"
            color="#fb923c"
            sublabel={p.thermal === 'isothermal' ? `heat bath at ${p.temperature} K` : `insulated · started at ${gasRef.current.initial.T} K`}
          />
          <MetricCard
            label="Conversion"
            value={(100 * conversion).toFixed(0)}
            unit="%"
            color="#34d399"
            sublabel={
              p.reversible
                ? `equilibrium: ${(100 * eqConversion).toFixed(0)} % (K = e^(−ΔH/RT))`
                : `${tm.counts[2]} of ${nLimit} limiting molecules reacted`
            }
          />
          {p.reversible ? (
            <MetricCard
              label="Q = [C][D] / [A][B]"
              value={Number.isFinite(Qnow) ? Qnow.toFixed(2) : '∞'}
              color="#38bdf8"
              sublabel={`K = e^(−ΔH/RT) = ${Keq.toFixed(2)} at equilibrium`}
            />
          ) : (
            <MetricCard
              label="Half-Life (rate law)"
              value={Number.isFinite(tHalf) && tHalf < 1e6 ? tHalf.toFixed(0) : '∞'}
              unit="ps"
              color="#38bdf8"
              sublabel={p.thermal === 'isothermal' ? 'of the limiting reactant' : 'at the starting temperature'}
            />
          )}
          <MetricCard
            label="k (collision theory)"
            value={fmtK(kTheory)}
            unit="nm²/ps"
            color="#5eead4"
            sublabel={`rate = k[A][B] at ${Tref.toFixed(0)} K`}
          />
          <MetricCard
            label="k (measured)"
            value={tm.kReactions > 0 ? fmtK(tm.k) : '—'}
            unit="nm²/ps"
            color="#5eead4"
            sublabel={
              insulated
                ? 'run average: T keeps changing here'
                : tm.kReactions > 0
                  ? `± ${fmtK(tm.kErr)} · ${tm.kReactions} reactions in ${tm.kDuration.toFixed(0)} ps`
                  : 'reactions per exposure ∫[A][B]dt'
            }
          />
          <MetricCard
            label="Collisions ≥ Eₐ"
            value={tm.samples > 50 ? (100 * tm.fracAbove).toFixed(tm.fracAbove < 0.1 ? 2 : 1) : '—'}
            unit="%"
            color="#fbbf24"
            sublabel={`theory ${insulated ? '⟨e^(−Eₐ/RT)⟩' : 'e^(−Eₐ/RT)'} = ${(100 * fracTheory).toFixed(fracTheory < 0.1 ? 2 : 1)} %`}
          />
          <MetricCard
            label="Reactive Collisions"
            value={tm.collisionsPerReaction !== null ? `1 in ${tm.collisionsPerReaction.toFixed(0)}` : '—'}
            color="#f472b6"
            sublabel={`theory 1 in ${(1 / (p.stericFactor * fracTheory)).toFixed(0)} A–B collisions`}
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Presets</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((pr) => (
                <button key={pr.id} type="button" onClick={() => loadPreset(pr.id)} className={button(presetId === pr.id)}>
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Surroundings</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => update({ thermal: 'isothermal' })} className={button(p.thermal === 'isothermal')}>
                Heat Bath (isothermal)
              </button>
              <button type="button" onClick={() => update({ thermal: 'adiabatic' })} className={button(p.thermal === 'adiabatic')}>
                Insulated (adiabatic)
              </button>
            </div>
          </div>

          <ParameterSlider
            label={p.thermal === 'isothermal' ? 'Bath Temperature (T)' : 'Starting Temperature (T₀)'}
            value={p.temperature}
            min={300}
            max={1500}
            step={10}
            precision={0}
            unit="K"
            hint={p.thermal === 'isothermal' ? 'Applies immediately and starts a new k measurement' : 'Starts a new run'}
            onChange={(temperature) => update({ temperature })}
          />
          <ParameterSlider
            label="Activation Energy (Eₐ)"
            value={p.activationEnergy}
            min={0}
            max={40}
            step={1}
            precision={0}
            unit="kJ/mol"
            onChange={(activationEnergy) => update({ activationEnergy })}
          />
          <ParameterSlider
            label="Reaction Enthalpy (ΔH)"
            value={p.enthalpy}
            min={-40}
            max={20}
            step={1}
            precision={0}
            unit="kJ/mol"
            hint={p.enthalpy > p.activationEnergy ? 'Endothermic: the barrier can never be lower than ΔH' : 'Negative = exothermic: products leave faster, heating the gas'}
            onChange={(enthalpy) => update({ enthalpy })}
          />
          <ParameterSlider
            label="Steric Factor (p)"
            value={p.stericFactor}
            min={0.05}
            max={1}
            step={0.05}
            precision={2}
            hint="Share of energetic collisions that also have a reactive orientation"
            onChange={(stericFactor) => update({ stericFactor })}
          />
          <button type="button" onClick={() => update({ reversible: !p.reversible })} className={button(p.reversible)}>
            Reverse Reaction (C + D → A + B): {p.reversible ? 'ON' : 'OFF'}
          </button>
          <div className="space-y-2">
            <button type="button" onClick={() => update({ catalyst: !p.catalyst })} className={button(p.catalyst)}>
              Catalyst: {p.catalyst ? `ON (Eₐ ${p.activationEnergy} → ${Ea.toFixed(0)} kJ/mol)` : 'OFF'}
            </button>
            {p.catalyst && (
              <ParameterSlider
                label="Barrier Lowered By"
                value={p.catalystDrop}
                min={2}
                max={20}
                step={1}
                precision={0}
                unit="kJ/mol"
                onChange={(catalystDrop) => update({ catalystDrop })}
              />
            )}
          </div>

          <ParameterSlider
            label="Molecules of A"
            value={p.nA}
            min={20}
            max={200}
            step={10}
            precision={0}
            hint="Changing the mixture starts a new run"
            onChange={(nA) => update({ nA })}
          />
          <ParameterSlider
            label="Molecules of B"
            value={p.nB}
            min={20}
            max={300}
            step={10}
            precision={0}
            onChange={(nB) => update({ nB })}
          />
        </>
      }
    />
  );
}
