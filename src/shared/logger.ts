/**
 * Structured CLI logging.
 *
 * The terminal output of `argus run --mock` is part of the pitch, so stage
 * banners and per-item lines are first-class here rather than ad-hoc
 * console.log calls scattered through the pipeline.
 */

const isTTY = process.stdout.isTTY === true;
const noColor = process.env.NO_COLOR !== undefined || process.env.ARGUS_NO_COLOR === '1';
// FORCE_COLOR is the de-facto standard for "this pipe understands ANSI".
// Without it, piping to a file or a CI log strips the colour that makes the
// staged output readable — and the terminal output is part of this tool's pitch.
const forceColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0';
const useColor = (isTTY || forceColor) && !noColor;

type Code = 'dim' | 'bold' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray';

const CODES: Record<Code, [number, number]> = {
  dim: [2, 22],
  bold: [1, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
};

export function paint(code: Code, text: string): string {
  if (!useColor) return text;
  const [open, close] = CODES[code];
  return `\u001b[${open}m${text}\u001b[${close}m`;
}

let stageCounter = 0;

export const log = {
  /** Big banner printed once at the start of a run. */
  banner(subtitle: string): void {
    stageCounter = 0;
    const bar = '─'.repeat(64);
    process.stdout.write(`\n${paint('cyan', bar)}\n`);
    process.stdout.write(
      `${paint('bold', '  ARGUS')} ${paint('dim', '· autonomous AI QA agent')}\n`,
    );
    process.stdout.write(`  ${paint('dim', subtitle)}\n`);
    process.stdout.write(`${paint('cyan', bar)}\n`);
  },

  /** Numbered pipeline stage header. */
  stage(title: string, detail?: string): void {
    stageCounter += 1;
    const num = paint('cyan', `[${stageCounter}/7]`);
    const tail = detail ? ` ${paint('dim', `— ${detail}`)}` : '';
    process.stdout.write(`\n${num} ${paint('bold', title)}${tail}\n`);
  },

  info(message: string): void {
    process.stdout.write(`      ${message}\n`);
  },

  /** Indented bullet under the current stage. */
  item(message: string): void {
    process.stdout.write(`      ${paint('dim', '·')} ${message}\n`);
  },

  success(message: string): void {
    process.stdout.write(`      ${paint('green', '✓')} ${message}\n`);
  },

  warn(message: string): void {
    process.stdout.write(`      ${paint('yellow', '!')} ${message}\n`);
  },

  fail(message: string): void {
    process.stdout.write(`      ${paint('red', '✗')} ${message}\n`);
  },

  detail(message: string): void {
    process.stdout.write(`        ${paint('gray', message)}\n`);
  },

  blank(): void {
    process.stdout.write('\n');
  },

  /** Fatal, user-facing error. Never a raw stack trace. */
  error(message: string, hint?: string): void {
    process.stderr.write(`\n${paint('red', '✗ ' + message)}\n`);
    if (hint) process.stderr.write(`  ${paint('dim', hint)}\n`);
    process.stderr.write('\n');
  },

  /** Simple 2-column summary block. */
  table(rows: Array<[string, string]>): void {
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) {
      process.stdout.write(`      ${paint('dim', k.padEnd(width))}  ${v}\n`);
    }
  },
};

export function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical':
      return paint('red', 'CRITICAL');
    case 'high':
      return paint('magenta', 'HIGH');
    case 'medium':
      return paint('yellow', 'MEDIUM');
    default:
      return paint('gray', 'LOW');
  }
}

export function verdictBadge(verdict: string): string {
  switch (verdict) {
    case 'real_bug':
      return paint('red', 'real_bug');
    case 'flaky':
      return paint('yellow', 'flaky');
    case 'selector_drift':
      return paint('blue', 'selector_drift');
    default:
      return paint('gray', 'environment_issue');
  }
}
