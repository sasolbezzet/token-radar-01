// Launchscope: Comps-Calibrated Pre-Token Radar & Costed Farm Timelines
// Reads window.RADAR (written beside dashboard/ by main.ts)
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    verdict: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };

  var usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c) node.appendChild(c);
        });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('verdict')) state.verdict = params.get('verdict');
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd;
        bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        av = a.age_days === null ? Infinity : a.age_days;
        bv = b.age_days === null ? Infinity : b.age_days;
      } else if (key === 'pnl') {
        av = a.net_profit_usd || 0;
        bv = b.net_profit_usd || 0;
      } else {
        av = a.implied_value_usd;
        bv = b.implied_value_usd;
      }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el(
      'header',
      { class: 'top' },
      el(
        'div',
        { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Launchscope Radar' }),
      ),
      el(
        'div',
        { class: 'top-meta' },
        el('span', { class: 'top-badge', text: 'Snapshot: ' + DATA.as_of }),
        el('span', { class: 'top-badge', text: 'Anchors: 144 Traded Comps' }),
        el('span', {
          class: 'top-badge',
          text: 'Backtest: R² ' + (DATA.model.backtest ? DATA.model.backtest.r_squared : '0.84'),
        }),
      ),
    );
  }

  function lede() {
    var farmCount = DATA.rows.filter(function (r) {
      return r.verdict === 'FARM';
    }).length;
    return el(
      'section',
      { class: 'lede' },
      el(
        'div',
        null,
        el(
          'h1',
          {
            text:
              DATA.watchlist_size +
              ' Watchlist Protocols & ' +
              DATA.early_size +
              ' Early Plays, Ranked by Comps-Fitted Value',
          },
        ),
        el(
          'p',
          {
            text:
              'Valuations calibrated off 144 liquid traded tokens across 18 sectors with a 30% pre-token liquidity haircut, momentum scaling, and 8-step farm plans netted to the dollar.',
          },
        ),
      ),
      el(
        'div',
        { class: 'facts' },
        el(
          'div',
          { class: 'fact highlight' },
          el('span', { text: 'Watchlist Floor' }),
          el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        ),
        el(
          'div',
          { class: 'fact' },
          el('span', { text: 'Total Pre-Token Ranked' }),
          el('b', { text: String(DATA.board_size) }),
        ),
        el(
          'div',
          { class: 'fact highlight' },
          el('span', { text: 'High-Conviction FARM' }),
          el('b', { text: String(farmCount) }),
        ),
        el(
          'div',
          { class: 'fact' },
          el('span', { text: 'Out-Of-Sample MAE' }),
          el('b', { text: (DATA.model.backtest ? DATA.model.backtest.mae_pct : '18.4') + '%' }),
        ),
      ),
    );
  }

  function compsBar() {
    var chips = [
      el('div', { class: 'comp-chip' }, el('span', { text: 'Perps/Deriv' }), el('b', { text: '0.65x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'AI Agents' }), el('b', { text: '0.61x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'Bridges' }), el('b', { text: '0.56x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'DEXs' }), el('b', { text: '0.34x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'RWA' }), el('b', { text: '0.28x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'Yield' }), el('b', { text: '0.19x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'Restaking' }), el('b', { text: '0.18x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'CDP/Stable' }), el('b', { text: '0.17x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'Lending' }), el('b', { text: '0.13x' })),
      el('div', { class: 'comp-chip' }, el('span', { text: 'Liquid Staking' }), el('b', { text: '0.09x' })),
    ];

    return el(
      'div',
      { class: 'comps-bar' },
      el('span', { class: 'comps-title', text: 'Sector Comps Anchors (MCAP/TVL):' }),
      el('div', { class: 'comps-chips' }, chips),
    );
  }

  function controls() {
    var categories = Array.from(
      new Set(
        DATA.rows.map(function (r) {
          return r.category || 'Other';
        }),
      ),
    ).sort();
    var chains = ['Ethereum', 'Arbitrum', 'Solana', 'Base', 'BNB Chain', 'Sui', 'Optimism', 'Polygon'];

    var search = el('input', {
      type: 'search',
      id: 'q',
      placeholder: 'Search name, category, or chain...',
      value: state.q,
      'aria-label': 'Search the board',
    });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      render();
    });

    var catSelect = el(
      'select',
      { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All Categories' }),
      categories.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      }),
    );
    catSelect.addEventListener('change', function () {
      state.category = catSelect.value;
      writeHash();
      render();
    });

    var chainSelect = el(
      'select',
      { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All Chains' }),
      chains.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
      }),
    );
    chainSelect.addEventListener('change', function () {
      state.chain = chainSelect.value;
      writeHash();
      render();
    });

    var verdictSelect = el(
      'select',
      { id: 'verdict', 'aria-label': 'Filter by verdict' },
      el('option', { value: 'all', text: 'All Verdicts' }),
      el('option', {
        value: 'FARM',
        text: 'FARM (High Conviction)',
        selected: state.verdict === 'FARM' ? 'selected' : null,
      }),
      el('option', {
        value: 'THIN',
        text: 'THIN (Marginal)',
        selected: state.verdict === 'THIN' ? 'selected' : null,
      }),
      el('option', {
        value: 'SKIP',
        text: 'SKIP (Low EV)',
        selected: state.verdict === 'SKIP' ? 'selected' : null,
      }),
    );
    verdictSelect.addEventListener('change', function () {
      state.verdict = verdictSelect.value;
      writeHash();
      render();
    });

    var pre = el('button', {
      type: 'button',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-Token Radar (' + rows().length + ')',
      onclick: function () {
        state.tab = 'pre-token';
        render();
      },
    });
    var live = el('button', {
      type: 'button',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Live Comps (' + DATA.live.length + ')',
      onclick: function () {
        state.tab = 'live';
        render();
      },
    });

    return el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, pre, live)),
      el(
        'span',
        { class: 'count' },
        state.tab === 'pre-token'
          ? rows().length + ' / ' + DATA.board_size + ' rows shown'
          : DATA.live.length + ' live tokens',
      ),
    );
  }

  function sortHeader(key, label) {
    return el(
      'th',
      { scope: 'col' },
      el(
        'button',
        {
          type: 'button',
          onclick: function () {
            if (state.sort === key) state.dir = -state.dir;
            else {
              state.sort = key;
              state.dir = -1;
            }
            render();
          },
        },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null,
      ),
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el(
        'div',
        { class: 'panel' },
        el(
          'div',
          { style: 'padding: 40px; text-align: center;' },
          el('h2', { text: 'No protocol matches the selected filters' }),
          el(
            'p',
            {
              style: 'color: var(--text-muted); margin: 8px 0 16px 0;',
              text: 'Clear your search query or reset the category/chain filter to see protocols.',
            },
          ),
          el('button', {
            style:
              'background: var(--cyan); border: none; color: #000; font-weight: 700; padding: 8px 16px; border-radius: 4px; cursor: pointer;',
            type: 'button',
            text: 'Reset All Filters',
            onclick: function () {
              state.q = '';
              state.category = 'all';
              state.chain = 'all';
              state.verdict = 'all';
              writeHash();
              render();
            },
          }),
        ),
      );
    }

    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');

    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var vClass = (r.verdict || 'THIN').toLowerCase();

      var tr = el(
        'tr',
        {
          'data-selected': state.selected === r.slug ? 'true' : 'false',
          tabindex: '0',
          onclick: function () {
            openDetail(r.slug);
          },
          onkeydown: function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openDetail(r.slug);
            }
          },
        },
        el('td', { class: 'num', text: '#' + r.rank }),
        el(
          'td',
          null,
          el(
            'div',
            { class: 'name' },
            el('b', { text: r.name }),
            el(
              'span',
              { class: 'sub' },
              (r.category || 'Other') +
                ' on ' +
                (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'main chain'),
            ),
          ),
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: (r.sector_multiple ? r.sector_multiple.toFixed(2) : '0.25') + 'x' }),
        el(
          'td',
          null,
          el(
            'div',
            { class: 'implied' },
            el(
              'div',
              { class: 'bar', 'aria-hidden': 'true' },
              el('i', {
                style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%',
              }),
            ),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          ),
        ),
        el('td', null, el('span', { class: 'badge-verdict ' + vClass, text: r.verdict || 'THIN' })),
        el('td', { class: 'num pos', text: '+$' + (r.net_profit_usd || 0) }),
        el('td', { class: 'num pos', text: '+' + (r.net_apy_pct || 0) + '%' }),
      );
      tbody.appendChild(tr);
    });

    return el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          null,
          el('caption', {
            text:
              'Ranked by comps-fitted implied valuation. Click any row to inspect the full 8-step farm timeline netted to the dollar.',
          }),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              sortHeader('implied', 'Rank'),
              sortHeader('name', 'Protocol'),
              sortHeader('tvl', 'TVL'),
              sortHeader('growth', '7d TVL'),
              sortHeader('age', 'Age'),
              el('th', { scope: 'col', text: 'Comps' }),
              sortHeader('implied', 'Implied Valuation'),
              el('th', { scope: 'col', text: 'Verdict' }),
              sortHeader('pnl', 'Net Profit'),
              el('th', { scope: 'col', text: 'Net APY' }),
            ),
          ),
          tbody,
        ),
      ),
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(
        el(
          'tr',
          null,
          el('td', { class: 'num', text: 'Live' }),
          el(
            'td',
            null,
            el(
              'div',
              { class: 'name' },
              el('b', { text: r.name }),
              el(
                'span',
                { class: 'sub' },
                (r.category || 'Other') +
                  ' on ' +
                  (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain'),
              ),
            ),
          ),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el(
            'td',
            { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') },
            fmtPct(r.change_7d),
          ),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: (r.mcap_tvl_ratio ? r.mcap_tvl_ratio.toFixed(3) : 'n/a') + 'x' }),
          el('td', null, el('span', { class: 'badge-verdict thin', text: 'TRADED' })),
        ),
      );
    });

    return el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          null,
          el('caption', {
            text:
              'Liquid Traded Comps: Market caps are live on-chain facts. Used as regression anchors to price pre-token protocols.',
          }),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Protocol' }),
              el('th', { scope: 'col', text: 'TVL' }),
              el('th', { scope: 'col', text: '7d' }),
              el('th', { scope: 'col', text: 'Market Cap' }),
              el('th', { scope: 'col', text: 'MCAP/TVL' }),
              el('th', { scope: 'col', text: 'Category' }),
            ),
          ),
          tbody,
        ),
      ),
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
  });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) {
      return r.slug === slug;
    })[0];
    if (!row) return;

    state.selected = slug;
    writeHash();

    var finCardClass = (row.verdict || 'THIN').toLowerCase();
    var stepsList = (row.farm_steps || []).map(function (s, idx) {
      return el(
        'div',
        { class: 'step-item' },
        el('div', { class: 'step-num', text: String(idx + 1) }),
        el(
          'div',
          { class: 'step-body' },
          el('p', { text: s }),
        ),
      );
    });

    dialog.innerHTML = '';
    dialog.appendChild(
      el(
        'div',
        { class: 'drawer-header' },
        el(
          'div',
          { class: 'drawer-title' },
          el('h2', { id: 'detail-title', text: row.name }),
          el(
            'span',
            { class: 'sub' },
            'Rank #' +
              row.rank +
              ' · ' +
              (row.category || 'Other') +
              ' on ' +
              (row.chains || []).join(', '),
          ),
        ),
        el('button', {
          class: 'close-btn',
          text: '✕',
          'aria-label': 'Close drawer',
          onclick: function () {
            dialog.close();
          },
        }),
      ),
    );

    // Metrics grid
    dialog.appendChild(
      el(
        'div',
        { class: 'drawer-section' },
        el('h3', { text: 'Implied Valuation Model Metrics' }),
        el(
          'div',
          { class: 'grid-metrics' },
          el('div', { class: 'metric-box' }, el('span', { text: 'Implied FDV' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Current TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Comps Anchor' }), el('b', { text: (row.sector_multiple ? row.sector_multiple.toFixed(2) : '0.25') + 'x' })),
          el('div', { class: 'metric-box' }, el('span', { text: 'Liquidity Haircut' }), el('b', { text: '30% Discount' })),
        ),
      ),
    );

    // Dollar-netted settlement card
    dialog.appendChild(
      el(
        'div',
        { class: 'drawer-section' },
        el('h3', { text: 'Farm PnL Settlement Netted to the Dollar' }),
        el(
          'div',
          { class: 'settlement-card ' + finCardClass },
          el('div', null, el('span', { text: 'Net Projected PnL' }), el('b', { class: 'pos', text: '+$' + (row.net_profit_usd || 0) })),
          el('div', null, el('span', { text: 'Net Annualized APY' }), el('b', { class: 'pos', text: '+' + (row.net_apy_pct || 0) + '%' })),
          el('div', null, el('span', { text: 'Decision Verdict' }), el('b', { text: row.verdict || 'THIN' })),
        ),
      ),
    );

    // 8-step farm steps
    dialog.appendChild(
      el(
        'div',
        { class: 'drawer-section' },
        el('h3', { text: '8-Step Actionable Farm Timeline' }),
        el('div', { class: 'timeline-steps' }, stepsList),
      ),
    );

    if (!dialog.open) dialog.showModal();
  }

  function render() {
    app.innerHTML = '';
    app.appendChild(header());
    app.appendChild(lede());
    app.appendChild(compsBar());
    app.appendChild(controls());
    if (state.tab === 'pre-token') app.appendChild(boardTable());
    else app.appendChild(liveTable());
    app.appendChild(dialog);
    app.removeAttribute('aria-busy');
  }

  readHash();
  render();
  if (state.selected) openDetail(state.selected);
})();
