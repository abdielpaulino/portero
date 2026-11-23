-- Inventário somente de metadados para revisão da estrutura original.
-- Não lê linhas da aplicação, contadores correntes de sequências ou contas Auth.
-- Não cria objetos, não executa funções da aplicação e não produz uma migração.
-- Revisar expressões SQL localmente antes de compartilhar o resultado.
WITH
escopo(nome, origem, usado_no_fluxo) AS (
  VALUES
    ('lojas', 'modelo no commit 2690c68', true),
    ('usuarios_app', 'modelo no commit 2690c68', true),
    ('baixas_estoque', 'modelo no commit 2690c68', true),
    ('acessos_permitidos', 'modelo no commit 2690c68; existência a confirmar', false),
    ('usuarios_lojas', 'modelo acrescentado em e00eb8d; não presumir original', false)
),
relacoes AS (
  SELECT e.*, c.oid, c.relkind, c.relowner, c.relacl,
         c.relrowsecurity, c.relforcerowsecurity, c.relpersistence,
         c.reloptions, c.relreplident
  FROM escopo e
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.nome
),
colunas AS (
  SELECT r.nome AS tabela, r.oid AS tabela_oid, a.*,
         ad.oid AS default_oid, ad.adbin,
         co.collname, cn.nspname AS schema_collation,
         t.typname, tn.nspname AS schema_tipo
  FROM relacoes r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  JOIN pg_type t ON t.oid = a.atttypid
  JOIN pg_namespace tn ON tn.oid = t.typnamespace
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  LEFT JOIN pg_collation co ON co.oid = a.attcollation
  LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
),
indices AS (
  SELECT r.nome AS tabela, ic.relname AS nome, i.*
  FROM relacoes r JOIN pg_index i ON i.indrelid = r.oid
  JOIN pg_class ic ON ic.oid = i.indexrelid
),
sequencias AS (
  SELECT c.tabela, c.attname AS coluna, sc.oid, sn.nspname AS schema_seq,
         sc.relname AS nome, sc.relowner, sc.relacl, s.*
  FROM colunas c JOIN relacoes r ON r.oid = c.tabela_oid
  JOIN pg_class sc ON sc.oid = to_regclass(CASE WHEN r.relkind IN ('r', 'p')
    THEN pg_get_serial_sequence(format('%I.%I', 'public', r.nome), c.attname) END)
  JOIN pg_namespace sn ON sn.oid = sc.relnamespace
  JOIN pg_sequence s ON s.seqrelid = sc.oid
),
objetos_raiz(classid, objid) AS (
  SELECT 'pg_class'::regclass::oid, oid FROM relacoes WHERE oid IS NOT NULL
  UNION SELECT 'pg_class'::regclass::oid, indexrelid FROM indices
  UNION SELECT 'pg_class'::regclass::oid, oid FROM sequencias
  UNION SELECT 'pg_attrdef'::regclass::oid, default_oid FROM colunas WHERE default_oid IS NOT NULL
  UNION SELECT 'pg_constraint'::regclass::oid, co.oid FROM pg_constraint co JOIN relacoes r ON co.conrelid = r.oid
  UNION SELECT 'pg_trigger'::regclass::oid, tr.oid FROM pg_trigger tr JOIN relacoes r ON tr.tgrelid = r.oid WHERE NOT tr.tgisinternal
  UNION SELECT 'pg_policy'::regclass::oid, p.oid FROM pg_policy p JOIN relacoes r ON p.polrelid = r.oid
  UNION SELECT 'pg_rewrite'::regclass::oid, rw.oid FROM pg_rewrite rw JOIN relacoes r ON rw.ev_class = r.oid
),
saida AS (
  SELECT '01_contexto' AS secao, 'postgresql' AS item,
         jsonb_build_object('versao', current_setting('server_version'),
           'versao_numero', current_setting('server_version_num'),
           'encoding', pg_encoding_to_char(d.encoding), 'collation', d.datcollate,
           'ctype', d.datctype, 'search_path', current_setting('search_path'),
           'observacao', 'Permissoes observadas no SQL Editor nao comprovam as da conexao da API.') AS detalhes
  FROM pg_database d WHERE d.datname = current_database()
  UNION ALL
  SELECT '02_tabelas', 'public.' || r.nome,
         jsonb_build_object('existe', r.oid IS NOT NULL, 'origem_no_codigo', r.origem,
           'usada_no_fluxo', r.usado_no_fluxo, 'tipo_relacao', r.relkind,
           'proprietario', pg_get_userbyid(r.relowner), 'rls', r.relrowsecurity,
           'rls_forcada', r.relforcerowsecurity, 'persistencia', r.relpersistence,
           'opcoes', r.reloptions, 'replica_identity', r.relreplident,
           'politicas', (SELECT count(*) FROM pg_policy p WHERE p.polrelid = r.oid),
           'triggers_proprios', (SELECT count(*) FROM pg_trigger tr WHERE tr.tgrelid = r.oid AND NOT tr.tgisinternal))
  FROM relacoes r
  UNION ALL
  SELECT '03_colunas', c.tabela || '.' || c.attname,
         jsonb_build_object('ordem', c.attnum, 'tipo', format_type(c.atttypid, c.atttypmod),
           'schema_tipo', c.schema_tipo, 'not_null', c.attnotnull,
           'identidade', c.attidentity, 'gerada', c.attgenerated,
           'default_presente', c.default_oid IS NOT NULL,
           'default_ou_expressao', CASE
             WHEN c.default_oid IS NULL THEN NULL
             WHEN c.attname ~* '(token|senha|password|secret|email)'
               THEN '[omitido: revisar definicao sensivel localmente]'
             ELSE pg_get_expr(c.adbin, c.tabela_oid) END,
           'collation', CASE WHEN c.attcollation <> 0 THEN format('%I.%I', c.schema_collation, c.collname) END,
           'storage', c.attstorage, 'possui_acl_propria', c.attacl IS NOT NULL)
  FROM colunas c
  UNION ALL
  SELECT '04_constraints', r.nome || '.' || co.conname,
         jsonb_build_object('tipo', co.contype, 'definicao', pg_get_constraintdef(co.oid, true),
           'validada', co.convalidated, 'adiavel', co.condeferrable,
           'inicialmente_adiada', co.condeferred)
  FROM relacoes r JOIN pg_constraint co ON co.conrelid = r.oid
  UNION ALL
  SELECT '05_indices', i.tabela || '.' || i.nome,
         jsonb_build_object('definicao', pg_get_indexdef(i.indexrelid), 'unico', i.indisunique,
           'primario', i.indisprimary, 'valido', i.indisvalid, 'pronto', i.indisready,
           'imediato', i.indimmediate, 'clusterizado', i.indisclustered,
           'replica_identity', i.indisreplident)
  FROM indices i
  UNION ALL
  SELECT '06_sequencias_definicoes', s.tabela || '.' || s.coluna,
         jsonb_build_object('sequencia', format('%I.%I', s.schema_seq, s.nome),
           'tipo', format_type(s.seqtypid, NULL), 'inicio_definido', s.seqstart,
           'incremento', s.seqincrement, 'minimo', s.seqmin, 'maximo', s.seqmax,
           'cache', s.seqcache, 'ciclo', s.seqcycle, 'proprietario', pg_get_userbyid(s.relowner))
  FROM sequencias s
  UNION ALL
  SELECT '07_politicas_rls', r.nome || '.' || p.polname,
         jsonb_build_object('permissiva', p.polpermissive, 'comando', p.polcmd,
           'papeis', ARRAY(SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
                           FROM unnest(p.polroles) AS roles(role_oid)),
           'using', pg_get_expr(p.polqual, p.polrelid), 'with_check', pg_get_expr(p.polwithcheck, p.polrelid))
  FROM relacoes r JOIN pg_policy p ON p.polrelid = r.oid
  UNION ALL
  SELECT '08_triggers', r.nome || '.' || tr.tgname,
         jsonb_build_object('habilitado', tr.tgenabled,
           'funcao', tr.tgfoid::regprocedure::text, 'numero_argumentos', tr.tgnargs,
           'definicao', CASE WHEN tr.tgnargs > 0 THEN '[omitida: argumentos precisam de revisao local]'
                            ELSE pg_get_triggerdef(tr.oid, true) END)
  FROM relacoes r JOIN pg_trigger tr ON tr.tgrelid = r.oid AND NOT tr.tgisinternal
  UNION ALL
  SELECT '09_regras', r.nome || '.' || rw.rulename,
         jsonb_build_object('habilitada', rw.ev_enabled, 'definicao', pg_get_ruledef(rw.oid, true))
  FROM relacoes r JOIN pg_rewrite rw ON rw.ev_class = r.oid
  UNION ALL
  SELECT '10_privilegios_tabelas', r.nome || '.' || CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END || '.' || acl.privilege_type,
         jsonb_build_object('concedente', pg_get_userbyid(acl.grantor), 'pode_conceder', acl.is_grantable,
           'acl_explicita', r.relacl IS NOT NULL)
  FROM relacoes r CROSS JOIN LATERAL aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) acl
  WHERE r.oid IS NOT NULL
  UNION ALL
  SELECT '11_privilegios_colunas', c.tabela || '.' || c.attname || '.' || CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END || '.' || acl.privilege_type,
         jsonb_build_object('concedente', pg_get_userbyid(acl.grantor), 'pode_conceder', acl.is_grantable)
  FROM colunas c CROSS JOIN LATERAL aclexplode(c.attacl) acl
  UNION ALL
  SELECT '12_privilegios_sequencias', s.schema_seq || '.' || s.nome || '.' || CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END || '.' || acl.privilege_type,
         jsonb_build_object('concedente', pg_get_userbyid(acl.grantor), 'pode_conceder', acl.is_grantable)
  FROM sequencias s CROSS JOIN LATERAL aclexplode(coalesce(s.relacl, acldefault('s', s.relowner))) acl
  UNION ALL
  SELECT '13_privilegios_schema', 'public.' || CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END || '.' || acl.privilege_type,
         jsonb_build_object('concedente', pg_get_userbyid(acl.grantor), 'pode_conceder', acl.is_grantable,
           'proprietario', pg_get_userbyid(n.nspowner))
  FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT '14_privilegios_padrao', pg_get_userbyid(da.defaclrole) || '.' || da.defaclobjtype::text || '.' ||
         CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END || '.' || acl.privilege_type,
         jsonb_build_object('escopo', CASE WHEN da.defaclnamespace = 0 THEN 'global' ELSE 'public' END,
           'concedente', pg_get_userbyid(acl.grantor), 'pode_conceder', acl.is_grantable)
  FROM pg_default_acl da CROSS JOIN LATERAL aclexplode(da.defaclacl) acl
  WHERE da.defaclnamespace = 0 OR da.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  UNION ALL
  SELECT DISTINCT '15_dependencias_diretas', pg_describe_object(dep.classid, dep.objid, dep.objsubid) || ' -> ' ||
         pg_describe_object(dep.refclassid, dep.refobjid, dep.refobjsubid),
         jsonb_build_object('tipo_dependencia', dep.deptype, 'catalogo_referencia', dep.refclassid::regclass::text)
  FROM objetos_raiz obj JOIN pg_depend dep ON dep.classid = obj.classid AND dep.objid = obj.objid
  UNION ALL
  SELECT '16_inventario_public', format('%I.%I', n.nspname, c.relname),
         jsonb_build_object('tipo_relacao', c.relkind, 'no_escopo_de_revisao', EXISTS (SELECT 1 FROM escopo e WHERE e.nome = c.relname),
           'extensao', ext.extname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_depend de ON de.classid = 'pg_class'::regclass AND de.objid = c.oid AND de.deptype = 'e'
  LEFT JOIN pg_extension ext ON ext.oid = de.refobjid
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
)
SELECT secao, item, detalhes FROM saida ORDER BY secao, item, detalhes::text;
