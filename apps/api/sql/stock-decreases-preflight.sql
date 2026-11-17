-- Diagnóstico somente de leitura. Executar inteiro no SQL Editor do Supabase.
-- Retorna metadados; não consulta tokens, senhas ou registros de vendas.
-- Não cria estruturas, não adquire locks e não executa os demais SQLs.
WITH
tabelas(nome) AS (
  VALUES ('baixas_estoque'), ('lojas'), ('usuarios_app')
),
relacoes AS (
  SELECT t.nome, c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         pg_get_userbyid(c.relowner) AS proprietario
  FROM tabelas t
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.nome
),
esperadas(tabela, coluna, tipo, obrigatoria) AS (
  VALUES
    ('baixas_estoque', 'id', 'integer', true),
    ('baixas_estoque', 'loja_id', 'integer', true),
    ('baixas_estoque', 'usuario_id', 'integer', true),
    ('baixas_estoque', 'produto_id', 'text', true),
    ('baixas_estoque', 'variant_id', 'text', true),
    ('baixas_estoque', 'sku', 'text', false),
    ('baixas_estoque', 'quantidade_baixada', 'integer', true),
    ('baixas_estoque', 'status_sincronizacao', 'text', true),
    ('baixas_estoque', 'criado_em', 'timestamp with time zone', true),
    ('lojas', 'id', 'integer', true),
    ('lojas', 'nuvemshop_store_id', 'text', true),
    ('lojas', 'access_token', 'text', true),
    ('lojas', 'nome_loja', 'text', true),
    ('usuarios_app', 'id', 'integer', true),
    ('usuarios_app', 'loja_id', 'integer', true),
    ('usuarios_app', 'nome', 'text', true),
    ('usuarios_app', 'email', 'text', true)
),
colunas AS (
  SELECT r.nome AS tabela, a.attname AS coluna,
         format_type(a.atttypid, a.atttypmod) AS tipo,
         a.attnotnull AS obrigatoria, a.attidentity AS identidade,
         a.attgenerated AS gerada,
         CASE WHEN r.nome = 'lojas' AND a.attname = 'access_token'
           THEN CASE WHEN d.oid IS NOT NULL THEN '[omitido: coluna de credencial]' END
           ELSE pg_get_expr(d.adbin, d.adrelid)
         END AS valor_padrao
  FROM relacoes r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
),
indices AS (
  SELECT r.nome AS tabela, ic.relname AS nome, i.*,
         pg_get_indexdef(i.indexrelid) AS definicao
  FROM relacoes r
  JOIN pg_index i ON i.indrelid = r.oid
  JOIN pg_class ic ON ic.oid = i.indexrelid
),
saida AS (
  SELECT '01_contexto' AS secao, 'sessao_sql_editor' AS item,
         jsonb_build_object(
           'usuario', current_user,
           'search_path', current_setting('search_path'),
           'schemas_efetivos', current_schemas(false),
           'observacao', 'Este contexto e do SQL Editor, nao necessariamente da API.'
         ) AS detalhes
  UNION ALL
  SELECT '02_tabelas', 'public.' || r.nome,
         jsonb_build_object('existe', r.oid IS NOT NULL, 'tipo_relacao', r.relkind,
           'proprietario', r.proprietario, 'rls', r.relrowsecurity,
           'rls_forcada', r.relforcerowsecurity)
  FROM relacoes r
  UNION ALL
  SELECT '03_colunas_exigidas', e.tabela || '.' || e.coluna,
         jsonb_build_object(
           'situacao', CASE WHEN c.coluna IS NULL THEN 'AUSENTE'
             WHEN c.tipo <> e.tipo OR c.obrigatoria <> e.obrigatoria THEN 'DIFERE_DO_DRIZZLE'
             ELSE 'TIPO_E_NULABILIDADE_OK' END,
           'tipo_esperado', e.tipo, 'tipo_atual', c.tipo,
           'not_null_esperado', e.obrigatoria, 'not_null_atual', c.obrigatoria,
           'identidade', c.identidade, 'gerada', c.gerada, 'default_atual', c.valor_padrao)
  FROM esperadas e LEFT JOIN colunas c ON c.tabela = e.tabela AND c.coluna = e.coluna
  UNION ALL
  -- Colunas extras obrigatórias sem default podem impedir o INSERT da baixa.
  SELECT '04_colunas_extras_da_baixa', c.coluna,
         jsonb_build_object('tipo', c.tipo, 'not_null', c.obrigatoria,
           'identidade', c.identidade, 'gerada', c.gerada, 'default', c.valor_padrao)
  FROM colunas c WHERE c.tabela = 'baixas_estoque'
    AND NOT EXISTS (SELECT 1 FROM esperadas e WHERE e.tabela = c.tabela AND e.coluna = c.coluna)
  UNION ALL
  SELECT '05_indices', tabela || '.' || nome,
         jsonb_build_object('definicao', definicao, 'unico', indisunique,
           'primario', indisprimary, 'valido', indisvalid, 'pronto', indisready,
           'imediato', indimmediate)
  FROM indices
  UNION ALL
  SELECT '06_idempotencia', 'PRIMARY KEY (id)',
         jsonb_build_object('chave_primaria_persistente_por_id', EXISTS (
           SELECT 1 FROM indices i
           WHERE i.tabela = 'baixas_estoque' AND i.indisprimary AND i.indisunique AND i.indisvalid
             AND i.indisready AND i.indimmediate
             AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 1
             AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                  FROM unnest(i.indkey) WITH ORDINALITY k(attnum, pos)
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                  WHERE k.pos <= i.indnkeyatts) = ARRAY['id']::text[]
         ), 'observacao', 'A operacao e identificada pelo ID original; nao exige indice adicional.')
  UNION ALL
  SELECT '07_constraints', r.nome || '.' || co.conname,
         jsonb_build_object('tipo', co.contype, 'definicao', pg_get_constraintdef(co.oid),
           'validada', co.convalidated, 'adiavel', co.condeferrable,
           'inicialmente_adiada', co.condeferred)
  FROM relacoes r JOIN pg_constraint co ON co.conrelid = r.oid
  UNION ALL
  SELECT '08_triggers', r.nome || '.' || tr.tgname,
         jsonb_build_object('definicao', pg_get_triggerdef(tr.oid), 'habilitado', tr.tgenabled)
  FROM relacoes r JOIN pg_trigger tr ON tr.tgrelid = r.oid AND NOT tr.tgisinternal
  UNION ALL
  SELECT '09_politicas_rls', p.tablename || '.' || p.policyname,
         jsonb_build_object('papeis', p.roles, 'comando', p.cmd,
           'permissiva', p.permissive, 'using', p.qual, 'with_check', p.with_check)
  FROM pg_policies p WHERE p.schemaname = 'public'
    AND p.tablename IN (SELECT nome FROM tabelas)
  UNION ALL
  SELECT '10_permissoes_tabelas', g.table_name || '.' || g.grantee || '.' || g.privilege_type,
         jsonb_build_object('concedente', g.grantor, 'pode_conceder', g.is_grantable)
  FROM information_schema.table_privileges g
  WHERE g.table_schema = 'public' AND g.table_name IN (SELECT nome FROM tabelas)
  UNION ALL
  SELECT '11_sequencias', r.nome || '.id',
         jsonb_build_object('sequencia', pg_get_serial_sequence('public.' || quote_ident(r.nome), 'id'))
  FROM relacoes r JOIN colunas c ON c.tabela = r.nome AND c.coluna = 'id'
  WHERE r.relkind IN ('r', 'p')
)
SELECT secao, item, detalhes FROM saida ORDER BY secao, item;
