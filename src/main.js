import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCar } from './carModel.js';
import { buildImpreza } from './carImpreza.js';
import { buildHustler } from './carHustler.js';
import { GameAudio } from './audio.js';
import { Sim, LEVELS, STAGES, CARS, TREES, WHEEL_DEFS, PLACE_DIRS, ITEM_SPECS, SURFACE_LABEL } from './sim.js';

const $ = (id) => document.getElementById(id);
let levelKey = 'hard';
let carKey = 'nbox';
let stageKey = 'ditch';
const makeSim = () => new Sim({ level: levelKey, car: carKey, stage: stageKey });
let sim = makeSim();
const audio = new GameAudio();
let lastRatchet = 0;
let armed = null; // 'helper' | 'mat' | 'scoop' | 'jack' : click / tap on the ground to use it

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec5e8);
scene.fog = new THREE.Fog(0x9ec5e8, 35, 90);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(-2.5, 4, -6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2.5;
controls.maxDistance = 28;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(3.75, 0.5, 0);

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6a5a45, 0.85));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
sun.position.set(-12, 22, -8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
scene.add(sun);
scene.add(sun.target);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ terrain (built from the physics bodies)
const TERRAIN_COLOR = { road: 0x3c4046, grass: 0x5d8c3d, mud: 0x6e4b2c, packed: 0xcfd6de, snow: 0xf1f5f9, bare: 0x8d8f8f, drift: 0xfbfdff };
const terrainGroup = new THREE.Group();
scene.add(terrainGroup);
function buildTerrain() {
  for (const c of [...terrainGroup.children]) { terrainGroup.remove(c); c.geometry.dispose(); c.material.dispose(); }
  for (const body of sim.world.bodies) {
    const ud = body.userData;
    if (!ud?.terrain) continue;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(ud.half[0] * 2, ud.half[1] * 2, ud.half[2] * 2),
      new THREE.MeshStandardMaterial({ color: TERRAIN_COLOR[ud.kind], roughness: ud.kind === 'mud' ? 0.95 : 0.9 }),
    );
    m.position.copy(body.position);
    m.quaternion.copy(body.quaternion);
    m.receiveShadow = true;
    terrainGroup.add(m);
  }
}
buildTerrain();

// winter stage: diggable snow cells (rebuilt whenever the scoop changes the grid)
const snowGroup = new THREE.Group();
scene.add(snowGroup);
const snowMat = new THREE.MeshStandardMaterial({ color: 0xfbfdff, roughness: 0.95 });
let snowShown = -1;
function syncSnow() {
  if (!sim.snowGrid) {
    if (snowGroup.children.length) { snowGroup.clear(); snowShown = -1; }
    return;
  }
  if (snowShown === sim.snowVersion && snowGroup.children.length) return;
  snowShown = sim.snowVersion;
  for (const c of [...snowGroup.children]) { snowGroup.remove(c); c.geometry.dispose(); }
  for (const col of sim.snowGrid) for (const cell of col) {
    if (cell.h <= 0) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, cell.h, 0.5), snowMat);
    m.position.set(cell.x, cell.h / 2, cell.z);
    m.receiveShadow = true;
    snowGroup.add(m);
  }
}
function applyStageLook() {
  const winter = sim.stageKey === 'winter';
  const sky = winter ? 0xc8d6e3 : 0x9ec5e8;
  scene.background.setHex(sky);
  scene.fog.color.setHex(sky);
  document.documentElement.style.background = '#' + sky.toString(16).padStart(6, '0');
  roadMarks.visible = !winter;
  leaf.color.setHex(winter ? 0x8aa595 : 0x2f6b34);
  mudPoints.material.color.setHex(winter ? 0xf4f8ff : 0x5b3d25);
}
// road markings
const roadMarks = new THREE.Group();
scene.add(roadMarks);
const leaf = new THREE.MeshStandardMaterial({ color: 0x2f6b34 });
{
  const white = new THREE.MeshBasicMaterial({ color: 0xe8e8e0 });
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 80), white);
  edge.rotation.x = -Math.PI / 2; edge.position.set(2.7, 0.012, 0); roadMarks.add(edge);
  const edge2 = edge.clone(); edge2.position.x = -2.7; roadMarks.add(edge2);
  for (let z = -38; z < 38; z += 6) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 2.6), new THREE.MeshBasicMaterial({ color: 0xe8c040 }));
    d.rotation.x = -Math.PI / 2; d.position.set(0, 0.012, z); roadMarks.add(d);
  }
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a3e28 });
  for (const [x, z] of TREES) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.6, 8), trunk);
    t.position.set(x, 0.8, z); t.castShadow = true; scene.add(t);
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.3, 3.2, 10), leaf);
    c.position.set(x, 3, z); c.castShadow = true; scene.add(c);
  }
}

// ------------------------------------------------------------------ car (blue N-BOX Custom, see carModel.js)
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const CAR_BUILDERS = { nbox: buildCar, impreza: buildImpreza, hustler: buildHustler };
let car;
let wheelMeshes = [];
function loadCarModel() {
  if (car) {
    scene.remove(car);
    wheelMeshes.forEach((w) => scene.remove(w));
  }
  const built = CAR_BUILDERS[sim.car.id](envMap, sim.wheelDefs);
  car = built.group;
  wheelMeshes = built.wheels;
  scene.add(car);
  wheelMeshes.forEach((w) => scene.add(w));
  const title = document.getElementById('cartitle');
  if (title) title.textContent = sim.car.label.toUpperCase();
  audio.configure(sim.car.audio);
  const vk = document.getElementById('vsakey');
  if (vk) vk.textContent = sim.car.vsaName ?? '(この車には装置なし)';
}

loadCarModel();

// ------------------------------------------------------------------ mud spray + dirty tyres
const MAX_P = 600;
const pPos = new Float32Array(MAX_P * 3).fill(-1000);
const pVel = new Float32Array(MAX_P * 3);
const pLife = new Float32Array(MAX_P);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const mudPoints = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x5b3d25, size: 0.12, sizeAttenuation: true }));
mudPoints.frustumCulled = false;
scene.add(mudPoints);
let pHead = 0;
const dirt = [0, 0, 0, 0];
const TIRE_CLEAN = new THREE.Color(0x131416);
const TIRE_MUD = new THREE.Color(0x5a3f27);

function updateMud(dt) {
  const h = sim.getHud();
  const f = sim.forwardH();
  const dir = Math.sign(h.thr) || 1;
  h.wheels.forEach((w, i) => {
    if (w.surface === 'mud') dirt[i] = Math.min(1, dirt[i] + dt * (w.spinning ? 0.2 : 0.03));
    wheelMeshes[i].userData.tireMat.color.lerpColors(TIRE_CLEAN, TIRE_MUD, dirt[i]);
    if (!(w.spinning && (w.surface === 'mud' || w.surface === 'drift') && h.thr !== 0)) return;
    const wp = sim.vehicle.wheelInfos[i].worldTransform.position;
    const n = Math.floor(70 * dt + Math.random());
    for (let k = 0; k < n; k++) {
      const j = pHead; pHead = (pHead + 1) % MAX_P;
      pPos[j * 3] = wp.x; pPos[j * 3 + 1] = wp.y - 0.22; pPos[j * 3 + 2] = wp.z;
      const sp = 2 + Math.random() * 3.5;
      pVel[j * 3] = -f.x * dir * sp + (Math.random() - 0.5) * 1.4;
      pVel[j * 3 + 1] = 1.8 + Math.random() * 2.6;
      pVel[j * 3 + 2] = -f.z * dir * sp + (Math.random() - 0.5) * 1.4;
      pLife[j] = 0.5 + Math.random() * 0.5;
    }
  });
  for (let j = 0; j < MAX_P; j++) {
    if (pLife[j] <= 0) continue;
    pLife[j] -= dt;
    pVel[j * 3 + 1] -= 9.8 * dt;
    pPos[j * 3] += pVel[j * 3] * dt;
    pPos[j * 3 + 1] += pVel[j * 3 + 1] * dt;
    pPos[j * 3 + 2] += pVel[j * 3 + 2] * dt;
    if (pLife[j] <= 0 || pPos[j * 3 + 1] < -0.6) { pLife[j] = 0; pPos[j * 3 + 1] = -1000; }
  }
  pGeo.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ truck / rope / jack / items
const truck = new THREE.Group();
{
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
  const bed = new THREE.MeshStandardMaterial({ color: 0xc9ccc9, roughness: 0.7 });
  const cab = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.15, 1.2, 3, 0.08), white);
  cab.position.set(0, 1.05, 0.95); cab.castShadow = true;
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: 0x14202c }));
  win.position.set(0, 1.25, 0.95);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.9), bed);
  deck.position.set(0, 0.62, -0.7); deck.castShadow = true;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 3.2), new THREE.MeshStandardMaterial({ color: 0x333 }));
  frame.position.set(0, 0.45, 0);
  truck.add(cab, win, deck, frame);
  for (const [x, z] of [[0.66, 1.0], [-0.66, 1.0], [0.66, -1.0], [-0.66, -1.0]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15171a }));
    w.position.set(x, 0.28, z); truck.add(w);
  }
  scene.add(truck);
}
const ropeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), new THREE.MeshStandardMaterial({ color: 0xd9b36a }));
ropeMesh.visible = false;
scene.add(ropeMesh);

const jackMesh = new THREE.Group();
{
  const m = new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.5, metalness: 0.3 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), m);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 0.9, roughness: 0.3 }));
  col.name = 'col';
  jackMesh.add(base, col);
  jackMesh.visible = false;
  scene.add(jackMesh);
}

const itemMeshes = new Map();
function syncItems() {
  const alive = new Set(sim.items.map((i) => i.id));
  for (const [id, mesh] of itemMeshes) {
    if (!alive.has(id)) { scene.remove(mesh); itemMeshes.delete(id); }
  }
  for (const it of sim.items) {
    let mesh = itemMeshes.get(it.id);
    if (!mesh) {
      const h = ITEM_SPECS[it.kind].half;
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2),
        new THREE.MeshStandardMaterial({ color: it.kind === 'helper' ? 0xff7a1a : 0x2a2d33, roughness: 0.8 }),
      );
      mesh.receiveShadow = true;
      scene.add(mesh);
      itemMeshes.set(it.id, mesh);
    }
    mesh.position.copy(it.body.position);
    mesh.quaternion.copy(it.body.quaternion);
  }
}

function setCylinder(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length() || 1e-3;
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}

// ------------------------------------------------------------------ HUD
const DIR_ORDER = Object.keys(PLACE_DIRS);
let dirIdx = 1; // diagonal front is the most useful default
let selWheel = 0;
const held = new Set();

const wheelsEl = $('wheels');
const wheelRows = WHEEL_DEFS.map((w, i) => {
  const row = document.createElement('div');
  row.className = 'wheel';
  row.innerHTML = `<span class="nm">${i + 1} ${w.name}</span><span class="sf"></span><span class="st"></span><div class="bar"><i></i></div>`;
  row.onclick = () => { selWheel = i; };
  wheelsEl.appendChild(row);
  return row;
});
const dirBtns = DIR_ORDER.map((k, i) => {
  const b = document.createElement('button');
  b.className = 'tb';
  b.textContent = PLACE_DIRS[k].label;
  b.onclick = () => { dirIdx = i; };
  $('dirs').appendChild(b);
  return b;
});

const stageBtns = Object.entries(STAGES).map(([k, st]) => {
  const b = document.createElement('button');
  b.className = 'tb';
  b.textContent = st.label;
  b.onclick = () => { stageKey = k; reset(); };
  $('stages').appendChild(b);
  return [k, b];
});

const carBtns = Object.entries(CARS).map(([k, c]) => {
  const b = document.createElement('button');
  b.className = 'tb';
  b.textContent = c.short ?? c.label;
  b.title = c.note;
  b.onclick = () => { carKey = k; reset(); };
  $('cars').appendChild(b);
  return [k, b];
});

const levelBtns = Object.entries(LEVELS).map(([k, lv]) => {
  const b = document.createElement('button');
  b.className = 'tb';
  b.textContent = lv.label;
  b.onclick = () => { levelKey = k; reset(); };
  $('levels').appendChild(b);
  return [k, b];
});

function arm(tool) {
  armed = armed === tool ? null : tool;
  if (armed && armed !== 'jack' && armed !== 'scoop' && sim.stock[armed] <= 0) { armed = null; sim.say('もう無い', 'warn'); }
}

const act = {
  helper: () => sim.placeItem('helper', selWheel, DIR_ORDER[dirIdx]),
  mat: () => sim.placeItem('mat', selWheel, DIR_ORDER[dirIdx]),
  scoop: () => sim.scoopDir(selWheel, DIR_ORDER[dirIdx]),
  recover: () => sim.recoverLastItem(),
  jack: () => sim.toggleJack(selWheel),
  rope: () => sim.toggleRope(),
  vsa: () => sim.toggleVsa(),
  reset: () => reset(),
};
$('b-helper').onclick = () => arm('helper');
$('b-mat').onclick = () => arm('mat');
$('b-scoop').onclick = () => arm('scoop');
$('b-recover').onclick = act.recover;
$('b-jack').onclick = () => (sim.jack ? act.jack() : arm('jack'));
$('b-rope').onclick = act.rope;
$('vsa').onclick = act.vsa;
$('b-reset').onclick = act.reset;
$('b-retry').onclick = act.reset;
$('b-side').onclick = () => sim.toggleSideBrake();
for (const [id, key] of [['b-up', 'KeyZ'], ['b-down', 'KeyX'], ['b-pull', 'KeyG'], ['b-foot', 'ShiftLeft']]) {
  const el = $(id);
  el.addEventListener('pointerdown', () => held.add(key));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => held.delete(key));
}
document.addEventListener('pointerdown', () => audio.start());
document.addEventListener('click', (e) => { if (e.target instanceof HTMLButtonElement) e.target.blur(); });

addEventListener('keydown', (e) => {
  audio.start();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(e.code)) e.preventDefault();
  held.add(e.code);
  if (e.repeat) return;
  const m = /^Digit([1-4])$/.exec(e.code);
  if (m) selWheel = Number(m[1]) - 1;
  switch (e.code) {
    case 'Space': sim.toggleSideBrake(); break;
    case 'KeyQ': act.helper(); break;
    case 'KeyE': act.mat(); break;
    case 'KeyC': act.scoop(); break;
    case 'Backspace': act.recover(); break;
    case 'KeyF': dirIdx = (dirIdx + 1) % DIR_ORDER.length; break;
    case 'KeyJ': act.jack(); break;
    case 'KeyR': act.rope(); break;
    case 'KeyV': act.vsa(); break;
    case 'KeyM': pushLog({ text: audio.toggleMute() ? '音: ミュート' : '音: ON', kind: 'info' }); break;
    case 'Escape': act.reset(); break;
    default:
  }
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());

const logEl = $('log');
function pushLog(msg) {
  const d = document.createElement('div');
  d.textContent = msg.text;
  d.className = msg.kind;
  logEl.appendChild(d);
  while (logEl.children.length > 7) logEl.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 9000);
}

function updateHud() {
  const h = sim.getHud();
  $('speed').textContent = Math.abs(h.speed).toFixed(0);
  $('gear').textContent = h.thr > 0 ? 'D' : h.thr < 0 ? 'R' : 'P/N';
  const v = $('vsa');
  v.textContent = h.vsaName ? `${h.vsaName} ${h.vsa ? 'ON' : 'OFF'}` : '横滑り防止なし';
  v.disabled = !h.vsaName;
  v.className = (h.vsa ? 'on' : '') + (h.vsaCut ? ' cut' : '');
  h.wheels.forEach((w, i) => {
    const r = wheelRows[i];
    r.classList.toggle('sel', i === selWheel);
    r.querySelector('.sf').textContent = `${SURFACE_LABEL[w.surface]}${w.air ? '' : ` μ${w.grip.toFixed(2)}`}${w.dig > 0.05 ? ` 掘${Math.round(w.dig * 100)}%` : ''}`;
    const st = r.querySelector('.st');
    st.textContent = w.air ? '浮き' : w.spinning ? '空転' : `${Math.round(w.load / 93)}%`;
    st.className = 'st' + (w.air ? ' air' : w.spinning ? ' spin' : '');
    const bar = r.querySelector('.bar i');
    bar.style.width = `${Math.min(100, (w.grip / 1.25) * 100)}%`;
    bar.style.background = w.grip < 0.3 ? 'var(--bad)' : w.grip < 0.8 ? 'var(--warn)' : 'var(--good)';
  });
  $('misc').innerHTML = `経過 ${h.time.toFixed(0)}s ・ ミス ${h.misses}<br>` +
    `スノーヘルパー残 ${h.stock.helper} / フロアマット残 ${h.stock.mat} / スコップ ${h.stage === 'winter' ? '○' : '(雪がない)'}`;
  $('b-helper').disabled = h.stock.helper <= 0;
  $('b-scoop').disabled = h.stage !== 'winter';
  $('b-scoop').classList.toggle('on', armed === 'scoop');
  if (armed === 'scoop' && h.stage !== 'winter') armed = null;
  if (armed && armed !== 'jack' && armed !== 'scoop' && h.stock[armed] <= 0) armed = null;
  $('b-mat').disabled = h.stock.mat <= 0;
  $('b-helper').classList.toggle('on', armed === 'helper');
  $('b-mat').classList.toggle('on', armed === 'mat');
  const hint = $('armhint');
  hint.style.display = armed ? 'block' : 'none';
  hint.textContent = armed === 'jack' ? 'ジャッキを置くタイヤをクリック/タップ(ボタンをもう一度押すと解除)'
    : armed === 'scoop' ? '雪を掘る所をクリック/タップ(1回で約12cm。タイヤの下は掘れない / ボタンをもう一度押すと解除)'
    : armed ? (armed === 'helper' ? 'スノーヘルパー' : 'フロアマット') + 'を置く場所をクリック/タップ(ボタンをもう一度押すと解除)' : '';
  renderer.domElement.classList.toggle('armed', !!armed);
  dirBtns.forEach((b, i) => b.classList.toggle('on', i === dirIdx));
  $('l-side').className = h.sideBrake ? 'on' : '';
  $('l-foot').className = h.footBrake ? 'on' : '';
  $('l-hold').className = h.autoHold ? 'hold' : '';
  $('b-side').classList.toggle('on', h.sideBrake);
  $('brakeinfo').textContent = h.sideBrake ? 'サイド: 後輪ロック中' : h.autoHold ? 'オートホールド作動' : '停車中は自動で保持';
  levelBtns.forEach(([k, b]) => b.classList.toggle('on', k === levelKey));
  stageBtns.forEach(([k, b]) => b.classList.toggle('on', k === stageKey));
  carBtns.forEach(([k, b]) => b.classList.toggle('on', k === carKey));
  $('b-jack').classList.toggle('on', !!h.jack || armed === 'jack');
  $('b-rope').classList.toggle('on', !!h.rope);
  $('jackinfo').textContent = h.jack
    ? `${WHEEL_DEFS[h.jack.wheel].name}: 高さ ${(h.jack.lift * 100).toFixed(0)}cm${h.jack.soft ? ' / 沈下中' : ''}${h.jack.unstable ? ' / 傾斜面!' : ''}`
    : '選択タイヤの位置に設置';
  $('ropeinfo').textContent = h.rope
    ? `張力 ${Math.round(h.rope.tension)}N${h.truckStalled ? ' / 軽トラ空転' : ''}`
    : '未接続';

  const end = $('end');
  if (h.won || h.flipped) {
    end.style.display = 'block';
    end.className = 'panel ' + (h.won ? 'win' : 'lose');
    end.querySelector('h1').textContent = h.won ? '脱出成功!' : '横転…';
    $('endbody').innerHTML = h.won
      ? `<p>タイム ${h.time.toFixed(0)}秒 ・ ミス ${h.misses}回</p><p>設置中の道具 ${h.itemsUsed}個 ・ ${h.vsaName ? `${h.vsaName} ${h.vsa ? 'ON' : 'OFF'}` : '横滑り防止なし'}</p>`
      : '<p>車体が傾きすぎました。</p>';
  } else end.style.display = 'none';
}

// ------------------------------------------------------------------ mouse / tap placement
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = { x: 0, y: 0, inside: false, down: null, active: new Set() };
function pickGround(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects([...terrainGroup.children, ...snowGroup.children, ...itemMeshes.values()], false)[0];
  return hit ? hit.point : null;
}
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4cd08a, transparent: true, opacity: 0.55, depthWrite: false });
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
ghost.visible = false;
scene.add(ghost);
const hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4cd08a }));
hoverRing.visible = false;
scene.add(hoverRing);

function updateGhost() {
  ghost.visible = false;
  hoverRing.visible = false;
  if (!armed || !pointer.inside) return;
  const pt = pickGround(pointer.x, pointer.y);
  if (!pt) return;
  if (armed === 'jack') {
    const nw = sim.nearestWheel(pt.x, pt.z);
    const wp = sim.vehicle.wheelInfos[nw.wheel].worldTransform.position;
    hoverRing.visible = true;
    hoverRing.position.set(wp.x, wp.y - 0.2, wp.z);
    hoverRing.scale.setScalar(1);
    hoverRing.material.color.setHex(nw.dist < 1.4 ? 0x4cd08a : 0xff5d5d);
    return;
  }
  if (armed === 'scoop') {
    const sp = sim.previewScoop(pt.x, pt.z);
    const c = sp.cell;
    if (!c) return;
    hoverRing.visible = true;
    hoverRing.position.set(c.x, c.h + 0.03, c.z);
    hoverRing.scale.setScalar(0.6);
    hoverRing.material.color.setHex(sp.ok ? 0x4cd08a : 0xff5d5d);
    return;
  }
  const spec = ITEM_SPECS[armed];
  const pv = sim.previewAt(armed, pt.x, pt.z);
  ghost.visible = true;
  ghost.scale.set(spec.half[0] * 2, spec.half[1] * 2 + 0.01, spec.half[2] * 2);
  ghostMat.color.setHex(pv.ok ? 0x4cd08a : 0xff5d5d);
  if (pv.ok) {
    const n = new THREE.Vector3(pv.hit.hitNormalWorld.x, pv.hit.hitNormalWorld.y, pv.hit.hitNormalWorld.z);
    const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(pv.dir.x, pv.dir.z));
    ghost.quaternion.copy(qTilt.multiply(qYaw));
    ghost.position.set(pv.hit.hitPointWorld.x, pv.hit.hitPointWorld.y, pv.hit.hitPointWorld.z).addScaledVector(n, spec.half[1]);
  } else {
    ghost.quaternion.identity();
    ghost.position.set(pt.x, pt.y + 0.02, pt.z);
  }
}

function handleTap(cx, cy) {
  const pt = pickGround(cx, cy);
  if (!pt) return;
  const nw = sim.nearestWheel(pt.x, pt.z);
  if (armed === 'jack') {
    if (nw.dist < 1.4) { selWheel = nw.wheel; sim.toggleJack(nw.wheel); armed = null; } else sim.say('タイヤの近くをタップしてください', 'warn');
  } else if (armed === 'scoop') {
    sim.scoopAt(pt.x, pt.z);
  } else if (armed) {
    sim.placeItemAt(armed, pt.x, pt.z);
  } else if (nw.dist < 0.9) {
    selWheel = nw.wheel; // tap a tyre to select it
  }
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  pointer.active.add(e.pointerId);
  pointer.down = pointer.active.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; // multi-touch = camera gesture
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
});
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
  if (pointer.down && Math.hypot(e.clientX - pointer.down.x, e.clientY - pointer.down.y) > 7) pointer.down = null; // it is a drag
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
for (const ev of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(ev, (e) => {
    pointer.active.delete(e.pointerId);
    const d = pointer.down;
    pointer.down = null;
    if (ev === 'pointerup' && d && performance.now() - d.t < 600) handleTap(e.clientX, e.clientY);
    if (e.pointerType === 'touch') pointer.inside = false;
  });
}

// on-screen driving pads (touch devices)
for (const b of document.querySelectorAll('#touch button')) {
  const key = b.dataset.key;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); held.add(key); b.classList.add('down'); audio.start(); });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => { held.delete(key); b.classList.remove('down'); });
}
const toolsEl = $('tools');
const syncToolsHeight = () => document.documentElement.style.setProperty('--tools-h', `${toolsEl.offsetHeight}px`);
new ResizeObserver(syncToolsHeight).observe(toolsEl);
syncToolsHeight();

// ------------------------------------------------------------------ main loop
function reset() {
  sim = makeSim();
  loadCarModel();
  buildTerrain();
  snowShown = -1;
  applyStageLook();
  lastRatchet = 0;
  armed = null;
  dirt.fill(0);
  pLife.fill(0);
  pPos.fill(-1000);
  for (const mesh of itemMeshes.values()) scene.remove(mesh);
  itemMeshes.clear();
  logEl.innerHTML = '';
  held.clear();
  selWheel = 0;
  controls.target.set(...(sim.stageKey === 'winter' ? [5, 0.5, 0] : [3.75, 0.5, 0]));
  camera.position.set(-2.5, 4, -6);
  sayIntro();
}

function syncCar() {
  car.position.copy(sim.chassis.position);
  car.quaternion.copy(sim.chassis.quaternion);
  sim.vehicle.wheelInfos.forEach((wi, i) => {
    const g = wheelMeshes[i];
    g.position.copy(wi.worldTransform.position);
    g.quaternion.copy(wi.worldTransform.quaternion);
    g.getObjectByName('ring').visible = i === selWheel;
  });
  truck.position.set(-1.2, 0, sim.truckZ);

  if (sim.rope) {
    const a = car.localToWorld(new THREE.Vector3(...sim.car.hook));
    const b = new THREE.Vector3(-1.2, 0.55, sim.truckZ - 1.7);
    ropeMesh.visible = true;
    setCylinder(ropeMesh, a, b);
    ropeMesh.material.color.setHex(sim.rope.tension > 4500 ? 0xff5d5d : sim.rope.tension > 0 ? 0xf0c878 : 0xd9b36a);
  } else ropeMesh.visible = false;

  const j = sim.jack;
  jackMesh.visible = !!j;
  if (j && j.cornerY !== undefined) {
    const inward = new THREE.Vector3(-Math.sign(WHEEL_DEFS[j.wheel].x) * 0.42, 0, 0).applyQuaternion(car.quaternion);
    const top = j.cornerY - 0.3;
    const h = Math.max(0.06, top - j.baseY);
    jackMesh.position.set(j.cornerX + inward.x, j.baseY, j.cornerZ + inward.z);
    const col = jackMesh.getObjectByName('col');
    col.scale.y = h;
    col.position.y = h / 2;
  }
  syncItems();
  syncSnow();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  const k = (c) => held.has(c);
  sim.setInput({
    throttle: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
    steer: (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0),
    brake: k('ShiftLeft') || k('ShiftRight'),
  });
  sim.setPulling(k('KeyG'));
  sim.jackMove((k('KeyZ') ? 1 : 0) - (k('KeyX') ? 1 : 0), dt);
  sim.update(dt);

  for (const m of sim.messages.splice(0)) pushLog(m);
  for (const ev of sim.events.splice(0)) audio.play(ev);
  if (sim.jack) {
    // bottle-jack ratchet: one click per ~1.2cm of travel while pumping
    const step = Math.floor(sim.jack.target / 0.012);
    if (step !== lastRatchet) { audio.ratchet(); lastRatchet = step; }
  } else lastRatchet = 0;
  syncCar();
  updateMud(dt);
  updateGhost();
  updateHud();
  audio.update(sim.getHud(), dt, {
    truckDist: camera.position.distanceTo(truck.position),
    truckPulling: k('KeyG'),
    truckStalled: sim.truckStalled,
  });

  // keep the camera following the car
  const prev = controls.target.clone();
  controls.target.lerp(car.position, 0.15);
  camera.position.add(controls.target.clone().sub(prev));
  controls.update();
  sun.position.set(car.position.x - 12, 22, car.position.z - 8);
  sun.target.position.copy(car.position);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

$('loading').remove();
function sayIntro() {
  sim.say(`${sim.car.label}${sim.stage.intro}`, 'info');
  sim.say('音が出ない時は、何かキーを押す(M でミュート)', 'info');
  sim.say(sim.stageKey === 'winter' ? 'スコップボタン(C)で雪山を掘ってから、ゆっくり発進' : 'まずは 1-4 でタイヤを選び、Q/E で道具を置く', 'info');
}
applyStageLook();
sayIntro();
requestAnimationFrame(frame);

// debug hook for automated checks
window.__stackrunner = { get sim() { return sim; }, camera, controls };
