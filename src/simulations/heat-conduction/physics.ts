export type HeatPreset = 'dipole' | 'bimetallic-race' | 'insulated-maze' | 'hot-spot';
export type CellMaterial = 0 | 1 | 2 | 3; // 0=normal/steel, 1=copper(fast), 2=glass(slow), 3=insulator(zero flux)

export interface HeatTelemetry {
  meanTemp: number;
  minTemp: number;
  maxTemp: number;
  thermalSpread: number;
  simTime: number;
}

export const HEAT_NX = 136;
export const HEAT_NY = 84;

// Normalized diffusivity multipliers (kept strictly within explicit 2D CFL limit: dt * alpha <= 0.24)
const MATERIAL_ALPHA: Record<CellMaterial, number> = {
  0: 0.10, // Steel / default
  1: 0.22, // Copper (high thermal diffusivity)
  2: 0.02, // Glass (low thermal diffusivity)
  3: 0.0, // Adiabatic insulator wall
};

export class HeatEquation2D {
  readonly nx = HEAT_NX;
  readonly ny = HEAT_NY;
  readonly size = HEAT_NX * HEAT_NY;

  temp: Float32Array;
  private nextTemp: Float32Array;
  material: Uint8Array;
  // Fixed Dirichlet boundary/source cells: NaN means free evolving cell, finite number means clamped temperature
  fixedTemp: Float32Array;

  diffusivityScale = 1.0;
  simTime = 0;

  constructor() {
    this.temp = new Float32Array(this.size);
    this.nextTemp = new Float32Array(this.size);
    this.material = new Uint8Array(this.size);
    this.fixedTemp = new Float32Array(this.size);
    this.loadPreset('dipole');
  }

  private clearAll(ambient = 20): void {
    this.temp.fill(ambient);
    this.nextTemp.fill(ambient);
    this.material.fill(0);
    this.fixedTemp.fill(Number.NaN);
    this.simTime = 0;
  }

  loadPreset(preset: HeatPreset): void {
    this.clearAll(22);
    const nx = this.nx;
    const ny = this.ny;

    if (preset === 'dipole') {
      // Hot left reservoir (100 C), cold right sink (0 C), central insulating baffle with gap
      for (let y = 10; y < ny - 10; y++) {
        for (let x = 6; x < 12; x++) {
          const i = y * nx + x;
          this.fixedTemp[i] = 100;
          this.temp[i] = 100;
        }
        for (let x = nx - 12; x < nx - 6; x++) {
          const i = y * nx + x;
          this.fixedTemp[i] = 0;
          this.temp[i] = 0;
        }
      }
      // Small insulating baffle in the center to bend heat flux lines visibly
      for (let y = 20; y < ny - 20; y++) {
        if (Math.abs(y - ny / 2) < 9) continue; // center bridge opening
        for (let x = Math.floor(nx / 2) - 2; x <= Math.floor(nx / 2) + 2; x++) {
          this.material[y * nx + x] = 3;
        }
      }
    } else if (preset === 'bimetallic-race') {
      // Top bar: Copper (fast), Middle bar: Steel (medium), Bottom bar: Glass (slow)
      // Separated by horizontal adiabatic insulator dividers, heated equally on the left!
      const div1 = Math.floor(ny / 3);
      const div2 = Math.floor((2 * ny) / 3);

      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const i = y * nx + x;
          if (Math.abs(y - div1) <= 1 || Math.abs(y - div2) <= 1) {
            this.material[i] = 3; // insulator separator
          } else if (y < div1) {
            this.material[i] = 1; // Copper
          } else if (y < div2) {
            this.material[i] = 0; // Steel
          } else {
            this.material[i] = 2; // Glass
          }

          if (x < 7 && this.material[i] !== 3) {
            this.fixedTemp[i] = 100;
            this.temp[i] = 100;
          }
        }
      }
    } else if (preset === 'insulated-maze') {
      // Hot core in left chamber diffusing through staggered insulating baffles to a cold sink
      for (let y = 28; y < ny - 28; y++) {
        for (let x = 6; x < 14; x++) {
          const i = y * nx + x;
          this.fixedTemp[i] = 100;
          this.temp[i] = 100;
        }
      }
      for (let y = 16; y < ny - 16; y++) {
        for (let x = nx - 12; x < nx - 6; x++) {
          const i = y * nx + x;
          this.fixedTemp[i] = 0;
          this.temp[i] = 0;
        }
      }
      // Staggered baffles
      for (let y = 0; y < Math.floor(ny * 0.68); y++) {
        for (let x = 44; x < 48; x++) this.material[y * nx + x] = 3;
      }
      for (let y = Math.floor(ny * 0.32); y < ny; y++) {
        for (let x = 86; x < 90; x++) this.material[y * nx + x] = 3;
      }
    } else if (preset === 'hot-spot') {
      // Gaussian hot pulse in center with no fixed sources -> decays smoothly to uniform equilibrium!
      const cx = nx * 0.5;
      const cy = ny * 0.5;
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          this.temp[y * nx + x] = 15 + 85 * Math.exp(-d2 / 140);
        }
      }
    }
  }

  paint(
    gx: number,
    gy: number,
    radius: number,
    brush: 'heat' | 'cold' | 'insulator' | 'copper' | 'clear',
  ): void {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(gx - radius));
    const maxX = Math.min(this.nx - 1, Math.ceil(gx + radius));
    const minY = Math.max(0, Math.floor(gy - radius));
    const maxY = Math.min(this.ny - 1, Math.ceil(gy + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - gx;
        const dy = y - gy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * this.nx + x;
        if (brush === 'heat') {
          this.material[i] = this.material[i] === 3 ? 0 : this.material[i];
          this.fixedTemp[i] = 100;
          this.temp[i] = 100;
        } else if (brush === 'cold') {
          this.material[i] = this.material[i] === 3 ? 0 : this.material[i];
          this.fixedTemp[i] = 0;
          this.temp[i] = 0;
        } else if (brush === 'insulator') {
          this.fixedTemp[i] = Number.NaN;
          this.material[i] = 3;
        } else if (brush === 'copper') {
          this.material[i] = 1;
        } else if (brush === 'clear') {
          this.fixedTemp[i] = Number.NaN;
          this.material[i] = 0;
        }
      }
    }
  }

  step(substeps = 6): void {
    const nx = this.nx;
    const ny = this.ny;
    const scale = Math.min(1.05, Math.max(0.1, this.diffusivityScale));

    for (let s = 0; s < substeps; s++) {
      const T = this.temp;
      const out = this.nextTemp;
      const mat = this.material;
      const fixed = this.fixedTemp;

      for (let y = 0; y < ny; y++) {
        const row = y * nx;
        for (let x = 0; x < nx; x++) {
          const i = row + x;

          // Clamped heat source / sink
          if (!Number.isNaN(fixed[i])) {
            out[i] = fixed[i];
            continue;
          }

          // Insulator conducts zero heat
          const m = mat[i] as CellMaterial;
          if (m === 3) {
            out[i] = T[i];
            continue;
          }

          const tc = T[i];
          const aCenter = MATERIAL_ALPHA[m] * scale;
          let fluxSum = 0;

          // Conservative interface flux with zero-flux (Neumann) outer boundaries & insulators
          // Left
          if (x > 0 && mat[i - 1] !== 3) {
            const aN = MATERIAL_ALPHA[mat[i - 1] as CellMaterial] * scale;
            const aEff = (2 * aCenter * aN) / Math.max(1e-6, aCenter + aN);
            fluxSum += aEff * (T[i - 1] - tc);
          }
          // Right
          if (x < nx - 1 && mat[i + 1] !== 3) {
            const aN = MATERIAL_ALPHA[mat[i + 1] as CellMaterial] * scale;
            const aEff = (2 * aCenter * aN) / Math.max(1e-6, aCenter + aN);
            fluxSum += aEff * (T[i + 1] - tc);
          }
          // Up
          if (y > 0 && mat[i - nx] !== 3) {
            const aN = MATERIAL_ALPHA[mat[i - nx] as CellMaterial] * scale;
            const aEff = (2 * aCenter * aN) / Math.max(1e-6, aCenter + aN);
            fluxSum += aEff * (T[i - nx] - tc);
          }
          // Down
          if (y < ny - 1 && mat[i + nx] !== 3) {
            const aN = MATERIAL_ALPHA[mat[i + nx] as CellMaterial] * scale;
            const aEff = (2 * aCenter * aN) / Math.max(1e-6, aCenter + aN);
            fluxSum += aEff * (T[i + nx] - tc);
          }

          out[i] = tc + fluxSum;
        }
      }

      // Swap buffers
      this.temp = out;
      this.nextTemp = T;
      this.simTime += 0.05;
    }
  }

  getTelemetry(): HeatTelemetry {
    let sum = 0;
    let count = 0;
    let minT = Infinity;
    let maxT = -Infinity;

    for (let i = 0; i < this.size; i++) {
      if (this.material[i] === 3) continue;
      const v = this.temp[i];
      sum += v;
      count++;
      if (v < minT) minT = v;
      if (v > maxT) maxT = v;
    }

    const meanTemp = count > 0 ? sum / count : 20;
    return {
      meanTemp,
      minTemp: Number.isFinite(minT) ? minT : 20,
      maxTemp: Number.isFinite(maxT) ? maxT : 20,
      thermalSpread: Number.isFinite(maxT - minT) ? maxT - minT : 0,
      simTime: this.simTime,
    };
  }
}
