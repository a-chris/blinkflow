// Package share decodes the payload lightgram puts in a URL.
//
// A payload is a version prefix and base64url bytes:
//
//	c1.<base64url>   deflate-raw compressed   (what the browser emits)
//	p1.<base64url>   plain UTF-8              (browser without CompressionStream)
//
// The version prefix is the compatibility contract: once a prefix ships it must
// decode forever. Anything that looks like a payload but carries an unknown
// prefix fails loudly instead of rendering garbage.
package share

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	PrefixDeflate = "c1."
	PrefixPlain   = "p1."
)

// payloadShape matches any versioned payload in a known family, supported or
// not: the letter says how the bytes are packed (c = compressed, p = plain) and
// the number is the version. Restricting the family is what keeps a stray
// `/a1.png` from being routed as a share link, while `c2.…` still gets a real
// "this link needs a newer lightgram".
var payloadShape = regexp.MustCompile(`^[cp][0-9]+\.[A-Za-z0-9_-]+$`)

var (
	// ErrNotPayload means the string is not a share payload at all.
	ErrNotPayload = errors.New("not a lightgram share link")
	// ErrUnsupportedVersion means the shape is right but this build is too old.
	ErrUnsupportedVersion = errors.New("this link needs a newer lightgram")
	// ErrDamaged means the bytes did not survive base64 or inflate.
	ErrDamaged = errors.New("this share link is damaged or from another version")
	// ErrTooLarge means the decoded document exceeds the configured cap.
	ErrTooLarge = errors.New("this share link is too large to open")
)

// MaxEncoded is the longest payload string that can still decode to limit bytes:
// base64 costs four characters per three bytes, plus the version prefix.
func MaxEncoded(limit int) int {
	return (limit/3)*4 + len(PrefixDeflate) + 16
}

// IsPayload reports whether the path segment looks like a share payload.
func IsPayload(segment string) bool {
	return payloadShape.MatchString(segment)
}

// Decode turns a payload back into the document. limit is the maximum number
// of decoded bytes accepted, which also bounds the inflate work an untrusted
// link can make us do.
func Decode(payload string, limit int) (string, error) {
	value := strings.TrimSpace(payload)

	switch {
	case strings.HasPrefix(value, PrefixPlain):
		// Refuse an oversized payload before allocating for it: the cap is about
		// the decoded document, but allocating first would let a hostile URL ask
		// for more memory than that number suggests.
		if len(value) > MaxEncoded(limit) {
			return "", ErrTooLarge
		}
		raw, err := decodeBase64(value[len(PrefixPlain):])
		if err != nil {
			return "", err
		}
		if len(raw) > limit {
			return "", ErrTooLarge
		}
		if !utf8.Valid(raw) {
			return "", ErrDamaged
		}
		return string(raw), nil

	case strings.HasPrefix(value, PrefixDeflate):
		if len(value) > MaxEncoded(limit) {
			return "", ErrTooLarge
		}
		raw, err := decodeBase64(value[len(PrefixDeflate):])
		if err != nil {
			return "", err
		}
		return inflate(raw, limit)

	default:
		if IsPayload(value) {
			return "", ErrUnsupportedVersion
		}
		return "", ErrNotPayload
	}
}

func decodeBase64(value string) ([]byte, error) {
	if value == "" {
		return nil, ErrDamaged
	}
	// The client strips padding, so try the unpadded form first.
	if raw, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		return raw, nil
	}
	raw, err := base64.URLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrDamaged
	}
	return raw, nil
}

// inflate mirrors DecompressionStream('deflate-raw'): no zlib header, no
// checksum, just the deflate stream.
func inflate(packed []byte, limit int) (string, error) {
	reader := flate.NewReader(bytes.NewReader(packed))
	defer reader.Close()

	out, err := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
	if err != nil {
		// A truncated stream must fail loudly: half a document rendered as if it
		// were whole is worse than "this link is damaged".
		return "", ErrDamaged
	}
	if len(out) > limit {
		return "", ErrTooLarge
	}
	if !utf8.Valid(out) {
		return "", ErrDamaged
	}
	return string(out), nil
}

// Describe returns a short, log-safe description of a payload: its version
// prefix and length, never the bytes themselves.
func Describe(payload string) string {
	prefix, _, _ := strings.Cut(payload, ".")
	return fmt.Sprintf("%s.<redacted> (%d chars)", prefix, len(payload))
}
