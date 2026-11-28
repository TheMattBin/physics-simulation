/**
 * Tensile Test: pure solver (zero React imports).
 *
 * The gauge length of a round specimen is split into slices along its axis. Every slice
 * carries the same axial force F, keeps its volume while it deforms plastically
 * (A·ℓ = A₀·ℓ₀), and follows an elastic–viscoplastic law: elastic strain σ/E plus plastic
 * flow at a rate ε̇_p ∝ (σ_eq / σ_flow(ε_p))^{1/m}. The test is displacement controlled:
 * the crosshead sets the gauge length and F is solved so that the slice lengths add up.
 *
 * Nothing about necking is scripted. A 0.5 % dip in area at mid-gauge seeds it; once
 * hardening can no longer keep up with the shrinking area (Considère), deformation
 * localizes there while the rest of the bar unloads elastically.
 */

export type TensileMaterialId = 'steel' | 'aluminium' | 'copper' | 'titanium' | 'alumina';

export interface TensileMaterial {
  id: TensileMaterialId;
  name: string;
  shortName: string;
  color: string;
  E: number; // Young's modulus [MPa]
  brittle: boolean;
  /** Swift hardening σ_flow = K (ε₀ + e)ⁿ, with e the plastic strain beyond any Lüders plateau [MPa]. */
  K: number;
  n: number;
  /** Initial flow stress K·ε₀ⁿ (the lower yield stress for a yield-point steel) [MPa]. */
  yield0: number;
  /** Yield-point steels: the upper yield stress and the plastic strain carried by Lüders bands. */
  upperYield?: number;
  ludersStrain?: number;
  /** True strain at the neck when a ductile specimen breaks, ln(1 / (1 − RA)). */
  fractureStrain: number;
  /** Brittle: tensile fracture stress [MPa]. */
  fractureStress?: number;
  /** Strain axis that fits a full test [-]. */
  strainAxis: number;
}

function material(
  m: Omit<TensileMaterial, 'fractureStrain'> & { reductionOfArea: number },
): TensileMaterial {
  const { reductionOfArea, ...rest } = m;
  return { ...rest, fractureStrain: Math.log(1 / (1 - reductionOfArea)) };
}

/** Representative handbook-range properties at room temperature. */
export const TENSILE_MATERIALS: Record<TensileMaterialId, TensileMaterial> = {
  steel: material({
    id: 'steel',
    name: 'Low-Carbon Steel (annealed 1020)',
    shortName: 'Steel 1020',
    color: '#38bdf8',
    E: 200e3,
    brittle: false,
    K: 700,
    n: 0.2,
    yield0: 290,
    upperYield: 330,
    ludersStrain: 0.015,
    reductionOfArea: 0.6,
    strainAxis: 0.45,
  }),
  aluminium: material({
    id: 'aluminium',
    name: 'Aluminium 6061-T6',
    shortName: 'Al 6061-T6',
    color: '#a78bfa',
    E: 68.9e3,
    brittle: false,
    K: 417,
    n: 0.09,
    yield0: 417 * 0.01 ** 0.09,
    reductionOfArea: 0.35,
    strainAxis: 0.22,
  }),
  copper: material({
    id: 'copper',
    name: 'Copper (annealed C110)',
    shortName: 'Copper',
    color: '#f59e0b',
    E: 117e3,
    brittle: false,
    K: 440,
    n: 0.3,
    yield0: 70,
    reductionOfArea: 0.65,
    strainAxis: 0.7,
  }),
  titanium: material({
    id: 'titanium',
    name: 'Titanium Ti-6Al-4V (annealed)',
    shortName: 'Ti-6Al-4V',
    color: '#34d399',
    E: 113.8e3,
    brittle: false,
    K: 1188,
    n: 0.06,
    yield0: 1188 * 0.005 ** 0.06,
    reductionOfArea: 0.35,
    strainAxis: 0.2,
  }),
  alumina: material({
    id: 'alumina',
    name: 'Alumina Ceramic (96 % Al₂O₃)',
    shortName: 'Alumina',
    color: '#f472b6',
    E: 370e3,
    brittle: true,
    K: 0,
    n: 1,
    yield0: Infinity,
    reductionOfArea: 0,
    fractureStress: 260,
    strainAxis: 0.0012,
  }),
};

/** ε₀ in the Swift law, chosen so the flow curve starts at yield0. */
export function swiftEps0(mat: TensileMaterial): number {
  return mat.brittle ? 0 : (mat.yield0 / mat.K) ** (1 / mat.n);
}

/**
 * Plastic strain at which uniform deformation becomes unstable (Considère, dσ/dε = σ):
 * ε_u = n − ε₀ past the Lüders plateau.
 */
export function considereStrain(mat: TensileMaterial): number {
  return mat.brittle ? 0 : (mat.ludersStrain ?? 0) + mat.n - swiftEps0(mat);
}

/** Plastic strain over which a slice drops from the upper to the lower yield stress. */
const YIELD_DROP_STRAIN = 0.002;
/** 1/m, the inverse strain-rate sensitivity: m = 0.005, at the low end of metals at room temperature. */
const RATE_EXPONENT = 200;
/** Largest plastic strain increment any slice may take in one substep. */
const MAX_SLICE_STRAIN_STEP = 0.004;
export const SLICES = 80;
const IMPERFECTION = 0.005; // fractional area dip at mid-gauge
const IMPERFECTION_WIDTH = 1; // Gaussian width as a fraction of the diameter

function smoothstep(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

/**
 * Flow stress of a slice. A yield-point steel must first reach the upper yield stress;
 * once a neighbouring slice has yielded (a Lüders band front is next to it), the lower
 * yield stress is enough, so the band spreads along the bar at constant load.
 */
export function flowStress(mat: TensileMaterial, ep: number, released: boolean): number {
  const e0 = swiftEps0(mat);
  if (mat.upperYield !== undefined && mat.ludersStrain !== undefined) {
    if (ep < mat.ludersStrain) {
      if (released) return mat.yield0;
      return mat.upperYield - (mat.upperYield - mat.yield0) * smoothstep(ep / YIELD_DROP_STRAIN);
    }
    return mat.K * (e0 + ep - mat.ludersStrain) ** mat.n;
  }
  return mat.K * (e0 + ep) ** mat.n;
}

/**
 * Bridgman's correction for the triaxial stress in a neck: the average axial stress F/A
 * exceeds the flow stress by B = (1 + 2R/a)·ln(1 + a/2R). The neck shape follows the
 * empirical a/R = 1.1 (ε − ε_u) of Le Roy et al. (1981), where ε − ε_u is how far a slice
 * has strained beyond the uniformly stretched rest of the bar (so B = 1 until a neck forms).
 */
export function bridgmanFactor(excessStrain: number): number {
  const t = 1.1 * Math.max(0, excessStrain);
  if (t < 1e-9) return 1;
  return (1 + 2 / t) * Math.log(1 + t / 2);
}

export interface SpecimenParams {
  material: TensileMaterialId;
  gaugeLength: number; // L₀ [mm]
  diameter: number; // d₀ [mm]
}

export interface CurvePoint {
  e: number; // engineering strain ΔL/L₀
  s: number; // engineering stress F/A₀ [MPa]
  et: number; // true strain at the neck ln(A₀/A_min)
  st: number; // true stress at the neck F/A_min [MPa]
  sb: number; // Bridgman-corrected flow stress at the neck [MPa]
}

export interface TensileTest {
  params: SpecimenParams;
  mat: TensileMaterial;
  L0: number;
  A0: number; // nominal area πd₀²/4 [mm²]
  l0: Float64Array; // slice lengths before loading [mm]
  a0: Float64Array; // slice areas before loading [mm²]
  ep: Float64Array; // plastic true strain of each slice
  released: Uint8Array; // yield-point steel: slice next to a Lüders front
  F: number; // axial force [N]
  length: number; // current gauge length [mm]
  plastic: boolean; // did the last substep flow plastically?
  fractured: boolean;
  fractureIndex: number;
  history: CurvePoint[];
}

export function createTest(params: SpecimenParams): TensileTest {
  const mat = TENSILE_MATERIALS[params.material];
  const L0 = params.gaugeLength;
  const A0 = (Math.PI / 4) * params.diameter ** 2;
  const l0 = new Float64Array(SLICES).fill(L0 / SLICES);
  const a0 = new Float64Array(SLICES);
  const w = IMPERFECTION_WIDTH * params.diameter;
  let compliance = 0;
  for (let i = 0; i < SLICES; i++) {
    const x = (i + 0.5) * (L0 / SLICES) - L0 / 2;
    a0[i] = 1 - IMPERFECTION * Math.exp(-0.5 * (x / w) ** 2);
    compliance += 1 / a0[i] / SLICES;
  }
  // Scale so the bar's elastic stiffness is exactly A₀E/L₀: the measured modulus is then E.
  for (let i = 0; i < SLICES; i++) a0[i] *= A0 * compliance;
  return {
    params,
    mat,
    L0,
    A0,
    l0,
    a0,
    ep: new Float64Array(SLICES),
    released: new Uint8Array(SLICES),
    F: 0,
    length: L0,
    plastic: false,
    fractured: false,
    fractureIndex: -1,
    history: [{ e: 0, s: 0, et: 0, st: 0, sb: 0 }],
  };
}

/** Index of the slice with the smallest current area (the neck). */
export function neckIndex(t: TensileTest): number {
  let best = 0;
  let aMin = Infinity;
  for (let i = 0; i < SLICES; i++) {
    const a = t.a0[i] * Math.exp(-t.ep[i]);
    if (a < aMin) {
      aMin = a;
      best = i;
    }
  }
  return best;
}

export function sliceArea(t: TensileTest, i: number): number {
  return t.a0[i] * Math.exp(-t.ep[i]);
}

/** Gauge length with no load: every slice keeps only its plastic strain. */
export function unloadedLength(t: TensileTest): number {
  let L = 0;
  for (let i = 0; i < SLICES; i++) L += t.l0[i] * Math.exp(t.ep[i]);
  return L;
}

/** r^(1/m) by repeated squaring (much faster than Math.pow in the inner loop). */
function powRate(r: number): number {
  let result = 1;
  let base = r;
  let k = RATE_EXPONENT;
  while (k > 0) {
    if (k & 1) result *= base;
    base *= base;
    k >>= 1;
  }
  return result;
}

/** Smallest plastic strain along the bar: the far field that a neck is measured against. */
function farFieldStrain(t: TensileTest): number {
  let m = Infinity;
  for (let i = 0; i < SLICES; i++) m = Math.min(m, t.ep[i]);
  return m;
}

interface SubstepSystem {
  base: Float64Array; // ℓ₀ e^{ε_p}: slice length with its plastic strain only
  elastic: Float64Array; // 1 / (A E): elastic strain per newton
  capacity: Float64Array; // B·σ_flow·A: force at which the slice flows at the reference rate
}

function buildSystem(t: TensileTest, sys: SubstepSystem) {
  const { mat } = t;
  const far = farFieldStrain(t);
  for (let i = 0; i < SLICES; i++) {
    const A = t.a0[i] * Math.exp(-t.ep[i]);
    sys.base[i] = t.l0[i] * Math.exp(t.ep[i]);
    sys.elastic[i] = 1 / (A * mat.E);
    sys.capacity[i] = mat.brittle
      ? Infinity
      : bridgmanFactor(t.ep[i] - far) * flowStress(mat, t.ep[i], t.released[i] === 1) * A;
  }
}

/** Gauge length under force F after a substep of nominal strain h, and dL/dF; fills dep. */
function lengthUnder(sys: SubstepSystem, F: number, h: number, dep: Float64Array): [number, number] {
  let L = 0;
  let dLdF = 0;
  for (let i = 0; i < SLICES; i++) {
    const r = F / sys.capacity[i];
    let d = 0;
    let dd = 0;
    if (h > 0 && r > 0.7) {
      const p = powRate(r);
      d = h * p;
      if (d > 0.5) d = 0.5;
      else dd = (RATE_EXPONENT * d) / F;
    }
    dep[i] = d;
    const li = sys.base[i] * Math.exp(d + F * sys.elastic[i]);
    L += li;
    dLdF += li * (dd + sys.elastic[i]);
  }
  return [L, dLdF];
}

/** Force that stretches the bar to length L in a substep of nominal strain h. L(F) increases, so safeguarded Newton converges. */
function solveForce(t: TensileTest, sys: SubstepSystem, L: number, h: number, dep: Float64Array): number {
  const { mat } = t;
  let hi = 0;
  if (mat.brittle) {
    let aMin = Infinity;
    for (let i = 0; i < SLICES; i++) aMin = Math.min(aMin, sliceArea(t, i));
    hi = 2 * (mat.fractureStress ?? 1) * aMin;
  } else {
    hi = Infinity;
    for (let i = 0; i < SLICES; i++) hi = Math.min(hi, sys.capacity[i]);
    hi *= 1.5;
  }
  let lo = 0;
  let F = Math.min(Math.max(t.F, 0.01 * hi), 0.99 * hi);
  for (let k = 0; k < 80; k++) {
    const [Lf, dLdF] = lengthUnder(sys, F, h, dep);
    const g = Lf - L;
    if (Math.abs(g) < 1e-11 * L) break;
    if (g < 0) lo = F;
    else hi = F;
    let next = F - g / dLdF;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - F) < 1e-13 * Math.max(1, F)) {
      F = next;
      break;
    }
    F = next;
  }
  lengthUnder(sys, F, h, dep);
  return F;
}

function recordPoint(t: TensileTest) {
  const i = neckIndex(t);
  const st = t.F / sliceArea(t, i);
  t.history.push({
    e: (t.length - t.L0) / t.L0,
    s: t.F / t.A0,
    et: t.ep[i] + st / t.mat.E,
    st,
    sb: st / bridgmanFactor(t.ep[i] - farFieldStrain(t)),
  });
}

export type StepOutcome = 'ok' | 'slack' | 'fractured';

/**
 * Moves the crosshead by dL [mm] (negative to unload), in substeps small enough to resolve
 * the elastic line, the yield drop and the growing neck. Returns 'slack' if unloading
 * reached zero force, and 'fractured' when the specimen breaks.
 */
export function advance(t: TensileTest, dL: number): StepOutcome {
  if (t.fractured) return 'fractured';
  const { mat } = t;
  const dep = new Float64Array(SLICES);
  const sys: SubstepSystem = {
    base: new Float64Array(SLICES),
    elastic: new Float64Array(SLICES),
    capacity: new Float64Array(SLICES),
  };
  let remaining = dL;
  const yieldStrain = mat.brittle ? (mat.fractureStress ?? 1) / mat.E : mat.yield0 / mat.E;

  while (Math.abs(remaining) > 1e-12) {
    const maxStep = (t.plastic ? 4e-4 : Math.min(4e-4, yieldStrain / 30)) * t.L0;
    let step = Math.sign(remaining) * Math.min(Math.abs(remaining), maxStep);

    if (step < 0) {
      // Unloading is elastic. Stop at zero force rather than pushing on the specimen.
      const natural = unloadedLength(t);
      if (t.length + step <= natural) {
        t.length = natural;
        t.F = 0;
        t.plastic = false;
        recordPoint(t);
        return 'slack';
      }
    }

    buildSystem(t, sys);
    let F = 0;
    for (let tries = 0; tries < 30; tries++) {
      const h = Math.abs(step) / t.L0;
      F = solveForce(t, sys, t.length + step, step > 0 ? h : 0, dep);
      let maxDep = 0;
      for (let i = 0; i < SLICES; i++) maxDep = Math.max(maxDep, dep[i]);
      if (maxDep <= MAX_SLICE_STRAIN_STEP || Math.abs(step) < 1e-9 * t.L0) break;
      step *= 0.5;
    }

    // Brittle fracture: land exactly on the fracture stress.
    if (mat.brittle && mat.fractureStress !== undefined) {
      const aMin = sliceArea(t, neckIndex(t));
      if (F / aMin >= mat.fractureStress) {
        F = mat.fractureStress * aMin;
        let L = 0;
        for (let i = 0; i < SLICES; i++) L += t.l0[i] * Math.exp(F / sliceArea(t, i) / mat.E);
        t.length = L;
        t.F = F;
        recordPoint(t);
        breakAt(t, neckIndex(t));
        return 'fractured';
      }
    }

    let maxDep = 0;
    for (let i = 0; i < SLICES; i++) {
      t.ep[i] += dep[i];
      maxDep = Math.max(maxDep, dep[i]);
    }
    t.F = F;
    t.length += step;
    t.plastic = maxDep > 1e-7;
    remaining -= step;

    if (mat.upperYield !== undefined) {
      for (let i = 0; i < SLICES; i++) {
        if (t.ep[i] >= YIELD_DROP_STRAIN) {
          t.released[i] = 1;
          if (i > 0) t.released[i - 1] = 1;
          if (i < SLICES - 1) t.released[i + 1] = 1;
        }
      }
    }
    recordPoint(t);

    const iNeck = neckIndex(t);
    if (!mat.brittle && t.ep[iNeck] >= mat.fractureStrain) {
      breakAt(t, iNeck);
      return 'fractured';
    }
  }
  return 'ok';
}

function breakAt(t: TensileTest, index: number) {
  t.fractured = true;
  t.fractureIndex = index;
  const last = t.history[t.history.length - 1];
  t.F = 0;
  t.plastic = false;
  // The load cell drops to zero at the extension where the specimen broke.
  t.history.push({ e: last.e, s: 0, et: last.et, st: 0, sb: 0 });
}

export interface TestResults {
  E: number | null; // measured slope of the first loading [MPa]
  yieldStrength: number | null; // 0.2 % offset, or the lower yield stress for a yield-point steel [MPa]
  upperYield: number | null;
  offsetYield: boolean; // yieldStrength came from the 0.2 % offset construction
  uts: number; // highest engineering stress so far [MPa]
  utsStrain: number; // engineering strain at that maximum
  /** The maximum load has been passed (past any yield-point transient): uts is the tensile strength and a neck has formed. */
  necked: boolean;
  toughness: number; // ∫σ dε [MJ/m³]
  resilience: number | null; // σ_y² / 2E [MJ/m³]
  elongationAtBreak: number | null; // permanent elongation after the pieces are fitted together
  reductionOfArea: number; // 1 − A_min / A₀
  permanentSet: number; // current unloaded strain (L_unloaded − L₀) / L₀
}

/** Reads the standard tensile properties off the recorded curve, the way a test lab would. */
export function analyze(t: TensileTest): TestResults {
  const h = t.history;
  const mat = t.mat;

  // First loading branch: up to the first point where the extension decreases.
  let end = h.length;
  for (let i = 1; i < h.length; i++) {
    if (h[i].e < h[i - 1].e - 1e-12) {
      end = i;
      break;
    }
  }

  let E: number | null = null;
  const ref = mat.brittle ? (mat.fractureStress ?? 0) : mat.yield0;
  for (let i = 1; i < end; i++) {
    if (h[i].s > 0.5 * ref) break;
    if (h[i].e > 0) E = h[i].s / h[i].e;
  }

  // Tensile strength = maximum load. For a yield-point steel the upper yield peak is a transient
  // of discontinuous yielding, so the search starts once the Lüders plateau has been crossed.
  const skip = mat.upperYield !== undefined && mat.ludersStrain !== undefined ? mat.ludersStrain : 0;
  let uts = 0;
  let utsStrain = 0;
  for (const p of h) {
    if (p.e >= skip && p.s > uts) {
      uts = p.s;
      utsStrain = p.e;
    }
  }
  const pastTransient = uts > 0;
  if (!pastTransient) {
    for (const p of h) {
      if (p.s > uts) {
        uts = p.s;
        utsStrain = p.e;
      }
    }
  }
  const lastS = h[h.length - 1].s;
  const necked = !mat.brittle && pastTransient && (t.fractured || (t.plastic && lastS < 0.999 * uts));

  let yieldStrength: number | null = null;
  let upperYield: number | null = null;
  let offsetYield = false;
  if (!mat.brittle && E) {
    if (mat.upperYield !== undefined && mat.ludersStrain !== undefined) {
      let iPeak = -1;
      for (let i = 1; i < end && h[i].e < 0.5 * mat.ludersStrain; i++) {
        if (upperYield === null || h[i].s > upperYield) {
          upperYield = h[i].s;
          iPeak = i;
        }
      }
      // Lower yield: lowest stress during discontinuous yielding, once the initial transient has passed.
      if (iPeak > 0 && h[end - 1].e > mat.ludersStrain) {
        let lower = Infinity;
        for (let i = iPeak + 1; i < end && h[i].e <= mat.ludersStrain; i++) lower = Math.min(lower, h[i].s);
        if (Number.isFinite(lower)) yieldStrength = lower;
      }
    } else {
      for (let i = 1; i < end; i++) {
        const lineNow = E * (h[i].e - 0.002);
        if (h[i].s <= lineNow) {
          const linePrev = E * (h[i - 1].e - 0.002);
          const f = (h[i - 1].s - linePrev) / (h[i - 1].s - linePrev - (h[i].s - lineNow));
          yieldStrength = h[i - 1].s + f * (h[i].s - h[i - 1].s);
          offsetYield = true;
          break;
        }
      }
    }
  }

  let toughness = 0;
  for (let i = 1; i < h.length; i++) toughness += 0.5 * (h[i].s + h[i - 1].s) * (h[i].e - h[i - 1].e);

  let resilience: number | null = null;
  if (mat.brittle) {
    if (t.fractured) resilience = toughness;
  } else if (yieldStrength !== null && E) {
    resilience = (yieldStrength * yieldStrength) / (2 * E);
  }

  const iNeck = neckIndex(t);
  return {
    E,
    yieldStrength,
    upperYield,
    offsetYield,
    uts,
    utsStrain,
    necked,
    toughness,
    resilience,
    elongationAtBreak: t.fractured ? (unloadedLength(t) - t.L0) / t.L0 : null,
    reductionOfArea: 1 - Math.exp(-t.ep[iNeck]),
    permanentSet: (unloadedLength(t) - t.L0) / t.L0,
  };
}

/** Runs a complete test to fracture (for overlays and checks). */
export function runToFracture(params: SpecimenParams): TensileTest {
  const t = createTest(params);
  const chunk = t.L0 * 0.002;
  for (let k = 0; k < 20000 && !t.fractured; k++) advance(t, chunk);
  return t;
}
