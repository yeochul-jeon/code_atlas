/**
 * D1: Embedder TDD Tests
 *
 * Tests for the Embedder class that wraps @xenova/transformers.
 * Unit tests use a mock pipeline (no real model download).
 *
 * Red → Green → Refactor
 */
import { describe, it, expect, vi } from 'vitest';
import { Embedder } from '../embedder.js';
import type { PipelineFn } from '../embedder.js';

// ─── Mock pipeline factory ────────────────────────────────────────────────────

/**
 * Creates a deterministic mock pipeline.
 * Returns a vector where each element = (char code sum mod 256) / 255.
 */
function makeMockPipeline(dims = 384): PipelineFn {
  return vi.fn().mockImplementation(async (text: string) => {
    const sum = [...text].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const base = (sum % 256) / 255;
    const data = new Float32Array(dims).fill(base);
    return { data };
  });
}

// ─── D1: Embedder class ───────────────────────────────────────────────────────

describe('D1: Embedder', () => {
  it('embed() returns a number array of correct dimensions', async () => {
    const pipeline = makeMockPipeline(384);
    const embedder = new Embedder({ pipelineFn: pipeline });

    const result = await embedder.embed('CartService.java');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(384);
    result.forEach(v => expect(typeof v).toBe('number'));
  });

  it('embed() calls the underlying pipeline with the text', async () => {
    const pipeline = makeMockPipeline();
    const embedder = new Embedder({ pipelineFn: pipeline });

    await embedder.embed('hello world');

    expect(pipeline).toHaveBeenCalledWith('hello world', expect.anything());
  });

  it('embedBatch() returns correct number of vectors', async () => {
    const pipeline = makeMockPipeline();
    const embedder = new Embedder({ pipelineFn: pipeline });

    const texts = ['CartService', 'OrderRepository', 'PaymentGateway'];
    const results = await embedder.embedBatch(texts);

    expect(results).toHaveLength(3);
    results.forEach(v => expect(v).toHaveLength(384));
  });

  it('embedBatch() produces different vectors for different texts', async () => {
    const pipeline = makeMockPipeline();
    const embedder = new Embedder({ pipelineFn: pipeline });

    const results = await embedder.embedBatch(['cart', 'database']);

    // Different text should produce different vectors (mock uses char sum)
    expect(results[0]).not.toEqual(results[1]);
  });

  it('dimensions getter returns the correct dimension count', () => {
    const embedder = new Embedder({ pipelineFn: makeMockPipeline(384), dims: 384 });
    expect(embedder.dimensions).toBe(384);
  });

  it('handles empty string without throwing', async () => {
    const pipeline = makeMockPipeline();
    const embedder = new Embedder({ pipelineFn: pipeline });

    await expect(embedder.embed('')).resolves.toHaveLength(384);
  });

  it('embedBatch() returns empty array for empty input', async () => {
    const embedder = new Embedder({ pipelineFn: makeMockPipeline() });
    const results = await embedder.embedBatch([]);
    expect(results).toHaveLength(0);
  });
});
