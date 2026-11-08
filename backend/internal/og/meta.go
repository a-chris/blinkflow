// Package og derives the card metadata for one document.
//
// The rules are deliberately boring and content-derived, because a card is only
// worth having if it tells you what the document is:
//
//	title       first document note, else the first step, else "blinkflow"
//	description "<n> steps · <n> arms · <n> panels · <n> notes" [+ the first gate]
package og

import (
	"fmt"
	"strings"

	"blinkflow/backend/internal/flow"
)

// Meta is what goes into the head of a per-document page.
type Meta struct {
	Title       string
	Description string
}

// Longest values a card will show without cutting them off mid-word.
const (
	maxTitle       = 110
	maxDescription = 220
)

// FromAnalysis builds the card for one document.
func FromAnalysis(analysis flow.Analysis) Meta {
	title := firstLine(analysis.FirstNote)
	if title == "" {
		title = firstLine(analysis.FirstStep)
	}
	if title == "" {
		title = "Blinkflow"
	}

	return Meta{
		Title:       clamp(title, maxTitle),
		Description: clamp(describe(analysis), maxDescription),
	}
}

func describe(analysis flow.Analysis) string {
	stats := analysis.Stats
	parts := []string{
		fmt.Sprintf("%d %s", stats.Steps, plural(stats.Steps, "step", "steps")),
		fmt.Sprintf("%d %s", stats.Arms, plural(stats.Arms, "arm", "arms")),
		fmt.Sprintf("%d %s", stats.Panels, plural(stats.Panels, "panel", "panels")),
	}
	if stats.Notes > 0 {
		parts = append(parts, fmt.Sprintf("%d %s", stats.Notes, plural(stats.Notes, "note", "notes")))
	}
	if gate := firstLine(analysis.FirstGate); gate != "" {
		parts = append(parts, "gate: "+gate)
	}
	return strings.Join(parts, " · ")
}

func plural(count int, one, many string) string {
	if count == 1 {
		return one
	}
	return many
}

// firstLine keeps a multi-line note from pushing the useful part off the card.
func firstLine(value string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(value), "\n")
	return strings.TrimSpace(line)
}

// clamp shortens at a word boundary so a card never ends mid-word.
func clamp(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	cut := value[:limit]
	if space := strings.LastIndexByte(cut, ' '); space > limit/2 {
		cut = cut[:space]
	}
	return strings.TrimRight(cut, " ,;:·-") + "…"
}
