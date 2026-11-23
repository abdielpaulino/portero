# Publicação inicial controlada

Versão inicial: login, logout, catálogo, detalhes, dashboard de estoque e histórico
de baixas. Não exige a extensão comercial. Configuração e validação publicada
continuam a cargo da equipe; este documento não registra um deploy realizado.

## Configuração inicial

Manter no projeto **API** da Vercel:

```dotenv
NODE_ENV=production
STOCK_DECREASES_ENABLED=false
EXTERNAL_SALES_ENABLED=false
ONLINE_ORDERS_ENABLED=false
INVITATIONS_ENABLED=false
STOCK_CONFERENCES_ENABLED=false
STORE_SETTINGS_ENABLED=false
STOCK_NOTIFICATIONS_ENABLED=false
```

Configurar também `DATABASE_URL` com SSL, `JWT_SECRET`, `WEB_ORIGIN`,
`API_PUBLIC_URL`, `NUVEMSHOP_STORE_ID`, `NUVEMSHOP_USER_AGENT`,
`NUVEMSHOP_CLIENT_ID` e `NUVEMSHOP_CLIENT_SECRET`, conforme [DEPLOY.md](DEPLOY.md).
No **frontend**, configurar somente `API_URL` com a origem HTTPS da API, sem
barra final. Não usar `NEXT_PUBLIC_` para segredos.

Usar Node.js 22 nos dois projetos, Root Directory `apps/api` e `apps/web`,
respectivamente. Instalação: `npm ci --include=dev`. Build: `npm run build`.
Backend com preset Other; frontend com preset Next.js. Manter o lockfile da raiz
acessível aos builds. Não executar `db:migrate`, `db:generate` ou SQL inicial.

O banco de produção deve conter as quatro tabelas originais e ser exclusivo da
instalação. Conferir permissões e RLS sem copiar registros da demo. Usar Session
pooler 5432 ou conexão direta; a porta 6543 é recusada. Demo já conectada não exige
novo OAuth. Primeira instalação real exige o procedimento administrativo de
DEPLOY.md, executado pela equipe somente após conferir o destino.

## Verificação local

Na raiz, com Node.js 22 e dependências do lockfile:

```powershell
npm.cmd ci --include=dev
npm.cmd test --workspace=@portero/api
npm.cmd test --workspace=@portero/web
npm.cmd run build:api
npm.cmd run build:web
npm.cmd run lint --workspace=@portero/web
git diff --check
```

O build web requer acesso ao Google Fonts. Um build com mock de fontes comprova
compilação, mas não comprova acesso às fontes no ambiente de publicação.
Os testes padrão simulam PostgreSQL e Nuvemshop. O teste de publicação usa a
composição real do servidor com banco simulado sem tabelas comerciais: consulta,
histórico, bloqueio de escrita e exclusão são exercitados nesse cenário.
Esta preparação foi verificada localmente com Node.js 26; repetir os comandos
com Node.js 22, configurado para os deploys, antes da liberação.

## Condições antes de expor o acesso

| Tipo | Pendência |
| --- | --- |
| Código | Não há limitador distribuído de login/administração. A alternativa administrativa ao adaptador Resend ainda não está implementada |
| Configuração | Definir proteção contra tentativas abusivas na Vercel e canal verificável para solicitações de dados; configurar banco, segredos, origens e webhooks |
| Validação | Testar os dois deploys com HTTPS, cookies, origem, API direta, WAF, assinatura, entrega de relatório, cold start e pool |
| Extensão comercial | Migração ainda sem execução em PostgreSQL de teste; manter flags comerciais desligadas |

Sem proteção contra abuso e atendimento à privacidade verificáveis, a versão
pode ser preparada em ambiente de homologação restrito, mas não está liberada
para exposição pública. Controles de acesso da hospedagem também precisam
permitir os webhooks legítimos; não contornar sua assinatura.

Na Vercel, conferir WAF Rate Limiting **nos dois projetos**: o login passa pelo
Next, mas a API tem endereço direto. Proposta inicial para a operação acompanhada:
dez POSTs por IP em 60 segundos nos caminhos de autenticação/administração,
com ação de bloqueio/429. Conferir regras disponíveis no plano, normalização de
maiúsculas/barras e a origem efetivamente contada após o proxy. Não limitar os
webhooks por essa regra. Testar acesso via frontend e via API direta, com origem
válida, sem registrar senhas. Regra em modo Log não oferece bloqueio.
Contadores WAF são por região e não equivalem ao antigo limite por conta.
Essa configuração não foi aplicada nem validada neste trabalho.

O adaptador existente de privacidade exige `PORTERO_INSTALLATION_ID`,
`RESEND_API_KEY`, `PRIVACY_FROM_EMAIL` e `PRIVACY_MERCHANT_EMAIL`, com remetente
válido. Só confirmar atendimento após entrega ao lojista comprovada. Sem canal,
o endpoint devolve 503; não é uma solução concluída. Se a equipe não utilizar
esse adaptador, precisa implementar e validar o procedimento substituto antes
da liberação, sem ignorar solicitações legítimas.

## Deploy e conferência

1. A equipe publica a API a partir do commit revisado, com as três flags false.
2. Publica o frontend com `API_URL` apontando para a API e URLs Production estáveis.
3. Confere `/health` e, pelo frontend, login, recarga de rota protegida, catálogo,
   detalhes/variante, dashboard, histórico e logout. Health não testa o banco.
4. Confere que criação/execução de baixa e rotas comerciais autenticadas retornam
   503. Não executar teste de escrita na loja real. Conferir cookie Secure,
   HttpOnly, SameSite e rejeição de origem indevida.
5. Valida WAF e privacidade em instalação de teste, registra as evidências e só
   então libera acesso acompanhado. Assinatura ou exclusão testada na demo não
   autoriza enviar um evento de exclusão à loja real.

## Migração e ativação posterior

Não é necessária para a primeira publicação de consulta. Se houver PostgreSQL
local disponível, usar a execução de [REVISAO_VENDAS.md](REVISAO_VENDAS.md).
Não foi encontrado servidor local, Docker ou WSL neste ambiente.

Se a equipe tiver Docker, pode usar **somente um PostgreSQL descartável local**:

```powershell
docker run --rm --name portero-pg-review -e POSTGRES_PASSWORD=portero-local-test-only -e POSTGRES_DB=portero_local_tests -p 127.0.0.1:55432:5432 -d postgres:17
docker exec portero-pg-review pg_isready -U postgres -d portero_local_tests
# Repetir pg_isready até confirmar que o banco aceita conexões.
$env:PORTERO_LOCAL_PG_URL = 'postgresql://postgres:portero-local-test-only@127.0.0.1:55432/portero_local_tests'
try {
  npm.cmd exec --workspace=@portero/api -- tsx --test tests/sales-postgres.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'Validação PostgreSQL falhou; não aplicar em produção.' }
} finally {
  Remove-Item Env:PORTERO_LOCAL_PG_URL
  docker stop portero-pg-review
}
```

Esse teste cria um banco aleatório, reproduz as definições confirmadas e aplica
a migração nele. Não lê `.env` ou credenciais do Supabase. Exige resultado sem
falhas **e sem skip**; valida também as consultas de metadados antes/depois.
O teste não modifica estoque remoto nem usa a loja real.

O mesmo teste agora aplica também `20261122-operational-extension.sql` e cobre
convites, conferências, preferências, alertas persistentes e exclusão pelas FKs.
Exigir resultado sem falhas e sem skip antes da aplicação em uma instalação.

Após aprovação desse teste, a equipe revisa/aplica somente
`apps/api/sql/20261122-external-sales.sql` no banco de teste da instalação e
executa `20261122-external-sales-review.sql`, selecionando o papel real da API.
Confere RLS, permissões e fluxos conforme [VENDAS.md](VENDAS.md).
Só depois coordena migração no destino e novo deploy com
`EXTERNAL_SALES_ENABLED=true`. `ONLINE_ORDERS_ENABLED=true` é independente da
migração, mas exige `read_orders` e validação administrativa da autorização.
`STOCK_DECREASES_ENABLED` continua false até liberação explícita e teste acompanhado.

## Retorno sem perda de dados

Registrar o commit e os IDs dos dois deployments aprovados, além das flags
utilizadas. Antes de retornar, interromper escritas e conferir operações em curso.

- Sem extensão aplicada: retornar somente a um deployment previamente validado
  para a mesma instalação, com as três flags false e origens/segredos corretos.
- Com vendas registradas: manter tabelas e dados. Desativar as três flags e
  republicar uma versão que conheça a extensão, os vínculos de baixa e sua
  exclusão. Esta versão oferece esse modo; não retornar ao backend anterior
  à extensão. Não apagar tabelas nem reaplicar SQL inicial.
- Um rollback da hospedagem pode recuperar configurações antigas. Conferir
  flags explicitamente no deployment resultante; não presumir que continuam false.

Com flags false, dashboard e listagens comerciais não são consultados. O
webhook confere a existência da extensão em metadados e **continua excluindo
dados comerciais já existentes**, exceção aprovada pelo responsável. As rotas
legadas também preservam a conferência de vínculo em baixas históricas quando
a extensão existe. Sem as tabelas novas, só há a sondagem de metadados.
Operações incertas não são reenviadas ou compensadas automaticamente.

## Entrega operacional ao Felipe

1. Validar as duas migrações no PostgreSQL descartável pelo comando acima.
2. No banco de teste, revisar/aplicar `20261122-external-sales.sql` e depois
   `20261122-operational-extension.sql`; executar os dois arquivos `*-review.sql`.
   São independentes e cada arquivo é transacional. Conferir o papel SQL da API,
   RLS e identidades. Não aplicar em produção como primeiro teste.
3. Na demo conectada, habilitar as flags necessárias e validar convite, login,
   catálogo, configurações, venda com vários itens, pagamento, baixa, repetição,
   conferência e histórico. Não refazer OAuth ou inicialização nessa base.
4. A equipe publica API e frontend com Node 22, origens exclusivas e flags
   desativadas. Configura proteção contra abuso nos dois projetos, inclusive
   `/api/auth/invitations/*` e `/auth/invitations/*`, e o atendimento à privacidade.
5. Na instalação inédita de Felipe, com base separada, configurar os scopes
   antes da primeira autorização (`write_products`, logística e `read_orders`
   para os indicadores). Executar `installation:initialize` administrativamente
   e conectar pelo OAuth. Não depende de uma conta interna anterior.
6. Após migração/permissões e `INVITATIONS_ENABLED=true`, executar:
   `npm.cmd run user:invite --workspace=@portero/api -- --env-file <arquivo-administrativo>`.
   A equipe confirma loja/e-mail e compartilha o link confidencial. Felipe define
   nome e senha e entra. `user:create-initial` permanece como alternativa.
7. Habilitar vendas, pedidos, conferências e preferências após as verificações.
   Configurar remetente/credencial e CRON_SECRET; validar uma entrega e o job antes
   de ativar notificações. As baixas continuam false até autorização e primeira
   operação pequena acompanhada, com saldo restante positivo. Conferir novamente
   o inventário e o histórico; resultados incertos exigem evidência documental.

Se precisar recuar, desativar todas as flags e republicar **esta versão compatível**,
preservando tabelas, vendas, convites, evidências e preferências. Não retornar a
backend anterior à extensão operacional: ele não conhece a ordem de exclusão.
Não apagar dados nem executar SQL inicial. As configurações e os limites de
monitoramento estão em DEPLOY.md; nenhuma publicação foi realizada neste trabalho.

Referências: [Express na Vercel](https://vercel.com/docs/frameworks/backend/express)
e [WAF Rate Limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
