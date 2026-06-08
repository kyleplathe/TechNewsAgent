import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { AddressInfo } from 'node:net';

/** One row shown in the local web picker. `index` is the 1-based number into the agent's sorted candidate list. */
export type PickerCandidate = {
  index: number;
  section: string;
  feedTitle: string;
  title: string;
  link: string;
  date: string;
  ageHours: number | null;
  /** Advisory badges (e.g. "non-bitcoin", "off-scope", "recently aired", "no link"). Never block selection. */
  flags: string[];
};

export type PickArticlesOptions = {
  /** TCP port to bind; 0 = let the OS choose a free port (default). */
  port?: number;
  /** Auto-open the default browser (default true). */
  openBrowser?: boolean;
  /** Abort if no selection arrives within this many ms (default 20 min). */
  timeoutMs?: number;
  /** Episode date label shown in the page header. */
  dateLabel?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ageLabel(ageHours: number | null): string {
  if (ageHours == null || !Number.isFinite(ageHours)) return 'undated';
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))}m ago`;
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

function hostLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function renderPage(candidates: PickerCandidate[], dateLabel: string): string {
  const data = JSON.stringify(candidates).replace(/</g, '\\u003c');
  const cards = candidates
    .map((c) => {
      const flags = c.flags
        .map(
          (f) =>
            `<span class="flag">${escapeHtml(f)}</span>`
        )
        .join('');
      const host = hostLabel(c.link);
      const titleHtml = c.link
        ? `<a class="title" href="${escapeHtml(c.link)}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>`
        : `<span class="title nolink">${escapeHtml(c.title)}</span>`;
      return `
      <label class="card" data-index="${c.index}">
        <input type="checkbox" class="pick" value="${c.index}" />
        <div class="body">
          <div class="meta">
            <span class="badge sec-${escapeHtml(c.section)}">${escapeHtml(c.section)}</span>
            <span class="age">${escapeHtml(ageLabel(c.ageHours))}</span>
            ${host ? `<span class="host">${escapeHtml(host)}</span>` : ''}
            <span class="num">#${c.index}</span>
            ${flags}
          </div>
          ${titleHtml}
          <div class="source">${escapeHtml(c.feedTitle)}</div>
        </div>
      </label>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tech News — Article Picker</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #0b0b0c; color: #f4f4f5; }
  header { position: sticky; top: 0; z-index: 5; background: #121214; border-bottom: 1px solid #27272a; padding: 16px 20px; }
  header h1 { margin: 0 0 4px; font-size: 18px; }
  header p { margin: 0; color: #a1a1aa; font-size: 13px; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 16px 20px 120px; }
  .card { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; margin: 0 0 10px; background: #18181b; border: 1px solid #27272a; border-radius: 10px; cursor: pointer; }
  .card.checked { border-color: #22c55e; background: #14210f; }
  .card input { margin-top: 3px; width: 18px; height: 18px; flex: none; accent-color: #22c55e; }
  .body { min-width: 0; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 5px; font-size: 12px; }
  .badge { font-weight: 700; letter-spacing: .03em; padding: 1px 7px; border-radius: 999px; background: #3f3f46; color: #fff; font-size: 11px; }
  .sec-TECH { background: #2563eb; } .sec-HARDWARE { background: #7c3aed; } .sec-REPAIR { background: #ca8a04; }
  .sec-SKATE { background: #db2777; } .sec-LOCAL { background: #0891b2; }
  .age, .host, .num { color: #a1a1aa; }
  .num { color: #71717a; }
  .flag { background: #7f1d1d; color: #fecaca; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
  a.title { color: #f4f4f5; text-decoration: none; font-size: 15px; line-height: 1.35; display: inline-block; }
  a.title:hover { text-decoration: underline; color: #93c5fd; }
  .title.nolink { color: #d4d4d8; font-size: 15px; }
  .source { color: #71717a; font-size: 12px; margin-top: 3px; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; background: #121214; border-top: 1px solid #27272a; padding: 14px 20px; display: flex; align-items: center; gap: 16px; justify-content: center; }
  .status { font-size: 14px; color: #d4d4d8; }
  .status b { color: #fff; }
  .order { color: #a1a1aa; font-size: 12px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { font-size: 15px; font-weight: 600; padding: 10px 22px; border-radius: 10px; border: 0; background: #22c55e; color: #06270f; cursor: pointer; }
  button:disabled { background: #3f3f46; color: #71717a; cursor: not-allowed; }
  .done { text-align: center; padding: 60px 20px; }
  .done h2 { font-size: 20px; }
</style>
</head>
<body>
<header>
  <h1>Pick today's stories${dateLabel ? ` — ${escapeHtml(dateLabel)}` : ''}</h1>
  <p>Tick the articles you want to cover. Selection order = on-air / slide order. Click a headline to read it. Aim for ~3–5.</p>
</header>
<div class="wrap" id="list">
${cards}
</div>
<footer>
  <div>
    <div class="status"><b id="count">0</b> selected</div>
    <div class="order" id="order"></div>
  </div>
  <button id="go" disabled>Generate script</button>
</footer>
<div id="overlay" style="display:none"></div>
<script>
  const CANDIDATES = ${data};
  const order = [];
  const list = document.getElementById('list');
  const countEl = document.getElementById('count');
  const orderEl = document.getElementById('order');
  const goBtn = document.getElementById('go');
  const byIndex = new Map(CANDIDATES.map(c => [c.index, c]));

  function refresh() {
    countEl.textContent = String(order.length);
    goBtn.disabled = order.length === 0;
    orderEl.textContent = order.length
      ? order.map((n, i) => (i + 1) + '. ' + (byIndex.get(n)?.title || '#' + n).slice(0, 40)).join('   ·   ')
      : '';
  }

  list.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.classList.contains('pick')) return;
    const idx = Number(cb.value);
    const card = cb.closest('.card');
    if (cb.checked) {
      if (!order.includes(idx)) order.push(idx);
      card.classList.add('checked');
    } else {
      const at = order.indexOf(idx);
      if (at >= 0) order.splice(at, 1);
      card.classList.remove('checked');
    }
    refresh();
  });

  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true;
    goBtn.textContent = 'Generating…';
    try {
      await fetch('/select', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order }),
      });
    } catch (_) {}
    document.body.innerHTML = '<div class="done"><h2>Selected ' + order.length + ' stories ✓</h2><p style="color:#a1a1aa">The agent is writing your script. You can close this tab and return to the terminal.</p></div>';
  });
</script>
</body>
</html>`;
}

function openInBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* fall back to the printed URL */
  }
}

/**
 * Serve a local web picker and resolve with the user's selected candidate indices
 * (1-based, in the order they were checked). Rejects on timeout.
 */
export function pickArticlesInteractive(
  candidates: PickerCandidate[],
  opts: PickArticlesOptions = {}
): Promise<number[]> {
  const {
    port = 0,
    openBrowser = true,
    timeoutMs = 20 * 60 * 1000,
    dateLabel = '',
  } = opts;
  const html = renderPage(candidates, dateLabel);
  const valid = new Set(candidates.map((c) => c.index));

  return new Promise<number[]>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => fn());
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/select') {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
          let order: number[] = [];
          try {
            const parsed = JSON.parse(raw || '{}') as { order?: unknown };
            if (Array.isArray(parsed.order)) {
              const seen = new Set<number>();
              order = parsed.order
                .map((n) => Number(n))
                .filter(
                  (n) =>
                    Number.isInteger(n) &&
                    valid.has(n) &&
                    !seen.has(n) &&
                    (seen.add(n), true)
                );
            }
          } catch {
            /* empty selection */
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: order.length }));
          finish(() => resolve(order));
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Article picker timed out after ${Math.round(timeoutMs / 60000)} min with no selection.`
          )
        )
      );
    }, timeoutMs);

    server.on('error', (err) => finish(() => reject(err)));

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}/`;
      console.log(`\nArticle picker ready → ${url}`);
      console.log('Pick your stories in the browser, then click "Generate script".');
      if (openBrowser) openInBrowser(url);
    });
  });
}
