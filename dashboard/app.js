// Token Launch Radar — dashboard logic. No network: data comes from data.js.
(function () {
  var D = window.RADAR || { rows: [], live: [], m: {}, g: 0.2 };
  var rows = D.rows.map(function (r) {
    return { rank: r[0], slug: r[1], name: r[2], cat: r[3], chains: r[4] || [], tvl: r[5], g7: r[6], age: r[7], iv: r[8], gm: r[9], mm: r[10] };
  });
  var live = (D.live || []).map(function (l) {
    return { slug: l[0], name: l[1], cat: l[2], chains: l[3] || [], tvl: l[4], mcap: l[5], g7: l[6] };
  });
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var wl = new Set();
  (D.wl || []).forEach(function (s) { wl.add(s); });
  // Watchlist slugs are the rows with rank in the top set flagged by data: rebuild from board size is
  // impossible, so watchlist-only uses the flag embedded in each row's slug list instead.
  var $ = function (id) { return document.getElementById(id); };
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var c = n >= 0 ? 'pos' : 'neg';
    return '<span class="' + c + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function capital(tvl) { return tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50; }
  function hold(age) { return age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30; }
  function action(r, cap, chain) {
    var c = (r.cat || '').toLowerCase(), n = r.name;
    if (/lend|cdp|collateral/.test(c)) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + chain + ' as a lender and keep the deposit open';
    if (/dex|yield|leveraged farm/.test(c)) return 'Provide $' + cap + ' of liquidity to ' + n + '\u2019s largest pool on ' + chain + ' and keep the LP position open';
    if (/bridge/.test(c)) return 'Bridge $' + cap + ' of USDC into ' + chain + ' through ' + n + ', then use the bridged funds inside its app';
    if (/stak|restak/.test(c)) return 'Stake $' + cap + ' of the chain\u2019s staking asset through ' + n + ' and keep the receipt token';
    if (/perpetual|derivative/.test(c)) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ' on ' + chain + ' and open one small hedged position';
    if (/prediction/.test(c)) return 'Fund $' + cap + ' on ' + n + ' and place one position in an active market, then hold it to settlement';
    if (/curator|allocator/.test(c)) return 'Deposit $' + cap + ' into a ' + n + ' vault on ' + chain + ' and hold the vault shares';
    if (/stable/.test(c)) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + chain + ' and hold it';
    if (/rwa/.test(c)) return 'Mint $' + cap + ' of ' + n + '\u2019s yield-bearing asset on ' + chain + ' and hold it for yield';
    if (/insurance/.test(c)) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + chain + ' and keep the policy active';
    if (/liquid/.test(c)) return 'Deposit $' + cap + ' of the liquid asset into ' + n + ' on ' + chain + ' and keep the position open';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open';
  }
  function farmSteps(r) {
    var chain = r.chains[0] || 'its main chain', second = r.chains[1] || chain;
    var cap = capital(r.tvl), h = hold(r.age), gas = cap >= 150 ? 8 : 4;
    return [
      'Set up a fresh wallet holding only the $' + cap + ' you plan to farm with, and store its seed phrase offline, never in a screenshot or chat. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
      action(r, cap, chain) + '. Cost: $' + cap + ' of capital and about $' + gas + ' of gas. Time: 15 minutes to set up.',
      'Repeat one qualifying action each week on ' + chain + ' — a deposit, a swap, a borrow or a vote — and do at least one of them on ' + second + ' too if the app supports it. Cost: about $2 of gas a week. Time: 10 minutes a week.',
      'Hold the position for at least ' + h + ' days so the activity lands in more than one snapshot window. Cost: the $' + cap + ' stays locked in the position. Time: ' + h + ' days.',
      'Each month, open ' + r.name + '\u2019s own points or rewards page from the link the protocol itself publishes and record your points balance. Cost: no fee to check; never pay to claim. Time: 10 minutes a month.',
      'Keep a farm log with the wallet address, the deposit dates and every transaction hash, so you can repeat the position or unwind it cleanly. Cost: nothing but the log. Time: 5 minutes.'
    ];
  }
  // ---- header stats + model text ----
  $('asof').textContent = D.a || '';
  var top = rows[0], tot = rows.reduce(function (s, r) { return s + r.iv; }, 0);
  $('stats').innerHTML =
    '<div class="card"><b>' + rows.length + '</b><span>pre-token protocols ranked</span></div>' +
    '<div class="card"><b>' + (D.w || '—') + '</b><span>on the watchlist (floor ' + money(D.f) + ')</span></div>' +
    '<div class="card"><b>' + (D.e || 0) + '</b><span>early finds below the floor</span></div>' +
    '<div class="card"><b>' + money(tot) + '</b><span>combined implied value</span></div>';
  $('modeltext').innerHTML = 'Implied value = TVL &times; category multiple &times; growth &times; maturity. ' +
    'Category multiple is the median <i>mcap / TVL</i> of token-bearing protocols in that category, calibrated from this snapshot (global median ' +
    (D.g || 0).toFixed(3) + ' when a category has too few samples). Rank #1 is <b>' + esc(top ? top.name : '') + '</b> at ' + money(top ? top.iv : 0) + '.';
  // ---- filters ----
  var cats = {}, chains = {};
  rows.forEach(function (r) { if (r.cat) cats[r.cat] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { $('cat').appendChild(new Option(c, c)); });
  Object.keys(chains).sort().forEach(function (c) { $('chain').appendChild(new Option(c, c)); });
  var state = { q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1 };
  function filtered() {
    var q = state.q.toLowerCase();
    return rows.filter(function (r) {
      if (state.wl && !wl.has(r.slug)) return false;
      if (state.cat && r.cat !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0)) return false;
      return true;
    });
  }
  var SORTS = { rank: 'rank', iv: 'iv', tvl: 'tvl', g7: 'g7', age: 'age' };
  function renderBoard() {
    var list = filtered().slice();
    var k = SORTS[state.sort] || 'rank';
    list.sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (av === null) av = -1e18; if (bv === null) bv = -1e18;
      return (av - bv) * state.dir;
    });
    $('count').textContent = list.length + ' of ' + rows.length + ' shown';
    var h = '<div class="box"><h2>Ranked board — pre-token protocols by implied value</h2>' +
      '<table><thead><tr><th data-s="rank">Rank</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num" data-s="tvl">TVL</th><th class="num" data-s="g7">7d</th><th class="num" data-s="age">Age</th>' +
      '<th class="num" data-s="iv">Implied value</th></tr></thead><tbody>';
    list.slice(0, 200).forEach(function (r) {
      h += '<tr><td>#' + r.rank + (wl.has(r.slug) ? ' <span class="pill">WATCHLIST</span>' : '') + '</td>' +
        '<td><a href="#/protocol/' + esc(r.slug) + '">' + esc(r.name) + '</a></td>' +
        '<td>' + esc(r.cat || '—') + '</td><td>' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl) + '</td><td class="num">' + pct(r.g7) + '</td>' +
        '<td class="num">' + (r.age === null ? '—' : r.age + 'd') + '</td>' +
        '<td class="num"><b>' + money(r.iv) + '</b></td></tr>';
    });
    h += '</tbody></table><p class="fine">Click a protocol for its detail view and farm plan. Showing first 200 rows of the filtered set.</p></div>';
    $('view').innerHTML = h;
    document.querySelectorAll('th[data-s]').forEach(function (th) {
      th.onclick = function () {
        var s = th.getAttribute('data-s');
        if (state.sort === s) state.dir *= -1; else { state.sort = s; state.dir = s === 'rank' ? 1 : -1; }
        renderBoard();
      };
    });
  }
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { $('view').innerHTML = '<div class="box"><p>Unknown protocol. <a href="#/">Back to the board</a>.</p></div>'; return; }
    var mult = (D.m && D.m[r.cat || '(none)']) || D.g || 0;
    var steps = farmSteps(r).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('view').innerHTML = '<div class="box detail"><a class="back" href="#/">&larr; Back to board</a>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' ' + (wl.has(r.slug) ? '<span class="pill">WATCHLIST</span>' : '') + '</h2>' +
      '<p><span class="badge">' + esc(r.cat || 'Uncategorized') + '</span> <span class="badge">' + esc(r.chains.join(' · ') || '—') + '</span> ' +
      '<span class="badge">records no token</span></p>' +
      '<div class="grid"><div><b>' + money(r.iv) + '</b><span>implied value</span></div>' +
      '<div><b>' + money(r.tvl) + '</b><span>TVL</span></div>' +
      '<div><b>' + pct(r.g7) + '</b><span>7-day TVL change</span></div>' +
      '<div><b>' + (r.age === null ? '—' : r.age + ' days') + '</b><span>tracked with no token</span></div></div>' +
      '<p class="fine">Model breakdown: TVL ' + money(r.tvl) + ' &times; category multiple ' + mult.toFixed(3) +
      ' (' + esc(r.cat || 'no category') + ') &times; growth ' + (r.gm || 1).toFixed(2) +
      ' &times; maturity ' + (r.mm || 1).toFixed(2) + ' = ' + money(r.iv) + '. Formula: implied = TVL &times; multiple &times; growth &times; maturity.</p>' +
      '<h2>How to farm it</h2><ol class="steps">' + steps + '</ol></div>';
  }
  // live table
  $('livetab').querySelector('tbody').innerHTML = live.map(function (l) {
    return '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.cat || '—') + '</td><td class="num">' + money(l.tvl) +
      '</td><td class="num"><b>' + money(l.mcap) + '</b></td><td class="num">' + pct(l.g7) + '</td></tr>';
  }).join('');
  // ---- routing ----
  function route() {
    var h = location.hash || '#/';
    var m = h.match(/^#\/protocol\/([\w.-]+)/);
    if (m) { renderDetail(m[1]); return; }
    if (h.indexOf('#/filter/watchlist') === 0) { state.wl = true; $('wl').checked = true; }
    var cm = h.match(/category=([^&]+)/);
    if (cm) { state.cat = decodeURIComponent(cm[1]); $('cat').value = state.cat; }
    renderBoard();
  }
  $('q').addEventListener('input', function () { state.q = $('q').value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = $('cat').value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; renderBoard(); });
  $('wl').addEventListener('change', function () { state.wl = $('wl').checked; renderBoard(); });
  $('reset').addEventListener('click', function () {
    state = { q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1 };
    $('q').value = ''; $('cat').value = ''; $('chain').value = ''; $('wl').checked = false;
    history.replaceState(null, '', location.pathname); renderBoard();
  });
  window.addEventListener('hashchange', route);
  route();
})();
