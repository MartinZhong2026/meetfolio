// Starts the e2e harness (real app + local mock DashScope services) and stays in the foreground.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const child = spawn('npx', ['tsx', 'test/e2e-server.ts'], { cwd: path.join(root, 'server'), stdio: 'inherit', env: { ...process.env } });
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
