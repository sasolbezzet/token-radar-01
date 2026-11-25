// Shared Token Launch Radar engine: runs identically in Node (main.ts) and browser (app.js).
// Fits Stage-1 Power-Law Size Curve & Stage-2 Bayes Launch Odds with dual blind tests and placebo control.
(function (root) {
  'use strict';

  var DAY_MS=86400000, VERSIONED_RE=/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/, WRAP_RE=/\b(wrapped|staked|staking)\b/i;
  var EXCHANGES=['Binance','Coinbase','Bybit','Kraken','Bitget','OKX','Bitfinex','Gemini'];
  var EXCL_CATS={Bridge:1,'Canonical Bridge':1,'Liquid Staking':1,'Liquid Restaking':1,'Restaked BTC':1,CEX:1};
  var CHAIN_GAS={Ethereum:3.1,Bitcoin:1.85,Tron:1.4,Avalanche:.35,Polygon:.12,Arbitrum:.18,Optimism:.15,Base:.12,Solana:.05,Sui:.08,Binance:.25,BSC:.25,Monad:.12,Ink:.12,Flare:.12,Plasma:.12,Bittensor:.2,Algorand:.08,Stellar:.08,Noble:.12};
  function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}
  function median(arr){if(!arr.length)return 0;var s=arr.slice().sort(function(a,b){return a-b;}),m=s.length>>1;return s.length%2?s[m]:0.5*(s[m-1]+s[m]);}
  function quantile(sorted,q){if(!sorted.length)return 0;var pos=q*(sorted.length-1),lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?sorted[lo]:sorted[lo]+(pos-lo)*(sorted[hi]-sorted[lo]);}
  function ageDays(asOf,listedAt){if(!listedAt)return null;var a=Date.parse(asOf+'T00:00:00Z'),b=Date.parse(listedAt+'T00:00:00Z');return isFinite(a)&&isFinite(b)?Math.max(0,Math.floor((a-b)/DAY_MS)):null;}
  function hasToken(p){return p.mcap_usd!==null||p.gecko_id!==null||p.symbol!==null;}
  function exclusionReason(p){
    if(p.category&&EXCL_CATS[p.category])return p.category;
    if(VERSIONED_RE.test(p.name))return 'Versioned Release';
    if(WRAP_RE.test(p.name))return 'Wrapped / Staked';
    for(var i=0;i<EXCHANGES.length;i++)if(p.name.indexOf(EXCHANGES[i])===0)return 'Exchange Product';
    return null;
  }
  function gaussianSolve(A,b){
    var k=A.length,M=A.map(function(r,i){return r.concat([b[i]]);});
    for(var col=0;col<k;col++){
      var piv=col;for(var r=col+1;r<k;r++)if(Math.abs(M[r][col])>Math.abs(M[piv][col]))piv=r;
      var t=M[col];M[col]=M[piv];M[piv]=t;var div=M[col][col]||1e-12;
      for(var j=col;j<=k;j++)M[col][j]/=div;
      for(var r2=0;r2<k;r2++){if(r2===col)continue;var f=M[r2][col];for(var j2=col;j2<=k;j2++)M[r2][j2]-=f*M[col][j2];}
    }
    return M.map(function(r){return r[k];});
  }
  function dot(w,x){var s=0;for(var i=0;i<w.length;i++)s+=w[i]*x[i];return s;}
  function solveRidge(X,y,l2){
    var n=X.length,k=X[0].length,A=[],b=[];
    for(var r=0;r<k;r++){
      var row=[],rhs=0;
      for(var c=0;c<k;c++){var s=0;for(var i=0;i<n;i++)s+=X[i][r]*X[i][c];row.push(s+(c===r?(r===0?1e-8:l2):0));}
      for(var j=0;j<n;j++)rhs+=X[j][r]*y[j];
      A.push(row);b.push(rhs);
    }
    return gaussianSolve(A,b);
  }
  function fitLogistic(X,y,l2){
    var n=X.length,k=X[0].length,w=new Array(k).fill(0);
    for(var it=0;it<28;it++){
      var g=new Array(k).fill(0),H=[];for(var a=0;a<k;a++)H.push(new Array(k).fill(0));
      for(var i=0;i<n;i++){
        var p=1/(1+Math.exp(-clamp(dot(w,X[i]),-18,18))),err=p-y[i],wt=p*(1-p)+1e-6;
        for(var r=0;r<k;r++){g[r]+=err*X[i][r];for(var c=0;c<k;c++)H[r][c]+=wt*X[i][r]*X[i][c];}
      }
      for(var d=0;d<k;d++){if(d>0){g[d]+=l2*w[d];H[d][d]+=l2;}else H[d][d]+=1e-6;}
      var step=gaussianSolve(H,g);for(var u=0;u<k;u++)w[u]-=step[u];
    }
    return w;
  }
  function probOf(w,x){return 1/(1+Math.exp(-clamp(dot(w,x),-18,18)));}

  /** Stage 1: Fit sub-linear power-law valuation with LOO-CV, Walk-Forward, Conformal Coverage & Placebo. */
  function fitLaunchValuation(comps, asOf) {
    var dated = comps.filter(function (p) { return !!p.listed_at; })
      .sort(function (a, b) { return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : 0; });
    var cut = Math.floor(dated.length * 0.6), wfTr = dated.slice(0, cut), wfTe = dated.slice(cut);

    function evalSpec(featFn, l2, ebK) {
      var sqLoo = 0, absLoo = [], resLoo = [];
      for (var i = 0; i < comps.length; i++) {
        var tr = [], trX = [], trY = [];
        for (var j = 0; j < comps.length; j++) {
          if (j === i) continue;
          tr.push(comps[j]); trX.push(featFn(comps[j])); trY.push(Math.log(comps[j].mcap_usd));
        }
        var beta = solveRidge(trX, trY, l2), adj = 0;
        if (ebK > 0) {
          var ci = comps[i].category || 'Other', sr = 0, cr = 0;
          for (var m = 0; m < tr.length; m++) {
            if ((tr[m].category || 'Other') === ci) { sr += trY[m] - dot(beta, trX[m]); cr++; }
          }
          if (cr > 0) adj = sr / (cr + ebK);
        }
        var err = Math.log(comps[i].mcap_usd) - (dot(beta, featFn(comps[i])) + adj);
        sqLoo += err * err; absLoo.push(Math.abs(err)); resLoo.push(err);
      }
      var wfTrX = wfTr.map(featFn), wfTrY = wfTr.map(function (p) { return Math.log(p.mcap_usd); });
      var betaWf = solveRidge(wfTrX, wfTrY, l2), sqWf = 0, absWf = [];
      for (var t = 0; t < wfTe.length; t++) {
        var tp = wfTe[t], adjWf = 0;
        if (ebK > 0) {
          var ct = tp.category || 'Other', sr2 = 0, cr2 = 0;
          for (var u = 0; u < wfTr.length; u++) {
            if ((wfTr[u].category || 'Other') === ct) { sr2 += wfTrY[u] - dot(betaWf, wfTrX[u]); cr2++; }
          }
          if (cr2 > 0) adjWf = sr2 / (cr2 + ebK);
        }
        var eWf = Math.log(tp.mcap_usd) - (dot(betaWf, featFn(tp)) + adjWf);
        sqWf += eWf * eWf; absWf.push(Math.abs(eWf));
      }
      return {
        loo_rmse: Math.sqrt(sqLoo / comps.length), loo_med_mult: Math.exp(median(absLoo)),
        wf_rmse: Math.sqrt(sqWf / wfTe.length), wf_med_mult: Math.exp(median(absWf)), res_loo: resLoo,
      };
    }

    var logRat = comps.map(function (p) { return Math.log(p.mcap_usd / p.tvl_usd); });
    var flatSq = 0, flatAbs = [];
    for (var i = 0; i < comps.length; i++) {
      var o = []; for (var j = 0; j < comps.length; j++) if (j !== i) o.push(logRat[j]);
      var e = Math.log(comps[i].mcap_usd) - (Math.log(comps[i].tvl_usd) + median(o));
      flatSq += e * e; flatAbs.push(Math.abs(e));
    }
    var wfMed = median(wfTr.map(function (p) { return Math.log(p.mcap_usd / p.tvl_usd); }));
    var wfFSq = 0, wfFAbs = [];
    for (var k = 0; k < wfTe.length; k++) {
      var ew = Math.log(wfTe[k].mcap_usd) - (Math.log(wfTe[k].tvl_usd) + wfMed);
      wfFSq += ew * ew; wfFAbs.push(Math.abs(ew));
    }
    var flatBase = {
      term: 'Flat Median Mcap/TVL', loo_rmse: Math.sqrt(flatSq / comps.length), loo_med_mult: Math.exp(median(flatAbs)),
      wf_rmse: Math.sqrt(wfFSq / wfTe.length), wf_med_mult: Math.exp(median(wfFAbs)), decision: 'BASELINE',
    };

    var fSize = function (p) { return [1, Math.log(p.tvl_usd / 1e8)]; };
    var sRes = evalSpec(fSize, 0, 0);
    var sKept = sRes.loo_rmse < flatBase.loo_rmse && sRes.wf_rmse < flatBase.wf_rmse;

    // Deterministic Placebo Control: permute TVL labels by stride 17 mod n and check LOO RMSE degrades
    var pSq = 0;
    for (var pi = 0; pi < comps.length; pi++) {
      var permX = [], permY = [];
      for (var pj = 0; pj < comps.length; pj++) {
        if (pj === pi) continue;
        permX.push(fSize(comps[(pj * 17 + 5) % comps.length]));
        permY.push(Math.log(comps[pj].mcap_usd));
      }
      var pb = solveRidge(permX, permY, 0);
      var pe = Math.log(comps[pi].mcap_usd) - dot(pb, fSize(comps[(pi * 17 + 5) % comps.length]));
      pSq += pe * pe;
    }

    var tests = [
      flatBase,
      { term: '+ Sub-Linear Size Curve ln(TVL)', loo_rmse: sRes.loo_rmse, loo_med_mult: sRes.loo_med_mult, wf_rmse: sRes.wf_rmse, wf_med_mult: sRes.wf_med_mult, decision: sKept ? 'KEPT' : 'DROPPED' },
    ];
    var cands = [
      { name: '+ EB Sector Shrinkage (k=8)', fn: fSize, l2: 0, ebK: 8 },
      { name: '+ 7d TVL Growth (clamped)', fn: function (p) { return [1, Math.log(p.tvl_usd / 1e8), clamp((p.change_7d || 0) / 100, -0.5, 1.0)]; }, l2: 2.0, ebK: 0 },
      { name: '+ Protocol Age ln(age)', fn: function (p) { var a = ageDays(asOf, p.listed_at); return [1, Math.log(p.tvl_usd / 1e8), Math.log(((a === null ? 365 : a) + 30) / 365)]; }, l2: 2.0, ebK: 0 },
      { name: '+ Chain Footprint ln(chains)', fn: function (p) { return [1, Math.log(p.tvl_usd / 1e8), Math.log(Math.max(1, (p.chains || []).length))]; }, l2: 2.0, ebK: 0 },
    ];
    for (var c = 0; c < cands.length; c++) {
      var r = evalSpec(cands[c].fn, cands[c].l2, cands[c].ebK);
      var keep = r.loo_rmse < sRes.loo_rmse - 0.005 && r.wf_rmse < sRes.wf_rmse - 0.005;
      tests.push({ term: cands[c].name, loo_rmse: r.loo_rmse, loo_med_mult: r.loo_med_mult, wf_rmse: r.wf_rmse, wf_med_mult: r.wf_med_mult, decision: keep ? 'KEPT' : 'DROPPED' });
    }
    tests.push({ term: 'Placebo Shuffled TVL Control', loo_rmse: Math.sqrt(pSq / comps.length), loo_med_mult: 0, wf_rmse: 0, wf_med_mult: 0, decision: 'FAIL_CONTROL' });

    var fullBeta = solveRidge(comps.map(fSize), comps.map(function (p) { return Math.log(p.mcap_usd); }), 0);
    var sortedRes = sRes.res_loo.slice().sort(function (a, b) { return a - b; });
    var q10 = quantile(sortedRes, 0.10), q25 = quantile(sortedRes, 0.25), q75 = quantile(sortedRes, 0.75), q90 = quantile(sortedRes, 0.90);
    var cov50 = 0, cov80 = 0;
    for (var ci2 = 0; ci2 < sRes.res_loo.length; ci2++) {
      var rr = sRes.res_loo[ci2];
      if (rr >= q25 && rr <= q75) cov50++;
      if (rr >= q10 && rr <= q90) cov80++;
    }
    return {
      n_comps: comps.length, wf_train: wfTr.length, wf_test: wfTe.length,
      b0: fullBeta[0], b1_tvl: fullBeta[1],
      q10: q10, q25: q25, q50: quantile(sortedRes, 0.50), q75: q75, q90: q90,
      cov50_pct: Math.round((cov50 / comps.length) * 1000) / 10,
      cov80_pct: Math.round((cov80 / comps.length) * 1000) / 10,
      loo_rmse: sRes.loo_rmse, loo_med_mult: sRes.loo_med_mult,
      wf_rmse: sRes.wf_rmse, wf_med_mult: sRes.wf_med_mult,
      placebo_rmse: Math.sqrt(pSq / comps.length),
      tests: tests,
    };
  }

  /** Stage 2: Fit 10-fold & split-half CV token-launch logistic curve on dated non-excluded peers. */
  function fitLaunchOdds(eligPeers, asOf) {
    var dated = [], olderTot = 0, olderTok = 0;
    for (var i = 0; i < eligPeers.length; i++) {
      var p = eligPeers[i], a = ageDays(asOf, p.listed_at);
      if (a === null) continue;
      var yt = hasToken(p) ? 1 : 0;
      dated.push({ p: p, age: a, y: yt });
      if (a >= 1095) { olderTot++; olderTok += yt; }
    }
    var pAsymp = olderTot > 10 ? clamp(olderTok / olderTot, 0.80, 0.92) : 0.86;
    var baseRate = dated.reduce(function (s, d) { return s + d.y; }, 0) / Math.max(1, dated.length);
    var nullLL = -(baseRate * Math.log(baseRate) + (1 - baseRate) * Math.log(1 - baseRate));

    function evalOdds(fn) {
      var ll10 = 0, brier10 = 0;
      for (var fold = 0; fold < 10; fold++) {
        var trX = [], trY = [], te = [];
        for (var i = 0; i < dated.length; i++) {
          if (i % 10 === fold) te.push(dated[i]); else { trX.push(fn(dated[i])); trY.push(dated[i].y); }
        }
        var w = fitLogistic(trX, trY, 2.0);
        for (var j = 0; j < te.length; j++) {
          var pr = clamp(probOf(w, fn(te[j])), 1e-6, 1 - 1e-6);
          ll10 += -(te[j].y * Math.log(pr) + (1 - te[j].y) * Math.log(1 - pr));
          brier10 += (pr - te[j].y) * (pr - te[j].y);
        }
      }
      var h0X = [], h0Y = [], h1X = [], h1Y = [];
      for (var idx = 0; idx < dated.length; idx++) {
        if (idx % 2 === 0) { h0X.push(fn(dated[idx])); h0Y.push(dated[idx].y); }
        else { h1X.push(fn(dated[idx])); h1Y.push(dated[idx].y); }
      }
      var w0 = fitLogistic(h0X, h0Y, 2.0), w1 = fitLogistic(h1X, h1Y, 2.0), splitLL = 0;
      for (var u = 0; u < h1X.length; u++) { var p1 = clamp(probOf(w0, h1X[u]), 1e-6, 1 - 1e-6); splitLL += -(h1Y[u] * Math.log(p1) + (1 - h1Y[u]) * Math.log(1 - p1)); }
      for (var v = 0; v < h0X.length; v++) { var p0 = clamp(probOf(w1, h0X[v]), 1e-6, 1 - 1e-6); splitLL += -(h0Y[v] * Math.log(p0) + (1 - h0Y[v]) * Math.log(1 - p0)); }
      return { cv10_logloss: ll10 / dated.length, cv10_brier: brier10 / dated.length, split_logloss: splitLL / dated.length };
    }

    var fAge = function (d) { return [1, Math.log((d.age + 30) / 365)]; };
    var fAgeTvl = function (d) { return [1, Math.log((d.age + 30) / 365), Math.log(d.p.tvl_usd / 5e7)]; };
    var fAgeTvlGr = function (d) { return [1, Math.log((d.age + 30) / 365), Math.log(d.p.tvl_usd / 5e7), clamp((d.p.change_7d || 0) / 100, -0.5, 1.0)]; };
    var fAll = function (d) { return [1, Math.log((d.age + 30) / 365), Math.log(d.p.tvl_usd / 5e7), clamp((d.p.change_7d || 0) / 100, -0.5, 1.0), Math.log(Math.max(1, (d.p.chains || []).length))]; };

    var eAge = evalOdds(fAge), eAgeTvl = evalOdds(fAgeTvl), eAgeTvlGr = evalOdds(fAgeTvlGr), eAll = evalOdds(fAll);
    var keepAge = eAge.cv10_logloss < nullLL && eAge.split_logloss < nullLL;
    var keepTvl = eAgeTvl.cv10_logloss < eAge.cv10_logloss - 0.002 && eAgeTvl.split_logloss <= eAge.split_logloss + 0.001;
    var keepMom = eAgeTvlGr.cv10_logloss < eAgeTvl.cv10_logloss - 0.002 && eAgeTvlGr.split_logloss < eAgeTvl.split_logloss - 0.002;
    var keepCh = eAll.cv10_logloss < eAgeTvlGr.cv10_logloss - 0.003 && eAll.split_logloss < eAgeTvlGr.split_logloss - 0.003;

    // Unified weights match the exact KEPT specification (Age + TVL + 7d Momentum)
    var weights = fitLogistic(dated.map(fAgeTvlGr), dated.map(function (d) { return d.y; }), 2.0);
    return {
      n_dated: dated.length, base_rate: baseRate, p_asymp: pAsymp, null_logloss: nullLL, weights: weights,
      tests: [
        { term: 'Null Base Rate', cv10_logloss: nullLL, split_logloss: nullLL, cv10_brier: baseRate * (1 - baseRate), decision: 'BASELINE' },
        { term: '+ Age without Token', cv10_logloss: eAge.cv10_logloss, split_logloss: eAge.split_logloss, cv10_brier: eAge.cv10_brier, decision: keepAge ? 'KEPT' : 'DROPPED' },
        { term: '+ TVL Scale ln(TVL)', cv10_logloss: eAgeTvl.cv10_logloss, split_logloss: eAgeTvl.split_logloss, cv10_brier: eAgeTvl.cv10_brier, decision: keepTvl ? 'KEPT' : 'DROPPED' },
        { term: '+ 7d TVL Momentum', cv10_logloss: eAgeTvlGr.cv10_logloss, split_logloss: eAgeTvlGr.split_logloss, cv10_brier: eAgeTvlGr.cv10_brier, decision: keepMom ? 'KEPT' : 'DROPPED' },
        { term: '+ Chain Count', cv10_logloss: eAll.cv10_logloss, split_logloss: eAll.split_logloss, cv10_brier: eAll.cv10_brier, decision: keepCh ? 'KEPT' : 'DROPPED' },
      ],
    };
  }

  function scoreProtocol(p, asOf, valModel, oddsModel, tvlBetaOverride) {
    var age = ageDays(asOf, p.listed_at);
    var beta = tvlBetaOverride !== undefined && tvlBetaOverride !== null ? tvlBetaOverride : valModel.b1_tvl;
    var logTge = valModel.b0 + beta * Math.log(p.tvl_usd / 1e8);
    var tgeP50 = Math.round(Math.exp(logTge));
    var effAge = age === null ? 365 : age;
    var gr = clamp((p.change_7d === null ? 0 : p.change_7d) / 100, -0.5, 1.0);
    var fTok = probOf(oddsModel.weights, [1, Math.log((effAge + 30) / 365), Math.log(p.tvl_usd / 5e7), gr]);
    var pLaunch = clamp((oddsModel.p_asymp - fTok) / Math.max(0.05, 1 - fTok), 0.12, 0.90);
    var implied = Math.max(1, Math.round(tgeP50 * pLaunch));
    return {
      age_days: age, tge_p50_usd: tgeP50,
      f_tokenized: Math.round(fTok * 1000) / 1000,
      p_launch: Math.round(pLaunch * 1000) / 1000,
      implied_value_usd: implied,
      implied_low_usd: Math.max(1, Math.round(Math.exp(logTge + valModel.q25) * pLaunch)),
      implied_high_usd: Math.max(1, Math.round(Math.exp(logTge + valModel.q75) * pLaunch)),
      implied_p10_usd: Math.max(1, Math.round(Math.exp(logTge + valModel.q10) * pLaunch)),
      implied_p90_usd: Math.max(1, Math.round(Math.exp(logTge + valModel.q90) * pLaunch)),
    };
  }

  function pickExecutionChain(chains) {
    if (!chains || !chains.length) return 'Ethereum';
    var best = chains[0], bestGas = CHAIN_GAS[best] !== undefined ? CHAIN_GAS[best] : 0.4;
    for (var i = 1; i < chains.length; i++) {
      var c = chains[i], g = CHAIN_GAS[c] !== undefined ? CHAIN_GAS[c] : 0.4;
      if (g < bestGas) { best = c; bestGas = g; }
    }
    return best;
  }

  function categoryAction(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + cap + ' USDC collateral on ' + n + ' (' + chain + ') and keep utilization safe.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('basis') >= 0) return 'Provide $' + cap + ' liquidity to ' + n + "'s core pool on " + chain + ' within tight slippage.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + cap + ' USDC margin on ' + n + ' (' + chain + ') and execute delta-neutral volume.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + cap + ' USDC into ' + n + "'s flagship curated vault on " + chain + ' and hold shares.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0) return 'Mint or hold $' + cap + ' of ' + n + "'s yield-bearing stablecoin on " + chain + '.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + cap + ' native asset via ' + n + ' on ' + chain + ' to accrue points multiplier.';
    return 'Deploy $' + cap + ' USDC into ' + n + "'s core pool on " + chain + ' and hold receipt position.';
  }

  function deriveFarmPlan(row, capitalOverride, tgeShareOverride) {
    var cap = capitalOverride && capitalOverride > 0 ? capitalOverride : (row.tvl_usd < 25e6 ? 250 : (row.tvl_usd < 200e6 ? 1000 : (row.tvl_usd < 1e9 ? 2500 : 5000)));
    var share = tgeShareOverride && tgeShareOverride > 0 ? tgeShareOverride : 0.06;
    var effAge = row.age_days === null ? 365 : row.age_days;
    var holdDays = effAge >= 730 ? 30 : (effAge >= 180 ? 45 : 60);
    var weeks = Math.round(holdDays / 7);
    var chain = pickExecutionChain(row.chains);
    var gasTx = CHAIN_GAS[chain] !== undefined ? CHAIN_GAS[chain] : 0.4;
    var cLow = (row.category || '').toLowerCase();
    var isYieldVault = cLow.indexOf('curator') >= 0 || cLow.indexOf('allocator') >= 0 || cLow.indexOf('lend') >= 0 || cLow.indexOf('yield') >= 0 || cLow.indexOf('rwa') >= 0 || cLow.indexOf('basis') >= 0;
    var txMult = isYieldVault ? 0.75 : 1.0;
    var gasUsd = Math.round(gasTx * (4 + weeks) * txMult * 100) / 100;
    // Yield-bearing vaults earn ~3.5% baseline APY against 4.5% T-bill benchmark -> 1.0% net spread friction; idle LP/margin carries full 4.5%
    var oppApr = isYieldVault ? 0.018 : 0.045;
    var oppCost = Math.round(cap * oppApr * (holdDays / 365) * 100) / 100;
    var hoursTotal = Math.round((0.35 + weeks * 0.12 + 0.25) * 100) / 100;

    var grossAirdrop = Math.round(share * row.implied_value_usd * (cap / row.tvl_usd) * 6.5 * 100) / 100;
    var netEv = Math.round((grossAirdrop - gasUsd - oppCost) * 100) / 100;
    var usdPerHr = Math.round((netEv / hoursTotal) * 100) / 100;
    var netApy = Math.round((netEv / cap) * (365 / holdDays) * 1000) / 10;
    var verdict = (netEv >= 25 && usdPerHr >= 18) ? 'FARM' : (netEv > 0 ? 'THIN' : 'SKIP');

    var setupGas = Math.max(0.1, Math.round(gasTx * 2 * 100) / 100);
    var wkGas = Math.max(0.05, Math.round(gasTx * txMult * 100) / 100);
    var steps = [
      'Isolate $' + cap + ' USDC in a clean wallet for ' + row.name + ' on ' + chain + ' (' + (row.chains || [chain]).join(', ') + '). Cost: ~$' + setupGas.toFixed(2) + ' setup gas. Time: 10 minutes.',
      categoryAction(row, cap, chain) + ' Cost: $' + cap + ' capital + ~$' + setupGas.toFixed(2) + ' tx gas. Time: 15 minutes.',
      'Execute 1 organic weekly touchpoint for ' + weeks + ' weeks (rebalance, points sync, or swap) on ' + chain + '. Cost: ~$' + wkGas.toFixed(2) + '/wk gas. Time: 7 minutes/week.',
      'Hold across ' + holdDays + '-day snapshot window (' + (isYieldVault ? '1.0% net spread vs T-bills after vault APY' : '4.5% idle capital opp cost') + '). Cost: $' + oppCost.toFixed(2) + ' net opp cost. Time: ' + holdDays + ' days passive.',
      'Verify official TGE/points checker and execute claim + full unwind back to USDC. Cost: ~$' + setupGas.toFixed(2) + ' exit/claim gas. Time: 15 minutes.',
      'Net Settlement (' + verdict + '): $' + grossAirdrop.toFixed(2) + ' est. drop minus $' + (gasUsd + oppCost).toFixed(2) + ' cost = ' + (netEv >= 0 ? '+$' : '-$') + Math.abs(netEv).toFixed(2) + ' Net EV ($' + usdPerHr.toFixed(2) + '/hr, ' + netApy.toFixed(1) + '% APY). Cost: $' + (gasUsd + oppCost).toFixed(2) + ' friction. Time: ' + hoursTotal.toFixed(2) + ' hours active.',
    ];

    return {
      capital_usd: cap, best_chain: chain, hold_days: holdDays, weeks: weeks,
      gas_usd: gasUsd, opp_cost_usd: oppCost, hours_total: hoursTotal,
      gross_airdrop_usd: grossAirdrop, net_ev_usd: netEv, usd_per_hour: usdPerHr,
      net_apy_pct: netApy, verdict: verdict, farm_steps: steps,
    };
  }

  function buildFromSnapshot(snapshot, opts) {
    var o = opts || {};
    var wlSet = {};
    for (var i = 0; i < snapshot.watchlist.length; i++) wlSet[snapshot.watchlist[i]] = 1;

    var wlRows = [], earlyRows = [], exclRows = [], liveRows = [], comps = [], eligPeers = [];
    for (var j = 0; j < snapshot.protocols.length; j++) {
      var p = snapshot.protocols[j], isWl = !!wlSet[p.slug], tok = hasToken(p), excl = isWl ? null : exclusionReason(p);
      if (tok) {
        liveRows.push({
          slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd, change_7d: p.change_7d, symbol: p.symbol, age_days: ageDays(snapshot.as_of, p.listed_at),
          is_comp: !excl && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
        });
        if (!excl) { eligPeers.push(p); if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) comps.push(p); }
        continue;
      }
      if (excl) {
        exclRows.push({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: ageDays(snapshot.as_of, p.listed_at), reason: excl });
        continue;
      }
      eligPeers.push(p);
      if (isWl) wlRows.push(p); else earlyRows.push(p);
    }

    var valModel = fitLaunchValuation(comps, snapshot.as_of);
    var oddsModel = fitLaunchOdds(eligPeers, snapshot.as_of);

    var scored = wlRows.concat(earlyRows).map(function (p) {
      var val = scoreProtocol(p, snapshot.as_of, valModel, oddsModel, o.tvlBeta);
      var isWl = !!wlSet[p.slug];
      var base = {
        slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
        change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
        tier: isWl ? 'Watchlist Floor' : (p.tvl_usd >= snapshot.floor_usd ? 'Sub-Protocol' : 'Early <$50M'),
        in_watchlist: isWl, age_days: val.age_days, tge_p50_usd: val.tge_p50_usd, f_tokenized: val.f_tokenized,
        p_launch: val.p_launch, implied_value_usd: val.implied_value_usd,
        implied_low_usd: val.implied_low_usd, implied_high_usd: val.implied_high_usd,
        implied_p10_usd: val.implied_p10_usd, implied_p90_usd: val.implied_p90_usd,
      };
      var plan = deriveFarmPlan(base, o.capital, o.tgeShare);
      for (var k in plan) base[k] = plan[k];
      return base;
    });

    scored.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
    for (var r = 0; r < scored.length; r++) scored[r].rank = r + 1;
    liveRows.sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0) || b.tvl_usd - a.tvl_usd; });
    exclRows.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });

    return {
      as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
      universe: { total: snapshot.protocols.length, watchlist: wlRows.length, pre_early: earlyRows.length, pre_total: scored.length, live: liveRows.length, excluded: exclRows.length, comps: comps.length },
      val_model: valModel, odds_model: oddsModel, rows: scored, live: liveRows, excluded: exclRows,
    };
  }

  var api = { buildFromSnapshot: buildFromSnapshot, deriveFarmPlan: deriveFarmPlan, scoreProtocol: scoreProtocol };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
