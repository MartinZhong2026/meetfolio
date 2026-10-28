import { stat } from 'node:fs/promises';

for (const path of ['web/dist/index.html', 'web/dist-desktop/index.html', 'server/dist/index.js', 'desktop/dist/main.cjs', 'desktop/dist/preload.cjs']) {
  const file = await stat(path);
  if (!file.isFile() || file.size === 0) throw new Error(`Missing or empty build artifact: ${path}`);
  console.log(`Verified build artifact: ${path}`);
}
