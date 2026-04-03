# BOTXP

Projeto para operar `DOGEUSDT` com:

- `TradingView` gerando sinais
- `Node.js bridge` executando e controlando risco
- `Binance USD-SM Futures` para `LONG` e `SHORT`
- `Google Apps Script` recebendo snapshots e gravando em planilha
- `GitHub Pages` exibindo o painel publico

Defaults atuais:

- execucao principal em `5m`
- filtro direcional em `4h`
- `DEFAULT_LEVERAGE=3`
- `MAX_LEVERAGE=5`
- capital inicial de pesquisa em `20 USDT`

## Arquitetura atual

- `bridge/`
  - recebe webhook do TradingView
  - valida risco e duplicatas
  - executa em backtest, dry-run ou live
  - sincroniza `status`, `equity`, `runtime`, `trades` e `executions` com o Apps Script
- `apps-script/`
  - cria e configura a planilha
  - recebe o sync da bridge via `doPost()`
  - expõe `?view=status`, `?view=equity`, `?view=runtime` e `?view=config`
- `docs/`
  - dashboard estatico para GitHub Pages
  - consome os endpoints JSON do Web App publicado

## Limite importante do GitHub

O GitHub pode hospedar o painel e versionar o codigo, mas ele **nao deve ser tratado como host continuo da bridge**. O processo Node que recebe webhooks e manda ordens precisa rodar em:

- sua maquina
- uma VPS
- ou um runner proprio

Para o painel funcionar no GitHub Pages, o Web App do Apps Script precisa estar publicado com acesso publico de leitura.

## Estrutura

```text
paper-trading-lab/
  .clasp.json
  .claspignore
  package.json
  bridge/
    .env.example
    src/
      server.js
      config.js
      binance-futures-client.js
      risk-engine.js
      apps-script-sync.js
  apps-script/
    appsscript.json
    Code.gs
    Dashboard.html
  docs/
    index.html
    app.js
    styles.css
```

## Uso com clasp

Esta pasta continua pronta para `clasp`, em modo single-file com `appsscript.json`, `Code.gs` e `Dashboard.html`.

## Fluxo minimo

1. entre em `paper-trading-lab`
2. rode `npm install`
3. rode `npm run clasp:login`
4. crie um projeto standalone no Apps Script ou use um existente
5. cole o `scriptId` em `.clasp.json`
6. rode `npm run clasp:push`
7. no Apps Script, rode `configureDefaultBridgeSpreadsheet()`
8. copie o `bridgeSyncToken`
9. configure `bridge/.env`
10. rode `npm run bridge:start`

## Dois modos do bot

### Modo teste

Use `npm run bridge:backtest`.

Esse modo:

- busca candles historicos da Binance Futures
- simula entradas e saidas em `DOGEUSDT`
- gera arquivos de saida em `bridge/data`
- grava um dataset em `training-samples.jsonl` para pesquisa e evolucao do algoritmo

Arquivos gerados:

- `backtest-report.json`
- `backtest-trades.json`
- `backtest-equity.json`
- `backtest-training-samples.jsonl`

### Modo trading

Use `npm run bridge:trade`.

Esse modo:

- sobe o servidor webhook
- recebe sinais do TradingView
- opera em `dry-run` ou em conta real, conforme `DRY_RUN`
- envia snapshots para o Apps Script

Para operar com dinheiro real:

- configure `BINANCE_API_KEY`
- configure `BINANCE_API_SECRET`
- ajuste `DRY_RUN=false`
- mantenha o `APPS_SCRIPT_SYNC_TOKEN` correto

## GitHub Pages

O painel estatico fica em `docs/`.

Depois de subir este repo para `main`, configure no GitHub:

- `Settings > Pages`
- source: `Deploy from a branch`
- branch: `main`
- folder: `/docs`

O dashboard vai tentar ler por padrao:

- [status](https://script.google.com/macros/s/AKfycbwgWtgshOLOd9BYQV2yKlpLzf3lATQK827EMihoxcXQrEAKDGTdpCTWeI_M7y2rQw1Wqg/exec?view=status)
- [equity](https://script.google.com/macros/s/AKfycbwgWtgshOLOd9BYQV2yKlpLzf3lATQK827EMihoxcXQrEAKDGTdpCTWeI_M7y2rQw1Wqg/exec?view=equity)
- [runtime](https://script.google.com/macros/s/AKfycbwgWtgshOLOd9BYQV2yKlpLzf3lATQK827EMihoxcXQrEAKDGTdpCTWeI_M7y2rQw1Wqg/exec?view=runtime)

Se o Web App estiver privado, o Pages nao consegue ler. Nesse caso, publique o deploy como `Anyone`.
