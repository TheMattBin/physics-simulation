import { useState, type ReactNode } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  StepForward,
  BookOpen,
  FlaskConical,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { DOMAINS, type SimulationEntry } from '../engine/types';
import { MathFormula } from './MathFormula';

interface LabShellProps {
  meta: SimulationEntry;
  running: boolean;
  speed: number;
  onToggleRun: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  extraToolbar?: ReactNode;
  canvas: ReactNode;
  belowCanvas?: ReactNode;
  controls: ReactNode;
  metrics?: ReactNode;
}

const SPEEDS = [0.25, 0.5, 1, 2];

export function LabShell({
  meta,
  running,
  speed,
  onToggleRun,
  onStep,
  onReset,
  onSpeedChange,
  extraToolbar,
  canvas,
  belowCanvas,
  controls,
  metrics,
}: LabShellProps) {
  const domain = DOMAINS[meta.domain];
  const [theoryTab, setTheoryTab] = useState<'equations' | 'experiments' | 'assumptions'>(
    'equations',
  );
  const [revealedHints, setRevealedHints] = useState<Record<number, boolean>>({});

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Lab Header */}
      <div className="mb-5 flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-5 lg:flex-row lg:items-end">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${domain.badgeClass}`}
            >
              {domain.label}
            </span>
            <span className="rounded-full border border-slate-800 bg-slate-900/90 px-2.5 py-0.5 font-mono text-[11px] text-slate-400">
              {meta.level}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {meta.title}
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">{meta.subtitle}</p>
        </div>

        {/* Transport Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleRun}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors ${
              running
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                : 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
            }`}
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Pause' : 'Play'}
          </button>

          <button
            type="button"
            onClick={onStep}
            title="Advance single physics step"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <StepForward className="h-3.5 w-3.5" />
            Step
          </button>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>

          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeedChange(s)}
                className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors ${
                  speed === s
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {extraToolbar}
        </div>
      </div>

      {/* Main Lab Workspace */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left/Main Viewport + Plots */}
        <div className="space-y-4 lg:col-span-8">
          <div className="overflow-hidden rounded-xl border border-slate-800/90 bg-[#080c16] shadow-[0_0_40px_rgba(0,0,0,0.45)]">
            {canvas}
          </div>
          {belowCanvas}
        </div>

        {/* Right Instrumentation & Controls Sidebar */}
        <aside className="space-y-4 lg:col-span-4">
          {metrics && (
            <section className="rounded-xl border border-slate-800/90 bg-[#0b101d] p-4">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Live Telemetry
              </h2>
              {metrics}
            </section>
          )}

          <section className="rounded-xl border border-slate-800/90 bg-[#0b101d] p-4">
            <h2 className="mb-3.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Parameters &amp; Controls
            </h2>
            <div className="space-y-4">{controls}</div>
          </section>
        </aside>
      </div>

      {/* Theory, Equations & Guided Lab Section */}
      {meta.theory && (
        <section className="mt-8 rounded-xl border border-slate-800/90 bg-[#0b101d]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <BookOpen className="h-4 w-4 text-sky-400" />
              Physics Theory &amp; Lab Guide
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#060911] p-1">
              {(
                [
                  { id: 'equations', label: 'Equations & Theory' },
                  { id: 'experiments', label: 'Guided Experiments' },
                  { id: 'assumptions', label: 'Model Assumptions' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTheoryTab(tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    theoryTab === tab.id
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5">
            {theoryTab === 'equations' && (
              <div className="space-y-5">
                <p className="max-w-4xl text-sm leading-relaxed text-slate-300">
                  {meta.theory.overview}
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {meta.theory.equations.map((eq) => (
                    <div
                      key={eq.label}
                      className="rounded-lg border border-slate-800/80 bg-[#070b14] p-4"
                    >
                      <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                        {eq.label}
                      </div>
                      <MathFormula latex={eq.latex} block className="my-2" />
                      <p className="mt-2 text-xs leading-relaxed text-slate-400">
                        {eq.explanation}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {theoryTab === 'experiments' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {meta.theory.experiments.map((exp, idx) => {
                  const open = !!revealedHints[idx];
                  return (
                    <div
                      key={exp.title}
                      className="flex flex-col justify-between rounded-lg border border-slate-800/80 bg-[#070b14] p-4"
                    >
                      <div>
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-400">
                          <FlaskConical className="h-3.5 w-3.5" />
                          Experiment {idx + 1}: {exp.title}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">{exp.prompt}</p>
                      </div>
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() =>
                            setRevealedHints((prev) => ({ ...prev, [idx]: !prev[idx] }))
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300"
                        >
                          {open ? (
                            <>
                              Hide Takeaway <ChevronUp className="h-3.5 w-3.5" />
                            </>
                          ) : (
                            <>
                              Reveal Physics Takeaway <ChevronDown className="h-3.5 w-3.5" />
                            </>
                          )}
                        </button>
                        {open && (
                          <p className="mt-2 rounded border border-sky-500/20 bg-sky-500/5 p-2.5 text-xs leading-relaxed text-slate-300">
                            {exp.takeaway}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {theoryTab === 'assumptions' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
                  <AlertCircle className="h-4 w-4" />
                  Numerical &amp; Physical Idealizations Used in This Solver
                </div>
                <ul className="space-y-2 text-sm text-slate-300">
                  {meta.theory.assumptions.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
