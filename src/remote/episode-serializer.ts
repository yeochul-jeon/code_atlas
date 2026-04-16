/**
 * Episode Serializer — CodeAtlas 파생 데이터를 Graphiti add_episode 페이로드로 변환
 *
 * 순수 함수 모음. I/O 없음, 외부 의존 없음.
 * 소스 코드 원문은 절대 포함되지 않음 — LLM 생성 요약·메모리·관계 메타데이터만.
 *
 * Graphiti add_episode API:
 *   group_id        — 프로젝트×버전 격리 식별자 (예: "codeatlas:my-app:a1b2c3d4")
 *   name            — 에피소드 내 고유 식별자
 *   episode_body    — Graphiti LLM이 엔티티·엣지를 추출하는 원문 텍스트
 *   source          — 'text' | 'json' | 'message'
 *   source_description — 출처 설명 (optional)
 */

import type { Memory } from '../memory/store.js';
import type { Summary } from '../storage/queries.js';
import type { ImpactResult } from '../graph/graph-store.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EpisodeSource = 'text' | 'json' | 'message';

export interface GraphitiEpisode {
  group_id: string;
  name: string;
  episode_body: string;
  source: EpisodeSource;
  source_description?: string;
}

// ─── group_id helper ──────────────────────────────────────────────────────────

/**
 * group_id 포맷: "{prefix}:{projectName}:{fingerprint 앞 8자}"
 * 같은 프로젝트라도 fingerprint가 다르면 별도 group_id → 버전 격리
 */
export function buildGroupId(
  projectName: string,
  fingerprint: string,
  prefix = 'codeatlas'
): string {
  const fp8 = fingerprint.slice(0, 8);
  return `${prefix}:${projectName}:${fp8}`;
}

// ─── Memory → Episode ─────────────────────────────────────────────────────────

export interface MemoryEpisodeParams {
  memory: Memory;
  projectName: string;
  fingerprint: string;
  groupIdPrefix?: string;
}

/**
 * Memory 파일 → Graphiti episode
 * episode_body: frontmatter(YAML) + 본문 마크다운
 * 이미 사람·AI가 작성한 추상화된 지식이므로 원문 누출 없음.
 */
export function memoryToEpisode(params: MemoryEpisodeParams): GraphitiEpisode {
  const { memory, projectName, fingerprint, groupIdPrefix } = params;
  const group_id = buildGroupId(projectName, fingerprint, groupIdPrefix);

  const frontmatter = [
    `title: ${memory.title}`,
    `tags: [${memory.tags.join(', ')}]`,
    `created_at: ${memory.created_at}`,
    `updated_at: ${memory.updated_at}`,
  ].join('\n');

  const episode_body = `---\n${frontmatter}\n---\n\n${memory.content}`;

  return {
    group_id,
    name: `memory:${memory.slug}`,
    episode_body,
    source: 'text',
    source_description: `CodeAtlas project memory — ${projectName}`,
  };
}

// ─── Summary → Episode ────────────────────────────────────────────────────────

export interface SummaryEpisodeParams {
  summary: Summary;
  filePath: string;        // relative path (소스 코드 경로, 내용 아님)
  projectName: string;
  fingerprint: string;
  groupIdPrefix?: string;
}

/**
 * File summary → Graphiti episode
 * episode_body: LLM이 생성한 요약 텍스트 + 메타데이터 (소스 코드 원문 X)
 */
export function summaryToEpisode(params: SummaryEpisodeParams): GraphitiEpisode {
  const { summary, filePath, projectName, fingerprint, groupIdPrefix } = params;
  const group_id = buildGroupId(projectName, fingerprint, groupIdPrefix);

  const meta = JSON.stringify({
    file: filePath,
    model: summary.model_version,
    generated_at: summary.generated_at,
  });

  const episode_body = `[CodeAtlas File Summary]\nfile: ${filePath}\nmodel: ${summary.model_version}\ngenerated_at: ${summary.generated_at}\n\n${summary.content}`;

  return {
    group_id,
    name: `summary:${filePath}`,
    episode_body,
    source: 'text',
    source_description: `CodeAtlas AI file summary — ${meta}`,
  };
}

// ─── Impact Analysis → Episode ────────────────────────────────────────────────

export interface ImpactEpisodeParams {
  symbolName: string;
  symbolKind: string;
  callers: ImpactResult[];
  projectName: string;
  fingerprint: string;
  groupIdPrefix?: string;
}

/**
 * Impact analysis 결과 → Graphiti episode
 * episode_body: JSON 직렬화된 호출자 목록 + 깊이 (소스 코드 내용 X)
 * 심볼 이름·경로·라인만 포함 — 구조적 메타데이터.
 */
export function impactToEpisode(params: ImpactEpisodeParams): GraphitiEpisode {
  const { symbolName, symbolKind, callers, projectName, fingerprint, groupIdPrefix } = params;
  const group_id = buildGroupId(projectName, fingerprint, groupIdPrefix);

  const payload = {
    symbol: symbolName,
    kind: symbolKind,
    project: projectName,
    fingerprint: fingerprint.slice(0, 8),
    callers: callers.map(c => ({
      name: c.name,
      kind: c.kind,
      file: c.filePath,
      line: c.startLine,
      depth: c.depth,
    })),
  };

  return {
    group_id,
    name: `impact:${symbolName}@${fingerprint.slice(0, 8)}`,
    episode_body: JSON.stringify(payload, null, 2),
    source: 'json',
    source_description: `CodeAtlas impact analysis — ${symbolName} (${symbolKind}) in ${projectName}`,
  };
}
