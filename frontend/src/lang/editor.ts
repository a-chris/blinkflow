import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { indentWithTab } from '@codemirror/commands';
import { basicSetup } from 'codemirror';

const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';

/**
 * A tiny stream tokenizer. Deliberately shallow: markers, reserved arms,
 * free-form arms and anchors. That is the entire language.
 */
export const lightgramLanguage = StreamLanguage.define({
  name: 'lightgram',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:->|[-!~<>])(?=\s|$)/)) return 'punctuation';
    if (stream.match(/^(?:gate|yes|no|else|err):/)) return 'keyword';
    if (stream.match(/^[A-Za-z_][\w-]*(?=:)/)) return 'atom';
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^@[^\s@]+/)) return 'link';
    stream.next();
    return null;
  },
  tokenTable: {
    punctuation: tags.punctuation,
    keyword: tags.keyword,
    atom: tags.atom,
    link: tags.link,
    comment: tags.comment,
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.punctuation, color: '#7d8590' },
  { tag: tags.keyword, color: '#e3b341', fontWeight: '600' },
  { tag: tags.atom, color: '#6cb6ff' },
  { tag: tags.link, color: '#7ee787', textDecoration: 'underline dotted' },
  { tag: tags.comment, color: '#5a6572', fontStyle: 'italic' },
]);

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: '#e6edf3',
      fontSize: '12px',
    },
    '.cm-scroller': {
      fontFamily: MONO,
      lineHeight: '1.7',
      overflow: 'auto',
    },
    '.cm-content': { padding: '14px 0', caretColor: '#7ee787' },
    '.cm-line': { padding: '0 14px' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#4d5865',
      border: 'none',
      paddingRight: '4px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8b949e' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.028)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(110,168,254,0.22)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(110,168,254,0.28)' },
    '.cm-cursor': { borderLeftColor: '#7ee787' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(227,179,65,0.2)' },
    '.cm-foldPlaceholder': { backgroundColor: 'rgba(255,255,255,0.08)', border: 'none' },
  },
  { dark: true },
);

export interface EditorOptions {
  doc: string;
  parent: HTMLElement;
  onChange: (doc: string) => void;
}

export function createEditor(options: EditorOptions): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        // Tab and Shift-Tab indent in units of spaces, never a literal tab:
        // the parser rejects tab indentation, so this is load-bearing.
        keymap.of([indentWithTab]),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        basicSetup,
        lightgramLanguage,
        syntaxHighlighting(highlight),
        theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
}
