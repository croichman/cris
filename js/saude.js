// CRIS — alergias, condições de saúde, vacinas e médicos
import {
  sb, app, estado, esc, aviso, dataBR, primeiroNome, mensagemErro, ocupado, mostrarErro,
  perfilComAcesso, hojeNoFuso, enviarFoto, apagarFotos, linksDasFotos
} from './base.js';

// ======================================================================
// Configuração de cada tipo de registro
// ======================================================================
const TIPOS_ALERGIA = { medicamento: 'Medicamento', alimento: 'Alimento', outro: 'Outro' };
const GRAVIDADES = { leve: 'Leve', moderada: 'Moderada', grave: 'Grave' };

export const TIPOS = {
  alergia: {
    tabela: 'alergias', singular: 'alergia', titulo: 'Alergias', ordem: 'substancia',
    vazio: 'Nenhuma alergia registrada.',
    campos: [
      { nome: 'substancia', rotulo: 'A que a pessoa é alérgica', obrigatorio: true, placeholder: 'Ex.: dipirona, camarão, látex' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS_ALERGIA, padrao: 'medicamento' },
      { nome: 'gravidade', rotulo: 'Gravidade', tipo: 'select', opcoes: { '': 'Não sei', ...GRAVIDADES } },
      { nome: 'reacao', rotulo: 'Reação', placeholder: 'Ex.: inchaço, falta de ar, manchas' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' }
    ],
    titulo_item: (a) => a.substancia,
    detalhe: (a) => [TIPOS_ALERGIA[a.tipo], a.gravidade && `gravidade ${GRAVIDADES[a.gravidade].toLowerCase()}`, a.reacao]
      .filter(Boolean).join(', '),
    destaque: (a) => a.gravidade === 'grave'
  },
  condicao: {
    tabela: 'condicoes', singular: 'condição', titulo: 'Condições de saúde', ordem: 'nome',
    vazio: 'Nenhuma condição registrada.',
    campos: [
      { nome: 'nome', rotulo: 'Condição', obrigatorio: true, placeholder: 'Ex.: hipertensão, diabetes tipo 2' },
      { nome: 'desde', rotulo: 'Desde', tipo: 'date' },
      { nome: 'ativa', rotulo: 'Ainda presente', tipo: 'checkbox', padrao: true, ajuda: 'Desmarque se a condição já foi resolvida. Ela continua no histórico.' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' }
    ],
    titulo_item: (c) => c.nome + (c.ativa ? '' : ' (resolvida)'),
    detalhe: (c) => [c.desde && `desde ${dataBR(c.desde)}`, c.observacoes].filter(Boolean).join('. '),
    ordenar: (l) => [...l].sort((a, b) => (b.ativa - a.ativa) || a.nome.localeCompare(b.nome))
  },
  vacina: {
    tabela: 'vacinas', singular: 'vacina', titulo: 'Vacinas', ordem: 'data_aplicacao',
    vazio: 'Nenhuma vacina registrada.',
    campos: [
      { nome: 'vacina', rotulo: 'Vacina', obrigatorio: true, placeholder: 'Ex.: gripe, COVID-19, tétano', lista: 'lista-vacinas' },
      { nome: 'dose', rotulo: 'Dose', placeholder: 'Ex.: 1ª dose, reforço, dose única' },
      { nome: 'data_aplicacao', rotulo: 'Data da aplicação', tipo: 'date', padraoHoje: true },
      { nome: 'proxima_dose', rotulo: 'Próxima dose prevista', tipo: 'date' },
      { nome: 'local', rotulo: 'Local', placeholder: 'Ex.: posto de saúde, clínica' },
      { nome: 'lote', rotulo: 'Lote' },
      { nome: 'foto_path', rotulo: 'Foto do cartão de vacina', tipo: 'foto' },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' }
    ],
    titulo_item: (v) => [v.vacina, v.dose].filter(Boolean).join(', '),
    detalhe: (v) => [v.data_aplicacao && `aplicada em ${dataBR(v.data_aplicacao)}`, v.local].filter(Boolean).join(', '),
    ordenar: (l) => [...l].sort((a, b) => (b.data_aplicacao || '').localeCompare(a.data_aplicacao || ''))
  }
};

const VACINAS_COMUNS = ['Gripe (influenza)', 'COVID-19', 'Tétano e difteria (dT)', 'Hepatite B', 'Febre amarela',
  'Tríplice viral (sarampo, caxumba, rubéola)', 'Pneumocócica', 'Herpes-zóster', 'HPV', 'Dengue', 'Meningocócica', 'Varicela'];

// ======================================================================
// Bloco de cada tipo na página do perfil
// ======================================================================
export async function blocoItens(chave, perfilId, podeEditar) {
  const t = TIPOS[chave];
  const { data, error } = await sb.from(t.tabela).select('*').eq('perfil_id', perfilId).order(t.ordem);
  if (error) return `<section class="bloco"><h2>${t.titulo}</h2><div class="erro">${esc(mensagemErro(error))}</div></section>`;
  const itens = t.ordenar ? t.ordenar(data) : data;
  const links = chave === 'vacina' ? await linksDasFotos(itens.map((v) => v.foto_path)) : {};
  const hoje = hojeNoFuso();

  const item = (x) => {
    const proxima = chave === 'vacina' && x.proxima_dose
      ? `<span class="${x.proxima_dose <= hoje ? 'dose-alerta' : 'med-quando'}">Próxima dose: ${dataBR(x.proxima_dose)}${x.proxima_dose <= hoje ? ' (vencida)' : ''}</span>` : '';
    const foto = x.foto_path && links[x.foto_path]
      ? `<a class="link-foto" href="${esc(links[x.foto_path])}" target="_blank" rel="noopener">Ver foto do cartão</a>` : '';
    const corpo = `
      <span class="med-nome">${esc(t.titulo_item(x))}${t.destaque?.(x) ? '<span class="selo selo-suspenso">Grave</span>' : ''}</span>
      ${t.detalhe(x) ? `<span class="med-quando">${esc(t.detalhe(x))}</span>` : ''}
      ${proxima}`;
    return `<li>${podeEditar ? `<a href="#/${chave}/${x.id}">${corpo}</a>` : `<div class="item-fixo">${corpo}</div>`}${foto}</li>`;
  };

  const alerta = chave === 'alergia' && itens.length;
  return `
    <section class="bloco ${alerta ? 'bloco-alerta' : ''}">
      <h2>${t.titulo}</h2>
      ${itens.length ? `<ul class="lista-med">${itens.map(item).join('')}</ul>` : `<p class="acesso">${t.vazio}</p>`}
      ${podeEditar ? `<div class="acoes-bloco"><a class="botao secundario" href="#/perfil/${perfilId}/${chave}/novo">Adicionar ${t.singular}</a></div>` : ''}
    </section>`;
}

// ======================================================================
// Formulário genérico (alergia, condição, vacina)
// ======================================================================
function campoHTML(c, valor, links) {
  const id = `c-${c.nome}`;
  const ajuda = c.ajuda ? `<span class="ajuda">${c.ajuda}</span>` : '';
  if (c.tipo === 'checkbox') return `
    <label class="marcar"><input type="checkbox" name="${c.nome}" ${valor ? 'checked' : ''}>
      <span><strong>${c.rotulo}</strong>${c.ajuda ? `<br><span class="ajuda" style="display:inline">${c.ajuda}</span>` : ''}</span></label>`;
  if (c.tipo === 'select') return `
    <div class="campo"><label for="${id}">${c.rotulo}</label>
      <select id="${id}" name="${c.nome}">
        ${Object.entries(c.opcoes).map(([k, v]) => `<option value="${k}" ${String(valor ?? '') === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>${ajuda}</div>`;
  if (c.tipo === 'textarea') return `
    <div class="campo"><label for="${id}">${c.rotulo}</label>
      <textarea id="${id}" name="${c.nome}">${esc(valor)}</textarea>${ajuda}</div>`;
  if (c.tipo === 'foto') return `
    <div class="campo campo-foto"><label for="${id}">${c.rotulo}</label>
      ${valor && links[valor] ? `
        <div class="foto-atual"><img src="${esc(links[valor])}" alt="">
          <label class="marcar-simples"><input type="checkbox" name="remover_${c.nome}"> Remover esta foto</label></div>` : ''}
      <input id="${id}" name="${c.nome}" type="file" accept="image/*">${ajuda}</div>`;
  return `
    <div class="campo"><label for="${id}">${c.rotulo}</label>
      <input id="${id}" name="${c.nome}" type="${c.tipo || 'text'}" value="${esc(valor)}"
        ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''} ${c.lista ? `list="${c.lista}"` : ''} autocomplete="off">${ajuda}</div>`;
}

export async function telaFormItem(chave, perfilId, id) {
  const t = TIPOS[chave];
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  let x = {};
  if (id) {
    const { data, error } = await sb.from(t.tabela).select('*').eq('id', id).maybeSingle();
    if (error || !data) return erroTela(error ? mensagemErro(error) : 'Registro não encontrado.');
    x = data;
    perfilId = x.perfil_id;
  }
  const r = await perfilComAcesso(perfilId, 'id, nome, dono_id, usuario_vinculado_id, fuso_horario');
  if (r.erro) return erroTela(r.erro);
  if (!r.podeEditar) { location.hash = `#/perfil/${perfilId}`; return; }

  if (!id) for (const c of t.campos) {
    if (c.padrao !== undefined) x[c.nome] = c.padrao;
    if (c.padraoHoje) x[c.nome] = hojeNoFuso(r.p.fuso_horario || undefined);
  }
  const fotos = t.campos.filter((c) => c.tipo === 'foto').map((c) => x[c.nome]);
  const links = await linksDasFotos(fotos);
  const voltar = `#/perfil/${perfilId}`;

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${voltar}">‹ Cancelar</a></header>
    <h1 style="margin-bottom:6px">${id ? 'Editar' : 'Nova'} ${t.singular}</h1>
    <p class="acesso">${esc(r.p.nome)}</p>
    <form id="form-item" novalidate>
      ${t.campos.map((c) => campoHTML(c, x[c.nome], links)).join('')}
      ${chave === 'vacina' ? `<datalist id="lista-vacinas">${VACINAS_COMUNS.map((v) => `<option value="${v}">`).join('')}</datalist>` : ''}
      <div class="botoes">
        <button class="botao principal" type="submit">${id ? 'Salvar alterações' : 'Salvar'}</button>
        ${id ? `<button class="botao perigo" type="button" id="excluir">Excluir</button>` : ''}
      </div>
    </form>`;

  const form = document.getElementById('form-item');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const dados = {};
    const paraApagar = [];
    const b = form.querySelector('[type=submit]');
    for (const c of t.campos) {
      if (c.tipo === 'checkbox') dados[c.nome] = !!f.get(c.nome);
      else if (c.tipo === 'foto') continue;
      else dados[c.nome] = (f.get(c.nome) || '').toString().trim() || null;
      if (c.obrigatorio && !dados[c.nome]) return mostrarErro(form, `Preencha o campo "${c.rotulo}".`);
    }
    ocupado(b, true, 'Salvando…');
    try {
      for (const c of t.campos.filter((c) => c.tipo === 'foto')) {
        const arq = f.get(c.nome);
        if (arq && arq.size) { dados[c.nome] = await enviarFoto(perfilId, arq); if (x[c.nome]) paraApagar.push(x[c.nome]); }
        else if (f.get('remover_' + c.nome) && x[c.nome]) { dados[c.nome] = null; paraApagar.push(x[c.nome]); }
      }
      const { error } = id
        ? await sb.from(t.tabela).update(dados).eq('id', id)
        : await sb.from(t.tabela).insert({ ...dados, perfil_id: perfilId });
      if (error) throw error;
      apagarFotos(paraApagar);
      ocupado(b, false);
      aviso(id ? 'Alterações salvas' : `${t.singular.charAt(0).toUpperCase() + t.singular.slice(1)} salva`);
      location.hash = voltar;
    } catch (e) {
      ocupado(b, false);
      mostrarErro(form, mensagemErro(e));
    }
  });

  const excluir = document.getElementById('excluir');
  if (excluir) excluir.onclick = async () => {
    if (!confirm(`Excluir este registro de ${t.singular}?`)) return;
    ocupado(excluir, true, 'Excluindo…');
    const { error } = await sb.from(t.tabela).delete().eq('id', id);
    ocupado(excluir, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    apagarFotos(fotos);
    aviso('Registro excluído');
    location.hash = voltar;
  };
}

function erroTela(msg) {
  app.innerHTML = `<header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header><div class="erro">${esc(msg)}</div>`;
}

// ======================================================================
// Médicos e outros profissionais de saúde
// O mesmo médico pode atender várias pessoas da família.
// ======================================================================
const CAMPOS_MEDICO = [
  { nome: 'nome', rotulo: 'Nome', obrigatorio: true, placeholder: 'Ex.: Dra. Ana Souza' },
  { nome: 'especialidade', rotulo: 'Especialidade', placeholder: 'Ex.: cardiologia, clínico geral', lista: 'lista-especialidades' },
  { nome: 'registro', rotulo: 'CRM ou outro registro', placeholder: 'Ex.: CRM-CE 12345' },
  { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel' },
  { nome: 'whatsapp', rotulo: 'WhatsApp', tipo: 'tel', ajuda: 'Com DDD. Ex.: 85 99999-0000' },
  { nome: 'email', rotulo: 'E-mail', tipo: 'email' },
  { nome: 'clinica', rotulo: 'Clínica ou hospital' },
  { nome: 'endereco', rotulo: 'Endereço' },
  { nome: 'observacoes', rotulo: 'Observações', tipo: 'textarea' }
];
const ESPECIALIDADES = ['Clínica geral', 'Cardiologia', 'Neurologia', 'Endocrinologia', 'Geriatria', 'Pediatria',
  'Ginecologia', 'Urologia', 'Ortopedia', 'Dermatologia', 'Psiquiatria', 'Psicologia', 'Oftalmologia',
  'Otorrinolaringologia', 'Gastroenterologia', 'Pneumologia', 'Reumatologia', 'Nefrologia', 'Oncologia',
  'Odontologia', 'Fisioterapia', 'Nutrição'];

export const nomeMedico = (m) => [m.nome, m.especialidade].filter(Boolean).join(', ');

export function contatosMedico(m) {
  const zap = (m.whatsapp || '').replace(/\D/g, '');
  const tel = (m.telefone || '').replace(/[^\d+]/g, '');
  return [
    tel && `<a class="contato" href="tel:${esc(tel)}">Ligar: ${esc(m.telefone)}</a>`,
    zap && `<a class="contato" href="https://wa.me/${zap.length <= 11 ? '55' + zap : zap}" target="_blank" rel="noopener">WhatsApp</a>`,
    m.email && `<a class="contato" href="mailto:${esc(m.email)}">E-mail</a>`
  ].filter(Boolean).join('');
}

export async function medicosDoPerfil(perfilId) {
  const { data, error } = await sb.from('perfil_profissionais')
    .select('profissional_id, profissionais(*)').eq('perfil_id', perfilId);
  if (error) throw error;
  return (data || []).map((x) => x.profissionais).filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function blocoMedicos(perfilId, podeEditar) {
  let medicos;
  try { medicos = await medicosDoPerfil(perfilId); }
  catch (e) { return `<section class="bloco"><h2>Médicos</h2><div class="erro">${esc(mensagemErro(e))}</div></section>`; }
  return `
    <section class="bloco">
      <h2>Médicos e profissionais</h2>
      ${medicos.length ? `<ul class="lista-med">${medicos.map((m) => `
        <li>
          ${podeEditar ? `<a href="#/perfil/${perfilId}/medico/${m.id}">` : '<div class="item-fixo">'}
            <span class="med-nome">${esc(m.nome)}</span>
            <span class="med-quando">${esc([m.especialidade, m.clinica].filter(Boolean).join(', '))}</span>
          ${podeEditar ? '</a>' : '</div>'}
          <div class="contatos">${contatosMedico(m)}</div>
        </li>`).join('')}</ul>` : '<p class="acesso">Nenhum profissional registrado.</p>'}
      ${podeEditar ? `<div class="acoes-bloco"><a class="botao secundario" href="#/perfil/${perfilId}/medico/novo">Adicionar médico</a></div>` : ''}
    </section>`;
}

export async function telaFormMedico(perfilId, id) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const r = await perfilComAcesso(perfilId, 'id, nome, dono_id, usuario_vinculado_id');
  if (r.erro) return erroTela(r.erro);
  if (!r.podeEditar) { location.hash = `#/perfil/${perfilId}`; return; }

  let m = {};
  let outros = [];
  if (id) {
    const { data, error } = await sb.from('profissionais').select('*').eq('id', id).maybeSingle();
    if (error || !data) return erroTela(error ? mensagemErro(error) : 'Profissional não encontrado.');
    m = data;
  } else {
    // médicos já cadastrados na família (que eu consigo ver) e que ainda não atendem esta pessoa
    const [{ data: todos }, jaLigados] = await Promise.all([
      sb.from('profissionais').select('id, nome, especialidade').order('nome'),
      medicosDoPerfil(perfilId).catch(() => [])
    ]);
    const ligados = new Set(jaLigados.map((x) => x.id));
    outros = (todos || []).filter((x) => !ligados.has(x.id));
  }
  const voltar = `#/perfil/${perfilId}`;

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${voltar}">‹ Cancelar</a></header>
    <h1 style="margin-bottom:6px">${id ? 'Editar médico' : 'Adicionar médico'}</h1>
    <p class="acesso">${esc(r.p.nome)}</p>

    ${outros.length ? `
      <form id="form-ligar" class="bloco" novalidate>
        <h2>Já cadastrado na família?</h2>
        <p class="acesso">Se o profissional já atende outra pessoa da família, escolha na lista.</p>
        <div class="campo"><label for="ligar-quem">Profissional</label>
          <select id="ligar-quem" name="profissional_id">
            <option value="">Escolha</option>
            ${outros.map((o) => `<option value="${o.id}">${esc(nomeMedico(o))}</option>`).join('')}
          </select></div>
        <button class="botao secundario" type="submit">Adicionar a ${esc(primeiroNome(r.p.nome))}</button>
      </form>
      <h2 class="ou">Ou cadastre um novo</h2>` : ''}

    <form id="form-medico" novalidate>
      ${CAMPOS_MEDICO.map((c) => campoHTML(c, m[c.nome], {})).join('')}
      <datalist id="lista-especialidades">${ESPECIALIDADES.map((e) => `<option value="${e}">`).join('')}</datalist>
      <div class="botoes">
        <button class="botao principal" type="submit">${id ? 'Salvar alterações' : 'Salvar médico'}</button>
        ${id ? `<button class="botao perigo" type="button" id="desligar">Tirar de ${esc(primeiroNome(r.p.nome))}</button>` : ''}
      </div>
      ${id ? '<p class="acesso" style="margin-top:12px">As alterações valem para todas as pessoas da família atendidas por este profissional.</p>' : ''}
    </form>`;

  const formLigar = document.getElementById('form-ligar');
  if (formLigar) formLigar.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pid = formLigar.profissional_id.value;
    if (!pid) return mostrarErro(formLigar, 'Escolha o profissional.');
    const b = formLigar.querySelector('[type=submit]');
    ocupado(b, true, 'Adicionando…');
    const { error } = await sb.from('perfil_profissionais').insert({ perfil_id: perfilId, profissional_id: pid });
    ocupado(b, false);
    if (error) return mostrarErro(formLigar, mensagemErro(error));
    aviso('Médico adicionado');
    location.hash = voltar;
  });

  const form = document.getElementById('form-medico');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const dados = {};
    for (const c of CAMPOS_MEDICO) dados[c.nome] = (f.get(c.nome) || '').toString().trim() || null;
    if (!dados.nome) return mostrarErro(form, 'Digite o nome do profissional.');
    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    try {
      if (id) {
        const { error } = await sb.from('profissionais').update(dados).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('profissionais')
          .insert({ ...dados, criado_por: estado.eu.id }).select('id').single();
        if (error) throw error;
        const { error: e2 } = await sb.from('perfil_profissionais').insert({ perfil_id: perfilId, profissional_id: data.id });
        if (e2) throw e2;
      }
      ocupado(b, false);
      aviso(id ? 'Alterações salvas' : 'Médico salvo');
      location.hash = voltar;
    } catch (e) {
      ocupado(b, false);
      mostrarErro(form, mensagemErro(e));
    }
  });

  const desligar = document.getElementById('desligar');
  if (desligar) desligar.onclick = async () => {
    if (!confirm(`Tirar ${m.nome} da lista de ${r.p.nome}? O cadastro do profissional continua para as outras pessoas da família.`)) return;
    ocupado(desligar, true, 'Removendo…');
    const { error } = await sb.from('perfil_profissionais').delete().eq('perfil_id', perfilId).eq('profissional_id', id);
    ocupado(desligar, false);
    if (error) return mostrarErro(form, mensagemErro(error));
    aviso('Médico removido do perfil');
    location.hash = voltar;
  };
}
