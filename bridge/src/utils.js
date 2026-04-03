function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function countStepPrecision(step) {
  const text = String(step);
  if (!text.includes(".")) return 0;
  return text.split(".")[1].replace(/0+$/, "").length;
}

function roundToStepDown(value, step) {
  const numericValue = toNumber(value, 0);
  const numericStep = toNumber(step, 0);
  if (!numericStep) return numericValue;

  const precision = countStepPrecision(numericStep);
  const factor = 10 ** precision;
  const scaledValue = Math.floor((numericValue * factor) / (numericStep * factor));
  return Number((scaledValue * numericStep).toFixed(precision));
}

function weightedAverage(items, qtyKey, priceKey) {
  let qtyTotal = 0;
  let valueTotal = 0;

  items.forEach((item) => {
    const qty = toNumber(item[qtyKey], 0);
    const price = toNumber(item[priceKey], 0);
    qtyTotal += qty;
    valueTotal += qty * price;
  });

  if (!qtyTotal) return 0;
  return valueTotal / qtyTotal;
}

function getDayKey(timezone, timestamp = Date.now()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date(timestamp));
}

function dedupePush(list, value, maxLength) {
  const next = Array.isArray(list) ? list.filter((entry) => entry !== value) : [];
  next.push(value);
  return next.slice(-maxLength);
}

function positionSideFromQty(quantity) {
  const qty = toNumber(quantity, 0);
  if (qty > 0) return "LONG";
  if (qty < 0) return "SHORT";
  return "FLAT";
}

function abs(value) {
  return Math.abs(toNumber(value, 0));
}

module.exports = {
  abs,
  clamp,
  dedupePush,
  getDayKey,
  nowIso,
  positionSideFromQty,
  roundToStepDown,
  safeJsonParse,
  toNumber,
  weightedAverage
};
