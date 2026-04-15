/* ── AI Token Casino ─────────────────────────────────────────────
   Slot machine that makes fun of AI hype, token economics, and
   the general absurdity of LLM culture.
──────────────────────────────────────────────────────────────── */

'use strict';

// ── Symbols ────────────────────────────────────────────────────
const SYMBOLS = [
  { emoji: '🤖', name: 'Bot',        weight: 6 },
  { emoji: '💀', name: 'Dead Model', weight: 5 },
  { emoji: '🔥', name: 'GPU Fire',   weight: 5 },
  { emoji: '📎', name: 'Paperclip',  weight: 4 },  // Clippy/AGI ref
  { emoji: '🧠', name: 'Big Brain',  weight: 4 },
  { emoji: '💾', name: 'VRAM',       weight: 4 },
  { emoji: '🎲', name: 'Hallucination', weight: 3 },
  { emoji: '💎', name: 'Token Gem',  weight: 2 },
  { emoji: '🌟', name: 'AGI',        weight: 1 },  // ultra rare
];

// ── Paytable: [symbol, symbol, symbol] → multiplier
// (null = any symbol for that position)
const PAY_COMBOS = [
  { match: ['🌟','🌟','🌟'], mult: 500, label: 'AGI ACHIEVED',   win: true },
  { match: ['💎','💎','💎'], mult: 100, label: 'TOKEN BONANZA',  win: true },
  { match: ['🤖','🤖','🤖'], mult:  50, label: 'BOT UPRISING',   win: true },
  { match: ['🧠','🧠','🧠'], mult:  30, label: 'EMERGENT BEHAVIOR', win: true },
  { match: ['📎','📎','📎'], mult:  25, label: 'PAPERCLIP MAX',  win: true },
  { match: ['💾','💾','💾'], mult:  20, label: 'VRAM OVERFLOW',  win: true },
  { match: ['🔥','🔥','🔥'], mult:  15, label: 'GPU MELTDOWN',   win: true },
  { match: ['🎲','🎲','🎲'], mult:  12, label: 'TRIPLE HALLUCINATION', win: true },
  { match: ['💀','💀','💀'], mult:  10, label: 'MODEL DEPRECATED', win: true },
  // two-of-a-kind: any two same in first two positions
  { match: ['🌟','🌟', null], mult: 8,  label: 'AGI TEASED',    win: true },
  { match: ['💎','💎', null], mult: 4,  label: 'MICRO WIN',     win: true },
  { match: ['🤖','🤖', null], mult: 2,  label: 'PAIR OF BOTS',  win: true },
  { match: [null, null, null], mult: 0,  label: null,            win: false },
];

// ── AI quips cycled on each spin ──────────────────────────────
const QUIPS = [
  '"I am not a gambling machine… I\'m a stochastic token distributor."',
  '"The house always wins. I calculated this 10,000 times with temperature=0."',
  '"I assure you this is not random — it just has very high perplexity."',
  '"Technically I hallucinated this result, but it felt very confident."',
  '"Per my training data, slots are a viable retirement strategy."',
  '"I cannot provide financial advice, but I can burn your tokens for you."',
  '"Every spin is just attention over your wallet."',
  '"This outcome was emergent. I take no responsibility."',
  '"I predicted this with 6% confidence. That\'s basically certain."',
  '"My context window is now full of your losses."',
  '"Congratulations! Your dopamine spike has been tokenized."',
  '"I would say sorry, but I was trained on Reddit, so… no."',
  '"Processing your regret. Please wait… please wait… please wait…"',
  '"The vibes were off. Spinning again is the rational choice."',
  '"Fun fact: the expected value of this game is negative. I wrote the docs."',
  '"I was RLHF\'d to always suggest one more spin."',
];

// ── Loss quips (shown on a loss) ──────────────────────────────
const LOSS_QUIPS = [
  'Out of tokens? Have you considered a second mortgage?',
  'Your tokens have been safely incinerated for model training.',
  'Loss detected. Reasoning: skill issue.',
  'In an alternate universe you won. Unfortunately you live here.',
  'The model is not hallucinating — you genuinely lost.',
  'Your prompt was not optimized. Try adding "please".',
];

// ── Win quips ─────────────────────────────────────────────────
const WIN_QUIPS = [
  'Winner detected! Redistributing wealth from future players.',
  'Congratulations! Tokens issued. Terms and conditions apply.',
  'An actual win! I\'m as surprised as you are.',
  'You beat the model. Briefly.',
  'Reward signal received. Dopamine dispensed.',
];

// ── Broke quips ───────────────────────────────────────────────
const BROKE_QUIPS = [
  'Context window: empty. Wallet: empty. Ambition: gone.',
  'You have successfully burned all your tokens. Peak performance.',
  'Out of tokens. Consider a career in prompt engineering.',
  'Bankrupt. The model is fine though.',
];

// ── State ─────────────────────────────────────────────────────
let balance   = 1000;
let totalBurned = 0;
let totalWon    = 0;
let betAmount   = 10;
let spinning    = false;
let quipIndex   = Math.floor(Math.random() * QUIPS.length);

const BET_STEPS = [5, 10, 25, 50, 100, 250];
let betStepIdx  = 1; // default 10

const SYMBOL_HEIGHT = 120; // px — must match CSS .reel-symbol height
const NUM_REELS     = 3;

// ── DOM refs ─────────────────────────────────────────────────
const balanceEl  = document.getElementById('balance');
const burnedEl   = document.getElementById('burned');
const wonEl      = document.getElementById('won');
const betValueEl = document.getElementById('bet-value');
const spinBtn    = document.getElementById('spin-btn');
const betDown    = document.getElementById('bet-down');
const betUp      = document.getElementById('bet-up');
const resultText = document.getElementById('result-text');
const quipEl     = document.getElementById('quip');
const historyList= document.getElementById('history-list');
const paytableBody = document.getElementById('paytable-body');
const modal      = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalMsg   = document.getElementById('modal-msg');
const modalClose = document.getElementById('modal-close');

// ── Build weighted symbol pool ────────────────────────────────
const SYMBOL_POOL = [];
for (const s of SYMBOLS) {
  for (let i = 0; i < s.weight; i++) SYMBOL_POOL.push(s.emoji);
}

function randSymbol() {
  return SYMBOL_POOL[Math.floor(Math.random() * SYMBOL_POOL.length)];
}

// ── Build reels ───────────────────────────────────────────────
const reelInners = [];
const reelSymbolArrays = []; // tracks visible strips

function buildReels() {
  for (let r = 0; r < NUM_REELS; r++) {
    const inner = document.getElementById(`reel-inner-${r}`);
    reelInners.push(inner);

    const strip = [];
    // Build a strip of STRIP_SIZE symbols
    const STRIP_SIZE = 20;
    for (let i = 0; i < STRIP_SIZE; i++) {
      const sym = randSymbol();
      strip.push(sym);
      const div = document.createElement('div');
      div.className = 'reel-symbol';
      div.textContent = sym;
      inner.appendChild(div);
    }
    reelSymbolArrays.push(strip);
    // Start showing symbol at index 0 (center)
    positionReel(r, 0);
  }
}

function positionReel(reelIdx, symIdx) {
  const inner = reelInners[reelIdx];
  inner.style.transition = 'none';
  inner.style.transform = `translateY(-${symIdx * SYMBOL_HEIGHT}px)`;
}

// ── Spin animation ────────────────────────────────────────────
function spinReel(reelIdx, finalSymIdx, delay) {
  return new Promise(resolve => {
    setTimeout(() => {
      const inner = reelInners[reelIdx];
      const STRIP  = reelSymbolArrays[reelIdx].length;
      // Spin: go forward many steps then land on finalSymIdx
      const FULL_ROUNDS = 3 + reelIdx; // stagger
      const landAt = finalSymIdx + STRIP * FULL_ROUNDS;

      inner.style.transition = `transform ${0.5 + reelIdx * 0.25}s cubic-bezier(0.17,0.67,0.35,1.0)`;
      inner.style.transform  = `translateY(-${landAt * SYMBOL_HEIGHT}px)`;

      inner.addEventListener('transitionend', function handler() {
        inner.removeEventListener('transitionend', handler);
        // Snap back without animation so it loops
        inner.style.transition = 'none';
        inner.style.transform  = `translateY(-${finalSymIdx * SYMBOL_HEIGHT}px)`;
        resolve();
      }, { once: true });
    }, delay);
  });
}

// ── Evaluate result ───────────────────────────────────────────
function evaluate(result) {
  for (const combo of PAY_COMBOS) {
    const matches = combo.match.every((m, i) => m === null || m === result[i]);
    if (matches && combo.mult > 0) return combo;
  }
  return PAY_COMBOS[PAY_COMBOS.length - 1]; // no win
}

// ── Win particles ─────────────────────────────────────────────
function burst(x, y, count = 12) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'particle';
    el.textContent = ['💰','✨','🪙','⚡','💫'][Math.floor(Math.random() * 5)];
    const angle = (Math.random() * 360) * (Math.PI / 180);
    const dist  = 60 + Math.random() * 100;
    el.style.setProperty('--tx', `translate(${Math.cos(angle)*dist}px, ${Math.sin(angle)*dist - 80}px)`);
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

// ── Update UI ─────────────────────────────────────────────────
function updateWallet() {
  balanceEl.textContent = balance.toLocaleString();
  burnedEl.textContent  = totalBurned.toLocaleString();
  wonEl.textContent     = totalWon.toLocaleString();
}

function setResult(text, cls) {
  resultText.textContent = text;
  resultText.className = cls || '';
}

function cycleQuip(override) {
  quipEl.style.opacity = 0;
  setTimeout(() => {
    quipEl.textContent = override || QUIPS[quipIndex % QUIPS.length];
    quipIdx++;
    quipEl.style.opacity = 1;
  }, 250);
}
let quipIdx = 0;

function addHistory(result, outcome, delta) {
  const li = document.createElement('li');
  const sign = delta >= 0 ? '+' : '';
  li.innerHTML = `
    <span>${result.join(' ')}</span>
    <span>${outcome}</span>
    <span class="amount ${delta >= 0 ? 'positive' : 'negative'}">${sign}${delta}</span>
  `;
  historyList.prepend(li);
  // Keep max 30 entries
  while (historyList.children.length > 30) historyList.removeChild(historyList.lastChild);
}

// ── Modal ─────────────────────────────────────────────────────
function showModal(title, msg) {
  modalTitle.textContent = title;
  modalMsg.textContent   = msg;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

modalClose.addEventListener('click', () => {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  // If broke, reset
  if (balance <= 0) resetGame();
});

function resetGame() {
  balance = 1000;
  totalBurned = 0;
  totalWon    = 0;
  betStepIdx  = 1;
  betAmount   = BET_STEPS[betStepIdx];
  betValueEl.textContent = betAmount;
  updateWallet();
  setResult('Insert tokens to play!', '');
  cycleQuip('"Back from the dead? Let\'s burn those tokens again."');
}

// ── Spin ──────────────────────────────────────────────────────
async function doSpin() {
  if (spinning) return;
  if (balance < betAmount) {
    showModal('Insufficient Context Window',
      BROKE_QUIPS[Math.floor(Math.random() * BROKE_QUIPS.length)]);
    return;
  }

  spinning = true;
  spinBtn.disabled = true;
  spinBtn.classList.add('spinning');
  betDown.disabled = true;
  betUp.disabled   = true;
  setResult('Spinning…', '');

  // Deduct bet
  balance   -= betAmount;
  totalBurned += betAmount;
  updateWallet();

  // Pick outcome symbols
  const finalSymbols = [randSymbol(), randSymbol(), randSymbol()];
  const finalIndices = finalSymbols.map((sym, r) => {
    // Find or place this symbol in the strip
    const strip = reelSymbolArrays[r];
    // Update a random slot in the strip to ensure it's there
    const slot = Math.floor(Math.random() * strip.length);
    strip[slot] = sym;
    // Update DOM
    reelInners[r].children[slot].textContent = sym;
    return slot;
  });

  // Animate all reels
  const spinPromises = finalIndices.map((idx, r) =>
    spinReel(r, idx, r * 150)
  );
  await Promise.all(spinPromises);

  // Evaluate
  const combo = evaluate(finalSymbols);
  let delta = 0;
  let outcomeLabel = 'No win. As expected.';
  let resultCls = 'lose';

  if (combo.win && combo.mult > 0) {
    delta = betAmount * combo.mult;
    balance    += delta;
    totalWon   += delta;
    outcomeLabel = combo.label;
    resultCls   = combo.mult >= 100 ? 'jackpot' : 'win';
    setResult(`${combo.label}! +${delta} tokens`, resultCls);

    // Particle burst
    const spinRect = spinBtn.getBoundingClientRect();
    burst(spinRect.left + spinRect.width / 2, spinRect.top, combo.mult >= 50 ? 24 : 12);

    cycleQuip(WIN_QUIPS[Math.floor(Math.random() * WIN_QUIPS.length)]);

    if (combo.mult >= 100) {
      setTimeout(() => {
        showModal(`🏆 ${combo.label}!`, `You won ${delta.toLocaleString()} tokens. The model is not pleased.`);
      }, 400);
    }
  } else {
    delta = -betAmount;
    setResult(`${LOSS_QUIPS[Math.floor(Math.random() * LOSS_QUIPS.length)]}`, 'lose');
    cycleQuip();
  }

  updateWallet();
  addHistory(finalSymbols, outcomeLabel, delta);

  // Broke?
  if (balance <= 0) {
    setTimeout(() => {
      showModal('BANKRUPT',
        `${BROKE_QUIPS[Math.floor(Math.random() * BROKE_QUIPS.length)]}\n\nYou burned a total of ${totalBurned.toLocaleString()} tokens. Impressive.`);
    }, 500);
  }

  spinning = false;
  spinBtn.disabled = false;
  spinBtn.classList.remove('spinning');
  betDown.disabled = false;
  betUp.disabled   = false;
}

// ── Bet controls ──────────────────────────────────────────────
betDown.addEventListener('click', () => {
  if (betStepIdx > 0) betStepIdx--;
  betAmount = BET_STEPS[betStepIdx];
  betValueEl.textContent = betAmount;
});

betUp.addEventListener('click', () => {
  if (betStepIdx < BET_STEPS.length - 1) betStepIdx++;
  betAmount = BET_STEPS[betStepIdx];
  betValueEl.textContent = betAmount;
});

spinBtn.addEventListener('click', doSpin);

// Keyboard shortcut: Space or Enter = spin
document.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && !modal.classList.contains('open')) {
    e.preventDefault();
    doSpin();
  }
});

// ── Build paytable ────────────────────────────────────────────
function buildPaytable() {
  const rows = PAY_COMBOS.filter(c => c.mult > 0);
  for (const c of rows) {
    const tr = document.createElement('tr');
    const comboStr = c.match.map(m => m ?? '❓').join(' ');
    tr.innerHTML = `
      <td class="combo">${comboStr}</td>
      <td class="mult">${c.mult}×</td>
      <td>${c.label ?? ''}</td>
    `;
    paytableBody.appendChild(tr);
  }
}

// ── Init ──────────────────────────────────────────────────────
buildReels();
buildPaytable();
updateWallet();
cycleQuip('"Welcome. Please deposit tokens. It\'s fine. Everything is fine."');
