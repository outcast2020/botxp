# Terminal Proprio

Esta pasta contem o terminal web proprio do projeto.

O que ja existe:

- chart local com candles Binance Futures
- editor de estrategia em JS com API estilo Pine
- plots de linha, histograma, banda e marcadores
- replay visual candle a candle
- backtest visual com equity, drawdown e trades fechados
- painel de posicao, payload do sinal e tabela de trades
- envio manual ou automatico de sinais para a bridge
- servidor estatico simples em `http://localhost:3030`

Arquitetura alvo:

- [Especificacao completa](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\TERMINAL_JS_PINE_STYLE_SPEC.md)
- [Exemplo de script](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\terminal\examples\doge-mtf-scalper.js)

## Como rodar

1. Rode `npm run bridge:trade` em uma janela.
2. Rode `npm run terminal:start` em outra.
3. Abra `http://localhost:3030`.
4. Preencha `Bridge URL` e `Passphrase`.
5. Clique em `Rodar estrategia`.
6. Use o replay para navegar pelos frames.
7. Use `Enviar sinal do frame atual` para testar o webhook.
