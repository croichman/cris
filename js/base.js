// CRIS — base comum: conexão, estado, utilitários e permissões
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export const app = document.getElementById('app');

// Estado da sessão
export const estado = {
  sessao: null,
  eu: null,            // linha da tabela usuarios
  delegados: [],       // ids de usuários sob minha responsabilidade (sub-master)
  emailPendente: null  // e-mail aguardando o código
};

// ======================================================================
// Utilitários
// ======================================================================
export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function aviso(texto) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('visivel'), 2600);
}

export function idade(dataNasc) {
  if (!dataNasc) return null;
  const n = new Date(dataNasc + 'T12:00:00');
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
  return a;
}

export function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Cor da "tarja" de cada perfil, sempre a mesma para o mesmo perfil
export const CORES = ['#2F6F62', '#3B5B8C', '#8A4F7D', '#A0522D', '#5B7A2E', '#6A5ACD', '#9C3D54', '#2E7D8C'];
export function corDoPerfil(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}

export function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

export function mensagemErro(e) {
  const m = e?.message || String(e);
  if (/usuario_vinculado_id/i.test(m) && /duplicate|unique/i.test(m)) return 'Esse login já está ligado a outro perfil.';
  if (/compartilhamentos/i.test(m) && /duplicate|unique/i.test(m)) return 'Este perfil já está compartilhado com essa pessoa.';
  if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para fazer isso.';
  if (/Signups not allowed|not allowed for otp|User not found/i.test(m)) return 'Este e-mail não foi convidado para o CRIS. Peça um convite a quem administra o app.';
  if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) return 'Código inválido ou vencido. Peça um novo código.';
  if (/rate limit|security purposes/i.test(m)) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.';
  return m;
}

export function ocupado(botao, sim, texto) {
  if (!botao) return;
  if (sim) { botao.dataset.texto = botao.textContent; botao.textContent = texto || 'Aguarde…'; botao.disabled = true; }
  else { botao.textContent = botao.dataset.texto || botao.textContent; botao.disabled = false; }
}

export function mostrarErro(form, msg) {
  let el = form.querySelector('.erro');
  if (!el) { el = document.createElement('div'); el.className = 'erro'; el.setAttribute('role', 'alert'); form.prepend(el); }
  el.textContent = msg;
}

// ======================================================================
// Permissões (espelham as regras do banco, só para decidir o que mostrar)
// ======================================================================
export function acessoAoPerfil(p, compart) {
  const eu = estado.eu;
  if (!eu) return null;
  if (p.dono_id === eu.id || p.usuario_vinculado_id === eu.id) return { nivel: 'gerenciar', rotulo: p.usuario_vinculado_id === eu.id ? 'Você' : 'Seu' };
  if (eu.papel === 'master') return { nivel: 'gerenciar', rotulo: 'Master' };
  if (eu.papel === 'submaster' &&
      (estado.delegados.includes(p.dono_id) || estado.delegados.includes(p.usuario_vinculado_id)))
    return { nivel: 'editar', rotulo: 'Sob seus cuidados' };
  const c = compart.find((x) => x.perfil_id === p.id);
  if (c) return { nivel: c.nivel, rotulo: c.nivel === 'editar' ? 'Pode editar' : 'Só consulta' };
  return { nivel: 'ver', rotulo: '' };
}


export const podeEditarNivel = (nivel) => nivel === 'editar' || nivel === 'gerenciar';

// Carrega um perfil e calcula o meu acesso a ele
export async function perfilComAcesso(id, campos = '*') {
  const [{ data: p, error }, { data: compart }] = await Promise.all([
    sb.from('perfis').select(campos).eq('id', id).maybeSingle(),
    sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id).eq('perfil_id', id)
  ]);
  if (error || !p) return { erro: error ? mensagemErro(error) : 'Perfil não encontrado ou sem acesso.' };
  const acesso = acessoAoPerfil(p, compart || []);
  return { p, acesso, podeEditar: podeEditarNivel(acesso.nivel) };
}

// Mensagem de erro de dado repetido (ex.: dose já registrada por outra pessoa)
export const ehDuplicado = (e) => e?.code === '23505' || /duplicate key/i.test(e?.message || '');

// ======================================================================
// Datas e fuso horário
// ======================================================================
export const FUSO_PADRAO = 'America/Recife';

function deslocamentoMin(fuso, data) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(data).map((x) => [x.type, x.value]));
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUTC - Math.floor(data.getTime() / 1000) * 1000) / 60000);
}

// Dia de hoje ("AAAA-MM-DD") no fuso informado
export function hojeNoFuso(fuso = FUSO_PADRAO, quando = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(quando);
}

// Instante exato de um horário ("08:00") num dia ("AAAA-MM-DD") e fuso
export function instante(fuso, ymd, hhmm) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const palpite = Date.UTC(y, m - 1, d, h, mi);
  const o1 = deslocamentoMin(fuso, new Date(palpite));
  let t = palpite - o1 * 60000;
  const o2 = deslocamentoMin(fuso, new Date(t));
  if (o2 !== o1) t = palpite - o2 * 60000;
  return new Date(t);
}

export function diaDaSemana(ymd) {
  return new Date(ymd + 'T12:00:00Z').getUTCDay();
}

export const hhmm = (hora) => String(hora || '').slice(0, 5);

export function horaLocal(data, fuso = FUSO_PADRAO) {
  return new Date(data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso });
}

export function dataHoraCurta(data, fuso = FUSO_PADRAO) {
  const d = new Date(data);
  const dia = hojeNoFuso(fuso, d);
  const hoje = hojeNoFuso(fuso);
  const ontem = hojeNoFuso(fuso, new Date(Date.now() - 86400000));
  const rotulo = dia === hoje ? 'Hoje' : dia === ontem ? 'Ontem' : dataBR(dia);
  return `${rotulo}, ${horaLocal(d, fuso)}`;
}

// Valor para <input type="datetime-local"> no fuso do perfil ("AAAA-MM-DDTHH:MM")
export function campoDataHora(data, fuso = FUSO_PADRAO) {
  const d = new Date(data);
  return `${hojeNoFuso(fuso, d)}T${horaLocal(d, fuso)}`;
}

// Janela para escolher quando a dose foi tomada. Devolve um Date, ou null se cancelar.
export function pedirHorario({ titulo = 'Quando foi tomado?', texto = '', padrao = new Date(), fuso = FUSO_PADRAO } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'janela';
    dlg.innerHTML = `
      <form novalidate>
        <h2>${esc(titulo)}</h2>
        ${texto ? `<p class="acesso">${esc(texto)}</p>` : ''}
        <div class="campo">
          <label for="quando-tomou">Data e hora em que tomou</label>
          <input id="quando-tomou" name="quando" type="datetime-local" required
            value="${campoDataHora(padrao, fuso)}" max="${campoDataHora(new Date(), fuso)}">
        </div>
        <div class="botoes">
          <button class="botao principal" type="submit">Registrar</button>
          <button class="botao secundario" type="button" data-cancelar>Cancelar</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    let resposta = null;
    const form = dlg.querySelector('form');
    dlg.addEventListener('close', () => { dlg.remove(); resolve(resposta); });
    dlg.querySelector('[data-cancelar]').onclick = () => dlg.close();
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const [ymd, hm] = (form.quando.value || '').split('T');
      if (!ymd || !hm) return mostrarErro(form, 'Informe a data e a hora.');
      const quando = instante(fuso, ymd, hm.slice(0, 5));
      if (quando.getTime() > Date.now() + 60000) return mostrarErro(form, 'O horário não pode estar no futuro.');
      resposta = quando;
      dlg.close();
    });
    dlg.showModal();
  });
}

export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function descreverDias(dias) {
  const d = [...(dias || [])].map(Number).sort();
  if (d.length === 7) return 'todos os dias';
  if (d.join() === '1,2,3,4,5') return 'de segunda a sexta';
  if (d.join() === '0,6') return 'fins de semana';
  return d.map((x) => DIAS_CURTOS[x]).join(', ');
}

// ======================================================================
// Nomes dos familiares (para mostrar quem registrou)
// ======================================================================
let cacheNomes = null;
export async function nomesUsuarios() {
  if (cacheNomes) return cacheNomes;
  const { data } = await sb.from('usuarios').select('id, nome');
  cacheNomes = Object.fromEntries((data || []).map((u) => [u.id, u.nome || 'Alguém']));
  return cacheNomes;
}

// ======================================================================
// Fotos
// ======================================================================
export const BUCKET = 'cris-arquivos';

// Reduz a foto (celulares geram arquivos enormes) e converte para JPEG
export async function comprimirImagem(arquivo, max = 1600) {
  try {
    const bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    return blob || arquivo;
  } catch {
    return arquivo;
  }
}

export async function enviarFoto(perfilId, arquivo) {
  const blob = await comprimirImagem(arquivo);
  const caminho = `${perfilId}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return caminho;
}

export async function apagarFotos(caminhos) {
  const lista = caminhos.filter(Boolean);
  if (lista.length) await sb.storage.from(BUCKET).remove(lista).catch(() => {});
}

export async function linksDasFotos(caminhos) {
  const lista = caminhos.filter(Boolean);
  if (!lista.length) return {};
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(lista, 3600);
  return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}
