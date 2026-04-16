import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase } from '../../storage/database.js';
import { upsertProject } from '../../storage/queries.js';
import {
  resolveProjectRoot,
  handleWriteMemory,
  handleReadMemory,
  handleListMemories,
  handleEditMemory,
  handleDeleteMemory,
} from '../memory-tools.js';
import { readMemory } from '../../memory/store.js';
import type { Db } from '../../storage/database.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let tmpDir: string;
let projectRoot: string;
let db: Db;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'codeatlas-mcp-mem-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'codeatlas-project-'));
  db = openDatabase(':memory:');
  // Register a project in the DB
  upsertProject(db, 'my-project', projectRoot);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

// ─── resolveProjectRoot ───────────────────────────────────────────────────────

describe('resolveProjectRoot', () => {
  it('resolves by project name', () => {
    expect(resolveProjectRoot(db, 'my-project')).toBe(projectRoot);
  });

  it('resolves by absolute path', () => {
    expect(resolveProjectRoot(db, projectRoot)).toBe(projectRoot);
  });

  it('returns null for unknown project', () => {
    expect(resolveProjectRoot(db, 'nonexistent')).toBeNull();
  });
});

// ─── handleWriteMemory ────────────────────────────────────────────────────────

describe('handleWriteMemory', () => {
  it('writes a memory and returns ok', () => {
    const result = handleWriteMemory(db, {
      project: 'my-project',
      title: 'Architecture Overview',
      content: '## Hexagonal Architecture\n\nDetails here.',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('architecture-overview');
  });

  it('errors for unknown project', () => {
    const result = handleWriteMemory(db, {
      project: 'unknown',
      title: 'Test',
      content: 'body',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not found');
  });

  it('errors when title produces empty slug', () => {
    const result = handleWriteMemory(db, {
      project: 'my-project',
      title: '프로젝트 개요',
      content: 'body',
    });
    expect(result.ok).toBe(false);
  });

  it('stores tags in the memory file', () => {
    handleWriteMemory(db, {
      project: 'my-project',
      title: 'Tagged Memory',
      content: 'content',
      tags: ['onboarding', 'arch'],
    });
    const mem = readMemory(projectRoot, 'tagged-memory');
    expect(mem?.tags).toEqual(['onboarding', 'arch']);
  });
});

// ─── handleReadMemory ─────────────────────────────────────────────────────────

describe('handleReadMemory', () => {
  it('reads an existing memory', () => {
    handleWriteMemory(db, { project: 'my-project', title: 'My Note', content: 'body text' });
    const result = handleReadMemory(db, { project: 'my-project', slug: 'my-note' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mem = result.data as { content: string };
    expect(mem.content).toBe('body text');
  });

  it('errors for nonexistent slug', () => {
    const result = handleReadMemory(db, { project: 'my-project', slug: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not found');
  });

  it('errors for unknown project', () => {
    const result = handleReadMemory(db, { project: 'unknown', slug: 'test' });
    expect(result.ok).toBe(false);
  });
});

// ─── handleListMemories ───────────────────────────────────────────────────────

describe('handleListMemories', () => {
  it('lists all memories for a project', () => {
    handleWriteMemory(db, { project: 'my-project', title: 'Note A', content: 'a', tags: ['t1'] });
    handleWriteMemory(db, { project: 'my-project', title: 'Note B', content: 'b', tags: ['t2'] });
    const result = handleListMemories(db, { project: 'my-project' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const list = result.data as { slug: string }[];
    expect(list).toHaveLength(2);
  });

  it('filters by tag', () => {
    handleWriteMemory(db, { project: 'my-project', title: 'Alpha', content: 'a', tags: ['onboarding'] });
    handleWriteMemory(db, { project: 'my-project', title: 'Beta', content: 'b', tags: ['other'] });
    const result = handleListMemories(db, { project: 'my-project', tag: 'onboarding' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const list = result.data as { slug: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe('alpha');
  });

  it('errors for unknown project', () => {
    const result = handleListMemories(db, { project: 'unknown' });
    expect(result.ok).toBe(false);
  });
});

// ─── handleEditMemory ─────────────────────────────────────────────────────────

describe('handleEditMemory', () => {
  it('edits content of an existing memory', () => {
    handleWriteMemory(db, { project: 'my-project', title: 'Editable', content: 'original' });
    const result = handleEditMemory(db, {
      project: 'my-project',
      slug: 'editable',
      content: 'updated',
    });
    expect(result.ok).toBe(true);
    const mem = readMemory(projectRoot, 'editable');
    expect(mem?.content).toBe('updated');
  });

  it('errors for nonexistent slug', () => {
    const result = handleEditMemory(db, {
      project: 'my-project',
      slug: 'nope',
      content: 'x',
    });
    expect(result.ok).toBe(false);
  });
});

// ─── handleDeleteMemory ───────────────────────────────────────────────────────

describe('handleDeleteMemory', () => {
  it('deletes an existing memory', () => {
    handleWriteMemory(db, { project: 'my-project', title: 'Deletable', content: 'x' });
    const result = handleDeleteMemory(db, { project: 'my-project', slug: 'deletable' });
    expect(result.ok).toBe(true);
    expect(readMemory(projectRoot, 'deletable')).toBeNull();
  });

  it('errors for nonexistent slug', () => {
    const result = handleDeleteMemory(db, { project: 'my-project', slug: 'nope' });
    expect(result.ok).toBe(false);
  });
});
