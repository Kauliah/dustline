// Single state store for the Dustline match. Every module reads and writes
// this one object; no module keeps its own copy of match state.
export function createState() {
  return {
    phase: 'menu', // 'menu' | 'buy' | 'live' | 'roundEnd' | 'matchEnd'
    round: 1,
    maxRounds: 9,
    winsToTake: 5,
    roundTime: 100,
    buyTime: 12,
    score: { ember: 0, azure: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    shots: 0,
    hits: 0,
    headshots: 0,
    spike: { status: 'idle', site: null, progress: 0, timer: 0 },
    spikeCarrier: 'player',
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    muted: false,
    seed: 1,
  };
}

// Fresh round: full clock, spike back in the carrier's hands, buy phase open.
export function resetForRound(S) {
  S.roundTime = 100;
  S.spike = { status: 'idle', site: null, progress: 0, timer: 0 };
  S.spikeCarrier = 'player';
  S.phase = 'buy';
  S.buyTime = 12;
  S.roundWinner = null;
  S.roundReason = '';
}

// Fresh match: scores, money and tallies back to the start, then round one.
export function resetMatch(S) {
  S.round = 1;
  S.score = { ember: 0, azure: 0 };
  S.money = 800;
  S.kills = 0;
  S.deaths = 0;
  S.shots = 0;
  S.hits = 0;
  S.headshots = 0;
  S.phase = 'menu';
  S.matchWinner = null;
  resetForRound(S);
}
