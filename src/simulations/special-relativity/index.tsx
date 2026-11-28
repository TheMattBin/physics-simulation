import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LabShell } from '../../components/LabShell';
import { LivePlot } from '../../components/LivePlot';
import { MetricCard } from '../../components/MetricCard';
import { ParameterSlider } from '../../components/ParameterSlider';
import { clamp, syncCanvasSize } from '../../engine/math';
import { RingBuffer } from '../../engine/ringBuffer';
import type { SimulationEntry } from '../../engine/types';
import {
  drawBarnPoleCanvas,
  drawMuonsCanvas,
  drawSandboxCanvas,
  drawTwinsCanvas,
  sandboxGeometry,
  type MuonParticle,
  type SandboxState,
} from './draw';
import {
  MUON_LIFETIME_US,
  ONE_G_LY_PER_YR2,
  buildTwinProfile,
  classifyInterval,
  computeMuonTheory,
  computeTwinLightSignals,
  einsteinRelativeVelocity,
  gammaFromBeta,
  invariantIntervalSq,
  lorentzBoost,
  sampleTwinTrajectory,
  solveBarnPole,
  type BarnPoleConfig,
  type MuonConfig,
  type ReferenceFrame,
  type SRScenario,
  type TurnaroundMode,
  type TwinConfig,
} from './physics';

const PLOT_CAP = 260;

function seededUniform(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return Math.max(1e-6, Math.min(0.999999, x - Math.floor(x)));
}

export function SpecialRelativityLab({ meta }: { meta: SimulationEntry }) {
  const [scenario, setScenario] = useState<SRScenario>('twins');
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  // 1. Twin Paradox state
  const [twinCfg, setTwinCfg] = useState<TwinConfig>({
    distanceLy: 4.0,
    betaMax: 0.8,
    mode: 'instant',
    properAccelLyYr2: 1.5 * ONE_G_LY_PER_YR2,
    pulsePeriodYr: 1.0,
  });
  const [showPulses, setShowPulses] = useState(true);
  const [showSimultaneity, setShowSimultaneity] = useState(true);
  const [showLightCones, setShowLightCones] = useState(false);

  // 2. Barn-Pole state
  const [barnCfg, setBarnCfg] = useState<BarnPoleConfig>({
    barnRestLengthM: 10,
    poleRestLengthM: 12.5,
    beta: 0.8,
    activeFrame: 'primary',
  });

  // 3. Muon state
  const [muonCfg, setMuonCfg] = useState<MuonConfig>({
    altitudeKm: 15,
    beta: 0.995,
    activeFrame: 'primary',
  });

  // 4. Sandbox state
  const [sandbox, setSandbox] = useState<SandboxState>({
    e1: { x: -2, ct: -1.5 },
    e2: { x: 4.5, ct: 1.0 },
    observerBeta: 0.55,
    probeU1: -0.75,
    probeU2: 0.85,
    showHyperbola: true,
    showProbes: false,
  });

  const [telemetryTick, setTelemetryTick] = useState(0);

  // Live refs for RAF loop
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const twinCfgRef = useRef(twinCfg);
  twinCfgRef.current = twinCfg;
  const twinFlagsRef = useRef({ showPulses, showSimultaneity, showLightCones });
  twinFlagsRef.current = { showPulses, showSimultaneity, showLightCones };

  const barnCfgRef = useRef(barnCfg);
  barnCfgRef.current = barnCfg;
  const muonCfgRef = useRef(muonCfg);
  muonCfgRef.current = muonCfg;
  const sandboxRef = useRef(sandbox);
  sandboxRef.current = sandbox;

  const dragTargetRef = useRef<'e1' | 'e2' | null>(null);

  // Runtime mutable state
  const simClockRef = useRef({
    twinTimeYr: 0,
    barnCtM: -14,
    muonSimUs: 0,
    muonSpawnCursorUs: 0,
    muonSeed: 1,
    muons: [] as MuonParticle[],
    muonEmitted: 0,
    muonSeaHits: 0,
    muonDecayed: 0,
    countedIds: new Set<number>(),
    sandboxTime: 0,
  });

  const [buffers] = useState(() => ({
    ageA: new RingBuffer<number>(PLOT_CAP),
    ageB: new RingBuffer<number>(PLOT_CAP),
    earthSimNow: new RingBuffer<number>(PLOT_CAP),
  }));

  const resetCurrent = useCallback(() => {
    const rt = simClockRef.current;
    rt.twinTimeYr = 0;
    rt.barnCtM = -14;
    rt.muonSimUs = 0;
    rt.muonSpawnCursorUs = 0;
    rt.muons = [];
    rt.muonEmitted = 0;
    rt.muonSeaHits = 0;
    rt.muonDecayed = 0;
    rt.countedIds.clear();
    rt.sandboxTime = 0;
    buffers.ageA.clear();
    buffers.ageB.clear();
    buffers.earthSimNow.clear();
    setTelemetryTick((n) => n + 1);
  }, [buffers]);

  const advanceSim = useCallback(
    (dtReal: number) => {
      const rt = simClockRef.current;
      const sc = scenarioRef.current;

      if (sc === 'twins') {
        const prof = buildTwinProfile(twinCfgRef.current);
        // Traverse entire round-trip in ~9 seconds at 1x
        const rate = prof.totalCoordTime / 9.0;
        if (rt.twinTimeYr < prof.totalCoordTime) {
          rt.twinTimeYr = Math.min(prof.totalCoordTime, rt.twinTimeYr + dtReal * rate);
          const st = sampleTwinTrajectory(prof, rt.twinTimeYr);
          buffers.ageA.push(st.t);
          buffers.ageB.push(st.tauB);
          buffers.earthSimNow.push(st.earthSimultaneousTime);
        }
      } else if (sc === 'barn-pole') {
        rt.barnCtM += dtReal * 5.2;
        if (rt.barnCtM > 14) rt.barnCtM = -14;
      } else if (sc === 'muon') {
        const cfg = muonCfgRef.current;
        const th = computeMuonTheory(cfg);
        const dtUs = dtReal * 18;
        rt.muonSimUs += dtUs;

        // Spawn ~14 muons per real second
        while (rt.muonSpawnCursorUs <= rt.muonSimUs) {
          const u1 = seededUniform(rt.muonSeed++);
          const u2 = seededUniform(rt.muonSeed++);
          rt.muons.push({
            id: rt.muonSeed,
            xFrac: 0.08 + u1 * 0.84,
            properLifetimeUs: -MUON_LIFETIME_US * Math.log(u2),
            spawnedAtSimUs: rt.muonSpawnCursorUs,
          });
          rt.muonEmitted++;
          rt.muonSpawnCursorUs += 1.25;
        }

        // Update tallies & prune old muons
        for (const m of rt.muons) {
          if (rt.countedIds.has(m.id)) continue;
          const ageUs = rt.muonSimUs - m.spawnedAtSimUs;
          const zDecay = cfg.altitudeKm - m.properLifetimeUs * th.gamma * th.speedKmPerUs;
          const finishUs = zDecay <= 0 ? th.earthTransitUs : (cfg.altitudeKm - zDecay) / th.speedKmPerUs;
          if (ageUs >= finishUs) {
            rt.countedIds.add(m.id);
            if (zDecay <= 0) rt.muonSeaHits++;
            else rt.muonDecayed++;
          }
        }
        if (rt.muons.length > 220) {
          rt.muons = rt.muons.slice(-160);
        }
      } else {
        rt.sandboxTime += dtReal * 2.4;
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
    const rt = simClockRef.current;
    const sc = scenarioRef.current;

    if (sc === 'twins') {
      const prof = buildTwinProfile(twinCfgRef.current);
      const signals = computeTwinLightSignals(prof);
      drawTwinsCanvas(ctx, width, height, prof, rt.twinTimeYr, signals, twinFlagsRef.current);
    } else if (sc === 'barn-pole') {
      drawBarnPoleCanvas(ctx, width, height, barnCfgRef.current, rt.barnCtM);
    } else if (sc === 'muon') {
      drawMuonsCanvas(ctx, width, height, muonCfgRef.current, rt.muonSimUs, rt.muons, {
        emitted: rt.muonEmitted,
        seaLevelHits: rt.muonSeaHits,
        decayedInAir: rt.muonDecayed,
      });
    } else {
      drawSandboxCanvas(ctx, width, height, sandboxRef.current, rt.sandboxTime);
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (runningRef.current) {
        advanceSim(dt * speedRef.current);
        frame++;
        if (frame % 4 === 0) setTelemetryTick((n) => n + 1);
      }
      drawNow();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advanceSim, drawNow]);

  // Pointer dragging for Minkowski Sandbox events E1 / E2
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scenarioRef.current !== 'sandbox') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const g = sandboxGeometry(rect.width, rect.height);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const sb = sandboxRef.current;
    const d1 = Math.hypot(px - g.toPx(sb.e1.x), py - g.toPy(sb.e1.ct));
    const d2 = Math.hypot(px - g.toPx(sb.e2.x), py - g.toPy(sb.e2.ct));
    if (d2 <= 18 && d2 <= d1) {
      dragTargetRef.current = 'e2';
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (d1 <= 18) {
      dragTargetRef.current = 'e1';
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scenarioRef.current !== 'sandbox') {
      e.currentTarget.style.cursor = 'default';
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const g = sandboxGeometry(rect.width, rect.height);
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (dragTargetRef.current) {
      const x = clamp(Math.round(g.fromPx(px) * 10) / 10, -9.2, 9.2);
      const ct = clamp(Math.round(g.fromPy(py) * 10) / 10, -9.2, 9.2);
      const key = dragTargetRef.current;
      setSandbox((prev) => ({ ...prev, [key]: { x, ct } }));
      setTelemetryTick((n) => n + 1);
      return;
    }

    const sb = sandboxRef.current;
    const near =
      Math.hypot(px - g.toPx(sb.e1.x), py - g.toPy(sb.e1.ct)) <= 18 ||
      Math.hypot(px - g.toPx(sb.e2.x), py - g.toPy(sb.e2.ct)) <= 18;
    e.currentTarget.style.cursor = near ? 'grab' : 'default';
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragTargetRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Telemetry computations
  const rt = simClockRef.current;
  const twinProf = buildTwinProfile(twinCfg);
  const twinState = sampleTwinTrajectory(twinProf, rt.twinTimeYr);
  const barnSol = solveBarnPole(barnCfg);
  const muonTh = computeMuonTheory(muonCfg);
  const ds2 = invariantIntervalSq(sandbox.e1, sandbox.e2);
  const dsKind = classifyInterval(ds2, 0.08);
  const e1Prime = lorentzBoost(sandbox.e1, sandbox.observerBeta);
  const e2Prime = lorentzBoost(sandbox.e2, sandbox.observerBeta);

  const pillBtn = (active: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-indigo-500/45 bg-indigo-500/15 text-indigo-200'
        : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
    }`;

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={() => {
        setRunning(false);
        advanceSim(0.12);
        setTelemetryTick((n) => n + 1);
      }}
      onReset={() => {
        resetCurrent();
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      extraToolbar={
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['twins', 'Twin Paradox'],
              ['barn-pole', 'Barn & Pole'],
              ['muon', 'Cosmic Muons'],
              ['sandbox', 'Minkowski Sandbox'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setScenario(id);
                scenarioRef.current = id;
                resetCurrent();
                setRunning(true);
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
          className="h-[500px] w-full touch-none select-none sm:h-[540px]"
        />
      }
      belowCanvas={
        scenario === 'twins' ? (
          <LivePlot
            title="Proper Clock Aging: Earth Twin A vs. Traveler Twin B & B's Simultaneous Earth Time"
            yUnit="yr"
            version={telemetryTick}
            series={[
              { label: 'Earth Twin A (τ_A)', color: '#38bdf8', values: buffers.ageA.toArray() },
              { label: 'Traveler Twin B (τ_B)', color: '#818cf8', values: buffers.ageB.toArray() },
              {
                label: "B's Simultaneous Earth Time",
                color: '#a78bfa',
                values: buffers.earthSimNow.toArray(),
                dashed: true,
              },
            ]}
          />
        ) : undefined
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          {scenario === 'twins' && (
            <>
              <MetricCard
                label="Earth Twin A"
                value={twinState.t.toFixed(2)}
                unit="yr"
                color="#38bdf8"
                sublabel={`Trip total: ${twinProf.totalCoordTime.toFixed(2)} yr`}
              />
              <MetricCard
                label="Traveler Twin B"
                value={twinState.tauB.toFixed(2)}
                unit="yr"
                color="#818cf8"
                sublabel={`Trip total: ${twinProf.totalTwinProperTime.toFixed(2)} yr`}
              />
              <MetricCard
                label="Lorentz Factor γ"
                value={twinProf.gammaPeak.toFixed(3)}
                color="#34d399"
                sublabel={`Peak speed ${twinProf.betaPeak.toFixed(3)}c`}
              />
              <MetricCard
                label="Age Difference"
                value={(twinProf.totalCoordTime - twinProf.totalTwinProperTime).toFixed(2)}
                unit="yr"
                color="#f59e0b"
                sublabel={`Simultaneity sweep: ${twinProf.simultaneityGapYr.toFixed(2)} yr`}
              />
            </>
          )}

          {scenario === 'barn-pole' && (
            <>
              <MetricCard
                label="Lorentz Factor γ"
                value={barnSol.gamma.toFixed(3)}
                color="#818cf8"
                sublabel={`Fit threshold: ${barnSol.betaFitThreshold.toFixed(3)}c`}
              />
              <MetricCard
                label="Pole in Barn S"
                value={barnSol.poleLenInS.toFixed(2)}
                unit="m"
                color="#34d399"
                sublabel={`Barn rest L = ${barnSol.barnLenInS.toFixed(1)} m`}
              />
              <MetricCard
                label="Barn in Pole S'"
                value={barnSol.barnLenInSPrime.toFixed(2)}
                unit="m"
                color="#38bdf8"
                sublabel={`Pole rest L' = ${barnSol.poleLenInSPrime.toFixed(1)} m`}
              />
              <MetricCard
                label="Door Gap in S'"
                value={barnSol.doorTimeGapSPrimeM.toFixed(2)}
                unit="m/c"
                color="#f59e0b"
                sublabel="Exit flashes before Rear!"
              />
            </>
          )}

          {scenario === 'muon' && (
            <>
              <MetricCard
                label="Lorentz Factor γ"
                value={muonTh.gamma.toFixed(2)}
                color="#818cf8"
                sublabel={`Dilated γτ₀ = ${(muonTh.gamma * MUON_LIFETIME_US).toFixed(1)} µs`}
              />
              <MetricCard
                label="SR Sea-Level Survival"
                value={(muonTh.survivalSR * 100).toFixed(2)}
                unit="%"
                color="#34d399"
                sublabel={`Decay length ${muonTh.meanDecayLengthSRKm.toFixed(2)} km`}
              />
              <MetricCard
                label="Newtonian Prediction"
                value={(muonTh.survivalNewton * 100).toExponential(2)}
                unit="%"
                color="#fb7185"
                sublabel="Without time dilation"
              />
              <MetricCard
                label="Contracted Height H'"
                value={muonTh.contractedAtmosphereKm.toFixed(2)}
                unit="km"
                color="#38bdf8"
                sublabel={`Proper flight ${muonTh.muonProperTransitUs.toFixed(2)} µs`}
              />
            </>
          )}

          {scenario === 'sandbox' && (
            <>
              <MetricCard
                label="Invariant Δs²"
                value={ds2.toFixed(2)}
                unit="ls²"
                color={dsKind === 'timelike' ? '#34d399' : dsKind === 'lightlike' ? '#f59e0b' : '#fb7185'}
                sublabel={`Causal class: ${dsKind}`}
              />
              <MetricCard
                label={ds2 >= 0 ? 'Proper Time Δτ' : 'Proper Distance Δσ'}
                value={Math.sqrt(Math.abs(ds2)).toFixed(2)}
                unit="ls"
                color="#818cf8"
                sublabel="Identical in ALL frames"
              />
              <MetricCard
                label="Δct in S vs S'"
                value={`${(sandbox.e2.ct - sandbox.e1.ct).toFixed(1)} / ${(e2Prime.ct - e1Prime.ct).toFixed(1)}`}
                unit="s"
                color="#a78bfa"
                sublabel={`Observer γ = ${gammaFromBeta(sandbox.observerBeta).toFixed(2)}`}
              />
              <MetricCard
                label="Einstein Relative u'"
                value={einsteinRelativeVelocity(sandbox.probeU2, sandbox.probeU1).toFixed(4)}
                unit="c"
                color="#f59e0b"
                sublabel={`Galilean: ${(sandbox.probeU2 - sandbox.probeU1).toFixed(2)}c`}
              />
            </>
          )}
        </div>
      }
      controls={
        <>
          {scenario === 'twins' && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Turnaround Kinematics</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['instant', 'Instantaneous'],
                      ['smooth', 'Hyperbolic (Rindler)'],
                    ] as [TurnaroundMode, string][]
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setTwinCfg((c) => ({ ...c, mode: m }));
                        resetCurrent();
                      }}
                      className={pillBtn(twinCfg.mode === m)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ParameterSlider
                label="Cruise Speed β = v/c"
                value={twinCfg.betaMax}
                min={0.2}
                max={0.96}
                step={0.02}
                unit="c"
                precision={2}
                onChange={(v) => {
                  setTwinCfg((c) => ({ ...c, betaMax: v }));
                  resetCurrent();
                }}
              />
              <ParameterSlider
                label="Star Distance L"
                value={twinCfg.distanceLy}
                min={1.0}
                max={8.0}
                step={0.5}
                unit=" ly"
                precision={1}
                onChange={(v) => {
                  setTwinCfg((c) => ({ ...c, distanceLy: v }));
                  resetCurrent();
                }}
              />
              {twinCfg.mode === 'smooth' && (
                <ParameterSlider
                  label="Proper Acceleration a₀"
                  value={twinCfg.properAccelLyYr2 / ONE_G_LY_PER_YR2}
                  min={0.5}
                  max={4.0}
                  step={0.25}
                  unit=" g"
                  precision={2}
                  hint="Smoothly sweeps B's simultaneity line across Earth's worldline during turnaround."
                  onChange={(gVal) => {
                    setTwinCfg((c) => ({ ...c, properAccelLyYr2: gVal * ONE_G_LY_PER_YR2 }));
                    resetCurrent();
                  }}
                />
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowPulses((v) => !v)}
                  className={pillBtn(showPulses)}
                >
                  Doppler Pulses: {showPulses ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSimultaneity((v) => !v)}
                  className={pillBtn(showSimultaneity)}
                >
                  Simultaneity Slice: {showSimultaneity ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLightCones((v) => !v)}
                  className={pillBtn(showLightCones)}
                >
                  Light Cones: {showLightCones ? 'ON' : 'OFF'}
                </button>
              </div>
            </>
          )}

          {scenario === 'barn-pole' && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Observer Reference Frame</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['primary', 'Barn Rest Frame S'],
                      ['boosted', "Pole Rest Frame S'"],
                    ] as [ReferenceFrame, string][]
                  ).map(([f, label]) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setBarnCfg((c) => ({ ...c, activeFrame: f }))}
                      className={pillBtn(barnCfg.activeFrame === f)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ParameterSlider
                label="Pole Speed β = v/c"
                value={barnCfg.beta}
                min={0.15}
                max={0.95}
                step={0.01}
                unit="c"
                precision={2}
                onChange={(v) => setBarnCfg((c) => ({ ...c, beta: v }))}
              />
              <ParameterSlider
                label="Pole Rest Length L_pole,0"
                value={barnCfg.poleRestLengthM}
                min={6.0}
                max={18.0}
                step={0.5}
                unit=" m"
                precision={1}
                onChange={(v) => setBarnCfg((c) => ({ ...c, poleRestLengthM: v }))}
              />
              <ParameterSlider
                label="Barn Rest Length L_barn"
                value={barnCfg.barnRestLengthM}
                min={6.0}
                max={14.0}
                step={0.5}
                unit=" m"
                precision={1}
                onChange={(v) => setBarnCfg((c) => ({ ...c, barnRestLengthM: v }))}
              />
              <ParameterSlider
                label={barnCfg.activeFrame === 'primary' ? 'Scrub Time ct' : "Scrub Time ct'"}
                value={rt.barnCtM}
                min={-14}
                max={14}
                step={0.1}
                unit=" m"
                precision={1}
                hint="Pause and scrub through ct = 0 (or E_exit / E_rear in S') to inspect door flashes."
                onChange={(v) => {
                  setRunning(false);
                  simClockRef.current.barnCtM = v;
                  setTelemetryTick((n) => n + 1);
                }}
              />
            </>
          )}

          {scenario === 'muon' && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Observer Reference Frame</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['primary', 'Earth Frame S'],
                      ['boosted', "Muon Rest Frame S'"],
                    ] as [ReferenceFrame, string][]
                  ).map(([f, label]) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setMuonCfg((c) => ({ ...c, activeFrame: f }))}
                      className={pillBtn(muonCfg.activeFrame === f)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ParameterSlider
                label="Muon Speed β = v/c"
                value={muonCfg.beta}
                min={0.9}
                max={0.999}
                step={0.001}
                unit="c"
                precision={3}
                onChange={(v) => {
                  setMuonCfg((c) => ({ ...c, beta: v }));
                  resetCurrent();
                }}
              />
              <ParameterSlider
                label="Creation Altitude H"
                value={muonCfg.altitudeKm}
                min={4}
                max={25}
                step={0.5}
                unit=" km"
                precision={1}
                hint="Cosmic-ray pions typically produce muons near 12–15 km altitude."
                onChange={(v) => {
                  setMuonCfg((c) => ({ ...c, altitudeKm: v }));
                  resetCurrent();
                }}
              />
            </>
          )}

          {scenario === 'sandbox' && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Event Pair Presets</span>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSandbox((s) => ({ ...s, e1: { x: -1, ct: -3 }, e2: { x: 2, ct: 4 } }))
                    }
                    className={pillBtn(false)}
                  >
                    Timelike
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSandbox((s) => ({ ...s, e1: { x: -2, ct: -1.5 }, e2: { x: 4.5, ct: 1.0 } }))
                    }
                    className={pillBtn(false)}
                  >
                    Spacelike
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSandbox((s) => ({ ...s, e1: { x: -3, ct: -3 }, e2: { x: 4, ct: 4 } }))
                    }
                    className={pillBtn(false)}
                  >
                    Lightlike
                  </button>
                </div>
              </div>

              <ParameterSlider
                label="Observer Frame Boost β_obs"
                value={sandbox.observerBeta}
                min={-0.9}
                max={0.9}
                step={0.02}
                unit="c"
                precision={2}
                hint="Tilts the S' axes symmetrically toward the 45° light cone while preserving Δs²."
                onChange={(v) => setSandbox((s) => ({ ...s, observerBeta: v }))}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSandbox((s) => ({ ...s, showHyperbola: !s.showHyperbola }))}
                  className={pillBtn(sandbox.showHyperbola)}
                >
                  Invariant Hyperbola: {sandbox.showHyperbola ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setSandbox((s) => ({ ...s, showProbes: !s.showProbes }))}
                  className={pillBtn(sandbox.showProbes)}
                >
                  Velocity Probes: {sandbox.showProbes ? 'ON' : 'OFF'}
                </button>
              </div>

              {sandbox.showProbes && (
                <>
                  <ParameterSlider
                    label="Probe 1 Velocity u₁"
                    value={sandbox.probeU1}
                    min={-0.95}
                    max={0.95}
                    step={0.05}
                    unit="c"
                    precision={2}
                    onChange={(v) => setSandbox((s) => ({ ...s, probeU1: v }))}
                  />
                  <ParameterSlider
                    label="Probe 2 Velocity u₂"
                    value={sandbox.probeU2}
                    min={-0.95}
                    max={0.95}
                    step={0.05}
                    unit="c"
                    precision={2}
                    onChange={(v) => setSandbox((s) => ({ ...s, probeU2: v }))}
                  />
                </>
              )}
            </>
          )}
        </>
      }
    />
  );
}
