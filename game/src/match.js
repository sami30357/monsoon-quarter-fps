// The match: buy phase, live round, round end, next round. First to 5 round wins takes
// the match (at most 9 rounds). The bomb is a real win condition: plant it and it ticks
// down to a detonation; defuse it and the defenders take the round.
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 35;
export const END_SECONDS = 4;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function createMatch(world, opts = {}) {
  const buySeconds = opts.buySeconds ?? BUY_SECONDS;
  const roundSeconds = opts.roundSeconds ?? ROUND_SECONDS;
  const state = {
    phase: 'buy',
    phaseT: buySeconds,
    round: 1,
    wins: { vanguard: 0, sentinel: 0 },
    bombPlanted: false,
    bombSite: null,
    bombTimer: 0,
    bombPos: null,
    winner: null,
    reason: '',
    matchWinner: null,
  };

  function startRound() {
    state.phase = 'buy';
    state.phaseT = buySeconds;
    state.bombPlanted = false;
    state.bombSite = null;
    state.bombTimer = 0;
    state.bombPos = null;
    state.winner = null;
    state.reason = '';
  }

  function startMatch() {
    state.round = 1;
    state.wins.vanguard = 0;
    state.wins.sentinel = 0;
    state.matchWinner = null;
    startRound();
  }

  function plantBomb(site) {
    if (state.bombPlanted || state.phase !== 'live') return false;
    const s = world.sites[site];
    state.bombPlanted = true;
    state.bombSite = site;
    state.bombTimer = BOMB_SECONDS;
    state.bombPos = { x: s.x, y: 0.1, z: s.z };
    return true;
  }

  function defuseBomb() {
    if (!state.bombPlanted) return false;
    state.bombPlanted = false;
    endRound('sentinel', 'Spike defused');
    return true;
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'matchEnd') return;
    state.phase = 'end';
    state.phaseT = END_SECONDS;
    state.winner = winner;
    state.reason = reason;
    state.wins[winner] += 1;
    if (state.wins[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.wins.vanguard > state.wins.sentinel ? 'vanguard' : 'sentinel';
    }
  }

  // tick advances the clock and decides round ends. ctx tells it who is still alive.
  function tick(dt, ctx) {
    if (state.phase === 'matchEnd') return;
    state.phaseT -= dt;
    if (state.phase === 'buy' && state.phaseT <= 0) {
      state.phase = 'live';
      state.phaseT = roundSeconds;
      return;
    }
    if (state.phase === 'live') {
      if (state.bombPlanted) {
        state.bombTimer -= dt;
        if (state.bombTimer <= 0) {
          state.bombPlanted = false;
          endRound('vanguard', 'Spike detonated');
          return;
        }
      }
      if (ctx.attackersAlive === 0) {
        endRound('sentinel', 'Vanguard eliminated');
        return;
      }
      if (ctx.defendersAlive === 0) {
        if (state.bombPlanted) {
          endRound('vanguard', 'Spike detonated');
        } else {
          endRound('vanguard', 'Sentinels eliminated');
        }
        return;
      }
      if (state.phaseT <= 0 && !state.bombPlanted) {
        endRound('sentinel', 'Time expired — spike not planted');
      }
      return;
    }
    if (state.phase === 'end' && state.phaseT <= 0) {
      if (state.matchWinner) {
        state.phase = 'matchEnd';
      } else {
        state.round += 1;
        startRound();
        ctx.onRoundStart(state.round);
      }
    }
  }

  return { state, startMatch, startRound, plantBomb, defuseBomb, endRound, tick };
}
