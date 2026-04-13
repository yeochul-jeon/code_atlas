/**
 * Embedder — Wraps @xenova/transformers for local text embedding
 *
 * Usage:
 *   const embedder = new Embedder();  // uses Xenova/all-MiniLM-L6-v2 (384 dims)
 *   const vec = await embedder.embed('CartService handles cart operations');
 *
 * For tests, inject a mock pipelineFn:
 *   const embedder = new Embedder({ pipelineFn: mockFn });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PipelineFn = (text: string, options?: unknown) => Promise<{ data: Float32Array }>;

export interface EmbedderConfig {
  modelName?: string;
  dims?: number;
  pipelineFn?: PipelineFn;
}

// ─── Embedder ─────────────────────────────────────────────────────────────────

export class Embedder {
  private readonly modelName: string;
  private readonly _dims: number;
  private readonly injectedPipeline?: PipelineFn;
  private _pipeline: PipelineFn | null = null;

  constructor(config: EmbedderConfig = {}) {
    this.modelName = config.modelName ?? 'Xenova/all-MiniLM-L6-v2';
    this._dims = config.dims ?? 384;
    this.injectedPipeline = config.pipelineFn;
  }

  get dimensions(): number {
    return this._dims;
  }

  private async getPipeline(): Promise<PipelineFn> {
    if (this.injectedPipeline) return this.injectedPipeline;
    if (this._pipeline) return this._pipeline;

    // Lazy-load the real transformer pipeline
    const { pipeline } = await import('@xenova/transformers');
    const pipe = await pipeline('feature-extraction', this.modelName, {
      revision: 'default',
    });
    this._pipeline = async (text: string) => {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      return { data: output.data as Float32Array };
    };
    return this._pipeline;
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.getPipeline();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
