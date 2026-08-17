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
| `VERIDI_WEB_DIST` | `apps/web/dist` | relativo à raiz do monorepo (não ao diretório do processo) |
| `VERIDI_UPLOAD_DIR` | `/data/uploads` | dentro do volume persistente — ver seção 6 |
| `TZ` | `UTC` | container e banco no mesmo relógio; a formatação é no cliente |

**Não copiar `API_HOST` do `.env.example`.** Ele vale `127.0.0.1`, que é
loopback: a API responderia só dentro do container e o health check nunca
chegaria nela ("service unavailable" em todas as tentativas). Sem a variável,
produção escuta em `0.0.0.0` sozinha.

`API_PORT` também sai: quem manda é `PORT`. Se o provedor não injetar `PORT`,
defina `PORT=8080` — nunca as duas. `WEB_ORIGIN` não é usada aqui (não há
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

## 6. Anexos — volume persistente

O disco do container é efêmero: laudo/CoA, NF e arte gravados nele sumiriam no
redeploy seguinte, deixando registro no banco apontando para arquivo que não
existe mais. Por isso o serviço tem um **volume** montado em `/data`, e
`VERIDI_UPLOAD_DIR=/data/uploads` aponta o armazenamento para dentro dele.

```bash
railway volume --service <id> --environment <id> add --mount-path /data
```

Nenhuma mudança de código: `file-storage.ts` já resolve caminho absoluto e cria
o diretório na primeira gravação. O download continua passando pela API
autenticada — arquivo nunca fica público.

Verificado em produção: upload (`201`), redeploy completo (build novo,
container substituído), download do mesmo anexo (`200`, 39 bytes, conteúdo
íntegro).

Cloudflare R2 continua sendo a saída quando o volume apertar ou quando o
Railway deixar de ser a casa — o armazenamento está isolado em três funções
(`storeFile`, `readFile`, `deleteStoredFile`), então a troca é local.

## 7. Aberto — resolver antes de uso real

Não bloqueiam demonstração; **bloqueiam operação de verdade**:

- **Backup do banco.** O snapshot do provedor não substitui `pg_dump`
  periódico guardado fora dele.
- **Limite de tentativas no login.** Hoje não há rate limit na rota de
  autenticação; exposta na internet, ela precisa de um — mais ainda enquanto
  existirem as contas de avaliação (`pnpm users:demo`, domínio
  `@veridi.demo`), que usam senha única e conhecida por quem avalia.
- **Corpus real não subiu.** Cliente, CNPJ, fornecedor, preço e formulação só
  entram depois dos dois itens acima. O que está no ambiente publicado é o
  `pnpm db:seed` — dados fictícios.

---

## 8. Rodar o modo de produção na máquina local

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
