import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, type Db } from '../../storage/database.js';
import { upsertProject, upsertFile, insertSymbol } from '../../storage/queries.js';
import { deadCodeAction } from '../dead-code.js';

let db: Db;
beforeEach(() => { db = openDatabase(':memory:'); });
afterEach(() => { db.close(); });

describe('deadCodeAction with config options', () => {
  it('passes excludePatterns through to findDeadCode', () => {
    const p = upsertProject(db, 'my-app', '/projects/my-app');
    const f = upsertFile(db, p.id, 'src/FooTest.java', 'abc');
    insertSymbol(db, {
      file_id: f.id, name: 'testHelper', kind: 'method',
      start_line: 10, end_line: 20,
    });

    const result = deadCodeAction(db, 'my-app', undefined, {
      excludePatterns: ['**/*Test.java'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('testHelper');
  });
});
