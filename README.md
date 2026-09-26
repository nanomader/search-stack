# Search Stack

Search Stack is a cross-platform desktop app for sending one query to several
search engines and reading their live websites in a single vertical stack.
Each result area is the engine's own page in its own browser session. Search
Stack does not fetch results through a search API, parse result HTML, or proxy
search traffic. A clicked result stays in its engine panel, with Back, Forward,
and Reload controls beside the engine name.

Use the vertical stack to browse pages in sequence, or switch to Focus scan to
compare one full-size live page at a time. Its page switcher stays visible while
you read, and switching engines keeps each page loaded at its own scroll position.

The first provider set is Google, Bing, Yahoo, and Baidu. You can switch each
engine on or off before searching; changing the selection reruns the current
query for the selected engines. Settings let you create named browser profiles
and choose the profiles to search for each engine. Every engine and profile
pair has its own persistent cookies and sign-in state, so Google can appear
once signed in and once signed out in the same stack.
To keep resource use bounded, up to 12 profiles can be saved and a search can
show up to 12 engine and profile combinations at once.

## Run locally

Install Node.js 24 or newer and npm, then run:

```sh
npm install
npm start
```

This app uses Electron and is intended to run on macOS, Windows, and Linux.
The app is currently being developed on macOS; the Windows and Linux builds
are configured below but still need hands-on verification on those systems.

## Build installers

Run the matching command on each target operating system:

```sh
npm run package:mac    # macOS .dmg and .zip
npm run package:win    # Windows NSIS installer
npm run package:linux  # Linux AppImage and .deb
```

The GitHub Actions workflow builds each platform on its native runner and
stores the installers as workflow artifacts.

## How the stacked pages work

Electron's `BaseWindow` composes one local app view with separate
`WebContentsView` instances for the selected search sites. The app scrolls the
native page views with their matching result sections. A small isolated
preload listens for wheel input only at the top or bottom of a provider page
and relays it to the app, so normal scrolling first moves through that site's
results and then continues to the next engine.

Queries go directly from the device to the selected search sites. Each engine
and named profile pair has its own persistent browser session for cookies,
sign-in state, and consent preferences. Creating a profile does not sign in
automatically; use the engine's real website in that profile. Removing a
profile requires confirmation and clears its saved website data.
Web pages may show consent, regional, sign-in, or anti-abuse screens, and
availability or behavior can vary by country and provider policy. Search Stack
does not bypass those screens or access controls.

Provider pages run with Node integration disabled, context isolation, sandboxing,
and HTTPS-only navigation. Pop-up windows and non-HTTPS links are blocked. Links
that normally open a new tab load in their current engine panel instead. A
download requires the operating system's save dialog.

## Project status

This is an early prototype. Provider pages can change without notice, and
providers may limit use in embedded browser surfaces. The current goal is to
validate whether their unmodified websites can be displayed and scrolled
reliably across desktop operating systems.

## License

MIT. Search Stack is an independent project and is not affiliated with the
search providers.
