const { toNumber } = require("./utils");

function intervalToMs(interval) {
  const match = String(interval).match(/^(\d+)([mhdw])$/i);
  if (!match) {
    throw new Error(`Intervalo nao suportado: ${interval}`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  }[unit];

  return amount * unitMs;
}

function rowToCandle(row) {
  return {
    openTime: Number(row[0]),
    open: toNumber(row[1], 0),
    high: toNumber(row[2], 0),
    low: toNumber(row[3], 0),
    close: toNumber(row[4], 0),
    volume: toNumber(row[5], 0),
    closeTime: Number(row[6])
  };
}

async function fetchHistoricalKlines(options) {
  const {
    baseUrl,
    symbol,
    interval,
    startTime,
    endTime,
    limit = 1000
  } = options;

  const candles = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const url = new URL("/fapi/v1/klines", baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endTime));

    const response = await fetch(url);
    const rows = await response.json();

    if (!response.ok) {
      throw new Error(`Falha ao buscar klines ${interval}: HTTP ${response.status} ${JSON.stringify(rows)}`);
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    rows.forEach((row) => candles.push(rowToCandle(row)));

    const lastCandle = rows[rows.length - 1];
    const nextCursor = Number(lastCandle[6]) + 1;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
      break;
    }
    cursor = nextCursor;

    if (rows.length < limit) {
      break;
    }
  }

  const deduped = [];
  let previousOpenTime = null;
  candles
    .sort((left, right) => left.openTime - right.openTime)
    .forEach((candle) => {
      if (candle.openTime !== previousOpenTime) {
        deduped.push(candle);
        previousOpenTime = candle.openTime;
      }
    });

  return deduped;
}

module.exports = {
  fetchHistoricalKlines,
  intervalToMs
};
