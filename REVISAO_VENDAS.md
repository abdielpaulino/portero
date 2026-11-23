# Revisão da extensão de vendas

A migração permanece preparada para revisão, sem aplicação no Supabase. As
definições originais continuam em `original-schema-confirmed.json`.

## Garantias e evidências

| Regra | Garantia do PostgreSQL | Garantia do backend e testes |
| --- | --- | --- |
| Totais | CHECKs conferem o total da linha e a equação do cabeçalho | `validateSale` calcula itens e totais com BigInt; rejeita totais enviados pelo cliente. `sales-domain.test.ts` e `sales.test.ts` |
| Criação | A transação confirma ou desfaz venda, itens e recebimento inicial | `repository.create` usa uma conexão do BEGIN ao COMMIT; falha de item provoca ROLLBACK. `sales-repository.test.ts` |
| Finanças | Unicidade por venda/UUID e limites dos acumulados; transação, lock de linha e UPDATE condicional usados pelo repositório | Movimento e acumulados são gravados na mesma transação. Hash impede alterar dados de uma chave; advisory lock impede execução concorrente. `sales-repository.test.ts` |
| Loja e autoria | FKs garantem que loja e usuário referenciados existem | Sessão fornece IDs; JOIN usuário/loja e filtros conferem vínculo. FKs simples não garantem que o usuário pertence à loja da venda. `sales-repository.test.ts` |
| Item e baixa | FK garante existência; UNIQUE impede ligar a mesma baixa a dois itens | Execução confere loja, autor, produto, variante e quantidade, inclusive na rota legada e com a tela desativada. `stock-repository.test.ts` |
| Valores inválidos | NOT NULL e CHECKs rejeitam NaN, infinitos, negativos, valores acima do limite e escala maior que dois | API exige texto decimal válido e valida descontos/pagamento antes de consultar produtos. `sales-domain.test.ts` e `sales.test.ts` |
| Receber após estorno | O líquido fica entre zero e o total; acumulados brutos também têm limite monetário | Venda confirmada pode receber até recompor seu total líquido. Cancelada rejeita novos recebimentos e aceita estornos do saldo; repetição de chave aplicada só recupera o resultado. `sales-repository.test.ts` |
| Exclusão | Itens e movimentos têm ON DELETE CASCADE a partir da venda; baixa mantém FK sem cascata | Webhook exclui vendas antes de baixas, usuários, acessos e loja, em uma transação. `webhook-repository.test.ts` |
| Acesso | RLS habilitada e privilégios revogados de PUBLIC, anon e authenticated nos novos objetos | Backend usa conexão SQL própria. A efetividade do papel e das policies depende da configuração do destino |

O banco não recalcula a soma dos itens para o cabeçalho nem os acumulados a partir
dos movimentos. Essas consistências dependem do backend transacional; escrita
SQL direta privilegiada pode violá-las. Também não há garantia de atomicidade
entre PostgreSQL, Nuvemshop e os vários itens da venda.

Os CHECKs monetários usam `numeric` sem typmod para examinar a escala original.
`numeric(18,2)` arredondaria antes do CHECK e permitiria NaN em algumas
comparações. O limite de valor continua 9999999999999999.99. A API serializa
valores com duas casas, inclusive defaults SQL sem escala.

## Papel SQL da API

A migração não conhece o nome do papel do destino e não concede permissões
automaticamente. A equipe precisa conferir, na conexão efetiva do backend:

| Objeto | Privilégios usados por este fluxo |
| --- | --- |
| Banco e schema public | CONNECT e USAGE, respectivamente |
| vendas_externas | SELECT, INSERT, UPDATE; DELETE para o webhook de exclusão |
| itens_venda_externa | SELECT, INSERT, UPDATE; exclusão pelo CASCADE da venda |
| movimentos_financeiros_venda | SELECT, INSERT; exclusão pelo CASCADE da venda |
| Sequências novas | Conferir geração de identidade; USAGE permite nextval quando necessário. Não conceder ao navegador |
| Tabelas originais | Manter permissões operacionais já necessárias, inclusive leitura do vínculo e exclusão pelo webhook |

GRANT não supera RLS. Proprietário sem FORCE RLS, superusuário e BYPASSRLS são
exceções que precisam ser identificadas, sem ampliar privilégios para contornar
falhas. Um papel restrito precisa de policies destinadas exclusivamente a ele,
compatíveis com as operações acima. O isolamento por sessão do PORTERO é aplicado
pelo backend; a conexão SQL compartilhada não recebe automaticamente o JWT como
contexto RLS. Não conceder esse papel a anon/authenticated.

`20261122-external-sales-review.sql` permite selecionar o papel a conferir e
ver privilégios efetivos, propriedade, BYPASSRLS e policies. O papel do SQL Editor
não comprova a autorização da API. O migrador precisa de CREATE no schema e
REFERENCES nas tabelas originais; esses privilégios não são necessários para a
API operar a extensão depois de instalada.

## Validação PostgreSQL local

Não foram encontrados PostgreSQL, Docker ou WSL disponíveis neste ambiente. Os
testes padrão exercitam HTTP, regras e consultas com simulações; não substituem
a aplicação em PostgreSQL.

Foi preparado `apps/api/tests/sales-postgres.test.ts`, desativado sem variável
explícita. Ele exige `PORTERO_LOCAL_PG_URL` apontando para **127.0.0.1 ou ::1**,
sem parâmetros, no banco administrativo local **portero_local_tests**. Não lê
`.env` nem usa `DATABASE_URL`. O papel local precisa criar bancos e papéis.

O teste cria um banco aleatório com prefixo `portero_sales_review_`, reconstrói
a fixture original pelos metadados confirmados e aplica a migração somente
nesse banco. Valida constraints, preservação do schema original, transações,
concorrência, finanças, vínculos, permissões/RLS e exclusão. Ao final remove
somente o banco criado e os papéis de teste que ele próprio criou.

Com um PostgreSQL local preparado pela equipe, executar em PowerShell:

```powershell
$env:PORTERO_LOCAL_PG_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:5432/portero_local_tests'
npm.cmd exec --workspace=@portero/api -- tsx --test tests/sales-postgres.test.ts
Remove-Item Env:PORTERO_LOCAL_PG_URL
```

Não usar endereço, credenciais, túnel ou encaminhamento do Supabase neste teste.
Sem a execução desse teste, a validação real da migração permanece pendente.

Referências: [numeric](https://www.postgresql.org/docs/17/datatype-numeric.html),
[constraints](https://www.postgresql.org/docs/17/ddl-constraints.html) e
[RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
