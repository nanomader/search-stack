# Development and builds

Use Node.js 24 or newer:

```sh
git clone https://github.com/nanomader/search-stack.git
cd search-stack
```

From the repository root:

```sh
npm ci
npm start
npm run verify
npm run format:check
npm run format
npm test
npm run test:e2e
npm run test:live
```

`test:live` is an optional network check against the actual search engines.
The deterministic end-to-end suite replaces only the external HTTPS responses
and native deletion-confirmation answers. It runs the real Electron app, IPC,
settings, native views, session storage, shortcuts, and recovery code.

Both suites that launch Electron use hidden windows, disposable session data,
and a non-activating macOS application policy. They do not reuse your normal
Search Stack sessions. Linux needs a display server:

```sh
xvfb-run --auto-servernum npm run test:e2e
```

See [VALIDATION.md](../VALIDATION.md) for covered scenarios and platform evidence.
Failure traces and local screenshots are saved in `output/playwright/` and ignored
by Git. Live captures can contain provider-supplied network identifiers; inspect
images before sharing them.

## Architecture

The local UI and remote websites use separate sandboxed `WebContentsView`
instances inside an Electron `BaseWindow`. Focus, Split, and Stack reuse those
views. Each engine/profile combination has a persistent session partition.

The main process validates settings and incoming app requests. Remote pages have
Node integration disabled, context isolation and sandboxing enabled, and HTTPS-only
document navigation. Ordinary HTTPS links targeting a new tab open in their existing
panel. Pop-ups and unsafe document navigation are blocked. Downloads require a
user gesture and the operating system's save dialog.

A slow network load gets a status after 15 seconds. A ping checks each visible
page's event loop; a frozen page is detected in roughly 8–12 seconds. Reload can
recreate crashed, frozen, or slow views while keeping session storage. Recreating
a view resets its navigation history. Hidden/minimized pages are not polled.

## Build installers

Run on the target operating system:

```sh
npm run package:mac
npm run package:win
npm run package:linux
```

Builds are written to `dist/`. Packaging does not publish a release.
Maintainers use `npm run package:mac:signed` for Developer ID packaging; see the
[release procedure](DISTRIBUTION.md) for notarization and verification.

`npm run package:mac` produces an ad-hoc-signed preview. This free integrity signature requires
no Apple account and is not a Developer ID signature or notarization. macOS can
still block a downloaded preview on first launch.

Do not replace a packaged app while it is running. Use a separate output folder:

```sh
npm run package:mac -- --config.directories.output=dist/preview
```

Run the same hidden-window app tests against the locally built macOS bundle:

```sh
SEARCH_STACK_EXECUTABLE="$PWD/dist/preview/mac-arm64/Search Stack.app/Contents/MacOS/Search Stack" npm run test:e2e
```

A quarantined download can trigger a visible macOS security dialog before Electron
starts, even with hidden test windows. Do not run this suite against a fresh
download during background work. Its first launch requires manual approval.

Builds and checks run locally. GitHub Actions is disabled for the repository, and the former workflow file has
been removed to prevent automatic hosted runs.
`npm run verify` runs formatting, unit tests, and the hidden-window Electron suite.
Run it before packaging. GitHub hosts the source and release downloads; uploading
an installer does not require a GitHub Actions job.

## README screenshots

```sh
node scripts/capture-screenshots.js
```

This opens an isolated, hidden app and searches all six built-in engines for
`best walks in the Lake District`. It captures the engine selector, Bing/DuckDuckGo
and Yahoo/Baidu comparisons, and the Night theme in `output/playwright/readme/`. Review them before copying selected images
to `docs/screenshots/`. The query is public and no account is signed in. Region follows the connection and
provider settings; verify the visible region before publishing UK screenshots.
Individual engine captures and `outcomes.json` are inspection material only:
challenge pages can expose network identifiers and must not be copied into Git.

Electron captures each native web view separately. The capture script assembles
those unaltered surfaces at their actual window coordinates in another hidden
window. These are captures of the real app and websites, not design mockups.
Website results and appearance can change between runs.
