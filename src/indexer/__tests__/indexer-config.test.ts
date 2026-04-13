// src/indexer/__tests__/indexer-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, type Db } from '../../storage/database.js';
import { listProjectFiles } from '../../storage/queries.js';
import { indexProject } from '../indexer.js';

let db: Db;
let tmpDir: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  tmpDir = mkdtempSync(join(tmpdir(), 'codeatlas-idx-cfg-'));
});
afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('indexProject with config options', () => {
  // Cycle B1: Custom extensions collect matching files
  it('collects files with custom extensions', () => {
    writeFileSync(join(tmpDir, 'App.java'), 'public class App {}');
    writeFileSync(join(tmpDir, 'Main.kt'), 'class Main');
    writeFileSync(join(tmpDir, 'README.md'), '# readme');

    const result = indexProject(db, tmpDir, 'proj', {
      extensions: ['.java', '.kt'],
    });

    const files = listProjectFiles(db, result.project.id);
    const paths = files.map(f => f.relative_path).sort();
    expect(paths).toContain('App.java');
    expect(paths).toContain('Main.kt');
    expect(paths).not.toContain('README.md');
  });

  // Cycle B2: Custom skipDirs skips those directories
  it('skips directories in custom skipDirs', () => {
    mkdirSync(join(tmpDir, 'vendor'));
    writeFileSync(join(tmpDir, 'vendor', 'Lib.java'), 'public class Lib {}');
    writeFileSync(join(tmpDir, 'App.java'), 'public class App {}');

    const result = indexProject(db, tmpDir, 'proj', {
      skipDirs: ['vendor'],
    });

    const files = listProjectFiles(db, result.project.id);
    expect(files).toHaveLength(1);
    expect(files[0].relative_path).toBe('App.java');
  });

  // Cycle B3: Unsupported extension → graceful skip, no error
  it('gracefully handles unsupported extensions without errors', () => {
    writeFileSync(join(tmpDir, 'script.py'), 'print("hello")');

    const result = indexProject(db, tmpDir, 'proj', {
      extensions: ['.py'],
    });

    // File is collected (upsertFile called), but no symbols extracted
    const files = listProjectFiles(db, result.project.id);
    expect(files).toHaveLength(1);
    expect(files[0].relative_path).toBe('script.py');
    expect(result.errors).toBe(0);
    // indexed may be 0 or 1 depending on implementation — just verify no errors
  });

  // Cycle B4: No options → backward compatible with defaults
  it('uses default extensions and skipDirs when no options provided', () => {
    mkdirSync(join(tmpDir, 'node_modules'));
    writeFileSync(join(tmpDir, 'node_modules', 'Hidden.java'), 'public class Hidden {}');
    writeFileSync(join(tmpDir, 'App.java'), 'public class App {}');
    writeFileSync(join(tmpDir, 'script.py'), 'print("hello")');

    const result = indexProject(db, tmpDir, 'proj');
    // No options = use old defaults

    const files = listProjectFiles(db, result.project.id);
    expect(files).toHaveLength(1);
    expect(files[0].relative_path).toBe('App.java');
  });
});
