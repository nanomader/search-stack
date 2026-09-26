# Contributing to Search Stack

Thanks for trying Search Stack. The goal is simple: make comparing search engines
fast and comfortable while giving most of the window to the websites.

## Start with your experience

[Open an issue](https://github.com/nanomader/search-stack/issues/new/choose) with
what you tried, what you expected, and what happened. Include the app version,
operating system, engine, and profile setup. A short recording or screenshot is
useful; remove private searches, account details, and other personal information.

A provider showing a CAPTCHA is not automatically an app bug. Tell us whether the
app controls still worked and whether the same URL worked in your normal browser.

## Make a change

1. Fork the repository and create a branch.
2. Follow the [development setup](docs/DEVELOPMENT.md).
3. Keep the change focused. Discuss larger UI or architecture changes in an issue first.
4. Run `npm run format:check`, `npm test`, and `npm run test:e2e`.
5. Open a pull request explaining the problem, the change, and how you checked it.

For UI changes, include before/after screenshots. For behavior changes, add a
meaningful regression test. Formatting-only changes do not need new tests.
Be specific about which platforms you tested; do not claim cross-platform support
from a single local run.

Preserve separate browser sessions, the sandbox around remote pages, and responsive
app controls. Do not add CAPTCHA bypasses or import personal browser data.

Small fixes and clear reports are welcome. Please be respectful and explain the
reason behind suggestions so others can help evaluate them.
