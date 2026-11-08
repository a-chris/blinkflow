import type { Anchor } from './parser';

/** Editors we can deep-link into from the browser. */
export type EditorId = 'vscode' | 'cursor' | 'zed' | 'sublime' | 'file';

export interface EditorOption {
  id: EditorId;
  label: string;
  hint: string;
}

export const EDITORS: readonly EditorOption[] = [
  { id: 'vscode', label: 'VS Code', hint: 'vscode://file/path:line:col' },
  { id: 'cursor', label: 'Cursor', hint: 'cursor://file/path:line:col' },
  { id: 'zed', label: 'Zed', hint: 'zed://file/path:line:col' },
  { id: 'sublime', label: 'Sublime Text', hint: 'subl://open?url=…' },
  { id: 'file', label: 'file://', hint: 'opens the file in the browser' },
];

export const DEFAULT_EDITOR: EditorId = 'vscode';

export function normalizeBase(baseDir: string): string {
  const trimmed = baseDir.trim().replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '/') return '';
  return trimmed;
}

/** Join a base directory with a repo-relative anchor path. */
export function resolvePath(baseDir: string, path: string): string {
  if (path.startsWith('/')) return path.replace(/\/{2,}/g, '/');
  const base = normalizeBase(baseDir);
  if (base === '') return `/${path}`;
  return `${base}/${path}`.replace(/\/{2,}/g, '/');
}

function encodeSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildOpenUrl(editor: EditorId, baseDir: string, anchor: Anchor): string {
  const absolute = resolvePath(baseDir, anchor.path);
  const path = encodeSegments(absolute);
  const line = anchor.line ?? 1;
  const column = anchor.column ?? 1;

  switch (editor) {
    case 'vscode':
      return `vscode://file${path}:${line}:${column}`;
    case 'cursor':
      return `cursor://file${path}:${line}:${column}`;
    case 'zed':
      return `zed://file${path}:${line}:${column}`;
    case 'sublime':
      return `subl://open?url=file://${path}&line=${line}`;
    case 'file':
      return `file://${path}`;
  }
}

export function displayRef(anchor: Anchor): string {
  const name = anchor.path.split('/').pop() ?? anchor.path;
  return anchor.line ? `${name}:${anchor.line}` : name;
}
