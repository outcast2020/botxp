defineStrategy({
  id: "doge_mtf_scalper_v1",
  symbol: "DOGEUSDT",
  timeframe: "5m",
  htfTimeframe: "4h",
  inputs: {
    leverage: input.int(3, { min: 1, max: 5 }),
    budgetUsdt: input.float(7, { min: 1 }),
    fastLen: input.int(9, { min: 2 }),
    slowLen: input.int(34, { min: 5 }),
    trendLen: input.int(89, { min: 20 }),
    htfFastLen: input.int(21, { min: 5 }),
    htfSlowLen: input.int(55, { min: 20 })
  },
  onBarClose(ctx) {
    const close = ctx.series.close();
    const high = ctx.series.high();
    const low = ctx.series.low();

    const emaFast = ta.ema(close, ctx.input.fastLen);
    const emaSlow = ta.ema(close, ctx.input.slowLen);
    const emaTrend = ta.ema(close, ctx.input.trendLen);
    const rsi = ta.rsi(close, 7);
    const atr = ta.atr(high, low, close, 14);

    const htfClose = ctx.htf.close();
    const htfFast = ta.ema(htfClose, ctx.input.htfFastLen);
    const htfSlow = ta.ema(htfClose, ctx.input.htfSlowLen);
    const htfRsi = ta.rsi(htfClose, 14);

    const macroRisk = Number(ctx.macro?.stressScore || 0);
    const allowLong = (ctx.policy?.allowedSide || "BOTH") !== "SHORT_ONLY";
    const allowShort = (ctx.policy?.allowedSide || "BOTH") !== "LONG_ONLY";

    const longBias = htfFast.last() > htfSlow.last();
    const shortBias = htfFast.last() < htfSlow.last();

    const longSignal =
      allowLong &&
      !ctx.policy?.noTrade &&
      macroRisk < 0.85 &&
      longBias &&
      ta.crossOver(emaFast, emaSlow) &&
      close.last() > emaTrend.last() &&
      rsi.last() > 52;

    const shortSignal =
      allowShort &&
      !ctx.policy?.noTrade &&
      macroRisk < 0.85 &&
      shortBias &&
      ta.crossUnder(emaFast, emaSlow) &&
      close.last() < emaTrend.last() &&
      rsi.last() < 48;

    const flattenLong =
      shortBias &&
      close.last() < emaFast.last() &&
      rsi.last() < 45;

    const flattenShort =
      longBias &&
      close.last() > emaFast.last() &&
      rsi.last() > 55;

    if (longSignal) {
      strategy.entry("L", "LONG", {
        leverage: Math.min(ctx.input.leverage, ctx.policy?.leverageCap || ctx.input.leverage),
        budgetUsdt: ctx.input.budgetUsdt,
        rsi: rsi.last(),
        atrPct: (atr.last() / close.last()) * 100,
        htfTrend: longBias ? "BULL" : "NEUTRAL",
        htfRsi: htfRsi.last(),
        reason: "mtf_long_pullback"
      });
    }

    if (shortSignal) {
      strategy.entry("S", "SHORT", {
        leverage: Math.min(ctx.input.leverage, ctx.policy?.leverageCap || ctx.input.leverage),
        budgetUsdt: ctx.input.budgetUsdt,
        rsi: rsi.last(),
        atrPct: (atr.last() / close.last()) * 100,
        htfTrend: shortBias ? "BEAR" : "NEUTRAL",
        htfRsi: htfRsi.last(),
        reason: "mtf_short_pullback"
      });
    }

    if (flattenLong || flattenShort) {
      strategy.closeAll(flattenLong ? "long_momentum_loss" : "short_momentum_loss");
    }

    plot.line("emaFast", emaFast.last(), { pane: "price", color: "#ab4b2a" });
    plot.line("emaSlow", emaSlow.last(), { pane: "price", color: "#1a5953" });
    plot.line("emaTrend", emaTrend.last(), { pane: "price", color: "#7d5a2b" });
    plot.histogram("rsi", rsi.last(), { pane: "indicator", color: "#6d4bb4" });
    plot.line("htfRsi", htfRsi.last(), { pane: "indicator", color: "#205a56" });
    plot.band("rsiBand", 70, 30, { pane: "indicator", color: "rgba(171, 75, 42, 0.14)" });
    plot.marker(longSignal, "BUY", { direction: "up", color: "#14684c", price: low.last() * 0.998 });
    plot.marker(shortSignal, "SELL", { direction: "down", color: "#a12f2f", price: high.last() * 1.002 });
  }
});
