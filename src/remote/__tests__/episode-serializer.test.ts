import { describe, it, expect } from 'vitest';
import {
  buildGroupId,
  memoryToEpisode,
  summaryToEpisode,
  impactToEpisode,
} from '../episode-serializer.js';
import type { Memory } from '../../memory/store.js';
import type { Summary } from '../../storage/queries.js';
import type { ImpactResult } from '../../graph/graph-store.js';

const FINGERPRINT = 'a1b2c3d4e5f6789012345678901234567890abcd'; // 40-char git SHA
const PROJECT = 'my-app';

// ─── buildGroupId ─────────────────────────────────────────────────────────────

describe('buildGroupId', () => {
  it('builds group_id with first 8 chars of fingerprint', () => {
    expect(buildGroupId(PROJECT, FINGERPRINT)).toBe('codeatlas:my-app:a1b2c3d4');
  });

  it('accepts custom prefix', () => {
    expect(buildGroupId(PROJECT, FINGERPRINT, 'acme')).toBe('acme:my-app:a1b2c3d4');
  });
});

// ─── memoryToEpisode ──────────────────────────────────────────────────────────

const sampleMemory: Memory = {
  slug: 'architecture',
  title: 'System Architecture',
  tags: ['onboarding', 'architecture'],
  created_at: '2026-04-16T00:00:00.000Z',
  updated_at: '2026-04-16T01:00:00.000Z',
  content: '# Architecture\n\nHexagonal architecture with Spring Boot.',
};

describe('memoryToEpisode', () => {
  it('returns correct group_id', () => {
    const ep = memoryToEpisode({ memory: sampleMemory, projectName: PROJECT, fingerprint: FINGERPRINT });
    expect(ep.group_id).toBe('codeatlas:my-app:a1b2c3d4');
  });

  it('sets name as memory:<slug>', () => {
    const ep = memoryToEpisode({ memory: sampleMemory, projectName: PROJECT, fingerprint: FINGERPRINT });
    expect(ep.name).toBe('memory:architecture');
  });

  it('includes frontmatter + content in episode_body', () => {
    const ep = memoryToEpisode({ memory: sampleMemory, projectName: PROJECT, fingerprint: FINGERPRINT });
    expect(ep.episode_body).toContain('title: System Architecture');
    expect(ep.episode_body).toContain('tags: [onboarding, architecture]');
    expect(ep.episode_body).toContain('Hexagonal architecture with Spring Boot.');
  });

  it('uses text source', () => {
    const ep = memoryToEpisode({ memory: sampleMemory, projectName: PROJECT, fingerprint: FINGERPRINT });
    expect(ep.source).toBe('text');
  });

  it('does NOT include raw source code (no content_hash/code in body)', () => {
    const ep = memoryToEpisode({ memory: sampleMemory, projectName: PROJECT, fingerprint: FINGERPRINT });
    // episode_body should only contain what's in the memory content field
    // (which is human/AI-written knowledge, not raw source)
    expect(ep.episode_body).not.toContain('content_hash');
  });
});

// ─── summaryToEpisode ─────────────────────────────────────────────────────────

const sampleSummary: Summary = {
  id: 1,
  file_id: 42,
  symbol_id: null,
  content: 'This file handles user authentication using JWT tokens.',
  generated_at: '2026-04-16T00:00:00.000Z',
  model_version: 'claude-sonnet-4-6',
};

describe('summaryToEpisode', () => {
  const params = {
    summary: sampleSummary,
    filePath: 'src/auth/AuthService.java',
    projectName: PROJECT,
    fingerprint: FINGERPRINT,
  };

  it('sets name as summary:<filePath>', () => {
    expect(summaryToEpisode(params).name).toBe('summary:src/auth/AuthService.java');
  });

  it('includes file path and summary content in episode_body', () => {
    const ep = summaryToEpisode(params);
    expect(ep.episode_body).toContain('src/auth/AuthService.java');
    expect(ep.episode_body).toContain('JWT tokens');
  });

  it('does NOT include file_id or symbol_id (internal DB ids)', () => {
    const ep = summaryToEpisode(params);
    expect(ep.episode_body).not.toContain('"file_id"');
    expect(ep.episode_body).not.toContain('"symbol_id"');
  });

  it('uses text source', () => {
    expect(summaryToEpisode(params).source).toBe('text');
  });
});

// ─── impactToEpisode ──────────────────────────────────────────────────────────

const sampleCallers: ImpactResult[] = [
  { id: 1, name: 'OrderController.createOrder', kind: 'method', filePath: 'src/OrderController.java', startLine: 45, depth: 1 },
  { id: 2, name: 'PaymentService.processPayment', kind: 'method', filePath: 'src/PaymentService.java', startLine: 78, depth: 2 },
];

describe('impactToEpisode', () => {
  const params = {
    symbolName: 'UserService.findById',
    symbolKind: 'method',
    callers: sampleCallers,
    projectName: PROJECT,
    fingerprint: FINGERPRINT,
  };

  it('sets name as impact:<symbol>@<fingerprint[:8]>', () => {
    expect(impactToEpisode(params).name).toBe('impact:UserService.findById@a1b2c3d4');
  });

  it('uses json source', () => {
    expect(impactToEpisode(params).source).toBe('json');
  });

  it('includes symbol name and callers in episode_body', () => {
    const ep = impactToEpisode(params);
    const body = JSON.parse(ep.episode_body);
    expect(body.symbol).toBe('UserService.findById');
    expect(body.callers).toHaveLength(2);
    expect(body.callers[0].name).toBe('OrderController.createOrder');
    expect(body.callers[0].depth).toBe(1);
  });

  it('does NOT include internal DB ids in episode_body', () => {
    const ep = impactToEpisode(params);
    expect(ep.episode_body).not.toContain('"id":');
  });
});
