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

export interface Panel {
  /** Summary shown while collapsed. */
  peek: string;
  /** Raw lines, dedented. Never parsed. */
  body: string[];
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

function dedent(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  const indents = out.filter((l) => l.trim() !== '').map((l) => measure(l).indent);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return out.map((l) => (l.trim() === '' ? '' : l.slice(min)));
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
      const peek = body.slice(1).trim();
      let target: LNode | undefined;
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth].indent < indent) {
          target = stack[depth];
          break;
        }
      }
      if (!target) {
        issues.push({
          line: lineNo,
          message: 'panel `>` has no node above it — indent it under the step it describes',
          severity: 'error',
        });
        continue;
      }

      const bodyLines: string[] = [];
      while (index < lines.length) {
        const next = lines[index];
        if (next.trim() === '') {
          bodyLines.push('');
          index += 1;
          continue;
        }
        if (measure(next).indent <= indent) break;
        bodyLines.push(next);
        index += 1;
      }
      target.panels.push({ peek, body: dedent(bodyLines), line: lineNo });
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

export interface FlowStats {
  nodes: number;
  panels: number;
  arms: number;
  errors: number;
  hints: number;
}

export function stats(result: ParseResult): FlowStats {
  let panels = 0;
  let arms = 0;
  for (const node of result.nodes) {
    panels += node.panels.length;
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
