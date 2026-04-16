import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateOnboardingMemories,
  buildProjectData,
  type ProjectData,
} from '../onboarding.js';
import { writeMemory, listMemories, readMemory } from '../store.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'codeatlas-onboard-test-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── Mock Anthropic client ────────────────────────────────────────────────────

function makeMockClient(responseText = 'Generated content for this memory.') {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  };
}

// ─── buildProjectData ─────────────────────────────────────────────────────────

describe('buildProjectData', () => {
  it('counts files by extension', () => {
    const files = [
      { relative_path: 'src/Foo.java' },
      { relative_path: 'src/Bar.java' },
      { relative_path: 'src/app.ts' },
    ];
    const data = buildProjectData('test', '/tmp/test', files, {}, []);
    expect(data.filesByExtension['.java']).toBe(2);
    expect(data.filesByExtension['.ts']).toBe(1);
  });

  it('builds 2-level directory tree', () => {
    const files = [
      { relative_path: 'src/main/Foo.java' },
      { relative_path: 'src/test/FooTest.java' },
      { relative_path: 'README.md' },
    ];
    const data = buildProjectData('test', '/tmp/test', files, {}, []);
    expect(data.directoryTree).toContain('src');
    expect(data.directoryTree).toContain('src/main');
    expect(data.directoryTree).toContain('src/test');
  });

  it('computes totalFiles and totalSymbols', () => {
    const files = [{ relative_path: 'A.java' }, { relative_path: 'B.java' }];
    const symbolsByKind = { class: 5, method: 20 };
    const data = buildProjectData('test', '/tmp/test', files, symbolsByKind, []);
    expect(data.totalFiles).toBe(2);
    expect(data.totalSymbols).toBe(25);
  });

  it('passes through name, rootPath, topAnnotations, symbolsByKind', () => {
    const data = buildProjectData('my-project', '/project', [], { class: 1 }, ['@Service']);
    expect(data.name).toBe('my-project');
    expect(data.rootPath).toBe('/project');
    expect(data.symbolsByKind).toEqual({ class: 1 });
    expect(data.topAnnotations).toEqual(['@Service']);
  });
});

// ─── generateOnboardingMemories ───────────────────────────────────────────────

const sampleData: ProjectData = {
  name: 'test-project',
  rootPath: '/tmp/test',
  filesByExtension: { '.java': 100, '.ts': 20 },
  symbolsByKind: { class: 50, method: 200, field: 100 },
  topAnnotations: ['@Service', '@RestController'],
  directoryTree: '  src\n  src/main\n  src/test',
  totalFiles: 120,
  totalSymbols: 350,
};

describe('generateOnboardingMemories', () => {
  it('skips if memories already exist', async () => {
    writeMemory(projectRoot, 'existing', 'Existing', 'content');
    const client = makeMockClient();
    const result = await generateOnboardingMemories(projectRoot, sampleData, client as never);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('memories already exist');
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('skips if no ANTHROPIC_API_KEY and no client provided', async () => {
    const originalKey = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    const result = await generateOnboardingMemories(projectRoot, sampleData);
    process.env['ANTHROPIC_API_KEY'] = originalKey;
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('ANTHROPIC_API_KEY');
  });

  it('generates 4 memory files on success', async () => {
    const client = makeMockClient('## Content\n\nDetailed memory content here.');
    const result = await generateOnboardingMemories(projectRoot, sampleData, client as never);
    expect(result.skipped).toBe(false);
    expect(result.memoriesCreated).toHaveLength(4);
    expect(result.memoriesCreated).toContain('project-overview');
    expect(result.memoriesCreated).toContain('architecture');
    expect(result.memoriesCreated).toContain('entry-points');
    expect(result.memoriesCreated).toContain('conventions');
  });

  it('creates physical memory files with correct content', async () => {
    const client = makeMockClient('The generated content.');
    await generateOnboardingMemories(projectRoot, sampleData, client as never);
    const mem = readMemory(projectRoot, 'project-overview');
    expect(mem).not.toBeNull();
    expect(mem?.content).toBe('The generated content.');
    expect(mem?.tags).toContain('onboarding');
  });

  it('calls Anthropic API once per memory spec (4 calls)', async () => {
    const client = makeMockClient();
    await generateOnboardingMemories(projectRoot, sampleData, client as never);
    expect(client.messages.create).toHaveBeenCalledTimes(4);
  });

  it('continues on API error for individual memory (partial success)', async () => {
    const client = {
      messages: {
        create: vi.fn()
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Overview content.' }] })
          .mockRejectedValueOnce(new Error('API error'))
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Entry points content.' }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Conventions content.' }] }),
      },
    };
    const result = await generateOnboardingMemories(projectRoot, sampleData, client as never);
    expect(result.skipped).toBe(false);
    // 3 out of 4 should succeed (architecture failed)
    expect(result.memoriesCreated).toHaveLength(3);
    expect(result.memoriesCreated).not.toContain('architecture');
  });

  it('all memories appear in listMemories after generation', async () => {
    const client = makeMockClient('Content.');
    await generateOnboardingMemories(projectRoot, sampleData, client as never);
    const list = listMemories(projectRoot);
    expect(list).toHaveLength(4);
  });
});
