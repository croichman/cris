// CRIS — agenda: consultas, exames, retornos, vacinas e outros compromissos de saúde
// Avisos: véspera às 19h e X minutos antes (enviados pela função "lembretes" no servidor),
// para quem acompanha o perfil (mesma escolha de "Doses e lembretes").
import {
  sb, app, estado, esc, aviso, dataBR, primeiroNome, mensagemErro, ocupado, mostrarErro,
  corDoPerfil, acessoAoPerfil, perfilComAcesso, FUSO_PADRAO, hojeNoFuso, instante, horaLocal
} from './base.js';
import { perfisAcompanhados } from './medicamentos.js';

export const TIPOS_EVENTO = {
  consulta: 'Consulta', exame: 'Exame', retorno: 'Retorno', vacina: 'Vacina',
  procedimento: 'Procedimento ou cirurgia', terapia: 'Terapia ou sessão', outro: 'Outro'
};
const OPCOES_ANTES = { '': 'Não avisar', 30: '30 minutos antes', 60: '1 hora antes', 120: '2 horas antes', 180: '3 horas antes', 1440: '1 dia antes' };

// "Hoje", "Amanhã" ou "qua, 26/11"
export function rotuloDia(inicio, fuso = FUSO_PADRAO) {
  const dia = hojeNoFuso(fuso, new Date(inicio));
  const hoje = hojeNoFuso(fuso);
  const amanha = hojeNoFuso(fuso, new Date(Date.now() + 86400000));
  if (dia === hoje) return 'Hoje';
  if (dia === amanha) return 'Amanhã';
  const sem = new Date(inicio).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: fuso }).replace('.', '');
  return `${sem}, ${dataBR(dia).slice(0, 5)}${dia.slice(0, 4) !== hoje.slice(0, 4) ? '/' + dia.slice(0, 4) : ''}`;
}

const descricao = (e, fuso) => [TIPOS_EVENTO[e.tipo], e.local].filter(Boolean).join(' · ');
const SITUACAO = { realizado: 'Realizado', cancelado: 'Cancelado' };

function itemEvento(e, { mostrarPerfil = false, podeEditar = true } = {}) {
  const fuso = e.perfis?.fuso_horario || FUSO_PADRAO;
  const conteudo = `
      <span class="ev-quando"><strong>${esc(rotuloDia(e.inicio, fuso))}</strong><br>${horaLocal(e.inicio, fuso)}</span>
      <span class="ev-texto">
        <span class="med-nome">${esc(e.titulo)}${SITUACAO[e.situacao] ? ` <span class="selo">${SITUACAO[e.situacao]}</span>` : ''}</span>
        <span class="med-quando">${esc(descricao(e, fuso))}</span>
        ${mostrarPerfil && e.perfis ? `<span class="dose-perfil" style="--cor-perfil:${corDoPerfil(e.perfil_id)}"><span class="ponto"></span>${esc(e.perfis.nome)}</span>` : ''}
      </span>`;
  return `<li class="evento ${e.situacao !== 'agendado' ? 'ev-apagado' : ''}">
    ${podeEditar ? `<a href="#/evento/${e.id}">${conteudo}</a>` : `<div class="item-fixo">${conteudo}</div>`}
  </li>`;
}

// ---------- Bloco no perfil ----------
export async function blocoAgenda(perfilId, podeEditar) {
  const { data, error } = await sb.from('eventos')
    .select('id, perfil_id, tipo, titulo, inicio, local, situacao, perfis(fuso_horario)')
    .eq('perfil_id', perfilId).eq('situacao', 'agendado')
    .gte('inicio', new Date(Date.now() - 2 * 3600000).toISOString())
    .order('inicio').limit(5);
  if (error) return `<section class="bloco"><h2>Agenda</h2><div class="erro">${esc(mensagemErro(error))}</div></section>`;
  return `
    <section class="bloco">
      <h2>Agenda</h2>
      ${data.length ? `<ul class="lista-med lista-eventos">${data.map((e) => itemEvento(e, { podeEditar })).join('')}</ul>`
        : '<p class="acesso">Nenhum compromisso marcado.</p>'}
      <div class="acoes-bloco">
        ${podeEditar ? `<a class="botao secundario" href="#/perfil/${perfilId}/evento/novo">Adicionar compromisso</a>` : ''}
        <a class="botao discreto" href="#/agenda/${perfilId}">Ver agenda completa</a>
      </div>
    </section>`;
}

// ---------- Resumo para a tela inicial ----------
export async function resumoAgenda(perfis) {
  if (!perfis.length) return [];
  const { data } = await sb.from('eventos')
    .select('id, perfil_id, tipo, titulo, inicio, local, situacao, perfis(nome, fuso_horario)')
    .in('perfil_id', perfis.map((p) => p.id)).eq('situacao', 'agendado')
    .gte('inicio', new Date(Date.now() - 3600000).toISOString())
    .lte('inicio', new Date(Date.now() + 7 * 86400000).toISOString())
    .order('inicio').limit(3);
  return data || [];
}

export function cartaoAgenda(eventos) {
  if (!eventos.length) return '';
  return `
    <a class="cartao-agenda" href="#/agenda">
      <span class="conteudo">
        <span class="nome">Próximos compromissos</span>
        ${eventos.map((e) => {
          const fuso = e.perfis?.fuso_horario || FUSO_PADRAO;
          return `<span class="detalhe">${esc(rotuloDia(e.inicio, fuso))} ${horaLocal(e.inicio, fuso)} · ${esc(e.titulo)}${e.perfis ? ` (${esc(primeiroNome(e.perfis.nome))})` : ''}</span>`;
        }).join('')}
      </span>
      <span class="seta" aria-hidden="true">›</span>
    </a>`;
}

// ---------- Tela: agenda completa ----------
let filtroAgenda = 'acompanho';
try { filtroAgenda = localStorage.getItem('cris-filtro-agenda') || 'acompanho'; } catch {}

export async function telaAgenda(perfilFixo) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const [{ data: perfis, error }, { data: compart }] = await Promise.all([
    sb.from('perfis').select('id, nome, dono_id, usuario_vinculado_id, fuso_horario').order('nome'),
    sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id)
  ]);
  if (error) { app.innerHTML = `<div class="erro">${esc(mensagemErro(error))}</div>`; return; }
  const acomp = await perfisAcompanhados(perfis);
  const filtro = perfilFixo || filtroAgenda;
  const ids = filtro === 'todos' ? perfis.map((p) => p.id)
    : filtro === 'acompanho' ? acomp.lista.map((p) => p.id)
    : [filtro];
  const editaveis = new Set(perfis.filter((p) => ['editar', 'gerenciar'].includes(acessoAoPerfil(p, compart || [])?.nivel)).map((p) => p.id));

  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: eventos, error: e2 } = ids.length ? await sb.from('eventos')
    .select('id, perfil_id, tipo, titulo, inicio, local, situacao, perfis(nome, fuso_horario)')
    .in('perfil_id', ids).gte('inicio', desde).order('inicio') : { data: [] };
  if (e2) { app.innerHTML = `<div class="erro">${esc(mensagemErro(e2))}</div>`; return; }

  const limite = Date.now() - 2 * 3600000;
  const proximos = eventos.filter((e) => new Date(e.inicio).getTime() >= limite && e.situacao !== 'cancelado');
  const anteriores = eventos.filter((e) => !proximos.includes(e)).reverse();
  const variosPerfis = new Set(eventos.map((e) => e.perfil_id)).size > 1 || filtro === 'todos' || filtro === 'acompanho';
  const lista = (l) => `<ul class="lista-med lista-eventos">${l.map((e) => itemEvento(e, { mostrarPerfil: variosPerfis, podeEditar: editaveis.has(e.perfil_id) })).join('')}</ul>`;
  const perfilNome = perfilFixo ? perfis.find((p) => p.id === perfilFixo)?.nome : '';

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${perfilFixo ? `#/perfil/${perfilFixo}` : '#/'}">‹ ${perfilFixo ? esc(primeiroNome(perfilNome || '')) : 'Perfis'}</a></header>
    <h1 style="margin-bottom:6px">Agenda</h1>
    ${perfilFixo ? `<p class="acesso">${esc(perfilNome || '')}</p>` : `
      <div class="campo">
        <label for="filtro-agenda">Mostrar</label>
        <select id="filtro-agenda">
          <option value="acompanho" ${filtro === 'acompanho' ? 'selected' : ''}>Quem eu acompanho (${esc(acomp.lista.map((p) => primeiroNome(p.nome)).join(', ') || 'ninguém')})</option>
          <option value="todos" ${filtro === 'todos' ? 'selected' : ''}>Todos os perfis</option>
          ${perfis.map((p) => `<option value="${p.id}" ${filtro === p.id ? 'selected' : ''}>Só ${esc(p.nome)}</option>`).join('')}
        </select>
      </div>`}

    <div class="botoes" style="margin:0 0 20px">
      <a class="botao principal" href="${perfilFixo ? `#/perfil/${perfilFixo}/evento/novo` : '#/evento/novo'}">Novo compromisso</a>
    </div>

    <section class="grupo">
      <h2>Próximos</h2>
      ${proximos.length ? lista(proximos) : '<p class="acesso">Nenhum compromisso marcado.</p>'}
    </section>

    ${anteriores.length ? `
      <details class="grupo">
        <summary><h2 style="display:inline">Anteriores (últimos 30 dias)</h2></summary>
        ${lista(anteriores)}
      </details>` : ''}

    <p class="acesso" style="margin-top:16px">Os avisos no celular (véspera às 19h e antes do horário) vão para quem acompanha
      a pessoa em <a href="#/notificacoes">Doses e lembretes</a>.</p>`;

  const sel = document.getElementById('filtro-agenda');
  if (sel) sel.onchange = () => {
    filtroAgenda = sel.value;
    try { localStorage.setItem('cris-filtro-agenda', filtroAgenda); } catch {}
    telaAgenda();
  };
}

// ---------- Tela: criar / editar compromisso ----------
export async function telaFormEvento(perfilId, id) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  let e = { tipo: 'consulta', lembrete_vespera: true, lembrete_minutos_antes: 120, situacao: 'agendado' };
  if (id) {
    const { data, error } = await sb.from('eventos').select('*').eq('id', id).maybeSingle();
    if (error || !data) { app.innerHTML = `<div class="erro">${esc(error ? mensagemErro(error) : 'Compromisso não encontrado.')}</div>`; return; }
    e = data;
    perfilId = e.perfil_id;
  }

  // Sem perfil definido (veio da agenda geral): escolhe entre os que posso editar
  let perfil = null, opcoesPerfis = [];
  if (perfilId) {
    const r = await perfilComAcesso(perfilId, 'id, nome, dono_id, usuario_vinculado_id, fuso_horario');
    if (r.erro) { app.innerHTML = `<div class="erro">${esc(r.erro)}</div>`; return; }
    if (!r.podeEditar) { location.hash = `#/agenda/${perfilId}`; return; }
    perfil = r.p;
  } else {
    const [{ data: perfis }, { data: compart }] = await Promise.all([
      sb.from('perfis').select('id, nome, dono_id, usuario_vinculado_id, fuso_horario').order('nome'),
      sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id)
    ]);
    opcoesPerfis = (perfis || []).filter((p) => ['editar', 'gerenciar'].includes(acessoAoPerfil(p, compart || [])?.nivel));
    if (!opcoesPerfis.length) { app.innerHTML = `<p>Você não tem nenhum perfil que possa editar.</p>`; return; }
  }

  // Médicos visíveis (da família)
  const { data: medicos } = await sb.from('profissionais').select('id, nome, especialidade').order('nome');

  const fusoDe = (pid) => (perfil || opcoesPerfis.find((p) => p.id === pid))?.fuso_horario || FUSO_PADRAO;
  const fuso0 = perfil ? fusoDe(perfil.id) : fusoDe((opcoesPerfis.find((p) => p.usuario_vinculado_id === estado.eu.id) || opcoesPerfis[0]).id);
  const dataIni = e.inicio ? hojeNoFuso(fuso0, new Date(e.inicio)) : '';
  const horaIni = e.inicio ? horaLocal(e.inicio, fuso0) : '';
  const voltar = id ? `#/agenda/${perfilId}` : perfilId ? `#/perfil/${perfilId}` : '#/agenda';

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${voltar}">‹ Cancelar</a></header>
    <h1 style="margin-bottom:6px">${id ? 'Editar compromisso' : 'Novo compromisso'}</h1>
    ${perfil ? `<p class="acesso">${esc(perfil.nome)}</p>` : ''}

    <form id="form-evento" novalidate>
      ${!perfil ? `
        <div class="campo"><label for="ev-perfil">Para quem</label>
          <select id="ev-perfil" name="perfil_id">
            ${opcoesPerfis.map((p) => `<option value="${p.id}" ${p.usuario_vinculado_id === estado.eu.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
          </select></div>` : ''}
      <div class="campo"><label for="ev-tipo">Tipo</label>
        <select id="ev-tipo" name="tipo">
          ${Object.entries(TIPOS_EVENTO).map(([k, v]) => `<option value="${k}" ${e.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      <div class="campo"><label for="ev-medico">Profissional <span class="ajuda" style="display:inline">(opcional)</span></label>
        <select id="ev-medico" name="profissional_id">
          <option value="">Nenhum</option>
          ${(medicos || []).map((m) => `<option value="${m.id}" ${e.profissional_id === m.id ? 'selected' : ''}>${esc([m.nome, m.especialidade].filter(Boolean).join(', '))}</option>`).join('')}
        </select></div>
      <div class="campo"><label for="ev-titulo">Descrição</label>
        <input id="ev-titulo" name="titulo" maxlength="120" value="${esc(e.titulo || '')}" placeholder="Ex.: Consulta com cardiologista, Exame de sangue" autocomplete="off"></div>
      <div class="linha-2">
        <div class="campo"><label for="ev-data">Data</label>
          <input id="ev-data" name="data" type="date" value="${dataIni}" required></div>
        <div class="campo"><label for="ev-hora">Hora</label>
          <input id="ev-hora" name="hora" type="time" value="${horaIni}" required></div>
      </div>
      <div class="campo"><label for="ev-local">Local <span class="ajuda" style="display:inline">(opcional)</span></label>
        <input id="ev-local" name="local" value="${esc(e.local || '')}" placeholder="Ex.: Clínica X, sala 501" autocomplete="off"></div>
      <div class="campo"><label for="ev-obs">Observações <span class="ajuda" style="display:inline">(opcional)</span></label>
        <textarea id="ev-obs" name="observacoes" placeholder="Ex.: ir em jejum de 8 horas, levar exames anteriores">${esc(e.observacoes || '')}</textarea></div>

      <fieldset class="bloco">
        <legend>Avisos no celular</legend>
        <label class="marcar"><input type="checkbox" name="lembrete_vespera" ${e.lembrete_vespera ? 'checked' : ''}>
          <span><strong>Na véspera, às 19h</strong></span></label>
        <div class="campo" style="margin-top:12px"><label for="ev-antes">No dia</label>
          <select id="ev-antes" name="lembrete_minutos_antes">
            ${Object.entries(OPCOES_ANTES).map(([k, v]) => `<option value="${k}" ${String(e.lembrete_minutos_antes ?? '') === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></div>
      </fieldset>

      ${id ? `
        <div class="campo"><label for="ev-situacao">Situação</label>
          <select id="ev-situacao" name="situacao">
            <option value="agendado" ${e.situacao === 'agendado' ? 'selected' : ''}>Agendado</option>
            <option value="realizado" ${e.situacao === 'realizado' ? 'selected' : ''}>Realizado</option>
            <option value="cancelado" ${e.situacao === 'cancelado' ? 'selected' : ''}>Cancelado</option>
          </select></div>` : ''}

      <div class="botoes">
        <button class="botao principal" type="submit">${id ? 'Salvar alterações' : 'Salvar compromisso'}</button>
        ${id ? '<button class="botao perigo" type="button" id="excluir-evento">Excluir</button>' : ''}
      </div>
    </form>`;

  const form = document.getElementById('form-evento');

  // Sugere a descrição a partir do tipo e do profissional, enquanto a pessoa não escrever a sua
  let descricaoManual = !!e.titulo;
  form.titulo.addEventListener('input', () => { descricaoManual = !!form.titulo.value.trim(); });
  const sugerir = () => {
    if (descricaoManual) return;
    const m = (medicos || []).find((x) => x.id === form.profissional_id.value);
    const tipo = TIPOS_EVENTO[form.tipo.value];
    form.titulo.value = m ? `${tipo} com ${m.nome}${m.especialidade ? ` (${m.especialidade})` : ''}` : '';
  };
  form.tipo.onchange = sugerir;
  form.profissional_id.onchange = sugerir;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pid = perfil ? perfil.id : form.perfil_id.value;
    const titulo = form.titulo.value.trim() || TIPOS_EVENTO[form.tipo.value];
    if (!form.data.value) return mostrarErro(form, 'Informe a data.');
    if (!form.hora.value) return mostrarErro(form, 'Informe a hora.');
    const inicio = instante(fusoDe(pid), form.data.value, form.hora.value.slice(0, 5));
    if (isNaN(inicio.getTime())) return mostrarErro(form, 'Data ou hora inválida.');
    const dados = {
      perfil_id: pid,
      tipo: form.tipo.value,
      titulo,
      inicio: inicio.toISOString(),
      local: form.local.value.trim() || null,
      profissional_id: form.profissional_id.value || null,
      observacoes: form.observacoes.value.trim() || null,
      lembrete_vespera: form.lembrete_vespera.checked,
      lembrete_minutos_antes: form.lembrete_minutos_antes.value ? Number(form.lembrete_minutos_antes.value) : null
    };
    if (id) dados.situacao = form.situacao.value;
    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    const { error } = id
      ? await sb.from('eventos').update(dados).eq('id', id)
      : await sb.from('eventos').insert(dados);
    ocupado(b, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    aviso(id ? 'Compromisso atualizado' : 'Compromisso marcado');
    location.hash = perfilId ? `#/perfil/${pid}` : '#/agenda';
  });

  const bEx = document.getElementById('excluir-evento');
  if (bEx) bEx.onclick = async () => {
    if (!confirm('Excluir este compromisso?')) return;
    ocupado(bEx, true, 'Excluindo…');
    const { error } = await sb.from('eventos').delete().eq('id', id);
    if (error) { ocupado(bEx, false); return aviso(mensagemErro(error)); }
    aviso('Compromisso excluído');
    location.hash = `#/perfil/${perfilId}`;
  };
}
