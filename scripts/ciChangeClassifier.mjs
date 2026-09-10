#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SAFE_ONLY = [
  /^README(?:\.(?:md|txt|rst))?$/i,
  /\.md$/i,
  /^docs\//,
  /^src\/components\//,
  /^src\/hooks\//,
  /^src\/study\//,
  /^tests\/study\//,
  /^public\//,
  /^study-content\//,
  /^src\/.*\.(?:css|scss|svg)$/i,
  /^scripts\/study[^/]*\.(?:mjs|ts)$/i,
];

const ALWAYS_NUMERICAL = [
  /^\.github\/workflows\//,
  /^scripts\/ciChangeClassifier\.(?:mjs|ts)$/,
  /^scripts\/testTiers\.ts$/,
  /^scripts\/testProfile\.mjs$/,
  /^scripts\/runVitest\.mjs$/,
  /^vitest(?:[^/]*\.config\.ts|\.shared\.ts)$/,
  /^package(?:-lock)?\.json$/,
  /^cpp\//,
  /^tests\/evidence\//,
  /^src\/engine\//,
  /^src\/workers\//,
  /^src\/cli\.ts$/,
  /^scripts\/(?:phase.*(?:WorkerBridge|Proof)|wasm|cppBuild|benchmarks\/)/i,
  /^tests\/(?:phase\d+|.*(?:sparse|worker|wasm|covariance|parity|evidence|release|preanalysis))/i,
];

const normalize = (file) => file.replaceAll('\\', '/').replace(/^\.\//, '');

export function classifyChangedFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => typeof file !== 'string')) {
    return {
      numericalRequired: true,
      reason: 'changed files could not be determined',
      changedFileCount: 0,
    };
  }

  const changedFiles = files.map(normalize).filter(Boolean);
  if (changedFiles.length === 0) {
    return {
      numericalRequired: true,
      reason: 'changed files could not be determined',
      changedFileCount: 0,
    };
  }

  for (const file of changedFiles) {
    if (ALWAYS_NUMERICAL.some((pattern) => pattern.test(file))) {
      return {
        numericalRequired: true,
        reason: `${file} requires numerical certification`,
        changedFileCount: changedFiles.length,
      };
    }
    if (!SAFE_ONLY.some((pattern) => pattern.test(file))) {
      return {
        numericalRequired: true,
        reason: `${file} is not recognized as safe-only`,
        changedFileCount: changedFiles.length,
      };
    }
  }

  return {
    numericalRequired: false,
    reason: 'all changed files matched safe-only paths',
    changedFileCount: changedFiles.length,
  };
}

function changedFilesFromGitHubEnvironment() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== 'pull_request') return [];
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return [];
  try {
    const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
    const base = payload.pull_request?.base?.sha;
    const head = payload.pull_request?.head?.sha || process.env.GITHUB_SHA;
    if (!base || !head) return [];
    const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
    return execFileSync('git', ['diff', '--name-only', `${mergeBase}...${head}`], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const event = process.env.GITHUB_EVENT_NAME;
  const result = event === 'push' && process.env.GITHUB_REF === 'refs/heads/main'
    ? { numericalRequired: true, reason: 'push to main always runs numerical certification', changedFileCount: 0 }
    : event === 'workflow_dispatch'
      ? { numericalRequired: true, reason: 'manual workflow runs fail closed to numerical certification', changedFileCount: 0 }
      : classifyChangedFiles(changedFilesFromGitHubEnvironment());
  for (const [key, value] of Object.entries(result)) {
    const output = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    console.log(`${output}=${value}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${output}=${value}\n`);
    }
  }
  console.log(`CI classification: numerical_required=${result.numericalRequired} reason=${result.reason} changed_file_count=${result.changedFileCount}`);
}
