package web_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"blinkflow/backend/internal/share"
	"blinkflow/backend/internal/web"
)

const shareDocument = `# checkout — one gate, one panel
POST v3/checkout
  gate: permission checkout.write
    yes:
      - Orders::Create.call(cart)   @app/services/orders/create.rb:12
        > charges the card
    no:
      - 403 { error: "forbidden" }
`

func post(t *testing.T, server http.Handler, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()
	return postTo(t, server, web.SharePath, contentType, body)
}

func postTo(t *testing.T, server http.Handler, target, contentType, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	return recorder
}

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, recorder.Body.String())
	}
	return body
}

func links(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	value, ok := body["links"].(map[string]any)
	if !ok {
		t.Fatalf("response has no links object: %v", body)
	}
	return value
}

// The point of the endpoint: an agent sends a document, gets a link, and the
// link opens the same diagram the editor would have built.
func TestShareReturnsLinksThatHoldTheDocument(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	response := post(t, server, "text/plain", shareDocument)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	body := decodeResponse(t, response)

	payload, _ := body["payload"].(string)
	decoded, err := share.Decode(payload, 64<<10)
	if err != nil {
		t.Fatalf("the returned payload does not decode: %v", err)
	}
	// Byte for byte, newlines included: the document is the diagram.
	if decoded != shareDocument {
		t.Fatalf("payload holds\n%q\nwant\n%q", decoded, shareDocument)
	}

	got := links(t, body)
	if want := "http://example.com/" + payload; got[web.ModeEmbedded] != want {
		t.Fatalf("embedded link = %v, want %v", got[web.ModeEmbedded], want)
	}
	if want := "http://example.com/#" + payload; got[web.ModeSimple] != want {
		t.Fatalf("simple link = %v, want %v", got[web.ModeSimple], want)
	}
}

func TestShareBuildsOnlyTheModeAskedFor(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	// A text body has no fields, so the carrier is chosen in the query.
	body := decodeResponse(t, postTo(t, server, web.SharePath+"?mode=embedded", "text/plain", shareDocument))
	got := links(t, body)
	if len(got) != 1 || got[web.ModeEmbedded] == nil {
		t.Fatalf("mode=embedded should return one embedded link, got %v", got)
	}

	// A JSON body can say it in the body.
	jsonBody := `{"source": ` + mustJSON(t, shareDocument) + `, "mode": "simple"}`
	got = links(t, decodeResponse(t, post(t, server, "application/json", jsonBody)))
	if len(got) != 1 || got[web.ModeSimple] == nil {
		t.Fatalf("mode=simple should return one simple link, got %v", got)
	}
}

func TestShareRejectsAnUnknownMode(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	response := postTo(t, server, web.SharePath+"?mode=image", "text/plain", shareDocument)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", response.Code)
	}
	message, _ := decodeResponse(t, response)["error"].(string)
	for _, want := range []string{"image", web.ModeSimple, web.ModeEmbedded} {
		if !strings.Contains(message, want) {
			t.Fatalf("the error should name %q, got %q", want, message)
		}
	}
}

// The caller cannot see inside the payload, so the summary is how it learns
// whether its document was understood at all.
func TestShareSummarisesTheDocument(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	body := decodeResponse(t, post(t, server, "text/plain", shareDocument))

	for field, want := range map[string]any{
		"title":        "checkout — one gate, one panel",
		"description":  "6 steps · 2 arms · 1 panel · 1 note · gate: permission checkout.write",
		"steps":        float64(6),
		"arms":         float64(2),
		"panels":       float64(1),
		"notes":        float64(1),
		"source_bytes": float64(len(shareDocument)),
	} {
		if got := body[field]; got != want {
			t.Errorf("%s = %v, want %v", field, got, want)
		}
	}

	if chars, _ := body["payload_chars"].(float64); int(chars) != len(body["payload"].(string)) {
		t.Errorf("payload_chars = %v, want %d", chars, len(body["payload"].(string)))
	}
}

func TestShareAcceptsAJSONBody(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	response := post(t, server, "application/json; charset=utf-8",
		`{"source": `+mustJSON(t, shareDocument)+`}`)

	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	body := decodeResponse(t, response)

	decoded, err := share.Decode(body["payload"].(string), 64<<10)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded != shareDocument {
		t.Fatalf("JSON body changed the document: %q", decoded)
	}
}

func TestShareRejectsAMalformedJSONBody(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	response := post(t, server, "application/json", `{"document": "GET v3/x"}`)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", response.Code)
	}
	if message, _ := decodeResponse(t, response)["error"].(string); !strings.Contains(message, "source") {
		t.Fatalf("the error should name the missing field, got %q", message)
	}
}

func TestShareRefusesAnEmptyBody(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	for _, body := range []string{"", "   ", "\n\n\t\n"} {
		response := post(t, server, "text/plain", body)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status %d, want 400", body, response.Code)
		}
	}
}

func TestShareRefusesAnOversizedDocument(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true, MaxPayloadBytes: 64})

	response := post(t, server, "text/plain", strings.Repeat("x", 65))

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d, want 413", response.Code)
	}
	if message, _ := decodeResponse(t, response)["error"].(string); !strings.Contains(message, "64") {
		t.Fatalf("the error should name the limit, got %q", message)
	}
}

func TestShareAcceptsADocumentExactlyAtTheLimit(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true, MaxPayloadBytes: 64})

	response := post(t, server, "text/plain", strings.Repeat("x", 64))

	if response.Code != http.StatusOK {
		t.Fatalf("status %d, want 200: %s", response.Code, response.Body.String())
	}
}

func TestShareIsPostOnly(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete} {
		request := httptest.NewRequest(method, web.SharePath, nil)
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: status %d, want 405", method, recorder.Code)
		}
		if allow := recorder.Header().Get("Allow"); allow != "POST" {
			t.Fatalf("%s: Allow = %q, want POST", method, allow)
		}
	}
}

// The links have to advertise the origin the deployment claims, or an agent
// hands out URLs that only work from inside the network.
func TestShareUsesTheConfiguredOrigin(t *testing.T) {
	server, _ := harness(t, web.Config{PublicOrigin: "https://blinkflow.example.com"})

	body := decodeResponse(t, post(t, server, "text/plain", shareDocument))

	got := links(t, body)[web.ModeEmbedded].(string)
	if !strings.HasPrefix(got, "https://blinkflow.example.com/c1.") {
		t.Fatalf("embedded link = %q, want the configured origin", got)
	}
}

func TestShareUsesTheRequestHostWhenNoOriginIsConfigured(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	request := httptest.NewRequest(http.MethodPost, web.SharePath, strings.NewReader(shareDocument))
	request.Host = "blinkflow.test:9999"
	request.Header.Set("Content-Type", "text/plain")
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	got := links(t, decodeResponse(t, recorder))[web.ModeEmbedded].(string)
	if !strings.HasPrefix(got, "http://blinkflow.test:9999/c1.") {
		t.Fatalf("embedded link = %q, want the request host", got)
	}
}

// A document may be somebody's private plan. The log answers "did this work",
// so the body must never appear in it — not in a message, not in an error.
func TestShareNeverLogsTheDocument(t *testing.T) {
	secret := "GET v3/secrets\n  - Database.where(password: 1234)\n"
	server, logs := harness(t, web.Config{Dev: true})

	post(t, server, "text/plain", secret)

	logged := logs.String()
	for _, needle := range []string{"secrets", "password", "1234"} {
		if strings.Contains(logged, needle) {
			t.Fatalf("the log leaked %q: %s", needle, logged)
		}
	}
	if !strings.Contains(logged, web.SharePath) {
		t.Fatalf("the log should record that the endpoint was used: %s", logged)
	}

	// The same rule for the failure path: an oversized body is described by its
	// size, never by its contents.
	logs.Reset()
	post(t, server, "text/plain", strings.Repeat(secret, 10000))
	if strings.Contains(logs.String(), "secrets") {
		t.Fatalf("an error path leaked the document: %s", logs.String())
	}
}

func TestShareIsNotCached(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	response := post(t, server, "text/plain", shareDocument)

	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
}

// The rest of the server stays read-only; adding one endpoint must not open a
// body-reading route anywhere else.
func TestOnlyTheShareEndpointAcceptsABody(t *testing.T) {
	server, _ := harness(t, web.Config{Dev: true})

	for _, target := range []string{"/", "/healthz", "/" + compress(t, document)} {
		response := postTo(t, server, target, "text/plain", shareDocument)

		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST %s: status %d, want 405", target, response.Code)
		}
	}
}

func mustJSON(t *testing.T, value string) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(encoded)
}
