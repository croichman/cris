# CRIS — Documentação técnica

Central de Registros e Informações de Saúde. Este documento descreve a arquitetura, o modelo de dados,
as regras de segurança e a operação do sistema. Versão do app no momento da escrita: **0.12 Beta**.

---

## 1. Arquitetura

```
 Navegador / PWA instalada (GitHub Pages)
   ├─ js/*.js  ── supabase-js ──►  Supabase
   │                                 ├─ Auth (login por código no e-mail, envio via Gmail SMTP "CRIS-App")
   │                                 ├─ Postgres (todas as tabelas com RLS)
   │                                 ├─ Storage: bucket privado "cris-arquivos"
   │                                 └─ Edge Functions
   │                                      ├─ familia    (convites, remoção, criar família)
   │                                      └─ lembretes  (Web Push; chamada pelo pg_cron)
   └─ sw.js  ◄── Web Push (FCM / Apple Push) ◄── lembretes
```

- **Sem build:** os arquivos do repositório são servidos como estão. `js/vendor/supabase.js` é a biblioteca
  oficial empacotada localmente (sem CDN).
- **Chave pública** do Supabase (`sb_publishable_…`) e a chave pública VAPID ficam em `js/config.js`.
  Elas são públicas por natureza; a proteção dos dados vem das regras RLS.
- **Segredos** (chave secreta do Supabase, chave privada VAPID, `CRON_SECRET`) ficam **somente** em
  Edge Functions → Secrets. Nunca no repositório.

## 2. Módulos do front-end (`js/`)

| Arquivo | Responsabilidade |
|---|---|
| `config.js` | URL e chave pública do Supabase, `VERSAO_APP`, `VAPID_PUBLIC_KEY` |
| `base.js` | Cliente Supabase, estado global, utilitários (fusos, datas, escape HTML, erros, uploads), `acessoAoPerfil`, `pedirHorario` |
| `app.js` | Rotas (hash), login, tela inicial, perfil, formulário de perfil, Minha conta |
| `medicamentos.js` | Medicamentos, horários, registro de doses, tela "Doses de hoje", `perfisAcompanhados` |
| `saude.js` | Alergias, condições, vacinas e médicos |
| `contatos.js` | Preencher médico a partir da agenda (Contact Picker API no Android) ou de cartão `.vcf` (iPhone/computador); nada sai do aparelho |
| `emergencia.js` | Ficha de emergência e cópia offline no `localStorage` |
| `quadro.js` | Quadro semanal (dias × horários) para impressão/PDF |
| `notificacoes.js` | Ativar Web Push no aparelho, escolher perfis acompanhados |
| `familia.js` | Papéis, delegações, convites, compartilhamento de perfil; `chamarFuncao` |
| `admin.js` | Tela de administração do sistema (famílias e masters) |
| `termo.js` | Termo de consentimento (texto, aceite, versão exigida pelo banco) |

Rotas principais: `#/`, `#/hoje`, `#/perfil/:id`, `#/perfil/:id/quadro`, `#/ficha/:id`, `#/medicamento/:id`,
`#/conta`, `#/notificacoes`, `#/familia`, `#/admin`, `#/termo`.

## 3. Modelo de dados (schema `public`)

| Tabela | Conteúdo | Observações |
|---|---|---|
| `familias` | Núcleos familiares | Criadas pelo admin do sistema (via função `familia`) |
| `usuarios` | Pessoas com login | `id` = `auth.users.id`; `papel` (`master`/`submaster`/`membro`), `familia_id`, `admin_sistema` |
| `perfis` | Ficha de cada pessoa | `dono_id` (quem cadastrou), `usuario_vinculado_id` (a própria pessoa, se usa o app), `familia_id`, `fuso_horario` |
| `compartilhamentos` | Acesso extra a um perfil | `nivel` = `ver` ou `editar`; só entre pessoas da mesma família |
| `delegacoes` | Sub-master → pessoa sob responsabilidade | Dá acesso aos perfis cadastrados/vinculados à pessoa |
| `medicamentos` | Remédios de um perfil | `situacao`, `se_necessario`, `lembretes_ativos`, fotos no Storage |
| `horarios` | Horários de um remédio | `hora`, `dias_semana` (0 = domingo) |
| `doses` | Registro de doses | `previsto_para`, `registrado_em` (quando anotou), `tomado_em` (quando tomou), `status` |
| `alergias`, `condicoes`, `vacinas` | Dados de saúde por perfil | |
| `profissionais`, `perfil_profissionais` | Médicos da família e vínculo com perfis | por família |
| `lembrete_destinatarios` | Quem acompanha as doses de qual perfil | Define "Doses de hoje" e quem recebe lembretes |
| `push_inscricoes` | Aparelhos com notificação ativa | `endpoint`, chaves `p256dh`/`auth` |
| `notificacoes_enviadas` | Lembretes já enviados | Evita duplicidade; limpeza após 7 dias |
| `termo_aceites` | Aceites do termo por versão | |
| `historico` | Auditoria de alterações | Preenchido por gatilho em todas as tabelas de saúde |

Arquivos (Storage, bucket `cris-arquivos`, privado): caminho começa com o `id` do perfil
(`<perfil_id>/...`), e a função `perfil_do_arquivo(name)` usa isso nas regras.

## 4. Segurança e permissões

### 4.1 Funções de apoio (todas `security definer`, `search_path = public`)

| Função | Retorna |
|---|---|
| `minha_familia()` | `familia_id` do usuário logado |
| `mesma_familia(u)` | se o usuário `u` é da minha família |
| `sou_admin_sistema()` | se sou administrador do sistema |
| `termo_aceito()` / `termo_versao_atual()` | aceite da versão exigida / número da versão |
| `eh_master()` | se sou master (da minha família) |
| `sou_submaster_de(u)` | se sou sub-master responsável por `u` |
| `pode_ver_perfil(p)` / `pode_editar_perfil(p)` / `pode_gerenciar_perfil(p)` | níveis de acesso ao perfil, sempre dentro da família |
| `admin_familias()` | lista de famílias com contagens (só para o admin; sem dados de saúde) |
| `registrar_push(...)` | grava a inscrição do aparelho para o usuário logado |
| `lembretes_pendentes()` | doses a notificar agora (só `service_role`) |

### 4.2 Regras (RLS)

- Todas as tabelas de saúde usam `pode_ver_perfil` / `pode_editar_perfil` sobre o `perfil_id`.
- `perfis: ver` confere os campos da própria linha (dono, vinculado, master, sub-master) **antes** de
  `pode_ver_perfil(id)`. Isso é necessário porque, no `insert ... returning`, a função ainda não enxerga
  a linha recém-criada (correção de 15/11/2026).
- `usuarios` só mostra pessoas da mesma família.
- Gatilhos `proteger_usuarios` e `proteger_perfis` impedem trocar família, papel (sem ser master da família),
  e-mail, `admin_sistema`, e ligar perfis a pessoas de outra família. Cada família precisa manter ao menos um master.
- `ao_criar_login` (em `auth.users`): o novo usuário entra na família de quem convidou; só o admin do sistema
  pode indicar outra família (ao criar uma nova) e já definir o papel master.

### 4.3 O que o administrador consegue ver

- **Pelo app:** nome das famílias, masters e contagens. As regras não liberam dados de saúde de outras famílias.
- **Pelo painel do Supabase:** o dono do projeto (e quem tiver acesso ao painel ou à chave secreta) consegue ler
  **todo** o banco, porque o painel usa o usuário `postgres`, que não passa pelas regras RLS. O termo de
  consentimento (versão 3) informa isso de forma transparente.
- Medidas atuais: acesso ao painel restrito ao administrador, com verificação em duas etapas; segredos só nas
  Edge Functions; criptografia em repouso feita pelo próprio Supabase (disco).
- Para impedir tecnicamente o acesso do administrador, seria preciso **criptografia de ponta a ponta**
  (dados cifrados no navegador com chave da família). Ver seção 8.

## 5. Edge Functions

### `familia` (exige login; JWT verificado)
Ações (`POST` com `{ acao, ... }`):
- `convidar` — master/sub-master convida para a própria família (`inviteUserByEmail`).
- `remover` — master remove alguém da própria família; os perfis da pessoa passam para o master.
- `convidar_master` — admin do sistema cria família (ou usa existente) e convida o master.

### `lembretes` (sem verificação de JWT; protegida por `x-cris-cron`)
- Chamada a cada minuto pelo `pg_cron` (job `cris-lembretes`) via `pg_net`, com cabeçalhos `apikey` (chave
  pública) e `x-cris-cron` (= segredo `CRON_SECRET`).
- Busca `lembretes_pendentes()` (doses dos últimos 15 min não registradas), reserva em
  `notificacoes_enviadas` (evita duplicados), agrupa por pessoa + perfil + horário e envia Web Push
  (`npm:web-push`). Remove inscrições que respondem 404/410.

Segredos necessários: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`.

Diagnóstico do agendador:
```sql
select status_code, content, created from net._http_response order by created desc limit 5;
```

## 6. PWA e offline

- `sw.js`: rede primeiro, cache como reserva (app abre sem internet); dados do Supabase nunca vêm do cache.
- Fichas de emergência dos perfis acompanhados ficam no `localStorage` (atualizadas a cada 6 h).
- Notificações: eventos `push` (mostra o aviso) e `notificationclick` (abre `#/hoje`).
- iPhone: Web Push só funciona com o app instalado na tela de início (iOS 16.4+).

## 7. Operação

### Publicar
1. Mudança de banco → novo arquivo em `sql/` com data no nome; rodar no SQL Editor **antes** do código.
   Conferir que o botão diga **Run** (e não "Run selected").
2. Atualizar `VERSAO_APP` (`js/config.js`) e `VERSAO` (`sw.js`). Arquivo JS novo → incluir na lista `ARQUIVOS` do `sw.js`.
3. `git push` na `main`.
4. Mudança de texto relevante no termo → aumentar `TERMO_VERSAO` em `termo.js`, publicar e só então
   rodar o SQL que muda `termo_versao_atual()`.

### Histórico de migrações (`sql/`)
| Arquivo | O que faz |
|---|---|
| `2026-11-09_doses_tomado_em.sql` | Coluna `tomado_em` e gatilho |
| `2026-11-09_nucleos_familiares.sql` | Famílias, admin do sistema, RLS por família |
| `2026-11-09_termo_v2.sql` | Termo versão 2 |
| `2026-11-12_notificacoes.sql` | Funções de Web Push e lembretes |
| `2026-11-12_agendador_lembretes.sql` | Job do `pg_cron` (preencher o `CRON_SECRET`) |
| `2026-11-15_corrige_criar_perfil.sql` | Correção da regra `perfis: ver` |
| `2026-11-20_termo_v3.sql` | Termo versão 3 (transparência sobre acesso técnico) |

O schema anterior a 09/11/2026 (tabelas originais, funções `pode_*`, gatilhos de histórico, bucket) foi criado
direto no painel e não está versionado. Para reconstruir o ambiente do zero, exportar o schema atual
(`supabase db dump --schema public`) e guardar em `sql/000_schema_base.sql`.

### Limites do plano gratuito (referência)
Banco 500 MB, Storage 1 GB, 50 mil usuários ativos/mês, 500 mil chamadas de função/mês
(o agendador usa ~43 mil). O projeto pausa após 7 dias sem uso. Para uso comercial: plano Pro
(backups diários, sem pausa).

## 8. Pendências e próximos passos

- Agenda (consultas e exames), resultados de exames e anexos (PDF/imagem).
- Leitura automática de exames e receitas por IA (opcional, com consentimento específico).
- Segundo lembrete quando a dose continua sem registro 30 min depois.
- Compartilhamento de perfil entre famílias diferentes.
- Avaliar criptografia de ponta a ponta para uso comercial. Custo: gestão de chaves por família
  (perda da chave = perda dos dados), lembretes sem nome do remédio ou com nome cifrado no aparelho,
  impossibilidade de busca e de leitura automática no servidor.
- Versionar o schema base (ver seção 7).
