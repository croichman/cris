// CRIS — notificações (lembretes de remédio no celular/computador)
// Duas escolhas independentes:
//   1) este aparelho recebe notificações?  (push_inscricoes)
//   2) de quais perfis eu quero lembretes?  (lembrete_destinatarios)
// Quem envia é a função "lembretes" no servidor, a cada minuto.
import { sb, app, estado, esc, aviso, mensagemErro, ocupado } from './base.js';
import { VAPID_PUBLIC_KEY } from './config.js';

const temSuporte = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function chaveParaBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function descreverAparelho() {
  const ua = navigator.userAgent;
  const so = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) || ehIOS() ? 'iPad' : /android/i.test(ua) ? 'Android'
    : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Aparelho';
  const nav = /edg\//i.test(ua) ? 'Edge' : /samsungbrowser/i.test(ua) ? 'Samsung Internet' : /firefox/i.test(ua) ? 'Firefox'
    : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  return [so, nav].filter(Boolean).join(' · ');
}

// O service worker pode demorar (ou nunca ficar pronto, ex.: navegação privada)
function registro(ms = 5000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('O app ainda está terminando de instalar. Feche, abra de novo e tente outra vez.')), ms))
  ]);
}

async function inscricaoAtual() {
  if (!temSuporte()) return null;
  const reg = await registro(3000);
  return reg.pushManager.getSubscription();
}

async function ativar() {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    throw new Error('As notificações foram bloqueadas. Libere nas configurações do navegador ou do celular e tente de novo.');
  }
  const reg = await registro();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(VAPID_PUBLIC_KEY) });
  }
  const j = sub.toJSON();
  const { error } = await sb.rpc('registrar_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: descreverAparelho()
  });
  if (error) throw error;
}

async function desativar() {
  const sub = await inscricaoAtual();
  if (!sub) return;
  await sb.from('push_inscricoes').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

export async function telaNotificacoes() {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;

  const sub = await inscricaoAtual().catch(() => null);
  const [{ data: perfis, error }, { data: escolhidos }, { data: aparelhos }] = await Promise.all([
    sb.from('perfis').select('id, nome, usuario_vinculado_id').order('nome'),
    sb.from('lembrete_destinatarios').select('perfil_id').eq('usuario_id', estado.eu.id),
    sb.from('push_inscricoes').select('id, endpoint, dispositivo, criado_em').eq('usuario_id', estado.eu.id).order('criado_em')
  ]);
  if (error) {
    app.innerHTML = `<header class="topo"><a class="voltar" href="#/conta">‹ Minha conta</a></header>
      <div class="erro">${esc(mensagemErro(error))}</div>`;
    return;
  }
  const marcados = new Set((escolhidos || []).map((x) => x.perfil_id));
  const esteAtivo = !!sub && (aparelhos || []).some((a) => a.endpoint === sub.endpoint);
  const bloqueado = temSuporte() && Notification.permission === 'denied';

  let blocoAparelho;
  if (!temSuporte() && ehIOS() && !instalado()) {
    blocoAparelho = `
      <p>No iPhone, as notificações só funcionam com o CRIS instalado na tela de início:</p>
      <ol class="passos">
        <li>Abra o CRIS no <strong>Safari</strong>.</li>
        <li>Toque em <strong>Compartilhar</strong> (o quadrado com a seta para cima).</li>
        <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
        <li>Abra o CRIS pelo ícone novo e volte a esta tela.</li>
      </ol>`;
  } else if (!temSuporte()) {
    blocoAparelho = `<p>Este navegador não recebe notificações. No celular, use o Chrome (Android) ou o CRIS instalado na tela de início (iPhone).</p>`;
  } else if (bloqueado) {
    blocoAparelho = `
      <p><strong>As notificações do CRIS estão bloqueadas neste aparelho.</strong></p>
      <p class="acesso">Para liberar: nas configurações do navegador (ou do celular, em Notificações), procure o CRIS
        ou o site croichman.github.io e permita as notificações. Depois volte aqui.</p>`;
  } else {
    blocoAparelho = esteAtivo ? `
      <p class="estado-ok">Este aparelho está recebendo lembretes.</p>
      <div class="botoes">
        <button class="botao secundario" id="testar">Mostrar notificação de teste</button>
        <button class="botao discreto" id="desativar">Desativar neste aparelho</button>
      </div>` : `
      <p>Ative para receber um aviso na hora de cada dose, mesmo com o app fechado.</p>
      <div class="botoes"><button class="botao principal" id="ativar">Ativar notificações neste aparelho</button></div>`;
  }

  const outros = (aparelhos || []).filter((a) => !sub || a.endpoint !== sub.endpoint);

  app.innerHTML = `
    <header class="topo"><a class="voltar" id="voltar-notif" href="#/conta">‹ Voltar</a></header>
    <h1 style="margin-bottom:6px">Doses e lembretes</h1>
    <p class="acesso">Escolha de quem você acompanha as doses e se quer receber avisos no celular. Se a dose já tiver
      sido registrada (por você ou por outra pessoa), o aviso não é enviado.</p>

    <section class="bloco">
      <h2>Este aparelho</h2>
      ${blocoAparelho}
    </section>

    <section class="bloco">
      <h2>Quais avisos receber</h2>
      <label class="marcar"><input type="checkbox" id="pref-remedios" ${estado.eu.avisar_remedios !== false ? 'checked' : ''}>
        <span><strong>Horários de remédio</strong></span></label>
      <label class="marcar"><input type="checkbox" id="pref-agenda" ${estado.eu.avisar_agenda !== false ? 'checked' : ''}>
        <span><strong>Compromissos da agenda</strong><br>
        <span class="ajuda" style="display:inline">Na véspera às 19h e antes do horário (como definido em cada compromisso).</span></span></label>
    </section>

    <section class="bloco">
      <h2>Acompanhar</h2>
      <p class="acesso">Os perfis marcados aparecem em "Doses de hoje" e na agenda da tela inicial, e geram avisos nos seus aparelhos com
        notificações ativas. ${!marcados.size ? 'Enquanto você não marcar nenhum, "Doses de hoje" mostra só o seu perfil.' : ''}</p>
      ${perfis.length ? `<div class="opcoes">${perfis.map((p) => `
        <label class="marcar">
          <input type="checkbox" class="perfil-lembrete" value="${p.id}" ${marcados.has(p.id) ? 'checked' : ''}>
          <span><strong>${esc(p.nome)}</strong>${p.usuario_vinculado_id === estado.eu.id ? ' <span class="ajuda" style="display:inline">(você)</span>' : ''}</span>
        </label>`).join('')}</div>` : '<p class="acesso">Nenhum perfil disponível.</p>'}
      <p class="acesso" style="margin-top:12px">Para não receber avisos de um remédio específico, desmarque
        "Enviar lembretes" no cadastro dele.</p>
    </section>

    ${outros.length ? `
      <section class="bloco">
        <h2>Outros aparelhos com notificações</h2>
        <ul class="pessoas">${outros.map((a) => `
          <li><span class="pessoa-nome">${esc(a.dispositivo || 'Aparelho')}</span>
            <span class="med-quando">Ativado em ${new Date(a.criado_em).toLocaleDateString('pt-BR')}</span>
            <button class="botao discreto remover-aparelho" data-id="${a.id}">Remover</button></li>`).join('')}</ul>
      </section>` : ''}`;

  // Volta para onde a pessoa estava (Doses de hoje ou Minha conta)
  document.getElementById('voltar-notif').onclick = (ev) => {
    if (history.length > 1) { ev.preventDefault(); history.back(); }
  };

  const bAtivar = document.getElementById('ativar');
  if (bAtivar) bAtivar.onclick = async () => {
    ocupado(bAtivar, true, 'Ativando…');
    try {
      await ativar();
      // Primeira vez: já marca o próprio perfil, se houver
      if (!marcados.size) {
        const meu = perfis.find((p) => p.usuario_vinculado_id === estado.eu.id);
        if (meu) await sb.from('lembrete_destinatarios').insert({ perfil_id: meu.id, usuario_id: estado.eu.id });
      }
      aviso('Notificações ativadas');
    } catch (e) {
      ocupado(bAtivar, false);
      return aviso(mensagemErro(e));
    }
    telaNotificacoes();
  };

  const bDesativar = document.getElementById('desativar');
  if (bDesativar) bDesativar.onclick = async () => {
    ocupado(bDesativar, true, 'Desativando…');
    await desativar().catch(() => {});
    aviso('Notificações desativadas neste aparelho');
    telaNotificacoes();
  };

  const bTestar = document.getElementById('testar');
  if (bTestar) bTestar.onclick = async () => {
    const reg = await registro();
    await reg.showNotification('CRIS · teste', {
      body: 'Assim aparece o lembrete na hora de cada dose.', icon: 'icons/icone-192.png', badge: 'icons/icone-192.png', tag: 'teste'
    });
  };

  for (const [idEl, campo] of [['pref-remedios', 'avisar_remedios'], ['pref-agenda', 'avisar_agenda']]) {
    const c = document.getElementById(idEl);
    c.onchange = async () => {
      c.disabled = true;
      const { error: e } = await sb.from('usuarios').update({ [campo]: c.checked }).eq('id', estado.eu.id);
      c.disabled = false;
      if (e) { c.checked = !c.checked; return aviso(mensagemErro(e)); }
      estado.eu[campo] = c.checked;
      aviso(c.checked ? 'Avisos ligados' : 'Avisos desligados');
    };
  }

  app.querySelectorAll('.perfil-lembrete').forEach((c) => c.onchange = async () => {
    c.disabled = true;
    const { error: e } = c.checked
      ? await sb.from('lembrete_destinatarios').insert({ perfil_id: c.value, usuario_id: estado.eu.id })
      : await sb.from('lembrete_destinatarios').delete().eq('perfil_id', c.value).eq('usuario_id', estado.eu.id);
    c.disabled = false;
    if (e && !/duplicate/i.test(e.message)) { c.checked = !c.checked; aviso(mensagemErro(e)); }
    else aviso(c.checked ? 'Você passou a acompanhar este perfil' : 'Você deixou de acompanhar este perfil');
  });

  app.querySelectorAll('.remover-aparelho').forEach((b) => b.onclick = async () => {
    ocupado(b, true, 'Removendo…');
    const { error: e } = await sb.from('push_inscricoes').delete().eq('id', b.dataset.id);
    if (e) { ocupado(b, false); return aviso(mensagemErro(e)); }
    telaNotificacoes();
  });
}
