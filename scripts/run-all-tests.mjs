#!/usr/bin/env node
// Runs every test suite defined in package.json ("test" + every "test:*" script),
// records pass/fail counts and duration, then prints a JSON block at the end
// tagged with `=== RESULTS_JSON ===` so it can be reliably parsed downstream.
//
// Usage:
//   node scripts/run-all-tests.mjs [--only=unit,crud] [--quiet]
//
//   --only=a,b     run only the named suites (keys below); default runs all
//   --quiet        suppress live test output (still captures it for parsing)

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

// ─── Suite definitions ────────────────────────────────────────────────────────
// Key   → a short identifier shown in the table
// label → human-readable name
// cmd   → command + args (vitest `run` mode so it exits instead of watching)
//
// NOTE: package.json's "test" script is `vitest` (watch mode). We override here
// with `vitest run` so this script terminates after the unit tests finish.
const SUITES = [
  {
    key: 'unit',
    label: 'Unit tests',
    cmd: 'npx',
    args: ['vitest', 'run'],
  },
  {
    key: 'crud',
    label: 'CRUD (e2e)',
    cmd: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.e2e.config.ts', '--mode', 'crud'],
  },
  {
    key: 'performance',
    label: 'Performance',
    cmd: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.e2e.config.ts', '--mode', 'performance'],
  },
  {
    key: 'stress',
    label: 'Stress',
    cmd: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.e2e.config.ts', '--mode', 'stress'],
  },
];

// ─── Arg parsing ──────────────────────────────────────────────────────────────
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const onlyArg = args.get('only');
const only = typeof onlyArg === 'string' ? new Set(onlyArg.split(',')) : null;
const quiet = args.get('quiet') === true;
const suitesToRun = only ? SUITES.filter((s) => only.has(s.key)) : SUITES;

// ─── Runner ───────────────────────────────────────────────────────────────────
/**
 * Spawn a suite, tee its output to this process's stdout/stderr (unless --quiet),
 * and return captured text + exit code + wall-clock duration.
 */
function runSuite(suite) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(suite.cmd, suite.args, {
      cwd: process.cwd(),
      shell: process.platform === 'win32', // allow `npx` resolution on Windows
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, // strip ANSI colour codes so parsers match cleanly
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      stdout += s;
      if (!quiet) process.stdout.write(s);
    });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderr += s;
      if (!quiet) process.stderr.write(s);
    });

    child.on('close', (code) => {
      const durationMs = Math.round(performance.now() - startedAt);
      resolve({ exitCode: code ?? -1, durationMs, stdout, stderr });
    });
    child.on('error', (err) => {
      const durationMs = Math.round(performance.now() - startedAt);
      resolve({ exitCode: -1, durationMs, stdout, stderr: stderr + '\n' + String(err) });
    });
  });
}

// ─── Vitest output parsing ────────────────────────────────────────────────────
/**
 * Parse vitest's summary lines. The format we care about is:
 *   Test Files  10 passed | 1 failed | 2 skipped (13)
 *   Tests       123 passed | 4 failed | 5 skipped | 1 todo (133)
 * Any of the modifiers may be absent. The final (N) is the total.
 */
function stripAnsi(s) {
  // Remove CSI escape sequences (colour / cursor codes). `FORCE_COLOR=0` is not
  // always honoured by vitest's reporters, so we strip defensively.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function parseVitestSummary(rawText) {
  const empty = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0, matched: false };
  if (!rawText) return { tests: { ...empty }, files: { ...empty } };
  const text = stripAnsi(rawText);

  const grab = (label) => {
    // Match the summary line for `Tests` or `Test Files`.
    // Vitest pads/aligns these so we allow arbitrary whitespace.
    const re = new RegExp(`^\\s*${label}\\s+(.+?)\\s*$`, 'm');
    const m = text.match(re);
    if (!m) return { ...empty };
    const line = m[1];
    const out = { ...empty, matched: true };
    // Strip the trailing `(N)` total before splitting — otherwise the final
    // segment is e.g. "38 passed (39)" and the per-part regex won't match.
    const lineNoTotal = line.replace(/\s*\(\d+\)\s*$/, '');
    const parts = lineNoTotal.split('|').map((p) => p.trim());
    for (const p of parts) {
      const pm = p.match(/^(\d+)\s+(passed|failed|skipped|todo)$/);
      if (pm) out[pm[2]] = Number(pm[1]);
    }
    const totalMatch = line.match(/\((\d+)\)\s*$/);
    if (totalMatch) out.total = Number(totalMatch[1]);
    else out.total = out.passed + out.failed + out.skipped + out.todo;
    return out;
  };

  return {
    tests: grab('Tests'),
    files: grab('Test Files'),
  };
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(1);
  return `${m}m ${r}s`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.error(`\n[run-all-tests] running ${suitesToRun.length} suite(s): ${suitesToRun.map((s) => s.key).join(', ')}\n`);

const overallStart = performance.now();
const results = [];

for (const suite of suitesToRun) {
  if (!quiet) console.error(`\n──── ${suite.label} (${suite.key}) ────\n`);
  const { exitCode, durationMs, stdout, stderr } = await runSuite(suite);
  const parsed = parseVitestSummary(stdout + '\n' + stderr);
  results.push({
    key: suite.key,
    label: suite.label,
    exitCode,
    durationMs,
    tests: parsed.tests,
    files: parsed.files,
    parsed: parsed.tests.matched || parsed.files.matched,
  });
}

const overallMs = Math.round(performance.now() - overallStart);

// ─── Summary (for the human running it locally) ───────────────────────────────
console.error('\n──── Summary ────\n');
for (const r of results) {
  const t = r.tests;
  const statusEmoji = r.exitCode === 0 ? 'PASS' : 'FAIL';
  const counts = r.parsed
    ? `${t.passed}/${t.total} passed` + (t.failed ? `, ${t.failed} failed` : '') + (t.skipped ? `, ${t.skipped} skipped` : '')
    : '(could not parse vitest summary)';
  console.error(`  [${statusEmoji}] ${r.label.padEnd(14)}  ${counts.padEnd(40)}  ${fmtMs(r.durationMs)}`);
}
console.error(`\n  total wall time: ${fmtMs(overallMs)}\n`);

// ─── Machine-readable block (for Claude to re-parse) ──────────────────────────
// A marker on its own line + a single-line JSON payload + closing marker.
// Claude greps the file for these markers to extract the structured data.
const payload = {
  schema: 'mxdb-sync.test-run.v1',
  ranAt: new Date().toISOString(),
  totalWallMs: overallMs,
  suites: results.map((r) => ({
    key: r.key,
    label: r.label,
    exitCode: r.exitCode,
    durationMs: r.durationMs,
    parsed: r.parsed,
    tests: r.tests,
    files: r.files,
  })),
};

console.log('=== RESULTS_JSON_BEGIN ===');
console.log(JSON.stringify(payload));
console.log('=== RESULTS_JSON_END ===');

// Exit non-zero if any suite failed.
const anyFailed = results.some((r) => r.exitCode !== 0);
process.exit(anyFailed ? 1 : 0);
