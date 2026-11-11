# The vision

Blinkflow is a text notation for flows, and a renderer for it.

This file is the part that does not change when the code does: what the notation
is for, what an operator is allowed to mean, and the rules that decide whether a
new idea belongs in the language.

When this file and the code disagree, this file is right and the code is a bug.
[SPEC.md](./SPEC.md) is how the language is spelled; this is why.

## What it is for

A flow is hard to hold in your head because it has several true versions at
once: the shape, the few parts that matter, and the code under each part.
Most notations pick one of those and drop the others, so the reader has to ask
for the rest — and the answer arrives as another thread, another diagram,
another scroll position.

Blinkflow keeps them in one document, nested, and lets the reader pick the
depth: the flow reads top to bottom at any level of detail, and every line that
carries detail is closed until the reader wants it.

The audience is a person and an agent reading the same file. That is why it is
text: it survives a paste, a diff, a code review and a prompt, and it costs
nothing to write.

## One operator, one job

The law under everything else: **an operator does exactly one thing.**

| written             | its one job                                   |
| ------------------- | --------------------------------------------- |
| indentation         | the tree — where a line sits                  |
| `-`                 | a step                                        |
| `!`                 | a failure                                     |
| `~`                 | an asynchronous line                          |
| `<`                 | a return                                      |
| `>`                 | opens an accordion                            |
| `#`                 | a note on the component above                 |
| `@path:line`        | a pointer into the source                     |
| `label:`            | an arm — a branch, a gate, a value match      |
| `\`                 | escapes the one character after it            |

That is the whole language. Reading a document means knowing this table and
nothing else, and the table stays short on purpose.

**Corollaries.** These follow from the law, and they are what to check a change
against:

1. **A marker with nothing to do falls back to an ordinary line.** It never
   picks up a second role to stay visible. A `>` with nothing indented under it
   is a plain line, drawn like any other line — it does not become a subtitle,
   an aside, or a smaller kind of text.
2. **A line never decorates another line.** Every line is a node of the flow and
   stands on its own; nothing is a comment *on* the line above it. Commentary
   that should not take part in the flow is a note, which hides until asked for
   and never joins the tree.
3. **Indentation is the only hierarchy.** There is no other way to say "this
   belongs to that": no parenthetical, no nesting syntax, no line that reaches
   back up. Move a line's indentation and you move it in the tree, and nothing
   else about it changes.
4. **The line is the element.** An accordion is the line itself — its place in
   the tree is its own indent, and its detail hides inside it. There is no
   spelling where a line is the *label* of a box drawn underneath it.
5. **The same marker means the same thing at every depth.** `-` and `>` do not
   change jobs because they are inside a body. A notation that means one thing
   at the top and another when nested needs a second table, and a second table
   is how a language starts requiring documentation instead of reading.
6. **Nothing invisible.** Every line the render shows was written, and every
   line written either shows or is inside something that shows. No line is
   inferred, and no line is silently dropped.
7. **The render presents; it never means.** Colour, spacing, weight and the
   accordion's tile are free choices — they may make a thing loud or quiet. A
   visual treatment that lets a line read as something it is not written as is a
   meaning smuggled through CSS, and it is a bug.

## What the language refuses

Not every good idea is an operator. These are deliberate refusals, with the rule
each one breaks — so that the next time one of them looks attractive, the
argument starts from here instead of from scratch.

- **An annotation line — a visible subtitle under a line.** The most tempting
  one, because prose always wants to comment on the line above. It breaks rule 2
  (a line would decorate another line) and it is exactly the second job `>` used
  to have. If it ever ships it is its own operator, and it must not compete with
  the accordion for a glyph. Until then, that job belongs to notes, and to plain
  prose lines that stand in the flow as the content they are.
- **Inline emphasis** — bold, italic, links inside a line. The render is not
  Markdown, and a line's job is to say one thing, not to typeset it.
- **A table, a diagram, a badge.** A flow is lines. If a document needs a table,
  it needs a different document.
- **Front matter, ids, cross-references.** The tree is the only structure. Names
  for nodes would be a second hierarchy to keep in sync with the indentation.
- **Highlighting rules inside an accordion body.** A body is raw text on
  purpose: SQL, stack traces, shell transcripts and prose all belong there
  already. Giving one of them a syntax would rank the others.
- **A second collapse operator.** `>` is the only one. `+`, `^`, `v` and friends
  were tried in discussion and every one of them either duplicated `>` or made
  the first child of a step unrepresentable.

## Adding to the language

An operator is expensive: it is a word every reader must learn and every
implementation must mirror. The bar is a job that cannot be done by plain text.

1. Write the job as one sentence. If the sentence needs an "and", it is two
   operators, or it is not an operator.
2. Show it cannot be written today. Reaching for the same glyph twice, or for a
   reserved label like `gate:`, means the language already has a slot.
3. Check the seven corollaries above, one by one. A change that breaks rule 6 is
   not a feature.
4. This file first, then SPEC.md, then both implementations, then the fixtures.
   A rule that only lives in code is a rule that will be broken.
5. Prefer deleting to adding. Two thirds of the ideas that reach this point are
   better served by a note, a plain line, or a smaller accordion.

## Where this lives in the code

- `frontend/src/lang/parser.ts` — the reference implementation of this file.
- `frontend/src/lang/render.ts`, `styles/app.css` — presentation only.
- `backend/internal/flow` — the server's card, mirroring the counting rules, kept
  honest against the same fixtures in `testdata/og`.

Both implementations exist because the same document is read on the page and in
a link preview, and the two must never disagree about what a line is.
