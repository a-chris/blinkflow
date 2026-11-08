import { describe, expect, it } from 'vitest';
import { buildOpenUrl, displayRef, resolvePath } from './anchors';

const BASE = '/home/dev/myapp';

describe('resolvePath', () => {
  it('joins a base directory and a relative anchor', () => {
    expect(resolvePath(BASE, 'app/services/x.rb')).toBe('/home/dev/myapp/app/services/x.rb');
  });

  it('leaves absolute anchor paths alone', () => {
    expect(resolvePath(BASE, '/etc/hosts')).toBe('/etc/hosts');
  });

  it('tolerates a trailing slash on the base and an empty base', () => {
    expect(resolvePath('/root/', 'a/b.rb')).toBe('/root/a/b.rb');
    expect(resolvePath('', 'a/b.rb')).toBe('/a/b.rb');
  });
});

describe('buildOpenUrl', () => {
  const anchor = { path: 'app/services/get_expenses.rb', line: 12, column: 4 };

  it('builds vscode, cursor and zed deep links', () => {
    expect(buildOpenUrl('vscode', BASE, anchor)).toBe(
      'vscode://file/home/dev/myapp/app/services/get_expenses.rb:12:4',
    );
    expect(buildOpenUrl('cursor', BASE, anchor)).toBe(
      'cursor://file/home/dev/myapp/app/services/get_expenses.rb:12:4',
    );
    expect(buildOpenUrl('zed', BASE, anchor)).toBe(
      'zed://file/home/dev/myapp/app/services/get_expenses.rb:12:4',
    );
  });

  it('builds a sublime link', () => {
    expect(buildOpenUrl('sublime', BASE, anchor)).toBe(
      'subl://open?url=file:///home/dev/myapp/app/services/get_expenses.rb&line=12',
    );
  });

  it('defaults to line 1, column 1', () => {
    expect(buildOpenUrl('vscode', '/root', { path: 'a.rb' })).toBe('vscode://file/root/a.rb:1:1');
    expect(buildOpenUrl('file', '/root', { path: 'a.rb' })).toBe('file:///root/a.rb');
  });

  it('percent-encodes segments but keeps the separators', () => {
    expect(buildOpenUrl('vscode', '/root', { path: 'my app/a b.rb', line: 2 })).toBe(
      'vscode://file/root/my%20app/a%20b.rb:2:1',
    );
  });
});

describe('displayRef', () => {
  it('shows the basename with the line number', () => {
    expect(displayRef({ path: 'app/services/get_expenses.rb', line: 12 })).toBe('get_expenses.rb:12');
    expect(displayRef({ path: 'app/services/get_expenses.rb' })).toBe('get_expenses.rb');
  });
});
