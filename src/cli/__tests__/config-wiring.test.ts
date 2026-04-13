/**
 * Module D: Config Wiring Integration Tests
 *
 * Verifies that loadConfig output correctly wires into indexProject and deadCodeAction.
 * These tests simulate what the CLI commands do internally.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, type Db } from '../../storage/database.js';
import { upsertProject, upsertFile, insertSymbol, listProjectFiles } from '../../storage/queries.js';
import { indexProject } from '../../indexer/indexer.js';
import { loadConfig } from '../../config/loader.js';
import { deadCodeAction } from '../dead-code.js';

let db: Db;
let tmpDir: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  tmpDir = mkdtempSync(join(tmpdir(), 'codeatlas-wiring-'));
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// D1: CLI index wiring — loadConfig → indexProject
describe('D1: index command wiring', () => {
  it('passes config extensions and skipDirs from .codeatlas.yaml to indexProject', () => {
    writeFileSync(join(tmpDir, '.codeatlas.yaml'), `
indexer:
  extensions: [".java", ".kt"]
  skip_dirs: ["vendor"]
`);
    mkdirSync(join(tmpDir, 'vendor'));
    writeFileSync(join(tmpDir, 'vendor', 'Lib.java'), 'public class Lib {}');
    writeFileSync(join(tmpDir, 'App.java'), 'public class App {}');
    writeFileSync(join(tmpDir, 'Main.kt'), 'class Main');

    const config = loadConfig(tmpDir);
    const result = indexProject(db, tmpDir, 'proj', {
      extensions: config.indexer.extensions,
      skipDirs: config.indexer.skipDirs,
    });

    const files = listProjectFiles(db, result.project.id);
    const paths = files.map(f => f.relative_path).sort();
    expect(paths).toContain('App.java');
    expect(paths).toContain('Main.kt');
    expect(paths).not.toContain('vendor/Lib.java');
  });
});

// D2: MCP server model wiring — loadConfig → modelOverride
describe('D2: summarizer model wiring', () => {
  it('loadConfig returns model that can be used as modelOverride', () => {
    writeFileSync(join(tmpDir, '.codeatlas.yaml'), `
summaries:
  model: "claude-haiku-4-5-20251001"
`);
    const config = loadConfig(tmpDir);
    expect(config.summaries.model).toBe('claude-haiku-4-5-20251001');
    // The CLI serve command would pass this to startMcpServer as modelOverride
  });

  it('returns DEFAULT_MODEL when summaries section is absent', () => {
    writeFileSync(join(tmpDir, '.codeatlas.yaml'), `
indexer:
  extensions: [".java"]
`);
    const config = loadConfig(tmpDir);
    expect(config.summaries.model).toBe('claude-sonnet-4-6');
  });
});

// D3: CLI dead-code wiring — loadConfig → deadCodeAction options
describe('D3: dead-code command wiring', () => {
  it('passes exclude_patterns from .codeatlas.yaml to deadCodeAction', () => {
    writeFileSync(join(tmpDir, '.codeatlas.yaml'), `
dead_code:
  exclude_patterns:
    - "**/*Test.java"
`);

    const p = upsertProject(db, 'my-app', tmpDir);
    const testFile = upsertFile(db, p.id, 'src/FooTest.java', 'h1');
    insertSymbol(db, { file_id: testFile.id, name: 'testHelper', kind: 'method', start_line: 5, end_line: 15 });
    const prodFile = upsertFile(db, p.id, 'src/Foo.java', 'h2');
    insertSymbol(db, { file_id: prodFile.id, name: 'prodMethod', kind: 'method', start_line: 1, end_line: 10 });

    const config = loadConfig(tmpDir);
    const options = {
      excludeAnnotations: new Set(config.deadCode.excludeAnnotations),
      excludePatterns: config.deadCode.excludePatterns,
    };
    const result = deadCodeAction(db, 'my-app', undefined, options);

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('testHelper');
    expect(result.output).toContain('prodMethod');
  });
});
