/**
 * check-secrets.ts — proves no credential is committed, in any spelling.
 *
 * Two independent checks, because they catch different mistakes:
 *   1. FORBIDDEN NAMES — credential identifiers from other projects on this
 *      machine. Their presence means a file was copied across a project
 *      boundary. This is the failure that is invisible in review.
 *   2. SECRET-SHAPED LITERALS — an assignment with a real-looking value. The
 *      rule is about the *value*, never the variable name: `API_KEY=` in
 *      `.env.example` is a contract, `API_KEY=sk-...` is a leak.
 *
 * Exit codes: 0 clean, 1 violation, 2 could not run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const ROOT = process.cwd();

/** Identifiers that must never appear in this repository at all. */
const FORBIDDEN_NAMES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'cross-repo token', re: /CROSS_REPO_TOKEN/gi },
  { name: 'vps credential', re: /VPS_(SSH_KEY|HOST|USER)/gi },
  { name: 'flagship deploy key', re: /id_ed25519_(sitecheckin|sc_deploy|az_deploy)/gi },
  { name: 'flagship domain', re: /(getsitecheckin|aiatendimento)\.(com|com\.br)/gi },
  { name: 'flagship repo path', re: /\/c\/Projects\/Flagships/gi },

  /*
   * Absolute paths into a specific person's home directory.
   *
   * Found by grepping the tree by hand before publishing: a captured
   * Playwright report embeds the absolute path of every file it touched, so the
   * node binary, the config file and the artifact directory all appear in it.
   * The committed fixture carried `C:\Users\<name>\...` thirty-eight times,
   * along with the name of a tool installed only on that one machine.
   *
   * It is not a credential, so no other rule here catches it, and it is not
   * something a reviewer notices inside a 300-line JSON fixture. It is a
   * username and a machine fingerprint, published verbatim.
   *
   * Both slash styles and both platforms, because the same report spells the
   * same path either way depending on which machine produced it.
   */
  {
    name: 'absolute home-directory path',
    re: /(?:[A-Z]:\\|\/)(?:Users|home)[\\/][A-Za-z0-9._-]{2,}/g,
  },
];

/**
 * A secret-shaped literal: an assignment whose right-hand side has enough
 * entropy to be a real credential. Anchored on the value, not the name, so a
 * documented empty variable never trips it.
 */
const SECRET_LITERALS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'anthropic key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai key', re: /sk-(proj-)?[A-Za-z0-9]{32,}/g },
  { name: 'github token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'aws access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'slack token', re: /xox[abprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

/** Files that legitimately contain the patterns they would be flagged for. */
const SELF = new Set(['scripts/check-secrets.ts']);

const SCANNABLE = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.txt',
  '.sh',
  '.env',
  '.example',
]);

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main(): void {
  let files: string[];
  try {
    files = git(['ls-files']).split('\n').filter(Boolean);
  } catch {
    console.error('check-secrets: not a git repository (or git unavailable)');
    process.exit(2);
  }

  const findings: string[] = [];
  let scanned = 0;

  for (const file of files) {
    if (SELF.has(file)) continue;
    const ext = extname(file);
    if (!SCANNABLE.has(ext) && !file.endsWith('.example')) continue;
    let text: string;
    try {
      text = readFileSync(`${ROOT}/${file}`, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;

    for (const { name, re } of FORBIDDEN_NAMES) {
      re.lastIndex = 0;
      const match = re.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        findings.push(`${file}:${line} — forbidden ${name} ("${match[0].slice(0, 40)}")`);
      }
    }

    for (const { name, re } of SECRET_LITERALS) {
      re.lastIndex = 0;
      const match = re.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        findings.push(`${file}:${line} — ${name} literal (redacted)`);
      }
    }
  }

  console.log(`check-secrets: ${scanned} tracked file(s) scanned`);

  if (findings.length > 0) {
    console.error('\nSECRET VIOLATIONS:');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log('SECRETS PASS — no credential, key or foreign-project identifier committed.');
  process.exit(0);
}

main();
