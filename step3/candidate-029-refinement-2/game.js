"use strict";

/* ================================================================
   game.js — Lucky Strike Slot Machine

   Sections (search by ── tag):
     1. SYMBOL TABLE & POOL
     2. REEL GEOMETRY CONSTANTS
     3. GAME STATE
     4. DOM REFERENCES
     5. REEL STRIP BUILDER
     6. REEL SPIN ANIMATION (two-phase deceleration)
     7. WIN EVALUATION (middle row only)
     8. MAIN SPIN FUNCTION
     9. RESULT EFFECTS (flash, coins, particles)
    10. DRAGGABLE LEVER 
    11. BET CONTROLS (+ / −)
    12. TOP-UP BUTTON
    13. KEYBOARD SHORTCUT (SPACE)
    14. SPIN HISTORY LOG
    15. UI UPDATE HELPERS
    16. GAME RESET
    17. WEB AUDIO
    18. MACHINE LIGHTS
    19. EVENT WIRING & INIT
   ================================================================ */

/* ================================================================
   ── 1. SYMBOL TABLE & POOL ──────────────────────────────────────
   Each symbol has:
     e   — the emoji displayed in the reel cell
     pay — payout multiplier for 3-of-a-kind on the middle row
     w   — spawn weight (higher = more common)

   POOL is a flat array of emoji strings weighted by `w`, so that
   Math.random() * POOL.length gives the correct probability.
   PAY_TABLE maps emoji → multiplier for O(1) lookup during payout.
   ================================================================ */
const SYMBOLS = [
  { e: "🍒", pay: 2, w: 30 }, // Cherry  — most common
  { e: "🍋", pay: 3, w: 25 }, // Lemon   — common
  { e: "🍊", pay: 5, w: 20 }, // Orange  — medium
  { e: "🍇", pay: 8, w: 15 }, // Grape   — medium-rare
  { e: "⭐", pay: 15, w: 7 }, // Star    — rare
  { e: "💎", pay: 50, w: 2 }, // Diamond — very rare
  { e: "7️⃣", pay: 100, w: 1 }, // Seven   — jackpot (rarest)
];

// Build the weighted pool once at startup.
// Example: weight=3 → symbol appears 3 times in pool →
//          3/(total pool size) chance of being drawn.
const POOL = [];
for (const sym of SYMBOLS) {
  for (let i = 0; i < sym.w; i++) POOL.push(sym.e);
}

// Fast emoji → multiplier lookup
const PAY_TABLE = Object.fromEntries(SYMBOLS.map((s) => [s.e, s.pay]));

/* ================================================================
   ── 2. REEL GEOMETRY CONSTANTS ─────────────────────────────────
   The reel viewport shows exactly 3 symbol rows at once.
   Behind the scenes each reel has a tall "strip" of STRIP cells
   that scrolls vertically via CSS translateY.

   LAND is the strip index of the symbol that lands on the middle
   payline row after animation. Cells LAND-1 and LAND+1 appear in
   the top and bottom rows respectively.

   END_Y is the translateY (negative, in pixels) that positions
   cell[LAND-1] at the very top of the 3-row viewport window:
     top row    = cell[LAND-1]  (viewport y = 0)
     middle row = cell[LAND]    (viewport y = CELL_H)   ← payline
     bottom row = cell[LAND+1]  (viewport y = 2 × CELL_H)

   Two-phase animation for a realistic deceleration:
     Phase 1 (linear / fast):  scroll from y=0 down to END_Y + PHASE1_STOP
     Phase 2 (ease-out / slow): crawl the remaining PHASE1_STOP pixels
                                 into the final END_Y position
   ================================================================ */
const CELL_H = 90; // px — must match CSS --cell-h
const STRIP = 42; // total cells in each reel strip
const LAND = 36; // strip index for the middle-row result cell
const END_Y = -(LAND - 1) * CELL_H; // final translateY (negative, px)
const PHASE1_STOP = CELL_H * 2.5; // px before END_Y where fast phase ends
const PHASE2_DUR = 700; // ms for the slow deceleration phase

// Per-reel fast-phase duration: each reel takes slightly longer
// so they stop left-to-right, creating the classic staggered effect.
const PHASE1_DURS = [1300, 1680, 2060]; // ms for reel 0, 1, 2

/* ================================================================
   ── 3. GAME STATE ───────────────────────────────────────────────
   All mutable game state is gathered here so every piece of the
   code can read / write it from a single location.
   ================================================================ */
let balance = 100; // player's current balance in dollars
let wagered = 0; // cumulative amount wagered this session
let currentBet = 5; // current bet per spin (adjustable by +/− buttons)
const MIN_BET = 1; // minimum allowed bet
const MAX_BET = 500; // maximum allowed bet

let spinCount = 0; // total number of spins taken
let winCount = 0; // number of winning spins
let bestWin = 0; // largest single-spin payout in dollars

let busy = false; // true while reels are animating — blocks new spins
let audioCtx = null; // lazily-created Web Audio context (autoplay policy)

/* ================================================================
   ── 4. DOM REFERENCES ───────────────────────────────────────────
   Cache all element lookups once so the spin hot-path never
   queries the DOM by ID repeatedly.
   ================================================================ */
const elBalance = document.getElementById("el-balance");
const elWagered = document.getElementById("el-wagered");
const elMsg = document.getElementById("el-msg");
const elSpins = document.getElementById("el-spins");
const elWins = document.getElementById("el-wins");
const elBest = document.getElementById("el-best");
const elBetDisplay = document.getElementById("bet-display");
const spinBtn = document.getElementById("spin-btn");
const betMinus = document.getElementById("bet-minus");
const betPlus = document.getElementById("bet-plus");
const topupBtn = document.getElementById("topup-btn");
const flashEl = document.getElementById("flash");
const paylineOvEl = document.getElementById("payline-overlay");
const machineEl = document.getElementById("machine");
const logEl = document.getElementById("log-entries");
const clearLogBtn = document.getElementById("clear-log");

// Reel strip elements — long scrolling divs driven by translateY
const tracks = [0, 1, 2].map((i) => document.getElementById(`track-${i}`));

// Reel column elements — used for .winning highlight class
const reelEls = [0, 1, 2].map((i) => document.getElementById(`reel-${i}`));

// Lever elements
const leverTrackEl = document.getElementById("lever-track");
const leverHandleEl = document.getElementById("lever-handle");

/* ================================================================
   ── 5. REEL STRIP BUILDER ───────────────────────────────────────
   Fills a reel's .reel-track element with STRIP symbol cells.
   The three "result" positions (LAND-1, LAND, LAND+1) receive
   predetermined symbols passed as arguments; every other position
   gets a random symbol drawn from the weighted POOL.

   This means the outcome is decided *before* the animation starts,
   and the final rest position simply reveals the pre-set values.

   @param {HTMLElement} track   — the .reel-track div to populate
   @param {string}      topSym  — emoji for the top-row  result cell
   @param {string}      midSym  — emoji for the middle-row result cell (payline)
   @param {string}      botSym  — emoji for the bottom-row result cell
   ================================================================ */
function buildStrip(track, topSym, midSym, botSym) {
  track.innerHTML = ""; // clear any previous cells

  for (let i = 0; i < STRIP; i++) {
    const cell = document.createElement("div");
    cell.className = "reel-cell";

    if (i === LAND - 1)
      cell.textContent = topSym; // top row
    else if (i === LAND)
      cell.textContent = midSym; // middle row ← payline
    else if (i === LAND + 1)
      cell.textContent = botSym; // bottom row
    else cell.textContent = randomSymbol(); // filler (not scored)

    track.appendChild(cell);
  }
}

// Helper: pick a random symbol from the weighted pool
function randomSymbol() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

// Helper: pick a random element from any array
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ================================================================
   ── 6. REEL SPIN ANIMATION (two-phase deceleration) ─────────────

   Each reel goes through two animation phases driven by the
   Web Animations API (.animate()):

   PHASE 1 — linear / fast
     The strip scrolls quickly from translateY(0) to
     translateY(END_Y + PHASE1_STOP).  Duration = PHASE1_DURS[idx]
     so reel 0 stops first, reel 2 stops last (staggered).

   PHASE 2 — cubic-bezier ease-out / slow
     The strip crawls the remaining PHASE1_STOP pixels into its
     exact final position translateY(END_Y).  The chosen bezier
     (0.12, 0.82, 0.36, 1) starts quickly and decelerates to a
     definitive stop — visually satisfying and clearly legible.

   On finish: a brief vertical scale-bounce on the reel column
   simulates the physical impact of the reel hitting its stop.

   Returns a Promise that resolves when Phase 2 finishes, allowing
   the caller (spin()) to await all three reels in parallel.
   ================================================================ */
function spinReel(idx, topSym, midSym, botSym) {
  return new Promise((resolve) => {
    const track = tracks[idx];

    // Cancel any animation still running from a previous spin
    for (const anim of track.getAnimations()) anim.cancel();

    // Rebuild the strip with the already-decided result symbols
    buildStrip(track, topSym, midSym, botSym);

    // Snap the strip to y=0 instantly (no CSS transition)
    track.style.transition = "none";
    track.style.transform = "translateY(0px)";

    // Force a browser layout flush so the reset is committed before
    // the animation starts (otherwise the browser may skip y=0)
    void track.getBoundingClientRect();

    // ── PHASE 1: fast linear scroll ──────────────────────────────
    // END_Y is negative (strip moves upward), so END_Y + PHASE1_STOP
    // is still negative but closer to zero — i.e. not quite at the end.
    const fastEndY = END_Y + PHASE1_STOP;

    const phase1 = track.animate(
      [
        { transform: "translateY(0px)" },
        { transform: `translateY(${fastEndY}px)` },
      ],
      {
        duration: PHASE1_DURS[idx],
        easing: "linear",
        fill: "forwards",
      },
    );

    // When Phase 1 finishes, commit its end position as an inline style
    // and immediately start Phase 2 from that exact position.
    phase1.addEventListener("finish", () => {
      track.style.transform = `translateY(${fastEndY}px)`;
      phase1.cancel(); // remove WAAPI fill so the inline style takes over

      // ── PHASE 2: slow ease-out into final rest position ─────────
      // The bezier gives an initial burst that quickly decelerates —
      // the reel visibly "crawls" the last couple of cells before stopping.
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
        // Lock in the final position so the strip doesn't jump on cancel()
        track.style.transform = `translateY(${END_Y}px)`;
        phase2.cancel();

        // Physical stop: brief vertical scale-bounce on the reel column
        reelEls[idx].animate(
          [{ transform: "scaleY(1.04)" }, { transform: "scaleY(1.00)" }],
          { duration: 110, easing: "ease-out" },
        );

        playClick(); // mechanical "thunk" sound effect
        resolve(); // notify the caller that this reel has fully stopped
      });
    });
  });
}

/* ================================================================
   ── 7. WIN EVALUATION (middle row only) ─────────────────────────
   Checks the three symbols on the middle payline row and returns
   the cash payout (in dollars).

   Rules:
     3-of-a-kind  → bet × PAY_TABLE[symbol]
     Any two matching symbols → bet × 1.5  (consolation)
     No match     → 0

   @param {string[]} row   — [leftSym, centSym, rightSym] on middle row
   @param {number}   bet   — the current bet amount in dollars
   @returns {number} payout in dollars (0 = no win)
   ================================================================ */
function evaluateLine(row, bet) {
  const [a, b, c] = row;

  if (a === b && b === c) {
    // All three match — full 3-of-a-kind payout
    return Math.round(bet * (PAY_TABLE[a] ?? 2));
  }

  if (a === b || b === c || a === c) {
    // Any pair — consolation payout (rounds to nearest cent)
    return Math.round(bet * 1.5);
  }

  return 0; // no match
}

/* ================================================================
   ── 8. MAIN SPIN FUNCTION ───────────────────────────────────────
   Orchestrates a full spin:
     1. Guard checks (busy, insufficient balance)
     2. Deduct bet, update counters
     3. Pre-determine result symbols for all three reels
     4. Start all three reel animations concurrently (Promise.all)
     5. Evaluate the middle row once all reels have stopped
     6. Apply payout, trigger visual/audio effects
     7. Log the result, re-enable controls
   ================================================================ */
async function spin() {
  // Block if a spin is already in progress
  if (busy) return;

  // Block if the player can't afford the current bet
  if (balance < currentBet) {
    setMsg(
      `Not enough balance! Add funds with "Add $100" or lower your bet.`,
      "lose",
    );
    return;
  }

  // ── Lock controls ─────────────────────────────────────────────
  busy = true;
  spinBtn.disabled = true;
  betMinus.disabled = true;
  betPlus.disabled = true;

  // ── Deduct bet and update counters ────────────────────────────
  balance -= currentBet;
  wagered += currentBet;
  spinCount++;
  updateUI();

  // ── Clear visual state from previous spin ─────────────────────
  reelEls.forEach((r) => r.classList.remove("winning"));
  paylineOvEl.classList.remove("win");

  setMsg("Spinning… good luck! 🤞", "");
  playSpinStart();

  // ── Pre-determine result symbols ──────────────────────────────
  // Results are picked NOW, before animation, so the strip can be
  // pre-loaded with the correct symbols at LAND, LAND-1, LAND+1.
  // middleRow[reelIdx] is the symbol that will appear on the payline.
  const topRow = [randomSymbol(), randomSymbol(), randomSymbol()];
  const middleRow = [randomSymbol(), randomSymbol(), randomSymbol()];
  const bottomRow = [randomSymbol(), randomSymbol(), randomSymbol()];

  // ── Animate all three reels concurrently ─────────────────────
  // Promise.all resolves when the LAST reel has stopped (reel 2).
  // Each reel receives its own slice of the pre-determined results.
  await Promise.all(
    [0, 1, 2].map((idx) =>
      spinReel(
        idx,
        topRow[idx], // visible in top    row after animation
        middleRow[idx], // visible in middle row ← this is scored
        bottomRow[idx], // visible in bottom row after animation
      ),
    ),
  );

  // ── Evaluate the middle-row payline ───────────────────────────
  const payout = evaluateLine(middleRow, currentBet);

  // Classify the win kind for FX selection
  let kind;
  if (payout === 0) {
    kind = "lose";
  } else if (payout >= currentBet * 50) {
    kind = "jackpot"; // Diamond or Seven 3-of-a-kind
  } else {
    kind = "win";
  }

  // ── Apply payout ──────────────────────────────────────────────
  if (payout > 0) {
    balance += payout;
    winCount++;
    if (payout > bestWin) bestWin = payout;

    // Highlight the reel columns that contributed to the win.
    // For 3-of-a-kind, all three columns light up.
    // For a pair, only the two matching columns light up.
    const [a, b, c] = middleRow;
    if (a === b && b === c) {
      reelEls.forEach((r) => r.classList.add("winning"));
    } else {
      if (a === b) {
        reelEls[0].classList.add("winning");
        reelEls[1].classList.add("winning");
      }
      if (b === c) {
        reelEls[1].classList.add("winning");
        reelEls[2].classList.add("winning");
      }
      if (a === c) {
        reelEls[0].classList.add("winning");
        reelEls[2].classList.add("winning");
      }
    }

    // Gold glow on the payline overlay
    paylineOvEl.classList.add("win");
  }

  updateUI();

  // ── Trigger result message + effects ─────────────────────────
  showResult(middleRow, payout, kind);

  // ── Record in history ─────────────────────────────────────────
  addLogEntry(spinCount, middleRow, payout, kind);

  // ── Unlock controls ───────────────────────────────────────────
  busy = false;
  betMinus.disabled = false;
  betPlus.disabled = false;

  if (balance < MIN_BET) {
    // Player is broke — show a helpful message; the top-up button above handles funding
    spinBtn.innerHTML = '💸 BROKE — use "Add $100" above';
    spinBtn.disabled = true; // keep disabled; player must top up first
  } else {
    spinBtn.disabled = false;
  }
}

/* ================================================================
   ── 9. RESULT EFFECTS ───────────────────────────────────────────
   showResult  — chooses the appropriate message, flash, particles,
                 and audio based on win kind
   triggerFlash — brief full-viewport colour flash
   coinBurst    — animated coin shower on wins
   burstParticles — emoji burst on jackpots
   ================================================================ */

// Flavour text arrays — randomly selected to keep results fresh
const WIN_MSGS = [
  "Nice! The middle row delivered!",
  "Winner! Lady Luck smiled on you.",
  "Cha-ching! Payout incoming.",
  "Fortune favours the bold!",
  "You read the reels right.",
  "A win! The symbols aligned.",
];
const LOSE_MSGS = [
  "No match. Try again!",
  "So close… keep pulling.",
  "The symbols were against you.",
  "Better luck next spin.",
  "Not this time — spin again!",
  "The reels disagreed. Unfortunate.",
  "A near miss. The lever awaits.",
];

function showResult(middleRow, payout, kind) {
  if (kind === "jackpot") {
    // Identify which symbol made the jackpot
    const sym = middleRow[0];
    setMsg(`🎉 JACKPOT! ${sym}${sym}${sym} — you won $${payout}!`, "jackpot");
    triggerFlash("rgba(176,128,16,0.5)");
    burstParticles(["💎", "⭐", "🪙", "💰", "🎉", "✨", "7️⃣"]);
    coinBurst(32);
    // Machine cabinet "celebrates" (fast-blinking lights) for 3 seconds
    machineEl.classList.add("celebrating");
    setTimeout(() => machineEl.classList.remove("celebrating"), 3000);
    playJackpot();
  } else if (kind === "win") {
    setMsg(`+$${payout}! ${pick(WIN_MSGS)}`, "win");
    triggerFlash("rgba(26,122,58,0.35)");
    coinBurst(14);
    playWin();
  } else {
    setMsg(pick(LOSE_MSGS), "lose");
    playLose();
  }
}

// setMsg — updates the message paragraph's text and colour class
function setMsg(text, cls) {
  elMsg.className = "msg " + cls;
  elMsg.textContent = text;
}

// triggerFlash — momentary full-viewport overlay colour
function triggerFlash(color) {
  flashEl.style.background = color;
  flashEl.animate([{ opacity: 0.7 }, { opacity: 0 }], {
    duration: 500,
    easing: "ease-out",
    fill: "forwards",
  });
}

// coinBurst — animates `count` coin emojis arcing upward from the machine
function coinBurst(count) {
  const rect = machineEl.getBoundingClientRect();
  const originY = rect.top + rect.height * 0.55;

  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const coin = document.createElement("div");
      coin.className = "coin-particle";
      coin.textContent = "🪙";

      // Randomise the horizontal start position across the machine width
      const startX = rect.left + rect.width * (0.1 + Math.random() * 0.8);
      coin.style.left = startX + "px";
      coin.style.top = originY + "px";
      document.body.appendChild(coin);

      // Each coin flies at a random upward angle
      const angleDeg = -55 - Math.random() * 70; // −55° to −125° (upward)
      const distance = 70 + Math.random() * 120;
      const rad = angleDeg * (Math.PI / 180);

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
        {
          duration: 650 + Math.random() * 500,
          easing: "ease-out",
          fill: "forwards",
        },
      ).onfinish = () => coin.remove();
    }, i * 50);
  }
}

// burstParticles — random emoji burst for jackpots
function burstParticles(emojis) {
  for (let i = 0; i < 24; i++) {
    setTimeout(() => {
      const p = document.createElement("div");
      p.className = "burst-particle";
      p.textContent = pick(emojis);
      p.style.left = 5 + Math.random() * 90 + "%";
      p.style.top = 10 + Math.random() * 60 + "%";
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
        {
          duration: 550 + Math.random() * 450,
          easing: "ease-out",
          fill: "forwards",
        },
      ).onfinish = () => p.remove();
    }, i * 35);
  }
}

/* ================================================================
   ── 10. DRAGGABLE LEVER ─────────────────────────────────────────
   The player drags the red ball handle downward within the lever
   track. Physical behaviour:

     • Dragging    — handle follows the pointer/finger in real-time
                     (no transition, for instant feedback)
     • Past 60 %   — handle turns orange signalling "release to spin"
     • Release     — handle springs back to top via elastic easing
                     (cubic-bezier with slight overshoot)
     • If past 60% at release → spin() is called after a short delay
                                 so the spring-back is visible first

   Lever bounds (in pixels, matching CSS .lever-track height):
     TRACK_H  = --cell-h × 3 = 270  (same height as the reel area)
     HANDLE_H = 44              (matches .lever-handle CSS)
     PADDING  = 4               (gap between handle edge and track edge)
     MAX_POS  = TRACK_H - HANDLE_H - PADDING  (bottom stop)
     TRIGGER  = MAX_POS × 0.60  (threshold to trigger a spin)
   ================================================================ */
const LEVER_TRACK_H = CELL_H * 3; // 270px (dynamic, matches CSS)
const LEVER_HANDLE_H = 44;
const LEVER_PADDING = 4;
const LEVER_MAX_POS = LEVER_TRACK_H - LEVER_HANDLE_H - LEVER_PADDING; // ~222px
const LEVER_TRIGGER = LEVER_MAX_POS * 0.6; // 60 % down = ~133px

// Lever drag state
let leverDragging = false;
let leverDragStartY = 0; // pointer Y at drag start
let leverDragBaseTop = 0; // handle top at drag start
let leverCurrentTop = LEVER_PADDING; // current handle top in px
let leverBusy = false; // prevents double-trigger during spring-back

/* setHandleTop — moves the handle to a given top offset.
   instant=true  → no CSS transition (used during dragging)
   instant=false → spring-back CSS transition (used on release) */
function setHandleTop(topPx, instant) {
  leverHandleEl.style.transition = instant
    ? "none"
    : "top 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s";
  leverHandleEl.style.top = topPx + "px";
}

/* updateHandleColour — turns the handle orange past the trigger threshold */
function updateHandleColour(topPx) {
  if (topPx >= LEVER_TRIGGER) {
    leverHandleEl.classList.add("ready");
  } else {
    leverHandleEl.classList.remove("ready");
  }
}

// ── Pointer-down: begin tracking the drag ────────────────────────
function onLeverDown(e) {
  if (busy || leverBusy) return; // ignore input while reels are spinning

  leverDragging = true;
  leverDragStartY = e.touches ? e.touches[0].clientY : e.clientY;
  leverDragBaseTop = leverCurrentTop;

  // Disable CSS transition during drag so the handle tracks instantly
  setHandleTop(leverCurrentTop, /* instant */ true);

  // Prevent scroll on touch devices while dragging the lever
  e.preventDefault();
}

// ── Pointer-move: update handle position ─────────────────────────
function onLeverMove(e) {
  if (!leverDragging) return;

  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const delta = clientY - leverDragStartY; // positive = downward

  // Clamp to [LEVER_PADDING, LEVER_MAX_POS]
  const newTop = Math.max(
    LEVER_PADDING,
    Math.min(LEVER_MAX_POS, leverDragBaseTop + delta),
  );

  leverCurrentTop = newTop;
  setHandleTop(newTop, /* instant */ true);
  updateHandleColour(newTop);
}

// ── Pointer-up / touch-end: evaluate and spring back ─────────────
function onLeverUp() {
  if (!leverDragging) return;
  leverDragging = false;

  const triggered = leverCurrentTop >= LEVER_TRIGGER;

  // Spring the handle back to the top position with elastic easing
  leverCurrentTop = LEVER_PADDING;
  setHandleTop(LEVER_PADDING, /* instant */ false); // CSS spring transition
  leverHandleEl.classList.remove("ready");

  if (triggered && !busy && !leverBusy) {
    leverBusy = true;
    // Slight delay so the player sees the handle spring back before the reels move
    setTimeout(() => {
      leverBusy = false;
      spin();
    }, 220);
  }
}

// Attach pointer events:
// Down goes on the handle (start dragging when touching the ball)
// Move/Up go on window so the drag continues even if the pointer
// leaves the handle or the track area
leverHandleEl.addEventListener("mousedown", onLeverDown);
leverHandleEl.addEventListener("touchstart", onLeverDown, { passive: false });
window.addEventListener("mousemove", onLeverMove);
window.addEventListener("touchmove", onLeverMove, { passive: false });
window.addEventListener("mouseup", onLeverUp);
window.addEventListener("touchend", onLeverUp);

// Clicking the track itself (not the handle) also triggers a spin,
// matching the feel of a physical machine
leverTrackEl.addEventListener("click", (e) => {
  if (e.target !== leverHandleEl && !busy && !leverBusy) {
    spin();
  }
});

/* ================================================================
   ── 11. BET CONTROLS ────────────────────────────────────────────
   The +/− buttons adjust `currentBet` in steps.

   Step size:
     bet ≤ $10   → step $1
     bet ≤ $50   → step $5
     bet ≤ $100  → step $10
     bet > $100  → step $25

   The bet is also capped so the player can never wager more
   than their current balance (prevents betting into negatives).
   ================================================================ */

// Returns the increment/decrement step for the current bet value
function betStep(bet) {
  if (bet <= 10) return 1;
  if (bet <= 50) return 5;
  if (bet <= 100) return 10;
  return 25;
}

function updateBetDisplay() {
  elBetDisplay.textContent = `$${currentBet}`;

  // Disable minus if already at minimum
  betMinus.disabled = currentBet <= MIN_BET;

  // Disable plus if at maximum or if the player can't afford a higher bet
  betPlus.disabled = currentBet >= MAX_BET || currentBet >= balance;
}

// Decrease bet by one step (floored at MIN_BET)
betMinus.addEventListener("click", () => {
  if (busy) return;
  const step = betStep(currentBet);
  currentBet = Math.max(MIN_BET, currentBet - step);
  updateBetDisplay();
});

// Increase bet by one step (capped at MAX_BET and current balance)
betPlus.addEventListener("click", () => {
  if (busy) return;
  const step = betStep(currentBet);
  // Cap against both MAX_BET and what the player can actually afford
  currentBet = Math.min(MAX_BET, balance, currentBet + step);
  updateBetDisplay();
});

/* ================================================================
   ── 12. TOP-UP BUTTON ───────────────────────────────────────────
   Adds $100 to the player's balance instantly.
   A CSS class triggers a short bounce animation on the button so
   the player has clear visual confirmation the top-up happened.
   ================================================================ */
const TOPUP_AMOUNT = 100; // dollars added per top-up

function doTopUp() {
  balance += TOPUP_AMOUNT;

  // Re-enable the bet plus button if it was disabled due to low balance
  currentBet = Math.min(currentBet, MAX_BET); // don't change bet, just validate cap
  updateBetDisplay();
  updateUI();

  setMsg(`+$${TOPUP_AMOUNT} added! Balance: $${balance}`, "win");

  // Briefly animate the top-up button to confirm the action
  topupBtn.classList.remove("confirmed"); // reset if already present
  void topupBtn.offsetWidth; // force reflow to restart animation
  topupBtn.classList.add("confirmed");
  topupBtn.addEventListener(
    "animationend",
    () => topupBtn.classList.remove("confirmed"),
    { once: true },
  );

  // If the spin button was disabled because the player was broke,
  // re-enable it now that the balance has been replenished
  if (spinBtn.disabled && spinBtn.innerHTML.includes("BROKE")) {
    spinBtn.innerHTML = '🎰 SPIN <small class="spin-hint">SPACE</small>';
    spinBtn.disabled = false;
  }
}

topupBtn.addEventListener("click", doTopUp);

/* ================================================================
   ── 13. KEYBOARD SHORTCUT (SPACE) ───────────────────────────────
   The spacebar is the most natural keyboard trigger for a slot
   machine. We intercept it on keydown and route it to spin().
   preventDefault() stops the page from scrolling.
   ================================================================ */
document.addEventListener("keydown", (e) => {
  // Trigger spin on SPACE — but not when typing in an input field
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
   ── 14. SPIN HISTORY LOG ────────────────────────────────────────
   After every spin, a new row is prepended to #log-entries
   showing the spin number, the three middle-row symbols, and
   the dollar outcome (positive = win, negative = bet lost).
   ================================================================ */
function addLogEntry(num, middleRow, payout, kind) {
  // Remove the "no spins yet" placeholder on the very first entry
  const placeholder = logEl.querySelector(".log-empty");
  if (placeholder) placeholder.remove();

  const entry = document.createElement("div");
  entry.className = `log-entry ${kind}`;

  // Spin number
  const numEl = document.createElement("span");
  numEl.className = "log-num";
  numEl.textContent = `#${num}`;

  // Three middle-row symbols
  const symEl = document.createElement("span");
  symEl.className = "log-syms";
  symEl.textContent = middleRow.join(" "); // e.g. "🍒 💎 🍒"

  // Dollar result
  const resEl = document.createElement("span");
  resEl.className = "log-result";
  resEl.textContent = payout > 0 ? `+$${payout}` : `−$${currentBet}`;

  entry.append(numEl, symEl, resEl);

  // Newest entries go to the top of the list
  logEl.insertBefore(entry, logEl.firstChild);
}

clearLogBtn.addEventListener("click", () => {
  logEl.innerHTML = '<p class="log-empty">History cleared.</p>';
});

/* ================================================================
   ── 15. UI UPDATE HELPERS ───────────────────────────────────────
   updateUI — syncs all displayed numbers with current game state
   ================================================================ */
function updateUI() {
  elBalance.textContent = `$${balance}`;
  elWagered.textContent = `$${wagered}`;
  elSpins.textContent = spinCount;
  elWins.textContent = winCount;
  elBest.textContent = `$${bestWin}`;
  updateBetDisplay();
}

/* ================================================================
   ── 16. GAME RESET ──────────────────────────────────────────────
   Restores all game-state variables and rebuilds the reels.
   Called internally when the player triggers the "broke" state
   and chooses to reset via the top-up path.
   ================================================================ */
function resetGame() {
  balance = 100;
  wagered = 0;
  currentBet = 5;
  spinCount = 0;
  winCount = 0;
  bestWin = 0;
  busy = false;

  // Rebuild reels at rest position
  tracks.forEach((t) => {
    buildStrip(t, randomSymbol(), randomSymbol(), randomSymbol());
    t.style.transform = `translateY(${END_Y}px)`;
  });

  reelEls.forEach((r) => r.classList.remove("winning"));
  paylineOvEl.classList.remove("win");

  spinBtn.innerHTML = '🎰 SPIN <small class="spin-hint">SPACE</small>';
  spinBtn.disabled = false;
  spinBtn.onclick = spin;

  updateUI();
  setMsg("Balance reset to $100. Good luck!", "");
}

/* ================================================================
   ── 17. WEB AUDIO ───────────────────────────────────────────────
   All sounds are synthesised via the Web Audio API — no audio
   files required. The AudioContext is created lazily on first
   user interaction to comply with browser autoplay policies.

   scheduleNote — low-level oscillator + gain envelope helper
   playClick    — mechanical "thunk" when a reel stops
   playSpinStart— whirr + rising tone when spin begins
   playWin      — ascending four-note chime
   playJackpot  — energetic eight-note fanfare
   playLose     — descending sawtooth "wah-wah"
   ================================================================ */
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Schedules a simple note: oscillator + short attack / exponential decay
// @param ctx   — AudioContext
// @param freq  — frequency in Hz
// @param t     — start time in AudioContext seconds
// @param dur   — total duration in seconds
// @param vol   — peak volume (0–1), default 0.15
// @param type  — OscillatorType, default 'sine'
function scheduleNote(ctx, freq, t, dur, vol = 0.15, type = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);

  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.022);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.start(t);
  osc.stop(t + dur + 0.04);
}

// Mechanical click/thunk — played when each reel stops
function playClick() {
  try {
    const ctx = getAudioCtx();
    scheduleNote(ctx, 185, ctx.currentTime, 0.052, 0.12, "square");
  } catch (_) {
    /* audio is non-critical; silently skip errors */
  }
}

// Spin-start: brief noise burst + rising sawtooth
function playSpinStart() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;

    // White-noise burst to suggest mechanical movement
    const bufLen = ctx.sampleRate * 0.11;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.22;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.18, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(t);
    noise.stop(t + 0.18);

    // Rising tone to suggest the reels spinning up to speed
    scheduleNote(ctx, 88, t + 0.03, 0.25, 0.07, "sawtooth");
    scheduleNote(ctx, 125, t + 0.1, 0.18, 0.05, "sawtooth");
  } catch (_) {}
}

// Win chime — four ascending notes (C5 → E5 → G5 → C6)
function playWin() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) =>
      scheduleNote(ctx, freq, t + i * 0.1, 0.22),
    );
  } catch (_) {}
}

// Jackpot fanfare — eight ascending notes with higher volume
function playJackpot() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    [523, 587, 659, 784, 880, 988, 1047, 1319].forEach((freq, i) =>
      scheduleNote(ctx, freq, t + i * 0.07, 0.3, 0.2),
    );
  } catch (_) {}
}

// Loss sound — descending sawtooth (the classic "wah-wah" droop)
function playLose() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
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
   ── 18. MACHINE LIGHTS ──────────────────────────────────────────
   Builds 12 LED light elements and appends them to #machine-lights.
   Each light's animation-delay is staggered so they pulse in a
   running-light wave rather than all at once.
   ================================================================ */
function buildLights() {
  const container = document.getElementById("machine-lights");

  for (let i = 0; i < 12; i++) {
    const light = document.createElement("div");
    light.className = "light";
    // Stagger by 0.16 s each so the wave traverses all 12 lights in ~2 s
    light.style.animationDelay = i * 0.16 + "s";
    container.appendChild(light);
  }
}

/* ================================================================
   ── 19. EVENT WIRING & INIT ─────────────────────────────────────
   Runs once at startup to wire up remaining events and build
   the initial machine state.
   ================================================================ */

// Build the decorative LED strip
buildLights();

// Initialise reels at their rest position (END_Y translateY)
tracks.forEach((track) => {
  buildStrip(track, randomSymbol(), randomSymbol(), randomSymbol());
  track.style.transform = `translateY(${END_Y}px)`;
});

// Wire the main spin button
spinBtn.addEventListener("click", spin);

// Show initial UI values
updateUI();
