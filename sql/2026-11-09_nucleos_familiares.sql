-- CRIS — Núcleos familiares (parte 1: estrutura, migração e regras de segurança)
-- Roda tudo de uma vez. Se der qualquer erro, nada é alterado (transação).
--
-- O que muda:
--   • nova tabela "familias"; usuários, perfis e médicos passam a pertencer a uma família
--   • master, sub-master, delegações, histórico e médicos passam a valer DENTRO da família
--   • a lista de usuários só mostra gente da mesma família
--   • novo marcador "admin_sistema": gerencia famílias e contas, sem acesso a dados de saúde
--   • os dados atuais vão para a "Família Roichman"

begin;

-- ======================================================================
-- 1. Estrutura
-- ======================================================================
create table if not exists public.familias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 80),
  criado_em timestamptz not null default now()
);
alter table public.familias enable row level security;

alter table public.usuarios     add column if not exists familia_id uuid references public.familias(id) on delete restrict;
alter table public.usuarios     add column if not exists admin_sistema boolean not null default false;
alter table public.perfis       add column if not exists familia_id uuid references public.familias(id) on delete restrict;
alter table public.profissionais add column if not exists familia_id uuid references public.familias(id) on delete restrict;

create index if not exists usuarios_familia_idx      on public.usuarios (familia_id);
create index if not exists perfis_familia_idx        on public.perfis (familia_id);
create index if not exists profissionais_familia_idx on public.profissionais (familia_id);

-- ======================================================================
-- 2. Migração: tudo o que existe vai para a Família Roichman
-- ======================================================================
do $$
declare f uuid;
begin
  if not exists (select 1 from public.familias) then
    insert into public.familias (nome) values ('Família Roichman') returning id into f;
  else
    select id into f from public.familias order by criado_em limit 1;
  end if;
  update public.usuarios      set familia_id = f where familia_id is null;
  update public.perfis        set familia_id = f where familia_id is null;
  update public.profissionais set familia_id = f where familia_id is null;
end $$;

-- ======================================================================
-- 3. Funções de apoio
-- ======================================================================
create or replace function public.minha_familia()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select familia_id from public.usuarios where id = auth.uid();
$$;

create or replace function public.sou_admin_sistema()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select admin_sistema from public.usuarios where id = auth.uid()), false);
$$;

-- A pessoa "u" é da mesma família que eu?
create or replace function public.mesma_familia(u uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios where id = u and familia_id = public.minha_familia());
$$;

-- Perfis e médicos novos entram automaticamente na família de quem cadastra
alter table public.perfis        alter column familia_id set default public.minha_familia();
alter table public.profissionais alter column familia_id set default public.minha_familia();
alter table public.perfis        alter column familia_id set not null;
alter table public.profissionais alter column familia_id set not null;

-- Permissões sobre perfis: agora sempre dentro da minha família
create or replace function public.pode_ver_perfil(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.termo_aceito() and exists (
    select 1 from public.perfis pf
    where pf.id = p and pf.familia_id = public.minha_familia() and (
         public.eh_master()
      or pf.dono_id = auth.uid()
      or pf.usuario_vinculado_id = auth.uid()
      or public.sou_submaster_de(pf.dono_id)
      or (pf.usuario_vinculado_id is not null and public.sou_submaster_de(pf.usuario_vinculado_id))
      or exists (select 1 from public.compartilhamentos c
                 where c.perfil_id = pf.id and c.usuario_id = auth.uid())
    )
  );
$$;

create or replace function public.pode_editar_perfil(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.termo_aceito() and exists (
    select 1 from public.perfis pf
    where pf.id = p and pf.familia_id = public.minha_familia() and (
         public.eh_master()
      or pf.dono_id = auth.uid()
      or pf.usuario_vinculado_id = auth.uid()
      or public.sou_submaster_de(pf.dono_id)
      or (pf.usuario_vinculado_id is not null and public.sou_submaster_de(pf.usuario_vinculado_id))
      or exists (select 1 from public.compartilhamentos c
                 where c.perfil_id = pf.id and c.usuario_id = auth.uid() and c.nivel = 'editar')
    )
  );
$$;

create or replace function public.pode_gerenciar_perfil(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.termo_aceito() and exists (
    select 1 from public.perfis pf
    where pf.id = p and pf.familia_id = public.minha_familia()
      and (public.eh_master() or pf.dono_id = auth.uid() or pf.usuario_vinculado_id = auth.uid())
  );
$$;

-- Lista de famílias para o administrador do sistema (sem dados de saúde, só contagens)
create or replace function public.admin_familias()
returns table (id uuid, nome text, criado_em timestamptz, pessoas bigint, perfis bigint, masters text)
language sql stable security definer set search_path to 'public' as $$
  select f.id, f.nome, f.criado_em,
    (select count(*) from public.usuarios u where u.familia_id = f.id),
    (select count(*) from public.perfis p where p.familia_id = f.id),
    (select string_agg(coalesce(nullif(u.nome, ''), u.email) || ' (' || u.email || ')', ', ' order by u.nome)
       from public.usuarios u where u.familia_id = f.id and u.papel = 'master')
  from public.familias f
  where public.sou_admin_sistema()
  order by f.nome;
$$;
revoke execute on function public.admin_familias() from public, anon;
grant execute on function public.admin_familias() to authenticated;

-- ======================================================================
-- 4. Gatilhos
-- ======================================================================

-- Novo login: entra na família de quem convidou.
-- Só o administrador do sistema pode colocar alguém numa família diferente da dele
-- (ao criar uma família nova) e já como master.
create or replace function public.ao_criar_login()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  convidante uuid;
  fam uuid;
  conv_admin boolean := false;
  fam_pedida uuid;
  papel_inicial text := 'membro';
begin
  begin
    convidante := (new.raw_user_meta_data ->> 'convidado_por')::uuid;
  exception when others then
    convidante := null;
  end;

  if convidante is not null then
    select familia_id, admin_sistema into fam, conv_admin from public.usuarios where id = convidante;
    if not found then convidante := null; fam := null; conv_admin := false; end if;
  end if;

  if conv_admin and new.raw_user_meta_data ? 'familia_id' then
    begin
      fam_pedida := (new.raw_user_meta_data ->> 'familia_id')::uuid;
    exception when others then
      fam_pedida := null;
    end;
    if fam_pedida is not null and exists (select 1 from public.familias where id = fam_pedida) then
      fam := fam_pedida;
      if new.raw_user_meta_data ->> 'papel' = 'master' then papel_inicial := 'master'; end if;
    end if;
  end if;

  insert into public.usuarios (id, nome, email, convidado_por, familia_id, papel)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'nome', ''),
          coalesce(new.email, ''),
          convidante,
          fam,
          papel_inicial);

  if convidante is not null
     and (select papel from public.usuarios where id = convidante) = 'submaster'
     and fam is not distinct from (select familia_id from public.usuarios where id = convidante) then
    insert into public.delegacoes (submaster_id, usuario_id, criado_por)
    values (convidante, new.id, convidante)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.proteger_usuarios()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null then
      if new.papel is distinct from old.papel and not (public.eh_master() and public.mesma_familia(old.id)) then
        raise exception 'Somente um master da família pode alterar papéis.';
      end if;
      if new.email is distinct from old.email then
        raise exception 'O e-mail não pode ser alterado por aqui.';
      end if;
      if new.convidado_por is distinct from old.convidado_por
         or new.familia_id is distinct from old.familia_id
         or new.admin_sistema is distinct from old.admin_sistema then
        raise exception 'Campo não editável.';
      end if;
    end if;
    if old.papel = 'master' and new.papel <> 'master'
       and (select count(*) from public.usuarios
            where papel = 'master' and familia_id is not distinct from old.familia_id) <= 1 then
      raise exception 'É preciso manter pelo menos um master na família.';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.papel = 'master'
       and (select count(*) from public.usuarios
            where papel = 'master' and familia_id is not distinct from old.familia_id) <= 1 then
      raise exception 'É preciso manter pelo menos um master na família.';
    end if;
    return old;
  end if;
  return null;
end;
$$;

create or replace function public.proteger_perfis()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null then
    if new.familia_id is distinct from old.familia_id then
      raise exception 'A família do perfil não pode ser alterada.';
    end if;
    if (new.dono_id is distinct from old.dono_id
        or new.usuario_vinculado_id is distinct from old.usuario_vinculado_id)
       and not public.pode_gerenciar_perfil(old.id) then
      raise exception 'Você não pode transferir ou vincular este perfil.';
    end if;
  end if;
  if not exists (select 1 from public.usuarios where id = new.dono_id and familia_id = new.familia_id)
     or (new.usuario_vinculado_id is not null and
         not exists (select 1 from public.usuarios where id = new.usuario_vinculado_id and familia_id = new.familia_id)) then
    raise exception 'O perfil só pode ser ligado a pessoas da mesma família.';
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

-- ======================================================================
-- 5. Regras de segurança (RLS)
-- ======================================================================

-- Famílias: cada um vê a sua; o admin vê todas. Master pode renomear a própria.
drop policy if exists "familias: ver" on public.familias;
create policy "familias: ver" on public.familias for select to authenticated
  using (id = public.minha_familia() or public.sou_admin_sistema());
drop policy if exists "familias: renomear" on public.familias;
create policy "familias: renomear" on public.familias for update to authenticated
  using (id = public.minha_familia() and public.eh_master())
  with check (id = public.minha_familia() and public.eh_master());

-- Usuários: só gente da mesma família
alter policy "usuarios: ver" on public.usuarios
  using (id = auth.uid() or (familia_id is not null and familia_id = public.minha_familia()));
alter policy "usuarios: editar" on public.usuarios
  using (id = auth.uid() or (public.eh_master() and public.mesma_familia(id)))
  with check (id = auth.uid() or (public.eh_master() and public.mesma_familia(id)));
alter policy "usuarios: excluir" on public.usuarios
  using (public.eh_master() and id <> auth.uid() and public.mesma_familia(id));

-- Perfis
alter policy "perfis: ver" on public.perfis
  using (familia_id = public.minha_familia() and public.pode_ver_perfil(id));
alter policy "perfis: criar" on public.perfis
  with check (
    public.termo_aceito()
    and familia_id = public.minha_familia()
    and public.mesma_familia(dono_id)
    and (dono_id = auth.uid() or public.eh_master() or public.sou_submaster_de(dono_id))
    and (usuario_vinculado_id is null
         or (public.mesma_familia(usuario_vinculado_id)
             and (usuario_vinculado_id = auth.uid() or public.eh_master() or public.sou_submaster_de(usuario_vinculado_id))))
  );

-- Compartilhamento: só com alguém da mesma família
alter policy "compartilhamentos: criar" on public.compartilhamentos
  with check (public.pode_gerenciar_perfil(perfil_id) and public.mesma_familia(usuario_id));
alter policy "compartilhamentos: editar" on public.compartilhamentos
  using (public.pode_gerenciar_perfil(perfil_id))
  with check (public.pode_gerenciar_perfil(perfil_id) and public.mesma_familia(usuario_id));

-- Delegações (sub-masters)
alter policy "delegacoes: ver" on public.delegacoes
  using ((public.eh_master() and public.mesma_familia(submaster_id))
         or submaster_id = auth.uid() or usuario_id = auth.uid());
alter policy "delegacoes: criar" on public.delegacoes
  with check (public.eh_master() and public.mesma_familia(submaster_id) and public.mesma_familia(usuario_id));
alter policy "delegacoes: excluir" on public.delegacoes
  using (public.eh_master() and public.mesma_familia(submaster_id));

-- Histórico
alter policy "historico: ver" on public.historico
  using ((perfil_id is not null and public.pode_ver_perfil(perfil_id))
         or (perfil_id is null and public.eh_master() and public.mesma_familia(usuario_id)));

-- Termo: master vê os aceites da própria família
alter policy "termo: ver" on public.termo_aceites
  using (usuario_id = auth.uid() or (public.eh_master() and public.mesma_familia(usuario_id)));

-- Médicos e profissionais: por família
alter policy "profissionais: ver" on public.profissionais
  using (familia_id = public.minha_familia() and (
    criado_por = auth.uid() or public.eh_master()
    or exists (select 1 from public.perfil_profissionais pp
               where pp.profissional_id = profissionais.id and public.pode_ver_perfil(pp.perfil_id))));
alter policy "profissionais: criar" on public.profissionais
  with check (public.termo_aceito() and criado_por = auth.uid() and familia_id = public.minha_familia());
alter policy "profissionais: editar" on public.profissionais
  using (familia_id = public.minha_familia() and (
    criado_por = auth.uid() or public.eh_master()
    or exists (select 1 from public.perfil_profissionais pp
               where pp.profissional_id = profissionais.id and public.pode_editar_perfil(pp.perfil_id))))
  with check (familia_id = public.minha_familia());
alter policy "profissionais: excluir" on public.profissionais
  using (familia_id = public.minha_familia() and (criado_por = auth.uid() or public.eh_master()));

-- Vínculo perfil ↔ médico: os dois têm de ser da mesma família
alter policy "perfil_profissionais: criar" on public.perfil_profissionais
  with check (public.pode_editar_perfil(perfil_id)
    and exists (select 1 from public.profissionais pr
                where pr.id = profissional_id and pr.familia_id = public.minha_familia()));

commit;

-- ======================================================================
-- Conferência (rode depois, separado): tudo deve dar 0
-- ======================================================================
-- select
--   (select count(*) from public.usuarios where familia_id is null)      as usuarios_sem_familia,
--   (select count(*) from public.perfis where familia_id is null)        as perfis_sem_familia,
--   (select count(*) from public.profissionais where familia_id is null) as medicos_sem_familia;
