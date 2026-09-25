# vlachosi.github.io

My personal academic website, where I put my research, CV, and whatever I am working on. It is built with [Quarto](https://quarto.org) and published at <https://ioannisvlachos.com> by GitHub Actions.

## Working on the site

Install Quarto 1.9 or later, then from the repository root run:

```sh
quarto preview                    # live preview, drafts included
quarto render                     # full build into _site/, drafts excluded
quarto render --profile drafts    # full build with drafts visible
```

Everything published comes from `main`. Pushing to `main` runs `.github/workflows/publish.yml`, which renders the site and deploys it to GitHub Pages. Pull requests only render, to check that the build works.

## Where to edit

| What | File |
|---|---|
| Papers, work in progress, thesis | `research/papers.yml` |
| Blog posts | `writing/posts/<yyyy-mm-dd-slug>/index.qmd` |
| Projects and software | `projects/projects.yml` |
| Talks (hidden) | `talks/talks.yml` |
| Teaching (hidden) | `teaching/teaching.yml` |
| CV (PDF shown on the CV page) | `cv/vlachos-cv.pdf` |
| About page and bio | `about.qmd` |
| Front page | `index.qmd` |
| Navigation, footer, site settings | `_quarto.yml` |
| Colours (light and dark) | `styles/light.scss`, `styles/dark.scss` |
| Layout and typography (type sizes and spacing are set once at the top) | `styles/common.scss`, `styles/fonts.css` |
| Front-page dial | `assets/js/dial.js` |

Talks and Teaching are hidden for now: they are left out of the navigation and the build. To bring one back, re-add its entry under `website.navbar.right` in `_quarto.yml` and delete its `"!talks/"` or `"!teaching/"` line under `project.render`.

Entries marked `placeholder: true` in the YAML files are shown with a dashed "placeholder" tag. Replace the text and delete that line once an entry is real. Each YAML file lists the fields it understands at the top.

To add a post, create a folder under `writing/posts/` with an `index.qmd` holding `title`, `description` and `date` in its front matter. Add `draft: true` to keep it off the live site until it is ready. Posts can contain R or Python code: with `freeze: auto`, results are computed on your machine when you render, and the `_freeze/` folder they produce should be committed so that the build server never runs code.

The front-page dial shows one simulated year, January at the top. Each draw places four earnings releases (one per quarter) and two macro releases at new dates; their names, counts and jump sizes are set at the top of `assets/js/dial.js`.

Two small jobs are waiting:

- **Email.** Fill in `USER` and `DOMAIN` in `assets/js/email.js`. The address is assembled in the browser, so it never sits in the HTML as plain text.
- **CV PDF.** Save the compiled PDF as `cv/vlachos-cv.pdf` and push. The CV page draws it in the browser (PDF.js, `assets/js/cv.js`) and enables the download button; until the file exists the page shows a placeholder. To update the CV later, replace the same file.

## Credits

Fonts are Petrona, Source Sans 3 and JetBrains Mono, all under the SIL Open Font License (see `assets/fonts/`). Maths is typeset with a self-hosted copy of KaTeX (MIT; see `assets/vendor/katex/`), and the CV is drawn with a self-hosted copy of PDF.js (Apache-2.0; see `assets/vendor/pdfjs/`).
