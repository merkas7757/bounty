// Token Radar's dashboard: one static page, no network, no framework.
// It reads window.RADAR (written beside dashboard/ by main.ts) and renders four views from the hash:
//   #/board            the ranked board, filterable and sortable
//   #/p/<slug>         one protocol's detail view: the model's own inputs and its farm plan
//   #/comps            the category multiples the model is calibrated on
//   #/model            the model, its constants and what it cannot know
//   #/live             the live-token protocols, shown at the market's own values
// Every figure shown is either in data.js or recomputed here from the row's own snapshot figures.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('main');
  var nav = document.getElementById('nav');
  var stamp = document.getElementById('stamp');
  var foot = document.getElementById('foot');
  if (!DATA) {
    main.innerHTML = '<p class="empty">No data.js beside dashboard/: run main.ts to write the board.</p>';
    return;
  }

  // ---------- formatting ----------
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return '$' + Math.round(n / 1e3) + 'K';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function tone(n) {
    if (n === null || n === undefined || !isFinite(n) || Math.abs(n) < 0.005) return 'flat';
    return n > 0 ? 'up' : 'down';
  }
  function age(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + ' yr';
    return Math.round(d) + ' d';
  }
  function mult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return new Intl.NumberFormat('en-US').format(n); }

  var board = DATA.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
  var bySlug = {};
  board.forEach(function (r) {
    bySlug[r.slug] = r;
  });
  var maxVal = board.length ? board[0].implied_value_usd : 1;
  var minVal = board.length ? board[board.length - 1].implied_value_usd : 1;
  var lnMax = Math.log(Math.max(maxVal, 2));
  var lnMin = Math.log(Math.max(Math.min(minVal, maxVal), 1));

  // Width of a value on the board's log scale: the bar a reader compares by eye.
  function width(v) {
    if (lnMax === lnMin) return 100;
    var w = ((Math.log(Math.max(v, 1)) - lnMin) / (lnMax - lnMin)) * 100;
    return Math.max(2, Math.min(100, w));
  }

  // The band drawn on the same log scale as the bar.
  function bandHtml(row) {
    var hi = width(row.implied_high_usd);
    var at = width(row.implied_value_usd);
    return (
      '<span class="band" title="implied ' + esc(usd(row.implied_value_usd)) + ', band ' + esc(usd(row.implied_low_usd)) +
      ' – ' + esc(usd(row.implied_high_usd)) + '">' +
      '<s style="width:' + at.toFixed(1) + '%"></s>' +
      '<b style="left:' + Math.min(99.5, hi).toFixed(1) + '%"></b>' +
      '</span>'
    );
  }

  // ---------- routing ----------
  function parseHash() {
    var h = (location.hash || '#/board').replace(/^#/, '');
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var query = qi >= 0 ? h.slice(qi + 1) : '';
    var parts = path.split('/').filter(Boolean);
    var out = { view: parts[0] || 'board', slug: parts[1] || null, q: '', cat: 'all', chain: 'all', scope: 'all', sort: 'implied', dir: 'desc' };
    query.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      if (k in out) out[k] = v;
    });
    return out;
  }
  function toHash(s) {
    var q = [];
    ['q', 'cat', 'chain', 'scope', 'sort', 'dir'].forEach(function (k) {
      var d = { q: '', cat: 'all', chain: 'all', scope: 'all', sort: 'implied', dir: 'desc' }[k];
      if (s[k] !== d && s[k] !== undefined && s[k] !== null && s[k] !== '') q.push(k + '=' + encodeURIComponent(s[k]));
    });
    return '#/' + s.view + (q.length ? '?' + q.join('&') : '');
  }

  // ---------- shared chrome ----------
  var categories = [];
  var chains = [];
  board.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) {
      if (chains.indexOf(c) < 0) chains.push(c);
    });
  });
  categories.sort();
  chains.sort();

  function chrome(s) {
    stamp.hidden = false;
    stamp.textContent = 'snapshot ' + DATA.as_of + ' · ' + DATA.model_version;
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      var v = a.getAttribute('data-view');
      var active = v === s.view || (v === 'board' && s.view === 'p');
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    foot.innerHTML =
      '<span><strong>' + esc(DATA.model_version) + '</strong> · ' + num(DATA.board_size) + ' rows · ' + num(DATA.watchlist_size) +
      ' watchlist slugs · ' + num(DATA.live_size) + ' live tokens for comps</span>' +
      '<span>' + esc(DATA.source) + '</span>';
  }

  function controls(s) {
    var opts = ['<option value="all">All categories</option>'].concat(
      categories.map(function (c) { return '<option value="' + esc(c) + '"' + (s.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; })
    );
    var chainsOpts = ['<option value="all">All chains</option>'].concat(
      chains.map(function (c) { return '<option value="' + esc(c) + '"' + (s.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; })
    );
    return (
      '<div class="controls">' +
      '<div class="field grow"><label for="q">Search</label>' +
      '<input id="q" type="search" placeholder="protocol, category or chain" value="' + esc(s.q) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat">' + opts.join('') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain">' + chainsOpts.join('') + '</select></div>' +
      '<div class="seg" role="group" aria-label="Rows">' +
      '<button data-scope="all" aria-pressed="' + (s.scope === 'all') + '">All rows</button>' +
      '<button data-scope="watchlist" aria-pressed="' + (s.scope === 'watchlist') + '">Watchlist</button>' +
      '<button data-scope="early" aria-pressed="' + (s.scope === 'early') + '">Early radar</button>' +
      '</div>' +
      '<button class="reset" id="reset">Reset</button>' +
      '</div>'
    );
  }

  function wireControls(s) {
    var q = document.getElementById('q');
    var cat = document.getElementById('cat');
    var chain = document.getElementById('chain');
    var timer = null;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        s.q = q.value;
        location.hash = toHash(s);
      }, 140);
    });
    cat.addEventListener('change', function () { s.cat = cat.value; location.hash = toHash(s); });
    chain.addEventListener('change', function () { s.chain = chain.value; location.hash = toHash(s); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-scope]'), function (b) {
      b.addEventListener('click', function () { s.scope = b.getAttribute('data-scope'); location.hash = toHash(s); });
    });
    document.getElementById('reset').addEventListener('click', function () {
      s.q = '';
      s.cat = 'all';
      s.chain = 'all';
      s.scope = 'all';
      s.sort = 'implied';
      s.dir = 'desc';
      location.hash = toHash(s);
    });
  }

  // ---------- board ----------
  function filtered(s) {
    var q = s.q.trim().toLowerCase();
    var rows = board.filter(function (r) {
      if (s.cat !== 'all' && r.category !== s.cat) return false;
      if (s.chain !== 'all' && r.chains.indexOf(s.chain) < 0) return false;
      if (s.scope === 'watchlist' && r.rank > 0 && !isWatchlist(r.slug)) return false;
      if (s.scope === 'early' && isWatchlist(r.slug)) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ') + ' ' + r.slug).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
      multiple: function (r) { return r.category_multiple; },
      age: function (r) { return r.age_days === null ? 1e9 : r.age_days; },
      name: function (r) { return r.name.toLowerCase(); }
    }[s.sort] || function (r) { return r.implied_value_usd; };
    var dir = s.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var ka = key(a);
      var kb = key(b);
      if (ka === kb) return a.rank - b.rank;
      if (typeof ka === 'string') return ka < kb ? -dir : dir;
      return ka < kb ? -dir : dir;
    });
    return rows;
  }

  var watchSet = null;
  function isWatchlist(slug) {
    if (watchSet === null) {
      // The watchlist is every row at or above the snapshot's floor: the board's own coverage rule.
      watchSet = {};
      board.forEach(function (r) { if (r.tvl_usd >= DATA.floor_usd) watchSet[r.slug] = true; });
    }
    return watchSet[slug] === true;
  }

  function th(s, key, label, cls) {
    var active = s.sort === key;
    var sort = active ? (s.dir === 'desc' ? 'descending' : 'ascending') : 'none';
    return '<th scope="col" class="' + (cls || '') + '"' + (active ? ' aria-sort="' + sort + '"' : '') +
      '><button data-sort="' + key + '" type="button">' + label + (active ? (s.dir === 'desc' ? ' ↓' : ' ↑') : '') + '</button></th>';
  }

  function viewBoard(s) {
    var rows = filtered(s);
    var covered = board.filter(function (r) { return isWatchlist(r.slug); }).length;
    var catMult = DATA.comps.length ? DATA.comps[0] : null;
    main.innerHTML =
      '<section class="lede">' +
      '<div class="eyebrow">Pre-token intelligence · ' + esc(DATA.model_version) + '</div>' +
      '<h1>Every protocol with no token yet, ranked by what its launch would be worth.</h1>' +
      '<p class="sub">The board starts from <strong>' + num(DATA.watchlist_size) + ' watchlist protocols</strong> that record no token, adds ' +
      num(DATA.early_size) + ' pre-token protocols below the floor, and prices each one at the market multiple its category already pays — ' +
      '<strong>' + mult(DATA.global_comps.multiple) + '</strong> market cap per dollar of TVL across ' + num(DATA.global_comps.peers) + ' live-token comparables. ' +
      'Every row carries a farm plan sized to its own band.</p>' +
      '</section>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Rows scored</div><div class="v">' + num(board.length) + '</div><div class="n">' + num(covered) + ' from the watchlist</div></div>' +
      '<div class="stat"><div class="k">Top value in view</div><div class="v">' + usd(tableTop(rows)) + '</div><div class="n">' + (topRow(rows) ? 'rank ' + topRow(rows).rank + ': ' + esc(topRow(rows).name) : 'no rows') + '</div></div>' +
      '<div class="stat"><div class="k">Median multiple</div><div class="v">' + mult(DATA.global_comps.multiple) + '</div><div class="n">p25 ' + mult(DATA.global_comps.p25) + ' · p75 ' + mult(DATA.global_comps.p75) + '</div></div>' +
      '<div class="stat"><div class="k">Widest comps</div><div class="v">' + (catMult ? esc(catMult.category) : '—') + '</div><div class="n">' + (catMult ? mult(catMult.multiple) + ' from ' + catMult.peers + ' peers' : 'n/a') + '</div></div>' +
      '</div>' +
      controls(s) +
      '<div class="tablewrap">' +
      '<table><caption class="skip">Ranked pre-token protocols</caption><thead><tr>' +
      '<th scope="col" class="rank">#</th>' +
      th(s, 'name', 'Protocol') +
      '<th scope="col" class="hide-sm">Category</th>' +
      th(s, 'tvl', 'TVL', 'num') +
      th(s, 'change', '7d', 'num hide-sm') +
      th(s, 'multiple', 'Comps', 'num hide-sm') +
      th(s, 'implied', 'Implied value', 'num') +
      th(s, 'age', 'Tracked', 'num hide-sm') +
      '</tr></thead><tbody id="rows"></tbody></table>' +
      '<div class="empty" id="empty"' + (rows.length ? ' hidden' : '') + '>No protocol matches these filters.</div>' +
      '</div>' +
      '<p class="count" id="count"></p>';

    var body = document.getElementById('rows');
    var html = rows.map(function (r) {
      return (
        '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><div class="who"><b>' + esc(r.name) + '</b><span>' + esc(r.chains.slice(0, 3).join(' · ') || 'no chain listed') +
        (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></div></td>' +
        '<td class="hide-sm"><span class="chip">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="num mono">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num mono hide-sm ' + tone(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num mono hide-sm">' + mult(r.category_multiple) + '<span class="muted"> ·' + r.comps_peers + '</span></td>' +
        '<td class="num"><div class="val">' + bandHtml(r) + '<b>' + usd(r.implied_value_usd) + '</b></div></td>' +
        '<td class="num mono hide-sm muted">' + age(r.age_days) + '</td>' +
        '</tr>'
      );
    }).join('');
    body.innerHTML = html;
    document.getElementById('count').textContent =
      num(rows.length) + ' of ' + num(board.length) + ' rows' + (s.q ? ' · search “' + s.q + '”' : '') +
      (s.cat !== 'all' ? ' · ' + s.cat : '') + (s.chain !== 'all' ? ' · ' + s.chain : '') +
      ' · sorted by ' + s.sort + ' ' + (s.dir === 'asc' ? 'ascending' : 'descending');
    Array.prototype.forEach.call(body.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () {
        location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
      });
    });
    Array.prototype.forEach.call(main.querySelectorAll('[data-sort]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (s.sort === k) s.dir = s.dir === 'desc' ? 'asc' : 'desc';
        else { s.sort = k; s.dir = k === 'name' || k === 'age' ? 'asc' : 'desc'; }
        location.hash = toHash(s);
      });
    });
    wireControls(s);
  }

  function tableTop(rows) {
    var t = topRow(rows);
    return t ? t.implied_value_usd : 0;
  }
  function topRow(rows) {
    var best = null;
    rows.forEach(function (r) { if (best === null || r.implied_value_usd > best.implied_value_usd) best = r; });
    return best;
  }

  // ---------- detail ----------
  function splitStep(text) {
    var i = text.lastIndexOf(' Cost: ');
    var head = i < 0 ? text : text.slice(0, i);
    var tail = i < 0 ? '' : text.slice(i + 7);
    var j = tail.lastIndexOf('. Time: ');
    var cost = j < 0 ? tail : tail.slice(0, j);
    var time = j < 0 ? '' : tail.slice(j + 8).replace(/\.$/, '');
    return { text: head.replace(/\.$/, ''), cost: cost.replace(/\.$/, ''), time: time.replace(/\.$/, '') };
  }

  // The panel that shows where this row's multiple comes from: the category's own comparables, or the
  // snapshot-wide median when the category is too thin to price.
  function compsPanel(row) {
    var cat = null;
    DATA.comps.forEach(function (c) { if (c.category === row.category) cat = c; });
    var live = DATA.live.filter(function (l) { return l.category === row.category; }).slice(0, 4);
    return (
      '<div class="panel pad block"><h2>Where ' + mult(row.category_multiple) + ' comes from</h2>' +
      '<dl class="kv">' +
      '<dt>Basis</dt><dd>' + esc(row.comps_label) + '</dd>' +
      '<dt>Live comparables counted</dt><dd>' + row.comps_peers + '</dd>' +
      '<dt>Median mcap / TVL</dt><dd>' + mult(cat ? cat.multiple : DATA.global_comps.multiple) + '</dd>' +
      '<dt>Interquartile range</dt><dd>' + mult(cat ? cat.p25 : DATA.global_comps.p25) + ' – ' + mult(cat ? cat.p75 : DATA.global_comps.p75) + '</dd>' +
      '<dt>Snapshot-wide median</dt><dd>' + mult(DATA.global_comps.multiple) + '</dd>' +
      '</dl>' +
      (live.length
        ? '<table><thead><tr><th>Largest live peers</th><th class="num">Mcap/TVL</th><th class="num">Mcap</th></tr></thead><tbody>' +
          live.map(function (l) {
            var m = l.mcap_usd && l.tvl_usd ? l.mcap_usd / l.tvl_usd : null;
            return '<tr><td>' + esc(l.name) + '</td><td class="num mono">' + mult(m) + '</td><td class="num mono">' + usd(l.mcap_usd) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p class="sub">' + (cat
            ? 'This category\'s comparables sit outside the 24 largest live tokens, so they set the multiple without being listed here.'
            : 'No live token in this category carries a market cap, so the row is priced on the snapshot-wide median of ' + mult(DATA.global_comps.multiple) + '.') + '</p>') +
      '</div>'
    );
  }

  function peersOf(row, limit) {
    var same = [];
    var target = (row.category || '').toLowerCase();
    board.forEach(function (r) {
      if (r.slug === row.slug) return;
      if ((r.category || '').toLowerCase() === target) same.push(r);
    });
    same.sort(function (a, b) { return a.rank - b.rank; });
    return same.slice(0, limit || 5);
  }

  function viewDetail(s) {
    var row = bySlug[s.slug];
    if (!row) {
      main.innerHTML = '<p class="empty">No protocol named “' + esc(s.slug) + '” on this board. <a href="#/board">Back to the board</a>.</p>';
      return;
    }
    var prev = board[row.rank - 2];
    var next = board[row.rank];
    var peers = peersOf(row, 5);
    var live = DATA.live.filter(function (l) { return l.category === row.category; }).slice(0, 5);
    var steps = row.farm_steps.map(splitStep);
    main.innerHTML =
      '<div class="crumbs"><a href="#/board">← Board</a><span>/</span><span>rank ' + row.rank + ' of ' + board.length + '</span></div>' +
      '<section class="detail-head">' +
      '<div class="names">' +
      '<div class="eyebrow">' + esc(row.category || 'Uncategorised') + ' · pre-token</div>' +
      '<h1>' + esc(row.name) + '</h1>' +
      '<div class="tags">' + (row.chains.length ? row.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') : '<span class="chip">no chain listed</span>') + '</div>' +
      '</div>' +
      '<div class="bignum"><div class="k">Implied launch value</div><div class="v">' + usd(row.implied_value_usd) + '</div>' +
      '<div class="r">band ' + usd(row.implied_low_usd) + ' – ' + usd(row.implied_high_usd) + '</div></div>' +
      '</section>' +
      '<div class="grid2">' +
      '<div class="panel pad block">' +
      '<h2>What the model used</h2>' +
      '<dl class="kv">' +
      '<dt>TVL, snapshot ' + esc(DATA.as_of) + '</dt><dd>' + usd(row.tvl_usd) + '</dd>' +
      '<dt>Comps: ' + esc(row.comps_label) + '</dt><dd>' + mult(row.category_multiple) + '</dd>' +
      '<dt>Peers behind that multiple</dt><dd>' + row.comps_peers + '</dd>' +
      '<dt>TVL change, 7 days</dt><dd class="' + tone(row.change_7d) + '">' + pct(row.change_7d) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>' + row.growth_multiplier.toFixed(4) + 'x</dd>' +
      '<dt>Maturity multiplier</dt><dd>' + row.maturity_multiplier.toFixed(4) + 'x</dd>' +
      '<dt>Chain breadth multiplier</dt><dd>' + row.breadth_multiplier.toFixed(4) + 'x</dd>' +
      '<dt>Tracked since</dt><dd>' + esc(row.listed_at || 'unknown') + '</dd>' +
      '<dt>Age in the snapshot</dt><dd>' + age(row.age_days) + '</dd>' +
      '<dt>Records a token</dt><dd>no</dd>' +
      '</dl>' +
      '<div class="formula">implied = TVL × <em>' + mult(row.category_multiple) + '</em> × ' + row.growth_multiplier.toFixed(4) +
      ' × ' + row.maturity_multiplier.toFixed(4) + ' × ' + row.breadth_multiplier.toFixed(4) +
      ' = <em>' + usd(row.implied_value_usd) + '</em></div>' +
      '<p class="sub">The band is the interquartile spread of the category\'s own multiples' + (row.comps_peers < 6 ? ', widened because fewer than six peers carry it' : '') + '. It says how thin the evidence is, not how likely a launch is.</p>' +
      '</div>' +
      '<div class="panel pad block">' +
      '<h2>Farm plan</h2>' +
      '<p class="sub">Six steps from the row\'s own record: category, chains, size and age. Nothing here names a protocol by hand.</p>' +
      '<ol class="steps">' + steps.map(function (st, i) {
        return '<li><span class="n">' + (i + 1) + '</span><div><div class="t">' + esc(st.text) + '.</div>' +
          '<div class="m">Cost: ' + esc(st.cost || 'n/a') + ' · Time: ' + esc(st.time || 'n/a') + '</div></div></li>';
      }).join('') + '</ol>' +
      '</div>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="panel pad block"><h2>Nearest ranked peers</h2>' +
      (peers.length ? '<table><thead><tr><th class="rank">#</th><th>Protocol</th><th class="num">TVL</th><th class="num">Implied</th></tr></thead><tbody>' +
        peers.map(function (p) {
          return '<tr data-slug="' + esc(p.slug) + '"><td class="rank">' + p.rank + '</td><td>' + esc(p.name) + '</td>' +
            '<td class="num mono">' + usd(p.tvl_usd) + '</td><td class="num mono">' + usd(p.implied_value_usd) + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="sub">No other pre-token protocol in this category is on the board: this one is priced on the snapshot-wide multiple.</p>') +
      '</div>' +
      compsPanel(row) +
      '</div>' +
      '<div class="pager">' +
      (prev ? '<a href="#/p/' + encodeURIComponent(prev.slug) + '">← rank ' + prev.rank + ' · ' + esc(prev.name) + '</a>' : '<span></span>') +
      (next ? '<a href="#/p/' + encodeURIComponent(next.slug) + '">rank ' + next.rank + ' · ' + esc(next.name) + ' →</a>' : '<span></span>') +
      '</div>';
    Array.prototype.forEach.call(main.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug')); });
    });
  }

  // ---------- comps ----------
  function viewComps() {
    var rows = DATA.comps.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    var max = rows.length ? rows[0].multiple : 1;
    main.innerHTML =
      '<section class="lede"><div class="eyebrow">Calibration</div>' +
      '<h1>The market multiple, by category.</h1>' +
      '<p class="sub">Each figure is the median market cap over TVL of every live-token protocol in the snapshot that shares the category — ' +
      'the multiple a pre-token protocol in that business is priced at. Categories with fewer than <strong>' + DATA.model.min_peers + ' live comparables</strong> ' +
      'borrow the snapshot-wide median of <strong>' + mult(DATA.global_comps.multiple) + '</strong>.</p></section>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Live comparables</div><div class="v">' + num(DATA.global_comps.peers) + '</div><div class="n">across the whole snapshot</div></div>' +
      '<div class="stat"><div class="k">Snapshot median</div><div class="v">' + mult(DATA.global_comps.multiple) + '</div><div class="n">p25 ' + mult(DATA.global_comps.p25) + ' · p75 ' + mult(DATA.global_comps.p75) + '</div></div>' +
      '<div class="stat"><div class="k">Categories priced</div><div class="v">' + num(rows.length) + '</div><div class="n">with ' + DATA.model.min_peers + '+ peers each</div></div>' +
      '<div class="stat"><div class="k">Ratio clamp</div><div class="v">' + mult(DATA.model.comp_floor) + '–' + mult(DATA.model.comp_cap) + '</div><div class="n">one outlier cannot set a multiple</div></div>' +
      '</div>' +
      '<div class="panel pad" style="margin-top:18px"><h2>Multiple by category</h2><div class="bars">' +
      rows.map(function (c) {
        return '<div class="barrow"><span>' + esc(c.category) + '</span><span class="track"><i style="width:' +
          Math.max(2, (c.multiple / Math.max(max, 0.001)) * 100).toFixed(1) + '%"></i></span><span class="n">' + mult(c.multiple) + ' · ' + c.peers + 'p</span></div>';
      }).join('') + '</div></div>' +
      '<div class="panel pad" style="margin-top:16px"><h2>Every category\'s spread</h2><div class="tablewrap" style="margin-top:10px"><table>' +
      '<thead><tr><th>Category</th><th class="num">Peers</th><th class="num">p25</th><th class="num">Median</th><th class="num">p75</th></tr></thead><tbody>' +
      rows.map(function (c) {
        return '<tr><td>' + esc(c.category) + '</td><td class="num mono">' + c.peers + '</td><td class="num mono muted">' + mult(c.p25) +
          '</td><td class="num mono">' + mult(c.multiple) + '</td><td class="num mono muted">' + mult(c.p75) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // ---------- model ----------
  function viewModel() {
    var M = DATA.model;
    main.innerHTML =
      '<section class="lede"><div class="eyebrow">Method · ' + esc(DATA.model_version) + '</div>' +
      '<h1>One formula, no hand-picked names.</h1>' +
      '<p class="sub">The radar prices a pre-token protocol the way the market prices its peers, then adjusts that value for momentum, ' +
      'maturity and how widely the protocol is deployed. Every constant is here, and every row on the board can be recomputed from the snapshot by hand.</p></section>' +
      '<div class="grid2">' +
      '<div class="panel pad block"><h2>The model</h2>' +
      '<div class="formula">implied = TVL × <em>comps</em> × <em>growth</em> × <em>maturity</em> × <em>breadth</em><br><br>' +
      'comps    = median(mcap / TVL) of the category\'s live tokens<br>' +
      'growth   = 1 + clamp(Δ7d, ' + M.growth_floor + ', ' + M.growth_cap + ')/100 × ' + M.growth_weight + '<br>' +
      'maturity = ' + M.maturity_floor + ' + min(age, ' + M.maturity_days + ')/' + M.maturity_days + ' × ' + M.maturity_range + '<br>' +
      'breadth  = 1 + (min(chains, ' + M.breadth_max_chains + ') − 1) × ' + M.breadth_weight + '</div>' +
      '<dl class="kv">' +
      '<dt>Comparable floor / cap</dt><dd>' + mult(M.comp_floor) + ' / ' + mult(M.comp_cap) + '</dd>' +
      '<dt>Peers a category needs</dt><dd>' + M.min_peers + '</dd>' +
      '<dt>Unknown age assumed</dt><dd>' + M.unknown_age_days + ' days</dd>' +
      '<dt>Rows on the board</dt><dd>' + num(DATA.board_size) + '</dd>' +
      '<dt>Below the floor</dt><dd>' + num(DATA.early_size) + '</dd>' +
      '</dl></div>' +
      '<div class="panel pad prose"><h2>What it can and cannot know</h2>' +
      '<ul>' +
      '<li><strong>It knows size and trend.</strong> TVL, its seven-day change, the chains it sits on and how long DefiLlama has tracked it.</li>' +
      '<li><strong>It does not know a launch is coming.</strong> A pre-token protocol may never issue one; the board ranks value if it does, never the odds.</li>' +
      '<li><strong>Comps are the market\'s own numbers.</strong> A category\'s multiple comes from the live tokens in it, so a rich category stays rich until its tokens re-rate.</li>' +
      '<li><strong>The band is honest.</strong> It is the interquartile spread of those comparables, widened under six peers: wide bands mean thin evidence.</li>' +
      '<li><strong>Nothing is hand-listed.</strong> The same function scores all ' + num(DATA.board_size) + ' rows, and the board refuses to publish a ranking the gate would reject.</li>' +
      '</ul></div></div>';
  }

  // ---------- live ----------
  function viewLive() {
    main.innerHTML =
      '<section class="lede"><div class="eyebrow">The other side of the trade</div>' +
      '<h1>Protocols whose token already trades.</h1>' +
      '<p class="sub">These set the multiples. Each market cap is the market\'s own figure, shown as it is — never mixed into the ranked board, ' +
      'where every protocol still has no token.</p></section>' +
      '<div class="tablewrap" style="margin-top:20px"><table><thead><tr><th class="rank">#</th><th>Protocol</th><th class="hide-sm">Category</th>' +
      '<th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr></thead><tbody>' +
      DATA.live.map(function (l, i) {
        var m = l.mcap_usd && l.tvl_usd ? l.mcap_usd / l.tvl_usd : null;
        return '<tr><td class="rank">' + (i + 1) + '</td><td><div class="who"><b>' + esc(l.name) + '</b><span>' +
          esc(l.chains.slice(0, 2).join(' · ')) + '</span></div></td><td class="hide-sm"><span class="chip">' + esc(l.category || '—') +
          '</span></td><td class="num mono">' + usd(l.mcap_usd) + '</td><td class="num mono">' + usd(l.tvl_usd) + '</td><td class="num mono">' + mult(m) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- boot ----------
  function render() {
    var s = parseHash();
    chrome(s);
    if (s.view === 'p') viewDetail(s);
    else if (s.view === 'comps') viewComps();
    else if (s.view === 'model') viewModel();
    else if (s.view === 'live') viewLive();
    else viewBoard(s);
    if (s.view !== 'board' && s.view !== 'p') main.focus();
  }

  window.addEventListener('hashchange', render);
  render();
})();
