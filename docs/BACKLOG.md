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

## A. Defeitos abertos

Triados em 2026-09-07 sobre a auditoria de produto. Evidência, passos e
conferência numérica ficam em [`E2E_AUDIT_CURRENT.md`](E2E_AUDIT_CURRENT.md);
aqui fica só o que exige trabalho, com a severidade **do PO**, que nem sempre é
a do auditor.

**Zero CRITICAL, zero BLOCKER, zero MEDIUM.** Sobram três LOW e a fila de UX —
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
cancelamento e reprogramação. **Próximo item de produto: a definir com o PO** —
PLAN-DATE-01 está registrado abaixo e não é sequência automática.

**TZ-LOTE-01 fechado em 2026-09-08** (§73). O PO decidiu a leitura (a): a
validade do lote é DATA CIVIL INCLUSIVA — o lote vale o dia inteiro e vence às
00:00 do dia seguinte em São Paulo. `isLotExpired` passou a responder pelo
mesmo `venceuEm` da validade comercial, e com ele os call sites que comparavam
por fora: liberação da Qualidade, painel de atenção, KPI do painel e relatório
de validade (inclusive `daysToExpiry`, agora em dias civis). Zero migration,
zero dado reescrito — os mesmos lotes passaram a ser lidos corretamente.

### P0 — antes de qualquer outra capability

Vazio. **F-02-2 foi fechado no FIX-02 (2026-09-08)**: a estimativa passou a
chamar `computeFormulationRequirements`, o mesmo motor da OP e do cálculo
industrial, em vez de converter a unidade da quantidade declarada e parar aí.
Em `CAFEÍNA PT 60 CAPS THE KING` o material foi de R$ 0,15 para R$ 9,10 —
exatamente as 60 doses que faltavam. Sem doses por embalagem a estimativa falha
fechada, com o motivo na tela. Nada havia sido persistido por esse caminho.

### P1 — próximas correções

Vazia. **F-03-1 e F-07-1 foram fechados no FIX-06 (2026-09-08).** O bloco de
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

### P2 — depois da estabilização

| ID | Título | Sev. | Tam. |
|---|---|---|---|
| **F-06-3** | `nextval` chamado fora da transação: recusa consome número de documento em cinco módulos | LOW | S |
| **F-03-2** | Coluna ORIGEM do histórico de versões vazia para versão criada de template | LOW | XS |
| **F-08-3** | Campos "Consumir agora" sem rótulo acessível | LOW | XS |
| **F-01-1** | "Produto" nomeia dois fatos diferentes na Consulta de Cliente | UX | S |
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

---

## Próximo gate

A validação com a Veridi (#7, #11) é gate só para as regras que dependem do
processo real do cliente. Não impede #8E, #8F e #8G quando o PO autorizar.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
