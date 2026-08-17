# Implantação — Railway (origem única)

Runbook da primeira publicação do Veridi. Um serviço só: a API serve o
frontend e responde a API no mesmo endereço.

---

## 1. Por que origem única

A sessão vive num cookie `HttpOnly` com `SameSite=Lax`. Se o front estiver em
`app.exemplo.com` e a API em `api.outro.com`, o navegador **não envia** esse
cookie: o login parece funcionar e a requisição seguinte volta `401`. Origem
única elimina a classe inteira de problema — e, de quebra, CORS deixa de
existir e não há segunda plataforma para configurar.

Como funciona no código:

- `VERIDI_WEB_DIST` aponta para o build do front. Vazio (padrão), a API não
  serve nada e o Vite continua na porta dele em desenvolvimento.
- `@fastify/static` publica os arquivos do build; cada rota de arquivo é
  marcada `config.publicAsset` num escopo próprio, e o hook de autenticação
  libera **só** essas rotas casadas — nunca por caminho, nunca por cabeçalho.
- Qualquer `GET` que aceite `text/html` e não case com rota conhecida devolve
  o `index.html` (o roteamento é no cliente). Chamada de API inexistente
  continua recebendo `404` em JSON.
- Endpoint de dados sem sessão continua `401`, mesmo pedindo HTML.
  `apps/api/src/modules/health/single-origin.test.ts` guarda exatamente isso.

O front usa caminho relativo em produção: `.env.production` define
`VITE_API_URL=` (vazio). Sem esse arquivo, um build feito na máquina de
desenvolvimento levaria embutido o `http://127.0.0.1:3333` do `.env` local.

---

## 2. O que criar no Railway

Dois recursos no mesmo projeto:

| Recurso | O quê |
|---|---|
| **PostgreSQL** | banco gerenciado, adicionado pelo próprio Railway |
| **Serviço da aplicação** | deploy do repositório GitHub privado |

O serviço da aplicação lê `railway.json` na raiz do repositório:

```
build   → pnpm build                (shared, API, web)
release → pnpm deploy:prod          (prisma migrate deploy)
start   → pnpm start:prod           (node apps/api/dist/main.js)
health  → GET /health               (comprova API → Prisma → PostgreSQL)
```

`pnpm deploy:prod` roda **antes** de trocar a versão no ar: se a migração
falhar, o deploy para e a versão antiga continua atendendo.

Node é fixado em 22 pelo `.node-version`.

---

## 3. Variáveis do serviço

| Variável | Valor | Por quê |
|---|---|---|
| `NODE_ENV` | `production` | liga o `Secure` no cookie e o log em `info` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | referência ao banco do projeto — não copiar a URL na mão |
| `VERIDI_WEB_DIST` | `apps/web/dist` | resolvido a partir do diretório do processo |
| `TZ` | `UTC` | container e banco no mesmo relógio; a formatação é no cliente |

Não definir `PORT` nem `API_HOST`: o Railway injeta `PORT`, e em produção a
API escuta em `0.0.0.0` sozinha. `WEB_ORIGIN` também não é usada aqui (não há
requisição cross-origin).

---

## 4. Primeira publicação, na ordem

1. Repositório GitHub **privado** com o código.
2. No Railway: novo projeto → adicionar PostgreSQL → adicionar serviço a
   partir do repositório.
3. Preencher as variáveis da seção 3.
4. Deploy. Acompanhar o log: build, depois `prisma migrate deploy`, depois
   `API ouvindo`.
5. Abrir a URL do serviço (`*.up.railway.app` serve para validar; domínio
   próprio entra depois, sem mudar nada do código).
6. Criar o primeiro usuário — **não existe senha padrão no repositório**:

   ```bash
   railway run pnpm user:bootstrap-admin
   ```

   (roda contra o banco de produção; guardar a credencial fora do repositório)
7. Conferir: login, uma tela de lista, um relatório, um impresso.

### Domínio próprio

`Settings → Networking → Custom Domain`, e no DNS um `CNAME` para o host que o
Railway indicar. Certificado é emitido pelo Railway. Como é origem única,
basta **um** nome (ex.: `erp.seudominio.com`) — não precisa de `api.`.

---

## 5. Carga de dados reais

O corpus da Veridi vive em `.local-data/`, fora do repositório. A importação de
produção exige as três camadas de sempre:

```
VERIDI_ALLOW_PRODUCTION_IMPORT=true  +  --apply  +  --confirm-database=<nome>
```

Rodar sempre `validate` antes de `apply`, e `verify` depois. Ver
`docs/VERIDI_MIGRATION.md`.

---

## 6. Aberto — resolver antes de uso real

Estes pontos não bloqueiam a publicação de demonstração, mas **bloqueiam
operação de verdade**:

- **Anexos somem no redeploy.** `apps/api/src/lib/file-storage.ts` grava no
  disco local, e o disco do container é efêmero. Laudo/CoA, NF e arte enviados
  seriam perdidos na próxima publicação. Solução acordada: adaptador de
  armazenamento em Cloudflare R2 (download continua passando pela API
  autenticada — arquivo nunca fica público).
- **Backup do banco.** O snapshot do provedor não substitui `pg_dump`
  periódico guardado fora dele.
- **Limite de tentativas no login.** Hoje não há rate limit na rota de
  autenticação; exposta na internet, ela precisa de um.

---

## 7. Rodar o modo de produção na máquina local

Útil para reproduzir o ambiente publicado antes de subir:

```bash
pnpm build
NODE_ENV=production VERIDI_WEB_DIST=apps/web/dist API_PORT=3999 \
  pnpm exec dotenv -e .env -- node apps/api/dist/main.js
```

Tudo em `http://127.0.0.1:3999`: app, arquivos e API.

Detalhe que engana: `@fastify/static` registra uma rota por arquivo na
inicialização. Se o front for recompilado com o servidor no ar, os arquivos
novos (com hash novo no nome) dão `404` até reiniciar o processo. Em produção
isso não acontece — build e start são etapas separadas.
