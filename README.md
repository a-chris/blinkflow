# lightgram

A tiny text notation for flows — with collapsible detail panels and click-through
source anchors. Written as plain text, rendered as a tree.

```bash
npm install
npm run dev     # http://localhost:5174
npm test        # parser + render + anchor tests
npm run build   # typecheck + production build
```

The language itself is documented in [SPEC.md](./SPEC.md). Short version:

```
GET v3/expenses
  gate: permission expenses.read
    yes:
      - Services::GetExpenses.call(user_id)   @app/services/get_expenses.rb:12
        > AR query builder — clamps per_page, opaque cursor
        - Database.where(user_id:, cursor:, limit:)
          > SELECT * FROM expenses
            WHERE user_id = $1
    no:
      - 403 { error: "forbidden" }
```

- `-` step, `!` failure, `~` async, `<` return
- `>` collapsed detail panel rendered as a badge carrying its own `>`; the peek line stays visible, the body opens on click
  (a `>` inside a body opens a nested panel)
- `gate:` / `yes:` / `no:` / `else:` / `err:` are reserved; any other
  `label:` is a free-form arm (a value match under a gate, a path split without one)
- trailing `@path:line` opens that file in your editor
- indentation is the tree; panels nest, and `\>` escapes a literal `>` inside a body

## Playground

| pane | |
|---|---|
| left | CodeMirror editor with lightgram highlighting |
| right | live diagram — click the `>` badge for detail, `↗` to jump to source |

Toolbar: **sample** (three worked examples), **open in** (VS Code, Cursor, Zed,
Sublime, `file://`), **base** (the directory anchors are resolved against),
**expand all** / **collapse all**.

Anchors are relative to *base*, which starts empty. Point it at a repo root and
`@app/models/x.rb:41` opens `<base>/app/models/x.rb` at line 41. Until you set it,
clicking an anchor asks for the base instead of opening a wrong path.

## Why it looks like this

Mermaid and friends store a graph and let a layout engine decide the picture, so
the source stops being readable. Here the source *is* the picture at 80% zoom:
indentation is the tree, so the renderer is a style pass, not a layout engine.
That is what keeps the notation small enough to type straight into a PR
description or a ticket.

## Structure

```
src/lang/parser.ts   text → tree (+ issues)
src/lang/render.ts   tree → DOM (panels, anchors)
src/lang/anchors.ts  path resolution, editor deep links
src/lang/editor.ts   CodeMirror theme + tokenizer
src/samples/         three examples
src/main.ts          playground wiring
```

No framework: the renderer builds DOM directly, which keeps the language
portable if you later want a CLI, a markdown plugin, or a static-site renderer.
