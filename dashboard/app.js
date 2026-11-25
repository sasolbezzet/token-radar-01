// Conformal Launch Radar UI: executes shared RadarModel directly on window.SNAPSHOT in browser,
// verifies 100% row-for-row parity with board.json, and renders board, detail drawer, & blind audit.
(function () {
  'use strict';

  var SNAP = window.SNAPSHOT;
  var DIGEST = window.BOARD_DIGEST || [];
  var MODEL_LIB = window.RadarModel;
  if (!SNAP || !MODEL_LIB) return;

  var RADAR = MODEL_LIB.buildFromSnapshot(SNAP);
  var PARITY = verifyParity(RADAR.rows, DIGEST);

  var state = {
    tab: 'radar', // radar | watchlist | live | excluded | model
    q: '',
    tier: 'all',
    verdict: 'all',
    category: 'all',
    chain: 'all',
    capital: 0, // 0 = auto min-viable per TVL
    sort: 'implied',
    dir: -1,
    page: 0,
    pageSize: 16,
    selected: null,
  };

  function verifyParity(rows, digest) {
    if (!digest.length) return { ok: true, matched: rows.length, maxDelta: 0 };
    var bySlug = {};
    for (var i = 0; i < digest.length; i++) bySlug[digest[i].slug] = digest[i];
    var matched = 0;
    var maxDelta = 0;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var d = bySlug[r.slug];
      if (!d) continue;
      var delta = Math.abs(r.implied_value_usd - d.implied_value_usd);
      if (delta > maxDelta) maxDelta = delta;
      if (delta === 0 && r.rank === d.rank) matched++;
    }
    return { ok: matched === rows.length && rows.length === digest.length, matched: matched, maxDelta: maxDelta };
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(abs < 100 && abs % 1 !== 0 ? 2 : 0);
  }

  function fmtSignedUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + fmtUsd(n);
  }

  function fmtPct(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    return days >= 365 ? (days / 365).toFixed(1) + 'y' : days + 'd';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = attrs[k];
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (var j = 2; j < arguments.length; j++) {
      var ch = arguments[j];
      if (ch === null || ch === undefined) continue;
      if (Array.isArray(ch)) ch.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof ch === 'string') node.appendChild(document.createTextNode(ch));
      else node.appendChild(ch);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('tier')) state.tier = p.get('tier');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('cap')) state.capital = Number(p.get('cap')) || 0;
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = Number(p.get('dir')) || -1;
    if (p.get('p')) state.selected = p.get('p');
  }

  function effectiveRow(r) {
    if (!state.capital) return r;
    var plan = MODEL_LIB.deriveFarmPlan(r, state.capital);
    var copy = {};
    for (var k in r) copy[k] = r[k];
    for (var m in plan) copy[m] = plan[m];
    return copy;
  }

  function filteredPreRows() {
    var q = state.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < RADAR.rows.length; i++) {
      var base = RADAR.rows[i];
      var r = effectiveRow(base);
      if (state.tab === 'watchlist' && !r.in_watchlist) continue;
      if (state.tier !== 'all' && r.tier !== state.tier) continue;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) continue;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) continue;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) continue;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      out.push(r);
    }
    return out;
  }

  function sortRows(list) {
    var k = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'rank') { av = a.rank; bv = b.rank; }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? 1e9 : a.age_days; bv = b.age_days === null ? 1e9 : b.age_days; }
      else if (k === 'odds') { av = a.p_launch || 0; bv = b.p_launch || 0; }
      else if (k === 'net') { av = a.net_ev_usd || 0; bv = b.net_ev_usd || 0; }
      else if (k === 'hr') { av = a.usd_per_hour || 0; bv = b.usd_per_hour || 0; }
      else if (k === 'mcap') { av = a.mcap_usd || 0; bv = b.mcap_usd || 0; }
      else { av = a.implied_value_usd || 0; bv = b.implied_value_usd || 0; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function uniqueCategories(rows) {
    var set = {};
    rows.forEach(function (r) { set[r.category || 'Uncategorized'] = 1; });
    return Object.keys(set).sort();
  }

  function uniqueChains(rows) {
    var counts = {};
    rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 24);
  }

  function countVerdicts(rows) {
    var c = { FARM: 0, THIN: 0, SKIP: 0 };
    rows.forEach(function (r) { c[r.verdict] = (c[r.verdict] || 0) + 1; });
    return c;
  }

  function sortButton(label, key) {
    var active = state.sort === key;
    var arrow = active ? (state.dir === -1 ? ' ↓' : ' ↑') : '';
    return el('button', {
      type: 'button',
      text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        state.page = 0;
        render();
      },
    });
  }

  function renderTopAndKpis(verdictCounts) {
    var u = RADAR.universe;
    var vm = RADAR.val_model;
    var om = RADAR.odds_model;

    var topbar = el('header', { class: 'topbar' },
      el('div', { class: 'brand' },
        el('span', { class: 'dot' }),
        el('div', null,
          el('h1', { class: 'brand-title', text: 'Conformal Token Launch Radar' }),
          el('div', { class: 'brand-sub', text: 'Snapshot ' + RADAR.as_of + ' · Power-Law Size Curve × Bayes Launch Odds · Live Browser Recompute' }),
        ),
      ),
      el('div', { class: 'top-pills' },
        el('span', { class: 'pill ok', text: 'PARITY ' + PARITY.matched + '/' + u.pre_total + ' ($' + PARITY.maxDelta + ' Δ)' }),
        el('span', { class: 'pill ok', text: 'WATCHLIST ' + u.watchlist + '/' + SNAP.watchlist.length + ' (100%)' }),
        el('span', { class: 'pill', text: u.watchlist + ' WL + ' + u.pre_early + ' Early + ' + u.live + ' Live + ' + u.excluded + ' Excl = ' + u.total }),
      ),
    );

    var kpis = el('section', { class: 'kpis' },
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Watchlist Floor Coverage' }),
        el('div', { class: 'kpi-val', text: u.watchlist + ' / ' + SNAP.watchlist.length + ' (100%)' }),
        el('div', { class: 'kpi-sub', text: 'Floor ' + fmtUsd(RADAR.floor_usd) + ' · All pre-token ranked: ' + u.pre_total }),
      ),
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Size Curve vs Flat Comps' }),
        el('div', { class: 'kpi-val', text: 'LOO ×' + vm.loo_med_mult.toFixed(2) + ' · WF ×' + vm.wf_med_mult.toFixed(2) }),
        el('div', { class: 'kpi-sub', text: 'Fitted on ' + vm.n_comps + ' peers (β_TVL=' + vm.b1_tvl.toFixed(3) + ') vs flat ×' + vm.tests[0].loo_med_mult.toFixed(2) }),
      ),
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Peer Launch Odds Fit' }),
        el('div', { class: 'kpi-val', text: 'LogLoss ' + om.tests[2].cv10_logloss.toFixed(3) + ' vs ' + om.null_logloss.toFixed(3) }),
        el('div', { class: 'kpi-sub', text: om.n_dated + ' dated peers · Asymptote ' + (om.p_asymp * 100).toFixed(1) + '% (>3y)' }),
      ),
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Netted Farm Verdicts' }),
        el('div', { class: 'kpi-val', text: verdictCounts.FARM + ' FARM · ' + verdictCounts.THIN + ' THIN' }),
        el('div', { class: 'kpi-sub', text: verdictCounts.SKIP + ' SKIP · Gas + 4.5% APR opp cost netted' }),
      ),
    );

    var evidence = el('section', { class: 'evidence' },
      el('div', { class: 'ev-block' },
        el('div', { class: 'ev-title', text: 'Stage 1 Valuation Gate (LOO-CV & Walk-Forward ' + vm.wf_train + '/' + vm.wf_test + ')' }),
        el('div', { class: 'ev-row' }, vm.tests.slice(1).map(function (t) {
          var cls = t.decision === 'KEPT' ? 'tag kept' : 'tag drop';
          return el('span', { class: cls, text: t.term.replace('+ ', '') + ' (' + t.decision + ' ' + t.loo_rmse.toFixed(2) + '/' + t.wf_rmse.toFixed(2) + ')' });
        })),
      ),
      el('div', { class: 'ev-block' },
        el('div', { class: 'ev-title', text: 'Stage 2 Token Launch Odds Gate (10-Fold & Split-Half CV)' }),
        el('div', { class: 'ev-row' }, om.tests.slice(1).map(function (t) {
          var cls = t.decision === 'KEPT' ? 'tag kept' : 'tag drop';
          return el('span', { class: cls, text: t.term.replace('+ ', '') + ' (' + t.decision + ' ' + t.cv10_logloss.toFixed(3) + ')' });
        })),
      ),
    );

    return [topbar, kpis, evidence];
  }

  function renderToolbar(shownCount, totalTabCount) {
    var u = RADAR.universe;
    var tabs = [
      { id: 'radar', label: 'Pre-Token Radar (' + u.pre_total + ')' },
      { id: 'watchlist', label: 'Watchlist Floor (' + u.watchlist + ')' },
      { id: 'live', label: 'Live Token Comps (' + u.live + ')' },
      { id: 'excluded', label: 'Excluded Wrapped/CEX (' + u.excluded + ')' },
      { id: 'model', label: 'Model & Blind Tests' },
    ];

    var tabBar = el('div', { class: 'tabs' }, tabs.map(function (t) {
      return el('button', {
        type: 'button',
        class: 'tab',
        'aria-pressed': String(state.tab === t.id),
        text: t.label,
        onclick: function () {
          state.tab = t.id;
          state.page = 0;
          if (t.id === 'live') state.sort = 'mcap';
          else if (t.id === 'excluded') state.sort = 'tvl';
          else if (state.sort === 'mcap') state.sort = 'implied';
          render();
        },
      });
    }));

    if (state.tab === 'model') {
      return el('div', { class: 'toolbar' }, tabBar, el('span', { class: 'count-line', text: 'Every term blind-tested on snapshot' }));
    }

    var search = el('input', {
      type: 'search',
      class: 'ctrl ctrl-search',
      placeholder: 'Search protocol, slug, chain...',
      value: state.q,
      oninput: function (e) {
        state.q = e.target.value;
        state.page = 0;
        render();
        var next = document.querySelector('.ctrl-search');
        if (next) { next.focus(); next.setSelectionRange(state.q.length, state.q.length); }
      },
    });

    var controls = [search];
    if (state.tab === 'radar' || state.tab === 'watchlist') {
      var vGroup = el('div', { class: 'vgroup' }, ['all', 'FARM', 'THIN', 'SKIP'].map(function (v) {
        return el('button', {
          type: 'button',
          class: 'vbtn',
          'aria-pressed': String(state.verdict === v),
          text: v === 'all' ? 'ALL' : v,
          onclick: function () { state.verdict = v; state.page = 0; render(); },
        });
      }));

      var tierSel = el('select', {
        class: 'ctrl',
        onchange: function (e) { state.tier = e.target.value; state.page = 0; render(); },
      }, [
        el('option', { value: 'all', text: 'Tier: All Pre-Token' }),
        el('option', { value: 'Watchlist Floor', text: 'Watchlist Floor (40)' }),
        el('option', { value: 'Sub-Protocol', text: 'Sub-Protocol >=$50M (20)' }),
        el('option', { value: 'Early <$50M', text: 'Early Gems <$50M (138)' }),
      ]);
      tierSel.value = state.tier;

      var catSel = el('select', {
        class: 'ctrl',
        onchange: function (e) { state.category = e.target.value; state.page = 0; render(); },
      }, [el('option', { value: 'all', text: 'Sector: All' })].concat(uniqueCategories(RADAR.rows).map(function (c) {
        return el('option', { value: c, text: c });
      })));
      catSel.value = state.category;

      var chSel = el('select', {
        class: 'ctrl',
        onchange: function (e) { state.chain = e.target.value; state.page = 0; render(); },
      }, [el('option', { value: 'all', text: 'Chain: All' })].concat(uniqueChains(RADAR.rows).map(function (c) {
        return el('option', { value: c, text: c });
      })));
      chSel.value = state.chain;

      var capSel = el('select', {
        class: 'ctrl',
        onchange: function (e) { state.capital = Number(e.target.value) || 0; state.page = 0; render(); },
      }, [
        el('option', { value: '0', text: 'Cap: Auto Min-Viable' }),
        el('option', { value: '250', text: 'Cap: $250' }),
        el('option', { value: '500', text: 'Cap: $500' }),
        el('option', { value: '1000', text: 'Cap: $1,000' }),
        el('option', { value: '2500', text: 'Cap: $2,500' }),
      ]);
      capSel.value = String(state.capital);

      controls.push(vGroup, tierSel, catSel, chSel, capSel);
    }

    controls.push(el('span', { class: 'count-line', text: 'Showing ' + shownCount + ' / ' + totalTabCount }));
    return el('div', null,
      el('div', { class: 'toolbar' }, tabBar),
      el('div', { class: 'toolbar' }, el('div', { class: 'filters' }, controls)),
    );
  }

  function tierClass(tier) {
    if (tier === 'Watchlist Floor') return 'tier-badge tier-wl';
    if (tier === 'Sub-Protocol') return 'tier-badge tier-sub';
    return 'tier-badge tier-early';
  }

  function pagerBar(total) {
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    return el('div', { class: 'pager' },
      el('span', { text: 'Page ' + (state.page + 1) + ' of ' + pages + ' (' + total + ' protocols)' }),
      el('div', { class: 'filters' },
        el('button', { type: 'button', text: 'Prev', disabled: state.page === 0 ? 'disabled' : null, onclick: function () { state.page--; render(); } }),
        el('button', { type: 'button', text: 'Next', disabled: state.page + 1 >= pages ? 'disabled' : null, onclick: function () { state.page++; render(); } }),
      ),
    );
  }

  function renderRadarTable(list) {
    var start = state.page * state.pageSize;
    var slice = list.slice(start, start + state.pageSize);
    var head = el('thead', null, el('tr', null,
      el('th', null, sortButton('#', 'rank')),
      el('th', null, 'Protocol'),
      el('th', { class: 'right' }, sortButton('TVL', 'tvl')),
      el('th', { class: 'right' }, sortButton('7d', 'growth')),
      el('th', { class: 'right' }, sortButton('Age', 'age')),
      el('th', null, sortButton('Odds', 'odds')),
      el('th', { class: 'right' }, sortButton('Implied Value (50% Band)', 'implied')),
      el('th', null, 'Route & Gas'),
      el('th', { class: 'right' }, sortButton('Net EV', 'net')),
      el('th', { class: 'right' }, sortButton('$/Hour', 'hr')),
      el('th', null, 'Verdict'),
    ));

    var body = el('tbody', null, slice.map(function (r) {
      var gCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nCls = r.net_ev_usd >= 0 ? 'pos' : 'neg';
      var tierShort = r.tier === 'Watchlist Floor' ? 'WL' : (r.tier === 'Sub-Protocol' ? 'SUB' : 'EARLY');
      return el('tr', {
        'data-selected': String(state.selected === r.slug),
        onclick: function () { state.selected = r.slug; render(); },
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'proto-cell' },
          el('div', { class: 'proto-name' }, el('span', { text: r.name }), el('span', { class: tierClass(r.tier), text: tierShort })),
          el('div', { class: 'proto-sub', text: (r.category || 'DeFi') + ' · ' + (r.chains || []).slice(0, 3).join(', ') }),
        )),
        el('td', { class: 'num right', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num right ' + gCls, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num right', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'odds-wrap' },
          el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.round(r.p_launch * 100) + '%' })),
          el('span', { class: 'num', text: (r.p_launch * 100).toFixed(0) + '%' }),
        )),
        el('td', { class: 'right' }, el('div', { class: 'val-cell' },
          el('span', { class: 'num val-main', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'num val-band', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) }),
        )),
        el('td', { class: 'num', text: r.best_chain + ' ($' + r.gas_usd.toFixed(1) + ')' }),
        el('td', { class: 'num right ' + nCls, text: fmtSignedUsd(r.net_ev_usd) }),
        el('td', { class: 'num right ' + nCls, text: fmtSignedUsd(r.usd_per_hour) + '/h' }),
        el('td', null, el('span', { class: 'verdict v-' + r.verdict, text: r.verdict })),
      );
    }));
    return el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null, head, body)), pagerBar(list.length));
  }

  function renderSimpleTable(list, mode) {
    var q = state.q.trim().toLowerCase();
    var filtered = list.filter(function (r) {
      return !q || (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.symbol || '')).toLowerCase().indexOf(q) >= 0;
    });
    var sorted = sortRows(filtered);
    var slice = sorted.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
    var head = el('thead', null, el('tr', null,
      el('th', null, 'Protocol'),
      el('th', null, mode === 'live' ? 'Symbol / Role' : 'Exclusion Reason'),
      el('th', { class: 'right' }, sortButton('TVL', 'tvl')),
      el('th', { class: 'right' }, mode === 'live' ? sortButton('Market Cap', 'mcap') : 'Age'),
      el('th', { class: 'right' }, mode === 'live' ? 'Mcap / TVL' : '7d Change'),
    ));
    var body = el('tbody', null, slice.map(function (r) {
      return el('tr', null,
        el('td', null, el('div', { class: 'proto-cell' },
          el('div', { class: 'proto-name', text: r.name }),
          el('div', { class: 'proto-sub', text: (r.category || 'DeFi') + ' · ' + (r.chains || []).slice(0, 3).join(', ') }),
        )),
        el('td', { class: 'num', text: mode === 'live' ? (r.symbol || 'TOKEN') + (r.is_comp ? ' · Calibration Comp' : ' · Live Token') : r.reason }),
        el('td', { class: 'num right', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num right', text: mode === 'live' ? fmtUsd(r.mcap_usd) : fmtAge(r.age_days) }),
        el('td', { class: 'num right', text: mode === 'live' ? (r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) + 'x' : 'n/a') : fmtPct(r.change_7d) }),
      );
    }));
    return el('section', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null, head, body)), pagerBar(sorted.length));
  }

  function renderModelPage() {
    var vm = RADAR.val_model;
    var om = RADAR.odds_model;
    return el('section', { class: 'panel' }, el('div', { class: 'model-grid' },
      el('div', { class: 'model-card' },
        el('h3', { text: 'Stage 1: Launch Mcap Power Law & Dual Blind Ablation (n=' + vm.n_comps + ' Comps)' }),
        el('p', { class: 'kpi-sub', text: 'ln(Mcap) = ' + vm.b0.toFixed(3) + ' + ' + vm.b1_tvl.toFixed(3) + ' · ln(TVL/$100M). Term kept only if BOTH LOO-CV & Walk-Forward (' + vm.wf_train + '/' + vm.wf_test + ') improve.' }),
        el('table', { class: 'mini-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Specification' }), el('th', { text: 'LOO RMSE' }), el('th', { text: 'LOO Mult' }), el('th', { text: 'WF RMSE' }), el('th', { text: 'Gate' }))),
          el('tbody', null, vm.tests.map(function (t) {
            return el('tr', null,
              el('td', { text: t.term }),
              el('td', { text: t.loo_rmse.toFixed(3) }),
              el('td', { text: '×' + t.loo_med_mult.toFixed(2) }),
              el('td', { text: t.wf_rmse.toFixed(3) }),
              el('td', null, el('span', { class: t.decision === 'KEPT' ? 'pos' : '', text: t.decision })),
            );
          })),
        ),
      ),
      el('div', { class: 'model-card' },
        el('h3', { text: 'Stage 2: Peer Launch Odds & Bayes Survival (n=' + om.n_dated + ' Dated Peers)' }),
        el('p', { class: 'kpi-sub', text: 'Logistic P(tokenized | age, TVL) converted via Bayes survival using >3y asymptote (' + (om.p_asymp * 100).toFixed(1) + '%), modulated ±18% by 7d momentum.' }),
        el('table', { class: 'mini-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Odds Model Term' }), el('th', { text: '10-Fold LL' }), el('th', { text: 'Split-Half LL' }), el('th', { text: 'Brier' }), el('th', { text: 'Gate' }))),
          el('tbody', null, om.tests.map(function (t) {
            return el('tr', null,
              el('td', { text: t.term }),
              el('td', { text: t.cv10_logloss.toFixed(3) }),
              el('td', { text: t.split_logloss.toFixed(3) }),
              el('td', { text: t.cv10_brier.toFixed(3) }),
              el('td', null, el('span', { class: t.decision === 'KEPT' ? 'pos' : '', text: t.decision })),
            );
          })),
        ),
      ),
    ));
  }

  function renderDrawer() {
    var drawer = document.getElementById('drawer');
    if (!state.selected) {
      drawer.hidden = true;
      drawer.textContent = '';
      return;
    }
    var base = null;
    for (var i = 0; i < RADAR.rows.length; i++) {
      if (RADAR.rows[i].slug === state.selected) { base = RADAR.rows[i]; break; }
    }
    if (!base) { drawer.hidden = true; return; }
    var r = effectiveRow(base);
    drawer.hidden = false;
    drawer.textContent = '';

    drawer.appendChild(el('div', { class: 'd-head' },
      el('div', null,
        el('div', { class: 'filters' },
          el('span', { class: tierClass(r.tier), text: 'RANK #' + r.rank + ' · ' + r.tier.toUpperCase() }),
          el('span', { class: 'verdict v-' + r.verdict, text: r.verdict }),
        ),
        el('h2', { text: r.name }),
        el('div', { class: 'proto-sub', text: (r.category || 'DeFi') + ' · Chains: ' + (r.chains || []).join(', ') + ' · Listed: ' + (r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ')' }),
      ),
      el('button', { type: 'button', class: 'd-close', text: 'Close ×', onclick: function () { state.selected = null; render(); } }),
    ));

    drawer.appendChild(el('div', { class: 'd-box' },
      el('h3', { text: 'Two-Stage Implied Valuation Breakdown' }),
      el('div', { class: 'kv-grid' },
        el('div', { class: 'kv' }, el('span', { text: 'Reported TVL' }), el('b', { text: fmtUsd(r.tvl_usd) })),
        el('div', { class: 'kv' }, el('span', { text: 'TGE Mcap (P50)' }), el('b', { text: fmtUsd(r.tge_p50_usd) })),
        el('div', { class: 'kv' }, el('span', { text: 'Launch Odds' }), el('b', { text: (r.p_launch * 100).toFixed(1) + '%' })),
        el('div', { class: 'kv' }, el('span', { text: 'Implied Value (EV)' }), el('b', { class: 'pos', text: fmtUsd(r.implied_value_usd) })),
        el('div', { class: 'kv' }, el('span', { text: 'Conformal 50%' }), el('b', { text: fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd) })),
        el('div', { class: 'kv' }, el('span', { text: '7d Momentum' }), el('b', { text: fmtPct(r.change_7d) })),
      ),
    ));

    drawer.appendChild(el('div', { class: 'd-box' },
      el('h3', { text: 'Farm Unit Economics (' + r.best_chain + ' Route)' }),
      el('div', { class: 'kv-grid' },
        el('div', { class: 'kv' }, el('span', { text: 'Min Capital' }), el('b', { text: '$' + r.capital_usd })),
        el('div', { class: 'kv' }, el('span', { text: 'Est. Gross Drop' }), el('b', { text: '$' + r.gross_airdrop_usd.toFixed(2) })),
        el('div', { class: 'kv' }, el('span', { text: 'Gas + Opp Cost' }), el('b', { text: '$' + (r.gas_usd + r.opp_cost_usd).toFixed(2) })),
        el('div', { class: 'kv' }, el('span', { text: 'Net EV Profit' }), el('b', { class: r.net_ev_usd >= 0 ? 'pos' : 'neg', text: fmtSignedUsd(r.net_ev_usd) })),
        el('div', { class: 'kv' }, el('span', { text: 'Hourly Return' }), el('b', { class: r.usd_per_hour >= 0 ? 'pos' : 'neg', text: fmtSignedUsd(r.usd_per_hour) + '/hr' })),
        el('div', { class: 'kv' }, el('span', { text: 'Hold / Net APY' }), el('b', { text: r.hold_days + 'd · ' + r.net_apy_pct.toFixed(0) + '%' })),
      ),
    ));

    drawer.appendChild(el('div', { class: 'd-box' },
      el('h3', { text: 'Concrete Execution Checklist (' + r.farm_steps.length + ' Steps)' }),
      el('ol', { class: 'steps-list' }, r.farm_steps.map(function (st, idx) {
        var parts = st.split(' Cost: ');
        var action = parts[0];
        var meta = parts[1] ? parts[1].split(' Time: ') : ['', ''];
        return el('li', { class: 'step-item' },
          el('span', { class: 'step-num', text: String(idx + 1) }),
          el('div', { class: 'step-body' },
            el('div', { text: action }),
            el('div', { class: 'step-meta' },
              meta[0] ? el('span', { class: 'step-tag', text: 'Cost: ' + meta[0].replace(/\.$/, '') }) : null,
              meta[1] ? el('span', { class: 'step-tag', text: 'Time: ' + meta[1].replace(/\.$/, '') }) : null,
            ),
          ),
        );
      })),
    ));
  }

  function render() {
    var root = document.getElementById('app');
    root.textContent = '';

    var effectiveAll = RADAR.rows.map(effectiveRow);
    var verdictCounts = countVerdicts(effectiveAll);
    renderTopAndKpis(verdictCounts).forEach(function (node) { root.appendChild(node); });

    if (state.tab === 'model') {
      root.appendChild(renderToolbar(0, 0));
      root.appendChild(renderModelPage());
    } else if (state.tab === 'live') {
      root.appendChild(renderToolbar(RADAR.live.length, RADAR.live.length));
      root.appendChild(renderSimpleTable(RADAR.live, 'live'));
    } else if (state.tab === 'excluded') {
      root.appendChild(renderToolbar(RADAR.excluded.length, RADAR.excluded.length));
      root.appendChild(renderSimpleTable(RADAR.excluded, 'excluded'));
    } else {
      var list = sortRows(filteredPreRows());
      var baseTotal = state.tab === 'watchlist' ? RADAR.universe.watchlist : RADAR.universe.pre_total;
      root.appendChild(renderToolbar(list.length, baseTotal));
      root.appendChild(renderRadarTable(list));
    }
    renderDrawer();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });

  readHash();
  render();
})();
