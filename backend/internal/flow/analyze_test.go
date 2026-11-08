package flow_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lightgram/backend/internal/flow"
)

// The fixtures are shared with the frontend (frontend/src/lang/preview.test.ts).
// Both implementations assert the same expected values, so a change in either
// counting rule breaks a test instead of silently producing a wrong card.
type expected struct {
	Steps     int    `json:"steps"`
	Arms      int    `json:"arms"`
	Panels    int    `json:"panels"`
	Notes     int    `json:"notes"`
	FirstNote string `json:"firstNote"`
	FirstStep string `json:"firstStep"`
	FirstGate string `json:"firstGate"`
}

const fixtures = "../../../testdata/og"

func TestAnalyzeMatchesSharedFixtures(t *testing.T) {
	documents, err := filepath.Glob(filepath.Join(fixtures, "*.lg"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(documents) < 3 {
		t.Fatalf("expected at least 3 fixtures, found %d", len(documents))
	}

	for _, document := range documents {
		name := strings.TrimSuffix(filepath.Base(document), ".lg")
		t.Run(name, func(t *testing.T) {
			source, err := os.ReadFile(document)
			if err != nil {
				t.Fatalf("read document: %v", err)
			}
			raw, err := os.ReadFile(filepath.Join(fixtures, name+".json"))
			if err != nil {
				t.Fatalf("read expectation: %v", err)
			}

			var want expected
			if err := json.Unmarshal(raw, &want); err != nil {
				t.Fatalf("parse expectation: %v", err)
			}

			got := flow.Analyze(string(source))
			compare(t, got, want)
		})
	}
}

func compare(t *testing.T, got flow.Analysis, want expected) {
	t.Helper()
	if got.Steps != want.Steps {
		t.Errorf("steps: got %d, want %d", got.Steps, want.Steps)
	}
	if got.Arms != want.Arms {
		t.Errorf("arms: got %d, want %d", got.Arms, want.Arms)
	}
	if got.Panels != want.Panels {
		t.Errorf("panels: got %d, want %d", got.Panels, want.Panels)
	}
	if got.Notes != want.Notes {
		t.Errorf("notes: got %d, want %d", got.Notes, want.Notes)
	}
	if got.FirstNote != want.FirstNote {
		t.Errorf("firstNote: got %q, want %q", got.FirstNote, want.FirstNote)
	}
	if got.FirstStep != want.FirstStep {
		t.Errorf("firstStep: got %q, want %q", got.FirstStep, want.FirstStep)
	}
	if got.FirstGate != want.FirstGate {
		t.Errorf("firstGate: got %q, want %q", got.FirstGate, want.FirstGate)
	}
}

func TestAnalyzeEdgeCases(t *testing.T) {
	cases := []struct {
		name   string
		source string
		want   flow.Analysis
	}{
		{
			name:   "empty",
			source: "",
			want:   flow.Analysis{},
		},
		{
			name:   "blank lines only",
			source: "\n\n   \n",
			want:   flow.Analysis{},
		},
		{
			name:   "panel text is never a step",
			source: "- a\n  > panel\n    - not a step\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1, Panels: 1},
				FirstStep: "a",
			},
		},
		{
			name:   "a blank line ends a note run",
			source: "# one\n\n# two\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Notes: 2},
				FirstNote: "one",
			},
		},
		{
			name:   "consecutive notes merge",
			source: "# one\n# two\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Notes: 1},
				FirstNote: "one",
			},
		},
		{
			name:   "an arrow is still a step",
			source: "-> old arrow\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1},
				FirstStep: "old arrow",
			},
		},
		{
			name:   "x:y is not an arm, it is text",
			source: "- ratio x:y\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1},
				FirstStep: "ratio x:y",
			},
		},
		{
			name:   "actors never become the title",
			source: "@visitor\n- lands on /\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2},
				FirstStep: "lands on /",
			},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			compare(t, flow.Analyze(test.source), expected{
				Steps:     test.want.Steps,
				Arms:      test.want.Arms,
				Panels:    test.want.Panels,
				Notes:     test.want.Notes,
				FirstNote: test.want.FirstNote,
				FirstStep: test.want.FirstStep,
				FirstGate: test.want.FirstGate,
			})
		})
	}
}
