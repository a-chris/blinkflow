# Blinkflow

*A light diagram language: the file is already most of the picture.*

Blinkflow is a text notation for flows — API paths, call stacks, user journeys —
where **indentation is the only geometry**. You write a spine of lines, add a
`>` for anything you want to expand later, and the renderer turns it into a
tree with collapsed detail and click-through source links.

```
GET v3/expenses
  gate: permission expenses.read
    yes:
      > Services::GetExpenses.call(user_id)   @app/services/get_expenses.rb:12
        - AR query builder clamps per_page, cursor is opaque
        > Database.where(user_id:, cursor:, limit:)
          SELECT * FROM expenses
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
| accordion | click a `>` line for SQL, notes, implementation detail | point at the interesting part |
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
| `> text` | accordion — the line is the element, the detail hides inside it (see below) |
| `@word` | actor, e.g. `@user`, `@cron` |
| `label: text` | arm — a labelled branch (see below) |
| `# text` | note attached to the line above — hover for a popup, click for a dialog |

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
because that belongs in an accordion body.

### Accordions

A line that starts with `>` is an **accordion**: the line itself is the element,
and its detail hides inside it.

```
> Database.where(user_id:)
  # p50 1.2ms, p99 6.1ms
  SELECT * FROM expenses
  WHERE user_id = $1
  LIMIT 25
```

The `>` line is the element and stays visible while it is closed. Everything
indented under it is its body, hidden until it is opened — a `#` line there is a
note on the accordion, anything else is raw text.

- A `>` is a **component wherever it is written**. Its indent decides where it
  sits in the tree, exactly like any other line: it can open a document, be the
  first child of a step, or be one more line in a sibling group. It never
  becomes an aside hanging off a shallower line.
- The line renders even when the accordion is closed, so a closed accordion
  still says what is inside.
- The line can carry its own source anchor (`> built by \`build_query\`
  @app/services/get_expenses.rb:34`). It renders as a link beside the toggle, so
  clicking it opens the file instead of expanding the accordion.
- The body is **raw text**: no parsing, no escaping. SQL, stack traces, prose,
  bullet lists, shell transcripts — anything.
- **An accordion is a leaf.** Its body is text, so a step that needs sub-steps
  stays a plain line and its own facts become `#` notes:

  ```
  - Payments::Charge.call(order)   @app/services/payments/charge.rb:9
    # the 10s timeout is deliberate
    > WebhookReconciler.schedule(order.id)
      the webhook is the source of truth, not this response
  ```

- A `>` with nothing under it has nothing to open: it is drawn as a plain line
  with the `>` marker, and counts as a step only.

Inside a body, `>` nests an accordion inside that body, and a body accordion with
no detail of its own is drawn as an annotation (`↳`).

### Writing one

The question the two line kinds answer: **does this line carry detail of its
own?** If it does, write `>` — the line is the accordion and the detail goes
inside. If it does not, write a plain line and let its children carry the
detail.

```
> Checkout::Place.call(cart_id, user)   @app/services/checkout/place.rb:14
  # one transaction, three writes, all or nothing
  - Order.create!(status: "pending")
  - Stock.reserve!(cart.items)
> Stripe::Charge.create(amount:, source:)   @lib/stripe/charge.rb:9
  # the only irreversible step
  - 900ms p99, 30s timeout, one retry
< 201 { id:, status: "confirmed" }
```

The accordion as a first child is the common case, and it is written the same
way — no sibling needed above it:

```
gate: authenticated
  yes:
    > Checkout::Place.call(cart_id, user)
      three writes, all or nothing
    < 201 { id:, status: "confirmed" }
```

**Accordions nest.** A `>` inside a body opens an accordion inside that body:

```
- Database.where(user_id:)
  > SELECT * FROM expenses
    WHERE user_id = $1
    LIMIT 25
    > keyset, not OFFSET
      OFFSET drifts when rows land mid-scan
```

Nested bodies stop where their indentation ends, and each body dedents to its
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

### Notes

```
- Database.where(user_id:)
  # p50 1.2ms on prod, p99 6.1ms — measured 2025-11

  > SELECT * FROM expenses
    # index scan + sort; 5ms at p99 when the cursor is cold
    WHERE user_id = $1
```

A note attaches to the nearest **component** above it at the same or a shallower
indent. A component is either a line or an accordion — an accordion is a parent
component like any other, so it carries a peek, an anchor, a body and notes.

The note renders as a small note chip in that component's row. Hovering shows
the text in a popup; clicking opens a dialog with the text and its source line.

Inside an accordion body the same rule applies: the note attaches to the
nearest component there, which is the enclosing accordion or a nested one. A
body line that should keep a literal leading `#` is written `\#`.

A `#` before any component has nothing to attach to, so it describes the
document and renders above the flow.

**Consecutive `#` lines are one note.** Write two lines and you get one icon and
one dialog holding both:

```
- Checkout::Place.call(cart, user)
  # 3 writes in one transaction
  # never call this outside a request
```

Blank lines and any other line end the note, so two comments separated by an
accordion or a step stay separate notes. A bare `#` inside a run of note lines is a
paragraph break: it becomes an empty line in the same note.

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
| error | tab indentation |
| hint | `->` legacy arrow; a `+` line (it is not a marker); a marker without a space (`-oops`); an arm label that reads like a sentence |

Errors never blank the diagram — the parsable part still renders, and the
status bar names the first offending line.

## Design rules that keep it light

1. **One idea per line.** A line is a step, an arm, or an accordion — never two.
2. **Prose lives inside the accordion.** The spine stays scannable; the reasoning
   goes one level down, in the body of the line it explains.
3. **Name the discriminator.** A branch either names its gate or names its
   worlds. Never both, never neither.
4. **Depth is meaning.** Accordions nest, but two levels is usually the whole story:
   what happened, then why. A third level is a signal that the diagram is doing
   a document's job.
5. **The file must read well unrendered.** That is why `-` stayed.

## Share links

The **share** button turns the current document into a URL and copies it. There
is no server and no storage: the document is *inside* the link.

```
http://localhost:5174/#c1.hVTRbts2FH33V5w1A5Z0siIpdoFqiNGsU…
```

The payload is `deflate-raw` compressed and base64url encoded, prefixed with a
version tag:

| payload | meaning |
|---|---|
| `c1.<base64url>` | compressed, version 1 |
| `p1.<base64url>` | plain UTF-8, version 1 — used when the browser has no `CompressionStream` |

It lives in the **fragment**, not the path, because a fragment is never sent to
the server, needs no rewrite rules to serve, and works on any static host. The
path form is still accepted, so `http://localhost:5174/c1.…` opens the same
document for links written by hand.

Editing after sharing drops the payload from the URL, so a reload can never
resurrect the snapshot you linked to.

## Playground

`npm install && npm run dev` → http://localhost:5174

Left pane is a CodeMirror editor with Blinkflow highlighting; right pane is the
live render. Panels are collapsed by default, the gutter is draggable, samples
and settings persist in `localStorage`.

## Layout

```
src/
  lang/parser.ts     text → tree, issues
  lang/render.ts     tree → DOM (accordions, anchors)
  lang/anchors.ts    path resolution + editor deep links
  lang/editor.ts     CodeMirror setup + highlighting
  samples/           three worked examples
  main.ts            playground wiring
  styles/app.css
```

`npm test` runs the parser, anchor-URL and render tests (38 of them, covering
the accordion behaviour and deep-link strings).
