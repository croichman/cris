-- CRIS — Termo de consentimento, versão 3 (transparência sobre o acesso técnico ao servidor)
-- Rode SOMENTE depois que o app novo estiver publicado (versão 0.11 Beta ou posterior).
-- A partir daqui, todos precisam aceitar a versão 3 no próximo acesso.
create or replace function public.termo_versao_atual()
returns integer language sql immutable as $$ select 3 $$;
