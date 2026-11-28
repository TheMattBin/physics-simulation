import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Droplets, FlaskConical, Plus, Snowflake, Flame, Thermometer } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { clamp, syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  directionText,
  drawAmounts,
  drawMap,
  drawQK,
  drawRates,
  drawReactor,
  drawSyringe,
  syringeLayout,
  type EqEvent,
  type EqFrame,
  type EqHistoryPoint,
} from './draw';
import {
  SYSTEMS,
  advance,
  dissociation,
  equilibriumState,
  lnQ,
  moleFraction,
  rates,
  reactionGibbs,
  syncGasLaw,
  type ChemState,
  type SystemId,
} from './physics';
import { SpriteGas } from './sprites';

const PER_MOL: Record<SystemId, number> = { no2: 30000, haber: 120 };
const UNITS: Record<SystemId, { scale: number; unit: string }> = {
  no2: { scale: 1000, unit: 'mmol' },
  haber: { scale: 1, unit: 'mol' },
};
const MAX_DOTS = 360;
const PLOT_HEIGHT = 210;
const HISTORY_DT = 0.05; // s
const HISTORY_KEEP = 70; // s

function freshState(id: SystemId): ChemState {
  const s: ChemState =
    id === 'no2'
      ? { n: [0.002, 0, 0], T: 298.15, V: 0.05, P: 1, catalyst: false, time: 0, extent: 0 }
      : { n: [0.25, 0.75, 0, 0], T: 723.15, V: 1, P: 200, catalyst: true, time: 0, extent: 0 };
  syncGasLaw(SYSTEMS[id], s);
  return s;
}

function fmtSci(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '0';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 1000) return v.toPrecision(3);
  return v.toExponential(2);
}

interface Telemetry {
  version: number;
  state: ChemState;
  eq: ChemState;
  forward: number;
  reverse: number;
  lnQ: number;
  dG: number;
}

export function ChemicalEquilibriumLab({ meta }: { meta: SimulationEntry }) {
  const [systemId, setSystemId] = useState<SystemId>('no2');
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [volumeMl, setVolumeMl] = useState(50);
  const [tempC, setTempC] = useState(25);
  const [pressure, setPressure] = useState(200);
  const [catalyst, setCatalyst] = useState(true);
  const [dots, setDots] = useState(0);

  const sysRef = useRef(SYSTEMS.no2);
  const stateRef = useRef<ChemState>(freshState('no2'));
  const spritesRef = useRef<SpriteGas>(new SpriteGas(SYSTEMS.no2, stateRef.current, PER_MOL.no2));
  const historyRef = useRef<EqHistoryPoint[]>([]);
  const eventsRef = useRef<EqEvent[]>([]);
  const condensedRef = useRef(0);
  const nextRecordRef = useRef(0);
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const dragRef = useRef(false);

  const vesselRef = useRef<HTMLCanvasElement | null>(null);
  const amountsRef = useRef<HTMLCanvasElement | null>(null);
  const qkRef = useRef<HTMLCanvasElement | null>(null);
  const ratesRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<HTMLCanvasElement | null>(null);

  const snapshot = useCallback((version: number): Telemetry => {
    const sys = sysRef.current;
    const s = stateRef.current;
    const r = rates(sys, s);
    return {
      version,
      state: { ...s, n: [...s.n] },
      eq: equilibriumState(sys, s),
      forward: r.forward,
      reverse: r.reverse,
      lnQ: lnQ(sys, s),
      dG: reactionGibbs(sys, s),
    };
  }, []);
  const [telemetry, setTelemetry] = useState<Telemetry>(() => snapshot(0));

  const publish = useCallback(() => {
    setTelemetry((prev) => snapshot(prev.version + 1));
    setDots(spritesRef.current.sprites.length);
  }, [snapshot]);

  const record = useCallback((force = false) => {
    const sys = sysRef.current;
    const s = stateRef.current;
    if (!force && s.time < nextRecordRef.current) return;
    const r = rates(sys, s);
    const h = historyRef.current;
    h.push({ t: s.time, n: [...s.n], lnQ: lnQ(sys, s), lnK: sys.lnK(s.T), forward: r.forward, reverse: r.reverse });
    while (h.length > 0 && h[0].t < s.time - HISTORY_KEEP) h.shift();
    nextRecordRef.current = s.time + HISTORY_DT;
  }, []);

  /** Logs a disturbance; repeated slider moves of the same kind update one marker. */
  const logEvent = useCallback(
    (kind: string, label: string) => {
      const ev = eventsRef.current;
      const t = stateRef.current.time;
      const last = ev[ev.length - 1];
      if (last && last.kind === kind && t - last.t < 1.5) {
        last.label = label;
      } else {
        ev.push({ t, label, kind });
        if (ev.length > 30) ev.shift();
      }
      record(true);
      publish();
    },
    [publish, record],
  );

  const reset = useCallback(
    (id: SystemId) => {
      const sys = SYSTEMS[id];
      sysRef.current = sys;
      stateRef.current = freshState(id);
      spritesRef.current = new SpriteGas(sys, stateRef.current, PER_MOL[id]);
      historyRef.current = [];
      eventsRef.current = [];
      condensedRef.current = 0;
      nextRecordRef.current = 0;
      const s = stateRef.current;
      setVolumeMl(Math.round(s.V * 1000));
      setTempC(Math.round(s.T - 273.15));
      setPressure(s.P);
      setCatalyst(s.catalyst);
      record(true);
      publish();
    },
    [publish, record],
  );

  const drawAll = useCallback(() => {
    const sys = sysRef.current;
    const s = stateRef.current;
    const f: EqFrame = {
      sys,
      state: s,
      eq: equilibriumState(sys, s),
      sprites: spritesRef.current,
      history: historyRef.current,
      events: eventsRef.current,
      condensed: condensedRef.current,
      unitScale: UNITS[sys.id].scale,
      unit: UNITS[sys.id].unit,
    };
    const jobs: [HTMLCanvasElement | null, (ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) => void][] = [
      [vesselRef.current, sys.id === 'no2' ? drawSyringe : drawReactor],
      [amountsRef.current, drawAmounts],
      [qkRef.current, drawQK],
      [ratesRef.current, drawRates],
      [mapRef.current, drawMap],
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
    record(true);
    let rafId = 0;
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (runningRef.current) {
        const sys = sysRef.current;
        const s = stateRef.current;
        const dts = dt * speedRef.current;
        advance(sys, s, dts);
        const r = rates(sys, s);
        spritesRef.current.sync(sys, s, r.forward, r.reverse, dts);
        spritesRef.current.move(dts, Math.sqrt(s.T / 300));
        record();
        frame++;
        if (frame % 5 === 0) publish();
      }
      drawAll();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawAll, publish, record]);

  // ---- Disturbances -------------------------------------------------------------------------

  const applyVolume = (mL: number) => {
    const s = stateRef.current;
    const v = clamp(mL, 10, 100);
    setVolumeMl(v);
    s.V = v / 1000;
    syncGasLaw(sysRef.current, s);
    logEvent('V', `V → ${v.toFixed(0)} mL`);
  };

  const applyTemperature = (c: number) => {
    const s = stateRef.current;
    setTempC(c);
    s.T = c + 273.15;
    syncGasLaw(sysRef.current, s);
    logEvent('T', `${c.toFixed(0)} °C`);
  };

  const applyPressure = (bar: number) => {
    const s = stateRef.current;
    setPressure(bar);
    s.P = bar;
    syncGasLaw(sysRef.current, s);
    logEvent('P', `${bar.toFixed(0)} bar`);
  };

  const inject = (index: number, mol: number) => {
    const sys = sysRef.current;
    const s = stateRef.current;
    s.n[index] += mol;
    syncGasLaw(sys, s);
    spritesRef.current.spawn(index, Math.round(mol * PER_MOL[sys.id]), sys.id === 'no2' ? { u: 0.04, v: 0.5 } : undefined);
    const amount = sys.id === 'no2' ? `${(mol * 1000).toFixed(1)} mmol` : `${mol} mol`;
    logEvent(`add-${index}-${s.time.toFixed(2)}`, `+${amount} ${sys.species[index].formula}`);
  };

  const condense = () => {
    const sys = sysRef.current;
    const s = stateRef.current;
    const removed = 0.9 * s.n[2];
    if (removed <= 0) return;
    s.n[2] -= removed;
    condensedRef.current += removed;
    syncGasLaw(sys, s);
    spritesRef.current.remove(2, Math.round(removed * PER_MOL[sys.id]));
    logEvent(`condense-${s.time.toFixed(2)}`, 'NH₃ condensed');
  };

  const toggleCatalyst = () => {
    const s = stateRef.current;
    s.catalyst = !s.catalyst;
    setCatalyst(s.catalyst);
    logEvent(`cat-${s.time.toFixed(2)}`, s.catalyst ? 'catalyst on' : 'catalyst off');
  };

  const switchSystem = (id: SystemId) => {
    setSystemId(id);
    reset(id);
    setRunning(true);
  };

  // ---- Plunger dragging ----------------------------------------------------------------------

  const plungerHit = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const L = syringeLayout(rect.width, rect.height);
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hx = L.handleX(stateRef.current.V * 1000);
    return { L, x, near: Math.abs(x - hx) < 22 && Math.abs(y - L.yc) < L.r * 1.3, offset: 0.16 * rect.width };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (sysRef.current.id !== 'no2') return;
    const hit = plungerHit(e);
    if (!hit.near) return;
    dragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (sysRef.current.id !== 'no2') return;
    const hit = plungerHit(e);
    if (dragRef.current) {
      applyVolume(Math.round(hit.L.volumeAt(hit.x - hit.offset)));
      return;
    }
    e.currentTarget.style.cursor = hit.near ? 'grab' : 'default';
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // ---- View ------------------------------------------------------------------------------------

  const sys = SYSTEMS[systemId];
  const tm = telemetry;
  const s = tm.state;
  const lnK = sys.lnK(s.T);
  const dir = directionText(sys, tm.lnQ, lnK);
  const unit = UNITS[systemId];
  const full = dots > MAX_DOTS;

  const button = (active: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
      active ? 'border-teal-500/45 bg-teal-500/15 text-teal-200' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
    }`;
  const action =
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40';
  const card = (ref: RefObject<HTMLCanvasElement | null>) => (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
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
        const st = stateRef.current;
        advance(sysRef.current, st, 0.25);
        const r = rates(sysRef.current, st);
        spritesRef.current.sync(sysRef.current, st, r.forward, r.reverse, 0.25);
        record(true);
        publish();
      }}
      onReset={() => reset(systemId)}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative w-full" style={{ aspectRatio: '16 / 8.5' }}>
          <canvas
            ref={vesselRef}
            className="h-full w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {card(amountsRef)}
          {card(qkRef)}
          {card(ratesRef)}
          {card(mapRef)}
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard label="Temperature" value={(s.T - 273.15).toFixed(0)} unit="°C" color="#f87171" sublabel={`${s.T.toFixed(1)} K`} />
          <MetricCard
            label="Pressure"
            value={s.P < 10 ? s.P.toFixed(3) : s.P.toFixed(0)}
            unit="bar"
            color="#94a3b8"
            sublabel={sys.control === 'volume' ? 'follows from n, V and T' : 'held by the reactor'}
          />
          <MetricCard
            label="Volume"
            value={sys.control === 'volume' ? (s.V * 1000).toFixed(1) : s.V.toFixed(3)}
            unit={sys.control === 'volume' ? 'mL' : 'L'}
            color="#38bdf8"
            sublabel={sys.control === 'volume' ? 'set by the plunger' : 'follows from n, P and T'}
          />
          <MetricCard
            label="K (equilibrium)"
            value={fmtSci(Math.exp(lnK))}
            color="#fbbf24"
            sublabel="set by temperature alone"
          />
          <MetricCard
            label="Q (right now)"
            value={fmtSci(Math.exp(tm.lnQ))}
            color="#5eead4"
            sublabel={`Q/K = ${fmtSci(Math.exp(tm.lnQ - lnK))}`}
          />
          <MetricCard label="ΔG = RT ln(Q/K)" value={(tm.dG / 1000).toFixed(2)} unit="kJ/mol" color={dir.color} sublabel={dir.text} />
          {systemId === 'no2' ? (
            <MetricCard
              label="N₂O₄ Dissociated"
              value={(100 * dissociation(s)).toFixed(1)}
              unit="%"
              color="#d97706"
              sublabel={`equilibrium: ${(100 * dissociation(tm.eq)).toFixed(1)} %`}
            />
          ) : (
            <MetricCard
              label="NH₃ in the Gas"
              value={(100 * moleFraction(s, 2)).toFixed(1)}
              unit="%"
              color="#34d399"
              sublabel={`equilibrium: ${(100 * moleFraction(tm.eq, 2)).toFixed(1)} %`}
            />
          )}
          <MetricCard
            label="Forward / Reverse"
            value={`${fmtSci(tm.forward * unit.scale)} / ${fmtSci(tm.reverse * unit.scale)}`}
            unit={`${unit.unit}/s`}
            color="#fbbf24"
            sublabel="equal at equilibrium (r_r/r_f = Q/K)"
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Reaction</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => switchSystem('no2')} className={button(systemId === 'no2')}>
                N₂O₄ ⇌ 2 NO₂ (syringe)
              </button>
              <button type="button" onClick={() => switchSystem('haber')} className={button(systemId === 'haber')}>
                Haber–Bosch (NH₃)
              </button>
            </div>
          </div>

          {systemId === 'no2' ? (
            <>
              <ParameterSlider
                label="Syringe Volume (V)"
                value={volumeMl}
                min={10}
                max={100}
                step={1}
                precision={0}
                unit="mL"
                hint="Or drag the plunger handle"
                onChange={applyVolume}
              />
              <ParameterSlider
                label="Water Bath Temperature"
                value={tempC}
                min={0}
                max={100}
                step={1}
                precision={0}
                unit="°C"
                onChange={applyTemperature}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => applyTemperature(0)} className={action}>
                  <Snowflake className="h-3.5 w-3.5" /> Ice bath
                </button>
                <button type="button" onClick={() => applyTemperature(25)} className={action}>
                  <Thermometer className="h-3.5 w-3.5" /> Room
                </button>
                <button type="button" onClick={() => applyTemperature(100)} className={action}>
                  <Flame className="h-3.5 w-3.5" /> Boiling
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={full} onClick={() => inject(1, 0.0005)} className={action}>
                  <Plus className="h-3.5 w-3.5" /> 0.5 mmol NO₂
                </button>
                <button type="button" disabled={full} onClick={() => inject(0, 0.0005)} className={action}>
                  <Plus className="h-3.5 w-3.5" /> 0.5 mmol N₂O₄
                </button>
                <button type="button" disabled={full} onClick={() => inject(2, 0.001)} className={action}>
                  <Plus className="h-3.5 w-3.5" /> 1 mmol argon
                </button>
              </div>
            </>
          ) : (
            <>
              <ParameterSlider
                label="Reactor Pressure (P)"
                value={pressure}
                min={20}
                max={400}
                step={10}
                precision={0}
                unit="bar"
                onChange={applyPressure}
              />
              <ParameterSlider
                label="Reactor Temperature"
                value={tempC}
                min={227}
                max={627}
                step={5}
                precision={0}
                unit="°C"
                hint="Industrial plants run at about 400–450 °C"
                onChange={applyTemperature}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={full} onClick={() => inject(0, 0.1)} className={action}>
                  <Plus className="h-3.5 w-3.5" /> 0.1 mol N₂
                </button>
                <button type="button" disabled={full} onClick={() => inject(1, 0.3)} className={action}>
                  <Plus className="h-3.5 w-3.5" /> 0.3 mol H₂
                </button>
                <button type="button" disabled={full} onClick={() => inject(3, 0.3)} className={action}>
                  <Plus className="h-3.5 w-3.5" /> 0.3 mol argon
                </button>
                <button type="button" onClick={condense} className={action}>
                  <Droplets className="h-3.5 w-3.5" /> Condense out NH₃
                </button>
              </div>
              <button type="button" onClick={toggleCatalyst} className={button(catalyst)}>
                <span className="inline-flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5" /> Iron Catalyst: {catalyst ? 'ON' : 'OFF'}
                </span>
              </button>
            </>
          )}
          <p className="text-[11px] leading-snug text-slate-500">
            Every disturbance is marked on the time plots. Reset refills the vessel with the starting mixture.
            {full ? ' The vessel is full: reset to add more.' : ''}
          </p>
        </>
      }
    />
  );
}
