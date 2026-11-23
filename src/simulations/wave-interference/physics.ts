export type WavePreset = 'double-slit' | 'two-sources' | 'single-slit' | 'refraction';

export interface WaveTelemetry {
  wavelengthPx: number;
  frequencyHz: number;
  slitSeparation: number;
  fringeSpacing: number;
  peakIntensity: number;
}

export const WAVE_NX = 180;
export const WAVE_NY = 112;

export class WaveTank2D {
  readonly nx = WAVE_NX;
  readonly ny = WAVE_NY;
  readonly size = WAVE_NX * WAVE_NY;

  u: Float32Array;
  private uPrev: Float32Array;
  private uNext: Float32Array;
  // Local wave speed c (default 0.45; slower inside refractive glass medium)
  cField: Float32Array;
  barrier: Uint8Array;
  // Time-averaged intensity at the right detector screen (x = nx - 12)
  detectorIntensity: Float32Array;
  private detectorInstant: Float32Array;

  preset: WavePreset = 'double-slit';
  frequency = 0.055; // cycles/step -> lambda ~ 8.4 cells (smooth, dispersion-free FDTD)
  slitSeparation = 24; // grid cells
  slitWidth = 6; // grid cells
  phaseOffsetDeg = 0;
  refractiveIndex = 1.6;
  timeStep = 0;

  private readonly barrierX = 62;
  private readonly detectorX = WAVE_NX - 14;

  constructor() {
    this.u = new Float32Array(this.size);
    this.uPrev = new Float32Array(this.size);
    this.uNext = new Float32Array(this.size);
    this.cField = new Float32Array(this.size);
    this.barrier = new Uint8Array(this.size);
    this.detectorIntensity = new Float32Array(this.ny);
    this.detectorInstant = new Float32Array(this.ny);

    this.configure('double-slit');
  }

  configure(preset = this.preset): void {
    this.preset = preset;
    this.u.fill(0);
    this.uPrev.fill(0);
    this.uNext.fill(0);
    this.barrier.fill(0);
    this.cField.fill(0.46); // Courant number <= 0.46 < 0.707 -> strictly stable
    this.detectorIntensity.fill(0);
    this.detectorInstant.fill(0);
    this.timeStep = 0;

    const nx = this.nx;
    const ny = this.ny;
    const midY = Math.floor(ny / 2);

    if (preset === 'double-slit') {
      const halfSep = Math.floor(this.slitSeparation / 2);
      const halfW = Math.max(2, Math.floor(this.slitWidth / 2));
      for (let y = 0; y < ny; y++) {
        const inSlit1 = Math.abs(y - (midY - halfSep)) <= halfW;
        const inSlit2 = Math.abs(y - (midY + halfSep)) <= halfW;
        if (!inSlit1 && !inSlit2) {
          this.barrier[y * nx + this.barrierX] = 1;
          this.barrier[y * nx + this.barrierX + 1] = 1;
        }
      }
    } else if (preset === 'single-slit') {
      const halfW = Math.max(2, Math.floor(this.slitWidth / 2));
      for (let y = 0; y < ny; y++) {
        if (Math.abs(y - midY) > halfW) {
          this.barrier[y * nx + this.barrierX] = 1;
          this.barrier[y * nx + this.barrierX + 1] = 1;
        }
      }
    } else if (preset === 'refraction') {
      // Tilted glass slab / convex prism interface on the right side with speed c / n
      const slowC = 0.46 / Math.max(1.0, this.refractiveIndex);
      for (let y = 0; y < ny; y++) {
        // Angled dielectric interface so plane waves visibly bend via Snell's Law
        const interfaceX = 72 + (y - midY) * 0.48;
        for (let x = 0; x < nx; x++) {
          if (x >= interfaceX) {
            this.cField[y * nx + x] = slowC;
          }
        }
      }
    }
  }

  dropRipple(gx: number, gy: number, strength = 1.6): void {
    const r = 3.2;
    const minX = Math.max(3, Math.floor(gx - r));
    const maxX = Math.min(this.nx - 4, Math.ceil(gx + r));
    const minY = Math.max(3, Math.floor(gy - r));
    const maxY = Math.min(this.ny - 4, Math.ceil(gy + r));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d2 = (x - gx) * (x - gx) + (y - gy) * (y - gy);
        const idx = y * this.nx + x;
        if (this.barrier[idx] === 0) {
          this.u[idx] += strength * Math.exp(-d2 / 3.5);
        }
      }
    }
  }

  step(substeps = 2): void {
    const nx = this.nx;
    const ny = this.ny;
    const omega = this.frequency * Math.PI * 2;
    const phaseRad = (this.phaseOffsetDeg * Math.PI) / 180;
    const midY = Math.floor(ny / 2);

    for (let s = 0; s < substeps; s++) {
      this.timeStep++;
      const t = this.timeStep;

      // 1. Inject continuous wave sources
      if (this.preset === 'double-slit' || this.preset === 'single-slit') {
        // Planar wave emitter near left edge
        const drive = Math.sin(omega * t) * 1.45;
        for (let y = 8; y < ny - 8; y++) {
          this.u[y * nx + 10] = drive;
        }
      } else if (this.preset === 'refraction') {
        // Plane wave beam on left
        const drive = Math.sin(omega * t) * 1.35;
        for (let y = 14; y < ny - 14; y++) {
          this.u[y * nx + 10] = drive;
        }
      } else if (this.preset === 'two-sources') {
        const halfSep = Math.floor(this.slitSeparation / 2);
        const s1y = Math.max(10, midY - halfSep);
        const s2y = Math.min(ny - 11, midY + halfSep);
        const sx = 46;
        this.u[s1y * nx + sx] = Math.sin(omega * t) * 2.5;
        this.u[s2y * nx + sx] = Math.sin(omega * t + phaseRad) * 2.5;
      }

      // 2. 2D FDTD Wave Equation Update with Sponge Absorbing Edges
      const u = this.u;
      const uPrev = this.uPrev;
      const uNext = this.uNext;
      const cField = this.cField;
      const barrier = this.barrier;

      for (let y = 1; y < ny - 1; y++) {
        const row = y * nx;
        const edgeDistY = Math.min(y, ny - 1 - y);

        for (let x = 1; x < nx - 1; x++) {
          const i = row + x;
          if (barrier[i] === 1) {
            uNext[i] = 0;
            continue;
          }

          const c = cField[i];
          const r2 = c * c;
          const laplacian = u[i - 1] + u[i + 1] + u[i - nx] + u[i + nx] - 4 * u[i];

          // Gentle absorbing sponge within 8 cells of outer tank boundary
          const edgeDist = Math.min(edgeDistY, x, nx - 1 - x);
          const damping = edgeDist < 8 ? 0.92 + 0.08 * (edgeDist / 8) : 0.9995;

          uNext[i] = (2 * u[i] - uPrev[i] + r2 * laplacian) * damping;
        }
      }

      // Swap ring of 3 buffers
      this.uPrev = u;
      this.u = uNext;
      this.uNext = uPrev;

      // 3. Accumulate RMS intensity along right detector screen
      for (let y = 0; y < ny; y++) {
        const amp = this.u[y * nx + this.detectorX];
        const energy = amp * amp;
        this.detectorInstant[y] = energy;
        this.detectorIntensity[y] = this.detectorIntensity[y] * 0.97 + energy * 0.03;
      }
    }
  }

  getTelemetry(): WaveTelemetry {
    const c = 0.46;
    const wavelengthPx = c / Math.max(0.01, this.frequency);
    const L = this.detectorX - this.barrierX;
    const fringeSpacing = (wavelengthPx * L) / Math.max(1, this.slitSeparation);

    let peak = 0;
    for (let y = 6; y < this.ny - 6; y++) {
      if (this.detectorIntensity[y] > peak) peak = this.detectorIntensity[y];
    }

    return {
      wavelengthPx,
      frequencyHz: this.frequency * 60,
      slitSeparation: this.slitSeparation,
      fringeSpacing,
      peakIntensity: peak,
    };
  }
}
