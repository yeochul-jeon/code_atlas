import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type Db } from '../database.js';
import {
  upsertProject, upsertFile, insertSymbol, insertRef,
  findDeadCode, DEFAULT_EXCLUDED_ANNOTATIONS,
} from '../queries.js';

let db: Db;
let projectId: number;
let fileId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  const p = upsertProject(db, 'proj', '/root');
  projectId = p.id;
  const f = upsertFile(db, p.id, 'src/Foo.java', 'h');
  fileId = f.id;
});
afterEach(() => { db.close(); });

describe('findDeadCode with config options', () => {
  // Cycle C1: Custom excludeAnnotations
  it('excludes symbols with a custom annotation set (replacing defaults)', () => {
    // Insert a symbol with @CustomEntry — NOT in defaults, so normally IS dead
    insertSymbol(db, {
      file_id: fileId, name: 'CustomHandler', kind: 'class',
      start_line: 1, end_line: 50,
      annotations: ['@CustomEntry'],
    });

    // Without options: @CustomEntry not excluded → symbol IS dead
    const deadDefault = findDeadCode(db, projectId);
    expect(deadDefault.some(s => s.name === 'CustomHandler')).toBe(true);

    // With custom excludeAnnotations containing @CustomEntry → NOT dead
    const deadCustom = findDeadCode(db, projectId, undefined, {
      excludeAnnotations: new Set(['@CustomEntry']),
    });
    expect(deadCustom.some(s => s.name === 'CustomHandler')).toBe(false);
  });

  // Cycle C2: excludePatterns skips symbols from matching files
  it('excludes symbols from files matching glob patterns', () => {
    const testFile = upsertFile(db, projectId, 'src/FooTest.java', 'h2');
    insertSymbol(db, {
      file_id: testFile.id, name: 'testHelper', kind: 'method',
      start_line: 5, end_line: 15,
    });
    insertSymbol(db, {
      file_id: fileId, name: 'prodMethod', kind: 'method',
      start_line: 1, end_line: 10,
    });

    const dead = findDeadCode(db, projectId, undefined, {
      excludePatterns: ['**/*Test.java'],
    });

    expect(dead.some(s => s.name === 'testHelper')).toBe(false);
    expect(dead.some(s => s.name === 'prodMethod')).toBe(true);
  });

  // Cycle C4: No options → current defaults (backward compat)
  it('uses default annotation exclusions when no options provided', () => {
    insertSymbol(db, {
      file_id: fileId, name: 'MyService', kind: 'class',
      start_line: 1, end_line: 50,
      annotations: ['@Service'],
    });
    insertSymbol(db, {
      file_id: fileId, name: 'OrphanClass', kind: 'class',
      start_line: 51, end_line: 100,
    });

    const dead = findDeadCode(db, projectId);
    expect(dead.some(s => s.name === 'MyService')).toBe(false);   // @Service excluded
    expect(dead.some(s => s.name === 'OrphanClass')).toBe(true);  // no annotation → dead
  });
});
