const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const raw = fs.readFileSync(filePath, "utf8");
  const values = {};

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  });

  return values;
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const rootDir = path.resolve(__dirname, "..", "..");
const bridgeDir = path.resolve(__dirname, "..");
const envPath = path.join(bridgeDir, ".env");
const envFromFile = loadEnvFile(envPath);
const env = { ...envFromFile, ...process.env };

const config = {
  rootDir,
  bridgeDir,
  dataDir: path.join(bridgeDir, "data"),
  port: asNumber(env.PORT, 8787),
  nodeEnv: env.NODE_ENV || "development",
  timezone: env.TIMEZONE || "America/Sao_Paulo",
  dryRun: asBoolean(env.DRY_RUN, true),

  symbol: (env.SYMBOL || "DOGEUSDT").toUpperCase(),
  market: env.MARKET || "usds_m_futures",
  timeframe: env.TIMEFRAME || "1m",
  htfTimeframe: env.HTF_TIMEFRAME || "4h",
  initialCapitalUsdt: asNumber(env.INITIAL_CAPITAL_USDT, 20),
  orderBudgetUsdt: asNumber(env.ORDER_BUDGET_USDT, 7),
  defaultLeverage: asNumber(env.DEFAULT_LEVERAGE, 5),
  maxLeverage: asNumber(env.MAX_LEVERAGE, 10),
  marginMode: (env.MARGIN_MODE || "ISOLATED").toUpperCase(),
  positionMode: (env.POSITION_MODE || "ONE_WAY").toUpperCase(),

  tvPassphrase: env.TV_PASSPHRASE || "",
  maxSignalAgeMs: asNumber(env.MAX_SIGNAL_AGE_MS, 120000),
  maxEntriesPerDay: asNumber(env.MAX_ENTRIES_PER_DAY, 6),
  dailyStopLossUsdt: asNumber(env.DAILY_STOP_LOSS_USDT, 1.5),
  maxConsecutiveLosses: asNumber(env.MAX_CONSECUTIVE_LOSSES, 3),
  dryRunFeeRate: asNumber(env.DRY_RUN_FEE_RATE, 0.0004),
  maxStoredEquityPoints: asNumber(env.MAX_STORED_EQUITY_POINTS, 1000),
  maxStoredTrades: asNumber(env.MAX_STORED_TRADES, 50),
  maxStoredNonces: asNumber(env.MAX_STORED_NONCES, 400),

  binanceBaseUrl: env.BINANCE_BASE_URL || "https://fapi.binance.com",
  binanceApiKey: env.BINANCE_API_KEY || "",
  binanceApiSecret: env.BINANCE_API_SECRET || "",
  binanceRecvWindow: asNumber(env.BINANCE_RECV_WINDOW, 5000),

  appsScriptSyncUrl: env.APPS_SCRIPT_SYNC_URL || "",
  appsScriptSyncToken: env.APPS_SCRIPT_SYNC_TOKEN || "",
  appsScriptSyncTimeoutMs: asNumber(env.APPS_SCRIPT_SYNC_TIMEOUT_MS, 3500)
};

module.exports = {
  config
};
