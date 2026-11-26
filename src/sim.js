// StackRunner physics core (no DOM / no rendering) -- runs in browser and node.
// World: +Y up, car faces +Z. Car's LEFT side = +X, RIGHT side = -X.
// Car spec (Honda N-BOX Custom Turbo 4WD, JF6): 3395x1475x1815mm, WB 2520, track 1295, ground clearance 145,
// curb weight 1000kg, 658cc turbo 47kW/6000rpm 104Nm/2600rpm, CVT (1st 3.152, final 4.619), 165/55R15.
// Stages: 'ditch' = car dropped its left wheels into a mud-bottomed side ditch pocket (x>3).
//         'winter' = car slid off a packed-snow road into a plow berm + powder drift (x>3); dig it out with the scoop.
import * as CANNON from 'cannon-es';
import { CARS, DEFAULT_CAR, wheelDefsFor } from './cars.js';

export { CARS };

const { Vec3, Quaternion, Body, Box } = CANNON;

export const DT = 1 / 120;

// How the car fell in: ditch depth (m), pocket half-length (m, limits the run-up), start yaw toward the ditch (rad), mud friction.
// Winter stage extras: snow = drift depth (m), berm = extra height of the plow ridge beside the road (m),
// rho = initial density of the drift (kg/m3), wyaw = start yaw (rad).
export const LEVELS = {
  normal: { label: '標準', depth: 0.32, pocket: 6, yaw: 0, mud: 0.07, snow: 0.18, berm: 0.26, rho: 170, wyaw: 0 },
  hard: { label: '高難度', depth: 0.38, pocket: 6, yaw: 0, mud: 0.06, snow: 0.2, berm: 0.3, rho: 140, wyaw: 0 },
  extreme: { label: '鬼', depth: 0.44, pocket: 6, yaw: 0.2, mud: 0.06, snow: 0.2, berm: 0.32, rho: 120, wyaw: 0.1 },
};

export const STAGES = {
  ditch: { label: '側溝', goal: ['road'], intro: 'の左輪が側溝のぬかるみに落ちた。道具を使って脱出しよう' },
  winter: { label: '冬道', goal: ['packed'], intro: 'が除雪の雪山と吹きだまりにはまった。スコップで雪を掘って圧雪路へ戻ろう' },
};

export const WHEEL_DEFS = wheelDefsFor(CARS[DEFAULT_CAR]); // names / sides; per-car positions: sim.wheelDefs

// friction coefficient per surface kind
export const GRIP = { road: 1.0, grass: 0.55, mud: 0.07, helper: 1.25, mat: 0.7, packed: 0.42, snow: 0.28, bare: 0.38 };
// how soft a surface is: soft tyres dig themselves in when they spin
const SOFT = { mud: 1, grass: 0.3, snow: 0.3 }; // snow cells compute their own softness from density
export const SURFACE_LABEL = {
  road: 'アスファルト',
  grass: '草地',
  mud: 'ぬかるみ',
  helper: 'スノーヘルパー',
  mat: 'フロアマット',
  packed: '圧雪路',
  snow: '雪原',
  drift: '吹きだまり(新雪)',
  crust: '踏み固めた雪',
  ice: '氷',
  bare: '凍った路肩',
  air: '浮いている',
};

// the scoop is a tool, not a stock item: each dig takes `depth` metres off one snow cell
export const SCOOP = { label: 'スコップ', depth: 0.12, time: 0.45 };
const CELL = 0.5; // winter stage: size of one diggable snow cell

// ---- snow model (game-scale simplification of real snow behaviour; the numbers are tuned, not measured)
// Each cell keeps its snow mass per area m = rho * h (kg/m2). Compaction raises the density rho and lowers the
// height h at constant mass (so the ground sinks under a tyre); digging and pushing change the mass.
const RHO_ICE = 917; // kg/m3, solid ice
const PATCH = 0.023; // m2, tyre contact patch (width x ~14 cm)
const BELLY_AREA = 0.1; // m2, assumed contact area of the underbody resting on a snow cell
const COMPACT_TAU = 4; // s, relaxation time toward the density a given pressure can reach
const SHEAR_RATE = 60; // kg/m3 per s of wheelspin (shear + frictional heating densify snow much faster than load alone)
const GLAZE_RATE = 0.2; // 1/s, polished ice film on dense snow under a spinning tyre
const PUSH_COMPACT = 1.12; // density factor each time snow is bulldozed (pushed snow is packed)
const RIDGE_RHO = 260; // kg/m3, plowed snow in the ridge (denser than the wind-blown drift)
const PUSH_TAU = 0.25; // s, smoothing of the push force on a cell
const MAX_CONTACT_F = 20000; // N, cap on one contact force sample
const H_MAX = 1.2; // m, a pushed pile cannot grow higher than this
const MIN_BODY_H = 0.03; // m, thinner layers have no collision body (the tyre rides on the ground below)
/** density (kg/m3) that a pressure p (Pa) alone can pack snow to: ~230 under a parked tyre, ~290 at 1.6x the load (packing it
 *  further takes wheelspin / repeated shear, see SHEAR_RATE) */
const rhoEq = (p) => 100 + (RHO_ICE - 100) * (1 - Math.exp(-p / 600000));
const lerpTable = (t, x) => {
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return t[i - 1][1] + ((x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])) * (t[i][1] - t[i - 1][1]);
  return t[t.length - 1][1];
};
// friction coefficient vs density: loose powder < packed snow (best) > ice
const SNOW_MU = [[80, 0.12], [150, 0.14], [300, 0.3], [450, 0.42], [650, 0.34], [917, 0.16]];
const snowGrip = (c) => lerpTable(SNOW_MU, c.rho) * (1 - 0.5 * c.glaze * Math.min(1, Math.max(0, (c.rho - 500) / 300)));
/** how much a tyre digs in: powder 1, 0 once the snow is dense enough to carry the tyre */
const snowSoft = (rho) => Math.min(1, Math.max(0, (420 - rho) / 300));
const snowKind = (c) => (c.rho < 260 ? 'drift' : c.rho < 720 && c.glaze < 0.5 ? 'crust' : 'ice');
/** how far one scoop stroke goes: hard snow resists (roughly with density), ice only chips */
const scoopDepth = (rho) => Math.max(0.01, SCOOP.depth * (150 / Math.max(rho, 150)) ** 1.0);
/** crushing force (N) a bulldozing car needs to push a cell: grows with density^2 and with height */
const pushYield = (c) => 900 * (c.rho / 150) ** 2 * (c.h / 0.3);
const SNOW_X0 = 3;
const SNOW_X1 = 8;
const SNOW_POCKET = 5; // winter pocket half-length (m)

export const ITEM_SPECS = {
  helper: { label: 'スノーヘルパー', half: [0.15, 0.02, 0.55], stock: 2 },
  mat: { label: 'フロアマット', half: [0.2, 0.01, 0.27], stock: 4 },
};

export const PLACE_DIRS = {
  front: { label: '前', angle: 0 },
  diagFront: { label: '斜め前(内側)', angle: 45 },
  inside: { label: '内側', angle: 90 },
  diagBack: { label: '斜め後(内側)', angle: 135 },
  back: { label: '後', angle: 180 },
  under: { label: '真下', angle: null },
};

const FOOT_BRAKE = 20; // brake impulse limit per wheel per step (~0.75 g total)
const MAX_SPEED = 15; // m/s soft limit
const TRUCK_X = -1.2;
const TRUCK_Z0 = 4.2;
const ROPE_K = 7000;
const ROPE_C = 1200;
const ROPE_BREAK = 6500;
const TRUCK_PULL_MAX = 2800;
const JACK_MAX_LIFT = 0.3; // a bottle/scissor jack under the sill: enough to float a tyre hanging in a ditch
const JACK_CLOSE_RATE = 10; // 1/s  how fast a corner that sank below the jack head is brought back up
const JACK_MAX_PUSH_SPEED = 0.1; // m/s  limit of that correction
const JACK_FMAX = 30000; // N  safety only: the head is a rigid column; what keeps the car from being launched is the slow head speed (JACK_MAX_PUSH_SPEED)
const JACK_MIN_UP = 0.84; // body up-vector y below this (~33 deg tilt): the jack stops pushing
const JACK_BODY_DAMPING = 0.6; // angular damping while jacked
const ITEM_REACH = 2.4; // m from the nearest tyre: how far the player can reach
const TYRE_UNDER_CLEARANCE = 0.34; // an item centre closer than this to a tyre counts as 'directly under' it
const BASE_REST = 0.22; // suspension rest length
const DIG_RATE = 0.05; // per second at full wheelspin on mud (about 20 s of continuous spin to bury a tyre)
const DIG_SINK = 0.08; // m the wheel sinks at full dig

// trunks are solid obstacles (visuals live in main.js)
export const TREES = [[-9, -6], [-11, 5], [-8, 14], [-12, -16], [10, 12], [12, -10], [9, -18], [-10, 24]];
export const TRUCK_HALF = [0.72, 0.8, 1.65];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Sim {
  constructor(opts = {}) {
    this.car = CARS[opts.car ?? DEFAULT_CAR];
    this.wheelDefs = wheelDefsFor(this.car);
    this.hookLocal = new Vec3(...this.car.hook);
    this.stageKey = opts.stage ?? 'ditch';
    this.stage = STAGES[this.stageKey];
    this.levelKey = opts.level ?? 'normal';
    this.level = { ...LEVELS[this.levelKey], ...(opts.override ?? {}) };
    this.world = new CANNON.World({ gravity: new Vec3(0, -9.82, 0) });
    this.world.allowSleep = false;
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0;

    this.time = 0;
    this.input = { throttle: 0, steer: 0, brake: false };
    this.vsa = !!(CARS[opts.car ?? DEFAULT_CAR].vsaName); // cars without a stability / traction control have nothing to switch on
    this.sideBrake = false; // parking brake (electric switch style, latched): locks the rear wheels
    this.autoHold = false;
    this.steer = 0;
    this.messages = [];
    this.events = []; // one-shot sound/FX triggers consumed by the UI
    this.items = [];
    this.stock = { helper: ITEM_SPECS.helper.stock, mat: ITEM_SPECS.mat.stock };
    this.jack = null;
    this.rope = null;
    this.pulling = false;
    this.truckZ = TRUCK_Z0;
    this.truckStalled = false;
    this.dig = [0, 0, 0, 0]; // how deep each tyre has dug itself in (0..1)
    this.digWarned = [false, false, false, false];
    this.misses = 0;
    this.won = false;
    this.winTimer = 0;
    this.flipTimer = 0;
    this.flipped = false;
    this.playing = false;
    this.wheelState = this.wheelDefs.map(() => ({ grip: 0, load: 0, surface: 'air', spinning: false, air: true, dig: 0 }));
    this.lastSpinMsg = -10;
    this.lastBrakeMsg = -10;
    this.nextItemId = 1;
    this.snowGrid = null; // winter stage: snowGrid[ix][iz] = diggable cell
    this.snowVersion = 0;
    this.scoopReady = 0;
    this.nextCellId = 1;

    this._buildStage();
    this._buildCar();
    this.doomed = [];
    this.pushing = new Set(); // cells currently carrying a smoothed push force
    this.stepping = false;
    this.world.addEventListener('preStep', () => { this.stepping = true; this._preStep(DT); });
    this.world.addEventListener('postStep', () => {
      this.stepping = false;
      for (const b of this.doomed.splice(0)) this.world.removeBody(b);
    });
    this.vehicle.addToWorld(this.world);
    this._settle();
  }

  // ---------------------------------------------------------------- stage
  _addStatic(kind, pos, half, rotZ = 0) {
    const body = new Body({ mass: 0 });
    body.addShape(new Box(new Vec3(...half)));
    body.position.set(...pos);
    body.quaternion.setFromAxisAngle(new Vec3(0, 0, 1), rotZ);
    body.userData = { kind, grip: kind === 'mud' ? this.level.mud : GRIP[kind], terrain: true, half };
    this.world.addBody(body);
    return body;
  }

  _buildStage() {
    const winter = this.stageKey === 'winter';
    const ZL = winter ? SNOW_POCKET : this.level.pocket; // half length of the pocket
    this.pocketZ = ZL;
    if (winter) this._buildWinterGround(ZL);
    else this._buildDitchGround(ZL);
    this._buildCommon();
  }

  _buildWinterGround(ZL) {
    // packed-snow road, snow field on the other side, frozen bare ground under the pocket
    this._addStatic('packed', [0, -0.5, 0], [3, 0.5, 40]);
    this._addStatic('snow', [-8, -0.5, 0], [5, 0.5, 40]);
    this._addStatic('bare', [(SNOW_X0 + SNOW_X1) / 2, -0.5, 0], [(SNOW_X1 - SNOW_X0) / 2, 0.5, ZL]);
    // solid snow banks close the pocket (taller than the car's belly: they are not diggable)
    const bl = 40 - ZL;
    this._addStatic('snow', [5.5, 0.4, ZL + bl / 2], [2.5, 0.5, bl / 2]);
    this._addStatic('snow', [5.5, 0.4, -ZL - bl / 2], [2.5, 0.5, bl / 2]);
    this._addStatic('snow', [12, 0.4, 0], [4, 0.5, 40]);
    // diggable cells: a powder drift with a plow ridge along the road edge
    const nx = Math.round((SNOW_X1 - SNOW_X0) / CELL);
    const nz = Math.round((2 * ZL) / CELL);
    this.snowGrid = [];
    for (let ix = 0; ix < nx; ix++) {
      this.snowGrid[ix] = [];
      for (let iz = 0; iz < nz; iz++) {
        const x = SNOW_X0 + (ix + 0.5) * CELL;
        const z = -ZL + (iz + 0.5) * CELL;
        const ridge = Math.max(0, 1 - Math.abs(x - 3.5) / 1.0);
        const h = this.level.snow + this.level.berm * ridge;
        const rho = this.level.rho + (RIDGE_RHO - this.level.rho) * ridge; // the plowed ridge is denser than the wind-blown drift
        const cell = { id: this.nextCellId++, ix, iz, x, z, h, rho, m: h * rho, glaze: 0, body: null, bodyH: 0, ver: 0 };
        this._makeCellBody(cell);
        this.snowGrid[ix][iz] = cell;
      }
    }
  }

  /** make / resize / remove the static collision body of a snow cell to match its height */
  _makeCellBody(cell) {
    if (cell.h < MIN_BODY_H) {
      // cannon-es iterates world.bodies by a length fixed at the start of the step: a body must not be removed mid-step
      if (cell.body) {
        if (this.stepping) this.doomed.push(cell.body);
        else this.world.removeBody(cell.body);
      }
      cell.body = null;
      cell.bodyH = 0;
      if (cell.h < 0.005) { cell.h = 0; cell.m = 0; }
      return;
    }
    if (!cell.body) {
      const body = new Body({ mass: 0 });
      body.addShape(new Box(new Vec3(CELL / 2, cell.h / 2, CELL / 2)));
      body.userData = { kind: 'snowcell', cell };
      this.world.addBody(body);
      cell.body = body;
    }
    const sh = cell.body.shapes[0];
    sh.halfExtents.set(CELL / 2, cell.h / 2, CELL / 2);
    sh.updateConvexPolyhedronRepresentation();
    sh.updateBoundingSphereRadius();
    cell.body.position.set(cell.x, cell.h / 2, cell.z);
    cell.body.updateBoundingRadius();
    cell.body.aabbNeedsUpdate = true;
    cell.bodyH = cell.h;
  }

  /** after a density / mass change: keep height = mass / density, resize the body when it moved enough, flag for redraw */
  _snowChanged(cell) {
    cell.h = cell.rho > 0 ? cell.m / cell.rho : 0;
    if (Math.abs(cell.h - cell.bodyH) > 0.004 || (cell.h < MIN_BODY_H) !== !cell.body) this._makeCellBody(cell);
    // redraw only on a visible change (the renderer compares cell.ver)
    if (cell.hV === undefined || Math.abs(cell.h - cell.hV) > 0.004 || Math.abs(cell.rho - cell.rhoV) > 4 || Math.abs(cell.glaze - cell.glazeV) > 0.05) {
      cell.hV = cell.h; cell.rhoV = cell.rho; cell.glazeV = cell.glaze;
      cell.ver++;
      this.snowVersion++;
    }
  }

  _buildDitchGround(ZL) {
    // road + grass
    this._addStatic('road', [0, -0.5, 0], [3, 0.5, 40]);
    this._addStatic('grass', [-8, -0.5, 0], [5, 0.5, 40]);
    // ditch pocket: slope down from the road edge, flat mud floor, slope up on the far side
    const x0 = 3;
    const run = 1.2;
    const depth = this.level.depth;
    const floorW = 0.8;
    const L = Math.hypot(run, depth);
    const th = Math.atan2(depth, run);
    const t = 0.5;
    const x1 = x0 + run;
    const x2 = x1 + floorW;
    const x3 = x2 + run;
    let n = [depth / L, run / L]; // up-normal of the down-slope
    this._addStatic('mud', [(x0 + x1) / 2 - n[0] * t, -depth / 2 - n[1] * t, 0], [L / 2, t, ZL], -th);
    this._addStatic('mud', [(x1 + x2) / 2, -depth - 0.5, 0], [floorW / 2, 0.5, ZL]);
    n = [-depth / L, run / L];
    this._addStatic('grass', [(x2 + x3) / 2 - n[0] * t, -depth / 2 - n[1] * t, 0], [L / 2, t, ZL], th);
    this._addStatic('grass', [(x3 + 16) / 2, -0.5, 0], [(16 - x3) / 2, 0.5, ZL]);
    // blocks that close the pocket at both ends (concrete U-ditch walls)
    const bl = 40 - ZL;
    this._addStatic('grass', [9.5, -0.5, ZL + bl / 2], [6.5, 0.5, bl / 2]);
    this._addStatic('grass', [9.5, -0.5, -ZL - bl / 2], [6.5, 0.5, bl / 2]);
  }

  _buildCommon() {
    // tree trunks: octagon-ish solid made of two boxes
    for (const [x, z] of TREES) {
      const trunk = new Body({ mass: 0 });
      trunk.addShape(new Box(new Vec3(0.17, 1.2, 0.17)));
      trunk.addShape(new Box(new Vec3(0.17, 1.2, 0.17)), new Vec3(0, 0, 0), new Quaternion().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 4));
      trunk.position.set(x, 1.2, z);
      trunk.userData = { kind: 'tree', grip: 0.5 };
      this.world.addBody(trunk);
    }
    // invisible boundary walls so the car cannot leave the map
    for (const [x, z, hx, hz] of [[-13.6, 0, 0.5, 41], [16.6, 0, 0.5, 41], [1.5, 40.6, 16, 0.5], [1.5, -40.6, 16, 0.5]]) {
      const wall = new Body({ mass: 0 });
      wall.addShape(new Box(new Vec3(hx, 2, hz)));
      wall.position.set(x, 1.5, z);
      wall.userData = { kind: 'wall', grip: 0.5 };
      this.world.addBody(wall);
    }
    // helper kei truck: kinematic obstacle that the rope is tied to
    const tb = new Body({ mass: 0, type: Body.KINEMATIC });
    tb.addShape(new Box(new Vec3(...TRUCK_HALF)), new Vec3(0, TRUCK_HALF[1], 0));
    tb.position.set(TRUCK_X, 0, this.truckZ);
    tb.userData = { kind: 'truck', grip: 0.5 };
    this.truckBody = tb;
    this.world.addBody(tb);
  }

  // ---------------------------------------------------------------- car
  _buildCar() {
    const car = this.car;
    const chassis = new Body({ mass: car.mass });
    for (const sh of car.shapes) chassis.addShape(new Box(new Vec3(...sh.half)), new Vec3(...sh.at)); // lower body + cabin
    if (this.stageKey === 'winter') {
      chassis.position.set(5, this.level.snow + this.level.berm * 0.3 + 0.78, 0); // drop onto the snow from just above
      chassis.quaternion.setFromEuler(0, this.level.wyaw, 0);
    } else {
      chassis.position.set(3.75, car.spawnY, 0);
      chassis.quaternion.setFromEuler(0, this.level.yaw, -Math.atan2(this.level.depth, (car.trackF + car.trackR) / 2) * 0.95);
    }
    chassis.collisionFilterGroup = 1;
    chassis.collisionFilterMask = ~2; // do not collide with thin placed items
    chassis.linearDamping = 0.05;
    chassis.angularDamping = 0.3;
    this.chassis = chassis;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: chassis,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });
    const opts = {
      radius: car.tireR,
      directionLocal: new Vec3(0, -1, 0),
      axleLocal: new Vec3(-1, 0, 0),
      suspensionStiffness: car.stiffness ?? 28,
      suspensionRestLength: BASE_REST,
      frictionSlip: 1,
      dampingRelaxation: 2.4,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      rollInfluence: 0.05,
      maxSuspensionTravel: 0.25,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };
    for (const w of this.wheelDefs) {
      this.vehicle.addWheel({ ...opts, chassisConnectionPointLocal: new Vec3(w.x, car.connY, w.z) });
    }
  }

  _settle() {
    this.input.brake = true;
    this.settling = true; // the fall-in is not played: the snow starts untouched
    for (let i = 0; i < 360; i++) this.world.step(DT);
    this.settling = false;
    this.chassis.velocity.set(0, 0, 0);
    this.chassis.angularVelocity.set(0, 0, 0);
    this.input.brake = false;
    this.time = 0;
    this.playing = true;
  }

  // ---------------------------------------------------------------- helpers
  forwardH() {
    const f = this.chassis.vectorToWorldFrame(new Vec3(0, 0, 1));
    f.y = 0;
    const l = f.length() || 1;
    f.scale(1 / l, f);
    return f;
  }

  speedKmh() {
    const f = this.chassis.vectorToWorldFrame(new Vec3(0, 0, 1));
    return this.chassis.velocity.dot(f) * 3.6;
  }

  tilt() {
    const up = this.chassis.vectorToWorldFrame(new Vec3(0, 1, 0));
    return up.y;
  }

  emit(type, data) {
    this.events.push({ type, data });
  }

  say(text, kind = 'info') {
    this.messages.push({ t: this.time, text, kind });
  }

  cornerWorld(i) {
    return this.chassis.pointToWorldFrame(this.vehicle.wheelInfos[i].chassisConnectionPointLocal);
  }

  truckHook() {
    return new Vec3(TRUCK_X, 0.55, this.truckZ - 1.7);
  }

  hookWorld() {
    return this.chassis.pointToWorldFrame(this.hookLocal);
  }

  /** ray straight down at (x,z) from y+2; ignores chassis. */
  _ground(x, y, z) {
    const res = new CANNON.RaycastResult();
    this.chassis.collisionResponse = false;
    this.world.raycastClosest(new Vec3(x, y + 2, z), new Vec3(x, y - 5, z), { skipBackfaces: true }, res);
    this.chassis.collisionResponse = true;
    return res.hasHit ? res : null;
  }

  // ---------------------------------------------------------------- control
  setInput(inp) {
    Object.assign(this.input, inp);
  }

  toggleSideBrake() {
    this.sideBrake = !this.sideBrake;
    this.emit('sideBrake', { on: this.sideBrake });
    this.say(this.sideBrake ? 'サイドブレーキ ON(後輪ロック)' : 'サイドブレーキ OFF', this.sideBrake ? 'warn' : 'info');
  }

  toggleVsa() {
    const n = this.car.vsaName;
    if (!n) {
      this.say(`${this.car.short}には横滑り防止・トラクションコントロール装置がない`, 'info');
      return;
    }
    this.vsa = !this.vsa;
    this.emit('vsa');
    this.say(this.vsa ? `${n} ON(スリップ時に出力カット)` : `${n} OFF(出力カットなし)`, 'info');
  }

  _preStep(dt) {
    const inp = this.input;
    const v = this.vehicle;
    const ch = this.chassis;

    // steering (positive = left)
    this.steer += (inp.steer * this.car.steerMax - this.steer) * Math.min(1, dt * 6);
    v.setSteeringValue(this.steer, 0);
    v.setSteeringValue(this.steer, 1);

    // per-wheel surface + load
    const N = [];
    const L = [];
    this.wheelDefs.forEach((_, i) => {
      const wi = v.wheelInfos[i];
      const hitBody = wi.raycastResult.body;
      const inContact = wi.isInContact && hitBody;
      const cell = inContact ? hitBody.userData?.cell ?? null : null;
      const kind = !inContact ? 'air' : cell ? snowKind(cell) : hitBody.userData?.kind ?? 'road';
      const soft = cell ? snowSoft(cell.rho) : SOFT[kind] ?? 0;
      let grip = !inContact ? 0 : cell ? snowGrip(cell) : hitBody.userData?.grip ?? 0.5;
      if (soft) {
        // dug-in tyres lose grip; mud grip also flutters as the tread clogs and bites (stick-slip)
        const flutter = 1 + 0.12 * Math.sin(this.time * 13 + i * 1.7) + 0.06 * Math.sin(this.time * 29 + i * 3.1); // mean 1: no net grip change
        grip *= (1 - 0.5 * this.dig[i] * soft) * (soft >= 1 && !cell ? flutter : 1);
      }
      wi.frictionSlip = Math.max(0.05, grip || 1);
      N[i] = inContact ? Math.max(0, wi.suspensionForce) : 0;
      L[i] = grip * N[i];
      const st = this.wheelState[i];
      st.grip = grip;
      st.load = N[i];
      st.surface = kind;
      st.cell = cell;
      st.soft = soft;
      st.air = !inContact;
    });

    // engine: 4WD with torque-biasing diffs (brake-LSD like): the weaker wheel of an axle
    // limits the axle, but the stronger wheel may carry up to DIFF_BIAS x the weak wheel's force.
    const thr = inp.brake ? 0 : inp.throttle; // brake override: pedal beats throttle
    this.effThrottle = thr;
    let total = 0;
    if (thr !== 0) {
      const fwd = ch.vectorToWorldFrame(new Vec3(0, 0, 1));
      const sp = ch.velocity.dot(fwd);
      const lim = sp * Math.sign(thr) > 0 ? Math.max(0, 1 - Math.abs(sp) / MAX_SPEED) : 1;
      total = this.car.engineForce * Math.abs(thr) * lim;
    }
    const axles = [
      [0, 1, this.car.shareFront],
      [2, 3, 1 - this.car.shareFront],
    ];
    const each = [0, 0, 0, 0];
    let limited = false;
    for (const [a, b, share] of axles) {
      const want = (total * share) / 2;
      if (want > Math.min(L[a], L[b]) * 0.97 + 1) limited = true;
    }
    const vsaCut = this.vsa && !!this.car.vsaName && limited && thr !== 0;
    for (const [a, b, share] of axles) {
      const want = ((total * share) / 2) * (vsaCut ? 0.3 : 1);
      const la = L[a] * 0.97;
      const lb = L[b] * 0.97;
      const weak = la <= lb ? a : b;
      const strong = weak === a ? b : a;
      const lw = Math.min(la, lb);
      const ls = Math.max(la, lb);
      const fw = Math.min(want, lw);
      const fs = Math.min(2 * want - fw, ls, this.car.diffBias * fw);
      each[weak] = fw;
      each[strong] = fs;
      if (this.sideBrake && a >= 2) each[a] = each[b] = 0; // rear axle is locked
      this.wheelState[a].spinning = want > la + 1 && N[a] > 0;
      this.wheelState[b].spinning = want > lb + 1 && N[b] > 0;
    }
    this.vsaCut = vsaCut;
    this.autoHold = thr === 0 && !inp.brake && ch.velocity.length() < 1;
    this.limited = limited;
    // locked rear wheels slide: lateral grip of the rear axle drops while the car is moving
    if (this.sideBrake && Math.abs(ch.velocity.length()) > 1.5) {
      v.wheelInfos[2].frictionSlip *= 0.45;
      v.wheelInfos[3].frictionSlip *= 0.45;
    }
    const sign = -(Math.sign(thr) || 0); // cannon-es: negative engineForce drives toward the axle-cross-normal direction (+Z here)
    this.wheelDefs.forEach((_, i) => {
      v.applyEngineForce(sign * each[i], i);
      // brakes act only when no engine force
      const rear = i >= 2;
      // auto brake hold only when (almost) stopped; while rolling only light engine braking
      const hold = thr === 0 ? (ch.velocity.length() < 1.2 ? 14 : 0.6) : 0;
      let br = inp.brake ? FOOT_BRAKE : hold;
      if (this.sideBrake && rear) br = Math.max(br, 70);
      v.setBrake(br, i);
    });
    if (this.limited && thr !== 0 && Math.abs(ch.velocity.length()) < 0.4 && this.time - this.lastSpinMsg > 3.5) {
      this.lastSpinMsg = this.time;
      this.say(vsaCut ? `空転検知: ${this.car.vsaName}が出力をカット中` : 'タイヤが空転している', 'warn');
    }

    // ---- digging in: spinning on soft ground digs a rut; the tyre sinks, loses grip and drags
    this.wheelDefs.forEach((_, i) => {
      const st = this.wheelState[i];
      const wi = v.wheelInfos[i];
      const soft = st.soft ?? 0;
      const rel = wi.worldTransform.position.vsub(ch.position);
      const vel = ch.getVelocityAtWorldPoint(wi.worldTransform.position, new Vec3()); // takes a WORLD point
      const hs = Math.hypot(vel.x, vel.z); // ground speed of the tyre
      if (st.spinning && soft && thr !== 0) this.dig[i] = Math.min(1, this.dig[i] + DIG_RATE * soft * dt);
      else if (!st.air && !soft) this.dig[i] = Math.max(0, this.dig[i] - 0.3 * dt); // firm surface / board under the tyre
      this.dig[i] = Math.max(0, this.dig[i] - 0.15 * Math.min(hs, 2) * dt); // rolling out of the rut fills it
      st.dig = this.dig[i];
      wi.suspensionRestLength = BASE_REST - this.dig[i] * DIG_SINK;
      if (this.dig[i] > 0.5 && !this.digWarned[i]) {
        this.digWarned[i] = true;
        this.say(`${this.wheelDefs[i].name}タイヤが泥を掘って沈んでいる! 空転を止めて板を噛ませよう`, 'warn');
      }
      if (this.dig[i] < 0.2) this.digWarned[i] = false;
      if (soft && N[i] > 0 && hs > 0.02) {
        // mud drag grows with the rut depth; opposes the tyre's ground motion
        const F = (0.01 + 0.06 * this.dig[i]) * soft * N[i] * Math.min(1, hs / 0.4);
        ch.applyForce(new Vec3(-vel.x / hs * F, 0, -vel.z / hs * F), rel);
      }
    });

    if (this.sideBrake && thr !== 0 && ch.velocity.length() < 0.5 && this.time - this.lastBrakeMsg > 4) {
      this.lastBrakeMsg = this.time;
      this.say('サイドブレーキがかかっていて進めない (Space で解除)', 'warn');
    }

    this._snowStep(dt, N, thr);
    this._jackForce();
    this._ropeForce(dt);
  }

  // ---------------------------------------------------------------- snow: compaction, ice, bulldozing
  _snowStep(dt, N, thr) {
    if (!this.snowGrid || this.settling) return;
    const touched = new Set();
    // 1. tyres press the snow under them: density rises (height drops at constant mass); wheelspin shears it
    //    much faster and, once the snow is dense, polishes it to ice
    this.wheelDefs.forEach((_, i) => {
      const st = this.wheelState[i];
      const cell = st.cell;
      if (!cell || !(N[i] > 0)) return;
      const shear = st.spinning && thr !== 0 ? 1 : 0;
      if (this._densify(cell, rhoEq(N[i] / PATCH), dt, shear)) touched.add(cell);
    });
    // 2. the underbody on snow (belly-out) loads the cell it rests on; a car that drives into a cell
    //    pushes (bulldozes) its snow into the next cell when its push force beats the cell's crushing strength
    const ch = this.chassis;
    const side = new Map(); // cell -> { fx, fz }: horizontal force the car puts on it this step
    for (const ce of this.world.contacts) {
      const other = ce.bi === ch ? ce.bj : ce.bj === ch ? ce.bi : null;
      const cell = other?.userData?.cell;
      if (!cell || cell.h <= 0) continue;
      const F = Math.min(ce.multiplier || 0, MAX_CONTACT_F); // solver spikes are clipped
      if (F <= 0) continue;
      // normal pointing from the chassis toward the cell
      const sgn = ce.bi === ch ? 1 : -1;
      const nx = ce.ni.x * sgn;
      const ny = ce.ni.y * sgn;
      const nz = ce.ni.z * sgn;
      if (ny < -0.6) {
        if (this._densify(cell, rhoEq(F / BELLY_AREA), dt, 0)) touched.add(cell);
      } else if (Math.abs(ny) < 0.6) {
        const f = side.get(cell) ?? { fx: 0, fz: 0 };
        f.fx += F * nx;
        f.fz += F * nz;
        side.set(cell, f);
      }
    }
    // The car pushes a cell with a smoothed horizontal force (the raw contact force is spiky). A car that cannot move
    // (the cell is a static body) still presses with its full thrust, so no motion is required.
    for (const cell of this.pushing) if (!side.has(cell)) side.set(cell, { fx: 0, fz: 0 });
    this.pushing.clear();
    for (const [cell, f] of side) {
      const inst = Math.hypot(f.fx, f.fz);
      cell.pushF = (cell.pushF ?? 0) + (inst - (cell.pushF ?? 0)) * Math.min(1, dt / PUSH_TAU);
      if (cell.pushF > 1) this.pushing.add(cell);
      if (inst > 0 && cell.pushF > pushYield(cell)) this._bulldoze(cell, f.fx / inst, f.fz / inst, cell.pushF, dt, touched);
    }
    for (const c of touched) this._snowChanged(c);
  }

  /** raise a cell's density toward `target` (load) and by shear; returns true when anything changed */
  _densify(cell, target, dt, shear) {
    let r = cell.rho;
    if (target > r) r += (target - r) * Math.min(1, dt / COMPACT_TAU);
    if (shear) r += SHEAR_RATE * (1 - r / RHO_ICE) * dt;
    r = Math.min(RHO_ICE, r);
    let changed = r > cell.rho;
    cell.rho = r;
    if (shear && cell.rho > 550 && cell.glaze < 1) {
      cell.glaze = Math.min(1, cell.glaze + GLAZE_RATE * dt);
      changed = true;
    }
    return changed;
  }

  /** push part of a cell's snow into the neighbour in direction (nx,nz); the pushed snow is packed denser */
  _bulldoze(cell, nx, nz, F, dt, touched) {
    const horiz = Math.abs(nx) > Math.abs(nz);
    const jx = cell.ix + (horiz ? Math.sign(nx) : 0);
    const jz = cell.iz + (horiz ? 0 : Math.sign(nz));
    const to = this.snowGrid[jx]?.[jz];
    if (!to) return; // beyond the pocket is a solid bank: nothing to push into
    const frac = Math.min(0.5, (F / pushYield(cell) - 1) * 0.6 * dt);
    const dm = cell.m * frac;
    if (dm <= 0) return;
    const rhoP = Math.min(RHO_ICE, cell.rho * PUSH_COMPACT);
    const hNew = to.h + dm / rhoP;
    if (hNew > H_MAX) return; // the pile is as high as it gets
    to.rho = (to.m + dm) / hNew;
    to.m += dm;
    to.glaze = Math.max(to.glaze, cell.glaze * 0.5);
    cell.m -= dm;
    to.h = to.m / to.rho;
    cell.h = cell.m / cell.rho;
    touched.add(cell);
    touched.add(to);
  }

  // ---------------------------------------------------------------- jack
  toggleJack(wheelIdx) {
    if (this.jack) {
      const lifted = this.jack.lift > 0.02;
      this.jack = null;
      this.emit('jackOff', { lifted });
      this.say(lifted ? 'ジャッキを外した(車体が降りる)' : 'ジャッキを撤去した', 'info');
      return;
    }
    const cp = this.cornerWorld(wheelIdx);
    const wp = this.vehicle.wheelInfos[wheelIdx].worldTransform.position;
    const hit = this._ground(wp.x, wp.y, wp.z);
    if (!hit) {
      this.say('ジャッキを置ける地面がない', 'warn');
      return;
    }
    const tilt = Math.acos(clamp(hit.hitNormalWorld.y, -1, 1)) * (180 / Math.PI);
    const hitCell = hit.body.userData?.cell;
    const kind = hitCell ? snowKind(hitCell) : hit.body.userData?.kind;
    const padded = kind === 'mat' || kind === 'helper' || this.items.some((it) => Math.hypot(it.body.position.x - wp.x, it.body.position.z - wp.z) < 0.5);
    this.jack = {
      wheel: wheelIdx,
      y0: cp.y,
      lift: 0,
      target: 0,
      sink: 0,
      baseY: hit.hitPointWorld.y,
      baseX: wp.x,
      baseZ: wp.z,
      tilt,
      unstable: tilt > 12,
      soft: (kind === 'mud' || kind === 'drift') && !padded,
    };
    this.emit('jackSet');
    if (this.jack.unstable) this.say(`ジャッキ設置面が傾いている(${tilt.toFixed(0)}°) 持ち上げると倒れる`, 'warn');
    else if (this.jack.soft) this.say((kind === 'drift' ? '吹きだまりの上: 板やマットを下に敷かないと沈む' : 'ぬかるみの上: 板やマットを下に敷かないと沈む'), 'warn');
    else this.say('ジャッキを設置した (Z上げ / X下げ)', 'info');
  }

  jackMove(dir, dt) {
    if (!this.jack) return;
    const j = this.jack;
    j.target = clamp(j.target + dir * 0.08 * dt, 0, JACK_MAX_LIFT);
  }

  _jackForce() {
    const j = this.jack;
    this.chassis.angularDamping = j ? JACK_BODY_DAMPING : 0.3;
    if (!j) return;
    const ch = this.chassis;
    j.lift += (j.target - j.lift) * Math.min(1, DT * 8);
    if (j.soft && j.lift > 0.03) j.sink = Math.min(0.3, j.sink + 0.012 * DT);
    if (j.unstable && j.lift > 0.12) {
      this.jack = null;
      this.misses++;
      this.emit('jackCollapse');
      this.say('ジャッキが倒れた! 車体が落ちた (ミス+1)', 'bad');
      return;
    }
    // The jack head is a rigid column, not a spring: a velocity-level contact. It only stops the corner from
    // going below the head height (and pushes it back up if it already sank), never pulls, and is capped at
    // JACK_FMAX so it can never launch the car. No spring => nothing to oscillate.
    const cp = this.cornerWorld(j.wheel);
    const targetY = j.y0 + j.lift - j.sink;
    const err = targetY - cp.y; // > 0: the corner is below the head
    const rel = cp.vsub(ch.position);
    const vel = ch.getVelocityAtWorldPoint(cp, new Vec3()); // takes a WORLD point, not an offset
    const vDes = err > 0 ? Math.min(err * JACK_CLOSE_RATE, JACK_MAX_PUSH_SPEED) : Math.max(err * JACK_CLOSE_RATE, -1);
    const n = new Vec3(0, 1, 0);
    const rn = rel.cross(n);
    const kEff = ch.invMass + rn.dot(ch.invInertiaWorld.vmult(rn));
    // feed-forward: how much did gravity / suspension / contacts change the corner's speed during the last step
    // (apart from our own push)? Predict the same again so the corner lands exactly on vDes instead of sagging.
    const other = j.pv === undefined ? 0 : vel.y - (j.pv + kEff * j.pJ);
    let J = Math.max(0, (vDes - vel.y - other) / kEff); // impulse that brings the corner's vertical speed to vDes
    J = Math.min(J, JACK_FMAX * DT);
    // safety: a real jack is only used while the car stays stable. Stop pushing when fewer than two other
    // tyres carry load (the car would be balanced on the jack) or when the body is tipping over.
    const carrying = this.wheelState.filter((w, i) => i !== j.wheel && !w.air && w.load > 200).length;
    if (carrying < 2 || this.tilt() < JACK_MIN_UP) {
      J = 0;
      j.target = Math.min(j.target, j.lift); // the stop becomes the new limit; lowering still works
    }
    j.pv = vel.y;
    j.pJ = J;
    if (J > 0) ch.applyImpulse(new Vec3(0, J, 0), rel);
    j.cornerY = cp.y;
    j.cornerX = cp.x;
    j.cornerZ = cp.z;
  }

  // ---------------------------------------------------------------- rope
  toggleRope() {
    if (this.rope) {
      this.rope = null;
      this.emit('ropeTie');
      this.say('ロープを外した', 'info');
      return;
    }
    const d = this.truckHook().distanceTo(this.hookWorld());
    this.rope = { L0: d + 0.4, tension: 0 };
    this.emit('ropeTie');
    this.say('牽引フックと軽トラをロープで接続した (Gで助っ人が引く)', 'info');
  }

  _ropeForce(dt) {
    const r = this.rope;
    this.truckStalled = false;
    if (!r) {
      this._syncTruck(dt);
      return;
    }
    const hook = this.hookWorld();
    const a = this.truckHook();
    const d = a.vsub(hook);
    const dist = d.length();
    const dir = d.scale(1 / (dist || 1));
    const rel = hook.vsub(this.chassis.position);
    const vel = this.chassis.getVelocityAtWorldPoint(hook, new Vec3()); // takes a WORLD point
    const stretch = dist - r.L0;
    let T = 0;
    if (stretch > 0) T = Math.max(0, ROPE_K * stretch - ROPE_C * vel.dot(dir));
    r.tension = T;
    if (T > ROPE_BREAK) {
      this.rope = null;
      this.misses++;
      this.emit('ropeSnap');
      this.say(`ロープが切れた! (張力 ${Math.round(T)}N) ゆっくり引く必要がある (ミス+1)`, 'bad');
      return;
    }
    if (T > 0) this.chassis.applyForce(dir.scale(T), rel);
    if (this.pulling) {
      if (T < TRUCK_PULL_MAX) this.truckZ = Math.min(30, this.truckZ + 0.35 * dt);
      else this.truckStalled = true;
    }
    this._syncTruck(dt);
  }

  _syncTruck(dt) {
    const b = this.truckBody;
    b.velocity.set(0, 0, (this.truckZ - b.position.z) / dt);
    b.position.z = this.truckZ;
  }

  setPulling(on) {
    this.pulling = on;
  }

  // ---------------------------------------------------------------- items
  /** Place a board-like item next to wheel `wheelIdx` in direction `dirKey`. */
  placeItem(kind, wheelIdx, dirKey) {
    const spec = ITEM_SPECS[kind];
    if (this.stock[kind] <= 0) {
      this.say(`${spec.label}はもう無い`, 'warn');
      return false;
    }
    // rule: a floor mat cannot be laid directly under a tyre (it gets spat out / shredded)
    if (dirKey === 'under') {
      const why = this._underRule(kind, wheelIdx);
      if (why) {
        this.say(why, 'warn');
        return false;
      }
    }
    const wi = this.vehicle.wheelInfos[wheelIdx];
    const wp = wi.worldTransform.position;
    const f = this.forwardH();
    const right = new Vec3(-f.z, 0, f.x);
    const inside = this.wheelDefs[wheelIdx].x > 0 ? right.clone() : right.scale(-1);
    const dd = PLACE_DIRS[dirKey];
    let dir;
    let offset = this.car.tireR + spec.half[2];
    if (dd.angle === null) {
      dir = f.clone();
      offset = 0;
    } else {
      const a = (dd.angle * Math.PI) / 180;
      dir = f.scale(Math.cos(a)).vadd(inside.scale(Math.sin(a)));
      dir.normalize();
    }
    const cx = wp.x + dir.x * offset;
    const cz = wp.z + dir.z * offset;
    const hit = this._ground(cx, wp.y, cz);
    if (!hit) {
      this.say('そこには置けない', 'warn');
      return false;
    }
    this._spawnItem(kind, hit, dir, wheelIdx);
    this.say(`${this.wheelDefs[wheelIdx].name}タイヤの${dd.label}に${spec.label}を置いた`, 'info');
    return true;
  }

  _spawnItem(kind, hit, dir, wheelIdx) {
    const spec = ITEM_SPECS[kind];
    const n = hit.hitNormalWorld.clone();
    const qTilt = new Quaternion().setFromVectors(new Vec3(0, 1, 0), n);
    const qYaw = new Quaternion().setFromAxisAngle(new Vec3(0, 1, 0), Math.atan2(dir.x, dir.z));
    const body = new Body({ mass: 0 });
    body.addShape(new Box(new Vec3(...spec.half)));
    body.position.copy(hit.hitPointWorld.vadd(n.scale(spec.half[1])));
    body.quaternion.copy(qTilt.mult(qYaw));
    body.collisionFilterGroup = 2; // chassis ignores group 2 (see _buildCar); wheel rays still hit it
    body.userData = { kind, grip: GRIP[kind], item: true, half: spec.half };
    this.world.addBody(body);
    this.stock[kind]--;
    this.items.push({ id: this.nextItemId++, kind, body, wheel: wheelIdx });
    this.emit('place', { kind });
  }

  /**
   * Rules for putting something directly under a tyre. Returns the refusal text, or null when allowed.
   * - floor mat: never under a tyre
   * - snow helper: only under a tyre that is off the ground (lifted with the jack)
   */
  _underRule(kind, wheelIdx) {
    if (kind === 'mat') return 'フロアマットはタイヤの真下には敷けない';
    if (kind === 'helper' && !this.wheelState[wheelIdx].air) {
      return `${this.wheelDefs[wheelIdx].name}タイヤが接地している: ヘルパーは浮いたタイヤの下にしか挟めない(ジャッキで浮かせる)`;
    }
    return null;
  }

  /** index of the wheel nearest to world (x,z) and its horizontal distance */
  nearestWheel(x, z) {
    let best = 0;
    let bd = Infinity;
    this.vehicle.wheelInfos.forEach((wi, i) => {
      const p = wi.worldTransform.position;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = i; }
    });
    return { wheel: best, dist: bd };
  }

  /** Mouse / tap placement: would an item dropped at world (x,z) be accepted, and how would it lie? */
  previewAt(kind, x, z) {
    const spec = ITEM_SPECS[kind];
    if (this.stock[kind] <= 0) return { ok: false, reason: `${spec.label}はもう無い` };
    const { wheel, dist } = this.nearestWheel(x, z);
    if (dist > ITEM_REACH) return { ok: false, reason: '遠すぎて手が届かない', wheel };
    // rule: a floor mat cannot be laid directly under a tyre
    if (dist < TYRE_UNDER_CLEARANCE) {
      const why = this._underRule(kind, wheel);
      if (why) return { ok: false, reason: why, wheel };
    }
    const wp = this.vehicle.wheelInfos[wheel].worldTransform.position;
    // the board lies along the line from the nearest tyre to the tapped point (the way the tyre will roll)
    const dir = new Vec3(x - wp.x, 0, z - wp.z);
    if (dir.length() < 0.12) dir.copy(this.forwardH());
    dir.normalize();
    const hit = this._ground(x, wp.y, z);
    if (!hit) return { ok: false, reason: 'そこには置けない', wheel };
    return { ok: true, wheel, dir, hit };
  }

  placeItemAt(kind, x, z) {
    const pv = this.previewAt(kind, x, z);
    if (!pv.ok) {
      this.say(pv.reason, 'warn');
      return false;
    }
    this._spawnItem(kind, pv.hit, pv.dir, pv.wheel);
    this.say(`${this.wheelDefs[pv.wheel].name}タイヤの近くに${ITEM_SPECS[kind].label}を置いた`, 'info');
    return true;
  }

  // ---------------------------------------------------------------- scoop (winter stage)
  cellAt(x, z) {
    if (!this.snowGrid) return null;
    const ix = Math.floor((x - SNOW_X0) / CELL);
    const iz = Math.floor((z + this.pocketZ) / CELL);
    return this.snowGrid[ix]?.[iz] ?? null;
  }

  /** Would a scoop at world (x,z) be accepted? (mouse hover + tap + keys) */
  previewScoop(x, z) {
    if (!this.snowGrid) return { ok: false, reason: 'ここには掘れる雪がない(冬道ステージで使う)' };
    const cell = this.cellAt(x, z);
    if (!cell) return { ok: false, reason: 'そこは掘れない(固い雪の壁 / 路面)' };
    if (cell.h <= 0) return { ok: false, reason: 'もう地面まで掘ってある', cell };
    const { dist } = this.nearestWheel(cell.x, cell.z);
    if (dist > ITEM_REACH) return { ok: false, reason: '遠すぎて手が届かない', cell };
    for (let i = 0; i < this.wheelDefs.length; i++) {
      if (this.wheelState[i].air) continue;
      const wp = this.vehicle.wheelInfos[i].worldTransform.position;
      if (Math.hypot(wp.x - cell.x, wp.z - cell.z) < 0.42) {
        return { ok: false, reason: `${this.wheelDefs[i].name}タイヤが乗っている所は掘れない(タイヤの前後を掘る)`, cell };
      }
    }
    if (this.items.some((it) => Math.abs(it.body.position.x - cell.x) < CELL / 2 + 0.1 && Math.abs(it.body.position.z - cell.z) < CELL / 2 + 0.1)) {
      return { ok: false, reason: '上に道具が載っていて掘れない(先に回収する)', cell };
    }
    return { ok: true, cell };
  }

  scoopAt(x, z) {
    const pv = this.previewScoop(x, z);
    if (!pv.ok) {
      this.say(pv.reason, 'warn');
      return false;
    }
    if (this.time < this.scoopReady) return false; // still swinging
    this.scoopReady = this.time + SCOOP.time * Math.min(3, Math.max(1, pv.cell.rho / 150));
    const cell = pv.cell;
    const depth = Math.min(cell.h, scoopDepth(cell.rho));
    cell.m = Math.max(0, cell.m - depth * cell.rho); // the dug snow is thrown away
    this._snowChanged(cell);
    this.emit('scoop', { h: cell.h });
    const hard = cell.rho >= 720 ? '氷で刃が立たない' : cell.rho >= 260 ? '固く締まっている' : '';
    this.say(cell.h > 0 ? `雪を掘った(${Math.round(depth * 100)}cm 削れた・この区画 あと${Math.round(cell.h * 100)}cm${hard ? `・${hard}` : ''})` : '雪を掘りきった(地面が出た)', 'info');
    return true;
  }

  /** key version: dig next to tyre `wheelIdx` in direction `dirKey` */
  scoopDir(wheelIdx, dirKey) {
    const wp = this.vehicle.wheelInfos[wheelIdx].worldTransform.position;
    const f = this.forwardH();
    const right = new Vec3(-f.z, 0, f.x);
    const inside = this.wheelDefs[wheelIdx].x > 0 ? right.clone() : right.scale(-1);
    const dd = PLACE_DIRS[dirKey];
    if (dd.angle === null) return this.scoopAt(wp.x, wp.z);
    const a = (dd.angle * Math.PI) / 180;
    const dir = f.scale(Math.cos(a)).vadd(inside.scale(Math.sin(a)));
    dir.normalize();
    const off = this.car.tireR + 0.3;
    return this.scoopAt(wp.x + dir.x * off, wp.z + dir.z * off);
  }

  /** Why this placed item cannot be pulled out right now (null = it can). */
  _recoverBlock(it) {
    const [hx, , hz] = ITEM_SPECS[it.kind].half;
    const inv = it.body.quaternion.inverse();
    for (let i = 0; i < this.wheelDefs.length; i++) {
      if (this.wheelState[i].air) continue; // a lifted tyre is not pressing on anything
      const wp = this.vehicle.wheelInfos[i].worldTransform.position;
      const l = inv.vmult(wp.vsub(it.body.position));
      if (Math.abs(l.x) <= hx + 0.1 && Math.abs(l.z) <= hz + 0.12 && Math.abs(l.y) < 0.45) {
        return `${this.wheelDefs[i].name}タイヤが乗っていて${ITEM_SPECS[it.kind].label}が抜けない`;
      }
    }
    const under = this.items.some((o) => o !== it && o.body.position.y > it.body.position.y + 0.01
      && Math.hypot(o.body.position.x - it.body.position.x, o.body.position.z - it.body.position.z) < 0.45);
    if (under) return `上に別の道具が重なっていて${ITEM_SPECS[it.kind].label}が抜けない`;
    return null;
  }

  /** Pull out the most recently placed item that is free; items with a tyre on them stay put. */
  recoverLastItem() {
    if (!this.items.length) {
      this.say('回収するものがない', 'warn');
      return false;
    }
    let firstReason = null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const why = this._recoverBlock(it);
      if (why) {
        firstReason ??= why;
        continue;
      }
      this.items.splice(i, 1);
      this.world.removeBody(it.body);
      this.stock[it.kind]++;
      this.emit('recover');
      this.say(`${ITEM_SPECS[it.kind].label}を回収した`, 'info');
      return true;
    }
    this.say(`${firstReason}(浮かせるか、タイヤを動かす)`, 'warn');
    return false;
  }

  // ---------------------------------------------------------------- step
  update(dt) {
    this.world.step(DT, dt, 8);
    this.time += dt;
    this.messages = this.messages.slice(-30);
    this.events = this.events.slice(-30);
    if (this.won) return;
    // win: all four wheels back on the road
    const onRoad = this.wheelState.every((w) => this.stage.goal.includes(w.surface));
    this.winTimer = onRoad ? this.winTimer + dt : 0;
    if (this.winTimer > 0.8 && !this.flipped) {
      this.won = true;
      this.emit('win');
      this.say('脱出成功!', 'good');
    }
    this.flipTimer = this.tilt() < 0.25 ? this.flipTimer + dt : 0;
    if (this.flipTimer > 1 && !this.flipped) {
      this.flipped = true;
      this.emit('flip');
      this.say('横転した… リセットしてください', 'bad');
    }
  }

  getHud() {
    return {
      speed: this.speedKmh(),
      thr: this.effThrottle ?? this.input.throttle,
      vsa: this.vsa && !!this.car.vsaName,
      vsaName: this.car.vsaName ?? null,
      sideBrake: this.sideBrake,
      footBrake: !!this.input.brake,
      autoHold: this.autoHold,
      vsaCut: this.vsaCut,
      wheels: this.wheelState,
      stock: this.stock,
      jack: this.jack,
      rope: this.rope,
      truckStalled: this.truckStalled,
      time: this.time,
      misses: this.misses,
      won: this.won,
      flipped: this.flipped,
      itemsUsed: this.items.length,
      stage: this.stageKey,
      scoopReady: this.time >= this.scoopReady,
    };
  }
}
