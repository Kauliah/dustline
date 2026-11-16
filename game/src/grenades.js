// Dustline — grenades: thrown arc, 3 s fuse, radius damage, explosion flash.
// Written fresh in-session for threejs-fps-01.
import * as THREE from 'three';

const GRAVITY = -12;
const FUSE = 3;
const GROUND_Y = 0.1;
const BOUND_X = 21.5;
const BOUND_Z = 15.5;

const _v = new THREE.Vector3();

export function createGrenades({ scene, state, audio, damageTargets }) {
  // Shared geometry/material — one per grenade mesh would waste memory.
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d24, roughness: 0.6, metalness: 0.5 });
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false });
  const boomLight = new THREE.PointLight(0xffa040, 0, 18);
  scene.add(boomLight);

  const live = [];   // { mesh, vel: Vector3, fuse }
  const booms = [];  // { mesh, age }

  const sys = {
    count: 0,

    throwFrom(pos, dir, power) {
      if (sys.count <= 0) return;
      sys.count -= 1;
      const p = Math.min(1, Math.max(0.5, power));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);
      _v.copy(dir).multiplyScalar(14 + 8 * p);
      _v.y += 4;
      live.push({ mesh, vel: _v.clone(), fuse: FUSE });
      if (audio) audio.ui();
    },

    step(dt) {
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const g = live[i];
        g.fuse -= dt;
        g.vel.y += GRAVITY * dt;
        g.mesh.position.addScaledVector(g.vel, dt);
        const p = g.mesh.position;
        if (p.y < GROUND_Y) {
          p.y = GROUND_Y;
          g.vel.y = -g.vel.y * 0.4;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
        if (p.x > BOUND_X) { p.x = BOUND_X; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
        else if (p.x < -BOUND_X) { p.x = -BOUND_X; g.vel.x = Math.abs(g.vel.x) * 0.4; }
        if (p.z > BOUND_Z) { p.z = BOUND_Z; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
        else if (p.z < -BOUND_Z) { p.z = -BOUND_Z; g.vel.z = Math.abs(g.vel.z) * 0.4; }
        if (g.fuse <= 0) {
          live.splice(i, 1);
          scene.remove(g.mesh);
          const boom = new THREE.Mesh(flashGeo, flashMat.clone());
          boom.position.copy(p);
          boom.scale.setScalar(0.5);
          scene.add(boom);
          booms.push({ mesh: boom, age: 0 });
          boomLight.position.copy(p);
          boomLight.intensity = 60;
          if (audio) audio.explosion();
          if (damageTargets) damageTargets(p, 8, 120);
        }
      }
      for (let i = booms.length - 1; i >= 0; i -= 1) {
        const b = booms[i];
        b.age += dt;
        const t = b.age / 0.35;
        if (t >= 1) {
          scene.remove(b.mesh);
          b.mesh.material.dispose();
          booms.splice(i, 1);
        } else {
          b.mesh.scale.setScalar(0.5 + t * 7.5);
          b.mesh.material.opacity = 0.9 * (1 - t);
        }
      }
      if (boomLight.intensity > 0) boomLight.intensity = Math.max(0, boomLight.intensity - dt * 220);
    },
  };
  return sys;
}
