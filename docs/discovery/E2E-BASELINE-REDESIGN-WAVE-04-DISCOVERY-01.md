# E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01

Massa operacional própria para as E2E do grupo C e para a suíte de Ordem de Produção fora da primeira página.

- **Status:** EM_ANALISE
- **Implementação:** NÃO IMPLEMENTADO
- **Tipo:** discovery somente leitura (análise estática)
- **Data do discovery:** 2026-09-15
- **Base auditada:** `origin/main` `9c60845`
- **Capability preparada:** E2E-BASELINE-REDESIGN-WAVE-04

## Status

**EM_ANALISE.** Há decisões do PO pendentes (P1 a P8, na seção "Decisões PO pendentes"). A P1 vem antes de qualquer
implementação: na base auditada, `docs/PROJECT_STATE.md` atribuía o grupo C à WAVE 3, enquanto este discovery foi pedido
com o grupo C na WAVE 4.

Prontidão por subwave concluída no discovery (READY_TO_IMPLEMENT):

- **YES** — 4A, 4B, 4C, 4D e 4F, depois da P1;
- **NO** — 4E (desconto → faturamento), até a WAVE 3 estar na `main`.

## Objetivo

Preparar a implementação real da E2E-BASELINE-REDESIGN-WAVE-04: reescrever nove suítes E2E para que cada uma crie a
própria massa operacional pelas APIs oficiais, carimbada por execução, sem depender de dados reais da Veridi.

Por que o discovery foi feito:

- a WAVE 1–2 entregou a fundação nova das E2E (`pnpm e2e:run` num clone TEMPLATE da base E2E, fixtures por API, runId em
  memória) e deixou verdes as suítes simples;
- a base E2E é a carga inicial real da Veridi. O mapa das suítes em `docs/E2E_STRATEGY.md` registra que as do grupo C
  "abrem o primeiro registro de lista ou leem código e saldo que a base não tem", que "não há lote nem PA com saldo" e
  que "PA com saldo só nasce por produção";
- sem massa própria, essas suítes saem "SEM MASSA" (reprovação no runner), procuram código fixo da carga ou abrem o
  primeiro registro de uma lista.

Principal dificuldade: construir massa operacional — em especial produto acabado (PA) com saldo real — sem a carga.

Suítes alvo:

1. `cancelamento-de-pedido-com-op-cancelada`
2. `custo-estimado-acompanha-o-salvamento`
3. `formulacao-quantidade-fisica-e-custo`
4. `disponibilidade-comercial-explicada`
5. `entregas-programadas-do-pedido`
6. `expedicao-geral-entre-entregas`
7. `desconto-do-pedido-chega-ao-faturamento`
8. `ajuda-contextual-nivel-1`
9. `ordem-de-producao-produto-fora-da-primeira-pagina`

## Base auditada

- Commit lido: `origin/main` = `9c60845` (merge E2E-BASELINE-REDESIGN-WAVE-01-02); `main` local igual e checkout limpo.
- WAVE 3 em paralelo: worktree `wt-e2e-wave-03`, branch `feat/e2e-baseline-redesign-wave-03` em `9c60845`, sem commit e
  sem alteração no início e no fim do discovery. Nada da WAVE 3 foi usado.
- Leitura num worktree detached em `9c60845`, removido ao final.
- Nada executado: sem runner, API, navegador, teste, build, fresh, banco ou PROD.
- Base E2E, lida só pelas contagens do `baseline.json`: Product 173, Customer 76, Item 816, UnitOfMeasure 6; 74 migrations.
- Este documento foi gravado depois, numa branch criada a partir de `origin/main` `6256ca9`, que já inclui o merge da
  E2E-BASELINE-REDESIGN-WAVE-03. O discovery não foi refeito sobre essa base.

Fontes lidas no discovery:

- suítes: as nove alvo, `recebimento-validacao-viva.mjs`, `roteiro-aplicado-planeja-ordem.mjs`,
  `produto-do-cliente-do-pedido.mjs` e `private-label-golden-path.mjs` (referência da cadeia inteira pela tela);
- infraestrutura: `scripts/e2e/lib/browser.mjs`, `run-id.mjs` e `roteiro.mjs`; `scripts/e2e/fixtures/*.mjs` e
  `fixtures.test.ts`; `scripts/e2e-run.mjs` (baterias); `scripts/e2e/README.md`;
- docs: `docs/E2E_STRATEGY.md`, `docs/PROJECT_STATE.md` (seção da WAVE 1–2 e "Próxima prioridade"), `docs/BACKLOG.md`
  (E2E-QUOTE-PAGE-FLOW-01 e E2E-CORPUS-MASS-01);
- API: módulos `production-orders` (OP, picking e produção), `lots`, `quality`, `receiving`, `purchase-orders`,
  `customer-orders` (Pedido, Plano de Atendimento e entregas), `shipments`, `billings`, `formulations`,
  `production-profiles`, `projects` (schemas e rotas do Orçamento), `items` e `products`;
- shared: `formulation-quantity.ts`, `items.ts`, `production-orders.ts`, `customer-order-deliveries.ts`, `inventory.ts`;
- web: páginas de Pedido, OP, Formulações (lista, detalhe e versão), Estoque (visão geral e item), Expedição,
  Faturamento, Produtos e versão do Orçamento; `DeliveryScheduleSection`; conteúdo de ajuda V2.

## Escopo analisado

1. Estado real das nove suítes: fluxo atual, códigos fixos, "SEM MASSA", datas fixas, dependência de primeira linha, API
   direta, UI, seletor ou contrato obsoleto, dependência da WAVE 3, fixture existente e fixture faltante.
2. Cadeia completa para obter PA com saldo real: cadastros → fornecedor → MP → OC → recebimento → lote → qualidade →
   Produto → formulação → OP → roteiro → planejar → liberar → picking → consumo → apontamento → conclusão → lote de PA →
   liberação — com endpoints, payloads, pré-condições e transições de estado.
3. Desenho da fixture `produzirPa`.
4. Qualidade mínima: pré-condição da WAVE 4 separada da futura E2E de Qualidade.
5. Cenários: cancelamento, custo estimado, formulação física, disponibilidade, entregas + expedição (fusão), desconto →
   faturamento (depois do Orçamento aceito), ajuda contextual (4 telas) e OP fora da primeira página.
6. Fixtures novas, ordem das subwaves, arquivos, estimativa, riscos, blockers e perguntas ao PO.

## Estado atual

### Infraestrutura e fixtures existentes (WAVE 1–2)

- Runner `pnpm e2e:run`: clone TEMPLATE descartável da base E2E, ADMIN próprio da execução, API e Web em `127.0.0.1`;
  reprova exit ≠ 0, estouro de tempo e "SEM MASSA".
- Baterias: `wave-01-02` (11 suítes) e `provas-wave-01-02` (`leitor-de-pdf-da-tela`, `roteiro-aplicado-planeja-ordem`).
- `lib/browser.mjs`: navegador em America/Sao_Paulo e pt-BR; `erros` recebe todo 4xx/5xx da API não declarado;
  `esperarErroHttp` declara a recusa provocada. `lib/pdf.mjs`: `textoDoPdfDaTela`.
- Fixtures reutilizáveis:
  - `fixtures/run.mjs`: `criarRun`, `carimbar`;
  - `fixtures/api.mjs`: `exigir`, `clienteApi`, `autenticar`;
  - `fixtures/datas.mjs`: `diaComercial`, `porExtenso`;
  - `fixtures/ui.mjs`: `esperarRota`, `escolherOpcao`;
  - `fixtures/cadastros.mjs`: `criarCliente`, `criarFornecedor`, `criarItem` (lote, validade, liberação,
    `custoDeReferencia`), `criarProdutoOperacional`, `criarFormulacaoAtiva`;
  - `fixtures/producao.mjs`: `criarOrdemDeProducao`, `criarRoteiroAtivo`, `aplicarRoteiro`, `planejarOrdem`.
- Compatibilidade do golden path: `lib/run-id.mjs` e `lib/roteiro.mjs` — manter.
- Recebimento resolvido na WAVE 1–2: `recebimento-validacao-viva` cria fornecedor e matéria-prima por API e opera OC e
  recebimentos pela tela (é o assunto dela).

### Classificação no mapa das E2E

`docs/E2E_STRATEGY.md` (2026-09-15): grupo **C** = as oito primeiras suítes alvo; grupo **D** =
`ordem-de-producao-produto-fora-da-primeira-pagina` (procura `PROD-000214`).

### Auditoria por suíte

#### `cancelamento-de-pedido-com-op-cancelada`

- **Fluxo:** Pedido pela tela → Confirmar → Plano "Produzir de" 10 → link da OP → cancelar Pedido (400) → cancelar OP →
  cancelar Pedido → OP no histórico.
- **Códigos fixos:** `CLI-000013` e `PROD-000031` (na base são de clientes diferentes).
- **SEM MASSA:** não. **Datas fixas:** não.
- **Primeira linha:** `a[href^="/producao/ordens/"].first()` — única OP, aceitável.
- **API direta:** não. **UI:** tudo.
- **Obsoleto:** `obterRun` (compatibilidade). A suíte filtra "Failed to load resource" à mão, mas `lib/browser.mjs` põe
  "http 400 POST /customer-orders/:id/cancel" em `erros`: sem `esperarErroHttp` ela reprova. O monitor próprio de
  respostas duplica o coletor.
- **WAVE 3:** não.
- **Fixture existente:** `criarRun`, `criarCliente`, `criarItem`, `criarProdutoOperacional`, `criarFormulacaoAtiva`.
- **Fixture faltante:** nada obrigatório.

#### `custo-estimado-acompanha-o-salvamento`

- **Fluxo:** `/producao/formulacoes` busca "THE KING" → `Abrir.first()` → reaproveita rascunho da execução anterior ou
  cria "Nova versão a partir desta" → dobra `MP-000365` → salva → custo dobra → volta → base igual.
- **Códigos fixos:** "CAFEÍNA PT 60 CAPS THE KING", `MP-000365`.
- **SEM MASSA:** não. **Datas fixas:** não.
- **Primeira linha:** `Abrir.first()`; rascunho herdado de outra execução (fere as regras 1 e 5).
- **API direta:** não. **UI:** tudo.
- **Obsoleto:** o status é lido de `querySelector(".badge--active, .badge--warn")`, ou seja, o 1º badge da página — e o
  selo "Qualidade" do custo usa as mesmas classes. Usa `process.exit`.
- **WAVE 3:** não.
- **Fixture existente:** `criarItem` (`custoDeReferencia`), `criarProdutoOperacional`, `criarFormulacaoAtiva` (só base e
  componentes simples).
- **Fixture faltante:** formulação por dose (`calculationMode`, `dosesPerPackage`, `basis`, pureza, overage).

#### `formulacao-quantidade-fisica-e-custo`

- **Fluxo:** mesma busca → "Ver versão ativa" → componentes × custo estimado × total × qualidade → "Voltar" → rascunho da
  versão seguinte.
- **Códigos fixos:** THE KING; `MP-000365`, `MP-000368`, `MP-000369`, `MP-000120`; referências R$ 700,00 / 44,32 /
  126,00 / 35,00.
- **SEM MASSA:** não. **Datas fixas:** não.
- **Primeira linha:** `Abrir.first()`; rascunho reaproveitado.
- **API direta:** não. **UI:** tudo.
- **Obsoleto:** massa real "de propósito" (a decisão B do PO troca por massa própria); mesmo seletor de badge.
- **WAVE 3:** não.
- **Fixture existente e faltante:** iguais às da suíte anterior; uma fixture de dose serve às duas.

#### `disponibilidade-comercial-explicada`

- **Fluxo:** `/estoque?search=PA-000031` lê `.cell-sub` → Pedido com 2 produtos pela tela → Confirmar → Plano produzir
  10 + 10 → "Reservar Produto Acabado": botão desabilitado + `title` → callout → "Ver disponibilidade" → rede → `finally`
  cancela OPs e Pedido.
- **Códigos fixos:** `CLI-000013`, `PROD-000031` (retido), `PROD-000010` (sem saldo). O código do PA é DERIVADO por
  `PROD-` → `PA-`, o que só coincidia na carga real; no clone o PA segue a sequência de itens.
- **SEM MASSA:** não (reprova com "massa retida sumiu"). **Datas fixas:** não.
- **Primeira linha:** `tbody tr` com `hasText` e `.first()` — aceitável.
- **API direta:** não. **UI:** tudo.
- **Obsoleto:** `obterRun`; monitor 4xx próprio; a base não tem lote nem PA.
- **WAVE 3:** não.
- **Fixture faltante:** `produzirPa({ liberar: false })` + 2º produto do mesmo cliente.

#### `entregas-programadas-do-pedido`

- **Fluxo:** acha PA com ≥ 10 por GET `/inventory` + `/products` → Pedido pela tela → Confirmar → Plano "Reservar de" 10
  → entregas 4 + 6 → excesso de 7 recusado na tela → "Preparar expedição" da entrega 1 → separa 2 → confere lote (Enter)
  → confirma → Entrega 1 parcial, Entrega 2 intacta → Reprogramar → Entrega 3 com 2.
- **Códigos fixos:** nenhum código, mas descobre massa real.
- **SEM MASSA:** sim.
- **Datas fixas:** 2026-10-15, 2026-11-15, 2026-12-15. Depois de 15/10/2026 a entrega aparece como "Atrasada" e a suíte
  quebra sozinha.
- **Primeira linha:** "primeiro produto com saldo".
- **API direta:** GET de descoberta de massa (fere a regra 1). **UI:** o resto.
- **Obsoleto:** `obterRun`; `process.exit`; monitor próprio.
- **WAVE 3:** não.
- **Fixture faltante:** `produzirPa({ liberar: true })`.

#### `expedicao-geral-entre-entregas`

- **Fluxo:** igual até as 2 entregas → "Preparar Expedição" geral → separa 5 → dica "Entrega 1 · 4 · Entrega 2 · 1" →
  confere → confirma → Entrega 1 atendida, Entrega 2 parcial.
- **Códigos fixos:** nenhum. **SEM MASSA:** sim. **Datas fixas:** 2026-10-15, 2026-11-15.
- **API direta:** GET de descoberta.
- **WAVE 3:** não.
- **Fixture faltante:** `produzirPa`.

#### `desconto-do-pedido-chega-ao-faturamento`

- **Fluxo:** acha PA → Projeto pela tela → vincular produto → "Criar nova versão" na ficha → `#quote-add-product` → linha
  e preço → desconto + validade → enviar → aceite → "Aprovar projeto" → "Gerar pedido…" → confirmar → Plano → expedição
  → faturamento → prévia → emitir → números → PDF.
- **Códigos fixos:** nenhum. **SEM MASSA:** sim. **Datas fixas:** `VALIDADE_FUTURA` 2099-12-31.
- **Primeira linha:** `#quote-add-product` index 1; "Lote conferido" `.first()`.
- **API direta:** GET de descoberta. **UI:** tudo; `waitForTimeout` fixos.
- **Obsoleto:** fluxo antigo do Orçamento embutido no Projeto (E2E-QUOTE-PAGE-FLOW-01).
- **WAVE 3:** SIM (dependência dura).
- **Fixture faltante:** `produzirPa` + gestos do Orçamento novo.

#### `ajuda-contextual-nivel-1`

- **Fluxo:** 5 listas → clica a 1ª linha → gatilho → mede o modal ("Quando usar" < "Próximo passo" < "Passo a passo",
  `details` fechados) → link do painel do Pedido → largura 390 no Faturamento.
- **Códigos fixos:** nenhum. **SEM MASSA:** não, mas sem documento a "1ª linha" é a linha de lista vazia. **Datas
  fixas:** não.
- **Primeira linha:** SIM (5×). **API direta:** não. **UI:** tudo.
- **Obsoleto:** o Orçamento abre pela lista de Projetos ("Como funciona o Orçamento" da ficha), mas hoje o documento é
  `/comercial/orcamentos/:id` com "Como funciona". O Faturamento sai (decisão C), e a checagem de 390 usa `TELAS[4]` =
  Faturamento.
- **WAVE 3:** suave (precisa de uma versão de orçamento).
- **Fixture faltante:** Pedido e Orçamento em rascunho por API.

#### `ordem-de-producao-produto-fora-da-primeira-pagina`

- **Fluxo:** 1ª página de `/cadastros/produtos` (premissa) → OP pela tela com `PROD-000214` → reabre a frio → campo
  "CÓDIGO · NOME" → `aplicarRoteiroNaOrdem` (API) → Planejar → produto congelado → cadastro do produto → cancelar OP.
- **Códigos fixos:** `PROD-000214` + nome "CREATINA SENIOR…" — não existe (a base tem 173).
- **SEM MASSA:** não. **Datas fixas:** não.
- **Primeira linha:** lê a 1ª página de propósito (é a premissa).
- **API direta:** POST de roteiro (pré-condição válida). **UI:** o resto.
- **Obsoleto:** `PAGINA_DA_TELA = 50`, mas a lista web pagina 20 (quem carrega 50 opções é a OP); `obterRun`;
  `lib/roteiro.mjs` (compatibilidade).
- **WAVE 3:** não.
- **Fixture existente:** cadastros + `criarRoteiroAtivo`/`aplicarRoteiro`.
- **Fixture faltante:** `definirRoteiroPadrao` (opcional, simplifica).

## Findings

- **F-01 — Escopo das waves divergente.** `docs/PROJECT_STATE.md:4572` (base auditada) diz "Próxima: WAVE 3 — grupo C
  com massa própria e, depois, o fluxo do Orçamento". O handoff deste discovery põe o grupo C na WAVE 4 e o Orçamento na
  WAVE 3.
- **F-02 — PA com saldo exige a cadeia de produção inteira, e ela toda existe por API oficial.** São 16 passos (mais o
  cliente opcional) e ~22–26 chamadas; detalhe em "Regras / contratos existentes".
- **F-03 — Roteiro padrão automático.** Toda OP nova do produto — manual, do Plano ou de saldo — já nasce com o roteiro
  padrão definido por `PUT /products/:id/production-profile` (`aplicarRoteiroPadraoAutomatico`, origem
  `AUTO_PRODUCT_DEFAULT`). Dispensa aplicar roteiro OP a OP.
- **F-04 — Picking antes do consumo; consumo trava cancelamento.** O picking confirmado é obrigatório antes do consumo, e
  o consumo leva a OP a IN_PRODUCTION — a partir daí ela não cancela mais ("já houve consumo real").
- **F-05 — Código do PA não deriva do Produto.** `disponibilidade-comercial-explicada` troca `PROD-` por `PA-`; isso só
  coincidia na carga real. No clone o PA segue a sequência de itens; é preciso ler `finishedProductItem.code`.
- **F-06 — 4xx não declarado reprova.** `lib/browser.mjs` põe todo 4xx/5xx da API não declarado em `erros`; o 400 do
  cancelamento de Pedido precisa de `esperarErroHttp`. Filtrar "Failed to load resource" à mão não basta.
- **F-07 — Datas fixas.** Entregas: 2026-10-15 / 2026-11-15 / 2026-12-15; expedição: 2026-10-15 / 2026-11-15; desconto:
  2099-12-31. Depois de 15/10/2026 a entrega aparece como "Atrasada" e as duas suítes de entrega quebram sozinhas.
- **F-08 — "SEM MASSA" em três suítes.** `entregas-programadas`, `expedicao-geral` e `desconto` saem com exit 0 (o runner
  reprova pelo texto) e descobrem massa real por GET em `/inventory` e `/products`, o que fere a regra 1.
- **F-09 — Códigos fixos da carga.** `CLI-000013` (cancelamento, disponibilidade); `PROD-000031` (cancelamento,
  disponibilidade); `PROD-000010` (disponibilidade); PA derivado de `PROD-` (disponibilidade); "CAFEÍNA PT 60 CAPS THE
  KING" + `MP-000365` (custo estimado); THE KING + `MP-000365/368/369/120` (formulação); `PROD-000214` + nome (OP fora da
  1ª página).
- **F-10 — Primeira linha e massa de outra execução.** A ajuda abre a 1ª linha de 5 listas (sem documento, é a linha de
  lista vazia); custo estimado e formulação usam `Abrir.first()` e reaproveitam rascunho de execução anterior (fere as
  regras 1 e 5).
- **F-11 — Seletor de status frágil.** Em custo estimado e formulação, `querySelector(".badge--active, .badge--warn")`
  devolve o 1º badge da página, e o selo "Qualidade" do custo usa as mesmas classes.
- **F-12 — Ajuda contextual desatualizada.** O documento do Orçamento hoje é `/comercial/orcamentos/:id`, com gatilho
  "Como funciona"; a suíte ainda chega pela lista de Projetos e usa "Como funciona o Orçamento" (ficha). O Faturamento
  sai (decisão C), e a checagem de 390 usa justamente o Faturamento (`TELAS[4]`).
- **F-13 — Premissa da OP fora da 1ª página vale sem código fixo.** `PROD-000214` não existe (a base tem 173 produtos,
  PROD-000001…173, e o clone segue a partir de 174). `/cadastros/produtos` pagina 20 por código (ascendente) e a tela da
  OP carrega 50 opções: produto novo cai fora das duas, e num clone sujo fica ainda mais longe. O comentário
  `PAGINA_DA_TELA = 50` está desatualizado frente à lista com 20 por página.
- **F-14 — Desconto depende da WAVE 3.** A suíte opera o fluxo antigo do Orçamento embutido no Projeto
  (E2E-QUOTE-PAGE-FLOW-01).
- **F-15 — Armadilha de arredondamento no custo por dose.** As linhas exibidas somam R$ 9,09, mas o total é R$ 9,10
  (9,095796): o total vem dos valores sem arredondar.
- **F-16 — Cancelamento de Pedido em atendimento.** É recusado com 400 `cancellation_blocked` enquanto houver OP em
  DRAFT, PLANNED, RELEASED, IN_PRODUCTION, COMPLETED ou BLOCKED; só CANCELLED libera.
- **F-17 — Referência manual de custo entra na estimativa.** `criarItem({ custoDeReferencia })` gera
  `initialCostReference` (referência manual), usada pela estimativa da Formulação (o golden path prova com a Caixa). Duas
  ofertas de fornecedor sem preferencial deixam o custo em aberto.
- **F-18 — Fusão entregas + expedição é tecnicamente boa.** Mesma massa, mesmos gestos (`clicar`, `escolher`,
  `esperarSecao` e `linhaDaEntrega` hoje copiados nos dois arquivos), e pedidos separados isolam os cenários (1 rascunho
  de expedição por Pedido).
- **F-19 — Contratos antigos nas suítes.** `obterRun` (compatibilidade), `process.exit` e monitores próprios de resposta
  que duplicam o coletor do `browser.mjs`.
- **F-20 — Guarda das fixtures.** `fixtures/fixtures.test.ts` impõe: fixture não navega, sem `[0]`, sem GET de lista de
  cadastro, sem código da carga. Fixture nova precisa entrar na guarda (hoje ela cobre `cadastros.mjs` e `producao.mjs`).
- **F-21 — Discovery paralela de permissões.** PRODUCTION-PERMISSION-HARDENING mexe em picking, consumo, apontamento e
  conclusão; hoje cancelar OP grava `cancelledBy` "Ambiente local" (SYSTEM_ACTOR). Não afeta as suítes: o runner é ADMIN
  e a autoria não é afirmada.
- **F-22 — Sem mudança de produto.** Toda a massa da WAVE 4 nasce por rotas existentes; `apps/api`, `apps/web`,
  `packages/shared` e migrations ficam intactos.

## Regras / contratos existentes

### Cadeia do PA com saldo (API oficial; o runner roda como ADMIN)

0. **Cliente (opcional)** — `POST /customers {legalName carimbado}`.
1. **Fornecedor** — `POST /suppliers {legalName}`.
2. **MP** — `POST /items {type: "RAW_MATERIAL", unitCode: "kg", name}`. Padrão do tipo: `controlsLot`,
   `controlsExpiry` e `requiresQualityRelease` = true; `requiresCoa` = false.
3. **Produto** — `POST /products {name, customerId, finishedUnitCode: "un"}` → APPROVED + `finishedProductItem`. Item
   FINISHED_PRODUCT com lote, validade e liberação = true; CoA = false. O golden path confirma o PA aguardando liberação.
4. **Formulação** — `GET /products/:id/formulations` → `POST /products/:id/formulation-versions` (só se não houver DRAFT)
   → `PATCH /formulation-versions/:v {basisQuantity: "1", components: [{itemId, quantity: "0.01", unitCode: "kg"}]}` →
   `POST /formulation-versions/:v/activate` → ACTIVE.
5. **Roteiro** — `POST /production-profiles {name, referenceQuantity: "1", referenceUomCode: "un"}` →
   `PATCH /production-profile-versions/:v {steps: 1 etapa, resources: []}` → `POST …/activate` →
   `GET /production-profiles/:id` → `PUT /products/:id/production-profile {productionProfileVersionId}` (ADMIN/PRODUCTION;
   versão ATIVA e unidade compatível). Efeito: toda OP nova do produto já nasce com o roteiro
   (`aplicarRoteiroPadraoAutomatico`, `AUTO_PRODUCT_DEFAULT`).
6. **OC** — `POST /purchase-orders {supplierId, orderDate: diaComercial(0), lines: [{itemId, orderedQuantity}]}` → DRAFT.
   Exige fornecedor ativo e item RAW_MATERIAL/PACKAGING ativo; não exige homologação. `POST /purchase-orders/:id/confirm`
   → ORDERED.
7. **Recebimento** — `POST /purchase-orders/:id/receipts {receivedAt: agora em ISO, lines: [{purchaseOrderLineId,
   receivedQuantity, supplierLot: "LF-<runId>", expiryDate: diaComercial(+365)}]}`. Exige OC ORDERED ou
   PARTIALLY_RECEIVED, `supplierLot`, validade ≥ `receivedAt` e quantidade ≤ saldo aberto. Resultado: lote
   `LT-<dia SP>-…` em AWAITING_RELEASE, movimento RECEIPT_IN, OC RECEIVED; a linha do DTO traz `lotId` e `lotCode`.
8. **Liberação da MP** — `POST /lots/:loteMp/release` (QUALITY/ADMIN). Só aceita AWAITING_RELEASE, com CoA aprovado
   quando exigido e lote não vencido → AVAILABLE.
9. **OP** — `POST /production-orders {productId, plannedQuantity, notes: "Massa E2E <carimbo>"}` (ADMIN/PRODUCTION) →
   DRAFT com a formulação ACTIVE e o roteiro padrão.
10. **Planejar** — `POST /production-orders/:id/plan`. Exige DRAFT, roteiro (senão 400 `route_required`), produto ativo
    com PA, formulação ACTIVE, quantidade > 0 e ≥ 1 componente → PLANNED; congela produto, formulação e cliente.
11. **Liberar** — `POST /production-orders/:id/release`. Exige PLANNED + roteiro. Aloca FEFO/FIFO só em lote AVAILABLE do
    dono VERIDI, tudo ou nada (falta de estoque → 400 "estoque disponível insuficiente") → RELEASED, reserva de material
    ACTIVE com linhas por lote, partes e número oficial NNN/AA.
12. **Picking** — para cada linha ativa de `reservation.reservationLines`:
    `POST /production-orders/:id/picking/:lineId/confirm {lotCode}`. Exige OP RELEASED ou IN_PRODUCTION, lote ainda
    elegível e código igual ao reservado → `pickedAt`.
13. **Consumo** — `POST /production-orders/:id/consumptions {entries: [{reservationLineId, quantity: remainingQuantity}]}`.
    Exige picking confirmado e quantidade ≤ restante e ≤ físico → PRODUCTION_CONSUMPTION; a OP passa de RELEASED para
    IN_PRODUCTION. A partir daqui a OP NÃO cancela mais ("já houve consumo real").
14. **Apontamento** — `POST /production-orders/:id/outputs {quantity, destination: "NEW_LOT", businessLotNumber:
    "LV-<runId>", expiryDate: diaComercial(+730)}`. Exige IN_PRODUCTION, PA com controle de lote, quantidade ≤ planejado
    restante e validade (ou vida útil) ≥ data de produção. Resultado: lote de PA em AWAITING_RELEASE +
    FINISHED_GOOD_PRODUCTION; `outputs[]` traz `lotId`, `lotCode` e `businessLotNumber`.
15. **Conclusão** — `POST /production-orders/:id/complete {}`. Exige IN_PRODUCTION, ≥ 1 apontamento, sem variação (ou
    `completionReason`) e todo material reconciliado → COMPLETED; a reserva restante é liberada.
16. **Liberação do PA** — `liberar = true`: `POST /lots/:lotePa/release` → AVAILABLE; em `/inventory/:paItemId`,
    onHand = available = quantidade. `liberar = false`: o lote fica em AWAITING_RELEASE — físico sim, disponível 0, motivo
    AWAITING_QUALITY_RELEASE ("N un aguardando liberação da Qualidade").

Custo: ~22–26 chamadas (1 picking por lote reservado; 1 quando a MP tem lote único). Quantidades aceitam até 12 casas
(`CASAS_QUANTIDADE`).

### Qualidade e validade

- Necessário na WAVE 4:
  - AWAITING_RELEASE: MP depois do recebimento; PA depois do apontamento; PA retido da disponibilidade;
  - RELEASED (= AVAILABLE): MP antes de liberar a OP (o FEFO só vê AVAILABLE); PA antes de reservar ou expedir;
  - validade obrigatória em MP e PA (`controlsExpiry`) e ≥ recebimento/produção. Lote vencido não libera, não separa e
    não expede: usar sempre `diaComercial(+365/+730)`.
- Não necessário: BLOCKED, REJECTED, CoA (`requiresCoa` = false por padrão), desbloqueio, FEFO entre lotes, lote vencido.

### Pedido, Plano de Atendimento e cancelamento

- Pedido DRAFT → "Confirmar pedido" + diálogo "Confirmar" → CONFIRMED ("Confirmado").
- Plano: `POST /customer-orders/:id/apply-fulfillment-plan {lines: [{customerOrderLineId, reserveQuantity,
  produceQuantity}]}`, com reservar + produzir = quantidade pedida → IN_FULFILLMENT ("Em atendimento") e OP DRAFT com
  origem CUSTOMER_ORDER (link `/producao/ordens/:id` na tela do Pedido).
- "Cancelar pedido" aparece em DRAFT, CONFIRMED e IN_FULFILLMENT; motivo com ≥ 3 caracteres (`#co-cancel-reason`).
- Em atendimento, `POST /customer-orders/:id/cancel` é recusado com 400 `cancellation_blocked`, num `.form-alert` do
  diálogo, com a mensagem:
  "Pedido em atendimento possui reserva de produto acabado e/ou Ordens de Produção ativas — resolva essas dependências antes de cancelar."
  Bloqueiam as OPs DRAFT, PLANNED, RELEASED, IN_PRODUCTION, COMPLETED e BLOCKED; só CANCELLED libera.
- "Cancelar OP" aparece com `canOperate` em DRAFT, PLANNED ou RELEASED → `#op-cancel-reason` →
  `.confirm-dialog__actions` "Cancelar OP" → `POST /production-orders/:id/cancel {reason}` (ADMIN/PRODUCTION) →
  "Cancelada". OP RELEASED devolve a reserva; OP IN_PRODUCTION recusa.
- Pedido com expedição confirmada não cancela mais.

### Entregas programadas

- Programar só em CONFIRMED ou IN_FULFILLMENT; data em AAAA-MM-DD;
  `POST /customer-orders/:id/deliveries {scheduledDate, lines}`.
- A tela recusa o excesso antes do envio: "Quantidade acima do saldo — …" e "Salvar entrega" desabilitado.
- Reprogramar: `POST /customer-order-deliveries/:id/reschedule {scheduledDate, reason}`. Recusa entrega com expedição em
  rascunho e entrega já atendida. A original fica "Cancelada" mostrando o que já atendeu ("· reprogramada para a N"), e a
  substituta nasce com o saldo pendente ("· substitui a N").
- Leituras de situação: "Programada", "Parcialmente atendida", "Atendida", "Cancelada"; data anterior a hoje (SP)
  aparece como "Atrasada".

### Expedição

- `POST /customer-orders/:id/shipments {deliveryId?}`. Com `deliveryId`, a proposta fica limitada ao que a entrega
  promete; sem ele, a quantidade é repartida entre as promessas (`repartirNasPromessas`), com a dica
  "Entrega N · quantidade" na linha do lote.
- Um rascunho de expedição por Pedido.
- `PATCH /shipments/:id {lines}` ("Salvar separação") → `POST /shipments/:id/lines/:lineId/verify {lotCode}`
  ("Conferido") → `POST /shipments/:id/confirm` ("Confirmada").
- Pedido parcialmente expedido fica PARTIALLY_SHIPPED.

### Faturamento

- `POST /billings {shipmentId}` a partir da expedição confirmada ("Preparar faturamento"). O preço da linha é o
  `agreedUnitPrice` do Pedido, sem desconto embutido; o desconto é congelado na criação (`discountPercentSnapshot`).
- `POST /billings/:id/issue` → ISSUED ("Emitido"). Cancelar só vale em rascunho.
- PDF em `/comercial/faturamento/:id/imprimir`, lido por `lib/pdf.mjs` (`textoDoPdfDaTela`).

### Orçamento → Pedido

- `POST /projects {customerId, name}`; `POST /projects/:id/products {operation: "link", productId}`;
  `POST /projects/:id/quote-versions` (COMMERCIAL/ADMIN); `POST /quote-versions/:id/lines {projectProductId}`;
  `PATCH /quote-lines/:id`; `PATCH /quote-versions/:id {discountPercent, validUntil}`; `POST …/send`; `POST …/accept`;
  `POST /projects/:id/approve`; `POST /quote-versions/:id/create-order` (exige versão ACCEPTED e projeto APPROVED).

### Motor de quantidade da Formulação

Motor único em `packages/shared/src/formulation-quantity.ts`:

- fator PER_DOSE = doses × quantidade produzida; quantidade declarada × fator;
- converte mg → kg pela unidade-base (mg = 0,001 g) ANTES dos ajustes;
- só ajusta com `THEORETICAL_WITH_ADJUSTMENTS` + `applyPurityAdjustment`/`applyOverageAdjustment`;
- em `PHYSICAL_DIRECT`, físico = teórico. A tela diz: "Quantidade física informada. Pureza e overage estão registrados,
  não aplicados."

Campos da API: `purityPercentApplied`, `overagePercent`, `quantityMode`, `basis`; na versão, `calculationMode` e
`dosesPerPackage`.

### Custo estimado da Formulação

- A referência manual (`initialCostReference`) entra na estimativa; duas ofertas sem preferencial deixam o custo em aberto.
- A coluna "Quantidade física para a base" mostra a quantidade física, com a declarada como dica embaixo; abaixo da
  tabela: "Custo estimado da base", "Custo estimado por unidade" e "Qualidade" ("Estimado" quando todos os componentes
  têm custo).
- Com edição pendente, o bloco se identifica: "Custo do último salvamento — há alteração pendente…".

### Ajuda contextual (tópicos V2)

- Orçamento, Formulação, Pedido e OP usam tópicos V2: "Quando usar", "Próximo passo" e "Passo a passo"; seções recolhidas
  Termos, Situações, Atenção e Exemplo (≥ 3); links internos.
- Gatilho padrão "Como funciona". No Pedido existem também "Como funciona o Plano" e "Como funciona a reserva".
- Títulos: "Orçamento: a proposta de preço e o que o aceite autoriza"; "Formulação: a receita em versões, e o que cada
  número significa"; "Pedido do Cliente: da confirmação à expedição"; "Ordem de Produção: do planejamento ao lote
  acabado".

### Listagens e seletores

- `/cadastros/produtos` pagina 20 por código (ascendente); a tela da OP carrega 50 opções de produto.
- O campo de entidade mostra "CÓDIGO · NOME"; o produto da OP é resolvido pelo DTO da OP, não pela página de 50.
- `/estoque?search=…` inicializa a busca pela URL (`useInitialFilters`); a Posição de Estoque e o Pedido montam a
  explicação da indisponibilidade com `INVENTORY_UNAVAILABLE_REASON_LABELS`.
- A seção de reserva do Pedido consulta `GET /customer-orders/:id/reservation-status` uma vez por carga (o StrictMode do
  dev dobra).

### Permissões observadas

- cancelar Pedido: sem papel específico;
- criar e cancelar OP: ADMIN/PRODUCTION;
- liberar lote: QUALITY/ADMIN;
- `PUT /products/:id/production-profile`: ADMIN/PRODUCTION;
- `POST /projects/:id/quote-versions`: COMMERCIAL/ADMIN;
- `cancelledBy` da OP grava "Ambiente local" (SYSTEM_ACTOR);
- o runner usa ADMIN próprio da execução (decisão G).

### Regras vigentes das suítes e do runner

- massa própria carimbada com o runId; nunca "o primeiro registro", nunca código da carga;
- pré-condição por API quando valem as quatro condições da decisão A; GET de conferência livre; Prisma e SQL proibidos;
- console e rede sujos reprovam; recusa provocada se declara com `esperarErroHttp`;
- sem estado entre execuções; reexecutável em base suja; "SEM MASSA" reprova;
- guarda de `fixtures/fixtures.test.ts`: fixture não navega, sem `[0]`, sem GET de lista de cadastro, sem código da carga.

### Endpoints usados na WAVE 4

- **Cadastro:** `POST /customers` · `POST /suppliers` · `POST /items` · `POST /products` · `GET /products/:id`
- **Formulação:** `GET /products/:id/formulations` · `POST /products/:id/formulation-versions` ·
  `PATCH /formulation-versions/:id` · `POST /formulation-versions/:id/activate` · (pela tela)
  `POST /formulation-versions/:id/new-version`
- **Roteiro:** `POST /production-profiles` · `PATCH /production-profile-versions/:id` ·
  `POST /production-profile-versions/:id/activate` · `GET /production-profiles/:id` ·
  `PUT /products/:id/production-profile` · `POST /production-orders/:id/production-profile`
- **Compra e estoque:** `POST /purchase-orders` · `POST /purchase-orders/:id/confirm` ·
  `POST /purchase-orders/:id/receipts` · `POST /lots/:id/release` · `GET /lots/:id` · `GET /inventory/:itemId`
- **Produção:** `POST /production-orders` · `POST …/plan` · `POST …/release` ·
  `POST …/picking/:reservationLineId/confirm` · `POST …/consumptions` · `POST …/outputs` · `POST …/complete` ·
  `POST …/cancel {reason}` · `GET /production-orders/:id`
- **Pedido:** `POST /customer-orders` · `POST …/confirm` · `GET …/fulfillment-plan` · `POST …/apply-fulfillment-plan
  {lines: [{customerOrderLineId, reserveQuantity, produceQuantity}]}` · `POST …/cancel {reason}` ·
  `GET …/reservation-status` · `POST …/reserve-available`
- **Entregas:** `GET /customer-orders/:id/deliveries` · `POST /customer-orders/:id/deliveries {scheduledDate, lines}` ·
  `POST /customer-order-deliveries/:id/reschedule {scheduledDate, reason}`
- **Expedição:** `POST /customer-orders/:id/shipments {deliveryId?}` · `PATCH /shipments/:id {lines}` ·
  `POST /shipments/:id/lines/:lineId/verify {lotCode}` · `POST /shipments/:id/confirm`
- **Faturamento:** `POST /billings {shipmentId}` · `POST /billings/:id/issue` · `GET /billings/:id`
- **Orçamento** (ajuda; no desconto é da WAVE 3): `POST /projects {customerId, name}` ·
  `POST /projects/:id/products {operation: "link", productId}` · `POST /projects/:id/quote-versions` ·
  `POST /quote-versions/:id/lines {projectProductId}` · `PATCH /quote-lines/:id` ·
  `PATCH /quote-versions/:id {discountPercent, validUntil}` · `POST …/send` · `POST …/accept` ·
  `POST /projects/:id/approve` · `POST /quote-versions/:id/create-order`

## Gaps

Para implementar a WAVE 4 faltam:

- `produzirPa` e as funções pequenas da cadeia: `receberPorCompra`, `liberarLote`, `definirRoteiroPadrao`,
  `liberarOrdem`, `separarEConsumir`, `apontarProducao`, `concluirOrdem`;
- `criarProdutoOperacional` devolver `itemAcabadoCodigo`; `criarFormulacaoAtiva` aceitar modo de cálculo, doses por
  embalagem, base, pureza, overage e modo de quantidade;
- fixture mínima de Pedido (`criarPedido`; `confirmarPedido` e `aplicarPlano` só se a P2 for "API");
- Orçamento em rascunho para a ajuda (da WAVE 3 ou `criarOrcamentoRascunho` local);
- contratos das fixtures novas em `fixtures.test.ts` e guarda estendida a `estoque.mjs`, `produto-acabado.mjs` e
  `pedido.mjs`;
- prova `pa-produzido-por-api.mjs` e baterias `wave-04` e `provas-wave-04` no runner, com `scripts/e2e-run.test.ts`;
- nas suítes: declarar o 400 do cancelamento; trocar datas fixas por `diaComercial`; ler o código do PA; ler o badge do
  cabeçalho da versão; abrir documentos por URL/id; tirar primeira linha, código fixo, `obterRun` e descoberta de massa
  por GET; fundir entregas e expedição; migrar o desconto para o fluxo novo do Orçamento.

Lacunas do próprio discovery:

- os valores de pureza e overage do caso histórico (THE KING) não estão na suíte nem nos docs;
- os helpers da WAVE 3 não existiam na base auditada (nada mergeado) — nomes a confirmar;
- o relatório não trouxe seção própria para preferência de usuário; estados globais e race conditions aparecem só de
  forma indireta (massa nova por execução, StrictMode, um rascunho de expedição por Pedido).

## Riscos

O discovery não atribuiu severidade numérica. A coluna "Classificação" usa os termos do próprio relatório.

| # | Risco | Classificação | Detalhe |
|---|---|---|---|
| R-01 | WAVE 3 não mergeada na base auditada | Bloqueia a 4E | branch da WAVE 3 sem commit; o desconto depende da página da versão, da aprovação na ficha e de "Gerar pedido" no Fechamento |
| R-02 | Escopo WAVE 3 × `PROJECT_STATE.md` | Bloqueia o início (P1) | o doc dava o grupo C à WAVE 3 — risco de trabalho duplicado |
| R-03 | PRODUCTION-PERMISSION-HARDENING em paralelo | Não bloqueia | mexe em picking, consumo, apontamento e conclusão; o runner ADMIN segue passando |
| R-04 | Arquivos em comum com a WAVE 3 | Conflito provável | `scripts/e2e-run.mjs` (BATERIAS), `scripts/e2e-run.test.ts`, `fixtures/cadastros.mjs`, `fixtures/fixtures.test.ts`, `scripts/e2e/README.md`, `docs/E2E_STRATEGY.md`, `docs/PROJECT_STATE.md`, `docs/BACKLOG.md` |
| R-05 | Datas fixas nas suítes de entrega | Ajuste obrigatório | depois de 15/10/2026 a entrega lê "Atrasada" e a suíte quebra sozinha |
| R-06 | 4xx provocado e não declarado | Ajuste obrigatório | o cancelamento reprova sem `esperarErroHttp` para o 400 |
| R-07 | Código do PA derivado de `PROD-` | Obrigatório | `PROD-` → `PA-` só coincidia na carga real |
| R-08 | Status lido do 1º badge da página | Obsoleto | o selo "Qualidade" usa as mesmas classes; ler o badge do cabeçalho da versão |
| R-09 | Arredondamento do custo por dose | Armadilha | linhas exibidas somam R$ 9,09; total R$ 9,10 |
| R-10 | Operações irreversíveis | Só no clone | recebimento, liberação de lote, liberação da OP, consumo, apontamento, conclusão, expedição confirmada, faturamento emitido, entrega reprogramada/cancelada, orçamento enviado/aceito, projeto aprovado, Pedido e OP cancelados — o runner remove o clone |
| R-11 | Cleanup impossível | Resíduo declarado | entregas + expedição (expedição confirmada) e desconto (faturamento emitido); a rodada suja segue segura porque toda suíte cria massa nova |
| R-12 | StrictMode do dev | Limite mantido | dobra `reservation-status`; o limite ≤ 4 da disponibilidade continua valendo |
| R-13 | Tempo de execução | Estimativa | bateria `wave-04` prevista em 8–12 min por passe, ×2 por gate |

Operações irreversíveis, em detalhe:

- recebimento (RECEIPT_IN, sem estorno);
- liberação de lote (AVAILABLE; depois, só bloqueio);
- liberação da OP (gasta número oficial);
- consumo (OP em produção não cancela mais);
- apontamento (cria lote de PA) e conclusão (COMPLETED);
- expedição confirmada (saída física; o Pedido não cancela mais);
- faturamento emitido (cancelar só vale em rascunho);
- entrega reprogramada ou cancelada (fica no histórico);
- orçamento enviado/aceito e projeto aprovado;
- Pedido e OP cancelados (terminais).

## Cenários relevantes

### Prova da fixture (`pa-produzido-por-api.mjs`, bateria `provas-wave-04`)

- `liberar: true` e `liberar: false`;
- posição em `/inventory` do PA;
- lote de PA apontando para a OP;
- negativo: "sem liberar a MP, a OP não libera (400)".

### Cancelamento

Massa mínima: cliente + produto operacional + formulação ativa (1 MP sem estoque). Não precisa de estoque nem de roteiro
(OP DRAFT cancela).

1. Pedido DRAFT → "Confirmar pedido" + diálogo "Confirmar" → CONFIRMED ("Confirmado").
2. Plano: "Produzir de <PROD>" 10 → "Aplicar Plano de Atendimento" + "Aplicar Plano" → IN_FULFILLMENT ("Em
   atendimento") e OP DRAFT com origem CUSTOMER_ORDER (link `/producao/ordens/:id` na tela do Pedido).
3. "Cancelar pedido" → `#co-cancel-reason` (≥ 3 caracteres) → `.confirm-dialog__actions` "Cancelar pedido" →
   `POST /customer-orders/:id/cancel` → 400 `cancellation_blocked` com a mensagem de dependência num `.form-alert`.
4. OP: "Cancelar OP" → `#op-cancel-reason` → `.confirm-dialog__actions` "Cancelar OP" →
   `POST /production-orders/:id/cancel {reason}` → "Cancelada".
5. Volta ao Pedido → "Cancelado"; o botão some; a OP segue "Cancelada" no histórico.

Ajuste obrigatório: `esperarErroHttp({ status: 400, metodo: "POST", caminho: /\/customer-orders\/[^/]+\/cancel$/ })`
antes do clique.

### Custo estimado

Massa própria = a mesma da formulação física, aberta por URL em `/producao/formulacoes/<productId>`. V1 ATIVA por API;
V2 pela tela ("Nova versão a partir desta" na linha da V1 do "Histórico de versões", ou "Copiar versão deste produto").
Nada de reaproveitar rascunho: cada execução tem produto novo.

Números (componente A = 200 mg/dose, 60 doses, R$ 700,00/kg):

- antes: A 0,012 kg → R$ 8,40; custo da base (1 un) R$ 9,10;
- com 400 mg digitado e não salvo: aviso "Custo do último salvamento — há alteração pendente…"; número ainda R$ 8,40;
- depois de salvar: A 0,024 kg → R$ 16,80 (dobra); base R$ 17,50 (17,495796); o aviso some;
- voltando a 200 e salvando: A R$ 8,40; base R$ 9,10.

Precisão: `formatBRL` com 2 casas; a suíte compara a linha com tolerância de 0,02 e a base pelo texto. O campo
"Quantidade de <MP-A>" é DecimalField pt-BR: 200 e 400 não têm separador de milhar. Status: ler o badge do cabeçalho da
versão, não o 1º `.badge--active` da página.

### Formulação física / custo

Versão: `calculationMode` "PER_DOSE", `dosesPerPackage` 60, `basisQuantity` "1" (un). Componentes com item em kg,
`unitCode` "mg", `basis` "PER_DOSE", `quantityMode` "PHYSICAL_DIRECT", pureza e overage REGISTRADOS.

| Componente | Declarado | × 60 doses | Físico na base | Referência | Custo | Exibido |
|---|---|---|---|---|---|---|
| A | 200 mg | 12.000 mg | 0,012 kg | R$ 700,00/kg | 8,40 | R$ 8,40 |
| B | 5 mg | 300 mg | 0,0003 kg | R$ 44,32/kg | 0,013296 | R$ 0,01 |
| C | 20 mg | 1.200 mg | 0,0012 kg | R$ 126,00/kg | 0,1512 | R$ 0,15 |
| D | 253 mg | 15.180 mg | 0,01518 kg | R$ 35,00/kg | 0,5313 | R$ 0,53 |
| Base (1 un) = por unidade | | | | | 9,095796 | R$ 9,10 |

- Qualidade "Estimado". ARMADILHA: as linhas exibidas somam R$ 9,09; o total vem dos valores sem arredondar.
- A tabela de componentes (`.estoque-valor--equivalente` e `--fisico`, por unidade) mostra o mesmo 0,012 kg etc. que a
  coluna "Quantidade física para a base" do custo, com a declarada (200 mg) como dica embaixo.
- Negativos antigos continuam válidos: "0,0002 kg", "0,000005 kg", "0,00002 kg", "0,000253 kg".
- Referências por `criarItem({ custoDeReferencia })`, sem oferta de fornecedor.
- Pureza/overage da massa própria a decidir (proposta 98 % e 5 %) — P5.

### Disponibilidade

Massa:

- cliente C;
- Produto A = `produzirPa({ cliente: C, quantidade: "10", liberar: false })` → lote de PA em AWAITING_RELEASE com 10 un;
- Produto B = `criarProdutoOperacional(C)` + formulação ativa, sem lote nenhum.

Pedido de C: A 10 + B 10 → confirmar → Plano Reservar 0 / Produzir 10 em cada → IN_FULFILLMENT + 2 OPs DRAFT.

- Estoque: `/estoque?search=<itemAcabadoCodigo de A>` → `.cell-sub` "10 un aguardando liberação da Qualidade".
- Pedido, seção "Reservar Produto Acabado":
  - "Disponível agora" 0 + `.cell-sub` com a MESMA frase (as duas telas usam `INVENTORY_UNAVAILABLE_REASON_LABELS`);
  - "Reservar disponível" desabilitado, com `title`:
    "Nenhuma linha tem produto disponível para reservar agora — o motivo está acima."
  - `.callout` "2 produtos sem disponibilidade suficiente para reservar.", com um link "Ver disponibilidade" em cada linha:
    - A: "faltam 10 un de 10 un — 10 un aguardando liberação da Qualidade."
    - B: "… — nada retido em estoque: a quantidade que falta ainda não foi produzida nem recebida."
  - "Ver disponibilidade" → `/estoque/<itemId>` → h1 com código e nome do PA;
  - reserva: `GET /customer-orders/:id/reservation-status`, 1 por carga (o StrictMode dobra; o limite ≤ 4 da suíte
    continua valendo); sugestão de produção no fulfillment-plan (`suggestedProductionQuantity`).
- Obrigatório: ler o código do PA de `itemAcabadoCodigo`, nunca derivar de `PROD-`.
- Cleanup, nesta ordem, no `finally`: cancelar as 2 OPs DRAFT, depois o Pedido. Ficam o lote retido e a OP concluída do
  `produzirPa` (massa carimbada; clone descartável; a rodada suja cria outra).

### Entregas (cenário A da suíte fundida)

Massa: cliente + `produzirPa({ quantidade: "20", liberar: true })` → 1 lote de PA AVAILABLE com 20 un (serve A e B).

1. Pedido A com 10 → confirmar → Plano "Reservar de <PROD>" 10 → IN_FULFILLMENT (reserva ativa de 10).
2. "Adicionar entrega programada" → "Data programada" `diaComercial(+30)`, "Programar <PROD>" 4 → "Salvar entrega" →
   Entrega 1.
3. Excesso: `diaComercial(+61)` com 7 → "Quantidade acima do saldo — …" e "Salvar entrega" desabilitado; corrige para 6 →
   Entrega 2.
4. A tela diz "Todo o pedido já está programado ou expedido — não há saldo para programar." e não mostra nenhum EXP-.
5. "Preparar expedição" da Entrega 1 → `POST …/shipments {deliveryId}` → rascunho limitado a 4 (soma dos "Quantidade do
   lote").
6. Lote com 2 → "Salvar separação" → "Lote conferido da linha <LT>" + Enter → "Conferido" → "Confirmar expedição" +
   "Confirmar" → "Confirmada".
7. Pedido: Entrega 1 "Parcialmente atendida", Entrega 2 "Programada".
8. "Reprogramar" na Entrega 1 → "Nova data programada" `diaComercial(+91)`, "Motivo" → "Reprogramar" → Entrega 1
   "Cancelada" mostrando 2 atendidas + "· reprogramada para a 3"; Entrega 3 com 2 + "· substitui a 1"; Entrega 2 intacta.

### Expedição (cenário B)

Pedido B com 10 (mesma massa) → Plano Reservar 10 → Entrega 1 (+30) com 4 e Entrega 2 (+61) com 6.

- "Preparar Expedição" (seção de reserva; `POST …/shipments` sem `deliveryId`) → lote com 5 → "Salvar separação" → dica na
  linha do lote "Entrega 1 · 4 · Entrega 2 · 1" (`repartirNasPromessas`); o campo continua 5 → conferir → confirmar.
- Resultado: Entrega 1 "Atendida", Entrega 2 "Parcialmente atendida" com 1. O Pedido fica PARTIALLY_SHIPPED.
- Quantidade de PA para a suíte fundida: 20. Alternativa: um `produzirPa` por cenário (+ ~3 s) para independência total.

### Desconto → faturamento

Massa: cliente + `produzirPa({ cliente, quantidade: "2", liberar: true })`.

Até o aceite = WAVE 3 (Orçamento novo): projeto, vincular produto, versão em `/comercial/orcamentos/:id`, linha
2 × R$ 100,00, desconto 10 %, validade `diaComercial(+30)` (não 2099), salvar, enviar ("Enviar mesmo assim" sem
precificação), aceite, "Aprovar projeto" na ficha, "Gerar pedido a partir do orçamento aceito" (seção Fechamento da
página da versão).

Depois do aceite (WAVE 4):

1. Pedido em RASCUNHO congela subtotal R$ 200,00 e total R$ 180,00 → "Confirmar pedido" + "Confirmar".
2. Plano (reserva sugerida de 2) → "Aplicar Plano" → "Em atendimento" → "Preparar Expedição" → conferir lote →
   "Confirmar expedição".
3. "Preparar faturamento" (tela da Expedição) → `POST /billings {shipmentId}` → rascunho com "Subtotal bruto (prévia):
   R$ 200,00 · Desconto comercial: − R$ 20,00" e "Total faturado (prévia): R$ 180,00".
4. "Emitir faturamento" + "Emitir" → ISSUED ("Emitido"), com "Subtotal bruto: R$ 200,00", "Desconto comercial: −
   R$ 20,00", sem "Ajuste de fechamento", "Total faturado: R$ 180,00" e preço da linha 100,00 (`agreedUnitPrice`, sem
   desconto embutido).
5. PDF em `/comercial/faturamento/:id/imprimir`, lido por `lib/pdf.mjs` (`textoDoPdfDaTela`).

Conta: 2 × 100 = 200; 10 % = 20; ajuste 0; total 180 = acordado. Desconto congelado na criação do faturamento
(`discountPercentSnapshot`).

Helpers da WAVE 3 que a suíte deve reutilizar (nada mergeado na base auditada; nomes a confirmar): criar projeto e
vincular produto; abrir versão por URL; linha com preço manual; condições (desconto, validade); enviar e aceitar; aprovar
projeto; gerar pedido devolvendo o id do Pedido.

### Ajuda contextual (4 documentos — decisão C)

| Tela | Documento | Gatilho | Título do painel | Massa |
|---|---|---|---|---|
| Orçamento | `/comercial/orcamentos/<quoteVersionId>` | "Como funciona" | "Orçamento: a proposta de preço e o que o aceite autoriza" | cliente, produto, `POST /projects`, `POST /projects/:id/products {operation:"link"}`, `POST /projects/:id/quote-versions` (rascunho) |
| Formulação | `/producao/formulacoes/<productId>` | "Como funciona" | "Formulação: a receita em versões, e o que cada número significa" | `criarProdutoOperacional` + `criarFormulacaoAtiva` (a página da versão usa o mesmo tópico) |
| Pedido | `/comercial/pedidos/<orderId>` | "Como funciona" com exact | "Pedido do Cliente: da confirmação à expedição" | `POST /customer-orders` (rascunho) |
| OP | `/producao/ordens/<opId>` | "Como funciona" | "Ordem de Produção: do planejamento ao lote acabado" | `criarOrdemDeProducao` |

- No Pedido, "Como funciona o Plano" e "Como funciona a reserva" são outros gatilhos (por isso o exact).
- Teste do link: painel do Pedido (`/producao/ordens`, `/comercial/expedicoes`, `/cadastros/produtos`).
- Largura 390: trocar o Faturamento pelo Pedido.
- Sem 1ª linha; a massa só é lida depois de criada; sem cleanup (rascunhos carimbados).

### OP fora da primeira página

- Premissa natural confirmada: a base tem 173 produtos (PROD-000001…173) e o clone segue a partir de 174.
  `/cadastros/produtos` pagina 20 por código (asc) e a OP carrega 50 opções: o produto novo cai fora das duas — num
  clone sujo, mais longe. `PROD-000214` sai da suíte.
- Conferir a premissa também por GET livre: `/products?page=1&pageSize=50` sem o id (a tela só mostra 20).
- Fixture: cliente, MP em kg, produto em "un", formulação ativa, roteiro ativo + PUT do roteiro padrão. A OP criada pela
  tela já nasce com roteiro, sem chamada de API no meio da suíte. Plano B: `aplicarRoteiro` depois de criar, como hoje.
- A tela prova:
  1. `/producao/ordens/nova` → `#op-product` digitando o código → opção → `#op-quantity` 2 → `#op-notes` com carimbo →
     "Salvar rascunho" → h1 OP-…;
  2. carga a frio → `#op-product` mostra "<PROD> · <nome>" (resolvido pelo DTO da OP, não pela página de 50) → sem
     "Produto sem item de produto acabado válido." e sem "Produto sem formulação ativa." → "Unidade" = "un";
  3. "Planejar OP" → "Planejada" → produto congelado como "<PROD> — <nome>";
  4. `/cadastros/produtos`, `#products-search` → modal sem "não tem item de produto acabado vinculado";
  5. "Cancelar OP" + `#op-cancel-reason` → "Cancelada".

### Cleanup por suíte

- prova do `produzirPa`: nenhum (estado final carimbado);
- cancelamento: a própria prova termina com Pedido e OP cancelados;
- custo estimado: nenhum; voltar ao valor original é a prova 3; a V2 fica em rascunho;
- formulação: nenhum (V2 em rascunho);
- disponibilidade: `finally` cancela as 2 OPs DRAFT e depois o Pedido; ficam o lote retido e a OP concluída;
- entregas + expedição: impossível (expedição confirmada); resíduo declarado no log;
- desconto: impossível (faturamento emitido);
- ajuda: nenhum (rascunhos);
- OP fora da 1ª página: cancela a OP pela tela (último passo).

Rodada suja: toda suíte cria massa nova; nenhuma depende de limpeza.

## Alternativas consideradas

| Tema | Alternativas | Posição do discovery | Situação |
|---|---|---|---|
| Pré-condição Pedido + Confirmar + Plano | tela × API | API na ajuda; tela no cancelamento; disponibilidade e entregas/expedição em aberto (API poupa ~30–60 s por suíte) | P2 |
| Roteiro das OPs | roteiro padrão do produto (`PUT`) × `aplicarRoteiro` por OP | roteiro padrão; `aplicarRoteiro` como plano B | P7 |
| PA da suíte fundida | 20 un para os dois cenários × um `produzirPa` por cenário (+ ~3 s) | 20 un; alternativa registrada | P4 |
| Documento do Orçamento na ajuda | página da versão ("Como funciona") × ficha do Projeto ("Como funciona o Orçamento") | página da versão | P6 |
| Documento da Formulação na ajuda | detalhe do produto × página da versão | detalhe do produto | P6 |
| Largura 390 na ajuda | Faturamento × Pedido | Pedido | P6 |
| Desconto sem helper da WAVE 3 | projeto/versão/linha/condições por API × desconto digitado no Orçamento | em aberto | P8 |
| Pureza e overage da massa própria | registrados e não aplicados × cenário novo de ajuste aplicado | 98 % e 5 %, registrados; sem cenário novo | P5 |
| Suíte de entregas e expedição | fundir × manter dois arquivos | fundir (tecnicamente boa) e remover os dois antigos | P3 (nome e remoção) |
| V2 no custo estimado | "Nova versão a partir desta" × "Copiar versão deste produto" | pela tela, sem reaproveitar rascunho | — |
| Premissa da OP fora da 1ª página | só a tela (20) × tela + `GET /products?page=1&pageSize=50` | tela + GET de conferência | — |
| OC e recebimento na fixture | tela × API | API na fixture; a tela fica com `recebimento-validacao-viva` | — |
| Orçamento em rascunho | helper da WAVE 3 × `criarOrcamentoRascunho` local | esperar a WAVE 3; local se não vier | — |
| Fixture de expedição | `expedicao.mjs` × gestos de tela nas suítes | não criar nesta wave | — |
| `produto` do `produzirPa` | fixture cria produto + formulação + roteiro × quem chama garante | os dois modos na mesma assinatura | — |

## Recomendação

1. Implementar a WAVE 4 em subwaves, na ordem ajustada: 4A → 4B → 4C → 4D → 4F → 4E (detalhe em "Plano recomendado de
   implementação").
2. Reclassificar as suítes para a WAVE 4:
   - **C1**, só cadastro por API: `formulacao-quantidade`, `custo-estimado`, `ordem-de-producao`, `cancelamento`, `ajuda`;
   - **C2**, PA por produção (`produzirPa`): `disponibilidade` (PA retido), entregas + expedição (PA liberado);
   - **C3**, PA + fluxo novo do Orçamento: `desconto` (depende da WAVE 3).
3. Construir `produzirPa(api, run, opções)` como orquestrador fino sobre funções pequenas (assinatura e regras no plano).
4. Nas suítes reescritas:
   - declarar o 400 do cancelamento com `esperarErroHttp`;
   - datas por `diaComercial(+30 / +61 / +91)` e validade do Orçamento `diaComercial(+30)`;
   - código do PA lido de `itemAcabadoCodigo`;
   - status da Formulação pelo badge do cabeçalho da versão;
   - documentos abertos por URL/id;
   - premissa da OP conferida também por `GET /products?page=1&pageSize=50`;
   - roteiro padrão do produto por `PUT` (plano B: `aplicarRoteiro`);
   - checagem de 390 da ajuda no Pedido;
   - pureza e overage da massa própria: proposta 98 % e 5 %, registrados e não aplicados.
5. Pré-condições por API: sim na ajuda; tela mantida no cancelamento; disponibilidade e entregas/expedição conforme a P2.
6. Fundir entregas e expedição num arquivo, com cenários separados e um PA de 20 un (alternativa: um `produzirPa` por
   cenário).
7. Não criar `expedicao.mjs` nesta wave; `orcamento.mjs` fica com a WAVE 3 (local só se não vier).
8. Nenhuma mudança de produto.

## Decisões já tomadas

Decisões confirmadas pelo PO — distintas das recomendações do discovery acima.

### No handoff deste discovery

- Não depender de mudanças da WAVE 3 ainda não mergeadas.
- Recebimento já foi resolvido na WAVE 1–2.
- `produzirPa` deve usar APIs oficiais, devolver ids/códigos/lotes, não afirmar regras de UI, não esconder falhas, não
  usar SQL/Prisma e não depender da carga Veridi.
- Qualidade: não aumentar escopo sem necessidade; separar a pré-condição da WAVE 4 da futura suíte E2E de Qualidade.
- Custo estimado: nenhum THE KING nem produto real da carga.
- Formulação física: usar os mesmos números do cenário histórico, em massa própria.
- Disponibilidade: Produto A com PA existente mas RETIDO; Produto B sem saldo; Pedido A + B.
- Entregas + expedição: fundir os dois arquivos se tecnicamente bom, mantendo cenários separados; datas sempre relativas
  ao dia comercial de São Paulo.
- Desconto → faturamento: não reestudar o fluxo do Orçamento; focar depois do Orçamento aceito.
- Ajuda contextual: manter 4 telas nesta rodada; massa própria por API; não usar primeira linha; abrir documento por
  URL/id conhecido.
- OP fora da 1ª página: não fixar `PROD-000214`; a fixture cria cliente, produto, formulação e roteiro; a UI prova
  buscar/encontrar/criar OP, reabrir, planejar e cancelar.
- Fixtures: não criar fixture gigante.

### Em `docs/E2E_STRATEGY.md` — decisões do PO para o redesign (2026-09-14)

- **A.** Massa por API aprovada nas quatro condições da regra 2 (não é o comportamento sob teste; economiza muito tempo;
  o contrato da rota já tem teste de API; não pula a pré-condição do cenário); GET de conferência livre; Prisma/SQL
  proibido.
- **B.** `formulacao-quantidade-fisica-e-custo` ganha massa própria numa wave futura.
- **C.** `ajuda-contextual-nivel-1` fica em quatro telas por enquanto; Faturamento sai do E2E.
- **D.** Fundir `envio-exige-condicoes-salvas` com `envio-exige-linhas-salvas`, e `entregas-programadas-do-pedido` com
  `expedicao-geral-entre-entregas` — cenários separados dentro da suíte combinada.
- **E.** Condição suja: a guarda de saída é a regra atual correta.
- **F.** Base: clone por PostgreSQL TEMPLATE, só local.
- **G.** O runner usa ADMIN próprio da execução; COMMERCIAL e PRODUCTION ficam para a adversarial.
- **H.** `guia-capturas.mjs` fica fora do gate.
- **I.** Pronto por wave: clone novo verde + a mesma bateria em clone sujo + console limpo + nenhum "SEM MASSA".

## Decisões PO pendentes

- **P1** — A WAVE 3 é só o fluxo do Orçamento (E2E-QUOTE-PAGE-FLOW-01)? `PROJECT_STATE.md:4572` diz grupo C.
- **P2** — Pedido + Confirmar + Plano por API onde não são o assunto? Recomendação do discovery: API na ajuda e tela no
  cancelamento. Disponibilidade e entregas/expedição ficam para decidir (API poupa ~30–60 s por suíte).
- **P3** — Suíte fundida: qual nome de arquivo? Remover os dois arquivos antigos?
- **P4** — Um PA de 20 un para os dois cenários, ou um `produzirPa` por cenário?
- **P5** — Formulação física: pureza e overage da massa própria (proposta 98 % e 5 %, registrados e não aplicados)? Sem
  cenário novo de ajuste aplicado?
- **P6** — Ajuda: Orçamento pela página da versão ("Como funciona") ou pela ficha do Projeto ("Como funciona o
  Orçamento")? Formulação pelo detalhe do produto ou pela versão? A checagem de 390 passa para o Pedido?
- **P7** — OP fora da 1ª página: usar o roteiro padrão do produto (PUT) em vez de aplicar roteiro na OP no meio da suíte?
- **P8** — Desconto: sem helper da WAVE 3, criar projeto/versão/linha/condições por API e manter só envio → faturamento
  na tela? Ou o desconto digitado no Orçamento faz parte da prova?

## Plano recomendado de implementação

### Subwaves

| Subwave | Conteúdo | Depende de | Estimativa |
|---|---|---|---|
| **4A** | `produzirPa` + funções pequenas + contratos + prova (só API) — é onde está o risco | P1 | M |
| **4B** | suítes sem PA: formulação física + custo estimado (mesma fixture de dose), OP fora da 1ª página (roteiro padrão) e cancelamento | P1; não depende da 4A (pode andar junto) | M |
| **4C** | disponibilidade (`produzirPa` com `liberar: false`) | 4A | S |
| **4D** | entregas + expedição fundidas (`produzirPa` de 20) | 4A | M |
| **4F** | ajuda contextual — sobe antes da 4E porque não depende de merge | P1 | S |
| **4E** | desconto → faturamento, depois da WAVE 3 na `main` (com rebase) | WAVE 3 + 4A | M |

- Gate de cada subwave (decisão I): clone novo verde + mesma bateria em clone sujo + console limpo + SEM MASSA 0.
- Estimativa total: ~5–6 rodadas (L). Runner: `produzirPa` ~25 chamadas (< 5 s); cada suíte de tela 30–90 s; bateria
  `wave-04` prevista em 8–12 min por passe, ×2 por gate.

### Assinatura proposta do `produzirPa`

Mesma forma das fixtures atuais: `(api, run, opções)`, com `run` obrigatório para o carimbo.

```js
const pa = await produzirPa(api, run, {
  cliente,            // opcional; ausente → criarCliente
  produto,            // opcional; ausente → produto + formulação + roteiro padrão; presente → quem chama garante os dois
  quantidade: "20",   // PA a produzir
  liberar: true,      // false = lote retido (AWAITING_RELEASE)
  validadeDias: 730,
  concluir: true,     // conclui a OP
});
// → { cliente,
//     produto: { id, codigo, nome, itemAcabadoId, itemAcabadoCodigo, unidade },
//     formulacao: { id, numero },
//     roteiro: { id, codigo, versaoId },
//     compra: { fornecedor, item, oc: { id, codigo }, recebimento: { id, codigo }, lote: { id, codigo } },
//     ordem: { id, codigo, numeroOficial, status },
//     lote: { id, codigo, loteComercial, validade, status, quantidade } }
```

Regras:

- não navega; toda chamada passa por `exigir` (erro com método, rota, status e corpo);
- confere o estado final e lança se a OP não ficar COMPLETED, ou se o lote não ficar AVAILABLE (`liberar = true`) ou
  AWAITING_RELEASE (`liberar = false`);
- sem `[0]` e sem GET de lista de cadastro (guarda de `fixtures.test.ts`); sem Prisma/SQL; sem código da carga.

Reuso:

- `cadastros.mjs` inteiro;
- `producao.mjs`: `criarOrdemDeProducao`, `criarRoteiroAtivo`, `planejarOrdem` (`aplicarRoteiro` como plano B);
- roteiro atual (1 etapa, sem recurso) + o PUT do roteiro padrão;
- da suíte de recebimento, só `criarFornecedor` e `criarItem` — ela opera OC e recebimento pela TELA (é o assunto dela);
  o recebimento por API é novo.

### Fixtures novas (só as necessárias)

**`fixtures/cadastros.mjs` (evolução)**

- `criarProdutoOperacional`: nova saída `itemAcabadoCodigo` (`finishedProductItem.code`; lança se ausente).
  Consumidoras: disponibilidade, OP, entregas + expedição, desconto, ajuda.
- `criarFormulacaoAtiva`: novas entradas `modoDeCalculo` e `dosesPorEmbalagem`; no componente, `base`, `pureza`,
  `overage` e `modoDeQuantidade`. Endpoint: `PATCH /formulation-versions/:id`. Contrato: testes de formulations e
  `formulation-precisao.test.ts`. Consumidoras: formulação física, custo estimado.

**`fixtures/producao.mjs` (evolução, funções pequenas)**

- `definirRoteiroPadrao(api, produto, roteiro)` → `{ produtoId, versaoId }` · `PUT /products/:id/production-profile` ·
  contrato nos testes de production-profiles · consumidoras: `produzirPa`, OP fora da 1ª página.
- `liberarOrdem(api, ordemId)` → `{ id, codigo, status, numeroOficial, linhas: [{ id, lotCode, quantidade }] }` ·
  `POST …/release` · `production-orders-release.test.ts`.
- `separarEConsumir(api, ordem)` → `{ status }` · `POST …/picking/:lineId/confirm` + `POST …/consumptions` ·
  `picking.test.ts`, `consumption.test.ts`.
- `apontarProducao(api, run, ordemId, { quantidade, validadeDias })` → `{ lote: { id, codigo, loteComercial } }` ·
  `POST …/outputs` · `production-output.test.ts`.
- `concluirOrdem(api, ordemId)` → `{ status }` · `POST …/complete` · `material-reconciliation.test.ts`.
- As quatro últimas servem ao `produzirPa`.

**`fixtures/estoque.mjs` (novo)**

- `receberPorCompra(api, run, { fornecedor, item, quantidade, validadeDias })` → `{ oc, recebimento, lote }` ·
  `POST /purchase-orders` + `/confirm` + `/receipts` · `purchase-orders.test.ts`, `receiving.test.ts` · consumidora:
  `produzirPa`.
- `liberarLote(api, lote)` → `{ id, codigo, status }` · `POST /lots/:id/release` · `lots.test.ts`,
  `expired-release.test.ts` · consumidora: `produzirPa`.

**`fixtures/produto-acabado.mjs` (novo, só orquestra)**

- `produzirPa(api, run, opções)` → assinatura acima; compõe as funções acima. Consumidoras: disponibilidade, entregas +
  expedição, desconto, prova.

**`fixtures/pedido.mjs` (novo, mínimo)**

- `criarPedido(api, run, { cliente, linhas: [{ produto, quantidade }] })` →
  `{ id, codigo, status, linhas: [{ id, produtoId }] }` · `POST /customer-orders` · `customer-orders.test.ts` ·
  consumidora: ajuda (e as da P2, se aprovadas).
- `confirmarPedido` e `aplicarPlano(api, pedido, [{ linhaId, reservar, produzir }])` · `POST …/confirm` e
  `POST …/apply-fulfillment-plan` · `fulfillment-plan.test.ts` · só se a P2 for "API".

**Orçamento e expedição**

- `orcamento.mjs`: esperar a WAVE 3. Se não vier, `criarOrcamentoRascunho(api, run, { cliente, produto })` →
  `{ projeto, versao }` · `POST /projects`, `…/products {link}`, `…/quote-versions` · consumidora: ajuda.
- `expedicao.mjs`: NÃO nesta wave (a expedição é o assunto de entregas/expedição e um passo de tela no desconto).

**Contratos e prova**

- `fixtures.test.ts`: contrato de cada função com `apiFalsa` + guarda estendida a `estoque.mjs`, `produto-acabado.mjs` e
  `pedido.mjs`.
- `pa-produzido-por-api.mjs` (bateria `provas-wave-04`): `liberar` true e false, `/inventory` do PA, lote apontando para a
  OP, e o negativo "sem liberar a MP, a OP não libera (400)".

## Arquivos / áreas provavelmente afetados

- **Novos:** `scripts/e2e/fixtures/estoque.mjs` · `scripts/e2e/fixtures/produto-acabado.mjs` ·
  `scripts/e2e/fixtures/pedido.mjs` · `scripts/e2e/pa-produzido-por-api.mjs` ·
  `scripts/e2e/entregas-e-expedicao-do-pedido.mjs` (nome a decidir).
- **Alterar:** `scripts/e2e/fixtures/cadastros.mjs` · `scripts/e2e/fixtures/producao.mjs` ·
  `scripts/e2e/fixtures/fixtures.test.ts` · `scripts/e2e-run.mjs` (baterias `wave-04` e `provas-wave-04`) ·
  `scripts/e2e-run.test.ts` · `cancelamento-de-pedido-com-op-cancelada.mjs` · `custo-estimado-acompanha-o-salvamento.mjs` ·
  `formulacao-quantidade-fisica-e-custo.mjs` · `disponibilidade-comercial-explicada.mjs` ·
  `desconto-do-pedido-chega-ao-faturamento.mjs` · `ajuda-contextual-nivel-1.mjs` ·
  `ordem-de-producao-produto-fora-da-primeira-pagina.mjs`.
- **Remover (depois da fusão):** `entregas-programadas-do-pedido.mjs` · `expedicao-geral-entre-entregas.mjs`.
- **Docs:** `scripts/e2e/README.md` · `docs/E2E_STRATEGY.md` · `docs/PROJECT_STATE.md` · `docs/BACKLOG.md`
  (E2E-CORPUS-MASS-01).
- **Sem mudança de produto:** `apps/api`, `apps/web`, `packages/shared` e migrations ficam intactos.

## Fora do escopo

- Mudança de produto (`apps/api`, `apps/web`, `packages/shared`, migrations).
- O fluxo do Orçamento até o aceite — pertence à WAVE 3.
- Cenários da futura E2E 02 (Suprimentos e Qualidade): CoA PENDING → anexo → approve/reject
  (`/lots/:id/coa/approve|reject`), bloquear e desbloquear (volta a AWAITING_RELEASE), bloqueio recusado com reserva,
  liberação de vencido recusada, FEFO com dois lotes, recebimento parcial.
- `expedicao.mjs` nesta wave.
- Golden path (`private-label-golden-path`), fora das suítes alvo; `lib/run-id.mjs` e `lib/roteiro.mjs` seguem como
  compatibilidade.
- Faturamento na ajuda contextual (decisão C).
- Perfis COMMERCIAL e PRODUCTION (decisão G — suíte adversarial).
- `recebimento-validacao-viva`: resolvido na WAVE 1–2; a data fixa dela (2029-12-31) ficou fora do escopo.
- PRODUCTION-PERMISSION-HARDENING (discovery paralela).

## Critérios de pronto

- Por subwave (decisão I): clone novo verde + mesma bateria em clone sujo + console limpo + nenhum "SEM MASSA".
- Nas suítes reescritas, conforme os ajustes apontados no discovery:
  - nenhum código fixo da carga, nenhuma primeira linha, nenhum rascunho de outra execução, nenhuma descoberta de massa
    por GET;
  - datas por `diaComercial`;
  - 4xx provocado declarado com `esperarErroHttp`;
  - código do PA lido de `itemAcabadoCodigo`;
  - sem o `obterRun` de compatibilidade, apontado como obsoleto.
- Fixtures novas com contrato em `fixtures.test.ts` e dentro da guarda.
- Baterias `wave-04` e `provas-wave-04` em `scripts/e2e-run.mjs`, com `scripts/e2e-run.test.ts` atualizado.
- Docs atualizados: `scripts/e2e/README.md`, mapa do `docs/E2E_STRATEGY.md`, `docs/PROJECT_STATE.md` e `docs/BACKLOG.md`
  (E2E-CORPUS-MASS-01).
- 4E só depois da WAVE 3 na `main`.

## Próxima capability recomendada

**E2E-BASELINE-REDESIGN-WAVE-04** (implementação), começando pela subwave **4A** (`produzirPa`) depois de responder a
P1. A 4E (desconto → faturamento) entra por último, com a WAVE 3 na `main`.

## Relatório original consolidado

Texto integral do relatório final do discovery (2026-09-15), preservado sem edição para conferência.

```text
E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01 — RELATÓRIO
Somente leitura. Sem runner, API, browser, teste, build, fresh, banco ou PROD. Nenhum arquivo do repo alterado.
TODO 1–13: DONE.

1. BASE
- origin/main = 9c60845 (merge E2E-BASELINE-REDESIGN-WAVE-01-02). main local = origin/main, checkout limpo.
- WAVE 3: worktree wt-e2e-wave-03, branch feat/e2e-baseline-redesign-wave-03 em 9c60845, sem commit e sem alteração
  (conferido no início e no fim). Nada da WAVE 3 foi usado.
- Leitura num worktree detached (9c60845) no scratchpad, removido no fim.
- Base E2E (só contagens do baseline.json): Product 173, Customer 76, Item 816, UnitOfMeasure 6, 74 migrations.
- DIVERGÊNCIA: PROJECT_STATE.md:4572 diz "Próxima: WAVE 3 — grupo C com massa própria e, depois, o fluxo do
  Orçamento". Este handoff põe o grupo C na WAVE 4 e o Orçamento na WAVE 3.

2. SUÍTES AUDITADAS (9)
cancelamento-de-pedido-com-op-cancelada · custo-estimado-acompanha-o-salvamento · formulacao-quantidade-fisica-e-custo ·
disponibilidade-comercial-explicada · entregas-programadas-do-pedido · expedicao-geral-entre-entregas ·
desconto-do-pedido-chega-ao-faturamento · ajuda-contextual-nivel-1 · ordem-de-producao-produto-fora-da-primeira-pagina

3. CLASSIFICAÇÃO
Atual (E2E_STRATEGY, 2026-09-15): C = as 8 primeiras; D = ordem-de-producao-… (PROD-000214).
Proposta:
- C1, só cadastro por API: formulacao-quantidade, custo-estimado, ordem-de-producao, cancelamento, ajuda
- C2, PA por produção: disponibilidade (PA retido), entregas + expedição (PA liberado)
- C3, PA + fluxo novo do Orçamento: desconto (depende da WAVE 3)

Auditoria por suíte (campos: fluxo · fixo · SEM MASSA · datas · 1ª linha · API · obsoleto · WAVE 3 · existe · falta)

[cancelamento-de-pedido-com-op-cancelada]
fluxo: Pedido pela tela → Confirmar → Plano "Produzir de" 10 → link da OP → cancelar Pedido (400) → cancelar OP →
  cancelar Pedido → OP no histórico
fixo: CLI-000013 e PROD-000031 (na base são de clientes diferentes) · SEM MASSA: não · datas: não
1ª linha: a[href^="/producao/ordens/"].first() (única OP, aceitável) · API: não
obsoleto: obterRun (compat). A suíte filtra "Failed to load resource" à mão, mas lib/browser.mjs põe
  "http 400 POST /customer-orders/:id/cancel" em erros: sem esperarErroHttp ela reprova. O monitor próprio duplica o coletor.
WAVE 3: não · existe: criarRun, criarCliente, criarItem, criarProdutoOperacional, criarFormulacaoAtiva · falta: nada obrigatório

[custo-estimado-acompanha-o-salvamento]
fluxo: /producao/formulacoes busca "THE KING" → Abrir.first() → reaproveita rascunho da execução anterior ou cria
  "Nova versão a partir desta" → dobra MP-000365 → salva → custo dobra → volta → base igual
fixo: "CAFEÍNA PT 60 CAPS THE KING", MP-000365 · SEM MASSA: não · datas: não
1ª linha: Abrir.first(); rascunho herdado de outra execução (fere as regras 1 e 5) · API: não
obsoleto: o status é lido de querySelector(".badge--active, .badge--warn"), ou seja, o 1º badge da página — e o selo
  "Qualidade" do custo usa as mesmas classes. Usa process.exit.
WAVE 3: não · existe: criarItem(custoDeReferencia), criarProdutoOperacional, criarFormulacaoAtiva (só base e componentes simples)
falta: formulação por dose (calculationMode, dosesPerPackage, basis, pureza, overage)

[formulacao-quantidade-fisica-e-custo]
fluxo: mesma busca → "Ver versão ativa" → componentes × custo estimado × total × qualidade → "Voltar" → rascunho seguinte
fixo: THE KING; MP-000365/368/369/120; referências R$ 700,00 / 44,32 / 126,00 / 35,00 · SEM MASSA: não · datas: não
1ª linha: Abrir.first(); rascunho reaproveitado · API: não
obsoleto: massa real "de propósito" (a decisão B do PO troca por massa própria); mesmo seletor de badge
WAVE 3: não · existe/falta: igual à anterior; uma fixture de dose serve às duas

[disponibilidade-comercial-explicada]
fluxo: /estoque?search=PA-000031 lê .cell-sub → Pedido com 2 produtos pela tela → Confirmar → Plano produzir 10+10 →
  "Reservar Produto Acabado": botão desabilitado + title → callout → "Ver disponibilidade" → rede → finally cancela OPs e Pedido
fixo: CLI-000013, PROD-000031 (retido), PROD-000010 (sem saldo). O código do PA é DERIVADO por PROD- → PA-, o que só
  coincidia na carga real; no clone o PA segue a sequência de itens.
SEM MASSA: não (reprova com "massa retida sumiu") · datas: não · 1ª linha: tbody tr hasText .first() (ok) · API: não
obsoleto: obterRun; monitor 4xx próprio; a base não tem lote nem PA
WAVE 3: não · falta: produzirPa({ liberar:false }) + 2º produto do mesmo cliente

[entregas-programadas-do-pedido]
fluxo: acha PA com ≥ 10 por GET /inventory + /products → Pedido pela tela → Confirmar → Plano "Reservar de" 10 →
  entregas 4 + 6 → excesso de 7 recusado na tela → "Preparar expedição" da entrega 1 → separa 2 → confere lote (Enter) →
  confirma → Entrega 1 parcial, Entrega 2 intacta → Reprogramar → Entrega 3 com 2
fixo: nenhum código, mas descobre massa real · SEM MASSA: SIM
datas: 2026-10-15, 2026-11-15, 2026-12-15 — depois de 15/10/2026 a entrega aparece como "Atrasada" e a suíte quebra sozinha
1ª linha: "primeiro produto com saldo" · API: GET de descoberta de massa (fere a regra 1)
obsoleto: obterRun; process.exit; monitor próprio · WAVE 3: não · falta: produzirPa({ liberar:true })

[expedicao-geral-entre-entregas]
fluxo: igual até as 2 entregas → "Preparar Expedição" geral → separa 5 → dica "Entrega 1 · 4 · Entrega 2 · 1" →
  confere → confirma → Entrega 1 atendida, Entrega 2 parcial
fixo: nenhum · SEM MASSA: SIM · datas: 2026-10-15, 2026-11-15 · API: GET de descoberta · WAVE 3: não · falta: produzirPa

[desconto-do-pedido-chega-ao-faturamento]
fluxo: acha PA → Projeto pela tela → vincular produto → "Criar nova versão" na ficha → #quote-add-product → linha e preço →
  desconto + validade → enviar → aceite → "Aprovar projeto" → "Gerar pedido…" → confirmar → Plano → expedição →
  faturamento → prévia → emitir → números → PDF
fixo: nenhum código · SEM MASSA: SIM · datas: VALIDADE_FUTURA 2099-12-31
1ª linha: #quote-add-product index 1; "Lote conferido".first() · API: GET de descoberta · waitForTimeout fixos
obsoleto: fluxo antigo do Orçamento embutido no Projeto (E2E-QUOTE-PAGE-FLOW-01)
WAVE 3: SIM (dependência dura) · falta: produzirPa + gestos do Orçamento novo

[ajuda-contextual-nivel-1]
fluxo: 5 listas → clica a 1ª linha → gatilho → mede o modal → link do painel do Pedido → largura 390 no Faturamento
fixo: nenhum · SEM MASSA: não, mas sem documento a "1ª linha" é a linha de lista vazia · datas: não · 1ª linha: SIM (5×)
obsoleto: o Orçamento abre pela lista de Projetos ("Como funciona o Orçamento" da ficha), mas hoje o documento é
  /comercial/orcamentos/:id com "Como funciona". O Faturamento sai (decisão C), e a checagem de 390 usa TELAS[4] = Faturamento.
WAVE 3: suave (precisa de uma versão de orçamento) · falta: Pedido e Orçamento em rascunho por API

[ordem-de-producao-produto-fora-da-primeira-pagina]
fluxo: 1ª página de /cadastros/produtos (premissa) → OP pela tela com PROD-000214 → reabre a frio → campo
  "CÓDIGO · NOME" → aplicarRoteiroNaOrdem (API) → Planejar → produto congelado → cadastro do produto → cancelar OP
fixo: PROD-000214 + nome "CREATINA SENIOR…" — não existe (a base tem 173) · SEM MASSA: não · datas: não
1ª linha: lê a 1ª página de propósito (é a premissa) · API: POST de roteiro (pré-condição válida) · UI: resto
obsoleto: PAGINA_DA_TELA = 50, mas a lista web pagina 20 (quem carrega 50 opções é a OP); obterRun; lib/roteiro.mjs (compat)
WAVE 3: não · existe: cadastros + criarRoteiroAtivo/aplicarRoteiro · falta: definirRoteiroPadrao (opcional, simplifica)

4. CÓDIGOS FIXOS
- CLI-000013: cancelamento, disponibilidade
- PROD-000031: cancelamento, disponibilidade
- PROD-000010: disponibilidade
- PA- derivado de PROD-: disponibilidade
- THE KING + MP-000365: custo estimado
- THE KING + MP-000365/368/369/120: formulação
- PROD-000214 + nome: OP fora da 1ª página
- Entregas, expedição e desconto não fixam código, mas descobrem massa real por GET.

5. SEM MASSA
entregas-programadas, expedicao-geral e desconto. As três saem com exit 0 e o runner reprova pelo texto. O problema some com produzirPa.

6. DATAS FIXAS
- entregas: 2026-10-15 / 2026-11-15 / 2026-12-15
- expedição: 2026-10-15 / 2026-11-15
- desconto: 2099-12-31
Trocar por diaComercial(+30 / +61 / +91) de fixtures/datas.mjs. Fora do escopo: recebimento-validacao-viva usa 2029-12-31.

7. produzirPa — CADEIA EXATA (só API oficial; o runner roda como ADMIN)
 0 cliente (opcional)
   POST /customers {legalName carimbado}
 1 fornecedor
   POST /suppliers {legalName}
 2 MP
   POST /items {type:"RAW_MATERIAL", unitCode:"kg", name}
   Padrão do tipo: controlsLot, controlsExpiry e requiresQualityRelease = true; requiresCoa = false.
 3 produto
   POST /products {name, customerId, finishedUnitCode:"un"} → APPROVED + finishedProductItem
   Item FINISHED_PRODUCT: lote, validade e liberação = true. O golden path confirma o PA aguardando liberação.
 4 formulação
   GET /products/:id/formulations → POST /products/:id/formulation-versions (só se não houver DRAFT)
   → PATCH /formulation-versions/:v {basisQuantity:"1", components:[{itemId, quantity:"0.01", unitCode:"kg"}]}
   → POST /formulation-versions/:v/activate → ACTIVE
 5 roteiro
   POST /production-profiles {name, referenceQuantity:"1", referenceUomCode:"un"}
   → PATCH /production-profile-versions/:v {steps: 1 etapa, resources: []} → POST …/activate → GET /production-profiles/:id
   → PUT /products/:id/production-profile {productionProfileVersionId}
   Exige ADMIN/PRODUCTION, versão ATIVA e unidade compatível.
   Efeito: toda OP nova do produto (manual, do Plano ou de saldo) já nasce com o roteiro
   (aplicarRoteiroPadraoAutomatico, origem AUTO_PRODUCT_DEFAULT).
 6 OC
   POST /purchase-orders {supplierId, orderDate: diaComercial(0), lines:[{itemId, orderedQuantity}]} → DRAFT
   Exige fornecedor ativo e item RAW_MATERIAL/PACKAGING ativo. Não exige homologação.
   POST /purchase-orders/:id/confirm → ORDERED
 7 recebimento
   POST /purchase-orders/:id/receipts {receivedAt: agora em ISO, lines:[{purchaseOrderLineId, receivedQuantity,
     supplierLot:"LF-<runId>", expiryDate: diaComercial(+365)}]}
   Exige OC ORDERED ou PARTIALLY_RECEIVED, supplierLot, validade ≥ receivedAt e quantidade ≤ saldo aberto.
   Resultado: lote LT-<dia SP>-… em AWAITING_RELEASE, movimento RECEIPT_IN, OC RECEIVED. O DTO da linha traz lotId e lotCode.
 8 liberação da MP
   POST /lots/:loteMp/release (QUALITY/ADMIN)
   Só aceita AWAITING_RELEASE, com CoA aprovado quando exigido e lote não vencido. Resultado: AVAILABLE.
 9 OP
   POST /production-orders {productId, plannedQuantity, notes:"Massa E2E <carimbo>"} (ADMIN/PRODUCTION)
   Resultado: DRAFT com a formulação ACTIVE e o roteiro padrão.
10 planejar
   POST /production-orders/:id/plan
   Exige DRAFT, roteiro (senão 400 route_required), produto ativo com PA, formulação ACTIVE, quantidade > 0 e ≥ 1 componente.
   Resultado: PLANNED; congela produto, formulação e cliente.
11 liberar
   POST /production-orders/:id/release
   Exige PLANNED + roteiro. Aloca FEFO/FIFO só em lote AVAILABLE do dono VERIDI, tudo ou nada
   (falta de estoque → 400 "estoque disponível insuficiente").
   Resultado: RELEASED, reserva de material ACTIVE com linhas por lote, partes e número oficial NNN/AA.
12 picking
   Para cada linha ativa de reservation.reservationLines: POST /production-orders/:id/picking/:lineId/confirm {lotCode}
   Exige OP RELEASED ou IN_PRODUCTION, lote ainda elegível e código igual ao reservado. Resultado: pickedAt.
13 consumo
   POST /production-orders/:id/consumptions {entries:[{reservationLineId, quantity: remainingQuantity}]}
   Exige picking confirmado e quantidade ≤ restante e ≤ físico.
   Resultado: PRODUCTION_CONSUMPTION; a OP passa de RELEASED para IN_PRODUCTION.
   A partir daqui a OP NÃO cancela mais ("já houve consumo real").
14 apontamento
   POST /production-orders/:id/outputs {quantity, destination:"NEW_LOT", businessLotNumber:"LV-<runId>",
     expiryDate: diaComercial(+730)}
   Exige IN_PRODUCTION, PA com controle de lote, quantidade ≤ planejado restante e validade (ou vida útil) ≥ data de produção.
   Resultado: lote de PA em AWAITING_RELEASE + movimento FINISHED_GOOD_PRODUCTION. outputs[] traz lotId, lotCode e businessLotNumber.
15 conclusão
   POST /production-orders/:id/complete {}
   Exige IN_PRODUCTION, ≥ 1 apontamento, sem variação (ou completionReason) e todo material reconciliado.
   Resultado: COMPLETED; a reserva restante é liberada.
16 liberação do PA
   liberar=true: POST /lots/:lotePa/release → AVAILABLE; em /inventory/:paItemId, onHand = available = quantidade.
   liberar=false: o lote fica em AWAITING_RELEASE; físico sim, disponível 0, motivo AWAITING_QUALITY_RELEASE
   ("N un aguardando liberação da Qualidade").
Custo: ~22–26 chamadas (1 picking por lote reservado). Quantidades aceitam até 12 casas (CASAS_QUANTIDADE).

8. produzirPa — ASSINATURA PROPOSTA
Mesma forma das fixtures atuais: (api, run, opções), com run obrigatório para o carimbo.
  const pa = await produzirPa(api, run, {
    cliente,            // opcional; ausente → criarCliente
    produto,            // opcional; ausente → produto + formulação + roteiro padrão; presente → quem chama garante os dois
    quantidade: "20",   // PA a produzir
    liberar: true,      // false = lote retido (AWAITING_RELEASE)
    validadeDias: 730,
    concluir: true,     // conclui a OP
  });
  → { cliente,
      produto:{id, codigo, nome, itemAcabadoId, itemAcabadoCodigo, unidade},
      formulacao:{id, numero},
      roteiro:{id, codigo, versaoId},
      compra:{fornecedor, item, oc:{id, codigo}, recebimento:{id, codigo}, lote:{id, codigo}},
      ordem:{id, codigo, numeroOficial, status},
      lote:{id, codigo, loteComercial, validade, status, quantidade} }
Regras:
- não navega; toda chamada por exigir (erro com método, rota, status e corpo);
- confere o estado final e lança se a OP não ficar COMPLETED, ou se o lote não ficar AVAILABLE (liberar=true) ou
  AWAITING_RELEASE (liberar=false);
- sem [0] e sem GET de lista de cadastro (guarda de fixtures.test.ts); sem Prisma/SQL; sem código da carga.
Reuso:
- cadastros.mjs inteiro;
- producao.mjs: criarOrdemDeProducao, criarRoteiroAtivo, planejarOrdem (aplicarRoteiro como plano B);
- roteiro atual (1 etapa, sem recurso) + o PUT do roteiro padrão;
- da suíte de recebimento, só criarFornecedor e criarItem. Ela opera OC e recebimento pela TELA (é o assunto dela);
  o recebimento por API é novo.

9. ENDPOINTS USADOS NA WAVE 4
Cadastro: POST /customers · POST /suppliers · POST /items · POST /products · GET /products/:id
Formulação: GET /products/:id/formulations · POST /products/:id/formulation-versions · PATCH /formulation-versions/:id ·
  POST /formulation-versions/:id/activate · (pela tela) POST /formulation-versions/:id/new-version
Roteiro: POST /production-profiles · PATCH /production-profile-versions/:id · POST …/activate · GET /production-profiles/:id ·
  PUT /products/:id/production-profile · POST /production-orders/:id/production-profile
Compra e estoque: POST /purchase-orders · POST …/confirm · POST …/receipts · POST /lots/:id/release · GET /lots/:id ·
  GET /inventory/:itemId
Produção: POST /production-orders · POST …/plan · POST …/release · POST …/picking/:reservationLineId/confirm ·
  POST …/consumptions · POST …/outputs · POST …/complete · POST …/cancel {reason} · GET /production-orders/:id
Pedido: POST /customer-orders · POST …/confirm · GET …/fulfillment-plan ·
  POST …/apply-fulfillment-plan {lines:[{customerOrderLineId, reserveQuantity, produceQuantity}]} (reservar + produzir = pedido) ·
  POST …/cancel {reason} · GET …/reservation-status · POST …/reserve-available
Entregas: GET /customer-orders/:id/deliveries · POST /customer-orders/:id/deliveries {scheduledDate, lines} ·
  POST /customer-order-deliveries/:id/reschedule {scheduledDate, reason}
Expedição: POST /customer-orders/:id/shipments {deliveryId?} · PATCH /shipments/:id {lines} ·
  POST /shipments/:id/lines/:lineId/verify {lotCode} · POST /shipments/:id/confirm
Faturamento: POST /billings {shipmentId} · POST /billings/:id/issue · GET /billings/:id
Orçamento (ajuda; no desconto é da WAVE 3): POST /projects {customerId, name} ·
  POST /projects/:id/products {operation:"link", productId} · POST /projects/:id/quote-versions (COMMERCIAL/ADMIN) ·
  POST /quote-versions/:id/lines {projectProductId} · PATCH /quote-lines/:id ·
  PATCH /quote-versions/:id {discountPercent, validUntil} · POST …/send · POST …/accept · POST /projects/:id/approve ·
  POST /quote-versions/:id/create-order (exige ACCEPTED e projeto APPROVED)

10. QUALIDADE MÍNIMA
Necessário na WAVE 4:
- AWAITING_RELEASE: MP depois do recebimento; PA depois do apontamento; PA retido da disponibilidade.
- RELEASED (= AVAILABLE): MP antes de liberar a OP (o FEFO só vê AVAILABLE); PA antes de reservar ou expedir.
- Validade obrigatória nas duas (controlsExpiry) e ≥ recebimento/produção. Lote vencido não libera, não separa e não
  expede: usar sempre diaComercial(+365/+730).
Não necessário: BLOCKED, REJECTED, CoA (requiresCoa = false por padrão), desbloqueio, FEFO entre lotes, lote vencido.
Fica para a futura E2E 02 (Suprimentos e Qualidade): CoA PENDING → anexo → approve/reject (/lots/:id/coa/approve|reject),
bloquear e desbloquear (volta a AWAITING_RELEASE), bloqueio recusado com reserva, liberação de vencido recusada,
FEFO com dois lotes, recebimento parcial.

11. CANCELAMENTO
Massa mínima: cliente + produto operacional + formulação ativa (1 MP sem estoque). Não precisa de estoque nem de roteiro
(OP DRAFT cancela).
Passos, status e mensagens:
1) Pedido DRAFT → "Confirmar pedido" + diálogo "Confirmar" → CONFIRMED ("Confirmado").
2) Plano: "Produzir de <PROD>" 10 → "Aplicar Plano de Atendimento" + "Aplicar Plano" → IN_FULFILLMENT ("Em atendimento")
   e OP DRAFT com origem CUSTOMER_ORDER (link /producao/ordens/:id na tela do Pedido).
3) "Cancelar pedido" (aparece em DRAFT, CONFIRMED e IN_FULFILLMENT) → #co-cancel-reason (≥ 3 caracteres) →
   .confirm-dialog__actions "Cancelar pedido" → POST /customer-orders/:id/cancel → 400 cancellation_blocked, com a mensagem
   "Pedido em atendimento possui reserva de produto acabado e/ou Ordens de Produção ativas — resolva essas dependências
   antes de cancelar." num .form-alert do diálogo.
   Bloqueiam o cancelamento as OPs DRAFT, PLANNED, RELEASED, IN_PRODUCTION, COMPLETED e BLOCKED. Só CANCELLED libera.
4) OP: "Cancelar OP" (aparece com canOperate em DRAFT, PLANNED ou RELEASED) → #op-cancel-reason →
   .confirm-dialog__actions "Cancelar OP" → POST /production-orders/:id/cancel {reason} (ADMIN/PRODUCTION) → "Cancelada".
   OP RELEASED devolve a reserva; OP IN_PRODUCTION recusa.
5) Volta ao Pedido → "Cancelado"; o botão some; a OP segue "Cancelada" no histórico.
Permissões: cancelar Pedido não exige papel; cancelar OP exige ADMIN/PRODUCTION. cancelledBy grava "Ambiente local"
(SYSTEM_ACTOR), tema da discovery paralela PRODUCTION-PERMISSION-HARDENING. Não afeta a suíte: o runner é ADMIN e a
autoria não é afirmada.
Ajuste obrigatório: esperarErroHttp({ status:400, metodo:"POST", caminho:/\/customer-orders\/[^/]+\/cancel$/ }) antes do clique.

12. CUSTO ESTIMADO
Massa própria = a mesma da formulação física (item 13), aberta por URL em /producao/formulacoes/<productId>.
V1 ATIVA por API. V2 pela tela: "Nova versão a partir desta" na linha da V1 do "Histórico de versões"
(ou "Copiar versão deste produto"). Nada de reaproveitar rascunho: cada execução tem produto novo.
Números (componente A = 200 mg/dose, 60 doses, R$ 700,00/kg):
- antes: A 0,012 kg → R$ 8,40; custo da base (1 un) R$ 9,10
- com 400 mg digitado e não salvo: aviso "Custo do último salvamento — há alteração pendente…"; número ainda R$ 8,40
- depois de salvar: A 0,024 kg → R$ 16,80 (dobra); base R$ 17,50 (17,495796); o aviso some
- voltando a 200 e salvando: A R$ 8,40; base R$ 9,10
Precisão: formatBRL com 2 casas; a suíte compara a linha com tolerância de 0,02 e a base pelo texto.
O campo "Quantidade de <MP-A>" é DecimalField pt-BR: 200 e 400 não têm separador de milhar.
Status: ler o badge do cabeçalho da versão, não o 1º .badge--active da página.

13. FORMULAÇÃO FÍSICA / CUSTO
Versão: calculationMode "PER_DOSE", dosesPerPackage 60, basisQuantity "1" (un).
Componentes: item em kg, unitCode "mg", basis "PER_DOSE", quantityMode "PHYSICAL_DIRECT", pureza e overage REGISTRADOS.
  A 200 mg × 60 = 12.000 mg = 0,012 kg   × R$ 700,00 = R$ 8,40
  B   5 mg × 60 =    300 mg = 0,0003 kg  × R$  44,32 = 0,013296 → R$ 0,01
  C  20 mg × 60 =  1.200 mg = 0,0012 kg  × R$ 126,00 = 0,1512   → R$ 0,15
  D 253 mg × 60 = 15.180 mg = 0,01518 kg × R$  35,00 = 0,5313   → R$ 0,53
  Custo estimado da base (1 un) = custo por unidade = 9,095796 → R$ 9,10; Qualidade "Estimado".
  ARMADILHA: as linhas exibidas somam R$ 9,09; o total vem dos valores sem arredondar.
Tabela de componentes (.estoque-valor--equivalente e --fisico, por unidade) = coluna "Quantidade física para a base" do
custo = 0,012 kg etc., com a quantidade declarada (200 mg) como dica embaixo.
Os negativos antigos continuam válidos: "0,0002 kg", "0,000005 kg", "0,00002 kg", "0,000253 kg".
Regra (motor único: packages/shared/src/formulation-quantity.ts):
- fator PER_DOSE = doses × quantidade produzida; declarado × fator;
- converte mg → kg pela unidade-base (mg = 0,001 g) ANTES dos ajustes;
- só ajusta com THEORETICAL_WITH_ADJUSTMENTS + applyPurityAdjustment/applyOverageAdjustment;
- em PHYSICAL_DIRECT, físico = teórico.
A tela diz: "Quantidade física informada. Pureza e overage estão registrados, não aplicados."
Referências: criarItem({ custoDeReferencia }) → initialCostReference (referência manual), que entra na estimativa
(o golden path prova com a Caixa). Sem oferta de fornecedor: duas ofertas sem preferencial deixam o custo em aberto.
Campos da API: purityPercentApplied, overagePercent, quantityMode, basis; na versão, calculationMode e dosesPerPackage.
Os valores de pureza/overage do caso histórico não estão na suíte nem nos docs. Para a massa própria, proposta 98 % e 5 %.

14. DISPONIBILIDADE
Massa:
- cliente C;
- Produto A = produzirPa({ cliente:C, quantidade:"10", liberar:false }) → lote de PA em AWAITING_RELEASE com 10 un;
- Produto B = criarProdutoOperacional(C) + formulação ativa, sem lote nenhum.
Pedido de C: A 10 + B 10 → confirmar → Plano Reservar 0 / Produzir 10 em cada → IN_FULFILLMENT + 2 OPs DRAFT.
Estoque: /estoque?search=<itemAcabadoCodigo de A> (useInitialFilters lê o search) → .cell-sub
"10 un aguardando liberação da Qualidade".
Pedido, seção "Reservar Produto Acabado":
- "Disponível agora" 0 + .cell-sub com a MESMA frase (as duas telas usam INVENTORY_UNAVAILABLE_REASON_LABELS);
- "Reservar disponível" desabilitado, com title "Nenhuma linha tem produto disponível para reservar agora — o motivo está acima.";
- .callout "2 produtos sem disponibilidade suficiente para reservar.", com:
  A: "faltam 10 un de 10 un — 10 un aguardando liberação da Qualidade."
  B: "… — nada retido em estoque: a quantidade que falta ainda não foi produzida nem recebida."
  e um link "Ver disponibilidade" em cada;
- "Ver disponibilidade" → /estoque/<itemId> → h1 com código e nome do PA;
- reserva: GET /customer-orders/:id/reservation-status, 1 por carga (o StrictMode dobra; o limite ≤ 4 da suíte continua valendo);
  sugestão de produção vem do fulfillment-plan (suggestedProductionQuantity).
Obrigatório: ler o código do PA de itemAcabadoCodigo, nunca derivar de PROD-.
Cleanup, nesta ordem, no finally: cancelar as 2 OPs DRAFT, depois o Pedido. O lote retido e a OP concluída do produzirPa
ficam (massa carimbada; clone descartável; a rodada suja cria outra).

15. ENTREGAS (cenário A da suíte fundida)
Massa: cliente + produzirPa({ quantidade:"20", liberar:true }) → 1 lote de PA AVAILABLE com 20 un, que serve A e B.
Passos:
1) Pedido A com 10 → confirmar → Plano "Reservar de <PROD>" 10 → IN_FULFILLMENT (reserva ativa de 10).
2) "Adicionar entrega programada" → "Data programada" diaComercial(+30), "Programar <PROD>" 4 → "Salvar entrega" → Entrega 1.
3) Excesso: diaComercial(+61) com 7 → "Quantidade acima do saldo — …" e "Salvar entrega" desabilitado. Corrige para 6 → Entrega 2.
4) A tela diz "Todo o pedido já está programado ou expedido — não há saldo para programar." e não mostra nenhum EXP-.
5) "Preparar expedição" da Entrega 1 → POST …/shipments {deliveryId} → rascunho limitado a 4 (soma dos "Quantidade do lote").
6) Lote com 2 → "Salvar separação" → "Lote conferido da linha <LT>" + Enter → "Conferido" → "Confirmar expedição" +
   "Confirmar" → "Confirmada".
7) Pedido: Entrega 1 "Parcialmente atendida", Entrega 2 "Programada".
8) "Reprogramar" na Entrega 1 → "Nova data programada" diaComercial(+91), "Motivo" → "Reprogramar". Resultado:
   Entrega 1 "Cancelada" mostrando 2 atendidas + "· reprogramada para a 3"; Entrega 3 com 2 + "· substitui a 1";
   Entrega 2 intacta.
Regras: programar só em CONFIRMED ou IN_FULFILLMENT; reprogramar recusa entrega com expedição em rascunho e entrega já
atendida; data em AAAA-MM-DD; data anterior a hoje (SP) aparece como "Atrasada".

16. EXPEDIÇÃO (cenário B)
Pedido B com 10 (mesma massa) → Plano Reservar 10 → Entrega 1 (+30) com 4 e Entrega 2 (+61) com 6.
"Preparar Expedição" (seção de reserva; POST …/shipments sem deliveryId) → lote com 5 → "Salvar separação" →
dica na linha do lote "Entrega 1 · 4 · Entrega 2 · 1" (repartirNasPromessas); o campo continua 5 → conferir → confirmar →
Entrega 1 "Atendida", Entrega 2 "Parcialmente atendida" com 1. O Pedido fica PARTIALLY_SHIPPED.
Fusão (decisão D): tecnicamente boa. Mesma massa, mesmos gestos (clicar, escolher, esperarSecao e linhaDaEntrega hoje estão
copiados nos dois arquivos), e pedidos separados isolam os cenários (1 rascunho de expedição por Pedido).
Quantidade de PA: 20. Alternativa: um produzirPa por cenário (+ ~3 s) para independência total.

17. DESCONTO → FATURAMENTO
Massa: cliente + produzirPa({ cliente, quantidade:"2", liberar:true }).
Até o aceite = WAVE 3 (Orçamento novo): projeto, vincular produto, versão em /comercial/orcamentos/:id, linha
2 × R$ 100,00, desconto 10 %, validade diaComercial(+30) (não 2099), salvar, enviar ("Enviar mesmo assim" sem precificação),
aceite, "Aprovar projeto" na ficha, "Gerar pedido a partir do orçamento aceito" (seção Fechamento da página da versão).
Depois do aceite (WAVE 4):
1) Pedido em RASCUNHO congela subtotal R$ 200,00 e total R$ 180,00 → "Confirmar pedido" + "Confirmar".
2) Plano (reserva sugerida de 2) → "Aplicar Plano" → "Em atendimento" → "Preparar Expedição" → conferir lote →
   "Confirmar expedição".
3) "Preparar faturamento" (tela da Expedição) → POST /billings {shipmentId} → rascunho com
   "Subtotal bruto (prévia): R$ 200,00 · Desconto comercial: − R$ 20,00" e "Total faturado (prévia): R$ 180,00".
4) "Emitir faturamento" + "Emitir" → ISSUED ("Emitido"), com "Subtotal bruto: R$ 200,00", "Desconto comercial: − R$ 20,00",
   sem "Ajuste de fechamento", "Total faturado: R$ 180,00" e preço da linha 100,00 (agreedUnitPrice, sem desconto embutido).
5) PDF em /comercial/faturamento/:id/imprimir, lido por lib/pdf.mjs (textoDoPdfDaTela).
Conta: 2 × 100 = 200; 10 % = 20; ajuste 0; total 180 = acordado. O desconto é congelado na criação do faturamento
(discountPercentSnapshot).
Helpers da WAVE 3 a reutilizar (nada mergeado; nomes a confirmar): criar projeto e vincular produto; abrir versão por URL;
linha com preço manual; condições (desconto, validade); enviar e aceitar; aprovar projeto; gerar pedido devolvendo o id.

18. AJUDA CONTEXTUAL — 4 DOCUMENTOS (decisão C)
- Orçamento: /comercial/orcamentos/<quoteVersionId> · gatilho "Como funciona" ·
  título "Orçamento: a proposta de preço e o que o aceite autoriza"
  massa: cliente, produto, POST /projects, POST /projects/:id/products {operation:"link"}, POST /projects/:id/quote-versions (rascunho)
- Formulação: /producao/formulacoes/<productId> · "Como funciona" ·
  título "Formulação: a receita em versões, e o que cada número significa"
  massa: criarProdutoOperacional + criarFormulacaoAtiva (a página da versão usa o mesmo tópico)
- Pedido: /comercial/pedidos/<orderId> · "Como funciona" com exact ("Como funciona o Plano" e "… a reserva" são outros) ·
  "Pedido do Cliente: da confirmação à expedição" · massa: POST /customer-orders (rascunho)
- OP: /producao/ordens/<opId> · "Como funciona" · "Ordem de Produção: do planejamento ao lote acabado" · massa: criarOrdemDeProducao
Os 4 são tópicos V2: "Quando usar", "Próximo passo", "Passo a passo"; seções recolhidas Termos, Situações, Atenção e
Exemplo (≥ 3); links internos.
Teste do link: painel do Pedido (/producao/ordens, /comercial/expedicoes, /cadastros/produtos).
Largura 390: trocar o Faturamento pelo Pedido.
Sem 1ª linha; a massa só é lida depois de criada; sem cleanup (rascunhos carimbados).

19. OP FORA DA PRIMEIRA PÁGINA
Premissa natural confirmada: a base tem 173 produtos (PROD-000001…173) e o clone segue a partir de 174.
/cadastros/produtos pagina 20 por código (asc) e a OP carrega 50 opções: o produto novo cai fora das duas, e num clone
sujo fica ainda mais longe. PROD-000214 sai da suíte.
Conferir a premissa também por GET livre: /products?page=1&pageSize=50 não contém o id (a tela só mostra 20).
Fixture: cliente, MP em kg, produto em "un", formulação ativa, roteiro ativo + PUT do roteiro padrão. Assim a OP criada
pela tela já nasce com roteiro, sem chamada de API no meio da suíte. Plano B: aplicarRoteiro depois de criar, como hoje.
A tela prova:
1) /producao/ordens/nova → #op-product digitando o código → opção → #op-quantity 2 → #op-notes com carimbo → "Salvar rascunho" → h1 OP-…
2) carga a frio → #op-product mostra "<PROD> · <nome>" (resolvido pelo DTO da OP, não pela página de 50) → sem
   "Produto sem item de produto acabado válido." e sem "Produto sem formulação ativa." → "Unidade" = "un"
3) "Planejar OP" → "Planejada" → produto congelado como "<PROD> — <nome>"
4) /cadastros/produtos, #products-search → modal sem "não tem item de produto acabado vinculado"
5) "Cancelar OP" + #op-cancel-reason → "Cancelada"

20. FIXTURES EXISTENTES REUTILIZÁVEIS
- fixtures/run.mjs: criarRun, carimbar
- fixtures/api.mjs: exigir, clienteApi, autenticar
- fixtures/datas.mjs: diaComercial, porExtenso
- fixtures/ui.mjs: esperarRota, escolherOpcao
- fixtures/cadastros.mjs: criarCliente, criarFornecedor, criarItem (lote, validade, liberação, custoDeReferencia),
  criarProdutoOperacional, criarFormulacaoAtiva
- fixtures/producao.mjs: criarOrdemDeProducao, criarRoteiroAtivo, aplicarRoteiro, planejarOrdem
- lib/browser.mjs: abrirNavegador, esperarErroHttp · lib/pdf.mjs: textoDoPdfDaTela
- Compat do golden path: lib/run-id.mjs e lib/roteiro.mjs — manter.

21. FIXTURES NOVAS (só as necessárias)
cadastros.mjs (evolução)
- criarProdutoOperacional: nova saída itemAcabadoCodigo (finishedProductItem.code; lança se ausente).
  Consumidoras: disponibilidade, OP, entregas+expedição, desconto, ajuda.
- criarFormulacaoAtiva: novas entradas modoDeCalculo e dosesPorEmbalagem; no componente, base, pureza, overage e
  modoDeQuantidade. Endpoint: PATCH /formulation-versions/:id. Contrato: testes de formulations e formulation-precisao.test.ts.
  Consumidoras: formulação física, custo estimado.
producao.mjs (evolução, funções pequenas)
- definirRoteiroPadrao(api, produto, roteiro) → {produtoId, versaoId} · PUT /products/:id/production-profile ·
  contrato nos testes de production-profiles · consumidoras: produzirPa, OP fora da 1ª página
- liberarOrdem(api, ordemId) → {id, codigo, status, numeroOficial, linhas:[{id, lotCode, quantidade}]} · POST …/release ·
  production-orders-release.test.ts
- separarEConsumir(api, ordem) → {status} · POST …/picking/:lineId/confirm + POST …/consumptions ·
  picking.test.ts, consumption.test.ts
- apontarProducao(api, run, ordemId, {quantidade, validadeDias}) → {lote:{id, codigo, loteComercial}} · POST …/outputs ·
  production-output.test.ts
- concluirOrdem(api, ordemId) → {status} · POST …/complete · material-reconciliation.test.ts
  As quatro últimas servem ao produzirPa.
estoque.mjs (novo)
- receberPorCompra(api, run, {fornecedor, item, quantidade, validadeDias}) → {oc, recebimento, lote} ·
  POST /purchase-orders + /confirm + /receipts · purchase-orders.test.ts, receiving.test.ts · consumidora: produzirPa
- liberarLote(api, lote) → {id, codigo, status} · POST /lots/:id/release · lots.test.ts, expired-release.test.ts ·
  consumidora: produzirPa
produto-acabado.mjs (novo, só orquestra)
- produzirPa(api, run, opções) → item 8; compõe as funções acima.
  Consumidoras: disponibilidade, entregas+expedição, desconto, prova.
pedido.mjs (novo, mínimo)
- criarPedido(api, run, {cliente, linhas:[{produto, quantidade}]}) → {id, codigo, status, linhas:[{id, produtoId}]} ·
  POST /customer-orders · customer-orders.test.ts · consumidora: ajuda (e as da P2, se aprovadas)
- confirmarPedido e aplicarPlano(api, pedido, [{linhaId, reservar, produzir}]) · POST …/confirm e POST …/apply-fulfillment-plan ·
  fulfillment-plan.test.ts · só se a P2 for "API"
orcamento.mjs: esperar a WAVE 3. Se não vier, criarOrcamentoRascunho(api, run, {cliente, produto}) → {projeto, versao} ·
  POST /projects, …/products {link}, …/quote-versions · consumidora: ajuda
expedicao.mjs: NÃO nesta wave (a expedição é o assunto de entregas/expedição e um passo de tela no desconto).
fixtures.test.ts: contrato de cada função com apiFalsa + guarda estendida a estoque.mjs, produto-acabado.mjs e pedido.mjs.
Prova nova: pa-produzido-por-api.mjs (bateria provas-wave-04) — liberar true e false, /inventory do PA, lote apontando
para a OP, e o negativo "sem liberar a MP, a OP não libera (400)".

22. OPERAÇÕES IRREVERSÍVEIS (todas só no clone; o runner remove o clone)
- recebimento (RECEIPT_IN, sem estorno)
- liberação de lote (AVAILABLE; depois, só bloqueio)
- liberação da OP (gasta número oficial)
- consumo (OP em produção não cancela mais)
- apontamento (cria lote de PA) e conclusão (COMPLETED)
- expedição confirmada (saída física; o Pedido não cancela mais)
- faturamento emitido (cancelar só vale em rascunho)
- entrega reprogramada ou cancelada (fica no histórico)
- orçamento enviado/aceito e projeto aprovado
- Pedido e OP cancelados (terminais)

23. CLEANUP POR SUÍTE
- prova do produzirPa: nenhum (estado final carimbado)
- cancelamento: a própria prova termina com Pedido e OP cancelados
- custo estimado: nenhum; voltar ao valor original é a prova 3; a V2 fica em rascunho
- formulação: nenhum (V2 em rascunho)
- disponibilidade: finally cancela as 2 OPs DRAFT e depois o Pedido; ficam o lote retido e a OP concluída
- entregas + expedição: impossível (expedição confirmada); resíduo declarado no log
- desconto: impossível (faturamento emitido)
- ajuda: nenhum (rascunhos)
- OP fora da 1ª página: cancela a OP pela tela (último passo)
Rodada suja: toda suíte cria massa nova; nenhuma depende de limpeza.

24. DEPENDÊNCIAS DA WAVE 3
- desconto: DURA (página da versão, aprovação na ficha, gerar pedido no Fechamento). A 4E só entra depois do merge.
- ajuda (Orçamento): suave; uma versão em rascunho por API resolve.
- Arquivos em comum, com conflito provável: scripts/e2e-run.mjs (BATERIAS), scripts/e2e-run.test.ts, fixtures/cadastros.mjs,
  fixtures/fixtures.test.ts, scripts/e2e/README.md, docs/E2E_STRATEGY.md, docs/PROJECT_STATE.md, docs/BACKLOG.md.
- Escopo: PROJECT_STATE.md:4572 dá o grupo C à WAVE 3 → confirmar antes de começar (P1).
- As outras 7 suítes não dependem do Orçamento.

25. ORDEM DAS SUBWAVES (ajustada)
4A produzirPa + funções pequenas + contratos + prova (só API) — é onde está o risco.
4B suítes sem PA: formulação física + custo estimado (mesma fixture de dose), OP fora da 1ª página (roteiro padrão) e
   cancelamento. Não depende da 4A; pode andar junto.
4C disponibilidade (produzirPa com liberar:false).
4D entregas + expedição fundidas (produzirPa de 20).
4F ajuda contextual — sobe antes da 4E porque não depende de merge.
4E desconto → faturamento, depois da WAVE 3 na main (com rebase).
Gate de cada subwave (decisão I): clone novo verde + mesma bateria em clone sujo + console limpo + SEM MASSA 0.

26. ARQUIVOS A ALTERAR
novos: scripts/e2e/fixtures/estoque.mjs · scripts/e2e/fixtures/produto-acabado.mjs · scripts/e2e/fixtures/pedido.mjs ·
  scripts/e2e/pa-produzido-por-api.mjs · scripts/e2e/entregas-e-expedicao-do-pedido.mjs (nome a decidir)
alterar: scripts/e2e/fixtures/cadastros.mjs · scripts/e2e/fixtures/producao.mjs · scripts/e2e/fixtures/fixtures.test.ts ·
  scripts/e2e-run.mjs (baterias wave-04 e provas-wave-04) · scripts/e2e-run.test.ts · cancelamento-de-pedido-com-op-cancelada.mjs ·
  custo-estimado-acompanha-o-salvamento.mjs · formulacao-quantidade-fisica-e-custo.mjs · disponibilidade-comercial-explicada.mjs ·
  desconto-do-pedido-chega-ao-faturamento.mjs · ajuda-contextual-nivel-1.mjs · ordem-de-producao-produto-fora-da-primeira-pagina.mjs
remover (depois da fusão): entregas-programadas-do-pedido.mjs · expedicao-geral-entre-entregas.mjs
docs: scripts/e2e/README.md · docs/E2E_STRATEGY.md · docs/PROJECT_STATE.md · docs/BACKLOG.md (E2E-CORPUS-MASS-01)
sem mudança de produto: apps/api, apps/web, packages/shared e migrations ficam intactos

27. ESTIMATIVA
4A M · 4B M · 4C S · 4D M · 4F S · 4E M (depois da WAVE 3) → ~5–6 rodadas, L no total.
Runner: produzirPa ~25 chamadas (< 5 s); suítes de tela 30–90 s; bateria wave-04 prevista em 8–12 min por passe, ×2 por gate.

28. BLOCKERS
- 4E: a WAVE 3 não está mergeada (branch sem commit).
- Escopo WAVE 3 × PROJECT_STATE: risco de trabalho duplicado no grupo C. Decidir a P1 antes de começar.
- Nenhum bloqueio técnico para 4A–4D e 4F: toda a cadeia existe por API oficial e o runner ADMIN cobre os papéis.
Atenção (não bloqueia): a discovery paralela PRODUCTION-PERMISSION-HARDENING mexe em picking/consumo/apontamento/conclusão.

29. PERGUNTAS PO
P1 A WAVE 3 é só o fluxo do Orçamento (E2E-QUOTE-PAGE-FLOW-01)? PROJECT_STATE.md:4572 diz grupo C.
P2 Pedido + Confirmar + Plano por API onde não são o assunto? Recomendo: API na ajuda e tela no cancelamento.
   Disponibilidade e entregas/expedição ficam para decidir (API poupa ~30–60 s por suíte).
P3 Suíte fundida: qual nome de arquivo? Remover os dois arquivos antigos?
P4 Um PA de 20 un para os dois cenários, ou um produzirPa por cenário?
P5 Formulação física: pureza e overage da massa própria (proposta 98 % e 5 %, registrados e não aplicados)?
   Sem cenário novo de ajuste aplicado?
P6 Ajuda: Orçamento pela página da versão ("Como funciona") ou pela ficha do Projeto ("Como funciona o Orçamento")?
   Formulação pelo detalhe do produto ou pela versão? A checagem de 390 passa para o Pedido?
P7 OP fora da 1ª página: usar o roteiro padrão do produto (PUT) em vez de aplicar roteiro na OP no meio da suíte?
P8 Desconto: sem helper da WAVE 3, criar projeto/versão/linha/condições por API e manter só envio → faturamento na tela?
   Ou o desconto digitado no Orçamento faz parte da prova?

30. READY_TO_IMPLEMENT
YES — 4A, 4B, 4C, 4D e 4F (depois da P1).
NO — 4E, até a WAVE 3 estar na main.
```

## Implementação

**NÃO IMPLEMENTADO.** Este documento registra o discovery. Nenhuma fixture, suíte, bateria, regra de negócio ou
documento de regra foi alterado por ele.
