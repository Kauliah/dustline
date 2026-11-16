// Dustline boot: renderer, systems, fixed 60 Hz simulation loop, and the
// deterministic ?shot= capture modes. The simulation lives in the fixed step;
// rendering only reads state, never writes it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, resetForRound, resetMatch } from './state.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { WEAPONS, createWeaponSystem } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';
import { createBotManager } from './bots.js';
import { createRoundManager } from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.sky, 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const S = createState();
S.seed = seed;
const map = createMap(scene);
const player = createPlayer(map.colliders);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

const _camDir = new THREE.Vector3();
const _aim = new THREE.Vector3();

// Shootables for hitscan: map geometry plus every bot's body and head.
function getShootables() {
  const list = map.shootables.slice();
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    if (bot.bodyMesh) list.push(bot.bodyMesh);
    if (bot.headMesh) list.push(bot.headMesh);
  }
  return list;
}

const weapons = createWeaponSystem({
  camera,
  scene,
  audio,
  state: S,
  getShootables,
});
if (weapons.viewModel && !weapons.viewModel.parent) camera.add(weapons.viewModel);

function damageTargets(pos, radius, maxDmg) {
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.pos.distanceTo(pos);
    if (d > radius) continue;
    // Full damage inside half the radius, falling to ~1/6 at the edge.
    const dmg = d <= radius / 2 ? maxDmg : Math.max(10, Math.round(maxDmg * (1 - ((d - radius / 2) / (radius / 2)) * 0.83)));
    let killed = false;
    if (typeof bot.damage === 'function') {
      const res = bot.damage(dmg, pos);
      killed = !!(res && res.killed);
    } else {
      bot.health -= dmg;
      if (bot.health <= 0) {
        bot.health = 0;
        bot.alive = false;
        killed = true;
      }
    }
    if (killed) {
      S.kills += 1;
      S.money += 300;
      hud.addKillfeed(`You ▸ ${bot.name || 'bot'}`, false);
    }
  }
  const pd = player.position.distanceTo(pos);
  if (player.alive && pd <= radius) {
    const dmg = pd <= radius / 2 ? maxDmg : Math.max(10, Math.round(maxDmg * (1 - ((pd - radius / 2) / (radius / 2)) * 0.83)));
    if (player.damage(dmg)) {
      S.deaths += 1;
      hud.damageFlash(0);
    }
  }
}

const grenades = createGrenades({ scene, state: S, audio, damageTargets });

const bots = createBotManager({
  scene,
  map,
  state: S,
  audio,
  damagePlayer(amount, fromPos) {
    if (!player.alive) return;
    if (fromPos) {
      const dx = fromPos.x - player.position.x;
      const dz = fromPos.z - player.position.z;
      const angle = Math.atan2(dx, dz) - player.yaw;
      hud.damageFlash(angle);
    }
    if (player.damage(amount)) S.deaths += 1;
  },
  getPlayerState() {
    return player;
  },
  weapons,
  onKill(killer, victim, headshot) {
    hud.addKillfeed(`${killer} ▸ ${victim}`, !!headshot);
  },
});
if (typeof bots.registerShootables === 'function') bots.registerShootables(map.shootables);

const rounds = createRoundManager({
  state: S,
  bots,
  weapons,
  grenades,
  hud,
  audio,
  player,
  map,
  onPlayerRespawn() {
    const spawn = map.spawns.ember[0];
    player.reset(spawn, 0);
  },
});

function buildBuyItems() {
  const items = [];
  const push = (key, def) => {
    items.push({
      key,
      name: (def && def.name) || key,
      price: (def && def.price) || 0,
      damage: (def && def.body) || (def && def.damage) || 0,
      desc: (def && def.desc) || '',
    });
  };
  if (Array.isArray(WEAPONS)) WEAPONS.forEach((def, i) => push(def.key || def.name || String(i), def));
  else if (WEAPONS) for (const key of Object.keys(WEAPONS)) push(key, WEAPONS[key]);
  items.push({ key: 'grenade', name: 'Frag Grenade', price: 300, damage: 120, desc: 'Thrown explosive, 4 m lethal radius' });
  return items;
}

function aimAt(point) {
  _aim.copy(point).sub(player.position);
  _aim.y -= player.eye;
  const len = _aim.length() || 1;
  player.yaw = Math.atan2(-_aim.x, -_aim.z);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, _aim.y / len)));
  syncCamera();
}

function syncCamera() {
  camera.position.set(player.position.x, player.position.y + player.eye, player.position.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

function syncHud() {
  hud.setHealth(player.health);
  hud.setAmmo(weapons.mag, weapons.reserve, weapons.current);
  hud.setMoney(S.money);
  hud.setTimer(S.phase === 'buy' ? Math.ceil(S.buyTime) : Math.ceil(S.roundTime));
  hud.setScore(S.score.ember, S.score.azure);
  hud.setRound(S.round);
  hud.setGrenades(grenades.count);
  hud.setSpike(S.spike.status, S.spike.site, S.spike.progress);
  const spread = 4 + player.groundSpeed() * 2.2 + (input.state.aiming ? -2 : 0);
  hud.setCrosshairSpread(Math.max(2, spread));
  hud.setPhase(S.phase);
}

function tryFire() {
  const now = performance.now();
  if (!weapons.canFire(now)) return;
  // weapons.fire owns the accounting (state.shots/hits/kills/money) and the
  // shot/hit/kill sounds; main only mirrors the result into the HUD.
  const result = weapons.fire(now, player.groundSpeed(), player.crouched);
  if (!result) return;
  if (result.hit) hud.hitmarker(!!result.killed, shot ? 4000 : 90);
  if (result.killed) {
    const name = (result.target && result.target.name) || 'bot';
    hud.addKillfeed(`You ▸ ${name}`, !!result.headshot);
  }
  syncHudAmmoOnly();
}

function syncHudAmmoOnly() {
  hud.setAmmo(weapons.mag, weapons.reserve, weapons.current);
}

function throwGrenade() {
  if (grenades.count <= 0) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(_camDir);
  grenades.throwFrom(camera.position, _camDir, 1);
  if (typeof weapons.setGrenades === 'function') weapons.setGrenades(grenades.count);
  hud.setGrenades(grenades.count);
}

let buyOpen = false;
function buyByKey(key) {
  const items = buildBuyItems();
  const item = items.find((it) => it.key === key);
  if (!item) return;
  if (item.key === 'grenade') {
    if (S.money >= 300 && grenades.count < 2) {
      S.money -= 300;
      grenades.count += 1;
      if (typeof weapons.setGrenades === 'function') weapons.setGrenades(grenades.count);
      hud.showBuy(buildBuyItems(), S.money, Math.ceil(S.buyTime));
    }
  } else if (weapons.buy(item.key)) {
    hud.showBuy(buildBuyItems(), S.money, Math.ceil(S.buyTime));
  }
}
hud.onBuy = (key) => { if (S.phase === 'buy') buyByKey(key); };
function toggleBuy() {
  if (S.phase !== 'buy') return;
  buyOpen = !buyOpen;
  if (buyOpen) hud.showBuy(buildBuyItems(), S.money, Math.ceil(S.buyTime));
  else hud.hideBuy();
}

const prevKeys = new Set();
function edgePressed(code) {
  return input.state.keys.has(code) && !prevKeys.has(code);
}

function handleKeys() {
  const keys = input.state.keys;
  if (edgePressed('KeyR')) weapons.reload();
  if (edgePressed('KeyM')) {
    S.muted = !S.muted;
    audio.setMuted(S.muted);
  }
  if (edgePressed('KeyB')) toggleBuy();
  if (buyOpen && S.phase === 'buy') {
    const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    buyKeys.forEach((code, i) => {
      if (!edgePressed(code)) return;
      const items = buildBuyItems();
      const item = items[i];
      if (!item) return;
      buyByKey(item.key);
    });
  }
  if (input.consumeGrenade()) throwGrenade();
  prevKeys.clear();
  for (const k of keys) prevKeys.add(k);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    audio.ensure();
    hud.hideOverlay();
    if (S.phase === 'menu') rounds.startMatch();
  } else if (S.phase === 'live' || S.phase === 'buy') {
    hud.showOverlay('paused');
  }
}

document.getElementById('play').addEventListener('click', () => {
  audio.ensure();
  if (S.phase === 'matchEnd') {
    resetMatch(S);
    rounds.startMatch();
    input.requestLock();
    return;
  }
  input.requestLock();
});
document.getElementById('buy-close').addEventListener('click', () => {
  buyOpen = false;
  hud.hideBuy();
});
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });

function stepSim(dt) {
  player.step(dt, input.state.keys, { sprint: input.state.keys.has('ShiftLeft') || input.state.keys.has('ShiftRight') });
  weapons.step(dt, input.state.keys);
  grenades.step(dt);
  bots.step(dt);
  rounds.step(dt, input);
  map.update(dt);
}

let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let fovCurrent = 74;

function frame(now) {
  if (frozen) return;
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const look = input.takeLook();
  player.look(look.x, look.y);
  if (input.state.firing && !buyOpen) tryFire();
  handleKeys();
  rounds.playerPlanting = input.state.keys.has('KeyE');
  rounds.playerDefusing = input.state.keys.has('KeyE');

  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    stepSim(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;

  const cur = String(weapons.current || '').toLowerCase();
  const isSniper = cur.includes('sniper') || cur.includes('railspike');
  const targetFov = input.state.aiming && isSniper ? 32 : 74;
  fovCurrent += (targetFov - fovCurrent) * Math.min(1, dt * 10);
  if (Math.abs(fovCurrent - camera.fov) > 0.05) {
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }

  syncCamera();
  syncHud();
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) stepSim(FIXED_STEP);
}

// weapons.reload runs on the wall clock, while settle() runs synchronously,
// so a reload only completes after real time passes. Capture mode only.
function waitReload() {
  const until = performance.now() + 3000;
  while (weapons.reloading && performance.now() < until) {
    weapons.step(0);
  }
  weapons.step(0);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function placeBotNear(bot, x, z) {
  bot.pos.set(x, 0, z);
  if (bot.bodyMesh) bot.bodyMesh.position.set(x, 0, z);
  if (bot.headMesh) bot.headMesh.position.set(x, 1.5, z);
}

function ensureBots() {
  if (bots.aliveCount('azure') === 0) bots.spawnRound();
}

function runShot(name) {
  hud.hideOverlay();
  if (typeof hud.hideBuy === 'function') hud.hideBuy();
  player.pitch = 0;
  player.yaw = 0;

  if (name === 'start') {
    player.reset(new THREE.Vector3(0.6, 0, 8.6), 0);
    settle(20);
    aimAt(new THREE.Vector3(-16, 1.5, -11));
    hud.showOverlay('start');
  } else if (name === 'play') {
    resetMatch(S);
    rounds.startMatch();
    rounds.startRound();
    ensureBots();
    // Jalur x=3 bersih dari truk mid (x -1.1..1.1) dan kontainer — garis tembak bebas.
    player.reset(new THREE.Vector3(3, 0, 5), 0);
    const enemy = bots.bots.find((b) => b.team === 'azure' && b.alive);
    if (enemy) {
      placeBotNear(enemy, 3, -5);
      enemy.mode = 'hold';
    }
    settle(10);
    // Headshots first (pistol head = 100), then body shots until one kill
    // lands, so the kill feed shows exactly one entry. weapons.fire owns
    // state accounting and sounds; main only mirrors results to the HUD.
    let killed = false;
    for (let i = 0; i < 3 && !killed; i += 1) {
      if (enemy) aimAt(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.5, enemy.pos.z));
      const now = performance.now() + i * 600;
      if (weapons.canFire(now)) {
        const r = weapons.fire(now, 0, false);
        if (r && r.hit) {
          hud.hitmarker(!!r.killed, 4000);
          if (r.killed) {
            killed = true;
            hud.addKillfeed(`You ▸ ${enemy ? enemy.name || 'bot' : 'bot'}`, !!r.headshot);
          }
        }
      }
      settle(8);
    }
    for (let i = 0; i < 10 && !killed; i += 1) {
      if (enemy) aimAt(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.1, enemy.pos.z));
      const now = performance.now() + 2000 + i * 600;
      if (weapons.canFire(now)) {
        const r = weapons.fire(now, 0, false);
        if (r && r.hit) {
          hud.hitmarker(!!r.killed, 4000);
          if (r.killed) {
            killed = true;
            hud.addKillfeed(`You ▸ ${enemy ? enemy.name || 'bot' : 'bot'}`, false);
          }
        }
      }
      if (weapons.mag === 0) {
        weapons.reload();
        waitReload();
      }
      settle(8);
    }
    if (enemy) aimAt(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.3, enemy.pos.z));
    settle(2);
    // Bersihkan banner "RONDE 1" dari startMatch agar tidak menutupi musuh.
    hud.banner('', '', 1);
    // Tampilkan HUD ronde berjalan, bukan timer buy.
    S.phase = 'live';
    S.roundTime = 100;
  } else if (name === 'buy') {
    resetForRound(S);
    S.phase = 'buy';
    S.buyTime = 12;
    player.reset(new THREE.Vector3(0.6, 0, 8.6), 0);
    settle(10);
    aimAt(new THREE.Vector3(-16, 1.5, -11));
    buyOpen = true;
    hud.showBuy(buildBuyItems(), S.money, 12);
    hud.setBuyTime(12);
  } else if (name === 'site') {
    resetMatch(S);
    rounds.startMatch();
    rounds.startRound();
    ensureBots();
    S.phase = 'live';
    S.spike = { status: 'planted', site: 'B', progress: 1, timer: 12 };
    map.showSpike(map.sites.B.center);
    player.reset(new THREE.Vector3(8, 0, 2), 0);
    const enemy = bots.bots.find((b) => b.team === 'azure' && b.alive);
    if (enemy) placeBotNear(enemy, 13, -8);
    settle(10);
    aimAt(new THREE.Vector3(16, 1.5, -11));
    hud.setSpike('planted', 'B', 1);
    hud.banner('SPIKE PLANTED', 'Defend site B — detonation in 12s', 4000);
  }

  syncHud();
  if (shot) {
    window.__shotDebug = {
      mode: name, kills: S.kills, deaths: S.deaths, money: S.money,
      shots: S.shots, hits: S.hits, headshots: S.headshots,
      phase: S.phase, roundTime: S.roundTime,
      player: { x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), health: player.health, alive: player.alive },
      bots: bots.bots.map((b) => ({ id: b.id, team: b.team, alive: b.alive, health: b.health, x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), mode: b.mode })),
      spike: S.spike,
    };
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
