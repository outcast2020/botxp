# Apps Script setup

## O que este backend faz agora

- cria e configura a planilha do monitor
- guarda `status`, `equity` e `runtime` em Script Properties
- recebe sync da bridge Node.js via `doPost()`
- expõe:
  - `?view=status`
  - `?view=equity`
  - `?view=runtime`
  - `?view=config`
- serve o dashboard HTML do proprio Apps Script na URL principal

## Passo a passo

1. Entre na pasta raiz `paper-trading-lab`.
2. Rode `npm install`.
3. Rode `npm run clasp:login`.
4. Crie um Script standalone no editor do Apps Script.
5. Preencha o `scriptId` em `.clasp.json`.
6. Rode `npm run clasp:push`.
7. No editor do Apps Script, execute `configureDefaultBridgeSpreadsheet()`.
8. Copie o `bridgeSyncToken` retornado.
9. Faca deploy como `Web app`.
10. Se quiser usar o painel do GitHub Pages, publique o deploy com acesso de leitura `Anyone`.

Opcionalmente, voce pode tentar `npm run clasp:create`, mas o caminho mais simples e menos sujeito a erro eh preencher o `scriptId` manualmente.

## Funcoes principais

- `setupBridgeSpreadsheet()`
- `configureDefaultBridgeSpreadsheet()`
- `configureBridgeSpreadsheet(spreadsheetId)`
- `getBridgeSyncToken()`
- `setBridgeSyncToken(token)`

## Integracao com o frontend

Agora o projeto pode operar inteiramente dentro do Apps Script:

- a URL principal do Web App abre `Dashboard.html`
- `?view=status` retorna JSON de status
- `?view=equity` retorna JSON de equity
- `?view=runtime` retorna JSON de runtime da bridge
- `?view=health` retorna um healthcheck simples

URL publicada atual:

- [painel](https://script.google.com/macros/s/AKfycbwgWtgshOLOd9BYQV2yKlpLzf3lATQK827EMihoxcXQrEAKDGTdpCTWeI_M7y2rQw1Wqg/exec)

O frontend em `docs/` agora eh o dashboard para GitHub Pages.
