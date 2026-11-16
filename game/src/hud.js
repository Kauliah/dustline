// hud.js — Dustline DOM HUD. Tidak menyentuh simulasi; main/rounds/bots push angka.
// Semua id dicari defensif: id yang belum ada di index.html jadi no-op, tidak crash.
// Update DOM hanya bila nilai berubah (cache nilai terakhir).
const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'FPS taktis 5v5 di Kestrel Yard. Tanam spike, eliminasi Azure, menangkan 5 ronde.',
    action: 'Klik untuk bermain',
  },
  paused: {
    title: 'Jeda',
    copy: 'Klik untuk lanjut bermain.',
    action: 'Lanjutkan',
  },
  end: {
    title: 'Ronde selesai',
    copy: 'Klik untuk main lagi.',
    action: 'Main lagi',
  },
};

export function createHud() {
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const el = {
    hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    money: $('money'), healthNum: $('health-num'), healthFill: $('health-fill'),
    grenades: $('grenades'), timer: $('timer'), roundNum: $('round-num'),
    scoreEmber: $('score-ember'), scoreAzure: $('score-azure'), killfeed: $('killfeed'),
    banner: $('banner'), bannerSub: $('banner-sub'), spikeStatus: $('spike-status'),
    spikeProgress: $('spike-progress'),
    buyMenu: $('buy-menu'), buyItems: $('buy-items'), buyMoney: $('buy-money'),
    buyTimer: $('buy-timer'), buyClose: $('buy-close'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), damageFlash: $('damage-flash'), vignette: $('vignette'),
  };

  let lastHealth = -1; let lastMag = -1; let lastRes = -1; let lastWeapon = '';
  let lastMoney = -1; let lastTimerSec = -1; let lastScoreE = -1; let lastScoreA = -1;
  let lastRound = -1; let lastGrenades = -1; let lastBuySec = -1; let lastSpikeKey = '';
  let bannerTimer = 0; let hitTimer = 0; let flashTimer = 0;
  let lastBuyArgs = null;

  // show/hide harus selaras dengan CSS index.html: #overlay sembunyi lewat
  // class .hidden, #buy-menu tampil lewat class .open, sisanya lewat [hidden].
  function showNode(n) { if (n) { n.hidden = false; n.classList.add('on'); n.classList.remove('hidden'); n.classList.add('open'); } }
  function hideNode(n) { if (n) { n.hidden = true; n.classList.remove('on'); n.classList.add('hidden'); n.classList.remove('open'); } }

  const hud = {
    onBuy: null,

    setHealth(h) {
      const v = Math.max(0, Math.round(h));
      if (v === lastHealth) return;
      lastHealth = v;
      if (el.healthNum) el.healthNum.textContent = String(v);
      if (el.healthFill) {
        el.healthFill.style.width = v + '%';
        el.healthFill.classList.toggle('low', v < 30);
      }
      if (el.hud) el.hud.classList.toggle('low-health', v < 30);
    },

    setAmmo(mag, res, name) {
      // main.js memberi weapons.current ('pistol'/'smg'/...) — petakan ke nama display.
      const WEAPON_NAMES = { pistol: 'Sidewinder', smg: 'Hornet', rifle: 'Longshot', sniper: 'Railspike' };
      const shown = WEAPON_NAMES[name] || name || '';
      if (mag === lastMag && res === lastRes && shown === lastWeapon) return;
      lastMag = mag; lastRes = res; lastWeapon = shown;
      if (el.ammoMag) el.ammoMag.textContent = String(mag);
      if (el.ammoReserve) el.ammoReserve.textContent = '/ ' + res;
      if (el.weaponName) el.weaponName.textContent = shown;
    },

    setMoney(m) {
      if (m === lastMoney) return;
      lastMoney = m;
      if (el.money) el.money.textContent = '$' + m;
    },

    setTimer(s) {
      const sec = Math.max(0, Math.ceil(s));
      if (sec === lastTimerSec) return;
      lastTimerSec = sec;
      if (el.timer) {
        const mm = Math.floor(sec / 60);
        const ss = String(sec % 60).padStart(2, '0');
        el.timer.textContent = mm + ':' + ss;
        el.timer.classList.toggle('low', sec < 15);
      }
    },

    setScore(e, a) {
      if (e === lastScoreE && a === lastScoreA) return;
      lastScoreE = e; lastScoreA = a;
      if (el.scoreEmber) el.scoreEmber.textContent = String(e);
      if (el.scoreAzure) el.scoreAzure.textContent = String(a);
    },

    setRound(r) {
      if (r === lastRound) return;
      lastRound = r;
      if (el.roundNum) el.roundNum.textContent = 'RONDE ' + r + '/9';
    },

    setGrenades(n) {
      if (n === lastGrenades) return;
      lastGrenades = n;
      if (el.grenades) el.grenades.textContent = n > 0 ? '◆'.repeat(n) : '—';
    },

    addKillfeed(text, headshot) {
      if (!el.killfeed) return;
      const div = document.createElement('div');
      div.className = 'killfeed-entry' + (headshot ? ' headshot' : '');
      div.textContent = text + (headshot ? ' ☠' : '');
      el.killfeed.prepend(div);
      while (el.killfeed.children.length > 4) el.killfeed.removeChild(el.killfeed.lastChild);
      setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 5000);
    },

    banner(main, sub, ms) {
      if (el.banner) el.banner.textContent = main || '';
      if (el.bannerSub) el.bannerSub.textContent = sub || '';
      showNode(el.banner);
      showNode(el.bannerSub);
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { hideNode(el.banner); hideNode(el.bannerSub); }, ms || 2500);
    },

    showBuy(items, money, timeLeft) {
      lastBuyArgs = { items, money, timeLeft };
      if (el.buyItems) {
        el.buyItems.textContent = '';
        for (const it of items || []) {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'buy-card' + (it.owned ? ' owned' : '');
          const key = document.createElement('span');
          key.className = 'buy-key';
          key.textContent = '[' + it.key + ']';
          const name = document.createElement('span');
          name.className = 'buy-name';
          name.textContent = it.name;
          const desc = document.createElement('span');
          desc.className = 'buy-desc';
          desc.textContent = it.desc || '';
          const price = document.createElement('span');
          price.className = 'buy-price';
          price.textContent = it.price > 0 ? '$' + it.price : 'GRATIS';
          card.append(key, name, desc, price);
          card.addEventListener('click', () => {
            if (typeof hud.onBuy === 'function') hud.onBuy(it.key);
          });
          el.buyItems.appendChild(card);
        }
      }
      if (el.buyMoney) el.buyMoney.textContent = '$' + money;
      hud.setBuyTime(timeLeft);
      showNode(el.buyMenu);
    },

    hideBuy() { hideNode(el.buyMenu); },

    toggleBuy(items, money, timeLeft) {
      if (el.buyMenu && !el.buyMenu.hidden) { hud.hideBuy(); return; }
      const args = items !== undefined ? { items, money, timeLeft } : lastBuyArgs;
      if (args) hud.showBuy(args.items, args.money, args.timeLeft);
      else showNode(el.buyMenu);
    },

    setBuyTime(s) {
      const sec = Math.max(0, Math.ceil(s == null ? 0 : s));
      if (sec === lastBuySec) return;
      lastBuySec = sec;
      if (el.buyTimer) el.buyTimer.textContent = sec + ' dtk';
    },

    showOverlay(kind, data) {
      let title = ''; let copy = ''; let action = 'Klik untuk bermain';
      if (kind === 'matchEnd' && data) {
        const e = data.score ? data.score.ember : 0;
        const a = data.score ? data.score.azure : 0;
        title = (data.winner || 'ember') === 'ember' ? 'EMBER MENANG!' : 'AZURE MENANG!';
        copy = 'Skor akhir ' + e + ' — ' + a + ' • Kill: ' + (data.kills || 0)
          + ' • Akurasi: ' + (data.accuracy || 0) + '%';
        action = 'Main lagi';
      } else {
        const c = COPY[kind] || COPY.start;
        title = c.title; copy = c.copy; action = c.action;
        if (kind === 'end' && data && typeof data.score === 'number') copy += ' Skormu: ' + data.score + '.';
      }
      if (el.overlayTitle) el.overlayTitle.textContent = title;
      if (el.overlayCopy) el.overlayCopy.textContent = copy;
      if (el.play) el.play.textContent = action;
      showNode(el.overlay);
      if (el.play) el.play.focus();
    },

    hideOverlay() { hideNode(el.overlay); },

    onPlay(fn) {
      if (el.play) el.play.addEventListener('click', fn);
    },

    hitmarker(killed, holdMs) {
      if (!el.hitmarker) return;
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        el.hitmarker.classList.remove('on');
        el.hitmarker.classList.remove('kill');
      }, holdMs || 90);
    },

    damageFlash(angleRad) {
      if (!el.damageFlash) return;
      el.damageFlash.style.transform = 'rotate(' + (angleRad || 0) + 'rad)';
      el.damageFlash.classList.add('on');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => el.damageFlash.classList.remove('on'), 600);
    },

    setSpike(status, site, progress) {
      const p = progress == null ? 0 : progress;
      let text = '';
      if (status === 'planting') text = 'MENANAM SPIKE — ' + site + ' ' + Math.round(p * 100) + '%';
      else if (status === 'defusing') text = 'MENJINAKKAN SPIKE — ' + site + ' ' + Math.round(p * 100) + '%';
      else if (status === 'planted') text = 'SPIKE AKTIF — ' + site + ' • ' + Math.ceil(p * 12) + ' dtk';
      else if (status === 'defused') text = 'SPIKE DIJINAKKAN';
      const key = status + '|' + site + '|' + Math.round(p * 100);
      if (key === lastSpikeKey) return;
      lastSpikeKey = key;
      if (el.spikeStatus) {
        el.spikeStatus.textContent = text;
        el.spikeStatus.classList.toggle('on', !!text);
      }
      if (el.spikeProgress) el.spikeProgress.style.width = (status === 'planted' || status === 'planting' || status === 'defusing' ? Math.round(p * 100) : 0) + '%';
    },

    setCrosshairSpread(px) {
      if (el.crosshair) el.crosshair.style.setProperty('--gap', (px || 0) + 'px');
    },

    setPhase(p) {
      if (el.hud) el.hud.setAttribute('data-phase', p || '');
    },
  };

  if (el.buyClose) el.buyClose.addEventListener('click', () => hud.hideBuy());
  return hud;
}
