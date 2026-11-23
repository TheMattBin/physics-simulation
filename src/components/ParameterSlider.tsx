interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  precision?: number;
  accent?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function ParameterSlider({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  precision = 2,
  hint,
  disabled = false,
  onChange,
}: ParameterSliderProps) {
  return (
    <div className={`space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        <span className="font-mono text-xs tabular-nums text-sky-300">
          {value.toFixed(precision)}
          {unit ? <span className="ml-0.5 text-slate-500">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="lab-slider w-full"
      />
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}
