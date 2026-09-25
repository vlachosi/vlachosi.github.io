/*
 * Navbar monogram: the pen-drawn "IV" sits on an implied-volatility smile that
 * is redrawn on every page load, with a random skew and curvature, and a dot
 * at its minimum. The letters come from the stylesheet; this script adds the
 * smile. Without JavaScript a fixed smile is shown instead.
 */
(function () {
  "use strict";

  const brand = document.querySelector(".navbar-brand");
  if (!brand) return;

  const NS = "http://www.w3.org/2000/svg";
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // Smile in the monogram's 64-unit box: minimum somewhere under the letters,
  // wings of unequal height (usually higher on the left, like equity skew).
  const x0 = 5.5;
  const x1 = 58.5;
  const xm = rand(20, 44);
  const ym = rand(53.5, 56);
  const skewLeft = Math.random() < 0.75;
  const hLeft = skewLeft ? rand(6.5, 11) : rand(3.5, 7);
  const hRight = skewLeft ? rand(3.5, 7.5) : rand(6.5, 11);
  const power = rand(1.6, 2.4);

  const points = [];
  for (let i = 0; i <= 32; i++) {
    const x = x0 + (i / 32) * (x1 - x0);
    const u = x < xm ? (xm - x) / (xm - x0) : (x - xm) / (x1 - xm);
    const h = x < xm ? hLeft : hRight;
    points.push(`${x.toFixed(2)} ${(ym - h * Math.pow(u, power)).toFixed(2)}`);
  }

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "brand-smile");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", points.join(" "));
  svg.appendChild(line);

  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("cx", xm.toFixed(2));
  dot.setAttribute("cy", ym.toFixed(2));
  dot.setAttribute("r", "3.5");
  svg.appendChild(dot);

  brand.appendChild(svg);
  brand.classList.add("has-live-smile");
})();
