# Requisitos do PORTERO

Fontes: `Portero-E01.pdf` (11 páginas) e `Portero-Apresentacao.pptx` (11 slides),
incluindo as imagens dos protótipos e as notas dos slides. A numeração inclui
a capa. Os dois arquivos apresentam o mesmo conteúdo principal. O `Pasted
text.txt` contém orientações de trabalho e não substitui essas fontes.

As notas citam `Doc_Proj.pdf`, não fornecido. Os cards completos e seus critérios
de aceitação também não foram disponibilizados. Os valores dos protótipos são
ilustrativos e não definem fórmulas financeiras ou resultados de teste.

| Requisito | Fonte original | Implementação atual | Pendência |
| --- | --- | --- | --- |
| Acesso somente administrativo | PDF p. 4; slide 4 e notas; convite detalhado em orientação posterior | Login interno, JWT, vínculo com loja, convite com hash/expiração/consumo atômico e alternativa por comando | Aplicar extensão operacional e validar ativação; não há cadastro público |
| Consulta de produtos, preços e quantidades | PDF p. 7; slide 7 | Catálogo consultado pela API, com imagens, variantes e SKU | Validação publicada |
| Pesquisa por produto ou SKU e filtros de estoque | PDF p. 7; slide 7 e notas | Todas as páginas são consultadas antes de aplicar busca e filtros, com exibição paginada de 30 variantes; falhas não apresentam catálogo parcial como completo | Medir custo e latência no catálogo real |
| Navegar do inventário aos detalhes e selecionar variante | PDF p. 8; slide 8 e notas | Link por produto e variante, detalhes protegidos e seleção de variante; variante removida não é substituída silenciosamente | Validação publicada |
| Informar quantidade e sincronizar baixa | PDF p. 3 e 8; slides 3 e 8 | Fluxo em duas etapas pelo ID original, também nos detalhes; consulta novamente após confirmação | Operação real acompanhada |
| Evitar duplicação e tratar conflitos/falhas | PDF p. 11; slide 11; conferência detalhada em orientação posterior | Estados persistentes, locks, atualizações condicionais e conferência com autor/evidência/UUID; não envia baixa durante a conferência | Validar concorrência publicada e evidência operacional; conferência documental é humana, não prova automática |
| Rastreabilidade de vendas e movimentações | PDF p. 4; slide 4; decisão posterior de extensão | Histórico comercial, itens vinculados às baixas originais e movimentos financeiros datados | Aplicar/revisar migração e validar no banco de teste; baixas antigas continuam sem dados comerciais inventados |
| Canal de origem das vendas externas | PDF p. 3–4; slides 3–4 | Canal persistido na venda externa, registrada somente no PORTERO | Ativação coordenada da extensão |
| Forma de pagamento | PDF p. 8; slide 8 e protótipo | Forma e situação informadas pelo administrador; recebimentos/estornos registrados sem processamento de pagamento | Ativação e conferência operacional |
| Resumo de vendas e pedidos; vendas do mês | PDF p. 7 e protótipo; slide 7; regras mensais aprovadas posteriormente | Externas por data da venda; recebido por movimento; pedidos online por created_at como valor dos pedidos, sem frete e por moeda | Migração, read_orders e validação real; recebido online permanece indisponível por falta de movimentos suficientes |
| Movimentações recentes e alertas | PDF p. 3 e 7; slides 3 e 7 | Baixas recentes e alertas de saldo indisponível, negativo e não controlado | Gráfico do protótipo não define unidade nem fórmula; confirmar sua regra |
| Sincronização com a Nuvemshop | PDF p. 3, 9 e 11; slides 3, 9 e 11 | Baixas atualizam a Nuvemshop; leituras ao abrir/retornar, após sucesso e em intervalo persistido de 60 a 3600 segundos, somente com tela visível | Validar atualização publicada; consulta periódica não equivale a tempo real ou monitoramento de fundo |
| Conta vinculada e encerramento de sessão | PDF p. 9; slide 9 | Conta/loja consultadas no servidor e logout funcional | Validação publicada |
| Notificações por e-mail e limite de ruptura | PDF p. 9 e protótipo; slide 9; regra de episódios aprovada posteriormente | Preferências por loja, destinatário, limite, monitoramento diário por lotes e deduplicação persistente por episódio de ruptura; negativos alertam e não controlados ficam separados | Migração, remetente/credencial, CRON_SECRET e validação de entrega/agendamento; incertos não têm reenvio automático |
| Estoque negativo | PDF p. 4; slide 4 e notas | Saldo negativo consultado gera alerta explícito; baixa acima do disponível continua recusada | Notas permitem registrar negativo: decidir compatibilidade com o fluxo remoto e as proteções atuais |
| Gestão de produtos na Nuvemshop | PDF p. 4; slide 4 | Cadastro e exclusão permanecem na Nuvemshop | Decisão posterior preservada |
| Cotação de frete | PDF p. 4, 8 e 10; slides 4, 8 e 10 | Não implementada | Retirada expressamente pelo responsável |
| Tecnologias | PDF p. 5; slide 5 | Next.js, React, TypeScript, Node.js, JWT e Supabase; estilos em CSS Modules | Tailwind previsto nos anexos não está adotado; registrar essa divergência |
| Documentação, testes e publicação | PDF p. 6 e 10; slides 6 e 10 | README, DEPLOY e testes simulados locais | Configuração e validação publicada pela equipe |

Foi autorizada uma extensão incremental com três tabelas novas, preservando as
quatro originais. Canal, pagamento e valores históricos usam os novos objetos;
não se reutilizam `lojas.status` ou SKU. A migração ainda não foi aplicada e as
flags comerciais ficam desativadas por padrão. Outra extensão autorizada contém
convites, conferências, preferências e estado dos alertas, também sem aplicação.
Seu código possui testes simulados; configuração externa e validação real continuam
pendentes. Isso não retira requisitos do escopo nem comprova uso publicado.

Vendas externas são registradas somente no PORTERO. Na Nuvemshop, apenas seu
estoque é reduzido. Pedidos online são somente consultados com `read_orders`,
sem gerar baixas. As regras mensais aprovadas e a ativação estão em [VENDAS.md](VENDAS.md).
Baixas não são pedidos pagos; preços atuais não são usados para apurar receita passada.

Estoque, detalhes e busca têm testes simulados. Os testes reais de login,
consulta e baixa na demo foram relatados pelo responsável em uma versão anterior.
Isso não valida automaticamente esta versão, os deploys ou a loja do Felipe.

Referências técnicas: [produtos](https://nuvemshop.dev/en-US/docs-api/resources/2025-03/product),
[pedidos](https://nuvemshop.dev/en-US/docs-api/resources/2025-03/order) e
[permissões](https://nuvemshop.dev/en-US/docs-api/authentication).
