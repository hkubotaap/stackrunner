// Regression checks: stage-1 balance per difficulty level, plus brake behaviour.
import { Sim } from '../src/sim.js';

// scripted player: alternate forward/back "rocking" with fixed steering
function play({ level = 'normal', setup = () => {}, vsa = true, fwd = 1, back = 1, sf = -1, sb = 1, secs = 40, engine = true }) {
  const s = new Sim({ level });
  s.vsa = vsa;
  setup(s);
  let t = 0;
  while (t < secs && !s.won && !s.flipped) {
    const f = t % (fwd + back) < fwd;
    s.setInput(engine ? { throttle: f ? 1 : -1, steer: f ? sf : sb, brake: false } : { throttle: 0, steer: 0, brake: false });
    s.update(1 / 60); t += 1 / 60;
  }
  return s.won;
}
const helpers = (s) => { s.placeItem('helper', 0, 'diagFront'); s.placeItem('helper', 2, 'diagFront'); };
const ropeAndHelpers = (s) => { s.toggleRope(); s.setPulling(true); helpers(s); };
const drive = { fwd: 10, back: 0, sf: -1, sb: -1, secs: 10 }; // hold forward + right

// every plain up/down rocking pattern a player might try, no items
const rockers = [];
for (const vsa of [true, false]) for (const fwd of [0.5, 1, 2.5]) for (const back of [0.5, 1]) for (const sf of [-1, 0]) for (const sb of [-1, 1]) rockers.push({ vsa, fwd, back, sf, sb });

const cases = [
  ['normal: no items, VSA on is stuck', () => play({ ...drive }), false],
  ['normal: helpers + VSA off escapes', () => play({ ...drive, vsa: false, setup: helpers }), true],
  ['normal: rope alone is stuck', () => play({ engine: false, setup: (s) => { s.toggleRope(); s.setPulling(true); } }), false],
  ['normal: rope + engine escapes', () => play({ ...drive, vsa: false, secs: 40, setup: (s) => { s.toggleRope(); s.setPulling(true); } }), true],
  ['hard: no item rocking never escapes', () => rockers.some((r) => play({ level: 'hard', ...r, secs: 30 })), false],
  ['hard: rope + helpers + rocking escapes', () => play({ level: 'hard', vsa: false, fwd: 1, back: 0.5, sf: -1, sb: 0, setup: ropeAndHelpers }), true],
  ['extreme: no item rocking never escapes', () => rockers.some((r) => play({ level: 'extreme', ...r, secs: 30 })), false],
  ['extreme: rope + helpers + rocking escapes', () => play({ level: 'extreme', vsa: false, fwd: 1, back: 1, sf: -1, sb: 0, setup: ropeAndHelpers }), true],
];

// brakes on asphalt: stopping distance from ~30 km/h
function onRoad(accelerate = true) {
  const s = new Sim({ level: 'normal' });
  s.chassis.position.set(1.6, 0.9, -34);
  s.chassis.quaternion.set(0, 0, 0, 1);
  s.chassis.velocity.set(0, 0, 0); s.chassis.angularVelocity.set(0, 0, 0);
  s.vsa = false;
  for (let i = 0; i < 120; i++) s.update(1 / 60);
  if (accelerate) {
    s.setInput({ throttle: 1, steer: 0, brake: false });
    for (let i = 0; i < 180; i++) s.update(1 / 60);
  }
  return s;
}
function stopDist(setup) {
  const s = onRoad(); const z0 = s.chassis.position.z;
  setup(s);
  for (let i = 0; i < 60 * 20 && Math.abs(s.speedKmh()) > 1; i++) s.update(1 / 60);
  return s.chassis.position.z - z0;
}
const coast = stopDist((s) => s.setInput({ throttle: 0, steer: 0, brake: false }));
const foot = stopDist((s) => s.setInput({ throttle: 0, steer: 0, brake: true }));
const side = stopDist((s) => { s.toggleSideBrake(); s.setInput({ throttle: 0, steer: 0, brake: false }); });
const override = stopDist((s) => s.setInput({ throttle: 1, steer: 0, brake: true }));
const sbCar = onRoad(false); sbCar.toggleSideBrake(); sbCar.setInput({ throttle: 1, steer: 0, brake: false });
for (let i = 0; i < 180; i++) sbCar.update(1 / 60);
console.log(`stopping distance: coast ${coast.toFixed(1)}m  foot ${foot.toFixed(1)}m  side ${side.toFixed(1)}m  override ${override.toFixed(1)}m`);
cases.push(
  ['foot brake stops much shorter than coasting', () => foot < coast * 0.3, true],
  ['side brake (rear only) brakes, but less than foot', () => side < coast && side > foot, true],
  ['brake overrides throttle', () => Math.abs(override - foot) < 0.5, true],
  ['side brake locks rear axle: cannot drive away', () => Math.abs(sbCar.speedKmh()) < 3, true],
);

// ---- solid obstacles: the car must stop at them, never pass through
function driveFrom(x, z, secs, level = 'normal') {
  const s = new Sim({ level });
  s.chassis.position.set(x, 0.9, z);
  s.chassis.quaternion.set(0, 0, 0, 1);
  s.chassis.velocity.set(0, 0, 0); s.chassis.angularVelocity.set(0, 0, 0);
  s.vsa = false;
  for (let i = 0; i < 120; i++) s.update(1 / 60);
  s.setInput({ throttle: 1, steer: 0, brake: false });
  for (let i = 0; i < secs * 60; i++) s.update(1 / 60);
  return s;
}
const treeCar = driveFrom(-9, -16, 10); // trunk at (-9, -6)
const truckCar = driveFrom(-1.2, -20, 12); // kei truck rear at z=2.55
const wallCar = driveFrom(1.6, 25, 14); // map edge at z=40.1
cases.push(
  ['tree trunk blocks the car', () => treeCar.chassis.position.z < -7.4, true],
  ['kei truck blocks the car', () => truckCar.chassis.position.z < 1.2, true],
  ['map boundary blocks the car', () => wallCar.chassis.position.z < 39, true],
);

// ---- digging in: holding throttle on mud buries the spinning tyres
const digger = new Sim({ level: 'hard' });
digger.vsa = false;
const y0 = digger.chassis.position.y;
digger.setInput({ throttle: 1, steer: 0, brake: false });
let maxDig = 0;
const touchedMud = [false, false, false, false];
for (let i = 0; i < 25 * 60; i++) {
  digger.update(1 / 60);
  maxDig = Math.max(maxDig, ...digger.dig);
  digger.wheelState.forEach((w, k) => { if (w.surface === 'mud') touchedMud[k] = true; });
}
console.log(`after 25s of wheelspin: max dig ${maxDig.toFixed(2)}, dig ${digger.dig.map((d) => d.toFixed(2)).join('/')}`);
cases.push(
  ['wheelspin on mud digs the tyres in', () => maxDig > 0.4, true],
  ['a tyre that never touched mud does not dig', () => digger.dig.every((d, k) => touchedMud[k] || d === 0), true],
);

// ---- rule: floor mats cannot go directly under a tyre
const ruleCar = new Sim({ level: 'hard' });
const matUnder = ruleCar.placeItem('mat', 0, 'under');
const matFront = ruleCar.placeItem('mat', 0, 'front');
const helperUnderGrounded = ruleCar.placeItem('helper', 0, 'under');
cases.push(
  ['floor mat under a tyre is refused and keeps its stock', () => matUnder === false && ruleCar.stock.mat === 3, true],
  ['floor mat elsewhere is still allowed', () => matFront, true],
  ['helper under a grounded tyre is refused and keeps its stock', () => helperUnderGrounded === false && ruleCar.stock.helper === 2, true],
);
// lift the front-left tyre with the jack: now a helper can be wedged under it, a mat still cannot
const lift = new Sim({ level: 'hard' });
lift.toggleJack(0);
for (let i = 0; i < 6 * 60; i++) { lift.jackMove(1, 1 / 60); lift.update(1 / 60); }
const liftedAir = lift.wheelState[0].air;
const wp = lift.vehicle.wheelInfos[0].worldTransform.position;
const tapHelperLifted = lift.previewAt('helper', wp.x, wp.z).ok;
const tapMatLifted = lift.previewAt('mat', wp.x, wp.z);
const groundedIdx = lift.wheelState.findIndex((w) => !w.air); // jacking one corner also floats others
const gp = lift.vehicle.wheelInfos[groundedIdx].worldTransform.position;
const tapHelperGrounded = lift.previewAt('helper', gp.x, gp.z);
const keyHelperLifted = lift.placeItem('helper', 0, 'under');
cases.push(
  ['jack lifts the tyre off the ground', () => liftedAir, true],
  ['helper may be wedged under a lifted tyre (key + tap)', () => tapHelperLifted && keyHelperLifted, true],
  ['floor mat is refused even under a lifted tyre', () => tapMatLifted.ok === false, true],
  ['tap under a grounded tyre is refused for a helper', () => tapHelperGrounded.ok === false && /接地/.test(tapHelperGrounded.reason), true],
);

// ---- mouse / tap placement rules
const tap = new Sim({ level: 'hard' });
const wp0 = tap.vehicle.wheelInfos[0].worldTransform.position; // front-left tyre, in the ditch
const nearX = wp0.x - 0.9; // 0.9 m toward the road: valid reach, clear of the tyre
const pvHelper = tap.previewAt('helper', nearX, wp0.z + 0.3);
const pvMatUnder = tap.previewAt('mat', wp0.x, wp0.z);
const pvMatNear = tap.previewAt('mat', nearX, wp0.z + 0.3);
const pvFar = tap.previewAt('helper', wp0.x + 9, wp0.z);
const placed = tap.placeItemAt('helper', nearX, wp0.z + 0.3);
const stacked = tap.placeItemAt('helper', nearX, wp0.z + 0.3); // second one lands on top of the first
const outOfStock = tap.placeItemAt('helper', nearX, wp0.z + 0.3);
cases.push(
  ['tap: helper near a tyre is accepted', () => pvHelper.ok === true, true],
  ['tap: floor mat directly under a tyre is refused', () => pvMatUnder.ok === false && /真下/.test(pvMatUnder.reason), true],
  ['tap: floor mat beside the tyre is accepted', () => pvMatNear.ok === true, true],
  ['tap: too far to reach is refused', () => pvFar.ok === false && /遠すぎ/.test(pvFar.reason), true],
  ['tap: placing consumes stock and stacks on an existing item', () => placed && stacked && tap.stock.helper === 0 && tap.items.length === 2 && tap.items[1].body.position.y > tap.items[0].body.position.y + 0.03, true],
  ['tap: no stock left means no placement', () => outOfStock === false, true],
);

// ---- recovering: a tyre standing on an item pins it
const pin = new Sim({ level: 'hard' });
pin.toggleJack(0);
for (let i = 0; i < 6 * 60; i++) { pin.jackMove(1, 1 / 60); pin.update(1 / 60); }
pin.placeItem('helper', 0, 'under'); // allowed: the tyre is off the ground
for (let i = 0; i < 8 * 60; i++) { pin.jackMove(-1, 1 / 60); pin.update(1 / 60); } // lower the car onto the helper
const standingOn = pin.wheelState[0].surface === 'helper';
const refused = pin.recoverLastItem();
const stillThere = pin.items.length === 1;
for (let i = 0; i < 8 * 60; i++) { pin.jackMove(1, 1 / 60); pin.update(1 / 60); } // lift again: the tyre leaves it
const freed = pin.recoverLastItem();
// a free item elsewhere is recovered even though an older one is pinned
const mix = new Sim({ level: 'hard' });
mix.placeItem('helper', 0, 'diagFront');
const mixOk = mix.recoverLastItem() && mix.items.length === 0 && mix.stock.helper === 2;
cases.push(
  ['tyre rests on the helper after the jack is lowered', () => standingOn, true],
  ['an item with a tyre on it cannot be recovered', () => refused === false && stillThere, true],
  ['it can be recovered once the tyre is lifted off again', () => freed === true && pin.items.length === 0, true],
  ['a free item is recovered normally and refunded', () => mixOk, true],
);

let fail = 0;
for (const [name, fn, expect] of cases) {
  const got = fn();
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
process.exit(fail ? 1 : 0);
