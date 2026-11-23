import type { Basis, Coefficients, WellParams } from './physics';

export const BCOLORS = {
  potential: '#f59e0b',
  level: '#475569',
  active: '#a3e635',
  meanE: '#e2e8f0',
  real: '#38bdf8',
  imag: '#f472b6',
} as const;

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface BoundFrame {
  basis: Basis;
  params: WellParams;
  coeffs: Coefficients;
  probs: number[];
  re: Float64Array;
  im: Float64Array;
  rhoMax: number;
  meanE: number;
  t: number;
  stateLabel: string;
}

export interface BoundFlags {
  phaseColors: boolean;
  showReIm: boolean;
}

/** Physics label for a level index k (0-based): the oscillator counts from 0, wells from 1. */
export function levelLabel(kind: WellParams['kind'], k: number): number {
  return kind === 'harmonic' ? k : k + 1;
}

function phaseColor(re: number, im: number): string {
  const deg = ((Math.atan2(im, re) * 180) / Math.PI + 360) % 360;
  return `hsl(${deg.toFixed(0)}, 85%, 60%)`;
}

/** Energy range shown: covers the populated levels plus the relevant part of the potential. */
function energyRange(f: BoundFrame): { lo: number; hi: number } {
  const { basis, params: p, probs } = f;
  let eTop = -Infinity;
  probs.forEach((pr, k) => {
    if (pr > 1e-3) eTop = Math.max(eTop, basis.energies[k]);
  });
  const e = basis.energies;
  switch (p.kind) {
    case 'box':
      return { lo: -0.08 * e[2], hi: Math.max(eTop, e[2]) * 1.15 };
    case 'harmonic':
      return { lo: -0.1 * p.hw, hi: Math.max(eTop, e[3]) * 1.15 };
    case 'finite':
      return { lo: -p.V0 * 1.08, hi: Math.max(0.3 * p.V0, eTop + 0.1 * p.V0) };
    case 'double':
      return { lo: -0.08 * Math.max(p.V0, e[1]), hi: Math.max(p.V0 * 1.15, eTop * 1.12, e[2] * 1.1) };
  }
}

export function drawBound(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  f: BoundFrame,
  flags: BoundFlags,
) {
  const { basis, params: p, probs, re, im } = f;
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);

  const narrow = width < 600;
  const ladderW = narrow ? 78 : 118;
  const padL = 16;
  const top = 46;
  const bottom = height - 24;
  const plotW = Math.max(60, width - padL - ladderW - 14);
  const gap = 12;
  const energyH = (bottom - top - gap) * 0.5;
  const eTop = top;
  const eBottom = top + energyH;
  const wTop = eBottom + gap;
  const wBottom = bottom;
  const span = basis.xMax - basis.xMin;
  const margin = p.kind === 'box' || p.kind === 'double' ? 0.12 * span : 0;
  const x0 = basis.xMin - margin;
  const x1 = basis.xMax + margin;
  const sx = (x: number) => padL + ((x - x0) / (x1 - x0)) * plotW;
  const { lo, hi } = energyRange(f);
  const sy = (E: number) => eBottom - ((E - lo) / (hi - lo)) * energyH;
  const clampY = (y: number) => Math.max(eTop, Math.min(eBottom, y));

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, eTop, plotW, energyH);
  ctx.strokeRect(padL, wTop, plotW, wBottom - wTop);

  // ---------- Potential ----------
  const walls = p.kind === 'box' || p.kind === 'double';
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, eTop, plotW, energyH);
  ctx.clip();
  ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
  if (walls) {
    ctx.fillRect(padL, eTop, sx(basis.xMin) - padL, energyH);
    ctx.fillRect(sx(basis.xMax), eTop, padL + plotW - sx(basis.xMax), energyH);
  }
  for (const r of basis.regions) {
    const y0 = clampY(sy(0));
    const y1 = clampY(sy(r.V));
    ctx.fillRect(sx(r.x0), Math.min(y0, y1), sx(r.x1) - sx(r.x0), Math.abs(y1 - y0));
  }
  ctx.strokeStyle = BCOLORS.potential;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (p.kind === 'harmonic') {
    for (let j = 0; j < basis.x.length; j += 4) {
      const y = sy(basis.V[j]);
      if (j === 0) ctx.moveTo(sx(basis.x[j]), y);
      else ctx.lineTo(sx(basis.x[j]), y);
    }
  } else {
    if (walls) {
      ctx.moveTo(sx(basis.xMin), eTop);
      ctx.lineTo(sx(basis.xMin), sy(0));
    } else {
      ctx.moveTo(sx(basis.xMin), sy(0));
    }
    for (const r of basis.regions) {
      ctx.lineTo(sx(r.x0), sy(0));
      ctx.lineTo(sx(r.x0), sy(r.V));
      ctx.lineTo(sx(r.x1), sy(r.V));
      ctx.lineTo(sx(r.x1), sy(0));
    }
    ctx.lineTo(sx(basis.xMax), sy(0));
    if (walls) ctx.lineTo(sx(basis.xMax), eTop);
  }
  ctx.stroke();

  // ---------- Energy levels (drawn only where classically allowed, V ≤ E) ----------
  const shownLevels: number[] = [];
  for (let k = 0; k < basis.boundCount; k++) {
    const E = basis.energies[k];
    if (E > hi) break;
    shownLevels.push(k);
    const active = probs[k] > 1e-3;
    ctx.strokeStyle = active ? BCOLORS.active : BCOLORS.level;
    ctx.lineWidth = active ? 2 : 1;
    const y = sy(E);
    let start = -1;
    for (let j = 0; j <= basis.x.length; j++) {
      const allowed = j < basis.x.length && basis.V[j] <= E;
      if (allowed && start < 0) start = j;
      if (!allowed && start >= 0) {
        ctx.beginPath();
        ctx.moveTo(sx(basis.x[start]), y);
        ctx.lineTo(sx(basis.x[j - 1]), y);
        ctx.stroke();
        start = -1;
      }
    }
  }
  // Mean energy
  ctx.save();
  ctx.strokeStyle = BCOLORS.meanE;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, sy(f.meanE));
  ctx.lineTo(padL + plotW, sy(f.meanE));
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('energy', padL + 6, eTop + 12);

  // ---------- Level ladder: measurement probabilities |c_n|² ----------
  const lx = padL + plotW + 10;
  ctx.font = `9.5px ${MONO}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(narrow ? 'P(E_n)' : 'P(measure E_n)', lx, eTop + 10);
  let lastY = Infinity;
  for (const k of shownLevels) {
    const y = sy(basis.energies[k]);
    if (lastY - y < 9 || y < eTop + 18) continue; // skip labels that would overlap
    lastY = y;
    const pr = probs[k];
    const barMax = ladderW - (narrow ? 34 : 44);
    ctx.fillStyle = pr > 1e-3 ? BCOLORS.active : '#334155';
    ctx.fillRect(lx + (narrow ? 24 : 30), y - 3, Math.max(1, pr * barMax), 6);
    ctx.fillStyle = pr > 1e-3 ? '#d9f99d' : '#64748b';
    ctx.textBaseline = 'middle';
    ctx.fillText(`n=${levelLabel(p.kind, k)}`, lx, y);
  }
  ctx.textBaseline = 'alphabetic';
  if (f.meanE >= lo && f.meanE <= hi) {
    ctx.fillStyle = BCOLORS.meanE;
    ctx.fillText('<E>', padL + plotW - 30, sy(f.meanE) - 4);
  }

  // ---------- Wave function ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, wTop, plotW, wBottom - wTop);
  ctx.clip();
  ctx.fillStyle = 'rgba(245, 158, 11, 0.07)';
  if (walls) {
    ctx.fillRect(padL, wTop, sx(basis.xMin) - padL, wBottom - wTop);
    ctx.fillRect(sx(basis.xMax), wTop, padL + plotW - sx(basis.xMax), wBottom - wTop);
  }
  for (const r of basis.regions) ctx.fillRect(sx(r.x0), wTop, sx(r.x1) - sx(r.x0), wBottom - wTop);

  const base = wBottom - 1;
  const usable = wBottom - wTop - 18;
  const yRho = (rho: number) => base - Math.min(1, rho / f.rhoMax) * usable;
  const n = basis.x.length;
  const c0 = Math.max(0, Math.floor(sx(basis.xMin) - padL));
  const c1 = Math.min(Math.floor(plotW), Math.ceil(sx(basis.xMax) - padL));
  const colToJ = (c: number) => ((x0 + ((c + 0.5) / plotW) * (x1 - x0) - basis.xMin) / basis.dx);
  ctx.lineWidth = 1;
  const env: [number, number][] = [];
  for (let c = c0; c < c1; c++) {
    const ja = Math.max(0, Math.floor(colToJ(c - 0.5)));
    const jb = Math.min(n - 1, Math.ceil(colToJ(c + 0.5)));
    let best = 0;
    let bj = ja;
    for (let j = ja; j <= jb; j++) {
      const rho = re[j] * re[j] + im[j] * im[j];
      if (rho > best) {
        best = rho;
        bj = j;
      }
    }
    const x = padL + c + 0.5;
    env.push([x, yRho(best)]);
    if (best < f.rhoMax * 2e-4) continue;
    ctx.strokeStyle = flags.phaseColors ? phaseColor(re[bj], im[bj]) : 'rgba(163, 230, 53, 0.75)';
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, yRho(best));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  env.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();

  if (flags.showReIm) {
    const amp = Math.sqrt(f.rhoMax);
    const mid = wTop + (wBottom - wTop) / 2;
    const half = ((wBottom - wTop) / 2) * 0.9;
    for (const [arr, color] of [
      [re, BCOLORS.real],
      [im, BCOLORS.imag],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let j = 0; j < n; j += 2) {
        const x = sx(basis.x[j]);
        const y = mid - Math.max(-1, Math.min(1, arr[j] / amp)) * half;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(flags.showReIm ? '|ψ|²  ·  Re ψ  ·  Im ψ' : '|ψ|² (colour = phase)', padL + 6, wTop + 13);

  // x axis
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const step = x1 - x0 > 5 ? 1 : x1 - x0 > 2 ? 0.5 : 0.25;
  for (let x = Math.ceil(x0 / step) * step; x <= x1 + 1e-9; x += step) {
    ctx.fillText(`${+x.toFixed(2)}`, sx(x), wBottom + 5);
  }
  ctx.textAlign = 'right';
  ctx.fillText('x (nm)', width - 8, wBottom + 5);

  // Status
  const e = basis.energies;
  let line1: string;
  switch (p.kind) {
    case 'box':
      line1 = narrow
        ? `BOX · E_n = n² E1, E1 = ${e[0].toFixed(3)} eV`
        : `PARTICLE IN A BOX · E_n = n² × E1, with E1 = ${e[0].toFixed(3)} eV`;
      break;
    case 'harmonic':
      line1 = narrow
        ? `OSCILLATOR · spacing ħω = ${p.hw.toFixed(2)} eV`
        : `HARMONIC OSCILLATOR · E_n = (n + ½)ħω, evenly spaced by ħω = ${p.hw.toFixed(2)} eV`;
      break;
    case 'finite':
      line1 = narrow
        ? `FINITE WELL · ${basis.boundCount} bound states`
        : `FINITE WELL · ${basis.boundCount} bound state${basis.boundCount === 1 ? '' : 's'}, and the wave leaks into the walls`;
      break;
    case 'double': {
      const dE = e[1] - e[0];
      line1 = narrow
        ? `DOUBLE WELL · ΔE = ${(dE * 1000).toFixed(0)} meV`
        : `DOUBLE WELL · tunneling splitting ΔE = ${(dE * 1000).toFixed(0)} meV, period h/ΔE = ${((2 * Math.PI * 0.6582119569) / dE).toFixed(1)} fs`;
      break;
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10.5px ${MONO}`;
  ctx.fillStyle = BCOLORS.active;
  ctx.fillText(line1, 16, 20);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    narrow ? `${f.stateLabel} · t = ${f.t.toFixed(2)} fs` : `${f.stateLabel} · t = ${f.t.toFixed(2)} fs (2 fs of physics per second at 1x)`,
    16,
    35,
  );
}
