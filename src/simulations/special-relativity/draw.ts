import {
  classifyInterval,
  computeMuonTheory,
  dopplerFactor,
  einsteinRelativeVelocity,
  gammaFromBeta,
  invariantIntervalSq,
  lorentzBoost,
  muonSurvivalAtAltitude,
  sampleBarnPoleAt,
  sampleTwinTrajectory,
  solveBarnPole,
  type BarnPoleConfig,
  type LightSignal,
  type MuonConfig,
  type SpacetimeEvent,
  type TwinTrajectoryProfile,
} from './physics';

export interface MuonParticle {
  id: number;
  xFrac: number; // horizontal lane in [0.08, 0.92]
  properLifetimeUs: number; // sampled from Exp(1/τ₀)
  spawnedAtSimUs: number;
}

export interface SandboxState {
  e1: SpacetimeEvent;
  e2: SpacetimeEvent;
  observerBeta: number;
  probeU1: number;
  probeU2: number;
  showHyperbola: boolean;
  showProbes: boolean;
}

const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';
const FONT_SANS = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  head = 6,
  lineWidth = 1.6,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const angle = Math.atan2(dy, dx);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - 0.42), y2 - head * Math.sin(angle - 0.42));
  ctx.lineTo(x2 - head * Math.cos(angle + 0.42), y2 - head * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawClockDial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  years: number,
  maxYears: number,
  color: string,
  label: string,
) {
  ctx.save();
  ctx.fillStyle = '#09101f';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Ticks
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 3.5), cy + Math.sin(a) * (r - 3.5));
    ctx.lineTo(cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1));
    ctx.stroke();
  }

  // Sweep sector
  const frac = Math.max(0, Math.min(1, years / Math.max(1, maxYears)));
  ctx.fillStyle = `${color}28`;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r - 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Hand (one full revolution every 5 years for crisp motion)
  const handAngle = -Math.PI / 2 + ((years % 5) / 5) * Math.PI * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(handAngle) * (r - 4), cy + Math.sin(handAngle) * (r - 4));
  ctx.stroke();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 10px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${years.toFixed(2)} yr`, cx, cy + r + 13);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `500 9.5px ${FONT_SANS}`;
  ctx.fillText(label, cx, cy - r - 6);
  ctx.restore();
}

// ============================================================================
// 1. TWIN PARADOX RENDERER
// ============================================================================

export function drawTwinsCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  prof: TwinTrajectoryProfile,
  simTimeYr: number,
  signals: LightSignal[],
  opts: { showPulses: boolean; showSimultaneity: boolean; showLightCones: boolean },
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  const st = sampleTwinTrajectory(prof, simTimeYr);
  const L = prof.config.distanceLy;
  const T = prof.totalCoordTime;

  // Top physical space strip
  const topH = Math.min(142, Math.max(116, Math.round(height * 0.25)));
  ctx.fillStyle = '#080d19';
  ctx.fillRect(12, 10, width - 24, topH - 14);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 10, width - 24, topH - 14);

  const spaceX0 = 92;
  const spaceX1 = width - 92;
  const spaceY = 10 + (topH - 14) * 0.52;
  const mapSpaceX = (xLy: number) => spaceX0 + (xLy / L) * (spaceX1 - spaceX0);

  // Track line & ly ticks
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(spaceX0, spaceY);
  ctx.lineTo(spaceX1, spaceY);
  ctx.stroke();
  ctx.setLineDash([]);

  const nTicks = Math.min(10, Math.max(2, Math.round(L)));
  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  for (let i = 0; i <= nTicks; i++) {
    const xVal = (i / nTicks) * L;
    const px = mapSpaceX(xVal);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.beginPath();
    ctx.moveTo(px, spaceY - 4);
    ctx.lineTo(px, spaceY + 4);
    ctx.stroke();
    if (i === 0 || i === nTicks || i % 2 === 0) {
      ctx.fillText(`${xVal.toFixed(1)} ly`, px, spaceY + 18);
    }
  }

  // Active light pulses in flight in physical space
  if (opts.showPulses) {
    for (const sig of signals) {
      if (st.t >= sig.emitEvent.ct && st.t <= sig.receiveEvent.ct) {
        const dt = st.t - sig.emitEvent.ct;
        const xPhot = sig.sender === 'A' ? dt : sig.emitEvent.x - dt;
        const px = mapSpaceX(xPhot);
        const col = sig.sender === 'A' ? '#38bdf8' : '#f59e0b';
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, spaceY + (sig.sender === 'A' ? -9 : 9), 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Earth & Star bodies
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(spaceX0, spaceY, 8.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(spaceX1, spaceY, 7.5, 0, Math.PI * 2);
  ctx.fill();

  // Clocks for Twin A (Earth) and Target Star label
  drawClockDial(ctx, 48, spaceY, 18, st.t, T, '#38bdf8', 'Twin A');
  ctx.fillStyle = '#fbbf24';
  ctx.font = `600 10px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Target Star', width - 48, spaceY - 6);
  ctx.fillStyle = '#94a3b8';
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillText(`x = ${L.toFixed(1)} ly`, width - 48, spaceY + 9);

  // Traveler spacecraft (Lorentz-contracted hull length!)
  const shipX = mapSpaceX(st.x);
  const hullHalf = Math.max(4.5, 13 / st.gamma);
  const dir = st.beta >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(shipX, spaceY);
  ctx.fillStyle = '#818cf8';
  ctx.strokeStyle = '#c7d2fe';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(dir * hullHalf, 0);
  ctx.lineTo(-dir * hullHalf, -6.5);
  ctx.lineTo(-dir * hullHalf * 0.65, 0);
  ctx.lineTo(-dir * hullHalf, 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (Math.abs(st.beta) > 0.02) {
    drawArrow(ctx, shipX, spaceY - 14, shipX + st.beta * 34, spaceY - 14, '#34d399', 5, 1.5);
  }
  ctx.fillStyle = '#c7d2fe';
  ctx.font = `600 10px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Twin B: τ = ${st.tauB.toFixed(2)} yr`, shipX, spaceY - 22);

  // ---------------- Minkowski Diagram (bottom main area) ----------------
  const padL = 68;
  const padR = 38;
  const padT = topH + 18;
  const padB = 38;
  const plotW = Math.max(80, width - padL - padR);
  const plotH = Math.max(80, height - padT - padB);

  const xMax = L * 1.18;
  const ctMax = T * 1.06;
  const toPx = (x: number) => padL + (x / xMax) * plotW;
  const toPy = (ct: number) => padT + plotH - (ct / ctMax) * plotH;

  // Gridlines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = `10px ${FONT_MONO}`;
  const xStep = L <= 5 ? 1 : 2;
  for (let xv = 0; xv <= xMax + 1e-6; xv += xStep) {
    const px = toPx(xv);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${xv.toFixed(0)}`, px, padT + plotH + 15);
  }

  const ctStep = T <= 12 ? 2 : T <= 28 ? 4 : 8;
  for (let tv = 0; tv <= ctMax + 1e-6; tv += ctStep) {
    const py = toPy(tv);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(`${tv.toFixed(0)}`, padL - 8, py + 3);
  }

  // Axis titles
  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 10.5px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Position x (light-years)', padL + plotW / 2, height - 8);
  ctx.save();
  ctx.translate(18, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Earth Coordinate Time ct (years)', 0, 0);
  ctx.restore();

  // Clip plot box for rays & hyperplanes
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  // Optional 45° light cone from origin and turnaround
  if (opts.showLightCones) {
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.22)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1.1;
    // Origin future light cone ct = x
    ctx.beginPath();
    ctx.moveTo(toPx(0), toPy(0));
    ctx.lineTo(toPx(xMax), toPy(xMax));
    ctx.stroke();
    // Turnaround light cones (L, tHalf) -> Earth
    ctx.beginPath();
    ctx.moveTo(toPx(L), toPy(prof.tHalf));
    ctx.lineTo(toPx(0), toPy(prof.tHalf + L));
    ctx.moveTo(toPx(L), toPy(prof.tHalf));
    ctx.lineTo(toPx(0), toPy(prof.tHalf - L));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Star stationary worldline x = L
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(toPx(L), toPy(0));
  ctx.lineTo(toPx(L), toPy(T));
  ctx.stroke();
  ctx.setLineDash([]);

  // Simultaneous gap band on Earth's axis (for instant turnaround or peak cruise speed)
  if (opts.showSimultaneity) {
    const tLow = prof.tHalf - prof.betaPeak * L;
    const tHigh = prof.tHalf + prof.betaPeak * L;
    ctx.fillStyle = 'rgba(167, 139, 250, 0.11)';
    ctx.fillRect(padL, toPy(tHigh), Math.max(8, toPx(L) - padL), toPy(tLow) - toPy(tHigh));

    // Bounding pre/post turnaround simultaneity lines (dashed)
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(toPx(0), toPy(tLow));
    ctx.lineTo(toPx(L), toPy(prof.tHalf));
    ctx.lineTo(toPx(0), toPy(tHigh));
    ctx.stroke();
    ctx.setLineDash([]);

    // Live instantaneous co-moving simultaneity hyperplane of Twin B:
    // ct(x) = st.t + st.beta * (x - st.x)
    if (st.leg !== 'arrived') {
      const ctAt0 = st.earthSimultaneousTime;
      const ctAtMax = st.t + st.beta * (xMax - st.x);
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(toPx(0), toPy(ctAt0));
      ctx.lineTo(toPx(xMax), toPy(ctAtMax));
      ctx.stroke();

      // Highlight simultaneous point on Earth's worldline
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.arc(toPx(0), toPy(ctAt0), 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Periodic Doppler beacon rays
  if (opts.showPulses) {
    for (const sig of signals) {
      if (sig.emitEvent.ct > st.t) continue;
      const frac = Math.min(
        1,
        (st.t - sig.emitEvent.ct) / Math.max(1e-6, sig.receiveEvent.ct - sig.emitEvent.ct),
      );
      const curX = sig.emitEvent.x + frac * (sig.receiveEvent.x - sig.emitEvent.x);
      const curCt = sig.emitEvent.ct + frac * (sig.receiveEvent.ct - sig.emitEvent.ct);
      ctx.strokeStyle =
        sig.sender === 'A' ? 'rgba(56, 189, 248, 0.42)' : 'rgba(245, 158, 11, 0.48)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(toPx(sig.emitEvent.x), toPy(sig.emitEvent.ct));
      ctx.lineTo(toPx(curX), toPy(curCt));
      ctx.stroke();
    }
  }

  // Full ghost worldline of Twin B
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const ti = (i / N) * T;
    const p = sampleTwinTrajectory(prof, ti);
    const px = toPx(p.x);
    const py = toPy(ti);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Active worldline of Twin A (x = 0, cyan) up to st.t
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(toPx(0), toPy(0));
  ctx.lineTo(toPx(0), toPy(st.t));
  ctx.stroke();

  // Active worldline of Twin B (indigo) up to st.t
  ctx.strokeStyle = '#818cf8';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  const nAct = Math.max(2, Math.ceil((st.t / T) * 180));
  for (let i = 0; i <= nAct; i++) {
    const ti = (i / nAct) * st.t;
    const p = sampleTwinTrajectory(prof, ti);
    const px = toPx(p.x);
    const py = toPy(ti);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.restore(); // end clip

  // Current event markers
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(toPx(0), toPy(st.t), 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#818cf8';
  ctx.beginPath();
  ctx.arc(toPx(st.x), toPy(st.t), 5.5, 0, Math.PI * 2);
  ctx.fill();

  // Legend badge top-right of Minkowski plot
  const dopApproach = st.leg === 'outbound' ? -Math.abs(st.beta) : Math.abs(st.beta);
  const dop = st.leg === 'arrived' ? 1 : dopplerFactor(dopApproach);
  ctx.fillStyle = 'rgba(11, 16, 29, 0.88)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;
  const bx = padL + plotW - 216;
  const by = padT + 10;
  ctx.fillRect(bx, by, 206, 56);
  ctx.strokeRect(bx, by, 206, 56);

  ctx.font = `10px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(`A→B rays (cyan) · B→A (amber)`, bx + 9, by + 17);
  ctx.fillStyle = '#a78bfa';
  ctx.fillText(`B's "now" on Earth: ${st.earthSimultaneousTime.toFixed(2)} yr`, bx + 9, by + 33);
  ctx.fillStyle = dop >= 1 ? '#34d399' : '#fb7185';
  ctx.fillText(`Observed Doppler f/f₀ = ${dop.toFixed(3)}×`, bx + 9, by + 48);
}

// ============================================================================
// 2. BARN & POLE (LADDER) RENDERER
// ============================================================================

export function drawBarnPoleCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cfg: BarnPoleConfig,
  ctActive: number,
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  const sol = solveBarnPole(cfg);
  const snap = sampleBarnPoleAt(cfg, sol, ctActive);
  const inBarnFrame = cfg.activeFrame === 'primary';

  // Top physical view
  const topH = Math.min(155, Math.max(125, Math.round(height * 0.28)));
  ctx.fillStyle = '#080d19';
  ctx.fillRect(12, 10, width - 24, topH - 12);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.strokeRect(12, 10, width - 24, topH - 12);

  const spanM = Math.max(cfg.barnRestLengthM, cfg.poleRestLengthM) * 1.85;
  const cx = width * 0.5;
  const cy = 10 + (topH - 12) * 0.56;
  const pxPerM = (width - 96) / (2 * spanM);
  const mapX = (xm: number) => cx + xm * pxPerM;

  // Frame title + fit badge
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = inBarnFrame ? '#38bdf8' : '#34d399';
  ctx.fillText(
    inBarnFrame
      ? `Active View: Barn Rest Frame S  (ct = ${ctActive.toFixed(2)} m)`
      : `Active View: Pole Rest Frame S'  (ct' = ${ctActive.toFixed(2)} m)`,
    24,
    29,
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = sol.fitsWithoutCollision ? '#34d399' : '#fb7185';
  ctx.font = `600 10.5px ${FONT_MONO}`;
  ctx.fillText(
    sol.fitsWithoutCollision
      ? `SAFE PASSAGE (L_pole/γ = ${sol.poleLenInS.toFixed(2)} m ≤ ${sol.barnLenInS.toFixed(1)} m)`
      : `COLLISION! Need β ≥ ${sol.betaFitThreshold.toFixed(3)}c to fit`,
    width - 24,
    29,
  );

  // Barn roof & floor
  const bL = mapX(snap.barnLeft);
  const bR = mapX(snap.barnRight);
  const barnHalfH = 26;
  ctx.fillStyle = 'rgba(56, 189, 248, 0.09)';
  ctx.fillRect(bL, cy - barnHalfH, bR - bL, barnHalfH * 2);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(bL, cy - barnHalfH);
  ctx.lineTo(bR, cy - barnHalfH);
  ctx.moveTo(bL, cy + barnHalfH);
  ctx.lineTo(bR, cy + barnHalfH);
  ctx.stroke();

  // Left & Right Doors
  const drawDoor = (xPx: number, closed: boolean, name: string) => {
    ctx.save();
    if (closed) {
      ctx.strokeStyle = sol.fitsWithoutCollision ? '#f59e0b' : '#fb7185';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(xPx, cy - barnHalfH);
      ctx.lineTo(xPx, cy + barnHalfH);
      ctx.stroke();
      ctx.fillStyle = sol.fitsWithoutCollision ? '#f59e0b' : '#fb7185';
      ctx.font = `700 9.5px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('CLOSED!', xPx, cy - barnHalfH - 7);
    } else {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(xPx, cy - barnHalfH);
      ctx.lineTo(xPx, cy + barnHalfH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#64748b';
      ctx.font = `9px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(name, xPx, cy - barnHalfH - 6);
    }
    ctx.restore();
  };
  drawDoor(bL, snap.leftDoorClosed, 'Rear Door');
  drawDoor(bR, snap.rightDoorClosed, 'Exit Door');

  // Pole
  const pL = mapX(snap.poleLeft);
  const pR = mapX(snap.poleRight);
  ctx.fillStyle = '#34d399';
  ctx.fillRect(pL, cy - 5, Math.max(2, pR - pL), 10);
  ctx.strokeStyle = '#a7f3d0';
  ctx.lineWidth = 1;
  ctx.strokeRect(pL, cy - 5, Math.max(2, pR - pL), 10);

  // Motion velocity arrow in active frame
  if (inBarnFrame) {
    drawArrow(ctx, (pL + pR) / 2 - 18, cy + 16, (pL + pR) / 2 + 22, cy + 16, '#34d399', 5, 1.5);
  } else {
    drawArrow(ctx, (bL + bR) / 2 + 18, cy + 35, (bL + bR) / 2 - 22, cy + 35, '#38bdf8', 5, 1.5);
  }

  // ---------------- Synchronized Two-Frame Minkowski Diagram ----------------
  const padL = 62;
  const padR = 36;
  const padT = topH + 16;
  const padB = 34;
  const plotW = Math.max(80, width - padL - padR);
  const plotH = Math.max(80, height - padT - padB);

  const maxCoord = Math.max(16, Math.max(cfg.barnRestLengthM, cfg.poleRestLengthM) * 1.45);
  const ox = padL + plotW * 0.5;
  const oy = padT + plotH * 0.5;
  const scale = Math.min(plotW, plotH) / (2 * maxCoord);
  const toPx = (u: number) => ox + u * scale;
  const toPy = (v: number) => oy - v * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  // Subtle orthogonal grid for active frame
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;
  for (let g = -25; g <= 25; g += 5) {
    ctx.beginPath();
    ctx.moveTo(toPx(g), padT);
    ctx.lineTo(toPx(g), padT + plotH);
    ctx.moveTo(padL, toPy(g));
    ctx.lineTo(padL + plotW, toPy(g));
    ctx.stroke();
  }

  // 45° Light cone through origin
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.22)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(toPx(-maxCoord * 2), toPy(-maxCoord * 2));
  ctx.lineTo(toPx(maxCoord * 2), toPy(maxCoord * 2));
  ctx.moveTo(toPx(-maxCoord * 2), toPy(maxCoord * 2));
  ctx.lineTo(toPx(maxCoord * 2), toPy(-maxCoord * 2));
  ctx.stroke();
  ctx.setLineDash([]);

  // Worldtube helper: map a Barn-frame event (x, ct) into active frame coordinates
  const mapEvent = (evS: SpacetimeEvent): SpacetimeEvent =>
    inBarnFrame ? evS : lorentzBoost(evS, cfg.beta);

  const Tspan = maxCoord * 2.4;
  // Barn worldtube: x_S ∈ [-Lb/2, +Lb/2] for ct_S ∈ [-Tspan, +Tspan]
  const hb = 0.5 * sol.barnLenInS;
  const b1 = mapEvent({ x: -hb, ct: -Tspan });
  const b2 = mapEvent({ x: +hb, ct: -Tspan });
  const b3 = mapEvent({ x: +hb, ct: +Tspan });
  const b4 = mapEvent({ x: -hb, ct: +Tspan });
  ctx.fillStyle = 'rgba(56, 189, 248, 0.11)';
  ctx.beginPath();
  ctx.moveTo(toPx(b1.x), toPy(b1.ct));
  ctx.lineTo(toPx(b2.x), toPy(b2.ct));
  ctx.lineTo(toPx(b3.x), toPy(b3.ct));
  ctx.lineTo(toPx(b4.x), toPy(b4.ct));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(toPx(b1.x), toPy(b1.ct));
  ctx.lineTo(toPx(b4.x), toPy(b4.ct));
  ctx.moveTo(toPx(b2.x), toPy(b2.ct));
  ctx.lineTo(toPx(b3.x), toPy(b3.ct));
  ctx.stroke();

  // Pole worldtube: x'_S' ∈ [-Lp/2, +Lp/2] => in S: x = β·ct ± Lp/(2γ)
  const hpS = 0.5 * sol.poleLenInS;
  const p1 = mapEvent({ x: -cfg.beta * Tspan - hpS, ct: -Tspan });
  const p2 = mapEvent({ x: -cfg.beta * Tspan + hpS, ct: -Tspan });
  const p3 = mapEvent({ x: +cfg.beta * Tspan + hpS, ct: +Tspan });
  const p4 = mapEvent({ x: +cfg.beta * Tspan - hpS, ct: +Tspan });
  ctx.fillStyle = 'rgba(52, 211, 153, 0.13)';
  ctx.beginPath();
  ctx.moveTo(toPx(p1.x), toPy(p1.ct));
  ctx.lineTo(toPx(p2.x), toPy(p2.ct));
  ctx.lineTo(toPx(p3.x), toPy(p3.ct));
  ctx.lineTo(toPx(p4.x), toPy(p4.ct));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.75)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(toPx(p1.x), toPy(p1.ct));
  ctx.lineTo(toPx(p4.x), toPy(p4.ct));
  ctx.moveTo(toPx(p2.x), toPy(p2.ct));
  ctx.lineTo(toPx(p3.x), toPy(p3.ct));
  ctx.stroke();

  // Orthogonal axes of active frame + oblique axes of the other frame
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, oy);
  ctx.lineTo(padL + plotW, oy);
  ctx.moveTo(ox, padT);
  ctx.lineTo(ox, padT + plotH);
  ctx.stroke();

  // Other frame's simultaneity line passing through E_L and E_R (ct_S = 0)
  const eL = mapEvent(sol.leftDoorEventS);
  const eR = mapEvent(sol.rightDoorEventS);
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const slope = (eR.ct - eL.ct) / (eR.x - eL.x);
  ctx.moveTo(toPx(-maxCoord * 2), toPy(-slope * maxCoord * 2));
  ctx.lineTo(toPx(maxCoord * 2), toPy(slope * maxCoord * 2));
  ctx.stroke();
  ctx.setLineDash([]);

  // Current horizontal active-frame simultaneity slice
  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, toPy(ctActive));
  ctx.lineTo(padL + plotW, toPy(ctActive));
  ctx.stroke();

  // Door flash events E_L and E_R
  for (const [ev, label] of [
    [eL, 'E_rear'],
    [eR, 'E_exit'],
  ] as const) {
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(toPx(ev.x), toPy(ev.ct), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.font = `600 10px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${label} (ct=${ev.ct.toFixed(1)})`, toPx(ev.x) + 7, toPy(ev.ct) - 5);
  }

  ctx.restore();

  // Axis labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 10.5px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(inBarnFrame ? 'x (m) — Barn Frame S' : "x' (m) — Pole Frame S'", ox, height - 9);
  ctx.save();
  ctx.translate(18, oy);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(inBarnFrame ? 'ct (m)' : "ct' (m)", 0, 0);
  ctx.restore();
}

// ============================================================================
// 3. ATMOSPHERIC MUONS RENDERER
// ============================================================================

export function drawMuonsCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cfg: MuonConfig,
  simUs: number,
  muons: MuonParticle[],
  stats: { emitted: number; seaLevelHits: number; decayedInAir: number },
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  const th = computeMuonTheory(cfg);
  const inEarth = cfg.activeFrame === 'primary';

  const leftW = Math.floor(width * 0.48);
  const colX = 52;
  const colW = leftW - 72;
  const colTop = 38;
  const colBot = height - 42;
  const colH = colBot - colTop;

  // Atmosphere gradient column
  const grad = ctx.createLinearGradient(0, colTop, 0, colBot);
  grad.addColorStop(0, '#090d1f');
  grad.addColorStop(0.65, '#0c1b33');
  grad.addColorStop(1, '#122b42');
  ctx.fillStyle = grad;

  if (inEarth) {
    ctx.fillRect(colX, colTop, colW, colH);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeRect(colX, colTop, colW, colH);

    // Sea level scintillator bar
    ctx.fillStyle = 'rgba(52, 211, 153, 0.22)';
    ctx.fillRect(colX, colBot - 6, colW, 6);

    // Altitude ticks
    ctx.fillStyle = '#64748b';
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = 'right';
    for (let frac = 0; frac <= 1.001; frac += 0.25) {
      const z = frac * cfg.altitudeKm;
      const py = colBot - frac * colH;
      ctx.fillText(`${z.toFixed(1)} km`, colX - 6, py + 3);
    }

    // Draw muons streaming down in Earth frame
    for (const m of muons) {
      const ageEarthUs = simUs - m.spawnedAtSimUs;
      if (ageEarthUs < 0) continue;
      const properAge = ageEarthUs / th.gamma;
      const zNow = cfg.altitudeKm - ageEarthUs * th.speedKmPerUs;
      const zDecay = cfg.altitudeKm - m.properLifetimeUs * th.gamma * th.speedKmPerUs;
      const px = colX + m.xFrac * colW;

      if (properAge < m.properLifetimeUs && zNow > 0) {
        const py = colBot - (zNow / cfg.altitudeKm) * colH;
        // Relativistic trail
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px, Math.max(colTop, py - 18));
        ctx.lineTo(px, py);
        ctx.stroke();

        ctx.fillStyle = '#818cf8';
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (zDecay <= 0) {
        // Reached sea level! Brief detector flash
        const tSinceHit = ageEarthUs - th.earthTransitUs;
        if (tSinceHit >= 0 && tSinceHit < 6) {
          const alpha = Math.max(0, 1 - tSinceHit / 6);
          ctx.fillStyle = `rgba(52, 211, 153, ${alpha})`;
          ctx.beginPath();
          ctx.arc(px, colBot - 3, 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Decayed mid-air at zDecay
        const tDecayEarth = (cfg.altitudeKm - zDecay) / th.speedKmPerUs;
        const dtAfter = ageEarthUs - tDecayEarth;
        if (dtAfter >= 0 && dtAfter < 5) {
          const py = colBot - (zDecay / cfg.altitudeKm) * colH;
          const alpha = Math.max(0, 1 - dtAfter / 5);
          ctx.strokeStyle = `rgba(251, 113, 133, ${alpha})`;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.arc(px, py, 3 + dtAfter * 1.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  } else {
    // MUON REST FRAME S': Atmosphere is Lorentz-contracted by 1/γ and rushes UPWARD!
    const contrRatio = Math.max(0.08, 1 / th.gamma);
    const slabH = colH * contrRatio;
    const cycleUs = th.muonProperTransitUs;
    const phase = (simUs % Math.max(0.2, cycleUs)) / Math.max(0.2, cycleUs);
    const muonY = colTop + 34;
    const slabTop = muonY - phase * slabH;

    ctx.fillStyle = '#090d19';
    ctx.fillRect(colX, colTop, colW, colH);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.strokeRect(colX, colTop, colW, colH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(colX, colTop, colW, colH);
    ctx.clip();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.fillRect(colX, slabTop, colW, slabH);
    ctx.fillStyle = 'rgba(52, 211, 153, 0.35)';
    ctx.fillRect(colX, slabTop + slabH - 5, colW, 5);
    drawArrow(ctx, colX + colW - 18, slabTop + slabH + 22, colX + colW - 18, slabTop + slabH - 6, '#34d399', 5, 1.6);
    ctx.restore();

    // Stationary muon cohort at y = muonY
    for (let i = 0; i < 9; i++) {
      const px = colX + ((i + 0.8) / 9.6) * colW;
      const tauReq = ((i + 0.5) / 9) * -Math.log(0.08) * 2.197;
      const alive = phase * cycleUs < tauReq;
      ctx.fillStyle = alive ? '#818cf8' : 'rgba(251, 113, 133, 0.35)';
      ctx.beginPath();
      ctx.arc(px, muonY, alive ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#c7d2fe';
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(`Contracted H' = ${th.contractedAtmosphereKm.toFixed(2)} km`, colX + 8, colBot - 24);
    ctx.fillStyle = '#34d399';
    ctx.fillText(`Sea level arrives in τ = ${th.muonProperTransitUs.toFixed(2)} µs`, colX + 8, colBot - 10);
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText(
    inEarth ? 'Earth Frame S (Time Dilation γτ₀)' : "Muon Rest Frame S' (Length Contraction H/γ)",
    colX,
    24,
  );

  // ---------------- Right Panel: Survival Curve vs. Altitude ----------------
  const rPadL = leftW + 46;
  const rPadR = 26;
  const rTop = 38;
  const rBot = height - 42;
  const rW = Math.max(80, width - rPadL - rPadR);
  const rH = rBot - rTop;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.lineWidth = 1;
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = '#64748b';
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const px = rPadL + f * rW;
    ctx.beginPath();
    ctx.moveTo(px, rTop);
    ctx.lineTo(px, rBot);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`${(f * 100).toFixed(0)}%`, px, rBot + 15);

    const py = rBot - f * rH;
    ctx.beginPath();
    ctx.moveTo(rPadL, py);
    ctx.lineTo(rPadL + rW, py);
    ctx.stroke();
  }

  // Newtonian curve (dashed coral)
  ctx.strokeStyle = '#fb7185';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const z = (i / 100) * cfg.altitudeKm;
    const s = muonSurvivalAtAltitude(cfg, z, false);
    const px = rPadL + s * rW;
    const py = rBot - (i / 100) * rH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Special Relativity curve (emerald)
  ctx.strokeStyle = '#34d399';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const z = (i / 100) * cfg.altitudeKm;
    const s = muonSurvivalAtAltitude(cfg, z, true);
    const px = rPadL + s * rW;
    const py = rBot - (i / 100) * rH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Measured sea-level Monte Carlo marker
  const completed = stats.seaLevelHits + stats.decayedInAir;
  if (completed >= 5) {
    const measured = stats.seaLevelHits / completed;
    const mx = rPadL + measured * rW;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(mx, rBot, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 11px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('Survival Fraction N(z) / N₀', rPadL, 24);

  // Legend box
  ctx.fillStyle = 'rgba(11, 16, 29, 0.9)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.fillRect(rPadL + rW - 178, rTop + 10, 168, 56);
  ctx.strokeRect(rPadL + rW - 178, rTop + 10, 168, 56);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = '#34d399';
  ctx.fillText(`Relativistic: ${(th.survivalSR * 100).toFixed(1)}%`, rPadL + rW - 169, rTop + 27);
  ctx.fillStyle = '#fb7185';
  ctx.fillText(`Newtonian: ${(th.survivalNewton * 100).toExponential(1)}%`, rPadL + rW - 169, rTop + 42);
  ctx.fillStyle = '#38bdf8';
  const measTxt =
    completed >= 5 ? `${((stats.seaLevelHits / completed) * 100).toFixed(1)}% (n=${completed})` : 'collecting...';
  ctx.fillText(`Measured: ${measTxt}`, rPadL + rW - 169, rTop + 57);
}

// ============================================================================
// 4. INTERACTIVE MINKOWSKI SANDBOX RENDERER
// ============================================================================

export function sandboxGeometry(width: number, height: number) {
  const padL = 56;
  const padR = 32;
  const padT = 28;
  const padB = 38;
  const plotW = Math.max(100, width - padL - padR);
  const plotH = Math.max(100, height - padT - padB);
  const maxCoord = 10;
  const scale = Math.min(plotW, plotH) / (2 * maxCoord);
  const ox = padL + plotW * 0.5;
  const oy = padT + plotH * 0.5;
  return {
    padL,
    padT,
    plotW,
    plotH,
    maxCoord,
    ox,
    oy,
    scale,
    toPx: (x: number) => ox + x * scale,
    toPy: (ct: number) => oy - ct * scale,
    fromPx: (px: number) => (px - ox) / scale,
    fromPy: (py: number) => (oy - py) / scale,
  };
}

export function drawSandboxCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sb: SandboxState,
  simTime: number,
) {
  ctx.fillStyle = '#060911';
  ctx.fillRect(0, 0, width, height);

  const g = sandboxGeometry(width, height);
  const { padL, padT, plotW, plotH, maxCoord, ox, oy, toPx, toPy } = g;

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, plotW, plotH);
  ctx.clip();

  // Light-cone wedges from E1
  const e1x = toPx(sb.e1.x);
  const e1y = toPy(sb.e1.ct);
  const coneSpan = maxCoord * 2.5 * g.scale;
  ctx.fillStyle = 'rgba(251, 191, 36, 0.05)';
  ctx.beginPath();
  ctx.moveTo(e1x, e1y);
  ctx.lineTo(e1x - coneSpan, e1y - coneSpan);
  ctx.lineTo(e1x + coneSpan, e1y - coneSpan);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(e1x, e1y);
  ctx.lineTo(e1x - coneSpan, e1y + coneSpan);
  ctx.lineTo(e1x + coneSpan, e1y + coneSpan);
  ctx.closePath();
  ctx.fill();

  // Orthogonal S grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;
  for (let k = -16; k <= 16; k += 2) {
    ctx.beginPath();
    ctx.moveTo(toPx(k), padT);
    ctx.lineTo(toPx(k), padT + plotH);
    ctx.moveTo(padL, toPy(k));
    ctx.lineTo(padL + plotW, toPy(k));
    ctx.stroke();
  }

  // Oblique S' coordinate grid for observer moving at sb.observerBeta
  const bObs = sb.observerBeta;
  if (Math.abs(bObs) > 0.01) {
    const gam = gammaFromBeta(bObs);
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.16)';
    ctx.lineWidth = 1;
    for (let kp = -12; kp <= 12; kp += 2) {
      // Constant x' = kp => x - b*ct = kp/gam => x = b*ct + kp/gam
      ctx.beginPath();
      ctx.moveTo(toPx(-bObs * 20 + kp / gam), toPy(-20));
      ctx.lineTo(toPx(bObs * 20 + kp / gam), toPy(20));
      ctx.stroke();
      // Constant ct' = kp => ct - b*x = kp/gam => ct = b*x + kp/gam
      ctx.beginPath();
      ctx.moveTo(toPx(-20), toPy(-bObs * 20 + kp / gam));
      ctx.lineTo(toPx(20), toPy(bObs * 20 + kp / gam));
      ctx.stroke();
    }

    // Highlighted S' axes through origin
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.72)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    // ct'-axis (x' = 0 => x = b*ct)
    ctx.moveTo(toPx(-bObs * 20), toPy(-20));
    ctx.lineTo(toPx(bObs * 20), toPy(20));
    // x'-axis (ct' = 0 => ct = b*x)
    ctx.moveTo(toPx(-20), toPy(-bObs * 20));
    ctx.lineTo(toPx(20), toPy(bObs * 20));
    ctx.stroke();
  }

  // S orthogonal axes
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(padL, oy);
  ctx.lineTo(padL + plotW, oy);
  ctx.moveTo(ox, padT);
  ctx.lineTo(ox, padT + plotH);
  ctx.stroke();

  // Light cone lines through E1
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.36)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(toPx(sb.e1.x - 24), toPy(sb.e1.ct - 24));
  ctx.lineTo(toPx(sb.e1.x + 24), toPy(sb.e1.ct + 24));
  ctx.moveTo(toPx(sb.e1.x - 24), toPy(sb.e1.ct + 24));
  ctx.lineTo(toPx(sb.e1.x + 24), toPy(sb.e1.ct - 24));
  ctx.stroke();
  ctx.setLineDash([]);

  // Invariant calibration hyperbola through E2 relative to E1: (ct - ct1)² - (x - x1)² = ds²
  const ds2 = invariantIntervalSq(sb.e1, sb.e2);
  const kind = classifyInterval(ds2, 0.08);
  if (sb.showHyperbola && Math.abs(ds2) > 0.05) {
    ctx.strokeStyle =
      kind === 'timelike' ? 'rgba(52, 211, 153, 0.48)' : 'rgba(251, 113, 133, 0.48)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    const sMag = Math.sqrt(Math.abs(ds2));
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const eta = -2.3 + (i / 120) * 4.6;
        const dx = kind === 'timelike' ? sMag * Math.sinh(eta) : sign * sMag * Math.cosh(eta);
        const dct = kind === 'timelike' ? sign * sMag * Math.cosh(eta) : sMag * Math.sinh(eta);
        const px = toPx(sb.e1.x + dx);
        const py = toPy(sb.e1.ct + dct);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Optional velocity-addition probe worldlines from origin
  if (sb.showProbes) {
    const tAnim = (simTime % 9.5) + 0.3;
    for (const [u, col, name] of [
      [sb.probeU1, '#38bdf8', 'Probe 1'],
      [sb.probeU2, '#f59e0b', 'Probe 2'],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(toPx(0), toPy(0));
      ctx.lineTo(toPx(u * 12), toPy(12));
      ctx.stroke();

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(toPx(u * tAnim), toPy(tAnim), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `600 10px ${FONT_MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(`${name} (${u.toFixed(2)}c)`, toPx(u * 8.2) + 6, toPy(8.2));
    }
  }

  // Interval vector E1 -> E2
  const intervalCol =
    kind === 'timelike' ? '#34d399' : kind === 'lightlike' ? '#fbbf24' : '#fb7185';
  drawArrow(ctx, toPx(sb.e1.x), toPy(sb.e1.ct), toPx(sb.e2.x), toPy(sb.e2.ct), intervalCol, 7, 2.2);

  // Draggable handles E1 and E2
  const e1p = lorentzBoost(sb.e1, bObs);
  const e2p = lorentzBoost(sb.e2, bObs);
  for (const [ev, evP, label, col] of [
    [sb.e1, e1p, 'E₁', '#38bdf8'],
    [sb.e2, e2p, 'E₂', intervalCol],
  ] as const) {
    const px = toPx(ev.x);
    const py = toPy(ev.ct);
    ctx.fillStyle = '#060911';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(px, py, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = `600 10.5px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText(
      `${label} S'(${evP.x.toFixed(1)}, ${evP.ct.toFixed(1)})`,
      px + 10,
      py - 6,
    );
  }

  ctx.restore();

  // HUD card top-left
  const dtPrime = e2p.ct - e1p.ct;
  const uRel = einsteinRelativeVelocity(sb.probeU2, sb.probeU1);
  ctx.fillStyle = 'rgba(11, 16, 29, 0.9)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.fillRect(padL + 10, padT + 10, 248, sb.showProbes ? 68 : 52);
  ctx.strokeRect(padL + 10, padT + 10, 248, sb.showProbes ? 68 : 52);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillStyle = intervalCol;
  ctx.fillText(
    `Δs² = ${ds2.toFixed(2)} ls² (${kind.toUpperCase()})`,
    padL + 19,
    padT + 27,
  );
  ctx.fillStyle = '#c7d2fe';
  ctx.fillText(
    `Δct' = ${dtPrime >= 0 ? '+' : ''}${dtPrime.toFixed(2)} ls (${dtPrime >= 0 ? 'E₁ before E₂' : 'ORDER FLIPPED!'})`,
    padL + 19,
    padT + 43,
  );
  if (sb.showProbes) {
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(
      `Einstein u₂_in_1 = ${uRel >= 0 ? '+' : ''}${uRel.toFixed(4)}c (< c!)`,
      padL + 19,
      padT + 59,
    );
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = `600 10.5px ${FONT_SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('Drag E₁ or E₂ directly on the Minkowski diagram · x (light-seconds)', ox, height - 10);
}
