/**
 * Newton's laws on a one-dimensional constrained track.
 *
 * Two scenarios share one equation of motion:
 *  - 'incline': block m1 on a ramp of angle θ with Coulomb friction, optionally tied by a rope
 *    over a pulley at the top of the ramp to a hanging mass m2.
 *  - 'atwood':  two hanging masses over a pulley (equivalent to θ = 90° with no surface contact).
 *
 * Generalized coordinate s (metres), positive toward the pulley:
 *  - incline: distance of m1's centre from the ramp's bottom end (m2 descends as s grows);
 *  - atwood:  rise of m1 from its start height (m2 descends by the same amount).
 *
 * Between discrete events every force is constant, so the motion is integrated with exact
 * constant-acceleration kinematics. Events — the velocity passing through zero (which triggers the
 * static-friction stick/slip test) and the ends of the track — are located analytically, so the
 * solver has no truncation error. This module has no imports so it runs standalone in Node.
 */

export type Scenario = 'incline' | 'atwood';

export interface NewtonParams {
  scenario: Scenario;
  ropeAttached: boolean; // incline only; the Atwood machine always has its rope
  m1: number; // kg — block on the ramp (Atwood: left mass)
  m2: number; // kg — hanging mass (Atwood: right mass)
  thetaDeg: number; // ramp angle, incline only
  muS: number; // static friction coefficient
  muK: number; // kinetic friction coefficient (clamped to ≤ muS)
  appliedForce: number; // N on m1 along +s (up-slope push when positive)
  gravity: number; // m/s²
}

export interface NewtonState {
  t: number;
  s: number;
  v: number; // ds/dt
}

export type ContactRegime = 'static' | 'kinetic' | 'frictionless' | 'end-stop';

/** Every force acting, with along-track components signed along +s. */
export interface ForceBreakdown {
  thetaRad: number; // effective track angle (π/2 for Atwood)
  hasRope: boolean;
  totalMass: number;
  weight1: number; // m1 g
  weight2: number; // m2 g (0 without rope)
  weightParallel: number; // −m1 g sin θ
  weightPerp: number; // m1 g cos θ, pressing m1 into the surface
  normal: number; // N
  friction: number; // signed along +s
  staticMax: number; // μs N
  kineticMag: number; // μk N
  tension: number; // T (0 without rope)
  applied: number; // signed along +s
  stopReaction: number; // push from an end stop, signed along +s
  drivingForce: number; // net force on the whole system excluding friction and end stops
  net1: number; // ΣF on m1 along +s (= m1 a)
  net2: number; // ΣF on m2, positive downward (= m2 a)
  acceleration: number; // d²s/dt²
  regime: ContactRegime;
  gripUsed: number | null; // |driving| / μs N while static friction holds
}

/** Track geometry in metres. The ends of the track are physical stops, so they live here. */
export const TRACK = {
  rampLength: 7,
  rampTop: { x: 8.0, y: 6.2 },
  pulley: { x: 8.32, y: 6.5, r: 0.26 },
  startS: 3.5,
  endClearance: 0.55,
  hangStartDepth: 3.0, // hanging depth of m2 below the pulley axle at s = startS
  hangMinDepth: 0.8,
  floorClearance: 0.5,
  atwoodPulley: { x: 4.6, y: 6.6, r: 0.55 },
  atwoodStartDepth: 3.0,
  atwoodMinDepth: 1.15,
} as const;

export const NUDGE_SPEED = 1.5; // m/s added by one nudge

const EPS_S = 1e-9;
const EPS_T = 1e-12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function trackLimits(p: NewtonParams): { min: number; max: number } {
  if (p.scenario === 'atwood') {
    const d0 = TRACK.atwoodStartDepth;
    const dMin = TRACK.atwoodMinDepth;
    const dMax = TRACK.atwoodPulley.y - TRACK.floorClearance;
    // m1 hangs at depth d0 − s and m2 at d0 + s; both must stay within [dMin, dMax].
    return { min: Math.max(dMin - d0, d0 - dMax), max: Math.min(d0 - dMin, dMax - d0) };
  }
  let min: number = TRACK.endClearance;
  let max = TRACK.rampLength - TRACK.endClearance;
  if (p.ropeAttached) {
    const sAtDepth = (d: number) => TRACK.startS + d - TRACK.hangStartDepth;
    min = Math.max(min, sAtDepth(TRACK.hangMinDepth));
    max = Math.min(max, sAtDepth(TRACK.pulley.y - TRACK.floorClearance));
  }
  return { min, max };
}

/** Depths of the hanging masses below their pulley axle (m2 only for the incline). */
export function hangingDepths(p: NewtonParams, s: number): { d1: number; d2: number } {
  if (p.scenario === 'atwood') {
    return { d1: TRACK.atwoodStartDepth - s, d2: TRACK.atwoodStartDepth + s };
  }
  return { d1: 0, d2: TRACK.hangStartDepth + (s - TRACK.startS) };
}

export function initialState(p: NewtonParams): NewtonState {
  return { t: 0, s: p.scenario === 'atwood' ? 0 : TRACK.startS, v: 0 };
}

export function computeForces(state: NewtonState, p: NewtonParams): ForceBreakdown {
  const atwood = p.scenario === 'atwood';
  const hasRope = atwood || p.ropeAttached;
  const thetaRad = atwood ? Math.PI / 2 : (clamp(p.thetaDeg, 0, 90) * Math.PI) / 180;
  const sin = Math.sin(thetaRad);
  const cos = atwood ? 0 : Math.cos(thetaRad);
  const g = Math.max(0, p.gravity);
  const m1 = Math.max(1e-3, p.m1);
  const m2 = hasRope ? Math.max(1e-3, p.m2) : 0;
  const totalMass = m1 + m2;
  const muS = atwood ? 0 : Math.max(0, p.muS);
  const muK = atwood ? 0 : clamp(p.muK, 0, muS);

  const weight1 = m1 * g;
  const weight2 = m2 * g;
  const weightParallel = -weight1 * sin;
  const weightPerp = weight1 * cos;
  const normal = weightPerp; // the push is parallel to the track, so it does not change N
  const applied = p.appliedForce;
  const drivingForce = applied + weight2 + weightParallel;
  const staticMax = muS * normal;
  const kineticMag = muK * normal;

  const { min, max } = trackLimits(p);
  const atMin = state.s <= min + EPS_S;
  const atMax = state.s >= max - EPS_S;

  let friction: number;
  let stopReaction = 0;
  let acceleration: number;
  let regime: ContactRegime;
  let gripUsed: number | null = null;

  if (state.v !== 0) {
    // Sliding: kinetic friction opposes the velocity.
    friction = -Math.sign(state.v) * kineticMag;
    acceleration = (drivingForce + friction) / totalMass;
    regime = kineticMag > 0 ? 'kinetic' : 'frictionless';
  } else if (Math.abs(drivingForce) <= staticMax) {
    // At rest and static friction can supply whatever is needed (up to μs N) to keep it there.
    friction = -drivingForce;
    acceleration = 0;
    regime = staticMax > 0 ? 'static' : 'frictionless';
    gripUsed = staticMax > 0 ? Math.abs(drivingForce) / staticMax : null;
  } else {
    const dir = Math.sign(drivingForce);
    if ((atMin && dir < 0) || (atMax && dir > 0)) {
      // Pressed into an end stop: static friction does what it can, the stop supplies the rest.
      friction = -dir * staticMax;
      stopReaction = -(drivingForce + friction);
      acceleration = 0;
      regime = 'end-stop';
    } else {
      // Breakaway: static friction is exceeded and kinetic friction takes over.
      friction = -dir * kineticMag;
      acceleration = (drivingForce + friction) / totalMass;
      regime = kineticMag > 0 ? 'kinetic' : 'frictionless';
    }
  }

  // m2 accelerates downward at the same rate m1 moves toward the pulley: m2 a = m2 g − T.
  const tension = hasRope ? m2 * (g - acceleration) : 0;
  const net1 = applied + tension + weightParallel + friction + stopReaction;
  const net2 = weight2 - tension;

  return {
    thetaRad,
    hasRope,
    totalMass,
    weight1,
    weight2,
    weightParallel,
    weightPerp,
    normal,
    friction,
    staticMax,
    kineticMag,
    tension,
    applied,
    stopReaction,
    drivingForce,
    net1,
    net2,
    acceleration,
    regime,
    gripUsed,
  };
}

/** Smallest strictly positive time for s + v t + ½ a t² to reach target, or Infinity. */
function timeToReach(s: number, v: number, a: number, target: number): number {
  const d = target - s;
  if (Math.abs(a) < 1e-14) {
    if (v === 0) return Infinity;
    const h = d / v;
    return h > EPS_T ? h : Infinity;
  }
  const disc = v * v + 2 * a * d;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  let best = Infinity;
  for (const h of [(-v - root) / a, (-v + root) / a]) {
    if (h > EPS_T && h < best) best = h;
  }
  return best;
}

/**
 * Advances the system by dt using exact piecewise-constant-acceleration kinematics.
 * End stops are perfectly inelastic (the block stops dead against them).
 */
export function stepNewton(state: NewtonState, p: NewtonParams, dt: number): NewtonState {
  const { min, max } = trackLimits(p);
  let { t, s, v } = state;

  // A structural change (e.g. attaching the rope) can shrink the track under the block.
  if (s < min) {
    s = min;
    if (v < 0) v = 0;
  }
  if (s > max) {
    s = max;
    if (v > 0) v = 0;
  }

  let remaining = Math.max(0, dt);
  for (let iter = 0; iter < 8 && remaining > EPS_T; iter++) {
    if ((s <= min + EPS_S && v < 0) || (s >= max - EPS_S && v > 0)) v = 0;

    const a = computeForces({ t, s, v }, p).acceleration;
    if (v === 0 && a === 0) break;

    let h = remaining;
    let event: 'none' | 'reverse' | 'min' | 'max' = 'none';
    if (v !== 0 && a !== 0 && Math.sign(a) !== Math.sign(v)) {
      const tStop = -v / a;
      if (tStop <= h) {
        h = tStop;
        event = 'reverse';
      }
    }
    const tMin = timeToReach(s, v, a, min);
    if (tMin < h) {
      h = tMin;
      event = 'min';
    }
    const tMax = timeToReach(s, v, a, max);
    if (tMax < h) {
      h = tMax;
      event = 'max';
    }

    s += v * h + 0.5 * a * h * h;
    v += a * h;
    t += h;
    remaining -= h;

    if (event === 'reverse') {
      v = 0; // momentarily at rest: the next pass re-runs the static-friction test
    } else if (event === 'min') {
      s = min;
      v = 0;
    } else if (event === 'max') {
      s = max;
      v = 0;
    }
  }

  return { t: t + Math.max(0, remaining), s, v };
}
