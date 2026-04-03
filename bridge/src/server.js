const http = require("http");
const { config } = require("./config");
const { BinanceApiError, BinanceFuturesClient } = require("./binance-futures-client");
const { DeepSeekPolicyEngine, buildDisabledPolicy } = require("./deepseek-policy-engine");
const { PolymarketOilAdapter } = require("./polymarket-oil-adapter");
const {
  buildEquityPayload,
  buildStatusPayload,
  evaluateSignal,
  noteClosedTrade,
  noteEntry,
  resetDailyIfNeeded,
  trackNonce,
  updateEquitySeries
} = require("./risk-engine");
const { syncToAppsScript } = require("./apps-script-sync");
const { appendJsonl, createRuntime, loadRuntime, saveRuntime } = require("./store");
const {
  abs,
  nowIso,
  positionSideFromQty,
  roundToStepDown,
  safeJsonParse,
  toNumber,
  weightedAverage
} = require("./utils");

const runtime = loadRuntime(config);
const client = config.dryRun ? null : new BinanceFuturesClient(config);
const oilAdapter = new PolymarketOilAdapter(config);
const policyEngine = new DeepSeekPolicyEngine(config);

let symbolRules = {
  symbol: config.symbol,
  minQty: 1,
  stepSize: 1,
  tickSize: 0.0001,
  minNotional: 5
};

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeSignal(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload JSON ausente ou invalido.");
  }

  const signal = {
    passphrase: payload.passphrase || "",
    source: payload.source || "unknown",
    strategyId: payload.strategy_id || "unknown_strategy",
    action: payload.action,
    symbol: String(payload.symbol || "").toUpperCase(),
    market: payload.market || "",
    interval: payload.interval || "",
    barTime: toNumber(payload.bar_time, 0),
    receivedAt: Date.now(),
    price: toNumber(payload.price, 0),
    leverage: toNumber(payload.leverage, config.defaultLeverage),
    marginMode: String(payload.margin_mode || config.marginMode).toUpperCase(),
    positionMode: String(payload.position_mode || config.positionMode).toUpperCase(),
    orderBudgetUsdt: toNumber(payload.order_budget_usdt, config.orderBudgetUsdt),
    qtyHint: toNumber(payload.qty_hint, 0),
    rsi: toNumber(payload.rsi, 0),
    atrPct: toNumber(payload.atr_pct, 0),
    htfTrend: String(payload.htf_trend || "NEUTRAL").toUpperCase(),
    htfRsi: toNumber(payload.htf_rsi, 0),
    reason: payload.reason || "",
    nonce: String(payload.nonce || "")
  };

  if (!signal.action || !["LONG_ENTRY", "SHORT_ENTRY", "FLAT_EXIT"].includes(signal.action)) {
    throw new Error("Action invalida.");
  }

  if (!signal.nonce) {
    throw new Error("Nonce ausente.");
  }

  if (!signal.symbol || signal.symbol !== config.symbol) {
    throw new Error(`Symbol invalido. Esperado ${config.symbol}.`);
  }

  if (signal.market !== config.market) {
    throw new Error(`Market invalido. Esperado ${config.market}.`);
  }

  if (signal.passphrase !== config.tvPassphrase) {
    throw new Error("Passphrase invalida.");
  }

  return signal;
}

function parseSymbolRules(exchangeInfo) {
  const symbol = Array.isArray(exchangeInfo.symbols) ? exchangeInfo.symbols[0] : null;
  if (!symbol) return symbolRules;

  const filters = {};
  (symbol.filters || []).forEach((filter) => {
    filters[filter.filterType] = filter;
  });

  const lotSize = filters.MARKET_LOT_SIZE || filters.LOT_SIZE || {};
  const priceFilter = filters.PRICE_FILTER || {};
  const notionalFilter = filters.MIN_NOTIONAL || filters.NOTIONAL || {};

  return {
    symbol: symbol.symbol,
    minQty: toNumber(lotSize.minQty, 1),
    stepSize: toNumber(lotSize.stepSize, 1),
    tickSize: toNumber(priceFilter.tickSize, 0.0001),
    minNotional: toNumber(notionalFilter.notional || notionalFilter.minNotional, 5)
  };
}

async function bootstrap() {
  if (runtime.equitySeries.length === 0) {
    updateEquitySeries(runtime, runtime.wallet, "NEUTRAL", config);
    saveRuntime(config, runtime);
  }

  try {
    if (client) {
      await client.syncTime();
      symbolRules = parseSymbolRules(await client.getExchangeInfo(config.symbol));
    } else {
      const response = await fetch(`${config.binanceBaseUrl}/fapi/v1/exchangeInfo?symbol=${encodeURIComponent(config.symbol)}`);
      if (response.ok) {
        symbolRules = parseSymbolRules(await response.json());
      }
    }
  } catch (error) {
    runtime.lastError = `Falha ao carregar filtros do simbolo: ${error.message}`;
    saveRuntime(config, runtime);
  }

  if (oilAdapter.isEnabled()) {
    try {
      runtime.macro = runtime.macro || {};
      runtime.macro.oil = await oilAdapter.fetchSnapshot({ force: true });
      saveRuntime(config, runtime);
    } catch (error) {
      runtime.lastError = `Falha ao carregar macro oil: ${error.message}`;
      saveRuntime(config, runtime);
    }
  }

  if (policyEngine.isEnabled()) {
    try {
      runtime.policy = await policyEngine.fetchPolicy({
        oil: runtime.macro?.oil || null,
        runtime: currentRuntimeState(),
        signal: {
          action: "BOOT",
          leverage: config.defaultLeverage,
          htfTrend: "NEUTRAL"
        }
      }, { force: true });
      saveRuntime(config, runtime);
    } catch (error) {
      runtime.lastError = `Falha ao carregar policy DeepSeek: ${error.message}`;
      runtime.policy = policyEngine.fallback(runtime.policy, error.message);
      saveRuntime(config, runtime);
    }
  } else {
    runtime.policy = runtime.policy || buildDisabledPolicy(config);
  }
}

function currentRuntimeState() {
  return {
    mode: runtime.mode,
    bot: runtime.bot,
    daily: runtime.daily,
    totals: runtime.totals,
    position: runtime.position,
    wallet: runtime.wallet,
    lastSignal: runtime.lastSignal,
    lastError: runtime.lastError,
    lastSyncAt: runtime.lastSyncAt,
    symbolRules,
    macro: runtime.macro || {
      oil: {
        enabled: false,
        macroRegime: "DISABLED",
        macroStressScore: 0,
        stale: false,
        oilMarkets: []
      }
    },
    policy: runtime.policy || buildDisabledPolicy(config)
  };
}

function staleOilSnapshot(errorMessage) {
  const previous = runtime.macro?.oil || null;
  const fetchedAt = previous?.fetchedAt || nowIso();
  return {
    enabled: Boolean(config.polymarket?.enabled),
    eventSlug: config.polymarket?.eventSlug || null,
    eventTitle: previous?.eventTitle || "WTI proxy",
    fetchedAt,
    updatedAt: previous?.updatedAt || fetchedAt,
    volume: toNumber(previous?.volume, 0),
    volume24hr: toNumber(previous?.volume24hr, 0),
    liquidity: toNumber(previous?.liquidity, 0),
    macroStressScore: toNumber(previous?.macroStressScore, 1),
    macroRegime: previous?.macroRegime || "STALE",
    oilMarkets: Array.isArray(previous?.oilMarkets) ? previous.oilMarkets : [],
    ageMs: config.polymarket?.staleMs ? config.polymarket.staleMs + 1 : 0,
    stale: true,
    fetchError: errorMessage
  };
}

function buildExecutionRecord(kind, side, orderSummary, signal) {
  return {
    timestamp: nowIso(),
    mode: config.dryRun ? "dry_run" : "live",
    symbol: config.symbol,
    kind,
    side,
    signalNonce: signal.nonce,
    orderId: orderSummary.orderId || null,
    clientOrderId: orderSummary.clientOrderId || null,
    price: orderSummary.avgPrice,
    qty: orderSummary.executedQty,
    fee: orderSummary.feeAmount,
    feeAsset: orderSummary.feeAsset || "USDT",
    notional: orderSummary.notional,
    reason: signal.reason
  };
}

function buildClosedTrade(side, openPosition, closeSummary, signal) {
  const qty = abs(closeSummary.executedQty || openPosition.qty);
  const entryPrice = toNumber(openPosition.entryPrice, 0);
  const exitPrice = toNumber(closeSummary.avgPrice, 0);
  const grossPnl =
    side === "LONG"
      ? (exitPrice - entryPrice) * qty
      : (entryPrice - exitPrice) * qty;
  const feesTotal = toNumber(openPosition.entryFees, 0) + toNumber(closeSummary.feeAmount, 0);
  const netPnl = grossPnl - feesTotal;
  const marginUsed = entryPrice && openPosition.leverage ? (entryPrice * qty) / openPosition.leverage : 0;
  const returnOnMarginPct = marginUsed ? (netPnl / marginUsed) * 100 : 0;

  return {
    tradeId: `${signal.nonce}-closed`,
    direction: side,
    entryTime: openPosition.openedAt,
    exitTime: nowIso(),
    symbol: config.symbol,
    entryPriceAvg: Number(entryPrice.toFixed(6)),
    exitPriceAvg: Number(exitPrice.toFixed(6)),
    qty: Number(qty.toFixed(4)),
    leverage: openPosition.leverage,
    grossPnl: Number(grossPnl.toFixed(6)),
    feesTotal: Number(feesTotal.toFixed(6)),
    fundingTotal: 0,
    netPnl: Number(netPnl.toFixed(6)),
    returnOnMarginPct: Number(returnOnMarginPct.toFixed(4)),
    durationSec: openPosition.openedAt
      ? Math.max(0, Math.round((Date.now() - new Date(openPosition.openedAt).getTime()) / 1000))
      : 0,
    exitReason: signal.reason || signal.action
  };
}

function markDryRunSnapshot(price) {
  const markPrice = toNumber(price, runtime.wallet.markPrice || runtime.position.entryPrice || 0);
  const qty = toNumber(runtime.position.qty, 0);
  const positionNotional = abs(qty * markPrice);
  const unrealizedPnl =
    runtime.position.side === "LONG"
      ? (markPrice - runtime.position.entryPrice) * qty
      : runtime.position.side === "SHORT"
      ? (runtime.position.entryPrice - markPrice) * qty
      : 0;
  const marginUsed = runtime.position.side === "FLAT" || !runtime.position.leverage
    ? 0
    : positionNotional / runtime.position.leverage;
  const totalEquity = runtime.wallet.walletBalance + unrealizedPnl;
  const availableBalance = runtime.wallet.walletBalance - marginUsed;

  runtime.wallet = {
    walletBalance: Number(runtime.wallet.walletBalance.toFixed(6)),
    availableBalance: Number(availableBalance.toFixed(6)),
    marginUsed: Number(marginUsed.toFixed(6)),
    positionNotional: Number(positionNotional.toFixed(6)),
    markPrice: Number(markPrice.toFixed(6)),
    unrealizedPnl: Number(unrealizedPnl.toFixed(6)),
    totalEquity: Number(totalEquity.toFixed(6)),
    effectiveLeverage: totalEquity > 0 ? Number((positionNotional / totalEquity).toFixed(4)) : 0
  };

  return runtime.wallet;
}

async function buildLiveSnapshot() {
  const [balances, positionRisk] = await Promise.all([
    client.getBalance(),
    client.getPositionRisk(config.symbol)
  ]);

  const usdtBalance = (balances || []).find((asset) => asset.asset === "USDT") || {};
  const position = Array.isArray(positionRisk) ? positionRisk[0] : positionRisk;
  const positionQty = toNumber(position?.positionAmt, 0);
  const positionSide = positionSideFromQty(positionQty);

  if (positionSide !== runtime.position.side) {
    runtime.position.side = positionSide;
    runtime.position.qty = abs(positionQty);
    runtime.position.entryPrice = toNumber(position?.entryPrice, 0);
    runtime.position.leverage = toNumber(position?.leverage, runtime.position.leverage || config.defaultLeverage);
    if (positionSide === "FLAT") {
      runtime.position.openedAt = null;
      runtime.position.entryFees = 0;
      runtime.position.signalNonce = null;
    }
  }

  const walletBalance = toNumber(usdtBalance.balance, config.initialCapitalUsdt);
  const unrealizedPnl = toNumber(position?.unRealizedProfit, 0);
  const totalEquity = walletBalance + unrealizedPnl;

  runtime.wallet = {
    walletBalance: Number(walletBalance.toFixed(6)),
    availableBalance: Number(toNumber(usdtBalance.availableBalance, config.initialCapitalUsdt).toFixed(6)),
    marginUsed: Number(toNumber(position?.isolatedMargin, 0).toFixed(6)),
    positionNotional: Number(abs(position?.notional).toFixed(6)),
    markPrice: Number(toNumber(position?.markPrice, runtime.wallet.markPrice).toFixed(6)),
    unrealizedPnl: Number(unrealizedPnl.toFixed(6)),
    totalEquity: Number(totalEquity.toFixed(6)),
    effectiveLeverage: totalEquity > 0 ? Number((abs(toNumber(position?.notional, 0)) / totalEquity).toFixed(4)) : 0
  };

  return runtime.wallet;
}

function buildOrderQuantity(signal, markPrice) {
  const leverage = Math.min(signal.leverage || config.defaultLeverage, config.maxLeverage);
  const targetNotional = (signal.orderBudgetUsdt || config.orderBudgetUsdt) * leverage;
  const price = markPrice || signal.price;
  const qtyFromBudget = price > 0 ? targetNotional / price : 0;
  const hintedQty = signal.qtyHint > 0 ? signal.qtyHint : qtyFromBudget;
  const qty = roundToStepDown(hintedQty, symbolRules.stepSize);
  const notional = qty * price;

  if (qty < symbolRules.minQty) {
    throw new Error(`Quantidade abaixo do minQty do contrato: ${qty} < ${symbolRules.minQty}`);
  }

  if (notional < symbolRules.minNotional) {
    throw new Error(`Notional abaixo do minimo do contrato: ${notional.toFixed(4)} < ${symbolRules.minNotional}`);
  }

  return Number(qty.toFixed(8));
}

function summarizeDryRunOrder(side, quantity, price, feeRate) {
  const executedQty = abs(quantity);
  const avgPrice = toNumber(price, 0);
  const notional = executedQty * avgPrice;
  const feeAmount = notional * feeRate;

  return {
    orderId: `dry-${Date.now()}`,
    clientOrderId: `dry-${side.toLowerCase()}-${Date.now()}`,
    executedQty,
    avgPrice,
    feeAmount,
    feeAsset: "USDT",
    notional
  };
}

async function fetchOrderFees(orderResponse, fallbackPrice) {
  const trades = await client.getUserTrades(config.symbol, orderResponse.orderId);
  const feeAmount = trades.reduce((sum, trade) => sum + toNumber(trade.commission, 0), 0);
  const feeAsset = trades[0]?.commissionAsset || "USDT";
  const executedQty = toNumber(orderResponse.executedQty, 0) || trades.reduce((sum, trade) => sum + toNumber(trade.qty, 0), 0);
  const avgPrice =
    toNumber(orderResponse.avgPrice, 0) ||
    weightedAverage(trades, "qty", "price") ||
    toNumber(fallbackPrice, 0);

  return {
    orderId: orderResponse.orderId,
    clientOrderId: orderResponse.clientOrderId,
    executedQty,
    avgPrice,
    feeAmount,
    feeAsset,
    notional: executedQty * avgPrice
  };
}

async function ensureLiveSetup(signal) {
  await client.changePositionMode(false).catch((error) => {
    if (!(error instanceof BinanceApiError) || ![-4059].includes(error.code)) throw error;
  });

  await client.changeMarginType(config.symbol, signal.marginMode).catch((error) => {
    if (!(error instanceof BinanceApiError) || ![-4046].includes(error.code)) throw error;
  });

  await client.changeLeverage(config.symbol, signal.leverage);
}

async function processDryRun(signal) {
  const executions = [];
  let closedTrade = null;

  if (signal.action === "FLAT_EXIT" && runtime.position.side === "FLAT") {
    return {
      accepted: false,
      ignored: true,
      reason: "already_flat",
      executions,
      closedTrade,
      snapshot: markDryRunSnapshot(signal.price)
    };
  }

  const desiredSide =
    signal.action === "LONG_ENTRY"
      ? "LONG"
      : signal.action === "SHORT_ENTRY"
      ? "SHORT"
      : "FLAT";

  if (desiredSide !== "FLAT" && runtime.position.side === desiredSide) {
    return {
      accepted: false,
      ignored: true,
      reason: "already_in_position",
      executions,
      closedTrade,
      snapshot: markDryRunSnapshot(signal.price)
    };
  }

  if (runtime.position.side !== "FLAT" && (signal.action === "FLAT_EXIT" || runtime.position.side !== desiredSide)) {
    const closeSide = runtime.position.side === "LONG" ? "SELL" : "BUY";
    const closeSummary = summarizeDryRunOrder(closeSide, runtime.position.qty, signal.price, config.dryRunFeeRate);
    executions.push(buildExecutionRecord("close", closeSide, closeSummary, signal));
    closedTrade = buildClosedTrade(runtime.position.side, runtime.position, closeSummary, signal);
    runtime.wallet.walletBalance += closedTrade.grossPnl - closeSummary.feeAmount;
    noteClosedTrade(runtime, closedTrade, config);
    runtime.position = createRuntime(config).position;
  }

  if (desiredSide !== "FLAT") {
    const openQty = buildOrderQuantity(signal, signal.price);
    const openSide = desiredSide === "LONG" ? "BUY" : "SELL";
    const openSummary = summarizeDryRunOrder(openSide, openQty, signal.price, config.dryRunFeeRate);
    runtime.wallet.walletBalance -= openSummary.feeAmount;
    runtime.position = {
      side: desiredSide,
      qty: openSummary.executedQty,
      entryPrice: openSummary.avgPrice,
      leverage: signal.leverage,
      marginMode: signal.marginMode,
      signalNonce: signal.nonce,
      reason: signal.reason,
      openedAt: nowIso(),
      entryFees: openSummary.feeAmount
    };
    executions.push(buildExecutionRecord("open", openSide, openSummary, signal));
    noteEntry(runtime);
  }

  return {
    accepted: true,
    executions,
    closedTrade,
    snapshot: markDryRunSnapshot(signal.price)
  };
}

async function processLive(signal) {
  const executions = [];
  let closedTrade = null;

  await ensureLiveSetup(signal);
  await buildLiveSnapshot();

  const desiredSide =
    signal.action === "LONG_ENTRY"
      ? "LONG"
      : signal.action === "SHORT_ENTRY"
      ? "SHORT"
      : "FLAT";

  if (signal.action === "FLAT_EXIT" && runtime.position.side === "FLAT") {
    return { accepted: false, ignored: true, reason: "already_flat", executions, closedTrade, snapshot: runtime.wallet };
  }

  if (desiredSide !== "FLAT" && runtime.position.side === desiredSide) {
    return { accepted: false, ignored: true, reason: "already_in_position", executions, closedTrade, snapshot: runtime.wallet };
  }

  if (runtime.position.side !== "FLAT" && (signal.action === "FLAT_EXIT" || runtime.position.side !== desiredSide)) {
    const closeSide = runtime.position.side === "LONG" ? "SELL" : "BUY";
    const closeOrder = await client.placeOrder({
      symbol: config.symbol,
      side: closeSide,
      type: "MARKET",
      quantity: runtime.position.qty,
      reduceOnly: "true",
      newOrderRespType: "RESULT",
      newClientOrderId: `tv-close-${Date.now()}`
    });
    const closeSummary = await fetchOrderFees(closeOrder, signal.price);
    executions.push(buildExecutionRecord("close", closeSide, closeSummary, signal));
    closedTrade = buildClosedTrade(runtime.position.side, runtime.position, closeSummary, signal);
    noteClosedTrade(runtime, closedTrade, config);
    runtime.position = createRuntime(config).position;
  }

  if (desiredSide !== "FLAT") {
    const markPrice = runtime.wallet.markPrice || signal.price;
    const openQty = buildOrderQuantity(signal, markPrice);
    const openSide = desiredSide === "LONG" ? "BUY" : "SELL";
    const openOrder = await client.placeOrder({
      symbol: config.symbol,
      side: openSide,
      type: "MARKET",
      quantity: openQty,
      newOrderRespType: "RESULT",
      newClientOrderId: `tv-open-${Date.now()}`
    });
    const openSummary = await fetchOrderFees(openOrder, signal.price);
    runtime.position = {
      side: desiredSide,
      qty: openSummary.executedQty,
      entryPrice: openSummary.avgPrice,
      leverage: signal.leverage,
      marginMode: signal.marginMode,
      signalNonce: signal.nonce,
      reason: signal.reason,
      openedAt: nowIso(),
      entryFees: openSummary.feeAmount
    };
    executions.push(buildExecutionRecord("open", openSide, openSummary, signal));
    noteEntry(runtime);
  }

  return {
    accepted: true,
    executions,
    closedTrade,
    snapshot: await buildLiveSnapshot()
  };
}

async function processSignal(signal) {
  resetDailyIfNeeded(runtime, config, signal.receivedAt);
  runtime.macro = runtime.macro || {};
  runtime.policy = runtime.policy || buildDisabledPolicy(config);

  let macroSnapshot = runtime.macro.oil || null;
  if (oilAdapter.isEnabled()) {
    try {
      macroSnapshot = await oilAdapter.fetchSnapshot({ force: signal.action !== "FLAT_EXIT" });
      runtime.macro.oil = macroSnapshot;
    } catch (error) {
      runtime.lastError = `Falha Polymarket oil: ${error.message}`;
      macroSnapshot = staleOilSnapshot(error.message);
      runtime.macro.oil = macroSnapshot;
    }
  }

  let policySnapshot = runtime.policy || buildDisabledPolicy(config);
  if (policyEngine.isEnabled()) {
    try {
      policySnapshot = await policyEngine.fetchPolicy({
        oil: macroSnapshot,
        runtime: currentRuntimeState(),
        signal
      }, {
        force: signal.action !== "FLAT_EXIT"
      });
      runtime.policy = policySnapshot;
    } catch (error) {
      runtime.lastError = `Falha DeepSeek policy: ${error.message}`;
      policySnapshot = policyEngine.fallback(runtime.policy, error.message);
      runtime.policy = policySnapshot;
    }
  }

  if (policySnapshot && signal.action !== "FLAT_EXIT") {
    signal.leverage = Math.min(signal.leverage || config.defaultLeverage, toNumber(policySnapshot.leverageCap, config.defaultLeverage), config.maxLeverage);
  }

  const decision = evaluateSignal(runtime, signal, config, {
    oil: macroSnapshot,
    policy: policySnapshot
  });
  appendJsonl(config, "signals.jsonl", {
    timestamp: nowIso(),
    signal,
    decision,
    macro: macroSnapshot,
    policy: policySnapshot
  });

  if (!decision.ok) {
    if (decision.reason !== "duplicate_nonce") {
      trackNonce(runtime, signal, config);
    }
    const snapshot = config.dryRun ? markDryRunSnapshot(signal.price) : await buildLiveSnapshot();
    const status = buildStatusPayload(runtime, snapshot, config, {
      oil: macroSnapshot,
      policy: policySnapshot
    });
    const equity = buildEquityPayload(runtime, config);
    saveRuntime(config, runtime);
    return {
      ok: true,
      accepted: false,
      ignored: true,
      reason: decision.reason,
      status,
      equity
    };
  }

  trackNonce(runtime, signal, config);
  const result = config.dryRun ? await processDryRun(signal) : await processLive(signal);
  const regime = signal.htfTrend || "NEUTRAL";
  const equityPoint = updateEquitySeries(runtime, result.snapshot, regime, config);
  const status = buildStatusPayload(runtime, result.snapshot, config, {
    oil: macroSnapshot,
    policy: policySnapshot
  });
  const equity = buildEquityPayload(runtime, config);

  result.executions.forEach((entry) => appendJsonl(config, "executions.jsonl", entry));
  if (result.closedTrade) {
    appendJsonl(config, "trades.jsonl", result.closedTrade);
  }

  const syncPayload = {
    status,
    equity,
    runtime: currentRuntimeState(),
    macro: macroSnapshot,
    policy: policySnapshot,
    executions: result.executions,
    trades: result.closedTrade ? [result.closedTrade] : [],
    equityPoint
  };

  try {
    const syncResult = await syncToAppsScript(config, syncPayload);
    runtime.lastSyncAt = syncResult.ok ? nowIso() : runtime.lastSyncAt;
    if (!syncResult.ok && !syncResult.skipped) {
      runtime.lastError = `Falha ao sincronizar Apps Script: HTTP ${syncResult.status || "?"}`;
    } else if (syncResult.ok) {
      runtime.lastError = null;
    }
    appendJsonl(config, "sync.jsonl", {
      timestamp: nowIso(),
      syncResult
    });
  } catch (error) {
    runtime.lastError = `Falha ao sincronizar Apps Script: ${error.message}`;
    appendJsonl(config, "sync.jsonl", {
      timestamp: nowIso(),
      error: error.message
    });
  }

  saveRuntime(config, runtime);

  return {
    ok: true,
    accepted: result.accepted,
    ignored: Boolean(result.ignored),
    reason: result.reason || null,
    status,
    equity
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "doge-tv-binance-bridge",
        mode: config.dryRun ? "dry_run" : "live",
        timestamp: nowIso(),
        symbol: config.symbol,
        appsScriptSync: Boolean(config.appsScriptSyncUrl)
      });
    }

    if (req.method === "GET" && url.pathname === "/state") {
      return json(res, 200, currentRuntimeState());
    }

    if (req.method === "GET" && url.pathname === "/macro/oil") {
      if (oilAdapter.isEnabled()) {
        runtime.macro = runtime.macro || {};
        runtime.macro.oil = await oilAdapter.fetchSnapshot();
      }
      return json(res, 200, runtime.macro?.oil || staleOilSnapshot("macro_not_initialized"));
    }

    if (req.method === "GET" && url.pathname === "/policy") {
      if (policyEngine.isEnabled()) {
        try {
          runtime.policy = await policyEngine.fetchPolicy({
            oil: runtime.macro?.oil || null,
            runtime: currentRuntimeState(),
            signal: {
              action: "MANUAL_CHECK",
              leverage: config.defaultLeverage,
              htfTrend: runtime.lastSignal?.htfTrend || "NEUTRAL"
            }
          });
        } catch (error) {
          runtime.lastError = `Falha DeepSeek policy: ${error.message}`;
          runtime.policy = policyEngine.fallback(runtime.policy, error.message);
          saveRuntime(config, runtime);
        }
      }
      return json(res, 200, runtime.policy || buildDisabledPolicy(config));
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const rawBody = await parseBody(req);
      const payload = safeJsonParse(rawBody);
      const signal = normalizeSignal(payload);
      const result = await processSignal(signal);
      return json(res, 200, result);
    }

    return json(res, 404, {
      ok: false,
      error: "not_found"
    });
  } catch (error) {
    runtime.lastError = error.message;
    saveRuntime(config, runtime);
    appendJsonl(config, "errors.jsonl", {
      timestamp: nowIso(),
      message: error.message,
      stack: error.stack
    });

    return json(res, error.status || 400, {
      ok: false,
      error: error.message,
      code: error.code || null
    });
  }
});

bootstrap()
  .then(() => {
    server.listen(config.port, () => {
      console.log(
        `[bridge] ${config.symbol} pronto em http://localhost:${config.port} (${config.dryRun ? "dry-run" : "live"})`
      );
    });
  })
  .catch((error) => {
    console.error("[bridge] falha no bootstrap:", error);
    process.exitCode = 1;
  });
