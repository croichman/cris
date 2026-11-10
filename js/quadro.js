// CRIS — quadro semanal de medicamentos (para imprimir ou salvar em PDF)
// Linhas = horários, colunas = dias da semana. Mostra só remédios em uso com horário fixo;
// os de "uso quando necessário" aparecem numa lista separada, abaixo do quadro.
import {
  sb, app, esc, dataBR, primeiroNome, mensagemErro, corDoPerfil, idade,
  perfilComAcesso, FUSO_PADRAO, hojeNoFuso, hhmm
} from './base.js';

// Semana começando na segunda (0 = domingo no banco)
const DIAS = [
  [1, 'Segunda', 'Seg'], [2, 'Terça', 'Ter'], [3, 'Quarta', 'Qua'], [4, 'Quinta', 'Qui'],
  [5, 'Sexta', 'Sex'], [6, 'Sábado', 'Sáb'], [0, 'Domingo', 'Dom']
];

const nomeCompleto = (m) => [m.nome_comercial, m.concentracao].filter(Boolean).join(' ');

export async function telaQuadro(perfilId) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const r = await perfilComAcesso(perfilId, 'id, nome, data_nascimento, dono_id, usuario_vinculado_id, fuso_horario');
  if (r.erro) return erro(r.erro, '#/');
  const p = r.p;
  const hoje = hojeNoFuso(p.fuso_horario || FUSO_PADRAO);

  const { data: meds, error } = await sb.from('medicamentos')
    .select('id, nome_comercial, principio_ativo, concentracao, forma, dose, via, posologia, motivo, data_inicio, data_fim, se_necessario, observacoes, horarios(hora, dias_semana, ativo)')
    .eq('perfil_id', perfilId).eq('situacao', 'em_uso').order('nome_comercial');
  if (error) return erro(mensagemErro(error), `#/perfil/${perfilId}`);

  // Remédios que ainda valem (não terminaram antes de hoje)
  const validos = meds.filter((m) => !m.data_fim || m.data_fim >= hoje);
  const comHorario = validos.filter((m) => !m.se_necessario && (m.horarios || []).some((h) => h.ativo));
  const quandoNecessario = validos.filter((m) => m.se_necessario);

  // Monta a grade: horário -> dia -> [remédios]
  const grade = {};
  for (const m of comHorario) {
    for (const h of m.horarios.filter((x) => x.ativo)) {
      const hora = hhmm(h.hora);
      grade[hora] ||= {};
      for (const d of (h.dias_semana || []).map(Number)) {
        (grade[hora][d] ||= []).push(m);
      }
    }
  }
  const horas = Object.keys(grade).sort();

  const celula = (lista) => lista?.length
    ? lista.map((m) => `
        <div class="q-item">
          <strong>${esc(nomeCompleto(m))}</strong>
          ${m.dose ? `<span>${esc(m.dose)}</span>` : ''}
        </div>`).join('')
    : '<span class="q-vazio" aria-label="Nenhum">–</span>';

  const periodo = (m) => {
    const partes = [];
    if (m.data_inicio && m.data_inicio > hoje) partes.push(`a partir de ${dataBR(m.data_inicio)}`);
    if (m.data_fim) partes.push(`até ${dataBR(m.data_fim)}`);
    return partes.join(', ');
  };

  const detalhe = (m) => `
    <li>
      <strong>${esc(nomeCompleto(m))}</strong>${m.principio_ativo ? ` <span class="q-suave">(${esc(m.principio_ativo)})</span>` : ''}
      <span class="q-suave">${esc([m.dose, m.forma, m.via].filter(Boolean).join(' · '))}</span>
      ${m.posologia ? `<span>${esc(m.posologia)}</span>` : ''}
      ${m.motivo ? `<span class="q-suave">Para: ${esc(m.motivo)}</span>` : ''}
      ${periodo(m) ? `<span class="q-suave">${esc(periodo(m))}</span>` : ''}
      ${m.observacoes ? `<span class="q-suave">${esc(m.observacoes)}</span>` : ''}
    </li>`;

  const i = idade(p.data_nascimento);
  const geradoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: p.fuso_horario || FUSO_PADRAO });

  app.innerHTML = `
    <header class="topo nao-imprimir">
      <a class="voltar" href="#/perfil/${p.id}">‹ ${esc(primeiroNome(p.nome))}</a>
    </header>

    <div class="quadro" style="--cor-perfil:${corDoPerfil(p.id)}">
      <div class="q-cabeca">
        <h1>Quadro de medicamentos</h1>
        <p><strong>${esc(p.nome)}</strong>${i !== null ? ` · ${i} anos` : ''}</p>
        <p class="q-suave">Gerado pelo CRIS em ${esc(geradoEm)}. Confira sempre com a receita médica.</p>
      </div>

      ${horas.length ? `
        <div class="q-rolagem">
          <table class="q-tabela">
            <thead>
              <tr>
                <th scope="col">Horário</th>
                ${DIAS.map(([, longo, curto]) => `<th scope="col"><span class="q-longo">${longo}</span><span class="q-curto">${curto}</span></th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${horas.map((hora) => `
                <tr>
                  <th scope="row">${hora}</th>
                  ${DIAS.map(([d]) => `<td>${celula(grade[hora][d])}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="vazio">
          <p><strong>Nenhum remédio com horário fixo.</strong></p>
          <p>O quadro mostra os medicamentos em uso que têm horários cadastrados.</p>
        </div>`}

      ${quandoNecessario.length ? `
        <section class="q-secao">
          <h2>Uso quando necessário</h2>
          <ul class="q-lista">${quandoNecessario.map(detalhe).join('')}</ul>
        </section>` : ''}

      ${comHorario.length ? `
        <section class="q-secao">
          <h2>Detalhes dos medicamentos do quadro</h2>
          <ul class="q-lista">${comHorario.map(detalhe).join('')}</ul>
        </section>` : ''}
    </div>

    ${horas.length || quandoNecessario.length ? `
      <div class="botoes nao-imprimir">
        <button class="botao principal" id="imprimir">Salvar em PDF ou imprimir</button>
        <p class="acesso">Na janela que abrir, escolha <strong>Salvar como PDF</strong> como destino (ou a sua impressora).
          O quadro sai em folha deitada (paisagem).</p>
      </div>` : ''}`;

  const b = document.getElementById('imprimir');
  if (b) b.onclick = () => {
    // O título vira o nome sugerido para o arquivo PDF
    const antes = document.title;
    document.title = `Quadro de medicamentos - ${p.nome} - ${dataBR(hoje).replace(/\//g, '-')}`;
    const voltar = () => { document.title = antes; window.removeEventListener('afterprint', voltar); };
    window.addEventListener('afterprint', voltar);
    window.print();
    setTimeout(voltar, 60000);
  };
}

function erro(msg, voltar) {
  app.innerHTML = `
    <header class="topo"><a class="voltar" href="${voltar}">‹ Voltar</a></header>
    <div class="erro">${esc(msg)}</div>`;
}
