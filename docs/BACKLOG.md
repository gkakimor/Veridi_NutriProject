# Backlog

O que está **aberto**. Nada mais.

Fechado não fica aqui: regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md), estado em
[`PROJECT_STATE.md`](PROJECT_STATE.md), discovery em [`discovery/`](discovery/README.md), onde cada regra é
protegida em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md) e o que já saiu deste arquivo em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md). Escopo futuro vive só em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) e não entra aqui sem decisão explícita do PO.

**Base:** `main` declarada estável em `0d81aae` (MAIN-STABILITY-FAST-GATE-01, 2026-09-15). PROD em
`release/prod` = `5b7c1a3`, tag `homologacao-veridi-2026-09-16-r1` (HOMOLOGATION-RELEASE-RAILWAY-01,
[`RELEASES.md`](RELEASES.md)). As 2 falhas conhecidas da suíte web completa, que existiam em `3159180` e
`5b7c1a3`, fecharam na `main` em 2026-09-16, fora de PROD (WEB-SUITE-PREEXISTING-FAILURES-01: 3.657 testes, 0
falhas; entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A). Reconciliado com o estado real em 2026-09-15
(BACKLOG-RECONCILIATION-01). Zero CRITICAL,
zero BLOCKER. O MVP foi entregue; o que está aqui é evolução do produto.

---

## Fila viva — a ordem, num lugar só

| Ordem | Prioridade | Item | Estado | Próxima ação | Dependência |
|---|---|---|---|---|---|
| 0 | P0 | ~~**HOMOLOGATION-RELEASE-RAILWAY-01**~~ — publicar o estado aprovado para a homologação da Veridi, sobre os dados existentes | **FECHADO em 2026-09-16** · `release/prod` `2400def` → `3159180` → `5b7c1a3`, tag `homologacao-veridi-2026-09-16-r1` · seis migrations aditivas · dois backups com `RESTAURÁVEL: YES` · dados preservados · smoke verde · sem reset, carga, importação ou restore · o achado do PO (Fornecimento coberto na base fixa) foi corrigido e publicado na mesma rodada | — (registro em [`RELEASES.md`](RELEASES.md)) | — |
| 1 | P0 | **FORMULATION-WORKBENCH-01** — Formulação como bancada interativa (forma × apresentação, física por dose e por cápsula, composição × embalagem) | **EM HOMOLOGAÇÃO** · motor e migration aditiva `20260925093028` entregues em 2026-09-15 · ajustes de UX da homologação entregues em 2026-09-15 (pureza e reserva de produção como colunas, painel de ajustes fora da Formulação, forma restrita a Pó/Cápsula, resumo de premissas no topo) · refinamento final de UX entregue em 2026-09-15 (rótulos Pureza (%) e Reserva de matéria-prima (%), premissa global Perda prevista de produção (%) com Rendimento esperado derivado, quantidade bruta no custo estimado interno sem tocar quantidade comercial, grade modernizada, Apresentação comercial condicionada à Forma, explicações em ⓘ) · migration aditiva `20260925093029` · **publicada em PROD em 2026-09-16** (HOMOLOGATION-RELEASE-RAILWAY-01); o achado da homologação em PROD — o seletor de Fornecimento coberto pela Reserva na receita por base fixa, na Formulação e no Modelo — foi corrigido em `5b7c1a3` sem mudar largura de coluna | Avaliação visual do PO nos dois produtos de homologação do `veridi_dev` e em PROD; o fechamento depende de aprovação explícita | — |
| 1b | P1 | ~~**FORMULATION-TECHNICAL-SHEET-PDF-01**~~ — Ficha Técnica do Produto (Formulação) em PDF real | **FECHADO em 2026-09-15** · ação "Ficha técnica (PDF)" no cabeçalho da versão, documento sobre a fundação `apps/web/src/pdf`, read model neutro reaproveitável pelo Modelo · **sem migration** · absorve FORMULATION-PRINT-ADJUSTMENTS-01 no que toca à Formulação | — (detalhe em [`PROJECT_STATE.md`](PROJECT_STATE.md)) | — |
| 2 | P0 | ~~**FORMULATION-TEMPLATE-WORKBENCH-01**~~ — levar a bancada para o Modelo de Formulação (catálogo, aplicação e promoção de Formulação para Modelo) | **FECHADO em 2026-09-16** (`FORMULATION_TEMPLATE_WORKBENCH_CLOSED = YES`), pronto para a homologação com a Veridi · fatia 1: premissas técnicas no Modelo (migration aditiva `20260925093031`) · fatia 2: bancada compartilhada e barra fixa · fatia 3: ativação do Modelo relê o cadastro do Item, `componentIssues` no Modelo, pré-checagem ao aplicar com rascunho gerado mesmo com pendência (D-6), salvar como Modelo numa escrita só, diff das premissas e da ordem, seletor só com elegíveis e item histórico marcado "Inativo", nomenclatura MODELO em toda tela (absorve NAV-TEMPLATE-WORDING-01) · fatias 2 e 3 **sem migration** | — (regras em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §96–§97, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 2b | P1 | ~~**FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01**~~ — Ficha Técnica do Modelo de Formulação em PDF real | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · mesmo documento da ficha do Produto sobre read model neutro (moldura por fonte, corpo técnico compartilhado), adaptador do Modelo com os derivados do motor de `@veridi/shared` · "Matriz de biblioteca — não é documento de Produto", Rascunho/Ativo/Arquivado, legado sem forma · ação no cabeçalho e no histórico · **sem migration** · ficha do Produto com texto idêntico | Publicação quando o PO decidir (detalhe em [`PROJECT_STATE.md`](PROJECT_STATE.md)) | — |
| 3 | P1 | ~~**BILLED-VALUE-CANONICAL-01**~~ — "Valor faturado" do Painel, R-15 e R-14 igual ao valor do documento | **FECHADO em 2026-09-15** · D1 decidida pelo PO: `Billing.totalAmount` · sem migration | — (entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 4 | P1 | **E2E-BASELINE-REDESIGN-WAVE-04** — grupo C das E2E com massa própria | Discovery `EM_ANALISE`; P1 e a espera da 4E resolvidas pelo estado posterior | PO fecha P2–P8 ([abaixo](#wave-4--decisões-ainda-reais)); 4A pode começar | — |
| 5 | P1 | **INVENTORY-PHYSICAL-COUNT-01** — Inventário Físico em sessões de inventário | Discovery `DECIDIDO` · **Fatia 1 (domínio e API) entregue em 2026-09-15** · **Fatia 2A (telas até Em revisão: lista, novo com prévia, detalhe, contagem no desktop e em 390px, fila local, conflito, posições, ocorrências, cancelar, concluir a primeira contagem) entregue em 2026-09-16** · **Fatia 2B (revisão com recortes e seleção por id, recontagem, Ajustar/Não ajustar com confirmação de movimentação e movimentos da posição, encerramento com a consequência por unidade e recusa por posição, Contagem rápida pela prévia com retenção antes do saldo, aba Contagens rápidas, `INV-` em Movimentações, filtros de local, situação e validade) entregue em 2026-09-16** · na `main` e fora de PROD · sem migration · o ciclo pela tela está completo (contar → revisar → recontar → decidir → encerrar → ajustes) | Fatia 3 — FO-01 de sessão e CSV ([discovery](discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md)); sobras da 2B e o achado da confirmação na [lista](#inventário-físico--status) | — |
| 6 | P1 | ~~Decisões de **FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01** → MANAGEMENT-DASHBOARD-V1-01~~ (Painel Gerencial) | **FECHADO em 2026-09-15** · D2–D5 decididas pelo PO · versão 1 entregue · sem migration | — (entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 7 | P1 | Decisões de **PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01** → PRODUCTION-PERMISSION-HARDENING-01 | Discovery `EM_ANALISE` · P1 e P6 bloqueiam | PO fecha P1 e P6 (e confirma P2–P5, P7, P8); implementar | — |
| 8 | P1 | Decisões de **WAVE-05-GOLDEN-PATH-DISCOVERY-01** → E2E-BASELINE-REDESIGN-WAVE-05 (golden path) | Discovery `EM_ANALISE` · Q3 bloqueia | PO fecha Q3 e as demais; passos 1–2 do plano não dependem de decisão | WAVE 4 entregue |
| 9 | P1 | ~~**CUSTOMER-STATUS-LIFECYCLE-01**~~ — situação cadastral do Cliente (Ativo · Bloqueado · Inativo), histórico auditável e guardas de venda | **FECHADO em 2026-09-15** · feedback direto da Veridi · migration aditiva (`blocked` + `customer_status_history`) | — (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §95, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md)) | — |
| 9b | P1 | ~~**CUSTOMER-STATUS-HARDENING-01**~~ — quem muda a situação cadastral e o aviso no documento em andamento (pré-homologação) | **FECHADO em 2026-09-16** · absorve CUSTOMER-STATUS-PERMISSIONS-01 (só ADMIN e COMMERCIAL alteram, 403 na API para os demais, que seguem consultando) e CUSTOMER-STATUS-DRAFT-WARNING-01 (aviso no Orçamento, Projeto e Pedido em andamento, pela situação atual que a leitura traz) · guardas de venda intactas · **sem migration** | — (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §95, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9c | P1 | ~~**CUSTOMER-EDIT-PERMISSIONS-01**~~ — quem cria e edita o cadastro do Cliente | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO (opção A do [discovery](discovery/CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01.md)): só ADMIN e COMMERCIAL criam e editam (`CUSTOMER_EDIT_ROLES`, lista própria), 403 na API antes do corpo e da existência · os demais perfis consultam o Cliente no mesmo modal, sem campo editável · "+ Novo cliente" só para quem cadastra, com a ajuda de a quem pedir nos seletores · `UpdateCustomerInput` com o endereço que já trafegava · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §98, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9d | P1 | ~~**CUSTOMER-PAYMENT-DEFAULTS-01**~~ — forma e condição de pagamento padrão do Cliente como sugestão para novos orçamentos | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · D1–D6 do PO ([discovery](discovery/CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01.md)): forma (PIX, Boleto, Transferência, Cartão, Outro) e condição opcionais no Cliente, copiadas para a V1 (e para a primeira proposta depois de só legado); V2, recompra e duplicação partem da versão; "Aplicar padrão do cliente" só na tela; o Pedido congela a forma; "Forma de pagamento" passou a ser o meio e à vista/parcelado virou "Condição de pagamento"; parcelado sem parcelas recusado no Cliente e no Orçamento · **migration aditiva** `20260925093032` (sem backfill) | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §99, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9e | P1 | ~~**MASTER-DATA-EDIT-PERMISSIONS-01**~~ — quem cria, edita, inativa e reativa Item, Fornecedor e Produto | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · DE1–DE12 do PO ([discovery](discovery/MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01.md)): Item com Compras, Qualidade, Produção e ADMIN, os quatro controles só Qualidade e ADMIN pela mudança de valor, "Consumido na produção" só Produção e ADMIN, custo de referência inicial só Comercial e ADMIN (recusado, nunca ignorado), inativar Compras/Qualidade/ADMIN e reativar Qualidade/ADMIN · Fornecedor com Compras e ADMIN · Produto com Comercial e ADMIN, inclusive a criação direta aprovada, e "Exige CoA" só para o PA que nasce junto · 403 antes do corpo e da existência (`exigirPerfil` compartilhado), 409 de situação · consulta no mesmo modal, criação contextual e "Nova relação" por perfil · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §100, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9f | P1 | ~~**ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01**~~ — a relação Item × Fornecedor criada por Compras nasce pendente | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · D3 do PO ([discovery](discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md), persistido nesta rodada): Compras cria a relação, os dados comerciais e a primeira oferta e administra o preferencial quando elegível, mas pedir `APPROVED` ou `BLOCKED` na criação é 403 com o motivo, sem gravar nada · homologar e bloquear, também na criação, só Qualidade e ADMIN (`SUPPLIER_ITEM_QUALIFICATION_ROLES`, a mesma lista da rota de homologação) · voltar para pendente com Compras, Qualidade e ADMIN · ADMIN mantém a criação com situação explícita · "Situação inicial: Pendente" na tela de Compras · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §101, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9g | P1 | ~~**ITEM-SUPPLIER-UX-01**~~ — fornecedores administráveis no cadastro do Item (Fatia 1) | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · D1–D5 do PO ([discovery](discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md) `IMPLEMENTADO`): a seção Fornecedores do Item lista as relações reais e administra — Compras e ADMIN adicionam fornecedor com o Item fixo (Compras cria `PENDING`) e definem o preferencial com confirmação e troca atômica da API; Qualidade e ADMIN homologam e bloqueiam no detalhe aberto por cima do Item; os demais consultam · duplicidade leva à relação existente · tela geral mantida (D2) · Fornecedor → Itens para SUPPLIER-ITEMS-UX-01 (D4) · sem lead time (D5) · Escape da confirmação não fecha mais o modal de baixo · **sem migration e sem API nova** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §102, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9h | P1 | ~~**LABEL-ATTACHMENTS-01**~~ — arquivo versionado do Item Rótulo, com storage `LOCAL_FS` e Cloudflare R2 | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisões do PO no handoff ([discovery](discovery/LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01.md), persistido nesta rodada): Rótulo por tipo e subtipo; versões imutáveis com vigente derivada; PDF/PNG/JPEG até 25 MB por extensão, tipo e assinatura; anular com motivo sem apagar bytes; restaurar como versão nova; download autenticado em streaming; enviar e restaurar Compras, Qualidade, Comercial e ADMIN, anular Qualidade e ADMIN · `StorageAdapter` com `LOCAL_FS` e `R2` · **migration aditiva** `20260925093033` · **Railway não tocado**: R2 pronto e desligado | Publicação quando o PO decidir; ativação do R2 em STORAGE-R2-ACTIVATION-01 (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §103, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9i | P1 | ~~**SUPPLIER-QUALITY-REJECTION-REASON-01**~~ — bloquear a relação Item × Fornecedor exige motivo | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO no handoff: `BLOCKED` exige motivo em texto livre, sem lista fechada, na rota de homologação e na criação já bloqueada — sem ele, 400 `validation_error` e nada gravado, com o 403 por perfil antes · homologar e voltar para pendente sem motivo · bloqueio antigo sem motivo continua válido, mostrado como "Motivo não registrado", sem backfill · diálogo "Bloquear fornecedor para este item" no detalhe que a tela geral e o cadastro do Item compartilham · **sem migration** (reutiliza `note` do histórico de homologação) | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §104, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9j | P1 | ~~**ACQUISITION-COST-PERMISSION-01**~~ — custo efetivo de aquisição definido por qualquer sessão | **FECHADO em 2026-09-16, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO: Compras e ADMIN informam o custo efetivo (`ACQUISITION_COST_ROLES`) nas duas portas — `PUT /receipt-lines/:id/acquisition-cost` com 403 antes do corpo e da linha, e o recebimento de outro perfil que traz custo com 403 antes do corpo e da OC, sem gravar nada; receber sem custo segue aberto a todos · `costUpdatedBy` com o usuário da sessão (antes, "Ambiente local") · "Definir/Atualizar custo" no documento e o campo de custo de "Receber OC" só para quem informa, consulta igual para os demais · REAL, 30D e 90D seguem a mesma fonte · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §105, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9k | P1 | ~~**ASSISTED-ENTITY-SELECTOR-FOUNDATION-01**~~ — consulta assistida nos seletores de entidade, piloto Item | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · fundação de UX: "Consultar itens" no topo da lista do seletor, opt-in (`onConsult`), sem trocar o autocomplete · `EntityConsultationDialog` por cima da tela, com o recorte do campo à vista, busca e paginação no servidor pelas peças das listagens, linha recusada desabilitada com motivo e cartões em 390px · piloto Item na bancada (Formulação e Modelo, matéria-prima e embalagem): tipo da seção e só ativos, item de outra linha desabilitado, selecionar põe o item na linha sem recarregar nem perder pendência · "+ Novo item de estoque" dentro da consulta é a criação no contexto de sempre, só para quem cadastra Item, agora com `?tipo=` da seção · **sem API alterada e sem migration** | Publicação quando o PO decidir; expansão em ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 depois de validar o piloto (padrão em [`UI_BRAND.md`](UI_BRAND.md), estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9l | P1 | ~~**FORMULATION-COMPONENT-BASIS-AUTOMATION-01**~~ — base de cálculo da linha escolhida à mão na bancada | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO: base é consequência da seção e do modo, não escolha · composição por dose na receita por dose (modo, cápsula ou pó) e base fixa senão; embalagem por unidade acabada · servidor deriva em toda gravação de rascunho (Formulação e Modelo, troca de modo, cópia de versão, aplicar e salvar como Modelo) e descarta `basis` do corpo · ativa, inativa e arquivada intactas · bancada sem Base, Fornecimento mantido, aviso de rascunho legado · DEV sem nenhuma linha fora da regra (1.330) · **sem migration** | Publicação quando o PO decidir, depois do gate READ ONLY `scripts/maintenance/prod-component-basis.ts` em PROD (Formulação e Modelo, todos os status; linha fora da regra vai ao PO) (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §106, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9m | P1 | ~~**INVENTORY-INACTIVE-ITEM-VISIBILITY-01**~~ — item inativo sumia do estoque físico | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · Fatia 1 de MASTER-DATA-INACTIVE-VISIBILITY, D1–D3 do PO ([discovery](discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md), persistido nesta rodada): inativo com posição (saldo, reservado ou em compra) aparece no Estoque marcado "Item inativo"; sem posição só com "Incluir inativos sem saldo"; CSV com o mesmo recorte e a coluna "Item ativo"; detalhe com a situação e o histórico inteiro; Contagem rápida acha o inativo e conta a posição com saldo; saída e perda seguem; entrada manual recusada (400 `inactive_item`) · perfis intocados · **sem migration** | Publicação quando o PO decidir; fatias 2–4 esperam o handoff (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §107, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9n | P1 | ~~**ASSISTED-ENTITY-MULTISELECT-01**~~ — consulta assistida com várias escolhas onde a tela monta lista, e colunas que distinguem registros parecidos | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisão do PO: seleção única no campo da linha, múltipla (até 10, explícita) na ação da seção · `EntityConsultationDialog` com `selectionMode`, marcação que atravessa busca, página e recarga, uma confirmação, presente travado com motivo, sem "+ Novo" na múltipla · pilotos: Formulação e Modelo ("+ Adicionar matérias-primas" / "+ Adicionar embalagens", uma linha por item pelo caminho da escolha na linha, base derivada) e recursos do Modelo de Estrutura de Custo ("+ Adicionar recursos") · adendo: matéria-prima com fonte/função e pureza cadastrada, embalagem com subtipo, recurso com tipo, capacidade e unidade de uso · **sem API alterada e sem migration** | Publicação quando o PO decidir; Roteiro de Produção fica para o rollout (mão de obra E equipamento pedem `types=` na API) — padrão em [`UI_BRAND.md`](UI_BRAND.md), estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A | — |
| 9o | P1 | ~~**PRODUCT-INACTIVE-COMMERCIAL-GATE-01**~~ — Produto inativo iniciava compromisso comercial novo | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · Fatia 2 de MASTER-DATA-INACTIVE-VISIBILITY, D6–D7 do PO ([discovery](discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md)): vincular ao Projeto, linha nova, envio e aceite de Orçamento, aprovação do Projeto, geração e confirmação de Pedido e Amostra nova recusam Produto inativo (400 `inactive_product`); liberação da OP planejada relê Produto e PA; PA existente e inativo tem recusa própria (400 `inactive_finished_item`), sem cascata Produto × PA; rascunho abre marcado, versão nova copia a linha, nada é cancelado; Web não oferece o inativo em escolha nova e marca o registro salvo com a situação do servidor · custos, preço, CMV e roteiro intocados · **sem migration** | Publicação quando o PO decidir; fatias 3–4 esperam o handoff (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §108, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9p | P1 | ~~**ITEM-FORM-BY-TYPE-01**~~ — cadastro do Item contextual ao Tipo, com o arquivo do Rótulo escolhido já na criação | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `5b7c1a3`) · decisões do PO no handoff: `Item.type` decide o formulário, nunca a Família · matéria-prima com Classificação industrial, embalagem com Dados da embalagem (subtipo e consumido na produção), Rótulo com Arquivo do rótulo logo depois · troca de tipo e subtipo na criação limpa o que ficou escondido, e o envio só leva os campos do tipo · arquivo opcional, guardado na tela até existir o id e enviado pela rota de LABEL-ATTACHMENTS-01 · falha depois de criar não recria: "Item criado, mas o arquivo do rótulo não pôde ser enviado." e a seção oficial do Item criado para reenviar · **sem API, shared nem migration** · `INTERNAL_CONSUMABLE` fora | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §109, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9q | P1 | **ITEM-DUPLICATE-SANITIZATION-01** — Itens de matéria-prima e embalagem com o mesmo nome, Onda A | **Onda A aplicada no `veridi_dev` em 2026-09-17; PROD não saneado** (`release/prod` segue `5b7c1a3`) · decisões do PO no handoff ([discovery](discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md), persistido nesta rodada): G1, G12, G14, G16, G17 e G18; duplicado sem uso removido; de-para no arquivo de decisão da carga, sem alias · ferramenta PLAN/APPLY/VERIFY com trava consultiva, `SELECT FOR UPDATE`, impressão digital e falha fechada; APPLY só em banco local · importador não recria a duplicata absorvida · DEV: Itens −6, relações −2 e 1 movida, ofertas e eventos preservados; restam 12 grupos · **sem migration** | Onda A em PROD (conferência READ ONLY, PLAN em PROD, backup restaurável e APPLY liberado para produção, com aprovação do PO); Ondas B e C (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §110, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md)) | PO |
| 9r | P1 | ~~**CUSTOMER-CNPJ-LOOKUP-01**~~ — consulta assistida de CNPJ no cadastro do Cliente | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · RECONCILIA e substitui CUSTOMER-CNPJ-AUTOFILL-01, aprovado pelo PO com OpenCNPJ como primeiro provedor (Serpro passa a ser provedor futuro) · assistência ao preenchimento: consultar não grava, comparação Atual × Retornado contra o ESTADO DO FORMULÁRIO, diferença aplicável marcada por padrão, vazio da fonte nunca apaga valor existente, Cancelar não muda nada, falha externa mantém o cadastro manual inteiro · `GET /cnpj-lookup/:cnpj?provider=` autenticado, somente leitura, com `CUSTOMER_EDIT_ROLES` (§98); chamada externa no servidor, com timeout, teto de resposta e parsing que não confia no payload · abstração `CnpjLookupProviderAdapter` + registro, pronta para o SERPRO sem reescrever tela, endpoint nem contrato · perfil tributário, pagamento, notas e situação intocados · **sem migration** | Publicação quando o PO decidir; SERPRO quando houver credencial e decisão (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §111, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9s | P1 | ~~**CUSTOMER-CNPJ-PERSISTED-DATA-01**~~ — dados cadastrais do CNPJ guardados no Cliente | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · evolui CUSTOMER-CNPJ-LOOKUP-01 sem integração nova · CNAE, natureza jurídica, porte, abertura, matriz/filial, Simples e MEI (Sim/Não/Não informado, `null` nunca é Não), situação na RFB, data da situação e última consulta · consultar não grava; "Aplicar consulta ao cadastro" leva o bloco com o `consultedAt` mesmo sem diferença; o Salvar persiste · trocar o CNPJ descarta o bloco do número anterior, na tela e no servidor · perfil tributário, pagamento, notas e situação intocados · **migration aditiva** `20260925093036` | Publicação quando o PO decidir — PROD precisa da migration (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §119, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9t | P1 | ~~**PRODUCTION-PROFILE-ARCHIVE-01**~~ — arquivar e desarquivar o Perfil de Produção | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · Fatia 0 de [MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01](discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D4 · `POST /production-profiles/:id/archive`, com ADMIN e Produção (403 antes do corpo para os demais) e 409 na transição repetida, sem re-carimbar · arquivado fora da lista padrão ("Mostrar arquivados") e dos seletores; 409 `profile_archived` no padrão novo de Produto e em toda aplicação à OP; a aplicação automática deixa a OP nova sem cópia, pendente, sem trocar de roteiro · o Produto que já apontava continua apontando, com aviso; versões e cópias nas OPs intocadas · **sem migration** | Publicação quando o PO decidir (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §121, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9u | P1 | ~~**USER-LAST-ADMIN-GUARD-01**~~ — nunca zero ADMIN ativo | **FECHADO em 2026-09-17, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · Fatia 0 do [discovery](discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D5: `PATCH /users/:id` recusa inativar ou rebaixar o último ADMIN ativo (409 `last_active_admin`), inativar a si mesmo (`self_deactivation`) e retirar de si o perfil Administrador (`self_demotion`), mesmo havendo outro ADMIN — outro ADMIN executa · contagem e gravação na mesma transação, com as linhas de ADMIN ativo travadas (`FOR NO KEY UPDATE`) · a tela trava perfil e situação do próprio usuário e explica o último · **sem migration** | — (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §120, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9v | P1 | ~~**MASTER-DATA-HARD-DELETE-01**~~ — exclusão física do cadastro errado e nunca usado: infraestrutura, Fornecedor, Cliente, Modelos e Perfil de Produção | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · Fatia 1 do [discovery](discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), D1–D3 e D6 · prévia `GET <cadastro>/:id/deletion-check` e `DELETE <cadastro>/:id` com motivo obrigatório, só ADMIN (403 antes do corpo e da existência); 409 `master_data_in_use` com as referências · catálogo explícito por agregado conferido contra o `pg_constraint` a cada execução, redes por sufixo e varredura de JSON, falha fechada · filhos técnicos: a V1 como a criação a deixou e o registro do CNPJ gravado na criação do Cliente, só pela marca estrutural `createdWithCustomerId` (9y, fechado em 2026-09-18 — a Fatia 1 fechou de vez) · transação com `FOR UPDATE`, recontagem e `pg_stat_xact_user_tables`, efeito inesperado desfaz tudo · rastro append-only `master_data_deletion_history` com retrato por lista branca, ALVO no `prod-cleanup` · "Excluir definitivamente" só para ADMIN nas seis telas · **migrations aditivas** `20260925093038` e `20260925093040` (9y) · FKs intocadas | Publicação quando o PO decidir — PROD precisa das migrations 093038 e 093040 (regra em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §125, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | — |
| 9w | P1 | **MASTER-DATA-HARD-DELETE-02** — exclusão física de Item, Produto + PA e Recurso industrial | **Liberado pelo PO em 2026-09-17** · Fatia 2 do [discovery](discovery/MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.md), mesmas decisões, nos cadastros com CASCADE no caminho (movimento de estoque, referência de custo, contagem, custo e precificação, tarifa) · o PA sai só junto do Produto e sem uso próprio · **sem migration** (usa o rastro da Fatia 1) · a infraestrutura está na `main` desde 9v: o catálogo do agregado entra em `modules/master-data-deletion/catalogo-de-exclusao.ts`, o caminho em `MASTER_DATA_DELETION_PATHS`, e o enum do rastro já reserva `ITEM`, `PRODUCT` e `INDUSTRIAL_RESOURCE` — o teste de contrato das rotas DELETE muda junto | Implementar | — |
| 9x | P1 | ~~**CUSTOMER-CNPJ-EDITABLE-HISTORY-01**~~ — dados do CNPJ editáveis, consulta aditiva e histórico | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · revê 9s · os dez dados cadastrais do CNPJ viram campos editáveis, na seção logo antes de Observações · consulta ao OpenCNPJ aditiva em todos os campos: vazio nasce marcado, existente só muda com "Substituir", igual aparece para "Confirmar", fonte vazia nunca apaga · "Última consulta" é texto do sistema no rodapé · histórico só de acréscimo por gravação (Edição, Consulta sem diferença, Troca de CNPJ), com origem Manual/OpenCNPJ por campo e "Ver histórico"; sem histórico retroativo · regra global: mesmo espaço vertical entre blocos de todo cadastro (`--block-gap`) · **migration aditiva** `20260925093037` | Publicação quando o PO decidir — PROD precisa das migrations 093036 e 093037 (regras em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §122 e §123, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | 9s |
| 9y | P2 | ~~**CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01**~~ (proposto como MASTER-DATA-HARD-DELETE-CNPJ-BIRTH-01) — marca estrutural do registro do CNPJ gravado na criação do Cliente | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · decisão do PO: coluna anulável `createdWithCustomerId` em `customer_cnpj_registration_history`, sem FK, sem default e sem backfill (registro antigo segue NULL e bloqueando) · só `createCustomer` a grava, com o id do Cliente que nasce — inclusive o OpenCNPJ aplicado antes do primeiro Salvar —; PATCH nunca marca · filho técnico = `customerId` e `createdWithCustomerId` iguais ao Cliente, um só: sai junto (`removedTogether`, CASCADE no efeito esperado); sem marca, marca de outro Cliente ou dois marcados bloqueiam; nenhuma hora, ordem ou `xmin` · saneamento: a coluna é `origensImoveis` do Cliente — fora do catálogo de referências móveis e do resíduo do VERIFY, e o APPLY recusa plano que a mova; o MERGE move `customerId` e nunca a marca, e o registro movido bloqueia a exclusão do canônico · **migration aditiva** `20260925093040`, nenhuma tela muda · fecha de vez a 9v | Publicação quando o PO decidir — PROD precisa das migrations 093038 e 093040 (regras em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §125 e §114, estado em [`PROJECT_STATE.md`](PROJECT_STATE.md), entrada em [`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md), seção A) | 9v |
| 9z | P1 | ~~**INTERNAL-CONSUMPTION-REVERSAL-01**~~ — estorno próprio do consumo interno | **FECHADO em 2026-09-18, na `main` e fora de PROD** (`release/prod` segue `8e824e8f`) · P1–P10 decididas pelo PO no [discovery](discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md) · §126 · migration aditiva `20260925093039` · estorno `ECI-` total ou parcial, só ADMIN e QUALITY, custo copiado, mesmo lote, recusa com inventário aberto ou contagem posterior · R-21 líquido na data do CI · extrato e R-03 reconhecem consumo e estorno | — (seção própria no [`PROJECT_STATE.md`](PROJECT_STATE.md)) | — |
| 10 | P2 | **Estabilização final ampla do produto** | Sem ID e sem escopo | Abrir ID e escopo quando 4–8 fecharem | WAVE 4, permissões e WAVE 5 |
| 11 | — | **DEMO-DATASET-01** — ambiente DEMO com massa fictícia determinística | **AGUARDANDO DEFINIÇÃO DO PO** | Massa fictícia determinística + reset protegido para um futuro ambiente Railway DEMO, e o fluxo `main` → `release/demo` → aprovação → o MESMO SHA em `release/prod`. Nada criado: sem ambiente, sem `release/demo` | PO |

**P3** — LOW e UX realmente abertos, sem posição: tabelas da seção A (a partir de "LOW e UX da triagem"), seção D e
watchlist (E). A estabilização final (10) é o lugar natural para varrê-los.

**Abertos fora da fila**, cada um esperando decisão própria — nenhum sobe sem o PO:

| Item | Por que não está na fila | Onde |
|---|---|---|
| **CUSTOMER-MASTER-DATA-AUDIT-01** — histórico de antes/depois do cadastro do Cliente (P2) | Futuro, registrado em 2026-09-16 (CUSTOMER-EDIT-PERMISSIONS-01); avaliar antes de construir | G |
| **MASTER-DATA-STRUCTURAL-LOCKS-01** — travas estruturais do cadastro mestre além de `operationallyUsed` | Registrado em 2026-09-16 (MASTER-DATA-EDIT-PERMISSIONS-01); pergunta de produto antes de construir | G |
| **MASTER-DATA-STATUS-HISTORY-01** — motivo e histórico de Inativar/Reativar de Item, Fornecedor e Produto (P2) | Futuro, registrado em 2026-09-16 (MASTER-DATA-EDIT-PERMISSIONS-01); exigiria migration | G |
| **SUPPLIER-ITEMS-UX-01** — Fornecedor → Itens fornecidos administrável no cadastro do Fornecedor (Fatia 2) | D4 do PO em 2026-09-16: capability separada, não implementar agora. A Fatia 1 (Item) fechou em ITEM-SUPPLIER-UX-01. Espera o handoff do PO | G |
| **STORAGE-R2-ACTIVATION-01** — ligar o Cloudflare R2 no Railway para o arquivo do Item Rótulo (P1) | Registrado em 2026-09-16 (LABEL-ATTACHMENTS-01). Configurar secrets e rodar o smoke real exigem autorização explícita do PO; nada foi feito no Railway | G |
| **ATTACHMENTS-R2-MIGRATION-01** — anexos genéricos (`Attachment`) no adaptador de storage e no R2 (P2) | Futuro, registrado em 2026-09-16 (LABEL-ATTACHMENTS-01); avaliar se ainda faz sentido | G |
| **LABEL-FILE-SUBTYPE-CHANGE-01** — Item Rótulo com versões pode trocar de subtipo e a seção some (LOW) | Registrado em 2026-09-16 (LABEL-ATTACHMENTS-01), sem posição: é pergunta de cadastro mestre | G |
| **ASSISTED-ENTITY-SELECTOR-ROLLOUT-01** — consulta assistida nos demais seletores (Cliente, Fornecedor, Produto, Lote e outros) | Registrado em 2026-09-17 (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01): expandir só depois de validar o piloto Item com a Veridi. A seleção múltipla já existe (ASSISTED-ENTITY-MULTISELECT-01). Espera o handoff do PO | G |
| **COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01** — linha de recurso sem uso por lote não vai no "Salvar rascunho" do Modelo de Estrutura (LOW) | Registrado em 2026-09-17 (ASSISTED-ENTITY-MULTISELECT-01): anterior à rodada, mais visível com "+ Adicionar recursos". Pergunta de UX antes de mexer | G |
| INACTIVE-MARKERS-REPORTS-01 (opcional) — última fatia do cadastro inativo | Registrada em 2026-09-17 com o discovery. As Fatias 1 a 4 fecharam no mesmo dia (INVENTORY-INACTIVE-ITEM-VISIBILITY-01 §107, PRODUCT-INACTIVE-COMMERCIAL-GATE-01 §108, SUPPLIER-ITEM-INACTIVE-GATE-01 §112 e PRODUCTION-INACTIVE-COMPONENT-GATE-01 §116). Só D9 (R-18 abre em "Todos", com a situação) tem recomendação e espera o handoff do PO | [discovery](discovery/MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md) |
| **ITEM-DUPLICATE-SANITIZATION-01** — grupos restantes (2 no DEV: G6 café verde e G11 fosfato de piridoxal) | Ondas 2 (§118) e 3 (§124) resolveram os demais no DEV. G6 e G11 esperam a Veridi: significado de `*`/`**` (V4), teor de clorogênico e as cotações FLORIEN (V1). Registrado em 2026-09-17 com a Onda A | [discovery](discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) |
| **ITEM-NAME-STANDARDIZATION-01** — nome do Item MP/ME em MAIÚSCULAS e único sem caixa | Parado em 2026-09-17 no passo de duplicidade: o índice único não nasce enquanto houver grupo repetido (2 no DEV depois da Onda 3; PROD não saneado). Retomar depois das ondas, recontando no DEV e em PROD | [discovery](discovery/ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) |
| **INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01** — CI de data passada lançado depois de um inventário encerrado baixa duas vezes (MEDIUM) | Registrado em 2026-09-18 (INTERNAL-CONSUMPTION-REVERSAL-01), sem correção por decisão do PO: é o espelho da guarda do estorno na criação do consumo | G |
| **DASHBOARD-INTERNAL-CONSUMPTION-01** — o Painel não representa Uso e consumo (P2) | Registrado em 2026-09-18 (INTERNAL-CONSUMPTION-REVERSAL-01): card novo ficou fora da fatia por decisão do PO | G |
| **OPS-BACKUP-01** — backup agendado de PROD (HIGH) | Snapshot do Railway recusado e PITR desligado; o backup lógico JSON é restaurável e provado. Rotina agendada é decisão de infraestrutura | A |
| COST-VAR-02 — variação de CMV e proteção de margem | Bloqueado: sete decisões do PO e dado real em produção | [`archive/COST-VAR-01…`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) |
| #8E, #8F, #8G · PLAN-DATE-01 · UX-HELP-03 | Melhorias aguardando autorização | B, E |
| #7, #11 | Gate com a Veridi | C |
| SUPPLIER-OFFER-OVERLAP-01 · COM-CONTRACT-01 · SUPPLIER-MODE-01 · ASSET-01 | Discovery sem pergunta decidida | G |

---

## Decisões ainda reais, por item da fila

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
**Discovery INVENTORY-PHYSICAL-COUNT-DISCOVERY-01: `DECIDIDO`** — D1–D8 e P1–P7 fechadas pelo PO em 2026-09-15
(opção F de concorrência, recontagem opcional, sem tolerância, ADMIN/PRODUCTION/QUALITY contam e aprovam), documento em
[`discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md`](discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md).
**Fatia 1 entregue em 2026-09-15** (INVENTORY-PHYSICAL-COUNT-01): domínio, schema e API das sessões, e a Contagem rápida
gravando `INV-` QUICK. **Fatia 2A entregue em 2026-09-16**, sobre o discovery das telas
(INVENTORY-PHYSICAL-COUNT-UI-DISCOVERY-01, addendum do documento, DU-1 a DU-6): as telas contam até Em revisão.

**Fatia 2B entregue em 2026-09-16** (INVENTORY-PHYSICAL-COUNT-01, na `main` e fora de PROD, sem migration): revisão com
recortes e seleção por id, recontagem pedida e contada pela tela de contagem, Ajustar/Não ajustar com motivo e
confirmação de movimentação marcada à mão (com os movimentos da posição), encerramento com a consequência por unidade e
os ajustes vistos conferidos pelo servidor (`stock_count_changed`), recusa por posição com recontar/redecidir/voltar à
revisão, Contagem rápida pela prévia (retenção antes do saldo, `expectedSystemQuantity`, `Decimal`, `INV-` no
resultado), aba Contagens rápidas com o resultado, `INV-` em Movimentações, R-03 e CSV, e filtros de local, situação e
validade no Novo inventário. Decisões do PO da rodada: sem endpoint de pré-checagem do encerramento (tenta e mostra a
recusa); só a última decisão e a última recontagem ficam gravadas; histórico completo delas não agora.

**Ainda aberto do assunto** (nenhum bloqueia o ciclo pela tela):

- **INVENTORY-CONFIRMATION-AFTER-DECISION-01** (P2, pede decisão do PO — toca quantidade): a confirmação de movimentação
  vale para sempre na posição. Movimento lançado DEPOIS da decisão — inclusive um lançamento retroativo — não pede nova
  confirmação, e o encerramento aplica a diferença congelada; recontagem (rodada ≥ 2) também dispensa a confirmação para
  movimentos lançados depois dela. Achado na Fatia 2B, lendo `completeStockCount`; não corrigido (regra de domínio da
  Fatia 1). Proposta: confirmação vale até o instante da decisão, e movimento posterior volta a pedir;
- adicionar posição em revisão pela tela (a API aceita e responde sem saldo a quem conta; a tela só oferece em contagem);
- filtros "última contagem" e "movimentação" do montador (o PO pediu só os que entregam valor agora: local, situação e
  validade entraram); retenção leve;
- histórico completo de decisões e recontagens por posição (hoje só a última) — decisão do PO: não agora;
- conferência visual em navegador da revisão e dos diálogos em 390px (a rodada foi validada por testes de tela; o PO
  vetou Playwright nela).

Depois: Fatia 3 (FO-01 de sessão e CSV controlado). Regularização de material sem lote (P7), inventário cíclico, scanner
dedicado e localizações seguem FUTURO.

### Painel Gerencial — status

**Versão 1 entregue em 2026-09-15** (MANAGEMENT-DASHBOARD-V1-01, Gestão → Painel Gerencial): D1–D5 decididas e
aplicadas, e o faturado sai de `billings/billed-value.ts`, nunca de conta própria. Continuam abertos, sem posição e sem
promoção: encerramento de saldo de OC parcialmente recebida (G5) — e com ele o "a receber de fornecedores" em R$ —;
preço acordado em Pedido digitado direto (G2); lista de Pedidos por data de confirmação (G4 residual), sem a qual o
cartão "Pedidos confirmados" fica sem link. Evolução do discovery (seção 10.3), só com pedido do PO: recebido a custo
efetivo, compras por fornecedor, propostas em aberto, margem contratada, bloco de Compras para PURCHASING, atalho no
Painel Operacional e PDF do painel. Fora do produto: contas a pagar, contas a receber, caixa e margem realizada.

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
conferência numérica ficam em [`archive/E2E_AUDIT_2026-09-07.md`](archive/E2E_AUDIT_2026-09-07.md);
aqui fica só o que exige trabalho, com a severidade **do PO**, que nem sempre é
a do auditor.

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
| ~~**FORMULATION-PRINT-ADJUSTMENTS-01**~~ | **ABSORVIDO por FORMULATION-TECHNICAL-SHEET-PDF-01 (2026-09-15).** O achado era que nenhum impresso lia a pureza, a reserva (o antigo *overage*) nem o físico por unidade da Formulação. A Ficha Técnica do Produto lê os três direto da VERSÃO — pureza aplicada com nota quando o cadastro divergiu desde então, reserva por linha e "Por embalagem" na unidade de estoque — e diz "não aplicada" quando a versão histórica registrou pureza sem autorizar a correção, que é o que o modo da quantidade significa no papel. Fora da Formulação (Folha de Receita, OP, CMV, Cálculo) o achado do PDF-DOCUMENT-SYSTEM-01 segue como está: aqueles DTOs não trazem os ajustes, e levá-los é decisão de outro item | UX | — |
| ~~**FORMULATION-TEMPLATE-BASIS-EDIT-01**~~ | **ABSORVIDO por FORMULATION-TEMPLATE-WORKBENCH-01 (2026-09-16).** O achado era a falta de seletor de base na linha do Modelo. A base deixou de ser um campo genérico a oferecer: ela é consequência da SEÇÃO — embalagem conta por unidade acabada, composição conta por dose quando a receita é por dose (`baseSugeridaDaSecao`, `packages/shared`) —, e a fatia 1 já a sugere na linha nova pelo tipo real do Item. A linha que já declarou base não é tocada, e `FIXED_BASIS` continua existindo: matriz histórica escrita sobre a base continua sobre a base. O acabamento visual das duas seções é da fatia 2. Superado em 2026-09-17 por FORMULATION-COMPONENT-BASIS-AUTOMATION-01: a base de toda linha de rascunho é derivada e o seletor saiu (§106) | UX | — |
| **UI-NUMERIC-FIELD-STANDARD-01** | Aplicar ao sistema inteiro o padrão de campo numérico homologado na Formulação: caixa compacta, borda única, canto arredondado, número à direita, pt-BR, setas de incremento/decremento respeitando a última casa escrita e limites conforme o domínio. Pedido do PO em 2026-09-16, registrado sem implementar: é varredura de tela por tela, e entra na estabilização final (10) ou numa rodada própria | UX | — |
| **ATTACHMENT-ACTIONS-BY-ROLE-01** | Documentos de Lote, Recebimento, Projeto e Amostra (`AttachmentsSection`) oferecem anexar e "Arquivar" a todo perfil, mas a API só aceita anexar com a lista do contexto (Lote e Recebimento: Compras, Qualidade e ADMIN; Projeto: Comercial, Qualidade e ADMIN; Amostra: também Produção) e arquivar com Qualidade e ADMIN — o clique termina em 403. O Produto já passa `canUpload`/`canArchive` pelas listas de `@veridi/shared` desde MASTER-DATA-EDIT-PERMISSIONS-01; levar o mesmo às outras quatro telas pede as listas dos contextos no shared | UX | S |
| **NAV-TWO-SEARCHES-01** | Convivem "Buscar ou escanear lote" no topo e "Buscar telas…" na coluna; unificar é assunto da busca global de registros. Conferido no código em 2026-09-15: as duas seguem | UX | — |

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
- permissões detalhadas por papel — o cadastro mestre já tem decisão do PO (Cliente §98; Item, Fornecedor e
  Produto §100) e a execução da Produção tem discovery próprio (fila, posição 7);
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção — Cloudflare R2 aprovado pelo PO em 2026-09-16 e pronto no
  código para o arquivo do Item Rótulo (§103); ligar no Railway é STORAGE-R2-ACTIVATION-01 e levar os anexos
  genéricos é ATTACHMENTS-R2-MIGRATION-01 (seção G).

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

### ~~FORMULATION-LOSS-SCOPE-01~~ — a cápsula vazia entra na perda prevista — FECHADO em 2026-09-15

Decisão do PO (2026-09-15): **entra**. A perda prevista é perda do PROCESSO para
alcançar a quantidade líquida vendável, então recebe o fator quem é consumido
proporcionalmente à quantidade BRUTA que entra no processo — matérias-primas,
ingredientes e a cápsula vazia. A embalagem comercial (pote, tampa, rótulo,
cartucho, caixa de embarque, dosador) continua na quantidade vendável.

A auditoria confirmou o que o registro anterior suspeitava: nenhum atributo do
domínio separava "embalagem consumida na produção" de "embalagem comercial" —
`packagingSubtype` enumera pote, tampa, rótulo, cartucho, caixa e dosador mas
não tem valor para a cápsula, e a base do componente descreve a aritmética da
linha, não a incidência da perda. A menor mudança que diferencia o
comportamento foi uma marca explícita do cadastro, `Item.consumedInProduction`
(booleano, `false` por default, migration aditiva `20260925093030`), lida pela
regra canônica `componenteSegueQuantidadeProduzida` em `@veridi/shared`.

Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §52; onde ela é
protegida em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md).

**Follow-up de cadastro, não de código:** os itens de cápsula vazia já
cadastrados nascem `false`, que é o comportamento anterior. Marcá-los é gesto de
quem cadastra, no formulário do Item — nenhum backfill por nome ou código foi
feito, e nenhum será: uma regra de custo decidida por `nome.includes("CAPS")` é
invisível para quem confere o custo.

### ~~FORMULATION-TEMPLATE-WORKBENCH-01~~ — a bancada no Modelo de Formulação — FECHADO em 2026-09-16

As decisões D-1 a D-11 do PO e as três fatias estão em
[`archive/BACKLOG_HISTORY.md`](archive/BACKLOG_HISTORY.md) (seção A); as regras duráveis, em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §96–§97. O que ficou fora: a Ficha Técnica do Modelo
(FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01, fechada em 2026-09-16, posição 2b da fila) e a tabela Forma ×
Apresentação, logo abaixo.

### FORMULATION-PRESENTATION-BY-FORM-01 — a tabela Forma × Apresentação — aguardando a Veridi

Também de 2026-09-15. O domínio não tinha nenhuma regra de compatibilidade entre
`DosageForm` e `PresentationType`, e o dado real só usa `POT` nas duas formas. A
tela passou a oferecer as apresentações coerentes com a forma, com a primeira
versão declarada da tabela em `APRESENTACOES_POR_FORMA` (`packages/shared`):
cápsula oferece tudo; pó oferece tudo menos **Frasco**. A apresentação já
gravada numa versão continua na lista mesmo fora da tabela, e nenhuma migration
destrutiva foi feita. Confirmar ou corrigir a tabela é decisão do PO.

### PRODUCTION-LOT-PURITY-RECONCILIATION-01 — pureza da Formulação × pureza do lote — futuro

Registrado na homologação de FORMULATION-WORKBENCH-01 (2026-09-15), **fora do P0
atual**. A Formulação congela a pureza usada na versão; a Produção escolhe o lote
real, que tem a sua. Quando as duas diferirem, o objetivo futuro é avisar o
operador e exigir uma decisão controlada — nunca recalcular a necessidade em
silêncio, nem deixar passar sem registro.

Também fica para auditar nessa rodada: se a pureza nominal por fornecedor deve
morar no relacionamento Fornecedor ↔ Item, em vez de só no Item. Nada a decidir
nem a implementar agora.

### ~~CUSTOMER-CNPJ-AUTOFILL-01~~ — consulta de CNPJ no cadastro do Cliente — RECONCILIADO em 2026-09-17

**Aprovado pela Veridi e entregue como CUSTOMER-CNPJ-LOOKUP-01** (fila 9r, regra em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) §111). Este registro fica como histórico da decisão, não como item aberto — e
não deve ser reaberto como capability separada.

O que mudou em relação ao registrado em 2026-09-16: o provedor de estreia é o **OpenCNPJ** (base pública, sem token),
e o **Serpro passa a ser provedor futuro** — a arquitetura nasceu com registro de provedores justamente para que ele
entre como um segundo adaptador, sem reescrever tela, endpoint nem contrato. O nome também mudou de propósito:
"autofill" descrevia atualização automática, e a decisão do PO é o contrário — **assistência ao preenchimento**, com o
usuário escolhendo campo a campo e salvando por conta própria.

As duas frases que este item mandava rever foram revistas: [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §83 passou a dizer
que a consulta existe e que ela **não** define o perfil tributário, e a ajuda do Cliente ganhou o conceito
"Consultar CNPJ". Quem consulta é quem edita o cadastro (§98).

**Continua sem decisão:** ligar o SERPRO — exige credencial, contrato e decisão do PO, e nada disso foi feito.

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

### 17. FK-ORDER-DOCUMENTED-CYCLE-01 — `fk-order.mjs` acusa o ciclo que a limpeza atravessa — LOW

O diagnóstico somente leitura `scripts/maintenance/fk-order.mjs` trata o ciclo
da contagem física (`stock_count_positions.validEntryId` NO ACTION ×
`stock_count_entries.positionId` CASCADE, desde a migration
`20260925093026`) como anel sem saída: imprime "CICLO DE FK" e sai com código 1
contra qualquer banco migrado (conferido em 2026-09-17 no banco de teste).
`prod-cleanup.mjs` atravessa esse ciclo pelo CASCADE listado em
`CASCADES_EM_CICLO_DOCUMENTADAS` (PROD-CLEANUP-MODEL-CLASSIFICATION-01), e a
ordem dele é a que vale. Correção: o diagnóstico reusar `calcularOrdem()` de
`prod-cleanup-models.mjs`, em vez de manter um segundo cálculo. Sem impacto na
limpeza — o risco é quem roda o diagnóstico ler o código 1 como bloqueio.

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
| **W10** | `pages/periodo-invertido-listas.test.tsx`, caso "'Recebimentos': a resposta atrasada não aparece; voltar ao período consulta uma vez": caiu uma vez na suíte web completa de CUSTOMER-EDIT-PERMISSIONS-01 (2026-09-16, 3.657 testes) com `Unable to find an element with the text: Carregando…` — o estado de carregamento é transitório e já tinha passado | Sozinho passou 3 de 3, e nenhum módulo da rodada está no caminho da tela de Recebimentos. Não caiu na suíte completa seguinte (WEB-SUITE-PREEXISTING-FAILURES-01, 2026-09-16: 3.657 testes, 0 falhas). Se voltar, o remédio é o teste esperar o carregamento sem depender de ver o instante dele |
| **W11** | Prazo de 5 s do Vitest estourado sob carga na suíte web completa (MASTER-DATA-EDIT-PERMISSIONS-01, 2026-09-16, 3.796 testes, duas execuções com 5 quedas cada, só `Test timed out in 5000ms`): `lib/dates-formatador.test.ts` nas duas; `components/campo-numerico-guarda.test.ts` e `pages/listas-sem-consulta-solta.test.ts` (guardas que varrem o código-fonte) na primeira; `pages/print/base-calculada-impressos.test.tsx` na segunda, que rodou em paralelo com a suíte web completa de outra sessão | Sem asserção falhando, conjunto diferente a cada execução, nenhum dos arquivos no caminho da rodada, e os quatro passam sozinhos (20/20 em 9,3 s). Se virar rotina, o remédio é prazo próprio nesses arquivos (o formatador percorre todos os fusos; as guardas leem a árvore inteira), não reexecutar até passar |
| **W12** | `modules/inventory/stock-count-telas-2b.test.ts`, caso "conjunto diferente recusa sem gravar nada; o mesmo conjunto encerra e o INV- aparece nos movimentos": caiu uma vez num conjunto focado de 19 arquivos da API em paralelo (INVENTORY-INACTIVE-ITEM-VISIBILITY-01, 2026-09-17) com `expected 'stock_count_close_blocked' to be 'stock_count_changed'` — o encerramento foi recusado por posição antes de conferir os ajustes mostrados | Sozinho passou 5 de 5 e a repetição do mesmo conjunto passou inteira (1.597 testes); a rodada não tocou o Inventário Físico em sessão. A asserção não mostra as `issues` da recusa: se voltar, capturar o corpo antes de mexer |

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

O único com posição na fila viva é o Inventário Físico (posição 3): o discovery
foi decidido e a implementação segue em fatias — a Fatia 1 saiu em 2026-09-15.
Os outros esperam a pergunta virar decisão. SUPPLIER-ADDRESS-01, que
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
aprovado. O discovery completo (INVENTORY-PHYSICAL-COUNT-DISCOVERY-01) está `DECIDIDO` desde 2026-09-15
([documento](discovery/INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md)); a implementação é INVENTORY-PHYSICAL-COUNT-01, posição 3
da fila viva, em fatias — a Fatia 1 (domínio e API) saiu em 2026-09-15.

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

### CUSTOMER-MASTER-DATA-AUDIT-01 — histórico do cadastro do Cliente — P2 · FUTURO

Registrado pelo PO em 2026-09-16 (CUSTOMER-EDIT-PERMISSIONS-01), **sem posição e sem implementação**. O cadastro do
Cliente guarda só quem criou, quem alterou por último e quando (`createdBy*`, `updatedBy*`, `updatedAt`): uma troca de
CNPJ, de razão social ou de perfil tributário não deixa rastro do valor anterior. A situação cadastral já tem histórico
append-only (§95); o cadastro, não. A pergunta a responder: vale um histórico append-only de antes/depois para os
campos estruturais (CNPJ, razão social, perfil tributário e outros), para quais campos, quem lê, e como convive com os
snapshots que os documentos já congelam. Exigiria migration. Quem pode alterar já está decidido (§98).

### MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01 — Onda 2: consolidar os grupos aprovados — P1 · SANEADO NO DEV, FORA DE PROD

**Executada no `veridi_dev` em 2026-09-17** (§118; seção própria do `PROJECT_STATE.md`): 8/8 grupos, 11 Itens
removidos, 7 canônicos com `declaredNutrient` consolidado, duas relações com fornecedor consolidadas; PROD e Railway
intocados. Pendente: a mesma onda em PROD, com conferência READ ONLY, PLAN em PROD, backup restaurável e aprovação do PO
antes — o código do ERP sai de sequence por banco, e a decisão confere o código da planilha dos dois lados. **Antes de
PROD, também a V4 com a Veridi** (o que `*`/`**` significam no nutriente): no G5, "Clorogênico" = "Clorogênico**" é
equivalência declarada só para o DEV, na integração de 2026-09-17 — não regra geral de asterisco —, e a resposta pode
mudar a decisão do grupo. O texto abaixo é o registro da aprovação.

Aprovado pelo PO em 2026-09-17, na integração de MASTER-DATA-DUPLICATE-SANITIZATION-01 (§114). São nove
consolidações, em duas naturezas:

| Grupo | Registros | Natureza |
|---|---|---|
| Arabinogalactana | MP-000115 · MP-000322 | mesmo material, nutrientes diferentes |
| Beta-glucana de levedura | MP-000118 · MP-000304 | idem |
| Concentrado de tomate | MP-000165 · MP-000324 · MP-000347 · MP-000349 | idem (quatro linhas) |
| Fosfato de magnésio dibásico | MP-000204 · MP-000285 | idem |
| Fosfato de cálcio monobásico | MP-000269 · MP-000283 | idem |
| Fosfato de cálcio tribásico | MP-000270 · MP-000284 | idem |
| Membrana de casca de ovo | MP-000312 · MP-000317 · MP-000319 | idem (três linhas) |
| Sachê de sílica gel 5 g | ME-000021 · ME-000089 | **par nomeado**: difere por acento, e o PO declarou duplicado verdadeiro |

**O que a ferramenta ainda não fazia** — e passou a fazer nesta capability (§118):

1. **Escrever o campo consolidado no canônico.** A regra do PO para `declaredNutrient` é juntar os valores ÚNICOS na
   forma "A · B · C", sem repetir termo. Hoje o saneamento só move referência e remove — nunca altera o canônico —, e é
   justamente por divergir em `declaredNutrient` que estes sete grupos saem BLOQUEADOS. Precisa de uma consolidação
   declarada por coluna, com o valor final no PLAN antes de gravar.
2. **Aceitar par nomeado fora da regra automática.** A sílica não vira grupo: a regra preserva acento, de propósito. O
   par entra por decisão versionada, como o arquivo da §110 — e **sem** tornar a regra geral accent-insensitive.
3. **Reavaliar as colisões de índice único** nos grupos que têm relação com fornecedor (o `supplier_items` parcial de
   preferencial hoje bloqueia por não ser calculável).

Fora desta onda, por decisão do PO: MP-000149/475, MP-000325/348, MP-000320/468, MP-000014/022 e MP-000393/486
continuam em revisão (podem ser materiais diferentes), e o Modelo "X" (FT-000001 × FT-000002) segue bloqueado até se
saber conteúdo, versões, referências, se algum é descartável e o impacto da colisão de `versionNumber`. **Decididos na
Onda 3** (seção abaixo, §124).

### MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-3-01 — Onda 3: fundir, renomear, excluir o sem uso — P1 · SANEADO NO DEV, FORA DE PROD

**Executada no `veridi_dev` em 2026-09-17** (§124; seção própria do `PROJECT_STATE.md`), depois da revisão READ ONLY
MASTER-DATA-DUPLICATE-REVIEW-03: G4 maçã fundido em MP-000475 ("Açúcar de maçã · Carboidrato"); G7 oliva e G13 guaraná
renomeados para nome técnico distinto (MP-000320 "… — Verbascosídeo", MP-000468 "… — Hidroxitirosol", MP-000393
"Extrato de guaraná 22%"; MP-000486 mantém o nome); Modelos "X" FT-000001 e FT-000002 excluídos com a V1 DRAFT de cada
um. Restam 2 grupos em revisão. PROD e Railway intocados.

Pendente:

- **A Veridi responde** (a resposta não se infere): o que `*` e `**` significam no nutriente (G6 e G11, a V4); o teor
  real de ácido clorogênico do MP-000325 e do MP-000348; se as cotações FLORIEN R$160/kg (1 kg) e R$650/kg (100 g) são a
  mesma especificação; e por que o código legado 349 aparece com 8%, 45% e 50% nas fórmulas antigas. Com a resposta, o
  PO decide a ação de G6 e G11 numa onda seguinte.
- **A mesma onda em PROD**, como a Onda 2: conferência READ ONLY, PLAN em PROD (o código do ERP sai de sequence por banco
  e os Modelos "X" são dado do DEV — o que houver em PROD é outro registro), backup restaurável e aprovação do PO.
- ~~**A carga não reproduz renomeação nem consolidação**~~ — **FECHADO em 2026-09-18 por ITEM-IMPORT-WAVE-3-CONSISTENCY-01**
  (na `main`, fora de PROD, sem migration): com o pacote, a carga grava o `declaredNutrient` consolidado nos canônicos das
  Ondas 2 e 3 e o nome técnico do MP-000320, MP-000468 e MP-000393, conferidos contra o pacote, e o VERIFY acusa base
  que não reflete a decisão. O rebuild num banco descartável chegou aos mesmos 798 Itens do DEV saneado, campo a campo,
  com os mesmos 2 grupos repetidos (G6, G11); reexecutar não recria absorvido nem desfaz renomeação.
- O `family` "OTHER_RAW_MATERIAL" que só o MP-000149 tinha saiu com ele (a decisão só consolidou o nutriente; o canônico
  segue sem família).

### MASTER-DATA-NAME-UNIQUENESS-01 — índice único de nome no banco — P1 · DEPOIS DO SANEAMENTO

Registrado em 2026-09-17 por MASTER-DATA-DUPLICATE-SANITIZATION-01 (§114), **sem implementação e de propósito sem
migration naquela rodada** — a janela de Uso e Consumo estava criando a dela, e duas migrations concorrentes se
atropelam.

O guarda da API já recusa nome repetido sem caixa nos nove cadastros, e **não substitui a constraint**: entre o SELECT
e o INSERT há uma janela em que duas requisições simultâneas passam as duas. Fechá-la é criar, no banco, o índice único
funcional `CREATE UNIQUE INDEX … ON <tabela> (upper(btrim(<coluna>)))` — a MESMA expressão do guarda e da ferramenta de
saneamento, para que os três nunca discordem.

O que precisa acontecer **antes**, e é o motivo de esta capability não ter data:

1. **o saneamento tem de fechar.** O índice não nasce por cima de duplicata existente: o `CREATE UNIQUE INDEX` falha e a
   migration não aplica. Depois da Onda 3 (§124), o `veridi_dev` tem 2 grupos, ambos em revisão com a Veridi (G6 café
   verde e G11 fosfato de piridoxal) — cada um é decisão de produto, e a ferramenta recusa escolher sozinha. A carga já
   reproduz fusão, consolidação e renomeação das ondas (ITEM-IMPORT-WAVE-3-CONSISTENCY-01): o rebuild pelo pacote chega
   aos mesmos 2 grupos do DEV, então o índice quebraria o rebuild só por G6 e G11 — o esperado até a Veridi responder;
2. **PROD tem de ser medido**, em conferência READ ONLY: o estado do DEV não prova o de PROD, e os códigos do ERP saem
   de sequence por banco;
3. **o escopo do Item já está decidido**: o PO fixou em 2026-09-17 que os quatro tipos (RAW_MATERIAL, PACKAGING,
   FINISHED_PRODUCT e INTERNAL_CONSUMABLE) dividem **um único** espaço de nomes, então o índice é um só sobre
   `items` — não um por tipo.

Quando as três estiverem resolvidas, a migration é uma só, com um índice por cadastro, e o guarda da API continua —
mensagem amigável é da aplicação, não do banco.

**Edição do cadastro legado** (MASTER-DATA-DUPLICATE-GUARD-LEGACY-EDIT-01, 2026-09-18, §114): enquanto o índice não
existe, o guarda impede duplicidade NOVA e deixa editar o cadastro que já nasceu duplicado quando o nome efetivo não
muda — PROD tinha 21 grupos / 45 Itens no preflight de 2026-09-18, e cada Salvar deles dava 409. Isso não muda o índice
nem o que vem antes dele: continua bloqueado pelos grupos não resolvidos — G6 e G11 no DEV e, em PROD, o que as ondas
ainda não sanearam lá.

### MASTER-DATA-STRUCTURAL-LOCKS-01 — travas estruturais do cadastro mestre — sem posição

Registrado em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (DE11 do PO), **sem implementação**. Hoje a única trava
de campo estrutural é `Item.operationallyUsed` (OC, recebimento, lote ou movimento travam tipo, unidade, lote e
validade). Ficaram de fora, sem trava nenhuma: Item usado em Formulação ou Modelo (mudar tipo ou unidade reescreve o
significado das linhas), item de produto acabado ligado a Produto, e `PATCH /products/:id`, que religa ou desliga o PA
do Produto sem conferir lote, OP ou Pedido. A pergunta: quais vínculos travam quais campos, e se a recusa é por campo
(como `structural_field_locked`) ou por ato. Quem pode editar já está decidido (§100).

### MASTER-DATA-STATUS-HISTORY-01 — motivo e histórico de Inativar/Reativar — P2 · FUTURO

Registrado em 2026-09-16 por MASTER-DATA-EDIT-PERMISSIONS-01 (DE5 do PO), **sem posição e sem implementação**. Item,
Fornecedor e Produto inativam e reativam sem motivo e sem histórico: só `active` e `updatedAt` mudam. O Cliente já tem
motivo obrigatório e histórico append-only (§95). A pergunta: motivo obrigatório nos três, histórico com autor e data,
e se a reativação do Item continua mais estreita (Qualidade e Administrador) quando houver motivo registrado. Exigiria
migration. Quem inativa e reativa, e o 409 da transição repetida, já estão decididos (§100).

### SUPPLIER-ITEMS-UX-01 — Fornecedor → Itens administrável no cadastro do Fornecedor — sem posição

Fatia 2 do [ITEM-SUPPLIER-UX-DISCOVERY-01](discovery/ITEM-SUPPLIER-UX-DISCOVERY-01.md), adiada pela D4 do PO
(2026-09-16), **sem posição e sem implementação**. Hoje a seção Itens fornecidos do Fornecedor só lista, com o caminho
para Compras › Item × Fornecedor. A Fatia 1 fechou em ITEM-SUPPLIER-UX-01 (§102): `FornecedoresDoItemSection`,
`SupplierItemFormModal` com `itemFixo` e `preferencial.tsx` são o ponto de partida — com o Fornecedor fixo, o seletor
passa a ser o de Item. Sem migration. Para decidir junto: levar à tela geral a confirmação da troca de preferencial que o
cadastro do Item já pede (hoje o "Marcar como preferencial" do detalhe na tela geral troca direto, D2; a E2E
`oferta-de-fornecedor-vira-custo` passa por ele).

### STORAGE-R2-ACTIVATION-01 — ligar o Cloudflare R2 no Railway — P1 · AGUARDANDO O PO

Registrado em 2026-09-16 por LABEL-ATTACHMENTS-01, **sem nada feito no Railway**. O código está pronto e desligado: sem
variáveis, o arquivo do Item Rótulo vai para o volume (`LOCAL_FS`). Ligar = cadastrar `VERIDI_STORAGE_PROVIDER=R2`,
`VERIDI_R2_ENDPOINT`, `VERIDI_R2_BUCKET`, `VERIDI_R2_REGION=auto`, `VERIDI_R2_ACCESS_KEY_ID` e
`VERIDI_R2_SECRET_ACCESS_KEY` no serviço, e provar antes com `pnpm storage:r2:smoke` na mesma credencial
([`DEPLOY.md`](DEPLOY.md) §6.1). Infra já pronta pelo PO: bucket privado `veridi-homologacao` e token S3 restrito a
ele; o smoke real com essa credencial, injetada fora do Git, passou em 2026-09-16 (upload, head, download com bytes
iguais, sobrescrita recusada, objeto apagado). Decidir também se PROD usa o mesmo bucket de homologação ou um próprio —
o bucket mora só na variável.

### ATTACHMENTS-R2-MIGRATION-01 — anexos genéricos no adaptador de storage — P2 · FUTURO

Registrado em 2026-09-16 por LABEL-ATTACHMENTS-01, **sem posição**. `Attachment` (lote, recebimento, produto, projeto,
amostra) segue em `lib/file-storage.ts`, no volume: 10 MB, extensão × MIME sem assinatura, download lido inteiro em
memória. A pergunta: vale levar esses anexos ao `StorageAdapter` (provedor por linha, streaming, assinatura) e ao R2, e
como mover os arquivos que já estão no volume sem perder nenhum — cópia verificada por hash antes de trocar o provedor
de cada linha. Exigiria migration (provedor por anexo).

### LABEL-FILE-SUBTYPE-CHANGE-01 — Item Rótulo com versões que troca de subtipo — LOW · sem posição

Visto em 2026-09-16 por LABEL-ATTACHMENTS-01. `packagingSubtype` não é campo estrutural: um Item Rótulo com arquivo
pode virar Pote pela edição. As versões ficam no banco e no storage, mas a seção some da tela e não aceita versão nova
(409 `item_not_label`); voltar o subtipo para Rótulo devolve o histórico intacto. Nada se perde, mas o histórico fica
fora de vista. A pergunta, de cadastro mestre (vizinha de MASTER-DATA-STRUCTURAL-LOCKS-01): travar a troca de subtipo
quando houver versão, ou mostrar o histórico em consulta mesmo fora do subtipo.

### ASSISTED-ENTITY-SELECTOR-ROLLOUT-01 — consulta assistida nos demais seletores — sem posição

Registrado em 2026-09-17 por ASSISTED-ENTITY-SELECTOR-FOUNDATION-01, **sem implementação**. A fundação está na `main`:
`SearchableEntitySelect` com `onConsult` opt-in, `EntityConsultationDialog` e o piloto `ItemConsultationDialog` na
bancada (padrão em [`UI_BRAND.md`](UI_BRAND.md)). A pergunta, depois de validar o piloto com a Veridi: quais seletores
ganham a consulta, e em que ordem — Cliente, Fornecedor, Produto, Lote, o Item da Ordem de Compra e do Item × Fornecedor.
Cada um reusa o diálogo com as colunas e o recorte do próprio campo. Pontos já sabidos: (1) campo que aceita mais de um
tipo de Item (linha da OC: matéria-prima e embalagem) precisa de filtro aditivo na API (`types=`) — juntar páginas de
dois tipos no navegador quebra paginação e contagem; (2) seletor que mora dentro de modal (Item × Fornecedor) abre a
consulta como mais uma camada, e o Escape já fecha uma de cada vez (`modal-stacking`); (3) nova escolha é só de
ativo: campo cujo recorte traga inativo mostra a linha desabilitada, com o motivo, nunca selecionável.

Atualizado em 2026-09-17 por ASSISTED-ENTITY-MULTISELECT-01: a consulta também opera em seleção múltipla (até 10) na
ação de seção, com colunas por entidade (`detail`/`status`) — Formulação, Modelo e recursos do Modelo de Estrutura de
Custo. Candidatos à múltipla no rollout: (4) a etapa do Roteiro de Produção ("+ Adicionar recurso", mão de obra E
equipamento ativos) — mesmo problema do item (1), pede `types=` em `GET /industrial-resources`; (5) a Estrutura de Custos
grava cada uso de recurso pela API com o uso obrigatório, então lote ali é outra conversa (criar vários usos de uma vez).

### COST-TEMPLATE-RESOURCE-LINE-WITHOUT-USAGE-01 — linha de recurso sem uso por lote no Modelo de Estrutura — LOW, sem posição

Visto em 2026-09-17 por ASSISTED-ENTITY-MULTISELECT-01, **sem mudança**. No rascunho do Modelo de Estrutura de Custo,
"Salvar rascunho" envia só as linhas com recurso E uso por lote (`CostTemplateDetailPage`, filtro antes de
`resourceUsages`): a linha com recurso e uso em branco não vai, e a tela a mantém com "Alterações não salvas", sem dizer
qual linha falta. Era assim com "+ Adicionar recurso"; com "+ Adicionar recursos" (até 10 linhas de uma vez, uso em
branco para preencher) fica mais fácil cair nisso. A pergunta: recusar o salvar apontando a linha (como a bancada da
Formulação faz com a quantidade), ou avisar quais linhas ficaram de fora.

### ~~INTERNAL-CONSUMPTION-REVERSAL-01~~ — desfazer um consumo interno registrado — FECHADO em 2026-09-18

**Fechado em 2026-09-18** por INTERNAL-CONSUMPTION-REVERSAL-01 (§126), com as decisões P1–P10 do PO no
[discovery](discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md): estorno próprio (`ECI-`), entrada
`INTERNAL_CONSUMPTION_REVERSAL`, total ou parcial, só ADMIN e QUALITY, R-21 líquido na data do CI. Vale só para o
consumo interno — as outras saídas continuam sem estorno e pedem discovery própria. O texto abaixo registra quando
era pergunta.

Registrado em 2026-09-17 por INTERNAL-CONSUMPTION-01 (Fatia 2), **sem implementação e por decisão consciente**. O
consumo interno só CRIA: não há `DELETE`, não há estorno e o registro confirmado não é editado. Isso não é uma falta
desta capacidade — é o padrão do sistema inteiro: nenhum movimento físico confirmado desfaz hoje (recebimento,
consumo de produção, amostra e expedição também não). Inventar um estorno só aqui criaria um conceito que o resto do
estoque não tem, e que o relatório da Fatia 3 teria de interpretar sozinho.

O caminho que existe hoje para um consumo lançado errado é o Inventário Físico: conta o que realmente há e gera o
ajuste rastreável pela diferença. A pergunta ao PO, quando houver posição: um consumo interno errado merece estorno
próprio (movimento de entrada ligado ao `CI-` original, com motivo), ou a correção por inventário basta? Se a
resposta for estorno, ela provavelmente vale para as outras saídas também, e aí é uma decisão de estoque, não de uso
e consumo.

### INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01 — CI de data passada depois de inventário encerrado baixa duas vezes — MEDIUM, sem posição

Registrado em 2026-09-18 por INTERNAL-CONSUMPTION-REVERSAL-01, **sem correção** por decisão do PO (achado L2 do
[discovery](discovery/INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md)). O espelho da guarda do estorno: um consumo
interno com data passada, registrado DEPOIS de um inventário (sessão ou Contagem rápida) que já contou a falta física
daquele material, baixa o material de novo — a contagem já tinha ajustado o saldo pela diferença. O estorno recusa
quando a posição foi contada depois do `createdAt` do CI; a criação do CI não tem a guarda equivalente. A pergunta ao
PO: recusar (ou avisar) o consumo cuja data é anterior à última contagem encerrada da posição?

### DASHBOARD-INTERNAL-CONSUMPTION-01 — o Painel não representa Uso e consumo — P2, sem posição

Registrado em 2026-09-18 por INTERNAL-CONSUMPTION-REVERSAL-01, **fora da fatia** por decisão do PO (achado L1 do
discovery). O Painel conta movimentos por tipo (`applyMovementCount`) sem caso para `INTERNAL_CONSUMPTION` nem
`INTERNAL_CONSUMPTION_REVERSAL`: os dois não entram em card nenhum nem na atividade por dia, e na lista de
movimentações recentes aparecem com o rótulo do tipo e sem documento de origem. Decidir se o consumo interno ganha
card próprio (líquido dos estornos, como o R-21) ou entra num card existente.

### INTERNAL-CONSUMPTION-COST-CENTER-01 — Centro de Custo do consumo interno — sem posição

Registrado em 2026-09-17 por INTERNAL-CONSUMPTION-01, **explicitamente fora da fatia** por decisão do PO. Hoje o
destino/uso é texto livre e opcional ("Escritório", "Limpeza", "Expedição"). Texto livre agrupa mal: "Escritorio",
"escritório" e "ADM" viram três destinos no relatório. Desde INTERNAL-CONSUMPTION-REPORT-01 (§117) a falta está à
vista: o R-21 filtra e agrupa o destino pelo texto EXATO gravado, e as três grafias saem como três linhas no resumo
por destino. É o momento natural de decidir entre um cadastro de Centro de Custo e uma lista fechada de destinos.
Migrar depois é possível: o texto gravado vira o ponto de partida do mapeamento.

---

## Backlog reservado para go-live

Os itens deliberadamente adiados até a preparação final estão em [`BACKLOG_CLOSURE.md`](BACKLOG_CLOSURE.md).
**Status atual: INATIVO** — fora da Fila viva; só o PO ativa.

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

**RAW-MATERIAL-EXTERNAL-ENRICHMENT — enriquecimento externo da Matéria-prima —
DESCARTADO pelo PO em 2026-09-17.** O cadastro de Matéria-prima não é enriquecido
por fonte externa, e nem o Open Food Facts nem a ANVISA são integrados a ele. Não
se abre item de backlog nem discovery para isso. A decisão saiu do POC
ADHOC-RAW-MATERIAL-ENRICHMENT-POC-01: somente leitura, fora do repositório e já
removido, testou as duas fontes gratuitas contra cinco matérias-primas reais do
cadastro. Nenhuma delas traz o que a ficha da matéria-prima precisa — pureza, forma
química, CoA, fornecedor, especificação técnica —, porque esse dado vem do
fornecedor, não de base pública:

- **Open Food Facts** é base de produto de prateleira. A busca de texto livre
  devolveu potes de marca e, mais de uma vez, a substância errada (ácido cítrico
  para ácido ascórbico, L-glutamina para L-triptofano). Só a taxonomia de
  ingredientes e aditivos identificou a substância — nome traduzido, número E,
  Wikidata —, o que é referência, não cadastro. Serve a Produto Acabado e a dado
  de varejo.
- **ANVISA — Dados Abertos** (`DADOS_ABERTOS_ALIMENTO.csv`) registra produto, não
  insumo: dez colunas regulatórias (empresa, produto, processo, categoria,
  registro, vencimento, situação) e nenhum match de alta confiança nas cinco
  matérias-primas. "Creatina Monohidratada" aparece com esse nome exato em vários
  registros ativos, todos *Suplementos alimentares* de marca. Serve a dado
  regulatório de Produto.

O aproveitamento dessas fontes no cadastro de **Produto** ficou registrado como
discovery futuro em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md) ("Dados externos
do Produto"), fora da fila viva e sem compromisso.

---

## Próximo gate

A ordem está na fila viva, no topo. Gate paralelo: a validação com a Veridi (#7, #11) vale só para as regras que
dependem do processo real do cliente, e não impede #8E, #8F e #8G quando o PO autorizar. Material pronto:
`Guia_Fluxo_Comercial_Veridi.docx` (não versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
