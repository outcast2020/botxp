export default defineStrategy({
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

    if (longSignal) {
      strategy.entry("L", "LONG", {
        leverage: Math.min(ctx.input.leverage, ctx.policy?.leverageCap || ctx.input.leverage),
        budgetUsdt: ctx.input.budgetUsdt,
        reason: "mtf_long_pullback"
      });
    }

    if (shortSignal) {
      strategy.entry("S", "SHORT", {
        leverage: Math.min(ctx.input.leverage, ctx.policy?.leverageCap || ctx.input.leverage),
        budgetUsdt: ctx.input.budgetUsdt,
        reason: "mtf_short_pullback"
      });
    }

    plot.line("emaFast", emaFast.last());
    plot.line("emaSlow", emaSlow.last());
    plot.line("emaTrend", emaTrend.last());
    plot.line("atr", atr.last());
    plot.marker(longSignal, "BUY");
    plot.marker(shortSignal, "SELL");
  }
});
