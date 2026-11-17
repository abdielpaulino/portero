-- Consulta por ID original. O modelo abaixo permanece somente para revisão manual.
-- Conferência administrativa; não executa nova baixa nem altera a Nuvemshop.
-- Substituir loja_id e id pelos dados do histórico.
SELECT b.id, b.loja_id, b.produto_id, b.variant_id, b.sku,
       b.quantidade_baixada,
       b.status_sincronizacao, b.criado_em, u.nome AS usuario
FROM public.baixas_estoque b
JOIN public.usuarios_app u ON u.id = b.usuario_id
WHERE b.loja_id = 0 AND b.id = 0;

-- Antes de resolver: parar a API e conferir a venda, o registro e evidências
-- da operação na Nuvemshop. O saldo atual, sozinho, não comprova o resultado.
-- Guardar evidências, responsável e decisão no registro administrativo.
-- Sem prova suficiente, manter o status e o bloqueio da variante.
--
-- Modelo para revisão, intencionalmente comentado e com ROLLBACK.
-- Usar 'sincronizada' apenas se o desconto integral estiver comprovado;
-- usar 'rejeitada' apenas se estiver comprovado que nenhum desconto ocorreu.
-- Aplicação parcial exige tratamento específico; não usar este modelo.
-- Nunca voltar a 'registrada': isso permitiria reenviar a atualização.
-- Pendentes legadas exigem análise específica, sem execução pelo novo fluxo.
--
-- BEGIN;
-- SELECT pg_advisory_xact_lock(0::int, hashtext('PREENCHER-VARIANTE'));
-- SELECT * FROM public.baixas_estoque
-- WHERE id = 0 AND loja_id = 0 FOR UPDATE;
-- UPDATE public.baixas_estoque
-- SET status_sincronizacao = 'PREENCHER-RESULTADO-COMPROVADO'
-- WHERE id = 0 AND loja_id = 0 AND variant_id = 'PREENCHER-VARIANTE'
--   AND status_sincronizacao IN ('incerta', 'em_processamento');
-- Conferir que exatamente um registro mudou e revisar o resultado antes
-- de trocar ROLLBACK por COMMIT em uma cópia específica para a ocorrência.
-- ROLLBACK;
