\echo __FF__ 1
select id, name, lumens, lit, meta from lanterns order by id;
\echo __FF__ 2
update lanterns set lit = true where id = 3;
\echo __FF__ 3
select count(*) as n from lanterns where false;
\echo __FF__ 4
select * from lantern;
\echo __FF__ 5
select 1;
