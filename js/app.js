// CRIS — app principal (etapa 1: login, perfis)
import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.getElementById('app');

// Estado da sessão
const estado = {
  sessao: null,
  eu: null,            // linha da tabela usuarios
  delegados: [],       // ids de usuários sob minha responsabilidade (sub-master)
  emailPendente: null  // e-mail aguardando o código
};

// ======================================================================
// Utilitários
// ======================================================================
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function aviso(texto) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('visivel'), 2600);
}

function idade(dataNasc) {
  if (!dataNasc) return null;
  const n = new Date(dataNasc + 'T12:00:00');
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a--;
  return a;
}

function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Cor da "tarja" de cada perfil, sempre a mesma para o mesmo perfil
const CORES = ['#2F6F62', '#3B5B8C', '#8A4F7D', '#A0522D', '#5B7A2E', '#6A5ACD', '#9C3D54', '#2E7D8C'];
function corDoPerfil(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

function mensagemErro(e) {
  const m = e?.message || String(e);
  if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para fazer isso.';
  if (/Signups not allowed|not allowed for otp|User not found/i.test(m)) return 'Este e-mail não foi convidado para o CRIS. Peça um convite a quem administra o app.';
  if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) return 'Código inválido ou vencido. Peça um novo código.';
  if (/rate limit|security purposes/i.test(m)) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.';
  return m;
}

function ocupado(botao, sim, texto) {
  if (!botao) return;
  if (sim) { botao.dataset.texto = botao.textContent; botao.textContent = texto || 'Aguarde…'; botao.disabled = true; }
  else { botao.textContent = botao.dataset.texto || botao.textContent; botao.disabled = false; }
}

function mostrarErro(form, msg) {
  let el = form.querySelector('.erro');
  if (!el) { el = document.createElement('div'); el.className = 'erro'; el.setAttribute('role', 'alert'); form.prepend(el); }
  el.textContent = msg;
}

// ======================================================================
// Permissões (espelham as regras do banco, só para decidir o que mostrar)
// ======================================================================
function acessoAoPerfil(p, compart) {
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

// ======================================================================
// Rotas
// ======================================================================
const rotas = [
  [/^#?\/?$/, telaInicio],
  [/^#\/perfil\/novo$/, () => telaFormPerfil(null)],
  [/^#\/perfil\/([0-9a-f-]{36})$/, (m) => telaPerfil(m[1])],
  [/^#\/perfil\/([0-9a-f-]{36})\/editar$/, (m) => telaFormPerfil(m[1])],
  [/^#\/conta$/, telaConta]
];

async function navegar() {
  if (!estado.sessao) return telaEntrar();
  if (!estado.eu) await carregarEu();
  if (!estado.eu) return telaSemCadastro();
  if (!estado.eu.nome) return telaBoasVindas();

  const hash = location.hash || '#/';
  for (const [re, fn] of rotas) {
    const m = hash.match(re);
    if (m) { window.scrollTo(0, 0); return fn(m); }
  }
  location.hash = '#/';
}

async function carregarEu() {
  const uid = estado.sessao.user.id;
  const { data, error } = await sb.from('usuarios').select('*').eq('id', uid).maybeSingle();
  if (error) { console.error(error); return; }
  estado.eu = data;
  if (data?.papel === 'submaster') {
    const { data: d } = await sb.from('delegacoes').select('usuario_id').eq('submaster_id', uid);
    estado.delegados = (d || []).map((x) => x.usuario_id);
  } else {
    estado.delegados = [];
  }
}

// ======================================================================
// Tela: entrar (código por e-mail)
// ======================================================================
function telaEntrar() {
  const pedindoCodigo = !!estado.emailPendente;
  app.innerHTML = `
    <section class="entrada">
      <p class="marca-grande">CRIS</p>
      <div class="tarja-entrada" aria-hidden="true"></div>
      <p class="subtitulo">Remédios, médicos e vacinas da família, num só lugar.</p>

      ${pedindoCodigo ? `
        <form id="form-codigo" novalidate>
          <p>Enviamos um código para <strong>${esc(estado.emailPendente)}</strong>. Ele chega em até um minuto; confira também o spam.</p>
          <div class="campo">
            <label for="codigo">Código recebido</label>
            <input id="codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="10" required autofocus>
          </div>
          <div class="botoes">
            <button class="botao principal" type="submit">Entrar</button>
            <button class="botao discreto" type="button" id="trocar-email">Usar outro e-mail</button>
          </div>
        </form>
      ` : `
        <form id="form-email" novalidate>
          <div class="campo">
            <label for="email">Seu e-mail</label>
            <input id="email" type="email" inputmode="email" autocomplete="email" required autofocus>
            <span class="ajuda">Você recebe um código para entrar. Não precisa de senha.</span>
          </div>
          <div class="botoes">
            <button class="botao principal" type="submit">Enviar código</button>
          </div>
        </form>
      `}

      <p class="homenagem">Feito em homenagem a Cristina.</p>
    </section>`;

  if (pedindoCodigo) {
    const form = document.getElementById('form-codigo');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const token = form.codigo.value.replace(/\D/g, '');
      if (token.length < 6) return mostrarErro(form, 'Digite o código completo que chegou no e-mail.');
      const b = form.querySelector('[type=submit]');
      ocupado(b, true, 'Entrando…');
      const { error } = await sb.auth.verifyOtp({ email: estado.emailPendente, token, type: 'email' });
      ocupado(b, false);
      if (error) return mostrarErro(form, mensagemErro(error));
      estado.emailPendente = null;
      try { sessionStorage.removeItem('cris-email'); } catch {}
    });
    document.getElementById('trocar-email').onclick = () => {
      estado.emailPendente = null;
      try { sessionStorage.removeItem('cris-email'); } catch {}
      telaEntrar();
    };
  } else {
    const form = document.getElementById('form-email');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = form.email.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarErro(form, 'Digite um e-mail válido.');
      const b = form.querySelector('[type=submit]');
      ocupado(b, true, 'Enviando…');
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      ocupado(b, false);
      if (error) return mostrarErro(form, mensagemErro(error));
      estado.emailPendente = email;
      try { sessionStorage.setItem('cris-email', email); } catch {}
      telaEntrar();
    });
  }
}

function telaSemCadastro() {
  app.innerHTML = `
    <section class="entrada">
      <p class="marca-grande">CRIS</p>
      <div class="tarja-entrada" aria-hidden="true"></div>
      <p>Seu login funcionou, mas seu cadastro no CRIS não foi encontrado. Peça a quem administra o app para conferir o convite.</p>
      <div class="botoes"><button class="botao secundario" id="sair">Sair</button></div>
    </section>`;
  document.getElementById('sair').onclick = sair;
}

// ======================================================================
// Tela: boas-vindas (primeiro acesso, pede o nome)
// ======================================================================
function telaBoasVindas() {
  app.innerHTML = `
    <section class="entrada">
      <p class="marca-grande">CRIS</p>
      <div class="tarja-entrada" aria-hidden="true"></div>
      <form id="form-nome" novalidate>
        <h1>Boas-vindas</h1>
        <p class="subtitulo">Como a família te chama? Esse nome aparece quando você altera algum dado.</p>
        <div class="campo">
          <label for="nome">Seu nome</label>
          <input id="nome" autocomplete="name" required autofocus>
        </div>
        <div class="botoes"><button class="botao principal" type="submit">Continuar</button></div>
      </form>
    </section>`;
  const form = document.getElementById('form-nome');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) return mostrarErro(form, 'Digite seu nome.');
    const b = form.querySelector('[type=submit]');
    ocupado(b, true);
    const { error } = await sb.from('usuarios').update({ nome }).eq('id', estado.eu.id);
    ocupado(b, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    estado.eu.nome = nome;
    navegar();
  });
}

// ======================================================================
// Tela: início (lista de perfis)
// ======================================================================
async function telaInicio() {
  app.innerHTML = `
    <header class="topo">
      <span class="marca">CRIS</span>
      <a class="botao discreto" href="#/conta">Minha conta</a>
    </header>
    <div class="carregando" style="padding-top:20vh">Carregando perfis…</div>`;

  const [{ data: perfis, error }, { data: compart }] = await Promise.all([
    sb.from('perfis').select('id, nome, data_nascimento, tipo_sanguineo, dono_id, usuario_vinculado_id').order('nome'),
    sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id)
  ]);
  if (error) {
    app.querySelector('.carregando').outerHTML = `<div class="erro">${esc(mensagemErro(error))}</div>`;
    return;
  }

  const eu = estado.eu;
  const meus = [], cuidados = [], compartilhados = [], outros = [];
  for (const p of perfis) {
    p.acesso = acessoAoPerfil(p, compart || []);
    if (p.dono_id === eu.id || p.usuario_vinculado_id === eu.id) meus.push(p);
    else if (p.acesso.rotulo === 'Sob seus cuidados') cuidados.push(p);
    else if ((compart || []).some((c) => c.perfil_id === p.id)) compartilhados.push(p);
    else outros.push(p);
  }
  // O perfil da própria pessoa vem primeiro
  meus.sort((a, b) => (b.usuario_vinculado_id === eu.id) - (a.usuario_vinculado_id === eu.id));

  const ficha = (p) => {
    const i = idade(p.data_nascimento);
    const detalhes = [i !== null ? `${i} anos` : null, p.tipo_sanguineo].filter(Boolean).join(', ');
    const selo = p.usuario_vinculado_id === eu.id ? '<span class="selo">Você</span>'
      : p.acesso.nivel === 'ver' && p.acesso.rotulo ? `<span class="selo">${esc(p.acesso.rotulo)}</span>` : '';
    return `
      <li>
        <a class="ficha" href="#/perfil/${p.id}" style="--cor-perfil:${corDoPerfil(p.id)}">
          <span class="tarja" aria-hidden="true"></span>
          <span class="conteudo">
            <span class="nome">${esc(p.nome)}${selo}</span>
            ${detalhes ? `<span class="detalhe">${esc(detalhes)}</span>` : ''}
          </span>
          <span class="seta" aria-hidden="true">›</span>
        </a>
      </li>`;
  };
  const grupo = (titulo, lista) => lista.length ? `
    <section class="grupo">
      <h2>${titulo}</h2>
      <ul class="fichas">${lista.map(ficha).join('')}</ul>
    </section>` : '';

  app.innerHTML = `
    <header class="topo">
      <span class="marca">CRIS</span>
      <a class="botao discreto" href="#/conta">Minha conta</a>
    </header>

    <div class="saudacao">
      <h1>Olá, ${esc(primeiroNome(eu.nome))}</h1>
      ${eu.papel === 'master' ? '<p>Você é master: vê e edita todos os perfis.</p>' : ''}
      ${eu.papel === 'submaster' ? '<p>Você é sub-master: cuida dos perfis das pessoas sob sua responsabilidade.</p>' : ''}
    </div>

    ${perfis.length === 0 ? `
      <div class="vazio">
        <p><strong>Nenhum perfil ainda.</strong></p>
        <p>Comece pelo seu próprio perfil ou pelo de alguém que você acompanha.</p>
      </div>` : ''}

    ${grupo('Meus perfis', meus)}
    ${grupo('Sob seus cuidados', cuidados)}
    ${grupo('Compartilhados com você', compartilhados)}
    ${grupo('Outros perfis da família', outros)}

    <div class="botoes">
      <a class="botao principal" href="#/perfil/novo">Novo perfil</a>
    </div>`;
}

// ======================================================================
// Tela: perfil
// ======================================================================
async function telaPerfil(id) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const [{ data: p, error }, { data: compart }] = await Promise.all([
    sb.from('perfis').select('*').eq('id', id).maybeSingle(),
    sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id).eq('perfil_id', id)
  ]);
  if (error || !p) {
    app.innerHTML = `
      <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
      <div class="erro">${error ? esc(mensagemErro(error)) : 'Perfil não encontrado ou sem acesso.'}</div>`;
    return;
  }
  const acesso = acessoAoPerfil(p, compart || []);
  const podeEditar = acesso.nivel === 'editar' || acesso.nivel === 'gerenciar';
  const i = idade(p.data_nascimento);

  const linha = (rotulo, valor) => valor ? `<dt>${rotulo}</dt><dd>${valor}</dd>` : '';
  const tel = (t) => t ? `<a class="ligar" href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>` : '';

  const textoAcesso = {
    gerenciar: '',
    editar: 'Você pode consultar e editar este perfil.',
    ver: 'Você pode consultar este perfil e registrar doses tomadas.'
  }[acesso.nivel];

  app.innerHTML = `
    <header class="topo">
      <a class="voltar" href="#/">‹ Perfis</a>
      ${podeEditar ? `<a class="botao discreto" href="#/perfil/${p.id}/editar">Editar</a>` : ''}
    </header>

    <section class="cabeca-perfil" style="--cor-perfil:${corDoPerfil(p.id)}">
      <div class="tarja-larga">
        <h1>${esc(p.nome)}</h1>
        <p>${p.data_nascimento ? `Nascimento: ${dataBR(p.data_nascimento)}` : 'Data de nascimento não informada'}</p>
      </div>
      <dl class="resumo">
        <div><dt>Idade</dt><dd>${i !== null ? `${i} anos` : '—'}</dd></div>
        <div><dt>Tipo sanguíneo</dt><dd>${esc(p.tipo_sanguineo) || '—'}</dd></div>
      </dl>
    </section>

    ${textoAcesso ? `<p class="acesso">${textoAcesso}</p>` : ''}

    <ul class="secoes" aria-label="Seções do perfil">
      <li><strong>Medicamentos</strong><span class="em-breve">próxima etapa</span></li>
      <li><strong>Alergias</strong><span class="em-breve">próxima etapa</span></li>
      <li><strong>Condições de saúde</strong><span class="em-breve">próxima etapa</span></li>
      <li><strong>Médicos</strong><span class="em-breve">próxima etapa</span></li>
      <li><strong>Vacinas</strong><span class="em-breve">próxima etapa</span></li>
    </ul>

    ${(p.contato_emergencia_nome || p.contato_emergencia_telefone) ? `
      <section class="bloco">
        <h2>Contato de emergência</h2>
        <dl>
          ${linha('Nome', esc(p.contato_emergencia_nome))}
          ${linha('Telefone', tel(p.contato_emergencia_telefone))}
        </dl>
      </section>` : ''}

    ${(p.plano_saude || p.observacoes) ? `
      <section class="bloco">
        <h2>Outras informações</h2>
        <dl>
          ${linha('Plano de saúde', esc(p.plano_saude))}
          ${linha('Observações', esc(p.observacoes).replace(/\n/g, '<br>'))}
        </dl>
      </section>` : ''}
  `;
}

// ======================================================================
// Tela: criar / editar perfil
// ======================================================================
async function telaFormPerfil(id) {
  let p = {};
  let podeGerenciar = true;
  const eu = estado.eu;

  if (id) {
    app.innerHTML = `<div class="carregando">Carregando…</div>`;
    const { data, error } = await sb.from('perfis').select('*').eq('id', id).maybeSingle();
    if (error || !data) { location.hash = '#/'; return; }
    p = data;
    const { data: compart } = await sb.from('compartilhamentos').select('perfil_id, nivel')
      .eq('usuario_id', eu.id).eq('perfil_id', id);
    const acesso = acessoAoPerfil(p, compart || []);
    if (acesso.nivel === 'ver') { location.hash = `#/perfil/${id}`; return; }
    podeGerenciar = acesso.nivel === 'gerenciar';
  }

  // "Este perfil é meu": só aparece se a pessoa ainda não tem perfil vinculado
  const { data: jaVinculado } = await sb.from('perfis').select('id').eq('usuario_vinculado_id', eu.id).maybeSingle();
  const mostrarVinculo = !id ? !jaVinculado : (p.usuario_vinculado_id === eu.id || (!p.usuario_vinculado_id && !jaVinculado && p.dono_id === eu.id));

  const tipos = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const voltar = id ? `#/perfil/${id}` : '#/';

  app.innerHTML = `
    <header class="topo">
      <a class="voltar" href="${voltar}">‹ Cancelar</a>
    </header>
    <h1 style="margin-bottom:20px">${id ? 'Editar perfil' : 'Novo perfil'}</h1>

    <form id="form-perfil" novalidate>
      <div class="campo">
        <label for="nome">Nome completo</label>
        <input id="nome" name="nome" required value="${esc(p.nome)}" autocomplete="off">
      </div>

      ${mostrarVinculo ? `
        <label class="marcar">
          <input type="checkbox" name="meu" ${p.usuario_vinculado_id === eu.id ? 'checked' : ''}>
          <span><strong>Este perfil é meu</strong><br>
          <span class="ajuda" style="display:inline">Marque se os dados são seus. Deixe desmarcado para o perfil de alguém que você acompanha.</span></span>
        </label>` : ''}

      <div class="linha-dupla">
        <div class="campo">
          <label for="nasc">Nascimento</label>
          <input id="nasc" name="data_nascimento" type="date" value="${esc(p.data_nascimento)}">
        </div>
        <div class="campo">
          <label for="sangue">Tipo sanguíneo</label>
          <select id="sangue" name="tipo_sanguineo">
            <option value="">Não sei</option>
            ${tipos.map((t) => `<option ${p.tipo_sanguineo === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>

      <fieldset>
        <legend>Contato de emergência</legend>
        <div class="campo">
          <label for="ce-nome">Nome</label>
          <input id="ce-nome" name="contato_emergencia_nome" value="${esc(p.contato_emergencia_nome)}">
        </div>
        <div class="campo">
          <label for="ce-tel">Telefone</label>
          <input id="ce-tel" name="contato_emergencia_telefone" type="tel" inputmode="tel" value="${esc(p.contato_emergencia_telefone)}">
        </div>
      </fieldset>

      <fieldset>
        <legend>Outras informações</legend>
        <div class="campo">
          <label for="plano">Plano de saúde</label>
          <input id="plano" name="plano_saude" value="${esc(p.plano_saude)}" placeholder="Ex.: Unimed, carteirinha 1234…">
        </div>
        <div class="campo">
          <label for="obs">Observações</label>
          <textarea id="obs" name="observacoes">${esc(p.observacoes)}</textarea>
        </div>
      </fieldset>

      <div class="botoes">
        <button class="botao principal" type="submit">${id ? 'Salvar alterações' : 'Criar perfil'}</button>
        ${id && podeGerenciar ? '<button class="botao perigo" type="button" id="excluir">Excluir perfil</button>' : ''}
      </div>
    </form>`;

  const form = document.getElementById('form-perfil');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const dados = {
      nome: f.get('nome').trim(),
      data_nascimento: f.get('data_nascimento') || null,
      tipo_sanguineo: f.get('tipo_sanguineo') || null,
      contato_emergencia_nome: f.get('contato_emergencia_nome').trim() || null,
      contato_emergencia_telefone: f.get('contato_emergencia_telefone').trim() || null,
      plano_saude: f.get('plano_saude').trim() || null,
      observacoes: f.get('observacoes').trim() || null
    };
    if (!dados.nome) return mostrarErro(form, 'Digite o nome.');
    if (mostrarVinculo) dados.usuario_vinculado_id = f.get('meu') ? eu.id : null;

    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    let res;
    if (id) {
      res = await sb.from('perfis').update(dados).eq('id', id).select('id').single();
    } else {
      dados.dono_id = eu.id;
      res = await sb.from('perfis').insert(dados).select('id').single();
    }
    ocupado(b, false);
    if (res.error) return mostrarErro(form, mensagemErro(res.error));
    aviso(id ? 'Alterações salvas' : 'Perfil criado');
    location.hash = `#/perfil/${res.data.id}`;
  });

  const excluir = document.getElementById('excluir');
  if (excluir) excluir.onclick = async () => {
    const ok = confirm(`Excluir o perfil de ${p.nome}? Todos os dados dele serão apagados e isso não pode ser desfeito.`);
    if (!ok) return;
    ocupado(excluir, true, 'Excluindo…');
    const { error } = await sb.from('perfis').delete().eq('id', id);
    ocupado(excluir, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    aviso('Perfil excluído');
    location.hash = '#/';
  };
}

// ======================================================================
// Tela: minha conta
// ======================================================================
function telaConta() {
  const eu = estado.eu;
  const papel = { master: 'Master', submaster: 'Sub-master', membro: 'Membro da família' }[eu.papel];
  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
    <h1 style="margin-bottom:20px">Minha conta</h1>

    <form id="form-conta" class="bloco" novalidate>
      <div class="campo">
        <label for="nome">Seu nome</label>
        <input id="nome" required value="${esc(eu.nome)}" autocomplete="name">
      </div>
      <dl>
        <dt>E-mail</dt><dd>${esc(eu.email)}</dd>
        <dt>Tipo de acesso</dt><dd>${papel}</dd>
      </dl>
      <div class="botoes"><button class="botao principal" type="submit">Salvar nome</button></div>
    </form>

    <div class="botoes"><button class="botao secundario" id="sair">Sair do CRIS</button></div>`;

  const form = document.getElementById('form-conta');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) return mostrarErro(form, 'Digite seu nome.');
    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    const { error } = await sb.from('usuarios').update({ nome }).eq('id', eu.id);
    ocupado(b, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    eu.nome = nome;
    aviso('Nome salvo');
  });
  document.getElementById('sair').onclick = sair;
}

async function sair() {
  await sb.auth.signOut();
  estado.eu = null;
  location.hash = '#/';
}

// ======================================================================
// Início do app
// ======================================================================
try { estado.emailPendente = sessionStorage.getItem('cris-email'); } catch {}

sb.auth.onAuthStateChange((evento, sessao) => {
  const antes = estado.sessao?.user?.id || null;
  estado.sessao = sessao;
  // INITIAL_SESSION: abertura do app. Depois, só redesenha se a pessoa entrou ou saiu.
  if (evento === 'INITIAL_SESSION' || antes !== (sessao?.user?.id || null)) {
    estado.eu = null;
    setTimeout(navegar, 0);
  }
});

window.addEventListener('hashchange', navegar);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
