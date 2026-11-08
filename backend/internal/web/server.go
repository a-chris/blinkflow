// Package web is the only server blinkflow has: it answers a previewable link
// with a page whose head describes that document, so crawlers that never run
// JavaScript still see a real title.
//
// It does not store anything. The document arrives in the URL, is decoded in
// memory, is summarised, and is thrown away. Nothing is written to disk and no
// payload is ever logged.
package web

import (
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"blinkflow/backend/internal/flow"
	"blinkflow/backend/internal/og"
	"blinkflow/backend/internal/share"
)

// Config describes how the server is wired.
type Config struct {
	// Dev enables the reverse proxy to the Vite dev server and disables caching.
	Dev bool
	// Proxy is the Vite dev server, e.g. http://localhost:5174. Required in Dev.
	Proxy *url.URL
	// ShellPath is the app shell used in Dev, e.g. frontend/index.html.
	ShellPath string
	// StaticDir is the built site, e.g. frontend/dist. Used outside Dev.
	StaticDir string
	// MaxPayloadBytes caps the decoded document.
	MaxPayloadBytes int
	// PublicOrigin, when set, is the origin every generated URL claims, e.g.
	// https://blinkflow.example.com. It is the deployed truth: with it, nothing
	// in the request can influence a canonical URL or an embedded link.
	PublicOrigin string
	// TrustProxy makes the server believe X-Forwarded-Proto/-Host. Only safe
	// when a proxy you control overwrites them; off by default, because a
	// client-supplied header must never decide what origin a page claims.
	TrustProxy bool
	// Log receives one line per payload page. Never the payload itself.
	Log *log.Logger
}

// Server implements http.Handler for blinkflow.
type Server struct {
	config   Config
	proxy    *httputil.ReverseProxy
	static   http.Handler
	shell    string
	titleTag *regexp.Regexp
	descMeta *regexp.Regexp
}

var (
	titleTagPattern  = regexp.MustCompile(`(?is)<title>.*?</title>`)
	descMetaPattern  = regexp.MustCompile(`(?is)<meta\s+name="description"[^>]*>\s*`)
	viteClientScript = `<script type="module" src="/@vite/client"></script>` + "\n"
)

// New builds the handler. It fails fast when a configured path is missing, so
// `make dev` reports a wiring mistake instead of serving a blank page.
func New(config Config) (*Server, error) {
	if config.MaxPayloadBytes <= 0 {
		config.MaxPayloadBytes = 64 << 10
	}
	if config.Log == nil {
		config.Log = log.Default()
	}

	origin, err := normalizeOrigin(config.PublicOrigin)
	if err != nil {
		return nil, err
	}
	config.PublicOrigin = origin

	server := &Server{
		config:   config,
		shell:    config.StaticDir,
		titleTag: titleTagPattern,
		descMeta: descMetaPattern,
	}

	if config.Dev {
		if config.Proxy == nil {
			return nil, errors.New("dev mode needs the Vite dev server address")
		}
		server.proxy = httputil.NewSingleHostReverseProxy(config.Proxy)
		server.proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			config.Log.Printf("vite proxy: %v", err)
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, "the Vite dev server is not reachable at %s — run `npm run dev` in frontend/\n", config.Proxy)
		}
		server.shell = config.ShellPath
	} else {
		if config.StaticDir == "" {
			return nil, errors.New("static dir is required outside dev mode")
		}
		server.static = http.FileServer(http.Dir(config.StaticDir))
		server.shell = filepath.Join(config.StaticDir, "index.html")
	}

	if _, err := os.Stat(server.shell); err != nil {
		return nil, fmt.Errorf("app shell %s: %w", server.shell, err)
	}
	return server, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only GET and HEAD are worth answering; a share link is read, never written.
	// This applies to every route, health included.
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Blinkflow share links are read-only", http.StatusMethodNotAllowed)
		return
	}

	if r.URL.Path == "/healthz" {
		// The editor asks this cross-origin in development, where it is served by
		// Vite on another port. It carries no data, so it may answer that origin;
		// in production nothing asks cross-origin, so nothing is granted.
		if s.config.Dev {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintln(w, "ok")
		return
	}

	if segment := lastSegment(r.URL.Path); share.IsPayload(segment) {
		s.serveDocument(w, r, segment)
		return
	}

	if s.proxy != nil {
		s.proxy.ServeHTTP(w, r)
		return
	}
	s.serveStatic(w, r)
}

// serveDocument is the whole of the feature: decode, describe, return a shell
// whose head carries the description. The document also stays in the URL, so
// the browser decodes it again and draws it.
func (s *Server) serveDocument(w http.ResponseWriter, r *http.Request, segment string) {
	document, err := share.Decode(segment, s.config.MaxPayloadBytes)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, share.ErrTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		s.config.Log.Printf("%s %s -> %d", r.Method, share.Describe(segment), status)
		s.serveMessage(w, r, status, err.Error())
		return
	}

	page, err := s.render(r, og.FromAnalysis(flow.Analyze(document)))
	if err != nil {
		s.config.Log.Printf("%s %s -> 500: %v", r.Method, share.Describe(segment), err)
		s.serveMessage(w, r, http.StatusInternalServerError, "could not render this page")
		return
	}

	header := w.Header()
	header.Set("Content-Type", "text/html; charset=utf-8")
	if s.config.Dev {
		header.Set("Cache-Control", "no-store")
	} else {
		// A payload URL is content-stable: the same link always means the same
		// document, so a card can be cached without ever going stale.
		header.Set("Cache-Control", "public, max-age=300")
	}
	header.Set("Content-Length", fmt.Sprintf("%d", len(page)))
	header.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		fmt.Fprint(w, page)
	}

	// The log answers "did this work", never "what was in it": the payload is
	// redacted, and the title is document content, so it stays out too.
	s.config.Log.Printf("%s %s -> 200", r.Method, share.Describe(segment))
}

// render puts the card metadata into the app shell. The shell is the real
// index.html, so there is exactly one definition of the page around the app.
func (s *Server) render(r *http.Request, meta og.Meta) (string, error) {
	shell, err := os.ReadFile(s.shell)
	if err != nil {
		return "", err
	}

	page := string(shell)
	page = s.titleTag.ReplaceAllString(page, "")
	page = s.descMeta.ReplaceAllString(page, "")

	origin := s.originOf(r)
	link := origin + r.URL.EscapedPath()
	head := strings.Join([]string{
		fmt.Sprintf(`<title>%s — Blinkflow</title>`, escape(meta.Title)),
		fmt.Sprintf(`<meta name="description" content="%s" />`, escape(meta.Description)),
		`<meta property="og:type" content="article" />`,
		`<meta property="og:site_name" content="Blinkflow" />`,
		fmt.Sprintf(`<meta property="og:title" content="%s" />`, escape(meta.Title)),
		fmt.Sprintf(`<meta property="og:description" content="%s" />`, escape(meta.Description)),
		fmt.Sprintf(`<meta property="og:url" content="%s" />`, escape(link)),
		`<meta name="twitter:card" content="summary" />`,
		// Pages served from here are the authority on embedded links: this is the
		// origin a document URL has to live on, whatever host the editor is using.
		fmt.Sprintf(`<meta name="blinkflow-embedded-origin" content="%s" />`, escape(origin)),
		fmt.Sprintf(`<link rel="canonical" href="%s" />`, escape(link)),
		"",
	}, "\n")

	if index := strings.Index(page, "</head>"); index >= 0 {
		page = page[:index] + head + page[index:]
	}

	if s.config.Dev {
		// Served by this server rather than by Vite, so Vite's HTML transform
		// never runs: load the HMR client ourselves or edits stop reloading.
		if index := strings.LastIndex(page, "</body>"); index >= 0 {
			page = page[:index] + viteClientScript + page[index:]
		}
	}

	return page, nil
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if _, err := os.Stat(filepath.Join(s.config.StaticDir, filepath.Clean(r.URL.Path))); err != nil {
		// Single-page app: unknown paths are the app, not a 404.
		r = r.Clone(r.Context())
		r.URL.Path = "/"
	}
	s.static.ServeHTTP(w, r)
}

func (s *Server) serveMessage(w http.ResponseWriter, r *http.Request, status int, message string) {
	page := fmt.Sprintf(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>%s — Blinkflow</title>
    <meta name="robots" content="noindex" />
  </head>
  <body style="font:16px/1.5 ui-sans-serif,system-ui;margin:3rem auto;max-width:34rem;padding:0 1.5rem">
    <h1 style="font-size:1.25rem">%s</h1>
    <p><a href="/">open Blinkflow</a></p>
  </body>
</html>
`, escape(message), escape(message))

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(page)))
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		fmt.Fprint(w, page)
	}
}

func lastSegment(requestPath string) string {
	trimmed := strings.Trim(requestPath, "/")
	if trimmed == "" {
		return ""
	}
	return path.Base(trimmed)
}

// originOf is where a page says it lives. Three sources, in order of trust: an
// explicitly configured public origin, forwarded headers from a proxy we were
// told to believe, and finally the Host the request arrived with.
func (s *Server) originOf(r *http.Request) string {
	if s.config.PublicOrigin != "" {
		return s.config.PublicOrigin
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	host := r.Host

	if s.config.TrustProxy {
		if forwarded := firstHeaderValue(r, "X-Forwarded-Proto"); isHTTPScheme(forwarded) {
			scheme = forwarded
		}
		if forwarded := firstHeaderValue(r, "X-Forwarded-Host"); validHost(forwarded) {
			host = forwarded
		}
	}
	return scheme + "://" + host
}

func firstHeaderValue(r *http.Request, name string) string {
	value := r.Header.Get(name)
	if index := strings.IndexByte(value, ','); index >= 0 {
		value = value[:index]
	}
	return strings.TrimSpace(value)
}

func isHTTPScheme(value string) bool {
	return value == "http" || value == "https"
}

// validHost rejects anything that is not a bare host[:port], so a forwarded
// header cannot smuggle a path, credentials or an injection into a URL.
func validHost(value string) bool {
	if value == "" || len(value) > 255 {
		return false
	}
	return !strings.ContainsAny(value, " /\\@?#\"'<>(){}[]|,;")
}

// normalizeOrigin accepts only a bare http(s) origin, because anything else
// would silently change the meaning of every link the server hands out.
func normalizeOrigin(value string) (string, error) {
	trimmed := strings.TrimSuffix(strings.TrimSpace(value), "/")
	if trimmed == "" {
		return "", nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("public origin %q: %w", value, err)
	}
	if !isHTTPScheme(parsed.Scheme) || parsed.Host == "" || !validHost(parsed.Host) {
		return "", fmt.Errorf("public origin %q must look like https://host[:port]", value)
	}
	if parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", fmt.Errorf("public origin %q must be scheme and host only", value)
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

func escape(value string) string {
	return html.EscapeString(value)
}
