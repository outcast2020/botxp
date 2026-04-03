import { runStrategyOnHistory } from "./engine.js";

const BINANCE_FUTURES_REST = "https://fapi.binance.com";
const BINANCE_FUTURES_WS = "wss://fstream.binance.com/stream";
const SETTINGS_KEY = "botxp-terminal-settings-v2";
const EDITOR_KEY = "botxp-terminal-editor-v2";

const state = {
  settings: null,
  bars: [],
  htfBars: [],
  macro: {},
  policy: {},
  bridgeHealth: null,
  chart: null,
  editor: null,
  editorFallback: null,
  ws: null,
  result: null,
  replayIndex: 0,
  replayTimer: null,
  lastSignal: null,
  lastAutoSentNonce: null
};

const $ = (id) => document.getElementById(id);

function usdt(value) {
  return `${Number(value || 0).toFixed(2)} USDT`;
}

function pct(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function defaultSettings() {
  return {
    bridgeUrl: "http://localhost:8787",
    passphrase: "",
    symbol: "DOGEUSDT",
    timeframe: "5m",
    htfTimeframe: "4h",
    leverage: 3,
    budgetUsdt: 7,
    autoSend: false,
    warmupBars: 80,
    initialCapitalUsdt: 20,
    feeRate: 0.0004
  };
}

function loadSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaultSettings();
  }
}

function collectSettingsFromForm() {
  return {
    ...state.settings,
    bridgeUrl: $("bridgeUrlInput").value.trim().replace(/\/$/, ""),
    passphrase: $("passphraseInput").value,
    symbol: $("symbolInput").value.trim().toUpperCase(),
    timeframe: $("timeframeInput").value.trim(),
    htfTimeframe: $("htfInput").value.trim(),
    leverage: Number($("leverageInput").value || 3),
    budgetUsdt: Number($("budgetInput").value || 7),
    autoSend: $("autoSendInput").checked
  };
}

function saveSettings() {
  state.settings = collectSettingsFromForm();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  log("Configuracao salva.", {
    bridgeUrl: state.settings.bridgeUrl,
    symbol: state.settings.symbol,
    timeframe: state.settings.timeframe,
    htfTimeframe: state.settings.htfTimeframe
  });
}

function hydrateForm(settings) {
  $("bridgeUrlInput").value = settings.bridgeUrl;
  $("passphraseInput").value = settings.passphrase;
  $("symbolInput").value = settings.symbol;
  $("timeframeInput").value = settings.timeframe;
  $("htfInput").value = settings.htfTimeframe;
  $("leverageInput").value = settings.leverage;
  $("budgetInput").value = settings.budgetUsdt;
  $("autoSendInput").checked = settings.autoSend;
  $("marketMeta").textContent = `${settings.symbol} / ${settings.timeframe} + ${settings.htfTimeframe}`;
}

function log(message, payload) {
  const stamp = new Date().toLocaleTimeString("pt-BR");
  const rendered = `[${stamp}] ${message}${payload !== undefined ? `\n${JSON.stringify(payload, null, 2)}` : ""}\n`;
  $("logOutput").textContent = rendered + $("logOutput").textContent;
}

async function loadMonaco() {
  if (window.monaco?.editor) return window.monaco;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  await new Promise((resolve, reject) => {
    window.require.config({
      paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" }
    });
    window.require(["vs/editor/editor.main"], resolve, reject);
  });

  return window.monaco;
}

async function initEditor() {
  const savedSource = localStorage.getItem(EDITOR_KEY);
  const defaultSource = savedSource || await fetch("./examples/doge-mtf-scalper.js").then((response) => response.text());

  try {
    const monaco = await loadMonaco();
    state.editor = monaco.editor.create($("editor"), {
      value: defaultSource,
      language: "javascript",
      theme: "vs",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false
    });
    state.editor.onDidChangeModelContent(() => {
      localStorage.setItem(EDITOR_KEY, state.editor.getValue());
    });
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = defaultSource;
    textarea.className = "editor";
    textarea.addEventListener("input", () => {
      localStorage.setItem(EDITOR_KEY, textarea.value);
    });
    $("editor").replaceWith(textarea);
    textarea.id = "editor";
    state.editorFallback = textarea;
    log("Monaco nao carregou. Usando editor simples.", { error: error.message });
  }
}

function getEditorValue() {
  if (state.editor) return state.editor.getValue();
  if (state.editorFallback) return state.editorFallback.value;
  return "";
}

function formatBarTime(timestamp) {
  return new Date(timestamp).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function transformKlines(rows) {
  return rows.map((row) => ({
    openTime: Number(row[0]),
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    label: formatBarTime(Number(row[0]))
  }));
}

async function fetchKlines(symbol, interval, limit) {
  const url =
    `${BINANCE_FUTURES_REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao buscar klines ${interval}: HTTP ${response.status}`);
  }
  return transformKlines(await response.json());
}

async function refreshBridgeContext() {
  const base = state.settings.bridgeUrl;
  const defaults = {
    macro: { macroRegime: "UNKNOWN", macroStressScore: 0, riskMarkers: {} },
    policy: { riskMode: "NEUTRAL", allowedSide: "BOTH", leverageCap: state.settings.leverage, noTrade: false }
  };

  try {
    const [healthRes, macroRes, policyRes] = await Promise.all([
      fetch(`${base}/health`),
      fetch(`${base}/macro/oil`),
      fetch(`${base}/policy`)
    ]);

    state.bridgeHealth = healthRes.ok ? await healthRes.json() : null;
    state.macro = macroRes.ok ? await macroRes.json() : defaults.macro;
    state.policy = policyRes.ok ? await policyRes.json() : defaults.policy;
    $("bridgeDot").className = "dot online";
    $("bridgeStatus").textContent = state.bridgeHealth?.mode === "live" ? "Bridge online (live)" : "Bridge online (dry-run)";
  } catch (error) {
    state.bridgeHealth = null;
    state.macro = defaults.macro;
    state.policy = defaults.policy;
    $("bridgeDot").className = "dot offline";
    $("bridgeStatus").textContent = "Bridge offline";
    log("Bridge nao respondeu; usando contexto local minimo.", { error: error.message });
  }
}

function pointsToVisibleSeries(points, visibleBars) {
  const map = new Map((points || []).map((point) => [point.time, point.value]));
  return visibleBars.map((bar) => (map.has(bar.time) ? map.get(bar.time) : null));
}

function buildChartSeries(frame) {
  const visibleBars = state.bars.slice(0, frame.barIndex + 1);
  const categories = visibleBars.map((bar) => bar.label);
  const candleData = visibleBars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
  const linePalette = ["#ab4b2a", "#1a5953", "#7d5a2b", "#3a67a3", "#6d4bb4"];

  const priceSeries = [];
  const indicatorSeries = [];

  Object.values(state.result.lines || {}).forEach((line, index) => {
    const target = line.pane === "indicator" ? indicatorSeries : priceSeries;
    target.push({
      name: line.name,
      type: "line",
      xAxisIndex: line.pane === "indicator" ? 1 : 0,
      yAxisIndex: line.pane === "indicator" ? 1 : 0,
      data: pointsToVisibleSeries(line.points, visibleBars),
      showSymbol: false,
      smooth: true,
      lineStyle: {
        width: 1.8,
        color: line.color || linePalette[index % linePalette.length]
      }
    });
  });

  Object.values(state.result.histograms || {}).forEach((series, index) => {
    indicatorSeries.push({
      name: series.name,
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: pointsToVisibleSeries(series.points, visibleBars),
      barMaxWidth: 6,
      itemStyle: {
        color: series.color || linePalette[index % linePalette.length],
        opacity: 0.6
      }
    });
  });

  Object.values(state.result.bands || {}).forEach((band, index) => {
    const target = band.pane === "indicator" ? indicatorSeries : priceSeries;
    const baseIndex = band.pane === "indicator" ? 1 : 0;
    target.push({
      name: `${band.name}-upper`,
      type: "line",
      xAxisIndex: baseIndex,
      yAxisIndex: baseIndex,
      data: pointsToVisibleSeries(band.upper, visibleBars),
      showSymbol: false,
      lineStyle: {
        width: 1,
        type: "dashed",
        color: band.color || linePalette[index % linePalette.length]
      }
    });
    target.push({
      name: `${band.name}-lower`,
      type: "line",
      xAxisIndex: baseIndex,
      yAxisIndex: baseIndex,
      data: pointsToVisibleSeries(band.lower, visibleBars),
      showSymbol: false,
      lineStyle: {
        width: 1,
        type: "dashed",
        color: band.color || linePalette[index % linePalette.length]
      }
    });
  });

  const markerData = (state.result.markers || [])
    .filter((marker) => marker.time <= frame.time)
    .map((marker) => {
      const bar = visibleBars.find((entry) => entry.time === marker.time);
      if (!bar) return null;
      return {
        name: marker.text,
        coord: [bar.label, marker.price || bar.close],
        value: marker.text,
        itemStyle: { color: marker.color },
        symbol: "triangle",
        symbolRotate: marker.direction === "down" ? 180 : 0
      };
    })
    .filter(Boolean);

  return {
    categories,
    candleData,
    markerData,
    priceSeries,
    indicatorSeries
  };
}

function renderChart(frame) {
  if (!state.chart) {
    state.chart = echarts.init($("chart"));
    window.addEventListener("resize", () => state.chart?.resize());
  }

  const { categories, candleData, markerData, priceSeries, indicatorSeries } = buildChartSeries(frame);

  state.chart.setOption({
    animation: false,
    backgroundColor: "transparent",
    legend: {
      top: 8,
      textStyle: { color: "#6d665d" }
    },
    tooltip: {
      trigger: "axis"
    },
    axisPointer: {
      link: [{ xAxisIndex: [0, 1] }]
    },
    grid: [
      { left: 48, right: 18, top: 46, height: "58%" },
      { left: 48, right: 18, top: "72%", height: "16%" }
    ],
    xAxis: [
      {
        type: "category",
        data: categories,
        boundaryGap: true,
        axisLine: { lineStyle: { color: "rgba(47, 38, 28, 0.15)" } },
        axisLabel: { color: "#6d665d", hideOverlap: true }
      },
      {
        type: "category",
        gridIndex: 1,
        data: categories,
        boundaryGap: true,
        axisLine: { lineStyle: { color: "rgba(47, 38, 28, 0.15)" } },
        axisLabel: { color: "#6d665d", hideOverlap: true }
      }
    ],
    yAxis: [
      {
        scale: true,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(47, 38, 28, 0.08)" } },
        axisLabel: { color: "#6d665d" }
      },
      {
        gridIndex: 1,
        scale: true,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(47, 38, 28, 0.08)" } },
        axisLabel: { color: "#6d665d" }
      }
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1],
        startValue: Math.max(categories.length - 180, 0),
        endValue: categories.length - 1
      }
    ],
    series: [
      {
        name: "DOGEUSDT",
        type: "candlestick",
        data: candleData,
        itemStyle: {
          color: "#1a8f6f",
          color0: "#c24646",
          borderColor: "#1a8f6f",
          borderColor0: "#c24646"
        },
        markPoint: {
          symbolSize: 22,
          label: { color: "#fff", fontSize: 10 },
          data: markerData
        }
      },
      ...priceSeries,
      ...indicatorSeries
    ]
  }, true);
}

function tradesUpToFrame(frame) {
  return (state.result?.trades || []).filter((trade) => Number(trade.exitTime || 0) <= frame.time);
}

function renderPositionPanel(frame) {
  const position = frame.position || {};
  const lastSignal = frame.lastSignal;

  $("positionSide").textContent = position.side || "FLAT";
  $("positionQty").textContent = Number(position.qty || 0).toFixed(6);
  $("positionEntry").textContent = Number(position.entryPrice || 0).toFixed(6);
  $("positionLeverage").textContent = `${Number(position.leverage || 0).toFixed(2)}x`;
  $("positionMargin").textContent = usdt(position.marginUsed || 0);
  $("positionUnrealized").textContent = usdt(position.unrealizedPnl || 0);
  $("balanceValue").textContent = usdt(frame.balance || 0);
  $("drawdownValue").textContent = pct(frame.drawdownPct || 0);
  $("latestAction").textContent = lastSignal?.action || "-";
  $("latestNonce").textContent = lastSignal?.nonce || "-";
  $("latestReason").textContent = lastSignal?.reason || "-";
  $("latestHtfTrend").textContent = lastSignal?.htf_trend || "-";
  $("latestRsi").textContent = lastSignal ? Number(lastSignal.rsi || 0).toFixed(2) : "0";
  $("latestAtrPct").textContent = lastSignal ? `${Number(lastSignal.atr_pct || 0).toFixed(3)}%` : "0%";
}

function renderTradesTable(frame) {
  const trades = tradesUpToFrame(frame).slice(-12).reverse();
  $("tradesTable").innerHTML = trades.length
    ? trades.map((trade) => `
        <tr>
          <td>${trade.tradeId}</td>
          <td>${trade.direction}</td>
          <td>${new Date(trade.entryTime).toLocaleString("pt-BR")}</td>
          <td>${new Date(trade.exitTime).toLocaleString("pt-BR")}</td>
          <td>${Number(trade.qty || 0).toFixed(4)}</td>
          <td class="${Number(trade.netPnl || 0) >= 0 ? "good" : "bad"}">${Number(trade.netPnl || 0).toFixed(4)}</td>
          <td>${trade.exitReason || "-"}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="7">Nenhum trade fechado ate este frame.</td></tr>';
}

function renderSignalPayload(frame) {
  $("signalPayloadView").textContent = frame.lastSignal
    ? JSON.stringify(frame.lastSignal, null, 2)
    : "Nenhum sinal neste frame.";
}

function renderReplayControls() {
  const total = state.result?.frames?.length || 0;
  $("replaySlider").max = Math.max(total - 1, 0);
  $("replaySlider").value = String(state.replayIndex);
  $("replayLabel").textContent = total ? `${state.replayIndex + 1} / ${total}` : "0 / 0";
}

function renderMetrics(frame) {
  const summary = state.result.summary;
  const lastBar = state.bars[frame.barIndex];
  const closedTrades = tradesUpToFrame(frame);
  const wins = closedTrades.filter((trade) => Number(trade.netPnl || 0) >= 0).length;
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;

  state.lastSignal = frame.lastSignal || state.lastSignal;
  $("lastBarTime").textContent = lastBar ? new Date(lastBar.openTime).toLocaleString("pt-BR") : "-";
  $("lastSignalMeta").textContent = frame.lastSignal ? `${frame.lastSignal.action} @ ${frame.lastSignal.price}` : "-";
  $("policyMode").textContent = state.policy.riskMode || "NEUTRAL";
  $("policyAllowed").textContent = `Allowed ${state.policy.allowedSide || "BOTH"}`;
  $("macroRegime").textContent = state.macro.macroRegime || "UNKNOWN";
  $("macroStress").textContent = `Stress ${Number(state.macro.macroStressScore || 0).toFixed(4)}`;
  $("equityValue").textContent = usdt(frame.equity || 0);
  $("backtestPnl").textContent = `PnL ${pct(((frame.equity - summary.initialCapital) / summary.initialCapital) * 100 || 0)}`;
  $("closedTradesCount").textContent = String(closedTrades.length);
  $("winRateMeta").textContent = `Win rate ${pct(winRate)}`;
  $("lastPrice").textContent = lastBar ? Number(lastBar.close || 0).toFixed(6) : "0";
  $("atrMeta").textContent = frame.lastSignal ? `ATR ${Number(frame.lastSignal.atr_pct || 0).toFixed(3)}%` : "ATR 0.000%";
  $("signalCount").textContent = String(state.result.signals.length);
  $("markerCount").textContent = `${state.result.markers.length} marcadores`;
  $("chartMeta").textContent = `${state.bars.length} candles, ${state.result.trades.length} trades, DD max ${pct(summary.maxDrawdownPct || 0)}`;
  $("strategyId").textContent = state.result.strategy.id || "-";
  $("currentReplayBar").textContent = frame.label || "-";
  $("currentFrameSignal").textContent = frame.lastSignal ? frame.lastSignal.action : "sem sinal";
}

function renderFrame(index) {
  if (!state.result?.frames?.length) return;
  state.replayIndex = Math.max(0, Math.min(index, state.result.frames.length - 1));
  const frame = state.result.frames[state.replayIndex];
  renderReplayControls();
  renderChart(frame);
  renderMetrics(frame);
  renderPositionPanel(frame);
  renderTradesTable(frame);
  renderSignalPayload(frame);
}

function stopReplay() {
  if (state.replayTimer) {
    clearInterval(state.replayTimer);
    state.replayTimer = null;
  }
  $("replayPlayBtn").textContent = "Play";
}

function playReplay() {
  if (!state.result?.frames?.length) return;
  if (state.replayTimer) {
    stopReplay();
    return;
  }

  const speed = Number($("replaySpeedSelect").value || 700);
  $("replayPlayBtn").textContent = "Pause";
  state.replayTimer = setInterval(() => {
    if (state.replayIndex >= state.result.frames.length - 1) {
      stopReplay();
      return;
    }
    renderFrame(state.replayIndex + 1);
  }, speed);
}

async function runStrategy(trigger = "manual") {
  if (!state.bars.length || !state.htfBars.length) {
    log("Ainda nao ha dados suficientes para rodar a estrategia.");
    return;
  }

  try {
    state.result = runStrategyOnHistory({
      source: getEditorValue(),
      bars: state.bars,
      htfBars: state.htfBars,
      macro: state.macro,
      policy: state.policy,
      settings: {
        symbol: state.settings.symbol,
        timeframe: state.settings.timeframe,
        htfTimeframe: state.settings.htfTimeframe,
        warmupBars: state.settings.warmupBars,
        initialCapitalUsdt: state.settings.initialCapitalUsdt,
        feeRate: state.settings.feeRate,
        inputs: {
          leverage: state.settings.leverage,
          budgetUsdt: state.settings.budgetUsdt
        }
      }
    });

    stopReplay();
    renderFrame(state.result.frames.length - 1);
    log("Backtest visual recalculado.", state.result.summary);

    if (
      trigger === "live" &&
      state.settings.autoSend &&
      state.result.latestSignal &&
      state.result.latestSignal.nonce !== state.lastAutoSentNonce
    ) {
      await sendSignal(state.result.latestSignal, true);
    }
  } catch (error) {
    log("Falha ao rodar estrategia.", { error: error.message });
  }
}

async function sendSignal(signal = state.result?.frames?.[state.replayIndex]?.lastSignal, isAuto = false) {
  if (!signal) {
    log("Nenhum sinal disponivel para envio.");
    return;
  }

  if (!state.settings.passphrase) {
    log("Defina a SIGNAL_PASSPHRASE antes de enviar sinais.");
    return;
  }

  const payload = {
    ...signal,
    passphrase: state.settings.passphrase
  };

  const response = await fetch(`${state.settings.bridgeUrl}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  $("lastSendStatus").textContent = `${response.status} ${json.reason || (json.accepted ? "accepted" : "response")}`;

  if (response.ok && isAuto) {
    state.lastAutoSentNonce = signal.nonce;
  }

  log(isAuto ? "Auto-envio concluido." : "Envio manual concluido.", json);
}

async function loadMarketData() {
  const { symbol, timeframe, htfTimeframe } = state.settings;
  $("marketMeta").textContent = `${symbol} / ${timeframe} + ${htfTimeframe}`;

  const [bars, htfBars] = await Promise.all([
    fetchKlines(symbol, timeframe, 500),
    fetchKlines(symbol, htfTimeframe, 300)
  ]);

  state.bars = bars;
  state.htfBars = htfBars;
  log("Dados historicos carregados.", {
    symbol,
    timeframe,
    htfTimeframe,
    bars: bars.length,
    htfBars: htfBars.length
  });
}

function connectStreams() {
  if (state.ws) {
    state.ws.close();
  }

  const symbol = state.settings.symbol.toLowerCase();
  const url =
    `${BINANCE_FUTURES_WS}?streams=${symbol}@kline_${state.settings.timeframe}` +
    `/${symbol}@kline_${state.settings.htfTimeframe}`;

  state.ws = new WebSocket(url);
  state.ws.onopen = () => log("WebSocket de mercado conectado.");
  state.ws.onerror = () => log("WebSocket de mercado encontrou erro.");
  state.ws.onclose = () => log("WebSocket de mercado desconectado.");
  state.ws.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);
      const stream = payload.stream || "";
      const kline = payload.data?.k;
      if (!kline || !kline.x) return;

      const isPrimary = stream.endsWith(`kline_${state.settings.timeframe}`);
      const isHtf = stream.endsWith(`kline_${state.settings.htfTimeframe}`);
      if (!isPrimary && !isHtf) return;

      log("Candle fechado detectado; atualizando series.", {
        stream,
        close: kline.c,
        closeTime: kline.T
      });

      await loadMarketData();
      await refreshBridgeContext();
      await runStrategy("live");
    } catch (error) {
      log("Falha ao processar stream.", { error: error.message });
    }
  };
}

async function bootstrap() {
  state.settings = loadSettings();
  hydrateForm(state.settings);
  await initEditor();
  await refreshBridgeContext();
  await loadMarketData();
  await runStrategy("manual");
  connectStreams();
}

$("saveSettingsBtn").addEventListener("click", async () => {
  saveSettings();
  await refreshBridgeContext();
  await loadMarketData();
  await runStrategy("manual");
  connectStreams();
});

$("reloadDataBtn").addEventListener("click", async () => {
  state.settings = collectSettingsFromForm();
  await refreshBridgeContext();
  await loadMarketData();
  await runStrategy("manual");
});

$("runStrategyBtn").addEventListener("click", async () => {
  state.settings = collectSettingsFromForm();
  await refreshBridgeContext();
  await runStrategy("manual");
});

$("sendSignalBtn").addEventListener("click", () => sendSignal());
$("replaySlider").addEventListener("input", (event) => {
  stopReplay();
  renderFrame(Number(event.target.value || 0));
});
$("replayPlayBtn").addEventListener("click", playReplay);
$("replayPrevBtn").addEventListener("click", () => {
  stopReplay();
  renderFrame(state.replayIndex - 1);
});
$("replayNextBtn").addEventListener("click", () => {
  stopReplay();
  renderFrame(state.replayIndex + 1);
});
$("replayStartBtn").addEventListener("click", () => {
  stopReplay();
  renderFrame(0);
});
$("replayEndBtn").addEventListener("click", () => {
  stopReplay();
  if (state.result?.frames?.length) {
    renderFrame(state.result.frames.length - 1);
  }
});

bootstrap().catch((error) => {
  log("Falha no bootstrap do terminal.", { error: error.message });
});
