/** Ad-hoc integrity only: PR packaging skips electron-builder's credentialed signing. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async context => {
  assert.equal(process.platform, 'darwin');
  const config = context.packager.platformSpecificBuildOptions;
  assert.equal(config.identity, '-');
  assert.equal(config.hardenedRuntime, false);
  assert.equal(config.notarize, false);
  assert.equal(context.packager.appInfo.id, 'org.meetfolio.desktop.preview');
  assert.match(context.packager.appInfo.version, /-preview\./);
  assert.equal(context.packager.config.electronFuses, undefined, 'Fuse changes must precede final code sealing');
  const app = path.resolve(context.appOutDir, 'MeetfolioPreview.app');
  assert(app.startsWith(path.resolve('work/phase5/packages') + path.sep));
  // Use the already locked Electron signing dependency. No keychain/certificate discovery,
  // credentials, provisioning profiles, timestamp service or PR signing override is enabled.
  const { signAsync } = require('@electron/osx-sign');
  await signAsync({
    app, platform: 'darwin', type: 'distribution', identity: '-', identityValidation: false,
    preAutoEntitlements: false, preEmbedProvisioningProfile: false, strictVerify: true,
    optionsForFile: () => ({ entitlements: path.resolve('desktop/entitlements.mac.plist'), hardenedRuntime: false, timestamp: 'none' }),
    ignore: [file => {
      if (file.endsWith('.app') || file.endsWith('.framework')) return false;
      const handle = fs.openSync(file, 'r');
      try {
        const header = Buffer.alloc(4); if (fs.readSync(handle, header, 0, 4, 0) !== 4) return true;
        return !['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'));
      } finally { fs.closeSync(handle); }
    }],
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('Preview ad-hoc nested-code sealing verified; no Developer ID or notarization.');
};
