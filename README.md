# Portero

Sistema web para consulta de estoque e registro de baixas por vendas externas de
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
- Criação administrativa de usuários, sem cadastro público.

## Stack

| Camada | Tecnologias |
| --- | --- |
| Frontend | `apps/web` — Next.js 16, React 19 |
| Backend | `apps/api` — Express, TypeScript, Drizzle ORM |
| Banco | PostgreSQL (Supabase) |
| Integração | Nuvemshop (API de e-commerce) |

## Estrutura

```text
apps/
  web/   frontend Next.js
  api/   backend Express + Drizzle ORM
```

## Setup

Requisitos: Node.js 20.9 ou superior e npm com suporte a workspaces.

```sh
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Em `apps/api/.env`, preencher:

- `DATABASE_URL`: conexão PostgreSQL do Supabase via Session pooler, porta 5432,
  com `sslmode=require`. O lock de estoque não é compatível com transaction pooler.
- `JWT_SECRET`: segredo exclusivo do backend, com pelo menos 32 bytes aleatórios.
- `NODE_ENV=development`, `PORT=3001` e `WEB_ORIGIN=http://localhost:3000`.

Em `apps/web/.env`, usar `API_URL=http://localhost:3001`. `API_URL` e `WEB_ORIGIN`
não devem ter barra final. Credenciais permanecem no backend e os arquivos `.env`
não devem ser versionados. No PowerShell, usar `Copy-Item` para as cópias e
`npm.cmd` se a política de execução bloquear `npm.ps1`.

O fluxo utiliza o banco existente, sem novas colunas, índices ou tabelas.
A pasta de migrações ainda não contém uma migração inicial. `db:migrate` altera
o banco de `DATABASE_URL` e não deve ser usado para preparar o banco existente.

## Rodando

Na raiz, executar em terminais separados:

```sh
npm run dev:api
npm run dev:web
```

Frontend em `http://localhost:3000` e API em `http://localhost:3001`.

Com uma única loja conectada no banco, criar a conta interna em um terminal
interativo com `npm run user:create-initial --workspace=@portero/api`.
O script solicita nome, e-mail e senha oculta e não altera contas existentes.

## Limitações

- Cotação de frete não faz parte do escopo. Cadastro e exclusão de produtos
  permanecem na Nuvemshop.
- Logout remove o cookie, mas cópias do JWT permanecem válidas até expirar.
