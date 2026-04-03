function createSeries(values) {
  const safeValues = Array.isArray(values) ? values : [];
  return {
    values: safeValues,
    last() {
      return safeValues.length ? safeValues[safeValues.length - 1] : 0;
    },
    at(index) {
      return safeValues[index] ?? 0;
    },
    length() {
      return safeValues.length;
    },
    slice(count) {
      return createSeries(safeValues.slice(-count));
    },
    toArray() {
      return [...safeValues];
    }
  };
}

function emaValues(values, period) {
  const output = [];
  if (!values.length || period <= 0) return output;
  const multiplier = 2 / (period + 1);
  let current = values[0];
  output.push(current);
  for (let i = 1; i < values.length; i += 1) {
    current = (values[i] - current) * multiplier + current;
    output.push(current);
  }
  return output;
}

function rsiValues(values, period) {
  if (!values.length) return [];
  const output = new Array(values.length).fill(50);
  if (values.length <= period) return output;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  output[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    output[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return output;
}

function atrValues(highValues, lowValues, closeValues, period) {
  if (!highValues.length || !lowValues.length || !closeValues.length) return [];
  const ranges = [];
  for (let i = 0; i < highValues.length; i += 1) {
    const prevClose = i === 0 ? closeValues[i] : closeValues[i - 1];
    const tr = Math.max(
      highValues[i] - lowValues[i],
      Math.abs(highValues[i] - prevClose),
      Math.abs(lowValues[i] - prevClose)
    );
    ranges.push(tr);
  }

  const output = [];
  let current = ranges[0] || 0;
  output.push(current);
  for (let i = 1; i < ranges.length; i += 1) {
    current = ((current * (period - 1)) + ranges[i]) / period;
    output.push(current);
  }
  return output;
}

function crossOver(aSeries, bSeries) {
  const a = aSeries.values || [];
  const b = bSeries.values || [];
  if (a.length < 2 || b.length < 2) return false;
  return a[a.length - 2] <= b[b.length - 2] && a[a.length - 1] > b[b.length - 1];
}

function crossUnder(aSeries, bSeries) {
  const a = aSeries.values || [];
  const b = bSeries.values || [];
  if (a.length < 2 || b.length < 2) return false;
  return a[a.length - 2] >= b[b.length - 2] && a[a.length - 1] < b[b.length - 1];
}

function normalizeSource(source) {
  return String(source || "").replace(/export\s+default\s+/g, "");
}

function inputDescriptor(type, defaultValue, options = {}) {
  return {
    __inputDescriptor: true,
    type,
    defaultValue,
    options
  };
}

function compileStrategy(source) {
  const input = {
    int(defaultValue, options) {
      return inputDescriptor("int", defaultValue, options);
    },
    float(defaultValue, options) {
      return inputDescriptor("float", defaultValue, options);
    },
    bool(defaultValue, options) {
      return inputDescriptor("bool", defaultValue, options);
    }
  };

  const sharedTa = {};
  const sharedStrategy = {};
  const sharedPlot = {};
  let captured = null;
  const defineStrategy = (definition) => {
    captured = definition;
    return definition;
  };

  const runner = new Function("defineStrategy", "input", "ta", "strategy", "plot", normalizeSource(source));
  runner(defineStrategy, input, sharedTa, sharedStrategy, sharedPlot);

  if (!captured || typeof captured.onBarClose !== "function") {
    throw new Error("A estratégia precisa chamar defineStrategy({ onBarClose() { ... } }).");
  }

  return {
    definition: captured,
    bindings: {
      ta: sharedTa,
      strategy: sharedStrategy,
      plot: sharedPlot
    }
  };
}

function resolveInputs(definitionInputs = {}, inputOverrides = {}) {
  const resolved = {};
  Object.entries(definitionInputs).forEach(([key, value]) => {
    if (value && value.__inputDescriptor) {
      resolved[key] = inputOverrides[key] ?? value.defaultValue;
    } else {
      resolved[key] = inputOverrides[key] ?? value;
    }
  });
  return resolved;
}

function seriesFromBars(bars, field) {
  return createSeries(bars.map((bar) => Number(bar[field] || 0)));
}

function buildTa() {
  return {
    ema(series, period) {
      return createSeries(emaValues(series.values || [], Number(period || 1)));
    },
    rsi(series, period) {
      return createSeries(rsiValues(series.values || [], Number(period || 1)));
    },
    atr(highSeries, lowSeries, closeSeries, period) {
      return createSeries(atrValues(highSeries.values || [], lowSeries.values || [], closeSeries.values || [], Number(period || 1)));
    },
    crossOver,
    crossUnder
  };
}

function lastOrZero(series) {
  return Number(series?.last?.() || 0);
}

function buildSignalPayload(action, options, ctx) {
  const price = Number(ctx.series.close().last() || 0);
  const rsiSeries = ctx.cache.rsi7 || ctx.ta.rsi(ctx.series.close(), 7);
  const atrSeries = ctx.cache.atr14 || ctx.ta.atr(ctx.series.high(), ctx.series.low(), ctx.series.close(), 14);
  const atrPct = price ? (lastOrZero(atrSeries) / price) * 100 : 0;
  const htfRsiSeries = ctx.cache.htfRsi14 || ctx.ta.rsi(ctx.htf.close(), 14);

  return {
    source: "botxp_terminal",
    strategy_id: ctx.strategy.id || "custom_strategy",
    action,
    symbol: ctx.strategy.symbol || ctx.symbol,
    market: "usds_m_futures",
    interval: ctx.strategy.timeframe || ctx.timeframe,
    bar_time: ctx.bar.openTime,
    price,
    leverage: Number(options.leverage || ctx.input.leverage || 1),
    margin_mode: "ISOLATED",
    position_mode: "ONE_WAY",
    order_budget_usdt: Number(options.budgetUsdt || ctx.input.budgetUsdt || 0),
    qty_hint: Number(options.qtyHint || 0),
    rsi: Number((options.rsi ?? lastOrZero(rsiSeries)).toFixed(4)),
    atr_pct: Number((options.atrPct ?? atrPct).toFixed(4)),
    htf_trend: String(options.htfTrend || ctx.derived.htfTrend || "NEUTRAL").toUpperCase(),
    htf_rsi: Number((options.htfRsi ?? lastOrZero(htfRsiSeries)).toFixed(4)),
    reason: options.reason || "",
    nonce: options.nonce || `${ctx.strategy.id || "strategy"}-${ctx.bar.openTime}-${action}`
  };
}

export function runStrategyOnHistory({ source, bars, htfBars, settings = {}, macro = {}, policy = {} }) {
  const compiled = compileStrategy(source);
  const strategy = compiled.definition;
  const resolvedInputs = resolveInputs(strategy.inputs, settings.inputs || {});
  const signals = [];
  const linePlots = new Map();
  const markers = [];
  const diagnostics = [];
  const ta = buildTa();
  const warmup = Number(settings.warmupBars || 80);

  for (let index = 0; index < bars.length; index += 1) {
    const localBars = bars.slice(0, index + 1);
    const currentBar = localBars[localBars.length - 1];
    const currentHtfBars = htfBars.filter((bar) => bar.openTime <= currentBar.openTime);

    if (localBars.length < warmup || currentHtfBars.length < 20) continue;

    const plotsForBar = [];
    const signalsForBar = [];
    const closeSeries = seriesFromBars(localBars, "close");
    const highSeries = seriesFromBars(localBars, "high");
    const lowSeries = seriesFromBars(localBars, "low");
    const htfCloseSeries = seriesFromBars(currentHtfBars, "close");
    const cache = {
      rsi7: ta.rsi(closeSeries, 7),
      atr14: ta.atr(highSeries, lowSeries, closeSeries, 14),
      htfRsi14: ta.rsi(htfCloseSeries, 14)
    };

    const ctx = {
      symbol: settings.symbol,
      timeframe: settings.timeframe,
      htfTimeframe: settings.htfTimeframe,
      strategy,
      input: resolvedInputs,
      ta,
      cache,
      macro: {
        regime: macro.macroRegime || macro.regime || "UNKNOWN",
        stressScore: Number(macro.macroStressScore || macro.stressScore || 0),
        riskMarkers: macro.riskMarkers || {}
      },
      policy: {
        riskMode: policy.riskMode || "NEUTRAL",
        allowedSide: policy.allowedSide || "BOTH",
        leverageCap: Number(policy.leverageCap || resolvedInputs.leverage || 1),
        stopProfile: policy.stopProfile || "NORMAL",
        holdPolicy: policy.holdPolicy || "NORMAL",
        noTrade: Boolean(policy.noTrade)
      },
      bar: currentBar,
      series: {
        open: () => seriesFromBars(localBars, "open"),
        high: () => highSeries,
        low: () => lowSeries,
        close: () => closeSeries,
        volume: () => seriesFromBars(localBars, "volume")
      },
      htf: {
        open: () => seriesFromBars(currentHtfBars, "open"),
        high: () => seriesFromBars(currentHtfBars, "high"),
        low: () => seriesFromBars(currentHtfBars, "low"),
        close: () => htfCloseSeries,
        volume: () => seriesFromBars(currentHtfBars, "volume")
      },
      derived: {
        htfTrend: currentHtfBars.length >= 2 && currentHtfBars[currentHtfBars.length - 1].close >= currentHtfBars[currentHtfBars.length - 2].close
          ? "BULL"
          : "BEAR"
      }
    };

    const strategyApi = {
      entry(id, side, options = {}) {
        const normalizedSide = String(side || "").toUpperCase();
        const action = normalizedSide === "SHORT" ? "SHORT_ENTRY" : "LONG_ENTRY";
        signalsForBar.push(buildSignalPayload(action, { ...options, id }, ctx));
      },
      exit(id, options = {}) {
        signalsForBar.push(buildSignalPayload("FLAT_EXIT", { ...options, id }, ctx));
      },
      closeAll(reason) {
        signalsForBar.push(buildSignalPayload("FLAT_EXIT", { reason: reason || "close_all" }, ctx));
      }
    };

    const plotApi = {
      line(name, value) {
        plotsForBar.push({ kind: "line", name, value: Number(value || 0), time: currentBar.time });
      },
      marker(condition, text, options = {}) {
        if (!condition) return;
        markers.push({
          time: currentBar.time,
          text: text || "S",
          color: options.color || (String(text || "").toUpperCase().includes("SELL") ? "#a12f2f" : "#14684c"),
          direction: options.direction || (String(text || "").toUpperCase().includes("SELL") ? "down" : "up")
        });
      }
    };

    try {
      Object.assign(compiled.bindings.ta, ta);
      Object.assign(compiled.bindings.strategy, strategyApi);
      Object.assign(compiled.bindings.plot, plotApi);
      strategy.onBarClose({ ...ctx, strategy: strategyApi, plot: plotApi });
    } catch (error) {
      diagnostics.push({
        time: currentBar.time,
        message: error.message
      });
      throw error;
    }

    plotsForBar.forEach((entry) => {
      if (entry.kind !== "line") return;
      if (!linePlots.has(entry.name)) linePlots.set(entry.name, []);
      linePlots.get(entry.name).push({
        value: Number(entry.value.toFixed(6)),
        time: entry.time
      });
    });

    signalsForBar.forEach((signal) => signals.push(signal));
  }

  return {
    strategy,
    resolvedInputs,
    signals,
    latestSignal: signals.length ? signals[signals.length - 1] : null,
    markers,
    lines: Object.fromEntries(linePlots.entries()),
    diagnostics
  };
}
