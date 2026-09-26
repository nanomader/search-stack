// Signed packaging only. Notarization and publication are separate release steps.
const { build } = require('../package.json');

module.exports = {
  ...build,
  forceCodeSigning: true,
  mac: {
    ...build.mac,
    identity: 'Jacek Musial (85B5U6888H)',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: false,
  },
  dmg: { sign: true },
};
