/**
 * Classic 4th-order Runge-Kutta (RK4) integrator for ODE systems: dy/dt = f(y).
 * Provides O(dt^4) local accuracy and strong energy stability for analytical mechanics.
 */
export function rk4Step(
  state: readonly number[],
  dt: number,
  derivative: (s: readonly number[]) => number[],
): number[] {
  const n = state.length;
  const k1 = derivative(state);

  const s2 = new Array<number>(n);
  for (let i = 0; i < n; i++) s2[i] = state[i] + 0.5 * dt * k1[i];
  const k2 = derivative(s2);

  const s3 = new Array<number>(n);
  for (let i = 0; i < n; i++) s3[i] = state[i] + 0.5 * dt * k2[i];
  const k3 = derivative(s3);

  const s4 = new Array<number>(n);
  for (let i = 0; i < n; i++) s4[i] = state[i] + dt * k3[i];
  const k4 = derivative(s4);

  const next = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    next[i] = state[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return next;
}
