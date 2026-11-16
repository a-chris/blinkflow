package og_test

import (
	"strings"
	"testing"

	"blinkflow/backend/internal/flow"
	"blinkflow/backend/internal/og"
)

func TestTitlePrefersTheDocumentNote(t *testing.T) {
	meta := og.FromAnalysis(flow.Analysis{FirstNote: "v3/articles — API flow", FirstStep: "GET v3/articles"})
	if meta.Title != "v3/articles — API flow" {
		t.Fatalf("got %q", meta.Title)
	}
}

func TestTitleFallsBackToTheFirstStep(t *testing.T) {
	meta := og.FromAnalysis(flow.Analysis{FirstStep: "GET v3/reports"})
	if meta.Title != "GET v3/reports" {
		t.Fatalf("got %q", meta.Title)
	}
}

func TestTitleFallsBackToTheProductName(t *testing.T) {
	if got := og.FromAnalysis(flow.Analysis{}).Title; got != "Blinkflow" {
		t.Fatalf("got %q", got)
	}
}

func TestTitleKeepsOnlyTheFirstLineOfANote(t *testing.T) {
	meta := og.FromAnalysis(flow.Analysis{FirstNote: "Articles API\nsecond line, less interesting"})
	if meta.Title != "Articles API" {
		t.Fatalf("got %q", meta.Title)
	}
}

func TestDescriptionCountsAndNamesTheGate(t *testing.T) {
	meta := og.FromAnalysis(flow.Analysis{
		Stats:     flow.Stats{Steps: 10, Arms: 2, Panels: 4, Notes: 3},
		FirstGate: "permission articles.read",
	})
	want := "10 steps · 2 arms · 4 panels · 3 notes · gate: permission articles.read"
	if meta.Description != want {
		t.Fatalf("got %q, want %q", meta.Description, want)
	}
}

func TestDescriptionUsesSingularsAndSkipsMissingNotes(t *testing.T) {
	meta := og.FromAnalysis(flow.Analysis{Stats: flow.Stats{Steps: 1, Arms: 1, Panels: 1}})
	want := "1 step · 1 arm · 1 panel"
	if meta.Description != want {
		t.Fatalf("got %q, want %q", meta.Description, want)
	}
}

func TestClampCutsAtAWordBoundary(t *testing.T) {
	long := strings.Repeat("verylongwordwithoutspaces ", 20)
	meta := og.FromAnalysis(flow.Analysis{FirstNote: long})
	if len(meta.Title) > 111 {
		t.Fatalf("title not clamped: %d chars", len(meta.Title))
	}
	if !strings.HasSuffix(meta.Title, "…") {
		t.Fatalf("clamped title should end with an ellipsis: %q", meta.Title)
	}
}

func TestShortValuesAreLeftAlone(t *testing.T) {
	meta := og.FromAnalysis(flow.Analysis{FirstNote: "Articles"})
	if meta.Title != "Articles" {
		t.Fatalf("got %q", meta.Title)
	}
}
