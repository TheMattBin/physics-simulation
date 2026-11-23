/**
 * One-dimensional time-dependent Schrödinger equation for an electron:
 *   iħ ∂ψ/∂t = −(ħ²/2m) ∂²ψ/∂x² + V(x) ψ
 *
 * Units: x in nm, t in fs, energies in eV, electron mass.
 *
 * Space: second-order finite differences on a uniform grid. Time: Crank–Nicolson,
 *   (1 + iΔt H/2ħ) ψⁿ⁺¹ = (1 − iΔt H/2ħ) ψⁿ,
 * which is unitary for Hermitian H, so total probability is conserved exactly (to round-off).
 *
 * Absorbing edges: a complex absorbing potential −iW(x) near both ends soaks up outgoing waves.
 * For Crank–Nicolson the probability it removes in one step is exactly
 *   (2Δt/ħ) Σ W_j |ψ_mid,j|² Δx,  with ψ_mid = (ψⁿ + ψⁿ⁺¹)/2,
 * so absorbed probability is tracked per edge and "inside + absorbed = 1" holds to round-off.
 *
 * This module has no imports so it runs standalone in Node.
 */

export const HBAR = 0.6582119569; // eV·fs
export const ALPHA = 0.0380998212; // ħ²/2mₑ in eV·nm²

export const GRID = {
  length: 70, // nm
  dx: 0.01, // nm
  center: 35, // nm — potential features are centred here
  cap: 6, // nm of absorber at each end
  capStrength: 3, // eV — peak absorbing potential
  dt: 0.01, // fs
} as const;

export type PotentialKind = 'free' | 'barrier' | 'double';

export interface QuantumParams {
  kind: PotentialKind;
  E0: number; // mean packet energy (eV)
  sigma0: number; // initial packet width σ (nm)
  V0: number; // barrier height (eV); negative values make a well
  width: number; // barrier width a (nm)
  gap: number; // spacing between the two barriers (nm), double only
}

export interface Potential {
  V: Float64Array; // real potential (eV)
  W: Float64Array; // absorbing potential (eV), zero outside the edges
  regions: { x0: number; x1: number; V: number }[]; // the non-zero pieces, in nm
  left: number; // x where the scattering region starts (nm)
  right: number; // x where it ends (nm)
}

export const GRID_POINTS = Math.round(GRID.length / GRID.dx) + 1;

export function gridX(j: number): number {
  return j * GRID.dx;
}

/** Builds V and W. Edges sit halfway between grid points, so a width of n·dx is exactly n cells. */
export function buildPotential(p: QuantumParams): Potential {
  const n = GRID_POINTS;
  const V = new Float64Array(n);
  const W = new Float64Array(n);
  const dx = GRID.dx;

  const capCells = GRID.cap / dx;
  for (let j = 0; j < n; j++) {
    const fromLeft = (capCells - j) / capCells;
    const fromRight = (j - (n - 1 - capCells)) / capCells;
    const s = Math.max(fromLeft, fromRight);
    if (s > 0) W[j] = GRID.capStrength * s * s;
  }

  const regions: Potential['regions'] = [];
  const c = Math.round(GRID.center / dx);
  if (p.kind === 'barrier' || p.kind === 'double') {
    const w = Math.max(1, Math.round(p.width / dx));
    const g = p.kind === 'double' ? Math.max(1, Math.round(p.gap / dx)) : 0;
    const total = p.kind === 'double' ? 2 * w + g : w;
    const start = c - Math.floor(total / 2);
    const pieces = p.kind === 'double' ? [start, start + w + g] : [start];
    for (const s of pieces) {
      for (let j = s; j < s + w; j++) V[j] = p.V0;
      regions.push({ x0: (s - 0.5) * dx, x1: (s + w - 0.5) * dx, V: p.V0 });
    }
  }
  const left = regions.length ? regions[0].x0 : GRID.center;
  const right = regions.length ? regions[regions.length - 1].x1 : GRID.center;
  return { V, W, regions, left, right };
}

export function packetK0(E0: number): number {
  return Math.sqrt(Math.max(0, E0) / ALPHA);
}

/** Starting centre: at least 4σ clear of the absorber and of the scattering region. */
export function packetStart(p: QuantumParams, pot: Potential): number {
  const clearOfAbsorber = GRID.cap + 4 * p.sigma0 + 0.5;
  if (p.kind === 'free') return clearOfAbsorber + 1.5;
  return Math.max(clearOfAbsorber, pot.left - 4 * p.sigma0 - 0.5);
}

/** Group velocity ħk/m = 2αk/ħ in nm/fs. */
export function groupVelocity(E0: number): number {
  return (2 * ALPHA * packetK0(E0)) / HBAR;
}

/** Free-particle packet width: σ(t) = σ₀ √(1 + (ħt / 2mσ₀²)²) = σ₀ √(1 + (αt / ħσ₀²)²). */
export function freeWidth(sigma0: number, t: number): number {
  const s = (ALPHA * t) / (HBAR * sigma0 * sigma0);
  return sigma0 * Math.sqrt(1 + s * s);
}

export interface Observables {
  inside: number; // ∫|ψ|² over the grid
  left: number; // probability left of the scattering region (on the grid)
  middle: number; // inside the scattering region
  right: number; // right of the scattering region
  meanX: number;
  sigmaX: number;
}

export class Schrodinger1D {
  readonly n = GRID_POINTS;
  re = new Float64Array(GRID_POINTS);
  im = new Float64Array(GRID_POINTS);
  t = 0;
  absorbedLeft = 0;
  absorbedRight = 0;

  private oldRe = new Float64Array(GRID_POINTS);
  private oldIm = new Float64Array(GRID_POINTS);
  private dRe = new Float64Array(GRID_POINTS);
  private dIm = new Float64Array(GRID_POINTS);
  private cpRe = new Float64Array(GRID_POINTS);
  private cpIm = new Float64Array(GRID_POINTS);
  private invRe = new Float64Array(GRID_POINTS);
  private invIm = new Float64Array(GRID_POINTS);
  private readonly h: Float64Array; // 2α/dx² + V
  private readonly W: Float64Array;
  private readonly kappa = ALPHA / (GRID.dx * GRID.dx);
  private readonly beta = GRID.dt / (2 * HBAR);
  private readonly mid: number;

  constructor(pot: Potential) {
    this.W = pot.W;
    this.h = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) this.h[j] = 2 * this.kappa + pot.V[j];
    this.mid = Math.round(GRID.center / GRID.dx);
    this.factorize();
  }

  /** Thomas-algorithm factorization of A = I + iβH, which never changes during a run. */
  private factorize() {
    const { n, beta, kappa, h, W } = this;
    // Off-diagonals of A: a = c = −iβκ
    const cIm = -beta * kappa;
    let prevCpRe = 0;
    let prevCpIm = 0;
    for (let j = 0; j < n; j++) {
      // m = b_j − a·c'_{j−1},  b_j = (1 + βW_j) + iβh_j
      let mRe = 1 + beta * W[j];
      let mIm = beta * h[j];
      if (j > 0) {
        // a·c' with a = (0, cIm)
        mRe -= -cIm * prevCpIm;
        mIm -= cIm * prevCpRe;
      }
      const den = mRe * mRe + mIm * mIm;
      const iRe = mRe / den;
      const iIm = -mIm / den;
      this.invRe[j] = iRe;
      this.invIm[j] = iIm;
      // c'_j = c / m = (0, cIm)·inv
      const cpRe = -cIm * iIm;
      const cpIm = cIm * iRe;
      this.cpRe[j] = cpRe;
      this.cpIm[j] = cpIm;
      prevCpRe = cpRe;
      prevCpIm = cpIm;
    }
  }

  /** Gaussian packet centred at x0 moving right with mean energy E0, normalized on the grid. */
  setGaussian(x0: number, sigma: number, E0: number) {
    const k0 = packetK0(E0);
    let norm = 0;
    // The end points are the hard walls (ψ = 0); leave them out before normalizing.
    for (let j = 0; j < this.n; j++) {
      const x = gridX(j);
      const env = j === 0 || j === this.n - 1 ? 0 : Math.exp(-((x - x0) ** 2) / (4 * sigma * sigma));
      this.re[j] = env * Math.cos(k0 * x);
      this.im[j] = env * Math.sin(k0 * x);
      norm += env * env;
    }
    const s = 1 / Math.sqrt(norm * GRID.dx);
    for (let j = 0; j < this.n; j++) {
      this.re[j] *= s;
      this.im[j] *= s;
    }
    this.t = 0;
    this.absorbedLeft = 0;
    this.absorbedRight = 0;
  }

  step() {
    const { n, re, im, oldRe, oldIm, dRe, dIm, h, W, kappa, beta, cpRe, cpIm, invRe, invIm } = this;
    oldRe.set(re);
    oldIm.set(im);

    // d = (I − iβH) ψ,   Hψ = (h − iW)ψ − κ(ψ_{j−1} + ψ_{j+1})
    for (let j = 0; j < n; j++) {
      const lr = j > 0 ? oldRe[j - 1] : 0;
      const li = j > 0 ? oldIm[j - 1] : 0;
      const rr = j < n - 1 ? oldRe[j + 1] : 0;
      const ri = j < n - 1 ? oldIm[j + 1] : 0;
      const pr = oldRe[j];
      const pi = oldIm[j];
      const hr = h[j] * pr + W[j] * pi - kappa * (lr + rr);
      const hi = h[j] * pi - W[j] * pr - kappa * (li + ri);
      dRe[j] = pr + beta * hi;
      dIm[j] = pi - beta * hr;
    }

    // Forward sweep: d'_j = (d_j − a·d'_{j−1}) / m_j with a = (0, −βκ)
    const aIm = -beta * kappa;
    let pRe = 0;
    let pIm = 0;
    for (let j = 0; j < n; j++) {
      let xr = dRe[j];
      let xi = dIm[j];
      if (j > 0) {
        xr -= -aIm * pIm;
        xi -= aIm * pRe;
      }
      const yr = xr * invRe[j] - xi * invIm[j];
      const yi = xr * invIm[j] + xi * invRe[j];
      dRe[j] = yr;
      dIm[j] = yi;
      pRe = yr;
      pIm = yi;
    }
    // Back substitution: ψ_j = d'_j − c'_j ψ_{j+1}
    re[n - 1] = dRe[n - 1];
    im[n - 1] = dIm[n - 1];
    for (let j = n - 2; j >= 0; j--) {
      const nr = re[j + 1];
      const ni = im[j + 1];
      re[j] = dRe[j] - (cpRe[j] * nr - cpIm[j] * ni);
      im[j] = dIm[j] - (cpRe[j] * ni + cpIm[j] * nr);
    }

    // Exact Crank–Nicolson bookkeeping of what the absorbers removed this step.
    const k = ((2 * GRID.dt) / HBAR) * GRID.dx;
    let absL = 0;
    let absR = 0;
    for (let j = 0; j < n; j++) {
      const w = W[j];
      if (w === 0) continue;
      const mr = 0.5 * (re[j] + oldRe[j]);
      const mi = 0.5 * (im[j] + oldIm[j]);
      const v = w * (mr * mr + mi * mi);
      if (j < this.mid) absL += v;
      else absR += v;
    }
    this.absorbedLeft += k * absL;
    this.absorbedRight += k * absR;
    this.t += GRID.dt;
  }

  observables(pot: Potential): Observables {
    const { n, re, im } = this;
    const dx = GRID.dx;
    let inside = 0;
    let left = 0;
    let middle = 0;
    let right = 0;
    let sx = 0;
    let sxx = 0;
    for (let j = 0; j < n; j++) {
      const rho = (re[j] * re[j] + im[j] * im[j]) * dx;
      const x = gridX(j);
      inside += rho;
      sx += rho * x;
      sxx += rho * x * x;
      if (x < pot.left) left += rho;
      else if (x > pot.right) right += rho;
      else middle += rho;
    }
    const meanX = inside > 0 ? sx / inside : 0;
    const sigmaX = inside > 0 ? Math.sqrt(Math.max(0, sxx / inside - meanX * meanX)) : 0;
    return { inside, left, middle, right, meanX, sigmaX };
  }
}

// ---------- Stationary scattering theory (continuum transfer matrices) ----------

interface C {
  re: number;
  im: number;
}
const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cdiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cexp = (a: C): C => {
  const m = Math.exp(a.re);
  return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) };
};
type M2 = [C, C, C, C]; // [m11, m12, m21, m22]
const mmul = (a: M2, b: M2): M2 => {
  const add = (x: C, y: C): C => ({ re: x.re + y.re, im: x.im + y.im });
  return [
    add(cmul(a[0], b[0]), cmul(a[1], b[2])),
    add(cmul(a[0], b[1]), cmul(a[1], b[3])),
    add(cmul(a[2], b[0]), cmul(a[3], b[2])),
    add(cmul(a[2], b[1]), cmul(a[3], b[3])),
  ];
};

/** Wave number in a region: real above the potential, imaginary (decaying) below it. */
function waveNumber(E: number, V: number): C {
  const d = (E - V) / ALPHA;
  return d >= 0 ? { re: Math.sqrt(d), im: 0 } : { re: 0, im: Math.sqrt(-d) };
}

/**
 * Plane-wave transmission probability T(E) through the piecewise-constant potential.
 * Interface matrices are applied at local coordinates, so evanescent factors never exceed e^{κa}.
 */
export function transmission(E: number, pot: Potential): number {
  if (pot.regions.length === 0) return 1;
  const e = E + 1e-9;
  // Sequence of (V, width) after the incident region, ending with free space.
  const seq: { V: number; d: number }[] = [];
  pot.regions.forEach((r, i) => {
    seq.push({ V: r.V, d: r.x1 - r.x0 });
    const next = pot.regions[i + 1];
    if (next) seq.push({ V: 0, d: next.x0 - r.x1 });
  });
  let kPrev = waveNumber(e, 0);
  let M: M2 = [
    { re: 1, im: 0 },
    { re: 0, im: 0 },
    { re: 0, im: 0 },
    { re: 1, im: 0 },
  ];
  const interfaceMatrix = (k1: C, k2: C): M2 => {
    const r = cdiv(k1, k2);
    const p = { re: 0.5 * (1 + r.re), im: 0.5 * r.im };
    const m = { re: 0.5 * (1 - r.re), im: -0.5 * r.im };
    return [p, m, m, p];
  };
  for (const s of seq) {
    const k = waveNumber(e, s.V);
    M = mmul(interfaceMatrix(kPrev, k), M);
    const ph = cexp({ re: -k.im * s.d, im: k.re * s.d }); // e^{ikd}
    const phInv = cexp({ re: k.im * s.d, im: -k.re * s.d }); // e^{−ikd}
    M = mmul([ph, { re: 0, im: 0 }, { re: 0, im: 0 }, phInv], M);
    kPrev = k;
  }
  M = mmul(interfaceMatrix(kPrev, waveNumber(e, 0)), M);
  const m22 = M[3];
  return 1 / (m22.re * m22.re + m22.im * m22.im);
}

/**
 * Transmission for the whole packet: T(E) averaged over the Gaussian momentum distribution
 * |φ(k)|² with spread σ_k = 1/(2σ₀).
 */
export function packetTransmission(p: QuantumParams, pot: Potential): number {
  if (p.kind === 'free') return 1;
  const k0 = packetK0(p.E0);
  const sk = 1 / (2 * p.sigma0);
  const samples = 600;
  let num = 0;
  let den = 0;
  for (let i = 0; i <= samples; i++) {
    const k = k0 + sk * (-6 + (12 * i) / samples);
    if (k <= 0) continue;
    const w = Math.exp(-((k - k0) ** 2) / (2 * sk * sk));
    num += w * transmission(ALPHA * k * k, pot);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/** Energy spread of the packet: ΔE ≈ 2αk₀σ_k (eV). */
export function energySpread(p: QuantumParams): number {
  return 2 * ALPHA * packetK0(p.E0) * (1 / (2 * p.sigma0));
}

// ---------- Classical comparison ----------

export function potentialAt(pot: Potential, x: number): number {
  for (const r of pot.regions) if (x >= r.x0 && x < r.x1) return r.V;
  return 0;
}

export interface ClassicalState {
  x: number;
  dir: 1 | -1;
}

/**
 * A classical particle with the packet's mean energy: speed √(2(E − V)/m) = (2/ħ)√(α(E − V)),
 * turning around wherever V would exceed E.
 */
export function advanceClassical(c: ClassicalState, E: number, pot: Potential, dt: number): void {
  const h = 0.005;
  const n = Math.max(1, Math.ceil(dt / h));
  const step = dt / n;
  for (let i = 0; i < n; i++) {
    const V = potentialAt(pot, c.x);
    const v = E > V ? (2 / HBAR) * Math.sqrt(ALPHA * (E - V)) : 0;
    const next = c.x + c.dir * v * step;
    if (potentialAt(pot, next) >= E) c.dir = c.dir === 1 ? -1 : 1;
    else c.x = next;
  }
}
