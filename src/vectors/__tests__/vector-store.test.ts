/**
 * D2: VectorStore TDD Tests
 *
 * Tests use real LanceDB in temp directories.
 * Synthetic vectors with known similarity relationships.
 *
 * Red → Green → Refactor
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VectorStore } from '../vector-store.js';
import type { VectorRecord } from '../vector-store.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DIMS = 8; // small dim for tests

function makeVector(seed: number, dims = DIMS): number[] {
  return Array.from({ length: dims }, (_, i) => (seed + i) / (dims * 10));
}

function makeRecord(overrides: Partial<VectorRecord> & { id: string }): VectorRecord {
  return {
    text: 'sample text',
    vector: makeVector(1),
    kind: 'file',
    projectId: 1,
    metadata: JSON.stringify({ relative_path: 'Foo.java' }),
    ...overrides,
  };
}

// ─── D2: VectorStore ──────────────────────────────────────────────────────────

describe('D2: VectorStore', () => {
  let tmpDir: string;
  let store: VectorStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'codeatlas-vs-test-'));
    store = await VectorStore.open(join(tmpDir, 'vectors'));
  });
  afterEach(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('open() creates a VectorStore at the specified path', async () => {
    expect(store).toBeDefined();
  });

  it('upsert() and search() — stores records and retrieves them', async () => {
    const rec = makeRecord({ id: 'file:1', text: 'CartService handles cart ops' });
    await store.upsert([rec]);

    const results = await store.search(rec.vector, { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('file:1');
  });

  it('search() returns results ordered by similarity (closest first)', async () => {
    // vec0 and vecQuery are close; vec1 is far
    const vecQuery = makeVector(0);
    const vecClose = makeVector(0);   // same as query → distance ~0
    const vecFar   = makeVector(100); // different

    await store.upsert([
      makeRecord({ id: 'file:close', vector: vecClose }),
      makeRecord({ id: 'file:far',   vector: vecFar }),
    ]);

    const results = await store.search(vecQuery, { limit: 2 });
    expect(results[0].id).toBe('file:close');
    expect(results[1].id).toBe('file:far');
    expect(results[0].score).toBeLessThanOrEqual(results[1].score);
  });

  it('search() with kind filter returns only matching kind', async () => {
    await store.upsert([
      makeRecord({ id: 'file:1', kind: 'file' }),
      makeRecord({ id: 'sym:1',  kind: 'symbol' }),
    ]);

    const results = await store.search(makeVector(0), { kind: 'file', limit: 10 });
    expect(results.every(r => r.kind === 'file')).toBe(true);
  });

  it('search() with projectId filter returns only matching project', async () => {
    await store.upsert([
      makeRecord({ id: 'file:p1', projectId: 1 }),
      makeRecord({ id: 'file:p2', projectId: 2 }),
    ]);

    const results = await store.search(makeVector(0), { projectId: 1, limit: 10 });
    expect(results.every(r => r.metadata.includes('"projectId":1') ||
      JSON.parse(r.metadata).projectId === 1 || r.id === 'file:p1')).toBe(true);
    expect(results.map(r => r.id)).toContain('file:p1');
    expect(results.map(r => r.id)).not.toContain('file:p2');
  });

  it('search() with limit caps result count', async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `file:${i}`, vector: makeVector(i) }),
    );
    await store.upsert(records);

    const results = await store.search(makeVector(0), { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('upsert() with same id updates the record (no duplicate)', async () => {
    await store.upsert([makeRecord({ id: 'file:1', text: 'original' })]);
    await store.upsert([makeRecord({ id: 'file:1', text: 'updated' })]);

    const results = await store.search(makeVector(1), { limit: 10 });
    const match = results.filter(r => r.id === 'file:1');
    expect(match).toHaveLength(1);
    expect(match[0].text).toBe('updated');
  });

  it('deleteByProject() removes all records for that project', async () => {
    await store.upsert([
      makeRecord({ id: 'file:p1', projectId: 1 }),
      makeRecord({ id: 'file:p2', projectId: 2 }),
    ]);

    await store.deleteByProject(1);

    const results = await store.search(makeVector(0), { limit: 10 });
    expect(results.map(r => r.id)).not.toContain('file:p1');
    expect(results.map(r => r.id)).toContain('file:p2');
  });
});
