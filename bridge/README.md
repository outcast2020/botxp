# Bridge Node.js

Bridge minima para:

- receber sinais por webhook
- validar risco
- executar `DOGEUSDT` em `Binance USD-SM Futures`
- sincronizar snapshots com o Web App do Apps Script

## O que esta versao faz

- separa `modo teste` e `modo trading`
- recebe `LONG_ENTRY`, `SHORT_ENTRY` e `FLAT_EXIT`
- valida `passphrase`, idade do sinal e duplicatas por `nonce`
- opera em `One-way + Isolated`
- consulta Polymarket como proxy macro de stress
- usa apenas market data publica da Polymarket
- nao usa API key, secret ou passphrase da Polymarket
- pode consultar OpenAI para gerar policy JSON
- suporta `dry-run` por padrao
- grava estado e logs locais em `bridge/data`
- sincroniza `status`, `equity`, `runtime`, `macro`, `policy`, `trades` e `executions`

## Modos

### Backtest

1. Copie `.env.example` para `.env`.
2. Ajuste o recorte historico.
3. Rode `npm run bridge:backtest`.

### Trading

1. Copie `.env.example` para `.env`.
2. Defina `SIGNAL_PASSPHRASE`.
3. Deixe `DRY_RUN=true` no primeiro teste.
4. Rode `npm run bridge:trade`.
5. Aponte o emissor de sinais para `http://SEU_HOST:8787/webhook`.

## Endpoints locais

- `GET /health`
- `GET /state`
- `GET /macro/oil`
- `GET /policy`
- `POST /webhook`

## Seguranca

Para live:

- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`
- `DRY_RUN=false`
- chave sem saque
- segredo fora do Git

Detalhamento em [SECURITY_KEYS_REVIEW.md](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\SECURITY_KEYS_REVIEW.md).
