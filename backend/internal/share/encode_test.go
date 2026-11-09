package share_test

import (
	"regexp"
	"strings"
	"testing"

	"blinkflow/backend/internal/share"
)

// The encoder is what lets a program publish a link. Its output has to be the
// form the browser already decodes, so these tests pin the format — prefix,
// alphabet, round trip — and never the compressor's exact bytes, which are free
// to change between Go releases.

const sample = `# checkout — one gate, one panel
POST v3/checkout
  gate: permission checkout.write
    yes:
      - Orders::Create.call(cart)   @app/services/orders/create.rb:12
        > charges the card
    no:
      - 403 { error: "forbidden" }
`

func TestEncodeRoundTripsTheDocumentExactly(t *testing.T) {
	payload, err := share.Encode(sample)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	decoded, err := share.Decode(payload, 64<<10)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if decoded != sample {
		t.Fatalf("round trip changed the document:\n got %q\nwant %q", decoded, sample)
	}
}

func TestEncodeUsesTheCompressedPrefixAndURLSafeAlphabet(t *testing.T) {
	payload, err := share.Encode(sample)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	if !strings.HasPrefix(payload, share.PrefixDeflate) {
		t.Fatalf("payload %q must start with %q", payload, share.PrefixDeflate)
	}
	if !share.IsPayload(payload) {
		t.Fatalf("payload %q is not recognised as a share payload", payload)
	}
	// `+`, `/` and `=` have meaning in a URL path: padding or standard base64
	// would break the link the endpoint hands out.
	if bad := regexp.MustCompile(`[^A-Za-z0-9._-]`).FindString(payload); bad != "" {
		t.Fatalf("payload contains %q, which is not URL-safe", bad)
	}
}

func TestEncodeIsDeterministic(t *testing.T) {
	first, err := share.Encode(sample)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	second, err := share.Encode(sample)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	// Same document, same link: a caller can deduplicate, cache, or compare two
	// links without knowing anything about how they were built.
	if first != second {
		t.Fatalf("same document produced %q and %q", first, second)
	}
}

func TestEncodePreservesNewlinesAndUnicode(t *testing.T) {
	document := "GET v3/café\n  - wait — 500 ms\n  - 403 { error: \"non autorisé\" }\n"
	payload, err := share.Encode(document)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	decoded, err := share.Decode(payload, 64<<10)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Newlines are the tree, and accents are content: both survive the trip or
	// the link is not the document.
	if decoded != document {
		t.Fatalf("got %q, want %q", decoded, document)
	}
	if strings.Count(decoded, "\n") != strings.Count(document, "\n") {
		t.Fatalf("newline count changed: %q", decoded)
	}
}

func TestEncodeIsSmallerThanTheDocumentWhenItRepeats(t *testing.T) {
	document := strings.Repeat("  - Database.where(user_id:, cursor:, limit:)\n", 50)

	payload, err := share.Encode(document)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	if len(payload) >= len(document) {
		t.Fatalf("repetitive document should compress: %d chars in, %d out", len(document), len(payload))
	}
}

func TestEncodeOutputFitsTheEncodedCeiling(t *testing.T) {
	// MaxEncoded is the budget the server uses for request-line headers, so an
	// encoder that can exceed it would produce links the server itself rejects.
	document := strings.Repeat("GET v3/expenses\n", 100)
	payload, err := share.Encode(document)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	if len(payload) > share.MaxEncoded(len(document)) {
		t.Fatalf("encoded %d chars for a %d-byte document, ceiling is %d",
			len(payload), len(document), share.MaxEncoded(len(document)))
	}
}

func TestEncodeDecodesBackUnderTheSameLimit(t *testing.T) {
	document := strings.Repeat("GET v3/expenses\n", 10)
	payload, err := share.Encode(document)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}

	if _, err := share.Decode(payload, len(document)-1); err == nil {
		t.Fatal("decoding under the limit must fail, not silently truncate")
	}
}
