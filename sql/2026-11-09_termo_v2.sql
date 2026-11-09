-- CRIS — Termo de consentimento, versão 2 (núcleos familiares e administrador do sistema)
-- Rode SOMENTE depois que o app novo estiver publicado.
-- A partir daqui, todos precisam aceitar a versão 2 no próximo acesso.
create or replace function public.termo_versao_atual()
returns integer language sql immutable as $$ select 2 $$;
