-- CRIS — agendador: chama a função "lembretes" a cada minuto
-- Rode depois de publicar a função "lembretes" e cadastrar os segredos.
-- Troque COLE_AQUI_O_CRON_SECRET pelo mesmo valor do segredo CRON_SECRET da função.
-- O "apikey" é a chave pública do app (a mesma de js/config.js): o Supabase exige alguma chave
-- para deixar a chamada chegar à função; quem autoriza de fato é o x-cris-cron.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('cris-lembretes') where exists (select 1 from cron.job where jobname = 'cris-lembretes');

select cron.schedule('cris-lembretes', '* * * * *', $$
  select net.http_post(
    url := 'https://udqhqosngiwvnxvqtrye.supabase.co/functions/v1/lembretes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_Aa_6ZgJ4wR9JpW0rI2VWqw_8-R717o4',
      'x-cris-cron', 'COLE_AQUI_O_CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

-- Conferir depois de 2–3 minutos (status_code 200 = ok):
-- select status_code, content, created from net._http_response order by created desc limit 5;
