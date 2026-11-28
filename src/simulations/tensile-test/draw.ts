import { clamp, thermalColor } from '../../engine/math';
import {
  SLICES,
  considereStrain,
  neckIndex,
  sliceArea,
  type CurvePoint,
  type TensileTest,
  type TestResults,
} from './physics';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BG = '#070b14';

export const TCOLORS = {
  engineering: '#fb7185',
  trueStress: '#a78bfa',
  bridgman: '#f472b6',
  toughness: 'rgba(245, 158, 11, 0.12)',
  resilience: 'rgba(52, 211, 153, 0.28)',
  yield: '#34d399',
  uts: '#f59e0b',
  offset: '#fbbf24',
  elasticLine: '#94a3b8',
} as const;

export interface Overlay {
  key: string;
  label: string;
  color: string;
  points: { e: number; s: number }[];
}

export interface ChartRange {
  eMax: number; // engineering strain axis (fraction)
  sMax: number; // stress axis [MPa]
}

export interface TensileFrame {
  test: TensileTest;
  results: TestResults;
  range: ChartRange;
  overlays: Overlay[];
  showTrue: boolean;
  showEnergy: boolean;
  phase: string;
  /** Longest gauge length expected before fracture [mm], to fit the machine drawing. */
  maxGaugeLength: number;
}

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

function fmtPct(e: number): string {
  const v = e * 100;
  return v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0);
}

/** Colour of a slice from its plastic strain relative to the fracture strain. */
function sliceColor(ep: number, fractureStrain: number): string {
  if (ep < 2e-4) return '#64748b';
  return thermalColor(clamp(0.12 + 0.88 * (ep / Math.max(0.05, fractureStrain)), 0, 1));
}

// ---------------------------------------------------------------------------------------------
// Testing machine and specimen
// ---------------------------------------------------------------------------------------------

interface SliceGeom {
  y0: number; // bottom (canvas y)
  y1: number; // top
  r: number; // radius [px]
}

function drawMachine(ctx: CanvasRenderingContext2D, x0: number, w: number, h: number, f: TensileFrame) {
  const t = f.test;
  const d0 = t.params.diameter;
  const Lg = 1.0 * d0; // grip section shown
  const Ls = 0.75 * d0; // shoulder
  const dGrip = 1.6 * d0;
  const cx = x0 + w * 0.46;
  const top = 64;
  const base = h - 26;
  const k = Math.min((base - top - 30) / (2 * (Lg + Ls) + f.maxGaugeLength + 8), (w * 0.42) / dGrip);

  // Slice lengths and radii (unloaded halves after fracture)
  const slices: SliceGeom[] = [];
  const gap = t.fractured ? 12 : 0;
  let y = base - (Lg + Ls) * k;
  const fi = t.fractureIndex;
  for (let i = 0; i < SLICES; i++) {
    const A = sliceArea(t, i);
    const sigma = t.fractured ? 0 : t.F / A;
    const len = t.l0[i] * Math.exp(t.ep[i] + sigma / t.mat.E) * k;
    const r = Math.sqrt(A / Math.PI) * k;
    if (t.fractured && i === fi) {
      // Split the broken slice: half stays below, half moves up with the top piece.
      slices.push({ y0: y, y1: y - len / 2, r });
      y -= len / 2 + gap;
      slices.push({ y0: y, y1: y - len / 2, r });
      y -= len / 2;
    } else {
      slices.push({ y0: y, y1: y - len, r });
      y -= len;
    }
  }
  const gaugeTop = y;
  const gaugeBottom = base - (Lg + Ls) * k;
  const rGrip = (dGrip / 2) * k;

  // Machine frame: two columns, the fixed base and the moving crosshead
  const crossY = gaugeTop - (Lg + Ls) * k - 34;
  ctx.fillStyle = '#111827';
  ctx.fillRect(x0 + 8, crossY - 6, 10, base + 18 - crossY);
  ctx.fillRect(x0 + w - 18, crossY - 6, 10, base + 18 - crossY);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x0 + 4, base + 8, w - 8, 14);
  ctx.fillStyle = '#334155';
  ctx.fillRect(x0 + 4, crossY - 8, w - 8, 14);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 4, crossY - 8, w - 8, 14);
  // Load cell between crosshead and top grip
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#64748b';
  ctx.fillRect(cx - 16, crossY + 6, 32, 12);
  ctx.strokeRect(cx - 16, crossY + 6, 32, 12);

  // Specimen outline: grips and shoulders are rigid, the gauge slices deform.
  const metal = ctx.createLinearGradient(cx - rGrip, 0, cx + rGrip, 0);
  metal.addColorStop(0, '#475569');
  metal.addColorStop(0.45, '#94a3b8');
  metal.addColorStop(1, '#334155');

  const end = (yGaugeEnd: number, rGauge: number, dir: 1 | -1) => {
    // dir = 1: bottom end (grip below), −1: top end (grip above)
    const yShoulderEnd = yGaugeEnd + dir * Ls * k;
    const yGripEnd = yShoulderEnd + dir * (Lg * k + 8);
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.moveTo(cx - rGauge, yGaugeEnd);
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const r = rGauge + (rGrip - rGauge) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      ctx.lineTo(cx - r, yGaugeEnd + dir * u * Ls * k);
    }
    ctx.lineTo(cx - rGrip, yGripEnd);
    ctx.lineTo(cx + rGrip, yGripEnd);
    for (let s = steps; s >= 0; s--) {
      const u = s / steps;
      const r = rGauge + (rGrip - rGauge) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      ctx.lineTo(cx + r, yGaugeEnd + dir * u * Ls * k);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
    ctx.stroke();
    // Wedge-grip jaws
    const jawTop = Math.min(yShoulderEnd, yGripEnd);
    const jawH = Math.abs(yGripEnd - yShoulderEnd) + 2;
    ctx.fillStyle = '#1f2937';
    ctx.strokeStyle = '#475569';
    for (const side of [-1, 1]) {
      const jx = side < 0 ? cx - rGrip - 14 : cx + rGrip;
      ctx.fillRect(jx, jawTop - 2, 14, jawH + 2);
      ctx.strokeRect(jx, jawTop - 2, 14, jawH + 2);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      for (let yy = jawTop + 2; yy < jawTop + jawH - 2; yy += 4) {
        ctx.beginPath();
        ctx.moveTo(side < 0 ? jx + 14 : jx, yy);
        ctx.lineTo(side < 0 ? jx + 10 : jx + 4, yy + 2);
        ctx.stroke();
      }
      ctx.strokeStyle = '#475569';
    }
  };

  const rAt = (i: number) => slices[Math.max(0, Math.min(slices.length - 1, i))].r;
  end(gaugeBottom, rAt(0), 1);
  end(gaugeTop, rAt(slices.length - 1), -1);

  // Gauge slices coloured by plastic strain
  const fStrain = t.mat.brittle ? 1 : t.mat.fractureStrain;
  slices.forEach((s, j) => {
    const i = t.fractured && j > fi ? j - 1 : j;
    const rb = j === 0 || (t.fractured && j === fi + 1) ? s.r : 0.5 * (s.r + slices[j - 1].r);
    const rt = j === slices.length - 1 || (t.fractured && j === fi) ? s.r : 0.5 * (s.r + slices[j + 1].r);
    ctx.fillStyle = sliceColor(t.ep[i], fStrain);
    ctx.beginPath();
    ctx.moveTo(cx - rb, s.y0 + 0.4);
    ctx.lineTo(cx + rb, s.y0 + 0.4);
    ctx.lineTo(cx + rt, s.y1 - 0.4);
    ctx.lineTo(cx - rt, s.y1 - 0.4);
    ctx.closePath();
    ctx.fill();
  });
  // Gauge outline
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
  ctx.lineWidth = 1.1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    slices.forEach((s, j) => {
      const px = cx + side * s.r;
      if (j === 0 || (t.fractured && j === fi + 1)) ctx.moveTo(px, s.y0);
      else ctx.lineTo(px, s.y0);
      ctx.lineTo(px, s.y1);
    });
    ctx.stroke();
  }

  // Fracture surfaces
  if (t.fractured) {
    const lower = slices[fi];
    const upper = slices[fi + 1];
    ctx.fillStyle = BG;
    if (t.mat.brittle) {
      ctx.strokeStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(cx - lower.r, lower.y1);
      for (let s = 1; s <= 6; s++) ctx.lineTo(cx - lower.r + (s / 6) * 2 * lower.r, lower.y1 + (s % 2 ? -1.5 : 1));
      ctx.stroke();
    } else {
      // Cup (lower piece) and cone (upper piece)
      const depth = Math.min(6, lower.r * 0.35);
      ctx.beginPath();
      ctx.moveTo(cx - lower.r, lower.y1 - 1);
      ctx.lineTo(cx - lower.r * 0.45, lower.y1 + depth);
      ctx.lineTo(cx + lower.r * 0.45, lower.y1 + depth);
      ctx.lineTo(cx + lower.r, lower.y1 - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = sliceColor(t.ep[fi], fStrain);
      ctx.beginPath();
      ctx.moveTo(cx - upper.r, upper.y0);
      ctx.lineTo(cx - upper.r * 0.45, upper.y0 + depth);
      ctx.lineTo(cx + upper.r * 0.45, upper.y0 + depth);
      ctx.lineTo(cx + upper.r, upper.y0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#fda4af';
    ctx.font = `bold 10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.mat.brittle ? 'brittle fracture' : 'cup & cone', cx + lower.r + 6, (lower.y1 + upper.y0) / 2);
  }

  // Extensometer arms at the gauge marks
  const ex = cx - rGrip - 26;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.3;
  for (const [yy, r] of [
    [gaugeBottom, rAt(0)],
    [gaugeTop, rAt(slices.length - 1)],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(ex, yy);
    ctx.lineTo(cx - r - 1, yy);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(ex, gaugeBottom);
  ctx.lineTo(ex, gaugeTop);
  ctx.stroke();

  // Read-outs
  const totalLength = slices.reduce((acc, s) => acc + (s.y0 - s.y1), 0) / k;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillStyle = '#fda4af';
  ctx.fillText(`F = ${(t.F / 1e3).toFixed(2)} kN`, x0 + 10, 18);
  ctx.font = `10.5px ${MONO}`;
  ctx.fillStyle = '#7dd3fc';
  const dL = Math.abs(totalLength - t.L0) < 5e-4 ? 0 : totalLength - t.L0;
  ctx.fillText(`ΔL = ${dL.toFixed(dL < 0.01 * t.L0 ? 3 : 2)} mm`, x0 + 10, 36);
  const iNeck = neckIndex(t);
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`d_min = ${(2 * Math.sqrt(sliceArea(t, iNeck) / Math.PI)).toFixed(2)} mm`, x0 + 10, 51);
}

// ---------------------------------------------------------------------------------------------
// Stress–strain chart
// ---------------------------------------------------------------------------------------------

interface PlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  sx: (e: number) => number;
  sy: (s: number) => number;
}

function axes(ctx: CanvasRenderingContext2D, b: PlotBox, eMax: number, sMax: number, xLabel: string, yLabel: string, compact: boolean) {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  ctx.font = `${compact ? 9 : 9.5}px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.lineWidth = 1;
  const sStep = niceStep(sMax, compact ? 4 : 6);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let s = 0; s <= sMax + 1e-9; s += sStep) {
    const y = b.sy(s);
    ctx.beginPath();
    ctx.moveTo(b.left, y);
    ctx.lineTo(b.right, y);
    ctx.stroke();
    ctx.fillText(s.toFixed(0), b.left - 5, y);
  }
  const eStep = niceStep(eMax * 100, compact ? 4 : 7) / 100;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let e = 0; e <= eMax + 1e-12; e += eStep) {
    const x = b.sx(e);
    ctx.beginPath();
    ctx.moveTo(x, b.top);
    ctx.lineTo(x, b.bottom);
    ctx.stroke();
    ctx.fillText(eStep < 0.01 ? (e * 100).toFixed(2) : eStep < 0.1 ? (e * 100).toFixed(1) : (e * 100).toFixed(0), x, b.bottom + 4);
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
  ctx.fillText(xLabel, b.right, b.bottom + 16);
  ctx.save();
  ctx.translate(b.left - (compact ? 30 : 38), (b.top + b.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function polyline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

function marker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, align: 'left' | 'right', dy = -10) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold 10px ${MONO}`;
  const tw = ctx.measureText(label).width + 8;
  const bx = align === 'left' ? x + 7 : x - 7 - tw;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
  ctx.fillRect(bx, y + dy - 7.5, tw, 15);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + 4, y + dy);
}

function drawChart(ctx: CanvasRenderingContext2D, x0: number, w: number, h: number, f: TensileFrame) {
  const { test: t, results: r, range } = f;
  const compact = w < 360;
  const b0 = { left: x0 + (compact ? 40 : 54), right: x0 + w - 14, top: 36, bottom: h - 38 };
  const box: PlotBox = {
    ...b0,
    sx: (e: number) => b0.left + (e / range.eMax) * (b0.right - b0.left),
    sy: (s: number) => b0.bottom - (s / range.sMax) * (b0.bottom - b0.top),
  };
  axes(ctx, box, range.eMax, range.sMax, f.showTrue ? 'strain: engineering e or true ε (%)' : 'engineering strain e = ΔL/L₀ (%)', 'stress (MPa)', compact);

  // Status line
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = '#fdba74';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(f.phase, box.left, 14);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top - 2, box.right - box.left + 2, box.bottom - box.top + 2);
  ctx.clip();

  // Earlier tests
  for (const o of f.overlays) {
    ctx.strokeStyle = o.color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    polyline(ctx, o.points.map((p) => ({ x: box.sx(p.e), y: box.sy(p.s) })));
    ctx.globalAlpha = 1;
  }

  const h0 = t.history;
  // Toughness: area under the engineering curve
  if (f.showEnergy && h0.length > 1) {
    ctx.fillStyle = TCOLORS.toughness;
    ctx.beginPath();
    ctx.moveTo(box.sx(0), box.sy(0));
    for (const p of h0) ctx.lineTo(box.sx(p.e), box.sy(p.s));
    ctx.lineTo(box.sx(h0[h0.length - 1].e), box.sy(0));
    ctx.closePath();
    ctx.fill();
  }

  if (f.showTrue) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = TCOLORS.bridgman;
    ctx.setLineDash([2, 3]);
    const live = t.fractured ? h0.slice(0, -1) : h0;
    polyline(ctx, live.map((p) => ({ x: box.sx(p.et), y: box.sy(p.sb) })));
    ctx.strokeStyle = TCOLORS.trueStress;
    ctx.setLineDash([6, 4]);
    polyline(ctx, live.map((p) => ({ x: box.sx(p.et), y: box.sy(p.st) })));
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = TCOLORS.engineering;
  ctx.lineWidth = 2.2;
  polyline(ctx, h0.map((p) => ({ x: box.sx(p.e), y: box.sy(p.s) })));
  ctx.restore();

  // Overlay labels at the end of each curve
  ctx.font = `10px ${MONO}`;
  for (const o of f.overlays) {
    const last = o.points[o.points.length - 2] ?? o.points[o.points.length - 1];
    if (!last) continue;
    const px = Math.min(box.right - 4, box.sx(last.e) + 4);
    ctx.fillStyle = o.color;
    ctx.textAlign = px > box.right - 70 ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(o.label, px, box.sy(last.s) - 4);
  }

  // Key points
  const near = (s: number) => {
    let best = h0[0];
    for (const p of h0) if (Math.abs(p.s - s) < Math.abs(best.s - s) && p.e <= r.utsStrain + 1e-12) best = p;
    return best;
  };
  if (r.yieldStrength !== null) {
    const p = near(r.yieldStrength);
    marker(ctx, box.sx(p.e), box.sy(r.yieldStrength), TCOLORS.yield, `σ_y ${r.yieldStrength.toFixed(0)}`, 'left', 14);
  }
  if (r.necked) {
    marker(ctx, box.sx(r.utsStrain), box.sy(r.uts), TCOLORS.uts, compact ? `UTS ${r.uts.toFixed(0)}` : `UTS ${r.uts.toFixed(0)} · necking starts`, r.utsStrain / range.eMax > 0.55 ? 'right' : 'left', -14);
  }
  if (t.fractured) {
    const p = h0[h0.length - 2];
    const x = box.sx(p.e);
    const y = box.sy(p.s);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5);
    ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 5, y - 5);
    ctx.lineTo(x - 5, y + 5);
    ctx.stroke();
  } else if (h0.length > 1) {
    const p = h0[h0.length - 1];
    ctx.fillStyle = '#fff1f2';
    ctx.beginPath();
    ctx.arc(box.sx(p.e), box.sy(p.s), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 113, 133, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(box.sx(p.e), box.sy(p.s), 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Legend
  const items: [string, string, number[]][] = [['engineering σ = F/A₀', TCOLORS.engineering, []]];
  if (f.showTrue) {
    items.push(['true σ = F/A at the neck', TCOLORS.trueStress, [6, 4]]);
    items.push(['Bridgman-corrected flow stress', TCOLORS.bridgman, [2, 3]]);
  }
  if (f.showEnergy) items.push(['area = toughness ∫σ de', '#f59e0b', []]);
  ctx.font = `10px ${MONO}`;
  let ly = box.top + 12;
  for (const [label, color, dash] of items) {
    if (compact && label.startsWith('area')) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(box.left + 10, ly);
    ctx.lineTo(box.left + 30, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, box.left + 36, ly);
    ly += 15;
  }
}

export function drawTensileLab(ctx: CanvasRenderingContext2D, width: number, height: number, f: TensileFrame) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  const panel = width < 600 ? clamp(width * 0.34, 112, 170) : clamp(width * 0.3, 200, 270);
  drawMachine(ctx, 0, panel, height, f);
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(panel + 0.5, 8);
  ctx.lineTo(panel + 0.5, height - 8);
  ctx.stroke();
  drawChart(ctx, panel, width - panel, height, f);
}

// ---------------------------------------------------------------------------------------------
// Elastic-region zoom with the 0.2 % offset construction
// ---------------------------------------------------------------------------------------------

export function drawElasticZoom(ctx: CanvasRenderingContext2D, width: number, height: number, f: TensileFrame) {
  const { test: t, results: r } = f;
  const mat = t.mat;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  const ref = mat.brittle ? (mat.fractureStress ?? 1) : Math.max(mat.upperYield ?? 0, mat.yield0);
  const eMax = mat.brittle ? (1.25 * ref) / mat.E : Math.max(0.004, (2.2 * ref) / mat.E + 0.0025);
  let sTop = ref;
  for (const p of t.history) if (p.e <= eMax && p.s > sTop) sTop = p.s;
  const sMax = sTop * 1.18;
  const compact = width < 340;
  const b0 = { left: compact ? 40 : 50, right: width - 12, top: 30, bottom: height - 34 };
  const box: PlotBox = {
    ...b0,
    sx: (e: number) => b0.left + (e / eMax) * (b0.right - b0.left),
    sy: (s: number) => b0.bottom - (s / sMax) * (b0.bottom - b0.top),
  };
  ctx.font = `bold 10.5px ${MONO}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(mat.brittle ? 'ELASTIC TO FRACTURE' : 'ELASTIC REGION & YIELD', 10, 14);
  axes(ctx, box, eMax, sMax, 'e (%)', 'σ (MPa)', true);

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.clip();

  const E = r.E ?? mat.E;
  // Resilience: elastic energy stored up to yield (or fracture)
  const sy = mat.brittle ? (t.fractured ? r.uts : null) : r.yieldStrength;
  if (f.showEnergy && sy !== null) {
    ctx.fillStyle = TCOLORS.resilience;
    ctx.beginPath();
    ctx.moveTo(box.sx(0), box.sy(0));
    ctx.lineTo(box.sx(sy / E), box.sy(sy));
    ctx.lineTo(box.sx(sy / E), box.sy(0));
    ctx.closePath();
    ctx.fill();
  }
  // Elastic line and the 0.2 % offset line
  ctx.strokeStyle = TCOLORS.elasticLine;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  polyline(ctx, [
    { x: box.sx(0), y: box.sy(0) },
    { x: box.sx(sMax / E), y: box.sy(sMax) },
  ]);
  if (!mat.brittle && mat.upperYield === undefined) {
    ctx.strokeStyle = TCOLORS.offset;
    polyline(ctx, [
      { x: box.sx(0.002), y: box.sy(0) },
      { x: box.sx(0.002 + sMax / E), y: box.sy(sMax) },
    ]);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = TCOLORS.engineering;
  ctx.lineWidth = 2;
  const pts = t.history.filter((p) => p.e <= eMax * 1.02);
  polyline(ctx, pts.map((p) => ({ x: box.sx(p.e), y: box.sy(p.s) })));
  ctx.restore();

  ctx.font = `10px ${MONO}`;
  if (!mat.brittle && mat.upperYield === undefined) {
    ctx.fillStyle = TCOLORS.offset;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0.2 % offset', box.sx(0.002) + 4, box.bottom - 3);
  }
  if (r.yieldStrength !== null && !mat.brittle) {
    const label = r.offsetYield ? `σ₀.₂ = ${r.yieldStrength.toFixed(0)} MPa` : `lower yield ${r.yieldStrength.toFixed(0)}`;
    const xMark = r.offsetYield ? box.sx(0.002 + r.yieldStrength / E) : box.sx(Math.min(eMax * 0.75, 0.006));
    marker(ctx, xMark, box.sy(r.yieldStrength), TCOLORS.yield, label, xMark > box.right - 130 ? 'right' : 'left', 13);
  }
  if (r.upperYield !== null && r.yieldStrength !== null) {
    let pk = t.history[0];
    for (const p of t.history) if (p.e < eMax && p.s > pk.s && p.e < 0.006) pk = p;
    marker(ctx, box.sx(pk.e), box.sy(pk.s), '#7dd3fc', `upper yield ${r.upperYield.toFixed(0)}`, 'left', -12);
  }
  if (f.showEnergy && r.resilience !== null) {
    ctx.fillStyle = '#6ee7b7';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const ur = r.resilience;
    ctx.fillText(`resilience U_r = σ²/2E = ${ur < 0.1 ? (ur * 1000).toFixed(0) + ' kJ/m³' : ur.toFixed(2) + ' MJ/m³'}`, box.right - 4, box.bottom - 3);
  }
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`slope E = ${(E / 1e3).toFixed(1)} GPa`, width - 12, 14);
}

// ---------------------------------------------------------------------------------------------
// Plastic strain along the gauge length
// ---------------------------------------------------------------------------------------------

export function drawStrainProfile(ctx: CanvasRenderingContext2D, width: number, height: number, f: TensileFrame) {
  const t = f.test;
  const mat = t.mat;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);
  ctx.font = `bold 10.5px ${MONO}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLASTIC STRAIN ALONG THE GAUGE', 10, 14);

  const fStrain = mat.brittle ? 0.05 : mat.fractureStrain;
  const yMax = Math.max(0.02, fStrain * 1.12);
  const b0 = { left: 40, right: width - 12, top: 30, bottom: height - 34 };
  const box: PlotBox = {
    ...b0,
    sx: (x: number) => b0.left + (x / t.L0) * (b0.right - b0.left),
    sy: (e: number) => b0.bottom - (e / yMax) * (b0.bottom - b0.top),
  };
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  const step = niceStep(yMax, 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let e = 0; e <= yMax + 1e-9; e += step) {
    ctx.beginPath();
    ctx.moveTo(box.left, box.sy(e));
    ctx.lineTo(box.right, box.sy(e));
    ctx.stroke();
    ctx.fillText(e.toFixed(step < 0.1 ? 2 : 1), box.left - 4, box.sy(e));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xStep = niceStep(t.L0, 5);
  for (let x = 0; x <= t.L0 + 1e-9; x += xStep) ctx.fillText(x.toFixed(0), box.sx(x), box.bottom + 4);
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText('position along the original gauge (mm)', box.right, box.bottom + 16);

  const barW = (box.right - box.left) / SLICES;
  for (let i = 0; i < SLICES; i++) {
    const e = t.ep[i];
    if (e <= 0) continue;
    ctx.fillStyle = sliceColor(e, mat.brittle ? 1 : fStrain);
    const y = box.sy(Math.min(e, yMax));
    ctx.fillRect(box.left + i * barW, y, barW + 0.5, box.bottom - y);
  }

  if (!mat.brittle) {
    const lines: [number, string, string][] = [
      [considereStrain(mat), 'necking starts (Considère)', '#fbbf24'],
      [fStrain, `fracture ε_f = ln(1/(1 − RA))`, '#fb7185'],
    ];
    if (mat.ludersStrain) lines.push([mat.ludersStrain, 'Lüders strain', '#7dd3fc']);
    ctx.font = `9.5px ${MONO}`;
    for (const [e, label, color] of lines) {
      const y = box.sy(e);
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(box.left, y);
      ctx.lineTo(box.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const tw = ctx.measureText(label).width + 6;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
      ctx.fillRect(box.left + 2, y - 14, tw, 12);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, box.left + 5, y - 2);
    }
  } else {
    ctx.fillStyle = '#f9a8d4';
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('no plastic strain: a ceramic breaks while still elastic', (box.left + box.right) / 2, (box.top + box.bottom) / 2);
  }
}

/** Downsampled copy of a curve for overlays (keeps the fracture drop). */
export function overlayPoints(history: CurvePoint[], maxPoints = 400): { e: number; s: number }[] {
  const stride = Math.max(1, Math.floor(history.length / maxPoints));
  const out: { e: number; s: number }[] = [];
  for (let i = 0; i < history.length; i += stride) out.push({ e: history[i].e, s: history[i].s });
  const tail = history.slice(-2);
  for (const p of tail) out.push({ e: p.e, s: p.s });
  return out;
}

export { fmtPct };
