/**
 * Electron double-slit: wave–particle duality.
 *
 * A plane electron wave (de Broglie wavelength λ) passes two slits of width a, centres ±d/2,
 * and is detected on a screen at distance L. The field at the screen from each slit is the
 * exact paraxial (Fresnel) diffraction integral of a top-hat aperture,
 *   ψ_j(X) = (1/√(2i)) [F(u₂) − F(u₁)],   u = √(2/λL)·(x′ − X),   F = C + iS,
 * valid from the near field (geometric slit images) to the far field (Fraunhofer fringes).
 *
 * A which-path detector of distinguishability D reduces the interference term to visibility
 * V = √(1 − D²) (Englert's duality relation V² + D² ≤ 1). Each electron lands at a position
 * drawn from the resulting |ψ|².
 *
 * Units: positions in nm, energies in eV. This module has no imports so it runs in Node.
 */

export const HC_EV_NM = 1239.841984; // eV·nm
export const ELECTRON_MC2 = 510998.95; // eV

export type SlitMode = 'both' | 'left' | 'right';

export interface SlitParams {
  energy: number; // electron kinetic energy (eV)
  width: number; // slit width a (nm)
  separation: number; // centre-to-centre slit separation d (nm)
  distance: number; // slit-to-screen distance L (nm)
  mode: SlitMode;
  which: number; // which-path distinguishability D in [0, 1]
}

/** Relativistic de Broglie wavelength λ = hc / pc, with (pc)² = E² + 2E·mc². Returns nm. */
export function electronWavelength(energyEv: number): number {
  return HC_EV_NM / Math.sqrt(energyEv * energyEv + 2 * energyEv * ELECTRON_MC2);
}

/** Fresnel integrals C(x), S(x) with the π/2 convention (Numerical Recipes "frenel", ~1e-7). */
export function fresnel(x: number): [number, number] {
  const EPS = 6e-8;
  const MAXIT = 200;
  const FPMIN = 1e-30;
  const ax = Math.abs(x);
  let c: number;
  let s: number;
  if (ax < Math.sqrt(FPMIN)) {
    s = 0;
    c = ax;
  } else if (ax <= 1.5) {
    let sum = 0;
    let sums = 0;
    let sumc = ax;
    let sign = 1;
    const fact = (Math.PI / 2) * ax * ax;
    let odd = true;
    let term = ax;
    let n = 3;
    for (let k = 1; k <= MAXIT; k++) {
      term *= fact / k;
      sum += (sign * term) / n;
      const test = Math.abs(sum) * EPS;
      if (odd) {
        sign = -sign;
        sums = sum;
        sum = sumc;
      } else {
        sumc = sum;
        sum = sums;
      }
      if (term < test) break;
      odd = !odd;
      n += 2;
    }
    s = sums;
    c = sumc;
  } else {
    // Continued fraction for the complementary error function (modified Lentz).
    const pix2 = Math.PI * ax * ax;
    let bRe = 1;
    let bIm = -pix2;
    let ccRe = 1 / FPMIN;
    let ccIm = 0;
    let den = bRe * bRe + bIm * bIm;
    let dRe = bRe / den;
    let dIm = -bIm / den;
    let hRe = dRe;
    let hIm = dIm;
    let n = -1;
    for (let k = 2; k <= MAXIT; k++) {
      n += 2;
      const a = -n * (n + 1);
      bRe += 4;
      // d = 1 / (a·d + b)
      let tRe = a * dRe + bRe;
      let tIm = a * dIm + bIm;
      den = tRe * tRe + tIm * tIm;
      dRe = tRe / den;
      dIm = -tIm / den;
      // cc = b + a / cc
      den = ccRe * ccRe + ccIm * ccIm;
      ccRe = bRe + (a * ccRe) / den;
      ccIm = bIm - (a * ccIm) / den;
      // del = cc·d ; h = h·del
      const delRe = ccRe * dRe - ccIm * dIm;
      const delIm = ccRe * dIm + ccIm * dRe;
      tRe = hRe * delRe - hIm * delIm;
      tIm = hRe * delIm + hIm * delRe;
      hRe = tRe;
      hIm = tIm;
      if (Math.abs(delRe - 1) + Math.abs(delIm) < EPS) break;
    }
    // h = (ax − i·ax)·h
    const h2Re = ax * hRe + ax * hIm;
    const h2Im = ax * hIm - ax * hRe;
    // cs = (0.5 + 0.5i)·(1 − e^{i·pix2/2}·h)
    const eRe = Math.cos(0.5 * pix2);
    const eIm = Math.sin(0.5 * pix2);
    const pRe = 1 - (eRe * h2Re - eIm * h2Im);
    const pIm = -(eRe * h2Im + eIm * h2Re);
    c = 0.5 * pRe - 0.5 * pIm;
    s = 0.5 * pIm + 0.5 * pRe;
  }
  return x < 0 ? [-c, -s] : [c, s];
}

export interface Complex {
  re: number;
  im: number;
}

/** Fresnel field at screen position X from a uniformly lit aperture [x1, x2] (unit amplitude). */
export function apertureField(X: number, x1: number, x2: number, lambda: number, L: number): Complex {
  const k = Math.sqrt(2 / (lambda * L));
  const [c1, s1] = fresnel(k * (x1 - X));
  const [c2, s2] = fresnel(k * (x2 - X));
  const dc = c2 - c1;
  const ds = s2 - s1;
  // 1/√(2i) = (1 − i)/2
  return { re: 0.5 * (dc + ds), im: 0.5 * (ds - dc) };
}

export function slitEdges(p: SlitParams): { left: [number, number]; right: [number, number] } {
  const h = p.width / 2;
  const c = p.separation / 2;
  return { left: [-c - h, -c + h], right: [c - h, c + h] };
}

/** Fringe visibility left by a which-path detector of distinguishability D. */
export function visibility(D: number): number {
  return Math.sqrt(Math.max(0, 1 - D * D));
}

export interface ScreenPoint {
  psiL: Complex;
  psiR: Complex;
  intensity: number; // detection probability density (relative)
  noInterference: number; // |ψ_L|² + |ψ_R|² for the open slits
}

export function screenPoint(p: SlitParams, X: number, lambda = electronWavelength(p.energy)): ScreenPoint {
  const e = slitEdges(p);
  const psiL = apertureField(X, e.left[0], e.left[1], lambda, p.distance);
  const psiR = apertureField(X, e.right[0], e.right[1], lambda, p.distance);
  const iL = p.mode === 'right' ? 0 : psiL.re ** 2 + psiL.im ** 2;
  const iR = p.mode === 'left' ? 0 : psiR.re ** 2 + psiR.im ** 2;
  let cross = 0;
  if (p.mode === 'both') cross = 2 * visibility(p.which) * (psiL.re * psiR.re + psiL.im * psiR.im);
  return { psiL, psiR, intensity: Math.max(0, iL + iR + cross), noInterference: iL + iR };
}

/** Far-field (Fraunhofer) intensity, for checking the Fresnel result: cos²(πdX/λL)·sinc²(πaX/λL). */
export function fraunhofer(p: SlitParams, X: number): number {
  const lambda = electronWavelength(p.energy);
  const beta = (Math.PI * p.width * X) / (lambda * p.distance);
  const sinc = beta === 0 ? 1 : Math.sin(beta) / beta;
  const env = sinc * sinc;
  if (p.mode !== 'both') return env;
  const alpha = (Math.PI * p.separation * X) / (lambda * p.distance);
  return env * (1 + visibility(p.which) * Math.cos(2 * alpha)) * 2;
}

export function fringeSpacing(p: SlitParams): number {
  return (electronWavelength(p.energy) * p.distance) / p.separation;
}

/** Fresnel number a²/(λL): ≫ 1 near field (slit images), ≪ 1 far field (fringes). */
export function fresnelNumber(p: SlitParams): number {
  return (p.width * p.width) / (electronWavelength(p.energy) * p.distance);
}

/** Half-width of screen to display: covers the far-field envelope or the near-field shadows. */
export function screenHalfWidth(p: SlitParams): number {
  const lambda = electronWavelength(p.energy);
  const farField = (1.7 * lambda * p.distance) / p.width;
  const nearField = 0.75 * (p.separation + p.width) + 5 * Math.sqrt(lambda * p.distance);
  return Math.max(farField, nearField);
}

export interface Pattern {
  halfWidth: number;
  X: Float64Array;
  I: Float64Array;
  noInterference: Float64Array;
  cdf: Float64Array; // normalized cumulative distribution of I over X
}

export function computePattern(p: SlitParams, samples = 2400): Pattern {
  const halfWidth = screenHalfWidth(p);
  const lambda = electronWavelength(p.energy);
  const X = new Float64Array(samples);
  const I = new Float64Array(samples);
  const noI = new Float64Array(samples);
  const cdf = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    X[i] = -halfWidth + (2 * halfWidth * i) / (samples - 1);
    const sp = screenPoint(p, X[i], lambda);
    I[i] = sp.intensity;
    noI[i] = sp.noInterference;
    if (i > 0) cdf[i] = cdf[i - 1] + 0.5 * (I[i] + I[i - 1]);
  }
  const total = cdf[samples - 1];
  if (total > 0) for (let i = 0; i < samples; i++) cdf[i] /= total;
  return { halfWidth, X, I, noInterference: noI, cdf };
}

/** Draws a detection position from the pattern by inverse CDF. */
export function sampleDetection(pat: Pattern, u: number): number {
  const { cdf, X } = pat;
  let lo = 0;
  let hi = cdf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid;
    else hi = mid;
  }
  const f = (u - cdf[lo]) / Math.max(1e-300, cdf[hi] - cdf[lo]);
  return X[lo] + f * (X[hi] - X[lo]);
}
