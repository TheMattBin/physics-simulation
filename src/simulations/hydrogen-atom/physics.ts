/**
 * Schrödinger's hydrogen atom: exact stationary states ψₙₗₘ(r, θ, φ) = Rₙₗ(r) Yₗₘ(θ, φ).
 *
 * Lengths are in Bohr radii a₀ (infinite nuclear mass). Energies use the reduced-mass Rydberg
 * R_H = 13.598 eV so photon wavelengths match measured vacuum values (Hα = 656.47 nm). Orbitals
 * are the real combinations used in chemistry (pₓ, d_z², …).
 *
 * Electric-dipole matrix elements ⟨a|r|b⟩ are computed by quadrature, which gives the selection
 * rules (Δl = ±1, |Δm| ≤ 1) and the Einstein A coefficients, and hence radiative lifetimes, from
 * first principles. This module has no imports so it runs standalone in Node.
 */

export const RYDBERG_H = 13.6056931 / (1 + 1 / 1836.15267343); // eV, reduced-mass Rydberg
export const HC = 1239.841984; // eV·nm
export const BOHR_NM = 0.0529177210903; // nm
const HBAR_EVFS = 0.6582119569; // eV·fs

// SI constants for Einstein A coefficients
const E_SI = 1.602176634e-19;
const HBAR_SI = 1.054571817e-34;
const EPS0 = 8.8541878128e-12;
const C_SI = 299792458;
const A0_SI = 5.29177210903e-11;

export interface Orbital {
  n: number;
  l: number;
  m: number; // real-orbital index: m < 0 → sin(|m|φ), m > 0 → cos(mφ)
}

export const L_LETTERS = ['s', 'p', 'd', 'f', 'g'];

const SUBSCRIPTS: Record<number, Record<number, string>> = {
  0: { 0: '' },
  1: { [-1]: 'y', 0: 'z', 1: 'x' },
  2: { [-2]: 'xy', [-1]: 'yz', 0: 'z²', 1: 'xz', 2: 'x²−y²' },
  3: { [-3]: 'y(3x²−y²)', [-2]: 'xyz', [-1]: 'yz²', 0: 'z³', 1: 'xz²', 2: 'z(x²−y²)', 3: 'x(x²−3y²)' },
};

/** Orbital name split into its base ("3d") and real-orbital subscript ("z²"). */
export function orbitalName(o: Orbital): { base: string; sub: string } {
  return { base: `${o.n}${L_LETTERS[o.l]}`, sub: SUBSCRIPTS[o.l]?.[o.m] ?? `m=${o.m}` };
}

export function orbitalText(o: Orbital): string {
  const { base, sub } = orbitalName(o);
  return sub ? `${base}_${sub}` : base;
}

export function energy(n: number): number {
  return -RYDBERG_H / (n * n);
}

/** Bohr-model orbit radius and Schrödinger mean radius, in a₀. */
export function bohrRadius(n: number): number {
  return n * n;
}

export function meanRadius(n: number, l: number): number {
  return (3 * n * n - l * (l + 1)) / 2;
}

function factorial(k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return f;
}

/** Generalized Laguerre polynomial L_k^(α)(x) by the three-term recurrence. */
function laguerre(k: number, alpha: number, x: number): number {
  if (k === 0) return 1;
  let prev = 1;
  let cur = 1 + alpha - x;
  for (let j = 1; j < k; j++) {
    const next = ((2 * j + 1 + alpha - x) * cur - (j + alpha) * prev) / (j + 1);
    prev = cur;
    cur = next;
  }
  return cur;
}

/** Radial function Rₙₗ(r) with ∫ R² r² dr = 1 (r in a₀). */
export function radial(n: number, l: number, r: number): number {
  const rho = (2 * r) / n;
  const norm = Math.sqrt((2 / n) ** 3 * (factorial(n - l - 1) / (2 * n * factorial(n + l))));
  return norm * Math.exp(-rho / 2) * rho ** l * laguerre(n - l - 1, 2 * l + 1, rho);
}

/** Associated Legendre P_l^m(x) for m ≥ 0, without the Condon–Shortley phase. */
function legendre(l: number, m: number, x: number): number {
  let pmm = 1;
  const s = Math.sqrt(Math.max(0, 1 - x * x));
  for (let i = 1; i <= m; i++) pmm *= (2 * i - 1) * s;
  if (l === m) return pmm;
  let pm1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return pm1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pm1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pm1;
    pm1 = pll;
  }
  return pll;
}

/** Real spherical harmonic, orthonormal over the sphere. */
export function realY(l: number, m: number, cosTheta: number, phi: number): number {
  const am = Math.abs(m);
  const k = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (factorial(l - am) / factorial(l + am)));
  const p = legendre(l, am, cosTheta);
  if (m === 0) return k * p;
  return Math.SQRT2 * k * p * (m > 0 ? Math.cos(am * phi) : Math.sin(am * phi));
}

export function psi(o: Orbital, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y, z);
  if (r === 0) return o.l === 0 ? radial(o.n, 0, 0) * realY(0, 0, 1, 0) : 0;
  return radial(o.n, o.l, r) * realY(o.l, o.m, z / r, Math.atan2(y, x));
}

/** Outer radius for sampling and plotting: well beyond where Rₙₗ has any weight. */
export function radialExtent(n: number): number {
  return 6 * n * n + 12;
}

/** Radial probability density P(r) = r² Rₙₗ(r)² on a uniform grid. */
export function radialDistribution(n: number, l: number, points = 1200): { r: Float64Array; P: Float64Array } {
  const rMax = radialExtent(n);
  const r = new Float64Array(points);
  const P = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    r[i] = (rMax * i) / (points - 1);
    const R = radial(n, l, r[i]);
    P[i] = r[i] * r[i] * R * R;
  }
  return { r, P };
}

export function mostProbableRadius(n: number, l: number): number {
  const { r, P } = radialDistribution(n, l, 6000);
  let best = 0;
  for (let i = 1; i < P.length; i++) if (P[i] > P[best]) best = i;
  return r[best];
}

/** Radius enclosing a given fraction of the probability (for framing the view). */
export function enclosingRadius(n: number, l: number, fraction: number): number {
  const { r, P } = radialDistribution(n, l, 4000);
  const dr = r[1] - r[0];
  let acc = 0;
  for (let i = 0; i < P.length; i++) {
    acc += P[i] * dr;
    if (acc >= fraction) return r[i];
  }
  return r[r.length - 1];
}

// ---------- Sampling the electron cloud ----------

/** Small seeded PRNG so a given orbital always produces the same cloud. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws points from |ψₙₗₘ|². Because ψ separates into R(r)·Y(θ, φ), r is drawn from r²R² by
 * inverse CDF and the direction from |Y|² by rejection, which is exact.
 */
export function sampleOrbital(o: Orbital, count: number, rand: () => number): Float32Array {
  const { r, P } = radialDistribution(o.n, o.l, 4000);
  const cdf = new Float64Array(P.length);
  for (let i = 1; i < P.length; i++) cdf[i] = cdf[i - 1] + 0.5 * (P[i] + P[i - 1]);
  const total = cdf[cdf.length - 1];

  let yMax = 0;
  for (let i = 0; i <= 120; i++) {
    const ct = -1 + (2 * i) / 120;
    for (let j = 0; j < 240; j++) {
      const v = realY(o.l, o.m, ct, (2 * Math.PI * j) / 240);
      yMax = Math.max(yMax, v * v);
    }
  }
  yMax *= 1.05;

  const out = new Float32Array(count * 3);
  for (let s = 0; s < count; s++) {
    // radius
    const u = rand() * total;
    let lo = 0;
    let hi = cdf.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid;
      else hi = mid;
    }
    const f = (u - cdf[lo]) / Math.max(1e-300, cdf[hi] - cdf[lo]);
    const rad = r[lo] + f * (r[hi] - r[lo]);
    // direction
    let ct = 0;
    let ph = 0;
    for (let tries = 0; tries < 10000; tries++) {
      ct = 2 * rand() - 1;
      ph = 2 * Math.PI * rand();
      const v = realY(o.l, o.m, ct, ph);
      if (rand() * yMax <= v * v) break;
    }
    const st = Math.sqrt(1 - ct * ct);
    out[3 * s] = rad * st * Math.cos(ph);
    out[3 * s + 1] = rad * st * Math.sin(ph);
    out[3 * s + 2] = rad * ct;
  }
  return out;
}

// ---------- Dipole matrix elements, selection rules, lifetimes ----------

/** Gauss–Legendre nodes and weights on [−1, 1]. */
function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}

const GL = gaussLegendre(24);
const N_PHI = 48;

function radialIntegral(a: Orbital, b: Orbital): number {
  // ∫ R_a R_b r³ dr by Simpson's rule
  const rMax = radialExtent(Math.max(a.n, b.n));
  const N = 6000;
  const h = rMax / N;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const r = i * h;
    const v = radial(a.n, a.l, r) * radial(b.n, b.l, r) * r * r * r;
    s += v * (i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2);
  }
  return (s * h) / 3;
}

/** ⟨a|(x, y, z)|b⟩ in a₀ (real, since the orbitals are real). */
export function dipoleVector(a: Orbital, b: Orbital): [number, number, number] {
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (let i = 0; i < GL.x.length; i++) {
    const ct = GL.x[i];
    const st = Math.sqrt(1 - ct * ct);
    for (let j = 0; j < N_PHI; j++) {
      const ph = (2 * Math.PI * (j + 0.5)) / N_PHI;
      const v = realY(a.l, a.m, ct, ph) * realY(b.l, b.m, ct, ph) * GL.w[i] * ((2 * Math.PI) / N_PHI);
      ax += v * st * Math.cos(ph);
      ay += v * st * Math.sin(ph);
      az += v * ct;
    }
  }
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  if (clean(ax) === 0 && clean(ay) === 0 && clean(az) === 0) return [0, 0, 0];
  const R = radialIntegral(a, b);
  return [clean(ax) * R, clean(ay) * R, clean(az) * R];
}

export function dipoleStrength(a: Orbital, b: Orbital): number {
  const [x, y, z] = dipoleVector(a, b);
  return Math.hypot(x, y, z);
}

/** Einstein A coefficient (s⁻¹) for spontaneous emission upper → lower. */
export function einsteinA(upper: Orbital, lower: Orbital): number {
  const dE = energy(upper.n) - energy(lower.n);
  if (dE <= 0) return 0;
  const d2 = dipoleStrength(upper, lower) ** 2;
  if (d2 === 0) return 0;
  const omega = (dE * E_SI) / HBAR_SI;
  const dSI2 = d2 * (E_SI * A0_SI) ** 2;
  return (omega ** 3 * dSI2) / (3 * Math.PI * EPS0 * HBAR_SI * C_SI ** 3);
}

export function allOrbitals(nMax: number): Orbital[] {
  const list: Orbital[] = [];
  for (let n = 1; n <= nMax; n++)
    for (let l = 0; l < n; l++) for (let m = -l; m <= l; m++) list.push({ n, l, m });
  return list;
}

/** Radiative lifetime (s) from summing one-photon decays to every lower state; Infinity if none. */
export function lifetime(o: Orbital): number {
  let total = 0;
  for (const low of allOrbitals(o.n - 1)) total += einsteinA(o, low);
  return total > 0 ? 1 / total : Infinity;
}

export function photonWavelength(nUpper: number, nLower: number): number {
  return HC / (energy(nUpper) - energy(nLower));
}

/** Real period of the charge-cloud oscillation in a superposition, in fs. */
export function beatPeriodFs(a: Orbital, b: Orbital): number {
  const dE = Math.abs(energy(a.n) - energy(b.n));
  return dE > 0 ? (2 * Math.PI * HBAR_EVFS) / dE : Infinity;
}

export function seriesName(nLower: number): string {
  return ['', 'Lyman', 'Balmer', 'Paschen', 'Brackett', 'Pfund'][nLower] ?? `n=${nLower}`;
}

export function bandName(lambdaNm: number): string {
  if (lambdaNm < 380) return 'ultraviolet';
  if (lambdaNm <= 750) return 'visible';
  return 'infrared';
}

/** Approximate sRGB colour of a wavelength (dim grey outside the visible band). */
export function wavelengthColor(nm: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = (440 - nm) / 60;
    b = 1;
  } else if (nm < 490 && nm >= 440) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510 && nm >= 490) {
    g = 1;
    b = (510 - nm) / 20;
  } else if (nm < 580 && nm >= 510) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645 && nm >= 580) {
    r = 1;
    g = (645 - nm) / 65;
  } else if (nm <= 750 && nm >= 645) {
    r = 1;
  } else {
    return nm < 380 ? '#a78bfa' : '#94a3b8';
  }
  let f = 1;
  if (nm < 420) f = 0.4 + (0.6 * (nm - 380)) / 40;
  else if (nm > 700) f = 0.4 + (0.6 * (750 - nm)) / 50;
  const c = (v: number) => Math.round(255 * Math.pow(v * f, 0.8));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
