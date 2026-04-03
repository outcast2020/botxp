# Terminal Próprio com Scripts Estilo Pine em JS

## Objetivo

Substituir a dependência de plataformas fechadas de sinal por um terminal web próprio, com:

- charting em tempo real
- editor de estratégia em JavaScript com ergonomia próxima de Pine
- execução local e determinística
- integração nativa com a bridge Binance já existente
- suporte a contexto macro em tempo real

## Princípios

- o motor de ordem continua separado do chart
- script nunca recebe acesso direto à API da Binance
- sinais são emitidos como eventos estruturados
- backtest e live usam a mesma interface de estratégia
- a API externa do terminal é mínima e explícita

## Stack recomendada

- frontend: `React + Vite`
- chart: `Lightweight Charts`
- editor: `Monaco Editor`
- engine de script: `Web Worker + sandbox`
- dados de mercado:
  - klines Binance REST para bootstrap
  - streams Binance WebSocket para atualização
- execução:
  - terminal publica sinais para a bridge local
  - bridge continua aplicando risco e mandando ordem

## Arquitetura

```text
Binance REST/WS
  -> market data service
  -> series store
  -> terminal chart
  -> script engine
  -> signal bus
  -> bridge Node.js
  -> risk firewall
  -> Binance order API

Polymarket
  -> macro adapter
  -> strategy context

OpenAI
  -> policy engine
  -> risk context
```

## Componentes

### 1. Market Data Service

Responsável por:

- baixar histórico inicial
- manter stream `5m`
- manter stream auxiliar `4h`
- expor snapshots coerentes ao script engine

Saída mínima:

```js
{
  symbol: "DOGEUSDT",
  timeframe: "5m",
  htfTimeframe: "4h",
  bars: [...],
  htfBars: [...],
  markPrice: 0.0,
  updatedAt: "..."
}
```

### 2. Script Engine

Responsável por:

- carregar estratégia JS
- validar API disponível
- executar `onBarClose`
- devolver sinais estruturados
- manter plots e marcadores de debug

Restrições:

- sem `fetch`
- sem acesso a filesystem
- sem `process.env`
- sem ordem direta
- sem side effects fora da API do motor

### 3. Signal Bus

Responsável por:

- deduplicar sinais
- versionar payload
- enviar para a bridge via HTTP local

Payload recomendado:

```json
{
  "source": "botxp_terminal",
  "strategy_id": "doge_mtf_scalper_v1",
  "action": "LONG_ENTRY",
  "symbol": "DOGEUSDT",
  "market": "usds_m_futures",
  "interval": "5m",
  "bar_time": 1775126400000,
  "price": 0.0,
  "leverage": 3,
  "margin_mode": "ISOLATED",
  "position_mode": "ONE_WAY",
  "order_budget_usdt": 7,
  "qty_hint": 0,
  "rsi": 0,
  "atr_pct": 0,
  "htf_trend": "BULL",
  "htf_rsi": 0,
  "reason": "ema_pullback_confirmed",
  "nonce": "doge_mtf_scalper_v1-1775126400000-LONG",
  "passphrase": "SIGNAL_PASSPHRASE"
}
```

### 4. Terminal UI

Módulos mínimos:

- `ChartPane`
- `OrderPanel`
- `MacroRiskPanel`
- `PolicyPanel`
- `ScriptEditor`
- `SignalLog`
- `TradeJournal`

## DSL estilo Pine em JS

### Forma recomendada

```js
export default defineStrategy({
  id: "doge_mtf_scalper_v1",
  symbol: "DOGEUSDT",
  timeframe: "5m",
  htfTimeframe: "4h",
  inputs: {
    leverage: input.int(3, { min: 1, max: 5 }),
    budgetUsdt: input.float(7, { min: 1 }),
    fastLen: input.int(9, { min: 2 }),
    slowLen: input.int(34, { min: 5 }),
    trendLen: input.int(89, { min: 20 })
  },
  onBarClose(ctx) {
    const close = ctx.series.close();
    const high = ctx.series.high();
    const low = ctx.series.low();

    const emaFast = ta.ema(close, ctx.input.fastLen);
    const emaSlow = ta.ema(close, ctx.input.slowLen);
    const emaTrend = ta.ema(close, ctx.input.trendLen);
    const rsi = ta.rsi(close, 7);
    const atr = ta.atr(high, low, close, 14);

    const htfClose = ctx.htf.close();
    const htfFast = ta.ema(htfClose, 21);
    const htfSlow = ta.ema(htfClose, 55);

    const longBias = htfFast.last() > htfSlow.last();
    const shortBias = htfFast.last() < htfSlow.last();
    const longSetup =
      longBias &&
      ta.crossOver(emaFast, emaSlow) &&
      close.last() > emaTrend.last() &&
      rsi.last() > 52;

    const shortSetup =
      shortBias &&
      ta.crossUnder(emaFast, emaSlow) &&
      close.last() < emaTrend.last() &&
      rsi.last() < 48;

    if (ctx.policy.noTrade) return;

    if (longSetup) {
      strategy.entry("L", "LONG", {
        leverage: ctx.input.leverage,
        budgetUsdt: ctx.input.budgetUsdt,
        reason: "mtf_long_pullback"
      });
    }

    if (shortSetup) {
      strategy.entry("S", "SHORT", {
        leverage: ctx.input.leverage,
        budgetUsdt: ctx.input.budgetUsdt,
        reason: "mtf_short_pullback"
      });
    }

    plot.line("emaFast", emaFast.last());
    plot.line("emaSlow", emaSlow.last());
    plot.line("emaTrend", emaTrend.last());
    plot.marker(longSetup, "BUY");
    plot.marker(shortSetup, "SELL");
  }
});
```

## API do contexto

### `ctx.series`

- `open()`
- `high()`
- `low()`
- `close()`
- `volume()`

Cada chamada retorna uma série indexável, com:

- `last()`
- `at(index)`
- `slice(n)`

### `ctx.htf`

- mesma interface da série local
- sempre fechada e alinhada ao relógio do motor

### `ctx.macro`

- `regime`
- `stressScore`
- `riskMarkers`

### `ctx.policy`

- `riskMode`
- `allowedSide`
- `leverageCap`
- `stopProfile`
- `holdPolicy`
- `noTrade`

### `strategy`

- `entry(id, side, options)`
- `exit(id, options)`
- `closeAll(reason)`

### `plot`

- `line(name, value)`
- `histogram(name, value)`
- `marker(condition, text)`
- `band(name, upper, lower)`

## Execução e sandbox

O script deve rodar em `Web Worker` ou ambiente isolado, com:

- timeout curto por barra
- sem imports arbitrários
- sem acesso a rede
- serialização de saída em JSON

Contrato de retorno:

```js
{
  signals: [...],
  plots: [...],
  diagnostics: [...]
}
```

## Etapas de implementação

### Fase 1

- chart `5m`
- overlay de sinais
- editor JS
- runner local em memória
- envio de webhook para a bridge

### Fase 2

- suporte `4h` nativo
- replay/backtest visual
- painel de macro/policy
- journal de trades

### Fase 3

- múltiplas estratégias
- comparação A/B
- otimização walk-forward
- biblioteca de scripts

## Decisão recomendada

No curto prazo:

- manter a bridge atual
- remover a dependência de TradingView como emissor principal
- construir o terminal primeiro como `gerador de sinais`
- só depois acoplar roteamento de ordens mais sofisticado

Assim a troca é controlada: o chart e o scripting mudam, mas o firewall de risco e a execução continuam no mesmo lugar.
