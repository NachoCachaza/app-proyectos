-- Ensayo de 2026-11-23-fase2.sql: se corre concatenado DESPUÉS de la migración, en un solo lote
-- por la Management API. Termina en raise exception, así que todo se revierte (tabla incluida); los
-- resultados vienen en el mensaje del error. Ningún PERMITIDO es OK y todo conteo de alguien de
-- afuera del equipo tiene que dar 0.
do $t$
declare
  res jsonb := '{}';
  n int;
  v jsonb;
  ext uuid := gen_random_uuid();
  man uuid; lec uuid;
  p1 text;
begin
  select id into man from auth.users where lower(email) = 'manuelnavarro@insightsapps.tech';
  select u.id into lec from public.team_members t join auth.users u on lower(u.email) = lower(t.data->>'email')
   where t.deleted_at is null and t.data->>'access' = 'read' and t.data->>'status' = 'approved' limit 1;
  select id into p1 from public.projects where deleted_at is null limit 1;
  insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at) values
    (ext, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ext-ensayo-fase2@example.com', now());

  -- Funciones del service role (corre como dueño: sin set role todavía).
  insert into public.project_fase2 (id, data) values
    ('ens-c1', jsonb_build_object('id', 'ens-c1', 'projectId', p1, 'kind', 'call', 'estado', 'bajando', 'updatedAt', '2099-01-01T00:00:00.000Z')),
    ('ens-n1', jsonb_build_object('id', 'ens-n1', 'projectId', p1, 'kind', 'nota', 'text', 'x'));
  v := public.fase2_guardar_call('ens-c1', jsonb_build_object('estado', 'lista', 'projectId', 'pisado', 'kind', 'nota', 'texto', 'hola'));
  res := res || jsonb_build_object('s1_mezcla_sin_pisar_id_ni_tipo',
    v->>'estado' = 'lista' and v->>'texto' = 'hola' and v->>'projectId' = p1 and v->>'kind' = 'call',
    's2_sello_sube_sobre_reloj_adelantado', v->>'updatedAt' > '2099-01-01T00:00:00.000Z',
    's3_no_toca_una_nota', public.fase2_guardar_call('ens-n1', '{"text":"y"}') is null,
    '_rls_forzado', (select relforcerowsecurity from pg_class where oid = 'public.project_fase2'::regclass),
    '_en_realtime', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_fase2'),
    '_project_id', (select project_id from public.project_fase2 where id = 'ens-c1') = p1);

  v := public.fase2_guardar_plan(p1, jsonb_build_object('porQueAhora', 'Uno', 'id', 'pisado', 'kind', 'nota'));
  res := res || jsonb_build_object('s4_plan_crea', v->>'id' = 'plan-' || p1 and v->>'kind' = 'plan' and v->>'porQueAhora' = 'Uno');
  v := public.fase2_guardar_plan(p1, jsonb_build_object('porQueAhora', 'Dos'));
  res := res || jsonb_build_object('s5_plan_reemplaza_y_una_sola_fila',
    v->>'porQueAhora' = 'Dos'
    and (select count(*) from public.project_fase2 where id = 'plan-' || p1) = 1);
  begin perform public.fase2_guardar_plan('malo id!', '{}'); res := res || jsonb_build_object('s6_plan_proyecto_invalido', 'PERMITIDO');
  exception when others then res := res || jsonb_build_object('s6_plan_proyecto_invalido', 'bloqueado'); end;
  begin insert into public.project_fase2 (id, data) values ('ens-mal', jsonb_build_object('projectId', p1, 'kind', 'otra')); res := res || jsonb_build_object('s7_kind_invalido', 'PERMITIDO');
  exception when others then res := res || jsonb_build_object('s7_kind_invalido', 'bloqueado'); end;

  -- Equipo (Manuel).
  perform set_config('request.jwt.claims', json_build_object('sub', man, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.project_fase2 where id like 'ens-%'; res := res || jsonb_build_object('t1_equipo_lee', n);
  update public.project_fase2 set data = data || '{"estado":"error"}' where id = 'ens-c1'; get diagnostics n = row_count; res := res || jsonb_build_object('t2_equipo_edita', n);
  begin insert into public.project_fase2(id, data) values ('ens-d', jsonb_build_object('projectId', p1, 'kind', 'nota', 'text', 'z')); res := res || jsonb_build_object('t3_equipo_crea', 'ok'); exception when others then res := res || jsonb_build_object('t3_equipo_crea', 'BLOQUEADO ' || sqlerrm); end;
  begin delete from public.project_fase2 where id = 'ens-c1'; res := res || jsonb_build_object('t4_delete_fisico', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('t4_delete_fisico', 'bloqueado'); end;
  begin perform public.fase2_guardar_call('ens-c1', '{}'); res := res || jsonb_build_object('t5_sesion_guarda_call', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('t5_sesion_guarda_call', 'bloqueado'); end;
  begin perform public.fase2_guardar_plan(p1, '{}'); res := res || jsonb_build_object('t6_sesion_guarda_plan', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('t6_sesion_guarda_plan', 'bloqueado'); end;
  execute 'reset role';

  -- Lector (acceso read): lee, no escribe.
  if lec is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', lec, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.project_fase2 where id like 'ens-%'; res := res || jsonb_build_object('l1_lector_lee', n);
    update public.project_fase2 set data = data || '{"estado":"lista"}' where id = 'ens-c1'; get diagnostics n = row_count; res := res || jsonb_build_object('l2_lector_edita', n);
    begin insert into public.project_fase2(id, data) values ('ens-e', jsonb_build_object('projectId', p1, 'kind', 'nota', 'text', 'z')); res := res || jsonb_build_object('l3_lector_crea', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('l3_lector_crea', 'bloqueado'); end;
    execute 'reset role';
  else
    res := res || jsonb_build_object('l0_lector', 'no hay lector con cuenta');
  end if;

  -- Alguien de afuera del equipo.
  perform set_config('request.jwt.claims', json_build_object('sub', ext, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.project_fase2; res := res || jsonb_build_object('o1_ajeno_lee', n);
  update public.project_fase2 set data = '{}'; get diagnostics n = row_count; res := res || jsonb_build_object('o2_ajeno_edita', n);
  execute 'reset role';

  -- Sin sesión.
  execute 'set local role anon';
  begin select count(*) into n from public.project_fase2; res := res || jsonb_build_object('a1_anon_lee', 'PERMITIDO ' || n); exception when others then res := res || jsonb_build_object('a1_anon_lee', 'bloqueado'); end;
  execute 'reset role';

  raise exception 'ENSAYO %', res;
end $t$;
