# CLOSE-WITH-REASON-DISCOVERY-01 — encerrar com motivo: saldo de OC e de Pedido, reserva de PA e OP sem produção

## 1. Status

`DECIDIDO` — o PO respondeu P1–P12 em 2026-09-19 (seção 11), com as recomendações do discovery e duas precisões
(P3b e P10). `READY_TO_IMPLEMENT = YES` para as quatro fatias da seção 13, sem nova discovery. P5 vale como
provisório; a permissão definitiva e P13 esperam a Veridi. Nada implementado (seção 16).

Discovery READ ONLY de 2026-09-19 sobre `main` `f7ebb771` (PROD `884a500d`, v1.0.0), entregue só no chat.
Persistido no mesmo dia por PRODUCT-BACKLOG-CONSOLIDATION-01 a partir do **relatório final da própria sessão do
discovery**, recuperado da transcrição: o conteúdo das seções 4 a 14 é o do relatório, reorganizado nesta estrutura,
**sem reconferência no código**. As linhas citadas são as de `f7ebb771`. Depois dela, DOCUMENT-TRANSITION-CONCURRENCY-01
Fatia 1 (`ea5188e2`) mexeu em `shipments.service.ts`, `production-orders.service.ts` e `purchase-orders.service.ts`:
as linhas desses arquivos andaram, e o cancelamento de OC e de OP passou a travar e reler. Reconferir na `main` antes
de implementar.

## 2. Objetivo

Desenhar uma solução simples para o saldo que não vai mais acontecer — o que falta receber de uma OC, o que falta
expedir de um Pedido, a reserva de PA que não vai sair e a OP que não vai produzir: encerrar com motivo, sem apagar nem
fabricar documento, sem status novo quando o comportamento é o mesmo, e com o efeito em estoque, Painel e relatórios
dito na tela.

## 3. PO baseline

- O G5 de [FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md): "saldo de OC
  não encerra".
- "Encerrar com motivo" no Top 8 da revisão funcional (VERIDI-NUTRITION-PRODUCT-FUNCTIONAL-REVIEW-01, 2026-09-19, só
  no chat): saldo de OC, saldo de Pedido com liberação de reserva, OP sem saída.
- Nenhuma discovery anterior sobre o tema.
- Regra vigente em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §22-25: `IN_FULFILLMENT` não cancela pelo fluxo simples
  enquanto existir reserva de PA `ACTIVE` ou OP gerada, e nada é liberado ou cancelado em cascata.
- Histórico não se reescreve; correção é fato novo (CLAUDE.md; padrão do estorno do consumo interno, §126).

## 4. Estado atual (em `f7ebb771`)

### OC

- Fluxo: DRAFT → ORDERED (confirmar) → PARTIALLY_RECEIVED/RECEIVED (derivado ao receber); CANCELLED.
- Aberto da linha = pedido − Σrecebido, sem piso (`purchase-orders.service.ts:96-117`).
- Receber (`receiving.service.ts`): trava `purchase_orders` FOR UPDATE e relê o status (:232-238); limita a quantidade
  a pedido − Σrecebido (:256-269); deriva RECEIVED quando toda linha recebeu tudo, senão PARTIALLY_RECEIVED (:346-363).
- Cancelar: só DRAFT/ORDERED (:497), sem trava — desde `ea5188e2` trava e relê. Confirmar e cancelar gravam
  "Ambiente local".
- Rotas de OC sem gate de perfil (`purchase-orders.routes.ts:97-151`).
- PARTIALLY_RECEIVED não tem saída: não cancela e não encerra.

### Pedido

- Fluxo: DRAFT → CONFIRMED → IN_FULFILLMENT (Plano) → PARTIALLY_SHIPPED/SHIPPED (derivado ao confirmar Expedição);
  CANCELLED.
- A expedir = max(pedido − expedido, 0) (`customer-orders.service.ts:179`).
- Falta produzir = pedido − expedido − reservado restante − "ainda vai produzir" (OP não COMPLETED/CANCELLED) −
  "produzido em espera" (:463-505).
- Confirmar Expedição (`shipments.service.ts`): trava shipments → customer_orders → itens → lotes (:763-800); limita a
  pedido − expedido (:856-865); SHIPPED quando expedido ≥ pedido em todas as linhas, e libera a reserva ACTIVE com
  `ORDER_SHIPPED` (:950-980).
- Cancelar (sem trava, :996-1041): recusa se PARTIALLY_SHIPPED/SHIPPED; IN_FULFILLMENT só cancela sem cabeçalho de
  reserva ACTIVE e sem OP em DRAFT..IN_PRODUCTION, COMPLETED ou BLOCKED (:978-985).
- Faturamento: BILLED só se SHIPPED e Σfaturado ≥ Σpedido (:305-329); o documento de fechamento ajusta o
  arredondamento contra o total acordado (`billings.service.ts:229-239`; shared `billings.ts:344-415`).
- Entregas programadas: situação derivada; só o cancelamento é gravado. Viram LATE quando o pendente é > 0 e a data já
  passou (shared `customer-order-deliveries.ts:174-199`).
- Rotas de Pedido sem gate de perfil.

### Reserva de PA

- `CustomerOrderReservation` (ACTIVE/RELEASED) com linhas por lote. A linha já tem `releasedAt`/`releasedBy`/
  `releaseReason`/`replacesLineId` (`schema.prisma:4504-4548`).
- Reservado central (`inventory-ledger.ts:212-315`) = Σ max(qtd − expedido, 0) das linhas com `releasedAt` null e
  cabeçalho ACTIVE. Não olha o status do Pedido.
- A reserva só sai de dois jeitos: SHIPPED (cabeçalho inteiro) e Realocar (`reservation-status.service.ts:263-335`),
  que marca a linha liberada e cria substitutas em outro lote — move a reserva, não a solta.
- Não existe "liberar". Consequências: o PA fica preso; o Pedido IN_FULFILLMENT não cancela (exige cabeçalho não
  ACTIVE); lote reservado não pode ser bloqueado.
- Reservar e Realocar travam customer_orders → itens. Rotas sem gate; autor "Ambiente local".

### OP

- O primeiro consumo leva RELEASED → IN_PRODUCTION.
- Cancelar recusa IN_PRODUCTION (`production-orders.service.ts:1581-1585`).
- Concluir (`production.service.ts:282-353`): trava a OP (:288); recusa produção zero (:302,
  `NoProductionOutputsError`); exige `completionReason` quando produz menos que o planejado (:304-308); exige materiais
  reconciliados (:320-321); libera a `MaterialReservation` (:326-334) e congela o custo (:349).
- Custo com produção zero não divide por zero: custo por unidade null (`production-cost.service.ts:278-287`;
  `costs.service.ts:485-488`). Os custos padrão escalam pela produção e ficam 0 (:188-199).
- R-05 (Planejado x Realizado): rendimento = produzido/planejado × 100, guardado quando planejado = 0
  (`production-reports.service.ts:196-198`).
- Concluir e toda a execução usam só `requireCurrentUser`. Cancelar exige ADMIN/PRODUCTION.

## 5. Evidências

Arquivo e linha ficam junto de cada fato: seção 4 (estado), 10.4 (concorrência) e 10.8 (consultas que mudam). Todos de
`f7ebb771`.

## 6. Findings — o problema por fluxo

- **A. OC 500/400:** os 100 ficam "abertos" para sempre. Aparecem em Em compra (Estoque, Item, CSV); na Sugestão de
  Compra, que compra de menos porque desconta o `onOrder`; em OC atrasada (Painel e atenção); em "Compras esperadas"
  (Painel Gerencial); no R-10 e no R-11. A OC não cancela e não encerra.
- **B. Pedido 10.000/8.000:** 2.000 "a expedir" para sempre. Aparecem na carteira "A expedir" em R$; em Falta reservar
  e Falta produzir, que convidam a produzir e reservar para ninguém; nas entregas pendentes, que ficam LATE; no
  faturamento, que fica PARTIALLY_BILLED para sempre; no R-13 e no R-17.
- **C. PA reservado preso:** o Disponível fica menor para sempre, o Pedido não cancela e o lote não bloqueia.
- **D. OP IN_PRODUCTION eterna:** a reserva de MP restante fica presa (a regra não libera no meio da produção); o
  planejado inteiro conta como "ainda vai produzir", então o Pedido mostra falta produzir 0 e a "OP para o saldo" é
  recusada; a OP segue aberta no Painel.

## 7. Gaps

Não existe caminho para encerrar o saldo de uma OC, encerrar o saldo de um Pedido, liberar uma reserva de PA ou
encerrar uma OP que consumiu e não produziu.

## 8. Riscos

- Corridas com o recebimento, a confirmação da Expedição, a reserva e a execução da OP — tratadas na seção 10.4; o
  encerramento nunca trava `shipments` (a ordem inversa daria deadlock).
- Promessa de entrega nascida para saldo recém-encerrado, enquanto criar e reprogramar entrega não travam o Pedido
  (L7, pré-requisito da fatia do Pedido).
- Reuso de RECEIVED/SHIPPED muda o significado de SHIPPED em `PRODUCT_RULES.md` ("physically shipped").

## 9. Alternativas consideradas

- **A (campos na linha):** cabe um encerramento por linha, ou acumula e perde o histórico.
- **C (documento compensatório):** seria recebimento ou expedição fabricada.
- **B (tabela de fatos) — escolhida:** segue o padrão que o sistema já usa — recebido, expedido e estornado (§126) são
  SOMAS de registros filhos.
- **Status novo ENCERRADA:** teria o mesmo comportamento de RECEIVED/SHIPPED (terminal, sem receber, expedir, editar
  ou cancelar). Custaria rótulos, filtros, CONTRACTED e confirmados do Painel, schemas de relatório e PDF, sem ganho de
  comportamento. Custo real do reuso: o texto de SHIPPED em `PRODUCT_RULES.md` muda para "nada mais a expedir" (P2).
- **OP em CANCELLED:** rejeitado — houve consumo, e a discovery de concorrência trata "CANCELLED com consumo" como
  corrupção.

## 10. Recomendação

**Princípio:** registrar um FATO por linha (quantidade encerrada + motivo + quem + quando). O contratado não muda. Nada
é fabricado nem apagado, e nada reabre.

### 10.1 Modelo por fluxo

**A. OC — "Encerrar saldo":**

- por linha, e "Encerrar todo o saldo" no cabeçalho;
- só em ORDERED/PARTIALLY_RECEIVED;
- 0 < qtd ≤ aberto; a tela pré-preenche o aberto inteiro;
- o corpo traz `expectedOpenQuantity`; se o aberto mudou, recusa com 409;
- recusa quando liquidaria a OC sem nada recebido → usar Cancelar OC;
- sem reabertura: material que chegar depois pede nova OC.

**B. Pedido — "Encerrar saldo":**

- por linha, e "Encerrar saldo do pedido" no cabeçalho;
- só em IN_FULFILLMENT/PARTIALLY_SHIPPED;
- mesmas checagens de quantidade e `expected` da OC.
- Recusas: liquidaria tudo sem nada expedido → Cancelar; Expedição em rascunho com a linha; encerramento parcial com
  reserva restante maior que o novo saldo → "Liberar reserva" antes; encerramento que deixa o Pedido aberto com
  promessa pendente acima do novo saldo da linha.
- Efeitos no mesmo ato, todos listados no diálogo: linha liquidada → as linhas de reserva dela são liberadas, com o
  motivo; Pedido liquidado → SHIPPED, cabeçalho da reserva RELEASED e entregas pendentes canceladas com o motivo; OP e
  OC ligadas NÃO mudam — aviso, sem cascata (P4); faturamento não muda.

**C. "Liberar reserva":**

- por linha de lote (qtd ≤ restante, padrão = tudo) e "Liberar toda a reserva";
- só em IN_FULFILLMENT/PARTIALLY_SHIPPED;
- total = marca a linha liberada (motivo, autor);
- parcial = marca a linha liberada e cria uma substituta no MESMO lote com o que fica (`replacesLineId`), no padrão da
  realocação;
- recusa se uma Expedição em rascunho usa a linha;
- o cabeçalho continua ACTIVE;
- o cancelamento do Pedido passa a olhar "linha ativa", não o cabeçalho.

**D. "Encerrar sem produção" (OP):**

- só IN_PRODUCTION com produzido = 0;
- motivo obrigatório, gravado em `completionReason`;
- usa o portão de reconciliação que já existe;
- libera a `MaterialReservation`, vai a COMPLETED e congela o custo;
- não cria lote, apontamento nem movimento.
- Produção parcial com o resto perdido já está coberta: Concluir com motivo + OP para o saldo.

### 10.2 Campos e tabelas

`purchase_order_line_closures` (`PurchaseOrderLineClosure`): `id` uuid | `purchaseOrderLineId` FK RESTRICT (como
`ReceiptLine`) | `quantity` Decimal(24,12) CHECK > 0 | `reason` text (3–500 na API) | `closedByUserId` FK `users`
(sessão, nunca corpo) | `closedByNameSnapshot` text | `createdAt` default now() | índice por linha.

`customer_order_line_closures` (`CustomerOrderLineClosure`): mesmo formato, com `customerOrderLineId` →
`customer_order_lines`.

Relações de volta: `PurchaseOrderLine.closures`, `CustomerOrderLine.closures` e duas relações nomeadas em `User`.
Nenhuma coluna existente muda. Reserva e OP: nenhum campo novo.

### 10.3 Estados derivados (nenhum status novo)

OC, por linha: aberto = max(pedido − Σrecebido − Σencerrado, 0); liquidada = recebido + encerrado ≥ pedido.

OC, status (um helper só, usado ao receber e ao encerrar): todas liquidadas → RECEIVED (garantido Σrecebido > 0);
senão, Σrecebido > 0 → PARTIALLY_RECEIVED; senão → ORDERED. Marca derivada "saldo encerrado" quando Σencerrado > 0.
Exemplo: 500/400/100 → aberto 0, RECEIVED + marca.

Pedido, por linha: a expedir = max(pedido − expedido − encerrado, 0); falta reservar = max(a expedir − reservado
restante, 0); falta produzir = a fórmula atual com (pedido − encerrado) no lugar do pedido.

Pedido, status (helper único, ao confirmar Expedição e ao encerrar): tudo liquidado → SHIPPED (garantido Σexpedido >
0); senão, Σexpedido > 0 → PARTIALLY_SHIPPED; senão → IN_FULFILLMENT. BILLED quando SHIPPED e Σfaturado ≥ Σ(pedido −
encerrado). Exemplo: 10.000/8.000/2.000 → a expedir 0, SHIPPED + marca "saldo encerrado"; as 2.000 nunca aparecem
como expedidas.

Reserva: restante = linha ativa ? max(qtd − expedido, 0) : 0; liberado para o estoque = restante na liberação − Σ
substitutas (derivado).

OP: COMPLETED com Σprodução = 0 → "Encerrada sem produção" (derivado); falta produzir de OP terminal = 0.

### 10.4 Concorrência — trava raiz → releitura → decisão → efeitos → commit

Raiz de cada ação:

- encerrar OC → `purchase_orders` FOR UPDATE, a mesma raiz do recebimento;
- encerrar Pedido e liberar reserva → `customer_orders` FOR UPDATE, a mesma de Reservar, Realocar, Rascunho de
  expedição, Confirmar, Plano e OP para o saldo;
- encerrar OP → `production_orders` FOR UPDATE, a mesma de consumo, apontamento e Concluir.

O encerramento nunca trava `shipments`: Confirmar trava shipments → customer_orders, e a ordem inversa daria deadlock.
Rascunho de expedição é só lido; a confirmação revalida. Deadlock e timeout (P2034/P2028) → 409 `concurrent_write`, no
padrão de INV e ECI.

Pares:

- Receber 50 × encerrar 100: encerramento primeiro → OC RECEIVED e o recebimento é recusado pelo status; recebimento
  primeiro → o encerramento vê aberto 50 ≠ esperado 100 → 409. Obrigatório: o teto do recebimento passa a descontar o
  encerrado.
- Confirmar Expedição × encerrar Pedido: serializados pelo Pedido. A confirmação revalida "pedido − expedido −
  encerrado"; depois de SHIPPED, recusa.
- Reservar × liberar: serializados. A reserva limita a falta reservar, que já desconta o encerrado.
- Confirmar × liberar: a linha liberada some das ativas; a confirmação recusa, sem saída física.
- Consumir ou apontar × encerrar OP: serializados pela OP. Apontamento primeiro → produção > 0 → 409 "use Concluir".
  Encerramento primeiro → o consumo e o apontamento recusam (COMPLETED).
- Repetir a mesma ação: encerramento com `expected` divergente ou "nada a encerrar" → 409; linha já liberada → 409; OP
  já COMPLETED → 409.
- Pré-requisito: criar e reprogramar entrega passam a travar o Pedido (L7), senão uma promessa nasce para saldo
  recém-encerrado.

### 10.5 Permissões

Gate com `exigirPerfil` antes do corpo. O autor vem da sessão. As constantes ficam no shared, para a tela esconder os
botões:

- encerrar saldo de OC: ADMIN + PURCHASING;
- encerrar saldo de Pedido: ADMIN + COMMERCIAL;
- liberar reserva: ADMIN + COMMERCIAL;
- encerrar OP sem produção: ADMIN + PRODUCTION **provisório**, igual ao cancelar OP; a permissão definitiva do chão
  de fábrica espera a Veridi (P5).

VIEWER nunca escreve (403). Ler o histórico de encerramentos: quem já lê o documento. As listas batem com as decisões
de perfil de [AUTHORIZATION-AUTHORSHIP-DISCOVERY-01](AUTHORIZATION-AUTHORSHIP-DISCOVERY-01.md) (OC com ADMIN +
PURCHASING; Pedido, reserva e realocação com ADMIN + COMMERCIAL).

### 10.6 UX (sem módulo novo; tudo contextual)

- OC, detalhe: linha mostra "Recebido · Encerrado · Aberto" (`PurchaseOrderPage.tsx:1171-1175`); "Encerrar saldo" na
  linha com aberto > 0; "Encerrar todo o saldo" no cabeçalho, só PARTIALLY_RECEIVED; bloco "Encerramentos" (qtd,
  motivo, quem, quando); a lista mostra "Recebida · saldo encerrado".
- Pedido, detalhe: colunas Expedido / Encerrado / A expedir (`CustomerOrderPage.tsx:1896-1903` e totais :2698-2716);
  "Encerrar saldo" na linha e "Encerrar saldo do pedido" no cabeçalho (PARTIALLY_SHIPPED); "Liberar" ao lado de
  "Realocar" (:2846-2893) e "Liberar toda a reserva".
- OP: "Encerrar sem produção" no lugar do "Concluir OP" desabilitado, quando IN_PRODUCTION, produzido = 0 e
  `canOperate` (`ProductionOrderPage.tsx:2371-2404`).
- Todos os diálogos: quantidade pré-preenchida (OC, Pedido, reserva); motivo obrigatório (3–500); efeito dito na tela
  (exemplos: "sai de Em compra, do atraso e da sugestão"; "reserva de 2.000 do lote LT-x volta ao disponível";
  "entregas 2 e 3 serão canceladas"; "OP-x continua aberta"; "MP consumida fica registrada como perda desta OP; o Pedido
  volta a mostrar falta produzir"); aviso de que não há reabertura; botão de confirmação com o verbo e travado durante
  o envio.
- Documentos: PDF da OC e do Pedido e a Consulta do Cliente passam a mostrar "Encerrado". A ajuda ganha tópicos,
  respeitando o teto do `help-editorial`.

### 10.7 Impacto em estoque (nenhum movimento novo)

- A: On Hand e Disponível iguais; Em compra cai pelo encerrado.
- B e C: Reservado cai pelo liberado e o Disponível sobe; On Hand igual.
- D: os `PRODUCTION_CONSUMPTION` ficam (a MP já baixou); o restante reservado é liberado e o Disponível sobe; nenhum
  `FINISHED_GOOD_PRODUCTION` nem lote de PA. MP separada e não consumida volta fisicamente ao estoque, sem movimento,
  porque nunca saiu no livro.
- Rastreabilidade: consumos, lotes de MP e R-06 continuam íntegros.

### 10.8 Impacto em relatórios e Painel — as consultas que mudam

OC, descontar o encerrado:

- `inventory-ledger.ts:322-349` `getOnOrderByItems`. Dele dependem Estoque, detalhe do Item, CSV, Sugestão de Compra,
  impacto do Plano, disponibilidade de requisito (documento da OP, R-04 e falta no Painel).
- `purchase-orders.service.ts:96-117` `toLineDTO`: `openQuantity`, mais `closedQuantity` e `closures`. Alimenta a tela
  da OC, o recebimento (`ReceivePurchaseOrderPage.tsx:194`), o CSV (`list-exports.ts:245-263`) e o PDF
  (`PurchaseOrderPdf.tsx:87-89`).
- `receiving.service.ts:256-269` (teto) e :346-363 (status, pelo helper).
- `dashboard.queries.ts:221-271` (itens em compra, OC atrasada).
- `attention.service.ts:207-227` (`hasOpen`).
- `management-dashboard.service.ts:592-605` e 658-671 (Compras esperadas).
- `purchasing-reports.service.ts:191-252` (R-10; o R-11 deriva dele), mais `report-exports.ts:364-395`,
  `PurchasingReports.tsx` e `ReportPrintPage.tsx:273-284`.

Pedido, descontar o encerrado:

- `customer-orders.service.ts:178-181` (a expedir, `closedQuantity`), :463-505 (falta produzir), :305-329 (BILLED;
  alimenta R-12 e R-13).
- `fulfillment-plan.service.ts:549-556` (OP para o saldo).
- `shipments.service.ts`: :228-231, :437-447, :856-865, :950-964.
- `reservation-status.service.ts:105-114` e :200-211.
- `delivery-schedule.service.ts:213-272` e shared `saldoProgramavel` (entrada "encerrado").
- `management-dashboard.service.ts:306-344` (A expedir R$).
- `commercial-reports.service.ts:243` (R-13) e :282-283 (R-17), mais os CSV em `report-exports.ts` e as telas e
  impressões.
- `CustomerOrderPdf.tsx:92-95` e Consulta do Cliente `OrderPage.tsx:144-147`.

Reserva: `customer-orders.service.ts:331-336` (restante 0 quando liberada), :1012-1026 (cancelar olha linha ativa); R-14
(`commercial-reports.service.ts:359-374`).

OP: `production.service.ts` (novo caminho de produção zero); `customer-orders.service.ts:978-985` (COMPLETED com
produção zero deixa de prender o cancelamento — P3a); `list-exports.ts:532` e `production-orders.service.ts:611` (falta
produzir 0 em OP terminal).

Não mudam:

- porque filtram por status e o encerramento leva ao terminal: Recebimento (receivable), OC atrasada e "Compras
  esperadas" de OC liquidada, contagens de Pedidos, "aguardando expedição", Consulta do Cliente, contagem de OP aberta;
- porque são contrato: Compras contratadas R$ e Pedidos confirmados R$ (o contratado fica);
- porque o encerramento não pode fabricar faturamento: `fechaOPedido` (`billings.service.ts:229-239`) continua exigindo
  o pedido inteiro faturado. Com saldo encerrado não há documento de fechamento; o desconto segue pró-rata.

Opcional: Painel "concluídas no período" separando as sem produção (`dashboard.service.ts:49-51`); rótulo no R-05; "A
receber de fornecedores" em R$ (G5) fica viável.

### 10.9 Migration

Esperada: YES, não criada.

- Duas migrations aditivas, uma por fatia: fatia OC, `purchase_order_line_closures`; fatia Pedido,
  `customer_order_line_closures`. Cada uma: CREATE TABLE, FKs, índice e CHECK `quantity > 0`.
- Prefixo: o próximo depois de `20260925093040`, conferido na hora (sessões paralelas).
- Sem backfill. Dado existente = nenhum fato = encerrado 0, o que é seguro: o encerramento não existia antes. Nenhum
  status existente é recalculado.
- Criar com `pnpm migration:create`; provar com `pnpm validate:migrations:fresh`.
- Reserva e OP: sem migration.

### 10.10 Testes necessários (focados; sem E2E, conforme o PO)

- API, por fatia: 403 antes do corpo para perfis fora do gate; status permitidos e terminais → 409; quantidade 0,
  acima do aberto e `expected` divergente; soma de encerramentos parciais; derivação de status (500/400/100;
  10.000/8.000/2.000; OC ORDERED com linha encerrada fica ORDERED); recusa "nada realizado → Cancelar"; teto de
  recebimento e de expedição depois do encerramento; Em compra, A expedir, falta reservar, falta produzir, OP para o
  saldo, programável, BILLED; Painel, R-10/R-11, R-13/R-17, CSV.
- Pedido: libera a reserva da linha liquidada, cancela as entregas quando termina, OP e OC ligadas intocadas.
- Reserva: parcial por substituta no mesmo lote, Reservado e Disponível pelo ledger, cancelar depois de liberar tudo.
- OP: COMPLETED sem lote nem movimento, reserva liberada, custo congelado com unidade null, R-05 com 0,00%, Pedido volta
  a pedir OP para o saldo.
- Corrida, com a trava sentinela + `pg_stat_activity`: recebimento × encerrar OC; Confirmar × encerrar Pedido;
  Confirmar × liberar; apontamento × encerrar OP.
- Web: diálogos, gates, marcas e os 12 portões estruturais. Mais `pnpm typecheck`.

## 11. Decisões PO

Respondidas pelo PO em 2026-09-19 (handoff PRODUCT-BACKLOG-CONSOLIDATION-01). Pergunta como estava no relatório; decisão
com as palavras do PO.

- **P1 — encerramento parcial (qtd menor que o saldo)?** Recomendado: sim, com o saldo inteiro pré-preenchido e
  `expected` contra clique duplo. **Decidido: SIM.** Pré-preencher o saldo inteiro, mas aceitar quantidade menor.
- **P2 — RECEIVED/SHIPPED passam a significar "nada mais a receber/expedir", com a marca "saldo encerrado"?**
  Recomendado: sim, sem status novo. **Decidido: NÃO criar status novo.** RECEIVED e SHIPPED passam a representar
  "nada mais a receber" e "nada mais a expedir" quando parte foi realizada e o restante foi encerrado. Mostrar a marca
  "saldo encerrado". A quantidade contratada original permanece intacta.
- **P3a — OP CONCLUÍDA com produção zero deixa de prender o cancelamento do Pedido?** Recomendado: sim. **Decidido:
  NÃO bloqueia** o cancelamento do Pedido.
- **P3b — OP CONCLUÍDA com produção também deixa de prender, com o diálogo dizendo que o PA fica no estoque livre?**
  Recomendado: sim, revertendo uma decisão registrada. **Decidido: também NÃO bloqueia** o cancelamento comercial. A
  produção NÃO é desfeita; o PA permanece como estoque físico disponível, sujeito às regras normais de qualidade e
  reserva. O diálogo explica isso.
- **P4 — OP aberta ligada ao saldo encerrado: aviso sem cascata ou bloqueio?** Recomendado: aviso. **Decidido:
  AVISAR** — OP ou OC aberta ligada ao saldo encerrado não é cancelada, encerrada nem alterada automaticamente. Sem
  cascata irreversível.
- **P5 (Veridi) — quem encerra OP sem produção?** **Decidido como provisório: ADMIN + PRODUCTION.** A permissão final
  depende da Veridi.
- **P6 — material que chega depois do encerramento?** Recomendado: nova OC, sem "reabrir saldo". **Decidido:** exige
  nova OC. Sem reabertura.
- **P7 — reserva maior que o novo saldo no encerramento parcial?** Recomendado: recusa; liberar antes. **Decidido:**
  recusar e pedir a liberação antes.
- **P8 — entregas?** Recomendado: Pedido que termina cancela as pendentes; Pedido que segue aberto recusa promessa acima
  do novo saldo. **Decidido:** ao liquidar o Pedido, as entregas pendentes são encerradas/canceladas de forma auditável;
  se o Pedido continua aberto, não permitir promessa acima do novo saldo.
- **P9 — Rascunho de Expedição na linha?** Recomendado: recusa encerrar ou liberar. **Decidido:** Expedição DRAFT
  ligada à linha bloqueia o encerramento e a liberação.
- **P10 — OP perdida: como reconciliar?** Recomendado: um motivo aplicado aos materiais pendentes no mesmo diálogo,
  gravado por material, explícito (a regra atual pede um a um). **Decidido:** OP sem produção exige motivo e
  reconciliação explícita. A forma do diálogo (um motivo para todos os pendentes ou material a material) fica para o
  handoff, dentro de "reconciliação explícita".
- **P11 — custo da OP perdida?** Recomendado: MP real; mão de obra e equipamento padrão ficam 0 (proporcionais à
  produção). **Decidido:** preservar a MP real consumida; não inventar PA.
- **P12 — Pedido com saldo encerrado e o documento de fechamento do faturamento?** Recomendado: não há documento de
  fechamento. **Decidido:** o saldo encerrado do Pedido não fabrica documento de faturamento.

## 12. Pendências PO

- **P5, permissão definitiva (Veridi):** quem encerra OP sem produção — ADMIN + PRODUCTION, QUALITY, contas de chão de
  fábrica (P6 de [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md)).
  Não trava a implementação: o provisório vale.
- **P13 (Veridi):** lote "reprovado depois do apontamento" segue a Qualidade (bloquear + perda) e fica fora daqui; o L4
  vai para o BACKLOG. Não decidido.

## 13. Escopo recomendado — fatias

Pré-requisito do relatório: DOCUMENT-TRANSITION-CONCURRENCY-01 integrada (mesmos arquivos e o mesmo padrão de trava). A
Fatia 1 dela está na `main` desde `ea5188e2`; a Fatia 2 (Pedido, Faturamento, OC, Lote) vem antes na fila viva e toca
os mesmos arquivos do Pedido.

1. **CLOSE-WITH-REASON-PO-01 — OC.** Migration 1. Helper de status; teto do recebimento; DTO; ledger Em compra; Painel e
   atenção; Painel Gerencial; R-10/R-11; CSV e PDF; tela. Tamanho médio. É a preferência do PO e fecha o G5.
2. **CLOSE-WITH-REASON-OP-01 — OP sem produção.** Sem migration. Endpoint próprio com gate; P3a; falta produzir
   terminal = 0; tela. Pequena. Destrava a OP para o saldo. P3b mexe na mesma guarda do cancelamento do Pedido
   (`customer-orders.service.ts:978-985`) e no mesmo diálogo, e vai junto.
3. **CLOSE-WITH-REASON-RESERVATION-01 — Liberar reserva.** Sem migration. Linha e total; substituta; cancelar olha
   linha ativa; DTO e R-14 (L1 e L2). Pequena a média. Base da fatia 4.
4. **CLOSE-WITH-REASON-CO-01 — Pedido.** Migration 2. Encerramento com reserva e entregas; trava das entregas (L7); todas
   as consultas de "a expedir"; BILLED; tela, PDF e Consulta do Cliente. Maior. Depende da 3.

Todas candidatas ao pacote v1.1.0, sem bloquear o corte ([`BACKLOG.md`](../BACKLOG.md), seção da v1.1.0).

## 14. Fora do escopo

- Os laterais, anteriores a este tema, com o destino dado na consolidação de 2026-09-19:
  - **L1.** O DTO da reserva calcula o restante sem olhar `releasedAt` (`customer-orders.service.ts:331-336`); a tela
    mostra "Ativa" mesmo com cabeçalho RELEASED → vai na fatia 3.
  - **L2.** R-14 soma restante de linha e de cabeçalho liberados (`commercial-reports.service.ts:359-374`) → fatia 3.
  - **L3.** R-04 olha só `releasedAt`, não o status da `MaterialReservation` (`production-reports.service.ts:82-84`) →
    BACKLOG, seção A, sem posição.
  - **L4.** "Produzido em espera" conta PA de lote bloqueado ou perdido e trava a OP para o saldo
    (`customer-orders.service.ts:489-492`; `fulfillment-plan.service.ts:544-547`) → BACKLOG, seção A; mesma conta do
    F-1 (PENDING-PRODUCTION-LOT-ATTRIBUTION-01); o lote reprovado depois do apontamento espera P13.
  - **L5.** O CSV da OP mostra "Falta produzir" em OP concluída (`list-exports.ts:532`) → fatia 2 ("falta produzir
    terminal = 0").
  - **L6.** `acceptMaterialVariance` grava sem trava na OP (`production.service.ts:231`) → BACKLOG, seção A, a
    classificar com a concorrência.
  - **L7.** Criar, cancelar e reprogramar entrega não travam o Pedido (`delivery-schedule.service.ts:413-523`) → fatia 4
    (pré-requisito).
  - **L8.** Painel: Pedido com falta produzir e sem OP não gera atenção → DASHBOARD-ORDER-NEXT-ACTION-01 ("saldo sem
    produção", [OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01](OPERATIONAL-HANDOFF-NEXT-ACTIONS-DISCOVERY-01.md)).
- Documento de faturamento para o saldo encerrado (P12).
- Reabrir saldo (P6) e qualquer cascata sobre OP ou OC ligadas (P4).

## 15. Próxima capability

CLOSE-WITH-REASON-PO-01, depois CLOSE-WITH-REASON-OP-01, CLOSE-WITH-REASON-RESERVATION-01 e CLOSE-WITH-REASON-CO-01,
nessa ordem, na fila viva de [`BACKLOG.md`](../BACKLOG.md) — abaixo de permissões, autoria, F-1, concorrência Fatia 2 e
PURCHASE-SUGGESTION-OWNER-SCOPE-01.

## 16. Implementação

**NÃO IMPLEMENTADO.** Nenhuma fatia começou. Mudanças de texto previstas em `PRODUCT_RULES.md` na implementação: o
significado de SHIPPED ("physically shipped", seção de §22-25) e a regra de §22-25 que prende o cancelamento de
`IN_FULFILLMENT` com OP gerada (P3a e P3b).

## 17. Histórico de decisões

- 2026-09-19 — discovery entregue no chat (READ ONLY, `f7ebb771`), `READY_TO_IMPLEMENT = NO` até P1–P4.
- 2026-09-19 — PO responde P1–P12 (PRODUCT-BACKLOG-CONSOLIDATION-01); documento persistido do relatório final da
  sessão. `READY_TO_IMPLEMENT = YES` para as quatro fatias.
- 2026-09-19 — **P3b muda regra vigente.** Antes (`PRODUCT_RULES.md` §22-25): `IN_FULFILLMENT` não cancela enquanto
  existir OP gerada, qualquer que seja o estado dela. Agora: OP COMPLETED — com produção zero ou com produção física —
  não prende o cancelamento comercial; a produção fica e o PA segue disponível sob as regras de qualidade e reserva.
  Motivo: sem isso, o cliente que desiste depois da produção prende o Pedido para sempre. O texto do PRODUCT_RULES muda
  na implementação.
- 2026-09-19 — **P2 muda o significado de SHIPPED.** Antes: toda linha expedida por inteiro. Agora: nada mais a
  expedir, com parte expedida e o resto encerrado, marcado "saldo encerrado". O texto do PRODUCT_RULES muda na
  implementação.
