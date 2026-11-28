import {
  B_CRIT_RS,
  EVENT_HORIZON_RS,
  ISCO_RS,
  PHOTON_SPHERE_RS,
  circularOrbitExtrema,
  effectivePotential,
  newtonianEffectivePotential,
  radialInfallRedshiftFactor,
  solveEinsteinLens,
  type NewtonianTwin,
  type PhotonRay,
  type TimelikeParticle,
} from './physics';

const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
const FONT_SANS = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

function drawBlackHoleCore(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pxPerRs: number,
  showISCO: boolean,
) {
  ctx.save();

  // Subtle gravitational potential glow
  const glow = ctx.createRadialGradient(cx, cy, pxPerRs * 0.9, cx, cy, pxPerRs * 4.2);
  glow.addColorStop(0, 'rgba(245, 158, 11, 0.28)');
  glow.addColorStop(0.38, 'rgba(129, 140, 248, 0.10)');
  glow.addColorStop(1, 'rgba(6, 9, 17, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, pxPerRs * 4.2, 0, Math.PI * 2);
  ctx.fill();

  // ISCO ring (r = 3 r_s)
  if (showISCO) {
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.34)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, ISCO_RS * pxPerRs, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Photon sphere ring (r = 1.5 r_s)
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.65)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx, cy, PHOTON_SPHERE_RS * pxPerRs, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Event Horizon r = 1.0 r_s
  ctx.fillStyle = '#020308';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, EVENT_HORIZON_RS * pxPerRs), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// ============================================================================
// 1. MASSIVE ORBITS & EFFECTIVE POTENTIAL RENDERER
// ============================================================================

export function drawOrbitCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  particle: TimelikeParticle,
  trail: number[],
  newtonTwin: NewtonianTwin | null,
  newtonTrail: number[],
  opts: { showNewtonTwin: boolean; viewRadiusRs: number; lastPrecessionDeg: number | null },
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  // Split: Left 58% Orbital Plane (x, y), Right 42% Effective Potential V_eff(r)
  const splitX = Math.floor(width * 0.57);
  const orbCx = splitX * 0.5;
  const orbCy = height * 0.5;
  const maxR = opts.viewRadiusRs;
  const pxPerRs = (Math.min(splitX, height) - 52) / (2 * maxR);

  // Polar coordinate rings
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;
  for (let rRing = 5; rRing <= maxR; rRing += 5) {
    ctx.beginPath();
    ctx.arc(orbCx, orbCy, rRing * pxPerRs, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(14, orbCy);
  ctx.lineTo(splitX - 14, orbCy);
  ctx.moveTo(orbCx, 20);
  ctx.lineTo(orbCx, height - 20);
  ctx.stroke();

  // Newtonian comparison trail (dashed sky/slate)
  if (opts.showNewtonTwin && newtonTrail.length >= 4) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(6, 6, splitX - 12, height - 12);
    ctx.clip();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < newtonTrail.length; i += 2) {
      const px = orbCx + newtonTrail[i] * pxPerRs;
      const py = orbCy - newtonTrail[i + 1] * pxPerRs;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (newtonTwin) {
      const nx = orbCx + newtonTwin.r * Math.cos(newtonTwin.phi) * pxPerRs;
      const ny = orbCy - newtonTwin.r * Math.sin(newtonTwin.phi) * pxPerRs;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(nx, ny, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // GR Rosette trail
  if (trail.length >= 4) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(6, 6, splitX - 12, height - 12);
    ctx.clip();
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    for (let i = 0; i < trail.length; i += 2) {
      const px = orbCx + trail[i] * pxPerRs;
      const py = orbCy - trail[i + 1] * pxPerRs;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawBlackHoleCore(ctx, orbCx, orbCy, pxPerRs, true);

  // Active particle marker
  const pxPart = orbCx + particle.r * Math.cos(particle.phi) * pxPerRs;
  const pyPart = orbCy - particle.r * Math.sin(particle.phi) * pxPerRs;
  ctx.fillStyle = particle.status === 'orbiting' ? '#c7d2fe' : '#fb7185';
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pxPart, pyPart, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Orbital plane legend
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.fillText('Equatorial Plane (Schwarzschild Coordinates)', 18, 24);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('● r = 1.0 r_s Horizon   ◌ 1.5 r_s Photon Sphere', 18, height - 26);
  ctx.fillStyle = '#34d399';
  ctx.fillText(
    `◌ r = 3.0 r_s ISCO${
      opts.lastPrecessionDeg !== null ? `   |   Δφ/orbit = +${opts.lastPrecessionDeg.toFixed(1)}°` : ''
    }`,
    18,
    height - 11,
  );

  // Divider
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.beginPath();
  ctx.moveTo(splitX, 14);
  ctx.lineTo(splitX, height - 14);
  ctx.stroke();

  // ---------------- Right Panel: Effective Potential V_eff(r) ----------------
  const padL = splitX + 46;
  const padR = 20;
  const padT = 44;
  const padB = 42;
  const pW = Math.max(80, width - padL - padR);
  const pH = Math.max(80, height - padT - padB);

  const rPlotMax = Math.max(16, opts.viewRadiusRs);
  const ex = circularOrbitExtrema(particle.ell);
  const eSq = particle.energy * particle.energy;
  const vPeak = ex.vEffMax ?? 1.05;
  const yMin = 0.68;
  const yMax = Math.max(1.12, Math.min(1.85, Math.max(vPeak, eSq) * 1.08));

  const mapR = (r: number) => padL + (r / rPlotMax) * pW;
  const mapV = (v: number) => padT + pH - ((v - yMin) / (yMax - yMin)) * pH;

  // Grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.font = `9.5px ${FONT_MONO}`;
  ctx.fillStyle = '#64748b';
  for (let rv = 0; rv <= rPlotMax; rv += 5) {
    const x = mapR(rv);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + pH);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${rv}`, x, padT + pH + 14);
  }
  for (let i = 0; i <= 4; i++) {
    const val = yMin + (i / 4) * (yMax - yMin);
    const y = mapV(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + pW, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(2), padL - 5, y + 3);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, pW, pH);
  ctx.clip();

  // Escape threshold Ẽ² = 1 reference
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, mapV(1.0));
  ctx.lineTo(padL + pW, mapV(1.0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Horizon shaded band r ≤ 1
  ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
  ctx.fillRect(padL, padT, mapR(1) - padL, pH);

  // Newtonian effective potential (dashed cyan)
  if (opts.showNewtonTwin) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 180; i++) {
      const r = 1.0 + (i / 180) * (rPlotMax - 1.0);
      const v = newtonianEffectivePotential(r, particle.ell);
      const x = mapR(r);
      const y = mapV(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // GR Effective Potential V_eff(r)
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  for (let i = 0; i <= 220; i++) {
    const r = 1.0 + (i / 220) * (rPlotMax - 1.0);
    const v = effectivePotential(r, particle.ell);
    const x = mapR(r);
    const y = mapV(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Extrema markers (r_- unstable peak, r_+ stable circular minimum)
  if (ex.hasCircular && ex.rUnstableInner && ex.vEffMax && ex.rStableOuter && ex.vEffMin) {
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(mapR(ex.rUnstableInner), mapV(ex.vEffMax), 4, 0, Math.PI * 2);
    ctx.fill();

    if (ex.rStableOuter <= rPlotMax) {
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(mapR(ex.rStableOuter), mapV(ex.vEffMin), 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Horizontal conserved energy line Ẽ²
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(padL, mapV(eSq));
  ctx.lineTo(padL + pW, mapV(eSq));
  ctx.stroke();
  ctx.setLineDash([]);

  // Current state ball rolling in the potential well at (r, Ẽ²) + vertical kinetic bar down to V_eff(r)
  const curV = effectivePotential(Math.max(1, particle.r), particle.ell);
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mapR(particle.r), mapV(curV));
  ctx.lineTo(mapR(particle.r), mapV(eSq));
  ctx.stroke();

  ctx.fillStyle = '#fde68a';
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(mapR(particle.r), mapV(eSq), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('Effective Potential V_eff(r) vs. Ẽ²', padL, 24);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `10px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Radius r / r_s', padL + pW / 2, height - 10);
}

// ============================================================================
// 2. RADIAL PLUNGE: ASTRONAUT τ vs. DISTANT OBSERVER t
// ============================================================================

export function drawPlungeCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  probe: TimelikeParticle,
  r0: number,
  history: { tau: number; tCoord: number; r: number }[],
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  // Top visual strip: radial drop into horizon + redshift color shift of probe beacon
  const topH = 148;
  ctx.fillStyle = '#080d19';
  ctx.fillRect(12, 10, width - 24, topH - 14);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.strokeRect(12, 10, width - 24, topH - 14);

  const bhCx = 92;
  const bhCy = 10 + (topH - 14) * 0.52;
  const rSpan = Math.max(8, r0 * 1.15);
  const pxPerRs = (width - 170) / rSpan;

  drawBlackHoleCore(ctx, bhCx, bhCy, pxPerRs, false);

  // Radial ruler ticks
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(bhCx, bhCy);
  ctx.lineTo(bhCx + rSpan * pxPerRs, bhCy);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  for (let rv = 1; rv <= Math.floor(rSpan); rv += rv < 4 ? 1 : 2) {
    const px = bhCx + rv * pxPerRs;
    ctx.fillText(`${rv}r_s`, px, bhCy + 26);
  }

  // Probe colored by observed redshift f_∞ / f_emit (cyan -> amber -> deep crimson -> black inside horizon!)
  const fRatio = radialInfallRedshiftFactor(probe);
  const redR = Math.round(56 + (1 - fRatio) * 195);
  const redG = Math.round(189 * fRatio);
  const redB = Math.round(248 * fRatio * fRatio);
  const probeColor = probe.r <= 1 ? '#475569' : `rgb(${redR}, ${redG}, ${redB})`;
  const probeX = bhCx + probe.r * pxPerRs;

  ctx.fillStyle = probeColor;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(probeX, bhCy, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = `600 10.5px ${FONT_MONO}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  ctx.fillText(
    probe.r > 1
      ? `Outside Horizon: f_∞ / f_emit = ${fRatio.toFixed(4)} (redshift z = ${(1 / Math.max(1e-4, fRatio) - 1).toFixed(2)})`
      : probe.status === 'singularity'
        ? 'Singularity Reached (r → 0) in finite astronaut proper time!'
        : 'INSIDE EVENT HORIZON (r < r_s): No light can escape outward!',
    24,
    29,
  );

  // ---------------- Bottom Plot: r(τ) vs. r(t_distant) ----------------
  const padL = 62;
  const padR = 32;
  const padT = topH + 18;
  const padB = 38;
  const pW = Math.max(80, width - padL - padR);
  const pH = Math.max(80, height - padT - padB);

  const tMax = Math.max(32, Math.pow(r0, 1.5) * 3.0);
  const toX = (timeVal: number) => padL + (timeVal / tMax) * pW;
  const toY = (rVal: number) => padT + pH - (rVal / (r0 * 1.08)) * pH;

  // Grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${FONT_MONO}`;
  for (let i = 0; i <= 5; i++) {
    const tv = (i / 5) * tMax;
    const x = toX(tv);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + pH);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(tv.toFixed(0), x, padT + pH + 15);
  }
  for (let rv = 0; rv <= r0; rv += Math.max(1, Math.round(r0 / 5))) {
    const y = toY(rv);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + pW, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(`${rv}r_s`, padL - 7, y + 3);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, pW, pH);
  ctx.clip();

  // Event horizon r = 1 line
  ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
  ctx.fillRect(padL, toY(1.0), pW, padT + pH - toY(1.0));
  ctx.strokeStyle = '#f59e0b';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, toY(1.0));
  ctx.lineTo(padL + pW, toY(1.0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Distant observer trajectory r(t) — freezes asymptotically at r = 1!
  if (history.length >= 2) {
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (const pt of history) {
      if (!Number.isFinite(pt.tCoord) || pt.tCoord > tMax * 1.2) continue;
      const x = toX(pt.tCoord);
      const y = toY(pt.r);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Astronaut proper-time trajectory r(τ) — crosses r = 1 smoothly to r = 0!
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = toX(history[i].tau);
      const y = toY(history[i].r);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.restore();

  // Legend
  ctx.fillStyle = 'rgba(11, 16, 29, 0.9)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.fillRect(padL + pW - 252, padT + 10, 242, 54);
  ctx.strokeRect(padL + pW - 252, padT + 10, 242, 54);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#34d399';
  ctx.fillText('── Astronaut Proper Time r(τ) → crosses r_s', padL + pW - 242, padT + 28);
  ctx.fillStyle = '#fb7185';
  ctx.fillText('── Distant Observer Time r(t) → freezes at r_s', padL + pW - 242, padT + 46);

  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 10.5px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Elapsed Time (in units of r_s / c)', padL + pW / 2, height - 9);
}

// ============================================================================
// 3. PHOTON SPHERE, SHADOW & EINSTEIN-RING LENSING RENDERER
// ============================================================================

export function lensingSkyLayout(width: number, height: number) {
  const splitX = Math.floor(width * 0.6);
  const skyCx = splitX + (width - splitX) * 0.5;
  const skyCy = height * 0.52;
  const einsteinRadiusPx = Math.min(width - splitX, height) * 0.26;
  return { splitX, skyCx, skyCy, einsteinRadiusPx };
}

export function drawLensingCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  beamRays: PhotonRay[],
  highlightRay: PhotonRay,
  sourceOffsetX: number, // in units of θ_E
  sourceOffsetY: number,
  wavefrontPhase: number,
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  const { splitX, skyCx, skyCy, einsteinRadiusPx } = lensingSkyLayout(width, height);

  // ---------------- Left 60%: Null Photon Geodesic Bundle ----------------
  const bhCx = splitX * 0.52;
  const bhCy = height * 0.5;
  const viewRs = 11.5;
  const pxPerRs = (Math.min(splitX, height) - 44) / (2 * viewRs);

  ctx.save();
  ctx.beginPath();
  ctx.rect(8, 8, splitX - 16, height - 16);
  ctx.clip();

  // Critical shadow corridor |b| ≤ b_crit = 2.598 r_s on incoming side
  const bCritPx = B_CRIT_RS * pxPerRs;
  ctx.fillStyle = 'rgba(251, 113, 133, 0.06)';
  ctx.fillRect(8, bhCy - bCritPx, bhCx - 8, bCritPx * 2);
  ctx.strokeStyle = 'rgba(251, 113, 133, 0.35)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(8, bhCy - bCritPx);
  ctx.lineTo(bhCx, bhCy - bCritPx);
  ctx.moveTo(8, bhCy + bCritPx);
  ctx.lineTo(bhCx, bhCy + bCritPx);
  ctx.stroke();
  ctx.setLineDash([]);

  // Parallel photon fan
  for (const ray of beamRays) {
    const pts = ray.points;
    if (pts.length < 4) continue;
    ctx.strokeStyle =
      ray.outcome === 'captured' ? 'rgba(251, 113, 133, 0.34)' : 'rgba(56, 189, 248, 0.36)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const px = bhCx + pts[i] * pxPerRs;
      const py = bhCy - pts[i + 1] * pxPerRs;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Animated photon pulse bead along each geodesic
    const nPairs = pts.length / 2;
    const idx = Math.floor(((wavefrontPhase * 0.38) % 1) * (nPairs - 1));
    const bx = bhCx + pts[idx * 2] * pxPerRs;
    const by = bhCy - pts[idx * 2 + 1] * pxPerRs;
    ctx.fillStyle = ray.outcome === 'captured' ? '#fb7185' : '#7dd3fc';
    ctx.beginPath();
    ctx.arc(bx, by, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlighted test ray at adjustable impact parameter b_test
  if (highlightRay.points.length >= 4) {
    ctx.strokeStyle = highlightRay.outcome === 'captured' ? '#fb7185' : '#fde047';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i < highlightRay.points.length; i += 2) {
      const px = bhCx + highlightRay.points[i] * pxPerRs;
      const py = bhCy - highlightRay.points[i + 1] * pxPerRs;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  drawBlackHoleCore(ctx, bhCx, bhCy, pxPerRs, false);
  ctx.restore();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('Null Geodesics & Black Hole Shadow (b_crit = 2.598 r_s)', 18, 24);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = '#fde047';
  ctx.fillText(
    highlightRay.outcome === 'captured'
      ? `Selected b = ${highlightRay.b.toFixed(3)} r_s → CAPTURED into Event Horizon`
      : `Selected b = ${highlightRay.b.toFixed(3)} r_s → Deflection Δφ = ${((highlightRay.deflectionRad * 180) / Math.PI).toFixed(1)}° (${highlightRay.windings} loops)`,
    18,
    height - 12,
  );

  // Divider
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.beginPath();
  ctx.moveTo(splitX, 14);
  ctx.lineTo(splitX, height - 14);
  ctx.stroke();

  // ---------------- Right 40%: Observer Sky & Einstein Ring ----------------
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('Observer Sky: Gravitational Lensing', splitX + 18, 24);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `10px ${FONT_SANS}`;
  ctx.fillText('Drag the background star behind the BH', splitX + 18, 40);

  // Lensed background starfield! Each fixed star at unlensed u = (ux, uy) appears lensed
  const bgStars = [
    [-1.4, -1.1],
    [1.5, -1.2],
    [-1.6, 0.9],
    [1.2, 1.35],
    [0.4, -1.55],
    [-0.55, 1.5],
    [1.75, 0.2],
    [-1.7, -0.25],
  ];
  for (const [sx, sy] of bgStars) {
    const u = Math.hypot(sx, sy);
    const lens = solveEinsteinLens(u);
    const ux = sx / u;
    const uy = sy / u;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.beginPath();
    ctx.arc(
      skyCx + ux * lens.thetaPlus * einsteinRadiusPx,
      skyCy + uy * lens.thetaPlus * einsteinRadiusPx,
      1.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Reference dashed Einstein Ring θ_E
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.32)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(skyCx, skyCy, einsteinRadiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Black hole shadow disc at center of sky
  ctx.fillStyle = '#020308';
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(skyCx, skyCy, einsteinRadiusPx * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Compute primary & secondary lensed arcs / Einstein ring for the draggable extended star!
  const uMag = Math.hypot(sourceOffsetX, sourceOffsetY);
  const lens = solveEinsteinLens(uMag);

  if (uMag < 0.08) {
    // Complete glowing Einstein Ring!
    const ringGrad = ctx.createRadialGradient(
      skyCx,
      skyCy,
      einsteinRadiusPx - 8,
      skyCx,
      skyCy,
      einsteinRadiusPx + 8,
    );
    ringGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
    ringGrad.addColorStop(0.5, 'rgba(125, 211, 252, 0.92)');
    ringGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.strokeStyle = ringGrad;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(skyCx, skyCy, einsteinRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const phiSrc = Math.atan2(sourceOffsetY, sourceOffsetX);
    // Tangential arc half-angle stretches as 1 / uMag near alignment!
    const arcSpan = Math.min(Math.PI * 0.85, 0.14 / Math.max(0.08, uMag));

    // Primary image arc (outside θ_E, same side)
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = Math.min(8, 3.2 + Math.sqrt(lens.magPlus) * 1.3);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(
      skyCx,
      skyCy,
      Math.abs(lens.thetaPlus) * einsteinRadiusPx,
      phiSrc - arcSpan,
      phiSrc + arcSpan,
    );
    ctx.stroke();

    // Secondary inverted image arc (inside θ_E, opposite side φ + π)
    if (lens.magMinus > 0.03) {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.78)';
      ctx.lineWidth = Math.min(6.5, 2.2 + Math.sqrt(lens.magMinus) * 1.3);
      ctx.beginPath();
      ctx.arc(
        skyCx,
        skyCy,
        Math.abs(lens.thetaMinus) * einsteinRadiusPx,
        phiSrc + Math.PI - arcSpan * 0.85,
        phiSrc + Math.PI + arcSpan * 0.85,
      );
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Unlensed true source handle (hollow amber crosshair)
  const trueX = skyCx + sourceOffsetX * einsteinRadiusPx;
  const trueY = skyCy + sourceOffsetY * einsteinRadiusPx;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(trueX, trueY, 5.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(trueX - 9, trueY);
  ctx.lineTo(trueX + 9, trueY);
  ctx.moveTo(trueX, trueY - 9);
  ctx.lineTo(trueX, trueY + 9);
  ctx.stroke();

  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = '#fde68a';
  ctx.textAlign = 'center';
  ctx.fillText(
    uMag < 0.08
      ? 'EINSTEIN RING! (β_src ≈ 0)'
      : `Total Magnification μ = ${lens.totalMag.toFixed(2)}×`,
    skyCx,
    height - 12,
  );
}
