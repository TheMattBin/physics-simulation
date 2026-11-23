import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { MetricCard } from '../../components/MetricCard';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import { drawAtom, bestPlane, planeToXYZ, type AtomScene, type AtomView } from './draw';
import { RadialPlot } from './RadialPlot';
import { SpectrumStrip, type EmittedLine } from './SpectrumStrip';
import {
  BOHR_NM,
  L_LETTERS,
  allOrbitals,
  bandName,
  beatPeriodFs,
  dipoleStrength,
  energy,
  enclosingRadius,
  lifetime,
  meanRadius,
  mostProbableRadius,
  mulberry32,
  orbitalName,
  orbitalText,
  photonWavelength,
  psi,
  sampleOrbital,
  seriesName,
  wavelengthColor,
  type Orbital,
} from './physics';

interface AtomState {
  primary: Orbital;
  partner: Orbital | null;
}

type PresetId = '1s' | '2p' | '3d' | 'lyman' | 'halpha' | 'forbidden';

const O = (n: number, l: number, m: number): Orbital => ({ n, l, m });

const PRESETS: { id: PresetId; label: string; state: AtomState }[] = [
  { id: '1s', label: 'Ground State 1s', state: { primary: O(1, 0, 0), partner: null } },
  { id: '2p', label: '2p Dumbbell', state: { primary: O(2, 1, 0), partner: null } },
  { id: '3d', label: '3d Cloverleaf', state: { primary: O(3, 2, 1), partner: null } },
  { id: 'lyman', label: 'Lyman α (2p → 1s)', state: { primary: O(2, 1, 0), partner: O(1, 0, 0) } },
  { id: 'halpha', label: 'Balmer Hα (3d → 2p)', state: { primary: O(3, 2, 0), partner: O(2, 1, 0) } },
  { id: 'forbidden', label: 'Forbidden 2s → 1s', state: { primary: O(2, 0, 0), partner: O(1, 0, 0) } },
];

const N_MAX = 4;
const CLOUD_POINTS = 7000;
const SLICE_GRID = 150;
const VISUAL_BEAT_HZ = 0.5; // the superposition's charge cloud oscillates once per 2 s at 1x
const PHOTON_SECONDS = 1.2;

const same = (a: Orbital | null, b: Orbital | null) => !!a && !!b && a.n === b.n && a.l === b.l && a.m === b.m;
const key = (o: Orbital) => `${o.n},${o.l},${o.m}`;

function buildScene(st: AtomState): AtomScene {
  const { primary, partner } = st;
  const seed = primary.n * 1000 + primary.l * 100 + (primary.m + 10) * 3 + (partner ? partner.n * 7 + partner.l * 11 + partner.m : 0);
  const rand = mulberry32(seed);
  const parts = partner ? [primary, partner] : [primary];
  const per = Math.floor(CLOUD_POINTS / parts.length);
  const points = new Float32Array(per * parts.length * 3);
  parts.forEach((o, i) => points.set(sampleOrbital(o, per, rand), i * per * 3));
  const count = points.length / 3;
  const psiA = new Float32Array(count);
  const psiB = partner ? new Float32Array(count) : null;
  for (let i = 0; i < count; i++) {
    const x = points[3 * i];
    const y = points[3 * i + 1];
    const z = points[3 * i + 2];
    psiA[i] = psi(primary, x, y, z);
    if (psiB && partner) psiB[i] = psi(partner, x, y, z);
  }
  const viewRadius = Math.max(...parts.map((o) => enclosingRadius(o.n, o.l, 0.97))) * 1.05;
  const plane = bestPlane(parts, viewRadius);
  const G = SLICE_GRID;
  const sliceA = new Float32Array(G * G);
  const sliceB = partner ? new Float32Array(G * G) : null;
  let sliceMax = 0;
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const u = -viewRadius + (2 * viewRadius * (i + 0.5)) / G;
      const v = -viewRadius + (2 * viewRadius * (j + 0.5)) / G;
      const [x, y, z] = planeToXYZ(plane, u, v);
      const a = psi(primary, x, y, z);
      sliceA[j * G + i] = a;
      let rho = a * a;
      if (sliceB && partner) {
        const b = psi(partner, x, y, z);
        sliceB[j * G + i] = b;
        rho = 0.5 * (Math.abs(a) + Math.abs(b)) ** 2;
      }
      sliceMax = Math.max(sliceMax, rho);
    }
  const allowed = !!partner && partner.n !== primary.n && dipoleStrength(primary, partner) > 0;
  return { primary, partner, points, psiA, psiB, viewRadius, plane, grid: G, sliceA, sliceB, sliceMax, allowed };
}

const lifetimeCache = new Map<string, number>();
function cachedLifetime(o: Orbital): number {
  const k = key(o);
  if (!lifetimeCache.has(k)) lifetimeCache.set(k, lifetime(o));
  return lifetimeCache.get(k) as number;
}

function formatLifetime(o: Orbital): { value: string; unit?: string; note: string } {
  if (o.n === 1) return { value: 'stable', note: 'ground state: nowhere lower to go' };
  const t = cachedLifetime(o);
  if (!Number.isFinite(t)) return { value: 'metastable', note: 'no allowed one-photon decay' };
  return { value: (t * 1e9).toFixed(2), unit: 'ns', note: `spontaneous emission from ${orbitalText(o)}` };
}

function OrbitalLabel({ o }: { o: Orbital }) {
  const { base, sub } = orbitalName(o);
  return (
    <span>
      {base}
      {sub && <sub className="text-[0.75em]">{sub}</sub>}
    </span>
  );
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

const choiceClass = (active: boolean, disabled = false) =>
  `rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
    disabled
      ? 'cursor-not-allowed border-slate-900 bg-slate-950 text-slate-700'
      : active
        ? 'border-lime-500/50 bg-lime-500/20 text-lime-200'
        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
  }`;

export function HydrogenAtomLab({ meta }: { meta: SimulationEntry }) {
  const [presetId, setPresetId] = useState<PresetId | null>('2p');
  const [atom, setAtom] = useState<AtomState>(PRESETS[1].state);
  const [mode, setMode] = useState<'cloud' | 'slice'>('cloud');
  const [showBohr, setShowBohr] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [emitted, setEmitted] = useState<EmittedLine[]>([]);
  const [message, setMessage] = useState('');

  const scene = useMemo(() => buildScene(atom), [atom]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const viewRef = useRef<AtomView>({
    yaw: 0.6,
    pitch: 0.35,
    phase: 0,
    mode,
    showBohr,
    photon: null,
    now: 0,
  });
  viewRef.current.mode = mode;
  viewRef.current.showBohr = showBohr;
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const collapseRef = useRef<{ at: number; to: Orbital; nUpper: number; nLower: number } | null>(null);
  const statusRef = useRef({ line1: '', line2: '' });

  const upper = atom.partner && energy(atom.partner.n) > energy(atom.primary.n) ? atom.partner : atom.primary;
  const lower = atom.partner ? (upper === atom.primary ? atom.partner : atom.primary) : null;
  const degenerate = !!atom.partner && atom.partner.n === atom.primary.n;
  const lambda = lower && !degenerate ? photonWavelength(upper.n, lower.n) : null;

  // Status text for the canvas
  {
    const p = atom.primary;
    if (!atom.partner) {
      statusRef.current = {
        line1: `${orbitalText(p)} · n=${p.n}, l=${p.l}, m=${p.m} · E = ${energy(p.n).toFixed(3)} eV · ${p.n - p.l - 1} radial + ${p.l} angular nodes`,
        line2: 'Each dot is a possible position of the electron, drawn from |ψ|². Drag to rotate.',
      };
    } else if (degenerate) {
      statusRef.current = {
        line1: `SUPERPOSITION ${orbitalText(p)} + ${orbitalText(atom.partner)} · same energy, so nothing oscillates`,
        line2: 'Degenerate states share one energy: the mixture is stationary and emits no light.',
      };
    } else {
      const T = beatPeriodFs(p, atom.partner);
      statusRef.current = {
        line1: `SUPERPOSITION ${orbitalText(p)} + ${orbitalText(atom.partner)} · cloud oscillates with period h/ΔE = ${T.toFixed(3)} fs`,
        line2: scene.allowed
          ? `Its oscillating charge radiates λ = ${lambda?.toFixed(2)} nm. Shown slowed ~10¹⁵×.`
          : 'The cloud breathes symmetrically: no oscillating dipole, so no photon (forbidden).',
      };
    }
  }

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    drawAtom(ctx, width, height, sceneRef.current, viewRef.current, statusRef.current);
    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - lastTime) / 1000));
      lastTime = now;
      const v = viewRef.current;
      v.now = now;
      if (runningRef.current) {
        if (autoRotateRef.current && !dragRef.current) v.yaw += 0.35 * dt * speedRef.current;
        if (sceneRef.current.partner) v.phase += 2 * Math.PI * VISUAL_BEAT_HZ * dt * speedRef.current;
      }
      const pending = collapseRef.current;
      if (pending && now >= pending.at) {
        collapseRef.current = null;
        setAtom({ primary: pending.to, partner: null });
        setPresetId(null);
        setEmitted((prev) => {
          const found = prev.find((e) => e.nUpper === pending.nUpper && e.nLower === pending.nLower);
          if (found) return prev.map((e) => (e === found ? { ...e, count: e.count + 1 } : e));
          return [...prev, { nUpper: pending.nUpper, nLower: pending.nLower, count: 1 }];
        });
      }
      if (v.photon && now - v.photon.start > PHOTON_SECONDS * 1000 + 300) v.photon = null;
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  const applyState = (next: AtomState, preset: PresetId | null = null) => {
    collapseRef.current = null;
    viewRef.current.photon = null;
    viewRef.current.phase = 0;
    setAtom(next);
    setPresetId(preset);
    setMessage('');
  };

  const choosePrimary = (o: Orbital) => {
    applyState({ primary: o, partner: same(o, atom.partner) ? null : atom.partner });
  };

  const emitPhoton = () => {
    if (!atom.partner || !lower) return;
    if (degenerate) {
      setMessage('Both states have the same energy, so there is no photon to emit.');
      return;
    }
    if (!scene.allowed) {
      setMessage(
        `⟨${orbitalText(lower)}|r|${orbitalText(upper)}⟩ = 0: no electric-dipole photon. ${
          upper.n === 2 && upper.l === 0 ? 'Real 2s atoms survive ~0.12 s and decay by emitting two photons at once.' : 'This transition is forbidden.'
        }`,
      );
      return;
    }
    const lam = photonWavelength(upper.n, lower.n);
    const now = performance.now();
    viewRef.current.photon = { start: now, color: wavelengthColor(lam) };
    collapseRef.current = { at: now + PHOTON_SECONDS * 1000, to: lower, nUpper: upper.n, nLower: lower.n };
    setMessage(
      `Emitted a ${lam.toFixed(2)} nm photon (${seriesName(lower.n)} series, ${bandName(lam)}). The atom drops to ${orbitalText(lower)}.`,
    );
  };

  const p = atom.primary;
  const life = formatLifetime(upper);
  const rmp = mostProbableRadius(p.n, p.l);
  const partnerOptions = allOrbitals(N_MAX).filter((o) => !same(o, p));
  const dipole = atom.partner ? dipoleStrength(atom.primary, atom.partner) : 0;

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={() => {
        setRunning(false);
        viewRef.current.phase += Math.PI / 8;
        drawFrame();
      }}
      onReset={() => {
        viewRef.current.yaw = 0.6;
        viewRef.current.pitch = 0.35;
        viewRef.current.phase = 0;
        setEmitted([]);
        setMessage('');
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      canvas={
        <div
          className="relative h-[560px] w-full cursor-grab active:cursor-grabbing sm:h-[480px]"
          style={{ touchAction: 'pan-y' }}
          onPointerDown={(e) => {
            dragRef.current = { x: e.clientX, y: e.clientY };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const v = viewRef.current;
            v.yaw += (e.clientX - d.x) * 0.01;
            v.pitch = Math.max(-1.45, Math.min(1.45, v.pitch + (e.clientY - d.y) * 0.01));
            dragRef.current = { x: e.clientX, y: e.clientY };
            if (!runningRef.current) drawFrame();
          }}
          onPointerUp={() => (dragRef.current = null)}
          onPointerCancel={() => (dragRef.current = null)}
        >
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RadialPlot primary={atom.primary} partner={atom.partner} rMax={scene.viewRadius} />
          <SpectrumStrip
            emitted={emitted}
            current={lower && !degenerate ? { nUpper: upper.n, nLower: lower.n, allowed: scene.allowed } : null}
          />
        </div>
      }
      metrics={
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <MetricCard
              label="Energy of Level n"
              value={energy(p.n).toFixed(3)}
              unit="eV"
              color="#f59e0b"
              sublabel={`−13.6 eV / n², n = ${p.n}`}
            />
            <MetricCard
              label="Degeneracy"
              value={`${p.n * p.n}`}
              color="#a3e635"
              sublabel="states share this energy (all l, m)"
            />
            <MetricCard
              label="Most Probable r"
              value={rmp.toFixed(2)}
              unit="a₀"
              color="#f59e0b"
              sublabel={`Bohr orbit: n²a₀ = ${p.n * p.n} a₀`}
            />
            <MetricCard
              label="Mean Radius ⟨r⟩"
              value={meanRadius(p.n, p.l).toFixed(1)}
              unit="a₀"
              color="#e2e8f0"
              sublabel={`= ${(meanRadius(p.n, p.l) * BOHR_NM).toFixed(3)} nm`}
            />
            <MetricCard
              label="Nodes"
              value={`${p.n - p.l - 1} + ${p.l}`}
              color="#38bdf8"
              sublabel="radial + angular (n − 1 total)"
            />
            <MetricCard
              label={atom.partner ? 'Upper-State Lifetime' : 'Lifetime τ'}
              value={life.value}
              unit={life.unit}
              color="#f472b6"
              sublabel={life.note}
            />
          </div>
          {atom.partner && (
            <div className="rounded-lg border border-slate-800/90 bg-[#080d18] p-3 text-xs">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">Transition</div>
              {degenerate ? (
                <p className="text-slate-300">Same n: no energy difference, no photon.</p>
              ) : (
                <div className="space-y-1 font-mono text-[11px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Photon λ</span>
                    <span style={{ color: lambda ? wavelengthColor(lambda) : undefined }}>
                      {lambda?.toFixed(2)} nm · {lambda ? bandName(lambda) : ''}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Series</span>
                    <span className="text-slate-200">
                      {lower ? seriesName(lower.n) : ''} ({upper.n} → {lower?.n})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dipole |⟨a|r|b⟩|</span>
                    <span className={scene.allowed ? 'text-emerald-300' : 'text-rose-300'}>
                      {scene.allowed ? `${dipole.toFixed(3)} a₀ · allowed` : '0 · forbidden'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Real beat period</span>
                    <span className="text-slate-200">{beatPeriodFs(atom.primary, atom.partner).toFixed(3)} fs</span>
                  </div>
                </div>
              )}
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
                <button key={pr.id} type="button" onClick={() => applyState(pr.state, pr.id)} className={choiceClass(presetId === pr.id)}>
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Principal number n (energy, size)</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    const l = Math.min(p.l, n - 1);
                    choosePrimary({ n, l, m: Math.max(-l, Math.min(l, p.m)) });
                  }}
                  className={choiceClass(p.n === n)}
                >
                  n = {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Angular momentum l (shape)</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((l) => (
                <button
                  key={l}
                  type="button"
                  disabled={l >= p.n}
                  onClick={() => choosePrimary({ n: p.n, l, m: Math.max(-l, Math.min(l, p.m)) })}
                  className={choiceClass(p.l === l, l >= p.n)}
                >
                  {L_LETTERS[l]} (l={l})
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Orientation m (real orbital)</label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 2 * p.l + 1 }, (_, i) => i - p.l).map((m) => (
                <button key={m} type="button" onClick={() => choosePrimary({ n: p.n, l: p.l, m })} className={choiceClass(p.m === m)}>
                  <OrbitalLabel o={{ n: p.n, l: p.l, m }} />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300" htmlFor="partner">
              Superpose with a second state
            </label>
            <select
              id="partner"
              value={atom.partner ? key(atom.partner) : ''}
              onChange={(e) => {
                const v = e.target.value;
                const o = v ? partnerOptions.find((q) => key(q) === v) ?? null : null;
                applyState({ primary: p, partner: o });
              }}
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200"
            >
              <option value="">none (stationary state)</option>
              {partnerOptions.map((o) => (
                <option key={key(o)} value={key(o)}>
                  {orbitalText(o)}  ({energy(o.n).toFixed(2)} eV)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={emitPhoton}
              disabled={!atom.partner}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                atom.partner
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'cursor-not-allowed border-slate-900 bg-slate-950 text-slate-600'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {atom.partner ? 'Emit Photon (collapse to lower state)' : 'Pick a second state to emit light'}
            </button>
            {message && <p className="text-[11px] leading-snug text-slate-400">{message}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
              {(['cloud', 'slice'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2.5 py-1 text-xs ${mode === m ? 'bg-lime-500/20 text-lime-300' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {m === 'cloud' ? '3D Cloud' : 'Slice'}
                </button>
              ))}
            </div>
            <ToggleButton on={showBohr} label="Bohr Orbit" onClick={() => setShowBohr((v) => !v)} />
            <ToggleButton on={autoRotate} label="Auto-Rotate" onClick={() => setAutoRotate((v) => !v)} />
          </div>
        </>
      }
    />
  );
}
