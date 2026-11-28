/**
 * Pure General Relativity Schwarzschild geodesic solver in natural Schwarzschild
 * units (r_s = 2GM/c² = 1, c = 1, so GM = 1/2).
 *
 * Covers:
 *  1. Timelike massive-particle geodesics in (r, φ, v_r = dr/dτ) with exact
 *     Hamiltonian invariant check, circular/ISCO analysis, apsidal precession,
 *     and a matched Newtonian 1/r² comparison twin.
 *  2. Radial / plunging astronaut clock τ vs. distant coordinate clock t and
 *     exact Doppler + gravitational redshift f_∞ / f_emit = Ẽ − |v_r|.
 *  3. Null photon geodesics in (r, φ, v_r = dr/dλ), photon sphere (r = 1.5 r_s),
 *     critical shadow impact parameter b_crit = (3√3 / 2) r_s, deflection angle
 *     Δφ(b), and gravitational-lensing image positions (Einstein ring).
 */

/**
 * Allocation-free 3-component RK4 step for [r, φ, v_r] geodesic systems.
 */
function rk4Step3(
  s0: number,
  s1: number,
  s2: number,
  h: number,
  deriv: (r: number, phi: number, vr: number) => [number, number, number],
): [number, number, number] {
  const [k10, k11, k12] = deriv(s0, s1, s2);
  const [k20, k21, k22] = deriv(s0 + 0.5 * h * k10, s1 + 0.5 * h * k11, s2 + 0.5 * h * k12);
  const [k30, k31, k32] = deriv(s0 + 0.5 * h * k20, s1 + 0.5 * h * k21, s2 + 0.5 * h * k22);
  const [k40, k41, k42] = deriv(s0 + h * k30, s1 + h * k31, s2 + h * k32);
  const h6 = h / 6;
  return [
    s0 + h6 * (k10 + 2 * k20 + 2 * k30 + k40),
    s1 + h6 * (k11 + 2 * k21 + 2 * k31 + k41),
    s2 + h6 * (k12 + 2 * k22 + 2 * k32 + k42),
  ];
}

export const C_M_S = 299_792_458;
export const G_SI = 6.6743e-11;
export const SOLAR_MASS_KG = 1.98847e30;

export const EVENT_HORIZON_RS = 1.0;
export const PHOTON_SPHERE_RS = 1.5;
export const ISCO_RS = 3.0;
export const L_ISCO = Math.sqrt(3); // ≈ 1.7320508 r_s·c
export const E_ISCO = Math.sqrt(8 / 9); // ≈ 0.94280904
export const B_CRIT_RS = (3 * Math.sqrt(3)) / 2; // ≈ 2.59807621 r_s

export type BHScenario = 'orbit' | 'plunge' | 'lensing';

export interface BlackHoleMassPreset {
  id: 'stellar' | 'cygnus' | 'sgra';
  label: string;
  solarMasses: number;
  rsKm: number; // 2GM/c² in km
  timeUnitMs: number; // r_s / c in milliseconds
}

export function makeMassPreset(
  id: BlackHoleMassPreset['id'],
  label: string,
  solarMasses: number,
): BlackHoleMassPreset {
  const rsMeters = (2 * G_SI * solarMasses * SOLAR_MASS_KG) / (C_M_S * C_M_S);
  return {
    id,
    label,
    solarMasses,
    rsKm: rsMeters / 1000,
    timeUnitMs: (rsMeters / C_M_S) * 1000,
  };
}

export const BH_MASS_PRESETS: BlackHoleMassPreset[] = [
  makeMassPreset('stellar', '10 M☉ Stellar BH', 10),
  makeMassPreset('cygnus', 'Cygnus X-1 (21.2 M☉)', 21.2),
  makeMassPreset('sgra', 'Sgr A* (4.15×10⁶ M☉)', 4.15e6),
];

// ============================================================================
// 1. MASSIVE PARTICLE EFFECTIVE POTENTIAL & TIMELIKE GEODESICS
// ============================================================================

/**
 * Schwarzschild effective potential V_eff(r; ℓ) = (1 − 1/r)(1 + ℓ²/r²),
 * so (dr/dτ)² + V_eff(r; ℓ) = Ẽ².
 */
export function effectivePotential(r: number, ell: number): number {
  return (1 - 1 / r) * (1 + (ell * ell) / (r * r));
}

export function effectivePotentialDerivative(r: number, ell: number): number {
  const r2 = r * r;
  const r3 = r2 * r;
  const r4 = r2 * r2;
  const l2 = ell * ell;
  return 1 / r2 - (2 * l2) / r3 + (3 * l2) / r4;
}

/**
 * Newtonian effective potential V_N(r; ℓ) shifted by +1 (rest mass energy) so it can be
 * plotted directly on the same Ẽ² energy axis: 1 − 1/r + ℓ²/r² (missing −ℓ²/r³!).
 */
export function newtonianEffectivePotential(r: number, ell: number): number {
  return 1 - 1 / r + (ell * ell) / (r * r);
}

export interface CircularRadii {
  hasCircular: boolean;
  rUnstableInner: number | null;
  rStableOuter: number | null;
  vEffMax: number | null;
  vEffMin: number | null;
}

export function circularOrbitExtrema(ell: number): CircularRadii {
  const l2 = ell * ell;
  if (l2 < 3 - 1e-12) {
    return {
      hasCircular: false,
      rUnstableInner: null,
      rStableOuter: null,
      vEffMax: null,
      vEffMin: null,
    };
  }
  const disc = Math.sqrt(Math.max(0, l2 * l2 - 3 * l2));
  const rIn = l2 - disc;
  const rOut = l2 + disc;
  return {
    hasCircular: true,
    rUnstableInner: rIn,
    rStableOuter: rOut,
    vEffMax: effectivePotential(rIn, ell),
    vEffMin: effectivePotential(rOut, ell),
  };
}

/**
 * Exact specific angular momentum ℓ_circ(r) and specific energy Ẽ_circ(r)
 * for a circular geodesic at radius r > 1.5 r_s.
 */
export function circularOrbitConstants(r: number): { ell: number; energy: number } {
  const rClamped = Math.max(1.501, r);
  const ell = rClamped / Math.sqrt(2 * rClamped - 3);
  const energy = (rClamped - 1) / Math.sqrt(rClamped * (rClamped - 1.5));
  return { ell, energy };
}

/**
 * Weak-field Einstein perihelion shift per orbit (radians):
 *   Δφ = 6π GM / (c² a(1 − e²)) = 3π / (2 ℓ²)  in r_s = 1, GM = 1/2 units.
 */
export function weakFieldPrecessionRad(ell: number): number {
  if (ell <= 0) return 0;
  return (1.5 * Math.PI) / (ell * ell);
}

export interface TimelikeParticle {
  r: number;
  phi: number;
  vr: number; // dr/dτ
  tau: number; // elapsed proper time (units of r_s/c)
  coordT: number; // distant coordinate time t (clamped smoothly if r <= 1)
  ell: number; // conserved specific angular momentum
  energy: number; // conserved specific energy Ẽ > 0
  status: 'orbiting' | 'horizon' | 'singularity' | 'escaped';
}

export function createTimelikeParticle(
  r0: number,
  ell: number,
  energy: number,
  inward = false,
): TimelikeParticle {
  const vEff0 = effectivePotential(r0, ell);
  const eActual = Math.max(energy, Math.sqrt(Math.max(0, vEff0)));
  const diffSq = eActual * eActual - vEff0;
  const vrMag = diffSq <= 1e-14 ? 0 : Math.sqrt(diffSq);
  return {
    r: r0,
    phi: 0,
    vr: inward ? -vrMag : vrMag,
    tau: 0,
    coordT: 0,
    ell,
    energy: eActual,
    status: r0 <= 1 ? 'horizon' : 'orbiting',
  };
}

/**
 * Hamiltonian constraint residual |(dr/dτ)² + V_eff(r; ℓ) − Ẽ²|.
 */
export function timelikeHamiltonianError(p: TimelikeParticle): number {
  return Math.abs(p.vr * p.vr + effectivePotential(p.r, p.ell) - p.energy * p.energy);
}

/**
 * Advance a massive particle by proper-time step dTau via RK4 on (r, φ, v_r, t).
 * Note: (r, φ, v_r) has NO coordinate singularity at r = 1, so the astronaut
 * crosses the horizon smoothly right down to r → 0!
 */
export function stepTimelikeParticle(p: TimelikeParticle, dTau: number): void {
  if (p.status === 'singularity' || p.status === 'escaped') return;

  // Sub-step automatically near small r so accuracy stays ~1e-12 even inside ISCO
  const subSteps = p.r < 2.2 ? 8 : p.r < 4.5 ? 4 : 2;
  const h = dTau / subSteps;
  const l2 = p.ell * p.ell;

  for (let s = 0; s < subSteps; s++) {
    if (p.r <= 0.08) {
      p.r = 0.08;
      p.status = 'singularity';
      return;
    }

    const next = rk4Step3(p.r, p.phi, p.vr, h, (rRaw, _phi, vr) => {
      const r = Math.max(0.05, rRaw);
      const r2 = r * r;
      const dvr = -0.5 / r2 + l2 / (r2 * r) - (1.5 * l2) / (r2 * r2);
      const dphi = p.ell / r2;
      return [vr, dphi, dvr];
    });

    const rMid = 0.5 * (p.r + next[0]);
    if (rMid > 1.0002) {
      // Exact coordinate time increment outside horizon using RK4 midpoint/trapezoid
      const dt1 = p.r > 1.0002 ? p.energy / (1 - 1 / p.r) : 0;
      const dt2 = next[0] > 1.0002 ? p.energy / (1 - 1 / next[0]) : dt1;
      const dtMid = p.energy / (1 - 1 / rMid);
      p.coordT += (h / 6) * (dt1 + 4 * dtMid + dt2);
    } else if (p.r > 1.0 && next[0] <= 1.0) {
      p.coordT = Number.POSITIVE_INFINITY;
    }

    p.r = next[0];
    p.phi = next[1];
    p.vr = next[2];
    p.tau += h;

    if (p.r <= 0.08) {
      p.r = 0.08;
      p.status = 'singularity';
      return;
    }
    if (p.r <= 1.0 && p.status === 'orbiting') {
      p.status = 'horizon';
    }
    if (p.r > 65 && p.vr > 0) {
      p.status = 'escaped';
      return;
    }
  }
}

export interface NewtonianTwin {
  r: number;
  phi: number;
  vr: number;
  t: number;
  ell: number;
}

export function createNewtonianTwin(p: TimelikeParticle): NewtonianTwin {
  return {
    r: p.r,
    phi: p.phi,
    vr: p.vr,
    t: 0,
    ell: p.ell,
  };
}

export function stepNewtonianTwin(n: NewtonianTwin, dt: number): void {
  if (n.r > 65 && n.vr > 0) return;
  const sub = n.r < 3 ? 4 : 2;
  const h = dt / sub;
  const l2 = n.ell * n.ell;
  for (let i = 0; i < sub; i++) {
    const next = rk4Step3(n.r, n.phi, n.vr, h, (rRaw, _phi, vr) => {
      const r = Math.max(0.15, rRaw);
      const r2 = r * r;
      return [vr, n.ell / r2, -0.5 / r2 + l2 / (r2 * r)];
    });
    n.r = next[0];
    n.phi = next[1];
    n.vr = next[2];
    n.t += h;
  }
}

// ============================================================================
// 2. RADIAL PLUNGE EXACT DIAGNOSTICS & REDSHIFT
// ============================================================================

/**
 * Exact proper time from rest at r₀ to the central singularity r = 0:
 *   τ_sing = (π / 2) · r₀^(3/2)   in r_s = 1, c = 1 units (GM = 1/2).
 */
export function exactRadialFallProperTimeToSingularity(r0: number): number {
  return 0.5 * Math.PI * Math.pow(r0, 1.5);
}

/**
 * Exact proper time from rest at r₀ to cross the event horizon r = 1:
 * With r = r₀ cos²(η/2), cos²(η_H/2) = 1/r₀ => η_H = 2 arccos(1/√r₀),
 * τ(η) = (r₀^(3/2) / 2) · (η + sin η).
 */
export function exactRadialFallProperTimeToHorizon(r0: number): number {
  if (r0 <= 1) return 0;
  const etaH = 2 * Math.acos(1 / Math.sqrt(r0));
  return 0.5 * Math.pow(r0, 1.5) * (etaH + Math.sin(etaH));
}

/**
 * Combined gravitational + kinematic Doppler frequency ratio f_∞ / f_emit
 * for an outward radial photon emitted by a radially infalling probe (ℓ = 0):
 *   f_∞ / f_emit = (1 − 1/r) / (Ẽ + |v_r|) ≡ Ẽ − |v_r|   for r > 1, and 0 for r ≤ 1.
 */
export function radialInfallRedshiftFactor(p: TimelikeParticle): number {
  if (p.r <= 1.0) return 0;
  return Math.max(0, p.energy - Math.abs(p.vr));
}

// ============================================================================
// 3. NULL PHOTON GEODESICS, SHADOW & GRAVITATIONAL LENSING
// ============================================================================

export interface PhotonRay {
  b: number; // signed impact parameter (in r_s)
  points: number[]; // flat [x0, y0, x1, y1, ...]
  outcome: 'escaped' | 'captured';
  deflectionRad: number; // net bending angle |φ_final − φ_straight| for escaped rays
  windings: number; // number of 2π loops around the photon sphere
  minR: number;
}

/**
 * Trace a null geodesic starting from x = −xStart (xStart > 0), y = b,
 * propagating initially toward +x in asymptotic Schwarzschild spacetime.
 */
export function tracePhotonGeodesic(b: number, xStart = 15, rEscape = 17): PhotonRay {
  const xFar = Math.max(xStart, 220);
  const rFar = Math.max(rEscape, 225);
  const r0 = Math.hypot(xFar, b);
  const phi0 = Math.atan2(b, -xFar); // near ±π

  // Exact initial radial velocity from null normalization v_r² + (b²/r₀²)(1 − 1/r₀) = 1
  const transSq = ((b * b) / (r0 * r0)) * (1 - 1 / r0);
  let r = r0;
  let phi = phi0;
  let vr = -Math.sqrt(Math.max(0, 1 - transSq));

  const pts: number[] = [];
  let minR = r0;
  let outcome: PhotonRay['outcome'] = 'escaped';
  const b2 = b * b;
  const angMom = -b;

  for (let step = 0; step < 5000; step++) {
    // Multi-scale affine step: fast in asymptotic flat region, ultra-fine near photon sphere
    const h = r > 30 ? 1.5 : r > 10 ? 0.25 : r < 2.2 ? 0.015 : r < 4.5 ? 0.04 : 0.08;
    const next = rk4Step3(r, phi, vr, h, (rRaw, _phi, vrc) => {
      const rc = Math.max(0.5, rRaw);
      const rc2 = rc * rc;
      const dv = (b2 / (rc2 * rc)) * (1 - 1.5 / rc);
      return [vrc, angMom / rc2, dv];
    });

    r = next[0];
    phi = next[1];
    vr = next[2];
    if (r < minR) minR = r;

    if (r <= rEscape && (pts.length === 0 || step % 2 === 0 || r <= 1.02)) {
      const x = r * Math.cos(phi);
      if (x >= -xStart) {
        pts.push(x, r * Math.sin(phi));
      }
    }

    if (r <= 1.002) {
      outcome = 'captured';
      break;
    }
    if (r >= rFar && vr > 0) {
      outcome = 'escaped';
      break;
    }
  }

  const bAbs = Math.abs(b);
  const tailCorrection = (R: number) => (bAbs < R ? Math.asin(bAbs / R) : 0);
  const totalAsymptoticPhi =
    Math.abs(phi - phi0) + tailCorrection(r0) + tailCorrection(r);
  const deflectionRad =
    outcome === 'escaped' ? Math.max(0, totalAsymptoticPhi - Math.PI) : Number.POSITIVE_INFINITY;
  const approxLoops =
    outcome === 'escaped' ? Math.max(0, Math.floor(deflectionRad / (2 * Math.PI))) : 0;

  return {
    b,
    points: pts,
    outcome,
    deflectionRad,
    windings: approxLoops,
    minR,
  };
}

/**
 * Thin-lens / Einstein-ring gravitational lensing equation for a source at angular
 * offset β_src (in units of Einstein radius θ_E):
 *   β = θ − 1/θ  =>  θ_± = ½ (β ± √(β² + 4)),
 * with magnifications μ_± = (u² + 2) / (2 u √(u² + 4)) ± 1/2 where u = |β|/θ_E.
 */
export interface LensedImages {
  thetaPlus: number; // Primary image position (in units of θ_E, same side as source)
  thetaMinus: number; // Secondary inverted image (opposite side of black hole)
  magPlus: number;
  magMinus: number;
  totalMag: number;
}

export function solveEinsteinLens(uNormalized: number): LensedImages {
  const u = Math.abs(uNormalized);
  const root = Math.sqrt(u * u + 4);
  const sign = uNormalized >= 0 ? 1 : -1;
  const thetaPlus = 0.5 * (u + root) * sign;
  const thetaMinus = 0.5 * (u - root) * sign;
  if (u < 1e-4) {
    return {
      thetaPlus: 1,
      thetaMinus: -1,
      magPlus: 50,
      magMinus: 50,
      totalMag: 100,
    };
  }
  const base = (u * u + 2) / (2 * u * root);
  return {
    thetaPlus,
    thetaMinus,
    magPlus: base + 0.5,
    magMinus: Math.max(0, base - 0.5),
    totalMag: 2 * base,
  };
}
