# Search Stack

One query, several real search websites. Type and press Enter, then switch between
full-size pages without reloading them or losing their scroll positions. Focus is
the default; **Split** compares two pages side by side, and **Stack** restores the
vertically scrollable comparison view.

The app's controls occupy 130 pixels above the page in Focus and Split modes, with no sidebar
or outer page margins. Back, Forward, Reload, Stop, and the current site's hostname
remain accessible outside the website. Settings contain the less frequent choices.

Click **Split** after searching to keep the current page on the left and show a
second page on the right. Each side has an engine/profile dropdown. Use **⇄** to
swap sides; choosing the other side's page also swaps them. Both pages keep their
scroll positions and sessions. **Single** expands the active page again.

The highlighted side receives page-switching shortcuts. Click a website, its
header, or its dropdown to select that side. The pair is remembered across searches
and restarts. Disabling a selected engine replaces it with an available page;
with only one page enabled, the app returns to Single mode.

## Engines and independent sessions

Google, Bing, Yahoo, Baidu, DuckDuckGo, and Yandex are built in. Enable the engines
you want on the start screen or in Settings. Add a custom engine with a name and
an HTTPS search URL, for example `https://example.com/search?q={query}`. The query
is encoded as data; exactly one `{query}` is required in the path or parameters.
Up to 12 custom engines and 12 named profiles can be saved, with a maximum of 12
engine/profile pages in a search.

To compare two Google sessions:

1. Open **Settings** and add a profile such as **Personal**.
2. Under Google, select both **Default** and **Personal**.
3. Save and search. Each profile gets its own Google page.
4. Sign in on the Personal page and leave Default signed out.
5. Click **Split** and choose **Google · Default** and **Google · Personal**.

Each engine/profile pair has its own persistent cookies, site storage, and cache.
Existing profiles retain their identifiers and sessions when older settings are
upgraded. A name like “Signed out” is a label, not an enforced private mode. The
app does not import sign-ins from Chrome, Safari, or another browser. Removing a
profile or custom engine asks for confirmation and clears its saved website data.
Disabling an engine retains its data for later use.

## Appearance and keyboard

Settings offers **Day**, **Night**, and **System** themes. The saved preference also
sets Chromium's preferred color scheme; individual websites decide how to use it
and may retain their own theme. Theme changes preserve loaded pages. Engine
selection and Focus/Split/Stack preference are saved across restarts.

Shortcuts work with focus in either the app or an embedded search page:

| Action                      | macOS                         | Windows / Linux                |
| --------------------------- | ----------------------------- | ------------------------------ |
| Focus/select search         | Cmd L or Cmd K                | Ctrl L or Ctrl K               |
| Next / previous engine page | Ctrl Tab / Ctrl Shift Tab     | Ctrl Tab / Ctrl Shift Tab      |
| Jump to page 1–9            | Cmd 1–9                       | Ctrl 1–9                       |
| Reload active page          | Cmd R or F5                   | Ctrl R or F5                   |
| Stop loading                | Esc                           | Esc                            |
| Back / forward              | Alt Left / Right or Cmd [ / ] | Alt Left / Right or Ctrl [ / ] |
| Settings                    | Cmd ,                         | Ctrl ,                         |
| Focus / Stack               | Cmd Shift S                   | Ctrl Shift S                   |

The engine switcher also supports Left/Right arrow keys when a switch is focused.
Native editing shortcuts and the application menu remain available.

## Responsiveness and website boundaries

The local UI and remote pages use separate sandboxed `WebContentsView` instances.
Search requests start independently; switching engines reuses loaded pages. A slow
network load gets a status after 15 seconds, with Stop and Reload still available.
A lightweight ping checks the visible page's event loop: a frozen page is detected
in roughly 8–12 seconds after it becomes visible. Reload recreates crashed, frozen,
or slow views while retaining their session data (that recovery resets the page's
navigation history). Hidden/minimized pages aren't polled for responsiveness.
Inactive pages are destroyed when removed from the search.

Queries go directly to the selected websites. Search Stack does not use a search
API, scrape results, proxy traffic, or bypass consent and anti-abuse screens.
“Live website” means the document loaded, not that search results are available.
Providers can show regional, consent, sign-in, or CAPTCHA pages and may reject
embedded-browser authentication. Actual account sign-in is not covered by the
automated tests; persistent, isolated cookie storage is.

Remote pages have Node integration disabled, context isolation and sandboxing
enabled, and HTTPS-only document navigation. Pop-ups and non-HTTPS document
navigations are blocked; same-page JavaScript controls still work inside the sandbox;
ordinary HTTPS links that target a new tab open in the same engine panel.
Downloads require a user gesture and the operating system's save dialog.

## Run and test

Use Node.js 24 or newer:

```sh
npm ci
npm start
npm run format:check # check consistent source, test and documentation formatting
npm run format       # apply formatting
npm test             # settings migration, input validation and query encoding
npm run test:e2e     # complete Electron app with deterministic HTTPS fixtures
npm run test:live    # opt-in network smoke test against all six real engines
```

Both test commands that launch Electron use isolated temporary data directories,
hidden windows, and a non-activating macOS application policy. They do not touch
your normal sessions or take focus from your work. Linux needs a display server;
for headless environments use `xvfb-run --auto-servernum npm run test:e2e`.

The end-to-end suite exercises native views and IPC, full-size geometry and resize,
page/scroll preservation, split selection/swap and independent pane geometry,
saved pairs and removed choices, shortcuts from provider pages, result navigation and
Back, settings overlays, day/night themes, custom URLs, two Google profiles,
cookie isolation across restart, deletion cancellation/confirmation, failed and
stopped loads, renderer crashes, an infinite-loop website, unsafe navigation,
blocked pop-ups, and removal of inactive views. Only the external HTTPS servers
and native deletion-confirmation answers are substituted in the deterministic
suite; the app's production navigation, settings, session, and recovery code runs.
Screenshots and failure traces go under `output/playwright/` (ignored by Git).

The live smoke records provider URLs, titles, short page text, and screenshots in
`output/playwright/live/`. It never signs in or answers CAPTCHA/consent prompts.
Network results vary; review the recorded pages instead of counting every loaded
document as a successful search. Local captures can contain network identifiers
shown by providers, so review them before sharing.

## Build installers

Run on the target operating system:

```sh
npm run package:mac    # macOS DMG and ZIP
npm run package:win    # Windows NSIS installer
npm run package:linux  # Linux AppImage and deb
```

GitHub Actions checks formatting and runs unit and Electron end-to-end tests before
packaging on native macOS, Windows, and Linux runners. Check the workflow results
for the commit you use; the local verification record covers macOS. The local
macOS package is unsigned and unnotarized.

See [VALIDATION.md](VALIDATION.md) for the current verification record.

## License

MIT. Search Stack is independent and is not affiliated with the search providers.
