export type ObstaclePreset = 'cylinder' | 'airfoil' | 'teardrop' | 'plate' | 'car' | 'custom';
export type VizMode = 'vorticity' | 'speed' | 'pressure';

export interface WindTunnelTelemetry {
  reynolds: number;
  cd: number;
  cl: number;
  dragForce: number;
  liftForce: number;
  characteristicLen: number;
  stepCount: number;
}

export interface SmokeParticle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  lane: number;
}

export const GRID_NX = 220;
export const GRID_NY = 96;

const W0 = 4 / 9;
const W_CARD = 1 / 9;
const W_DIAG = 1 / 36;

export class WindTunnelLBM {
  readonly nx = GRID_NX;
  readonly ny = GRID_NY;
  readonly size = GRID_NX * GRID_NY;

  // Double-buffered D2Q9 populations (screen coords: +x right, +y down)
  private n0: Float32Array;
  private nE: Float32Array;
  private nW: Float32Array;
  private nN: Float32Array;
  private nS: Float32Array;
  private nNE: Float32Array;
  private nNW: Float32Array;
  private nSE: Float32Array;
  private nSW: Float32Array;

  private t0: Float32Array;
  private tE: Float32Array;
  private tW: Float32Array;
  private tN: Float32Array;
  private tS: Float32Array;
  private tNE: Float32Array;
  private tNW: Float32Array;
  private tSE: Float32Array;
  private tSW: Float32Array;

  // Macroscopic fields
  readonly rho: Float32Array;
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly curl: Float32Array;
  readonly barrier: Uint8Array;

  // Wind tunnel parameters
  inletSpeed = 0.105;
  viscosity = 0.012;

  // Obstacle geometry & smoothed aerodynamic forces
  obstacleCenterX = 56;
  obstacleCenterY = Math.floor(GRID_NY / 2);
  characteristicLen = 22;
  frontalHeight = 22;
  private smoothDrag = 0;
  private smoothLift = 0;
  stepCount = 0;

  // Smoke rake tracer particles
  readonly tracers: SmokeParticle[] = [];
  private readonly smokeLanes = 9;

  constructor() {
    const sz = this.size;
    this.n0 = new Float32Array(sz);
    this.nE = new Float32Array(sz);
    this.nW = new Float32Array(sz);
    this.nN = new Float32Array(sz);
    this.nS = new Float32Array(sz);
    this.nNE = new Float32Array(sz);
    this.nNW = new Float32Array(sz);
    this.nSE = new Float32Array(sz);
    this.nSW = new Float32Array(sz);

    this.t0 = new Float32Array(sz);
    this.tE = new Float32Array(sz);
    this.tW = new Float32Array(sz);
    this.tN = new Float32Array(sz);
    this.tS = new Float32Array(sz);
    this.tNE = new Float32Array(sz);
    this.tNW = new Float32Array(sz);
    this.tSE = new Float32Array(sz);
    this.tSW = new Float32Array(sz);

    this.rho = new Float32Array(sz);
    this.ux = new Float32Array(sz);
    this.uy = new Float32Array(sz);
    this.curl = new Float32Array(sz);
    this.barrier = new Uint8Array(sz);

    this.initTracers();
    this.setPreset('cylinder', 0);
    this.resetFlow();
  }

  private initTracers(): void {
    this.tracers.length = 0;
    const perLane = 34;
    for (let lane = 0; lane < this.smokeLanes; lane++) {
      const y0 = this.laneY(lane);
      for (let k = 0; k < perLane; k++) {
        this.tracers.push({
          x: 2 + (k / perLane) * (this.nx - 6),
          y: y0,
          age: Math.random() * 140,
          maxAge: 180 + Math.random() * 80,
          lane,
        });
      }
    }
  }

  private laneY(lane: number): number {
    const span = this.ny * 0.68;
    const top = (this.ny - span) * 0.5;
    return top + (lane / Math.max(1, this.smokeLanes - 1)) * span;
  }

  private setEquilibriumAt(idx: number, rho: number, ux: number, uy: number): void {
    const u2 = 1.5 * (ux * ux + uy * uy);
    const ux3 = 3 * ux;
    const uy3 = 3 * uy;
    const uNE = ux - uy;
    const uNW = -ux - uy;
    const uSE = ux + uy;
    const uSW = -ux + uy;

    this.n0[idx] = W0 * rho * (1 - u2);
    this.nE[idx] = W_CARD * rho * (1 + ux3 + 4.5 * ux * ux - u2);
    this.nW[idx] = W_CARD * rho * (1 - ux3 + 4.5 * ux * ux - u2);
    this.nN[idx] = W_CARD * rho * (1 - uy3 + 4.5 * uy * uy - u2);
    this.nS[idx] = W_CARD * rho * (1 + uy3 + 4.5 * uy * uy - u2);
    this.nNE[idx] = W_DIAG * rho * (1 + 3 * uNE + 4.5 * uNE * uNE - u2);
    this.nNW[idx] = W_DIAG * rho * (1 + 3 * uNW + 4.5 * uNW * uNW - u2);
    this.nSE[idx] = W_DIAG * rho * (1 + 3 * uSE + 4.5 * uSE * uSE - u2);
    this.nSW[idx] = W_DIAG * rho * (1 + 3 * uSW + 4.5 * uSW * uSW - u2);

    this.rho[idx] = rho;
    this.ux[idx] = ux;
    this.uy[idx] = uy;
  }

  resetFlow(): void {
    const u0 = this.inletSpeed;
    for (let y = 0; y < this.ny; y++) {
      for (let x = 0; x < this.nx; x++) {
        const idx = y * this.nx + x;
        // Tiny vertical symmetry-breaking ripple near obstacle kickstarts Kármán vortex shedding smoothly
        const ripple =
          x > 40 && x < 85 ? 0.0012 * Math.sin((y / this.ny) * Math.PI * 3) : 0;
        this.setEquilibriumAt(idx, 1.0, u0, ripple);
        this.curl[idx] = 0;
      }
    }
    this.smoothDrag = 0;
    this.smoothLift = 0;
    this.stepCount = 0;
    this.initTracers();
  }

  clearObstacles(): void {
    this.barrier.fill(0);
    this.recomputeObstacleStats();
  }

  paintObstacle(gx: number, gy: number, brushRadius: number, solid: boolean): void {
    const r2 = brushRadius * brushRadius;
    const minX = Math.max(4, Math.floor(gx - brushRadius));
    const maxX = Math.min(this.nx - 6, Math.ceil(gx + brushRadius));
    const minY = Math.max(4, Math.floor(gy - brushRadius));
    const maxY = Math.min(this.ny - 5, Math.ceil(gy + brushRadius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - gx;
        const dy = y - gy;
        if (dx * dx + dy * dy <= r2) {
          const idx = y * this.nx + x;
          const wasSolid = this.barrier[idx] === 1;
          this.barrier[idx] = solid ? 1 : 0;
          if (!solid && wasSolid) {
            this.setEquilibriumAt(idx, 1.0, this.inletSpeed * 0.4, 0);
          }
        }
      }
    }
    this.recomputeObstacleStats();
  }

  setPreset(preset: ObstaclePreset, angleDeg: number): void {
    this.barrier.fill(0);
    if (preset === 'custom') {
      this.recomputeObstacleStats();
      return;
    }

    const cx = 58;
    const cy = Math.floor(this.ny * 0.5);
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    for (let y = 4; y < this.ny - 4; y++) {
      for (let x = 6; x < this.nx - 8; x++) {
        // Rotate world point into obstacle local frame (positive AoA pitches nose UP -> -y, tail DOWN -> +y)
        const dx = x - cx;
        const dy = y - cy;
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;

        let inside = false;
        if (preset === 'cylinder') {
          const r = 10.5;
          inside = dx * dx + dy * dy <= r * r;
        } else if (preset === 'plate') {
          inside = Math.abs(lx) <= 2.2 && Math.abs(ly) <= 11.5;
        } else if (preset === 'airfoil') {
          // NACA 2415 cambered airfoil, chord = 44 cells
          const chord = 44;
          const u = (lx + chord * 0.35) / chord; // leading edge at u=0, trailing at u=1
          if (u >= 0 && u <= 1) {
            const t = 0.16;
            const yt =
              5 *
              t *
              (0.2969 * Math.sqrt(u) -
                0.126 * u -
                0.3516 * u * u +
                0.2843 * u * u * u -
                0.1015 * u * u * u * u);
            // Camber line (negative screen Y = upward arch)
            const m = 0.03;
            const p = 0.4;
            const yc =
              u < p
                ? (m / (p * p)) * (2 * p * u - u * u)
                : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * u - u * u);
            const yCenter = -yc * chord;
            const halfThick = Math.max(0.8, yt * chord);
            inside = Math.abs(ly - yCenter) <= halfThick;
          }
        } else if (preset === 'teardrop') {
          // Streamlined symmetric teardrop with same thickness as cylinder
          const len = 42;
          const u = (lx + len * 0.3) / len;
          if (u >= 0 && u <= 1) {
            const halfThick = 10.2 * Math.sqrt(u) * Math.pow(1 - u, 0.85) * 1.92;
            inside = Math.abs(ly) <= halfThick;
          }
        } else if (preset === 'car') {
          // Side-view aerodynamic coupe profile (nose facing left into wind)
          const len = 48;
          const u = (lx + len * 0.48) / len; // 0 = front bumper, 1 = rear tail
          if (u >= 0 && u <= 1) {
            const bottomY = 7;
            let topY = 7;
            if (u < 0.22) {
              // Hood slope
              topY = 3 - (u / 0.22) * 5.5;
            } else if (u < 0.45) {
              // Windshield
              const s = (u - 0.22) / 0.23;
              topY = -2.5 - s * 8.5;
            } else if (u < 0.78) {
              // Roofline & fastback
              const s = (u - 0.45) / 0.33;
              topY = -11 + s * s * 6.5;
            } else {
              // Rear deck / spoiler
              const s = (u - 0.78) / 0.22;
              topY = -4.5 + s * 3.5;
            }
            inside = ly >= topY && ly <= bottomY;
          }
        }

        if (inside) {
          this.barrier[y * this.nx + x] = 1;
        }
      }
    }

    this.recomputeObstacleStats();
  }

  private recomputeObstacleStats(): void {
    let minX = this.nx;
    let maxX = 0;
    let minY = this.ny;
    let maxY = 0;
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    for (let y = 0; y < this.ny; y++) {
      for (let x = 0; x < this.nx; x++) {
        if (this.barrier[y * this.nx + x] === 1) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    if (count > 0) {
      this.obstacleCenterX = sumX / count;
      this.obstacleCenterY = sumY / count;
      this.frontalHeight = Math.max(1, maxY - minY + 1);
      this.characteristicLen = Math.max(maxX - minX + 1, maxY - minY + 1);
    } else {
      this.obstacleCenterX = 58;
      this.obstacleCenterY = this.ny * 0.5;
      this.frontalHeight = 20;
      this.characteristicLen = 20;
    }
  }

  step(substeps = 8): void {
    const nx = this.nx;
    const ny = this.ny;
    const u0 = this.inletSpeed;
    // Clamp omega <= 1.94 for strict BGK stability
    const omega = Math.min(1.94, 1 / (3 * this.viscosity + 0.5));
    const oneMinusOmega = 1 - omega;

    let totalFx = 0;
    let totalFy = 0;

    for (let s = 0; s < substeps; s++) {
      this.stepCount++;

      // 1. BGK Collision step across interior fluid cells
      const n0 = this.n0;
      const nE = this.nE;
      const nW = this.nW;
      const nN = this.nN;
      const nS = this.nS;
      const nNE = this.nNE;
      const nNW = this.nNW;
      const nSE = this.nSE;
      const nSW = this.nSW;
      const barrier = this.barrier;

      for (let y = 1; y < ny - 1; y++) {
        const row = y * nx;
        for (let x = 1; x < nx - 1; x++) {
          const i = row + x;
          if (barrier[i] === 1) continue;

          const f0 = n0[i];
          const fE = nE[i];
          const fW = nW[i];
          const fN = nN[i];
          const fS = nS[i];
          const fNE = nNE[i];
          const fNW = nNW[i];
          const fSE = nSE[i];
          const fSW = nSW[i];

          const rho = f0 + fE + fW + fN + fS + fNE + fNW + fSE + fSW;
          if (rho <= 0.05 || !Number.isFinite(rho)) {
            this.setEquilibriumAt(i, 1.0, u0, 0);
            continue;
          }

          let ux = ((fE + fNE + fSE) - (fW + fNW + fSW)) / rho;
          let uy = ((fS + fSE + fSW) - (fN + fNE + fNW)) / rho;

          // Safety velocity cap well below Mach stability ceiling
          const speedSq = ux * ux + uy * uy;
          if (speedSq > 0.14) {
            const k = Math.sqrt(0.14 / speedSq);
            ux *= k;
            uy *= k;
          }

          this.rho[i] = rho;
          this.ux[i] = ux;
          this.uy[i] = uy;

          const u2 = 1.5 * (ux * ux + uy * uy);
          const ux3 = 3 * ux;
          const uy3 = 3 * uy;
          const uNE = ux - uy;
          const uNW = -ux - uy;
          const uSE = ux + uy;
          const uSW = -ux + uy;

          n0[i] = oneMinusOmega * f0 + omega * W0 * rho * (1 - u2);
          nE[i] = oneMinusOmega * fE + omega * W_CARD * rho * (1 + ux3 + 4.5 * ux * ux - u2);
          nW[i] = oneMinusOmega * fW + omega * W_CARD * rho * (1 - ux3 + 4.5 * ux * ux - u2);
          nN[i] = oneMinusOmega * fN + omega * W_CARD * rho * (1 - uy3 + 4.5 * uy * uy - u2);
          nS[i] = oneMinusOmega * fS + omega * W_CARD * rho * (1 + uy3 + 4.5 * uy * uy - u2);
          nNE[i] = oneMinusOmega * fNE + omega * W_DIAG * rho * (1 + 3 * uNE + 4.5 * uNE * uNE - u2);
          nNW[i] = oneMinusOmega * fNW + omega * W_DIAG * rho * (1 + 3 * uNW + 4.5 * uNW * uNW - u2);
          nSE[i] = oneMinusOmega * fSE + omega * W_DIAG * rho * (1 + 3 * uSE + 4.5 * uSE * uSE - u2);
          nSW[i] = oneMinusOmega * fSW + omega * W_DIAG * rho * (1 + 3 * uSW + 4.5 * uSW * uSW - u2);
        }
      }

      // 2. Streaming + Half-way Bounce-Back on Solid Obstacles (with exact momentum exchange)
      const t0 = this.t0;
      const tE = this.tE;
      const tW = this.tW;
      const tN = this.tN;
      const tS = this.tS;
      const tNE = this.tNE;
      const tNW = this.tNW;
      const tSE = this.tSE;
      const tSW = this.tSW;

      let stepFx = 0;
      let stepFy = 0;

      for (let y = 1; y < ny - 1; y++) {
        const row = y * nx;
        const rowUp = (y - 1) * nx;
        const rowDn = (y + 1) * nx;

        for (let x = 1; x < nx - 1; x++) {
          const i = row + x;
          if (barrier[i] === 1) continue;

          t0[i] = n0[i];

          // East (+1, 0)
          const iE = i + 1;
          if (barrier[iE] === 1) {
            const f = nE[i];
            tW[i] = f;
            stepFx += 2 * f;
          } else {
            tE[iE] = nE[i];
          }

          // West (-1, 0)
          const iW = i - 1;
          if (barrier[iW] === 1) {
            const f = nW[i];
            tE[i] = f;
            stepFx -= 2 * f;
          } else {
            tW[iW] = nW[i];
          }

          // North (0, -1)
          const iN = rowUp + x;
          if (barrier[iN] === 1) {
            const f = nN[i];
            tS[i] = f;
            stepFy -= 2 * f;
          } else {
            tN[iN] = nN[i];
          }

          // South (0, +1)
          const iS = rowDn + x;
          if (barrier[iS] === 1) {
            const f = nS[i];
            tN[i] = f;
            stepFy += 2 * f;
          } else {
            tS[iS] = nS[i];
          }

          // North-East (+1, -1)
          const iNE = rowUp + x + 1;
          if (barrier[iNE] === 1) {
            const f = nNE[i];
            tSW[i] = f;
            stepFx += 2 * f;
            stepFy -= 2 * f;
          } else {
            tNE[iNE] = nNE[i];
          }

          // North-West (-1, -1)
          const iNW = rowUp + x - 1;
          if (barrier[iNW] === 1) {
            const f = nNW[i];
            tSE[i] = f;
            stepFx -= 2 * f;
            stepFy -= 2 * f;
          } else {
            tNW[iNW] = nNW[i];
          }

          // South-East (+1, +1)
          const iSE = rowDn + x + 1;
          if (barrier[iSE] === 1) {
            const f = nSE[i];
            tNW[i] = f;
            stepFx += 2 * f;
            stepFy += 2 * f;
          } else {
            tSE[iSE] = nSE[i];
          }

          // South-West (-1, +1)
          const iSW = rowDn + x - 1;
          if (barrier[iSW] === 1) {
            const f = nSW[i];
            tNE[i] = f;
            stepFx -= 2 * f;
            stepFy += 2 * f;
          } else {
            tSW[iSW] = nSW[i];
          }
        }
      }

      // Stream outer boundary edges into adjacent interior cells so x=1, x=nx-2, y=1, y=ny-2 receive fresh inflows
      for (let y = 0; y < ny; y++) {
        // Left inlet (x = 0) -> x = 1
        const iL = y * nx;
        tE[iL + 1] = nE[iL];
        if (y > 0) tNE[(y - 1) * nx + 1] = nNE[iL];
        if (y < ny - 1) tSE[(y + 1) * nx + 1] = nSE[iL];

        // Right outlet (x = nx - 1) -> x = nx - 2
        const iR = y * nx + (nx - 1);
        tW[iR - 1] = nW[iR];
        if (y > 0) tNW[(y - 1) * nx + (nx - 2)] = nNW[iR];
        if (y < ny - 1) tSW[(y + 1) * nx + (nx - 2)] = nSW[iR];
      }
      for (let x = 0; x < nx; x++) {
        // Top wall (y = 0) -> y = 1
        tS[nx + x] = nS[x];
        if (x > 0) tSW[nx + x - 1] = nSW[x];
        if (x < nx - 1) tSE[nx + x + 1] = nSE[x];

        // Bottom wall (y = ny - 1) -> y = ny - 2
        const iB = (ny - 1) * nx + x;
        const rowAbove = (ny - 2) * nx;
        tN[rowAbove + x] = nN[iB];
        if (x > 0) tNW[rowAbove + x - 1] = nNW[iB];
        if (x < nx - 1) tNE[rowAbove + x + 1] = nNE[iB];
      }

      // Swap double buffers
      this.n0 = t0; this.t0 = n0;
      this.nE = tE; this.tE = nE;
      this.nW = tW; this.tW = nW;
      this.nN = tN; this.tN = nN;
      this.nS = tS; this.tS = nS;
      this.nNE = tNE; this.tNE = nNE;
      this.nNW = tNW; this.tNW = nNW;
      this.nSE = tSE; this.tSE = nSE;
      this.nSW = tSW; this.tSW = nSW;

      // 3. Outer Wind Tunnel Boundaries
      // Left inlet (x = 0) & Top/Bottom free-stream walls (y = 0, ny - 1)
      for (let y = 0; y < ny; y++) {
        this.setEquilibriumAt(y * nx, 1.0, u0, 0);
      }
      const botRow = (ny - 1) * nx;
      for (let x = 0; x < nx; x++) {
        this.setEquilibriumAt(x, 1.0, u0, 0);
        this.setEquilibriumAt(botRow + x, 1.0, u0, 0);
      }

      // Right open outflow (x = nx - 1): zero-gradient copy from x = nx - 2
      for (let y = 1; y < ny - 1; y++) {
        const dst = y * nx + (nx - 1);
        const src = dst - 1;
        this.n0[dst] = this.n0[src];
        this.nE[dst] = this.nE[src];
        this.nW[dst] = this.nW[src];
        this.nN[dst] = this.nN[src];
        this.nS[dst] = this.nS[src];
        this.nNE[dst] = this.nNE[src];
        this.nNW[dst] = this.nNW[src];
        this.nSE[dst] = this.nSE[src];
        this.nSW[dst] = this.nSW[src];
        this.rho[dst] = this.rho[src];
        this.ux[dst] = this.ux[src];
        this.uy[dst] = this.uy[src];
      }

      totalFx += stepFx;
      totalFy += stepFy;
    }

    // Exponentially smoothed drag (+x) & upward lift (-y)
    const avgDrag = totalFx / substeps;
    const avgLift = -totalFy / substeps;
    this.smoothDrag = this.smoothDrag * 0.8 + avgDrag * 0.2;
    this.smoothLift = this.smoothLift * 0.8 + avgLift * 0.2;

    // 4. Compute Vorticity (Curl = duy/dx - dux/dy)
    for (let y = 1; y < ny - 1; y++) {
      const row = y * nx;
      for (let x = 1; x < nx - 1; x++) {
        const i = row + x;
        if (this.barrier[i] === 1) {
          this.curl[i] = 0;
        } else {
          this.curl[i] =
            (this.uy[i + 1] - this.uy[i - 1]) - (this.ux[i + nx] - this.ux[i - nx]);
        }
      }
    }

    // 5. Advect smoke rake tracers
    this.advectTracers(substeps);
  }

  private advectTracers(steps: number): void {
    const dt = steps * 1.15;
    for (let i = 0; i < this.tracers.length; i++) {
      const p = this.tracers[i];
      const gx = Math.min(this.nx - 2, Math.max(1, Math.floor(p.x)));
      const gy = Math.min(this.ny - 2, Math.max(1, Math.floor(p.y)));
      const idx = gy * this.nx + gx;

      if (this.barrier[idx] === 1 || p.x >= this.nx - 2 || p.y <= 1 || p.y >= this.ny - 2 || p.age > p.maxAge) {
        p.x = 2 + Math.random() * 2;
        p.y = this.laneY(p.lane) + (Math.random() - 0.5) * 0.7;
        p.age = 0;
      } else {
        p.x += this.ux[idx] * dt;
        p.y += this.uy[idx] * dt;
        p.age += 1;
      }
    }
  }

  getTelemetry(): WindTunnelTelemetry {
    const u0 = this.inletSpeed;
    const qDyn = 0.5 * 1.0 * u0 * u0; // dynamic pressure (rho = 1)
    const cd = qDyn > 1e-6 ? this.smoothDrag / (qDyn * Math.max(1, this.frontalHeight)) : 0;
    const cl = qDyn > 1e-6 ? this.smoothLift / (qDyn * Math.max(1, this.characteristicLen)) : 0;
    const reynolds = (u0 * this.characteristicLen) / Math.max(1e-5, this.viscosity);

    return {
      reynolds,
      cd,
      cl,
      dragForce: this.smoothDrag,
      liftForce: this.smoothLift,
      characteristicLen: this.characteristicLen,
      stepCount: this.stepCount,
    };
  }
}
