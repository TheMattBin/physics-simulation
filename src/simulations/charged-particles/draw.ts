import { thermalColor } from '../../engine/math';
import {
  NEON_ISOTOPES,
  SELECTOR,
  SPECTROMETER,
  WORLD,
  driftVelocity,
  landingDistance,
  larmorRadius,
  selectedSpeed,
  speciesById,
  type FieldParams,
  type Particle,
} from './physics';

export const COLORS = {
  positive: '#fb7185',
  negative: '#38bdf8',
  bField: '#a78bfa',
  eField: '#f472b6',
  velocity: '#e2e8f0',
  detector: '#34d399',
  isotopes: ['#f59e0b', '#34d399', '#38bdf8'],
} as const;

const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const GHOST_FADE = 3e-6; // s of simulated time for a finished trail to fade out

export interface Ghost {
  trail: number[]; // flat x, y pairs (m)
  color: string;
  diedAt: number; // simulated time (s)
}

export interface BeamParticle {
  pt: Particle;
  trail: number[];
  color: string;
}

export interface Hit {
  y: number;
  speciesIndex: number;
}

/** Everything the renderer needs; owned and mutated by the component's animation loop. */
export interface Runtime {
  t: number;
  primary: Particle | null;
  twin: Particle | null;
  primaryTrail: number[];
  twinTrail: number[];
  beam: BeamParticle[];
  ghosts: Ghost[];
  hits: Hit[];
  transmitted: number;
}

export interface DrawFlags {
  showVectors: boolean;
  showTheory: boolean;
}

interface Transform {
  scale: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
}

export function chargeColor(q: number): string {
  return q >= 0 ? COLORS.positive : COLORS.negative;
}

/** Selector beams are coloured by launch speed: slow → blue, fast → coral. */
export function speedColor(speed: number): string {
  return thermalColor((speed - SELECTOR.speedMin) / (SELECTOR.speedMax - SELECTOR.speedMin));
}

function makeTransform(width: number, height: number): Transform {
  const padX = 14;
  const padTop = 50;
  const padBottom = 26;
  const scale = Math.min((width - 2 * padX) / WORLD.w, (height - padTop - padBottom) / WORLD.h);
  const left = (width - WORLD.w * scale) / 2;
  const bottom = padTop + WORLD.h * scale;
  return { scale, sx: (x) => left + x * scale, sy: (y) => bottom - y * scale };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  color: string,
  label?: string,
) {
  const len = Math.hypot(dx, dy);
  if (len < 3) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(8, len * 0.5);
  const half = head * 0.55;
  const ex = x0 + dx;
  const ey = y0 + dy;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(ex - ux * head * 0.8, ey - uy * head * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * head - uy * half, ey - uy * head + ux * half);
  ctx.lineTo(ex - ux * head + uy * half, ey - uy * head - ux * half);
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = `bold 11px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, ex + ux * 13, ey + uy * 13);
  }
}

interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** ⊙ (out of page) or ⊗ (into page) markers on a grid, opacity growing with |B|. */
function drawBField(ctx: CanvasRenderingContext2D, T: Transform, r: Region, bz: number, bRef: number) {
  if (Math.abs(bz) < 1e-6) return;
  const strength = Math.min(1, Math.abs(bz) / bRef);
  ctx.fillStyle = `rgba(167, 139, 250, ${0.035 + 0.05 * strength})`;
  ctx.fillRect(T.sx(r.x0), T.sy(r.y1), (r.x1 - r.x0) * T.scale, (r.y1 - r.y0) * T.scale);
  ctx.save();
  ctx.globalAlpha = 0.22 + 0.5 * strength;
  ctx.strokeStyle = COLORS.bField;
  ctx.fillStyle = COLORS.bField;
  ctx.lineWidth = 1;
  const step = 0.02;
  const rad = 3.6;
  for (let x = r.x0 + step / 2; x < r.x1; x += step) {
    for (let y = r.y0 + step / 2; y < r.y1; y += step) {
      const cx = T.sx(x);
      const cy = T.sy(y);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      if (bz > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, 1.1, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const d = rad * 0.65;
        ctx.beginPath();
        ctx.moveTo(cx - d, cy - d);
        ctx.lineTo(cx + d, cy + d);
        ctx.moveTo(cx + d, cy - d);
        ctx.lineTo(cx - d, cy + d);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Vertical E-field arrows on a grid offset from the B markers. */
function drawEField(ctx: CanvasRenderingContext2D, T: Transform, r: Region, ey: number, eRef: number) {
  if (Math.abs(ey) < 1e-9) return;
  const strength = Math.min(1, Math.abs(ey) / eRef);
  const len = (8 + 10 * strength) * Math.sign(ey);
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.45 * strength;
  const step = 0.04;
  for (let x = r.x0 + step / 2 + 0.01; x < r.x1; x += step) {
    for (let y = r.y0 + 0.02; y < r.y1 - 0.005; y += step / 2) {
      const cx = T.sx(x);
      const cy = T.sy(y);
      drawArrow(ctx, cx, cy + len / 2, 0, -len, COLORS.eField);
    }
  }
  ctx.restore();
}

/** Capacitor plates; with E pointing up the bottom plate is positive. */
function drawPlates(
  ctx: CanvasRenderingContext2D,
  T: Transform,
  x0: number,
  x1: number,
  yTop: number,
  yBottom: number,
  ey: number,
) {
  const signTop = ey > 0 ? '−' : ey < 0 ? '+' : '';
  const signBottom = ey > 0 ? '+' : ey < 0 ? '−' : '';
  const plate = (y: number, sign: string, above: boolean) => {
    ctx.fillStyle = '#64748b';
    ctx.fillRect(T.sx(x0), T.sy(y) - 2, (x1 - x0) * T.scale, 4);
    if (!sign) return;
    ctx.fillStyle = sign === '+' ? COLORS.positive : COLORS.negative;
    ctx.font = `bold 11px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let x = x0 + 0.01; x < x1; x += 0.02) {
      ctx.fillText(sign, T.sx(x), T.sy(y) + (above ? -9 : 10));
    }
  };
  plate(yTop, signTop, true);
  plate(yBottom, signBottom, false);
}

/** Top and bottom chamber walls as capacitor plates: coloured by sign, one label each. */
function drawChamberPlates(ctx: CanvasRenderingContext2D, T: Transform, ey: number) {
  const topPositive = ey < 0;
  const plate = (y: number, positive: boolean) => {
    const color = positive ? COLORS.positive : COLORS.negative;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(T.sx(0), T.sy(y) - 1.5, WORLD.w * T.scale, 3);
    ctx.globalAlpha = 1;
    ctx.font = `bold 13px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(positive ? '+' : '−', T.sx(0) - 6, T.sy(y));
  };
  plate(WORLD.h, topPositive);
  plate(0, !topPositive);
}

/** Wall at x with a slit centred on axisY. */
function drawSlitWall(ctx: CanvasRenderingContext2D, T: Transform, x: number, axisY: number, half: number) {
  ctx.fillStyle = '#475569';
  const w = 4;
  ctx.fillRect(T.sx(x) - w / 2, T.sy(WORLD.h), w, T.sy(axisY + half) - T.sy(WORLD.h));
  ctx.fillRect(T.sx(x) - w / 2, T.sy(axisY - half), w, T.sy(0) - T.sy(axisY - half));
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  T: Transform,
  pts: number[],
  color: string,
  alpha: number,
  width = 1.6,
  dashed = false,
) {
  if (pts.length < 4 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(T.sx(pts[0]), T.sy(pts[1]));
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(T.sx(pts[i]), T.sy(pts[i + 1]));
  ctx.stroke();
  ctx.restore();
}

function drawDot(ctx: CanvasRenderingContext2D, T: Transform, pt: Particle, color: string, r: number, label?: string) {
  const x = T.sx(pt.x);
  const y = T.sy(pt.y);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (label) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `600 10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + r + 4, y - r - 4);
  }
}

function drawStatus(ctx: CanvasRenderingContext2D, line1: string, color: string, line2: string) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10.5px ${MONO}`;
  ctx.fillStyle = color;
  ctx.fillText(line1, 16, 20);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(line2, 16, 35);
}

function drawScaleBar(ctx: CanvasRenderingContext2D, T: Transform) {
  const x1 = T.sx(WORLD.w) - 4;
  const x0 = x1 - 0.05 * T.scale;
  const y = T.sy(0) + 14;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y - 4);
  ctx.lineTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.lineTo(x1, y - 4);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('5 cm', x0 - 6, y - 1);
}

function fmtTime(t: number): string {
  return `t = ${(t * 1e6).toFixed(2)} µs  (1 µs of physics per second at 1x)`;
}

function drawUniform(
  ctx: CanvasRenderingContext2D,
  T: Transform,
  p: FieldParams,
  rt: Runtime,
  flags: DrawFlags,
) {
  const full: Region = { x0: 0, x1: WORLD.w, y0: 0, y1: WORLD.h };
  drawBField(ctx, T, full, p.B, 0.05);
  drawEField(ctx, T, full, p.E, 5000);
  if (p.E !== 0) drawChamberPlates(ctx, T, p.E);

  const species = speciesById(p.speciesId);
  const pr = rt.primary;
  if (flags.showTheory && pr && p.E === 0 && p.B !== 0 && p.v0 > 0) {
    const r = larmorRadius(pr.m, pr.q, p.v0, p.B);
    ctx.save();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(T.sx(WORLD.w / 2), T.sy(WORLD.h / 2), r * T.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(196, 181, 253, 0.85)';
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(`r_L = ${(r * 100).toFixed(2)} cm`, T.sx(WORLD.w / 2) + 6, T.sy(WORLD.h / 2) - 6);
    ctx.beginPath();
    ctx.arc(T.sx(WORLD.w / 2), T.sy(WORLD.h / 2), 2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (rt.twin) {
    drawTrail(ctx, T, rt.twinTrail, chargeColor(rt.twin.q), 0.8, 1.6, true);
    drawDot(ctx, T, rt.twin, chargeColor(rt.twin.q), 5, 'twin');
  }
  if (pr) {
    drawTrail(ctx, T, rt.primaryTrail, chargeColor(pr.q), 0.95, 2);
    drawDot(ctx, T, pr, chargeColor(pr.q), 6, species.short);

    if (flags.showVectors && pr.state === 'flying') {
      const cx = T.sx(pr.x);
      const cy = T.sy(pr.y);
      const speed = Math.hypot(pr.vx, pr.vy);
      const vLen = Math.min(70, (speed / 100e3) * 45);
      if (speed > 0) drawArrow(ctx, cx, cy, (pr.vx / speed) * vLen, (-pr.vy / speed) * vLen, COLORS.velocity, 'v');
      const fEy = pr.q * p.E;
      const fBx = pr.q * pr.vy * p.B;
      const fBy = -pr.q * pr.vx * p.B;
      const fMax = Math.max(Math.abs(fEy), Math.hypot(fBx, fBy), 1e-30);
      const k = 55 / fMax;
      drawArrow(ctx, cx, cy, fBx * k, -fBy * k, COLORS.bField, 'F_B');
      drawArrow(ctx, cx, cy, 0, -fEy * k, COLORS.eField, 'F_E');
    }
  }

  let line1: string;
  let color: string = COLORS.positive;
  const vd = driftVelocity(p.E, p.B);
  if (pr && pr.state === 'escaped') {
    const r = larmorRadius(pr.m, pr.q, Math.abs(p.v0 - Math.abs(vd)), p.B);
    line1 =
      p.E === 0 && r > WORLD.h / 2
        ? `ORBIT TOO BIG · r_L = ${(r * 100).toFixed(1)} cm won't fit: lower v₀ or raise B`
        : 'PARTICLE LEFT THE CHAMBER · press Reset to relaunch';
    color = '#94a3b8';
  } else if (p.B !== 0 && p.E === 0) {
    line1 = p.v0 > 0 ? 'CYCLOTRON MOTION · F_B ⊥ v, so speed never changes' : 'AT REST · a magnetic field cannot move a charge at rest';
    color = COLORS.bField;
  } else if (p.B !== 0) {
    line1 = `E × B DRIFT · v_d = E/B = ${(Math.abs(vd) / 1000).toFixed(1)} km/s to the ${vd >= 0 ? 'right' : 'left'}, for any charge or mass`;
    color = COLORS.eField;
  } else if (p.E !== 0) {
    line1 = 'ELECTRIC FIELD ONLY · constant force qE, parabolic path';
    color = COLORS.eField;
  } else {
    line1 = "NO FIELDS · Newton's 1st law: straight line at constant speed";
    color = '#94a3b8';
  }
  drawStatus(ctx, line1, color, fmtTime(rt.t));
  drawScaleBar(ctx, T);
}

function drawGhostsAndBeam(ctx: CanvasRenderingContext2D, T: Transform, rt: Runtime) {
  for (const g of rt.ghosts) {
    const age = (rt.t - g.diedAt) / GHOST_FADE;
    drawTrail(ctx, T, g.trail, g.color, 0.75 * (1 - age), 1.3);
  }
  for (const b of rt.beam) {
    drawTrail(ctx, T, b.trail, b.color, 0.9, 1.5);
    drawDot(ctx, T, b.pt, b.color, 3.5);
  }
}

function drawSource(ctx: CanvasRenderingContext2D, T: Transform, x: number, y: number) {
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  const w = 0.012 * T.scale;
  const h = 0.014 * T.scale;
  ctx.fillRect(T.sx(x) - w, T.sy(y) - h / 2, w, h);
  ctx.strokeRect(T.sx(x) - w, T.sy(y) - h / 2, w, h);
}

function drawSelector(ctx: CanvasRenderingContext2D, T: Transform, p: FieldParams, rt: Runtime) {
  const g = SELECTOR;
  const region: Region = { x0: g.plateX0, x1: g.plateX1, y0: g.plateBottom, y1: g.plateTop };
  drawBField(ctx, T, region, p.B, 0.02);
  drawEField(ctx, T, region, p.E, 2000);
  drawPlates(ctx, T, g.plateX0, g.plateX1, g.plateTop, g.plateBottom, p.E);
  drawSlitWall(ctx, T, g.exitX, g.source.y, g.slitHalf);
  drawSource(ctx, T, g.source.x + 0.006, g.source.y);

  // Detector behind the exit slit
  ctx.fillStyle = COLORS.detector;
  ctx.fillRect(T.sx(g.detectorX), T.sy(g.source.y + 0.012), 5, 0.024 * T.scale);
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${rt.transmitted}`, T.sx(g.detectorX) - 4, T.sy(g.source.y + 0.016));

  const volts = Math.abs(p.E) * (g.plateTop - g.plateBottom);
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.fillText(
    `ΔV = ${volts.toFixed(0)} V across ${((g.plateTop - g.plateBottom) * 100).toFixed(0)} cm`,
    T.sx((g.plateX0 + g.plateX1) / 2),
    T.sy(g.plateTop) - 22,
  );

  drawGhostsAndBeam(ctx, T, rt);

  // Speed colour legend
  const lx = T.sx(0.01);
  const ly = T.sy(0.025);
  const lw = 0.1 * T.scale;
  for (let i = 0; i < lw; i++) {
    ctx.fillStyle = thermalColor(i / lw);
    ctx.fillRect(lx + i, ly, 1, 6);
  }
  const vSel = selectedSpeed(p);
  if (Number.isFinite(vSel) && vSel >= g.speedMin && vSel <= g.speedMax) {
    const mx = lx + ((vSel - g.speedMin) / (g.speedMax - g.speedMin)) * lw;
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(mx, ly - 1);
    ctx.lineTo(mx - 4, ly - 7);
    ctx.lineTo(mx + 4, ly - 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#94a3b8';
  ctx.font = `9.5px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(`${g.speedMin / 1000}`, lx, ly + 17);
  ctx.textAlign = 'right';
  ctx.fillText(`${g.speedMax / 1000} km/s`, lx + lw, ly + 17);

  const vText = Number.isFinite(vSel) ? `${(vSel / 1000).toFixed(1)} km/s` : '∞ (B = 0)';
  drawStatus(
    ctx,
    `VELOCITY SELECTOR · only v = E/B = ${vText} passes straight through`,
    COLORS.detector,
    `Trail colour = launch speed (beam spans 50–150 km/s) · ${fmtTime(rt.t).split('  ')[0]}`,
  );
}

function drawSpectrometer(ctx: CanvasRenderingContext2D, T: Transform, p: FieldParams, rt: Runtime) {
  const g = SPECTROMETER;
  const region: Region = { x0: g.plateX0, x1: g.plateX1, y0: g.plateBottom, y1: g.plateTop };
  drawBField(ctx, T, { x0: g.analyzerX, x1: WORLD.w, y0: 0, y1: WORLD.h }, p.B2, 0.6);
  drawBField(ctx, T, region, p.B, 0.4);
  drawEField(ctx, T, region, p.E, 40000);
  drawPlates(ctx, T, g.plateX0, g.plateX1, g.plateTop, g.plateBottom, p.E);
  drawSlitWall(ctx, T, g.exitX, g.source.y, g.slitHalf);
  drawSource(ctx, T, g.source.x + 0.006, g.source.y);

  ctx.fillStyle = 'rgba(196, 181, 253, 0.9)';
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(`B₂ = ${(p.B2 * 1000).toFixed(0)} mT`, T.sx(WORLD.w) - 8, T.sy(WORLD.h) + 14);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  ctx.font = `10px ${MONO}`;
  ctx.fillText('velocity selector', T.sx((g.plateX0 + g.plateX1) / 2), T.sy(g.plateBottom) + 24);

  // Detector plate and accumulated hits
  const plateX = T.sx(g.analyzerX);
  ctx.fillStyle = '#334155';
  ctx.fillRect(plateX - 2, T.sy(g.detectorMaxY), 4, (g.detectorMaxY - g.detectorMinY) * T.scale);
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const h of rt.hits) {
    ctx.fillStyle = COLORS.isotopes[h.speciesIndex];
    ctx.fillRect(plateX - 9, T.sy(h.y) - 0.5, 9, 1.2);
  }
  ctx.restore();

  // Predicted landing points
  const vSel = selectedSpeed(p);
  if (Number.isFinite(vSel)) {
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    NEON_ISOTOPES.forEach((iso, i) => {
      const y = g.source.y - landingDistance(iso.massU, p);
      if (y < g.detectorMinY || y > g.detectorMaxY) return;
      const sy = T.sy(y);
      ctx.strokeStyle = COLORS.isotopes[i];
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(plateX - 30, sy);
      ctx.lineTo(plateX - 12, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.isotopes[i];
      // Stagger labels so the close Ne-21 line stays readable.
      ctx.fillText(iso.short, plateX - 34 - (i === 1 ? 46 : 0), sy);
    });
    ctx.textBaseline = 'alphabetic';
  }

  drawGhostsAndBeam(ctx, T, rt);

  drawStatus(
    ctx,
    `MASS SPECTROMETER · v = E/B₁ = ${Number.isFinite(vSel) ? (vSel / 1000).toFixed(1) : '∞'} km/s, then r = m v / q B₂`,
    COLORS.isotopes[0],
    `Each ion lands at D = 2r, so m = q B₂ D / 2v · ${fmtTime(rt.t).split('  ')[0]}`,
  );
}

export function drawLab(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  p: FieldParams,
  rt: Runtime,
  flags: DrawFlags,
) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);
  const T = makeTransform(width, height);
  ctx.fillStyle = '#080d18';
  ctx.fillRect(T.sx(0), T.sy(WORLD.h), WORLD.w * T.scale, WORLD.h * T.scale);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(T.sx(0), T.sy(WORLD.h), WORLD.w * T.scale, WORLD.h * T.scale);

  if (p.scenario === 'uniform') drawUniform(ctx, T, p, rt, flags);
  else if (p.scenario === 'selector') drawSelector(ctx, T, p, rt);
  else drawSpectrometer(ctx, T, p, rt);
}

