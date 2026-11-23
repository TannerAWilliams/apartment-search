import { expect, test } from 'bun:test';

/**
 * The codebase is TypeScript throughout and fully typed: no JavaScript or shell sources, no `any`, and no
 * comments that switch the type checker off. Values from the network or storage are `unknown` until checked
 * (see types/strict-json.d.ts).
 */
const root = new URL('../', import.meta.url).pathname;
const tracked = (await Bun.$`git ls-files`.cwd(root).quiet().text()).split('\n').filter(Boolean);
/** An explicit `any`: annotations, casts, type arguments and unions. This file holds the patterns, so it is not scanned. */
const ANY = /(?::|\bas|<|\||&|,)\s*any\b(?!-)|\bany\[\]|<any>|Array<any>/;
const SUPPRESSED = /@ts-(?:ignore|nocheck|expect-error)/;
const sources = tracked.filter((path) => /\.tsx?$/.test(path) && path !== 'test/typed-codebase.test.ts');

test('there are no JavaScript or shell source files', () => {
  expect(tracked.filter((path) => /\.(?:[cm]?jsx?|sh|bash|py)$/.test(path))).toEqual([]);
});

test('no source uses `any` or turns the type checker off', async () => {
  const offenders: string[] = [];
  for (const path of sources) {
    const lines = (await Bun.file(root + path).text()).split('\n');
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
      if (ANY.test(code) || SUPPRESSED.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});

/** A Node built-in module, imported or required, with or without the `node:` prefix. */
const NODE_MODULE = /\bfrom ['"](?:node:\w+|assert|buffer|child_process|crypto|fs|os|path|readline|stream|url|util)(?:\/[\w/]+)?['"]|\brequire\(['"]node:/;
/** Node globals that have web-standard or Bun equivalents: Buffer, __dirname and __filename. */
const NODE_GLOBAL = /\b(?:Buffer\.|new Buffer\b|__dirname\b|__filename\b)/;

test('the code uses Bun and web-standard APIs, not Node modules', async () => {
  const offenders: string[] = [];
  for (const path of sources) {
    const lines = (await Bun.file(root + path).text()).split('\n');
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '');
      if (NODE_MODULE.test(code) || NODE_GLOBAL.test(code)) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});

test('every TypeScript project is strict and checks JSON as unknown', async () => {
  for (const project of ['tsconfig.json', 'web/tsconfig.json']) {
    const text = await Bun.file(root + project).text();
    expect(text, project).toMatch(/"strict":\s*true/);
    expect(text, project).not.toMatch(/"allowJs":\s*true/);
    expect(text, project).toContain('strict-json.d.ts');
  }
});

test('the guard catches what it is meant to', () => {
  for (const line of ['let x: any;', 'f(y as any)', 'const z: Map<string, any> = new Map();', 'rows: any[]', 'type A = string | any;']) expect(ANY.test(line), line).toBe(true);
  for (const line of ['const company = "any company";', 'if (anyMatch) return;', 'many: string[]', 'const any_ = 1;']) expect(ANY.test(line), line).toBe(false);
  expect(SUPPRESSED.test('// @ts-ignore')).toBe(true);
  for (const line of ["import { readFile } from 'node:fs/promises';", "import assert from 'assert';", "const b = Buffer.from(x);", "const p = require('node:path');"]) expect(NODE_MODULE.test(line) || NODE_GLOBAL.test(line), line).toBe(true);
  for (const line of ["import { Hono } from 'hono';", "const buffered = 1;", "import { $ } from 'bun';"]) expect(NODE_MODULE.test(line) || NODE_GLOBAL.test(line), line).toBe(false);
  expect(sources.length).toBeGreaterThan(150);
});
