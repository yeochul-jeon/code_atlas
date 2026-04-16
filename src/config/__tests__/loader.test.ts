// src/config/__tests__/loader.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  DEFAULT_EXTENSIONS,
  DEFAULT_SKIP_DIRS,
  DEFAULT_EXCLUDED_ANNOTATIONS,
  DEFAULT_MODEL,
  DEFAULT_MEMORY_PATH,
} from '../loader.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'codeatlas-cfg-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  // Cycle A1: Full YAML parsing
  it('parses a fully-specified YAML file and returns typed config', () => {
    writeFileSync(
      join(tmpDir, '.codeatlas.yaml'),
      `
indexer:
  extensions: [".kt"]
  skip_dirs: ["vendor"]
dead_code:
  exclude_annotations:
    - "@CustomEntry"
  replace_annotations: true
  exclude_patterns:
    - "**/*Test.java"
summaries:
  model: "claude-sonnet-4-5"
`,
    );
    const config = loadConfig(tmpDir);
    expect(config.indexer.extensions).toEqual(['.kt']);
    expect(config.indexer.skipDirs).toEqual(['vendor']);
    expect(config.deadCode.excludeAnnotations).toEqual(['@CustomEntry']);
    expect(config.deadCode.replaceAnnotations).toBe(true);
    expect(config.deadCode.excludePatterns).toEqual(['**/*Test.java']);
    expect(config.summaries.model).toBe('claude-sonnet-4-5');
  });

  // Cycle A2: Missing fields → defaults
  it('fills defaults for missing fields', () => {
    writeFileSync(
      join(tmpDir, '.codeatlas.yaml'),
      `
indexer:
  extensions: [".java"]
`,
    );
    const config = loadConfig(tmpDir);
    expect(config.indexer.skipDirs).toEqual(DEFAULT_SKIP_DIRS);
    expect(config.deadCode.excludeAnnotations).toEqual(DEFAULT_EXCLUDED_ANNOTATIONS);
    expect(config.deadCode.replaceAnnotations).toBe(false);
    expect(config.deadCode.excludePatterns).toEqual([]);
    expect(config.summaries.model).toBe(DEFAULT_MODEL);
  });

  // Cycle A3: File not found → all defaults
  it('returns all-defaults config when .codeatlas.yaml does not exist', () => {
    const config = loadConfig(tmpDir); // no file written
    expect(config.indexer.extensions).toEqual(DEFAULT_EXTENSIONS);
    expect(config.indexer.skipDirs).toEqual(DEFAULT_SKIP_DIRS);
    expect(config.deadCode.excludeAnnotations).toEqual(DEFAULT_EXCLUDED_ANNOTATIONS);
    expect(config.deadCode.replaceAnnotations).toBe(false);
    expect(config.deadCode.excludePatterns).toEqual([]);
    expect(config.summaries.model).toBe(DEFAULT_MODEL);
  });

  // Cycle A4: annotations append (replace=false)
  it('appends custom annotations to defaults when replace_annotations is false', () => {
    writeFileSync(
      join(tmpDir, '.codeatlas.yaml'),
      `
dead_code:
  exclude_annotations:
    - "@CustomEntry"
`,
    );
    const config = loadConfig(tmpDir);
    expect(config.deadCode.excludeAnnotations).toContain('@CustomEntry');
    expect(config.deadCode.excludeAnnotations).toContain('@RestController');
    expect(config.deadCode.excludeAnnotations.length).toBe(DEFAULT_EXCLUDED_ANNOTATIONS.length + 1);
  });

  // Cycle A5: annotations replace (replace=true)
  it('replaces default annotations when replace_annotations is true', () => {
    writeFileSync(
      join(tmpDir, '.codeatlas.yaml'),
      `
dead_code:
  exclude_annotations:
    - "@CustomEntry"
  replace_annotations: true
`,
    );
    const config = loadConfig(tmpDir);
    expect(config.deadCode.excludeAnnotations).toEqual(['@CustomEntry']);
    expect(config.deadCode.excludeAnnotations).not.toContain('@RestController');
  });

  // Cycle A7: memory defaults
  it('returns memory defaults when no memory section in YAML', () => {
    const config = loadConfig(tmpDir);
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.path).toBe(DEFAULT_MEMORY_PATH);
    expect(config.memory.autoOnboard).toBe(true);
  });

  // Cycle A8: memory custom config
  it('parses memory section from YAML', () => {
    writeFileSync(
      join(tmpDir, '.codeatlas.yaml'),
      `
memory:
  enabled: false
  path: .my-memories
  auto_onboard: false
`,
    );
    const config = loadConfig(tmpDir);
    expect(config.memory.enabled).toBe(false);
    expect(config.memory.path).toBe('.my-memories');
    expect(config.memory.autoOnboard).toBe(false);
  });

  // Cycle A9: partial memory config → defaults for missing fields
  it('fills memory defaults for partially-specified memory section', () => {
    writeFileSync(
      join(tmpDir, '.codeatlas.yaml'),
      `
memory:
  enabled: false
`,
    );
    const config = loadConfig(tmpDir);
    expect(config.memory.enabled).toBe(false);
    expect(config.memory.path).toBe(DEFAULT_MEMORY_PATH);
    expect(config.memory.autoOnboard).toBe(true);
  });

  // Cycle A6: Invalid YAML → defaults + stderr warning
  it('returns defaults and writes warning to stderr for invalid YAML', () => {
    writeFileSync(join(tmpDir, '.codeatlas.yaml'), '{{invalid: yaml: [');
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    const config = loadConfig(tmpDir);

    vi.restoreAllMocks();
    expect(config.indexer.extensions).toEqual(DEFAULT_EXTENSIONS);
    expect(stderrChunks.join('')).toContain('.codeatlas.yaml');
  });
});
