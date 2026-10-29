import { describe, expect, it } from 'vitest';
import { isAppUrl, validAudio, validSession, validExport } from '../src/policy';
describe('trusted desktop boundary', () => {
  it('limits exports to named research documents and never accepts renderer paths', () => {
    expect(validExport({ name: 'Meetfolio-test.docx', bytes: new Uint8Array(100) })).toBe(true);
    for (const name of ['../file.txt', 'C:\\secret.txt', 'file.exe', 'file.txt.exe', '/tmp/data.json']) expect(validExport({ name, bytes: new Uint8Array(100) })).toBe(false);
  });
  it('only accepts the packaged application origin', () => {
    expect(isAppUrl('meetfolio://app/index.html')).toBe(true);
    for (const url of ['https://app/', 'file:///app', 'meetfolio://other/', 'meetfolio://user@app/', 'meetfolio://app:42/', 'javascript:alert(1)']) expect(isAppUrl(url)).toBe(false);
  });
  it('limits PCM payloads and requires a native-generated session token', () => {
    const id = '01234567-89ab-cdef-0123-456789abcdef';
    expect(validSession(id)).toBe(true);
    expect(validAudio({ id, pcm: new Uint8Array(3200) })).toBe(true);
    for (const packet of [null, {}, { id, pcm: [1, 2] }, { id, pcm: new Uint8Array(3) }, { id, pcm: new Uint8Array(32002) }, { id: '../model', pcm: new Uint8Array(3200) }]) expect(validAudio(packet)).toBe(false);
  });
});
