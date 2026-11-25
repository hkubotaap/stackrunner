// Visual model of the 3rd-gen Honda N-BOX Custom (JF5/JF6): 3395 x 1475 x 1815 mm (4WD), wheelbase 2520, track 1295,
// ground clearance 145 mm. Cues: full-width single-line LED light bar, gloss-black grille, tall straight tail lamps.
// Car-local axes: +Z forward, +Y up, +X = car's LEFT (sliding-door side). Origin = physics centre of mass.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 1.475;
const HALF = W / 2;
const FLOOR = -0.575; // underbody height
const ARCH_R = 0.36;
const ARCH_Y = -0.43; // wheel centre height at rest
const AXLE_Z = 1.26;

function plateTexture(text1, text2) {
  const c = document.createElement('canvas');
  c.width = 330; c.height = 165;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c500';
  g.fillRect(0, 0, 330, 165);
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 314, 149);
  g.fillStyle = '#111';
  g.textAlign = 'center';
  g.font = 'bold 34px "Yu Gothic UI", "Meiryo", sans-serif';
  g.fillText(text1, 165, 52);
  g.font = 'bold 74px "Arial Narrow", Arial, sans-serif';
  g.fillText(text2, 165, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildCar(envMap, wheelDefs) {
  const group = new THREE.Group();
  const mat = (o) => new THREE.MeshPhysicalMaterial({ envMap, envMapIntensity: 1, ...o });
  const paint = mat({ color: 0x1b58d0, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.5 });
  const glass = mat({ color: 0x0a141d, metalness: 0.9, roughness: 0.08, envMapIntensity: 0.7 });
  const black = mat({ color: 0x0e1014, roughness: 0.55, metalness: 0.1 });
  const trim = mat({ color: 0x1b1e23, roughness: 0.75 });
  const chrome = mat({ color: 0xe9eef2, metalness: 1, roughness: 0.1 });
  const lens = mat({ color: 0xcfdbe4, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8 });
  const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6f4ff, emissiveIntensity: 2.2 });
  const red = new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xc01010, emissiveIntensity: 0.25, roughness: 0.35 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x06080b });
  const add = (m) => { group.add(m); return m; };

  // ---------------------------------------------------------------- body shell: side profile extruded across the width
  const sh = new THREE.Shape();
  const ch = Math.sqrt(ARCH_R ** 2 - (FLOOR - ARCH_Y) ** 2);
  const a0 = Math.atan2(FLOOR - ARCH_Y, -ch) + 2 * Math.PI; // start angle (left of the notch)
  const a1 = Math.atan2(FLOOR - ARCH_Y, ch); // end angle
  sh.moveTo(-1.70, -0.45);
  sh.lineTo(-1.64, FLOOR);
  sh.lineTo(-AXLE_Z - ch, FLOOR);
  sh.absarc(-AXLE_Z, ARCH_Y, ARCH_R, a0, a1, true);
  sh.lineTo(AXLE_Z - ch, FLOOR);
  sh.absarc(AXLE_Z, ARCH_Y, ARCH_R, a0, a1, true);
  sh.lineTo(1.64, FLOOR);
  sh.lineTo(1.70, -0.45);
  sh.lineTo(1.72, -0.05);
  sh.lineTo(1.70, 0.20);
  sh.lineTo(1.66, 0.33); // hood nose
  sh.lineTo(0.62, 0.50); // cowl
  sh.lineTo(0.15, 1.095); // windshield header
  sh.lineTo(-1.55, 1.095); // roof
  sh.lineTo(-1.66, 1.025);
  sh.lineTo(-1.69, 0.2);
  sh.lineTo(-1.72, -0.05);
  sh.closePath();
  const bevel = 0.06;
  const bodyGeo = new THREE.ExtrudeGeometry(sh, {
    depth: W - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelOffset: -bevel * 0.8,
    bevelSegments: 4,
    curveSegments: 28,
  });
  bodyGeo.translate(0, 0, -(W - 2 * bevel) / 2);
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo.computeVertexNormals();
  add(new THREE.Mesh(bodyGeo, paint));

  // ---------------------------------------------------------------- glass
  const sideGlass = (pts, sign) => {
    const shp = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(sign > 0 ? -z : z, y)));
    const g = new THREE.ShapeGeometry(shp);
    g.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(sign * (HALF + 0.003), 0, 0);
    return new THREE.Mesh(g, glass);
  };
  for (const s of [1, -1]) {
    add(sideGlass([[0.585, 0.545], [0.235, 0.98], [-0.20, 0.98], [-0.20, 0.545]], s)); // front door
    add(sideGlass([[-0.34, 0.545], [-0.34, 0.98], [-1.50, 0.98], [-1.50, 0.545]], s)); // rear
  }
  // slanted panels (A, B = [z,y] ends of the profile segment)
  const quad = (A, B, halfW, off, material, flip = false) => {
    const dz = B[0] - A[0];
    const dy = B[1] - A[1];
    const L = Math.hypot(dz, dy);
    let nz = -dy / L;
    let ny = dz / L;
    if (flip) { nz = -nz; ny = -ny; }
    const m = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.006, L), material);
    m.rotation.x = -Math.atan2(dy, dz);
    m.position.set(0, (A[1] + B[1]) / 2 + ny * off, (A[0] + B[0]) / 2 + nz * off);
    return add(m);
  };
  quad([0.17, 1.065], [0.60, 0.53], 0.63, 0.004, glass); // windshield
  quad([-1.662, 0.965], [-1.678, 0.50], 0.56, 0.004, glass, true); // tailgate window
  // wipers
  for (const [x0, x1] of [[0.55, -0.05], [-0.05, -0.55]]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.008, 0.012), black);
    w.position.set((x0 + x1) / 2, 0.545, 0.585);
    w.rotation.set(-0.5, 0.1 * Math.sign(x0 + x1 || 1), 0);
    add(w);
  }

  // ---------------------------------------------------------------- door lines, handles, mirrors
  for (const s of [1, -1]) {
    const lines = s > 0 ? [0.70, -0.30, -1.42] : [0.70, -0.30, -1.0];
    for (const z of lines) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, 1.36, 0.006), lineMat);
      l.position.set(s * (HALF + 0.001), 0.15, z);
      add(l);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, 2.2), lineMat);
    sill.position.set(s * (HALF + 0.001), -0.40, -0.35);
    add(sill);
    const handles = s > 0 ? [[0.10, 0.42], [-0.50, 0.42]] : [[0.10, 0.42]];
    for (const [z, y] of handles) {
      const hd = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.03, 0.14, 2, 0.01), chrome);
      hd.position.set(s * (HALF + 0.004), y, z);
      add(hd);
    }
    // door mirror
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), paint);
    arm.position.set(s * (HALF + 0.05), 0.60, 0.52);
    const mir = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.12, 0.22, 3, 0.04), paint);
    mir.position.set(s * (HALF + 0.12), 0.65, 0.46);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.1, 0.19), glass);
    face.position.set(s * (HALF + 0.12), 0.65, 0.4);
    face.rotation.y = s * 0.0;
    face.position.z = 0.46 - 0.108;
    face.scale.set(10, 1, 0.05);
    add(arm); add(mir);
    const mf = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.006), glass);
    mf.position.set(s * (HALF + 0.12), 0.65, 0.46 - 0.112);
    add(mf);
  }

  // ---------------------------------------------------------------- front end (N-BOX Custom face)
  const FZ = 1.712;
  // gloss-black grille (little chrome), one full-width LED light bar ("一文字ライト") above it
  const grille = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.13, 0.045, 3, 0.02), black);
  grille.position.set(0, 0.10, FZ);
  add(grille);
  for (let i = 0; i < 7; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.006, 0.02), mat({ color: 0x23272e, metalness: 0.6, roughness: 0.3 }));
    slat.position.set(0, 0.055 + i * 0.016, FZ + 0.026);
    add(slat);
  }
  const emblem = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.06, 0.012, 2, 0.006), chrome);
  emblem.position.set(0, 0.10, FZ + 0.04);
  add(emblem);
  const lightBar = new THREE.Mesh(new RoundedBoxGeometry(1.28, 0.075, 0.04, 3, 0.03), lens);
  lightBar.position.set(0, 0.255, FZ - 0.005);
  const barLed = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.014, 0.01), led);
  barLed.position.set(0, 0.255, FZ + 0.017);
  const barBack = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.085, 0.036, 3, 0.03), black);
  barBack.position.set(0, 0.255, FZ - 0.012);
  add(barBack); add(lightBar); add(barLed);
  for (const s of [1, -1]) {
    // LED projectors at the outer ends of the bar
    for (const x of [0.46, 0.56]) {
      const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16).rotateX(Math.PI / 2), led);
      proj.position.set(s * x, 0.255, FZ + 0.016);
      add(proj);
    }
    // fog lamp + lower intake
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.02, 20).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff0c0, emissiveIntensity: 0.5 }));
    fog.position.set(s * 0.60, -0.28, FZ + 0.0);
    const fogRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 20), chrome);
    fogRing.position.copy(fog.position); fogRing.position.z += 0.01;
    const intake = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.13, 0.04, 2, 0.02), black);
    intake.position.set(s * 0.40, -0.17, FZ);
    add(fog); add(fogRing); add(intake);
  }
  const fPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165),
    new THREE.MeshStandardMaterial({ map: plateTexture('品川 480', 'あ 12-34'), roughness: 0.5 }));
  fPlate.position.set(0, -0.19, FZ + 0.022);
  add(fPlate);
  const lipSpoiler = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.05, 0.07, 2, 0.02), black);
  lipSpoiler.position.set(0, -0.42, 1.70);
  add(lipSpoiler);

  // ---------------------------------------------------------------- rear end
  const RZ = -1.712;
  for (const s of [1, -1]) {
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.70, 0.04, 2, 0.012), red);
    tail.position.set(s * 0.645, 0.38, RZ + 0.005);
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.3 }));
    rev.position.set(s * 0.60, -0.06, RZ + 0.002);
    add(tail); add(rev);
  }
  const rBump = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.16, 0.06, 2, 0.03), black);
  rBump.position.set(0, -0.33, -1.70);
  add(rBump);
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165),
    new THREE.MeshStandardMaterial({ map: plateTexture('品川 480', 'あ 12-34'), roughness: 0.5 }));
  rPlate.rotation.y = Math.PI;
  rPlate.position.set(0, -0.04, RZ - 0.003);
  add(rPlate);
  const stop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.03), red);
  stop.position.set(0, 1.01, -1.668);
  add(stop);
  const rEmblem = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.05, 0.012, 2, 0.006), chrome);
  rEmblem.position.set(0.0, 0.30, RZ);
  add(rEmblem);

  // ---------------------------------------------------------------- roof details
  const antenna = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.035, 0.2, 3, 0.015), black);
  antenna.position.set(0, 1.115, -1.2);
  add(antenna);
  for (const s of [1, -1]) {
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.02, 1.5, 2, 0.008), black);
    rail.position.set(s * 0.62, 1.11, -0.78);
    add(rail);
  }

  // ---------------------------------------------------------------- wheel wells
  for (const z of [AXLE_Z, -AXLE_Z]) {
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.48, 0.72), black);
    fill.position.set(0, -0.31, z);
    add(fill);
    for (const s of [1, -1]) {
      const liner = new THREE.Mesh(
        new THREE.CylinderGeometry(ARCH_R - 0.006, ARCH_R - 0.006, 0.29, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1, side: THREE.DoubleSide }),
      );
      liner.position.set(s * 0.595, ARCH_Y, z);
      add(liner);
      const flare = new THREE.Mesh(new THREE.TorusGeometry(ARCH_R + 0.05, 0.013, 6, 40, Math.PI + 0.7).rotateZ(-0.35).rotateY(Math.PI / 2), trim);
      flare.position.set(s * (HALF + 0.004), ARCH_Y, z);
      add(flare);
    }
  }
  const under = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 3.3), black);
  under.position.set(0, FLOOR - 0.01, 0);
  add(under);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---------------------------------------------------------------- wheels (15" alloy, 165/55R15)
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.92 });
  const alloy = mat({ color: 0xb9c0c8, metalness: 1, roughness: 0.22 });
  const alloyDark = mat({ color: 0x2b2f35, metalness: 0.8, roughness: 0.4 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.8, roughness: 0.45 });
  const tireProfile = [
    [0.188, -0.082], [0.212, -0.089], [0.246, -0.085], [0.270, -0.065], [0.279, -0.035], [0.281, -0.012],
    [0.2765, -0.006], [0.281, 0], [0.2765, 0.006], [0.281, 0.012], [0.279, 0.035], [0.270, 0.065],
    [0.246, 0.085], [0.212, 0.089], [0.188, 0.082],
  ].map(([r, x]) => new THREE.Vector2(r, x));
  const tireGeo = new THREE.LatheGeometry(tireProfile, 48).rotateZ(Math.PI / 2);
  const wheels = wheelDefs.map((wd) => {
    const g = new THREE.Group();
    const tireOwn = tireMat.clone(); // per wheel: mud stains each tyre separately
    g.userData.tireMat = tireOwn;
    const tire = new THREE.Mesh(tireGeo, tireOwn);
    tire.castShadow = true;
    g.add(tire);
    const dish = new THREE.Group(); // outward = +x inside this group
    dish.scale.x = wd.x > 0 ? 1 : -1;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 32, 1, true).rotateZ(Math.PI / 2), alloyDark);
    barrel.material = alloyDark.clone(); barrel.material.side = THREE.DoubleSide;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.188, 0.011, 8, 40).rotateY(Math.PI / 2), alloy);
    lip.position.x = 0.075;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 32).rotateZ(Math.PI / 2), alloyDark);
    face.position.x = 0.04;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 20).rotateZ(Math.PI / 2), alloy);
    hub.position.x = 0.055;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 16).rotateZ(Math.PI / 2), chrome);
    cap.position.x = 0.072;
    dish.add(barrel, lip, face, hub, cap);
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.x = (i / 5) * Math.PI * 2;
      for (const off of [-0.012, 0.012]) {
        const sp = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.15, 0.016, 2, 0.006), alloy);
        sp.position.set(0.052, 0.105, off);
        sp.rotation.x = -off * 2.2;
        pivot.add(sp);
      }
      dish.add(pivot);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6).rotateZ(Math.PI / 2), chrome);
      const a = (i / 5) * Math.PI * 2 + 0.3;
      nut.position.set(0.07, Math.cos(a) * 0.04, Math.sin(a) * 0.04);
      dish.add(nut);
    }
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 32).rotateZ(Math.PI / 2), disc);
    rotor.position.x = -0.035;
    dish.add(rotor);
    g.add(dish);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.022, 8, 40).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    ring.name = 'ring';
    g.add(ring);
    return g;
  });

  return { group, wheels };
}
