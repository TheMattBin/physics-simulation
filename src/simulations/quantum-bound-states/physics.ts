/**
 * Bound states of an electron in one dimension (x in nm, t in fs, energies in eV).
 *
 * Time evolution is spectral and exact: ψ(x, t) = Σ cₙ φₙ(x) e^{−iEₙt/ħ}. There is no
 * time-stepping error, energy is conserved exactly, and every superposition oscillates at exactly
 * its Bohr frequencies (Eₙ − Eₘ)/h.
 *
 * Eigenstates:
 *  - infinite box and harmonic oscillator: exact analytic sines and Hermite functions, sampled
 *    on the grid (so E ∝ n² and equal spacing hold exactly, which makes revivals perfect);
 *  - finite well and double well: eigenpairs of the finite-difference Hamiltonian, found by
 *    Sturm-sequence bisection (energies) and inverse iteration (states).
 *
 * This module has no imports so it runs standalone in Node.
 */

export const HBAR = 0.6582119569; // eV·fs
export const PLANCK = 2 * Math.PI * HBAR; // eV·fs
export const ALPHA = 0.0380998212; // ħ²/2mₑ in eV·nm²

export type WellKind = 'box' | 'harmonic' | 'finite' | 'double';

export interface WellParams {
  kind: WellKind;
  L: number; // box width, finite-well width, or width of each well in the double well (nm)
  V0: number; // finite-well depth, or double-well barrier height (eV)
  hw: number; // ħω for the harmonic oscillator (eV)
  barrier: number; // double-well barrier width (nm)
}

export type StateSpec =
  | { type: 'levels'; levels: number[] } // equal-weight superposition of levels (1-based)
  | { type: 'packet'; x0: number; sigma: number; k0: number } // Gaussian packet
  | { type: 'coherent'; xd: number } // oscillator ground state displaced by xd
  | { type: 'revival' }; // fast narrow packet in the box, scaled with the box width

export interface Basis {
  x: Float64Array;
  dx: number;
  xMin: number;
  xMax: number;
  V: Float64Array; // potential on the grid (eV); hard walls sit at xMin and xMax
  energies: number[];
  states: Float64Array[]; // real and orthonormal on the grid, ψ = 0 at both ends
  boundCount: number; // levels that are physically bound (offered as level buttons)
  regions: { x0: number; x1: number; V: number }[]; // piecewise-constant features, for drawing
}

export const MAX_STATES = 60;

export function boxLevel(n: number, L: number): number {
  return ALPHA * ((n * Math.PI) / L) ** 2;
}

export function hoLevel(n: number, hw: number): number {
  return (n - 0.5) * hw; // n is 1-based: ground state n = 1 has ħω/2
}

/** Oscillator length x₀ = √(ħ/mω) = √(2α/ħω). */
export function hoLength(hw: number): number {
  return Math.sqrt((2 * ALPHA) / hw);
}

function grid(xMin: number, xMax: number, n: number): { x: Float64Array; dx: number } {
  const x = new Float64Array(n);
  const dx = (xMax - xMin) / (n - 1);
  for (let j = 0; j < n; j++) x[j] = xMin + j * dx;
  return { x, dx };
}

/** Sign convention: the first noticeable lobe from the left is positive. */
function fixSign(v: Float64Array) {
  let max = 0;
  for (let j = 0; j < v.length; j++) max = Math.max(max, Math.abs(v[j]));
  for (let j = 0; j < v.length; j++) {
    if (Math.abs(v[j]) > 1e-3 * max) {
      if (v[j] < 0) for (let i = 0; i < v.length; i++) v[i] = -v[i];
      return;
    }
  }
}

function boxBasis(L: number): Basis {
  const n = 1201;
  const { x, dx } = grid(-L / 2, L / 2, n);
  const energies: number[] = [];
  const states: Float64Array[] = [];
  const amp = Math.sqrt(2 / L);
  for (let k = 1; k <= MAX_STATES; k++) {
    const v = new Float64Array(n);
    for (let j = 1; j < n - 1; j++) v[j] = amp * Math.sin((k * Math.PI * j) / (n - 1));
    energies.push(boxLevel(k, L));
    states.push(v);
  }
  return { x, dx, xMin: -L / 2, xMax: L / 2, V: new Float64Array(n), energies, states, boundCount: MAX_STATES, regions: [] };
}

function harmonicBasis(hw: number): Basis {
  const X = 3.5;
  const n = 1401;
  const { x, dx } = grid(-X, X, n);
  const x0 = hoLength(hw);
  const V = new Float64Array(n);
  for (let j = 0; j < n; j++) V[j] = ((hw * hw) / (4 * ALPHA)) * x[j] * x[j];
  // Keep only levels whose classical turning point √(2n+1)·x₀ sits well inside the domain.
  const nMax = Math.max(1, Math.min(MAX_STATES, Math.floor(((0.82 * X) / x0) ** 2 / 2 + 0.5)));
  const energies: number[] = [];
  const states: Float64Array[] = [];
  let prev = new Float64Array(n);
  let cur = new Float64Array(n);
  const norm0 = 1 / Math.sqrt(Math.sqrt(Math.PI) * x0);
  for (let j = 0; j < n; j++) {
    const xi = x[j] / x0;
    cur[j] = norm0 * Math.exp(-0.5 * xi * xi);
  }
  for (let k = 0; k < nMax; k++) {
    const v = cur.slice();
    v[0] = v[n - 1] = 0;
    fixSign(v);
    energies.push(hoLevel(k + 1, hw));
    states.push(v);
    // Hermite-function recurrence: φ_{k+1} = √(2/(k+1)) ξ φ_k − √(k/(k+1)) φ_{k−1}
    const next = new Float64Array(n);
    const a = Math.sqrt(2 / (k + 1));
    const b = Math.sqrt(k / (k + 1));
    for (let j = 0; j < n; j++) next[j] = a * (x[j] / x0) * cur[j] - b * prev[j];
    prev = cur;
    cur = next;
  }
  return { x, dx, xMin: -X, xMax: X, V, energies, states, boundCount: nMax, regions: [] };
}

// ---------- Numerical eigenpairs of the finite-difference Hamiltonian ----------

/** Number of eigenvalues below λ (Sturm sequence of the LDLᵀ pivots). */
function sturmCount(d: Float64Array, k2: number, lambda: number): number {
  let count = 0;
  let q = d[0] - lambda;
  if (q < 0) count++;
  for (let i = 1; i < d.length; i++) {
    q = d[i] - lambda - k2 / (q === 0 ? 1e-300 : q);
    if (q < 0) count++;
  }
  return count;
}

/** Solves the tridiagonal system (sub e, diag d, super e) with partial pivoting (as LAPACK dgtsv). */
function solveTridiagonal(diag: Float64Array, off: number, rhs: Float64Array): Float64Array {
  const n = diag.length;
  const d = diag.slice();
  const dl = new Float64Array(n - 1).fill(off);
  const du = new Float64Array(n - 1).fill(off);
  const b = rhs.slice();
  const tiny = 1e-300;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) >= Math.abs(dl[i])) {
      const fact = dl[i] / (d[i] === 0 ? tiny : d[i]);
      d[i + 1] -= fact * du[i];
      b[i + 1] -= fact * b[i];
      dl[i] = 0; // reused as the second super-diagonal
    } else {
      const fact = d[i] / dl[i];
      d[i] = dl[i];
      const temp = d[i + 1];
      d[i + 1] = du[i] - fact * temp;
      if (i < n - 2) {
        dl[i] = du[i + 1];
        du[i + 1] = -fact * dl[i];
      } else {
        dl[i] = 0;
      }
      du[i] = temp;
      const tb = b[i];
      b[i] = b[i + 1];
      b[i + 1] = tb - fact * b[i + 1];
    }
  }
  const x = new Float64Array(n);
  x[n - 1] = b[n - 1] / (d[n - 1] === 0 ? tiny : d[n - 1]);
  if (n > 1) x[n - 2] = (b[n - 2] - du[n - 2] * x[n - 1]) / d[n - 2];
  for (let i = n - 3; i >= 0; i--) x[i] = (b[i] - du[i] * x[i + 1] - dl[i] * x[i + 2]) / d[i];
  return x;
}

/** Lowest `count` eigenpairs of −α ψ'' + Vψ with ψ = 0 at both ends of the grid. */
export function lowestEigenpairs(
  V: Float64Array,
  dx: number,
  count: number,
): { energies: number[]; vectors: Float64Array[] } {
  const N = V.length;
  const n = N - 2; // interior unknowns
  const kappa = ALPHA / (dx * dx);
  const d = new Float64Array(n);
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let i = 0; i < n; i++) {
    d[i] = 2 * kappa + V[i + 1];
    vMin = Math.min(vMin, V[i + 1]);
    vMax = Math.max(vMax, V[i + 1]);
  }
  const k2 = kappa * kappa;
  const energies: number[] = [];
  const vectors: Float64Array[] = [];
  for (let k = 0; k < Math.min(count, n); k++) {
    let lo = vMin - 1e-9;
    let hi = vMax + 4 * kappa;
    for (let it = 0; it < 200 && hi - lo > 1e-13 * Math.max(1, Math.abs(lo)); it++) {
      const mid = 0.5 * (lo + hi);
      if (sturmCount(d, k2, mid) > k) hi = mid;
      else lo = mid;
    }
    const lambda = 0.5 * (lo + hi);

    // Inverse iteration, orthogonalized against earlier vectors for (near-)degenerate levels.
    const shift = lambda + 1e-10 * Math.max(1, Math.abs(lambda));
    const shifted = new Float64Array(n);
    for (let i = 0; i < n; i++) shifted[i] = d[i] - shift;
    let y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = 1 + 0.37 * Math.sin(1.7 * i + k);
    for (let it = 0; it < 3; it++) {
      y = solveTridiagonal(shifted, -kappa, y);
      // Stored vectors carry a 1/√dx normalization, hence the factor dx in the projection.
      for (const prev of vectors) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += prev[i + 1] * y[i];
        for (let i = 0; i < n; i++) y[i] -= dot * dx * prev[i + 1];
      }
      let nrm = 0;
      for (let i = 0; i < n; i++) nrm += y[i] * y[i];
      nrm = Math.sqrt(nrm);
      for (let i = 0; i < n; i++) y[i] /= nrm;
    }
    const v = new Float64Array(N);
    const s = 1 / Math.sqrt(dx);
    for (let i = 0; i < n; i++) v[i + 1] = y[i] * s;
    fixSign(v);
    energies.push(lambda);
    vectors.push(v);
  }
  return { energies, vectors };
}

function finiteBasis(V0: number, L: number): Basis {
  const X = 4;
  const N = 1601;
  const { x, dx } = grid(-X, X, N);
  const V = new Float64Array(N);
  let inside = 0;
  for (let j = 0; j < N; j++) {
    if (Math.abs(x[j]) < L / 2) {
      V[j] = -V0;
      inside++;
    }
  }
  const Leff = inside * dx; // grid-resolved width (edges halfway between points)
  const { energies, vectors } = lowestEigenpairs(V, dx, 40);
  const boundCount = energies.filter((E) => E < 0).length;
  return {
    x,
    dx,
    xMin: -X,
    xMax: X,
    V,
    energies,
    states: vectors,
    boundCount,
    regions: [{ x0: -Leff / 2, x1: Leff / 2, V: -V0 }],
  };
}

function doubleBasis(V0: number, L: number, b: number): Basis {
  const W = 2 * L + b;
  const N = 1201;
  const { x, dx } = grid(-W / 2, W / 2, N);
  const V = new Float64Array(N);
  let inside = 0;
  for (let j = 0; j < N; j++) {
    if (Math.abs(x[j]) < b / 2) {
      V[j] = V0;
      inside++;
    }
  }
  const beff = Math.max(dx, inside * dx);
  const { energies, vectors } = lowestEigenpairs(V, dx, 40);
  return {
    x,
    dx,
    xMin: -W / 2,
    xMax: W / 2,
    V,
    energies,
    states: vectors,
    boundCount: energies.length,
    regions: [{ x0: -beff / 2, x1: beff / 2, V: V0 }],
  };
}

export function buildBasis(p: WellParams): Basis {
  switch (p.kind) {
    case 'box':
      return boxBasis(p.L);
    case 'harmonic':
      return harmonicBasis(p.hw);
    case 'finite':
      return finiteBasis(p.V0, p.L);
    case 'double':
      return doubleBasis(p.V0, p.L, p.barrier);
  }
}

/** Continuum bound-state energies of a finite square well (depth V0, width L), from the
 * transcendental equations z tan z = √(z₀² − z²) (even) and −z cot z = √(z₀² − z²) (odd). */
export function finiteWellLevels(V0: number, L: number): number[] {
  const z0 = (L / 2) * Math.sqrt(V0 / ALPHA);
  const levels: number[] = [];
  const solve = (f: (z: number) => number, a: number, b: number) => {
    let lo = a;
    let hi = b;
    if (f(lo) * f(hi) > 0) return null;
    for (let i = 0; i < 200; i++) {
      const m = 0.5 * (lo + hi);
      if (f(lo) * f(m) <= 0) hi = m;
      else lo = m;
    }
    return 0.5 * (lo + hi);
  };
  const even = (z: number) => z * Math.tan(z) - Math.sqrt(Math.max(0, z0 * z0 - z * z));
  const odd = (z: number) => -z / Math.tan(z) - Math.sqrt(Math.max(0, z0 * z0 - z * z));
  const eps = 1e-12;
  for (let m = 0; m * Math.PI < z0; m++) {
    const a = m * Math.PI + eps;
    const evenEnd = Math.min(m * Math.PI + Math.PI / 2 - eps, z0);
    const ze = solve(even, a, evenEnd);
    if (ze !== null) levels.push(ze);
    const oddStart = m * Math.PI + Math.PI / 2 + eps;
    if (oddStart < z0) {
      const zo = solve(odd, oddStart, Math.min((m + 1) * Math.PI - eps, z0));
      if (zo !== null) levels.push(zo);
    }
  }
  return levels.sort((a, b) => a - b).map((z) => ALPHA * ((2 * z) / L) ** 2 - V0);
}

// ---------- States and exact evolution ----------

export interface Coefficients {
  re: Float64Array;
  im: Float64Array;
  capture: number; // Σ|cₙ|² before renormalization (1 when the basis represents the state fully)
}

function gaussian(basis: Basis, x0: number, sigma: number, k0: number): { re: Float64Array; im: Float64Array } {
  const n = basis.x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let norm = 0;
  for (let j = 1; j < n - 1; j++) {
    const x = basis.x[j];
    const env = Math.exp(-((x - x0) ** 2) / (4 * sigma * sigma));
    re[j] = env * Math.cos(k0 * x);
    im[j] = env * Math.sin(k0 * x);
    norm += env * env;
  }
  const s = 1 / Math.sqrt(norm * basis.dx);
  for (let j = 0; j < n; j++) {
    re[j] *= s;
    im[j] *= s;
  }
  return { re, im };
}

/** cₙ = ⟨φₙ|ψ⟩ on the grid, then renormalized so the represented state has unit norm. */
export function project(basis: Basis, psiRe: Float64Array, psiIm: Float64Array): Coefficients {
  const m = basis.states.length;
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  let total = 0;
  for (let k = 0; k < m; k++) {
    const phi = basis.states[k];
    let sr = 0;
    let si = 0;
    for (let j = 0; j < phi.length; j++) {
      sr += phi[j] * psiRe[j];
      si += phi[j] * psiIm[j];
    }
    re[k] = sr * basis.dx;
    im[k] = si * basis.dx;
    total += re[k] * re[k] + im[k] * im[k];
  }
  const s = total > 0 ? 1 / Math.sqrt(total) : 0;
  for (let k = 0; k < m; k++) {
    re[k] *= s;
    im[k] *= s;
  }
  return { re, im, capture: total };
}

export function prepareState(basis: Basis, spec: StateSpec, p: WellParams): Coefficients {
  const m = basis.states.length;
  if (spec.type === 'levels') {
    const re = new Float64Array(m);
    const im = new Float64Array(m);
    const valid = spec.levels.filter((n) => n >= 1 && n <= m);
    const w = valid.length ? 1 / Math.sqrt(valid.length) : 0;
    for (const n of valid) re[n - 1] = w;
    return { re, im, capture: 1 };
  }
  const g =
    spec.type === 'packet'
      ? gaussian(basis, spec.x0, spec.sigma, spec.k0)
      : spec.type === 'revival'
        ? gaussian(basis, -0.2 * p.L, 0.06 * p.L, 25 / p.L)
        : gaussian(basis, spec.xd, hoLength(p.hw) / Math.SQRT2, 0);
  return project(basis, g.re, g.im);
}

/** ψ(x, t) = Σ cₙ e^{−iEₙt/ħ} φₙ(x), summing only populated levels. */
export function evaluate(
  basis: Basis,
  c: Coefficients,
  t: number,
  outRe: Float64Array,
  outIm: Float64Array,
  stride = 1,
) {
  outRe.fill(0);
  outIm.fill(0);
  const n = basis.x.length;
  for (let k = 0; k < c.re.length; k++) {
    const ar = c.re[k];
    const ai = c.im[k];
    if (ar * ar + ai * ai < 1e-14) continue;
    const ph = (-basis.energies[k] * t) / HBAR;
    const cr = Math.cos(ph);
    const ci = Math.sin(ph);
    const zr = ar * cr - ai * ci;
    const zi = ar * ci + ai * cr;
    const phi = basis.states[k];
    for (let j = 0, o = 0; j < n; j += stride, o++) {
      outRe[o] += zr * phi[j];
      outIm[o] += zi * phi[j];
    }
  }
}

export interface BoundObservables {
  norm: number;
  meanX: number;
  sigmaX: number;
  pLeft: number;
}

export function observables(basis: Basis, re: Float64Array, im: Float64Array): BoundObservables {
  let norm = 0;
  let sx = 0;
  let sxx = 0;
  let left = 0;
  for (let j = 0; j < basis.x.length; j++) {
    const rho = (re[j] * re[j] + im[j] * im[j]) * basis.dx;
    const x = basis.x[j];
    norm += rho;
    sx += rho * x;
    sxx += rho * x * x;
    // A grid point exactly at x = 0 is split evenly so mirror-symmetric states give exactly ½.
    if (Math.abs(x) < 0.5 * basis.dx) left += 0.5 * rho;
    else if (x < 0) left += rho;
  }
  const meanX = norm > 0 ? sx / norm : 0;
  return { norm, meanX, sigmaX: Math.sqrt(Math.max(0, sxx / norm - meanX * meanX)), pLeft: left / norm };
}

export function meanEnergy(basis: Basis, c: Coefficients): number {
  let e = 0;
  for (let k = 0; k < c.re.length; k++) e += (c.re[k] ** 2 + c.im[k] ** 2) * basis.energies[k];
  return e;
}

export function levelProbabilities(c: Coefficients): number[] {
  return Array.from(c.re, (r, k) => r * r + c.im[k] * c.im[k]);
}

/** Energy measurement: collapse onto level k with probability |c_k|². Returns the level index. */
export function measureEnergy(c: Coefficients, u: number): { coeffs: Coefficients; level: number } {
  const probs = levelProbabilities(c);
  let acc = 0;
  let level = probs.length - 1;
  for (let k = 0; k < probs.length; k++) {
    acc += probs[k];
    if (u < acc) {
      level = k;
      break;
    }
  }
  const re = new Float64Array(probs.length);
  re[level] = 1;
  return { coeffs: { re, im: new Float64Array(probs.length), capture: 1 }, level };
}

/** Position measurement: pick x from |ψ|², then collapse to a narrow packet there. */
export function measurePosition(
  basis: Basis,
  re: Float64Array,
  im: Float64Array,
  u: number,
  sigma: number,
): { coeffs: Coefficients; x: number } {
  let total = 0;
  for (let j = 0; j < re.length; j++) total += re[j] * re[j] + im[j] * im[j];
  let acc = 0;
  let pick = 0;
  for (let j = 0; j < re.length; j++) {
    acc += (re[j] * re[j] + im[j] * im[j]) / total;
    if (u < acc) {
      pick = j;
      break;
    }
  }
  const x = basis.x[pick];
  const g = gaussian(basis, x, sigma, 0);
  return { coeffs: project(basis, g.re, g.im), x };
}
