/**
 * D3: Embedding Pipeline TDD Tests
 *
 * Tests for buildFileDocument, buildSymbolDocument, and embedProject.
 * Uses in-memory SQLite + mock Embedder + mock VectorStore.
 *
 * Red → Green → Refactor
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDatabase } from '../../storage/database.js';
import {
  upsertProject,
  upsertFile,
  insertSymbol,
  upsertSummary,
} from '../../storage/queries.js';
import {
  buildFileDocument,
  buildSymbolDocument,
  embedProject,
} from '../embed-pipeline.js';
import type { Db } from '../../storage/database.js';
import type { VectorRecord } from '../vector-store.js';

// ─── Mock Embedder ────────────────────────────────────────────────────────────

function makeMockEmbedder(dims = 8) {
  return {
    embed: vi.fn().mockResolvedValue(Array(dims).fill(0.1)),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => Array(dims).fill(0.1))),
    ),
    dimensions: dims,
  };
}

// ─── Mock VectorStore ─────────────────────────────────────────────────────────

function makeMockVectorStore() {
  const upserted: VectorRecord[] = [];
  return {
    upsert: vi.fn().mockImplementation((records: VectorRecord[]) => {
      upserted.push(...records);
      return Promise.resolve();
    }),
    search: vi.fn().mockResolvedValue([]),
    deleteByProject: vi.fn().mockResolvedValue(undefined),
    _upserted: upserted,
  };
}

// ─── D3a: buildFileDocument ───────────────────────────────────────────────────

describe('D3a: buildFileDocument', () => {
  it('combines path + symbols into structured text', () => {
    const doc = buildFileDocument(
      'src/main/java/com/example/CartService.java',
      [
        { name: 'CartService', kind: 'class' },
        { name: 'addItem', kind: 'method' },
      ],
    );
    expect(doc).toContain('CartService.java');
    expect(doc).toContain('CartService');
    expect(doc).toContain('addItem');
    expect(doc).toContain('class');
    expect(doc).toContain('method');
  });

  it('includes summary when provided', () => {
    const doc = buildFileDocument(
      'CartService.java',
      [],
      'This service manages shopping cart items and checkout.',
    );
    expect(doc).toContain('manages shopping cart');
  });

  it('works without summary (summary is optional)', () => {
    const doc = buildFileDocument('Foo.java', [{ name: 'Foo', kind: 'class' }]);
    expect(doc).toContain('Foo');
    // should not throw or contain 'undefined'
    expect(doc).not.toContain('undefined');
  });
});

// ─── D3b: buildSymbolDocument ─────────────────────────────────────────────────

describe('D3b: buildSymbolDocument', () => {
  it('combines symbol name, kind, signature, and file path', () => {
    const doc = buildSymbolDocument(
      {
        name: 'CartCrudService',
        kind: 'class',
        signature: null,
        annotations: '["@Service","@UseCase"]',
      },
      'CartCrudService.java',
    );
    expect(doc).toContain('CartCrudService');
    expect(doc).toContain('class');
    expect(doc).toContain('@Service');
    expect(doc).toContain('CartCrudService.java');
  });

  it('handles null signature and annotations gracefully', () => {
    const doc = buildSymbolDocument(
      { name: 'OrderService', kind: 'class', signature: null, annotations: null },
      'OrderService.java',
    );
    expect(doc).toContain('OrderService');
    expect(doc).not.toContain('null');
  });
});

// ─── D3c: embedProject ────────────────────────────────────────────────────────

describe('D3c: embedProject', () => {
  let db: Db;
  let projectId: number;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const project = upsertProject(db, 'test', '/tmp/test');
    projectId = project.id;
    const file = upsertFile(db, projectId, 'CartService.java', 'abc123');
    insertSymbol(db, {
      file_id: file.id,
      name: 'CartService',
      kind: 'class',
      start_line: 1,
      end_line: 20,
    });
    insertSymbol(db, {
      file_id: file.id,
      name: 'addItem',
      kind: 'method',
      start_line: 5,
      end_line: 10,
    });
  });
  afterEach(() => { db.close(); });

  it('embeds each file and stores in VectorStore', async () => {
    const embedder = makeMockEmbedder();
    const vectorStore = makeMockVectorStore();

    const result = await embedProject(db, projectId, embedder as never, vectorStore as never);

    expect(result.filesEmbedded).toBe(1);
    expect(vectorStore.upsert).toHaveBeenCalled();
    const fileRecord = vectorStore._upserted.find(r => r.id === 'file:1' || r.kind === 'file');
    expect(fileRecord).toBeDefined();
  });

  it('includes summary in file document when summary exists', async () => {
    const file = db.prepare('SELECT id FROM files WHERE project_id = ?').get(projectId) as { id: number };
    upsertSummary(db, file.id, null, 'Handles cart item management.', 'claude-sonnet-4-6');

    const embedder = makeMockEmbedder();
    const vectorStore = makeMockVectorStore();

    await embedProject(db, projectId, embedder as never, vectorStore as never);

    // embed() should have been called with text containing the summary
    const calls = (embedder.embed as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const textWithSummary = calls.find(([t]) =>
      t.includes('Handles cart item management'),
    );
    expect(textWithSummary).toBeDefined();
  });

  it('embeds top-level class symbols (kind=class)', async () => {
    const embedder = makeMockEmbedder();
    const vectorStore = makeMockVectorStore();

    await embedProject(db, projectId, embedder as never, vectorStore as never);

    const symRecords = vectorStore._upserted.filter(r => r.kind === 'symbol');
    expect(symRecords.length).toBeGreaterThan(0);
    const ids = symRecords.map(r => r.id);
    // class symbol id should be present
    expect(ids.some(id => id.startsWith('sym:'))).toBe(true);
  });

  it('does NOT embed method-level symbols', async () => {
    const embedder = makeMockEmbedder();
    const vectorStore = makeMockVectorStore();

    await embedProject(db, projectId, embedder as never, vectorStore as never);

    const symRecords = vectorStore._upserted.filter(r => r.kind === 'symbol');
    // 'addItem' is a method, should not be embedded
    const hasMethodSymbol = symRecords.some(r =>
      r.metadata.includes('"symbol_name":"addItem"'),
    );
    expect(hasMethodSymbol).toBe(false);
  });

  it('returns EmbedResult with correct counts', async () => {
    const embedder = makeMockEmbedder();
    const vectorStore = makeMockVectorStore();

    const result = await embedProject(db, projectId, embedder as never, vectorStore as never);

    expect(result.filesEmbedded).toBe(1);
    expect(result.symbolsEmbedded).toBeGreaterThanOrEqual(1); // CartService class
    expect(typeof result.durationMs).toBe('number');
  });
});
