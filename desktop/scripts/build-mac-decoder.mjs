import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export async function buildMacDecoder(root, target) {
  if (process.platform !== 'darwin') return;
  if (!['arm64','x64'].includes(process.arch)) throw new Error('Unsupported macOS architecture');
  const directory = path.join(target, 'decoder'); await fs.mkdir(directory, {recursive:true});
  const executable = path.join(directory, 'meetfolio-audio-decoder');
  execFileSync('xcrun', ['swiftc','-O','-target',`${process.arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos15.0`,path.join(root,'desktop/native/AudioDecoder.swift'),'-framework','AVFoundation','-o',executable], {stdio:'inherit'});
  execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier','org.meetfolio.desktop.preview.audio-decoder',executable],{stdio:'inherit'});
  console.log(execFileSync(executable,['--version'],{encoding:'utf8'}).trim());
}
