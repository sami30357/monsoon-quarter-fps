// The DOM HUD: health, armour, ammo, money, round timer and score, bomb status, the noise
// meter, the buy menu, the kill feed and the round banners. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out. Writes are cached, so a value
// that did not change costs no DOM work.
const COPY = {
  start: {
    title: 'Monsoon Quarter',
    copy: 'Rain on neon. Plant the spike at the Tea House or the Warehouse — or drop every Sentinel. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Monsoon Quarter',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthValue = $('health-value');
  const healthFill = $('health-fill');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerPhase = $('timer-phase');
  const roundScore = $('round-score');
  const bombStatus = $('bomb-status');
  const bombText = $('bomb-text');
  const bombFill = $('bomb-fill');
  const noiseFill = $('noise-fill');
  const noiseLabel = $('noise-label');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buymenu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const hint = $('hint');
  const spike = $('spike');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let buyBuilt = false;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp, armor) {
      setText(healthValue, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(armorValue, 'armor', armor > 0 ? `+${Math.ceil(armor)}` : '');
      const frac = Math.max(0, Math.min(1, hp / 100));
      if (last.hpf !== frac) {
        last.hpf = frac;
        healthFill.style.width = `${frac * 100}%`;
      }
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(n) {
      setText(moneyValue, 'money', `$${n}`);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      setText(timerValue, 'timer', `${mm}:${ss}`);
      setText(timerPhase, 'phase', phase);
    },
    setRoundScore(v, s, round) {
      setText(roundScore, 'rs', `VAN ${v} — ${s} SEN · ROUND ${round}/9`);
    },
    setBomb(text, frac) {
      bombStatus.hidden = false;
      setText(bombText, 'bomb', text);
      const f = Math.max(0, Math.min(1, frac));
      if (last.bombf !== f) {
        last.bombf = f;
        bombFill.style.width = `${f * 100}%`;
      }
    },
    hideBomb() {
      bombStatus.hidden = true;
    },
    setNoise(level, label) {
      const f = Math.max(0, Math.min(1, level));
      if (last.noisef !== f) {
        last.noisef = f;
        noiseFill.style.width = `${f * 100}%`;
        noiseFill.classList.toggle('loud', f > 0.66);
        noiseFill.classList.toggle('mid', f > 0.33 && f <= 0.66);
      }
      setText(noiseLabel, 'noisel', label);
    },
    setSpike(has) {
      spike.hidden = !has;
    },
    setHint(text) {
      setText(hint, 'hint', text);
      hint.hidden = !text;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 6000);
    },
    banner(titleText, subText, ms = 2600) {
      setText(bannerTitle, 'bt', titleText);
      setText(bannerSub, 'bs', subText);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    showBuyMenu(items, money) {
      buyMenu.hidden = false;
      setText(buyMoney, 'bmoney', `$${money}`);
      if (!buyBuilt) {
        buyBuilt = true;
        for (const item of items) {
          const row = document.createElement('div');
          row.className = 'buy-row';
          row.innerHTML = `<b>${item.key}</b><span class="buy-name"></span><span class="buy-note"></span><span class="buy-price"></span>`;
          row.querySelector('.buy-name').textContent = item.label;
          row.querySelector('.buy-note').textContent = item.note;
          row.querySelector('.buy-price').textContent = `$${item.price}`;
          buyItems.appendChild(row);
        }
      }
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
    },
    showOverlay(mode, data) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'end') copy.textContent = `${data.reason}. Vanguard ${data.v} — ${data.s} Sentinels.`;
      else if (mode === 'matchEnd') copy.textContent = `${data.winner === 'vanguard' ? 'Vanguard takes the match' : 'Sentinels take the match'} ${data.v} — ${data.s}.`;
      else copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
