export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Maps a normalized value t in [0, 1] to a dark-lab thermal color:
 * cold deep cyan-blue -> sky -> amber -> hot coral-red.
 */
export function thermalColor(t: number): string {
  return thermalRgba(t, 1);
}

export function thermalRgba(t: number, alpha: number): string {
  const c = clamp(t, 0, 1);
  let r: number;
  let g: number;
  let b: number;
  if (c < 0.35) {
    const u = c / 0.35;
    r = Math.round(lerp(56, 56, u));
    g = Math.round(lerp(130, 200, u));
    b = Math.round(lerp(246, 248, u));
  } else if (c < 0.7) {
    const u = (c - 0.35) / 0.35;
    r = Math.round(lerp(56, 245, u));
    g = Math.round(lerp(200, 175, u));
    b = Math.round(lerp(248, 45, u));
  } else {
    const u = (c - 0.7) / 0.3;
    r = Math.round(lerp(245, 251, u));
    g = Math.round(lerp(175, 90, u));
    b = Math.round(lerp(45, 110, u));
  }
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Configures an HTML canvas for crisp HiDPI rendering and returns logical CSS dimensions.
 */
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
): { width: number; height: number; dpr: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const targetW = Math.floor(width * dpr);
  const targetH = Math.floor(height * dpr);

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  return { width, height, dpr };
}
