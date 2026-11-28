import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LabShell } from '../../components/LabShell';
import { LivePlot } from '../../components/LivePlot';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { clamp, syncCanvasSize } from '../../engine/math';
import { RingBuffer } from '../../engine/ringBuffer';
import type { SimulationEntry } from '../../engine/types';
import {
  drawLensingCanvas,
  drawOrbitCanvas,
  drawPlungeCanvas,
  lensingSkyLayout,
} from './draw';
import {
  BH_MASS_PRESETS,
  B_CRIT_RS,
  circularOrbitConstants,
  createNewtonianTwin,
  createTimelikeParticle,
  effectivePotential,
  exactRadialFallProperTimeToHorizon,
  exactRadialFallProperTimeToSingularity,
  radialInfallRedshiftFactor,
  solveEinsteinLens,
  stepNewtonianTwin,
  stepTimelikeParticle,
  timelikeHamiltonianError,
  tracePhotonGeodesic,
  weakFieldPrecessionRad,
  type BHScenario,
  type BlackHoleMassPreset,
} from './physics';

const PLOT_CAP = 260;

type OrbitPresetId = 'mercury-rosette' | 'isco-edge' | 'zoom-whirl' | 'plunge-capture';

const ORBIT_PRESETS: {
  id: OrbitPresetId;
  label: string;
  r0: number;
  ell: number;
  energy: number;
}[] = [
  { id: 'mercury-rosette', label: 'Precessing Rosette', r0: 10.0, ell: 2.15, energy: 0.964 },
  {
    id: 'isco-edge',
    label: 'ISCO Circular (3 r_s)',
    r0: 3.0,
    ell: Math.sqrt(3),
    energy: Math.sqrt(8 / 9),
  },
  { id: 'zoom-whirl', label: 'Zoom–Whirl Skim', r0: 13.0, ell: 1.98, energy: 0.986 },
  { id: 'plunge-capture', label: 'Sub-ISCO Plunge', r0: 7.5, ell: 1.58, energy: 0.955 },
];

export function BlackHoleGeodesicsLab({ meta }: { meta: SimulationEntry }) {
  const [scenario, setScenario] = useState<BHScenario>('orbit');
  const [massId, setMassId] = useState<BlackHoleMassPreset['id']>('stellar');
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  // 1. Orbit controls
  const [r0, setR0] = useState(10.0);
  const [ell, setEll] = useState(2.15);
  const [energy, setEnergy] = useState(0.964);
  const [showNewtonTwin, setShowNewtonTwin] = useState(true);

  // 2. Plunge controls
  const [plungeR0, setPlungeR0] = useState(7.0);

  // 3. Lensing controls
  const [testImpactB, setTestImpactB] = useState(2.68);
  const [srcOffset, setSrcOffset] = useState({ x: 0.32, y: -0.18 });

  const [telemetryTick, setTelemetryTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const orbitCfgRef = useRef({ r0, ell, energy, showNewtonTwin });
  orbitCfgRef.current = { r0, ell, energy, showNewtonTwin };
  const plungeR0Ref = useRef(plungeR0);
  plungeR0Ref.current = plungeR0;
  const lensingCfgRef = useRef({ testImpactB, srcOffset });
  lensingCfgRef.current = { testImpactB, srcOffset };

  const draggingStarRef = useRef(false);

  // Precompute parallel photon geodesic fan once
  const beamRays = useMemo(() => {
    const rays = [];
    for (let i = -13; i <= 13; i++) {
      const b = i * 0.46;
      if (Math.abs(b) < 0.02) continue;
      rays.push(tracePhotonGeodesic(b, 12.5, 13.5));
    }
    return rays;
  }, []);

  const highlightRay = useMemo(
    () => tracePhotonGeodesic(testImpactB, 12.5, 13.5),
    [testImpactB],
  );

  // Mutable simulation runtime
  const runtimeRef = useRef({
    particle: createTimelikeParticle(10.0, 2.15, 0.964, true),
    trail: [] as number[],
    newton: createNewtonianTwin(createTimelikeParticle(10.0, 2.15, 0.964, true)),
    newtonTrail: [] as number[],
    prevVr: -0.01,
    periapsisAngles: [] as number[],
    lastPrecessionDeg: null as number | null,
    maxHamErr: 0,

    plungeProbe: createTimelikeParticle(7.0, 0, Math.sqrt(1 - 1 / 7.0), true),
    plungeHistory: [] as { tau: number; tCoord: number; r: number }[],

    wavefrontPhase: 0,
  });

  const [buffers] = useState(() => ({
    rGR: new RingBuffer<number>(PLOT_CAP),
    rNewton: new RingBuffer<number>(PLOT_CAP),
  }));

  const resetOrbit = useCallback(
    (nextR0: number, nextEll: number, nextE: number) => {
      const rt = runtimeRef.current;
      const p = createTimelikeParticle(nextR0, nextEll, nextE, true);
      rt.particle = p;
      rt.trail = [p.r * Math.cos(p.phi), p.r * Math.sin(p.phi)];
      rt.newton = createNewtonianTwin(p);
      rt.newtonTrail = [p.r, 0];
      rt.prevVr = p.vr;
      rt.periapsisAngles = [];
      rt.lastPrecessionDeg = null;
      rt.maxHamErr = 0;
      buffers.rGR.clear();
      buffers.rNewton.clear();
      buffers.rGR.push(p.r);
      buffers.rNewton.push(rt.newton.r);
      setTelemetryTick((n) => n + 1);
    },
    [buffers],
  );

  const resetPlunge = useCallback((nextR0: number) => {
    const rt = runtimeRef.current;
    const e0 = Math.sqrt(1 - 1 / nextR0);
    rt.plungeProbe = createTimelikeParticle(nextR0, 0, e0, true);
    rt.plungeHistory = [{ tau: 0, tCoord: 0, r: nextR0 }];
    setTelemetryTick((n) => n + 1);
  }, []);

  const resetActive = useCallback(() => {
    if (scenarioRef.current === 'orbit') {
      const c = orbitCfgRef.current;
      resetOrbit(c.r0, c.ell, c.energy);
    } else if (scenarioRef.current === 'plunge') {
      resetPlunge(plungeR0Ref.current);
    } else {
      runtimeRef.current.wavefrontPhase = 0;
      setTelemetryTick((n) => n + 1);
    }
  }, [resetOrbit, resetPlunge]);

  // Seed initial trails on mount
  useEffect(() => {
    resetOrbit(10.0, 2.15, 0.964);
    resetPlunge(7.0);
  }, [resetOrbit, resetPlunge]);

  const advance = useCallback(
    (dtReal: number) => {
      const rt = runtimeRef.current;
      const sc = scenarioRef.current;

      if (sc === 'orbit') {
        const p = rt.particle;
        if (p.status === 'orbiting' || p.status === 'horizon') {
          const totalDTau = dtReal * 24;
          const chunks = 8;
          const subTau = totalDTau / chunks;
          for (let k = 0; k < chunks; k++) {
            const oldVr = p.vr;
            const oldPhi = p.phi;
            stepTimelikeParticle(p, subTau);
            stepNewtonianTwin(rt.newton, subTau);

            // Detect periapsis (vr crosses from < 0 to >= 0) with linear zero-crossing interpolation
            if (oldVr < 0 && p.vr >= 0 && p.r > 1.2) {
              const frac = -oldVr / Math.max(1e-12, p.vr - oldVr);
              const phiPeri = oldPhi + frac * (p.phi - oldPhi);
              rt.periapsisAngles.push(phiPeri);
              const m = rt.periapsisAngles.length;
              if (m >= 2) {
                const dPhi = Math.abs(rt.periapsisAngles[m - 1] - rt.periapsisAngles[m - 2]) - 2 * Math.PI;
                rt.lastPrecessionDeg = (dPhi * 180) / Math.PI;
              }
            }
            rt.prevVr = p.vr;
            rt.maxHamErr = Math.max(rt.maxHamErr, timelikeHamiltonianError(p));

            const x = p.r * Math.cos(p.phi);
            const y = p.r * Math.sin(p.phi);
            const tLen = rt.trail.length;
            if (tLen < 2 || Math.hypot(x - rt.trail[tLen - 2], y - rt.trail[tLen - 1]) > 0.08) {
              rt.trail.push(x, y);
              if (rt.trail.length > 3600) rt.trail.splice(0, rt.trail.length - 3000);
            }

            const nx = rt.newton.r * Math.cos(rt.newton.phi);
            const ny = rt.newton.r * Math.sin(rt.newton.phi);
            const nLen = rt.newtonTrail.length;
            if (
              nLen < 2 ||
              Math.hypot(nx - rt.newtonTrail[nLen - 2], ny - rt.newtonTrail[nLen - 1]) > 0.08
            ) {
              rt.newtonTrail.push(nx, ny);
              if (rt.newtonTrail.length > 2400) rt.newtonTrail.splice(0, rt.newtonTrail.length - 2000);
            }
          }
          buffers.rGR.push(p.r);
          buffers.rNewton.push(Math.min(25, rt.newton.r));
        }
      } else if (sc === 'plunge') {
        const pr = rt.plungeProbe;
        if (pr.status !== 'singularity') {
          const dTau = dtReal * 5.2;
          const chunks = 8;
          for (let k = 0; k < chunks; k++) {
            stepTimelikeParticle(pr, dTau / chunks);
            rt.plungeHistory.push({ tau: pr.tau, tCoord: pr.coordT, r: pr.r });
          }
        }
      } else {
        rt.wavefrontPhase += dtReal * 1.15;
      }
    },
    [buffers],
  );

  const drawNow = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    const rt = runtimeRef.current;
    const sc = scenarioRef.current;

    if (sc === 'orbit') {
      const viewR = Math.max(14, orbitCfgRef.current.r0 * 1.45);
      drawOrbitCanvas(ctx, width, height, rt.particle, rt.trail, rt.newton, rt.newtonTrail, {
        showNewtonTwin: orbitCfgRef.current.showNewtonTwin,
        viewRadiusRs: viewR,
        lastPrecessionDeg: rt.lastPrecessionDeg,
      });
    } else if (sc === 'plunge') {
      drawPlungeCanvas(ctx, width, height, rt.plungeProbe, plungeR0Ref.current, rt.plungeHistory);
    } else {
      const lc = lensingCfgRef.current;
      drawLensingCanvas(
        ctx,
        width,
        height,
        beamRays,
        highlightRay,
        lc.srcOffset.x,
        lc.srcOffset.y,
        rt.wavefrontPhase,
      );
    }
    ctx.restore();
  }, [beamRays, highlightRay]);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (runningRef.current) {
        advance(dt * speedRef.current);
        frame++;
        if (frame % 4 === 0) setTelemetryTick((n) => n + 1);
      }
      drawNow();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advance, drawNow]);

  // Pointer drag for background lensed star in 'lensing' mode
  const updateStarFromPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lay = lensingSkyLayout(rect.width, rect.height);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ux = clamp((px - lay.skyCx) / lay.einsteinRadiusPx, -1.65, 1.65);
    const uy = clamp((py - lay.skyCy) / lay.einsteinRadiusPx, -1.65, 1.65);
    setSrcOffset({ x: ux, y: uy });
    setTelemetryTick((n) => n + 1);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scenarioRef.current !== 'lensing') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const lay = lensingSkyLayout(rect.width, rect.height);
    if (e.clientX - rect.left >= lay.splitX) {
      draggingStarRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      updateStarFromPointer(e);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scenarioRef.current !== 'lensing') {
      e.currentTarget.style.cursor = 'default';
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const lay = lensingSkyLayout(rect.width, rect.height);
    if (draggingStarRef.current) {
      updateStarFromPointer(e);
      return;
    }
    e.currentTarget.style.cursor = e.clientX - rect.left >= lay.splitX ? 'crosshair' : 'default';
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingStarRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const massPreset = BH_MASS_PRESETS.find((m) => m.id === massId) ?? BH_MASS_PRESETS[0];
  const rt = runtimeRef.current;
  const p = rt.particle;
  const pr = rt.plungeProbe;
  const lensSol = solveEinsteinLens(Math.hypot(srcOffset.x, srcOffset.y));
  const minEnergyAtR0 = Math.sqrt(Math.max(0.01, effectivePotential(r0, ell)));

  const pillBtn = (active: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-indigo-500/45 bg-indigo-500/15 text-indigo-200'
        : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
    }`;

  const fmtPhysicalTime = (tauRs: number) => {
    const ms = tauRs * massPreset.timeUnitMs;
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(2)} ms`;
  };

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={() => {
        setRunning(false);
        advance(0.08);
        setTelemetryTick((n) => n + 1);
      }}
      onReset={() => {
        resetActive();
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      extraToolbar={
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['orbit', 'Orbits & Precession'],
              ['plunge', 'Horizon Plunge'],
              ['lensing', 'Photon Sphere & Lensing'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setScenario(id);
                scenarioRef.current = id;
                setRunning(true);
                setTelemetryTick((n) => n + 1);
              }}
              className={pillBtn(scenario === id)}
            >
              {label}
            </button>
          ))}
        </div>
      }
      canvas={
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="h-[490px] w-full touch-none select-none sm:h-[530px]"
        />
      }
      belowCanvas={
        scenario === 'orbit' ? (
          <LivePlot
            title="Radial Coordinate r(τ): General Relativity Geodesic vs. Newtonian 1/r² Twin"
            yUnit="r_s"
            version={telemetryTick}
            series={[
              { label: 'Schwarzschild GR r(τ)', color: '#818cf8', values: buffers.rGR.toArray() },
              ...(showNewtonTwin
                ? [
                    {
                      label: 'Newtonian r(t)',
                      color: '#38bdf8',
                      values: buffers.rNewton.toArray(),
                      dashed: true,
                    },
                  ]
                : []),
            ]}
          />
        ) : undefined
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          {scenario === 'orbit' && (
            <>
              <MetricCard
                label="Radius r"
                value={p.r.toFixed(2)}
                unit="r_s"
                color="#818cf8"
                sublabel={`${(p.r * massPreset.rsKm).toFixed(0)} km (r_s = ${massPreset.rsKm.toFixed(1)} km)`}
              />
              <MetricCard
                label="Proper Time τ"
                value={p.tau.toFixed(1)}
                unit="r_s/c"
                color="#34d399"
                sublabel={`Real: ${fmtPhysicalTime(p.tau)}`}
              />
              <MetricCard
                label="Perihelion Shift"
                value={
                  rt.lastPrecessionDeg !== null
                    ? `+${rt.lastPrecessionDeg.toFixed(1)}`
                    : `+${((weakFieldPrecessionRad(ell) * 180) / Math.PI).toFixed(1)}`
                }
                unit="°/orb"
                color="#f59e0b"
                sublabel={rt.lastPrecessionDeg !== null ? 'Measured exact GR' : 'Weak-field 3π/(2ℓ²)'}
              />
              <MetricCard
                label="Invariant |ΔH|"
                value={rt.maxHamErr.toExponential(1)}
                color="#38bdf8"
                sublabel={`Status: ${p.status}`}
              />
            </>
          )}

          {scenario === 'plunge' && (
            <>
              <MetricCard
                label="Astronaut Clock τ"
                value={pr.tau.toFixed(2)}
                unit="r_s/c"
                color="#34d399"
                sublabel={`Exact τ_sing = ${exactRadialFallProperTimeToSingularity(plungeR0).toFixed(2)} (${fmtPhysicalTime(pr.tau)})`}
              />
              <MetricCard
                label="Distant Clock t"
                value={Number.isFinite(pr.coordT) ? pr.coordT.toFixed(2) : '∞'}
                unit="r_s/c"
                color="#fb7185"
                sublabel={`Horizon τ_H = ${exactRadialFallProperTimeToHorizon(plungeR0).toFixed(2)}`}
              />
              <MetricCard
                label="Probe Radius r"
                value={pr.r.toFixed(3)}
                unit="r_s"
                color="#818cf8"
                sublabel={pr.r <= 1 ? 'Inside Event Horizon!' : 'Outside Horizon'}
              />
              <MetricCard
                label="Beacon f_∞ / f_emit"
                value={radialInfallRedshiftFactor(pr).toFixed(4)}
                color="#f59e0b"
                sublabel="Gravitational + Doppler"
              />
            </>
          )}

          {scenario === 'lensing' && (
            <>
              <MetricCard
                label="Shadow Radius b_crit"
                value={B_CRIT_RS.toFixed(3)}
                unit="r_s"
                color="#fb7185"
                sublabel={`${(B_CRIT_RS * massPreset.rsKm).toFixed(1)} km apparent radius`}
              />
              <MetricCard
                label="GR Deflection Δφ"
                value={
                  highlightRay.outcome === 'captured'
                    ? 'CAPTURED'
                    : `${((highlightRay.deflectionRad * 180) / Math.PI).toFixed(1)}°`
                }
                color="#fde047"
                sublabel={`Weak-field 2r_s/b = ${(((2 / Math.max(0.2, Math.abs(testImpactB))) * 180) / Math.PI).toFixed(1)}°`}
              />
              <MetricCard
                label="Closest Approach"
                value={highlightRay.minR.toFixed(2)}
                unit="r_s"
                color="#38bdf8"
                sublabel="Photon sphere = 1.50 r_s"
              />
              <MetricCard
                label="Lens Magnification μ"
                value={`${lensSol.totalMag.toFixed(2)}×`}
                color="#34d399"
                sublabel={`μ₊=${lensSol.magPlus.toFixed(2)} · μ₋=${lensSol.magMinus.toFixed(2)}`}
              />
            </>
          )}
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Astrophysical Mass Scale</span>
            <div className="grid grid-cols-1 gap-1.5">
              {BH_MASS_PRESETS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMassId(m.id)}
                  className={pillBtn(massId === m.id)}
                >
                  {m.label} (r_s = {m.rsKm >= 1e5 ? `${(m.rsKm / 1e6).toFixed(2)}M` : m.rsKm.toFixed(1)} km)
                </button>
              ))}
            </div>
          </div>

          {scenario === 'orbit' && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Geodesic Orbit Presets</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {ORBIT_PRESETS.map((prItem) => (
                    <button
                      key={prItem.id}
                      type="button"
                      onClick={() => {
                        setR0(prItem.r0);
                        setEll(prItem.ell);
                        setEnergy(prItem.energy);
                        resetOrbit(prItem.r0, prItem.ell, prItem.energy);
                        setRunning(true);
                      }}
                      className={pillBtn(false)}
                    >
                      {prItem.label}
                    </button>
                  ))}
                </div>
              </div>

              <ParameterSlider
                label="Angular Momentum ℓ / (r_s c)"
                value={ell}
                min={1.2}
                max={3.0}
                step={0.02}
                precision={2}
                hint="Below ℓ_ISCO = √3 ≈ 1.73, the potential barrier vanishes!"
                onChange={(v) => {
                  const eSafe = Math.max(energy, Math.sqrt(Math.max(0.01, effectivePotential(r0, v))));
                  setEll(v);
                  setEnergy(eSafe);
                  resetOrbit(r0, v, eSafe);
                }}
              />

              <ParameterSlider
                label="Specific Energy Ẽ = E / mc²"
                value={energy}
                min={Math.max(0.88, Math.floor(minEnergyAtR0 * 1000) / 1000)}
                max={1.04}
                step={0.002}
                precision={3}
                hint="Ẽ < 1 bound orbit · Ẽ = 1 parabolic · Ẽ > 1 hyperbolic scatter"
                onChange={(v) => {
                  setEnergy(v);
                  resetOrbit(r0, ell, v);
                }}
              />

              <ParameterSlider
                label="Launch Radius r₀"
                value={r0}
                min={2.5}
                max={16.0}
                step={0.5}
                unit=" r_s"
                precision={1}
                onChange={(v) => {
                  const eSafe = Math.max(energy, Math.sqrt(Math.max(0.01, effectivePotential(v, ell))));
                  setR0(v);
                  setEnergy(eSafe);
                  resetOrbit(v, ell, eSafe);
                }}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (r0 <= 1.55) return;
                    const c = circularOrbitConstants(r0);
                    setEll(c.ell);
                    setEnergy(c.energy);
                    resetOrbit(r0, c.ell, c.energy);
                  }}
                  className={pillBtn(false)}
                >
                  Set Exact Circular at r₀
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewtonTwin((v) => !v)}
                  className={pillBtn(showNewtonTwin)}
                >
                  Newtonian Twin: {showNewtonTwin ? 'ON' : 'OFF'}
                </button>
              </div>
            </>
          )}

          {scenario === 'plunge' && (
            <>
              <ParameterSlider
                label="Release Radius r₀ (from rest)"
                value={plungeR0}
                min={2.0}
                max={14.0}
                step={0.5}
                unit=" r_s"
                precision={1}
                hint="Watch the green astronaut clock cross r = 1 r_s while the coral distant-observer curve freezes!"
                onChange={(v) => {
                  setPlungeR0(v);
                  resetPlunge(v);
                  setRunning(true);
                }}
              />
            </>
          )}

          {scenario === 'lensing' && (
            <>
              <ParameterSlider
                label="Test Photon Impact Parameter b"
                value={testImpactB}
                min={-6.0}
                max={6.0}
                step={0.02}
                unit=" r_s"
                precision={2}
                hint="Try b = 2.60 r_s (just outside b_crit = 2.598 r_s) to loop around the photon sphere!"
                onChange={(v) => setTestImpactB(v)}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTestImpactB(2.602)}
                  className={pillBtn(false)}
                >
                  Skim Photon Sphere (2.60 r_s)
                </button>
                <button
                  type="button"
                  onClick={() => setSrcOffset({ x: 0, y: 0 })}
                  className={pillBtn(Math.hypot(srcOffset.x, srcOffset.y) < 0.05)}
                >
                  Center Star (Einstein Ring)
                </button>
              </div>
            </>
          )}
        </>
      }
    />
  );
}
