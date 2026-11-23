import { rk4Step } from '../../engine/integrators';

export interface DoublePendulumParams {
  m1: number; // kg
  m2: number; // kg
  l1: number; // m
  l2: number; // m
  g: number; // m/s^2
  damping: number; // 1/s
}

export interface DoublePendulumState {
  theta1: number;
  omega1: number;
  theta2: number;
  omega2: number;
}

export interface DoublePendulumKinematics {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  vx1: number;
  vy1: number;
  vx2: number;
  vy2: number;
  kinetic: number;
  potential: number;
  total: number;
}

function makeDerivative(p: DoublePendulumParams) {
  const { m1, m2, l1, l2, g, damping } = p;
  return (s: readonly number[]): number[] => {
    const [t1, w1, t2, w2] = s;
    const delta = t1 - t2;
    const sinD = Math.sin(delta);
    const cosD = Math.cos(delta);
    const denomBase = 2 * m1 + m2 - m2 * Math.cos(2 * delta);

    const a1 =
      (-g * (2 * m1 + m2) * Math.sin(t1) -
        m2 * g * Math.sin(t1 - 2 * t2) -
        2 * sinD * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cosD)) /
        (l1 * denomBase) -
      damping * w1;

    const a2 =
      (2 *
        sinD *
        (w1 * w1 * l1 * (m1 + m2) +
          g * (m1 + m2) * Math.cos(t1) +
          w2 * w2 * l2 * m2 * cosD)) /
        (l2 * denomBase) -
      damping * w2;

    return [w1, a1, w2, a2];
  };
}

export function stepDoublePendulum(
  state: DoublePendulumState,
  params: DoublePendulumParams,
  dt: number,
  substeps = 4,
): DoublePendulumState {
  const deriv = makeDerivative(params);
  const subDt = dt / substeps;
  let arr = [state.theta1, state.omega1, state.theta2, state.omega2];
  for (let i = 0; i < substeps; i++) {
    arr = rk4Step(arr, subDt, deriv);
  }
  return {
    theta1: arr[0],
    omega1: arr[1],
    theta2: arr[2],
    omega2: arr[3],
  };
}

export function computeKinematics(
  state: DoublePendulumState,
  p: DoublePendulumParams,
): DoublePendulumKinematics {
  const { theta1, omega1, theta2, omega2 } = state;
  const { m1, m2, l1, l2, g } = p;

  const x1 = l1 * Math.sin(theta1);
  const y1 = l1 * Math.cos(theta1);
  const x2 = x1 + l2 * Math.sin(theta2);
  const y2 = y1 + l2 * Math.cos(theta2);

  const vx1 = l1 * omega1 * Math.cos(theta1);
  const vy1 = -l1 * omega1 * Math.sin(theta1);
  const vx2 = vx1 + l2 * omega2 * Math.cos(theta2);
  const vy2 = vy1 - l2 * omega2 * Math.sin(theta2);

  const kinetic = 0.5 * m1 * (vx1 * vx1 + vy1 * vy1) + 0.5 * m2 * (vx2 * vx2 + vy2 * vy2);
  // Zero potential energy at lowest hanging position: y_lowest = l1 + l2
  const h1 = l1 + l2 - y1;
  const h2 = l1 + l2 - y2;
  const potential = m1 * g * h1 + m2 * g * h2;

  return {
    x1,
    y1,
    x2,
    y2,
    vx1,
    vy1,
    vx2,
    vy2,
    kinetic,
    potential,
    total: kinetic + potential,
  };
}
