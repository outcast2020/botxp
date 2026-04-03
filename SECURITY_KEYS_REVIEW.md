# Revisão de Segurança para Chaves de API

## Situação atual

O projeto já separa bem:

- frontend publico
- Apps Script
- bridge Node.js
- `.env` local ignorado pelo Git

Mas ainda existe um risco operacional claro:

- qualquer chave colada em chat, email, screenshot ou arquivo versionado deve ser tratada como potencialmente comprometida

## Regras de segurança recomendadas

### 1. Rotacione credenciais já expostas

Se uma `API key`, `secret`, `passphrase` ou token foi compartilhado fora do cofre local, a postura correta é:

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

### 3. Separe chaves por função

Use pelo menos:

- uma chave para `dry-run` e leitura
- outra chave exclusiva para `live trading`

Se a conta permitir, use subconta separada para live.

### 4. Restringa permissões

Na chave de live:

- habilite apenas o necessário para futures/trade
- desabilite saque
- desabilite permissões que não serão usadas
- aplique allowlist de IP sempre que possível

### 5. Nunca rode live sem guard-rails

Regras mínimas:

- `DRY_RUN=false` só com `BINANCE_API_KEY` e `BINANCE_API_SECRET`
- `SIGNAL_PASSPHRASE` obrigatório para qualquer emissor externo
- `One-way + Isolated`
- leverage cap baixo no início
- stop diário ativo
- limite de perdas consecutivas

### 6. Separe segredo de política e segredo de execução

Mantenha independentes:

- credenciais Binance
- token do Apps Script
- chave DeepSeek
- segredos de webhook

Comprometimento de um não deve derrubar todos os outros.

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
- plano de rotação documentado

## Estado recomendado do projeto

- frontend: sem segredos
- Apps Script: sem segredos de exchange
- bridge: unico lugar com segredo de exchange
- host da bridge: controle de acesso e backup do `.env`
