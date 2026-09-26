# Verification record — 2026-09-26

Environment: macOS on Apple silicon, Electron 44.4.5, Playwright 1.63.0.
All session tests use disposable user-data directories, not the user's browser or
existing Search Stack sessions. Subsequent automation runs use hidden windows.

## Automated checks

All five unit tests and seven full-app scenarios passed locally.

The code-cleanup pass reran the same suite before and after refactoring, with all
checks passing in hidden windows. Formatting is pinned with Prettier and checked
by `npm run format:check`. The former CI workflow also ran this check. Functional changes were reviewed
separately from formatting: shared IPC authorization/subscription helpers, session
cleanup, view hiding, scroll transitions, and repeated UI lookups preserve the
existing behavior. No test assertions were removed or weakened.

- `npm test`: migration of legacy settings, stable profile identifiers, query
  encoding, template URL restrictions, profile/engine validation, split preference
  migration and validation.
- `npm run test:e2e`: seven scenarios exercising the running Electron app:
  compact geometry and resize; switching and preserved scroll; provider-focused
  shortcuts; navigation; theme changes without replacing views; modal/native
  view visibility; failure, stop and crash recovery; custom engines and duplicate
  Google profiles; isolated cookies surviving process restart; confirmed profile
  deletion and cancellation; a real infinite loop in a remote renderer; remote
  privilege isolation; blocked HTTP navigation/pop-ups; inactive-view cleanup.
- Split coverage verifies two real native views with independent scroll positions,
  engine/profile selection (including two Google profiles), swapping, shortcuts
  routed to the active side, non-overlapping bounds at normal and minimum sizes,
  modal visibility, saved choices across queries and process restart, recovery of
  a crashed side, replacement of disabled choices, and fallback to a single page.
  Every test launch asserts that its native window is hidden.
- The frozen-renderer test uncovered that Electron's `unresponsive` event alone
  did not reliably fire for composed views. The app now also checks the visible
  page's isolated preload, and the test verifies detection and recovery.
- A regression test also reproduces and covers the inherited interception of
  JavaScript-based website controls. Same-page controls now work within the
  existing sandbox; unsafe document navigation and pop-ups stay blocked.
- The first GitHub Actions run for `3e1bfa9` passed all five unit tests and all seven
  Electron scenarios on both macOS ARM64 and Linux x64. Windows stopped at the
  formatting check before running tests; its checkout used different line endings.

## Public-preview preparation

[The first CI run](https://github.com/nanomader/search-stack/actions/runs/36246363987)
failed overall despite the passing macOS/Linux tests:

- macOS produced the DMG and ZIP, then failed when electron-builder attempted an
  implicit CI upload without a GitHub publishing token. Packaging commands now
  explicitly use `--publish never`. A local `CI=true` macOS package run completed
  successfully with the corrected command and a separate `dist/public-preview/`
  output directory.
- Windows formatting failed on checkout line endings. `.gitattributes` now enforces
  LF for text. Formatting passed in a disposable checkout with `core.autocrlf=true`.
  A fresh native Windows check is still required before a Windows release.
- Linux passed the Electron suite and built AppImage, then failed on the .deb
  target because a public maintainer email was missing. The first Linux download
  format remains a release decision; no email has been invented or disclosed.

The README's Day/Night screenshots were captured from live Bing and DuckDuckGo
pages in hidden, isolated windows. Local documentation links and image paths were
checked. No public release or Homebrew package has been published by this
preparation pass.

## Local build policy and hosted-cost prevention

The user requires a release process without paid build infrastructure. The remote
`Build desktop app` workflow was disabled and its state verified as
`disabled_manually`. No runs were active, and the repository had zero Actions
artifacts at the time of inspection. The local workflow file has been removed.
The earlier hosted run remains historical usage; no claim is made about its
billing impact.

Use `npm run verify` and the local packaging commands for future releases. Upload
finished installers to GitHub Releases manually. Native Windows/Intel Mac checks
are deferred until suitable existing hardware is available; no paid runner or
cloud machine is required by the distribution plan.

## Real websites

A real network run sent `Electron WebContentsView documentation` to all six
engines. No fixture interception, account login, consent acceptance, or CAPTCHA
interaction was used. The native window was also visually inspected on macOS.

| Provider   | Observed outcome                            |
| ---------- | ------------------------------------------- |
| Google     | Unusual-traffic CAPTCHA, not search results |
| Bing       | Search results                              |
| Yahoo      | Search results with a privacy notice        |
| Baidu      | Search results                              |
| DuckDuckGo | Search results                              |
| Yandex     | Anti-bot challenge, not search results      |

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

The split-view build was packaged separately with
`npm run package:mac -- --config.directories.output=dist/split-preview`, preserving
the existing running app. Its actual executable loaded live Bing and DuckDuckGo
search pages side by side, with non-overlapping native bounds and 130 pixels of
app controls. Swapping sides and opening Settings passed. The test confirmed
`app.isPackaged` and a hidden native window, and used disposable session data.
Evidence: `output/playwright/packaged-split.json` (excluded from Git).

## Scope of confidence

These tests establish the covered application behaviors on this Mac, not universal
provider availability or native Windows/Linux support. They do not establish
behavior under every memory-pressure, network, or OS failure. The macOS preview is ad-hoc signed and not notarized. A launch after manual Gatekeeper approval, Intel Mac, and native Windows release
qualification remain unverified.

## First public preview (0.1.0)

The release preparation passed formatting, all five unit tests, and all seven
hidden-window Electron end-to-end scenarios. The same seven scenarios also passed
against the actual ARM64 release executable with `app.isPackaged` asserted.
Every test used temporary session data; the running user application was preserved.

The older unsigned bundle failed strict signature verification. The release build
uses free ad-hoc signing and passes `codesign --verify --deep --strict`. This is
bundle-integrity evidence, not Developer ID signing or Apple notarization.

Artifacts were built locally into `dist/release-0.1.0` with publishing disabled:

- DMG SHA-256: `fadd8f72faf1060c992fda81d1f4ebf80514fcc12603e9a8a57eb22f8f283981`
- ZIP SHA-256: `02d521859b732e6afb918a41f425f800070249bf0661e6b305d0e59323cf8755`

GitHub Actions was disabled for the entire source repository, beyond disabling
the old workflow. The README uses real Day/Night app captures and a clearly
separate generated hamster illustration.

### Published download and Homebrew installation

The public `v0.1.0` release points to commit
`747f172b87dc2f34050f68b952ec16e5c891a9b0`. All seven source files in the packaged
ASAR were byte-compared with the release source. GitHub's uploaded-asset digests
match the local DMG and ZIP checksums above.

Homebrew downloaded the public DMG, verified its checksum, and installed it into
a separate temporary app directory. `brew info` correctly reports ARM64 and
macOS >= 13 requirements. The installed bundle passes strict deep signature
verification. Uninstall also passed and removed only this test installation.

**Downloaded-app launch was blocked by Gatekeeper.** The seven passing packaged
scenarios above used the locally built copy. When repeated against the quarantined
Homebrew copy, four scenarios failed before Electron could launch; the remaining
three were stopped. macOS displayed the unverified-app warning. No app security
exception or quarantine bypass was applied. Launch after the user selects
Open Anyway remains unverified, and the README and cask explain that first-launch
step. Hidden Electron windows cannot suppress a macOS security dialog.

Both public repositories have GitHub Actions disabled. No new Actions run was
created by publication: the source repo retained its one historical completed
run, and the tap had zero runs. Public README and illustration URLs returned HTTP
200 without authentication.
