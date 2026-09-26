# Verification record — 2026-09-26

Environment: macOS on Apple silicon, Electron 44.4.5, Playwright 1.63.0.
All session tests use disposable user-data directories, not the user's browser or
existing Search Stack sessions. Subsequent automation runs use hidden windows.

## Automated checks

All four unit tests and five full-app scenarios passed locally.

- `npm test`: migration of legacy settings, stable profile identifiers, query
  encoding, template URL restrictions, profile/engine validation.
- `npm run test:e2e`: five scenarios exercising the running Electron app:
  compact geometry and resize; switching and preserved scroll; provider-focused
  shortcuts; navigation; theme changes without replacing views; modal/native
  view visibility; failure, stop and crash recovery; custom engines and duplicate
  Google profiles; isolated cookies surviving process restart; confirmed profile
  deletion and cancellation; a real infinite loop in a remote renderer; remote
  privilege isolation; blocked HTTP navigation/pop-ups; inactive-view cleanup.
- The frozen-renderer test uncovered that Electron's `unresponsive` event alone
  did not reliably fire for composed views. The app now also checks the visible
  page's isolated preload, and the test verifies detection and recovery.
- A regression test also reproduces and covers the inherited interception of
  JavaScript-based website controls. Same-page controls now work within the
  existing sandbox; unsafe document navigation and pop-ups stay blocked.
- Native Windows/Linux test jobs are configured but have not run locally.

## Real websites

A real network run sent `Electron WebContentsView documentation` to all six
engines. No fixture interception, account login, consent acceptance, or CAPTCHA
interaction was used. The native window was also visually inspected on macOS.

| Provider | Observed outcome |
| --- | --- |
| Google | Unusual-traffic CAPTCHA, not search results |
| Bing | Search results |
| Yahoo | Search results with a privacy notice |
| Baidu | Search results |
| DuckDuckGo | Search results |
| Yandex | Anti-bot challenge, not search results |

The app remained usable across all six pages. Live engine switching checks waited
for the corresponding native view to become visible, not just the highlighted
tab. Timing includes test-driver and polling overhead and is not a benchmark.
Raw local evidence is under `output/playwright/live/` and is excluded from Git.

Persistent cookie isolation is verified across a real process restart. Successful
sign-in with an actual Google account is not claimed; providers may restrict
embedded browser login independently of session persistence. Theme preferences
are sent to Chromium; websites retain control over their appearance.

## Packaged macOS app

`npm run package:mac` produced an ARM64 DMG and ZIP. A hidden launch of the actual
packaged executable verified `app.isPackaged`, four native search pages, switching,
and saving the Night theme using a temporary data directory.

## Scope of confidence

These tests establish the covered application behaviors on this Mac, not universal
provider availability or native Windows/Linux support. They do not establish
behavior under every memory-pressure, network, or OS failure. macOS packaging is
unsigned/unnotarized; signing and distribution are outside this change.
