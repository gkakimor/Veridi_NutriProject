# Mapa de cobertura — onde cada regra está protegida

Documento **vivo**. Serve a uma pergunta só: *esta regra tem proteção
automatizada hoje, e em que camada?*

Não é catálogo de testes. Lista regras que, se quebrarem, custam material,
dinheiro ou rastreabilidade. Ao mexer numa dessas áreas, o teste citado é o que
precisa continuar verde — e, se a mudança for de comportamento, é o que precisa
mudar junto, deliberadamente.

Caminhos relativos a `apps/api/src/`, `apps/web/src/` e `scripts/`.

## Como ler

**Camada canônica** é onde a regra *mora*. Matemática de domínio se prova em
teste de unidade, não clicando; regra de transação se prova na API; regra de
leitura de tela se prova no componente. Um E2E que prova de novo o que a camada
canônica já prova custa vinte minutos de navegador para dizer o mesmo.

## Formulação e quantidade física

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| `físico = teórico ÷ pureza × (1 + overage)` | fórmula reconstruída contra 26 componentes do legado | `lib/component-quantity-mode.test.ts` |
| Registrar ajuste **não é** autorizá-lo | pureza preenchida aplicava correção sozinha; na Coenzima Q10 dobraria | `lib/component-quantity-mode.test.ts`, `web pages/formulations/modo-quantidade.test.tsx` |
| `PHYSICAL_DIRECT` ignora pureza/overage | duas populações indistinguíveis pelo valor | `lib/component-quantity-mode.test.ts` |
| Base desconhecida **bloqueia**, não devolve zero | `switch` sem `default` derrubava a tela | `lib/component-quantity-mode.test.ts` |
| `dosesPerPackage` nulo é fail-closed | versão anterior fazia `?? 0` e anunciava custo R$ 0,00 completo | `modules/formulations/per-dose-integrity.test.ts`, `formulation-v2.test.ts` |
| `PER_DOSE` / `PER_FINISHED_UNIT` / `FIXED_BASIS` | fator vem da base do COMPONENTE | `modules/formulations/formulation-v2.test.ts` |
| Modo viaja no payload de gravação | omissão revertia componente teórico ao padrão, em silêncio | `web pages/formulations/modo-quantidade.test.tsx` |
| Ativar grava o rascunho antes | ativar descartava a edição da tela | `web pages/formulations/ativar-com-rascunho.test.tsx` |
| Versão ativa é imutável; nova versão não reescreve OP | CMV salvo mudaria sem decisão | `modules/formulations/historico-versao-e-op.test.ts` |
| Tela e OP chegam ao MESMO físico | motor único, cinco consumidores | `modules/formulations/historico-versao-e-op.test.ts` |
| Aritmética exibida reconstrói o número exibido | explicação omitia base e conversão de unidade | `web components/help/calc-hint.test.tsx` |
| Campo inválido nomeia componente e campo, marca `aria-invalid`/`aria-describedby`; salvar e ativar levam ao primeiro erro e abrem o painel; digitar não rola; recusa do servidor cai no campo | erro só no topo, linha a procurar | `web pages/formulations/validacao-inline.test.tsx` |
| Rótulos dos modos: "Quantidade física informada" / "Calcular quantidade física"; sem ajuste marcado nada é corrigido | "já ajustada"/"automaticamente" sugeriam correção ativa | `web pages/formulations/modo-quantidade.test.tsx` |

## Estoque, lote e ledger

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Estoque nunca fica negativo | — | `modules/inventory/inventory.test.ts` |
| FEFO: validade mais próxima primeiro, multi-lote | — | `modules/inventory/allocation.test.ts` |
| Lote bloqueado, vencido ou aguardando liberação não sai | — | `modules/shipments/shipments.test.ts`, `modules/inventory/unavailable-reason.test.ts` |
| Liberação de lote vencido é recusada | — | `modules/lots/expired-release.test.ts` |
| Reserva e consumo físico são distintos | — | `modules/inventory/allocation.test.ts`, `modules/production-orders/consumption.test.ts` |
| Dois pedidos não over-reservam o mesmo saldo | concorrência | `modules/shipments/shipments.test.ts` |
| Ajuste grava o usuário real e exige papel | achado adversarial: autoria de sistema | `modules/inventory/adjustment-audit.test.ts` |

## Propriedade do material (owner isolation)

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Lote `VERIDI` vs `CUSTOMER` — saldos separados no mesmo Item | — | `modules/inventory/customer-owned-material.test.ts` |
| Necessidade `VERIDI` não é coberta por estoque de cliente | — | `modules/inventory/customer-owned-material.test.ts` |
| Necessidade `CUSTOMER` só enxerga o estoque do próprio cliente | — | `modules/inventory/customer-owned-material.test.ts` |
| Plano de atendimento respeita o escopo do dono | — | `modules/customer-orders/plan-owner-scope.test.ts` |
| Aquisição de material do cliente não entra no custo | custo inflado com material que a Veridi não comprou | `modules/costs/customer-supplied-cost.test.ts` |

## Qualidade

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| CoA exigido bloqueia uso | — | `modules/quality/quality-documents.test.ts`, `modules/inventory/unavailable-reason.test.ts` |
| Produto aguardando liberação não é reservável | — | `modules/shipments/shipments.test.ts` |
| GMP: execução da OP registra autoria | — | `modules/production-orders/gmp-execution.test.ts` |

## Produção

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| OP congela a versão da fórmula que usou | — | `modules/formulations/historico-versao-e-op.test.ts`, `modules/production-orders/production-orders.test.ts` |
| Reconciliação de material antes de concluir | OP concluía com material por reconciliar | `modules/production-orders/material-reconciliation.test.ts` |
| Consumo extra exige ampliação explícita, com motivo e autor | achado da auditoria: 1,333333 → 1,34 | `modules/production-orders/extra-consumption.test.ts` |
| Apontamento gera 1 movimento e 1 lote acabado | — | `modules/production-orders/production-output.test.ts` |
| Consumo confirmado é o que baixa estoque | — | `modules/production-orders/consumption.test.ts` |

## Comercial, expedição e faturamento

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Expedição não sai acima do reservado | — | `modules/shipments/shipments.test.ts` |
| Confirmação é imutável; não expede em dobro sob concorrência | — | `modules/shipments/shipments.test.ts` |
| Linha de expedição exige conferência de lote | — | `modules/shipments/shipment-verification.test.ts` |
| Um único faturamento ativo por Expedição — índice parcial no banco | — | `modules/billings/billings.test.ts` |
| Faturamento herda o preço acordado do Pedido | — | `modules/billings/billing-price.test.ts` |
| Preço unitário exibe 2 a 4 casas e não é arredondado antes da conta | achado adversarial: `R$ 4,05` ao lado de total sobre `4,0531` | `modules/billings/billing-price.test.ts`, `web lib/currency` |
| Total do documento é a soma das linhas impressas | drift de centavo | `modules/billings/billing-price.test.ts` |
| Faturamento exige Expedição CONFIRMED | — | `modules/billings/billings.test.ts` |

## Rastreabilidade e recall

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Backward: lote acabado mostra os materiais REALMENTE consumidos | — | `modules/lots/traceability.test.ts` |
| Forward: matéria-prima mostra os lotes acabados gerados | — | `modules/lots/traceability.test.ts` |
| Lote apenas reservado e nunca consumido não aparece como usado | — | `modules/lots/traceability.test.ts` |
| **Saída física é por `ShipmentLine.lotId`, nunca pelo Pedido da OP** | achado adversarial HIGH: lote produzido para um Pedido e expedido em outro respondia "não foi expedido" | `modules/lots/traceability.test.ts` |

## Custos, CMV e preço

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| CMV salvo é documento; a versão vigente não o reescreve | — | `modules/product-cmv/product-cmv.test.ts`, `product-cmv-matrix.test.ts` |
| `batchCount = ceil(quantidade ÷ lote de referência)`, mínimo 1 | — | `modules/product-cmv/product-cmv.test.ts` |
| `P = C ÷ (1 − margem − comissão)` — comissão sai do preço | — | `modules/pricing/pricing.test.ts` |
| Estrutura de custo industrial e cópia de versão | — | `modules/industrial-costs/*.test.ts` |
| Cálculo industrial usa a base congelada | — | `modules/industrial-cost-calculation/calculation.test.ts` |
| Template de formulação/custo: cópia profunda | — | `modules/formulation-templates/formulation-templates.test.ts`, `modules/cost-templates/cost-templates.test.ts` |
| Fonte de custo: 30d → 90d → última compra → oferta válida → referência manual → desconhecido, num lugar só | referência manual escolhida com compra real existente | `lib/cost-source-selection.test.ts` |
| Referência manual respeita a data de referência e a unidade; ausência nunca vira zero | — | `lib/cost-source-selection.test.ts` |
| Ofertas válidas: uma → ela; várias com um preferencial → ele; sem preferencial ou com vários → seleção necessária, sem cair para a manual | primeira versão caía para a referência manual | `lib/cost-source-selection.test.ts` |
| Mesmo "válido desde": a criada por último vence; empate total é estável | leitura dependente da ordem física | `lib/cost-source-selection.test.ts` |
| Ambiguidade + referência forçada: fonte automática congelada como ambígua, impacto nulo, motivo ao salvar | — | `modules/industrial-cost-calculation/cost-override.test.ts` |
| Alterar referência cria vigência nova; unidade incompatível e negativo recusados; papel COMMERCIAL/ADMIN | — | `modules/items/item-cost-references.test.ts` |
| Item com referência inicial nasce atômico — recusada, nada fica pela metade | — | `modules/items/item-cost-references.test.ts` |
| Referência forçada: por cálculo e por componente, motivo ao salvar, fonte automática e impacto congelados | override que grudasse no item | `modules/industrial-cost-calculation/cost-override.test.ts` |
| Cálculo salvo não muda com referência nova nem compra nova | — | `modules/industrial-cost-calculation/cost-override.test.ts` |
| Material do cliente não ganha custo mesmo com referência no item | — | `modules/industrial-cost-calculation/cost-override.test.ts` |
| Conta do material na tela fecha e diz a fonte (e a automática, quando forçada) | — | `web components/cost-breakdown-calc-hint.test.tsx` |
| Escolha da fonte por material: automático é o padrão, forçar recalcula e trava salvar sem motivo | — | `web pages/industrial-costs/cost-source-override.test.tsx` |
| Tela do item: "Não informado" nunca é R$ 0,00; compra real vence a referência | — | `web components/item-cost-reference-section.test.tsx` |
| Estimativa da Formulação usa o MESMO seletor (30d, 90d, última, oferta única/preferencial, ambígua fail-closed, manual, desconhecido, cliente não aplicável, `referenceDate`); Formulação × motor do CMV: mesma fonte e mesmo custo unitário | estimativa lia só compra real e discordava do CMV | `modules/costs/formulation-cost-estimate.test.ts` |
| CMV por unidade = CMV total ÷ quantidade SIMULADA (não ÷ lote de referência); a explicação confere e acusa divergência | explicação dividia pelo lote, sem conferência | `modules/product-cmv/product-cmv.test.ts`, `web pages/product-cmv/cmv.test.tsx` |
| Preço sugerido explicado e conferido: custo ÷ (1 − margem − comissão) | explicação sem conferência | `web pages/cost-templates/pricing-policies.test.tsx` |

## Apresentação e entrada

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Decimal pt-BR: vírgula, sem adivinhar milhar | separador único vira casa decimal | `web lib/decimal-input.test.ts` |
| Quantidade não inventa precisão; pequeno vira `≈ 0`, nunca `0` | zero significa "não precisa de material" | `web lib/quantity` |
| Filtro de lista não oferece opção que a consulta recusa | achado adversarial | `modules/list-filter-options.test.ts` |
| Mensagem de erro tem `role` e é anunciada | 125 mensagens sem voz | `web` testes de formulário |
| Criação contextual volta para o campo que a pediu | — | `web lib/contextual-create.test.ts`, `pages/create-in-context-navigation.test.tsx` |
| Toda tela roteada abre "Como funciona"; tópico tem resumo, vocabulário, caminho e ressalvas; sem termo técnico | tela nova sem ajuda, ajuda que explica o código | `web pages/help-topic-contract.test.ts` |
| Cada tela principal nomeia os seus componentes relevantes no glossário (piso, não teto) | ajuda que omite o que está na tela | `web pages/help-topic-contract.test.ts` |
| Cada tela principal abre o tópico da própria área (lista ≠ documento) | Pedido abria a ajuda do Plano | `web pages/help-topic-contract.test.ts`, `pages/help-*-screens.test.tsx` |

## Permissões

| Regra | Proteção canônica |
|---|---|
| Papel decide quem ajusta estoque, conta inventário, precifica | `modules/inventory/adjustment-audit.test.ts`, `modules/auth/auth.test.ts`, `modules/pricing/pricing.test.ts` |
| Leitura escopada por Cliente recusa entidade de outro | `modules/customer-consultation/customer-consultation.test.ts` |

## Migração e importadores

| Regra | Proteção canônica |
|---|---|
| Importação idempotente, não duplica e não movimenta estoque | `scripts/veridi-import/importer.test.ts` |
| Endereço legado decomposto de forma conservadora | `scripts/veridi-data/legacy-address.test.ts` |
| Oferta com unidade incompatível exige override explícito | `scripts/veridi-import/importer.test.ts` |
| Toda migration só usa tabela, tipo e coluna criados por migration de nome menor ou igual; banco vazio reconstrói só com o repositório | `scripts/migration-order.test.ts` · `pnpm validate:migrations:fresh` (Postgres local descartável) |

## O que foi aposentado, e por quê

Em 2026-09-04 saíram 51 scripts (≈35 mil linhas): 24 roteiros `validateNN.mjs`
de aceitação de entrega, 5 validações de rodada, as 4 suítes adversariais mais
o seu harness, 5 reprodutores de achado de UI já fechado, 3 codemods já
aplicados e os 3 E2E grandes derivados do legado.

Cada regra que eles protegiam está na tabela acima, numa camada menor e
determinística. **Uma** exigiu teste novo antes da remoção: a saída física por
`ShipmentLine.lotId`, que só tinha o caso vazio testado — o teste foi escrito,
verificado contra o defeito reintroduzido de propósito, e só então o script saiu.

Histórico dos achados: [`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md).
