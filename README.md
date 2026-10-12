# OS-native Agents project website

This repository contains the paper homepage and interactive trajectory demo for [OS-native Agents / DynamicWorld](https://github.com/FreedomIntelligence/OSNativeAgent).

## Pages and source

- `index.html`, `home.css`, `home.js`: paper homepage, model-result comparison and citation.
- `demo/index.html`: interactive home-repair trajectory viewer.
- `app.js`, `observations.js`, `style.css`: the retained viewer implementation. The Demo sets its base URL to the repository root, sharing the existing data, images and fonts.
- `data/home_repair.json`, `data/catalog.json`, `assets/*.png`: retained trajectory data and images.
- `data/dynamicworld-results.json`: Table 3 data copied from the code repository.
- `assets/figures/`: paper figures. The arXiv button is explicitly marked “Coming soon”; no manuscript PDF is included.
- `data/original-export-manifest.json`: original trajectory export provenance.
- `manifest.json`: retained trajectory provenance plus current presentation-file hashes.

All web presentation lives in this repository. The Android Apps, Agent runtime, task suite and evaluator stay in the code repository. The homepage links to those maintained setup and evaluation guides.

Existing `#scene=...` links at the site root redirect to `demo/` and retain the complete trajectory hash. Standard homepage anchors such as `#results` stay on the homepage. The Demo and original images share one deployment and require no backend or model calls.

## Local preview

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/` for the paper homepage and `http://127.0.0.1:8766/demo/` for the viewer. The site also works under GitHub Pages project paths because all local resources use relative URLs.

After updating site files, run:

```bash
python3 scripts/update-manifest.py
```

This verifies that the original trajectory JSON and 278 original PNGs have not changed, then refreshes presentation hashes. It does not modify trajectory data or scores, call a model or operate a phone. Refresh `data/dynamicworld-results.json` from the code repository when changing published result data; update the static fallback table in `index.html` at the same time.

## Browser checks

Install Playwright in a development environment and make Chromium available. Run `node scripts/test-home.cjs` for the homepage and its Demo links, then `SHOWCASE_URL=http://127.0.0.1:8766/demo node scripts/test-browser.cjs` for the viewer. Optional `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` select an existing installation. Screenshots go to ignored `preview/`.

## Deployment

The existing GitHub Pages repository is the destination for both pages. Preserve its configured Pages branch and root directory; `.nojekyll` keeps this a buildless static site. Publishing these changes updates the homepage and adds `demo/` together. No additional website repository is required.

When an arXiv identifier is available, replace the disabled arXiv placeholder in `index.html` with the real abstract-page link, then update the citation in both repositories. No arXiv identifier or paper URL is fabricated.
