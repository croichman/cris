// CRIS — função "lembretes" (roda no servidor do Supabase, chamada a cada minuto pelo agendador)
// Procura doses que chegaram na hora e ainda não foram registradas e manda uma notificação
// para os aparelhos de quem pediu lembretes daquele perfil.
//
// Segredos necessários (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — chaves das notificações
//   CRON_SECRET                          — senha que o agendador envia no cabeçalho x-cris-cron
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

function chaveSecreta(): string {
  try {
    const chaves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const k = chaves['default'] || Object.values(chaves)[0];
    if (k) return k as string;
  } catch { /* usa a chave antiga abaixo */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

type Pendente = {
  usuario_id: string; perfil_id: string; perfil_nome: string; horario_id: string;
  previsto_para: string; medicamento: string; dose: string | null;
};

Deno.serve(async (req) => {
  const segredo = Deno.env.get('CRON_SECRET');
  if (!segredo || req.headers.get('x-cris-cron') !== segredo) return responder(401, { erro: 'Não autorizado.' });

  try {
    webpush.setVapidDetails(
      'https://croichman.github.io/cris/',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: pendentes, error } = await admin.rpc('lembretes_pendentes');
    if (error) return responder(500, { erro: error.message });
    if (!pendentes?.length) {
      // de hora em hora, aproveita para apagar registros antigos
      if (new Date().getUTCMinutes() === 0) await admin.rpc('limpar_notificacoes_antigas');
      return responder(200, { enviados: 0 });
    }

    // "Reserva" cada lembrete antes de enviar: se duas execuções se cruzarem, só uma envia
    const { data: reservados, error: e2 } = await admin.from('notificacoes_enviadas')
      .upsert((pendentes as Pendente[]).map((p) => ({
        horario_id: p.horario_id, previsto_para: p.previsto_para, usuario_id: p.usuario_id
      })), { onConflict: 'horario_id,previsto_para,usuario_id', ignoreDuplicates: true })
      .select('horario_id, previsto_para, usuario_id');
    if (e2) return responder(500, { erro: e2.message });
    const chave = (x: { horario_id: string; previsto_para: string; usuario_id: string }) =>
      `${x.horario_id}|${new Date(x.previsto_para).getTime()}|${x.usuario_id}`;
    const ok = new Set((reservados || []).map(chave));
    const aEnviar = (pendentes as Pendente[]).filter((p) => ok.has(chave(p)));

    // Agrupa: uma notificação por pessoa + perfil + horário, com todos os remédios daquele horário
    const grupos = new Map<string, { usuario_id: string; perfil_id: string; perfil_nome: string; previsto: string; itens: string[] }>();
    for (const p of aEnviar) {
      const k = `${p.usuario_id}|${p.perfil_id}|${new Date(p.previsto_para).getTime()}`;
      if (!grupos.has(k)) grupos.set(k, { usuario_id: p.usuario_id, perfil_id: p.perfil_id, perfil_nome: p.perfil_nome, previsto: p.previsto_para, itens: [] });
      grupos.get(k)!.itens.push(p.dose ? `${p.medicamento} (${p.dose})` : p.medicamento);
    }

    const usuarios = [...new Set([...grupos.values()].map((g) => g.usuario_id))];
    const { data: aparelhos } = await admin.from('push_inscricoes')
      .select('id, usuario_id, endpoint, p256dh, auth').in('usuario_id', usuarios);

    let enviados = 0;
    const apagar: string[] = [];
    for (const g of grupos.values()) {
      const primeiroNome = g.perfil_nome.split(' ')[0];
      const corpo = JSON.stringify({
        titulo: `Hora do remédio · ${primeiroNome}`,
        texto: g.itens.join('\n'),
        url: './#/hoje',
        tag: `dose-${g.perfil_id}-${new Date(g.previsto).getTime()}`
      });
      for (const a of (aparelhos || []).filter((x) => x.usuario_id === g.usuario_id)) {
        try {
          await webpush.sendNotification(
            { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, corpo,
            { TTL: 60 * 60, urgency: 'high' }
          );
          enviados++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) apagar.push(a.id); // aparelho desinstalou ou desativou
          else console.error('Falha ao enviar', status, (e as Error).message);
        }
      }
    }
    if (apagar.length) await admin.from('push_inscricoes').delete().in('id', apagar);

    return responder(200, { enviados, removidos: apagar.length });
  } catch (e) {
    return responder(500, { erro: (e as Error).message || 'Erro inesperado.' });
  }
});
