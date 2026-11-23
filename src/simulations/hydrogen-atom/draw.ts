import {
  L_LETTERS,
  energy,
  orbitalName,
  photonWavelength,
  psi,
  wavelengthColor,
  type Orbital,
} from './physics';

export const HCOLORS = {
  positive: '#38bdf8',
  negative: '#f472b6',
  mixed: '#a3e635',
  bohr: '#f59e0b',
  primary: '#a3e635',
  partner: '#38bdf8',
} as const;

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export type SlicePlane = 'xz' | 'xy' | 'yz';

/** Everything precomputed for one choice of state (recomputed only when the state changes). */
export interface AtomScene {
  primary: Orbital;
  partner: Orbital | null;
  points: Float32Array; // xyz triples (a₀)
  psiA: Float32Array; // ψ_primary at each point
  psiB: Float32Array | null; // ψ_partner at each point
  viewRadius: number; // a₀
  plane: SlicePlane;
  grid: number; // slice resolution
  sliceA: Float32Array;
  sliceB: Float32Array | null;
  sliceMax: number;
  allowed: boolean;
}

export interface AtomView {
  yaw: number;
  pitch: number;
  phase: number; // superposition phase ωt (visual time)
  mode: 'cloud' | 'slice';
  showBohr: boolean;
  photon: { start: number; color: string } | null; // performance.now() start time
  now: number;
}

/** Plane through the nucleus that shows the most of the orbital (|ψ|² summed on the plane). */
export function bestPlane(orbitals: Orbital[], R: number): SlicePlane {
  const planes: SlicePlane[] = ['xz', 'xy', 'yz'];
  let best: SlicePlane = 'xz';
  let bestSum = -1;
  for (const pl of planes) {
    let s = 0;
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 40; j++) {
        const u = -R + (2 * R * (i + 0.5)) / 40;
        const v = -R + (2 * R * (j + 0.5)) / 40;
        const [x, y, z] = planeToXYZ(pl, u, v);
        for (const o of orbitals) s += psi(o, x, y, z) ** 2;
      }
    if (s > bestSum * 1.02) {
      bestSum = s;
      best = pl;
    }
  }
  return best;
}

export function planeToXYZ(pl: SlicePlane, u: number, v: number): [number, number, number] {
  if (pl === 'xz') return [u, 0, v];
  if (pl === 'xy') return [u, v, 0];
  return [0, u, v];
}

/** Superposition weight ρ(t)/ρ̄ for equal amplitudes, in [0, 2]. */
function mixWeight(a: number, b: number, cosPhase: number): number {
  const s = a * a + b * b;
  return s > 0 ? 1 + (2 * a * b * cosPhase) / s : 0;
}

function drawSubscripted(
  ctx: CanvasRenderingContext2D,
  base: string,
  sub: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(base, x, y);
  if (!sub) return;
  const w = ctx.measureText(base).width;
  ctx.font = `600 ${Math.round(size * 0.72)}px ${MONO}`;
  ctx.fillText(sub, x + w + 1, y + size * 0.28);
}

/** Shortens text with an ellipsis so it fits within maxWidth at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function drawCloud(ctx: CanvasRenderingContext2D, r: Rect, s: AtomScene, v: AtomView) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2 + 8;
  const scale = (Math.min(r.w, r.h) * 0.44) / s.viewRadius;
  const cyw = Math.cos(v.yaw);
  const syw = Math.sin(v.yaw);
  const cp = Math.cos(v.pitch);
  const sp = Math.sin(v.pitch);
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const xr = x * cyw - y * syw;
    const yr = x * syw + y * cyw;
    const up = z * cp - yr * sp;
    const depth = z * sp + yr * cp;
    return [cx + xr * scale, cy - up * scale, depth];
  };

  // Axes
  ctx.lineWidth = 1;
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, ax] of [
    ['x', [1, 0, 0]],
    ['y', [0, 1, 0]],
    ['z', [0, 0, 1]],
  ] as const) {
    const L = s.viewRadius * 0.95;
    const [x1, y1] = project(-ax[0] * L, -ax[1] * L, -ax[2] * L);
    const [x2, y2] = project(ax[0] * L, ax[1] * L, ax[2] * L);
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillText(label, x2 + (x2 - cx) * 0.06, y2 + (y2 - cy) * 0.06);
  }

  // Bohr orbit in the horizontal (xy) plane
  if (v.showBohr) {
    const rb = s.primary.n * s.primary.n;
    ctx.save();
    ctx.strokeStyle = HCOLORS.bohr;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (2 * Math.PI * i) / 96;
      const [px, py] = project(rb * Math.cos(a), rb * Math.sin(a), 0);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Points, additively blended so dense regions glow
  const cosPh = Math.cos(v.phase);
  const n = s.psiA.length;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const size = n > 6000 ? 1.7 : 2;
  for (let i = 0; i < n; i++) {
    const [px, py, depth] = project(s.points[3 * i], s.points[3 * i + 1], s.points[3 * i + 2]);
    const fade = 0.55 + 0.45 * Math.max(-1, Math.min(1, depth / s.viewRadius));
    let alpha: number;
    let color: string;
    if (s.psiB) {
      alpha = 0.42 * mixWeight(s.psiA[i], s.psiB[i], cosPh) * fade;
      color = HCOLORS.mixed;
    } else {
      alpha = 0.7 * fade;
      color = s.psiA[i] >= 0 ? HCOLORS.positive : HCOLORS.negative;
    }
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  }
  ctx.restore();

  // Nucleus
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();

  drawScaleBar(ctx, r, scale, s.viewRadius);
  if (v.showBohr) {
    ctx.fillStyle = HCOLORS.bohr;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(`- - Bohr orbit r = n²a₀ = ${s.primary.n ** 2} a₀`, r.x + 12, r.y + r.h - 12);
  }
}

function drawScaleBar(ctx: CanvasRenderingContext2D, r: Rect, scale: number, viewRadius: number) {
  const candidates = [1, 2, 5, 10, 20, 50];
  const len = candidates.find((c) => c >= viewRadius / 3) ?? 50;
  const px = len * scale;
  const x1 = r.x + r.w - 14;
  const x0 = x1 - px;
  const y = r.y + r.h - 14;
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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${len} a₀ = ${(len * 0.0529).toFixed(len < 5 ? 3 : 2)} nm`, (x0 + x1) / 2, y - 6);
}

let sliceCanvas: HTMLCanvasElement | null = null;

function drawSlice(ctx: CanvasRenderingContext2D, r: Rect, s: AtomScene, v: AtomView) {
  const G = s.grid;
  if (!sliceCanvas) sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = G;
  sliceCanvas.height = G;
  const sctx = sliceCanvas.getContext('2d');
  if (!sctx) return;
  const img = sctx.createImageData(G, G);
  const cosPh = Math.cos(v.phase);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      const a = s.sliceA[k];
      let rho: number;
      let rgb: [number, number, number];
      if (s.sliceB) {
        const b = s.sliceB[k];
        rho = 0.5 * (a * a + b * b + 2 * a * b * cosPh);
        rgb = [163, 230, 53];
      } else {
        rho = a * a;
        rgb = a >= 0 ? [56, 189, 248] : [244, 114, 182];
      }
      const t = Math.pow(Math.min(1, rho / s.sliceMax), 0.45);
      const o = 4 * ((G - 1 - j) * G + i); // v increases upward
      img.data[o] = 7 + (rgb[0] - 7) * t;
      img.data[o + 1] = 11 + (rgb[1] - 11) * t;
      img.data[o + 2] = 20 + (rgb[2] - 20) * t;
      img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  const side = Math.min(r.w, r.h) - 40;
  const x0 = r.x + (r.w - side) / 2;
  const y0 = r.y + (r.h - side) / 2 + 8;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sliceCanvas, x0, y0, side, side);
  ctx.strokeStyle = '#1e293b';
  ctx.strokeRect(x0, y0, side, side);

  const scale = side / (2 * s.viewRadius);
  const cx = x0 + side / 2;
  const cy = y0 + side / 2;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x0 + side, cy);
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y0 + side);
  ctx.stroke();
  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(s.plane[0], x0 + side - 8, cy - 8);
  ctx.fillText(s.plane[1], cx + 10, y0 + 10);
  if (v.showBohr) {
    const rb = s.primary.n ** 2;
    ctx.save();
    ctx.strokeStyle = HCOLORS.bohr;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rb * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(`${s.plane}-plane slice through the nucleus · dark lines are nodes`, r.x + 12, r.y + r.h - 10);
}

/** Energy-level (Grotrian) diagram: columns s, p, d, f; height ∝ 1/n (i.e. √|E|). */
function drawLevels(ctx: CanvasRenderingContext2D, r: Rect, s: AtomScene, v: AtomView, stacked: boolean) {
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  if (stacked) {
    ctx.moveTo(r.x, r.y + 0.5);
    ctx.lineTo(r.x + r.w, r.y + 0.5);
  } else {
    ctx.moveTo(r.x + 0.5, r.y);
    ctx.lineTo(r.x + 0.5, r.y + r.h);
  }
  ctx.stroke();

  const padT = 46;
  const padB = 22;
  const labelW = 46;
  const top = r.y + padT;
  const H = r.h - padT - padB;
  const yOf = (n: number) => top + H * (1 / n);
  const colW = (r.w - labelW - 10) / 4;
  const xOf = (l: number) => r.x + labelW + colW * (l + 0.5);

  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('ENERGY LEVELS', r.x + 10, r.y + 16);
  ctx.font = `9.5px ${MONO}`;
  ctx.fillStyle = '#475569';
  ctx.fillText('height ∝ 1/n', r.x + 10, r.y + 28);

  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(r.x + labelW, top);
  ctx.lineTo(r.x + r.w - 6, top);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'right';
  ctx.fillText('0 eV', r.x + labelW - 4, top + 3);

  ctx.textAlign = 'center';
  for (let l = 0; l < 4; l++) {
    ctx.fillStyle = '#64748b';
    ctx.fillText(L_LETTERS[l], xOf(l), r.y + r.h - 7);
  }
  for (let n = 1; n <= 6; n++) {
    const y = yOf(n);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.font = `9.5px ${MONO}`;
    if (n <= 4 || n === 6) ctx.fillText(`${energy(n).toFixed(n === 1 ? 1 : 2)}`, r.x + labelW - 4, y + 3);
    for (let l = 0; l < Math.min(n, 4); l++) {
      const isA = s.primary.n === n && s.primary.l === l;
      const isB = s.partner && s.partner.n === n && s.partner.l === l;
      ctx.strokeStyle = isA ? HCOLORS.primary : isB ? HCOLORS.partner : '#475569';
      ctx.lineWidth = isA || isB ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(xOf(l) - colW * 0.32, y);
      ctx.lineTo(xOf(l) + colW * 0.32, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'left';
    if (n <= 4) ctx.fillText(`n=${n}`, r.x + r.w - 34, y - 3);
  }

  // Transition arrow between the two states of a superposition
  if (s.partner && s.partner.n !== s.primary.n) {
    const up = energy(s.primary.n) > energy(s.partner.n) ? s.primary : s.partner;
    const lo = up === s.primary ? s.partner : s.primary;
    const lambda = photonWavelength(up.n, lo.n);
    const color = wavelengthColor(lambda);
    const xa = xOf(Math.min(up.l, 3));
    const ya = yOf(up.n);
    const xb = xOf(Math.min(lo.l, 3));
    const yb = yOf(lo.n);
    ctx.save();
    ctx.strokeStyle = s.allowed ? color : '#64748b';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    if (!s.allowed) ctx.setLineDash([4, 4]);
    const pulse = v.photon ? 1 + 0.6 * Math.sin((v.now - v.photon.start) / 60) : 1;
    ctx.lineWidth = 2 * pulse;
    ctx.beginPath();
    ctx.moveTo(xa, ya + 3);
    ctx.lineTo(xb, yb - 9);
    ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(yb - 3 - ya, xb - xa);
    ctx.beginPath();
    ctx.moveTo(xb, yb - 3);
    ctx.lineTo(xb - 8 * Math.cos(ang - 0.4), yb - 3 - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(xb - 8 * Math.cos(ang + 0.4), yb - 3 - 8 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.font = `600 10px ${MONO}`;
    ctx.textAlign = 'left';
    const lx = Math.max(xa, xb) + 8;
    const ly = (ya + yb) / 2;
    ctx.fillText(s.allowed ? `${lambda.toFixed(1)} nm` : 'forbidden', Math.min(lx, r.x + r.w - 70), ly);
    ctx.restore();
  }
}

function drawPhoton(ctx: CanvasRenderingContext2D, r: Rect, v: AtomView) {
  if (!v.photon) return;
  const age = (v.now - v.photon.start) / 1000;
  if (age > 1.4) return;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2 + 8;
  const travel = Math.min(r.w, r.h) * 0.75 * age;
  const ang = -0.35;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.strokeStyle = v.photon.color;
  ctx.shadowColor = v.photon.color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = Math.max(0, 1 - age / 1.4);
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const s = travel + 30 + i * 1.6;
    const wiggle = 7 * Math.sin(i * 0.55) * Math.sin((Math.PI * i) / 60);
    const px = cx + ux * s - uy * wiggle;
    const py = cy + uy * s + ux * wiggle;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawAtom(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  s: AtomScene,
  v: AtomView,
  status: { line1: string; line2: string },
) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);
  const stacked = width < 600;
  const levelsW = stacked ? width : Math.max(200, Math.min(260, width * 0.3));
  const levelsH = stacked ? Math.min(220, height * 0.4) : height;
  const atom: Rect = stacked
    ? { x: 0, y: 40, w: width, h: height - levelsH - 40 }
    : { x: 0, y: 40, w: width - levelsW, h: height - 40 };
  const levels: Rect = stacked
    ? { x: 0, y: height - levelsH, w: width, h: levelsH }
    : { x: width - levelsW, y: 0, w: levelsW, h: height };

  if (v.mode === 'cloud') drawCloud(ctx, atom, s, v);
  else drawSlice(ctx, atom, s, v);
  drawPhoton(ctx, atom, v);
  drawLevels(ctx, levels, s, v, stacked);

  // Orbital name badge
  const a = orbitalName(s.primary);
  drawSubscripted(ctx, a.base, a.sub, atom.x + 14, atom.y + 18, 16, HCOLORS.primary);
  if (s.partner) {
    const b = orbitalName(s.partner);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 14px ${MONO}`;
    const w = ctx.measureText(`${a.base}${a.sub}  `).width;
    ctx.fillText('+', atom.x + 18 + w, atom.y + 18);
    drawSubscripted(ctx, b.base, b.sub, atom.x + 34 + w, atom.y + 18, 16, HCOLORS.partner);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const maxW = atom.w - 24;
  ctx.font = `600 10.5px ${MONO}`;
  ctx.fillStyle = HCOLORS.primary;
  ctx.fillText(fitText(ctx, status.line1, maxW), 14, 18);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(fitText(ctx, status.line2, maxW), 14, 32);
}
