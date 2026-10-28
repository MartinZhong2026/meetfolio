/** Developer/CI tool. End users use the future desktop IPC controls, never npm commands. */
import { XAsrModelManager } from '../asr/xasrManager.js';
const [command, archive] = process.argv.slice(2);
const manager = new XAsrModelManager({ root: process.env.X_ASR_DATA_ROOT });
let previousState = '';
let previousPercent = -1;
manager.on('status', status => {
  const percent = Math.floor(status.downloadedBytes / status.totalBytes * 100);
  if (status.state !== previousState || percent !== previousPercent) {
    console.log(JSON.stringify(status));
    previousState = status.state; previousPercent = percent;
  }
});
process.on('SIGINT', () => manager.cancel());
process.on('SIGTERM', () => manager.cancel());
try {
  if (command === 'repair') await manager.repair();
  else if (command === 'download') await manager.download();
  else if (command === 'import' && archive) await manager.importArchive(archive, { repair: process.argv.includes('--repair') });
  else if (command === 'initialize') await manager.initialize();
  else if (command !== 'status') throw new Error('Usage: xasr.js status|download|repair|initialize|import <archive> [--repair]');
  console.log(JSON.stringify(manager.getStatus()));
} catch (error) { console.error(String(error)); process.exitCode = 1; }
finally { await manager.dispose(); }
