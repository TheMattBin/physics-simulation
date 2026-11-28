import { clamp, thermalColor } from '../../engine/math';
import {
  deflectionAt,
  momentAt,
  shearAt,
  stressAt,
  type BeamSolution,
  type CrossSection,
  type PointStress,
  type StressFieldMode,
} from './physics';

export const BEAM_COLORS = {
  load: '#fb7185',
  reaction: '#34d399',
  shear: '#fb7185',
  moment: '#a78bfa',
  envelope: '#c4b5fd',
  deflection: '#38bdf8',
  tension: '#fb7185',
  compression: '#38bdf8',
  tau: '#f472b6',
  cut: '#e2e8f0',
} as const;

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BG = '#070b14';
const MAX_DRAWN_DEFLECTION = 44; // px, target for the auto scale

type RGB = [number, number, number];
const ZERO_RGB: RGB = [24, 32, 52];
const TENSION_RGB: RGB = [251, 113, 133];
const COMPRESSION_RGB: RGB = [56, 189, 248];
const TAU_RGB: RGB = [244, 114, 182];

function mixRgb(a: RGB, b: RGB, t: number): string {
  const u = clamp(t, 0, 1);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)}, ${Math.round(a[1] + (b[1] - a[1]) * u)}, ${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

export interface FieldScale {
  sigma: number; // MPa that maps to full colour
  tau: number;
}

export function fieldColor(mode: StressFieldMode, st: PointStress, scale: FieldScale): string {
  if (mode === 'bending') {
    const t = scale.sigma > 0 ? st.sigma / scale.sigma : 0;
    return mixRgb(ZERO_RGB, t >= 0 ? TENSION_RGB : COMPRESSION_RGB, Math.abs(t) ** 0.85);
  }
  if (mode === 'shear') {
    return mixRgb(ZERO_RGB, TAU_RGB, scale.tau > 0 ? Math.abs(st.tau) / scale.tau : 0);
  }
  return st.util >= 1 ? '#fff1f2' : thermalColor(st.util);
}

/** Signed number with a real minus sign and no "−0.0". */
export function fmtSigned(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return `${v < 0 ? '−' : '+'}${s}`;
}

export function fmtNum(v: number, digits = 1): string {
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return `${v < 0 ? '−' : ''}${s}`;
}

/** Deflection exaggeration from the 1–2–5 series so the largest drawn sag is about 44 px. */
export function autoDeflectionScale(maxDeflM: number, pxPerM: number): number {
  const px = Math.abs(maxDeflM) * pxPerM;
  if (px < 1e-9) return 1;
  const raw = MAX_DRAWN_DEFLECTION / px;
  if (raw <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

export interface BeamLayout {
  width: number;
  height: number;
  x0: number;
  x1: number;
  pxPerM: number;
  beamY: number; // undeformed centreline
  halfDepthPx: number;
  beamZone: [number, number];
  vZone: [number, number];
  mZone: [number, number];
  wZone: [number, number];
  axisY: number;
  sx: (x: number) => number;
  toX: (px: number) => number;
}

export function beamLayout(width: number, height: number, L: number, depth: number): BeamLayout {
  const x0 = 72;
  const x1 = Math.max(x0 + 40, width - 30);
  const pxPerM = (x1 - x0) / L;
  const beamZone: [number, number] = [30, 290];
  const beamY = 142;
  const halfDepthPx = clamp((depth * pxPerM) / 2, 6, 22);
  const axisY = height - 22;
  const top = beamZone[1] + 4;
  const gap = 10;
  const dh = (axisY - top - 2 * gap) / 3;
  return {
    width,
    height,
    x0,
    x1,
    pxPerM,
    beamY,
    halfDepthPx,
    beamZone,
    vZone: [top, top + dh],
    mZone: [top + dh + gap, top + 2 * dh + gap],
    wZone: [top + 2 * dh + 2 * gap, axisY],
    axisY,
    sx: (x: number) => x0 + x * pxPerM,
    toX: (px: number) => (px - x0) / pxPerM,
  };
}

export interface Envelope {
  xs: number[];
  hi: number[]; // largest M seen at each x [N·m]
  lo: number[]; // smallest M seen at each x [N·m]
}

export interface BeamFrame {
  sol: BeamSolution;
  mode: StressFieldMode;
  cutX: number;
  deflScale: number;
  locked: boolean;
  rolling: boolean;
  envelope: Envelope | null;
}

const SUPPORT_LABEL = {
  'simply-supported': 'SIMPLY SUPPORTED',
  cantilever: 'CANTILEVER',
  overhanging: 'OVERHANGING',
} as const;

function arrow(ctx: CanvasRenderingContext2D, x: number, yTail: number, yHead: number, head = 7) {
  const dir = Math.sign(yHead - yTail) || 1;
  ctx.beginPath();
  ctx.moveTo(x, yTail);
  ctx.lineTo(x, yHead - dir * head * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, yHead);
  ctx.lineTo(x - head * 0.6, yHead - dir * head);
  ctx.lineTo(x + head * 0.6, yHead - dir * head);
  ctx.closePath();
  ctx.fill();
}

function hatchGround(ctx: CanvasRenderingContext2D, xc: number, y: number, half: number) {
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xc - half, y);
  ctx.lineTo(xc + half, y);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
  for (let k = -half; k < half; k += 5) {
    ctx.beginPath();
    ctx.moveTo(xc + k + 5, y);
    ctx.lineTo(xc + k, y + 6);
    ctx.stroke();
  }
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, yTop: number) {
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x - 10, yTop + 16);
  ctx.lineTo(x + 10, yTop + 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  hatchGround(ctx, x, yTop + 16, 15);
}

function drawRoller(ctx: CanvasRenderingContext2D, x: number, yTop: number) {
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x - 9, yTop + 11);
  ctx.lineTo(x + 9, yTop + 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const dx of [-5, 5]) {
    ctx.beginPath();
    ctx.arc(x + dx, yTop + 13.5, 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  hatchGround(ctx, x, yTop + 16, 15);
}

function drawWall(ctx: CanvasRenderingContext2D, x: number, yc: number) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(x - 16, yc - 46, 16, 92);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, yc - 46);
  ctx.lineTo(x, yc + 46);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
  ctx.lineWidth = 1;
  for (let k = -46; k < 46; k += 6) {
    ctx.beginPath();
    ctx.moveTo(x, yc + k);
    ctx.lineTo(x - 10, yc + k + 8);
    ctx.stroke();
  }
}

/** Interior flange/wall lines to draw along the elevation, as heights y [m]. */
function interiorLines(sec: CrossSection): number[] {
  if (sec.type === 'rectangular') return [];
  const yj = sec.depth / 2 - sec.flangeThickness;
  return [-yj, yj];
}

function drawBeamBody(ctx: CanvasRenderingContext2D, lay: BeamLayout, f: BeamFrame) {
  const { sol, mode, deflScale } = f;
  const m = sol.model;
  const sec = m.section;
  const { sx, beamY, halfDepthPx: hd, pxPerM } = lay;
  const offset = (x: number) => clamp(deflectionAt(m, x) * deflScale * pxPerM, -90, 90);
  const scale: FieldScale = { sigma: sol.maxSigmaMPa, tau: sol.maxTauMPa };

  // Stress field, column by column along the deformed beam.
  const plotW = lay.x1 - lay.x0;
  const cols = Math.round(clamp(plotW / 4, 40, 240));
  const rows = 14;
  const colW = plotW / cols;
  const cellH = (2 * hd) / rows;
  const c = sec.depth / 2;
  for (let i = 0; i < cols; i++) {
    const x = ((i + 0.5) / cols) * m.L;
    const M = momentAt(m, x);
    const V = shearAt(m, x);
    const yTop = beamY + offset(x) - hd;
    for (let j = 0; j < rows; j++) {
      const y = -c + ((j + 0.5) / rows) * 2 * c;
      ctx.fillStyle = fieldColor(mode, stressAt(M, V, sec, m.material, y), scale);
      ctx.fillRect(lay.x0 + i * colW, yTop + j * cellH, colW + 0.6, cellH + 0.6);
    }
  }

  const n = Math.max(60, Math.round(plotW / 3));
  const edge = (yPx: number, style: string, width: number, dash: number[] = []) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * m.L;
      const px = sx(x);
      const py = beamY + offset(x) + yPx;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  for (const y of interiorLines(sec)) {
    edge((y / c) * hd, 'rgba(226, 232, 240, 0.28)', 1, sec.type === 'circular-pipe' ? [3, 3] : []);
  }
  edge(0, 'rgba(226, 232, 240, 0.22)', 1, [5, 4]); // neutral axis
  edge(-hd, '#cbd5e1', 1.4);
  edge(hd, '#cbd5e1', 1.4);
  // End faces
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.4;
  for (const x of [0, m.L]) {
    ctx.beginPath();
    ctx.moveTo(sx(x), beamY + offset(x) - hd);
    ctx.lineTo(sx(x), beamY + offset(x) + hd);
    ctx.stroke();
  }

  // Where the failure criterion is closest to being reached.
  if (mode === 'utilization' && sol.maxUtil > 1e-6) {
    const px = sx(sol.maxUtilX);
    const py = beamY + offset(sol.maxUtilX) + (sol.maxUtilY / c) * hd;
    ctx.strokeStyle = sol.maxUtil >= 1 ? '#fff1f2' : '#f8fafc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.stroke();
    const text = `peak U ${sol.maxUtil.toFixed(2)}`;
    ctx.font = `10px ${MONO}`;
    const tw = ctx.measureText(text).width + 8;
    const right = px < lay.x1 - tw - 14;
    const bx = right ? px + 10 : px - 10 - tw;
    const by = beamY + offset(sol.maxUtilX) - 7.5;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
    ctx.fillRect(bx, by, tw, 15);
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 4, by + 7.5);
  }
}

function drawLoadsAndSupports(ctx: CanvasRenderingContext2D, lay: BeamLayout, f: BeamFrame) {
  const m = f.sol.model;
  const { sx, beamY, halfDepthPx: hd, pxPerM } = lay;
  const offset = (x: number) => clamp(deflectionAt(m, x) * f.deflScale * pxPerM, -90, 90);
  const topAt = (x: number) => beamY + offset(x) - hd;
  const support = m.params.support;
  ctx.font = `10.5px ${MONO}`;
  ctx.textBaseline = 'alphabetic';

  // Uniform load
  if (m.q > 0) {
    const nArrows = Math.max(4, Math.round((lay.x1 - lay.x0) / 26));
    ctx.strokeStyle = 'rgba(251, 113, 133, 0.7)';
    ctx.fillStyle = 'rgba(251, 113, 133, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= nArrows; i++) {
      const x = (i / nArrows) * m.L;
      const y = topAt(x) - 26;
      if (i === 0) ctx.moveTo(sx(x), y);
      else ctx.lineTo(sx(x), y);
    }
    ctx.stroke();
    for (let i = 0; i <= nArrows; i++) {
      const x = (i / nArrows) * m.L;
      arrow(ctx, sx(x), topAt(x) - 26, topAt(x) - 2, 5);
    }
    const applied = m.q - m.qSelf;
    const label =
      m.qSelf > 0 && applied > 0
        ? `q = ${(applied / 1e3).toFixed(1)} + ${(m.qSelf / 1e3).toFixed(2)} self-weight = ${(m.q / 1e3).toFixed(2)} kN/m`
        : m.qSelf > 0
          ? `self-weight ρAg = ${(m.qSelf / 1e3).toFixed(2)} kN/m`
          : `q = ${(m.q / 1e3).toFixed(1)} kN/m`;
    ctx.fillStyle = '#fda4af';
    ctx.textAlign = 'left';
    ctx.fillText(label, lay.x0, topAt(0) - 32);
  }

  // Point load
  if (m.P > 0) {
    const px = sx(m.a);
    const yHead = topAt(m.a) - 2;
    ctx.strokeStyle = BEAM_COLORS.load;
    ctx.fillStyle = BEAM_COLORS.load;
    ctx.lineWidth = 2.6;
    arrow(ctx, px, yHead - 66, yHead, 10);
    ctx.font = `bold 11px ${MONO}`;
    ctx.textAlign = px > lay.x1 - 60 ? 'right' : px < lay.x0 + 60 ? 'left' : 'center';
    ctx.fillText(`P = ${(m.P / 1e3).toFixed(0)} kN`, px, yHead - 72);
    if (!f.rolling) {
      ctx.fillStyle = 'rgba(251, 113, 133, 0.18)';
      ctx.beginPath();
      ctx.arc(px, yHead - 66, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Supports and reactions
  ctx.font = `10.5px ${MONO}`;
  const reaction = (x: number, R: number, name: string, dx = 0) => {
    const px = sx(x) + dx;
    const yBase = beamY + hd + 22;
    ctx.strokeStyle = BEAM_COLORS.reaction;
    ctx.fillStyle = BEAM_COLORS.reaction;
    ctx.lineWidth = 2.2;
    if (Math.abs(R) > 1) {
      if (R > 0) arrow(ctx, px, yBase + 40, yBase + 4, 8);
      else arrow(ctx, px, yBase + 4, yBase + 40, 8);
    }
    const txt = `${name} = ${fmtNum(R / 1e3, 1)} kN${R < -1 ? ' (hold-down)' : ''}`;
    ctx.textAlign = px < lay.x0 + 70 ? 'left' : px > lay.x1 - 90 ? 'right' : 'center';
    ctx.fillText(txt, px + (ctx.textAlign === 'left' ? -8 : 0), yBase + 56);
  };

  if (support === 'cantilever') {
    drawWall(ctx, sx(0), beamY);
    reaction(0, m.RA, 'R_A', 12);
    // Wall moment arc: the wall resists the hogging moment
    const cx = sx(0) + 2;
    const r = hd + 16;
    ctx.strokeStyle = BEAM_COLORS.reaction;
    ctx.fillStyle = BEAM_COLORS.reaction;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, beamY, r, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.stroke();
    const endAng = -Math.PI * 0.42;
    const ex = cx + r * Math.cos(endAng);
    const ey = beamY + r * Math.sin(endAng);
    ctx.beginPath();
    ctx.moveTo(ex - 1, ey - 5);
    ctx.lineTo(ex + 7, ey + 1);
    ctx.lineTo(ex - 3, ey + 5);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText(`M_A = ${Math.abs(m.MA / 1e3).toFixed(1)} kN·m (wall moment)`, sx(0) + 4, beamY + hd + 92);
  } else {
    drawPin(ctx, sx(0), beamY + hd + 1);
    drawRoller(ctx, sx(m.b), beamY + offset(m.b) + hd + 1);
    reaction(0, m.RA, 'R_A');
    reaction(m.b, m.RB, 'R_B');
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, lay: BeamLayout, f: BeamFrame) {
  const { sol, mode } = f;
  const w = 128;
  const x = lay.width - 30 - w;
  const y = 40;
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    let color: string;
    if (mode === 'bending') color = fieldColor('bending', { sigma: (2 * t - 1) * 1, tau: 0, util: 0 }, { sigma: 1, tau: 1 });
    else if (mode === 'shear') color = fieldColor('shear', { sigma: 0, tau: t, util: 0 }, { sigma: 1, tau: 1 });
    else color = fieldColor('utilization', { sigma: 0, tau: 0, util: t * 0.999 }, { sigma: 1, tau: 1 });
    ctx.fillStyle = color;
    ctx.fillRect(x + (i / steps) * w, y, w / steps + 0.5, 7);
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, 7);
  ctx.font = `9.5px ${MONO}`;
  ctx.fillStyle = '#94a3b8';
  ctx.textBaseline = 'top';
  const lo = mode === 'bending' ? `−${sol.maxSigmaMPa.toFixed(0)}` : '0';
  const hi =
    mode === 'bending' ? `+${sol.maxSigmaMPa.toFixed(0)} MPa` : mode === 'shear' ? `${sol.maxTauMPa.toFixed(1)} MPa` : '1.0 = limit';
  const title = mode === 'bending' ? 'σ  compression | tension' : mode === 'shear' ? '|τ| transverse shear' : 'utilization U';
  ctx.textAlign = 'left';
  ctx.fillText(lo, x, y + 10);
  ctx.textAlign = 'right';
  ctx.fillText(hi, x + w, y + 10);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(title, x + w, y - 3);
}

interface DiagramSpec {
  zone: [number, number];
  values: number[]; // in display units
  xs: number[];
  color: string;
  fill: string;
  name: string;
  unit: string;
  digits: number;
  downIsPositive?: boolean;
  envelope?: { xs: number[]; hi: number[]; lo: number[] } | null;
  cutValue: number;
}

function drawDiagram(ctx: CanvasRenderingContext2D, lay: BeamLayout, cutX: number, d: DiagramSpec) {
  const [top, bottom] = d.zone;
  let lo = 0;
  let hi = 0;
  for (const v of d.values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (d.envelope) {
    for (const v of d.envelope.hi) if (v > hi) hi = v;
    for (const v of d.envelope.lo) if (v < lo) lo = v;
  }
  if (hi - lo < 1e-9) {
    hi = 1;
    lo = -1;
  }
  const pad = 12;
  const span = bottom - top - 2 * pad;
  const yOf = (v: number) =>
    d.downIsPositive ? top + pad + ((v - lo) / (hi - lo)) * span : bottom - pad - ((v - lo) / (hi - lo)) * span;
  const y0 = yOf(0);
  const { sx } = lay;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(lay.x0, top, lay.x1 - lay.x0, bottom - top);

  // Name & unit in the left margin
  ctx.fillStyle = d.color;
  ctx.font = `bold 12px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(d.name, 10, (top + bottom) / 2 - 7);
  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.fillText(d.unit, 10, (top + bottom) / 2 + 8);

  // Filled area
  ctx.beginPath();
  ctx.moveTo(sx(d.xs[0]), y0);
  for (let i = 0; i < d.xs.length; i++) ctx.lineTo(sx(d.xs[i]), yOf(d.values[i]));
  ctx.lineTo(sx(d.xs[d.xs.length - 1]), y0);
  ctx.closePath();
  ctx.fillStyle = d.fill;
  ctx.fill();

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lay.x0, y0);
  ctx.lineTo(lay.x1, y0);
  ctx.stroke();

  if (d.envelope) {
    ctx.strokeStyle = BEAM_COLORS.envelope;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    const branches: number[][] = [];
    if (Math.max(...d.envelope.hi) > 1e-9) branches.push(d.envelope.hi); // sagging envelope
    if (Math.min(...d.envelope.lo) < -1e-9) branches.push(d.envelope.lo); // hogging envelope
    for (const arr of branches) {
      ctx.beginPath();
      for (let i = 0; i < d.envelope.xs.length; i++) {
        const px = sx(d.envelope.xs[i]);
        const py = yOf(arr[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = d.color;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(sx(d.xs[0]), y0);
  for (let i = 0; i < d.xs.length; i++) ctx.lineTo(sx(d.xs[i]), yOf(d.values[i]));
  ctx.lineTo(sx(d.xs[d.xs.length - 1]), y0);
  ctx.stroke();

  // Label the extremes
  let iMax = 0;
  let iMin = 0;
  for (let i = 1; i < d.values.length; i++) {
    if (d.values[i] > d.values[iMax]) iMax = i;
    if (d.values[i] < d.values[iMin]) iMin = i;
  }
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#e2e8f0';
  const pc = sx(cutX);
  const tag = (i: number, above: boolean) => {
    const v = d.values[i];
    if (Math.abs(v) < 0.02 * (hi - lo)) return;
    const px = sx(d.xs[i]);
    if (Math.abs(px - pc) < 40) return; // the cut read-out already shows it
    const py = yOf(v);
    ctx.textAlign = px > lay.x1 - 50 ? 'right' : px < lay.x0 + 50 ? 'left' : 'center';
    ctx.textBaseline = above ? 'bottom' : 'top';
    ctx.fillText(fmtSigned(v, d.digits), px, py + (above ? -3 : 3));
  };
  const positiveUp = !d.downIsPositive;
  tag(iMax, positiveUp);
  if (iMin !== iMax) tag(iMin, !positiveUp);

  // Value at the section cut
  const yc = yOf(d.cutValue);
  ctx.fillStyle = d.color;
  ctx.beginPath();
  ctx.arc(pc, yc, 3.2, 0, Math.PI * 2);
  ctx.fill();
  const text = fmtSigned(d.cutValue, d.digits);
  ctx.font = `bold 10px ${MONO}`;
  const tw = ctx.measureText(text).width + 8;
  const left = pc + 8 + tw > lay.x1;
  const bx = left ? pc - 8 - tw : pc + 8;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
  ctx.fillRect(bx, top + 3, tw, 15);
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + 4, top + 10.5);
}

function drawAxis(ctx: CanvasRenderingContext2D, lay: BeamLayout, L: number) {
  const y = lay.axisY + 4;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lay.x0, y);
  ctx.lineTo(lay.x1, y);
  ctx.stroke();
  const steps = [0.25, 0.5, 1, 2, 5];
  const step = steps.find((s) => s * lay.pxPerM >= 46) ?? 5;
  ctx.fillStyle = '#64748b';
  ctx.font = `9.5px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 0; x <= L + 1e-9; x += step) {
    const px = lay.sx(x);
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + 4);
    ctx.stroke();
    ctx.fillText(step < 1 ? x.toFixed(2) : x.toFixed(0), px, y + 6);
  }
  ctx.textAlign = 'left';
  ctx.fillText('x [m]', 10, y + 6);
}

export function drawBeamLab(ctx: CanvasRenderingContext2D, lay: BeamLayout, f: BeamFrame) {
  const { sol } = f;
  const m = sol.model;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, lay.width, lay.height);

  // Header
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = '#fdba74';
  const head = `${SUPPORT_LABEL[m.params.support]} · L = ${m.L.toFixed(2)} m`;
  ctx.fillText(head, 14, 16);
  const hw = ctx.measureText(head).width;
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = '#94a3b8';
  if (lay.width > 620) {
    ctx.fillText(` · ${m.section.label} h = ${(m.section.depth * 1e3).toFixed(0)} mm · ${m.material.name}`, 14 + hw, 16);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = f.locked ? '#fbbf24' : '#64748b';
  ctx.fillText(`deflection drawn ×${f.deflScale.toLocaleString()}${f.locked ? ' (locked)' : ''}`, lay.width - 30, 16);

  drawLegend(ctx, lay, f);
  drawBeamBody(ctx, lay, f);
  drawLoadsAndSupports(ctx, lay, f);

  // Hint line under the header (skipped when the legend would cover it)
  if (lay.width >= 720) {
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      f.rolling
        ? 'Rolling load · dashed violet in M(x) = moment envelope (extreme M at each x so far)'
        : 'Drag the P arrow to move the load · drag elsewhere to move cut A–A · ▶ rolls the load',
      14,
      31,
    );
  }

  // Diagrams
  const xs = sol.stations.map((s) => s.x);
  drawDiagram(ctx, lay, f.cutX, {
    zone: lay.vZone,
    xs,
    values: sol.stations.map((s) => s.V / 1e3),
    color: BEAM_COLORS.shear,
    fill: 'rgba(251, 113, 133, 0.16)',
    name: 'V(x)',
    unit: 'kN',
    digits: 1,
    cutValue: shearAt(m, f.cutX) / 1e3,
  });
  drawDiagram(ctx, lay, f.cutX, {
    zone: lay.mZone,
    xs,
    values: sol.stations.map((s) => s.M / 1e3),
    color: BEAM_COLORS.moment,
    fill: 'rgba(167, 139, 250, 0.18)',
    name: 'M(x)',
    unit: 'kN·m',
    digits: 1,
    envelope: f.envelope
      ? { xs: f.envelope.xs, hi: f.envelope.hi.map((v) => v / 1e3), lo: f.envelope.lo.map((v) => v / 1e3) }
      : null,
    cutValue: momentAt(m, f.cutX) / 1e3,
  });
  drawDiagram(ctx, lay, f.cutX, {
    zone: lay.wZone,
    xs,
    values: sol.stations.map((s) => s.w * 1e3),
    color: BEAM_COLORS.deflection,
    fill: 'rgba(56, 189, 248, 0.14)',
    name: 'w(x)',
    unit: 'mm ↓',
    digits: 2,
    downIsPositive: true,
    cutValue: deflectionAt(m, f.cutX) * 1e3,
  });
  drawAxis(ctx, lay, m.L);

  // Section cut A–A through everything
  const pc = lay.sx(f.cutX);
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pc, lay.beamY - lay.halfDepthPx - 30);
  ctx.lineTo(pc, lay.axisY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `bold 10px ${MONO}`;
  const tagLeft = pc > lay.x1 - 40;
  ctx.textAlign = tagLeft ? 'right' : 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('A–A', pc + (tagLeft ? -5 : 5), lay.beamZone[1] - 4);
}

function sectionPath(ctx: CanvasRenderingContext2D, sec: CrossSection, cx: number, cy: number, s: number) {
  const h = sec.depth * s;
  const B = sec.width * s;
  const tf = sec.flangeThickness * s;
  const tw = sec.webThickness * s;
  ctx.beginPath();
  if (sec.type === 'rectangular') {
    ctx.rect(cx - B / 2, cy - h / 2, B, h);
  } else if (sec.type === 'i-beam') {
    ctx.moveTo(cx - B / 2, cy - h / 2);
    ctx.lineTo(cx + B / 2, cy - h / 2);
    ctx.lineTo(cx + B / 2, cy - h / 2 + tf);
    ctx.lineTo(cx + tw / 2, cy - h / 2 + tf);
    ctx.lineTo(cx + tw / 2, cy + h / 2 - tf);
    ctx.lineTo(cx + B / 2, cy + h / 2 - tf);
    ctx.lineTo(cx + B / 2, cy + h / 2);
    ctx.lineTo(cx - B / 2, cy + h / 2);
    ctx.lineTo(cx - B / 2, cy + h / 2 - tf);
    ctx.lineTo(cx - tw / 2, cy + h / 2 - tf);
    ctx.lineTo(cx - tw / 2, cy - h / 2 + tf);
    ctx.lineTo(cx - B / 2, cy - h / 2 + tf);
    ctx.closePath();
  } else if (sec.type === 'hollow-box') {
    ctx.rect(cx - B / 2, cy - h / 2, B, h);
    ctx.rect(cx - B / 2 + tf, cy - h / 2 + tf, B - 2 * tf, h - 2 * tf);
  } else {
    ctx.arc(cx, cy, h / 2, 0, Math.PI * 2);
    ctx.moveTo(cx + h / 2 - tf, cy);
    ctx.arc(cx, cy, h / 2 - tf, 0, Math.PI * 2);
  }
}

/** Cross-section at the cut with σ(y), τ(y) and utilization profiles drawn to the same height scale. */
export function drawSectionInspector(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sol: BeamSolution,
  cutX: number,
  mode: StressFieldMode,
) {
  const m = sol.model;
  const sec = m.section;
  const mat = m.material;
  const M = momentAt(m, cutX);
  const V = shearAt(m, cutX);
  const narrow = width < 560; // phones: V and M on their own row, short panel titles
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  ctx.font = `bold 11px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`SECTION A–A · x = ${cutX.toFixed(2)} m`, 12, 14);
  ctx.font = `11px ${MONO}`;
  const vText = `V = ${fmtSigned(V / 1e3, 1)} kN`;
  const mText = `M = ${fmtSigned(M / 1e3, 1)} kN·m`;
  if (narrow) {
    ctx.fillStyle = BEAM_COLORS.shear;
    ctx.fillText(vText, 12, 30);
    ctx.fillStyle = BEAM_COLORS.moment;
    ctx.fillText(mText, 12 + ctx.measureText(vText).width + 14, 30);
  } else {
    ctx.textAlign = 'right';
    ctx.fillStyle = BEAM_COLORS.shear;
    ctx.fillText(vText, width - 12 - ctx.measureText(mText).width - 14, 14);
    ctx.fillStyle = BEAM_COLORS.moment;
    ctx.fillText(mText, width - 12, 14);
  }

  const titleY = narrow ? 48 : 32;
  const top = titleY + 14;
  const bottom = height - 30;
  const secW = clamp(width * 0.2, 96, 170);
  const c = sec.depth / 2;
  const s = Math.min((bottom - top) / sec.depth, (secW - 20) / sec.width);
  const cy = (top + bottom) / 2;
  const cx = 12 + secW / 2;
  const pyOf = (y: number) => cy + y * s;
  const rows = 64;
  const rowH = (2 * c * s) / rows;
  const scale: FieldScale = { sigma: sol.maxSigmaMPa, tau: sol.maxTauMPa };
  const samples: { y: number; st: PointStress }[] = [];
  for (let j = 0; j < rows; j++) {
    const y = -c + ((j + 0.5) / rows) * 2 * c;
    samples.push({ y, st: stressAt(M, V, sec, mat, y) });
  }

  // Section shape filled with the active field
  ctx.save();
  sectionPath(ctx, sec, cx, cy, s);
  ctx.clip('evenodd');
  for (const { y, st } of samples) {
    ctx.fillStyle = fieldColor(mode, st, scale);
    ctx.fillRect(cx - (sec.width * s) / 2 - 1, pyOf(y) - rowH / 2, sec.width * s + 2, rowH + 0.6);
  }
  ctx.restore();
  sectionPath(ctx, sec, cx, cy, s);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Neutral axis across all panels
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.3)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - (sec.width * s) / 2 - 8, cy);
  ctx.lineTo(width - 12, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#64748b';
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N.A.', 12, cy - 2);

  // Profiles
  const px0 = 12 + secW + 14;
  const gap = 16;
  const panelW = (width - 12 - px0 - 2 * gap) / 3;
  const panels = [
    {
      title: narrow ? 'σ' : 'BENDING σ = My/I',
      unit: 'MPa',
      signed: true,
      max: Math.max(1e-9, sol.maxSigmaMPa),
      value: (st: PointStress) => st.sigma,
      color: (st: PointStress) => (st.sigma >= 0 ? BEAM_COLORS.tension : BEAM_COLORS.compression),
    },
    {
      title: narrow ? '|τ|' : 'SHEAR τ = VQ/(I·b)',
      unit: 'MPa',
      signed: false,
      max: Math.max(1e-9, sol.maxTauMPa),
      value: (st: PointStress) => Math.abs(st.tau),
      color: () => BEAM_COLORS.tau,
    },
    {
      title: narrow ? 'U' : mat.criterion === 'timber' ? 'U = max(|σ|/f_m, |τ|/f_v)' : 'U = σ_vm / σ_y',
      unit: '',
      signed: false,
      max: Math.max(1.15, sol.maxUtil * 1.05),
      value: (st: PointStress) => st.util,
      color: (st: PointStress) => (st.util >= 1 ? '#fff1f2' : thermalColor(st.util)),
    },
  ];

  panels.forEach((p, k) => {
    const left = px0 + k * (panelW + gap);
    const zeroX = p.signed ? left + panelW / 2 : left + 6;
    const span = p.signed ? panelW / 2 - 8 : panelW - 14;
    const xOf = (v: number) => zeroX + (v / p.max) * span;

    ctx.fillStyle = '#94a3b8';
    ctx.font = `bold 9.5px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.title, left, titleY);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(left, top - 4, panelW, bottom - top + 8);

    for (const { y, st } of samples) {
      const v = p.value(st);
      const xa = Math.min(zeroX, xOf(v));
      ctx.fillStyle = p.color(st);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(xa, pyOf(y) - rowH / 2, Math.abs(xOf(v) - zeroX), rowH + 0.4);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zeroX, top - 4);
    ctx.lineTo(zeroX, bottom + 4);
    ctx.stroke();

    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = '#e2e8f0';
    if (k === 0) {
      // Extreme-fibre stresses ±Mc/I at the top and bottom faces
      const fibre = (v: number, yPx: number, base: 'top' | 'bottom') => {
        ctx.textAlign = v >= 0 ? 'left' : 'right';
        ctx.textBaseline = base;
        ctx.fillText(fmtSigned(v, 1), v >= 0 ? left + 3 : left + panelW - 3, yPx);
      };
      fibre(stressAt(M, V, sec, mat, -c).sigma, top - 4, 'top');
      fibre(stressAt(M, V, sec, mat, c).sigma, bottom + 4, 'bottom');
    } else if (k === 1) {
      const t0 = Math.abs(stressAt(M, V, sec, mat, 0).tau);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(narrow ? t0.toFixed(2) : `${t0.toFixed(2)} at N.A.`, left + panelW - 2, cy - 3);
    } else {
      const limX = xOf(1);
      ctx.strokeStyle = 'rgba(251, 113, 133, 0.8)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(limX, top - 4);
      ctx.lineTo(limX, bottom + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fda4af';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.font = `9px ${MONO}`;
      ctx.fillText('limit', limX - 3, top - 2);
      let uMax = 0;
      for (const { st } of samples) uMax = Math.max(uMax, st.util);
      for (const y of [-c, c]) uMax = Math.max(uMax, stressAt(M, V, sec, mat, y).util);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(narrow ? uMax.toFixed(2) : `max ${uMax.toFixed(2)} here`, left + panelW - 2, bottom + 4);
    }
    if (p.unit) {
      ctx.fillStyle = '#475569';
      ctx.font = `9px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.unit, left + panelW, titleY);
    }
  });

  // Footer: section properties
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const props = `${narrow ? '' : `${sec.label} · `}A = ${(sec.area * 1e4).toFixed(0)} cm² · I = ${Math.round(sec.I * 1e8).toLocaleString()} cm⁴ · S = ${Math.round(sec.S * 1e6).toLocaleString()} cm³${narrow ? '' : ` · ${sol.massPerLengthKgM.toFixed(1)} kg/m · E = ${mat.youngsModulusGPa} GPa`}`;
  ctx.fillText(props, 12, height - 11);
}
