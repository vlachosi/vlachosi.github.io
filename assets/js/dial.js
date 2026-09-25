/*
 * A simulated year of implied volatility as a dial: one revolution is one
 * year, January at the top, running clockwise. Implied volatility (the outer
 * line) builds into each scheduled announcement and collapses once the news is
 * out; daily price moves (the inner ticks) spike on the day. Every draw places
 * the announcements at new dates: four earnings releases, one in each
 * quarter's reporting season, and two macro releases.
 *
 * A stylised model: each announcement in the next 30 trading days adds its
 * jump variance, spread over the life of an option that expires a week after
 * it,
 *
 *   IV_t^2 = s0^2 + sum_e J_e^2 / tau_e,   tau_e = (days to e + 5) / 252.
 *
 * Markup: <figure data-dial> containing a <canvas>. Optional: data-url-seed
 * (read ?seed=<n>) and a [data-redraw] button. Hovering or tapping a day shows
 * it in the middle of the dial. The caption is a question: [data-reveal] shows
 * the [data-answer] and writes IV into the middle of the dial.
 */
(function () {
  "use strict";

  const POINTS = 252; // trading days in a year
  const QUARTER = POINTS / 4;
  const DAY_MS = 864e5;
  const BASE = 0.3; // no-news volatility
  const HORIZON = 30; // announcements further ahead are not yet priced
  const AFTER = 5; // the option expires a week after the announcement
  const IV_MIN = 0.28;
  const MOVE_MAX = 0.08;
  const DURATION_MS = 1800;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // --- Scheduled announcements ----------------------------------------------
  // Jump sizes are the standard deviation of the move on the day.

  const EARNINGS = { label: "earnings", jump: 0.07, from: 15, to: 45 }; // days into each quarter
  const MACRO = [
    { label: "FOMC", jump: 0.04 },
    { label: "CPI", jump: 0.04 },
    { label: "payrolls", jump: 0.04 },
  ];
  const MACRO_COUNT = 2;
  const MIN_GAP = 20; // trading days between any two announcements
  const LABELS = [EARNINGS.label, ...MACRO.map((m) => m.label)];

  // --- Random numbers (the same generator as paths.js) ----------------------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Box-Muller, keeping the second normal of each pair.
  function gaussian(rng) {
    let spare = null;
    return function () {
      if (spare !== null) {
        const z = spare;
        spare = null;
        return z;
      }
      let u = 0;
      while (u === 0) u = rng();
      const v = rng();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  function randomSeed() {
    return 1 + Math.floor(Math.random() * 999999);
  }

  // --- Calendar: only the day of the year matters ---------------------------

  function dateOfPoint(point) {
    const date = new Date(Date.UTC(2001, 0, 1) + Math.round((point / POINTS) * 365) * DAY_MS);
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  }

  // Days between two points on the dial, the short way round.
  function gap(a, b) {
    const d = Math.abs(a - b) % POINTS;
    return Math.min(d, POINTS - d);
  }

  // One earnings release in each quarter's reporting season, then the macro
  // releases wherever they keep their distance. The dates come from their own
  // stream of the seed, so ?seed= reproduces them.
  function scheduleYear(seed) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const pick = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    for (let minGap = MIN_GAP; ; minGap -= 2) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const events = [];
        for (let q = 0; q < 4; q++) {
          events.push({ t: q * QUARTER + pick(EARNINGS.from, EARNINGS.to), label: EARNINGS.label, jump: EARNINGS.jump });
        }
        const macro = MACRO.map((m) => ({ m, key: rng() })).sort((a, b) => a.key - b.key).slice(0, MACRO_COUNT);
        let placed = 0;
        for (const { m } of macro) {
          for (let tries = 0; tries < 40; tries++) {
            const t = pick(0, POINTS - 1);
            if (events.every((e) => gap(e.t, t) >= minGap)) {
              events.push({ t, label: m.label, jump: m.jump });
              placed++;
              break;
            }
          }
        }
        if (placed === macro.length) return events.sort((a, b) => a.t - b.t);
      }
    }
  }

  // "earnings on 3 Feb, 5 May, 4 Aug and 3 Nov; FOMC on 17 Jun; CPI on 12 Oct"
  function describe(events) {
    const byLabel = new Map();
    for (const e of events) {
      if (!byLabel.has(e.label)) byLabel.set(e.label, []);
      byLabel.get(e.label).push(dateOfPoint(e.t));
    }
    const list = (xs) => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
    return [...byLabel].map(([label, dates]) => `${label} on ${list(dates)}`).join("; ");
  }

  // --- Model ----------------------------------------------------------------

  function simulate(seed, events) {
    const z = gaussian(mulberry32(seed));
    const onDay = new Map(events.map((e) => [e.t, e]));
    const iv = new Float64Array(POINTS);
    const moves = new Float64Array(POINTS);
    const daily = BASE / Math.sqrt(POINTS);
    for (let t = 0; t < POINTS; t++) {
      let variance = BASE * BASE;
      for (const e of events) {
        // The dial wraps, so December's announcements are priced in over New Year.
        const ahead = (e.t - t + POINTS) % POINTS;
        if (ahead > 0 && ahead <= HORIZON) variance += (e.jump * e.jump * POINTS) / (ahead + AFTER);
      }
      const noise = z();
      const move = z();
      const jump = Math.sign(z()) * (0.75 + 0.45 * Math.abs(z()));
      const today = onDay.get(t);
      iv[t] = Math.sqrt(variance) * (1 + 0.012 * noise);
      moves[t] = Math.abs(daily * move + (today ? today.jump * jump : 0));
    }
    return { iv, moves };
  }

  // --- One figure -----------------------------------------------------------

  function mount(figure) {
    const canvas = figure.querySelector("canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const redrawButton = figure.querySelector("[data-redraw]");
    const revealButton = figure.querySelector("[data-reveal]");
    const answer = figure.querySelector("[data-answer]");
    const useUrlSeed = figure.hasAttribute("data-url-seed");
    const baseLabel = canvas.getAttribute("aria-label") || "";

    const state = {
      seed: initialSeed(),
      events: [],
      labels: new Map(),
      sim: null,
      progress: 0,
      frame: 0,
      hover: null,
      revealed: false,
      colours: null,
      width: 0,
      height: 0,
    };

    function initialSeed() {
      if (useUrlSeed) {
        const param = new URLSearchParams(window.location.search).get("seed");
        const parsed = param === null ? NaN : parseInt(param, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed >>> 0;
      }
      return randomSeed();
    }

    // A new year: its announcements, then the path that prices them.
    function newYear(seed) {
      state.seed = seed;
      state.events = scheduleYear(seed);
      state.labels = new Map(state.events.map((e) => [e.t, e.label]));
      state.sim = simulate(seed, state.events);
      canvas.setAttribute("aria-label", `${baseLabel} This draw: ${describe(state.events)}.`.trim());
    }

    function readColours() {
      const css = getComputedStyle(document.documentElement);
      const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      state.colours = {
        paper: get("--paper", "#F6F4EE"),
        ink: get("--ink", "#14213A"),
        muted: get("--muted", "#56607A"),
        rule: get("--rule", "#DCD6C8"),
        accent: get("--accent", "#C2412D"),
        bandAlpha: parseFloat(get("--band-alpha", "0.11")),
        mono: get("--mono", '"JetBrains Mono", ui-monospace, monospace'),
      };
    }

    // --- Geometry -----------------------------------------------------------

    function layout() {
      const w = state.width;
      const h = state.height;
      const compact = w < 420;
      const labelSize = compact ? 10 : 11;
      // Leave room beside the rim for the widest label any draw can have, so
      // the dial keeps its size from one draw to the next.
      ctx.font = `${labelSize}px ${state.colours.mono}`;
      const widest = Math.max(...LABELS.map((label) => ctx.measureText(label).width));
      const margin = widest + 14;
      const R = Math.max(40, Math.min(h / 2 - 22, w / 2 - margin));
      const cx = w / 2;
      const cy = h / 2;
      const ivMax = Math.max(0.56, ...state.sim.iv) * 1.02;
      const r0 = 0.5 * R;
      const r1 = R - 20;
      const angle = (t) => -Math.PI / 2 + (2 * Math.PI * t) / POINTS;
      const at = (t, r) => [cx + r * Math.cos(angle(t)), cy + r * Math.sin(angle(t))];
      const rIv = (v) => r0 + ((v - IV_MIN) / (ivMax - IV_MIN)) * (r1 - r0);
      const moveBase = 0.45 * R;
      const moveLength = 0.2 * R;
      return { compact, labelSize, R, cx, cy, angle, at, rIv, moveBase, moveLength };
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = Math.max(1, rect.width);
      state.height = Math.max(1, rect.height);
      canvas.width = Math.round(state.width * dpr);
      canvas.height = Math.round(state.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // --- Drawing ------------------------------------------------------------

    // Text with a halo in the page colour, so it stays legible over lines.
    function text(value, x, y, colour, align, baseline, size) {
      ctx.font = `${size || 11}px ${state.colours.mono}`;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.lineJoin = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = state.colours.paper;
      ctx.strokeText(value, x, y);
      ctx.fillStyle = colour;
      ctx.fillText(value, x, y);
    }

    function ring(L, r, colour, alpha, dash) {
      ctx.strokeStyle = colour;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    function spoke(L, t, r0, r1, colour, alpha, dash) {
      const [xa, ya] = L.at(t, r0);
      const [xb, yb] = L.at(t, r1);
      ctx.strokeStyle = colour;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    function render() {
      const c = state.colours;
      const L = layout();
      const { iv, moves } = state.sim;
      const k = Math.max(1, Math.round(state.progress * (POINTS - 1)));

      ctx.clearRect(0, 0, state.width, state.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Rim with month ticks and initials.
      ring(L, L.R, c.rule, 1);
      for (let m = 0; m < 12; m++) {
        const t = (m / 12) * POINTS;
        spoke(L, t, L.R - 4, L.R, c.rule, 1);
        const [mx, my] = L.at(t + POINTS / 24, L.R - 10);
        text(MONTHS[m][0], mx, my, c.muted, "center", "middle", 10);
      }

      // No-news level.
      ring(L, L.rIv(BASE), c.muted, 0.7, [4, 4]);

      // Scheduled announcements: known in advance, so drawn before the year plays out.
      for (const e of state.events) spoke(L, e.t, L.moveBase - L.moveLength, L.R, c.accent, 0.6, [3, 3]);

      // The band between the no-news level and implied volatility.
      ctx.beginPath();
      for (let t = 0; t <= k; t++) {
        const [x, y] = L.at(t, L.rIv(iv[t]));
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let t = k; t >= 0; t--) {
        const [x, y] = L.at(t, L.rIv(BASE));
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = c.bandAlpha;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Implied volatility.
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let t = 0; t <= k; t++) {
        const [x, y] = L.at(t, L.rIv(iv[t]));
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (k === POINTS - 1) ctx.closePath();
      ctx.stroke();

      // Daily price moves as inward ticks, announcement days in the accent colour.
      ctx.lineWidth = Math.max(1, ((2 * Math.PI * L.moveBase) / POINTS) * 0.6);
      for (let t = 0; t <= k; t++) {
        const onEvent = state.labels.has(t);
        const length = (Math.min(moves[t], MOVE_MAX) / MOVE_MAX) * L.moveLength;
        const [xa, ya] = L.at(t, L.moveBase);
        const [xb, yb] = L.at(t, L.moveBase - length);
        ctx.strokeStyle = onEvent ? c.accent : c.ink;
        ctx.globalAlpha = onEvent ? 1 : 0.32;
        ctx.beginPath();
        ctx.moveTo(xa, ya);
        ctx.lineTo(xb, yb);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      drawEventLabels(L);
      if (state.hover !== null && state.progress >= 1) drawFocus(L, state.hover);
      else if (state.revealed) drawAnswer(L);
    }

    // Labels sit just outside the rim, anchored away from the centre. A label
    // that would overlap an earlier one is nudged clear of it, along whichever
    // axis needs the smaller move, and kept inside the canvas.
    function drawEventLabels(L) {
      const c = state.colours;
      const size = L.labelSize;
      const placed = [];
      ctx.font = `${size}px ${c.mono}`;
      for (const e of state.events) {
        let [x, y] = L.at(e.t, L.R + 8);
        const cos = Math.cos(L.angle(e.t));
        const sin = Math.sin(L.angle(e.t));
        const align = cos > 0.3 ? "left" : cos < -0.3 ? "right" : "center";
        const baseline = sin > 0.3 ? "top" : sin < -0.3 ? "bottom" : "middle";
        const w = ctx.measureText(e.label).width;
        const h = size + 2;
        const box = () => {
          const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
          const top = baseline === "top" ? y : baseline === "bottom" ? y - h : y - h / 2;
          return { left, top, right: left + w, bottom: top + h };
        };
        for (const other of placed) {
          const b = box();
          const dx = Math.min(b.right, other.right) - Math.max(b.left, other.left);
          const dy = Math.min(b.bottom, other.bottom) - Math.max(b.top, other.top);
          if (dx <= -4 || dy <= -2) continue;
          if (dx + 4 < dy + 2) x += (b.left + b.right > other.left + other.right ? 1 : -1) * (dx + 4);
          else y += (b.top + b.bottom > other.top + other.bottom ? 1 : -1) * (dy + 2);
        }
        const b = box();
        x += Math.max(0, 2 - b.left) - Math.max(0, b.right - (state.width - 2));
        y += Math.max(0, 2 - b.top) - Math.max(0, b.bottom - (state.height - 2));
        placed.push(box());
        text(e.label, x, y, c.ink, align, baseline, size);
      }
    }

    // The question's answer, in the empty middle of the dial.
    function drawAnswer(L) {
      const c = state.colours;
      const size = Math.round(0.3 * L.R);
      ctx.font = `700 ${size}px Petrona, Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = c.ink;
      ctx.globalAlpha = 1;
      ctx.fillText("IV", L.cx, L.cy + size * 0.04);
    }

    // The hovered day: a spoke, a dot on the line, and the details in the
    // empty middle of the dial.
    function drawFocus(L, t) {
      const c = state.colours;
      spoke(L, t, L.moveBase - L.moveLength, L.R, c.muted, 0.9, [3, 3]);
      const [x, y] = L.at(t, L.rIv(state.sim.iv[t]));
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();

      const size = L.labelSize;
      const lines = [dateOfPoint(t), `IV ${Math.round(state.sim.iv[t] * 100)}%`];
      if (state.labels.has(t)) lines.push(state.labels.get(t));
      const top = L.cy - ((lines.length - 1) * (size + 4)) / 2;
      lines.forEach((line, i) => text(line, L.cx, top + i * (size + 4), i === 0 ? c.ink : c.muted, "center", "middle", size));
    }

    // --- Animation ----------------------------------------------------------

    function play() {
      cancelAnimationFrame(state.frame);
      if (reduceMotion.matches) {
        state.progress = 1;
        render();
        return;
      }
      const start = performance.now();
      const tick = (now) => {
        state.progress = Math.min(1, (now - start) / DURATION_MS);
        render();
        if (state.progress < 1) state.frame = requestAnimationFrame(tick);
      };
      state.frame = requestAnimationFrame(tick);
    }

    // --- Events -------------------------------------------------------------

    function setHover(t) {
      if (t === state.hover) return;
      state.hover = t;
      if (state.progress >= 1) render();
    }

    // The day under the pointer, if the pointer is on the dial.
    function pointFromEvent(event) {
      const L = layout();
      const rect = canvas.getBoundingClientRect();
      const dx = event.clientX - rect.left - L.cx;
      const dy = event.clientY - rect.top - L.cy;
      const r = Math.hypot(dx, dy);
      if (r < L.moveBase - L.moveLength - 6 || r > L.R + 6) return null;
      const turn = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
      return Math.round((turn / (2 * Math.PI)) * POINTS) % POINTS;
    }

    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch") setHover(pointFromEvent(event));
    });
    canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "touch") setHover(null);
    });
    // On a touch screen a tap picks a day, and a tap anywhere else clears it.
    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") setHover(pointFromEvent(event));
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target !== canvas) setHover(null);
    });

    if (revealButton) {
      revealButton.addEventListener("click", () => {
        state.revealed = true;
        revealButton.setAttribute("aria-expanded", "true");
        revealButton.hidden = true;
        if (answer) {
          answer.hidden = false;
          // The button has gone, so keyboard focus moves to the answer.
          answer.tabIndex = -1;
          answer.focus({ preventScroll: true });
        }
        render();
      });
    }

    if (redrawButton) {
      redrawButton.addEventListener("click", () => {
        newYear(randomSeed());
        state.hover = null;
        if (useUrlSeed) {
          const url = new URL(window.location.href);
          url.searchParams.set("seed", String(state.seed));
          window.history.replaceState(null, "", url);
        }
        play();
      });
    }

    let resizeTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        render();
      }, 60);
    }).observe(canvas);

    // Quarto's light/dark toggle swaps stylesheets and body classes. The first
    // switch fetches the dark stylesheet, which can arrive after the class change.
    const recolour = () => requestAnimationFrame(() => {
      readColours();
      render();
    });
    new MutationObserver(recolour).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.querySelectorAll("link.quarto-color-scheme").forEach((link) => link.addEventListener("load", recolour));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolour);

    // --- Start --------------------------------------------------------------

    newYear(state.seed);
    readColours();
    resize();
    canvas.dataset.ready = "true";
    const start = () => {
      readColours();
      play();
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
    else start();
  }

  document.querySelectorAll("[data-dial]").forEach(mount);
})();
