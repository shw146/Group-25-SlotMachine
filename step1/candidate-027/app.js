'use strict';

// ── Symbols ──────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { id: 'robot',    emoji: '🤖', label: 'Model',    weight: 6 },
  { id: 'token',    emoji: '🪙', label: 'Token',    weight: 8 },
  { id: 'brain',    emoji: '🧠', label: 'Weights',  weight: 6 },
  { id: 'prompt',   emoji: '📝', label: 'Prompt',   weight: 8 },
  { id: 'fire',     emoji: '🔥', label: 'Burnrate', weight: 7 },
  { id: 'cloud',    emoji: '☁️', label: 'GPU Cloud', weight: 7 },
  { id: 'halluc',   emoji: '🎭', label: 'Hallucin', weight: 5 },
  { id: 'diamond',  emoji: '💎', label: 'AGI',       weight: 2 },
];

// ── Pay table: [sym1, sym2, sym3] → { mult, title, quip } ───────────────────
const PAY_TABLE = [
  {
    match: ['diamond', 'diamond', 'diamond'],
    mult: 500,
    title: '🎰 AGI ACHIEVED',
    quip: 'Congratulations! You have achieved AGI.\nPlease wait while we update our safety policy.',
  },
  {
    match: ['robot', 'robot', 'robot'],
    mult: 50,
    title: '🤖 MODEL OVERLOAD',
    quip: 'Three frontier models walk into a bar.\nNone of them can pay — tokens not accepted here.',
  },
  {
    match: ['brain', 'brain', 'brain'],
    mult: 40,
    title: '🧠 FULL WEIGHTS',
    quip: '175 billion parameters... and it still\ncannot remember what you said two messages ago.',
  },
  {
    match: ['halluc', 'halluc', 'halluc'],
    mult: 30,
    title: '🎭 CONFIDENCE: 100%',
    quip: 'The model is absolutely certain.\nAbsolutely certain of something that is completely wrong.',
  },
  {
    match: ['fire', 'fire', 'fire'],
    mult: 25,
    title: '🔥 BURN RATE JACKPOT',
    quip: 'Your inference costs have exceeded your mortgage.\nThis is fine. Everything is fine.',
  },
  {
    match: ['cloud', 'cloud', 'cloud'],
    mult: 20,
    title: '☁️ CLOUD CREDITS',
    quip: 'You have won $200 in cloud credits!\n(Expires in 7 days. GPU quota: 0.)',
  },
  {
    match: ['token', 'token', 'token'],
    mult: 15,
    title: '🪙 TOKEN BONANZA',
    quip: 'You have won tokens! To claim your tokens,\nplease provide tokens as payment.',
  },
  {
    match: ['prompt', 'prompt', 'prompt'],
    mult: 10,
    title: '📝 PROMPT ENGINEER',
    quip: '"Just add more context." — every prompt engineer\nright before the context window fills up.',
  },
  // Two-of-a-kind fallbacks (any matching pair in first two)
  {
    match: ['diamond', 'diamond', null],
    mult: 8,
    title: '💎 ALMOST AGI',
    quip: '"We are six months away." — every AI lab, every year.',
  },
  {
    match: ['robot', 'robot', null],
    mult: 3,
    title: '🤖 TWO MODELS',
    quip: 'Two AI models walk into a bar. The third\none says it was there too, but hallucinated the whole thing.',
  },
  {
    match: ['brain', 'brain', null],
    mult: 3,
    title: '🧠 PARTIAL WEIGHTS',
    quip: 'Quantized to 4-bit. It is basically the same, they said.',
  },
  {
    match: ['token', 'token', null],
    mult: 2,
    title: '🪙 PAIR OF TOKENS',
    quip: 'Enough to generate a comma.',
  },
];

// ── Messages ─────────────────────────────────────────────────────────────────
const SPIN_MESSAGES = [
  'Running inference...',
  'Loading model weights...',
  'Tokenizing input...',
  'Attention is all you need...',
  'Generating next token...',
  'Computing softmax over vocabulary...',
  'Sampling from distribution...',
  'Context window: 99% full',
  'Hallucinating probabilities...',
  'Forward pass in progress...',
  'Consulting the stochastic parrot...',
  'Cross-entropy loss: extremely high',
  'Temperature: 1.0 (maximum chaos)',
  'Embedding your hopes and dreams...',
  'Gradient descent into madness...',
  'Allocating GPU memory... failed',
  'Rate limit: exceeded',
  'Prompt injection detected. Ignoring.',
  'Chain-of-thought: one chain, zero thoughts',
  'RLHF says: no.',
];

const LOSE_MESSAGES = [
  'No output tokens matched.',
  'Loss function: maximum.',
  'The model chose chaos.',
  'Entropy wins again.',
  'Perplexity: ∞',
  'Context not found. Try rephrasing.',
  'Token budget exceeded. Ask your admin.',
  'I could tell you why this lost, but I would be hallucinating.',
  'Softmax selected: bankruptcy.',
  'Model response: "I don\'t know."',
];

// ── State ─────────────────────────────────────────────────────────────────────
let tokens = 100;
let bet = 10;
let totalSpent = 0;
let totalWon = 0;
let totalSpins = 0;
let spinning = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tokenCountEl  = document.getElementById('tokenCount');
const totalSpentEl  = document.getElementById('totalSpent');
const totalWonEl    = document.getElementById('totalWon');
const totalSpinsEl  = document.getElementById('totalSpins');
const betAmountEl   = document.getElementById('betAmount');
const messageBarEl  = document.getElementById('messageBar');
const spinBtn       = document.getElementById('spinBtn');
const betDown       = document.getElementById('betDown');
const betUp         = document.getElementById('betUp');
const maxBetBtn     = document.getElementById('maxBet');
const winOverlay    = document.getElementById('winOverlay');
const winTitle      = document.getElementById('winTitle');
const winAmountEl   = document.getElementById('winAmount');
const winQuip       = document.getElementById('winQuip');
const dismissWin    = document.getElementById('dismissWin');
const brokeOverlay  = document.getElementById('brokeOverlay');
const refillBtn     = document.getElementById('refillBtn');
const leverEl       = document.getElementById('lever');
const winLineEl     = document.querySelector('.win-line');
const payRowsEl     = document.getElementById('payRows');

// ── Weighted random symbol ────────────────────────────────────────────────────
function weightedRandom() {
  const total = SYMBOLS.reduce((s, sym) => s + sym.weight, 0);
  let r = Math.random() * total;
  for (const sym of SYMBOLS) {
    r -= sym.weight;
    if (r <= 0) return sym;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

// ── Build reel strips ─────────────────────────────────────────────────────────
const STRIP_REPEATS = 20; // how many symbols tall each strip is

function buildStrips() {
  for (let i = 0; i < 3; i++) {
    const strip = document.getElementById(`strip${i}`);
    strip.innerHTML = '';
    // populate with random symbols (will be repositioned on spin)
    for (let j = 0; j < STRIP_REPEATS; j++) {
      const sym = weightedRandom();
      const div = document.createElement('div');
      div.className = 'symbol';
      div.dataset.id = sym.id;
      div.textContent = sym.emoji;
      strip.appendChild(div);
    }
    // Show middle symbol as starting position
    positionStrip(strip, 1);
  }
}

function positionStrip(strip, visibleIndex) {
  // Offset so visibleIndex is in the center row
  const symbolSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--symbol-size'));
  strip.style.transform = `translateY(${-visibleIndex * symbolSize}px)`;
  strip.style.transition = 'none';
}

// ── Get result symbol for a reel ─────────────────────────────────────────────
function getResultSymbol(reelIndex) {
  const strip = document.getElementById(`strip${reelIndex}`);
  const symbolSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--symbol-size'));
  const currentY = parseFloat(strip.style.transform.replace('translateY(', '').replace('px)', '')) || 0;
  const centerIndex = Math.round(-currentY / symbolSize);
  const el = strip.children[centerIndex];
  return el ? el.dataset.id : null;
}

// ── Evaluate win ──────────────────────────────────────────────────────────────
function evaluateWin(ids) {
  for (const entry of PAY_TABLE) {
    const m = entry.match;
    // Three-of-a-kind
    if (m[2] !== null) {
      if (ids[0] === m[0] && ids[1] === m[1] && ids[2] === m[2]) return entry;
    } else {
      // Two-of-a-kind (first two match, third anything)
      if (ids[0] === m[0] && ids[1] === m[1]) return entry;
    }
  }
  return null;
}

// ── Spin mechanics ────────────────────────────────────────────────────────────
const REEL_DURATIONS = [1400, 1900, 2400]; // ms per reel

function spin() {
  if (spinning) return;
  if (tokens < bet) {
    showBroke();
    return;
  }

  spinning = true;
  spinBtn.disabled = true;

  // Deduct tokens
  tokens -= bet;
  totalSpent += bet;
  totalSpins++;
  flashWallet('loss');
  updateUI();

  // Pick message
  setMessage(SPIN_MESSAGES[Math.floor(Math.random() * SPIN_MESSAGES.length)]);
  winLineEl.classList.remove('active');

  // Pull lever animation
  leverEl.classList.add('pulled');
  setTimeout(() => leverEl.classList.remove('pulled'), 600);

  // Pre-determine results
  const results = [weightedRandom(), weightedRandom(), weightedRandom()];

  // Animate each reel
  const reelPromises = results.map((targetSym, i) => spinReel(i, targetSym, REEL_DURATIONS[i]));

  Promise.all(reelPromises).then(() => {
    const ids = results.map(r => r.id);
    const win = evaluateWin(ids);

    if (win) {
      const payout = bet * win.mult;
      tokens += payout;
      totalWon += payout;
      flashWallet('gain');
      updateUI();
      winLineEl.classList.add('active');
      highlightWinSymbols(ids, win);
      setTimeout(() => showWin(win, payout), 400);
    } else {
      const msg = LOSE_MESSAGES[Math.floor(Math.random() * LOSE_MESSAGES.length)];
      setMessage(msg);
      spinning = false;
      spinBtn.disabled = false;
      if (tokens < Math.min(...BET_VALUES)) showBroke();
    }
    updateUI();
  });
}

function spinReel(reelIndex, targetSym, duration) {
  return new Promise(resolve => {
    const strip = document.getElementById(`strip${reelIndex}`);
    const symbolSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--symbol-size'));
    const reel = document.getElementById(`reel${reelIndex}`);

    // Rebuild strip: many random symbols, then target at center position
    strip.innerHTML = '';
    const totalSymbols = 30;
    const landingIndex = totalSymbols - 2; // where target lands (center row = index 1 of visible area)

    for (let j = 0; j < totalSymbols; j++) {
      const sym = (j === landingIndex) ? targetSym : weightedRandom();
      const div = document.createElement('div');
      div.className = 'symbol';
      div.dataset.id = sym.id;
      div.textContent = sym.emoji;
      strip.appendChild(div);
    }

    // Start from top
    strip.style.transition = 'none';
    strip.style.transform = `translateY(0px)`;

    // Force reflow
    strip.getBoundingClientRect();

    // Animate to landing position (landing index - 1 = center visible)
    const targetY = -(landingIndex - 1) * symbolSize;

    // CSS-based eased spin
    strip.style.transition = `transform ${duration}ms cubic-bezier(0.17, 0.67, 0.24, 1.0)`;
    strip.style.transform = `translateY(${targetY}px)`;

    reel.classList.add('spinning');

    setTimeout(() => {
      reel.classList.remove('spinning');
      resolve();
    }, duration);
  });
}

function highlightWinSymbols(ids, win) {
  for (let i = 0; i < 3; i++) {
    const strip = document.getElementById(`strip${i}`);
    const symbolSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--symbol-size'));
    // Center symbol is the one at index [totalSymbols - 2 - 1] = totalSymbols - 3... we just find center visible child
    // The reel shows 3 symbols; center is at translateY target. We grab the visible center element.
    // Since strip children count is 30 and landing at index 28 (0-based), center = index 28
    const landingIndex = 30 - 2;
    const el = strip.children[landingIndex - 1 + 1]; // center of 3 visible
    if (el && (win.match[2] === null ? i < 2 : true)) {
      el.classList.add('winning');
    }
  }
}

// ── Show win overlay ──────────────────────────────────────────────────────────
function showWin(win, payout) {
  winTitle.textContent = win.title;
  winAmountEl.textContent = `+${payout} tokens`;
  winQuip.textContent = win.quip;
  setMessage(`${win.title} — +${payout} tokens!`);
  winOverlay.classList.remove('hidden');
  if (win.mult >= 40) launchConfetti();
}

dismissWin.addEventListener('click', () => {
  winOverlay.classList.add('hidden');
  clearWinHighlights();
  spinning = false;
  spinBtn.disabled = false;
  if (tokens < Math.min(...BET_VALUES)) showBroke();
  setMessage('Insert tokens to begin inference...');
});

function clearWinHighlights() {
  document.querySelectorAll('.symbol.winning').forEach(el => el.classList.remove('winning'));
  winLineEl.classList.remove('active');
}

// ── Broke overlay ─────────────────────────────────────────────────────────────
function showBroke() {
  brokeOverlay.classList.remove('hidden');
}

refillBtn.addEventListener('click', () => {
  tokens = 100;
  totalSpent = 0;
  totalWon = 0;
  totalSpins = 0;
  brokeOverlay.classList.add('hidden');
  spinning = false;
  spinBtn.disabled = false;
  setMessage('New subscription activated. Tokens refilled.');
  updateUI();
});

// ── Bet controls ──────────────────────────────────────────────────────────────
const BET_VALUES = [5, 10, 25, 50, 100];
let betIndex = 1; // default = 10

function updateBet() {
  bet = BET_VALUES[betIndex];
  betAmountEl.textContent = bet;
}

betDown.addEventListener('click', () => {
  if (betIndex > 0) { betIndex--; updateBet(); }
});

betUp.addEventListener('click', () => {
  if (betIndex < BET_VALUES.length - 1) { betIndex++; updateBet(); }
});

maxBetBtn.addEventListener('click', () => {
  betIndex = BET_VALUES.length - 1;
  updateBet();
});

// ── Spin triggers ─────────────────────────────────────────────────────────────
spinBtn.addEventListener('click', spin);
leverEl.addEventListener('click', spin);
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    spin();
  }
});

// ── UI helpers ────────────────────────────────────────────────────────────────
function updateUI() {
  tokenCountEl.textContent = tokens;
  totalSpentEl.textContent = totalSpent;
  totalWonEl.textContent = totalWon;
  totalSpinsEl.textContent = totalSpins;
}

function setMessage(msg) {
  messageBarEl.textContent = msg;
}

function flashWallet(type) {
  tokenCountEl.classList.remove('gain', 'loss');
  void tokenCountEl.offsetWidth; // reflow
  tokenCountEl.classList.add(type);
  setTimeout(() => tokenCountEl.classList.remove(type), 600);
}

// ── Pay table render ──────────────────────────────────────────────────────────
function buildPayTable() {
  const rows = [
    { syms: ['💎','💎','💎'], label: 'AGI Triple',       mult: '×500' },
    { syms: ['🤖','🤖','🤖'], label: 'Model Triple',     mult: '×50'  },
    { syms: ['🧠','🧠','🧠'], label: 'Weights Triple',   mult: '×40'  },
    { syms: ['🎭','🎭','🎭'], label: 'Hallucin Triple',  mult: '×30'  },
    { syms: ['🔥','🔥','🔥'], label: 'Burn Triple',      mult: '×25'  },
    { syms: ['☁️','☁️','☁️'], label: 'Cloud Triple',     mult: '×20'  },
    { syms: ['🪙','🪙','🪙'], label: 'Token Triple',     mult: '×15'  },
    { syms: ['📝','📝','📝'], label: 'Prompt Triple',    mult: '×10'  },
    { syms: ['💎','💎','?'],  label: 'Two AGIs',         mult: '×8'   },
    { syms: ['🤖','🤖','?'],  label: 'Two Models',       mult: '×3'   },
    { syms: ['🧠','🧠','?'],  label: 'Two Weights',      mult: '×3'   },
    { syms: ['🪙','🪙','?'],  label: 'Two Tokens',       mult: '×2'   },
  ];

  payRowsEl.innerHTML = rows.map(r => `
    <div class="pay-row">
      <span class="pay-symbols">${r.syms.join('')}</span>
      <span class="pay-label">${r.label}</span>
      <span class="pay-mult">${r.mult}</span>
    </div>
  `).join('');
}

// ── Confetti ──────────────────────────────────────────────────────────────────
let confettiCanvas, confettiCtx, confettiParticles = [];

function launchConfetti() {
  if (!confettiCanvas) {
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'confettiCanvas';
    document.body.appendChild(confettiCanvas);
  }
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  confettiCtx = confettiCanvas.getContext('2d');

  const colors = ['#ffd700', '#ff2d78', '#00d4ff', '#39ff14', '#ff6b35', '#8b00ff'];
  confettiParticles = Array.from({ length: 120 }, () => ({
    x: Math.random() * window.innerWidth,
    y: -20,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 4,
    vy: 3 + Math.random() * 4,
    vr: (Math.random() - 0.5) * 0.2,
    alpha: 1,
  }));

  let frames = 0;
  function frame() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;
      p.vy += 0.1;
      if (frames > 80) p.alpha -= 0.015;

      confettiCtx.save();
      confettiCtx.globalAlpha = Math.max(0, p.alpha);
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rotation);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();
    });
    frames++;
    if (frames < 140) requestAnimationFrame(frame);
    else confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
  requestAnimationFrame(frame);
}

// ── Init ──────────────────────────────────────────────────────────────────────
buildStrips();
buildPayTable();
updateUI();
