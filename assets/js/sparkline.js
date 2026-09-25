/*
 * Sparkline "fingerprints": a short Gaussian random walk seeded from a hash of
 * an item's address, so every page and post keeps the same line wherever it
 * appears. Fills <svg class="spark" data-spark="..."> and adds one under each
 * page title.
 */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const STEPS = 40;

  function fnv1a(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

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

  // Resolve relative links so an item hashes the same from any page.
  function normalise(key) {
    if (/^[a-z]+:/i.test(key) && !/^https?:/i.test(key)) return key;
    try {
      const path = new URL(key, window.location.href).pathname;
      return path.replace(/index\.html$/, "").replace(/\.html$/, "").replace(/\/$/, "") || "/";
    } catch (error) {
      return key;
    }
  }

  function walk(key) {
    const rng = mulberry32(fnv1a(key));
    const values = [0];
    for (let i = 1; i < STEPS; i++) {
      let u = 0;
      while (u === 0) u = rng();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
      values.push(values[i - 1] + z);
    }
    return values;
  }

  function render(svg, key) {
    const values = walk(normalise(key));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const w = 100;
    const h = 20;
    const points = values.map((v, i) => [(i / (STEPS - 1)) * w, h - ((v - min) / span) * h]);

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("focusable", "false");
    svg.replaceChildren();

    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("class", "spark-line");
    line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
    svg.appendChild(line);

    // A zero-length round-capped segment stays circular under non-uniform scaling.
    const [ex, ey] = points[points.length - 1];
    const end = document.createElementNS(NS, "line");
    end.setAttribute("x1", ex);
    end.setAttribute("x2", ex);
    end.setAttribute("y1", ey);
    end.setAttribute("y2", ey);
    end.setAttribute("stroke", "var(--accent)");
    end.setAttribute("stroke-width", "5");
    end.setAttribute("stroke-linecap", "round");
    end.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(end);
  }

  function addTitleSpark() {
    const header = document.querySelector("#title-block-header");
    if (!header || header.querySelector(".title-spark")) return;
    if (document.body.classList.contains("no-title-spark")) return;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "spark title-spark");
    svg.setAttribute("aria-hidden", "true");
    svg.dataset.spark = window.location.pathname;
    header.appendChild(svg);
  }

  addTitleSpark();
  document.querySelectorAll("svg.spark[data-spark]").forEach((svg) => render(svg, svg.dataset.spark));
})();
