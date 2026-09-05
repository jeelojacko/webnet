import { spawnSync } from 'node:child_process';

const command = process.argv[2] ?? 'build';
const run = (file, args) => {
  const result = spawnSync(file, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw new Error(`${file} is required: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (command === 'configure') run('cmake', ['-S', 'cpp', '-B', 'cpp/build', '-DCMAKE_BUILD_TYPE=Release']);
else if (command === 'build') { run('cmake', ['--build', 'cpp/build', '--parallel']); }
else if (command === 'test') run('ctest', ['--test-dir', 'cpp/build', '--output-on-failure']);
else if (command === 'wasm') {
  run('emcmake', ['cmake', '-S', 'cpp', '-B', 'cpp/build-wasm', '-DCMAKE_BUILD_TYPE=Release', '-DWEBNET_ENABLE_WASM=ON']);
  run('cmake', ['--build', 'cpp/build-wasm', '--parallel']);
} else throw new Error(`Unknown C++ command: ${command}`);
