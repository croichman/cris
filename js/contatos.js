// CRIS — trazer dados de um contato do celular para o cadastro de médicos
// • Android (Chrome): abre a agenda do celular (Contact Picker API).
// • iPhone e computador: importa um cartão de contato (.vcf), que a agenda gera em "Compartilhar contato".
// Nada é enviado para fora do aparelho: os dados só preenchem o formulário.

export const temSeletorDeContatos = () => 'contacts' in navigator && 'ContactsManager' in window;

// Telefone brasileiro em formato legível: "85 99999-0000"
export function formatarTelefone(bruto) {
  if (!bruto) return '';
  let d = String(bruto).replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(bruto).trim();
}
const ehCelular = (tel) => /^\d{2} 9\d{4}-\d{4}$/.test(formatarTelefone(tel));

// Escolhe telefone fixo e WhatsApp a partir de uma lista [{ numero, tipos }]
function separarTelefones(lista) {
  const tels = lista.filter((t) => t.numero).map((t) => ({ ...t, numero: formatarTelefone(t.numero) }));
  const cel = tels.find((t) => t.tipos.includes('cell')) || tels.find((t) => ehCelular(t.numero));
  const fixo = tels.find((t) => t !== cel) || cel;
  return { telefone: fixo?.numero || '', whatsapp: cel?.numero || '' };
}

// ---------- Android: agenda do celular ----------
// Quais campos o celular oferece: consultado antes do toque, para o botão abrir a agenda sem esperas
let camposDisponiveis = ['name', 'tel', 'email'];
if (temSeletorDeContatos()) {
  navigator.contacts.getProperties().then((p) => { if (p?.length) camposDisponiveis = p; }).catch(() => {});
}

// Devolve { dados, diagnostico }. diagnostico ajuda a entender celulares que respondem diferente.
export async function escolherContato() {
  const pedir = ['name', 'tel', 'email', 'address'].filter((p) => camposDisponiveis.includes(p));
  let lista;
  try {
    lista = await navigator.contacts.select(pedir, { multiple: false });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    // Alguns celulares recusam o pedido de endereço: tenta de novo só com o básico
    lista = await navigator.contacts.select(['name', 'tel', 'email'].filter((p) => camposDisponiveis.includes(p)), { multiple: false });
  }
  const c = Array.isArray(lista) ? lista[0] : null;
  const diagnostico = `pedido: ${pedir.join(',')} · recebido: ${Array.isArray(lista) ? lista.length : typeof lista} contato(s)` +
    (c ? ` · campos: ${Object.keys(c).map((k) => `${k}=${Array.isArray(c[k]) ? c[k].length : c[k] ? 1 : 0}`).join(', ')}` : '');
  if (!c) return { dados: null, diagnostico };
  const end = (c.address || [])[0];
  const endereco = end ? [
    (end.addressLine || []).join(', '), end.dependentLocality, end.city, end.region
  ].filter(Boolean).join(', ') : '';
  return {
    dados: {
      nome: (c.name || []).find(Boolean) || '',
      ...separarTelefones((c.tel || []).map((numero) => ({ numero, tipos: [] }))),
      email: (c.email || []).find(Boolean) || '',
      endereco
    },
    diagnostico
  };
}

// ---------- Cartão de contato (.vcf) ----------
function decodificarQP(texto, charset) {
  const bytes = [];
  const limpo = texto.replace(/=\r?\n/g, '');
  for (let i = 0; i < limpo.length; i++) {
    if (limpo[i] === '=' && /^[0-9A-F]{2}$/i.test(limpo.slice(i + 1, i + 3))) {
      bytes.push(parseInt(limpo.slice(i + 1, i + 3), 16)); i += 2;
    } else bytes.push(limpo.charCodeAt(i));
  }
  try { return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes)); }
  catch { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
}

const desescapar = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

export function lerVcard(texto) {
  // Só o primeiro cartão do arquivo; junta linhas "dobradas" (que continuam com espaço)
  const bloco = (texto.split(/END:VCARD/i)[0] || '').replace(/\r\n/g, '\n');
  const linhas = bloco.replace(/\n[ \t]/g, '').split('\n');
  const campos = [];
  for (let i = 0; i < linhas.length; i++) {
    let linha = linhas[i];
    const pos = linha.indexOf(':');
    if (pos < 0) continue;
    const cab = linha.slice(0, pos);
    let valor = linha.slice(pos + 1);
    const partes = cab.split(';');
    const nome = partes[0].replace(/^item\d+\./i, '').toUpperCase();
    const params = partes.slice(1).join(';').toUpperCase();
    if (/QUOTED-PRINTABLE/.test(params)) {
      while (valor.endsWith('=') && i + 1 < linhas.length) valor = valor.slice(0, -1) + '=\n' + linhas[++i];
      valor = decodificarQP(valor, (params.match(/CHARSET=([^;:]+)/) || [])[1]);
    }
    campos.push({ nome, params, valor });
  }
  if (!campos.length) return null;
  const um = (n) => campos.find((c) => c.nome === n);

  let nome = um('FN') ? desescapar(um('FN').valor) : '';
  if (!nome && um('N')) {
    const [fam, dado, meio, pref] = um('N').valor.split(';').map(desescapar);
    nome = [pref, dado, meio, fam].filter(Boolean).join(' ');
  }
  const tels = campos.filter((c) => c.nome === 'TEL').map((c) => ({
    numero: desescapar(c.valor.replace(/^tel:/i, '')),
    tipos: [/CELL|MOBILE|IPHONE/.test(c.params) ? 'cell' : '', /WORK/.test(c.params) ? 'work' : ''].filter(Boolean)
  }));
  const adr = um('ADR');
  const endereco = adr ? adr.valor.split(';').slice(2, 6).map(desescapar).filter(Boolean).join(', ').replace(/\n/g, ', ') : '';
  const org = um('ORG') ? um('ORG').valor.split(';').map(desescapar).filter(Boolean).join(' – ') : '';
  const cargo = um('TITLE') ? desescapar(um('TITLE').valor) : '';

  return {
    nome,
    ...separarTelefones(tels),
    email: um('EMAIL') ? desescapar(um('EMAIL').valor) : '',
    clinica: org,
    especialidade: cargo,
    endereco,
    observacoes: um('NOTE') ? desescapar(um('NOTE').valor) : ''
  };
}

// Preenche o formulário: só sobrescreve campos para os quais o contato trouxe valor
export function preencherFormulario(form, dados) {
  let n = 0;
  for (const [campo, valor] of Object.entries(dados || {})) {
    const el = form.elements[campo];
    if (el && valor) { el.value = valor; n++; }
  }
  return n;
}
