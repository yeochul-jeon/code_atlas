# Remote Sync — Graphiti 에피소드 포맷 스펙

CodeAtlas가 공용 지식 저장소(Graphiti + Neo4j)로 push하는 데이터의 포맷을 정의합니다.

---

## 개요

```
CodeAtlas (로컬)          Graphiti MCP           Neo4j (팀 공유)
     │                        │                       │
     │── add_episode ─────────▶│                       │
     │   group_id             │── 엔티티/엣지 추출 ──▶│
     │   name                 │   (Graphiti LLM)       │
     │   episode_body         │                       │
     │   source               │                       │
```

**핵심 규칙**: episode_body에 **소스 코드 원문 불포함**. LLM 생성 요약·메모리·구조적 메타데이터만 전송.

---

## group_id 포맷

```
{prefix}:{project_name}:{fingerprint[:8]}
```

| 필드 | 기본값 | 설명 |
|------|--------|------|
| `prefix` | `codeatlas` | `.codeatlas.yaml`의 `remote.group_id_prefix` |
| `project_name` | 인덱싱 시 지정한 이름 | `codeatlas index /path --name my-app` |
| `fingerprint[:8]` | git SHA 앞 8자 | git 없는 경우 파일 content_hash 롤업 sha256 |

**예시**: `codeatlas:my-app:a1b2c3d4`

같은 프로젝트라도 fingerprint가 다르면 별도 group_id → 버전 간 지식 격리.

---

## 에피소드 타입 1 — Memory

**출처**: `src/memory/store.ts` → `write_memory` MCP 호출 또는 `codeatlas memories onboard`

| 필드 | 값 |
|------|-----|
| `group_id` | `codeatlas:{project}:{fp8}` |
| `name` | `memory:{slug}` |
| `episode_body` | YAML frontmatter + 마크다운 본문 |
| `source` | `"text"` |
| `source_description` | `"CodeAtlas project memory — {project}"` |

**episode_body 예시**:

```
---
title: System Architecture
tags: [onboarding, architecture]
created_at: 2026-04-16T00:00:00.000Z
updated_at: 2026-04-16T01:00:00.000Z
---

# Architecture

Hexagonal architecture with Spring Boot. Domain layer is isolated from infrastructure.
```

**포함 정보**: 제목, 태그, 타임스탬프, 사람/AI 작성 지식 텍스트
**미포함**: 파일 내용, 심볼 코드, 내부 DB ID

---

## 에피소드 타입 2 — File Summary

**출처**: `src/summarizer/` → `get_file_summary` MCP 호출

| 필드 | 값 |
|------|-----|
| `group_id` | `codeatlas:{project}:{fp8}` |
| `name` | `summary:{relative_file_path}` |
| `episode_body` | LLM 생성 요약 + 파일 경로/모델/타임스탬프 |
| `source` | `"text"` |
| `source_description` | `"CodeAtlas AI file summary — {meta_json}"` |

**episode_body 예시**:

```
[CodeAtlas File Summary]
file: src/auth/AuthService.java
model: claude-sonnet-4-6
generated_at: 2026-04-16T00:00:00.000Z

This file implements JWT-based authentication. It provides methods for
token generation, validation, and refresh. Dependencies: UserRepository,
JwtProperties. Key entry points: authenticate(), refreshToken().
```

**포함 정보**: 상대 파일 경로, 모델명, 타임스탬프, LLM 생성 요약
**미포함**: 파일 원본 소스 코드

---

## 에피소드 타입 3 — Impact Analysis

**출처**: `src/graph/graph-store.ts` → `get_impact_analysis` MCP 호출

| 필드 | 값 |
|------|-----|
| `group_id` | `codeatlas:{project}:{fp8}` |
| `name` | `impact:{symbolName}@{fp8}` |
| `episode_body` | JSON: 심볼 정보 + 호출자 목록 (경로·라인·깊이) |
| `source` | `"json"` |
| `source_description` | `"CodeAtlas impact analysis — {symbol} ({kind}) in {project}"` |

**episode_body 예시**:

```json
{
  "symbol": "UserService.findById",
  "kind": "method",
  "project": "my-app",
  "fingerprint": "a1b2c3d4",
  "callers": [
    {
      "name": "OrderController.createOrder",
      "kind": "method",
      "file": "src/OrderController.java",
      "line": 45,
      "depth": 1
    },
    {
      "name": "PaymentService.processPayment",
      "kind": "method",
      "file": "src/PaymentService.java",
      "line": 78,
      "depth": 2
    }
  ]
}
```

**포함 정보**: 심볼 이름·종류, 파일 경로, 라인 번호, 호출 깊이
**미포함**: 함수 본문 코드, 내부 SQLite ID

---

## 구현 파일

| 파일 | 역할 |
|------|------|
| `src/remote/episode-serializer.ts` | 에피소드 직렬화 순수 함수 |
| `src/remote/__tests__/episode-serializer.test.ts` | 단위 테스트 (15개) |
| `src/remote/graphiti-client.ts` | Graphiti HTTP/MCP 호출 클라이언트 (Phase 2) |

---

## 설정 (`remote` 섹션)

```yaml
# .codeatlas.yaml
remote:
  enabled: false              # 기본 OFF — 명시적 옵트인 필요
  provider: graphiti
  endpoint: http://localhost:8000/mcp
  group_id_prefix: codeatlas
  push_on_generate: false     # true: 요약·온보딩 생성 시 자동 push (Phase 3)
  include:
    memories: true
    summaries: true
    impact_analyses: false    # 사이즈·빈도 이슈로 기본 OFF
  auth:
    type: none                # 사내 EKS: 'bearer'
    token_env: CODEATLAS_GRAPHITI_TOKEN
```

---

## 데이터 프라이버시

| 데이터 | 전송 여부 | 이유 |
|--------|-----------|------|
| 소스 코드 원문 | ❌ 절대 불가 | 기밀 코드 외부 누출 방지 |
| 파일 content_hash (sha256) | ❌ | 불필요 (fingerprint만 사용) |
| 내부 SQLite ID | ❌ | 의미 없는 내부 키 |
| LLM 생성 요약 | ✅ (옵트인) | 추상화된 표현 |
| 메모리 파일 내용 | ✅ (옵트인) | 사람이 쓴 지식 |
| 심볼 이름·경로·라인 | ✅ (옵트인) | 구조적 메타데이터 |

---

## 연관 문서

- [MCP 서버 & 도구](./mcp-server.md)
- [아키텍처 개요](./overview.md)
- [공용 지식 저장소 연동 가이드](../remote-sync-setup.md) — Phase 2 산출물
