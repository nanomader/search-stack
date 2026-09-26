# Releasing Search Stack

Search Stack uses local builds, GitHub Releases, and a maintainer-owned Homebrew
tap. The first preview targets Apple silicon Macs running macOS 13 or newer.
It uses free ad-hoc signing; it is not Developer ID signed or Apple-notarized.

## 1. Keep the public repository useful

Keep the README centered on the app: what it does, a real comparison screenshot,
how to try it, and where to report problems. Keep build internals in the development
guide. Include the MIT license and contribution guide.

Before publishing a new repository, review its tracked history and Actions logs: both become public with the source. Search Stack uses the public `nanomader/search-stack` repository.

`"private": true` in package.json prevents accidental npm publication. It does not
control GitHub visibility or prevent this desktop app from being open source.

## 2. Use GitHub Releases for downloads

Build and test locally, then attach installers to a versioned GitHub Release.
Do not use GitHub Actions or rented build machines for this project. The existing
hosted build workflow has been disabled on GitHub and removed from the checkout.
Actions must also remain disabled in the Homebrew tap.

Build on an existing Apple silicon Mac. Packaging uses `--publish never`;
uploading and publishing are separate, deliberate steps. GitHub Releases hosts
the finished downloads without needing to run a build.

```sh
npm ci
npm run verify
npm run package:mac -- --arm64 --config.directories.output=dist/public-preview
shasum -a 256 dist/public-preview/*.dmg dist/public-preview/*.zip
```

Run this only while the app in that output directory is closed. Keep binaries in
Release assets, not Git, Git LFS, or Actions artifacts. A maintainer can upload
them using the GitHub release page or `gh release upload` from their own machine.

Supported release scope:

| Platform          | Download                | Qualification                                              |
| ----------------- | ----------------------- | ---------------------------------------------------------- |
| Apple silicon Mac | ARM64 DMG, optional ZIP | First priority; ad-hoc-signed, unnotarized preview         |
| Intel Mac         | x64 DMG                 | Add when an existing Intel Mac is available for validation |
| Windows           | x64 NSIS installer      | Build and test on an existing Windows PC; otherwise defer  |
| Linux             | x64 AppImage            | Build and test on existing Linux hardware or a local VM    |

The existing .deb target additionally needs a public maintainer email. Do not
invent one. Packaging success should be followed by launching the packaged app
with disposable data and testing installation on a clean user account or VM.

For each release:

1. Set the version in package.json and its lockfile.
2. Run `npm run verify`, commit the prepared version, and record the exact SHA.
3. Create a matching tag, for example `v0.1.0`.
4. Build locally from that tag on each platform that can be tested without paid infrastructure.
5. Create a **draft prerelease**, attach only qualified installers, and include
   SHA-256 checksums and the source commit in its notes.
6. Test the downloaded files. Explain unsigned status and platform limits.
7. Publish the prerelease and replace the README's source-only status with actual
   download links. Use the versioned release URL: GitHub's `releases/latest` link
   does not represent a preview-only release reliably.

The current app has no automatic updater. Initial users download a new version
from Releases, or run `brew upgrade --cask nanomader/tap/search-stack`.

## 3. Maintain the Homebrew cask

A macOS GUI app uses a **cask**, a small Ruby file describing a prebuilt download.
The cask lives in [nanomader/homebrew-tap](https://github.com/nanomader/homebrew-tap), independently of the main Homebrew catalog.

The Homebrew install command is:

```sh
brew install --cask nanomader/tap/search-stack
```

The tap's `Casks/search-stack.rb` should specify the version, immutable GitHub
Release URL, SHA-256 checksum, homepage, supported architecture, and
`app "Search Stack.app"`. Point to the exact tested artifact; never use a placeholder
checksum or advertise an Intel build that does not exist.

Test installation, launch, upgrade, and uninstall. Keep profile deletion out of
ordinary uninstall; any optional purge must be explicit. Update the cask after
each release. Homebrew is a download/install channel, not an Apple signing service:
an unsigned app can still trigger Gatekeeper. Do not bypass quarantine in the cask.

## 4. Expand only when the first path works

For Windows, direct download is enough initially; WinGet can be added with a
manifest referring to a stable installer URL and checksum. For Linux, start with
AppImage. A .deb, Flathub, or distro repository adds separate maintenance work.

For a smoother macOS installation later, use Developer ID signing and Apple
notarization. That requires Apple Developer Program membership and signing
credentials, even when signing locally. It is outside this zero-spend preview.

## 5. Invite people with a clear request

Suggested repository description:

> Compare live search engines side by side. A free desktop app with independent
> sessions, keyboard shortcuts, and Day/Night themes.

Suggested topics: `search`, `search-engine`, `desktop-app`, `electron`, `macos`,
`open-source`. Add platform topics only as the corresponding release is qualified.

After a working public download exists, share a short comparison clip and a
specific request for feedback in relevant search, desktop-app, and open-source
communities, following each community's posting rules. A useful first audience is
people who already repeat queries in several engines.

Suggested announcement:

> I built Search Stack because I kept repeating the same search in different tabs.
> It sends one query to multiple engines and lets you compare two live pages side
> by side, with independent sessions. It's free and MIT-licensed. The first macOS
> preview is not notarized. I'd love feedback on installation and whether the comparison
> workflow helps with a real search you do.

Link to the repository and an actual release. Invite bug reports and contributions;
do not promise better answers or make claims about a provider's motives.

## References

- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Changing repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)
- [Creating a Homebrew tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
- [Adding software to Homebrew](https://docs.brew.sh/Adding-Software-to-Homebrew)
- [Opening downloaded apps on macOS](https://support.apple.com/en-us/102445)
- [Apple Developer Program](https://developer.apple.com/programs/)
- [WinGet package submission](https://learn.microsoft.com/en-us/windows/package-manager/package/)
