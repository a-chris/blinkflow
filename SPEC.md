# lightgram

*A light diagram language: the file is already most of the picture.*

lightgram is a text notation for flows — API paths, call stacks, user journeys —
where **indentation is the only geometry**. You write a spine of lines, add a
`>` for anything you want to expand later, and the renderer turns it into a
tree with collapsed detail panels and click-through source links.

```
GET v3/expenses
  gate: permission expenses.read
    yes:
      - Services::GetExpenses.call(user_id)   @app/services/get_expenses.rb:12
        > AR query builder — clamps per_page, opaque cursor
        - Database.where(user_id:, cursor:, limit:)
          > SELECT * FROM expenses
            WHERE user_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 25
    no:
      - 403 { error: "forbidden" }
```

Three zoom levels, which is the whole point:

| level | what you see | when |
|---|---|---|
| spine | indentation + markers | grasp the flow |
| panel | click the `>` badge for SQL, notes, implementation detail | point at the interesting part |
| source | click `expenses.rb:12` → opens your editor at that line | read the real code |

## Grammar

One node per line. Leading spaces define hierarchy. Tabs are an error.

### Flow markers

| syntax | node |
|---|---|
| `- text` | step |
| `text` | step too — an entry point needs no dash |
| `! text` | failure / raises |
| `~ text` | async, spawned, fire-and-forget |
| `< text` | returns to caller |
| `> text` | panel attached to the line above (see below) |
| `@word` | actor, e.g. `@user`, `@cron` |
| `label: text` | arm — a labelled branch (see below) |
| `# …` | comment, not rendered |

`-> ` is accepted as an alias for `- ` for muscle memory, with a one-time hint.

### Arms — five reserved words

| word | meaning |
|---|---|
| `gate:` | condition required to enter; its children are the branches |
| `yes:` | arm taken when the gate is true |
| `no:` | arm taken when the gate is false |
| `else:` | catch-all, last arm |
| `err:` | typed failure arm — `err: CardDeclined` |

Everything else that ends in `:` is a **free-form arm**. Its meaning comes from
context, not from a keyword table:

| position | meaning |
|---|---|
| arm under a `gate:` | value matched against the predicate (`draft:`) |
| arm with no enclosing gate | **path split** — alternate worlds (`new user:`) |
| arm after a failing step | error arm |

Labels are short identifiers, not prose: letters, digits, spaces, hyphens.
`new user:` is fine; a label of more than four words is flagged as a hint,
because that belongs in a panel.

### Panels

```
- Database.where(user_id:)
  > SELECT * FROM expenses          ← the peek line, visible while collapsed
    WHERE user_id = $1              ← the body, indented deeper
    LIMIT 25
```

- The peek line is rendered even when the panel is closed, so a closed panel
  still tells you what is inside.
- A panel attaches to the **nearest line above it at the same or a shallower
  indent** — the sibling above, not a distant ancestor. Panels and child nodes
  therefore render in exactly the order they were written.
- A peek line can carry its own source anchor (`> built by \`build_query\`
  @app/services/get_expenses.rb:34`). It renders as a link beside the toggle,
  so clicking it opens the file instead of expanding the panel.
- The body is **raw text**: no parsing, no escaping. SQL, stack traces, prose,
  bullet lists — anything.
- A `>` with no indented body under it is rendered as an annotation (`↳`), not
  as an accordion, because it has nothing to open.

**Panels nest.** A `>` inside a body opens a panel inside that panel:

```
- Database.where(user_id:)
  > SELECT * FROM expenses
    WHERE user_id = $1
    LIMIT 25
    > keyset, not OFFSET
      OFFSET drifts when rows land mid-scan
```

Nested bodies stop where their indentation ends, and each panel dedents to its
own margin, so a nested body lines up under its own opener. Depth is unlimited;
in practice two levels is where a diagram stops being scannable.

The cost of nesting: a body line whose first non-space character is `>` is
structure, not text. Write `\>` for a literal one:

```
  > shell transcript
    $ ls
    \> this line really starts with a greater-than
```

`-` keeps its double life intact — a step in the spine, a bullet inside a body —
because only `>` changed meaning inside bodies.

### Source anchors

A trailing `@path[:line[:col]]` turns a node into a link:

```
- Payments::Charge.call(order)   @app/services/payments/charge.rb:9
```

- The path must look like a path (contain `/` or `.`), so `@user` stays an actor.
- The playground resolves it against the **base** directory and opens it with
  the selected editor: `vscode://file/…:line:col`, `cursor://…`, `zed://…`,
  `subl://open?url=…`, or plain `file://`.

### Issues

| severity | when |
|---|---|
| error | a `>` with no node above it; tab indentation |
| hint | `->` legacy arrow; a marker without a space (`-oops`); an arm label that reads like a sentence |

Errors never blank the diagram — the parsable part still renders, and the
status bar names the first offending line.

## Design rules that keep it light

1. **One idea per line.** A line is a step, an arm, or a panel — never two.
2. **Prose lives in panels.** The spine stays scannable; the reasoning goes one
   level down.
3. **Name the discriminator.** A branch either names its gate or names its
   worlds. Never both, never neither.
4. **Depth is meaning.** Panels nest, but two levels is usually the whole story:
   what happened, then why. A third level is a signal that the diagram is doing
   a document's job.
5. **The file must read well unrendered.** That is why `-` stayed.

## Playground

`npm install && npm run dev` → http://localhost:5174

Left pane is a CodeMirror editor with lightgram highlighting; right pane is the
live render. Panels are collapsed by default, the gutter is draggable, samples
and settings persist in `localStorage`.

## Layout

```
src/
  lang/parser.ts     text → tree, issues
  lang/render.ts     tree → DOM (panels, anchors)
  lang/anchors.ts    path resolution + editor deep links
  lang/editor.ts     CodeMirror setup + highlighting
  samples/           three worked examples
  main.ts            playground wiring
  styles/app.css
```

`npm test` runs the parser, anchor-URL and render tests (38 of them, covering
the accordion behaviour and deep-link strings).
