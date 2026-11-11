# Blinkflow

**Understand flows with the blink of an eye.** → [blinkflow.live](https://blinkflow.live)

A tiny text notation for flows — every line that carries detail is an accordion, with click-through source anchors.
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
- `>` an accordion line: the line is the element and its detail hides inside it — first child, sibling or block of its own; the body opens on click (a `>` inside a body nests)
- `gate:` / `yes:` / `no:` / `else:` / `err:` are reserved; any other `label:` is a free-form arm (a value match under a gate, a path split without one)
- trailing `@path:line` opens that file in your editor
- `# note` attaches to the component above — a line or an accordion — as a note chip: hover for a popup, click for a dialog; consecutive `#` lines are one note
- indentation is the tree; accordions nest, and `\>` escapes a literal `>` inside a body

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
  <meta property="og:description" content="15 steps · 1 arms · 4 panels · 3 notes" />
```

What the server is not: it stores nothing, logs no document (requests are logged as `c1.<redacted> (769 chars)`), has exactly one endpoint that accepts a body — `POST /share`, which also stores nothing — and is never on the path of *reading* a link.
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

### Container

`make image` builds the same three-stage image CI publishes.
Node compiles the site, Go cross-compiles the server, and the runtime layer carries only the binary and the built assets in a distroless image — no shell, no toolchain, no sources.
The server serves those assets itself, so a container is one process on one port.

```bash
make image-run                       # build, then serve on :8080
docker run -p 8080:8080 -e BLINKFLOW_PUBLIC_ORIGIN=https://blinkflow.live ghcr.io/a-chris/blinkflow:latest
```

Two tags are published, and the rule is the whole convention: a push to the default branch publishes `latest`, and a pushed tag publishes that tag verbatim.
Releasing a version therefore never moves `latest` under someone who pulled yesterday.

```bash
git tag v0.2.0
git push origin v0.2.0               # ghcr.io/a-chris/blinkflow:v0.2.0
```

Every deployment flag also reads an environment variable, because a compose file or an image cannot pass arguments; a flag still wins when it is given.
The image sets the two a container needs: `BLINKFLOW_ADDR=0.0.0.0` and `BLINKFLOW_STATIC=/app/dist`.

| variable | overrides |
|---|---|
| `BLINKFLOW_ADDR` | `-addr` |
| `BLINKFLOW_PORT` | `-port` |
| `BLINKFLOW_STATIC` | `-static` |
| `BLINKFLOW_PUBLIC_ORIGIN` | `-public-origin` |
| `BLINKFLOW_TRUST_PROXY` | `-trust-proxy` |
| `BLINKFLOW_MAX_PAYLOAD` | `-max-payload` |

There is no shell and no `curl` in the image, so `/healthz` is what an orchestrator polls.

### Local configuration

A tunnel hostname or a public origin is nobody else's business, so it lives in `frontend/.env.local` (gitignored; see `.env.example`):

| variable | |
|---|---|
| `BLINKFLOW_ALLOWED_HOSTS` | extra dev-server hostnames, comma separated |
| `BLINKFLOW_SERVER_ORIGIN` | where embedded links should point |
| `BLINKFLOW_SERVER_PORT` | the card server's port, when it is not 8080 |

## Share API

An agent that has worked out a flow should be able to hand back a link instead of a wall of text.
`POST /share` takes the document as the body and answers with the links, plus a summary of what it understood.
Newlines are the structure, so the bytes are taken exactly as sent.

```bash
curl -sS -X POST https://blinkflow.live/share \
  -H 'content-type: text/plain' \
  --data-binary @flow.lg
```

```json
{
  "links": {
    "embedded": "https://blinkflow.live/c1.…",
    "simple": "https://blinkflow.live/#c1.…"
  },
  "payload": "c1.…",
  "title": "v3/expenses — API flow",
  "description": "10 steps · 2 arms · 4 panels · 2 notes · gate: permission expenses.read",
  "steps": 10,
  "arms": 2,
  "panels": 4,
  "notes": 2,
  "source_bytes": 1242,
  "payload_chars": 934
}
```

Both carriers are returned by default; `?mode=embedded` (or `"mode": "…"` in a JSON body) asks for one.
`"mode"` is the share dialog's own word for the same choice, and the route is named for what a caller wants rather than how a payload is packed — a new carrier, such as an image preview, arrives as another key under `links` rather than another endpoint.

`application/json` with `{"source": "…"}` works too. The summary is not decoration: the payload is opaque to the caller, so the counts are the only way to notice that a document arrived as one flat step.

It is a pure function — the same document produces the same link — and it is capped, `no-store`, and logged by size only.
The links it builds are the format the editor builds, which is the point: `share.Encode` is a second implementation of the same format, and a test decodes the server's payload with the app's own decoder.
Only the version prefix is shared between them, so a format change is a new prefix (`c2.…`) that old clients refuse loudly instead of rendering wrong.

## Skills

`skills/` holds instructions written for AI agents, served from that folder at `/skills/` — the folder is the endpoint, no build step.
The first one explains code:

```
https://blinkflow.live/skills/explain-code-flow/SKILL.md
```

It tells an agent to read the code, draw the flow, post it to `/share`, and answer with the link — never with the document or the code.
Reference files and three worked examples at three levels of abstraction sit beside it, and a test parses every example so a broken one fails CI instead of reaching an agent.

## Structure

```
frontend/              the app: everything that runs in a browser
  src/lang/parser.ts   text → tree (+ issues)
  src/lang/render.ts   tree → DOM (accordions, anchors)
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
skills/                agent skills, served at /skills/
testdata/og/           fixtures both languages assert against
.github/workflows/     the two test suites, the image build and its publish to GHCR
Makefile               dev, test, build, image
VISION.md              what the notation is for, and what an operator may mean
AGENTS.md              how to work in here, for an agent (or a person in a hurry)
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
