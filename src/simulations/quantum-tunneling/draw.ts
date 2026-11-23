import {
  GRID,
  energySpread,
  gridX,
  type ClassicalState,
  type Potential,
  type QuantumParams,
  type Schrodinger1D,
} from './physics';

export const QCOLORS = {
  potential: '#f59e0b',
  energy: '#a3e635',
  density: '#a3e635',
  real: '#38bdf8',
  imag: '#f472b6',
  reflected: '#fb7185',
  transmitted: '#34d399',
  classical: '#e2e8f0',
} as const;

const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface QuantumDrawFlags {
  phaseColors: boolean;
  showReIm: boolean;
  showClassical: boolean;
}

export interface QuantumFrame {
  solver: Schrodinger1D;
  pot: Potential;
  params: QuantumParams;
  classical: ClassicalState;
  rhoMax: number; // fixed vertical scale for |ψ|² during a run
  R: number;
  T: number;
  inside: number; // probability still on the grid
}

/** Hue from complex phase: 0 → red, π/2 → yellow-green, π → cyan, −π/2 → violet. */
function phaseColor(re: number, im: number): string {
  const deg = ((Math.atan2(im, re) * 180) / Math.PI + 360) % 360;
  return `hsl(${deg.toFixed(0)}, 85%, 60%)`;
}

export function drawQuantum(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  f: QuantumFrame,
  flags: QuantumDrawFlags,
) {
  const { solver, pot, params: p } = f;
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, width, height);

  const padL = 16;
  const padR = 52;
  const top = 46;
  const bottom = height - 24;
  const plotW = Math.max(50, width - padL - padR);
  const gapPx = 12;
  const energyH = Math.max(60, (bottom - top - gapPx) * 0.36);
  const eTop = top;
  const eBottom = top + energyH;
  const wTop = eBottom + gapPx;
  const wBottom = bottom;
  const sx = (x: number) => padL + (x / GRID.length) * plotW;

  // Absorbing edges (both panels)
  ctx.fillStyle = 'rgba(100, 116, 139, 0.1)';
  ctx.fillRect(sx(0), eTop, sx(GRID.cap) - sx(0), wBottom - eTop);
  ctx.fillRect(sx(GRID.length - GRID.cap), eTop, sx(GRID.length) - sx(GRID.length - GRID.cap), wBottom - eTop);
  ctx.fillStyle = '#475569';
  ctx.font = `9.5px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('absorber', sx(GRID.cap / 2), wBottom - 6);
  ctx.fillText('absorber', sx(GRID.length - GRID.cap / 2), wBottom - 6);

  // ---------- Energy panel ----------
  const dE = energySpread(p);
  const vVals = pot.regions.map((r) => r.V);
  const eMin = Math.min(0, ...vVals) - 0.6;
  const eMax = Math.max(p.E0 + 2 * dE, ...vVals, 1) * 1.18 + 0.2;
  const sy = (E: number) => eBottom - ((E - eMin) / (eMax - eMin)) * energyH;

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.strokeRect(sx(0), eTop, plotW, energyH);

  // Packet energy band and mean energy
  ctx.fillStyle = 'rgba(163, 230, 53, 0.08)';
  ctx.fillRect(sx(0), sy(p.E0 + dE), plotW, sy(p.E0 - dE) - sy(p.E0 + dE));

  // V(x)
  ctx.strokeStyle = QCOLORS.potential;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(0));
  for (const r of pot.regions) {
    ctx.lineTo(sx(r.x0), sy(0));
    ctx.lineTo(sx(r.x0), sy(r.V));
    ctx.lineTo(sx(r.x1), sy(r.V));
    ctx.lineTo(sx(r.x1), sy(0));
  }
  ctx.lineTo(sx(GRID.length), sy(0));
  ctx.stroke();
  ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
  for (const r of pot.regions) {
    const y0 = sy(0);
    const y1 = sy(r.V);
    ctx.fillRect(sx(r.x0), Math.min(y0, y1), Math.max(1.5, sx(r.x1) - sx(r.x0)), Math.abs(y1 - y0));
  }

  ctx.save();
  ctx.strokeStyle = QCOLORS.energy;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx(0), sy(p.E0));
  ctx.lineTo(sx(GRID.length), sy(p.E0));
  ctx.stroke();
  ctx.restore();

  // Energy axis labels (right side)
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labels: { E: number; text: string; color: string }[] = [
    { E: 0, text: '0 eV', color: '#64748b' },
    { E: p.E0, text: `E₀ ${p.E0.toFixed(2)}`, color: QCOLORS.energy },
  ];
  if (pot.regions.length) labels.push({ E: p.V0, text: `V₀ ${p.V0.toFixed(1)}`, color: QCOLORS.potential });
  labels.sort((a, b) => sy(a.E) - sy(b.E));
  let lastY = -Infinity;
  for (const l of labels) {
    const y = Math.max(sy(l.E), lastY + 12);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, sx(GRID.length) + 6, y);
    lastY = y;
  }
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText('energy', sx(0) + 6, eTop + 10);

  if (flags.showClassical && f.classical.x > 0 && f.classical.x < GRID.length) {
    const cx = sx(f.classical.x);
    const cy = sy(p.E0);
    ctx.save();
    ctx.shadowColor = QCOLORS.classical;
    ctx.shadowBlur = 10;
    ctx.fillStyle = QCOLORS.classical;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `9.5px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('classical', cx, cy - 9);
  }

  // ---------- Wave-function panel ----------
  const waveH = wBottom - wTop;
  ctx.strokeStyle = '#1e293b';
  ctx.strokeRect(sx(0), wTop, plotW, waveH);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
  for (const r of pot.regions) {
    ctx.fillRect(sx(r.x0), wTop, Math.max(1.5, sx(r.x1) - sx(r.x0)), waveH);
  }

  const { re, im, n } = solver;
  const base = wBottom - 1;
  const usable = waveH - 18;
  const yRho = (rho: number) => base - Math.min(1, rho / f.rhoMax) * usable;

  // |ψ|² fill: one column per pixel, coloured by the phase of its densest sample
  const cols = Math.floor(plotW);
  const perCol = n / cols;
  ctx.lineWidth = 1;
  for (let c = 0; c < cols; c++) {
    const j0 = Math.floor(c * perCol);
    const j1 = Math.min(n, Math.floor((c + 1) * perCol) + 1);
    let best = 0;
    let bj = j0;
    for (let j = j0; j < j1; j++) {
      const rho = re[j] * re[j] + im[j] * im[j];
      if (rho > best) {
        best = rho;
        bj = j;
      }
    }
    if (best < f.rhoMax * 2e-4) continue;
    const x = padL + c + 0.5;
    ctx.strokeStyle = flags.phaseColors ? phaseColor(re[bj], im[bj]) : 'rgba(163, 230, 53, 0.75)';
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, yRho(best));
    ctx.stroke();
  }

  // Envelope
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let c = 0; c < cols; c++) {
    const j0 = Math.floor(c * perCol);
    const j1 = Math.min(n, Math.floor((c + 1) * perCol) + 1);
    let best = 0;
    for (let j = j0; j < j1; j++) best = Math.max(best, re[j] * re[j] + im[j] * im[j]);
    const x = padL + c + 0.5;
    if (c === 0) ctx.moveTo(x, yRho(best));
    else ctx.lineTo(x, yRho(best));
  }
  ctx.stroke();

  if (flags.showReIm) {
    const amp = Math.sqrt(f.rhoMax);
    const mid = wTop + waveH / 2;
    const half = (waveH / 2) * 0.9;
    for (const [arr, color] of [
      [re, QCOLORS.real],
      [im, QCOLORS.imag],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j < n; j += 1) {
        const x = sx(gridX(j));
        const y = mid - Math.max(-1, Math.min(1, arr[j] / amp)) * half;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(flags.showReIm ? '|ψ|²  ·  Re ψ  ·  Im ψ' : '|ψ|² (colour = phase)', sx(0) + 6, wTop + 13);

  if (pot.regions.length) {
    ctx.font = `600 11px ${MONO}`;
    ctx.fillStyle = QCOLORS.reflected;
    ctx.fillText(`R = ${f.R.toFixed(3)}`, sx(GRID.cap) + 8, wTop + 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = QCOLORS.transmitted;
    ctx.fillText(`T = ${f.T.toFixed(3)}`, sx(GRID.length - GRID.cap) - 8, wTop + 30);
  }

  // x axis
  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 0; x <= GRID.length; x += 10) ctx.fillText(`${x}`, sx(x), wBottom + 5);
  ctx.textAlign = 'right';
  ctx.fillText('x (nm)', sx(GRID.length) + padR - 4, wBottom + 5);

  // Status
  const vMax = pot.regions.length ? Math.max(...vVals) : 0;
  const narrow = width < 600;
  let line1: string;
  let color: string = QCOLORS.energy;
  if (p.kind === 'free') {
    line1 = narrow ? 'FREE PACKET · spreads with no forces' : 'FREE WAVE PACKET · no forces, yet the packet spreads as it travels';
  } else if (p.kind === 'double') {
    line1 = narrow
      ? 'RESONANT TUNNELING · two barriers'
      : `RESONANT TUNNELING · two barriers, E₀ = ${p.E0.toFixed(2)} eV < V₀ = ${p.V0.toFixed(1)} eV`;
    color = QCOLORS.transmitted;
  } else if (p.V0 < 0) {
    line1 = narrow ? 'POTENTIAL WELL · still reflects' : 'POTENTIAL WELL · a dip in V still reflects part of the wave';
    color = QCOLORS.real;
  } else if (p.E0 < vMax) {
    line1 = narrow
      ? 'TUNNELING · E₀ < V₀: classically forbidden'
      : `TUNNELING · E₀ = ${p.E0.toFixed(2)} eV < V₀ = ${p.V0.toFixed(1)} eV: classically forbidden`;
    color = QCOLORS.transmitted;
  } else {
    line1 = narrow
      ? 'OVER THE BARRIER · E₀ > V₀, yet some reflects'
      : `OVER THE BARRIER · E₀ = ${p.E0.toFixed(2)} eV > V₀ = ${p.V0.toFixed(1)} eV, yet some reflects`;
    color = QCOLORS.reflected;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 10.5px ${MONO}`;
  ctx.fillStyle = color;
  ctx.fillText(line1, 16, 20);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#64748b';
  if (f.inside < 2e-3) {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(
      narrow
        ? 'Run complete. Press Reset to fire again.'
        : `Run complete at t = ${solver.t.toFixed(1)} fs: the packet has left the domain. Press Reset to fire again.`,
      16,
      35,
    );
  } else {
    ctx.fillText(
      narrow
        ? `t = ${solver.t.toFixed(2)} fs · electron`
        : `t = ${solver.t.toFixed(2)} fs  (8 fs of physics per second at 1x) · electron`,
      16,
      35,
    );
  }
}
