var CONFIG = {
  symbol: "DOGEUSDT",
  interval: "5m",
  defaultBridgeSpreadsheetId: "1J2zlPKwbgZCYkLEh6eCN4PLjLChUmyrxDPElwpSVzsQ",
  marketDataBaseUrls: [
    "https://data-api.binance.vision",
    "https://api-gcp.binance.com",
    "https://api.binance.com"
  ],
  candleLimit: 180,
  atrLookback: 14,
  fastEma: 9,
  slowEma: 21,
  rangeLookback: 20,
  shockLookback: 3,
  initialCapitalPerBot: 1000,
  orderNotionalPct: 0.10,
  feeRate: 0.0004,
  slippageRate: 0.0003,
  takeProfitPct: 0.004,
  stopLossPct: 0.003,
  maxEquityPoints: 500,
  maxTradesStored: 200,
  botKeys: ["micro_reversal", "short_trend", "range_strategy"]
};

var STATE_KEYS = {
  runtime: "paper_trading_runtime_state",
  status: "paper_trading_status_payload",
  equity: "paper_trading_equity_payload",
  spreadsheetId: "paper_trading_spreadsheet_id",
  bridgeRuntime: "paper_trading_bridge_runtime_payload",
  bridgeSyncToken: "paper_trading_bridge_sync_token"
};

function mean(values) {
  if (!values || !values.length) return 0;
  var sum = values.reduce(function(acc, value) { return acc + value; }, 0);
  return sum / values.length;
}

function last(values) {
  return values[values.length - 1];
}

function roundNumber(value, precision) {
  var factor = Math.pow(10, precision || 2);
  return Math.round(value * factor) / factor;
}

function pctChange(current, base) {
  if (!base) return 0;
  return current / base - 1;
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  var multiplier = 2 / (period + 1);
  var seed = mean(values.slice(0, period));
  var series = [seed];

  for (var i = period; i < values.length; i += 1) {
    var next = (values[i] - series[series.length - 1]) * multiplier + series[series.length - 1];
    series.push(next);
  }

  return series;
}

function trueRange(current, prevClose) {
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - prevClose),
    Math.abs(current.low - prevClose)
  );
}

function atrSeries(candles, period) {
  if (candles.length < period + 1) return [];
  var ranges = [];

  for (var i = 1; i < candles.length; i += 1) {
    ranges.push(trueRange(candles[i], candles[i - 1].close));
  }

  if (ranges.length < period) return [];

  var output = [];
  var seed = mean(ranges.slice(0, period));
  output.push(seed);

  for (var j = period; j < ranges.length; j += 1) {
    var next = ((output[output.length - 1] * (period - 1)) + ranges[j]) / period;
    output.push(next);
  }

  return output;
}

function slopeFromTail(values, length) {
  if (!values.length) return 0;
  var slice = values.slice(Math.max(0, values.length - length));
  if (slice.length < 2) return 0;
  return pctChange(slice[slice.length - 1], slice[0]);
}

function fetchClosedKlines(symbol, interval, limit) {
  var lastError = null;

  for (var i = 0; i < CONFIG.marketDataBaseUrls.length; i += 1) {
    var baseUrl = CONFIG.marketDataBaseUrls[i];
    var url =
      baseUrl +
      "/api/v3/klines?symbol=" +
      encodeURIComponent(symbol) +
      "&interval=" +
      encodeURIComponent(interval) +
      "&limit=" +
      encodeURIComponent(limit);

    var response = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code === 200) {
      var rows = JSON.parse(response.getContentText());
      var now = Date.now();

      return rows
        .map(function(row) {
          return {
            openTime: Number(row[0]),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
            closeTime: Number(row[6])
          };
        })
        .filter(function(candle) {
          return candle.closeTime <= now;
        });
    }

    lastError = "Base " + baseUrl + " returned HTTP " + code + ": " + response.getContentText();

    if (code !== 451) {
      break;
    }
  }

  throw new Error(
    "Binance market data unavailable for this Apps Script origin. " +
    "Tried: " + CONFIG.marketDataBaseUrls.join(", ") + ". " +
    "Last error: " + lastError + ". " +
    "If this persists, the practical workaround is to fetch Binance data outside Apps Script and pass snapshots into Apps Script."
  );
}

function buildIndicators(candles) {
  var closes = candles.map(function(candle) { return candle.close; });
  var highs = candles.map(function(candle) { return candle.high; });
  var lows = candles.map(function(candle) { return candle.low; });
  var volumes = candles.map(function(candle) { return candle.volume; });

  var emaFastSeries = emaSeries(closes, CONFIG.fastEma);
  var emaSlowSeries = emaSeries(closes, CONFIG.slowEma);
  var atrValues = atrSeries(candles, CONFIG.atrLookback);
  var recentRangeCandles = candles.slice(-CONFIG.rangeLookback);
  var rangeHigh = Math.max.apply(null, recentRangeCandles.map(function(candle) { return candle.high; }));
  var rangeLow = Math.min.apply(null, recentRangeCandles.map(function(candle) { return candle.low; }));
  var price = last(closes);

  return {
    price: price,
    closes: closes,
    highs: highs,
    lows: lows,
    volumes: volumes,
    emaFast: last(emaFastSeries),
    emaSlow: last(emaSlowSeries),
    emaFastSlope: slopeFromTail(emaFastSeries, 4),
    emaSlowSlope: slopeFromTail(emaSlowSeries, 4),
    atr: last(atrValues),
    atrPct: last(atrValues) ? last(atrValues) / price : 0,
    rangeHigh: rangeHigh,
    rangeLow: rangeLow,
    rangeWidthPct: pctChange(rangeHigh, rangeLow),
    lastShockPct: pctChange(price, closes[Math.max(0, closes.length - 1 - CONFIG.shockLookback)]),
    lastVolume: last(volumes),
    avgVolume: mean(volumes.slice(-20))
  };
}

function classifyMarketRegime(indicators) {
  var emaDistancePct = indicators.emaFast && indicators.emaSlow
    ? Math.abs(indicators.emaFast - indicators.emaSlow) / indicators.price
    : 0;

  var trendScore = 0;
  var rangeScore = 0;
  var chaosScore = 0;

  if (emaDistancePct > 0.002) trendScore += 1;
  if (Math.abs(indicators.emaSlowSlope) > 0.0015) trendScore += 1;
  if (indicators.atrPct > 0.0012 && indicators.atrPct < 0.01) trendScore += 1;

  if (emaDistancePct < 0.0015) rangeScore += 1;
  if (Math.abs(indicators.emaSlowSlope) < 0.0008) rangeScore += 1;
  if (indicators.rangeWidthPct < 0.015) rangeScore += 1;

  if (indicators.atrPct > 0.012) chaosScore += 1;
  if (Math.abs(indicators.lastShockPct) > 0.01) chaosScore += 1;
  if (indicators.rangeWidthPct > 0.03) chaosScore += 1;

  var regime = "CHAOS";
  if (chaosScore >= 2) regime = "CHAOS";
  else if (trendScore >= 2 && trendScore > rangeScore) regime = "TREND";
  else if (rangeScore >= 2) regime = "RANGE";

  return {
    regime: regime,
    preferredStrategy: regime === "TREND"
      ? "short_trend"
      : regime === "RANGE"
      ? "range_strategy"
      : "none",
    trendBias: indicators.emaFast >= indicators.emaSlow ? "LONG" : "SHORT",
    scores: {
      trend: trendScore,
      range: rangeScore,
      chaos: chaosScore
    }
  };
}

function microReversalSignal(context, bot) {
  var indicators = context.indicators;
  var shock = indicators.lastShockPct;
  var volumeHot = indicators.lastVolume > indicators.avgVolume * 1.15;

  if (context.regime.regime === "CHAOS") {
    return bot.position ? { action: "EXIT", reason: "chaos_exit" } : { action: "HOLD" };
  }

  if (!bot.position) {
    if ((context.regime.regime === "RANGE" || context.regime.regime === "TREND") && shock <= -0.006 && volumeHot) {
      return { action: "ENTER_LONG", reason: "down_shock_reversal" };
    }

    if ((context.regime.regime === "RANGE" || context.regime.regime === "TREND") && shock >= 0.006 && volumeHot) {
      return { action: "ENTER_SHORT", reason: "up_shock_reversal" };
    }
  }

  return { action: "HOLD" };
}

function shortTrendSignal(context, bot) {
  var indicators = context.indicators;
  var price = indicators.price;
  var emaFast = indicators.emaFast;
  var emaSlow = indicators.emaSlow;

  if (context.regime.regime !== "TREND") {
    return bot.position ? { action: "EXIT", reason: "trend_lost" } : { action: "HOLD" };
  }

  if (!bot.position && emaFast > emaSlow && price > emaFast) {
    return { action: "ENTER_LONG", reason: "trend_follow_long" };
  }

  if (!bot.position && emaFast < emaSlow && price < emaFast) {
    return { action: "ENTER_SHORT", reason: "trend_follow_short" };
  }

  if (bot.position && bot.position.side === "LONG" && price < emaFast) {
    return { action: "EXIT", reason: "momentum_loss_long" };
  }

  if (bot.position && bot.position.side === "SHORT" && price > emaFast) {
    return { action: "EXIT", reason: "momentum_loss_short" };
  }

  return { action: "HOLD" };
}

function rangeStrategySignal(context, bot) {
  var indicators = context.indicators;
  var price = indicators.price;
  var lowBand = indicators.rangeLow * 1.002;
  var highBand = indicators.rangeHigh * 0.998;

  if (context.regime.regime !== "RANGE") {
    return bot.position ? { action: "EXIT", reason: "range_lost" } : { action: "HOLD" };
  }

  if (!bot.position && price <= lowBand) {
    return { action: "ENTER_LONG", reason: "range_floor" };
  }

  if (!bot.position && price >= highBand) {
    return { action: "ENTER_SHORT", reason: "range_ceiling" };
  }

  if (bot.position && bot.position.side === "LONG" && price >= indicators.rangeHigh * 0.996) {
    return { action: "EXIT", reason: "range_target_long" };
  }

  if (bot.position && bot.position.side === "SHORT" && price <= indicators.rangeLow * 1.004) {
    return { action: "EXIT", reason: "range_target_short" };
  }

  return { action: "HOLD" };
}

function getStrategySignal(strategyKey, context, bot) {
  if (strategyKey === "micro_reversal") return microReversalSignal(context, bot);
  if (strategyKey === "short_trend") return shortTrendSignal(context, bot);
  if (strategyKey === "range_strategy") return rangeStrategySignal(context, bot);
  return { action: "HOLD" };
}

function createEmptyBot(name) {
  return {
    name: name,
    cash: CONFIG.initialCapitalPerBot,
    position: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feesPaid: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
    peakEquity: CONFIG.initialCapitalPerBot,
    maxDrawdownPct: 0,
    lastAction: "INIT",
    lastReason: "init"
  };
}

function createInitialRuntimeState() {
  var bots = {};
  CONFIG.botKeys.forEach(function(key) {
    bots[key] = createEmptyBot(key);
  });

  return {
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    symbol: CONFIG.symbol,
    interval: CONFIG.interval,
    marketRegime: "CHAOS",
    bots: bots,
    trades: [],
    equitySeries: []
  };
}

function computeExecutionPrice(side, marketPrice, isEntry) {
  if (side === "LONG") {
    return isEntry ? marketPrice * (1 + CONFIG.slippageRate) : marketPrice * (1 - CONFIG.slippageRate);
  }

  if (side === "SHORT") {
    return isEntry ? marketPrice * (1 - CONFIG.slippageRate) : marketPrice * (1 + CONFIG.slippageRate);
  }

  return marketPrice;
}

function getOrderNotional(bot) {
  return bot.cash * CONFIG.orderNotionalPct;
}

function getMarkToMarketPnl(position, marketPrice) {
  if (!position) return 0;
  if (position.side === "LONG") return (marketPrice - position.entryPrice) * position.qty;
  if (position.side === "SHORT") return (position.entryPrice - marketPrice) * position.qty;
  return 0;
}

function getBotEquity(bot, marketPrice) {
  if (!bot.position) return bot.cash;
  return bot.cash + bot.position.notional + getMarkToMarketPnl(bot.position, marketPrice);
}

function updateDrawdown(bot, marketPrice) {
  var equity = getBotEquity(bot, marketPrice);
  bot.peakEquity = Math.max(bot.peakEquity, equity);
  var drawdownPct = bot.peakEquity ? (bot.peakEquity - equity) / bot.peakEquity : 0;
  bot.maxDrawdownPct = Math.max(bot.maxDrawdownPct, drawdownPct);
}

function recordTrade(runtime, entry) {
  runtime.trades.push(entry);
  if (runtime.trades.length > CONFIG.maxTradesStored) {
    runtime.trades = runtime.trades.slice(-CONFIG.maxTradesStored);
  }
}

function openPosition(runtime, cycleTrades, bot, side, marketPrice, reason, regime) {
  if (bot.position) return;

  var notional = Math.min(getOrderNotional(bot), bot.cash * 0.95);
  if (notional <= 0) return;

  var execPrice = computeExecutionPrice(side, marketPrice, true);
  var qty = notional / execPrice;
  var fee = notional * CONFIG.feeRate;
  var event = {
    timestamp: new Date().toISOString(),
    bot: bot.name,
    action: "OPEN",
    side: side,
    marketPrice: marketPrice,
    execPrice: execPrice,
    qty: qty,
    fee: fee,
    regime: regime,
    reason: reason
  };

  bot.cash -= (notional + fee);
  bot.feesPaid += fee;
  bot.position = {
    side: side,
    entryPrice: execPrice,
    qty: qty,
    notional: notional,
    entryFee: fee,
    entryAt: event.timestamp,
    regimeAtEntry: regime
  };
  bot.lastAction = "OPEN_" + side;
  bot.lastReason = reason;

  recordTrade(runtime, event);
  cycleTrades.push(event);
}

function closePosition(runtime, cycleTrades, bot, marketPrice, reason, regime) {
  if (!bot.position) return;

  var exitSide = bot.position.side;
  var execPrice = computeExecutionPrice(exitSide, marketPrice, false);
  var exitValue = bot.position.qty * execPrice;
  var fee = exitValue * CONFIG.feeRate;
  var grossPnl = exitSide === "LONG"
    ? (execPrice - bot.position.entryPrice) * bot.position.qty
    : (bot.position.entryPrice - execPrice) * bot.position.qty;
  var netPnl = grossPnl - bot.position.entryFee - fee;
  var event = {
    timestamp: new Date().toISOString(),
    bot: bot.name,
    action: "CLOSE",
    side: exitSide,
    marketPrice: marketPrice,
    execPrice: execPrice,
    qty: bot.position.qty,
    fee: fee,
    regime: regime,
    reason: reason,
    netPnl: netPnl
  };

  bot.cash += (bot.position.notional + grossPnl - fee);
  bot.feesPaid += fee;
  bot.realizedPnl += netPnl;
  bot.tradeCount += 1;
  if (netPnl >= 0) bot.wins += 1;
  else bot.losses += 1;
  bot.lastAction = "CLOSE";
  bot.lastReason = reason;

  recordTrade(runtime, event);
  cycleTrades.push(event);
  bot.position = null;
}

function checkRiskExit(runtime, cycleTrades, bot, marketPrice, regime) {
  if (!bot.position) return false;

  var side = bot.position.side;
  var execPrice = computeExecutionPrice(side, marketPrice, false);
  var rawPnl = side === "LONG"
    ? (execPrice - bot.position.entryPrice) / bot.position.entryPrice
    : (bot.position.entryPrice - execPrice) / bot.position.entryPrice;

  if (rawPnl >= CONFIG.takeProfitPct) {
    closePosition(runtime, cycleTrades, bot, marketPrice, "take_profit", regime);
    return true;
  }

  if (rawPnl <= -CONFIG.stopLossPct) {
    closePosition(runtime, cycleTrades, bot, marketPrice, "stop_loss", regime);
    return true;
  }

  if (regime === "CHAOS") {
    closePosition(runtime, cycleTrades, bot, marketPrice, "chaos_protect", regime);
    return true;
  }

  return false;
}

function runStrategies(runtime, candles, indicators, regimeInfo, cycleTrades) {
  var price = indicators.price;

  CONFIG.botKeys.forEach(function(strategyKey) {
    var bot = runtime.bots[strategyKey];
    var context = {
      candles: candles,
      indicators: indicators,
      regime: regimeInfo
    };

    if (checkRiskExit(runtime, cycleTrades, bot, price, regimeInfo.regime)) {
      updateDrawdown(bot, price);
      bot.unrealizedPnl = 0;
      return;
    }

    var signal = getStrategySignal(strategyKey, context, bot);

    if (signal.action === "ENTER_LONG") {
      openPosition(runtime, cycleTrades, bot, "LONG", price, signal.reason, regimeInfo.regime);
    } else if (signal.action === "ENTER_SHORT") {
      openPosition(runtime, cycleTrades, bot, "SHORT", price, signal.reason, regimeInfo.regime);
    } else if (signal.action === "EXIT") {
      closePosition(runtime, cycleTrades, bot, price, signal.reason, regimeInfo.regime);
    } else {
      bot.lastAction = "HOLD";
      bot.lastReason = signal.reason || "hold";
    }

    bot.unrealizedPnl = getMarkToMarketPnl(bot.position, price);
    updateDrawdown(bot, price);
  });
}

function appendEquityPoint(runtime, indicators, regimeInfo) {
  var point = {
    timestamp: new Date().toISOString(),
    totalEquity: 0
  };

  CONFIG.botKeys.forEach(function(key) {
    point[key] = roundNumber(getBotEquity(runtime.bots[key], indicators.price), 2);
    point.totalEquity += point[key];
  });

  point.totalEquity = roundNumber(point.totalEquity, 2);
  point.marketRegime = regimeInfo.regime;
  runtime.equitySeries.push(point);

  if (runtime.equitySeries.length > CONFIG.maxEquityPoints) {
    runtime.equitySeries = runtime.equitySeries.slice(-CONFIG.maxEquityPoints);
  }

  return point;
}

function getScriptStore() {
  return PropertiesService.getScriptProperties();
}

function loadRuntimeState() {
  var raw = getScriptStore().getProperty(STATE_KEYS.runtime);
  return raw ? JSON.parse(raw) : createInitialRuntimeState();
}

function saveRuntimeState(runtime) {
  getScriptStore().setProperty(STATE_KEYS.runtime, JSON.stringify(runtime));
}

function savePayload(key, payload) {
  getScriptStore().setProperty(key, JSON.stringify(payload));
}

function readPayload(key, fallback) {
  var raw = getScriptStore().getProperty(key);
  return raw ? JSON.parse(raw) : fallback;
}

function buildStatusPayload(runtime, indicators, regimeInfo) {
  var bots = CONFIG.botKeys.map(function(key) {
    var bot = runtime.bots[key];
    var equity = getBotEquity(bot, indicators.price);
    var totalDecisions = bot.wins + bot.losses;

    return {
      key: key,
      name: key,
      state: bot.position ? bot.position.side : "FLAT",
      entryPrice: bot.position ? roundNumber(bot.position.entryPrice, 2) : null,
      positionSize: bot.position ? roundNumber(bot.position.qty, 6) : 0,
      equity: roundNumber(equity, 2),
      realizedPnl: roundNumber(bot.realizedPnl, 2),
      unrealizedPnl: roundNumber(bot.unrealizedPnl, 2),
      feesPaid: roundNumber(bot.feesPaid, 2),
      tradeCount: bot.tradeCount,
      winRate: totalDecisions ? roundNumber(bot.wins / totalDecisions, 4) : 0,
      maxDrawdownPercent: roundNumber(bot.maxDrawdownPct * 100, 2),
      lastAction: bot.lastAction,
      lastReason: bot.lastReason
    };
  });

  var totalEquity = bots.reduce(function(acc, bot) { return acc + bot.equity; }, 0);
  var totalTrades = bots.reduce(function(acc, bot) { return acc + bot.tradeCount; }, 0);
  var averageWinRate = bots.length
    ? bots.reduce(function(acc, bot) { return acc + bot.winRate; }, 0) / bots.length
    : 0;
  var totalInitialCapital = CONFIG.initialCapitalPerBot * CONFIG.botKeys.length;

  return {
    timestamp: new Date().toISOString(),
    symbol: CONFIG.symbol,
    timeframe: CONFIG.interval,
    marketRegime: regimeInfo.regime,
    preferredStrategy: regimeInfo.preferredStrategy,
    trendBias: regimeInfo.trendBias,
    price: roundNumber(indicators.price, 2),
    summary: {
      initialCapital: totalInitialCapital,
      currentEquity: roundNumber(totalEquity, 2),
      pnl: roundNumber(totalEquity - totalInitialCapital, 2),
      pnlPercent: roundNumber(((totalEquity / totalInitialCapital) - 1) * 100, 2),
      totalTrades: totalTrades,
      avgWinRate: roundNumber(averageWinRate, 4)
    },
    bots: bots,
    recentTrades: runtime.trades.slice(-20)
  };
}

function buildEquityPayload(runtime) {
  return {
    symbol: CONFIG.symbol,
    timeframe: CONFIG.interval,
    series: runtime.equitySeries
  };
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var view = e && e.parameter && e.parameter.view ? e.parameter.view : "app";

  if (view === "app") {
    return dashboardHtmlOutput_();
  }

  if (view === "equity") {
    return jsonResponse(readPayload(STATE_KEYS.equity, { symbol: CONFIG.symbol, timeframe: CONFIG.interval, series: [] }));
  }

  if (view === "runtime") {
    return jsonResponse(readPayload(STATE_KEYS.bridgeRuntime, {
      mode: "idle",
      position: { side: "FLAT", qty: 0, entryPrice: 0 },
      wallet: { totalEquity: CONFIG.initialCapitalPerBot * CONFIG.botKeys.length },
      lastSignal: null,
      lastError: null
    }));
  }

  if (view === "health") {
    return jsonResponse({
      ok: true,
      service: "paper-trading-lab",
      timestamp: new Date().toISOString(),
      symbol: CONFIG.symbol,
      timeframe: CONFIG.interval,
      spreadsheetUrl: getSpreadsheetUrl()
    });
  }

  if (view === "config") {
    return jsonResponse({
      symbol: CONFIG.symbol,
      timeframe: CONFIG.interval,
      spreadsheetId: getSpreadsheetId(),
      spreadsheetUrl: getSpreadsheetUrl()
    });
  }

  if (view === "status") {
    return jsonResponse(readPayload(STATE_KEYS.status, {
      timestamp: new Date().toISOString(),
      symbol: CONFIG.symbol,
      timeframe: CONFIG.interval,
      marketRegime: "CHAOS",
      preferredStrategy: "none",
      trendBias: "FLAT",
      price: 0,
      summary: {
        initialCapital: CONFIG.initialCapitalPerBot * CONFIG.botKeys.length,
        currentEquity: CONFIG.initialCapitalPerBot * CONFIG.botKeys.length,
        pnl: 0,
        pnlPercent: 0,
        totalTrades: 0,
        avgWinRate: 0
      },
      bots: []
    }));
  }

  return dashboardHtmlOutput_();
}

function dashboardHtmlOutput_() {
  return HtmlService
    .createHtmlOutputFromFile("Dashboard")
    .setTitle("Paper Trading Lab")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getDashboardBundle() {
  return {
    config: {
      symbol: CONFIG.symbol,
      timeframe: CONFIG.interval,
      spreadsheetId: getSpreadsheetId(),
      spreadsheetUrl: getSpreadsheetUrl()
    },
    status: readPayload(STATE_KEYS.status, {
      timestamp: new Date().toISOString(),
      symbol: CONFIG.symbol,
      timeframe: CONFIG.interval,
      marketRegime: "CHAOS",
      preferredStrategy: "none",
      trendBias: "FLAT",
      price: 0,
      summary: {
        initialCapital: CONFIG.initialCapitalPerBot * CONFIG.botKeys.length,
        currentEquity: CONFIG.initialCapitalPerBot * CONFIG.botKeys.length,
        pnl: 0,
        pnlPercent: 0,
        totalTrades: 0,
        avgWinRate: 0
      },
      bots: []
    }),
    equity: readPayload(STATE_KEYS.equity, {
      symbol: CONFIG.symbol,
      timeframe: CONFIG.interval,
      series: []
    })
  };
}

function refreshDashboardCycle() {
  return runSimulationCycle();
}

function doPost(e) {
  var payload = null;

  if (e && e.postData && e.postData.contents) {
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: "invalid_json"
      });
    }
  }

  if (payload && payload.event === "bridge_sync") {
    return ingestBridgeSync_(payload);
  }

  return doGet(e);
}

function setupSpreadsheet(spreadsheetName) {
  var ss = SpreadsheetApp.create(spreadsheetName || "Paper Trading Lab");
  storeSpreadsheetId(ss.getId());
  ensureSpreadsheetStructure_(ss);
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl()
  };
}

function useSpreadsheet(spreadsheetId) {
  storeSpreadsheetId(spreadsheetId);
  var ss = SpreadsheetApp.openById(spreadsheetId);
  ensureSpreadsheetStructure_(ss);
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl()
  };
}

function storeSpreadsheetId(spreadsheetId) {
  getScriptStore().setProperty(STATE_KEYS.spreadsheetId, spreadsheetId);
}

function getSpreadsheetId() {
  return getScriptStore().getProperty(STATE_KEYS.spreadsheetId);
}

function getSpreadsheetUrl() {
  var spreadsheetId = getSpreadsheetId();
  return spreadsheetId ? SpreadsheetApp.openById(spreadsheetId).getUrl() : null;
}

function ensureBridgeSyncToken_() {
  var store = getScriptStore();
  var token = store.getProperty(STATE_KEYS.bridgeSyncToken);
  if (!token) {
    token = Utilities.getUuid();
    store.setProperty(STATE_KEYS.bridgeSyncToken, token);
  }
  return token;
}

function setBridgeSyncToken(token) {
  if (!token) {
    throw new Error("Bridge sync token is required.");
  }

  getScriptStore().setProperty(STATE_KEYS.bridgeSyncToken, token);
  return {
    ok: true,
    bridgeSyncToken: token
  };
}

function getBridgeSyncToken() {
  return ensureBridgeSyncToken_();
}

function setupBridgeSpreadsheet(spreadsheetName) {
  var ss = SpreadsheetApp.create(spreadsheetName || "DOGE Futures Bridge");
  storeSpreadsheetId(ss.getId());
  ensureBridgeSpreadsheetStructure_(ss);
  ensureBridgeSyncToken_();
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    bridgeSyncToken: getBridgeSyncToken()
  };
}

function configureBridgeSpreadsheet(spreadsheetId) {
  var targetSpreadsheetId = spreadsheetId || CONFIG.defaultBridgeSpreadsheetId;

  if (!targetSpreadsheetId) {
    throw new Error("Spreadsheet ID is required.");
  }

  storeSpreadsheetId(targetSpreadsheetId);
  var ss = SpreadsheetApp.openById(targetSpreadsheetId);
  ensureBridgeSpreadsheetStructure_(ss);
  ensureBridgeSyncToken_();
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    bridgeSyncToken: getBridgeSyncToken()
  };
}

function configureDefaultBridgeSpreadsheet() {
  return configureBridgeSpreadsheet(CONFIG.defaultBridgeSpreadsheetId);
}

function getBridgeSetupInfo() {
  return {
    spreadsheetId: getSpreadsheetId() || CONFIG.defaultBridgeSpreadsheetId,
    spreadsheetUrl: getSpreadsheetUrl(),
    bridgeSyncToken: getBridgeSyncToken()
  };
}

function logBridgeSetupInfo() {
  var info = getBridgeSetupInfo();
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

function ensureSpreadsheetStructure_(ss) {
  ensureSheetHeaders_(ss, "status_log", [
    "timestamp", "symbol", "timeframe", "market_regime", "preferred_strategy", "trend_bias",
    "price", "initial_capital", "current_equity", "pnl", "pnl_percent", "total_trades", "avg_win_rate"
  ]);

  ensureSheetHeaders_(ss, "bot_status", [
    "timestamp", "bot_key", "state", "entry_price", "position_size", "equity", "realized_pnl",
    "unrealized_pnl", "fees_paid", "trade_count", "win_rate", "max_drawdown_percent", "last_action", "last_reason"
  ]);

  ensureSheetHeaders_(ss, "equity_log", [
    "timestamp", "market_regime", "total_equity", "micro_reversal", "short_trend", "range_strategy"
  ]);

  ensureSheetHeaders_(ss, "trade_log", [
    "timestamp", "bot", "action", "side", "market_price", "exec_price", "qty", "fee", "regime", "reason", "net_pnl"
  ]);
}

function ensureBridgeSpreadsheetStructure_(ss) {
  ensureSheetHeaders_(ss, "bridge_runtime", [
    "timestamp", "mode", "position_state", "position_qty", "entry_price", "mark_price",
    "wallet_balance", "available_balance", "margin_used", "unrealized_pnl", "total_equity",
    "effective_leverage", "daily_realized_pnl", "total_realized_pnl", "daily_stop_active",
    "entries_today", "closed_trades_total", "last_signal_action", "last_signal_nonce", "last_error"
  ]);

  ensureSheetHeaders_(ss, "bridge_equity", [
    "timestamp", "market_regime", "total_equity", "doge_futures_bridge"
  ]);

  ensureSheetHeaders_(ss, "bridge_trades", [
    "trade_id", "direction", "entry_time", "exit_time", "symbol", "entry_price_avg", "exit_price_avg",
    "qty", "leverage", "gross_pnl", "fees_total", "funding_total", "net_pnl",
    "return_on_margin_pct", "duration_sec", "exit_reason"
  ]);

  ensureSheetHeaders_(ss, "bridge_executions", [
    "timestamp", "mode", "symbol", "kind", "side", "signal_nonce", "order_id", "client_order_id",
    "price", "qty", "fee", "fee_asset", "notional", "reason"
  ]);
}

function ensureSheetHeaders_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var sameHeaders = headers.every(function(header, index) {
    return firstRow[index] === header;
  });

  if (!sameHeaders) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function appendCycleToSpreadsheet_(statusPayload, equityPoint, cycleTrades) {
  var spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return;

  var ss = SpreadsheetApp.openById(spreadsheetId);
  ensureSpreadsheetStructure_(ss);

  ss.getSheetByName("status_log").appendRow([
    statusPayload.timestamp,
    statusPayload.symbol,
    statusPayload.timeframe,
    statusPayload.marketRegime,
    statusPayload.preferredStrategy,
    statusPayload.trendBias,
    statusPayload.price,
    statusPayload.summary.initialCapital,
    statusPayload.summary.currentEquity,
    statusPayload.summary.pnl,
    statusPayload.summary.pnlPercent,
    statusPayload.summary.totalTrades,
    statusPayload.summary.avgWinRate
  ]);

  statusPayload.bots.forEach(function(bot) {
    ss.getSheetByName("bot_status").appendRow([
      statusPayload.timestamp,
      bot.key,
      bot.state,
      bot.entryPrice,
      bot.positionSize,
      bot.equity,
      bot.realizedPnl,
      bot.unrealizedPnl,
      bot.feesPaid,
      bot.tradeCount,
      bot.winRate,
      bot.maxDrawdownPercent,
      bot.lastAction,
      bot.lastReason
    ]);
  });

  ss.getSheetByName("equity_log").appendRow([
    equityPoint.timestamp,
    equityPoint.marketRegime,
    equityPoint.totalEquity,
    equityPoint.micro_reversal,
    equityPoint.short_trend,
    equityPoint.range_strategy
  ]);

  cycleTrades.forEach(function(trade) {
    ss.getSheetByName("trade_log").appendRow([
      trade.timestamp,
      trade.bot,
      trade.action,
      trade.side,
      roundNumber(trade.marketPrice, 6),
      roundNumber(trade.execPrice, 6),
      roundNumber(trade.qty, 8),
      roundNumber(trade.fee, 8),
      trade.regime,
      trade.reason,
      trade.netPnl != null ? roundNumber(trade.netPnl, 8) : ""
    ]);
  });
}

function ingestBridgeSync_(payload) {
  var expectedToken = ensureBridgeSyncToken_();
  if (expectedToken && payload.syncToken !== expectedToken) {
    return jsonResponse({
      ok: false,
      error: "invalid_sync_token"
    });
  }

  if (payload.status) {
    savePayload(STATE_KEYS.status, payload.status);
  }

  if (payload.equity) {
    savePayload(STATE_KEYS.equity, payload.equity);
  }

  if (payload.runtime) {
    savePayload(STATE_KEYS.bridgeRuntime, payload.runtime);
  }

  appendBridgeSyncToSpreadsheet_(payload);

  return jsonResponse({
    ok: true,
    syncedAt: new Date().toISOString(),
    spreadsheetId: getSpreadsheetId(),
    spreadsheetUrl: getSpreadsheetUrl()
  });
}

function appendBridgeSyncToSpreadsheet_(payload) {
  var spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return;

  var ss = SpreadsheetApp.openById(spreadsheetId);
  ensureBridgeSpreadsheetStructure_(ss);

  var runtime = payload.runtime || {};
  var wallet = runtime.wallet || {};
  var position = runtime.position || {};
  var daily = runtime.daily || {};
  var totals = runtime.totals || {};
  var lastSignal = runtime.lastSignal || {};

  ss.getSheetByName("bridge_runtime").appendRow([
    new Date().toISOString(),
    runtime.mode || "",
    position.side || "FLAT",
    position.qty || 0,
    position.entryPrice || 0,
    wallet.markPrice || 0,
    wallet.walletBalance || 0,
    wallet.availableBalance || 0,
    wallet.marginUsed || 0,
    wallet.unrealizedPnl || 0,
    wallet.totalEquity || 0,
    wallet.effectiveLeverage || 0,
    daily.realizedPnl || 0,
    totals.realizedPnl || 0,
    daily.stopActive || false,
    daily.entryCount || 0,
    totals.closedTrades || 0,
    lastSignal.action || "",
    lastSignal.nonce || "",
    runtime.lastError || ""
  ]);

  if (payload.equityPoint) {
    ss.getSheetByName("bridge_equity").appendRow([
      payload.equityPoint.timestamp || new Date().toISOString(),
      payload.equityPoint.marketRegime || "NEUTRAL",
      payload.equityPoint.totalEquity || 0,
      payload.equityPoint.doge_futures_bridge || payload.equityPoint.totalEquity || 0
    ]);
  }

  (payload.trades || []).forEach(function(trade) {
    ss.getSheetByName("bridge_trades").appendRow([
      trade.tradeId || "",
      trade.direction || "",
      trade.entryTime || "",
      trade.exitTime || "",
      trade.symbol || "",
      trade.entryPriceAvg || 0,
      trade.exitPriceAvg || 0,
      trade.qty || 0,
      trade.leverage || 0,
      trade.grossPnl || 0,
      trade.feesTotal || 0,
      trade.fundingTotal || 0,
      trade.netPnl || 0,
      trade.returnOnMarginPct || 0,
      trade.durationSec || 0,
      trade.exitReason || ""
    ]);
  });

  (payload.executions || []).forEach(function(execution) {
    ss.getSheetByName("bridge_executions").appendRow([
      execution.timestamp || new Date().toISOString(),
      execution.mode || "",
      execution.symbol || "",
      execution.kind || "",
      execution.side || "",
      execution.signalNonce || "",
      execution.orderId || "",
      execution.clientOrderId || "",
      execution.price || 0,
      execution.qty || 0,
      execution.fee || 0,
      execution.feeAsset || "",
      execution.notional || 0,
      execution.reason || ""
    ]);
  });
}

function runSimulationCycle() {
  var runtime = loadRuntimeState();
  var cycleTrades = [];
  var candles = fetchClosedKlines(CONFIG.symbol, CONFIG.interval, CONFIG.candleLimit);

  if (!candles.length) {
    throw new Error("No closed candles returned from Binance.");
  }

  var indicators = buildIndicators(candles);
  var regimeInfo = classifyMarketRegime(indicators);

  runtime.lastRunAt = new Date().toISOString();
  runtime.marketRegime = regimeInfo.regime;

  runStrategies(runtime, candles, indicators, regimeInfo, cycleTrades);
  var equityPoint = appendEquityPoint(runtime, indicators, regimeInfo);

  var statusPayload = buildStatusPayload(runtime, indicators, regimeInfo);
  var equityPayload = buildEquityPayload(runtime);

  saveRuntimeState(runtime);
  savePayload(STATE_KEYS.status, statusPayload);
  savePayload(STATE_KEYS.equity, equityPayload);
  appendCycleToSpreadsheet_(statusPayload, equityPoint, cycleTrades);

  Logger.log(JSON.stringify({
    timestamp: runtime.lastRunAt,
    symbol: CONFIG.symbol,
    timeframe: CONFIG.interval,
    marketRegime: regimeInfo.regime,
    price: indicators.price,
    totalEquity: statusPayload.summary.currentEquity,
    tradesThisCycle: cycleTrades.length
  }));

  return statusPayload;
}

function resetRuntimeState() {
  var runtime = createInitialRuntimeState();
  saveRuntimeState(runtime);
  savePayload(STATE_KEYS.status, buildStatusPayload(runtime, {
    price: 0
  }, {
    regime: "CHAOS",
    preferredStrategy: "none",
    trendBias: "FLAT"
  }));
  savePayload(STATE_KEYS.equity, buildEquityPayload(runtime));
}

function clearAllState() {
  getScriptStore().deleteAllProperties();
}

function installFiveMinuteTrigger() {
  clearSimulationTriggers();
  ScriptApp.newTrigger("runSimulationCycle")
    .timeBased()
    .everyMinutes(5)
    .create();
}

function installOneMinuteTrigger() {
  clearSimulationTriggers();
  ScriptApp.newTrigger("runSimulationCycle")
    .timeBased()
    .everyMinutes(1)
    .create();
}

function clearSimulationTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "runSimulationCycle") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function setupProject() {
  var spreadsheet = setupSpreadsheet("Paper Trading Lab");
  resetRuntimeState();
  var status = runSimulationCycle();
  installFiveMinuteTrigger();

  return {
    ok: true,
    spreadsheetId: spreadsheet.spreadsheetId,
    spreadsheetUrl: spreadsheet.spreadsheetUrl,
    lastStatus: status,
    nextStep: "Deploy as Web App in Apps Script UI"
  };
}

function seedDemoState() {
  resetRuntimeState();
  runSimulationCycle();
}
