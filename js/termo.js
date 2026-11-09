// CRIS — termo de consentimento
// Ao mudar o texto de forma relevante: aumente TERMO_VERSAO aqui, publique o app e
// depois mude termo_versao_atual() no banco. A versão exigida vem sempre do banco,
// então todos precisarão aceitar de novo assim que o banco mudar.
import { sb, app, estado, esc, aviso, mensagemErro, ocupado, mostrarErro } from './base.js';

export const TERMO_VERSAO = 2;          // versão do texto abaixo
export const TERMO_DATA = '09/11/2026';
const ADMIN_SISTEMA = 'Carlos Roichman'; // responsável pelo CRIS

async function nomesDosMasters() {
  // As regras do banco só mostram pessoas da própria família
  const { data } = await sb.from('usuarios').select('nome, email').eq('papel', 'master').order('nome');
  const nomes = (data || []).map((u) => u.nome || u.email).filter(Boolean);
  if (!nomes.length) return 'os responsáveis pela sua família no app';
  if (nomes.length === 1) return nomes[0];
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}

async function textoDoTermo() {
  const masters = esc(await nomesDosMasters());
  return `
    <article class="termo">
      <h1>Termo de consentimento</h1>
      <p class="acesso">Versão ${TERMO_VERSAO}, de ${TERMO_DATA}</p>

      <p>O CRIS é um app de uso familiar, em fase de testes (Beta) e sem fins comerciais. Ele serve
      para registrar medicamentos, médicos, vacinas e outras informações de saúde, e para facilitar o
      cuidado entre familiares. Cada família usa o app separadamente: as informações de uma família não
      ficam visíveis para as outras. Para usar o app, você precisa ler e concordar com este termo.</p>

      <h2>Quais dados são registrados</h2>
      <ul>
        <li>Seu nome e e-mail, usados para entrar no app.</li>
        <li>Informações de saúde: medicamentos, doses tomadas, horários, alergias, condições de saúde,
        vacinas, médicos, tipo sanguíneo, plano de saúde e fotos de receitas, caixas e cartões de vacina.</li>
        <li>Os dados de outras pessoas que você cadastrar ou acompanhar.</li>
        <li>O histórico de alterações: quem mudou cada informação e quando.</li>
      </ul>
      <p>Informações de saúde são consideradas dados pessoais sensíveis pela Lei Geral de Proteção
      de Dados (LGPD).</p>

      <h2>Para que os dados são usados</h2>
      <p>Somente para organizar tratamentos, lembrar horários de remédios, ter as informações à mão
      numa emergência e apresentá-las a profissionais de saúde. Os dados não são vendidos, não são
      usados para publicidade e não são compartilhados fora da sua família.</p>

      <h2>Quem pode ver os seus dados</h2>
      <ul>
        <li><strong>Você</strong>, nos perfis que são seus ou que você cadastrou.</li>
        <li><strong>Os masters da sua família</strong>, que podem ver e editar todos os perfis da família. Hoje: ${masters}.</li>
        <li><strong>Sub-masters</strong>, quando você estiver sob a responsabilidade de um deles.</li>
        <li><strong>Familiares com quem um perfil for compartilhado</strong>, só para consulta ou também
        para edição, conforme definido por quem gerencia o perfil.</li>
      </ul>
      <p>Ao aceitar, você concorda de forma expressa que essas pessoas acessem os seus dados de saúde
      nessas condições. Pessoas de outras famílias não têm acesso aos seus dados.</p>

      <h2>Administração do app</h2>
      <p>O CRIS é mantido por ${esc(ADMIN_SISTEMA)}, administrador do sistema. Ele cria as famílias e
      convida quem vai ser master de cada uma, e por isso consegue ver o nome das famílias, o nome e o
      e-mail dos masters e a quantidade de pessoas e perfis de cada família. As regras do banco de dados
      <strong>não permitem</strong> que o administrador veja informações de saúde de outras famílias.
      Ele só tem acesso aos dados da família da qual ele mesmo faz parte, como qualquer outro master.</p>

      <h2>Dados de outras pessoas</h2>
      <p>Só cadastre informações de outra pessoa se você for responsável por ela, como filhos menores
      de idade ou alguém sob os seus cuidados, ou se ela tiver autorizado.</p>

      <h2>Onde os dados ficam</h2>
      <p>Os dados são guardados no serviço Supabase, em servidores em São Paulo, com acesso protegido
      por login. As fotos são privadas e só abrem para quem tem acesso ao perfil. Os códigos de acesso
      são enviados por e-mail pelo Gmail. Nenhum sistema é totalmente seguro: não compartilhe os seus
      códigos de acesso com ninguém.</p>

      <h2>Limites do app</h2>
      <p>O CRIS não substitui a orientação de médicos e farmacêuticos e não avalia interações entre
      medicamentos. Decisões sobre tratamentos devem ser tomadas com profissionais de saúde.</p>

      <h2>Seus direitos</h2>
      <p>Você pode consultar, corrigir e excluir os seus dados a qualquer momento. Para retirar este
      consentimento, peça a um master da sua família: ele encerrará o seu acesso e, se você pedir, excluirá os seus
      dados. A retirada não afeta o uso feito antes dela.</p>

      <h2>Mudanças neste termo</h2>
      <p>Se este termo mudar, a nova versão será apresentada no app e precisará ser aceita de novo.</p>

      <p>Ao aceitar, ficam registrados a data, a hora e a versão do termo aceita.</p>
    </article>`;
}

// Tela obrigatória antes do primeiro uso (e a cada nova versão)
export async function telaTermo(aoAceitar, aoRecusar) {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const texto = await textoDoTermo();
  app.innerHTML = `
    <header class="topo"><span class="marca">CRIS</span></header>
    ${texto}
    <form id="form-termo" class="aceite" novalidate>
      <label class="marcar">
        <input type="checkbox" name="concordo" id="concordo">
        <span>Li o termo e concordo com o registro e o compartilhamento dos meus dados de saúde nas condições acima.</span>
      </label>
      <div class="botoes">
        <button class="botao principal" type="submit" id="aceitar" disabled>Aceitar e continuar</button>
        <button class="botao discreto" type="button" id="recusar" style="width:100%">Não aceito, sair</button>
      </div>
    </form>`;

  const form = document.getElementById('form-termo');
  const aceitar = document.getElementById('aceitar');
  document.getElementById('concordo').onchange = (e) => { aceitar.disabled = !e.target.checked; };
  document.getElementById('recusar').onclick = aoRecusar;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!form.concordo.checked) return;
    ocupado(aceitar, true, 'Registrando…');
    const { error } = await sb.from('termo_aceites').insert({
      usuario_id: estado.eu.id,
      versao: estado.termoVersao || TERMO_VERSAO,
      dispositivo: navigator.userAgent.slice(0, 200)
    });
    ocupado(aceitar, false);
    if (error && !/duplicate key/i.test(error.message)) return mostrarErro(form, mensagemErro(error));
    estado.termoAceitoEm = new Date().toISOString();
    aviso('Termo aceito');
    aoAceitar();
  });
}

// Consulta do termo já aceito (a partir de "Minha conta")
export async function telaVerTermo() {
  app.innerHTML = `<div class="carregando">Carregando…</div>`;
  const texto = await textoDoTermo();
  const quando = estado.termoAceitoEm
    ? new Date(estado.termoAceitoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  app.innerHTML = `
    <header class="topo"><a class="voltar" href="#/conta">‹ Minha conta</a></header>
    ${quando ? `<p class="selo-termo">Você aceitou esta versão em ${esc(quando)}</p>` : ''}
    ${texto}`;
}

// Busca o aceite da versão exigida pelo banco
export async function carregarAceite(uid) {
  const { data: v } = await sb.rpc('termo_versao_atual');
  estado.termoVersao = Number(v) || TERMO_VERSAO;
  const { data } = await sb.from('termo_aceites').select('aceito_em')
    .eq('usuario_id', uid).eq('versao', estado.termoVersao).maybeSingle();
  estado.termoAceitoEm = data?.aceito_em || null;
}
