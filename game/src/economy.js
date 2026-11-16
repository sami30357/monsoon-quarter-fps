// The money: earned every round, spent in the buy menu. A round win pays for a rifle;
// a loss pays for an SMG at best, so losing rounds still have a real cost.
export const REWARDS = {
  kill: 300,
  roundWin: 3250,
  roundLoss: 1900,
  plant: 300,
  defuse: 300,
};

export const BUY_ITEMS = [
  { key: '1', id: 'hornet', label: 'Hornet-9 SMG', price: 1500, note: 'fast, close range' },
  { key: '2', id: 'vk47', label: 'VK-47 Rifle', price: 2700, note: 'hardest hitting' },
  { key: '3', id: 'grenade', label: 'Frag grenade', price: 300, note: 'loud blast, 9 m' },
  { key: '4', id: 'kevlar', label: 'Kevlar vest', price: 650, note: 'halves damage taken' },
  { key: '5', id: 'ammo', label: 'Refill ammo', price: 200, note: 'all owned weapons' },
];

export function createEconomy() {
  const state = { money: 800, grenades: 0, armor: 0, kills: 0 };

  function resetMatch() {
    state.money = 800;
    state.grenades = 0;
    state.armor = 0;
    state.kills = 0;
  }

  function add(amount) {
    state.money += amount;
  }

  function canAfford(cost) {
    return state.money >= cost;
  }

  // Buy one item by id. Returns { ok, cost } — the caller applies the weapon/grenade
  // effect only when ok is true.
  function buy(id, weapons) {
    if (id === 'grenade') {
      if (state.grenades >= 2 || !canAfford(300)) return { ok: false, cost: 0 };
      state.money -= 300;
      state.grenades += 1;
      return { ok: true, cost: 300 };
    }
    if (id === 'kevlar') {
      if (state.armor >= 50 || !canAfford(650)) return { ok: false, cost: 0 };
      state.money -= 650;
      state.armor = 50;
      return { ok: true, cost: 650 };
    }
    if (id === 'ammo') {
      if (!canAfford(200)) return { ok: false, cost: 0 };
      state.money -= 200;
      weapons.refill();
      return { ok: true, cost: 200 };
    }
    const def = weapons.defs[id];
    if (!def) return { ok: false, cost: 0 };
    const cost = weapons.owned[id] ? Math.round(def.price * 0.2) : def.price;
    if (!canAfford(cost)) return { ok: false, cost: 0 };
    state.money -= cost;
    weapons.buy(id);
    return { ok: true, cost };
  }

  return { state, resetMatch, add, canAfford, buy };
}
