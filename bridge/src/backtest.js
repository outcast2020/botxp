const fs = require("fs");
const path = require("path");
const { config } = require("./config");
const { appendJsonl, ensureDir, writeJson } = require("./store");
const { fetchHistoricalKlines, intervalToMs } = require("./historical-market-data");
const { atrSeries, emaSeries, rsiSeries, smaSeries, stdDevSeries } = require("./indicators");
const { getDayKey, nowIso, roundToStepDown, toNumber } = require("./utils");

function parseTimeInput(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildIndicatorBundle(candles, strategyConfig) {
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const emaFast = emaSeries(closes, strategyConfig.emaFastLen);
  const emaSlow = emaSeries(closes, strategyConfig.emaSlowLen);
  const emaTrend = emaSeries(closes, strategyConfig.emaTrendLen);
  const bbBasis = smaSeries(closes, strategyConfig.bbLen);
  const bbStdDev = stdDevSeries(closes, strategyConfig.bbLen);
  const rsi = rsiSeries(closes, strategyConfig.rsiLen);
  const atr = atrSeries(candles, strategyConfig.atrLen);
  const volumeSma = smaSeries(volumes, config.backtest.volumeLookback);

  return candles.map((candle, index) => {
    const basis = bbBasis[index];
    const deviation = bbStdDev[index];
    const upper = basis != null && deviation != null ? basis + (deviation * strategyConfig.bbDev) : null;
    const lower = basis != null && deviation != null ? basis - (deviation * strategyConfig.bbDev) : null;
    const atrValue = atr[index];
    const fast = emaFast[index];
    const slow = emaSlow[index];
    const trend = emaTrend[index];
    const volumeBasis = volumeSma[index];

    return {
      open: candle.open,
      close: candle.close,
      emaFast: fast,
      emaSlow: slow,
      emaTrend: trend,
      bbBasis: basis,
      bbUpper: upper,
      bbLower: lower,
      rsi: rsi[index],
      atr: atrValue,
      atrPct: atrValue != null && candle.close ? (atrValue / candle.close) * 100 : null,
      fastSlowGapPct: fast != null && slow != null && candle.close ? (Math.abs(fast - slow) / candle.close) * 100 : null,
      slowTrendGapPct: slow != null && trend != null && candle.close ? (Math.abs(slow - trend) / candle.close) * 100 : null,
      volumeSma: volumeBasis,
      volumeRatio: volumeBasis ? candle.volume / volumeBasis : null,
      bodyPct: candle.close ? (Math.abs(candle.close - candle.open) / candle.close) * 100 : null
    };
  });
}

function buildHtfSnapshotMap(oneMinuteCandles, htfCandles, strategyConfig) {
  const closes = htfCandles.map((candle) => candle.close);
  const emaFast = emaSeries(closes, strategyConfig.htfFastLen);
  const emaSlow = emaSeries(closes, strategyConfig.htfSlowLen);
  const emaBase = emaSeries(closes, strategyConfig.htfBaseLen);
  const rsi = rsiSeries(closes, strategyConfig.htfRsiLen);

  const map = new Array(oneMinuteCandles.length).fill(null);
  let htfIndex = -1;

  for (let index = 0; index < oneMinuteCandles.length; index += 1) {
    const candle = oneMinuteCandles[index];
    while (
      htfIndex + 1 < htfCandles.length &&
      htfCandles[htfIndex + 1].closeTime <= candle.closeTime
    ) {
      htfIndex += 1;
    }

    if (htfIndex < 0) continue;

    const close = closes[htfIndex];
    const fast = emaFast[htfIndex];
    const slow = emaSlow[htfIndex];
    const base = emaBase[htfIndex];
    const htfRsi = rsi[htfIndex];

    if ([close, fast, slow, base, htfRsi].some((value) => value == null)) {
      continue;
    }

    const trend =
      close > base && fast > slow && htfRsi > 52
        ? "BULL"
        : close < base && fast < slow && htfRsi < 48
        ? "BEAR"
        : "NEUTRAL";

    map[index] = {
      close,
      fast,
      slow,
      base,
      rsi: htfRsi,
      fastSlowGapPct: close ? (Math.abs(fast - slow) / close) * 100 : null,
      closeBaseGapPct: close ? (Math.abs(close - base) / close) * 100 : null,
      trend
    };
  }

  return map;
}

function createBacktestState() {
  return {
    walletBalance: config.initialCapitalUsdt,
    position: null,
    trades: [],
    equitySeries: [],
    peakEquity: config.initialCapitalUsdt,
    maxDrawdownPct: 0,
    daily: {},
    datasetRows: 0,
    grossProfit: 0,
    grossLoss: 0
  };
}

function getDailyState(state, timestamp) {
  const dayKey = getDayKey(config.timezone, timestamp);
  if (!state.daily[dayKey]) {
    state.daily[dayKey] = {
      entryCount: 0,
      realizedPnl: 0,
      lossesInRow: 0,
      stopActive: false
    };
  }
  return state.daily[dayKey];
}

function calculateUnrealized(position, price) {
  if (!position) return 0;
  if (position.side === "LONG") return (price - position.entryPrice) * position.qty;
  return (position.entryPrice - price) * position.qty;
}

function recordEquityPoint(state, candle, htfTrend) {
  const unrealized = calculateUnrealized(state.position, candle.close);
  const totalEquity = state.walletBalance + unrealized;
  state.peakEquity = Math.max(state.peakEquity, totalEquity);
  const drawdownPct = state.peakEquity ? ((state.peakEquity - totalEquity) / state.peakEquity) * 100 : 0;
  state.maxDrawdownPct = Math.max(state.maxDrawdownPct, drawdownPct);

  state.equitySeries.push({
    timestamp: new Date(candle.closeTime).toISOString(),
    marketRegime: htfTrend,
    totalEquity: Number(totalEquity.toFixed(6)),
    doge_futures_bridge: Number(totalEquity.toFixed(6))
  });
}

function openPosition(state, candle, side, qty, feature, reason) {
  const entryFee = qty * candle.close * config.dryRunFeeRate;
  state.walletBalance -= entryFee;
  state.position = {
    side,
    qty,
    entryPrice: candle.close,
    entryFee,
    leverage: config.defaultLeverage,
    openedAt: candle.closeTime,
    reason,
    activeStop:
      side === "LONG"
        ? candle.close * (1 - (config.strategy.stopLossPct / 100))
        : candle.close * (1 + (config.strategy.stopLossPct / 100)),
    takeProfit:
      side === "LONG"
        ? candle.close * (1 + (config.strategy.takeProfitPct / 100))
        : candle.close * (1 - (config.strategy.takeProfitPct / 100)),
    feature
  };
}

function closePosition(state, candle, exitPrice, reason, feature) {
  if (!state.position) return null;

  const position = state.position;
  const exitFee = position.qty * exitPrice * config.dryRunFeeRate;
  const grossPnl =
    position.side === "LONG"
      ? (exitPrice - position.entryPrice) * position.qty
      : (position.entryPrice - exitPrice) * position.qty;

  state.walletBalance += grossPnl - exitFee;

  const netPnl = grossPnl - position.entryFee - exitFee;
  const marginUsed = (position.entryPrice * position.qty) / position.leverage;
  const trade = {
    tradeId: `${position.side}-${position.openedAt}-${candle.closeTime}`,
    direction: position.side,
    entryTime: new Date(position.openedAt).toISOString(),
    exitTime: new Date(candle.closeTime).toISOString(),
    symbol: config.symbol,
    entryPriceAvg: Number(position.entryPrice.toFixed(6)),
    exitPriceAvg: Number(exitPrice.toFixed(6)),
    qty: Number(position.qty.toFixed(4)),
    leverage: position.leverage,
    grossPnl: Number(grossPnl.toFixed(6)),
    feesTotal: Number((position.entryFee + exitFee).toFixed(6)),
    fundingTotal: 0,
    netPnl: Number(netPnl.toFixed(6)),
    returnOnMarginPct: Number((marginUsed ? (netPnl / marginUsed) * 100 : 0).toFixed(4)),
    durationSec: Math.max(0, Math.round((candle.closeTime - position.openedAt) / 1000)),
    exitReason: reason,
    regimeAtEntry: position.feature.htfTrend,
    regimeAtExit: feature.htfTrend
  };

  state.trades.push(trade);
  if (trade.netPnl >= 0) state.grossProfit += trade.netPnl;
  else state.grossLoss += Math.abs(trade.netPnl);
  state.position = null;
  return trade;
}

function buildFeature(candle, indicator, htf, action) {
  var sessionOpen = isSessionOpen(candle.closeTime);
  return {
    timestamp: new Date(candle.closeTime).toISOString(),
    symbol: config.symbol,
    close: candle.close,
    volume: candle.volume,
    emaFast: Number(indicator.emaFast.toFixed(8)),
    emaSlow: Number(indicator.emaSlow.toFixed(8)),
    emaTrend: Number(indicator.emaTrend.toFixed(8)),
    bbUpper: Number(indicator.bbUpper.toFixed(8)),
    bbLower: Number(indicator.bbLower.toFixed(8)),
    rsi: Number(indicator.rsi.toFixed(4)),
    atrPct: Number(indicator.atrPct.toFixed(4)),
    bodyPct: Number(toNumber(indicator.bodyPct, 0).toFixed(4)),
    volumeRatio: Number(toNumber(indicator.volumeRatio, 0).toFixed(4)),
    fastSlowGapPct: Number(toNumber(indicator.fastSlowGapPct, 0).toFixed(4)),
    slowTrendGapPct: Number(toNumber(indicator.slowTrendGapPct, 0).toFixed(4)),
    htfTrend: htf.trend,
    htfRsi: Number(htf.rsi.toFixed(4)),
    htfFastSlowGapPct: Number(toNumber(htf.fastSlowGapPct, 0).toFixed(4)),
    htfCloseBaseGapPct: Number(toNumber(htf.closeBaseGapPct, 0).toFixed(4)),
    sessionOpen,
    action
  };
}

function writeTrainingSample(state, candle, indicator, htf, candles, index, action) {
  const lookahead = config.backtestDatasetForwardBars;
  const nextClose = candles[index + lookahead] ? candles[index + lookahead].close : null;
  const sample = {
    ...buildFeature(candle, indicator, htf, action),
    nextReturnPct: nextClose ? Number((((nextClose / candle.close) - 1) * 100).toFixed(4)) : null,
    nextMaxHighPct: candles[index + lookahead]
      ? Number((((Math.max(...candles.slice(index + 1, index + lookahead + 1).map((item) => item.high)) / candle.close) - 1) * 100).toFixed(4))
      : null,
    nextMinLowPct: candles[index + lookahead]
      ? Number((((Math.min(...candles.slice(index + 1, index + lookahead + 1).map((item) => item.low)) / candle.close) - 1) * 100).toFixed(4))
      : null
  };

  appendJsonl(config, `${config.backtestOutputPrefix}-training-samples.jsonl`, sample);
  state.datasetRows += 1;
}

function updateTrailingStop(position, candle, indicator, htfTrend) {
  const strategyConfig = config.strategy;

  if (position.side === "LONG") {
    const profitPct = ((candle.close / position.entryPrice) - 1) * 100;
    const breakEvenStop = position.entryPrice * (1 + (strategyConfig.breakEvenLockPct / 100));
    const trailCandidate =
      htfTrend === "BULL"
        ? candle.close - (indicator.atr * strategyConfig.trailAtrAligned)
        : candle.close - (indicator.atr * strategyConfig.trailAtrRisk);

    position.activeStop = Math.max(position.activeStop, position.entryPrice * (1 - (strategyConfig.stopLossPct / 100)));
    if (profitPct >= strategyConfig.breakEvenArmPct) {
      position.activeStop = Math.max(position.activeStop, breakEvenStop);
    }
    if (profitPct >= strategyConfig.trailArmPct) {
      position.activeStop = Math.max(position.activeStop, trailCandidate);
    }
  } else {
    const profitPct = ((position.entryPrice / candle.close) - 1) * 100;
    const breakEvenStop = position.entryPrice * (1 - (strategyConfig.breakEvenLockPct / 100));
    const trailCandidate =
      htfTrend === "BEAR"
        ? candle.close + (indicator.atr * strategyConfig.trailAtrAligned)
        : candle.close + (indicator.atr * strategyConfig.trailAtrRisk);

    position.activeStop = Math.min(position.activeStop, position.entryPrice * (1 + (strategyConfig.stopLossPct / 100)));
    if (profitPct >= strategyConfig.breakEvenArmPct) {
      position.activeStop = Math.min(position.activeStop, breakEvenStop);
    }
    if (profitPct >= strategyConfig.trailArmPct) {
      position.activeStop = Math.min(position.activeStop, trailCandidate);
    }
  }
}

function getHourInTimezone(timestamp) {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "2-digit",
    hour12: false
  }).format(new Date(timestamp)));
}

function isSessionOpen(timestamp) {
  if (config.backtest.sessionFilter === "OFF") {
    return true;
  }

  var hour = getHourInTimezone(timestamp);
  var start = config.backtest.sessionStartHour;
  var end = config.backtest.sessionEndHour;

  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function isSideEnabled(side) {
  var mode = config.backtest.sideMode;
  if (mode === "LONG_ONLY") return side === "LONG";
  if (mode === "SHORT_ONLY") return side === "SHORT";
  return true;
}

function shouldEnterLong(candle, indicator, htf) {
  var bullishCandle = candle.close > candle.open;
  var volumeOk = indicator.volumeRatio == null || indicator.volumeRatio >= config.backtest.minVolumeRatio;
  var bodyOk = indicator.bodyPct == null || indicator.bodyPct >= config.backtest.minBodyPct;
  var ltfGapOk =
    indicator.fastSlowGapPct >= config.backtest.minLtfFastSlowGapPct &&
    indicator.slowTrendGapPct >= config.backtest.minLtfSlowTrendGapPct;
  var htfGapOk =
    htf.fastSlowGapPct >= config.backtest.minHtfFastSlowGapPct &&
    htf.closeBaseGapPct >= config.backtest.minHtfCloseBaseGapPct;

  return (
    isSideEnabled("LONG") &&
    indicator.emaFast > indicator.emaSlow &&
    indicator.emaSlow > indicator.emaTrend &&
    htf.trend === "BULL" &&
    htf.rsi >= config.backtest.minHtfRsiBull &&
    htfGapOk &&
    ltfGapOk &&
    volumeOk &&
    bodyOk &&
    (!config.backtest.requireTrendCandle || bullishCandle) &&
    indicator.atrPct >= config.strategy.minAtrPct &&
    indicator.atrPct <= config.strategy.maxAtrPct &&
    candle.low <= indicator.bbLower * 1.002 &&
    candle.close >= indicator.bbLower &&
    candle.close >= indicator.emaSlow &&
    indicator.rsi <= config.strategy.longOversoldRsi + config.backtest.longRsiBuffer
  );
}

function shouldEnterShort(candle, indicator, htf) {
  var bearishCandle = candle.close < candle.open;
  var volumeOk = indicator.volumeRatio == null || indicator.volumeRatio >= config.backtest.minVolumeRatio;
  var bodyOk = indicator.bodyPct == null || indicator.bodyPct >= config.backtest.minBodyPct;
  var ltfGapOk =
    indicator.fastSlowGapPct >= config.backtest.minLtfFastSlowGapPct &&
    indicator.slowTrendGapPct >= config.backtest.minLtfSlowTrendGapPct;
  var htfGapOk =
    htf.fastSlowGapPct >= config.backtest.minHtfFastSlowGapPct &&
    htf.closeBaseGapPct >= config.backtest.minHtfCloseBaseGapPct;

  return (
    isSideEnabled("SHORT") &&
    indicator.emaFast < indicator.emaSlow &&
    indicator.emaSlow < indicator.emaTrend &&
    htf.trend === "BEAR" &&
    htf.rsi <= config.backtest.maxHtfRsiBear &&
    htfGapOk &&
    ltfGapOk &&
    volumeOk &&
    bodyOk &&
    (!config.backtest.requireTrendCandle || bearishCandle) &&
    indicator.atrPct >= config.strategy.minAtrPct &&
    indicator.atrPct <= config.strategy.maxAtrPct &&
    candle.high >= indicator.bbUpper * 0.998 &&
    candle.close <= indicator.bbUpper &&
    candle.close <= indicator.emaSlow &&
    indicator.rsi >= config.strategy.shortOverboughtRsi - config.backtest.shortRsiBuffer
  );
}

function shouldSkipByRisk(state, timestamp) {
  const daily = getDailyState(state, timestamp);
  return (
    daily.stopActive ||
    daily.entryCount >= config.maxEntriesPerDay ||
    daily.lossesInRow >= config.maxConsecutiveLosses ||
    daily.realizedPnl <= -Math.abs(config.dailyStopLossUsdt)
  );
}

function noteTradeInDaily(state, timestamp, trade) {
  const daily = getDailyState(state, timestamp);
  daily.realizedPnl += trade.netPnl;
  if (trade.netPnl >= 0) {
    daily.lossesInRow = 0;
  } else {
    daily.lossesInRow += 1;
  }
  if (daily.realizedPnl <= -Math.abs(config.dailyStopLossUsdt)) {
    daily.stopActive = true;
  }
}

async function main() {
  ensureDir(config.dataDir);

  const now = Date.now();
  const endTime = parseTimeInput(config.backtestEnd) || now;
  const startTime =
    parseTimeInput(config.backtestStart) ||
    (endTime - (config.backtestLookbackDays * 24 * 60 * 60 * 1000));

  const warmupStart = startTime - (config.backtestWarmupBars * intervalToMs(config.timeframe));
  const htfWarmupStart = startTime - ((config.strategy.htfBaseLen + 20) * intervalToMs(config.htfTimeframe));

  const [ltCandles, htfCandles] = await Promise.all([
    fetchHistoricalKlines({
      baseUrl: config.binanceBaseUrl,
      symbol: config.symbol,
      interval: config.timeframe,
      startTime: warmupStart,
      endTime
    }),
    fetchHistoricalKlines({
      baseUrl: config.binanceBaseUrl,
      symbol: config.symbol,
      interval: config.htfTimeframe,
      startTime: htfWarmupStart,
      endTime
    })
  ]);

  if (!ltCandles.length || !htfCandles.length) {
    throw new Error("Nao foi possivel carregar candles suficientes para o backtest.");
  }

  const indicators = buildIndicatorBundle(ltCandles, config.strategy);
  const htfMap = buildHtfSnapshotMap(ltCandles, htfCandles, config.strategy);
  const state = createBacktestState();

  const outputPrefix = path.join(config.dataDir, config.backtestOutputPrefix);
  fs.writeFileSync(`${outputPrefix}-training-samples.jsonl`, "", "utf8");

  for (let index = 0; index < ltCandles.length; index += 1) {
    const candle = ltCandles[index];
    if (candle.closeTime < startTime) continue;

    const indicator = indicators[index];
    const htf = htfMap[index];
    if (!indicator || !htf) continue;
    if (
      [indicator.emaFast, indicator.emaSlow, indicator.emaTrend, indicator.bbUpper, indicator.bbLower, indicator.rsi, indicator.atrPct]
        .some((value) => value == null)
    ) {
      continue;
    }

    const daily = getDailyState(state, candle.closeTime);
    let action = "NONE";

    if (state.position) {
      updateTrailingStop(state.position, candle, indicator, htf.trend);

      if (state.position.side === "LONG") {
        if (candle.low <= state.position.activeStop) {
          const trade = closePosition(state, candle, state.position.activeStop, "stop_or_trail", buildFeature(candle, indicator, htf, action));
          noteTradeInDaily(state, candle.closeTime, trade);
          action = "FLAT_EXIT";
        } else if (candle.high >= state.position.takeProfit) {
          const trade = closePosition(state, candle, state.position.takeProfit, "take_profit", buildFeature(candle, indicator, htf, action));
          noteTradeInDaily(state, candle.closeTime, trade);
          action = "FLAT_EXIT";
        } else if (candle.close < indicator.emaSlow || htf.trend !== "BULL" || (candle.close >= indicator.bbBasis && indicator.rsi > config.strategy.longExitRsi)) {
          const trade = closePosition(state, candle, candle.close, "momentum_loss", buildFeature(candle, indicator, htf, action));
          noteTradeInDaily(state, candle.closeTime, trade);
          action = "FLAT_EXIT";
        }
      } else if (state.position.side === "SHORT") {
        if (candle.high >= state.position.activeStop) {
          const trade = closePosition(state, candle, state.position.activeStop, "stop_or_trail", buildFeature(candle, indicator, htf, action));
          noteTradeInDaily(state, candle.closeTime, trade);
          action = "FLAT_EXIT";
        } else if (candle.low <= state.position.takeProfit) {
          const trade = closePosition(state, candle, state.position.takeProfit, "take_profit", buildFeature(candle, indicator, htf, action));
          noteTradeInDaily(state, candle.closeTime, trade);
          action = "FLAT_EXIT";
        } else if (candle.close > indicator.emaSlow || htf.trend !== "BEAR" || (candle.close <= indicator.bbBasis && indicator.rsi < config.strategy.shortExitRsi)) {
          const trade = closePosition(state, candle, candle.close, "momentum_loss", buildFeature(candle, indicator, htf, action));
          noteTradeInDaily(state, candle.closeTime, trade);
          action = "FLAT_EXIT";
        }
      }
    }

    if (!state.position && !shouldSkipByRisk(state, candle.closeTime) && isSessionOpen(candle.closeTime)) {
      if (shouldEnterLong(candle, indicator, htf)) {
        const qty = roundToStepDown((config.orderBudgetUsdt * config.defaultLeverage) / candle.close, 1);
        if (qty >= 1) {
          openPosition(state, candle, "LONG", qty, buildFeature(candle, indicator, htf, "LONG_ENTRY"), "long_dip_reclaim");
          daily.entryCount += 1;
          action = "LONG_ENTRY";
        }
      } else if (shouldEnterShort(candle, indicator, htf)) {
        const qty = roundToStepDown((config.orderBudgetUsdt * config.defaultLeverage) / candle.close, 1);
        if (qty >= 1) {
          openPosition(state, candle, "SHORT", qty, buildFeature(candle, indicator, htf, "SHORT_ENTRY"), "short_spike_fade");
          daily.entryCount += 1;
          action = "SHORT_ENTRY";
        }
      }
    }

    writeTrainingSample(state, candle, indicator, htf, ltCandles, index, action);
    recordEquityPoint(state, candle, htf.trend);
  }

  if (state.position) {
    const lastCandle = ltCandles[ltCandles.length - 1];
    const lastIndicator = indicators[indicators.length - 1];
    const lastHtf = htfMap[htfMap.length - 1];
    const trade = closePosition(state, lastCandle, lastCandle.close, "end_of_test", buildFeature(lastCandle, lastIndicator, lastHtf, "FLAT_EXIT"));
    noteTradeInDaily(state, lastCandle.closeTime, trade);
    recordEquityPoint(state, lastCandle, lastHtf.trend);
  }

  const finalEquity = state.equitySeries.length
    ? state.equitySeries[state.equitySeries.length - 1].totalEquity
    : state.walletBalance;
  const winCount = state.trades.filter((trade) => trade.netPnl >= 0).length;
  const report = {
    generatedAt: nowIso(),
    mode: "backtest",
    symbol: config.symbol,
    timeframe: config.timeframe,
    htfTimeframe: config.htfTimeframe,
    filters: {
      sideMode: config.backtest.sideMode,
      sessionFilter: config.backtest.sessionFilter,
      sessionStartHour: config.backtest.sessionStartHour,
      sessionEndHour: config.backtest.sessionEndHour,
      minVolumeRatio: config.backtest.minVolumeRatio,
      minBodyPct: config.backtest.minBodyPct,
      minHtfFastSlowGapPct: config.backtest.minHtfFastSlowGapPct,
      minHtfCloseBaseGapPct: config.backtest.minHtfCloseBaseGapPct,
      minLtfFastSlowGapPct: config.backtest.minLtfFastSlowGapPct,
      minLtfSlowTrendGapPct: config.backtest.minLtfSlowTrendGapPct
    },
    range: {
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString()
    },
    capital: {
      initial: config.initialCapitalUsdt,
      final: Number(finalEquity.toFixed(4)),
      pnl: Number((finalEquity - config.initialCapitalUsdt).toFixed(4)),
      pnlPercent: Number((((finalEquity / config.initialCapitalUsdt) - 1) * 100).toFixed(2))
    },
    trades: {
      total: state.trades.length,
      wins: winCount,
      losses: state.trades.length - winCount,
      winRate: Number((state.trades.length ? winCount / state.trades.length : 0).toFixed(4)),
      profitFactor: Number((state.grossLoss ? state.grossProfit / state.grossLoss : state.grossProfit).toFixed(4))
    },
    risk: {
      maxDrawdownPct: Number(state.maxDrawdownPct.toFixed(2))
    },
    outputs: {
      reportFile: `${outputPrefix}-report.json`,
      tradesFile: `${outputPrefix}-trades.json`,
      equityFile: `${outputPrefix}-equity.json`,
      samplesFile: `${outputPrefix}-training-samples.jsonl`,
      trainingRows: state.datasetRows
    }
  };

  writeJson(`${outputPrefix}-report.json`, report);
  writeJson(`${outputPrefix}-trades.json`, state.trades);
  writeJson(`${outputPrefix}-equity.json`, state.equitySeries);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[backtest] falha:", error);
  process.exitCode = 1;
});
