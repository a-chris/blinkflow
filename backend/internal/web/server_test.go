package web_test

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lightgram/backend/internal/share"
	"lightgram/backend/internal/web"
)

const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>lightgram — light diagrams</title>
    <meta name="description" content="the generic description" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`

func compress(t *testing.T, document string) string {
	t.Helper()
	var buffer bytes.Buffer
	writer, err := flate.NewWriter(&buffer, flate.DefaultCompression)
	if err != nil {
		t.Fatalf("flate: %v", err)
	}
	if _, err := writer.Write([]byte(document)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return share.PrefixDeflate + base64.RawURLEncoding.EncodeToString(buffer.Bytes())
}

// harness builds a server whose shell lives in a temp dir, so tests never touch
// the real frontend.
// shellFile writes the app shell into a temp dir and returns its path.
func shellFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "index.html")
	if err := os.WriteFile(path, []byte(shell), 0o600); err != nil {
		t.Fatalf("write shell: %v", err)
	}
	return path
}

func harness(t *testing.T, config web.Config) (*web.Server, *bytes.Buffer) {
	t.Helper()
	dir := t.TempDir()
	if config.Dev && config.Proxy == nil {
		// Dev wiring still requires a proxy target; these tests never reach it.
		config.Proxy = &url.URL{Scheme: "http", Host: "127.0.0.1:1"}
	}
	config.ShellPath = filepath.Join(dir, "index.html")
	if config.StaticDir == "" {
		config.StaticDir = dir
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(shell), 0o600); err != nil {
		t.Fatalf("write shell: %v", err)
	}

	logs := &bytes.Buffer{}
	config.Log = log.New(logs, "", 0)

	server, err := web.New(config)
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	return server, logs
}

func get(t *testing.T, server http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("User-Agent", "Slackbot-LinkExpanding 1.0")
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	return recorder
}

const document = "# v3/expenses — API flow\n# second note line\n\nGET v3/expenses\n  gate: permission expenses.read\n  > AR query builder\n"

func TestPayloadPageCarriesTheDocumentCard(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	payload := compress(t, document)

	response := get(t, server, "/"+payload)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()

	for _, want := range []string{
		`<meta property="og:title" content="v3/expenses — API flow" />`,
		`<meta property="og:description" content="2 steps · 0 arms · 1 panel · 1 note · gate: permission expenses.read" />`,
		`<meta property="og:site_name" content="lightgram" />`,
		`<meta name="twitter:card" content="summary" />`,
		`<link rel="canonical" href="http://example.com/` + payload + `" />`,
		`<meta name="lightgram-embedded-origin" content="http://example.com" />`,
		`<title>v3/expenses — API flow — lightgram</title>`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %s\n---\n%s", want, body)
		}
	}

	if strings.Contains(body, "the generic description") {
		t.Error("the generic description survived alongside the document one")
	}
	if count := strings.Count(body, "<title>"); count != 1 {
		t.Errorf("expected exactly one title tag, found %d", count)
	}
	if strings.Contains(body, "# second note line") {
		t.Error("the note body leaked onto the page")
	}
}

// Where the page says it lives, and therefore where embedded links point.
//
// The security property: a header a client can set must not decide this. Only a
// configured origin, or forwarded headers when the operator said to trust them,
// may change it.
func TestPageOrigin(t *testing.T) {
	payload := compress(t, document)
	page := func(t *testing.T, config web.Config, mutate func(*http.Request)) string {
		t.Helper()
		server, _ := harness(t, config)
		request := httptest.NewRequest(http.MethodGet, "/"+payload, nil)
		request.Host = "internal:8080"
		if mutate != nil {
			mutate(request)
		}
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, request)
		return recorder.Body.String()
	}
	forge := func(r *http.Request) {
		r.Header.Set("X-Forwarded-Host", "evil.example")
		r.Header.Set("X-Forwarded-Proto", "https")
	}
	metaFor := func(origin string) string {
		return `<meta name="lightgram-embedded-origin" content="` + origin + `" />`
	}

	t.Run("uses the request host by default", func(t *testing.T) {
		body := page(t, web.Config{Dev: true}, nil)
		if !strings.Contains(body, metaFor("http://internal:8080")) {
			t.Fatalf("missing default origin\n---\n%s", body)
		}
	})

	t.Run("ignores forged forwarded headers by default", func(t *testing.T) {
		body := page(t, web.Config{Dev: true}, forge)
		if strings.Contains(body, "evil.example") {
			t.Fatalf("a client header changed the page origin\n---\n%s", body)
		}
		if !strings.Contains(body, metaFor("http://internal:8080")) {
			t.Fatalf("expected the request host\n---\n%s", body)
		}
	})

	t.Run("believes forwarded headers when the proxy is trusted", func(t *testing.T) {
		body := page(t, web.Config{Dev: true, TrustProxy: true}, forge)
		if !strings.Contains(body, metaFor("https://evil.example")) {
			t.Fatalf("trusted proxy headers should be honoured\n---\n%s", body)
		}
	})

	t.Run("a trusted proxy header still has to be a host", func(t *testing.T) {
		body := page(t, web.Config{Dev: true, TrustProxy: true}, func(r *http.Request) {
			r.Header.Set("X-Forwarded-Host", "evil.example/path?x=1")
			r.Header.Set("X-Forwarded-Proto", "javascript")
		})
		if strings.Contains(body, "evil.example/path") || strings.Contains(body, "javascript:") {
			t.Fatalf("a malformed forwarded header leaked into the page\n---\n%s", body)
		}
	})

	t.Run("the configured public origin wins over everything", func(t *testing.T) {
		body := page(t, web.Config{Dev: true, PublicOrigin: "https://lightgram.example.com/"}, forge)
		if !strings.Contains(body, metaFor("https://lightgram.example.com")) {
			t.Fatalf("configured origin not used\n---\n%s", body)
		}
		if strings.Contains(body, "evil.example") {
			t.Fatalf("forwarded header overrode the configured origin\n---\n%s", body)
		}
		if !strings.Contains(body, `<link rel="canonical" href="https://lightgram.example.com/`+payload+`" />`) {
			t.Fatalf("canonical did not use the configured origin\n---\n%s", body)
		}
	})
}

func TestPublicOriginIsValidated(t *testing.T) {
	bad := []string{"lightgram.example.com", "ftp://lightgram.example.com", "https://lightgram.example.com/app", "https://user:pw@lightgram.example.com"}
	for _, value := range bad {
		if _, err := web.New(web.Config{Dev: true, Proxy: &url.URL{Host: "localhost:5174"}, ShellPath: shellFile(t), PublicOrigin: value}); err == nil {
			t.Errorf("expected %q to be rejected", value)
		}
	}
}

func TestPayloadPageIsNotCachedInDev(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	response := get(t, server, "/"+compress(t, document))
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("got %q", got)
	}
}

func TestDevPagesLoadTheHMRClient(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	body := get(t, server, "/"+compress(t, document)).Body.String()
	if !strings.Contains(body, "/@vite/client") {
		t.Fatalf("dev shell must load the Vite client:\n%s", body)
	}
}

func TestProductionPagesDoNotLoadTheHMRClient(t *testing.T) {
	server, _ := harness(t, web.Config{})
	response := get(t, server, "/"+compress(t, document))
	if strings.Contains(response.Body.String(), "/@vite/client") {
		t.Fatal("production shell must not load the Vite client")
	}
	if got := response.Header().Get("Cache-Control"); !strings.Contains(got, "public") {
		t.Fatalf("payload pages are content-stable and should be cacheable, got %q", got)
	}
}

func TestUnknownVersionFailsLoudly(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	response := get(t, server, "/c2.HVTRx8wQ")

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "needs a newer lightgram") {
		t.Fatalf("unhelpful body: %s", response.Body.String())
	}
}

func TestDamagedPayloadFailsLoudly(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	response := get(t, server, "/c1.notdeflate")

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "damaged") {
		t.Fatalf("unhelpful body: %s", response.Body.String())
	}
}

func TestOversizedPayloadIsRefused(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true, MaxPayloadBytes: 32})
	response := get(t, server, "/"+compress(t, strings.Repeat("a flow line\n", 50)))

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", response.Code)
	}
}

func TestEveryRequestToAPayloadIsLoggedWithoutThePayload(t *testing.T) {
	server, logs := harness(t, web.Config{Dev: true})
	payload := compress(t, document)
	get(t, server, "/"+payload)

	if strings.Contains(logs.String(), strings.TrimPrefix(payload, "c1.")) {
		t.Fatalf("the payload reached the log: %s", logs.String())
	}
	if !strings.Contains(logs.String(), "c1.<redacted>") {
		t.Fatalf("expected a redacted description, got: %s", logs.String())
	}
	// The title is document content: it belongs on the card, not in a log file.
	if strings.Contains(logs.String(), "v3/expenses") {
		t.Fatalf("document content reached the log: %s", logs.String())
	}
}

func TestPayloadTextIsEscapedNotInjected(t *testing.T) {
	nasty := "# <script>alert(\"x\")</script> & \"quotes\"\n- step\n"
	server, _ := harness(t, web.Config{Dev: true})
	body := get(t, server, "/"+compress(t, nasty)).Body.String()

	if strings.Contains(body, "<script>alert") {
		t.Fatalf("document text was injected raw:\n%s", body)
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Fatalf("expected escaped text:\n%s", body)
	}
}

func TestHeadRequestsGetTheSameHeadersWithoutABody(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	request := httptest.NewRequest(http.MethodHead, "/"+compress(t, document), nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d", recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("HEAD returned a body of %d bytes", recorder.Body.Len())
	}
	if recorder.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD should report the length")
	}
}

func TestWritesAreRefused(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	request := httptest.NewRequest(http.MethodPost, "/"+compress(t, document), nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d", recorder.Code)
	}
}

func TestHealth(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	response := get(t, server, "/healthz")
	if body := response.Body.String(); body != "ok\n" {
		t.Fatalf("got %q", body)
	}
	// The editor asks this from the Vite origin in development, so it has to be
	// readable cross-origin or embedded links look unavailable.
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("health must be readable cross-origin, got %q", got)
	}
}

func TestHealthIsReadOnly(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})
	request := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d, want 405", recorder.Code)
	}
}

func TestHealthGrantsNoCrossOriginAccessInProduction(t *testing.T) {
	server, _ := harness(t, web.Config{})
	if got := get(t, server, "/healthz").Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("production health should not be readable cross-origin, got %q", got)
	}
}

func TestDevProxiesEverythingElseToVite(t *testing.T) {
	vite := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("from vite " + r.URL.Path))
	}))
	defer vite.Close()

	target, err := url.Parse(vite.URL)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	server, _ := harness(t, web.Config{Dev: true, Proxy: target})
	if body := get(t, server, "/").Body.String(); body != "from vite /" {
		t.Fatalf("got %q", body)
	}
	if body := get(t, server, "/src/main.ts").Body.String(); body != "from vite /src/main.ts" {
		t.Fatalf("got %q", body)
	}
}

func TestStaticServingFallsBackToTheApp(t *testing.T) {
	dir := t.TempDir()
	assets := filepath.Join(dir, "assets")
	if err := os.Mkdir(assets, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assets, "app.js"), []byte("console.log(1)"), 0o600); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	// Outside dev the built shell is static/index.html.
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(shell), 0o600); err != nil {
		t.Fatalf("write shell: %v", err)
	}
	server, err := web.New(web.Config{StaticDir: dir, Log: log.New(&bytes.Buffer{}, "", 0)})
	if err != nil {
		t.Fatalf("new: %v", err)
	}

	if body := get(t, server, "/assets/app.js").Body.String(); body != "console.log(1)" {
		t.Fatalf("asset not served: %q", body)
	}
	if body := get(t, server, "/some/deep/route").Body.String(); !strings.Contains(body, "<!doctype html>") {
		t.Fatalf("unknown path should serve the app: %q", body)
	}
}

func TestMissingShellIsAStartupError(t *testing.T) {
	if _, err := web.New(web.Config{Dev: true, Proxy: &url.URL{Host: "localhost:5174"}, ShellPath: "/nope/index.html"}); err == nil {
		t.Fatal("expected an error for a missing shell")
	}
	if _, err := web.New(web.Config{Dev: true}); err == nil {
		t.Fatal("dev mode without a proxy address should fail")
	}
	if _, err := web.New(web.Config{}); err == nil {
		t.Fatal("production mode without a static dir should fail")
	}
}
