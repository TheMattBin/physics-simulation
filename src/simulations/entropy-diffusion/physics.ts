export type EntropyScenario = 'free-expansion' | 'thermal-mixing' | 'species-mixing';

export interface GasChamberConfig {
  count: number;
  width: number;
  height: number;
  radius: number;
  temperature: number; // dimensionless T scale
  scenario: EntropyScenario;
}

export interface GasTelemetry {
  entropyNormalized: number; // 0 to 1 (Shannon spatial entropy / ln(gridCells))
  entropyBits: number; // Shannon entropy in nats/k_B
  leftFraction: number;
  meanTempLeft: number;
  meanTempRight: number;
  pressure: number;
  meanSpeed: number;
  speedBins: number[];
  maxBinSpeed: number;
}

const ENTROPY_GRID_X = 8;
const ENTROPY_GRID_Y = 4;
const SPEED_BINS = 18;

export class GasChamberSimulation {
  count = 0;
  width: number;
  height: number;
  radius: number;
  partitionClosed = true;
  time = 0;

  x = new Float32Array(0);
  y = new Float32Array(0);
  vx = new Float32Array(0);
  vy = new Float32Array(0);
  species = new Uint8Array(0); // 0 = left/hot, 1 = right/cold

  private wallImpulseAccum = 0;
  private impulseWindowTime = 0;
  private lastPressure = 0;

  // Spatial hashing buffers
  private cellSize = 14;
  private gridCols = 1;
  private gridRows = 1;
  private cellHead = new Int32Array(0);
  private particleNext = new Int32Array(0);

  constructor(config: GasChamberConfig) {
    this.width = config.width;
    this.height = config.height;
    this.radius = config.radius;
    this.reset(config);
  }

  reset(config: GasChamberConfig): void {
    this.count = config.count;
    this.width = config.width;
    this.height = config.height;
    this.radius = config.radius;
    this.partitionClosed = true;
    this.time = 0;
    this.wallImpulseAccum = 0;
    this.impulseWindowTime = 0;
    this.lastPressure = 0;

    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
    this.species = new Uint8Array(this.count);

    this.cellSize = Math.max(this.radius * 2.4, 12);
    this.gridCols = Math.max(1, Math.ceil(this.width / this.cellSize));
    this.gridRows = Math.max(1, Math.ceil(this.height / this.cellSize));
    this.cellHead = new Int32Array(this.gridCols * this.gridRows);
    this.particleNext = new Int32Array(this.count);

    const midX = this.width * 0.5;
    const pad = this.radius * 2.2;
    const baseSpeed = Math.sqrt(config.temperature) * 145;

    for (let i = 0; i < this.count; i++) {
      let isRight = false;
      let speedScale = 1;

      if (config.scenario === 'free-expansion') {
        isRight = false;
        this.species[i] = 0;
      } else if (config.scenario === 'thermal-mixing') {
        isRight = i >= Math.floor(this.count / 2);
        this.species[i] = isRight ? 1 : 0;
        speedScale = isRight ? 0.45 : 1.55;
      } else {
        // species-mixing: equal temperature, two tagged species
        isRight = i >= Math.floor(this.count / 2);
        this.species[i] = isRight ? 1 : 0;
      }

      const xMin = isRight ? midX + pad : pad;
      const xMax = isRight ? this.width - pad : midX - pad;

      // Place with light rejection sampling to minimize initial overlaps
      let px = xMin + Math.random() * Math.max(1, xMax - xMin);
      let py = pad + Math.random() * Math.max(1, this.height - 2 * pad);
      for (let attempt = 0; attempt < 10; attempt++) {
        let overlap = false;
        const minDistSq = (this.radius * 2.1) ** 2;
        for (let j = Math.max(0, i - 60); j < i; j++) {
          const dx = px - this.x[j];
          const dy = py - this.y[j];
          if (dx * dx + dy * dy < minDistSq) {
            overlap = true;
            break;
          }
        }
        if (!overlap) break;
        px = xMin + Math.random() * Math.max(1, xMax - xMin);
        py = pad + Math.random() * Math.max(1, this.height - 2 * pad);
      }

      this.x[i] = px;
      this.y[i] = py;

      // Sample velocity from 2D Maxwell-Boltzmann (Gaussian components via Box-Muller)
      const u1 = Math.max(1e-6, Math.random());
      const u2 = Math.random();
      const mag = Math.sqrt(-2 * Math.log(u1));
      const sigma = baseSpeed * speedScale * 0.7;
      this.vx[i] = mag * Math.cos(2 * Math.PI * u2) * sigma;
      this.vy[i] = mag * Math.sin(2 * Math.PI * u2) * sigma;
    }
  }

  reverseVelocities(): void {
    for (let i = 0; i < this.count; i++) {
      this.vx[i] = -this.vx[i];
      this.vy[i] = -this.vy[i];
    }
  }

  scaleTemperature(factor: number): void {
    const s = Math.sqrt(Math.max(0.05, factor));
    for (let i = 0; i < this.count; i++) {
      this.vx[i] *= s;
      this.vy[i] *= s;
    }
  }

  step(dt: number): void {
    const substeps = 2;
    const h = dt / substeps;
    const r = this.radius;
    const midX = this.width * 0.5;
    const minDist = 2 * r;
    const minDistSq = minDist * minDist;

    for (let sub = 0; sub < substeps; sub++) {
      this.time += h;
      this.impulseWindowTime += h;

      // 1. Drift & Wall Collisions
      for (let i = 0; i < this.count; i++) {
        const prevX = this.x[i];
        let nx = prevX + this.vx[i] * h;
        let ny = this.y[i] + this.vy[i] * h;

        if (nx < r) {
          nx = r;
          this.wallImpulseAccum += Math.abs(2 * this.vx[i]);
          this.vx[i] = Math.abs(this.vx[i]);
        } else if (nx > this.width - r) {
          nx = this.width - r;
          this.wallImpulseAccum += Math.abs(2 * this.vx[i]);
          this.vx[i] = -Math.abs(this.vx[i]);
        }

        if (ny < r) {
          ny = r;
          this.wallImpulseAccum += Math.abs(2 * this.vy[i]);
          this.vy[i] = Math.abs(this.vy[i]);
        } else if (ny > this.height - r) {
          ny = this.height - r;
          this.wallImpulseAccum += Math.abs(2 * this.vy[i]);
          this.vy[i] = -Math.abs(this.vy[i]);
        }

        // Central removable partition
        if (this.partitionClosed) {
          if (prevX <= midX && nx > midX - r) {
            nx = midX - r;
            this.vx[i] = -Math.abs(this.vx[i]);
          } else if (prevX >= midX && nx < midX + r) {
            nx = midX + r;
            this.vx[i] = Math.abs(this.vx[i]);
          }
        }

        this.x[i] = nx;
        this.y[i] = ny;
      }

      // 2. Spatial Hash Build
      this.cellHead.fill(-1);
      const cols = this.gridCols;
      const rows = this.gridRows;
      const invCell = 1 / this.cellSize;

      for (let i = 0; i < this.count; i++) {
        const cx = Math.min(cols - 1, Math.max(0, Math.floor(this.x[i] * invCell)));
        const cy = Math.min(rows - 1, Math.max(0, Math.floor(this.y[i] * invCell)));
        const cellIdx = cy * cols + cx;
        this.particleNext[i] = this.cellHead[cellIdx];
        this.cellHead[cellIdx] = i;
      }

      // 3. Elastic Pairwise Collisions via Neighbor Cells
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const cellIdx = cy * cols + cx;
          for (let i = this.cellHead[cellIdx]; i !== -1; i = this.particleNext[i]) {
            for (let oy = -1; oy <= 1; oy++) {
              const ny = cy + oy;
              if (ny < 0 || ny >= rows) continue;
              for (let ox = -1; ox <= 1; ox++) {
                const nx = cx + ox;
                if (nx < 0 || nx >= cols) continue;
                const nIdx = ny * cols + nx;
                for (let j = this.cellHead[nIdx]; j !== -1; j = this.particleNext[j]) {
                  if (j <= i) continue;

                  const dx = this.x[j] - this.x[i];
                  const dy = this.y[j] - this.y[i];
                  const distSq = dx * dx + dy * dy;
                  if (distSq >= minDistSq || distSq < 1e-9) continue;

                  const dist = Math.sqrt(distSq);
                  const nxNorm = dx / dist;
                  const nyNorm = dy / dist;

                  // Separate overlap equally
                  const overlap = 0.5 * (minDist - dist);
                  this.x[i] -= nxNorm * overlap;
                  this.y[i] -= nyNorm * overlap;
                  this.x[j] += nxNorm * overlap;
                  this.y[j] += nyNorm * overlap;

                  // Elastic impulse along normal (equal mass)
                  const dvx = this.vx[j] - this.vx[i];
                  const dvy = this.vy[j] - this.vy[i];
                  const vn = dvx * nxNorm + dvy * nyNorm;
                  if (vn < 0) {
                    this.vx[i] += vn * nxNorm;
                    this.vy[i] += vn * nyNorm;
                    this.vx[j] -= vn * nxNorm;
                    this.vy[j] -= vn * nyNorm;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (this.impulseWindowTime >= 0.25) {
      const perimeter = 2 * (this.width + this.height);
      this.lastPressure = this.wallImpulseAccum / (this.impulseWindowTime * perimeter);
      this.wallImpulseAccum = 0;
      this.impulseWindowTime = 0;
    }
  }

  computeTelemetry(): GasTelemetry {
    const n = Math.max(1, this.count);
    const totalCells = ENTROPY_GRID_X * ENTROPY_GRID_Y;
    const cellCounts = new Int32Array(totalCells);
    const cellSpecies0 = new Int32Array(totalCells);
    const cellSpecies1 = new Int32Array(totalCells);

    let leftCount = 0;
    let keLeft = 0;
    let keRight = 0;
    let rightCount = 0;
    let speedSum = 0;
    const maxBinSpeed = 420;
    const speedBins = new Array<number>(SPEED_BINS).fill(0);

    const midX = this.width * 0.5;
    let hasSpecies1 = false;

    for (let i = 0; i < this.count; i++) {
      const px = this.x[i];
      const py = this.y[i];
      const v2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      const v = Math.sqrt(v2);
      speedSum += v;

      const bin = Math.min(SPEED_BINS - 1, Math.floor((v / maxBinSpeed) * SPEED_BINS));
      speedBins[bin]++;

      if (px < midX) {
        leftCount++;
        keLeft += 0.5 * v2;
      } else {
        rightCount++;
        keRight += 0.5 * v2;
      }

      const gx = Math.min(ENTROPY_GRID_X - 1, Math.max(0, Math.floor((px / this.width) * ENTROPY_GRID_X)));
      const gy = Math.min(ENTROPY_GRID_Y - 1, Math.max(0, Math.floor((py / this.height) * ENTROPY_GRID_Y)));
      const idx = gy * ENTROPY_GRID_X + gx;
      cellCounts[idx]++;
      if (this.species[i] === 0) cellSpecies0[idx]++;
      else {
        cellSpecies1[idx]++;
        hasSpecies1 = true;
      }
    }

    // Coarse-grained Shannon/Boltzmann spatial entropy (includes mixing entropy if 2 species)
    let entropy = 0;
    let maxEntropy = Math.log(totalCells);

    if (hasSpecies1) {
      // Joint cell+species entropy minus initial species split gives clean mixing + spatial measure
      let s0Total = 0;
      let s1Total = 0;
      for (let i = 0; i < totalCells; i++) {
        s0Total += cellSpecies0[i];
        s1Total += cellSpecies1[i];
      }
      let h0 = 0;
      let h1 = 0;
      for (let i = 0; i < totalCells; i++) {
        if (cellSpecies0[i] > 0 && s0Total > 0) {
          const p = cellSpecies0[i] / s0Total;
          h0 -= p * Math.log(p);
        }
        if (cellSpecies1[i] > 0 && s1Total > 0) {
          const p = cellSpecies1[i] / s1Total;
          h1 -= p * Math.log(p);
        }
      }
      entropy = 0.5 * (h0 + h1);
    } else {
      for (let i = 0; i < totalCells; i++) {
        if (cellCounts[i] > 0) {
          const p = cellCounts[i] / n;
          entropy -= p * Math.log(p);
        }
      }
    }

    const tempScale = 1 / 12000;
    return {
      entropyNormalized: Math.min(1, Math.max(0, entropy / maxEntropy)),
      entropyBits: entropy,
      leftFraction: leftCount / n,
      meanTempLeft: leftCount > 0 ? (keLeft / leftCount) * tempScale : 0,
      meanTempRight: rightCount > 0 ? (keRight / rightCount) * tempScale : 0,
      pressure: this.lastPressure,
      meanSpeed: speedSum / n,
      speedBins,
      maxBinSpeed,
    };
  }
}
