import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rocket } from 'lucide-react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { LivePlot } from '../../components/LivePlot';
import { RingBuffer } from '../../engine/ringBuffer';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  PROJECTILE_PRESETS,
  dragFactorK,
  findOptimalAngleWithDrag,
  initialProjectileState,
  simulateFullTrajectory,
  stepProjectile,
  terminalVelocity,
  type ProjectileParams,
  type ProjectileState,
} from './physics';

const DEFAULT_PARAMS: ProjectileParams = {
  v0: 42,
  angleDeg: 45,
  mass: 0.145,
  radius: 0.037,
  cd: 0.35,
  airDensity: 1.225,
  gravity: 9.81,
  windSpeed: 0,
  launchHeight: 1.5,
};

export function ProjectileDragLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<ProjectileParams>(DEFAULT_PARAMS);
  const [activePreset, setActivePreset] = useState('baseball');
  const [showVectors, setShowVectors] = useState(true);
  const [showSweep, setShowSweep] = useState(false);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);

  // Precompute reference envelopes & optimal launch angle whenever params change
  const analysis = useMemo(() => {
    const vacuum = simulateFullTrajectory(params, false);
    const drag = simulateFullTrajectory(params, true);
    const optimal = findOptimalAngleWithDrag(params);
    const vt = terminalVelocity(params);
    const sweepAngles = [20, 30, 38, 45, 60];
    const sweepCurves = sweepAngles.map((deg) => ({
      deg,
      traj: simulateFullTrajectory({ ...params, angleDeg: deg }, true),
    }));
    return { vacuum, drag, optimal, vt, sweepCurves };
  }, [params]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const showVectorsRef = useRef(showVectors);
  showVectorsRef.current = showVectors;
  const showSweepRef = useRef(showSweep);
  showSweepRef.current = showSweep;

  const dragStateRef = useRef<ProjectileState>(initialProjectileState(DEFAULT_PARAMS));
  const vacStateRef = useRef<ProjectileState>(initialProjectileState(DEFAULT_PARAMS));
  const dragTrailRef = useRef<{ x: number; y: number }[]>([]);
  const vacTrailRef = useRef<{ x: number; y: number }[]>([]);

  const speedBufRef = useRef<RingBuffer<number>>(new RingBuffer(200));
  const vxBufRef = useRef<RingBuffer<number>>(new RingBuffer(200));
  const vtBufRef = useRef<RingBuffer<number>>(new RingBuffer(200));

  const [telemetry, setTelemetry] = useState({
    t: 0,
    speedNow: DEFAULT_PARAMS.v0,
    xNow: 0,
    yNow: DEFAULT_PARAMS.launchHeight,
    plotVersion: 0,
  });

  const launch = useCallback((nextParams = paramsRef.current) => {
    const d0 = initialProjectileState(nextParams);
    const v0 = initialProjectileState(nextParams);
    dragStateRef.current = d0;
    vacStateRef.current = v0;
    dragTrailRef.current = [{ x: d0.x, y: d0.y }];
    vacTrailRef.current = [{ x: v0.x, y: v0.y }];
    speedBufRef.current.clear();
    vxBufRef.current.clear();
    vtBufRef.current.clear();

    const vt = Math.min(terminalVelocity(nextParams), nextParams.v0 * 2.2);
    speedBufRef.current.push(nextParams.v0);
    vxBufRef.current.push(d0.vx);
    if (Number.isFinite(vt)) vtBufRef.current.push(vt);

    setTelemetry((prev) => ({
      t: 0,
      speedNow: nextParams.v0,
      xNow: d0.x,
      yNow: d0.y,
      plotVersion: prev.plotVersion + 1,
    }));
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = paramsRef.current;
    const an = analysisRef.current;
    const dState = dragStateRef.current;
    const vState = vacStateRef.current;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, height);

    const padL = 48;
    const padR = 24;
    const padT = 26;
    const padB = 38;
    const plotW = Math.max(80, width - padL - padR);
    const plotH = Math.max(80, height - padT - padB);

    // Dynamic world bounds fitting both vacuum & drag trajectories with clean 1:1 aspect ratio
    const maxWorldX = Math.max(25, an.vacuum.range, an.drag.range, an.optimal.range) * 1.08;
    const maxWorldY = Math.max(12, an.vacuum.maxHeight, an.drag.maxHeight, p.launchHeight + 4) * 1.18;
    const scale = Math.min(plotW / maxWorldX, plotH / maxWorldY);

    const groundY = height - padB;
    const toSX = (x: number) => padL + x * scale;
    const toSY = (y: number) => groundY - y * scale;

    // Gridlines
    const rawStep = maxWorldX / 6;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawStep))));
    const gridStep = Math.ceil(rawStep / mag) * mag;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';

    for (let x = 0; x <= plotW / scale; x += gridStep) {
      const sx = toSX(x);
      ctx.beginPath();
      ctx.moveTo(sx, padT);
      ctx.lineTo(sx, groundY);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(`${x.toFixed(0)}m`, sx, groundY + 15);
    }

    for (let y = gridStep; y <= plotH / scale; y += gridStep) {
      const sy = toSY(y);
      ctx.beginPath();
      ctx.moveTo(padL, sy);
      ctx.lineTo(width - padR, sy);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(`${y.toFixed(0)}m`, padL - 6, sy + 3);
    }

    // Ground line
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padL - 8, groundY);
    ctx.lineTo(width - padR, groundY);
    ctx.stroke();

    // Wind indicator banner if wind != 0
    if (Math.abs(p.windSpeed) > 0.2) {
      ctx.fillStyle = p.windSpeed > 0 ? '#34d399' : '#fb7185';
      ctx.textAlign = 'right';
      const arrow = p.windSpeed > 0 ? '→ Tailwind' : '← Headwind';
      ctx.fillText(`${arrow}: ${Math.abs(p.windSpeed).toFixed(1)} m/s`, width - padR, 18);
    }

    // Optional optimal-angle sweep ghost curves
    if (showSweepRef.current) {
      for (const curve of an.sweepCurves) {
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.26)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        curve.traj.points.forEach((pt, idx) => {
          const sx = toSX(pt.x);
          const sy = toSY(pt.y);
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();

        const last = curve.traj.points[curve.traj.points.length - 1];
        if (last) {
          ctx.fillStyle = 'rgba(196, 181, 253, 0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(`${curve.deg}°`, toSX(last.x), groundY - 6);
        }
      }
    }

    // Full Vacuum preview curve (dashed sky)
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    an.vacuum.points.forEach((pt, idx) => {
      const sx = toSX(pt.x);
      const sy = toSY(pt.y);
      if (idx === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.restore();

    // Live Vacuum trail
    const vTrail = vacTrailRef.current;
    if (vTrail.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      vTrail.forEach((pt, idx) => {
        const sx = toSX(pt.x);
        const sy = toSY(pt.y);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }

    // Live Drag trail
    const dTrail = dragTrailRef.current;
    if (dTrail.length > 1) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      dTrail.forEach((pt, idx) => {
        const sx = toSX(pt.x);
        const sy = toSY(pt.y);
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }

    // Launch platform
    if (p.launchHeight > 0.1) {
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(toSX(0), groundY);
      ctx.lineTo(toSX(0), toSY(p.launchHeight));
      ctx.stroke();
    }

    // Vacuum ball
    const vx = toSX(vState.x);
    const vy = toSY(vState.y);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(vx, vy, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Drag ball with glow
    const dx = toSX(dState.x);
    const dy = toSY(dState.y);
    ctx.save();
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(dx, dy, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Optional Velocity & Drag Force vectors on active drag projectile
    if (showVectorsRef.current && !dState.landed) {
      const drawArrow = (ox: number, oy: number, ax: number, ay: number, color: string, label: string) => {
        const len = Math.hypot(ax, ay);
        if (len < 5) return;
        const ex = ox + ax;
        const ey = oy + ay;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const ang = Math.atan2(ay, ax);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 7 * Math.cos(ang - 0.45), ey - 7 * Math.sin(ang - 0.45));
        ctx.lineTo(ex - 7 * Math.cos(ang + 0.45), ey - 7 * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.font = 'bold 10px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(label, ex + 5, ey + 3);
      };

      const vScale = 1.1;
      drawArrow(dx, dy, dState.vx * vScale, -dState.vy * vScale, '#34d399', 'v');

      // Drag acceleration vector
      const kOverM = dragFactorK(p) / Math.max(1e-6, p.mass);
      const rvx = dState.vx - p.windSpeed;
      const rvy = dState.vy;
      const rSpd = Math.hypot(rvx, rvy);
      const adx = -kOverM * rSpd * rvx;
      const ady = -kOverM * rSpd * rvy;
      const fScale = 2.6;
      const dLen = Math.hypot(adx, ady) * fScale;
      const clampF = dLen > 65 ? 65 / dLen : 1;
      drawArrow(dx, dy, adx * fScale * clampF, -ady * fScale * clampF, '#fb7185', 'F_D');
    }

    // Top-left legend
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(`● WITH QUADRATIC DRAG (Range: ${an.drag.range.toFixed(1)} m)`, padL, 16);
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`--- VACUUM PARABOLA (Range: ${an.vacuum.range.toFixed(1)} m)`, padL + 285, 16);

    ctx.restore();
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let frame = 0;

    const loop = (now: number) => {
      const rawDt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        const dt = rawDt * speedRef.current;
        const p = paramsRef.current;
        const bothLanded = dragStateRef.current.landed && vacStateRef.current.landed;

        if (!bothLanded) {
          dragStateRef.current = stepProjectile(dragStateRef.current, p, dt, true);
          vacStateRef.current = stepProjectile(vacStateRef.current, p, dt, false);
          dragTrailRef.current.push({ x: dragStateRef.current.x, y: dragStateRef.current.y });
          vacTrailRef.current.push({ x: vacStateRef.current.x, y: vacStateRef.current.y });

          frame++;
          if (frame % 2 === 0 || dragStateRef.current.landed) {
            const ds = dragStateRef.current;
            const spd = Math.hypot(ds.vx, ds.vy);
            speedBufRef.current.push(spd);
            vxBufRef.current.push(ds.vx);
            const vt = terminalVelocity(p);
            if (Number.isFinite(vt) && vt < p.v0 * 2.5) {
              vtBufRef.current.push(vt);
            }
            setTelemetry((prev) => ({
              t: ds.t,
              speedNow: spd,
              xNow: ds.x,
              yNow: ds.y,
              plotVersion: prev.plotVersion + 1,
            }));
          }
        }
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawFrame]);

  const updateParams = (patch: Partial<ProjectileParams>) => {
    const next = { ...params, ...patch };
    setParams(next);
    paramsRef.current = next;
    launch(next);
  };

  const handleStep = () => {
    setRunning(false);
    const p = paramsRef.current;
    dragStateRef.current = stepProjectile(dragStateRef.current, p, 0.03 * speed, true);
    vacStateRef.current = stepProjectile(vacStateRef.current, p, 0.03 * speed, false);
    dragTrailRef.current.push({ x: dragStateRef.current.x, y: dragStateRef.current.y });
    vacTrailRef.current.push({ x: vacStateRef.current.x, y: vacStateRef.current.y });
    const ds = dragStateRef.current;
    const spd = Math.hypot(ds.vx, ds.vy);
    speedBufRef.current.push(spd);
    vxBufRef.current.push(ds.vx);
    setTelemetry((prev) => ({
      t: ds.t,
      speedNow: spd,
      xNow: ds.x,
      yNow: ds.y,
      plotVersion: prev.plotVersion + 1,
    }));
    drawFrame();
  };

  const rangeLossPct =
    analysis.vacuum.range > 0
      ? ((analysis.vacuum.range - analysis.drag.range) / analysis.vacuum.range) * 100
      : 0;

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => {
        if (dragStateRef.current.landed && vacStateRef.current.landed) {
          launch();
          setRunning(true);
        } else {
          setRunning((r) => !r);
        }
      }}
      onStep={handleStep}
      onReset={() => {
        launch();
        setRunning(true);
      }}
      onSpeedChange={setSpeed}
      extraToolbar={
        <button
          type="button"
          onClick={() => {
            launch();
            setRunning(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25"
        >
          <Rocket className="h-3.5 w-3.5" /> Re-Launch
        </button>
      }
      canvas={
        <div className="relative h-[400px] w-full sm:h-[440px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <LivePlot
          title="Speed Decay & Terminal Velocity Asymptote"
          yUnit="m/s"
          minY={0}
          height={148}
          version={telemetry.plotVersion}
          series={[
            { label: 'Speed |v(t)|', color: '#f59e0b', values: speedBufRef.current.toArray() },
            { label: 'Horizontal v_x(t)', color: '#38bdf8', values: vxBufRef.current.toArray() },
            ...(vtBufRef.current.length > 1
              ? [
                  {
                    label: `Terminal v_t (${analysis.vt.toFixed(1)} m/s)`,
                    color: '#fb7185',
                    values: vtBufRef.current.toArray(),
                    dashed: true,
                  },
                ]
              : []),
          ]}
        />
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard
            label="Drag Range"
            value={analysis.drag.range.toFixed(1)}
            unit="m"
            color="#f59e0b"
            sublabel={`−${rangeLossPct.toFixed(0)}% vs. vacuum`}
          />
          <MetricCard
            label="Optimal Angle"
            value={analysis.optimal.angle.toFixed(1)}
            unit="°"
            color="#a78bfa"
            sublabel="Vacuum optimal = 45.0°"
          />
          <MetricCard
            label="Terminal Speed (v_t)"
            value={Number.isFinite(analysis.vt) ? analysis.vt.toFixed(1) : '∞'}
            unit="m/s"
            color="#fb7185"
            sublabel={`Live |v| = ${telemetry.speedNow.toFixed(1)} m/s`}
          />
          <MetricCard
            label="Flight Time / Peak"
            value={analysis.drag.flightTime.toFixed(2)}
            unit="s"
            color="#38bdf8"
            sublabel={`H_max = ${analysis.drag.maxHeight.toFixed(1)} m`}
          />
        </div>
      }
      controls={
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Projectile Preset</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PROJECTILE_PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => {
                    setActivePreset(pr.id);
                    updateParams({ mass: pr.mass, radius: pr.radius, cd: pr.cd });
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activePreset === pr.id
                      ? 'border-amber-500/45 bg-amber-500/15 text-amber-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowVectors((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                showVectors
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              Vectors (v, F_D): {showVectors ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setShowSweep((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                showSweep
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              Angle Sweep: {showSweep ? 'ON' : 'OFF'}
            </button>
          </div>

          <ParameterSlider
            label="Launch Speed (v₀)"
            value={params.v0}
            min={10}
            max={90}
            step={1}
            precision={0}
            unit="m/s"
            onChange={(v0) => updateParams({ v0 })}
          />
          <ParameterSlider
            label="Launch Angle (θ)"
            value={params.angleDeg}
            min={5}
            max={85}
            step={1}
            precision={0}
            unit="°"
            onChange={(angleDeg) => updateParams({ angleDeg })}
          />
          <ParameterSlider
            label="Wind Speed (Headwind ↔ Tailwind)"
            value={params.windSpeed}
            min={-25}
            max={25}
            step={1}
            precision={0}
            unit="m/s"
            onChange={(windSpeed) => updateParams({ windSpeed })}
          />
          <ParameterSlider
            label="Air Density (ρ)"
            value={params.airDensity}
            min={0}
            max={2.5}
            step={0.025}
            precision={3}
            unit="kg/m³"
            hint="Vacuum: 0.000 · Sea Level: 1.225 · High Pressure: 2.5"
            onChange={(airDensity) => updateParams({ airDensity })}
          />
          <ParameterSlider
            label="Drag Coefficient (C_D)"
            value={params.cd}
            min={0.05}
            max={1.2}
            step={0.01}
            precision={2}
            onChange={(cd) => {
              setActivePreset('custom');
              updateParams({ cd });
            }}
          />
          <ParameterSlider
            label="Gravity (g)"
            value={params.gravity}
            min={1.62}
            max={24.79}
            step={0.01}
            precision={2}
            unit="m/s²"
            onChange={(gravity) => updateParams({ gravity })}
          />
        </>
      }
    />
  );
}
