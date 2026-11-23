import { electronWavelength, type Pattern, type SlitParams } from './physics';

export const SCOLORS = {
  wave: '#a3e635',
  dot: '#d9f99d',
  plate: '#64748b',
  detector: '#f59e0b',
  theory: '#e2e8f0',
} as const;

const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const FLIGHT_SECONDS = 0.35;

export interface Hits {
  x: Float32Array; // screen position (nm)
  y: Float32Array; // vertical position on the detector, 0..1 (slits are long in y)
  count: number;
}

export interface Flight {
  fired: number; // performance.now() ms
  x: number;
  y: number;
  landed?: boolean; // recorded on the detector once its flight time has elapsed
}

export interface SlitFrame {
  params: SlitParams;
  pattern: Pattern;
  hits: Hits;
  flights: Flight[];
  now: number;
  showTheory: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function formatLength(nm: number): string {
  const a = Math.abs(nm);
  if (a >= 1e6) return `${(nm / 1e6).toPrecision(3)} mm`;
  if (a >= 1e3) return `${(nm / 1e3).toPrecision(3)} µm`;
  return `${nm.toPrecision(3)} nm`;
}

export function layout(width: number, height: number): { apparatus: Rect; detector: Rect } {
  if (width < 600) {
    const ah = Math.round(height * 0.42);
    return { apparatus: { x: 0, y: 40, w: width, h: ah - 40 }, detector: { x: 0, y: ah, w: width, h: height - ah } };
  }
  const aw = Math.round(width * 0.46);
  return { apparatus: { x: 0, y: 40, w: aw, h: height - 40 }, detector: { x: aw, y: 0, w: width - aw, h: height } };
}

/** Inner square of the detector panel where hits are plotted. */
export function detectorFace(r: Rect): Rect {
  const pad = 14;
  const top = 34;
  const bottom = 28;
  const w = r.w - 2 * pad;
  const h = r.h - top - bottom;
  return { x: r.x + pad, y: r.y + top, w, h };
}

function drawApparatus(ctx: CanvasRenderingContext2D, r: Rect, f: SlitFrame) {
  const p = f.params;
  const cy = r.y + r.h / 2;
  const gunX = r.x + 26;
  const plateX = r.x + r.w * 0.42;
  const screenX = r.x + r.w - 22;
  const halfH = Math.min(r.h * 0.42, 190);
  const dpx = 40;
  const apx = Math.max(4, Math.min(dpx - 6, (dpx * p.width) / p.separation));
  const slitY = [cy - dpx / 2, cy + dpx / 2];
  const open = [p.mode !== 'right', p.mode !== 'left'];
  const t = f.now / 1000;

  // Incoming plane wave (schematic wavelength)
  ctx.save();
  ctx.beginPath();
  ctx.rect(gunX + 12, cy - halfH * 0.55, plateX - gunX - 14, halfH * 1.1);
  ctx.clip();
  ctx.strokeStyle = SCOLORS.wave;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1.2;
  const spacing = 13;
  const offset = (t * 40) % spacing;
  for (let x = gunX + 12 + offset; x < plateX; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, cy - halfH * 0.55);
    ctx.lineTo(x, cy + halfH * 0.55);
    ctx.stroke();
  }
  ctx.restore();

  // Interference fan: brightness of each screen point, drawn as a ray from the slits
  let iMax = 0;
  for (let i = 0; i < f.pattern.I.length; i++) iMax = Math.max(iMax, f.pattern.I[i]);
  const rows = Math.round(halfH * 2);
  ctx.save();
  ctx.lineWidth = 1;
  for (let k = 0; k < rows; k++) {
    const frac = k / (rows - 1);
    const idx = Math.round(frac * (f.pattern.I.length - 1));
    const v = iMax > 0 ? f.pattern.I[idx] / iMax : 0;
    if (v < 0.01) continue;
    ctx.strokeStyle = SCOLORS.wave;
    ctx.globalAlpha = 0.22 * v;
    ctx.beginPath();
    ctx.moveTo(plateX + 3, cy);
    ctx.lineTo(screenX, cy - halfH + frac * 2 * halfH);
    ctx.stroke();
  }
  ctx.restore();

  // Electron gun
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = '#64748b';
  ctx.fillRect(gunX - 16, cy - 12, 26, 24);
  ctx.strokeRect(gunX - 16, cy - 12, 26, 24);
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.arc(gunX - 3, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Slit plate
  ctx.fillStyle = SCOLORS.plate;
  const plateTop = cy - halfH;
  const plateBottom = cy + halfH;
  const gaps = slitY.map((y) => [y - apx / 2, y + apx / 2]);
  ctx.fillRect(plateX - 2, plateTop, 5, gaps[0][0] - plateTop);
  ctx.fillRect(plateX - 2, gaps[0][1], 5, gaps[1][0] - gaps[0][1]);
  ctx.fillRect(plateX - 2, gaps[1][1], 5, plateBottom - gaps[1][1]);
  gaps.forEach((g, i) => {
    if (!open[i]) {
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(plateX - 2, g[0], 5, g[1] - g[0]);
    }
  });

  // Which-path detector: a light source scattering photons off electrons at the slits
  if (p.which > 0 && p.mode === 'both') {
    const lx = plateX + 26;
    const ly = cy - dpx - 26;
    ctx.save();
    ctx.shadowColor = SCOLORS.detector;
    ctx.shadowBlur = 14 * p.which;
    ctx.fillStyle = SCOLORS.detector;
    ctx.globalAlpha = 0.4 + 0.6 * p.which;
    ctx.beginPath();
    ctx.arc(lx, ly, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = SCOLORS.detector;
    ctx.globalAlpha = 0.5 * p.which;
    for (const y of slitY) {
      ctx.beginPath();
      ctx.moveTo(lx - 4, ly + 4);
      ctx.lineTo(plateX + 3, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = SCOLORS.detector;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(`which-path light D = ${p.which.toFixed(2)}`, lx + 10, ly + 4);
  }

  // Screen
  ctx.fillStyle = '#334155';
  ctx.fillRect(screenX, plateTop, 4, plateBottom - plateTop);

  // Electrons in flight: a packet to the slits, then waves from every open slit
  const toY = (X: number) => cy + (X / f.pattern.halfWidth) * halfH;
  for (const fl of f.flights) {
    const age = (f.now - fl.fired) / 1000 / FLIGHT_SECONDS;
    if (age < 0 || age > 1) continue;
    if (age < 0.45) {
      const x = gunX + (plateX - gunX) * (age / 0.45);
      ctx.save();
      ctx.shadowColor = SCOLORS.wave;
      ctx.shadowBlur = 10;
      ctx.fillStyle = SCOLORS.wave;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(x, cy, 4, dpx * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      const rad = ((age - 0.45) / 0.55) * (screenX - plateX);
      ctx.save();
      ctx.strokeStyle = SCOLORS.wave;
      ctx.globalAlpha = 0.55 * (1 - (age - 0.45) / 0.55);
      ctx.lineWidth = 1.5;
      slitY.forEach((y, i) => {
        if (!open[i]) return;
        ctx.beginPath();
        ctx.arc(plateX + 3, y, rad, -0.9, 0.9);
        ctx.stroke();
      });
      ctx.restore();
    }
  }
  // Recent landings on the side-view screen
  for (const fl of f.flights) {
    const since = (f.now - fl.fired) / 1000 - FLIGHT_SECONDS;
    if (since < 0 || since > 0.4) continue;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = SCOLORS.dot;
    ctx.shadowBlur = 10;
    ctx.globalAlpha = 1 - since / 0.4;
    ctx.beginPath();
    ctx.arc(screenX + 2, toY(fl.x), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('gun', gunX - 3, cy + 26);
  ctx.fillText(p.mode === 'both' ? 'two slits' : 'one slit open', plateX, plateBottom + 14);
  ctx.fillText('screen', screenX + 2, plateBottom + 14);
  ctx.textAlign = 'left';
  ctx.fillText(`λ = ${(electronWavelength(p.energy) * 1000).toFixed(2)} pm`, gunX + 14, cy - halfH * 0.55 - 6);
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'right';
  ctx.fillText('side view, not to scale', r.x + r.w - 10, r.y + 12);
}

let accum: HTMLCanvasElement | null = null;
let accumKey = '';
let accumDrawn = 0;

/** Draws the detector face; hits are rasterized incrementally onto an offscreen canvas. */
function drawDetector(ctx: CanvasRenderingContext2D, r: Rect, f: SlitFrame, dpr: number) {
  ctx.fillStyle = '#0a0f1c';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(r.x + 0.5, r.y);
  ctx.lineTo(r.x + 0.5, r.y + r.h);
  ctx.stroke();
  const face = detectorFace(r);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(face.x, face.y, face.w, face.h);

  const W = f.pattern.halfWidth;
  const key = `${Math.round(face.w * dpr)}x${Math.round(face.h * dpr)}:${W}`;
  if (!accum || key !== accumKey || f.hits.count < accumDrawn) {
    accum = document.createElement('canvas');
    accum.width = Math.max(1, Math.round(face.w * dpr));
    accum.height = Math.max(1, Math.round(face.h * dpr));
    accumKey = key;
    accumDrawn = 0;
  }
  const actx = accum.getContext('2d');
  if (actx) {
    const size = Math.max(1, 1.4 * dpr);
    actx.fillStyle = SCOLORS.dot;
    actx.globalAlpha = 0.6;
    for (let i = accumDrawn; i < f.hits.count; i++) {
      const px = ((f.hits.x[i] + W) / (2 * W)) * accum.width;
      const py = f.hits.y[i] * accum.height;
      actx.fillRect(px - size / 2, py - size / 2, size, size);
    }
    accumDrawn = f.hits.count;
    ctx.drawImage(accum, face.x, face.y, face.w, face.h);
  }

  // Fresh hits flash
  for (const fl of f.flights) {
    const since = (f.now - fl.fired) / 1000 - FLIGHT_SECONDS;
    if (since < 0 || since > 0.5) continue;
    const px = face.x + ((fl.x + W) / (2 * W)) * face.w;
    const py = face.y + fl.y * face.h;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 1 - since / 0.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 3 + 10 * since, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (f.showTheory) {
    let iMax = 0;
    for (let i = 0; i < f.pattern.I.length; i++) iMax = Math.max(iMax, f.pattern.I[i]);
    ctx.save();
    ctx.strokeStyle = SCOLORS.theory;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < f.pattern.I.length; i += 2) {
      const px = face.x + (i / (f.pattern.I.length - 1)) * face.w;
      const py = face.y + face.h - 4 - (f.pattern.I[i] / (iMax || 1)) * face.h * 0.3;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('DETECTOR SCREEN (face-on)', r.x + 14, r.y + 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = SCOLORS.dot;
  ctx.fillText(`${f.hits.count.toLocaleString()} electrons`, r.x + r.w - 14, r.y + 16);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(`−${formatLength(W)}`, face.x, face.y + face.h + 16);
  ctx.textAlign = 'right';
  ctx.fillText(`+${formatLength(W)}`, face.x + face.w, face.y + face.h + 16);
  ctx.textAlign = 'center';
  ctx.fillText('0', face.x + face.w / 2, face.y + face.h + 16);
}

export function drawSlitLab(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  f: SlitFrame,
  status: { line1: string; line2: string },
) {
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);
  const { apparatus, detector } = layout(width, height);
  drawApparatus(ctx, apparatus, f);
  drawDetector(ctx, detector, f, dpr);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const maxW = apparatus.w - 20;
  const fit = (s: string) => {
    if (ctx.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  ctx.font = `600 10.5px ${MONO}`;
  ctx.fillStyle = SCOLORS.wave;
  ctx.fillText(fit(status.line1), 12, 18);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(fit(status.line2), 12, 32);
}
