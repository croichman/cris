// CRIS — botão de emergência da tela inicial
// Usa o contato de emergência do perfil da própria pessoa. Fica guardado no aparelho
// para funcionar também sem internet (ligar e SMS não dependem de internet).
import { esc, primeiroNome } from './base.js';
import { formatarTelefone } from './contatos.js';

const CHAVE = 'cris-sos';
const SAMU = '192';

export function guardarContatoSOS(perfil, usuarioId) {
  try {
    if (!perfil) { localStorage.removeItem(CHAVE); return; }
    localStorage.setItem(CHAVE, JSON.stringify({
      usuario: usuarioId,
      perfilId: perfil.id,
      pessoa: perfil.nome,
      nome: perfil.contato_emergencia_nome || '',
      telefone: perfil.contato_emergencia_telefone || ''
    }));
  } catch {}
}

export function contatoSOSGuardado() {
  try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; }
}

// HTML do botão. Sem contato cadastrado, vira um convite para cadastrar.
export function botaoSOS(sos, { linkCadastro } = {}) {
  if (sos?.telefone) {
    return `
      <button class="botao-sos" id="botao-sos" type="button">
        <span class="sos-icone" aria-hidden="true">SOS</span>
        <span><strong>Emergência</strong><br>
          <span class="sos-detalhe">Chamar ${esc(primeiroNome(sos.nome) || 'contato de emergência')}</span></span>
      </button>`;
  }
  if (!linkCadastro) return '';
  return `
    <a class="botao-sos sem-contato" href="${linkCadastro}">
      <span class="sos-icone" aria-hidden="true">SOS</span>
      <span><strong>Cadastre um contato de emergência</strong><br>
        <span class="sos-detalhe">Para chamar alguém com um toque, numa emergência.</span></span>
    </a>`;
}

const soDigitos = (t) => String(t || '').replace(/\D/g, '');

function mensagem(sos, local) {
  return [
    `EMERGÊNCIA: ${sos.pessoa} precisa de ajuda. Por favor, entre em contato com urgência.`,
    local ? `Localização aproximada: https://maps.google.com/?q=${local.lat},${local.lng}` : '',
    '(Mensagem enviada pelo CRIS)'
  ].filter(Boolean).join('\n');
}

function links(sos, local) {
  const d = soDigitos(sos.telefone);
  const internacional = d.length <= 11 ? '55' + d.replace(/^0/, '') : d;
  const texto = encodeURIComponent(mensagem(sos, local));
  return {
    ligar: `tel:${String(sos.telefone).replace(/[^\d+]/g, '')}`,
    whatsapp: `https://wa.me/${internacional}?text=${texto}`,
    sms: `sms:${String(sos.telefone).replace(/[^\d+]/g, '')}?body=${texto}`
  };
}

// Liga o botão à janela de opções
export function ativarBotaoSOS(sos) {
  const b = document.getElementById('botao-sos');
  if (!b || !sos?.telefone) return;
  b.onclick = () => abrirJanelaSOS(sos);
}

function abrirJanelaSOS(sos) {
  const dlg = document.createElement('dialog');
  dlg.className = 'janela janela-sos';
  const l = links(sos, null);
  const semDDD = soDigitos(sos.telefone).length < 10;
  dlg.innerHTML = `
    <h2>Emergência</h2>
    <p class="acesso" style="margin-top:0">Contato de emergência de ${esc(primeiroNome(sos.pessoa))}:
      <strong>${esc(sos.nome || 'sem nome')}</strong> · ${esc(formatarTelefone(sos.telefone))}</p>
    <div class="sos-opcoes">
      <a class="botao sos-ligar" id="sos-ligar" href="${l.ligar}">Ligar para ${esc(primeiroNome(sos.nome) || 'o contato')}</a>
      <a class="botao secundario" id="sos-whats" href="${l.whatsapp}" target="_blank" rel="noopener">Mandar mensagem no WhatsApp</a>
      <a class="botao secundario" id="sos-sms" href="${l.sms}">Mandar mensagem por SMS</a>
      <p class="ajuda" id="sos-local">Buscando sua localização para incluir na mensagem…</p>
      ${semDDD ? '<p class="ajuda">O número está sem DDD: o WhatsApp pode não encontrar o contato.</p>' : ''}
      <a class="botao secundario" href="tel:${SAMU}">Ligar 192 (SAMU)</a>
      <button class="botao discreto" type="button" id="sos-fechar">Fechar</button>
    </div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('#sos-fechar').onclick = () => dlg.close();
  dlg.showModal();

  // Localização: se vier a tempo, entra na mensagem; se não, a mensagem vai sem ela
  const info = dlg.querySelector('#sos-local');
  if (!('geolocation' in navigator)) { info.textContent = 'A mensagem vai sem localização.'; return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    if (!dlg.isConnected) return;
    const local = { lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) };
    const n = links(sos, local);
    dlg.querySelector('#sos-whats').href = n.whatsapp;
    dlg.querySelector('#sos-sms').href = n.sms;
    info.textContent = 'Sua localização será incluída na mensagem.';
  }, () => {
    if (dlg.isConnected) info.textContent = 'Localização indisponível: a mensagem vai sem ela.';
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
}
