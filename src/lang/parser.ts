/**
 * lightgram parser
 *
 * The whole language: indentation is the tree, a handful of line-leading
 * markers give a line its kind, `>` opens a collapsible detail panel, and a
 * trailing @path:line is a source anchor. Panels are raw text; everything
 * else is a node.
 */

export type NodeKind =
  | 'step'
  | 'failure'
  | 'async'
  | 'return'
  | 'actor'
  | 'gate'
  | 'arm';

export type ReservedArm = 'gate' | 'yes' | 'no' | 'else' | 'err';

/** The only words that get special treatment. Everything else is free-form. */
export const RESERVED_ARMS: readonly ReservedArm[] = ['gate', 'yes', 'no', 'else', 'err'];

/** Flow markers. One node kind each, always followed by a space. */
export const FLOW_MARKERS = ['-', '>', '!', '~', '<'] as const;

export interface Anchor {
  path: string;
  line?: number;
  column?: number;
}

export type PanelBodyItem =
  | { kind: 'text'; text: string; line: number }
  | { kind: 'panel'; panel: Panel; line: number };

export interface Panel {
  /** Summary shown while collapsed. */
  peek: string;
  /** A source anchor written at the end of the peek line. */
  anchor?: Anchor;
  /**
   * Body in source order: raw text lines, and panels nested with `>`.
   * Text keeps its relative indentation, minus the body's common margin.
   */
  body: PanelBodyItem[];
  line: number;
}

export interface LNode {
  kind: NodeKind;
  text: string;
  marker: string;
  /** Arm label, e.g. `draft` for `draft: ...` */
  label?: string;
  reserved?: ReservedArm;
  indent: number;
  depth: number;
  line: number;
  anchor?: Anchor;
  panels: Panel[];
  children: LNode[];
}

export interface ParseIssue {
  line: number;
  message: string;
  severity: 'error' | 'hint';
}

export interface ParseResult {
  roots: LNode[];
  /** Every node in source order. */
  nodes: LNode[];
  issues: ParseIssue[];
}

// Arm labels may be phrases (`new user:`); they must start with a letter and
// contain only word characters, spaces and hyphens. `x:y` stays plain text.
const ARM_LINE = /^([A-Za-z][\w \-]*?):(?:\s+(.*))?$/;
const ACTOR_LINE = /^@[\w.-]+$/;
const ANCHOR_TAIL = /(?:^|\s)@([^\s@]+)$/;
const STEP_PREFIXES = [
  ['- ', 'step', '-'],
  ['! ', 'failure', '!'],
  ['~ ', 'async', '~'],
  ['< ', 'return', '<'],
] as const;

interface MeasuredLine {
  indent: number;
  body: string;
  tabbed: boolean;
}

interface Classified {
  kind: NodeKind;
  text: string;
  marker: string;
  label?: string;
  reserved?: ReservedArm;
  hint?: string;
}

function measure(line: string): MeasuredLine {
  let indent = 0;
  let index = 0;
  let tabbed = false;
  while (index < line.length) {
    const char = line[index];
    if (char === ' ') indent += 1;
    else if (char === '\t') {
      tabbed = true;
      indent += 2;
    } else break;
    index += 1;
  }
  return { indent, body: line.slice(index).trimEnd(), tabbed };
}

function isPanelLine(body: string): boolean {
  return body === '>' || body.startsWith('> ') || body.startsWith('>\t');
}

interface RawLine {
  indent: number;
  /** The original line, indentation included. */
  raw: string;
  line: number;
}

function trimTrailingBlank(items: PanelBodyItem[]): PanelBodyItem[] {
  const out = [...items];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.kind !== 'text' || last.text.trim() !== '') break;
    out.pop();
  }
  return out;
}

function classify(body: string): Classified {
  if (body === '->' || body.startsWith('-> ')) {
    return {
      kind: 'step',
      text: body.slice(2).trim(),
      marker: '-',
      hint: '`->` is the old arrow — `-` is enough now',
    };
  }

  for (const [prefix, kind, marker] of STEP_PREFIXES) {
    if (body.startsWith(prefix)) return { kind, text: body.slice(2), marker };
  }

  if (body === '-') return { kind: 'step', text: '', marker: '-' };
  if (body === '!') return { kind: 'failure', text: '', marker: '!' };
  if (body === '~') return { kind: 'async', text: '', marker: '~' };
  if (body === '<') return { kind: 'return', text: '', marker: '<' };

  if (ACTOR_LINE.test(body)) return { kind: 'actor', text: body, marker: '@' };

  const arm = ARM_LINE.exec(body);
  if (arm) {
    const label = arm[1].trim();
    const text = (arm[2] ?? '').trim();
    const proseHint =
      label.split(/\s+/).length > 4
        ? `\`${label}:\` looks like a sentence — keep arm labels short, nest the prose in a \`>\` panel`
        : undefined;
    if (label === 'gate') {
      return { kind: 'gate', text, marker: 'gate', label, reserved: 'gate' };
    }
    const reserved = RESERVED_ARMS.includes(label as ReservedArm)
      ? (label as ReservedArm)
      : undefined;
    if (reserved) return { kind: 'arm', text, marker: label, label, reserved };
    return proseHint
      ? { kind: 'arm', text, marker: label, label, hint: proseHint }
      : { kind: 'arm', text, marker: label, label };
  }

  if (/^[-!~<]/.test(body)) {
    const marker = body[0];
    return {
      kind: 'step',
      text: body,
      marker: '-',
      hint: `flow markers need a space after them — write \`${marker} your text\``,
    };
  }

  // An unmarked line is still a step: a flow's first line rarely needs a dash,
  // and prose belongs in a `>` panel.
  return { kind: 'step', text: body, marker: '-' };
}

function extractAnchor(text: string): { text: string; anchor?: Anchor } {
  const match = ANCHOR_TAIL.exec(text);
  if (!match) return { text };

  const payload = match[1];
  // `@user` is an actor, not a path: anchors have a slash or a dot in them.
  if (!/[./]/.test(payload)) return { text };

  const [path, lineRaw, columnRaw] = payload.split(':');
  if (!path) return { text };

  const line = lineRaw ? Number(lineRaw) : undefined;
  const column = columnRaw ? Number(columnRaw) : undefined;
  if (line !== undefined && !Number.isFinite(line)) return { text };
  if (column !== undefined && !Number.isFinite(column)) return { text };

  const anchor: Anchor = { path };
  if (line !== undefined) anchor.line = line;
  if (column !== undefined) anchor.column = column;

  const kept = text.slice(0, match.index).trimEnd();
  return { text: kept, anchor };
}

/** Index where the lines opened by `openerIndent` stop belonging to it. */
function boundOf(raw: RawLine[], start: number, openerIndent: number): number {
  let end = start;
  while (end < raw.length) {
    const line = raw[end];
    if (line.raw.trim() !== '' && line.indent <= openerIndent) break;
    end += 1;
  }
  return end;
}

/**
 * Build one panel from the raw lines between `start` and `end`.
 *
 * Each panel dedents to its own margin, so a nested body lines up under its own
 * opener. A line whose first non-space character is `>` opens a nested panel;
 * everything else stays raw text, so `\>` is available for a literal `>`.
 */
function buildPanel(
  peek: string,
  anchor: Anchor | undefined,
  raw: RawLine[],
  start: number,
  end: number,
  line: number,
): Panel {
  const slice = raw.slice(start, end);
  const filled = slice.filter((l) => l.raw.trim() !== '');
  const base = filled.length > 0 ? Math.min(...filled.map((l) => l.indent)) : 0;

  const items: PanelBodyItem[] = [];
  let index = start;

  while (index < end) {
    const current = raw[index];
    const text = current.raw.slice(base).trimEnd();

    if (text === '') {
      items.push({ kind: 'text', text: '', line: current.line });
      index += 1;
      continue;
    }

    if (text.startsWith('>')) {
      const { text: nestedPeek, anchor: nestedAnchor } = extractAnchor(text.slice(1).trim());
      const nestedEnd = boundOf(raw, index + 1, current.indent);
      items.push({
        kind: 'panel',
        panel: buildPanel(nestedPeek, nestedAnchor, raw, index + 1, nestedEnd, current.line),
        line: current.line,
      });
      index = nestedEnd;
      continue;
    }

    items.push({
      kind: 'text',
      text: text.startsWith('\\>') ? text.slice(1) : text,
      line: current.line,
    });
    index += 1;
  }

  const panel: Panel = { peek, body: trimTrailingBlank(items), line };
  if (anchor) panel.anchor = anchor;
  return panel;
}

export function parse(source: string): ParseResult {
  const issues: ParseIssue[] = [];
  const roots: LNode[] = [];
  const nodes: LNode[] = [];
  const stack: LNode[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const hinted = new Set<string>();

  let index = 0;
  while (index < lines.length) {
    const lineNo = index + 1;
    const { indent, body, tabbed } = measure(lines[index]);
    index += 1;

    if (body === '') continue;
    if (body.startsWith('#')) continue;
    if (tabbed && !hinted.has('tab')) {
      hinted.add('tab');
      issues.push({
        line: lineNo,
        message: 'tab indentation is not supported — use spaces',
        severity: 'error',
      });
    }

    if (isPanelLine(body)) {
      const { text: peek, anchor: peekAnchor } = extractAnchor(body.slice(1).trim());
      // Attach to the nearest line above at the same or a shallower indent —
      // not to the nearest ancestor. A panel written between siblings belongs
      // to the sibling above it, so it renders where it was written.
      let target: LNode | undefined;
      for (let seen = nodes.length - 1; seen >= 0; seen -= 1) {
        if (nodes[seen].indent <= indent) {
          target = nodes[seen];
          break;
        }
      }
      if (!target) {
        issues.push({
          line: lineNo,
          message: 'panel `>` has no line above it — indent it under the step it describes',
          severity: 'error',
        });
        continue;
      }

      const raw: RawLine[] = [];
      while (index < lines.length) {
        const next = lines[index];
        if (next.trim() === '') {
          raw.push({ indent: -1, raw: '', line: index + 1 });
          index += 1;
          continue;
        }
        const measured = measure(next);
        if (measured.indent <= indent) break;
        raw.push({ indent: measured.indent, raw: next.trimEnd(), line: index + 1 });
        index += 1;
      }
      target.panels.push(buildPanel(peek, peekAnchor, raw, 0, raw.length, lineNo));
      continue;
    }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];

    const classified = classify(body);
    if (classified.hint && !hinted.has(classified.hint)) {
      hinted.add(classified.hint);
      issues.push({ line: lineNo, message: classified.hint, severity: 'hint' });
    }

    const { text, anchor } = extractAnchor(classified.text);
    const node: LNode = {
      kind: classified.kind,
      text,
      marker: classified.marker,
      indent,
      depth: parent ? parent.depth + 1 : 0,
      line: lineNo,
      panels: [],
      children: [],
    };
    if (classified.label !== undefined) node.label = classified.label;
    if (classified.reserved !== undefined) node.reserved = classified.reserved;
    if (anchor) node.anchor = anchor;

    if (parent) parent.children.push(node);
    else roots.push(node);

    nodes.push(node);
    stack.push(node);
  }

  return { roots, nodes, issues };
}

/** Panels and child nodes share one source order. */
export type ContentItem =
  | { kind: 'panel'; line: number; panel: Panel }
  | { kind: 'node'; line: number; node: LNode };

/**
 * Merge a node's panels and children back into the order they were written.
 * A panel that appears above the children belongs above them; one written
 * further down stays down.
 */
export function contentOf(node: LNode): ContentItem[] {
  const items: ContentItem[] = [
    ...node.panels.map((panel) => ({ kind: 'panel' as const, line: panel.line, panel })),
    ...node.children.map((child) => ({ kind: 'node' as const, line: child.line, node: child })),
  ];
  return items.sort((a, b) => a.line - b.line);
}

export interface FlowStats {
  nodes: number;
  panels: number;
  arms: number;
  errors: number;
  hints: number;
}

function countPanels(panels: Panel[]): number {
  let total = 0;
  for (const panel of panels) {
    total += 1;
    for (const item of panel.body) {
      if (item.kind === 'panel') total += countPanels([item.panel]);
    }
  }
  return total;
}

export function stats(result: ParseResult): FlowStats {
  let panels = 0;
  let arms = 0;
  for (const node of result.nodes) {
    panels += countPanels(node.panels);
    if (node.kind === 'arm') arms += 1;
  }
  return {
    nodes: result.nodes.length,
    panels,
    arms,
    errors: result.issues.filter((i) => i.severity === 'error').length,
    hints: result.issues.filter((i) => i.severity === 'hint').length,
  };
}
