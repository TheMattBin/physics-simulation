import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getSimulationById } from '../simulations/registry';

export function SimulationPage() {
  const { id } = useParams<{ id: string }>();
  const entry = id ? getSimulationById(id) : undefined;

  if (!entry || !entry.component) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-slate-500">404 · Lab Not Found</p>
        <h1 className="mt-2 text-2xl font-bold text-white">This simulation isn&apos;t built yet</h1>
        <p className="mt-2 text-sm text-slate-400">
          Return to the catalog to launch one of the interactive physics labs.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Lab Catalog
        </Link>
      </div>
    );
  }

  const SimComponent = entry.component;
  return <SimComponent meta={entry} />;
}
