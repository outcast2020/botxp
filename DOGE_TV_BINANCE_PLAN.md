# DOGEUSDT: TradingView + Binance Futures + Sheets/App

Este documento redefine a versao inicial para:

- `TradingView` como gerador de sinal
- `Node.js bridge` como executor e gestor de risco
- `Binance USDⓈ-M Futures` para operar `LONG` e `SHORT`
- `Google Sheets` para registrar PnL
- `Apps Script Web App` para visualizar cards e graficos

## Premissas

- Mercado: `Binance USDⓈ-M Futures`
- Contrato: `DOGEUSDT`
- Capital inicial: `20 USDT`
- Direcional: `LONG` e `SHORT`
- Alavancagem alvo: ate `10x`
- Modo de posicao recomendado na v1: `One-way`
- Modo de margem recomendado na v1: `ISOLATED`
- Frequencia: curta e reativa, mas nao HFT
- Composto: recalcule o budget 1 vez a cada 24h com base no saldo realizado

Importante:

- `10x` e tecnicamente suportado pela API de futures; o endpoint de leverage aceita `1` a `125`, sujeito a regras do simbolo
- isso nao significa que `10x` seja uma boa configuracao inicial com `20 USDT`
- para v1, eu recomendo `default = 5x`, com cap operacional em `10x`

Referencias oficiais:

- New Order `POST /fapi/v1/order`
- Change Position Mode `POST /fapi/v1/positionSide/dual`
- Change Margin Type `POST /fapi/v1/marginType`
- Change Initial Leverage `POST /fapi/v1/leverage`
- Position Risk `GET /fapi/v3/positionRisk`
- User Data Stream e Market Streams

## 1. Estrategia Pine para DOGEUSDT

### Objetivo

Capturar micro-oscilacoes em `1m`, tanto para compra quanto para venda, operando:

- `LONG` quando houver retomada de alta apos excesso vendedor
- `SHORT` quando houver rejeicao de alta apos excesso comprador

A execucao fica em `1m`, mas a permissao de operar e a gestao do trade passam por um filtro de tendencia de `4h`.

### Base da logica

Usaremos dois regimes locais:

- `trend_up`: `EMA9 > EMA34 > EMA89`
- `trend_down`: `EMA9 < EMA34 < EMA89`

E dois regimes de contexto maior em `4h`:

- `htf_bull`: preco de 4h acima da EMA base, EMA curta acima da EMA media e RSI de 4h acima da zona neutra
- `htf_bear`: preco de 4h abaixo da EMA base, EMA curta abaixo da EMA media e RSI de 4h abaixo da zona neutra

Entradas:

- `LONG`: pullback curto com reclaim acima da banda inferior, mas apenas se o `4h` estiver bullish
- `SHORT`: spike curto com fade abaixo da banda superior, mas apenas se o `4h` estiver bearish

Saidas:

- alvo curto
- stop curto
- quebra de estrutura
- reversao de momentum
- trailing stop dinamico

### Parametros iniciais

- timeframe: `1m`
- filtro de contexto: `4h`
- `EMA 9`, `EMA 34`, `EMA 89`
- `EMA 21`, `EMA 55`, `EMA 200` no `4h`
- `RSI 7`
- `RSI 14` no `4h`
- `Bollinger 20 / 2.0`
- `ATR 14`
- filtro de ATR minimo e maximo
- cooldown entre entradas
- alvo e stop percentuais
- break-even armado por lucro
- trailing baseado em ATR do `1m`

### Regras iniciais

#### `LONG`

- `trend_up`
- `htf_bull`
- `ATR%` dentro da faixa
- `low < lowerBand`
- `close > lowerBand`
- `close > EMA9`
- `RSI < 38`

#### `SHORT`

- `trend_down`
- `htf_bear`
- `ATR%` dentro da faixa
- `high > upperBand`
- `close < upperBand`
- `close < EMA9`
- `RSI > 62`

#### `EXIT LONG`

- take profit
- stop loss
- trailing stop
- `close < EMA34`
- ou `close >= basis && RSI > 55`
- ou inversao do contexto `4h`

#### `EXIT SHORT`

- take profit
- stop loss
- trailing stop
- `close > EMA34`
- ou `close <= basis && RSI < 45`
- ou inversao do contexto `4h`

### Logica do stop em lucro

Se o trade entra em lucro:

- primeiro armamos um `break-even stop`
- depois passamos a subir o stop com base no `ATR` do `1m`

Comportamento:

- se o `4h` estiver alinhado com a direcao do trade, o trailing fica mais largo
- se o `4h` perder alinhamento ou ficar hostil, o trailing fica mais curto e protege lucro mais cedo

### Observacao de desenho

Na v1:

- a estrategia Pine so gera sinais
- a bridge decide se executa
- a bridge impede ordens duplicadas
- a bridge faz flip de posicao quando necessario
- a bridge tambem pode recusar scalp se o contexto `4h` enviado no payload vier fraco ou inconsistente

## 2. Formato do webhook JSON

### Alert message recomendado no TradingView

Use no alerta:

```text
{{strategy.order.alert_message}}
```

### Payload recomendado

```json
{
  "passphrase": "CHANGE_ME",
  "source": "tradingview",
  "strategy_id": "doge_futures_reactive_v1",
  "action": "LONG_ENTRY",
  "symbol": "DOGEUSDT",
  "market": "usds_m_futures",
  "interval": "1",
  "bar_time": 1743672060000,
  "price": "0.09123",
  "leverage": "5",
  "margin_mode": "ISOLATED",
  "position_mode": "ONE_WAY",
  "order_budget_usdt": "7.00",
  "qty_hint": "383",
  "rsi": "34.12",
  "atr_pct": "0.49",
  "reason": "long_dip_reclaim",
  "nonce": "doge_futures_reactive_v1-1743672060000-LONG_ENTRY"
}
```

### Acoes da v1

- `LONG_ENTRY`
- `SHORT_ENTRY`
- `FLAT_EXIT`

### Campos obrigatorios na bridge

- `passphrase`
- `source`
- `strategy_id`
- `action`
- `symbol`
- `market`
- `bar_time`
- `price`
- `nonce`

## 3. Arquitetura da bridge para Binance

## 3.1 Decisao de modo de posicao

Mesmo querendo `LONG` e `SHORT`, a v1 deve usar `One-way Mode`.

Motivo:

- e mais simples
- reduz ambiguidade
- ainda permite operar comprado e vendido
- a bridge pode inverter a posicao quando o sinal mudar

Pela doc oficial:

- em `One-way Mode`, `positionSide` padrao e `BOTH`
- `Hedge Mode` so e necessario se voce quiser manter `LONG` e `SHORT` simultaneos

## 3.2 Configuracao inicial na Binance Futures

No boot da bridge:

1. `POST /fapi/v1/positionSide/dual` com `false`
2. `POST /fapi/v1/marginType` com `ISOLATED`
3. `POST /fapi/v1/leverage` com `5` ou `10`

Configuracao recomendada:

- `position mode = One-way`
- `margin mode = ISOLATED`
- `leverage default = 5x`
- `max leverage allowed by config = 10x`

## 3.3 Componentes

### `webhook-ingress`

Recebe POST do TradingView.

Responsabilidades:

- validar `Content-Type`
- validar `passphrase`
- validar idade do alerta
- rejeitar duplicatas por `nonce`
- registrar o payload bruto

### `risk-engine`

Decide se o sinal pode virar ordem.

Responsabilidades:

- checar saldo em USDT futures wallet
- checar posicao atual
- checar perda diaria
- checar numero maximo de trades do dia
- checar drawdown do dia
- travar se alavancagem efetiva subir demais

### `symbol-rules-cache`

Carrega e mantem filtros reais do contrato.

Responsabilidades:

- `tickSize`
- `stepSize`
- `minQty`
- `minNotional`
- regras de precision

### `execution-engine`

Converte o sinal em ordem Binance.

Responsabilidades:

- assinar request
- fechar posicao oposta se necessario
- abrir nova posicao
- consultar resposta da ordem
- reconciliar fill real

### `position-manager`

Responsabilidades:

- manter estado `FLAT`, `LONG`, `SHORT`
- guardar entry price medio
- guardar quantidade
- calcular PnL realizado e nao realizado
- controlar flip de lado

### `sheet-sync`

Responsabilidades:

- append em Sheets
- atualizar estado de runtime
- atualizar serie de equity

## 3.4 Fluxo da v1

### Se chegar `LONG_ENTRY`

1. Validar payload.
2. Checar risco diario.
3. Se ja estiver `LONG`, ignorar.
4. Se estiver `SHORT`, enviar ordem para zerar o short.
5. Enviar ordem de abertura `BUY`.
6. Confirmar a posicao real por `positionRisk` e User Data Stream.
7. Registrar tudo em banco e planilha.

### Se chegar `SHORT_ENTRY`

1. Validar payload.
2. Checar risco diario.
3. Se ja estiver `SHORT`, ignorar.
4. Se estiver `LONG`, enviar ordem para zerar o long.
5. Enviar ordem de abertura `SELL`.
6. Confirmar a posicao real por `positionRisk` e User Data Stream.
7. Registrar tudo em banco e planilha.

### Se chegar `FLAT_EXIT`

1. Validar payload.
2. Se estiver `FLAT`, ignorar.
3. Se estiver `LONG`, enviar `SELL` para zerar.
4. Se estiver `SHORT`, enviar `BUY` para zerar.
5. Registrar tudo.

## 3.5 Tipo de ordem da v1

Para a v1, eu recomendo:

- entrada: `MARKET`
- saida: `MARKET`

Motivo:

- com TradingView webhook, a prioridade deve ser consistencia operacional
- com apenas `20 USDT`, o sistema precisa ser simples e auditavel

Na v2:

- testar entradas limitadas
- testar filtros por spread
- testar reducOnly e ordens condicionais

## 3.6 Persistencia local

Mesmo com planilha, a bridge deve manter estado local em `SQLite`.

Tabelas minimas:

- `signals_received`
- `orders_sent`
- `fills`
- `positions`
- `equity_snapshots`
- `daily_stats`

## 4. Registro de PnL em planilha e grafico no app

## 4.1 Abas recomendadas

### `executions`

Cada fill real.

Colunas:

- `timestamp`
- `symbol`
- `side`
- `position_side`
- `order_type`
- `client_order_id`
- `binance_order_id`
- `fill_price`
- `fill_qty`
- `notional`
- `fee_asset`
- `fee_amount`
- `signal_nonce`
- `reason`

### `trades`

Cada ciclo de trade direcional fechado.

Colunas:

- `trade_id`
- `direction`
- `entry_time`
- `exit_time`
- `symbol`
- `entry_price_avg`
- `exit_price_avg`
- `qty`
- `leverage`
- `gross_pnl`
- `fees_total`
- `funding_total`
- `net_pnl`
- `return_on_margin_pct`
- `duration_sec`
- `exit_reason`

### `equity_snapshots`

Colunas:

- `timestamp`
- `wallet_balance`
- `available_balance`
- `margin_used`
- `position_notional`
- `mark_price`
- `unrealized_pnl`
- `realized_pnl_day`
- `realized_pnl_total`
- `total_equity`

### `runtime`

Colunas:

- `timestamp`
- `bot_status`
- `market_mode`
- `position_state`
- `position_qty`
- `position_avg_price`
- `effective_leverage`
- `last_signal`
- `last_error`
- `trades_today`
- `wins_today`
- `losses_today`
- `daily_stop_active`

### `daily_rollup`

Colunas:

- `date`
- `starting_equity`
- `ending_equity`
- `net_pnl_day`
- `trades_count`
- `win_rate`
- `fees_day`
- `funding_day`
- `max_drawdown_day`

## 4.2 Cards do painel no app

- `equity total`
- `PnL do dia`
- `PnL total`
- `PnL nao realizado`
- `lado atual`
- `alavancagem efetiva`
- `numero de trades`
- `win rate`
- `fees acumuladas`
- `estado do bot`

## 4.3 Graficos recomendados

### Grafico 1

Linha de `total_equity`

### Grafico 2

Barras de `net_pnl_day`

### Grafico 3

Linha de `realized_pnl_total`

### Grafico 4

Linha de `effective_leverage`

## 4.4 Calculos principais

### Equity total

```text
total_equity = wallet_balance + unrealized_pnl
```

### PnL liquido do trade

```text
net_pnl = gross_pnl - fees_total - funding_total
```

### Budget diario composto

```text
budget_next_day = ending_equity * allocation_pct
```

## 5. Regras iniciais de risco para 20 USDT

- capital inicial: `20 USDT`
- leverage padrao: `5x`
- leverage maximo permitido pela config: `10x`
- budget por trade inicial: `7 USDT` de margem
- exposicao nominal aproximada:
  - `35 USDT` com 5x
  - `70 USDT` com 10x
- 1 posicao por vez
- no maximo `6 trades` por dia
- stop diario: `-1.5 USDT`
- pausa apos `3 perdas` seguidas
- trava se a margem livre cair abaixo de um limite seguro

## 6. Roadmap curto

### Fase 1

- Pine direcional pronta
- webhook bridge recebendo `LONG_ENTRY`, `SHORT_ENTRY`, `FLAT_EXIT`
- configuracao de futures no boot
- ordens reais ou demo controladas
- registro em Sheets

### Fase 2

- User Data Stream para reconciliacao em tempo real
- graficos no Apps Script
- auditoria de slippage e fee

### Fase 3

- filtros de horario
- filtros de spread
- sizing adaptativo por volatilidade
- optimizacao do stop/target
