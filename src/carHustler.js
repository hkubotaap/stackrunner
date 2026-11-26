// Visual model of the Suzuki Hustler (MR52S, 2nd gen): 3395 x 1475 x 1680 mm, wheelbase 2460, 165/60R15.
// Two-tone: yellow body, white roof; round headlamps, slatted grille, black arch cladding. The design details and
// colours are from memory, not from a source.
// Car-local axes: +Z forward, +Y up, +X = car's LEFT. Origin = centre of mass (ground is 0.62 m below it). See cars.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 1.475;
const HALF = W / 2;
const GROUND = -0.62;
const FLOOR = GROUND + 0.18; // 180 mm ground clearance (assumed)
const ARCH_R = 0.33;
const ARCH_Y = GROUND + 0.2895; // wheel centre at rest
const AXLE_F = 1.08;
const AXLE_R = -1.38;
const FZ = 1.64; // front face
const RZ = -1.765; // rear face
const ROOF = 1.06;

function plateTexture(text1, text2) {
  const c = document.createElement('canvas');
  c.width = 330; c.height = 165;
  const g = c.getContext('2d');
  g.fillStyle = '#f2c500'; // kei plate
  g.fillRect(0, 0, 330, 165);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(8, 8, 314, 149);
  g.fillStyle = '#111'; g.textAlign = 'center';
  g.font = 'bold 34px "Yu Gothic UI", "Meiryo", sans-serif';
  g.fillText(text1, 165, 52);
  g.font = 'bold 74px "Arial Narrow", Arial, sans-serif';
  g.fillText(text2, 165, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildHustler(envMap, wheelDefs) {
  const group = new THREE.Group();
  const mat = (o) => new THREE.MeshPhysicalMaterial({ envMap, envMapIntensity: 1, ...o });
  const paint = mat({ color: 0xf0b400, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.7 });
  const white = mat({ color: 0xf4f4ef, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.7 });
  const glass = mat({ color: 0x0b141c, metalness: 0.9, roughness: 0.08, envMapIntensity: 0.7 });
  const black = mat({ color: 0x0e1014, roughness: 0.55, metalness: 0.1 });
  const trim = mat({ color: 0x1b1e23, roughness: 0.8 });
  const chrome = mat({ color: 0xe9eef2, metalness: 1, roughness: 0.1 });
  const silver = mat({ color: 0xa9aeb4, metalness: 0.85, roughness: 0.35 });
  const lens = mat({ color: 0xd8e2ea, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.82 });
  const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6f4ff, emissiveIntensity: 1.8 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xd88a14, emissive: 0xff9a10, emissiveIntensity: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0xc01010, emissiveIntensity: 0.3, roughness: 0.35 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x06080b });
  const add = (m) => { group.add(m); return m; };

  // ---------------------------------------------------------------- body shell (side profile extruded across the width)
  const sh = new THREE.Shape();
  const ch = Math.sqrt(ARCH_R ** 2 - (FLOOR - ARCH_Y) ** 2);
  const a0 = Math.atan2(FLOOR - ARCH_Y, -ch) + 2 * Math.PI;
  const a1 = Math.atan2(FLOOR - ARCH_Y, ch);
  sh.moveTo(RZ, -0.30);
  sh.lineTo(RZ + 0.045, FLOOR);
  sh.lineTo(AXLE_R - ch, FLOOR);
  sh.absarc(AXLE_R, ARCH_Y, ARCH_R, a0, a1, true);
  sh.lineTo(AXLE_F - ch, FLOOR);
  sh.absarc(AXLE_F, ARCH_Y, ARCH_R, a0, a1, true);
  sh.lineTo(FZ - 0.06, FLOOR);
  sh.lineTo(FZ - 0.01, -0.25);
  sh.lineTo(FZ, 0.05); // bumper face
  sh.lineTo(FZ - 0.04, 0.24); // hood nose
  sh.lineTo(0.42, 0.33); // cowl
  sh.lineTo(-0.08, ROOF); // windshield header
  sh.lineTo(-1.66, ROOF); // roof
  sh.lineTo(-1.72, ROOF - 0.05);
  sh.lineTo(-1.755, 0.50); // rear window, nearly upright
  sh.lineTo(RZ, 0.05);
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

  // white roof cap (two-tone)
  const roof = new THREE.Mesh(new RoundedBoxGeometry(W - 0.07, 0.03, 1.58, 3, 0.012), white);
  roof.position.set(0, ROOF - 0.005, -0.87);
  add(roof);

  // ---------------------------------------------------------------- glass
  const sideGlass = (pts, sign) => {
    const shp = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(sign > 0 ? -z : z, y)));
    const g = new THREE.ShapeGeometry(shp);
    g.rotateY(sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(sign * (HALF + 0.003), 0, 0);
    return new THREE.Mesh(g, glass);
  };
  for (const s of [1, -1]) {
    add(sideGlass([[0.33, 0.47], [-0.03, 0.97], [-0.63, 0.97], [-0.63, 0.47]], s)); // front door
    add(sideGlass([[-0.70, 0.47], [-0.70, 0.97], [-1.33, 0.97], [-1.33, 0.47]], s)); // rear door
    add(sideGlass([[-1.40, 0.47], [-1.40, 0.97], [-1.65, 0.97], [-1.69, 0.55]], s)); // quarter
  }
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
  quad([-0.06, 1.03], [0.40, 0.36], 0.64, 0.004, glass); // windshield (top, bottom)
  quad([-1.68, 1.01], [-1.745, 0.56], 0.60, 0.004, glass, true); // rear glass
  for (const [x0, x1] of [[0.6, 0.0], [0.0, -0.6]]) { // wipers
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.008, 0.012), black);
    w.position.set((x0 + x1) / 2, 0.36, 0.42);
    w.rotation.set(-0.95, 0.12 * Math.sign(x0 + x1 || 1), 0);
    add(w);
  }

  // ---------------------------------------------------------------- doors, handles, mirrors, cladding, roof rails
  for (const s of [1, -1]) {
    for (const z of [0.40, -0.66, -1.36]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.95, 0.006), lineMat);
      l.position.set(s * (HALF + 0.001), 0.0, z);
      add(l);
    }
    for (const z of [-0.08, -0.72]) {
      const hd = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.03, 0.12, 2, 0.01), paint);
      hd.position.set(s * (HALF + 0.005), 0.43, z);
      add(hd);
    }
    // black lower body cladding between the arches
    const cz0 = AXLE_R + ARCH_R + 0.05;
    const cz1 = AXLE_F - ARCH_R - 0.05;
    const clad = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.13, cz1 - cz0, 2, 0.008), trim);
    clad.position.set(s * (HALF + 0.003), FLOOR + 0.08, (cz0 + cz1) / 2);
    add(clad);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.05), black);
    arm.position.set(s * (HALF + 0.055), 0.50, 0.30);
    const mir = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.11, 0.18, 3, 0.04), white);
    mir.position.set(s * (HALF + 0.14), 0.54, 0.24);
    const mf = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.006), glass);
    mf.position.set(s * (HALF + 0.14), 0.54, 0.24 - 0.093);
    add(arm); add(mir); add(mf);
    // roof rails
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.03, 1.3, 2, 0.01), silver);
    rail.position.set(s * 0.60, ROOF + 0.035, -0.87);
    add(rail);
    for (const z of [-0.35, -1.40]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), black);
      foot.position.set(s * 0.60, ROOF + 0.015, z);
      add(foot);
    }
  }

  // ---------------------------------------------------------------- front end (round headlamps, slatted grille, skid plate)
  const grille = new THREE.Mesh(new RoundedBoxGeometry(0.60, 0.15, 0.04, 2, 0.015), black);
  grille.position.set(0, 0.09, FZ - 0.02);
  add(grille);
  for (const dy of [-0.045, 0, 0.045]) {
    const slat = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.02, 0.03, 2, 0.006), white);
    slat.position.set(0, 0.09 + dy, FZ + 0.002);
    add(slat);
  }
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.012), chrome);
  badge.position.set(0, 0.09, FZ + 0.02);
  add(badge);
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 28).rotateX(Math.PI / 2), black);
    ring.position.set(s * 0.50, 0.12, FZ - 0.035);
    const lensM = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.093, 0.03, 28).rotateX(Math.PI / 2), lens);
    lensM.position.set(s * 0.50, 0.12, FZ - 0.012);
    const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20).rotateX(Math.PI / 2), led);
    proj.position.set(s * 0.50, 0.12, FZ + 0.005);
    const turn = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.012), amber);
    turn.position.set(s * 0.62, -0.08, FZ - 0.01);
    add(ring); add(lensM); add(proj); add(turn);
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.02, 20).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff0c0, emissiveIntensity: 0.45 }));
    fog.position.set(s * 0.52, -0.20, FZ - 0.025);
    const fogRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 6, 20), silver);
    fogRing.position.copy(fog.position); fogRing.position.z += 0.01;
    add(fog); add(fogRing);
  }
  const fPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165), new THREE.MeshStandardMaterial({ map: plateTexture('品川 580', 'す 12-34'), roughness: 0.5 }));
  fPlate.position.set(0, -0.10, FZ + 0.005);
  add(fPlate);
  const skid = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.05, 0.1, 2, 0.02), silver);
  skid.position.set(0, -0.33, FZ - 0.04);
  add(skid);

  // ---------------------------------------------------------------- rear end
  for (const s of [1, -1]) {
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.30, 0.05, 3, 0.02), red);
    tail.position.set(s * 0.66, 0.22, RZ + 0.015);
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.3 }));
    rev.position.set(s * 0.60, -0.10, RZ + 0.005);
    add(tail); add(rev);
  }
  const rBump = new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.14, 0.08, 2, 0.03), black);
  rBump.position.set(0, -0.14, RZ + 0.03);
  add(rBump);
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165), new THREE.MeshStandardMaterial({ map: plateTexture('品川 580', 'す 12-34'), roughness: 0.5 }));
  rPlate.rotation.y = Math.PI;
  rPlate.position.set(0, 0.04, RZ - 0.004);
  add(rPlate);
  const spoiler = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.03, 0.14, 2, 0.012), white); // roof-end spoiler
  spoiler.position.set(0, ROOF - 0.02, -1.74);
  add(spoiler);
  const stop = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.02, 0.02), red);
  stop.position.set(0, ROOF - 0.045, -1.80);
  add(stop);

  // ---------------------------------------------------------------- wheel wells with black arch cladding
  for (const z of [AXLE_F, AXLE_R]) {
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.46, 0.7), black);
    fill.position.set(0, -0.15, z);
    add(fill);
    for (const s of [1, -1]) {
      const liner = new THREE.Mesh(
        new THREE.CylinderGeometry(ARCH_R - 0.006, ARCH_R - 0.006, 0.28, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1, side: THREE.DoubleSide }),
      );
      liner.position.set(s * 0.64, ARCH_Y, z);
      add(liner);
      const flare = new THREE.Mesh(new THREE.TorusGeometry(ARCH_R + 0.04, 0.02, 6, 40, Math.PI + 0.7).rotateZ(-0.35).rotateY(Math.PI / 2), trim);
      flare.position.set(s * (HALF + 0.004), ARCH_Y, z);
      add(flare);
    }
  }
  const under = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 3.3), black);
  under.position.set(0, FLOOR - 0.01, -0.06);
  add(under);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---------------------------------------------------------------- wheels: 15" alloy, 165/60R15
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.92 });
  const alloy = mat({ color: 0xc4c9ce, metalness: 1, roughness: 0.2 });
  const alloyDark = mat({ color: 0x2b2f35, metalness: 0.8, roughness: 0.4 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.8, roughness: 0.45 });
  const tireProfile = [
    [0.19, -0.0825], [0.215, -0.0865], [0.25, -0.08], [0.275, -0.06], [0.2865, -0.032], [0.2895, -0.007],
    [0.2895, 0.007], [0.2865, 0.032], [0.275, 0.06], [0.25, 0.08], [0.215, 0.0865], [0.19, 0.0825],
  ].map(([r, x]) => new THREE.Vector2(r, x));
  const tireGeo = new THREE.LatheGeometry(tireProfile, 48).rotateZ(Math.PI / 2);
  const wheels = wheelDefs.map((wd) => {
    const g = new THREE.Group();
    const tireOwn = tireMat.clone(); // per wheel: mud stains each tyre separately
    g.userData.tireMat = tireOwn;
    const tire = new THREE.Mesh(tireGeo, tireOwn);
    tire.castShadow = true;
    g.add(tire);
    const dish = new THREE.Group();
    dish.scale.x = wd.x > 0 ? 1 : -1;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.187, 0.187, 0.14, 32, 1, true).rotateZ(Math.PI / 2), alloyDark.clone());
    barrel.material.side = THREE.DoubleSide;
    const lipM = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.011, 8, 40).rotateY(Math.PI / 2), alloy);
    lipM.position.x = 0.075;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.012, 32).rotateZ(Math.PI / 2), alloyDark);
    face.position.x = 0.04;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 20).rotateZ(Math.PI / 2), alloy);
    hub.position.x = 0.055;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.014, 16).rotateZ(Math.PI / 2), chrome);
    cap.position.x = 0.072;
    dish.add(barrel, lipM, face, hub, cap);
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.x = (i / 5) * Math.PI * 2;
      const sp = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.145, 0.045, 2, 0.008), alloy);
      sp.position.set(0.052, 0.10, 0);
      pivot.add(sp);
      dish.add(pivot);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6).rotateZ(Math.PI / 2), chrome);
      const a = (i / 5) * Math.PI * 2 + 0.3;
      nut.position.set(0.07, Math.cos(a) * 0.04, Math.sin(a) * 0.04);
      dish.add(nut);
    }
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 32).rotateZ(Math.PI / 2), disc);
    rotor.position.x = -0.04;
    dish.add(rotor);
    g.add(dish);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.022, 8, 40).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    ring.name = 'ring';
    g.add(ring);
    return g;
  });

  return { group, wheels };
}
