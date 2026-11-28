import { clamp, thermalColor } from '../../engine/math';
import {
  dissociation,
  haberYield,
  moleFraction,
  no2Dissociation,
  type ChemState,
  type ChemSystem,
} from './physics';
import type { SpriteGas } from './sprites';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BG = '#070b14';
const SYRINGE_MAX_ML = 100;
const WINDOW_S = 40; // seconds of history shown in the time plots

export interface EqHistoryPoint {
  t: number;
  n: number[];
  lnQ: number;
  lnK: number;
  forward: number;
  reverse: number;
}

export interface EqEvent {
  t: number;
  label: string;
  kind?: string; // repeated slider moves of one kind update a single marker
}

export interface EqFrame {
  sys: ChemSystem;
  state: ChemState;
  eq: ChemState;
  sprites: SpriteGas;
  history: EqHistoryPoint[];
  events: EqEvent[];
  condensed: number; // NH₃ removed by the condenser [mol]
  unitScale: number; // amounts are shown in mol × unitScale
  unit: string;
}

// ---------------------------------------------------------------------------------------------
// Small plotting helpers
// ---------------------------------------------------------------------------------------------

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

function fmtTick(v: number, step: number): string {
  if (step >= 1) return v.toFixed(0);
  return v.toFixed(Math.min(4, Math.max(0, -Math.floor(Math.log10(step)))));
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  x: (v: number) => number;
  y: (v: number) => number;
}

function makeBox(w: number, h: number, xr: [number, number], yr: [number, number], padR = 12): Box {
  const left = 52;
  const right = w - padR;
  const top = 30;
  const bottom = h - 30;
  return {
    left,
    right,
    top,
    bottom,
    x: (v) => left + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (right - left),
    y: (v) => bottom - ((v - yr[0]) / (yr[1] - yr[0] || 1)) * (bottom - top),
  };
}

function axes(ctx: CanvasRenderingContext2D, b: Box, xr: [number, number], yr: [number, number], xLabel: string, yLabel: string, yFmt?: (v: number) => string) {
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
    ctx.beginPath();
    ctx.moveTo(b.left, b.y(v));
    ctx.lineTo(b.right, b.y(v));
    ctx.stroke();
    ctx.fillText(yFmt ? yFmt(v) : fmtTick(v, ys), b.left - 4, b.y(v));
  }
  const xs = niceStep(xr[1] - xr[0], 5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = Math.ceil(xr[0] / xs) * xs; v <= xr[1] + 1e-9; v += xs) {
    ctx.beginPath();
    ctx.moveTo(b.x(v), b.top);
    ctx.lineTo(b.x(v), b.bottom);
    ctx.stroke();
    ctx.fillText(fmtTick(v, xs), b.x(v), b.bottom + 3);
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

function polyline(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

function fmtSci(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '0';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 1000) return v.toPrecision(3);
  return v.toExponential(2);
}

/** The direction the mixture will move, in words. */
export function directionText(sys: ChemSystem, lnQ: number, lnK: number): { text: string; color: string } {
  const d = lnQ - lnK;
  if (Math.abs(d) < 0.01) return { text: 'Q = K · at equilibrium', color: '#5eead4' };
  const products = sys.species.filter((s) => s.nu > 0).map((s) => s.formula).join(' + ');
  const reactants = sys.species.filter((s) => s.nu < 0).map((s) => `${-s.nu > 1 ? -s.nu + ' ' : ''}${s.formula}`).join(' + ');
  return d < 0
    ? { text: `Q < K · shifting forward → more ${products}`, color: '#fbbf24' }
    : { text: `Q > K · shifting back → more ${reactants}`, color: '#7dd3fc' };
}

function header(ctx: CanvasRenderingContext2D, w: number, f: EqFrame) {
  const lnQ = f.history.length ? f.history[f.history.length - 1].lnQ : 0;
  const lnK = f.sys.lnK(f.state.T);
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = '#5eead4';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(f.sys.equation, 10, 15);
  const dir = directionText(f.sys, lnQ, lnK);
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = dir.color;
  ctx.textAlign = 'right';
  ctx.fillText(w > 560 ? `Q = ${fmtSci(Math.exp(lnQ))} · K = ${fmtSci(Math.exp(lnK))} · ${dir.text}` : dir.text, w - 10, 15);
}

function drawFlashes(ctx: CanvasRenderingContext2D, f: EqFrame, toX: (u: number) => number, toY: (v: number) => number, scale: number) {
  for (const fl of f.sprites.flashes) {
    const age = f.state.time - fl.t;
    if (age < 0 || age > 0.4) continue;
    const u = age / 0.4;
    ctx.strokeStyle = fl.forward ? `rgba(253, 224, 71, ${0.9 * (1 - u)})` : `rgba(125, 211, 252, ${0.9 * (1 - u)})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(toX(fl.u), toY(fl.v), (3 + 7 * u) * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, s: number) {
  if (key === 'NO2') {
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(x, y, 3.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(x - 1 * s, y - 1 * s, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'N2O4') {
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(x - 2.4 * s, y, 2.8 * s, 0, Math.PI * 2);
    ctx.arc(x + 2.4 * s, y, 2.8 * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'N2') {
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(x - 2.2 * s, y, 2.7 * s, 0, Math.PI * 2);
    ctx.arc(x + 2.2 * s, y, 2.7 * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'H2') {
    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.arc(x - 1.5 * s, y, 1.8 * s, 0, Math.PI * 2);
    ctx.arc(x + 1.5 * s, y, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'NH3') {
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(x, y, 3.3 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1f5f9';
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(x + 3.6 * s * Math.cos(a), y + 3.6 * s * Math.sin(a), 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#a78bfa';
    ctx.beginPath();
    ctx.arc(x, y, 2.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Syringe in a water bath (N₂O₄ ⇌ 2 NO₂)
// ---------------------------------------------------------------------------------------------

export interface SyringeLayout {
  x0: number; // inner end of the barrel (nozzle)
  length: number; // barrel length for 100 mL
  yc: number;
  r: number; // inner radius
  plungerX: (VmL: number) => number;
  volumeAt: (x: number) => number;
  handleX: (VmL: number) => number;
}

export function syringeLayout(w: number, h: number): SyringeLayout {
  const x0 = 0.12 * w;
  const length = 0.6 * w;
  const yc = 0.52 * h;
  const r = Math.min(0.13 * h, 0.09 * w);
  return {
    x0,
    length,
    yc,
    r,
    plungerX: (V) => x0 + (V / SYRINGE_MAX_ML) * length,
    volumeAt: (x) => ((x - x0) / length) * SYRINGE_MAX_ML,
    handleX: (V) => x0 + (V / SYRINGE_MAX_ML) * length + 0.16 * w,
  };
}

export function drawSyringe(ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) {
  const s = f.state;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  header(ctx, w, f);
  const L = syringeLayout(w, h);
  const VmL = s.V * 1000;
  const xp = L.plungerX(VmL);

  // Water bath tinted by temperature
  const tCel = s.T - 273.15;
  const tank = { x: 0.06 * w, y: 0.2 * h, w: 0.74 * w, h: 0.66 * h };
  const warm = clamp(tCel / 100, 0, 1);
  const water = ctx.createLinearGradient(0, tank.y, 0, tank.y + tank.h);
  water.addColorStop(0, `rgba(${Math.round(56 + 180 * warm)}, ${Math.round(140 - 40 * warm)}, ${Math.round(220 - 170 * warm)}, 0.16)`);
  water.addColorStop(1, `rgba(${Math.round(56 + 180 * warm)}, ${Math.round(140 - 40 * warm)}, ${Math.round(220 - 170 * warm)}, 0.32)`);
  ctx.fillStyle = water;
  ctx.fillRect(tank.x, tank.y, tank.w, tank.h);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tank.x, tank.y + 6);
  ctx.lineTo(tank.x, tank.y + tank.h);
  ctx.lineTo(tank.x + tank.w, tank.y + tank.h);
  ctx.lineTo(tank.x + tank.w, tank.y + 6);
  ctx.stroke();
  if (tCel > 60) {
    // Steam wisps above a hot bath
    ctx.strokeStyle = `rgba(226, 232, 240, ${0.12 + 0.2 * (warm - 0.6)})`;
    for (let k = 0; k < 6; k++) {
      const x = tank.x + ((k + 0.5) / 6) * tank.w;
      const ph = (s.time * 0.8 + k * 0.37) % 1;
      ctx.beginPath();
      ctx.moveTo(x, tank.y - 2 - 14 * ph);
      ctx.quadraticCurveTo(x + 6, tank.y - 8 - 14 * ph, x, tank.y - 14 - 14 * ph);
      ctx.stroke();
    }
  }
  if (tCel < 5) {
    ctx.fillStyle = 'rgba(224, 242, 254, 0.35)';
    for (let k = 0; k < 9; k++) {
      const x = tank.x + 10 + ((k * 0.61) % 1) * (tank.w - 30);
      ctx.fillRect(x, tank.y + 8 + ((k * 0.37) % 1) * 20, 12, 9);
    }
  }

  // Gas: NO₂ is brown, N₂O₄ colourless; the colour follows Beer–Lambert, A ∝ [NO₂].
  const cNO2 = s.n[1] / s.V;
  const absorbance = 40 * cNO2;
  const alpha = 1 - 10 ** -absorbance;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.06)';
  ctx.fillRect(L.x0, L.yc - L.r, xp - L.x0, 2 * L.r);
  ctx.fillStyle = `rgba(168, 76, 24, ${clamp(alpha, 0, 0.96)})`;
  ctx.fillRect(L.x0, L.yc - L.r, xp - L.x0, 2 * L.r);

  // Molecules
  const toX = (u: number) => L.x0 + 6 + u * (xp - L.x0 - 12);
  const toY = (v: number) => L.yc - L.r + 4 + v * (2 * L.r - 8);
  const sc = clamp(L.r / 46, 0.7, 1.3);
  for (const sp of f.sprites.sprites) drawSprite(ctx, f.sys.species[sp.sp].key, toX(sp.u), toY(sp.v), sc);
  drawFlashes(ctx, f, toX, toY, sc);

  // Barrel, graduations, nozzle
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(L.x0, L.yc - L.r, L.length, 2 * L.r);
  ctx.fillStyle = '#334155';
  ctx.fillRect(L.x0 - 16, L.yc - 6, 16, 12);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(L.x0 - 24, L.yc - 10, 8, 20);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
  ctx.lineWidth = 1;
  for (let mL = 10; mL <= SYRINGE_MAX_ML; mL += 10) {
    const x = L.plungerX(mL);
    ctx.beginPath();
    ctx.moveTo(x, L.yc - L.r);
    ctx.lineTo(x, L.yc - L.r + (mL % 50 === 0 ? 10 : 6));
    ctx.stroke();
    if (mL % 20 === 0) ctx.fillText(`${mL}`, x, L.yc - L.r - 3);
  }
  ctx.textAlign = 'left';
  ctx.fillText('mL', L.x0 + L.length + 4, L.yc - L.r - 3);

  // Plunger and rod
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(xp, L.yc - L.r + 1, 10, 2 * L.r - 2);
  ctx.fillStyle = '#475569';
  ctx.fillRect(xp + 10, L.yc - 4, L.handleX(VmL) - xp - 10, 8);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(L.handleX(VmL), L.yc - L.r * 0.9, 9, 1.8 * L.r);
  ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
  ctx.font = `9.5px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('⇠ drag ⇢', L.handleX(VmL) + 4, L.yc + L.r * 0.9 + 4);

  // Thermometer
  const tx = tank.x + tank.w + 26;
  const ty0 = tank.y;
  const ty1 = tank.y + tank.h - 14;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tx - 4, ty0, 8, ty1 - ty0);
  ctx.fillStyle = '#f87171';
  const fillTop = ty1 - clamp(tCel / 100, 0, 1) * (ty1 - ty0);
  ctx.fillRect(tx - 2.5, fillTop, 5, ty1 - fillTop);
  ctx.beginPath();
  ctx.arc(tx, ty1 + 7, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = '#fca5a5';
  ctx.textBaseline = 'middle';
  const tLabel = `${tCel.toFixed(0)} °C`;
  const roomRight = tx + 12 + ctx.measureText(tLabel).width < w - 4;
  ctx.textAlign = roomRight ? 'left' : 'right';
  ctx.fillText(tLabel, roomRight ? tx + 12 : tx - 10, fillTop);

  // Read-outs under the barrel
  const narrow = w < 560;
  ctx.font = `bold ${narrow ? 10 : 11}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const y = L.yc + L.r + (narrow ? 18 : 26);
  const parts: [string, string][] = [
    [`V = ${VmL.toFixed(1)} mL`, '#e2e8f0'],
    [`[NO₂] = ${(1000 * cNO2).toFixed(1)} mM`, '#fdba74'],
  ];
  if (!narrow) parts.push([`P = ${s.P.toFixed(2)} bar`, '#94a3b8']);
  let px = L.x0;
  for (const [text, color] of parts) {
    ctx.fillStyle = color;
    ctx.fillText(text, px, y);
    px += ctx.measureText(text).width + (narrow ? 14 : 28);
  }

  // Legend
  ctx.font = `10px ${MONO}`;
  ctx.textBaseline = 'middle';
  let lx = 12;
  const ly = h - 12;
  for (const sp of f.sys.species) {
    if (sp.key === 'Ar' && s.n[2] <= 0) continue;
    drawSprite(ctx, sp.key, lx + 6, ly, 0.9);
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    const label = `${sp.formula}${sp.key === 'NO2' ? ' (brown)' : sp.key === 'N2O4' ? ' (colourless)' : ''}`;
    ctx.fillText(label, lx + 16, ly);
    lx += ctx.measureText(label).width + 34;
  }
  if (w > 620) {
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';
    ctx.fillText(`1 dot ≈ ${(1000 / f.sprites.perMol).toFixed(3)} mmol · flashes: yellow forward, blue reverse`, w - 10, ly);
  }
}

// ---------------------------------------------------------------------------------------------
// Haber–Bosch reactor
// ---------------------------------------------------------------------------------------------

export function drawReactor(ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) {
  const s = f.state;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  header(ctx, w, f);
  const vx = 0.2 * w;
  const vw = 0.46 * w;
  const vy = 0.14 * h;
  const vh = 0.74 * h;
  const heat = clamp((s.T - 500) / 400, 0, 1);

  // Heating jacket
  ctx.fillStyle = thermalColor(0.45 + 0.55 * heat);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(vx - 12, vy - 6, vw + 24, vh + 12);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0b1120';
  ctx.fillRect(vx, vy, vw, vh);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(vx, vy, vw, vh);

  // Catalyst bed
  const bedH = 0.16 * vh;
  const bedY = vy + vh - bedH;
  for (let k = 0; k < 60; k++) {
    const px = vx + 8 + ((k * 0.618) % 1) * (vw - 16);
    const py = bedY + 6 + ((k * 0.414) % 1) * (bedH - 12);
    ctx.fillStyle = s.catalyst ? `rgba(251, 146, 60, ${0.55 + 0.3 * Math.sin(s.time * 3 + k)})` : '#3f3f46';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `9.5px ${MONO}`;
  ctx.fillStyle = s.catalyst ? '#fdba74' : '#71717a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(s.catalyst ? 'iron catalyst (active)' : 'no catalyst', vx + vw / 2, bedY - 2);

  // Gas mixture
  const toX = (u: number) => vx + 8 + u * (vw - 16);
  const toY = (v: number) => vy + 8 + v * (bedH > 0 ? vh - bedH - 22 : vh - 16);
  for (const sp of f.sprites.sprites) drawSprite(ctx, f.sys.species[sp.sp].key, toX(sp.u), toY(sp.v), 1);
  drawFlashes(ctx, f, toX, toY, 1);

  // Pressure gauge
  const gx = vx - 2;
  const gy = vy - 2;
  const gr = Math.min(30, 0.07 * w);
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(gx, gy, gr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const a0 = Math.PI * 0.75;
  const a = a0 + (clamp(s.P, 0, 400) / 400) * Math.PI * 1.5;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 8; k++) {
    const ak = a0 + (k / 8) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(gx + (gr - 6) * Math.cos(ak), gy + (gr - 6) * Math.sin(ak));
    ctx.lineTo(gx + (gr - 2) * Math.cos(ak), gy + (gr - 2) * Math.sin(ak));
    ctx.stroke();
  }
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + (gr - 8) * Math.cos(a), gy + (gr - 8) * Math.sin(a));
  ctx.stroke();
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${s.P.toFixed(0)} bar`, gx, gy + gr + 4);

  // Condenser and collected liquid ammonia
  const cx = vx + vw + 34;
  const cw = Math.min(70, w - cx - 14);
  if (cw > 30) {
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(vx + vw, vy + 0.3 * vh);
    ctx.lineTo(cx + cw / 2, vy + 0.3 * vh);
    ctx.lineTo(cx + cw / 2, vy + 0.5 * vh);
    ctx.stroke();
    const fy = vy + 0.5 * vh;
    const fh = 0.38 * vh;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx, fy, cw, fh);
    const level = clamp(f.condensed / 1.0, 0, 1);
    ctx.fillStyle = 'rgba(52, 211, 153, 0.45)';
    ctx.fillRect(cx + 2, fy + fh - level * (fh - 4) - 2, cw - 4, level * (fh - 4));
    ctx.font = `9.5px ${MONO}`;
    ctx.fillStyle = '#6ee7b7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('liquid NH₃', cx + cw / 2, fy + fh + 4);
    ctx.fillText(`${f.condensed.toFixed(2)} mol`, cx + cw / 2, fy + fh + 16);
  }

  // Read-outs
  ctx.font = `bold 11px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fca5a5';
  ctx.fillText(`${(s.T - 273.15).toFixed(0)} °C`, vx, vy + vh + 10);
  ctx.fillStyle = '#6ee7b7';
  ctx.fillText(`NH₃ ${(100 * moleFraction(s, 2)).toFixed(1)} %`, vx + 70, vy + vh + 10);
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`V = ${s.V.toFixed(2)} L`, vx + 185, vy + vh + 10);

  // Legend
  ctx.font = `10px ${MONO}`;
  ctx.textBaseline = 'middle';
  let lx = 12;
  const ly = h - 12;
  for (const sp of f.sys.species) {
    if (sp.key === 'Ar' && s.n[3] <= 0) continue;
    drawSprite(ctx, sp.key, lx + 6, ly, 0.9);
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.fillText(sp.formula, lx + 16, ly);
    lx += ctx.measureText(sp.formula).width + 34;
  }
  if (w > 620) {
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';
    ctx.fillText(`1 dot ≈ ${(1 / f.sprites.perMol).toFixed(3)} mol · drawing shows the mixture, not the volume`, w - 10, ly);
  }
}

// ---------------------------------------------------------------------------------------------
// Time plots
// ---------------------------------------------------------------------------------------------

function timeRange(f: EqFrame): [number, number] {
  const t = f.state.time;
  return [Math.max(0, t - WINDOW_S), Math.max(WINDOW_S, t)];
}

function visible(f: EqFrame, xr: [number, number]): EqHistoryPoint[] {
  return f.history.filter((p) => p.t >= xr[0] - 0.5);
}

function eventMarkers(ctx: CanvasRenderingContext2D, b: Box, f: EqFrame, xr: [number, number], labels: boolean) {
  ctx.font = `9px ${MONO}`;
  for (const ev of f.events) {
    if (ev.t < xr[0] || ev.t > xr[1]) continue;
    const x = b.x(ev.t);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.setLineDash([3, 3]);
    polyline(ctx, [
      [x, b.top],
      [x, b.bottom],
    ]);
    ctx.setLineDash([]);
    if (labels) {
      ctx.save();
      ctx.translate(x + 3, b.top + 22);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(ev.label, 0, 0);
      ctx.restore();
    }
  }
}

export function drawAmounts(ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  title(ctx, 'AMOUNTS VS TIME');
  const xr = timeRange(f);
  const pts = visible(f, xr);
  let yMax = 0;
  for (const p of pts) for (let i = 0; i < p.n.length; i++) yMax = Math.max(yMax, p.n[i] * f.unitScale);
  const yr: [number, number] = [0, Math.max(1e-6, yMax * 1.12)];
  const b = makeBox(w, h, xr, yr);
  axes(ctx, b, xr, yr, 'time (s)', f.unit);
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();
  eventMarkers(ctx, b, f, xr, true);
  f.sys.species.forEach((sp, i) => {
    if (pts.every((p) => p.n[i] === 0)) return;
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = sp.nu === 0 ? 1.2 : 2;
    ctx.setLineDash(sp.nu === 0 ? [4, 3] : []);
    polyline(ctx, pts.map((p) => [b.x(p.t), b.y(p.n[i] * f.unitScale)]));
    ctx.setLineDash([]);
    // Equilibrium target as a faint dash at the right edge
    const target = f.eq.n[i] * f.unitScale;
    ctx.strokeStyle = sp.color;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([2, 3]);
    polyline(ctx, [
      [b.x(f.state.time), b.y(target)],
      [b.right, b.y(target)],
    ]);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });
  ctx.restore();
  ctx.font = `10px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = b.left + 8;
  for (const sp of f.sys.species) {
    const i = f.sys.species.indexOf(sp);
    if (pts.every((p) => p.n[i] === 0)) continue;
    ctx.fillStyle = sp.color;
    ctx.fillText(sp.formula, x, b.top + 10);
    x += ctx.measureText(sp.formula).width + 12;
  }
  ctx.fillStyle = '#64748b';
  ctx.fillText('dots → equilibrium', x + 4, b.top + 10);
}

export function drawQK(ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  title(ctx, 'REACTION QUOTIENT Q VS K');
  const xr = timeRange(f);
  const pts = visible(f, xr);
  // Centre the window on K; a Q far outside it (e.g. 0 before any product exists) is pinned to the edge.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.lnK / Math.LN10);
    hi = Math.max(hi, p.lnK / Math.LN10);
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 0;
  }
  for (const p of pts) {
    const q = p.lnQ / Math.LN10;
    if (q > lo - 2.5 && q < hi + 2.5) {
      lo = Math.min(lo, q);
      hi = Math.max(hi, q);
    }
  }
  const pad = Math.max(0.25, 0.15 * (hi - lo));
  const yr: [number, number] = [lo - pad, hi + pad];
  const clampQ = (q: number) => Math.min(yr[1], Math.max(yr[0], q));
  const b = makeBox(w, h, xr, yr);
  axes(ctx, b, xr, yr, 'time (s)', 'log scale', (v) => fmtSci(10 ** v));
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();
  eventMarkers(ctx, b, f, xr, false);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  polyline(ctx, pts.map((p) => [b.x(p.t), b.y(p.lnK / Math.LN10)]));
  ctx.setLineDash([]);
  ctx.strokeStyle = '#5eead4';
  ctx.lineWidth = 2;
  polyline(ctx, pts.map((p) => [b.x(p.t), b.y(clampQ(p.lnQ / Math.LN10))]));
  ctx.restore();
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5eead4';
  ctx.fillText('Q (now)', b.left + 8, b.top + 10);
  ctx.fillStyle = '#fbbf24';
  ctx.fillText('- - K (at this T)', b.left + 70, b.top + 10);
  const last = pts[pts.length - 1];
  if (last) {
    const dir = directionText(f.sys, last.lnQ, last.lnK);
    ctx.fillStyle = dir.color;
    ctx.textAlign = 'right';
    ctx.fillText(`ΔG = RT ln(Q/K) = ${((8.314462618 * f.state.T * (last.lnQ - last.lnK)) / 1000).toFixed(2)} kJ/mol`, b.right - 4, b.bottom - 10);
  }
}

export function drawRates(ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  title(ctx, 'FORWARD & REVERSE RATES');
  const xr = timeRange(f);
  const pts = visible(f, xr);
  // Log axis: rates span orders of magnitude between an ice bath and a boiling one.
  const lg = (r: number) => Math.log10(Math.max(r * f.unitScale, 1e-12));
  let hi = -Infinity;
  for (const p of pts) hi = Math.max(hi, lg(p.forward), lg(p.reverse));
  if (!Number.isFinite(hi)) hi = 0;
  let lo = hi;
  const recent = pts.filter((p) => p.t > f.state.time - 8);
  for (const p of recent.length ? recent : pts) {
    if (p.forward > 0) lo = Math.min(lo, lg(p.forward));
    if (p.reverse > 0) lo = Math.min(lo, lg(p.reverse));
  }
  lo = Math.max(lo, hi - 5);
  const pad = Math.max(0.2, 0.12 * (hi - lo));
  const yr: [number, number] = [lo - pad, hi + pad];
  const clampY = (v: number) => Math.min(yr[1], Math.max(yr[0], v));
  const b = makeBox(w, h, xr, yr);
  axes(ctx, b, xr, yr, 'time (s)', `${f.unit}/s (log)`, (v) => fmtSci(10 ** v));
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();
  eventMarkers(ctx, b, f, xr, false);
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  polyline(ctx, pts.map((p) => [b.x(p.t), b.y(clampY(lg(p.forward)))]));
  ctx.strokeStyle = '#7dd3fc';
  ctx.setLineDash([5, 3]);
  polyline(ctx, pts.map((p) => [b.x(p.t), b.y(clampY(lg(p.reverse)))]));
  ctx.setLineDash([]);
  ctx.restore();
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText('forward', b.left + 8, b.top + 10);
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText('- - reverse', b.left + 70, b.top + 10);
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText('equal rates = dynamic equilibrium', b.right - 4, b.bottom - 10);
}

// ---------------------------------------------------------------------------------------------
// Equilibrium maps
// ---------------------------------------------------------------------------------------------

const curveCache = new Map<string, [number, number][]>();

function cachedCurve(key: string, make: () => [number, number][]): [number, number][] {
  let c = curveCache.get(key);
  if (!c) {
    c = make();
    if (curveCache.size > 60) curveCache.clear();
    curveCache.set(key, c);
  }
  return c;
}

export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, f: EqFrame) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const s = f.state;
  if (f.sys.id === 'no2') {
    title(ctx, 'EQUILIBRIUM DISSOCIATION OF N₂O₄');
    const xr: [number, number] = [0, 100];
    const yr: [number, number] = [0, 100];
    const b = makeBox(w, h, xr, yr);
    axes(ctx, b, xr, yr, 'bath temperature (°C)', 'N₂O₄ dissociated (%)');
    const n0 = s.n[0] + 0.5 * s.n[1];
    const V = s.V;
    const vols: [number, string, string, number][] = [
      [V / 2, `${(V * 500).toFixed(0)} mL`, '#64748b', 1.2],
      [V, `${(V * 1000).toFixed(0)} mL (now)`, '#fdba74', 2.2],
      [V * 2, `${(V * 2000).toFixed(0)} mL`, '#64748b', 1.2],
    ];
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    ctx.clip();
    for (const [vol, label, color, width] of vols) {
      const pts = cachedCurve(`no2|${vol.toFixed(6)}|${n0.toFixed(7)}`, () => {
        const out: [number, number][] = [];
        for (let c = 0; c <= 100; c += 2.5) out.push([c, 100 * no2Dissociation(c + 273.15, vol, n0)]);
        return out;
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      polyline(ctx, pts.map(([c, a]) => [b.x(c), b.y(a)]));
      const end = pts[pts.length - 1];
      ctx.fillStyle = color;
      ctx.font = `9.5px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, b.x(end[0]) - 2, b.y(end[1]) - 3);
    }
    ctx.restore();
    marker(ctx, b.x(s.T - 273.15), b.y(100 * dissociation(s)), b.y(100 * dissociation(f.eq)));
    mapLegend(ctx, b.left + 8, b.top + 10);
    return;
  }

  title(ctx, 'EQUILIBRIUM NH₃ YIELD (1 : 3 FEED)');
  const xr: [number, number] = [227, 627];
  const yr: [number, number] = [0, 80];
  const b = makeBox(w, h, xr, yr, 34);
  axes(ctx, b, xr, yr, 'temperature (°C)', 'NH₃ at equilibrium (%)');
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.clip();
  const pressures = [50, 100, 200, 300, 400];
  const current = Math.round(s.P);
  const all = pressures.includes(current) ? pressures : [...pressures, current];
  for (const P of all) {
    const pts = cachedCurve(`haber|${P}`, () => {
      const out: [number, number][] = [];
      for (let c = 227; c <= 627; c += 10) out.push([c, 100 * haberYield(c + 273.15, P)]);
      return out;
    });
    const now = P === current;
    ctx.strokeStyle = now ? '#6ee7b7' : '#475569';
    ctx.lineWidth = now ? 2.2 : 1.2;
    polyline(ctx, pts.map(([c, y]) => [b.x(c), b.y(y)]));
    const lab = pts[Math.floor(pts.length * 0.6)];
    ctx.fillStyle = now ? '#6ee7b7' : '#64748b';
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${P}`, b.x(lab[0]) + 3, b.y(lab[1]) - 1);
  }
  // Relative rate of the catalysed reaction on a second axis: the other half of the compromise
  const kRel = (T: number) => Math.exp(-75e3 / (8.314462618 * T) + 75e3 / (8.314462618 * 900));
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.4;
  const rate: [number, number][] = [];
  for (let c = 227; c <= 627; c += 10) rate.push([b.x(c), b.bottom - kRel(c + 273.15) * (b.bottom - b.top)]);
  polyline(ctx, rate);
  ctx.setLineDash([]);
  ctx.restore();
  ctx.fillStyle = '#fbbf24';
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('rate', b.right + 3, b.top + 6);
  ctx.fillText('(rel.)', b.right + 3, b.top + 17);
  ctx.textAlign = 'right';
  ctx.fillText('- - catalysed rate, relative · curves labelled in bar', b.right - 4, b.top + 10);
  marker(ctx, b.x(s.T - 273.15), b.y(100 * moleFraction(s, 2)), b.y(100 * moleFraction(f.eq, 2)));
  mapLegend(ctx, b.left + 8, b.bottom - 10);
}

function mapLegend(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.font = `9.5px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5eead4';
  ctx.fillText('● now', x, y);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('○ equilibrium', x + 52, y);
}

function marker(ctx: CanvasRenderingContext2D, x: number, yNow: number, yEq: number) {
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
  ctx.setLineDash([2, 2]);
  polyline(ctx, [
    [x, yNow],
    [x, yEq],
  ]);
  ctx.setLineDash([]);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, yEq, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#5eead4';
  ctx.beginPath();
  ctx.arc(x, yNow, 4, 0, Math.PI * 2);
  ctx.fill();
}

