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
  for (let index = 1; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current;
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
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  output[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    output[index] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return output;
}

function atrValues(highValues, lowValues, closeValues, period) {
  if (!highValues.length || !lowValues.length || !closeValues.length) return [];
  const ranges = [];

  for (let index = 0; index < highValues.length; index += 1) {
    const prevClose = index === 0 ? closeValues[index] : closeValues[index - 1];
    const tr = Math.max(
      highValues[index] - lowValues[index],
      Math.abs(highValues[index] - prevClose),
      Math.abs(lowValues[index] - prevClose)
    );
    ranges.push(tr);
  }

  const output = [];
  let current = ranges[0] || 0;
  output.push(current);
  for (let index = 1; index < ranges.length; index += 1) {
    current = ((current * (period - 1)) + ranges[index]) / period;
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

function inputDescriptor(type, defaultValue, options = {}) {
  return {
    __inputDescriptor: true,
    type,
    defaultValue,
    options
  };
}

function normalizeSource(source) {
  return String(source || "").replace(/export\s+default\s+/g, "");
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
    throw new Error("A estrategia precisa chamar defineStrategy({ onBarClose() { ... } }).");
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
      return createSeries(
        atrValues(highSeries.values || [], lowSeries.values || [], closeSeries.values || [], Number(period || 1))
      );
    },
    crossOver,
    crossUnder
  };
}

function lastOrZero(series) {
  return Number(series?.last?.() || 0);
}

function ensureLineStore(store, name, pane, color) {
  if (!store.has(name)) {
    store.set(name, {
      name,
      pane,
      color,
      points: []
    });
  }
  return store.get(name);
}

function ensureBandStore(store, name, pane, color) {
  if (!store.has(name)) {
    store.set(name, {
      name,
      pane,
      color,
      upper: [],
      lower: []
    });
  }
  return store.get(name);
}

function addMarker(markers, bar, text, options = {}) {
  const direction = options.direction || (String(text || "").toUpperCase().includes("SELL") ? "down" : "up");
  const fallbackPrice = direction === "down" ? bar.high * 1.004 : bar.low * 0.996;
  markers.push({
    time: bar.time,
    text: text || "S",
    color: options.color || (direction === "down" ? "#a12f2f" : "#14684c"),
    direction,
    price: Number(options.price || fallbackPrice)
  });
}

function buildSignalPayload(action, options, ctx) {
  const price = Number(ctx.series.close().last() || 0);
  const rsiSeries = ctx.cache.rsi7 || ctx.ta.rsi(ctx.series.close(), 7);
  const atrSeries = ctx.cache.atr14 || ctx.ta.atr(ctx.series.high(), ctx.series.low(), ctx.series.close(), 14);
  const atrPct = price ? (lastOrZero(atrSeries) / price) * 100 : 0;
  const htfRsiSeries = ctx.cache.htfRsi14 || ctx.ta.rsi(ctx.htf.close(), 14);

  return {
    source: "botxp_terminal",
    strategy_id: ctx.strategyMeta.id || "custom_strategy",
    action,
    symbol: ctx.strategyMeta.symbol || ctx.symbol,
    market: "usds_m_futures",
    interval: ctx.strategyMeta.timeframe || ctx.timeframe,
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
    nonce: options.nonce || `${ctx.strategyMeta.id || "strategy"}-${ctx.bar.openTime}-${action}`
  };
}

function clonePosition(position, currentPrice = 0) {
  if (!position) {
    return {
      side: "FLAT",
      qty: 0,
      leverage: 0,
      entryPrice: 0,
      unrealizedPnl: 0,
      notional: 0,
      marginUsed: 0
    };
  }

  const unrealizedPnl =
    position.side === "LONG"
      ? (currentPrice - position.entryPrice) * position.qty
      : (position.entryPrice - currentPrice) * position.qty;

  return {
    side: position.side,
    qty: Number(position.qty.toFixed(6)),
    leverage: position.leverage,
    entryPrice: Number(position.entryPrice.toFixed(6)),
    openedAt: position.openedAt,
    reason: position.reason,
    unrealizedPnl: Number(unrealizedPnl.toFixed(4)),
    notional: Number((position.qty * currentPrice).toFixed(4)),
    marginUsed: Number(position.marginUsed.toFixed(4))
  };
}

function simulateSignalsForBar({
  signalsForBar,
  bar,
  simulation,
  closedTrades,
  autoMarkers,
  settings
}) {
  const feeRate = Number(settings.feeRate || 0.0004);
  const initialCapital = Number(settings.initialCapitalUsdt || 20);

  const closePosition = (reason, signal) => {
    if (!simulation.position) return null;

    const exitPrice = Number(signal?.price || bar.close || 0);
    const exitFee = simulation.position.qty * exitPrice * feeRate;
    const grossPnl =
      simulation.position.side === "LONG"
        ? (exitPrice - simulation.position.entryPrice) * simulation.position.qty
        : (simulation.position.entryPrice - exitPrice) * simulation.position.qty;

    simulation.balance += grossPnl - exitFee;
    simulation.fees += exitFee;

    const trade = {
      tradeId: `T-${closedTrades.length + 1}`,
      direction: simulation.position.side,
      entryTime: simulation.position.openedAt,
      exitTime: bar.time,
      symbol: settings.symbol,
      entryPriceAvg: Number(simulation.position.entryPrice.toFixed(6)),
      exitPriceAvg: Number(exitPrice.toFixed(6)),
      qty: Number(simulation.position.qty.toFixed(6)),
      leverage: simulation.position.leverage,
      grossPnl: Number(grossPnl.toFixed(4)),
      feesTotal: Number((simulation.position.entryFee + exitFee).toFixed(4)),
      fundingTotal: 0,
      netPnl: Number((grossPnl - simulation.position.entryFee - exitFee).toFixed(4)),
      returnOnMarginPct: simulation.position.marginUsed
        ? Number((((grossPnl - simulation.position.entryFee - exitFee) / simulation.position.marginUsed) * 100).toFixed(2))
        : 0,
      durationSec: Math.max(0, Math.floor((bar.time - simulation.position.openedAt) / 1000)),
      exitReason: reason || signal?.reason || "manual_exit",
      balanceAfter: Number(simulation.balance.toFixed(4))
    };

    closedTrades.push(trade);
    if (trade.netPnl >= 0) simulation.wins += 1;
    else simulation.losses += 1;
    addMarker(autoMarkers, bar, "EXIT", {
      color: trade.netPnl >= 0 ? "#14684c" : "#a12f2f",
      direction: simulation.position.side === "LONG" ? "down" : "up",
      price: exitPrice
    });

    simulation.position = null;
    simulation.realizedPnl = Number((simulation.balance - initialCapital).toFixed(4));
    return trade;
  };

  const openPosition = (side, signal) => {
    const price = Number(signal.price || bar.close || 0);
    const leverage = Number(signal.leverage || settings.inputs?.leverage || 1);
    const budgetUsdt = Number(signal.order_budget_usdt || settings.inputs?.budgetUsdt || 0);
    const notional = budgetUsdt * leverage;
    const qty = price ? notional / price : 0;
    const entryFee = notional * feeRate;

    simulation.balance -= entryFee;
    simulation.fees += entryFee;
    simulation.position = {
      side,
      qty,
      leverage,
      marginUsed: budgetUsdt,
      notional,
      entryPrice: price,
      openedAt: bar.time,
      entryFee,
      reason: signal.reason || `${side.toLowerCase()}_entry`
    };

    addMarker(autoMarkers, bar, side === "LONG" ? "LONG" : "SHORT", {
      color: side === "LONG" ? "#14684c" : "#a12f2f",
      direction: side === "LONG" ? "up" : "down",
      price
    });
  };

  signalsForBar.forEach((signal) => {
    if (signal.action === "FLAT_EXIT") {
      closePosition(signal.reason || "flat_exit", signal);
      return;
    }

    const side = signal.action === "SHORT_ENTRY" ? "SHORT" : "LONG";

    if (!simulation.position) {
      openPosition(side, signal);
      return;
    }

    if (simulation.position.side === side) {
      addMarker(autoMarkers, bar, "HOLD", {
        color: "#8d7a58",
        direction: side === "LONG" ? "up" : "down",
        price: signal.price || bar.close
      });
      return;
    }

    closePosition(`reverse_to_${side.toLowerCase()}`, signal);
    openPosition(side, signal);
  });
}

function summarizeSimulation(simulation, closedTrades, initialCapital) {
  const finalEquity = Number(simulation.equity.toFixed(4));
  const pnl = Number((finalEquity - initialCapital).toFixed(4));
  const pnlPct = initialCapital ? Number(((pnl / initialCapital) * 100).toFixed(2)) : 0;
  const winRate = closedTrades.length ? Number(((simulation.wins / closedTrades.length) * 100).toFixed(2)) : 0;

  return {
    initialCapital: Number(initialCapital.toFixed(2)),
    finalEquity,
    pnl,
    pnlPct,
    closedTrades: closedTrades.length,
    wins: simulation.wins,
    losses: simulation.losses,
    winRate,
    maxDrawdownPct: Number(simulation.maxDrawdownPct.toFixed(2)),
    fees: Number(simulation.fees.toFixed(4))
  };
}

export function runStrategyOnHistory({ source, bars, htfBars, settings = {}, macro = {}, policy = {} }) {
  const compiled = compileStrategy(source);
  const strategy = compiled.definition;
  const resolvedInputs = resolveInputs(strategy.inputs, settings.inputs || {});
  const ta = buildTa();
  const warmupBars = Number(settings.warmupBars || 80);
  const initialCapital = Number(settings.initialCapitalUsdt || 20);

  const linePlots = new Map();
  const histogramPlots = new Map();
  const bandPlots = new Map();
  const userMarkers = [];
  const autoMarkers = [];
  const diagnostics = [];
  const signals = [];
  const closedTrades = [];
  const frames = [];

  const simulation = {
    balance: initialCapital,
    realizedPnl: 0,
    equity: initialCapital,
    fees: 0,
    wins: 0,
    losses: 0,
    peakEquity: initialCapital,
    maxDrawdownPct: 0,
    position: null
  };

  for (let index = 0; index < bars.length; index += 1) {
    const localBars = bars.slice(0, index + 1);
    const currentBar = localBars[localBars.length - 1];
    const currentHtfBars = htfBars.filter((bar) => bar.openTime <= currentBar.openTime);

    if (localBars.length < warmupBars || currentHtfBars.length < 20) {
      continue;
    }

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
      strategyMeta: strategy,
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
        htfTrend:
          currentHtfBars.length >= 2 && currentHtfBars[currentHtfBars.length - 1].close >= currentHtfBars[currentHtfBars.length - 2].close
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
      line(name, value, options = {}) {
        plotsForBar.push({
          kind: "line",
          name,
          value: Number(value || 0),
          time: currentBar.time,
          pane: options.pane || "price",
          color: options.color || null
        });
      },
      histogram(name, value, options = {}) {
        plotsForBar.push({
          kind: "histogram",
          name,
          value: Number(value || 0),
          time: currentBar.time,
          pane: options.pane || "indicator",
          color: options.color || null
        });
      },
      band(name, upper, lower, options = {}) {
        plotsForBar.push({
          kind: "band",
          name,
          upper: Number(upper || 0),
          lower: Number(lower || 0),
          time: currentBar.time,
          pane: options.pane || "indicator",
          color: options.color || "rgba(26, 89, 83, 0.18)"
        });
      },
      marker(condition, text, options = {}) {
        if (!condition) return;
        addMarker(userMarkers, currentBar, text || "MARK", options);
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
      if (entry.kind === "line") {
        ensureLineStore(linePlots, entry.name, entry.pane, entry.color).points.push({
          time: entry.time,
          value: Number(entry.value.toFixed(6))
        });
      }

      if (entry.kind === "histogram") {
        ensureLineStore(histogramPlots, entry.name, entry.pane, entry.color).points.push({
          time: entry.time,
          value: Number(entry.value.toFixed(6))
        });
      }

      if (entry.kind === "band") {
        const band = ensureBandStore(bandPlots, entry.name, entry.pane, entry.color);
        band.upper.push({
          time: entry.time,
          value: Number(entry.upper.toFixed(6))
        });
        band.lower.push({
          time: entry.time,
          value: Number(entry.lower.toFixed(6))
        });
      }
    });

    signalsForBar.forEach((signal) => {
      signals.push(signal);
    });

    simulateSignalsForBar({
      signalsForBar,
      bar: currentBar,
      simulation,
      closedTrades,
      autoMarkers,
      settings: {
        symbol: settings.symbol,
        initialCapitalUsdt: initialCapital,
        inputs: resolvedInputs,
        feeRate: settings.feeRate || 0.0004
      }
    });

    const positionSnapshot = clonePosition(simulation.position, currentBar.close);
    const unrealizedPnl = positionSnapshot.unrealizedPnl || 0;
    simulation.equity = Number((simulation.balance + unrealizedPnl).toFixed(4));
    simulation.peakEquity = Math.max(simulation.peakEquity, simulation.equity);
    const drawdownPct = simulation.peakEquity
      ? ((simulation.peakEquity - simulation.equity) / simulation.peakEquity) * 100
      : 0;
    simulation.maxDrawdownPct = Math.max(simulation.maxDrawdownPct, drawdownPct);

    frames.push({
      replayIndex: frames.length,
      barIndex: index,
      time: currentBar.time,
      label: currentBar.label,
      close: currentBar.close,
      equity: Number(simulation.equity.toFixed(4)),
      balance: Number(simulation.balance.toFixed(4)),
      realizedPnl: Number((simulation.balance - initialCapital).toFixed(4)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(4)),
      drawdownPct: Number(drawdownPct.toFixed(4)),
      position: positionSnapshot,
      lastSignal: signalsForBar.length ? signalsForBar[signalsForBar.length - 1] : null,
      signals: signalsForBar.map((signal) => ({ ...signal })),
      closedTradesCount: closedTrades.length
    });
  }

  const summary = summarizeSimulation(simulation, closedTrades, initialCapital);

  return {
    strategy,
    resolvedInputs,
    signals,
    latestSignal: signals.length ? signals[signals.length - 1] : null,
    markers: [...userMarkers, ...autoMarkers],
    lines: Object.fromEntries(linePlots.entries()),
    histograms: Object.fromEntries(histogramPlots.entries()),
    bands: Object.fromEntries(bandPlots.entries()),
    diagnostics,
    trades: closedTrades,
    frames,
    summary
  };
}
