/**
 * Beam Bending, Shear & Stress: pure solver (zero React imports).
 *
 * Statically determinate Euler–Bernoulli beams carrying a point load P at x = a and a
 * uniform load q along the whole length (plus optional self-weight ρAg), solved in
 * closed form with Macaulay brackets ⟨x − a⟩ⁿ.
 *
 * Conventions: x runs left → right from support A (or the wall). Loads are positive
 * downward, and so is the deflection w(x). A sagging moment M > 0 puts the bottom fibres
 * in tension. The cross-section coordinate y is measured downward from the neutral axis,
 * so σ = M·y / I is tensile (> 0) at the bottom of a sagging beam.
 */

export const GRAVITY = 9.81; // m/s²

export type SupportType = 'simply-supported' | 'cantilever' | 'overhanging';
export type CrossSectionType = 'i-beam' | 'rectangular' | 'hollow-box' | 'circular-pipe';
export type BeamMaterialId = 'steel-a36' | 'al-6061' | 'ti-6al4v' | 'timber';
export type StressFieldMode = 'utilization' | 'bending' | 'shear';

export interface BeamMaterial {
  id: BeamMaterialId;
  name: string;
  shortName: string;
  youngsModulusGPa: number;
  /** Tensile yield strength (metals) or characteristic bending strength f_m (timber) [MPa]. */
  strengthMPa: number;
  /** Shear strength [MPa]: σ_y/√3 for metals (von Mises in pure shear), f_v for timber. */
  shearStrengthMPa: number;
  densityKgM3: number;
  /** Metals use von Mises. Timber is orthotropic, so bending and shear are checked separately. */
  criterion: 'von-mises' | 'timber';
}

export const BEAM_MATERIALS: Record<BeamMaterialId, BeamMaterial> = {
  'steel-a36': {
    id: 'steel-a36',
    name: 'Structural Steel (A36)',
    shortName: 'Steel',
    youngsModulusGPa: 200,
    strengthMPa: 250,
    shearStrengthMPa: 250 / Math.sqrt(3),
    densityKgM3: 7850,
    criterion: 'von-mises',
  },
  'al-6061': {
    id: 'al-6061',
    name: 'Aluminium 6061-T6',
    shortName: 'Aluminium',
    youngsModulusGPa: 68.9,
    strengthMPa: 276,
    shearStrengthMPa: 276 / Math.sqrt(3),
    densityKgM3: 2700,
    criterion: 'von-mises',
  },
  'ti-6al4v': {
    id: 'ti-6al4v',
    name: 'Titanium Ti-6Al-4V',
    shortName: 'Titanium',
    youngsModulusGPa: 113.8,
    strengthMPa: 880,
    shearStrengthMPa: 880 / Math.sqrt(3),
    densityKgM3: 4430,
    criterion: 'von-mises',
  },
  // Glued-laminated softwood, strength class GL28h (EN 14080).
  timber: {
    id: 'timber',
    name: 'Glulam Timber (GL28h)',
    shortName: 'Timber',
    youngsModulusGPa: 12.6,
    strengthMPa: 28,
    shearStrengthMPa: 3.5,
    densityKgM3: 460,
    criterion: 'timber',
  },
};

export interface CrossSection {
  type: CrossSectionType;
  label: string;
  depth: number; // h [m]
  width: number; // outer width B (outer diameter for the pipe) [m]
  /** Flange thickness (I-beam), wall thickness (box, pipe), 0 for the solid rectangle [m]. */
  flangeThickness: number;
  /** Web thickness (I-beam), both walls together (box, pipe), full width (rectangle) [m]. */
  webThickness: number;
  area: number; // A [m²]
  I: number; // second moment of area about the neutral axis [m⁴]
  S: number; // elastic section modulus I / (h/2) [m³]
}

/**
 * Exact section properties for the four shapes, all scaled by the depth h. The shapes keep
 * fixed proportions so that comparing them at equal depth is fair and easy to read.
 */
export function computeCrossSection(type: CrossSectionType, depthMm: number): CrossSection {
  const h = Math.max(0.02, depthMm * 1e-3);

  if (type === 'i-beam') {
    const B = 0.65 * h;
    const tf = 0.1 * h;
    const tw = 0.07 * h;
    const hw = h - 2 * tf;
    const area = 2 * B * tf + hw * tw;
    const I = (B * h ** 3 - (B - tw) * hw ** 3) / 12;
    return { type, label: 'Wide-Flange I-Beam', depth: h, width: B, flangeThickness: tf, webThickness: tw, area, I, S: I / (h / 2) };
  }

  if (type === 'rectangular') {
    const B = 0.5 * h;
    const I = (B * h ** 3) / 12;
    return { type, label: 'Solid Rectangle', depth: h, width: B, flangeThickness: 0, webThickness: B, area: B * h, I, S: I / (h / 2) };
  }

  if (type === 'hollow-box') {
    const B = 0.65 * h;
    const t = 0.08 * h;
    const bi = B - 2 * t;
    const hi = h - 2 * t;
    const I = (B * h ** 3 - bi * hi ** 3) / 12;
    return { type, label: 'Hollow Box Tube', depth: h, width: B, flangeThickness: t, webThickness: 2 * t, area: B * h - bi * hi, I, S: I / (h / 2) };
  }

  const Ro = 0.5 * h;
  const t = 0.1 * h;
  const Ri = Ro - t;
  const I = (Math.PI / 4) * (Ro ** 4 - Ri ** 4);
  return {
    type,
    label: 'Circular Hollow Pipe',
    depth: h,
    width: h,
    flangeThickness: t,
    webThickness: 2 * t,
    area: Math.PI * (Ro ** 2 - Ri ** 2),
    I,
    S: I / Ro,
  };
}

/**
 * Cut width b(y) and first moment Q(y) of the area beyond height y, for Jourawski's
 * τ = V·Q / (I·b). Q is the same whichever side of the cut is taken, so only |y| matters.
 */
export function sectionShear(sec: CrossSection, y: number): { b: number; Q: number } {
  const c = sec.depth / 2;
  const ay = Math.min(Math.abs(y), c);

  if (sec.type === 'rectangular') {
    return { b: sec.width, Q: 0.5 * sec.width * (c * c - ay * ay) };
  }

  if (sec.type === 'i-beam' || sec.type === 'hollow-box') {
    const B = sec.width;
    const tf = sec.flangeThickness;
    const tw = sec.webThickness; // the box's two walls act as one web of width 2t
    const inner = c - tf;
    if (ay >= inner) return { b: B, Q: 0.5 * B * (c * c - ay * ay) };
    const qFlange = B * tf * (c - 0.5 * tf);
    return { b: tw, Q: qFlange + 0.5 * tw * (inner * inner - ay * ay) };
  }

  // Pipe: the segment of a disc beyond y has Q = (2/3)(R² − y²)^{3/2}.
  const Ro = c;
  const Ri = Ro - sec.flangeThickness;
  const outer = Math.max(0, Ro * Ro - ay * ay);
  if (ay >= Ri) {
    return { b: Math.max(1e-9, 2 * Math.sqrt(outer)), Q: (2 / 3) * outer ** 1.5 };
  }
  const innerTerm = Ri * Ri - ay * ay;
  return {
    b: 2 * (Math.sqrt(outer) - Math.sqrt(innerTerm)),
    Q: (2 / 3) * (outer ** 1.5 - innerTerm ** 1.5),
  };
}

/** Fraction of the failure criterion used (1 = first yield, or the timber strength limit). */
export function utilization(mat: BeamMaterial, sigmaMPa: number, tauMPa: number): number {
  if (mat.criterion === 'timber') {
    return Math.max(Math.abs(sigmaMPa) / mat.strengthMPa, Math.abs(tauMPa) / mat.shearStrengthMPa);
  }
  return Math.sqrt(sigmaMPa * sigmaMPa + 3 * tauMPa * tauMPa) / mat.strengthMPa;
}

export interface PointStress {
  sigma: number; // bending stress [MPa], tension > 0
  tau: number; // transverse shear stress [MPa], signed with V
  util: number; // utilization [-]
}

/** Stress state at height y (downward from the neutral axis) in a section carrying M [N·m], V [N]. */
export function stressAt(M: number, V: number, sec: CrossSection, mat: BeamMaterial, y: number): PointStress {
  const { b, Q } = sectionShear(sec, y);
  const sigma = ((M * y) / sec.I) * 1e-6;
  const tau = ((V * Q) / (sec.I * b)) * 1e-6;
  return { sigma, tau, util: utilization(mat, sigma, tau) };
}

export interface BeamParams {
  support: SupportType;
  section: CrossSectionType;
  material: BeamMaterialId;
  length: number; // L [m]
  depthMm: number; // h [mm]
  pointLoadKN: number; // P [kN], downward
  loadPos: number; // a / L in [0, 1]
  udlKNm: number; // q [kN/m], downward, over the whole length
  supportBFrac: number; // b / L, roller position of the overhanging beam
  selfWeight: boolean; // add ρ·A·g to q
}

export interface BeamModel {
  params: BeamParams;
  section: CrossSection;
  material: BeamMaterial;
  L: number;
  a: number; // point-load position [m]
  b: number; // support B position [m] (L for simply supported; unused for the cantilever)
  P: number; // [N]
  q: number; // total uniform load including self-weight [N/m]
  qSelf: number; // self-weight part of q [N/m]
  EI: number; // [N·m²]
  RA: number; // upward reaction at A [N]
  RB: number; // upward reaction at B [N] (0 for the cantilever)
  MA: number; // internal moment at x = 0 [N·m] (the wall moment for the cantilever, else 0)
  theta0EI: number; // EI · w′(0)
}

function mac(u: number, n: number): number {
  return u > 0 ? u ** n : 0;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Reactions and integration constants from statics plus the deflection boundary conditions. */
export function buildBeam(params: BeamParams): BeamModel {
  const L = clampNum(params.length, 0.5, 50);
  const section = computeCrossSection(params.section, params.depthMm);
  const material = BEAM_MATERIALS[params.material];
  const qSelf = params.selfWeight ? material.densityKgM3 * section.area * GRAVITY : 0;
  const q = Math.max(0, params.udlKNm) * 1e3 + qSelf;
  const P = Math.max(0, params.pointLoadKN) * 1e3;
  const a = clampNum(params.loadPos, 0, 1) * L;
  const EI = material.youngsModulusGPa * 1e9 * section.I;
  const base = { params, section, material, L, a, P, q, qSelf, EI };

  if (params.support === 'cantilever') {
    // Fixed at x = 0 (w = w′ = 0), free at x = L.
    return { ...base, b: L, RA: P + q * L, RB: 0, MA: -P * a - 0.5 * q * L * L, theta0EI: 0 };
  }

  // Pin at 0, roller at b. Moments about A give RB; w(b) = 0 gives the starting slope.
  const b = (params.support === 'overhanging' ? clampNum(params.supportBFrac, 0.4, 0.95) : 1) * L;
  const RB = (P * a + 0.5 * q * L * L) / b;
  const RA = P + q * L - RB;
  const theta0EI = ((RA * b ** 3) / 6 - (q * b ** 4) / 24 - (P * mac(b - a, 3)) / 6) / b;
  return { ...base, b, RA, RB, MA: 0, theta0EI };
}

/** Shear force V(x) [N]. At a jump, side = −1 takes the limit from the left, +1 from the right. */
export function shearAt(m: BeamModel, x: number, side: -1 | 1 = 1): number {
  let V = m.RA - m.q * x;
  if (x > m.a || (x === m.a && side > 0)) V -= m.P;
  if (m.RB !== 0 && (x > m.b || (x === m.b && side > 0))) V += m.RB;
  return V;
}

/** Bending moment M(x) [N·m], sagging positive. */
export function momentAt(m: BeamModel, x: number): number {
  return m.MA + m.RA * x - 0.5 * m.q * x * x - m.P * mac(x - m.a, 1) + m.RB * mac(x - m.b, 1);
}

/** Slope dw/dx [rad] from EI·w″ = −M. */
export function slopeAt(m: BeamModel, x: number): number {
  return (
    (m.theta0EI -
      m.MA * x -
      0.5 * m.RA * x * x +
      (m.q * x ** 3) / 6 +
      0.5 * m.P * mac(x - m.a, 2) -
      0.5 * m.RB * mac(x - m.b, 2)) /
    m.EI
  );
}

/** Deflection w(x) [m], positive downward. */
export function deflectionAt(m: BeamModel, x: number): number {
  return (
    (m.theta0EI * x -
      0.5 * m.MA * x * x -
      (m.RA * x ** 3) / 6 +
      (m.q * x ** 4) / 24 +
      (m.P * mac(x - m.a, 3)) / 6 -
      (m.RB * mac(x - m.b, 3)) / 6) /
    m.EI
  );
}

const BETA_CANTILEVER = 1.875104068711961;
const betaCache = new Map<number, number>();

function det(mat: number[][]): number {
  const a = mat.map((r) => r.slice());
  const n = a.length;
  let d = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (a[piv][col] === 0) return 0;
    if (piv !== col) {
      [a[piv], a[col]] = [a[col], a[piv]];
      d = -d;
    }
    d *= a[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      for (let k = col; k < n; k++) a[r][k] -= f * a[col][k];
    }
  }
  return d;
}

/**
 * Frequency determinant of a beam pinned at 0, on a roller at bf, free at 1 (unit length).
 * Span: Y₁ = A sin βx + B sinh βx. Overhang (s = x − bf): Y₂ = C₁cos βs + C₂sin βs + C₃cosh βs + C₄sinh βs.
 */
function overhangDeterminant(beta: number, bf: number): number {
  const c = 1 - bf;
  const sb = Math.sin(beta * bf);
  const cb = Math.cos(beta * bf);
  const shb = Math.sinh(beta * bf);
  const chb = Math.cosh(beta * bf);
  const sc = Math.sin(beta * c);
  const cc = Math.cos(beta * c);
  const shc = Math.sinh(beta * c);
  const chc = Math.cosh(beta * c);
  return det([
    [sb, shb, 0, 0, 0, 0], // Y₁(b) = 0
    [0, 0, 1, 0, 1, 0], // Y₂(0) = 0
    [-cb, -chb, 0, 1, 0, 1], // slope continuous over B
    [sb, -shb, -1, 0, 1, 0], // moment continuous over B
    [0, 0, -cc, -sc, chc, shc], // M = 0 at the free end
    [0, 0, sc, -cc, shc, chc], // V = 0 at the free end
  ]);
}

/** Fundamental flexural eigenvalue β₁L, with ω₁ = (β₁L / L)² √(EI / ρA). */
export function fundamentalBetaL(support: SupportType, supportBFrac = 1): number {
  if (support === 'simply-supported') return Math.PI;
  if (support === 'cantilever') return BETA_CANTILEVER;
  const bf = Math.round(clampNum(supportBFrac, 0.4, 0.95) * 1000) / 1000;
  const cached = betaCache.get(bf);
  if (cached !== undefined) return cached;

  let lo = 0.3;
  let fLo = overhangDeterminant(lo, bf);
  let root = Math.PI / bf;
  for (let hi = lo + 0.01; hi < 20; hi += 0.01) {
    const fHi = overhangDeterminant(hi, bf);
    if (fLo === 0 || fLo * fHi < 0) {
      let a = lo;
      let b = hi;
      let fa = fLo;
      for (let k = 0; k < 80; k++) {
        const mid = 0.5 * (a + b);
        const fm = overhangDeterminant(mid, bf);
        if (fa * fm <= 0) b = mid;
        else {
          a = mid;
          fa = fm;
        }
      }
      root = 0.5 * (a + b);
      break;
    }
    lo = hi;
    fLo = fHi;
  }
  betaCache.set(bf, root);
  return root;
}

export interface Station {
  x: number;
  V: number;
  M: number;
  w: number;
}

export interface BeamSolution {
  model: BeamModel;
  /** Sorted stations for the diagrams. Jumps in V appear as two stations at the same x. */
  stations: Station[];
  maxShearN: number;
  maxShearX: number;
  maxMomentNm: number; // signed value with the largest |M|
  maxMomentX: number;
  sagMaxNm: number; // largest sagging (positive) moment, 0 if none
  hogMaxNm: number; // largest hogging (negative) moment, 0 if none
  maxDeflM: number; // signed value with the largest |w|
  maxDeflX: number;
  maxSigmaMPa: number;
  maxTauMPa: number;
  maxUtil: number;
  maxUtilX: number;
  maxUtilY: number; // [m] downward from the neutral axis
  safetyFactor: number;
  slenderness: number; // L / h
  betaL: number;
  f1Hz: number;
  massPerLengthKgM: number;
}

/** Heights through the depth at which stresses are searched, including both sides of each flange–web junction. */
export function stressHeights(sec: CrossSection, n = 41): number[] {
  const c = sec.depth / 2;
  const ys: number[] = [];
  for (let j = 0; j < n; j++) ys.push(-c + (2 * c * j) / (n - 1));
  if (sec.flangeThickness > 0) {
    const yj = c - sec.flangeThickness;
    const eps = 1e-6 * sec.depth;
    ys.push(yj - eps, yj + eps, -yj - eps, -yj + eps);
  }
  return ys;
}

/**
 * Samples V, M and w along the beam and finds the peak internal forces, deflection and stresses.
 * Peaks are searched on a uniform grid plus every point where they can occur exactly:
 * both sides of the point load and of support B, and the zero-shear points where M peaks.
 */
export function solveBeam(params: BeamParams, samples = 241): BeamSolution {
  const m = buildBeam(params);
  const { L, section: sec, material: mat } = m;

  const jumps: number[] = [];
  if (m.P > 0 && m.a > 0 && m.a < L) jumps.push(m.a);
  if (m.RB !== 0 && m.b < L) jumps.push(m.b);
  const breaks = [0, ...jumps, L].sort((p, r) => p - r);

  const xs = new Set<number>();
  for (let i = 0; i < samples; i++) xs.add((i / (samples - 1)) * L);
  for (const x of breaks) xs.add(x);
  // Zero-shear points inside each segment, where M has a local extremum.
  if (m.q > 0) {
    for (let k = 0; k < breaks.length - 1; k++) {
      const x0 = breaks[k];
      const x1 = breaks[k + 1];
      const xz = x0 + shearAt(m, x0, 1) / m.q;
      if (xz > x0 && xz < x1) xs.add(xz);
    }
  }
  const sorted = [...xs].sort((p, r) => p - r);

  const stations: Station[] = [];
  for (const x of sorted) {
    const M = momentAt(m, x);
    const w = deflectionAt(m, x);
    if (jumps.includes(x)) stations.push({ x, V: shearAt(m, x, -1), M, w });
    // At x = L take the limit from the left: what lies beyond is the end of the beam.
    stations.push({ x, V: shearAt(m, x, x === L ? -1 : 1), M, w });
  }

  let maxShearN = 0;
  let maxShearX = 0;
  let maxMomentNm = 0;
  let maxMomentX = 0;
  let sagMaxNm = 0;
  let hogMaxNm = 0;
  let maxDeflM = 0;
  let maxDeflX = 0;
  let maxSigmaMPa = 0;
  let maxTauMPa = 0;
  let maxUtil = 0;
  let maxUtilX = 0;
  let maxUtilY = 0;
  const ys = stressHeights(sec);

  for (const s of stations) {
    if (Math.abs(s.V) > maxShearN) {
      maxShearN = Math.abs(s.V);
      maxShearX = s.x;
    }
    if (Math.abs(s.M) > Math.abs(maxMomentNm)) {
      maxMomentNm = s.M;
      maxMomentX = s.x;
    }
    if (s.M > sagMaxNm) sagMaxNm = s.M;
    if (s.M < hogMaxNm) hogMaxNm = s.M;
    if (Math.abs(s.w) > Math.abs(maxDeflM)) {
      maxDeflM = s.w;
      maxDeflX = s.x;
    }
    for (const y of ys) {
      const st = stressAt(s.M, s.V, sec, mat, y);
      if (Math.abs(st.sigma) > maxSigmaMPa) maxSigmaMPa = Math.abs(st.sigma);
      if (Math.abs(st.tau) > maxTauMPa) maxTauMPa = Math.abs(st.tau);
      if (st.util > maxUtil) {
        maxUtil = st.util;
        maxUtilX = s.x;
        maxUtilY = y;
      }
    }
  }

  const massPerLengthKgM = mat.densityKgM3 * sec.area;
  const betaL = fundamentalBetaL(params.support, params.supportBFrac);
  const omega1 = ((betaL / L) ** 2) * Math.sqrt(m.EI / massPerLengthKgM);

  return {
    model: m,
    stations,
    maxShearN,
    maxShearX,
    maxMomentNm,
    maxMomentX,
    sagMaxNm,
    hogMaxNm,
    maxDeflM,
    maxDeflX,
    maxSigmaMPa,
    maxTauMPa,
    maxUtil,
    maxUtilX,
    maxUtilY,
    safetyFactor: maxUtil > 1e-9 ? 1 / maxUtil : Infinity,
    slenderness: L / sec.depth,
    betaL,
    f1Hz: omega1 / (2 * Math.PI),
    massPerLengthKgM,
  };
}
