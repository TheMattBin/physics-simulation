import { clamp, thermalColor } from '../../engine/math';
import {
  arrheniusFit,
  concentrationFit,
  fitFloor,
  fractionAbove,
  theoryFractionAbove,
  transform,
  type ArrheniusPoint,
  type ConcMode,
  BOX_H,
  BOX_W,
  DIAMETER,
  R_KJ,
  effectiveBarrier,
  forwardRateConstant,
  type KineticsParams,
  type ReactionGas,
} from './physics';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BG = '#070b14';

export const SPECIES_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6'] as const;
export const SPECIES_NAMES = ['A', 'B', 'C', 'D'] as const;

export interface KineticsFrame {
  gas: ReactionGas;
  params: KineticsParams;
  concMode: ConcMode;
  points: ArrheniusPoint[];
  pointKey: string;
}

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

function fmtTick(v: number, step: number): string {
  if (step >= 1) return v.toFixed(0);
  const d = Math.min(4, Math.max(0, -Math.floor(Math.log10(step))));
  return v.toFixed(d);
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  x: (v: number) => number;
  y: (v: number) => number;
}

function plotBox(
  w: number,
  h: number,
  xr: [number, number],
  yr: [number, number],
  pad = { l: 46, r: 12, t: 30, b: 30 },
): Box {
  const left = pad.l;
  const right = w - pad.r;
  const top = pad.t;
  const bottom = h - pad.b;
  return {
    left,
    right,
    top,
    bottom,
    x: (v) => left + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (right - left),
    y: (v) => bottom - ((v - yr[0]) / (yr[1] - yr[0] || 1)) * (bottom - top),
  };
}

function frameAxes(
  ctx: CanvasRenderingContext2D,
  b: Box,
  xr: [number, number],
  yr: [number, number],
  xLabel: string,
  yLabel: string,
) {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.font = `9px ${MONO}`;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.fillStyle = '#64748b';
  ctx.lineWidth = 1;
  const ys = niceStep(yr[1] - yr[0], 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(yr[0] / ys) * ys; v <= yr[1] + 1e-9; v += ys) {
    const y = b.y(v);
    ctx.beginPath();
    ctx.moveTo(b.left, y);
    ctx.lineTo(b.right, y);
    ctx.stroke();
    ctx.fillText(fmtTick(v, ys), b.left - 4, y);
  }
  const xs = niceStep(xr[1] - xr[0], 5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = Math.ceil(xr[0] / xs) * xs; v <= xr[1] + 1e-9; v += xs) {
    const x = b.x(v);
    ctx.beginPath();
    ctx.moveTo(x, b.top);
    ctx.lineTo(x, b.bottom);
    ctx.stroke();
    ctx.fillText(fmtTick(v, xs), x, b.bottom + 3);
  }
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(b.left, b.top);
  ctx.lineTo(b.left, b.bottom);
  ctx.lineTo(b.right, b.bottom);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(xLabel, b.right, b.bottom + 15);
  ctx.save();
  ctx.translate(11, (b.top + b.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function title(ctx: CanvasRenderingContext2D, text: string) {
  ctx.font = `bold 10.5px ${MONO}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 14);
}

function line(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------
// Reactor box
// ---------------------------------------------------------------------------------------------

export function drawReactor(ctx: CanvasRenderingContext2D, w: number, h: number, f: KineticsFrame) {
  const { gas, params: p } = f;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const headerH = 30;
  const s = Math.min((w - 16) / BOX_W, (h - headerH - 10) / BOX_H);
  const bw = BOX_W * s;
  const bh = BOX_H * s;
  const ox = (w - bw) / 2;
  const oy = headerH + (h - headerH - 6 - bh) / 2;
  const T = gas.smoothedT;

  // Header
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = '#5eead4';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const head = `A + B ${p.reversible ? '⇌' : '→'} C + D · t = ${gas.time.toFixed(0)} ps`;
  ctx.fillText(head, 10, 15);
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = '#94a3b8';
  const tw = ctx.measureText(head).width;
  if (w > 560) {
    ctx.fillText(
      ` · T = ${T.toFixed(0)} K${p.thermal === 'isothermal' ? ` (bath ${p.temperature} K)` : ' (insulated)'}`,
      10 + tw,
      15,
    );
  }
  if (w > 560) {
    ctx.textAlign = 'right';
    ctx.fillText(
      `Eₐ = ${effectiveBarrier(p).toFixed(0)} kJ/mol${p.catalyst ? ' (catalysed)' : ''} · ΔH = ${p.enthalpy > 0 ? '+' : ''}${p.enthalpy} kJ/mol`,
      w - 10,
      15,
    );
  }

  // Box: the heat bath glows at its temperature; an insulated box gets a hatched frame.
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(ox, oy, bw, bh);
  if (p.thermal === 'isothermal') {
    const glow = thermalColor(clamp((p.temperature - 250) / 1400, 0, 1));
    ctx.strokeStyle = glow;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 3;
    ctx.strokeRect(ox - 2, oy - 2, bw + 4, bh + 4);
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(ox - 3, oy - 3, bw + 6, bh + 6);
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(ox, oy, bw, bh);
  ctx.setLineDash([]);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, bw, bh);
  ctx.clip();

  // Reaction flashes (expanding rings)
  const life = 10; // ps
  for (const fl of gas.flashes) {
    const age = gas.time - fl.t;
    if (age < 0 || age > life) continue;
    const u = age / life;
    const exo = fl.reverse ? p.enthalpy > 0 : p.enthalpy < 0;
    ctx.strokeStyle = exo ? `rgba(253, 224, 71, ${0.85 * (1 - u)})` : `rgba(125, 211, 252, ${0.85 * (1 - u)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox + fl.x * s, oy + fl.y * s, (0.4 + 1.6 * u) * s, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Molecules, with ghost copies across the periodic edges
  const r = (DIAMETER / 2) * s;
  for (let sp = 0; sp < 4; sp++) {
    ctx.fillStyle = SPECIES_COLORS[sp];
    ctx.beginPath();
    for (let i = 0; i < gas.n; i++) {
      if (gas.sp[i] !== sp) continue;
      const px = ox + gas.x[i] * s;
      const py = oy + gas.y[i] * s;
      const xs = [px];
      const ys = [py];
      if (gas.x[i] < DIAMETER) xs.push(px + bw);
      if (gas.x[i] > BOX_W - DIAMETER) xs.push(px - bw);
      if (gas.y[i] < DIAMETER) ys.push(py + bh);
      if (gas.y[i] > BOX_H - DIAMETER) ys.push(py - bh);
      for (const X of xs) {
        for (const Y of ys) {
          ctx.moveTo(X + r, Y);
          ctx.arc(X, Y, r, 0, Math.PI * 2);
        }
      }
    }
    ctx.fill();
  }
  ctx.restore();

  // Legend with live counts
  ctx.font = `bold 10.5px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let lx = ox + 8;
  const ly = oy + bh - 12;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.75)';
  ctx.fillRect(ox + 2, ly - 9, Math.min(bw - 4, 300), 18);
  for (let sp = 0; sp < 4; sp++) {
    ctx.fillStyle = SPECIES_COLORS[sp];
    ctx.beginPath();
    ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
    ctx.fill();
    const label = `${SPECIES_NAMES[sp]} ${gas.counts[sp]}`;
    ctx.fillText(label, lx + 11, ly);
    lx += ctx.measureText(label).width + 26;
  }
  if (bw > 520) {
    ctx.font = `9.5px ${MONO}`;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';
    ctx.fillText(`periodic box ${BOX_W} × ${BOX_H} nm`, ox + bw - 6, oy + bh - 12);
  }
}

// ---------------------------------------------------------------------------------------------
// Concentration vs time, with linearized rate-law plots
// ---------------------------------------------------------------------------------------------

export function drawConcentration(ctx: CanvasRenderingContext2D, w: number, h: number, f: KineticsFrame) {
  const { gas, concMode: mode } = f;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const hist = gas.history;
  const tMax = Math.max(50, gas.time * 1.05);
  const nA0 = gas.initial.nA;
  const nB0 = gas.initial.nB;
  const floor = fitFloor(nA0);

  let yr: [number, number];
  let yLabel: string;
  if (mode === 'conc') {
    yr = [0, Math.max(nA0, nB0) * 1.08];
    yLabel = 'molecules';
  } else {
    const vals = hist.filter((p) => p.counts[0] >= floor).map((p) => transform(mode, p.counts[0]));
    vals.push(transform(mode, nA0));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-6) {
      hi += mode === 'ln' ? 0.5 : 1;
      lo -= mode === 'ln' ? 0.5 : 1;
    }
    const pad = 0.08 * (hi - lo);
    yr = [lo - pad, hi + pad];
    yLabel = mode === 'ln' ? 'ln [A]' : '1/[A] (nm²)';
  }
  const b = plotBox(w, h, [0, tMax], yr, { l: mode === 'conc' ? 40 : 46, r: mode === 'conc' ? 40 : 12, t: 30, b: 30 });
  frameAxes(ctx, b, [0, tMax], yr, 'time (ps)', yLabel);
  title(ctx, mode === 'conc' ? 'AMOUNTS VS TIME' : mode === 'ln' ? 'FIRST-ORDER TEST: ln[A] VS t' : 'SECOND-ORDER TEST: 1/[A] VS t');

  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();

  if (mode === 'conc') {
    // Temperature on a right-hand axis
    let tLo = Infinity;
    let tHi = 0;
    for (const p of hist) {
      tLo = Math.min(tLo, p.T);
      tHi = Math.max(tHi, p.T);
    }
    tLo = Math.min(tLo, gas.params.temperature) * 0.9;
    tHi = Math.max(tHi, gas.params.temperature) * 1.1;
    const ty = (T: number) => b.bottom - ((T - tLo) / (tHi - tLo)) * (b.bottom - b.top);
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([1.5, 2.5]);
    line(ctx, hist.map((p) => [b.x(p.t), ty(p.T)]));
    ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = '#f87171';
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${tHi.toFixed(0)} K`, b.right + 3, b.top + 4);
    ctx.fillText(`${tLo.toFixed(0)} K`, b.right + 3, b.bottom - 4);
    ctx.fillText('T', b.right + 3, (b.top + b.bottom) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    ctx.clip();

    for (const sp of [0, 1, 2]) {
      ctx.strokeStyle = SPECIES_COLORS[sp];
      ctx.lineWidth = 1.8;
      line(ctx, hist.map((p) => [b.x(p.t), b.y(p.counts[sp])]));
    }
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#e2e8f0';
    line(ctx, hist.map((p) => [b.x(p.t), b.y(p.theoryA)]));
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
    line(ctx, hist.map((p) => [b.x(p.t), b.y(nA0 - p.theoryA)]));
    ctx.setLineDash([]);
    ctx.restore();

    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const items: [string, string][] = [
      ['A', SPECIES_COLORS[0]],
      ['B', SPECIES_COLORS[1]],
      ['C = D', SPECIES_COLORS[2]],
      ['- - rate law', '#e2e8f0'],
      ['··· T', '#f87171'],
    ];
    const widths = items.map(([label]) => ctx.measureText(label).width + 12);
    let x = (b.left + b.right) / 2 - widths.reduce((acc, v) => acc + v, 0) / 2;
    items.forEach(([label, color], k) => {
      ctx.fillStyle = color;
      ctx.fillText(label, x, b.top + 10);
      x += widths[k];
    });
    return;
  }

  const pts = hist.filter((p) => p.counts[0] >= floor);
  ctx.fillStyle = SPECIES_COLORS[0];
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(b.x(p.t), b.y(transform(mode, p.counts[0])), 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
  ctx.lineWidth = 1.2;
  line(ctx, hist.filter((p) => p.theoryA > 0.5).map((p) => [b.x(p.t), b.y(transform(mode, p.theoryA))]));
  ctx.setLineDash([]);
  const fit = concentrationFit(gas, mode);
  if (fit && pts.length > 3) {
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 1.6;
    const t1 = pts[pts.length - 1].t;
    line(ctx, [
      [b.x(0), b.y(fit.intercept)],
      [b.x(t1), b.y(fit.intercept + fit.slope * t1)],
    ]);
  }
  ctx.restore();
  const other = concentrationFit(gas, mode === 'ln' ? 'inv' : 'ln');
  if (fit && other && pts.length > 3) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`compare: R² of ${mode === 'ln' ? '1/[A]' : 'ln[A]'} plot = ${other.r2.toFixed(3)}`, b.left + 8, b.top + 26);
  }
  if (fit && pts.length > 3) {
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = '#5eead4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const slope = mode === 'ln' ? `slope = ${fit.slope.toExponential(2)} ps⁻¹` : `slope = ${fit.slope.toFixed(4)} nm²/ps`;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
    const text = `${slope} · R² = ${fit.r2.toFixed(4)}`;
    ctx.fillRect(b.left + 4, b.top + 3, ctx.measureText(text).width + 8, 15);
    ctx.fillStyle = !other || fit.r2 >= other.r2 ? '#5eead4' : '#fbbf24';
    ctx.fillText(text, b.left + 8, b.top + 10.5);
  }
}

// ---------------------------------------------------------------------------------------------
// Collision-energy distribution
// ---------------------------------------------------------------------------------------------

export function drawEnergyDistribution(ctx: CanvasRenderingContext2D, w: number, h: number, f: KineticsFrame) {
  const { gas, params: p } = f;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const mix = gas.sampleTemperatures();
  const Tmax = Math.max(...mix.map((m) => m.T));
  const RT = R_KJ * Tmax;
  const Ea = effectiveBarrier(p);
  const Emax = Math.max(Ea * 1.5, 6 * RT, 10);
  const bins = 30;
  const dE = Emax / bins;
  const sample = gas.energySample();
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < sample.length; i++) {
    const k = Math.floor(sample[i] / dE);
    if (k < bins) counts[k]++;
  }
  const dens = counts.map((c) => (sample.length > 0 ? c / (sample.length * dE) : 0));
  const theoryDensity = (E: number) => mix.reduce((acc, m) => acc + (m.w * Math.exp(-E / (R_KJ * m.T))) / (R_KJ * m.T), 0);
  const yMax = Math.max(theoryDensity(0), ...dens) * 1.1;
  const b = plotBox(w, h, [0, Emax], [0, yMax], { l: 46, r: 12, t: 30, b: 30 });
  frameAxes(ctx, b, [0, Emax], [0, yMax], 'collision energy along line of centres (kJ/mol)', 'share per kJ/mol');
  title(ctx, 'A–B COLLISION ENERGIES');

  for (let k = 0; k < bins; k++) {
    const e0 = k * dE;
    const above = e0 + dE / 2 >= Ea;
    ctx.fillStyle = above ? 'rgba(245, 158, 11, 0.75)' : 'rgba(56, 189, 248, 0.45)';
    const x0 = b.x(e0) + 0.5;
    const x1 = b.x(e0 + dE) - 0.5;
    ctx.fillRect(x0, b.y(dens[k]), x1 - x0, b.bottom - b.y(dens[k]));
  }
  // Theory: P(E) = e^(−E/RT) / RT
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 120; i++) {
    const E = (i / 120) * Emax;
    pts.push([b.x(E), b.y(theoryDensity(E))]);
  }
  line(ctx, pts);
  ctx.setLineDash([]);

  const barrier = (E: number, label: string, color: string, dash: number[]) => {
    if (E > Emax) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    line(ctx, [
      [b.x(E), b.top],
      [b.x(E), b.bottom],
    ]);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `bold 10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, b.x(E) + 4, b.top + 4);
  };
  if (p.catalyst) barrier(Math.max(0, p.activationEnergy), 'uncatalysed', '#64748b', [3, 3]);
  barrier(Ea, `Eₐ = ${Ea.toFixed(0)}`, '#fbbf24', []);

  const meas = fractionAbove(sample, Ea);
  const theo = theoryFractionAbove(mix, Ea);
  const mixed = mix.length > 1;
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fcd34d';
  ctx.fillText(
    sample.length > 50
      ? `≥ Eₐ: ${(100 * meas).toFixed(meas < 0.1 ? 2 : 1)} % measured · ${mixed ? '⟨e^(−Eₐ/RT)⟩' : 'e^(−Eₐ/RT)'} = ${(100 * theo).toFixed(theo < 0.1 ? 2 : 1)} %`
      : 'collecting collisions…',
    b.right - 4,
    b.top + 30,
  );
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    mixed
      ? `${sample.length.toLocaleString()} collisions at ${Math.min(...mix.map((m) => m.T)).toFixed(0)}–${Tmax.toFixed(0)} K · dashed: mixture`
      : `${sample.length.toLocaleString()} collisions · dashed: e^(−E/RT)/RT`,
    b.right - 4,
    b.top + 45,
  );
}

// ---------------------------------------------------------------------------------------------
// Energy profile along the reaction coordinate
// ---------------------------------------------------------------------------------------------

function profile(x: number, Ea: number, dH: number): number {
  // Smooth reactant plateau → barrier at x = 0.5 → product plateau.
  if (x <= 0.15) return 0;
  if (x >= 0.85) return dH;
  if (x <= 0.5) {
    const u = (x - 0.15) / 0.35;
    return Ea * (0.5 - 0.5 * Math.cos(Math.PI * u));
  }
  const u = (x - 0.5) / 0.35;
  return dH + (Ea - dH) * (0.5 + 0.5 * Math.cos(Math.PI * u));
}

export function drawEnergyProfile(ctx: CanvasRenderingContext2D, w: number, h: number, f: KineticsFrame) {
  const { params: p, gas } = f;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  title(ctx, 'ENERGY PROFILE');
  const Ea0 = Math.max(p.activationEnergy, p.enthalpy, 0);
  const Ea = effectiveBarrier(p);
  const lo = Math.min(0, p.enthalpy) - (p.enthalpy < 0 ? 12 : 6);
  const hi = Math.max(Ea0, 5) + 8;
  const b = plotBox(w, h, [0, 1], [lo, hi], { l: 46, r: 12, t: 30, b: 24 });
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(b.left, b.top);
  ctx.lineTo(b.left, b.bottom);
  ctx.lineTo(b.right, b.bottom);
  ctx.stroke();
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const st = niceStep(hi - lo, 4);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) ctx.fillText(v.toFixed(0), b.left - 4, b.y(v));
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('reaction coordinate →', b.right, b.bottom + 4);
  ctx.save();
  ctx.translate(11, (b.top + b.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('energy (kJ/mol)', 0, 0);
  ctx.restore();

  const curve = (E: number, color: string, width: number, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 100; i++) pts.push([b.x(i / 100), b.y(profile(i / 100, E, p.enthalpy))]);
    line(ctx, pts);
    ctx.setLineDash([]);
  };
  if (p.catalyst) {
    curve(Ea0, '#64748b', 1.5, [4, 3]);
    curve(Ea, '#5eead4', 2.2, []);
  } else {
    curve(Ea, '#5eead4', 2.2, []);
  }

  // Thermal energy scale RT next to the reactants
  const T = p.thermal === 'isothermal' ? p.temperature : gas.smoothedT;
  const RT = R_KJ * T;
  ctx.fillStyle = 'rgba(251, 146, 60, 0.25)';
  ctx.fillRect(b.x(0.02), b.y(RT), b.x(0.13) - b.x(0.02), b.y(0) - b.y(RT));
  ctx.fillStyle = '#fdba74';
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`RT = ${RT.toFixed(1)}`, b.x(0.02), b.y(RT) - 2);

  // Annotations
  const arrowV = (x: number, y0: number, y1: number, color: string, label: string, side: 'left' | 'right') => {
    if (Math.abs(y1 - y0) < 0.5) return;
    const px = b.x(x);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.3;
    line(ctx, [
      [px, b.y(y0)],
      [px, b.y(y1)],
    ]);
    const dir = y1 > y0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(px, b.y(y1));
    ctx.lineTo(px - 3.5, b.y(y1) + dir * 6);
    ctx.lineTo(px + 3.5, b.y(y1) + dir * 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = `bold 10px ${MONO}`;
    const tw = ctx.measureText(label).width + 6;
    const lx = side === 'left' ? px - 6 - tw : px + 6;
    const ly = b.y((y0 + y1) / 2);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.fillRect(lx, ly - 7, tw, 14);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 3, ly);
  };
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.setLineDash([3, 3]);
  line(ctx, [
    [b.x(0.15), b.y(0)],
    [b.x(0.62), b.y(0)],
  ]);
  ctx.setLineDash([]);
  arrowV(0.42, 0, Ea, '#fbbf24', `Eₐ ${Ea.toFixed(0)}`, 'left');
  if (p.reversible) arrowV(0.58, p.enthalpy, Ea, '#7dd3fc', `Eₐ,rev ${(Ea - p.enthalpy).toFixed(0)}`, 'right');
  arrowV(0.9, 0, p.enthalpy, p.enthalpy < 0 ? '#fb7185' : '#7dd3fc', `ΔH ${p.enthalpy > 0 ? '+' : ''}${p.enthalpy}`, 'left');
  ctx.font = `bold 10.5px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7dd3fc';
  ctx.textBaseline = 'top';
  ctx.fillText('A + B', b.x(0.075), b.y(0) + 4);
  ctx.fillStyle = '#6ee7b7';
  ctx.textBaseline = p.enthalpy <= 0 ? 'top' : 'bottom';
  ctx.fillText('C + D', b.x(0.95), b.y(p.enthalpy) + (p.enthalpy <= 0 ? 4 : -4));
  if (p.catalyst) {
    ctx.font = `9.5px ${MONO}`;
    ctx.fillStyle = '#94a3b8';
    ctx.textBaseline = 'bottom';
    ctx.fillText('uncatalysed', b.x(0.5), b.y(Ea0) - 3);
  }
}

// ---------------------------------------------------------------------------------------------
// Arrhenius plot
// ---------------------------------------------------------------------------------------------

export function drawArrhenius(ctx: CanvasRenderingContext2D, w: number, h: number, f: KineticsFrame) {
  const { params: p, points, pointKey } = f;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  title(ctx, 'ARRHENIUS PLOT');
  const Tlo = 300;
  const Thi = 1500;
  const nTot = f.gas.n;
  const kAt = (T: number) => forwardRateConstant(T, { ...p, nA: nTot / 2, nB: nTot / 2 });
  const xr: [number, number] = [1000 / Thi - 0.05, 1000 / Tlo + 0.1];
  let ylo = Math.log(kAt(Tlo));
  let yhi = Math.log(kAt(Thi));
  for (const pt of points) {
    ylo = Math.min(ylo, Math.log(pt.k) - 0.3);
    yhi = Math.max(yhi, Math.log(pt.k) + 0.3);
  }
  if (!Number.isFinite(ylo)) ylo = -12;
  const yr: [number, number] = [ylo - 0.4, yhi + 0.4];
  const b = plotBox(w, h, xr, yr, { l: 46, r: 12, t: 30, b: 30 });
  frameAxes(ctx, b, xr, yr, '1000 / T (K⁻¹)', 'ln k');

  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();
  // Collision theory for the current conditions
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.3;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const inv = xr[0] + ((xr[1] - xr[0]) * i) / 60;
    pts.push([b.x(inv), b.y(Math.log(kAt(1000 / inv)))]);
  }
  line(ctx, pts);
  ctx.setLineDash([]);

  const current = points.filter((pt) => pt.key === pointKey);
  const fit = arrheniusFit(current);
  if (fit) {
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 1.6;
    line(ctx, [
      [b.x(xr[0]), b.y(fit.intercept + fit.slope * (xr[0] / 1000))],
      [b.x(xr[1]), b.y(fit.intercept + fit.slope * (xr[1] / 1000))],
    ]);
  }
  for (const pt of points) {
    const matches = pt.key === pointKey;
    const x = b.x(1000 / pt.T);
    const y = b.y(Math.log(pt.k));
    const e = 1 / Math.sqrt(Math.max(1, pt.reactions));
    ctx.strokeStyle = matches ? '#5eead4' : '#475569';
    ctx.lineWidth = 1.2;
    line(ctx, [
      [x, b.y(Math.log(pt.k) - e)],
      [x, b.y(Math.log(pt.k) + e)],
    ]);
    ctx.fillStyle = matches ? '#ccfbf1' : '#475569';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  if (fit) {
    const text = `slope → Eₐ = ${fit.Ea.toFixed(1)} ± ${fit.EaErr.toFixed(1)} kJ/mol`;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
    ctx.fillRect(b.right - ctx.measureText(text).width - 10, b.top + 3, ctx.measureText(text).width + 8, 15);
    ctx.fillStyle = '#5eead4';
    ctx.fillText(text, b.right - 6, b.top + 10.5);
  } else {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(points.length ? 'add a point at another temperature' : 'measure k, then press “Add k to plot”', b.right - 6, b.top + 10.5);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('dashed: collision theory', b.right - 6, b.top + 26);
}
