# OS-native Agents project website

This repository contains the paper homepage and interactive trajectory demo for [OS-native Agents / DynamicWorld](https://github.com/FreedomIntelligence/OSNativeAgent).

## Pages and source

- `index.html`, `home.css`, `home.js`, `stories.js`: paper homepage, recorded cases, results and citation.
- `demo/index.html`: interactive comparison across four GPT-5.4 scenarios.
- `app.js`, `observations.js`, `style.css`: trajectory viewer.
- `data/catalog.json`, the four scenario JSON files and `assets/*.png`: recorded trajectories and captured phone screens.
- `data/dynamicworld-results.json`: Table 3–4 data, shared with the code repository.
- `assets/figures/`: paper figures and screenshots of the homepage observation panels, shared with the code repository.
- `data/stories.json`, `data/showcase.json`: selected observations, deep links and screenshot provenance.
- `data/original-export-manifest.json`, `data/additional-export-manifest.json`: original and additional trajectory export provenance.
- `manifest.json`: retained trajectory provenance plus current presentation-file hashes.

The Android apps, agent runtime, task suite, and evaluator are available in the [code repository](https://github.com/FreedomIntelligence/OSNativeAgent).

<!-- The demo sets its base URL to the repository root to share data, images,
and fonts. Existing root #scene=... links redirect to demo/ and retain the full
trajectory hash. Standard homepage anchors stay on the homepage. The viewer
uses saved data without a backend or model calls. -->

## Local preview

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8766/` for the paper homepage and `http://127.0.0.1:8766/demo/` for the viewer. The site also works under GitHub Pages project paths because all local resources use relative URLs.

After updating site files, run:

```bash
python3 scripts/update-manifest.py
```

This checks both trajectory exports and their captured images, then refreshes presentation hashes.

<!-- When updating published results, copy data/dynamicworld-results.json from
the code repository and update the static fallback tables in index.html. -->

## Browser checks

Install Playwright in a development environment and make Chromium available. Run `node scripts/test-home.cjs` for the homepage and its Demo links, `node scripts/test-layout.cjs` for responsive layouts and loading fallbacks, then `SHOWCASE_URL=http://127.0.0.1:8766/demo node scripts/test-browser.cjs` for the viewer. Optional `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` select an existing installation. Screenshots go to ignored `preview/`.

## Deployment

Serve the repository root with GitHub Pages. The homepage and `demo/` share one deployment; `.nojekyll` keeps the site buildless.

<!-- When the arXiv identifier is available, replace the disabled placeholder in
index.html with the abstract-page link and update the citation in both repositories. -->
