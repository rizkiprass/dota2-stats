# Dota Stats Brain — Wiki Maintainer Contract

This vault is a persistent, source-grounded wiki for the Dota 2 replay statistics project in the parent repository. The human curates sources and steers analysis; the LLM maintains the wiki.

## Layers

- `raw/` contains immutable copies or captures of source material added specifically to the vault. Never edit source files after capture. Existing repository documents may be cited directly by relative path and need not be copied.
- `wiki/` contains maintained summaries, concepts, decisions, and synthesis. Markdown only; use Obsidian wikilinks for links between wiki pages.
- `index.md` is the page catalog; `log.md` is an append-only activity record.

## Grounding and provenance

- Distinguish documented facts, interpretations, and open questions. Never present an inference as a fact.
- Cite every material technical claim with a relative source link and, where practical, section heading or line range. For code claims, cite the path and symbol.
- Preserve disagreements: record both claims and their sources, with dates/versions, rather than silently choosing one.
- Do not invent project behavior, deployment state, user preferences, or external facts. Mark unknowns as `Unknown` or `Needs verification`.
- Raw sources are immutable. Wiki pages may evolve as new evidence arrives; update their `updated` metadata and explain meaningful corrections in the log.

## Page format

Use YAML frontmatter:

```yaml
---
type: concept | system | decision | source-note | synthesis
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: []
tags: []
---
```

Use descriptive kebab-case filenames. Add a short summary near the top, link related wiki pages, and cite sources inline as `[label](../path/to/source.md)` (or `[[wiki-page]]` for wiki pages). Avoid duplicating long source passages.

## Workflows

### Ingest a source

1. Identify the actual source and preserve it in `raw/` only if it is not already stored in the repository. Never move or modify an existing project file.
2. Read the full source; discuss key takeaways with the user when ingestion is interactive.
3. Create/update the relevant source note, concepts, system pages, and synthesis. Include provenance, uncertainty, and contradictions.
4. Update `index.md`, then append one dated entry to `log.md`.

### Query

Read `index.md` first, then the relevant pages and cited sources. Answer with citations and clearly separate evidence from synthesis. Only file a durable answer as a wiki page when it adds reusable knowledge; then update the index and log.

### Lint

Check links, citations, index coverage, orphan pages, stale claims, contradiction handling, missing concepts, and metadata. Do not “fix” uncertain claims by guessing. Record the audit and suggested follow-up sources/questions in `log.md`.

## Initial project boundary

The current wiki covers the Dota 2 replay statistics project and its implementation. It is not a personal-life wiki. Do not ingest private data or unrelated material here unless the user explicitly asks to broaden the scope.
