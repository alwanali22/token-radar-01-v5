(function () {
  "use strict";

  function median(values) {
    var arr = (values || []).filter(function (v) { return typeof v === "number" && isFinite(v); });
    if (!arr.length) return 0;
    arr = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(arr.length / 2);
    if (arr.length % 2) return arr[mid];
    return (arr[mid - 1] + arr[mid]) / 2;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function toTime(value) {
    if (value instanceof Date) {
      var t = value.getTime();
      return isFinite(t) ? t : null;
    }
    if (typeof value === "string") {
      var p = Date.parse(value);
      return isFinite(p) ? p : null;
    }
    return null;
  }

  function ageDays(asOf, listedAt) {
    if (listedAt === null || listedAt === undefined) return null;
    var a = toTime(asOf);
    var l = toTime(listedAt);
    if (a === null || l === null) return null;
    var d = Math.floor((a - l) / 86400000);
    return d < 0 ? 0 : d;
  }

  function fitSizeCurve(liveProtocols) {
    var xs = [];
    var ys = [];
    var list = liveProtocols || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      var tvl = p.tvl_usd;
      var mcap = p.mcap_usd;
      if (typeof tvl !== "number" || typeof mcap !== "number") continue;
      if (!isFinite(tvl) || !isFinite(mcap) || tvl <= 0 || mcap <= 0) continue;
      xs.push(Math.log(tvl) / Math.LN10);
      ys.push(Math.log(mcap / tvl) / Math.LN10);
    }
    var n = xs.length;
    if (n < 10) {
      return { intercept: 3.0247, slope: -0.4777, n: n, clampMin: 0.02, clampMax: 0.8 };
    }
    var mx = 0;
    var my = 0;
    for (var i2 = 0; i2 < n; i2++) { mx += xs[i2]; my += ys[i2]; }
    mx /= n; my /= n;
    var num = 0;
    var den = 0;
    for (var i3 = 0; i3 < n; i3++) {
      var dx = xs[i3] - mx;
      num += dx * (ys[i3] - my);
      den += dx * dx;
    }
    var slope = den === 0 ? 0 : num / den;
    var intercept = my - slope * mx;
    return { intercept: intercept, slope: slope, n: n, clampMin: 0.02, clampMax: 0.8 };
  }

  function sizeMultiple(tvl, curve) {
    var c = curve || { intercept: 3.0247, slope: -0.4777, clampMin: 0.02, clampMax: 0.8 };
    var lo = c.clampMin === undefined ? 0.02 : c.clampMin;
    var hi = c.clampMax === undefined ? 0.8 : c.clampMax;
    if (typeof tvl !== "number" || !isFinite(tvl) || tvl <= 0) return lo;
    var v = Math.pow(10, c.intercept + c.slope * (Math.log(tvl) / Math.LN10));
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function growthMultiplier(change7d) {
    var c = (typeof change7d === "number" && isFinite(change7d)) ? change7d : 0;
    if (c < -30) c = -30;
    if (c > 30) c = 30;
    return 1 + c / 100;
  }

  function maturityMultiplier(ageDaysVal) {
    var a = (typeof ageDaysVal === "number" && isFinite(ageDaysVal)) ? ageDaysVal : 365;
    if (a < 0) a = 0;
    if (a > 1095) a = 1095;
    return 0.7 + 0.3 * a / 1095;
  }

  function valueIfLaunches(protocol, asOf, curve) {
    if (!protocol) return 1;
    var tvl = protocol.tvl_usd;
    if (typeof tvl !== "number" || !isFinite(tvl) || tvl <= 0) return 1;
    var v = tvl * sizeMultiple(tvl, curve) * growthMultiplier(protocol.change_7d) *
      maturityMultiplier(ageDays(asOf, protocol.listed_at));
    if (!isFinite(v) || v < 1) return 1;
    return v;
  }

  function recordsToken(protocol) {
    if (!protocol) return false;
    return protocol.mcap_usd !== null && protocol.mcap_usd !== undefined ? true :
      (protocol.gecko_id !== null && protocol.gecko_id !== undefined ? true :
        (protocol.symbol !== null && protocol.symbol !== undefined));
  }

  function sigmoid(z) {
    if (z > 700) return 1;
    if (z < -700) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  function oddsFeatures(protocol, asOf, medianAge) {
    var age = ageDays(asOf, protocol ? protocol.listed_at : null);
    if (age === null || age === undefined || !isFinite(age)) age = medianAge;
    var category = protocol ? protocol.category : null;
    var isDex = category === "Dexs";
    var isLending = category === "Lending";
    var isBridgeFamily = category === "Bridge" || category === "Canonical Bridge" || category === "Cross Chain Bridge";
    var isLiquidStakingFamily = category === "Liquid Staking" || category === "Liquid Restaking" || category === "Restaked BTC";
    var isCEX = category === "CEX";
    var listedNull = protocol ? protocol.listed_at === null || protocol.listed_at === undefined : true;
    return [
      Math.log1p(age),
      isDex ? 1 : 0,
      isLending ? 1 : 0,
      isBridgeFamily ? 1 : 0,
      isLiquidStakingFamily ? 1 : 0,
      isCEX ? 1 : 0,
      listedNull ? 1 : 0
    ];
  }

  function fitOddsModel(protocols, asOf) {
    var list = protocols || [];
    var n = list.length;
    var k = 7;
    var ages = [];
    for (var i = 0; i < n; i++) {
      var a = ageDays(asOf, list[i] ? list[i].listed_at : null);
      if (a !== null && a !== undefined && isFinite(a)) ages.push(a);
    }
    var medianAge = median(ages);

    var X = [];
    var y = [];
    var sumY = 0;
    for (var j = 0; j < n; j++) {
      X.push(oddsFeatures(list[j], asOf, medianAge));
      var label = recordsToken(list[j]) ? 1 : 0;
      y.push(label);
      sumY += label;
    }

    var means = new Array(k);
    var sds = new Array(k);
    for (var f = 0; f < k; f++) {
      var m = 0;
      for (var r = 0; r < n; r++) m += X[r][f];
      m = n ? m / n : 0;
      means[f] = m;
      var s = 0;
      for (var r2 = 0; r2 < n; r2++) {
        var d = X[r2][f] - m;
        s += d * d;
      }
      s = n ? Math.sqrt(s / n) : 0;
      sds[f] = s === 0 || !isFinite(s) ? 1 : s;
    }

    var Z = [];
    for (var r3 = 0; r3 < n; r3++) {
      var row = new Array(k);
      for (var f2 = 0; f2 < k; f2++) row[f2] = (X[r3][f2] - means[f2]) / sds[f2];
      Z.push(row);
    }

    var baseRate = n ? sumY / n : 0;
    if (baseRate < 1e-6) baseRate = 1e-6;
    if (baseRate > 1 - 1e-6) baseRate = 1 - 1e-6;

    var weights = new Array(k);
    for (var w = 0; w < k; w++) weights[w] = 0;
    var bias = Math.log(baseRate / (1 - baseRate));

    var lr = 0.1;
    var iters = 3000;
    var l2 = 0.02;

    for (var it = 0; it < iters; it++) {
      var gradW = new Array(k);
      for (var g = 0; g < k; g++) gradW[g] = 0;
      var gradB = 0;
      for (var m2 = 0; m2 < n; m2++) {
        var z = bias;
        for (var f3 = 0; f3 < k; f3++) z += weights[f3] * Z[m2][f3];
        var p = sigmoid(z);
        var err = p - y[m2];
        gradB += err;
        for (var f4 = 0; f4 < k; f4++) gradW[f4] += err * Z[m2][f4];
      }
      if (n) {
        gradB /= n;
        for (var f5 = 0; f5 < k; f5++) gradW[f5] /= n;
      }
      for (var f6 = 0; f6 < k; f6++) {
        weights[f6] -= lr * (gradW[f6] + l2 * weights[f6]);
      }
      bias -= lr * gradB;
    }

    return {
      weights: weights,
      bias: bias,
      means: means,
      sds: sds,
      baseRate: baseRate,
      medianAge: medianAge
    };
  }

  function oddsOf(protocol, model, asOf) {
    if (!model) return 1;
    var feats = oddsFeatures(protocol, asOf, model.medianAge);
    var z = model.bias;
    for (var i = 0; i < feats.length; i++) {
      var std = (feats[i] - model.means[i]) / model.sds[i];
      z += model.weights[i] * std;
    }
    var p = sigmoid(z);
    if (!isFinite(p)) p = model.baseRate;
    if (p < 0.001) p = 0.001;
    if (p > 0.999) p = 0.999;
    return p;
  }

  function residualSd(live, curve, asOf) {
    var list = live || [];
    var vals = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      var tvl = p.tvl_usd;
      var mcap = p.mcap_usd;
      if (typeof tvl !== "number" || typeof mcap !== "number") continue;
      if (!isFinite(tvl) || !isFinite(mcap) || tvl <= 0 || mcap <= 0) continue;
      var pred = tvl * sizeMultiple(tvl, curve) * growthMultiplier(p.change_7d) *
        maturityMultiplier(ageDays(asOf, p.listed_at));
      if (!isFinite(pred) || pred <= 0) continue;
      vals.push(Math.log(mcap / pred) / Math.LN10);
    }
    var count = vals.length;
    if (count < 10) return 0.798;
    var sum = 0;
    for (var j = 0; j < count; j++) sum += vals[j];
    var mu = sum / count;
    var ss = 0;
    for (var k2 = 0; k2 < count; k2++) {
      var d = vals[k2] - mu;
      ss += d * d;
    }
    return Math.sqrt(ss / count);
  }

  function impliedValue(protocol, curve, oddsModel, residualSdVal, asOf) {
    var base = valueIfLaunches(protocol, asOf, curve);
    var odds = oddsModel ? oddsOf(protocol, oddsModel, asOf) : 1;
    var raw = base * odds * 0.75;
    var val = Math.round(raw);
    if (!isFinite(val) || val < 1) return 1;
    return val;
  }

  function impliedDetail(protocol, curve, oddsModel, residualSdVal, asOf) {
    var tvl = protocol && typeof protocol.tvl_usd === "number" ? protocol.tvl_usd : 0;
    var sm = sizeMultiple(tvl, curve);
    var gm = growthMultiplier(protocol ? protocol.change_7d : null);
    var mm = maturityMultiplier(ageDays(asOf, protocol ? protocol.listed_at : null));
    var base = valueIfLaunches(protocol, asOf, curve);
    var odds = oddsModel ? oddsOf(protocol, oddsModel, asOf) : 1;
    var implied = impliedValue(protocol, curve, oddsModel, residualSdVal, asOf);
    var sigma = (typeof residualSdVal === "number" && isFinite(residualSdVal)) ? residualSdVal : 0.798;
    var lo = Math.round(implied * Math.pow(10, -0.6745 * sigma));
    if (!isFinite(lo) || lo < 1) lo = 1;
    var hi = Math.round(implied * Math.pow(10, 0.6745 * sigma));
    if (!isFinite(hi) || hi < lo + 1) hi = lo + 1;
    return {
      tvl: tvl,
      sizeMultiple: sm,
      growthMult: gm,
      maturityMult: mm,
      valueIfLaunches: base,
      odds: odds,
      implied: implied,
      rangeLo: lo,
      rangeHi: hi
    };
  }

  var VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WORD_RE = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

  function isSetAsideCategory(category) {
    return category === "Bridge" || category === "Canonical Bridge" ||
      category === "Liquid Staking" || category === "Liquid Restaking" ||
      category === "Restaked BTC" || category === "CEX";
  }

  function rankable(protocol) {
    if (!protocol) return true;
    if (recordsToken(protocol)) return false;
    if (isSetAsideCategory(protocol.category)) return false;
    var name = typeof protocol.name === "string" ? protocol.name : "";
    if (VERSION_RE.test(name)) return false;
    if (WORD_RE.test(name)) return false;
    if (EXCHANGE_RE.test(name)) return false;
    return true;
  }

  function ledgerPartition(protocols) {
    var list = protocols || [];
    var ranked = 0;
    var tokenTrades = 0;
    var reasons = [
      "category:Bridge",
      "category:Canonical Bridge",
      "category:CEX",
      "category:Liquid Staking",
      "category:Liquid Restaking",
      "category:Restaked BTC",
      "versioned-name",
      "wrapped/staked-word",
      "exchange-name"
    ];
    var counts = {};
    for (var r = 0; r < reasons.length; r++) counts[reasons[r]] = 0;

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      if (recordsToken(p)) { tokenTrades++; continue; }
      var cat = p.category;
      var name = typeof p.name === "string" ? p.name : "";
      var reason = null;
      if (cat === "Bridge") reason = "category:Bridge";
      else if (cat === "Canonical Bridge") reason = "category:Canonical Bridge";
      else if (cat === "CEX") reason = "category:CEX";
      else if (cat === "Liquid Staking") reason = "category:Liquid Staking";
      else if (cat === "Liquid Restaking") reason = "category:Liquid Restaking";
      else if (cat === "Restaked BTC") reason = "category:Restaked BTC";
      else if (VERSION_RE.test(name)) reason = "versioned-name";
      else if (WORD_RE.test(name)) reason = "wrapped/staked-word";
      else if (EXCHANGE_RE.test(name)) reason = "exchange-name";
      if (reason) counts[reason] += 1;
      else ranked++;
    }

    var setAside = [];
    for (var s = 0; s < reasons.length; s++) {
      if (counts[reasons[s]] > 0) setAside.push({ reason: reasons[s], count: counts[reasons[s]] });
    }

    return { ranked: ranked, tokenTrades: tokenTrades, setAside: setAside };
  }

  var FEE_USD_PER_TX = {
    Ethereum: 4.5,
    Arbitrum: 0.15,
    Base: 0.05,
    BSC: 0.15,
    Solana: 0.02,
    Optimism: 0.1,
    Polygon: 0.05,
    Avalanche: 0.3
  };

  function farmGas(protocol) {
    var chains = protocol && Array.isArray(protocol.chains) ? protocol.chains : [];
    var primaryChain = chains[0] || "Ethereum";
    var fee = FEE_USD_PER_TX.hasOwnProperty(primaryChain) ? FEE_USD_PER_TX[primaryChain] : 0.5;
    var gas = 6 * fee + (primaryChain === "Ethereum" ? 0 : 2.0);
    return { primaryChain: primaryChain, fee: fee, gasUsd: gas };
  }

  function farmEconomics(protocol, impliedValueUsd) {
    var g = farmGas(protocol);
    var depositUsd = 1000;
    var horizonDays = 90;
    var dropShare = 0.10;
    var tbillRate = 0.045;
    var tvl = protocol && typeof protocol.tvl_usd === "number" ? protocol.tvl_usd : 0;
    var rewardUsd = tvl > 0 ? impliedValueUsd * 0.10 * (1000 / tvl) : 0;
    var opportunityUsd = depositUsd * tbillRate * horizonDays / 365;
    var netUsd = rewardUsd - g.gasUsd - opportunityUsd;
    var netPerHour = netUsd / 2.7;
    var verdict;
    if (netUsd >= 25 && netPerHour >= 10) verdict = "FARM";
    else if (netUsd >= 0) verdict = "MARGINAL";
    else if (netUsd >= -25) verdict = "THIN";
    else verdict = "SKIP";
    return {
      depositUsd: depositUsd,
      horizonDays: horizonDays,
      dropShare: dropShare,
      tbillRate: tbillRate,
      gasUsd: g.gasUsd,
      rewardUsd: rewardUsd,
      opportunityUsd: opportunityUsd,
      netUsd: netUsd,
      netPerHour: netPerHour,
      verdict: verdict
    };
  }

  function whatIfFarm(protocol, impliedValueUsd, opts) {
    opts = opts || {};
    var depositUsd = typeof opts.depositUsd === "number" ? opts.depositUsd : 1000;
    var dropShare = typeof opts.dropShare === "number" ? opts.dropShare : 0.10;
    var horizonDays = typeof opts.horizonDays === "number" ? opts.horizonDays : 90;
    var tbillRate = typeof opts.tbillRate === "number" ? opts.tbillRate : 0.045;
    var g = farmGas(protocol);
    var tvl = protocol && typeof protocol.tvl_usd === "number" ? protocol.tvl_usd : 0;
    var rewardUsd = tvl > 0 ? impliedValueUsd * dropShare * (depositUsd / tvl) : 0;
    var opportunityUsd = depositUsd * tbillRate * horizonDays / 365;
    var netUsd = rewardUsd - g.gasUsd - opportunityUsd;
    var netPerHour = netUsd / 2.7;
    var verdict;
    if (netUsd >= 25 && netPerHour >= 10) verdict = "FARM";
    else if (netUsd >= 0) verdict = "MARGINAL";
    else if (netUsd >= -25) verdict = "THIN";
    else verdict = "SKIP";
    return {
      depositUsd: depositUsd,
      horizonDays: horizonDays,
      dropShare: dropShare,
      tbillRate: tbillRate,
      gasUsd: g.gasUsd,
      rewardUsd: rewardUsd,
      opportunityUsd: opportunityUsd,
      netUsd: netUsd,
      netPerHour: netPerHour,
      verdict: verdict
    };
  }

function predMcap(protocol, curve, asOf, opts) {
  opts = opts || {};
  var flatMult = opts.flatMult !== undefined ? opts.flatMult : sizeMultiple(protocol.tvl_usd, curve);
  var growth = opts.noGrowth ? 1 : growthMultiplier(protocol.change_7d);
  var mat = opts.noMat ? 1 : maturityMultiplier(ageDays(asOf, protocol.listed_at));
  return protocol.tvl_usd * flatMult * growth * mat;
}

function logAbsErr(pred, actual) {
  return Math.abs(Math.log(pred / actual) / Math.LN10);
}

function flatMultipleOf(rows) {
  return Math.pow(10, median(rows.map(function (r) {
    return Math.log(r.mcap_usd / r.tvl_usd) / Math.LN10;
  })));
}

function backtest(liveProtocols, asOf) {
  var n = liveProtocols.length;
  if (n < 10) return { curve: null, flat: null, n: n };
  var curveErrors = [];
  var flatErrors = [];
  for (var f = 0; f < 5; f++) {
    var train = [], test = [];
    for (var i = 0; i < n; i++) {
      if (i % 5 === f) test.push(liveProtocols[i]);
      else train.push(liveProtocols[i]);
    }
    if (!test.length || train.length < 2) continue;
    var curve = fitSizeCurve(train);
    var flat = flatMultipleOf(train);
    for (var j = 0; j < test.length; j++) {
      var p = test[j];
      curveErrors.push(logAbsErr(predMcap(p, curve, asOf), p.mcap_usd));
      flatErrors.push(logAbsErr(predMcap(p, curve, asOf, { flatMult: flat }), p.mcap_usd));
    }
  }
  return {
    curve: Math.pow(10, median(curveErrors)),
    flat: Math.pow(10, median(flatErrors)),
    n: n
  };
}

function backtestValue(liveProtocols, asOf) {
  var n = liveProtocols.length;
  if (n < 10) {
    return { cvCurve: null, cvFlat: null, looCurve: null, looFlat: null, walkForward: [] };
  }
  var cvCurveErrors = [], cvFlatErrors = [];
  for (var f = 0; f < 5; f++) {
    var train = [], test = [];
    for (var i = 0; i < n; i++) {
      if (i % 5 === f) test.push(liveProtocols[i]);
      else train.push(liveProtocols[i]);
    }
    if (!test.length || train.length < 2) continue;
    var curve = fitSizeCurve(train);
    var flat = flatMultipleOf(train);
    for (var j = 0; j < test.length; j++) {
      var p = test[j];
      cvCurveErrors.push(logAbsErr(predMcap(p, curve, asOf), p.mcap_usd));
      cvFlatErrors.push(logAbsErr(predMcap(p, curve, asOf, { flatMult: flat }), p.mcap_usd));
    }
  }
  var looCurveErrors = [], looFlatErrors = [];
  for (var k = 0; k < n; k++) {
    var tr = [];
    for (var m = 0; m < n; m++) if (m !== k) tr.push(liveProtocols[m]);
    var held = liveProtocols[k];
    var cLoo = fitSizeCurve(tr);
    var fLoo = flatMultipleOf(tr);
    looCurveErrors.push(logAbsErr(predMcap(held, cLoo, asOf), held.mcap_usd));
    looFlatErrors.push(logAbsErr(predMcap(held, cLoo, asOf, { flatMult: fLoo }), held.mcap_usd));
  }
  var walkForward = [];
  var cutoffs = ['2024-01-01', '2024-07-01', '2025-01-01'];
  for (var ci = 0; ci < cutoffs.length; ci++) {
    var cutoff = cutoffs[ci];
    var trW = [], teW = [];
    for (var q = 0; q < n; q++) {
      var lp = liveProtocols[q];
      if (!lp.listed_at) continue;
      if (String(lp.listed_at) < cutoff) trW.push(lp);
      else teW.push(lp);
    }
    if (trW.length < 10 || teW.length < 5) continue;
    var cW = fitSizeCurve(trW);
    var fW = flatMultipleOf(trW);
    var sd = residualSd(trW, cW, asOf);
    var span = Math.pow(10, 0.6745 * sd);
    var eC = [], eF = [], eG = [], eM = [], holds = 0;
    for (var t = 0; t < teW.length; t++) {
      var pp = teW[t];
      var pC = predMcap(pp, cW, asOf);
      eC.push(logAbsErr(pC, pp.mcap_usd));
      eF.push(logAbsErr(predMcap(pp, cW, asOf, { flatMult: fW }), pp.mcap_usd));
      eG.push(logAbsErr(predMcap(pp, cW, asOf, { noGrowth: true }), pp.mcap_usd));
      eM.push(logAbsErr(predMcap(pp, cW, asOf, { noMat: true }), pp.mcap_usd));
      if (pp.mcap_usd >= pC / span && pp.mcap_usd <= pC * span) holds++;
    }
    walkForward.push({
      cutoff: cutoff,
      train: trW.length,
      test: teW.length,
      miss: Math.pow(10, median(eC)),
      missFlat: Math.pow(10, median(eF)),
      missNoGrowth: Math.pow(10, median(eG)),
      missNoMaturity: Math.pow(10, median(eM)),
      sd: sd,
      holdsPct: 100 * holds / teW.length
    });
  }
  return {
    cvCurve: Math.pow(10, median(cvCurveErrors)),
    cvFlat: Math.pow(10, median(cvFlatErrors)),
    looCurve: Math.pow(10, median(looCurveErrors)),
    looFlat: Math.pow(10, median(looFlatErrors)),
    walkForward: walkForward
  };
}

function trainOddsWithStats(rows, labels, means, sds, baseRate) {
  var n = rows.length;
  var d = n ? rows[0].length : 0;
  var X = [];
  for (var i = 0; i < n; i++) {
    var z = [];
    for (var k = 0; k < d; k++) z.push((rows[i][k] - means[k]) / sds[k]);
    X.push(z);
  }
  var weights = [], bias;
  for (var w = 0; w < d; w++) weights.push(0);
  var br = Math.min(1 - 1e-6, Math.max(1e-6, baseRate));
  bias = Math.log(br / (1 - br));
  var lr = 0.1, l2 = 0.02, iters = 3000;
  for (var it = 0; it < iters; it++) {
    if (!n) break;
    var gw = [];
    for (var g = 0; g < d; g++) gw.push(0);
    var gb = 0;
    for (var a = 0; a < n; a++) {
      var s = bias;
      for (var b = 0; b < d; b++) s += weights[b] * X[a][b];
      var err = sigmoid(s) - labels[a];
      for (var c = 0; c < d; c++) gw[c] += err * X[a][c];
      gb += err;
    }
    for (var e = 0; e < d; e++) weights[e] -= lr * (gw[e] / n + l2 * weights[e]);
    bias -= lr * (gb / n);
  }
  return { weights: weights, bias: bias };
}

function backtestOdds(protocols, asOf) {
  var n = protocols.length;
  var full = fitOddsModel(protocols, asOf);
  var medianAge = full.medianAge;
  var means = full.means;
  var sds = full.sds;
  var labelsAll = protocols.map(function (p) { return recordsToken(p) ? 1 : 0; });
  var rowsAll = protocols.map(function (p) { return oddsFeatures(p, asOf, medianAge); });
  var d = rowsAll.length ? rowsAll[0].length : 0;
  var baseRate = 0.5;
  if (n) {
    baseRate = 0;
    for (var i = 0; i < n; i++) baseRate += labelsAll[i];
    baseRate = baseRate / n;
  }
  var baseBrier = baseRate * (1 - baseRate);
  var allCols = [];
  for (var cIdx = 0; cIdx < d; cIdx++) allCols.push(cIdx);

  function standardise(row, cols) {
    var z = [];
    for (var k = 0; k < cols.length; k++) z.push((row[cols[k]] - means[cols[k]]) / sds[cols[k]]);
    return z;
  }

  function predict(m, z) {
    var s = m.bias;
    for (var k = 0; k < z.length; k++) s += m.weights[k] * z[k];
    return sigmoid(s);
  }

  function cvBrierFor(cols) {
    var total = 0, count = 0;
    var zeros = [], ones = [];
    for (var k = 0; k < cols.length; k++) { zeros.push(0); ones.push(1); }
    for (var f = 0; f < 5; f++) {
      var trRows = [], trLabels = [], teIdx = [];
      for (var i2 = 0; i2 < n; i2++) {
        if (i2 % 5 === f) teIdx.push(i2);
        else { trRows.push(standardise(rowsAll[i2], cols)); trLabels.push(labelsAll[i2]); }
      }
      if (!teIdx.length || trLabels.length < 2) continue;
      var m = trainOddsWithStats(trRows, trLabels, zeros, ones, baseRate);
      for (var t2 = 0; t2 < teIdx.length; t2++) {
        var pr = predict(m, standardise(rowsAll[teIdx[t2]], cols));
        total += (pr - labelsAll[teIdx[t2]]) * (pr - labelsAll[teIdx[t2]]);
        count++;
      }
    }
    return count ? total / count : null;
  }

  var cvBrier = cvBrierFor(allCols);

  var idx = [];
  for (var s0 = 0; s0 < n; s0++) idx.push(s0);
  var rnd = mulberry32(20261121);
  for (var s1 = n - 1; s1 > 0; s1--) {
    var jSwap = Math.floor(rnd() * (s1 + 1));
    var tmp = idx[s1];
    idx[s1] = idx[jSwap];
    idx[jSwap] = tmp;
  }
  var nTest = Math.floor(n * 0.2);
  var holdoutBrier = null;
  if (nTest > 0 && n - nTest >= 2) {
    var hoTrainRows = [], hoTrainLabels = [], hoTest = idx.slice(0, nTest);
    for (var h = nTest; h < n; h++) {
      hoTrainRows.push(standardise(rowsAll[idx[h]], allCols));
      hoTrainLabels.push(labelsAll[idx[h]]);
    }
    var zerosAll = [], onesAll = [];
    for (var z2 = 0; z2 < allCols.length; z2++) { zerosAll.push(0); onesAll.push(1); }
    var mh = trainOddsWithStats(hoTrainRows, hoTrainLabels, zerosAll, onesAll, baseRate);
    var tot = 0;
    for (var t3 = 0; t3 < hoTest.length; t3++) {
      var prh = predict(mh, standardise(rowsAll[hoTest[t3]], allCols));
      tot += (prh - labelsAll[hoTest[t3]]) * (prh - labelsAll[hoTest[t3]]);
    }
    holdoutBrier = tot / hoTest.length;
  }

  var dropAgeCols = allCols.filter(function (c2) { return c2 !== 0; });
  var dropCatCols = allCols.filter(function (c3) { return c3 < 1 || c3 > 5; });
  var dropListedNullCols = allCols.filter(function (c4) { return c4 !== 6; });

  return {
    cvBrier: cvBrier,
    holdoutBrier: holdoutBrier,
    baseBrier: baseBrier,
    ablations: {
      dropAge: cvBrierFor(dropAgeCols),
      dropCatFlags: cvBrierFor(dropCatCols),
      dropListedNull: cvBrierFor(dropListedNullCols)
    }
  };
}

function percentileOf(sorted, q) {
  if (!sorted.length) return null;
  var index = q * (sorted.length - 1);
  var lo = Math.floor(index), hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function bootstrapSlope(liveProtocols) {
  var n = liveProtocols.length;
  if (n < 10) return { p25: -0.4777, p75: -0.4777, n: 0 };
  var rnd = mulberry32(20261121);
  var slopes = [];
  for (var b = 0; b < 200; b++) {
    var sample = [];
    for (var i = 0; i < n; i++) sample.push(liveProtocols[Math.floor(rnd() * n)]);
    var curve = fitSizeCurve(sample);
    var s = curve ? curve.slope : null;
    if (typeof s === 'number' && isFinite(s)) slopes.push(s);
  }
  slopes.sort(function (a, b2) { return a - b2; });
  return { p25: percentileOf(slopes, 0.25), p75: percentileOf(slopes, 0.75), n: 200 };
}

window.TokenRadarModel = { median: median, mulberry32: mulberry32, ageDays: ageDays, fitSizeCurve: fitSizeCurve, sizeMultiple: sizeMultiple, growthMultiplier: growthMultiplier, maturityMultiplier: maturityMultiplier, valueIfLaunches: valueIfLaunches, recordsToken: recordsToken, sigmoid: sigmoid, oddsFeatures: oddsFeatures, fitOddsModel: fitOddsModel, oddsOf: oddsOf, residualSd: residualSd, impliedValue: impliedValue, impliedDetail: impliedDetail, rankable: rankable, ledgerPartition: ledgerPartition, FEE_USD_PER_TX: FEE_USD_PER_TX, farmEconomics: farmEconomics, whatIfFarm: whatIfFarm, backtest: backtest, backtestValue: backtestValue, backtestOdds: backtestOdds, bootstrapSlope: bootstrapSlope };
})();

