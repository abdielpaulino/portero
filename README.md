**Projeto Integrador Web: Portero**

**Links:**

Jira: https://gabrielnto.atlassian.net/jira/software/projects/KAN/boards/1?filter=&groupBy=none
Canva: https://www.canva.com/design/DAHSB1yD8nQ/CFngNsa0-zM65xqJkqvk-Q/edit

Comandos importantes para o desenvolvimento

**Estrutura**

- `apps/web`: frontend Next.js
- `apps/api`: backend Express + Drizzle ORM

**Setup**

```
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Preencher `DATABASE_URL` em `apps/api/.env` com a connection string do Neon.

**Rodando**

```
npm run dev:api
npm run dev:web
```

**Migrations**

```
npm run db:generate
npm run db:migrate
```
