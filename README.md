# BOTXP

Projeto de pesquisa para `DOGEUSDT` com:

- bridge `Node.js` para backtest, dry-run e live
- `Binance USD-SM Futures`
- `Google Apps Script` como monitor + planilha + Web App
- `GitHub Pages` como painel público

Direção atual:

- manter a bridge como firewall de risco e execução
- reduzir dependência de plataformas fechadas de sinal
- migrar para um terminal próprio com scripts estilo Pine em JS

Documentos principais:

- [Terminal em JS estilo Pine](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\TERMINAL_JS_PINE_STYLE_SPEC.md)
- [Revisão de segurança das chaves](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\SECURITY_KEYS_REVIEW.md)

## Defaults atuais

- `SYMBOL=DOGEUSDT`
- `TIMEFRAME=5m`
- `HTF_TIMEFRAME=4h`
- `DEFAULT_LEVERAGE=3`
- `MAX_LEVERAGE=5`
- capital inicial de pesquisa: `20 USDT`

## Arquitetura atual

- `bridge/`
  - recebe sinais por webhook
  - valida risco, duplicatas, macro e policy
  - executa em backtest, dry-run ou live
  - sincroniza `status`, `equity`, `runtime`, `macro`, `policy`, `trades` e `executions`
- `apps-script/`
  - cria/configura a planilha
  - recebe sync via `doPost()`
  - expõe `?view=status`, `?view=equity`, `?view=runtime`, `?view=macro`, `?view=policy`, `?view=config`
  - serve o dashboard HTML na raiz do Web App
- `docs/`
  - painel estático para GitHub Pages
  - lê os endpoints JSON do Web App

## Estrutura

```text
paper-trading-lab/
  package.json
  TERMINAL_JS_PINE_STYLE_SPEC.md
  SECURITY_KEYS_REVIEW.md
  bridge/
  apps-script/
  docs/
```

## Fluxo mínimo

1. Entre em `paper-trading-lab`.
2. Rode `npm install`.
3. Configure `.clasp.json`.
4. Rode `npm run clasp:push`.
5. No Apps Script, rode `configureDefaultBridgeSpreadsheet()`.
6. Copie o `bridgeSyncToken`.
7. Configure `bridge/.env`.
8. Rode `npm run bridge:start`.

## Modos

### Backtest

Use `npm run bridge:backtest`.

Saídas em `bridge/data`:

- `backtest-report.json`
- `backtest-trades.json`
- `backtest-equity.json`
- `backtest-training-samples.jsonl`

### Trading

Use `npm run bridge:trade`.

Para live:

- `DRY_RUN=false`
- `BINANCE_API_KEY` e `BINANCE_API_SECRET`
- `SIGNAL_PASSPHRASE`
- `APPS_SCRIPT_SYNC_TOKEN`

## Web App atual

URL atual:

- [painel](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec)
- [status](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=status)
- [equity](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=equity)
- [runtime](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=runtime)
- [macro](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=macro)
- [policy](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=policy)

## GitHub Pages

Depois de subir em `main`:

- `Settings > Pages`
- source: `Deploy from a branch`
- branch: `main`
- folder: `/docs`

Se o Web App estiver privado, o GitHub Pages não consegue ler. Nesse caso, publique o deploy como `Anyone`.
