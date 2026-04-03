# Revisao de Seguranca para Chaves de API

## Situacao atual

O projeto ja separa bem:

- frontend publico
- Apps Script
- bridge Node.js
- `.env` local ignorado pelo Git

Mas ainda existe um risco operacional claro:

- qualquer chave colada em chat, email, screenshot ou arquivo versionado deve ser tratada como potencialmente comprometida

## Regras de seguranca recomendadas

### 1. Rotacione credenciais ja expostas

Se uma `API key`, `secret`, `passphrase` ou token foi compartilhado fora do cofre local, a postura correta e:

- revogar
- criar novo par
- atualizar somente no `.env` local ou no secret manager do host

### 2. Nunca coloque segredo em:

- `Code.gs`
- `Dashboard.html`
- `docs/app.js`
- `docs/index.html`
- arquivos versionados
- `localStorage`
- query string

### 3. Separe chaves por funcao

Use pelo menos:

- uma chave para `dry-run` e leitura
- outra chave exclusiva para `live trading`

Se a conta permitir, use subconta separada para live.

### 4. Restrinja permissoes

Na chave de live:

- habilite apenas o necessario para futures/trade
- desabilite saque
- desabilite permissoes que nao serao usadas
- aplique allowlist de IP sempre que possivel

### 5. Nunca rode live sem guard-rails

Regras minimas:

- `DRY_RUN=false` so com `BINANCE_API_KEY` e `BINANCE_API_SECRET`
- `SIGNAL_PASSPHRASE` obrigatorio para qualquer emissor externo
- `One-way + Isolated`
- leverage cap baixo no inicio
- stop diario ativo
- limite de perdas consecutivas

### 6. Separe segredo de politica e segredo de execucao

Mantenha independentes:

- credenciais Binance
- token do Apps Script
- chave OpenAI
- segredos de webhook

Comprometimento de um nao deve derrubar todos os outros.

Observacao:

- para este projeto, a Polymarket pode operar em leitura publica somente
- portanto, nao ha necessidade de armazenar credenciais da Polymarket na bridge

### 7. Logue sem vazar

Permitido em logs:

- status
- order id
- nonce
- pnl
- regime

Nunca logar:

- `BINANCE_API_SECRET`
- tokens completos
- assinaturas HMAC
- payload bruto com segredo

## Checklist antes de live

- `.env` fora do Git
- chave com saque desabilitado
- IP allowlist configurada
- subconta ou conta segregada
- `DRY_RUN` testado
- `APPS_SCRIPT_SYNC_TOKEN` validado
- `SIGNAL_PASSPHRASE` forte e exclusivo
- plano de rotacao documentado

## Estado recomendado do projeto

- frontend: sem segredos
- Apps Script: sem segredos de exchange
- bridge: unico lugar com segredo de exchange e de politica
- host da bridge: controle de acesso e backup do `.env`
