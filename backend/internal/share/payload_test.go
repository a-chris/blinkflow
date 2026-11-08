package share_test

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"blinkflow/backend/internal/share"
)

// encode mirrors the browser's encodeShare so the tests exercise the same bytes
// the frontend produces: deflate-raw, base64url, padding stripped.
func encode(t *testing.T, prefix, document string) string {
	t.Helper()

	raw := []byte(document)
	if prefix == share.PrefixDeflate {
		var buffer bytes.Buffer
		writer, err := flate.NewWriter(&buffer, flate.DefaultCompression)
		if err != nil {
			t.Fatalf("flate writer: %v", err)
		}
		if _, err := writer.Write(raw); err != nil {
			t.Fatalf("write: %v", err)
		}
		if err := writer.Close(); err != nil {
			t.Fatalf("close: %v", err)
		}
		raw = buffer.Bytes()
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw)
}

const document = "# v3/expenses — API flow\n\nGET v3/expenses\n  gate: permission expenses.read\n"

func TestDecodeRoundTrip(t *testing.T) {
	for _, prefix := range []string{share.PrefixDeflate, share.PrefixPlain} {
		t.Run(prefix, func(t *testing.T) {
			payload := encode(t, prefix, document)
			got, err := share.Decode(payload, 64<<10)
			if err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got != document {
				t.Fatalf("round trip lost the document: %q", got)
			}
		})
	}
}

func TestDecodeKeepsUnicode(t *testing.T) {
	tricky := "a\tb\r\nc — em dash\n🎉🎉\n\n  trailing  "
	payload := encode(t, share.PrefixDeflate, tricky)
	got, err := share.Decode(payload, 64<<10)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got != tricky {
		t.Fatalf("unicode changed: %q", got)
	}
}

func TestDecodeAcceptsPaddedBase64(t *testing.T) {
	payload := share.PrefixPlain + base64.URLEncoding.EncodeToString([]byte("a\n"))
	if _, err := share.Decode(payload, 1<<10); err != nil {
		t.Fatalf("padded base64 rejected: %v", err)
	}
}

func TestDecodeFailures(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		want    error
	}{
		{name: "empty", payload: "", want: share.ErrNotPayload},
		{name: "ordinary path", payload: "c1", want: share.ErrNotPayload},
		{name: "newer version", payload: "c2.HVTRx8wQ", want: share.ErrUnsupportedVersion},
		{name: "newer plain", payload: "p9.abc", want: share.ErrUnsupportedVersion},
		{name: "bad base64 c1", payload: "c1.!!!!", want: share.ErrDamaged},
		{name: "bad deflate", payload: "c1." + base64.RawURLEncoding.EncodeToString([]byte("not deflate")), want: share.ErrDamaged},
		{name: "truncated deflate", payload: truncate(t), want: share.ErrDamaged},
		{name: "invalid utf8", payload: share.PrefixPlain + base64.RawURLEncoding.EncodeToString([]byte{0xff, 0xfe}), want: share.ErrDamaged},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := share.Decode(test.payload, 64<<10)
			if !errors.Is(err, test.want) {
				t.Fatalf("got %v, want %v", err, test.want)
			}
		})
	}
}

// truncate cuts a valid compressed payload in half: the inflater must report a
// damaged link rather than half a document.
func truncate(t *testing.T) string {
	t.Helper()
	payload := encode(t, share.PrefixDeflate, strings.Repeat("a long line of a flow\n", 50))
	return payload[:len(payload)/2]
}

func TestDecodeRefusesOversizedDocuments(t *testing.T) {
	// 1 MiB of compressible text is a few kilobytes on the wire: the cap must
	// apply to the decoded size, which is the zip-bomb shape we care about.
	big := strings.Repeat("0123456789abcdef", 64<<10)
	payload := encode(t, share.PrefixDeflate, big)

	if len(payload) > 64<<10 {
		t.Fatalf("test payload unexpectedly large: %d", len(payload))
	}
	if _, err := share.Decode(payload, 64<<10); !errors.Is(err, share.ErrTooLarge) {
		t.Fatalf("got %v, want ErrTooLarge", err)
	}

	if _, err := share.Decode(payload, len(big)); err != nil {
		t.Fatalf("exactly at the cap should decode: %v", err)
	}
}

// A hostile link must not cost more memory than the document cap implies.
func TestDecodeRefusesOversizedPayloadBeforeAllocating(t *testing.T) {
	limit := 64 << 10
	// Well past what any document within the cap could encode to.
	huge := share.PrefixDeflate + strings.Repeat("A", share.MaxEncoded(limit)+1)

	if _, err := share.Decode(huge, limit); !errors.Is(err, share.ErrTooLarge) {
		t.Fatalf("got %v, want ErrTooLarge", err)
	}

	// The bound has to be generous enough for a real document at the cap.
	atCap := encode(t, share.PrefixDeflate, strings.Repeat("a", limit))
	if len(atCap) > share.MaxEncoded(limit) {
		t.Fatalf("a document at the cap encodes to %d, over the bound of %d", len(atCap), share.MaxEncoded(limit))
	}
	if _, err := share.Decode(atCap, limit); err != nil {
		t.Fatalf("document at the cap should decode: %v", err)
	}
}

func TestIsPayload(t *testing.T) {
	cases := map[string]bool{
		"c1.HVTR":       true,
		"p1.HVTR":       true,
		"c2.HVTR":       true,
		"z9.abc_-":      false,
		"":              false,
		"c1.":           false,
		"index.html":    false,
		"assets":        false,
		"c1.HVTR/extra": false,
		"1c.HVTR":       false,
		"c1.HVTR+wrong": false,
	}
	for input, want := range cases {
		if got := share.IsPayload(input); got != want {
			t.Errorf("IsPayload(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestDescribeRedactsThePayload(t *testing.T) {
	payload := encode(t, share.PrefixDeflate, document)
	described := share.Describe(payload)
	if strings.Contains(described, strings.TrimPrefix(payload, "c1.")) {
		t.Fatalf("description leaks the payload: %q", described)
	}
	if !strings.HasPrefix(described, "c1.<redacted>") {
		t.Fatalf("unexpected description: %q", described)
	}
}
