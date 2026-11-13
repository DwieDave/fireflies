create table users (id bigserial primary key, handle text not null unique);
create table lanterns (id bigserial primary key, name text not null, owner_id bigint references users(id) on delete cascade, lumens integer default 800, lit boolean, meta jsonb, created_at timestamptz default now());
create index lanterns_owner_idx on lanterns(owner_id);
create view bright as select * from lanterns where lumens > 1000;
create schema billing; create table billing.invoices (id int primary key, amount numeric(10,2));
insert into users(handle) values ('ada'),('kestrel');
insert into lanterns(name, owner_id, lumens, lit, meta) values ('Harbour Watch',1,1600,true,'{"glow":"amber"}'),('Moth "Lure", No. 4',2,1420,null,null),('',1,700,false,'{}'),(E'two\nlines',2,null,true,null);
