# Backlog

O que está **aberto**. Nada mais.

Fechado não fica aqui: regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md), estado em
[`PROJECT_STATE.md`](PROJECT_STATE.md), discovery em [`discovery/`](discovery/README.md), onde cada regra é
protegida em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) e o que já saiu deste arquivo em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md). Escopo futuro vive só em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) e não entra aqui sem decisão explícita do PO.

**Base:** `main` = `origin/main` = `0d81aae`, estável (MAIN-STABILITY-FAST-GATE-01, 2026-09-15). PROD em
`release/prod` = `2400def`. Reconciliado com o estado real em 2026-09-15 (BACKLOG-RECONCILIATION-01). Zero CRITICAL,
zero BLOCKER. O MVP foi entregue; o que está aqui é evolução do produto.

---

## Fila viva — a ordem, num lugar só

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 1 | P1 | **BILLED-VALUE-CANONICAL-01** — "Valor faturado" do Painel, R-15 e R-14 igual ao valor do documento (seção A) | ABERTO · HIGH · sem migration | PO responde D1 do Painel Gerencial (recomendado: `Billing.totalAmount`); depois implementar | D1 |
| 2 | P1 | **E2E-BASELINE-REDESIGN-WAVE-04** — grupo C das E2E com massa própria | Discovery `EM_ANALISE`; P1 e a espera da 4E resolvidas pelo estado posterior | PO fecha P2–P8 ([abaixo](#wave-4--decisões-ainda-reais)); 4A pode começar | — |
| 3 | P1 | **INVENTORY-PHYSICAL-COUNT-DISCOVERY-01** — Inventário Físico em sessões de inventário | PO BASELINE APROVADA · discovery completo NÃO EXECUTADO | Executar o discovery completo | — |
| 4 | P1 | Decisões de **FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01** → MANAGEMENT-DASHBOARD-V1-01 (Painel Gerencial) | Discovery `EM_ANALISE` · D2–D5 abertas | PO fecha D2–D5; implementar a versão 1 | BILLED-VALUE-CANONICAL-01 entregue |
| 5 | P1 | Decisões de **PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01** → PRODUCTION-PERMISSION-HARDENING-01 | Discovery `EM_ANALISE` · P1 e P6 bloqueiam | PO fecha P1 e P6 (e confirma P2–P5, P7, P8); implementar | — |
| 6 | P1 | Decisões de **WAVE-05-GOLDEN-PATH-DISCOVERY-01** → E2E-BASELINE-REDESIGN-WAVE-05 (golden path) | Discovery `EM_ANALISE` · Q3 bloqueia | PO fecha Q3 e as demais; passos 1–2 do plano não dependem de decisão | WAVE 4 entregue |
| 7 | P2 | **Estabilização final ampla do produto** | Sem ID e sem escopo | Abrir ID e escopo quando 1–6 fecharem | WAVE 4, permissões e WAVE 5 |

**P3** — LOW e UX realmente abertos, sem posição: tabelas da seção A (a partir de "LOW e UX da triagem"), seção D e
watchlist (E). A estabilização final (7) é o lugar natural para varrê-los.

**Abertos fora da fila**, cada um esperando decisão própria — nenhum sobe sem o PO:

| Item | Por que não está na fila | Onde |
|---|---|---|
| **OPS-BACKUP-01** — backup agendado de PROD (HIGH) | Snapshot do Railway recusado e PITR desligado; o backup lógico JSON é restaurável e provado. Rotina agendada é decisão de infraestrutura | A |
| COST-VAR-02 — variação de CMV e proteção de margem | Bloqueado: sete decisões do PO e dado real em produção | [`archive/COST-VAR-01…`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) |
| #8E, #8F, #8G · PLAN-DATE-01 · UX-HELP-03 | Melhorias aguardando autorização | B, E |
| #7, #11 | Gate com a Veridi | C |
| SUPPLIER-OFFER-OVERLAP-01 · COM-CONTRACT-01 · SUPPLIER-MODE-01 · ASSET-01 | Discovery sem pergunta decidida | G |

---

## Decisões ainda reais, por item da fila

### BILLED-VALUE-CANONICAL-01 — posição

Primeiro da fila porque é dinheiro já exibido a todos os perfis e pré-requisito do Painel Gerencial. Pronto para
implementar assim que o PO responder D1 de
[FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](discovery/FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md). Detalhe na
seção A.

### WAVE 4 — decisões ainda reais

[E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01](discovery/E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01.md), lido sobre
`9c60845` e persistido sobre `6256ca9` sem ser refeito. O documento histórico não muda.

**Resolvido por estado posterior:**

- **P1** (WAVE 3 era só o fluxo do Orçamento ou também o grupo C?) — a WAVE 3 foi entregue em `6256ca9` (2026-09-15)
  como o fluxo do Orçamento (E2E-QUOTE-PAGE-FLOW-01); o grupo C é da WAVE 4 ([`PROJECT_STATE.md`](PROJECT_STATE.md),
  "Próxima prioridade"). Com isso a 4A, a 4B e a 4F ficam prontas pelo próprio discovery.
- **Espera da 4E pela WAVE 3 na `main`** — satisfeita em `6256ca9`. Antes da 4E, reconferir as fixtures comerciais que
  a WAVE 3 criou (`scripts/e2e/fixtures/comercial.mjs`, `comercial-ui.mjs`), que o discovery não auditou.

**Ainda reais** (cada uma com recomendação no discovery):

- **P2** — Pedido + Confirmar + Plano por API na disponibilidade e em entregas/expedição (a ajuda já é API e o
  cancelamento, tela).
- **P3** — nome da suíte fundida de entregas e expedição, e remoção dos dois arquivos antigos.
- **P4** — um PA de 20 un para os dois cenários, ou um `produzirPa` por cenário.
- **P5** — pureza e overage da massa própria (98 % e 5 %, registrados e não aplicados), sem cenário novo.
- **P6** — ajuda: Orçamento pela página da versão ou pela ficha do Projeto; Formulação pelo detalhe do produto ou
  pela versão; checagem de 390 no Pedido.
- **P7** — OP fora da 1ª página com o roteiro padrão do produto (`PUT`) em vez de aplicar roteiro na OP.
- **P8**, reformulada — a premissa "sem helper da WAVE 3" caiu (`fixtures/comercial.mjs` está na `main`). Resta
  decidir se o desconto digitado no Orçamento faz parte da prova, ou se entra por API e só envio → faturamento fica
  na tela.

Absorve E2E-CORPUS-MASS-01: o que sobrava dele (grupo C e a suíte de `PROD-000214`) são suítes alvo desta wave.

### Inventário Físico — status

**PO BASELINE APROVADA** (INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, seção G; `04d97ad`, merge `9b011aa`).
**Discovery completo INVENTORY-PHYSICAL-COUNT-DISCOVERY-01: AINDA NÃO EXECUTADO** — ganha documento em
[`discovery/`](discovery/README.md) quando rodar. Ponto estrutural que o discovery não pode perder: **concorrência +
saldo de referência + movimentos durante a contagem** (HIGH, seção G). Inventário cíclico, scanner dedicado e
localizações seguem FUTURO.

### Painel Gerencial — status

Nome recomendado: **Painel Gerencial**, não "Painel Financeiro". D1 destrava BILLED-VALUE-CANONICAL-01; D2 (valores
incompletos), D3 (nome e lugar), D4 (quem vê) e D5 (valor de carteira e a faturar) destravam MANAGEMENT-DASHBOARD-V1-01,
que só começa com BILLED-VALUE-CANONICAL-01 entregue. Fora da versão 1, e não promovidos: contas a pagar, contas a
receber, caixa e margem realizada. Pendências do discovery sem posição: encerramento de saldo de OC parcialmente
recebida (G5) e preço acordado em Pedido direto (G2).

### Permissões da Produção — status

Capability própria, [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](discovery/PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md).
**Não está resolvida porque as E2E rodam como ADMIN** (decisão G): isso só tira os perfis das E2E, não fecha a API.

- **Bloqueiam:** P1 — quem executa a OP (picking, consumo, pesagem, parte, apontamento, variância, conclusão;
  recomendado: só ADMIN + PRODUCTION); P6 — os operadores da Veridi entram com conta PRODUCTION própria.
- **Com recomendação, sem bloquear:** P2 (variância), P3 (OP do Pedido e reserva de PA, recomendado capability
  comercial própria), P4 (cancelamentos antigos), P5 (botões de estoque que já dão 403), P7 (autoria em texto), P8 (ID
  próprio para Formulações sem gate).
- **Blockers reais preservados:** I1 — 10 mutações da execução da OP só exigem sessão; I3 — cancelar OP grava
  `SYSTEM_ACTOR`; I6 — `ForbiddenError` não mapeado em `picking`/`production`/`recipe` (um `requireRole` novo responde
  500).

### Golden path (WAVE 5) — status

[WAVE-05-GOLDEN-PATH-DISCOVERY-01](discovery/WAVE-05-GOLDEN-PATH-DISCOVERY-01.md). Vem **depois da WAVE 4**.
`private-label-golden-path.mjs` não mudou desde `9c60845`: F-01 (quebra em `pedido`) e F-02 (quebra em
`sugestao-compra`) seguem valendo.

**Resolvido por estado posterior:**

- **Q5** (escopo das WAVE 3 e 4; esperar o merge da 3) — WAVE 3 = fluxo do Orçamento, mergeada em `6256ca9`; WAVE 4 =
  grupo C; o golden path vem depois da 4.
- **B1** (WAVE 3 em paralelo no trecho comercial) — deixou de ser bloqueio de processo. Sobra reconferência técnica do
  trecho comercial e do runner contra a `main`, sem decisão do PO.

**Ainda reais:** **Q3** (bloqueante — opção B do runner: repassa `--run`/`--desde`, exige `--clone`, checkpoint na
pasta do clone); Q1 (cadastros pela tela ou API), Q2 (pedido direto sai), Q4 (clone mantido na reprovação), Q6
(`orcamento`/`pedido` em quatro etapas), Q7 (diálogo de pendências na estrutura mínima), Q8 (asserções R/N), Q9
(roteiro padrão no Produto ou na OP), Q10 (commit diferente na retomada).

Absorve CUSTOMER-LIST-DEFAULT-E2E-01: o que sobrava dele é o golden path procurar Cliente pela lista padrão.

### Estabilização final — status

P2, depois da WAVE 4, das permissões e da WAVE 5. Sem ID e sem escopo; nasce quando 1–6 fecharem. Entradas naturais:
os LOW e UX da seção A, a seção D e a watchlist.

---

## A. Defeitos abertos

Triados em 2026-09-07 sobre a auditoria de produto. Evidência, passos e
conferência numérica ficam em [`E2E_AUDIT_CURRENT.md`](E2E_AUDIT_CURRENT.md);
aqui fica só o que exige trabalho, com a severidade **do PO**, que nem sempre é
a do auditor.

### BILLED-VALUE-CANONICAL-01 — "Valor faturado" do Painel, do R-15 e do R-14 não é o valor dos documentos — ABERTO

Achado de FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01 (2026-09-15,
[`discovery/`](discovery/FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md), F1),
sem correção. **Severidade HIGH** — dinheiro exibido a todos os perfis.
Posição 1 da fila viva desde 2026-09-15; é pré-requisito de qualquer Painel Gerencial.

O documento de Faturamento, a lista, o resumo do Pedido e a Visão do Cliente
mostram `Billing.totalAmount`: congelado na emissão, com desconto apropriado e
ajuste de fechamento, e com cada linha arredondada antes da soma (§34, §55). Três
superfícies somam por conta própria `quantidade × preço` de todas as linhas, sem
desconto e sem arredondar a linha:

- Painel, "Valor faturado" — `modules/dashboard/dashboard.service.ts:60-72`;
- R-15, valor por documento, total do filtro, CSV e PDF —
  `modules/reports/billing-reports.service.ts:78-92`;
- R-14, valor de cada faturamento — `modules/reports/commercial-reports.service.ts:409-426`.

Pedido de R$ 1.000,00 com 10% de desconto, faturado num documento: o documento
vale R$ 900,00; Painel, R-15 e R-14 dizem R$ 1.000,00. Duas linhas de
`1 × 0,1250`: o documento soma R$ 0,26; Painel e R-15 dizem R$ 0,25. O teste do
Painel só cobre documento sem desconto (`dashboard.test.ts:386-490`), e o
comentário de `web pages/customer-consultation/SummaryTab.tsx:11-19` ainda diz que
o total do Faturamento não é persistido.

Direção recomendada, **dependente da decisão D1 do discovery**: uma função única
de valor do documento emitido — `totalAmount`; o legado sem ele vale a soma das
linhas arredondadas — servindo às três superfícies, com a regra de ausência de
sempre (total só com todos os documentos completos). Nada gravado muda, só a
leitura das três superfícies. Sem migration.

### LOW e UX da triagem de 2026-09-07

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-06-3** | `nextval` chamado fora da transação: recusa consome número de documento em cinco módulos | LOW | S |
| **F-03-2** | Coluna ORIGEM do histórico de versões vazia para versão criada de template | LOW | XS |
| **F-08-3** | Campos "Consumir agora" sem rótulo acessível | LOW | XS |
| **F-01-1** | "Produto" nomeia dois fatos diferentes na Consulta de Cliente | UX | S |
| **VOCAB-01** | Um conceito, três nomes: "Base de produção" (campo), "Base de referência" (leitura) e "Base de produção sugerida" (template) nomeiam a mesma quantidade. Mesma família de F-01-1; sweep só quando houver rodada de nomenclatura | UX | S |
| **F-01-2** | "Criar projeto" desabilitado sem dizer o que falta | UX | XS |
| **F-04-2** | Ativar estrutura e precificação com dado completo não pede confirmação | UX | S |

**F-01-1 e F-07-2 foram rebaixados**: os dois números estão certos para o que
representam — `Project.productId` (produto resultante) contra `project_products`
(produtos em desenvolvimento), e "disponível incluindo a reserva desta OP"
(`requirement-availability.ts:44`) contra disponível global. O defeito é o
rótulo, não o dado. **F-07-2 foi fechado no FIX-05** por isso mesmo: só o rótulo
mudou.

**F-06-3 foi elevado de observação a defeito**: o padrão correto já existe em
`products.service.ts:314`, com comentário nomeando exatamente este problema —
`nextSequenceCode(tx, …)` como primeira linha **dentro** da transação.

### LOW e UX — achados das entregas posteriores

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-01-3** | "Consulta completa" só é alcançável de dentro do modal de edição | UX | S |
| **QUOTE-VERSION-SWITCH-DIRTY-01** | Abrir outra versão com condições pendentes descarta o rascunho sem aviso — mantido de propósito em QUOTE-DRAFT-STATE-01. Só existe um rascunho por projeto e as outras versões são somente leitura; avisar, salvar ou descartar é decisão do PO | UX | S |
| **QUOTE-CASH-HIDDEN-DIRTY-01** | Parcela ou intervalo digitado no Parcelado e escondido pela troca para À vista conta como alteração pendente; salvar grava à vista sem parcelas (o servidor limpa), a releitura não muda o gravado e a pendência fica: "Alterações não salvas" e envio preso até "Descartar alterações". Por leitura de código, desde QUOTE-DRAFT-STATE-01 — antes da correção, o mesmo com `NaN`. Decidir se campo escondido conta como pendência | UX | S |
| **PTBR-NUMERIC-DISPLAY-RESIDUAL-01** | Resíduo consciente de PTBR-NUMERIC-DISPLAY-AUDIT-01: inteiros pequenos dentro de frase sem `formatIntegerPtBr` ("Página X de Y", "Preço incompleto (3/5)", produtos e lotes da conferência da Expedição) — só passam de 999 em volume irreal; a guarda estrutural não enxerga variável solta nem ternário (`: row.onOrder`), só a busca manual; e uma quantidade inteira exibida `1.234`, colada num campo decimal, é recusada como ambígua (a mensagem diz como escrever) | UX | S |
| **OP-PARTS-ZERO-COERCION-01** | "Dividir produção em" vazio ou `0` vai à API como 1 em silêncio — `Number(x) \|\| 1` herdado, preservado no rollout como `partesParaEnvio` para não mudar o payload. A API recusaria `0` com "A produção tem ao menos 1 parte"; decidir se zero volta como erro no campo | UX | XS |
| **NUMERIC-FOCUS-API-ZEROS-01** | Preço e custo de 8 casas que a API serializa com `toFixed` (`12.50000000`) aparecem `12,50` fora do foco e `12,50000000` no foco: `toPtBrEditText` preserva os dígitos, como manda a foundation. Tirar os zeros não significativos na carga mantém o payload semanticamente igual e muda a representação enviada ao salvar sem editar — decidir | UX | XS |
| **FORM-UOM-FK-01** | FK física em `FormulationTemplateComponent.unitCode` → `UnitOfMeasure`. A regra já vale sem ela — tela controlada, API fail-closed, ativação reconferida (FORM-UOM-01) —, e a auditoria somente leitura achou DEV 13/13 e PROD 7/7 componentes com unidade do catálogo e compatível: a migration seria trivial. Recomendada como endurecimento físico, **só com autorização do PO** | LOW | XS |
| **FORMULATION-ITEM-SWAP-UOM-01** | Na Formulação real, trocar o Item de um componente sempre põe a unidade de estoque do Item novo, mesmo quando a escolhida serve: `500` em `mg` vira `500` em `kg`, sem conversão nem aviso — e, antes do Item, a lista oferece o catálogo inteiro. O Modelo (FORM-UOM-01) mantém a unidade compatível e espera o Item; alinhar a Formulação é decisão do PO | UX | S |
| **API-500-RAW-ERROR-01** | Erro do Prisma que nenhuma rota traduz volta como 500 com a mensagem crua — a chamada, o trecho do código e o caminho do arquivo no servidor (visto com a chave estrangeira da unidade da base antes de FORM-UOM-01). Pede tradução genérica no handler global, sem vazar detalhe interno | LOW | S |
| **TZ-DST-MIDNIGHT-GAP-01** | No dia em que o horário de verão começa à meia-noite — o jeito do Brasil até 2019: em 04/11/2018 o relógio foi de 00:00 a 01:00 —, as duas passadas de `meiaNoiteComercial`/`instanteComercial` (`packages/shared/business-timezone.ts`) medem o deslocamento já de verão e voltam uma hora: `limitesDoDiaComercial("2018-11-04").inicio` é `02:00Z`, 23:00 de 03/11, o fim de 03/11 é `01:59:59.999Z`, e `instanteComercial("2018-11-04", 0..59)` cai em 03/11 às 23h. `diaCivil` diz 03/11 para esses instantes: filtro por período e dia comercial discordam nessa hora. O fim do verão (16/02/2019, 25 horas) sai certo. Só histórico hoje; volta se o horário de verão voltar. Anterior à TZ-FORMATTER-REUSE-01, que o manteve idêntico de propósito — corrigir muda o resultado de data | LOW | S |
| **R20-SENT-PRICING-BASIS-SNAPSHOT-01** | O envio do Orçamento congela na linha custo do cálculo, qualidade dele, margem e markup (`buildProvenanceSnapshot`), mas não o custo p/ preço, a qualidade dele nem o Modelo de Precificação. O R-20 da linha enviada diz "Não congelado no envio" em vez de deduzir do vínculo com a faixa (REPORT-ROBUSTNESS-WAVE-01). Fechar pede migration aditiva em `QuoteLine` — decisão de schema do PO. Proposta: `pricingCostPerUnitSnapshot Decimal(24,12)?` e `pricingCostQualitySnapshot IndustrialCostQuality?` copiados da faixa, e o Modelo copiado da versão (as nove colunas nulas de `PricingVersion`, ou `pricingModelSnapshot Json?`), preenchidos no envio; sem backfill — nulo continua "Não congelado no envio" | LOW | M |
| **R20-MANUAL-REFERENCE-MARGIN-01** | A conferir: linha de preço manual ou herdado enviada congela como referência a proveniência da faixa ativa da mesma quantidade (`faixaEquivalenteVigente`), e com ela `contributionMarginSnapshot` da faixa — margem calculada sobre o preço da faixa, não sobre o `unitPrice` da linha. O R-20 mostra essa margem na linha, ao lado do preço manual. Visto na leitura de REPORT-ROBUSTNESS-WAVE-01, sem reproduzir nem mudar | LOW | S |
| **QUOTE-NEW-VERSION-PATHS-01** | Dois caminhos criam versão com efeitos diferentes: "Criar nova versão"/"Novo orçamento" parte da mais recente, herda sozinho o preço do caso seguro de §74 e substitui a enviada; "Duplicar como nova versão" parte da escolhida, pergunta o preço e não substitui nada. O PO decide se os dois convergem (achado de QUOTE-DUPLICATE-01, registrado como P2) | UX | — |
| **QUOTE-DUPLICATE-ORIGIN-01** | A versão duplicada não guarda de qual nasceu: a linha com preço mantido diz no motivo; com "revisar", nada fica. Coluna de origem exigiria migration (achado de QUOTE-DUPLICATE-01) | UX | — |
| **CUSTOMER-FACTS-LOAD-01** | Watch: listagem e exportação de Clientes carregam, para cada Cliente da página, os Projetos com o histórico de status e os Pedidos confirmados. Número de consultas constante; volume de linhas cresce com a história. Medir com volume real (achado de CUSTOMER-COMMERCIAL-STATUS-01) | LOW | — |
| **QUOTE-SUGGESTION-390-01** | Em 390px a frase "Existe uma precificação vigente…" da linha do Orçamento fica cortada dentro da tabela rolável (já cortava o preço; a explicação de F-05-1 alonga a frase). Conferido no código em 2026-09-15: a frase segue em `QuoteWorkspace.tsx` | UX | — |
| **LISTS-CUSTOM-PERIOD-PAGE-RESET-01** | "Personalizado" clicado fora da página 1 (Faturamento, Recebimentos, OC, Produto Acabado) volta para a página 1 do MESMO recorte e consulta uma vez: semear grava `period`/datas na URL, e `useListFilters.set` sempre volta à página 1. Existe desde FILTER-FOUNDATION-01. Decidir se abrir o Personalizado é trocar filtro | UX | — |
| **FORMULATION-PRINT-ADJUSTMENTS-01** | Nenhum impresso lê o modo da quantidade, a pureza, o overage ou o físico por unidade; a tela mostra os ajustes resumidos na linha e "Equivalente estoque" separado de "Físico / unidade". Decidir se o papel acompanha (achado de FORMULATION-ADJUSTMENTS-UX-01) | UX | — |
| **FORMULATION-TEMPLATE-BASIS-EDIT-01** | A tela do Modelo de Formulação preserva a base de cada componente ao salvar, mas não oferece seletor para mudá-la | UX | — |
| **NAV-TWO-SEARCHES-01** | Convivem "Buscar ou escanear lote" no topo e "Buscar telas…" na coluna; unificar é assunto da busca global de registros. Conferido no código em 2026-09-15: as duas seguem | UX | — |
| **NAV-TEMPLATE-WORDING-01** | As telas se chamam Modelos de Formulação e Modelos de Estrutura de Custo, mas botões, campos e diálogos seguem dizendo "template" ("Novo template", "Usar template", "Nome do template"). Trocar a palavra da entidade é decisão do PO. Conferido no código em 2026-09-15: segue | UX | — |

### Achados do FAST-DEVELOPMENT-RESET-02 (2026-09-11)

Golden path private label pela interface, numa base recriada do zero. Dois
bloqueios apareceram e foram corrigidos na própria rodada: o catálogo de
unidades só existia onde alguém tinha rodado seed (instalação nova nascia sem
unidade nenhuma), e RECEIPT-BUSINESS-DAY-01 (todo lote recebido pela interface
levava a véspera no código). O que sobrou não bloqueia o fluxo. A fila viva
ficou congelada durante a rodada: posição destes itens é decisão do PO.

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **OPS-BACKUP-01** | Backup de produção: snapshot manual pela API do Railway recusado (`Not Authorized` — plano ou papel da conta), PITR desligado, nenhuma rotina agendada. O backup desta rodada é o lógico JSON (`prod-backup-json.mjs`), com restauração provada linha a linha por `restore-json-backup-check.mjs`. É o item "Backup do banco" de `DEPLOY.md` §7, que bloqueia operação de verdade. Desde BACKUP-RESTORE-CHECK-01 (2026-09-14) a prova concilia a referência que as migrations gravam (as 6 unidades) em vez de colidir na chave: o backup da carga inicial restaurou 687 linhas idênticas | HIGH | S |
| **TEMPLATE-PURITY-LEGACY-DATA-01** | Desde INPUT-DATE-CONTRACT-WAVE-01 o Modelo recusa pureza 0 ou acima de 100. Modelo gravado antes com esses valores continua lido, mas salvar a versão em rascunho sem corrigir a linha passa a dar 400 com a mensagem da pureza. Não conferido em PROD (sem leitura de produção nesta rodada): contar `formulation_template_components` com pureza `<= 0` ou `> 100` | LOW | XS |
| **COST-MP-EMB-SPLIT-01** | Nem a estimativa da Formulação nem o CMV mostram matéria-prima e embalagem em subtotais separados — o cálculo soma "Materiais e embalagens Veridi" numa linha (`CostBreakdown.tsx`). O total está certo; a separação sai somando pelo código MP-/ME- | UX | S |

### Achado estrutural, sem item próprio

Existem **três implementações independentes** da conta "quantidade por base":
`packages/shared/src/formulation-quantity.ts` (`fatorDaBase`),
`apps/api/src/lib/formulation-math.ts` (`basisFactor`, reimplementado à mão) e o
`convertUomDecimal` cru usado como se fosse a conta. O comentário do próprio
pacote compartilhado diz que isso é o que o domínio proíbe: *"duas contas para o
mesmo número acabam discordando, e a que aparece na tela seria a que ninguém
usa."* G2 (grupos de causa raiz, hoje em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md)) é o primeiro sintoma; consolidar os três motores é candidato a
capability própria, não a correção de finding.

---

## B. Melhorias aprovadas — aguardando autorização do PO

### 8. Cálculo ao vivo nas demais telas

Padrão nascido na Formulação: valor derivado aparece enquanto se digita, a
conta vem da **mesma função** que a API usa, `CalcHint` mostra a aritmética,
premissa ausente vira travessão. Já no padrão: Ordem de Compra, Expedição,
Precificação, Faturamento, Formulação, CMV e a prévia de política de preço
(#8A–#8D, #8H). Regra durável de prévia × gravado:
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §54.

| Item | Tela | Escopo | Prioridade |
|---|---|---|---|
| **#8E** | Recebimento | Custo efetivo: total e comparação com o custo previsto quando aplicável | LOW |
| **#8F** | Ficha de Pesagem | Mostrar a diferença antes da confirmação | LOW |
| **#8G** | Ordem de Produção | Mudar a quantidade planejada não atualiza a prévia das necessidades até salvar. **Auditar antes**: nenhum cálculo vivo pode mutilar OP já congelada | A AUDITAR |

Também no radar, sem item próprio: Contagem de Estoque e Reservar ↔ Produzir
calculam ao vivo mas ainda sem `CalcHint`; Custo Industrial e impacto de
materiais do Pedido ficam em branco até apertar botão, sem dizer que o valor é
do que está salvo.

### 9. OPS-CALENDAR-01 — ABSORVIDO por PLANNING-CALENDAR-01 (2026-09-12)

Fechado sem virar item próprio: o calendário global existe em Planejamento → Calendário de Produção. O
registro original e o que ficou de fora estão em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md). Segue aberto só o discovery separado: se o mesmo
calendário global vale para prazo de planejamento de COMPRA.

---

## C. Decisões aguardando negócio — gate com a Veridi

Não implementar por suposição. Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md); perguntas
regulatórias em [`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md).

### 7. Convenções operacionais ainda não formalizadas

Cada uma tem um padrão em uso; nenhuma impede operação. Com o feedback da
Veridi, quebrar em requirements independentes:

- regra de geração automática do número de lote;
- limiar/alerta de validade próxima;
- permissões detalhadas por papel;
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção.

### 11. Material do cliente — lote do fabricante e validade por configuração do Item — MEDIUM

`receiving/ReceiveCustomerMaterialPage.tsx` aceita confirmar com "Lote do
fabricante" e "Validade" em branco; o recebimento de OC exige os dois quando o
item controla lote e validade. Não existe regra canônica para dizer quando
material fornecido pelo cliente exige lote do fabricante, validade ou
rastreabilidade adicional.

**Decisão de PO:** não assumir que todo Item exige validade. A solução futura
considera regra/configuração por tipo ou por Item — hipótese de modelagem:
"exige lote do fabricante" e "exige validade" —, mas defaults e obrigatoriedade
operacional precisam ser validados com a Veridi. Relacionado ao #7.

---

## D. Manutenção técnica

### 10. Compactar `archive/DELIVERY_HISTORY.md` — LOW

≈5.326 linhas de diário por entrega — contradiz o objetivo do Baseline v2 de
reduzir contexto histórico vivo. Consolidar para ≈200–400 linhas com só data,
capability, release/commit importante, decisão durável e breaking change
relevante. O Git guarda o detalhe. Não misturar com capability de negócio.

### 12. `validate-migrations-fresh.mjs` ainda chama o Prisma por shell — LOW

`execFileSync("pnpm", […], { shell: true })` imprime o `DeprecationWarning
DEP0190` do Node a cada execução, num comando rodado antes de todo merge com
migration. Sem impacto funcional e sem risco real (os argumentos são
constantes). `scripts/prisma-bin.mjs`, criado no MIG-ORDER-01b, já resolve o
binário do Prisma sem shell — a correção é trocar a chamada por ele. Ficou
fora daquela capability de propósito, para não aumentar escopo.

### 16. CALENDAR-LEGACY-COLUMNS-CLEANUP-01 — colunas de jornada única — LOW

PLANNING-CALENDAR-WEEKLY-SCHEDULE-01 (2026-09-12) passou a jornada para
`production_calendar_weekdays` e deixou em `production_calendars` as colunas
da jornada única — `startMinuteOfDay`, `endMinuteOfDay`, `breakMinutes`,
`breakStartMinuteOfDay`, `breakEndMinuteOfDay` e `monday`…`sunday` —, com os
CHECKs delas. Nenhum código as lê; ficaram só para a migration não precisar
remover coluna junto com o backfill. Limpeza: migration que remova colunas e
CHECKs, depois de a jornada semanal estar em produção e o backup lógico
conferido. Sem impacto funcional até lá — o risco é alguém ler a coluna velha
achando que ela é a jornada.

---

## E. Watchlist — observado, sem ação conhecida

Não é backlog operacional. Cada item é verdadeiro hoje e não tem trabalho
definido. Se algum voltar com sintoma novo, aí vira item da seção A.

**W2 saiu (2026-09-08).** Voltou com sintoma novo — 8 falhas em 10 `pnpm test` —,
foi medido, teve causa (a suíte da API e a da web disputando a CPU no runner
oficial) e correção. Está em
[`PROJECT_STATE.md`](PROJECT_STATE.md), "O runner oficial não disputa a máquina
consigo mesmo". **W1 continua sem ocorrência**: `ERR_IPC_CHANNEL_CLOSED` não
apareceu em nenhuma das 40 execuções completas dessa medição.

| # | O quê | Por que não é backlog |
|---|---|---|
| **W1** | `pnpm test` — `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento dos workers do vitest | Nenhuma asserção falha, sem reprodução recente. **Decisão de PO:** não investigar preventivamente. Se reaparecer, capturar versão do Node, worker/processo, ordem de shutdown, árvore de processos, frequência e stack completa **antes** de mexer no runner |
| **W3** | 24 das 56 linhas de `_prisma_migrations` em produção com checksum diferente do arquivo | Line ending, e só. `.gitattributes` fixa LF no SQL das migrations para novos clones. Nada foi reescrito no ledger |
| **W4** | Linha órfã `20260904093000_template_component_quantity_mode` em produção | Tolerada por decisão de 2026-09-04 ([`TECH_BASELINE.md`](TECH_BASELINE.md)). Reescrever `_prisma_migrations` à mão é pior que a linha |
| **W5** | Dois diretórios de migration com o mesmo timestamp `20260904090000` (`_component_quantity_mode` e `_gmp_production_execution`) | A ordenação é pelo nome completo do diretório, então continua determinística e igual em todo ambiente. Sem impacto observado; renomear diretório aplicado é que quebraria o ledger. Um empate **novo** não nasce mais: `proximoPrefixoLivre` pula prefixo ocupado, e `migration-prefix.test.ts` reprova qualquer duplicata além desta |
| **W7** | Quantidade ainda passa por `Number` em pontos de **exibição** das telas de OP e Pedido: teste de sinal (`> 0`, `<= 0`) em `badge`/`disabled`, a diferença `onHand - reserved - available` renderizada (`ProductionOrderPage.tsx:1157`) e o total somado na tela (`CustomerOrderPage.tsx:2178`). O Pedido também imprimia `reservedRemaining` e `stillToReserve` crus — esses, a diferença renderizada da OP e as somas do Faturamento do Pedido saíram em PTBR-NUMERIC-DISPLAY-AUDIT-01 (`formatQuantity` e `Decimal`); ficam os testes de sinal | Classificado no FIX-01b e deliberadamente **não corrigido**: nenhum alcança payload nem validação. Teste de sinal sobre valor ≥ 10⁻¹² é seguro em `double`; o que é defeito de verdade — soma e diferença exibidas em ponto flutuante, e valor cru na tela — é da mesma família de F-07-1 e pertence ao PREC-UI, não a um remendo pontual |
| **W6** | Decisão de domínio pendente: trocar `RESTRICT` por `SET NULL` em alguma das 27 FKs opcionais | Não acontece mais por omissão no modelo (#14). Cada troca é decisão de domínio própria — bloquear a exclusão, desassociar ou arquivar — e exige a migration que a faça no banco |
| **W8** | Tetos de 100 que SELECTOR-CUTOFF-WAVE-02 revalidou e manteve por não serem corte de escolha: dica de homologação da OC (`PurchaseOrderPage.tsx:380`, relações do fornecedor — acima de 100 a dica some da linha, mas fornecedor e item seguem com busca e a OC não depende dela), relações do cadastro de Item/Fornecedor (`SupplierItemsSection.tsx:29`, tabela só leitura; a lista completa, com filtro, é Compras → Item × Fornecedor), amostras da ficha do Projeto (`ProjectDetailPage.tsx:114`, as 100 mais recentes), usuários (`UsersPage.tsx:41`, listagem, fora da fase — Auth). FO-03 saiu em FO03-PENDING-CUTOFF-01 (2026-09-13): a folha lê todas as páginas de `onlyPending` até o total | Medido no dev: até 59 relações por fornecedor e 9 por item, 1 amostra por projeto; 685 usuários, quase todos resíduo de teste (TEST-USERS-LEGACY-RESIDUE-01, que saiu com a recriação do `veridi_dev` em 2026-09-14). Os de recurso industrial (Modelo de Estrutura de Custo, Roteiro, `porId` do Planejamento) eram seletor e fecharam na wave. Vira item da seção A quando algum passar do teto |
| **W9** | `pages/print/operational-sheets.test.tsx`: os dois primeiros testes do FO-02 caíram por `waitFor` de 1 s em `abrirFolha` (a folha ainda em "Gerando PDF…") numa execução fria de 19 arquivos em paralelo (FO03-PENDING-CUTOFF-01); o arquivo sozinho e duas reexecuções do mesmo gate passaram | FO-02 intocado na rodada e sem falha de conteúdo: é o primeiro `import()` do documento sob CPU disputada. Se voltar no `pnpm test`, o remédio é o prazo do `waitFor` de `abrirFolha`, não o código da folha |

---

### 15. `Decimal.toString()` pode sair em notação exponencial — LOW

Os DTOs serializam quantidade e dinheiro por `toString()`, e o decimal.js
devolve notação exponencial abaixo de `1e-7`: uma quantidade de
`0.000000000001` viaja como `"1e-12"`. A tela e o `parseDecimalInput`
receberiam um texto que não é o formato esperado.

**Não observado em dado real**: a menor escala do domínio é doze casas, e
nenhuma quantidade de operação chega perto do limiar. É defeito de fronteira,
não de uso.

Onde se corrige, quando valer: a serialização, num lugar só — `toFixed` na
escala da categoria (§58), nunca `toString`. Encontrado em COM-04, fora do
escopo dele e do COM-04b.

### 14. PLAN-DATE-01 — planejamento temporal pelas entregas programadas — LOW

COM-04 entregou a promessa; ela ainda não influencia o planejamento. Hoje o
cronograma é informativo: o Plano de Atendimento continua cobrindo o Pedido
inteiro de uma vez, e a Sugestão de Compra não sabe que 1.000 saem em outubro e
1.000 em dezembro.

O que se pode ganhar, quando o PO autorizar:

- **Sugestão de Compra com data** — comprar para a primeira entrega antes de
  comprar para a terceira;
- **Necessidade de produção legível no tempo** — o que precisa estar pronto até
  quando;
- **Sugestão de divisão temporal de OP** — sugestão, nunca divisão automática.

**Restrição durável:** nada disso pode criar um segundo motor de reserva. A
reserva continua sendo do Plano de Atendimento (§75). Sem decisão do PO, não
implementar.

**Dependência temporal:** a parte que passar a CONTAR dias úteis — lead time,
data necessária, necessidade de compra a partir da promessa — precisa de
OPS-CALENDAR-01 (B · #9) antes. As demais partes não ficam bloqueadas por isso.

### 13. Ajuda contextual — o que a Fase 1 deixou aberto — LOW

UX-HELP-02 entregou o modelo V2, os sete conceitos compartilhados e os 12
tópicos P0. **Nenhum destes itens bloqueia nada** — a ajuda funciona por
inteiro nos dois modelos —, e o próximo passo é decisão do PO, não sequência
automática:

- **UX-HELP-03** — painel lateral com abas, botão "?" fixo e rota
  `/ajuda/conceitos/:slug`. O conteúdo V2 migra sem reescrita;
- **39 tópicos ainda no modelo V1** — migram por tela, no ritmo de quem revisa
  a regra daquela tela;
- **Tópicos que servem a várias telas** — Recebimentos (quatro), Lotes (três) e
  a lista de Precificação continuam com um tópico só. O §45 já permite dividir;
- **Rótulos de tela na terminologia aprovada** (PO-5, PO-4) — "Situação",
  "Separação", "Modelo", "Em espera", "Lote comercial". É mudança de interface,
  fora da capability de ajuda; até lá a ajuda cita o rótulo real de hoje.

Divergências ainda vivas entre rótulo e terminologia alvo: "Status" nas listas
de expedição, faturamento, projeto e formulação; "Lote Veridi" onde a
terminologia alvo diz "lote comercial"; "Picking" no caminho
`/producao/picking`.

**Achado de responsivo, fora de escopo e anterior a esta rodada:** a casca do
ERP transborda 67px de rolagem horizontal a 390px de largura (`masthead` e
`workspace` com largura mínima maior que a tela). Não vem da ajuda — o painel
não piora a medida — e pertence ao endurecimento responsivo.

---

## G. Discovery — descobrir antes de construir

Nenhum destes tem escopo definido. O trabalho de cada um é **responder uma
pergunta**; desenhar solução antes da resposta é o que produz módulo que ninguém
usa.

O único com posição na fila viva é o Inventário Físico (posição 3): tem PO
baseline aprovada, e a posição é do DISCOVERY completo, não de uma implementação
autorizada. Os outros esperam a pergunta virar decisão. SUPPLIER-ADDRESS-01, que
tinha posição, foi entregue em 2026-09-11 (merge b8d744b).

### SUPPLIER-OFFER-OVERLAP-01 — vigências sobrepostas de oferta E de tarifa industrial

Finding do COST-SOURCE-01 (2026-09-09), registrado sem decisão.

Hoje duas ofertas do MESMO fornecedor podem ter vigências que se sobrepõem:
criar uma oferta nova **não encerra** a anterior. O motor resolve de forma
determinística e testada — `effectiveAt` mais recente, desempate por
`createdAt` — então não há ambiguidade no cálculo.

O problema é de leitura: as duas aparecem como **"Serve de referência"** na tela
da relação, sem dizer qual efetivamente vence. Quem corrige um preço digitado
errado no mesmo mês vê dois números válidos e nenhuma pista de qual está no CMV.

Quatro caminhos, nenhum escolhido: (A) permitir e só explicar qual vence;
(B) ao criar vigência nova, encerrar a anterior automaticamente; (C) permitir e
alertar; (D) permitir sobreposição deliberada como recurso de negócio.

**O escopo desta decisão cresceu em 2026-09-09, e isso é bom.** Quando
INDUSTRIAL-RATE-VALIDITY-01 fechou a borda de dia civil, a auditoria confirmou
que `IndustrialResourceRate` tem EXATAMENTE o mesmo desenho: o banco permite
duas vigências abertas (nenhuma constraint), o service permite (nenhuma
validação), o desempate é determinístico (`effectiveAt` mais recente, depois
`createdAt`) e o histórico da tela marca **as duas** como "Vigente" sem dizer
qual vence. **PROD já tem 1 recurso industrial nesse estado**, além das ofertas.

A decisão é uma só, para os dois lados do custo — oferta de fornecedor e tarifa
de recurso industrial. Responder diferente nos dois seria inventar duas regras
para a mesma pergunta, e o estado atual dos dois está travado em teste para que
a mudança seja deliberada (`rate-validity-api.test.ts`,
`scripts/e2e/vigencia-de-tarifa-industrial.mjs`).

**Contexto que NÃO é tarefa:** as 602 ofertas `LEGACY_IMPORT` do corpus não
têm `effectiveAt` nem `preferred`, e isso é **dado do usuário** — DEV e PROD
não as têm desde o reset de 2026-09-11, e elas voltam, do mesmo jeito, se a
carga do corpus for refeita. Não existe item para "corrigir as 602": informar
vigência sem definir preferencial rebaixaria 90 itens para
`AMBIGUOUS_SUPPLIER_REFERENCE` (auditoria COST-VAR-01, G4). Nenhum backfill,
nem em DEV nem em PROD.

### COM-CONTRACT-01 — registro leve de contrato comercial — P2

Vindo do walkthrough real (2026-09-09). **P2 · discovery: não precede bug nem
quick win**, e não entra na fila viva acima.

Não existe nada de contrato no modelo hoje — a busca por `contract`/`contrato` em
`schema.prisma` e em `packages/shared` não devolve nada. O que existe e NÃO é
isto: `ControlledDocumentRevision` (documento controlado da Qualidade) e
`Attachment` (anexo genérico).

**A decisão já tomada é negativa, e é a mais importante:** contrato **não dirige**
a situação comercial do Cliente. Cliente pode ser ativo sem contrato cadastrado,
e um Prospect pode eventualmente ter documento preliminar se o domínio futuro
permitir. Amarrar os dois faria a situação comercial depender de alguém anexar um
PDF.

Escopo a AUDITAR quando a rodada acontecer — lista de partida, não modelo
aprovado: número/referência, `Customer`, `Project` de origem opcional, data
inicial, validade, encerramento, situação, observação e anexo/documento.

**Preferir derivar a situação do contrato por DATAS** — Vigente, Encerrado,
Vencido — em vez de um status manual redundante, pelo mesmo motivo de
CUSTOMER-COMMERCIAL-STATUS-01 e de §71: "vencida" já é estado derivado na
proposta, e nada varre o banco à meia-noite. Não decidido nesta rodada.

**Não confundir com o que já existe.** As cinco coisas são separadas e a
separação é a regra:

| Conceito | O que é |
|---|---|
| `Customer` | a empresa e o relacionamento |
| `Project` | a oportunidade / o desenvolvimento |
| `QuoteVersion` | a proposta |
| `CustomerOrder` | o compromisso operacional de compra |
| Contrato | a evidência jurídico-comercial do acordo, **quando existir** |

**Não criar módulo grande antecipadamente.** Um contrato com ciclo de aprovação,
alçada e versionamento é outra capability; o que a reunião pediu foi registro.

### SUPPLIER-MODE-01 — "Fornecedor — Virtual / Físico"

Vindo do walkthrough real (2026-09-09). **Não criar enum.**

A expressão apareceu na reunião sem definição, e as leituras possíveis levam a
modelos incompatíveis: classifica o FORNECEDOR (uma distribuidora sem estoque
próprio?), o ESTABELECIMENTO/endereço (loja física × operação online), o CANAL
DE COMPRA (portal × presencial), ou é outra coisa que o termo do dia a dia
esconde? Cada resposta muda onde o campo mora — `Supplier`, o endereço de
SUPPLIER-ADDRESS-01, ou a `SupplierItem`.

Descobrir o que a Veridi decide com essa informação. Um enum criado antes da
resposta ficaria preenchido e inútil.

### ASSET-01 — "Cadastro de Ativos"

Vindo do walkthrough real (2026-09-09). **Não criar módulo.**

Auditar primeiro o que já existe: `IndustrialResource` (com tipo
`LABOR`/`EQUIPMENT`/`ENERGY`, potência em kW e tarifas versionadas),
`IndustrialResourceRate` e o uso planejado por estrutura de custo.

A pergunta é qual dos quatro significados está em jogo: ativo IMOBILIZADO
(patrimônio, depreciação, valor contábil — que o ROADMAP lista como futuro),
MÁQUINA no sentido de equipamento produtivo (já é `IndustrialResource`
`EQUIPMENT`), RECURSO industrial (idem), ou apenas a flag **Ativo/Inativo** de um
cadastro qualquer — que é o falso amigo mais provável em português, e que já
existe em todo cadastro.

Se for imobilizado com depreciação, é capability de custeio e encosta em
CMV-TAX/landed cost. Se for qualquer um dos outros três, provavelmente não há
trabalho.

### INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01 — redesenho do Inventário Físico

Registrado em 2026-09-15, só em documento. **Status: PO BASELINE / INTENÇÃO
APROVADA — não é especificação técnica final.** Diferente dos outros itens desta
seção, os objetivos já foram aprovados pelo PO: o discovery responde o que está
aberto e desenha a solução, e pode mudar detalhe, mas não pode perder objetivo
aprovado. O discovery completo (INVENTORY-PHYSICAL-COUNT-DISCOVERY-01) é a posição 3
da fila viva e AINDA NÃO FOI EXECUTADO. Sem implementação autorizada — nenhum schema,
migration, tela ou API nasce deste registro.

**Ponto de partida.** O Inventário Físico de hoje (`StockCountPage`) conta UMA
posição por vez — item, lote quando o item controla lote, contagem e motivo — e,
havendo diferença, cria o ajuste rastreável sem sair da tela. A FO-01 (folha de
contagem física) já tem modo cego (`?cega=1`, sem a coluna de saldo), mas não há
sessão a que ela se vincule. As regras duráveis de
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §16 continuam valendo; nada aqui as altera.

#### PO BASELINE — objetivos aprovados

**Módulo.** O Inventário Físico deixa de ser somente o formulário 1-a-1 e evolui
para **sessões de inventário em lote**. A função atual fica, como **Contagem
rápida** ou equivalente.

**Entrada.** Lista de inventários: em andamento; concluídos; progresso;
divergências; ações para retomar. Ações principais: **Novo inventário**,
**Contagem rápida** e **Folha de contagem**.

**Novo inventário.** Montador de escopo, com os filtros desejados:

- **Tipo:** matéria-prima; embalagem; produto acabado; todos.
- **Saldo:** somente com saldo; com ou sem saldo.
- **Última contagem:** nunca contado; sem contagem há X dias; período.
- **Movimentação:** movimentado nos últimos X dias; sem movimentação há X dias;
  recebido recentemente; consumido em produção recentemente; expedido
  recentemente; ajustado recentemente.
- **Lote:** ativos; aguardando liberação; bloqueados; vencidos; próximos do
  vencimento; lote específico.
- **Histórico:** com divergência anterior.
- **Propriedade:** Veridi; material de cliente; cliente específico.
- **Seleção:** manual.

Antes de iniciar, mostrar a quantidade de itens e a quantidade de lotes/posições.

**Unidade operacional.** Item sem controle de lote: posição por item. Item com
controle de lote: posição por item + lote. Localização física fica para o
discovery.

**Tela de contagem.** Preferência: grade operacional, com as colunas conceituais
Código, Item, Lote, Unidade, Contagem e Situação. A contagem assistida pode
mostrar saldo e diferença. **A contagem cega não mostra saldo nem diferença
durante a primeira contagem.**

**Busca / autocomplete.** Campo "Item, código ou lote", que encontra por código
do sistema, nome, trecho do nome e código do lote. Ao escolher item com lote,
sugere os lotes daquele item. A UX deve ser compatível com scanner no futuro, e
o Enter deve favorecer a contagem sequencial rápida.

**Adição durante a contagem.** Avaliar "Adicionar item ou lote" para o que o
operador encontra fora do escopo inicial, com registro de auditoria. **Nunca
inventar lote inexistente silenciosamente.**

**Progresso.** Algo como "51 / 91 posições · 56%". Permitir interromper e
retomar.

**Divergências e recontagem.** Fluxo: contar → revelar divergências → recontar →
revisar → confirmar ajustes. A recontagem das posições divergentes é suportada.

**Estoque — regra do PO.** O inventário **nunca sobrescreve saldo
diretamente**. Ao finalizar, gera movimentos/ajustes rastreáveis ligados à
sessão de inventário.

**FO-01.** A folha de contagem é vinculada à sessão. Em inventário cego, **não
imprime o saldo do sistema**. Conteúdo conceitual: identificador; código; item;
lote; unidade; campo para contagem; data/responsável.

**CSV.** Exportar o CSV da sessão. Importar CSV **preenche contagens e nunca
ajusta estoque**. Fluxo: upload → validação → preview → erros/avisos →
confirmação. Protege contra: arquivo de outro inventário; item inexistente; lote
inexistente; item e lote incompatíveis; duplicidade; quantidade inválida; linha
fora do escopo; inventário encerrado. Compatível com o uso brasileiro: UTF-8,
separador `;` e decimal pt-BR. Avaliar também o modelo simples
`codigo_item;lote;contagem` — o discovery decide se entra na primeira versão.

**Histórico / auditoria.** Preservar quem criou, quem contou, quem recontou,
quem aprovou, data/hora, valores, divergências e movimentos gerados.

**Modelagem aberta ao cíclico.** A modelagem deve permitir evoluir para
sugestões automáticas: nunca contado; sem contagem há X dias; movimentação
recente; alto giro; divergência recorrente; próximo do vencimento. As sugestões
em si são FUTURO.

#### DISCOVERY REQUIRED — nada decidido aqui

**HIGH / DISCOVERY REQUIRED — concorrência / cut-off.** Saldo 10 no início; a
produção consome 2; o operador conta 8. O sistema **não pode** interpretar isso
automaticamente como divergência de -2. O discovery precisa comparar: bloqueio
de movimentação; snapshot; reconciliação dos movimentos; saldo no momento da
contagem; outra solução.

Também abertas: tolerância; segundo operador; multiusuário; localização física
futura; lote físico inexistente no ERP; lote do ERP não encontrado fisicamente;
autosave; permissões de contar versus aprovar; política de cancelamento;
imutabilidade após o fechamento. E as duas que a baseline já deixou ao
discovery: se "Adicionar item ou lote" entra, e se o modelo simples de CSV entra
na primeira versão.

#### FUTURO — não promover sem decisão do PO

Inventário cíclico com sugestões automáticas, scanner dedicado, localizações e
regras avançadas não entram no escopo por padrão, nem porque o discovery tocou no
assunto: promover exige decisão explícita do PO. Os três primeiros já estão em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md), seção Armazém / WMS (Contagem
cíclica agendada, Coletores industriais, Endereçamento avançado).

---

## F. Roadmap — fora do backlog

Escopo futuro não fica aqui. Vive em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md):

- **Preferências de exibição de precisão** (PREC-UI-01 a 08) — desenho em
  [`NUMERIC_PRECISION_AUDIT.md`](NUMERIC_PRECISION_AUDIT.md) §11, invariantes
  duráveis em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §57. **Atenção ao
  implementar:** PREC-UI-05 e PREC-UI-06 já são o comportamento atual e
  precisam ser preservados, não reconstruídos;
- **Produto próprio Veridi** — `Product` sem cliente obrigatório, estoque
  próprio de Produto Acabado, venda do mesmo PA a vários clientes.
  `Product.customerId` permanece obrigatório no escopo atual.

**Tributos, frete e demais custos de aquisição permanecem BRAINSTORM**, e o
brainstorm já existe — não se abre item novo para ele. O escopo discutido
(tributo recuperável × não recuperável, percentual × fixo, base de incidência,
vigência, frete e transporte, e em que momento o encargo entra: aquisição,
produção ou venda) está coberto por duas fontes que já estão escritas:

- `ROADMAP_POST_MVP.md`, **Landed cost** — "rateio de frete, impostos e demais
  custos de aquisição" — e a seção "Custeio / CMV — o que ainda falta";
- [`archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md)
  §21, que mapeia os **pontos de extensão possíveis** com o efeito de cada um no
  CMV: oferta, linha de OC, `ReceiptLine.actualUnitCost`, `ReceiptLine` com
  colunas separadas, documento fiscal, `ItemCostReference` e linha manual da
  estrutura.

A direção registrada ali é `ReceiptLine` — o campo se chama *custo efetivo de
aquisição* por causa disso —, e a escolha entre "somar dentro de
`actualUnitCost`" e "colunas separadas" é rodada própria. Nada a decidir aqui, e
nada a implementar.

---

## Próximo gate

A ordem está na fila viva, no topo. Gate paralelo: a validação com a Veridi (#7, #11) vale só para as regras que
dependem do processo real do cliente, e não impede #8E, #8F e #8G quando o PO autorizar. Material pronto:
`Guia_Fluxo_Comercial_Veridi.docx` (não versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
