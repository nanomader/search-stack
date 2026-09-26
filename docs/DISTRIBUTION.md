# Releasing Search Stack

Build and test on the maintainer's Mac, publish installers on GitHub Releases,
and update [the Homebrew tap](https://github.com/nanomader/homebrew-tap).
GitHub Actions stays disabled in both repositories. No hosted build service is
needed. Apple signing uses the existing developer membership.

The current download targets Apple silicon and macOS 13+. Intel, Windows, and
Linux installers need qualification on their target platforms before publication.

The shared logo source is `src/icon.png`, a 1024px transparent PNG. It is used by
the app header, README, and electron-builder, which generates the platform icon
formats during packaging. The selected hamster artwork was generated with the
built-in image generation tool, then resized for packaging.

## Signed macOS release

The public publisher is `Jacek Musial`, Apple team `85B5U6888H`. Search Stack
retains its own bundle ID, `dev.searchstack.app`. Its certificate can be shared
with other apps from this publisher; credentials stay in the local Keychain.
The notarization profile name is supplied locally, never a password in Git.

1. Bump the version in package.json and package-lock.json. Run `npm run verify`.
2. Build into a fresh output directory, preserving any running app:

   ```sh
   npm run package:mac:signed -- --arm64 --config.directories.output=dist/release-VERSION
   ```

   This signs the app and DMG with Developer ID and hardened runtime, and fails
   if the signing identity is unavailable. It does **not** notarize or publish.
   The only runtime entitlement is `com.apple.security.cs.allow-jit`, needed by
   modern Electron. The preview command `npm run package:mac` remains ad-hoc signed.

3. Verify the app with `codesign --verify --deep --strict`, inspect its publisher,
   hardened-runtime flag and entitlements, and run the hidden-window packaged
   tests described in [DEVELOPMENT.md](DEVELOPMENT.md).
4. Submit the signed DMG with `xcrun notarytool submit`, using
   `--keychain-profile PROFILE --output-format json`. Save the submission ID
   outside Git. Wait on that ID with `notarytool wait`; do not submit again just
   because a wait timed out. Continue only after the status is **Accepted**.
5. Use `xcrun stapler staple` on the DMG and the local app. Validate both tickets.
   Recreate the ZIP from the stapled app using `ditto -c -k --sequesterRsrc
--keepParent`. The DMG's ticket covers its embedded signed app; the ZIP carries
   the app's own ticket. Verify both extracted app copies with strict codesign
   verification and `spctl --assess --type execute --verbose=2`. Assess the DMG
   with `spctl --assess --type open --context context:primary-signature`.
6. Generate SHA-256 checksums **after** stapling and repacking. Record the exact
   source commit, notarization acceptance, and validation results.
7. Commit and tag the qualified source, create a draft GitHub release, and upload
   the DMG, ZIP, and checksums. Verify uploaded digests before publishing.
8. Update the cask version/checksum. Test the public download and Homebrew install
   into a temporary app directory. Assess Gatekeeper before any launch: a hidden
   Electron window cannot hide an OS security warning. Keep the user's normal app
   and session data untouched. Update documentation with observed results.

Notarization is Apple's automated security check, not App Store distribution.
A normal first-open confirmation for an internet download can still appear.
Do not disable Gatekeeper or remove quarantine as part of release qualification.

## Homebrew and updates

```sh
brew install --cask nanomader/tap/search-stack
brew upgrade --cask nanomader/tap/search-stack
```

The cask references a versioned release URL and its exact DMG checksum. Keep
profile deletion out of ordinary uninstall. The app has no automatic updater;
users update through Homebrew or download a later release.

Use a versioned release link in the README while releases are marked as previews.
The previous 0.1.0 release is ad-hoc signed and unnotarized; do not replace its
assets with different bytes. Publish a new version instead.

## Other platforms

Build Windows on an existing Windows PC and Linux on existing hardware or a local
VM. The Linux .deb target needs a public maintainer email; do not invent one.
Direct downloads are enough initially. Additional package registries can follow
when installers and platform behavior have been validated.

## References

- [Apple Developer ID and notarization](https://developer.apple.com/developer-id/)
- [Electron notarization and entitlements](https://github.com/electron/notarize)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [Creating a Homebrew tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
