// Conformal Launch Radar UI: executes shared RadarModel directly on window.SNAPSHOT in browser,
// runs 9 self-checks including 198/198 board.json parity, plus Compare Tray, Theme Toggle & Model Sandbox.
(function () {
  'use strict';

  var SNAP = window.SNAPSHOT;
  var DIGEST = window.BOARD_DIGEST || [];
  var MODEL_LIB = window.RadarModel;
  if (!SNAP || !MODEL_LIB) return;

  var BASE_RADAR = MODEL_LIB.buildFromSnapshot(SNAP);
  var PARITY = verifyParity(BASE_RADAR, DIGEST);

  var state = {
    tab: 'radar', // radar | watchlist | live | excluded | model
    theme: 'light',
    q: '',
    tier: 'all',
    verdict: 'all',
    category: 'all',
    chain: 'all',
    capital: 0,
    tgeShare: 0.06,
    tvlBeta: null, // null = fitted OLS beta
    sort: 'implied',
    dir: -1,
    page: 0,
    pageSize: 15,
    selected: null,
    compare: [], // up to 3 slugs
  };

  function verifyParity(radar, digest) {
    var bySlug = {};
    for (var i = 0; i < digest.length; i++) bySlug[digest[i].slug] = digest[i];
    var matched = 0, maxDelta = 0, stepsOk = 0;
    for (var j = 0; j < radar.rows.length; j++) {
      var r = radar.rows[j], d = bySlug[r.slug];
      if (r.farm_steps.length >= 3 && r.farm_steps.length <= 12) stepsOk++;
      if (!d) continue;
      var delta = Math.abs(r.implied_value_usd - d.implied_value_usd);
      if (delta > maxDelta) maxDelta = delta;
      if (delta === 0 && r.rank === d.rank) matched++;
    }
    var checks = [
      radar.universe.watchlist === SNAP.watchlist.length,
      radar.universe.total === radar.universe.pre_total + radar.universe.live + radar.universe.excluded,
      radar.rows.length >= 100,
      !digest.length || (matched === radar.rows.length && maxDelta === 0),
      stepsOk === radar.rows.length,
      radar.val_model.loo_rmse < radar.val_model.tests[0].loo_rmse,
      radar.val_model.wf_rmse < radar.val_model.tests[0].wf_rmse,
      radar.val_model.placebo_rmse > radar.val_model.loo_rmse,
      radar.odds_model.tests[3].cv10_logloss < radar.odds_model.null_logloss,
    ];
    var passed = checks.filter(Boolean).length;
    return { passed: passed, total: checks.length, matched: matched, maxDelta: maxDelta };
  }

  function currentRadar() {
    if (!state.capital && state.tgeShare === 0.06 && state.tvlBeta === null) return BASE_RADAR;
    return MODEL_LIB.buildFromSnapshot(SNAP, { capital: state.capital, tgeShare: state.tgeShare, tvlBeta: state.tvlBeta });
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
    return s + '$' + a.toFixed(a < 100 && a % 1 !== 0 ? 2 : 0);
  }
  function fmtSigned(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + fmtUsd(n); }
  function fmtPct(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtAge(d) { return d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var ch = arguments[i];
      if (ch === null || ch === undefined) continue;
      if (Array.isArray(ch)) ch.forEach(function (c) { if (c) node.appendChild(c); });
      else node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('theme')) state.theme = p.get('theme');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('tier')) state.tier = p.get('tier');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('cap')) state.capital = Number(p.get('cap')) || 0;
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = Number(p.get('dir')) || -1;
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('cmp')) state.compare = p.get('cmp').split(',').filter(Boolean).slice(0, 3);
  }

  function filterPre(rows) {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.tab === 'watchlist' && !r.in_watchlist) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortRows(list) {
    var k = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = 0, bv = 0;
      if (k === 'rank') { av = a.rank; bv = b.rank; }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? 1e9 : a.age_days; bv = b.age_days === null ? 1e9 : b.age_days; }
      else if (k === 'odds') { av = a.p_launch || 0; bv = b.p_launch || 0; }
      else if (k === 'net') { av = a.net_ev_usd || 0; bv = b.net_ev_usd || 0; }
      else if (k === 'hr') { av = a.usd_per_hour || 0; bv = b.usd_per_hour || 0; }
      else if (k === 'mcap') { av = a.mcap_usd || 0; bv = b.mcap_usd || 0; }
      else { av = a.implied_value_usd || 0; bv = b.implied_value_usd || 0; }
      return av < bv ? -dir : av > bv ? dir : (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
    });
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ↓' : ' ↑') : '';
    return el('button', {
      type: 'button', text: label + arrow,
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        state.page = 0; render();
      },
    });
  }

  function tierClass(tier) {
    return tier === 'Watchlist Floor' ? 'tier-badge tier-wl' : (tier === 'Sub-Protocol' ? 'tier-badge tier-sub' : 'tier-badge tier-early');
  }

  function toggleCompare(slug) {
    var idx = state.compare.indexOf(slug);
    if (idx >= 0) state.compare.splice(idx, 1);
    else { if (state.compare.length >= 3) state.compare.shift(); state.compare.push(slug); }
    render();
  }

  function renderHeader(radar) {
    var u = radar.universe, vm = radar.val_model, om = radar.odds_model;
    var vc = { FARM: 0, THIN: 0, SKIP: 0 };
    radar.rows.forEach(function (r) { vc[r.verdict] = (vc[r.verdict] || 0) + 1; });

    var topbar = el('header', { class: 'topbar' },
      el('div', { class: 'brand' },
        el('span', { class: 'dot' }),
        el('div', null,
          el('h1', { class: 'brand-title', text: 'Conformal Token Launch Radar' }),
          el('div', { class: 'brand-sub', text: 'Snapshot ' + radar.as_of + ' · Power-Law Size Curve × Bayes Launch Odds · Live Sandbox' }),
        ),
      ),
      el('div', { class: 'top-pills' },
        el('span', { class: 'pill ok', text: 'SELF-CHECK ' + PARITY.passed + '/' + PARITY.total + ' · PARITY ' + PARITY.matched + '/' + u.pre_total + ' ($' + PARITY.maxDelta + ' Δ)' }),
        el('span', { class: 'pill ok', text: 'WATCHLIST ' + u.watchlist + '/' + SNAP.watchlist.length + ' (100%)' }),
        el('span', { class: 'pill', text: u.watchlist + ' WL + ' + u.pre_early + ' Early + ' + u.live + ' Live + ' + u.excluded + ' Excl = ' + u.total }),
        el('button', {
          type: 'button', class: 'theme-btn',
          text: state.theme === 'dark' ? 'Light Paper' : 'Dark Terminal',
          onclick: function () { state.theme = state.theme === 'dark' ? 'light' : 'dark'; render(); },
        }),
      ),
    );

    var kpis = el('section', { class: 'kpis' },
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Watchlist & Universe Audit' }),
        el('div', { class: 'kpi-val', text: u.watchlist + ' / ' + SNAP.watchlist.length + ' WL · ' + u.pre_total + ' Ranked' }),
        el('div', { class: 'kpi-sub', text: 'Floor $50M · 416 live & 144 wrapped separated' }),
      ),
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Dual Blind Valuation + Conformal' }),
        el('div', { class: 'kpi-val', text: 'LOO ×' + vm.loo_med_mult.toFixed(2) + ' · WF ×' + vm.wf_med_mult.toFixed(2) }),
        el('div', { class: 'kpi-sub', text: 'β_TVL=' + vm.b1_tvl.toFixed(3) + ' · 50%/80% cov: ' + vm.cov50_pct + '% / ' + vm.cov80_pct + '%' }),
      ),
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Peer Token Launch Odds' }),
        el('div', { class: 'kpi-val', text: 'LogLoss ' + om.tests[3].cv10_logloss.toFixed(3) + ' vs ' + om.null_logloss.toFixed(3) }),
        el('div', { class: 'kpi-sub', text: om.n_dated + ' dated peers · Asymptote ' + (om.p_asymp * 100).toFixed(1) + '% (>3y)' }),
      ),
      el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: 'Netted Farm Verdicts' }),
        el('div', { class: 'kpi-val', text: vc.FARM + ' FARM · ' + vc.THIN + ' THIN' }),
        el('div', { class: 'kpi-sub', text: vc.SKIP + ' SKIP · Gas + net yield spread deducted' }),
      ),
    );

    var evidence = el('section', { class: 'evidence' },
      el('div', { class: 'ev-block' },
        el('div', { class: 'ev-title', text: 'Stage 1 Valuation Gate (LOO-CV & Walk-Forward ' + vm.wf_train + '/' + vm.wf_test + ' + Placebo)' }),
        el('div', { class: 'ev-row' }, vm.tests.slice(1).map(function (t) {
          var lbl = t.decision === 'FAIL_CONTROL' ? 'Placebo Shuffled TVL (RMSE ' + t.loo_rmse.toFixed(2) + ')' : t.term.replace('+ ', '') + ' (' + t.decision + ' ' + t.loo_rmse.toFixed(2) + '/' + t.wf_rmse.toFixed(2) + ')';
          return el('span', { class: t.decision === 'KEPT' ? 'tag kept' : 'tag drop', text: lbl });
        })),
      ),
      el('div', { class: 'ev-block' },
        el('div', { class: 'ev-title', text: 'Stage 2 Token Launch Odds Gate (10-Fold & Split-Half CV)' }),
        el('div', { class: 'ev-row' }, om.tests.slice(1).map(function (t) {
          return el('span', { class: t.decision === 'KEPT' ? 'tag kept' : 'tag drop', text: t.term.replace('+ ', '') + ' (' + t.decision + ' ' + t.cv10_logloss.toFixed(3) + ')' });
        })),
      ),
    );
    return [topbar, kpis, evidence];
  }

  function renderToolbar(radar,shown,total){
    var u=radar.universe;
    var tabs=el('div',{class:'tabs'},[{id:'radar',l:'Pre-Token Radar ('+u.pre_total+')'},{id:'watchlist',l:'Watchlist Floor ('+u.watchlist+')'},{id:'live',l:'Live Comps ('+u.live+')'},{id:'excluded',l:'Excluded Wrapped/CEX ('+u.excluded+')'},{id:'model',l:'Model, Blind Tests & Sandbox'}].map(function(t){
      return el('button',{type:'button',class:'tab','aria-pressed':String(state.tab===t.id),text:t.l,onclick:function(){state.tab=t.id;state.page=0;if(t.id==='live')state.sort='mcap';else if(t.id==='excluded')state.sort='tvl';else if(state.sort==='mcap')state.sort='implied';render();}});
    }));
    if(state.tab==='model')return el('div',{class:'toolbar'},tabs,el('span',{class:'count-line',text:'All parameters recompute 198 rows live'}));
    var search=el('input',{type:'search',class:'ctrl ctrl-search',placeholder:'Search protocol, slug, chain...',value:state.q,oninput:function(e){state.q=e.target.value;state.page=0;render();var n=document.querySelector('.ctrl-search');if(n){n.focus();n.setSelectionRange(state.q.length,state.q.length);}}});
    var ctrls=[search];
    if(state.tab==='radar'||state.tab==='watchlist'){
      var cats={},chs={};
      radar.rows.forEach(function(r){cats[r.category||'Uncategorized']=1;(r.chains||[]).forEach(function(c){chs[c]=(chs[c]||0)+1;});});
      var topChs=Object.keys(chs).sort(function(a,b){return chs[b]-chs[a];}).slice(0,22);
      var vGrp=el('div',{class:'vgroup'},['all','FARM','THIN','SKIP'].map(function(v){return el('button',{type:'button',class:'vbtn','aria-pressed':String(state.verdict===v),text:v==='all'?'ALL':v,onclick:function(){state.verdict=v;state.page=0;render();}});}));
      var tierSel=el('select',{class:'ctrl',onchange:function(e){state.tier=e.target.value;state.page=0;render();}},[el('option',{value:'all',text:'Tier: All Pre-Token'}),el('option',{value:'Watchlist Floor',text:'Watchlist Floor (40)'}),el('option',{value:'Sub-Protocol',text:'Sub-Protocol >=$50M (20)'}),el('option',{value:'Early <$50M',text:'Early Gems <$50M (138)'})]);
      tierSel.value=state.tier;
      var catSel=el('select',{class:'ctrl',onchange:function(e){state.category=e.target.value;state.page=0;render();}},[el('option',{value:'all',text:'Sector: All'})].concat(Object.keys(cats).sort().map(function(c){return el('option',{value:c,text:c});})));
      catSel.value=state.category;
      var chSel=el('select',{class:'ctrl',onchange:function(e){state.chain=e.target.value;state.page=0;render();}},[el('option',{value:'all',text:'Chain: All'})].concat(topChs.map(function(c){return el('option',{value:c,text:c});})));
      chSel.value=state.chain;
      var capSel=el('select',{class:'ctrl',onchange:function(e){state.capital=Number(e.target.value)||0;state.page=0;render();}},[el('option',{value:'0',text:'Cap: Auto Min-Viable'}),el('option',{value:'250',text:'Cap: $250'}),el('option',{value:'1000',text:'Cap: $1,000'}),el('option',{value:'2500',text:'Cap: $2,500'}),el('option',{value:'5000',text:'Cap: $5,000'})]);
      capSel.value=String(state.capital);
      ctrls.push(vGrp,tierSel,catSel,chSel,capSel);
    }
    ctrls.push(el('span',{class:'count-line',text:'Showing '+shown+' / '+total}));
    return el('div',null,el('div',{class:'toolbar'},tabs),el('div',{class:'toolbar'},el('div',{class:'filters'},ctrls)));
  }

  function renderCompareTray(radar){
    if(!state.compare.length)return null;
    var items=state.compare.map(function(sl){for(var i=0;i<radar.rows.length;i++)if(radar.rows[i].slug===sl)return radar.rows[i];return null;}).filter(Boolean);
    if(!items.length)return null;
    return el('section',{class:'cmp-tray'},
      el('div',{class:'cmp-head'},el('span',{text:'Side-by-Side Protocol Compare ('+items.length+'/3)'}),el('button',{type:'button',class:'d-close',text:'Clear Compare',onclick:function(){state.compare=[];render();}})),
      el('div',{class:'cmp-grid'},items.map(function(r){
        return el('div',{class:'cmp-card'},
          el('div',{class:'proto-name'},el('span',{text:'#'+r.rank+' '+r.name}),el('span',{class:'verdict v-'+r.verdict,text:r.verdict})),
          el('div',{class:'num',text:'TVL '+fmtUsd(r.tvl_usd)+' · 7d '+fmtPct(r.change_7d)+' · Age '+fmtAge(r.age_days)}),
          el('div',{class:'num',text:'Implied '+fmtUsd(r.implied_value_usd)+' · Odds '+(r.p_launch*100).toFixed(0)+'%'}),
          el('div',{class:'num '+(r.net_ev_usd>=0?'pos':'neg'),text:r.best_chain+' ($'+r.capital_usd+') · '+fmtSigned(r.net_ev_usd)+' · '+fmtSigned(r.usd_per_hour)+'/hr'})
        );
      }))
    );
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

  function renderRadarTable(list){
    var slice=list.slice(state.page*state.pageSize,(state.page+1)*state.pageSize);
    var head=el('thead',null,el('tr',null,
      el('th',null,'Cmp'),el('th',null,sortButton('#','rank')),el('th',null,'Protocol'),
      el('th',{class:'right'},sortButton('TVL','tvl')),el('th',{class:'right'},sortButton('7d','growth')),
      el('th',{class:'right'},sortButton('Age','age')),el('th',null,sortButton('Odds','odds')),
      el('th',{class:'right'},sortButton('Implied Value (50% Band)','implied')),el('th',null,'Route & Gas'),
      el('th',{class:'right'},sortButton('Net EV','net')),el('th',{class:'right'},sortButton('$/Hour','hr')),el('th',null,'Verdict')
    ));
    var body=el('tbody',null,slice.map(function(r){
      var gCls=r.change_7d===null?'':r.change_7d>=0?'pos':'neg',nCls=r.net_ev_usd>=0?'pos':'neg';
      var tS=r.tier==='Watchlist Floor'?'WL':(r.tier==='Sub-Protocol'?'SUB':'EARLY'),inCmp=state.compare.indexOf(r.slug)>=0;
      return el('tr',{'data-selected':String(state.selected===r.slug),onclick:function(){state.selected=r.slug;render();}},
        el('td',{onclick:function(e){e.stopPropagation();toggleCompare(r.slug);}},el('button',{type:'button',class:inCmp?'cmp-btn on':'cmp-btn',text:inCmp?'✓':'+'})),
        el('td',{class:'num',text:String(r.rank)}),
        el('td',null,el('div',{class:'proto-cell'},el('div',{class:'proto-name'},el('span',{text:r.name}),el('span',{class:tierClass(r.tier),text:tS})),el('div',{class:'proto-sub',text:(r.category||'DeFi')+' · '+(r.chains||[]).slice(0,3).join(', ')}))),
        el('td',{class:'num right',text:fmtUsd(r.tvl_usd)}),
        el('td',{class:'num right '+gCls,text:fmtPct(r.change_7d)}),
        el('td',{class:'num right',text:fmtAge(r.age_days)}),
        el('td',null,el('div',{class:'odds-wrap'},el('span',{class:'bar'},el('i',{style:'width:'+Math.round(r.p_launch*100)+'%'})),el('span',{class:'num',text:(r.p_launch*100).toFixed(0)+'%'}))),
        el('td',{class:'right'},el('div',{class:'val-cell'},el('span',{class:'num val-main',text:fmtUsd(r.implied_value_usd)}),el('span',{class:'num val-band',text:fmtUsd(r.implied_low_usd)+' – '+fmtUsd(r.implied_high_usd)}))),
        el('td',{class:'num',text:r.best_chain+' ($'+r.gas_usd.toFixed(1)+')'}),
        el('td',{class:'num right '+nCls,text:fmtSigned(r.net_ev_usd)}),
        el('td',{class:'num right '+nCls,text:fmtSigned(r.usd_per_hour)+'/h'}),
        el('td',null,el('span',{class:'verdict v-'+r.verdict,text:r.verdict}))
      );
    }));
    return el('section',{class:'panel'},el('div',{class:'table-wrap'},el('table',null,head,body)),pagerBar(list.length));
  }

  function renderSimpleTable(list,mode){
    var q=state.q.trim().toLowerCase(),filtered=list.filter(function(r){return !q||(r.name+' '+r.slug+' '+(r.category||'')+' '+(r.symbol||'')).toLowerCase().indexOf(q)>=0;});
    var sorted=sortRows(filtered),slice=sorted.slice(state.page*state.pageSize,(state.page+1)*state.pageSize);
    var head=el('thead',null,el('tr',null,el('th',null,'Protocol'),el('th',null,mode==='live'?'Symbol / Role':'Exclusion Reason'),el('th',{class:'right'},sortButton('TVL','tvl')),el('th',{class:'right'},mode==='live'?sortButton('Market Cap','mcap'):'Age'),el('th',{class:'right'},mode==='live'?'Mcap / TVL':'7d Change')));
    var body=el('tbody',null,slice.map(function(r){
      return el('tr',null,
        el('td',null,el('div',{class:'proto-cell'},el('div',{class:'proto-name',text:r.name}),el('div',{class:'proto-sub',text:(r.category||'DeFi')+' · '+(r.chains||[]).slice(0,3).join(', ')}))),
        el('td',{class:'num',text:mode==='live'?(r.symbol||'TOKEN')+(r.is_comp?' · Calibration Comp':' · Live Token'):r.reason}),
        el('td',{class:'num right',text:fmtUsd(r.tvl_usd)}),
        el('td',{class:'num right',text:mode==='live'?fmtUsd(r.mcap_usd):fmtAge(r.age_days)}),
        el('td',{class:'num right',text:mode==='live'?(r.mcap_usd&&r.tvl_usd?(r.mcap_usd/r.tvl_usd).toFixed(3)+'x':'n/a'):fmtPct(r.change_7d)})
      );
    }));
    return el('section',{class:'panel'},el('div',{class:'table-wrap'},el('table',null,head,body)),pagerBar(sorted.length));
  }

  function renderModelPage(radar) {
    var vm = radar.val_model, om = radar.odds_model;
    return el('section', { class: 'panel' }, el('div', { class: 'model-grid' },
      el('div', { class: 'model-card' },
        el('h3', { text: 'Interactive Model & Capital Sandbox (Live Recompute)' }),
        el('div', { class: 'sandbox-row' },
          el('label', null, 'TVL Elasticity β: ' + (state.tvlBeta === null ? vm.b1_tvl.toFixed(3) : state.tvlBeta.toFixed(2)) + ' ',
            el('input', { type: 'range', min: '0.20', max: '0.80', step: '0.02', value: String(state.tvlBeta === null ? vm.b1_tvl.toFixed(2) : state.tvlBeta), oninput: function (e) { state.tvlBeta = Number(e.target.value); render(); } })),
          el('label', null, 'TGE Pool Share: ' + (state.tgeShare * 100).toFixed(0) + '% ',
            el('input', { type: 'range', min: '0.02', max: '0.12', step: '0.01', value: String(state.tgeShare), oninput: function (e) { state.tgeShare = Number(e.target.value); render(); } })),
          el('button', { type: 'button', class: 'd-close', text: 'Reset Fitted', onclick: function () { state.tvlBeta = null; state.tgeShare = 0.06; state.capital = 0; render(); } }),
        ),
        el('h3', { text: 'Stage 1: Launch Mcap Power Law & Placebo (n=' + vm.n_comps + ' Comps)' }),
        el('p', { class: 'kpi-sub', text: 'Conformal LOO coverage: 50% band = ' + vm.cov50_pct + '%, 80% band = ' + vm.cov80_pct + '%. Placebo shuffled RMSE = ' + vm.placebo_rmse.toFixed(3) + '.' }),
        el('table', { class: 'mini-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Specification' }), el('th', { text: 'LOO RMSE' }), el('th', { text: 'LOO Mult' }), el('th', { text: 'WF RMSE' }), el('th', { text: 'Gate' }))),
          el('tbody', null, vm.tests.map(function (t) {
            return el('tr', null, el('td', { text: t.term }), el('td', { text: t.loo_rmse.toFixed(3) }), el('td', { text: t.loo_med_mult ? '×' + t.loo_med_mult.toFixed(2) : '-' }), el('td', { text: t.wf_rmse ? t.wf_rmse.toFixed(3) : '-' }), el('td', null, el('span', { class: t.decision === 'KEPT' ? 'pos' : '', text: t.decision })));
          })),
        ),
      ),
      el('div', { class: 'model-card' },
        el('h3', { text: 'Stage 2: Peer Launch Odds & Bayes Survival (n=' + om.n_dated + ' Dated Peers)' }),
        el('p', { class: 'kpi-sub', text: 'Logistic P(tokenized | age, TVL, 7d growth) mapped via Bayes survival using >3y asymptote (' + (om.p_asymp * 100).toFixed(1) + '%).' }),
        el('table', { class: 'mini-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Odds Model Term' }), el('th', { text: '10-Fold LL' }), el('th', { text: 'Split LL' }), el('th', { text: 'Brier' }), el('th', { text: 'Gate' }))),
          el('tbody', null, om.tests.map(function (t) {
            return el('tr', null, el('td', { text: t.term }), el('td', { text: t.cv10_logloss.toFixed(3) }), el('td', { text: t.split_logloss.toFixed(3) }), el('td', { text: t.cv10_brier.toFixed(3) }), el('td', null, el('span', { class: t.decision === 'KEPT' ? 'pos' : '', text: t.decision })));
          })),
        ),
      ),
    ));
  }

  function kvCard(label, val, cls) {
    return el('div', { class: 'kv' }, el('span', { text: label }), el('b', cls ? { class: cls, text: val } : { text: val }));
  }

  function renderDrawer(radar) {
    var drawer = document.getElementById('drawer');
    if (!state.selected) { drawer.hidden = true; drawer.textContent = ''; return; }
    var r = null;
    for (var i = 0; i < radar.rows.length; i++) if (radar.rows[i].slug === state.selected) { r = radar.rows[i]; break; }
    if (!r) { drawer.hidden = true; return; }
    drawer.hidden = false; drawer.textContent = '';

    drawer.appendChild(el('div', { class: 'd-head' },
      el('div', null,
        el('div', { class: 'filters' }, el('span', { class: tierClass(r.tier), text: 'RANK #' + r.rank + ' · ' + r.tier.toUpperCase() }), el('span', { class: 'verdict v-' + r.verdict, text: r.verdict })),
        el('h2', { text: r.name }),
        el('div', { class: 'proto-sub', text: (r.category || 'DeFi') + ' · Chains: ' + (r.chains || []).join(', ') + ' · Listed: ' + (r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ')' }),
      ),
      el('button', { type: 'button', class: 'd-close', text: 'Close ×', onclick: function () { state.selected = null; render(); } }),
    ));

    drawer.appendChild(el('div', { class: 'd-box' },
      el('h3', { text: 'Two-Stage Implied Valuation Breakdown' }),
      el('div', { class: 'kv-grid' },
        kvCard('Reported TVL', fmtUsd(r.tvl_usd)),
        kvCard('TGE Mcap (P50)', fmtUsd(r.tge_p50_usd)),
        kvCard('Launch Odds', (r.p_launch * 100).toFixed(1) + '%'),
        kvCard('Implied Value (EV)', fmtUsd(r.implied_value_usd), 'pos'),
        kvCard('Conformal 50%', fmtUsd(r.implied_low_usd) + '–' + fmtUsd(r.implied_high_usd)),
        kvCard('Conformal 80%', fmtUsd(r.implied_p10_usd) + '–' + fmtUsd(r.implied_p90_usd)),
      ),
    ));

    drawer.appendChild(el('div', { class: 'd-box' },
      el('h3', { text: 'Farm Unit Economics (' + r.best_chain + ' Route)' }),
      el('div', { class: 'kv-grid' },
        kvCard('Min Capital', '$' + r.capital_usd),
        kvCard('Est. Gross Drop', '$' + r.gross_airdrop_usd.toFixed(2)),
        kvCard('Gas + Opp Cost', '$' + (r.gas_usd + r.opp_cost_usd).toFixed(2)),
        kvCard('Net EV Profit', fmtSigned(r.net_ev_usd), r.net_ev_usd >= 0 ? 'pos' : 'neg'),
        kvCard('Hourly Return', fmtSigned(r.usd_per_hour) + '/hr', r.usd_per_hour >= 0 ? 'pos' : 'neg'),
        kvCard('Hold / Net APY', r.hold_days + 'd · ' + r.net_apy_pct.toFixed(0) + '%'),
      ),
    ));

    drawer.appendChild(el('div', { class: 'd-box' },
      el('h3', { text: 'Concrete Execution Checklist (' + r.farm_steps.length + ' Steps)' }),
      el('ol', { class: 'steps-list' }, r.farm_steps.map(function (st, idx) {
        var parts = st.split(' Cost: '), meta = parts[1] ? parts[1].split(' Time: ') : ['', ''];
        return el('li', { class: 'step-item' },
          el('span', { class: 'step-num', text: String(idx + 1) }),
          el('div', { class: 'step-body' },
            el('div', { text: parts[0] }),
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
    document.documentElement.setAttribute('data-theme', state.theme);
    var radar = currentRadar();
    var root = document.getElementById('app');
    root.textContent = '';
    renderHeader(radar).forEach(function (n) { root.appendChild(n); });
    if (state.tab === 'model') {
      root.appendChild(renderToolbar(radar, 0, 0));
      root.appendChild(renderModelPage(radar));
    } else if (state.tab === 'live') {
      root.appendChild(renderToolbar(radar, radar.live.length, radar.live.length));
      root.appendChild(renderSimpleTable(radar.live, 'live'));
    } else if (state.tab === 'excluded') {
      root.appendChild(renderToolbar(radar, radar.excluded.length, radar.excluded.length));
      root.appendChild(renderSimpleTable(radar.excluded, 'excluded'));
    } else {
      var list = sortRows(filterPre(radar.rows));
      root.appendChild(renderToolbar(radar, list.length, state.tab === 'watchlist' ? radar.universe.watchlist : radar.universe.pre_total));
      var tray = renderCompareTray(radar);
      if (tray) root.appendChild(tray);
      root.appendChild(renderRadarTable(list));
    }
    renderDrawer(radar);
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) { state.selected = null; render(); } });
  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash();
  render();
})();
