import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  slugify,
  ensureMemoryDir,
  writeMemory,
  readMemory,
  listMemories,
  editMemory,
  deleteMemory,
} from '../store.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'codeatlas-memory-test-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Project Overview')).toBe('project-overview');
  });

  it('collapses multiple non-alnum chars', () => {
    expect(slugify('Entry Points & APIs')).toBe('entry-points-apis');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world');
  });

  it('handles already-slug strings', () => {
    expect(slugify('project-overview')).toBe('project-overview');
  });

  it('truncates long titles to 80 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(80);
  });

  it('handles Korean characters (non-alnum → stripped)', () => {
    // Korean chars are non-alnum, replaced then stripped → empty string
    expect(slugify('프로젝트 개요')).toBe('');
  });
});

// ─── ensureMemoryDir ──────────────────────────────────────────────────────────

describe('ensureMemoryDir', () => {
  it('creates .codeatlas/memories directory', () => {
    const dir = ensureMemoryDir(projectRoot);
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(projectRoot, '.codeatlas', 'memories'));
  });

  it('is idempotent', () => {
    ensureMemoryDir(projectRoot);
    expect(() => ensureMemoryDir(projectRoot)).not.toThrow();
  });
});

// ─── writeMemory ──────────────────────────────────────────────────────────────

describe('writeMemory', () => {
  it('creates a markdown file with YAML frontmatter', () => {
    writeMemory(projectRoot, 'project-overview', 'Project Overview', '# Hello\nworld');
    const path = join(projectRoot, '.codeatlas', 'memories', 'project-overview.md');
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('title: Project Overview');
    expect(raw).toContain('# Hello\nworld');
  });

  it('returns the created Memory object', () => {
    const mem = writeMemory(projectRoot, 'arch', 'Architecture', 'content here', ['onboarding']);
    expect(mem.slug).toBe('arch');
    expect(mem.title).toBe('Architecture');
    expect(mem.tags).toEqual(['onboarding']);
    expect(mem.content).toBe('content here');
    expect(mem.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mem.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates memory dir automatically', () => {
    const dir = join(projectRoot, '.codeatlas', 'memories');
    expect(existsSync(dir)).toBe(false);
    writeMemory(projectRoot, 'test', 'Test', 'body');
    expect(existsSync(dir)).toBe(true);
  });

  it('overwrites existing memory with same slug', () => {
    writeMemory(projectRoot, 'test', 'Old Title', 'old content');
    writeMemory(projectRoot, 'test', 'New Title', 'new content');
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.title).toBe('New Title');
    expect(mem.content).toBe('new content');
  });

  it('uses empty tags array by default', () => {
    const mem = writeMemory(projectRoot, 'test', 'Test', 'body');
    expect(mem.tags).toEqual([]);
  });
});

// ─── readMemory ───────────────────────────────────────────────────────────────

describe('readMemory', () => {
  it('returns null for nonexistent slug', () => {
    expect(readMemory(projectRoot, 'nonexistent')).toBeNull();
  });

  it('roundtrips all fields correctly', () => {
    writeMemory(projectRoot, 'test', 'Test Memory', 'some **markdown**', ['tag1', 'tag2']);
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.slug).toBe('test');
    expect(mem.title).toBe('Test Memory');
    expect(mem.tags).toEqual(['tag1', 'tag2']);
    expect(mem.content).toBe('some **markdown**');
    expect(mem.created_at).toBeTruthy();
    expect(mem.updated_at).toBeTruthy();
  });

  it('handles content with multiple paragraphs', () => {
    const body = '## Section 1\n\nParagraph one.\n\n## Section 2\n\nParagraph two.';
    writeMemory(projectRoot, 'multi', 'Multi', body);
    const mem = readMemory(projectRoot, 'multi')!;
    expect(mem.content).toBe(body);
  });
});

// ─── listMemories ─────────────────────────────────────────────────────────────

describe('listMemories', () => {
  it('returns empty array when no memories exist', () => {
    expect(listMemories(projectRoot)).toEqual([]);
  });

  it('returns empty array when dir does not exist', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'fresh-'));
    const result = listMemories(fresh);
    rmSync(fresh, { recursive: true, force: true });
    expect(result).toEqual([]);
  });

  it('lists all memories as metadata without content', () => {
    writeMemory(projectRoot, 'a', 'Alpha', 'body a', ['x']);
    writeMemory(projectRoot, 'b', 'Beta', 'body b', ['y']);
    const list = listMemories(projectRoot);
    expect(list).toHaveLength(2);
    expect(list.every(m => !('content' in m))).toBe(true);
    const slugs = list.map(m => m.slug);
    expect(slugs).toContain('a');
    expect(slugs).toContain('b');
  });

  it('filters by tag', () => {
    writeMemory(projectRoot, 'a', 'Alpha', 'body', ['onboarding']);
    writeMemory(projectRoot, 'b', 'Beta', 'body', ['architecture']);
    const filtered = listMemories(projectRoot, 'onboarding');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].slug).toBe('a');
  });

  it('returns metadata fields correctly', () => {
    writeMemory(projectRoot, 'test', 'Test', 'body', ['t1']);
    const list = listMemories(projectRoot);
    expect(list[0].title).toBe('Test');
    expect(list[0].tags).toEqual(['t1']);
    expect(list[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── editMemory ───────────────────────────────────────────────────────────────

describe('editMemory', () => {
  it('returns null for nonexistent slug', () => {
    expect(editMemory(projectRoot, 'nope', 'new content')).toBeNull();
  });

  it('updates the content body', () => {
    writeMemory(projectRoot, 'test', 'Test', 'original');
    editMemory(projectRoot, 'test', 'updated content');
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.content).toBe('updated content');
  });

  it('preserves title and created_at', () => {
    const original = writeMemory(projectRoot, 'test', 'My Title', 'original');
    editMemory(projectRoot, 'test', 'new body');
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.title).toBe('My Title');
    expect(mem.created_at).toBe(original.created_at);
  });

  it('bumps updated_at', async () => {
    const original = writeMemory(projectRoot, 'test', 'Test', 'original');
    // Small delay to ensure timestamps differ
    await new Promise(r => setTimeout(r, 5));
    const edited = editMemory(projectRoot, 'test', 'new body')!;
    expect(edited.updated_at >= original.updated_at).toBe(true);
  });

  it('merges new tags into existing tags', () => {
    writeMemory(projectRoot, 'test', 'Test', 'body', ['existing']);
    editMemory(projectRoot, 'test', 'body', ['new-tag']);
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.tags).toContain('existing');
    expect(mem.tags).toContain('new-tag');
  });

  it('deduplicates tags on merge', () => {
    writeMemory(projectRoot, 'test', 'Test', 'body', ['tag1']);
    editMemory(projectRoot, 'test', 'body', ['tag1', 'tag2']);
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.tags.filter(t => t === 'tag1')).toHaveLength(1);
  });

  it('preserves existing tags when no new tags provided', () => {
    writeMemory(projectRoot, 'test', 'Test', 'body', ['kept']);
    editMemory(projectRoot, 'test', 'new body');
    const mem = readMemory(projectRoot, 'test')!;
    expect(mem.tags).toEqual(['kept']);
  });
});

// ─── deleteMemory ─────────────────────────────────────────────────────────────

describe('deleteMemory', () => {
  it('returns false for nonexistent slug', () => {
    expect(deleteMemory(projectRoot, 'nope')).toBe(false);
  });

  it('deletes the file and returns true', () => {
    writeMemory(projectRoot, 'test', 'Test', 'body');
    expect(deleteMemory(projectRoot, 'test')).toBe(true);
    expect(readMemory(projectRoot, 'test')).toBeNull();
    const path = join(projectRoot, '.codeatlas', 'memories', 'test.md');
    expect(existsSync(path)).toBe(false);
  });

  it('deleted memory no longer appears in list', () => {
    writeMemory(projectRoot, 'a', 'Alpha', 'body');
    writeMemory(projectRoot, 'b', 'Beta', 'body');
    deleteMemory(projectRoot, 'a');
    const list = listMemories(projectRoot);
    expect(list.map(m => m.slug)).not.toContain('a');
    expect(list.map(m => m.slug)).toContain('b');
  });
});
