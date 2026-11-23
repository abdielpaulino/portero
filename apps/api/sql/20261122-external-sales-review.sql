-- Somente metadados, sem registros ou credenciais.
SELECT current_database() AS banco, current_user AS papel_sql;

SELECT table_name,column_name,data_type,is_nullable,column_default,
       numeric_precision,numeric_scale,is_identity,identity_generation
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda')
ORDER BY table_name,ordinal_position;

SELECT c.relname AS tabela,c.relrowsecurity AS rls,c.relforcerowsecurity AS rls_forcada,
       con.conname AS constraint_nome,pg_get_constraintdef(con.oid) AS definicao
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_constraint con ON con.conrelid=c.oid
WHERE n.nspname='public' AND c.relname IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda')
ORDER BY c.relname,con.conname;

SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda')
ORDER BY tablename,indexname;

SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges
WHERE table_schema='public' AND table_name IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda')
ORDER BY table_name,grantee,privilege_type;

SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda');

SELECT c.relname AS sequencia,pg_get_userbyid(c.relowner) AS proprietario,
       has_sequence_privilege(current_user,c.oid,'USAGE') AS uso_papel_atual,
       has_sequence_privilege(current_user,c.oid,'SELECT') AS leitura_papel_atual
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='S'
AND c.relname IN ('vendas_externas_id_seq','itens_venda_externa_id_seq','movimentos_financeiros_venda_id_seq');

-- Substituir current_user::text pelo nome confirmado do papel da API, entre aspas simples.
-- Sem essa troca, o resultado descreve somente a conexão atual do SQL Editor.
WITH alvo(papel) AS (VALUES (current_user::text)), objetos AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda')
)
SELECT a.papel AS papel_informado,r.oid IS NOT NULL AS papel_existe,r.rolcanlogin,r.rolsuper,r.rolbypassrls,
       has_database_privilege(r.oid,current_database(),'CONNECT') AS conecta_banco,
       has_schema_privilege(r.oid,'public','USAGE') AS usa_schema,
       c.relname AS tabela,pg_get_userbyid(c.relowner) AS proprietario,c.relrowsecurity AS rls,c.relforcerowsecurity AS rls_forcada,
       pg_has_role(r.oid,c.relowner,'USAGE') AS herda_papel_proprietario,
       has_table_privilege(r.oid,c.oid,'SELECT') AS pode_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS pode_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS pode_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS pode_delete,
       CASE WHEN c.oid IS NOT NULL THEN pg_get_serial_sequence(format('public.%I',c.relname),'id') END AS sequencia_id,
       CASE WHEN c.oid IS NOT NULL THEN has_sequence_privilege(r.oid,pg_get_serial_sequence(format('public.%I',c.relname),'id'),'USAGE') END AS usa_sequencia
FROM alvo a LEFT JOIN pg_roles r ON r.rolname=a.papel LEFT JOIN objetos c ON true ORDER BY c.relname;

-- Privilégios efetivos das conexões do navegador, incluindo concessões herdadas.
SELECT r.rolname,c.relname,c.relrowsecurity AS rls,r.rolsuper,r.rolbypassrls,
       has_table_privilege(r.oid,c.oid,'SELECT') AS pode_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS pode_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS pode_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS pode_delete
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN ('anon','authenticated') AND n.nspname='public'
AND c.relname IN ('vendas_externas','itens_venda_externa','movimentos_financeiros_venda')
ORDER BY r.rolname,c.relname;
