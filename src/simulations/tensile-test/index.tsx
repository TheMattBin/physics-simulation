import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Layers, Trash2 } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  drawElasticZoom,
  drawStrainProfile,
  drawTensileLab,
  overlayPoints,
  type ChartRange,
  type Overlay,
  type TensileFrame,
} from './draw';
import {
  TENSILE_MATERIALS,
  advance,
  analyze,
  bridgmanFactor,
  createTest,
  neckIndex,
  runToFracture,
  sliceArea,
  type SpecimenParams,
  type TensileMaterialId,
  type TensileTest,
  type TestResults,
} from './physics';

const MATERIAL_ORDER: TensileMaterialId[] = ['steel', 'aluminium', 'copper', 'titanium', 'alumina'];
const DEFAULT_PARAMS: SpecimenParams = { material: 'steel', gaugeLength: 50, diameter: 12.5 };
const MAIN_HEIGHT = 560;
const PANEL_HEIGHT = 230;
const MAX_OVERLAYS = 8;

type Mode = 'load' | 'unload';

/** Strain rate of the animation [1/s at 1×]: slow on elastic lines and Lüders yielding, faster once flowing. */
function playbackRate(t: TensileTest, ludersActive: boolean): number {
  const mat = t.mat;
  if (!t.plastic) return (mat.brittle ? (mat.fractureStress ?? 1) : mat.yield0) / mat.E / 1.6;
  if (ludersActive) return (mat.ludersStrain ?? 0.01) / 3;
  return mat.strainAxis / 14;
}

function ludersActive(t: TensileTest): boolean {
  const L = t.mat.ludersStrain;
  if (!L || t.mat.upperYield === undefined) return false;
  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < t.ep.length; i++) {
    lo = Math.min(lo, t.ep[i]);
    hi = Math.max(hi, t.ep[i]);
  }
  return hi > 0.002 && lo < 0.5 * L;
}

function phaseOf(t: TensileTest, mode: Mode, running: boolean, r: TestResults): string {
  if (t.fractured) {
    return t.mat.brittle
      ? 'FRACTURED · brittle, with no plastic strain at all'
      : `FRACTURED · elongation ${((r.elongationAtBreak ?? 0) * 100).toFixed(1)} %, reduction of area ${(r.reductionOfArea * 100).toFixed(0)} %`;
  }
  if (t.history.length <= 1) return 'READY · press ▶ to pull';
  const paused = running ? '' : ' (paused)';
  if (mode === 'unload' && running) return 'UNLOADING · elastic spring-back along slope E';
  if (!t.plastic) {
    if (t.F <= 0 && r.permanentSet > 1e-4) return `UNLOADED · permanent set ${(r.permanentSet * 100).toFixed(2)} %${paused}`;
    return (r.permanentSet > 1e-4 ? 'ELASTIC RELOADING · straight line up to the old flow stress' : "ELASTIC · Hooke's law σ = E e") + paused;
  }
  if (ludersActive(t)) return `YIELDING · Lüders bands spread at constant load${paused}`;
  if (r.necked) return `NECKING · the load falls as the neck thins${paused}`;
  return `PLASTIC · uniform stretching with strain hardening${paused}`;
}

function overlayKey(p: SpecimenParams) {
  return `${p.material}-${p.gaugeLength}-${p.diameter}`;
}

function overlayLabel(p: SpecimenParams) {
  const name = TENSILE_MATERIALS[p.material].shortName;
  return p.gaugeLength === 50 && p.diameter === 12.5 ? name : `${name} (${p.gaugeLength}×${p.diameter})`;
}

interface Telemetry {
  version: number;
  results: TestResults;
  F: number;
  e: number;
  s: number;
  trueStress: number;
  flowStress: number;
  dMin: number;
  fractured: boolean;
  started: boolean;
}

function readTelemetry(t: TensileTest, version: number): Telemetry {
  const last = t.history[t.history.length - 1];
  const i = neckIndex(t);
  const A = sliceArea(t, i);
  let far = Infinity;
  for (let k = 0; k < t.ep.length; k++) far = Math.min(far, t.ep[k]);
  const trueStress = t.F / A;
  return {
    version,
    results: analyze(t),
    F: t.F,
    e: last.e,
    s: last.s,
    trueStress,
    flowStress: trueStress / bridgmanFactor(t.ep[i] - far),
    dMin: 2 * Math.sqrt(A / Math.PI),
    fractured: t.fractured,
    started: t.history.length > 1,
  };
}

export function TensileTestLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<SpecimenParams>(DEFAULT_PARAMS);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<Mode>('load');
  const [showTrue, setShowTrue] = useState(false);
  const [showEnergy, setShowEnergy] = useState(true);
  const [overlays, setOverlays] = useState<Overlay[]>([]);

  const testRef = useRef<TensileTest>(createTest(DEFAULT_PARAMS));
  const [telemetry, setTelemetry] = useState<Telemetry>(() => readTelemetry(testRef.current, 0));

  // A full run in the background fixes the chart axes and the machine drawing before the test starts.
  const preview = useMemo(() => runToFracture(params), [params]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zoomRef = useRef<HTMLCanvasElement | null>(null);
  const profileRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const showTrueRef = useRef(showTrue);
  showTrueRef.current = showTrue;
  const showEnergyRef = useRef(showEnergy);
  showEnergyRef.current = showEnergy;
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const publish = useCallback(() => {
    setTelemetry((prev) => readTelemetry(testRef.current, prev.version + 1));
  }, []);

  const addOverlay = useCallback((t: TensileTest) => {
    const o: Overlay = {
      key: overlayKey(t.params),
      label: overlayLabel(t.params),
      color: t.mat.color,
      points: overlayPoints(t.history),
    };
    setOverlays((prev) => [...prev.filter((p) => p.key !== o.key), o].slice(-MAX_OVERLAYS));
  }, []);

  const newSpecimen = useCallback(
    (p: SpecimenParams) => {
      runningRef.current = false;
      setRunning(false);
      setMode('load');
      testRef.current = createTest(p);
      publish();
    },
    [publish],
  );

  useEffect(() => {
    newSpecimen(params);
  }, [params, newSpecimen]);

  const frameData = useCallback((): TensileFrame => {
    const t = testRef.current;
    const pv = previewRef.current;
    const results = analyze(t);
    const range: ChartRange = { eMax: 0, sMax: 0 };
    const consider = (e: number, s: number) => {
      range.eMax = Math.max(range.eMax, e);
      range.sMax = Math.max(range.sMax, s);
    };
    for (const p of pv.history) {
      consider(p.e, p.s);
      if (showTrueRef.current) consider(p.et, p.st);
    }
    for (const p of t.history) {
      consider(p.e, p.s);
      if (showTrueRef.current) consider(p.et, p.st);
    }
    for (const o of overlaysRef.current) for (const p of o.points) consider(p.e, p.s);
    range.eMax *= 1.06;
    range.sMax *= 1.12;
    const pvLast = pv.history[pv.history.length - 1];
    return {
      test: t,
      results,
      range,
      overlays: overlaysRef.current,
      showTrue: showTrueRef.current,
      showEnergy: showEnergyRef.current,
      phase: phaseOf(t, modeRef.current, runningRef.current, results),
      maxGaugeLength: Math.max(t.length, t.L0 * (1 + pvLast.e)) + 2,
    };
  }, []);

  const drawAll = useCallback(() => {
    const f = frameData();
    const pairs: [HTMLCanvasElement | null, (ctx: CanvasRenderingContext2D, w: number, h: number) => void][] = [
      [canvasRef.current, (ctx, w, h) => drawTensileLab(ctx, w, h, f)],
      [zoomRef.current, (ctx, w, h) => drawElasticZoom(ctx, w, h, f)],
      [profileRef.current, (ctx, w, h) => drawStrainProfile(ctx, w, h, f)],
    ];
    for (const [canvas, draw] of pairs) {
      if (!canvas) continue;
      const { width, height, dpr } = syncCanvasSize(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.save();
      ctx.scale(dpr, dpr);
      draw(ctx, width, height);
      ctx.restore();
    }
  }, [frameData]);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (runningRef.current) {
        const t = testRef.current;
        const dir = modeRef.current === 'unload' ? -1 : 1;
        const rate = playbackRate(t, ludersActive(t));
        const outcome = advance(t, dir * rate * dt * speedRef.current * t.L0);
        if (outcome === 'fractured') {
          runningRef.current = false;
          setRunning(false);
          addOverlay(t);
        } else if (outcome === 'slack') {
          runningRef.current = false;
          setRunning(false);
          setMode('load');
        }
        frame++;
        if (outcome !== 'ok' || frame % 4 === 0) publish();
      }
      drawAll();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [addOverlay, drawAll, publish]);

  const toggleRun = () => {
    if (running) {
      runningRef.current = false;
      setRunning(false);
      return;
    }
    if (testRef.current.fractured) testRef.current = createTest(params);
    setMode('load');
    setRunning(true);
  };

  const step = () => {
    const t = testRef.current;
    runningRef.current = false;
    setRunning(false);
    if (t.fractured) return;
    const dir = mode === 'unload' ? -1 : 1;
    const outcome = advance(t, dir * playbackRate(t, ludersActive(t)) * 0.25 * t.L0);
    if (outcome === 'fractured') addOverlay(t);
    if (outcome === 'slack') setMode('load');
    publish();
  };

  const unload = () => {
    const t = testRef.current;
    if (t.fractured || t.F <= 0) return;
    setMode('unload');
    setRunning(true);
  };

  const overlayAll = () => {
    const runs = MATERIAL_ORDER.map((material) => runToFracture({ ...params, material }));
    setOverlays((prev) => {
      const keys = new Set(runs.map((t) => overlayKey(t.params)));
      const fresh = runs.map((t) => ({
        key: overlayKey(t.params),
        label: overlayLabel(t.params),
        color: t.mat.color,
        points: overlayPoints(t.history),
      }));
      return [...prev.filter((o) => !keys.has(o.key)), ...fresh].slice(-MAX_OVERLAYS);
    });
  };

  const update = (patch: Partial<SpecimenParams>) => {
    setParams((prev) => {
      const next = { ...prev, ...patch };
      if (next.diameter > next.gaugeLength / 2) next.diameter = next.gaugeLength / 2;
      return next;
    });
  };

  const mat = TENSILE_MATERIALS[params.material];
  const r = telemetry.results;
  const button = (active: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-orange-500/45 bg-orange-500/15 text-orange-200'
        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
    }`;
  const toggle = (on: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
      on ? 'border-orange-500/40 bg-orange-500/15 text-orange-200' : 'border-slate-800 bg-slate-900 text-slate-400'
    }`;
  const fmtEnergy = (v: number) => (v >= 1 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(3) : v.toExponential(1));

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={toggleRun}
      onStep={step}
      onReset={() => newSpecimen(params)}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative w-full" style={{ height: MAIN_HEIGHT }}>
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[zoomRef, profileRef].map((ref, i) => (
            <div key={i} className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
              <canvas ref={ref} style={{ height: PANEL_HEIGHT }} className="w-full rounded-lg border border-slate-800/70" />
            </div>
          ))}
        </div>
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Load F"
            value={(telemetry.F / 1e3).toFixed(2)}
            unit="kN"
            color="#fb7185"
            sublabel={`A₀ = ${((Math.PI / 4) * params.diameter ** 2).toFixed(0)} mm² · d_min ${telemetry.dMin.toFixed(2)} mm`}
          />
          <MetricCard
            label="Engineering Stress"
            value={telemetry.s.toFixed(0)}
            unit="MPa"
            color="#fb7185"
            sublabel={`strain e = ${(telemetry.e * 100).toFixed(telemetry.e < 0.01 ? 3 : 2)} %`}
          />
          <MetricCard
            label="Young's Modulus E"
            value={r.E !== null && telemetry.started ? (r.E / 1e3).toFixed(1) : '—'}
            unit="GPa"
            color="#38bdf8"
            sublabel="slope of the elastic line"
          />
          <MetricCard
            label="Yield Strength σ_y"
            value={r.yieldStrength !== null ? r.yieldStrength.toFixed(0) : '—'}
            unit="MPa"
            color="#34d399"
            sublabel={
              mat.brittle
                ? 'none: breaks before yielding'
                : r.upperYield !== null && r.yieldStrength !== null
                  ? `lower yield · upper ${r.upperYield.toFixed(0)} MPa`
                  : '0.2 % offset method'
            }
          />
          <MetricCard
            label="Tensile Strength (UTS)"
            value={telemetry.started ? r.uts.toFixed(0) : '—'}
            unit="MPa"
            color="#f59e0b"
            sublabel={
              !telemetry.started
                ? 'maximum engineering stress'
                : r.necked || mat.brittle
                  ? `max load at e = ${(r.utsStrain * 100).toFixed(r.utsStrain < 0.01 ? 3 : 1)} %${r.necked ? ', then necking' : ''}`
                  : 'highest so far: the maximum is known once the load falls'
            }
          />
          <MetricCard
            label="Elongation at Break"
            value={r.elongationAtBreak !== null ? (r.elongationAtBreak * 100).toFixed(1) : '—'}
            unit="%"
            color="#a78bfa"
            sublabel={`reduction of area ${(r.reductionOfArea * 100).toFixed(1)} %`}
          />
          <MetricCard
            label="Toughness U_T"
            value={fmtEnergy(r.toughness)}
            unit="MJ/m³"
            color="#f59e0b"
            sublabel={r.resilience !== null ? `resilience U_r = ${fmtEnergy(r.resilience)} MJ/m³` : 'area under the curve'}
          />
          <MetricCard
            label="True Stress at Neck"
            value={telemetry.trueStress.toFixed(0)}
            unit="MPa"
            color="#a78bfa"
            sublabel={`Bridgman flow stress ${telemetry.flowStress.toFixed(0)} MPa`}
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Material</label>
            <div className="grid grid-cols-3 gap-1.5">
              {MATERIAL_ORDER.map((id) => (
                <button key={id} type="button" onClick={() => update({ material: id })} className={button(params.material === id)}>
                  {TENSILE_MATERIALS[id].shortName}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              {mat.name} · E = {(mat.E / 1e3).toFixed(0)} GPa ·{' '}
              {mat.brittle
                ? `fracture stress ${mat.fractureStress} MPa`
                : `Swift K = ${mat.K} MPa, n = ${mat.n}${mat.upperYield ? `, upper/lower yield ${mat.upperYield}/${mat.yield0.toFixed(0)} MPa` : ''}`}
            </p>
          </div>

          <ParameterSlider
            label="Gauge Length (L₀)"
            value={params.gaugeLength}
            min={25}
            max={100}
            step={5}
            precision={0}
            unit="mm"
            hint="ASTM E8 round specimen: L₀ = 4 d₀ = 50 mm. Changing it starts a new specimen."
            onChange={(gaugeLength) => update({ gaugeLength })}
          />
          <ParameterSlider
            label="Diameter (d₀)"
            value={params.diameter}
            min={6}
            max={20}
            step={0.5}
            precision={1}
            unit="mm"
            onChange={(diameter) => update({ diameter })}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={unload}
              disabled={telemetry.fractured || telemetry.F <= 0 || (running && mode === 'unload')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Unload to Zero
            </button>
            <button
              type="button"
              onClick={overlayAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
            >
              <Layers className="h-3.5 w-3.5" />
              Overlay All Materials
            </button>
            <button
              type="button"
              onClick={() => setOverlays([])}
              disabled={overlays.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Overlays
            </button>
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Unload part-way through a test, then press ▶ to reload. Every finished test is kept as an overlay for comparison.
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setShowTrue((v) => !v)} className={toggle(showTrue)}>
              True Stress–Strain: {showTrue ? 'ON' : 'OFF'}
            </button>
            <button type="button" onClick={() => setShowEnergy((v) => !v)} className={toggle(showEnergy)}>
              Energy Areas: {showEnergy ? 'ON' : 'OFF'}
            </button>
          </div>
        </>
      }
    />
  );
}
