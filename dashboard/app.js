// Token Radar radar-5 — dashboard logic. Everything shown is computed from
// window.RADAR (the generated data.js); the model library (TokenRadarModel)
// re-derives each row live for the self-checks and the detail dialog.
const R = window.RADAR, M = R.model, T = window.TokenRadarModel;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (n) => "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const signed = (n) => (n < 0 ? "-$" : "+$") + Math.abs(n).toFixed(2);
const usd2 = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);
function fnv1a(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
// The snapshot date of a row, rebuilt from its stored age in days.
function listedAt(age) {
  if (age == null) return null;
  const d = new Date(M.as_of + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - age);
  return d.toISOString().slice(0, 10);
}
function protoOf(row) {
  return { slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, listed_at: listedAt(row.age_days) };
}
function recompute(row) {
  return T.impliedDetail(protoOf(row), M.curve, M.odds, M.residualSd, M.as_of);
}

// --- research summary, stats, KPIs (numbers from the data, not hardcoded) ---
const wf0 = M.backtest.value.walkForward[0];
$("summary").textContent =
  "Implied value = TVL \u00d7 a size-fitted multiple \u00d7 growth \u00d7 maturity \u00d7 launch odds \u00d7 0.75. " +
  "The multiple is fitted on this snapshot's own " + R.liveAll.length + " live tokens " +
  "(log10 multiple = " + M.curve.intercept.toFixed(2) + " \u2212 " + Math.abs(M.curve.slope).toFixed(2) +
  " \u00d7 log10 TVL). Launch odds come from a logistic model fitted on all " + R.counts.total +
  " protocols (age, category, no listed date). Walk-forward miss " + wf0.miss.toFixed(2) +
  "\u00d7 versus " + wf0.missFlat.toFixed(2) + "\u00d7 flat; odds Brier " + M.odds.cvBrier.toFixed(3) +
  " versus " + M.odds.baseBrier.toFixed(3) + " base rate; the P25\u2013P75 range holds " +
  wf0.holdsPct.toFixed(1) + "% of newer live tokens; " + R.counts.excluded +
  " wrapped, bridged, staked and exchange products excluded; snapshot frozen " + M.as_of + ".";
$("stats").textContent =
  R.counts.total + " protocols \u00b7 " + R.counts.watchlist + " watchlist \u00b7 " + R.counts.board +
  " board rows \u00b7 " + R.counts.early + " early \u00b7 " + R.counts.live + " live tokens \u00b7 " +
  R.counts.excluded + " excluded \u00b7 snapshot " + M.as_of;
const bestNet = [...R.rows].sort((a, b) => b.net_usd - a.net_usd)[0];
$("kpis").innerHTML =
  "<div class=kpi><b>" + R.counts.board + "</b><span>board rows</span></div>" +
  "<div class=kpi><b>" + money(R.rows[0].implied_value_usd) + "</b><span>top implied \u00b7 " + esc(R.rows[0].slug) + "</span></div>" +
  "<div class=kpi><b>" + signed(bestNet.net_usd) + "</b><span>best farm net \u00b7 " + esc(bestNet.slug) + "</span></div>" +
  "<div class=kpi><b>" + wf0.miss.toFixed(2) + "\u00d7 / " + M.odds.cvBrier.toFixed(3) + "</b><span>walk-forward miss / odds Brier</span></div>";

// --- seven self-check badges ---
const badges = [];
function badge(label, ok, detail) {
  badges.push('<span class="badge ' + (ok ? "ok" : "bad") + '">' + (ok ? "\u2713 " : "\u2717 ") + esc(label) + " \u00b7 " + esc(detail) + "</span>");
}
const ranksOk = R.rows.every((r, i) => r.rank === i + 1);
badge("rank order", ranksOk, "1\u2013" + R.rows.length);
const monoOk = R.rows.every((r, i) => i === 0 || r.implied_value_usd <= R.rows[i - 1].implied_value_usd);
badge("monotonic order", monoOk, "values never rise");
const setAside = M.ledger.setAside.reduce((s, g) => s + g.count, 0);
const ledgerOk = M.ledger.ranked + M.ledger.tokenTrades + setAside === R.counts.total;
badge("ledger sums", ledgerOk, M.ledger.ranked + "+" + M.ledger.tokenTrades + "+" + setAside + "=" + R.counts.total);
const wlOk = R.rows.filter((r) => r.watchlist).length === 40;
badge("watchlist", wlOk, "40/40");
let agree = 0;
for (const row of R.rows) {
  const d = recompute(row);
  if (d.implied === row.implied_value_usd && d.rangeLo === row.range_lo && d.rangeHi === row.range_hi) agree++;
}
badge("recompute", agree === R.rows.length, agree + "/" + R.rows.length + " agree");
const sumOk = fnv1a(JSON.stringify(R.rows)) === M.checksum;
badge("checksum", sumOk, M.checksum);
const fitsOk = document.documentElement.scrollWidth <= window.innerWidth + 1;
badge("page fits", fitsOk, "no overflow");
$("badges").innerHTML = badges.join("");

// --- ledger ---
$("ledger-body").innerHTML =
  '<div class=card><b>' + M.ledger.ranked + '</b><span>ranked on the board</span></div>' +
  '<div class=card><b>' + M.ledger.tokenTrades + '</b><span>token already trades</span></div>' +
  M.ledger.setAside.map((g) => '<div class=card><b>' + g.count + '</b><span>set aside \u00b7 ' + esc(g.reason) + "</span></div>").join("");

// --- farm next: top 5 by net ---
$("farm-next-body").innerHTML = [...R.rows].sort((a, b) => b.net_usd - a.net_usd).slice(0, 5)
  .map((r) => '<div class=card data-slug="' + esc(r.slug) + '"><b class="v-' + r.verdict + '">' + signed(r.net_usd) + '</b><span>' + esc(r.slug) +
    " \u00b7 " + r.verdict + " \u00b7 " + usd2(r.net_per_hour) + "/h \u00b7 gas " + usd2(r.gas_usd) + "</span></div>").join("");
$("farm-next-body").querySelectorAll(".card").forEach((el) =>
  el.addEventListener("click", () => openDialog(R.rows.find((r) => r.slug === el.dataset.slug))));

// --- scatter: 128 live tokens, log TVL vs log market cap + fitted curve ---
(function scatter() {
  const pts = R.liveAll.filter((p) => p.tvl_usd > 0 && p.mcap_usd > 0);
  const W = 640, H = 360, L = 52, Rr = 14, Tp = 24, B = 30;
  const xs = pts.map((p) => Math.log10(p.tvl_usd)), ys = pts.map((p) => Math.log10(p.mcap_usd));
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - Rr);
  const Y = (y) => Tp + (1 - (y - y0) / (y1 - y0)) * (H - Tp - B);
  let s = '<svg width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="Scatter of live token market cap against TVL">';
  for (let g = x0; g <= x1; g++) {
    s += '<line x1="' + X(g).toFixed(1) + '" y1="' + Tp + '" x2="' + X(g).toFixed(1) + '" y2="' + (H - B) + '" stroke="#21262d"/>' +
      '<text x="' + X(g).toFixed(1) + '" y="' + (H - 10) + '" fill="#8b949e" font-size="10" text-anchor="middle">10^' + g + "</text>";
  }
  for (let g = y0; g <= y1; g++) {
    s += '<line x1="' + L + '" y1="' + Y(g).toFixed(1) + '" x2="' + (W - Rr) + '" y2="' + Y(g).toFixed(1) + '" stroke="#21262d"/>' +
      '<text x="' + (L - 6) + '" y="' + (Y(g) + 3).toFixed(1) + '" fill="#8b949e" font-size="10" text-anchor="end">10^' + g + "</text>";
  }
  let path = "";
  for (let i = 0; i <= 40; i++) {
    const tvl = Math.pow(10, x0 + ((x1 - x0) * i) / 40);
    const mc = tvl * T.sizeMultiple(tvl, M.curve);
    path += (i ? "L" : "M") + X(Math.log10(tvl)).toFixed(1) + "," + Y(Math.log10(mc)).toFixed(1);
  }
  s += '<path d="' + path + '" fill="none" stroke="#58a6ff" stroke-width="2"/>';
  for (const p of pts) s += '<circle cx="' + X(Math.log10(p.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(p.mcap_usd)).toFixed(1) + '" r="2.6" fill="#3fb950"><title>' + esc(p.slug) + "</title></circle>";
  s += "</svg>";
  $("scatter-body").innerHTML = s;
})();

// --- live tab ---
$("live-body").innerHTML = R.live.map((p, i) =>
  "<tr><td>" + (i + 1) + "</td><td>" + esc(p.name) + ' <span class=mut>' + esc(p.slug) + "</span></td><td>" +
  esc(p.category ?? "\u2014") + "</td><td class=num>" + money(p.tvl_usd) + '</td><td class=num>' + money(p.mcap_usd) + "</td></tr>").join("");

// --- model panel ---
const bt = M.backtest.value, bo = M.backtest.odds, bs = M.backtest.bootstrap;
$("model-panel-body").innerHTML =
  "<p>Size curve (OLS on " + M.curve.n + " live tokens): log10 multiple = " + M.curve.intercept.toFixed(4) +
  " \u2212 " + Math.abs(M.curve.slope).toFixed(4) + " \u00d7 log10 TVL, clamped to [" + M.curve.clampMin + ", " + M.curve.clampMax +
  "]. Bootstrap slope P25 " + bs.p25.toFixed(4) + ", P75 " + bs.p75.toFixed(4) + " (" + bs.n + " refits).</p>" +
  "<p>Size multiple at $10M " + T.sizeMultiple(1e7, M.curve).toFixed(4) + ", $100M " + T.sizeMultiple(1e8, M.curve).toFixed(4) +
  ", $1B " + T.sizeMultiple(1e9, M.curve).toFixed(4) + ", $10B " + T.sizeMultiple(1e10, M.curve).toFixed(4) + ".</p>" +
  "<p>Value backtest: 5-fold CV miss " + bt.cvCurve.toFixed(2) + "\u00d7 (flat " + bt.cvFlat.toFixed(2) +
  "\u00d7), leave-one-out " + bt.looCurve.toFixed(2) + "\u00d7 (flat " + bt.looFlat.toFixed(2) + "\u00d7).</p>" +
  "<table><thead><tr><th>Walk-forward cutoff</th><th class=num>Train</th><th class=num>Test</th><th class=num>Miss</th><th class=num>Flat</th><th class=num>Holds</th></tr></thead><tbody>" +
  bt.walkForward.map((w) => "<tr><td>" + w.cutoff + "</td><td class=num>" + w.train + "</td><td class=num>" + w.test +
    '</td><td class=num>' + w.miss.toFixed(2) + "\u00d7</td><td class=num>" + w.missFlat.toFixed(2) +
    "\u00d7</td><td class=num>" + w.holdsPct.toFixed(1) + "%</td></tr>").join("") + "</tbody></table>" +
  "<p>Launch odds (logistic, 7 features): Brier CV " + bo.cvBrier.toFixed(4) + ", holdout " + bo.holdoutBrier.toFixed(4) +
  ", base rate " + bo.baseBrier.toFixed(4) + ". Ablation (Brier when dropped): age " + bo.ablations.dropAge.toFixed(4) +
  ", category flags " + bo.ablations.dropCatFlags.toFixed(4) + ", listed-null flag " + bo.ablations.dropListedNull.toFixed(4) + ".</p>";

// --- research note ---
$("research-note-body").innerHTML =
  "<p>Verdicts are farming economics at a $1,000 deposit over 90 days with a 10% drop share: " +
  "FARM means the expected net is clearly positive after gas and the T-bill opportunity cost; " +
  "MARGINAL a small positive; THIN near zero or slightly negative; SKIP clearly negative. " +
  "Open any row for its six farm steps and a what-if panel that reprices it at your own deposit, " +
  "drop share, horizon and T-bill rate.</p><p>The " + R.counts.excluded +
  " excluded protocols are wrapped, bridged, staked or exchange products, versioned names and " +
  "categories that already trade a token — they are not launches waiting to happen. Every implied " +
  "value is the model's own claim from this frozen snapshot (" + M.as_of + "), not a promise: " +
  "a protocol can stay tokenless, launch small, or launch and fall.</p>";

// --- board table, filters, sort ---
const boardBody = $("board-body");
function filteredRows() {
  const q = $("q").value.trim().toLowerCase();
  const cat = $("cat").value, ch = $("chain").value, vd = $("verdict").value, wl = $("watch").checked;
  let list = R.rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!cat || r.category === cat) && (!ch || r.chains.includes(ch)) &&
    (!vd || r.verdict === vd) && (!wl || r.watchlist));
  const s = $("sort").value;
  const key = s === "net" ? (r) => r.net_usd : s === "tvl" ? (r) => r.tvl_usd : s === "age" ? (r) => r.age_days ?? -1 : (r) => r.implied_value_usd;
  return [...list].sort((a, b) => key(b) - key(a) || (a.slug < b.slug ? -1 : 1));
}
function renderBoard() {
  boardBody.innerHTML = filteredRows().map((r) =>
    '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + "</td><td>" + esc(r.name) +
    ' <span class=mut>' + esc(r.slug) + (r.watchlist ? " \u2605" : "") + "<br>" + esc(r.category ?? "\u2014") + " \u00b7 " + esc(r.chains.slice(0, 3).join(", ")) + "</span></td>" +
    '<td class=num>' + money(r.tvl_usd) + '</td><td class=num>' + money(r.implied_value_usd) + "</td>" +
    '<td class=num><span class=mut>' + money(r.range_lo) + " \u2013 " + money(r.range_hi) + "</span></td>" +
    '<td class=num>' + r.odds.toFixed(3) + '</td><td class="v-' + r.verdict + '">' + r.verdict + "</td>" +
    '<td class=num>' + signed(r.net_usd) + '</td><td class=num>' + signed(r.net_per_hour) + "</td></tr>").join("");
  boardBody.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", () => openDialog(R.rows.find((r) => r.slug === tr.dataset.slug))));
}
for (const c of [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort())
  $("cat").insertAdjacentHTML("beforeend", '<option>' + esc(c) + "</option>");
for (const c of [...new Set(R.rows.flatMap((r) => r.chains))].sort())
  $("chain").insertAdjacentHTML("beforeend", '<option>' + esc(c) + "</option>");
["q", "cat", "chain", "watch", "verdict", "sort"].forEach((id) =>
  $(id).addEventListener("input", renderBoard));
renderBoard();

// --- tabs ---
$("tab-board").addEventListener("click", () => {
  $("tab-board").classList.add("on"); $("tab-live").classList.remove("on");
  $("board-panel").hidden = false; $("live-panel").hidden = true;
});
$("tab-live").addEventListener("click", () => {
  $("tab-live").classList.add("on"); $("tab-board").classList.remove("on");
  $("live-panel").hidden = false; $("board-panel").hidden = true;
});

// --- detail dialog ---
let dlgRow = null;
function whatIfText() {
  if (!dlgRow) return "";
  const dep = parseFloat($("wi-dep").value) || 0;
  const ds = parseFloat($("wi-drop").value) || 0;
  const hz = parseFloat($("wi-hor").value) || 0;
  const tb = parseFloat($("wi-tb").value) || 0;
  const w = T.whatIfFarm(protoOf(dlgRow), dlgRow.implied_value_usd, { depositUsd: dep, dropShare: ds, horizonDays: hz, tbillRate: tb });
  return '<p class=wi-out>' + w.verdict + " " + signed(w.netUsd ?? 0) + " net \u00b7 " + signed(w.netPerHour ?? 0) +
    "/h \u00b7 gas " + usd2(w.gasUsd ?? 0) + "</p>";
}
function openDialog(row) {
  dlgRow = row;
  const d = recompute(row);
  const agree = d.implied === row.implied_value_usd && d.rangeLo === row.range_lo && d.rangeHi === row.range_hi;
  $("dlg-body").innerHTML =
    "<h3>" + esc(row.name) + ' <span class=mut>' + esc(row.slug) + " \u00b7 rank " + row.rank + "</span></h3>" +
    "<p>Implied <b>" + money(row.implied_value_usd) + "</b> \u00b7 range " + money(row.range_lo) + " \u2013 " + money(row.range_hi) +
    " \u00b7 value if launches " + money(row.value_if_launches) + " \u00b7 launch odds " + row.odds.toFixed(3) +
    " \u00b7 size multiple " + row.size_multiple.toFixed(4) + " \u00b7 growth " + row.growth_mult.toFixed(3) +
    " \u00b7 maturity " + row.maturity_mult.toFixed(3) + "</p>" +
    "<p>Recomputed live with the page model: implied " + money(d.implied) + ", range " + money(d.rangeLo) +
    " \u2013 " + money(d.rangeHi) + " \u2014 <b>agree: " + (agree ? "yes" : "no") + "</b></p>" +
    "<p>Farm economics at $1,000 / 90 days / 10% drop: <b class=\"v-" + row.verdict + "\">" + row.verdict + "</b> " +
    signed(row.net_usd) + " net \u00b7 " + signed(row.net_per_hour) + "/h \u00b7 gas " + usd2(row.gas_usd) + "</p>" +
    "<ol>" + row.farm_steps.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol>" +
    '<div class=wi><label>Deposit $<input id="wi-dep" type="number" value="1000" min="0" step="100"></label>' +
    '<label>Drop share<input id="wi-drop" type="number" value="0.1" min="0" max="1" step="0.01"></label>' +
    '<label>Horizon (days)<input id="wi-hor" type="number" value="90" min="1" step="1"></label>' +
    '<label>T-bill rate<input id="wi-tb" type="number" value="0.045" min="0" max="1" step="0.001"></label></div>' +
    '<div id="wi-out"></div>';
  const refresh = () => { $("wi-out").innerHTML = whatIfText(); };
  ["wi-dep", "wi-drop", "wi-hor", "wi-tb"].forEach((id) => $(id).addEventListener("input", refresh));
  refresh();
  $("dlg").hidden = false;
}
$("dlg-close").addEventListener("click", () => { $("dlg").hidden = true; dlgRow = null; });
$("dlg").addEventListener("click", (e) => { if (e.target === $("dlg")) { $("dlg").hidden = true; dlgRow = null; } });
