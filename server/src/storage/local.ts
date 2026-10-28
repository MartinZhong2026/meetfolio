import fs from 'node:fs/promises';
import path from 'node:path';
import type { Storage } from './index.js';

/**
 * Development adapter. NOT suitable for Railway production: the container filesystem is
 * ephemeral. Use STORAGE_DRIVER=s3 with a Railway Bucket / Aliyun OSS / any S3-compatible store.
 */
export class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  private root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}
