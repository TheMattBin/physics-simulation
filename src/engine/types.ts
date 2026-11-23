import type { ComponentType } from 'react';

export type PhysicsDomain =
  | 'classical'
  | 'stat-mech'
  | 'thermodynamics'
  | 'fluids'
  | 'waves';

export type SimulationStatus = 'ready' | 'planned';

export interface DomainInfo {
  id: PhysicsDomain;
  label: string;
  shortLabel: string;
  accent: string;
  badgeClass: string;
}

export const DOMAINS: Record<PhysicsDomain, DomainInfo> = {
  classical: {
    id: 'classical',
    label: 'Classical Mechanics',
    shortLabel: 'Mechanics',
    accent: '#38bdf8',
    badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  },
  'stat-mech': {
    id: 'stat-mech',
    label: 'Statistical Mechanics',
    shortLabel: 'Stat Mech',
    accent: '#34d399',
    badgeClass: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  },
  thermodynamics: {
    id: 'thermodynamics',
    label: 'Thermodynamics',
    shortLabel: 'Thermo',
    accent: '#f59e0b',
    badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  },
  fluids: {
    id: 'fluids',
    label: 'Fluid Dynamics',
    shortLabel: 'Fluids',
    accent: '#a78bfa',
    badgeClass: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
  },
  waves: {
    id: 'waves',
    label: 'Waves & Optics',
    shortLabel: 'Waves',
    accent: '#f472b6',
    badgeClass: 'bg-pink-500/10 text-pink-300 border-pink-500/25',
  },
};

export interface EquationEntry {
  label: string;
  latex: string;
  explanation: string;
}

export interface GuidedExperiment {
  title: string;
  prompt: string;
  takeaway: string;
}

export interface SimulationTheory {
  overview: string;
  equations: EquationEntry[];
  assumptions: string[];
  experiments: GuidedExperiment[];
}

export interface SimulationEntry {
  id: string;
  title: string;
  subtitle: string;
  domain: PhysicsDomain;
  level: 'High School' | 'University' | 'HS / University';
  status: SimulationStatus;
  phase: string;
  tags: string[];
  equationPreview: string;
  summary: string;
  theory?: SimulationTheory;
  component?: ComponentType<{ meta: SimulationEntry }>;
}
