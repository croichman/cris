-- CRIS — agendador: chama a função "lembretes" a cada minuto
-- Rode depois de publicar a função "lembretes" e cadastrar os segredos.
-- Troque COLE_AQUI_O_CRON_SECRET pelo mesmo valor do segredo CRON_SECRET da função.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('cris-lembretes') where exists (select 1 from cron.job where jobname = 'cris-lembretes');

select cron.schedule('cris-lembretes', '* * * * *', $$
  select net.http_post(
    url := 'https://udqhqosngiwvnxvqtrye.supabase.co/functions/v1/lembretes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cris-cron', 'COLE_AQUI_O_CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

-- Conferir depois de 2–3 minutos (status_code 200 = ok):
-- select status_code, content, created from net._http_response order by created desc limit 5;
