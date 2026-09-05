import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.WEBNET_WASM_MODULE ?? './cpp/build-wasm/webnet_core.js';
if (!existsSync(modulePath)) {
  console.error(`WASM module not found at ${modulePath}. Run npm run wasm:build first.`);
  process.exit(1);
}
const imported = await import(pathToFileURL(resolve(modulePath)).href);
const factory = imported.default ?? imported;
const module = await factory();
const add = module.add ?? module._webnet_add;
if (typeof add !== 'function') throw new Error('WASM smoke export add() was not found');
const result = add(2, 3);
if (result !== 5) throw new Error(`WASM smoke failed: expected 5, got ${result}`);
console.log('WASM smoke passed: add(2, 3) = 5');
