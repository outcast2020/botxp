import { runStrategyOnHistory } from "./engine.js";

const BINANCE_FUTURES_REST = "https://fapi.binance.com";
const BINANCE_FUTURES_WS = "wss://fstream.binance.com/stream";
const SETTINGS_KEY = "botxp-terminal-settings-v1";
const EDITOR_KEY = "botxp-terminal-editor-v1";

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
  lastSignal: null,
  lastAutoSentNonce: null,
  lastManualSentNonce: null
};

const $ = (id) => document.getElementById(id);

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
    warmupBars: 80
  };
}

function loadSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaultSettings();
  }
}

function saveSettings() {
  state.settings = collectSettingsFromForm();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  log("Configuração salva.");
}

function collectSettingsFromForm() {
  return {
    bridgeUrl: $("bridgeUrlInput").value.trim().replace(/\/$/, ""),
    passphrase: $("passphraseInput").value,
    symbol: $("symbolInput").value.trim().toUpperCase(),
    timeframe: $("timeframeInput").value.trim(),
    htfTimeframe: $("htfInput").value.trim(),
    leverage: Number($("leverageInput").value || 3),
    budgetUsdt: Number($("budgetInput").value || 7),
    autoSend: $("autoSendInput").checked,
    warmupBars: 80
  };
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
  const line = `[${stamp}] ${message}${payload !== undefined ? `\n${JSON.stringify(payload, null, 2)}` : ""}\n`;
  $("logOutput").textContent = line + $("logOutput").textContent;
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
  const defaultSource = savedSource || await fetch("./examples/doge-mtf-scalper.js").then((res) => res.text());

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
    log("Monaco não carregou. Usando editor simples.", { error: error.message });
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
  const url = `${BINANCE_FUTURES_REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao buscar klines ${interval}: HTTP ${response.status}`);
  }
  const rows = await response.json();
  return transformKlines(rows);
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
    log("Bridge não respondeu; seguindo com contexto local mínimo.", { error: error.message });
  }
}

function buildChartSeries(result) {
  const categories = state.bars.map((bar) => bar.label);
  const candleData = state.bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
  const lineNames = Object.keys(result.lines || {});
  const linePalette = ["#ab4b2a", "#1a5953", "#6d4bb4", "#ad7c15"];
  const lineSeries = lineNames.map((name, index) => {
    const valueMap = new Map((result.lines[name] || []).map((point) => [point.time, point.value]));
    return {
      name,
      type: "line",
      data: state.bars.map((bar) => valueMap.has(bar.time) ? valueMap.get(bar.time) : null),
      showSymbol: false,
      smooth: true,
      lineStyle: {
        width: 1.8,
        color: linePalette[index % linePalette.length]
      }
    };
  });

  const markerData = (result.markers || []).map((marker) => {
    const bar = state.bars.find((entry) => entry.time === marker.time);
    if (!bar) return null;
    return {
      name: marker.text,
      coord: [bar.label, marker.direction === "down" ? bar.high * 1.004 : bar.low * 0.996],
      value: marker.text,
      itemStyle: { color: marker.color },
      symbol: "triangle",
      symbolRotate: marker.direction === "down" ? 180 : 0
    };
  }).filter(Boolean);

  return { categories, candleData, lineSeries, markerData };
}

function renderChart(result) {
  if (!state.chart) {
    state.chart = echarts.init($("chart"));
    window.addEventListener("resize", () => state.chart?.resize());
  }

  const { categories, candleData, lineSeries, markerData } = buildChartSeries(result);
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
    grid: {
      left: 48,
      right: 18,
      top: 46,
      bottom: 36
    },
    xAxis: {
      type: "category",
      data: categories,
      boundaryGap: true,
      axisLine: { lineStyle: { color: "rgba(47, 38, 28, 0.15)" } },
      axisLabel: { color: "#6d665d", hideOverlap: true }
    },
    yAxis: {
      scale: true,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "rgba(47, 38, 28, 0.08)" } },
      axisLabel: { color: "#6d665d" }
    },
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
      ...lineSeries
    ]
  }, true);
}

function renderStatus(result) {
  const lastBar = state.bars[state.bars.length - 1];
  const lastSignal = result.latestSignal;
  state.lastSignal = lastSignal;
  $("lastBarTime").textContent = lastBar ? new Date(lastBar.openTime).toLocaleString("pt-BR") : "-";
  $("lastSignalMeta").textContent = lastSignal ? `${lastSignal.action} @ ${lastSignal.price}` : "-";
  $("lastPrice").textContent = lastBar ? lastBar.close.toFixed(6) : "0";
  $("atrMeta").textContent = `ATR ${lastSignal ? Number(lastSignal.atr_pct || 0).toFixed(3) : "0.000"}%`;
  $("signalCount").textContent = String(result.signals.length);
  $("markerCount").textContent = `${result.markers.length} marcadores`;
  $("strategyId").textContent = result.strategy.id || "-";
  $("latestAction").textContent = lastSignal?.action || "-";
  $("latestNonce").textContent = lastSignal?.nonce || "-";
  $("latestReason").textContent = lastSignal?.reason || "-";
  $("latestHtfTrend").textContent = lastSignal?.htf_trend || "-";
  $("latestRsi").textContent = lastSignal ? Number(lastSignal.rsi || 0).toFixed(2) : "0";
  $("latestAtrPct").textContent = lastSignal ? `${Number(lastSignal.atr_pct || 0).toFixed(3)}%` : "0%";
  $("chartMeta").textContent = `${state.bars.length} candles locais, ${state.htfBars.length} candles HTF`;
  $("policyMode").textContent = state.policy.riskMode || "NEUTRAL";
  $("policyAllowed").textContent = `Allowed ${state.policy.allowedSide || "BOTH"}`;
  $("macroRegime").textContent = state.macro.macroRegime || "UNKNOWN";
  $("macroStress").textContent = `Stress ${Number(state.macro.macroStressScore || 0).toFixed(4)}`;
}

async function runStrategy(trigger = "manual") {
  if (!state.bars.length || !state.htfBars.length) {
    log("Ainda não há dados suficientes para rodar a estratégia.");
    return;
  }

  try {
    const result = runStrategyOnHistory({
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
        inputs: {
          leverage: state.settings.leverage,
          budgetUsdt: state.settings.budgetUsdt
        }
      }
    });

    renderChart(result);
    renderStatus(result);
    if (trigger === "live" && state.settings.autoSend && result.latestSignal && result.latestSignal.nonce !== state.lastAutoSentNonce) {
      await sendSignal(result.latestSignal, true);
    }
  } catch (error) {
    log("Falha ao rodar estratégia.", { error: error.message });
  }
}

async function sendSignal(signal = state.lastSignal, isAuto = false) {
  if (!signal) {
    log("Nenhum sinal disponível para envio.");
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
  if (response.ok) {
    if (isAuto) state.lastAutoSentNonce = signal.nonce;
    else state.lastManualSentNonce = signal.nonce;
  }
  log(isAuto ? "Auto-envio concluído." : "Envio manual concluído.", json);
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
  log("Dados históricos carregados.", {
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
  const url = `${BINANCE_FUTURES_WS}?streams=${symbol}@kline_${state.settings.timeframe}/${symbol}@kline_${state.settings.htfTimeframe}`;
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

      log("Candle fechado detectado; recarregando série.", {
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

$("sendSignalBtn").addEventListener("click", () => sendSignal(state.lastSignal, false));

bootstrap().catch((error) => {
  log("Falha no bootstrap do terminal.", { error: error.message });
});
