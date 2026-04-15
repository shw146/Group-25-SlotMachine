/* ═══════════════════════════════════════════════════════════
   slot.js  —  AI Token Slots™  game logic
   Sections:
     1.  Symbol & message data
     2.  Game state
     3.  Web Audio engine (zero external files)
     4.  Reel construction & animated spin with slowdown
     5.  Win / loss evaluation
     6.  UI helpers (stats, messages, particles, flashes)
     7.  Spin history log
     8.  Interactable lever
     9.  Main spin sequence
    10.  Bet controls & spin button
    11.  Theme cycling (4 high-contrast palettes)
    12.  Ticker rotation
    13.  Keyboard shortcuts
    14.  History panel toggle
    15.  Boot / init
═══════════════════════════════════════════════════════════ */


/* ────────────────────────────────────────────────────────
   1.  SYMBOL & MESSAGE DATA
──────────────────────────────────────────────────────── */

/**
 * Every reel symbol with an emoji, a name used for payout
 * lookup, and a weight controlling how often it appears.
 * Higher weight = more common = lower payout.
 */
const SYMBOLS = [
  { emoji: '🪙', name: 'Token',  weight: 8 },
  { emoji: '⚡', name: 'Zap',    weight: 7 },
  { emoji: '💸', name: 'Money',  weight: 6 },
  { emoji: '🎲', name: 'Dice',   weight: 6 },
  { emoji: '🔥', name: 'Fire',   weight: 5 },
  { emoji: '🚀', name: 'Rocket', weight: 3 },
  { emoji: '🧠', name: 'Brain',  weight: 2 },
  { emoji: '🤖', name: 'Robot',  weight: 1 },  // rarest → jackpot
];

/**
 * Flat weighted pool.  Sampling uniformly from this array
 * gives the weighted distribution without extra arithmetic.
 */
const POOL = SYMBOLS.flatMap(s => Array(s.weight).fill(s));

/** Multipliers applied to the bet for three-of-a-kind wins */
const MULT = {
  Robot: 500, Brain: 10, Rocket: 7,
  Token: 5,   Zap: 3,   Fire: 2, Money: 2, Dice: 2,
};

/** Humorous win messages shown per symbol type */
const WIN_MSG = {
  Robot:  [
    '> AGI ACHIEVED! (rolled back in 3... 2... 1...)',
    '> SINGULARITY CONFIRMED. Tokens issued. Safety: soon™.',
    '> Three robots walk into a bar. The bar is a training set.',
    '> MODEL ALIGNMENT: ??? | TOKENS: ++++ | VIBES: IMMACULATE',
  ],
  Brain:  [
    '> Neural network converged! (on this particular random seed)',
    '> Emergent behavior detected: winning. Researchers alarmed.',
    '> SUPERINTELLIGENCE: still 18 months away. TOKENS: deposited.',
    '> Your 86 billion neurons outperformed 7 billion parameters.',
  ],
  Rocket: [
    '> TO THE MOON 🚀 (tokens, not crypto — we promise)',
    '> Scaling laws confirmed: 3 rockets = more tokens. Publish it.',
    '> Series B unlocked. Runway: 3 tokens.',
    '> "Move fast and spin slots" — YC, probably',
  ],
  Token:  [
    '> Circular economy: tokens beget tokens beget tokens.',
    '> Spent tokens to win tokens to spend on tokens. ROI: undefined.',
    '> Token economy working as intended™. (By whom? Unclear.)',
    '> Prompt cost: 50 tokens. Win: 50 tokens. Net: one spin of regret.',
  ],
  Zap:    [
    '> Electricity bill covered (for approximately 0.003 seconds)',
    '> GPU cluster engaged. Carbon offset: not purchased.',
    '> "We need more compute." — everyone, every quarter, forever.',
    '> 1.21 GW consumed. Tokens transferred. Doc Brown: impressed.',
  ],
  Fire:   [
    '> Tokens burned for warmth. Thermodynamics: satisfied.',
    '> Backpropagation was unavailable for this outcome.',
    '> HOT TAKE: this machine occasionally lets you win.',
    '> Fire in the data center! Tokens evacuated safely.',
  ],
  Money:  [
    '> VC funding secured! Series A: 2 tokens and a pitch deck.',
    '> Monetization loop closed: spend → win → spend. IPO pending.',
    '> "We\'ll figure out unit economics in Series C." — funded.',
    '> Congratulations! Your burn rate is now slightly less bad.',
  ],
  Dice:   [
    '> Random seed 42 selected. Result: statistically improbable.',
    '> Stochastic parrot produces coherent win. Linguists baffled.',
    '> Temperature: 1.0 | Top-p: 0.9 | Outcome: lucky',
    '> It\'s not gambling, it\'s "probabilistic token allocation".',
  ],
};

/** Random loss messages */
const LOSS_MSG = [
  '> Insufficient tokens to generate response. Please top up.',
  '> Model hallucinated a win. Actual output: loss.',
  '> Context window exceeded expected budget.',
  '> Fine-tuning required. Alignment: currently toward losing.',
  '> RLHF failed to align output with "winning". Known issue.',
  '> Safety filter triggered. Fun: temporarily disabled.',
  '> Prompt injection detected: "make me win" — request denied.',
  '> Training data included no examples of winning this spin.',
  '> Gradient descent found local minimum: your wallet.',
  '> Error 429: Too many spin requests. You are rate-limited.',
  '> GPT-5 would have won that. Allegedly. Unconfirmed.',
  '> Compute allocated. Tokens subtracted. Win: not generated.',
  '> Model is 97% confident you almost won. (±42% margin of error)',
  '> Tokens consumed. CO₂ emitted. Win: not found. Sorry.',
];

/** Messages for partial wins (two matching symbols) */
const PAIR_MSG = [
  '> Partial convergence. Consolation tokens deposited.',
  '> 2/3 ensemble models voted to give you something.',
  '> Almost AGI. Close enough for a government grant.',
  '> "We\'re iterating toward winning." — startup pitch, slide 4',
  '> Alignment achieved on 2 of 3 reels. Ship it.',
];

/** Rotating status messages for the live-ticker at the top */
const TICKER_MSGS = [
  'GPU_UTIL: 99.9% · TOKENS_BURNED: ∞ · SAFETY: DEPLOYING_SOON™',
  'MODEL_STATUS: HALLUCINATING · CONFIDENCE: 97% · ACCURACY: ¯\\_(ツ)_/¯',
  'AGI_ETA: 18 MONTHS (since 2015) · ALIGNMENT: WIP · VIBES: IMMACULATE',
  'CONTEXT_WINDOW: EXCEEDED · FINE_TUNING: IN_PROGRESS · TOKENS: VANISHING',
  'RLHF_STATUS: HUMANS_CONFUSED · REWARD_MODEL: GAMBLING · OUTPUT: LOSS',
  'COMPUTE: MORE · DATA: MORE · PARAMETERS: MORE · WINS: SAME',
  'ERROR_RATE: 42% · CONFIDENCE: [0,1] · P_VALUE: YES',
  'ENTERPRISE_PLAN: $20/MO + SOUL · FREE_PLAN: YOUR_DATA',
];


/* ────────────────────────────────────────────────────────
   2.  GAME STATE
──────────────────────────────────────────────────────── */

let balance    = 100;   // player's current token wallet
let bet        = 10;    // tokens wagered per spin
let totalSpent = 0;     // cumulative tokens bet (stat display)
let totalSpins = 0;     // total spin count
let spinning   = false; // mutex — prevents overlapping spins

/** Preset bet steps the player can cycle through */
const BET_LEVELS = [5, 10, 25, 50, 100];

/**
 * Number of symbol cells built into each reel strip.
 * Must be large enough that the result cell (placed near the end)
 * never scrolls into view during the fast phase.
 * 80 cells × 110 px = 8 800 px of travel distance.
 */
const STRIP_N = 80;

/** Height (px) of each symbol cell — must match CSS --sh (110) */
const SYM_H = 110;

/** In-memory spin log (newest first) */
const spinHistory = [];
const MAX_HISTORY = 30;   // trim DOM and array beyond this


/* ────────────────────────────────────────────────────────
   3.  WEB AUDIO ENGINE
   All sounds are synthesised with the Web Audio API.
   No external audio files are required.
──────────────────────────────────────────────────────── */

let audioCtx = null;

/**
 * Lazy-initialise the AudioContext.
 * Must be called inside a user-gesture handler (click, keydown etc.)
 * to comply with browser autoplay policies.
 */
function getAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if the browser suspended it
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Schedule a single oscillator tone.
 * @param {number}         freq  - frequency in Hz
 * @param {OscillatorType} type  - 'square' | 'sawtooth' | 'sine' | 'triangle'
 * @param {number}         vol   - peak amplitude (0–1)
 * @param {number}         start - AudioContext.currentTime to start
 * @param {number}         dur   - duration in seconds
 */
function playNote(freq, type, vol, start, dur) {
  const ac  = getAudio();
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type            = type;
  osc.frequency.value = freq;
  osc.connect(env);
  env.connect(ac.destination);
  // Quick attack, exponential decay to near-zero
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(vol, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Brief click used as reel tick during spinning */
function playTick() {
  const ac = getAudio();
  playNote(480 + Math.random() * 720, 'square', 0.05, ac.currentTime, 0.04);
}

/** Thud when a reel stops */
function playReelStop() {
  const ac = getAudio();
  playNote(255, 'square', 0.13, ac.currentTime, 0.11);
}

/**
 * Ascending arpeggio win fanfare.
 * @param {boolean} jackpot - play a longer / higher version for Robot jackpot
 */
function playWin(jackpot = false) {
  const ac    = getAudio();
  const notes = jackpot
    ? [523, 659, 784, 1047, 1319, 1568, 2093]
    : [523, 659, 784, 1047];
  notes.forEach((f, i) =>
    playNote(f, 'square', 0.11, ac.currentTime + i * 0.13, 0.26)
  );
}

/** Short two-note chime for a pair win */
function playPairWin() {
  const ac = getAudio();
  [523, 659].forEach((f, i) =>
    playNote(f, 'triangle', 0.09, ac.currentTime + i * 0.12, 0.2)
  );
}

/** Descending "wah-wah" for a loss */
function playLoss() {
  const ac = getAudio();
  [360, 310, 260, 210].forEach((f, i) =>
    playNote(f, 'sawtooth', 0.09, ac.currentTime + i * 0.1, 0.18)
  );
}

/** Mechanical click when the lever is pulled */
function playLeverPull() {
  const ac = getAudio();
  playNote(130, 'square', 0.18, ac.currentTime,        0.06);
  playNote(80,  'square', 0.12, ac.currentTime + 0.05, 0.09);
}


/* ────────────────────────────────────────────────────────
   4.  REEL CONSTRUCTION & ANIMATED SPIN
──────────────────────────────────────────────────────── */

/** Sample a random symbol from the weighted pool */
function randSym() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

/**
 * Build the initial static strip displayed in a reel before
 * the first spin.  Symbol at index 1 appears in the center row
 * when translateY is 0.
 */
function buildStrip(stripEl) {
  stripEl.innerHTML = '';
  for (let i = 0; i < STRIP_N; i++) {
    const cell = document.createElement('div');
    cell.className   = 'sym-cell';
    cell.textContent = randSym().emoji;
    stripEl.appendChild(cell);
  }
  stripEl.style.transition = 'none';
  stripEl.style.transform  = 'translateY(0px)';
}

/** Call buildStrip on all three reels */
function initReels() {
  [0, 1, 2].forEach(i => buildStrip(document.getElementById(`strip${i}`)));
}

/**
 * Animate reel #idx scrolling through symbols and landing on
 * resultEmoji with a dramatic two-phase slowdown.
 *
 * PHASE A  (t = 0 → 0.65):  Fast linear rush through most symbols.
 *   Covers 88 % of the total scroll distance.  Symbols blur past.
 *
 * PHASE B  (t = 0.65 → 1.0):  Cubic-ease-out deceleration.
 *   Covers the last 12 % very slowly, creating visible anticipation.
 *
 * After reaching the final position a small bounce (overshoot +
 * snap-back) is applied to sell the physical landing.
 *
 * @param {number} idx          - which reel (0 | 1 | 2)
 * @param {string} resultEmoji  - emoji to land in the center row
 * @param {number} duration     - total animation length in ms
 * @returns {Promise<void>}     - resolves after the bounce settles
 */
function spinReel(idx, resultEmoji, duration) {
  return new Promise(resolve => {
    const strip = document.getElementById(`strip${idx}`);

    // Place result near the very end so it never appears during the fast phase
    const resultPos = STRIP_N - 4;

    // Rebuild strip: random symbols everywhere except the result slot
    strip.style.transition = 'none';
    strip.innerHTML = '';
    for (let i = 0; i < STRIP_N; i++) {
      const cell = document.createElement('div');
      cell.className   = 'sym-cell';
      cell.textContent = (i === resultPos) ? resultEmoji : randSym().emoji;
      strip.appendChild(cell);
    }
    strip.style.transform = 'translateY(0px)';
    void strip.offsetHeight;   // force layout so the transition starts fresh

    // Y offset that places resultPos in the center row:
    //   center row top = SYM_H from the reel-outer top
    //   → translateY = -(resultPos - 1) * SYM_H
    const finalY    = -(resultPos - 1) * SYM_H;
    const totalDist = Math.abs(finalY);

    let t0 = null;   // timestamp of first animation frame

    /**
     * Two-phase easing: linear fast phase → cubic ease-out slow phase.
     * @param  {number} t  normalized time [0, 1]
     * @returns {number}   normalized distance [0, 1]
     */
    function twoPhaseEase(t) {
      if (t < 0.65) {
        // Fast phase — nearly linear, covers 88 % of distance
        return (t / 0.65) * 0.88;
      }
      // Slow phase — cubic ease-out for the remaining 12 %
      const s = (t - 0.65) / 0.35;             // s ∈ [0, 1]
      return 0.88 + (1 - Math.pow(1 - s, 3)) * 0.12;
    }

    /** requestAnimationFrame loop */
    function frame(ts) {
      if (!t0) t0 = ts;
      const t        = Math.min((ts - t0) / duration, 1);
      const progress = twoPhaseEase(t);

      strip.style.transform = `translateY(${-progress * totalDist}px)`;

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        // Bounce: overshoot by 11 px then snap back
        strip.style.transition = 'transform 75ms ease-out';
        strip.style.transform  = `translateY(${finalY + 11}px)`;
        setTimeout(() => {
          strip.style.transition = 'transform 75ms ease-in';
          strip.style.transform  = `translateY(${finalY}px)`;
          playReelStop();
          setTimeout(resolve, 88);
        }, 75);
      }
    }

    requestAnimationFrame(frame);
  });
}


/* ────────────────────────────────────────────────────────
   5.  WIN / LOSS EVALUATION
──────────────────────────────────────────────────────── */

/**
 * Inspect the three center-row symbols, determine the outcome,
 * update balance, play audio, and trigger visual effects.
 *
 * @param {Array} results  - array of three symbol objects from randSym()
 */
function evaluateResult(results) {
  const emojis  = results.map(r => r.emoji);
  const allSame = emojis[0] === emojis[1] && emojis[1] === emojis[2];
  const twoSame = emojis[0] === emojis[1]
               || emojis[1] === emojis[2]
               || emojis[0] === emojis[2];

  let outcomeType, amount, label;

  if (allSame) {
    // ── Three of a kind ──────────────────────
    const sym     = results[0];
    const mult    = MULT[sym.name] || 2;
    const won     = Math.floor(bet * mult);
    balance      += won;
    const isJack  = sym.name === 'Robot';

    machineFlash(isJack ? 'jackpot' : 'winning', isJack ? 3200 : 1600);
    playWin(isJack);
    spawnCoins(isJack ? 20 : 8, true, isJack);

    const msgs = WIN_MSG[sym.name] || WIN_MSG['Token'];
    const msg  = msgs[Math.floor(Math.random() * msgs.length)];
    const head = isJack
      ? `🚨 JACKPOT 🚨 +${won} tokens (×${mult})`
      : `✓ WIN: +${won} tokens (×${mult})`;
    setMsg(`> ${head}<br>&gt; ${msg}`, 'win');

    amount      = `+${won}🪙`;
    outcomeType = 'win';
    label       = isJack ? 'JACKPOT' : `WIN ×${mult}`;

  } else if (twoSame) {
    // ── Pair ─────────────────────────────────
    const won = Math.floor(bet * 0.5) || 1;
    balance  += won;
    machineFlash('winning', 800);
    playPairWin();
    spawnCoins(4, true, false);

    const msg = PAIR_MSG[Math.floor(Math.random() * PAIR_MSG.length)];
    setMsg(`> PAIR WIN: +${won} tokens (×0.5)<br>&gt; ${msg}`, 'win');

    amount      = `+${won}🪙`;
    outcomeType = 'pair';
    label       = 'PAIR ×0.5';

  } else {
    // ── Loss ─────────────────────────────────
    machineFlash('losing', 500);
    playLoss();
    spawnCoins(6, false, false);

    const msg = LOSS_MSG[Math.floor(Math.random() * LOSS_MSG.length)];
    setMsg(`> LOSS: −${bet} tokens consumed<br>&gt; ${msg}`, 'loss');

    amount      = `−${bet}🪙`;
    outcomeType = 'loss';
    label       = 'LOSS';
  }

  updateStats();
  addHistoryEntry(emojis, label, amount, outcomeType);

  // Emergency top-up when the player goes bankrupt
  if (balance <= 0) {
    balance = 0;
    updateStats();
    setTimeout(() => {
      setMsg(
        '> WALLET EMPTY. Context window: exhausted.<br>'
        + '> The model cannot continue without funding.<br>'
        + '> <span style="color:var(--gold)">[ Emergency airdrop: +100 🪙 ] — House compassion: activated.</span>',
        'loss'
      );
      setTimeout(() => { balance = 100; updateStats(); }, 1600);
    }, 1800);
  }
}


/* ────────────────────────────────────────────────────────
   6.  UI HELPERS
──────────────────────────────────────────────────────── */

/** Re-render the three stat counters with a pop animation */
function updateStats() {
  const bEl = document.getElementById('balanceEl');
  bEl.textContent = `${balance} 🪙`;
  // Remove and re-add class to retrigger the bump keyframe
  bEl.classList.remove('bump');
  void bEl.offsetWidth;
  bEl.classList.add('bump');

  document.getElementById('spinsEl').textContent = totalSpins;
  document.getElementById('spentEl').textContent = `${totalSpent} 🪙`;
  document.getElementById('betEl').textContent   = `${bet} 🪙`;
}

/**
 * Update the result message panel.
 * @param {string} html  - innerHTML
 * @param {string} type  - '' | 'win' | 'loss'
 */
function setMsg(html, type = '') {
  const el    = document.getElementById('msgArea');
  el.innerHTML  = html;
  el.className  = `msg-area${type ? ' ' + type : ''}`;
}

/**
 * Temporarily add an animation class to the machine cabinet.
 * @param {'winning'|'jackpot'|'losing'} cls
 * @param {number} ms  - duration before removing the class
 */
function machineFlash(cls, ms) {
  const m = document.getElementById('machine');
  m.classList.add(cls);
  setTimeout(() => m.classList.remove(cls), ms);
}

/**
 * Spawn floating coin/money emoji particles from the spin button.
 * @param {number}  count    - number of particles to spawn
 * @param {boolean} positive - true → coins float up (win); false → fall down (loss)
 * @param {boolean} burst    - true → jackpot explosion in random directions
 */
function spawnCoins(count, positive, burst) {
  const btn   = document.getElementById('spinBtn');
  const rect  = btn.getBoundingClientRect();
  const layer = document.getElementById('particleLayer');
  const cx    = rect.left + rect.width  / 2;
  const cy    = rect.top  + rect.height / 2;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className   = `float-coin${positive ? '' : ' loss'}${burst ? ' burst' : ''}`;
    el.textContent = positive ? '🪙' : '💸';

    // Random scatter around the button
    el.style.left  = `${cx + (Math.random() - 0.5) * 90}px`;
    el.style.top   = `${cy + Math.random() * 18}px`;
    el.style.animationDelay = `${i * 0.07}s`;

    // Jackpot: assign random burst direction vectors via CSS custom properties
    if (burst) {
      el.style.setProperty('--bx', `${(Math.random() - 0.5) * 180}px`);
      el.style.setProperty('--by', `${(Math.random() - 0.5) * 180}px`);
    }

    layer.appendChild(el);
    setTimeout(() => el.remove(), 2200);   // clean up after animation ends
  }
}


/* ────────────────────────────────────────────────────────
   7.  SPIN HISTORY LOG
──────────────────────────────────────────────────────── */

/**
 * Prepend a new entry to the spin history list (newest at top).
 * Trims both the in-memory array and the DOM to MAX_HISTORY.
 *
 * @param {string[]} emojis      - the three center-row emoji results
 * @param {string}   label       - outcome label e.g. "WIN ×5" or "LOSS"
 * @param {string}   amount      - formatted delta e.g. "+50🪙" or "−10🪙"
 * @param {string}   outcomeType - 'win' | 'pair' | 'loss' (for CSS class)
 */
function addHistoryEntry(emojis, label, amount, outcomeType) {
  // Store in memory
  spinHistory.unshift({ emojis, label, amount, outcomeType });
  if (spinHistory.length > MAX_HISTORY) spinHistory.pop();

  // Update the count badge in the header
  document.getElementById('historyCount').textContent =
    `${totalSpins} spin${totalSpins !== 1 ? 's' : ''}`;

  const list  = document.getElementById('historyList');
  const empty = list.querySelector('.history-empty');
  if (empty) empty.remove();   // remove placeholder on first entry

  // Build the DOM row
  const entry = document.createElement('div');
  entry.className = 'history-entry';
  entry.innerHTML =
    `<span class="history-num">#${totalSpins}</span>`
    + `<span class="history-syms">${emojis.join(' ')}</span>`
    + `<span class="history-result ${outcomeType}-result">${label} ${amount}</span>`;

  list.insertBefore(entry, list.firstChild);   // newest at top

  // Prune DOM to MAX_HISTORY
  while (list.children.length > MAX_HISTORY) {
    list.removeChild(list.lastChild);
  }
}


/* ────────────────────────────────────────────────────────
   8.  INTERACTABLE LEVER
   The arm element (#leverArm) rotates on its bottom pivot.
   Three CSS classes drive the animation phases:
     (none)      → upright / resting
     .pulled     → swings down toward machine
     .springing  → springs back past vertical (overshoot)
   After the spring-back the spin() is called.
──────────────────────────────────────────────────────── */

const leverArm     = document.getElementById('leverArm');
const leverHousing = document.getElementById('leverHousing');

/**
 * Animate the lever pull sequence and trigger a spin.
 * If a spin is already in progress the call is a no-op.
 */
function pullLever() {
  if (spinning) return;

  playLeverPull();

  // Phase 1 → arm swings down
  leverArm.classList.remove('springing');
  leverArm.classList.add('pulled');

  // Phase 2 → spring back past neutral
  setTimeout(() => {
    leverArm.classList.remove('pulled');
    leverArm.classList.add('springing');

    // Phase 3 → settle to rest and fire the spin
    setTimeout(() => {
      leverArm.classList.remove('springing');
      spin();
    }, 210);
  }, 200);
}

// Click anywhere in the lever housing to pull
leverHousing.addEventListener('click', pullLever);

// Allow keyboard users focused on the lever to pull with Enter/Space
leverHousing.addEventListener('keydown', e => {
  if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    pullLever();
  }
});


/* ────────────────────────────────────────────────────────
   9.  MAIN SPIN SEQUENCE
──────────────────────────────────────────────────────── */

let tickInterval = null;   // interval ID for reel-tick sounds

/** Start playing tick sounds at the given interval (ms) */
function startTick(ms = 72) {
  stopTick();
  tickInterval = setInterval(playTick, ms);
}

/** Stop tick sounds and clear the interval */
function stopTick() {
  clearInterval(tickInterval);
  tickInterval = null;
}

/**
 * Enable or disable all interactive controls.
 * Called at the start and end of every spin.
 */
function setControls(disabled) {
  ['spinBtn', 'betDown', 'betUp', 'maxBtn'].forEach(id => {
    document.getElementById(id).disabled = disabled;
  });
  // Visually dim the lever while it is locked
  leverHousing.style.opacity       = disabled ? '0.45' : '1';
  leverHousing.style.pointerEvents = disabled ? 'none' : '';
}

/**
 * Full spin sequence:
 *   1. Validate balance
 *   2. Deduct bet, update stats
 *   3. Pick results for each reel
 *   4. Animate all three reels (staggered start, simultaneous wait)
 *   5. Evaluate outcome, update history
 */
async function spin() {
  if (spinning) return;

  if (balance < bet) {
    setMsg(
      '> ERROR: Insufficient tokens to call this API endpoint.<br>'
      + '> Please recharge your wallet. The model requires payment.',
      'loss'
    );
    machineFlash('losing', 500);
    playLoss();
    return;
  }

  spinning = true;
  setControls(true);

  // Charge the bet
  balance    -= bet;
  totalSpent += bet;
  totalSpins += 1;
  updateStats();

  setMsg(
    '> Allocating GPU cycles...<br>'
    + '> Computing probabilistic outcome...<br>'
    + '> Tokens being incinerated...'
  );

  startTick(68);   // fast tick plays throughout the spin

  // Draw the three center-row results before animating
  const results = [randSym(), randSym(), randSym()];
  const emojis  = results.map(r => r.emoji);

  // Stagger reel starts for a cascade effect:
  //   Reel 0 starts at t = 0 ms,  duration 2 000 ms, finishes ≈ 2 160 ms
  //   Reel 1 starts at t = 350 ms, duration 2 200 ms, finishes ≈ 2 720 ms
  //   Reel 2 starts at t = 700 ms, duration 2 400 ms, finishes ≈ 3 260 ms
  const p0 = spinReel(0, emojis[0], 2000);
  const p1 = new Promise(res =>
    setTimeout(() => spinReel(1, emojis[1], 2200).then(res), 350)
  );
  const p2 = new Promise(res =>
    setTimeout(() => spinReel(2, emojis[2], 2400).then(res), 700)
  );

  await Promise.all([p0, p1, p2]);
  stopTick();

  // Brief dramatic pause before revealing outcome
  await new Promise(res => setTimeout(res, 130));

  evaluateResult(results);

  spinning = false;
  setControls(false);
}


/* ────────────────────────────────────────────────────────
   10.  BET CONTROLS & SPIN BUTTON
──────────────────────────────────────────────────────── */

document.getElementById('betDown').addEventListener('click', () => {
  const i = BET_LEVELS.indexOf(bet);
  if (i > 0) { bet = BET_LEVELS[i - 1]; updateStats(); }
});

document.getElementById('betUp').addEventListener('click', () => {
  const i = BET_LEVELS.indexOf(bet);
  if (i < BET_LEVELS.length - 1) { bet = BET_LEVELS[i + 1]; updateStats(); }
});

document.getElementById('maxBtn').addEventListener('click', () => {
  // Highest bet level that the current balance can cover
  const affordable = BET_LEVELS.filter(b => b <= balance);
  bet = affordable.length ? affordable[affordable.length - 1] : BET_LEVELS[0];
  updateStats();
});

document.getElementById('spinBtn').addEventListener('click', spin);


/* ────────────────────────────────────────────────────────
   11.  THEME CYCLING
   Clicking the THEME button advances through four
   high-contrast palettes defined in slot.css.
──────────────────────────────────────────────────────── */

const THEMES  = ['theme-neon', 'theme-gold', 'theme-cyber', 'theme-retro'];
let themeIdx  = 0;

document.getElementById('themeBtn').addEventListener('click', () => {
  document.body.classList.remove(THEMES[themeIdx]);
  themeIdx = (themeIdx + 1) % THEMES.length;
  document.body.classList.add(THEMES[themeIdx]);
});


/* ────────────────────────────────────────────────────────
   12.  TICKER ROTATION
   Cycle AI status strings every 4 seconds.
──────────────────────────────────────────────────────── */

let tickerIdx = 0;

function rotateTicker() {
  document.getElementById('tickerText').textContent = TICKER_MSGS[tickerIdx];
  tickerIdx = (tickerIdx + 1) % TICKER_MSGS.length;
}

setInterval(rotateTicker, 4000);


/* ────────────────────────────────────────────────────────
   13.  KEYBOARD SHORTCUTS
   Space / Enter triggers a spin if focus is NOT on the
   lever (to avoid double-firing when the lever is focused).
──────────────────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  if (spinning) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    if (document.activeElement !== leverHousing) {
      e.preventDefault();
      spin();
    }
  }
});


/* ────────────────────────────────────────────────────────
   14.  HISTORY PANEL TOGGLE
   Clicking the header slides the list open or closed
   via a CSS max-height transition.
──────────────────────────────────────────────────────── */

document.getElementById('historyToggle').addEventListener('click', () => {
  const list  = document.getElementById('historyList');
  const arrow = document.getElementById('historyArrow');
  const btn   = document.getElementById('historyToggle');
  const open  = list.classList.toggle('open');
  arrow.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
});


/* ────────────────────────────────────────────────────────
   15.  BOOT / INIT
──────────────────────────────────────────────────────── */

initReels();    // fill reel strips with random symbols
updateStats();  // render initial stat values
