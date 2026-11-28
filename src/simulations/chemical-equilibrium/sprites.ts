/**
 * The molecule picture (zero React imports). Each dot stands for a fixed amount of substance
 * (perMol dots per mole). Dots react only as the solver dictates: the net extent of reaction is
 * replayed as forward or reverse events, and at equilibrium matched forward + reverse pairs are
 * shown at the solver's actual (equal) rates, so the picture stays busy while the composition
 * holds still.
 */
import type { ChemSystem, ChemState } from './physics';

export interface Sprite {
  sp: number; // species index
  u: number; // position in the vessel, 0..1
  v: number;
  du: number; // velocity, vessel widths per second
  dv: number;
}

export interface SpriteFlash {
  u: number;
  v: number;
  t: number; // display time it happened [s]
  forward: boolean;
}

const MAX_EVENTS_PER_FRAME = 24;
const MAX_PAIRS_PER_FRAME = 6;

export class SpriteGas {
  sprites: Sprite[] = [];
  flashes: SpriteFlash[] = [];
  readonly perMol: number;
  private shownExtent = 0; // net extent already replayed, in dots
  private pairBudget = 0;

  constructor(sys: ChemSystem, state: ChemState, perMol: number) {
    this.perMol = perMol;
    sys.species.forEach((_, i) => this.spawn(i, Math.round(state.n[i] * perMol)));
    this.shownExtent = Math.round(state.extent * perMol);
  }

  private randomVelocity(): [number, number] {
    const a = Math.random() * Math.PI * 2;
    const s = 0.05 + 0.1 * Math.random();
    return [s * Math.cos(a), s * Math.sin(a)];
  }

  spawn(sp: number, count: number, at?: { u: number; v: number }) {
    for (let k = 0; k < count; k++) {
      const [du, dv] = this.randomVelocity();
      this.sprites.push({
        sp,
        u: at ? Math.min(0.98, Math.max(0.02, at.u + 0.06 * (Math.random() - 0.5))) : 0.03 + 0.94 * Math.random(),
        v: at ? Math.min(0.98, Math.max(0.02, at.v + 0.3 * (Math.random() - 0.5))) : 0.05 + 0.9 * Math.random(),
        du,
        dv,
      });
    }
  }

  remove(sp: number, count: number) {
    for (let k = 0; k < count; k++) {
      const idx: number[] = [];
      this.sprites.forEach((s, i) => s.sp === sp && idx.push(i));
      if (idx.length === 0) return;
      this.sprites.splice(idx[Math.floor(Math.random() * idx.length)], 1);
    }
  }

  count(sp: number): number {
    let c = 0;
    for (const s of this.sprites) if (s.sp === sp) c++;
    return c;
  }

  /** One reaction event: consume reactant dots near a random anchor, release product dots there. */
  private react(sys: ChemSystem, forward: boolean, time: number): boolean {
    const dir = forward ? 1 : -1;
    const consumed = sys.species.map((sp) => Math.max(0, -dir * sp.nu));
    const produced = sys.species.map((sp) => Math.max(0, dir * sp.nu));
    const first = consumed.findIndex((c) => c > 0);
    if (first < 0) return false;
    const candidates = this.sprites.filter((s) => s.sp === first);
    if (candidates.length === 0) return false;
    const anchor = candidates[Math.floor(Math.random() * candidates.length)];
    const chosen = new Set<Sprite>();
    for (let sp = 0; sp < consumed.length; sp++) {
      if (consumed[sp] === 0) continue;
      const pool = this.sprites
        .filter((s) => s.sp === sp && !chosen.has(s))
        .sort((a, b) => (a.u - anchor.u) ** 2 + (a.v - anchor.v) ** 2 - ((b.u - anchor.u) ** 2 + (b.v - anchor.v) ** 2));
      if (pool.length < consumed[sp]) return false;
      for (let k = 0; k < consumed[sp]; k++) chosen.add(pool[k]);
    }
    let cu = 0;
    let cv = 0;
    for (const s of chosen) {
      cu += s.u / chosen.size;
      cv += s.v / chosen.size;
    }
    this.sprites = this.sprites.filter((s) => !chosen.has(s));
    produced.forEach((c, sp) => {
      for (let k = 0; k < c; k++) this.spawn(sp, 1, { u: cu, v: cv });
    });
    this.flashes.push({ u: cu, v: cv, t: time, forward });
    if (this.flashes.length > 80) this.flashes.splice(0, this.flashes.length - 80);
    return true;
  }

  /** Replays the solver's net extent and shows balanced forward/reverse pairs at its rates. */
  sync(sys: ChemSystem, state: ChemState, forwardRate: number, reverseRate: number, dt: number) {
    const target = Math.round(state.extent * this.perMol);
    let events = 0;
    while (this.shownExtent !== target && events < MAX_EVENTS_PER_FRAME) {
      const forward = target > this.shownExtent;
      if (!this.react(sys, forward, state.time)) break;
      this.shownExtent += forward ? 1 : -1;
      events++;
    }
    this.pairBudget = Math.min(3, this.pairBudget + Math.min(forwardRate, reverseRate) * dt * this.perMol);
    let pairs = 0;
    while (this.pairBudget >= 1 && pairs < MAX_PAIRS_PER_FRAME) {
      this.pairBudget -= 1;
      if (this.react(sys, true, state.time)) this.react(sys, false, state.time);
      pairs++;
    }
  }

  /** Random thermal motion; dots move faster when the gas is hotter. */
  move(dt: number, speed: number) {
    for (const s of this.sprites) {
      s.du += (Math.random() - 0.5) * 0.6 * dt;
      s.dv += (Math.random() - 0.5) * 0.6 * dt;
      const sp = Math.hypot(s.du, s.dv);
      if (sp > 0.2) {
        s.du *= 0.2 / sp;
        s.dv *= 0.2 / sp;
      }
      s.u += s.du * dt * speed;
      s.v += s.dv * dt * speed * 1.6;
      if (s.u < 0.02 || s.u > 0.98) {
        s.du = -s.du;
        s.u = Math.min(0.98, Math.max(0.02, s.u));
      }
      if (s.v < 0.04 || s.v > 0.96) {
        s.dv = -s.dv;
        s.v = Math.min(0.96, Math.max(0.04, s.v));
      }
    }
  }
}
