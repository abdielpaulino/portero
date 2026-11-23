# Portero

Sistema web para consulta de estoque e registro de vendas externas de
luvas de goleiro Portero, integrado à Nuvemshop. O projeto nasceu como Projeto
Integrador do curso de Engenharia de Software da SATC e considera uma única loja
e um único local de estoque.

## Equipe

- Gabriel Dagostim do Nascimento
- Éric Dagostim do Nascimento
- Henrique dos Santos Pereira
- Abdiel Tourazzi Paulino

Professor orientador: Hyan Dias Tavares

## Links

- Jira: https://gabrielnto.atlassian.net/jira/software/projects/KAN/boards/1?filter=&groupBy=none

## Funcionalidades

- Login interno, sessão com JWT em cookie HttpOnly e logout.
- Conta por convite administrativo de uso único, com e-mail autorizado e expiração;
  comando administrativo preservado como alternativa, sem cadastro público.
- OAuth administrativo para a primeira ativação de uma única loja.
- Consulta do catálogo completo, com busca por produto ou SKU, filtros e paginação.
- Detalhes do produto, seleção de variante, preço, imagem e quantidade.
- Baixa por venda externa em duas etapas, usando o ID original de
  `baixas_estoque`, preservando as quatro tabelas originais.
- Histórico com recuperação e conferência administrativa de operações incertas.
- Dashboard com contagens do catálogo, estoque não controlado e baixas recentes.
- Extensão comercial para vendas externas, itens, canal e recebimentos/estornos
  informados pelo administrador, sem processar pagamentos.
- Indicadores mensais separados de vendas externas e pedidos online, com moedas
  separadas e distinção entre valor dos pedidos e dinheiro recebido.
- Gráfico de valor comercial por dia, com séries por origem e moeda e indicação
  da abrangência consultada, sem representar recebimentos.
- Webhooks assinados de suspensão, desinstalação e privacidade da integração.
- Preferências por loja, limite de ruptura e atualização periódica enquanto a tela
  estiver visível. Monitoramento diário e alertas usam configuração própria.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Frontend | `apps/web` — Next.js 16, React 19 |
| Backend | `apps/api` — Express, TypeScript, Drizzle ORM |
| Banco | PostgreSQL (Supabase), preservando a estrutura original |
| Controle da instalação | Estados explícitos e transações no PostgreSQL |
| Integração | Nuvemshop |

## Estrutura

```text
apps/
  web/   frontend Next.js
  api/   backend Express + Drizzle ORM
DEPLOY.md   publicação e instalação acompanhada
```

## Setup

Utilizar Node.js 22 e npm com suporte a workspaces.

```sh
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

As cópias são necessárias apenas na configuração inicial. Preservar os arquivos
existentes. No PowerShell, usar `Copy-Item` e, se necessário, `npm.cmd`.

Para a demo já conectada, configurar `DATABASE_URL` do Supabase via Session
pooler 5432 com SSL, `JWT_SECRET` com pelo menos 32 bytes, `NUVEMSHOP_STORE_ID`
da demo e `NUVEMSHOP_USER_AGENT`. Usar `NODE_ENV=development` e a origem exata
do frontend em `WEB_ORIGIN`, por exemplo `http://localhost:3000` ou
`http://192.168.3.7:3000`. O token continua no banco: não refazer OAuth nem executar
`installation:initialize` nessa base. O nome antigo `NUVEMSHOP_DEMO_STORE_ID`
é aceito somente em desenvolvimento. Não há dependência de Redis.

No frontend, configurar `API_URL=http://localhost:3001`. As URLs não devem conter
caminho ou barra final. Segredos permanecem no backend, fora do versionamento.
`STOCK_DECREASES_ENABLED=false` mantém as baixas bloqueadas até a liberação.

## Banco

O fluxo original utiliza `lojas`, `usuarios_app`, `acessos_permitidos` e
`baixas_estoque`, preservando suas estruturas e dados. A equipe responsável pela
infraestrutura fornece a conexão e as permissões. Demo e loja real usam bases
separadas, sem transferência de usuários, credenciais ou histórico. Os SQLs
abandonados não integram a instalação. A extensão comercial possui uma migração
incremental própria, preparada para revisão e ainda não aplicada. Manter
`EXTERNAL_SALES_ENABLED=false` até a conferência no banco de teste. A consulta de
pedidos é ativada separadamente por `ONLINE_ORDERS_ENABLED`, após conferir
`read_orders`. Modelo e ordem de ativação estão em [VENDAS.md](VENDAS.md).
Convites, conferências e preferências usam `20261122-operational-extension.sql`,
também preparado e não aplicado. Manter suas flags desativadas até a migração e
a revisão de permissões descritas em [DEPLOY.md](DEPLOY.md).

## Rodando

Na raiz, executar em terminais separados:

```sh
npm run dev:api
npm run dev:web
```

Frontend em `http://localhost:3000` e API em `http://localhost:3001`.
O registro comercial está na aba **Vendas** (`/sales`). Exige a migração comercial
e `EXTERNAL_SALES_ENABLED=true` na API, conforme [VENDAS.md](VENDAS.md).
**Dar baixa** continua registrando somente estoque.

Para uma primeira instalação, a equipe prepara explicitamente um registro local,
sem token, e configura o OAuth administrativo conforme [DEPLOY.md](DEPLOY.md).
Nenhum endpoint cria ou recria uma loja. O fluxo expira em cinco minutos e é
consumido no PostgreSQL antes da troca do código. Falhas e interrupções exigem
conferência administrativa, sem reset ou repetição automática.

Com a loja conectada e a extensão operacional habilitada, gerar o convite:
`npm run user:invite --workspace=@portero/api`. O comando solicita e-mail e validade
e entrega um link confidencial para o destinatário definir nome e senha.
`npm run user:create-initial --workspace=@portero/api` permanece como alternativa;
nenhum desses fluxos substitui uma senha existente.
A publicação e o arquivo administrativo separado estão descritos em [DEPLOY.md](DEPLOY.md).
O roteiro da versão inicial de consulta está em [PUBLICACAO.md](PUBLICACAO.md).

## Limitações

- Demo e loja real exigem bancos, origens e segredos separados. Não há reautorização,
  reinstalação ou recuperação automática. Loja ausente ou encerrada bloqueia
  acesso e callbacks. Após exclusão, nenhum dado é retido para guardar um bloqueio;
  ausência não distingue uma instalação nova de uma excluída. Reprovisionar exige
  análise administrativa do histórico, nunca uma nova tentativa automática.
- A interface guarda o ID antes de executar a baixa. Se a resposta da criação se
  perder, recuperar pelo histórico sem criar outra operação ou limpar a pendência.
  Operações incertas, em processamento ou legadas `pendente` exigem conferência.
  A conferência exige referência documental e responsável; não envia outra baixa.
  Conclusão parcial não completa automaticamente a quantidade restante.
- O lock PostgreSQL coordena apenas o PORTERO e exige Session pooler ou conexão
  direta. Saldo zero, resposta divergente ou falha após envio remoto não confirmam
  a baixa e não provocam reenvio automático. O saldo atual sozinho não comprova
  o desconto integral. Operações sem conclusão bloqueiam outra criação da variante.
- Baixas exigem `localStorage` e Web Locks em navegador compatível, em localhost
  ou HTTPS. Busca, filtros e contagens aguardam a consulta de todas as páginas;
  catálogos maiores exigem mais requisições à Nuvemshop.
- Não há limites distribuídos de tentativas de login ou de administração. A
  publicação pública depende de proteção contra tentativas abusivas; validação
  de origem e bcrypt não substituem esses limites. Logout remove o cookie;
  cópias do JWT continuam válidas até expirar. Tokens Nuvemshop ficam no banco,
  acessíveis ao administrador; RLS, permissões e acesso ao projeto exigem revisão.
- A loja real e os deploys dependem da validação após publicação. As URLs dos
  webhooks precisam ser cadastradas pela equipe. O adaptador opcional Resend foi
  mantido; sua substituição por atendimento administrativo ainda exige um processo
  verificável. Sem canal de atendimento, solicitações de dados não são confirmadas.
- Desinstalação e suspensão removem as credenciais de uso. Exclusão da loja por
  webhook de privacidade remove seus dados locais, inclusive contas e histórico.
  Consumidores da Nuvemshop não são importados nem armazenados pelo sistema.
- Sem cotação de frete. Cadastro e exclusão de produtos permanecem na Nuvemshop.
  Vendas externas existem apenas no PORTERO; na Nuvemshop é reduzido somente o
  estoque. Pedidos online são consultados, sem nova baixa ou persistência local.
  Recebido online no mês não é estimado quando faltam movimentos financeiros.
  Totais online indicam páginas e abrangência; registros incompletos não compõem
  um total apresentado como completo. Moedas externas disponíveis: BRL, USD e EUR.
  Cancelamento/estorno financeiro não repõe estoque. Resultados parciais por item
  permanecem visíveis, sem reenvio automático. Baixas antigas não viram vendas pagas.
  Notificações precisam de remetente, credencial e agendamento configurados, além
  de validação real de entrega. Envios incertos não são repetidos automaticamente.
  A atualização da tela não equivale ao monitoramento diário com a tela fechada.
  Catálogos maiores podem exigir vários lotes de monitoramento. As pendências e suas fontes
  estão em [REQUISITOS.md](REQUISITOS.md).
  O build web requer acesso ao Google Fonts.
