# Backlog

O que está **aberto**, consolidado com o Product Owner em 2026-09-04 após o
Repository Baseline v2, a referência manual de custo, a revisão global do
"Como funciona", o reparo da reconstrução de migrations e o deploy de
`main @ ffee5c6`.

Achado fechado não fica aqui. O que virou regra está em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md); o que cada rodada descobriu está em
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md); onde
cada regra é protegida está em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md);
escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

**Rodada 1 aprovada em 2026-09-04:** #12, #9, #3, #5 resolvidos; #4
resolvido com residual aceito (≈117px em 1280×800).
**Rodada 2 aprovada e publicada em 2026-09-05** (merge `dfb2673`): #8A, #8B e
#8C resolvidos.
**Rodada 3 aprovada e publicada em 2026-09-05** (merge `b89f9a4`): #8D e #8H
resolvidos; #15, #16 e #17 abertos como achados.
**Rodada 4 aprovada e publicada em 2026-09-05**: #15 e #16 resolvidos; #18
aberto como achado, por decisão do PO. #17 segue aberto. **Seguinte, quando o
PO autorizar:** #8E, #8F e #8G.

---

## A. Defeitos abertos

### 18. Consistência monetária da Ordem de Compra — MEDIUM

**ABERTO. Registrado por decisão do PO em 2026-09-05; capability própria.**

Achado da Rodada 4. `calcularTotaisOrdemCompra` soma as linhas em precisão
cheia e arredonda só na saída — `round(Σ valores brutos das linhas)` —,
enquanto os documentos comerciais passaram a usar
`Σ round(valor monetário da linha, 2)` ([`PRODUCT_RULES.md`](PRODUCT_RULES.md)
§55). Com preço de quatro casas as duas contas divergem em centavos.

**Princípio de produto.** Se a Ordem de Compra apresenta totais monetários de
linha em duas casas, o total do documento deve, em princípio, reconciliar
exatamente com a soma desses valores apresentados. Alvo conceitual futuro:
`Σ round(quantidade × preço unitário, 2)` antes de formar o total do
documento.

**Limites definidos pelo PO.** Não implementar junto de outra rodada e **não
reabrir #8A** — a regra atual foi publicada como está. Antes de alterar a
matemática é preciso auditar: OCs históricas; recebimentos; custo efetivo;
custo de aquisição; vínculos com fornecedor; persistência histórica; e se
existe razão de domínio para a regra atual. Só então decidir se muda.

### 17. Suíte da API não é determinística sob paralelismo no banco local — LOW técnico

**ABERTO.** Em execuções completas de `pnpm test`, um teste de
`modules/production-orders` falha esporadicamente (visto em
`consumption.test.ts` e em `picking.test.ts`, ambos medindo agregados de
estoque). Isolado e em reexecução da suíte completa, passa. O paralelismo do
Vitest sobre o mesmo banco de desenvolvimento é a origem provável.

Custo real: um gate verde exige reexecutar, e uma falha assim se parece com
regressão de quem está lendo. Rodada posterior — candidato natural a entrar
junto de #10 (manutenção).

---

## B. Melhorias aprovadas

### 8. Cálculo ao vivo nas demais telas — subdividido

Padrão nascido na Formulação: valor derivado aparece enquanto se digita, a
conta vem da **mesma função** que a API usa, `CalcHint` mostra a aritmética,
premissa ausente vira travessão. Hoje no padrão: Faturamento, Formulação, CMV
e a prévia de política de preço.

- **#8A, #8B, #8C — RESOLVIDOS na Rodada 2** (ver F).
- **#8D, #8H — RESOLVIDOS na Rodada 3** (ver F).
- **#8E — LOW — Recebimento, custo efetivo.** Mostrar total e comparação com o
  custo previsto quando aplicável.
- **#8F — LOW — Ficha de Pesagem.** Mostrar a diferença antes da confirmação.
- **#8G — A AUDITAR — Ordem de Produção, quantidade planejada.** Mudar a
  quantidade não atualiza a prévia das necessidades até salvar. Auditar a regra
  histórica/snapshot **antes** de alterar: nenhum cálculo vivo pode mutilar OP
  já congelada.
Também no radar, sem item próprio: Contagem de Estoque e Reservar ↔ Produzir
calculam ao vivo mas ainda sem `CalcHint`; Custo Industrial e impacto de
materiais do Pedido ficam em branco até apertar botão sem dizer que o valor é
do que está salvo. Regra durável de prévia × gravado: `PRODUCT_RULES.md` §54.

---

## C. Decisões aguardando negócio

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
**AGUARDANDO VALIDAÇÃO DE NEGÓCIO.**

### 7. Convenções operacionais ainda não formalizadas — AGUARDANDO VALIDAÇÃO COM A VERIDI

Cada uma tem um padrão em uso; nenhuma impede operação. Pauta consolidada para
a homologação — não implementar por suposição; com o feedback da Veridi,
quebrar em requirements independentes:

- regra de geração automática do número de lote;
- limiar/alerta de validade próxima;
- permissões detalhadas por papel;
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção.

Perguntas regulatórias abertas: [`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md).

---

## D. Manutenção técnica

### 14. Drift `schema.prisma` × banco/migrations — LOW técnico, risco estrutural

`prisma migrate diff` do banco (novo ou produção, idênticos) para o
`schema.prisma` gera 86 comandos: 0 tabelas, 0 colunas e 0 tipos funcionais
divergentes; 27 chaves estrangeiras que o banco aplica com `ON DELETE
RESTRICT` e o schema declara `SET NULL` (`attachments.lotId`,
`lots.ownerCustomerId`, `production_orders.customerOrderId`,
`billing_lines.lotId`…); ≈32 índices e constraints com divergência nominal.
O banco é o lado mais restritivo.

**Decisão de PO:** não corrigir automaticamente. Cada FK exige decisão de
domínio — bloquear a exclusão, desassociar o relacionamento, ou arquivar em vez
de excluir. Fazer em rodada isolada: **"Schema Integrity Audit"**.

**Regra de segurança já vigente** ([`TECH_BASELINE.md`](TECH_BASELINE.md),
*Migration order*, e `CLAUDE.md`): migration nova não carrega drift incidental —
nem `RESTRICT → SET NULL`, nem renomeação de índice ou constraint, nem criação
ou remoção alheia. Todo SQL gerado é revisado linha a linha; diff gigante do
Prisma não se aprova. **ABERTO.**

### 10. Compactar `archive/DELIVERY_HISTORY.md` — MANUTENÇÃO / LOW

≈5.326 linhas de diário por entrega — contradiz o objetivo do Baseline v2 de
reduzir contexto histórico vivo. Consolidar para ≈200–400 linhas com só data,
capability, release/commit importante, decisão durável e breaking change
relevante. O Git guarda o detalhe. Não misturar com capability de negócio.

---

## E. Observação

### 1. `pnpm test` — `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento — LOW

Ocorrência histórica e intermitente (`Error: Channel closed`) no fechamento
dos workers do vitest com api e web juntos; nenhuma asserção falha. Sem
reprodução recente, suítes verdes, nenhum indício de regressão de produto.
**Decisão de PO:** não investigar preventivamente sem reprodução. Se
reaparecer, capturar versão do Node, worker/processo, ordem de shutdown, árvore
de processos, frequência e stack completa antes de mexer no runner.

### 2. Base local — dados legados inconsistentes — LOW

Só no banco **local** de desenvolvimento com o corpus legado importado:
348 produtos sem cliente (91 em uso), 54 itens de produto acabado órfãos.
Produção não é afetada — a base está limpa e produto novo exige cliente.
**Decisão de PO:** nenhuma feature nem migration para isso agora; deve sumir no
próximo reset canônico da base local/E2E. **ADIADO / MANUTENÇÃO LOCAL.**

---

## F. Resolvidos recentes (2026-09-04 e 2026-09-05)

- **#15 Integridade comercial Orçamento → Pedido** (2026-09-05, Rodada 4).
  O Pedido gerado de uma proposta aceita congela o subtotal da PROPOSTA:
  `calcularTotaisOrcamento`, a mesma função que montou o documento aceito.
  `quote-to-order.service.ts` somava as linhas em precisão cheia e arredondava
  no fim — com preço de quatro casas, `Σ round(linha)` e `round(Σ linha)`
  divergem em centavos e o Pedido fechava por um valor que a proposta nunca
  mostrou (7 × R$ 12,3450 em duas linhas: R$ 172,84 na proposta, R$ 172,83 no
  Pedido). O mesmo defeito estava no resumo do Faturamento dentro do Pedido,
  que agora passa por `calcularTotaisFaturamento` (R$ 1.927,41, não
  R$ 1.927,42). Preços acordados, quantidades, desconto, plano de pagamento e
  proveniência seguem copiados sem recálculo; nenhum documento histórico foi
  tocado e não houve backfill. Regra durável em
  [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §55.
  `packages/shared/src/quote-math.test.ts`,
  `modules/projects/project-integration.test.ts`,
  `modules/billings/billing-price.test.ts`,
  `web pages/projects/orcamento-previa.test.tsx`.
- **#16 `pricing-options` responde 404 para ausência de precificação**
  (2026-09-05, Rodada 4). `GET /quote-lines/:id/pricing-options` responde
  **200** com `{ "pricing": null }` quando o produto não tem precificação
  vigente — estado esperado do negócio, não recurso ausente —, e a tela
  continua oferecendo preço manual sem erro no console. 404 voltou a
  significar só linha inexistente, e 403 e erro interno continuam distintos.
  Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §56.
  `modules/projects/project-integration.test.ts`,
  `web lib/quote-pricing-options.test.ts`.

- **#8D Faturamento — a consequência do preço antes de confirmar** (2026-09-05).
  Alterar o preço de uma linha mostra, enquanto se digita, o total da linha e o
  total do documento que vão resultar, ao lado do "Total da linha gravado" e do
  "Total do documento gravado". A conta é `calcularTotaisFaturamento` em
  `@veridi/shared` — a mesma que a API usa para emitir (linha em 2 casas,
  documento = soma das linhas impressas), agora um motor só: a tela somava em
  `Number`, a API em `Decimal`. Em rascunho o rodapé é "Valor total (prévia)" e
  o gravado aparece nomeado quando difere. Preço vazio, ilegível ou negativo não
  vira R$ 0,00: fica sem total, é dito, e a confirmação trava. Preço acordado,
  motivo, autor e hora seguem intactos; emitido continua histórico.
  `packages/shared/src/billings.test.ts`,
  `modules/billings/billing-price.test.ts`,
  `web pages/billings/faturamento-previa.test.tsx`.
- **#8H Orçamento — total ao vivo na versão em rascunho** (2026-09-05).
  Quantidade e preço deixaram de ser campos não-controlados: o texto vive na
  tela, e o total da linha e o "Total da proposta (prévia)" acompanham a
  digitação pela mesma conta do documento (`calcularTotaisOrcamento` +
  `buildPaymentSchedule`, ambos em `@veridi/shared` e usados pela API — o plano
  de pagamento saiu de `apps/api` para lá). Com edição pendente, "Total salvo"
  aparece ao lado; a coluna da lista de versões virou "Total salvo". Gravar
  continua sendo o blur do campo — nenhuma requisição por tecla. Valor ausente
  ou ilegível não vira zero e é dito; versão enviada ou aceita não recalcula.
  `packages/shared/src/quote-math.test.ts`, `modules/projects/projects.test.ts`,
  `web pages/projects/orcamento-previa.test.tsx`.
- **#8A Ordem de Compra — total vivo** (2026-09-05). Linha, rodapé e documento
  passam pela mesma função (`calcularTotaisOrdemCompra`, Decimal, 2 casas só
  na saída — usada também pela API). Em edição o rodapé é "Total (prévia)";
  o gravado aparece só quando difere, rotulado, com "salve o rascunho para
  atualizar"; valor ilegível fica fora e é contado, nunca vira zero.
  `web pages/purchase-orders/oc-total-previa.test.tsx`, `packages/shared/src/purchase-orders.test.ts`.
- **#8B Expedição — já expedido, expedindo agora, restante** (2026-09-05).
  Por produto, ao vivo: "Já expedido (antes desta)" é histórico, "Expedindo
  agora (prévia)" soma as linhas em edição, "Restante após esta expedição" é
  a diferença — `previaDeExpedicaoDoProduto` em `@veridi/shared`. Acima do
  reservado ou do que falta expedir: erro dito e confirmação travada, nunca
  saldo negativo. Toda quantidade passa por `formatQuantity`; o "Total" cru
  entre produtos saiu. Confirmar grava o que a prévia mostrou e só então o
  estoque cai (provado na API). `web pages/shipments/expedicao-previa.test.tsx`,
  `modules/shipments/shipments.test.ts`, `packages/shared/src/shipments.test.ts`.
- **#8C Precificação — prévia da faixa antes de gravar** (2026-09-05). O
  custo da quantidade vem de `POST /pricing-versions/:id/tiers/preview`
  (mesma validação e mesmo caminho da criação, sem gravar); preço, comissão,
  contribuição e markup saem de `computePrice`, agora em `@veridi/shared` e
  usado pela API — um motor só. Operando faltante não vira R$ 0,00; margem +
  comissão ≥ 100% é recusada antes de gravar; o `CalcHint` acompanha a prévia
  e reconcilia. `web pages/pricing/faixa-previa.test.tsx`,
  `modules/pricing/pricing.test.ts`, `packages/shared/src/pricing-math.test.ts`.

- **#12 Estimativa de custo da Formulação** — usa `selectItemCostSource`, a
  mesma seleção do cálculo de custo e do CMV: 30d → 90d → última compra →
  oferta válida → referência manual → desconhecido; oferta ambígua fica em
  "seleção necessária" sem cair para a manual; material do cliente é "não
  aplicável" mesmo com compra ou referência no item; `referenceDate` explícita
  (a rota decide "hoje"). A tela mostra a origem de cada componente e o que
  fazer quando falta. Provado em `modules/costs/formulation-cost-estimate.test.ts`
  (A–L, incluindo Formulação × motor do CMV com a mesma fonte e o mesmo custo
  unitário). Nenhum segundo seletor.
- **#9 `CalcHint` conferido** — "CMV por unidade" explicava "÷ lote de
  referência"; o motor divide pela quantidade SIMULADA (`perUnit = total /
  quantity`, provado em `product-cmv.test.ts`). Explicação corrigida e
  conferência ligada com `numero` nos operandos; "Preço sugerido" (P = C ÷
  (1 − margem − comissão), `computePrice`) conferido no diálogo de política e
  na tabela de precificação. Divergência provocada acende o alerta; o valor
  autoritativo continua vindo do domínio.
- **#3 Validação inline da Formulação** — cada campo inválido recebe
  `aria-invalid` e mensagem por `aria-describedby` que nomeia componente e
  campo ("MP-000003 — Quantidade deve ser maior que zero."); salvar e ativar
  levam foco e rolagem ao primeiro erro, abrindo o painel de ajustes quando o
  erro mora lá; todos ficam marcados; a próxima tentativa vai ao seguinte;
  digitar nunca rola; recusa do servidor cai no campo certo.
  `pages/formulations/validacao-inline.test.tsx`.
- **#5 Nomenclatura dos modos** — "Quantidade física informada" e "Calcular
  quantidade física", com as descrições decididas pelo PO na tela e na ajuda;
  enum interno intacto, sem migration; zero texto antigo visível.
- **#4 Densidade da tabela de componentes — RESOLVIDO COM RESIDUAL ACEITO.**
  Medido com oito componentes: 1681px antes em todas as larguras; depois,
  1045px em 1280×800, 1088px em 1440×900 e 1548px em 1920×1080 (áreas úteis
  928/1088/1548). Sete colunas em vez de dez, larguras mínimas por coluna,
  cabeçalho que quebra linha; zero célula truncada, nenhuma regressão
  funcional. Decisão de PO (2026-09-04): em 1280×800 permanece
  aproximadamente 117px de rolagem horizontal; em 1440×900 e superiores a
  tabela cabe integralmente. Residual aceito pelo PO; reabrir somente se
  validação operacional demonstrar impacto.

- **#7a "Dashboard" → "Painel"** — publicado: menu, título e interface visível
  sem "Dashboard".
- **#13 Reconstrução de banco vazio** — cadeia de migrations reconstrói banco
  vazio; `pnpm validate:migrations:fresh` verde; `scripts/migration-order.test.ts`
  em `pnpm test`; produção com `migrate status` em dia. A migration histórica
  antiga permanece registrada, de propósito, nos bancos que a executaram —
  nenhuma limpeza manual de `_prisma_migrations` é necessária. Detalhe em
  [`TECH_BASELINE.md`](TECH_BASELINE.md), *Migration order*.

## G. Roadmap

Escopo futuro não fica aqui. **Produto próprio Veridi** (Product sem cliente
obrigatório, estoque próprio de PA, venda do mesmo PA a vários clientes) vive
em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md); `Product.customerId`
permanece obrigatório no escopo atual.

---

## Ordem de execução definida pelo PO (2026-09-04)

1. **Rodada 1 — aprovada:** #12 + #9 + #3 + #5 resolvidos; #4 resolvido com
   residual aceito em 1280×800.
2. **Rodada 2 — aprovada e publicada:** #8A + #8B + #8C resolvidos.
3. **Rodada 3 — aprovada e publicada:** #8D + #8H resolvidos.
4. **Rodada 4 — aprovada e publicada:** #15 + #16 resolvidos; #18 registrado;
   #8E, #8F e #8G quando o PO autorizar.
5. **Validação com a Veridi:** #7 + #11.
6. **Manutenção:** #10 e #17. #18 é capability própria, com auditoria antes de
   qualquer mudança matemática. #1 e #2 permanecem observação/adiados.
7. **Rodada técnica isolada:** #14 (Schema Integrity Audit).
8. **Roadmap:** produto próprio Veridi.

## Próximo gate

A validação com a Veridi continua gate para as regras que dependem do processo
real do cliente (#7, #11). Ela **não** impede os itens internos já decididos
pelo PO (agora #8A–#8D, #8H, #15 e #16) quando o PO autorizar a próxima
capability.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
