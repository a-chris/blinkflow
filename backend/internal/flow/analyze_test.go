package flow_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"blinkflow/backend/internal/flow"
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
			name:   "accordion body text is never a step",
			source: "- a\n  > accordion\n    - not a step\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2, Panels: 1},
				FirstStep: "a",
			},
		},
		{
			name:   "a fold with nothing under it is a step, not a panel",
			source: "- a\n> Deploy::Run.call\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2},
				FirstStep: "a",
			},
		},
		{
			name:   "a `>` at a node's own indent that hides nothing is a step, not a panel",
			source: "- a\n> peek only\n- b\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 3},
				FirstStep: "a",
			},
		},
		{
			name:   "a `>` with nothing above it is a component of its own",
			source: "> shell transcript\n  $ ls\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1, Panels: 1},
				FirstStep: "shell transcript",
			},
		},
		{
			name:   "a `>` with nothing above it and nothing under it is a step",
			source: "> shell transcript\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1},
				FirstStep: "shell transcript",
			},
		},
		{
			name:   "a fold with nothing under it still owns the notes after it",
			source: "> Deploy::Run.call\n# the only irreversible step\n- b\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2, Notes: 1},
				FirstStep: "Deploy::Run.call",
			},
		},
		{
			name:   "a blank line body is no body",
			source: "> Deploy::Run.call\n\n   \n- b\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2},
				FirstStep: "Deploy::Run.call",
			},
		},
		{
			// `> nested peek` opens nothing, so it is the last line of the body
			// rather than a panel — the parser draws it as text.
			name:   "a fold counts as a step and a panel, a bare nested `>` as neither",
			source: "- a\n> Jev::Client.classify(state:)\n  - one fact\n  > nested peek\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2, Panels: 1},
				FirstStep: "a",
			},
		},
		{
			name:   "a nested `>` with a body counts as a panel",
			source: "> outer\n  - fact\n  > nested\n    - detail\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1, Panels: 2},
				FirstStep: "outer",
			},
		},
		{
			name:   "a `>` indented under a line is a component of that line, not an aside",
			source: "- a\n  > peek\n    - body\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2, Panels: 1},
				FirstStep: "a",
			},
		},
		{
			name:   "a body of notes and blanks is no body",
			source: "> peek\n  # a note, no detail\n\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1, Notes: 1},
				FirstStep: "peek",
			},
		},
		{
			name:   "a malformed anchor stays part of the line",
			source: "- call it @app/x.go:nope\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 1},
				FirstStep: "call it @app/x.go:nope",
			},
		},
		{
			name:   "a lone CR separates lines",
			source: "- a\r- b\r",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 2},
				FirstStep: "a",
			},
		},
		{
			name:   "a `+` line is a plain step again",
			source: "- a\n  + Child::Call.call()\n    - one fact\n",
			want: flow.Analysis{
				Stats:     flow.Stats{Steps: 3},
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
