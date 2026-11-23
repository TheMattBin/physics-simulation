import { rk4Step } from '../../engine/integrators';

export interface ProjectileParams {
  v0: number; // launch speed m/s
  angleDeg: number; // launch angle deg
  mass: number; // kg
  radius: number; // m
  cd: number; // drag coefficient
  airDensity: number; // kg/m^3 (sea level = 1.225)
  gravity: number; // m/s^2
  windSpeed: number; // m/s (+ tailwind, - headwind)
  launchHeight: number; // m
}

export interface ProjectileState {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  landed: boolean;
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  speed: number;
}

export interface TrajectorySummary {
  points: TrajectoryPoint[];
  range: number;
  maxHeight: number;
  flightTime: number;
  impactSpeed: number;
}

export interface ProjectilePreset {
  id: string;
  label: string;
  mass: number;
  radius: number;
  cd: number;
}

export const PROJECTILE_PRESETS: ProjectilePreset[] = [
  { id: 'cannonball', label: 'Iron Sphere', mass: 4.0, radius: 0.05, cd: 0.47 },
  { id: 'baseball', label: 'Baseball', mass: 0.145, radius: 0.037, cd: 0.35 },
  { id: 'soccer', label: 'Soccer Ball', mass: 0.43, radius: 0.11, cd: 0.25 },
  { id: 'pingpong', label: 'Ping-Pong', mass: 0.0027, radius: 0.02, cd: 0.47 },
];

export function dragFactorK(p: ProjectileParams): number {
  const area = Math.PI * p.radius * p.radius;
  return 0.5 * p.airDensity * p.cd * area;
}

export function terminalVelocity(p: ProjectileParams): number {
  const k = dragFactorK(p);
  if (k <= 1e-9 || p.gravity <= 0) return Infinity;
  return Math.sqrt((p.mass * p.gravity) / k);
}

export function initialProjectileState(p: ProjectileParams): ProjectileState {
  const rad = (p.angleDeg * Math.PI) / 180;
  return {
    t: 0,
    x: 0,
    y: p.launchHeight,
    vx: p.v0 * Math.cos(rad),
    vy: p.v0 * Math.sin(rad),
    landed: false,
  };
}

export function stepProjectile(
  state: ProjectileState,
  p: ProjectileParams,
  dt: number,
  withDrag: boolean,
): ProjectileState {
  if (state.landed) return state;

  const kOverM = withDrag ? dragFactorK(p) / Math.max(1e-6, p.mass) : 0;
  const g = p.gravity;
  const wind = withDrag ? p.windSpeed : 0;

  const deriv = (s: readonly number[]): number[] => {
    const [, , vx, vy] = s;
    const relVx = vx - wind;
    const relVy = vy;
    const relSpeed = Math.hypot(relVx, relVy);
    const ax = -kOverM * relSpeed * relVx;
    const ay = -g - kOverM * relSpeed * relVy;
    return [vx, vy, ax, ay];
  };

  const next = rk4Step([state.x, state.y, state.vx, state.vy], dt, deriv);
  const nextT = state.t + dt;

  // Interpolate exact ground impact when y crosses 0
  if (next[1] <= 0 && state.y >= 0 && next[1] < state.y) {
    const frac = state.y / Math.max(1e-9, state.y - next[1]);
    return {
      t: state.t + dt * frac,
      x: state.x + (next[0] - state.x) * frac,
      y: 0,
      vx: state.vx + (next[2] - state.vx) * frac,
      vy: state.vy + (next[3] - state.vy) * frac,
      landed: true,
    };
  }

  return {
    t: nextT,
    x: next[0],
    y: next[1],
    vx: next[2],
    vy: next[3],
    landed: false,
  };
}

export function simulateFullTrajectory(
  p: ProjectileParams,
  withDrag: boolean,
): TrajectorySummary {
  let st = initialProjectileState(p);
  const points: TrajectoryPoint[] = [{ x: st.x, y: st.y, speed: p.v0 }];
  let maxHeight = st.y;
  const dt = 0.015;
  const maxSteps = 3000;

  for (let i = 0; i < maxSteps && !st.landed; i++) {
    st = stepProjectile(st, p, dt, withDrag);
    if (st.y > maxHeight) maxHeight = st.y;
    if (i % 2 === 0 || st.landed) {
      points.push({ x: st.x, y: st.y, speed: Math.hypot(st.vx, st.vy) });
    }
  }

  return {
    points,
    range: st.x,
    maxHeight,
    flightTime: st.t,
    impactSpeed: Math.hypot(st.vx, st.vy),
  };
}

export function findOptimalAngleWithDrag(p: ProjectileParams): { angle: number; range: number } {
  let bestAngle = 45;
  let bestRange = -Infinity;
  for (let deg = 10; deg <= 75; deg += 2) {
    const res = simulateFullTrajectory({ ...p, angleDeg: deg }, true);
    if (res.range > bestRange) {
      bestRange = res.range;
      bestAngle = deg;
    }
  }
  // Refine +/- 2 deg in 0.5 deg steps
  const coarse = bestAngle;
  for (let deg = Math.max(5, coarse - 2); deg <= Math.min(80, coarse + 2); deg += 0.5) {
    const res = simulateFullTrajectory({ ...p, angleDeg: deg }, true);
    if (res.range > bestRange) {
      bestRange = res.range;
      bestAngle = deg;
    }
  }
  return { angle: bestAngle, range: bestRange };
}
