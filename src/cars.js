// Car data: everything that differs between vehicles (physics + audio character). Visuals live in carModel.js / carImpreza.js.
// Car-local axes: +Z forward, +Y up, +X = car's LEFT. Origin = centre of mass.

export const WHEEL_NAMES = [
  { id: 'FL', name: '左前', left: true, front: true },
  { id: 'FR', name: '右前', left: false, front: true },
  { id: 'RL', name: '左後', left: true, front: false },
  { id: 'RR', name: '右後', left: false, front: false },
];

export const CARS = {
  nbox: {
    id: 'nbox',
    label: 'N-BOX Custom 4WD',
    short: 'N-BOX',
    note: 'Honda N-BOX Custom Turbo 4WD (JF6): 3395x1475x1815, WB 2520, track 1295, 1000kg, 64ps/104Nm, CVT',
    vsaName: 'VSA', // Honda VSA incl. traction control (standard on N-BOX; from memory)
    mass: 1000,
    tireR: 0.28, // 165/55R15
    tireW: 0.165,
    axleF: 1.26,
    axleR: -1.26,
    trackF: 1.295,
    trackR: 1.295,
    connY: -0.3, // suspension top, car-local
    engineForce: 4800, // N: 104Nm x 3.152 x 4.619 x 0.9 / 0.281m
    shareFront: 0.55, // on-demand 4WD, front biased
    diffBias: 1.6,
    steerMax: 0.55,
    hook: [0, -0.45, 1.72],
    spawnY: 0.55,
    // collision: low box up to the hood line + cabin box
    shapes: [
      { half: [0.7375, 0.4525, 1.7], at: [0, -0.1225, 0] },
      { half: [0.7375, 0.3825, 0.945], at: [0, 0.7125, -0.745] },
    ],
    audio: { firing: 1.5, turbo: true, boxer: false, idle: 780, thr: 3300, speed: 1600 },
  },
  impreza: {
    id: 'impreza',
    label: 'インプレッサ スポーツワゴン 2.0 AWD',
    short: 'インプレッサ',
    note: 'Subaru Impreza Sports Wagon GG 2.0 NA AWD (TA-GG9, 2003): 4415x1695x1470, WB 2525, track 1465/1455, 1330kg, 155ps/196Nm, 5MT',
    vsaName: null, // no VDC / traction control on this 2003 2.0 NA grade (from memory, not checked against a source)
    mass: 1330,
    tireR: 0.3075, // 195/60R15
    tireW: 0.195,
    // front-heavy boxer: COM 1.06 m behind the front axle (assumed 58:42, not in any source)
    axleF: 1.06,
    axleR: -1.465,
    trackF: 1.465,
    trackR: 1.455,
    connY: -0.0802, // ground at -0.52 (COM height), wheel centre -0.2125, suspension top above it
    engineForce: 6600, // N: 196Nm x 3.454 x 3.333 x 0.9 / 0.3075m
    shareFront: 0.5, // symmetrical AWD, centre diff + viscous LSD
    diffBias: 2.0, // rear LSD / viscous coupling
    steerMax: 0.45, // 5.4 m turning radius
    hook: [0, -0.3, 1.93],
    spawnY: 0.55,
    shapes: [
      // body from the floor (150 mm clearance, assumed) to the hood line, 4415 long
      { half: [0.8475, 0.375, 2.2075], at: [0, 0.005, -0.2475] },
      // cabin: roof 1470 above ground
      { half: [0.72, 0.285, 1.39], at: [0, 0.665, -0.99] },
    ],
    audio: { firing: 2.0, turbo: false, boxer: true, idle: 800, thr: 3600, speed: 1900 },
  },
  hustler: {
    id: 'hustler',
    label: 'ハスラー HYBRID X 4WD',
    short: 'ハスラー',
    note: 'Suzuki Hustler HYBRID X 4WD (MR52S): 3395x1475x1680, WB 2460, 165/60R15, 658cc NA 49ps/58Nm, CVT; values from memory, not checked against a source',
    vsaName: 'ESP', // Suzuki ESP (standard on the MR52S, from memory); modelled with the same traction-cut as VSA
    mass: 850, // approx. kerb weight of the 4WD hybrid, from memory
    stiffness: 20, // softer than the default 28: with 28 the light body bounced on the jack (picked by trial, not a real spring rate)
    tireR: 0.2895, // 165/60R15
    tireW: 0.165,
    // front-heavy kei (engine up front): COM 1.08 m behind the front axle (assumed ~56:44)
    axleF: 1.08,
    axleR: -1.38,
    trackF: 1.285,
    trackR: 1.295,
    connY: -0.2, // ground at -0.62 (COM height, assumed), wheel centre -0.3305, suspension top 0.13 above it
    engineForce: 2600, // N: 58Nm x ~14.5 (CVT low x final, assumed) x 0.9 / 0.2895m
    shareFront: 0.55, // on-demand 4WD, front biased (split assumed)
    diffBias: 1.6,
    steerMax: 0.53, // 4.6 m turning radius
    hook: [0, -0.34, 1.66],
    spawnY: 0.55,
    // collision: body from the floor (180 mm clearance, assumed) to the hood line + cabin box
    shapes: [
      { half: [0.7375, 0.385, 1.6975], at: [0, -0.055, -0.0675] },
      { half: [0.70, 0.365, 1.0325], at: [0, 0.695, -0.68] },
    ],
    audio: { firing: 1.5, turbo: false, boxer: false, idle: 760, thr: 3300, speed: 1700 },
  },
};

export const DEFAULT_CAR = 'nbox';

/** wheel layout of a car: [{id,name,x,z,front}] in the order FL, FR, RL, RR */
export function wheelDefsFor(car) {
  return WHEEL_NAMES.map((w) => {
    const track = w.front ? car.trackF : car.trackR;
    return { id: w.id, name: w.name, x: (w.left ? 1 : -1) * (track / 2), z: w.front ? car.axleF : car.axleR, front: w.front };
  });
}
