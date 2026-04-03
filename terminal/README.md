# Terminal Próprio

Esta pasta agora já contém um MVP utilizável do terminal web próprio.

O que já existe:

- chart local com candles Binance
- editor de estratégia em JS
- runner local compatível com uma DSL estilo Pine
- envio manual ou automático de sinais para a bridge
- servidor estático simples em `localhost`

Arquitetura alvo:

- [Especificação completa](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\TERMINAL_JS_PINE_STYLE_SPEC.md)
- [Exemplo de script](C:\Users\Carlos\Documents\ai BOT\small exp\paper-trading-lab\terminal\examples\doge-mtf-scalper.js)

## Como rodar

1. Rode `npm run bridge:trade` em uma janela.
2. Rode `npm run terminal:start` em outra.
3. Abra `http://localhost:3030`.
4. Preencha `Bridge URL` e `Passphrase`.
5. Clique em `Rodar estratégia`.
6. Use `Enviar último sinal` para testar o webhook.
