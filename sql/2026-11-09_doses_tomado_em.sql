-- CRIS 0.7 Beta — permitir registrar dose tomada em outro horário
-- registrado_em = quando a pessoa anotou no app (continua automático)
-- tomado_em     = quando o remédio foi de fato tomado

-- 1) Nova coluna
alter table public.doses add column if not exists tomado_em timestamptz;

-- 2) Registros antigos: considera que foi tomado na hora em que foi anotado
update public.doses set tomado_em = registrado_em
where status = 'tomado' and tomado_em is null;

-- 3) Preenchimento automático: se não informar o horário, vale a hora do registro.
--    Doses "puladas" não têm horário de tomada.
create or replace function public.doses_preenche_tomado_em()
returns trigger language plpgsql as $$
begin
  if new.status = 'tomado' then
    new.tomado_em := coalesce(new.tomado_em, new.registrado_em, now());
  else
    new.tomado_em := null;
  end if;
  return new;
end $$;

drop trigger if exists doses_tomado_em on public.doses;
create trigger doses_tomado_em
  before insert or update on public.doses
  for each row execute function public.doses_preenche_tomado_em();

-- 4) Não aceita horário no futuro (tolerância de 5 min para relógio do celular adiantado)
alter table public.doses drop constraint if exists doses_tomado_em_nao_futuro;
alter table public.doses add constraint doses_tomado_em_nao_futuro
  check (tomado_em is null or tomado_em <= registrado_em + interval '5 minutes');
