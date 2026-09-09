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
| Tela e OP chegam ao MESMO físico | motor único, seis consumidores | `modules/formulations/historico-versao-e-op.test.ts` |
| Estimativa de custo usa a MESMA quantidade física dos Requirements | estimativa multiplicava o custo pela quantidade declarada só convertida; 60 doses = material 60× menor | `modules/costs/custo-estimado-quantidade-fisica.test.ts` |
| "Equivalente estoque" é a mesma grandeza em rascunho e em versão ativa | ativa caía em `stockEquivalentQuantity`, rascunho na prévia do motor: 60× na mesma célula | `web pages/formulations/equivalente-estoque.test.tsx` |
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
| Expedição em edição: já expedido (histórico), expedindo agora (prévia das linhas) e restante após — mesma conta da confirmação; acima do reservado ou do que falta trava, nunca saldo negativo; estoque só muda ao confirmar | "Expedindo agora" gravado ao lado de quantidade viva; "Total" cru entre produtos | `packages/shared/src/shipments.test.ts`, `modules/shipments/shipments.test.ts`, `web pages/shipments/expedicao-previa.test.tsx` |
| Faturamento exige Expedição CONFIRMED | — | `modules/billings/billings.test.ts` |
| Faturamento em edição: linha, documento e prévia pela mesma conta (`calcularTotaisFaturamento`, Decimal); alterar preço mostra linha e documento resultantes antes de confirmar, ao lado dos gravados; rodapé "Valor total (prévia)"; ilegível/negativo sem R$ 0,00 e confirmação travada; acordado e emitido intactos | total só aparecia depois de confirmar a alteração; tela somava em `Number` e API em `Decimal` | `packages/shared/src/billings.test.ts`, `modules/billings/billing-price.test.ts`, `web pages/billings/faturamento-previa.test.tsx` |

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
| Orçamento em rascunho: total de linha e "Total da proposta (prévia)" ao vivo pela mesma conta do documento (`calcularTotaisOrcamento` + `buildPaymentSchedule`, em `@veridi/shared`, usados pela API); "Total salvo" nomeado enquanto há edição pendente; sem requisição por tecla; ausente/ilegível sem total falso; versão enviada ou aceita não recalcula | campos não controlados mantinham o total do salvamento anterior durante a digitação | `packages/shared/src/quote-math.test.ts`, `modules/projects/projects.test.ts`, `modules/projects/quote-payment.test.ts`, `web pages/projects/orcamento-previa.test.tsx` |
| Prévia da faixa antes de gravar: custo da quantidade pelo mesmo caminho da criação (`tiers/preview`, sem persistir), preço/contribuição/markup por `computePrice` de `@veridi/shared` (um motor); operando faltante sem R$ 0,00; margem + comissão ≥ 100% recusada | preço só aparecia depois de gravar | `packages/shared/src/pricing-math.test.ts`, `modules/pricing/pricing.test.ts`, `web pages/pricing/faixa-previa.test.tsx` |
| Subtotal comercial = Σ dos totais de linha JÁ arredondados (2 casas), nunca `round(Σ linhas brutas)`; caso de divergência com preço de 4 casas provado do shared à tela, à API e ao Pedido | com 4 casas, proposta e Pedido fechavam com um centavo de diferença | `packages/shared/src/quote-math.test.ts`, `modules/projects/project-integration.test.ts`, `web pages/projects/orcamento-previa.test.tsx` |
| Pedido originado de proposta aceita congela o subtotal, o total e o plano DA PROPOSTA, pela mesma função; proposta e Pedido históricos não são recalculados nem sofrem backfill | `quote-to-order` tinha a própria soma — segundo motor sobre o mesmo acordo | `modules/projects/project-integration.test.ts` |
| Resumo do Faturamento dentro do Pedido usa `calcularTotaisFaturamento` — mesmo número do documento | resumo somava sem arredondar: R$ 1.927,42 no Pedido × R$ 1.927,41 no Faturamento | `modules/billings/billing-price.test.ts` |
| Ausência de precificação vigente responde 200 com `{ pricing: null }`; 404 é só linha inexistente; 403 e erro interno seguem distintos e não viram estado vazio | 404 para estado normal deixava `console.error` em toda consulta de tela sã | `modules/projects/project-integration.test.ts`, `web lib/quote-pricing-options.test.ts` |
| Custo por OP tem dois contratos: o DETALHE responde 404 quando a OP não existe; a LISTAGEM, que resolve o custo depois de já ter lido as linhas, trata OP sumida como linha sem custo e continua respondendo 200 | BACKLOG #17 — a listagem importava o 404 do detalhe: uma OP removida entre as duas leituras derrubava a tela inteira com 500 e o consumidor recebia `rows` indefinido | `modules/costs/costs.test.ts`, `modules/finished-goods/finished-goods.test.ts` |

## Precisão numérica

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Motor decimal em 40 dígitos significativos, numa configuração canônica só; `precision` e nada mais — `rounding` segue `ROUND_HALF_UP` | `decimal.js` e `Prisma.Decimal` são construtores DIFERENTES: configurar um deixava o outro em 20, e a API roda no do Prisma | `packages/shared/src/decimal-config.test.ts`, `apps/api/src/lib/decimal.test.ts` |
| Quantidade e grandeza técnica persistem 12 casas: `0,000000048` grava `0,000000048000`, nunca `0,000000` | BACKLOG #19 — `Decimal(18,6)` zerava microdosagem e a OP dizia que não precisava do material | `apps/api/src/modules/inventory/precision-round-trip.test.ts` |
| Entrada acima de 12 casas é recusada, não arredondada em silêncio | o operador digitava um número e o banco gravava outro sem dizer | `apps/api/src/lib/decimal-schema.test.ts` |
| Custo unitário persiste 8 casas do recebimento ao seletor canônico: `4,05318764` nunca vira `4,0532` | BACKLOG #19 / PREC-MIG-B — `actualUnitCost` é a origem de TODO custo real (média 30d/90d, último custo, custo do lote) | `apps/api/src/modules/costs/unit-cost-precision.test.ts` |
| Média ponderada soma `Σ(qtd × custo) ÷ Σ qtd` sem corte intermediário; a dízima chega inteira ao motor | custo cortado na entrada já entrega operando errado, e nenhuma aritmética adiante percebe | `apps/api/src/modules/costs/unit-cost-precision.test.ts` |
| Custo acima de 8 casas é recusado na fronteira; recusa não grava parcial; limpar devolve `null`, nunca zero | ausência de custo é desconhecido, não zero | `apps/api/src/modules/costs/unit-cost-precision.test.ts` |
| Pureza e overage persistem 6 casas: `99,9995%` grava `99.999500` e continua distinto de `100.000000`; overage de `0,000001%` não vira zero | BACKLOG #19 / PREC-MIG-C — `Decimal(6,3)` arredondava o laudo de ensaio para 100% em silêncio | `apps/api/src/modules/formulations/precisao-pureza-overage.test.ts` |
| O motor consome as 6 casas sem arredondamento intermediário; `físico = teórico ÷ (pureza/100) × (1 + overage/100)` inalterado; `PHYSICAL_DIRECT` segue documental e `PER_DOSE` sem doses segue fail-closed | operando cortado entrega conta errada sem nenhuma etapa adiante perceber | `packages/shared/src/formulation-precisao.test.ts` |
| Pureza/overage acima de 6 casas são recusados na fronteira, em Item, Formulação e template; a faixa de negócio (`0 < pureza <= 100`, overage `>= 0`) não mudou com o scale | scale maior não é autorização de negócio, e acima dele o PostgreSQL voltaria a arredondar sem avisar | `apps/api/src/modules/formulations/precisao-pureza-overage.test.ts` |
| Template → versão → Formulação preserva as 6 casas; a OP congela pureza/overage e V2 mais precisa não reescreve OP histórica | perda entre template e receita apareceria como divergência sem causa visível | `apps/api/src/modules/formulations/precisao-pureza-overage.test.ts` |
| Abrir e salvar sem editar devolve a pureza intacta à API — a tela não é onde a precisão some | precisão escondida: uma tela de leitura destruiria o dado sem decisão humana | `web pages/items/precisao-pureza.test.tsx` |
| Preço documental, tarifa e percentual comercial não migram junto por semelhança de nome | UNIT_PRICE, RATE e PERCENTAGE comercial são categorias distintas de UNIT_COST e de PURITY/OVERAGE | `scripts/numeric-precision-matrix.test.ts` |
| Preço unitário da OC persiste 8 casas: `4,05318764` grava e volta inteiro, e `0,00000001` não vira zero | BACKLOG #19 / PREC-MIG-P — `Decimal(14,4)` gravava `4,0532` sem dizer que trocou o número | `apps/api/src/modules/purchase-orders/unit-price-precision.test.ts` |
| Preço da OC acima de 8 casas é recusado na criação E na edição; recusa não grava parcial | acima do scale o PostgreSQL voltaria a arredondar em silêncio | `apps/api/src/modules/purchase-orders/unit-price-precision.test.ts` |
| Round-trip do preço da OC (banco → API → tela → API → banco) preserva 4, 6 e 8 casas; o DTO viaja como string, nunca como JSON number | `number` no transporte devolve o valor ao `double` de quem lê | `apps/api/src/modules/purchase-orders/unit-price-precision.test.ts` |
| Abrir a OC, não editar e salvar devolve `4,05318764` — a máscara de 4 casas não vira o valor persistido | precisão escondida: a tela destruiria o dado sem decisão humana | `web pages/purchase-orders/oc-preco-precisao.test.tsx` |
| Preço preciso e total documental são independentes: `10 × 4,05318764` fecha em `R$ 40,53` e o preço gravado continua com 8 casas | fechamento documental não pode voltar a ser operando — `PRODUCT_RULES.md` §57 | `apps/api/src/modules/purchase-orders/unit-price-precision.test.ts` |
| O rodapé da OC é a soma das linhas impressas: `40,53 + 0,13 + 0,13` fecha `40,79`, não `40,78` | BACKLOG #18 / §61 — um rodapé que não bate com a soma da página destrói a confiança no documento | `packages/shared/src/purchase-orders.test.ts`, `apps/api/src/modules/purchase-orders/reconciliacao-monetaria.test.ts`, `apps/api/src/modules/purchase-orders/unit-price-precision.test.ts` |
| INVARIANTE: `orderTotal === Σ lineTotal` para qualquer conjunto de linhas — preço de 8 casas, empates, quantidade fracionária, linha sem preço, zero e valor ilegível | é o contrato do #18; se o rodapé voltar a somar valores brutos, é aqui que aparece | `packages/shared/src/purchase-orders.test.ts`, `apps/api/src/modules/purchase-orders/reconciliacao-monetaria.test.ts` |
| Meio centavo sobe (`1 × 0,125 → 0,13`), com `ROUND_HALF_UP` declarado na chamada — sobrevive à troca do rounding global | o critério que decide o centavo de um documento não pode depender de um default — §60 e §61 | `packages/shared/src/purchase-orders.test.ts` |
| Todas as superfícies mostram o MESMO total da OC: documento, prévia da tela, relatório de Compras e OC vinculada dentro do Pedido | duas somavam por conta própria, e o mesmo documento valia dois números conforme a tela | `apps/api/src/modules/purchase-orders/reconciliacao-monetaria.test.ts`, `web pages/purchase-orders/oc-total-previa.test.tsx` |
| O operando não é arredondado pelo fechamento: preço `DECIMAL(20,8)` e quantidade `DECIMAL(24,12)` entram inteiros; `0,000000048 × 1.000.000` fecha `0,05` | reduzir o operando antes da conta zeraria a linha — §57 | `apps/api/src/modules/purchase-orders/reconciliacao-monetaria.test.ts`, `packages/shared/src/purchase-orders.test.ts` |
| O total documental da OC não alimenta custo: com a OC precificada e sem recebimento, o item continua `NO_COST` | preço de compra não é custo real, e valor fechado de documento nunca vira operando técnico — §61 | `apps/api/src/modules/purchase-orders/reconciliacao-monetaria.test.ts` |
| O preço da OC continua sendo só referência no Recebimento, servido em 8 casas para o atalho "Usar preço da OC" não gravar custo arredondado | preço não é custo, e um atalho que corta o operando inventa um custo que ninguém digitou | `apps/api/src/modules/purchase-orders/unit-price-precision.test.ts`, `apps/api/src/modules/costs/costs.test.ts` |
| Preço TÉCNICO da precificação persiste 8 casas: `4,05318764` grava e volta inteiro na faixa manual, no sugerido e no selecionado; `0,00000001` não vira zero | BACKLOG #19 / PREC-P-TECH — `Decimal(14,6)` gravava `4,053188` sem `.toFixed()` no código: quem cortava era o PostgreSQL | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| A ativação reduz o resultado de 40 dígitos do motor para 8 casas ANTES do `update` — o valor servido em rascunho e o servido depois de gravar são o mesmo | banco como primeira camada de arredondamento é decisão que ninguém tomou | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| Preço técnico acima de 8 casas é recusado na criação E na edição da faixa; recusa não grava parcial | acima do scale o PostgreSQL voltaria a arredondar em silêncio — §58 | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| A proveniência congelada no ENVIO do Orçamento carrega as 8 casas da faixa; `QuoteLine.unitPrice` carrega 4 — a mesma linha guarda os dois números de propósito | `pricingSelectedUnitPriceSnapshot` responde "qual preço técnico originou a linha?", `unitPrice` responde "qual preço foi congelado no documento?" — §60 | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| O fechamento `técnico → comercial` é uma operação nomeada, com `ROUND_HALF_UP` **declarado na chamada** (nunca banker's), idempotente e em `Decimal` | um `.toFixed(4)` sem nome é indistinguível de defeito e acaba "corrigido" por engano | `apps/api/src/lib/commercial-price.test.ts` |
| O fechamento do preço técnico em 8 casas é operação nomeada, com `ROUND_HALF_UP` **declarado na chamada** | a redução de 40 dígitos para 8 é regra de domínio; deixá-la implícita a devolvia ao default da biblioteca | `apps/api/src/lib/technical-price.test.ts` |
| As duas fronteiras sobrevivem à troca do `Decimal.rounding` global: com banker's ligado no processo, `4.05325 → 4.0533` e `4.053187645 → 4.05318765` continuam valendo | uma capability futura que trocasse o rounding global moveria em silêncio o centavo de todo documento comercial — §60 A/B/C | `apps/api/src/lib/commercial-price.test.ts`, `apps/api/src/lib/technical-price.test.ts` |
| Pedido e Faturamento copiam `4,0532` exatamente; nenhum elo comercial volta a 8 casas, e o snapshot técnico de origem continua com as 8 | cópia comercial não rearredonda, e proveniência não vira preço contratado | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| O total do documento sai do preço COMERCIAL: 500 × `4,0532` fecha `2026,60`, e não os `2026,59` do preço técnico — regra #15 intocada | snapshot técnico não pode virar operando de total comercial | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| Preço COMERCIAL acima de 4 casas é recusado antes do PostgreSQL — linha do Orçamento, preço faturado e override; recusa não grava parcial | a recusa de §58 vale nos dois sentidos da fronteira, não só do lado preciso | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts`, `apps/api/src/modules/billings/billing-price.test.ts` |
| RESULTADO TÉCNICO persiste 12 casas: comissão e contribuição por unidade saem do motor com mais de 6 casas e chegam inteiras ao DTO; `1,234567890123` sobrevive; histórico de 6 casas atravessa como `0,202659000000` | BACKLOG #19 / PREC-MIG-D — `Decimal(14,6)` gravava `0,202659` no `UPDATE` da ativação, sem `.toFixed()` no código: quem cortava era o PostgreSQL | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| A ativação fecha o resultado de 40 dígitos em 12 casas ANTES do `update`, e a PRÉVIA da faixa mostra exatamente o mesmo número que será gravado | banco como primeira camada de arredondamento é decisão que ninguém tomou; prévia que discorda do `update` na última casa é pior que prévia nenhuma | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| Resultado interno com MAIS de 12 casas é fechado, nunca recusado — a ativação responde 200 | entrada de usuário acima do scale é 400 (§58); resultado calculado longo é normal (§62) | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| A contribuição congelada no ENVIO do Orçamento carrega as 12 casas da faixa — cópia, não recálculo; e `QuoteLine.unitPrice`, o total de linha e o subtotal não se movem | resultado técnico é leitura econômica, nunca operando de total comercial — #15 e #18 intocados | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| `null` continua `null` e zero continua zero; contribuição NEGATIVA persiste com sinal e 12 casas | ausência de resultado não é zero, e preço abaixo do custo é informação comercial legítima | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| O fechamento do resultado técnico em 12 casas é operação nomeada, com `ROUND_HALF_UP` **declarado na chamada**, e sobrevive à troca do `Decimal.rounding` global: com banker's ligado, `0.2026593333345 → 0.202659333335` continua valendo | a redução de 40 dígitos para 12 é regra de domínio; deixá-la implícita a devolvia ao default da biblioteca — §62 | `apps/api/src/lib/technical-result.test.ts` |
| Tela de Precificação: a máscara de leitura (`R$ 0,65`) nunca vira o valor persistido; adicionar faixa envia só os operandos digitados; ativar não reenvia resultado derivado; a prévia da tela parte do custo de 12 casas | resultado derivado não pode passar a depender da precisão do navegador — §57 e §62 | `web pages/pricing/resultado-tecnico-precisao.test.tsx` |
| A precisão `14,6` não existe mais no schema, e os `14,4` de composição de custo, totais de precificação e tarifa NÃO subiram junto | PREC-MIG-D não é balde de resto: alvo órfão é `NEEDS_PO_DECISION`, e vai para o PREC-MIG-E | `scripts/numeric-precision-matrix.test.ts` |
| O custo industrial POR UNIDADE congelado no Orçamento preserva 12 casas: faixa, proveniência do rascunho, envio e coluna carregam o MESMO número | BACKLOG #19 / PREC-E-01 — `(1000,00 ÷ 300)` vale `3,333333333333` na faixa e valia `3,333333` na linha; quem cortava era o banco | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| Valor histórico de 6 casas atravessa a migration intacto (`3,333333` → `3,333333000000`) e `null` continua `null` | widening não reconstrói casa que nunca foi persistida, e ausência de custo não é custo zero | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| Os seis TOTAIS da faixa cabem em 4 casas depois da ativação, enquanto o custo POR UNIDADE da mesma linha continua com 12 | duas categorias, duas fronteiras — §62 e §63; a escala acompanha o papel do valor, não a coluna vizinha | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| O fechamento do total técnico em 4 casas é operação nomeada, com `ROUND_HALF_UP` **declarado**, e sobrevive à troca do `Decimal.rounding` global: com banker's ligado, `2026.59385 → 2026.5939` continua valendo | o banco deixou de ser a primeira camada a decidir 40 dígitos → 4 casas — §63 | `apps/api/src/lib/technical-total.test.ts` |
| O DTO de dinheiro da faixa continua servindo 2 casas embora a coluna guarde 4 | armazenamento não é exibição, e ampliar a saída porque o banco guarda mais seria trocar de defeito — §57 | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| **F-2**: `totalIndustrialCost` persistido ÷ quantidade de referência NÃO reproduz `costPerUnit` persistido casa a casa — só dentro da precisão do total | o caminho preciso é o do motor; total fecha, operando não — §64 | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| **F-3**: contribuição por unidade × quantidade NÃO reproduz a contribuição total casa a casa — só dentro da precisão do total | fronteiras diferentes não se reproduzem entre si, e a "correção" seria reduzir a precisão do valor por unidade — §64 | `apps/api/src/modules/pricing/pricing-technical-precision.test.ts` |
| `QuoteLine.industrialCostPerUnitSnapshot` saiu da lista de exceções `18,6`, e os 15 `14,4` de TECHNICAL_TOTAL não subiram junto | o teste falha se alguém ampliar um total por vizinhança, ou reintroduzir a exceção | `scripts/numeric-precision-matrix.test.ts` |
| Tela de Precificação: a máscara de leitura (`R$ 4,05`) nunca vira o valor enviado; digitar 8 casas chega inteiro ao servidor; ativar não reenvia preço nenhum | precisão escondida: a tela destruiria o dado sem decisão humana | `web pages/pricing/preco-tecnico-precisao.test.tsx` |
| Linha do Orçamento: abrir, não editar e salvar devolve `4,0531`; digitar acima de 4 casas sobe cru para a API recusar, em vez de a tela cortar em silêncio | quem recusa é a fronteira, com mensagem — corte local esconderia a decisão | `web pages/projects/orcamento-preco-comercial.test.tsx` |
| Custo unitário de MATERIAL chega ao DTO do cálculo industrial com 8 casas: `3,14159265` não vira `3,141593`, e a 7ª e a 8ª casas são significativas | PREC-SER-01 — as três fontes são `DECIMAL(20,8)` e o valor ainda passa por média ponderada ou conversão de unidade; servir 6 era a migration desfeita na saída | `apps/api/src/modules/industrial-cost-calculation/calculation.test.ts` |
| O custo cortado ficava CONGELADO no `result` do CALC, não só na tela — o snapshot salvo e relido carrega as 8 casas | o DTO do cálculo é o documento histórico que embasou a decisão | `apps/api/src/modules/industrial-cost-calculation/calculation.test.ts` |
| Sem custo conhecido o DTO devolve `null`, nunca `0.00000000`; custo zero REAL continua zero | desconhecido não é zero, e uma compra bonificada é informação | `apps/api/src/modules/industrial-cost-calculation/calculation.test.ts` |
| Formatação decimal não passa por float: `9007199254740993,12` aparece inteiro, e o `double` prova que viraria `...994` | PREC-FMT-01 / §65 — a fundação inteira seria desfeita no `toLocaleString`, e o erro é na parte INTEIRA, não nas casas | `web lib/decimal-format.test.ts` |
| O contrato visual não mudou: `R$ 4,0531`, `R$ 4,053`, `R$ 4,05`, `5%`, `0,006122`, `≈ 0` e `—` continuam iguais | reduzir casas é decisão de apresentação legítima; o que não pode é a redução acontecer antes de alguém decidi-la | `web lib/decimal-format.test.ts` e os 826 testes de tela |
| Arredondamento de exibição é `ROUND_HALF_UP` sobre dígitos — `0,125 → 0,13`, `2,5 → 3`, `-0,125 → -0,13` | mesmo critério das quatro fronteiras de persistência (§60, §62, §63), agora também na tela | `web lib/decimal-format.test.ts` |
| Nenhum dos quatro arquivos de formatação contém `Number(`, `parseFloat`, `Math.round`, `Intl.` ou `toLocaleString` — a fonte é lida e conferida | um teste de saída não pegaria a reintrodução de um float que só erra em valor grande | `web lib/decimal-format.test.ts` |
| `null` continua `—` e nunca `R$ 0,00`; zero real continua zero; custo pequeno abre casas até aparecer | desconhecido não é zero, e `R$ 0,00` para uma cápsula de `R$ 0,0032` diria que ela é de graça | `web lib/decimal-format.test.ts` |
| Quantidade de faixa é comparada por `Decimal.equals`: `999999999999,000000000001` e `...002` são faixas DIFERENTES, embora o `double` iguale as duas | PREC-CMP-01 / §66 — a colisão fazia a política declarar duas faixas e a versão nascer com uma, em silêncio | `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| A igualdade é numérica, não textual: `"1000"`, `"1000.0"` e `"1000.000000000000"` são a mesma faixa e não duplicam ao reaplicar a política | comparar strings resolveria o float e criaria um erro pior | `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| A faixa é identificada pela quantidade FÍSICA na unidade do produto acabado: `1 kg` = `1000 g` = uma faixa; `500 g` ≠ `500 kg`; `1000 g` ≠ `1001 g` | PREC-CMP-02 / §68 — comparar `quantity` crua duplicava a mesma quantidade e fundia quantidades diferentes | `apps/api/src/modules/pricing/tier-quantity.test.ts`, `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| Aplicar política grava a faixa NA UNIDADE DO PRODUTO — `1 kg` num produto em gramas nasce `1000 g` — e o template continua declarando `1 kg` | versão que fala duas línguas obriga conversão na leitura; reescrever o template alteraria a biblioteca | `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| Criação manual de faixa usa a MESMA identidade: `1 kg` sobre uma versão que já tem `1000 g` é recusada como duplicata | regra com dois pesos deixaria a API manual abrir a porta dos fundos | `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| Unidade de outra dimensão é recusada com mensagem em português, nunca convertida em silêncio nem ignorada — `kg` num produto vendido por `un` | compatibilidade é com a unidade DO PRODUTO, não com qualquer unidade do catálogo | `apps/api/src/modules/pricing/tier-quantity.test.ts`, `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| A conversão não trunca: `1,000000000001 kg` e `1,000000000002 kg` continuam duas faixas depois de virarem gramas | truncar antes de comparar apagaria a diferença que `DECIMAL(24,12)` guarda | `apps/api/src/modules/cost-templates/cost-templates.test.ts` |
| O rateio de uma quantidade em N partes é UM só: escala 6, `ROUND_DOWN`, resto na última parte, soma exatamente igual ao total — em 1 a 99 partes | #21 / §67 — a API e o impresso dividiam separado, e discordavam quando a divisão não fechava | `packages/shared/src/part-split.test.ts` |
| A Folha de Receita serve exatamente `splitDecimal`: 10 kg em 3 partes é `3,333333 / 3,333333 / 3,333334`, e não três vezes `3,333333` | é o número que a balança persegue; o impresso da OP mostrava outro | `apps/api/src/modules/production-orders/gmp-execution.test.ts` |
| `numberOfParts` é inteiro entre 1 e 99 — zero, negativo e fracionário são recusados na criação | não existe divisão por zero a proteger no rateio; o guard é do domínio, não do documento | `apps/api/src/modules/production-orders/gmp-execution.test.ts` |
| A coluna "Por parte" da OP impressa mostra o rateio do motor: `0,666666 × 2 + 0,666668`, nunca `0,666667 × 3` | #21 — o papel afirmava N partes iguais e anunciava um valor que parte nenhuma seria pesada, somando mais que o total | `web print/documents.test.tsx`, `web lib/part-share.test.ts` |
| Nenhum arquivo de `src/print/` contém `Number(`, `parseFloat`, `Math.round` ou `toFixed` — a fonte é lida e conferida | documento não decide regra nem inventa precisão (§67); um teste de saída não pegaria a reintrodução | `web print/documents.test.tsx` |
| Toda coluna `Decimal` do schema segue a matriz de `PRODUCT_RULES.md` §58, com precisão explícita | reincidência: tabela nova copia `@db.Decimal(18, 6)` da linha de cima e a microdosagem volta a zerar | `scripts/numeric-precision-matrix.test.ts` |
| Widening preserva o valor gravado; nenhum backfill — as migrations de precisão só contêm `ALTER COLUMN ... SET DATA TYPE` | migration de precisão não pode recalcular histórico | `scripts/numeric-precision-matrix.test.ts`, `pnpm validate:migrations:fresh`, `scripts/migration-order.test.ts` |

## Apresentação e entrada

| Regra | Origem do risco | Proteção canônica |
|---|---|---|
| Decimal pt-BR: vírgula, sem adivinhar milhar | separador único vira casa decimal | `web lib/decimal-input.test.ts` |
| OC em edição: linha, rodapé e documento pela mesma conta (`calcularTotaisOrdemCompra`); "Total (prévia)" com o gravado rotulado só quando difere; ilegível fora da prévia e contado | rodapé mostrava o total gravado ao lado de linhas vivas | `packages/shared/src/purchase-orders.test.ts`, `modules/purchase-orders/purchase-orders.test.ts`, `web pages/purchase-orders/oc-total-previa.test.tsx` |
| Quantidade não inventa precisão; pequeno vira `≈ 0`, nunca `0` | zero significa "não precisa de material" | `web lib/quantity` |
| Campo com teto: digitar o valor EXIBIDO significa "usar todo o limite" e envia o valor canônico de 12 casas; digitar menos continua parcial; acima é recusado sem tolerância | F-08-1 — exibição arredondada virou limite de entrada e a tela recusava o próprio número impresso | `web lib/quantity-limit.test.ts`, `web pages/production-orders/consumo-limite-exibido.test.tsx`, `modules/production-orders/consumption.test.ts` |
| Complemento e restante que vão no payload são `Decimal` ponta a ponta, sem `Number`, e nunca em notação exponencial | FIX-01b — `Math.max(Number(a) - Number(b), 0)` devolvia ruído na décima sexta casa ao servidor, e `toString()` escrevia `1e-12`, que a fronteira recusa | `web lib/quantity-complement.test.ts`, `web lib/quantity-limit.test.ts`, `web pages/production-orders/apontamento-limite-exibido.test.tsx` |
| Tela de detalhe resolve a entidade que já conhece por IDENTIDADE, nunca por `.find()` numa lista paginada; "não achei na página carregada" não vira veredito de domínio, e carregando, não encontrado e falha de rede são estados distintos | F-08-2 — a OP procurava o próprio produto entre os 50 da primeira página e acusava 164 dos 214 produtos de estarem sem item de produto acabado | `web pages/production-orders/production-order-product-resolution.test.tsx`, `scripts/e2e/ordem-de-producao-produto-fora-da-primeira-pagina.mjs` |
| A tela recusa o que ela JÁ SABE que o servidor recusaria — quantidade contra saldo em aberto —, o veredito é derivado (nunca guardado em estado), o envio consome o mesmo resultado e a limpeza é escopada à linha editada; o servidor continua recusando igual | F-06-1 e F-06-2 — o excesso só era detectado depois do diálogo de irreversibilidade, e o alerta ficava na tela depois de corrigido | `web pages/receiving/receiving-live-validation.test.tsx`, `modules/receiving/receiving.test.ts`, `scripts/e2e/recebimento-validacao-viva.mjs` |
| Ação comercial bloqueada por disponibilidade diz POR QUÊ: a causa vem de `getUnavailabilityByItems` — o mesmo mecanismo da Posição de Estoque, com as mesmas palavras —, a quantidade que falta vem do servidor, retenção e ausência de estoque são explicações diferentes, e carregando/erro nunca viram "sem estoque". A ação continua bloqueada | F-09-1 — "Disponível agora 0" e botão morto logo depois de produzir, sem dizer que o lote aguardava a Qualidade | `web pages/customer-orders/disponibilidade-reserva-explicada.test.tsx`, `modules/shipments/shipments.test.ts`, `scripts/e2e/disponibilidade-comercial-explicada.mjs` |
| "Disponível" da OP e "Disponível" da Posição de Estoque podem divergir legitimamente — a ordem não compete contra a própria reserva — e o RÓTULO diz de quem é o número; o teste protege a semântica, nunca a igualdade numérica | F-07-2 — 15 na OP e 3 no Estoque no mesmo instante, sob o mesmo rótulo | `web pages/production-orders/disponivel-para-esta-op.test.tsx` |
| Dependência RESOLVIDA para de impedir: Ordem de Produção CANCELADA não bloqueia mais o cancelamento do Pedido, mas DRAFT/PLANNED/RELEASED/IN_PRODUCTION/COMPLETED/BLOCKED continuam bloqueando, a reserva ACTIVE continua bloqueando, e nada é apagado — a OP cancelada segue no histórico. Um status de OP novo nasce bloqueando | FIX-05b — `productionOrder.count` sem filtro de status prendia o Pedido para sempre depois de a OP ser cancelada pelo fluxo oficial | `modules/customer-orders/cancelamento-op-cancelada.test.ts`, `scripts/e2e/cancelamento-de-pedido-com-op-cancelada.mjs` |
| Recusa de regra de negócio é 4xx com código e mensagem do domínio, nunca 5xx, e o texto que a tela mostra é o do domínio — não "Erro de validação" nem o genérico por status. **Toda** rota que alcança a classe traduz, com o mesmo código, e o corpo é só `{ error, message }` | FIX-05b — `CustomerMismatchError` escapava de `apply-fulfillment-plan` sem mapeamento e voltava 500; PROD-ERR-01 — as duas rotas do próprio módulo de Produção (PATCH e `/plan`) ainda voltavam 500 | `modules/customer-orders/cancelamento-op-cancelada.test.ts`, `modules/production-orders/cliente-inconsistente-http.test.ts`, `web lib/erro-de-dominio-na-tela.test.ts` |
| Número derivado exibido junto de campos editáveis diz de que momento ele é: depois de salvar, a tela converge para o estado persistido sem reload — buscado no servidor, nunca recalculado no navegador — e, com edição pendente, se identifica como o do último salvamento (§54). Resposta atrasada não sobrescreve a mais nova; salvamento que falha não promove número nenhum | F-03-1 — o custo estimado da Formulação continuava o anterior depois de salvar, sem rótulo de prévia nem de gravado | `web pages/formulations/custo-estimado-acompanha-salvamento.test.tsx`, `scripts/e2e/custo-estimado-acompanha-o-salvamento.mjs` |
| Quantidade chega à tela pelo formatador canônico — nunca a string da API no JSX. O cru continua íntegro no DTO: formatador é exibição e nunca alimenta escrita | F-07-1 — a Sugestão de Compra imprimia `6.122448979592`, com ponto decimal, ao lado do mesmo número formatado na tabela de cima | `web pages/customer-orders/sugestao-de-compra-quantidade-formatada.test.tsx` |
| Projeto aprovado recebe novos ciclos comerciais; cancelado não. Aceita que já gerou Pedido nunca é superada, aceita em aberto continua sendo; uma proposta gera no máximo um Pedido e gerar de novo devolve o mesmo | COM-CORE — a regra de ciclo único por projeto mandava abrir projeto novo a cada recompra | `modules/projects/ciclo-comercial-repetido.test.ts`, `web pages/projects/novo-ciclo-e-validade.test.tsx`, `scripts/e2e/projeto-aprovado-vende-de-novo.mjs` |
| Validade fecha a janela de ACEITE: rascunho pode não ter, enviar exige, enviada e vencida não é aceita (erro de domínio, nunca 5xx), vencida é derivada e **o dia inteiro conta no fuso da operação** — a comparação é de DATA CIVIL, sem instante fabricado e sem offset fixo; aceita não vence retroativamente | COM-02 — `validUntil` existia, gravava e imprimia, e nada o validava; COM-CORE-TZ — o fim do dia em UTC vencia a proposta às 21h de São Paulo do próprio dia | `lib/business-day.test.ts`, `modules/projects/ciclo-comercial-repetido.test.ts`, `web pages/projects/novo-ciclo-e-validade.test.tsx` |
| O preço aceito atravessa a cadeia inteira sem redigitação, e precificação ativada DEPOIS do Pedido ou do Faturamento não reescreve nenhum dos dois | COM-03 — a cadeia era provada por composição, nunca percorrida do orçamento ao faturamento | `modules/projects/preco-acordado-do-orcamento-ao-faturamento.test.ts`, `modules/billings/billing-price.test.ts` |
| Interpretação humana de data/hora usa `America/Sao_Paulo`: "hoje" é o dia comercial inteiro, o ano do documento e o dia do código de lote são os da Veridi, e o deslocamento vem da base de fusos — nunca de offset fixo | SYS-TZ-01 — KPI do dia, numeração oficial da OP e código de lote resolviam o dia pelo relógio da máquina, e erravam só entre 21h e a meia-noite | `packages/shared/business-timezone.test.ts`, `lib/dia-comercial-em-uso.test.ts` |
| Validade de lote é DATA CIVIL INCLUSIVA: vale o dia inteiro em São Paulo e vence às 00:00 do dia seguinte — a mesma regra em disponibilidade, liberação, painel e relatório, e "vence hoje" nunca é "vencido" | TZ-LOTE-01 — `isLotExpired` comparava o marcador do dia com o relógio e vencia o lote de 15/09 às 21h de 14/09 | `lib/validade-de-lote.test.ts`, `modules/lots/validade-em-uso.test.ts` |
| O preço do orçamento novo é formado por decisão POR LINHA — manter a condição acordada, reajustar, precificação atual ou manual — com proveniência gravada; condição só vem pronta com vigência e quantidade física iguais; exceção exige motivo; reajuste não é negativo e é fechado pelo servidor | COM-PRICE — `createQuoteVersion` copiava `unitPrice` da versão anterior em silêncio, sem origem, sem conferir vigência nem quantidade | `modules/projects/formacao-de-preco.test.ts`, `scripts/e2e/formacao-de-preco-do-novo-orcamento.mjs` |
| Preço herdado congela o CMV CORRENTE no envio, não o CMV do acordo — e sem faixa equivalente o envio continua acontecendo | COM-PRICE — linha sem faixa não congelava economia nenhuma | `modules/projects/formacao-de-preco-economia.test.ts` |
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
| O banco que as migrations constroem do zero **é** o `schema.prisma` — `migrate diff` entre os dois sai vazio | `pnpm validate:migrations:fresh` (Postgres local descartável) |
| Cada uma das 197 FKs declara no modelo a mesma ação de `ON DELETE` que a migration escreveu; relação opcional não herda `SetNull` por omissão (#14) | `scripts/schema-fk-actions.test.ts` |

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
