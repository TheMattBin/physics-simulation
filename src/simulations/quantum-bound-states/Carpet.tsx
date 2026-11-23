import { useEffect, useRef } from 'react';
import { syncCanvasSize } from '../../engine/math';

export interface CarpetData {
  rows: number;
  cols: number;
  density: Float32Array; // rows × cols, row 0 is t = 0
  max: number;
  period: number; // fs covered from top to bottom
  xMin: number;
  xMax: number;
}

interface CarpetProps {
  data: CarpetData;
  t: number;
  height?: number;
}

/** Space-time picture of |ψ(x, t)|²: x across, time running downward, with a cursor at now. */
export function Carpet({ data, t, height = 170 }: CarpetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);

  // Rasterize the carpet once per state.
  useEffect(() => {
    const img = document.createElement('canvas');
    img.width = data.cols;
    img.height = data.rows;
    const ictx = img.getContext('2d');
    if (!ictx) return;
    const pixels = ictx.createImageData(data.cols, data.rows);
    for (let i = 0; i < data.rows * data.cols; i++) {
      const v = Math.pow(Math.min(1, data.density[i] / (data.max || 1)), 0.6);
      // dark navy → lime → near-white
      const a = Math.min(1, v * 1.6);
      const b = Math.max(0, v * 1.6 - 0.6);
      pixels.data[4 * i] = 7 + (163 - 7) * a + (240 - 163) * b;
      pixels.data[4 * i + 1] = 11 + (230 - 11) * a + (253 - 230) * b;
      pixels.data[4 * i + 2] = 20 + (53 - 20) * a + (220 - 53) * b;
      pixels.data[4 * i + 3] = 255;
    }
    ictx.putImageData(pixels, 0, 0);
    imageRef.current = img;
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const { width, height: h, dpr } = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, width, h);
    const padL = 40;
    const padR = 8;
    const padT = 6;
    const padB = 18;
    const pw = width - padL - padR;
    const ph = h - padT - padB;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, padL, padT, pw, ph);

    const frac = data.period > 0 ? (t % data.period) / data.period : 0;
    const y = padT + frac * ph;
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + pw, y);
    ctx.stroke();

    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0 fs', padL - 5, padT);
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${data.period.toFixed(1)}`, padL - 5, padT + ph);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(`${data.xMin.toFixed(1)} nm`, padL, padT + ph + 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${data.xMax.toFixed(1)} nm`, padL + pw, padT + ph + 4);
    ctx.restore();
  }, [data, t]);

  return (
    <div className="rounded-xl border border-slate-800/90 bg-[#0a0f1c] p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-slate-200">
          Space-time picture |ψ(x, t)|²
        </h4>
        <span className="font-mono text-[10px] text-slate-500">time runs down · pink line = now</span>
      </div>
      <canvas ref={canvasRef} style={{ height }} className="w-full rounded-lg border border-slate-800/70" />
    </div>
  );
}
