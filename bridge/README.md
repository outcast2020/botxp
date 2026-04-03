# Bridge Node.js

Bridge minima para receber webhooks do TradingView, decidir risco, executar `DOGEUSDT` em `Binance USD-SM Futures` e sincronizar snapshots com o Web App do Apps Script.

## O que esta versao faz

- recebe `LONG_ENTRY`, `SHORT_ENTRY` e `FLAT_EXIT`
- valida `passphrase`, idade do sinal e duplicatas por `nonce`
- opera em `One-way + Isolated`
- suporta `dry-run` por padrao
- registra estado e logs locais em `bridge/data`
- sincroniza `status` e `equity` com o Apps Script, se configurado

## Pastas

```text
bridge/
  .env.example
  README.md
  data/
  src/
    apps-script-sync.js
    binance-futures-client.js
    config.js
    risk-engine.js
    server.js
    store.js
    utils.js
```

## Como rodar

1. Copie `.env.example` para `.env`.
2. Ajuste ao menos `TV_PASSPHRASE`.
3. Deixe `DRY_RUN=true` no primeiro teste.
4. Rode `npm run bridge:start`.
5. Aponte o webhook do TradingView para `http://SEU_HOST:8787/webhook`.

## Endpoints locais

- `GET /health`
- `GET /state`
- `POST /webhook`

## Virando para live

Para mandar ordens reais:

- configure `BINANCE_API_KEY`
- configure `BINANCE_API_SECRET`
- ajuste `DRY_RUN=false`
- confirme que a chave tem permissao de `USD-SM Futures`

## Apps Script

Se voce preencher `APPS_SCRIPT_SYNC_URL`, a bridge envia:

- `status`
- `equity`
- `runtime`
- `executions`
- `trades`

para o `doPost()` do Web App. O `Code.gs` deste projeto vai receber esse payload.
