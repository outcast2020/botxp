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
  appMode: env.APP_MODE || "trade",
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
  appsScriptSyncTimeoutMs: asNumber(env.APPS_SCRIPT_SYNC_TIMEOUT_MS, 3500),

  polymarket: {
    enabled: asBoolean(env.POLYMARKET_ENABLED, true),
    gammaBaseUrl: env.POLYMARKET_GAMMA_BASE_URL || "https://gamma-api.polymarket.com",
    clobBaseUrl: env.POLYMARKET_CLOB_BASE_URL || "https://clob.polymarket.com",
    eventSlug: env.POLYMARKET_EVENT_SLUG || "what-price-will-wti-hit-in-april-2026",
    refreshMs: asNumber(env.POLYMARKET_REFRESH_MS, 60000),
    staleMs: asNumber(env.POLYMARKET_STALE_MS, 90000),
    hardBlockScore: asNumber(env.POLYMARKET_HARD_BLOCK_SCORE, 0.9)
  },

  backtestStart: env.BACKTEST_START || "",
  backtestEnd: env.BACKTEST_END || "",
  backtestLookbackDays: asNumber(env.BACKTEST_LOOKBACK_DAYS, 21),
  backtestWarmupBars: asNumber(env.BACKTEST_WARMUP_BARS, 600),
  backtestDatasetForwardBars: asNumber(env.BACKTEST_DATASET_FORWARD_BARS, 15),
  backtestOutputPrefix: env.BACKTEST_OUTPUT_PREFIX || "backtest",

  strategy: {
    emaFastLen: asNumber(env.EMA_FAST_LEN, 9),
    emaSlowLen: asNumber(env.EMA_SLOW_LEN, 34),
    emaTrendLen: asNumber(env.EMA_TREND_LEN, 89),
    htfFastLen: asNumber(env.HTF_EMA_FAST_LEN, 21),
    htfSlowLen: asNumber(env.HTF_EMA_SLOW_LEN, 55),
    htfBaseLen: asNumber(env.HTF_EMA_BASE_LEN, 200),
    bbLen: asNumber(env.BB_LEN, 20),
    bbDev: asNumber(env.BB_DEV, 2),
    rsiLen: asNumber(env.RSI_LEN, 7),
    htfRsiLen: asNumber(env.HTF_RSI_LEN, 14),
    longOversoldRsi: asNumber(env.LONG_OVERSOLD_RSI, 38),
    shortOverboughtRsi: asNumber(env.SHORT_OVERBOUGHT_RSI, 62),
    longExitRsi: asNumber(env.LONG_EXIT_RSI, 55),
    shortExitRsi: asNumber(env.SHORT_EXIT_RSI, 45),
    atrLen: asNumber(env.ATR_LEN, 14),
    minAtrPct: asNumber(env.MIN_ATR_PCT, 0.2),
    maxAtrPct: asNumber(env.MAX_ATR_PCT, 1.2),
    takeProfitPct: asNumber(env.TAKE_PROFIT_PCT, 0.9),
    stopLossPct: asNumber(env.STOP_LOSS_PCT, 0.6),
    breakEvenArmPct: asNumber(env.BREAK_EVEN_ARM_PCT, 0.35),
    breakEvenLockPct: asNumber(env.BREAK_EVEN_LOCK_PCT, 0.08),
    trailArmPct: asNumber(env.TRAIL_ARM_PCT, 0.6),
    trailAtrAligned: asNumber(env.TRAIL_ATR_ALIGNED, 1.3),
    trailAtrRisk: asNumber(env.TRAIL_ATR_RISK, 0.75)
  }
};

module.exports = {
  config
};
