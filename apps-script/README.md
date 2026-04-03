# Apps Script Setup

## O que este backend faz

- cria e configura a planilha do monitor
- recebe sync da bridge via `doPost()`
- guarda `status`, `equity`, `runtime`, `macro` e `policy`
- expõe:
  - `?view=status`
  - `?view=equity`
  - `?view=runtime`
  - `?view=macro`
  - `?view=policy`
  - `?view=config`
- serve o dashboard HTML do próprio Apps Script na raiz

## Passo a passo

1. Rode `npm install`.
2. Rode `npm run clasp:login`.
3. Crie um projeto standalone no Apps Script.
4. Preencha o `scriptId` em `.clasp.json`.
5. Rode `npm run clasp:push`.
6. No editor do Apps Script, execute `configureDefaultBridgeSpreadsheet()`.
7. Rode `getBridgeSyncToken()`.
8. Faça deploy como `Web app`.
9. Para o GitHub Pages ler o painel, publique com acesso `Anyone`.

## Funções principais

- `setupBridgeSpreadsheet()`
- `configureDefaultBridgeSpreadsheet()`
- `configureBridgeSpreadsheet(spreadsheetId)`
- `getBridgeSyncToken()`
- `setBridgeSyncToken(token)`

## URL publicada atual

- [painel](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec)
- [status](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=status)
- [runtime](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=runtime)
- [macro](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=macro)
- [policy](https://script.google.com/macros/s/AKfycbxayvxYzLCYBiMxs60A4AvIyreE2ouCJcaMUslIH0xwWA-1kZVLQFUoKv8VDHBd7x3bwA/exec?view=policy)

O frontend em `docs/` continua sendo a versão para GitHub Pages.
