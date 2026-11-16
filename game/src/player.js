// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// as a box against the map colliders one axis at a time, so a wall never
// swallows the player. The returned object is both the state and the API:
// `player.position` works, and so does `player.state.position`.
import * as THREE from 'three';

const HALF = 0.35;
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.2;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const SPRINT_SPEED = 6.8;
const ACCEL = 40;
const FRICTION = 9;
const GRAVITY = -16;
const JUMP_SPEED = 5.6;

export function createPlayer(colliders) {
  // Normalise colliders to plain {min:{x,y,z}, max:{x,y,z}} numbers, whether
  // they arrived as plain objects (map.js) or THREE.Box3 instances.
  const boxes = (colliders || []).map((c) => ({
    min: { x: c.min.x, y: c.min.y, z: c.min.z },
    max: { x: c.max.x, y: c.max.y, z: c.max.z },
  }));

  const player = {
    position: new THREE.Vector3(0, 0, 13),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    health: 100,
    alive: true,
    crouched: false,
    onGround: true,
  };
  // Back-compat aliases: some callers expect .velocity / .height / .state.
  player.velocity = player.vel;
  player.height = STAND_HEIGHT;
  player.state = player;

  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height) {
    const minX = x - HALF;
    const maxX = x + HALF;
    const minY = y + 0.02;
    const maxY = y + height - 0.02;
    const minZ = z - HALF;
    const maxZ = z + HALF;
    for (const b of boxes) {
      if (maxX > b.min.x && minX < b.max.x && maxY > b.min.y && minY < b.max.y && maxZ > b.min.z && minZ < b.max.z) {
        return b;
      }
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - dy * sensitivity));
  }

  function recoil(dp, dy) {
    player.pitch = Math.min(1.55, player.pitch + dp);
    player.yaw += dy;
  }

  function step(dt, keys, opts) {
    if (!player.alive) return;
    const sprint = !!(opts && opts.sprint);
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !player.crouched) {
      player.crouched = true;
      player.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && player.crouched && !overlaps(player.position.x, player.position.y, player.position.z, STAND_HEIGHT)) {
      player.crouched = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouched ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouched ? CROUCH_SPEED : sprint && forward > 0 ? SPRINT_SPEED : WALK_SPEED;
    const blend = Math.min(1, (ACCEL * dt) / speed);
    player.vel.x += (wish.x * speed - player.vel.x) * blend;
    player.vel.z += (wish.z * speed - player.vel.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.vel.x *= damp;
      player.vel.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.vel.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.vel.y += GRAVITY * dt;
    if (player.vel.y < -30) player.vel.y = -30;

    const h = player.height;
    const nextX = player.position.x + player.vel.x * dt;
    if (!overlaps(nextX, player.position.y, player.position.z, h)) player.position.x = nextX;
    else player.vel.x = 0;
    const nextZ = player.position.z + player.vel.z * dt;
    if (!overlaps(player.position.x, player.position.y, nextZ, h)) player.position.z = nextZ;
    else player.vel.z = 0;

    player.position.y += player.vel.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, h);
    if (hit && player.vel.y <= 0) {
      player.position.y = hit.max.y;
      player.vel.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - h;
      player.vel.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.vel.y = 0;
      player.onGround = true;
    }
    // Stay inside the yard even if a collider is missing somewhere.
    player.position.x = Math.max(-21.5, Math.min(21.5, player.position.x));
    player.position.z = Math.max(-15.5, Math.min(15.5, player.position.z));
  }

  function groundSpeed() {
    return Math.hypot(player.vel.x, player.vel.z);
  }

  function damage(amount) {
    if (!player.alive) return false;
    player.health -= amount;
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      return true;
    }
    return false;
  }

  function heal(n) {
    if (!player.alive) return;
    player.health = Math.min(100, player.health + n);
  }

  function reset(pos, yaw) {
    player.position.set(pos.x, pos.y || 0, pos.z);
    player.vel.set(0, 0, 0);
    player.yaw = yaw || 0;
    player.pitch = 0;
    player.eye = STAND_EYE;
    player.health = 100;
    player.alive = true;
    player.crouched = false;
    player.height = STAND_HEIGHT;
    player.onGround = true;
  }

  player.step = step;
  player.look = look;
  player.recoil = recoil;
  player.groundSpeed = groundSpeed;
  player.damage = damage;
  player.heal = heal;
  player.reset = reset;
  return player;
}
