-- CRIS 1.0 Beta — Notificações de medicamentos (Web Push)
-- Usa as tabelas que já existiam: push_inscricoes, lembrete_destinatarios, notificacoes_enviadas
-- e a coluna medicamentos.lembretes_ativos.

begin;

-- 1) Registrar o aparelho: se o mesmo aparelho já estava ligado a outra pessoa
--    (ex.: tablet da casa), passa a ser de quem ativou agora.
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Entre no app para ativar as notificações.'; end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (usuario_id, endpoint, p256dh, auth, dispositivo)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_dispositivo, 120));
end $$;
revoke execute on function public.registrar_push(text, text, text, text) from public, anon;
grant execute on function public.registrar_push(text, text, text, text) to authenticated;

-- 2) Doses que precisam de lembrete agora (chamada só pelo servidor, a cada minuto).
--    Janela: doses previstas nos últimos 15 minutos que ainda não foram registradas
--    (nem "tomei" nem "pular") e cujo lembrete ainda não saiu para aquela pessoa.
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
    -- hoje e ontem no fuso do perfil (cobre doses perto da meia-noite)
    cross join lateral (values ((now() at time zone p.fuso_horario)::date),
                               ((now() at time zone p.fuso_horario)::date - 1)) as d(dia)
    where h.ativo and m.situacao = 'em_uso' and not m.se_necessario and m.lembretes_ativos
  )
  select ld.usuario_id, c.perfil_id, c.perfil_nome, c.horario_id, c.previsto_para, c.medicamento, c.dose
  from candidatos c
  join public.lembrete_destinatarios ld on ld.perfil_id = c.perfil_id
  join public.usuarios u on u.id = ld.usuario_id and u.familia_id = c.familia_id
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

-- 3) Faxina: o registro de lembretes enviados só precisa dos últimos dias
create or replace function public.limpar_notificacoes_antigas()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.notificacoes_enviadas where enviado_em < now() - interval '7 days';
$$;
revoke execute on function public.limpar_notificacoes_antigas() from public, anon, authenticated;
grant execute on function public.limpar_notificacoes_antigas() to service_role;

-- 4) Quem recebe lembretes de um perfil precisa poder vê-lo
--    (a regra já existia; reforça que é da mesma família)
alter policy "lembretes: ativar" on public.lembrete_destinatarios
  with check (usuario_id = auth.uid() and public.pode_ver_perfil(perfil_id));

-- Índice para a busca de doses já registradas
create index if not exists doses_horario_previsto_idx on public.doses (horario_id, previsto_para);

commit;
