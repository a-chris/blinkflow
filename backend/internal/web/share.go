package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"blinkflow/backend/internal/flow"
	"blinkflow/backend/internal/og"
	"blinkflow/backend/internal/share"
)

// SharePath mints links for a posted document. It is the only endpoint that
// accepts a body, and it still writes nothing: the document is packed into the
// URL exactly as the editor packs it, so an agent can hand back a link a person
// opens later without anything being stored.
//
// The path is named for what a caller wants — links to share — and not for how
// a payload is packed. The packing is the part that must change without the URL
// changing: that is what the payload's own `c1.` prefix is for.
const SharePath = "/share"

// The carriers a link can use. These are the playground's words: the share
// dialog offers the same two, and a new one (an image preview, say) arrives as
// another entry here rather than another endpoint.
const (
	ModeSimple   = "simple"
	ModeEmbedded = "embedded"
)

var shareModes = []string{ModeSimple, ModeEmbedded}

// shareResponse is what a caller gets back: the links to hand out, and enough
// of a summary that it can tell whether the document it sent was understood.
//
// The summary is not decoration. The payload is opaque to the caller, so if the
// diagram parsed as one flat step, the counts are the only visible sign.
type shareResponse struct {
	Links        map[string]string `json:"links"`
	Payload      string            `json:"payload"`
	Title        string            `json:"title"`
	Description  string            `json:"description"`
	Steps        int               `json:"steps"`
	Arms         int               `json:"arms"`
	Panels       int               `json:"panels"`
	Notes        int               `json:"notes"`
	SourceBytes  int               `json:"source_bytes"`
	PayloadChars int               `json:"payload_chars"`
}

// shareRequest is a document and, optionally, which carrier to build for it.
type shareRequest struct {
	Source string
	Mode   string
}

var (
	errEmptyBody    = errors.New("the body is empty")
	errTooLarge     = errors.New("the document is larger than the payload cap")
	errBadJSON      = errors.New(`the body is JSON but has no "source" string`)
	errCouldNotPack = errors.New("could not build a link for this document")
	errUnknownMode  = errors.New("unknown mode")
)

// serveShare answers the one write-shaped request the server has. POST only:
// a GET here would be a link that does nothing.
func (s *Server) serveShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		s.writeJSONError(w, http.StatusMethodNotAllowed, "send the diagram as the body of a POST")
		return
	}

	request, err := s.readShareRequest(w, r)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, errTooLarge):
			status = http.StatusRequestEntityTooLarge
		}
		// The message names the problem, never the document: a caller that sent
		// a secret in the body must not find it echoed back or in the log.
		message := err.Error()
		if errors.Is(err, errTooLarge) {
			message = fmt.Sprintf("the document is larger than the %d-byte limit", s.config.MaxPayloadBytes)
		}
		s.config.Log.Printf("%s %s -> %d: %v", r.Method, SharePath, status, err)
		s.writeJSONError(w, status, message)
		return
	}

	payload, err := share.Encode(request.Source)
	if err != nil {
		s.config.Log.Printf("%s %s -> 500: %v", r.Method, SharePath, err)
		s.writeJSONError(w, http.StatusInternalServerError, errCouldNotPack.Error())
		return
	}

	analysis := flow.Analyze(request.Source)
	meta := og.FromAnalysis(analysis)
	origin := s.originOf(r)

	body, err := json.Marshal(shareResponse{
		Links:        linksFor(origin, payload, request.Mode),
		Payload:      payload,
		Title:        meta.Title,
		Description:  meta.Description,
		Steps:        analysis.Stats.Steps,
		Arms:         analysis.Stats.Arms,
		Panels:       analysis.Stats.Panels,
		Notes:        analysis.Stats.Notes,
		SourceBytes:  len(request.Source),
		PayloadChars: len(payload),
	})
	if err != nil {
		s.config.Log.Printf("%s %s -> 500: %v", r.Method, SharePath, err)
		s.writeJSONError(w, http.StatusInternalServerError, errCouldNotPack.Error())
		return
	}

	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	// A document may be somebody's private plan; it is not going to sit in a
	// shared cache because it was posted instead of opened.
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(body)
	}

	s.config.Log.Printf("%s %s -> 200 (%d bytes in, %d chars out)", r.Method, SharePath, len(request.Source), len(payload))
}

// linksFor builds every carrier the caller asked for. One link per carrier, so
// adding an image preview later is an added key rather than a new shape.
func linksFor(origin, payload, mode string) map[string]string {
	links := map[string]string{}
	if mode == "" || mode == ModeSimple {
		links[ModeSimple] = origin + "/#" + payload
	}
	if mode == "" || mode == ModeEmbedded {
		links[ModeEmbedded] = origin + "/" + payload
	}
	return links
}

// readShareRequest takes the diagram out of the request body. The body is the
// document, byte for byte: newlines are the structure, so nothing here
// normalises them. JSON is accepted too, because a caller that speaks JSON
// should not have to switch encoders to use this.
func (s *Server) readShareRequest(w http.ResponseWriter, r *http.Request) (shareRequest, error) {
	request := shareRequest{
		// A text body has nowhere to put a field, so it can ask by query string.
		Mode: strings.TrimSpace(r.URL.Query().Get("mode")),
	}

	limit := int64(s.config.MaxPayloadBytes)
	// Read one byte past the cap so "exactly at the limit" and "one over" are
	// distinguishable without buffering the rest of a hostile body.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit+1))
	if err != nil {
		return shareRequest{}, errTooLarge
	}
	if int64(len(body)) > limit {
		return shareRequest{}, errTooLarge
	}

	if isJSON(r.Header.Get("Content-Type")) {
		// A pointer, so "no source field" and "an empty source" stay different
		// mistakes: one is a malformed request, the other an empty document.
		var parsed struct {
			Source *string `json:"source"`
			Mode   string  `json:"mode"`
		}
		if err := json.Unmarshal(body, &parsed); err != nil || parsed.Source == nil {
			return shareRequest{}, errBadJSON
		}
		body = []byte(*parsed.Source)
		if mode := strings.TrimSpace(parsed.Mode); mode != "" {
			request.Mode = mode
		}
	}

	if request.Mode != "" && !isShareMode(request.Mode) {
		return shareRequest{}, fmt.Errorf("%w %q: use %s", errUnknownMode, request.Mode, strings.Join(shareModes, ", "))
	}

	request.Source = string(body)
	if strings.TrimSpace(request.Source) == "" {
		return shareRequest{}, errEmptyBody
	}
	return request, nil
}

func isShareMode(mode string) bool {
	for _, known := range shareModes {
		if mode == known {
			return true
		}
	}
	return false
}

func isJSON(contentType string) bool {
	value, _, _ := strings.Cut(contentType, ";")
	return strings.EqualFold(strings.TrimSpace(value), "application/json")
}

func (s *Server) writeJSONError(w http.ResponseWriter, status int, message string) {
	body, err := json.Marshal(struct {
		Error string `json:"error"`
	}{message})
	if err != nil {
		http.Error(w, message, status)
		return
	}
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	w.WriteHeader(status)
	w.Write(body)
}
