// CRIS — app principal: login, perfis, conta e rotas
import {
  sb, app, estado, esc, aviso, idade, dataBR, corDoPerfil, primeiroNome, mensagemErro,
  ocupado, mostrarErro, acessoAoPerfil
} from './base.js';
import {
  blocoMedicamentos, telaListaMedicamentos, telaMedicamento, telaFormMedicamento, telaHoje, resumoDoDia
} from './medicamentos.js';
import { VERSAO_APP } from './config.js';
import { telaTermo, telaVerTermo, carregarAceite } from './termo.js';
import { telaFamilia, blocoCompartilhamento, ligarCompartilhamento } from './familia.js';
import { blocoItens, telaFormItem, blocoMedicos, telaFormMedico } from './saude.js';
import { telaAdmin } from './admin.js';
import { telaQuadro } from './quadro.js';
import { telaNotificacoes } from './notificacoes.js';
import { telaFicha, atualizarFichas, htmlFichasOffline, fichasSalvas, apagarFichasSalvas } from './emergencia.js';

// ======================================================================
// Rotas
// ======================================================================
const rotas = [
  [/^#?\/?$/, telaInicio],
  [/^#\/perfil\/novo$/, () => telaFormPerfil(null)],
  [/^#\/perfil\/([0-9a-f-]{36})$/, (m) => telaPerfil(m[1])],
  [/^#\/perfil\/([0-9a-f-]{36})\/editar$/, (m) => telaFormPerfil(m[1])],
  [/^#\/conta$/, telaConta],
  [/^#\/hoje$/, telaHoje],
  [/^#\/termo$/, telaVerTermo],
  [/^#\/familia$/, telaFamilia],
  [/^#\/admin$/, telaAdmin],
  [/^#\/notificacoes$/, telaNotificacoes],
  [/^#\/perfil\/([0-9a-f-]{36})\/quadro$/, (m) => telaQuadro(m[1])],
  [/^#\/ficha\/([0-9a-f-]{36})$/, (m) => telaFicha(m[1])],
  [/^#\/perfil\/([0-9a-f-]{36})\/(alergia|condicao|vacina)\/novo$/, (m) => telaFormItem(m[2], m[1], null)],
  [/^#\/(alergia|condicao|vacina)\/([0-9a-f-]{36})$/, (m) => telaFormItem(m[1], null, m[2])],
  [/^#\/perfil\/([0-9a-f-]{36})\/medico\/novo$/, (m) => telaFormMedico(m[1], null)],
  [/^#\/perfil\/([0-9a-f-]{36})\/medico\/([0-9a-f-]{36})$/, (m) => telaFormMedico(m[1], m[2])],
  [/^#\/perfil\/([0-9a-f-]{36})\/medicamentos$/, (m) => telaListaMedicamentos(m[1])],
  [/^#\/perfil\/([0-9a-f-]{36})\/medicamento\/novo$/, (m) => telaFormMedicamento(m[1], null)],
  [/^#\/medicamento\/([0-9a-f-]{36})$/, (m) => telaMedicamento(m[1])],
  [/^#\/medicamento\/([0-9a-f-]{36})\/editar$/, (m) => telaFormMedicamento(null, m[1])]
];

async function navegar() {
  const fichaOffline = (location.hash || '').match(/^#\/ficha\/([0-9a-f-]{36})$/);
  if (!estado.sessao && fichaOffline) return telaFicha(fichaOffline[1]);
  if (!estado.sessao) return telaEntrar();
  if (!estado.eu) await carregarEu();
  if (!estado.eu) return telaSemCadastro();
  if (!estado.termoAceitoEm) return telaTermo(navegar, sair);
  if (!estado.eu.nome) return telaBoasVindas();
  if (!estado.offline) gravarLocal('cris-eu', { eu: estado.eu, termoAceitoEm: estado.termoAceitoEm, delegados: estado.delegados, familia: estado.familia });

  const hash = location.hash || '#/';
  for (const [re, fn] of rotas) {
    const m = hash.match(re);
    if (m) { window.scrollTo(0, 0); return fn(m); }
  }
  location.hash = '#/';
}

async function carregarEu() {
  const uid = estado.sessao.user.id;
  const salvoAntes = lerLocal('cris-eu');
  if (!navigator.onLine && salvoAntes?.eu?.id === uid) {
    Object.assign(estado, salvoAntes, { offline: true });
    return;
  }
  const { data, error } = await sb.from('usuarios').select('*').eq('id', uid).maybeSingle();
  if (error) {
    console.error(error);
    // Sem internet: usa os dados da última vez, para a ficha de emergência continuar acessível
    const salvo = lerLocal('cris-eu');
    if (/fetch|network|load failed/i.test(error.message) && salvo?.eu?.id === uid) {
      Object.assign(estado, salvo, { offline: true });
      return;
    }
    estado.erroEu = error.message;
    return;
  }
  estado.erroEu = null;
  estado.offline = false;
  estado.eu = data;
  if (data) await carregarAceite(uid);
  if (data?.familia_id) {
    const { data: f } = await sb.from('familias').select('nome').eq('id', data.familia_id).maybeSingle();
    estado.familia = f?.nome || '';
  }
  if (data?.papel === 'submaster') {
    const { data: d } = await sb.from('delegacoes').select('usuario_id').eq('submaster_id', uid);
    estado.delegados = (d || []).map((x) => x.usuario_id);
  } else {
    estado.delegados = [];
  }
  if (data) gravarLocal('cris-eu', { eu: data, termoAceitoEm: estado.termoAceitoEm, delegados: estado.delegados, familia: estado.familia });
}

function lerLocal(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function gravarLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } }

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

      ${!navigator.onLine ? htmlFichasOffline() : ''}
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
      ${estado.erroEu ? `<p class="acesso">Detalhe técnico: ${esc(estado.erroEu)}</p>` : ''}
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
  if (!navigator.onLine) {
    app.innerHTML = `
      <header class="topo"><span class="marca">CRIS</span></header>
      <p class="aviso-offline">Sem internet. As fichas de emergência salvas neste aparelho continuam disponíveis.</p>
      ${htmlFichasOffline() || '<p class="acesso">Nenhuma ficha salva neste aparelho ainda.</p>'}`;
    return;
  }
  app.innerHTML = `
    <header class="topo">
      <span class="marca">CRIS</span>
      <a class="botao discreto" href="#/conta">Minha conta</a>
    </header>
    <div class="carregando" style="padding-top:20vh">Carregando perfis…</div>`;

  const [{ data: perfis, error }, { data: compart }] = await Promise.all([
    sb.from('perfis').select('id, nome, data_nascimento, tipo_sanguineo, dono_id, usuario_vinculado_id, fuso_horario').order('nome'),
    sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id)
  ]);
  if (error) {
    app.querySelector('.carregando').outerHTML = `<div class="erro">${esc(mensagemErro(error))}</div>${htmlFichasOffline()}`;
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

  const resumo = await resumoDoDia(perfis);

  // Mantém as fichas de emergência de quem a pessoa acompanha salvas no aparelho (no máximo a cada 6 horas)
  const acompanhados = [...meus, ...cuidados, ...compartilhados];
  const ultima = Number(lerLocal('cris-fichas-em') || 0);
  if (acompanhados.length && Date.now() - ultima > 6 * 3600000) {
    gravarLocal('cris-fichas-em', Date.now());
    setTimeout(() => atualizarFichas(acompanhados), 1500);
  }
  let textoResumo = '';
  if (resumo) {
    const partes = [];
    if (resumo.atrasadas) partes.push(`${resumo.atrasadas} ${resumo.atrasadas === 1 ? 'atrasada' : 'atrasadas'}`);
    if (resumo.pendentes) partes.push(`${resumo.pendentes} ${resumo.pendentes === 1 ? 'próxima' : 'próximas'}`);
    textoResumo = partes.length ? partes.join(', ') : 'Todas as doses de hoje foram registradas';
  }

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
      ${estado.familia ? `<p>${esc(estado.familia)}</p>` : ''}
      ${eu.papel === 'master' ? '<p>Você é master: vê e edita todos os perfis da família. <a href="#/familia">Família e acessos</a></p>' : ''}
      ${eu.papel === 'submaster' ? '<p>Você é sub-master: cuida dos perfis das pessoas sob sua responsabilidade. <a href="#/familia">Família e convites</a></p>' : ''}
      ${eu.admin_sistema ? '<p><a href="#/admin">Administração do sistema</a></p>' : ''}
    </div>

    ${resumo ? `
      <a class="cartao-hoje ${resumo.atrasadas ? 'com-atraso' : ''}" href="#/hoje">
        <span class="conteudo">
          <span class="nome">Doses de hoje</span>
          <span class="detalhe">${esc(textoResumo)}</span>
        </span>
        <span class="seta" aria-hidden="true">›</span>
      </a>` : ''}

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

    <a class="botao-ficha" href="#/ficha/${p.id}">
      <span><strong>Ficha de emergência</strong><br>
      <span class="detalhe">O essencial para um atendimento. Abre mesmo sem internet.</span></span>
      <span class="seta" aria-hidden="true">›</span>
    </a>

    <div id="bloco-alergia"></div>
    <div id="bloco-meds"><div class="bloco"><p class="acesso">Carregando…</p></div></div>
    <div id="bloco-condicao"></div>
    <div id="bloco-medicos"></div>
    <div id="bloco-vacina"></div>

    <div id="bloco-compart"></div>

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
  const [html, htmlCompart, hAlergia, hCondicao, hMedicos, hVacina] = await Promise.all([
    blocoMedicamentos(p.id, podeEditar),
    acesso.nivel === 'gerenciar' ? blocoCompartilhamento(p) : Promise.resolve(''),
    blocoItens('alergia', p.id, podeEditar),
    blocoItens('condicao', p.id, podeEditar),
    blocoMedicos(p.id, podeEditar),
    blocoItens('vacina', p.id, podeEditar)
  ]);
  if (!location.hash.endsWith(p.id)) return; // a pessoa já saiu desta tela
  const por = (idEl, h) => { const el = document.getElementById(idEl); if (el) el.innerHTML = h; };
  por('bloco-meds', html);
  por('bloco-alergia', hAlergia);
  por('bloco-condicao', hCondicao);
  por('bloco-medicos', hMedicos);
  por('bloco-vacina', hVacina);
  const alvoC = document.getElementById('bloco-compart');
  if (alvoC && htmlCompart) {
    alvoC.innerHTML = htmlCompart;
    ligarCompartilhamento(p.id, () => telaPerfil(id));
  }
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
  const mostrarVinculo = !id ? !jaVinculado : false;

  // Ao editar, quem gerencia o perfil escolhe o login da pessoa (ex.: a mãe passou a usar o CRIS)
  let opcoesLogin = null;
  if (id && podeGerenciar) {
    const [{ data: usuarios }, { data: vinculados }] = await Promise.all([
      sb.from('usuarios').select('id, nome, email').order('nome'),
      sb.from('perfis').select('id, usuario_vinculado_id').not('usuario_vinculado_id', 'is', null)
    ]);
    const ocupados = new Set((vinculados || []).filter((x) => x.id !== id).map((x) => x.usuario_vinculado_id));
    opcoesLogin = (usuarios || []).filter((u) => !ocupados.has(u.id));
  }

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

      ${opcoesLogin ? `
        <div class="campo">
          <label for="login">Login desta pessoa no CRIS</label>
          <select id="login" name="login">
            <option value="">Não usa o CRIS</option>
            ${opcoesLogin.map((u) => `<option value="${u.id}" ${p.usuario_vinculado_id === u.id ? 'selected' : ''}>${esc(u.nome || u.email)}${u.id === eu.id ? ' (você)' : ''}</option>`).join('')}
          </select>
          <span class="ajuda">Quando a própria pessoa usa o app, ligue o perfil ao login dela: ela passa a ver e editar estes dados.</span>
        </div>` : ''}

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
    if (opcoesLogin) dados.usuario_vinculado_id = f.get('login') || null;

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
        ${estado.familia ? `<dt>Família</dt><dd>${esc(estado.familia)}</dd>` : ''}
        <dt>Tipo de acesso</dt><dd>${papel}${eu.admin_sistema ? ' · administrador do sistema' : ''}</dd>
        <dt>Termo de consentimento</dt>
        <dd>Aceito em ${new Date(estado.termoAceitoEm).toLocaleDateString('pt-BR')}.
          <a href="#/termo">Ler o termo</a></dd>
        <dt>Versão do app</dt><dd>CRIS ${esc(VERSAO_APP)}</dd>
      </dl>
      <div class="botoes"><button class="botao principal" type="submit">Salvar nome</button></div>
    </form>

    <a class="botao-ficha" href="#/notificacoes">
      <span><strong>Notificações</strong><br>
      <span class="detalhe">Lembretes de remédio no celular, na hora de cada dose.</span></span>
      <span class="seta" aria-hidden="true">›</span>
    </a>

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
  apagarFichasSalvas();
  estado.sessao = null;
  try { await sb.auth.signOut(); } catch { /* sem internet: a sessão local é apagada mesmo assim */ }
  apagarFichasSalvas();
  try { localStorage.removeItem('cris-eu'); } catch { /* nada */ }
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
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // procura versão nova sempre que o app volta para a tela
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    })
    .catch(() => {});
  // quando a versão nova assume, recarrega uma vez para mostrar as novidades
  let recarregou = false;
  const tinhaControle = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tinhaControle && !recarregou) { recarregou = true; location.reload(); }
  });
}
