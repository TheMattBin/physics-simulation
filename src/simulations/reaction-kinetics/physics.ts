/**
 * Reaction Kinetics: reactive hard-disk gas (zero React imports).
 *
 * Molecules are hard disks in a periodic 2D box, in real units (nm, ps, kg/mol, kJ/mol, K). When an
 * A and a B collide, the reaction A + B → C + D happens if the kinetic energy of their
 * approach along the line of centres reaches the activation energy, with an extra
 * orientation (steric) probability p. The reaction enthalpy is released into, or taken from,
 * that same relative motion, so momentum and energy are conserved exactly.
 *
 * Collision theory for this model in 2D (line-of-centres threshold, Maxwell gas) gives
 *   k(T) = χ · p · d · √(2πRT/μ) · exp(−Eₐ/RT)
 * where χ is the hard-disk contact value of the pair distribution (Henderson 1975).
 */

export const R_KJ = 8.314462618e-3; // kJ/(mol·K)
export const BOX_W = 32; // nm
export const BOX_H = 18; // nm
export const AREA = BOX_W * BOX_H; // nm²
export const DIAMETER = 0.5; // nm (all species)
export const MOLAR_MASS = 0.03; // kg/mol (all species)
const RADIUS = DIAMETER / 2;

function wrap(v: number, L: number): number {
  return v - L * Math.floor(v / L);
}

function minimumImage(d: number, L: number): number {
  return d - L * Math.round(d / L);
}
const REDUCED_MASS = MOLAR_MASS / 2;
/**
 * Isothermal mode: each molecule meets the inert bath (solvent or buffer gas) at this rate [1/ps]
 * and leaves with fresh Maxwell velocities at the bath temperature (Andersen thermostat).
 */
const BATH_RATE = 0.3;
/** Largest distance a molecule may travel in one step [nm] (5 % of a diameter keeps collision energies exact to < 1 %). */
const MAX_STEP_DISTANCE = 0.025;

export const SPECIES = { A: 0, B: 1, C: 2, D: 3 } as const;
export type SpeciesIndex = 0 | 1 | 2 | 3;

export type ThermalMode = 'isothermal' | 'adiabatic';

export interface KineticsParams {
  nA: number;
  nB: number;
  temperature: number; // bath temperature, or the starting temperature when adiabatic [K]
  activationEnergy: number; // Eₐ of A + B → C + D [kJ/mol]
  enthalpy: number; // ΔH [kJ/mol], negative = exothermic
  stericFactor: number; // p, fraction of energetic collisions with a reactive orientation
  catalyst: boolean;
  catalystDrop: number; // how much the catalysed pathway lowers Eₐ [kJ/mol]
  thermal: ThermalMode;
  reversible: boolean; // also allow C + D → A + B
}

/** Kinetic energy of molar mass M [kg/mol] moving at u [nm/ps], in kJ/mol. */
export function kineticEnergy(M: number, u: number): number {
  return 500 * M * u * u;
}

/** The barrier the reaction actually has to cross (the catalysed path is lower). */
export function effectiveBarrier(p: KineticsParams): number {
  const Ea = p.catalyst ? p.activationEnergy - p.catalystDrop : p.activationEnergy;
  // A reaction can never be easier than its own endothermicity.
  return Math.max(Ea, p.enthalpy, 0);
}

export function packingFraction(n: number): number {
  return (n * Math.PI * RADIUS * RADIUS) / AREA;
}

/** Contact value of the hard-disk pair distribution, g(d) = (1 − 7η/16)/(1 − η)² (Henderson). */
export function enskogFactor(eta: number): number {
  return (1 - (7 * eta) / 16) / (1 - eta) ** 2;
}

/** Mean relative speed factor √(2πRT/μ) [nm/ps]. */
function relativeSpeedFactor(T: number): number {
  return Math.sqrt((2 * Math.PI * 8.314462618 * T) / REDUCED_MASS) / 1000;
}

/** Collision-theory rate constant [nm²/ps] for a barrier Eₐ [kJ/mol] at temperature T [K]. */
export function rateConstant(T: number, Ea: number, p: number, nTotal: number): number {
  const chi = enskogFactor(packingFraction(nTotal));
  return chi * p * DIAMETER * relativeSpeedFactor(T) * Math.exp(-Ea / (R_KJ * T));
}

export function forwardRateConstant(T: number, params: KineticsParams): number {
  return rateConstant(T, effectiveBarrier(params), params.stericFactor, params.nA + params.nB);
}

export function reverseRateConstant(T: number, params: KineticsParams): number {
  return rateConstant(T, effectiveBarrier(params) - params.enthalpy, params.stericFactor, params.nA + params.nB);
}

/** Small, fast seeded generator so runs (and tests) are reproducible. */
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

export interface HistoryPoint {
  t: number; // ps
  counts: [number, number, number, number];
  T: number; // gas temperature, 5 ps average [K]
  theoryA: number; // mean-field prediction of N_A
}

export interface Flash {
  x: number;
  y: number;
  t: number;
  reverse: boolean;
}

/** Mean-field rate-law prediction run alongside the simulation. */
interface Theory {
  xi: number; // extent of reaction (number of net forward reactions)
  T: number;
}

export class ReactionGas {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly sp: Uint8Array;
  params: KineticsParams;
  readonly initial: { nA: number; nB: number; T: number };
  time = 0;
  /** Temperature averaged over the last ~5 ps: ~300 molecules fluctuate by a few % instant to instant. */
  smoothedT: number;
  counts: [number, number, number, number] = [0, 0, 0, 0];
  forward = 0;
  reverse = 0;
  collisions = 0;
  collisionsAB = 0;
  /** Rate-constant measurement window: reactions and the exposure ∫ N_A N_B / Area dt since it opened. */
  window = { start: 0, reactions: 0, exposure: 0, tempIntegral: 0, collisionsAB: 0 };
  /** Line-of-centres energies [kJ/mol] of recent A–B collisions. */
  readonly energies = new Float32Array(6000);
  /** Gas temperature when each of those collisions happened (it changes in an insulated run). */
  readonly energyTemps = new Float32Array(6000);
  energyCount = 0;
  private energyHead = 0;
  flashes: Flash[] = [];
  history: HistoryPoint[] = [];
  private recordEvery = 1; // ps
  private nextRecord = 0;
  theory: Theory;
  private readonly rng: () => number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly head: Int32Array;
  private readonly next: Int32Array;

  constructor(params: KineticsParams, seed = 1) {
    this.params = { ...params };
    this.rng = mulberry32(seed);
    this.n = Math.round(params.nA) + Math.round(params.nB);
    this.x = new Float64Array(this.n);
    this.y = new Float64Array(this.n);
    this.vx = new Float64Array(this.n);
    this.vy = new Float64Array(this.n);
    this.sp = new Uint8Array(this.n);
    this.cols = Math.floor(BOX_W / DIAMETER);
    this.rows = Math.floor(BOX_H / DIAMETER);
    this.head = new Int32Array(this.cols * this.rows);
    this.next = new Int32Array(this.n);
    this.initial = { nA: Math.round(params.nA), nB: Math.round(params.nB), T: params.temperature };
    this.theory = { xi: 0, T: params.temperature };
    this.smoothedT = params.temperature;
    this.place();
    this.recordHistory(true);
  }

  private gauss(): number {
    let u = 0;
    while (u <= 1e-12) u = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng());
  }

  /** Thermal velocity spread per component at temperature T [nm/ps]. */
  private sigmaV(T: number): number {
    return Math.sqrt((8.314462618 * T) / MOLAR_MASS) / 1000;
  }

  private place() {
    const { nA } = this.initial;
    const minD2 = (DIAMETER * 1.05) ** 2;
    for (let i = 0; i < this.n; i++) {
      this.sp[i] = i < nA ? SPECIES.A : SPECIES.B;
      for (let tries = 0; tries < 2000; tries++) {
        const px = this.rng() * BOX_W;
        const py = this.rng() * BOX_H;
        let ok = true;
        for (let j = 0; j < i && ok; j++) {
          const dx = minimumImage(this.x[j] - px, BOX_W);
          const dy = minimumImage(this.y[j] - py, BOX_H);
          if (dx * dx + dy * dy < minD2) ok = false;
        }
        this.x[i] = px;
        this.y[i] = py;
        if (ok) break;
      }
    }
    // Shuffle species so A and B start well mixed.
    for (let i = this.n - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const s = this.sp[i];
      this.sp[i] = this.sp[j];
      this.sp[j] = s;
    }
    // Maxwell velocities with zero total momentum, rescaled to exactly the starting temperature.
    const s = this.sigmaV(this.initial.T);
    let mx = 0;
    let my = 0;
    for (let i = 0; i < this.n; i++) {
      this.vx[i] = s * this.gauss();
      this.vy[i] = s * this.gauss();
      mx += this.vx[i] / this.n;
      my += this.vy[i] / this.n;
    }
    for (let i = 0; i < this.n; i++) {
      this.vx[i] -= mx;
      this.vy[i] -= my;
    }
    const scale = Math.sqrt(this.initial.T / Math.max(1e-9, this.temperature()));
    for (let i = 0; i < this.n; i++) {
      this.vx[i] *= scale;
      this.vy[i] *= scale;
    }
    this.counts = [0, 0, 0, 0];
    for (let i = 0; i < this.n; i++) this.counts[this.sp[i]]++;
  }

  /** Kinetic temperature: in 2D each molecule carries RT of kinetic energy per mole. */
  temperature(): number {
    let ke = 0;
    for (let i = 0; i < this.n; i++) ke += this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
    return (500 * MOLAR_MASS * ke) / (this.n * R_KJ);
  }

  /** Total energy [kJ/mol]: kinetic energy plus the chemical energy stored in the products (ΔH per reaction). */
  totalEnergy(): number {
    let ke = 0;
    for (let i = 0; i < this.n; i++) ke += this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
    return 500 * MOLAR_MASS * ke + (this.forward - this.reverse) * this.params.enthalpy;
  }

  /** Changing conditions mid-run starts a fresh rate-constant measurement. */
  setParams(p: KineticsParams) {
    const changed =
      p.temperature !== this.params.temperature ||
      p.activationEnergy !== this.params.activationEnergy ||
      p.enthalpy !== this.params.enthalpy ||
      p.stericFactor !== this.params.stericFactor ||
      p.catalyst !== this.params.catalyst ||
      p.catalystDrop !== this.params.catalystDrop ||
      p.thermal !== this.params.thermal ||
      p.reversible !== this.params.reversible;
    const tempChanged = p.temperature !== this.params.temperature || p.thermal !== this.params.thermal;
    this.params = { ...p };
    if (changed) this.resetWindow();
    if (tempChanged) {
      this.energyCount = 0;
      this.energyHead = 0;
      if (p.thermal === 'isothermal') this.theory.T = p.temperature;
    }
  }

  resetWindow() {
    this.window = { start: this.time, reactions: 0, exposure: 0, tempIntegral: 0, collisionsAB: 0 };
  }

  /** Measured rate constant [nm²/ps] with its counting uncertainty, and the mean temperature of the window. */
  measuredRateConstant(): { k: number; error: number; reactions: number; T: number; duration: number } {
    const w = this.window;
    const duration = this.time - w.start;
    const k = w.exposure > 0 ? w.reactions / w.exposure : 0;
    return {
      k,
      error: w.reactions > 0 ? k / Math.sqrt(w.reactions) : 0,
      reactions: w.reactions,
      T: duration > 0 ? w.tempIntegral / duration : this.temperature(),
      duration,
    };
  }

  /** Advances the gas by `duration` ps in steps short enough that no molecule moves more than 0.025 nm. */
  advance(duration: number) {
    let remaining = duration;
    let guard = 0;
    while (remaining > 1e-12 && guard++ < 100000) {
      let vmax2 = 0;
      for (let i = 0; i < this.n; i++) vmax2 = Math.max(vmax2, this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i]);
      const dt = Math.min(remaining, 0.02, MAX_STEP_DISTANCE / Math.max(1e-6, Math.sqrt(vmax2)));
      this.step(dt);
      remaining -= dt;
    }
  }

  private step(dt: number) {
    const p = this.params;
    const isothermal = p.thermal === 'isothermal';
    const sBath = this.sigmaV(p.temperature);

    // Free flight with periodic boundaries: the box is a window into a larger, uniform gas.
    for (let i = 0; i < this.n; i++) {
      this.x[i] = wrap(this.x[i] + this.vx[i] * dt, BOX_W);
      this.y[i] = wrap(this.y[i] + this.vy[i] * dt, BOX_H);
    }

    // Heat bath (Andersen): occasional collisions with an inert buffer gas at the bath temperature.
    if (isothermal) {
      const prob = BATH_RATE * dt;
      for (let i = 0; i < this.n; i++) {
        if (this.rng() < prob) {
          this.vx[i] = sBath * this.gauss();
          this.vy[i] = sBath * this.gauss();
        }
      }
    }

    // Cell list (cells exactly one diameter wide, wrapping around the periodic box)
    this.head.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const c = Math.min(this.cols - 1, Math.floor(this.x[i] / DIAMETER));
      const r = Math.min(this.rows - 1, Math.floor(this.y[i] / DIAMETER));
      const cell = r * this.cols + c;
      this.next[i] = this.head[cell];
      this.head[cell] = i;
    }
    const neighbours = [
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        for (let i = this.head[r * this.cols + c]; i !== -1; i = this.next[i]) {
          for (const [dc, dr] of neighbours) {
            const cc = (c + dc + this.cols) % this.cols;
            const rr = (r + dr) % this.rows;
            let j = dc === 0 && dr === 0 ? this.next[i] : this.head[rr * this.cols + cc];
            for (; j !== -1; j = this.next[j]) this.collide(i, j);
          }
        }
      }
    }

    // Bookkeeping
    const [nA, nB] = this.counts;
    const T = this.temperature();
    this.window.exposure += ((nA * nB) / AREA) * dt;
    this.window.tempIntegral += T * dt;
    this.smoothedT += (dt / 5) * (T - this.smoothedT);
    this.advanceTheory(dt);
    this.time += dt;
    if (this.time >= this.nextRecord) this.recordHistory(false);
  }

  private collide(i: number, j: number) {
    const dx = minimumImage(this.x[j] - this.x[i], BOX_W);
    const dy = minimumImage(this.y[j] - this.y[i], BOX_H);
    const d2 = dx * dx + dy * dy;
    if (d2 >= DIAMETER * DIAMETER || d2 === 0) return;
    const wx = this.vx[j] - this.vx[i];
    const wy = this.vy[j] - this.vy[i];
    const rw = dx * wx + dy * wy;
    if (rw >= 0) return; // already separating
    // The pair is found overlapping after a step. Back up to the moment of contact, |r − wτ| = d,
    // so the collision uses the true line of centres (as event-driven dynamics would).
    const w2 = wx * wx + wy * wy;
    const tau = Math.min((rw + Math.sqrt(rw * rw - w2 * (d2 - DIAMETER * DIAMETER))) / w2, 0.05);
    const cx = dx - wx * tau;
    const cy = dy - wy * tau;
    const cl = Math.hypot(cx, cy);
    const nx = cx / cl;
    const ny = cy / cl;
    const u = -(wx * nx + wy * ny); // approach speed along the line of centres
    if (u <= 0) return;
    this.collisions++;

    const p = this.params;
    const si = this.sp[i];
    const sj = this.sp[j];
    const Ea = effectiveBarrier(p);
    let released = 0; // energy put into the separating motion [kJ/mol]
    let reacted = false;
    let reverse = false;
    const isAB = (si === SPECIES.A && sj === SPECIES.B) || (si === SPECIES.B && sj === SPECIES.A);
    const isCD = (si === SPECIES.C && sj === SPECIES.D) || (si === SPECIES.D && sj === SPECIES.C);
    const E = kineticEnergy(REDUCED_MASS, u);
    if (isAB) {
      this.collisionsAB++;
      this.window.collisionsAB++;
      this.energies[this.energyHead] = E;
      this.energyTemps[this.energyHead] = this.smoothedT;
      this.energyHead = (this.energyHead + 1) % this.energies.length;
      this.energyCount = Math.min(this.energyCount + 1, this.energies.length);
      if (E >= Ea && this.rng() < p.stericFactor) {
        reacted = true;
        released = -p.enthalpy;
        this.sp[i] = si === SPECIES.A ? SPECIES.C : SPECIES.D;
        this.sp[j] = sj === SPECIES.A ? SPECIES.C : SPECIES.D;
      }
    } else if (isCD && p.reversible) {
      if (E >= Ea - p.enthalpy && this.rng() < p.stericFactor) {
        reacted = true;
        reverse = true;
        released = p.enthalpy;
        this.sp[i] = si === SPECIES.C ? SPECIES.A : SPECIES.B;
        this.sp[j] = sj === SPECIES.C ? SPECIES.A : SPECIES.B;
      }
    }

    const uOut = reacted ? Math.sqrt(Math.max(0, u * u + released / (500 * REDUCED_MASS))) : u;
    const J = 0.5 * (u + uOut); // equal masses: each molecule's velocity changes by J along the normal
    this.vx[i] -= J * nx;
    this.vy[i] -= J * ny;
    this.vx[j] += J * nx;
    this.vy[j] += J * ny;
    // Replay the time τ since contact with the new velocities.
    this.x[i] = wrap(this.x[i] - J * nx * tau, BOX_W);
    this.y[i] = wrap(this.y[i] - J * ny * tau, BOX_H);
    this.x[j] = wrap(this.x[j] + J * nx * tau, BOX_W);
    this.y[j] = wrap(this.y[j] + J * ny * tau, BOX_H);

    if (reacted) {
      if (reverse) {
        this.reverse++;
        this.counts[SPECIES.C]--;
        this.counts[SPECIES.D]--;
        this.counts[SPECIES.A]++;
        this.counts[SPECIES.B]++;
        this.window.reactions--;
      } else {
        this.forward++;
        this.counts[SPECIES.A]--;
        this.counts[SPECIES.B]--;
        this.counts[SPECIES.C]++;
        this.counts[SPECIES.D]++;
        this.window.reactions++;
      }
      this.flashes.push({ x: wrap(this.x[i] + 0.5 * dx, BOX_W), y: wrap(this.y[i] + 0.5 * dy, BOX_H), t: this.time, reverse });
      if (this.flashes.length > 200) this.flashes.splice(0, this.flashes.length - 200);
    }
  }

  /** dξ/dt = k_f N_A N_B / Area − k_r N_C N_D / Area, with T from the bath or from the adiabatic energy balance. */
  private theoryRate(xi: number, T: number): number {
    const p = this.params;
    const { nA, nB } = this.initial;
    const a = Math.max(0, nA - xi);
    const b = Math.max(0, nB - xi);
    let rate = (forwardRateConstant(T, p) * a * b) / AREA;
    if (p.reversible) rate -= (reverseRateConstant(T, p) * xi * xi) / AREA;
    return rate;
  }

  private advanceTheory(dt: number) {
    const p = this.params;
    const th = this.theory;
    const TofXi = (xi: number) =>
      p.thermal === 'adiabatic' ? Math.max(1, th.T + (-p.enthalpy * (xi - th.xi)) / (this.n * R_KJ)) : p.temperature;
    const k1 = this.theoryRate(th.xi, TofXi(th.xi));
    const k2 = this.theoryRate(th.xi + 0.5 * dt * k1, TofXi(th.xi + 0.5 * dt * k1));
    const k3 = this.theoryRate(th.xi + 0.5 * dt * k2, TofXi(th.xi + 0.5 * dt * k2));
    const k4 = this.theoryRate(th.xi + dt * k3, TofXi(th.xi + dt * k3));
    const xiNew = th.xi + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    th.T = TofXi(xiNew);
    th.xi = xiNew;
  }

  private recordHistory(force: boolean) {
    if (!force && this.time < this.nextRecord) return;
    this.history.push({
      t: this.time,
      counts: [...this.counts] as [number, number, number, number],
      T: this.smoothedT,
      theoryA: this.initial.nA - this.theory.xi,
    });
    this.nextRecord = this.time + this.recordEvery;
    if (this.history.length > 2400) {
      this.history = this.history.filter((_, k) => k % 2 === 0);
      this.recordEvery *= 2;
    }
  }

  /** Recent A–B collision energies (oldest first is not guaranteed). */
  energySample(): Float32Array {
    return this.energies.subarray(0, this.energyCount);
  }

  /**
   * Temperatures the sampled collisions happened at, binned with weights. In a heat bath this is a
   * single temperature; in an insulated run the theory for the sample is the matching mixture of
   * exponentials, P(E ≥ Eₐ) = ⟨e^(−Eₐ/RT)⟩.
   */
  sampleTemperatures(): { T: number; w: number }[] {
    const n = this.energyCount;
    if (n === 0) return [{ T: this.smoothedT, w: 1 }];
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, this.energyTemps[i]);
      hi = Math.max(hi, this.energyTemps[i]);
    }
    if (hi - lo < 1) return [{ T: 0.5 * (lo + hi), w: 1 }];
    const bins = 24;
    const counts = new Array(bins).fill(0);
    for (let i = 0; i < n; i++) counts[Math.min(bins - 1, Math.floor(((this.energyTemps[i] - lo) / (hi - lo)) * bins))]++;
    return counts
      .map((c, k) => ({ T: lo + ((k + 0.5) / bins) * (hi - lo), w: c / n }))
      .filter((b) => b.w > 0);
  }
}

// ---------------------------------------------------------------------------------------------
// Analysis: the measurements a student makes from the run
// ---------------------------------------------------------------------------------------------

export type ConcMode = 'conc' | 'ln' | 'inv';

export interface ArrheniusPoint {
  T: number;
  k: number;
  error: number;
  reactions: number;
  key: string; // conditions the point was measured under (barrier, p)
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

export function linearFit(xs: number[], ys: number[]): LinearFit | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1, n };
}

/** The rate-law transform of a count of A: [A], ln[A] or 1/[A] with [A] = N/Area in molecules/nm². */
export function transform(mode: ConcMode, nA: number): number {
  const c = nA / AREA;
  if (mode === 'ln') return Math.log(c);
  if (mode === 'inv') return 1 / c;
  return nA;
}

/** Fits stop once A is down to 15 % of its start: the last few molecules are too noisy to fit. */
export function fitFloor(nA0: number): number {
  return Math.max(5, 0.15 * nA0);
}

export function concentrationFit(gas: ReactionGas, mode: ConcMode): LinearFit | null {
  if (mode === 'conc') return null;
  const floor = fitFloor(gas.initial.nA);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const h of gas.history) {
    if (h.counts[0] < floor) break;
    xs.push(h.t);
    ys.push(transform(mode, h.counts[0]));
  }
  return linearFit(xs, ys);
}

/** Theoretical share of collisions with line-of-centres energy ≥ E for a mixture of temperatures. */
export function theoryFractionAbove(mix: { T: number; w: number }[], E: number): number {
  return mix.reduce((acc, m) => acc + m.w * Math.exp(-E / (R_KJ * m.T)), 0);
}

export function fractionAbove(sample: Float32Array, E: number): number {
  if (sample.length === 0) return 0;
  let c = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] >= E) c++;
  return c / sample.length;
}

export function arrheniusFit(points: ArrheniusPoint[]): (LinearFit & { Ea: number; EaErr: number }) | null {
  if (points.length < 2) return null;
  // Weighted least squares on ln k vs 1/T with weights n (ln k has variance 1/n).
  let W = 0;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    W += p.reactions;
    sx += p.reactions * (1 / p.T);
    sy += p.reactions * Math.log(p.k);
  }
  const mx = sx / W;
  const my = sy / W;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = 1 / p.T - mx;
    const dy = Math.log(p.k) - my;
    sxx += p.reactions * dx * dx;
    sxy += p.reactions * dx * dy;
    syy += p.reactions * dy * dy;
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  return {
    slope,
    intercept: my - slope * mx,
    r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1,
    n: points.length,
    Ea: -slope * R_KJ,
    EaErr: Math.sqrt(1 / sxx) * R_KJ,
  };
}
