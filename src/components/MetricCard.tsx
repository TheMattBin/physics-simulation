interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  sublabel?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  color = '#38bdf8',
  sublabel,
}: MetricCardProps) {
  return (
    <div className="rounded-lg border border-slate-800/90 bg-[#080d18] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}80` }}
        />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-base font-semibold tabular-nums text-slate-100">
          {value}
        </span>
        {unit && <span className="font-mono text-[11px] text-slate-500">{unit}</span>}
      </div>
      {sublabel && <div className="mt-0.5 text-[10px] text-slate-500">{sublabel}</div>}
    </div>
  );
}
