// CRIS — ficha de emergência
// Mostra o essencial para um atendimento de urgência. Cada ficha aberta fica
// salva neste aparelho e abre mesmo sem internet. É apagada ao sair do CRIS.
import { sb, app, estado, esc, idade, dataBR, corDoPerfil, primeiroNome, hhmm, descreverDias } from './base.js';
import { medicosDoPerfil, contatosMedico } from './saude.js';

const CHAVE = (id) => `cris-ficha-${id}`;
const INDICE = 'cris-fichas';
const GRAV = { leve: 'leve', moderada: 'moderada', grave: 'GRAVE' };

function ler(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; } }
function gravar(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem espaço ou bloqueado */ } }

export function fichasSalvas() {
  return (ler(INDICE) || []).filter((f) => ler(CHAVE(f.id)));
}

export function apagarFichasSalvas() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('cris-ficha')).forEach((k) => localStorage.removeItem(k));
  } catch { /* nada a fazer */ }
}

async function buscarFicha(id) {
  const [{ data: p, error }, { data: alergias }, { data: condicoes }, { data: meds }, medicos] = await Promise.all([
    sb.from('perfis').select('*').eq('id', id).maybeSingle(),
    sb.from('alergias').select('substancia, tipo, gravidade, reacao').eq('perfil_id', id).order('substancia'),
    sb.from('condicoes').select('nome, desde').eq('perfil_id', id).eq('ativa', true).order('nome'),
    sb.from('medicamentos')
      .select('nome_comercial, concentracao, principio_ativo, dose, posologia, se_necessario, motivo, horarios(hora, dias_semana, ativo), profissionais(nome, especialidade)')
      .eq('perfil_id', id).eq('situacao', 'em_uso').order('nome_comercial'),
    medicosDoPerfil(id)
  ]);
  if (error) throw error;
  if (!p) return null;
  return {
    salvoEm: new Date().toISOString(),
    perfil: {
      id: p.id, nome: p.nome, data_nascimento: p.data_nascimento, tipo_sanguineo: p.tipo_sanguineo,
      contato_emergencia_nome: p.contato_emergencia_nome, contato_emergencia_telefone: p.contato_emergencia_telefone,
      plano_saude: p.plano_saude, observacoes: p.observacoes
    },
    alergias: alergias || [],
    condicoes: condicoes || [],
    medicamentos: (meds || []).map((m) => ({
      nome: [m.nome_comercial, m.concentracao].filter(Boolean).join(' '),
      principio_ativo: m.principio_ativo,
      dose: m.dose,
      quando: m.se_necessario ? 'quando necessário'
        : (m.horarios || []).filter((h) => h.ativo).sort((a, b) => a.hora.localeCompare(b.hora))
          .map((h) => hhmm(h.hora) + (descreverDias(h.dias_semana) === 'todos os dias' ? '' : ` (${descreverDias(h.dias_semana)})`))
          .join(', ') || m.posologia || '',
      motivo: m.motivo,
      medico: m.profissionais ? m.profissionais.nome : null
    })),
    medicos: medicos.map((m) => ({
      nome: m.nome, especialidade: m.especialidade, telefone: m.telefone, whatsapp: m.whatsapp, email: m.email, clinica: m.clinica
    }))
  };
}

function htmlFicha(f, offline) {
  const p = f.perfil;
  const i = idade(p.data_nascimento);
  const tel = (t) => t ? `<a href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>` : '';
  const salvo = new Date(f.salvoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  return `
    <header class="topo nao-imprimir">
      <a class="voltar" href="${estado.sessao ? `#/perfil/${p.id}` : '#/'}">‹ ${estado.sessao ? esc(primeiroNome(p.nome)) : 'Voltar'}</a>
      <button class="botao discreto" id="imprimir">Imprimir ou PDF</button>
    </header>

    ${offline ? `<p class="aviso-offline">Sem internet. Mostrando a ficha salva neste aparelho em ${esc(salvo)}.</p>` : ''}

    <article class="ficha-emergencia" style="--cor-perfil:${corDoPerfil(p.id)}">
      <div class="fe-topo">
        <p class="fe-rotulo">Ficha de emergência</p>
        <h1>${esc(p.nome)}</h1>
        <p>${[i !== null ? `${i} anos` : null, p.data_nascimento ? `nascimento ${dataBR(p.data_nascimento)}` : null].filter(Boolean).join(', ') || 'Idade não informada'}</p>
      </div>

      <dl class="fe-resumo">
        <div><dt>Tipo sanguíneo</dt><dd>${esc(p.tipo_sanguineo) || 'Não informado'}</dd></div>
        <div><dt>Plano de saúde</dt><dd>${esc(p.plano_saude) || 'Não informado'}</dd></div>
      </dl>

      <section class="fe-secao fe-alergias">
        <h2>Alergias</h2>
        ${f.alergias.length ? `<ul>${f.alergias.map((a) => `
          <li><strong>${esc(a.substancia)}</strong>${a.gravidade ? `, ${GRAV[a.gravidade]}` : ''}${a.reacao ? `: ${esc(a.reacao)}` : ''}</li>`).join('')}</ul>`
        : '<p>Nenhuma alergia registrada.</p>'}
      </section>

      <section class="fe-secao">
        <h2>Medicamentos em uso</h2>
        ${f.medicamentos.length ? `<ul class="fe-meds">${f.medicamentos.map((m) => `
          <li>
            <strong>${esc(m.nome)}</strong>${m.principio_ativo ? ` <em>(${esc(m.principio_ativo)})</em>` : ''}
            <span>${esc([m.dose, m.quando].filter(Boolean).join(', '))}</span>
            ${m.motivo || m.medico ? `<span class="fe-sub">${esc([m.motivo, m.medico && `receitado por ${m.medico}`].filter(Boolean).join('; '))}</span>` : ''}
          </li>`).join('')}</ul>`
        : '<p>Nenhum medicamento em uso registrado.</p>'}
      </section>

      <section class="fe-secao">
        <h2>Condições de saúde</h2>
        ${f.condicoes.length ? `<ul>${f.condicoes.map((c) => `<li>${esc(c.nome)}${c.desde ? `, desde ${dataBR(c.desde)}` : ''}</li>`).join('')}</ul>`
        : '<p>Nenhuma condição registrada.</p>'}
      </section>

      ${p.observacoes ? `<section class="fe-secao"><h2>Observações</h2><p>${esc(p.observacoes).replace(/\n/g, '<br>')}</p></section>` : ''}

      <section class="fe-secao">
        <h2>Contato de emergência</h2>
        ${p.contato_emergencia_nome || p.contato_emergencia_telefone
          ? `<p class="fe-contato">${esc(p.contato_emergencia_nome || '')} ${tel(p.contato_emergencia_telefone)}</p>`
          : '<p>Não informado.</p>'}
      </section>

      ${f.medicos.length ? `
        <section class="fe-secao">
          <h2>Médicos</h2>
          <ul>${f.medicos.map((m) => `
            <li><strong>${esc(m.nome)}</strong>${m.especialidade ? `, ${esc(m.especialidade)}` : ''}
              <div class="contatos">${contatosMedico(m)}</div></li>`).join('')}</ul>
        </section>` : ''}

      <p class="fe-rodape">Dados do app CRIS, atualizados em ${esc(salvo)}.</p>
    </article>`;
}

function mostrar(f, offline) {
  app.innerHTML = htmlFicha(f, offline);
  document.getElementById('imprimir').onclick = () => window.print();
}

export async function telaFicha(id) {
  const salva = ler(CHAVE(id));
  if (!estado.sessao) {
    if (salva) return mostrar(salva, true);
    location.hash = '#/';
    return;
  }
  if (salva && !navigator.onLine) return mostrar(salva, true);
  app.innerHTML = salva ? htmlFicha(salva, false) : `<div class="carregando">Carregando ficha…</div>`;
  try {
    // Conexão fraca (comum em hospitais): depois de 6 segundos, mostra a ficha salva
    const limite = new Promise((_, falha) => setTimeout(() => falha(new Error('tempo esgotado')), 6000));
    const f = await Promise.race([buscarFicha(id), limite]);
    if (!f) { app.innerHTML = `<header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header><div class="erro">Perfil não encontrado ou sem acesso.</div>`; return; }
    if (!estado.sessao) return;
    gravar(CHAVE(id), f);
    gravar(INDICE, [...fichasSalvas().filter((x) => x.id !== id), { id, nome: f.perfil.nome }]);
    mostrar(f, false);
  } catch {
    if (salva) mostrar(salva, true);
    else app.innerHTML = `<header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
      <div class="erro">Sem internet, e esta ficha ainda não foi salva neste aparelho. Abra a ficha uma vez com internet para ela ficar disponível offline.</div>`;
  }
}

// Atualiza em segundo plano as fichas dos perfis que a pessoa acompanha
export async function atualizarFichas(perfis) {
  const uid = estado.sessao?.user?.id;
  const aindaLogado = () => uid && estado.sessao?.user?.id === uid;
  for (const p of perfis) {
    try {
      const f = await buscarFicha(p.id);
      if (!aindaLogado()) return;
      if (f) gravar(CHAVE(p.id), f);
    } catch { return; }
  }
  if (aindaLogado()) gravar(INDICE, perfis.map((p) => ({ id: p.id, nome: p.nome })));
}

// Lista de fichas para quando não há internet
export function htmlFichasOffline() {
  const fichas = fichasSalvas();
  if (!fichas.length) return '';
  return `
    <section class="bloco">
      <h2>Fichas de emergência salvas neste aparelho</h2>
      <ul class="lista-med">${fichas.map((f) => `<li><a href="#/ficha/${f.id}"><span class="med-nome">${esc(f.nome)}</span></a></li>`).join('')}</ul>
    </section>`;
}
