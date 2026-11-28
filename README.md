# PhysLab — Interactive Physics Visualizations

A sleek, dark-mode interactive physics laboratory built for high school and university students. Explore live numerical solvers, real-time synchronized telemetry and phase diagrams, and the mathematical theory behind each phenomenon—running 100% client-side in the browser.

## Live Simulations

- **Classical Mechanics — Double Pendulum & Deterministic Chaos**
  4th-order Runge–Kutta (RK4) Lagrangian solver with live Kinetic / Potential / Total Energy conservation plots, velocity vectors, and a Δθ₁ = 0.001 rad Chaos Shadow Twin.
- **Statistical Mechanics — Entropy & The Arrow of Time**
  Many-body hard-sphere elastic gas chamber with O(N) spatial hashing, coarse-grained Boltzmann/Shannon entropy S(t), live 2D Maxwell–Boltzmann speed distribution histogram, and Loschmidt velocity reversal (`v → −v`).
- **Thermodynamics — Heat Engines (Carnot & Otto)**
  Animated piston-cylinder with thermal reservoirs synchronized to a real-time P–V diagram, shaded net work area `W = ∮ P dV`, and live efficiency comparison against the Carnot ceiling.
- **Fluid Dynamics — 2D Wind Tunnel & Vortex Shedding**
  Real-time D2Q9 Lattice Boltzmann fluid solver with cylinder, NACA airfoil (adjustable angle of attack), teardrop, flat plate, car coupe, and freehand paint/erase obstacles; visualizes vorticity curl, velocity, pressure fields, smoke streamlines, and live momentum-exchange drag (`C_D`) and lift (`C_L`).
- **Classical Mechanics — Projectile Motion & Quadratic Air Drag**
  Simultaneous vacuum vs. quadratic-drag RK4 solver with headwind/tailwind control, optimal-angle sweep curves, live velocity/drag vectors, and speed decay toward terminal velocity.
- **Classical Mechanics — Newton's Laws: Forces, Friction & Free-Body Diagrams**
  Block on a ramp, push on a table, ramp with a hanging mass, and an Atwood machine, all solved with event-driven exact kinematics. Includes live free-body diagrams with optional gravity components, a ΣF = ma ledger, an automatic push ramp that shows the static-to-kinetic friction drop, nudges for Newton's 1st law, and Newton's 3rd-law force pairs.
- **Thermodynamics — 2D Heat Equation & Thermal Diffusion**
  Interactive finite-volume 2D PDE sandbox supporting Copper, Steel, Glass, and adiabatic insulators; paint 100°C heat sources, 0°C sinks, and baffles while inspecting live Fourier heat flux vectors (`q = −k∇T`) and hover temperature probes.
- **Waves & Optics — Wave Interference & Double-Slit Optics**
  2D FDTD scalar wave tank demonstrating Young's double-slit fringes, coherent point sources with phase shifting, single-slit diffraction, and Snell's Law refraction with a real-time optical detector screen `I(y)`.
- **Electromagnetism — Charged Particles in E & B Fields**
  Boris-pusher solver for the Lorentz force with real particles in SI units: cyclotron orbits (with an opposite-charge twin), E × B drift, a crossed-field velocity selector with a live speed spectrum, and a Bainbridge mass spectrometer that resolves the neon isotopes Ne-20, Ne-21 and Ne-22.
- **Quantum Mechanics — Quantum Tunneling & Wave Packets**
  Crank–Nicolson solver for the 1D time-dependent Schrödinger equation (electron, nm/eV/fs units) with exactly tracked absorbing boundaries: free-packet spreading versus σ(t) theory, tunneling and above-barrier reflection, and resonant tunneling through a double barrier, with a live transmission spectrum T(E) and a classical-particle comparison.
- **Quantum Mechanics — Bound States & Energy Quantization**
  Exact spectral time evolution in a particle-in-a-box, harmonic oscillator, finite well and double well (analytic and Sturm-bisection eigenstates): clickable energy-level superpositions, energy and position measurements with collapse, double-well tunneling oscillations, coherent states, and a quantum revival with a live space-time "quantum carpet".
- **Quantum Mechanics — Schrödinger's Hydrogen Atom & Orbitals**
  Exact hydrogen eigenfunctions (n ≤ 4, real s/p/d/f orbitals) rendered as rotatable |ψ|²-sampled electron clouds and nodal slices, Bohr-orbit comparison, radial probability P(r), superpositions whose charge cloud oscillates at ΔE/h, computed dipole selection rules and radiative lifetimes, and an emission spectrum built photon by photon.
- **Quantum Mechanics — Electron Double Slit: Wave–Particle Duality**
  Electrons detected one at a time build an interference pattern (Bach et al. 2013 geometry). Exact Fresnel-integral diffraction from near field to far field, slit closing, a which-path detector obeying Englert's V² + D² ≤ 1, and a live histogram against the |ψ|² prediction.
- **Mechanical Engineering — Beam Bending, Shear & Stress**
  Exact Euler–Bernoulli solver (Macaulay brackets) for simply supported, cantilever and overhanging beams with I-beam, rectangle, box and pipe sections in steel, aluminium, titanium or glulam timber. Live stress field on the deflected beam, synchronized V(x), M(x) and w(x) diagrams, a cross-section inspector with σ = My/I and Jourawski τ = VQ/Ib profiles, von Mises (or timber bending/shear) safety factors, serviceability L/δ, a rolling load with its moment envelope, and the exact fundamental frequency.
- **Mechanical Engineering — Tensile Test: Stress–Strain, Yield & Necking**
  Virtual testing machine pulling low-carbon steel, Al 6061-T6, annealed copper, Ti-6Al-4V and alumina. A volume-conserving, elastic–viscoplastic 1D bar (Swift hardening) produces the upper/lower yield point and a propagating Lüders band, necking at the Considère load, Bridgman-corrected true stress, and cup-and-cone or brittle fracture. Includes 0.2 % offset yield, resilience and toughness areas, unload/reload work hardening, the gauge-length dependence of elongation, and multi-material overlays.
- **Chemistry — Reaction Kinetics: Collisions, Barriers & Catalysts**
  Reactive hard-disk gas in real units (nm, ps, kJ/mol) where A + B → C + D only when the line-of-centres collision energy beats Eₐ. Exact energy and momentum bookkeeping for exo- and endothermic steps, heat-bath or insulated surroundings (thermal runaway), a catalysed pathway, live collision-energy histogram vs e^(−E/RT), rate-law order tests (ln[A] and 1/[A]), and an Arrhenius plot built from measured rate constants against 2D collision theory.

## Local Development

```bash
npm install
npm run dev
```

## Deploying to GitHub Pages

This repository includes a ready-to-use GitHub Actions workflow at `.github/workflows/deploy.yml`:

1. Push this repository to GitHub (`main` branch).
2. In your GitHub repo, open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Every push to `main` automatically builds and publishes the site.

## Adding a New Simulation

1. Create a self-contained folder under `src/simulations/<sim-id>/` with `physics.ts` (pure solver) and `index.tsx` (Canvas viewport wrapped in `<LabShell>`).
2. Register metadata, KaTeX equations, assumptions, and guided experiments in `src/simulations/registry.ts`.
