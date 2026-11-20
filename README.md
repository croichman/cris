# CRIS — Central de Registros e Informações de Saúde

App web (PWA) para famílias organizarem a saúde de cada pessoa: medicamentos e horários, registro de doses,
lembretes no celular, alergias, condições de saúde, vacinas, médicos, ficha de emergência offline e quadro
semanal de medicamentos para imprimir.

- **App:** https://croichman.github.io/cris/
- **Guia do usuário:** [ajuda.html](https://croichman.github.io/cris/ajuda.html) (linguagem simples, imprimível)
- **Documentação técnica:** [docs/TECNICO.md](docs/TECNICO.md)

## Em resumo

| Camada | Tecnologia |
|---|---|
| Interface | HTML, CSS e JavaScript puro (módulos ES), sem etapa de build |
| Hospedagem | GitHub Pages (branch `main`, raiz do repositório) |
| Banco, login e arquivos | Supabase (Postgres com RLS, Auth por código no e-mail, Storage) |
| Funções no servidor | Supabase Edge Functions (Deno): `familia` e `lembretes` |
| Lembretes | Web Push (VAPID) disparado por `pg_cron` a cada minuto |

## Estrutura

```
index.html              página única do app
ajuda.html              guia do usuário (público, sem login)
manifest.webmanifest    dados de instalação (PWA)
sw.js                   service worker: cache offline e notificações
css/estilo.css          todo o visual (claro/escuro, impressão)
js/                     módulos do app (ver docs/TECNICO.md)
sql/                    migrações do banco, em ordem de data
supabase/functions/     código das Edge Functions
docs/TECNICO.md         arquitetura, modelo de dados, segurança e operação
```

## Publicar uma versão

1. Se houver mudança no banco: rodar o arquivo novo de `sql/` no SQL Editor do Supabase **antes** de publicar o código.
2. Atualizar `VERSAO_APP` em `js/config.js` e `VERSAO` em `sw.js`.
3. Enviar para a branch `main`. O GitHub Pages publica em 1–2 minutos.

Detalhes, ordem das migrações e cuidados em [docs/TECNICO.md](docs/TECNICO.md).
