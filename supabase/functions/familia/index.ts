// CRIS — função "familia" (roda no servidor do Supabase)
// Faz o que o app não pode fazer sozinho, porque exige a chave secreta:
//   • convidar:         masters e sub-masters convidam familiares por e-mail (entram na mesma família)
//   • remover:          masters encerram o acesso de alguém da própria família
//   • convidar_master:  o administrador do sistema cria uma família nova (ou usa uma existente)
//                       e convida quem vai ser master dela
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function chaveSecreta(): string {
  try {
    const chaves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const k = chaves['default'] || Object.values(chaves)[0];
    if (k) return k as string;
  } catch { /* usa a chave antiga abaixo */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder(405, { erro: 'Método não permitido.' });

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 1. Quem está pedindo?
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user }, error: erroLogin } = await admin.auth.getUser(token);
    if (erroLogin || !user) return responder(401, { erro: 'Sua sessão expirou. Entre de novo no app.' });

    const { data: eu } = await admin.from('usuarios')
      .select('id, papel, familia_id, admin_sistema').eq('id', user.id).single();
    if (!eu) return responder(403, { erro: 'Seu cadastro no CRIS não foi encontrado.' });

    const { data: versao } = await admin.rpc('termo_versao_atual');
    const { data: aceite } = await admin.from('termo_aceites').select('id')
      .eq('usuario_id', eu.id).eq('versao', versao).maybeSingle();
    if (!aceite) return responder(403, { erro: 'Aceite o termo de consentimento antes de continuar.' });

    const corpo = await req.json().catch(() => ({}));
    const email = String(corpo.email || '').trim().toLowerCase();
    const nome = String(corpo.nome || '').trim().slice(0, 80);

    const convidar = async (dados: Record<string, unknown>) => {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: dados });
      if (error) {
        if (/already|registered|exists/i.test(error.message))
          return { status: 409, erro: 'Este e-mail já tem acesso ao CRIS (em alguma família). Cada pessoa participa de uma família só.' };
        return { status: 400, erro: error.message };
      }
      return { status: 200, usuario_id: data.user?.id };
    };

    // 2. Convidar alguém para a MINHA família
    if (corpo.acao === 'convidar') {
      if (!['master', 'submaster'].includes(eu.papel))
        return responder(403, { erro: 'Só masters e sub-masters podem convidar.' });
      if (!eu.familia_id) return responder(403, { erro: 'Seu cadastro não está ligado a nenhuma família.' });
      if (!EMAIL.test(email)) return responder(400, { erro: 'E-mail inválido.' });
      // A família é decidida pelo banco: quem é convidado entra na família de quem convidou
      const r = await convidar({ nome, convidado_por: eu.id });
      if (r.erro) return responder(r.status, { erro: r.erro });
      return responder(200, { ok: true, usuario_id: r.usuario_id });
    }

    // 3. Remover acesso (só master, só da própria família). Os perfis da pessoa passam para quem removeu.
    if (corpo.acao === 'remover') {
      if (eu.papel !== 'master') return responder(403, { erro: 'Só masters podem remover acessos.' });
      const alvo = String(corpo.usuario_id || '');
      if (alvo === eu.id) return responder(400, { erro: 'Você não pode remover o seu próprio acesso.' });
      if (!UUID.test(alvo)) return responder(400, { erro: 'Pessoa inválida.' });

      const { data: pessoa } = await admin.from('usuarios').select('id, papel, familia_id').eq('id', alvo).maybeSingle();
      if (!pessoa || !eu.familia_id || pessoa.familia_id !== eu.familia_id)
        return responder(404, { erro: 'Pessoa não encontrada na sua família.' });

      const { error: e1 } = await admin.from('perfis').update({ dono_id: eu.id }).eq('dono_id', alvo);
      if (e1) return responder(400, { erro: e1.message });
      const { error: e2 } = await admin.auth.admin.deleteUser(alvo);
      if (e2) return responder(400, { erro: e2.message });
      return responder(200, { ok: true });
    }

    // 4. Administrador do sistema: criar família e convidar o master
    if (corpo.acao === 'convidar_master') {
      if (!eu.admin_sistema) return responder(403, { erro: 'Só o administrador do sistema pode fazer isso.' });
      if (!EMAIL.test(email)) return responder(400, { erro: 'E-mail inválido.' });

      let familiaId = String(corpo.familia_id || '');
      let criada = false;
      if (familiaId) {
        if (!UUID.test(familiaId)) return responder(400, { erro: 'Família inválida.' });
        const { data: f } = await admin.from('familias').select('id').eq('id', familiaId).maybeSingle();
        if (!f) return responder(404, { erro: 'Família não encontrada.' });
      } else {
        const nomeFamilia = String(corpo.nome_familia || '').trim().slice(0, 80);
        if (!nomeFamilia) return responder(400, { erro: 'Informe o nome da família.' });
        const { data: f, error: ef } = await admin.from('familias').insert({ nome: nomeFamilia }).select('id').single();
        if (ef || !f) return responder(400, { erro: ef?.message || 'Não foi possível criar a família.' });
        familiaId = f.id;
        criada = true;
      }

      const r = await convidar({ nome, convidado_por: eu.id, familia_id: familiaId, papel: 'master' });
      if (r.erro) {
        if (criada) await admin.from('familias').delete().eq('id', familiaId);
        return responder(r.status, { erro: r.erro });
      }
      return responder(200, { ok: true, familia_id: familiaId, usuario_id: r.usuario_id });
    }

    return responder(400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    return responder(500, { erro: (e as Error).message || 'Erro inesperado.' });
  }
});
