-- Training Card live classes: private schema and tables.
-- Nothing here is reachable through the public API: the schema is not exposed,
-- every table has RLS on with no policies, and anon/authenticated hold no grants.
-- The site talks to the database only through the public.tc_* functions (002).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists tc;
revoke all on schema tc from public, anon, authenticated;

-- ---------- Reference data (loaded from the Excel template by an admin) ----------
create table tc.courses (
  id           text primary key,
  tab          text not null,
  name         text not null,
  profession   text not null,
  show         boolean not null default true,
  barcode      boolean not null default false,
  blood_bag    boolean not null default false,
  doctor_user  text not null default '',
  doctor_pass  text not null default '',
  witness_user text not null default '',
  witness_pass text not null default '',
  access_url   text not null default '',
  notes        text not null default '',
  sort         int  not null default 0
);

create table tc.logins (
  id          bigint generated always as identity primary key,
  course_id   text not null references tc.courses(id) on delete cascade,
  login       text not null,
  password    text not null default '',
  facility    text not null default '',
  doctor_user text not null default '',
  second      jsonb,            -- {label, login, password, part}
  hbcis       jsonb,            -- the HBCIS patient, always shown
  sort        int not null,
  unique (course_id, login, facility)
);
create index on tc.logins (course_id, sort);

create table tc.patients (
  id       bigint generated always as identity primary key,
  login_id bigint not null references tc.logins(id) on delete cascade,
  sort     int  not null,
  part     text not null default '',
  mode     text not null default 'instructor' check (mode in ('instructor', 'proficiency', 'always')),
  role     text not null default '',
  last     text not null default '',
  first    text not null default '',
  dob      text not null default '',
  mrn      text not null default '',
  fin      text not null default '',
  ward     text not null default '',
  ioms     text not null default ''
);
create index on tc.patients (login_id);

-- ---------- Staff access ----------
create table tc.staff (
  role       text primary key check (role in ('instructor', 'admin')),
  pass_hash  text not null,              -- bcrypt via extensions.crypt
  updated_at timestamptz not null default now()
);

create table tc.sessions (
  token_hash text primary key,           -- sha256 of the token; the token itself is never stored
  role       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table tc.attempts (               -- failed logins and wrong class codes, for rate limiting
  id   bigint generated always as identity primary key,
  kind text not null,
  ip   text not null,
  at   timestamptz not null default now()
);
create index on tc.attempts (kind, ip, at);

-- ---------- Live classes ----------
create table tc.classes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  channel    uuid not null default gen_random_uuid(),   -- secret realtime topic
  course_id  text not null references tc.courses(id) on delete cascade,
  facility   text not null default '',
  site       text not null default '',
  planned    int  not null,
  part       text not null default '',
  mode       text not null default 'instructor' check (mode in ('instructor', 'proficiency')),
  state      text not null default 'active' check (state in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at   timestamptz
);
create unique index classes_code_live on tc.classes (code) where state = 'active';

create table tc.allocations (
  id          bigint generated always as identity primary key,
  class_id    uuid   not null references tc.classes(id) on delete cascade,
  login_id    bigint not null references tc.logins(id) on delete cascade,
  kind        text   not null check (kind in ('instructor', 'trainee')),
  device_hash text,
  claimed_at  timestamptz,
  released_at timestamptz,
  created_at  timestamptz not null default now()
);
-- A login can be in only one live class at a time, across every site.
create unique index allocations_login_live on tc.allocations (login_id) where released_at is null;
create unique index allocations_device_live on tc.allocations (class_id, device_hash)
  where released_at is null and device_hash is not null;
create index on tc.allocations (class_id);

-- ---------- Lock everything ----------
alter table tc.courses     enable row level security;
alter table tc.logins      enable row level security;
alter table tc.patients    enable row level security;
alter table tc.staff       enable row level security;
alter table tc.sessions    enable row level security;
alter table tc.attempts    enable row level security;
alter table tc.classes     enable row level security;
alter table tc.allocations enable row level security;

revoke all on all tables in schema tc from public, anon, authenticated;
revoke all on all sequences in schema tc from public, anon, authenticated;
alter default privileges in schema tc revoke all on tables from public, anon, authenticated;
alter default privileges in schema tc revoke all on functions from public, anon, authenticated;
