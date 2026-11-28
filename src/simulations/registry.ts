import type { SimulationEntry } from '../engine/types';
import { DoublePendulumLab } from './double-pendulum';
import { EntropyDiffusionLab } from './entropy-diffusion';
import { HeatEngineLab } from './heat-engine';
import { WindTunnelLab } from './wind-tunnel';
import { ProjectileDragLab } from './projectile-drag';
import { NewtonsLawsLab } from './newtons-laws';
import { HeatConductionLab } from './heat-conduction';
import { WaveInterferenceLab } from './wave-interference';
import { ChargedParticlesLab } from './charged-particles';
import { QuantumTunnelingLab } from './quantum-tunneling';
import { QuantumBoundStatesLab } from './quantum-bound-states';
import { HydrogenAtomLab } from './hydrogen-atom';
import { ElectronDoubleSlitLab } from './electron-double-slit';
import { BeamBendingLab } from './beam-bending';
import { TensileTestLab } from './tensile-test';
import { ReactionKineticsLab } from './reaction-kinetics';

export const SIMULATIONS: SimulationEntry[] = [
  {
    id: 'double-pendulum',
    title: 'Double Pendulum & Deterministic Chaos',
    subtitle:
      'Lagrangian mechanics, exact energy conservation, and extreme sensitivity to initial conditions.',
    domain: 'classical',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 2',
    tags: ['Lagrangian', 'Chaos', 'RK4', 'Conservation'],
    equationPreview: '\\mathcal{L} = T(\\theta_i, \\dot{\\theta}_i) - V(\\theta_i)',
    summary:
      'Compare two nearly identical double pendulums separated by just 0.001 rad while tracking Kinetic, Potential, and Total Mechanical Energy in real time.',
    component: DoublePendulumLab,
    theory: {
      overview:
        'A double pendulum consists of two rigid massless rods coupled at a frictionless pivot. While the equations of motion are completely deterministic and derived directly from the Euler–Lagrange equations, nonlinear coupling between the two angles produces chaotic trajectories whose separation grows exponentially with time (positive Lyapunov exponent).',
      equations: [
        {
          label: 'Lagrangian Formulation',
          latex:
            '\\mathcal{L} = \\frac{1}{2}(m_1+m_2)L_1^2\\dot{\\theta}_1^2 + \\frac{1}{2}m_2 L_2^2\\dot{\\theta}_2^2 + m_2 L_1 L_2 \\dot{\\theta}_1\\dot{\\theta}_2\\cos(\\theta_1-\\theta_2) - V',
          explanation:
            'Kinetic energy T includes both individual bob motion and the nonlinear cross-coupling term proportional to cos(θ₁ − θ₂).',
        },
        {
          label: 'Gravitational Potential Energy',
          latex: 'V(\\theta_1,\\theta_2) = (m_1+m_2)gL_1(1-\\cos\\theta_1) + m_2 g L_2(1-\\cos\\theta_2)',
          explanation:
            'Measured relative to the lowest stable equilibrium (θ₁ = θ₂ = 0). With zero damping, E = T + V remains strictly constant.',
        },
        {
          label: 'Lyapunov Divergence',
          latex: '|\\delta \\mathbf{x}(t)| \\approx |\\delta \\mathbf{x}(0)|\\,e^{\\lambda t}',
          explanation:
            'In the chaotic high-energy regime, two initial states separated by 0.001 rad diverge exponentially with Lyapunov exponent λ > 0.',
        },
        {
          label: 'Numerical Integration (RK4)',
          latex: '\\mathbf{y}_{n+1} = \\mathbf{y}_n + \\frac{\\Delta t}{6}(k_1 + 2k_2 + 2k_3 + k_4)',
          explanation:
            'Fourth-order Runge–Kutta with 6 substeps per frame achieves O(Δt⁴) accuracy, preserving total energy to high precision.',
        },
      ],
      assumptions: [
        'Rods are perfectly rigid and massless; bobs are treated as point masses.',
        'Pivot bearings are frictionless unless Viscous Damping is raised above 0.',
        'Motion is constrained to a single vertical 2D plane with uniform gravitational field g.',
      ],
      experiments: [
        {
          title: 'Low-Energy Regularity vs. High-Energy Chaos',
          prompt:
            'Set both initial angles small (θ₁ = 20°, θ₂ = 25°) and watch the Shadow Twin. Then raise them to θ₁ = 140°, θ₂ = 155°. Compare how fast they diverge.',
          takeaway:
            'At small angles, sin(θ) ≈ θ linearizes the system into two predictable normal modes—the twin never separates. At large angles, nonlinear coupling triggers deterministic chaos.',
        },
        {
          title: 'Verify Conservation of Energy',
          prompt:
            'Keep Viscous Damping at 0.00 and watch the dashed white Total Energy line while the pendulum flips wildly. Now raise damping to 0.15.',
          takeaway:
            'Despite chaotic motion, Total Energy E = T + V stays flat because gravity is conservative. Adding damping dissipates mechanical energy monotonically.',
        },
        {
          title: 'Mass Ratio & Whip Effect',
          prompt:
            'Make the upper mass heavy (m₁ = 4.0 kg) and the lower mass light (m₂ = 0.5 kg) with Velocity Vectors ON.',
          takeaway:
            'Momentum transfer from the massive upper bob whips the lighter lower bob into high-speed loops, transferring large kinetic energy surges into m₂.',
        },
      ],
    },
  },
  {
    id: 'entropy-diffusion',
    title: 'Entropy & The Arrow of Time',
    subtitle:
      'Many-body elastic gas chamber illustrating Boltzmann entropy, Maxwell–Boltzmann speeds, and microscopic reversibility.',
    domain: 'stat-mech',
    level: 'University',
    status: 'ready',
    phase: 'Phase 2',
    tags: ['Entropy', '2nd Law', 'Maxwell-Boltzmann', 'Many-Body'],
    equationPreview: 'S = k_B \\ln \\Omega \\;\\approx\\; -k_B N \\sum_i p_i \\ln p_i',
    summary:
      'Release compressed or thermally separated gas molecules, measure coarse-grained entropy S(t) live, and test Loschmidt’s paradox by reversing every particle velocity.',
    component: EntropyDiffusionLab,
    theory: {
      overview:
        'Why does gas spontaneously expand to fill a room, yet never spontaneously compress back into one corner—even though Newtonian collisions are completely time-reversible? Statistical mechanics explains the Second Law probabilistically: equilibrium macrostates correspond to overwhelmingly more microscopic configurations (Ω) than ordered states.',
      equations: [
        {
          label: 'Boltzmann–Gibbs Entropy',
          latex: 'S = k_B \\ln \\Omega \\qquad \\text{and} \\qquad S_{\\text{grid}} = -k_B \\sum_{i=1}^{M} p_i \\ln p_i',
          explanation:
            'We partition the chamber into an 8×4 coarse-grained grid and compute spatial occupation probabilities pᵢ. Uniform equilibrium maximizes S = k_B ln(32).',
        },
        {
          label: '2D Maxwell–Boltzmann Speed Distribution',
          latex: 'f(v) = \\frac{m v}{k_B T}\\exp\\!\\left(-\\frac{m v^2}{2 k_B T}\\right)',
          explanation:
            'Elastic collisions redistribute kinetic energy until speeds settle onto the Rayleigh-shaped 2D Maxwell–Boltzmann curve shown in white.',
        },
        {
          label: 'Equipartition in 2D',
          latex: '\\langle E_k \\rangle = \\frac{1}{2} m \\langle v^2 \\rangle = k_B T',
          explanation:
            'With 2 translational degrees of freedom, mean kinetic energy per particle directly defines the chamber temperature T.',
        },
        {
          label: 'Statistical Fluctuations',
          latex: '\\frac{\\sigma_{N_A}}{N} \\propto \\frac{1}{\\sqrt{N}}',
          explanation:
            'Small particle counts exhibit visible random dips in entropy; as N approaches macroscopic scale (~10²³), spontaneous reversals become impossibly rare.',
        },
      ],
      assumptions: [
        'Particles are modeled as 2D elastic hard disks of equal mass with zero intermolecular attraction (ideal hard-sphere gas).',
        'Pairwise collisions are resolved via an O(N) uniform spatial hash grid; wall collisions conserve kinetic energy exactly.',
        'Coarse-grained entropy uses spatial (and species) cell occupancy rather than full 4N-dimensional phase-space volume.',
      ],
      experiments: [
        {
          title: 'Loschmidt’s Time-Reversal Paradox',
          prompt:
            'Start in Free Expansion, click Remove Partition, wait ~1.5 seconds as particles spill right, then click "Reverse v → −v". Watch both the chamber and the green Entropy curve.',
          takeaway:
            'Because collisions are microscopically reversible, particles briefly retrace their paths and entropy actually drops! Shortly afterward, tiny floating-point errors amplify exponentially and entropy climbs back to equilibrium.',
        },
        {
          title: 'Thermal Equilibration',
          prompt:
            'Switch to "Thermal Equilibrium (Hot A / Cold B)" and remove the partition. Watch Temp A and Temp B readouts plus the Speed Histogram.',
          takeaway:
            'Fast (hot) molecules collide with slow (cold) molecules, transferring kinetic energy until both chambers share one temperature and the bimodal speed histogram merges into a single Maxwell–Boltzmann curve.',
        },
        {
          title: 'Why Macroscopic Entropy Looks Monotonic',
          prompt:
            'Compare the entropy graph noise at N = 60 particles vs. N = 480 particles after equilibrium.',
          takeaway:
            'Relative fluctuations scale as 1/√N. At N = 60, noticeable dips occur frequently; at N = 480 the curve is much smoother—hinting why at N ~ 10²³ the Second Law appears absolute.',
        },
      ],
    },
  },
  {
    id: 'heat-engine',
    title: 'Thermodynamic Heat Engines (Carnot & Otto)',
    subtitle:
      'Animated piston cylinder synchronized in real time with its P–V diagram, enclosed net work, and thermal efficiency.',
    domain: 'thermodynamics',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 2',
    tags: ['Carnot', 'Otto Cycle', 'P-V Diagram', 'Efficiency'],
    equationPreview: '\\eta_{\\text{Carnot}} = 1 - \\frac{T_C}{T_H}, \\quad W = \\oint P\\,dV',
    summary:
      'Inspect how heat absorption, adiabatic expansion, and heat rejection trace closed loops on a P–V diagram—and why no engine can exceed Carnot efficiency.',
    component: HeatEngineLab,
    theory: {
      overview:
        'A cyclic heat engine absorbs heat Q_H from a hot source, converts part of it into mechanical work W, and must reject the remainder Q_C to a cold sink. On a Pressure–Volume (P–V) diagram, the shaded area enclosed by the clockwise cycle equals the exact net work output per cycle.',
      equations: [
        {
          label: 'First Law & Net Work',
          latex: 'W_{\\text{net}} = \\oint P\\,dV = Q_H - Q_C',
          explanation:
            'Over one complete cycle ΔU = 0, so every Joule of net work produced equals the difference between heat absorbed and heat rejected.',
        },
        {
          label: 'Carnot Efficiency Limit',
          latex: '\\eta_{\\text{Carnot}} = 1 - \\frac{T_C}{T_H}',
          explanation:
            'For any reversible engine operating between reservoirs T_H and T_C, efficiency depends solely on absolute Kelvin temperatures—never on the working gas.',
        },
        {
          label: 'Ideal Otto Cycle Efficiency',
          latex: '\\eta_{\\text{Otto}} = 1 - \\frac{1}{r^{\\gamma - 1}}, \\quad r = \\frac{V_{\\max}}{V_{\\min}}',
          explanation:
            'Models a 4-stroke spark-ignition engine. Efficiency improves with higher compression ratio r and higher heat-capacity ratio γ.',
        },
        {
          label: 'Adiabatic Relation',
          latex: 'P V^{\\gamma} = \\text{const}, \\qquad T V^{\\gamma - 1} = \\text{const}',
          explanation:
            'During insulated strokes (Q = 0), pressure drops steeper than an isotherm because expanding gas cools as it does work.',
        },
      ],
      assumptions: [
        'Working fluid is 1.0 mol of an ideal gas obeying PV = nRT with constant heat capacity ratio γ.',
        'All strokes are modeled as quasi-static and internally reversible (zero piston friction, zero heat leakage through cylinder walls).',
        'Otto ignition and exhaust are idealized as instantaneous constant-volume (isochoric) heat transfers.',
      ],
      experiments: [
        {
          title: 'Why Carnot Efficiency Ignores γ',
          prompt:
            'Select Carnot Cycle, note Thermal Efficiency η, then toggle Working Gas between Monatomic (5/3), Diatomic (7/5), and Polyatomic (4/3).',
          takeaway:
            'The shape of the P–V loop changes dramatically, yet η stays locked to 1 − T_C/T_H. Carnot efficiency is universal across all reversible substances.',
        },
        {
          title: 'Why Engines Use High Compression Ratios',
          prompt:
            'Switch to Otto Cycle and drag Compression Ratio r from 3.0:1 up to 8.5:1 while watching Efficiency η and the Carnot Limit.',
          takeaway:
            'Higher compression boosts Otto efficiency steeply (η = 1 − r^(1−γ)), closing part of the gap toward the Carnot ceiling—though real engines are limited by fuel knock.',
        },
        {
          title: 'Maximizing Work vs. Maximizing Efficiency',
          prompt:
            'In Carnot mode, raise T_H toward 1400 K and lower T_C toward 220 K. Observe how the enclosed green shaded area W grows.',
          takeaway:
            'Widening the temperature gap increases both efficiency and the area enclosed between the hot and cold isotherms, extracting more mechanical work per cycle.',
        },
      ],
    },
  },
  {
    id: 'wind-tunnel',
    title: '2D Wind Tunnel & Vortex Shedding',
    subtitle:
      'Lattice Boltzmann (D2Q9) fluid solver visualizing Kármán vortex streets, pressure fields, drag C_D, and airfoil lift C_L.',
    domain: 'fluids',
    level: 'University',
    status: 'ready',
    phase: 'Phase 3',
    tags: ['Fluid Dynamics', 'LBM', 'Aerodynamics', 'Reynolds Number'],
    equationPreview: '\\text{Re} = \\frac{u_0 L}{\\nu}, \\quad F_D = \\frac{1}{2}\\rho u_0^2 C_D A',
    summary:
      'Test cylinders, NACA airfoils, teardrops, flat plates, or hand-drawn shapes in a live 2D fluid tunnel. Toggle vorticity, velocity, pressure, and smoke streamlines.',
    component: WindTunnelLab,
    theory: {
      overview:
        'Instead of solving the Navier–Stokes partial differential equations directly, this wind tunnel uses the Lattice Boltzmann Method (D2Q9): a discrete mesoscopic gas of particle distributions streaming and colliding on a 2D grid. In the low-Mach limit, Chapman–Enskog expansion proves it recovers the incompressible Navier–Stokes equations—naturally capturing boundary layers, pressure drag, airfoil lift, and Kármán vortex shedding.',
      equations: [
        {
          label: 'Reynolds Number',
          latex: '\\text{Re} = \\frac{u_0 L}{\\nu}',
          explanation:
            'Ratio of inertial forces to viscous forces. Above Re ≈ 47 for a cylinder, steady twin wake eddies destabilize into an alternating Kármán vortex street.',
        },
        {
          label: 'BGK Lattice Boltzmann Evolution',
          latex: 'f_i(\\mathbf{x}+\\mathbf{c}_i, t+1) = f_i(\\mathbf{x}, t) - \\frac{1}{\\tau}\\Big(f_i - f_i^{\\text{eq}}(\\rho, \\mathbf{u})\\Big)',
          explanation:
            'Each timestep alternates local relaxation toward Maxwellian equilibrium f_i^eq (with relaxation time τ = 3ν + 0.5) and neighbor streaming along 9 lattice vectors.',
        },
        {
          label: 'Aerodynamic Drag & Lift Coefficients',
          latex: 'C_D = \\frac{F_D}{\\frac{1}{2}\\rho u_0^2 H}, \\qquad C_L = \\frac{F_L}{\\frac{1}{2}\\rho u_0^2 c}',
          explanation:
            'Forces F_D and F_L are computed directly from exact momentum exchange (2 f_i c_i) at every solid bounce-back wall link.',
        },
        {
          label: 'Vorticity (Fluid Curl)',
          latex: '\\omega_z = (\\nabla \\times \\mathbf{u})_z = \\frac{\\partial u_y}{\\partial x} - \\frac{\\partial u_x}{\\partial y}',
          explanation:
            'Measures local rotational spin of fluid elements. Alternating positive (amber) and negative (cyan) vortices shed off bluff bodies induce oscillating lift forces.',
        },
      ],
      assumptions: [
        '2D incompressible isothermal fluid solved on a 220×96 D2Q9 lattice with single-relaxation-time BGK collision.',
        'Valid in the low-Mach regime (u₀ ≤ 0.135 lattice units, Ma < 0.24) where density variations represent acoustic pressure p = ρ / 3.',
        'Obstacle walls use half-way no-slip bounce-back; top and bottom tunnel boundaries enforce free-stream velocity u₀.',
      ],
      experiments: [
        {
          title: 'Laminar Flow vs. Kármán Vortex Street',
          prompt:
            'Select Cylinder in Vorticity mode. Raise Kinematic Viscosity ν to 0.065 (Re < 45), then slowly lower ν down to 0.010 (Re > 200). Watch both the wake and the green C_L curve.',
          takeaway:
            'Below Re ≈ 47, viscous damping keeps the wake symmetric and C_L stays flat at 0. Above critical Re, vortices shed alternately top and bottom, driving a clean sinusoidal lift oscillation!',
        },
        {
          title: 'Bluff Body vs. Streamlined Drag',
          prompt:
            'Compare Drag Coefficient C_D across Flat Plate, Cylinder, and Teardrop (all share nearly the same frontal height). Switch to Pressure view to see why.',
          takeaway:
            'Flat plates and cylinders create huge low-pressure suction wakes behind them (pressure drag). A streamlined teardrop allows flow to reattach smoothly, slashing C_D dramatically.',
        },
        {
          title: 'Airfoil Lift & Aerodynamic Stall',
          prompt:
            'Select Airfoil, switch between Velocity and Pressure views, and raise Angle of Attack α from 0° → 12° → 28° while watching C_L and L/D.',
          takeaway:
            'At moderate angles (8°–15°), air accelerates over the upper surface creating low pressure suction (high C_L, strong L/D). Near 25°+, flow separates off the upper wing into violent vortices—aerodynamic stall!',
        },
      ],
    },
  },
  {
    id: 'projectile-drag',
    title: 'Projectile Motion & Quadratic Air Drag',
    subtitle:
      'Compare vacuum parabolas against velocity-squared aerodynamic drag, wind vectors, and terminal velocity.',
    domain: 'classical',
    level: 'High School',
    status: 'ready',
    phase: 'Phase 4',
    tags: ['Kinematics', 'Air Drag', 'Terminal Velocity', 'RK4'],
    equationPreview: 'm\\frac{d\\mathbf{v}}{dt} = m\\mathbf{g} - \\frac{1}{2}\\rho C_D A |\\mathbf{v}_{\\text{rel}}|\\mathbf{v}_{\\text{rel}}',
    summary:
      'Launch simultaneous vacuum and drag-affected projectiles with headwind/tailwind control, angle sweep curves, and live speed decay toward terminal velocity.',
    component: ProjectileDragLab,
    theory: {
      overview:
        'Introductory textbooks assume zero air resistance, yielding symmetric parabolas whose maximum range occurs at 45°. Real high-speed projectiles experience quadratic aerodynamic drag proportional to v², breaking trajectory symmetry, causing steep final descents, and shifting the optimal launch angle below 45°.',
      equations: [
        {
          label: 'Equation of Motion with Quadratic Drag',
          latex: 'm\\frac{d\\mathbf{v}}{dt} = m\\mathbf{g} - \\frac{1}{2}\\rho C_D A |\\mathbf{v} - \\mathbf{v}_w|(\\mathbf{v} - \\mathbf{v}_w)',
          explanation:
            'Drag acts strictly opposite the velocity relative to the moving air mass (v_rel = v − v_wind) and couples x and y motion nonlinearly.',
        },
        {
          label: 'Terminal Velocity',
          latex: 'v_t = \\sqrt{\\frac{2 m g}{\\rho C_D A}}',
          explanation:
            'The speed at which upward drag balances gravity. Lighter or larger-area objects (like a ping-pong ball) have low v_t and experience huge drag distortion.',
        },
        {
          label: 'Vacuum Reference Range (y₀ = 0)',
          latex: 'R_{\\text{vac}} = \\frac{v_0^2 \\sin(2\\theta)}{g}',
          explanation:
            'Without drag, horizontal velocity stays constant and range peaks cleanly at θ = 45° regardless of projectile mass.',
        },
        {
          label: 'Drag-to-Weight Ratio',
          latex: '\\frac{F_D(v_0)}{mg} = \\left(\\frac{v_0}{v_t}\\right)^2',
          explanation:
            'When launch speed v₀ exceeds v_t, aerodynamic drag initially overwhelms gravity—causing rapid early deceleration and sharp range loss.',
        },
      ],
      assumptions: [
        'Solved numerically via 4th-order Runge–Kutta (RK4) with exact linear interpolation for ground impact.',
        'Drag coefficient C_D is held constant across speed (neglecting the transonic drag rise and drag crisis at high Re).',
        'Spin-induced Magnus lift force and Earth curvature / Coriolis effects are omitted.',
      ],
      experiments: [
        {
          title: 'Why 45° Is No Longer Optimal',
          prompt:
            'Select Ping-Pong Ball at v₀ = 42 m/s, turn ON Angle Sweep, and read the Optimal Angle metric card.',
          takeaway:
            'Air drag punishes long flight times because horizontal speed bleeds away continuously. Launching flatter (~25°–35°) reaches farther before velocity decays.',
        },
        {
          title: 'Mass Independence vs. Mass Dominance',
          prompt:
            'Switch between Iron Sphere and Ping-Pong Ball while setting Air Density ρ = 0.000, then restore sea-level air (ρ = 1.225).',
          takeaway:
            'In vacuum, mass cancels out completely (Galileo’s equivalence). In air, heavier spheres carry far more momentum per unit cross-sectional area, losing a tiny fraction of range compared to a ping-pong ball.',
        },
        {
          title: 'Headwind Asymmetric Braking',
          prompt:
            'Select Baseball and set Wind Speed to −20 m/s (strong headwind) vs. +20 m/s (tailwind). Watch the red F_D vector and range.',
          takeaway:
            'Because drag scales with relative speed squared (v − v_w)², a headwind increases drag far more strongly than an equal tailwind reduces it!',
        },
      ],
    },
  },
  {
    id: 'newtons-laws',
    title: "Newton's Laws: Forces, Friction & Free-Body Diagrams",
    subtitle:
      'Watch free-body diagrams update live on ramps, tables, pulleys, and an Atwood machine. Static friction adjusts, breaks away, and hands off to kinetic friction.',
    domain: 'classical',
    level: 'High School',
    status: 'ready',
    phase: 'Phase 5',
    tags: ["Newton's Laws", 'Free-Body Diagrams', 'Friction', 'Atwood Machine'],
    equationPreview: '\\sum \\mathbf{F} = m\\mathbf{a}',
    summary:
      'Push, tilt, and pull blocks while a live free-body diagram and a ΣF = ma ledger show every force, including the static-to-kinetic friction drop and the 3rd-law pairs.',
    component: NewtonsLawsLab,
    theory: {
      overview:
        "Newton's first law says an object keeps its velocity unless a net force acts. The second law says the net force sets the acceleration (ΣF = ma), not the velocity. The third law says forces come in equal and opposite pairs acting on different bodies. A free-body diagram is the bookkeeping tool that connects them: isolate one body, draw every force on it, sum the components along the direction of motion, and divide by mass. Friction is the subtle case. Static friction is not a fixed number; it grows to exactly cancel whatever is trying to move the block, up to a ceiling of μ_s N. Past that ceiling the block breaks free and the weaker kinetic friction μ_k N takes over.",
      equations: [
        {
          label: "Newton's Second Law Along the Track",
          latex:
            '(m_1 + m_2)\\,a = F_{\\text{app}} + m_2 g - m_1 g\\sin\\theta + f',
          explanation:
            'Positive is up-slope, toward the pulley. The rope tension is internal to the block-plus-hanging-mass system, so it cancels. On m₁ alone the ledger reads F + T − m₁g sin θ + f = m₁a.',
        },
        {
          label: 'Normal Force & Coulomb Friction',
          latex:
            'N = m_1 g\\cos\\theta, \\qquad |f_s| \\le \\mu_s N, \\qquad f_k = \\mu_k N',
          explanation:
            'Static friction takes any value up to μ_s N that keeps the block at rest. Once sliding, friction has the fixed magnitude μ_k N and opposes the velocity. Usually μ_k < μ_s.',
        },
        {
          label: 'Angle of Repose',
          latex: '\\tan\\theta_c = \\mu_s',
          explanation:
            'With no push and no rope, the block slips when m g sin θ exceeds μ_s m g cos θ. Mass and gravity cancel, so a brick and a pebble on the same surface slip at the same angle, on Earth or on the Moon.',
        },
        {
          label: 'Atwood Machine',
          latex:
            'a = \\frac{m_2 - m_1}{m_1 + m_2}\\,g, \\qquad T = \\frac{2 m_1 m_2}{m_1 + m_2}\\,g',
          explanation:
            'Only the weight difference drives the motion, but both masses must be accelerated. Nearly equal masses therefore "dilute" gravity, which let George Atwood (1784) time a slowed-down free fall.',
        },
      ],
      assumptions: [
        'Forces are constant between events, so motion is integrated with exact constant-acceleration kinematics. Events (velocity passing through zero, which triggers the stick/slip test, and the ends of the track) are located analytically, so there is no time-step error.',
        'Coulomb friction model with constant μ_s and μ_k (μ_k is capped at μ_s). No velocity dependence, stick-slip vibration, or air drag.',
        'Rigid blocks that slide without tipping or rolling. The applied push acts parallel to the surface, so it does not change N.',
        'Massless, inextensible rope parallel to the incline, over a massless, frictionless pulley, so the tension is the same on both sides.',
        'The ends of the track are perfectly inelastic stops: the block stops dead and the stop supplies whatever force is needed to hold it there.',
      ],
      experiments: [
        {
          title: "Newton's First Law on Ice",
          prompt:
            'Choose "Push on Table", set μ_s = μ_k = 0, and press Nudge → Right. Watch the motion plot. Then raise μ_s and μ_k to 0.10, press Reset, and nudge again.',
          takeaway:
            'With ΣF = 0 the velocity line stays perfectly flat, so the block coasts without any force. Friction is the hidden force that makes everyday objects slow down. That is why it took Galileo and Newton to see that motion itself needs no cause; only changes in motion do.',
        },
        {
          title: 'The Static-Friction Cliff',
          prompt:
            'Choose "Push on Table" (μ_s = 0.50, μ_k = 0.30, m₁ = 5 kg) and click Ramp Push. Watch the Friction f and Applied F traces in the force plot.',
          takeaway:
            'Friction rises in lockstep with the push, keeping ΣF = 0 (it is still static), until it hits μ_s N = 24.5 N. At that instant it drops to μ_k N = 14.7 N, the net force jumps, and the block lurches forward. This sudden release is the same stick-slip behavior behind squeaky doors, violin strings, and earthquakes.',
        },
        {
          title: 'Atwood Machine: Diluting Gravity',
          prompt:
            'Choose "Atwood Machine" (m₁ = 2.0 kg, m₂ = 2.2 kg). Read the acceleration and tension, then turn on 3rd-Law Pairs. Finally set m₂ = 10 kg.',
          takeaway:
            'a ≈ 0.47 m/s², only about 5% of g, because a 2 N weight difference has to accelerate 4.2 kg. T sits between m₁g and m₂g and is identical on both sides of the massless rope. As m₂ grows, a approaches g and T approaches 2m₁g, never more.',
        },
      ],
    },
  },
  {
    id: 'heat-conduction',
    title: '2D Heat Equation & Thermal Diffusion',
    subtitle:
      'Interactive PDE sandbox solving Fourier’s Law across copper, steel, glass, and custom insulated geometries.',
    domain: 'thermodynamics',
    level: 'University',
    status: 'ready',
    phase: 'Phase 4',
    tags: ['PDE', 'Fourier Law', 'Diffusion', 'Heat Flux'],
    equationPreview: '\\frac{\\partial T}{\\partial t} = \\alpha \\nabla^2 T, \\quad \\mathbf{q} = -k \\nabla T',
    summary:
      'Paint 100°C heat sources, 0°C sinks, thermal insulators, and copper conduits on a 2D plate while inspecting live Fourier heat flux vectors and thermal relaxation.',
    component: HeatConductionLab,
    theory: {
      overview:
        'Heat conduction in solids obeys Fourier’s Law: thermal energy flows down temperature gradients from hot to cold. Combining Fourier’s Law with energy conservation yields the parabolic 2D Heat Equation, which smooths sharp temperature peaks exponentially fast until the plate reaches steady state (∇²T = 0) or uniform equilibrium.',
      equations: [
        {
          label: '2D Heat Diffusion PDE',
          latex: '\\frac{\\partial T}{\\partial t} = \\alpha\\left(\\frac{\\partial^2 T}{\\partial x^2} + \\frac{\\partial^2 T}{\\partial y^2}\\right), \\quad \\alpha = \\frac{k}{\\rho c_p}',
          explanation:
            'Thermal diffusivity α governs how quickly temperature fronts propagate. Copper diffuses heat roughly 10× faster than glass.',
        },
        {
          label: 'Fourier’s Law of Heat Flux',
          latex: '\\mathbf{q} = -k\\,\\nabla T',
          explanation:
            'The white vector arrows show local heat flux q pointing strictly perpendicular to isotherms, from high T to low T.',
        },
        {
          label: 'Steady-State Laplace Equation',
          latex: '\\nabla^2 T = 0',
          explanation:
            'When fixed hot/cold sources remain clamped long enough, ∂T/∂t → 0 and the temperature field settles into a harmonic solution.',
        },
        {
          label: 'Explicit 2D Stability (CFL Condition)',
          latex: '\\frac{\\alpha\\,\\Delta t}{\\Delta x^2} \\le \\frac{1}{4}',
          explanation:
            'Our conservative finite-volume scheme uses harmonic interface averaging across dissimilar materials and stays strictly inside the 2D CFL bound.',
        },
      ],
      assumptions: [
        'Solved on a 136×84 2D grid with adiabatic (zero-flux, ∂T/∂n = 0) outer edges and painted insulator walls.',
        'Radiative (T⁴) and convective surface cooling to surrounding air are neglected—purely conductive 2D transfer.',
        'Material diffusivity ratios are scaled for real-time visual clarity while preserving exact Copper > Steel > Glass ordering.',
      ],
      experiments: [
        {
          title: 'The Great Material Conductance Race',
          prompt:
            'Select the "Material Race" preset and hover your cursor over Copper, Steel, and Glass bars at the same horizontal distance from the 100°C left bar.',
          takeaway:
            'Because thermal penetration depth scales as L ~ √(αt), heat races across the Copper bar while barely creeping into Glass.',
        },
        {
          title: 'Thermal Short-Circuiting with Copper',
          prompt:
            'In "Dipole + Baffle", switch brush to Copper Path and bridge a narrow copper strip through the central gap between the hot and cold sides.',
          takeaway:
            'Heat flux arrows immediately funnel into the low-resistance copper bridge—exactly how CPU heat pipes steer thermal energy away from hot silicon.',
        },
        {
          title: 'Isolated Equilibration (Second Law)',
          prompt:
            'Load "Gaussian Pulse" (no fixed sources or sinks) and watch Mean Plate Temp vs. Max − Min Gradient ΔT on the live plot.',
          takeaway:
            'With adiabatic boundaries, total thermal energy (Mean Temp) stays strictly conserved while ΔT decays monotonically toward zero—a PDE portrait of entropy maximization.',
        },
      ],
    },
  },
  {
    id: 'wave-interference',
    title: 'Wave Interference & Double-Slit Optics',
    subtitle:
      '2D FDTD wave tank demonstrating Young’s double-slit fringes, diffraction, phase shifting, and Snell’s Law refraction.',
    domain: 'waves',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 4',
    tags: ['FDTD', 'Double Slit', 'Diffraction', 'Snell Law'],
    equationPreview: '\\frac{\\partial^2 u}{\\partial t^2} = c^2 \\nabla^2 u, \\quad d\\sin\\theta = m\\lambda',
    summary:
      'Drive coherent waves through single or double slits and dielectric glass interfaces, watching constructive and destructive interference fringes build live on an optical detector screen.',
    component: WaveInterferenceLab,
    theory: {
      overview:
        'Linear waves obey the Superposition Principle: wherever crests from two paths meet in phase, amplitudes add constructively; where a crest meets a trough (path difference of λ/2), they cancel into silent nodal lines. Solving the 2D wave equation directly reveals Young’s double-slit fringes, single-slit diffraction envelopes, and wavefront bending across refractive media.',
      equations: [
        {
          label: '2D Scalar Wave Equation',
          latex: '\\frac{\\partial^2 u}{\\partial t^2} = c(x,y)^2 \\left(\\frac{\\partial^2 u}{\\partial x^2} + \\frac{\\partial^2 u}{\\partial y^2}\\right)',
          explanation:
            'Integrated via 2nd-order Finite-Difference Time-Domain (FDTD) with spatially varying speed c(x,y) = c₀ / n(x,y).',
        },
        {
          label: 'Double-Slit Constructive Interference',
          latex: 'd\\sin\\theta = m\\lambda \\qquad \\Longrightarrow \\qquad \\Delta y \\approx \\frac{\\lambda L}{d}',
          explanation:
            'Bright maxima appear on the right detector screen whenever the path-length difference between the two slits is an integer multiple m of wavelength λ.',
        },
        {
          label: 'Single-Slit Diffraction Minima',
          latex: 'a\\sin\\theta = m\\lambda \\quad (m = \\pm 1, \\pm 2, \\dots)',
          explanation:
            'Narrowing aperture width a increases angular spreading—waves bend dramatically around obstacles comparable to their wavelength λ.',
        },
        {
          label: 'Snell’s Law of Refraction',
          latex: 'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2, \\qquad \\lambda_2 = \\frac{\\lambda_1}{n_2 / n_1}',
          explanation:
            'Entering a higher-index medium slows the wave while keeping frequency f constant, compressing wavelength λ and bending the wavefront toward the normal.',
        },
      ],
      assumptions: [
        '2D scalar wave field on a 180×112 grid with Courant number cΔt/Δx ≤ 0.46 < 1/√2 for strict numerical stability.',
        'Outer 8-cell boundary uses a damped absorbing sponge layer to minimize artificial tank-wall reflections.',
        'Detector screen plots time-averaged wave energy I(y) ∝ ⟨u²⟩ along the right sensor column.',
      ],
      experiments: [
        {
          title: 'Inverse Scaling of Fringe Spacing (Δy ∝ λ/d)',
          prompt:
            'In Double Slit mode, increase Slit Separation d from 14 to 40 cells and watch the pink Screen I(y) intensity curve on the right.',
          takeaway:
            'Moving the slits farther apart packs interference fringes closer together! Increasing Wave Frequency (shorter λ) similarly tightens the fringe spacing.',
        },
        {
          title: 'Phase Inversion (180° Destructive Center)',
          prompt:
            'Switch to "Two Point Sources" and slide Source Phase Offset Δφ from 0° to 180°.',
          takeaway:
            'At Δφ = 0°, equidistant points along the centerline interfere constructively (bright central peak). At 180°, the two sources cancel along the centerline, creating a permanent dark nodal line!',
        },
        {
          title: 'Visualizing Snell’s Law & Wavelength Compression',
          prompt:
            'Select "Snell’s Refraction" and sweep Medium Refractive Index n₂ from 1.00 up to 2.20.',
          takeaway:
            'Watch the wavefronts slow down, compress closer together (shorter λ), and pivot toward the interface normal—plus notice the faint partial reflection bouncing back into air!',
        },
      ],
    },
  },
  {
    id: 'charged-particles',
    title: 'Charged Particles in E & B Fields',
    subtitle:
      'Steer protons and ions with the Lorentz force: cyclotron orbits, E × B drift, a velocity selector, and a mass spectrometer that separates the isotopes of neon.',
    domain: 'electromagnetism',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 5',
    tags: ['Lorentz Force', 'Cyclotron Motion', 'E × B Drift', 'Mass Spectrometry', 'Boris Pusher'],
    equationPreview: '\\mathbf{F} = q\\left(\\mathbf{E} + \\mathbf{v} \\times \\mathbf{B}\\right)',
    summary:
      'Launch real particles (protons, alphas, H⁻ ions) at ~100 km/s through millitesla fields, then weigh neon isotopes the way J.J. Thomson did in 1913.',
    component: ChargedParticlesLab,
    theory: {
      overview:
        'Every electromagnetic effect on a charge is summarized by the Lorentz force. The electric part qE pushes along the field and changes the particle’s speed. The magnetic part qv × B is always perpendicular to the velocity, so it bends the path but never does work. In a uniform magnetic field this produces a circular orbit whose period does not depend on speed. Adding a perpendicular electric field makes the orbit drift sideways at E/B for every particle, whatever its charge or mass. Combining the two effects gives two classic instruments: a velocity selector that passes only one speed, and a mass spectrometer that sorts ions by mass.',
      equations: [
        {
          label: 'Lorentz Force Law',
          latex: 'm\\frac{d\\mathbf{v}}{dt} = q\\left(\\mathbf{E} + \\mathbf{v} \\times \\mathbf{B}\\right)',
          explanation:
            'Because v × B is perpendicular to v, the magnetic force does zero work (F·v = 0). Only the electric field can change a particle’s kinetic energy.',
        },
        {
          label: 'Cyclotron Radius & Period',
          latex: 'r_L = \\frac{m v_\\perp}{|q| B}, \\qquad T = \\frac{2\\pi m}{|q| B}',
          explanation:
            'Faster particles move on bigger circles but take exactly the same time per lap. That speed independence is why Lawrence’s cyclotron (1932) can use a fixed-frequency accelerating voltage.',
        },
        {
          label: 'E × B Drift',
          latex: '\\mathbf{v}_d = \\frac{\\mathbf{E} \\times \\mathbf{B}}{B^2}',
          explanation:
            'q and m cancel, so every particle drifts at the same velocity, perpendicular to both fields. Positive and negative charges loop in opposite senses but drift the same way.',
        },
        {
          label: 'Velocity Selector + Mass Spectrometer',
          latex: 'v = \\frac{E}{B_1}, \\qquad m = \\frac{q B_2 D}{2v} = \\frac{q B_1 B_2 D}{2E}',
          explanation:
            'Crossed fields pass only ions whose electric and magnetic forces cancel. A second field B₂ bends those ions on semicircles of diameter D = 2r ∝ m, so the landing position reveals the mass.',
        },
      ],
      assumptions: [
        'Solved with the Boris pusher (half electric kick, exact magnetic rotation, half electric kick). In a pure magnetic field speed is conserved to machine precision. In combined fields KE + qφ stays bounded instead of drifting.',
        'Non-relativistic: at ~100 km/s, v/c ≈ 3 × 10⁻⁴ and the relativistic correction to the mass is below 10⁻⁷.',
        'Uniform fields with sharp edges (no fringe fields at the ends of plates or magnets). Real instruments need edge corrections.',
        'Single particles in vacuum: no collisions with gas, no space charge (ion–ion repulsion), and no radiation from the accelerating charge.',
        'Motion stays in the plane perpendicular to B (no velocity component along B, so no helical motion). Simulated time runs 10⁶ times slower than real time: 1 µs per second at 1x.',
      ],
      experiments: [
        {
          title: 'The Speed-Independent Period',
          prompt:
            'Choose "Cyclotron Orbit" and read the radius and period. Raise Launch Speed from 100 to 150 km/s. Then set it back to 100, switch to Alpha α²⁺ (its orbit no longer fits), and double B to 40 mT.',
          takeaway:
            'At 150 km/s the radius grows 1.5× but the measured period stays at 3.28 µs: a bigger circle at a proportionally higher speed takes the same time. An alpha has twice the charge and four times the mass of a proton, so its m/q is twice as large. At double the field it retraces the proton’s circle with almost exactly the same period, because only m/q matters.',
        },
        {
          title: 'A Drift That Ignores Charge',
          prompt:
            'Choose "E × B Drift" and turn on Opposite-Charge Twin. Watch the force vectors on the proton. Then set Launch Speed to 50 km/s (= E/B).',
          takeaway:
            'The twins loop in opposite directions, one above and one below, yet they drift the same way at E/B = 50 km/s, since flipping q flips both forces. At v₀ = E/B the electric and magnetic forces cancel exactly and the particle flies straight. That is the velocity selector in a nutshell.',
        },
        {
          title: 'Weighing Neon Like J.J. Thomson',
          prompt:
            'Choose "Mass Spectrometer" and let the detector collect ions for 20–30 s (2x speed helps). Then change B₂ from 300 to 400 mT.',
          takeaway:
            'Natural neon splits into two clear peaks at 20 u and 22 u in a ~10:1 ratio, plus a faint Ne-21 trace. Thomson’s 1913 version of this experiment was the first evidence that a stable element can have isotopes. Raising B₂ shrinks every orbit, yet the calibrated masses stay put, because the measurement depends only on q, B₂, D and v.',
        },
      ],
    },
  },
  {
    id: 'quantum-tunneling',
    title: 'Quantum Tunneling & Wave Packets',
    subtitle:
      'Fire an electron wave packet at nanometre barriers and watch part of it pass through a region a classical particle could never enter.',
    domain: 'quantum',
    level: 'University',
    status: 'ready',
    phase: 'Phase 6',
    tags: ['Schrödinger Equation', 'Tunneling', 'Wave Packets', 'Resonant Tunneling', 'Crank–Nicolson'],
    equationPreview: 'i\\hbar\\frac{\\partial \\psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\psi}{\\partial x^2} + V\\psi',
    summary:
      'Solve the time-dependent Schrödinger equation live for a real electron: packet spreading, tunneling through barriers, reflection above them, and resonant tunneling through two barriers.',
    component: QuantumTunnelingLab,
    theory: {
      overview:
        'In quantum mechanics an electron is described by a wave function ψ(x, t), and |ψ|² gives the probability of finding it at x. The time-dependent Schrödinger equation moves ψ forward in time. A localized electron is a wave packet: a bundle of plane waves with a spread of momenta, and therefore of energies. Inside a barrier taller than the electron’s energy, the wave does not stop dead. It decays exponentially, so if the barrier is thin enough some of the wave emerges on the far side. This is tunneling, which drives scanning tunneling microscopes, flash memory and nuclear fusion in the Sun. The same wave nature makes an electron partly reflect even from a barrier it has enough energy to cross, and lets two barriers together pass more than one alone when the energy matches a resonance between them.',
      equations: [
        {
          label: 'Time-Dependent Schrödinger Equation',
          latex: 'i\\hbar\\frac{\\partial \\psi}{\\partial t} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2 \\psi}{\\partial x^2} + V(x)\\,\\psi',
          explanation:
            'Total probability ∫|ψ|² dx is conserved. Here ħ²/2m = 0.0381 eV·nm² for an electron, so nanometre barriers and electron-volt energies are the natural scale.',
        },
        {
          label: 'Tunneling Probability (single barrier, E < V₀)',
          latex: 'T = \\left[1 + \\frac{V_0^2 \\sinh^2(\\kappa a)}{4E(V_0 - E)}\\right]^{-1}, \\quad \\kappa = \\frac{\\sqrt{2m(V_0 - E)}}{\\hbar}',
          explanation:
            'For thick barriers T ≈ 16(E/V₀)(1 − E/V₀) e^{−2κa}: transmission falls exponentially with width. The lab averages T(E) over the packet’s energy spread to predict the measured value.',
        },
        {
          label: 'Free Packet Spreading',
          latex: '\\sigma(t) = \\sigma_0\\sqrt{1 + \\left(\\frac{\\hbar t}{2m\\sigma_0^2}\\right)^2}',
          explanation:
            'A packet of width σ₀ contains momenta spread by Δp = ħ/2σ₀, so its fastest and slowest parts separate. Narrow packets spread fastest, and Δx·Δp grows above its minimum ħ/2.',
        },
        {
          label: 'de Broglie Wavelength & Group Velocity',
          latex: '\\lambda = \\frac{h}{p} = \\frac{2\\pi}{k_0}, \\qquad v_g = \\frac{\\hbar k_0}{m}',
          explanation:
            'A 4 eV electron has λ ≈ 0.6 nm, comparable to the barriers here. That is why wave effects dominate. The packet as a whole moves at the classical speed v_g.',
        },
      ],
      assumptions: [
        'Crank–Nicolson time stepping (Δt = 0.01 fs) is unitary: total probability is conserved to about 10⁻¹². Complex absorbing potentials at both ends remove outgoing waves, and the probability they absorb is tracked exactly, so R + T + P(in barrier) = 1 to round-off.',
        'Second-order finite differences on a 0.01 nm grid. Numerical dispersion makes packets move and spread ~0.3–1% slower than the continuum formulas at 5 eV. Transmission agrees with transfer-matrix theory to within 0.005.',
        'One spinless, non-relativistic electron in one dimension, with sharp-edged rectangular barriers. Real barriers (oxide layers, STM gaps) have smooth profiles and image-charge effects.',
        'Theory curves come from continuum transfer matrices for the same piecewise-constant potential, averaged over the packet’s Gaussian momentum distribution.',
      ],
      experiments: [
        {
          title: 'Through a Forbidden Wall',
          prompt:
            'Choose "Tunneling Barrier" (E₀ = 4 eV, V₀ = 6 eV) and watch the classical particle and the packet. Then increase Barrier Width from 0.20 to 0.30 and 0.40 nm.',
          takeaway:
            'The classical particle bounces back every time, but about 18% of the wave tunnels through. Doubling the width to 0.4 nm cuts T about 15×, to roughly 1%, because the wave decays as e^{−κx} inside the barrier. That exponential sensitivity lets a scanning tunneling microscope resolve single atoms.',
        },
        {
          title: 'Spreading and the Uncertainty Principle',
          prompt:
            'Choose "Free Wave Packet" (σ₀ = 0.6 nm) and watch σ(t) and Δx·Δp. Then set σ₀ = 1.5 nm and run it again.',
          takeaway:
            'With no forces at all, the 0.6 nm packet widens about 6× before it reaches the edge, while the 1.5 nm packet grows only ~1.3×. Squeezing a packet in space broadens its momentum spread, so its parts drift apart faster. Δx·Δp starts at its minimum ħ/2 and only grows.',
        },
        {
          title: 'Two Barriers Beat One (Sometimes)',
          prompt:
            'Choose "Resonant Double Barrier" (E₀ = 2.38 eV) and compare T with the transmission spectrum. Then move E₀ to 2.0 eV and to 2.6 eV.',
          takeaway:
            'On resonance the packet passes ~34%, more than twice the ~13% one barrier alone would allow, because the wave bounces between the barriers and interferes constructively. Off resonance it drops below 1%. Resonant-tunneling diodes exploit these sharp peaks. The packet’s T stays below the plane-wave peak of 1 because only part of its energy spread fits inside the narrow resonance.',
        },
      ],
    },
  },
  {
    id: 'quantum-bound-states',
    title: 'Bound States & Energy Quantization',
    subtitle:
      'Trap an electron in a box, a spring-like potential, a finite well or a double well. Only certain energies are allowed, and superpositions of them slosh, tunnel and revive.',
    domain: 'quantum',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 6',
    tags: ['Energy Levels', 'Superposition', 'Measurement', 'Quantum Revival', 'Double-Well Tunneling'],
    equationPreview: '\\hat{H}\\varphi_n = E_n\\varphi_n, \\quad \\psi(t) = \\sum_n c_n \\varphi_n e^{-iE_n t/\\hbar}',
    summary:
      'Pick energy levels to build superpositions, measure energy or position to collapse the state, and watch a scrambled wave packet reassemble perfectly at the revival time.',
    component: QuantumBoundStatesLab,
    theory: {
      overview:
        'When an electron is confined, its wave must fit the trap, so only a discrete set of energies Eₙ is allowed. That is energy quantization, the origin of atomic spectra, quantum dots and lasers. Each allowed energy has a stationary state φₙ whose probability density never changes. Any other state is a superposition Σ cₙφₙ. Because each component’s phase rotates at its own rate Eₙ/ħ, superpositions move: the density sloshes at the Bohr frequencies (Eₙ − Eₘ)/h, which are exactly the frequencies of light the system absorbs or emits. Measuring the energy returns one Eₙ with probability |cₙ|² and leaves the electron in that stationary state.',
      equations: [
        {
          label: 'Particle in a Box',
          latex: 'E_n = \\frac{\\hbar^2\\pi^2 n^2}{2 m L^2}, \\qquad \\varphi_n(x) = \\sqrt{\\tfrac{2}{L}}\\,\\sin\\frac{n\\pi x}{L}',
          explanation:
            'A whole number of half-wavelengths must fit in the box. For an electron in a 1 nm box E₁ ≈ 0.38 eV, and the levels grow as n². There is no zero-energy state: confinement always costs kinetic energy.',
        },
        {
          label: 'Harmonic Oscillator',
          latex: 'E_n = \\hbar\\omega\\left(n + \\tfrac{1}{2}\\right), \\quad n = 0, 1, 2, \\ldots',
          explanation:
            'Evenly spaced levels mean every Bohr frequency is a multiple of ω. A displaced ground state (a coherent state) therefore swings back and forth forever without spreading, just like a classical pendulum.',
        },
        {
          label: 'Time Evolution of a Superposition',
          latex: '\\psi(x,t) = \\sum_n c_n\\,\\varphi_n(x)\\,e^{-iE_n t/\\hbar}, \\qquad P(E_n) = |c_n|^2',
          explanation:
            'For two levels the density oscillates with period h/|E₂ − E₁|. The lab evolves states exactly this way, so energy is conserved exactly and there is no time-step error.',
        },
        {
          label: 'Quantum Revival (box)',
          latex: 'T_{\\text{rev}} = \\frac{h}{E_1} = \\frac{4 m L^2}{\\pi\\hbar}',
          explanation:
            'Because every Eₙ is an integer multiple of E₁, all phases e^{−iEₙt/ħ} line up again after T_rev, and any packet reassembles exactly. At simple fractions of T_rev it appears as several smaller copies.',
        },
      ],
      assumptions: [
        'Box and oscillator use exact analytic eigenstates, so level spacings, oscillation periods and the revival are exact. Finite and double wells use eigenstates of a finite-difference Hamiltonian (Δx ≈ 3–5 pm), found by Sturm-sequence bisection and inverse iteration. Their energies match the continuum transcendental equations to within ~0.3 meV.',
        'Time evolution is spectral, ψ(t) = Σ cₙφₙe^{−iEₙt/ħ}, which is exact for a time-independent potential. Packets are expanded in up to 60 levels, and the sidebar reports if the basis captures less than 100%.',
        'The finite well sits inside a larger computational box (±4 nm) with hard walls. Only levels with E < 0 are truly bound. A sharp position measurement can kick part of the electron above the well, where it then bounces off those outer walls.',
        'A position measurement is modelled as collapse to a 0.04 nm Gaussian at a position drawn from |ψ|². An energy measurement collapses exactly onto one eigenstate with probability |cₙ|².',
        'One spinless, non-relativistic electron in one dimension. Simulated time runs 2 fs per second at 1x.',
      ],
      experiments: [
        {
          title: 'Stationary States and Collapse',
          prompt:
            'Choose "Particle in a Box" (n = 1 + 2) and compare the measured slosh period with h/ΔE. Press Measure Energy a few times, re-selecting n = 1 and 2 in between. Then try n = 1 + 3.',
          takeaway:
            'The superposition sloshes with period h/(E₂ − E₁) = 3.67 fs. A measurement returns E₁ or E₂ about half the time each, and afterwards the density freezes: a single level is a stationary state. With n = 1 + 3 the density "breathes" symmetrically instead of sloshing, because both states are even about the centre.',
        },
        {
          title: 'Tunneling Back and Forth',
          prompt:
            'Choose "Double Well". The electron starts in the left well. Watch P(left half) and the space-time picture, then raise the Barrier Width from 0.12 to 0.20 nm.',
          takeaway:
            'The electron tunnels to the right well and back with period h/(E₂ − E₁) ≈ 13 fs, even though its energy is far below the barrier. Widening the barrier shrinks the splitting exponentially, and the period nearly doubles to ~25 fs. The ammonia maser and many qubit designs use this two-state tunneling.',
        },
        {
          title: 'A Packet That Falls Apart, Then Reassembles',
          prompt:
            'Choose "Quantum Revival" and watch for about 11 fs (one revival time), using the space-time picture as a map. Then change the Box Width to 2 nm.',
          takeaway:
            'The packet bounces a few times, smears into an apparently random interference pattern, then reforms almost perfectly at T_rev = h/E₁ ≈ 11 fs. Two half-size copies appear at T_rev/2. The carpet’s fractal-looking pattern is a "quantum carpet". Doubling L makes T_rev four times longer (≈ 44 fs), since T_rev ∝ L².',
        },
      ],
    },
  },
  {
    id: 'hydrogen-atom',
    title: "Schrödinger's Hydrogen Atom & Orbitals",
    subtitle:
      'Explore the electron-cloud model that replaced Bohr’s orbits: rotate exact 1s, 2p, 3d and 4f orbitals, compare with Bohr’s radii, and emit the photons that make hydrogen’s spectrum.',
    domain: 'quantum',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 6',
    tags: ['Hydrogen Atom', 'Orbitals', 'Quantum Numbers', 'Spectral Lines', 'Selection Rules'],
    equationPreview: '\\psi_{n\\ell m} = R_{n\\ell}(r)\\,Y_{\\ell m}(\\theta,\\varphi), \\quad E_n = -\\frac{13.6\\ \\text{eV}}{n^2}',
    summary:
      'Electron clouds sampled from exact wave functions, Bohr vs. Schrödinger radii, computed selection rules and lifetimes, and a hydrogen spectrum you build one photon at a time.',
    component: HydrogenAtomLab,
    theory: {
      overview:
        'Bohr pictured the electron in hydrogen on fixed circular orbits. In 1926 Schrödinger replaced them with standing waves of the electron around the proton. Solving his equation for the Coulomb potential gives wave functions labelled by three quantum numbers: n sets the energy and size, l the shape (s, p, d, f) and m the orientation. |ψ|² is a probability cloud, not a path. The energies agree exactly with Bohr’s formula, but the electron has no orbit: a 1s electron is most likely found at Bohr’s radius a₀, yet it can be anywhere. Light is emitted when the atom is in a superposition of two levels: its charge cloud then oscillates at ΔE/h and radiates a photon of exactly that frequency. That is why hydrogen glows at only a few sharp wavelengths.',
      equations: [
        {
          label: 'Energy Levels',
          latex: 'E_n = -\\frac{m_e e^4}{8\\varepsilon_0^2 h^2}\\,\\frac{1}{n^2} \\approx -\\frac{13.6\\ \\text{eV}}{n^2}',
          explanation:
            'The energy depends only on n, so each level holds n² orbitals (all l < n and −l ≤ m ≤ l) with exactly the same energy.',
        },
        {
          label: 'Orbitals = Radial × Angular',
          latex: '\\psi_{n\\ell m} = R_{n\\ell}(r)\\,Y_{\\ell m}(\\theta, \\varphi), \\qquad P(r) = r^2 |R_{n\\ell}|^2',
          explanation:
            'R has n − l − 1 radial nodes (spheres) and Y has l angular nodes (planes or cones). For l = n − 1 the most probable radius is exactly Bohr’s n²a₀.',
        },
        {
          label: 'Photon Wavelengths (Rydberg)',
          latex: '\\frac{1}{\\lambda} = R_H\\left(\\frac{1}{n_\\text{low}^2} - \\frac{1}{n_\\text{up}^2}\\right)',
          explanation:
            'Jumps down to n = 1 give the ultraviolet Lyman series, to n = 2 the visible Balmer series (Hα at 656 nm is red), and to n = 3 the infrared Paschen series.',
        },
        {
          label: 'Selection Rule & Emission Rate',
          latex: 'A = \\frac{\\omega^3 |\\langle b|e\\mathbf{r}|a\\rangle|^2}{3\\pi\\varepsilon_0\\hbar c^3}, \\qquad \\Delta\\ell = \\pm 1',
          explanation:
            'A photon is emitted only if the superposition has an oscillating dipole, ⟨b|r|a⟩ ≠ 0, which requires Δl = ±1. The lab computes these integrals directly, so 2s → 1s comes out forbidden and the lifetimes follow from A.',
        },
      ],
      assumptions: [
        'Exact non-relativistic hydrogen eigenfunctions (Laguerre polynomials × real spherical harmonics). Fine structure, the Lamb shift and spin are ignored, so all states with the same n share one energy.',
        'Energies use the reduced-mass Rydberg R_H = 13.598 eV, so wavelengths match measured vacuum values (Hα = 656.47 nm). Lengths are in Bohr radii a₀ = 0.0529 nm.',
        'The electron cloud is an exact random sample of |ψ|²: radius drawn from r²R² by inverse CDF and direction from |Y|² by rejection. Point density is probability density.',
        'Dipole matrix elements use Simpson (radial) and Gauss–Legendre (angular) quadrature. The computed lifetimes (2p: 1.60 ns, 3p: 5.28 ns, 3s: 159 ns, 4f: 72.6 ns) agree with published values to within ~1%.',
        'A superposition is shown with equal weights, and its charge oscillation is slowed by ~10¹⁵ so you can see it. "Emit Photon" collapses the state to the lower level, a simplified picture of spontaneous emission.',
      ],
      experiments: [
        {
          title: 'Bohr Was Half Right',
          prompt:
            'Choose "Ground State 1s", turn on Bohr Orbit, and compare the cloud and the radial plot with Bohr’s circle. Repeat for n = 2, l = 1 and n = 3, l = 2.',
          takeaway:
            'The most probable radius is exactly n²a₀, Bohr’s orbit radius, and the energies match his formula too. But the electron is a cloud spread over all distances, not a particle on a track. For lower l at the same n (2s, 3s) the cloud gains radial nodes and spreads further out.',
        },
        {
          title: 'Why Hydrogen Glows Red',
          prompt:
            'Choose "Balmer Hα (3d → 2p)". Watch the cloud slosh, then press Emit Photon. Next try "Lyman α", and set up 4p + 2s to find the cyan Hβ line.',
          takeaway:
            'A superposition makes the charge cloud oscillate at ΔE/h. That oscillating dipole radiates exactly one photon wavelength: 656.47 nm for 3 → 2 (red), 121.57 nm for 2 → 1 (ultraviolet) and 486.27 nm for 4 → 2. Collect enough photons and the spectrum shows hydrogen’s fingerprint lines.',
        },
        {
          title: 'The Forbidden Transition',
          prompt:
            'Choose "Forbidden 2s → 1s" and watch the cloud, then press Emit Photon. Compare the 2p and 2s lifetimes by selecting each on its own.',
          takeaway:
            'In 2s + 1s the cloud only breathes in and out symmetrically. With no oscillating dipole, ⟨1s|r|2s⟩ = 0 and no single photon can be emitted. 2p decays in 1.6 ns, but 2s is metastable: real 2s atoms live ~0.12 s and finally decay by emitting two photons at once.',
        },
      ],
    },
  },
  {
    id: 'electron-double-slit',
    title: 'Electron Double Slit: Wave–Particle Duality',
    subtitle:
      'Send electrons through two slits one at a time. Each lands as a single dot, yet together they paint an interference pattern, until you try to watch which slit they use.',
    domain: 'quantum',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 6',
    tags: ['Wave–Particle Duality', 'Interference', 'Which-Path', 'Complementarity', 'Fresnel Diffraction'],
    equationPreview: 'P(x) = |\\psi_1(x) + \\psi_2(x)|^2 \\neq |\\psi_1|^2 + |\\psi_2|^2',
    summary:
      'Electrons build an interference pattern dot by dot (Bach et al. 2013 geometry). Close a slit, switch on a which-path detector, or move the screen in close to see the slits’ shadows.',
    component: ElectronDoubleSlitLab,
    theory: {
      overview:
        'Feynman called the double-slit experiment the "only mystery" of quantum mechanics. Every electron is detected as a single dot at one place on the screen, so it behaves like a particle. But where the dots land follows |ψ₁ + ψ₂|²: the waves from both slits add before squaring, producing bright and dark fringes no particle picture can explain. The pattern appears even when electrons pass through one at a time, so each electron interferes with itself. If anything records which slit the electron used, the interference term disappears and the screen shows just the sum of two single-slit patterns. The more which-path information is available (D), the lower the fringe visibility (V), with V² + D² ≤ 1.',
      equations: [
        {
          label: 'Adding Amplitudes, Not Probabilities',
          latex: 'P(x) = |\\psi_1 + \\psi_2|^2 = |\\psi_1|^2 + |\\psi_2|^2 + 2\\,\\mathrm{Re}(\\psi_1^* \\psi_2)',
          explanation:
            'The last term is the interference. It makes some places on the screen less likely with both slits open than with just one, which is impossible for classical particles.',
        },
        {
          label: 'de Broglie Wavelength & Fringe Spacing',
          latex: '\\lambda = \\frac{h}{p}, \\qquad \\Delta x = \\frac{\\lambda L}{d}',
          explanation:
            'A 600 eV electron has λ ≈ 50 pm, about 10,000× shorter than visible light. That is why the slits must be nanometre-scale and the fringes are only tens of micrometres apart even with a 24 cm flight path.',
        },
        {
          label: 'Single-Slit Envelope (far field)',
          latex: 'P(x) \\propto \\cos^2\\!\\left(\\frac{\\pi d x}{\\lambda L}\\right)\\,\\mathrm{sinc}^2\\!\\left(\\frac{\\pi a x}{\\lambda L}\\right)',
          explanation:
            'The fringes sit under the diffraction envelope of one slit of width a, so about 2d/a fringes fit in the central band. The lab computes the exact Fresnel integrals instead, which reduce to this formula far from the slits.',
        },
        {
          label: 'Which-Path Duality (Englert)',
          latex: 'V^2 + D^2 \\le 1',
          explanation:
            'D measures how well a detector can tell which slit was used (0 = not at all, 1 = perfectly). Perfect which-path information (D = 1) forces zero fringe visibility.',
        },
      ],
      assumptions: [
        'Each slit’s contribution is the exact paraxial (Fresnel) diffraction integral of a uniformly lit top-hat slit, evaluated with Fresnel integrals C and S. It is valid from right behind the slits to the far field, where it matches the cos²·sinc² formula to better than 10⁻⁶.',
        'Electrons arrive one at a time and never interact with each other. Each is detected at a position drawn at random from |ψ|². The vertical position along the long slits is uniform.',
        'The de Broglie wavelength uses relativistic momentum, (pc)² = E² + 2E·mc². That changes λ by 0.03% at 600 eV and 2.4% at 50 keV.',
        'A perfectly coherent, monochromatic beam and ideal slits with no charging. The which-path detector is modelled by its distinguishability D, which scales the interference term by V = √(1 − D²).',
        'Default geometry follows Bach et al., New J. Phys. 15, 033018 (2013): 600 eV electrons, 62 nm slits 272 nm apart, detector 24 cm away. The side view of the apparatus is not to scale.',
      ],
      experiments: [
        {
          title: 'One Electron at a Time',
          prompt:
            'Choose "Double Slit (Bach 2013)" at 40 electrons per second and watch the first 50 dots. Then raise the rate to 1000 /s and compare the histogram with the |ψ|² prediction.',
          takeaway:
            'Early on the dots look random, and each electron arrives whole, in one place. After a few thousand, bright and dark fringes emerge exactly where |ψ₁ + ψ₂|² predicts, every 44 µm. No electron ever lands in the dark fringes, even though each one went through alone.',
        },
        {
          title: 'Closing a Slit Adds Electrons to Dark Fringes',
          prompt:
            'Clear the screen and choose Left Only. Look at the positions that were dark fringes before. Then compare with Both Open.',
          takeaway:
            'With one slit open, electrons land at positions that were empty with two slits open. Opening a second path reduced the chance of arriving there, which only waves can do. The amber dashed curve shows what you would get if the probabilities simply added.',
        },
        {
          title: 'Watching Destroys the Pattern',
          prompt:
            'Choose "Which-Path Detector" (D = 1), let it collect, and read the fringe contrast. Then lower D to 0.8 and 0.6, clearing the screen each time.',
          takeaway:
            'With perfect which-path information the fringes vanish and the screen shows two overlapping single-slit bands. Partial information leaves partial fringes: D = 0.8 gives V = 0.6, and D = 0.6 gives V = 0.8, following V² + D² = 1. Knowing the path and seeing interference are complementary.',
        },
      ],
    },
  },
  {
    id: 'beam-bending',
    title: 'Beam Bending, Shear & Stress',
    subtitle:
      'Load steel, aluminium, titanium or timber beams and see where they bend, shear and yield: exact Euler–Bernoulli diagrams, cross-section stress profiles and a rolling load.',
    domain: 'mechanical',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 7',
    tags: ['Euler–Bernoulli', 'Shear & Moment Diagrams', 'Flexure Formula', 'Jourawski Shear', 'von Mises Yield'],
    equationPreview: 'EI\\,\\frac{d^2 w}{dx^2} = -M(x), \\qquad \\sigma = \\frac{M y}{I}',
    summary:
      'Shear force, bending moment and deflection diagrams update together as you load a beam. Inspect σ(y) and τ(y) at any section, compare I-beams, tubes and timber, roll a load across the span and balance an overhang.',
    component: BeamBendingLab,
    theory: {
      overview:
        'A beam carries load by bending. Cut it anywhere and the two pieces must hold each other in equilibrium through an internal shear force V and bending moment M. For the statically determinate beams here, statics alone fixes V(x) and M(x). The material and the shape of the cross-section decide only how much the beam bends and how highly it is stressed. Bending stress grows linearly from zero at the neutral axis to a maximum at the outer fibres, which is why I-beams put most of their material in flanges far from the axis. Shear stress is largest at the neutral axis and is carried mostly by the web. Engineers check two separate things: strength (does the stress stay below yield, with a safety margin?) and stiffness (does the beam sag less than about span/360?).',
      equations: [
        {
          label: 'Load, Shear & Moment',
          latex: '\\frac{dV}{dx} = -q(x), \\qquad \\frac{dM}{dx} = V(x)',
          explanation:
            'A downward load makes the shear diagram slope or step down, and the moment is the running area under the shear diagram. So M peaks where V crosses zero, and a point load P causes a jump of P in V and a kink in M.',
        },
        {
          label: 'Euler–Bernoulli Elastic Curve',
          latex: 'EI\\,\\frac{d^2 w}{dx^2} = -M(x), \\qquad w_{\\max} = \\frac{PL^3}{48\\,EI}',
          explanation:
            'Curvature is proportional to the moment and inversely proportional to the flexural rigidity EI (w is measured downward). Integrating twice with the support conditions gives classics like PL³/48EI for a central point load on a simply supported beam. The lab integrates exactly with Macaulay brackets ⟨x − a⟩ⁿ.',
        },
        {
          label: 'Flexure Formula',
          latex: '\\sigma = \\frac{M\\,y}{I}, \\qquad \\sigma_{\\max} = \\frac{M}{S}, \\quad S = \\frac{I}{h/2}',
          explanation:
            'Stress varies linearly through the depth: compression on one side of the neutral axis, tension on the other. Making a section deeper raises I much faster than its area, which is why beams are deep and narrow.',
        },
        {
          label: 'Transverse Shear & First Yield',
          latex: '\\tau = \\frac{V\\,Q(y)}{I\\,b(y)}, \\qquad \\sigma_{vm} = \\sqrt{\\sigma^2 + 3\\tau^2} \\le \\sigma_y',
          explanation:
            'In Jourawski’s formula, Q is the first moment of the area beyond height y and b is the width cut there. τ peaks at the neutral axis (1.5 V/A for a rectangle) and jumps where a thin web meets a wide flange. A metal first yields where the von Mises stress σ_vm reaches σ_y.',
        },
      ],
      assumptions: [
        'Euler–Bernoulli theory: plane sections stay plane and perpendicular to the neutral axis, slopes are small, and shear deformation is neglected. This is accurate for slender beams (L/h above about 10). The lab warns you when the beam is stubbier.',
        'All three support layouts are statically determinate, so the reactions, V(x) and M(x) come from statics alone and do not depend on the material. Deflections are exact closed-form Macaulay integrals. Peak values are searched on a 241-point grid plus both sides of every load and support and every zero-shear point.',
        'The material is linear-elastic, isotropic and homogeneous up to the failure criterion. Metals use von Mises first yield. Timber (glulam GL28h) is orthotropic, so it is checked separately against its bending strength f_m = 28 MPa and its much lower shear strength f_v = 3.5 MPa. Results past U = 1 are not valid.',
        'Jourawski’s τ is the average across the cut width b(y). Horizontal shear flow in the flanges, stress concentrations under point loads and supports, bearing stresses, and lateral-torsional or local buckling are not modelled. Real slender I-beams are often limited by buckling before they yield.',
        'Section shapes keep fixed proportions as the depth h changes: I-beam flanges 0.65h × 0.10h with a 0.07h web, a box 0.65h wide with 0.08h walls, a pipe with a 0.1h wall, and a rectangle 0.5h wide. The rolling load moves quasi-statically (no dynamic amplification). f₁ is the exact Euler–Bernoulli fundamental frequency of the unloaded beam, with β₁L solved numerically for the overhang. Deflections are exaggerated on screen by the factor shown top-right.',
      ],
      experiments: [
        {
          title: 'Stiffness Is Not Strength',
          prompt:
            'Load the Steel Girder, turn Self-Weight OFF and note the peak bending stress and the deflection. Switch the material to Al 6061-T6, then Ti-6Al-4V. Finally load the Timber Floor Beam and compare its safety factor with its deflection.',
          takeaway:
            'The stress stays at 53.1 MPa for every metal. M comes from statics, and σ = M/S depends only on the shape. Deflection scales with 1/E: 7.4 mm in steel, 21.6 mm in aluminium (E is 2.9× lower) and 13.1 mm in titanium. The timber beam is strong enough (n ≈ 1.6) but sags L/181, about twice the usual L/360 limit for floors. For timber floors, stiffness usually governs, not strength.',
        },
        {
          title: 'A Truck Crossing the Bridge',
          prompt:
            'Load the Steel Girder and press Play to roll the 80 kN load across the span. Watch R_A and the moment diagram, and let the dashed moment envelope build up over a full pass.',
          takeaway:
            'R_A changes linearly with the load position: the influence line of a reaction is a straight line. The moment under the load is P·a(L − a)/L, so the envelope is a parabola peaking at midspan. There the load contributes 160 kN·m and the uniform load 58.3 kN·m, 218.3 kN·m in total. That is the moment the girder must be designed for, even though the load spends most of its time elsewhere.',
        },
        {
          title: 'Balance the Overhang',
          prompt:
            'Load Overhang Balance (12 kN/m over 10 m). Slide Support B from 0.60 L towards 0.95 L while watching the moment diagram, and find the position that makes the largest |M| as small as possible.',
          takeaway:
            'At 0.60 L the hogging moment over the overhang dominates (−96 kN·m). Near 0.95 L the beam is almost simply supported (+135 kN·m sagging). The optimum is where hogging over B equals sagging in the span, at b = L/√2 ≈ 0.707 L. There |M| is only 51.5 kN·m, about a third of the 150 kN·m (qL²/8) of the same beam supported at its ends.',
        },
      ],
    },
  },
  {
    id: 'tensile-test',
    title: 'Tensile Test: Stress–Strain, Yield & Necking',
    subtitle:
      'Pull steel, aluminium, copper, titanium and a ceramic apart in a virtual testing machine. Yielding, necking and fracture emerge from the material model, not from a drawn curve.',
    domain: 'mechanical',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 7',
    tags: ['Stress–Strain Curve', 'Yield & UTS', 'Necking (Considère)', 'Lüders Bands', 'True Stress & Bridgman'],
    equationPreview: '\\sigma_t = \\sigma_e(1+e), \\qquad \\frac{d\\sigma_t}{d\\varepsilon_t} = \\sigma_t',
    summary:
      'Pull a specimen to fracture and read off E, yield strength, UTS, elongation and toughness. Watch a Lüders band sweep through steel and a neck form at the maximum load, unload and reload to see work hardening, and compare five materials on one chart.',
    component: TensileTestLab,
    theory: {
      overview:
        'The tensile test is the workhorse of materials engineering. A specimen is pulled at a steady rate while a load cell measures the force and an extensometer measures the stretch. The stress–strain curve shows, in order: a straight elastic line (Hooke’s law, slope E); yielding, where dislocations start to move (low-carbon steel shows a sharp upper yield point and a Lüders band that sweeps along the bar); uniform plastic stretching with strain hardening; necking at the maximum load; and fracture. Engineering stress divides the force by the original area, so it falls once the neck forms, while the true stress in the neck keeps rising until the specimen breaks. One curve gives stiffness, yield strength, tensile strength, ductility and toughness.',
      equations: [
        {
          label: 'Engineering vs. True Stress & Strain',
          latex: '\\sigma_e = \\frac{F}{A_0},\\;\\; e = \\frac{\\Delta L}{L_0} \\qquad \\sigma_t = \\frac{F}{A} = \\sigma_e(1+e),\\;\\; \\varepsilon_t = \\ln(1+e)',
          explanation:
            'Plastic flow conserves volume (A·L = A₀·L₀), which gives these conversions. They hold only while the gauge stretches uniformly. After necking, the true values must come from the neck’s own area, ε_t = ln(A₀/A).',
        },
        {
          label: 'Hooke’s Law, 0.2 % Offset & Resilience',
          latex: '\\sigma = E\\,e, \\qquad \\sigma_y:\\; \\sigma = E\\,(e - 0.002), \\qquad U_r = \\frac{\\sigma_y^2}{2E}',
          explanation:
            'Metals without a sharp yield point are given a yield strength where the curve crosses a line parallel to the elastic slope, offset by 0.2 % strain. The resilience is the elastic energy per volume stored up to yield.',
        },
        {
          label: 'Strain Hardening & Considère’s Criterion',
          latex: '\\sigma_t = K(\\varepsilon_0 + \\varepsilon_p)^n, \\qquad \\frac{d\\sigma_t}{d\\varepsilon_t} = \\sigma_t \\;\\Rightarrow\\; \\varepsilon_u \\approx n',
          explanation:
            'The load F = σ_t·A peaks when hardening can no longer make up for the shrinking area. For this power-law (Swift) curve that happens at a true strain of about n, the hardening exponent. So high-n copper stretches uniformly much further than low-n titanium.',
        },
        {
          label: 'Toughness & Bridgman’s Neck Correction',
          latex: 'U_T = \\int_0^{e_f} \\sigma_e\\,de, \\qquad \\sigma_{\\text{flow}} = \\frac{F/A}{(1 + 2R/a)\\,\\ln(1 + a/2R)}',
          explanation:
            'Toughness is the energy absorbed per volume up to fracture (1 MJ/m³ = 1 J/cm³). The stress in a neck is triaxial, so the average axial stress F/A overestimates the flow stress. Bridgman’s factor, with neck radius a and profile radius R, corrects for this.',
        },
      ],
      assumptions: [
        'The gauge length is a 1D bar of 80 slices that carry the same force and conserve volume. Grips, shoulders and the testing machine are rigid, and the extensometer spans the whole gauge length. Lateral contraction is followed only through each slice’s area.',
        'Each slice is elastic–viscoplastic: Hooke’s law plus plastic flow at a rate ∝ (σ_eq/σ_flow)^(1/m), with Swift hardening and m = 0.005. The rate is referenced to the nominal strain rate, so the curve does not depend on the crosshead speed.',
        'A smooth 0.5 % dip in area, about one diameter wide, at mid-gauge seeds the neck. Real necks are shaped by 3D geometry that a 1D model cannot capture, so the dip was sized to give handbook elongations for the standard 12.5 mm × 50 mm specimen. Trends with L₀ and d₀ then follow from the model.',
        'Neck triaxiality uses Bridgman’s factor with the empirical neck shape a/R = 1.1(ε − ε_u) (Le Roy et al., 1981), where ε − ε_u is the extra strain in the neck. Unloading is purely elastic (no Bauschinger effect or hysteresis).',
        'Yield-point steel: a slice must reach the upper yield stress unless a neighbouring slice has already yielded, which lets Lüders band fronts run along the bar at the lower yield stress. Real plateaus show small serrations that this model smooths out.',
        'Ductile slices break when the neck’s true strain reaches ln(1/(1 − RA)) for the material’s typical reduction of area. The ceramic breaks at a fixed 260 MPa, although real ceramics scatter widely (Weibull statistics). Properties are representative room-temperature handbook values, not certified data.',
      ],
      experiments: [
        {
          title: 'Strong, Stiff, Ductile or Tough?',
          prompt:
            'Press Overlay All Materials (or run each material in turn). Compare the slopes, the peak heights, how far each curve reaches, and the area under it. Which material is stiffest, strongest, most ductile and toughest?',
          takeaway:
            'Alumina is the stiffest (E = 370 GPa) yet breaks at 0.07 % strain. Titanium is the strongest (UTS 951 MPa) but stretches only 12 %. Copper is weak (228 MPa) but stretches 60 %. Steel combines strength and ductility and is the toughest: 156 MJ/m³, about 1,700 times alumina’s 0.09 MJ/m³. Stiffness, strength, ductility and toughness are four different properties.',
        },
        {
          title: 'Cold Work: Unload and Reload',
          prompt:
            'Run steel and press Unload to Zero when the strain reaches about 10 %. Read the permanent set, then press ▶ to reload and watch where the line bends over again.',
          takeaway:
            'Unloading follows a straight line with slope E, leaving a permanent set of about 9.8 %. On reloading the steel stays elastic up to about 394 MPa, far above its original 290 MPa yield: strain hardening (cold work) has raised the yield strength. The curve then rejoins the original one with the same UTS (415 MPa) and elongation (39.6 %). The metal remembers its plastic strain, not the cycle.',
        },
        {
          title: 'The Neck and the Gauge Length',
          prompt:
            'Run steel with True Stress–Strain ON and watch the strain profile below the chart as the load passes its maximum. Then repeat with a gauge length of 25 mm and of 100 mm.',
          takeaway:
            'Up to the UTS the whole gauge stretches evenly. Just after it, strain piles up at mid-gauge while the rest stops (Considère). The engineering stress falls, but the true stress in the neck keeps rising to about 810 MPa (about 700 MPa after Bridgman’s correction). Because the neck’s stretch is local, elongation at break depends on the gauge length: 44 % at 25 mm, 40 % at 50 mm and 36 % at 100 mm. That is why standards fix L₀ (4 d₀ in ASTM E8).',
        },
      ],
    },
  },
  {
    id: 'reaction-kinetics',
    title: 'Reaction Kinetics: Collisions, Barriers & Catalysts',
    subtitle:
      'Watch molecules collide and react one by one. Only collisions energetic enough to cross the barrier react, which explains rate laws, reaction order, the Arrhenius equation, catalysts and thermal runaway.',
    domain: 'chemistry',
    level: 'HS / University',
    status: 'ready',
    phase: 'Phase 8',
    tags: ['Collision Theory', 'Rate Laws & Order', 'Arrhenius Equation', 'Catalysis', 'Thermal Runaway'],
    equationPreview: 'k = A\\,e^{-E_a/RT}',
    summary:
      'A reactive gas of molecules in which A + B → C + D only when a collision beats the activation energy. Find the reaction order, build an Arrhenius plot from your own measured k, add a catalyst, and set off a thermal runaway.',
    component: ReactionKineticsLab,
    theory: {
      overview:
        'Why do reactions speed up so much when heated, and what does a catalyst actually do? Here the answer comes from the molecules themselves. A and B fly around a box as hard disks and react only if they collide hard enough: the kinetic energy of their approach along the line joining their centres must reach the activation energy Eₐ, and they must be suitably oriented (steric factor p). Most collisions just bounce. The share of collisions energetic enough is e^(−Eₐ/RT), which is why heating by a few hundred kelvin can multiply the rate many times, and why lowering Eₐ with a catalyst works so well. Counting molecules over time gives the rate law, its order and the rate constant; repeating at several temperatures gives an Arrhenius plot.',
      equations: [
        {
          label: 'Rate Law & Integrated Forms',
          latex:
            '-\\frac{d[A]}{dt} = k[A][B] \\qquad \\frac{1}{[A]} = \\frac{1}{[A]_0} + kt \\qquad \\ln[A] = \\ln[A]_0 - k[B]_0\\,t',
          explanation:
            'One bimolecular step makes the rate proportional to both concentrations. With equal amounts, 1/[A] grows linearly in time (second order). With B in large excess, [B] barely changes, so ln[A] falls linearly (pseudo-first order). Concentrations here are molecules per nm² of the 2D box.',
        },
        {
          label: 'Collision Theory (2D)',
          latex: 'k = \\chi\\, p\\, d \\sqrt{\\frac{2\\pi RT}{\\mu}}\\; e^{-E_a/RT}',
          explanation:
            'd is the collision diameter, μ the reduced mass, p the steric factor and χ the dense-gas boost to the collision rate (about 1.2 here). The square root is the mean relative speed. The exponential is the share of collisions energetic enough to react.',
        },
        {
          label: 'Boltzmann Share of Energetic Collisions',
          latex: 'P\\left(E_{\\text{lc}} \\ge E_a\\right) = e^{-E_a/RT}',
          explanation:
            'In two dimensions the approach energy along the line of centres follows an exact exponential distribution with mean RT, so the share of collisions that can react is simply e^(−Eₐ/RT). For a 20 kJ/mol barrier that is 0.8 % at 500 K but 9 % at 1000 K.',
        },
        {
          label: 'Arrhenius Equation',
          latex: '\\ln k = \\ln A - \\frac{E_a}{R}\\cdot\\frac{1}{T}',
          explanation:
            'A plot of ln k against 1/T is nearly straight with slope −Eₐ/R. Because the collision rate itself grows as √T, the fitted (apparent) activation energy comes out about ½RT above the barrier: roughly 23 kJ/mol for a 20 kJ/mol barrier near 700 K.',
        },
      ],
      assumptions: [
        'Molecules are identical hard disks (d = 0.5 nm, M = 30 g/mol) in a periodic 32 × 18 nm box, so the box is a window into a larger, uniform gas. Motion is integrated in steps of at most 0.025 nm, and each collision is replayed from the exact moment of contact, so collision rates and energies match hard-disk theory to within about 1 %.',
        'A reaction happens when an A–B collision’s line-of-centres energy reaches Eₐ, with probability p. The products C and D are identical disks. The reaction enthalpy is released into, or taken from, their separating motion, so momentum and total energy are conserved exactly.',
        'Heat bath: each molecule meets an inert solvent or buffer gas about every 3 ps and leaves with fresh Maxwell velocities at the bath temperature (Andersen thermostat). The insulated box has no bath, so the gas heats or cools as it reacts.',
        'The catalyst is modelled as an alternative pathway with a lower barrier and the same ΔH (a homogeneous catalyst). Real catalysts work through intermediates or surfaces, which are not simulated.',
        'With the reverse reaction on, C + D react back over a barrier of Eₐ − ΔH. For identical molecules this obeys detailed balance, so the mixture settles where [C][D]/[A][B] = K = e^(−ΔH/RT), with forward and reverse events continuing at equal rates (checked to within the counting noise). The measured k counts forward reactions only.',
        'Theory curves use the 2D collision-theory k with Henderson’s contact value χ = (1 − 7η/16)/(1 − η)². When many collisions react (Eₐ below about 3RT), reactions remove the fastest molecules faster than collisions replace them, and the measured k falls up to about 8 % below theory (the Prigogine–Xhrouet effect). With about 300 molecules, counts fluctuate visibly around the rate law, as they really do in small systems.',
        'Units are real (nm, ps, kJ/mol, K), but barriers are kept small (up to 40 kJ/mol) so reactions happen within picoseconds. Typical laboratory reactions have Eₐ = 50–100 kJ/mol and react in only about 1 of 10⁹ to 10¹⁸ collisions.',
      ],
      experiments: [
        {
          title: 'What Order Is It?',
          prompt:
            'Run Equal A and B to about 80 % conversion and switch the plot between ln[A] and 1/[A]. Then load B in Excess and compare the two plots again.',
          takeaway:
            'With equal amounts, 1/[A] vs t is the straight one (R² ≈ 0.99, against about 0.94 for ln[A]) and its slope is k: second order. With B in sixfold excess, [B] hardly changes, so ln[A] becomes the straight plot, with slope −k[B]₀. The same A + B step now looks first order. The order you measure depends on the conditions, not just on the molecules.',
        },
        {
          title: 'Heat, Barriers and Catalysts',
          prompt:
            'Let Equal A and B collect 80 or more reactions and press “Add k to plot”. Repeat at 500 K and at 1000 K (the k measurement restarts whenever T changes). Then go back to 700 K, switch on the catalyst and watch the collision-energy histogram.',
          takeaway:
            'Going from 500 K to 1000 K multiplies k about 16× (0.006 → 0.096 nm²/ps), mostly because the share of collisions above Eₐ grows from 0.8 % to 9 %. The Arrhenius slope gives Eₐ ≈ 23 ± 1 kJ/mol: the 20 kJ/mol barrier plus ½RT from the √T in the collision rate. The catalyst lowers the barrier to 10 kJ/mol, so at 700 K the energetic share jumps from 3.2 % to 18 % and k rises 5.6×, while ΔH and the products stay the same.',
        },
        {
          title: 'Thermal Runaway',
          prompt:
            'Load Thermal Runaway (insulated, ΔH = −25 kJ/mol, starting at 500 K) and watch the temperature trace in the amounts plot. Then switch the surroundings to Heat Bath with the same settings.',
          takeaway:
            'Each reaction releases heat that speeds up the next ones. The run crawls for about 100 ps, then the temperature shoots from about 600 K to 1600 K within 200 ps until the reactants run out, ending near 1960 K (the energy balance predicts 2000 K). In the heat bath the same reaction stays near 500 K, and only about a quarter of A has reacted after 800 ps. This feedback is why exothermic reactors need cooling.',
        },
      ],
    },
  },
];

export function getSimulationById(id: string): SimulationEntry | undefined {
  return SIMULATIONS.find((s) => s.id === id);
}
