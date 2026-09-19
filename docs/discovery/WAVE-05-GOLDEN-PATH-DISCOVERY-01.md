# WAVE-05-GOLDEN-PATH-DISCOVERY-01 — Golden path private label na fundação E2E nova

ID completo usado no pedido: `E2E-BASELINE-REDESIGN-WAVE-05-GOLDEN-PATH-DISCOVERY-01`.
Discovery somente leitura, feito em 2026-09-15 em paralelo com a WAVE 3 das E2E.

## Status

**EM_ANALISE** — há decisões do PO (Q3 e Q5) e um bloqueio de processo (B1) que impedem começar a implementação
completa. Os passos 1 e 2 do plano recomendado não dependem de nenhuma decisão.

Veredito do discovery: `READY_TO_IMPLEMENT: NO` — vira YES com Q3 e Q5 respondidas e B1 combinado.

## Objetivo

Redesenhar `scripts/e2e/private-label-golden-path.mjs` para a arquitetura E2E nova (E2E-BASELINE-REDESIGN-WAVE-01-02:
`pnpm e2e:run`, clone TEMPLATE da base E2E, fixtures, runId em memória, navegador SP/pt-BR com coletor HTTP), **sem
executá-lo**, para que a WAVE 5 seja uma implementação orientada por um mapa confiável: etapas, dependências,
checkpoint e retomada, integração com o runner, seletores e asserções que ainda valem, fluxo que ficou obsoleto e
riscos.

O golden path é a prova de ponta a ponta do negócio private label da Veridi pela interface — cadastros, custo de
materiais, custo industrial, CMV, precificação, Projeto, Orçamento, Pedido, planejamento, compras, recebimento,
Qualidade, OP, separação, consumo, produção, reserva, expedição e faturamento — com conta independente em cada número.

## Base auditada

- `origin/main` **9c60845** (`merge: E2E-BASELINE-REDESIGN-WAVE-01-02`), depois de `git fetch`. A cópia local `Veridi`
  estava limpa e igual a ela.
- Worktree `wt-e2e-wave-03` (branch `feat/e2e-baseline-redesign-wave-03`) em 9c60845, sem commit nem alteração no
  momento da leitura. Nada da WAVE 3 foi usado como base.
- `release/prod` em 2400def, intocado.
- Leitura estática por `git archive` num diretório temporário. Nenhum teste, nenhuma E2E, nenhum golden path executado,
  nenhum acesso a banco, nenhum commit, nenhum acesso a PROD. Do disco, só foi lido
  `../.local-data/veridi/e2e-baseline/veridi_e2e_baseline/baseline.json`.
- `private-label-golden-path.mjs`: 1.374 linhas. Todas as referências `L<n>` deste documento são desse arquivo em
  9c60845.

Histórico do arquivo:

- 4e4bdb6, 54a97e0, 40391d6 (2026-09-10): criação e ajustes.
- **Último verde documentado:** FAST-DEVELOPMENT-RESET-02 (2026-09-11), numa base zerada no DEV (3333), sem nenhuma
  falha, com a cadeia `CLI-000001 · PROD-000001 · ORC-000001 → PED-000001 → OC-000001 + OC-000002 → OP-000001 (001/26) →
  LT-20260911-000007 → EXP-000001 → FAT-000001` (`docs/archive/PROJECT_STATE_HISTORY.md`, seção "Reset, golden path e dois
  bloqueios").
- 61573f5 (2026-09-12, PRODUCTION-ROUTE-ASSIGNMENT-01): roteiro mínimo aplicado por API na etapa `op`. Nunca rodou.
- 0662812 (2026-09-14, WAVE-01-02): `--desde` passa a exigir `--run`.
- Nenhuma etapa rodou sobre o código atual.

### Eventos posteriores ao discovery (não reauditados)

Ao persistir este documento, `origin/main` estava em **6256ca9** (`merge: E2E-BASELINE-REDESIGN-WAVE-03`), passando
por 9b011aa (INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01) e pelos commits de ERP-REVIEWER-SKILLS-01. Entre 9c60845 e 6256ca9:

- `scripts/e2e/private-label-golden-path.mjs` **não mudou**;
- mudaram `scripts/e2e-run.mjs`, `scripts/e2e-run.test.ts`, `scripts/e2e/README.md`, `scripts/e2e/fixtures/ui.mjs`,
  `scripts/e2e/fixtures/cadastros.mjs`, `scripts/e2e/fixtures/fixtures.test.ts` e seis suítes do Orçamento
  (`condicoes-do-orcamento-sobrevivem-a-linha`, `formacao-de-preco-do-novo-orcamento`, `prazo-invalido-nao-apaga`,
  `preco-herdado-sobrevive-ao-tab`, `projeto-aprovado-vende-de-novo`, `resumo-comercial-do-projeto`);
- nasceram `scripts/e2e/fixtures/comercial.mjs`, `scripts/e2e/fixtures/comercial-ui.mjs`,
  `scripts/e2e/orcamentos-hub-e-pagina-da-versao.mjs` e `scripts/e2e/envio-exige-condicoes-e-linhas-salvas.mjs`;
- saíram `envio-exige-condicoes-salvas.mjs` e `envio-exige-linhas-salvas.mjs`.

Isso não foi auditado por este discovery. Antes de implementar, reconferir contra a WAVE 3 mergeada os itens que
dependem dela: integração com o runner (seção "Alternativas consideradas"), dependências da WAVE 3, o blocker B1 e a
pergunta Q5.

## Escopo analisado

- O golden path inteiro: argumentos, runId, checkpoint, as 34 etapas, seletores, asserções, esperas e o bloco final
  de console e rede.
- A fundação da WAVE 1–2: `scripts/e2e/lib/{browser,pdf,roteiro,run-id}.mjs`,
  `scripts/e2e/fixtures/{run,api,ui,datas,cadastros,producao}.mjs`, `scripts/e2e-run.mjs` e as guardas de
  `scripts/e2e-run.test.ts` e `scripts/e2e/fixtures/fixtures.test.ts`.
- As telas e componentes de cada etapa em `apps/web/src` (rotas de `App.tsx`, páginas de Clientes, Fornecedores,
  Itens, Item × Fornecedor, Produtos, Formulações, Recursos industriais, Estrutura de custos, Cálculo, CMV,
  Precificação, Projeto, Orçamento, Pedido, OC, Recebimento, Lotes, Estoque, OP, Expedição e Faturamento).
- Rotas e DTOs da API e do `packages/shared` que o golden path lê ou provoca.
- `docs/E2E_STRATEGY.md`, `scripts/e2e/README.md`, `docs/PROJECT_STATE.md`, `docs/BACKLOG.md` e o log de commits
  desde o último verde.

## Estado atual

### O golden path hoje

- 34 etapas declaradas por `etapa(nome, fn)`, mais o bloco final "console e rede".
- Toda etapa concluída grava o checkpoint (`estado.feitas` + `estado.ids`); o `finally` grava de novo.
- Massa carimbada com `GP<runId>`; mutação de negócio pela interface; a API entra para conferir (exceto o roteiro da
  OP, por API desde 61573f5).
- Navegador de `lib/browser.mjs` no fuso America/Sao_Paulo.
- Números da massa:
  - base de 100 un; itens: Vitamina C (kg, 3, base da fórmula, R$ 200), Colágeno (g, 500, base da fórmula, R$ 0,50),
    Pote 60 caps (un, 1 por unidade acabada, R$ 0,80), Rótulo (un, 1 por unidade acabada, R$ 0,15), Caixa 20 potes (un,
    5 na base, referência manual R$ 2,40);
  - MP-B fica sem custo até `oferta-tardia` (cenário §46);
  - materiais da base: 850 (MP) + 107 (embalagem) = **R$ 957,00**;
  - energia: 50 kWh por lote × R$ 0,80 = R$ 40,00 por lote; CMV da base **R$ 997,00**;
  - pedido de 200 un = 2 lotes: CMV **R$ 1.994,00**;
  - margem 30%, comissão 0, desconto 5%; preço da faixa = CMV por unidade / 0,7;
  - faturamento **R$ 2.848,58 − R$ 142,43 = R$ 2.706,15**;
  - necessidade física para 200 un: 6 kg, 1.000 g, 200, 200 e 10;
  - recebimento parcial 4 de 6 kg de MP-A; depois 2 kg de MP-A, 1.000 g de MP-B, 200 potes, 200 rótulos e 10 caixas;
  - lotes do fornecedor `LF-<runId>-A1/A2/B1/P1/R1/C1`, validade +365 dias; lote de PA `LV-<runId>`, validade +730;
  - Orçamento: validade +30, prazo 30, pagamento "À vista"; Produto com 20 un por caixa e vida útil 24.

### A fundação E2E da WAVE 1–2 (já mergeada)

- `fixtures/run.mjs`: `criarRun({ prefixo })`, runId de 6 caracteres base36 por `crypto`, em memória; prefixo `GP`
  aceito pela regex `^[A-Z][A-Z0-9]{1,3}$`.
- `lib/run-id.mjs`: `obterRun` sem arquivo, só compatibilidade.
- `lib/roteiro.mjs`: reexporta `aplicarRoteiroNaOrdem` de `fixtures/producao.mjs`, provado pela suíte
  `roteiro-aplicado-planeja-ordem` (sem roteiro: 400 `route_required`; com roteiro: PLANNED).
- `lib/browser.mjs`: SP/pt-BR, `E2E_API`/`E2E_WEB` só `http://127.0.0.1:<porta>`; `erros` junta `console.error`,
  `pageerror` e todo 4xx/5xx da API não declarado (`esperarErroHttp`); expõe `errosHttp`.
- `fixtures/ui.mjs`: `esperarRota` pelo pathname; `escolherOpcao` com `OPCAO_DE_REGISTRO =
  '[role="option"]:not(.entity-select__create)'`.
- `fixtures/datas.mjs`: `diaComercial` e `porExtenso`.
- `fixtures/cadastros.mjs` e `fixtures/producao.mjs`: massa por API carimbada (`criarRoteiroAtivo`, `aplicarRoteiro`,
  `planejarOrdem`).
- `lib/pdf.mjs`: leitor de PDF provado por `leitor-de-pdf-da-tela`.
- `scripts/e2e-run.mjs`: confere a template por `baseline.json`; clona por `CREATE DATABASE … TEMPLATE`; cria ADMIN
  próprio da execução; sobe API 3334 e Web 5174 em 127.0.0.1; roda as suítes em série (exit ≠ 0, estouro ou "SEM
  MASSA" reprovam; timeout padrão 20 min por suíte); derruba a árvore de processos e remove o clone, a menos que
  `--manter-clone`; `--clone=<nome>` reusa um clone. Baterias em 9c60845: `wave-01-02` (11 suítes) e
  `provas-wave-01-02` (2).
- A WAVE 1–2 mudou no golden path só duas coisas: o guard "`--desde` exige `--run`" (0662812) e o import de
  `lib/roteiro`. O golden continua com cópias próprias de `diaComercial` (L53) e `escolherEntidade` (L169), com o
  filtro `u.port === "3333"` (L133–136), o checkpoint em `handoff/` e `obterRun`.

### A base E2E

`baseline.json` da `veridi_e2e_baseline`: Customer 76, Supplier 113, Item 816, Product 173, FormulationVersion 161,
FormulationComponent 1292, Project 182, ProjectStatusHistory 182, QuoteVersion 2, SupplierItem 721, SupplierItemOffer
773, SupplierItemQualificationHistory 1233, UnitOfMeasure 6, User 1; 74 migrations, última
`20260925093025_pricing_tier_pricing_cost_quality`. Zero recurso industrial, estrutura, cálculo, precificação,
política, lote e pedido.

## Findings

### F-01 — Quebra certa na etapa `pedido` (Orçamento na página própria)

Desde QUOTE-WORKSPACE-NAVIGATION-01 (48cd1ad) e QUOTES-HUB-01 (db9ee3f), ambos de 2026-09-14:

1. A ficha do Projeto só LISTA as versões. "Criar nova versão" (ou "Abrir rascunho" / "Novo orçamento" em projeto
   aprovado) chama `createQuoteVersion` e NAVEGA para `/comercial/orcamentos/:versionId`, com volta para a ficha.
2. A página da versão (`QuoteVersionPage` → `QuoteWorkspace`) tem:
   - `#quote-add-product` (select nativo, opção "PROD-… · nome") + "Adicionar";
   - "Quantidade de PROD-…" e "Aplicar preço calculado";
   - condições (`#quote-valid-until` date, `#quote-discount` PercentField, `#quote-lead-time` IntegerField,
     `#quote-payment-method`, `#quote-notes`) e "Salvar condições";
   - "Enviar ao cliente", bloqueado com pendência, abrindo diálogo "Enviar ao cliente" ou "Enviar mesmo assim" conforme
     a qualidade do custo do PREÇO (bd54a6d);
   - "Registrar aceite", sem diálogo.
3. O Fechamento aparece na versão ACCEPTED: com o projeto não aprovado, só texto e o link "abrir o projeto"; aprovado,
   o botão "Gerar pedido a partir do orçamento aceito", que navega para `/comercial/pedidos/:id`.
4. "Aprovar projeto" → "Aprovar" existe só na ficha. A API exige versão ACCEPTED (`MissingAcceptedQuoteError`).
   Ordem obrigatória: aceitar → aprovar → gerar pedido.

No golden path:

- L633–647 (`orcamento`): `goto` da ficha e espera o editor NA FICHA. Passa por acaso: o fallback "Criar nova versão"
  navega e os locators resolvem na página nova. Não grava a URL da versão.
- L649–652 e L704–706: versão lida por `projeto.quoteVersions.at(-1)`. Válido; melhor `GET /quote-versions/:id`.
- L720: botão do diálogo de envio por `getByRole(...).last()`. Frágil.
- **L733 (`pedido`): "Gerar pedido…" procurado na FICHA — quebra certa.** É aqui que o golden path para.
- `--desde=orcamento` com a versão já enviada: sem editor, quebra.

### F-02 — Quebra certa na etapa `sugestao-compra`

- a) O fornecedor de cada linha da Sugestão de Compra virou `SearchableEntitySelect` `#purchase-supplier-<itemId>`
  (92dd72f, SELECTOR-CUTOFF-WAVE-01, 2026-09-13). L844–853 usa `ancestor::tr[1] >> select` com
  `inputValue`/`selectOption`: não existe `<select>`.
- b) L843 compara `decimalDe(await campo.inputValue())` com a quantidade. Desde PTBR-NUMERIC-INPUT-ROLLOUT-01 (9d169f7,
  2026-09-13) o campo fora do foco mostra `1.000`; `decimalDe("1.000")` = 1, então a linha de MP-B (1.000 g) falha.
  O mesmo vale para qualquer leitura de input com valor ≥ 1.000.

### F-03 — Checkpoint e retomada frágeis, e retomada impossível pelo runner

- CLI por `argumento(nome)` com `split("=")[1]`; opção desconhecida é ignorada em silêncio.
- `--desde` sem `--run`: exit 2 (correto, desde 0662812).
- `--run` sem `--desde`: roda do zero com o runId informado e SOBRESCREVE o checkpoint; o carimbo repetido gera nomes
  duplicados, e a escolha por nome (`.first()`) pode pegar a entidade errada.
- `--desde` com arquivo ausente: estado vazio em silêncio, depois `TypeError` em `estado.ids.X`.
- runId não validado (`/^[0-9A-Z]{6}$/`) e usado em `path.resolve`.
- `estado.runId` não é comparado com `--run`.
- `estado.feitas` é gravado e NUNCA lido: nada confere se as etapas anteriores concluíram.
- `ids` e `numeros` obrigatórios não são conferidos.
- Arquivo em `handoff/golden-path-<runId>.json`, relativo ao cwd (no runner, a raiz do repo; gitignored). Sem
  `schemaVersion`, sem clone, commit ou migrations. `writeFileSync` direto, não atômico.
- O `finally` grava os ids parciais da etapa que falhou por cima dos válidos.
- Captura de falha também em `handoff/` (L1353).
- A mensagem final (L1370) "Retomar: --run= --desde=" omite o clone.
- `rodarSuite` do runner só passa o arquivo da suíte, sem argumentos, e o runner remove o clone no fim (sem
  `--manter-clone`), levando a massa junto. **Hoje é impossível retomar o golden path dentro de `pnpm e2e:run`.**
- `handoff/e2e-run.json` legado: fora do fluxo (`lib/run-id` sem arquivo, guarda em `e2e-run.test.ts:374`). O golden
  não o lê.

### F-04 — runId

- Sem `--run`: `obterRun()` (compatibilidade) → `criarRun()` → 6 caracteres base36 em memória; `P = "GP" + runId`.
- Não usa `criarRun({ prefixo: "GP" })` direto.
- O runner sorteia OUTRO runId para o clone, o ADMIN e a pasta de logs.

### F-05 — `--desde`

- `ETAPAS.findIndex`; etapa desconhecida vira erro com a lista de etapas.
- Reexecuta de N até o fim, sem pré-condição nenhuma.

### F-06 — Verde falso na conferência final

L1320 casa `pedido.billingStatus` com `/FULL|COMPLET|BILLED/`, que aceita `PARTIALLY_BILLED`. O enum é
`NOT_READY | PENDING | PARTIALLY_BILLED | BILLED`. Exigir `=== "BILLED"`.

### F-07 — Dia do lote fixado no início do processo

L978 e L1180 afirmam `LT-${HOJE}` com `HOJE` calculado no INÍCIO do processo (L59). Uma execução que cruza 00:00 de
São Paulo (20h–21h em Vancouver) quebra; retomar em outro dia quebra sempre. Corrigir lendo o dia no momento da ação e
gravando-o no checkpoint.

### F-08 — Afirmações vazias

`afirmar(..., true)` em L515 ("estrutura de custos ativa"), L724 ("proposta enviada e aceita") e L761 ("Pedido
confirmado") não conferem nada.

### F-09 — Código morto e filtro obsoleto

- A criação de recurso industrial NAVEGA para `/gestao/recursos-industriais/:id` (replace). O ramo de busca por
  `#industrial-resources-search` (L464–469) é código morto, e esse id não existe mais (a lista usa
  `#resources-search`).
- O filtro `u.port === "3333"` (L133–136) não registra nada contra a API E2E em 3334; `errosHttp` de `browser.mjs` já
  cobre, e o 4xx não declarado agora reprova pelo `erros`.

### F-10 — Estrutura de custos mascara pendência

"Ativar estrutura" com pendência abre "Ativar mesmo com pendências" (8f6ded2, COST-PRICING-CLARITY-WAVE-01). O golden
anota P3 e clica o último botão do diálogo (L509–513), ativando com pendência sem reprovar.

### F-11 — Valores esperados de custo não dependem de massa externa

A base E2E não tem recurso industrial, estrutura, cálculo, precificação nem política, e todo item e oferta do golden
path é carimbado. R$ 957,00 / 997,00 / 1.994,00 / 2.706,15 dependem só da massa própria. "Criar precificação" cria sem
política (Modelo padrão = custo do cálculo, sem imposto), então o preço = CMV por unidade / 0,7 segue válido depois
de PRICING-TEMPLATE-FLEX-01 (2657eeb) e PRICING-ACTIVATE-CONFIRM-01; com custo completo, a ativação não pede
confirmação.

### F-12 — Grep de rótulo dá falso "obsoleto"

"Base da fórmula", "Por unidade acabada", "Sem referência de custo" e "Calcular pela margem" vêm dos LABELS de
`packages/shared` e não aparecem literais na web; "não representa o custo total" está quebrado em linhas no JSX. Todos
existem na tela.

### F-13 — Achados por área

Cadastros:

- Seletores das etapas 01–05 existem.
- Cliente: o id vem da resposta do POST, então a volta para `?ids=` é irrelevante.
- Produto, Projeto e Pedido buscam cliente com `listCustomers({ active: true, search })`; as suítes verdes escolhem
  cliente recém-criado pelo mesmo caminho.
- PA 1:1 lido de `finishedProductItem`.
- Formulação: rótulo `Quantidade de <itemCode>` (`nomeDoItem = row.itemCode`); modo padrão `PHYSICAL_DIRECT`
  (2a27b31) não muda o físico.
- Filtro padrão: não usado. `?ids=`: não usado. Querystring: só `?quantity=` do CMV, ainda lido por `ProductCmvPage`.
- Campos pt-BR (`2,40`, `0,80`, `0,15`, `200`) e datas `type=date` com ISO funcionam.
- Frágil: `escolherEntidade` filtra "+ Novo" por texto (trocar por `escolherOpcao`, que usa a classe); item e
  fornecedor escolhidos por NOME (escolher por CÓDIGO torna a retomada segura com duplicado); `type()` depreciado.

Custo de material:

- Fonte automática esperada (`GET /items/:id/cost-references` → `automatic`): MP-A, pote e rótulo OFFER (um homologado
  por item, preferencial sem ambiguidade); MP-B NO_COST; caixa MANUAL_REFERENCE.
- Custo parcial: "Sem referência de custo" (rótulo do shared na coluna Origem), "—" (`formatBRL(null)`), "Indisponível"
  e "não representa o custo total" existem.
- Frágil: três afirmações de texto para um fato só; linha da estimativa lida por posição de coluna (`l[0]`, `at(-1)`).

Custo industrial:

- Recurso: `#rate-value` é MoneyField; `"0.80"` é lido como decimal (ponto único sem grupo de milhar), mas o padrão
  pt-BR é `"0,80"`. `rate-effective` fica no padrão da tela (a suíte verde `base-calculada-e-equivalente-por-mil` faz
  igual). Afirmação `/"0\.8/` no JSON do recurso: frágil.
- Estrutura: `#usage-resource` é `SearchableEntitySelect` (COST-USAGE-RESOURCE-BYID-01); `fill` + option ainda
  funciona.
- Cálculo: "Salvar cálculo" → diálogo "Salvar" / "Salvar assim mesmo" e agora navega para `/calculos-custo/:id`
  (`CostCalculationSection:147`); o `CALC-` lido do body segue válido.
- CMV: `/produtos/:id/cmv?quantity=200`; "CMV total para 200 un". Com quantidade ≥ 1.000 viraria "1.000 un" (risco
  latente).
- Campos pt-BR inteiros (100, 50, 200, 30, 0) funcionam.

Pedido:

- Gerado do Orçamento: `commercialOrigin.{subtotalAmount, paymentSchedule.discountAmount, totalAmount,
  quoteVersionId}` e `lines[].agreedPrice` existem. `agreedPrice?.unitPrice ?? agreedPrice` (L753) é tolerante demais.
- Confirmar: "Confirmar pedido" → "Confirmar"; desde CONFIRM-DISCARDS-DIRTY-01 (92a6076) grava pendência antes.
  `esperarTexto("Plano de Atendimento")` (L760) é frágil; conferir CONFIRMED por GET.
- Pedido direto: mesmos seletores da suíte verde `produto-do-cliente-do-pedido`; regex de URL com `$` (L773, L776);
  folha que nenhuma etapa usa e já coberta por aquela suíte.
- Plano de atendimento: campos do DTO existem; "Produzir de" mostra `200` (< 1.000). OP pelo link do `FlowContext`
  (L825); `GET generatedProductionOrders[0].id` é mais estável.
- Mudanças desde o último verde que tocam o fluxo: 07e89ba (guarda de não salvos em Pedido, OP e OC), 92a6076 (grava
  antes de confirmar), cad49a5 (linha empilha abaixo de 640px; desktop não afeta), 92dd72f (seletores sem corte),
  9d169f7 (campo numérico pt-BR).

Compras:

- Necessidade (`materialImpact` 6 / 1.000 / 200 / 200 / 10): essencial.
- "Gerar OCs em rascunho" + diálogo com o mesmo rótulo funcionam; `assentar(2500)` deve virar espera de resposta. Duas
  OCs: essencial.
- OCs: "Preço unitário de <código>", "Salvar rascunho" (habilitado com pendência) e "Confirmar OC" → "Confirmar"
  funcionam. Salvar antes de confirmar já é do produto (92a6076): o "Salvar rascunho" explícito ficou redundante.
  Status aceito como ORDERED ou CONFIRMED (L886): exigir ORDERED.
- Recebimento: "Receber materiais" → `/compras/recebimentos/novo?purchaseOrderId=`; `#receive-now-<purchaseOrderLineId>`
  preenchido com `lines[].id` (a suíte verde `recebimento-validacao-viva` usa o mesmo caminho); "Usar preço da OC"
  fica dentro do `div.field` do custo; "Confirmar recebimento" → "Confirmar", depois `/compras/recebimentos/:id`
  (regex com `$` em L920).
- Datas: validade = `diaComercial(365)`; data do recebimento = padrão da tela.
- Navegação: quase tudo por `goto` de id; só "Receber materiais" e "Preparar …" navegam de verdade.

Qualidade:

- O golden prova hoje: MP com `requiresQualityRelease` nasce AWAITING_RELEASE; embalagem nasce utilizável; lote interno
  `LT-<dia comercial>` com o lote do fornecedor preservado (`supplierLot`); quarentena = físico sem disponível, motivo
  AWAITING_QUALITY_RELEASE; liberação pela tela de 3 lotes de MP e 1 de PA.
- A liberação recusa lote vencido e, só com `requiresCoaSnapshot`, CoA não aprovado. O golden não pede CoA.

Produção:

- Roteiro por API em `op` (L1046, 61573f5): cabe na decisão A do PO. Nunca rodou no golden. O nome `Roteiro GP
  <runId>` não traz o carimbo exato; trocar por `criarRoteiroAtivo` + `aplicarRoteiro`.
- Alternativa registrada pela discovery da WAVE 4: OP nova aplica sozinha o roteiro padrão do Produto
  (`aplicarRoteiroPadraoAutomatico`, só quando o Produto tem `defaultProductionProfileVersionId`). O Produto do golden
  não tem padrão, então hoje a OP nasce sem roteiro.
- Planejar: botão bloqueado com `roteiroPendente`; sem diálogo. **A OP não exige programação nem calendário.**
- Liberar: diálogo "Liberar"; `hasShortage` bloqueia; número oficial `\d{3}/\d{2}`.
- Separação: laço idempotente; lote lido de `td nth(1)` ("Lote esperado", frágil por posição); contagem de `.badge`
  "Conferido" na página inteira (frágil).
- Consumo: colunas Item | Lote | Reservado | Consumido | Restante | Consumir agora; `nth(4)` está certo hoje, frágil por
  posição. O input só habilita com picking CONFIRMED.
- Output: ids existem. Conclusão: `ModalDialog` com `.confirm-dialog__actions` "Concluir OP".
- Primeiro ponto nunca rodado desde o roteiro obrigatório: etapa 25 `op` (L1046). Na prática o fluxo quebra antes, em
  16 `pedido` e 19 `sugestao-compra`.

Expedição:

- Reserva: FormSection "Reservar Produto Acabado", "Reservar de PROD-", "Reservar disponível", "Preparar Expedição"
  existem. `assentar(2000)` deve virar espera de resposta.
- Conferência: `aria-label="Lote conferido da linha <lotCode>"` (a tela não pré-preenche), "Conferir lote",
  "Confirmar expedição" → "Confirmar". `esperarTexto("Confirmada")` frágil; conferir status por GET.
- O golden não lê nenhum impresso (PDF).

Faturamento:

- "Preparar faturamento" → `/comercial/faturamento/:id`.
- Rodapé: "Subtotal bruto (prévia): R$", "· Desconto comercial: − R$" (U+2212), "Ajuste de fechamento: ±", "Total
  faturado (prévia): ". As regex atuais batem (`BillingPage` 537–553), mas leem o body inteiro.
- "Emitir faturamento" → "Emitir" e "Emitido" existem.
- DTO com `grossAmount`, `discountAmount`, `commercialAdjustmentAmount` e `totalAmount`: `campoDe(alternativas)`
  (L1297–1300) é tolerante demais.

## Regras / contratos existentes

- `docs/E2E_STRATEGY.md`, regras das suítes vivas:
  1. massa própria carimbada pelo runId; código oficial sempre lido da resposta;
  2. o que se prova, pela interface; pré-condição por API só quando não é o comportamento sob teste, economiza muito
     tempo, a rota já tem teste de API e não pula a pré-condição do cenário; GET de conferência livre; Prisma e SQL
     proibidos;
  3. happy path e caminhos negativos na mesma suíte;
  4. console e rede sujos reprovam (4xx/5xx não declarado conta; recusa provocada se declara com `esperarErroHttp`);
  5. sem estado entre execuções — nada de veredito nem de runId em arquivo;
  6. reexecutável em base suja;
  7. "SEM MASSA" é reprovação.
- Mapa das suítes em `E2E_STRATEGY.md`: o golden path está nos grupos **D** (reescrever) e **E** (depende de ordem;
  `--desde` exige `--run`; checkpoint de entidades em `handoff/golden-path-<runId>.json`).
- Fixture cria massa genérica carimbada, não navega e não afirma regra (`scripts/e2e/README.md`); guardas em
  `fixtures/fixtures.test.ts`. `fixtures.test.ts:272` guarda a assinatura antiga de `aplicarRoteiroNaOrdem` "do golden
  path".
- Runner: suíte não recebe `DATABASE_URL`; origem só `127.0.0.1` com porta; template com migrations diferentes é
  recusada.
- Domínio relevante: aprovar Projeto exige versão ACCEPTED; gerar Pedido exige Projeto APPROVED
  (`project_not_approved`); planejar OP exige roteiro (`route_required`); liberar lote recusa vencido e CoA exigido não
  aprovado; consumo exige picking CONFIRMED; concluir OP exige consumo reconciliado.

## Gaps

- Não há retomada do golden path dentro do runner (F-03).
- Não há contrato de checkpoint: sem schema, validação, escrita atômica nem vínculo com o clone (F-03).
- O trecho comercial do golden ainda assume o Orçamento embutido no Projeto (F-01).
- A Sugestão de Compra ainda assume `<select>` e leitura crua de input (F-02).
- Asserções vazias, tolerantes e redundantes misturadas às essenciais (F-06, F-08 e "Matriz de asserções").
- 32 esperas fixas somando 40,9 s.
- Seleção de entidades por nome, o que torna a retomada insegura com duplicado.
- Cópias locais de helpers que a fundação já oferece (`diaComercial`, `escolherEntidade`, filtro de porta).

## Riscos

Severidade derivada da classificação do relatório: quebra certa e verde falso = alta; frágil = média; risco que só
aparece rodando = média ou baixa.

| Severidade | Risco |
|---|---|
| Alta | Etapa `pedido` quebra: "Gerar pedido…" procurado na ficha do Projeto (F-01, L733) |
| Alta | Etapa `sugestao-compra` quebra: fornecedor sem `<select>` e `1.000` lido como 1 (F-02) |
| Alta | Verde falso: `/BILLED/` aceita faturamento parcial (F-06, L1320) |
| Alta | Retomada impossível pelo runner, e `--run` sem `--desde` sobrescreve o checkpoint (F-03) |
| Média | `LT-${HOJE}` quebra ao cruzar 00:00 de SP e em qualquer retomada em outro dia (F-07) |
| Média | Diálogo "Ativar mesmo com pendências" mascarado por clique no último botão (F-10) |
| Média | Seletores frágeis por posição, `.first()`/`.last()`, texto específico e regex de URL com `$` |
| Média | 4xx de UI agora reprova por `browser.mjs` (ex.: `GET /products/:id/active-pricing` devolve 404 sem precificação; a web usa `/products/:id/pricing`, conferir rodando) |
| Baixa | `beforeunload` da guarda de não salvos em `page.goto` |
| Baixa | Produto vinculado a um segundo Projeto numa retomada da etapa `projeto` |
| Baixa | "CMV total para 1.000 un" se a quantidade do cenário passar de 999 |

## Cenários relevantes

- **Execução nova completa** num clone novo: as 34 etapas de ponta a ponta, console e rede limpos.
- **Execução em clone sujo** (regra 6 e decisão I): a mesma bateria, sem recriar o clone, com runId novo.
- **Retomada** depois de falha em N, no mesmo clone, com o mesmo runId (matriz em "Relatório original consolidado").
- **Retomada no dia seguinte**: exige o dia do lote vindo do checkpoint (F-07).
- **Custo incompleto antes da oferta tardia** (§46): componente sem custo não vira total ("Indisponível").
- **Recebimento parcial seguido de completo** e liberação da Qualidade antes do uso.
- **Produção reconciliada**: consumo real = necessidade da fórmula, sem motivo de variação.
- **Faturamento sem fragmentação**: bruto, desconto e total iguais ao acordado; ajuste de fechamento zero.

## Alternativas consideradas

Integração com `pnpm e2e:run`:

- **A — suíte normal numa bateria.** Serve para a execução nova completa, mas não retoma e perde o clone no fim.
- **B — modo mínimo no runner (recomendada).**
  - Execução nova: `pnpm e2e:run --suites=private-label-golden-path --manter-clone`.
  - Retomada: `pnpm e2e:run --suites=private-label-golden-path --clone=<clone> --run=<runId> --desde=<etapa>`.
  - O runner aceita `--run`/`--desde` só com UMA suíte de checkpoint declarado (`SUITES_COM_CHECKPOINT`); `--desde`
    exige `--clone` e `--run`.
  - Repassa os argumentos à suíte e exporta `E2E_CLONE` e
    `E2E_ESTADO_DIR=../.local-data/veridi/e2e-runs/<clone>/golden-path/`.
  - Bateria `golden-path` com timeout de 30 min.
- **C — comando próprio.** Duplica clone, ADMIN, API e Web. Rejeitada.

Em qualquer opção o golden usa o clone do runner, o ADMIN da execução (novo a cada retomada; a massa é localizada por
id), o navegador SP/pt-BR, `E2E_API`/`E2E_WEB` e nenhuma porta fixa.

Roteiro da OP:

- **Aplicado na OP por API** (atual, decisão A do PO).
- **Roteiro padrão no Produto antes do Plano**, para a OP nascer com roteiro, como no fluxo real. Pergunta Q9.

Cadastros:

- **Pela tela** (atual; é a única prova de cadeia de cadastro → custo).
- **Por API**, pela regra 2, economizando 1 a 1,5 min. Pergunta Q1.

Retomada das etapas de cadastro:

- **Recomeçar do zero** (baratas, ~2 min).
- **Tornar retomáveis** trocando a seleção por código. Recomendação: recomeçar.

## Recomendação

1. Adotar a opção B de integração com o runner.
2. Checkpoint versionado (schemaVersion 1) na pasta do clone, escrito de forma atômica e validado na retomada (erros
   E1–E13).
3. Reescrever o trecho comercial em quatro etapas pela tela:
   1. `orcamento`: ficha "Criar nova versão" → `esperarRota` da versão → id pela URL → linha, preço, condições →
      salvar → enviar (`confirmarDialogo`);
   2. `aceite`: "Registrar aceite" → GET ACCEPTED;
   3. `aprovacao`: "← Voltar ao Projeto" → "Aprovar projeto" → "Aprovar" → GET APPROVED;
   4. `pedido`: ficha "Abrir <versionLabel>" → Fechamento "Gerar pedido…" → `esperarRota` → confirmar.
4. Corrigir a Sugestão de Compra: fornecedor por `escolherOpcao` com o nome carimbado (a caixa não tem homologado e a
   base tem 113 fornecedores reais); quantidade por parser pt-BR único ou pelo GET da sugestão.
5. Trocar cópias locais pela fundação: `criarRun({ prefixo: "GP" })`, `fixtures/datas`, `fixtures/ui`, `errosHttp`,
   `confirmarDialogo` escopado em todo diálogo.
6. Enxugar asserções (manter as essenciais, tirar redundantes e vazias, endurecer as tolerantes) e trocar `assentar`
   por espera de resposta.
7. Selecionar entidades por código, e não por nome.
8. Gravar o dia comercial do lote no momento da ação.
9. Exigir `billingStatus === "BILLED"`, `ORDERED` na OC e ausência do diálogo de pendências na estrutura mínima.

## Decisões já tomadas

### Confirmadas (antes deste discovery)

- **PO, 2026-09-14** (`docs/E2E_STRATEGY.md`):
  - A: massa por API nas quatro condições da regra 2; GET livre; Prisma/SQL proibido;
  - F: base por clone PostgreSQL TEMPLATE, só local;
  - G: o runner usa ADMIN próprio da execução; COMMERCIAL e PRODUCTION ficam para a adversarial;
  - H: `guia-capturas.mjs` fora do gate;
  - I: pronto por wave = clone novo verde + mesma bateria em clone sujo + console limpo + nenhum "SEM MASSA".
- **WAVE-01-02** (implementado): `--desde` exige `--run`; `handoff/e2e-run.json` fora do fluxo; roteiro mínimo das E2E
  por fixture de API (`fixtures/producao.mjs`).
- **Regra 5**: nada de veredito nem de runId em arquivo; o checkpoint do golden path é mapa de entidades, não veredito.

### Recomendações deste discovery (ainda não decididas)

Opção B do runner; checkpoint v1 com E1–E13; quatro etapas comerciais; cadastros recomeçam do zero; corte de
pedido-direto; reprovar o diálogo de pendências; aviso (não recusa) para commit diferente na retomada; timeout de 30
min para a bateria do golden path.

## Decisões PO pendentes

- **Q1** — Cadastros seguem pela tela (recomendado) ou por API (−1 a −1,5 min)?
- **Q2** — Pedido direto sai do golden path (coberto por `produto-do-cliente-do-pedido`)?
- **Q3** — Aprovar a opção B: runner repassa `--run`/`--desde`, exige `--clone`, checkpoint na pasta do clone?
  (bloqueante)
- **Q4** — Golden path reprovado: o runner mantém o clone sozinho, ou exige `--manter-clone` explícito?
- **Q5** — Escopo real das WAVE 3 e 4. A WAVE 5 espera o merge da 3 para o trecho comercial? (bloqueante; ver
  "Eventos posteriores ao discovery": a WAVE 3 foi mergeada em 6256ca9 depois da leitura)
- **Q6** — Dividir `orcamento`/`pedido` em 4 etapas (34 → 36)?
- **Q7** — Diálogo "Ativar mesmo com pendências" na estrutura mínima: reprovar (recomendado) ou manter P3?
- **Q8** — Remover as asserções R/N da matriz de asserções?
- **Q9** — Roteiro: padrão no Produto antes do Plano (fluxo real) ou aplicado na OP por API (atual)?
- **Q10** — Commit diferente na retomada: aviso (recomendado) ou recusa?

## Plano recomendado de implementação (WAVE 5)

0. Confirmar escopo e merge da WAVE 3 (trecho comercial e `scripts/e2e-run.mjs`).
1. **Fundação no golden, sem mudar negócio:**
   - `criarRun({ prefixo: "GP" })`, `fixtures/datas`, `fixtures/ui`;
   - `errosHttp` do browser (remove o filtro 3333) e `confirmarDialogo` escopado;
   - remover a busca morta de recurso; `"0,80"`; `esperarRota` no lugar das regex com `$`;
   - roteiro carimbado; cabeçalho do arquivo atualizado.
2. **`lib/checkpoint.mjs` puro** (schema, escrita atômica, erros E1–E12) + teste unitário.
3. **Runner:** repasse de `--run`/`--desde` com `--clone`, `E2E_CLONE`, `E2E_ESTADO_DIR`, bateria `golden-path` +
   guardas em `e2e-run.test.ts`.
4. **Correções que quebram hoje:** Sugestão de Compra (`SearchableEntitySelect` + leitura pt-BR); comercial em quatro
   etapas (`orcamento`, `aceite`, `aprovacao`, `pedido`); `BILLED`; dia do lote no momento da ação.
5. **Enxugar asserções** (matriz de asserções) e trocar `assentar` por espera de resposta.
6. **E13** — pré-condição por status das etapas mutantes, de `orcamento` em diante.
7. **Validação:** clone novo verde; retomada forçada em `pedido`, `recebimento-completo` e `expedicao`; mesma execução
   em clone sujo; console limpo; atualizar `scripts/e2e/README.md`, `docs/E2E_STRATEGY.md` e
   `docs/TEST_COVERAGE_MAP.md`.

Passos 1 e 2 não dependem de nenhuma decisão pendente.

Estimativa de esforço: ~1,5 a 2,5 dias de sessão — passos 1–3: 0,5 a 1 dia; passo 4: 0,5 dia; passos 5–6: 0,5 dia;
validação: 0,5 dia.

## Arquivos / áreas provavelmente afetados

- `scripts/e2e/private-label-golden-path.mjs` (reescrita).
- `scripts/e2e/lib/checkpoint.mjs` (novo, proposto) e seu teste unitário.
- `scripts/e2e-run.mjs` e `scripts/e2e-run.test.ts` (opção B, bateria `golden-path`).
- `scripts/e2e/fixtures/ui.mjs` (gestos reutilizáveis), `scripts/e2e/fixtures/datas.mjs`,
  `scripts/e2e/fixtures/producao.mjs` (`criarRoteiroAtivo`, `aplicarRoteiro`).
- `scripts/e2e/fixtures/fixtures.test.ts` (linha 272, assinatura de `aplicarRoteiroNaOrdem`).
- `scripts/e2e/lib/roteiro.mjs` e `scripts/e2e/lib/run-id.mjs` (deixam de ser usados pelo golden).
- Fixtures comerciais da WAVE 3 (`scripts/e2e/fixtures/comercial.mjs`, `comercial-ui.mjs`), se forem reutilizadas —
  não auditadas aqui.
- Documentação: `scripts/e2e/README.md`, `docs/E2E_STRATEGY.md`, `docs/TEST_COVERAGE_MAP.md`,
  `docs/PROJECT_STATE.md`.
- Checkpoint fora do repositório: `../.local-data/veridi/e2e-runs/<clone>/golden-path/<runId>.json`.
- Web, API e `packages/shared`: nenhuma alteração prevista — nenhum blocker de produto; todas as telas e ações do
  fluxo existem.

## Fora do escopo

- Não executar golden path, E2E, testes nem banco nesta etapa; nenhuma alteração de regra de negócio.
- Lacunas de cobertura que ficam para outras capabilities:
  - Qualidade (E2E 02): CoA, lote vencido, bloqueado, rejeitado, FEFO, recebimento acima do pedido;
  - calendário, capacidade e programação da OP — o golden não depende; não adicionar;
  - material do cliente (E2E 03);
  - perfis COMMERCIAL/PRODUCTION (adversarial, decisão G);
  - PDFs de Pedido, OC, OP, Expedição e Faturamento;
  - navegação real por menu e listas (inclusive a lista geral de Orçamentos);
  - recompra em projeto aprovado;
  - entregas parciais e faturamento fragmentado com ajuste ≠ 0;
  - formulação teórica com pureza/overage;
  - recurso por equipamento e mão de obra;
  - precificação por política com impostos;
  - 390px;
  - pedido direto até o faturamento;
  - rastreabilidade na tela;
  - cancelamentos e estornos.
- Endurecimento de permissões da Produção (PRODUCTION-PERMISSION-HARDENING, discovery próprio).

## Critérios de pronto (para a implementação)

- Execução nova do golden path verde num clone novo, pelo runner, com console e rede limpos e nenhum "SEM MASSA".
- A mesma execução verde em clone sujo, com runId novo (decisão I e regra 6).
- Retomada forçada comprovada em pelo menos `pedido`, `recebimento-completo` e `expedicao`, no mesmo clone.
- Checkpoint v1 com escrita atômica e as recusas E1–E12 cobertas por teste unitário; E13 nas etapas mutantes de
  `orcamento` em diante.
- Guardas do runner para `--run`/`--desde`/`--clone` em `scripts/e2e-run.test.ts`.
- Nenhuma asserção vazia; `billingStatus === "BILLED"`; dia do lote vindo do momento da ação.
- `scripts/e2e/README.md`, `docs/E2E_STRATEGY.md` e `docs/TEST_COVERAGE_MAP.md` atualizados.

## Próxima capability recomendada

**E2E-BASELINE-REDESIGN-WAVE-05 — implementação do golden path private label na fundação E2E**, depois das respostas a
Q3 e Q5 e de combinar B1 com a WAVE 3 (já mergeada em 6256ca9, a reconferir). Os passos 1 e 2 do plano podem começar
antes das respostas.

## Relatório original consolidado

### Mapa das 34 etapas

Formato: nome | tela | API | ids gravados | seletor principal | efeito no banco.

| # | Etapa | Tela | API | ids gravados | Seletor principal | Efeito |
|---|---|---|---|---|---|---|
| 01 | `cliente` | `/cadastros/clientes/novo` | POST /customers | `cliente{id,code,nome}` | `#customer-legal-name`/`-email`/`-phone`, "Criar cliente" | Customer (Prospect) |
| 02 | `fornecedores` | `/cadastros/fornecedores/novo` ×2 | POST /suppliers | `fornecedorMp`, `fornecedorEmb` | `#supplier-legal-name` | Supplier ×2 |
| 03 | `itens` | `/cadastros/itens/novo` ×5 | POST /items; GET /items/:id | `mpA`, `mpB`, `pote`, `rotulo`, `caixa` | `#item-type`/`-unit`/`-name`/`-packaging-subtype`/`-initial-cost-reference` | Item ×5 (caixa com referência manual 2,40) |
| 04 | `custos` | `/compras/item-fornecedor`, modal "Nova relação" ×3 | POST /supplier-items; GET /items/:id/cost-references | — | placeholder "Digite código ou nome do item…/fornecedor…", `#supplier-item-*` | SupplierItem + oferta |
| 05 | `produto` | `/cadastros/produtos/novo` | POST /products; GET /products/:id | `produto{id,code,nome,paItemId,paCode}` | `#product-customer` (busca GP<runId>), `#product-*` | Product + PA 1:1 |
| 06 | `formulacao` | `/producao/formulacoes/:productId` → `/versoes/:id` | PATCH /formulation-versions/:id, ativar; GET /products/:id/formulations | `formulacao{versaoId}` | `#version-basis`, `[id^=componente-component-]`, "Quantidade de <MP-…>", "Base de cálculo do componente", `table.table--custo-estimado` | versão ACTIVE |
| 07 | `oferta-tardia` | modal de relação | POST /supplier-items; GET cost-references | — | idem 04 | oferta do MP-B |
| 08 | `custo-completo` | versão da formulação | só GET | `numeros.custoMateriaisBase` | linha `l[0]` = código, `l.at(-1)` = custo; dl "Custo estimado da base (100 un)" | nenhum |
| 09 | `energia` | `/gestao/recursos-industriais/novo` → `/:id` | POST recurso e tarifa; GET /industrial-resources/:id | `energia{id,nome}` | `#resource-name`, `#resource-type` ENERGY, `#rate-value` | IndustrialResource + tarifa |
| 10 | `estrutura-de-custos` | `/produtos/:id/custos` | POST versão, linha, ativar | — | `#new-reference-output`, `#energy-mode` DIRECT, `#usage-resource`, `#usage-quantity`, "Ativar estrutura" | estrutura ACTIVE |
| 11 | `calculo` | `/produtos/:id/custos` → `/calculos-custo/:id` | POST cálculo | `calculo{code}` | "Calcular custo", "Salvar cálculo" → "Salvar", `.definition-list dt` | CALC- |
| 12 | `cmv` | `/produtos/:id/cmv?quantity=200` | só GET | `numeros.cmvPorUnidade` | `.cmv-card__label`/`__value` | nenhum |
| 13 | `precificacao` | custos → `/gestao/precificacao/:id` | POST precificação, faixa, ativar; GET /products/:id/active-pricing | `precificacao{id}`, `numeros.precoFaixa` | `#tier-quantity`/`-mode`/`-margin`/`-commission` | PricingVersion ACTIVE |
| 14 | `projeto` | `/comercial/projetos`, modal "Novo projeto" → `/:id` | POST /projects, vínculo; GET /projects/:id/products | `projeto{id}` | `#project-customer`, `#project-name`, "Vincular produto existente", `#link-product` | Project + vínculo |
| 15 | `orcamento` | hoje a ficha do Projeto (F-01) | POST versão e linha, PATCH /quote-lines, condições, envio, aceite; GET /projects/:id | `orcamento{id,code}`, `numeros.precoUnitario/bruto/desconto/total` | "Quantidade de PROD-", `#quote-add-product`, "Aplicar preço calculado", `#quote-valid-until`/`-discount`/`-lead-time`/`-payment-method`/`-notes` | QuoteVersion ACCEPTED |
| 16 | `pedido` | ficha: "Aprovar projeto" → "Aprovar"; "Gerar pedido…"; "Confirmar pedido" → "Confirmar" | POST approve, gerar pedido, confirm; GET /customer-orders/:id | `pedido{id,code}` | h1 PED- | Project APPROVED, Pedido CONFIRMED |
| 17 | `pedido-direto` | `/comercial/pedidos/novo` | POST /customer-orders | `pedidoDireto{id,code}` | `#co-customer`, `[id^=pedido-produto-]`, `#co-notes` | rascunho que nenhuma etapa usa |
| 18 | `necessidade-producao` | GET fulfillment-plan; pedido: "Aplicar Plano de Atendimento" → "Aplicar Plano" | POST apply | `op{id}` | "Produzir de PROD-", `a[href^="/producao/ordens/"]` | OP DRAFT |
| 19 | `sugestao-compra` | pedido, seção "Sugestão de Compra" | POST gerar OCs; GET pedido.linkedPurchaseOrders | `ocs[{id,code}]` | "Comprar de <código>", fornecedor da linha | 2 OCs DRAFT |
| 20 | `compras` | `/compras/ordens/:id` ×2 | PUT/PATCH, confirm | `ocs[].code/supplierId/linhas` | "Preço unitário de <código>", "Salvar rascunho", "Confirmar OC" → "Confirmar" | OC ORDERED |
| 21 | `recebimento-parcial` | `/compras/recebimentos/novo?purchaseOrderId=` | POST /purchase-orders/:id/receipts | — (REC só no log) | `#receive-now-<linha>`, `#supplier-lot-`, `#expiry-`, "Usar preço da OC" | lote MP-A, OC PARTIALLY_RECEIVED |
| 22 | `recebimento-completo` | idem, OC MP + OC EMB | POST receipts ×2 | — | idem | 5 lotes a mais, OCs RECEIVED |
| 23 | `qualidade` | GET /lots?itemId; `/estoque/lotes/:id` "Liberar" ×3; GET /inventory/:mpA | POST release | `lotes[6]` | "Liberar" → "Liberar" | 3 lotes de MP liberados |
| 24 | `estoque` | GET /inventory ×5; `/estoque` `#inventory-search` | só GET | — | `table.first()` | nenhum |
| 25 | `op` | roteiro por API (production-profiles + POST /production-orders/:id/production-profile); OP: "Planejar OP", "Liberar OP" → "Liberar" | plan, release | `op.code`, `op.numero` | getByText "Planejada"/"Liberada" | OP RELEASED, reserva, número oficial |
| 26 | `separacao` | OP: "Escanear / Informar lote", `#lot-scanner-manual`, "Buscar" | picking confirm | — | `td nth(1)`, `.badge` "Conferido" | picking CONFIRMED |
| 27 | `consumo` | OP, seção "Consumo Real" | POST consumptions | — | `children[1]` lote, `td nth(4)` restante | OP IN_PRODUCTION, baixa de estoque |
| 28 | `producao` | OP: `#output-quantity`/`-destination`/`-business-lot`/`-expiry` | POST outputs | — | "Registrar produção" | lote de PA |
| 29 | `conclusao` | "Concluir OP" + diálogo `.confirm-dialog__actions` | POST complete; GET /inventory ×5 | — | — | OP COMPLETED |
| 30 | `pa-estoque` | GET /lots?itemId=PA; `/estoque/lotes/:id` "Liberar" | release | `lotePA{id,code}` | `lista[0]` | PA disponível |
| 31 | `reserva` | pedido: seção "Reservar Produto Acabado", "Reservar de PROD-", "Preparar Expedição" | POST reserva e expedição | `expedicao{id}` | — | reserva + EXP DRAFT |
| 32 | `expedicao` | `/comercial/expedicoes/:id` | confirm; GET /shipments/:id, inventory, pedido | `expedicao.code` | `input[aria-label^="Lote conferido da linha"]`, "Conferir lote", "Confirmar expedição" → "Confirmar" | saída de PA |
| 33 | `faturamento` | expedição "Preparar faturamento" → `/comercial/faturamento/:id`; "Emitir faturamento" → "Emitir" | POST billing, emitir; GET /billings/:id | `faturamento{id,code}` | regex no body | FAT ISSUED |
| 34 | `conferencia-final` | só GET de pedido e OP | — | — | — | nenhum |

### Dependências entre etapas

- Custo: 02 + 03 → 04 → 06 (+ 05) → 07 → 08; 09 → 10 (05, 06) → 11 → 12 → 13.
- Comercial: 01 → 05 → 14; 13 + 14 → 15 → 16 → 18 → 19 → 20 → 21 → 22 → 23 → 24.
- Produção: 18 + 24 → 25 → 26 → 27 → 28 → 29 → 30 → 31 (+ 16) → 32 → 33 → 34.
- 17 é folha: nada depende dela.
- 08, 12, 24 e 34 são só leitura.
- Dependências escondidas no checkpoint:
  - `numeros.*` gravado em 15 é usado em 16 e 33 (sem ele a comparação dá NaN);
  - `ids.lotes` gravado em 23 é usado em 34;
  - `HOJE` é recalculado a cada processo (usado em 23 e 30).

### Seletores frágeis

- Regex de URL com `$`: L463, L464, L468, L470, L773, L776, L920 → `esperarRota`.
- Porta 3333: L133–136. Remover; `errosHttp` de `browser.mjs` já cobre.
- Primeiro elemento genérico:
  - `clicar()` com `.first()` em todo botão (L150); `esperarTexto` com `.first()` (L157);
  - "Ativa" L514; "Planejada" L1052; "Liberada" L1065;
  - `table.first()` L1017; `a[href^="/producao/ordens/"]` L825; `lista[0]` L1176;
  - `lines[0]` L753 / L805 / L1257 / L1307; `quoteVersions.at(-1)` L650 / L705.
- `.last()`:
  - "Ativar" L392; "Salvar" L530; enviar L720;
  - `.confirm-dialog__actions button` L512 / L586 (clica qualquer diálogo).
- Posição de coluna: `l[0]`/`at(-1)` L374 / L412–413; `td nth(1)` L1087; `children[1]` L1113; `nth(4)` L1116;
  `tr >> select` L844 (quebrado).
- Texto muito específico:
  - custo parcial L376 / L382 / L387; dl L423–424; heurística "separad" L438; dt exatos L485–487;
  - "CMV total para" L550; máscara "98765-4321" L621; "Plano de Atendimento" L760;
  - "Enviado" L721; "Aprovado" L732; "Confirmada" L1240; rodapé L1278–1281; "Emitido" L1293.
- Datas: `HOJE` fixo (L59, L978, L1180). Nenhuma data literal.
- Código fixo: nenhum literal. Só padrões de sequência (`\d{6}`, `OC-\d+`, `REC-\d+`, `\d{3}/\d{2}`) e
  `startsWith("MP-")` em L420. Válidos.
- Sleep: 32 `assentar` = 40,9 s. Os maiores: L857 2500; L1160 e L1207 2000; onze de 1500.
- Sem id estável: `.cmv-card`, `.definition-list dt`, `section.form-section h3`, `h1`, `body.innerText` (L735, L1221,
  L1271), input genérico L1118, `.badge--active` L393.
- Outros: `type()` L172, `getByLabel(RegExp)` L770, `Promise.any` L646.

### Matriz de asserções

Legenda: E essencial · R redundante · F frágil · N não mais válida.

- `cliente`, `fornecedores`, `itens`: prefixo e sequência R; `unitCode` R; "MP exige liberação" E.
- `custos` e `oferta-tardia`: fonte ×5 por `includes` F+R → exigir só MP-B NO_COST, caixa MANUAL e MP-B OFFER.
- `produto`: do cliente E; código R; PA 1:1 E.
- `formulacao`: "—" F; "Indisponível" E (uma vez); frase F; ACTIVE por `JSON.includes` F.
- `custo-completo`: 5 linhas por posição F (manter como Σ, E); subtotal MP/ME R; total 957 E; por unidade R; separação
  N.
- `energia`: `/"0\.8/` F.
- `estrutura-de-custos`: `afirmar(true)` N.
- `calculo`: 997 E; unitário R; `CALC-` E.
- `cmv`: 1.994 E; unitário R.
- `precificacao`: ACTIVE + complete R; preço de 8 casas E.
- `projeto`: contato R (coberto por `contato-do-cliente-no-projeto`); vínculo → exigir.
- `orcamento`: preço PRICING_TIER com 4 casas E; total com desconto E; "enviada e aceita" `true` N.
- `pedido`: congelamento E; preço acordado E; "Pedido confirmado" `true` N.
- `pedido-direto`: a etapa inteira R.
- `necessidade-producao`: REQUER_PRODUCAO E; impacto ×5 E; "Produzir" R; OP gerada E.
- `sugestao-compra`: quantidade ×5 N (pt-BR); fornecedor pré-selecionado N (select); 2 OCs E.
- `compras`: ORDERED/CONFIRMED F.
- `recebimento-parcial` e `recebimento-completo`: E.
- `qualidade`: AWAITING E; `LT-`/`LF-` E; `LT-<HOJE>` F; quarentena E; liberados E.
- `estoque`: ×5 E (um agregado); tela R.
- `op`: DRAFT/origem R; necessidade congelada ×5 R; RELEASED + número + alocação E.
- `separacao`, `consumo`, `producao`: E.
- `conclusao`: "tela sem Falta reconciliar" R; COMPLETED E; estoque 0 E (agregado).
- `pa-estoque`, `reserva`, `expedicao`: E.
- `faturamento`: prévia E; emitido E; `campoDe` F; sem ajuste R; preço unitário E.
- `conferencia-final`: `/BILLED/` F (verde falso); rastreabilidade de 6 lotes E.
- Console limpo: E. Agora inclui 4xx de UI — só rodando aparece.

### Fluxo obsoleto

- L733 "Gerar pedido" na ficha (quebra).
- L843–853 Sugestão com `<select>` e leitura crua (quebra).
- L464–469 busca de recurso (código morto).
- L133–136 filtro de porta 3333.
- L5 / L40 `obterRun` e L4 `lib/roteiro` (compatibilidade).
- L53–58 `diaComercial` e L169–179 `escolherEntidade` duplicados.
- L1046–1049 roteiro sem carimbo.
- L633–647 Orçamento a partir da ficha (passa só pela navegação implícita).
- L7–29 cabeçalho "mutação SÓ pela interface; API nunca fabrica estado" contradiz o roteiro por API e a decisão A.
- `scripts/e2e/README.md` descreve "base que só tem usuário e unidades" (agora é a base real).
- Checkpoint e captura de falha em `handoff/` (L42, L1353).

### Dependências da WAVE 3 (como registrado no discovery)

- `docs/PROJECT_STATE.md` dizia "WAVE 3 = grupo C, depois Orçamento". A discovery paralela da WAVE 4 (mesma base)
  registrou que o PO rodou a WAVE 3 como fluxo do Orçamento (E2E-QUOTE-PAGE-FLOW-01). Confirmar.
- Mesmo trecho: aceitar → voltar ao Projeto → aprovar → abrir versão → Fechamento → gerar pedido.
  - Se a WAVE 3 extrair gestos (abrir versão pela ficha, voltar ao Projeto, confirmar no diálogo) em `fixtures/ui`, a
    WAVE 5 reusa.
  - O roteiro de negócio fica no golden.
  - Fixture não navega (guarda de `fixtures.test.ts`).
- Risco de conflito em `scripts/e2e-run.mjs` (baterias) com o modo checkpoint.
- `fixtures.test.ts:272` guarda a assinatura antiga de `aplicarRoteiroNaOrdem` "do golden path": ajustar junto.

### Dependências da WAVE 4 (como registrado no discovery)

- Pela discovery paralela, WAVE 4 = grupo C + cadeia de PA por API + OP fora da primeira página.
- O golden NÃO deve usar a fixture de cadeia de PA (lá a cadeia é o assunto); os contratos devem ficar compatíveis.
- Achados dela que valem aqui: roteiro padrão automático na OP; picking obrigatório antes do consumo; código do PA ≠
  código do Produto; guarda de fixture sem `[0]`/`goto`.
- Sem dependência de código. Só ordem de merge.

### Matriz de retomada (falha na etapa N → comando → pré-condição)

Comando de retomada (opção B):
`pnpm e2e:run --suites=private-label-golden-path --clone=<clone> --run=<runId> --desde=<etapa>`

Recomeçar do zero (clone novo, `--manter-clone`), por serem baratas (~2 min) e deixarem duplicado por nome ou 409 de
relação repetida:

- `cliente`, `fornecedores`, `itens`, `custos`;
- `estrutura-de-custos` com rascunho parcial.

Seguras sempre (leitura ou laço idempotente):

- `custo-completo`, `cmv`, `estoque`, `conferencia-final`;
- `separacao`, `consumo`, `calculo`, `pedido-direto`.

Mutação única, com pré-condição por GET; se o servidor já passou da etapa, recusar e sugerir a próxima:

| Etapa com falha | Retomar em N quando | Se o servidor já passou |
|---|---|---|
| `produto` | itens e custos em `feitas` (produto órfão inofensivo) | — |
| `formulacao` | produto sem versão | ACTIVE → `oferta-tardia`; rascunho → abrir (hoje não abre: ajustar) |
| `oferta-tardia` | sem relação do MP-B | com relação → `custo-completo` |
| `energia` | sempre (escolher recurso por id/código) | — |
| `precificacao` | sem precificação ativa | ativa → `projeto` (`precoFaixa` relido) |
| `projeto` | sem projeto gravado (conferir se o produto aceita segundo projeto) | — |
| `orcamento` | versão DRAFT | SENT → `aceite`; ACCEPTED → `aprovacao` |
| `aprovacao` | projeto não APPROVED | APPROVED → `pedido` |
| `pedido` | sem `sourcedOrder` | DRAFT → confirmar; CONFIRMED → `necessidade-producao` |
| `necessidade-producao` | sem OP | com OP → `sugestao-compra` |
| `sugestao-compra` | sem OC | com OC → `compras` |
| `compras` | pular OC já ORDERED | — |
| `recebimento-parcial` | sem recebimento | PARTIALLY_RECEIVED → `recebimento-completo` |
| `recebimento-completo` | receber só o saldo | ambas RECEIVED → `qualidade` |
| `qualidade` | liberar só AWAITING_RELEASE (dia do lote vindo do checkpoint) | — |
| `op` | pular roteiro já aplicado | PLANNED → liberar; RELEASED → `separacao` |
| `producao` | sem output | produzido 200 → `conclusao` |
| `conclusao` | IN_PRODUCTION | COMPLETED → `pa-estoque` |
| `pa-estoque` | liberar só se AWAITING_RELEASE | — |
| `reserva` | 0 reservado | 200 sem expedição → preparar; expedição DRAFT → `expedicao` |
| `expedicao` | DRAFT | CONFIRMED → `faturamento` |
| `faturamento` | sem billing | DRAFT → emitir; ISSUED → `conferencia-final` |

### Checkpoint proposto

Local: `../.local-data/veridi/e2e-runs/<clone>/golden-path/<runId>.json`

```json
{
  "schemaVersion": 1,
  "suite": "private-label-golden-path",
  "runId": "K3F9QZ",
  "carimbo": "GPK3F9QZ",
  "clone": "veridi_e2e_baseline_run_xxxxxx",
  "template": "veridi_e2e_baseline",
  "migrations": { "total": 74, "ultima": "...", "assinatura": "..." },
  "commit": "opcional, informativo",
  "criadoEm": "...",
  "atualizadoEm": "...",
  "etapas": ["ordem canônica"],
  "feitas": ["prefixo contíguo"],
  "dias": { "recebimento": "YYYY-MM-DD", "producao": "YYYY-MM-DD" },
  "ids": {},
  "numeros": {},
  "falha": { "etapa": "...", "mensagem": "...", "em": "..." }
}
```

- Escrita atômica: arquivo temporário no mesmo diretório + `renameSync`.
- `ids` e `feitas` só gravados com a etapa concluída; o `finally` grava só `falha`.
- Nenhum veredito (regra 5).
- Commit diferente na retomada: aviso.
- Sem lock (o runner já recusa porta ocupada).

Recusas na retomada (exit 2, "Nada foi executado"):

- **E1** `--desde` sem `--run`.
- **E2** `--run` sem `--desde`.
- **E3** runId inválido.
- **E4** checkpoint ausente ("o clone foi removido?").
- **E5** JSON inválido ou `schemaVersion` incompatível.
- **E6** runId diferente.
- **E7** clone diferente (`--clone=X`).
- **E8** assinatura de migrations diferente.
- **E9** lista de etapas mudou.
- **E10** etapa desconhecida.
- **E11** etapa anterior não concluída ("retome em `--desde=<primeira pendente>`").
- **E12** id obrigatório ausente ("etapa X precisa de `ids.Y`, gravado por Z").
- **E13** servidor já passou da etapa ("retome em `<próxima>`").

### Estimativa de tempo de execução

Estimada; nada medido desde 2026-09-11. Referência: a bateria de 11 suítes simples leva ~16 s por suíte.

- cadastros: ~1,5–2 min
- custo de material: ~0,5–1 min
- custo industrial: ~1–1,5 min
- comercial: ~1–1,5 min
- compras, qualidade e estoque: ~2–2,5 min
- produção: ~1,5–2 min
- expedição e faturamento: ~0,5–1 min
- **total ~8–11 min + ~30 s de subida do runner** (cabe no timeout de 20 min; propor 30 min para a bateria do golden
  path)

Onde economizar sem perder o golden path:

- trocar `assentar` por espera de resposta: −40 s;
- cortar `pedido-direto`: −15 s (PO, Q2);
- `estoque` só por GET: −5 s;
- cadastros por API: −1 a −1,5 min (contraria "pela interface"; PO, Q1);
- a maior economia real é a retomada.

### Blockers registrados

- **B1** — WAVE 3 em paralelo no mesmo trecho comercial e talvez em `scripts/e2e-run.mjs`. Bloqueia o código dos
  passos 3 e 4 até o merge ou uma divisão combinada. (A WAVE 3 foi mergeada em 6256ca9 depois do discovery; reconferir.)
- **B2** — Mudar o runner (opção B) precisa de aval do PO (Q3).
- Nenhum blocker de produto: todas as telas e ações do fluxo existem.
- Riscos que só aparecem rodando: 4xx de UI reprovando por `browser.mjs`; `beforeunload` da guarda de não salvos em
  `goto`; Produto em segundo Projeto na retomada.

## Implementação

**NÃO IMPLEMENTADO**
