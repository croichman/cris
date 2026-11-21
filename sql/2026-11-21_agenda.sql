-- CRIS 0.19 Beta — Agenda (consultas, exames, vacinas…) e avisos da agenda
-- Roda tudo de uma vez (transação): se der erro, nada é alterado.

begin;

-- 1) Compromissos de cada perfil
create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  tipo text not null default 'consulta'
    check (tipo in ('consulta', 'exame', 'retorno', 'vacina', 'procedimento', 'terapia', 'outro')),
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  inicio timestamptz not null,
  local text,
  profissional_id uuid references public.profissionais(id) on delete set null,
  observacoes text,
  situacao text not null default 'agendado' check (situacao in ('agendado', 'realizado', 'cancelado')),
  lembrete_vespera boolean not null default true,          -- véspera às 19h
  lembrete_minutos_antes integer default 120                -- null = sem aviso antes
    check (lembrete_minutos_antes is null or lembrete_minutos_antes between 0 and 2880),
  criado_por uuid default auth.uid() references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists eventos_perfil_inicio_idx on public.eventos (perfil_id, inicio);
create index if not exists eventos_inicio_idx on public.eventos (inicio) where situacao = 'agendado';

alter table public.eventos enable row level security;
drop policy if exists "eventos: ver" on public.eventos;
create policy "eventos: ver" on public.eventos for select to authenticated
  using (public.pode_ver_perfil(perfil_id));
drop policy if exists "eventos: criar" on public.eventos;
create policy "eventos: criar" on public.eventos for insert to authenticated
  with check (public.pode_editar_perfil(perfil_id));
drop policy if exists "eventos: editar" on public.eventos;
create policy "eventos: editar" on public.eventos for update to authenticated
  using (public.pode_editar_perfil(perfil_id)) with check (public.pode_editar_perfil(perfil_id));
drop policy if exists "eventos: excluir" on public.eventos;
create policy "eventos: excluir" on public.eventos for delete to authenticated
  using (public.pode_editar_perfil(perfil_id));

drop trigger if exists marcar_atualizacao on public.eventos;
create trigger marcar_atualizacao before update on public.eventos
  for each row execute function public.marcar_atualizacao();
drop trigger if exists registrar_historico on public.eventos;
create trigger registrar_historico after insert or update or delete on public.eventos
  for each row execute function public.registrar_historico();

-- 2) Cada pessoa escolhe que tipo de aviso quer receber
alter table public.usuarios add column if not exists avisar_remedios boolean not null default true;
alter table public.usuarios add column if not exists avisar_agenda boolean not null default true;

-- 3) Registro dos avisos de agenda já enviados (evita repetir)
create table if not exists public.notificacoes_eventos_enviadas (
  evento_id uuid not null references public.eventos(id) on delete cascade,
  momento text not null check (momento in ('vespera', 'antes')),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  enviado_em timestamptz not null default now(),
  primary key (evento_id, momento, usuario_id)
);
alter table public.notificacoes_eventos_enviadas enable row level security;
-- (sem regras para o app: só o servidor mexe nesta tabela)

-- 4) Lembretes de remédio passam a respeitar a escolha "avisar_remedios"
create or replace function public.lembretes_pendentes()
returns table (
  usuario_id uuid, perfil_id uuid, perfil_nome text, horario_id uuid,
  previsto_para timestamptz, medicamento text, dose text
)
language sql stable security definer set search_path to 'public' as $$
  with candidatos as (
    select h.id as horario_id, m.id as medicamento_id, p.id as perfil_id, p.nome as perfil_nome,
           p.familia_id, h.dias_semana, d.dia,
           ((d.dia + h.hora) at time zone p.fuso_horario) as previsto_para,
           trim(concat_ws(' ', m.nome_comercial, m.concentracao)) as medicamento, m.dose,
           m.data_inicio, m.data_fim
    from public.horarios h
    join public.medicamentos m on m.id = h.medicamento_id
    join public.perfis p on p.id = m.perfil_id
    cross join lateral (values ((now() at time zone p.fuso_horario)::date),
                               ((now() at time zone p.fuso_horario)::date - 1)) as d(dia)
    where h.ativo and m.situacao = 'em_uso' and not m.se_necessario and m.lembretes_ativos
  )
  select ld.usuario_id, c.perfil_id, c.perfil_nome, c.horario_id, c.previsto_para, c.medicamento, c.dose
  from candidatos c
  join public.lembrete_destinatarios ld on ld.perfil_id = c.perfil_id
  join public.usuarios u on u.id = ld.usuario_id and u.familia_id = c.familia_id and u.avisar_remedios
  where extract(dow from c.dia)::smallint = any (c.dias_semana)
    and (c.data_inicio is null or c.data_inicio <= c.dia)
    and (c.data_fim is null or c.data_fim >= c.dia)
    and c.previsto_para between now() - interval '15 minutes' and now() + interval '30 seconds'
    and not exists (select 1 from public.doses ds
                    where ds.horario_id = c.horario_id and ds.previsto_para = c.previsto_para)
    and not exists (select 1 from public.notificacoes_enviadas ne
                    where ne.horario_id = c.horario_id and ne.previsto_para = c.previsto_para
                      and ne.usuario_id = ld.usuario_id)
    and exists (select 1 from public.push_inscricoes pi where pi.usuario_id = ld.usuario_id);
$$;
revoke execute on function public.lembretes_pendentes() from public, anon, authenticated;
grant execute on function public.lembretes_pendentes() to service_role;

-- 5) Avisos da agenda que precisam sair agora (chamada só pelo servidor)
--    • véspera: a partir das 19h do dia anterior (no fuso do perfil), por até 3 horas
--    • antes:   a partir de X minutos antes do horário, até a hora do compromisso
create or replace function public.lembretes_eventos_pendentes()
returns table (
  usuario_id uuid, perfil_id uuid, perfil_nome text, evento_id uuid, momento text,
  tipo text, titulo text, inicio timestamptz, local text, fuso text
)
language sql stable security definer set search_path to 'public' as $$
  with ev as (
    select e.*, p.nome as perfil_nome, p.familia_id, p.fuso_horario as fuso,
           ((((e.inicio at time zone p.fuso_horario)::date - 1) + time '19:00') at time zone p.fuso_horario) as vespera_em
    from public.eventos e
    join public.perfis p on p.id = e.perfil_id
    where e.situacao = 'agendado'
      and e.inicio > now()
      and e.inicio < now() + interval '3 days'
  ), momentos as (
    select ev.*, 'vespera'::text as momento from ev
     where ev.lembrete_vespera
       and now() >= ev.vespera_em and now() < ev.vespera_em + interval '3 hours'
    union all
    select ev.*, 'antes'::text from ev
     where ev.lembrete_minutos_antes is not null
       and now() >= ev.inicio - make_interval(mins => ev.lembrete_minutos_antes)
  )
  select ld.usuario_id, m.perfil_id, m.perfil_nome, m.id, m.momento,
         m.tipo, m.titulo, m.inicio, m.local, m.fuso
  from momentos m
  join public.lembrete_destinatarios ld on ld.perfil_id = m.perfil_id
  join public.usuarios u on u.id = ld.usuario_id and u.familia_id = m.familia_id and u.avisar_agenda
  where not exists (select 1 from public.notificacoes_eventos_enviadas ne
                    where ne.evento_id = m.id and ne.momento = m.momento and ne.usuario_id = ld.usuario_id)
    and exists (select 1 from public.push_inscricoes pi where pi.usuario_id = ld.usuario_id);
$$;
revoke execute on function public.lembretes_eventos_pendentes() from public, anon, authenticated;
grant execute on function public.lembretes_eventos_pendentes() to service_role;

-- 6) Faxina também dos avisos de agenda
create or replace function public.limpar_notificacoes_antigas()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.notificacoes_enviadas where enviado_em < now() - interval '7 days';
  delete from public.notificacoes_eventos_enviadas where enviado_em < now() - interval '30 days';
$$;
revoke execute on function public.limpar_notificacoes_antigas() from public, anon, authenticated;
grant execute on function public.limpar_notificacoes_antigas() to service_role;

commit;
