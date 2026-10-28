import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import unbzip2 from 'unbzip2-stream';
/** Extract only regular files; reject links, absolute/Windows paths, traversal and bombs. */
export async function extractXAsrArchive(archive, destination, signal) {
    const extract = tar.extract();
    let total = 0;
    let entries = 0;
    const seen = new Set();
    extract.on('entry', (header, stream, next) => {
        void (async () => {
            const name = header.name;
            const parts = name.replace(/\/$/, '').split('/');
            if (++entries > 128 || name.includes('\\') || name.includes(':') || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /[<>"|?*\x00-\x1f]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || name.startsWith('/')) {
                throw new Error('Unsafe archive path');
            }
            if (header.type !== 'file' && header.type !== 'directory')
                throw new Error('Archive links and special entries are forbidden');
            if (seen.has(name))
                throw new Error('Duplicate archive entry');
            seen.add(name);
            total += header.size ?? 0;
            if (total > 800 * 1024 * 1024 || (header.size ?? 0) > 650 * 1024 * 1024)
                throw new Error('Archive exceeds extraction limit');
            const target = path.join(destination, ...parts);
            if (header.type === 'directory') {
                await mkdir(target, { recursive: true, mode: 0o700 });
                stream.resume();
            }
            else {
                await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
                await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
            }
            next();
        })().catch(error => extract.destroy(error));
    });
    // unbzip2-stream is a Transform; pipeline propagates cancellation and decompression errors.
    await pipeline(createReadStream(archive), unbzip2(), extract, { signal });
}
