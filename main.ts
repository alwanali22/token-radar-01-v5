import { fitSizeCurve, fitOddsModel, residualSd, backtestValue, backtestOdds, bootstrapSlope, ledgerPartition, calculateImpliedValue, farmEconomics, generateFarmSteps, ageDays, rankable } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const prefix = `--${name}`;
  for (let i = 2; i < process.argv.length; i++) {
    const value = process.argv[i];
    if (value === prefix) {
      const next = process.argv[i + 1];
      if (next !== undefined) return next;
    }
    if (value.startsWith(prefix + '=')) return value.slice(prefix.length + 1);
  }
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function run(): void {
  const inputArg = arg('input', '/input');
  const inputPath = inputArg.endsWith('snapshot.json') ? inputArg : join(inputArg, 'snapshot.json');
  const outputBase = arg('output', process.env.MAKEFUN_OUTPUT_DIR || '/output');

  if (!existsSync(inputPath)) fail('Error: input not found: ' + inputPath);
  let snapshot: any;
  try {
    snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail('Error: invalid snapshot JSON: ' + message);
  }
  const { protocols, watchlist, as_of } = snapshot;

  const validProtocol = (p: any): boolean =>
    typeof p === 'object' && p !== null &&
    typeof p.slug === 'string' &&
    typeof p.name === 'string' &&
    (typeof p.category === 'string' || p.category === null) &&
    Array.isArray(p.chains) &&
    typeof p.tvl_usd === 'number';
  if (!Array.isArray(protocols) || !Array.isArray(watchlist) || typeof as_of !== 'string' || !protocols.every(validProtocol)) {
    fail('Error: snapshot is missing valid protocols, watchlist, or as_of data');
  }

  const live = protocols.filter((p: any) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const curve = fitSizeCurve(live);
  const oddsModel = fitOddsModel(protocols, as_of);
  const sigma = residualSd(live, curve, as_of);
  const valueBacktest = backtestValue(live, as_of);
  const oddsBacktest = backtestOdds(protocols, as_of);
  const bootstrap = bootstrapSlope(live);
  const ledger = ledgerPartition(protocols);

  const watchlistProtocols = protocols.filter((p: any) => watchlist.includes(p.slug) && rankable(p));
  const otherRankable = protocols.filter((p: any) => !watchlist.includes(p.slug) && rankable(p));
  const excluded = protocols.filter((p: any) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && !rankable(p)).length;

  const allRows = [...watchlistProtocols, ...otherRankable].map((p: any) => {
    const factors = calculateImpliedValue(p, as_of, curve, oddsModel, sigma);
    const econ = farmEconomics(p, factors.implied);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(as_of, p.listed_at),
      watchlist: watchlist.includes(p.slug),
      rank: 0,
      implied_value_usd: factors.implied,
      size_multiple: factors.sizeMultiple,
      growth_mult: factors.growthMult,
      maturity_mult: factors.maturityMult,
      odds: factors.odds,
      value_if_launches: Math.round(factors.valueIfLaunches),
      range_lo: factors.rangeLo,
      range_hi: factors.rangeHi,
      verdict: econ.verdict,
      net_usd: Math.round(econ.netUsd * 100) / 100,
      net_per_hour: Math.round(econ.netPerHour * 100) / 100,
      gas_usd: Math.round(econ.gasUsd * 100) / 100,
      farm_steps: generateFarmSteps(p, as_of)
    };
  }).sort((a: any, b: any) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug)).map((row: any, index: number) => ({ ...row, rank: index + 1 }));

  if (allRows.length < 100) fail('Too few rows: ' + allRows.length);

  const watchlistSlugs = new Set(allRows.filter((r: any) => r.watchlist).map((r: any) => r.slug));
  if (watchlist.length !== 40 || watchlistSlugs.size !== 40 || !watchlist.every((slug: string) => watchlistSlugs.has(slug))) {
    fail('Invalid watchlist coverage: expected 40 of 40');
  }
  if (allRows.some((row: any, index: number) => row.rank !== index + 1)) fail('Invalid ranks');
  for (let i = 0; i < allRows.length - 1; i++) {
    if (allRows[i].implied_value_usd < allRows[i + 1].implied_value_usd) fail('Implied value not monotonic');
  }
  if (allRows.some((row: any) => !Array.isArray(row.farm_steps) || row.farm_steps.length !== 6 || row.farm_steps.some((s: any) => typeof s !== 'string' || s.length < 20 || s.length > 600))) {
    fail('Invalid farm steps');
  }
  if (allRows.some((row: any) => !(row.odds >= 0.001 && row.odds <= 0.999) || !(row.range_lo >= 1) || !(row.range_hi > row.range_lo))) {
    fail('Invalid odds or range');
  }
  if (allRows.some((row: any) => !['FARM', 'MARGINAL', 'THIN', 'SKIP'].includes(row.verdict))) fail('Invalid verdict');
  if (ledger.ranked + ledger.tokenTrades + ledger.setAside.reduce((s: number, r: any) => s + r.count, 0) !== protocols.length) {
    fail('Ledger does not sum to total');
  }

  const liveAll = protocols.filter((p: any) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0).map((p: any) => ({
    slug: p.slug,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    category: p.category
  }));
  const liveProtocols = protocols.filter((p: any) => typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0).sort((a: any, b: any) => b.mcap_usd - a.mcap_usd);
  const liveForData = liveProtocols.slice(0, 24);
  if (liveForData.length !== 24) fail('Live list not 24: ' + liveForData.length);

  const slugs = new Set(allRows.map((r: any) => r.slug));
  if (slugs.size !== allRows.length) fail('Duplicate slugs');

  const verdictCounts: Record<'FARM' | 'MARGINAL' | 'THIN' | 'SKIP', number> = { FARM: 0, MARGINAL: 0, THIN: 0, SKIP: 0 };
  for (const row of allRows) {
    verdictCounts[row.verdict as keyof typeof verdictCounts]++;
  }

  mkdirSync(outputBase, { recursive: true });

  writeFileSync(join(outputBase, 'board.json'), JSON.stringify({ rows: allRows.slice(0, 250) }, null, 2));

  writeFileSync(
    join(outputBase, 'data.js'),
    'window.RADAR = ' +
      JSON.stringify(
        {
          rows: allRows.slice(0, 250),
          live: liveForData,
          liveAll: liveAll,
          model: {
            as_of,
            checksum: fnv1a(JSON.stringify(allRows.slice(0, 250))),
            formula:
              'implied = TVL * sizeMultiple(TVL) * growthMult * maturityMult * odds * 0.75; range = implied x 10^(+-0.6745*sigma)',
            curve: {
              intercept: curve.intercept,
              slope: curve.slope,
              n: curve.n,
              clampMin: curve.clampMin,
              clampMax: curve.clampMax,
            },
            odds: {
              weights: oddsModel.weights,
              bias: oddsModel.bias,
              means: oddsModel.means,
              sds: oddsModel.sds,
              baseRate: oddsModel.baseRate,
              medianAge: oddsModel.medianAge,
              cvBrier: oddsBacktest.cvBrier,
              holdoutBrier: oddsBacktest.holdoutBrier,
              baseBrier: oddsBacktest.baseBrier,
              ablations: oddsBacktest.ablations,
            },
            residualSd: sigma,
            backtest: { value: valueBacktest, odds: oddsBacktest, bootstrap: bootstrap },
            ledger: ledger,
            farmAssumptions: {
              depositUsd: 1000,
              horizonDays: 90,
              dropShare: 0.1,
              tbillRate: 0.045,
              hours: 2.7,
              feeUsdPerTx: {
                Ethereum: 4.5,
                Arbitrum: 0.15,
                Base: 0.05,
                BSC: 0.15,
                Solana: 0.02,
                Optimism: 0.1,
                Polygon: 0.05,
                Avalanche: 0.3,
                default: 0.5,
              },
              bridgeUsd: 2.0,
            },
            verdictCounts: verdictCounts,
          },
          counts: {
            total: protocols.length,
            watchlist: watchlist.length,
            board: allRows.length,
            early: otherRankable.length,
            live: liveForData.length,
            excluded: excluded,
          },
        },
        null,
        2,
      ) +
      ';',
  );

  ['dashboard', 'screenshots'].forEach((dir) => {
    const fromDir = join(here, dir);
    const toDir = join(outputBase, dir);
    mkdirSync(toDir, { recursive: true });
    if (!existsSync(fromDir)) return;
    readdirSync(fromDir).forEach((file) => {
      if (file.startsWith('.')) return;
      const filePath = join(fromDir, file);
      if (statSync(filePath).isFile()) copyFileSync(filePath, join(toDir, file));
    });
  });

  writeFileSync(join(outputBase, 'dossier.json'), buildDossier(outputBase, { text_max_bytes: 65536 }));

  process.stdout.write(
    'rows=' +
      allRows.length +
      ' top=' +
      allRows[0].slug +
      ' implied=' +
      allRows[0].implied_value_usd +
      ' wf2024=' +
      (valueBacktest.walkForward[0] ? valueBacktest.walkForward[0].miss.toFixed(2) : 'n/a') +
      ' brier=' +
      oddsBacktest.cvBrier.toFixed(4) +
      ' holds=' +
      (valueBacktest.walkForward[0] ? valueBacktest.walkForward[0].holdsPct.toFixed(1) : 'n/a') +
      ' farm=' +
      verdictCounts.FARM +
      '\n',
  );
}

run();
