/**
 * Argus demo app — "Tasker", a deliberately imperfect task tracker.
 *
 * This is the default target Argus points at out of the box. It is
 * server-rendered TypeScript with no client build step, so `npx tsx
 * demo-app/src/server.ts` is the only thing needed to run it.
 *
 * IT CONTAINS THREE INTENTIONAL BUGS. See demo-app/KNOWN_BUGS.md.
 * Do not "fix" them — Argus exists to find them, and a demo where the agent
 * finds nothing proves nothing.
 */
import http from 'node:http';
import { URL } from 'node:url';

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

const PORT = Number(process.env.DEMO_PORT ?? 4317);

/**
 * Selector-drift switch — not a bug, a UI change.
 *
 * With DEMO_DRIFT=1 the add button reads "Create task" instead of "Add task".
 * The feature still works perfectly; only the label moved. Tests generated
 * before the rename will fail to find their locator, which is exactly the
 * signal triage should classify as `selector_drift` rather than a real bug.
 * See README → "Demonstrating selector drift".
 */
const ADD_BUTTON_LABEL = process.env.DEMO_DRIFT === '1' ? 'Create task' : 'Add task';

let tasks: Task[] = [];
let nextId = 1;

function seed(): void {
  tasks = [
    { id: 't1', text: 'Write release notes', done: false, createdAt: new Date().toISOString() },
    { id: 't2', text: 'Review pull request', done: true, createdAt: new Date().toISOString() },
    { id: 't3', text: 'Review pull request', done: false, createdAt: new Date().toISOString() },
  ];
  nextId = 4;
}
seed();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const STYLES = `
  :root { --bg:#0f1117; --panel:#171a23; --line:#252a36; --text:#e6e8ee;
          --muted:#8b93a7; --accent:#5b8cff; --danger:#ff6b6b; --ok:#3ddc97; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--bg); color:var(--text); }
  header { border-bottom:1px solid var(--line); padding:16px 24px; display:flex;
           align-items:center; gap:24px; }
  header h1 { font-size:18px; margin:0; letter-spacing:.4px; }
  nav a { color:var(--muted); text-decoration:none; margin-right:16px; font-size:14px; }
  nav a:hover, nav a.active { color:var(--accent); }
  main { max-width:720px; margin:32px auto; padding:0 24px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px; }
  form.add { display:flex; gap:10px; margin-bottom:20px; }
  input[type=text] { flex:1; padding:10px 12px; border-radius:8px; border:1px solid var(--line);
                     background:#0c0e14; color:var(--text); font-size:14px; }
  button { cursor:pointer; border:none; border-radius:8px; padding:10px 16px; font-size:14px;
           font-weight:600; background:var(--accent); color:#fff; }
  button.link { background:none; color:var(--danger); font-weight:500; padding:4px 8px; }
  ul.tasks { list-style:none; margin:0; padding:0; }
  ul.tasks li { display:flex; align-items:center; gap:12px; padding:12px 4px;
                border-bottom:1px solid var(--line); }
  ul.tasks li:last-child { border-bottom:none; }
  .task-text { flex:1; }
  .task-text.done { text-decoration:line-through; color:var(--muted); }
  .empty { color:var(--muted); padding:16px 4px; }
  .stat { display:flex; justify-content:space-between; padding:10px 0;
          border-bottom:1px solid var(--line); }
  .stat:last-child { border-bottom:none; }
  .stat b { color:var(--accent); }
  h2 { font-size:16px; margin:0 0 16px; }
  p.muted { color:var(--muted); }
`;

function layout(title: string, activePath: string, body: string): string {
  const link = (href: string, label: string): string =>
    `<a href="${href}" class="${activePath === href ? 'active' : ''}" data-testid="nav-${label.toLowerCase()}">${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Tasker</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Tasker</h1>
  <nav>${link('/', 'Tasks')}${link('/stats', 'Stats')}${link('/about', 'About')}</nav>
</header>
<main>${body}</main>
</body>
</html>`;
}

function tasksView(): string {
  const items = tasks.length
    ? tasks
        .map(
          (task) => `
      <li data-testid="task-item" data-task-id="${task.id}">
        <input type="checkbox" data-testid="toggle-complete" data-task-id="${task.id}"
               ${task.done ? 'checked' : ''} aria-label="Mark complete">
        <span class="task-text ${task.done ? 'done' : ''}" data-testid="task-text">${escapeHtml(task.text)}</span>
        <form method="POST" action="/tasks/delete" style="margin:0">
          <input type="hidden" name="id" value="${task.id}">
          <input type="hidden" name="text" value="${escapeHtml(task.text)}">
          <button class="link" type="submit" data-testid="delete-task">Delete</button>
        </form>
      </li>`,
        )
        .join('')
    : '<li class="empty" data-testid="empty-state">No tasks yet. Add one above.</li>';

  return `
  <div class="panel">
    <h2>My tasks</h2>
    <form class="add" method="POST" action="/tasks/add">
      <input type="text" name="text" placeholder="What needs doing?" data-testid="new-task-input" autocomplete="off">
      <button type="submit" data-testid="add-task">${ADD_BUTTON_LABEL}</button>
    </form>
    <ul class="tasks" data-testid="task-list">${items}</ul>
  </div>

  <!--
    BUG 2 lives here: the toggle updates the DOM optimistically and never
    tells the server, so the change is lost on refresh.
  -->
  <script>
    document.querySelectorAll('[data-testid="toggle-complete"]').forEach(function (box) {
      box.addEventListener('change', function () {
        var row = box.closest('li');
        var label = row.querySelector('[data-testid="task-text"]');
        label.classList.toggle('done', box.checked);
      });
    });
  </script>`;
}

function statsView(): string {
  const done = tasks.filter((t) => t.done).length;
  const open = tasks.length - done;
  const pct = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  return `
  <div class="panel">
    <h2>Stats</h2>
    <div class="stat"><span>Total tasks</span><b data-testid="stat-total">${tasks.length}</b></div>
    <div class="stat"><span>Completed</span><b data-testid="stat-done">${done}</b></div>
    <div class="stat"><span>Open</span><b data-testid="stat-open">${open}</b></div>
    <div class="stat"><span>Completion</span><b data-testid="stat-pct">${pct}%</b></div>
  </div>`;
}

function aboutView(): string {
  return `
  <div class="panel">
    <h2>About Tasker</h2>
    <p class="muted" data-testid="about-text">
      Tasker is a small task tracker bundled with Argus as a test target.
      It is intentionally imperfect so the QA agent has something real to find.
    </p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(303, { Location: to });
  res.end();
}

function html(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === 'GET') {
    if (pathname === '/') return html(res, layout('Tasks', '/', tasksView()));
    if (pathname === '/stats') return html(res, layout('Stats', '/stats', statsView()));
    if (pathname === '/about') return html(res, layout('About', '/about', aboutView()));
    if (pathname === '/api/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(tasks));
    }
    if (pathname === '/__reset') {
      seed();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
  }

  if (req.method === 'POST' && pathname === '/__shutdown') {
    // Test-harness hook. The CLI spawns this app through a shell wrapper, so
    // killing the child PID can orphan this process and leave the port held —
    // asking it to exit itself is the reliable path. Flush the response first,
    // then close the listener so the socket is released cleanly.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }), () => {
      server.close(() => process.exit(0));
      // Belt and braces: if a keep-alive connection stalls close(), leave anyway.
      setTimeout(() => process.exit(0), 500).unref();
    });
    return;
  }

  if (req.method === 'POST') {
    const params = new URLSearchParams(await readBody(req));

    if (pathname === '/tasks/add') {
      const text = params.get('text') ?? '';
      // BUG 3: no validation. An empty submission creates a blank task.
      tasks.push({
        id: `t${nextId++}`,
        text,
        done: false,
        createdAt: new Date().toISOString(),
      });
      return redirect(res, '/');
    }

    if (pathname === '/tasks/delete') {
      const text = params.get('text') ?? '';
      // BUG 1: deletes by matching text instead of by id, so with two
      // identically-named tasks the FIRST one always goes, not the clicked one.
      const index = tasks.findIndex((t) => t.text === text);
      if (index !== -1) tasks.splice(index, 1);
      return redirect(res, '/');
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(layout('Not found', pathname, '<div class="panel"><h2>404</h2></div>'));
});

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('demo-app/src/server.ts');
if (isMain) {
  // Bind 0.0.0.0 explicitly, not the Node default.
  //
  // Defaulting binds "::" (IPv6 any). On GitHub's Ubuntu runners `localhost`
  // resolves to 127.0.0.1 first, and nothing answers there, so CI sat in
  // wait-on for the full 60s timeout against a server that had already
  // printed "listening". Binding 0.0.0.0 answers on IPv4 where every client
  // actually looks.
  server.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`Tasker demo app listening on http://localhost:${PORT}\n`);
  });
}
