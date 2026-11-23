import {
  TRACK,
  computeForces,
  hangingDepths,
  type ForceBreakdown,
  type NewtonParams,
  type NewtonState,
} from './physics';

export const FORCE_COLORS = {
  weight: '#f472b6', // gravity is a field force
  normal: '#a78bfa',
  friction: '#fb7185',
  tension: '#e2e8f0',
  applied: '#f59e0b',
  net: '#34d399',
  velocity: '#38bdf8',
  stop: '#94a3b8',
} as const;

export interface DrawFlags {
  showComponents: boolean;
  showPairs: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Vec {
  x: number;
  y: number;
}

interface Transform {
  scale: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
}

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const INCLINE_VIEW = { x0: 0.4, x1: 9.4, y0: -0.3, y1: 7.3 };
const ATWOOD_VIEW = { x0: 1.6, x1: 7.6, y0: -0.3, y1: 7.3 };

/** Side length (m) of a mass's box; volume ∝ mass so heavier blocks read as bigger. */
export function blockSide(mass: number): number {
  return 0.42 * Math.cbrt(Math.max(0.05, mass));
}

function fmt(value: number, digits = 1): string {
  const v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return v.toFixed(digits);
}

interface ArrowOpts {
  label?: string;
  dashed?: boolean;
  width?: number;
  alpha?: number;
  labelAtTail?: boolean;
}

/** Screen-space arrow from (x0, y0) along (dx, dy) pixels. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  color: string,
  opts: ArrowOpts = {},
) {
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(8, len * 0.5);
  const half = head * 0.55;
  const ex = x0 + dx;
  const ey = y0 + dy;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = opts.width ?? 2;
  if (opts.dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(ex - ux * head * 0.8, ey - uy * head * 0.8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * head - uy * half, ey - uy * head + ux * half);
  ctx.lineTo(ex - ux * head + uy * half, ey - uy * head - ux * half);
  ctx.closePath();
  ctx.fill();
  if (opts.label) {
    ctx.font = `bold 11px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (opts.labelAtTail) ctx.fillText(opts.label, x0 - ux * 10, y0 - uy * 10);
    else ctx.fillText(opts.label, ex + ux * 12, ey + uy * 12);
  }
  ctx.restore();
}

/** Newton's 3rd-law partner of tension: the mass pulls down on the rope at its attachment point. */
function drawRopePull(ctx: CanvasRenderingContext2D, x: number, attachY: number, len: number) {
  const l = Math.max(14, len);
  drawArrow(ctx, x, attachY - l, 0, l, FORCE_COLORS.tension, { dashed: true, alpha: 0.85, width: 2.5 });
  ctx.save();
  ctx.font = `bold 11px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = FORCE_COLORS.tension;
  ctx.fillText('T′', x + 6, attachY - l / 2);
  ctx.restore();
}

function makeTransform(
  rect: Rect,
  view: { x0: number; x1: number; y0: number; y1: number },
  padTop: number,
): Transform {
  const pad = 14;
  const viewW = view.x1 - view.x0;
  const viewH = view.y1 - view.y0;
  const scale = Math.max(1, Math.min((rect.w - 2 * pad) / viewW, (rect.h - pad - padTop) / viewH));
  const left = rect.x + (rect.w - viewW * scale) / 2;
  const bottom = rect.y + rect.h - pad;
  return {
    scale,
    sx: (x) => left + (x - view.x0) * scale,
    sy: (y) => bottom - (y - view.y0) * scale,
  };
}

function drawFloor(ctx: CanvasRenderingContext2D, rect: Rect, y: number) {
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rect.x, y);
  ctx.lineTo(rect.x + rect.w, y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';
  ctx.lineWidth = 1;
  for (let x = rect.x + 6; x < rect.x + rect.w; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x - 7, y + 9);
    ctx.stroke();
  }
}

/** Draws a mass box centred at screen (cx, cy), rotated by world angle theta. */
function drawMass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sidePx: number,
  theta: number,
  label: string,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-theta);
  const h = sidePx / 2;
  const grad = ctx.createLinearGradient(0, -h, 0, h);
  grad.addColorStop(0, '#243149');
  grad.addColorStop(1, '#151e30');
  ctx.fillStyle = grad;
  ctx.fillRect(-h, -h, sidePx, sidePx);
  ctx.strokeStyle = '#7c8aa5';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-h, -h, sidePx, sidePx);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 ${Math.max(10, Math.min(14, sidePx * 0.36))}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 1);
  ctx.restore();
}

function drawPulley(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function statusLines(p: NewtonParams, st: NewtonState, fb: ForceBreakdown): {
  text: string;
  color: string;
  law: string;
} {
  const moving = st.v !== 0;
  let law: string;
  if (fb.acceleration === 0) {
    law = moving
      ? "Newton's 1st law: ΣF = 0, so velocity stays constant"
      : "Newton's 1st law: ΣF = 0, so it stays at rest";
  } else {
    law = `Newton's 2nd law: a = ΣF / m_total = ${fmt(fb.acceleration, 2)} m/s²`;
  }

  if (p.scenario === 'atwood') {
    return {
      text: `ATWOOD · a = (m₂ − m₁)g / (m₁ + m₂) = ${fmt(fb.acceleration, 3)} m/s²`,
      color: FORCE_COLORS.net,
      law,
    };
  }

  const flat = fb.thetaRad < 1e-3;
  const dir = st.v > 0 ? (flat ? 'RIGHT' : 'UP-SLOPE') : flat ? 'LEFT' : 'DOWN-SLOPE';
  switch (fb.regime) {
    case 'static':
      return {
        text: `STATIC · f = ${fmt(Math.abs(fb.friction))} N (max μ_s·N = ${fmt(fb.staticMax)} N)`,
        color: (fb.gripUsed ?? 0) > 0.9 ? FORCE_COLORS.applied : FORCE_COLORS.friction,
        law,
      };
    case 'kinetic':
      return {
        text: `SLIDING ${dir} · f = μ_k·N = ${fmt(fb.kineticMag)} N`,
        color: FORCE_COLORS.velocity,
        law,
      };
    case 'end-stop':
      return {
        text: `AT END STOP · stop pushes back R = ${fmt(Math.abs(fb.stopReaction))} N`,
        color: FORCE_COLORS.stop,
        law: 'Press Reset (or a nudge) to start a new run',
      };
    default:
      return {
        text: moving
          ? `FRICTIONLESS · SLIDING ${dir}`
          : fb.acceleration === 0
            ? 'EQUILIBRIUM · ΣF = 0'
            : 'FRICTIONLESS · released',
        color: FORCE_COLORS.net,
        law,
      };
  }
}

function drawStatus(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  p: NewtonParams,
  st: NewtonState,
  fb: ForceBreakdown,
  flags: DrawFlags,
) {
  const s = statusLines(p, st, fb);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10.5px ${MONO}`;
  ctx.fillStyle = s.color;
  ctx.fillText(s.text, rect.x + 14, rect.y + 18);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(s.law, rect.x + 14, rect.y + 32);
  if (flags.showPairs) {
    ctx.fillStyle = 'rgba(167, 139, 250, 0.8)';
    ctx.fillText(
      p.scenario === 'atwood'
        ? "Newton's 3rd law: each mass pulls the rope down with T′ = −T"
        : "Newton's 3rd law: N′ = −N and f′ = −f act on the ramp",
      rect.x + 14,
      rect.y + 46,
    );
  }
}

function drawIncline(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  p: NewtonParams,
  st: NewtonState,
  fb: ForceBreakdown,
  flags: DrawFlags,
) {
  const T = makeTransform(rect, INCLINE_VIEW, 54);
  const th = fb.thetaRad;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const L = TRACK.rampLength;
  const top = TRACK.rampTop;
  const bottom = { x: top.x - L * c, y: top.y - L * sn };
  const u: Vec = { x: c, y: sn }; // up-slope (toward pulley)
  const n: Vec = { x: -sn, y: c }; // outward surface normal
  const at = (along: number, out: number): Vec => ({
    x: bottom.x + u.x * along + n.x * out,
    y: bottom.y + u.y * along + n.y * out,
  });
  const uS = { x: u.x, y: -u.y }; // screen-space unit vectors
  const nS = { x: n.x, y: -n.y };

  drawFloor(ctx, rect, T.sy(0));

  // Ramp: a plank on two legs (reads as a table at θ = 0).
  const thick = 0.22;
  const bU = { x: bottom.x - n.x * thick, y: bottom.y - n.y * thick };
  const tU = { x: top.x - n.x * thick, y: top.y - n.y * thick };
  const undersideY = (x: number) => bU.y + (x - bU.x) * Math.tan(th);
  ctx.fillStyle = '#111827';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  for (const legX of [bU.x + 0.3, tU.x - 0.3]) {
    const yTop = undersideY(legX);
    if (yTop <= 0.03) continue;
    const x = T.sx(legX - 0.09);
    const y = T.sy(yTop);
    const w = 0.18 * T.scale;
    const h = T.sy(0) - y;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  const slab = ctx.createLinearGradient(0, T.sy(top.y), 0, T.sy(bottom.y));
  slab.addColorStop(0, '#1f2a40');
  slab.addColorStop(1, '#172033');
  ctx.fillStyle = slab;
  ctx.beginPath();
  ctx.moveTo(T.sx(bottom.x), T.sy(bottom.y));
  ctx.lineTo(T.sx(top.x), T.sy(top.y));
  ctx.lineTo(T.sx(tU.x), T.sy(tU.y));
  ctx.lineTo(T.sx(bU.x), T.sy(bU.y));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(T.sx(bottom.x), T.sy(bottom.y));
  ctx.lineTo(T.sx(top.x), T.sy(top.y));
  ctx.stroke();

  // Angle marker
  if (th > 0.008) {
    const bx = T.sx(bottom.x);
    const by = T.sy(bottom.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + 70, by);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(bx, by, 44, -th, 0);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `11px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lx = bx + 54 * Math.cos(th / 2);
    const ly = by - 54 * Math.sin(th / 2);
    ctx.fillText(`θ = ${p.thetaDeg.toFixed(1)}°`, lx, Math.min(ly, by - 7));
  }

  const side1 = blockSide(p.m1);
  const h1 = side1 / 2;
  const centre = at(st.s, h1);
  const cx = T.sx(centre.x);
  const cy = T.sy(centre.y);

  // Shared scene force scale (px per newton) for the push arrow and 3rd-law partners.
  const fMax = Math.max(1e-6, fb.weight1, fb.weight2, fb.normal, Math.abs(fb.friction), fb.tension, Math.abs(fb.applied));
  const k = 62 / fMax;

  // Rope, pulley and hanging mass
  if (fb.hasRope) {
    const C = TRACK.pulley;
    const cxP = T.sx(C.x);
    const cyP = T.sy(C.y);
    const rP = C.r * T.scale;

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(T.sx(top.x), T.sy(top.y));
    ctx.lineTo(cxP, cyP);
    ctx.stroke();

    // Rope leaves the block's uphill face and meets the pulley on its upper tangent.
    const A = at(st.s + h1, h1);
    const dx = C.x - A.x;
    const dy = C.y - A.y;
    const dist = Math.hypot(dx, dy);
    const d2 = hangingDepths(p, st.s).d2;
    const side2 = blockSide(p.m2);
    const hangX = C.x + C.r;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (dist > C.r) {
      const dir = Math.atan2(dy, dx) + Math.asin(C.r / dist);
      const tl = Math.sqrt(dist * dist - C.r * C.r);
      const Q = { x: A.x + tl * Math.cos(dir), y: A.y + tl * Math.sin(dir) };
      const beta = Math.atan2(Q.y - C.y, Q.x - C.x);
      ctx.moveTo(T.sx(A.x), T.sy(A.y));
      ctx.lineTo(T.sx(Q.x), T.sy(Q.y));
      ctx.arc(cxP, cyP, rP, -beta, 0);
    } else {
      ctx.moveTo(T.sx(hangX), cyP);
    }
    ctx.lineTo(T.sx(hangX), T.sy(C.y - d2 + side2 / 2));
    ctx.stroke();

    drawPulley(ctx, cxP, cyP, rP);
    const hx = T.sx(hangX);
    const hy = T.sy(C.y - d2);
    drawMass(ctx, hx, hy, side2 * T.scale, 0, 'm₂');

    if (st.v !== 0) {
      const vy = Math.max(-110, Math.min(110, st.v * 30));
      drawArrow(ctx, hx + (side2 / 2) * T.scale + 10, hy, 0, vy, FORCE_COLORS.velocity, {
        label: 'v',
      });
    }
    if (flags.showPairs) {
      drawRopePull(ctx, hx, T.sy(C.y - d2 + side2 / 2), Math.min(45, fb.tension * k));
    }
  }

  drawMass(ctx, cx, cy, side1 * T.scale, th, 'm₁');

  // Applied push, drawn as a hand-push arrow ending on the block face it pushes.
  if (Math.abs(fb.applied) > 0.05) {
    const len = Math.max(14, Math.abs(fb.applied) * k);
    const sign = Math.sign(fb.applied);
    const face = at(st.s - sign * h1, h1 * 1.15);
    const fx = T.sx(face.x);
    const fy = T.sy(face.y);
    drawArrow(ctx, fx - uS.x * sign * len, fy - uS.y * sign * len, uS.x * sign * len, uS.y * sign * len, FORCE_COLORS.applied, {
      label: 'F',
      width: 2.5,
      labelAtTail: true,
    });
  }

  // Velocity arrow above the block
  if (st.v !== 0) {
    const lift = (h1 + 0.28) * T.scale;
    const len = Math.max(-120, Math.min(120, st.v * 30));
    drawArrow(ctx, cx + nS.x * lift, cy + nS.y * lift, uS.x * len, uS.y * len, FORCE_COLORS.velocity, {
      label: 'v',
    });
  }

  // Newton's 3rd-law partners acting on the ramp at the contact point.
  if (flags.showPairs) {
    const E = at(st.s, 0);
    const ex = T.sx(E.x);
    const ey = T.sy(E.y);
    if (fb.normal > 1e-6) {
      const len = Math.min(70, fb.normal * k);
      drawArrow(ctx, ex, ey, -nS.x * len, -nS.y * len, FORCE_COLORS.normal, {
        dashed: true,
        alpha: 0.85,
        label: 'N′',
      });
    }
    if (Math.abs(fb.friction) > 1e-6) {
      const len = Math.min(70, Math.abs(fb.friction) * k) * -Math.sign(fb.friction);
      const off = 8;
      drawArrow(ctx, ex - nS.x * off, ey - nS.y * off, uS.x * len, uS.y * len, FORCE_COLORS.friction, {
        dashed: true,
        alpha: 0.85,
        label: 'f′',
      });
    }
  }

  drawStatus(ctx, rect, p, st, fb, flags);
}

function drawAtwood(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  p: NewtonParams,
  st: NewtonState,
  fb: ForceBreakdown,
  flags: DrawFlags,
) {
  const T = makeTransform(rect, ATWOOD_VIEW, 54);
  const C = TRACK.atwoodPulley;
  const cxP = T.sx(C.x);
  const cyP = T.sy(C.y);
  const rP = C.r * T.scale;
  const ceilY = T.sy(7.05);

  drawFloor(ctx, rect, T.sy(0));

  // Ceiling beam and hanger rod
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(T.sx(C.x - 1.3), ceilY);
  ctx.lineTo(T.sx(C.x + 1.3), ceilY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';
  ctx.lineWidth = 1;
  for (let x = T.sx(C.x - 1.3) + 6; x < T.sx(C.x + 1.3); x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, ceilY - 1);
    ctx.lineTo(x - 6, ceilY - 7);
    ctx.stroke();
  }
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cxP, ceilY);
  ctx.lineTo(cxP, cyP);
  ctx.stroke();

  const { d1, d2 } = hangingDepths(p, st.s);
  const side1 = blockSide(p.m1);
  const side2 = blockSide(p.m2);
  const x1 = C.x - C.r;
  const x2 = C.x + C.r;

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(T.sx(x1), T.sy(C.y - d1 + side1 / 2));
  ctx.lineTo(T.sx(x1), cyP);
  ctx.arc(cxP, cyP, rP, Math.PI, Math.PI * 2);
  ctx.lineTo(T.sx(x2), T.sy(C.y - d2 + side2 / 2));
  ctx.stroke();
  drawPulley(ctx, cxP, cyP, rP);

  const m1x = T.sx(x1);
  const m1y = T.sy(C.y - d1);
  const m2x = T.sx(x2);
  const m2y = T.sy(C.y - d2);
  drawMass(ctx, m1x, m1y, side1 * T.scale, 0, 'm₁');
  drawMass(ctx, m2x, m2y, side2 * T.scale, 0, 'm₂');

  if (st.v !== 0) {
    const len = Math.max(-110, Math.min(110, st.v * 30));
    drawArrow(ctx, m1x - (side1 / 2) * T.scale - 12, m1y, 0, -len, FORCE_COLORS.velocity, { label: 'v' });
    drawArrow(ctx, m2x + (side2 / 2) * T.scale + 12, m2y, 0, len, FORCE_COLORS.velocity, { label: 'v' });
  }

  if (flags.showPairs) {
    const fMax = Math.max(1e-6, fb.weight1, fb.weight2, fb.tension);
    const len = Math.min(45, (fb.tension / fMax) * 45);
    drawRopePull(ctx, m1x, T.sy(C.y - d1 + side1 / 2), len);
    drawRopePull(ctx, m2x, T.sy(C.y - d2 + side2 / 2), len);
  }

  drawStatus(ctx, rect, p, st, fb, flags);
}

interface FbdForce {
  v: Vec; // world-space force vector (N), y up
  color: string;
  label: string;
  dashed?: boolean;
  offset?: number; // px, perpendicular shift to separate collinear arrows
}

interface FbdBody {
  title: string;
  theta: number;
  forces: FbdForce[];
  net: Vec; // world-space ΣF
  netValue: number;
  accel: number;
}

function buildBodies(p: NewtonParams, fb: ForceBreakdown, flags: DrawFlags): FbdBody[] {
  const th = fb.thetaRad;
  const u: Vec = { x: Math.cos(th), y: Math.sin(th) };
  const n: Vec = { x: -Math.sin(th), y: Math.cos(th) };
  const along = (mag: number): Vec => ({ x: u.x * mag, y: u.y * mag });
  const tiny = 1e-6;

  const f1: FbdForce[] = [{ v: { x: 0, y: -fb.weight1 }, color: FORCE_COLORS.weight, label: 'W' }];
  if (fb.normal > tiny) f1.push({ v: { x: n.x * fb.normal, y: n.y * fb.normal }, color: FORCE_COLORS.normal, label: 'N' });
  if (Math.abs(fb.friction) > tiny) f1.push({ v: along(fb.friction), color: FORCE_COLORS.friction, label: 'f' });
  if (fb.hasRope) f1.push({ v: along(fb.tension), color: FORCE_COLORS.tension, label: 'T', offset: 7 });
  if (Math.abs(fb.applied) > tiny) f1.push({ v: along(fb.applied), color: FORCE_COLORS.applied, label: 'F', offset: -7 });
  if (Math.abs(fb.stopReaction) > tiny) f1.push({ v: along(fb.stopReaction), color: FORCE_COLORS.stop, label: 'R', offset: -14 });
  if (flags.showComponents && th > 1e-3 && th < Math.PI / 2 - 1e-3) {
    f1.push({ v: along(fb.weightParallel), color: FORCE_COLORS.weight, label: 'W∥', dashed: true, offset: 14 });
    f1.push({
      v: { x: -n.x * fb.weightPerp, y: -n.y * fb.weightPerp },
      color: FORCE_COLORS.weight,
      label: 'W⊥',
      dashed: true,
      offset: 7,
    });
  }

  const bodies: FbdBody[] = [
    {
      title: `m₁ = ${p.m1.toFixed(1)} kg`,
      theta: th,
      forces: f1,
      net: along(fb.net1),
      netValue: fb.net1,
      accel: fb.acceleration,
    },
  ];

  if (fb.hasRope) {
    bodies.push({
      title: `m₂ = ${p.m2.toFixed(1)} kg`,
      theta: 0,
      forces: [
        { v: { x: 0, y: fb.tension }, color: FORCE_COLORS.tension, label: 'T' },
        { v: { x: 0, y: -fb.weight2 }, color: FORCE_COLORS.weight, label: 'W' },
      ],
      net: { x: 0, y: -fb.net2 },
      netValue: fb.net2,
      accel: fb.acceleration,
    });
  }
  return bodies;
}

function drawFbdPanel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  p: NewtonParams,
  fb: ForceBreakdown,
  flags: DrawFlags,
  stacked: boolean,
) {
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (stacked) {
    ctx.moveTo(rect.x + rect.w - 0.5, rect.y);
    ctx.lineTo(rect.x + rect.w - 0.5, rect.y + rect.h);
  } else {
    ctx.moveTo(rect.x, rect.y + rect.h - 0.5);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h - 0.5);
  }
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10px ${MONO}`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('FREE-BODY DIAGRAMS', rect.x + 12, rect.y + 18);
  ctx.font = `9.5px ${MONO}`;
  ctx.fillStyle = '#475569';
  ctx.fillText('arrows drawn to scale', rect.x + 12, rect.y + 31);

  const bodies = buildBodies(p, fb, flags);
  const header = 38;
  const count = bodies.length;
  const cellW = stacked ? rect.w : rect.w / count;
  const cellH = stacked ? (rect.h - header) / count : rect.h - header;

  let fMax = 1e-6;
  for (const b of bodies) for (const f of b.forces) fMax = Math.max(fMax, Math.hypot(f.v.x, f.v.y));
  const k = (Math.min(cellW, cellH - 40) * 0.36) / fMax;

  bodies.forEach((b, i) => {
    const cx0 = rect.x + (stacked ? 0 : i * cellW);
    const cy0 = rect.y + header + (stacked ? i * cellH : 0);
    const cx = cx0 + cellW / 2;
    const cy = cy0 + (cellH - 30) / 2 + 6;

    if (i > 0) {
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
      ctx.beginPath();
      if (stacked) {
        ctx.moveTo(cx0 + 12, cy0);
        ctx.lineTo(cx0 + cellW - 12, cy0);
      } else {
        ctx.moveTo(cx0, cy0 + 4);
        ctx.lineTo(cx0, cy0 + cellH - 8);
      }
      ctx.stroke();
    }

    ctx.font = `600 10.5px ${MONO}`;
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'left';
    ctx.fillText(b.title, cx0 + 12, cy0 + 16);

    // Body outline
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-b.theta);
    ctx.fillStyle = '#141d2e';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeRect(-11, -11, 22, 22);
    ctx.restore();

    for (const f of b.forces) {
      const dx = f.v.x * k;
      const dy = -f.v.y * k;
      const len = Math.hypot(dx, dy);
      let ox = 0;
      let oy = 0;
      if (f.offset && len > 0) {
        ox = (-dy / len) * f.offset;
        oy = (dx / len) * f.offset;
      }
      drawArrow(ctx, cx + ox, cy + oy, dx, dy, f.color, {
        label: f.label,
        dashed: f.dashed,
        alpha: f.dashed ? 0.75 : 1,
      });
    }
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // ΣF read-out with a small net-force arrow
    const rowY = cy0 + cellH - 12;
    ctx.font = `600 10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = FORCE_COLORS.net;
    const balanced = Math.abs(b.netValue) < 0.005;
    const roomy = cellW >= 230;
    const text = balanced
      ? roomy
        ? 'ΣF = 0, a = 0 (balanced)'
        : 'ΣF = 0 (balanced)'
      : roomy
        ? `ΣF = ${fmt(Math.abs(b.netValue))} N, a = ${fmt(Math.abs(b.accel), 2)} m/s²`
        : `ΣF = ${fmt(Math.abs(b.netValue))} N`;
    ctx.fillText(text, cx0 + 12, rowY);
    if (!balanced) {
      const nl = Math.hypot(b.net.x, b.net.y);
      const len = Math.min(34, Math.max(12, nl * k));
      const tw = ctx.measureText(text).width;
      const ax = cx0 + 12 + tw + 12 + 17;
      const ay = rowY - 4;
      const ux = b.net.x / nl;
      const uy = -b.net.y / nl;
      drawArrow(ctx, ax - (ux * len) / 2, ay - (uy * len) / 2, ux * len, uy * len, FORCE_COLORS.net, {
        width: 2.5,
      });
    }
  });
}

export function drawLab(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  p: NewtonParams,
  st: NewtonState,
  flags: DrawFlags,
) {
  const fb = computeForces(st, p);
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);

  const sideBySide = width >= 600;
  const fbdRect: Rect = sideBySide
    ? { x: 0, y: 0, w: Math.max(210, Math.min(260, width * 0.3)), h: height }
    : { x: 0, y: 0, w: width, h: Math.min(230, height * 0.38) };
  const sceneRect: Rect = sideBySide
    ? { x: fbdRect.w, y: 0, w: width - fbdRect.w, h: height }
    : { x: 0, y: fbdRect.h, w: width, h: height - fbdRect.h };

  if (p.scenario === 'atwood') drawAtwood(ctx, sceneRect, p, st, fb, flags);
  else drawIncline(ctx, sceneRect, p, st, fb, flags);
  drawFbdPanel(ctx, fbdRect, p, fb, flags, sideBySide);
}
