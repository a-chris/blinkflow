/**
 * The share dialog: one button, two ways to carry the same document.
 *
 * Both links hold the whole document — pick by what you are doing with it, not
 * by what it protects. Pasting into a chat is a person opening a link; pasting
 * into a page is a reference that should render where it sits.
 */
export type ShareMode = 'simple' | 'embedded';

interface Choice {
  mode: ShareMode;
  name: string;
  hint: string;
}

const CHOICES: readonly Choice[] = [
  { mode: 'simple', name: 'simple share', hint: 'good for humans' },
  { mode: 'embedded', name: 'embedded share', hint: 'good for documentation and reference' },
];

let dialog: HTMLDialogElement | null = null;
let onChoose: ((mode: ShareMode) => void) | null = null;
let embeddedButton: HTMLButtonElement | null = null;
let embeddedHint: HTMLElement | null = null;
let embeddedHintText = '';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function build(): HTMLDialogElement {
  const node = document.createElement('dialog');
  node.className = 'lg-share-dialog';
  node.setAttribute('aria-labelledby', 'lg-share-title');

  const head = element('header', 'lg-share-head');
  const title = element('span', 'lg-share-title');
  title.id = 'lg-share-title';
  title.textContent = 'share this document';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lg-share-close';
  close.textContent = 'close';
  close.addEventListener('click', () => closeShareDialog());
  head.append(title, close);

  const options = element('div', 'lg-share-options');

  for (const choice of CHOICES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lg-share-option';
    button.dataset.mode = choice.mode;

    const name = element('span', 'lg-share-name');
    name.textContent = choice.name;
    const hint = element('span', 'lg-share-hint');
    hint.textContent = choice.hint;

    if (choice.mode === 'embedded') {
      embeddedButton = button;
      embeddedHint = hint;
      embeddedHintText = choice.hint;
    }

    button.append(name, hint);
    button.addEventListener('click', () => {
      const chosen = onChoose;
      closeShareDialog();
      chosen?.(choice.mode);
    });
    options.append(button);
  }

  node.append(head, options);
  // Clicking the backdrop lands on the dialog element itself.
  node.addEventListener('click', (event) => {
    if (event.target === node) closeShareDialog();
  });

  document.body.append(node);
  return node;
}

/**
 * Open the dialog; the callback runs once, after the dialog closes itself.
 *
 * `checkEmbedded` answers whether a server is actually listening where embedded
 * links point. If it says no, the option stays visible but cannot be picked —
 * handing out a link nobody can answer for is worse than saying so. It is
 * checked on every open, so starting the server does not need a page reload.
 */
export function openShareDialog(choose: (mode: ShareMode) => void, checkEmbedded?: () => Promise<boolean>): void {
  dialog ??= build();
  onChoose = choose;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  setEmbeddedAvailable(true, '');
  if (!checkEmbedded) return;
  void checkEmbedded().then((ready) => {
    if (dialog?.hasAttribute('open')) setEmbeddedAvailable(ready, 'needs the card server — run make dev');
  });
}

function setEmbeddedAvailable(available: boolean, reason: string): void {
  if (!embeddedButton || !embeddedHint) return;
  embeddedButton.disabled = !available;
  embeddedHint.textContent = available ? embeddedHintText : reason;
}

export function closeShareDialog(): void {
  if (!dialog) return;
  onChoose = null;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}
