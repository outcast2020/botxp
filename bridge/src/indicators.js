function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function smaSeries(values, period) {
  const output = new Array(values.length).fill(null);
  if (values.length < period) return output;

  let rollingSum = 0;
  for (let index = 0; index < values.length; index += 1) {
    rollingSum += values[index];
    if (index >= period) {
      rollingSum -= values[index - period];
    }
    if (index >= period - 1) {
      output[index] = rollingSum / period;
    }
  }

  return output;
}

function emaSeries(values, period) {
  const output = new Array(values.length).fill(null);
  if (values.length < period) return output;

  const multiplier = 2 / (period + 1);
  let ema = mean(values.slice(0, period));
  output[period - 1] = ema;

  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    output[index] = ema;
  }

  return output;
}

function stdDevSeries(values, period) {
  const output = new Array(values.length).fill(null);
  if (values.length < period) return output;

  for (let index = period - 1; index < values.length; index += 1) {
    const slice = values.slice(index - period + 1, index + 1);
    const avg = mean(slice);
    const variance = slice.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / period;
    output[index] = Math.sqrt(variance);
  }

  return output;
}

function rsiSeries(values, period) {
  const output = new Array(values.length).fill(null);
  if (values.length <= period) return output;

  let avgGain = 0;
  let avgLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) avgGain += delta;
    else avgLoss += Math.abs(delta);
  }

  avgGain /= period;
  avgLoss /= period;

  output[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    if (avgLoss === 0) {
      output[index] = 100;
    } else {
      const rs = avgGain / avgLoss;
      output[index] = 100 - (100 / (1 + rs));
    }
  }

  return output;
}

function atrSeries(candles, period) {
  const output = new Array(candles.length).fill(null);
  if (candles.length <= period) return output;

  const trValues = [];
  for (let index = 0; index < candles.length; index += 1) {
    if (index === 0) {
      trValues.push(candles[index].high - candles[index].low);
      continue;
    }

    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    trValues.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose)
      )
    );
  }

  let atr = mean(trValues.slice(1, period + 1));
  output[period] = atr;

  for (let index = period + 1; index < candles.length; index += 1) {
    atr = ((atr * (period - 1)) + trValues[index]) / period;
    output[index] = atr;
  }

  return output;
}

module.exports = {
  atrSeries,
  emaSeries,
  rsiSeries,
  smaSeries,
  stdDevSeries
};
