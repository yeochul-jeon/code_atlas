/**
 * Onboarding — AI-powered initial memory generation for CodeAtlas projects
 *
 * On first index, generates 3-4 markdown memory files capturing:
 *   - Project overview (languages, stats, directory structure)
 *   - Architecture patterns (hexagonal, layered, etc.)
 *   - Key entry points (controllers, CLI, configs)
 *   - Coding conventions (naming, annotations, package structure)
 *
 * Requires ANTHROPIC_API_KEY. Skips gracefully if not set.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { slugify, writeMemory, listMemories } from './store.js';

// ─── ProjectData ──────────────────────────────────────────────────────────────

/** Plain data extracted from the DB by the CLI — no DB reference leaks. */
export interface ProjectData {
  name: string;
  rootPath: string;
  filesByExtension: Record<string, number>;   // { '.java': 412, '.ts': 88, ... }
  symbolsByKind: Record<string, number>;       // { 'class': 64, 'method': 1203, ... }
  topAnnotations: string[];                    // top 10 annotations by frequency
  directoryTree: string;                       // 2-level directory listing
  totalFiles: number;
  totalSymbols: number;
}

// ─── Onboarding result ────────────────────────────────────────────────────────

export interface OnboardingResult {
  memoriesCreated: string[];   // slugs of created memory files
  skipped: boolean;            // true if no API key or memories already exist
  skipReason?: string;
}

// ─── Memory definitions ───────────────────────────────────────────────────────

interface MemorySpec {
  slug: string;
  title: string;
  tags: string[];
  promptBuilder: (data: ProjectData) => string;
}

const MEMORY_SPECS: MemorySpec[] = [
  {
    slug: 'project-overview',
    title: 'Project Overview',
    tags: ['onboarding'],
    promptBuilder: buildOverviewPrompt,
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    tags: ['onboarding', 'architecture'],
    promptBuilder: buildArchitecturePrompt,
  },
  {
    slug: 'entry-points',
    title: 'Entry Points',
    tags: ['onboarding'],
    promptBuilder: buildEntryPointsPrompt,
  },
  {
    slug: 'conventions',
    title: 'Conventions',
    tags: ['onboarding', 'conventions'],
    promptBuilder: buildConventionsPrompt,
  },
];

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildOverviewPrompt(data: ProjectData): string {
  const extSummary = Object.entries(data.filesByExtension)
    .sort(([, a], [, b]) => b - a)
    .map(([ext, count]) => `  ${ext}: ${count} files`)
    .join('\n');

  const kindSummary = Object.entries(data.symbolsByKind)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `  ${kind}: ${count}`)
    .join('\n');

  return `You are a senior software architect. Analyze the following project statistics and write a concise "Project Overview" memory note in Markdown.

The note should cover:
1. What languages and frameworks are used
2. Scale of the project (files, symbols)
3. Top-level directory structure overview

Project name: ${data.name}
Total files: ${data.totalFiles}
Total symbols: ${data.totalSymbols}

Files by extension:
${extSummary}

Symbols by kind:
${kindSummary}

Directory structure (2 levels):
${data.directoryTree}

Write 2-4 paragraphs in Markdown. Be specific and technical. Do not use bullet lists for the main content.
Start directly with the content (no "---" frontmatter, no title heading).`;
}

function buildArchitecturePrompt(data: ProjectData): string {
  const annotations = data.topAnnotations.length > 0
    ? data.topAnnotations.map(a => `  - ${a}`).join('\n')
    : '  (none detected)';

  return `You are a senior software architect. Based on the following project data, infer and describe the architectural patterns used.

Look for patterns like:
- Hexagonal architecture (ports & adapters): look for annotations like @WebAdapter, @PersistenceAdapter, @UseCase
- Layered architecture: controller/service/repository layers
- Spring Boot: @RestController, @Service, @Repository, @Component, @Configuration
- Microservices: multiple bounded contexts, API gateways
- Domain-driven design: entities, aggregates, value objects

Project name: ${data.name}
Directory structure:
${data.directoryTree}

Top annotations found:
${annotations}

Symbol distribution:
${Object.entries(data.symbolsByKind).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

Write a concise architecture description in Markdown (2-3 paragraphs). Be specific about what patterns you observe vs. what you infer.
Start directly with the content (no frontmatter, no title heading).`;
}

function buildEntryPointsPrompt(data: ProjectData): string {
  return `You are a senior software engineer. Based on the following project structure, identify and describe the main entry points.

Entry points typically include:
- REST API controllers (classes with @RestController, @Controller)
- CLI main classes (classes named *Application, *Main, or with main() method)
- Configuration files (application.yml, application.properties, .codeatlas.yaml)
- Message consumers (Kafka listeners, event handlers)
- Scheduled tasks (@Scheduled annotations)

Project name: ${data.name}
Directory structure:
${data.directoryTree}

Top annotations:
${data.topAnnotations.map(a => `  - ${a}`).join('\n') || '  (none)'}

Symbol types available: ${Object.keys(data.symbolsByKind).join(', ')}

Write a concise "Entry Points" guide in Markdown. Use headers and code-style class name references.
Start directly with the content (no frontmatter, no title heading).`;
}

function buildConventionsPrompt(data: ProjectData): string {
  const extList = Object.keys(data.filesByExtension).join(', ');

  return `You are a senior software engineer. Based on the following project data, describe likely coding conventions and patterns.

Consider:
- Naming conventions (based on directory names and class/method naming patterns visible in the structure)
- Package/module organization strategy
- Annotation usage patterns (which Spring/framework annotations are prominent)
- Testing approach (presence of test directories)
- Build tool conventions (Maven, Gradle, npm, etc. — infer from directory names)

Project name: ${data.name}
File extensions: ${extList}
Directory structure:
${data.directoryTree}

Top annotations:
${data.topAnnotations.slice(0, 8).map(a => `  - ${a}`).join('\n') || '  (none)'}

Write a "Conventions" guide in Markdown (2-3 paragraphs). Focus on actionable conventions for a developer new to the project.
Start directly with the content (no frontmatter, no title heading).`;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate initial onboarding memories for a project.
 *
 * Skips if:
 * - Memories already exist in .codeatlas/memories/
 * - ANTHROPIC_API_KEY is not set (unless client is explicitly passed)
 *
 * @param projectRoot - Absolute path to the project root
 * @param data - Project statistics extracted from the DB
 * @param client - Anthropic client instance (optional; created from env if omitted)
 */
export async function generateOnboardingMemories(
  projectRoot: string,
  data: ProjectData,
  client?: Anthropic,
): Promise<OnboardingResult> {
  // Skip if memories already exist
  const existing = listMemories(projectRoot);
  if (existing.length > 0) {
    return { memoriesCreated: [], skipped: true, skipReason: 'memories already exist' };
  }

  // Check API key
  if (!client && !process.env['ANTHROPIC_API_KEY']) {
    return {
      memoriesCreated: [],
      skipped: true,
      skipReason: 'ANTHROPIC_API_KEY not set — set it to auto-generate project memories',
    };
  }

  // Lazy-import Anthropic to avoid import error when key not needed
  let anthropicClient = client;
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic();
  }

  const memoriesCreated: string[] = [];

  for (const spec of MEMORY_SPECS) {
    const prompt = spec.promptBuilder(data);
    let content: string;
    try {
      const response = await anthropicClient.messages.create({
        model: 'claude-haiku-4-5-20251001',   // fast, cheap for onboarding generation
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      content = textBlock?.text.trim() ?? '(no content generated)';
    } catch (err) {
      // Non-fatal: skip this memory on API error
      process.stderr.write(
        `  onboarding: skipped ${spec.slug} — ${(err as Error).message}\n`,
      );
      continue;
    }

    writeMemory(projectRoot, spec.slug, spec.title, content, spec.tags);
    memoriesCreated.push(spec.slug);
  }

  return { memoriesCreated, skipped: false };
}

// ─── ProjectData extractor helper ─────────────────────────────────────────────

/**
 * Extract ProjectData from a raw file list and DB query results.
 * Called from the CLI after indexProject() completes.
 */
export function buildProjectData(
  name: string,
  rootPath: string,
  files: { relative_path: string }[],
  symbolKindCounts: Record<string, number>,
  topAnnotations: string[],
): ProjectData {
  const filesByExtension: Record<string, number> = {};
  for (const f of files) {
    const dot = f.relative_path.lastIndexOf('.');
    const ext = dot >= 0 ? f.relative_path.slice(dot) : '';
    if (ext) filesByExtension[ext] = (filesByExtension[ext] ?? 0) + 1;
  }

  // Build 2-level directory tree
  const dirSet = new Set<string>();
  for (const f of files) {
    const parts = f.relative_path.split('/');
    if (parts.length >= 1) dirSet.add(parts[0]);
    if (parts.length >= 2) dirSet.add(`${parts[0]}/${parts[1]}`);
  }
  const sortedDirs = [...dirSet].sort();
  const directoryTree = sortedDirs.map(d => `  ${d}`).join('\n');

  const totalFiles = files.length;
  const totalSymbols = Object.values(symbolKindCounts).reduce((s, n) => s + n, 0);

  return {
    name,
    rootPath,
    filesByExtension,
    symbolsByKind: symbolKindCounts,
    topAnnotations,
    directoryTree,
    totalFiles,
    totalSymbols,
  };
}
