// rounds.js — Dustline: alur match/ronde, ekonomi, plant/defuse, kondisi menang.
// Dipakai main.js via createRoundManager(...). Angka ekonomi sama dengan design:
// kill +$300 (ditambah main/weapons saat kill), menang +$800, kalah +$400, plant +$300,
// ronde 100 dtk, plant 4 dtk, defuse 5 dtk, detonasi 12 dtk, buy 12 dtk, first to 5, max 9.
import { resetMatch, resetForRound } from './state.js';

const BUY_TIME = 12;
const ROUND_TIME = 100;
const PLANT_TIME = 4;
const DEFUSE_TIME = 5;
const DETONATE_TIME = 12;
const END_PAUSE = 4;
const WIN_SCORE = 5;
const MAX_ROUND = 9;
const ECON = { win: 800, lose: 400, plant: 300 };

function keyDown(input, code) {
  // main.js memberi objek input (keys di input.state.keys); smoke test memberi {keys}.
  const k = input && (input.keys || (input.state && input.state.keys));
  if (!k) return false;
  if (typeof k.has === 'function') return k.has(code);
  if (Array.isArray(k)) return k.includes(code);
  return !!k[code];
}

export function createRoundManager(opts) {
  const state = opts.state || {};
  const bots = opts.bots;
  const weapons = opts.weapons || null;
  const grenades = opts.grenades || null;
  const hud = opts.hud || null;
  const audio = opts.audio || null;
  const player = opts.player || null;
  const map = opts.map || {};
  const onPlayerRespawn = typeof opts.onPlayerRespawn === 'function' ? opts.onPlayerRespawn : () => {};

  let endTimer = 0;
  let channelT = 0; // progress plant player (detik)
  let defuseT = 0; // progress defuse player (detik)
  let announcedPlanted = false;
  let lastBeepStep = -1;

  const mgr = {
    playerPlanting: false,
    playerDefusing: false,
    playerSite: null,
    step, startMatch, startRound, endRound, interruptChannel,
  };

  function safeAudio(name, arg) {
    try {
      const fn = audio && audio[name];
      if (typeof fn === 'function') fn.call(audio, arg);
    } catch (e) { /* abaikan */ }
  }
  function ensureSpike() {
    if (!state.spike) state.spike = { status: 'idle', site: null, progress: 0, timer: 0 };
  }
  function playerAlive() {
    if (!player) return true;
    if (player.state) return player.state.alive !== false && (player.state.health ?? 100) > 0;
    return player.alive !== false && (player.health ?? 100) > 0;
  }
  function playerPos() {
    // player.js: posisi di .position (dan .state === player); .pos tidak ada.
    if (!player) return null;
    return (player.state && (player.state.pos || player.state.position))
      || player.pos || player.position || null;
  }
  function getPlayerHealth() {
    if (!player) return 100;
    return (player.state && player.state.health) ?? player.health ?? 100;
  }
  function setPlayerHealth(h) {
    if (!player) return;
    if (player.state) player.state.health = h;
    else player.health = h;
  }
  function siteList() {
    const out = {};
    const src = map.sites || map.sitePositions || {};
    for (const name of ['A', 'B']) {
      const v = src[name] || src[name.toLowerCase()];
      if (v) {
        // map.js: { center: Vector3, radius } — bukan Vector3 langsung.
        const p = v.center || v.pos || v;
        out[name] = { x: p.x ?? 0, z: p.z ?? 0 };
      }
    }
    if (!out.A) out.A = { x: -16, z: -11 };
    if (!out.B) out.B = { x: 16, z: -11 };
    return out;
  }
  function siteNearPlayer() {
    const p = playerPos();
    if (!p) return null;
    const sites = siteList();
    let best = null; let bd = 5; // hanya bila dekat site (radius 5 m)
    for (const name of ['A', 'B']) {
      const d = Math.hypot(p.x - sites[name].x, p.z - sites[name].z);
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  }
  function beepAt(stepIdx) {
    if (stepIdx === lastBeepStep) return;
    lastBeepStep = stepIdx;
    safeAudio('plantBeep', stepIdx / 8);
  }

  function startMatch() {
    try {
      const r = resetMatch(state);
      if (r && typeof r === 'object') Object.assign(state, r);
    } catch (e) { /* state.js mungkin sudah me-reset in-place */ }
    ensureSpike();
    state.score = { ember: 0, azure: 0 };
    state.round = 1;
    state.money = 800;
    state.kills = 0;
    state.shots = 0;
    state.hits = 0;
    state.spikeCarrier = 'player';
    state.matchWinner = null;
    state.roundWinner = null;
    try { bots.reset(); } catch (e) { /* abaikan */ }
    startRound();
  }

  function startRound() {
    try {
      const r = resetForRound(state);
      if (r && typeof r === 'object') Object.assign(state, r);
    } catch (e) { /* abaikan */ }
    ensureSpike();
    const died = !playerAlive();
    state.phase = 'buy';
    state.buyTime = BUY_TIME;
    state.roundTime = ROUND_TIME;
    state.round = state.round || 1;
    state.spike.status = 'idle';
    state.spike.site = null;
    state.spike.progress = 0;
    state.spike.timer = 0;
    state.spike.planter = null;
    state.spike.defuser = null;
    channelT = 0;
    defuseT = 0;
    announcedPlanted = false;
    lastBeepStep = -1;
    mgr.playerPlanting = false;
    mgr.playerDefusing = false;
    mgr.playerSite = null;
    try { onPlayerRespawn(); } catch (e) { /* abaikan */ }
    try { bots.spawnRound(); } catch (e) { /* abaikan */ }
    // Pembawa spike: ronde 1 & ganjil = player; ronde genap = satu bot Ember (ia plant via bots.js).
    if (state.round % 2 === 0) {
      const carrier = bots.bots.find((b) => b.team === 'ember' && b.alive);
      state.spikeCarrier = carrier ? carrier.id : 'player';
    } else {
      state.spikeCarrier = 'player';
    }
    if (died) {
      // Mati ronde lalu: kembali ke pistol + granat 0. Hidup: senjata & uang dipertahankan.
      // weapons.js: select(name) ada; resetToPistol/refill tidak ada — isi mag pistol manual.
      try {
        if (weapons) {
          if (typeof weapons.resetToPistol === 'function') weapons.resetToPistol();
          else if (typeof weapons.select === 'function') weapons.select('pistol');
          else if (typeof weapons.setWeapon === 'function') weapons.setWeapon('pistol');
          else if (typeof weapons.equip === 'function') weapons.equip('pistol');
          if (typeof weapons.refill === 'function') weapons.refill();
          else { weapons.mag = 12; weapons.reserve = 70; }
        }
      } catch (e) { /* abaikan */ }
      // grenades.js tidak punya setGrenades — count adalah propertinya.
      try {
        if (grenades) {
          if (typeof grenades.setGrenades === 'function') grenades.setGrenades(0);
          else if ('count' in grenades) grenades.count = 0;
        }
      } catch (e) { /* abaikan */ }
    }
    if (hud) {
      try { hud.banner('RONDE ' + state.round, 'Beli senjatamu — tekan B', 2500); } catch (e) { /* abaikan */ }
      try { hud.setRound(state.round); } catch (e) { /* abaikan */ }
      try { hud.setScore(state.score.ember, state.score.azure); } catch (e) { /* abaikan */ }
      try { hud.setMoney(state.money); } catch (e) { /* abaikan */ }
      try { hud.setTimer(state.roundTime); } catch (e) { /* abaikan */ }
      try { hud.setSpike('idle', null, 0); } catch (e) { /* abaikan */ }
    }
    safeAudio('roundStart');
  }

  function closeBuy() {
    state.phase = 'live';
    state.roundTime = ROUND_TIME;
    try { if (hud && typeof hud.hideBuy === 'function') hud.hideBuy(); } catch (e) { /* abaikan */ }
    try { if (hud) hud.banner('RONDE DIMULAI', 'Tanam spike atau eliminasi musuh', 1500); } catch (e) { /* abaikan */ }
    // Bila carrier adalah bot Ember, suruh ia plant (site terdekat dari posisinya).
    if (state.spikeCarrier && state.spikeCarrier !== 'player' && bots && typeof bots.setPlanter === 'function') {
      const carrier = bots.bots.find((b) => b.id === state.spikeCarrier && b.alive);
      if (carrier) {
        const sites = siteList();
        const dA = Math.hypot(carrier.pos.x - sites.A.x, carrier.pos.z - sites.A.z);
        const dB = Math.hypot(carrier.pos.x - sites.B.x, carrier.pos.z - sites.B.z);
        try { bots.setPlanter(carrier, dA <= dB ? 'A' : 'B'); } catch (e) { /* abaikan */ }
      }
    }
  }

  function plantSpike(site, planter) {
    const sp = state.spike;
    sp.status = 'planted';
    sp.site = site;
    sp.progress = 1;
    sp.timer = DETONATE_TIME;
    sp.planter = planter;
    channelT = 0;
    announcedPlanted = true;
    if (planter === 'player') state.money = (state.money || 0) + ECON.plant;
    try { if (hud) hud.banner('SPIKE PLANTED', planter === 'player' ? 'Kamu menanam spike — +$300' : 'Spike ditanam — jaga site!', 2500); } catch (e) { /* abaikan */ }
    try { if (hud) hud.setSpike('planted', site, 1); } catch (e) { /* abaikan */ }
    safeAudio('plantBeep', 1);
  }

  function liveStep(dt) {
    const sp = state.spike;
    // Pengumuman sekali saat spike selesai ditanam (oleh siapa pun).
    if (sp.status === 'planted' && !announcedPlanted) {
      announcedPlanted = true;
      try { if (hud) hud.banner('SPIKE PLANTED', 'Azure harus menjinakkan — 12 dtk', 2500); } catch (e) { /* abaikan */ }
    }
    // Bot Azure selesai defuse.
    if (sp.status === 'defused') { endRound('azure', 'Spike dijinakkan'); return; }

    // --- plant oleh player (KeyE ditahan, dekat site, carrier player, spike idle) ---
    const playerPlantingNow = mgr.playerPlanting && state.spikeCarrier === 'player'
      && (sp.status === 'idle' || (sp.status === 'planting' && sp.planter === 'player'));
    if (playerPlantingNow) {
      const site = mgr.playerSite || siteNearPlayer() || sp.site || 'A';
      channelT += dt;
      sp.status = 'planting';
      sp.site = site;
      sp.progress = Math.min(1, channelT / PLANT_TIME);
      sp.planter = 'player';
      try { if (hud) hud.setSpike('planting', site, sp.progress); } catch (e) { /* abaikan */ }
      beepAt(Math.floor(sp.progress * 8));
      if (channelT >= PLANT_TIME) { plantSpike(site, 'player'); return; }
    } else if (sp.status === 'planting' && sp.planter === 'player' && !mgr.playerPlanting) {
      // Player melepas KeyE / menjauh: batalkan plant.
      channelT = 0;
      sp.status = 'idle';
      sp.progress = 0;
      sp.site = null;
      sp.planter = null;
      try { if (hud) hud.setSpike('idle', null, 0); } catch (e) { /* abaikan */ }
    }

    // --- defuse oleh player (spike planted + KeyE dekat site) ---
    const playerDefusingNow = mgr.playerDefusing
      && ((sp.status === 'planted') || (sp.status === 'defusing' && sp.defuser === 'player'));
    if (playerDefusingNow) {
      defuseT += dt;
      sp.status = 'defusing';
      sp.progress = Math.min(1, defuseT / DEFUSE_TIME);
      sp.defuser = 'player';
      try { if (hud) hud.setSpike('defusing', sp.site, sp.progress); } catch (e) { /* abaikan */ }
      beepAt(Math.floor(sp.progress * 8));
      if (defuseT >= DEFUSE_TIME) {
        sp.status = 'defused';
        sp.progress = 1;
        endRound('azure', 'Spike dijinakkan');
        return;
      }
    } else if (sp.status === 'defusing' && sp.defuser === 'player' && !mgr.playerDefusing) {
      defuseT = 0;
      sp.status = 'planted';
      sp.progress = 1;
      sp.defuser = null;
      try { if (hud) hud.setSpike('planted', sp.site, 1); } catch (e) { /* abaikan */ }
    }

    // --- timer ronde / detonasi ---
    if (sp.status === 'planted' || sp.status === 'defusing') {
      // Tampilkan countdown detonasi di HUD utama: main.js menggambar timer
      // dari state.roundTime tiap frame, jadi samakan dengan sisa timer spike.
      state.roundTime = Math.max(0, sp.timer);
      if (sp.status === 'planted') {
        sp.timer -= dt;
        state.roundTime = Math.max(0, sp.timer);
        sp.progress = Math.max(0, sp.timer / DETONATE_TIME);
        try { if (hud) hud.setSpike('planted', sp.site, sp.progress); } catch (e) { /* abaikan */ }
        try { if (hud) hud.setTimer(Math.max(0, Math.ceil(sp.timer))); } catch (e) { /* abaikan */ }
        if (sp.timer <= 0) {
          safeAudio('explosion');
          try { if (hud) hud.damageFlash(0); } catch (e) { /* abaikan */ }
          endRound('ember', 'Spike meledak');
          return;
        }
      }
    } else {
      state.roundTime -= dt;
      try { if (hud) hud.setTimer(Math.max(0, Math.ceil(state.roundTime))); } catch (e) { /* abaikan */ }
      if (state.roundTime <= 0) {
        endRound('azure', 'Waktu habis — Azure bertahan');
        return;
      }
    }

    // --- kondisi menang ronde ---
    let azureAlive = 0; let emberAlive = 0;
    try {
      azureAlive = bots.aliveCount('azure');
      emberAlive = bots.aliveCount('ember');
    } catch (e) { /* abaikan */ }
    if (azureAlive === 0) { endRound('ember', 'Eliminasi'); return; }
    if (emberAlive === 0 && !playerAlive()) { endRound('azure', 'Eliminasi'); return; }
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.phase = 'roundEnd';
    state.roundWinner = winner;
    state.score = state.score || { ember: 0, azure: 0 };
    state.score[winner] = (state.score[winner] || 0) + 1;
    const playerWon = winner === 'ember';
    state.money = (state.money || 0) + (playerWon ? ECON.win : ECON.lose);
    if (playerWon && playerAlive()) setPlayerHealth(Math.min(100, getPlayerHealth() + 25));
    mgr.playerPlanting = false;
    mgr.playerDefusing = false;
    channelT = 0;
    defuseT = 0;
    try { if (hud) hud.setScore(state.score.ember, state.score.azure); } catch (e) { /* abaikan */ }
    try { if (hud) hud.setMoney(state.money); } catch (e) { /* abaikan */ }
    try { if (hud) hud.setSpike('idle', null, 0); } catch (e) { /* abaikan */ }
    try { if (hud) hud.banner(playerWon ? 'EMBER MENANG' : 'AZURE MENANG', reason || '', 3500); } catch (e) { /* abaikan */ }
    safeAudio(playerWon ? 'win' : 'lose');
    endTimer = END_PAUSE;
  }

  function finishMatch() {
    state.phase = 'matchEnd';
    const w = (state.score.ember || 0) >= (state.score.azure || 0) ? 'ember' : 'azure';
    state.matchWinner = w;
    const acc = state.shots > 0 ? Math.round((100 * (state.hits || 0)) / state.shots) : 0;
    try {
      if (hud) hud.showOverlay('matchEnd', {
        score: { ember: state.score.ember || 0, azure: state.score.azure || 0 },
        kills: state.kills || 0,
        accuracy: acc,
        winner: w,
      });
    } catch (e) { /* abaikan */ }
  }

  function interruptChannel() {
    channelT = 0;
    defuseT = 0;
    const sp = state.spike;
    if (!sp) return;
    if (sp.status === 'planting' && sp.planter === 'player') {
      sp.status = 'idle';
      sp.progress = 0;
      sp.site = null;
      sp.planter = null;
    }
    if (sp.status === 'defusing' && sp.defuser === 'player') {
      sp.status = 'planted';
      sp.progress = 1;
      sp.defuser = null;
    }
    try { if (hud) hud.setSpike(sp.status, sp.site, sp.progress); } catch (e) { /* abaikan */ }
  }

  function step(dt, input) {
    if (!state.phase) state.phase = 'buy';
    if (state.phase === 'buy') {
      state.buyTime -= dt;
      try { if (hud && typeof hud.setBuyTime === 'function') hud.setBuyTime(Math.max(0, Math.ceil(state.buyTime))); } catch (e) { /* abaikan */ }
      if (state.buyTime <= 0 || keyDown(input, 'Enter')) closeBuy();
      return;
    }
    if (state.phase === 'live') { liveStep(dt); return; }
    if (state.phase === 'roundEnd') {
      endTimer -= dt;
      if (endTimer <= 0) {
        if ((state.score.ember || 0) >= WIN_SCORE || (state.score.azure || 0) >= WIN_SCORE || (state.round || 1) >= MAX_ROUND) {
          finishMatch();
        } else {
          state.round = (state.round || 1) + 1;
          startRound();
        }
      }
      return;
    }
    // matchEnd: diam, menunggu main lagi via overlay.
  }

  return mgr;
}
