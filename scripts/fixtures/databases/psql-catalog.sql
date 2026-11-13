\echo __FF__ 1
select n.nspname as schema, c.relname as name, case when c.relkind in ('v','m') then 'view' else 'table' end as type, greatest(c.reltuples, -1)::bigint as estimate from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%' order by 1, 3, 2;
\echo __FF__ 2
select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, case when a.attnotnull then 'no' else 'yes' end as nullable, pg_get_expr(d.adbin, d.adrelid) as "default", case when exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)) then 'pk' else '' end as key from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = '"public"."lanterns"'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum;
\echo __FF__ 3
select c.relname as name, case when i.indisprimary then 'primary' when i.indisunique then 'unique' else '' end as kind, am.amname as method, pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class c on c.oid = i.indexrelid join pg_am am on am.oid = c.relam where i.indrelid = '"public"."lanterns"'::regclass order by i.indisprimary desc, c.relname;
\echo __FF__ 4
select conname as name, conrelid::regclass::text as from_table, confrelid::regclass::text as to_table, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'f' and (conrelid = '"public"."lanterns"'::regclass or confrelid = '"public"."lanterns"'::regclass) order by 1;
\echo __FF__ 5
select count(*) as n from "public"."lanterns";
