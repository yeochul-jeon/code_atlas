/**
 * D4: semantic_search MCP Tool TDD Tests
 *
 * Tests the semantic search handler logic in isolation
 * (not through MCP transport — same pattern as write-tools tests).
 * Uses mock Embedder and VectorStore.
 *
 * Red → Green → Refactor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSemanticSearch } from '../semantic-search.js';
import type { SearchResult } from '../vector-store.js';

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeMockEmbedder() {
  return {
    embed: vi.fn().mockResolvedValue(Array(8).fill(0.1)),
    embedBatch: vi.fn(),
    dimensions: 8,
  };
}

function makeMockVectorStore(results: SearchResult[] = []) {
  return {
    search: vi.fn().mockResolvedValue(results),
    upsert: vi.fn(),
    deleteByProject: vi.fn(),
  };
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'file:1',
    kind: 'file',
    score: 0.1,
    text: 'CartService.java\nSymbols: [class] CartService',
    metadata: JSON.stringify({
      relative_path: 'src/main/java/com/example/CartService.java',
    }),
    ...overrides,
  };
}

// ─── Mock project resolver ────────────────────────────────────────────────────

function makeProjectResolver(projectId: number | null) {
  return vi.fn().mockReturnValue(
    projectId !== null ? { id: projectId, name: 'test', root_path: '/tmp' } : null,
  );
}

// ─── D4: handleSemanticSearch ─────────────────────────────────────────────────

describe('D4: handleSemanticSearch', () => {
  let embedder: ReturnType<typeof makeMockEmbedder>;

  beforeEach(() => {
    embedder = makeMockEmbedder();
  });

  it('returns ranked results with file paths and scores', async () => {
    const vectorStore = makeMockVectorStore([
      makeResult({ id: 'file:1', score: 0.05 }),
      makeResult({ id: 'file:2', score: 0.3, metadata: JSON.stringify({ relative_path: 'OrderService.java' }) }),
    ]);

    const text = await handleSemanticSearch(
      { query: 'shopping cart', kind: 'file', limit: 10 },
      embedder as never,
      vectorStore as never,
      makeProjectResolver(null),
    );

    expect(text).toContain('CartService.java');
    expect(text).toContain('0.05');
    expect(text).toContain('OrderService.java');
  });

  it('returns "No results" message when store is empty', async () => {
    const vectorStore = makeMockVectorStore([]);

    const text = await handleSemanticSearch(
      { query: 'payment', kind: 'file', limit: 10 },
      embedder as never,
      vectorStore as never,
      makeProjectResolver(null),
    );

    expect(text.toLowerCase()).toContain('no results');
  });

  it('passes projectId filter when project name resolves', async () => {
    const vectorStore = makeMockVectorStore([makeResult()]);
    const resolver = makeProjectResolver(42);

    await handleSemanticSearch(
      { query: 'cart', kind: 'file', limit: 5, project: 'test' },
      embedder as never,
      vectorStore as never,
      resolver,
    );

    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 42 }),
    );
  });

  it('passes kind filter to vector store', async () => {
    const vectorStore = makeMockVectorStore([makeResult({ kind: 'symbol' })]);

    await handleSemanticSearch(
      { query: 'service', kind: 'symbol', limit: 5 },
      embedder as never,
      vectorStore as never,
      makeProjectResolver(null),
    );

    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'symbol' }),
    );
  });

  it('passes limit to vector store', async () => {
    const vectorStore = makeMockVectorStore([]);

    await handleSemanticSearch(
      { query: 'test', kind: 'file', limit: 3 },
      embedder as never,
      vectorStore as never,
      makeProjectResolver(null),
    );

    expect(vectorStore.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 3 }),
    );
  });

  it('returns guidance message when vectorStore is null (embeddings not yet generated)', async () => {
    const text = await handleSemanticSearch(
      { query: 'cart', kind: 'file', limit: 5 },
      embedder as never,
      null,
      makeProjectResolver(null),
    );

    expect(text).toContain('codeatlas embed');
  });

  it('returns error when unknown project name is given', async () => {
    const vectorStore = makeMockVectorStore([]);
    const resolver = vi.fn().mockReturnValue(null);

    const text = await handleSemanticSearch(
      { query: 'cart', kind: 'file', limit: 5, project: 'nonexistent' },
      embedder as never,
      vectorStore as never,
      resolver,
    );

    expect(text.toLowerCase()).toContain('not found');
  });
});
