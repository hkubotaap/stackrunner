// Visual model of the Subaru Impreza Sports Wagon (GG, 2.0 AWD): 4415 x 1695 x 1470 mm, wheelbase 2525, 195/60R15.
// Face modelled after the 2002-2005 "teardrop" (涙目) cars; the design details are from memory, not from a source.
// Car-local axes: +Z forward, +Y up, origin = centre of mass (ground is 0.52 m below it). See cars.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 1.695;
const HALF = W / 2;
const GROUND = -0.52;
const FLOOR = GROUND + 0.15; // 150 mm ground clearance (assumed)
const ARCH_R = 0.37;
const ARCH_Y = GROUND + 0.3075; // wheel centre at rest
const AXLE_F = 1.06;
const AXLE_R = -1.465;

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 330; c.height = 165;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4ee'; // white plate (普通車)
  g.fillRect(0, 0, 330, 165);
  g.strokeStyle = '#1b5e3a'; g.lineWidth = 6; g.strokeRect(8, 8, 314, 149);
  g.fillStyle = '#1b5e3a'; g.textAlign = 'center';
  g.font = 'bold 34px "Yu Gothic UI", "Meiryo", sans-serif';
  g.fillText('品川 300', 165, 52);
  g.font = 'bold 74px "Arial Narrow", Arial, sans-serif';
  g.fillText('す 12-34', 165, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildImpreza(envMap, wheelDefs) {
  const group = new THREE.Group();
  const mat = (o) => new THREE.MeshPhysicalMaterial({ envMap, envMapIntensity: 1, ...o });
  const paint = mat({ color: 0xd2d6da, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9 }); // silver
  const glass = mat({ color: 0x0b141c, metalness: 0.9, roughness: 0.08, envMapIntensity: 0.7 });
  const black = mat({ color: 0x0e1014, roughness: 0.55, metalness: 0.1 });
  const trim = mat({ color: 0x1b1e23, roughness: 0.75 });
  const chrome = mat({ color: 0xe9eef2, metalness: 1, roughness: 0.1 });
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
  sh.moveTo(-2.455, -0.14);
  sh.lineTo(-2.40, FLOOR);
  sh.lineTo(AXLE_R - ch, FLOOR);
  sh.absarc(AXLE_R, ARCH_Y, ARCH_R, a0, a1, true);
  sh.lineTo(AXLE_F - ch, FLOOR);
  sh.absarc(AXLE_F, ARCH_Y, ARCH_R, a0, a1, true);
  sh.lineTo(1.90, FLOOR);
  sh.lineTo(1.96, -0.22);
  sh.lineTo(1.98, 0.02); // bumper face
  sh.lineTo(1.90, 0.18); // hood nose
  sh.lineTo(0.45, 0.40); // cowl
  sh.lineTo(-0.12, 0.95); // windshield header
  sh.lineTo(-2.0, 0.95); // roof
  sh.lineTo(-2.05, 0.93);
  sh.lineTo(-2.36, 0.52); // rear window
  sh.lineTo(-2.43, 0.10); // tailgate
  sh.lineTo(-2.455, -0.05);
  sh.closePath();
  const bevel = 0.055;
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
    add(sideGlass([[0.40, 0.45], [-0.04, 0.86], [-0.55, 0.86], [-0.55, 0.45]], s)); // front door
    add(sideGlass([[-0.65, 0.45], [-0.65, 0.86], [-1.55, 0.86], [-1.55, 0.45]], s)); // rear door
    add(sideGlass([[-1.62, 0.45], [-1.62, 0.86], [-1.98, 0.86], [-2.20, 0.45]], s)); // quarter
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
  quad([-0.10, 0.93], [0.43, 0.42], 0.68, 0.004, glass); // windshield (top, bottom)
  quad([-2.07, 0.91], [-2.34, 0.56], 0.62, 0.004, glass, true); // rear glass
  for (const [x0, x1] of [[0.6, 0.0], [0.0, -0.6]]) { // wipers
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.008, 0.012), black);
    w.position.set((x0 + x1) / 2, 0.41, 0.46);
    w.rotation.set(-0.7, 0.12 * Math.sign(x0 + x1 || 1), 0);
    add(w);
  }

  // ---------------------------------------------------------------- doors, handles, mirrors, mouldings, roof rails
  for (const s of [1, -1]) {
    for (const z of [0.50, -0.60, -1.60]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.95, 0.006), lineMat);
      l.position.set(s * (HALF + 0.001), -0.02, z);
      add(l);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.008, AXLE_F - AXLE_R - 2 * ARCH_R - 0.1), lineMat);
    sill.position.set(s * (HALF + 0.001), -0.33, (AXLE_F + AXLE_R) / 2);
    add(sill);
    for (const z of [-0.05, -1.05]) {
      const hd = new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.03, 0.13, 2, 0.01), paint);
      hd.position.set(s * (HALF + 0.005), 0.40, z);
      add(hd);
    }
    // body side protector: only between the wheel arches (never across them)
    const mz0 = AXLE_R + ARCH_R + 0.06;
    const mz1 = AXLE_F - ARCH_R - 0.06;
    const moulding = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.07, mz1 - mz0, 2, 0.006), trim);
    moulding.position.set(s * (HALF + 0.003), -0.04, (mz0 + mz1) / 2);
    add(moulding);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.05), black);
    arm.position.set(s * (HALF + 0.055), 0.45, 0.36);
    const mir = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.11, 0.2, 3, 0.04), paint);
    mir.position.set(s * (HALF + 0.14), 0.50, 0.30);
    const mf = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.006), glass);
    mf.position.set(s * (HALF + 0.14), 0.50, 0.30 - 0.103);
    add(arm); add(mir); add(mf);
    // roof rails
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.03, 1.75, 2, 0.01), mat({ color: 0xb9bec4, metalness: 0.9, roughness: 0.3 }));
    rail.position.set(s * 0.62, 0.975, -1.05);
    add(rail);
    for (const z of [-0.35, -1.75]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), black);
      foot.position.set(s * 0.62, 0.955, z);
      add(foot);
    }
  }

  // ---------------------------------------------------------------- front end (teardrop headlamps, small grille, big lower intake)
  const FZ = 1.975;
  const grille = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.085, 0.04, 2, 0.015), black);
  grille.position.set(0, 0.075, FZ - 0.02);
  const gframe = new THREE.Mesh(new RoundedBoxGeometry(0.60, 0.105, 0.03, 2, 0.015), chrome);
  gframe.position.set(0, 0.075, FZ - 0.03);
  add(gframe); add(grille);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 24).rotateX(Math.PI / 2).scale(1.4, 1, 1), mat({ color: 0x1f4fa8, metalness: 0.5, roughness: 0.3 }));
  badge.position.set(0, 0.075, FZ + 0.002);
  add(badge);
  const teardrop = new THREE.Shape([[-0.25, -0.05], [-0.25, 0.035], [0.08, 0.085], [0.25, 0.08], [0.265, -0.01], [0.19, -0.075], [-0.2, -0.085]].map(([x, y]) => new THREE.Vector2(x, y)));
  for (const s of [1, -1]) {
    const hlGeo = new THREE.ExtrudeGeometry(teardrop, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
    const housing = new THREE.Mesh(hlGeo, black);
    housing.position.set(s * 0.56, 0.115, FZ - 0.045);
    housing.scale.x = s;
    const lensM = new THREE.Mesh(hlGeo.clone(), lens);
    lensM.position.set(s * 0.56, 0.115, FZ - 0.02);
    lensM.scale.set(s * 0.96, 0.93, 0.7);
    const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20).rotateX(Math.PI / 2), led);
    proj.position.set(s * 0.50, 0.115, FZ + 0.012);
    const turn = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.012), amber);
    turn.position.set(s * 0.74, 0.085, FZ + 0.005);
    add(housing); add(lensM); add(proj); add(turn);
    const fog = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.02, 20).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff0c0, emissiveIntensity: 0.45 }));
    fog.position.set(s * 0.66, -0.20, FZ - 0.01);
    const fogRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.008, 6, 20), chrome);
    fogRing.position.copy(fog.position); fogRing.position.z += 0.01;
    const intake = new THREE.Mesh(new RoundedBoxGeometry(0.40, 0.13, 0.05, 2, 0.02), black);
    intake.position.set(s * 0.36, -0.13, FZ - 0.02);
    add(fog); add(fogRing); add(intake);
  }
  const fPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }));
  fPlate.position.set(0, -0.12, FZ + 0.005);
  add(fPlate);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.05, 0.1, 2, 0.02), black);
  lip.position.set(0, -0.30, 1.93);
  add(lip);

  // ---------------------------------------------------------------- rear end
  const RZ = -2.468;
  for (const s of [1, -1]) {
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.34, 0.05, 3, 0.02), red);
    tail.position.set(s * 0.70, 0.30, RZ + 0.015);
    tail.rotation.y = -s * 0.1;
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.3 }));
    rev.position.set(s * 0.52, 0.10, RZ + 0.005);
    add(tail); add(rev);
  }
  const rBump = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.14, 0.08, 2, 0.03), black);
  rBump.position.set(0, -0.14, -2.44);
  add(rBump);
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.165), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }));
  rPlate.rotation.y = Math.PI;
  rPlate.position.set(0, 0.08, RZ - 0.004);
  add(rPlate);
  const spoiler = new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.03, 0.17, 2, 0.012), paint); // roof-end spoiler (Sports)
  spoiler.position.set(0, 0.945, -2.10);
  spoiler.rotation.x = 0.18;
  add(spoiler);
  const stop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.02), red);
  stop.position.set(0, 0.915, -2.13);
  add(stop);
  const rEmblem = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.045, 0.012, 2, 0.006), chrome);
  rEmblem.position.set(0, 0.28, RZ);
  add(rEmblem);

  // ---------------------------------------------------------------- wheel wells
  for (const z of [AXLE_F, AXLE_R]) {
    const fill = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.5, 0.76), black);
    fill.position.set(0, -0.12, z);
    add(fill);
    for (const s of [1, -1]) {
      const liner = new THREE.Mesh(
        new THREE.CylinderGeometry(ARCH_R - 0.006, ARCH_R - 0.006, 0.3, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 1, side: THREE.DoubleSide }),
      );
      liner.position.set(s * 0.70, ARCH_Y, z);
      add(liner);
      const flare = new THREE.Mesh(new THREE.TorusGeometry(ARCH_R + 0.05, 0.013, 6, 40, Math.PI + 0.7).rotateZ(-0.35).rotateY(Math.PI / 2), trim);
      flare.position.set(s * (HALF + 0.004), ARCH_Y, z);
      add(flare);
    }
  }
  const under = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.04, 4.2), black);
  under.position.set(0, FLOOR - 0.01, -0.25);
  add(under);

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ---------------------------------------------------------------- wheels: 15" alloy, 195/60R15
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.92 });
  const alloy = mat({ color: 0xc4c9ce, metalness: 1, roughness: 0.2 });
  const alloyDark = mat({ color: 0x2b2f35, metalness: 0.8, roughness: 0.4 });
  const disc = new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.8, roughness: 0.45 });
  const tireProfile = [
    [0.188, -0.0925], [0.215, -0.0975], [0.265, -0.09], [0.295, -0.068], [0.3055, -0.035], [0.3075, -0.008],
    [0.303, -0.003], [0.3075, 0.002], [0.303, 0.007], [0.3075, 0.012], [0.3055, 0.035], [0.295, 0.068],
    [0.265, 0.09], [0.215, 0.0975], [0.188, 0.0925],
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
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.16, 32, 1, true).rotateZ(Math.PI / 2), alloyDark.clone());
    barrel.material.side = THREE.DoubleSide;
    const lipM = new THREE.Mesh(new THREE.TorusGeometry(0.188, 0.011, 8, 40).rotateY(Math.PI / 2), alloy);
    lipM.position.x = 0.085;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 32).rotateZ(Math.PI / 2), alloyDark);
    face.position.x = 0.045;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 20).rotateZ(Math.PI / 2), alloy);
    hub.position.x = 0.06;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.014, 16).rotateZ(Math.PI / 2), chrome);
    cap.position.x = 0.078;
    dish.add(barrel, lipM, face, hub, cap);
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.x = (i / 5) * Math.PI * 2;
      const sp = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.15, 0.045, 2, 0.008), alloy);
      sp.position.set(0.057, 0.105, 0);
      pivot.add(sp);
      dish.add(pivot);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6).rotateZ(Math.PI / 2), chrome);
      const a = (i / 5) * Math.PI * 2 + 0.3;
      nut.position.set(0.075, Math.cos(a) * 0.04, Math.sin(a) * 0.04);
      dish.add(nut);
    }
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 32).rotateZ(Math.PI / 2), disc);
    rotor.position.x = -0.04;
    dish.add(rotor);
    g.add(dish);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.022, 8, 40).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    ring.name = 'ring';
    g.add(ring);
    return g;
  });

  return { group, wheels };
}
