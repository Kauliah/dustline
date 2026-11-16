// Dustline — weapons: hitscan fire, spread, reload, view models, tracer.
// Written fresh in-session for threejs-fps-01. No starter code copied.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: { name: 'Sidewinder', price: 0, mag: 12, reserve: 70, damage: 34, headDamage: 100, shotMs: 220, reloadMs: 1200, spreadBase: 0.006, spreadMove: 0.02, recoilPitch: 0.006, recoilYaw: 0.003, auto: false, zoom: 1 },
  smg: { name: 'Hornet', price: 600, mag: 28, reserve: 120, damage: 26, headDamage: 78, shotMs: 80, reloadMs: 1600, spreadBase: 0.012, spreadMove: 0.03, recoilPitch: 0.005, recoilYaw: 0.004, auto: true, zoom: 1 },
  rifle: { name: 'Longshot', price: 1200, mag: 30, reserve: 90, damage: 34, headDamage: 100, shotMs: 100, reloadMs: 1900, spreadBase: 0.008, spreadMove: 0.025, recoilPitch: 0.009, recoilYaw: 0.004, auto: true, zoom: 1 },
  sniper: { name: 'Railspike', price: 2500, mag: 5, reserve: 20, damage: 90, headDamage: 200, shotMs: 1200, reloadMs: 2600, spreadBase: 0.001, spreadMove: 0.04, recoilPitch: 0.03, recoilYaw: 0.008, auto: false, zoom: 2.3 },
};

export function botWeaponDamage(kind) {
  const w = WEAPONS[kind] || WEAPONS.pistol;
  return { damage: w.damage, headDamage: w.headDamage };
}

// Reused temporaries — no per-shot allocation.
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

function buildViewModel(kind) {
  // Distinct low-poly silhouette + colours per weapon. Units in metres,
  // positioned relative to the camera (forward = -z).
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x22201d, roughness: 0.55, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.8, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({
    color: kind === 'pistol' ? 0xff7a1a : kind === 'smg' ? 0x2f9df0 : kind === 'rifle' ? 0xb4552d : 0x3d6b8e,
    roughness: 0.5, metalness: 0.35,
  });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (kind === 'pistol') {
    box(0.05, 0.07, 0.22, dark, 0, 0, -0.1);
    box(0.04, 0.09, 0.05, grip, 0, -0.07, 0.0);
    box(0.05, 0.015, 0.06, accent, 0, 0.04, -0.18);
  } else if (kind === 'smg') {
    box(0.07, 0.09, 0.3, dark, 0, 0, -0.12);
    box(0.04, 0.04, 0.3, accent, 0, 0.02, -0.32);
    box(0.05, 0.12, 0.06, grip, 0, -0.09, 0.02);
    box(0.05, 0.06, 0.08, grip, 0, -0.06, -0.28);
  } else if (kind === 'rifle') {
    box(0.08, 0.1, 0.45, dark, 0, 0, -0.15);
    box(0.04, 0.04, 0.42, accent, 0, 0.03, -0.45);
    box(0.06, 0.1, 0.18, grip, 0, -0.03, 0.14);
    box(0.04, 0.12, 0.05, grip, 0, -0.1, -0.05);
    box(0.03, 0.03, 0.12, dark, 0, 0.07, -0.2);
  } else { // sniper
    box(0.07, 0.09, 0.6, dark, 0, 0, -0.2);
    box(0.035, 0.035, 0.55, accent, 0, 0.03, -0.55);
    box(0.06, 0.05, 0.1, dark, 0, 0.08, -0.25); // scope
    box(0.05, 0.05, 0.06, grip, 0, 0.11, -0.25);
    box(0.06, 0.09, 0.2, grip, 0, -0.03, 0.18);
    box(0.04, 0.1, 0.05, grip, 0, -0.09, -0.05);
  }
  return g;
}

export function createWeaponSystem({ camera, scene, audio, state, getShootables }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 200;

  // Per-weapon ammo so switching back keeps the loaded mag.
  const ammo = {};
  for (const k of Object.keys(WEAPONS)) ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve };

  const viewModel = new THREE.Group();
  viewModel.position.set(0.24, -0.21, -0.45);
  const models = {};
  for (const k of Object.keys(WEAPONS)) {
    models[k] = buildViewModel(k);
    models[k].visible = false;
    viewModel.add(models[k]);
  }
  models.pistol.visible = true;
  camera.add(viewModel);

  // Muzzle flash: bright plane + light, both on the camera.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), flashMat);
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(0xffc861, 0, 6);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);

  // Tracer: one reusable line in the scene, fades in ~60 ms.
  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
  const tracer = new THREE.Line(tracerGeo, tracerMat);
  tracer.frustumCulled = false;
  scene.add(tracer);

  let lastShot = -Infinity;
  let reloadEnd = 0;
  let flashLeft = 0;
  let tracerLeft = 0;
  let kick = 0;

  const sys = {
    current: 'pistol',
    mag: ammo.pistol.mag,
    reserve: ammo.pistol.reserve,
    grenades: 0,
    reloading: false,
    lastRecoil: { pitch: 0, yaw: 0 },
    viewModel,

    select(name) {
      if (!WEAPONS[name] || name === sys.current) return;
      ammo[sys.current] = { mag: sys.mag, reserve: sys.reserve };
      sys.current = name;
      sys.mag = ammo[name].mag;
      sys.reserve = ammo[name].reserve;
      sys.reloading = false;
      for (const k of Object.keys(models)) models[k].visible = k === name;
    },

    buy(name) {
      const w = WEAPONS[name];
      if (!w || state.money < w.price) return false;
      state.money -= w.price;
      ammo[name] = { mag: w.mag, reserve: w.reserve };
      sys.select(name);
      sys.mag = w.mag;
      sys.reserve = w.reserve;
      return true;
    },

    canFire(now) {
      const w = WEAPONS[sys.current];
      return sys.mag > 0 && !sys.reloading && now - lastShot >= w.shotMs;
    },

    spreadNow(moveSpeed, crouched) {
      const w = WEAPONS[sys.current];
      let s = w.spreadBase + w.spreadMove * Math.min(moveSpeed / 5.2, 1);
      if (crouched) s *= 0.6;
      return s;
    },

    muzzleFlash() {
      flashLeft = 0.05;
      flash.visible = true;
      flash.rotation.z = Math.random() * Math.PI;
      flashLight.intensity = 14;
    },

    fire(now, moveSpeed, crouched) {
      const w = WEAPONS[sys.current];
      if (sys.reloading || now - lastShot < w.shotMs) return null;
      if (sys.mag <= 0) {
        if (audio) audio.dryFire();
        return { hit: false, dry: true };
      }
      lastShot = now;
      sys.mag -= 1;
      state.shots = (state.shots || 0) + 1;

      // Matrices must be fresh: in ?shot= capture mode no render has run
      // yet, so the camera and bot meshes still carry stale matrixWorld.
      camera.updateMatrixWorld();
      if (scene) scene.updateMatrixWorld();
      // Spread direction: camera forward perturbed inside a cone.
      camera.getWorldDirection(_dir);
      _right.crossVectors(_dir, _UP).normalize();
      _up.crossVectors(_right, _dir).normalize();
      const spread = sys.spreadNow(moveSpeed, crouched);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();

      camera.getWorldPosition(_origin);
      raycaster.set(_origin, _dir);
      const targets = getShootables ? getShootables() : [];
      const hits = raycaster.intersectObjects(targets, false);
      const end = hits.length > 0 ? hits[0].point : null;

      // Tracer from muzzle to hit point (or 60 m out on a miss).
      _muzzle.set(0.24, -0.17, -0.95);
      camera.localToWorld(_muzzle);
      if (end) _hit.copy(end);
      else _hit.copy(_origin).addScaledVector(_dir, 60);
      tracerPos[0] = _muzzle.x; tracerPos[1] = _muzzle.y; tracerPos[2] = _muzzle.z;
      tracerPos[3] = _hit.x; tracerPos[4] = _hit.y; tracerPos[5] = _hit.z;
      tracerGeo.attributes.position.needsUpdate = true;
      tracerMat.opacity = 0.85;
      tracerLeft = 0.06;

      sys.muzzleFlash();
      kick = 0.05;
      sys.lastRecoil = {
        pitch: w.recoilPitch * (0.8 + Math.random() * 0.4),
        yaw: (Math.random() * 2 - 1) * w.recoilYaw,
      };
      if (audio) audio.shot(sys.current);

      let result = { hit: false, killed: false, headshot: false, target: null };
      if (hits.length > 0) {
        const h = hits[0];
        const ud = h.object.userData || {};
        if (ud.kind === 'bot' && ud.bot) {
          const headshot = ud.part === 'head';
          const dmg = headshot ? w.headDamage : w.damage;
          state.hits = (state.hits || 0) + 1;
          if (headshot) state.headshots = (state.headshots || 0) + 1;
          camera.getWorldPosition(_origin);
          const res = ud.bot.damage(dmg, _origin);
          const killed = !!(res && res.killed);
          result = { hit: true, killed, headshot, target: ud.bot };
          if (killed) {
            state.kills = (state.kills || 0) + 1;
            state.money = (state.money || 0) + 300;
            if (audio) audio.kill();
          } else if (audio) audio.hit();
        } else {
          // World geometry hit: tracer + flash only, counts as a miss.
          result = { hit: false, killed: false, headshot: false, target: null };
        }
      }
      return result;
    },

    reload() {
      const w = WEAPONS[sys.current];
      if (sys.reloading || sys.mag >= w.mag || sys.reserve <= 0) return;
      sys.reloading = true;
      reloadEnd = performance.now() + w.reloadMs;
      if (audio) audio.reload();
    },

    step(dt) {
      if (sys.reloading && performance.now() >= reloadEnd) {
        const w = WEAPONS[sys.current];
        const need = w.mag - sys.mag;
        const take = Math.min(need, sys.reserve);
        sys.mag += take;
        sys.reserve -= take;
        sys.reloading = false;
      }
      if (flashLeft > 0) {
        flashLeft -= dt;
        if (flashLeft <= 0) { flash.visible = false; flashLight.intensity = 0; }
      }
      if (tracerLeft > 0) {
        tracerLeft -= dt;
        tracerMat.opacity = Math.max(0, tracerLeft / 0.06) * 0.85;
      }
      kick += (0 - kick) * Math.min(1, dt * 14);
      viewModel.position.z = -0.45 + kick;
      viewModel.rotation.x = kick * 2.0;
    },

    setGrenades(n) { sys.grenades = n; },
  };
  return sys;
}
