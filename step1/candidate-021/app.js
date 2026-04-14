'use strict';

// ── Symbols ───────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { emoji: '🤖', name: 'Robot',        payout: 5,   label: '× 5 tokens',  weight: 5 },
  { emoji: '🧠', name: 'Neural Net',   payout: 8,   label: '× 8 tokens',  weight: 4 },
  { emoji: '💬', name: 'Hallucination',payout: 12,  label: '× 12 tokens', weight: 3 },
  { emoji: '📊', name: 'Training Data',payout: 15,  label: '× 15 tokens', weight: 3 },
  { emoji: '🔮', name: 'Prediction',   payout: 20,  label: '× 20 tokens', weight: 2 },
  { emoji: '⚡', name: 'GPU Cluster',  payout: 30,  label: '× 30 tokens', weight: 2 },
  { emoji: '🪙', name: 'TOKEN',        payout: 100, label: '× 100 tokens',weight: 1 },
];

// Build weighted pool
const SYMBOL_POOL = [];
for (const sym of SYMBOLS) {
  for (let i = 0; i < sym.weight; i++) SYMBOL_POOL.push(sym);
}

// ── Win messages ──────────────────────────────────────────────────────────────
const WIN_MESSAGES = [
  s => `${s}${s}${s} — The model predicted this outcome with 100% confidence (after seeing the result).`,
  s => `Triple ${s}! The training data included this exact spin.`,
  s => `${s}${s}${s} JACKPOT! Your tokens have been hallucinated into existence. Probably real.`,
  s => `Winner! The AI says: "I knew you'd win. I also know everything else, always."`,
  s => `${s} × 3! Congrats. The model takes full credit despite understanding nothing.`,
  s => `Big win! GPT-5 would have also predicted this. So would a coin flip.`,
  s => `${s}${s}${s}! The neural net detects a pattern: you winning, it losing tokens.`,
];

const SMALL_WIN_MESSAGES = [
  (a, b) => `Two ${a} & a ${b} — Partial match! Like an LLM that's almost correct. Almost.`,
  (a, b) => `${a}${a}! The second reel suffered a context-length hallucination.`,
  (a, b) => `Close! The model sees ${a}${a} and confidently declares: jackpot. It's wrong.`,
  (a, b) => `Two of a kind! The AI would call this "emergent luck." Coincidence, probably.`,
];

const LOSE_MESSAGES = [
  '— No match. The model says this is your fault for not fine-tuning your luck.',
  '— Loss logged. The AI will use your failure as training data to beat you next time.',
  '— Nothing. The AI hallucinated a win for you but the tokens disagreed.',
  '— Nope. Insufficient tokens detected. The model confidently recommends you spend more.',
  '— The model predicted a win. It was wrong. As always, it blames the data.',
  '— Zero tokens won. Entropy is working as intended.',
  '— The neural net says: statistically, the next spin will also lose. But try anyway.',
  '— A loss! The AI has analyzed your playstyle and has no useful feedback.',
  '— No match. Your prompt was rejected. Please rephrase as a winning spin.',
];

// ── State ─────────────────────────────────────────────────────────────────────
let tokens = 100;
let spinning = false;
const SPIN_COST = 10;
const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
const CELL_HEIGHT = 60; // px — keep in sync with CSS

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tokenCountEl = document.getElementById('tokenCount');
const spinBtn      = document.getElementById('spinBtn');
const refillBtn    = document.getElementById('refillBtn');
const messageText  = document.getElementById('messageText');
const messageBox   = document.getElementById('messageBox');
const reelsEl      = document.getElementById('reels');
const paylineEl    = document.querySelector('.payline');

// ── Build paytable ────────────────────────────────────────────────────────────
(function buildPaytable() {
  const grid = document.getElementById('paytableGrid');
  for (const sym of [...SYMBOLS].reverse()) {
    const row = document.createElement('div');
    row.className = 'paytable-row';
    row.innerHTML = `
      <span class="paytable-emoji">${sym.emoji}</span>
      <div class="paytable-info">
        <span class="paytable-name">${sym.name}</span>
        <span class="paytable-payout">${sym.label}</span>
      </div>`;
    grid.appendChild(row);
  }
})();

// ── Build reel strips ─────────────────────────────────────────────────────────
const strips = [];

function buildStrip(stripEl) {
  // Create a long strip of shuffled symbols
  const cells = [];
  const count = 40;
  for (let i = 0; i < count; i++) {
    const sym = SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)];
    const cell = document.createElement('div');
    cell.className = 'symbol-cell';
    cell.textContent = sym.emoji;
    cell.dataset.index = String(SYMBOLS.indexOf(sym));
    stripEl.appendChild(cell);
    cells.push({ el: cell, sym });
  }
  return cells;
}

// Initialize 3 reels
for (let r = 0; r < REEL_COUNT; r++) {
  const stripEl = document.getElementById(`strip${r}`);
  const cells   = buildStrip(stripEl);
  strips.push({ stripEl, cells, offset: 0 });
  // Position so middle visible row is index 1
  stripEl.style.transform = `translateY(${CELL_HEIGHT}px)`;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function randomSymbol() {
  return SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)];
}

function updateTokenDisplay(delta = 0) {
  tokenCountEl.textContent = tokens;
  if (delta !== 0) {
    tokenCountEl.classList.remove('bump');
    void tokenCountEl.offsetWidth; // reflow
    tokenCountEl.classList.add('bump');
    setTimeout(() => tokenCountEl.classList.remove('bump'), 200);
  }
}

function setMessage(text, type = '') {
  messageText.className = type;
  messageText.textContent = text;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Coin burst ────────────────────────────────────────────────────────────────
function spawnCoins(count = 12) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('span');
      el.className = 'coin-particle';
      el.textContent = '🪙';
      el.style.left = `${10 + Math.random() * 80}vw`;
      el.style.top  = '0px';
      el.style.animationDelay = `${Math.random() * 0.3}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }, i * 40);
  }
}

// ── Reel spin logic ───────────────────────────────────────────────────────────
// Each reel scrolls down; the "result" symbol ends up centered in the window.
// Strip has CELL_HEIGHT cells; we wrap with modular arithmetic.
function spinReel(reelIndex, targetSymIndex, extraSpins, delay) {
  return new Promise(resolve => {
    const { stripEl, cells } = strips[reelIndex];
    const totalCells  = cells.length;
    const spinsFrames = extraSpins * totalCells + targetSymIndex;

    // Rebuild strip with target sym at position targetSymIndex
    // Simpler: just animate translateY by a large amount, snap to result
    const SPIN_CELLS = 60 + extraSpins * totalCells + targetSymIndex;

    // Current strip is infinitely tall — we move it upward (negative Y = scroll up)
    // so that symbols appear to scroll down into view.
    // We use CSS transitions.
    stripEl.style.transition = 'none';

    // Reset to top
    const startY = CELL_HEIGHT; // one row offset so middle row is index 0
    stripEl.style.transform = `translateY(${startY}px)`;

    // Force reflow
    void stripEl.offsetWidth;

    const duration = 1.8 + delay * 0.18;
    stripEl.style.transition = `transform ${duration}s cubic-bezier(0.23, 1, 0.32, 1)`;

    // Scroll up by SPIN_CELLS rows
    const endY = startY - SPIN_CELLS * CELL_HEIGHT;
    stripEl.style.transform = `translateY(${endY}px)`;

    setTimeout(() => {
      // Snap: place target symbol in center row (row index 1 of 3 visible)
      stripEl.style.transition = 'none';

      // Rebuild cells around the target so it sits at row 1 (center)
      // We clear and recreate cells with the target at position 1
      while (stripEl.firstChild) stripEl.removeChild(stripEl.firstChild);

      const newCells = [];
      for (let i = 0; i < totalCells; i++) {
        const sym = i === 1
          ? SYMBOLS[targetSymIndex]
          : SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)];
        const cell = document.createElement('div');
        cell.className = 'symbol-cell';
        cell.textContent = sym.emoji;
        stripEl.appendChild(cell);
        newCells.push({ el: cell, sym });
      }
      strips[reelIndex].cells = newCells;

      // Translate so row 1 is visible in center (CELL_HEIGHT offsets by 1 row upward)
      stripEl.style.transform = `translateY(${CELL_HEIGHT}px)`;

      resolve();
    }, duration * 1000 + 50);
  });
}

// ── Spin handler ──────────────────────────────────────────────────────────────
async function doSpin() {
  if (spinning) return;
  if (tokens < SPIN_COST) {
    setMessage('Not enough tokens! The AI laughs at your poverty. Click REFILL.', 'lose');
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  tokens -= SPIN_COST;
  updateTokenDisplay(-SPIN_COST);

  setMessage('Consulting the oracle… (the oracle is stochastic)', '');
  paylineEl.classList.remove('win-flash');

  // Pick results
  const results = [randomSymbol(), randomSymbol(), randomSymbol()];

  // Spin each reel with staggered delay
  const promises = results.map((sym, i) => {
    const symIdx   = SYMBOLS.indexOf(sym);
    const extra    = 3 + Math.floor(Math.random() * 3);
    return spinReel(i, symIdx, extra, i);
  });

  await Promise.all(promises);

  // Evaluate
  const r0 = results[0], r1 = results[1], r2 = results[2];
  const allMatch  = r0 === r1 && r1 === r2;
  const twoMatch  = r0 === r1 || r1 === r2 || r0 === r2;

  if (allMatch) {
    const payout = r0.payout;
    tokens += payout;
    updateTokenDisplay(payout);
    const msg = pick(WIN_MESSAGES)(r0.emoji);
    setMessage(`+${payout} tokens! ${msg}`, payout >= 50 ? 'big-win' : 'win');
    paylineEl.classList.add('win-flash');
    spawnCoins(r0 === SYMBOLS[SYMBOLS.length - 1] ? 30 : 14);
  } else if (twoMatch) {
    const matchSym = (r0 === r1) ? r0 : (r1 === r2) ? r1 : r0;
    const otherSym = (r0 === r1) ? r2 : (r1 === r2) ? r0 : r1;
    const payout = Math.floor(matchSym.payout / 4);
    tokens += payout;
    updateTokenDisplay(payout);
    const msg = pick(SMALL_WIN_MESSAGES)(matchSym.emoji, otherSym.emoji);
    setMessage(`+${payout} tokens! ${msg}`, 'win');
    paylineEl.classList.add('win-flash');
    spawnCoins(4);
  } else {
    const msg = pick(LOSE_MESSAGES);
    setMessage(msg, 'lose');
  }

  spinning = false;
  spinBtn.disabled = tokens < SPIN_COST;
}

// ── Refill ────────────────────────────────────────────────────────────────────
refillBtn.addEventListener('click', () => {
  tokens = 100;
  updateTokenDisplay(100);
  spinBtn.disabled = false;
  setMessage('Tokens refilled! The AI is disappointed you didn\'t just spend real money.', '');
});

// ── Spin button ───────────────────────────────────────────────────────────────
spinBtn.addEventListener('click', doSpin);

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    doSpin();
  }
});

// ── Init display ──────────────────────────────────────────────────────────────
updateTokenDisplay();
