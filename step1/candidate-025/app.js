'use strict';

/* ====================================================
   AI TOKEN CASINO — app.js
   Vanilla JS slot machine where you win/spend tokens.
   ==================================================== */

// ── SYMBOLS ────────────────────────────────────────────────────────────────
const SYMBOLS = [
  { emoji: '🤖', name: 'Robot',       weight: 20 },
  { emoji: '🪙', name: 'Token',       weight: 18 },
  { emoji: '🧠', name: 'LLM Brain',   weight: 15 },
  { emoji: '📡', name: 'API Call',    weight: 12 },
  { emoji: '🔥', name: 'Context Fire',weight: 10 },
  { emoji: '💀', name: 'Rate Limit',  weight:  8 },
  { emoji: '🦙', name: 'Open Llama',  weight:  7 },
  { emoji: '🌀', name: 'Hallucination',weight: 6 },
  { emoji: '💎', name: 'GPT-4',       weight:  3 },
  { emoji: '⭐', name: 'JACKPOT',     weight:  1 },
];

// Build weighted pool for O(1) sampling
const POOL = [];
SYMBOLS.forEach(s => { for (let i = 0; i < s.weight; i++) POOL.push(s); });

function pickSymbol() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

// ── PAY TABLE ──────────────────────────────────────────────────────────────
// Each entry: [emoji, multiplier, label]
const PAY_RULES = [
  { syms: ['⭐','⭐','⭐'], mult: 100, label: 'JACKPOT — You are now a ChatGPT Plus subscriber', jackpot: true },
  { syms: ['💎','💎','💎'], mult:  50, label: 'AGI Achieved (not really)' },
  { syms: ['🦙','🦙','🦙'], mult:  25, label: 'Open-source moment! Token flood!' },
  { syms: ['🤖','🤖','🤖'], mult:  15, label: 'Three robots for the price of one inference' },
  { syms: ['🧠','🧠','🧠'], mult:  12, label: 'Big brain energy — context window maxed' },
  { syms: ['🪙','🪙','🪙'], mult:  10, label: 'Token inception — tokens won tokens' },
  { syms: ['🔥','🔥','🔥'], mult:   8, label: 'Context window on fire! Extra tokens from the ashes' },
  { syms: ['📡','📡','📡'], mult:   6, label: '3× API calls responded! Budget refunded' },
  { syms: ['🌀','🌀','🌀'], mult:   4, label: 'Hallucinated a win — still counts!' },
  { syms: ['💀','💀','💀'], mult:   2, label: 'Rate-limited but survived — tiny consolation' },
  // Two-of-a-kind
  { syms: ['⭐','⭐', null], mult:   5, label: 'Near jackpot — system is thinking…' },
  { syms: ['💎','💎', null], mult:   3, label: 'Two GPT-4s walk into a bar…' },
];

// ── FLAVOUR TEXT ───────────────────────────────────────────────────────────
const LOSE_MSGS = [
  'Tokens burned on inference.',
  'The model is confident it lost your tokens.',
  'Temperature too high. Try again.',
  '"As an AI, I cannot be blamed for this loss."',
  'Tokens sent to the context graveyard.',
  'Loss is just a feature. Not a bug.',
  'Insufficient tokens for meaningful output.',
  'Model hallucinated a win — it was wrong.',
  'Your context window is now sad.',
  'Fine-tuning on your losses…',
  '404: Lucky tokens not found.',
  'Epoch 1/1 — loss: very high.',
  'Tokens deprecated in this run.',
];

const WIN_MSGS = [
  'Inference complete. Tokens minted!',
  'Positive reward signal detected!',
  'Gradient descent found profits!',
  'Model aligned with your wallet.',
  'Prompt engineering pays off!',
  'Training data included a jackpot.',
  'Lucky seed! Token surplus achieved.',
];

// ── STATE ──────────────────────────────────────────────────────────────────
const STATE = {
  tokens:    100,
  bet:       10,
  spinning:  false,
  history:   [],
  spinCount: 0,
};

const BET_MIN = 1;
const BET_MAX = 100;
const BET_STEP = 5;
const RECHARGE_AMOUNT = 50;
const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;  // symbols visible per reel (we show 3 but centre is the result)
const STRIP_LEN = 30;    // symbols in each virtual strip

// ── DOM REFS ───────────────────────────────────────────────────────────────
const elTokenCount   = document.getElementById('token-count');
const elBetAmount    = document.getElementById('bet-amount');
const elResultBanner = document.getElementById('result-banner');
const elResultText   = document.getElementById('result-text');
const elLeverBtn     = document.getElementById('lever-btn');
const elBetDown      = document.getElementById('bet-down');
const elBetUp        = document.getElementById('bet-up');
const elMaxBet       = document.getElementById('btn-max-bet');
const elRecharge     = document.getElementById('btn-recharge');
const elHistoryList  = document.getElementById('history-list');
const elPaytableGrid = document.getElementById('paytable-grid');
const elMachine      = document.querySelector('.machine');
const elConfetti     = document.getElementById('confetti-layer');

// Reel inners
const reelInners = Array.from({ length: REEL_COUNT }, (_, i) =>
  document.getElementById(`reel-inner-${i}`)
);
const reelEls = Array.from({ length: REEL_COUNT }, (_, i) =>
  document.getElementById(`reel-${i}`)
);

// ── AUDIO (Web Audio API, no external files needed) ────────────────────────
const audioCtx = (() => {
  try { return new (window.AudioContext || window.webkitAudioContext)(); }
  catch { return null; }
})();

function playTone(freq, type = 'sine', duration = 0.12, vol = 0.15, delay = 0) {
  if (!audioCtx) return;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
  osc.start(audioCtx.currentTime + delay);
  osc.stop(audioCtx.currentTime + delay + duration + 0.01);
}

function sfxSpin() {
  // Descending whir
  for (let i = 0; i < 6; i++) playTone(300 - i * 20, 'sawtooth', 0.07, 0.08, i * 0.06);
}

function sfxClick() {
  playTone(220, 'square', 0.05, 0.1);
}

function sfxWin(mult) {
  const notes = [523, 659, 784, 1046];
  notes.forEach((f, i) => playTone(f, 'sine', 0.15, 0.18, i * 0.1));
}

function sfxJackpot() {
  const melody = [523,659,784,1046,1318,1046,784,1318,1046];
  melody.forEach((f, i) => playTone(f, 'sine', 0.2, 0.25, i * 0.08));
}

function sfxLose() {
  playTone(220, 'sawtooth', 0.08, 0.12, 0);
  playTone(180, 'sawtooth', 0.1,  0.12, 0.1);
}

// ── REEL RENDERING ─────────────────────────────────────────────────────────
// Each reel has a strip of random symbols. We animate by translating the inner div.
const STRIPS = Array.from({ length: REEL_COUNT }, () =>
  Array.from({ length: STRIP_LEN }, () => pickSymbol())
);

const SYM_H = 64; // must match --symbol-sz in CSS (px)

// Current reel positions (index into strip, float)
const reelPos = Array(REEL_COUNT).fill(0);

function buildReels() {
  reelInners.forEach((inner, ri) => {
    inner.innerHTML = '';
    // Render two copies of the strip so we can loop seamlessly
    [...STRIPS[ri], ...STRIPS[ri]].forEach(sym => {
      const div = document.createElement('div');
      div.className = 'reel-symbol';
      div.textContent = sym.emoji;
      div.setAttribute('aria-label', sym.name);
      inner.appendChild(div);
    });
    positionReel(ri, reelPos[ri]);
  });
}

function positionReel(ri, pos) {
  // Centre the strip on the target position (offset so centre symbol is in the middle of the reel)
  const reelH  = reelEls[ri].clientHeight || 110;
  const offset = -pos * SYM_H + (reelH / 2) - SYM_H / 2;
  reelInners[ri].style.transform = `translateY(${offset}px)`;
}

// ── SPIN LOGIC ─────────────────────────────────────────────────────────────
function evaluate(results) {
  const emojis = results.map(s => s.emoji);

  for (const rule of PAY_RULES) {
    if (rule.syms[2] === null) {
      // Two-of-a-kind check (first two)
      if (emojis[0] === rule.syms[0] && emojis[1] === rule.syms[1]) return rule;
    } else {
      if (emojis[0] === rule.syms[0] && emojis[1] === rule.syms[1] && emojis[2] === rule.syms[2]) return rule;
    }
  }
  return null;
}

async function spin() {
  if (STATE.spinning) return;
  if (STATE.tokens < STATE.bet) {
    shake();
    showResult('Not enough tokens! Ask for more context. 🙏', 'lose');
    return;
  }

  // Resume audio context if suspended (browser autoplay policy)
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  STATE.spinning = true;
  STATE.tokens  -= STATE.bet;
  STATE.spinCount++;
  updateTokenDisplay();
  setControlsEnabled(false);
  elLeverBtn.classList.add('spinning');
  clearResult();

  sfxSpin();

  // Pick final results now
  const results = Array.from({ length: REEL_COUNT }, () => pickSymbol());

  // For each reel, spin for a different duration, then land on result
  const spinPromises = results.map((sym, ri) => spinReel(ri, sym, ri));
  await Promise.all(spinPromises);

  // Evaluate
  const rule = evaluate(results);
  let delta = 0;
  let msg   = '';
  let cls   = 'lose';

  if (rule) {
    delta = STATE.bet * rule.mult;
    STATE.tokens += delta;
    msg = `+${delta} tokens — ${rule.label}`;
    cls = rule.jackpot ? 'jackpot' : 'win';
    if (rule.jackpot) {
      sfxJackpot();
      launchConfetti(80);
      elMachine.classList.add('jackpot-flash');
      setTimeout(() => elMachine.classList.remove('jackpot-flash'), 2200);
    } else {
      sfxWin(rule.mult);
      if (rule.mult >= 10) launchConfetti(30);
    }
  } else {
    const loseMsg = LOSE_MSGS[STATE.spinCount % LOSE_MSGS.length];
    msg = `−${STATE.bet} tokens — ${loseMsg}`;
    cls = 'lose';
    sfxLose();
  }

  updateTokenDisplay();
  showResult(msg, cls);
  addHistory(results, delta === 0 ? -STATE.bet : delta - STATE.bet, cls, results.map(s=>s.emoji).join(' '));

  STATE.spinning = false;
  elLeverBtn.classList.remove('spinning');
  setControlsEnabled(true);
}

function spinReel(ri, targetSymbol, reelIndex) {
  return new Promise(resolve => {
    const totalDuration = 600 + reelIndex * 250; // ms — each reel stops later
    const fps = 60;
    const frameMs = 1000 / fps;
    let elapsed = 0;
    const startPos = reelPos[ri];

    // Target index: find this symbol in the strip (or use a random one)
    let targetIdx = STRIPS[ri].findIndex(s => s.emoji === targetSymbol.emoji);
    if (targetIdx === -1) {
      // Not in strip naturally — swap a random position
      const swapIdx = Math.floor(Math.random() * STRIP_LEN);
      STRIPS[ri][swapIdx] = targetSymbol;
      rebuildReelStrip(ri);
      targetIdx = swapIdx;
    }

    // Spin at least a couple full loops then land on target
    const extraLoops = 3 + reelIndex;
    const landPos = targetIdx + extraLoops * STRIP_LEN;
    const totalFrames = Math.ceil(totalDuration / frameMs);

    reelEls[ri].classList.add('spinning');
    reelEls[ri].style.setProperty('--spin-dur', `${totalDuration}ms`);

    let frame = 0;
    const ticker = setInterval(() => {
      frame++;
      const t = frame / totalFrames;
      // Ease out — fast then slow
      const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
      const pos = startPos + (landPos - startPos) * eased;
      reelPos[ri] = pos % STRIP_LEN;
      positionReel(ri, reelPos[ri]);

      if (frame >= totalFrames) {
        clearInterval(ticker);
        reelPos[ri] = targetIdx;
        positionReel(ri, targetIdx);
        reelEls[ri].classList.remove('spinning');
        resolve();
      }
    }, frameMs);
  });
}

function rebuildReelStrip(ri) {
  const inner = reelInners[ri];
  inner.innerHTML = '';
  [...STRIPS[ri], ...STRIPS[ri]].forEach(sym => {
    const div = document.createElement('div');
    div.className = 'reel-symbol';
    div.textContent = sym.emoji;
    div.setAttribute('aria-label', sym.name);
    inner.appendChild(div);
  });
}

// ── UI HELPERS ─────────────────────────────────────────────────────────────
function updateTokenDisplay() {
  elTokenCount.textContent = STATE.tokens;
  // Clamp bet if needed
  if (STATE.bet > STATE.tokens && STATE.tokens > 0) {
    STATE.bet = Math.max(BET_MIN, Math.floor(STATE.tokens / BET_STEP) * BET_STEP || 1);
    elBetAmount.textContent = STATE.bet;
  }
}

function showResult(msg, cls) {
  elResultBanner.className = `result-banner ${cls}`;
  elResultText.textContent = msg;
}

function clearResult() {
  elResultBanner.className = 'result-banner';
  elResultText.textContent = 'Spinning…';
}

function setControlsEnabled(enabled) {
  elLeverBtn.disabled = !enabled;
  elBetDown.disabled  = !enabled;
  elBetUp.disabled    = !enabled;
  elMaxBet.disabled   = !enabled;
  elRecharge.disabled = !enabled;
}

function shake() {
  elMachine.style.animation = 'none';
  requestAnimationFrame(() => {
    elMachine.style.animation = '';
    elMachine.classList.add('shake');
    setTimeout(() => elMachine.classList.remove('shake'), 500);
  });
}

function addHistory(results, netDelta, cls, symbolStr) {
  const flavours = cls === 'win' ? WIN_MSGS : LOSE_MSGS;
  const item = document.createElement('li');
  item.className = `history-item h-${cls}`;
  const sign = netDelta >= 0 ? '+' : '';
  item.innerHTML = `
    <span class="h-symbols">${symbolStr}</span>
    <span class="h-msg">${flavours[Math.floor(Math.random() * flavours.length)]}</span>
    <span class="h-delta">${sign}${netDelta}</span>
  `;
  elHistoryList.prepend(item);
  // Keep max 20 items
  while (elHistoryList.children.length > 20) {
    elHistoryList.removeChild(elHistoryList.lastChild);
  }
  STATE.history.push({ symbolStr, netDelta, cls });
}

// ── CONFETTI ───────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#ffd700','#6c63ff','#ff6584','#00e676','#40c4ff','#fff'];

function launchConfetti(count) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left       = `${Math.random() * 100}%`;
      el.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      el.style.width      = `${6 + Math.random() * 8}px`;
      el.style.height     = `${6 + Math.random() * 8}px`;
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      const dur = 1.5 + Math.random() * 1.5;
      el.style.animationDuration  = `${dur}s`;
      el.style.animationTimingFunction = 'cubic-bezier(.25,.46,.45,.94)';
      elConfetti.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }, i * 18);
  }
}

// ── PAYTABLE RENDER ────────────────────────────────────────────────────────
function renderPaytable() {
  elPaytableGrid.innerHTML = '';
  PAY_RULES.forEach(rule => {
    const row = document.createElement('div');
    row.className = 'pay-row';
    const symDisplay = rule.syms[2] === null
      ? rule.syms.slice(0,2).join('') + '❓'
      : rule.syms.join('');
    row.innerHTML = `
      <span class="pay-symbols">${symDisplay}</span>
      <span class="pay-label">${rule.label.split('—')[0].trim()}</span>
      <span class="pay-mult">${rule.mult}×</span>
    `;
    elPaytableGrid.appendChild(row);
  });
}

// ── EVENT LISTENERS ────────────────────────────────────────────────────────
elLeverBtn.addEventListener('click', () => { sfxClick(); spin(); });

elBetDown.addEventListener('click', () => {
  sfxClick();
  STATE.bet = Math.max(BET_MIN, STATE.bet - BET_STEP);
  elBetAmount.textContent = STATE.bet;
});
elBetUp.addEventListener('click', () => {
  sfxClick();
  STATE.bet = Math.min(BET_MAX, STATE.bet + BET_STEP);
  elBetAmount.textContent = STATE.bet;
});
elMaxBet.addEventListener('click', () => {
  sfxClick();
  STATE.bet = Math.min(BET_MAX, STATE.tokens);
  elBetAmount.textContent = STATE.bet;
});
elRecharge.addEventListener('click', () => {
  sfxClick();
  STATE.tokens += RECHARGE_AMOUNT;
  updateTokenDisplay();
  showResult(`⚡ +${RECHARGE_AMOUNT} tokens injected via API call. Your credit card weeps.`, 'win');
  launchConfetti(15);
});

// Keyboard shortcut: Space / Enter to spin
document.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && !STATE.spinning) {
    e.preventDefault();
    spin();
  }
});

// ── INIT ───────────────────────────────────────────────────────────────────
buildReels();
renderPaytable();
updateTokenDisplay();

// Cheap CSS shake keyframe via JS (avoids needing it in CSS)
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-8px)}
    40%{transform:translateX(8px)}
    60%{transform:translateX(-5px)}
    80%{transform:translateX(5px)}
  }
  .machine.shake { animation: shake 0.4s ease; }
`;
document.head.appendChild(styleEl);
