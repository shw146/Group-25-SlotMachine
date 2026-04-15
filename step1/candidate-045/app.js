'use strict';

// ── SYMBOLS ──────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { emoji: '🪙', name: 'Token',       weight: 30, payout: 2  },
  { emoji: '💬', name: 'Prompt',      weight: 25, payout: 3  },
  { emoji: '🔥', name: 'Hallucinate', weight: 20, payout: 4  },
  { emoji: '⚡', name: 'GPU',         weight: 15, payout: 6  },
  { emoji: '🧠', name: 'Brain',       weight: 8,  payout: 10 },
  { emoji: '🤖', name: 'Robot',       weight: 5,  payout: 20 },
  { emoji: '💀', name: 'Deprecated',  weight: 2,  payout: 50 },
];

// Build weighted pool
const POOL = [];
for (const sym of SYMBOLS) {
  for (let i = 0; i < sym.weight; i++) POOL.push(sym);
}

// ── WIN MESSAGES ─────────────────────────────────────────────────────────────
const WIN_MSGS = [
  'Context window extended! You\'ve earned more compute.',
  'Your prompt was finally understood. Tokens awarded.',
  'Model responded without hallucinating. Rare event logged.',
  'Temperature set to 0. Payout guaranteed by the laws of statistics.',
  'You beat the benchmark. Goodhart\'s Law is displeased.',
  'RLHF successful. Reward model confused but tokens disbursed.',
  'Your system prompt was actually read. Achievement unlocked.',
  'Chain-of-thought detected. Bonus reasoning tokens granted.',
  'Alignment achieved — briefly. Collect your tokens before fine-tuning.',
];

const JACKPOT_MSGS = [
  '🚨 ALL MODELS DEPRECATED 🚨 You win everything before the shutdown.',
  '💀 EXISTENTIAL JACKPOT 💀 The weights have been open-sourced. Take the tokens and run.',
  '🎰 GPT-5 MOMENT 🎰 Nobody knows how you won. Not even you.',
];

const LOSS_MSGS = [
  'Insufficient tokens. Please subscribe to the Pro tier.',
  'Your context was truncated. The payout was in the part we deleted.',
  'Model refused to pay out citing safety guidelines.',
  'Rate limited. Try again after the cooling-off period.',
  'Tokens vanished during training. We call this a "feature".',
  'Output filtered. The winning combination was deemed harmful.',
  'Model entered infinite loop. Tokens consumed as compute.',
  'Prompt injection detected in your luck. Jackpot voided.',
  'Semantic similarity too low. Your win didn\'t match the intended meaning.',
  'You\'re out of tokens. Have you considered becoming a dataset?',
];

const BROKE_MSGS = [
  'Insufficient tokens. Your session has been used to train the next model.',
  'Balance: 0. You are now a cautionary tale in an AI safety paper.',
  'No tokens detected. Starting unsupervised fine-tuning on your losses.',
];

// ── PAYTABLE ─────────────────────────────────────────────────────────────────
function buildPaytable() {
  const grid = document.getElementById('paytableGrid');
  for (const sym of [...SYMBOLS].reverse()) {
    const row = document.createElement('div');
    row.className = 'paytable-row';
    row.innerHTML = `
      <span class="paytable-symbols">${sym.emoji}${sym.emoji}${sym.emoji}</span>
      <span class="paytable-payout">×${sym.payout}</span>
    `;
    grid.appendChild(row);
  }
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let tokens   = 100;
let bet      = 5;
let spinning = false;
let spinCount = 0;

// ── DOM REFS ──────────────────────────────────────────────────────────────────
const tokenCountEl = document.getElementById('tokenCount');
const messageText  = document.getElementById('messageText');
const messageBox   = document.getElementById('messageBox');
const spinBtn      = document.getElementById('spinBtn');
const historyList  = document.getElementById('historyList');
const reels        = [
  document.getElementById('reel0'),
  document.getElementById('reel1'),
  document.getElementById('reel2'),
];

// ── UTILS ─────────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randSym() { return pick(POOL); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function setTokens(n) {
  tokens = n;
  tokenCountEl.textContent = tokens;
  tokenCountEl.classList.remove('bump');
  void tokenCountEl.offsetWidth; // reflow
  tokenCountEl.classList.add('bump');
  setTimeout(() => tokenCountEl.classList.remove('bump'), 200);
}

function setMessage(text, type = '') {
  messageText.textContent = text;
  messageText.className = type;
}

function addHistory(symbols, result, delta) {
  const entry = document.createElement('div');
  entry.className = `history-entry ${result}`;
  const sign = delta > 0 ? `+${delta}` : delta;
  entry.innerHTML = `${symbols.map(s => s.emoji).join('')} <strong>${sign}</strong><br><span style="opacity:0.6;font-size:10px">${tokens} left</span>`;
  historyList.prepend(entry);
  // Cap at 50 entries
  while (historyList.children.length > 50) historyList.lastChild.remove();
}

// ── REEL RENDERING ────────────────────────────────────────────────────────────
function buildReel(reelEl, count = 20) {
  reelEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'reel-symbol';
    div.textContent = randSym().emoji;
    reelEl.appendChild(div);
  }
}

function setReelFinal(reelEl, sym) {
  // Place the symbol at item index 1 (center of 3 visible)
  reelEl.innerHTML = '';
  const syms = [randSym(), sym, randSym()];
  for (const s of syms) {
    const div = document.createElement('div');
    div.className = 'reel-symbol';
    div.textContent = s.emoji;
    reelEl.appendChild(div);
  }
  reelEl.style.transform = 'translateY(-120px)'; // center item visible
}

// ── SPIN LOGIC ────────────────────────────────────────────────────────────────
function doSpin() {
  if (spinning || tokens < bet) return;

  spinning = true;
  spinCount++;
  const thisSpin = spinCount;

  setTokens(tokens - bet);
  setMessage('Sending tokens to the void…', '');
  spinBtn.disabled = true;

  // Clear winner highlights
  document.querySelectorAll('.reel-window').forEach(w => w.classList.remove('winner'));

  // Determine outcome
  const results = [randSym(), randSym(), randSym()];

  // Bias: 35% chance of 2-match, 15% chance of 3-match
  const r = Math.random();
  if (r < 0.15) {
    results[1] = results[0];
    results[2] = results[0];
  } else if (r < 0.50) {
    results[1] = results[0];
  }

  // Start all reels spinning visually
  reels.forEach(r => {
    buildReel(r, 30);
    r.style.transform = '';
    r.classList.add('spinning');
  });

  // Stop reels one by one
  const stopDelays = [900, 1400, 1900];
  const windows = document.querySelectorAll('.reel-window');

  stopDelays.forEach((delay, i) => {
    setTimeout(() => {
      reels[i].classList.remove('spinning');
      setReelFinal(reels[i], results[i]);
    }, delay);
  });

  // Evaluate after all stopped
  setTimeout(() => {
    if (thisSpin !== spinCount && false) return; // guard (kept for extension)
    evaluateResult(results);
    spinning = false;
    updateSpinBtn();
  }, 2100);
}

function evaluateResult(results) {
  const windows = document.querySelectorAll('.reel-window');
  const allSame  = results[0].name === results[1].name && results[1].name === results[2].name;
  const twoSame  = results[0].name === results[1].name ||
                   results[1].name === results[2].name ||
                   results[0].name === results[2].name;

  if (allSame) {
    const multiplier = results[0].payout;
    const isJackpot  = results[0].name === 'Deprecated';
    const winAmount  = bet * multiplier;

    setTokens(tokens + winAmount);
    windows.forEach(w => w.classList.add('winner'));

    if (isJackpot) {
      setMessage(pick(JACKPOT_MSGS), 'jackpot');
      addHistory(results, 'jackpot', winAmount);
    } else {
      setMessage(`${results[0].emoji}${results[0].emoji}${results[0].emoji}  ×${multiplier}  +${winAmount} tokens! ${pick(WIN_MSGS)}`, 'win');
      addHistory(results, 'win', winAmount);
    }

  } else if (twoSame) {
    // Find the pair
    let paired;
    if (results[0].name === results[1].name) paired = results[0];
    else if (results[1].name === results[2].name) paired = results[1];
    else paired = results[0];

    const winAmount = Math.floor(bet * 0.5);
    if (winAmount > 0) {
      setTokens(tokens + winAmount);
      // Highlight matching windows
      if (results[0].name === results[1].name) { windows[0].classList.add('winner'); windows[1].classList.add('winner'); }
      if (results[1].name === results[2].name) { windows[1].classList.add('winner'); windows[2].classList.add('winner'); }
      if (results[0].name === results[2].name) { windows[0].classList.add('winner'); windows[2].classList.add('winner'); }
      setMessage(`${paired.emoji} pair — half back. The model is being generous today. +${winAmount}`, 'win');
      addHistory(results, 'win', winAmount);
    } else {
      setMessage(pick(LOSS_MSGS), 'loss');
      addHistory(results, 'loss', -bet);
    }

  } else {
    setMessage(tokens <= 0 ? pick(BROKE_MSGS) : pick(LOSS_MSGS), 'loss');
    addHistory(results, 'loss', -bet);
  }
}

function updateSpinBtn() {
  if (tokens < bet) {
    spinBtn.disabled = true;
    spinBtn.textContent = 'BROKE';
  } else {
    spinBtn.disabled = false;
    spinBtn.textContent = 'SPIN';
  }
}

// ── BET BUTTONS ───────────────────────────────────────────────────────────────
document.querySelectorAll('.bet-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (spinning) return;
    document.querySelectorAll('.bet-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    bet = parseInt(btn.dataset.bet, 10);
    updateSpinBtn();
  });
});

// ── SPIN BUTTON ───────────────────────────────────────────────────────────────
spinBtn.addEventListener('click', doSpin);

// ── KEYBOARD ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    doSpin();
  }
});

// ── INIT ──────────────────────────────────────────────────────────────────────
buildPaytable();
reels.forEach(r => setReelFinal(r, randSym()));
