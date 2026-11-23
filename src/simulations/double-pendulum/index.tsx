import { useCallback, useEffect, useRef, useState } from 'react';
import { LabShell } from '../../components/LabShell';
import { ParameterSlider } from '../../components/ParameterSlider';
import { MetricCard } from '../../components/MetricCard';
import { LivePlot } from '../../components/LivePlot';
import { RingBuffer } from '../../engine/ringBuffer';
import { syncCanvasSize } from '../../engine/math';
import type { SimulationEntry } from '../../engine/types';
import {
  computeKinematics,
  stepDoublePendulum,
  type DoublePendulumParams,
  type DoublePendulumState,
} from './physics';

interface TrailPoint {
  x: number;
  y: number;
}

const DEFAULT_PARAMS: DoublePendulumParams = {
  m1: 1.5,
  m2: 1.0,
  l1: 1.2,
  l2: 1.1,
  g: 9.81,
  damping: 0.0,
};

export function DoublePendulumLab({ meta }: { meta: SimulationEntry }) {
  const [params, setParams] = useState<DoublePendulumParams>(DEFAULT_PARAMS);
  const [initDeg1, setInitDeg1] = useState(125);
  const [initDeg2, setInitDeg2] = useState(150);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showTwin, setShowTwin] = useState(true);
  const [showVectors, setShowVectors] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const runningRef = useRef(running);
  runningRef.current = running;
  const showTwinRef = useRef(showTwin);
  showTwinRef.current = showTwin;
  const showVectorsRef = useRef(showVectors);
  showVectorsRef.current = showVectors;

  const primaryRef = useRef<DoublePendulumState>({
    theta1: (125 * Math.PI) / 180,
    omega1: 0,
    theta2: (150 * Math.PI) / 180,
    omega2: 0,
  });
  const twinRef = useRef<DoublePendulumState>({
    theta1: (125 * Math.PI) / 180 + 0.001,
    omega1: 0,
    theta2: (150 * Math.PI) / 180,
    omega2: 0,
  });

  const primaryTrailRef = useRef<RingBuffer<TrailPoint>>(new RingBuffer(260));
  const twinTrailRef = useRef<RingBuffer<TrailPoint>>(new RingBuffer(260));
  const keBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));
  const peBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));
  const totalBufRef = useRef<RingBuffer<number>>(new RingBuffer(220));

  const [telemetry, setTelemetry] = useState({
    ke: 0,
    pe: 0,
    total: 0,
    divergence: 0.001,
    plotVersion: 0,
  });

  const resetSim = useCallback(
    (deg1 = initDeg1, deg2 = initDeg2) => {
      const t1 = (deg1 * Math.PI) / 180;
      const t2 = (deg2 * Math.PI) / 180;
      primaryRef.current = { theta1: t1, omega1: 0, theta2: t2, omega2: 0 };
      twinRef.current = { theta1: t1 + 0.001, omega1: 0, theta2: t2, omega2: 0 };
      primaryTrailRef.current.clear();
      twinTrailRef.current.clear();
      keBufRef.current.clear();
      peBufRef.current.clear();
      totalBufRef.current.clear();

      const k = computeKinematics(primaryRef.current, paramsRef.current);
      keBufRef.current.push(k.kinetic);
      peBufRef.current.push(k.potential);
      totalBufRef.current.push(k.total);
      setTelemetry((prev) => ({
        ke: k.kinetic,
        pe: k.potential,
        total: k.total,
        divergence: 0.001,
        plotVersion: prev.plotVersion + 1,
      }));
    },
    [initDeg1, initDeg2],
  );

  const advancePhysics = useCallback((dt: number) => {
    const p = paramsRef.current;
    primaryRef.current = stepDoublePendulum(primaryRef.current, p, dt, 6);
    if (showTwinRef.current) {
      twinRef.current = stepDoublePendulum(twinRef.current, p, dt, 6);
    }

    const k1 = computeKinematics(primaryRef.current, p);
    primaryTrailRef.current.push({ x: k1.x2, y: k1.y2 });

    let div = 0;
    if (showTwinRef.current) {
      const k2 = computeKinematics(twinRef.current, p);
      twinTrailRef.current.push({ x: k2.x2, y: k2.y2 });
      div = Math.hypot(k2.x2 - k1.x2, k2.y2 - k1.y2);
    }

    keBufRef.current.push(k1.kinetic);
    peBufRef.current.push(k1.potential);
    totalBufRef.current.push(k1.total);

    return { k1, div };
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = paramsRef.current;
    const totalLen = p.l1 + p.l2;
    const scale = (Math.min(width, height) * 0.4) / Math.max(1.2, totalLen);
    const originX = width * 0.5;
    const originY = height * 0.46;

    const toScreen = (x: number, y: number) => ({
      sx: originX + x * scale,
      sy: originY + y * scale,
    });

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background & subtle polar reference rings
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    for (let r = 0.5; r <= totalLen + 0.25; r += 0.5) {
      ctx.beginPath();
      ctx.arc(originX, originY, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(originX, 16);
    ctx.lineTo(originX, height - 16);
    ctx.moveTo(16, originY);
    ctx.lineTo(width - 16, originY);
    ctx.stroke();

    // Helper to draw glowing trail
    const drawTrail = (buf: RingBuffer<TrailPoint>, rgb: string, widthPx: number) => {
      const len = buf.length;
      if (len < 2) return;
      ctx.lineCap = 'round';
      for (let i = 1; i < len; i++) {
        const a = toScreen(buf.at(i - 1).x, buf.at(i - 1).y);
        const b = toScreen(buf.at(i).x, buf.at(i).y);
        const alpha = Math.pow(i / len, 2) * 0.85;
        ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = widthPx * (0.4 + 0.6 * (i / len));
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    };

    if (showTwinRef.current) {
      drawTrail(twinTrailRef.current, '244, 114, 182', 1.8);
    }
    drawTrail(primaryTrailRef.current, '56, 189, 248', 2.4);

    // Draw Shadow Twin pendulum
    if (showTwinRef.current) {
      const kt = computeKinematics(twinRef.current, p);
      const p1 = toScreen(kt.x1, kt.y1);
      const p2 = toScreen(kt.x2, kt.y2);

      ctx.strokeStyle = 'rgba(244, 114, 182, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();

      ctx.fillStyle = 'rgba(244, 114, 182, 0.7)';
      ctx.beginPath();
      ctx.arc(p1.sx, p1.sy, 5 + p.m1 * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p2.sx, p2.sy, 5 + p.m2 * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Primary pendulum
    const k = computeKinematics(primaryRef.current, p);
    const b1 = toScreen(k.x1, k.y1);
    const b2 = toScreen(k.x2, k.y2);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(b1.sx, b1.sy);
    ctx.lineTo(b2.sx, b2.sy);
    ctx.stroke();

    // Pivot
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(originX, originY, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Mass 1
    const r1 = 6 + p.m1 * 2;
    ctx.save();
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(b1.sx, b1.sy, r1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Mass 2
    const r2 = 6 + p.m2 * 2;
    ctx.save();
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(b2.sx, b2.sy, r2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Optional velocity vectors
    if (showVectorsRef.current) {
      const drawArrow = (sx: number, sy: number, vx: number, vy: number, color: string) => {
        const vScale = 12;
        const ex = sx + vx * vScale;
        const ey = sy + vy * vScale;
        const len = Math.hypot(ex - sx, ey - sy);
        if (len < 3) return;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const ang = Math.atan2(ey - sy, ex - sx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - 7 * Math.cos(ang - 0.45), ey - 7 * Math.sin(ang - 0.45));
        ctx.lineTo(ex - 7 * Math.cos(ang + 0.45), ey - 7 * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      };
      drawArrow(b1.sx, b1.sy, k.vx1, k.vy1, '#38bdf8');
      drawArrow(b2.sx, b2.sy, k.vx2, k.vy2, '#34d399');
    }

    // Legend overlay
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PRIMARY (RK4)', 14, 22);
    if (showTwinRef.current) {
      ctx.fillStyle = '#f472b6';
      ctx.fillText('SHADOW TWIN (Δθ₁ = +0.001 rad)', 14, 38);
    }

    ctx.restore();
  }, []);

  useEffect(() => {
    const k = computeKinematics(primaryRef.current, paramsRef.current);
    keBufRef.current.push(k.kinetic);
    peBufRef.current.push(k.potential);
    totalBufRef.current.push(k.total);
    setTelemetry((prev) => ({
      ke: k.kinetic,
      pe: k.potential,
      total: k.total,
      divergence: 0.001,
      plotVersion: prev.plotVersion + 1,
    }));

    let rafId = 0;
    let lastTime = performance.now();
    let uiCounter = 0;

    const loop = (now: number) => {
      const rawDt = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;

      if (runningRef.current) {
        const { k1, div } = advancePhysics(rawDt * speedRef.current);
        uiCounter++;
        if (uiCounter % 3 === 0) {
          setTelemetry((prev) => ({
            ke: k1.kinetic,
            pe: k1.potential,
            total: k1.total,
            divergence: div,
            plotVersion: prev.plotVersion + 1,
          }));
        }
      }
      drawFrame();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advancePhysics, drawFrame]);

  const handleStep = () => {
    setRunning(false);
    const { k1, div } = advancePhysics(0.016 * speed);
    setTelemetry((prev) => ({
      ke: k1.kinetic,
      pe: k1.potential,
      total: k1.total,
      divergence: div,
      plotVersion: prev.plotVersion + 1,
    }));
    drawFrame();
  };

  return (
    <LabShell
      meta={meta}
      running={running}
      speed={speed}
      onToggleRun={() => setRunning((r) => !r)}
      onStep={handleStep}
      onReset={() => resetSim()}
      onSpeedChange={setSpeed}
      canvas={
        <div className="relative h-[430px] w-full sm:h-[470px]">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
      }
      belowCanvas={
        <LivePlot
          title="Mechanical Energy Conservation"
          yUnit="J"
          version={telemetry.plotVersion}
          minY={0}
          series={[
            { label: 'Total E = T + V', color: '#e2e8f0', values: totalBufRef.current.toArray(), dashed: true },
            { label: 'Kinetic T', color: '#38bdf8', values: keBufRef.current.toArray() },
            { label: 'Potential V', color: '#f59e0b', values: peBufRef.current.toArray() },
          ]}
        />
      }
      metrics={
        <div className="grid grid-cols-2 gap-2.5">
          <MetricCard label="Kinetic (T)" value={telemetry.ke.toFixed(2)} unit="J" color="#38bdf8" />
          <MetricCard label="Potential (V)" value={telemetry.pe.toFixed(2)} unit="J" color="#f59e0b" />
          <MetricCard label="Total Energy" value={telemetry.total.toFixed(2)} unit="J" color="#e2e8f0" />
          <MetricCard
            label="Twin Divergence"
            value={showTwin ? telemetry.divergence.toFixed(3) : 'Off'}
            unit={showTwin ? 'm' : ''}
            color="#f472b6"
            sublabel={showTwin ? 'Initial Δθ₁ = 0.001 rad' : 'Enable Chaos Twin'}
          />
        </div>
      }
      controls={
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowTwin((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showTwin
                  ? 'border-pink-500/40 bg-pink-500/15 text-pink-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Chaos Twin: {showTwin ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={() => setShowVectors((v) => !v)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showVectors
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Velocity Vectors: {showVectors ? 'ON' : 'OFF'}
            </button>
          </div>

          <ParameterSlider
            label="Initial Angle θ₁"
            value={initDeg1}
            min={-175}
            max={175}
            step={1}
            precision={0}
            unit="°"
            onChange={(v) => {
              setInitDeg1(v);
              resetSim(v, initDeg2);
            }}
          />
          <ParameterSlider
            label="Initial Angle θ₂"
            value={initDeg2}
            min={-175}
            max={175}
            step={1}
            precision={0}
            unit="°"
            onChange={(v) => {
              setInitDeg2(v);
              resetSim(initDeg1, v);
            }}
          />
          <ParameterSlider
            label="Upper Mass (m₁)"
            value={params.m1}
            min={0.5}
            max={4}
            step={0.1}
            precision={1}
            unit="kg"
            onChange={(m1) => setParams((p) => ({ ...p, m1 }))}
          />
          <ParameterSlider
            label="Lower Mass (m₂)"
            value={params.m2}
            min={0.5}
            max={4}
            step={0.1}
            precision={1}
            unit="kg"
            onChange={(m2) => setParams((p) => ({ ...p, m2 }))}
          />
          <ParameterSlider
            label="Upper Length (L₁)"
            value={params.l1}
            min={0.6}
            max={2.0}
            step={0.1}
            precision={1}
            unit="m"
            onChange={(l1) => setParams((p) => ({ ...p, l1 }))}
          />
          <ParameterSlider
            label="Gravity (g)"
            value={params.g}
            min={1.62}
            max={24.79}
            step={0.01}
            precision={2}
            unit="m/s²"
            hint="Moon: 1.62 · Earth: 9.81 · Jupiter: 24.79"
            onChange={(g) => setParams((p) => ({ ...p, g }))}
          />
          <ParameterSlider
            label="Viscous Damping"
            value={params.damping}
            min={0}
            max={0.4}
            step={0.01}
            precision={2}
            unit="s⁻¹"
            onChange={(damping) => setParams((p) => ({ ...p, damping }))}
          />
        </>
      }
    />
  );
}
