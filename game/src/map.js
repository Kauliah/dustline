// Kestrel Yard: a sun-baked freight depot, 44 x 32 m, bright daylight.
// North is -Z. Site A (Silo) sits north-west, site B (Crane) north-east,
// Ember spawns south, Azure spawns north, and a broken truck guards mid.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

export function losClear(a, b, shootables) {
  _from.copy(a);
  _dir.copy(b).sub(a);
  const dist = _dir.length();
  if (dist < 0.001) return true;
  _dir.multiplyScalar(1 / dist);
  _ray.set(_from, _dir);
  _ray.far = dist;
  return _ray.intersectObjects(shootables, false).length === 0;
}

export function createMap(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 30, 85);

  const sun = new THREE.DirectionalLight(0xffe3b3, 2.4);
  sun.position.set(18, 32, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PALETTE.sky, PALETTE.ground, 1.1));

  const colliders = [];
  const shootables = [];

  const matGround = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 });
  const matSand = new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 });
  const matConcrete = new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 });
  const matRust = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.85 });
  const matSteel = new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.6, metalness: 0.35 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0xa9804e, roughness: 1 });
  const matContainerA = new THREE.MeshStandardMaterial({ color: 0x7a8c5a, roughness: 0.8 });
  const matContainerB = new THREE.MeshStandardMaterial({ color: 0x9c5a3c, roughness: 0.8 });
  const matDark = new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.9 });

  function addBox(cx, cy, cz, sx, sy, sz, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (solid) {
      colliders.push({
        min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
        max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 },
      });
      shootables.push(mesh);
    }
    return mesh;
  }

  function addCylinder(cx, cy, cz, r, h, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (solid) {
      colliders.push({
        min: { x: cx - r, y: cy - h / 2, z: cz - r },
        max: { x: cx + r, y: cy + h / 2, z: cz + r },
      });
      shootables.push(mesh);
    }
    return mesh;
  }

  // --- Ground (not a collider; the player floor is y = 0) ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 32), matGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  shootables.push(ground);
  // Worn sand patches for a lived-in yard.
  for (const [px, pz, w, d] of [[-10, 4, 10, 6], [9, -4, 8, 5], [0, 10, 12, 4], [-14, -4, 6, 5]]) {
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, d), matSand);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(px, 0.02, pz);
    patch.receiveShadow = true;
    scene.add(patch);
  }

  // --- Perimeter walls, height 3 ---
  addBox(0, 1.5, -16.3, 44.6, 3, 0.6, matConcrete); // north
  addBox(0, 1.5, 16.3, 44.6, 3, 0.6, matConcrete); // south
  addBox(-22.3, 1.5, 0, 0.6, 3, 32.6, matConcrete); // west
  addBox(22.3, 1.5, 0, 0.6, 3, 32.6, matConcrete); // east

  // --- Site A: Silo (north-west) ---
  addCylinder(-16, 3.25, -11, 2.2, 6.5, matSteel);
  addCylinder(-16, 6.8, -11, 1.4, 0.7, matRust); // silo cap
  addBox(-12.2, 0.7, -12.5, 1.6, 1.4, 1.6, matCrate); // crates by the silo
  addBox(-12.2, 2.1, -12.5, 1.2, 1.4, 1.2, matCrate);
  addBox(-19.5, 0.55, -7.5, 2.2, 1.1, 1.4, matCrate);

  // --- Site B: Crane (north-east) ---
  addBox(14.6, 2.5, -11, 0.8, 5, 0.8, matSteel); // crane leg
  addBox(17.4, 2.5, -11, 0.8, 5, 0.8, matSteel); // crane leg
  addBox(16, 5.2, -11, 4.4, 0.7, 1.1, matRust); // gantry beam
  addBox(16, 4.6, -11, 1.2, 0.5, 1.4, matDark); // hoist block
  addBox(19.8, 1.2, -13.5, 3.4, 2.4, 1.6, matContainerB); // container by crane
  addBox(12.5, 0.6, -13.8, 1.8, 1.2, 1.2, matCrate);

  // --- Mid: broken truck ---
  addBox(0, 0.9, -1, 2.2, 1.8, 4.6, matRust); // truck bed
  addBox(0, 0.7, -4.2, 2.0, 1.4, 1.6, matSteel); // cab
  addBox(-1.4, 0.35, -1, 0.5, 0.7, 1.2, matDark); // wheel
  addBox(1.4, 0.35, -1, 0.5, 0.7, 1.2, matDark); // wheel

  // --- Alley walls: partial walls make West / East alleys ---
  addBox(-18, 1.4, -3, 0.5, 2.8, 9, matConcrete); // west alley inner wall
  addBox(18, 1.4, -3, 0.5, 2.8, 9, matConcrete); // east alley inner wall
  addBox(-18, 1.4, 9, 0.5, 2.8, 6, matConcrete); // west alley south stub
  addBox(18, 1.4, 9, 0.5, 2.8, 6, matConcrete); // east alley south stub

  // --- Connector wall behind mid (gap at x = 0) ---
  addBox(-4, 1.1, 7, 4, 2.2, 0.5, matConcrete);
  addBox(4, 1.1, 7, 4, 2.2, 0.5, matConcrete);

  // --- Containers and cover ---
  addBox(-9, 1.2, -7, 6, 2.4, 2.4, matContainerA); // mid-west container
  addBox(10, 1.2, 3, 5, 2.4, 2.2, matContainerB); // mid-east container
  addBox(-6, 1.2, 5, 2.6, 2.4, 2.2, matContainerB); // south-west container
  addBox(7, 0.55, -7.5, 2.0, 1.1, 1.4, matCrate); // cover near B entry
  addBox(-7, 0.55, -7.5, 2.0, 1.1, 1.4, matCrate); // cover near A entry
  addBox(-13, 0.55, 2, 1.8, 1.1, 1.8, matCrate); // west cover
  addBox(13, 0.55, -2, 1.8, 1.1, 1.8, matCrate); // east cover
  addBox(0, 0.55, -8.5, 2.4, 1.1, 1.2, matCrate); // mid-north cover
  addBox(-2.5, 0.45, 11, 1.6, 0.9, 1.6, matCrate); // spawn cover
  addBox(2.5, 0.45, -11, 1.6, 0.9, 1.6, matCrate); // spawn cover

  // --- Site markers: flat rings + translucent zone discs ---
  function siteMarker(cx, cz, color) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.6, 4.5, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.03;
    group.add(disc);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
    );
    post.position.y = 1.3;
    group.add(post);
    group.position.set(cx, 0, cz);
    scene.add(group);
    return group;
  }
  const siteMeshes = {
    A: siteMarker(-16, -11, PALETTE.ember),
    B: siteMarker(16, -11, PALETTE.azure),
  };

  // --- Spike device: small box with a blinking light, hidden until planted ---
  const spikeMesh = new THREE.Group();
  const spikeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.28, 0.35),
    new THREE.MeshStandardMaterial({ color: PALETTE.ink, roughness: 0.5, metalness: 0.4 }),
  );
  spikeBody.position.y = 0.14;
  spikeBody.castShadow = true;
  spikeMesh.add(spikeBody);
  const spikeLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 10),
    new THREE.MeshBasicMaterial({ color: PALETTE.ember }),
  );
  spikeLight.position.set(0, 0.34, 0);
  spikeMesh.add(spikeLight);
  spikeMesh.visible = false;
  scene.add(spikeMesh);
  function showSpike(sitePos) {
    spikeMesh.position.set(sitePos.x, 0, sitePos.z);
    spikeMesh.visible = true;
  }
  function hideSpike() {
    spikeMesh.visible = false;
  }

  const sites = {
    A: { center: new THREE.Vector3(-16, 0, -11), radius: 4.5 },
    B: { center: new THREE.Vector3(16, 0, -11), radius: 4.5 },
  };
  const spawns = {
    ember: [
      new THREE.Vector3(-6, 0, 13),
      new THREE.Vector3(-2, 0, 13),
      new THREE.Vector3(2, 0, 13),
      new THREE.Vector3(6, 0, 13),
      new THREE.Vector3(0, 0, 14),
    ],
    azure: [
      new THREE.Vector3(-6, 0, -13),
      new THREE.Vector3(-2, 0, -13),
      new THREE.Vector3(2, 0, -13),
      new THREE.Vector3(6, 0, -13),
      new THREE.Vector3(0, 0, -14),
    ],
  };

  // Waypoints: spawns, lanes, entries, sites, covers. Links are two-way and
  // only join nodes whose straight line stays clear of solid geometry.
  const wp = (x, z) => new THREE.Vector3(x, 0, z);
  const waypoints = [
    { pos: wp(0, 13), links: [1, 2, 13, 14, 15] }, // 0 ember spawn
    { pos: wp(-6, 13), links: [0, 14, 7] }, // 1 ember west
    { pos: wp(6, 13), links: [0, 15, 8] }, // 2 ember east
    { pos: wp(0, -13), links: [4, 5, 16, 9, 11] }, // 3 azure spawn
    { pos: wp(-6, -13), links: [3, 9] }, // 4 azure west
    { pos: wp(6, -13), links: [3, 11] }, // 5 azure east
    { pos: wp(0, 4), links: [13, 16, 7, 8] }, // 6 mid
    { pos: wp(-18, 0), links: [1, 6, 14, 9] }, // 7 west alley
    { pos: wp(18, 0), links: [2, 6, 15, 11] }, // 8 east alley
    { pos: wp(-16, -4), links: [3, 4, 7, 10, 16] }, // 9 entry A
    { pos: wp(-16, -11), links: [9] }, // 10 site A
    { pos: wp(16, -4), links: [3, 5, 8, 12, 16] }, // 11 entry B
    { pos: wp(16, -11), links: [11] }, // 12 site B
    { pos: wp(0, 9), links: [0, 6, 14, 15] }, // 13 connector
    { pos: wp(-18, 9), links: [0, 1, 7, 13] }, // 14 west corner
    { pos: wp(18, 9), links: [0, 2, 8, 13] }, // 15 east corner
    { pos: wp(0, -6), links: [3, 6, 9, 11] }, // 16 mid north
  ];

  return {
    colliders,
    shootables,
    sites,
    spawns,
    waypoints,
    siteMeshes,
    spikeMesh,
    showSpike,
    hideSpike,
    update() {},
  };
}
