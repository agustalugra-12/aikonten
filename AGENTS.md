<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## ENGINEERING AGENT RULES

For architectural, business-logic, agent, tool, database,
API, state-management, or cross-module changes:

1. Use Superpowers workflow when applicable.
2. Use Graphify to inspect code relationships.
3. Identify callers, callees, dependencies, and impact.
4. Read actual source code.
5. Make the smallest safe change.
6. Run relevant tests.
7. Perform regression verification.
8. Re-check affected components.
9. Review git diff.
10. Commit only when verification succeeds.

For trivial documentation or text changes,
full Graphify analysis is optional.

## CONTEXT OPTIMIZATION

Agent harus menggunakan progressive context:

### Level 1 — Always Available
- AGENTS.md
- Project instructions
- Architecture summary
- Current task
- Critical constraints

### Level 2 — Task Context
- Relevant files
- Graphify results
- Relevant tests
- Relevant errors

### Level 3 — Expanded Context (hanya jika diperlukan)
- Related modules
- Historical implementation
- Documentation
- Additional tests

### Level 4 — Full Repository (hanya jika benar-benar diperlukan)

**Rule:** Sebelum membaca banyak file, gunakan Graphify untuk narrowing.
Jangan read entire repository tanpa reason.

## DETERMINISTIC VERIFICATION

Jangan menyerahkan semua keputusan kepada LLM.
Untuk operasi yang dapat dibuat deterministic, gunakan code.

Verification gates sebelum commit:
1. Implementation — kode berubah sesuai requirement
2. Tests — test relevan berhasil
3. Regression — tidak ada regression
4. Impact — affected components sudah diperiksa
5. Git — diff sesuai scope
6. Safety — tidak ada perubahan production berisiko

## SELF-RECOVERY

Agent boleh melakukan loop perbaikan ketika test gagal.
MAX_RETRY = 3. Jika retry melebihi batas, STOP dan report.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
