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
