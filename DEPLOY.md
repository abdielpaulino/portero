# Publicação e operação acompanhada

Para a publicação inicial com as três flags desativadas, seguir
[PUBLICACAO.md](PUBLICACAO.md): verificações, bloqueios, migração e retorno seguro.

Arquitetura: frontend e API em deploys Vercel separados, PostgreSQL no Supabase
e integração com uma loja Nuvemshop. Redis não é utilizado. A estrutura original
das quatro tabelas é preservada. Este documento não comprova publicação ou teste real.

## Demo local já conectada

Não executar preparação de instalação, novo OAuth ou cadastro de usuário.
Manter a loja, a conta e o token que já existem no Supabase da demo.

1. Conferir localmente as variáveis do exemplo, sem copiar credenciais para o Git:
   `DATABASE_URL`, `JWT_SECRET`, `NUVEMSHOP_STORE_ID`, `NUVEMSHOP_USER_AGENT`
   e `NODE_ENV=development`. O nome antigo `NUVEMSHOP_DEMO_STORE_ID` é aceito
   somente nesse ambiente.
2. Usar a origem exata do frontend em `WEB_ORIGIN`, inclusive a porta.
   Para acesso pelo IP: `http://192.168.3.7:3000`; para localhost:
   `http://localhost:3000`. O Next permite esse IP apenas em desenvolvimento.
3. No frontend, usar `API_URL=http://localhost:3001`. O encaminhamento é feito
   pelo Next; o navegador não precisa acessar a API diretamente.
4. Executar `npm run dev:api` e `npm run dev:web` em terminais separados.
   Reiniciar os processos após mudanças de configuração.
5. `STOCK_DECREASES_ENABLED=false` mantém consultas disponíveis. Somente o
   responsável habilita `true` para uma baixa acompanhada na demo.

As credenciais administrativas OAuth e o adaptador de e-mail não são necessários
para esses fluxos. O token Nuvemshop é lido no banco, não no frontend ou no ambiente.
O estado original `pendente`, com token preenchido, continua aceito como loja
conectada. `ativa` é o estado de uma nova instalação concluída.
Se uma instalação chegou a usar o controle anterior em Redis, seu estado deve
ser conferido administrativamente antes da troca; esta versão não migra esse controle.

## Variáveis por deploy

Usar Node.js 22. Manter dados, origens e segredos exclusivos por instalação.
Não disponibilizar credenciais reais em Preview nem em variáveis `NEXT_PUBLIC_`.

| Projeto | Variável | Finalidade |
| --- | --- | --- |
| API | `NODE_ENV=production` | HTTPS, cookies Secure e validação de origem |
| API | `DATABASE_URL` | Supabase exclusivo, com SSL |
| API | `JWT_SECRET` | Segredo de sessão com pelo menos 32 bytes aleatórios |
| API | `WEB_ORIGIN` | Origem HTTPS exata do frontend, sem caminho ou barra final |
| API | `API_PUBLIC_URL` | Origem HTTPS da API |
| API | `NUVEMSHOP_STORE_ID` | ID confirmado da única loja |
| API | `NUVEMSHOP_USER_AGENT` | Identificação e contato da integração |
| API | `NUVEMSHOP_CLIENT_ID` | ID do aplicativo, obrigatório para webhooks em produção |
| API | `NUVEMSHOP_CLIENT_SECRET` | Segredo que valida a assinatura dos webhooks |
| API | `STOCK_DECREASES_ENABLED=false` | Bloqueio até validação e liberação acompanhada |
| API | `EXTERNAL_SALES_ENABLED=false` | Ativar somente após migração incremental e permissões conferidas no banco de teste |
| API | `ONLINE_ORDERS_ENABLED=false` | Leitura de pedidos online; exige `read_orders` |
| Frontend | `API_URL` | Origem HTTPS da API, necessária no build e na execução |

`PORTERO_INSTALLATION_ID` identifica o OAuth e também o adaptador opcional de
privacidade. `INSTALLATION_ADMIN_TOKEN` é necessário somente para preparar e
autorizar a primeira instalação; exige pelo menos 32 bytes. Sem a configuração
administrativa completa, a API mantém os
fluxos operacionais e não oferece o roteador de instalação.
Produção não aceita `NUVEMSHOP_DEMO_STORE_ID`. `PORT` é apenas local.

A conexão PostgreSQL usa Session pooler 5432 ou conexão direta. A porta 6543 é
recusada porque o lock da baixa ocupa a mesma sessão até a liberação. Conferir
permissões do papel da API, RLS e capacidade do pool. Cada instância pode manter
uma conexão operacional, outra de controle comercial e outra de webhooks.
As quatro tabelas originais não são alteradas. A extensão comercial optativa e
sua ativação coordenada estão em [VENDAS.md](VENDAS.md); não aplicar SQLs abandonados.

## Vercel

1. Backend: Root Directory `apps/api`, preset Other, Node.js 22, acesso ao
   monorepo, instalação `npm ci --include=dev` e build `npm run build`.
   O `vercel.json` exporta o Express compilado por `api/index.js`, sem abrir
   porta; manter a função com 60 s.
2. Frontend: Root Directory `apps/web`, preset Next.js, Node.js 22, lockfile da
   raiz e build `npm run build`. Não definir Output Directory manualmente.
   O build requer acesso ao Google Fonts.
3. Configurar as variáveis Production e as URLs estáveis. Alterações em
   `API_URL` exigem novo build web. A flag de baixas exige novo deploy da API.
4. Liberar acesso ao callback e aos webhooks na proteção do deploy/WAF.
   `/health` confirma somente que o processo responde.

Cookies usam HttpOnly, Secure em produção e SameSite=Lax, sem Domain. O Next
encaminha as rotas explícitas da API. O login envia POST JSON; sem hidratação o
botão fica bloqueado, e o formulário nativo também declara POST. Não flexibilizar
a origem da API nem trocar o export Express por parsing que altere o corpo assinado.

## Primeira instalação, somente por administração

Esta etapa não se aplica à demo já conectada. A equipe confirma a loja, a base
exclusiva e o histórico antes de qualquer preparação. Banco vazio também pode
significar exclusão anterior: não é prova de instalação inédita.

1. Configurar no aplicativo o site e o callback exato
   `https://<backend>/auth/nuvemshop/callback`, com escrita de produtos
   (`write_products`) e View Logistics para estoque por local.
2. Quando expressamente autorizado, executar em terminal confiável
   `npm run installation:initialize --workspace=@portero/api -- --env-file <arquivo-administrativo>`.
   O comando pede confirmação, verifica as quatro tabelas vazias e cria somente
   um registro de `lojas`, sem token, nome remoto ou DDL. Não modifica uma loja
   existente e não é um comando de recuperação.
3. Abrir `https://<backend>/auth/nuvemshop/install` e informar o segredo
   administrativo. Felipe autoriza na Nuvemshop. Concluir no mesmo navegador,
   em cinco minutos, sem compartilhar o segredo ou colocá-lo na URL.
4. Com a loja conectada, a equipe executa
   `npm run user:create-initial --workspace=@portero/api -- --env-file <arquivo-administrativo>`.
   O comando confirma a loja e solicita nome, e-mail e senha oculta.

O controle usa apenas estados escalares de `lojas.status`:
`instalacao_inicializada → oauth_pendente → oauth_em_troca → ativa`.
As transições usam transação, lock PostgreSQL e UPDATE condicional. O cookie
assinado vincula state ao ID, data de criação, aplicativo e instalação.
Só um início pode emitir autorização; o consumo é confirmado no banco antes
da chamada externa. Não se armazenam contadores, JSON de segurança ou token
em campos destinados a outras funções.

Falha, cancelamento, expiração ou resposta perdida não reabrem o estado. Não há
reautorização, reinstalação ou recuperação automática. A Nuvemshop não fornece
no evento de exclusão um identificador de ciclo que permita essa retomada segura.
A chamada externa e o PostgreSQL não formam uma transação única.

## Webhooks e privacidade

Conferir categoria e visibilidade do aplicativo no Portal. A obrigatoriedade dos
três eventos de privacidade é explícita para aplicativos públicos. O código
implementa as URLs abaixo; cadastro e homologação cabem à equipe.

| Evento | Caminho na API | Tratamento |
| --- | --- | --- |
| `app/uninstalled` | `/webhooks/nuvemshop/uninstalled` | Remove token/scope e marca `desinstalada` |
| `app/suspended` | `/webhooks/nuvemshop/suspended` | Suspende o uso e remove credenciais |
| `app/store_redact` | `/webhooks/nuvemshop/store-redact` | Exclui baixas, usuários, acessos e loja em transação |
| `customer/redact` | `/webhooks/nuvemshop/customer-redact` | Valida a solicitação; não há consumidores/pedidos importados |
| `customers/data_request` | `/webhooks/nuvemshop/customer-data-request` | Exige entrega do relatório diretamente ao lojista |

Os eventos operacionais são inscritos pela API da loja; os de privacidade,
no Portal. Validar HMAC SHA256 hexadecimal em `x-linkedstore-hmac-sha256`,
calculado com o segredo do aplicativo e o corpo original. Não exigem cookie ou
Origin do navegador. Reentregas e falhas não devem provocar confirmação falsa.

Webhooks e OAuth usam o mesmo lock da instalação, incompatível com uma baixa em
curso. Lock ocupado ou falha de gravação retorna erro para nova entrega, sem
confirmar fechamento antes do COMMIT. O processamento de webhooks tem orçamento
de 1,5 s, aquisição de conexão de 500 ms e consultas limitadas; medir cold start
e o prazo de resposta de 3 s no ambiente publicado.

Depois da exclusão, não permanece registro de bloqueio nem dado da loja.
A ausência bloqueia acesso e callbacks: nenhum endpoint faz INSERT de loja.
Apenas preparação administrativa explícita pode criar um registro; não usá-la
para reinstalar após excluir. Ausência não distingue exclusão de instalação
nunca iniciada. Restaurações e reprovisionamento indevidos ficam fora da garantia
do fluxo automático e exigem conferência administrativa.

O adaptador Resend já existente foi mantido como opção, não como requisito da
demo ou novo serviço desta alteração. Ele usa `RESEND_API_KEY`,
`PRIVACY_FROM_EMAIL` e `PRIVACY_MERCHANT_EMAIL`; sem canal configurado,
`customers/data_request` retorna 503 e permanece pendente.

Para retirá-lo, o ponto de substituição é `reporter` em `server.ts`. A documentação
Nuvemshop exige entrega direta ao comerciante e não especifica Resend. Um
procedimento administrativo precisaria registrar recebimento, responsável,
verificação, entrega do relatório e evidência de conclusão. Essa alternativa
ainda não está implementada ou validada: não basta registrar em log ou responder
204. Não desativar o atendimento nem liberar publicação sem definir o processo.
Conferir também a retenção de logs e backups fora da aplicação.

## Pendências para publicação pública

Para a extensão comercial, revisar a migração incremental, aplicá-la somente no
banco de teste autorizado, conferir RLS/permissões e ativar as flags conforme
[VENDAS.md](VENDAS.md). Nenhum SQL é executado no startup. A versão com flags
desativadas preserva o fluxo anterior. Conferir `read_orders` antes de habilitar
a consulta online; este trabalho não alterou a autorização de nenhuma loja.

- Foram removidos os limites compartilhados de dez logins por e-mail, cem por
  instalação e dez tentativas administrativas em quinze minutos. Não há
  substituto distribuído. Bcrypt, cookies e validação de origem permanecem,
  mas não oferecem proteção equivalente contra tentativas abusivas.
- Definir e validar a proteção contra abuso na infraestrutura disponível antes
  de expor login e administração. Não adicionar contadores em memória local.
- Definir o canal de atendimento à privacidade e validar entrega, assinaturas,
  cadastro dos webhooks e requisitos do aplicativo.
- Validar HTTPS, cookies, sessão SSR, origem, OAuth, capacidade do pool, locks
  entre instâncias e latência após publicar. A demo local não comprova esses itens.

Antes de liberar baixas, conferir consultas e histórico e validar na demo
reenvio do mesmo ID, concorrência, perda de resposta e resultado incerto.
Somente com autorização dos responsáveis, habilitar a flag e conferir uma
venda externa real pequena que deixe saldo positivo. A interface guarda o ID
antes de executar; perda da criação exige recuperação pelo histórico.
Saldo zero ou divergência exigem conferência. Não reenviar nem compensar
automaticamente uma execução incerta.

## Referências

- [Webhooks e privacidade](https://nuvemshop.dev/api/resources/2025-03/webhook)
- [Autenticação](https://nuvemshop.dev/api/authentication)
- [Instalação](https://nuvemshop.dev/api/guides/installation)
- [Locks PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html)
- [Express na Vercel](https://vercel.com/docs/frameworks/backend/express)

## Extensão operacional e ativação

Além da migração comercial, revisar `apps/api/sql/20261122-operational-extension.sql`.
Ela cria apenas `convites_conta`, `conferencias_baixa`, `configuracoes_loja` e
`alertas_estoque`, com RLS. Não altera as quatro tabelas originais. Os arquivos
não foram executados. Não usar SQL inicial, geração automática ou scripts abandonados.

Aplicar somente após validar as migrações em PostgreSQL de teste e publicar
um backend compatível com os novos objetos e sua exclusão. Conferir o papel
SQL da API em `20261122-operational-review.sql`; não conceder acesso ao navegador.

O webhook apaga convites, conferências e preferências/alertas antes dos registros
originais, mesmo com flags desativadas. Após esses dados existirem, retornar apenas
a esta versão ou outra compatível com sua exclusão; desativar flags sem apagar
tabelas. Os commits anteriores à extensão operacional não conhecem suas FKs.
