# MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01 — cadastro mestre: excluir, inativar ou arquivar

## 1. Status

`IMPLEMENTADO` — **D1–D6 decididas pelo PO em 2026-09-17**; **D4 e D5 implementadas** em PRODUCTION-PROFILE-ARCHIVE-01
(§121) e USER-LAST-ADMIN-GUARD-01 (§120), 2026-09-17, e **D1, D2, D3 e D6 na Fatia 1** — MASTER-DATA-HARD-DELETE-01
(§125), 2026-09-18 —, e **D1, D2 e D6 na Fatia 2** — MASTER-DATA-HARD-DELETE-02 (§128), 2026-09-19, sem migration —,
seção 16: as três fatias estão implementadas. Capabilities liberadas na fila viva do
[`BACKLOG.md`](../BACKLOG.md): Fatia 0 — PRODUCTION-PROFILE-ARCHIVE-01 e USER-LAST-ADMIN-GUARD-01; Fatia 1 —
MASTER-DATA-HARD-DELETE-01; Fatia 2 — MASTER-DATA-HARD-DELETE-02.

Discovery READ ONLY de 2026-09-17 sobre `b89bac2f`, entregue no chat e persistido no fechamento sobre `72dea924`. Os dois
deltas foram conferidos e não mudam o mapa: REPORTS-PDF-SUMMARY-01 mexe só na Web e em docs; CUSTOMER-CNPJ-PERSISTED-DATA-01
acrescenta onze colunas anuláveis em `customers`, sem FK nem tabela. As chaves estrangeiras vêm das migrations, lidas com o
parser de `scripts/schema-fk-actions.test.ts`, sem tocar banco: **247 na `main`**, zero divergência entre schema e
migrations; PROD (`release/prod` `8e824e8f`) tem 243 — faltam `…093034` a `…093036`. As linhas de código citadas são as de
`72dea924`; cada fatia reconfere na `main` antes de agir.

Motivo de refazer: MASTER-DATA-LIFECYCLE-DISCOVERY-01 (2026-09-16) cobriu Cliente, Fornecedor, Item e Produto e ficou só
no chat, fora desta pasta. Este cobre os nove cadastros da §114 e os auxiliares, e refaz o mapa de FKs na base atual.

## 2. Objetivo

Uma política única para tirar cadastro mestre de circulação: quando cabe exclusão física, quando só se inativa ou arquiva,
e o que falta de modelo — com a regra por cadastro e as capabilities que a implementam.

## 3. PO baseline

- **Regra do PO** (handoff de 2026-09-17): registro com uso, referência, movimento ou histórico NUNCA é apagado — inativa
  ou arquiva. Exclusão física só para cadastro errado, nunca utilizado, com zero referências.
- §95: Cliente Ativo · Bloqueado · Inativo, com motivo obrigatório e histórico append-only.
- §100: quem inativa e reativa Item, Fornecedor e Produto; 409 na transição repetida; sem motivo nem histórico
  (MASTER-DATA-STATUS-HISTORY-01).
- §110 e §114: duplicado verdadeiro sai por remoção, depois de mover as referências, porque inativar mantém o nome ocupado.
- §107, §108, §112 e §116: inativo não inicia compromisso novo e não some do que já existe.

## 4. Estado atual

**Nenhum cadastro mestre tem exclusão física pela API ou pela tela.** Cliente e Usuário declaram isso no código
(`customers.routes.ts:50`, `users.routes.ts:40`); os demais só não têm rota. Nenhum teste protege essa ausência.

Tirar de circulação acontece por três gestos, cada cadastro com o seu: **Inativar** (`active`) nos cadastros que operam,
**Arquivar** (`archivedAt`) nas bibliotecas e nos anexos, **Anular** no arquivo do Rótulo. Só o Cliente guarda motivo e
histórico da situação.

A exclusão física de cadastro mestre só existe em script: o saneamento de duplicatas (§110, §114 — PLAN/APPLY/VERIFY,
APPLY só em banco local) e o `prod-cleanup.mjs` (reset total antes da carga; nunca executado, `--apply` proibido sem o PO).
Cerca de 167 arquivos de teste apagam cadastro mestre direto pelo Prisma na limpeza, apoiados nos CASCADE.

## 5. Evidências

### Por cadastro

**Cliente** (`customers`)
- Situação: `active` + `blocked`; bloquear, desbloquear, inativar e reativar com motivo; Comercial e ADMIN
  (`CUSTOMER_STATUS_CHANGE_ROLES`). A lista abre em Ativos.
- FKs que chegam: RESTRICT `projects`, `customer_orders`, `receipts`, `lots.ownerCustomerId` · SET NULL
  `products.customerId`, `production_orders.customerId` · CASCADE `customer_status_history`.
- Sem FK: `stock_count_positions.ownerCustomerId`; código e nome copiados em `quote_versions`, `production_orders`,
  `customer_orders`, `billings` e `stock_count_positions`.
- Um DELETE direto apagaria o histórico de situação e desligaria sem aviso o produto private label e a OP do cliente.

**Fornecedor** (`suppliers`)
- Situação: `active`; Compras e ADMIN; inativar limpa o preferencial (§112). Sem motivo, histórico nem autor.
- FKs que chegam: só RESTRICT — `supplier_items`, `purchase_orders`, `receipts`, `lots.supplierId`.
- Sem FK: código e nome copiados em `purchase_orders`.
- O banco já recusa o que tem referência: é o caso mais simples.

**Item** — matéria-prima, embalagem, uso e consumo (`items`)
- Situação: `active`; inativar Compras, Qualidade e ADMIN; reativar Qualidade e ADMIN (§100). Sem motivo, histórico nem
  autor (o Item não tem `createdBy`). `operationallyUsed` (`items.service.ts:97`: OC, recebimento, lote, movimento) trava
  campo estrutural e **não serve** para decidir exclusão — ignora formulação, modelo, amostra, OP e consumo interno.
- FKs que chegam: CASCADE `inventory_movements`, `item_cost_references`, `stock_count_positions` · SET NULL
  `products.finishedProductItemId`, `stock_count_findings` · RESTRICT em 17 (arquivo do rótulo, relação com fornecedor,
  formulação e componente, componente de modelo, OC, recebimento, lote, consumo interno, OP, requisito, as duas reservas,
  consumo, expedição, faturamento, amostra).
- Sem FK: `customer_order_lines.finishedItemId`; `itemCode` copiado em 10 tabelas; Json em `stock_counts.scopeFilters`,
  `industrial_cost_calculations.result`, `production_order_cost_snapshots.breakdown` e `user_preferences.ui`.
- **O CASCADE do ledger existe "só para limpeza de fixture"** (migration `20260819091500`), e `inventory_movements.lotId` é
  opcional: Item sem lote com ajuste manual não tem RESTRICT no caminho, e um DELETE direto apagaria movimento de estoque.

**Item PA** (produto acabado)
- Nasce com o Produto, na mesma transação, quando nenhum PA existente é escolhido (`products.service.ts:340`).

**Produto** (`products`)
- Situação: `active` + `lifecycle` (DEVELOPMENT/APPROVED, que não é exclusão); Comercial e ADMIN; bloqueios da §108. Sem
  motivo, histórico nem autor.
- FKs que chegam: CASCADE `industrial_cost_versions`, `industrial_cost_calculations`, `pricing_versions` · SET NULL
  `projects.productId` · RESTRICT em 9 (anexo, produto do projeto, linha de orçamento, formulação, OP, linha e reserva do
  pedido, expedição, faturamento).
- Sem FK: código e nome copiados em OP, linha do pedido, expedição e faturamento.
- Um DELETE direto apagaria custo e precificação, desligaria o Projeto e deixaria o PA órfão com o nome ocupado.

**Recurso industrial** (`industrial_resources` — mão de obra, equipamento, energia)
- Situação: `active` pelo PATCH, só ADMIN (`industrial-resources.service.ts:310`); guarda o último autor; sem motivo nem
  histórico. Inativo impede ativar a estrutura de custo que o usa (409 `inactive_resource`) e entrar em etapa de roteiro.
- FKs que chegam: CASCADE `industrial_resource_rates` (tarifa imutável) · RESTRICT no uso da estrutura de custo, do modelo
  de custo e da etapa do roteiro · SET NULL `energyResourceId` na estrutura e no modelo de custo.
- Sem FK: ids do recurso no Json `steps` de `production_order_planning_snapshots` e `production_order_schedules`
  (proveniência sem FK por decisão, §89).
- Um DELETE direto apagaria tarifas históricas e tiraria a energia das estruturas de custo sem aviso.

**Modelos** — de formulação, de custo industrial e de política de preço
- Situação: `archivedAt` + `archivedBy` (nome, sem FK); Arquivar e Desarquivar pela mesma rota
  (`formulation-templates.service.ts:487`, `cost-templates.service.ts:302`, `pricing-policies.service.ts:295`); formulação
  e custo com ADMIN e Produção, política com ADMIN e Comercial; arquivado não se aplica (409). Versões
  DRAFT/ACTIVE/ARCHIVED. Nascem com a V1 DRAFT.
- FKs que chegam: CASCADE versões → componentes, recursos, custos adicionais e faixas · SET NULL na proveniência —
  `formulation_versions.originTemplateVersionId`, `industrial_cost_versions.originCostTemplateVersionId`,
  `pricing_versions.originPricingPolicyVersionId` (o código de origem copiado fica).
- Um DELETE direto apagaria a proveniência das formulações, custos e precificações feitas a partir dele.

**Perfil de Produção** (`production_profiles`, `PPR-`)
- Situação: `archivedAt`/`archivedBy` existem e a lista esconde o arquivado (`production-profiles.service.ts:233`), mas
  **não há rota nem tela para arquivar**. Nasce com a V1 DRAFT.
- FKs que chegam: CASCADE versões → etapas → recursos da etapa · RESTRICT `products.defaultProductionProfileVersionId`
  (aponta a VERSÃO, não o perfil).
- Sem FK: `production_order_planning_snapshots.sourceProfileId` e `sourceVersionId`, com código e nome copiados.
- A criação da OP aplica sozinha o padrão do Produto (`aplicarRoteiroPadraoAutomatico`,
  `production-orders/planning-snapshot.ts`): padrão fora de ACTIVE deixa a OP sem cópia, como pendência e sem erro.

**Relação Item × Fornecedor** (`supplier_items`)
- Situação: `active` pelo PATCH (Compras e ADMIN); homologação com histórico append-only. Criar grava um evento
  `null → situação` (`supplier-items.service.ts:610`).
- FKs que chegam: CASCADE no histórico de homologação e nas ofertas; nenhuma outra tabela aponta para a relação.

**Usuário**
- Situação: `active` pelo PATCH, só ADMIN; inativar revoga as sessões. Nunca excluído.
- Nada impede inativar ou rebaixar o último ADMIN ativo, nem a si mesmo (`users.service.ts:87`). A única saída é
  `pnpm user:bootstrap-admin` no servidor.

**Auxiliares**
- Unidade de medida: catálogo fechado, só `GET /units`.
- Calendário de Produção: registro único (`CHECK id = 'GLOBAL'`); a exceção já tem exclusão física, e a agenda gravada não
  muda com ela.
- Oferta do fornecedor, referência de custo do Item e tarifa do recurso: imutáveis; corrigir é registrar outra com vigência.
- Anexo: Arquivar (Qualidade e ADMIN), sem desarquivar. Arquivo do Rótulo: Anular com motivo e Restaurar como versão nova
  (§103). Documento controlado: revisão ativa ou histórica.
- Centro de custo: não existe modelo; o destino do consumo interno é texto livre (INTERNAL-CONSUMPTION-COST-CENTER-01).

### Exclusões físicas que existem hoje (nenhuma de cadastro mestre)

- Rotas: `DELETE /quote-lines/:id`, `/project-products/:id`, `/industrial-cost-lines/:id`,
  `/industrial-cost-resource-usages/:id`, `/pricing-tiers/:id`, `/industrial-cost-calculations/:id`,
  `/production-calendar/exceptions/:id` e `/production-orders/:id/schedule` — linhas de rascunho e configuração.
- Serviços: regravação de linhas de rascunho (OC, Pedido, Expedição, componentes, etapas, requisitos da OP).
- Scripts: `item-duplicate-sanitization.ts` e `master-data-duplicate-sanitization.ts` (`DELETE FROM <cadastro>` depois de
  mover as referências) e `prod-cleanup.mjs`.

### Precedentes para reusar

- `lerCatalogo` e `contarReferencias` (`scripts/maintenance/master-data-duplicate-sanitization.ts:221`): FKs reais do
  `pg_constraint` com a ação, colunas de id sem FK, código copiado e Json.
- `discardIndustrialCostCalculation` (`industrial-cost-calculation/snapshot.service.ts:194`): descarta o cálculo que ninguém
  cita e responde 409 `calculation_in_use` quando citado — a regra do PO em miniatura.
- `pg_stat_xact_user_tables` no APPLY do saneamento: prova que a transação não tocou tabela fora do previsto.
- `aplicarRoteiroPadraoAutomatico`: o molde da D4 na criação da OP.

## 6. Findings

- F1 — Nenhuma exclusão de cadastro mestre pela API ou pela tela, e nenhum teste que proteja isso.
- F2 — O banco não protege de forma uniforme: Fornecedor é todo RESTRICT; Item, Produto, Cliente, Recurso e Modelos têm
  CASCADE ou SET NULL que apagam ledger, custo, tarifa e histórico, ou desfazem vínculo sem aviso.
- F3 — Referências sem FK (`finishedItemId`, `ownerCustomerId`, proveniência do roteiro, Json) escapam da FK e do catálogo
  por sufixo do saneamento, que também não vê `sourceProfileId` nem referência às VERSÕES de um agregado.
- F4 — Inativar ou arquivar cadastro errado mantém o nome ocupado: `exigirNomeDeCadastroLivre` compara com todos, sem
  filtro de situação (`lib/nome-de-cadastro-mestre.ts:107`). Hoje, só o script de saneamento remove.
- F5 — Fora do Cliente, a situação não guarda motivo, histórico nem autor; Item, Fornecedor e Produto não têm nem
  `createdBy`.
- F6 — O Perfil de Produção não pode ser arquivado, embora a coluna exista.
- F7 — O último ADMIN ativo pode ser inativado ou rebaixado, inclusive por ele mesmo.
- F8 — Criar Produto, Modelo, Perfil e relação Item × Fornecedor gera filho no mesmo ato (PA, V1 DRAFT, evento de
  nascimento): sem exceção para esses filhos, nenhum desses cadastros jamais seria excluível.
- F9 (menores) — anexo arquivado não volta; o diálogo "Inativar produto?" não cita os bloqueios da §108; o
  [`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md) fala em "197 FKs" (hoje 247).

## 7. Gaps

| # | Gap | Severidade | Onde fecha |
|---|---|---|---|
| G1 | Cadastro errado não tem saída: nome ocupado, só script remove | HIGH | Fatias 1 e 2 |
| G2 | Exclusão sem proteção do banco (CASCADE, SET NULL) | CRITICAL, latente | Guarda na aplicação (D6) |
| G3 | Referências sem FK fora do catálogo | MEDIUM | Lista explícita por agregado (D2, D6) |
| G4 | Perfil de Produção sem Arquivar | MEDIUM | Fatia 0 (D4) |
| G5 | Zero ADMIN ativo é possível | HIGH | Fatia 0 (D5) |
| G6 | Situação sem motivo, histórico nem autor fora do Cliente | MEDIUM | MASTER-DATA-STATUS-HISTORY-01, fora deste escopo |
| G7 | Nenhum teste protege "sem exclusão física" | LOW | Teste de contrato na Fatia 1 |

## 8. Riscos

- Guarda incompleta é perda silenciosa (CASCADE) ou vínculo desfeito (SET NULL). Mitigação: catálogo explícito, falha
  fechada e `pg_stat_xact_user_tables` desfazendo a transação em efeito inesperado.
- Corrida com referência sem FK: quem grava não trava o cadastro, e o `FOR UPDATE` só segura as FKs (o escritor de FK
  espera e falha). Risco baixo hoje — o PA sai com o Produto e `ownerCustomerId` vem de lote, que tem FK —, mas vira teste
  da fatia.
- Buraco no código de negócio (um MP-000512 deixa de existir): aceito; o saneamento já deixa.
- Carga inicial reaplicada recriaria o excluído: baixo, a carga não se reaplica.
- Endurecer FK agora quebraria a limpeza de cerca de 167 arquivos de teste e a ordem do `prod-cleanup` — por isso a D6.

## 9. Alternativas consideradas

- Endurecer as FKs (RESTRICT) × guarda na aplicação: a guarda protege também o que não tem FK (Json, id solto, código
  copiado); endurecer fica para W6, que não começa agora (D6).
- Inativar o cadastro errado × excluir: inativar mantém o nome ocupado e o lixo no catálogo — a mesma razão da §114.
- Quem exclui: ADMIN × o perfil que cria o cadastro (D1).
- Rastro: tabela append-only × log do servidor, que não se consulta e não sobrevive a redeploy (D3).
- Catálogo por sufixo (o do saneamento) × lista explícita por agregado conferida contra o `pg_constraint`: o sufixo perde
  `sourceProfileId` e as referências às versões.

## 10. Recomendação

Adotada inteira nas D1–D6. **Matriz decidida:**

| Cadastro | Exclusão física | Inativar | Arquivar | Falta modelo |
|---|---|---|---|---|
| Cliente | Sim, sem uso, referência nem histórico — conta SET NULL e o histórico de situação | Existe (motivo + histórico) | É o Inativar (a §95 chama de arquivado) | — |
| Fornecedor | Sim, sem uso nem referência (o banco já é RESTRICT) | Existe, sem motivo | — | Motivo, histórico, autor |
| Item MP/ME/Uso e consumo | Sim, só pela guarda da aplicação (CASCADE no ledger) | Existe, sem motivo | — | Motivo, histórico, autor |
| Item PA | Só junto com o Produto, sem uso próprio | Existe | — | — |
| Produto | Sim, sem uso, levando o PA nascido junto | Existe, sem motivo | — | Motivo, histórico, autor |
| Recurso industrial | Sim, sem tarifa, uso nem proveniência | Existe (PATCH, ADMIN) | — | Motivo, histórico |
| Modelos (formulação, custo, política) | Sim, com só a V1 técnica, nunca ativada nem aplicada | — | Existe, sem motivo | Motivo e histórico do arquivar (opcional) |
| Perfil de Produção | Sim, com só a V1 técnica, nunca padrão de Produto nem copiada para OP | — | **Falta a ação** (a coluna existe) | — |
| Relação Item × Fornecedor | Sim, com só o evento de nascimento, sem oferta nem preferencial | Existe (PATCH) | — | — |
| Usuário | Nunca | Existe; guarda do último ADMIN (D5) | — | — |
| Unidade de medida, Calendário de Produção | Não se aplica (catálogo fechado; registro único) | — | — | — |
| Oferta, referência de custo, tarifa | Não (imutáveis; corrige com vigência nova) | — | — | Anular (futuro, se pedido) |
| Anexo, arquivo do Rótulo, documento controlado | Não | — | Existe (arquivar, anular, revisão) | Desarquivar anexo (opcional) |
| Centro de custo | — | — | — | Não existe (texto livre) |

**Regras** (formato do `/erp-functional-reviewer`):
- **EXISTE HOJE** — §95 (Cliente: motivo, histórico, sem exclusão física); §100 (situação de Item, Fornecedor e Produto);
  §110 e §114 (duplicado sai por remoção, via script); "Usuário nunca é excluído" (`users.routes.ts:40`); versão nunca é
  apagada (§89, §96); exceção do calendário excluível.
- **DECIDIDO** (D1–D6, 2026-09-17) — seção 11.
- **FUTURO** — MASTER-DATA-STATUS-HISTORY-01; W6; exclusão por LGPD; MASTER-DATA-NAME-UNIQUENESS-01.

**Cenários adversariais** (Resolve? = com D1–D6 implementadas):

| Cenário | Resolve? | Severidade | Observação |
|---|---|---|---|
| Item criado com tipo errado e nome certo, nunca usado | YES | HIGH | Hoje o nome fica ocupado. Fatia 2 |
| Modelo vazio criado por engano (o "X" do DEV) | YES | MEDIUM | Hoje só arquiva. Fatia 1 |
| Perfil criado errado | YES | MEDIUM | Hoje nem arquiva. Fatias 0 e 1 |
| Excluir Item sem lote com ajuste manual | YES | CRITICAL | A guarda conta o CASCADE; `pg_stat_xact_user_tables` desfaz se disparar |
| Excluir Produto ligado a Projeto, ou Cliente dono de produto private label | YES | HIGH | SET NULL conta como referência |
| Excluir Recurso com tarifa | YES | HIGH | Tarifa é histórico (D2) |
| Excluir Modelo já aplicado | YES | MEDIUM | Proveniência conta (D2) |
| Cliente inativado por engano e depois levado à exclusão | YES | MEDIUM | O evento de situação é histórico real: ele fica inativo |
| Excluir Fornecedor enquanto outra sessão cria OC para ele | YES | MEDIUM | `FOR UPDATE` + RESTRICT: a OC espera e falha |
| Referência sem FK gravada durante a exclusão | PARTIAL | MEDIUM | Quem grava não trava o cadastro; teste da fatia |
| Dois ADMIN inativando um ao outro ao mesmo tempo | YES | HIGH | Contagem e gravação na mesma transação, sob trava (D5) |
| ADMIN inativa a si mesmo ou tira de si o papel | YES | HIGH | Recusado (D5) |
| Excluir duas vezes / clique duplo | YES | LOW | A segunda recebe 404, sem efeito |
| Carga inicial reaplicada recria o excluído | PARTIAL | LOW | A carga não se reaplica |
| Anexo arquivado por engano | NO | LOW | Fora do escopo |

**READY_TO_IMPLEMENT: YES** — D1–D6 decidem permissão, bloqueio, rastro e FKs; nenhuma decisão aberta toca
comportamento destrutivo. Os pontos de leitura da seção 12 valem como escritos, pela falha fechada, até o PO dizer o
contrário.

## 11. Decisões PO

| # | Decisão | Situação |
|---|---|---|
| D1 | Exclusão física de cadastro mestre: **só ADMIN**; não herda a permissão de criar ou editar o cadastro | **Decidida** (2026-09-17) |
| D2 | **Qualquer uso, referência ou histórico real bloqueia**, contando rascunho já trabalhado, histórico, tarifa, oferta, referência de custo, proveniência, Json, código ou id copiado, referência ao cadastro e às versões e filhos. Exceção: filho técnico que nasce obrigatoriamente no MESMO ato e nunca foi usado não conta isoladamente — a V1 inicial ainda DRAFT e nunca aplicada nem ativada; o PA criado junto do Produto e sem uso; o evento inicial obrigatório da relação Item × Fornecedor, sem oferta nem histórico adicional. **Falha fechada**. Esclarecimento do PO (2026-09-18): histórico de CNPJ nascido na mesma criação do Cliente é filho técnico; histórico posterior é uso real — e o nascido na criação só sai junto com prova estrutural de nascimento | **Decidida** (2026-09-17) |
| D3 | **Rastro da exclusão**: tabela append-only criada na Fatia 1 (migration aditiva) com, no mínimo, tipo da entidade, id original, código, nome, motivo obrigatório, usuário executor, data/hora e o retrato mínimo necessário para auditoria. O retrato não guarda dado pessoal ou de contato que não seja necessário para provar a exclusão, e nunca segredo, senha, token ou credencial. Exclusão motivada por LGPD é outra política | **Decidida** (2026-09-17) |
| D4 | **PRODUCTION-PROFILE-ARCHIVE-01**: Arquivar e Desarquivar o Perfil de Produção, com ADMIN e Produção, sem migration; o histórico existente segue consultável; arquivado não entra em compromisso novo | **Decidida** (2026-09-17) |
| D5 | **USER-LAST-ADMIN-GUARD-01**: nunca zero ADMIN ativo — recusar a inativação e o rebaixamento do último ADMIN ativo; ninguém inativa a si mesmo nem retira de si o papel ADMIN; havendo necessidade legítima, outro ADMIN executa. Sem migration | **Decidida** (2026-09-17) |
| D6 | **FKs mantidas**: nada muda em CASCADE, SET NULL ou RESTRICT nesta iniciativa. A segurança da exclusão é catálogo explícito de referências, falha fechada, prévia `deletion-check`, transação, `FOR UPDATE`, recontagem e `pg_stat_xact_user_tables`, com rollback em efeito inesperado. W6 não começa agora | **Decidida** (2026-09-17) |

## 12. Pendências PO

Nenhuma bloqueante. Pontos de leitura que os handoffs podem confirmar — até lá valem como escritos, pela falha fechada:

1. **Conteúdo lançado na V1 técnica** (componente, recurso, faixa, premissa) é "rascunho já trabalhado" e bloqueia. A
   exceção da D2 cobre a V1 no estado em que a criação a deixou; sem prova de que está intocada, bloqueia.
2. **Histórico de situação do Cliente** é histórico real: cliente já bloqueado ou inativado não sai por exclusão física.
3. **Padrão do Produto apontando Perfil arquivado** (D4): o apontamento fica e a tela avisa; a aplicação automática na
   criação da OP trata o perfil arquivado como padrão fora de ACTIVE — OP sem cópia, pendência sem erro.
4. **Tabela do rastro no `prod-cleanup`**: model novo entra numa lista da classificação no mesmo commit, e classificar é
   decisão do PO; recomendado ALVO, como `CustomerStatusHistory`.
5. **Referência de custo gravada na criação do Item** (MASTER-DATA-HARD-DELETE-02): bloqueia a exclusão física — a D2
   cita referência de custo, e a referência inicial é opcional, não filho técnico obrigatório do mesmo ato.
6. **O PA "nascido com o Produto"** (MASTER-DATA-HARD-DELETE-02): provado pela chave 1:1 do Produto
   (`finishedProductItemId`, única) e por nenhum uso próprio. O modelo não guarda marca de nascimento — PA vinculado por
   importação, ou trocado na edição do Produto, não se distingue do nascido junto — e criá-la exigiria migration. Sem uso
   nenhum, o PA vinculado depois também sai com o Produto.

## 13. Escopo recomendado

| Fatia | Capability | Decisões | Migration |
|---|---|---|---|
| 0 | PRODUCTION-PROFILE-ARCHIVE-01 | D4 | Não |
| 0 | USER-LAST-ADMIN-GUARD-01 | D5 | Não |
| 1 | MASTER-DATA-HARD-DELETE-01 — infraestrutura, Fornecedor, Cliente, os três Modelos e o Perfil de Produção | D1, D2, D3, D6 | Sim, uma aditiva: a tabela do rastro |
| 2 | MASTER-DATA-HARD-DELETE-02 — Item, Produto + PA e Recurso industrial | D1, D2, D6 | Não (usa o rastro da Fatia 1) |

**PRODUCTION-PROFILE-ARCHIVE-01.** Portas conhecidas (a fatia reconfere): arquivar e desarquivar, com ADMIN e Produção e
403 antes do corpo; lista padrão sem arquivado e filtro para vê-los, como nos Modelos; seletores do Produto e da OP sem
arquivado; recusa em `PUT /products/:productId/production-profile` e em `POST /production-orders/:id/production-profile`;
aplicação automática tratando perfil arquivado como padrão fora de ACTIVE; detalhe e cópias nas OPs seguem consultáveis.

**USER-LAST-ADMIN-GUARD-01.** No `PATCH /users/:id`: recusa, com frase de negócio, a inativação e a troca de papel que
deixariam zero ADMIN ativo, e o próprio usuário inativando a si ou saindo de ADMIN. Contagem e gravação correm na mesma
transação, com as linhas de ADMIN ativo travadas, para dois ADMIN simultâneos não zerarem a lista. Reset de senha e
`user:bootstrap-admin` intocados.

**MASTER-DATA-HARD-DELETE-01.**
- Infraestrutura compartilhada: por cadastro, o agregado (raiz e filhos que saem junto) e a lista EXPLÍCITA de referências
  — FK de qualquer ação, id sem FK, Json e código copiado — ao registro e às suas versões e filhos, conferida contra o
  `pg_constraint` a cada execução: tabela que aponta para o agregado e não está na lista bloqueia (falha fechada).
- Prévia `deletion-check`: pode ou não, e por quê, tabela por tabela.
- Exclusão: só ADMIN, 403 antes do corpo e da existência; motivo obrigatório; transação com `FOR UPDATE` no agregado,
  recontagem, gravação do rastro, DELETE, conferência em `pg_stat_xact_user_tables` e rollback em efeito inesperado; 409
  com a lista de referências quando bloqueado.
- Rastro (D3): tabela append-only, sem rota de edição nem exclusão; retrato por lista branca de campos, por cadastro (por
  exemplo código, nome ou razão social, identificador fiscal, situação e filhos removidos junto) — sem contato, endereço,
  observação ou segredo.
- Web: "Excluir" só para ADMIN e só quando a prévia libera; senão, o motivo e o caminho Inativar/Arquivar.
- Testes a proteger: CASCADE e SET NULL nunca disparam; o 409 lista cada referência; 403 antes do corpo; corrida com OC;
  nome liberado para recriar; o retrato não leva campo fora da lista; teste de contrato — nenhuma rota de exclusão física de
  cadastro mestre sem a guarda.
- O Perfil de Produção depende da Fatia 0 para oferecer o Arquivar quando a exclusão é recusada.

**MASTER-DATA-HARD-DELETE-02.** Item, Produto + PA e Recurso sobre a mesma infraestrutura, com os adversariais dos
CASCADE: movimento de estoque de Item sem lote, referência de custo, contagem, custo e precificação do Produto, tarifa do
Recurso. O PA sai só junto do Produto e só sem uso próprio; Item PA nunca é excluído sozinho.

**Sem migration × com schema.** Só a tabela do rastro (Fatia 1) é schema. Todo o resto — guarda, prévia, exclusão, Web,
arquivar do Perfil e guarda do último ADMIN — cabe no modelo atual.

## 14. Fora do escopo

- Endurecer FK (W6) — D6.
- MASTER-DATA-STATUS-HISTORY-01 (motivo e histórico do Inativar/Reativar) segue FUTURO; ao abrir, vale estender a
  Recurso, Modelos, Perfil e Usuário.
- Exclusão por LGPD (outra política); exclusão de Usuário (nunca) e de Unidade de medida (catálogo fechado).
- Anular oferta, tarifa ou referência de custo; desarquivar anexo; Centro de custo (INTERNAL-CONSUMPTION-COST-CENTER-01);
  lista abrindo em Ativos para Item, Fornecedor, Produto e Recurso; descartar rascunho de versão; `prod-cleanup`.

## 15. Próxima capability

Fatia 0 — PRODUCTION-PROFILE-ARCHIVE-01 e USER-LAST-ADMIN-GUARD-01, independentes entre si. Depois
MASTER-DATA-HARD-DELETE-01 e, sobre ela, MASTER-DATA-HARD-DELETE-02.

## 16. Implementação

- **Fatia 0, D5 — USER-LAST-ADMIN-GUARD-01** (2026-09-17, [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §120), na `main` e
  fora de PROD, sem migration: `PATCH /users/:id` recusa inativar ou rebaixar o último ADMIN ativo (409
  `last_active_admin`) e recusa o usuário da sessão inativando a si mesmo (`self_deactivation`) ou retirando de si o
  perfil Administrador (`self_demotion`), mesmo havendo outro ADMIN. A edição corre numa transação que começa travando
  as linhas de ADMIN ativo (`FOR NO KEY UPDATE`, ordem de id), como a seção 13 pedia, e a revogação das sessões do
  inativado entrou nela. Reset de senha e `user:bootstrap-admin` intocados.
- **Fatia 0, D4 — PRODUCTION-PROFILE-ARCHIVE-01** (2026-09-17, [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §121), na `main`
  e fora de PROD, sem migration: `POST /production-profiles/:id/archive` (`{ archived }`, como nos Modelos), com ADMIN e
  Produção e 409 na transição repetida; arquivado fora da lista padrão e dos seletores; `compatibilidadeDoRoteiro` ganhou
  `PERFIL_ARQUIVADO`, e a autoridade recusa com 409 `profile_archived` o padrão novo de Produto e toda aplicação à OP. O
  ponto de leitura 3 da seção 12 foi confirmado pelo PO no handoff: o padrão do Produto em perfil arquivado fica, com
  aviso, e a aplicação automática o trata como fora de ACTIVE — a OP nova nasce sem cópia, sem troca de roteiro. Versões
  e cópias nas OPs intocadas.
- **Fatia 1 — MASTER-DATA-HARD-DELETE-01** (2026-09-18, [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §125), na `main` e
  fora de PROD, com a única migration da iniciativa (`20260925093038_master_data_deletion_history`, aditiva; o enum do
  rastro já reserva Item, Produto e Recurso, e a Fatia 2 segue sem migration): Fornecedor,
  Cliente, os três Modelos e o Perfil de Produção. `GET <cadastro>/:id/deletion-check` e `DELETE <cadastro>/:id` com
  motivo, só ADMIN (403 antes do corpo e da existência); catálogo explícito por agregado — raiz, internas, FK de qualquer
  ação, id sem FK, código e nome copiados, e as referências às VERSÕES —, conferido contra o `pg_constraint` a cada
  execução, com redes por sufixo e varredura de toda coluna JSON (o F3 da seção 6 fechou aqui); transação com `FOR UPDATE`, recontagem, rastro, DELETE e `pg_stat_xact_user_tables`, com rollback em efeito
  inesperado; rastro append-only com retrato por lista branca, ALVO no `prod-cleanup` (ponto 4 da seção 12 decidido pelo
  PO). Os pontos 1 e 2 da seção 12 valeram como escritos. **Registro do CNPJ da criação** (§122, posterior a este
  documento): o PO decidiu em 2026-09-18 que ele é filho técnico e que registro posterior é uso real, com prova
  estrutural de nascimento. A prova veio com CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01 (2026-09-18, segunda migration
  da iniciativa, `20260925093040`, aditiva): a coluna `createdWithCustomerId`, gravada só pela criação do Cliente; o
  histórico virou tabela interna do Cliente, e só o registro marcado com o próprio Cliente, e um só, sai junto — o
  resto bloqueia, e o saneamento nunca move a marca (§114). O Perfil recusado oferece o Arquivar da Fatia 0. **Fatia 1
  fechada.**
- **Fatia 2 — MASTER-DATA-HARD-DELETE-02** (2026-09-19, [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §128), na `main` e
  fora de PROD, **sem migration** (o enum do rastro já reservava os três tipos), código `f3b78060`: Item (MP, ME, PA e
  UC), Produto + o Item de produto acabado e Recurso industrial, com os adversariais da seção 13 — movimento de estoque de
  Item sem lote, referência de custo, contagem, custo e precificação do Produto, tarifa do Recurso — todos bloqueando.
  O PA entrou como **vinculado** do Produto: a raiz o aponta (`finishedProductItemId`, 1:1), e ele é lido e travado
  depois dela, julgado pelo catálogo do Item inteiro (a linha do Produto não conta como uso), apagado depois dela e
  conferido no efeito real, num rastro só; qualquer uso dele bloqueia o Produto, e ele nunca sai sozinho pela rota do
  Item. Produto nascido de Projeto bloqueia pela origem. Os pontos de leitura 5 e 6 da seção 12 foram aplicados nesta
  fatia. **As três fatias estão implementadas.**

## 17. Histórico de decisões

- 2026-09-17 — discovery entregue no chat sobre `b89bac2f` (READY_TO_IMPLEMENT = NO até D1–D3).
- 2026-09-17 — reconferido contra `66b1023c` (REPORTS-PDF-SUMMARY-01) e `72dea924` (CUSTOMER-CNPJ-PERSISTED-DATA-01): mapa
  inalterado.
- 2026-09-17 — D1–D6 decididas pelo PO; documento persistido no fechamento, sem código nem migration; Fatias 0, 1 e 2
  liberadas na fila viva.
- 2026-09-17 — D5 implementada por USER-LAST-ADMIN-GUARD-01 (§120), sem migration.
- 2026-09-17 — D4 implementada por PRODUCTION-PROFILE-ARCHIVE-01 (§121), sem migration; o handoff confirmou o ponto de
  leitura 3 da seção 12.
- 2026-09-18 — Fatia 1 implementada por MASTER-DATA-HARD-DELETE-01 (§125), com a migration aditiva do rastro; o PO
  classificou o rastro como ALVO do `prod-cleanup`; leitura aplicada sobre o registro do CNPJ da criação do Cliente
  (seção 16).
- 2026-09-18 — ajuste final: o PO decidiu o registro do CNPJ da criação (filho técnico, só com prova estrutural); o
  modelo não prova, a regra por carimbo saiu e todo registro do CNPJ bloqueia até a marca proposta ser aprovada
  (MASTER-DATA-HARD-DELETE-CNPJ-BIRTH-01).
- 2026-09-18 — marca aprovada e implementada por CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01 (§125 e §114, migration
  aditiva `20260925093040`, sem FK, sem default e sem backfill): o registro da criação marcado sai junto, o resto
  bloqueia, e o MERGE do saneamento move `customerId` e nunca a marca. MASTER-DATA-HARD-DELETE-01 fechada de vez.
- 2026-09-19 — Fatia 2 implementada por MASTER-DATA-HARD-DELETE-02 (§128), sem migration: Item, Produto + PA (o PA como
  vinculado do Produto) e Recurso industrial; pontos de leitura 5 e 6 da seção 12 aplicados. Status do discovery passou a
  `IMPLEMENTADO`.
