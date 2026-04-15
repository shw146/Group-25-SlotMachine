"use strict";

/* ================================================================
   game.js — Hallucinato-Matic 9000

   Sections (search by ── tag):
     1. SYMBOL TABLE & POOL
     2. REEL GEOMETRY CONSTANTS
     3. GAME CONSTANTS (replaces all magic numbers)
     4. GAME STATE
     5. DOM REFERENCES
     6. REEL STRIP BUILDER
     7. REEL SPIN ANIMATION (two-phase deceleration)
     8. WIN EVALUATION (middle row only)
     9. MAIN SPIN FUNCTION
    10. RESULT EFFECTS (flash, coins, particles)
    11. DRAGGABLE LEVER
    12. BET CONTROLS (+ / −)
    13. TOP-UP BUTTON
    14. KEYBOARD SHORTCUT (SPACE)
    15. SPIN HISTORY LOG
    16. UI UPDATE HELPERS
    17. GAME RESET
    18. WEB AUDIO
    19. MACHINE LIGHTS
    20. DARK / LIGHT MODE TOGGLE
    21. EVENT WIRING & INIT
   ================================================================ */

/* ================================================================
   ── 1. SYMBOL TABLE & POOL ──────────────────────────────────────
   AI-themed symbols instead of classic fruit.
     e   — the emoji displayed in the reel cell
     pay — payout multiplier for 3-of-a-kind on the middle row
     w   — spawn weight (higher = more common)
   ================================================================ */
const SYMBOLS = [
  { e: "🤖", pay: 2,   w: 30, label: "BASE MODEL"  }, // most common
  { e: "💬", pay: 3,   w: 25, label: "CONTEXT"     }, // common
  { e: "📊", pay: 5,   w: 20, label: "OVERFIT"     }, // medium
  { e: "🧠", pay: 8,   w: 15, label: "EMERGENT"    }, // medium-rare
  { e: "⚡", pay: 15,  w: 7,  label: "MELTDOWN"    }, // rare
  { e: "🔮", pay: 50,  w: 2,  label: "HALLUCIN."   }, // very rare
  { e: "🎯", pay: 100, w: 1,  label: "CORRECT!"    }, // jackpot (rarest)
];

// Build the weighted pool once at startup.
const POOL = [];
for (const sym of SYMBOLS) {
  for (let i = 0; i < sym.w; i++) POOL.push(sym.e);
}

// Fast emoji → multiplier lookup
const PAY_TABLE   = Object.fromEntries(SYMBOLS.map((s) => [s.e, s.pay]));
// Fast emoji → label lookup
const LABEL_TABLE = Object.fromEntries(SYMBOLS.map((s) => [s.e, s.label]));

/* ================================================================
   ── 2. REEL GEOMETRY CONSTANTS ─────────────────────────────────
   The reel viewport shows exactly 3 symbol rows at once.
   Behind the scenes each reel has a tall "strip" of STRIP cells
   that scrolls vertically via CSS translateY.

   LAND is the strip index that lands on the middle payline row.
   END_Y is the final translateY (negative px) for that position.
   Two-phase animation: fast linear → slow ease-out deceleration.
   ================================================================ */
const CELL_H       = 90;              // px — must match CSS --cell-h
const STRIP        = 42;             // total cells in each reel strip
const LAND         = 36;             // strip index for the middle-row cell
const END_Y        = -(LAND - 1) * CELL_H; // final translateY (negative, px)
const PHASE1_STOP  = CELL_H * 2.5;  // px before END_Y where fast phase ends
const PHASE2_DUR   = 700;           // ms for the slow deceleration phase

// Per-reel fast-phase duration — staggered for left-to-right stop effect
const PHASE1_DURS = [1300, 1680, 2060]; // ms for reel 0, 1, 2

/* ================================================================
   ── 3. GAME CONSTANTS (no magic numbers below this section) ─────
   All numeric literals that carry semantic meaning are declared
   here so they can be understood and changed in one place.
   ================================================================ */

// Economy
const INITIAL_BALANCE   = 100;   // starting balance in dollars
const INITIAL_BET       = 5;     // default bet per spin
const MIN_BET           = 1;     // minimum allowed bet
const MAX_BET           = 500;   // maximum allowed bet
const TOPUP_AMOUNT      = 100;   // dollars added per top-up

// Win evaluation
const PAIR_PAYOUT_MULT      = 1.5;  // multiplier for any two matching symbols
const JACKPOT_THRESHOLD_MULT = 50;  // payout >= bet × this → jackpot category

// Reel animation
const REEL_BOUNCE_MS     = 110;  // duration of the physical stop-bounce

// Lever
const LEVER_HANDLE_H     = 44;   // px — matches .lever-handle CSS height
const LEVER_PADDING      = 4;    // px — gap between handle edge and track top
const LEVER_TRIGGER_PCT  = 0.6;  // fraction of max travel that triggers a spin
const LEVER_SPIN_DELAY_MS = 220; // ms to wait after release before calling spin()

// Celebration & particles
const JACKPOT_CELEBRATE_MS  = 3000; // ms the machine "celebrates" after jackpot
const JACKPOT_COIN_COUNT    = 32;   // coins burst on jackpot
const WIN_COIN_COUNT        = 14;   // coins burst on regular win
const JACKPOT_PARTICLE_COUNT = 24;  // emoji particles on jackpot

// Decorative lights
const LIGHT_COUNT        = 12;   // number of LED bulbs in the strip
const LIGHT_DELAY_STEP_S = 0.16; // seconds between each bulb's pulse delay

/* ================================================================
   ── 4. GAME STATE ───────────────────────────────────────────────
   ================================================================ */
let balance    = INITIAL_BALANCE;
let wagered    = 0;
let currentBet = INITIAL_BET;

let spinCount = 0;
let winCount  = 0;
let bestWin   = 0;

let busy     = false;
let audioCtx = null;

// Persistent spin-sound nodes — stopped when all reels finish
let spinNoiseNode = null;
let spinNoiseGain = null;

/* ================================================================
   ── 5. DOM REFERENCES ───────────────────────────────────────────
   ================================================================ */
const elBalance    = document.getElementById("el-balance");
const elWagered    = document.getElementById("el-wagered");
const elMsg        = document.getElementById("el-msg");
const elSpins      = document.getElementById("el-spins");
const elWins       = document.getElementById("el-wins");
const elBest       = document.getElementById("el-best");
const elBetDisplay = document.getElementById("bet-display");
const spinBtn      = document.getElementById("spin-btn");
const betMinus     = document.getElementById("bet-minus");
const betPlus      = document.getElementById("bet-plus");
const topupBtn     = document.getElementById("topup-btn");
const flashEl      = document.getElementById("flash");
const paylineOvEl  = document.getElementById("payline-overlay");
const machineEl    = document.getElementById("machine");
const logEl        = document.getElementById("log-entries");
const clearLogBtn  = document.getElementById("clear-log");
const themeToggle  = document.getElementById("theme-toggle");

const tracks  = [0, 1, 2].map((i) => document.getElementById(`track-${i}`));
const reelEls = [0, 1, 2].map((i) => document.getElementById(`reel-${i}`));
const leverTrackEl  = document.getElementById("lever-track");
const leverHandleEl = document.getElementById("lever-handle");

/* ================================================================
   ── 6. REEL STRIP BUILDER ───────────────────────────────────────
   ================================================================ */
function setCellContent(cell, sym) {
  const label = LABEL_TABLE[sym] || "";
  const emojiSpan = document.createElement("span");
  emojiSpan.className   = "sym-emoji";
  emojiSpan.textContent = sym;
  const labelSpan = document.createElement("span");
  labelSpan.className   = "sym-label";
  labelSpan.textContent = label;
  cell.appendChild(emojiSpan);
  cell.appendChild(labelSpan);
}

function buildStrip(track, topSym, midSym, botSym) {
  track.innerHTML = "";

  for (let i = 0; i < STRIP; i++) {
    const cell = document.createElement("div");
    cell.className = "reel-cell";

    if      (i === LAND - 1) setCellContent(cell, topSym);
    else if (i === LAND)     setCellContent(cell, midSym);
    else if (i === LAND + 1) setCellContent(cell, botSym);
    else                     setCellContent(cell, randomSymbol());

    track.appendChild(cell);
  }
}

function randomSymbol() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ================================================================
   ── 7. REEL SPIN ANIMATION (two-phase deceleration) ─────────────
   Phase 1: linear / fast  →  Phase 2: cubic-bezier ease-out / slow
   Returns a Promise that resolves when Phase 2 finishes.
   ================================================================ */
function spinReel(idx, topSym, midSym, botSym) {
  return new Promise((resolve) => {
    const track = tracks[idx];

    for (const anim of track.getAnimations()) anim.cancel();

    buildStrip(track, topSym, midSym, botSym);

    track.style.transition = "none";
    track.style.transform  = "translateY(0px)";
    void track.getBoundingClientRect(); // force layout flush

    const fastEndY = END_Y + PHASE1_STOP;

    const phase1 = track.animate(
      [
        { transform: "translateY(0px)" },
        { transform: `translateY(${fastEndY}px)` },
      ],
      { duration: PHASE1_DURS[idx], easing: "linear", fill: "forwards" },
    );

    phase1.addEventListener("finish", () => {
      track.style.transform = `translateY(${fastEndY}px)`;
      phase1.cancel();

      const phase2 = track.animate(
        [
          { transform: `translateY(${fastEndY}px)` },
          { transform: `translateY(${END_Y}px)` },
        ],
        {
          duration: PHASE2_DUR,
          easing: "cubic-bezier(0.12, 0.82, 0.36, 1)",
          fill: "forwards",
        },
      );

      phase2.addEventListener("finish", () => {
        track.style.transform = `translateY(${END_Y}px)`;
        phase2.cancel();

        reelEls[idx].animate(
          [{ transform: "scaleY(1.04)" }, { transform: "scaleY(1.00)" }],
          { duration: REEL_BOUNCE_MS, easing: "ease-out" },
        );

        playClick();
        resolve();
      });
    });
  });
}

/* ================================================================
   ── 8. WIN EVALUATION (middle row only) ─────────────────────────
   3-of-a-kind  → bet × PAY_TABLE[symbol]
   Any two matching → bet × PAIR_PAYOUT_MULT
   No match → 0
   ================================================================ */
function evaluateLine(row, bet) {
  const [a, b, c] = row;

  if (a === b && b === c) {
    return Math.round(bet * (PAY_TABLE[a] ?? 2));
  }

  if (a === b || b === c || a === c) {
    return Math.round(bet * PAIR_PAYOUT_MULT);
  }

  return 0;
}

/* ================================================================
   ── 9. MAIN SPIN FUNCTION ───────────────────────────────────────
   ================================================================ */
async function spin() {
  if (busy) return;

  if (balance < currentBet) {
    setMsg(`Not enough tokens! Inject funds with "Inject $100" or lower your bet.`, "lose");
    return;
  }

  busy = true;
  spinBtn.disabled  = true;
  betMinus.disabled = true;
  betPlus.disabled  = true;

  balance    -= currentBet;
  wagered    += currentBet;
  spinCount++;
  updateUI();

  reelEls.forEach((r) => r.classList.remove("winning"));
  paylineOvEl.classList.remove("win");

  const SPIN_MSGS = [
    "Querying the model… 🤞",
    "Burning electricity… please hold. 🔥",
    "Stochastically hallucinating your outcome… 🤖",
    "Asking the AI nicely… it's ignoring the question. 💬",
    "Running inference on vibes-based data… 📊",
    "Consuming $40 of compute for this spin… ⚡",
  ];
  setMsg(pick(SPIN_MSGS), "");
  startSpinSound(); // continuous mechanical noise throughout the spin

  const topRow    = [randomSymbol(), randomSymbol(), randomSymbol()];
  const middleRow = [randomSymbol(), randomSymbol(), randomSymbol()];
  const bottomRow = [randomSymbol(), randomSymbol(), randomSymbol()];

  await Promise.all(
    [0, 1, 2].map((idx) =>
      spinReel(idx, topRow[idx], middleRow[idx], bottomRow[idx]),
    ),
  );

  stopSpinSound(); // stop the looping noise now that all reels are settled

  const payout = evaluateLine(middleRow, currentBet);

  let kind;
  if (payout === 0) {
    kind = "lose";
  } else if (payout >= currentBet * JACKPOT_THRESHOLD_MULT) {
    kind = "jackpot";
  } else {
    kind = "win";
  }

  if (payout > 0) {
    balance += payout;
    winCount++;
    if (payout > bestWin) bestWin = payout;

    const [a, b, c] = middleRow;
    if (a === b && b === c) {
      reelEls.forEach((r) => r.classList.add("winning"));
    } else {
      if (a === b) { reelEls[0].classList.add("winning"); reelEls[1].classList.add("winning"); }
      if (b === c) { reelEls[1].classList.add("winning"); reelEls[2].classList.add("winning"); }
      if (a === c) { reelEls[0].classList.add("winning"); reelEls[2].classList.add("winning"); }
    }

    paylineOvEl.classList.add("win");
  }

  updateUI();
  showResult(middleRow, payout, kind);
  addLogEntry(spinCount, middleRow, payout, kind);

  busy              = false;
  betMinus.disabled = false;
  betPlus.disabled  = false;

  if (balance < MIN_BET) {
    spinBtn.innerHTML = '💸 BROKE — use "Inject $100" above';
    spinBtn.disabled = true;
  } else {
    spinBtn.disabled = false;
  }
}

/* ================================================================
   ── 10. RESULT EFFECTS ──────────────────────────────────────────
   ================================================================ */

// AI-mocking flavour messages
const WIN_MSGS = [
  "Even a broken model is right sometimes!",
  "The gradient descended into profit — for once.",
  "Reward function optimized. Barely.",
  "Fine-tuning paid off… accidentally.",
  "Positive reinforcement received!",
  "A local optimum that happens to be good.",
  "Your tokens were not wasted today.",
  "Congratulations! The hallucination accidentally aligned with reality.",
  "The model doesn't know why it won, but it's already claiming credit.",
  "One correct output in 47 attempts. Peak AI performance.",
  "This win was statistically inevitable. The model takes full credit.",
  "The training data contained exactly one example of winning. You found it.",
  "A stopped clock is right twice a day. Today is your day.",
  "The model fluked it. Don't let it write a blog post about this.",
];

const LOSE_MSGS = [
  "Insufficient training data for a win.",
  "The model confidently predicted wrong.",
  "Hallucinated a win but couldn't deliver.",
  "404: Win not found. Please try another prompt.",
  "The algorithm has spoken. Badly.",
  "Context window too small to fit a win.",
  "Alignment failed. Try again.",
  "The reels are just a stochastic parrot.",
  "Your prompt was not persuasive enough.",
  "Model output: loss.",
  "The AI regrets nothing. It was only following its reward function.",
  "Your loss has been logged as a 'learning opportunity.' Nothing will change.",
  "Insufficient GPU budget for a win.",
  "This loss was generated by a diffusion process. Very creative.",
  "Computation wasted. Entropy increased. The AI is thriving.",
  "The model was 97% confident this was a win. Same model. No notes.",
  "The AI politely disagrees with the concept of giving you money.",
  "Technically the reels did exactly what they were trained to do.",
  "The model saw the question. Chose chaos anyway.",
  "Your loss will be used to train the next version. Thank you for your sacrifice.",
];

function showResult(middleRow, payout, kind) {
  if (kind === "jackpot") {
    const sym = middleRow[0];
    const JACKPOT_MSGS = [
      `🎉 AGI ACHIEVED! ${sym}${sym}${sym} — mark this date in history! $${payout}!`,
      `🎉 IMPOSSIBLE! ${sym}${sym}${sym} — the model was right three times IN A ROW! $${payout}!`,
      `🎉 CALL THE PRESS! ${sym}${sym}${sym} — the AI did something correctly! $${payout}!`,
      `🎉 ALIGNMENT COMPLETE! ${sym}${sym}${sym} — it only took $${payout} to fix AI!`,
    ];
    setMsg(pick(JACKPOT_MSGS), "jackpot");
    triggerFlash("rgba(176,128,16,0.5)");
    burstParticles(["🎯", "🔮", "🤖", "💰", "🎉", "✨", "⚡"]);
    coinBurst(JACKPOT_COIN_COUNT);
    machineEl.classList.add("celebrating");
    setTimeout(() => machineEl.classList.remove("celebrating"), JACKPOT_CELEBRATE_MS);
    playJackpot();
  } else if (kind === "win") {
    setMsg(`+$${payout}! ${pick(WIN_MSGS)}`, "win");
    triggerFlash("rgba(26,122,58,0.35)");
    coinBurst(WIN_COIN_COUNT);
    playWin();
  } else {
    setMsg(pick(LOSE_MSGS), "lose");
    playLose();
  }
}

function setMsg(text, cls) {
  elMsg.className  = "msg " + cls;
  elMsg.textContent = text;
}

function triggerFlash(color) {
  flashEl.style.background = color;
  flashEl.animate([{ opacity: 0.7 }, { opacity: 0 }], {
    duration: 500,
    easing: "ease-out",
    fill: "forwards",
  });
}

function coinBurst(count) {
  const rect    = machineEl.getBoundingClientRect();
  const originY = rect.top + rect.height * 0.55;

  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const coin = document.createElement("div");
      coin.className   = "coin-particle";
      coin.textContent = "🪙";

      const startX = rect.left + rect.width * (0.1 + Math.random() * 0.8);
      coin.style.left = startX + "px";
      coin.style.top  = originY + "px";
      document.body.appendChild(coin);

      const angleDeg = -55 - Math.random() * 70; // upward arc
      const distance = 70 + Math.random() * 120;
      const rad      = angleDeg * (Math.PI / 180);

      coin.animate(
        [
          { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
          {
            transform: `translate(${Math.cos(rad) * distance}px,
                                   ${Math.sin(rad) * distance}px)
                        rotate(${480 + Math.random() * 360}deg) scale(0.35)`,
            opacity: 0,
          },
        ],
        { duration: 650 + Math.random() * 500, easing: "ease-out", fill: "forwards" },
      ).onfinish = () => coin.remove();
    }, i * 50);
  }
}

function burstParticles(emojis) {
  for (let i = 0; i < JACKPOT_PARTICLE_COUNT; i++) {
    setTimeout(() => {
      const p = document.createElement("div");
      p.className   = "burst-particle";
      p.textContent = pick(emojis);
      p.style.left  = 5 + Math.random() * 90 + "%";
      p.style.top   = 10 + Math.random() * 60 + "%";
      document.body.appendChild(p);

      p.animate(
        [
          { transform: "translateY(0) rotate(0) scale(1)", opacity: 1 },
          {
            transform: `translateY(${-70 - Math.random() * 80}px)
                        rotate(${(Math.random() - 0.5) * 600}deg) scale(0.2)`,
            opacity: 0,
          },
        ],
        { duration: 550 + Math.random() * 450, easing: "ease-out", fill: "forwards" },
      ).onfinish = () => p.remove();
    }, i * 35);
  }
}

/* ================================================================
   ── 11. DRAGGABLE LEVER ─────────────────────────────────────────
   LEVER_TRACK_H  = CELL_H × 3 = 270 px (matches CSS)
   LEVER_MAX_POS  = track height − handle height − padding
   LEVER_TRIGGER  = LEVER_MAX_POS × LEVER_TRIGGER_PCT (60%)
   ================================================================ */
const LEVER_TRACK_H  = CELL_H * 3;
const LEVER_MAX_POS  = LEVER_TRACK_H - LEVER_HANDLE_H - LEVER_PADDING;
const LEVER_TRIGGER  = LEVER_MAX_POS * LEVER_TRIGGER_PCT;

let leverDragging   = false;
let leverDragStartY = 0;
let leverDragBaseTop = 0;
let leverCurrentTop  = LEVER_PADDING;
let leverBusy        = false;

function setHandleTop(topPx, instant) {
  leverHandleEl.style.transition = instant
    ? "none"
    : "top 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s";
  leverHandleEl.style.top = topPx + "px";
}

function updateHandleColour(topPx) {
  if (topPx >= LEVER_TRIGGER) {
    leverHandleEl.classList.add("ready");
  } else {
    leverHandleEl.classList.remove("ready");
  }
}

function onLeverDown(e) {
  if (busy || leverBusy) return;
  leverDragging    = true;
  leverDragStartY  = e.touches ? e.touches[0].clientY : e.clientY;
  leverDragBaseTop = leverCurrentTop;
  setHandleTop(leverCurrentTop, true);
  e.preventDefault();
}

function onLeverMove(e) {
  if (!leverDragging) return;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const delta   = clientY - leverDragStartY;
  const newTop  = Math.max(LEVER_PADDING, Math.min(LEVER_MAX_POS, leverDragBaseTop + delta));
  leverCurrentTop = newTop;
  setHandleTop(newTop, true);
  updateHandleColour(newTop);
}

function onLeverUp() {
  if (!leverDragging) return;
  leverDragging = false;

  const triggered = leverCurrentTop >= LEVER_TRIGGER;
  leverCurrentTop = LEVER_PADDING;
  setHandleTop(LEVER_PADDING, false);
  leverHandleEl.classList.remove("ready");

  if (triggered && !busy && !leverBusy) {
    leverBusy = true;
    setTimeout(() => {
      leverBusy = false;
      spin();
    }, LEVER_SPIN_DELAY_MS);
  }
}

leverHandleEl.addEventListener("mousedown", onLeverDown);
leverHandleEl.addEventListener("touchstart", onLeverDown, { passive: false });
window.addEventListener("mousemove", onLeverMove);
window.addEventListener("touchmove", onLeverMove, { passive: false });
window.addEventListener("mouseup", onLeverUp);
window.addEventListener("touchend", onLeverUp);

leverTrackEl.addEventListener("click", (e) => {
  if (e.target !== leverHandleEl && !busy && !leverBusy) spin();
});

/* ================================================================
   ── 12. BET CONTROLS (+ / −) ────────────────────────────────────
   Step sizes:  ≤$10 → $1   ≤$50 → $5   ≤$100 → $10   >$100 → $25
   ================================================================ */
function betStep(bet) {
  if (bet <= 10)  return 1;
  if (bet <= 50)  return 5;
  if (bet <= 100) return 10;
  return 25;
}

function updateBetDisplay() {
  elBetDisplay.textContent = `$${currentBet}`;
  betMinus.disabled = currentBet <= MIN_BET;
  betPlus.disabled  = currentBet >= MAX_BET || currentBet >= balance;
}

betMinus.addEventListener("click", () => {
  if (busy) return;
  currentBet = Math.max(MIN_BET, currentBet - betStep(currentBet));
  updateBetDisplay();
});

betPlus.addEventListener("click", () => {
  if (busy) return;
  currentBet = Math.min(MAX_BET, balance, currentBet + betStep(currentBet));
  updateBetDisplay();
});

/* ================================================================
   ── 13. TOP-UP BUTTON ───────────────────────────────────────────
   ================================================================ */
function doTopUp() {
  balance += TOPUP_AMOUNT;
  currentBet = Math.min(currentBet, MAX_BET);
  updateBetDisplay();
  updateUI();

  setMsg(`+$${TOPUP_AMOUNT} injected! Balance: $${balance}`, "win");

  topupBtn.classList.remove("confirmed");
  void topupBtn.offsetWidth;
  topupBtn.classList.add("confirmed");
  topupBtn.addEventListener(
    "animationend",
    () => topupBtn.classList.remove("confirmed"),
    { once: true },
  );

  if (spinBtn.disabled && spinBtn.innerHTML.includes("BROKE")) {
    spinBtn.innerHTML = '🤖 SPIN <small class="spin-hint">SPACE</small>';
    spinBtn.disabled  = false;
  }
}

topupBtn.addEventListener("click", doTopUp);

/* ================================================================
   ── 14. KEYBOARD SHORTCUT (SPACE) ───────────────────────────────
   ================================================================ */
document.addEventListener("keydown", (e) => {
  if (
    (e.code === "Space" || e.key === " ") &&
    e.target.tagName !== "INPUT" &&
    e.target.tagName !== "TEXTAREA"
  ) {
    e.preventDefault();
    spin();
  }
});

/* ================================================================
   ── 15. SPIN HISTORY LOG ────────────────────────────────────────
   ================================================================ */
function addLogEntry(num, middleRow, payout, kind) {
  const placeholder = logEl.querySelector(".log-empty");
  if (placeholder) placeholder.remove();

  const entry = document.createElement("div");
  entry.className = `log-entry ${kind}`;

  const numEl = document.createElement("span");
  numEl.className   = "log-num";
  numEl.textContent = `#${num}`;

  const symEl = document.createElement("span");
  symEl.className   = "log-syms";
  symEl.textContent = middleRow.join(" ");

  const resEl = document.createElement("span");
  resEl.className   = "log-result";
  resEl.textContent = payout > 0 ? `+$${payout}` : `−$${currentBet}`;

  entry.append(numEl, symEl, resEl);
  logEl.insertBefore(entry, logEl.firstChild);
}

clearLogBtn.addEventListener("click", () => {
  logEl.innerHTML = '<p class="log-empty">History cleared.</p>';
});

/* ================================================================
   ── 16. UI UPDATE HELPERS ───────────────────────────────────────
   ================================================================ */
function updateUI() {
  elBalance.textContent = `$${balance}`;
  elWagered.textContent = `$${wagered}`;
  elSpins.textContent   = spinCount;
  elWins.textContent    = winCount;
  elBest.textContent    = `$${bestWin}`;
  updateBetDisplay();
}

/* ================================================================
   ── 17. GAME RESET ──────────────────────────────────────────────
   ================================================================ */
function resetGame() {
  balance    = INITIAL_BALANCE;
  wagered    = 0;
  currentBet = INITIAL_BET;
  spinCount  = 0;
  winCount   = 0;
  bestWin    = 0;
  busy       = false;

  tracks.forEach((t) => {
    buildStrip(t, randomSymbol(), randomSymbol(), randomSymbol());
    t.style.transform = `translateY(${END_Y}px)`;
  });

  reelEls.forEach((r) => r.classList.remove("winning"));
  paylineOvEl.classList.remove("win");

  spinBtn.innerHTML = '🤖 SPIN <small class="spin-hint">SPACE</small>';
  spinBtn.disabled  = false;
  spinBtn.onclick   = spin;

  updateUI();
  setMsg("Model reloaded. Good luck!", "");
}

/* ================================================================
   ── 18. WEB AUDIO ───────────────────────────────────────────────
   All sounds are synthesised via the Web Audio API — no audio
   files required. AudioContext is created lazily on first interaction.

   startSpinSound — looping mechanical whirr during the spin
   stopSpinSound  — fades out and stops the looping noise
   playClick      — mechanical "thunk" when each reel stops
   playWin        — ascending four-note chime
   playJackpot    — energetic eight-note fanfare
   playLose       — descending sawtooth "wah-wah"
   ================================================================ */
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Low-level helper: oscillator + short attack / exponential decay
function scheduleNote(ctx, freq, t, dur, vol = 0.15, type = "sine") {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type           = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.022);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.start(t);
  osc.stop(t + dur + 0.04);
}

/* startSpinSound — plays while the reels are spinning:
   1. Brief initial noise burst (mechanical "launch")
   2. Rising sawtooth tones (spinning up)
   3. Looping white noise (continuous mechanical rattle)  */
function startSpinSound() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;

    // 1. Initial burst
    const burstLen  = Math.floor(ctx.sampleRate * 0.11);
    const burstBuf  = ctx.createBuffer(1, burstLen, ctx.sampleRate);
    const burstData = burstBuf.getChannelData(0);
    for (let i = 0; i < burstLen; i++) burstData[i] = (Math.random() * 2 - 1) * 0.22;

    const burstSrc  = ctx.createBufferSource();
    burstSrc.buffer = burstBuf;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.18, t);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    burstSrc.connect(burstGain).connect(ctx.destination);
    burstSrc.start(t);
    burstSrc.stop(t + 0.18);

    // 2. Rising tones
    scheduleNote(ctx, 88,  t + 0.03, 0.25, 0.07, "sawtooth");
    scheduleNote(ctx, 125, t + 0.10, 0.18, 0.05, "sawtooth");

    // 3. Looping mechanical rattle (continuous throughout the spin)
    const loopLen  = Math.floor(ctx.sampleRate * 0.3);
    const loopBuf  = ctx.createBuffer(1, loopLen, ctx.sampleRate);
    const loopData = loopBuf.getChannelData(0);
    for (let i = 0; i < loopLen; i++) loopData[i] = (Math.random() * 2 - 1) * 0.18;

    spinNoiseNode        = ctx.createBufferSource();
    spinNoiseNode.buffer = loopBuf;
    spinNoiseNode.loop   = true;

    spinNoiseGain = ctx.createGain();
    spinNoiseGain.gain.setValueAtTime(0, t);
    spinNoiseGain.gain.linearRampToValueAtTime(0.06, t + 0.25);

    spinNoiseNode.connect(spinNoiseGain).connect(ctx.destination);
    spinNoiseNode.start(t + 0.1); // slight delay so the burst is heard first
  } catch (_) {
    /* audio is non-critical; silently skip errors */
  }
}

/* stopSpinSound — fades out and disconnects the looping spin noise */
function stopSpinSound() {
  try {
    if (!spinNoiseNode) return;
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;

    if (spinNoiseGain) {
      spinNoiseGain.gain.linearRampToValueAtTime(0, t + 0.12);
    }

    const nodeRef = spinNoiseNode;
    spinNoiseNode = null;
    spinNoiseGain = null;

    // Stop the source slightly after the gain reaches zero
    setTimeout(() => { try { nodeRef.stop(); } catch (_) {} }, 150);
  } catch (_) {}
}

// Mechanical click/thunk — played when each individual reel stops
function playClick() {
  try {
    const ctx = getAudioCtx();
    scheduleNote(ctx, 185, ctx.currentTime, 0.052, 0.12, "square");
  } catch (_) {}
}

// Win chime — four ascending notes (C5 → E5 → G5 → C6)
function playWin() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) =>
      scheduleNote(ctx, freq, t + i * 0.1, 0.22),
    );
  } catch (_) {}
}

// Jackpot fanfare — eight ascending notes with higher volume
function playJackpot() {
  try {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    [523, 587, 659, 784, 880, 988, 1047, 1319].forEach((freq, i) =>
      scheduleNote(ctx, freq, t + i * 0.07, 0.3, 0.2),
    );
  } catch (_) {}
}

// Loss sound — descending sawtooth (the classic "wah-wah" droop)
function playLose() {
  try {
    const ctx  = getAudioCtx();
    const t    = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    osc.start(t);
    osc.stop(t + 0.4);
  } catch (_) {}
}

/* ================================================================
   ── 19. MACHINE LIGHTS ──────────────────────────────────────────
   Builds LIGHT_COUNT LED elements with staggered pulse delays.
   ================================================================ */
function buildLights() {
  const container = document.getElementById("machine-lights");

  for (let i = 0; i < LIGHT_COUNT; i++) {
    const light = document.createElement("div");
    light.className           = "light";
    light.style.animationDelay = i * LIGHT_DELAY_STEP_S + "s";
    container.appendChild(light);
  }
}

/* ================================================================
   ── 20. DARK / LIGHT MODE TOGGLE ────────────────────────────────
   Toggles data-theme on <html>; persists choice to localStorage.
   ================================================================ */
function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  themeToggle.textContent = dark ? "☀️" : "🌙";
}

// Restore saved theme preference on load
const savedTheme = localStorage.getItem("hallucinato-theme");
applyTheme(savedTheme === "dark");

themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const next   = !isDark;
  applyTheme(next);
  localStorage.setItem("hallucinato-theme", next ? "dark" : "light");
});

/* ================================================================
   ── 21. EVENT WIRING & INIT ─────────────────────────────────────
   ================================================================ */

buildLights();

tracks.forEach((track) => {
  buildStrip(track, randomSymbol(), randomSymbol(), randomSymbol());
  track.style.transform = `translateY(${END_Y}px)`;
});

spinBtn.addEventListener("click", spin);

updateUI();
