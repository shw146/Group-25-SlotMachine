/* =====================================================
   LUCKY SLOTS — slots.js
   All game logic, audio synthesis, animations
   ===================================================== */

/* =====================================================
   SYMBOL CONFIGURATION
   Each symbol has an emoji, a name, and a payout
   multiplier for three-of-a-kind matches.
   ===================================================== */
const SYMBOLS = [
  { emoji: '🍒', name: 'Cherry',   payout: 3   },
  { emoji: '🍋', name: 'Lemon',    payout: 4   },
  { emoji: '🍇', name: 'Grapes',   payout: 6   },
  { emoji: '🔔', name: 'Bell',     payout: 10  },
  { emoji: '⭐', name: 'Star',     payout: 15  },
  { emoji: '💎', name: 'Diamond',  payout: 25  },
  { emoji: '7️⃣', name: 'Seven',    payout: 77  },  // jackpot symbol
];

/* Maximum credits a player can bet per spin */
const MAX_BET = 5;

/* Number of "virtual" spins each reel makes before stopping.
   Higher = more dramatic slowdown. */
const SPIN_CYCLES = [22, 26, 30];   // reel 0 stops first, reel 2 stops last

/* Delay between each reel stopping (ms) — creates the staged stop effect */
const REEL_STOP_DELAY = 600;

/* =====================================================
   AUDIO ENGINE
   Uses the Web Audio API to synthesize all sounds at
   runtime — no audio files needed.
   ===================================================== */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;   // created on first user gesture (browser policy)

/** Lazily initialise the AudioContext on first use */
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

/**
 * Plays a short synthesized tone.
 * @param {number}  freq      Frequency in Hz
 * @param {string}  type      Oscillator type: 'sine'|'square'|'sawtooth'|'triangle'
 * @param {number}  duration  Duration in seconds
 * @param {number}  gain      Volume 0–1
 * @param {number}  startTime AudioContext time offset (for sequencing)
 */
function playTone(freq, type = 'sine', duration = 0.15, gain = 0.3, startTime = 0) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);

  /* Attack–decay envelope so tones don't click */
  env.gain.setValueAtTime(0, ctx.currentTime + startTime);
  env.gain.linearRampToValueAtTime(gain, ctx.currentTime + startTime + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

  osc.connect(env);
  env.connect(ctx.destination);

  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration + 0.01);
}

/** Plays the spinning "whirring" effect — a wobbling sawtooth tone */
function playSpinSound() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(80, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(160, ctx.currentTime + 0.4);
  osc.frequency.linearRampToValueAtTime(80,  ctx.currentTime + 0.9);

  env.gain.setValueAtTime(0.18, ctx.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);

  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 1.0);
}

/** "Thunk" sound for each reel stopping */
function playReelStop(reelIndex) {
  /* Each reel gets a slightly lower pitch so you can hear the sequence */
  const freq = 220 - reelIndex * 30;
  playTone(freq, 'square', 0.12, 0.35);
}

/** Ascending arpeggio on a regular win */
function playWinSound() {
  [523, 659, 784, 1047].forEach((f, i) =>
    playTone(f, 'sine', 0.2, 0.4, i * 0.12)
  );
}

/** Fanfare melody on jackpot win */
function playJackpotSound() {
  const melody = [
    [523,0.0], [659,0.12], [784,0.24], [1047,0.36],
    [1047,0.52],[1047,0.68],[880,0.84],[1047,1.0]
  ];
  melody.forEach(([f, t]) => playTone(f, 'triangle', 0.25, 0.5, t));
}

/** Descending "wah-wah" on loss */
function playLoseSound() {
  [330, 277, 220].forEach((f, i) =>
    playTone(f, 'sawtooth', 0.2, 0.25, i * 0.18)
  );
}

/* =====================================================
   DOM REFERENCES
   ===================================================== */
const creditsEl   = document.getElementById('credits');
const spinBtn     = document.getElementById('spin-btn');
const resultMsg   = document.getElementById('result-msg');
const historyList = document.getElementById('history-list');
const betAmountEl = document.getElementById('bet-amount');
const betDownBtn  = document.getElementById('bet-down');
const betUpBtn    = document.getElementById('bet-up');
const maxBetBtn   = document.getElementById('max-bet');
const winLineEl   = document.getElementById('win-line');
const flashEl     = document.getElementById('flash-overlay');
const coinShower  = document.getElementById('coin-shower');
const leverBall   = document.getElementById('lever-ball');
const leverWrapper= document.getElementById('lever-wrapper');
const payoutBody  = document.getElementById('payout-body');

/* Per-reel cell references: [reelIndex][row: top|center|bot] */
const reelCells = [0, 1, 2].map(i => ({
  top:    document.getElementById(`reel-${i}-top`),
  center: document.getElementById(`reel-${i}-center`),
  bot:    document.getElementById(`reel-${i}-bot`),
  frame:  document.querySelector(`#reel-${i}`).parentElement,  // .reel-frame
}));

/* =====================================================
   GAME STATE
   ===================================================== */
let credits  = 100;
let bet      = 1;
let spinning = false;

/* =====================================================
   INITIALISATION
   ===================================================== */

/** Populate payout table from SYMBOLS config */
function buildPayoutTable() {
  SYMBOLS.forEach(sym => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sym.emoji} ${sym.emoji} ${sym.emoji}</td>
      <td>× ${sym.payout}</td>
    `;
    payoutBody.appendChild(tr);
  });
}

/** Initialise reels with random symbols before first spin */
function initReels() {
  reelCells.forEach(reel => {
    reel.top.textContent    = randomSymbol().emoji;
    reel.center.textContent = randomSymbol().emoji;
    reel.bot.textContent    = randomSymbol().emoji;
  });
}

/** Render current credits & bet to DOM */
function renderUI() {
  creditsEl.textContent  = credits;
  betAmountEl.textContent = bet;
  spinBtn.querySelector('.cost-hint').textContent = `(−${bet})`;

  /* Disable spin if broke or currently spinning */
  spinBtn.disabled = spinning || credits < bet;

  /* Disable lever too */
  leverBall.style.pointerEvents = spinning ? 'none' : 'auto';
}

/* =====================================================
   UTILITY
   ===================================================== */

/** Pick a random symbol, weighted so jackpot symbol is rarest */
function randomSymbol() {
  /* Simple weighted: higher-payout symbols appear less often */
  const weights = SYMBOLS.map(s => Math.max(1, 100 / s.payout));
  const total   = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SYMBOLS.length; i++) {
    r -= weights[i];
    if (r <= 0) return SYMBOLS[i];
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

/** Returns a promise that resolves after `ms` milliseconds */
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/* =====================================================
   CORE SPIN LOGIC
   ===================================================== */

/**
 * Main spin function:
 * 1. Deduct bet, disable controls
 * 2. Spin all three reels simultaneously (fast phase)
 * 3. Slow down and stop reels one-by-one (left → right)
 * 4. Evaluate result, play sound, animate, log history
 */
async function spin() {
  if (spinning || credits < bet) return;
  spinning = true;
  renderUI();

  /* Clear previous result styling */
  resultMsg.textContent = '';
  resultMsg.className   = 'result-message';
  winLineEl.classList.remove('active');
  reelCells.forEach(r => r.center.classList.remove('winner'));

  /* ---- DEDUCT BET ---- */
  credits -= bet;
  renderUI();

  /* ---- PLAY SPIN SOUND ---- */
  playSpinSound();

  /* ---- PRE-DETERMINE FINAL SYMBOLS (fair RNG before animation) ---- */
  const results = [randomSymbol(), randomSymbol(), randomSymbol()];

  /* ---- FAST SPIN PHASE ---- */
  /* Mark all reel frames as spinning (triggers blur CSS) */
  reelCells.forEach(r => r.frame.classList.add('spinning'));

  /* Rapidly shuffle display symbols at 80ms intervals to create spin illusion */
  const fastInterval = setInterval(() => {
    reelCells.forEach(reel => {
      reel.top.textContent    = randomSymbol().emoji;
      reel.center.textContent = randomSymbol().emoji;
      reel.bot.textContent    = randomSymbol().emoji;
    });
  }, 80);

  /* ---- STAGED REEL STOP (slowdown effect) ---- */
  /* Each reel stops after a progressively longer delay (left first, right last) */
  for (let i = 0; i < 3; i++) {
    /* Wait for this reel's stop moment */
    await sleep(SPIN_CYCLES[i] * 80 + i * REEL_STOP_DELAY);

    /* Show slowing-down symbols (random for top/bot, real result for center) */
    reelCells[i].frame.classList.remove('spinning');
    reelCells[i].top.textContent    = randomSymbol().emoji;
    reelCells[i].center.textContent = results[i].emoji;   /* the real result */
    reelCells[i].bot.textContent    = randomSymbol().emoji;

    /* "Thunk" sound as this reel locks in */
    playReelStop(i);

    /* Brief bounce scale for the center cell to emphasise the stop */
    reelCells[i].center.animate(
      [{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' }
    );
  }

  /* Stop the fast shuffle loop after all reels have stopped */
  clearInterval(fastInterval);

  /* ---- EVALUATE RESULT ---- */
  await sleep(200);   /* tiny pause before revealing outcome */
  evaluateResult(results);

  /* ---- RE-ENABLE CONTROLS ---- */
  spinning = false;
  renderUI();
}

/**
 * Checks for three-of-a-kind, partial matches (cherry pair), etc.
 * Updates UI, plays appropriate sound, logs to history.
 */
function evaluateResult(results) {
  const [a, b, c] = results;
  const isThreeOfKind = a.name === b.name && b.name === c.name;
  const isJackpot     = isThreeOfKind && a.name === 'Seven';

  let winAmount = 0;
  let message   = '';
  let cls       = '';

  if (isJackpot) {
    /* JACKPOT — maximum excitement */
    winAmount = bet * a.payout;
    message   = `🎉 JACKPOT! +${winAmount}`;
    cls       = 'jackpot';
    playJackpotSound();
    triggerFlash();
    spawnCoins(60);   /* lots of coins */
    winLineEl.classList.add('active');
    reelCells.forEach(r => r.center.classList.add('winner'));

  } else if (isThreeOfKind) {
    /* Regular three-of-a-kind win */
    winAmount = bet * a.payout;
    message   = `WIN! +${winAmount}`;
    cls       = 'win';
    playWinSound();
    spawnCoins(20);
    winLineEl.classList.add('active');
    reelCells.forEach(r => r.center.classList.add('winner'));

  } else if (a.name === 'Cherry' && b.name === 'Cherry') {
    /* Two cherries on left — consolation prize */
    winAmount = bet * 2;
    message   = `Two Cherries! +${winAmount}`;
    cls       = 'win';
    playWinSound();
    spawnCoins(8);
    winLineEl.classList.add('active');
    reelCells[0].center.classList.add('winner');
    reelCells[1].center.classList.add('winner');

  } else {
    /* Loss */
    message = `No match. −${bet}`;
    cls     = 'loss';
    playLoseSound();
  }

  /* Apply win amount to credits */
  credits += winAmount;

  /* Show result message */
  resultMsg.textContent = message;
  resultMsg.className   = `result-message ${cls}`;

  /* Update credit display (animated count-up on win) */
  if (winAmount > 0) animateCredits(credits - winAmount, credits);
  renderUI();

  /* Log this spin to the history panel */
  addHistoryEntry(results, message, cls);
}

/* =====================================================
   HISTORY LOG
   ===================================================== */

/**
 * Prepends a new entry to the spin history list.
 * Keeps only the 50 most recent entries to avoid memory bloat.
 */
function addHistoryEntry(results, message, cls) {
  const symbols  = results.map(r => r.emoji).join(' ');
  const li       = document.createElement('li');

  li.innerHTML = `
    <span class="h-symbols">${symbols}</span>
    <span class="h-result ${cls}">${message}</span>
  `;

  /* Prepend so newest is at top */
  historyList.insertBefore(li, historyList.firstChild);

  /* Trim old entries beyond 50 */
  while (historyList.children.length > 50) {
    historyList.removeChild(historyList.lastChild);
  }
}

/* =====================================================
   CREDIT COUNT-UP ANIMATION
   Smoothly animates the credits display from `from` to `to`
   ===================================================== */
function animateCredits(from, to) {
  const duration = 600;  /* ms */
  const start    = performance.now();

  function step(now) {
    const elapsed = now - start;
    const t       = Math.min(elapsed / duration, 1);
    /* Ease-out cubic for a satisfying deceleration */
    const eased   = 1 - Math.pow(1 - t, 3);
    creditsEl.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/* =====================================================
   WIN VISUAL EFFECTS
   ===================================================== */

/**
 * Spawns `count` coins that rain down from random positions.
 * Each coin is a <div> absolutely positioned at a random X,
 * then CSS animation drops it to the bottom of the screen.
 */
function spawnCoins(count) {
  for (let i = 0; i < count; i++) {
    const coin = document.createElement('div');
    coin.className = 'coin';
    coin.textContent = '🪙';

    /* Random horizontal start position */
    coin.style.left = `${Math.random() * 96}vw`;

    /* Stagger each coin so they don't all fall at once */
    const delay    = (Math.random() * 1.2).toFixed(2);
    const duration = (0.8 + Math.random() * 1.0).toFixed(2);
    coin.style.setProperty('--fall-delay', `${delay}s`);
    coin.style.setProperty('--fall-dur',   `${duration}s`);

    coinShower.appendChild(coin);

    /* Remove from DOM once animation finishes (no memory leak) */
    const total = (parseFloat(delay) + parseFloat(duration) + 0.1) * 1000;
    setTimeout(() => coin.remove(), total);
  }
}

/**
 * Briefly flashes the entire screen white — a classic jackpot effect.
 */
function triggerFlash() {
  flashEl.classList.remove('flash');
  /* Force reflow so re-adding the class restarts the animation */
  void flashEl.offsetWidth;
  flashEl.classList.add('flash');
}

/* =====================================================
   LEVER INTERACTION
   Supports both click-to-pull and mouse/touch drag.
   ===================================================== */

let leverPulled = false;

/** Animate lever down then up, then trigger spin */
function pullLever() {
  if (leverPulled || spinning || credits < bet) return;
  leverPulled = true;

  leverBall.classList.add('pulled');

  /* After the ball visually reaches the bottom, spring it back up */
  setTimeout(() => {
    leverBall.classList.remove('pulled');

    /* Trigger the spin shortly after the lever snaps back */
    setTimeout(() => {
      leverPulled = false;
      spin();
    }, 150);
  }, 400);
}

/* Click on the lever wrapper triggers a pull */
leverWrapper.addEventListener('click', pullLever);

/* Keyboard accessibility: Enter or Space on lever ball */
leverBall.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pullLever();
  }
});

/* ---- Touch/drag support for the lever ball ---- */
let leverDragStart = null;   /* Y coordinate where drag began */

leverBall.addEventListener('pointerdown', e => {
  e.preventDefault();   /* prevent text selection */
  leverDragStart = e.clientY;
  leverBall.setPointerCapture(e.pointerId);
});

leverBall.addEventListener('pointermove', e => {
  if (leverDragStart === null) return;
  const delta = e.clientY - leverDragStart;

  /* If dragged down more than 40px treat as a pull */
  if (delta > 40 && !leverPulled && !spinning) {
    leverDragStart = null;   /* prevent re-triggering */
    pullLever();
  }
});

leverBall.addEventListener('pointerup', () => { leverDragStart = null; });
leverBall.addEventListener('pointercancel', () => { leverDragStart = null; });

/* =====================================================
   BET CONTROLS
   ===================================================== */

betDownBtn.addEventListener('click', () => {
  if (bet > 1) { bet--; renderUI(); }
});

betUpBtn.addEventListener('click', () => {
  if (bet < MAX_BET && bet < credits) { bet++; renderUI(); }
});

maxBetBtn.addEventListener('click', () => {
  bet = Math.min(MAX_BET, credits);
  renderUI();
});

/* =====================================================
   SPIN BUTTON
   ===================================================== */
spinBtn.addEventListener('click', spin);

/* =====================================================
   KEYBOARD SHORTCUT — Spacebar triggers spin
   ===================================================== */
document.addEventListener('keydown', e => {
  /* Ignore if focus is on a button (prevent double-trigger) */
  if (e.target.tagName === 'BUTTON') return;
  if (e.code === 'Space') {
    e.preventDefault();
    spin();
  }
});

/* =====================================================
   STARTUP
   ===================================================== */
buildPayoutTable();
initReels();
renderUI();
