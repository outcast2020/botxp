const { nowIso, toNumber } = require("./utils");

const ALLOWED_SIDES = new Set(["BOTH", "LONG_ONLY", "SHORT_ONLY", "NO_TRADE"]);
const RISK_MODES = new Set(["RISK_ON", "NEUTRAL", "RISK_OFF"]);
const STOP_PROFILES = new Set(["NORMAL", "TIGHT", "WIDE"]);
const HOLD_POLICIES = new Set(["NORMAL", "SCALP_ONLY", "NO_NEW_SWINGS"]);
const SESSION_FILTERS = new Set(["OFF", "CUSTOM"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || "").toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function buildDisabledPolicy(config, notes = "deepseek_disabled") {
  return {
    enabled: false,
    source: "disabled",
    required: Boolean(config.deepseek.required),
    fetchedAt: nowIso(),
    stale: false,
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
    notes
  };
}

function buildFallbackPolicy(config, previous, errorMessage) {
  const base = previous || buildDisabledPolicy(config, "deepseek_fallback");
  return {
    ...base,
    enabled: Boolean(config.deepseek.enabled && config.deepseek.apiKey),
    source: "fallback",
    required: Boolean(config.deepseek.required),
    stale: true,
    fetchedAt: base.fetchedAt || nowIso(),
    notes: errorMessage || base.notes || "deepseek_policy_unavailable"
  };
}

function normalizePolicy(rawPolicy, config) {
  const leverageCap = clamp(
    Math.round(toNumber(rawPolicy.leverage_cap, config.defaultLeverage)),
    1,
    config.maxLeverage
  );

  const allowedSide = normalizeEnum(rawPolicy.allowed_side, ALLOWED_SIDES, "BOTH");
  const riskMode = normalizeEnum(rawPolicy.risk_mode, RISK_MODES, "NEUTRAL");

  return {
    enabled: true,
    source: "deepseek",
    required: Boolean(config.deepseek.required),
    fetchedAt: nowIso(),
    stale: false,
    riskMode,
    allowedSide,
    leverageCap,
    stopProfile: normalizeEnum(rawPolicy.stop_profile, STOP_PROFILES, "NORMAL"),
    holdPolicy: normalizeEnum(rawPolicy.hold_policy, HOLD_POLICIES, "NORMAL"),
    sessionFilter: normalizeEnum(rawPolicy.session_filter, SESSION_FILTERS, "OFF"),
    sessionStartHour: clamp(Math.round(toNumber(rawPolicy.session_start_hour, 0)), 0, 23),
    sessionEndHour: clamp(Math.round(toNumber(rawPolicy.session_end_hour, 24)), 0, 24),
    confidence: Number(clamp(toNumber(rawPolicy.confidence, 0), 0, 1).toFixed(4)),
    noTrade: Boolean(rawPolicy.no_trade || allowedSide === "NO_TRADE"),
    notes: String(rawPolicy.notes || "")
  };
}

function buildContextPayload(context, config) {
  const oil = context.oil || {};
  const signal = context.signal || {};
  const runtime = context.runtime || {};

  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    htfTimeframe: config.htfTimeframe,
    account: {
      initialCapitalUsdt: config.initialCapitalUsdt,
      walletBalance: runtime.wallet?.walletBalance || null,
      totalEquity: runtime.wallet?.totalEquity || null,
      positionSide: runtime.position?.side || "FLAT",
      dailyRealizedPnl: runtime.daily?.realizedPnl || 0,
      consecutiveLosses: runtime.daily?.consecutiveLosses || 0
    },
    signal: {
      action: signal.action || "NONE",
      price: signal.price || null,
      leverage: signal.leverage || config.defaultLeverage,
      htfTrend: signal.htfTrend || "NEUTRAL",
      htfRsi: signal.htfRsi || null,
      rsi: signal.rsi || null,
      atrPct: signal.atrPct || null
    },
    oil: {
      macroRegime: oil.macroRegime || "UNKNOWN",
      macroStressScore: oil.macroStressScore || 0,
      volume24hr: oil.volume24hr || 0,
      riskMarkers: oil.riskMarkers || {},
      topMarkets: Array.isArray(oil.oilMarkets) ? oil.oilMarkets.slice(0, 4) : []
    },
    guardrails: {
      maxLeverage: config.maxLeverage,
      defaultLeverage: config.defaultLeverage,
      preferCapitalPreservation: true,
      neverSendOrdersDirectlyFromModel: true
    }
  };
}

function buildMessages(context, config) {
  const payload = buildContextPayload(context, config);
  const policyExample = {
    risk_mode: "NEUTRAL",
    allowed_side: "BOTH",
    leverage_cap: config.defaultLeverage,
    stop_profile: "NORMAL",
    hold_policy: "SCALP_ONLY",
    session_filter: "CUSTOM",
    session_start_hour: 9,
    session_end_hour: 18,
    confidence: 0.72,
    no_trade: false,
    notes: "Keep risk moderate while oil stress remains elevated."
  };

  return [
    {
      role: "system",
      content:
        "You are a geopolitical risk policy engine for a DOGEUSDT leveraged scalper. " +
        "You must return only valid json. " +
        "Use only the provided json context. " +
        "Treat Polymarket oil as a macro stress proxy, not as a direct DOGE price predictor. " +
        "Be conservative for small accounts and leveraged trading. " +
        `JSON schema example: ${JSON.stringify(policyExample)}`
    },
    {
      role: "user",
      content:
        "Analyze this json context and return a risk policy json object. " +
        "Prefer capital preservation over activity. " +
        `Context JSON: ${JSON.stringify(payload)}`
    }
  ];
}

class DeepSeekPolicyEngine {
  constructor(config) {
    this.config = config;
    this.policyConfig = config.deepseek;
    this.cache = {
      policy: null,
      fetchedAtMs: 0
    };
  }

  isEnabled() {
    return Boolean(this.policyConfig.enabled && this.policyConfig.apiKey);
  }

  async fetchPolicy(context = {}, options = {}) {
    if (!this.policyConfig.enabled) {
      return buildDisabledPolicy(this.config, "deepseek_disabled");
    }

    if (!this.policyConfig.apiKey) {
      return buildDisabledPolicy(this.config, "deepseek_api_key_missing");
    }

    const force = Boolean(options.force);
    const ageMs = Date.now() - this.cache.fetchedAtMs;
    if (!force && this.cache.policy && ageMs < this.policyConfig.refreshMs) {
      return this.decoratePolicy(this.cache.policy);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.policyConfig.timeoutMs);

    try {
      const response = await fetch(`${this.policyConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.policyConfig.apiKey}`
        },
        body: JSON.stringify({
          model: this.policyConfig.model,
          temperature: this.policyConfig.temperature,
          max_tokens: this.policyConfig.maxTokens,
          response_format: { type: "json_object" },
          messages: buildMessages(context, this.config)
        }),
        signal: controller.signal
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`DeepSeek HTTP ${response.status}: ${JSON.stringify(payload)}`);
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("DeepSeek returned empty content");
      }

      const parsed = JSON.parse(content);
      const normalized = normalizePolicy(parsed, this.config);
      this.cache.policy = normalized;
      this.cache.fetchedAtMs = Date.now();
      return this.decoratePolicy(normalized);
    } finally {
      clearTimeout(timeout);
    }
  }

  decoratePolicy(policy) {
    const ageMs = Date.now() - this.cache.fetchedAtMs;
    return {
      ...policy,
      ageMs,
      stale: ageMs > this.policyConfig.staleMs
    };
  }

  fallback(previous, errorMessage) {
    return buildFallbackPolicy(this.config, previous, errorMessage);
  }
}

module.exports = {
  DeepSeekPolicyEngine,
  buildDisabledPolicy,
  buildFallbackPolicy
};
