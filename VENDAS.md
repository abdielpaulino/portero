# Vendas externas e pedidos online

Extensão autorizada após a análise dos documentos iniciais. O SQL foi preparado
para revisão e não foi aplicado. As quatro tabelas originais e seus dados são
preservados. Não executar SQLs abandonados ou gerar uma migração inicial completa.

## Modelo

| Tabela nova | Conteúdo |
| --- | --- |
| `vendas_externas` | Loja, autor, UUID único por loja, hash dos dados, canal, forma de pagamento, moeda, datas, situação, subtotal, descontos, total, recebimentos e estornos acumulados |
| `itens_venda_externa` | Produto/variante, nome e SKU preservados, quantidade, preço efetivo informado, desconto, total e vínculo único opcional com `baixas_estoque.id` |
| `movimentos_financeiros_venda` | Recebimento/estorno informado, valor positivo, forma de pagamento, data de ocorrência, autor, data de registro e UUID único na venda |

Valores usam `numeric` com CHECKs de finitude, limite de 16 dígitos inteiros e
até duas casas, sem arredondamento silencioso, e textos decimais/BigInt no código.
Esta versão registra vendas externas em BRL, USD ou EUR, com duas casas.
O desconto do item incide sobre sua linha; o desconto adicional incide sobre a
soma das linhas. O backend calcula os totais. Não há frete, encargos adicionais,
processamento de pagamento ou promessa de isenção de taxas.

Preços são preservados no registro, sem usar preços atuais para recalcular o
histórico. Baixas antigas não recebem canal, pagamento ou valores inventados.
Pedidos online não são persistidos; loja e ID do pedido formam sua identidade
para eliminar repetições nas páginas consultadas. Não se cadastram consumidores.

## Fluxo e garantias

1. O navegador salva UUID e corpo antes de registrar a venda.
2. O servidor confere sessão, vínculo e variantes. Venda, itens e recebimento
   inicial ficam na mesma transação local. Nenhum estoque é alterado nessa etapa.
3. Na sincronização de cada item, baixa original e vínculo são confirmados em
   transação antes do envio remoto. O fluxo existente executa pelo mesmo ID.
4. Resultados são apresentados por item. Incertas, em processamento e rejeitadas
   não recebem outro ID nem são reenviadas automaticamente. Saldo zero exige
   conferência. Outra pendência da variante impede preparar nova baixa, sem apagar
   a venda ou alterar sua situação financeira.

Não há atomicidade entre itens, PostgreSQL e Nuvemshop. Resposta perdida exige
consultar a mesma venda/chave, sem gerar outra chave. A proteção identifica a
requisição, não duas vendas comerciais iguais registradas com chaves diferentes.
O histórico é da loja; alterações e baixas exigem o autor da venda, preservando
a restrição de autoria do fluxo original.

Recebimentos/estornos são apenas registros administrativos. Cancelamento mantém
os movimentos e não repõe estoque. Uma chamada remota já enviada não é desfeita
pelo cancelamento. Devolução/reposição exige regra e fluxo separados, ainda não
implementados. Não usar estorno financeiro para movimentar estoque.
Após estorno, uma venda confirmada pode receber novamente, desde que o líquido
acumulado não ultrapasse o total. Os acumulados brutos preservam todos os eventos.
Venda cancelada aceita estorno até o saldo recebido líquido, mas não recebe novos
pagamentos. Recuperar uma chave já aplicada apenas devolve seu registro.
Uma baixa local `registrada`, ainda não enviada, pode ser cancelada explicitamente
no histórico de baixas. Cancelar financeiramente a venda não assume essa decisão.

## Indicadores mensais aprovados

- Fuso `America/Sao_Paulo`, do início do mês até o início exclusivo do seguinte,
  convertido pelo PostgreSQL.
- Externas: valor vendido de vendas confirmadas, pela data informada da venda;
  canceladas ficam fora. Sincronizar estoque não cria faturamento.
- Recebido externo: recebimentos menos estornos, pela ocorrência de cada movimento,
  incluindo parciais e movimentos de vendas canceladas ou de outros meses.
  O recebido líquido pode ser negativo no mês e é informado pelo administrador.
- Online: canal `store`, pela data `created_at`, excluindo cancelados. O rótulo é
  **valor dos pedidos**, incluindo pendentes. Sem frete: `subtotal - discount`
  do próprio pedido, nunca preço atual. Não equivale a recebido.
- Moedas e origens ficam separadas. A interface informa mês, páginas e registros
  incompletos. Falhas não transformam totais parciais em completos. A API limita
  a busca a 10.000 pedidos; consultas maiores precisam de recortes adicionais.
- Recebido online fica indisponível: os dados consultados não comprovam movimentos
  e estornos datados suficientes. Não estimar pelo status `paid` ou total do pedido.

O gráfico diário segue essas mesmas datas e regras, com séries separadas de
externas confirmadas e valor dos pedidos online não cancelados. Cada moeda tem
seu próprio gráfico; não há soma entre moedas ou com recebimentos. A série externa
abrange todos os registros locais do mês. A online abrange apenas as páginas
consultadas, identificando paginação pendente e pedidos com dados incompletos.
Ausência de dados de uma origem não é apresentada como valor zero.

## Aplicação e ativação no banco de teste

1. Revisar [20261122-external-sales.sql](apps/api/sql/20261122-external-sales.sql)
   e as novas declarações Drizzle em `apps/api/src/db/schema.ts`.
2. Manter `EXTERNAL_SALES_ENABLED=false` e `ONLINE_ORDERS_ENABLED=false`.
   O fluxo original continua disponível sem a extensão.
3. A equipe confere o destino de teste e aplica somente o SQL incremental, quando
   autorizado. O arquivo usa uma transação, cria três tabelas e falha se já
   existirem. Não sobrescreve objetos e não é executado no startup.
4. Executar [20261122-external-sales-review.sql](apps/api/sql/20261122-external-sales-review.sql),
   somente de leitura. Conferir FKs, índices, unicidade, precisões, RLS e sequências.
5. Conferir papel SQL da API, privilégios e políticas RLS conforme a
   [revisão da migração](REVISAO_VENDAS.md). O SQL revoga acesso
   público, `anon` e `authenticated` aos novos objetos; não concede acesso à API
   nem desabilita RLS. A equipe define as permissões exclusivas do backend.
   O papel do SQL Editor pode ser diferente do papel usado pela API.
6. Com a migração e permissões conferidas, ativar `EXTERNAL_SALES_ENABLED=true`.
   Manter `STOCK_DECREASES_ENABLED=false` na conferência financeira inicial.
7. Conferir `read_orders` e ativar `ONLINE_ORDERS_ENABLED=true` separadamente.
   Essa consulta não depende das três tabelas novas.
8. Só após validação, liberar baixas autorizadas na demo. Conferir vários itens,
   reenvios, perda de resposta, parcialidade e saldo zero antes da loja real.

Recuo seguro: desativar as flags mantendo este backend, sem apagar dados. A
proteção de baixas vinculadas continua ativa com a tela comercial desativada.
Não voltar a um backend anterior à extensão com vendas vinculadas, pois ele
não conhece o bloqueio de vendas canceladas.

Por instância, há até uma conexão operacional, uma de controle comercial e uma
de webhooks. Conferir capacidade do Supabase e manter Session pooler 5432 ou
conexão direta. O lock de venda usa uma sessão separada, sem transação aberta
durante a chamada remota. Finanças usam transação, lock de linha e UPDATE condicional.

## Permissões e privacidade

Novo scope: `read_orders`. Não são necessários `write_orders`, `read_payments`
ou `write_payments`. Conferir scopes antes da primeira autorização. Instalação
já conectada sem a permissão exige análise administrativa com a Nuvemshop;
o código não reautoriza ou reinstala automaticamente.

Pedidos usam apenas `GET /orders`, com paginação e campos comerciais mínimos,
sem contatos ou endereços. Não se criam pedidos, cobranças ou pagamentos na
Nuvemshop. Na venda externa, a única escrita remota é a redução do estoque.

O webhook de exclusão identifica a extensão mesmo com flags desativadas e remove
vendas, itens e movimentos antes das tabelas originais. Logs/backups externos e
o canal efetivo de atendimento à privacidade continuam a cargo da equipe.

Fontes: documentos originais p./slides 3, 4, 7, 8 e 11, autorização posterior de
extensão e regras mensais aprovadas pelo responsável.
[Pedidos](https://nuvemshop.dev/en-US/docs-api/resources/2025-03/order) e
[permissões](https://nuvemshop.dev/en-US/docs-api/authentication).
