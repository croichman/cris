// CRIS — administração do sistema: famílias e masters
// O administrador vê só nomes, contagens e masters. Dados de saúde de outras famílias
// ficam bloqueados pelas regras do banco.
import { sb, app, estado, esc, aviso, dataBR, mensagemErro, ocupado, mostrarErro } from './base.js';
import { chamarFuncao } from './familia.js';

export async function telaAdmin() {
  if (!estado.eu?.admin_sistema) { location.hash = '#/'; return; }
  app.innerHTML = `<div class="carregando">Carregando…</div>`;

  const { data: familias, error } = await sb.rpc('admin_familias');
  if (error) {
    app.innerHTML = `<header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
      <div class="erro">${esc(mensagemErro(error))}</div>`;
    return;
  }

  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/">‹ Perfis</a></header>
    <h1 style="margin-bottom:6px">Administração</h1>
    <p class="acesso">Você gerencia as famílias e quem é master de cada uma. Daqui não é possível ver
      dados de saúde: cada família só enxerga os próprios perfis.</p>

    <section class="bloco">
      <h2>Convidar master</h2>
      <p class="acesso">Crie uma família nova ou escolha uma existente. A pessoa recebe um e-mail e entra
        como master daquela família; depois ela mesma convida os demais.</p>
      <form id="form-master" novalidate>
        <div class="campo"><label for="adm-familia">Família</label>
          <select id="adm-familia" name="familia_id">
            <option value="">Nova família</option>
            ${familias.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}
          </select></div>
        <div class="campo" id="campo-nome-familia"><label for="adm-nome-familia">Nome da nova família</label>
          <input id="adm-nome-familia" name="nome_familia" maxlength="80" autocomplete="off" placeholder="Ex.: Família Silva"></div>
        <div class="campo"><label for="adm-nome">Nome de quem vai ser master</label>
          <input id="adm-nome" name="nome" autocomplete="off"></div>
        <div class="campo"><label for="adm-email">E-mail</label>
          <input id="adm-email" name="email" type="email" inputmode="email" autocomplete="off" required></div>
        <button class="botao principal" type="submit">Enviar convite</button>
      </form>
    </section>

    <section class="grupo">
      <h2>Famílias (${familias.length})</h2>
      <ul class="pessoas">${familias.map((f) => `
        <li>
          <span class="pessoa-nome">${esc(f.nome)}${f.id === estado.eu.familia_id ? '<span class="selo">Sua</span>' : ''}</span>
          <span class="med-quando">${f.pessoas} ${f.pessoas == 1 ? 'pessoa' : 'pessoas'} · ${f.perfis} ${f.perfis == 1 ? 'perfil' : 'perfis'}</span>
          <span class="med-quando">Master: ${esc(f.masters || 'convite ainda não aceito')}</span>
          <span class="med-quando">Criada em ${dataBR(String(f.criado_em).slice(0, 10))}</span>
        </li>`).join('')}</ul>
    </section>`;

  const form = document.getElementById('form-master');
  const campoNome = document.getElementById('campo-nome-familia');
  form.familia_id.onchange = () => { campoNome.hidden = !!form.familia_id.value; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const familia_id = form.familia_id.value;
    const nome_familia = form.nome_familia.value.trim();
    const email = form.email.value.trim().toLowerCase();
    const nome = form.nome.value.trim();
    if (!familia_id && !nome_familia) return mostrarErro(form, 'Digite o nome da nova família.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarErro(form, 'Digite um e-mail válido.');
    const b = form.querySelector('[type=submit]');
    ocupado(b, true, 'Enviando…');
    const r = await chamarFuncao({ acao: 'convidar_master', familia_id, nome_familia, email, nome });
    ocupado(b, false);
    if (!r.ok) return mostrarErro(form, r.erro);
    aviso(`Convite enviado para ${email}`);
    telaAdmin();
  });
}
