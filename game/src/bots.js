// bots.js — Dustline bot AI: 9 bot, state machine patrol/engage/hold/plant/defuse/retreat.
// Dipakai main.js via createBotManager(...). Angka damage bot dari './weapons.js'.
// Bot menembak player lewat damagePlayer(); killfeed lewat opts.onKill().
import * as THREE from 'three';
import { botWeaponDamage } from './weapons.js';
import { losClear as mapLosClear } from './map.js';

const EMBER_NAMES = ['Raka', 'Sinta', 'Bara', 'Dara'];
const AZURE_NAMES = ['Vex', 'Mira', 'Kato', 'Juno', 'Iris'];
const TEAM_COLOR = { ember: 0xff7a1a, azure: 0x2f9df0 };
const DETECT_RANGE = 40;
const FOV_COS = 0.6428; // cos(50 deg), FOV 100 derajat
const EYE = 1.5;

const bodyGeo = new THREE.CylinderGeometry(0.3, 0.36, 0.9, 10);
const headGeo = new THREE.SphereGeometry(0.22, 12, 10);
const legGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.5, 8);
const gunGeo = new THREE.BoxGeometry(0.09, 0.13, 0.6);
const stripeGeo = new THREE.BoxGeometry(0.46, 0.09, 0.03);

const _eye = new THREE.Vector3();
const _tEye = new THREE.Vector3();
const _d = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function dmgOf(w) {
  // weapons.js: botWeaponDamage(kind) -> { damage, headDamage } (bukan angka).
  let v;
  if (typeof botWeaponDamage === 'function') v = botWeaponDamage(w);
  else if (botWeaponDamage && typeof botWeaponDamage === 'object') v = botWeaponDamage[w];
  if (v && typeof v === 'object') return v.damage ?? 34;
  return typeof v === 'number' ? v : 34;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
function toVec(v, fallback) {
  if (!v) return fallback ? fallback.clone() : new THREE.Vector3();
  if (v.isVector3) return v.clone();
  if (typeof v.x === 'number' && typeof v.z === 'number') return new THREE.Vector3(v.x, v.y || 0, v.z);
  if (Array.isArray(v)) return new THREE.Vector3(v[0] || 0, v[1] || 0, v[2] || 0);
  return fallback ? fallback.clone() : new THREE.Vector3();
}

export function createBotManager(opts) {
  const scene = opts.scene;
  const map = opts.map || {};
  const state = opts.state || {};
  const audio = opts.audio || null;
  const damagePlayer = typeof opts.damagePlayer === 'function' ? opts.damagePlayer : () => {};
  const getPlayerState = typeof opts.getPlayerState === 'function'
    ? opts.getPlayerState
    : () => ({ pos: new THREE.Vector3(), alive: false, crouched: false, speed: 0 });
  const onKill = typeof opts.onKill === 'function' ? opts.onKill : null;
  const shootablesFn = typeof opts.shootablesFn === 'function' ? opts.shootablesFn : null;

  if (!state.spike) state.spike = { status: 'idle', site: null, progress: 0, timer: 0 };
  if (state.spikeCarrier === undefined) state.spikeCarrier = 'player';

  // ---- map data, dinormalisasi defensif (bentuk persis milik map.js) ----
  // colliders/bounds dulu: normalizeWaypoints memakai blocked() (hoisted, tapi
  // butuh colliders yang sudah terisi — const di bawah ini harus di atas).
  const colliders = Array.isArray(map.colliders) ? map.colliders : [];
  const bounds = map.bounds || { minX: -22, maxX: 22, minZ: -16, maxZ: 16 };
  let mapShootables = Array.isArray(map.shootables) ? map.shootables : [];

  const spawns = {
    ember: (((map.spawns || {}).ember || []).map((v) => toVec(v, new THREE.Vector3(-2, 0, 12)))),
    azure: (((map.spawns || {}).azure || []).map((v) => toVec(v, new THREE.Vector3(2, 0, -12)))),
  };
  if (!spawns.ember.length) spawns.ember = [new THREE.Vector3(-4, 0, 12), new THREE.Vector3(-1, 0, 13), new THREE.Vector3(1, 0, 13), new THREE.Vector3(4, 0, 12)];
  if (!spawns.azure.length) spawns.azure = [new THREE.Vector3(-6, 0, -12), new THREE.Vector3(-2, 0, -13), new THREE.Vector3(2, 0, -13), new THREE.Vector3(6, 0, -12), new THREE.Vector3(0, 0, -11)];

  // map.js: sites = { A: { center: Vector3, radius }, B: {...} }.
  const sites = {
    A: sitePos('A', new THREE.Vector3(-16, 0, -11)),
    B: sitePos('B', new THREE.Vector3(16, 0, -11)),
  };
  const midPos = new THREE.Vector3(0, 0, 4);
  function sitePos(name, fallback) {
    const src = (map.sites && map.sites[name]) || (map.sitePositions && map.sitePositions[name])
      || (map.sites && map.sites[name.toLowerCase()]);
    if (src) return toVec(src.center || src.pos || src, fallback);
    return fallback.clone();
  }
  // Titik plant/defuse: tengah site A ada di DALAM silo (collider), jadi bot
  // berdiri 3.2 m ke selatan (arah mid) — masih di dalam ring site (r 4.5).
  function plantPos(site) {
    const c = sites[site] || sites.A;
    const p = freePoint(c.x, c.z + 3.2);
    return new THREE.Vector3(p.x, 0, p.z);
  }
  function freePoint(x, z) {
    if (!blocked(x, z, 0.4)) return { x, z };
    for (let r = 1; r <= 4; r++) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const nx = x + Math.cos(ang) * r; const nz = z + Math.sin(ang) * r;
        if (!blocked(nx, nz, 0.4)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }

  const waypoints = normalizeWaypoints(map.waypoints);
  function normalizeWaypoints(raw) {
    const list = [];
    if (Array.isArray(raw)) {
      for (const n of raw) {
        const pos = toVec(n.pos || n.position || n, new THREE.Vector3());
        const links = n.links || n.neighbors || n.next || [];
        list.push({ pos, links: Array.isArray(links) ? links.slice() : [] });
      }
    }
    if (list.length < 4) {
      // Fallback: graf sederhana dari spawn/site/mid bila map tak menyediakan waypoint.
      const eS = spawns.ember; const aS = spawns.azure;
      const pts = [
        eS[0], eS[eS.length - 1], new THREE.Vector3(-10, 0, 6), new THREE.Vector3(10, 0, 6),
        new THREE.Vector3(0, 0, 4), new THREE.Vector3(-12, 0, -4), new THREE.Vector3(12, 0, -4),
        sites.A, sites.B, aS[0], aS[aS.length - 1],
      ];
      for (let i = 0; i < pts.length; i++) list.push({ pos: pts[i].clone(), links: [] });
      for (let i = 0; i < pts.length; i++) {
        const near = pts.map((p, j) => ({ j, d: p.distanceTo(pts[i]) }))
          .filter((o) => o.j !== i).sort((a, b) => a.d - b.d).slice(0, 3).map((o) => o.j);
        list[i].links = near;
      }
    }
    // Node yang jatuh di dalam collider (mis. waypoint site A di dalam silo)
    // digeser ke titik bebas terdekat, kalau tidak bot akan macet di depannya.
    for (const n of list) {
      const p = freePoint(n.pos.x, n.pos.z);
      n.pos.set(p.x, 0, p.z);
    }
    return list;
  }

  function blocked(x, z, r) {
    if (x < bounds.minX + r || x > bounds.maxX - r || z < bounds.minZ + r || z > bounds.maxZ - r) return true;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      let minX, maxX, minZ, maxZ;
      if (c.min && c.max) { // THREE.Box3
        if (c.max.y < 0.4) continue; // lantai / benda rendah: bisa dilewati
        minX = c.min.x; maxX = c.max.x; minZ = c.min.z; maxZ = c.max.z;
      } else if (typeof c.minX === 'number') {
        minX = c.minX; maxX = c.maxX; minZ = c.minZ; maxZ = c.maxZ;
      } else if (typeof c.x === 'number') {
        minX = c.x - (c.halfX ?? c.hw ?? 0.5); maxX = c.x + (c.halfX ?? c.hw ?? 0.5);
        minZ = c.z - (c.halfZ ?? c.hd ?? 0.5); maxZ = c.z + (c.halfZ ?? c.hd ?? 0.5);
      } else continue;
      if (x > minX - r && x < maxX + r && z > minZ - r && z < maxZ + r) return true;
    }
    return false;
  }

  function losClear(a, b) {
    // map.js mengekspor losClear(a, b, shootables) sebagai fungsi standalone.
    const list = shootablesFn ? shootablesFn() : mapShootables;
    if (typeof mapLosClear === 'function') {
      try {
        const r = mapLosClear(a, b, list);
        if (typeof r === 'boolean') return r;
      } catch (e) { /* jatuh ke bawah */ }
    }
    if (map && typeof map.losClear === 'function') {
      try {
        const r = map.losClear(a, b, list);
        if (typeof r === 'boolean') return r;
      } catch (e) { /* jatuh ke raycast lokal */ }
    }
    _d.subVectors(b, a);
    const dist = _d.length();
    if (dist < 0.01) return true;
    _ray.set(a, _d.normalize());
    _ray.far = dist;
    return _ray.intersectObjects(list, false).length === 0;
  }

  function laneTarget(lane) {
    return lane === 'A' ? sites.A : lane === 'B' ? sites.B : midPos;
  }
  function nearestWaypoint(p) {
    let best = 0; let bd = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      const d = waypoints[i].pos.distanceToSquared(p);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function nextWaypoint(bot) {
    const node = waypoints[bot.waypointIdx];
    const target = bot.laneTarget;
    const links = (node && node.links.length ? node.links : null);
    const cands = links || waypoints.map((_, i) => i).filter((i) => i !== bot.waypointIdx);
    let best = cands[0]; let bd = Infinity;
    for (const i of cands) {
      const d = waypoints[i].pos.distanceToSquared(target);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  const mgr = {
    bots: [],
    shootables: [],
    time: 0,
    spawnRound, step, aliveCount, reset, damageBot, allBots,
    getShootables, hearShot, setPlanter, setDefuser,
    // main.js memanggil ini bila ada: daftar shootables map untuk LOS.
    registerShootables(list) { if (Array.isArray(list)) mapShootables = list; },
  };

  function makeBot(team, name, id, spawnPos, weapon, lane, baseMode) {
    const color = TEAM_COLOR[team];
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x2b2b28, roughness: 0.85 });
    const teamMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.3 });
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';

    const body = new THREE.Mesh(bodyGeo, torsoMat);
    body.position.y = 0.95;
    body.userData = { kind: 'bot', part: 'body' };
    const stripe = new THREE.Mesh(stripeGeo, teamMat);
    stripe.position.set(0, 1.15, 0.33);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.62;
    head.userData = { kind: 'bot', part: 'head' };
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), teamMat);
    helm.position.y = 1.66;
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.26, 1.05, 0.3);
    const legL = new THREE.Mesh(legGeo, torsoMat);
    legL.position.set(-0.14, 0.25, 0);
    const legR = new THREE.Mesh(legGeo, torsoMat);
    legR.position.set(0.14, 0.25, 0);
    group.add(body, stripe, head, helm, gun, legL, legR);
    group.traverse((m) => { if (m.isMesh) m.castShadow = true; });

    const target = laneTarget(lane);
    const bot = {
      id, team, name, alive: true, health: 100,
      pos: spawnPos.clone(), yaw: Math.atan2(target.x - spawnPos.x, target.z - spawnPos.z),
      group, headMesh: head, bodyMesh: body,
      weapon, mode: baseMode, baseMode, lane, laneTarget: target,
      waypointIdx: nearestWaypoint(spawnPos), speed: 3.2,
      reactionAt: 0, burstLeft: 0, lastShotAt: 0,
      target: null, loseT: 0, detectT: Math.random() * 0.15,
      pauseIn: 4 + Math.random() * 3, idleT: 0, scanT: Math.random() * 6,
      baseYaw: Math.atan2(target.x - spawnPos.x, target.z - spawnPos.z),
      channelT: 0, plantSite: null, retreatUntil: 0, deathT: 0,
      burstPause: 0, strafeDir: 1, strafeT: 0,
      investigateUntil: 0, investigatePos: new THREE.Vector3(),
      spawnPos: spawnPos.clone(),
      path: null, pathIdx: 0, pathTx: 0, pathTz: 0,
      _mats: [torsoMat, teamMat, skinMat, gunMat],
      damage,
    };
    head.userData.bot = bot;
    body.userData.bot = bot;
    group.position.copy(spawnPos);
    group.rotation.y = bot.yaw;
    scene.add(group);
    mgr.bots.push(bot);
    mgr.shootables.push(head, body);
    return bot;

    function damage(amount, killerName, killerTeam, headshot) {
      if (!bot.alive) return { killed: false };
      bot.health -= amount;
      if (bot.mode === 'plant' || bot.mode === 'defuse') cancelChannel(bot);
      if (bot.health <= 0) {
        bot.health = 0;
        bot.alive = false;
        bot.mode = 'dead';
        bot.deathT = 0;
        bot.target = null;
        bot.group.rotation.z = (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.5;
        bot.group.position.y = 0.2;
        for (const m of bot._mats) m.transparent = true;
        removeShootables(bot);
        if (state.spikeCarrier === bot.id) state.spikeCarrier = 'player';
        // onKill hanya untuk killer bernama (bot-vs-bot). weapons.js/grenades
        // memanggil damage(dmg, Vector3) — itu tembakan/ledakan player, dan
        // main.js sudah menampilkan killfeed-nya sendiri; jangan ganda.
        if (typeof killerName === 'string' && killerName && onKill) {
          try { onKill(killerName, bot.name, !!headshot, killerTeam || null); } catch (e) { /* abaikan */ }
        }
        return { killed: true };
      }
      if (bot.health < 30 && bot.mode !== 'retreat' && bot.mode !== 'plant' && bot.mode !== 'defuse') {
        bot.mode = 'retreat';
        bot.retreatUntil = mgr.time + 3;
        bot.target = null;
      }
      return { killed: false };
    }
  }

  function cancelChannel(bot) {
    const sp = state.spike;
    if (!sp) return;
    if (bot.mode === 'plant' && sp.status === 'planting' && sp.planter === bot.id) {
      sp.status = 'idle'; sp.progress = 0; sp.site = null; sp.planter = null;
    }
    if (bot.mode === 'defuse' && sp.status === 'defusing' && sp.defuser === bot.id) {
      sp.status = 'planted'; sp.progress = 1; sp.defuser = null;
    }
    bot.channelT = 0;
    bot.mode = bot.baseMode;
  }

  function removeShootables(bot) {
    const s = mgr.shootables;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === bot.headMesh || s[i] === bot.bodyMesh) s.splice(i, 1);
    }
  }

  function spawnRound() {
    reset();
    const round = state.round || 1;
    const rifle = round >= 2;
    const emberLanes = ['A', 'A', 'mid', 'B'];
    const azureLanes = ['A', 'A', 'B', 'B', 'mid'];
    for (let i = 0; i < 4; i++) {
      const w = rifle && i < 3 ? 'rifle' : 'pistol';
      makeBot('ember', EMBER_NAMES[i], 'e' + i, spawns.ember[i % spawns.ember.length], w, emberLanes[i], 'patrol');
    }
    for (let i = 0; i < 5; i++) {
      const w = rifle && i < 3 ? 'rifle' : 'pistol';
      makeBot('azure', AZURE_NAMES[i], 'a' + i, spawns.azure[i % spawns.azure.length], w, azureLanes[i], 'hold');
    }
  }

  function reset() {
    for (const bot of mgr.bots) scene.remove(bot.group);
    mgr.bots.length = 0;
    mgr.shootables.length = 0;
  }

  function aliveCount(team) {
    let n = 0;
    for (const b of mgr.bots) if (b.alive && b.team === team) n++;
    return n;
  }
  function allBots() { return mgr.bots; }
  function getShootables() { return mgr.shootables; }
  function damageBot(bot, amount) {
    const b = typeof bot === 'string' ? mgr.bots.find((x) => x.id === bot) : bot;
    if (!b || typeof b.damage !== 'function') return { killed: false };
    return b.damage(amount);
  }

  function setPlanter(bot, site) {
    const b = typeof bot === 'string' ? mgr.bots.find((x) => x.id === bot) : bot;
    if (!b || !b.alive || b.team !== 'ember') return false;
    b.mode = 'plant';
    b.plantSite = site || 'A';
    b.channelT = 0;
    b.target = null;
    return true;
  }
  function setDefuser(bot) {
    const b = typeof bot === 'string' ? mgr.bots.find((x) => x.id === bot) : bot;
    if (!b || !b.alive || b.team !== 'azure') return false;
    b.mode = 'defuse';
    b.channelT = 0;
    return true;
  }

  function hearShot(pos) {
    if (!pos) return;
    for (const bot of mgr.bots) {
      if (!bot.alive || bot.mode !== 'patrol') continue;
      const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
      if (d < 25) {
        bot.investigateUntil = mgr.time + 3;
        bot.investigatePos.set(pos.x, 0, pos.z);
      }
    }
  }

  // player.js: posisi di .position (bukan .pos), kecepatan via .groundSpeed().
  function playerPosOf(ps) { return (ps && (ps.pos || ps.position)) || null; }
  function playerSpeedOf(ps) {
    if (!ps) return 0;
    if (typeof ps.speed === 'number') return ps.speed;
    if (typeof ps.groundSpeed === 'function') { try { return ps.groundSpeed(); } catch (e) { return 0; } }
    return 0;
  }
  function targetAlive(t) {
    if (!t) return false;
    if (t.kind === 'player') { try { return !!getPlayerState().alive; } catch (e) { return false; } }
    return !!t.ref.alive;
  }
  function targetPos(t, out) {
    if (t.kind === 'player') {
      try { const ps = getPlayerState(); const p = playerPosOf(ps); if (p) return out.copy(p); } catch (e) { /* abaikan */ }
      return out.copy(t.pos);
    }
    return out.copy(t.ref.pos);
  }

  function detect(bot) {
    _eye.copy(bot.pos); _eye.y += EYE;
    let best = null; let bestD = DETECT_RANGE;
    const consider = (pos, speed, kind, ref, crouched) => {
      _d.copy(pos).sub(bot.pos); _d.y = 0;
      const dist = _d.length();
      if (dist > DETECT_RANGE || dist < 0.01 || dist >= bestD) return;
      const diff = Math.abs(wrapAngle(Math.atan2(_d.x, _d.z) - bot.yaw));
      if (diff > 0.8727) return; // di luar FOV 100 derajat
      _tEye.copy(pos); _tEye.y += crouched ? 1.0 : EYE;
      if (!losClear(_eye, _tEye)) return;
      bestD = dist;
      best = { kind, ref, pos, speed };
    };
    if (bot.team === 'azure') {
      let ps = null;
      try { ps = getPlayerState(); } catch (e) { ps = null; }
      const pPos = playerPosOf(ps);
      if (ps && ps.alive && pPos) consider(pPos, playerSpeedOf(ps), 'player', ps, !!ps.crouched);
      for (const o of mgr.bots) if (o.team === 'ember' && o.alive) consider(o.pos, 0, 'bot', o, false);
    } else {
      for (const o of mgr.bots) if (o.team === 'azure' && o.alive) consider(o.pos, 0, 'bot', o, false);
    }
    if (best) {
      if (!bot.target) bot.reactionAt = mgr.time + 0.35 + Math.random() * 0.25;
      bot.target = best;
      bot.loseT = 0;
      if (mgr.time >= bot.reactionAt && (bot.mode === 'patrol' || bot.mode === 'hold' || bot.mode === 'retreat')) {
        bot.mode = 'engage';
      }
    } else if (bot.target) {
      bot.loseT += 0.15;
      if (bot.loseT > 2) {
        bot.target = null;
        bot.reactionAt = 0;
        if (bot.mode === 'engage') bot.mode = bot.baseMode;
      }
    }
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.pos.x; const dz = tz - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const vx = dx / d; const vz = dz / d;
    const len = speed * dt;
    let mx = bot.pos.x; let mz = bot.pos.z;
    if (!blocked(bot.pos.x + vx * len, bot.pos.z, 0.4)) mx = bot.pos.x + vx * len;
    if (!blocked(bot.pos.x, bot.pos.z + vz * len, 0.4)) mz = bot.pos.z + vz * len;
    if (mx === bot.pos.x && mz === bot.pos.z) {
      const px = -vz; const pz = vx;
      if (!blocked(bot.pos.x + px * len, bot.pos.z + pz * len, 0.4)) { mx = bot.pos.x + px * len; mz = bot.pos.z + pz * len; }
      else if (!blocked(bot.pos.x - px * len, bot.pos.z - pz * len, 0.4)) { mx = bot.pos.x - px * len; mz = bot.pos.z - pz * len; }
      else return false;
    }
    bot.pos.x = mx; bot.pos.z = mz;
    bot.group.position.x = mx; bot.group.position.z = mz;
    bot.yaw = lerpAngle(bot.yaw, Math.atan2(vx, vz), Math.min(1, dt * 8));
    bot.group.rotation.y = bot.yaw;
    return d < 0.6;
  }

  // Navigasi via graf waypoint (garis antar-node sudah bersih dari collider
  // menurut map.js). Jalan lurus hanya untuk leg terakhir (<1.2 m) — jalan
  // lurus jarak jauh macet di muka AABB (mis. silo site A).
  function bfsPath(fromIdx, toIdx) {
    if (fromIdx === toIdx) return [fromIdx];
    const prev = new Array(waypoints.length).fill(-1);
    const q = [fromIdx];
    prev[fromIdx] = fromIdx;
    while (q.length) {
      const cur = q.shift();
      for (const nb of waypoints[cur].links) {
        if (prev[nb] !== -1) continue;
        prev[nb] = cur;
        if (nb === toIdx) {
          const path = [nb];
          let c = cur;
          while (c !== fromIdx) { path.unshift(c); c = prev[c]; }
          path.unshift(fromIdx);
          return path;
        }
        q.push(nb);
      }
    }
    return [fromIdx, toIdx];
  }
  function gotoPoint(bot, tx, tz, dt, speed) {
    const dist = Math.hypot(tx - bot.pos.x, tz - bot.pos.z);
    if (dist < 1.2) { moveToward(bot, tx, tz, dt, speed); return dist < 0.6; }
    // Recompute path HANYA bila target berpindah jauh. Bila path habis,
    // jalan lurus ke target (final leg) — recompute tiap frame di sini dulu
    // membuat bot osilasi maju-mundur di node terakhir.
    if (!bot.path || Math.hypot(tx - bot.pathTx, tz - bot.pathTz) > 2) {
      const from = nearestWaypoint(bot.pos);
      const to = nearestWaypoint(_tv.set(tx, 0, tz));
      bot.path = bfsPath(from, to);
      bot.pathIdx = 0;
      bot.pathTx = tx;
      bot.pathTz = tz;
    }
    while (bot.pathIdx < bot.path.length) {
      const node = waypoints[bot.path[bot.pathIdx]];
      if (!node) break;
      if (Math.hypot(node.pos.x - bot.pos.x, node.pos.z - bot.pos.z) < 0.7) bot.pathIdx++;
      else break;
    }
    if (bot.pathIdx >= bot.path.length) {
      moveToward(bot, tx, tz, dt, speed);
      return false;
    }
    const node = waypoints[bot.path[bot.pathIdx]];
    moveToward(bot, node.pos.x, node.pos.z, dt, speed);
    return false;
  }

  function fireAt(bot, t, dt, dist) {
    if (bot.burstLeft <= 0) {
      bot.burstPause -= dt;
      if (bot.burstPause > 0) return;
      bot.burstLeft = 3 + ((Math.random() * 3) | 0);
      bot.burstPause = 0.45 + Math.random() * 0.4;
    }
    const gap = bot.weapon === 'rifle' ? 0.11 : 0.2;
    if (mgr.time - bot.lastShotAt < gap) return;
    bot.lastShotAt = mgr.time;
    bot.burstLeft--;
    const tp = targetPos(t, _tEye); // _tEye dipakai ulang sebagai posisi target
    _eye.copy(bot.pos); _eye.y += EYE;
    _tEye.y += t.kind === 'player' && t.ref.crouched ? 1.0 : EYE;
    if (!losClear(_eye, _tEye)) { bot.burstLeft = 0; return; }
    try { if (audio && typeof audio.shot === 'function') audio.shot(bot.weapon); } catch (e) { /* abaikan */ }
    const tSpeed = t.kind === 'player'
      ? (t.ref.speed || 0)
      : (t.ref.mode === 'patrol' || t.ref.mode === 'retreat' ? 3.2 : 0);
    let chance = 0.45 - Math.max(0, dist - 5) * (0.27 / 25);
    chance = clamp(chance, 0.18, 0.45) * (1 - Math.min(0.3, tSpeed * 0.04));
    if (Math.random() >= chance) return;
    const dmg = dmgOf(bot.weapon);
    if (t.kind === 'player') {
      try { damagePlayer(dmg, bot.pos); } catch (e) { /* abaikan */ }
    } else {
      t.ref.damage(dmg, bot.name, bot.team, false);
    }
  }

  function stepBot(bot, dt) {
    if (bot.mode === 'patrol') {
      if (bot.investigateUntil > mgr.time) {
        if (moveToward(bot, bot.investigatePos.x, bot.investigatePos.z, dt, bot.speed)) bot.investigateUntil = 0;
        return;
      }
      bot.pauseIn -= dt;
      if (bot.idleT > 0) {
        bot.idleT -= dt;
        bot.yaw += dt * 0.6;
        bot.group.rotation.y = bot.yaw;
        return;
      }
      if (bot.pauseIn <= 0) { bot.idleT = 1; bot.pauseIn = 4 + Math.random() * 3; return; }
      const node = waypoints[bot.waypointIdx];
      if (!node) return;
      if (moveToward(bot, node.pos.x, node.pos.z, dt, bot.speed)) bot.waypointIdx = nextWaypoint(bot);
      return;
    }
    if (bot.mode === 'hold') {
      bot.scanT += dt;
      bot.yaw = bot.baseYaw + Math.sin(bot.scanT * 0.5) * 0.5;
      bot.group.rotation.y = bot.yaw;
      if (bot.target && targetAlive(bot.target) && mgr.time >= bot.reactionAt) {
        const tp = targetPos(bot.target, _tEye);
        const dist = Math.hypot(tp.x - bot.pos.x, tp.z - bot.pos.z);
        bot.yaw = lerpAngle(bot.yaw, Math.atan2(tp.x - bot.pos.x, tp.z - bot.pos.z), Math.min(1, dt * 10));
        bot.group.rotation.y = bot.yaw;
        fireAt(bot, bot.target, dt, dist);
      }
      return;
    }
    if (bot.mode === 'engage') {
      const t = bot.target;
      if (!t || !targetAlive(t)) { bot.target = null; bot.mode = bot.baseMode; return; }
      const tp = targetPos(t, _tEye);
      const dx = tp.x - bot.pos.x; const dz = tp.z - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > DETECT_RANGE) { bot.target = null; bot.mode = bot.baseMode; return; }
      bot.yaw = lerpAngle(bot.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
      bot.group.rotation.y = bot.yaw;
      if (dist > 25) {
        gotoPoint(bot, tp.x, tp.z, dt, bot.speed);
      } else {
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7; }
        const px = -dz / (dist || 1); const pz = dx / (dist || 1);
        const nx = bot.pos.x + px * bot.strafeDir * bot.speed * 0.5 * dt;
        const nz = bot.pos.z + pz * bot.strafeDir * bot.speed * 0.5 * dt;
        if (!blocked(nx, nz, 0.4)) {
          bot.pos.x = nx; bot.pos.z = nz;
          bot.group.position.x = nx; bot.group.position.z = nz;
        }
      }
      if (mgr.time >= bot.reactionAt) fireAt(bot, t, dt, dist);
      return;
    }
    if (bot.mode === 'plant') {
      const sp = plantPos(bot.plantSite || 'A');
      if (!gotoPoint(bot, sp.x, sp.z, dt, bot.speed)) return;
      if (bot.target && targetAlive(bot.target) && mgr.time >= bot.reactionAt) {
        const tp = targetPos(bot.target, _tEye);
        fireAt(bot, bot.target, dt, Math.hypot(tp.x - bot.pos.x, tp.z - bot.pos.z));
      }
      bot.channelT += dt;
      state.spike.status = 'planting';
      state.spike.site = bot.plantSite;
      state.spike.progress = Math.min(1, bot.channelT / 4);
      state.spike.planter = bot.id;
      if (bot.channelT >= 4) {
        state.spike.status = 'planted';
        state.spike.progress = 1;
        state.spike.timer = 12;
        bot.channelT = 0;
        bot.mode = 'hold';
        bot.baseMode = 'hold';
        bot.baseYaw = bot.yaw;
      }
      return;
    }
    if (bot.mode === 'defuse') {
      const site = state.spike.site || 'A';
      const sp = plantPos(site);
      if (!gotoPoint(bot, sp.x, sp.z, dt, bot.speed)) return;
      if (bot.target && targetAlive(bot.target) && mgr.time >= bot.reactionAt) {
        const tp = targetPos(bot.target, _tEye);
        fireAt(bot, bot.target, dt, Math.hypot(tp.x - bot.pos.x, tp.z - bot.pos.z));
      }
      bot.channelT += dt;
      state.spike.status = 'defusing';
      state.spike.progress = Math.min(1, bot.channelT / 5);
      state.spike.defuser = bot.id;
      if (bot.channelT >= 5) {
        state.spike.status = 'defused';
        state.spike.progress = 1;
        bot.channelT = 0;
        bot.mode = 'hold';
        bot.baseMode = 'hold';
      }
      return;
    }
    if (bot.mode === 'retreat') {
      const arrived = gotoPoint(bot, bot.spawnPos.x, bot.spawnPos.z, dt, bot.speed);
      if (arrived || mgr.time > bot.retreatUntil) bot.mode = bot.baseMode;
      return;
    }
  }

  function autoDefuse() {
    const sp = state.spike;
    if (!sp || sp.status !== 'planted') return;
    for (const b of mgr.bots) if (b.alive && b.mode === 'defuse') return;
    let best = null; let bd = Infinity;
    const site = sites[sp.site || 'A'];
    for (const b of mgr.bots) {
      if (!b.alive || b.team !== 'azure' || b.target) continue;
      const d = Math.hypot(b.pos.x - site.x, b.pos.z - site.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) setDefuser(best);
  }

  function step(dt) {
    mgr.time += dt;
    for (const bot of mgr.bots) {
      if (!bot.alive) {
        bot.deathT += dt;
        if (bot.deathT > 3) {
          const o = Math.max(0, 1 - (bot.deathT - 3));
          for (const m of bot._mats) m.opacity = o;
          if (o <= 0) bot.group.visible = false;
        }
        continue;
      }
      bot.detectT -= dt;
      if (bot.detectT <= 0) { bot.detectT = 0.15; detect(bot); }
      // Sinkron visual dari state logis: tahan terhadap penulisan posisi
      // dari luar (mis. main.js placeBotNear di mode ?shot= yang menyetel
      // bodyMesh/headMesh langsung) agar grup & mesh tetap sejajar.
      bot.group.position.set(bot.pos.x, 0, bot.pos.z);
      bot.group.rotation.y = bot.yaw;
      bot.bodyMesh.position.set(0, 0.95, 0);
      bot.headMesh.position.set(0, 1.62, 0);
      stepBot(bot, dt);
    }
    autoDefuse();
  }

  return mgr;
}
