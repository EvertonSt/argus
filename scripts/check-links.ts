/**
 * check-links.ts — proves every internal link in the documentation resolves.
 *
 * A broken link in a README is the cheapest possible credibility loss: a
 * reviewer clicks the first link, gets a 404, and stops. No type checker and no
 * unit test can see it, which is exactly why it needs its own gate.
 *
 * Three checks:
 *   1. relative file links resolve on disk
 *   2. in-document anchors (`#section`) match a heading that exists
 *   3. no link points at a path this repository deleted during the rebuild
 *
 * External URLs are counted and reported, never fetched: a network call in a
 * gate turns an offline regression suite into a flaky one.
 *
 * Exit codes: 0 clean, 1 broken link, 2 could not run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = process.cwd();

/** Paths the rebuild deleted. A link to one of these is stale by definition. */
const REMOVED_PATHS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'the standalone CLI package (now src/lib + src/cli)', re: /(^|\/)cerberus-ci\// },
  { label: 'the standalone site package (now src/app)', re: /(^|\/)cerberus-site\// },
  { label: 'a phantom PORTFOLIO/ directory', re: /PORTFOLIO\// },
];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** GitHub's anchor algorithm: lowercase, spaces to dashes, punctuation dropped. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match?.[1]) anchors.add(slugify(match[1]));
  }
  return anchors;
}

function main(): void {
  let files: string[];
  try {
    files = git(['ls-files'])
      .split('\n')
      .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'));
  } catch {
    console.error('check-links: not a git repository (or git unavailable)');
    process.exit(2);
  }

  const findings: string[] = [];
  let checked = 0;
  let external = 0;

  for (const file of files) {
    // `git ls-files` lists tracked paths, which during a rename or a rebuild
    // includes files that are staged for deletion but gone from the working
    // tree. Reading one throws ENOENT and takes the whole check down, which
    // turns a deleted document into a red gate that says nothing about links.
    const absolute = join(ROOT, file);
    if (!existsSync(absolute)) continue;

    const markdown = readFileSync(absolute, 'utf8');
    const ownAnchors = anchorsOf(markdown);
    // A link to another file is checked against that file's own anchors.
    const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

    for (let match = linkRe.exec(markdown); match; match = linkRe.exec(markdown)) {
      const target = match[1];
      if (!target || target.startsWith('mailto:')) continue;
      if (/^https?:\/\//i.test(target)) {
        external += 1;
        continue;
      }
      checked += 1;
      const [pathPart = '', anchor] = target.split('#');
      const from = dirname(file);

      for (const { label, re } of REMOVED_PATHS) {
        if (re.test(target)) {
          findings.push(`${file} -> ${target} — points at ${label}`);
        }
      }

      if (pathPart === '') {
        if (anchor && !ownAnchors.has(anchor)) {
          findings.push(`${file} -> #${anchor} — no such heading in this file`);
        }
        continue;
      }

      const absolute = resolve(ROOT, from, pathPart);
      if (!existsSync(absolute)) {
        findings.push(`${file} -> ${target} — file does not exist`);
        continue;
      }

      if (anchor) {
        const targetAnchors = anchorsOf(readFileSync(absolute, 'utf8'));
        if (!targetAnchors.has(anchor)) {
          findings.push(`${file} -> ${target} — no such heading in that file`);
        }
      }
    }
  }

  console.log(`check-links: ${files.length} markdown file(s), ${checked} internal link(s) checked`);
  console.log(`check-links: ${external} external link(s) listed but not fetched (by design)`);

  if (findings.length > 0) {
    console.error('\nBROKEN LINKS:');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log('LINKS PASS — every internal link and anchor resolves.');
  process.exit(0);
}

main();
