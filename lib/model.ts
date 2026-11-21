export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

export interface SizeCurve {
  intercept: number;
  slope: number;
  n: number;
  clampMin: number;
  clampMax: number;
}

export interface OddsModel {
  weights: number[];
  bias: number;
  means: number[];
  sds: number[];
  baseRate: number;
  medianAge: number;
}

export interface FactorBreakdown {
  tvl: number;
  sizeMultiple: number;
  growthMult: number;
  maturityMult: number;
  valueIfLaunches: number;
  odds: number;
  implied: number;
  rangeLo: number;
  rangeHi: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  rank: number;
  implied_value_usd: number;
  size_multiple: number;
  growth_mult: number;
  maturity_mult: number;
  farm_steps: string[];
  odds: number;
  value_if_launches: number;
  range_lo: number;
  range_hi: number;
  verdict: string;
  net_usd: number;
  net_per_hour: number;
  gas_usd: number;
}

export interface FarmEconomics {
  depositUsd: number;
  horizonDays: number;
  dropShare: number;
  tbillRate: number;
  gasUsd: number;
  rewardUsd: number;
  opportunityUsd: number;
  netUsd: number;
  netPerHour: number;
  verdict: string;
}

// Middle value of a sample, averaging the two central entries when the
// sample size is even. An empty sample reports zero rather than NaN.
export function median(values: number[]): number {
  const count = values.length;
  if (count === 0) return 0;
  const ordered = values.slice().sort((left, right) => left - right);
  const centre = Math.floor(count / 2);
  const even = count % 2 === 0;
  if (even) {
    const lower = ordered[centre - 1];
    const upper = ordered[centre];
    return (lower + upper) / 2;
  }
  return ordered[centre];
}

// Deterministic 32-bit generator (mulberry32). The shuffle and the
// bootstrap both draw from one seeded stream, so the exact step order
// below is load-bearing: do not reorder the mixes.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function nextRandom(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Epoch milliseconds for a date object or an ISO date string.
function dateTimeValue(value: string | Date): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  return Date.parse(value);
}

// Whole days between the listing date and the snapshot date, floored at
// zero. A protocol with no listing date has no age.
export function ageDays(asOf: string | Date, listedAt: string | null): number | null {
  if (listedAt === null) {
    return null;
  }
  const snapshotMs = dateTimeValue(asOf);
  const listedMs = Date.parse(listedAt);
  if (!Number.isFinite(snapshotMs) || !Number.isFinite(listedMs)) {
    return null;
  }
  const elapsed = Math.floor((snapshotMs - listedMs) / 86400000);
  if (elapsed < 0) {
    return 0;
  }
  return elapsed;
}

// Ordinary least squares on log10(TVL) against log10(market-cap / TVL)
// over the live protocols. With too few points, a degenerate spread, or
// a non-finite fit, the pooled fit from the full snapshot is returned
// instead, so callers always get a usable curve.
export function fitSizeCurve(live: SnapshotProtocol[]): SizeCurve {
  const logTvl: number[] = [];
  const logRatio: number[] = [];
  for (const protocol of live) {
    const tvlOk = Number.isFinite(protocol.tvl_usd) && protocol.tvl_usd > 0;
    const mcap = protocol.mcap_usd as number;
    const mcapOk = Number.isFinite(mcap) && mcap > 0;
    if (!tvlOk || !mcapOk) continue;
    const xValue = Math.log10(protocol.tvl_usd);
    const yValue = Math.log10(mcap / protocol.tvl_usd);
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) continue;
    logTvl.push(xValue);
    logRatio.push(yValue);
  }
  const pointCount = logTvl.length;
  const pooled = (count: number): SizeCurve => ({
    intercept: 3.0247,
    slope: -0.4777,
    n: count,
    clampMin: 0.02,
    clampMax: 0.8,
  });
  if (pointCount < 10) return pooled(pointCount);
  let xTotal = 0;
  let yTotal = 0;
  for (let k = 0; k < pointCount; k++) {
    xTotal += logTvl[k];
    yTotal += logRatio[k];
  }
  const xCentre = xTotal / pointCount;
  const yCentre = yTotal / pointCount;
  let covTotal = 0;
  let varTotal = 0;
  for (let k = 0; k < pointCount; k++) {
    const xDev = logTvl[k] - xCentre;
    covTotal += xDev * (logRatio[k] - yCentre);
    varTotal += xDev * xDev;
  }
  if (!(varTotal > 0)) return pooled(pointCount);
  const fittedSlope = covTotal / varTotal;
  const fittedIntercept = yCentre - fittedSlope * xCentre;
  if (!Number.isFinite(fittedIntercept) || !Number.isFinite(fittedSlope)) {
    return pooled(pointCount);
  }
  return {
    intercept: fittedIntercept,
    slope: fittedSlope,
    n: pointCount,
    clampMin: 0.02,
    clampMax: 0.8,
  };
}

// Fitted market-cap/TVL multiple for a TVL, clamped into the curve's
// band. A missing or non-positive TVL takes the floor of the band.
export function sizeMultiple(tvl: number, curve: SizeCurve): number {
  const usable = Number.isFinite(tvl) && tvl > 0;
  if (!usable) return curve.clampMin;
  const exponent = curve.intercept + curve.slope * Math.log10(tvl);
  const fitted = Math.pow(10, exponent);
  if (Number.isNaN(fitted)) return curve.clampMin;
  const floored = Math.max(curve.clampMin, fitted);
  return Math.min(curve.clampMax, floored);
}

// Seven-day TVL momentum as a multiplier, capped at plus or minus
// thirty percent. Missing data counts as flat.
export function growthMultiplier(change7d: number | null): number {
  let weekly = 0;
  if (change7d !== null && Number.isFinite(change7d)) weekly = change7d;
  const bounded = Math.max(-30, Math.min(30, weekly));
  return 1 + bounded / 100;
}

// Seasoning multiplier: a protocol earns the full factor only after
// three years tracked, starting at 0.7 for a fresh listing. Missing
// ages count as one year.
export function maturityMultiplier(ageDaysVal: number | null): number {
  let days = 365;
  if (ageDaysVal !== null && Number.isFinite(ageDaysVal)) days = ageDaysVal;
  const bounded = Math.min(Math.max(days, 0), 1095);
  return 0.7 + (0.3 * bounded) / 1095;
}

// What the protocol would be worth if it launched a token today: TVL
// times the fitted multiple, growth and seasoning. Floored at one
// dollar and guarded against non-finite inputs.
export function valueIfLaunches(p: SnapshotProtocol, asOf: string | Date, curve: SizeCurve): number {
  const tvlOk = Number.isFinite(p.tvl_usd) && p.tvl_usd > 0;
  if (!tvlOk) return 1;
  const sizePart = sizeMultiple(p.tvl_usd, curve);
  const growthPart = growthMultiplier(p.change_7d);
  const agePart = maturityMultiplier(ageDays(asOf, p.listed_at));
  const value = p.tvl_usd * sizePart * growthPart * agePart;
  const sane = Number.isFinite(value);
  if (!sane) return 1;
  const floored = Math.max(1, value);
  return floored;
}

// A protocol records a token when DefiLlama lists a market cap for it,
// or when it carries a Gecko id or a symbol. Any one of the three is
// enough to count the protocol as already-tokenised.
function recordsToken(p: SnapshotProtocol): boolean {
  const hasMcap = p.mcap_usd !== null;
  const hasGecko = p.gecko_id !== null;
  const hasSymbol = p.symbol !== null;
  return hasMcap || hasGecko || hasSymbol;
}

// Logistic squash, clamped at the extremes so exp() never overflows.
function sigmoid(z: number): number {
  if (z > 700) {
    return 1;
  }
  if (z < -700) {
    return 0;
  }
  const denom = 1 + Math.exp(-z);
  return 1 / denom;
}

// The seven launch-odds inputs, in the order the fitted weights expect:
// log age, then one-hot flags for Dexs, Lending, bridge-like, liquid
// staking-like, CEX, and a missing listing date. Protocols with no
// listing date use the snapshot's median age.
function oddsFeatures(p: SnapshotProtocol, asOf: string | Date, medianAge: number): number[] {
  const listedAge = ageDays(asOf, p.listed_at);
  const age = listedAge === null ? medianAge : listedAge;
  const cat = p.category;
  const isDex = cat === 'Dexs' ? 1 : 0;
  const isLending = cat === 'Lending' ? 1 : 0;
  const bridgeLike = cat === 'Bridge' || cat === 'Canonical Bridge' || cat === 'Cross Chain Bridge';
  const stakingLike = cat === 'Liquid Staking' || cat === 'Liquid Restaking' || cat === 'Restaked BTC';
  const isCex = cat === 'CEX' ? 1 : 0;
  const noListedDate = p.listed_at === null ? 1 : 0;
  return [Math.log1p(age), isDex, isLending, bridgeLike ? 1 : 0, stakingLike ? 1 : 0, isCex, noListedDate];
}

export function fitOddsModel(protocols: SnapshotProtocol[], asOf: string | Date): OddsModel {
  const n = protocols.length;
  const ages: number[] = [];
  for (const p of protocols) {
    const age = ageDays(asOf, p.listed_at);
    if (age !== null) ages.push(age);
  }
  const medianAge = median(ages);
  const featureCount = 7;
  if (n === 0) {
    return {
      weights: new Array(featureCount).fill(0),
      bias: 0,
      means: new Array(featureCount).fill(0),
      sds: new Array(featureCount).fill(1),
      baseRate: 0,
      medianAge,
    };
  }
  const rows: number[][] = [];
  const labels: number[] = [];
  for (const p of protocols) {
    rows.push(oddsFeatures(p, asOf, medianAge));
    labels.push(recordsToken(p) ? 1 : 0);
  }
  const means = new Array(featureCount).fill(0);
  for (let j = 0; j < featureCount; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rows[i][j];
    means[j] = sum / n;
  }
  const sds = new Array(featureCount).fill(0);
  for (let j = 0; j < featureCount; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = rows[i][j] - means[j];
      sum += d * d;
    }
    const sd = Math.sqrt(sum / n);
    sds[j] = sd === 0 || !Number.isFinite(sd) ? 1 : sd;
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < featureCount; j++) {
      rows[i][j] = (rows[i][j] - means[j]) / sds[j];
    }
  }
  const baseRate = labels.reduce((s, v) => s + v, 0) / n;
  const safeBase = Math.min(1 - 1e-6, Math.max(1e-6, baseRate));
  const weights = new Array(featureCount).fill(0);
  let bias = Math.log(safeBase / (1 - safeBase));
  const learningRate = 0.1;
  const iterations = 3000;
  const l2 = 0.02;
  const gradW = new Array(featureCount).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    gradW.fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < featureCount; j++) z += weights[j] * rows[i][j];
      const err = sigmoid(z) - labels[i];
      for (let j = 0; j < featureCount; j++) gradW[j] += err * rows[i][j];
      gradB += err;
    }
    for (let j = 0; j < featureCount; j++) {
      weights[j] -= learningRate * (gradW[j] / n + l2 * weights[j]);
    }
    bias -= learningRate * (gradB / n);
  }
  return { weights, bias, means, sds, baseRate, medianAge };
}

// Launch odds for one protocol: standardise its features with the
// fitted means and scales, dot with the fitted weights, and squash.
// Clamped into [0.001, 0.999] so no protocol is ever certain.
export function oddsOf(p: SnapshotProtocol, model: OddsModel, asOf: string | Date): number {
  const features = oddsFeatures(p, asOf, model.medianAge);
  let logit = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    const scale = model.sds[j] === 0 ? 1 : model.sds[j];
    const centred = (features[j] - model.means[j]) / scale;
    logit += model.weights[j] * centred;
  }
  const probability = sigmoid(logit);
  if (!Number.isFinite(probability)) return 0.001;
  const floored = Math.max(0.001, probability);
  return Math.min(0.999, floored);
}

// Spread of the log10 residuals between live market caps and the curve
// prediction, as a population standard deviation. Too few residuals
// fall back to the pooled spread from the full snapshot.
export function residualSd(live: SnapshotProtocol[], curve: SizeCurve, asOf: string | Date): number {
  const logResiduals: number[] = [];
  for (const protocol of live) {
    const tvlOk = Number.isFinite(protocol.tvl_usd) && protocol.tvl_usd > 0;
    const mcap = protocol.mcap_usd as number;
    const mcapOk = Number.isFinite(mcap) && mcap > 0;
    if (!tvlOk || !mcapOk) continue;
    const predicted =
      protocol.tvl_usd *
      sizeMultiple(protocol.tvl_usd, curve) *
      growthMultiplier(protocol.change_7d) *
      maturityMultiplier(ageDays(asOf, protocol.listed_at));
    if (!Number.isFinite(predicted) || predicted <= 0) continue;
    const ratio = mcap / predicted;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const residual = Math.log10(ratio);
    if (Number.isFinite(residual)) logResiduals.push(residual);
  }
  if (logResiduals.length < 10) return 0.798;
  const count = logResiduals.length;
  let total = 0;
  for (let k = 0; k < count; k++) total += logResiduals[k];
  const centre = total / count;
  let spread = 0;
  for (const residual of logResiduals) {
    const dev = residual - centre;
    spread += dev * dev;
  }
  const sd = Math.sqrt(spread / count);
  if (!Number.isFinite(sd)) return 0.798;
  return sd;
}

// Full implied-value breakdown for one protocol: the launch value,
// the odds-weighted implied value, and the P25-P75 range from the
// residual spread. Without an odds model the odds are taken as one.
export function calculateImpliedValue(
  p: SnapshotProtocol,
  asOf: string | Date,
  curve: SizeCurve,
  oddsModel?: OddsModel,
  residualSdVal?: number,
): FactorBreakdown {
  const tvlUsd = p.tvl_usd;
  const sizePart = sizeMultiple(tvlUsd, curve);
  const growthPart = growthMultiplier(p.change_7d);
  const maturityPart = maturityMultiplier(ageDays(asOf, p.listed_at));
  const launchValue = valueIfLaunches(p, asOf, curve);
  const launchOdds = oddsModel ? oddsOf(p, oddsModel, asOf) : 1;
  const rawImplied = launchValue * launchOdds * 0.75;
  const implied = Math.max(1, Math.round(rawImplied));
  const sigma = residualSdVal ?? 0.798;
  const downFactor = Math.pow(10, -0.6745 * sigma);
  const upFactor = Math.pow(10, 0.6745 * sigma);
  const rangeLo = Math.max(1, Math.round(implied * downFactor));
  const rangeHi = Math.max(rangeLo + 1, Math.round(implied * upFactor));
  const breakdown: FactorBreakdown = {
    tvl: tvlUsd,
    sizeMultiple: sizePart,
    growthMult: growthPart,
    maturityMult: maturityPart,
    valueIfLaunches: launchValue,
    odds: launchOdds,
    implied,
    rangeLo,
    rangeHi,
  };
  return breakdown;
}

// Name-shape filters for the board: versioned names, wrapped/staked
// products, and exchange-branded names are set aside rather than
// ranked. Built with the RegExp constructor so the patterns stay
// readable as plain strings.
const VERSION_RE = new RegExp("\\s(V\\d+(\\.\\d+)?|v\\d+(\\.\\d+)?|\\d+\\.\\d+)$");
const WRAPPED_RE = new RegExp("\\b(?:wrapped|staked|staking)\\b", "i");
const EXCHANGE_RE = new RegExp("^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)");

// Categories the radar never ranks: bridges, liquid staking and
// restaking products, and centralised exchanges.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// A protocol is rankable when it has no token yet, sits outside the
// excluded categories, and its name carries no version marker, no
// wrapped/staked word, and no exchange prefix.
export function rankable(p: SnapshotProtocol): boolean {
  if (recordsToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category as string)) return false;
  if (VERSION_RE.test(p.name)) return false;
  if (WRAPPED_RE.test(p.name)) return false;
  if (EXCHANGE_RE.test(p.name)) return false;
  return true;
}

// Every protocol lands in exactly one ledger bucket: already trading
// a token, rankable, or set aside for a stated reason. The reason
// order below is the precedence: the first match wins.
export function ledgerPartition(protocols: SnapshotProtocol[]): {
  ranked: number;
  tokenTrades: number;
  setAside: Array<{ reason: string; count: number }>;
} {
  const reasonOrder = [
    'category:Bridge',
    'category:Canonical Bridge',
    'category:CEX',
    'category:Liquid Staking',
    'category:Liquid Restaking',
    'category:Restaked BTC',
    'versioned-name',
    'wrapped/staked-word',
    'exchange-name',
  ];
  const reasonOf = (p: SnapshotProtocol): string | null => {
    const cat = p.category;
    if (cat === 'Bridge') return 'category:Bridge';
    if (cat === 'Canonical Bridge') return 'category:Canonical Bridge';
    if (cat === 'CEX') return 'category:CEX';
    if (cat === 'Liquid Staking') return 'category:Liquid Staking';
    if (cat === 'Liquid Restaking') return 'category:Liquid Restaking';
    if (cat === 'Restaked BTC') return 'category:Restaked BTC';
    if (VERSION_RE.test(p.name)) return 'versioned-name';
    if (WRAPPED_RE.test(p.name)) return 'wrapped/staked-word';
    if (EXCHANGE_RE.test(p.name)) return 'exchange-name';
    return null;
  };
  const tallies: Record<string, number> = {};
  for (const reason of reasonOrder) tallies[reason] = 0;
  let rankedCount = 0;
  let tradingCount = 0;
  for (const protocol of protocols) {
    if (recordsToken(protocol)) {
      tradingCount++;
      continue;
    }
    const reason = reasonOf(protocol);
    if (reason === null) {
      rankedCount++;
    } else {
      tallies[reason] += 1;
    }
  }
  const setAside = reasonOrder
    .map((reason) => ({ reason, count: tallies[reason] }))
    .filter((entry) => entry.count > 0);
  return { ranked: rankedCount, tokenTrades: tradingCount, setAside };
}

// Typical cost of one transaction per chain, in dollars, plus the
// default for a chain the table does not list. A farm plan prices
// six transactions plus a bridge hop off Ethereum.
export const FEE_USD_PER_TX: Record<string, number> = {
  'Ethereum': 4.5,
  'Arbitrum': 0.15,
  'Base': 0.05,
  'BSC': 0.15,
  'Solana': 0.02,
  'Optimism': 0.1,
  'Polygon': 0.05,
  'Avalanche': 0.3,
};

// Farming verdict from the net return and the hourly rate: a plan is
// worth farming only when both clear their bars.
function farmVerdict(netUsd: number, netPerHour: number): string {
  const worthIt = netUsd >= 25 && netPerHour >= 10;
  if (worthIt) return 'FARM';
  if (netUsd >= 0) return 'MARGINAL';
  if (netUsd >= -25) return 'THIN';
  return 'SKIP';
}

// The chain a farm plan runs on: the protocol's first listed chain,
// falling back to Ethereum when none is listed.
function primaryChainOf(p: SnapshotProtocol): string {
  const first = p.chains[0];
  if (first) return first;
  return 'Ethereum';
}

// Gas for one farm plan: six transactions at the chain's fee, plus a
// two-dollar bridge hop on every chain except Ethereum.
function farmGas(p: SnapshotProtocol): number {
  const chain = primaryChainOf(p);
  const perTx = FEE_USD_PER_TX[chain] ?? 0.5;
  const bridgeHop = chain === 'Ethereum' ? 0 : 2.0;
  return 6 * perTx + bridgeHop;
}

// One farm plan priced end to end: gas, the expected airdrop slice,
// the T-bill opportunity cost of the deposit, and the net.
function buildFarmPlan(
  p: SnapshotProtocol,
  impliedValueUsd: number,
  depositUsd: number,
  dropShare: number,
  horizonDays: number,
  tbillRate: number,
): FarmEconomics {
  const gasUsd = farmGas(p);
  const rewardUsd = p.tvl_usd > 0 ? impliedValueUsd * dropShare * (depositUsd / p.tvl_usd) : 0;
  const opportunityUsd = (depositUsd * tbillRate * horizonDays) / 365;
  const netUsd = rewardUsd - gasUsd - opportunityUsd;
  const netPerHour = netUsd / 2.7;
  return {
    depositUsd,
    horizonDays,
    dropShare,
    tbillRate,
    gasUsd,
    rewardUsd,
    opportunityUsd,
    netUsd,
    netPerHour,
    verdict: farmVerdict(netUsd, netPerHour),
  };
}

// The standard $1,000 / 90-day / 10% slice plan the board prices.
export function farmEconomics(p: SnapshotProtocol, impliedValueUsd: number): FarmEconomics {
  return buildFarmPlan(p, impliedValueUsd, 1000, 0.1, 90, 0.045);
}

// The same plan repriced for the dashboard's what-if controls.
export function whatIfFarm(
  p: SnapshotProtocol,
  impliedValueUsd: number,
  opts: { depositUsd: number; dropShare: number; horizonDays: number; tbillRate: number },
): FarmEconomics {
  return buildFarmPlan(p, impliedValueUsd, opts.depositUsd, opts.dropShare, opts.horizonDays, opts.tbillRate);
}

// Farm steps are capped at 600 characters so every row's plan fits
// the board's gate, trimming at a word boundary where possible.
function cappedStep(step: string): string {
  const fits = step.length <= 600;
  if (fits) return step;
  const trimmed = step.slice(0, 597).trimEnd();
  return trimmed + '...';
}

// The on-chain action that earns a protocol's points, per category.
// An unknown category falls back to a generic interaction.
const MECHANISM: Record<string, string> = {
  "Lending": "supply a stablecoin or blue-chip asset to the lending market",
  "Dexs": "provide liquidity in a pool on the primary chain",
  "Perps": "open a small margined position",
  "Risk Curators": "deposit into the curator vault",
  "RWA": "mint the tokenised asset",
  "Stablecoin": "mint the stablecoin against collateral",
  "CDP": "open a collateralised debt position",
  "Yield": "deposit into the yield vault",
  "Restaking": "restake through the restaking vault",
  "Staking Pool": "stake into the staking pool",
  "Insurance": "buy cover for a position",
  "Prediction Market": "place a prediction",
  "Governance Incentives": "vote or delegate governance power",
  "Basis Trading": "open a basis trade",
  "Collateral Markets": "post collateral to the market",
  "CeDeFi": "deposit into the CeDeFi vault",
  "Onchain Capital Allocator": "deposit into the allocator vault",
  "Payments": "settle a payment through the protocol",
  "Chain": "use the chain dApps",
  "Derivatives": "open a small derivatives position",
  "Options": "open a small options position",
  "Cross Chain": "bridge assets through the protocol",
  "Gaming": "play through the protocol",
  "Social": "use the protocol's social features",
  "Yield Aggregator": "deposit into the yield aggregator vault",
};

// Six concrete steps to farm one protocol: set up, fund, enter with
// the category's mechanism, hold, monitor weekly, and exit at launch.
// The stake scales with TVL and the hold length with the listing age.
export function generateFarmSteps(p: SnapshotProtocol, asOf: string | Date): string[] {
  const firstChain = p.chains[0];
  const chain = firstChain || 'its main chain';
  let capital = 50;
  if (p.tvl_usd >= 5e9) capital = 250;
  else if (p.tvl_usd >= 1e9) capital = 150;
  else if (p.tvl_usd >= 1e8) capital = 100;
  const categoryKey = p.category ?? '';
  const mechanism = MECHANISM[categoryKey] ?? 'interact with the protocol';
  const protocolAge = ageDays(asOf, p.listed_at);
  let holdDays = 30;
  if (protocolAge !== null && protocolAge > 1095) holdDays = 60;
  else if (protocolAge !== null && protocolAge > 500) holdDays = 45;
  const setupStep = `Set up a dedicated wallet on ${chain}. Cost: nominal gas only. Time: 5-10 minutes.`;
  const fundStep = `Fund the wallet with $${capital}. Cost: $${capital} plus any bridge fee. Time: 10-20 minutes.`;
  const enterStep = `On ${chain}, ${mechanism} with $${capital}. Cost: $${capital} plus gas. Time: 15-30 minutes.`;
  const holdStep = `Hold the position for ${holdDays} days. Cost: opportunity cost of capital. Time: ${holdDays} days.`;
  const watchStep = `Check the position and points weekly on the official ${p.slug} dashboard. Cost: none. Time: a few minutes per week.`;
  const exitStep = 'Withdraw or harvest when the token launches. Cost: exit gas. Time: 10-30 minutes.';
  return [
    cappedStep(setupStep),
    cappedStep(fundStep),
    cappedStep(enterStep),
    cappedStep(holdStep),
    cappedStep(watchStep),
    cappedStep(exitStep),
  ];
}

export interface WalkForwardRow {
  cutoff: string;
  train: number;
  test: number;
  miss: number;
  missFlat: number;
  missNoGrowth: number;
  missNoMaturity: number;
  sd: number;
  holdsPct: number;
}

export interface ValueBacktest {
  cvCurve: number | null;
  cvFlat: number | null;
  looCurve: number | null;
  looFlat: number | null;
  walkForward: WalkForwardRow[];
}

export interface OddsBacktest {
  cvBrier: number;
  holdoutBrier: number;
  baseBrier: number;
  ablations: { dropAge: number; dropCatFlags: number; dropListedNull: number };
}

export interface BootstrapSlope {
  p25: number;
  p75: number;
  n: number;
}

// Predicted market cap for a backtest row: TVL times the fitted
// multiple, growth and seasoning, with switches to flatten the
// multiple or drop a term for the ablation checks.
function predMcap(
  p: SnapshotProtocol,
  curve: SizeCurve,
  asOf: string | Date,
  opts?: { flatMult?: number; noGrowth?: boolean; noMat?: boolean },
): number {
  const multiple = opts?.flatMult ?? sizeMultiple(p.tvl_usd, curve);
  const growth = opts?.noGrowth === true ? 1 : growthMultiplier(p.change_7d);
  const seasoning = opts?.noMat ? 1 : maturityMultiplier(ageDays(asOf, p.listed_at));
  return p.tvl_usd * multiple * growth * seasoning;
}

// Absolute log10 error between a prediction and the realised cap.
function logAbsErr(pred: number, actual: number): number {
  const ratio = pred / actual;
  return Math.abs(Math.log10(ratio));
}

// The single flat multiple for a training set: ten to the median of
// the log10 market-cap/TVL ratios.
function flatMultipleOf(rows: SnapshotProtocol[]): number {
  const ratios = rows.map((r) => Math.log10((r.mcap_usd as number) / r.tvl_usd));
  const middle = median(ratios);
  return Math.pow(10, middle);
}

export function backtestValue(
  live: SnapshotProtocol[],
  asOf: string | Date,
): ValueBacktest {
  if (live.length < 10) {
    return {
      cvCurve: null,
      cvFlat: null,
      looCurve: null,
      looFlat: null,
      walkForward: [],
    };
  }

  const curveErrors: number[] = [];
  const flatErrors: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const train = live.filter((_, i) => i % 5 !== fold);
    const test = live.filter((_, i) => i % 5 === fold);
    const curve = fitSizeCurve(train);
    const flat = flatMultipleOf(train);
    for (const p of test) {
      curveErrors.push(logAbsErr(predMcap(p, curve, asOf), p.mcap_usd as number));
      flatErrors.push(
        logAbsErr(predMcap(p, curve, asOf, { flatMult: flat }), p.mcap_usd as number),
      );
    }
  }
  const cvCurve = Math.pow(10, median(curveErrors));
  const cvFlat = Math.pow(10, median(flatErrors));

  const looCurveErrors: number[] = [];
  const looFlatErrors: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const curve = fitSizeCurve(train);
    const flat = flatMultipleOf(train);
    const p = live[i];
    looCurveErrors.push(logAbsErr(predMcap(p, curve, asOf), p.mcap_usd as number));
    looFlatErrors.push(
      logAbsErr(predMcap(p, curve, asOf, { flatMult: flat }), p.mcap_usd as number),
    );
  }
  const looCurve = Math.pow(10, median(looCurveErrors));
  const looFlat = Math.pow(10, median(looFlatErrors));

  const walkForward: WalkForwardRow[] = [];
  const cutoffs = ["2024-01-01", "2024-07-01", "2025-01-01"];
  for (const cutoff of cutoffs) {
    const train = live.filter(
      (p) => p.listed_at != null && p.listed_at < cutoff,
    );
    const test = live.filter(
      (p) => p.listed_at != null && p.listed_at >= cutoff,
    );
    if (train.length < 10 || test.length < 5) continue;
    const curve = fitSizeCurve(train);
    const flat = flatMultipleOf(train);
    const errs: number[] = [];
    const flatErrs: number[] = [];
    const noGrowthErrs: number[] = [];
    const noMatErrs: number[] = [];
    let holds = 0;
    const sd = residualSd(train, curve, asOf);
    const band = Math.pow(10, 0.6745 * sd);
    for (const p of test) {
      const pred = predMcap(p, curve, asOf);
      errs.push(logAbsErr(pred, p.mcap_usd as number));
      flatErrs.push(
        logAbsErr(predMcap(p, curve, asOf, { flatMult: flat }), p.mcap_usd as number),
      );
      noGrowthErrs.push(
        logAbsErr(predMcap(p, curve, asOf, { noGrowth: true }), p.mcap_usd as number),
      );
      noMatErrs.push(
        logAbsErr(predMcap(p, curve, asOf, { noMat: true }), p.mcap_usd as number),
      );
      if ((p.mcap_usd as number) >= pred / band && (p.mcap_usd as number) <= pred * band) holds++;
    }
    walkForward.push({
      cutoff,
      train: train.length,
      test: test.length,
      miss: Math.pow(10, median(errs)),
      missFlat: Math.pow(10, median(flatErrs)),
      missNoGrowth: Math.pow(10, median(noGrowthErrs)),
      missNoMaturity: Math.pow(10, median(noMatErrs)),
      sd,
      holdsPct: (100 * holds) / test.length,
    });
  }

  return { cvCurve, cvFlat, looCurve, looFlat, walkForward };
}

// Logistic squash for the backtest trainer, same bounds as the
// model's own sigmoid.
function oddsSigmoid(x: number): number {
  if (x > 700) {
    return 1;
  }
  if (x < -700) {
    return 0;
  }
  const exponent = Math.exp(-x);
  return 1 / (1 + exponent);
}

// Token check for the backtest trainer: any of the three signals
// counts as a recorded token.
function oddsRecordsToken(p: SnapshotProtocol): boolean {
  const tokenSignals = [p.mcap_usd, p.gecko_id, p.symbol];
  return tokenSignals.some((signal) => signal !== null);
}

// The same seven features as oddsFeatures, with the arguments in the
// trainer's order (protocol, median age, snapshot date).
function oddsFeaturesOf(p: SnapshotProtocol, medianAge: number, asOf: string | Date): number[] {
  const protocolAge = ageDays(asOf, p.listed_at);
  const age = protocolAge === null ? medianAge : protocolAge;
  const catName = p.category;
  const isDex = catName === 'Dexs' ? 1 : 0;
  const isLending = catName === 'Lending' ? 1 : 0;
  const bridgeLike = catName === 'Bridge' || catName === 'Canonical Bridge' || catName === 'Cross Chain Bridge';
  const stakingLike = catName === 'Liquid Staking' || catName === 'Liquid Restaking' || catName === 'Restaked BTC';
  const isCex = catName === 'CEX' ? 1 : 0;
  const noListedDate = p.listed_at === null ? 1 : 0;
  return [Math.log1p(age), isDex, isLending, bridgeLike ? 1 : 0, stakingLike ? 1 : 0, isCex, noListedDate];
}

function trainOddsWithStats(
  rows: number[][],
  labels: number[],
  means: number[],
  sds: number[],
  baseRate: number,
): { weights: number[]; bias: number } {
  const dim = rows.length > 0 ? rows[0].length : 0;
  const std = rows.map((r) =>
    r.map((v, k) => (sds[k] === 0 ? 0 : (v - means[k]) / sds[k])),
  );
  const weights = new Array(dim).fill(0);
  const safeBase = Math.min(1 - 1e-6, Math.max(1e-6, baseRate));
  let bias = Math.log(safeBase / (1 - safeBase));
  const lr = 0.1;
  const iters = 3000;
  const l2 = 0.02;
  for (let it = 0; it < iters; it++) {
    const gradW = new Array(dim).fill(0);
    let gradB = 0;
    for (let i = 0; i < std.length; i++) {
      let z = bias;
      for (let k = 0; k < dim; k++) z += weights[k] * std[i][k];
      const err = oddsSigmoid(z) - labels[i];
      gradB += err;
      for (let k = 0; k < dim; k++) gradW[k] += err * std[i][k];
    }
    bias -= (lr * gradB) / std.length;
    for (let k = 0; k < dim; k++) {
      weights[k] -= lr * (gradW[k] / std.length + l2 * weights[k]);
    }
  }
  return { weights, bias };
}

export function backtestOdds(
  protocols: SnapshotProtocol[],
  asOf: string | Date,
): OddsBacktest {
  const full = fitOddsModel(protocols, asOf);
  const means = full.means;
  const sds = full.sds;
  const baseRate = full.baseRate;
  const baseBrier = baseRate * (1 - baseRate);
  const medianAge = full.medianAge;

  const labelsAll = protocols.map((p) => (oddsRecordsToken(p) ? 1 : 0));
  const rowsAll = protocols.map((p) => oddsFeaturesOf(p, medianAge, asOf));

  let cvSum = 0;
  let cvCount = 0;
  for (let fold = 0; fold < 5; fold++) {
    const trainIdx: number[] = [];
    const testIdx: number[] = [];
    protocols.forEach((_, i) => (i % 5 === fold ? testIdx.push(i) : trainIdx.push(i)));
    const trainRows = trainIdx.map((i) => rowsAll[i]);
    const trainLabels = trainIdx.map((i) => labelsAll[i]);
    const { weights, bias } = trainOddsWithStats(
      trainRows,
      trainLabels,
      means,
      sds,
      baseRate,
    );
    for (const i of testIdx) {
      const raw = rowsAll[i];
      let z = bias;
      for (let k = 0; k < raw.length; k++) {
        const s = sds[k] === 0 ? 0 : (raw[k] - means[k]) / sds[k];
        z += weights[k] * s;
      }
      const pred = oddsSigmoid(z);
      cvSum += (pred - labelsAll[i]) * (pred - labelsAll[i]);
      cvCount++;
    }
  }
  const cvBrier = cvSum / cvCount;

  const shuffled = protocols.map((_, i) => i);
  const rnd = mulberry32(20261121);
  for (let i = shuffled.length - 1; i >= 1; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const testSize = Math.floor(protocols.length * 0.2);
  const testIdx = shuffled.slice(0, testSize);
  const trainIdx = shuffled.slice(testSize);
  const holdoutModel = trainOddsWithStats(
    trainIdx.map((i) => rowsAll[i]),
    trainIdx.map((i) => labelsAll[i]),
    means,
    sds,
    baseRate,
  );
  let holdoutSum = 0;
  for (const i of testIdx) {
    const raw = rowsAll[i];
    let z = holdoutModel.bias;
    for (let k = 0; k < raw.length; k++) {
      const s = sds[k] === 0 ? 0 : (raw[k] - means[k]) / sds[k];
      z += holdoutModel.weights[k] * s;
    }
    const pred = oddsSigmoid(z);
    holdoutSum += (pred - labelsAll[i]) * (pred - labelsAll[i]);
  }
  const holdoutBrier = holdoutSum / testIdx.length;

  const ablation = (drop: number[]): number => {
    let sum = 0;
    let count = 0;
    for (let fold = 0; fold < 5; fold++) {
      const foldTrainIdx: number[] = [];
      const foldTestIdx: number[] = [];
      protocols.forEach((_, i) => (i % 5 === fold ? foldTestIdx.push(i) : foldTrainIdx.push(i)));
      const kept = rowsAll[0].map((_, k) => k).filter((k) => !drop.includes(k));
      const keptMeans = kept.map((k) => means[k]);
      const keptSds = kept.map((k) => sds[k]);
      const { weights, bias } = trainOddsWithStats(
        foldTrainIdx.map((i) => kept.map((k) => rowsAll[i][k])),
        foldTrainIdx.map((i) => labelsAll[i]),
        keptMeans,
        keptSds,
        baseRate,
      );
      for (const i of foldTestIdx) {
        let z = bias;
        kept.forEach((k, idx) => {
          const s = sds[k] === 0 ? 0 : (rowsAll[i][k] - means[k]) / sds[k];
          z += weights[idx] * s;
        });
        const pred = oddsSigmoid(z);
        sum += (pred - labelsAll[i]) * (pred - labelsAll[i]);
        count++;
      }
    }
    return sum / count;
  };

  const dropAge = ablation([0]);
  const dropCatFlags = ablation([1, 2, 3, 4, 5]);
  const dropListedNull = ablation([6]);

  return {
    cvBrier,
    holdoutBrier,
    baseBrier,
    ablations: { dropAge, dropCatFlags, dropListedNull },
  };
}

// Linear interpolation at a quantile of a sorted sample.
function percentileOf(sorted: number[], q: number): number {
  const position = q * (sorted.length - 1);
  const lowerIdx = Math.floor(position);
  const upperIdx = Math.ceil(position);
  if (lowerIdx === upperIdx) return sorted[lowerIdx];
  const gap = sorted[upperIdx] - sorted[lowerIdx];
  return sorted[lowerIdx] + gap * (position - lowerIdx);
}

// Slope quartiles over 200 bootstrap refits of the size curve, each
// refit on a resample drawn with replacement from the live set. The
// draw order is fixed by the seed, so the quartiles are reproducible.
export function bootstrapSlope(live: SnapshotProtocol[]): BootstrapSlope {
  if (live.length < 10) {
    const fallback: BootstrapSlope = { p25: -0.4777, p75: -0.4777, n: 0 };
    return fallback;
  }
  const draw = mulberry32(20261121);
  const fittedSlopes: number[] = [];
  for (let round = 0; round < 200; round++) {
    const resample: SnapshotProtocol[] = [];
    for (let k = 0; k < live.length; k++) {
      resample.push(live[Math.floor(draw() * live.length)]);
    }
    const refit = fitSizeCurve(resample);
    fittedSlopes.push(refit.slope);
  }
  fittedSlopes.sort((a, b) => a - b);
  const lower = percentileOf(fittedSlopes, 0.25);
  const upper = percentileOf(fittedSlopes, 0.75);
  return { p25: lower, p75: upper, n: 200 };
}
