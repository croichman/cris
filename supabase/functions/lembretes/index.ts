// CRIS — função "lembretes" (roda no servidor do Supabase, chamada a cada minuto pelo agendador)
// • Remédios: doses que chegaram na hora e ainda não foram registradas.
// • Agenda: compromissos na véspera às 19h e X minutos antes.
// Manda notificações para os aparelhos de quem acompanha aquele perfil.
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

type Aparelho = { id: string; usuario_id: string; endpoint: string; p256dh: string; auth: string };
type Dose = {
  usuario_id: string; perfil_id: string; perfil_nome: string; horario_id: string;
  previsto_para: string; medicamento: string; dose: string | null;
};
type Evento = {
  usuario_id: string; perfil_id: string; perfil_nome: string; evento_id: string; momento: string;
  tipo: string; titulo: string; inicio: string; local: string | null; fuso: string | null;
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

    let enviados = 0;
    const apagar: string[] = [];

    const aparelhosDe = async (ids: string[]): Promise<Aparelho[]> => {
      if (!ids.length) return [];
      const { data } = await admin.from('push_inscricoes')
        .select('id, usuario_id, endpoint, p256dh, auth').in('usuario_id', ids);
      return (data || []) as Aparelho[];
    };

    // Uma notificação para todos os aparelhos de uma pessoa
    const enviar = async (aparelhos: Aparelho[], usuarioId: string, corpo: string) => {
      for (const a of aparelhos.filter((x) => x.usuario_id === usuarioId)) {
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
    };

    // ---------------- Agenda ----------------
    const { data: eventos, error: erroAgenda } = await admin.rpc('lembretes_eventos_pendentes');
    if (erroAgenda) console.error('Agenda:', erroAgenda.message);
    if (eventos?.length) {
      // "Reserva" antes de enviar: se duas execuções se cruzarem, só uma envia
      const { data: reservados } = await admin.from('notificacoes_eventos_enviadas')
        .upsert((eventos as Evento[]).map((x) => ({ evento_id: x.evento_id, momento: x.momento, usuario_id: x.usuario_id })),
          { onConflict: 'evento_id,momento,usuario_id', ignoreDuplicates: true })
        .select('evento_id, momento, usuario_id');
      const ok = new Set((reservados || []).map((x) => `${x.evento_id}|${x.momento}|${x.usuario_id}`));
      const lista = (eventos as Evento[]).filter((x) => ok.has(`${x.evento_id}|${x.momento}|${x.usuario_id}`));
      const aps = await aparelhosDe([...new Set(lista.map((x) => x.usuario_id))]);
      for (const x of lista) {
        const fuso = x.fuso || 'America/Recife';
        const quando = new Date(x.inicio);
        const hora = quando.toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' });
        const dia = quando.toLocaleDateString('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'numeric' });
        await enviar(aps, x.usuario_id, JSON.stringify({
          titulo: `${x.momento === 'vespera' ? 'Amanhã' : 'Daqui a pouco'} · ${x.perfil_nome.split(' ')[0]}`,
          texto: [x.titulo, x.momento === 'vespera' ? `${dia}, às ${hora}` : `Hoje às ${hora}`, x.local]
            .filter(Boolean).join('\n'),
          url: './#/agenda',
          tag: `evento-${x.evento_id}-${x.momento}`
        }));
      }
    }

    // ---------------- Remédios ----------------
    const { data: pendentes, error } = await admin.rpc('lembretes_pendentes');
    if (error) return responder(500, { erro: error.message });

    if (pendentes?.length) {
      const { data: reservados, error: e2 } = await admin.from('notificacoes_enviadas')
        .upsert((pendentes as Dose[]).map((p) => ({
          horario_id: p.horario_id, previsto_para: p.previsto_para, usuario_id: p.usuario_id
        })), { onConflict: 'horario_id,previsto_para,usuario_id', ignoreDuplicates: true })
        .select('horario_id, previsto_para, usuario_id');
      if (e2) return responder(500, { erro: e2.message });
      const chave = (x: { horario_id: string; previsto_para: string; usuario_id: string }) =>
        `${x.horario_id}|${new Date(x.previsto_para).getTime()}|${x.usuario_id}`;
      const ok = new Set((reservados || []).map(chave));
      const aEnviar = (pendentes as Dose[]).filter((p) => ok.has(chave(p)));

      // Uma notificação por pessoa + perfil + horário, com todos os remédios daquele horário
      const grupos = new Map<string, { usuario_id: string; perfil_id: string; perfil_nome: string; previsto: string; itens: string[] }>();
      for (const p of aEnviar) {
        const k = `${p.usuario_id}|${p.perfil_id}|${new Date(p.previsto_para).getTime()}`;
        if (!grupos.has(k)) grupos.set(k, { usuario_id: p.usuario_id, perfil_id: p.perfil_id, perfil_nome: p.perfil_nome, previsto: p.previsto_para, itens: [] });
        grupos.get(k)!.itens.push(p.dose ? `${p.medicamento} (${p.dose})` : p.medicamento);
      }
      const aps = await aparelhosDe([...new Set([...grupos.values()].map((g) => g.usuario_id))]);
      for (const g of grupos.values()) {
        await enviar(aps, g.usuario_id, JSON.stringify({
          titulo: `Hora do remédio · ${g.perfil_nome.split(' ')[0]}`,
          texto: g.itens.join('\n'),
          url: './#/hoje',
          tag: `dose-${g.perfil_id}-${new Date(g.previsto).getTime()}`
        }));
      }
    }

    if (apagar.length) await admin.from('push_inscricoes').delete().in('id', apagar);
    // de hora em hora, aproveita para apagar registros antigos
    if (new Date().getUTCMinutes() === 0) await admin.rpc('limpar_notificacoes_antigas');

    return responder(200, { enviados, removidos: apagar.length });
  } catch (e) {
    return responder(500, { erro: (e as Error).message || 'Erro inesperado.' });
  }
});
