# Backlog

O que está **aberto**. Nada mais.

Achado fechado não fica aqui: o que virou regra está em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md), o que cada rodada descobriu em
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md), onde
cada regra é protegida em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md), e o
detalhe de cada entrega no Git. Escopo futuro vive só em
[`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

**Zero CRITICAL. Zero BLOCKER.** A fundação de precisão numérica está completa
no ARMAZENAMENTO — schema, persistência, serialização e comparação de domínio —,
e `schema.prisma` está em sincronia com as migrations. A auditoria de 2026-09-07
mostrou que a **exibição** ainda não acompanhou: o corte de seis casas da tela
nasceu quando o banco guardava seis, e hoje ele guarda doze.

O primeiro sintoma dessa defasagem — o campo com teto que recusava o próprio
número impresso — foi corrigido em FIX-01 (2026-09-07): campo com limite agora
resolve o que foi digitado contra o limite por `quantity-limit.ts`, e digitar o
valor exibido significa "usar todo o limite". O FIX-01b (2026-09-08) fechou os
dois resíduos que o próprio FIX-01 encontrou: o apontamento de produção, que
recalculava o restante por `Number`, e o complemento do Plano de Atendimento,
que ia no payload calculado em ponto flutuante. O que sobra da defasagem é
exibição sem entrada (W7) — F-07-1 saiu no FIX-06. O P0 de custo da Formulação foi fechado no
FIX-02 (2026-09-08): quantidade física canônica na estimativa e um único
"Equivalente estoque" entre rascunho e versão ativa.

---

## Fila viva — a ordem, num lugar só

Reconciliada em 2026-09-09 com o walkthrough real da Veridi. O detalhe de cada
item fica na sua seção; aqui fica só a ORDEM, porque ela é a pergunta que se
faz primeiro e estava espalhada por cinco lugares.

| # | Item | Seção | Por que nesta posição |
|---|---|---|---|
| **P1-1** | PROJECT-CUSTOMER-CONTACT-01 | A · P1 | Leitura, sem duplicar dado. **Primeiro da fila** desde que CUSTOMER-CEP-02 fechou |
| **P1-2** | QUOTE-DUPLICATE-01 | A · P1 | **Conflito com §74 a resolver antes** — ver a entrada |
| **P1-3** | CUSTOMER-COMMERCIAL-STATUS-01 | A · P1 | Decisão de produto de 2026-09-09. Tem gate próprio: o que prova conversão |
| **P1-4** | COST-BASELINE-01 | E · #16 | Destrava COST-VAR-02 |
| **P1-5** | COST-RESOURCE-MULTIPLIER-01 | G | Discovery antes de build |
| **P1-6** | SUPPLIER-ADDRESS-01 | G | Reusa a fundação de endereço do Cliente, já com o comportamento de §80 |
| depois | COST-VAR-02 · PLAN-DATE-01 · UX-HELP-03 · COM-CONTRACT-01 | — | Nenhum deles muda de prioridade por causa desta reunião |

Discovery sem posição na fila: SUPPLIER-OFFER-OVERLAP-01 — que desde
2026-09-09 carrega junto a sobreposição de `IndustrialResourceRate`, mesma
pergunta nos dois lados do custo, uma resposta só —, SUPPLIER-MODE-01,
ASSET-01, COM-CONTRACT-01 (seção G). Brainstorm: tributos e custo de aquisição
(seção F).

---

## A. Defeitos abertos

Triados em 2026-09-07 sobre a auditoria de produto. Evidência, passos e
conferência numérica ficam em [`E2E_AUDIT_CURRENT.md`](E2E_AUDIT_CURRENT.md);
aqui fica só o que exige trabalho, com a severidade **do PO**, que nem sempre é
a do auditor.

**Zero BLOCKER e zero P0.** Da auditoria de produto sobram três LOW e a fila de
UX; o que reabriu P0 e P1 veio de outro lugar — o **walkthrough real da Veridi
de 2026-09-09**, reconciliado aqui no mesmo dia. Os dois P0
(ORDER-CUSTOMER-PRODUCT-01 e COST-BASIS-UX-01) **fecharam no mesmo
2026-09-09**; cinco P1 entraram por
observação de uso, não por varredura de código: é a diferença entre o que o
sistema faz errado e o que ele faz de um jeito que ninguém entende. A mesma leva trouxe uma decisão de produto
nova — CUSTOMER-COMMERCIAL-STATUS-01 — e um discovery de contrato.

F-02-2 e F-02-1 fechados no FIX-02, F-08-2 no FIX-03, F-06-1 + F-06-2 no FIX-04,
F-09-1 + F-07-2 no FIX-05 e F-03-1 + F-07-1 no FIX-06 (2026-09-08). PROD-ERR-01
não veio da auditoria — nasceu da leitura de código do FIX-05b — e está
**RESOLVIDO**.

**COM-CORE fechado em 2026-09-09.** Projeto aprovado passou a receber novos
orçamentos (§69), aceita que já virou Pedido deixou de ser superada (§70) e a
validade da proposta passou a valer (§71). Zero migration. **Próximo item de
produto: COM-PRICE** — herança de preço entre ciclos (reajuste percentual,
"manter condição anterior", proveniência da herança), que o COM-CORE
deliberadamente não fez.

**MIG-ORDER-01 fechado em 2026-09-09.** A ponta da cadeia de migrations
(`20260925093008`) está **à frente do relógio real**, então `prisma migrate dev`
carimbava a pasta nova com uma data que ordena ANTES de migrations das quais ela
depende — foi assim que a migration do COM-PRICE quebrou a reconstrução de banco
vazio com `relation "quote_lines" does not exist` e precisou ser renumerada à
mão. A convenção existia em `TECH_BASELINE.md` desde 2026-09-05 e dependia de
alguém lembrar dela. Agora existe um caminho oficial — `pnpm migration:create` —
que escreve a migration sem aplicar, renumera para o menor prefixo livre depois
da ponta e prova o resultado. Zero migration, zero schema, zero renomeação de
histórico.

**MIG-ORDER-01b fechado em 2026-09-09.** O `01` deu o caminho de criação, mas
`pnpm db:migrate` continuava sendo `prisma migrate dev`, que aplica **e** cria:
um `--name`, ou uma edição pendente em `schema.prisma`, e nascia uma pasta com
o carimbo do relógio. A barreira era documental. Agora é técnica —
`pnpm db:migrate` é `prisma migrate deploy` embrulhado
(`scripts/apply-migrations.mjs`), recusa qualquer argumento antes de o Prisma
vê-lo, e `migrate deploy` sequer conhece `--name`. Schema alterado sem
migration passou a ser **avisado**, nunca criado. Zero migration, zero schema.
**Próximo item de produto: BILL-DISCOUNT-01** — o desconto global do
Pedido (`agreedDiscountPercent`/`agreedTotalAmount`) nunca chega ao Faturamento:
`calcularTotaisFaturamento` é `Σ(quantidade × preço)` e nenhum Billing o aplica.
Um Pedido de 30.000 com 10% acordado fatura 30.000, não 27.000 — hoje, já com
uma expedição total única. É pré-requisito econômico do COM-04, que multiplica o
buraco por cada entrega.

**BILL-DISCOUNT-01 e 01b fechados em 2026-09-09.** O desconto global do Pedido
morria na Origem comercial: `billings.service.ts` nunca lia
`agreedDiscountPercent`, e um pedido de R$ 200,00 com 10% acordado faturava
R$ 200,00. A investigação (01) disparou STOP GATE — não havia regra de rateio,
e `PRODUCT_RULES.md` §34 proibia espalhar o desconto nas linhas. O PO decidiu a
opção D e a implementação (01b) apropriou o desconto no CABEÇALHO do
Faturamento: cada documento apropria a sua parcela de forma cumulativa, e o
documento que FECHA as quantidades do Pedido absorve o saldo. `agreedUnitPrice`
segue verdadeiro — nenhuma linha ganhou preço líquido. **F-C entrou na mesma
reconciliação**: partir uma linha em vários documentos já perdia centavos por
arredondamento mesmo com desconto zero, e o `commercialAdjustmentAmount` do
fechamento cobre as duas fontes. Invariante durável: pedido inteiramente
faturado por documentos ativos soma EXATAMENTE `agreedTotalAmount`. Uma
migration estrutural (58), zero backfill — DEV e PROD não tinham faturamento
nenhum.

**SYS-TZ-01 fechado em 2026-09-09** (§72): `America/Sao_Paulo` virou o fuso
operacional oficial, com uma definição em `packages/shared`. O resíduo que
ficou — TZ-LOTE-01 — **também está fechado**.

**COM-PRICE fechado em 2026-09-09** (§74): a formação de preço do orçamento
novo passou a ser uma DECISÃO por linha — manter a condição acordada,
reajustá-la, usar a precificação atual ou digitar — com proveniência gravada.
A auditoria confirmou o que o PO suspeitava: `createQuoteVersion` já copiava
`unitPrice` da versão anterior, em silêncio e sem origem.

**COM-04 fechado em 2026-09-09** (§75): entregas programadas viraram documento.
A investigação disparou STOP GATE em três pontos que o spike não resolvia —
cancelamento após atendimento parcial, mecanismo de histórico da reprogramação e
o achado 2 (cobertura total do Plano). O PO decidiu **1(a) / 2(c) / 3(a)**:
cancelar uma entrega parcialmente atendida é permitido e preserva o que saiu;
reprogramar é cancelar e criar substituta com `replacesDeliveryId`; e o Plano de
Atendimento fica intocado. Duas tabelas, uma coluna anulável em
`shipment_lines`, uma migration estrutural (59).

**COM-04b fechado em 2026-09-09** (§75): a quantidade expedida passou a
ATRAVESSAR entregas programadas. O vínculo só existia quando a linha cabia
INTEIRA numa promessa — expedir 500 contra entregas de 400 e 600 não cabia em
nenhuma, ficava sem vínculo, e o cronograma jurava que nada tinha sido entregue.
Agora 400 vão para a primeira e 100 para a segunda, em duas linhas do mesmo lote
e da mesma reserva. Separação aberta pela ENTREGA não atravessa: ela representa
aquela promessa, e passar do que ela pedia é recusa. A origem virou coluna
(`Shipment.originDeliveryId`, migration 60) porque deduzi-la dos vínculos
confundiria os dois fluxos. Entrega com separação em RASCUNHO deixou de aceitar
cancelamento e reprogramação. PLAN-DATE-01 está registrado abaixo e não é
sequência automática — o próximo item de produto passou a ser o P0 da fila viva,
definido pelo walkthrough de 2026-09-09.

**COST-SOURCE-01 fechado em 2026-09-09** (§76): a oferta de fornecedor virou
fonte operacional de custo. Oferta NOVA exige "válida a partir de" (a coluna
segue anulável — as 602 importadas continuam sendo histórico legítimo, sem
backfill e sem data inferida); a vigência passou a ser dia civil nas duas
bordas, o que habilita CMV com `referenceDate` futura antecipando um aumento
já cotado; e `ItemCostReference.currencyCode` passou a ser filtrado — uma
referência em dólar entrava no custo como se fosse real. Ambiguidade entre
fornecedores continua sendo ausência de custo, e a tela passou a dizer por quê.
Sem migration: o índice parcial único do preferencial já existia.

**TZ-LOTE-01 fechado em 2026-09-08** (§73). O PO decidiu a leitura (a): a
validade do lote é DATA CIVIL INCLUSIVA — o lote vale o dia inteiro e vence às
00:00 do dia seguinte em São Paulo. `isLotExpired` passou a responder pelo
mesmo `venceuEm` da validade comercial, e com ele os call sites que comparavam
por fora: liberação da Qualidade, painel de atenção, KPI do painel e relatório
de validade (inclusive `daysToExpiry`, agora em dias civis). Zero migration,
zero dado reescrito — os mesmos lotes passaram a ser lidos corretamente.

### P0 — antes de qualquer outra capability (os dois fechados em 2026-09-09)

#### ORDER-CUSTOMER-PRODUCT-01 — Pedido aceita produto de outro cliente até a Produção — **RESOLVIDO em 2026-09-09**

Vindo do walkthrough real (2026-09-09). Auditado no código em 2026-09-09, e o
sintoma relatado era **mais grave** do que "acusa mismatch tarde":

- a tela do Pedido chama `listProducts({ active: true, lifecycle: "APPROVED",
  pageSize: 50 })` — `CustomerOrderPage.tsx:399,430` — **sem `customerId`**,
  embora a API já aceite esse filtro (`products.service.ts:210`). O seletor
  oferece produto de qualquer cliente;
- o Cliente não é pré-requisito do Produto na tela: as duas escolhas são
  independentes;
- `customer-orders.service.ts` **não compara** `product.customerId` com
  `order.customerId` — nem ao montar a linha, nem no `confirm`, que valida
  cliente ativo, produto ativo, produto operacional e item de produto acabado,
  e nada mais;
- a única recusa existente é `CustomerMismatchError`, levantada por
  `resolveOrderCustomerId` em `production-orders.service.ts` — isto é, no
  Plano de Atendimento / Ordem de Produção.

Consequência: um Pedido **CONFIRMADO** pode carregar a combinação impossível, e
ela só aparece quando alguém tenta produzir. Confirmar é o ponto em que o
documento vira compromisso; deixar passar ali é deixar passar.

Regra desejada pelo PO: **Cliente obrigatório antes de Produto**, produto
filtrado no SERVIDOR pelo cliente do Pedido, e o backend recusando a combinação
no seu próprio limite — filtro de tela não é regra. A recusa a jusante continua
existindo; ela deixa de ser a primeira.

**Resolvido em 2026-09-09.** A comparação virou uma só —
`lib/product-customer-ownership.ts`, que também passou a hospedar o
`CustomerMismatchError` que `production-orders` reexporta — e é chamada em cada
porta de entrada de linha: criar Pedido, salvar linhas do rascunho, trocar o
cliente do rascunho, confirmar o Pedido e gerar Pedido a partir de proposta
aceita. Sempre `400 customer_mismatch`, nunca 500. `resolveOrderCustomerId`
continua onde estava, agora como defesa em profundidade. Na tela, o seletor de
Produto só abre depois do Cliente, o catálogo é consultado no servidor com
`customerId` (busca e paginação inclusive), trocar de cliente com produto no
Pedido é bloqueado com o motivo — nunca apagando linha — e a resposta atrasada
do cliente anterior não aparece no seletor do novo. Pedido herdado inconsistente
continua abrindo, com aviso, e não confirma. Zero migration, zero dado
corrigido. Legado auditado: DEV com 2 linhas inconsistentes (PED-003984
CANCELADO e PED-026585 CONFIRMADO, ambos sem expedição, OP, reserva ou
faturamento); PROD sem nenhum Pedido.

**F-02-2 foi fechado no FIX-02 (2026-09-08)**: a estimativa passou a
chamar `computeFormulationRequirements`, o mesmo motor da OP e do cálculo
industrial, em vez de converter a unidade da quantidade declarada e parar aí.
Em `CAFEÍNA PT 60 CAPS THE KING` o material foi de R$ 0,15 para R$ 9,10 —
exatamente as 60 doses que faltavam. Sem doses por embalagem a estimativa falha
fechada, com o motivo na tela. Nada havia sido persistido por esse caminho.

#### COST-BASIS-UX-01 — "custo por 1.000" ao lado de uma base de 300 — **RESOLVIDO em 2026-09-09**

Fechado em 2026-09-09. Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md),
**§78**.

**A auditoria do motor veio primeiro, e absolveu a matemática.** A prova rodou o
motor real (`costForOutputQuantity`, pela rota de CMV) sobre uma estrutura de
base 300 que reúne todas as formas de escala do domínio — material proporcional,
mão de obra fixa por lote, equipamento com potência, energia derivada, premissa
fixa por lote, premissa por unidade, premissa por 1.000 e caixa de expedição
inteira — em 200, 300, 500 e 1.000, com conta independente em Decimal:

| Quantidade | Lotes | Caixas | Total | Por unidade | Equivalente por 1.000 |
|---|---|---|---|---|---|
| 200 un | 1 | 2 | R$ 183,00 | R$ 0,915 | R$ 915,00 |
| 300 un | 1 | 3 | R$ 201,00 | R$ 0,67 | R$ 670,00 |
| 500 un | 2 | 5 | R$ 384,00 | R$ 0,768 | R$ 768,00 |
| 1.000 un | 4 | 9 | R$ 767,00 | R$ 0,767 | R$ 767,00 |

`perUnit = total ÷ quantidade` e `per1000 = perUnit × 1.000` em todos os casos,
e o total é sempre o da quantidade pedida. **Classificação A — matemática
correta, defeito exclusivamente de UX.** Zero recálculo, zero snapshot alterado,
zero migration, zero dado PROD tocado.

**A prova semântica que faltava.** O equivalente por 1.000 da execução de 300 é
R$ 670,00; o cálculo REAL de 1.000 sobre a mesma base é R$ 767,00 — quatro
lotes, 14% acima. Os dois números são corretos e não são a mesma coisa, e era
apresentá-los com o mesmo peso que produzia a dúvida.

**O que mudou é hierarquia e copy.** A quantidade calculada passou a acompanhar
o total ("Custo industrial total para 300 un", "CMV total para 300 un"), e o
"por 1.000" virou **"Equivalente por 1.000 un"**, secundário, com a ressalva de
que não representa um novo cálculo de produção. Texto único em `@veridi/shared`
(`COST_PER_1000_LABEL`, `COST_PER_1000_EXPLANATION`).

**Seis superfícies, não cinco.** Além de `CostBreakdown.tsx`,
`ProductCmvPage.tsx` e dos três impressos (`CmvPrintPage`,
`CostCalculationPrintPage`, `PricingPrintPage`), a varredura por `per1000`
achou o relatório R-18 (`CostReports.tsx` e o CSV de exportação), que mostrava
"Custo total" e "Custo/1.000" lado a lado **sem nenhuma quantidade na linha**.
Ganhou a coluna "Quantidade calculada" — `IndustrialCostCalculationSummaryDTO` e
`IndustrialCostByProductRowDTO` passaram a carregar a base, que já estava
persistida.

**Finding aberto — vocabulário da base.** O mesmo conceito tem três nomes na
interface: "Base de produção" (campo de entrada), "Base de referência" (leitura)
e "Base de produção sugerida" (template). Registrado, não varrido: sweep de
nomenclatura sem necessidade não é parte desta capability.

### P1 — próximas correções

#### INDUSTRIAL-RATE-VALIDITY-01 — vigência de tarifa industrial — **RESOLVIDO em 2026-09-09**

Regra durável em [`PRODUCT_RULES.md`](PRODUCT_RULES.md), **§79**.

**A suspeita original não se confirmou, e a auditoria já tinha dito isso.** Com
tarifa A (`effectiveAt` 01/01/2026) e B (`effectiveAt` 01/09/2026), agosto
sempre respondeu A e setembro sempre respondeu B. O caso está travado em teste
(`rate-validity.test.ts`, caso G, e o cálculo real em `rate-validity-api.test.ts`)
para não regredir. Snapshots seguem intocados.

**O defeito REAL era a borda do dia, e foi corrigido.** `isRateCurrent`
comparava instantes crus: o marcador de "válida até hoje" é `00:00:00.000`, e
qualquer relógio depois disso já declarava a tarifa histórica — ela morria
durante o próprio dia impresso nela. A comparação passou a ser entre DIAS
CIVIS, inclusiva nas duas bordas, com o mesmo `diaDaColunaDeData` que §71 e §73
já usam. Reprodução antes da correção: o caso F reprovava com
`expected false to be true`.

**O relógio saiu das decisões de vigência.** `toResourceDTO` não aceita mais
"hoje" implícito — a data de referência é obrigatória —, e os read models
(detalhe, listagem, pendências da estrutura, DTO de uso, congelamento na
ativação) perguntam pelo **dia comercial** (`marcadorDeHojeComercial`), não pelo
relógio do processo, que em Railway é UTC. Tarifa registrada sem vigência
informada passou a nascer como MARCADOR de dia civil, e não como o instante do
clique: a coluna deixou de misturar duas codificações.

**Auditoria de dados, somente leitura.** PROD: 9 recursos, 10 tarifas, **zero**
com `validUntil` e **zero** com `effectiveAt` fora do marcador de dia — o
defeito era latente lá, e nenhuma linha muda de interpretação com a correção.
DEV: 125 tarifas, 22 com `effectiveAt` gravado como instante de madrugada (o
padrão antigo), todas de fixture de suíte. Zero backfill, zero dado alterado.

**A interface nunca ofereceu "válida até".** `validUntil` só é LIDO na coluna
do histórico; não existe campo para escrevê-lo. Por isso a borda corrigida só
era alcançável por API ou carga — e por isso o E2E prova a borda de INÍCIO, que
é a que a tela consegue criar, com as bordas de fim provadas de forma
determinística em teste de API.

**Sobreposição continua em DISCOVERY, reconciliada com
SUPPLIER-OFFER-OVERLAP-01.** Criar B não encerra A: as duas ficam sem
`validUntil`, o histórico marca **as duas** como "Vigente" e só o resumo do topo
diz qual o motor usa. O banco permite (nenhuma constraint), o service permite
(nenhuma validação), o desempate é determinístico (`effectiveAt` mais recente,
depois `createdAt`) — e **PROD já tem 1 recurso nesse estado**. As opções —
encerrar a anterior, bloquear, alertar, ou permitir com prioridade explícita —
não foram escolhidas aqui: são a mesma pergunta nos dois lados do custo e
precisam de uma resposta só. O estado atual está travado em teste, para que a
mudança de política seja deliberada.

**F-03-1 e F-07-1 foram fechados no FIX-06 (2026-09-08).** O bloco de
custo da Formulação dependia de `version?.components.length` para recarregar:
mudar a quantidade de um componente e salvar não muda o tamanho da lista, então
a tela seguia mostrando o custo anterior até um F5. Agora quem salva pede a
estimativa nova ao servidor — nada é recalculado no navegador — e, enquanto
houver edição pendente, o bloco se identifica como o do último salvamento
(§54). Na Sugestão de Compra, cinco células imprimiam a string da API direto no
JSX; passaram por `formatQuantity`, o mesmo das colunas vizinhas. O dado cru não
mudou: a correção é de exibição.

**PROD-ERR-01 foi fechado em 2026-09-08.** `mapDomainError` de
`production-orders.routes.ts` ganhou a mesma linha que os dois irmãos já tinham
— `400 customer_mismatch`, mensagem do domínio intacta, corpo só com
`{ error, message }`. Nenhum service, nenhuma regra e nenhuma tela mudaram.

**F-08-2 foi fechado no FIX-03 (2026-09-08).** Atingia **164 dos 214 produtos
aprovados (77 %)**: a tela carregava 50 produtos por código e procurava o produto
da OP dentro dessa página, onde `undefined` virava "inválido" — e o campo Produto
abria em branco. A ordem passou a ser resolvida por identidade, pelo DTO que ela
já traz; nenhum endpoint novo, nenhuma requisição a mais.

**F-06-1 e F-06-2 foram fechados no FIX-04 (2026-09-08).** O saldo em aberto já
estava escrito acima do campo e a tela não o usava: digitar 80 contra 50 só era
recusado pelo servidor, depois do diálogo de irreversibilidade, e o alerta ficava
na tela depois de a quantidade ser corrigida. O veredito por linha passou a ser
DERIVADO — erro que mora em estado é erro que sobrevive à correção. O servidor
continua recusando igual.

**F-09-1 e F-07-2 foram fechados no FIX-05 (2026-09-08).** `getReservationStatus`
resolvia `getAvailableByItems` e parava aí: a tela do Pedido sabia que o
disponível era zero e não sabia por quê, enquanto a Posição de Estoque já
escrevia "aguardando liberação da Qualidade" na própria linha pelo irmão
`getUnavailabilityByItems`. Os dois passaram a sair da mesma resolução, em lote,
e a tela do Pedido repete a frase do Estoque em vez de montar a sua. A ação
continua bloqueada — o que mudou é que ela diz o motivo, a quantidade que falta
e o caminho até a posição do item. Nenhum endpoint novo, nenhuma requisição a
mais. F-07-2 saiu junto por ser o mesmo G3 pelo outro lado: a coluna da OP passou
a se chamar "Disponível para esta OP", com a ⓘ explicando por que a Posição de
Estoque mostra menos. **Cálculo intocado nas duas pontas.**

**Os dois achados abertos pelo FIX-05 foram fechados no FIX-05b (2026-09-08).**
Ordem de Produção CANCELADA deixou de prender o Pedido — a contagem passou a usar
um conjunto explícito de estados que prendem, com COMPLETED dentro dele de
propósito —, e a ação de cancelar passou a existir na tela para pedido em
atendimento, que é onde a regra do domínio sempre valeu. `CustomerMismatchError`
deixou de escapar de `apply-fulfillment-plan` como 500: virou
`400 customer_mismatch`, o mesmo par que o módulo de Projetos já usava. Nenhuma
OP é apagada; a cancelada continua no histórico.

**F-03-1 viola §54** ao pé da letra: "é proibido mostrar dois números de
momentos diferentes sem dizer qual é qual".

#### PROJECT-CUSTOMER-CONTACT-01 — contato do cliente visível no Projeto

Vindo do walkthrough real (2026-09-09). Quick win de leitura.

Hoje `ProjectDetailPage.tsx:234` mostra `Cliente` com `EntityLink` (código e
nome) — o **link já existe**. Não existem telefone, e-mail nem contato
principal, e quem está no Projeto sai dele para ligar para o cliente.

Exibir em leitura, **sempre resolvido a partir de `Customer`**: telefone,
e-mail, contato principal quando existir, e o link que já está lá. Nenhum campo
novo em `Project` — duplicar contato criaria dois endereços de verdade para o
mesmo fato, e o do Projeto envelheceria calado.

#### QUOTE-DUPLICATE-01 — "duplicar como nova versão" — CONFLITO A RESOLVER

Vindo do walkthrough real (2026-09-09). A auditoria de código mostra que **a
maior parte disto já existe**, e que um dos comportamentos pedidos foi
deliberadamente REMOVIDO por COM-PRICE (§74). Registrado como reconciliação, não
como build.

`createQuoteVersion` (`quotes.service.ts:271`) já cria a versão nova em `DRAFT`
e já copia, da versão anterior: moeda, observações comerciais, condições de
pagamento, prazo de entrega, desconto, método de pagamento, entrada, número e
intervalo de parcelas, juros — e as linhas com produto, quantidade, unidade e
ordem. Não copia status, não recalcula CMV, não rebaseia precificação (cada
proposta confirma a própria base econômica) e sugere a validade quando a
condição inteira é herdada.

O que o pedido traz de NOVO, e vale trabalho:

- **duplicar uma versão ESCOLHIDA.** Hoje a fonte é sempre
  `project.quoteVersions[0]` — a de maior `versionNumber`. Com V5 existindo não
  há como partir da V3;
- **a ação não se chama duplicar.** A entrada é "nova versão", e a pessoa que
  quer V4 a partir da V3 não encontra o caminho;
- **rascunho aberto intercepta.** Havendo `DRAFT`, a função devolve esse
  rascunho em vez de criar — correto para não multiplicar negociação paralela,
  mas é o que alguém pedindo "duplicar" leria como ação ignorada.

**O conflito.** O handoff pede "copiar preços". §74 decidiu o contrário: preço
só nasce preenchido no único caso seguro — condição ACEITA do mesmo projeto e
produto, ainda vigente, mesma quantidade física — e aí com proveniência
(`INHERITED_AGREEMENT`). Copiar `unitPrice` em silêncio era exatamente o defeito
que COM-PRICE corrigiu: "a proposta nova saía com o preço da anterior sem que
ninguém tivesse decidido mantê-lo". Duplicar a partir de uma versão **SENT**,
como no exemplo V3 → V4, agrava: proposta enviada e não aceita não é acordo.

Decisão necessária do PO antes de implementar: duplicar traz o preço como
`MANUAL` sem proveniência (reabre o buraco de §74), ou traz sem preço e a pessoa
decide por linha (mantém §74 e torna "duplicar" um atalho de condições
comerciais, não de preço)? Também **não alterar V3** precisa ser lido junto com
§70: aceitar uma versão nova supera as aceitas em aberto, e isso é mudança de
status na anterior — legítima e já decidida, mas é "alterar V3" em algum sentido.

#### CUSTOMER-COMMERCIAL-STATUS-01 — situação comercial viva do Cliente

Decisão de produto de 2026-09-09, vinda do walkthrough real.

**Uma entidade só.** Prospect e Cliente NÃO se separam em cadastros diferentes:
continua existindo `Customer`, e a situação comercial é uma LEITURA dele. Criar
um cadastro de Prospect obrigaria a migrar o registro na conversão, e migrar
registro perde história — o mesmo motivo pelo qual Pedido não é um Orçamento
reescrito.

**Estado DERIVADO, não campo mantido à mão.** A situação sai da história
comercial e das datas; ninguém atualiza um campo. Um `select` que alguém precisa
lembrar de mexer envelhece calado, e um cliente marcado "ativo" há dois anos não
é informação — é um rótulo. **Não criar job** só para virar uma coluna de
`PROSPECT` para `INACTIVE` à meia-noite antes de provar que a persistência é
necessária: derivar na leitura é mais barato e não pode ficar dessincronizado.

**Três situações**, com o rótulo de tela em pt-BR:

| Estado | UI | Significado |
|---|---|---|
| `PROSPECT` | Prospect | Relacionamento comercial em formação, sem conversão |
| `ACTIVE` | Cliente ativo | Já estabeleceu relacionamento comercial efetivo |
| `INACTIVE` | Inativo | Sem oportunidade aberta e fora da janela |

**Não confundir com `Customer.active`.** O booleano que já existe no schema é
operacional — diz se o cadastro pode ser usado em documento novo — e é decidido
por gente. A situação comercial é derivada e responde outra pergunta. Os dois
coexistem e nenhum substitui o outro. Mesma cautela com a palavra "prospect" na
casa: `PRODUCT_RULES.md` §53 e o schema usam **prospectivo** para CUSTO (o que se
espera pagar, contra o custo real). Nada a ver.

**As regras decididas:**

- **nascimento** — `Customer` novo, sem evidência de relacionamento anterior:
  Prospect;
- **janela de 15 dias** — nunca houve conversão, não existe Projeto
  comercialmente aberto, e passaram mais de 15 dias desde a última atividade
  comercial relevante: Inativo. **15 dias é decisão de PO de hoje**; avaliar no
  discovery se vira constante ou configuração. **Não criar configuração nesta
  rodada**;
- **sem Projeto** — criado em D0, nenhum `Project`: Prospect de D0 a D+15,
  Inativo depois. A inclusão exata da data-limite usa a semântica de **dia
  civil** do projeto (§71, §73, `lib/business-day.ts`), nunca um instante
  fabricado;
- **Projeto em andamento** — havendo pelo menos um Projeto comercialmente
  aberto, o cliente sem conversão **continua Prospect**. Não vira Inativo só
  porque `Customer.createdAt` passou de 15 dias;
- **Projeto cancelado** — a última atividade relevante passa a ser o
  encerramento; 15 dias de Prospect e depois Inativo, se nada novo surgir;
- **conversão** — teve em QUALQUER momento um Projeto aprovado: **Cliente
  ativo**, e isso é histórico. **Não regride** por falta de atividade recente;
- **reativação sem botão** — Inativo com Projeto novo aberto volta a Prospect
  sozinho; convertendo depois, Cliente ativo. Não existe ação "Reativar
  cliente": a atividade comercial conduz a situação.

**`ACTIVE` não significa recência.** Cliente ativo é quem já estabeleceu
relacionamento efetivo, não quem comprou nos últimos N dias. Medir compra
recente, cliente dormente e risco de churn é OUTRA dimensão, e misturá-la aqui
produziria um estado que responde duas perguntas e mente nas duas.

**O status devolve o MOTIVO.** Read model, não frase persistida: "Projeto X em
andamento", "Sem oportunidade aberta há mais de 15 dias", "Primeiro
relacionamento aprovado em 18/03/2025". Um estado derivado que não explica de
onde veio é indistinguível de um campo errado.

**GATE antes de implementar — o que prova conversão.** A regra mínima do PO é
"Projeto aprovado", e o schema mostra que ela é INCOMPLETA:
`CustomerOrder.customerId` é obrigatório, `sourceQuoteVersionId` é **opcional** e
não existe `projectId` em `CustomerOrder`. Logo um Pedido confirmado, expedido e
faturado pode existir sem Projeto nenhum e sem Orçamento — em DEV, 13 de 42
linhas de Pedido não têm origem em orçamento. Com a regra mínima, **quem já
comprou direto seria classificado Inativo em 15 dias.** Auditar e levar ao PO:
Orçamento ACEITO, `CustomerOrder` `CONFIRMED` em diante, e qualquer outro caminho
que o domínio já permita. Decisão de PO quando a capability for executada, não
agora.

**Segunda pergunta do discovery:** quais `ProjectStatus` contam como
"comercialmente aberto". Os valores reais são `WAITING`, `SAMPLE`, `APPROVED`,
`CANCELLED` e `STAND_BY` — e `STAND_BY` é justamente o ambíguo. As datas para
derivar já existem: `Project.approvedAt`, `Project.cancelledAt` e
`ProjectStatusHistory.changedAt`.

**Escopo de UX, a implementar com a capability:** filtro na listagem de Clientes
— Clientes ativos · Prospects · Inativos · Todos —, com **Clientes ativos** como
padrão. Na Consulta do Cliente: situação, motivo, "cliente desde" quando
derivável, e resumo de Projetos. **Não é CRM**: sem funil, sem etapa, sem
atividade agendada.

**Fronteira com Projeto.** Situação do `Customer` e situação do `Project` não se
misturam. Um Cliente ativo pode ter ao mesmo tempo Projeto aprovado, Projeto em
desenvolvimento e Projeto cancelado, e **Projeto novo de cliente antigo não o
devolve a Prospect**.

**Contrato não dirige situação** — ver COM-CONTRACT-01. Cliente pode ser ativo
sem contrato cadastrado; os conceitos são independentes.

### P2 — depois da estabilização

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

### P3 — baixo impacto

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-04-1** | "atinge 100%" exibido quando margem + comissão passa de 100 % | LOW | M |
| **F-05-1** | R$ 0,04 entre Precificação e Orçamento (fronteira §60) sem explicação em nenhuma das telas | UX | XS |
| **F-01-3** | "Consulta completa" só é alcançável de dentro do modal de edição | UX | S |

### Encerrados na triagem, sem trabalho

| ID | Disposição | Por quê |
|---|---|---|
| **F-01-5** | CLOSED | `clientes.csv` não tem coluna de data e `MappedCustomer` não tem o campo. "Cadastrado em" mostra a única data que existe |
| **F-02-3** | DUPLICATE | É o **#4**, aceito com residual pelo PO em 2026-09-04: 117 px medidos então, 131 px agora. Mesma tabela, mesma causa |
| **F-10-1** | DUPLICATE | É o próprio F-01-1 reconfirmado depois da aprovação do projeto |
| **F-01-4** | DEFER | A ordem do menu é deliberada e está justificada em `navigation.ts:4` ("cadastro e configuração ficam no fim: não são operação diária"). Mudar é decisão de produto, não correção |

**F-01-3 é parcialmente NOT_A_BUG.** A auditoria afirmou que código e nome do
cliente não são clicáveis; `CustomersPage.tsx:212,236` mostra
`table--clickable-rows` e `<tr onClick>` com `tabIndex`. A linha é clicável e
abre a edição, que contém o link "Consulta completa". Sobra só o resíduo em P3.

### Grupos de causa raiz — o que se corrige junto

| Grupo | Achados | Causa | Por que junto |
|---|---|---|---|
| **G1** | ~~F-07-1~~ — fechado no FIX-06 | Precisão exibida e precisão validada não se reconciliam | As três comparações `Number(digitado) > Number(limite)` — OP, Expedição e Pedido, esta última remendada com `+ 1e-6` — foram substituídas por `quantity-limit.ts` em FIX-01. Sobra F-07-1, que é exibição sem campo de entrada: o mesmo valor sai formatado numa tela e cru na outra |
| **G2** | ~~F-02-2, F-02-1~~ — fechado no FIX-02 | Quantidade **declarada** usada como se fosse a física | `convertUomDecimal` era chamado com os mesmos argumentos em `formulations.service.ts` e `costs.service.ts`, sem o motor de necessidade. Mesmo atalho, dois lugares. Os dois chamam o motor agora, e o campo `stockEquivalentQuantity` deixou de existir |
| **G3** | ~~F-09-1, F-07-2~~ — fechado no FIX-05 | "Disponível" composto ad-hoc por tela | O Pedido passou a chamar `getUnavailabilityByItems` junto com `getAvailableByItems`, na mesma resolução de escopo, e a exibir o motivo com as palavras do Estoque. A OP continua com o cálculo próprio — que é legítimo e está documentado em `requirement-availability.ts:44` — e agora diz isso no rótulo |
| **G4** | ~~F-06-1, F-06-2~~ — fechado no FIX-04 | `fieldErrors` só nascia da resposta do servidor e só resetava no próximo envio | Mesmo arquivo, mesmo mecanismo: o conserto de um resolveu o outro. O veredito da quantidade é derivado, e a chave de `fieldErrors` deixou de ser a posição no array |
| **G5** | F-06-3 | `nextval` antes da transação | Cinco módulos, mesmo diff, revisão mecânica de uma vez |

### Achado estrutural, sem item próprio

Existem **três implementações independentes** da conta "quantidade por base":
`packages/shared/src/formulation-quantity.ts` (`fatorDaBase`),
`apps/api/src/lib/formulation-math.ts` (`basisFactor`, reimplementado à mão) e o
`convertUomDecimal` cru usado como se fosse a conta. O comentário do próprio
pacote compartilhado diz que isso é o que o domínio proíbe: *"duas contas para o
mesmo número acabam discordando, e a que aparece na tela seria a que ninguém
usa."* G2 é o primeiro sintoma; consolidar os três motores é candidato a
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


### 17. `pnpm test` da API reprova numa janela diária de 3 horas — MEDIUM

Achado de 2026-09-09, durante CUSTOMER-CEP-02. **Não é defeito de produto, e
não vem daquela branch:** medido no `d640bf2` limpo, sem nenhuma alteração, o
resultado é o mesmo — `63 failed | 1349 passed (1412)`, 19 arquivos de
`apps/api`.

A causa é a asimetria de leitura entre instante e dia, do lado das FIXTURES. O
helper `hoje()` de `supplier-items.test.ts` (e o mesmo padrão em outros
arquivos) escreve `new Date().toISOString()` — o INSTANTE — numa coluna que o
domínio lê como marcador de dia: `offerValidityToday` compara
`diaDaColunaDeData(effectiveAt)`, que lê em **UTC**, contra `hojeComercial()`,
que lê em **America/Sao_Paulo**. Entre 00:00 e 03:00 UTC — 21:00 a 23:59 em São
Paulo — o dia UTC já virou e o comercial não, então uma oferta criada "agora"
volta `NOT_YET_EFFECTIVE`.

Nesta máquina, que roda em `America/Vancouver`, a janela cai às 17:00–20:00
locais, que é quando a medição foi feita. Em CI que roda em UTC a janela existe
igual — só cai em outro horário local.

**O produto não tem esse defeito**: a tela manda `<input type="date">`, que
materializa `T00:00:00Z` e é lido como o dia certo. Quem afirma o instante é só
a fixture. A correção é a fixture escrever um marcador de dia comercial
(`marcadorDeDia(hojeComercial(new Date()))`), não `toISOString()`.

Ficou fora de CUSTOMER-CEP-02 de propósito: são 63 testes em 19 arquivos, do
lado do custo, e a branch era de runtime do frontend. Enquanto não for
corrigido, `pnpm test` é confiável fora da janela e enganoso dentro dela — o
que é pior que falhar sempre.

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
| **W7** | Quantidade ainda passa por `Number` em pontos de **exibição** das telas de OP e Pedido: teste de sinal (`> 0`, `<= 0`) em `badge`/`disabled`, a diferença `onHand - reserved - available` renderizada (`ProductionOrderPage.tsx:1157`) e o total somado na tela (`CustomerOrderPage.tsx:2178`). O Pedido também imprime `reservedRemaining` e `stillToReserve` crus, sem `formatQuantity` (`2014`, `2015`, `2350`) | Classificado no FIX-01b e deliberadamente **não corrigido**: nenhum alcança payload nem validação. Teste de sinal sobre valor ≥ 10⁻¹² é seguro em `double`; o que é defeito de verdade — soma e diferença exibidas em ponto flutuante, e valor cru na tela — é da mesma família de F-07-1 e pertence ao PREC-UI, não a um remendo pontual |
| **W6** | Decisão de domínio pendente: trocar `RESTRICT` por `SET NULL` em alguma das 27 FKs opcionais | Não acontece mais por omissão no modelo (#14). Cada troca é decisão de domínio própria — bloquear a exclusão, desassociar ou arquivar — e exige a migration que a faça no banco |

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

### 16. COST-BASELINE-01 — prontidão real de custo e precificação — HIGH

A auditoria COST-VAR-01 mediu o problema de fundo, e ele não é de código.

Em produção: **zero recebimentos**, zero `IndustrialCostCalculation`, zero
`PricingVersion`, zero `PricingTier`. Metade das matérias-primas (288 de 581)
não tem nenhuma fonte de custo. Todo o custo que existe vem das 293
`ItemCostReference` — o degrau 5 da hierarquia, o mais baixo, e o único
classificado como estimativa.

Consequência que atravessa o comercial: **nenhuma `QuoteLine`, em DEV ou em
PROD, tem CMV congelado**. As colunas existem e `buildLineSnapshots` as
preenche, mas só quando a linha vem de faixa ou existe precificação ativa com
a mesma quantidade física — e não existe nenhuma.

O que a capability precisa fazer nascer, para produtos reais:

`IndustrialCostCalculation` → `PricingVersion`/`PricingTier` → `QuoteLine` com
CMV congelado.

**Ordem importa.** COST-SOURCE-01 destravou o degrau 4; informar vigência nas
ofertas legadas **sem** definir o fornecedor preferencial rebaixaria 90 itens
de "com custo" para `AMBIGUOUS_SUPPLIER_REFERENCE`. As duas decisões andam
juntas, e são do usuário: nenhuma escrita de massa comercial em produção foi
feita nem deve ser feita pelo sistema.

**Bloqueia COST-VAR-02.** Comparar "custo do orçamento × custo de hoje" sem o
primeiro termo entrega uma tela que responde "—".

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

Dois têm posição na fila viva porque a pergunta deles já tem dono e prazo
(COST-RESOURCE-MULTIPLIER-01 em P1-7, SUPPLIER-ADDRESS-01 em P1-8) — mas a
posição é da DESCOBERTA, não de uma implementação autorizada. Os outros
esperam a pergunta virar decisão.

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

**Contexto que NÃO é tarefa:** as 602 ofertas `LEGACY_IMPORT` seguem sem
`effectiveAt` e sem `preferred`, e isso é **dado do usuário**. Não existe item
para "corrigir as 602": informar vigência sem definir preferencial rebaixaria
90 itens para `AMBIGUOUS_SUPPLIER_REFERENCE` (ver COST-BASELINE-01). Nenhum
backfill, nem em DEV nem em PROD.

### COST-RESOURCE-MULTIPLIER-01 — multiplicador de recurso

Vindo do walkthrough real (2026-09-09). Exemplos dados: 1 operador × 2 h,
2 operadores × 2 h, 3 equipamentos iguais.

A hipótese do handoff — que isso pertence à **linha do recurso na Estrutura de
Custos**, não à Formulação — é confirmada pelo modelo:
`IndustrialCostResourceUsage` tem `usageQuantity` + `usageUom` + `usageBasis` e
`@@unique([industrialCostVersionId, industrialResourceId])`, com o comentário do
schema dizendo o desenho em voz alta: *"Uma linha por recurso: sem
roteiro/operações nesta fase, o mesmo equipamento usado em duas etapas soma o
tempo."*

Ou seja: 2 operadores × 2 h **já é representável** hoje, como `usageQuantity =
4 h`. O que se perde é a informação de QUANTOS — o custo fecha, a leitura não:
ninguém consegue responder "quantas pessoas" a partir de 4 h, e replanejar
exige refazer a multiplicação de cabeça.

Perguntas a responder com a Natália antes de qualquer campo novo: o
multiplicador é informação de CUSTO (só para explicar o número) ou de
CAPACIDADE (quantas pessoas/máquinas a fábrica precisa alocar)? Se for
capacidade, isto encosta em roteiro/operações, que está fora desta fase por
decisão. **Não implementar antes de auditar o modelo e confirmar o uso real.**

### SUPPLIER-ADDRESS-01 — endereço do Fornecedor

Vindo do walkthrough real (2026-09-09).

`Supplier` hoje tem código, razão social, nome fantasia, CNPJ, e-mail, telefone
e notas — **nenhum campo de endereço**. `Customer` tem os seis
(`zipCode`, `street`, `number`, `complement`, `district`, `city`, `state`) com a
consulta de CEP já funcionando em `lib/cep-api.ts`.

Restrição durável: **reusar a mesma fundação de endereço e CEP do Cliente**. Não
existe um segundo ViaCEP, não existe uma segunda máscara e não existe uma segunda
regra de "CEP incompleto não consulta". CUSTOMER-CEP-02 fechou em 2026-09-09 e
mudou esse comportamento: a fundação hoje é a de §80 — o endereço pertence a um
CEP, e trocar o CEP limpa os seis campos antes da consulta. O Fornecedor nasce
com ele, não com o anterior.

Exige migration (colunas novas em `suppliers`), e por isso é capability, não
quick win.

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

A validação com a Veridi (#7, #11) é gate só para as regras que dependem do
processo real do cliente. Não impede #8E, #8F e #8G quando o PO autorizar.

**Três gates nasceram do walkthrough de 2026-09-09**, e os três são de decisão,
não de código:

- a pergunta de preço em QUOTE-DUPLICATE-01 — copiar preço reabre §74;
- a pergunta de sobreposição de vigência, que vale ao mesmo tempo para
  SUPPLIER-OFFER-OVERLAP-01 e para o resíduo 2 de INDUSTRIAL-RATE-VALIDITY-01;
- **o que prova conversão** em CUSTOMER-COMMERCIAL-STATUS-01: "Projeto
  aprovado" sozinho classificaria como Inativo quem comprou direto, porque
  `CustomerOrder` não exige Projeto nem Orçamento.

As duas primeiras posições da fila (P0) **não dependem de nenhum dos três**.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
