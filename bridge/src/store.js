const fs = require("fs");
const path = require("path");
const { getDayKey, nowIso } = require("./utils");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function jsonPath(config, name) {
  return path.join(config.dataDir, name);
}

function createDailyStats(dayKey) {
  return {
    dayKey,
    entryCount: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    realizedPnl: 0,
    fees: 0,
    funding: 0,
    consecutiveLosses: 0,
    stopActive: false
  };
}

function createRuntime(config) {
  const now = nowIso();
  const dayKey = getDayKey(config.timezone);

  return {
    version: 1,
    startedAt: now,
    updatedAt: now,
    mode: config.dryRun ? "dry_run" : "live",
    bot: {
      symbol: config.symbol,
      market: config.market,
      timeframe: config.timeframe,
      htfTimeframe: config.htfTimeframe,
      leverage: config.defaultLeverage,
      marginMode: config.marginMode,
      positionMode: config.positionMode
    },
    lastSignal: null,
    lastError: null,
    lastSyncAt: null,
    recentNonces: [],
    macro: {
      oil: {
        enabled: Boolean(config.polymarket?.enabled),
        macroRegime: config.polymarket?.enabled ? "BOOTING" : "DISABLED",
        macroStressScore: 0,
        stale: Boolean(config.polymarket?.enabled),
        fetchedAt: null,
        oilMarkets: []
      }
    },
    policy: {
      enabled: Boolean(config.deepseek?.enabled && config.deepseek?.apiKey),
      source: "bootstrap",
      required: Boolean(config.deepseek?.required),
      fetchedAt: null,
      stale: Boolean(config.deepseek?.enabled && config.deepseek?.required),
      riskMode: "NEUTRAL",
      allowedSide: "BOTH",
      leverageCap: config.defaultLeverage,
      stopProfile: "NORMAL",
      holdPolicy: "NORMAL",
      sessionFilter: "OFF",
      sessionStartHour: 0,
      sessionEndHour: 24,
      confidence: 0,
      noTrade: false,
      notes: "deepseek_disabled"
    },
    position: {
      side: "FLAT",
      qty: 0,
      entryPrice: 0,
      leverage: config.defaultLeverage,
      marginMode: config.marginMode,
      signalNonce: null,
      reason: null,
      openedAt: null,
      entryFees: 0
    },
    wallet: {
      walletBalance: config.initialCapitalUsdt,
      availableBalance: config.initialCapitalUsdt,
      marginUsed: 0,
      positionNotional: 0,
      markPrice: 0,
      unrealizedPnl: 0,
      totalEquity: config.initialCapitalUsdt,
      effectiveLeverage: 0
    },
    equitySeries: [],
    recentClosedTrades: [],
    risk: {
      peakEquity: config.initialCapitalUsdt,
      maxDrawdownPct: 0
    },
    daily: createDailyStats(dayKey),
    totals: {
      entryCount: 0,
      closedTrades: 0,
      wins: 0,
      losses: 0,
      realizedPnl: 0,
      fees: 0,
      funding: 0
    }
  };
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadRuntime(config) {
  ensureDir(config.dataDir);
  return readJson(jsonPath(config, "runtime.json"), createRuntime(config));
}

function saveRuntime(config, runtime) {
  ensureDir(config.dataDir);
  runtime.updatedAt = nowIso();
  writeJson(jsonPath(config, "runtime.json"), runtime);
}

function appendJsonl(config, fileName, payload) {
  ensureDir(config.dataDir);
  const filePath = jsonPath(config, fileName);
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

module.exports = {
  appendJsonl,
  createDailyStats,
  createRuntime,
  ensureDir,
  loadRuntime,
  readJson,
  saveRuntime,
  writeJson
};
