import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vitestEntrypoint = path.resolve(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');

const child = spawn(process.execPath, [vitestEntrypoint, ...process.argv.slice(2)], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

if (process.platform !== 'win32') {
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
} else {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let suppressingEpermBlock = false;

  const flushLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (suppressingEpermBlock) {
      if (line.trim() === '}') {
        suppressingEpermBlock = false;
      }
      return;
    }
    if (
      line.includes('[vitest-pool]: Failed to terminate forks worker') &&
      line.includes('kill EPERM')
    ) {
      suppressingEpermBlock = true;
      return;
    }
    if (line.startsWith('[vitest-pool]: Timeout terminating forks worker')) {
      return;
    }
    process.stderr.write(`${rawLine}\n`);
  };

  child.stderr.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(flushLine);
  });

  child.stderr.on('end', () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      flushLine(buffer);
      buffer = '';
    }
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
