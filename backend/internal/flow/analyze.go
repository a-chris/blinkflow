// Package flow reads just enough of a blinkflow document to describe it in a
// link preview: how big it is, what it is about, and what its first gate is.
//
// It is a deliberate mirror of the counting rules in the TypeScript parser
// (frontend/src/lang/parser.ts) rather than a second full parser: the server
// never renders a diagram, it only needs numbers and a title. testdata/og holds
// fixtures both implementations must agree on, so the two cannot drift
// silently.
package flow

import (
	"regexp"
	"strconv"
	"strings"
)

// Stats counts the parts of a document, matching the playground's status bar.
type Stats struct {
	// Steps counts node lines, folds included. Panels are not nodes, and
	// panel bodies are text.
	Steps int
	// Arms counts `label:` lines, reserved and free-form.
	Arms int
	// Panels counts `>` openers, including nested ones: the field name is the
	// card's, the language calls the line an accordion.
	Panels int
	// Notes counts `#` notes, with consecutive lines merging into one note.
	Notes int
}

// Analysis is a document described for a preview card.
type Analysis struct {
	Stats
	// FirstNote is the first note written before any step, if there is one.
	FirstNote string
	// FirstStep is the first step-like line with text.
	FirstStep string
	// FirstGate is the text of the first `gate:` line.
	FirstGate string
}

// armLine mirrors ARM_LINE: labels start with a letter and may contain word
// characters, spaces and hyphens, so `x:y` stays plain text.
var armLine = regexp.MustCompile(`^([A-Za-z][\w \-]*?):(?:\s+(.*))?$`)

// actorLine mirrors ACTOR_LINE.
var actorLine = regexp.MustCompile(`^@[\w.\-]+$`)

type rawLine struct {
	indent int
	text   string
	blank  bool
}

// tally identifies one note owner: a step, a panel, or the document itself.
// Notes count towards the document total, while merging is decided by this
// identity, so two notes under different steps stay two notes even at the same
// indent. The id is what makes the identity real: pointers to empty structs may
// alias, and then every note would look like it belonged to the document.
type tally struct {
	id int
}

// noteChain is the run of `#` lines currently merging into a single note.
type noteChain struct {
	owner  *tally
	indent int
}

type component struct {
	indent int
	tally  *tally
}

// lineBreaks mirrors the parser's `source.replace(/\r\n?/g, "\n")`: a lone CR
// separates lines just like a CRLF, or the two implementations would disagree
// about how many steps a document has.
var lineBreaks = strings.NewReplacer("\r\n", "\n", "\r", "\n")

// Analyze describes a document for a link preview.
func Analyze(source string) Analysis {
	a := &analyzer{}
	a.document = a.newTally()
	a.walk(toRaw(strings.Split(lineBreaks.Replace(source), "\n")))
	return a.Analysis
}

func toRaw(lines []string) []rawLine {
	raw := make([]rawLine, len(lines))
	for index, line := range lines {
		indent, text := measure(line)
		raw[index] = rawLine{indent: indent, text: text, blank: text == ""}
	}
	return raw
}

type analyzer struct {
	Analysis
	document *tally
	tallies  int
}

func (a *analyzer) newTally() *tally {
	a.tallies++
	return &tally{id: a.tallies}
}

func (a *analyzer) walk(lines []rawLine) {
	components := []component{}
	var chain *noteChain
	index := 0

	for index < len(lines) {
		line := lines[index]
		index++
		indent, body := line.indent, line.text

		if line.blank {
			chain = nil
			continue
		}

		if strings.HasPrefix(body, "#") {
			owner := a.document
			if last := attachTarget(components, indent); last != nil {
				owner = last
			}
			chain = a.note(owner, chain, indent, body)
			continue
		}

		chain = nil

		if isAccordionLine(body) {
			// A `>` is a component wherever it is written, so it counts as a step
			// and, when it hides anything, its opener as a panel.
			text := stripAnchor(strings.TrimSpace(strings.TrimPrefix(body, ">")))
			inner, next := collectBody(lines, index, indent)
			index = next
			a.Steps++
			if a.FirstStep == "" && text != "" {
				a.FirstStep = text
			}
			components = append(components, component{indent: indent, tally: a.accordionBody(inner)})
			continue
		}

		kind, text := classify(body)
		text = stripAnchor(text)
		a.Steps++
		if kind == "arm" {
			a.Arms++
		}
		if kind == "gate" && a.FirstGate == "" {
			a.FirstGate = text
		}
		if a.FirstStep == "" && text != "" && isStepKind(kind) {
			a.FirstStep = text
		}
		components = append(components, component{indent: indent, tally: a.newTally()})
	}
}

// accordionBody counts what an accordion hides and returns the owner the `#` lines
// after it belong to. An accordion with nothing under it opens nothing — the
// parser stores no body and draws the line plain — so it counts as a step only;
// the tally exists either way, because it is the note owner.
func (a *analyzer) accordionBody(body []rawLine) *tally {
	panel := a.newTally()
	// The body is scanned either way: its `#` lines are notes on the accordion,
	// and the parser moves them onto the line when there is no detail at all.
	a.scanPanelBody(body, panel)
	if hasContent(body) {
		a.Panels++
	}
	return panel
}

// hasContent reports whether a body holds anything the parser keeps in it. A
// `#` line belongs to the accordion as a note and blanks are trimmed, so a body
// of notes and blanks alone is no body at all — the line is drawn plain and
// counts no panel.
func hasContent(body []rawLine) bool {
	for _, line := range body {
		if line.blank || strings.HasPrefix(line.text, "#") {
			continue
		}
		return true
	}
	return false
}

// scanPanelBody counts the nested panels and the notes inside one panel body.
// Everything else in a body is raw text and never a step.
func (a *analyzer) scanPanelBody(body []rawLine, own *tally) {
	components := []component{}
	var chain *noteChain
	index := 0

	for index < len(body) {
		line := body[index]
		index++

		if line.blank {
			// Blank lines inside a body do not end a note, matching the parser.
			continue
		}

		if strings.HasPrefix(line.text, "#") {
			owner := own
			if last := attachTarget(components, line.indent); last != nil {
				owner = last
			}
			chain = a.note(owner, chain, line.indent, line.text)
			continue
		}

		chain = nil

		if isAccordionLine(line.text) {
			nested, next := collectBody(body, index, line.indent)
			index = next
			a.Panels++
			panel := a.newTally()
			a.scanPanelBody(nested, panel)
			components = append(components, component{indent: line.indent, tally: panel})
		}
	}
}

// note records one `#` line, merging it into the open note when it continues
// the same run at the same indent. Blank lines and other lines end the run.
func (a *analyzer) note(owner *tally, chain *noteChain, indent int, body string) *noteChain {
	text := noteText(body)
	if text == "" && chain == nil {
		return nil
	}
	if chain != nil && chain.owner == owner && chain.indent == indent {
		return chain
	}
	a.Notes++
	if owner == a.document && a.FirstNote == "" {
		a.FirstNote = text
	}
	return &noteChain{owner: owner, indent: indent}
}

// isStepKind reports whether a node can name the document. Actors and arms
// describe structure, so they never become a title.
func isStepKind(kind string) bool {
	switch kind {
	case "step", "failure", "async", "return":
		return true
	}
	return false
}

func attachTarget(components []component, indent int) *tally {
	for index := len(components) - 1; index >= 0; index-- {
		if components[index].indent <= indent {
			return components[index].tally
		}
	}
	return nil
}

// collectBody gathers the lines opened by a `>` at openerIndent. A blank line
// never closes a body; the next line at the opener's indent or shallower does.
func collectBody(lines []rawLine, start, openerIndent int) ([]rawLine, int) {
	body := []rawLine{}
	index := start
	for index < len(lines) {
		if lines[index].blank {
			body = append(body, rawLine{blank: true})
			index++
			continue
		}
		if lines[index].indent <= openerIndent {
			break
		}
		body = append(body, lines[index])
		index++
	}
	return body, index
}

// measure returns the indent and the trimmed line body. Tabs count as two
// columns; the parser reports them as an error but still lays them out.
func measure(line string) (int, string) {
	indent := 0
	index := 0
	for index < len(line) {
		switch line[index] {
		case ' ':
			indent++
		case '\t':
			indent += 2
		default:
			return indent, strings.TrimRight(line[index:], " \t")
		}
		index++
	}
	return indent, ""
}

// isAccordionLine mirrors the parser: `>` makes a line an accordion, which is a
// component wherever it is written — first child, sibling, or block of its own.
func isAccordionLine(body string) bool {
	return body == ">" || strings.HasPrefix(body, "> ") || strings.HasPrefix(body, ">\t")
}

func noteText(body string) string {
	return strings.TrimSpace(strings.TrimLeft(body, "#"))
}

// anchorTail mirrors ANCHOR_TAIL: `@path:line` at the end of a line is a source
// anchor, not part of what the line says, so the card must not show it.
var anchorTail = regexp.MustCompile(`(?:^|\s)@([^\s@]+)$`)

// stripAnchor is the parser's extractAnchor, minus the anchor it does not use:
// a suffix that is not a well-formed anchor stays in the text, so a malformed
// one never silently shortens the card's title.
func stripAnchor(text string) string {
	match := anchorTail.FindStringSubmatchIndex(text)
	if match == nil {
		return text
	}
	payload := text[match[2]:match[3]]
	// `@user` is an actor, not a path: anchors have a slash or a dot in them.
	if !strings.ContainsAny(payload, "./") {
		return text
	}
	parts := strings.Split(payload, ":")
	if len(parts) > 3 || !numericTail(parts[1:]) {
		return text
	}
	return strings.TrimRight(text[:match[0]], " \t")
}

// numericTail reports whether every optional `:line[:column]` part is a number.
// An empty part is absent, which is how the parser reads a trailing colon.
func numericTail(parts []string) bool {
	for _, part := range parts {
		if part == "" {
			continue
		}
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

// classify names a node line. Only the kind matters for counting, but "arm" and
// "gate" decide the counts and the card, so they must match the parser exactly.
func classify(body string) (kind, text string) {
	switch {
	case body == "->" || strings.HasPrefix(body, "-> "):
		return "step", strings.TrimSpace(body[2:])
	case strings.HasPrefix(body, "- "):
		return "step", body[2:]
	case strings.HasPrefix(body, "! "):
		return "failure", body[2:]
	case strings.HasPrefix(body, "~ "):
		return "async", body[2:]
	case strings.HasPrefix(body, "< "):
		return "return", body[2:]
	case body == "-":
		return "step", ""
	case body == "!":
		return "failure", ""
	case body == "~":
		return "async", ""
	case body == "<":
		return "return", ""
	}

	if actorLine.MatchString(body) {
		return "actor", body
	}

	if match := armLine.FindStringSubmatch(body); match != nil {
		label := strings.TrimSpace(match[1])
		value := strings.TrimSpace(match[2])
		// `gate:` is the one reserved word with its own kind; every other
		// `label:` counts as an arm, reserved or free-form.
		if label == "gate" {
			return "gate", value
		}
		return "arm", value
	}

	if strings.ContainsRune("-!~<", rune(body[0])) {
		return "step", body
	}

	return "step", body
}
