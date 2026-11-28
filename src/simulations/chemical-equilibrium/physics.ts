/**
 * Chemical Equilibrium & Le Chatelier: pure solver (zero React imports).
 *
 * Ideal-gas equilibria with real thermodynamic data:
 *   N₂O₄ ⇌ 2 NO₂       in a syringe at fixed volume (the piston sets V), in a water bath;
 *   N₂ + 3 H₂ ⇌ 2 NH₃  in a reactor held at fixed pressure (Haber–Bosch).
 *
 * The state is the amount of each species. For any state the reaction quotient is
 * Q = Π (pᵢ/P°)^νᵢ, and the equilibrium constant K(T) comes from ΔG° = −RT ln K. Because
 * ln Q always increases with the extent of reaction ξ, the equilibrium is found by bisection.
 * Time evolution uses a forward rate r_f and the thermodynamically consistent reverse rate
 * r_r = r_f · Q/K, so the net rate vanishes exactly when Q = K.
 */

export const R = 8.314462618; // J/(mol·K)
export const R_LBAR = 0.08314462618; // L·bar/(mol·K)
export const P_STD = 1; // standard pressure [bar]

export type SystemId = 'no2' | 'haber';

export interface SpeciesInfo {
  key: string;
  formula: string;
  nu: number; // stoichiometric coefficient: negative for reactants, positive for products, 0 for inert
  color: string;
}

export interface ChemSystem {
  id: SystemId;
  name: string;
  equation: string;
  species: SpeciesInfo[];
  control: 'volume' | 'pressure';
  /** Equilibrium constant K(T) on the 1 bar standard state. */
  lnK: (T: number) => number;
  /** Standard reaction enthalpy at T [J/mol], for display and van 't Hoff. */
  dH: (T: number) => number;
  /**
   * Forward and reverse rates [mol/s, display time]. Each reverse rate is the forward rate times
   * Q/K, simplified algebraically so it stays finite when a reactant is absent.
   */
  rates: (s: ChemState) => { forward: number; reverse: number };
  Tmin: number;
  Tmax: number;
}

export interface ChemState {
  n: number[]; // amounts [mol], same order as system.species
  T: number; // K
  V: number; // L (fixed for a 'volume' system, follows from P for a 'pressure' system)
  P: number; // bar (fixed for a 'pressure' system, follows from V for a 'volume' system)
  catalyst: boolean;
  time: number; // s (display time)
  /** Net extent of reaction since the start [mol]: drives the molecule picture. */
  extent: number;
}

// --------------------------------------------------------------------------------------------
// N₂O₄ ⇌ 2 NO₂: standard 298 K data (ΔfH°, S° from NIST-JANAF / CRC tables)
// --------------------------------------------------------------------------------------------
export const NO2_DH = 57.2e3; // J/mol
export const NO2_DS = 175.8; // J/(mol·K)
/** Dissociation barrier ≈ ΔH (recombination of two NO₂ radicals needs almost no activation). */
const NO2_EA = 57e3;
/** Display pre-factor: the real reaction settles in microseconds; here it takes a couple of seconds. */
const NO2_A = 1.5e9;

// --------------------------------------------------------------------------------------------
// N₂ + 3 H₂ ⇌ 2 NH₃: Gillespie & Beattie (1930) correlation for ½N₂ + 3/2 H₂ ⇌ NH₃ (atm⁻¹)
//   log₁₀ K = −2.691122 log₁₀T − 5.519265e−5 T + 1.848863e−7 T² + 2001.6/T + 2.6899
// --------------------------------------------------------------------------------------------
function log10KhalfAtm(T: number): number {
  return -2.691122 * Math.log10(T) - 5.519265e-5 * T + 1.848863e-7 * T * T + 2001.6 / T + 2.6899;
}
/** Iron catalyst, apparent activation energy; the uncatalysed route (breaking N≡N) is far slower. */
const HABER_EA_CAT = 75e3;
const HABER_A_CAT = 1.1e5;
const HABER_EA_UNCAT = 230e3;
const HABER_A_UNCAT = 1.1e5;

export const SYSTEMS: Record<SystemId, ChemSystem> = {
  no2: {
    id: 'no2',
    name: 'Nitrogen Dioxide (N₂O₄ ⇌ 2 NO₂)',
    equation: 'N₂O₄ ⇌ 2 NO₂',
    species: [
      { key: 'N2O4', formula: 'N₂O₄', nu: -1, color: '#e2e8f0' },
      { key: 'NO2', formula: 'NO₂', nu: 2, color: '#d97706' },
      { key: 'Ar', formula: 'Ar', nu: 0, color: '#a78bfa' },
    ],
    control: 'volume',
    lnK: (T) => -(NO2_DH - T * NO2_DS) / (R * T),
    dH: () => NO2_DH,
    rates: (s) => {
      // Elementary steps: dissociation k_d·n(N₂O₄); recombination k_d·n(NO₂)²·RT/(V·P°·K).
      const kd = NO2_A * Math.exp(-NO2_EA / (R * s.T));
      const K = Math.exp(SYSTEMS.no2.lnK(s.T));
      return { forward: kd * s.n[0], reverse: (kd * s.n[1] * s.n[1] * R_LBAR * s.T) / (s.V * P_STD * K) };
    },
    Tmin: 273,
    Tmax: 373,
  },
  haber: {
    id: 'haber',
    name: 'Haber–Bosch (N₂ + 3 H₂ ⇌ 2 NH₃)',
    equation: 'N₂ + 3 H₂ ⇌ 2 NH₃',
    species: [
      { key: 'N2', formula: 'N₂', nu: -1, color: '#60a5fa' },
      { key: 'H2', formula: 'H₂', nu: -3, color: '#e2e8f0' },
      { key: 'NH3', formula: 'NH₃', nu: 2, color: '#34d399' },
      { key: 'Ar', formula: 'Ar', nu: 0, color: '#a78bfa' },
    ],
    control: 'pressure',
    // K for the full reaction is the square of the half reaction's; convert atm⁻² to bar⁻².
    lnK: (T) => 2 * Math.LN10 * log10KhalfAtm(T) - 2 * Math.log(1.01325),
    dH: (T) => {
      // van 't Hoff: ΔH = R T² d ln K / dT (numerical derivative of the correlation)
      const h = 0.01;
      const lnK = SYSTEMS.haber.lnK;
      return (R * T * T * (lnK(T + h) - lnK(T - h))) / (2 * h);
    },
    rates: (s) => {
      // Driving-force law: forward k·n(N₂)·x(H₂); reverse = forward·Q/K = k·n·x(NH₃)²/(x(H₂)²(P/P°)²K).
      const k = s.catalyst
        ? HABER_A_CAT * Math.exp(-HABER_EA_CAT / (R * s.T))
        : HABER_A_UNCAT * Math.exp(-HABER_EA_UNCAT / (R * s.T));
      const nt = s.n.reduce((a, b) => a + b, 0);
      const xH2 = Math.max(1e-9, s.n[1] / nt);
      const xNH3 = s.n[2] / nt;
      const K = Math.exp(SYSTEMS.haber.lnK(s.T));
      return {
        forward: k * s.n[0] * xH2,
        reverse: (k * nt * xNH3 * xNH3) / (xH2 * xH2 * (s.P / P_STD) ** 2 * K),
      };
    },
    Tmin: 500,
    Tmax: 900,
  },
};

export function totalMoles(s: ChemState): number {
  return s.n.reduce((a, b) => a + b, 0);
}

/** Bring V or P in line with the ideal-gas law for the system's control variable. */
export function syncGasLaw(sys: ChemSystem, s: ChemState) {
  const nt = totalMoles(s);
  if (sys.control === 'volume') s.P = (nt * R_LBAR * s.T) / s.V;
  else s.V = (nt * R_LBAR * s.T) / s.P;
}

export function partialPressures(sys: ChemSystem, s: ChemState): number[] {
  if (sys.control === 'volume') return s.n.map((ni) => (ni * R_LBAR * s.T) / s.V);
  const nt = totalMoles(s);
  return s.n.map((ni) => (ni / nt) * s.P);
}

/** ln Q for amounts n (−∞/+∞ when a reactant/product is absent). */
function lnQof(sys: ChemSystem, s: ChemState, n: number[]): number {
  const nt = n.reduce((a, b) => a + b, 0);
  let lnQ = 0;
  sys.species.forEach((sp, i) => {
    if (sp.nu === 0) return;
    const p = sys.control === 'volume' ? (n[i] * R_LBAR * s.T) / s.V : (n[i] / nt) * s.P;
    lnQ += sp.nu * Math.log(Math.max(p, 1e-300) / P_STD);
  });
  return lnQ;
}

export function lnQ(sys: ChemSystem, s: ChemState): number {
  return lnQof(sys, s, s.n);
}

/** Range of extents that keep every amount non-negative. */
function extentRange(sys: ChemSystem, s: ChemState): [number, number] {
  let lo = -Infinity;
  let hi = Infinity;
  sys.species.forEach((sp, i) => {
    if (sp.nu > 0) lo = Math.max(lo, -s.n[i] / sp.nu);
    if (sp.nu < 0) hi = Math.min(hi, s.n[i] / -sp.nu);
  });
  return [lo, hi];
}

function shifted(sys: ChemSystem, s: ChemState, xi: number): number[] {
  return s.n.map((ni, i) => Math.max(0, ni + sys.species[i].nu * xi));
}

/** Extent ξ (from the current state) at which Q = K. ln Q(ξ) is strictly increasing, so bisection is safe. */
export function equilibriumExtent(sys: ChemSystem, s: ChemState): number {
  const target = sys.lnK(s.T);
  let [lo, hi] = extentRange(sys, s);
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (lo + hi);
    if (lnQof(sys, s, shifted(sys, s, mid)) < target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function equilibriumState(sys: ChemSystem, s: ChemState): ChemState {
  const eq: ChemState = { ...s, n: shifted(sys, s, equilibriumExtent(sys, s)) };
  syncGasLaw(sys, eq);
  return eq;
}

/** Forward and reverse rates [mol/s]; they are equal exactly at equilibrium (r_r / r_f = Q/K). */
export function rates(sys: ChemSystem, s: ChemState): { forward: number; reverse: number } {
  return sys.rates(s);
}

/**
 * Advances the reaction by dt seconds. Each substep moves ξ by the net rate, but never past
 * the equilibrium extent, so the approach is monotonic and stable however stiff the rates get.
 */
export function advance(sys: ChemSystem, s: ChemState, dt: number) {
  const sub = 8;
  const h = dt / sub;
  for (let k = 0; k < sub; k++) {
    const xiEq = equilibriumExtent(sys, s);
    const { forward, reverse } = sys.rates(s);
    let dxi = (forward - reverse) * h;
    if ((xiEq > 0 && dxi > xiEq) || (xiEq < 0 && dxi < xiEq)) dxi = xiEq;
    s.n = shifted(sys, s, dxi);
    s.extent += dxi;
    syncGasLaw(sys, s);
    s.time += h;
  }
}

/** Degree of dissociation of N₂O₄ (fraction of the N₂O₄ that is present as NO₂). */
export function dissociation(s: ChemState): number {
  const total = s.n[0] + 0.5 * s.n[1];
  return total > 0 ? (0.5 * s.n[1]) / total : 0;
}

/** Mole fraction of species i, excluding nothing. */
export function moleFraction(s: ChemState, i: number): number {
  const nt = totalMoles(s);
  return nt > 0 ? s.n[i] / nt : 0;
}

/** Equilibrium NH₃ mole fraction for a 1 : 3 feed at (T, P), for yield maps. */
export function haberYield(T: number, P: number, inertFraction = 0): number {
  const sys = SYSTEMS.haber;
  const s: ChemState = { n: [0.25 * (1 - inertFraction), 0.75 * (1 - inertFraction), 0, inertFraction], T, P, V: 1, catalyst: true, time: 0, extent: 0 };
  syncGasLaw(sys, s);
  return moleFraction(equilibriumState(sys, s), 2);
}

/** Equilibrium degree of dissociation of N₂O₄ for a given N₂O₄ amount [mol] in volume V [L] at T. */
export function no2Dissociation(T: number, V: number, n0: number): number {
  const sys = SYSTEMS.no2;
  const s: ChemState = { n: [n0, 0, 0], T, V, P: 1, catalyst: false, time: 0, extent: 0 };
  syncGasLaw(sys, s);
  return dissociation(equilibriumState(sys, s));
}

/** ΔG of the reaction mixture, RT ln(Q/K) [J/mol]: negative means it runs forward. */
export function reactionGibbs(sys: ChemSystem, s: ChemState): number {
  return R * s.T * (lnQ(sys, s) - sys.lnK(s.T));
}
