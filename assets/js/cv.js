/*
 * CV viewer. Draws the PDF named in [data-cv-viewer] into the page with
 * PDF.js: one canvas per page, a transparent text layer on top so the text can
 * be selected and searched, and clickable areas for the PDF's links. Until the
 * PDF exists, the page shows its placeholder message instead.
 */
import * as pdfjsLib from "/assets/vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/pdf.worker.min.mjs";

const viewer = document.querySelector("[data-cv-viewer]");
const download = document.querySelector("[data-cv-download]");
const loading = document.querySelector("[data-cv-loading]");
const missing = document.querySelector("[data-cv-missing]");

async function drawPage(page, width) {
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 3);

  const wrap = document.createElement("div");
  wrap.className = "cv-page";
  wrap.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
  wrap.style.setProperty("--scale-factor", scale);
  wrap.style.setProperty("--total-scale-factor", scale);
  wrap.style.setProperty("--scale-round-x", "1px");
  wrap.style.setProperty("--scale-round-y", "1px");

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.setAttribute("aria-hidden", "true");
  wrap.appendChild(canvas);

  const text = document.createElement("div");
  text.className = "textLayer";
  wrap.appendChild(text);

  const links = document.createElement("div");
  links.className = "cv-links";
  wrap.appendChild(links);

  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
  }).promise;

  await new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container: text,
    viewport,
  }).render();

  for (const annotation of await page.getAnnotations()) {
    if (annotation.subtype !== "Link" || !annotation.url) continue;
    const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
    const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
    const link = document.createElement("a");
    link.className = "cv-link";
    link.href = annotation.url;
    link.setAttribute("aria-label", annotation.url.replace(/^mailto:/, ""));
    Object.assign(link.style, {
      left: `${Math.min(x1, x2)}px`,
      top: `${Math.min(y1, y2)}px`,
      width: `${Math.abs(x2 - x1)}px`,
      height: `${Math.abs(y2 - y1)}px`,
    });
    links.appendChild(link);
  }

  return wrap;
}

async function main() {
  if (!viewer) return;
  const src = new URL(viewer.dataset.cvViewer, window.location.href).href;

  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ url: src }).promise;
  } catch (error) {
    if (loading) loading.hidden = true;
    if (missing) missing.hidden = false;
    return;
  }

  if (download) {
    download.classList.remove("is-disabled");
    download.removeAttribute("aria-disabled");
    download.href = src;
  }

  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) pages.push(await pdf.getPage(n));

  // Redraw at the container's width, and again whenever that width changes.
  let drawnWidth = 0;
  const draw = async () => {
    const width = Math.floor(viewer.clientWidth);
    if (!width || width === drawnWidth) return;
    drawnWidth = width;
    const drawn = [];
    for (const page of pages) drawn.push(await drawPage(page, width));
    if (width === drawnWidth) viewer.replaceChildren(...drawn);
  };
  await draw();
  viewer.dataset.ready = "true";

  let timer = 0;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  }).observe(viewer);
}

main();
