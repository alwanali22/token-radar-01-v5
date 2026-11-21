const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const DATA = window.RADAR;
const M = window.TokenRadarModel;
const state = { q:'', category:'all', chain:'all', watchlistOnly:false, verdict:'all', sort:'rank', tab:'board', dir:1 };

function compactFmt(n) {
  if (n === null || n === undefined) return 'n/a';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return '$' + Math.round(n);
}

function fmtPct(n) {
  if (n === null || n === undefined) return 'n/a';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtOdds(n) {
  if (n === null || n === undefined) return 'n/a';
  return n.toFixed(2);
}

function renderStats() {
  const counts = DATA.counts;
  document.getElementById('stats').textContent = counts.total + ' protocols, ' + counts.watchlist + ' watchlist, ' + DATA.rows.length + ' board rows, ' + counts.early + ' early, ' + counts.live + ' live, ' + counts.excluded + ' excluded.';
}

function renderKpis() {
  const el = document.getElementById('kpis');
  if (!el) return;
  const model = DATA.model;
  if (!model || !model.backtest) { el.innerHTML = ''; return; }
  const backtest = model.backtest;
  const verdictCounts = model.verdictCounts || {};
  const wf = backtest.value.walkForward[0];
  const bestNet = DATA.rows.slice().sort(function (a, b) { return b.net_usd - a.net_usd; })[0];
  const cards = [
    { label: 'Walk-forward miss', value: wf.miss.toFixed(2) + 'x', sub: 'flat ' + wf.missFlat.toFixed(2) + 'x' },
    { label: 'Odds Brier', value: backtest.odds.cvBrier.toFixed(3), sub: 'base ' + backtest.odds.baseBrier.toFixed(3) },
    { label: 'Range holds', value: wf.holdsPct.toFixed(1) + '%', sub: 'P25–P75, newer listings' },
    { label: 'Best farm net', value: (bestNet.net_usd >= 0 ? '+' : '') + '$' + bestNet.net_usd.toFixed(2), sub: bestNet.name + ' · ' + bestNet.verdict + ' · $1,000 / 90 days' },
    { label: 'Watchlist', value: '40 / 40', sub: 'covered on the board' }
  ];
  el.innerHTML = cards.map(function (c) {
    return '<div class="kpi"><div class="kpi-label">' + esc(c.label) + '</div><div class="kpi-value">' + esc(c.value) + '</div><div class="kpi-sub">' + esc(c.sub) + '</div></div>';
  }).join('');
}

function renderLedger() {
  const el = document.getElementById('ledger-body');
  if (!el) return;
  const ledger = DATA.model && DATA.model.ledger;
  if (!ledger) { el.innerHTML = ''; return; }
  const setAside = ledger.setAside || [];
  let z = 0;
  setAside.forEach(function (r) { z += r.count; });
  let html = '<p>Ranked on the board: ' + ledger.ranked + '. Tokens that already trade: ' + ledger.tokenTrades + '. Set aside (not protocols awaiting a launch): ' + z + '.</p>';
  html += '<table><thead><tr><th>reason</th><th>count</th></tr></thead><tbody>';
  setAside.forEach(function (r) {
    html += '<tr><td>' + esc(r.reason) + '</td><td>' + r.count + '</td></tr>';
  });
  html += '<tr><td>Total accounted</td><td>' + (ledger.ranked + ledger.tokenTrades + z) + ' of 758</td></tr>';
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderScatter() {
  const el = document.getElementById('scatter-body');
  if (!el) return;
  const liveAll = DATA.liveAll;
  const model = DATA.model;
  if (!liveAll || !model || !model.curve) { el.innerHTML = ''; return; }
  const pts = liveAll.filter(function (p) {
    return p.tvl_usd > 0 && p.mcap_usd > 0;
  });
  if (!pts.length) { el.innerHTML = ''; return; }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(function (p) {
    const lx = Math.log10(p.tvl_usd);
    const ly = Math.log10(p.mcap_usd);
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
  });
  minX -= 0.1; maxX += 0.1; minY -= 0.1; maxY += 0.1;
  const xPx = function (lx) { return 50 + (lx - minX) / (maxX - minX) * 560; };
  const yPx = function (ly) { return 330 - (ly - minY) / (maxY - minY) * 280; };
  const tickLabel = function (v) {
    if (v >= 1e9) return '$' + (v / 1e9) + 'B';
    return '$' + (v / 1e6) + 'M';
  };
  const xticks = [];
  for (let p = Math.ceil(minX); p <= Math.floor(maxX); p++) xticks.push(p);
  const yticks = [];
  for (let p = Math.ceil(minY); p <= Math.floor(maxY); p++) yticks.push(p);

  let svg = '<svg width="640" height="380" viewBox="0 0 640 380">';
  xticks.forEach(function (p) {
    const x = xPx(p);
    svg += '<line x1="' + x + '" y1="50" x2="' + x + '" y2="330" stroke="#2a2f3a" stroke-width="1"/>';
    svg += '<text x="' + x + '" y="350" fill="#8a93a6" font-size="11" text-anchor="middle">' + esc(tickLabel(Math.pow(10, p))) + '</text>';
  });
  yticks.forEach(function (p) {
    const y = yPx(p);
    svg += '<line x1="50" y1="' + y + '" x2="610" y2="' + y + '" stroke="#4a5263" stroke-width="1"/>';
    svg += '<text x="42" y="' + (y + 4) + '" fill="#8a93a6" font-size="11" text-anchor="end">' + esc(tickLabel(Math.pow(10, p))) + '</text>';
  });
  svg += '<line x1="50" y1="330" x2="610" y2="330" stroke="#4a5263" stroke-width="1"/>';
  svg += '<line x1="50" y1="50" x2="50" y2="330" stroke="#4a5263" stroke-width="1"/>';
  const poly = [];
  for (let i = 0; i < 40; i++) {
    const lx = minX + (maxX - minX) * (i / 39);
    const tvl = Math.pow(10, lx);
    const mcap = tvl * M.sizeMultiple(tvl, model.curve);
    if (!(mcap > 0)) continue;
    poly.push(xPx(lx) + ',' + yPx(Math.log10(mcap)));
  }
  if (poly.length > 1) {
    svg += '<polyline points="' + poly.join(' ') + '" stroke="#ffb300" stroke-width="2" fill="none"/>';
  }
  pts.forEach(function (p) {
    const cx = xPx(Math.log10(p.tvl_usd));
    const cy = yPx(Math.log10(p.mcap_usd));
    svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3" fill="#4fc3f7"/>';
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

function populateSelects() {
  const catSel = document.getElementById('category');
  const chainSel = document.getElementById('chain');
  const cats = {};
  const chains = {};
  DATA.rows.forEach(function (r) {
    if (r.category !== null && r.category !== undefined) cats[r.category] = true;
    if (r.chains) r.chains.forEach(function (c) { chains[c] = true; });
  });
  const catList = Object.keys(cats).sort();
  const chainList = Object.keys(chains).sort();
  if (catSel) {
    catSel.innerHTML = '<option value="all">All</option>' + catList.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
  }
  if (chainSel) {
    chainSel.innerHTML = '<option value="all">All</option>' + chainList.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
  }
}

function renderTable() {
  const sortMap = { rank:'rank', implied:'implied_value_usd', odds:'odds', tvl:'tvl_usd', '7d':'change_7d', age:'age_days', name:'name', category:'category', chain:'chains', range:'range_lo', verdict:'verdict' };
  let rows;
  const isBoard = state.tab === 'board';
  const note = document.getElementById('live-note');
  if (note) note.style.display = isBoard ? 'none' : '';

  const head = document.getElementById('thead-row') || document.querySelector('thead tr');
  if (isBoard) {
    rows = DATA.rows.slice();
    const q = state.q.toLowerCase();
    rows = rows.filter(function (r) {
      if (q && !(String(r.name).toLowerCase().indexOf(q) !== -1 || String(r.slug).toLowerCase().indexOf(q) !== -1)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!(r.chains || []).includes(state.chain))) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      return true;
    });
    const key = sortMap[state.sort] || 'rank';
    const dir = state.dir;
    rows.sort(function (a, b) {
      const av = a[key];
      const bv = b[key];
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (key === 'name' || key === 'category' || key === 'verdict') {
        return String(av).localeCompare(String(bv)) * dir;
      }
      if (key === 'chains') {
        return String((av || []).join(',')).localeCompare(String((bv || []).join(','))) * dir;
      }
      if (key === 'rank') {
        return (av - bv) * dir;
      }
      return (bv - av) * dir;
    });
  } else {
    rows = (DATA.live || []).slice();
    rows.sort(function (a, b) {
      const av = a.mcap_usd;
      const bv = b.mcap_usd;
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return bv - av;
    });
  }

  if (head) {
    const ths = isBoard
      ? [['Rank','rank'],['Protocol','name'],['Category','category'],['Chains','chain'],['TVL','tvl'],['7d %','7d'],['Age (days)','age'],['Odds','odds'],['Implied value','implied'],['P25–P75 range','range'],['Verdict','verdict']]
      : [['Protocol','name'],['Category','category'],['Chains','chain'],['TVL','tvl'],['Market cap','mcap']];
    head.innerHTML = ths.map(function (t) {
      return '<th data-sort="' + t[1] + '">' + esc(t[0]) + '</th>';
    }).join('');
  }

  const body = document.getElementById('table-body') || document.querySelector('tbody');
  if (!body) return;
  body.innerHTML = rows.map(function (r) {
    if (isBoard) {
      const chainStr = (r.chains || []).length > 2
        ? r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2)
        : (r.chains || []).join(', ');
      return '<tr class="' + (r.watchlist ? 'watchlist-row' : '') + '" onclick="openDialog(\'' + esc(r.slug) + '\')">' +
        '<td>' + esc(r.rank) + '</td>' +
        '<td>' + esc(r.name) + (r.watchlist ? ' ★' : '') + '</td>' +
        '<td>' + (r.category !== null && r.category !== undefined ? esc(r.category) : 'N/A') + '</td>' +
        '<td>' + esc(chainStr) + '</td>' +
        '<td>' + esc(compactFmt(r.tvl_usd)) + '</td>' +
        '<td>' + esc(fmtPct(r.change_7d)) + '</td>' +
        '<td>' + (r.age_days !== null && r.age_days !== undefined ? esc(r.age_days) : 'N/A') + '</td>' +
        '<td>' + esc(fmtOdds(r.odds)) + '</td>' +
        '<td>' + esc(compactFmt(r.implied_value_usd)) + '</td>' +
        '<td>' + esc(compactFmt(r.range_lo)) + '–' + esc(compactFmt(r.range_hi)) + '</td>' +
        '<td><span class="verdict verdict-' + esc(r.verdict) + '">' + esc(r.verdict) + '</span></td>' +
        '</tr>';
    }
    return '<tr>' +
      '<td>' + esc(r.name) + '</td>' +
      '<td>' + (r.category !== null && r.category !== undefined ? esc(r.category) : 'N/A') + '</td>' +
      '<td>' + esc((r.chains || []).join(', ')) + '</td>' +
      '<td>' + esc(compactFmt(r.tvl_usd)) + '</td>' +
      '<td>' + esc(compactFmt(r.mcap_usd)) + '</td>' +
      '</tr>';
  }).join('');
}

(function ensureLiveNote() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  if (document.getElementById('live-note')) return;
  const p = document.createElement('p');
  p.id = 'live-note';
  p.textContent = 'already trades — market cap is a fact, not a model';
  tabs.insertAdjacentElement('afterend', p);
})();

renderStats();
renderKpis();
renderLedger();
renderScatter();
populateSelects();
renderTable();

function recomputeRow(row) {
  const curve = DATA.model.curve;
  const age = row.age_days;
  const mult = M.sizeMultiple(row.tvl_usd, curve);
  const growth = M.growthMultiplier(row.change_7d);
  const mat = M.maturityMultiplier(age);
  const value = Math.max(1, row.tvl_usd * mult * growth * mat);
  const features = [
    Math.log1p(age === null ? DATA.model.odds.medianAge : age),
    row.category === 'Dexs' ? 1 : 0,
    row.category === 'Lending' ? 1 : 0,
    ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge'].indexOf(row.category) >= 0 ? 1 : 0,
    ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'].indexOf(row.category) >= 0 ? 1 : 0,
    row.category === 'CEX' ? 1 : 0,
    age === null ? 1 : 0
  ];
  const om = DATA.model.odds;
  let z = om.bias;
  for (let j = 0; j < features.length; j += 1) {
    z += om.weights[j] * (features[j] - om.means[j]) / om.sds[j];
  }
  let odds = 1 / (1 + Math.exp(-z));
  odds = Math.min(0.999, Math.max(0.001, odds));
  const implied = Math.max(1, Math.round(value * odds * 0.75));
  return { value: value, odds: odds, implied: implied, mult: mult, growth: growth, mat: mat };
}

function openDialog(slug) {
  const row = DATA.rows.find(function (r) { return r.slug === slug; });
  if (!row) return;
  const dialog = document.getElementById('detail-dialog');
  const rec = recomputeRow(row);
  const econ = M.farmEconomics(row, row.implied_value_usd);
  let content = '<h2>' + esc(row.name) + '</h2>' +
    '<p>Rank ' + esc(row.rank) + ' · ' + esc(row.category || 'N/A') + ' · ' + esc((row.chains || []).join(', ')) + (row.watchlist ? ' · ★ watchlist' : '') + '</p>' +
    '<p>TVL: ' + esc(compactFmt(row.tvl_usd)) + '</p>' +
    '<p>sizeMultiple: ' + rec.mult.toFixed(4) + ' (size-fitted multiple from TVL)</p>' +
    '<p>growthMult: ' + rec.growth.toFixed(4) + ' (change_7d ' + (row.change_7d === null ? 'n/a' : row.change_7d + '%') + ')</p>' +
    '<p>maturityMult: ' + rec.mat.toFixed(4) + ' (age ' + (row.age_days === null ? 'n/a' : row.age_days + ' days') + ')</p>' +
    '<p>Launch odds: ' + fmtOdds(row.odds) + ' (stored) / ' + fmtOdds(rec.odds) + ' (recomputed)</p>' +
    '<p>Value if launches: ' + esc(compactFmt(row.value_if_launches)) + ' (stored) / ' + esc(compactFmt(Math.round(rec.value))) + ' (recomputed)</p>' +
    '<p>Implied value (stored): ' + esc(compactFmt(row.implied_value_usd)) + '</p>' +
    '<p>Implied value (recomputed): ' + esc(compactFmt(rec.implied)) + '</p>' +
    '<p>Stored and recomputed agree: ' + (rec.implied === row.implied_value_usd ? 'yes — the page and the board use the same model' : 'no — see the two values above') + '</p>' +
    '<p>P25–P75 range: ' + esc(compactFmt(row.range_lo)) + ' – ' + esc(compactFmt(row.range_hi)) + '</p>' +
    '<h3>Farm economics ($1,000, 90 days)</h3>' +
    '<p>Verdict: <span class="verdict verdict-' + esc(row.verdict) + '">' + esc(row.verdict) + '</span> · gas ' + esc('$' + econ.gasUsd.toFixed(2)) + ' · expected reward ' + esc('$' + econ.rewardUsd.toFixed(2)) + ' · T-bill cost ' + esc('$' + econ.opportunityUsd.toFixed(2)) + '</p>' +
    '<p>Net: ' + esc('$' + row.net_usd.toFixed(2)) + ' · net/hour: ' + esc('$' + row.net_per_hour.toFixed(2)) + '</p>' +
    '<h3>What-if sandbox</h3>' +
    '<p><label>Deposit $ <input id="wi-deposit" type="number" min="100" max="10000" step="100" value="1000"></label> <label>Farmer share <select id="wi-share"><option value="0.01">1%</option><option value="0.05">5%</option><option value="0.10" selected>10%</option><option value="0.15">15%</option><option value="0.20">20%</option></select></label> <label>Horizon <select id="wi-horizon"><option value="30">30 days</option><option value="60">60 days</option><option value="90" selected>90 days</option></select></label> <label>T-bill <select id="wi-tbill"><option value="0.03">3%</option><option value="0.04">4%</option><option value="0.045" selected>4.5%</option><option value="0.05">5%</option><option value="0.06">6%</option></select></label></p>' +
    '<p id="wi-result"></p>' +
    '<h3>Farm steps</h3>' +
    '<ul>' + row.farm_steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') + '</ul>' +
    '<p><em>Records no token</em></p>';
  document.getElementById('dialog-content').innerHTML = content;
  function updateWhatIf() {
    const depositUsd = parseFloat(document.getElementById('wi-deposit').value) || 1000;
    const dropShare = parseFloat(document.getElementById('wi-share').value) || 0.10;
    const horizonDays = parseInt(document.getElementById('wi-horizon').value, 10) || 90;
    const tbillRate = parseFloat(document.getElementById('wi-tbill').value) || 0.045;
    const w = M.whatIfFarm(row, row.implied_value_usd, {
      depositUsd: depositUsd,
      dropShare: dropShare,
      horizonDays: horizonDays,
      tbillRate: tbillRate
    });
    document.getElementById('wi-result').innerHTML =
      'Net: $' + w.netUsd.toFixed(2) +
      ' · net/hour: $' + w.netPerHour.toFixed(2) +
      ' · verdict: <span class="verdict verdict-' + esc(w.verdict) + '">' + esc(w.verdict) + '</span>';
  }
  ['wi-deposit', 'wi-share', 'wi-horizon', 'wi-tbill'].forEach(function (id) {
    const el = document.getElementById(id);
    el.addEventListener('input', updateWhatIf);
    el.addEventListener('change', updateWhatIf);
  });
  updateWhatIf();
  if (!dialog.open) dialog.showModal();
  history.replaceState(null, '', '#p=' + slug);
}

function renderModelPanel() {
  let pageCurve = null;
  let pageBacktest = null;
  if (Array.isArray(DATA.liveAll) && DATA.liveAll.length > 0) {
    pageCurve = M.fitSizeCurve(DATA.liveAll);
    pageBacktest = M.backtest(DATA.liveAll, DATA.model.as_of);
  }
  const curve = DATA.model.curve;
  const bt = DATA.model.backtest;
  let html = '<p>Formula: ' + esc(DATA.model.formula) + '</p>' +
    '<p>Fitted curve (stored): intercept ' + curve.intercept.toFixed(4) + ', slope ' + curve.slope.toFixed(4) + ', n ' + curve.n + '.</p>';
  if (pageCurve) {
    html += '<p>Page-fitted curve (fitted live on this page from ' + pageCurve.n + ' live tokens): intercept ' + pageCurve.intercept.toFixed(4) + ', slope ' + pageCurve.slope.toFixed(4) + '.</p>' +
      '<p>Page fit matches the stored curve: ' + (Math.abs(pageCurve.intercept - curve.intercept) < 1e-9 && Math.abs(pageCurve.slope - curve.slope) < 1e-9 ? 'yes' : 'no — see the two curves above') + '</p>';
  }
  if (pageBacktest && pageBacktest.curve !== null) {
    html += '<p>Backtest, recomputed live on this page (5-fold CV, size-only — this page\'s live list carries no listed dates or 7-day changes, so growth and maturity are 1 here; ' + pageBacktest.n + ' live tokens): median miss ' + pageBacktest.curve.toFixed(2) + 'x, vs a flat median multiple ' + pageBacktest.flat.toFixed(2) + 'x.</p>';
  }
  if (bt) {
    html += '<p>Walk-forward (entry program, full snapshot): ' +
      bt.value.walkForward.map(function (w) {
        return 'fit before ' + w.cutoff + ' → miss ' + w.miss.toFixed(2) + 'x vs flat ' + w.missFlat.toFixed(2) + 'x, range holds ' + w.holdsPct.toFixed(1) + '% (' + w.train + ' train / ' + w.test + ' test)';
      }).join('; ') + '.</p>' +
      '<p>Leave-one-out: ' + bt.value.looCurve.toFixed(2) + 'x vs flat ' + bt.value.looFlat.toFixed(2) + 'x.</p>' +
      '<p>Odds (entry program): 5-fold CV Brier ' + bt.odds.cvBrier.toFixed(4) + ', 80/20 holdout Brier ' + bt.odds.holdoutBrier.toFixed(4) + ', base-rate Brier ' + bt.odds.baseBrier.toFixed(4) + '; ablation — drop age ' + bt.odds.ablations.dropAge.toFixed(4) + ', drop category flags ' + bt.odds.ablations.dropCatFlags.toFixed(4) + ', drop listed-date flag ' + bt.odds.ablations.dropListedNull.toFixed(4) + '.</p>' +
      '<p>Bootstrap slope (200 refits): P25 ' + bt.bootstrap.p25.toFixed(4) + ', P75 ' + bt.bootstrap.p75.toFixed(4) + '.</p>';
  }
  html += '<p>Example size multiples:</p><ul>' +
    [['$10M', 10000000], ['$100M', 100000000], ['$1B', 1000000000], ['$10B', 10000000000]].map(function (e) {
      return '<li>' + e[0] + ' TVL: ' + M.sizeMultiple(e[1], curve).toFixed(4) + '</li>';
    }).join('') + '</ul>';
  html += '<p>Snapshot frozen 2026-11-14. The curve and the 5-fold backtest above are recomputed live on this page from the 128 live tokens; the walk-forward, odds and bootstrap numbers are the entry program\'s measurements on the full snapshot. Multiples and odds are comparables, not predictions; no protocol name is hardcoded into the model.</p>';
  document.getElementById('model-panel-body').innerHTML = html;
}

document.getElementById('q').addEventListener('input', function (e) {
  state.q = e.target.value;
  renderTable();
});
document.getElementById('category').addEventListener('change', function (e) {
  state.category = e.target.value;
  renderTable();
  history.replaceState(null, '', '#category=' + state.category);
});
document.getElementById('chain').addEventListener('change', function (e) {
  state.chain = e.target.value;
  renderTable();
  history.replaceState(null, '', '#chain=' + state.chain);
});
document.getElementById('watchlist-only').addEventListener('change', function (e) {
  state.watchlistOnly = e.target.checked;
  renderTable();
});
document.getElementById('verdict').addEventListener('change', function (e) {
  state.verdict = e.target.value;
  renderTable();
});
document.getElementById('sort').addEventListener('change', function (e) {
  state.sort = e.target.value;
  renderTable();
});
document.querySelector('#board-table thead').addEventListener('click', function (e) {
  const th = e.target.closest('th[data-sort]');
  if (!th || state.tab !== 'board') return;
  const k = th.getAttribute('data-sort');
  if (state.sort === k) {
    state.dir = state.dir === 1 ? -1 : 1;
  } else {
    state.sort = k;
    state.dir = 1;
  }
  renderTable();
});
document.getElementById('tab-board').addEventListener('click', function () {
  state.tab = 'board';
  document.getElementById('tab-board').classList.add('active');
  document.getElementById('tab-live').classList.remove('active');
  renderTable();
});
document.getElementById('tab-live').addEventListener('click', function () {
  state.tab = 'live';
  document.getElementById('tab-live').classList.add('active');
  document.getElementById('tab-board').classList.remove('active');
  renderTable();
});
document.getElementById('close-dialog').addEventListener('click', function () {
  document.getElementById('detail-dialog').close();
});

function handleHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.has('p')) openDialog(params.get('p'));
  if (params.has('category')) {
    state.category = params.get('category');
    document.getElementById('category').value = state.category;
  }
  if (params.has('q')) {
    state.q = params.get('q');
    document.getElementById('q').value = state.q;
  }
  if (params.has('chain')) {
    state.chain = params.get('chain');
    document.getElementById('chain').value = state.chain;
  }
  renderTable();
}

function fnv1a(text) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ('0000000' + hash.toString(16)).slice(-8);
}

function renderBadges() {
  var el = document.getElementById('badges');
  if (!el) return;
  var rows = DATA.rows;
  var ranksOk = rows.every(function (r, i) { return r.rank === i + 1; });
  var orderOk = true;
  for (var i = 0; i < rows.length - 1; i++) {
    if (rows[i].implied_value_usd < rows[i + 1].implied_value_usd) { orderOk = false; break; }
  }
  var ledger = DATA.model.ledger;
  var ledgerOk = ledger.ranked + ledger.tokenTrades + ledger.setAside.reduce(function (s, r) { return s + r.count; }, 0) === DATA.counts.total;
  var watchOk = rows.filter(function (r) { return r.watchlist; }).length === 40;
  var agree = 0;
  rows.forEach(function (r) { if (recomputeRow(r).implied === r.implied_value_usd) agree++; });
  var recomputeOk = agree === rows.length;
  var checksumOk = DATA.model.checksum === fnv1a(JSON.stringify(rows));
  var pageCurve = M.fitSizeCurve(DATA.liveAll);
  var curveOk = Math.abs(pageCurve.intercept - DATA.model.curve.intercept) < 1e-9 && Math.abs(pageCurve.slope - DATA.model.curve.slope) < 1e-9;
  var badges = [
    { label: 'ranks 1–' + rows.length + ' in order', ok: ranksOk },
    { label: 'implied values never rise', ok: orderOk },
    { label: 'ledger ' + DATA.counts.total + ' of ' + DATA.counts.total, ok: ledgerOk },
    { label: 'watchlist 40 / 40', ok: watchOk },
    { label: 'recompute ' + agree + '/' + rows.length, ok: recomputeOk },
    { label: 'checksum ' + DATA.model.checksum, ok: checksumOk },
    { label: 'page fit matches stored curve', ok: curveOk }
  ];
  el.innerHTML = badges.map(function (b) {
    return '<span class="badge ' + (b.ok ? 'badge-ok' : 'badge-bad') + '">' + (b.ok ? '✓ ' : '✗ ') + esc(b.label) + '</span>';
  }).join('');
}

function renderFarmNext() {
  var el = document.getElementById('farm-next-body');
  if (!el) return;
  var top = DATA.rows.slice().sort(function (a, b) { return b.net_usd - a.net_usd; }).slice(0, 5);
  el.innerHTML = '<table><thead><tr><th>Rank</th><th>Protocol</th><th>Verdict</th><th>Net</th><th>Net/hour</th><th>Implied value</th></tr></thead><tbody>' +
    top.map(function (r) {
      return '<tr onclick="openDialog(\'' + esc(r.slug) + '\')"><td>' + esc(r.rank) + '</td><td>' + esc(r.name) + '</td><td><span class="verdict verdict-' + esc(r.verdict) + '">' + esc(r.verdict) + '</span></td><td>' + esc('$' + r.net_usd.toFixed(2)) + '</td><td>' + esc('$' + r.net_per_hour.toFixed(2)) + '</td><td>' + esc(compactFmt(r.implied_value_usd)) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

window.addEventListener('hashchange', handleHash);
renderModelPanel();
renderBadges();
renderFarmNext();
handleHash();
