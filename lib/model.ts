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

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateTimeValue(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  return Date.parse(value);
}

export function ageDays(asOf: string | Date, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = dateTimeValue(asOf);
  const start = Date.parse(listedAt);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.floor((end - start) / 86400000);
  return days < 0 ? 0 : days;
}

export function fitSizeCurve(live: SnapshotProtocol[]): SizeCurve {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of live) {
    if (Number.isFinite(p.tvl_usd) && p.tvl_usd > 0 && Number.isFinite(p.mcap_usd) && (p.mcap_usd as number) > 0) {
      const x = Math.log10(p.tvl_usd);
      const y = Math.log10((p.mcap_usd as number) / p.tvl_usd);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  const n = xs.length;
  if (n < 10) {
    return { intercept: 3.0247, slope: -0.4777, n, clampMin: 0.02, clampMax: 0.8 };
  }
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    covariance += dx * (ys[i] - yMean);
    variance += dx * dx;
  }
  if (!(variance > 0)) {
    return { intercept: 3.0247, slope: -0.4777, n, clampMin: 0.02, clampMax: 0.8 };
  }
  const slope = covariance / variance;
  const intercept = yMean - slope * xMean;
  if (!Number.isFinite(intercept) || !Number.isFinite(slope)) {
    return { intercept: 3.0247, slope: -0.4777, n, clampMin: 0.02, clampMax: 0.8 };
  }
  return { intercept, slope, n, clampMin: 0.02, clampMax: 0.8 };
}

export function sizeMultiple(tvl: number, curve: SizeCurve): number {
  if (!Number.isFinite(tvl) || tvl <= 0) return curve.clampMin;
  const raw = Math.pow(10, curve.intercept + curve.slope * Math.log10(tvl));
  if (Number.isNaN(raw)) return curve.clampMin;
  return Math.min(curve.clampMax, Math.max(curve.clampMin, raw));
}

export function growthMultiplier(change7d: number | null): number {
  const change = change7d === null || !Number.isFinite(change7d) ? 0 : change7d;
  const clamped = Math.max(-30, Math.min(30, change));
  return 1 + clamped / 100;
}

export function maturityMultiplier(ageDaysVal: number | null): number {
  const age = ageDaysVal === null || !Number.isFinite(ageDaysVal) ? 365 : ageDaysVal;
  const capped = Math.min(Math.max(age, 0), 1095);
  return 0.7 + (0.3 * capped) / 1095;
}

export function valueIfLaunches(p: SnapshotProtocol, asOf: string | Date, curve: SizeCurve): number {
  if (!Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) return 1;
  const value =
    p.tvl_usd *
    sizeMultiple(p.tvl_usd, curve) *
    growthMultiplier(p.change_7d) *
    maturityMultiplier(ageDays(asOf, p.listed_at));
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, value);
}

function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

function sigmoid(z: number): number {
  if (z > 700) return 1;
  if (z < -700) return 0;
  return 1 / (1 + Math.exp(-z));
}

function oddsFeatures(p: SnapshotProtocol, asOf: string | Date, medianAge: number): number[] {
  const rawAge = ageDays(asOf, p.listed_at);
  const age = rawAge === null ? medianAge : rawAge;
  const category = p.category;
  return [
    Math.log1p(age),
    category === 'Dexs' ? 1 : 0,
    category === 'Lending' ? 1 : 0,
    category === 'Bridge' || category === 'Canonical Bridge' || category === 'Cross Chain Bridge' ? 1 : 0,
    category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaked BTC' ? 1 : 0,
    category === 'CEX' ? 1 : 0,
    p.listed_at === null ? 1 : 0,
  ];
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

export function oddsOf(p: SnapshotProtocol, model: OddsModel, asOf: string | Date): number {
  const raw = oddsFeatures(p, asOf, model.medianAge);
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    const sd = model.sds[j] === 0 ? 1 : model.sds[j];
    const standard = (raw[j] - model.means[j]) / sd;
    z += model.weights[j] * standard;
  }
  const value = sigmoid(z);
  if (!Number.isFinite(value)) return 0.001;
  return Math.min(0.999, Math.max(0.001, value));
}

export function residualSd(live: SnapshotProtocol[], curve: SizeCurve, asOf: string | Date): number {
  const residuals: number[] = [];
  for (const p of live) {
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) continue;
    if (!Number.isFinite(p.mcap_usd) || (p.mcap_usd as number) <= 0) continue;
    const pred =
      p.tvl_usd *
      sizeMultiple(p.tvl_usd, curve) *
      growthMultiplier(p.change_7d) *
      maturityMultiplier(ageDays(asOf, p.listed_at));
    if (!Number.isFinite(pred) || pred <= 0) continue;
    const ratio = (p.mcap_usd as number) / pred;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const residual = Math.log10(ratio);
    if (Number.isFinite(residual)) residuals.push(residual);
  }
  if (residuals.length < 10) return 0.798;
  const n = residuals.length;
  const mean = residuals.reduce((s, v) => s + v, 0) / n;
  let variance = 0;
  for (const r of residuals) {
    const d = r - mean;
    variance += d * d;
  }
  const sd = Math.sqrt(variance / n);
  return Number.isFinite(sd) ? sd : 0.798;
}

export function calculateImpliedValue(
  p: SnapshotProtocol,
  asOf: string | Date,
  curve: SizeCurve,
  oddsModel?: OddsModel,
  residualSdVal?: number,
): FactorBreakdown {
  const tvl = p.tvl_usd;
  const sm = sizeMultiple(tvl, curve);
  const gm = growthMultiplier(p.change_7d);
  const mm = maturityMultiplier(ageDays(asOf, p.listed_at));
  const value = valueIfLaunches(p, asOf, curve);
  const odds = oddsModel ? oddsOf(p, oddsModel, asOf) : 1;
  const implied = Math.max(1, Math.round(value * odds * 0.75));
  const sigma = residualSdVal ?? 0.798;
  const rangeLo = Math.max(1, Math.round(implied * Math.pow(10, -0.6745 * sigma)));
  const rangeHi = Math.max(rangeLo + 1, Math.round(implied * Math.pow(10, 0.6745 * sigma)));
  return {
    tvl,
    sizeMultiple: sm,
    growthMult: gm,
    maturityMult: mm,
    valueIfLaunches: value,
    odds,
    implied,
    rangeLo,
    rangeHi,
  };
}

const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(?:wrapped|staked|staking)\b/i;
const EXCHANGE_RE = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

export function rankable(p: SnapshotProtocol): boolean {
  if (recordsToken(p)) return false;
  if (
    p.category === 'Bridge' ||
    p.category === 'Canonical Bridge' ||
    p.category === 'Liquid Staking' ||
    p.category === 'Liquid Restaking' ||
    p.category === 'Restaked BTC' ||
    p.category === 'CEX'
  ) {
    return false;
  }
  if (VERSION_RE.test(p.name)) return false;
  if (WRAPPED_RE.test(p.name)) return false;
  if (EXCHANGE_RE.test(p.name)) return false;
  return true;
}

export function ledgerPartition(protocols: SnapshotProtocol[]): {
  ranked: number;
  tokenTrades: number;
  setAside: Array<{ reason: string; count: number }>;
} {
  const order = [
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
  const counts = new Map<string, number>();
  for (const reason of order) counts.set(reason, 0);
  let ranked = 0;
  let tokenTrades = 0;
  for (const p of protocols) {
    if (recordsToken(p)) {
      tokenTrades++;
      continue;
    }
    let reason: string | null = null;
    if (p.category === 'Bridge') reason = 'category:Bridge';
    else if (p.category === 'Canonical Bridge') reason = 'category:Canonical Bridge';
    else if (p.category === 'CEX') reason = 'category:CEX';
    else if (p.category === 'Liquid Staking') reason = 'category:Liquid Staking';
    else if (p.category === 'Liquid Restaking') reason = 'category:Liquid Restaking';
    else if (p.category === 'Restaked BTC') reason = 'category:Restaked BTC';
    else if (VERSION_RE.test(p.name)) reason = 'versioned-name';
    else if (WRAPPED_RE.test(p.name)) reason = 'wrapped/staked-word';
    else if (EXCHANGE_RE.test(p.name)) reason = 'exchange-name';
    if (reason === null) {
      ranked++;
    } else {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  const setAside = order
    .map((reason) => ({ reason, count: counts.get(reason) ?? 0 }))
    .filter((r) => r.count > 0);
  return { ranked, tokenTrades, setAside };
}

export const FEE_USD_PER_TX: Record<string, number> = {
  Ethereum: 4.5,
  Arbitrum: 0.15,
  Base: 0.05,
  BSC: 0.15,
  Solana: 0.02,
  Optimism: 0.1,
  Polygon: 0.05,
  Avalanche: 0.3,
};

function farmVerdict(netUsd: number, netPerHour: number): string {
  if (netUsd >= 25 && netPerHour >= 10) return 'FARM';
  if (netUsd >= 0) return 'MARGINAL';
  if (netUsd >= -25) return 'THIN';
  return 'SKIP';
}

function primaryChainOf(p: SnapshotProtocol): string {
  return p.chains[0] || 'Ethereum';
}

function farmGas(p: SnapshotProtocol): number {
  const chain = primaryChainOf(p);
  const fee = FEE_USD_PER_TX[chain] ?? 0.5;
  return 6 * fee + (chain === 'Ethereum' ? 0 : 2.0);
}

export function farmEconomics(p: SnapshotProtocol, impliedValueUsd: number): FarmEconomics {
  const depositUsd = 1000;
  const horizonDays = 90;
  const dropShare = 0.1;
  const tbillRate = 0.045;
  const gasUsd = farmGas(p);
  const rewardUsd = p.tvl_usd > 0 ? impliedValueUsd * 0.1 * (1000 / p.tvl_usd) : 0;
  const opportunityUsd = (1000 * 0.045 * 90) / 365;
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

export function whatIfFarm(
  p: SnapshotProtocol,
  impliedValueUsd: number,
  opts: { depositUsd: number; dropShare: number; horizonDays: number; tbillRate: number },
): FarmEconomics {
  const gasUsd = farmGas(p);
  const rewardUsd = p.tvl_usd > 0 ? impliedValueUsd * opts.dropShare * (opts.depositUsd / p.tvl_usd) : 0;
  const opportunityUsd = (opts.depositUsd * opts.tbillRate * opts.horizonDays) / 365;
  const netUsd = rewardUsd - gasUsd - opportunityUsd;
  const netPerHour = netUsd / 2.7;
  return {
    depositUsd: opts.depositUsd,
    horizonDays: opts.horizonDays,
    dropShare: opts.dropShare,
    tbillRate: opts.tbillRate,
    gasUsd,
    rewardUsd,
    opportunityUsd,
    netUsd,
    netPerHour,
    verdict: farmVerdict(netUsd, netPerHour),
  };
}

function cappedStep(step: string): string {
  if (step.length <= 600) return step;
  return step.slice(0, 597).trimEnd() + '...';
}

const MECHANISM: Record<string, string> = {
  Lending: 'supply a stablecoin or blue-chip asset to the lending market',
  Dexs: 'provide liquidity in a pool on the primary chain',
  Perps: 'open a small margined position',
  'Risk Curators': 'deposit into the curator vault',
  RWA: 'mint the tokenised asset',
  Stablecoin: 'mint the stablecoin against collateral',
  CDP: 'open a collateralised debt position',
  Yield: 'deposit into the yield vault',
  Restaking: 'restake through the restaking vault',
  'Staking Pool': 'stake into the staking pool',
  Insurance: 'buy cover for a position',
  'Prediction Market': 'place a prediction',
  'Governance Incentives': 'vote or delegate governance power',
  'Basis Trading': 'open a basis trade',
  'Collateral Markets': 'post collateral to the market',
  CeDeFi: 'deposit into the CeDeFi vault',
  'Onchain Capital Allocator': 'deposit into the allocator vault',
  Payments: 'settle a payment through the protocol',
  Chain: 'use the chain dApps',
  Derivatives: 'open a small derivatives position',
  Options: 'open a small options position',
  'Cross Chain': 'bridge assets through the protocol',
  Gaming: 'play through the protocol',
  Social: "use the protocol's social features",
  'Yield Aggregator': 'deposit into the yield aggregator vault',
};

export function generateFarmSteps(p: SnapshotProtocol, asOf: string | Date): string[] {
  const chain = p.chains[0] || 'its main chain';
  const capital = p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
  const mechanism = MECHANISM[p.category ?? ''] ?? 'interact with the protocol';
  const age = ageDays(asOf, p.listed_at);
  const holdDays = age !== null && age > 1095 ? 60 : age !== null && age > 500 ? 45 : 30;
  return [
    cappedStep(`Set up a dedicated wallet on ${chain}. Cost: nominal gas only. Time: 5-10 minutes.`),
    cappedStep(`Fund the wallet with $${capital}. Cost: $${capital} plus any bridge fee. Time: 10-20 minutes.`),
    cappedStep(`On ${chain}, ${mechanism} with $${capital}. Cost: $${capital} plus gas. Time: 15-30 minutes.`),
    cappedStep(`Hold the position for ${holdDays} days. Cost: opportunity cost of capital. Time: ${holdDays} days.`),
    cappedStep(`Check the position and points weekly on the official ${p.slug} dashboard. Cost: none. Time: a few minutes per week.`),
    cappedStep('Withdraw or harvest when the token launches. Cost: exit gas. Time: 10-30 minutes.'),
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

function predMcap(
  p: SnapshotProtocol,
  curve: SizeCurve,
  asOf: string | Date,
  opts?: { flatMult?: number; noGrowth?: boolean; noMat?: boolean },
): number {
  const mult = opts?.flatMult ?? sizeMultiple(p.tvl_usd, curve);
  const growth = opts?.noGrowth ? 1 : growthMultiplier(p.change_7d);
  const mat = opts?.noMat ? 1 : maturityMultiplier(ageDays(asOf, p.listed_at));
  return p.tvl_usd * mult * growth * mat;
}

function logAbsErr(pred: number, actual: number): number {
  return Math.abs(Math.log10(pred / actual));
}

function flatMultipleOf(rows: SnapshotProtocol[]): number {
  return Math.pow(10, median(rows.map((r) => Math.log10((r.mcap_usd as number) / r.tvl_usd))));
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

function oddsSigmoid(x: number): number {
  if (x > 700) return 1;
  if (x < -700) return 0;
  return 1 / (1 + Math.exp(-x));
}

function oddsRecordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

function oddsFeaturesOf(p: SnapshotProtocol, medianAge: number, asOf: string | Date): number[] {
  const rawAge = ageDays(asOf, p.listed_at);
  const age = rawAge === null ? medianAge : rawAge;
  const category = p.category;
  return [
    Math.log1p(age),
    category === 'Dexs' ? 1 : 0,
    category === 'Lending' ? 1 : 0,
    category === 'Bridge' || category === 'Canonical Bridge' || category === 'Cross Chain Bridge' ? 1 : 0,
    category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaked BTC' ? 1 : 0,
    category === 'CEX' ? 1 : 0,
    p.listed_at === null ? 1 : 0,
  ];
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

function percentileOf(sorted: number[], q: number): number {
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function bootstrapSlope(live: SnapshotProtocol[]): BootstrapSlope {
  if (live.length < 10) {
    return { p25: -0.4777, p75: -0.4777, n: 0 };
  }
  const rnd = mulberry32(20261121);
  const slopes: number[] = [];
  for (let b = 0; b < 200; b++) {
    const resample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) {
      resample.push(live[Math.floor(rnd() * live.length)]);
    }
    const curve = fitSizeCurve(resample);
    slopes.push(curve.slope);
  }
  slopes.sort((a, b) => a - b);
  return { p25: percentileOf(slopes, 0.25), p75: percentileOf(slopes, 0.75), n: 200 };
}
