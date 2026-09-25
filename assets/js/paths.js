/*
 * Sample-path figures: simulated geometric Brownian motion paths, the
 * analytical 90% band, and a histogram of terminal draws against the
 * lognormal density.
 *
 *   dS_t = mu S_t dt + sigma S_t dW_t
 *   S_t  = S_0 exp((mu - sigma^2 / 2) t + sigma W_t)
 *
 * Paths are simulated exactly on a 252-step grid (one trading year).
 *
 * Markup: <figure data-paths> containing a <canvas>. Optional attributes and
 * children:
 *   data-mu, data-sigma          model parameters (defaults 0.06, 0.2)
 *   data-ymin, data-ymax         fixed vertical range (default: from the model)
 *   data-url-seed                read ?seed=<n> from the URL, write it on redraw
 *   [data-count] [data-seed] [data-readout] [data-redraw]
 *   <input data-param="mu|sigma"> with an <output data-for="mu|sigma">
 */
(function () {
  "use strict";

  const Z90 = 1.6448536269514722; // standard normal 95th percentile
  const Y_Z = 2.9; // default vertical range: terminal quantiles at +/- 2.9 sd
  const STEPS = 252;
  const TERMINAL_DRAWS = 2000;
  const BINS = 34;
  const DURATION_MS = 1800;
  const TICKS = [[0, "0"], [0.25, "3m"], [0.5, "6m"], [0.75, "9m"], [1, "1y"]];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // --- Random numbers -------------------------------------------------------

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

  // --- Model ----------------------------------------------------------------

  function logDrift(model) {
    return model.mu - 0.5 * model.sigma * model.sigma;
  }

  function quantileAt(model, t, z) {
    return model.s0 * Math.exp(logDrift(model) * t + z * model.sigma * Math.sqrt(t));
  }

  function terminalDensity(model, x) {
    const m = Math.log(model.s0) + logDrift(model) * model.years;
    const s = model.sigma * Math.sqrt(model.years);
    const d = (Math.log(x) - m) / s;
    return Math.exp(-0.5 * d * d) / (x * s * Math.sqrt(2 * Math.PI));
  }

  function simulate(model, seed, nPaths) {
    const z = gaussian(mulberry32(seed));
    const dt = model.years / STEPS;
    const drift = logDrift(model) * dt;
    const vol = model.sigma * Math.sqrt(dt);

    const paths = [];
    for (let p = 0; p < nPaths; p++) {
      const path = new Float64Array(STEPS + 1);
      let x = Math.log(model.s0);
      path[0] = model.s0;
      for (let i = 1; i <= STEPS; i++) {
        x += drift + vol * z();
        path[i] = Math.exp(x);
      }
      paths.push(path);
    }

    const m = Math.log(model.s0) + logDrift(model) * model.years;
    const s = model.sigma * Math.sqrt(model.years);
    const terminal = new Float64Array(TERMINAL_DRAWS);
    for (let k = 0; k < TERMINAL_DRAWS; k++) terminal[k] = Math.exp(m + s * z());

    return { paths, terminal };
  }

  // --- One figure -----------------------------------------------------------

  function mount(figure) {
    const canvas = figure.querySelector("canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const seedLabel = figure.querySelector("[data-seed]");
    const countLabel = figure.querySelector("[data-count]");
    const readout = figure.querySelector("[data-readout]");
    const redrawButton = figure.querySelector("[data-redraw]");
    const inputs = figure.querySelectorAll("input[data-param]");
    const useUrlSeed = figure.hasAttribute("data-url-seed");

    const num = (value, fallback) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const model = {
      mu: num(figure.dataset.mu, 0.06),
      sigma: num(figure.dataset.sigma, 0.2),
      s0: 1,
      years: 1,
    };
    const fixedRange = figure.dataset.ymin !== undefined && figure.dataset.ymax !== undefined
      ? [num(figure.dataset.ymin, 0.5), num(figure.dataset.ymax, 2)]
      : null;

    const state = {
      seed: initialSeed(),
      nPaths: 0,
      sim: null,
      progress: 0,
      hover: null,
      frame: 0,
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

    function readColours() {
      const css = getComputedStyle(document.documentElement);
      const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
      state.colours = {
        ink: get("--ink", "#14213A"),
        muted: get("--muted", "#56607A"),
        rule: get("--rule", "#DCD6C8"),
        accent: get("--accent", "#C2412D"),
        pathAlpha: parseFloat(get("--path-alpha", "0.17")),
        bandAlpha: parseFloat(get("--band-alpha", "0.11")),
        mono: get("--mono", '"JetBrains Mono", ui-monospace, monospace'),
      };
    }

    // --- Geometry -----------------------------------------------------------

    function layout() {
      const w = state.width;
      const h = state.height;
      const compact = w < 560;
      const histWidth = compact ? Math.max(44, w * 0.15) : Math.min(130, w * 0.17);
      const plot = { x0: 2, x1: w - histWidth - 16, y0: 10, y1: h - 24 };
      const hist = { x0: plot.x1 + 12, x1: w - 2 };
      const [lo, hi] = fixedRange || [quantileAt(model, model.years, -Y_Z), quantileAt(model, model.years, Y_Z)];
      const x = (t) => plot.x0 + (t / model.years) * (plot.x1 - plot.x0);
      const y = (s) => plot.y1 - ((s - lo) / (hi - lo)) * (plot.y1 - plot.y0);
      return { plot, hist, lo, hi, x, y };
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.width = Math.max(1, rect.width);
      state.height = Math.max(1, rect.height);
      canvas.width = Math.round(state.width * dpr);
      canvas.height = Math.round(state.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const nPaths = state.width < 560 ? 24 : 48;
      if (nPaths !== state.nPaths || !state.sim) {
        state.nPaths = nPaths;
        state.sim = simulate(model, state.seed, nPaths);
        if (countLabel) countLabel.textContent = String(nPaths);
      }
    }

    // --- Drawing ------------------------------------------------------------

    function easeOut(p) {
      return 1 - Math.pow(1 - p, 3);
    }

    function draw() {
      const c = state.colours;
      const L = layout();
      const { plot, hist, x, y } = L;
      const dt = model.years / STEPS;
      const k = Math.max(1, Math.round(state.progress * STEPS));

      ctx.clearRect(0, 0, state.width, state.height);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Time axis.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x0, plot.y1 + 0.5);
      ctx.lineTo(hist.x1, plot.y1 + 0.5);
      ctx.stroke();

      ctx.font = `11px ${c.mono}`;
      ctx.fillStyle = c.muted;
      ctx.textBaseline = "top";
      for (const [t, label] of TICKS) {
        const tx = x(t);
        ctx.beginPath();
        ctx.moveTo(tx + 0.5, plot.y1);
        ctx.lineTo(tx + 0.5, plot.y1 + 5);
        ctx.stroke();
        ctx.textAlign = t === 0 ? "left" : t === model.years ? "right" : "center";
        ctx.fillText(label, tx, plot.y1 + 8);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x0, plot.y0 - 6, plot.x1 - plot.x0 + 1, plot.y1 - plot.y0 + 6);
      ctx.clip();

      // Analytical 90% band.
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) ctx.lineTo(x(i * dt), y(quantileAt(model, i * dt, Z90)));
      for (let i = STEPS; i >= 0; i--) ctx.lineTo(x(i * dt), y(quantileAt(model, i * dt, -Z90)));
      ctx.closePath();
      ctx.globalAlpha = c.bandAlpha;
      ctx.fillStyle = c.accent;
      ctx.fill();

      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1;
      for (const z of [Z90, -Z90]) {
        ctx.beginPath();
        for (let i = 0; i <= STEPS; i++) ctx.lineTo(x(i * dt), y(quantileAt(model, i * dt, z)));
        ctx.stroke();
      }

      // Median of S_t: S_0 exp((mu - sigma^2/2) t).
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = c.ink;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) ctx.lineTo(x(i * dt), y(quantileAt(model, i * dt, 0)));
      ctx.stroke();
      ctx.setLineDash([]);

      // Sample paths, the first one highlighted.
      const paths = state.sim.paths;
      ctx.globalAlpha = c.pathAlpha;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1;
      for (let p = 1; p < paths.length; p++) {
        const path = paths[p];
        ctx.beginPath();
        ctx.moveTo(x(0), y(path[0]));
        for (let i = 1; i <= k; i++) ctx.lineTo(x(i * dt), y(path[i]));
        ctx.stroke();
      }

      const lead = paths[0];
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x(0), y(lead[0]));
      for (let i = 1; i <= k; i++) ctx.lineTo(x(i * dt), y(lead[i]));
      ctx.stroke();

      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(x(k * dt), y(lead[k]), 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();

      drawHistogram(L, easeOut(Math.max(0, (state.progress - 0.55) / 0.45)));

      if (state.hover !== null && state.progress >= 1) drawCrosshair(L, state.hover);
    }

    function drawHistogram(L, grow) {
      if (grow <= 0) return;
      const c = state.colours;
      const { hist, lo, hi, y } = L;
      const width = hist.x1 - hist.x0;
      const binWidth = (hi - lo) / BINS;
      const counts = new Array(BINS).fill(0);
      for (const v of state.sim.terminal) {
        const b = Math.floor((v - lo) / binWidth);
        if (b >= 0 && b < BINS) counts[b] += 1;
      }

      // Bars and density share one density axis, scaled to the density's peak.
      let peak = 0;
      for (let i = 0; i <= 200; i++) peak = Math.max(peak, terminalDensity(model, lo + ((hi - lo) * i) / 200));
      const scale = (0.92 * width * grow) / peak;
      const toDensity = 1 / (TERMINAL_DRAWS * binWidth);

      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hist.x0 + 0.5, L.plot.y0);
      ctx.lineTo(hist.x0 + 0.5, L.plot.y1);
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.rect(hist.x0, L.plot.y0 - 6, width + 2, L.plot.y1 - L.plot.y0 + 6);
      ctx.clip();

      ctx.fillStyle = c.ink;
      ctx.globalAlpha = c.pathAlpha * 1.4;
      for (let b = 0; b < BINS; b++) {
        const top = y(lo + (b + 1) * binWidth);
        const bottom = y(lo + b * binWidth);
        const len = counts[b] * toDensity * scale;
        ctx.fillRect(hist.x0 + 1, top + 0.5, len, Math.max(0.5, bottom - top - 1));
      }

      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const s = lo + ((hi - lo) * i) / 120;
        ctx.lineTo(hist.x0 + 1 + terminalDensity(model, s) * scale, y(s));
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawCrosshair(L, index) {
      const c = state.colours;
      const t = (index / STEPS) * model.years;
      const px = Math.round(L.x(t)) + 0.5;
      const lead = state.sim.paths[0][index];

      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, L.plot.y0);
      ctx.lineTo(px, L.plot.y1);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 1;
      ctx.fillStyle = c.accent;
      for (const s of [quantileAt(model, t, Z90), quantileAt(model, t, -Z90)]) {
        ctx.beginPath();
        ctx.arc(px, L.y(s), 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(px, L.y(lead), 4, 0, 2 * Math.PI);
      ctx.fill();
    }

    // --- Labels -------------------------------------------------------------

    function updateReadout() {
      if (!readout) return;
      const index = state.hover === null ? STEPS : state.hover;
      const t = (index / STEPS) * model.years;
      const lead = state.sim.paths[0][index];
      const days = String(index).padStart(3, " ");
      readout.textContent =
        `t = ${days}d · S = ${lead.toFixed(2)} · 90% band ` +
        `${quantileAt(model, t, -Z90).toFixed(2)}–${quantileAt(model, t, Z90).toFixed(2)}`;
    }

    function updateLabels() {
      if (seedLabel) seedLabel.textContent = `seed ${state.seed}`;
      for (const input of inputs) {
        const output = figure.querySelector(`output[data-for="${input.dataset.param}"]`);
        if (output) output.textContent = `${Math.round(model[input.dataset.param] * 100)}%`;
      }
      updateReadout();
    }

    // --- Animation ----------------------------------------------------------

    function play() {
      cancelAnimationFrame(state.frame);
      if (reduceMotion.matches) {
        state.progress = 1;
        draw();
        return;
      }
      const start = performance.now();
      const tick = (now) => {
        state.progress = Math.min(1, (now - start) / DURATION_MS);
        draw();
        if (state.progress < 1) state.frame = requestAnimationFrame(tick);
      };
      state.frame = requestAnimationFrame(tick);
    }

    // --- Events -------------------------------------------------------------

    canvas.addEventListener("pointermove", (event) => {
      if (state.progress < 1) return;
      const L = layout();
      const px = event.clientX - canvas.getBoundingClientRect().left;
      let index = null;
      if (px >= L.plot.x0 && px <= L.plot.x1) {
        const share = (px - L.plot.x0) / (L.plot.x1 - L.plot.x0);
        index = Math.max(0, Math.min(STEPS, Math.round(share * STEPS)));
      }
      if (index !== state.hover) {
        state.hover = index;
        updateReadout();
        draw();
      }
    });

    canvas.addEventListener("pointerleave", () => {
      state.hover = null;
      updateReadout();
      if (state.progress >= 1) draw();
    });

    if (redrawButton) {
      redrawButton.addEventListener("click", () => {
        state.seed = randomSeed();
        state.sim = simulate(model, state.seed, state.nPaths);
        state.hover = null;
        updateLabels();
        if (useUrlSeed) {
          const url = new URL(window.location.href);
          url.searchParams.set("seed", String(state.seed));
          window.history.replaceState(null, "", url);
        }
        play();
      });
    }

    // Sliders keep the seed, so only the parameters change between redraws.
    for (const input of inputs) {
      input.value = String(model[input.dataset.param]);
      input.addEventListener("input", () => {
        model[input.dataset.param] = parseFloat(input.value);
        state.sim = simulate(model, state.seed, state.nPaths);
        cancelAnimationFrame(state.frame);
        state.progress = 1;
        updateLabels();
        draw();
      });
    }

    let resizeTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        draw();
      }, 60);
    }).observe(canvas);

    // Quarto's light/dark toggle swaps stylesheets and body classes.
    const recolour = () => requestAnimationFrame(() => {
      readColours();
      draw();
    });
    new MutationObserver(recolour).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolour);

    // --- Start --------------------------------------------------------------

    readColours();
    resize();
    updateLabels();
    canvas.dataset.ready = "true";

    const start = () => {
      readColours();
      play();
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
    else start();
  }

  document.querySelectorAll("[data-paths]").forEach(mount);
})();
