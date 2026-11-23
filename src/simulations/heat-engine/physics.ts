export type EngineCycleType = 'carnot' | 'otto';

export interface EngineParams {
  cycle: EngineCycleType;
  tHot: number; // K (e.g. 600 - 1200)
  tCold: number; // K (e.g. 250 - 500)
  compressionRatio: number; // V_max / V_min (e.g. 2.5 - 8)
  gamma: number; // Cp / Cv (monatomic 1.67, diatomic 1.40, polyatomic 1.33)
}

export interface PVPoint {
  V: number; // L
  P: number; // kPa
  T: number; // K
  strokeIndex: 0 | 1 | 2 | 3;
}

export interface StrokeMeta {
  index: 0 | 1 | 2 | 3;
  name: string;
  process: string;
  heatFlow: 'in' | 'out' | 'none';
  color: string;
}

export interface CycleAnalysis {
  strokes: StrokeMeta[];
  curvePoints: PVPoint[]; // closed cycle samples
  vertices: [PVPoint, PVPoint, PVPoint, PVPoint];
  qIn: number; // kJ
  qOut: number; // kJ
  netWork: number; // kJ
  efficiency: number; // 0..1
  carnotLimit: number; // 0..1
  vMin: number;
  vMax: number;
  pMax: number;
}

const R_GAS = 8.314; // J / (mol K) -> 0.008314 kPa*L / (mol*K) -> with n=1 mol, P(kPa)*V(L) = 8.314 * T / 1000 * 1000 = 8.314 * T (since 1 kPa * 1 L = 1 J)
// Wait: 1 kPa = 1000 Pa, 1 L = 0.001 m^3 => 1 kPa * L = 1 Joule!
// So for n = 1 mol: P (kPa) * V (L) = R_GAS * T (J) = 8.314 * T! Super clean!

export function analyzeCycle(params: EngineParams): CycleAnalysis {
  const { cycle, tHot, tCold, compressionRatio, gamma } = params;
  const n = 1.0; // 1 mol ideal gas
  const cv = R_GAS / (gamma - 1); // J/(mol K)
  const vMin = 1.0; // L

  if (cycle === 'carnot') {
    // State 1: (V1 = vMin, T = tHot) -> Isothermal expansion to V2
    // State 2 -> 3: Adiabatic expansion from T_H to T_C
    // State 3 -> 4: Isothermal compression at T_C
    // State 4 -> 1: Adiabatic compression from T_C to T_H
    const adiabaticFactor = Math.pow(tHot / tCold, 1 / (gamma - 1));
    // Ensure expansion ratio r_iso > 1.25 so loop is visibly clear
    const vMax = vMin * Math.max(compressionRatio, adiabaticFactor * 1.35);
    const v3 = vMax;
    const v4 = vMin * adiabaticFactor;
    const v2 = v3 / adiabaticFactor;
    const v1 = vMin;

    const p1 = (n * R_GAS * tHot) / v1;
    const p2 = (n * R_GAS * tHot) / v2;
    const p3 = (n * R_GAS * tCold) / v3;
    const p4 = (n * R_GAS * tCold) / v4;

    const vertices: [PVPoint, PVPoint, PVPoint, PVPoint] = [
      { V: v1, P: p1, T: tHot, strokeIndex: 0 },
      { V: v2, P: p2, T: tHot, strokeIndex: 1 },
      { V: v3, P: p3, T: tCold, strokeIndex: 2 },
      { V: v4, P: p4, T: tCold, strokeIndex: 3 },
    ];

    const strokes: StrokeMeta[] = [
      {
        index: 0,
        name: '1 → 2 Isothermal Expansion',
        process: 'Heat absorbed from Hot Reservoir (T = T_H)',
        heatFlow: 'in',
        color: '#fb7185',
      },
      {
        index: 1,
        name: '2 → 3 Adiabatic Expansion',
        process: 'Insulated expansion; gas cools T_H → T_C (Q = 0)',
        heatFlow: 'none',
        color: '#a78bfa',
      },
      {
        index: 2,
        name: '3 → 4 Isothermal Compression',
        process: 'Heat rejected to Cold Reservoir (T = T_C)',
        heatFlow: 'out',
        color: '#38bdf8',
      },
      {
        index: 3,
        name: '4 → 1 Adiabatic Compression',
        process: 'Insulated compression; gas heats T_C → T_H (Q = 0)',
        heatFlow: 'none',
        color: '#c084fc',
      },
    ];

    const samplesPerStroke = 36;
    const curvePoints: PVPoint[] = [];

    // 1 -> 2 Isothermal at T_H
    for (let i = 0; i < samplesPerStroke; i++) {
      const f = i / samplesPerStroke;
      const V = v1 + (v2 - v1) * f;
      curvePoints.push({ V, P: (n * R_GAS * tHot) / V, T: tHot, strokeIndex: 0 });
    }
    // 2 -> 3 Adiabatic
    const c23 = p2 * Math.pow(v2, gamma);
    for (let i = 0; i < samplesPerStroke; i++) {
      const f = i / samplesPerStroke;
      const V = v2 + (v3 - v2) * f;
      const P = c23 / Math.pow(V, gamma);
      curvePoints.push({ V, P, T: (P * V) / (n * R_GAS), strokeIndex: 1 });
    }
    // 3 -> 4 Isothermal at T_C
    for (let i = 0; i < samplesPerStroke; i++) {
      const f = i / samplesPerStroke;
      const V = v3 + (v4 - v3) * f;
      curvePoints.push({ V, P: (n * R_GAS * tCold) / V, T: tCold, strokeIndex: 2 });
    }
    // 4 -> 1 Adiabatic
    const c41 = p4 * Math.pow(v4, gamma);
    for (let i = 0; i < samplesPerStroke; i++) {
      const f = i / samplesPerStroke;
      const V = v4 + (v1 - v4) * f;
      const P = c41 / Math.pow(V, gamma);
      curvePoints.push({ V, P, T: (P * V) / (n * R_GAS), strokeIndex: 3 });
    }

    const qIn = (n * R_GAS * tHot * Math.log(v2 / v1)) / 1000; // kJ
    const qOut = (n * R_GAS * tCold * Math.log(v3 / v4)) / 1000; // kJ
    const netWork = qIn - qOut;
    const efficiency = 1 - tCold / tHot;

    return {
      strokes,
      curvePoints,
      vertices,
      qIn,
      qOut,
      netWork,
      efficiency,
      carnotLimit: efficiency,
      vMin,
      vMax: v3,
      pMax: p1,
    };
  }

  // Otto Cycle (Spark-Ignition Ideal Engine)
  // State 1 (BDC, V_max, T_1 = tCold) -> 1->2 Adiabatic Compression to V_min
  // State 2 -> 3 Isochoric Heat Addition to T_3 = tHot
  // State 3 -> 4 Adiabatic Power Expansion to V_max
  // State 4 -> 1 Isochoric Heat Rejection back to T_1
  const r = compressionRatio;
  const vMax = vMin * r;
  const t1 = tCold;
  const t2 = t1 * Math.pow(r, gamma - 1);
  // Ensure peak combustion temperature T3 stays strictly above T2
  const t3 = Math.max(tHot, t2 + 120);
  const t4 = t3 / Math.pow(r, gamma - 1);

  const p1 = (n * R_GAS * t1) / vMax;
  const p2 = (n * R_GAS * t2) / vMin;
  const p3 = (n * R_GAS * t3) / vMin;
  const p4 = (n * R_GAS * t4) / vMax;

  const vertices: [PVPoint, PVPoint, PVPoint, PVPoint] = [
    { V: vMax, P: p1, T: t1, strokeIndex: 0 },
    { V: vMin, P: p2, T: t2, strokeIndex: 1 },
    { V: vMin, P: p3, T: t3, strokeIndex: 2 },
    { V: vMax, P: p4, T: t4, strokeIndex: 3 },
  ];

  const strokes: StrokeMeta[] = [
    {
      index: 0,
      name: '1 → 2 Adiabatic Compression',
      process: 'Piston compresses fuel-air mixture rapidly (Q = 0)',
      heatFlow: 'none',
      color: '#a78bfa',
    },
    {
      index: 1,
      name: '2 → 3 Isochoric Ignition',
      process: 'Constant-volume combustion adds Q_H; pressure spikes',
      heatFlow: 'in',
      color: '#fb7185',
    },
    {
      index: 2,
      name: '3 → 4 Adiabatic Power Stroke',
      process: 'High-pressure gas drives piston down, doing work (Q = 0)',
      heatFlow: 'none',
      color: '#f59e0b',
    },
    {
      index: 3,
      name: '4 → 1 Isochoric Exhaust',
      process: 'Constant-volume heat rejection Q_C drops pressure',
      heatFlow: 'out',
      color: '#38bdf8',
    },
  ];

  const samplesPerStroke = 36;
  const curvePoints: PVPoint[] = [];

  // 1 -> 2 Adiabatic Compression
  const c12 = p1 * Math.pow(vMax, gamma);
  for (let i = 0; i < samplesPerStroke; i++) {
    const f = i / samplesPerStroke;
    const V = vMax + (vMin - vMax) * f;
    const P = c12 / Math.pow(V, gamma);
    curvePoints.push({ V, P, T: (P * V) / (n * R_GAS), strokeIndex: 0 });
  }
  // 2 -> 3 Isochoric Heat Addition
  for (let i = 0; i < samplesPerStroke; i++) {
    const f = i / samplesPerStroke;
    const P = p2 + (p3 - p2) * f;
    curvePoints.push({ V: vMin, P, T: (P * vMin) / (n * R_GAS), strokeIndex: 1 });
  }
  // 3 -> 4 Adiabatic Expansion
  const c34 = p3 * Math.pow(vMin, gamma);
  for (let i = 0; i < samplesPerStroke; i++) {
    const f = i / samplesPerStroke;
    const V = vMin + (vMax - vMin) * f;
    const P = c34 / Math.pow(V, gamma);
    curvePoints.push({ V, P, T: (P * V) / (n * R_GAS), strokeIndex: 2 });
  }
  // 4 -> 1 Isochoric Exhaust
  for (let i = 0; i < samplesPerStroke; i++) {
    const f = i / samplesPerStroke;
    const P = p4 + (p1 - p4) * f;
    curvePoints.push({ V: vMax, P, T: (P * vMax) / (n * R_GAS), strokeIndex: 3 });
  }

  const qIn = (n * cv * (t3 - t2)) / 1000;
  const qOut = (n * cv * (t4 - t1)) / 1000;
  const netWork = qIn - qOut;
  const efficiency = 1 - 1 / Math.pow(r, gamma - 1);
  const carnotLimit = 1 - t1 / t3;

  return {
    strokes,
    curvePoints,
    vertices,
    qIn,
    qOut,
    netWork,
    efficiency,
    carnotLimit,
    vMin,
    vMax,
    pMax: p3,
  };
}

export function sampleCycleAtPhase(analysis: CycleAnalysis, phase: number): PVPoint {
  const pts = analysis.curvePoints;
  const wrapped = ((phase % 1) + 1) % 1;
  const exact = wrapped * pts.length;
  const i0 = Math.floor(exact) % pts.length;
  const i1 = (i0 + 1) % pts.length;
  const t = exact - Math.floor(exact);
  const a = pts[i0];
  const b = pts[i1];
  return {
    V: a.V + (b.V - a.V) * t,
    P: a.P + (b.P - a.P) * t,
    T: a.T + (b.T - a.T) * t,
    strokeIndex: a.strokeIndex,
  };
}
