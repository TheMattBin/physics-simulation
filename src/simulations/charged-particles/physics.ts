/**
 * Charged particles in electric and magnetic fields: m dv/dt = q (E + v × B).
 *
 * Motion is in the x–y plane with B along z (positive = out of the page) and E in the plane,
 * so particles never leave the plane. Units are SI throughout (m, s, kg, C, V/m, T).
 *
 * Integration uses the Boris pusher: half electric kick, exact magnetic rotation, half electric
 * kick. In a pure magnetic field the rotation preserves |v| to machine precision (the magnetic
 * force does no work), and in combined fields the energy error stays bounded instead of drifting.
 * This module has no imports so it runs standalone in Node.
 */

export const E_CHARGE = 1.602176634e-19; // C
export const AMU = 1.6605390666e-27; // kg

export type Scenario = 'uniform' | 'selector' | 'spectrometer';

export interface Species {
  id: string;
  label: string; // for HTML (may use Unicode superscripts)
  short: string; // ASCII-safe label for canvas
  massU: number; // atomic mass units
  charge: number; // multiples of e (signed)
  abundance?: number; // natural abundance (spectrometer sample)
}

export const SPECIES: Species[] = [
  { id: 'proton', label: 'Proton p⁺', short: 'p+', massU: 1.007276, charge: 1 },
  { id: 'deuteron', label: 'Deuteron d⁺', short: 'd+', massU: 2.013553, charge: 1 },
  { id: 'alpha', label: 'Alpha α²⁺', short: 'α2+', massU: 4.001506, charge: 2 },
  { id: 'hydride', label: 'Hydride H⁻', short: 'H-', massU: 1.008374, charge: -1 },
];

/** Singly ionized neon isotopes (atomic mass minus one electron) with natural abundances. */
export const NEON_ISOTOPES: Species[] = [
  { id: 'ne20', label: 'Ne-20⁺', short: 'Ne-20', massU: 19.991891, charge: 1, abundance: 0.9048 },
  { id: 'ne21', label: 'Ne-21⁺', short: 'Ne-21', massU: 20.993298, charge: 1, abundance: 0.0027 },
  { id: 'ne22', label: 'Ne-22⁺', short: 'Ne-22', massU: 21.990836, charge: 1, abundance: 0.0925 },
];

export interface FieldParams {
  scenario: Scenario;
  speciesId: string; // uniform & selector
  v0: number; // m/s launch speed (uniform)
  E: number; // V/m along +y: whole chamber (uniform) or between the selector plates
  B: number; // T along +z: whole chamber (uniform) or between the selector plates
  B2: number; // T along +z in the spectrometer's analyzer region
}

export type ParticleState = 'flying' | 'absorbed' | 'transmitted' | 'detected' | 'escaped';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  q: number; // C
  m: number; // kg
  speciesIndex: number;
  launchSpeed: number;
  state: ParticleState;
  lastDt: number; // last substep (s); velocities live at half steps, positions at whole steps
  detectorD?: number; // spectrometer: landing distance below the entrance slit (m)
}

/** Chamber and apparatus geometry in metres. */
export const WORLD = { w: 0.32, h: 0.2 } as const;

export const SELECTOR = {
  source: { x: 0.01, y: 0.1 },
  plateX0: 0.06,
  plateX1: 0.24,
  plateTop: 0.14,
  plateBottom: 0.06,
  exitX: 0.27,
  slitHalf: 0.003,
  detectorX: 0.31,
  speedMin: 50e3,
  speedMax: 150e3,
  rate: 15e6, // particles per second of simulated time (15 per µs)
} as const;

export const SPECTROMETER = {
  source: { x: 0.005, y: 0.175 },
  plateX0: 0.02,
  plateX1: 0.12,
  plateTop: 0.195,
  plateBottom: 0.155,
  exitX: 0.13,
  slitHalf: 0.001,
  analyzerX: 0.14,
  detectorMinY: 0.005,
  detectorMaxY: 0.165,
  speedMin: 92e3,
  speedMax: 108e3,
  rate: 20e6,
} as const;

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}

export function speciesForParticle(p: FieldParams, index: number): Species {
  return p.scenario === 'spectrometer' ? NEON_ISOTOPES[index] : speciesById(p.speciesId);
}

export interface Field {
  ex: number;
  ey: number;
  bz: number;
}

const NO_FIELD: Field = { ex: 0, ey: 0, bz: 0 };

function inPlates(
  g: { plateX0: number; plateX1: number; plateTop: number; plateBottom: number },
  x: number,
  y: number,
): boolean {
  return x >= g.plateX0 && x <= g.plateX1 && y >= g.plateBottom && y <= g.plateTop;
}

export function fieldAt(p: FieldParams, x: number, y: number): Field {
  switch (p.scenario) {
    case 'uniform':
      return { ex: 0, ey: p.E, bz: p.B };
    case 'selector':
      return inPlates(SELECTOR, x, y) ? { ex: 0, ey: p.E, bz: p.B } : NO_FIELD;
    case 'spectrometer':
      if (inPlates(SPECTROMETER, x, y)) return { ex: 0, ey: p.E, bz: p.B };
      if (x >= SPECTROMETER.analyzerX) return { ex: 0, ey: 0, bz: p.B2 };
      return NO_FIELD;
  }
}

/** One Boris step for a particle in a fixed field. Mutates pt. */
export function borisStep(pt: Particle, f: Field, dt: number): void {
  const k = (pt.q / pt.m) * dt * 0.5;
  let vx = pt.vx + k * f.ex;
  let vy = pt.vy + k * f.ey;
  const t = k * f.bz;
  const s = (2 * t) / (1 + t * t);
  // v' = v⁻ + v⁻ × t ;  v⁺ = v⁻ + v' × s   (t and s along z)
  const px = vx + vy * t;
  const py = vy - vx * t;
  vx += py * s;
  vy -= px * s;
  vx += k * f.ex;
  vy += k * f.ey;
  pt.vx = vx;
  pt.vy = vy;
  pt.x += vx * dt;
  pt.y += vy * dt;
  pt.lastDt = dt;
}

function maxSubstep(pt: Particle, p: FieldParams): number {
  const bMax = Math.max(Math.abs(p.B), p.scenario === 'spectrometer' ? Math.abs(p.B2) : 0);
  const omega = (Math.abs(pt.q) * bMax) / pt.m;
  const speed = Math.hypot(pt.vx, pt.vy);
  let dt = 5e-9;
  if (omega > 0) dt = Math.min(dt, 0.05 / omega); // ≤ 0.05 rad of gyration per step
  if (speed > 0) dt = Math.min(dt, 1e-3 / speed); // ≤ 1 mm per step
  return dt;
}

/** Applies walls, plates, slits and detectors after a step from (x0, y0). */
function collide(pt: Particle, p: FieldParams, x0: number, y0: number): void {
  const { x, y } = pt;
  const crossAt = (xw: number) => y0 + ((y - y0) * (xw - x0)) / (x - x0);

  if (p.scenario === 'selector' || p.scenario === 'spectrometer') {
    const g = p.scenario === 'selector' ? SELECTOR : SPECTROMETER;
    const axis = g.source.y;
    if (x >= g.plateX0 && x <= g.plateX1 && (y >= g.plateTop || y <= g.plateBottom)) {
      pt.y = Math.max(g.plateBottom, Math.min(g.plateTop, y));
      pt.state = 'absorbed';
      return;
    }
    if (x0 < g.exitX && x >= g.exitX) {
      const yc = crossAt(g.exitX);
      if (Math.abs(yc - axis) > g.slitHalf) {
        pt.x = g.exitX;
        pt.y = yc;
        pt.state = 'absorbed';
        return;
      }
    }
  }

  if (p.scenario === 'selector' && x >= SELECTOR.detectorX) {
    pt.state = 'transmitted';
    return;
  }

  if (p.scenario === 'spectrometer') {
    const g = SPECTROMETER;
    if (x0 >= g.analyzerX && x < g.analyzerX) {
      const yc = crossAt(g.analyzerX);
      pt.x = g.analyzerX;
      pt.y = yc;
      if (yc >= g.detectorMinY && yc <= g.detectorMaxY) {
        pt.state = 'detected';
        pt.detectorD = g.source.y - yc;
      } else {
        pt.state = 'absorbed';
      }
      return;
    }
  }

  if (x < 0 || x > WORLD.w || y < 0 || y > WORLD.h) {
    pt.x = Math.max(0, Math.min(WORLD.w, x));
    pt.y = Math.max(0, Math.min(WORLD.h, y));
    pt.state = p.scenario === 'uniform' ? 'escaped' : 'absorbed';
  }
}

/**
 * Advances a particle by dt seconds using Boris substeps.
 * onMove (optional) is called after every substep, e.g. to record a trail.
 * fixedStep (optional) forces every substep to that exact size; the caller then passes a whole
 * multiple of it. A constant step keeps Boris exactly time-centred, so energy stays at round-off.
 */
export function advanceParticle(
  pt: Particle,
  p: FieldParams,
  dt: number,
  onMove?: (pt: Particle) => void,
  fixedStep?: number,
): void {
  if (pt.state !== 'flying' || dt <= 0) return;
  const n = fixedStep
    ? Math.max(1, Math.round(dt / fixedStep))
    : Math.max(1, Math.ceil(dt / maxSubstep(pt, p)));
  const step = fixedStep ?? dt / n;
  for (let i = 0; i < n && pt.state === 'flying'; i++) {
    const x0 = pt.x;
    const y0 = pt.y;
    borisStep(pt, fieldAt(p, x0, y0), step);
    collide(pt, p, x0, y0);
    onMove?.(pt);
  }
}

/** Constant Boris step for a uniform-field run, safe for the fastest speed the particle can reach. */
export function uniformStep(pt: Particle, p: FieldParams): number {
  const omega = (Math.abs(pt.q) * Math.abs(p.B)) / pt.m;
  const vd = Math.abs(driftVelocity(p.E, p.B));
  const vMax = Math.max(p.v0 + 2 * vd, 3e5);
  let dt = Math.min(5e-9, 1e-3 / vMax);
  if (omega > 0) dt = Math.min(dt, 0.05 / omega);
  return dt;
}

export function makeParticle(species: Species, speciesIndex: number): Particle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    q: species.charge * E_CHARGE,
    m: species.massU * AMU,
    speciesIndex,
    launchSpeed: 0,
    state: 'flying',
    lastDt: 0,
  };
}

/** E × B drift velocity along x for E = E ŷ and B = B ẑ (zero when B = 0). */
export function driftVelocity(E: number, B: number): number {
  return Math.abs(B) > 1e-15 ? E / B : 0;
}

/**
 * Launches a particle in the uniform-field chamber. With no E field the orbit is centred in the
 * chamber; otherwise the particle starts on the upstream side of the drift.
 * chargeSign = −1 launches the opposite-charge twin.
 */
export function launchUniform(p: FieldParams, chargeSign: 1 | -1 = 1): Particle {
  const species = speciesById(p.speciesId);
  const pt = makeParticle(species, 0);
  pt.q *= chargeSign;
  const vd = driftVelocity(p.E, p.B);
  const dir = vd < 0 ? -1 : 1;
  pt.vx = dir * p.v0;
  pt.launchSpeed = p.v0;
  if (p.E === 0 && p.B !== 0 && p.v0 > 0) {
    const r = (pt.m * p.v0) / (Math.abs(pt.q) * Math.abs(p.B));
    // The orbit centre lies along q v × B, i.e. sign(qB)·(v̂y, −v̂x) from the particle.
    const sgn = Math.sign(pt.q * p.B);
    pt.x = WORLD.w / 2;
    pt.y = WORLD.h / 2 + r * sgn * dir;
  } else {
    pt.x = dir > 0 ? 0.03 : WORLD.w - 0.03;
    pt.y = WORLD.h / 2;
  }
  return pt;
}

/** Fractional part of n·α — a low-discrepancy sequence so beams sample speeds evenly. */
function weyl(n: number, alpha: number): number {
  const v = n * alpha;
  return v - Math.floor(v);
}

/** The n-th particle of the selector or spectrometer beam. */
export function spawnBeamParticle(p: FieldParams, n: number): Particle {
  const spectro = p.scenario === 'spectrometer';
  const g = spectro ? SPECTROMETER : SELECTOR;
  let speciesIndex = 0;
  let species = speciesById(p.speciesId);
  if (spectro) {
    let u = weyl(n, 0.7548776662466927);
    speciesIndex = NEON_ISOTOPES.length - 1;
    for (let i = 0; i < NEON_ISOTOPES.length; i++) {
      u -= NEON_ISOTOPES[i].abundance ?? 0;
      if (u < 0) {
        speciesIndex = i;
        break;
      }
    }
    species = NEON_ISOTOPES[speciesIndex];
  }
  const pt = makeParticle(species, speciesIndex);
  const speed = g.speedMin + weyl(n, 0.6180339887498949) * (g.speedMax - g.speedMin);
  pt.x = g.source.x;
  pt.y = g.source.y;
  pt.vx = speed;
  pt.launchSpeed = speed;
  return pt;
}

export function larmorRadius(m: number, q: number, vPerp: number, B: number): number {
  return Math.abs(B) > 0 && q !== 0 ? (m * Math.abs(vPerp)) / (Math.abs(q) * Math.abs(B)) : Infinity;
}

export function cyclotronPeriod(m: number, q: number, B: number): number {
  return Math.abs(B) > 0 && q !== 0 ? (2 * Math.PI * m) / (Math.abs(q) * Math.abs(B)) : Infinity;
}

/**
 * Potential energy q φ in the uniform chamber, with φ = −E y. Boris velocities live at half
 * steps, so φ is evaluated at the matching half-step position to keep KE + qφ time-centred.
 */
export function potentialEnergy(pt: Particle, p: FieldParams): number {
  if (p.scenario !== 'uniform') return 0;
  const yHalf = pt.y - 0.5 * pt.vy * pt.lastDt;
  return -pt.q * p.E * yHalf;
}

export function kineticEnergy(pt: Particle): number {
  return 0.5 * pt.m * (pt.vx * pt.vx + pt.vy * pt.vy);
}

/** Speed that passes the crossed-field selector undeflected: v = E / B. */
export function selectedSpeed(p: FieldParams): number {
  return Math.abs(p.B) > 0 ? Math.abs(p.E / p.B) : Infinity;
}

/** Spectrometer calibration: mass (u) of a singly charged ion landing at distance D. */
export function massFromLanding(D: number, p: FieldParams): number {
  const v = selectedSpeed(p);
  return (E_CHARGE * Math.abs(p.B2) * D) / (2 * v) / AMU;
}

/** Predicted landing distance D = 2r for a singly charged ion of the given mass. */
export function landingDistance(massU: number, p: FieldParams): number {
  const v = selectedSpeed(p);
  return (2 * massU * AMU * v) / (E_CHARGE * Math.abs(p.B2));
}
