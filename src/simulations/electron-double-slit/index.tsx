import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import { DetectionHistogram } from './DetectionHistogram';
import { FLIGHT_SECONDS, drawSlitLab, formatLength, type Flight, type Hits } from './draw';
import { LogSlider } from './LogSlider';
import {
  computePattern,
  electronWavelength,
  fresnelNumber,
  fringeSpacing,
  sampleDetection,
  visibility,
  type Pattern,
  type SlitMode,
  type SlitParams,
} from './physics';

type PresetId = 'double' | 'single' | 'watched' | 'near';

/** Bach et al., New J. Phys. 15, 033018 (2013): 600 eV electrons, 62 nm slits, 272 nm apart. */
const BACH: SlitParams = { energy: 600, width: 62, separation: 272, distance: 0.24e9, mode: 'both', which: 0 };

const PRESETS: { id: PresetId; label: string; params: SlitParams; rate: number }[] = [
  { id: 'double', label: 'Double Slit (Bach 2013)', params: BACH, rate: 40 },
  { id: 'single', label: 'One Slit Closed', params: { ...BACH, mode: 'left' }, rate: 400 },
  { id: 'watched', label: 'Which-Path Detector', params: { ...BACH, which: 1 }, rate: 400 },
  { id: 'near', label: 'Screen Up Close', params: { ...BACH, distance: 8000 }, rate: 400 },
];

const MAX_HITS = 400000;
const ANIMATE_BELOW_RATE = 30; // electrons/s: below this each flight is animated

function binCount(p: SlitParams, pattern: Pattern): number {
  const perFringe = (2 * pattern.halfWidth) / fringeSpacing(p);
  return Math.max(120, Math.min(600, Math.ceil(12 * perFringe)));
}

/** Fringe contrast (B − D)/(B + D) from counts in bright vs dark zones of the central envelope. */
function fringeContrast(p: SlitParams, W: number, counts: ArrayLike<number>): number | null {
  if (p.mode !== 'both' || fresnelNumber(p) > 0.05) return null;
  const lambda = electronWavelength(p.energy);
  const envelope = (lambda * p.distance) / p.width;
  const dx = fringeSpacing(p);
  const bins = counts.length;
  let bright = 0;
  let dark = 0;
  for (let b = 0; b < bins; b++) {
    const X = -W + ((b + 0.5) / bins) * 2 * W;
    if (Math.abs(X) > 0.6 * envelope) continue;
    const ph = (((X / dx) % 1) + 1) % 1;
    if (ph < 0.15 || ph > 0.85) bright += counts[b];
    else if (Math.abs(ph - 0.5) < 0.15) dark += counts[b];
  }
  return bright + dark > 0 ? (bright - dark) / (bright + dark) : null;
}

interface Telemetry {
  version: number;
  total: number;
  counts: number[];
}

export function ElectronDoubleSlitLab({ meta }: { meta: SimulationEntry }) {
  const [presetId, setPresetId] = useState<PresetId | null>('double');
  const [params, setParams] = useState<SlitParams>(BACH);
  const [rate, setRate] = useState(40);
  const [showTheory, setShowTheory] = useState(false);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  const pattern = useMemo(() => computePattern(params), [params]);
  const bins = useMemo(() => binCount(params, pattern), [params, pattern]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const patternRef = useRef(pattern);
  patternRef.current = pattern;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const binsRef = useRef(bins);
  binsRef.current = bins;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const showTheoryRef = useRef(showTheory);
  showTheoryRef.current = showTheory;

  const hitsRef = useRef<Hits>({ x: new Float32Array(MAX_HITS), y: new Float32Array(MAX_HITS), count: 0 });
  const countsRef = useRef<number[]>(new Array(bins).fill(0));
  const flightsRef = useRef<Flight[]>([]);
  const budgetRef = useRef(0);
  const [telemetry, setTelemetry] = useState<Telemetry>({ version: 0, total: 0, counts: countsRef.current });

  const publish = useCallback(() => {
    setTelemetry((prev) => ({ version: prev.version + 1, total: hitsRef.current.count, counts: countsRef.current.slice() }));
  }, []);

  const clearScreen = useCallback(() => {
    hitsRef.current.count = 0;
    countsRef.current = new Array(binsRef.current).fill(0);
    flightsRef.current = [];
    budgetRef.current = 0;
    publish();
  }, [publish]);

  // A new pattern or binning invalidates the recorded hits.
  useEffect(() => {
    clearScreen();
  }, [pattern, bins, clearScreen]);

  const recordHit = useCallback((x: number, y: number) => {
    const h = hitsRef.current;
    if (h.count < MAX_HITS) {
      h.x[h.count] = x;
      h.y[h.count] = y;
      h.count++;
    }
    const W = patternRef.current.halfWidth;
    const n = countsRef.current.length;
    const b = Math.floor(((x + W) / (2 * W)) * n);
    if (b >= 0 && b < n) countsRef.current[b]++;
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = paramsRef.current;
    const lambda = electronWavelength(p.energy);
    const nf = fresnelNumber(p);
    const status = {
      line1:
        p.mode !== 'both'
          ? 'ONE SLIT OPEN · a single diffraction band, no interference fringes'
          : p.which >= 0.999
            ? 'WHICH-PATH DETECTOR ON · the electron is "seen" at one slit: fringes vanish'
            : nf > 0.05
              ? `NEAR FIELD · Fresnel number a²/λL = ${nf.toFixed(1)}: you see the slits' shadows`
              : `INTERFERENCE · fringes every λL/d = ${formatLength(fringeSpacing(p))}`,
      line2: `${p.energy >= 1000 ? `${(p.energy / 1000).toPrecision(3)} keV` : `${p.energy.toPrecision(3)} eV`} electrons, λ = ${(lambda * 1000).toFixed(2)} pm · a = ${p.width} nm, d = ${p.separation} nm, L = ${formatLength(p.distance)}`,
    };
    ctx.save();
    ctx.scale(dpr, dpr);
    drawSlitLab(
      ctx,
      width,
      height,
      dpr,
      {
        params: p,
        pattern: patternRef.current,
        hits: hitsRef.current,
        flights: flightsRef.current,
        now: performance.now(),
        showTheory: showTheoryRef.current,
      },
      status,
    );
    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - lastTime) / 1000));
      lastTime = now;
      // Land electrons whose flight has finished.
      const flights = flightsRef.current;
      for (const fl of flights) {
        if (!fl.landed && now - fl.fired >= FLIGHT_SECONDS * 1000) {
          recordHit(fl.x, fl.y);
          fl.landed = true;
        }
      }
      flightsRef.current = flights.filter((fl) => now - fl.fired < (FLIGHT_SECONDS + 0.6) * 1000);

      if (runningRef.current) {
        budgetRef.current += rateRef.current * speedRef.current * dt;
        const animate = rateRef.current < ANIMATE_BELOW_RATE;
        let fired = 0;
        while (budgetRef.current >= 1 && fired < 5000) {
          budgetRef.current -= 1;
          fired++;
          const x = sampleDetection(patternRef.current, Math.random());
          const y = Math.random();
          if (animate) flightsRef.current.push({ fired: now, x, y });
          else recordHit(x, y);
        }
        frame++;
        if (frame % 6 === 0) publish();
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame, publish, recordHit]);

  const update = (patch: Partial<SlitParams>) => {
    setPresetId(null);
    setParams((prev) => {
      const next = { ...prev, ...patch };
      if (next.separation < next.width + 10) next.separation = next.width + 10;
      return next;
    });
  };

  const loadPreset = (id: PresetId) => {
    const pr = PRESETS.find((q) => q.id === id);
    if (!pr) return;
    setPresetId(id);
    setParams(pr.params);
    setRate(pr.rate);
    setRunning(true);
  };

  const p = params;
  const lambda = electronWavelength(p.energy);
  const nf = fresnelNumber(p);
  const V = p.mode === 'both' ? visibility(p.which) : 0;
  const measured = fringeContrast(p, pattern.halfWidth, telemetry.counts);
  const expectedContrast = useMemo(() => {
    const W = pattern.halfWidth;
    const exp = new Array(bins).fill(0);
    for (let i = 0; i < pattern.X.length; i++) {
      const b = Math.min(bins - 1, Math.floor(((pattern.X[i] + W) / (2 * W)) * bins));
      exp[b] += pattern.I[i];
    }
    return fringeContrast(p, W, exp);
  }, [p, pattern, bins]);

  const modes: { id: SlitMode; label: string }[] = [
    { id: 'both', label: 'Both Open' },
    { id: 'left', label: 'Left Only' },
    { id: 'right', label: 'Right Only' },
  ];

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={() => {
        setRunning(false);
        const x = sampleDetection(patternRef.current, Math.random());
        flightsRef.current.push({ fired: performance.now(), x, y: Math.random() });
      }}
      onReset={() => {
        clearScreen();
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative h-[560px] w-full sm:h-[460px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={<DetectionHistogram pattern={pattern} counts={telemetry.counts} total={telemetry.total} version={telemetry.version} />}
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="de Broglie λ"
            value={(lambda * 1000).toFixed(2)}
            unit="pm"
            color="#a3e635"
            sublabel="λ = h / p"
          />
          <MetricCard
            label="Fringe Spacing"
            value={formatLength(fringeSpacing(p)).split(' ')[0]}
            unit={formatLength(fringeSpacing(p)).split(' ')[1]}
            color="#38bdf8"
            sublabel="λL / d (far field)"
          />
          <MetricCard
            label="Electrons Detected"
            value={telemetry.total.toLocaleString()}
            color="#d9f99d"
            sublabel={`${rate < 10 ? rate.toFixed(1) : Math.round(rate)} per second, one at a time`}
          />
          <MetricCard
            label="Fringe Contrast"
            value={measured !== null && telemetry.total >= 50 ? measured.toFixed(2) : '—'}
            color="#a78bfa"
            sublabel={expectedContrast !== null ? `expected ${expectedContrast.toFixed(2)} from |ψ|²` : 'needs both slits, far field'}
          />
          <MetricCard
            label="Visibility V"
            value={V.toFixed(2)}
            color="#f59e0b"
            sublabel={p.mode === 'both' ? `which-path D = ${p.which.toFixed(2)}, V² + D² = 1` : 'one slit: nothing to interfere'}
          />
          <MetricCard
            label="Fresnel Number"
            value={nf < 0.01 ? nf.toExponential(1) : nf.toFixed(2)}
            color="#f472b6"
            sublabel={nf > 1 ? 'near field: slit shadows' : nf > 0.05 ? 'in between (Fresnel)' : 'far field: fringes'}
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Presets</label>
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

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Slits</label>
            <div className="grid grid-cols-3 gap-1.5">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => update({ mode: m.id })}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium ${
                    p.mode === m.id
                      ? 'border-lime-500/45 bg-lime-500/15 text-lime-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <LogSlider
            label="Electron Rate"
            value={rate}
            min={1}
            max={3000}
            format={(v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} /s`}
            hint="Below 30 /s you can follow each electron through the apparatus"
            onChange={setRate}
          />
          <ParameterSlider
            label="Which-Path Detector (D)"
            value={p.which}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            hint="How well the detector tells which slit was used. Fringe visibility V = √(1 − D²)."
            disabled={p.mode !== 'both'}
            onChange={(which) => update({ which })}
          />
          <LogSlider
            label="Electron Energy"
            value={p.energy}
            min={20}
            max={100000}
            format={(v) => (v >= 1000 ? `${(v / 1000).toPrecision(3)} keV` : `${v.toPrecision(3)} eV`)}
            hint="Faster electrons have shorter λ, so the fringes squeeze together"
            onChange={(energy) => update({ energy })}
          />
          <ParameterSlider
            label="Slit Width (a)"
            value={p.width}
            min={20}
            max={300}
            step={1}
            precision={0}
            unit="nm"
            onChange={(width) => update({ width })}
          />
          <ParameterSlider
            label="Slit Separation (d)"
            value={p.separation}
            min={60}
            max={2000}
            step={2}
            precision={0}
            unit="nm"
            onChange={(separation) => update({ separation })}
          />
          <LogSlider
            label="Screen Distance (L)"
            value={p.distance}
            min={1000}
            max={1e9}
            format={formatLength}
            hint="Close up you see the slits' shadows; far away, interference fringes"
            onChange={(distance) => update({ distance })}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowTheory((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                showTheory ? 'border-lime-500/40 bg-lime-500/15 text-lime-300' : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              |ψ|² on Screen: {showTheory ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={clearScreen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
            >
              <Eraser className="h-3.5 w-3.5" /> Clear Screen
            </button>
          </div>
        </>
      }
    />
  );
}
