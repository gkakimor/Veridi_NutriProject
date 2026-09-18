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
| `VERIDI_STORAGE_PROVIDER` e `VERIDI_R2_*` | cadastradas (`R2`, desde 2026-09-17) | arquivo do Item Rótulo no R2 — ver seção 6.1; sem elas, `LOCAL_FS` |
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
   `API ouvindo`. O catálogo de unidades de medida (mg, g, kg, un, mL, L)
   nasce dessas migrations — nenhum seed é necessário para cadastrar Item.
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

**A carga real da Veridi já está em produção desde 2026-09-14** (release
`b798e85`): 510 matérias-primas, 188 materiais de embalagem, 173 produtos, 113
fornecedores, 76 clientes e 182 projetos. Reimportar não é rotina — a carga
inicial foi aplicada uma vez e as pendências restantes ficam em
`.local-data/veridi/carga-inicial/`.

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

### 6.1 Arquivo do Item Rótulo — Cloudflare R2 (LABEL-ATTACHMENTS-01)

O arquivo versionado do Item Rótulo (§103) passa por `lib/storage/`: `LOCAL_FS`
grava no mesmo `VERIDI_UPLOAD_DIR` (em `items/<itemId>/labels/`), `R2` grava no
bucket privado. **Sem as variáveis abaixo o serviço continua em `LOCAL_FS`.**
Os anexos genéricos seguem no volume de qualquer jeito.

**Estado de hoje: R2 ATIVO em produção.** As seis variáveis estão cadastradas no
serviço desde 2026-09-17 (bucket de homologação `veridi-homologacao`), e o
código que as lê subiu em `8e824e8f`, na release
PROD-RELEASE-DEPLOY-01 ([`RELEASES.md`](RELEASES.md)). Antes dessa release as
variáveis existiam sem efeito: a imagem no ar não tinha o `StorageAdapter`.

Para ligar o R2, cadastrar no serviço (Variables do Railway, nunca no Git):

| Variável | Valor | Observação |
|---|---|---|
| `VERIDI_STORAGE_PROVIDER` | `R2` | sem ela (ou `LOCAL_FS`), o arquivo novo vai para o volume |
| `VERIDI_R2_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | só a conta — **sem** o nome do bucket no caminho (o painel da Cloudflare mostra com ele) |
| `VERIDI_R2_BUCKET` | nome do bucket (homologação: `veridi-homologacao`) | minúsculas, dígitos e hífen |
| `VERIDI_R2_REGION` | `auto` | opcional; vazio vale `auto` |
| `VERIDI_R2_ACCESS_KEY_ID` | Access Key ID do token S3 do bucket | segredo |
| `VERIDI_R2_SECRET_ACCESS_KEY` | Secret Access Key do mesmo token | segredo |

Regras que a API aplica na subida: com `VERIDI_STORAGE_PROVIDER=R2`, as quatro
obrigatórias (endpoint, bucket, chave e segredo) precisam existir; qualquer uma
delas preenchida sem as outras também derruba a subida. A mensagem cita só o
nome da variável. Endereço sem `https://`, com bucket no caminho ou com usuário e
senha é recusado.

Cada versão guarda o provedor em que nasceu: ligar o R2 não move nem esconde o
que já foi gravado no volume, e desligar não esconde o que nasceu no R2 — desde
que as variáveis do R2 continuem no serviço para a leitura.

Antes de ligar, provar o bucket com a MESMA credencial, fora do Git:

```bash
railway run pnpm storage:r2:smoke
```

O smoke grava um objeto pequeno em `_smoke/`, confere cabeçalho, bytes e a
recusa de sobrescrita e apaga o objeto no fim. Imprime só bucket, chave de
smoke e tamanhos. O bucket continua privado: sem acesso público, sem `r2.dev`,
e o navegador só fala com a API.

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

---

## 9. Ferramentas operacionais de produção

Scripts que falam com o ambiente publicado. Nenhum faz parte do build, do
deploy ou da suíte de testes: cada um roda à mão, por decisão de quem opera. A
credencial do banco chega pelo Railway CLI (`railway run -s Postgres`) e nunca
é copiada nem impressa. A produção publica a partir de `release/prod`;
rodar um destes scripts não publica nada. Cada publicação fica registrada em
[`RELEASES.md`](RELEASES.md).

### Somente leitura

| Script | O que faz | Como rodar |
|---|---|---|
| `scripts/smoke-prod.mjs` | smoke autenticado da release no ar: `/health`, login e as telas principais, com captura de tela | `pnpm exec node scripts/smoke-prod.mjs <pasta-de-saída>` |
| `scripts/maintenance/prod-inventory.mjs` | contagem por tabela e marcas de dado artificial | `railway run -s Postgres node scripts/maintenance/prod-inventory.mjs` |
| `scripts/maintenance/prod-sessions.mjs` | contagem e datas das sessões, sem token | `railway run -s Postgres node scripts/maintenance/prod-sessions.mjs` |
| `scripts/maintenance/fk-order.mjs` | FKs reais do banco (`pg_constraint`) e a ordem de remoção que impõem; `--json` opcional | `railway run -s Postgres node scripts/maintenance/fk-order.mjs` |
| `scripts/maintenance/prod-component-basis.ts` | base gravada de cada linha de Formulação e de Modelo, em todos os status, contra a regra `baseDoComponente` (§106), numa transação READ ONLY; lista a linha fora da regra por documento e item e sai com código 3 se houver. Gate da release que publicar a base derivada: divergência vai ao PO antes de mover `release/prod`. Lê só colunas que já existem em `5b7c1a3` | `railway run -s Postgres -- pnpm exec tsx scripts/maintenance/prod-component-basis.ts` |
| `scripts/maintenance/prod-backup-json.mjs` | backup lógico completo em JSON (o `pg_dump` local é mais velho que o servidor). Lê pelo Prisma Client do checkout: rodar de um checkout com o MESMO schema de PROD — de um à frente, lê coluna que ainda não existe e falha. Gravar fora do repositório (`../.local-data/veridi/backups/`) | `railway run -s Postgres -- node scripts/maintenance/prod-backup-json.mjs <arquivo>` |
| `scripts/maintenance/restore-json-backup-check.mjs` | prova que o backup restaura: banco LOCAL descartável, migrations do checkout, carga e conferência linha a linha; só `RESTAURÁVEL: YES` conta | `pnpm exec dotenv -e .env -- node scripts/maintenance/restore-json-backup-check.mjs <arquivo>` (Git Bash) |

`smoke-prod.mjs` lê a credencial de `.local-data/prod-demo.json` (ignorado pelo
Git). A perna de **escrita** — cria um cliente "SMOKE" e o inativa — só roda
com `--escrita`. As capturas mostram dado real de cliente: a pasta de saída
fica fora do Git (`handoff/` ou fora do repositório) e é descartada depois da
conferência.

### Escrita — exigem confirmação explícita

| Script | O que faz | Trava |
|---|---|---|
| `scripts/maintenance/prod-sessions-revoke.mjs` | marca `revokedAt` nas sessões vigentes; não apaga linha | sem `--confirmar` só lista o que faria |
| `scripts/maintenance/prod-cleanup.mjs` | **apaga os dados de negócio** de produção, preservando usuários, sessões, preferências de tela, unidades de medida e o calendário produtivo | ver abaixo |

**`prod-cleanup.mjs` é destrutivo e não é rotina.** Foi usado uma vez, na
limpeza de 2026-09-11, antes da carga inicial. Hoje a produção contém a carga
real da Veridi (2026-09-14): rodar o `--apply` apagaria cliente, pedido, lote e
histórico. Sem `--apply` ele só faz dry-run. O `--apply` exige ambiente
`production`, `--confirmar-projeto=<RAILWAY_PROJECT_ID>` igual ao que o CLI
injeta e `--backup=<arquivo>` gerado por `prod-backup-json.mjs` com a mesma
contagem de cada tabela. Só com decisão explícita do PO, registrada antes.

Sem `--apply` a conexão é SOMENTE LEITURA: o script acrescenta
`options=-c default_transaction_read_only=on` à URL e confere
`transaction_read_only` antes de ler qualquer coisa — o próprio banco recusa
INSERT, UPDATE, DELETE, TRUNCATE e `ALTER SEQUENCE` vindos do dry-run.

Todo model do schema e toda sequence do banco precisam de classificação
explícita no script, e o banco não pode ter nada fora dela — sem isso ele
aborta, até em dry-run, antes de contar qualquer tabela. Os models ficam em
`scripts/maintenance/prod-cleanup-models.mjs`, em exatamente uma de três
listas: alvos, preservados (usuários, sessões, preferências de tela, unidades
de medida e o calendário produtivo com jornadas e exceções — configuração do
ambiente, não transação) e o contador anual da OP, esvaziado só com
`--reset-sequences`. Contagem física, perfil de produção, roteiro e agenda da
OP, histórico de situação do Cliente, versão do arquivo de rótulo, o rastro da
exclusão física de cadastro mestre (MASTER-DATA-HARD-DELETE-01, decisão do PO) e o
estorno de consumo interno (INTERNAL-CONSUMPTION-REVERSAL-01) são alvos
(PROD-CLEANUP-MODEL-CLASSIFICATION-01). As sequences ficam em
`scripts/maintenance/prod-cleanup-sequences.mjs`: `user_code_seq` é
preservada; as de numeração de negócio (28 em 2026-09-18) só reiniciam com
`--reset-sequences`. Abortam também: tabela do `public` sem model ou model sem
tabela, relação ou sequence fora do `public`, sequence nas duas listas ou
fantasma (classificada e ausente do banco — apagada ou renomeada), coluna
serial/identity/`nextval`, sequence presa a coluna, trigger ou rule de usuário.

Migration que cria model ou sequence (a de Uso e consumo, por exemplo) põe o
nome na lista no mesmo commit. A suíte de scripts protege as paridades
(`prod-cleanup-models.test.ts` contra o `schema.prisma` e as FKs das
migrations, `prod-cleanup-sequences.test.ts` contra as migrations) e roda o
script de verdade em dry-run contra o banco de teste
(`prod-cleanup-dry-run.test.ts`).

A ordem de remoção sai das FKs reais. A contagem física tem um ciclo: a posição
aponta para o registro que vale (NO ACTION) e o registro aponta para a posição
(CASCADE). O CASCADE que fecha ciclo não ordena — a posição sai antes e leva os
registros na mesma instrução —, o plano marca a tabela que sai pelo CASCADE e a
execução conta o que ele levou. O script só atravessa o CASCADE listado em
`CASCADES_EM_CICLO_DOCUMENTADAS`: CASCADE em ciclo fora da lista, item da lista
que o banco não tem mais, filha do ciclo referenciada por outra tabela e ciclo
só de RESTRICT/NO ACTION abortam. Todo outro CASCADE entre alvos é neutralizado
pela ordem — a filha sai antes e ele não acha linha.

O script limpa o banco, não o object storage. A linha de `ItemLabelFileVersion`
e a de `Attachment` saem; o objeto no R2 (ou no disco local) e o arquivo no
volume ficam, e o plano diz isso. Apagar objeto de storage é outra
responsabilidade, com rodada própria.

---

## 10. Dados de PROD na publicação — política permanente

Decisão do PO em 2026-09-18 (adendo de MASTER-DATA-HARD-DELETE-01). Vale para toda publicação e toda migration.

**PROD é a fonte de verdade.** Uma versão nova muda SCHEMA, COMPORTAMENTO e FUNCIONALIDADES — nunca substitui o dado
real da Veridi. Clientes, Fornecedores, Itens, Produtos, Formulações, Modelos, Pedidos, Compras, Lotes, Movimentos,
Custos, Históricos, Arquivos, relacionamentos e configurações operacionais existentes em PROD são preservados, salvo ação
explicitamente aprovada pelo PO. O DEV não é fonte para PROD:

- não copiar base DEV → PROD;
- não sincronizar cadastros do DEV sobre PROD;
- não reaplicar a carga inicial sobre PROD.

**Migrations** aprovadas se aplicam normalmente. Preferir mudança aditiva, anulável e compatível com o dado existente.
Campo novo sem dado real fica nulo/vazio: nada de backfill inventado.

**Exclusão física de cadastro mestre** ([`PRODUCT_RULES.md`](PRODUCT_RULES.md) §125) é ferramenta operacional para
corrigir cadastro criado por engano, não ferramenta de migração: nenhuma release exclui cadastro existente só porque a
funcionalidade existe.

**Numa release normal NÃO se executa:** `prod-cleanup --apply`, reset, `TRUNCATE`, seed destrutivo, carga inicial nem
saneamento genérico. Cada um desses exige autorização específica do PO.

**Exceção já autorizada: o saneamento de duplicidades.** O PO comunicou à Veridi que os cadastros duplicados serão
saneados — é a única limpeza destrutiva previamente autorizada nesta etapa. Mesmo ela não assume que PROD é igual ao DEV:
código (`MP-000xxx`) e id do DEV não garantem o mesmo estado em PROD. Antes de qualquer APPLY em PROD, nesta ordem:

1. discovery READ ONLY;
2. identificar os grupos reais de PROD;
3. PLAN em PROD;
4. auditar todas as referências;
5. comparar com as decisões das Ondas A, 2 e 3;
6. bloquear divergências — dado, referência, histórico, fornecedor, Formulação ou movimento diferente do DEV volta ao
   PO, nunca se força a decisão do DEV;
7. gerar backup;
8. provar `RESTAURÁVEL: YES`;
9. apresentar o plano ao PO;
10. só com a aprovação: APPLY;
11. VERIFY;
12. gerar a planilha final dos registros removidos e consolidados.

Exceção destrutiva é sempre explícita, planejada, auditável e aprovada.
