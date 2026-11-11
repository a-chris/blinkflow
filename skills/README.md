# Skills

Instructions for AI agents, served from this folder at `/skills/` (`-skills` / `BLINKFLOW_SKILLS`). The folder is the endpoint: no build step, no copy.

| skill | fetch |
|---|---|
| explain-code-flow — reads code, draws the flow, returns a link | https://blinkflow.live/skills/explain-code-flow/SKILL.md |

## Install

`SKILL.md` is the whole skill; `reference/` and `examples/` stay on the server, linked from the SKILL. Drop the file in the generic skills folder:

```sh
mkdir -p ~/.agents/skills/explain-code-flow
curl -fsSL https://blinkflow.live/skills/explain-code-flow/SKILL.md \
  -o ~/.agents/skills/explain-code-flow/SKILL.md
```

## Rules for a new skill

- One deliverable. `explain-code-flow` returns a link and nothing else.
- `SKILL.md` order: frontmatter, task, numbered procedure, one worked example, verification, hard limits, references.
- Every verification step is external: a command, an exit code, a JSON key. No "review your answer".
- Keep the writing rules in `explain-code-flow/reference/` and link them. Do not repeat them per skill.
- Examples rot. `frontend/src/lang/skills.test.ts` parses every `examples/*.lg` and re-derives the counts quoted in the markdown, so a stale number fails CI.
