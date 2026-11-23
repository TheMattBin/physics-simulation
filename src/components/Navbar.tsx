import { Link, useLocation } from 'react-router-dom';
import { Atom, ArrowLeft } from 'lucide-react';

export function Navbar() {
  const location = useLocation();
  const isHome = location.pathname === '/' || location.pathname === '';

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#060911]/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="group flex items-center gap-2.5 text-slate-100 transition-colors hover:text-sky-300"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.15)] transition-colors group-hover:border-sky-400/50">
              <Atom className="h-4.5 w-4.5" />
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight">PhysLab</span>
              <span className="hidden rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400 sm:inline-block">
                Interactive
              </span>
            </div>
          </Link>

          {!isHome && (
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Labs
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="hidden items-center gap-1.5 font-mono sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            60 FPS Client-Side Solver
          </span>
        </div>
      </div>
    </header>
  );
}
