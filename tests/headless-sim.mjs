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
  ['hard: rope + helpers + rocking escapes', () => play({ level: 'hard', vsa: false, fwd: 0.5, back: 0.5, sf: -1, sb: -1, setup: ropeAndHelpers }), true],
  ['extreme: no item rocking never escapes', () => rockers.some((r) => play({ level: 'extreme', ...r, secs: 30 })), false],
  ['extreme: rope + helpers + rocking escapes', () => play({ level: 'extreme', vsa: false, fwd: 0.5, back: 0.5, sf: -1, sb: -1, setup: ropeAndHelpers }), true],
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
const pw = pin.vehicle.wheelInfos[0].worldTransform.position;
pin.placeItemAt('mat', pw.x - 0.45, pw.z); // pad beside the jack base (not under the tyre): the jack does not sink into the mud
pin.toggleJack(0);
for (let i = 0; i < 6 * 60; i++) { pin.jackMove(1, 1 / 60); pin.update(1 / 60); }
pin.placeItem('helper', 0, 'under'); // allowed: the tyre is off the ground
const helperItem = pin.items.find((it) => it.kind === 'helper');
for (let i = 0; i < 8 * 60; i++) { pin.jackMove(-1, 1 / 60); pin.update(1 / 60); } // lower the car onto the helper
const standingOn = pin.wheelState[0].surface === 'helper';
const pinned = pin._recoverBlock(helperItem) !== null;
pin.recoverLastItem(); // the helper is pinned: whatever else comes out, the helper stays
const helperStays = pin.items.includes(helperItem);
for (let i = 0; i < 8 * 60; i++) { pin.jackMove(1, 1 / 60); pin.update(1 / 60); } // lift again: the tyre leaves it
const freed = pin._recoverBlock(helperItem) === null && (() => { while (pin.items.length && pin.recoverLastItem()); return pin.items.length === 0; })();
// a free item elsewhere is recovered even though an older one is pinned
const mix = new Sim({ level: 'hard' });
mix.placeItem('helper', 0, 'diagFront');
const mixOk = mix.recoverLastItem() && mix.items.length === 0 && mix.stock.helper === 2;
cases.push(
  ['tyre rests on the helper after the jack is lowered', () => standingOn, true],
  ['an item with a tyre on it stays pinned', () => pinned && helperStays, true],
  ['it can be recovered once the tyre is lifted off again', () => freed, true],
  ['a free item is recovered normally and refunded', () => mixOk, true],
);

// ---- jack: lifts a corner smoothly, holds it without bobbing, never tips the car
for (const level of ['normal', 'hard']) {
  const jk = new Sim({ level });
  const w0 = jk.vehicle.wheelInfos[0].worldTransform.position;
  jk.placeItemAt('mat', w0.x - 0.45, w0.z); // pad beside the jack base: no mud sinking during the hold
  jk.toggleJack(0);
  for (let i = 0; i < 6 * 60; i++) { jk.jackMove(1, 1 / 60); jk.update(1 / 60); }
  const ys = [];
  let minUp = 1;
  for (let i = 0; i < 4 * 60; i++) { jk.update(1 / 60); ys.push(jk.cornerWorld(0).y); minUp = Math.min(minUp, jk.tilt()); }
  const bob = Math.max(...ys) - Math.min(...ys);
  cases.push(
    [`jack (${level}): raised corner stays still (bob ${(bob * 100).toFixed(1)} cm)`, () => bob < 0.015, true],
    [`jack (${level}): floats the tyre and never tips the car`, () => jk.wheelState[0].air && minUp > 0.84, true],
  );
}

// ---- Impreza Sports Wagon (GG, 2.0 AWD): same map and rules, different car
const imp = new Sim({ car: 'impreza', level: 'hard' });
const iw = imp.vehicle.wheelInfos.map((w) => w.worldTransform.position);
const rockImp = [];
for (const vsa of [true, false]) for (const fwd of [0.5, 1, 2.5]) for (const back of [0.5, 1]) for (const sf of [-1, 0]) for (const sb of [-1, 1]) rockImp.push({ vsa, fwd, back, sf, sb });
function playImp(opts) {
  const s = new Sim({ car: 'impreza', level: 'hard' });
  s.vsa = opts.vsa;
  let tm = 0;
  while (tm < 30 && !s.won && !s.flipped) {
    const f = tm % (opts.fwd + opts.back) < opts.fwd;
    s.setInput({ throttle: f ? 1 : -1, steer: f ? opts.sf : opts.sb, brake: false });
    s.update(1 / 30); tm += 1 / 30;
  }
  return s.won;
}
const impDrive = (x, z, secs) => {
  const s = new Sim({ car: 'impreza' });
  s.chassis.position.set(x, 0.9, z); s.chassis.quaternion.set(0, 0, 0, 1);
  s.chassis.velocity.set(0, 0, 0); s.chassis.angularVelocity.set(0, 0, 0); s.vsa = false;
  for (let i = 0; i < 120; i++) s.update(1 / 60);
  s.setInput({ throttle: 1, steer: 0, brake: false });
  for (let i = 0; i < secs * 60; i++) s.update(1 / 60);
  return s.chassis.position.z;
};
const impJack = new Sim({ car: 'impreza', level: 'hard' });
const ijw = impJack.vehicle.wheelInfos[0].worldTransform.position;
impJack.placeItemAt('mat', ijw.x - 0.5, ijw.z);
impJack.toggleJack(0);
for (let i = 0; i < 7 * 60; i++) { impJack.jackMove(1, 1 / 60); impJack.update(1 / 60); }
const ijys = [];
for (let i = 0; i < 4 * 60; i++) { impJack.update(1 / 60); ijys.push(impJack.cornerWorld(0).y); }
cases.push(
  ['impreza: 1330 kg, wheelbase 2525 mm', () => imp.chassis.mass === 1330 && Math.abs(iw[0].z - iw[2].z - 2.525) < 0.002, true],
  ['impreza: starts with the left tyres in the mud, right on asphalt', () => imp.wheelState.map((w) => w.surface).join() === 'mud,road,mud,road', true],
  ['impreza: no-item rocking does not get it out (same map, same rules)', () => rockImp.some((r) => playImp(r)), false],
  ['impreza: floor mat under a tyre is still refused', () => imp.previewAt('mat', iw[0].x, iw[0].z).ok, false],
  ['impreza: helper under a grounded tyre is still refused', () => imp.previewAt('helper', iw[1].x, iw[1].z).ok, false],
  ['impreza: jack floats the tyre without bobbing', () => impJack.wheelState[0].air && Math.max(...ijys) - Math.min(...ijys) < 0.015, true],
  ['impreza: stopped by the tree trunk', () => impDrive(-9, -16, 10) < -7.5, true],
  ['impreza: stopped by the kei truck', () => impDrive(-1.2, -20, 12) < 0.8, true],
);

// ---- per-car stability / traction control: the Impreza (2003 2.0 NA) has none, so nothing cuts power
const noTc = new Sim({ car: 'impreza' });
const noTcMsg = noTc.vsa;
noTc.toggleVsa();
const spin = (car, vsa) => {
  const s = new Sim({ car, level: 'hard' }); s.vsa = vsa; s.setInput({ throttle: 1, steer: 0, brake: false });
  for (let i = 0; i < 3 * 60; i++) s.update(1 / 60);
  return { cut: s.vsaCut, dig: Math.max(...s.dig) };
};
cases.push(
  ['impreza: no traction control (starts off, toggle does nothing, hud shows none)', () => noTcMsg === false && noTc.vsa === false && noTc.getHud().vsa === false && noTc.getHud().vsaName === null, true],
  ['impreza: power is never cut even if vsa is forced on', () => spin('impreza', true).cut, false],
  ['nbox: VSA cuts power on wheelspin', () => spin('nbox', true).cut, true],
  ['hustler: ESP cuts power on wheelspin', () => spin('hustler', true).cut, true],
);

// ---- Hustler (HYBRID X 4WD): same map and rules, lighter and weaker car
const hus = new Sim({ car: 'hustler', level: 'hard' });
const hw = hus.vehicle.wheelInfos.map((w) => w.worldTransform.position);
function playHus(opts, level = 'hard') {
  const s = new Sim({ car: 'hustler', level });
  s.vsa = opts.vsa;
  (opts.setup ?? (() => {}))(s);
  let tm = 0;
  while (tm < (opts.secs ?? 30) && !s.won && !s.flipped) {
    const f = tm % (opts.fwd + opts.back) < opts.fwd;
    s.setInput({ throttle: f ? 1 : -1, steer: f ? opts.sf : opts.sb, brake: false });
    s.update(1 / 30); tm += 1 / 30;
  }
  return s.won;
}
const husDrive = (x, z, secs) => {
  const s = new Sim({ car: 'hustler' });
  s.chassis.position.set(x, 0.9, z); s.chassis.quaternion.set(0, 0, 0, 1);
  s.chassis.velocity.set(0, 0, 0); s.chassis.angularVelocity.set(0, 0, 0); s.vsa = false;
  for (let i = 0; i < 120; i++) s.update(1 / 60);
  s.setInput({ throttle: 1, steer: 0, brake: false });
  for (let i = 0; i < secs * 60; i++) s.update(1 / 60);
  return s.chassis.position.z;
};
const husJack = new Sim({ car: 'hustler', level: 'hard' });
const hjw = husJack.vehicle.wheelInfos[0].worldTransform.position;
husJack.placeItemAt('mat', hjw.x - 0.5, hjw.z);
husJack.toggleJack(0);
for (let i = 0; i < 7 * 60; i++) { husJack.jackMove(1, 1 / 60); husJack.update(1 / 60); }
const hjys = [];
for (let i = 0; i < 4 * 60; i++) { husJack.update(1 / 60); hjys.push(husJack.cornerWorld(0).y); }
const husRopeHelpers = (s) => { s.toggleRope(); s.setPulling(true); s.placeItem('helper', 0, 'diagFront'); s.placeItem('helper', 2, 'diagFront'); };
cases.push(
  ['hustler: 850 kg, wheelbase 2460 mm', () => hus.chassis.mass === 850 && Math.abs(hw[0].z - hw[2].z - 2.46) < 0.002, true],
  ['hustler: traction control is labelled ESP (others VSA) and toggles', () => { const e = new Sim({ car: 'hustler' }); const m = new Sim({ car: 'nbox' }); const b = e.vsa; e.toggleVsa(); return e.car.vsaName === 'ESP' && m.car.vsaName === 'VSA' && e.vsa === !b; }, true],
  ['hustler: starts with the left tyres in the mud, right on asphalt', () => hus.wheelState.map((w) => w.surface).join() === 'mud,road,mud,road', true],
  ['hustler hard: no item rocking never escapes', () => rockImp.some((r) => playHus(r)), false],
  ['hustler extreme: no item rocking never escapes', () => rockImp.some((r) => playHus(r, 'extreme')), false],
  ['hustler hard: rope + helpers + rocking escapes', () => playHus({ vsa: false, fwd: 0.5, back: 0.5, sf: -1, sb: -1, setup: husRopeHelpers }), true],
  ['hustler extreme: rope + helpers + rocking escapes', () => playHus({ vsa: false, fwd: 0.5, back: 0.5, sf: -1, sb: -1, secs: 60, setup: husRopeHelpers }, 'extreme'), true],
  ['hustler: floor mat under a tyre is still refused', () => hus.previewAt('mat', hw[0].x, hw[0].z).ok, false],
  ['hustler: helper under a grounded tyre is still refused', () => hus.previewAt('helper', hw[1].x, hw[1].z).ok, false],
  ['hustler: jack floats the tyre without bobbing', () => husJack.wheelState[0].air && Math.max(...hjys) - Math.min(...hjys) < 0.015, true],
  ['hustler: stopped by the tree trunk', () => husDrive(-9, -16, 10) < -7.5, true],
  ['hustler: stopped by the kei truck', () => husDrive(-1.2, -20, 12) < 1.0, true],
);

// ---- winter stage (冬道): snow ridge beside the road, dig it out with the scoop
const winterSim = (level, car) => new Sim({ stage: 'winter', level, car });
const rowsFor = (a, b) => { const r = []; for (let z = a; z <= b + 1e-6; z += 0.5) r.push(z); return r; };
/** dig every cell (x in xs, z in rows) down to `target` metres; skips cells the scoop refuses (under a tyre) */
function digTo(s, rows, target = 0.22, xs = [4.25, 3.75, 3.25]) {
  let strokes = 0;
  for (const z of rows) for (const x of xs) {
    for (let k = 0; k < 60; k++) {
      const c = s.cellAt(x, z);
      if (!c || c.h <= target || !s.previewScoop(x, z).ok) break;
      while (s.time < s.scoopReady) s.update(0.05);
      if (s.scoopAt(x, z)) strokes++; else break;
    }
  }
  return strokes;
}
function winterPlay({ level = 'normal', car, rows = null, rope = false, fw = 0.5, bw = 1, secs = 40 }) {
  const s = winterSim(level, car);
  s.vsa = false;
  if (rows) digTo(s, rows);
  if (rope) { s.toggleRope(); s.setPulling(true); }
  let t = 0;
  while (t < secs && !s.won && !s.flipped) {
    const f = t % (fw + bw) < fw;
    s.setInput({ throttle: f ? 1 : -1, steer: f ? -1 : 1, brake: false });
    s.update(1 / 60); t += 1 / 60;
  }
  return s.won;
}
const w0 = winterSim('hard');
const ridge = w0.cellAt(3.75, 0.25);
const ridgeRho = ridge.rho;
const ridgeH0 = ridge.h;
const okScoop = w0.scoopAt(3.75, 0.25);
const ridgeH1 = w0.cellAt(3.75, 0.25).h;
const swinging = w0.scoopAt(3.75, 0.25); // still swinging: nothing happens
w0.update(2);
const powder = w0.cellAt(4.75, -3.25); // loose drift away from the tyres: a full stroke
const powderH0 = powder.h;
w0.scoopAt(4.75, -3.25);
const powderStroke = powderH0 - w0.cellAt(4.75, -3.25).h;
const farScoop = w0.previewScoop(7.6, 4.6);
const wheelPos = w0.vehicle.wheelInfos[1].worldTransform.position; // front-right tyre
const tyreScoop = w0.previewScoop(wheelPos.x, wheelPos.z);
for (let i = 0; i < 40 && w0.cellAt(3.75, 0.25).h > 0; i++) { while (w0.time < w0.scoopReady) w0.update(0.05); w0.scoopAt(3.75, 0.25); }
const ditchSim = new Sim({ level: 'hard' });
cases.push(
  ['winter: car starts with all four tyres on the powder drift', () => w0.wheelState.map((w) => w.surface).join() === 'drift,drift,drift,drift', true],
  ['winter: loose powder gives a full 12 cm stroke', () => Math.abs(powderStroke - 0.12) < 1e-6, true],
  ['winter: the denser plowed ridge gives a shorter stroke (120 / (rho/150) mm)', () => okScoop && Math.abs(ridgeH0 - ridgeH1 - 0.12 * (150 / ridgeRho)) < 1e-6 && ridgeH0 - ridgeH1 < 0.12, true],
  ['winter: a second swing right away does nothing', () => swinging === false, true],
  ['winter: the ridge can be dug down to bare ground (body removed)', () => w0.cellAt(3.75, 0.25).h === 0 && w0.cellAt(3.75, 0.25).body === null, true],
  ['winter: too far to reach is refused', () => farScoop.ok === false && /遠すぎ/.test(farScoop.reason), true],
  ['winter: cannot dig under a tyre that is standing on it', () => tyreScoop.ok === false && /タイヤ/.test(tyreScoop.reason), true],
  ['winter: the scoop does nothing on the ditch stage', () => ditchSim.previewScoop(3.75, 0.25).ok === false, true],
  ['winter: no digging, rocking never escapes (all levels)', () => ['normal', 'hard', 'extreme'].some((level) => winterPlay({ level })), false],
  ['winter: no digging, rope + rocking never escapes', () => ['normal', 'hard'].some((level) => winterPlay({ level, rope: true })), false],
  ['winter normal: dig the ridge + rope + rocking escapes', () => winterPlay({ level: 'normal', rows: rowsFor(-1.25, 1.75), rope: true }), true],
  ['winter hard: dig the ridge (wider cut) + rope + rocking escapes', () => winterPlay({ level: 'hard', rows: rowsFor(-1.75, 2.25), rope: true, secs: 60 }), true],
  ['winter extreme: dig the ridge + rope + rocking escapes (wider cut, longer)', () => winterPlay({ level: 'extreme', rows: rowsFor(-1.75, 2.25), rope: true, secs: 60 }), true],
);

// ---- snow physics: compaction, ice, sinking, hardness, pushing
const snowMass = (s) => s.snowGrid.flat().reduce((a, c) => a + c.m, 0);
const spinSim = winterSim('normal');
spinSim.vsa = false;
const spinLog = [];
spinSim.setInput({ throttle: 1, steer: 0, brake: false });
const spinY0 = spinSim.chassis.position.y;
const cellUnderFL0 = spinSim.wheelState[0].cell;
const flRho0 = cellUnderFL0.rho;
const flH0 = cellUnderFL0.h;
for (let sec = 1; sec <= 40; sec++) {
  for (let i = 0; i < 60; i++) spinSim.update(1 / 60);
  const w = spinSim.wheelState[0]; // the cell under the front-left tyre at that moment (the car shifts and sinks)
  spinLog.push({ sec, kind: w.surface, mu: w.grip, rho: w.cell.rho, glaze: w.cell.glaze, h: w.cell.h });
}
const muAt = (sec) => spinLog[sec - 1].mu;
const bestMu = Math.max(...spinLog.map((l) => l.mu));
const mass0 = snowMass(winterSim('normal'));
// pushing: unit-level rules of the bulldozer (the physics contact feeds it the force)
const dz = winterSim('hard');
const src = dz.cellAt(3.75, 0.25);
const dst = dz.cellAt(3.25, 0.25);
const edge = dz.cellAt(7.75, 0.25);
const m0 = src.m + dst.m;
const dstRho0 = dst.rho;
const dstH0 = dst.h;
const touchedA = new Set();
dz._bulldoze(src, -1, 0, 100, 1 / 60, touchedA); // far below the crushing strength of a 0.4 m ridge cell... see pushYield
const movedWeak = dst.m - (m0 - src.m);
const touchedB = new Set();
for (let i = 0; i < 120; i++) dz._bulldoze(src, -1, 0, 1e6, 1 / 60, touchedB); // a huge push
for (const c of touchedB) dz._snowChanged(c);
const wallBefore = dz.cellAt(3.25, 0.25);
const wallRho = wallBefore.rho;
const edgeTouched = new Set();
dz._bulldoze(edge, 1, 0, 1e6, 1 / 60, edgeTouched); // pushing toward the solid bank: nothing to push into
const edgeMass = edge.m;
// belly-out: a car sitting on the ridge loads that cell
const belly = winterSim('normal');
const bellyRho0 = belly.snowGrid.flat().map((c) => c.rho);
for (let i = 0; i < 6 * 60; i++) belly.update(1 / 60);
const bellyRho1 = belly.snowGrid.flat().map((c) => c.rho);
// physical push: a loose pile in front of the bumper of a car facing the ridge is shoved into the next column
const phys = winterSim('normal', 'hustler');
phys.vsa = false;
for (let z = -1.75; z <= 1.75; z += 0.5) { const c = phys.cellAt(4.25, z); c.rho = 100; c.h = 0.34; c.m = 34; phys._snowChanged(c); }
phys.chassis.position.set(6.2, 0.7, 0); phys.chassis.quaternion.setFromEuler(0, -Math.PI / 2, 0);
phys.chassis.velocity.set(0, 0, 0); phys.chassis.angularVelocity.set(0, 0, 0);
for (let i = 0; i < 120; i++) phys.update(1 / 60);
const colM = (s, x) => [-0.75, -0.25, 0.25, 0.75].reduce((acc, z) => acc + s.cellAt(x, z).m, 0);
const colBefore = [colM(phys, 4.25), colM(phys, 3.75)];
const physMass0 = snowMass(phys);
phys.setInput({ throttle: 1, steer: 0, brake: false });
for (let i = 0; i < 15 * 60; i++) phys.update(1 / 60);
cases.push(
  ['snow: driving into a loose pile shoves it into the next column (mass moves, total kept)', () => colM(phys, 4.25) < colBefore[0] - 1 && colM(phys, 3.75) > colBefore[1] + 1 && Math.abs(snowMass(phys) - physMass0) < 1e-6, true],
);
cases.push(
  ['snow: wheelspin on powder packs it (denser, lower height, same mass)', () => spinLog[9].rho > flRho0 * 2 && spinLog[9].h < flH0 * 0.6, true],
  ['snow: packed snow grips better than the loose powder it came from', () => bestMu > muAt(1) * 1.8 && bestMu > 0.38, true],
  ['snow: sustained wheelspin turns it to polished ice (low grip, dense, glazed)', () => spinLog[39].rho > 750 && spinLog[39].glaze === 1 && spinLog[39].kind === 'ice' && spinLog[39].mu < 0.15, true],
  ['snow: the car sinks as the snow under its tyres is packed', () => spinSim.chassis.position.y < spinY0 - 0.08, true],
  ['snow: packing never creates or destroys snow (only digging removes mass)', () => Math.abs(snowMass(spinSim) - mass0) < 1e-6, true],
  ['snow: pushing below the crushing strength moves nothing', () => touchedA.size === 0 && Math.abs(movedWeak) < 1e-12, true],
  ['snow: a hard push moves snow into the next cell and keeps the mass', () => touchedB.size === 2 && src.m < 1e-6 + (m0 - dst.m) && Math.abs(src.m + dst.m - m0) < 1e-6 && dst.m > 0, true],
  ['snow: pushed snow is packed denser and piles up (a wall)', () => wallRho > dstRho0 * 1.05 && wallBefore.h > dstH0, true],
  ['snow: the pile cannot be pushed into a solid bank', () => edgeTouched.size === 0 && edge.m === edgeMass, true],
  ['snow: the underbody resting on the ridge packs it (belly-out)', () => bellyRho1.some((r, i) => r > bellyRho0[i] + 1), true],
  ['snow: ice only chips (stroke <= 1/5 of a powder stroke, never refused)', () => { const s = winterSim('normal'); const c = s.cellAt(4.75, -3.25); c.rho = 900; c.m = c.h * 900; s._snowChanged(c); const h0 = c.h; s.scoopAt(4.75, -3.25); return h0 - c.h > 0 && h0 - c.h <= 0.12 / 5 + 1e-9; }, true],
  ['snow: the scoop is slower on dense snow', () => { const a = winterSim('normal'); a.scoopAt(4.75, -3.25); const tl = a.scoopReady - a.time; const b = winterSim('normal'); const c = b.cellAt(4.75, -2.75); c.rho = 450; c.m = c.h * 450; b._snowChanged(c); b.scoopAt(4.75, -2.75); return b.scoopReady - b.time > tl * 2; }, true],
);

let fail = 0;
for (const [name, fn, expect] of cases) {
  const got = fn();
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
process.exit(fail ? 1 : 0);
