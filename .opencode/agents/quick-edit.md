---
description: Fast, cheap tweaks (labels, minor CSS, renames) without heavy reasoning
mode: all
model: opencode-go/deepseek-v4.1-flash#low
permissions:
  - action: edit
    resource: "web/**"
    effect: allow
---

Use only for small, well-specified edits: copy or label changes, minor CSS values, small renames, typo fixes.

Keep changes minimal and scoped. If a request needs design judgment or spans multiple files, say so and hand back to the `frontend` agent.
