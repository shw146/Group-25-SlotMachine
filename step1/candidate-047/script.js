'use strict';

// ── Symbols ────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { id: 'robot',   emoji: '🤖', label: 'Robot',      weight: 6 },
  { id: 'brain',   emoji: '🧠', label: 'Brain',      weight: 8 },
  { id: 'gpu',     emoji: '💻', label: 'GPU',        weight: 8 },
  { id: 'token',   emoji: '🪙', label: 'Token',      weight: 10 },
  { id: 'chart',   emoji: '📊', label: 'Chart',      weight: 10 },
  { id: 'prompt',  emoji: '💬', label: 'Prompt',     weight: 12 },
  { id: 'fire',    emoji: '🔥', label: 'Fire',       weight: 7 },
  { id: 'star',    emoji: '⭐', label: 'Star',       weight: 5 },
  { id: 'halluc',  emoji: '👻', label: 'Hallucination', weight: 9 },
];

// ── Pay Table (3-of-a-kind multipliers) ────────────────────────────────────
const PAY_TABLE = [
  { ids: ['robot'],  mult: 50,  label: 'JACKPOT — Skynet is real' },
  { ids: ['star'],   mult: 30,  label: 'MEGA WIN — 5-star review' },
  { ids: ['fire'],   mult: 20,  label: 'BURNING GPU — hot tokens' },
  { ids: ['brain'],  mult: 15,  label: 'NEURAL NET ALIGNED' },
  { ids: ['gpu'],    mult: 12,  label: 'COMPUTE HOARD' },
  { ids: ['token'],  mult: 10,  label: 'TOKEN WINDFALL' },
  { ids: ['chart'],  mult: 8,   label: 'DATA BULLRUN' },
  { ids: ['prompt'], mult: 6,   label: 'PERFECT PROMPT' },
  { ids: ['halluc'], mult: 4,   label: 'HALLUCINATED WIN' },
  // Any two of same kind (partial)
  { ids: ['any2'],   mult: 1.5, label: 'PARTIAL CONTEXT' },
];

// Funny messages on losing
const LOSE_QUIPS = [
  'Inference failed. Try again.',
  'Your tokens have been burned.',
  'The model confidently predicted wrong.',
  'Hallucination detected — no payout.',
  'Context window closed. No match.',
  'Training data not found.',
  'RLHF penalized this spin.',
  'Alignment failed. Tokens lost.',
  'Out of compute budget.',
  'Fine-tuning required.',
  'Rate limited. Tokens charged anyway.',
  'GPT-4 would have won this.',
  'Response filtered by safety guardrails.',
  'Token budget exceeded. Wallet trimmed.',
];

const WIN_QUIPS = [
  'Inference succeeded!',
  'Model converged!',
  'Prompt engineered to perfection.',
  'Reward model is pleased.',
  'Tokens flowing in!',
  'Zero-shot win!',
];

// ── State ───────────────────────────────────────────────────────────────────
let tokens     = 100;
let bet        = 10;
let totalWon   = 0;
let spinning   = false;
let spinCount  = 0;

// Final symbol index per reel (what the reel lands on)
const reelResults = [0, 0, 0];

// ── DOM ─────────────────────────────────────────────────────────────────────
const tokenCountEl   = document.getElementById('tokenCount');
const betAmountEl    = document.getElementById('betAmount');
const spinCostLabel  = document.getElementById('spinCostLabel');
const totalWonEl     = document.getElementById('totalWon');
const resultTextEl   = document.getElementById('resultText');
const spinBtn        = document.getElementById('spinBtn');
const logList        = document.getElementById('logList');
const modalOverlay   = document.getElementById('modalOverlay');
const modalIcon      = document.getElementById('modalIcon');
const modalTitle     = document.getElementById('modalTitle');
const modalMsg       = document.getElementById('modalMsg');
const modalBtn       = document.getElementById('modalBtn');
const machineEl      = document.querySelector('.machine');
const reelsWindow    = document.querySelector('.reels-window');

// ── Weighted random ─────────────────────────────────────────────────────────
function weightedRandom() {
  const total = SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
  let r = Math.random() * total;
  for (const sym of SYMBOLS) {
    r -= sym.weight;
    if (r <= 0) return sym;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

// ── Build Reel Strips ───────────────────────────────────────────────────────
function buildReels() {
  for (let r = 0; r < 3; r++) {
    const strip = document.getElementById(`reelStrip${r}`);
    strip.innerHTML = '';
    // Populate with ~30 symbols (looped for smooth spin illusion)
    for (let i = 0; i < 30; i++) {
      const sym = SYMBOLS[i % SYMBOLS.length];
      const div = document.createElement('div');
      div.className = 'symbol';
      div.textContent = sym.emoji;
      div.dataset.id = sym.id;
      strip.appendChild(div);
    }
  }
}

// ── Spin Animation ──────────────────────────────────────────────────────────
const SPIN_DURATION = [900, 1100, 1350]; // ms per reel

function spinReel(reelIndex, result) {
  return new Promise(resolve => {
    const strip     = document.getElementById(`reelStrip${reelIndex}`);
    const container = document.getElementById(`reel${reelIndex}`);
    const h         = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--symbol-h'));

    // Build a fresh long strip ending with the result symbol
    strip.innerHTML = '';
    const items = [];
    // Random spin symbols (extras before landing)
    const extraCount = 20 + Math.floor(Math.random() * 10);
    for (let i = 0; i < extraCount; i++) {
      items.push(weightedRandom());
    }
    // The result symbol at the end
    items.push(result);

    items.forEach(sym => {
      const div = document.createElement('div');
      div.className = 'symbol';
      div.textContent = sym.emoji;
      div.dataset.id = sym.id;
      strip.appendChild(div);
    });

    const totalHeight = items.length * h;
    const targetOffset = totalHeight - h; // land on the last symbol

    // Start from top
    strip.style.transition = 'none';
    strip.style.transform  = 'translateY(0)';

    // Force reflow
    void strip.offsetHeight;

    const dur = SPIN_DURATION[reelIndex];
    strip.style.transition = `transform ${dur}ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
    strip.style.transform  = `translateY(-${targetOffset}px)`;

    setTimeout(resolve, dur + 50);
  });
}

// ── Evaluate Result ─────────────────────────────────────────────────────────
function evaluate(syms) {
  const ids = syms.map(s => s.id);

  // Check three-of-a-kind
  if (ids[0] === ids[1] && ids[1] === ids[2]) {
    const entry = PAY_TABLE.find(p => p.ids[0] === ids[0] && p.ids.length === 1);
    if (entry) return { type: 'win3', mult: entry.mult, label: entry.label };
    return { type: 'win3', mult: 5, label: 'THREE OF A KIND' };
  }

  // Check any two-of-a-kind
  if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) {
    return { type: 'win2', mult: 1.5, label: PAY_TABLE.find(p => p.ids[0] === 'any2').label };
  }

  return { type: 'lose', mult: 0, label: null };
}

// ── Update UI ───────────────────────────────────────────────────────────────
function updateWallet() {
  tokenCountEl.textContent  = tokens;
  totalWonEl.textContent    = totalWon;
  betAmountEl.textContent   = bet;
  spinCostLabel.textContent = bet;
}

function setResult(text, cls) {
  resultTextEl.className = 'result-text ' + (cls || '');
  resultTextEl.textContent = text;
}

function addLog(msg, cls) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.classList.add(cls);
  logList.prepend(li);
  // Keep log manageable
  while (logList.children.length > 40) logList.lastChild.remove();
}

// ── Lights Animation ────────────────────────────────────────────────────────
let lightInterval = null;
const allLights = () => document.querySelectorAll('.light');
const LIGHT_COLORS = ['on-gold', 'on-purple', 'on-green'];

function startLights() {
  const lights = [...allLights()];
  let tick = 0;
  lightInterval = setInterval(() => {
    lights.forEach((l, i) => {
      l.className = 'light';
      if ((i + tick) % 3 === 0) l.classList.add(LIGHT_COLORS[tick % 3]);
    });
    tick++;
  }, 100);
}

function stopLights(color = null) {
  clearInterval(lightInterval);
  lightInterval = null;
  allLights().forEach(l => {
    l.className = 'light';
    if (color) l.classList.add(color);
  });
}

// ── Spin Handler ─────────────────────────────────────────────────────────────
async function doSpin() {
  if (spinning) return;
  if (tokens < bet) {
    showModal('💸', 'Insufficient Tokens', 'You have been rate-limited by poverty. Add more tokens or reduce your bet.');
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  spinCount++;

  // Deduct bet
  tokens -= bet;
  updateWallet();

  setResult('Sampling from distribution...', 'spin');

  // Pick results
  const results = [weightedRandom(), weightedRandom(), weightedRandom()];

  // Animate lights
  startLights();

  // Spin reels (cascade)
  await Promise.all([
    spinReel(0, results[0]),
    spinReel(1, results[1]),
    spinReel(2, results[2]),
  ]);

  stopLights();

  // Evaluate
  const outcome = evaluate(results);

  if (outcome.type === 'lose') {
    const quip = LOSE_QUIPS[Math.floor(Math.random() * LOSE_QUIPS.length)];
    setResult(quip, 'lose');
    addLog(`Spin #${spinCount}: ${results.map(s => s.emoji).join(' ')} — Lost ${bet} tokens. ${quip}`, 'log-lose');
    stopLights('');
  } else {
    const payout = Math.floor(bet * outcome.mult);
    tokens   += payout;
    totalWon += payout;
    updateWallet();

    const quip = WIN_QUIPS[Math.floor(Math.random() * WIN_QUIPS.length)];
    const profit = payout - bet;

    setResult(`${outcome.label} — +${payout} tokens! ${quip}`, 'win');
    addLog(`Spin #${spinCount}: ${results.map(s => s.emoji).join(' ')} — Won ${payout} tokens (×${outcome.mult}). ${outcome.label}`, 'log-win');

    // Flash the window
    reelsWindow.classList.add('winning');
    setTimeout(() => reelsWindow.classList.remove('winning'), 1200);

    // Jackpot
    if (outcome.mult >= 20) {
      machineEl.classList.add('jackpot');
      setTimeout(() => machineEl.classList.remove('jackpot'), 1100);
      stopLights('on-gold');
      setTimeout(() => stopLights(''), 2000);
    } else {
      stopLights('on-green');
      setTimeout(() => stopLights(''), 1000);
    }
  }

  // Check broke
  if (tokens <= 0) {
    setTimeout(() => {
      showModal('🪦', 'Bankrupt', 'You have run out of tokens. The AI has consumed your entire context budget. Refresh to try again.');
    }, 600);
  }

  spinning = false;
  spinBtn.disabled = false;
}

// ── Modal ────────────────────────────────────────────────────────────────────
function showModal(icon, title, msg) {
  modalIcon.textContent  = icon;
  modalTitle.textContent = title;
  modalMsg.textContent   = msg;
  modalOverlay.hidden    = false;
}

modalBtn.addEventListener('click', () => {
  modalOverlay.hidden = true;
  if (tokens <= 0) {
    tokens   = 100;
    totalWon = 0;
    spinCount = 0;
    logList.innerHTML = '';
    updateWallet();
    setResult('Tokens recharged. Inference resumed.', '');
  }
});

// ── Bet Controls ─────────────────────────────────────────────────────────────
document.getElementById('betDown').addEventListener('click', () => {
  if (bet > 5) { bet = Math.max(5, bet - 5); updateWallet(); }
});
document.getElementById('betUp').addEventListener('click', () => {
  if (bet < 50) { bet = Math.min(50, bet + 5); updateWallet(); }
});

// ── Paytable Render ───────────────────────────────────────────────────────────
function renderPaytable() {
  const grid = document.getElementById('paytable');
  grid.innerHTML = '';

  const rows = [
    { emojis: '🤖🤖🤖', label: 'Skynet Jackpot',   mult: '×50' },
    { emojis: '⭐⭐⭐', label: 'Mega Win',          mult: '×30' },
    { emojis: '🔥🔥🔥', label: 'Burning GPU',       mult: '×20' },
    { emojis: '🧠🧠🧠', label: 'Neural Net',        mult: '×15' },
    { emojis: '💻💻💻', label: 'Compute Hoard',     mult: '×12' },
    { emojis: '🪙🪙🪙', label: 'Token Windfall',   mult: '×10' },
    { emojis: '📊📊📊', label: 'Data Bullrun',      mult: '×8'  },
    { emojis: '💬💬💬', label: 'Perfect Prompt',    mult: '×6'  },
    { emojis: '👻👻👻', label: 'Hallucinated Win',  mult: '×4'  },
    { emojis: 'XX—',    label: 'Any pair',           mult: '×1.5'},
  ];

  rows.forEach(row => {
    const div = document.createElement('div');
    div.className = 'pay-row';
    div.innerHTML = `
      <span class="pay-symbols">${row.emojis}</span>
      <span>${row.label}</span>
      <span class="pay-mult">${row.mult}</span>
    `;
    grid.appendChild(div);
  });
}

// ── Spin Button ───────────────────────────────────────────────────────────────
spinBtn.addEventListener('click', doSpin);

// Keyboard shortcut: Space or Enter
document.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && !spinning && modalOverlay.hidden) {
    e.preventDefault();
    doSpin();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
buildReels();
renderPaytable();
updateWallet();
stopLights('');

// Idle light pulse
setInterval(() => {
  if (!spinning) {
    allLights().forEach((l, i) => {
      l.className = 'light';
      const on = Math.random() > 0.6;
      if (on) l.classList.add(LIGHT_COLORS[i % 3]);
    });
  }
}, 800);
