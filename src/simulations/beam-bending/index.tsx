import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { clamp, syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  autoDeflectionScale,
  beamLayout,
  drawBeamLab,
  drawSectionInspector,
  fmtNum,
  type Envelope,
} from './draw';
import {
  momentAt,
  solveBeam,
  type BeamMaterialId,
  type BeamModel,
  type BeamParams,
  type BeamSolution,
  type CrossSection,
  type CrossSectionType,
  type StressFieldMode,
  type SupportType,
} from './physics';

type PresetId = 'girder' | 'balcony' | 'joist' | 'overhang';

const PRESETS: { id: PresetId; label: string; params: BeamParams }[] = [
  {
    id: 'girder',
    label: 'Steel Girder',
    params: {
      support: 'simply-supported',
      section: 'i-beam',
      material: 'steel-a36',
      length: 8,
      depthMm: 400,
      pointLoadKN: 80,
      loadPos: 0.5,
      udlKNm: 5,
      supportBFrac: 0.6,
      selfWeight: true,
    },
  },
  {
    id: 'balcony',
    label: 'Cantilever Balcony',
    params: {
      support: 'cantilever',
      section: 'hollow-box',
      material: 'steel-a36',
      length: 2.5,
      depthMm: 200,
      pointLoadKN: 8,
      loadPos: 1,
      udlKNm: 4,
      supportBFrac: 0.6,
      selfWeight: true,
    },
  },
  {
    id: 'joist',
    label: 'Timber Floor Beam',
    params: {
      support: 'simply-supported',
      section: 'rectangular',
      material: 'timber',
      length: 4.5,
      depthMm: 240,
      pointLoadKN: 0,
      loadPos: 0.5,
      udlKNm: 8,
      supportBFrac: 0.6,
      selfWeight: true,
    },
  },
  {
    id: 'overhang',
    label: 'Overhang Balance',
    params: {
      support: 'overhanging',
      section: 'i-beam',
      material: 'steel-a36',
      length: 10,
      depthMm: 350,
      pointLoadKN: 0,
      loadPos: 0.9,
      udlKNm: 12,
      supportBFrac: 0.6,
      selfWeight: false,
    },
  },
];

const SUPPORTS: { id: SupportType; label: string }[] = [
  { id: 'simply-supported', label: 'Simply Supported' },
  { id: 'cantilever', label: 'Cantilever' },
  { id: 'overhanging', label: 'Overhang' },
];

const SECTIONS: { id: CrossSectionType; label: string }[] = [
  { id: 'i-beam', label: 'I-Beam' },
  { id: 'rectangular', label: 'Rectangle' },
  { id: 'hollow-box', label: 'Box Tube' },
  { id: 'circular-pipe', label: 'Pipe' },
];

const MATERIALS: { id: BeamMaterialId; label: string }[] = [
  { id: 'steel-a36', label: 'Steel A36' },
  { id: 'al-6061', label: 'Al 6061-T6' },
  { id: 'ti-6al4v', label: 'Ti-6Al-4V' },
  { id: 'timber', label: 'Glulam GL28h' },
];

const FIELDS: { id: StressFieldMode; label: string }[] = [
  { id: 'utilization', label: 'Utilization' },
  { id: 'bending', label: 'Bending σ' },
  { id: 'shear', label: 'Shear τ' },
];

const ROLL_SECONDS = 8; // one full traverse at 1×
const STEP_FRACTION = 0.02;
const ENVELOPE_POINTS = 241;
const MAIN_HEIGHT = 660;
const INSPECTOR_HEIGHT = 236;

function sameExceptLoadPos(a: BeamParams, b: BeamParams): boolean {
  return (
    a.support === b.support &&
    a.section === b.section &&
    a.material === b.material &&
    a.length === b.length &&
    a.depthMm === b.depthMm &&
    a.pointLoadKN === b.pointLoadKN &&
    a.udlKNm === b.udlKNm &&
    a.supportBFrac === b.supportBFrac &&
    a.selfWeight === b.selfWeight
  );
}

function newEnvelope(L: number): Envelope {
  const xs = Array.from({ length: ENVELOPE_POINTS }, (_, i) => (i / (ENVELOPE_POINTS - 1)) * L);
  return { xs, hi: xs.map(() => -Infinity), lo: xs.map(() => Infinity) };
}

function accumulate(env: Envelope, m: BeamModel) {
  for (let i = 0; i < env.xs.length; i++) {
    const M = momentAt(m, env.xs[i]);
    if (M > env.hi[i]) env.hi[i] = M;
    if (M < env.lo[i]) env.lo[i] = M;
  }
}

/** Where in the depth a stress peak sits, in words. */
function describeHeight(sec: CrossSection, y: number): string {
  const c = sec.depth / 2;
  const ay = Math.abs(y);
  if (ay > 0.97 * c) return y < 0 ? 'top fibre' : 'bottom fibre';
  if (ay < 0.03 * c) return 'neutral axis';
  if (sec.flangeThickness > 0 && Math.abs(ay - (c - sec.flangeThickness)) < 0.03 * c) return 'flange–web junction';
  return `${(y * 1e3).toFixed(0)} mm from N.A.`;
}

function governingMode(sol: BeamSolution): string {
  const mat = sol.model.material;
  if (mat.criterion === 'timber') {
    return sol.maxTauMPa / mat.shearStrengthMPa > sol.maxSigmaMPa / mat.strengthMPa ? 'shear governs' : 'bending governs';
  }
  return 'von Mises';
}

interface Telemetry {
  version: number;
  sol: BeamSolution;
  loadPos: number;
  envelopePeak: number | null; // largest |M| in the envelope [N·m]
}

export function BeamBendingLab({ meta }: { meta: SimulationEntry }) {
  const [presetId, setPresetId] = useState<PresetId | null>('girder');
  const [params, setParams] = useState<BeamParams>(PRESETS[0].params);
  const [mode, setMode] = useState<StressFieldMode>('utilization');
  const [cutFrac, setCutFrac] = useState(0.5);
  const [locked, setLocked] = useState(false);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [telemetry, setTelemetry] = useState<Telemetry>(() => ({
    version: 0,
    sol: solveBeam(PRESETS[0].params),
    loadPos: PRESETS[0].params.loadPos,
    envelopePeak: null,
  }));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inspectorRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cutRef = useRef(cutFrac);
  cutRef.current = cutFrac;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const solRef = useRef<BeamSolution>(telemetry.sol);
  const loadPosRef = useRef(params.loadPos); // live position, animated while rolling
  const dirRef = useRef<1 | -1>(1);
  const rollStartRef = useRef<number | null>(null);
  const envelopeRef = useRef<Envelope | null>(null);
  const scaleRef = useRef(1);
  const dirtyRef = useRef(true);
  const prevParamsRef = useRef(params);
  const dragRef = useRef<'load' | 'cut' | null>(null);

  useEffect(() => {
    const prev = prevParamsRef.current;
    prevParamsRef.current = params;
    if (!runningRef.current) loadPosRef.current = params.loadPos;
    if (!sameExceptLoadPos(prev, params)) envelopeRef.current = null;
    dirtyRef.current = true;
  }, [params]);

  const publish = useCallback(() => {
    const env = envelopeRef.current;
    let peak: number | null = null;
    if (env) {
      peak = 0;
      for (let i = 0; i < env.xs.length; i++) peak = Math.max(peak, Math.abs(env.hi[i]), Math.abs(env.lo[i]));
    }
    setTelemetry((prev) => ({
      version: prev.version + 1,
      sol: solRef.current,
      loadPos: loadPosRef.current,
      envelopePeak: peak,
    }));
  }, []);

  /** Moves the rolling load by a fraction of the span, bouncing off the ends. */
  const advanceLoad = useCallback((dp: number) => {
    let pos = loadPosRef.current + dirRef.current * dp;
    if (pos > 1) {
      pos = 2 - pos;
      dirRef.current = -1;
    } else if (pos < 0) {
      pos = -pos;
      dirRef.current = 1;
    }
    loadPosRef.current = clamp(pos, 0, 1);
  }, []);

  const solveNow = useCallback((record: boolean) => {
    const sol = solveBeam({ ...paramsRef.current, loadPos: loadPosRef.current });
    solRef.current = sol;
    if (record) {
      let env = envelopeRef.current;
      if (!env || env.xs[env.xs.length - 1] !== sol.model.L) {
        env = newEnvelope(sol.model.L);
        envelopeRef.current = env;
      }
      accumulate(env, sol.model);
    }
    return sol;
  }, []);

  const drawFrame = useCallback(() => {
    const sol = solRef.current;
    const m = sol.model;
    const cutX = cutRef.current * m.L;

    const canvas = canvasRef.current;
    if (canvas) {
      const { width, height, dpr } = syncCanvasSize(canvas);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const lay = beamLayout(width, height, m.L, m.section.depth);
        if (!lockedRef.current) {
          const auto = autoDeflectionScale(sol.maxDeflM, lay.pxPerM);
          // While rolling, only ever shrink the exaggeration so the drawing does not jump between steps.
          scaleRef.current = runningRef.current ? Math.min(scaleRef.current, auto) : auto;
        }
        ctx.save();
        ctx.scale(dpr, dpr);
        drawBeamLab(ctx, lay, {
          sol,
          mode: modeRef.current,
          cutX,
          deflScale: scaleRef.current,
          locked: lockedRef.current,
          rolling: runningRef.current,
          envelope: envelopeRef.current,
        });
        ctx.restore();
      }
    }

    const insp = inspectorRef.current;
    if (insp) {
      const { width, height, dpr } = syncCanvasSize(insp);
      const ctx = insp.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.scale(dpr, dpr);
        drawSectionInspector(ctx, width, height, sol, cutX, modeRef.current);
        ctx.restore();
      }
    }
  }, []);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const rolling = runningRef.current;
      if (rolling) advanceLoad((dt * speedRef.current) / ROLL_SECONDS);
      if (rolling || dirtyRef.current) {
        solveNow(rolling);
        dirtyRef.current = false;
        frame++;
        if (!rolling || frame % 4 === 0) publish();
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advanceLoad, drawFrame, publish, solveNow]);

  const update = (patch: Partial<BeamParams>) => {
    setPresetId(null);
    setParams((prev) => ({ ...prev, ...patch }));
  };

  const loadPreset = (id: PresetId) => {
    const pr = PRESETS.find((q) => q.id === id);
    if (!pr) return;
    runningRef.current = false;
    setRunning(false);
    rollStartRef.current = null;
    envelopeRef.current = null;
    setPresetId(id);
    setParams(pr.params);
    setCutFrac(pr.params.support === 'cantilever' ? 0.1 : 0.5);
  };

  const pause = () => {
    runningRef.current = false;
    setRunning(false);
    const pos = loadPosRef.current;
    setParams((prev) => ({ ...prev, loadPos: pos }));
  };

  const toggleRun = () => {
    if (running) {
      pause();
      return;
    }
    if (rollStartRef.current === null) rollStartRef.current = params.loadPos;
    // Rolling needs something to roll.
    if (params.pointLoadKN <= 0) setParams((prev) => ({ ...prev, pointLoadKN: 20 }));
    setRunning(true);
  };

  const step = () => {
    if (rollStartRef.current === null) rollStartRef.current = loadPosRef.current;
    runningRef.current = false;
    setRunning(false);
    advanceLoad(STEP_FRACTION);
    solveNow(true);
    const pos = loadPosRef.current;
    setParams((prev) => ({ ...prev, loadPos: pos }));
  };

  const reset = () => {
    runningRef.current = false;
    setRunning(false);
    envelopeRef.current = null;
    const home = rollStartRef.current;
    rollStartRef.current = null;
    dirRef.current = 1;
    if (home !== null) setParams((prev) => ({ ...prev, loadPos: home }));
    dirtyRef.current = true;
  };

  // Pointer: drag the point-load arrow, or drag anywhere else to move the section cut.
  const pointerToBeam = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const m = solRef.current.model;
    const lay = beamLayout(rect.width, rect.height, m.L, m.section.depth);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { lay, m, px, py, x: clamp(lay.toX(px), 0, m.L) };
  };

  const nearLoad = (info: ReturnType<typeof pointerToBeam>) =>
    !runningRef.current &&
    info.m.P > 0 &&
    info.py < info.lay.beamY &&
    info.py > info.lay.beamZone[0] &&
    Math.abs(info.px - info.lay.sx(info.m.a)) < 22;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const info = pointerToBeam(e);
    dragRef.current = nearLoad(info) ? 'load' : 'cut';
    e.currentTarget.setPointerCapture(e.pointerId);
    applyDrag(info.x, info.m.L);
  };

  const applyDrag = (x: number, L: number) => {
    if (dragRef.current === 'load') {
      const pos = Math.round((x / L) * 200) / 200;
      setPresetId(null);
      setParams((prev) => ({ ...prev, loadPos: pos }));
    } else if (dragRef.current === 'cut') {
      setCutFrac(clamp(x / L, 0, 1));
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const info = pointerToBeam(e);
    if (dragRef.current) {
      applyDrag(info.x, info.m.L);
      return;
    }
    e.currentTarget.style.cursor = nearLoad(info) ? 'grab' : 'crosshair';
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const sol = telemetry.sol;
  const m = sol.model;
  const p = params;
  const L = m.L;
  const deflMm = Math.abs(sol.maxDeflM) * 1e3;
  const spanRatio = deflMm > 1e-6 ? L / (deflMm * 1e-3) : Infinity;
  // Deflection limits are usually quoted per span, or per overhang length for a cantilever.
  const limitRatio = p.support === 'cantilever' ? 180 : 360;
  const sf = sol.safetyFactor;
  const sfColor = sf >= 1.5 ? '#34d399' : sf >= 1 ? '#f59e0b' : '#fb7185';
  const shownPos = running ? telemetry.loadPos : p.loadPos;

  const button = (active: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-orange-500/45 bg-orange-500/15 text-orange-200'
        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
    }`;

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={toggleRun}
      onStep={step}
      onReset={reset}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative w-full" style={{ height: MAIN_HEIGHT }}>
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      }
      belowCanvas={
        <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
          <canvas
            ref={inspectorRef}
            style={{ height: INSPECTOR_HEIGHT }}
            className="w-full rounded-lg border border-slate-800/70"
          />
        </div>
      }
      metrics={
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Reaction R_A"
              value={fmtNum(m.RA / 1e3, 1)}
              unit="kN"
              color="#34d399"
              sublabel={
                p.support === 'cantilever'
                  ? `wall moment ${Math.abs(m.MA / 1e3).toFixed(1)} kN·m`
                  : `R_B = ${fmtNum(m.RB / 1e3, 1)} kN at x = ${m.b.toFixed(2)} m`
              }
            />
            <MetricCard
              label="Max Shear |V|"
              value={(sol.maxShearN / 1e3).toFixed(1)}
              unit="kN"
              color="#fb7185"
              sublabel={`at x = ${sol.maxShearX.toFixed(2)} m`}
            />
            <MetricCard
              label="Max Moment |M|"
              value={(Math.abs(sol.maxMomentNm) / 1e3).toFixed(1)}
              unit="kN·m"
              color="#a78bfa"
              sublabel={
                telemetry.envelopePeak !== null
                  ? `envelope peak ${(telemetry.envelopePeak / 1e3).toFixed(1)} kN·m`
                  : `${sol.maxMomentNm >= 0 ? 'sagging' : 'hogging'} at x = ${sol.maxMomentX.toFixed(2)} m`
              }
            />
            <MetricCard
              label="Max Deflection"
              value={deflMm < 10 ? deflMm.toFixed(2) : deflMm.toFixed(1)}
              unit="mm"
              color={spanRatio < limitRatio ? '#f59e0b' : '#38bdf8'}
              sublabel={
                Number.isFinite(spanRatio)
                  ? `L/${spanRatio.toFixed(0)} · typical limit L/${limitRatio}${sol.maxDeflM < 0 ? ' · upward' : ''}`
                  : 'no load'
              }
            />
            <MetricCard
              label="Peak Bending σ"
              value={sol.maxSigmaMPa.toFixed(1)}
              unit="MPa"
              color="#fb7185"
              sublabel={`|M|max / S, S = ${Math.round(m.section.S * 1e6).toLocaleString()} cm³`}
            />
            <MetricCard
              label="Peak Shear τ"
              value={sol.maxTauMPa.toFixed(2)}
              unit="MPa"
              color="#f472b6"
              sublabel={`${(sol.maxTauMPa / Math.max(1e-9, sol.maxShearN / m.section.area / 1e6)).toFixed(2)} × V/A at N.A.`}
            />
            <MetricCard
              label="Safety Factor n"
              value={Number.isFinite(sf) ? (sf >= 100 ? '>100' : sf.toFixed(2)) : '∞'}
              color={sfColor}
              sublabel={
                sol.maxUtil > 1e-9
                  ? `${governingMode(sol)} · ${describeHeight(m.section, sol.maxUtilY)}, x = ${sol.maxUtilX.toFixed(2)} m`
                  : 'unloaded'
              }
            />
            <MetricCard
              label="Natural Frequency f₁"
              value={sol.f1Hz < 10 ? sol.f1Hz.toFixed(2) : sol.f1Hz.toFixed(1)}
              unit="Hz"
              color="#f472b6"
              sublabel={`bare beam · β₁L = ${sol.betaL.toFixed(3)} · ${sol.massPerLengthKgM.toFixed(0)} kg/m`}
            />
          </div>
          {sol.maxUtil >= 1 && (
            <div className="flex gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] leading-snug text-rose-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {m.material.criterion === 'timber' ? 'Strength limit' : 'First yield'} exceeded (U ={' '}
                {sol.maxUtil.toFixed(2)}). The beam would {m.material.criterion === 'timber' ? 'crack or split' : 'start to yield'} here,
                so the linear-elastic numbers beyond this point are not valid.
              </span>
            </div>
          )}
          {sol.slenderness < 10 && (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] leading-snug text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Stubby beam: L/h = {sol.slenderness.toFixed(1)}. Below about 10, shear deformation adds noticeably to
                the deflection, which Euler–Bernoulli theory ignores.
              </span>
            </div>
          )}
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
            <label className="text-xs font-medium text-slate-300">Supports</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SUPPORTS.map((s) => (
                <button key={s.id} type="button" onClick={() => update({ support: s.id })} className={button(p.support === s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Cross-Section</label>
            <div className="grid grid-cols-4 gap-1.5">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button" onClick={() => update({ section: s.id })} className={button(p.section === s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Material</label>
            <div className="grid grid-cols-2 gap-1.5">
              {MATERIALS.map((s) => (
                <button key={s.id} type="button" onClick={() => update({ material: s.id })} className={button(p.material === s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-slate-500">
              E = {m.material.youngsModulusGPa} GPa ·{' '}
              {m.material.criterion === 'timber'
                ? `f_m = ${m.material.strengthMPa} MPa, f_v = ${m.material.shearStrengthMPa} MPa`
                : `σ_y = ${m.material.strengthMPa} MPa`}{' '}
              · ρ = {m.material.densityKgM3} kg/m³
            </p>
          </div>

          <ParameterSlider
            label="Span (L)"
            value={p.length}
            min={2}
            max={12}
            step={0.1}
            precision={1}
            unit="m"
            onChange={(length) => update({ length })}
          />
          <ParameterSlider
            label="Section Depth (h)"
            value={p.depthMm}
            min={100}
            max={600}
            step={10}
            precision={0}
            unit="mm"
            hint="Stiffness grows as h³ (I ∝ h⁴ for these scaled shapes)"
            onChange={(depthMm) => update({ depthMm })}
          />
          <ParameterSlider
            label="Point Load (P)"
            value={p.pointLoadKN}
            min={0}
            max={200}
            step={1}
            precision={0}
            unit="kN"
            onChange={(pointLoadKN) => update({ pointLoadKN })}
          />
          <ParameterSlider
            label="Load Position (a)"
            value={shownPos * L}
            min={0}
            max={L}
            step={L / 200}
            precision={2}
            unit="m"
            disabled={running || p.pointLoadKN <= 0}
            hint={running ? 'Rolling: pause to place the load by hand' : 'Or drag the P arrow on the beam'}
            onChange={(a) => update({ loadPos: clamp(a / L, 0, 1) })}
          />
          <ParameterSlider
            label="Uniform Load (q)"
            value={p.udlKNm}
            min={0}
            max={40}
            step={0.5}
            precision={1}
            unit="kN/m"
            onChange={(udlKNm) => update({ udlKNm })}
          />
          {p.support === 'overhanging' && (
            <ParameterSlider
              label="Support B Position (b / L)"
              value={p.supportBFrac}
              min={0.5}
              max={0.95}
              step={0.005}
              precision={3}
              hint={`b = ${(p.supportBFrac * L).toFixed(2)} m · overhang ${((1 - p.supportBFrac) * L).toFixed(2)} m`}
              onChange={(supportBFrac) => update({ supportBFrac })}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => update({ selfWeight: !p.selfWeight })}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                p.selfWeight ? 'border-orange-500/40 bg-orange-500/15 text-orange-200' : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              Self-Weight: {p.selfWeight ? `ON (${(m.qSelf / 1e3).toFixed(2)} kN/m)` : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setLocked((v) => !v)}
              title="Keep the drawing exaggeration fixed so you can compare deflections by eye"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                locked ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              Deflection Scale: {locked ? 'Locked' : 'Auto'}
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Stress Field on the Beam</label>
            <div className="grid grid-cols-3 gap-1.5">
              {FIELDS.map((f) => (
                <button key={f.id} type="button" onClick={() => setMode(f.id)} className={button(mode === f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <ParameterSlider
            label="Section Cut A–A"
            value={cutFrac * L}
            min={0}
            max={L}
            step={L / 400}
            precision={2}
            unit="m"
            hint="Shows the stress profile through the depth at this x (below the diagrams)"
            onChange={(x) => setCutFrac(clamp(x / L, 0, 1))}
          />
        </>
      }
    />
  );
}
