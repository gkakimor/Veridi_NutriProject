# Spike — novos ciclos comerciais no mesmo Projeto (COM-CORE, 2026-09-09)

Investigação que precedeu o COM-CORE. Fica aqui o que foi ENCONTRADO no código
e o que o PO DECIDIU; a regra durável vive em
[`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §69–§71.

Nada aqui fala de agendamento. "Recorrente" foi descartado como nome
justamente por sugerir "todo dia X gerar pedido" — não é isso.

## O que travava

| Onde | O que fazia |
|---|---|
| `quotes.service.ts` · `createQuoteVersion` | recusava projeto `APPROVED` junto com `CANCELLED` |
| `quotes.service.ts` · `acceptQuoteVersion` | `updateMany` superava TODA aceita anterior do projeto |
| `quotes.service.ts` · `createQuoteVersion` | superava também a anterior no momento de criar a versão nova |
| `QuoteVersionsSection.tsx` | escondia a ação e dizia "crie um projeto novo" |

Os quatro descreviam a mesma premissa: **um ciclo comercial por projeto**.

## Auditoria de "uma ACCEPTED"

Cinco ocorrências no código de produto, classificadas antes de mexer:

| Local | Semântica real | Decisão |
|---|---|---|
| `projects.service.ts:134` (`acceptedQuoteLabel`) | B — a última aceita | passou a ler a última; lia a primeira |
| `projects.service.ts:363` | qualquer proposta formalizada (trava de cliente) | intocada |
| `projects.service.ts:572` (aprovação) | E — aceita necessária para a primeira aprovação | intocada: a aprovação só acontece uma vez |
| `quote-to-order.service.ts:111` | D — esta proposta, para gerar o Pedido dela | intocada |
| `quotes.service.ts` (supersede, dois pontos) | C — aceita ainda sem Pedido | passou a olhar `sourcedCustomerOrder` |

Nenhum `find` virou `findFirst` por reflexo.

## Validade

O campo existia, gravava, exibia e imprimia — e nada o validava. Três achados:

1. enviar sem validade era permitido;
2. aceitar proposta vencida era permitido;
3. a comparação ingênua (`new Date(validUntil) >= new Date()`) venceria a
   proposta um dia antes, porque a coluna guarda meia-noite UTC.

O padrão de fim-de-dia já existia em três cópias de `fimDoDia`
(`cost-reference.ts`, `cost-source-selection.ts`, `product-cmv.service.ts`).
A quarta cópia não foi escrita: nasceu `lib/business-day.ts`, e o novo código
usa só ele. **Consolidar as três cópias existentes ficou de fora do COM-CORE** —
é refatoração em Custos/CMV, fora do escopo desta capability.

## Schema

Zero migration. `sourcedCustomerOrder`, `validUntil` e os status existentes
bastaram. `priceOrigin`, `inheritedFromQuoteLineId`, `adjustmentPercent` e
`currentAgreedQuoteLineId` continuam sem existir — pertencem ao COM-PRICE.

## O que o COM-CORE deliberadamente NÃO fez

Reajuste percentual, herança de preço entre ciclos, "manter condição anterior",
proveniência de herança, entregas programadas (COM-04) e o atalho da Consulta
do Cliente. Também não tratou o caso "acordo anterior de 10.000, orçamento novo
de 500": sem herança de preço, ele não existe ainda.
