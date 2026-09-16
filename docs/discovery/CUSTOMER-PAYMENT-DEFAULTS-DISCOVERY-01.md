# CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01 — pagamento padrão do Cliente como sugestão para o Orçamento

## 1. Status

`IMPLEMENTADO` — decisões D1–D6 do PO entregues por CUSTOMER-PAYMENT-DEFAULTS-01 em 2026-09-16.

Discovery somente leitura feito em 2026-09-16 sobre `main` `8945b97`, entregue só no chat (rodada READ ONLY, sem
documento). Este arquivo é o registro durável, escrito junto da implementação; nada do que o discovery leu tinha mudado
na base da implementação (`8945b97`).

## 2. Objetivo

Permitir que o Cliente tenha forma e condição de pagamento PADRÃO, opcionais, usadas como SUGESTÃO para orçamentos
novos — sem virar autoridade viva sobre orçamento ou pedido já criados.

## 3. PO baseline

- Pedido do PO: defaults opcionais de forma e de condição de pagamento no Cliente, sugeridos em orçamentos novos.
- CUSTOMER-EDIT-PERMISSIONS-01 (§98): só ADMIN e COMMERCIAL criam e editam o cadastro inteiro do Cliente.
- QUOTE-DUPLICATE-01 (§85) e COM-CORE (§69–§71): versão nova e recompra copiam as condições da anterior.

## 4. Estado atual (antes da implementação)

- A condição existia na própria `QuoteVersion`: `paymentMethod` (`QuotePaymentMethod`, NOT NULL DEFAULT CASH) +
  `downPaymentPercent`, `installmentCount` (1–120), `installmentIntervalDays` (1–365, null = 30) e
  `monthlyInterestPercent`; o plano é derivado por `buildPaymentSchedule` (`packages/shared/src/quote-math.ts`) e
  congelado como resultado no Pedido (`CustomerOrder.agreedPaymentSchedule`).
- Forma de pagamento (PIX, boleto, transferência, cartão) não existia em nenhum módulo.
- Colisão de nome: a tela do Orçamento, a leitura, o PDF e a Origem comercial do Pedido chamavam À vista/Parcelado de
  "Forma de pagamento"; o resumo do Projeto já dizia "Condição de pagamento"; o PDF chamava o texto livre
  `paymentTerms` de "Condições de pagamento".
- Defeito: `INSTALLMENTS` sem `installmentCount` era aceito pela API e pela tela; o plano derivado saía CASH — a leitura
  dizia "Parcelado" e o PDF e o plano congelado no Pedido diziam "À vista".
- `createQuoteVersion` copiava as condições da versão de maior número, inclusive ARCHIVED/LEGACY_IMPORT.
- Trocar o Cliente do Projeto (`updateProject`) não mexia nas condições do rascunho.
- DEV (carga de PROD de 2026-09-14, lido em READ ONLY): 77 clientes; 182 projetos LEGACY_IMPORT; 2 versões
  ARCHIVED/LEGACY_IMPORT, CASH pelo default e condições nulas; 0 pedidos.

## 5. Evidências

- Schema: `apps/api/prisma/schema.prisma` (`QuoteVersion`, `Customer`, `CustomerOrder`, enum `QuotePaymentMethod`).
- Serviço: `apps/api/src/modules/projects/quotes.service.ts` (`createQuoteVersion`, `duplicateQuoteVersion`,
  `updateQuoteVersion`, `previewQuotePaymentSchedule`, `sendQuoteVersion`), `quote-to-order.service.ts`.
- Tela: `apps/web/src/pages/projects/QuoteConditionsForm.tsx`, `quote-conditions-draft.ts`,
  `apps/web/src/pages/customer-orders/CommercialOriginSection.tsx`, `apps/web/src/pdf/documents/QuotePdf.tsx`,
  `apps/web/src/pages/customers/customer-form.tsx`.

## 6. Findings

1. O ponto de cópia seguro é a criação da versão sem anterior MANUAL: o cliente já vem carregado e a versão guarda as
   condições em colunas próprias — sem fallback de leitura, "sugestão, não autoridade viva" sai pela arquitetura.
2. Detectar "rascunho não editado" na troca de Cliente não é confiável (CASH default = "escolheu à vista"; sem coluna de
   proveniência) — ação explícita é mais segura que sobrescrita automática.
3. O rótulo "Forma de pagamento" precisava mudar de dono antes de existir forma.
4. A exceção do legado é necessária: sem ela, versões ARCHIVED importadas impediriam o padrão na primeira proposta real.

## 7. Gaps

Forma de pagamento inexistente; padrão no Cliente inexistente; vocabulário em colisão; invariante "Parcelado exige
parcelas" ausente.

## 8. Riscos

- ALTO: colisão de vocabulário no documento do cliente (resolvido por D1).
- MÉDIO: fallback de leitura `quote.x ?? customer.defaultX` tornaria o cliente autoridade viva (proibido e testado com
  mutação).
- MÉDIO: parcelado sem parcelas no padrão repetiria o defeito (resolvido por D6 e pela correção no Orçamento).
- BAIXO: `paymentMethod` NOT NULL impede "condição não informada" na versão — cliente sem condição = versão à vista,
  como sempre.

## 9. Alternativas consideradas

- JSON no Cliente (sem tipo nem validação no banco) — descartada.
- Tabela 1:1 ou catálogo de condições — maior que o pedido, descartada.
- Reutilizar `paymentTerms` — descartada (terceira representação).
- `NOT_INFORMED` como valor (§83) — descartada: o PO pediu NULL, coerente num bloco de cinco campos.
- Atualizar o rascunho sozinho na troca de Cliente — descartada (D3).

## 10. Recomendação

Colunas nulas no Cliente com os mesmos tipos e limites das condições do Orçamento; cópia para a versão só na primeira
proposta real; ação explícita "Aplicar padrão do cliente" no rascunho; forma congelada no Pedido; vocabulário D1.

## 11. Decisões PO

- **D1 — decidida em 2026-09-16:** "Forma de pagamento" = PIX, Boleto, Transferência, Cartão, Outro. À vista/Parcelado
  passa a se chamar "Condição de pagamento" (formulário, leitura, PDF, Pedido). `paymentTerms`, quando exibido, é
  "Observações de pagamento". Coluna `paymentMethod` e DTO legado não são renomeados; o id `#quote-payment-method` fica.
- **D2 — decidida:** V2 em diante e a recompra em projeto aprovado copiam a versão anterior; o padrão do Cliente só
  entra quando não há versão anterior MANUAL (V1, ou a primeira depois de só haver legado). Duplicação copia a origem.
- **D3 — decidida:** trocar o Cliente do Projeto não altera forma nem condição do rascunho; o rascunho oferece
  "Aplicar padrão do cliente", que preenche a TELA (não grava) e participa da guarda de alterações não salvas.
- **D4 — decidida:** enum `PaymentInstrument` = PIX, BOLETO, BANK_TRANSFER, CARD, OTHER; um valor; "Outro" sem texto
  livre; cartão sem crédito/débito; lista e rótulos em `@veridi/shared`.
- **D5 — decidida:** o Pedido congela a forma (`CustomerOrder.agreedPaymentInstrument`) e a Origem comercial mostra
  forma e condição; o Cliente não é lido depois da conversão.
- **D6 — decidida:** a condição padrão tem método, entrada, parcelas, intervalo e juros (sem desconto, prazo de entrega,
  validade e observações). Parcelado exige número de parcelas — **no padrão do Cliente e também no Orçamento** (o
  handoff de implementação trouxe a correção do Orçamento para esta capability; o discovery a deixava para o BACKLOG).

## 12. Pendências PO

Nenhuma para esta capability.

## 13. Escopo recomendado

Enum e migration aditiva; padrão no Cliente (API, tela e consulta); cópia para a V1 e exceção do legado; forma no
Orçamento dentro da mesma autoridade de condições pendentes; "Aplicar padrão do cliente"; snapshot da forma no Pedido;
PDF com os rótulos novos; invariante "Parcelado exige parcelas" no Cliente e no Orçamento.

## 14. Fora do escopo

Contas a receber; datas civis de vencimento; desconto, prazo e validade padrão; forma no Pedido direto e nos PDFs de
Pedido e Faturamento; aba Resumo da Visão do Cliente; backfill de qualquer registro existente.

## 15. Próxima capability

CUSTOMER-PAYMENT-DEFAULTS-01 (entregue).

## 16. Implementação

**IMPLEMENTADO** em 2026-09-16 por CUSTOMER-PAYMENT-DEFAULTS-01 (merge na `main`, fora de PROD). Migration
`20260925093032_customer_payment_defaults` (aditiva, sem UPDATE). Regra em [`PRODUCT_RULES.md`](../PRODUCT_RULES.md)
§99; estado em [`PROJECT_STATE.md`](../PROJECT_STATE.md); proteção em
[`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md).

## 17. Histórico de decisões

- 2026-09-16 — discovery entregue no chat (READ ONLY, sem documento); `READY_FOR_IMPLEMENTATION: NO` até D1–D3.
- 2026-09-16 — PO fecha D1–D6 com as recomendações e traz a correção "Parcelado exige parcelas" do Orçamento para a
  capability; implementação e este registro na mesma rodada.
