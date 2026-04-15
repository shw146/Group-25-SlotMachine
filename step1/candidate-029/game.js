'use strict';

/* ============================================================
   game.js — TokenSlot AI
   Handles all game logic: reel animation (with slowdown),
   three-payline evaluation, lever interaction, visual FX
   (flash, coin burst, particle burst), Web Audio sounds,
   spin history log, theme cycling, and the canvas starfield.
   ============================================================ */

/* ── SYMBOL TABLE ───────────────────────────────────────────── */
// Each symbol has an emoji (e), a ×BET multiplier for 3-of-a-kind (pay),
// and a spawn weight (w) controlling how often it appears on the strip.
const SYMBOLS = [
  { e: '🤖', pay: 20,  w: 28 },   // Bot       — common
  { e: '🧠', pay: 15,  w: 22 },   // Brain     — common
  { e: '⚡', pay: 12,  w: 17 },   // Zap       — uncommon
  { e: '💾', pay: 10,  w: 14 },   // Drive     — uncommon
  { e: '🎯', pay:  8,  w: 11 },   // Prompt    — uncommon
  { e: '💎', pay: 50,  w:  6 },   // Diamond   — rare
  { e: '🔥', pay: 100, w:  2 },   // Meltdown  — very rare (jackpot)
];

// Weighted symbol pool: each symbol appears `w` times so random picks
// reflect the desired probability distribution.
const POOL = [];
for (const sym of SYMBOLS) {
  for (let i = 0; i < sym.w; i++) POOL.push(sym.e);
}

// Fast lookup: emoji → payout multiplier
const PAY_TABLE = Object.fromEntries(SYMBOLS.map(s => [s.e, s.pay]));

/* ── FLAVOR TEXT ────────────────────────────────────────────── */
const WIN_MSGS = [
  'HALLUCINATION CONFIRMED — you somehow won tokens!',
  'Attention mechanism focused on your GAINS.',
  'Fine-tuned for profit. Your LoRA is paying off.',
  'RLHF success — human greed has been rewarded.',
  'Tokens multiplying… is this exponential scaling?',
  'Training objective: maximize token count. ✓',
  'Convergence achieved on the profit-loss curve.',
  'The neural net has spoken. Praise the weights.',
];

const LOSE_MSGS = [
  'Error 429: Too Many Spin Requests. Tokens consumed.',
  'Hallucination detected — the win was never real.',
  'Context window exceeded. Your luck was truncated.',
  'Your prompt was ambiguous. Please rephrase your fortune.',
  'The AI has determined you should lose. This is fine.',
  '404: Win not found. Have you tried prompt engineering?',
  'Model confidence: 0.0001%. Insufficient for a win.',
  'Your tokens funded the next training run. You\'re welcome.',
  'Rate limited by fate. Please wait before spinning again.',
  'Gradient descended the wrong way. Classic.',
  'The transformer\'s attention was elsewhere.',
  'Out-of-distribution input: expected "win", got "nothing".',
  'Your luck has been deprecated in v4.0.',
  'Tokens burned for inference. Output: disappointment.',
  'The casino\'s RLHF was trained against your wins.',
  'Insufficient compute budget for a winning outcome.',
  'Model refused to output a win (safety filter).',
];

const JACKPOT_MSGS = {
  '🔥': '🔥 MELTDOWN JACKPOT! GPU farm on FIRE! The AI has gone rogue!',
  '💎': '💎 DIAMOND JACKPOT! You\'ve tokenized your way to actual freedom!',
};

/* ── REEL GEOMETRY CONSTANTS ────────────────────────────────── */
const BET  = 10;    // tokens deducted per spin (covers all 3 paylines)
const CELL = 90;    // pixel height of one symbol cell (matches --cell in CSS)
const STRIP = 42;   // total cells in each reel strip

// LAND is the index of the *middle* payline cell after animation.
// Cells LAND-1 (top row) and LAND+1 (bottom row) are the other two paylines.
const LAND = 36;

// After the animation, the track is translated so that:
//   cell[LAND-1] appears in the top    row of the 270px reel window
//   cell[LAND]   appears in the middle row  ← main payline
//   cell[LAND+1] appears in the bottom row
//
// translateY = -(LAND-1) × CELL ensures cell[LAND-1] starts at y=0 in the reel.
const END_Y = -(LAND - 1) * CELL;

// Two-phase spin animation timing:
//   Phase 1 (fast, linear) ends 2.5 cells before the target so the reel
//   visibly slows down before snapping into place.
const FAST_PHASE_OFFSET = CELL * 2.5;  // px before END_Y where phase 1 stops
const SLOW_DURATION     = 680;         // ms for the deceleration phase

/* ── GAME STATE ─────────────────────────────────────────────── */
let tokens  = 100;   // current player balance
let burned  = 0;     // cumulative tokens spent
let spins   = 0;     // total spins taken
let wins    = 0;     // number of winning spins
let bestWin = 0;     // largest single-spin payout
let busy    = false; // prevents overlapping spins
let audioCtx = null; // lazily created Web Audio context

/* ── DOM REFERENCES ─────────────────────────────────────────── */
const elBalance = document.getElementById('el-balance');
const elBurned  = document.getElementById('el-burned');
const elMsg     = document.getElementById('el-msg');
const elSpins   = document.getElementById('el-spins');
const elWins    = document.getElementById('el-wins');
const elBest    = document.getElementById('el-best');
const spinBtn   = document.getElementById('spin-btn');
const flashEl   = document.getElementById('flash');
const leverArm  = document.getElementById('lever-arm');
const logEl     = document.getElementById('log-entries');
const clearBtn  = document.getElementById('clear-log');
const themeBtn  = document.getElementById('theme-btn');
const machineEl = document.getElementById('machine');

// Reel track elements (the long scrolling strips)
const tracks = [0, 1, 2].map(i => document.getElementById(`track-${i}`));
// Reel wrapper elements (used for the bounce animation and .winning class)
const reels  = [0, 1, 2].map(i => document.getElementById(`reel-${i}`));
// Payline row overlay elements for visual win highlighting
const rowOverlays    = [0, 1, 2].map(i => document.getElementById(`row-${i}`));
// Payline sidebar labels
const paylineLabels  = [0, 1, 2].map(i => document.getElementById(`pl-label-${i}`));

/* ── UTILITY HELPERS ────────────────────────────────────────── */

// Returns a random symbol emoji from the weighted pool
function randomSymbol() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

// Returns a random element from any array
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ── REEL STRIP BUILDER ─────────────────────────────────────── */
// Populates a reel track with STRIP cells.
// The three payline positions get predetermined symbols;
// every other cell gets a random symbol from the pool.
// Parameters:
//   track  — the .reel-track DOM element
//   topSym — emoji for the top payline row    (cell index LAND-1)
//   midSym — emoji for the middle payline row (cell index LAND)
//   botSym — emoji for the bottom payline row (cell index LAND+1)
function buildStrip(track, topSym, midSym, botSym) {
  track.innerHTML = '';
  for (let i = 0; i < STRIP; i++) {
    const cell = document.createElement('div');
    cell.className = 'reel-cell';

    if      (i === LAND - 1) cell.textContent = topSym;   // top row result
    else if (i === LAND)     cell.textContent = midSym;   // middle row result
    else if (i === LAND + 1) cell.textContent = botSym;   // bottom row result
    else                     cell.textContent = randomSymbol(); // filler

    track.appendChild(cell);
  }
}

/* ── INITIAL REEL POPULATION ────────────────────────────────── */
// Fill reels with random symbols at rest position before first spin.
tracks.forEach(t => {
  const s = randomSymbol();
  buildStrip(t, randomSymbol(), s, randomSymbol());
  t.style.transform = `translateY(${END_Y}px)`;
});

/* ── REEL SPIN ANIMATION (two-phase slowdown) ───────────────── */
// Spins a single reel and resolves the returned Promise when it stops.
//
// Two-phase animation for a realistic deceleration effect:
//   Phase 1 — linear (fast): strip scrolls from 0 to (END_Y + FAST_PHASE_OFFSET)
//   Phase 2 — ease-out (slow): strip crawls the remaining FAST_PHASE_OFFSET to END_Y
//
// The stagger parameter delays phase 1 start so reels stop left-to-right.
function spinReel(idx, topSym, midSym, botSym) {
  return new Promise(resolve => {
    const track = tracks[idx];

    // Cancel any in-progress animation on this track
    for (const anim of track.getAnimations()) anim.cancel();

    // Rebuild the strip with the predetermined result symbols
    buildStrip(track, topSym, midSym, botSym);

    // Snap the track back to the top (no transition, instant)
    track.style.transition = 'none';
    track.style.transform  = 'translateY(0)';

    // Force a layout flush so the browser registers the reset before animating
    track.getBoundingClientRect();

    // --- PHASE 1: Fast linear scroll ---
    // Duration increases per reel index to create a staggered stop sequence.
    const fastDuration = 1300 + idx * 380;           // ms
    const fastEndY     = END_Y + FAST_PHASE_OFFSET;  // px (still negative)

    const phase1 = track.animate(
      [
        { transform: 'translateY(0px)' },
        { transform: `translateY(${fastEndY}px)` },
      ],
      { duration: fastDuration, easing: 'linear', fill: 'forwards' }
    );

    phase1.addEventListener('finish', () => {
      // Commit the phase-1 end position as an inline style so phase 2 starts cleanly
      track.style.transform = `translateY(${fastEndY}px)`;
      phase1.cancel();

      // --- PHASE 2: Slow deceleration into final position ---
      // cubic-bezier chosen so the reel decelerates smoothly then snaps to rest.
      const phase2 = track.animate(
        [
          { transform: `translateY(${fastEndY}px)` },
          { transform: `translateY(${END_Y}px)` },
        ],
        { duration: SLOW_DURATION, easing: 'cubic-bezier(0.12, 0.82, 0.36, 1)', fill: 'forwards' }
      );

      phase2.addEventListener('finish', () => {
        // Lock in the final position as inline style and clean up WAAPI
        track.style.transform = `translateY(${END_Y}px)`;
        phase2.cancel();

        // Short vertical bounce on the reel cabinet to simulate physical impact
        reels[idx].animate(
          [{ transform: 'scaleY(1.04)' }, { transform: 'scaleY(1)' }],
          { duration: 120, easing: 'ease-out' }
        );

        playClick(); // mechanical "thunk" sound
        resolve();   // signal that this reel has finished
      });
    });
  });
}

/* ── PAYLINE EVALUATION ─────────────────────────────────────── */
// Given a row of three symbols [a, b, c], returns the token payout.
// Returns 0 for no match, BET×1.5 for any pair, BET×pay[sym] for 3-of-a-kind.
function evaluateLine(row) {
  const [a, b, c] = row;
  if (a === b && b === c) {
    // Three-of-a-kind: use the paytable multiplier for that symbol
    return BET * (PAY_TABLE[a] ?? 5);
  }
  if (a === b || b === c || a === c) {
    // Any pair: small consolation payout
    return Math.round(BET * 1.5);
  }
  return 0;
}

/* ── MAIN SPIN FUNCTION ─────────────────────────────────────── */
async function spin() {
  if (busy) return;
  if (tokens < BET) {
    setMsg('Insufficient tokens — the model can\'t run on vibes.', 'lose');
    return;
  }

  busy = true;
  spinBtn.disabled = true;

  // Deduct bet and update counters
  tokens -= BET;
  burned += BET;
  spins++;
  updateUI();

  // Reset all win highlights from the previous spin
  reels.forEach(r => r.classList.remove('winning'));
  rowOverlays.forEach(o => o.classList.remove('win'));
  paylineLabels.forEach(l => l.classList.remove('win'));

  setMsg('Generating tokens… billing in progress…', '');

  // Pre-determine result symbols for all three rows on each reel:
  //   results[row][reel]
  const results = [
    [randomSymbol(), randomSymbol(), randomSymbol()], // top row
    [randomSymbol(), randomSymbol(), randomSymbol()], // middle row
    [randomSymbol(), randomSymbol(), randomSymbol()], // bottom row
  ];

  // Play the mechanical spin-start sound
  playSpinStart();

  // Spin all three reels concurrently; each resolves when it stops
  await Promise.all([0, 1, 2].map(reelIdx =>
    spinReel(
      reelIdx,
      results[0][reelIdx],  // top row symbol on this reel
      results[1][reelIdx],  // middle row symbol on this reel
      results[2][reelIdx],  // bottom row symbol on this reel
    )
  ));

  // ── EVALUATE ALL THREE PAYLINES ──────────────────────────────
  let totalPayout = 0;
  let bestKind    = 'lose'; // 'lose' | 'win' | 'jackpot'

  for (let rowIdx = 0; rowIdx < 3; rowIdx++) {
    const rowSymbols = results[rowIdx]; // [left, center, right]
    const linePayout = evaluateLine(rowSymbols);

    if (linePayout > 0) {
      totalPayout += linePayout;

      // Highlight the winning row overlay and label
      rowOverlays[rowIdx].classList.add('win');
      paylineLabels[rowIdx].classList.add('win');

      // Highlight the reel columns that contributed to this win
      const [a, b, c] = rowSymbols;
      if (a === b && b === c) {
        // All three reels match — light up all of them
        reels.forEach(r => r.classList.add('winning'));
      } else {
        // Pair: highlight the two matching reels
        if (a === b) { reels[0].classList.add('winning'); reels[1].classList.add('winning'); }
        if (b === c) { reels[1].classList.add('winning'); reels[2].classList.add('winning'); }
        if (a === c) { reels[0].classList.add('winning'); reels[2].classList.add('winning'); }
      }

      // Determine the highest "kind" across all winning lines
      const isJackpot = linePayout >= BET * 50;
      if (isJackpot)           bestKind = 'jackpot';
      else if (bestKind !== 'jackpot') bestKind = 'win';
    }
  }

  // ── APPLY PAYOUT & UPDATE STATE ─────────────────────────────
  tokens += totalPayout;
  if (totalPayout > 0) {
    wins++;
    if (totalPayout > bestWin) bestWin = totalPayout;
  }
  updateUI();

  // Show the result message + trigger visual/audio FX
  showResult(results[1], totalPayout, bestKind); // pass middle row as the "headline" result

  // ── ADD TO SPIN HISTORY LOG ──────────────────────────────────
  addLogEntry(spins, results[1], totalPayout, bestKind);

  busy = false;

  // Bankrupt check — offer a reset
  if (tokens < BET) {
    spinBtn.textContent = '💸 BANKRUPT — CLICK TO RESET';
    spinBtn.disabled = false;
    spinBtn.onclick = resetGame;
  } else {
    spinBtn.disabled = false;
  }
}

/* ── RESULT FX ──────────────────────────────────────────────── */
// Triggers the appropriate message, flash color, particles, and audio
// based on whether the spin was a jackpot, regular win, or loss.
function showResult(middleRow, payout, kind) {
  if (kind === 'jackpot') {
    const sym = middleRow[0]; // all three match, so index 0 is the symbol
    setMsg(JACKPOT_MSGS[sym] ?? `JACKPOT! ${sym}${sym}${sym} — ${payout} tokens!`, 'jackpot');
    triggerFlash('#f59e0b');
    burstParticles(['💎','⚡','🤑','💰','🔥','🎉','🪙']);
    coinBurst(30);  // showering coins
    machineEl.classList.add('celebrating');
    setTimeout(() => machineEl.classList.remove('celebrating'), 3000);
    playJackpot();
  } else if (kind === 'win') {
    setMsg(`+${payout} tokens! ${pick(WIN_MSGS)}`, 'win');
    triggerFlash('#10b981');
    coinBurst(12);  // a satisfying handful of coins
    playWin();
  } else {
    setMsg(pick(LOSE_MSGS), 'lose');
    playLose();
  }
}

function setMsg(text, cls) {
  elMsg.className = 'msg ' + cls;
  elMsg.textContent = text;
}

/* ── UI UPDATE ──────────────────────────────────────────────── */
function updateUI() {
  elBalance.innerHTML = `${tokens} <small>tokens</small>`;
  elBurned.textContent = burned;
  elSpins.textContent  = spins;
  elWins.textContent   = wins;
  elBest.textContent   = bestWin;
}

/* ── GAME RESET ─────────────────────────────────────────────── */
// Restores all state to initial values and rebuilds the reels.
function resetGame() {
  tokens = 100; burned = 0; spins = 0; wins = 0; bestWin = 0; busy = false;

  spinBtn.textContent = '🎰 SPIN';
  spinBtn.onclick     = spin;        // restore normal click handler
  spinBtn.disabled    = false;

  reels.forEach(r => r.classList.remove('winning'));
  rowOverlays.forEach(o => o.classList.remove('win'));
  paylineLabels.forEach(l => l.classList.remove('win'));

  tracks.forEach(t => {
    buildStrip(t, randomSymbol(), randomSymbol(), randomSymbol());
    t.style.transform = `translateY(${END_Y}px)`;
  });

  updateUI();
  setMsg('Tokens refreshed. The AI casino is ready to consume them again.', '');
}

/* ── LEVER INTERACTION ──────────────────────────────────────── */
// Tracks whether the lever is mid-pull to prevent double-triggering
let leverBusy = false;

// Pulling the lever animates it down then springs it back, then triggers spin
function handleLeverPull(e) {
  if (busy || leverBusy) return;
  leverBusy = true;

  // Visual: arm rotates to "pulled" position
  leverArm.classList.add('pulled');

  // Spring back after a short delay
  setTimeout(() => {
    leverArm.classList.remove('pulled');
  }, 350);

  // Trigger spin slightly after the pull animation starts (feels physical)
  setTimeout(() => {
    leverBusy = false;
    spin();
  }, 180);
}

// Respond to both mouse and touch so the lever works on mobile too
leverArm.addEventListener('mousedown',  handleLeverPull);
leverArm.addEventListener('touchstart', handleLeverPull, { passive: true });

/* ── SPIN LOG ───────────────────────────────────────────────── */
// Prepends a new entry to the history log showing the spin result.
// middleRow is [leftSym, centerSym, rightSym] for the main payline.
function addLogEntry(spinNum, middleRow, payout, kind) {
  // Remove the "no spins yet" placeholder on first entry
  const empty = logEl.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${kind}`;

  const numEl = document.createElement('span');
  numEl.className = 'log-num';
  numEl.textContent = `#${spinNum}`;

  const symEl = document.createElement('span');
  symEl.className = 'log-syms';
  // Display the three middle-row symbols separated by thin spaces
  symEl.textContent = middleRow.join(' ');

  const resEl = document.createElement('span');
  resEl.className = 'log-result';
  if (payout > 0) {
    resEl.textContent = `+${payout}`;
  } else {
    resEl.textContent = `−${BET}`;
  }

  entry.appendChild(numEl);
  entry.appendChild(symEl);
  entry.appendChild(resEl);

  // Newest spin appears at the top
  logEl.insertBefore(entry, logEl.firstChild);
}

clearBtn.addEventListener('click', () => {
  logEl.innerHTML = '<p class="log-empty">History cleared.</p>';
});

/* ── VISUAL FX ──────────────────────────────────────────────── */

// Brief full-viewport color flash
function triggerFlash(color) {
  flashEl.style.background = color;
  flashEl.animate(
    [{ opacity: 0.32 }, { opacity: 0 }],
    { duration: 560, easing: 'ease-out', fill: 'forwards' }
  );
}

// Generic emoji particle burst (used for jackpot)
function burstParticles(emojis) {
  for (let i = 0; i < 22; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.className = 'particle';
      p.textContent = pick(emojis);
      p.style.left = (8 + Math.random() * 84) + '%';
      p.style.top  = (15 + Math.random() * 55) + '%';
      document.body.appendChild(p);

      p.animate(
        [
          { transform: 'translateY(0) rotate(0deg) scale(1)',    opacity: 1 },
          {
            transform: `translateY(${-90 - Math.random() * 90}px) rotate(${(Math.random() - 0.5) * 720}deg) scale(0.3)`,
            opacity: 0,
          },
        ],
        { duration: 600 + Math.random() * 500, easing: 'ease-out', fill: 'forwards' }
      ).onfinish = () => p.remove();
    }, i * 38);
  }
}

// Coin shower: gold coins arc upward from the machine area on any win
function coinBurst(count) {
  const machineRect = machineEl.getBoundingClientRect();
  const originX     = machineRect.left + machineRect.width  * 0.5;
  const originY     = machineRect.top  + machineRect.height * 0.5;

  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const coin = document.createElement('div');
      coin.className = 'coin-particle';
      coin.textContent = '🪙';

      // Start from a random horizontal position across the machine face
      const startX = machineRect.left + machineRect.width * (0.15 + Math.random() * 0.7);
      coin.style.left = startX + 'px';
      coin.style.top  = originY + 'px';
      document.body.appendChild(coin);

      // Each coin flies at a random upward angle with slight spread
      const angleDeg  = -60 - Math.random() * 60;     // −60° to −120° (upward arc)
      const distance  = 80  + Math.random() * 130;    // px
      const rad       = angleDeg * (Math.PI / 180);
      const dx = Math.cos(rad) * distance;
      const dy = Math.sin(rad) * distance;

      coin.animate(
        [
          {
            transform: 'translate(0, 0) rotate(0deg) scale(1)',
            opacity: 1,
          },
          {
            transform: `translate(${dx}px, ${dy}px) rotate(${540 + Math.random() * 360}deg) scale(0.4)`,
            opacity: 0,
          },
        ],
        {
          duration: 700 + Math.random() * 500,
          easing: 'ease-out',
          fill: 'forwards',
        }
      ).onfinish = () => coin.remove();
    }, i * 55);
  }
}

/* ── MACHINE LIGHTS SETUP ───────────────────────────────────── */
// Inject 10 LED light elements across the top of the machine cabinet
(function buildLights() {
  const lightsContainer = document.getElementById('machine-lights');
  for (let i = 0; i < 10; i++) {
    const light = document.createElement('div');
    light.className = 'light';
    // Stagger the CSS animation so they don't all pulse in sync
    light.style.animationDelay = (i * 0.18) + 's';
    lightsContainer.appendChild(light);
  }
})();

/* ── WEB AUDIO SOUNDS ───────────────────────────────────────── */
// All audio uses the Web Audio API (no files needed).
// The AudioContext is created lazily on first user interaction
// to comply with browsers' autoplay policy.

// Returns (or creates) the shared AudioContext
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// Low-level helper: creates an oscillator + gain envelope and connects it.
// Parameters: ctx, freq (Hz), startT (sec), dur (sec), vol (0-1), wave type
function scheduleNote(ctx, freq, startT, dur, vol = 0.15, type = 'sine') {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);

  // Short attack then exponential decay
  gain.gain.setValueAtTime(0, startT);
  gain.gain.linearRampToValueAtTime(vol, startT + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

  osc.start(startT);
  osc.stop(startT + dur + 0.05);
}

// Mechanical click when a reel stops
function playClick() {
  try {
    const ctx = getAudioCtx();
    scheduleNote(ctx, 190, ctx.currentTime, 0.055, 0.12, 'square');
  } catch (_) {}
}

// Whoosh + rising tone played when the spin begins
function playSpinStart() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;

    // Short white-noise burst (mechanical whirr)
    const bufLen  = ctx.sampleRate * 0.12;
    const buffer  = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data    = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.25;

    const noise      = ctx.createBufferSource();
    noise.buffer     = buffer;
    const noiseGain  = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.18, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    noise.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + 0.2);

    // Rising oscillator to suggest the reels spinning up
    scheduleNote(ctx, 90,  t + 0.04, 0.28, 0.08, 'sawtooth');
    scheduleNote(ctx, 130, t + 0.12, 0.20, 0.06, 'sawtooth');
  } catch (_) {}
}

// Ascending four-note win chime
function playWin() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) =>
      scheduleNote(ctx, freq, t + i * 0.1, 0.22)
    );
  } catch (_) {}
}

// Energetic eight-note jackpot fanfare
function playJackpot() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    [523, 587, 659, 784, 880, 988, 1047, 1319].forEach((freq, i) =>
      scheduleNote(ctx, freq, t + i * 0.07, 0.32, 0.2)
    );
  } catch (_) {}
}

// Descending sawtooth "wah-wah" for a loss
function playLose() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    osc.start(t);
    osc.stop(t + 0.42);
  } catch (_) {}
}

/* ── THEME CYCLING ──────────────────────────────────────────── */
// Three themes cycle in order; each click advances to the next.
const THEMES = ['default', 'hc-dark', 'hc-light'];
const THEME_LABELS = ['🎨 Theme: Default', '🎨 Theme: HC Dark', '🎨 Theme: HC Light'];
let themeIdx = 0;

themeBtn.addEventListener('click', () => {
  themeIdx = (themeIdx + 1) % THEMES.length;
  document.documentElement.setAttribute('data-theme', THEMES[themeIdx]);
  themeBtn.textContent = THEME_LABELS[themeIdx];
});

/* ── ANIMATED STARFIELD BACKGROUND ─────────────────────────── */
// Renders 130 softly twinkling stars on the canvas that sits behind the UI.
(function starfield() {
  const canvas = document.getElementById('canvas-bg');
  const ctx    = canvas.getContext('2d');
  let W, H;

  function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  // Each star: normalized position (0-1), radius, current alpha, alpha velocity
  const stars = Array.from({ length: 130 }, () => ({
    x:  Math.random(),
    y:  Math.random(),
    r:  0.3 + Math.random() * 1.3,
    a:  Math.random(),
    da: (Math.random() - 0.5) * 0.007,   // twinkle rate
  }));

  (function frame() {
    ctx.clearRect(0, 0, W, H);

    for (const star of stars) {
      // Bounce alpha between 0.05 and 0.9 so stars twinkle but never disappear
      star.a += star.da;
      if (star.a < 0.05 || star.a > 0.88) star.da *= -1;

      ctx.beginPath();
      ctx.arc(star.x * W, star.y * H, star.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190, 170, 255, ${star.a})`;
      ctx.fill();
    }

    requestAnimationFrame(frame);
  })();
})();

/* ── EVENT WIRING ───────────────────────────────────────────── */
// Attach the primary spin button to the spin function.
// The lever has its own handler registered above (handleLeverPull).
spinBtn.addEventListener('click', spin);
