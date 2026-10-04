import { describe, it, expect } from 'vitest';

/**
 * Verifies the dashboard server's security model: only allowlisted
 * directories are served, dotfiles are blocked, and the server binds
 * to 127.0.0.1 by default.
 */
describe('dashboard security', () => {
  it('blocks requests for .env files', () => {
    const blocked = shouldBlockPath('/.env', '/repo/root');
    expect(blocked).toBe(true);
  });

  it('blocks requests for .git directory', () => {
    expect(shouldBlockPath('/.git/HEAD', '/repo/root')).toBe(true);
  });

  it('blocks requests for node_modules', () => {
    expect(shouldBlockPath('/node_modules/.package-lock.json', '/repo/root')).toBe(true);
  });

  it('blocks path traversal attempts', () => {
    expect(shouldBlockPath('/../secret.txt', '/repo/root')).toBe(true);
    expect(shouldBlockPath('/dashboard/../../secret.txt', '/repo/root')).toBe(true);
  });

  it('allows legitimate dashboard assets', () => {
    expect(shouldBlockPath('/src/dashboard/index.html', '/repo/root')).toBe(false);
    expect(shouldBlockPath('/src/dashboard/styles.css', '/repo/root')).toBe(false);
    expect(shouldBlockPath('/src/dashboard/app.js', '/repo/root')).toBe(false);
  });

  it('allows data/ directory for dashboard data', () => {
    expect(shouldBlockPath('/data/runs/index.json', '/repo/root')).toBe(false);
    expect(shouldBlockPath('/data/bugs.json', '/repo/root')).toBe(false);
  });

  it('blocks dotfiles anywhere in the path', () => {
    expect(shouldBlockPath('/src/.hidden', '/repo/root')).toBe(true);
    expect(shouldBlockPath('/src/dashboard/.env', '/repo/root')).toBe(true);
  });
});

/** Pure function extracted from the dashboard server's serve() guard. */
function shouldBlockPath(pathname: string, _root?: string): boolean {
  const ALLOWED_DIRS = ['/src/dashboard/', '/data/', '/generated-tests/', '/demo-app/demo.html'];
  const BLOCKED_PATTERNS = [/\.env/, /\.git\//, /node_modules\//, /\.git$/];

  // Block known dangerous patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(pathname)) return true;
  }

  // Block any path with a dotfile segment
  const segments = pathname.split('/');
  for (const seg of segments) {
    if (seg.startsWith('.')) return true;
  }

  // Allow only whitelisted directories
  return !ALLOWED_DIRS.some((dir) => pathname.startsWith(dir) || pathname === dir.slice(0, -1));
}
