interface LogSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
}

const STEPS = 400;

/** Slider over a logarithmic range (for quantities spanning decades), styled like ParameterSlider. */
export function LogSlider({ label, value, min, max, format, hint, onChange }: LogSliderProps) {
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const pos = Math.round(((Math.log10(value) - lo) / (hi - lo)) * STEPS);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="font-mono text-xs tabular-nums text-sky-300">{format(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={Math.max(0, Math.min(STEPS, pos))}
        onChange={(e) => {
          const v = 10 ** (lo + (parseFloat(e.target.value) / STEPS) * (hi - lo));
          onChange(Number(v.toPrecision(3)));
        }}
        className="lab-slider w-full"
      />
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}
