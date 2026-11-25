// StackRunner physics core (no DOM / no rendering) -- runs in browser and node.
// World: +Y up, car faces +Z. Car's LEFT side = +X, RIGHT side = -X.
// Car spec (Honda N-BOX Custom Turbo 4WD, JF6): 3395x1475x1815mm, WB 2520, track 1295, ground clearance 145,
// curb weight 1000kg, 658cc turbo 47kW/6000rpm 104Nm/2600rpm, CVT (1st 3.152, final 4.619), 165/55R15.
// Stage 1: car dropped its left wheels into a mud-bottomed side ditch pocket (x>3).
import * as CANNON from 'cannon-es';

const { Vec3, Quaternion, Body, Box } = CANNON;

export const DT = 1 / 120;

// How the car fell in: ditch depth (m), pocket half-length (m, limits the run-up), start yaw toward the ditch (rad), mud friction.
export const LEVELS = {
  normal: { label: '標準', depth: 0.32, pocket: 6, yaw: 0, mud: 0.07 },
  hard: { label: '高難度', depth: 0.38, pocket: 6, yaw: 0, mud: 0.06 },
  extreme: { label: '鬼', depth: 0.44, pocket: 6, yaw: 0.2, mud: 0.06 },
};

export const WHEEL_DEFS = [
  { id: 'FL', name: '左前', x: 0.6475, z: 1.26, front: true },
  { id: 'FR', name: '右前', x: -0.6475, z: 1.26, front: true },
  { id: 'RL', name: '左後', x: 0.6475, z: -1.26, front: false },
  { id: 'RR', name: '右後', x: -0.6475, z: -1.26, front: false },
];

// friction coefficient per surface kind
export const GRIP = { road: 1.0, grass: 0.55, mud: 0.07, helper: 1.25, mat: 0.7 };
export const SURFACE_LABEL = {
  road: 'アスファルト',
  grass: '草地',
  mud: 'ぬかるみ',
  helper: 'スノーヘルパー',
  mat: 'フロアマット',
  air: '浮いている',
};

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

const ENGINE_FORCE = 4800; // N total: 104Nm x 3.152 x 4.619 x 0.9 / 0.281m (tyre radius)
const SHARE_FRONT = 0.55; // 4WD coupling: front-biased
const FOOT_BRAKE = 20; // brake impulse limit per wheel per step (~0.75 g total)
const DIFF_BIAS = 1.6; // torque bias ratio of the axle differentials
const MAX_SPEED = 15; // m/s soft limit
const MAX_STEER = 0.55;
const HOOK_LOCAL = new Vec3(0, -0.45, 1.72);
const TRUCK_X = -1.2;
const TRUCK_Z0 = 4.2;
const ROPE_K = 7000;
const ROPE_C = 1200;
const ROPE_BREAK = 6500;
const TRUCK_PULL_MAX = 2800;
const JACK_MAX_LIFT = 0.45;
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
    this.levelKey = opts.level ?? 'normal';
    this.level = { ...LEVELS[this.levelKey], ...(opts.override ?? {}) };
    this.world = new CANNON.World({ gravity: new Vec3(0, -9.82, 0) });
    this.world.allowSleep = false;
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0;

    this.time = 0;
    this.input = { throttle: 0, steer: 0, brake: false };
    this.vsa = true;
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
    this.wheelState = WHEEL_DEFS.map(() => ({ grip: 0, load: 0, surface: 'air', spinning: false, air: true, dig: 0 }));
    this.lastSpinMsg = -10;
    this.lastBrakeMsg = -10;
    this.nextItemId = 1;

    this._buildStage();
    this._buildCar();
    this.world.addEventListener('preStep', () => this._preStep(DT));
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
    const ZL = this.level.pocket; // half length of the ditch pocket
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
    // blocks that close the pocket at both ends (concrete U-ditch walls)
    const bl = 40 - ZL;
    this._addStatic('grass', [9.5, -0.5, ZL + bl / 2], [6.5, 0.5, bl / 2]);
    this._addStatic('grass', [9.5, -0.5, -ZL - bl / 2], [6.5, 0.5, bl / 2]);
  }

  // ---------------------------------------------------------------- car
  _buildCar() {
    const chassis = new Body({ mass: 1000 });
    // lower body (up to the hood line) + cabin; matches the real side profile closely enough for collisions
    chassis.addShape(new Box(new Vec3(0.7375, 0.4525, 1.7)), new Vec3(0, -0.1225, 0));
    chassis.addShape(new Box(new Vec3(0.7375, 0.3825, 0.945)), new Vec3(0, 0.7125, -0.745));
    chassis.position.set(3.75, 0.55, 0);
    chassis.quaternion.setFromEuler(0, this.level.yaw, -Math.atan2(this.level.depth, 1.295) * 0.95);
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
      radius: 0.28,
      directionLocal: new Vec3(0, -1, 0),
      axleLocal: new Vec3(-1, 0, 0),
      suspensionStiffness: 28,
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
    for (const w of WHEEL_DEFS) {
      this.vehicle.addWheel({ ...opts, chassisConnectionPointLocal: new Vec3(w.x, -0.3, w.z) });
    }
  }

  _settle() {
    this.input.brake = true;
    for (let i = 0; i < 360; i++) this.world.step(DT);
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
    return this.chassis.pointToWorldFrame(HOOK_LOCAL);
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
    this.vsa = !this.vsa;
    this.emit('vsa');
    this.say(this.vsa ? 'VSA ON(スリップ時に出力カット)' : 'VSA OFF(出力カットなし)', 'info');
  }

  _preStep(dt) {
    const inp = this.input;
    const v = this.vehicle;
    const ch = this.chassis;

    // steering (positive = left)
    this.steer += (inp.steer * MAX_STEER - this.steer) * Math.min(1, dt * 6);
    v.setSteeringValue(this.steer, 0);
    v.setSteeringValue(this.steer, 1);

    // per-wheel surface + load
    const N = [];
    const L = [];
    WHEEL_DEFS.forEach((_, i) => {
      const wi = v.wheelInfos[i];
      const hitBody = wi.raycastResult.body;
      const inContact = wi.isInContact && hitBody;
      const kind = inContact ? hitBody.userData?.kind ?? 'road' : 'air';
      const soft = kind === 'mud' ? 1 : kind === 'grass' ? 0.3 : 0;
      let grip = inContact ? hitBody.userData?.grip ?? 0.5 : 0;
      if (soft) {
        // dug-in tyres lose grip; mud grip also flutters as the tread clogs and bites (stick-slip)
        const flutter = 1 + 0.12 * Math.sin(this.time * 13 + i * 1.7) + 0.06 * Math.sin(this.time * 29 + i * 3.1); // mean 1: no net grip change
        grip *= (1 - 0.5 * this.dig[i] * soft) * (soft === 1 ? flutter : 1);
      }
      wi.frictionSlip = Math.max(0.05, grip || 1);
      N[i] = inContact ? Math.max(0, wi.suspensionForce) : 0;
      L[i] = grip * N[i];
      const st = this.wheelState[i];
      st.grip = grip;
      st.load = N[i];
      st.surface = kind;
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
      total = ENGINE_FORCE * Math.abs(thr) * lim;
    }
    const axles = [
      [0, 1, SHARE_FRONT],
      [2, 3, 1 - SHARE_FRONT],
    ];
    const each = [0, 0, 0, 0];
    let limited = false;
    for (const [a, b, share] of axles) {
      const want = (total * share) / 2;
      if (want > Math.min(L[a], L[b]) * 0.97 + 1) limited = true;
    }
    const vsaCut = this.vsa && limited && thr !== 0;
    for (const [a, b, share] of axles) {
      const want = ((total * share) / 2) * (vsaCut ? 0.3 : 1);
      const la = L[a] * 0.97;
      const lb = L[b] * 0.97;
      const weak = la <= lb ? a : b;
      const strong = weak === a ? b : a;
      const lw = Math.min(la, lb);
      const ls = Math.max(la, lb);
      const fw = Math.min(want, lw);
      const fs = Math.min(2 * want - fw, ls, DIFF_BIAS * fw);
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
    WHEEL_DEFS.forEach((_, i) => {
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
      this.say(vsaCut ? '空転検知: VSAが出力をカット中' : 'タイヤが空転している', 'warn');
    }

    // ---- digging in: spinning on soft ground digs a rut; the tyre sinks, loses grip and drags
    WHEEL_DEFS.forEach((_, i) => {
      const st = this.wheelState[i];
      const wi = v.wheelInfos[i];
      const soft = st.surface === 'mud' ? 1 : st.surface === 'grass' ? 0.3 : 0;
      const rel = wi.worldTransform.position.vsub(ch.position);
      const vel = ch.getVelocityAtWorldPoint(rel, new Vec3());
      const hs = Math.hypot(vel.x, vel.z); // ground speed of the tyre
      if (st.spinning && soft && thr !== 0) this.dig[i] = Math.min(1, this.dig[i] + DIG_RATE * soft * dt);
      else if (!st.air && !soft) this.dig[i] = Math.max(0, this.dig[i] - 0.3 * dt); // firm surface / board under the tyre
      this.dig[i] = Math.max(0, this.dig[i] - 0.15 * Math.min(hs, 2) * dt); // rolling out of the rut fills it
      st.dig = this.dig[i];
      wi.suspensionRestLength = BASE_REST - this.dig[i] * DIG_SINK;
      if (this.dig[i] > 0.5 && !this.digWarned[i]) {
        this.digWarned[i] = true;
        this.say(`${WHEEL_DEFS[i].name}タイヤが泥を掘って沈んでいる! 空転を止めて板を噛ませよう`, 'warn');
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

    this._jackForce();
    this._ropeForce(dt);
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
    const kind = hit.body.userData?.kind;
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
      soft: kind === 'mud' && !padded,
    };
    this.emit('jackSet');
    if (this.jack.unstable) this.say(`ジャッキ設置面が傾いている(${tilt.toFixed(0)}°) 持ち上げると倒れる`, 'warn');
    else if (this.jack.soft) this.say('ぬかるみの上: 板やマットを下に敷かないと沈む', 'warn');
    else this.say('ジャッキを設置した (Z上げ / X下げ)', 'info');
  }

  jackMove(dir, dt) {
    if (!this.jack) return;
    const j = this.jack;
    j.target = clamp(j.target + dir * 0.12 * dt, 0, JACK_MAX_LIFT);
  }

  _jackForce() {
    const j = this.jack;
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
    const cp = this.cornerWorld(j.wheel);
    const targetY = j.y0 + j.lift - j.sink;
    const err = targetY - cp.y;
    const rel = cp.vsub(ch.position);
    const vel = ch.getVelocityAtWorldPoint(rel, new Vec3());
    const f = clamp(45000 * err - 4500 * vel.y, 0, 7500);
    if (f > 0) ch.applyForce(new Vec3(0, f, 0), rel);
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
    const vel = this.chassis.getVelocityAtWorldPoint(rel, new Vec3());
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
    const inside = WHEEL_DEFS[wheelIdx].x > 0 ? right.clone() : right.scale(-1);
    const dd = PLACE_DIRS[dirKey];
    let dir;
    let offset = 0.28 + spec.half[2];
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
    this.say(`${WHEEL_DEFS[wheelIdx].name}タイヤの${dd.label}に${spec.label}を置いた`, 'info');
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
      return `${WHEEL_DEFS[wheelIdx].name}タイヤが接地している: ヘルパーは浮いたタイヤの下にしか挟めない(ジャッキで浮かせる)`;
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
    this.say(`${WHEEL_DEFS[pv.wheel].name}タイヤの近くに${ITEM_SPECS[kind].label}を置いた`, 'info');
    return true;
  }

  /** Why this placed item cannot be pulled out right now (null = it can). */
  _recoverBlock(it) {
    const [hx, , hz] = ITEM_SPECS[it.kind].half;
    const inv = it.body.quaternion.inverse();
    for (let i = 0; i < WHEEL_DEFS.length; i++) {
      if (this.wheelState[i].air) continue; // a lifted tyre is not pressing on anything
      const wp = this.vehicle.wheelInfos[i].worldTransform.position;
      const l = inv.vmult(wp.vsub(it.body.position));
      if (Math.abs(l.x) <= hx + 0.1 && Math.abs(l.z) <= hz + 0.12 && Math.abs(l.y) < 0.45) {
        return `${WHEEL_DEFS[i].name}タイヤが乗っていて${ITEM_SPECS[it.kind].label}が抜けない`;
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
    // win: all four wheels on asphalt
    const onRoad = this.wheelState.every((w) => w.surface === 'road');
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
      vsa: this.vsa,
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
    };
  }
}
