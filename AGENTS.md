# AGENTS.md

Notes for an agent working in this repository.

## Read this first

1. **[VISION.md](./VISION.md)** — what the notation is for, what each operator
   is allowed to mean, and the seven corollaries that decide whether a change
   belongs. It is short on purpose. Read it before touching the language, and
   before arguing with a request: if a request breaks a corollary, say which one
   and why, instead of implementing it quietly.
2. **[SPEC.md](./SPEC.md)** — how the language is spelled today.
3. `README.md` — what the app is and how to run it.

When the vision and the code disagree, the vision wins. When the vision and the
operator table in `SPEC.md` disagree, one of them is stale: fix the one that is
wrong in the same change.

## The law, in one line

An operator does exactly one thing — and a marker with nothing to do falls back
to an ordinary line instead of picking up a second role.

That is why, for example, `>` is an accordion and nothing else, and a `>` with
nothing indented under it is a plain line rather than an annotation.

## Two implementations, one language

- `frontend/src/lang/parser.ts` is the reference: every rule in SPEC.md is
  implemented there first.
- `frontend/src/lang/render.ts` and `frontend/src/styles/app.css` present the
  parse result. Presentation may not add meaning (see corollary 7).
- `backend/internal/flow/analyze.go` mirrors the *counting* rules so the link
  preview card can be drawn server-side without a browser.
- `testdata/og/*.lg` documents are parsed by both, and their expected counts are
  asserted from both test suites. A language change that touches one side and
  not the other fails there, which is the point: change both, or change the
  fixtures and both sides together.

## Working here

- `make test` runs everything: frontend tests, the typecheck, `go vet` and the Go
  tests. `make build` typechecks, builds the site and builds the server.
  `make dev` runs the editor and the card server on :8080.
- Every language change lands with a test that fails before it and passes after.
  A parser change also needs a fixture document if the two implementations could
  drift apart over it.
- Match the file you are editing: comments explain *why*, not what; the docs use
  one idea per sentence; the Go side has no dependencies and should stay that
  way.
- Docs state the rule — what an operator does. A prohibition earns its place only
  when it carries the reason beside it; "never write X" on its own is a rule
  whose real content is missing.
- Leave committing to the operator unless they ask for it. When they do ask,
  commit in groups by kind of change, with each commit building and testing
  green on its own.

## When a request goes against the vision

Say so plainly, name the corollary it breaks, and offer the shape that keeps the
law intact. Most requests that look like they need a new operator are really
asking for one of these:

| the ask                                | the answer                                        |
| -------------------------------------- | ------------------------------------------------- |
| "a quieter line that comments on this"  | a `#` note — it hides until asked, and never joins |
| "a line that belongs to the one above"  | indent it: indentation is the hierarchy           |
| "a way to fold this group"              | a `>` line that opens with the group inside it    |
| "make the accordion more obvious"       | change the render, never the language             |
