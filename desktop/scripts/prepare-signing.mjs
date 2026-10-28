/** Prepare public signing metadata only. Does not obtain a certificate, authenticate or sign. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [provider, output = 'work/windows-signing.json'] = process.argv.slice(2);
function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /[\x00-\x1f]/.test(value)) throw new Error(`Set ${name} to approved certificate/profile metadata`);
  return value;
}
const publisherName = required('MEETFOLIO_SIGNING_PUBLISHER');
const config = { extends: fileURLToPath(new URL('../electron-builder.yml', import.meta.url)), forceCodeSigning: true, extraMetadata: { author: { name: publisherName } }, win: { signExecutable: true } };
if (provider === 'store') {
  const certificateSha1 = required('MEETFOLIO_CERTIFICATE_SHA1').replaceAll(' ', '');
  if (!/^[a-f0-9]{40}$/i.test(certificateSha1)) throw new Error('Certificate-store thumbprint must contain 40 hexadecimal characters');
  config.win.signtoolOptions = { certificateSha1, publisherName, signingHashAlgorithms: ['sha256'], rfc3161TimeStampServer: 'http://timestamp.digicert.com' };
} else if (provider === 'azure') {
  const endpoint = required('MEETFOLIO_ARTIFACT_ENDPOINT');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.codesigning.azure.net') || url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use the official HTTPS Artifact Signing regional endpoint');
  }
  config.win.azureSignOptions = { publisherName, endpoint, codeSigningAccountName: required('MEETFOLIO_ARTIFACT_ACCOUNT'),
    certificateProfileName: required('MEETFOLIO_ARTIFACT_PROFILE'), fileDigest: 'SHA256', timestampDigest: 'SHA256', timestampRfc3161: 'http://timestamp.acs.microsoft.com' };
} else throw new Error('Provider must be store or azure');
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log('Prepared signing configuration; no certificate/private key or authentication token was written.');
