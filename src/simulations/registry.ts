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
];

export function getSimulationById(id: string): SimulationEntry | undefined {
  return SIMULATIONS.find((s) => s.id === id);
}
