const { nowIso, toNumber } = require("./utils");

function parseJsonArray(rawValue, fallback = []) {
  if (!rawValue) return fallback;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function parseTargetFromQuestion(question) {
  const match = String(question || "").match(/\$([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}

function parseDirection(question) {
  const text = String(question || "").toUpperCase();
  if (text.includes("(HIGH)")) return "HIGH";
  if (text.includes("(LOW)")) return "LOW";
  return "UNKNOWN";
}

function midpointForMarket(market) {
  const bid = toNumber(market.bestBid, 0);
  const ask = toNumber(market.bestAsk, 0);
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return toNumber(market.lastTradePrice, 0);
}

function normalizeOilMarkets(markets) {
  return (markets || [])
    .map((market) => {
      const tokenIds = parseJsonArray(market.clobTokenIds);
      return {
        marketId: market.id,
        question: market.question,
        slug: market.slug,
        direction: parseDirection(market.question),
        target: parseTargetFromQuestion(market.question),
        label: market.groupItemTitle || market.question,
        yesTokenId: tokenIds[0] || null,
        noTokenId: tokenIds[1] || null,
        bestBid: toNumber(market.bestBid, 0),
        bestAsk: toNumber(market.bestAsk, 0),
        spread: toNumber(market.spread, 0),
        lastTradePrice: toNumber(market.lastTradePrice, 0),
        midpoint: midpointForMarket(market),
        volume24hr: toNumber(market.volume24hrClob || market.volume24hr, 0),
        liquidity: toNumber(market.liquidityClob || market.liquidityNum || market.liquidity, 0)
      };
    })
    .filter((market) => market.target != null && market.direction !== "UNKNOWN")
    .sort((left, right) => left.target - right.target);
}

function computeMacroStressScore(markets) {
  const upward = markets.filter((market) => market.direction === "HIGH" && market.target >= 120);
  if (!upward.length) return 0;

  const weightedSum = upward.reduce((sum, market) => {
    const distanceWeight =
      market.target <= 120 ? 1 :
      market.target <= 130 ? 0.85 :
      market.target <= 140 ? 0.65 :
      market.target <= 150 ? 0.45 :
      market.target <= 160 ? 0.30 :
      0.20;

    return sum + (market.midpoint * distanceWeight);
  }, 0);

  const maxWeight = upward.reduce((sum, market) => {
    if (market.target <= 120) return sum + 1;
    if (market.target <= 130) return sum + 0.85;
    if (market.target <= 140) return sum + 0.65;
    if (market.target <= 150) return sum + 0.45;
    if (market.target <= 160) return sum + 0.30;
    return sum + 0.20;
  }, 0);

  return maxWeight ? weightedSum / maxWeight : 0;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Polymarket request falhou (${response.status}): ${JSON.stringify(json)}`);
  }

  return json;
}

async function fetchMidpoint(clobBaseUrl, tokenId) {
  if (!tokenId) return 0;

  const url = new URL("/midpoint", clobBaseUrl.replace(/\/+$/, ""));
  url.searchParams.set("token_id", tokenId);

  const payload = await fetchJson(url.toString());
  return toNumber(payload.mid, 0);
}

async function fetchPriceHistory(clobBaseUrl, tokenId, interval) {
  if (!tokenId) return [];

  const url = new URL("/prices-history", clobBaseUrl.replace(/\/+$/, ""));
  url.searchParams.set("market", tokenId);
  url.searchParams.set("interval", interval);
  url.searchParams.set("fidelity", "1");

  const payload = await fetchJson(url.toString());
  if (Array.isArray(payload?.history)) return payload.history;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractEdgeValue(history) {
  if (!history.length) return null;
  const first = history[0];
  const last = history[history.length - 1];
  const firstPrice = toNumber(first.p || first.price, 0);
  const lastPrice = toNumber(last.p || last.price, 0);
  if (firstPrice <= 0 || lastPrice <= 0) return null;
  return ((lastPrice / firstPrice) - 1);
}

function extractWindowChange(history, windowSeconds) {
  if (!history.length) return null;

  const last = history[history.length - 1];
  const lastTs = toNumber(last.t || last.timestamp, 0);
  const lastPrice = toNumber(last.p || last.price, 0);
  if (!lastTs || lastPrice <= 0) return null;

  const lowerBound = lastTs - windowSeconds;
  const first = history.find((point) => toNumber(point.t || point.timestamp, 0) >= lowerBound) || history[0];
  const firstPrice = toNumber(first.p || first.price, 0);

  if (firstPrice <= 0) return null;
  return ((lastPrice / firstPrice) - 1);
}

class PolymarketOilAdapter {
  constructor(config) {
    this.config = config.polymarket;
    this.cache = {
      snapshot: null,
      fetchedAtMs: 0
    };
  }

  isEnabled() {
    return Boolean(this.config.enabled && this.config.eventSlug);
  }

  async fetchSnapshot(options = {}) {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        macroRegime: "DISABLED",
        macroStressScore: 0,
        stale: false,
        fetchedAt: nowIso(),
        oilMarkets: []
      };
    }

    const force = Boolean(options.force);
    const ageMs = Date.now() - this.cache.fetchedAtMs;
    if (!force && this.cache.snapshot && ageMs < this.config.refreshMs) {
      return this.decorateSnapshot(this.cache.snapshot);
    }

    const gammaUrl = `${this.config.gammaBaseUrl.replace(/\/+$/, "")}/events/slug/${encodeURIComponent(this.config.eventSlug)}`;
    const event = await fetchJson(gammaUrl);
    const normalizedMarkets = normalizeOilMarkets(event.markets);

    const candidateMarkets = normalizedMarkets
      .filter((market) => market.direction === "HIGH" && market.target >= 120)
      .slice(0, 6);

    const enrichedMarkets = await Promise.all(
      candidateMarkets.map(async (market) => {
        const [midpoint, history1h, history1d] = await Promise.all([
          fetchMidpoint(this.config.clobBaseUrl, market.yesTokenId).catch(() => market.midpoint),
          fetchPriceHistory(this.config.clobBaseUrl, market.yesTokenId, "1h").catch(() => []),
          fetchPriceHistory(this.config.clobBaseUrl, market.yesTokenId, "1d").catch(() => [])
        ]);

        return {
          label: market.label,
          question: market.question,
          slug: market.slug,
          target: market.target,
          direction: market.direction,
          midpoint: Number(midpoint.toFixed(4)),
          spread: Number(market.spread.toFixed(4)),
          lastTradePrice: Number(market.lastTradePrice.toFixed(4)),
          bestBid: Number(market.bestBid.toFixed(4)),
          bestAsk: Number(market.bestAsk.toFixed(4)),
          volume24hr: Number(market.volume24hr.toFixed(2)),
          liquidity: Number(market.liquidity.toFixed(2)),
          priceChange15m: Number((extractWindowChange(history1h, 15 * 60) || 0).toFixed(4)),
          priceChange1h: Number((extractEdgeValue(history1h) || 0).toFixed(4)),
          priceChange1d: Number((extractEdgeValue(history1d) || 0).toFixed(4))
        };
      })
    );

    const macroStressScore = computeMacroStressScore(enrichedMarkets);
    const macroRegime =
      macroStressScore >= this.config.hardBlockScore
        ? "RISK_OFF"
        : macroStressScore >= 0.7
        ? "ELEVATED"
        : macroStressScore >= 0.45
        ? "NEUTRAL"
        : "RISK_ON";

    const snapshot = {
      enabled: true,
      eventSlug: event.slug,
      eventTitle: event.title,
      fetchedAt: nowIso(),
      updatedAt: event.updatedAt || nowIso(),
      volume: Number(toNumber(event.volume, 0).toFixed(2)),
      volume24hr: Number(toNumber(event.volume24hr, 0).toFixed(2)),
      liquidity: Number(toNumber(event.liquidityClob || event.liquidity, 0).toFixed(2)),
      macroStressScore: Number(macroStressScore.toFixed(4)),
      macroRegime,
      oilMarkets: enrichedMarkets
    };

    this.cache.snapshot = snapshot;
    this.cache.fetchedAtMs = Date.now();
    return this.decorateSnapshot(snapshot);
  }

  decorateSnapshot(snapshot) {
    const ageMs = Date.now() - this.cache.fetchedAtMs;
    return {
      ...snapshot,
      ageMs,
      stale: ageMs > this.config.staleMs
    };
  }
}

module.exports = {
  PolymarketOilAdapter
};
