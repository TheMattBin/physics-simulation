import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, Clock, Layers } from 'lucide-react';
import { DOMAINS, type PhysicsDomain } from '../engine/types';
import { SIMULATIONS } from '../simulations/registry';
import { MathFormula } from '../components/MathFormula';

export function HomePage() {
  const [selectedDomain, setSelectedDomain] = useState<PhysicsDomain | 'all'>('all');

  const filtered =
    selectedDomain === 'all'
      ? SIMULATIONS
      : SIMULATIONS.filter((s) => s.domain === selectedDomain);

  const readyCount = SIMULATIONS.filter((s) => s.status === 'ready').length;

  return (
    <div className="bg-lab-grid min-h-[calc(100vh-3.5rem)]">
      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pt-12 pb-8 sm:px-6 sm:pt-16">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 font-mono text-xs text-sky-300">
            <Sparkles className="h-3.5 w-3.5" />
            Interactive Dark-Mode Physics Laboratory
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Visualize the laws of physics{' '}
            <span className="bg-gradient-to-r from-sky-400 via-emerald-300 to-amber-300 bg-clip-text text-transparent">
              in real time.
            </span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-400 sm:text-lg">
            Built for high school and university students. Manipulate live numerical solvers,
            inspect synchronized telemetry and phase diagrams, and connect visual intuition directly
            to the underlying equations.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0b101d] px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span className="font-mono text-slate-200">{readyCount} Live Labs</span>
              <span>ready to explore</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#0b101d] px-3 py-2">
              <Layers className="h-3.5 w-3.5 text-sky-400" />
              <span>RK4 ODEs · Many-Body Particles · LBM Fluids · 2D PDEs</span>
            </div>
          </div>
        </div>
      </section>

      {/* Domain Filter Bar */}
      <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedDomain('all')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedDomain === 'all'
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                : 'border-slate-800 bg-[#0b101d] text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            All Domains ({SIMULATIONS.length})
          </button>
          {(Object.keys(DOMAINS) as PhysicsDomain[]).map((key) => {
            const d = DOMAINS[key];
            const count = SIMULATIONS.filter((s) => s.domain === key).length;
            const active = selectedDomain === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDomain(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? d.badgeClass
                    : 'border-slate-800 bg-[#0b101d] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {d.label} ({count})
              </button>
            );
          })}
        </div>
      </section>

      {/* Simulation Grid */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((sim) => {
            const domain = DOMAINS[sim.domain];
            const isReady = sim.status === 'ready';

            const cardContent = (
              <article
                className={`group flex h-full flex-col justify-between rounded-xl border p-5 transition-all ${
                  isReady
                    ? 'border-slate-800/90 bg-[#0b101d]/95 hover:-translate-y-0.5 hover:border-sky-500/40 hover:bg-[#0e1526] hover:shadow-[0_12px_36px_rgba(0,0,0,0.45)]'
                    : 'border-slate-800/60 bg-[#080c16]/80 opacity-80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${domain.badgeClass}`}
                    >
                      {domain.shortLabel}
                    </span>
                    {isReady ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Interactive
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                        <Clock className="h-3 w-3" />
                        {sim.phase}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-3.5 text-lg font-semibold tracking-tight text-white transition-colors group-hover:text-sky-300">
                    {sim.title}
                  </h2>

                  <p className="mt-2 text-xs leading-relaxed text-slate-400">{sim.summary}</p>

                  {/* Equation Preview Box */}
                  <div className="mt-4 rounded-lg border border-slate-800/80 bg-[#060a12] px-3 py-2.5 text-center">
                    <MathFormula latex={sim.equationPreview} className="text-xs" />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-800/70 pt-3.5">
                  <div className="flex flex-wrap gap-1.5">
                    {sim.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  {isReady ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-400 transition-transform group-hover:translate-x-0.5">
                      Launch <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-slate-500">Upcoming</span>
                  )}
                </div>
              </article>
            );

            return isReady ? (
              <Link key={sim.id} to={`/sim/${sim.id}`} className="block h-full">
                {cardContent}
              </Link>
            ) : (
              <div key={sim.id} className="h-full">
                {cardContent}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
