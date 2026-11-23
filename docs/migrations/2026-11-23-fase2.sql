-- Sección "Fase 2" por proyecto (spec 2026-11-23-fathom-resumen-fase2-design.md).
--
-- Una fila por entrada (nota, call de Fathom o plan del proyecto), mismo patrón por fila que
-- project_opportunities: id, data, updated_at, deleted_at, sync_at; project_id sale del JSON.
-- Lee quien puede ver Fase 2 y escribe quien puede editarla (pm_puede_ver_fase2 / pm_puede_editar_fase2,
-- más abajo): nunca un developer, aunque tenga acceso completo.
-- La edge function `fase2` escribe con service role por las dos funciones de abajo.
-- Sin DELETE: se borra con deleted_at.

create table if not exists public.project_fase2 (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_at timestamptz not null default clock_timestamp(),
  project_id text generated always as (data->>'projectId') stored,
  constraint project_fase2_kind check (coalesce(data->>'kind', '') in ('nota', 'call', 'plan'))
);

create index if not exists project_fase2_project_idx
  on public.project_fase2 (project_id) where deleted_at is null;
create index if not exists project_fase2_sync_at on public.project_fase2 (sync_at);

drop trigger if exists tocar_sync_at on public.project_fase2;
create trigger tocar_sync_at before insert or update on public.project_fase2
  for each row execute function public.tocar_sync_at();

alter table public.project_fase2 enable row level security;
alter table public.project_fase2 force row level security;
revoke all on table public.project_fase2 from public, anon, authenticated;
grant select, insert, update on table public.project_fase2 to authenticated;
grant select, insert, update, delete on table public.project_fase2 to service_role;

-- Quién ve y quién edita la Fase 2 (call con el cliente, presupuestos, objeciones): sólo personas
-- autorizadas. Ven los fundadores y el acceso de lectura (Mati, Axel); editan sólo los de acceso
-- completo. Un developer queda afuera AUNQUE tenga acceso completo (is_team() mira el acceso, no el
-- rol): la lista de roles es la misma que DEV_ROLES de src/lib/visibility.js. Colaboradores
-- ('collab') y clientes ('project') ya quedaban afuera por no ser 'full' ni 'read'.
create or replace function public.pm_puede_ver_fase2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members t
    where t.deleted_at is null
      and t.data->>'status' = 'approved'
      and t.data->>'access' in ('full', 'read')
      and lower(btrim(coalesce(t.data->>'role', ''))) not in ('dev', 'devs', 'developer', 'desarrollador', 'desarrolladora', 'desarrollo')
      and lower(t.data->>'email') = public.pm_mi_email()
  )
$$;
revoke all on function public.pm_puede_ver_fase2() from public, anon;
grant execute on function public.pm_puede_ver_fase2() to authenticated;

create or replace function public.pm_puede_editar_fase2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members t
    where t.deleted_at is null
      and t.data->>'status' = 'approved'
      and t.data->>'access' = 'full'
      and lower(btrim(coalesce(t.data->>'role', ''))) not in ('dev', 'devs', 'developer', 'desarrollador', 'desarrolladora', 'desarrollo')
      and lower(t.data->>'email') = public.pm_mi_email()
  )
$$;
revoke all on function public.pm_puede_editar_fase2() from public, anon;
grant execute on function public.pm_puede_editar_fase2() to authenticated;

drop policy if exists project_fase2_equipo_select on public.project_fase2;
drop policy if exists project_fase2_equipo_insert on public.project_fase2;
drop policy if exists project_fase2_equipo_update on public.project_fase2;
create policy project_fase2_equipo_select on public.project_fase2
  for select to authenticated using ((select public.pm_puede_ver_fase2()));
create policy project_fase2_equipo_insert on public.project_fase2
  for insert to authenticated with check ((select public.pm_puede_editar_fase2()));
create policy project_fase2_equipo_update on public.project_fase2
  for update to authenticated using ((select public.pm_puede_editar_fase2())) with check ((select public.pm_puede_editar_fase2()));

do $$ begin
  alter publication supabase_realtime add table public.project_fase2;
exception when duplicate_object then null; end $$;

-- Mezcla un parche en una call viva (texto bajado, estado, análisis…). No deja cambiar id, proyecto
-- ni tipo. Reusa oportunidad_sello: updatedAt siempre sube por encima del anterior, para que un
-- navegador con el reloj adelantado no ignore el resultado.
create or replace function public.fase2_guardar_call(p_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'PATCH_INVALIDO' using errcode = '22023';
  end if;
  update public.project_fase2
     set data = data || (p_patch - 'id' - 'projectId' - 'kind')
                     || jsonb_build_object('updatedAt', public.oportunidad_sello(data->>'updatedAt')),
         updated_at = now()
   where id = p_id and deleted_at is null and data->>'kind' = 'call'
  returning data into v;
  return v;
end $$;
revoke all on function public.fase2_guardar_call(text, jsonb) from public, anon, authenticated;
grant execute on function public.fase2_guardar_call(text, jsonb) to service_role;

-- Una sola fila de plan por proyecto (id 'plan-<proyecto>'): la crea o la reemplaza.
create or replace function public.fase2_guardar_plan(p_project text, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_id text := 'plan-' || coalesce(p_project, '');
begin
  if coalesce(p_project, '') !~ '^[A-Za-z0-9_-]{1,80}$' or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'PLAN_INVALIDO' using errcode = '22023';
  end if;
  insert into public.project_fase2 (id, data, updated_at)
  values (
    v_id,
    (p_plan - 'id' - 'projectId' - 'kind')
      || jsonb_build_object('id', v_id, 'projectId', p_project, 'kind', 'plan', 'updatedAt', public.oportunidad_sello(null)),
    now()
  )
  on conflict (id) do update
    set data = excluded.data
               || jsonb_build_object('updatedAt', public.oportunidad_sello(public.project_fase2.data->>'updatedAt')),
        updated_at = now(),
        deleted_at = null
  returning data into v;
  return v;
end $$;
revoke all on function public.fase2_guardar_plan(text, jsonb) from public, anon, authenticated;
grant execute on function public.fase2_guardar_plan(text, jsonb) to service_role;
