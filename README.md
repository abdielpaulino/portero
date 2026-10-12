# Portero

Sistema web para gestão e venda de luvas de goleiro Portero, integrado à loja
Nuvemshop. O projeto nasceu como Projeto Integrador (curso de Engenharia de
Software, SATC) e cobre o fluxo de acesso, configuração e consulta de
inventário/produtos, com integração de dados de e-commerce.

## Equipe

- Gabriel Dagostim do Nascimento
- Éric Dagostim do Nascimento
- Henrique dos Santos Pereira
- Abdiel Tourazzi Paulino

Professor orientador: Hyan Dias Tavares

## Links

- Jira: https://gabrielnto.atlassian.net/jira/software/projects/KAN/boards/1?filter=&groupBy=none

## Stack

| Camada   | Tecnologias                              |
| -------- | ----------------------------------------- |
| Frontend | `apps/web` — Next.js 16, React 19          |
| Backend  | `apps/api` — Express, Drizzle ORM          |
| Banco    | PostgreSQL (Supabase)                      |
| Integração | Nuvemshop (API de e-commerce)             |

## Estrutura

```
apps/
  web/   frontend Next.js
  api/   backend Express + Drizzle ORM
```

## Setup

```
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Preencher `DATABASE_URL` em `apps/api/.env` com a connection string PostgreSQL
obtida em **Connect** no Supabase. Para a API Express, usar o **Session pooler**
(porta 5432) com SSL (`sslmode=require`). Se o ambiente tiver IPv6, a conexão
direta também é adequada. Manter a senha do banco apenas no `.env` local;
o front-end não deve receber essa URL.

## Rodando

```
npm run dev:api
npm run dev:web
```

## Migrations

`db:generate` cria arquivos SQL no repositório, sem modificar o banco.
`db:migrate` aplica esses arquivos ao banco apontado por `DATABASE_URL`;
confira o destino e revise o SQL antes de executá-lo. A pasta de migrações
ainda não contém uma migração inicial.

```
npm run db:generate
npm run db:migrate
```
