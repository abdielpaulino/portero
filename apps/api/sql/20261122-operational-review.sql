-- Somente metadados; sem contas, convites, destinatários, evidências ou credenciais.
SELECT current_database() AS banco,current_user AS papel_sql;
SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity,identity_generation
FROM information_schema.columns WHERE table_schema='public'
AND table_name IN ('convites_conta','conferencias_baixa','configuracoes_loja','alertas_estoque') ORDER BY table_name,ordinal_position;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS proprietario,
       k.conname,pg_get_constraintdef(k.oid) AS definicao
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_constraint k ON k.conrelid=c.oid
WHERE n.nspname='public' AND c.relname IN ('convites_conta','conferencias_baixa','configuracoes_loja','alertas_estoque') ORDER BY c.relname,k.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
AND tablename IN ('convites_conta','conferencias_baixa','configuracoes_loja','alertas_estoque') ORDER BY tablename,indexname;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public'
AND tablename IN ('convites_conta','conferencias_baixa','configuracoes_loja','alertas_estoque');
-- Trocar current_user::text pelo nome confirmado do papel SQL da API, entre aspas simples.
WITH alvo(papel) AS (VALUES(current_user::text))
SELECT a.papel,r.oid IS NOT NULL AS papel_existe,r.rolsuper,r.rolbypassrls,c.relname,
       has_schema_privilege(r.oid,'public','USAGE') AS schema_usage,
       has_table_privilege(r.oid,c.oid,'SELECT') AS leitura,has_table_privilege(r.oid,c.oid,'INSERT') AS insercao,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS atualizacao,has_table_privilege(r.oid,c.oid,'DELETE') AS exclusao,
       pg_has_role(r.oid,c.relowner,'USAGE') AS herda_proprietario,c.relrowsecurity,c.relforcerowsecurity
FROM alvo a LEFT JOIN pg_roles r ON r.rolname=a.papel CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('convites_conta','conferencias_baixa','configuracoes_loja','alertas_estoque') ORDER BY c.relname;
SELECT r.rolname,c.relname,has_table_privilege(r.oid,c.oid,'SELECT') AS leitura,
       has_table_privilege(r.oid,c.oid,'INSERT') AS insercao,has_table_privilege(r.oid,c.oid,'UPDATE') AS atualizacao,
       has_table_privilege(r.oid,c.oid,'DELETE') AS exclusao
FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN ('anon','authenticated') AND n.nspname='public'
AND c.relname IN ('convites_conta','conferencias_baixa','configuracoes_loja','alertas_estoque');
SELECT c.relname,has_sequence_privilege(current_user,c.oid,'USAGE') AS uso_papel_atual
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'
AND c.relname IN ('convites_conta_id_seq','conferencias_baixa_id_seq');
