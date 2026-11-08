# Blinkflow

**Understand flows with the blink of an eye.** → [blinkflow.live](https://blinkflow.live)

A tiny text notation for flows — with collapsible detail panels and click-through source anchors.
Written as plain text, rendered as a tree.

You have been here.
You ask an AI how something works, and it starts at the implementation details.
You stop it, ask for the high level, and eventually you understand the shape — but not the parts that actually matter: who is allowed to see this data, what happens when it fails, which service is called here.
Fifteen questions later your head is full and you are scrolling back through the thread to piece the answer together.

Blinkflow exists so that does not happen.
It gives an AI a standard way to explain a flow, and gives you the flow itself — start at the concept, open the details only where you care about them.

```bash
make install    # once, on a fresh clone: frontend deps from the lockfile
make dev        # editor + card server on http://localhost:8080
make test       # TypeScript and Go suites
make build      # typecheck, build the site, build the server
```

`make dev` installs the frontend dependencies itself if `frontend/node_modules` is missing, so a fresh clone works with either command order.
Node 20+ and Go 1.24+ are all it needs; the server has no dependencies of its own.

The language itself is documented in [SPEC.md](./SPEC.md).

Short version:

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
- `>` collapsed detail panel rendered as a badge carrying its own `>`; the peek line stays visible, the body opens on click (a `>` inside a body opens a nested panel)
- `gate:` / `yes:` / `no:` / `else:` / `err:` are reserved; any other `label:` is a free-form arm (a value match under a gate, a path split without one)
- trailing `@path:line` opens that file in your editor
- `# note` attaches to the component above — a line or an accordion — as a note chip: hover for a popup, click for a dialog; consecutive `#` lines are one note
- indentation is the tree; panels nest, and `\>` escapes a literal `>` inside a body

## Playground

| pane | |
|---|---|
| left | CodeMirror editor with Blinkflow highlighting |
| right | live diagram — click the `>` badge for detail, `↗` to jump to source |

Toolbar: **sample** (three worked examples), **open in** (VS Code, Cursor, Zed, Sublime, `file://`), **base** (the directory anchors are resolved against), **expand all** / **collapse all**, and **share** (see below).

**Tab** indents the current line or every selected line by one level (2 spaces), **Shift-Tab** outdents.
Indentation is inserted as spaces, never a literal tab, because the parser rejects tabs — depth is the structure, so the two must agree.

Anchors are relative to *base*, which starts empty.
Point it at a repo root and `@app/models/x.rb:41` opens `<base>/app/models/x.rb` at line 41.
Until you set it, clicking an anchor asks for the base instead of opening a wrong path.

## Share links

The document travels inside the URL: deflate-compressed, base64url-encoded, and version-prefixed (`c1.…`, or `p1.…` for browsers without `CompressionStream`).
There is no database and no account, so a link never expires and never depends on uptime.

**share** opens a dialog with two carriers for the same payload:

| option | link | good for |
|---|---|---|
| **simple share** | `…/#c1.…` | humans — chat, email, a ticket |
| **embedded share** | `…/c1.…` | documentation and reference — an address a page can answer for |

Embedded links are the ones that can unfurl.
A preview needs metadata a crawler can read without running JavaScript, so `backend/` decodes the payload, counts the document, and answers with the app shell whose `<head>` describes *that* document.
The browser then decodes the same payload again and draws it.

```
curl -A "Slackbot" http://localhost:8080/c1.…
  <title>POST v3/checkout — call stack — Blinkflow</title>
  <meta property="og:title" content="POST v3/checkout — call stack" />
  <meta property="og:description" content="15 steps · 2 arms · 5 panels · 3 notes" />
```

What the server is not: it stores nothing, logs no payload (requests are logged as `c1.<redacted> (769 chars)`), has no endpoints that accept writes, and is never on the path of *reading* a link.
Kill it and every link still opens; only the card falls back to a generic title.

### Running it

`make dev` is the whole development setup.
Deployed, the same binary serves the built site:

| flag | default | |
|---|---|---|
| `-addr` | `127.0.0.1` | loopback; set deliberately when it faces a network |
| `-port` | `8080` | |
| `-static` | `../frontend/dist` | the built site, served with an SPA fallback |
| `-public-origin` | — | `https://blinkflow.example.com`; the origin every generated URL claims |
| `-trust-proxy` | off | believe `X-Forwarded-Proto`/`-Host` — only behind a proxy you control |
| `-max-payload` | `64 KiB` | largest decoded document |

Set `-public-origin` in any deployment: it makes canonical URLs and embedded links independent of whatever headers a request arrives with.
Without it the server uses the request's own `Host`, and ignores forwarded headers unless `-trust-proxy` says otherwise — a client must not be able to choose the origin a page claims.

### Local configuration

A tunnel hostname or a public origin is nobody else's business, so it lives in `frontend/.env.local` (gitignored; see `.env.example`):

| variable | |
|---|---|
| `BLINKFLOW_ALLOWED_HOSTS` | extra dev-server hostnames, comma separated |
| `BLINKFLOW_SERVER_ORIGIN` | where embedded links should point |
| `BLINKFLOW_SERVER_PORT` | the card server's port, when it is not 8080 |

## Structure

```
frontend/              the app: everything that runs in a browser
  src/lang/parser.ts   text → tree (+ issues)
  src/lang/render.ts   tree → DOM (panels, anchors)
  src/lang/share.ts    payload encode/decode, both link carriers
  src/lang/anchors.ts  path resolution, editor deep links
  src/lang/editor.ts   CodeMirror theme + tokenizer
  src/samples/         three examples
  src/main.ts          playground wiring
backend/               the card server (Go, standard library only)
  internal/share/      payload decode, size-capped, version-checked
  internal/flow/       counts and first note/gate, mirroring the parser
  internal/og/         the card rules
  internal/web/        routing: payload pages, dev proxy, static files
testdata/og/           fixtures both languages assert against
Makefile               dev, test, build
```

No framework: the renderer builds DOM directly, which keeps the language portable if you later want a CLI, a markdown plugin, or a static-site renderer.

**`make dev`** runs Vite on 5174 and the card server on 8080, and the server proxies everything that is not a payload to Vite — so there is one origin to open, and hot reload still works through the proxy.

The counting rules exist twice: once in the TypeScript parser, once in Go.
`testdata/og` is the contract — the same `.lg` fixtures and the same expected `.json` values are asserted by `frontend/src/lang/preview.test.ts` and `backend/internal/flow`, so the two cannot drift without a test failing.
The expected values were generated from the parser (the reference) and then fixed.

## Licence

[Elastic License 2.0](./LICENSE).
Use it, self-host it, modify it, build on it — hosting it for third parties as a managed service is the one thing reserved for the project.
The Blinkflow name and marks are not covered by the licence, and this is not an OSI open-source licence.
