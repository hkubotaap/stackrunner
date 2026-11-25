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

let fail = 0;
for (const [name, fn, expect] of cases) {
  const got = fn();
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
process.exit(fail ? 1 : 0);
