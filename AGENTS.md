# AGENTS.md — PhysLab Repository Guide

This repository hosts **PhysLab**, a client-side interactive dark-mode physics laboratory built for high school and university students and deployed statically to GitHub Pages.

## Quick Commands

- `npm install` — Install dependencies
- `npm run dev` — Start Vite local dev server with HMR
- `npm run build` — Run strict TypeScript check (`tsc -b`) and production Vite build (`dist/`)
- `npm run preview` — Preview production build locally

Always verify `npm run build` passes with zero TypeScript or Vite errors before committing.

## Tech Stack & Hosting Constraints

- **Frontend:** Vite 6 + React 19 + TypeScript (strict) + Tailwind CSS v4
- **Routing:** `HashRouter` (`react-router-dom`) + `base: './'` in `vite.config.ts` so every route and asset works cleanly on GitHub Pages subpaths without server-side rewrites.
- **Math:** KaTeX via `<MathFormula />` (`src/components/MathFormula.tsx`).
- **Deployment:** Automated via `.github/workflows/deploy.yml` on pushes to `main`. Keep everything 100% client-side (no backend dependencies).

## Architecture Overview

```text
src/
├── engine/
│   ├── types.ts        # PhysicsDomain taxonomy (DOMAINS) and SimulationEntry schema
│   ├── integrators.ts  # Generic 4th-order Runge-Kutta (rk4Step) for ODE systems
│   ├── ringBuffer.ts   # Fixed-capacity RingBuffer for 60fps oscilloscope graphs
│   └── math.ts         # clamp, lerp, syncCanvasSize (HiDPI), thermalColor / thermalRgba
├── components/
│   ├── LabShell.tsx    # Standardized virtual lab layout (transport bar, viewport, telemetry, theory tabs)
│   ├── LivePlot.tsx    # High-FPS Canvas multi-series oscilloscope
│   ├── ParameterSlider.tsx
│   ├── MetricCard.tsx
│   ├── MathFormula.tsx
│   └── Navbar.tsx
├── pages/
│   ├── HomePage.tsx        # Catalog grid with domain filters and KaTeX equation previews
│   └── SimulationPage.tsx  # Resolves /sim/:id from registry
└── simulations/
    ├── registry.ts         # Central catalog (metadata, KaTeX theory, assumptions, guided experiments)
    ├── double-pendulum/    # Tier 1: RK4 Lagrangian ODE
    ├── projectile-drag/    # Tier 1: RK4 quadratic aerodynamic drag
    ├── heat-engine/        # Tier 1: Thermodynamic cycles (Carnot / Otto) + synced P-V diagram
    ├── entropy-diffusion/  # Tier 2: Many-body hard-sphere gas + spatial grid hashing
    ├── wind-tunnel/        # Tier 3: 2D D2Q9 Lattice Boltzmann fluid solver
    ├── heat-conduction/    # Tier 3: 2D finite-volume Fourier heat diffusion PDE
    └── wave-interference/  # Tier 3: 2D FDTD scalar wave equation
```

## How to Add a New Simulation

1. **Create a self-contained folder** at `src/simulations/<sim-id>/`:
   - `physics.ts` — Pure TypeScript numerical solver (zero React imports) so it can be verified standalone in Node (`node --experimental-strip-types`).
   - `index.tsx` — React component accepting `{ meta: SimulationEntry }`, rendering into `<LabShell>` with Canvas 2D (or WebGL2) visualization, `<MetricCard>` telemetry, `<ParameterSlider>` controls, and optional `<LivePlot>` graphs.
2. **Add a domain (only if needed)** in `src/engine/types.ts` under `PhysicsDomain` and `DOMAINS`.
3. **Register the lab** in `src/simulations/registry.ts` with:
   - `status: 'ready'`, concise `equationPreview`, and `component`
   - Complete `theory`: `overview`, 3–4 KaTeX `equations`, honest physical/numerical `assumptions`, and 3 interactive `experiments` (prompt + takeaway).
4. **Update `README.md`** if adding a major new lab or domain.

## Design & Numerical Conventions

- **Visual Theme:** Sleek dark-mode scientific instrumentation (`#060911` canvas background, `#0b101d` cards, `tabular-nums` monospace readouts). Use consistent semantic colors:
  - Cyan (`#38bdf8`) — velocity, kinematics, cold/CW vorticity
  - Amber (`#f59e0b`) — energy, heat, temperature
  - Coral/Rose (`#fb7185`) — force, drag, pressure, high-T sources
  - Emerald (`#34d399`) — entropy, lift, work, equilibrium
  - Violet/Pink (`#a78bfa` / `#f472b6`) — fields, phase, waves, Reynolds/optics
- **HiDPI Canvas:** Always size canvases with `syncCanvasSize(canvas)` from `src/engine/math.ts` and scale the 2D context by `dpr`.
- **Animation Loop Safety:** Keep `requestAnimationFrame` mounted once in `useEffect` and read live sliders/flags via refs (`paramsRef`, `runningRef`, `speedRef`). Never include parameter-dependent reset callbacks in the RAF `useEffect` dependency array, or dragging sliders will overwrite user values.
- **Numerical Stability:** Prioritize exact conservation laws and analytical clarity over visual hacks. Clamp solver parameters within safe stability bounds (e.g., LBM Mach number $Ma < 0.25$ and $\omega \le 1.94$; explicit 2D Heat CFL $\alpha\Delta t/\Delta x^2 \le 0.25$; 2D FDTD Courant $c\Delta t/\Delta x < 1/\sqrt{2}$).
- **Throttle React State:** Run physics and Canvas drawing at 60fps inside `requestAnimationFrame`, but update React telemetry state every 3–6 frames to avoid unnecessary DOM re-renders.
