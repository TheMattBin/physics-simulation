/**
 * Pure analytical & numerical physics engine for Special Relativity:
 * Lorentz transformations, invariant spacetime intervals, Twin Paradox
 * (both instantaneous turnaround and exact Rindler hyperbolic proper acceleration),
 * Doppler light-pulse exchange, Barn-Pole (ladder) simultaneity paradox,
 * and cosmic-ray atmospheric muon survival in Earth vs. Muon frames.
 *
 * Zero React/DOM imports so this module runs standalone in Node for verification.
 */

export const C_M_PER_S = 299_792_458;
export const C_KM_PER_US = 0.299792458; // km / µs
export const MUON_LIFETIME_US = 2.1969811; // PDG mean rest lifetime τ₀ (µs)
export const MUON_DECAY_LEN_KM = C_KM_PER_US * MUON_LIFETIME_US; // c·τ₀ ≈ 0.65864 km
export const ONE_G_LY_PER_YR2 = (9.80665 * 31_557_600) / C_M_PER_S; // ≈ 1.032295 ly/yr²

export type SRScenario = 'twins' | 'barn-pole' | 'muon' | 'sandbox';
export type TurnaroundMode = 'instant' | 'smooth';
export type ReferenceFrame = 'primary' | 'boosted';

export interface SpacetimeEvent {
  x: number;
  ct: number;
}

export function clampBeta(beta: number, limit = 0.9995): number {
  if (!Number.isFinite(beta)) return 0;
  return Math.max(-limit, Math.min(limit, beta));
}

export function gammaFromBeta(beta: number): number {
  const b = clampBeta(beta, 0.99995);
  return 1 / Math.sqrt(1 - b * b);
}

export function rapidityFromBeta(beta: number): number {
  const b = clampBeta(beta, 0.99995);
  return Math.atanh(b);
}

/**
 * Forward Lorentz transformation from frame S to frame S' moving at +beta·c along +x.
 */
export function lorentzBoost(ev: SpacetimeEvent, beta: number): SpacetimeEvent {
  const b = clampBeta(beta, 0.99995);
  const g = gammaFromBeta(b);
  return {
    x: g * (ev.x - b * ev.ct),
    ct: g * (ev.ct - b * ev.x),
  };
}

/**
 * Inverse Lorentz transformation from S' (moving at +beta·c) back to S.
 */
export function inverseLorentzBoost(primed: SpacetimeEvent, beta: number): SpacetimeEvent {
  return lorentzBoost(primed, -beta);
}

/**
 * Invariant Minkowski interval squared (timelike > 0, lightlike = 0, spacelike < 0):
 *   Δs² = (Δct)² − (Δx)²
 */
export function invariantIntervalSq(a: SpacetimeEvent, b: SpacetimeEvent): number {
  const dct = b.ct - a.ct;
  const dx = b.x - a.x;
  return dct * dct - dx * dx;
}

export type IntervalKind = 'timelike' | 'lightlike' | 'spacelike';

export function classifyInterval(ds2: number, eps = 1e-6): IntervalKind {
  if (Math.abs(ds2) <= eps) return 'lightlike';
  return ds2 > 0 ? 'timelike' : 'spacelike';
}

/**
 * Relativistic velocity of object with velocity u in S as measured in S' moving at v (units of c).
 */
export function einsteinRelativeVelocity(u: number, v: number): number {
  const denom = 1 - u * v;
  if (Math.abs(denom) < 1e-12) return u >= v ? 1 : -1;
  return (u - v) / denom;
}

/**
 * Relativistic collinear velocity composition w = (u + v) / (1 + u·v) in units of c.
 */
export function einsteinVelocityAdd(u: number, v: number): number {
  const denom = 1 + u * v;
  if (Math.abs(denom) < 1e-12) return u + v >= 0 ? 1 : -1;
  return (u + v) / denom;
}

/**
 * Longitudinal relativistic Doppler factor f_obs / f_emit.
 * Positive betaApproach means source and observer are approaching each other (blueshift > 1);
 * negative betaApproach means receding (redshift < 1).
 */
export function dopplerFactor(betaApproach: number): number {
  const b = clampBeta(betaApproach, 0.99995);
  return Math.sqrt((1 + b) / (1 - b));
}

// ============================================================================
// 1. TWIN PARADOX (Instantaneous & Exact Rindler Hyperbolic Turnaround)
// ============================================================================

export interface TwinConfig {
  distanceLy: number; // Star distance L (ly)
  betaMax: number; // Cruise speed v/c in (0.05, 0.98)
  mode: TurnaroundMode;
  properAccelLyYr2: number; // Proper acceleration α in ly/yr² (used when mode === 'smooth')
  pulsePeriodYr: number; // Proper-time interval between emitted beacon flashes
}

export interface TwinTrajectoryProfile {
  config: TwinConfig;
  betaPeak: number;
  gammaPeak: number;
  tAcc: number;
  tauAcc: number;
  xAcc: number;
  tCruise: number;
  tauCruise: number;
  xCruise: number;
  tHalf: number;
  tauHalf: number;
  totalCoordTime: number;
  totalTwinProperTime: number;
  simultaneityGapYr: number; // 2·β·L for instant turnaround (swept smoothly in Rindler mode)
}

export interface TwinStateAtTime {
  t: number; // Earth coordinate time (yr) = Twin A proper time
  x: number; // Traveler position (ly)
  beta: number; // Traveler instantaneous coordinate velocity dx/dt
  gamma: number; // Instantaneous Lorentz factor
  tauB: number; // Traveler accumulated proper time (yr)
  earthSimultaneousTime: number; // Earth time simultaneous with Traveler right now: t − β·x
  leg: 'outbound' | 'turnaround' | 'inbound' | 'arrived';
}

export interface LightSignal {
  sender: 'A' | 'B';
  emitEvent: SpacetimeEvent;
  receiveEvent: SpacetimeEvent;
  emitProperTime: number;
}

export function buildTwinProfile(cfg: TwinConfig): TwinTrajectoryProfile {
  const L = Math.max(0.5, cfg.distanceLy);
  const betaMax = clampBeta(Math.max(0.05, cfg.betaMax), 0.99);
  const gammaMax = gammaFromBeta(betaMax);

  if (cfg.mode === 'instant') {
    const tHalf = L / betaMax;
    const tauHalf = tHalf / gammaMax;
    return {
      config: { ...cfg, distanceLy: L, betaMax },
      betaPeak: betaMax,
      gammaPeak: gammaMax,
      tAcc: 0,
      tauAcc: 0,
      xAcc: 0,
      tCruise: tHalf,
      tauCruise: tauHalf,
      xCruise: L,
      tHalf,
      tauHalf,
      totalCoordTime: 2 * tHalf,
      totalTwinProperTime: 2 * tauHalf,
      simultaneityGapYr: 2 * betaMax * L,
    };
  }

  // Exact 4-burn symmetric hyperbolic Rindler profile:
  // Outbound: +α accel (xAcc) -> cruise at +β_peak (xCruise) -> −α brake to rest at x = L (xAcc).
  const alpha = Math.max(0.15, cfg.properAccelLyYr2);
  const fullXAcc = (gammaMax - 1) / alpha;

  let gammaPeak: number;
  let betaPeak: number;
  let xAcc: number;
  let xCruise: number;

  if (2 * fullXAcc >= L) {
    // Distance capped before reaching betaMax: continuous bang-bang proper acceleration
    xAcc = 0.5 * L;
    xCruise = 0;
    gammaPeak = 1 + alpha * xAcc;
    betaPeak = Math.sqrt(Math.max(0, 1 - 1 / (gammaPeak * gammaPeak)));
  } else {
    gammaPeak = gammaMax;
    betaPeak = betaMax;
    xAcc = fullXAcc;
    xCruise = L - 2 * xAcc;
  }

  const tAcc = (betaPeak * gammaPeak) / alpha;
  const tauAcc = Math.atanh(betaPeak) / alpha;
  const tCruise = betaPeak > 0 ? xCruise / betaPeak : 0;
  const tauCruise = tCruise / gammaPeak;
  const tHalf = 2 * tAcc + tCruise;
  const tauHalf = 2 * tauAcc + tauCruise;

  return {
    config: { ...cfg, distanceLy: L, betaMax, properAccelLyYr2: alpha },
    betaPeak,
    gammaPeak,
    tAcc,
    tauAcc,
    xAcc,
    tCruise,
    tauCruise,
    xCruise,
    tHalf,
    tauHalf,
    totalCoordTime: 2 * tHalf,
    totalTwinProperTime: 2 * tauHalf,
    simultaneityGapYr: 2 * betaPeak * L,
  };
}

function evalOutboundHalf(prof: TwinTrajectoryProfile, u: number): { x: number; beta: number; tau: number } {
  const L = prof.config.distanceLy;
  if (prof.config.mode === 'instant') {
    const clampedU = Math.max(0, Math.min(prof.tHalf, u));
    return {
      x: prof.betaPeak * clampedU,
      beta: prof.betaPeak,
      tau: clampedU / prof.gammaPeak,
    };
  }

  const alpha = prof.config.properAccelLyYr2;
  if (u <= 0) return { x: 0, beta: 0, tau: 0 };
  if (u <= prof.tAcc) {
    const au = alpha * u;
    const hyp = Math.hypot(1, au);
    return {
      x: (hyp - 1) / alpha,
      beta: au / hyp,
      tau: Math.asinh(au) / alpha,
    };
  }
  if (u <= prof.tAcc + prof.tCruise) {
    const dt = u - prof.tAcc;
    return {
      x: prof.xAcc + prof.betaPeak * dt,
      beta: prof.betaPeak,
      tau: prof.tauAcc + dt / prof.gammaPeak,
    };
  }
  const w = Math.max(0, prof.tHalf - u);
  const aw = alpha * w;
  const hyp = Math.hypot(1, aw);
  return {
    x: L - (hyp - 1) / alpha,
    beta: aw / hyp,
    tau: prof.tauHalf - Math.asinh(aw) / alpha,
  };
}

export function sampleTwinTrajectory(prof: TwinTrajectoryProfile, tRaw: number): TwinStateAtTime {
  const T = prof.totalCoordTime;
  if (tRaw >= T) {
    return {
      t: T,
      x: 0,
      beta: 0,
      gamma: 1,
      tauB: prof.totalTwinProperTime,
      earthSimultaneousTime: T,
      leg: 'arrived',
    };
  }
  const t = Math.max(0, tRaw);

  let x: number;
  let beta: number;
  let tauB: number;
  let leg: TwinStateAtTime['leg'];

  if (t <= prof.tHalf) {
    const out = evalOutboundHalf(prof, t);
    x = out.x;
    beta = out.beta;
    tauB = out.tau;
    if (prof.config.mode === 'smooth' && t > prof.tAcc + prof.tCruise) {
      leg = 'turnaround';
    } else {
      leg = 'outbound';
    }
  } else {
    const u = T - t;
    const out = evalOutboundHalf(prof, u);
    x = out.x;
    beta = -out.beta;
    tauB = prof.totalTwinProperTime - out.tau;
    if (prof.config.mode === 'smooth' && u > prof.tAcc + prof.tCruise) {
      leg = 'turnaround';
    } else {
      leg = 'inbound';
    }
  }

  return {
    t,
    x,
    beta,
    gamma: gammaFromBeta(beta),
    tauB,
    earthSimultaneousTime: t - beta * x,
    leg,
  };
}

/**
 * Invert τ_B(t) = targetTau via monotonic bisection (dτ_B/dt = 1/γ > 0 everywhere).
 */
export function coordTimeAtTwinProperTime(prof: TwinTrajectoryProfile, targetTau: number): number {
  if (targetTau <= 0) return 0;
  if (targetTau >= prof.totalTwinProperTime) return prof.totalCoordTime;
  if (prof.config.mode === 'instant') {
    return targetTau * prof.gammaPeak;
  }
  let lo = 0;
  let hi = prof.totalCoordTime;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (sampleTwinTrajectory(prof, mid).tauB < targetTau) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Compute all periodic beacon light signals exchanged between Earth (Twin A, x = 0)
 * and Traveler (Twin B, x = x_B(t)) at intervals of pulsePeriodYr of the sender's proper time.
 */
export function computeTwinLightSignals(prof: TwinTrajectoryProfile): LightSignal[] {
  const step = Math.max(0.25, prof.config.pulsePeriodYr);
  const signals: LightSignal[] = [];

  // 1. Signals from Twin A (x = 0, τ_A = t_emit) -> Twin B:
  // Photon follows x_γ(t) = t − t_emit; intersects x_B(t) where f(t) = (t − t_emit) − x_B(t) = 0.
  // Since df/dt = 1 − β_B(t) > 0 strictly, the intersection is unique and exact!
  for (let tEmit = step; tEmit < prof.totalCoordTime - 1e-6; tEmit += step) {
    let tHit: number;
    if (prof.config.mode === 'instant') {
      // Outbound intersection if tEmit <= tHalf*(1 - beta): t - tEmit = beta*t => t = tEmit / (1 - beta)
      const tCand = tEmit / (1 - prof.betaPeak);
      if (tCand <= prof.tHalf) {
        tHit = tCand;
      } else {
        // Inbound: t - tEmit = L - beta*(t - tHalf) => t*(1 + beta) = tEmit + L + beta*tHalf = tEmit + 2*L
        tHit = (tEmit + 2 * prof.config.distanceLy) / (1 + prof.betaPeak);
      }
    } else {
      let lo = tEmit;
      let hi = prof.totalCoordTime;
      for (let i = 0; i < 48; i++) {
        const mid = 0.5 * (lo + hi);
        const diff = mid - tEmit - sampleTwinTrajectory(prof, mid).x;
        if (diff < 0) lo = mid;
        else hi = mid;
      }
      tHit = 0.5 * (lo + hi);
    }
    const xHit = tHit - tEmit;
    signals.push({
      sender: 'A',
      emitEvent: { x: 0, ct: tEmit },
      receiveEvent: { x: xHit, ct: tHit },
      emitProperTime: tEmit,
    });
  }

  // 2. Signals from Twin B (at proper times τ_B = k·step) -> Twin A (x = 0):
  // Left-going photon from (x_B(t_emit), t_emit) hits x = 0 at t_hit = t_emit + x_B(t_emit).
  for (let tauEmit = step; tauEmit < prof.totalTwinProperTime - 1e-6; tauEmit += step) {
    const tEmit = coordTimeAtTwinProperTime(prof, tauEmit);
    const st = sampleTwinTrajectory(prof, tEmit);
    const tHit = tEmit + st.x;
    signals.push({
      sender: 'B',
      emitEvent: { x: st.x, ct: tEmit },
      receiveEvent: { x: 0, ct: tHit },
      emitProperTime: tauEmit,
    });
  }

  return signals;
}

// ============================================================================
// 2. BARN & POLE (LADDER) SIMULTANEITY PARADOX
// ============================================================================

export interface BarnPoleConfig {
  barnRestLengthM: number; // L_barn in Barn frame S (m), centered at x = 0
  poleRestLengthM: number; // L_pole,0 in Pole rest frame S' (m), centered at x' = 0
  beta: number; // Pole speed in +x relative to Barn (v/c > 0)
  activeFrame: ReferenceFrame; // 'primary' = Barn Frame S, 'boosted' = Pole Frame S'
}

export interface BarnPoleSolution {
  gamma: number;
  betaFitThreshold: number; // Minimum β required for contracted pole to fit in barn
  fitsWithoutCollision: boolean;
  // Lengths in Barn Frame S:
  barnLenInS: number;
  poleLenInS: number;
  // Lengths in Pole Frame S':
  barnLenInSPrime: number;
  poleLenInSPrime: number;
  // Door flash events (simultaneous at ct = 0 in Barn Frame S):
  leftDoorEventS: SpacetimeEvent;
  rightDoorEventS: SpacetimeEvent;
  leftDoorEventSPrime: SpacetimeEvent;
  rightDoorEventSPrime: SpacetimeEvent;
  doorTimeGapSPrimeM: number; // c·(t'_L − t'_R) = γ·β·L_barn > 0 (exit door flashes FIRST in S'!)
}

export interface BarnPoleSnapshot {
  coordTimeM: number; // ct in Barn Frame S, or ct' in Pole Frame S'
  barnLeft: number;
  barnRight: number;
  poleLeft: number;
  poleRight: number;
  leftDoorClosed: boolean;
  rightDoorClosed: boolean;
}

export function solveBarnPole(cfg: BarnPoleConfig): BarnPoleSolution {
  const Lb = Math.max(2, cfg.barnRestLengthM);
  const Lp = Math.max(2, cfg.poleRestLengthM);
  const b = clampBeta(Math.max(0.05, cfg.beta), 0.99);
  const g = gammaFromBeta(b);

  const poleLenInS = Lp / g;
  const barnLenInSPrime = Lb / g;
  const fits = poleLenInS <= Lb + 1e-9;
  const betaFitThreshold = Lp <= Lb ? 0 : Math.sqrt(1 - (Lb * Lb) / (Lp * Lp));

  const leftDoorEventS: SpacetimeEvent = { x: -0.5 * Lb, ct: 0 };
  const rightDoorEventS: SpacetimeEvent = { x: +0.5 * Lb, ct: 0 };
  const leftDoorEventSPrime = lorentzBoost(leftDoorEventS, b);
  const rightDoorEventSPrime = lorentzBoost(rightDoorEventS, b);

  return {
    gamma: g,
    betaFitThreshold,
    fitsWithoutCollision: fits,
    barnLenInS: Lb,
    poleLenInS,
    barnLenInSPrime,
    poleLenInSPrime: Lp,
    leftDoorEventS,
    rightDoorEventS,
    leftDoorEventSPrime,
    rightDoorEventSPrime,
    doorTimeGapSPrimeM: leftDoorEventSPrime.ct - rightDoorEventSPrime.ct,
  };
}

/**
 * Positions of the barn and pole at coordinate time `ct` of whichever frame is active,
 * using the exact worldlines passing through (x=0, ct=0) = (x'=0, ct'=0).
 */
export function sampleBarnPoleAt(
  cfg: BarnPoleConfig,
  sol: BarnPoleSolution,
  ctActive: number,
  doorFlashHalfWidthM = 0.55,
): BarnPoleSnapshot {
  const b = clampBeta(Math.max(0.05, cfg.beta), 0.99);
  if (cfg.activeFrame === 'primary') {
    // Barn Frame S: barn is stationary at [-Lb/2, +Lb/2]; pole center is at x = β·ct
    const poleCenter = b * ctActive;
    const halfPole = 0.5 * sol.poleLenInS;
    const halfBarn = 0.5 * sol.barnLenInS;
    const flash = Math.abs(ctActive) <= doorFlashHalfWidthM;
    return {
      coordTimeM: ctActive,
      barnLeft: -halfBarn,
      barnRight: +halfBarn,
      poleLeft: poleCenter - halfPole,
      poleRight: poleCenter + halfPole,
      leftDoorClosed: flash,
      rightDoorClosed: flash,
    };
  }

  // Pole Rest Frame S': pole is stationary at [-Lp/2, +Lp/2]; barn moves left at −β·c!
  // Check exact worldline of left/right barn doors x = x_door in S:
  // Since x = γ(x' + β·ct') = x_door => x'(ct') = x_door / γ − β·ct'!
  const barnCenter = -b * ctActive;
  const halfBarnPrime = 0.5 * sol.barnLenInSPrime;
  const halfPolePrime = 0.5 * sol.poleLenInSPrime;
  return {
    coordTimeM: ctActive,
    barnLeft: barnCenter - halfBarnPrime,
    barnRight: barnCenter + halfBarnPrime,
    poleLeft: -halfPolePrime,
    poleRight: +halfPolePrime,
    leftDoorClosed: Math.abs(ctActive - sol.leftDoorEventSPrime.ct) <= doorFlashHalfWidthM,
    rightDoorClosed: Math.abs(ctActive - sol.rightDoorEventSPrime.ct) <= doorFlashHalfWidthM,
  };
}

// ============================================================================
// 3. ATMOSPHERIC COSMIC-RAY MUONS (Time Dilation vs. Length Contraction)
// ============================================================================

export interface MuonConfig {
  altitudeKm: number; // Creation height H (km), e.g. 15 km
  beta: number; // Speed v/c in [0.85, 0.9995]
  activeFrame: ReferenceFrame; // 'primary' = Earth Frame, 'boosted' = Muon Rest Frame
}

export interface MuonTheory {
  gamma: number;
  speedKmPerUs: number;
  earthTransitUs: number; // H / (β·c)
  muonProperTransitUs: number; // H / (γ·β·c)
  contractedAtmosphereKm: number; // H / γ
  meanDecayLengthSRKm: number; // γ·β·c·τ₀
  meanDecayLengthNewtonKm: number; // β·c·τ₀
  survivalSR: number; // exp(−H / (γ·β·c·τ₀))
  survivalNewton: number; // exp(−H / (β·c·τ₀))
}

export function computeMuonTheory(cfg: MuonConfig): MuonTheory {
  const H = Math.max(1, cfg.altitudeKm);
  const b = clampBeta(Math.max(0.5, cfg.beta), 0.9998);
  const g = gammaFromBeta(b);
  const v = b * C_KM_PER_US;
  const earthTransitUs = H / v;
  const muonProperTransitUs = earthTransitUs / g;
  const meanDecayLengthNewtonKm = v * MUON_LIFETIME_US;
  const meanDecayLengthSRKm = g * meanDecayLengthNewtonKm;

  return {
    gamma: g,
    speedKmPerUs: v,
    earthTransitUs,
    muonProperTransitUs,
    contractedAtmosphereKm: H / g,
    meanDecayLengthSRKm,
    meanDecayLengthNewtonKm,
    survivalSR: Math.exp(-muonProperTransitUs / MUON_LIFETIME_US),
    survivalNewton: Math.exp(-earthTransitUs / MUON_LIFETIME_US),
  };
}

/**
 * Survival fraction at altitude z ∈ [0, H] km (where z = H is creation, z = 0 is sea level).
 */
export function muonSurvivalAtAltitude(
  cfg: MuonConfig,
  zKm: number,
  relativistic: boolean,
): number {
  const th = computeMuonTheory(cfg);
  const distKm = Math.max(0, cfg.altitudeKm - zKm);
  const decayLen = relativistic ? th.meanDecayLengthSRKm : th.meanDecayLengthNewtonKm;
  return Math.exp(-distKm / decayLen);
}
