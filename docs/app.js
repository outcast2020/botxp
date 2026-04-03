const DEFAULT_BASE_URL =
  "https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec";
const STORAGE_KEY = "botxp-apps-script-base-url";

const $ = (id) => document.getElementById(id);

function getBaseUrl() {
  return (localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE_URL).trim().replace(/\?view=.*$/, "");
}

function setBaseUrl(url) {
  localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/$/, ""));
}

function usdt(value) {
  return `${Number(value || 0).toFixed(2)} USDT`;
}

function pct(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function pctFromDecimal(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function drawChart(points) {
  const canvas = $("equityChart");
  const ctx = canvas.getContext("2d");
  const bounds = canvas.parentElement.getBoundingClientRect();
  canvas.width = bounds.width * window.devicePixelRatio;
  canvas.height = bounds.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

  const width = bounds.width;
  const height = bounds.height;
  ctx.clearRect(0, 0, width, height);

  if (!points || points.length < 2) {
    ctx.fillStyle = "#6f675b";
    ctx.font = "14px Segoe UI";
    ctx.fillText("Sem serie suficiente para desenhar.", 16, 24);
    return;
  }

  const pad = { top: 16, right: 12, bottom: 24, left: 44 };
  const values = points.map((point) => Number(point.totalEquity || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.001);

  ctx.strokeStyle = "rgba(50, 42, 30, 0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad.top + ((height - pad.top - pad.bottom) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
    const y = pad.top + (1 - ((Number(point.totalEquity || 0) - min) / span)) * (height - pad.top - pad.bottom);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#ab4b2a";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = "rgba(171, 75, 42, 0.12)";
  ctx.fill();

  ctx.fillStyle = "#6f675b";
  ctx.font = "12px Segoe UI";
  ctx.fillText(min.toFixed(2), 8, height - pad.bottom);
  ctx.fillText(max.toFixed(2), 8, pad.top + 4);
}

async function fetchJson(baseUrl, view) {
  const response = await fetch(`${baseUrl}?view=${encodeURIComponent(view)}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${view}`);
  }

  if (!contentType.includes("application/json")) {
    if (text.includes("AccountsSignInUi") || text.includes("signin")) {
      throw new Error("O Web App pede login. Publique o deploy como Anyone para o GitHub Pages conseguir ler.");
    }
    throw new Error(`Resposta inesperada em ${view}.`);
  }

  return JSON.parse(text);
}

function render(bundle, baseUrl) {
  const status = bundle.status || {};
  const equity = bundle.equity || { series: [] };
  const runtime = bundle.runtime || {};
  const config = bundle.config || {};
  const macro = status.macro || bundle.macro || runtime.macro?.oil || {};
  const policy = status.policy || bundle.policy || runtime.policy || {};
  const wallet = runtime.wallet || {};
  const position = runtime.position || {};
  const lastSignal = runtime.lastSignal || {};
  const riskMarkers = macro.riskMarkers || {};

  $("updatedAt").textContent = status.timestamp ? new Date(status.timestamp).toLocaleString("pt-BR") : "-";
  $("webAppLabel").innerHTML = `<a href="${baseUrl}" target="_blank" rel="noopener noreferrer">Abrir Web App</a>`;
  $("sheetLink").innerHTML = config.spreadsheetUrl
    ? `<a href="${config.spreadsheetUrl}" target="_blank" rel="noopener noreferrer">Abrir planilha</a>`
    : "Nao configurada";
  $("statusDot").className = "dot online";
  $("statusText").textContent = "Conectado";
  $("equityTotal").textContent = usdt(status.summary?.currentEquity || wallet.totalEquity || 0);
  $("equityPnl").textContent = `PnL ${pct(status.summary?.pnlPercent || 0)}`;
  $("marketRegime").textContent = status.marketRegime || "-";
  $("preferredStrategy").textContent = `Estrategia: ${status.preferredStrategy || "-"}`;
  $("macroRegime").textContent = macro.macroRegime || macro.regime || "UNKNOWN";
  $("macroStress").textContent = `Stress ${Number(macro.macroStressScore || macro.stressScore || 0).toFixed(4)}`;
  $("policyMode").textContent = policy.riskMode || "NEUTRAL";
  $("policyAllowed").textContent = `Allowed ${policy.allowedSide || "BOTH"}`;
  $("totalTrades").textContent = String(status.summary?.totalTrades ?? runtime.totals?.closedTrades ?? 0);
  $("avgWinRate").textContent = `Win rate ${pctFromDecimal(status.summary?.avgWinRate || 0)}`;
  $("positionState").textContent = position.side || "FLAT";
  $("runtimeMeta").textContent = `Leverage ${Number(wallet.effectiveLeverage || position.leverage || 0).toFixed(2)}x`;
  $("policyNoTrade").textContent = policy.noTrade ? "SIM" : "NAO";
  $("policyConfidence").textContent = `Confianca ${pctFromDecimal(policy.confidence || 0)}`;
  $("symbolMeta").textContent = `${status.symbol || config.symbol || "-"} / ${status.timeframe || config.timeframe || "-"}`;
  $("equityMeta").textContent = `${equity.series?.length || 0} pontos`;
  $("lastPrice").textContent = Number(status.price || wallet.markPrice || 0).toLocaleString("pt-BR");
  $("trendBias").textContent = `Tendencia: ${status.trendBias || "-"}`;
  $("positionQty").textContent = Number(position.qty || 0).toFixed(4);
  $("marginUsed").textContent = usdt(wallet.marginUsed || 0);
  $("unrealizedPnl").textContent = usdt(wallet.unrealizedPnl || 0);
  $("lastSignal").textContent = lastSignal.action ? `${lastSignal.action} (${lastSignal.nonce || "-"})` : "-";
  $("lastError").textContent = runtime.lastError || "-";
  $("policyLeverage").textContent = `${Number(policy.leverageCap || 0).toFixed(2)}x`;
  $("policyHold").textContent = policy.holdPolicy || "NORMAL";

  $("macroEvent").textContent = macro.eventSlug || "-";
  $("macroUpdatedAt").textContent = macro.updatedAt ? new Date(macro.updatedAt).toLocaleString("pt-BR") : "-";
  $("macroVolume24h").textContent = Number(macro.volume24hr || 0).toLocaleString("pt-BR");
  $("macroHigh120").textContent = pctFromDecimal(riskMarkers.high120 || 0);
  $("macroHigh130").textContent = pctFromDecimal(riskMarkers.high130 || 0);
  $("macroHigh140").textContent = pctFromDecimal(riskMarkers.high140 || 0);
  $("macroChange15m").textContent = pctFromDecimal(riskMarkers.avgChange15m || 0);
  $("policyAllowedSide").textContent = policy.allowedSide || "BOTH";
  $("policyStop").textContent = policy.stopProfile || "NORMAL";
  $("policySession").textContent = policy.sessionFilter === "CUSTOM"
    ? `${policy.sessionStartHour}:00 - ${policy.sessionEndHour}:00`
    : (policy.sessionFilter || "OFF");
  $("policyNotes").textContent = policy.notes || "-";

  const overviewUrl = config.coinglassOverviewUrl || "https://www.coinglass.com/currencies/DOGE";
  const oiUrl = config.coinglassOiUrl || "https://www.coinglass.com/open-interest/DOGE";
  $("coinglassFrame").src = overviewUrl;
  $("coinglassOverviewLink").href = overviewUrl;
  $("coinglassOiLink").href = oiUrl;

  const trades = status.recentTrades || [];
  $("tradesTable").innerHTML = trades.length
    ? trades.map((trade) => `
        <tr>
          <td>${trade.tradeId || "-"}</td>
          <td>${trade.direction || "-"}</td>
          <td>${Number(trade.qty || 0).toFixed(4)}</td>
          <td>${Number(trade.entryPriceAvg || 0).toFixed(6)}</td>
          <td>${Number(trade.exitPriceAvg || 0).toFixed(6)}</td>
          <td class="${Number(trade.netPnl || 0) >= 0 ? "ok" : "bad"}">${Number(trade.netPnl || 0).toFixed(4)}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="6">Nenhum trade fechado ainda.</td></tr>';

  drawChart(equity.series || []);
}

function renderError(message, baseUrl) {
  $("statusDot").className = "dot offline";
  $("statusText").textContent = "Falha ao ler o Web App";
  $("updatedAt").textContent = "-";
  $("webAppLabel").innerHTML = `<a href="${baseUrl}" target="_blank" rel="noopener noreferrer">Abrir Web App</a>`;
  $("lastError").textContent = message;
}

async function refresh() {
  const baseUrl = getBaseUrl();
  $("baseUrlInput").value = baseUrl;

  try {
    const [status, equity, runtime, config, macro, policy] = await Promise.all([
      fetchJson(baseUrl, "status"),
      fetchJson(baseUrl, "equity"),
      fetchJson(baseUrl, "runtime"),
      fetchJson(baseUrl, "config"),
      fetchJson(baseUrl, "macro"),
      fetchJson(baseUrl, "policy")
    ]);

    render({ status, equity, runtime, config, macro, policy }, baseUrl);
  } catch (error) {
    renderError(error.message, baseUrl);
    console.error(error);
  }
}

$("saveBtn").addEventListener("click", () => {
  const url = $("baseUrlInput").value.trim();
  if (!url) return;
  setBaseUrl(url);
  refresh();
});

$("refreshBtn").addEventListener("click", refresh);
window.addEventListener("resize", refresh);

$("baseUrlInput").value = getBaseUrl();
refresh();
setInterval(refresh, 30000);
