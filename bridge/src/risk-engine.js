const { clamp, dedupePush, getDayKey, nowIso, toNumber } = require("./utils");
const { createDailyStats } = require("./store");

function resetDailyIfNeeded(runtime, config, timestamp = Date.now()) {
  const dayKey = getDayKey(config.timezone, timestamp);
  if (!runtime.daily || runtime.daily.dayKey !== dayKey) {
    runtime.daily = createDailyStats(dayKey);
  }
}

function evaluateSignal(runtime, signal, config, context = {}) {
  resetDailyIfNeeded(runtime, config, signal.receivedAt);
  const oil = context.oil || runtime.macro?.oil || null;

  if (runtime.recentNonces.includes(signal.nonce)) {
    return { ok: false, ignored: true, reason: "duplicate_nonce" };
  }

  const ageMs = signal.receivedAt - signal.barTime;
  if (ageMs < 0 || ageMs > config.maxSignalAgeMs) {
    return { ok: false, ignored: true, reason: "stale_signal" };
  }

  if (signal.action === "LONG_ENTRY" && signal.htfTrend !== "BULL") {
    return { ok: false, ignored: true, reason: "htf_not_bullish" };
  }

  if (signal.action === "SHORT_ENTRY" && signal.htfTrend !== "BEAR") {
    return { ok: false, ignored: true, reason: "htf_not_bearish" };
  }

  if (signal.action !== "FLAT_EXIT") {
    if (config.polymarket?.enabled) {
      if (!oil || oil.enabled === false) {
        return { ok: false, ignored: true, reason: "macro_snapshot_missing" };
      }

      if (oil.stale) {
        return { ok: false, ignored: true, reason: "macro_snapshot_stale" };
      }

      if (toNumber(oil.macroStressScore, 0) >= config.polymarket.hardBlockScore) {
        return { ok: false, ignored: true, reason: "macro_risk_lock" };
      }
    }

    if (runtime.daily.stopActive) {
      return { ok: false, ignored: true, reason: "daily_stop_active" };
    }

    if (runtime.daily.entryCount >= config.maxEntriesPerDay) {
      return { ok: false, ignored: true, reason: "max_entries_reached" };
    }

    if (runtime.daily.consecutiveLosses >= config.maxConsecutiveLosses) {
      return { ok: false, ignored: true, reason: "loss_streak_lock" };
    }

    if (runtime.daily.realizedPnl <= -Math.abs(config.dailyStopLossUsdt)) {
      runtime.daily.stopActive = true;
      return { ok: false, ignored: true, reason: "daily_loss_limit" };
    }
  }

  if (signal.leverage > config.maxLeverage) {
    return { ok: false, ignored: true, reason: "leverage_above_cap" };
  }

  return { ok: true };
}

function trackNonce(runtime, signal, config) {
  runtime.recentNonces = dedupePush(runtime.recentNonces, signal.nonce, config.maxStoredNonces);
  runtime.lastSignal = {
    action: signal.action,
    nonce: signal.nonce,
    price: signal.price,
    reason: signal.reason,
    receivedAt: nowIso(),
    htfTrend: signal.htfTrend
  };
}

function noteEntry(runtime) {
  runtime.daily.entryCount += 1;
  runtime.totals.entryCount += 1;
}

function noteClosedTrade(runtime, closedTrade, config) {
  runtime.daily.closedTrades += 1;
  runtime.totals.closedTrades += 1;

  runtime.daily.realizedPnl += toNumber(closedTrade.netPnl, 0);
  runtime.totals.realizedPnl += toNumber(closedTrade.netPnl, 0);

  runtime.daily.fees += toNumber(closedTrade.feesTotal, 0);
  runtime.totals.fees += toNumber(closedTrade.feesTotal, 0);

  runtime.daily.funding += toNumber(closedTrade.fundingTotal, 0);
  runtime.totals.funding += toNumber(closedTrade.fundingTotal, 0);

  if (toNumber(closedTrade.netPnl, 0) >= 0) {
    runtime.daily.wins += 1;
    runtime.totals.wins += 1;
    runtime.daily.consecutiveLosses = 0;
  } else {
    runtime.daily.losses += 1;
    runtime.totals.losses += 1;
    runtime.daily.consecutiveLosses += 1;
  }

  if (runtime.daily.realizedPnl <= -Math.abs(config.dailyStopLossUsdt)) {
    runtime.daily.stopActive = true;
  }

  runtime.recentClosedTrades = [closedTrade].concat(runtime.recentClosedTrades || []).slice(0, config.maxStoredTrades);
}

function updateEquitySeries(runtime, snapshot, regime, config) {
  const point = {
    timestamp: nowIso(),
    marketRegime: regime,
    totalEquity: Number(snapshot.totalEquity.toFixed(4)),
    doge_futures_bridge: Number(snapshot.totalEquity.toFixed(4))
  };

  runtime.equitySeries = Array.isArray(runtime.equitySeries) ? runtime.equitySeries.concat(point) : [point];
  runtime.equitySeries = runtime.equitySeries.slice(-config.maxStoredEquityPoints);

  runtime.risk.peakEquity = Math.max(runtime.risk.peakEquity || snapshot.totalEquity, snapshot.totalEquity);
  const drawdownPct = runtime.risk.peakEquity
    ? ((runtime.risk.peakEquity - snapshot.totalEquity) / runtime.risk.peakEquity) * 100
    : 0;
  runtime.risk.maxDrawdownPct = Math.max(runtime.risk.maxDrawdownPct || 0, drawdownPct);

  return point;
}

function buildStatusPayload(runtime, snapshot, config, context = {}) {
  const initialCapital = config.initialCapitalUsdt;
  const totalEquity = toNumber(snapshot.totalEquity, initialCapital);
  const winRate = runtime.totals.closedTrades
    ? runtime.totals.wins / runtime.totals.closedTrades
    : 0;
  const marketRegime = runtime.lastSignal?.htfTrend || "NEUTRAL";
  const oil = context.oil || runtime.macro?.oil || null;
  const trendBias =
    runtime.position.side !== "FLAT"
      ? runtime.position.side
      : marketRegime === "BULL"
      ? "LONG"
      : marketRegime === "BEAR"
      ? "SHORT"
      : "FLAT";

  return {
    timestamp: nowIso(),
    symbol: config.symbol,
    timeframe: `${config.timeframe} + ${config.htfTimeframe}`,
    marketRegime,
    preferredStrategy: "tv_reactive_futures",
    trendBias,
    price: Number(toNumber(snapshot.markPrice, 0).toFixed(6)),
    summary: {
      initialCapital,
      currentEquity: Number(totalEquity.toFixed(2)),
      pnl: Number((totalEquity - initialCapital).toFixed(2)),
      pnlPercent: Number((((totalEquity / initialCapital) - 1) * 100).toFixed(2)),
      totalTrades: runtime.totals.closedTrades,
      avgWinRate: Number(winRate.toFixed(4))
    },
    macro: oil
      ? {
          enabled: Boolean(oil.enabled),
          regime: oil.macroRegime || "UNKNOWN",
          stressScore: Number(toNumber(oil.macroStressScore, 0).toFixed(4)),
          stale: Boolean(oil.stale),
          eventSlug: oil.eventSlug || null,
          updatedAt: oil.updatedAt || oil.fetchedAt || null,
          volume24hr: Number(toNumber(oil.volume24hr, 0).toFixed(2))
        }
      : null,
    bots: [
      {
        name: "doge_futures_bridge",
        enabled: true,
        state: runtime.position.side,
        entryPrice: runtime.position.side === "FLAT" ? null : Number(toNumber(runtime.position.entryPrice, 0).toFixed(6)),
        positionSize: Number(toNumber(runtime.position.qty, 0).toFixed(4)),
        equity: Number(totalEquity.toFixed(2)),
        realizedPnL: Number(toNumber(runtime.totals.realizedPnl, 0).toFixed(2)),
        unrealizedPnL: Number(toNumber(snapshot.unrealizedPnl, 0).toFixed(2)),
        winRate: Number(winRate.toFixed(4)),
        tradeCount: runtime.totals.closedTrades,
        maxDrawdownPercent: Number(toNumber(runtime.risk.maxDrawdownPct, 0).toFixed(2)),
        consistency: Number(clamp(winRate, 0, 1).toFixed(4))
      }
    ],
    recentTrades: runtime.recentClosedTrades || []
  };
}

function buildEquityPayload(runtime, config) {
  return {
    symbol: config.symbol,
    timeframe: `${config.timeframe} + ${config.htfTimeframe}`,
    series: runtime.equitySeries || []
  };
}

module.exports = {
  buildEquityPayload,
  buildStatusPayload,
  evaluateSignal,
  noteClosedTrade,
  noteEntry,
  resetDailyIfNeeded,
  trackNonce,
  updateEquitySeries
};
