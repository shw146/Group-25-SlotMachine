'use strict';

// ── Symbols ─────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { id: 'gpt',      emoji: '🤖', label: 'GPT-∞',    weight: 6  },
  { id: 'token',    emoji: '🪙', label: 'Token',     weight: 10 },
  { id: 'prompt',   emoji: '💬', label: 'Prompt',    weight: 10 },
  { id: 'halluc',   emoji: '👻', label: 'Hallucin',  weight: 8  },
  { id: 'gpu',      emoji: '🔥', label: 'GPU $$$',   weight: 5  },
  { id: 'rlhf',     emoji: '🧠', label: 'RLHF',      weight: 7  },
  { id: 'context',  emoji: '📎', label: 'Context',   weight: 9  },
  { id: 'align',    emoji: '🎯', label: 'Aligned',   weight: 4  },
  { id: 'agi',      emoji: '✨', label: 'AGI???',    weight: 2  },
];

// ── Paytable: [id, id, id] → { multiplier, message } ──────────────────────
const PAYTABLE = [
  { combo: ['agi',   'agi',   'agi'   ], mult: 500, label: '✨✨✨ AGI Jackpot!', cls: 'jackpot' },
  { combo: ['gpt',   'gpt',   'gpt'   ], mult: 100, label: '🤖🤖🤖 GPT-∞ Trilogy', cls: 'jackpot' },
  { combo: ['gpu',   'gpu',   'gpu'   ], mult: 50,  label: '🔥🔥🔥 GPU Meltdown',  cls: 'win' },
  { combo: ['align', 'align', 'align' ], mult: 40,  label: '🎯🎯🎯 Perfectly Aligned', cls: 'win' },
  { combo: ['rlhf',  'rlhf',  'rlhf'  ], mult: 30,  label: '🧠🧠🧠 Human Approved',  cls: 'win' },
  { combo: ['halluc','halluc','halluc' ], mult: 20,  label: '👻👻👻 Fully Hallucinated', cls: 'win' },
  { combo: ['token', 'token', 'token' ], mult: 15,  label: '🪙🪙🪙 Triple Token',    cls: 'win' },
  { combo: ['prompt','prompt','prompt' ], mult: 12,  label: '💬💬💬 Prompt Engineer', cls: 'win' },
  { combo: ['context','context','context'],mult:10,  label: '📎📎📎 Clippy Returns',  cls: 'win' },
  // Two-of-a-kind (any symbol)
  { combo: ['*', '*', null], mult: 2, label: 'Two of a kind', cls: 'win' },
];

const LOSE_MESSAGES = [
  '❌ Context window empty. Insert tokens.',
  '❌ Model hallucinated a win. It lied.',
  '❌ Inference failed. Try again?',
  '❌ Rate limit exceeded on your luck.',
  '❌ Your prompt was poorly engineered.',
  '❌ 404: Winning combination not found.',
  '❌ AI says: "I cannot assist with that."',
  '❌ Insufficient tokens. Classic.',
  '❌ The model is at capacity. So is your loss.',
];

// ── Weighted random pick ────────────────────────────────────────────────────
function weightedPick(symbols) {
  const total = symbols.reduce((s, sym) => s + sym.weight, 0);
  let r = Math.random() * total;
  for (const sym of symbols) {
    r -= sym.weight;
    if (r <= 0) return sym;
  }
  return symbols[symbols.length - 1];
}

// ── State ───────────────────────────────────────────────────────────────────
let state = {
  balance: 1000,
  bet: 10,
  winnings: 0,
  spinning: false,
};

// ── DOM Refs ────────────────────────────────────────────────────────────────
const balanceEl   = document.getElementById('balance');
const betEl       = document.getElementById('bet');
const winningsEl  = document.getElementById('winnings');
const spinBtn     = document.getElementById('spin-btn');
const spinCostEl  = document.getElementById('spin-cost');
const resultEl    = document.getElementById('result-banner');
const historyList = document.getElementById('history-list');
const betDown     = document.getElementById('bet-down');
const betUp       = document.getElementById('bet-up');
const reelsWindow = document.querySelector('.reels-window');
const leverEl     = document.getElementById('lever');
const leverWrap   = document.querySelector('.lever-wrap');

const NUM_REELS = 3;
const VISIBLE_STRIP_ITEMS = 9; // items pre-populated for smooth scroll

// ── Build reel strips ───────────────────────────────────────────────────────
function buildStrips() {
  for (let r = 0; r < NUM_REELS; r++) {
    const strip = document.getElementById(`strip-${r}`);
    strip.innerHTML = '';
    // Pre-fill with random symbols so scroll has content
    for (let i = 0; i < VISIBLE_STRIP_ITEMS; i++) {
      strip.appendChild(makeSymbolEl(SYMBOLS[i % SYMBOLS.length]));
    }
    // Reset position to show the middle symbol (index 4) in the window center
    strip.style.transform = `translateY(-${4 * 120}px)`;
  }
}

function makeSymbolEl(sym) {
  const div = document.createElement('div');
  div.className = 'symbol';
  div.dataset.id = sym.id;
  div.innerHTML = `<span>${sym.emoji}</span><span class="sym-label">${sym.label}</span>`;
  return div;
}

// ── Render HUD ──────────────────────────────────────────────────────────────
function renderHUD() {
  balanceEl.textContent   = state.balance.toLocaleString();
  betEl.textContent       = state.bet.toLocaleString();
  winningsEl.textContent  = state.winnings.toLocaleString();
  spinCostEl.textContent  = state.bet.toLocaleString();
  betDown.disabled = state.bet <= 5;
  betUp.disabled   = state.bet >= Math.min(state.balance, 500);
  spinBtn.disabled = state.spinning || state.balance < state.bet;
}

// ── Populate paytable ───────────────────────────────────────────────────────
function buildPaytable() {
  const tbody = document.getElementById('paytable-body');
  // Three-of-a-kind entries
  for (const entry of PAYTABLE) {
    if (entry.combo[0] === '*') continue; // handle separately
    const sym0 = SYMBOLS.find(s => s.id === entry.combo[0]);
    const emojis = entry.combo.map(id => SYMBOLS.find(s => s.id === id).emoji).join(' ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emojis}</td>
      <td class="payout-cell">${entry.mult}×</td>
      <td>${entry.label}</td>
    `;
    tbody.appendChild(tr);
  }
  // Two-of-a-kind
  const tr2 = document.createElement('tr');
  tr2.innerHTML = `<td>Any two alike</td><td class="payout-cell">2×</td><td>✌️ Partial compute refund</td>`;
  tbody.appendChild(tr2);
  // Lose
  const trL = document.createElement('tr');
  trL.innerHTML = `<td>Anything else</td><td class="payout-cell" style="color:var(--red)">0×</td><td>🔥 Tokens incinerated</td>`;
  tbody.appendChild(trL);
}

// ── Check result ─────────────────────────────────────────────────────────────
function checkResult(ids) {
  // Three-of-a-kind
  for (const entry of PAYTABLE) {
    if (entry.combo[0] === '*') continue;
    if (ids[0] === entry.combo[0] && ids[1] === entry.combo[1] && ids[2] === entry.combo[2]) {
      return entry;
    }
  }
  // Two-of-a-kind
  if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) {
    return PAYTABLE.find(e => e.combo[0] === '*');
  }
  return null;
}

// ── Spin animation ───────────────────────────────────────────────────────────
function spinReel(reelIndex, finalSym, delayMs) {
  return new Promise(resolve => {
    const col   = document.getElementById(`reel-${reelIndex}`);
    const strip = document.getElementById(`strip-${reelIndex}`);

    col.classList.add('spinning');

    // How many full rotations (extra items to scroll past)
    const spinCount = 20 + reelIndex * 6 + Math.floor(Math.random() * 8);

    // Build a long strip of random symbols + the final symbol at the end
    strip.innerHTML = '';

    const totalItems = spinCount + 1;
    for (let i = 0; i < spinCount; i++) {
      strip.appendChild(makeSymbolEl(weightedPick(SYMBOLS)));
    }
    // Final (winning) symbol
    const finalEl = makeSymbolEl(finalSym);
    finalEl.classList.add('final-symbol');
    strip.appendChild(finalEl);

    const SYMBOL_H = 120;
    // We want the final symbol centered in the 120px window.
    // The window shows one symbol. finalSym is at index (totalItems - 1).
    // Target translateY = -(totalItems - 1) * SYMBOL_H
    const targetY = -(totalItems - 1) * SYMBOL_H;

    // Start off-screen at the top (translateY = 0)
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';

    // Force reflow
    strip.getBoundingClientRect();

    const duration = 1800 + reelIndex * 400 + Math.random() * 200;
    strip.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.05, 1.0)`;
    strip.style.transform = `translateY(${targetY}px)`;

    setTimeout(() => {
      col.classList.remove('spinning');
      resolve();
    }, duration + delayMs);
  });
}

// ── Coin burst ───────────────────────────────────────────────────────────────
function burstCoins(count) {
  const origin = reelsWindow.getBoundingClientRect();
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;

  for (let i = 0; i < count; i++) {
    const coin = document.createElement('div');
    coin.className = 'coin-burst';
    coin.textContent = '🪙';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist  = 80 + Math.random() * 120;
    const dx    = Math.cos(angle) * dist;
    const dy    = Math.sin(angle) * dist - 60;
    coin.style.cssText = `left:${cx}px;top:${cy}px;--dx:${dx}px;--dy:${dy}px;`;
    coin.style.animation = `coinFly ${0.6 + Math.random() * 0.4}s ease-out forwards`;
    document.body.appendChild(coin);
    setTimeout(() => coin.remove(), 1200);
  }
}

// ── Add history entry ────────────────────────────────────────────────────────
function addHistory(symbols, resultEntry, payout) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const li = document.createElement('li');
  const emojis = symbols.map(s => s.emoji).join('');
  let resultText, cls;
  if (!resultEntry) {
    resultText = `−${state.bet} tokens`;
    cls = 'lose';
  } else if (resultEntry.cls === 'jackpot') {
    resultText = `+${payout} tokens (JACKPOT!)`;
    cls = 'jackpot';
  } else {
    resultText = `+${payout} tokens`;
    cls = 'win';
  }
  li.innerHTML = `
    <span class="hist-symbols">${emojis}</span>
    <span class="hist-result ${cls}">${resultText}</span>
    <span class="hist-time">${time}</span>
  `;
  historyList.prepend(li);
  // Keep at most 50 entries
  while (historyList.children.length > 50) historyList.lastChild.remove();
}

// ── Main spin ────────────────────────────────────────────────────────────────
async function doSpin() {
  if (state.spinning || state.balance < state.bet) return;

  state.spinning = true;
  state.balance -= state.bet;
  renderHUD();

  // Hide result banner
  resultEl.className = 'result-banner';
  resultEl.textContent = '';

  // Lever animation
  leverEl.classList.add('pulled');
  setTimeout(() => leverEl.classList.remove('pulled'), 400);

  // Pick final symbols
  const finalSymbols = Array.from({ length: NUM_REELS }, () => weightedPick(SYMBOLS));

  // Spin all reels (staggered stop)
  await Promise.all(
    finalSymbols.map((sym, i) => spinReel(i, sym, i * 300))
  );

  // Evaluate
  const ids = finalSymbols.map(s => s.id);
  const resultEntry = checkResult(ids);

  if (resultEntry) {
    const payout = state.bet * resultEntry.mult;
    state.balance  += payout;
    state.winnings += payout;

    reelsWindow.classList.remove('win-flash', 'jackpot-flash');
    // Force reflow before re-adding class
    void reelsWindow.offsetWidth;
    reelsWindow.classList.add(resultEntry.cls === 'jackpot' ? 'jackpot-flash' : 'win-flash');

    burstCoins(resultEntry.cls === 'jackpot' ? 20 : 8);

    resultEl.textContent = `${resultEntry.label}  +${payout.toLocaleString()} tokens`;
    resultEl.className   = `result-banner show ${resultEntry.cls}`;

    addHistory(finalSymbols, resultEntry, payout);
  } else {
    const loseMsg = LOSE_MESSAGES[Math.floor(Math.random() * LOSE_MESSAGES.length)];
    resultEl.textContent = loseMsg;
    resultEl.className   = 'result-banner show lose';
    addHistory(finalSymbols, null, 0);
  }

  renderHUD();
  state.spinning = false;
  renderHUD();

  // Game over?
  if (state.balance < 5) {
    setTimeout(showGameOver, 600);
  }
}

// ── Game Over ────────────────────────────────────────────────────────────────
function showGameOver() {
  const overlay = document.createElement('div');
  overlay.className = 'game-over-overlay';
  overlay.innerHTML = `
    <h2>🪦 Out of Tokens</h2>
    <p>The AI has consumed your entire token budget.<br>Classic. This is fine. Everything is fine.</p>
    <p style="color:var(--gold);font-size:.85rem">You won a total of <strong>${state.winnings.toLocaleString()}</strong> tokens this session.</p>
    <button id="restart-btn">Inject More Tokens</button>
  `;
  document.body.appendChild(overlay);
  document.getElementById('restart-btn').addEventListener('click', () => {
    overlay.remove();
    state.balance  = 1000;
    state.winnings = 0;
    state.bet      = 10;
    historyList.innerHTML = '';
    buildStrips();
    resultEl.className = 'result-banner';
    renderHUD();
  });
}

// ── Bet controls ─────────────────────────────────────────────────────────────
betDown.addEventListener('click', () => {
  if (state.bet > 5) {
    state.bet = Math.max(5, state.bet - 5);
    renderHUD();
  }
});
betUp.addEventListener('click', () => {
  state.bet = Math.min(Math.min(state.balance, 500), state.bet + 5);
  renderHUD();
});

// ── Spin triggers ─────────────────────────────────────────────────────────────
spinBtn.addEventListener('click', doSpin);
leverWrap.addEventListener('click', doSpin);

// Spacebar / Enter shortcut
document.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && !state.spinning) {
    e.preventDefault();
    doSpin();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
buildStrips();
buildPaytable();
renderHUD();
