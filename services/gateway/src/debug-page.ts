// Dev inspector for the /live protocol: open it in two tabs and watch them agree.
// Deliberately bare; the real results page is apps/web (F8). Totals are public, so it is
// safe to serve unauthenticated.
export const debugPage = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gateway inspector</title>
<style>
  body { font: 14px/1.5 ui-monospace, Menlo, monospace; margin: 24px; color: #1b1f1e; background: #f6f7f6; }
  input { font: inherit; width: 38ch; padding: 4px 6px; }
  button { font: inherit; padding: 4px 10px; }
  table { border-collapse: collapse; margin-top: 12px; }
  td, th { padding: 3px 14px 3px 0; text-align: left; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.hit td { background: #fde8c8; }
  #status { font-weight: 600; }
  pre { background: #fff; border: 1px solid #ccd; padding: 8px; max-width: 100%; overflow-x: auto; }
</style>
</head>
<body>
<form id="f">
  <label>contestId <input id="contest" placeholder="uuid" required></label>
  <button>Connect</button>
  <span id="status">disconnected</span>
</form>
<p>frames: <b id="count">0</b> · total votes: <b id="total">0</b> · last frame: <span id="age">–</span></p>
<table><thead><tr><th>contestant</th><th>total</th></tr></thead><tbody id="rows"></tbody></table>
<p>last frame</p>
<pre id="last">–</pre>
<script>
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  $('contest').value = params.get('contestId') || '';
  let ws, totals = new Map(), frames = 0, lastAt = 0, hit = new Set();

  function render() {
    const rows = [...totals].sort((a, b) => b[1] - a[1]);
    $('rows').innerHTML = rows.map(([id, n]) =>
      '<tr class="' + (hit.has(id) ? 'hit' : '') + '"><td>' + id.slice(0, 8) + '…</td><td class="n">' + n + '</td></tr>'
    ).join('');
  }

  function connect(contestId) {
    ws?.close();
    totals = new Map(); frames = 0;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/live?contestId=' + encodeURIComponent(contestId));
    $('status').textContent = 'connecting';
    ws.onopen = () => { $('status').textContent = 'connected'; };
    ws.onclose = (e) => { $('status').textContent = 'closed ' + e.code + (e.reason ? ' (' + e.reason + ')' : ''); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      frames++; lastAt = Date.now();
      if (msg.type === 'snapshot') totals = new Map(msg.totals.map((t) => [t.contestantId, t.total]));
      const changed = msg.type === 'snapshot' ? msg.totals : msg.changed;
      hit = new Set(msg.type === 'update' ? changed.map((t) => t.contestantId) : []);
      for (const t of changed) totals.set(t.contestantId, t.total);
      $('count').textContent = frames;
      $('total').textContent = msg.totalVotes;
      $('last').textContent = JSON.stringify(msg, null, 1);
      render();
    };
  }

  $('f').onsubmit = (e) => {
    e.preventDefault();
    const id = $('contest').value.trim();
    history.replaceState(null, '', '?contestId=' + encodeURIComponent(id));
    connect(id);
  };
  setInterval(() => { $('age').textContent = lastAt ? ((Date.now() - lastAt) / 1000).toFixed(1) + 's ago' : '–'; }, 250);
  if ($('contest').value) connect($('contest').value);
</script>
</body>
</html>
`;
