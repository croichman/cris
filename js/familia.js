// CRIS — família: convites, papéis, responsabilidades e compartilhamento de perfis
import { sb, app, estado, esc, aviso, dataBR, primeiroNome, mensagemErro, ocupado, mostrarErro } from './base.js';

const PAPEIS = { master: 'Master', submaster: 'Sub-master', membro: 'Membro' };
const DESC_PAPEL = {
  master: 'Vê e edita todos os perfis da família, define papéis e remove acessos.',
  submaster: 'Vê e edita os perfis das pessoas sob sua responsabilidade e pode convidar.',
  membro: 'Vê e edita os próprios perfis e os que forem compartilhados com ele.'
};

const nomeOuEmail = (u) => u?.nome || u?.email || 'Alguém';

// Chama a função "familia" no servidor e devolve a mensagem de erro em português
export async function chamarFuncao(corpo) {
  const { data, error } = await sb.functions.invoke('familia', { body: corpo });
  if (!error) return { ok: true, data };
  let msg = error.message;
  try {
    const j = await error.context.json();
    if (j?.erro) msg = j.erro;
  } catch { /* mantém a mensagem original */ }
  if (/Failed to send a request|Failed to fetch|not found|404/i.test(msg))
    msg = 'A função de convites ainda não está instalada no Supabase. Veja o passo a passo da etapa 3.';
  return { ok: false, erro: msg };
}

function formConvite(titulo, ajuda) {
  return `
    <section class="bloco">
      <h2>${titulo}</h2>
      <p class="acesso">${ajuda}</p>
      <form id="form-convite" novalidate>
        <div class="campo"><label for="conv-nome">Nome</label>
          <input id="conv-nome" name="nome" autocomplete="off" placeholder="Como a família chama"></div>
        <div class="campo"><label for="conv-email">E-mail</label>
          <input id="conv-email" name="email" type="email" inputmode="email" autocomplete="off" required></div>
        <button class="botao principal" type="submit">Enviar convite</button>
      </form>
    </section>`;
}

function ligarConvite(depois) {
  const form = document.getElementById('form-convite');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    const nome = form.nome.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarErro(form, 'Digite um e-mail válido.');
    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Enviando…');
    const r = await chamarFuncao({ acao: 'convidar', email, nome });
    ocupado(b, false);
    if (!r.ok) return mostrarErro(form, r.erro);
    aviso(`Convite enviado para ${email}`);
    depois();
  });
}

// ======================================================================
// Tela Família (masters e sub-masters)
// ======================================================================
export async function telaFamilia() {
  const eu = estado.eu;
  if (eu.papel === 'membro') { location.hash = '#/'; return; }
  app.innerHTML = `<div class="carregando">Carregando…</div>`;

  const [{ data: usuarios, error }, { data: delegacoes }, { data: aceites }] = await Promise.all([
    sb.from('usuarios').select('id, nome, email, papel, criado_em').order('nome'),
    sb.from('delegacoes').select('submaster_id, usuario_id'),
    sb.from('termo_aceites').select('usuario_id, aceito_em')
  ]);
  if (error) {
    app.innerHTML = `<header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
      <div class="erro">${esc(mensagemErro(error))}</div>`;
    return;
  }
  const aceitou = Object.fromEntries((aceites || []).map((a) => [a.usuario_id, a.aceito_em]));
  const porId = Object.fromEntries(usuarios.map((u) => [u.id, u]));
  const situacao = (u) => aceitou[u.id]
    ? `Entrou no CRIS em ${dataBR(aceitou[u.id].slice(0, 10))}`
    : 'Convite enviado, ainda não entrou';

  // ---------- Sub-master: só as pessoas sob sua responsabilidade
  if (eu.papel === 'submaster') {
    const meus = (delegacoes || []).filter((d) => d.submaster_id === eu.id).map((d) => porId[d.usuario_id]).filter(Boolean);
    app.innerHTML = `
      <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
      <h1 style="margin-bottom:6px">Família</h1>
      <p class="acesso">Você é sub-master: cuida dos perfis das pessoas abaixo e pode convidar novos familiares.
        Quem você convida fica automaticamente sob a sua responsabilidade.</p>
      <section class="bloco">
        <h2>Sob a sua responsabilidade</h2>
        ${meus.length ? `<ul class="pessoas">${meus.map((u) => `
          <li><span class="pessoa-nome">${esc(nomeOuEmail(u))}</span>
            <span class="med-quando">${esc(u.email)}</span>
            <span class="med-quando">${situacao(u)}</span></li>`).join('')}</ul>`
        : '<p class="acesso">Ninguém ainda.</p>'}
      </section>
      ${formConvite('Convidar familiar', 'A pessoa recebe um e-mail com as instruções para entrar.')}`;
    ligarConvite(telaFamilia);
    return;
  }

  // ---------- Master: todos
  const submasters = usuarios.filter((u) => u.papel === 'submaster');
  const responsaveis = (uid) => (delegacoes || []).filter((d) => d.usuario_id === uid)
    .map((d) => nomeOuEmail(porId[d.submaster_id]));

  const cartao = (u) => {
    const souEu = u.id === eu.id;
    const sob = (delegacoes || []).filter((d) => d.submaster_id === u.id).map((d) => d.usuario_id);
    const resp = responsaveis(u.id);
    return `
      <li class="pessoa" data-id="${u.id}">
        <div class="pessoa-topo">
          <div>
            <span class="pessoa-nome">${esc(nomeOuEmail(u))}${souEu ? '<span class="selo">Você</span>' : ''}</span>
            <span class="med-quando">${esc(u.email)}</span>
            <span class="med-quando">${situacao(u)}</span>
            ${resp.length ? `<span class="med-quando">Sob responsabilidade de ${esc(resp.join(', '))}</span>` : ''}
          </div>
        </div>
        <div class="campo campo-papel">
          <label for="papel-${u.id}">Tipo de acesso</label>
          <select id="papel-${u.id}" class="mudar-papel" data-id="${u.id}">
            ${Object.entries(PAPEIS).map(([k, v]) => `<option value="${k}" ${u.papel === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <span class="ajuda">${DESC_PAPEL[u.papel]}</span>
        </div>
        ${u.papel === 'submaster' ? `
          <fieldset class="responsavel">
            <legend>Responsável por</legend>
            ${usuarios.filter((o) => o.id !== u.id && o.papel !== 'master').map((o) => `
              <label class="marcar-simples">
                <input type="checkbox" class="delegar" data-sub="${u.id}" data-usuario="${o.id}" ${sob.includes(o.id) ? 'checked' : ''}>
                ${esc(nomeOuEmail(o))}
              </label>`).join('') || '<p class="acesso">Não há outros membros.</p>'}
          </fieldset>` : ''}
        ${!souEu ? `<button class="botao discreto remover-acesso" data-id="${u.id}" data-nome="${esc(nomeOuEmail(u))}">Remover acesso</button>` : ''}
      </li>`;
  };

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
    <h1 style="margin-bottom:6px">${esc(estado.familia || 'Família')}</h1>
    <p class="acesso">${usuarios.length} ${usuarios.length === 1 ? 'pessoa da família tem' : 'pessoas da família têm'} acesso ao CRIS.
      ${submasters.length ? '' : 'Para dar a alguém a responsabilidade por outros familiares, mude o tipo de acesso dele para sub-master.'}</p>

    ${formConvite('Convidar familiar', 'A pessoa recebe um e-mail com as instruções para entrar. Ela começa como membro: depois você pode mudar o tipo de acesso.')}

    <section class="grupo">
      <h2>Pessoas com acesso</h2>
      <ul class="pessoas">${usuarios.map(cartao).join('')}</ul>
    </section>

    <form id="form-nome-familia" class="bloco" novalidate>
      <h2>Nome da família</h2>
      <div class="campo"><label for="nome-familia">Como a família aparece no app</label>
        <input id="nome-familia" name="nome" maxlength="80" value="${esc(estado.familia || '')}"></div>
      <button class="botao secundario" type="submit">Salvar nome</button>
    </form>`;

  ligarConvite(telaFamilia);

  const formNome = document.getElementById('form-nome-familia');
  formNome.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = formNome.nome.value.trim();
    if (!nome) return mostrarErro(formNome, 'Digite o nome da família.');
    const b = formNome.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    const { error: e } = await sb.from('familias').update({ nome }).eq('id', eu.familia_id);
    ocupado(b, false);
    if (e) return mostrarErro(formNome, mensagemErro(e));
    estado.familia = nome;
    aviso('Nome da família salvo');
    telaFamilia();
  });

  app.querySelectorAll('.mudar-papel').forEach((sel) => sel.onchange = async () => {
    const u = porId[sel.dataset.id];
    const novo = sel.value;
    if (novo === 'master' && !confirm(`Tornar ${nomeOuEmail(u)} master? Masters veem e editam todos os perfis da família.`)) {
      sel.value = u.papel; return;
    }
    if (u.id === eu.id && novo !== 'master' && !confirm('Você vai deixar de ser master e perder o acesso a esta tela. Continuar?')) {
      sel.value = u.papel; return;
    }
    sel.disabled = true;
    const { error: e } = await sb.from('usuarios').update({ papel: novo }).eq('id', u.id);
    if (e) { sel.disabled = false; sel.value = u.papel; return aviso(/pelo menos um master/i.test(e.message) ? 'É preciso manter pelo menos um master.' : mensagemErro(e)); }
    aviso(`${primeiroNome(nomeOuEmail(u))} agora é ${PAPEIS[novo].toLowerCase()}`);
    if (u.id === eu.id) { estado.eu.papel = novo; location.hash = '#/'; return; }
    telaFamilia();
  });

  app.querySelectorAll('.delegar').forEach((cb) => cb.onchange = async () => {
    cb.disabled = true;
    const par = { submaster_id: cb.dataset.sub, usuario_id: cb.dataset.usuario };
    const { error: e } = cb.checked
      ? await sb.from('delegacoes').insert({ ...par, criado_por: eu.id })
      : await sb.from('delegacoes').delete().eq('submaster_id', par.submaster_id).eq('usuario_id', par.usuario_id);
    cb.disabled = false;
    if (e) { cb.checked = !cb.checked; return aviso(mensagemErro(e)); }
    aviso(cb.checked ? 'Responsabilidade adicionada' : 'Responsabilidade removida');
  });

  app.querySelectorAll('.remover-acesso').forEach((b) => b.onclick = async () => {
    const ok = confirm(`Remover o acesso de ${b.dataset.nome}?\n\nA pessoa não conseguirá mais entrar. Os perfis que ela cadastrou continuam no CRIS e passam a ser seus. Se ela pediu a exclusão dos dados, exclua também esses perfis.`);
    if (!ok) return;
    ocupado(b, true, 'Removendo…');
    const r = await chamarFuncao({ acao: 'remover', usuario_id: b.dataset.id });
    ocupado(b, false);
    if (!r.ok) return aviso(r.erro);
    aviso('Acesso removido');
    telaFamilia();
  });
}

// ======================================================================
// Bloco "Compartilhamento" na página do perfil (quem gerencia o perfil)
// ======================================================================
export async function blocoCompartilhamento(p) {
  const [{ data: usuarios }, { data: compart, error }] = await Promise.all([
    sb.from('usuarios').select('id, nome, email, papel').order('nome'),
    sb.from('compartilhamentos').select('id, usuario_id, nivel').eq('perfil_id', p.id)
  ]);
  if (error) return `<div class="erro">${esc(mensagemErro(error))}</div>`;
  const porId = Object.fromEntries((usuarios || []).map((u) => [u.id, u]));
  const masters = (usuarios || []).filter((u) => u.papel === 'master');
  const jaTem = new Set([p.dono_id, p.usuario_vinculado_id, ...compart.map((c) => c.usuario_id), ...masters.map((m) => m.id)]);
  const disponiveis = (usuarios || []).filter((u) => !jaTem.has(u.id));

  const automaticos = [
    porId[p.dono_id] && `${nomeOuEmail(porId[p.dono_id])} (cadastrou o perfil)`,
    p.usuario_vinculado_id && porId[p.usuario_vinculado_id] && p.usuario_vinculado_id !== p.dono_id &&
      `${nomeOuEmail(porId[p.usuario_vinculado_id])} (a própria pessoa)`,
    ...masters.filter((m) => m.id !== p.dono_id && m.id !== p.usuario_vinculado_id).map((m) => `${nomeOuEmail(m)} (master)`)
  ].filter(Boolean);

  return `
    <section class="bloco" id="compartilhamento">
      <h2>Quem tem acesso</h2>
      <p class="acesso">Com acesso completo: ${esc(automaticos.join(', '))}.</p>
      ${compart.length ? `
        <ul class="pessoas compacta">
          ${compart.map((c) => `
            <li>
              <span class="pessoa-nome">${esc(nomeOuEmail(porId[c.usuario_id]))}</span>
              <div class="linha-acesso">
                <select class="nivel" data-id="${c.id}" aria-label="Nível de acesso">
                  <option value="ver" ${c.nivel === 'ver' ? 'selected' : ''}>Só consulta</option>
                  <option value="editar" ${c.nivel === 'editar' ? 'selected' : ''}>Pode editar</option>
                </select>
                <button class="botao discreto tirar" data-id="${c.id}">Remover</button>
              </div>
            </li>`).join('')}
        </ul>` : ''}
      ${disponiveis.length ? `
        <form id="form-compart" novalidate>
          <div class="campo"><label for="compart-quem">Compartilhar com</label>
            <select id="compart-quem" name="usuario_id">
              <option value="">Escolha um familiar</option>
              ${disponiveis.map((u) => `<option value="${u.id}">${esc(nomeOuEmail(u))}</option>`).join('')}
            </select></div>
          <div class="campo"><label for="compart-nivel">Pode</label>
            <select id="compart-nivel" name="nivel">
              <option value="ver">Só consultar e registrar doses</option>
              <option value="editar">Consultar e editar</option>
            </select></div>
          <button class="botao secundario" type="submit">Compartilhar</button>
        </form>` : `<p class="acesso">Todos os familiares cadastrados já têm acesso a este perfil.</p>`}
    </section>`;
}

export function ligarCompartilhamento(perfil_id, recarregar) {
  const caixa = document.getElementById('compartilhamento');
  if (!caixa) return;
  caixa.querySelectorAll('.nivel').forEach((sel) => sel.onchange = async () => {
    sel.disabled = true;
    const { error } = await sb.from('compartilhamentos').update({ nivel: sel.value }).eq('id', sel.dataset.id);
    sel.disabled = false;
    if (error) return aviso(mensagemErro(error));
    aviso('Acesso atualizado');
  });
  caixa.querySelectorAll('.tirar').forEach((b) => b.onclick = async () => {
    if (!confirm('Remover o acesso desta pessoa a este perfil?')) return;
    ocupado(b, true, 'Removendo…');
    const { error } = await sb.from('compartilhamentos').delete().eq('id', b.dataset.id);
    if (error) { ocupado(b, false); return aviso(mensagemErro(error)); }
    aviso('Compartilhamento removido');
    recarregar();
  });
  const form = document.getElementById('form-compart');
  if (form) form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const usuario_id = form.usuario_id.value;
    if (!usuario_id) return mostrarErro(form, 'Escolha com quem compartilhar.');
    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Compartilhando…');
    const { error } = await sb.from('compartilhamentos').insert({ perfil_id, usuario_id, nivel: form.nivel.value, criado_por: estado.eu.id });
    ocupado(b, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    aviso('Perfil compartilhado');
    recarregar();
  });
}
