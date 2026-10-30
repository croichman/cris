// CRIS — medicamentos, horários e doses ("Tomei")
import {
  sb, app, estado, esc, aviso, dataBR, corDoPerfil, primeiroNome, mensagemErro, ocupado, mostrarErro,
  acessoAoPerfil, perfilComAcesso, podeEditarNivel, ehDuplicado,
  FUSO_PADRAO, hojeNoFuso, instante, diaDaSemana, hhmm, horaLocal, dataHoraCurta,
  DIAS_CURTOS, DIAS_LONGOS, descreverDias, nomesUsuarios,
  enviarFoto, apagarFotos, linksDasFotos
} from './base.js';

const SITUACAO = { em_uso: 'Em uso', suspenso: 'Suspenso', concluido: 'Concluído' };
const FORMAS = ['Comprimido', 'Cápsula', 'Drágea', 'Gotas', 'Xarope', 'Solução oral', 'Suspensão', 'Sachê',
  'Injeção', 'Pomada', 'Creme', 'Gel', 'Spray', 'Adesivo', 'Inalador', 'Colírio', 'Supositório'];
const VIAS = ['Oral', 'Sublingual', 'Tópica', 'Injetável', 'Inalatória', 'Oftálmica', 'Nasal', 'Retal', 'Vaginal', 'Transdérmica'];

const nomeCompleto = (m) => [m.nome_comercial, m.concentracao].filter(Boolean).join(' ');

function resumoHorarios(m) {
  if (m.se_necessario) return 'Quando necessário';
  const hs = (m.horarios || []).filter((h) => h.ativo).sort((a, b) => a.hora.localeCompare(b.hora));
  if (!hs.length) return m.posologia || '';
  const mesmosDias = hs.every((h) => descreverDias(h.dias_semana) === descreverDias(hs[0].dias_semana));
  if (mesmosDias) return `${hs.map((h) => hhmm(h.hora)).join(', ')}, ${descreverDias(hs[0].dias_semana)}`;
  return hs.map((h) => `${hhmm(h.hora)} (${descreverDias(h.dias_semana)})`).join('; ');
}

const SEL_MED = 'id, perfil_id, nome_comercial, principio_ativo, concentracao, forma, dose, via, posologia, motivo, data_inicio, data_fim, situacao, motivo_suspensao, uso_continuo, se_necessario, observacoes, foto_caixa_path, foto_receita_path, horarios(id, hora, dias_semana, ativo)';

// ======================================================================
// Bloco de medicamentos na página do perfil
// ======================================================================
export async function blocoMedicamentos(perfilId, podeEditar) {
  const { data: meds, error } = await sb.from('medicamentos').select(SEL_MED)
    .eq('perfil_id', perfilId).order('nome_comercial');
  if (error) return `<div class="erro">${esc(mensagemErro(error))}</div>`;

  const emUso = meds.filter((m) => m.situacao === 'em_uso');
  const encerrados = meds.length - emUso.length;

  return `
    <section class="bloco">
      <h2>Medicamentos em uso</h2>
      ${emUso.length ? `
        <ul class="lista-med">
          ${emUso.map((m) => `
            <li><a href="#/medicamento/${m.id}">
              <span class="med-nome">${esc(nomeCompleto(m))}</span>
              ${m.principio_ativo ? `<span class="med-ativo">${esc(m.principio_ativo)}</span>` : ''}
              <span class="med-quando">${esc([m.dose, resumoHorarios(m)].filter(Boolean).join(', '))}</span>
            </a></li>`).join('')}
        </ul>` : `<p class="acesso">Nenhum medicamento em uso registrado.</p>`}
      <div class="acoes-bloco">
        ${podeEditar ? `<a class="botao secundario" href="#/perfil/${perfilId}/medicamento/novo">Adicionar medicamento</a>` : ''}
        ${encerrados ? `<a class="link-discreto" href="#/perfil/${perfilId}/medicamentos">Ver histórico (${encerrados} ${encerrados === 1 ? 'encerrado' : 'encerrados'})</a>` : ''}
      </div>
    </section>`;
}

// ======================================================================
// Lista completa (em uso + encerrados)
// ======================================================================
export async function telaListaMedicamentos(perfilId) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const r = await perfilComAcesso(perfilId, 'id, nome, dono_id, usuario_vinculado_id');
  if (r.erro) return erroTela(r.erro, '#/');
  const { data: meds, error } = await sb.from('medicamentos').select(SEL_MED)
    .eq('perfil_id', perfilId).order('data_inicio', { ascending: false, nullsFirst: false });
  if (error) return erroTela(mensagemErro(error), `#/perfil/${perfilId}`);

  const item = (m) => `
    <li><a href="#/medicamento/${m.id}">
      <span class="med-nome">${esc(nomeCompleto(m))}<span class="selo selo-${m.situacao}">${SITUACAO[m.situacao]}</span></span>
      ${m.principio_ativo ? `<span class="med-ativo">${esc(m.principio_ativo)}</span>` : ''}
      <span class="med-quando">${esc(periodo(m))}</span>
      ${m.motivo_suspensao ? `<span class="med-quando">Motivo: ${esc(m.motivo_suspensao)}</span>` : ''}
    </a></li>`;

  const emUso = meds.filter((m) => m.situacao === 'em_uso');
  const outros = meds.filter((m) => m.situacao !== 'em_uso');

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/perfil/${perfilId}">‹ ${esc(primeiroNome(r.p.nome))}</a></header>
    <h1 style="margin-bottom:6px">Medicamentos</h1>
    <p class="acesso">${esc(r.p.nome)}</p>
    <section class="bloco"><h2>Em uso</h2>
      ${emUso.length ? `<ul class="lista-med">${emUso.map(item).join('')}</ul>` : '<p class="acesso">Nenhum.</p>'}
    </section>
    <section class="bloco"><h2>Encerrados</h2>
      <p class="acesso">Suspensos ou concluídos. Ficam guardados porque ajudam os médicos a entender o histórico.</p>
      ${outros.length ? `<ul class="lista-med">${outros.map(item).join('')}</ul>` : '<p class="acesso">Nenhum.</p>'}
    </section>`;
}

function periodo(m) {
  const ini = m.data_inicio ? `desde ${dataBR(m.data_inicio)}` : '';
  if (m.situacao === 'em_uso') return ini || 'Data de início não informada';
  const fim = m.data_fim ? `até ${dataBR(m.data_fim)}` : '';
  return [ini, fim].filter(Boolean).join(' ') || 'Datas não informadas';
}

function erroTela(msg, voltar) {
  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${voltar}">‹ Voltar</a></header>
    <div class="erro">${esc(msg)}</div>`;
}

// ======================================================================
// Detalhe do medicamento
// ======================================================================
export async function telaMedicamento(id) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const { data: m, error } = await sb.from('medicamentos').select(SEL_MED).eq('id', id).maybeSingle();
  if (error || !m) return erroTela(error ? mensagemErro(error) : 'Medicamento não encontrado.', '#/');
  const r = await perfilComAcesso(m.perfil_id, 'id, nome, dono_id, usuario_vinculado_id, fuso_horario');
  if (r.erro) return erroTela(r.erro, '#/');
  const fuso = r.p.fuso_horario || FUSO_PADRAO;

  const [{ data: doses }, nomes, links] = await Promise.all([
    sb.from('doses').select('id, horario_id, previsto_para, registrado_em, status, registrado_por')
      .eq('medicamento_id', id).order('registrado_em', { ascending: false }).limit(15),
    nomesUsuarios(),
    linksDasFotos([m.foto_caixa_path, m.foto_receita_path])
  ]);

  const linha = (rotulo, valor) => valor ? `<dt>${rotulo}</dt><dd>${valor}</dd>` : '';
  const horarios = (m.horarios || []).filter((h) => h.ativo).sort((a, b) => a.hora.localeCompare(b.hora));
  const foto = (caminho, rotulo) => caminho && links[caminho]
    ? `<a class="miniatura" href="${esc(links[caminho])}" target="_blank" rel="noopener">
         <img src="${esc(links[caminho])}" alt="${rotulo}"><span>${rotulo}</span></a>` : '';
  const fotos = foto(m.foto_caixa_path, 'Caixa') + foto(m.foto_receita_path, 'Receita');

  app.innerHTML = `
    <header class="topo">
      <a class="voltar" href="#/perfil/${m.perfil_id}">‹ ${esc(primeiroNome(r.p.nome))}</a>
      ${r.podeEditar ? `<a class="botao discreto" href="#/medicamento/${m.id}/editar">Editar</a>` : ''}
    </header>

    <section class="cabeca-med" style="--cor-perfil:${corDoPerfil(m.perfil_id)}">
      <span class="selo selo-${m.situacao}">${SITUACAO[m.situacao]}</span>
      <h1>${esc(nomeCompleto(m))}</h1>
      ${m.principio_ativo ? `<p class="med-ativo-grande">${esc(m.principio_ativo)}</p>` : ''}
      <p class="acesso">${esc(r.p.nome)}</p>
    </section>

    ${m.situacao === 'em_uso' ? `
      <div class="botoes" style="margin:0 0 20px">
        <button class="botao principal" id="tomei-agora">Tomei agora</button>
      </div>` : ''}

    <section class="bloco">
      <h2>Como usar</h2>
      <dl>
        ${linha('Dose', esc(m.dose))}
        ${linha('Horários', horarios.length || m.se_necessario ? esc(resumoHorarios(m)) : '')}
        ${linha('Posologia', esc(m.posologia))}
        ${linha('Forma', esc(m.forma))}
        ${linha('Via', esc(m.via))}
        ${linha('Para que serve', esc(m.motivo))}
      </dl>
    </section>

    <section class="bloco">
      <h2>Período</h2>
      <dl>
        ${linha('Início', m.data_inicio ? dataBR(m.data_inicio) : 'Não informado')}
        ${linha('Fim', m.data_fim ? dataBR(m.data_fim) : (m.uso_continuo ? 'Uso contínuo' : ''))}
        ${linha('Motivo do encerramento', esc(m.motivo_suspensao))}
      </dl>
    </section>

    ${m.observacoes ? `<section class="bloco"><h2>Observações</h2><p>${esc(m.observacoes).replace(/\n/g, '<br>')}</p></section>` : ''}

    ${fotos ? `<section class="bloco"><h2>Fotos</h2><div class="miniaturas">${fotos}</div></section>` : ''}

    <section class="bloco">
      <h2>Últimas doses registradas</h2>
      ${doses?.length ? `<ul class="historico-doses">
        ${doses.map((d) => `
          <li>
            <span><strong>${d.status === 'tomado' ? 'Tomado' : 'Pulado'}</strong>, ${esc(dataHoraCurta(d.registrado_em, fuso))}
              ${d.previsto_para ? `<br><span class="med-quando">Dose das ${horaLocal(d.previsto_para, fuso)}</span>` : ''}</span>
            <span class="med-quando">${esc(primeiroNome(nomes[d.registrado_por]) || '')}</span>
          </li>`).join('')}
      </ul>` : '<p class="acesso">Nenhuma dose registrada ainda.</p>'}
    </section>

    ${r.podeEditar ? `
      <section class="bloco" id="bloco-situacao">
        ${m.situacao === 'em_uso' ? `
          <h2>Encerrar uso</h2>
          <p class="acesso">Use quando o remédio for suspenso ou o tratamento terminar. O registro continua no histórico.</p>
          <form id="form-encerrar" novalidate>
            <div class="opcoes">
              <label class="marcar"><input type="radio" name="situacao" value="suspenso" checked>
                <span><strong>Suspenso</strong><br><span class="ajuda" style="display:inline">Parou por orientação médica, reação ou outro motivo</span></span></label>
              <label class="marcar"><input type="radio" name="situacao" value="concluido">
                <span><strong>Concluído</strong><br><span class="ajuda" style="display:inline">O tratamento terminou</span></span></label>
            </div>
            <div class="campo"><label for="data-fim">Data</label>
              <input id="data-fim" name="data_fim" type="date" value="${hojeNoFuso(fuso)}"></div>
            <div class="campo"><label for="motivo-enc">Motivo</label>
              <input id="motivo-enc" name="motivo" placeholder="Ex.: troca por outro remédio, efeito colateral…"></div>
            <button class="botao secundario" type="submit">Encerrar uso</button>
          </form>` : `
          <h2>Voltar a usar</h2>
          <p class="acesso">Se o remédio foi retomado, reative para voltar às doses do dia.</p>
          <button class="botao secundario" id="reativar">Reativar medicamento</button>`}
      </section>
      <div class="botoes"><button class="botao perigo" id="excluir-med">Excluir medicamento</button></div>` : ''}
  `;

  const tomei = document.getElementById('tomei-agora');
  if (tomei) tomei.onclick = async () => {
    ocupado(tomei, true, 'Registrando…');
    const { error: e } = await sb.from('doses').insert({ medicamento_id: m.id, status: 'tomado', registrado_por: estado.eu.id });
    ocupado(tomei, false);
    if (e) return aviso(mensagemErro(e));
    aviso('Dose registrada');
    telaMedicamento(id);
  };

  const formEnc = document.getElementById('form-encerrar');
  if (formEnc) formEnc.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(formEnc);
    const b = formEnc.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    const { error: e } = await sb.from('medicamentos').update({
      situacao: f.get('situacao'),
      data_fim: f.get('data_fim') || hojeNoFuso(fuso),
      motivo_suspensao: f.get('motivo').trim() || null
    }).eq('id', m.id);
    ocupado(b, false);
    if (e) return mostrarErro(formEnc, mensagemErro(e));
    aviso(f.get('situacao') === 'suspenso' ? 'Medicamento suspenso' : 'Medicamento concluído');
    telaMedicamento(id);
  });

  const reativar = document.getElementById('reativar');
  if (reativar) reativar.onclick = async () => {
    ocupado(reativar, true, 'Reativando…');
    const { error: e } = await sb.from('medicamentos')
      .update({ situacao: 'em_uso', data_fim: null, motivo_suspensao: null }).eq('id', m.id);
    ocupado(reativar, false);
    if (e) return aviso(mensagemErro(e));
    aviso('Medicamento reativado');
    telaMedicamento(id);
  };

  const excluir = document.getElementById('excluir-med');
  if (excluir) excluir.onclick = async () => {
    const ok = confirm(`Excluir ${nomeCompleto(m)} e todas as doses registradas?\n\nSe o remédio só deixou de ser usado, prefira "Encerrar uso": o histórico ajuda os médicos.`);
    if (!ok) return;
    ocupado(excluir, true, 'Excluindo…');
    const { error: e } = await sb.from('medicamentos').delete().eq('id', m.id);
    ocupado(excluir, false);
    if (e) return aviso(mensagemErro(e));
    apagarFotos([m.foto_caixa_path, m.foto_receita_path]);
    aviso('Medicamento excluído');
    location.hash = `#/perfil/${m.perfil_id}`;
  };
}

// ======================================================================
// Formulário: novo / editar medicamento
// ======================================================================
export async function telaFormMedicamento(perfilId, id) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  let m = { horarios: [], uso_continuo: false, se_necessario: false };
  if (id) {
    const { data, error } = await sb.from('medicamentos').select(SEL_MED).eq('id', id).maybeSingle();
    if (error || !data) return erroTela(error ? mensagemErro(error) : 'Medicamento não encontrado.', '#/');
    m = data;
    perfilId = m.perfil_id;
  }
  const r = await perfilComAcesso(perfilId, 'id, nome, dono_id, usuario_vinculado_id, fuso_horario');
  if (r.erro) return erroTela(r.erro, '#/');
  if (!r.podeEditar) { location.hash = `#/perfil/${perfilId}`; return; }

  const links = await linksDasFotos([m.foto_caixa_path, m.foto_receita_path]);
  const horariosIniciais = (m.horarios || []).filter((h) => h.ativo).sort((a, b) => a.hora.localeCompare(b.hora));
  const voltar = id ? `#/medicamento/${id}` : `#/perfil/${perfilId}`;

  const campoFoto = (nome, rotulo, caminho) => `
    <div class="campo campo-foto">
      <label for="${nome}">${rotulo}</label>
      ${caminho && links[caminho] ? `
        <div class="foto-atual">
          <img src="${esc(links[caminho])}" alt="">
          <label class="marcar-simples"><input type="checkbox" name="remover_${nome}"> Remover esta foto</label>
        </div>` : ''}
      <input id="${nome}" name="${nome}" type="file" accept="image/*">
    </div>`;

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${voltar}">‹ Cancelar</a></header>
    <h1 style="margin-bottom:6px">${id ? 'Editar medicamento' : 'Novo medicamento'}</h1>
    <p class="acesso">${esc(r.p.nome)}</p>

    <form id="form-med" novalidate>
      <div class="campo">
        <label for="nome-com">Nome do remédio</label>
        <input id="nome-com" name="nome_comercial" required value="${esc(m.nome_comercial)}" placeholder="Como está na caixa" autocomplete="off">
      </div>
      <div class="campo">
        <label for="ativo">Princípio ativo</label>
        <input id="ativo" name="principio_ativo" value="${esc(m.principio_ativo)}" placeholder="Ex.: losartana potássica" autocomplete="off">
        <span class="ajuda">Fica escrito na caixa, abaixo do nome. É por ele que os médicos avaliam interações.</span>
      </div>
      <div class="linha-dupla">
        <div class="campo"><label for="conc">Concentração</label>
          <input id="conc" name="concentracao" value="${esc(m.concentracao)}" placeholder="Ex.: 50 mg"></div>
        <div class="campo"><label for="forma">Forma</label>
          <input id="forma" name="forma" list="lista-formas" value="${esc(m.forma)}" placeholder="Ex.: comprimido"></div>
      </div>
      <div class="linha-dupla">
        <div class="campo"><label for="dose">Dose</label>
          <input id="dose" name="dose" value="${esc(m.dose)}" placeholder="Ex.: 1 comprimido"></div>
        <div class="campo"><label for="via">Via</label>
          <input id="via" name="via" list="lista-vias" value="${esc(m.via)}" placeholder="Ex.: oral"></div>
      </div>
      <datalist id="lista-formas">${FORMAS.map((x) => `<option value="${x}">`).join('')}</datalist>
      <datalist id="lista-vias">${VIAS.map((x) => `<option value="${x}">`).join('')}</datalist>

      <div class="campo">
        <label for="motivo">Para que serve</label>
        <input id="motivo" name="motivo" value="${esc(m.motivo)}" placeholder="Ex.: pressão alta">
      </div>

      <fieldset>
        <legend>Horários</legend>
        <label class="marcar">
          <input type="checkbox" name="se_necessario" id="sos" ${m.se_necessario ? 'checked' : ''}>
          <span><strong>Tomar só quando necessário</strong><br>
          <span class="ajuda" style="display:inline">Para remédios sem horário fixo, como analgésicos. Não entram nas doses do dia.</span></span>
        </label>
        <div id="area-horarios" ${m.se_necessario ? 'hidden' : ''}>
          <div id="horarios"></div>
          <button class="botao secundario" type="button" id="add-horario">Adicionar horário</button>
        </div>
        <div class="campo" style="margin-top:18px">
          <label for="posologia">Posologia, como está na receita</label>
          <input id="posologia" name="posologia" value="${esc(m.posologia)}" placeholder="Ex.: de 12 em 12 horas, após as refeições">
        </div>
      </fieldset>

      <fieldset>
        <legend>Período</legend>
        <div class="linha-dupla">
          <div class="campo"><label for="ini">Início</label>
            <input id="ini" name="data_inicio" type="date" value="${esc(m.data_inicio || (id ? '' : hojeNoFuso(r.p.fuso_horario || FUSO_PADRAO)))}"></div>
          <div class="campo"><label for="fim">Fim previsto</label>
            <input id="fim" name="data_fim" type="date" value="${esc(m.data_fim)}"></div>
        </div>
        <label class="marcar">
          <input type="checkbox" name="uso_continuo" ${m.uso_continuo ? 'checked' : ''}>
          <span><strong>Uso contínuo</strong><br><span class="ajuda" style="display:inline">Sem data para terminar</span></span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Fotos</legend>
        ${campoFoto('foto_caixa', 'Foto da caixa', m.foto_caixa_path)}
        ${campoFoto('foto_receita', 'Foto da receita', m.foto_receita_path)}
      </fieldset>

      <div class="campo">
        <label for="obs">Observações</label>
        <textarea id="obs" name="observacoes" placeholder="Ex.: tomar em jejum">${esc(m.observacoes)}</textarea>
      </div>

      <div class="botoes">
        <button class="botao principal" type="submit">${id ? 'Salvar alterações' : 'Salvar medicamento'}</button>
      </div>
    </form>`;

  // ---- editor de horários
  const caixa = document.getElementById('horarios');
  const novaLinha = (h = { hora: '08:00', dias_semana: [0, 1, 2, 3, 4, 5, 6] }) => {
    const div = document.createElement('div');
    div.className = 'horario';
    if (h.id) div.dataset.id = h.id;
    const dias = (h.dias_semana || []).map(Number);
    div.innerHTML = `
      <div class="horario-topo">
        <input type="time" value="${hhmm(h.hora)}" aria-label="Horário" required>
        <button type="button" class="botao discreto remover">Remover</button>
      </div>
      <div class="dias" role="group" aria-label="Dias da semana">
        ${DIAS_CURTOS.map((d, i) => `<button type="button" class="dia" data-dia="${i}"
          aria-pressed="${dias.includes(i)}" aria-label="${DIAS_LONGOS[i]}">${d[0]}</button>`).join('')}
      </div>`;
    div.querySelector('.remover').onclick = () => div.remove();
    div.querySelectorAll('.dia').forEach((b) => b.onclick = () =>
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));
    caixa.appendChild(div);
    return div;
  };
  horariosIniciais.forEach(novaLinha);
  if (!id && !m.se_necessario) novaLinha();
  document.getElementById('add-horario').onclick = () => novaLinha().querySelector('input').focus();
  document.getElementById('sos').onchange = (e) => { document.getElementById('area-horarios').hidden = e.target.checked; };

  // ---- salvar
  const form = document.getElementById('form-med');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const txt = (k) => (f.get(k) || '').toString().trim() || null;
    const sos = !!f.get('se_necessario');

    const linhas = sos ? [] : [...caixa.querySelectorAll('.horario')].map((div) => ({
      id: div.dataset.id || null,
      hora: div.querySelector('input[type=time]').value,
      dias_semana: [...div.querySelectorAll('.dia[aria-pressed=true]')].map((b) => +b.dataset.dia)
    }));

    if (!txt('nome_comercial')) return mostrarErro(form, 'Digite o nome do remédio.');
    if (linhas.some((l) => !l.hora)) return mostrarErro(form, 'Preencha a hora de cada horário, ou remova o que não usar.');
    if (linhas.some((l) => !l.dias_semana.length)) return mostrarErro(form, 'Cada horário precisa de pelo menos um dia da semana.');
    if (txt('data_inicio') && txt('data_fim') && txt('data_fim') < txt('data_inicio'))
      return mostrarErro(form, 'A data de fim não pode ser antes do início.');

    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Salvando…');
    try {
      // fotos
      const fotos = {};
      const paraApagar = [];
      for (const [campo, coluna] of [['foto_caixa', 'foto_caixa_path'], ['foto_receita', 'foto_receita_path']]) {
        const arq = f.get(campo);
        if (arq && arq.size) {
          fotos[coluna] = await enviarFoto(perfilId, arq);
          if (m[coluna]) paraApagar.push(m[coluna]);
        } else if (f.get('remover_' + campo) && m[coluna]) {
          fotos[coluna] = null;
          paraApagar.push(m[coluna]);
        }
      }

      const dados = {
        nome_comercial: txt('nome_comercial'),
        principio_ativo: txt('principio_ativo'),
        concentracao: txt('concentracao'),
        forma: txt('forma'),
        dose: txt('dose'),
        via: txt('via'),
        motivo: txt('motivo'),
        posologia: txt('posologia'),
        data_inicio: txt('data_inicio'),
        data_fim: txt('data_fim'),
        uso_continuo: !!f.get('uso_continuo'),
        se_necessario: sos,
        observacoes: txt('observacoes'),
        ...fotos
      };

      let medId = id;
      if (id) {
        const { error } = await sb.from('medicamentos').update(dados).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('medicamentos').insert({ ...dados, perfil_id: perfilId }).select('id').single();
        if (error) throw error;
        medId = data.id;
      }

      // horários: remove os que saíram, atualiza os que ficaram, cria os novos
      const ficaram = linhas.filter((l) => l.id).map((l) => l.id);
      const sairam = (m.horarios || []).filter((h) => !ficaram.includes(h.id)).map((h) => h.id);
      if (sairam.length) {
        const { error } = await sb.from('horarios').delete().in('id', sairam);
        if (error) throw error;
      }
      for (const l of linhas.filter((x) => x.id)) {
        const { error } = await sb.from('horarios').update({ hora: l.hora, dias_semana: l.dias_semana, ativo: true }).eq('id', l.id);
        if (error) throw error;
      }
      const novos = linhas.filter((l) => !l.id).map((l) => ({ medicamento_id: medId, hora: l.hora, dias_semana: l.dias_semana }));
      if (novos.length) {
        const { error } = await sb.from('horarios').insert(novos);
        if (error) throw error;
      }

      apagarFotos(paraApagar);
      ocupado(b, false);
      aviso(id ? 'Alterações salvas' : 'Medicamento salvo');
      location.hash = `#/medicamento/${medId}`;
    } catch (e) {
      ocupado(b, false);
      mostrarErro(form, mensagemErro(e));
      form.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

// ======================================================================
// Doses do dia
// ======================================================================
const TOLERANCIA_ATRASO = 30 * 60000; // 30 minutos

// Monta a lista de doses programadas para hoje nos perfis informados
export async function calcularDosesHoje(perfis) {
  if (!perfis.length) return [];
  const porId = Object.fromEntries(perfis.map((p) => [p.id, p]));
  const [{ data: meds, error }, { data: doses }] = await Promise.all([
    sb.from('medicamentos')
      .select('id, perfil_id, nome_comercial, concentracao, dose, data_inicio, data_fim, horarios(id, hora, dias_semana, ativo)')
      .eq('situacao', 'em_uso').eq('se_necessario', false)
      .in('perfil_id', perfis.map((p) => p.id)),
    sb.from('doses').select('id, horario_id, previsto_para, registrado_em, status, registrado_por')
      .not('horario_id', 'is', null)
      .gte('previsto_para', new Date(Date.now() - 40 * 3600000).toISOString())
  ]);
  if (error) throw error;

  const itens = [];
  const agora = Date.now();
  for (const m of meds || []) {
    const p = porId[m.perfil_id];
    if (!p) continue;
    const fuso = p.fuso_horario || FUSO_PADRAO;
    const hoje = hojeNoFuso(fuso);
    if (m.data_inicio && hoje < m.data_inicio) continue;
    if (m.data_fim && hoje > m.data_fim) continue;
    const dow = diaDaSemana(hoje);
    for (const h of m.horarios || []) {
      if (!h.ativo || !(h.dias_semana || []).map(Number).includes(dow)) continue;
      const previsto = instante(fuso, hoje, hhmm(h.hora));
      const dose = (doses || []).find((d) => d.horario_id === h.id &&
        Math.abs(new Date(d.previsto_para).getTime() - previsto.getTime()) < 60000);
      const estadoDose = dose ? dose.status
        : previsto.getTime() < agora - TOLERANCIA_ATRASO ? 'atrasada' : 'pendente';
      itens.push({ med: m, perfil: p, horario: h, previsto, dose, estado: estadoDose, fuso });
    }
  }
  itens.sort((a, b) => a.previsto - b.previsto || a.perfil.nome.localeCompare(b.perfil.nome));
  return itens;
}

// Perfis que a pessoa acompanha (todos os que ela pode ver)
async function perfisVisiveis() {
  const [{ data: perfis, error }, { data: compart }] = await Promise.all([
    sb.from('perfis').select('id, nome, dono_id, usuario_vinculado_id, fuso_horario').order('nome'),
    sb.from('compartilhamentos').select('perfil_id, nivel').eq('usuario_id', estado.eu.id)
  ]);
  if (error) throw error;
  for (const p of perfis) p.acesso = acessoAoPerfil(p, compart || []);
  return perfis;
}

// Resumo para a tela inicial
export async function resumoDoDia(perfis) {
  try {
    const itens = await calcularDosesHoje(perfis);
    if (!itens.length) return null;
    const atrasadas = itens.filter((i) => i.estado === 'atrasada').length;
    const pendentes = itens.filter((i) => i.estado === 'pendente').length;
    return { total: itens.length, atrasadas, pendentes };
  } catch {
    return null;
  }
}

let filtroHoje = 'todos';
try { filtroHoje = localStorage.getItem('cris-filtro-hoje') || 'todos'; } catch {}

export async function telaHoje() {
  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
    <div class="carregando" style="padding-top:20vh">Carregando doses…</div>`;
  let perfis, itens, nomes;
  try {
    perfis = await perfisVisiveis();
    [itens, nomes] = await Promise.all([calcularDosesHoje(perfis), nomesUsuarios()]);
  } catch (e) {
    return erroTela(mensagemErro(e), '#/');
  }

  const comDoses = perfis.filter((p) => itens.some((i) => i.perfil.id === p.id));
  if (filtroHoje !== 'todos' && !comDoses.some((p) => p.id === filtroHoje)) filtroHoje = 'todos';
  const visiveis = filtroHoje === 'todos' ? itens : itens.filter((i) => i.perfil.id === filtroHoje);
  const variosPerfis = comDoses.length > 1;

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSO_PADRAO });

  const cartao = (i, n) => {
    const quem = i.dose ? primeiroNome(nomes[i.dose.registrado_por]) : '';
    const meu = i.dose?.registrado_por === estado.eu.id;
    const podeDesfazer = i.dose && (meu || podeEditarNivel(i.perfil.acesso.nivel));
    return `
      <li class="dose dose-${i.estado}" style="--cor-perfil:${corDoPerfil(i.perfil.id)}">
        <div class="dose-hora">${hhmm(i.horario.hora)}</div>
        <div class="dose-corpo">
          <a class="dose-nome" href="#/medicamento/${i.med.id}">${esc(nomeCompleto(i.med))}</a>
          ${i.med.dose ? `<span class="dose-detalhe">${esc(i.med.dose)}</span>` : ''}
          ${variosPerfis ? `<span class="dose-perfil"><span class="ponto" aria-hidden="true"></span>${esc(i.perfil.nome)}</span>` : ''}
          ${i.dose ? `
            <span class="dose-feita">${i.dose.status === 'tomado' ? 'Tomado' : 'Pulado'} às ${horaLocal(i.dose.registrado_em, i.fuso)}${quem ? ` por ${esc(quem)}` : ''}</span>
            ${podeDesfazer ? `<button class="botao discreto desfazer" data-n="${n}">Desfazer</button>` : ''}
          ` : `
            ${i.estado === 'atrasada' ? '<span class="dose-alerta">Atrasada</span>' : ''}
            <div class="dose-acoes">
              <button class="botao principal tomar" data-n="${n}">Tomei</button>
              <button class="botao discreto pular" data-n="${n}">Pular</button>
            </div>`}
        </div>
      </li>`;
  };

  const grupos = [
    ['Atrasadas', visiveis.filter((i) => i.estado === 'atrasada')],
    ['Próximas', visiveis.filter((i) => i.estado === 'pendente')],
    ['Feitas', visiveis.filter((i) => i.dose)]
  ];

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
    <h1>Doses de hoje</h1>
    <p class="acesso" style="margin-top:4px">${esc(hoje.charAt(0).toUpperCase() + hoje.slice(1))}</p>

    ${variosPerfis ? `
      <div class="campo">
        <label for="filtro">Mostrar</label>
        <select id="filtro">
          <option value="todos">Todos os perfis</option>
          ${comDoses.map((p) => `<option value="${p.id}" ${filtroHoje === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}
        </select>
      </div>` : ''}

    ${!itens.length ? `
      <div class="vazio">
        <p><strong>Nenhuma dose programada para hoje.</strong></p>
        <p>As doses aparecem aqui quando um medicamento em uso tem horários cadastrados.</p>
      </div>` : ''}

    ${grupos.map(([titulo, lista]) => lista.length ? `
      <section class="grupo">
        <h2>${titulo}</h2>
        <ul class="doses">${lista.map((i) => cartao(i, visiveis.indexOf(i))).join('')}</ul>
      </section>` : '').join('')}
  `;

  const filtro = document.getElementById('filtro');
  if (filtro) filtro.onchange = () => {
    filtroHoje = filtro.value;
    try { localStorage.setItem('cris-filtro-hoje', filtroHoje); } catch {}
    telaHoje();
  };

  const registrar = async (botao, status) => {
    const i = visiveis[+botao.dataset.n];
    botao.closest('.dose').querySelectorAll('button').forEach((x) => x.disabled = true);
    const { error } = await sb.from('doses').insert({
      medicamento_id: i.med.id, horario_id: i.horario.id, previsto_para: i.previsto.toISOString(),
      status, registrado_por: estado.eu.id
    });
    if (error) aviso(ehDuplicado(error) ? 'Outra pessoa já registrou esta dose' : mensagemErro(error));
    else aviso(status === 'tomado' ? 'Dose registrada' : 'Dose marcada como pulada');
    telaHoje();
  };
  app.querySelectorAll('.tomar').forEach((b) => b.onclick = () => registrar(b, 'tomado'));
  app.querySelectorAll('.pular').forEach((b) => b.onclick = () => registrar(b, 'pulado'));
  app.querySelectorAll('.desfazer').forEach((b) => b.onclick = async () => {
    const i = visiveis[+b.dataset.n];
    b.disabled = true;
    const { error } = await sb.from('doses').delete().eq('id', i.dose.id);
    if (error) aviso(mensagemErro(error)); else aviso('Registro desfeito');
    telaHoje();
  });
}
