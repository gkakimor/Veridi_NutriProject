# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

Este arquivo responde quatro perguntas: onde estamos, o que está aberto, qual é
a próxima prioridade e como estão DEV e produção. **Não é changelog** — o log
cronológico vive no Git e em [`archive/`](archive/).

## Onde estamos

**`main` @ `0134674`.** MVP operacional validado internamente, blocos A a G
fechados: cadastros, compras, recebimento, qualidade, produção rastreada,
expedição, faturamento, custo industrial, cockpit, relatórios, projetos,
orçamentos e precificação.

**Auditoria de produto de 2026-09-07 — dez cenários ponta a ponta pela
interface, contra a base recarregada com os dados reais da Veridi.** Os dez
passaram. Trinta e nove conferências numéricas independentes bateram sem uma
diferença, e a precisão foi demonstrada preservada ponta a ponta (o preço
sugerido saiu R$ 16,44 do custo cheio `10,68903`, não R$ 16,45 do custo
arredondado). Achados em [`E2E_AUDIT_CURRENT.md`](E2E_AUDIT_CURRENT.md): 22 no total, zero
CRITICAL. **Triados em 2026-09-07 com leitura de código:** 3 HIGH, 4 MEDIUM,
4 LOW, 7 UX, 2 duplicados, 1 encerrado, 1 adiado. Auditoria e triagem não
corrigem — nenhuma linha de produto mudou.

**A fundação de precisão numérica está completa no armazenamento.** A cadeia inteira —
schema, persistência, serialização, formatação e comparação — respeita a matriz
de tipos de [`PRODUCT_RULES.md`](PRODUCT_RULES.md) §58, com quatro fronteiras de
fechamento nomeadas (§60, §62, §63), a assimetria entre elas declarada (§64) e o
motor decimal em 40 dígitos numa configuração canônica (§59). A **exibição** ficou
para trás: o corte de seis casas da tela foi escrito quando o banco guardava
seis, e desde o PREC-MIG-A ele guarda doze. Os dois P0 da triagem saem daí.

**`schema.prisma` e as migrations estão em sincronia** desde o #14: um banco
reconstruído do zero, DEV e produção são a mesma estrutura, campo a campo.

## O que está aberto

[`BACKLOG.md`](BACKLOG.md) — **zero CRITICAL, zero BLOCKER**. O que sobra:

- **achados triados da auditoria de 2026-09-07** — seção A do
  [`BACKLOG.md`](BACKLOG.md): 2 P1, 6 P2, 3 P3 (F-08-1 fechado em FIX-01;
  F-02-2 e F-02-1 em FIX-02; F-08-2 em FIX-03; F-06-1 e F-06-2 em FIX-04;
  F-09-1 e F-07-2 em FIX-05);
- **melhorias aprovadas, aguardando autorização do PO:** #8E, #8F, #8G;
- **aguardando validação com a Veridi:** #7 e #11;
- **manutenção:** #10;
- **watchlist** (observado, sem ação conhecida): W1 a W6.

Escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

## Campo com teto — o contrato de ida e volta (FIX-01, 2026-09-07)

`formatQuantity` corta em seis casas com `ROUND_HALF_UP`; o dado tem doze. Num
**teto**, esse arredondamento produzia um limite exibido diferente do real, e a
validação comparava com o real — o consumo de produção recusava exatamente a
quantidade impressa na tela (F-08-1), em 125 das 212 formulações ativas.

A regra agora é o **round-trip**: digitar o valor exibido significa "usar todo o
limite", e o que vai ao servidor é o valor canônico, com as doze casas. Está em
[`quantity-limit.ts`](../apps/web/src/lib/quantity-limit.ts) e é a única forma
de comparar quantidade digitada com teto — Consumo Real, Expedição e Plano de
Atendimento passaram a usá-la, e o `+ 1e-6` do Plano saiu. Domínio e
`reconciliation.ts` seguem exatos, sem tolerância.

**Campo novo com teto usa o helper.** Comparar `Number(digitado) >
Number(limite)` na tela reabre o mesmo defeito e viola §66.

**FIX-01b (2026-09-08) fechou os dois resíduos que o próprio FIX-01 encontrou.**
O apontamento de produção recalculava `planejado - produzido` por `Number` e
comparava o digitado contra esse número: passou a usar o `remainingQuantity`
que o servidor já entrega, com o mesmo round-trip do Consumo Real. E o
complemento do Plano de Atendimento — que **vai no payload** — saiu de
`Math.max(Number(a) - Number(b), 0)` para
[`quantity-complement.ts`](../apps/web/src/lib/quantity-complement.ts), em
`Decimal` e em notação decimal comum, porque a fronteira do servidor recusa
exponencial. Nas três telas do FIX-01 não sobrou nenhum `Number` sobre
quantidade que alcance payload ou validação — o que resta é sinal (`> 0`) e
soma de exibição, listado abaixo.

## A quantidade física tem um motor só (FIX-02, 2026-09-08)

A estimativa de custo da Formulação multiplicava o custo unitário pela
quantidade **declarada apenas convertida de unidade** —
`convertUomDecimal(component.quantity, …)` e nada mais. Ficavam de fora o fator
da base (doses por embalagem, base fixa, unidade acabada) e os ajustes de pureza
e overage. Em `CAFEÍNA PT 60 CAPS THE KING`, 60 doses por embalagem, o material
saía **R$ 0,15** onde a fábrica gasta **R$ 9,10**: sessenta vezes menos, na mesma
tela que mostrava a quantidade certa logo acima (F-02-2).

A estimativa passou a chamar `computeFormulationRequirements` — o motor da Ordem
de Produção, do cálculo industrial, do plano de atendimento e da precificação
(PRODUCT_RULES §52, agora com seis consumidores). Nenhuma segunda fórmula foi
escrita, nenhuma política de preço mudou: o que mudou foi a QUANTIDADE. Sem
doses por embalagem a estimativa falha fechada — nenhuma linha e nenhum total,
com o motivo na tela, em vez de uma lista de R$ 0,00.

O mesmo defeito alimentava a coluna "Equivalente estoque" (F-02-1): o DTO já
trazia `theoreticalPerUnit`, mas `rowFromDTO` o descartava e a versão gravada
caía em `stockEquivalentQuantity` — a mesma conta incompleta. Rascunho mostrava
`0,012 kg` e versão ativa `0,0002 kg` na MESMA célula. O campo defeituoso saiu do
DTO; a tela usa o campo autoritativo, e nada de pureza, overage, doses ou
conversão é reconstruído no navegador.

**Contrato protegido:** para a mesma versão, a quantidade do motor e a
quantidade que alimenta o custo são iguais **no Decimal**, antes de qualquer
apresentação —
[`custo-estimado-quantidade-fisica.test.ts`](../apps/api/src/modules/costs/custo-estimado-quantidade-fisica.test.ts).
Pela interface:
[`formulacao-quantidade-fisica-e-custo.mjs`](../scripts/e2e/formulacao-quantidade-fisica-e-custo.mjs).

Nada foi persistido pelo caminho defeituoso — a estimativa é lida a cada
abertura e nunca gravada —, então não houve backfill nem toque em dado
histórico.

## Identidade não se resolve por página de listagem (FIX-03, 2026-09-08)

A tela da Ordem de Produção carregava **uma página de 50 produtos** para
alimentar o campo de escolha e depois procurava o produto da própria ordem
dentro dessa página. Com 214 produtos aprovados, 164 deles — **77 %** — ficam
fora dessa página sob a ordenação por código: abrir a OP de qualquer um deles
deixava o campo Produto **em branco** e a tela concluía "Produto sem item de
produto acabado válido" para uma ordem válida (F-08-2). `undefined` virava
veredito de domínio.

Uma tela de detalhe conhece a entidade por **identidade**. O DTO da OP já traz
`productId`, `productCode`, `productName` e `finishedItemId` — este último lido
no servidor do mesmo `product.finishedProductItem` que o gate de planejamento
consulta. Enquanto o formulário aponta para o produto da ordem, ele é a fonte;
quando a pessoa escolhe outro, a fonte é o registro que ela acabou de escolher,
vindo da busca no servidor. **Nenhum endpoint novo, nenhuma alteração de DTO,
nenhuma requisição adicional** — e nada de `pageSize` inflado, que só adia o
mesmo defeito.

**A listagem continua servindo ao que ela é:** as opções do campo. O que saiu
foi o seu uso como fonte de verdade.

A frase só aparece quando o produto foi resolvido e realmente não tem item de
produto acabado — o bloqueio legítimo segue de pé. LOADING, NOT_FOUND e falha de
rede deixaram de ser a mesma resposta: "não consegui falar com o sistema" tem
tela própria, com nova tentativa, em vez de virar "ordem não encontrada".

**Contrato protegido:**
[`production-order-product-resolution.test.tsx`](../apps/web/src/pages/production-orders/production-order-product-resolution.test.tsx)
— alvo na posição 51 e na 214, alvo dentro da página, troca de produto, produto
sem PA, carregando, não encontrado e erro de rede. Pela interface:
[`ordem-de-producao-produto-fora-da-primeira-pagina.mjs`](../scripts/e2e/ordem-de-producao-produto-fora-da-primeira-pagina.mjs).

Nenhum dado foi tocado: o defeito era de leitura de tela, nunca chegou a gravar.

## A tela avisa antes de enviar, e o aviso responde à correção (FIX-04, 2026-09-08)

O Recebimento escrevia "Pedido: 50 kg · Recebido: 0 kg · **Aberto: 50 kg**" logo
acima do campo e não usava esse número para nada. Digitar 80 não produzia aviso:
a pessoa preenchia lote, validade e custo, passava pelo diálogo de
irreversibilidade e só então era recusada pelo servidor (F-06-1). Depois da
recusa, corrigir a quantidade não limpava o alerta — ele ficava na tela contando
uma história que já não era verdade, até a submissão seguinte (F-06-2). Mesmo
arquivo, mesma causa: **o veredito morava em estado, e só o servidor o escrevia**.

Agora o veredito é **derivado** de cada linha a cada render — `onChange`, botão e
envio leem do mesmo `validarQuantidadeRecebida`. Erro que não é guardado não
sobrevive à correção, e não existe a possibilidade de a tela bloquear por um
problema que já foi resolvido.

O teto vem de [`quantity-limit.ts`](../apps/web/src/lib/quantity-limit.ts), o
mesmo round-trip do FIX-01: o saldo tem doze casas, a tela mostra seis, e digitar
o número exibido significa "receber tudo o que está em aberto" — o que vai ao
servidor é o saldo canônico. Sem isso o único valor impossível de digitar seria
justamente o que está escrito na frente do operador. Nada passa por `Number`.

**O servidor não cedeu autoridade.** `receiving.service.ts` recalcula o saldo
dentro da transação, contra os recebimentos confirmados naquele instante, e
recusa igual — o saldo pode ter mudado desde que a página abriu. A tela antecipa
só o que ela já sabe com certeza.

Dois resíduos do mesmo mecanismo saíram junto: a chave de `fieldErrors` deixou de
ser a POSIÇÃO no array (`lines.0.receivedQuantity` indexa o payload, não a lista
da tela — com uma linha em branco antes, o erro do servidor pousava na linha
errada) e passou a ser o id da linha; e uma resposta que chega depois de a pessoa
já ter editado o formulário é descartada, em vez de reinstalar erro sobre valor
novo.

**Contrato protegido:**
[`receiving-live-validation.test.tsx`](../apps/web/src/pages/receiving/receiving-live-validation.test.tsx)
— acima do saldo, saldo exato, parcial, zero, ilegível, décima segunda casa,
limpeza escopada em duas linhas, erro de servidor na linha certa e envio pela
mesma validação. Pela interface:
[`recebimento-validacao-viva.mjs`](../scripts/e2e/recebimento-validacao-viva.mjs),
que observa a rede: a tentativa inválida não produz requisição.

## O zero também tem causa (FIX-05, 2026-09-08)

Com mil unidades recém-produzidas, a linha do Pedido mostrava "Falta reservar
1000 · **Disponível agora 0**" e o botão "Reservar disponível" desabilitado, sem
uma palavra sobre o porquê (F-09-1). A causa era legítima — o lote de produto
acabado nasce "Aguardando liberação" quando o produto exige liberação da
Qualidade — e o domínio já a conhecia: a Posição de Estoque escrevia "aguardando
liberação da Qualidade" na própria linha, pelo `getUnavailabilityByItems`. O
Pedido resolvia só o irmão `getAvailableByItems` e parava aí.

**A correção não habilita a ação.** Se o domínio diz indisponível, indisponível
continua — o que mudou é que a tela diz o motivo, a quantidade que falta e o
caminho até a posição do item. `getReservationStatus` passou a resolver o escopo
de itens **uma vez** e a consultar disponibilidade e indisponibilidade em lote
sobre ele; a linha ganhou `missingQuantity` e `unavailable`, e a tela traduz os
códigos de causa com o mesmo dicionário do Estoque. Nenhum endpoint novo, nenhuma
requisição a mais, nenhuma conta de disponibilidade no frontend.

Três fatos que a tela passou a distinguir, porque confundi-los é o que produz
diagnóstico falso:

- **retido** — o material existe e está preso (Qualidade, laudo, bloqueio,
  validade, reserva de outra demanda), com a quantidade de cada causa;
- **inexistente** — nada retido, a quantidade que falta ainda não foi produzida
  nem recebida;
- **desconhecido** — a consulta está em curso, ou falhou. Antes, falha de rede
  fazia a seção inteira sumir, e a leitura óbvia ("não há o que reservar") era
  justamente a que o sistema não podia afirmar.

F-07-2 saiu junto por ser o mesmo grupo pelo outro lado. A coluna DISPONÍVEL da
OP mostrava 15 onde a Posição de Estoque mostrava 3, no mesmo instante — e os
dois estavam certos: uma ordem **não compete contra a própria reserva**
(`requirement-availability.ts:44`), senão o compromisso dela viraria falta. O
defeito era o rótulo chamar duas perguntas pelo mesmo nome. A coluna passou a se
chamar "Disponível para esta OP", com a ⓘ dizendo por que o Estoque mostra menos.
**Nenhum cálculo de disponibilidade foi alterado nas duas pontas.**

Protegido por [`disponibilidade-reserva-explicada.test.tsx`](../apps/web/src/pages/customer-orders/disponibilidade-reserva-explicada.test.tsx)
(bloqueado com motivo, disponível, parcial, multilinha, carregando, erro),
[`disponivel-para-esta-op.test.tsx`](../apps/web/src/pages/production-orders/disponivel-para-esta-op.test.tsx)
(semântica do rótulo, nunca igualdade numérica) e `shipments.test.ts`, que prova
a transição real: liberado o lote pela Qualidade, a causa some e a falta zera.
Pela interface:
[`disponibilidade-comercial-explicada.mjs`](../scripts/e2e/disponibilidade-comercial-explicada.mjs),
que lê a frase na Posição de Estoque e exige que o Pedido diga aquilo.

## Dependência resolvida devolve o documento (FIX-05b, 2026-09-08)

Dois achados nascidos no FIX-05, os dois no mesmo domínio.

**Ordem de Produção cancelada prendia o Pedido para sempre.** Cancelar Pedido
em atendimento exige que não sobre obrigação operacional, e a checagem contava
Ordens de Produção **sem olhar status** — a verificação de reserva, na linha de
cima, já filtrava por `ACTIVE`. Cancelar a OP pelo caminho oficial não devolvia
o Pedido: ele ficava em atendimento sem saída pela interface, e cada execução do
E2E do FIX-05 deixava um preso no DEV.

A contagem passou a usar um conjunto explícito de estados que **prendem**:
DRAFT, PLANNED, RELEASED, IN_PRODUCTION, COMPLETED, BLOCKED. Só CANCELLED saiu.
Deliberadamente **não** é `OPEN_PRODUCTION_ORDER_STATUSES`: aquele conjunto
responde "o que está em aberto" e deixa COMPLETED de fora, enquanto aqui
COMPLETED prende — ordem concluída produziu produto acabado para este Pedido, e
desfazer isso é decisão de quem opera, nunca efeito colateral de um
cancelamento. Duas perguntas diferentes, dois conjuntos. Um teste falha se um
status novo nascer sem essa decisão ser tomada, e o padrão para o desconhecido é
prender.

A tela também escondia a ação: `isCancellable` só valia para DRAFT e CONFIRMED,
embora o domínio sempre tenha permitido IN_FULFILLMENT sob condição. Resolver as
dependências não tinha efeito visível. A ação passou a existir em atendimento —
o servidor continua sendo a autoridade e recusa com o motivo quando ainda houver
dependência. Expedição confirmada segue fora: ali a saída física não se desfaz
com um cancelamento simples. **Nada é apagado em cascata**: a OP cancelada
continua no histórico, só deixa de contar.

**Erro de negócio vestido de falha de servidor.** `CustomerMismatchError` —
produto de um cliente num Pedido de outro — nasce dentro do
`createDraftProductionOrderInTx` que `apply-fulfillment-plan` chama, e a rota não
a mapeava: HTTP 500. A mensagem chegava certa à tela por acidente, e o preço era
um erro de servidor no console para uma recusa que o próprio pedido causou.
Mapeada para `400 customer_mismatch`, o mesmo status e o mesmo código que o irmão
do módulo de Projetos já usava. Contrato preservado: mensagem em português,
`{ error, message }`, sem stack.

Protegido por
[`cancelamento-op-cancelada.test.ts`](../apps/api/src/modules/customer-orders/cancelamento-op-cancelada.test.ts)
(uma cancelada, uma ativa, cancelada + ativa, todas canceladas, reserva ativa sem
OP viva, guarda de exaustividade de status, e o 400 do mismatch),
[`erro-de-dominio-na-tela.test.ts`](../apps/web/src/lib/erro-de-dominio-na-tela.test.ts)
(o texto que a faixa mostra) e, pela interface,
[`cancelamento-de-pedido-com-op-cancelada.mjs`](../scripts/e2e/cancelamento-de-pedido-com-op-cancelada.mjs),
que percorre recusa → cancelar OP → cancelar Pedido sem deixar resíduo.

## O runner oficial não disputa a máquina consigo mesmo (2026-09-08)

`pnpm test` chama `pnpm -r test`, e a concorrência padrão do pnpm é **4**: a
suíte da API e a da web subiam ao mesmo tempo. A API tem teto de três workers;
a web não tinha teto nenhum, e o padrão do Vitest é `núcleos − 1` — quinze
processos com jsdom. Dezoito forks mais os supervisores em dezesseis núcleos
lógicos: CPU em 100 % e fila de execução do Windows entre 7 e 23 threads
prontas esperando núcleo.

**Nada quebrava. Tudo ficava lento na mesma proporção.** As **903 requisições**
de `pricing-technical-precision.test.ts` são exatamente as mesmas nas duas
condições — mediana de **8,2 ms** sozinho e **23–29 ms** sob a web, p95 de 17 ms
para 68–107 ms. Não há corrida, espera, retry nem trabalho a mais: há a mesma
sequência, mais devagar. O teste `round-trip` encadeia **72 chamadas HTTP**
(quatro valores × a cadeia inteira de precificação, do recebimento com custo à
faixa de preço), e essa soma ia de **0,69 s** para **~5,0 s**.

O orçamento de 5 s do Vitest não estava errado — estava **empatado**. Em dez
`pnpm test` completos a mediana do teste caiu em cima da linha, 5014 ms, e por
isso o mesmo código passava e falhava sem nada mudar.

O runner oficial passou a rodar os workspaces **em sequência**
(`pnpm -r --workspace-concurrency=1 test`). Cada suíte recebe a máquina inteira
na sua vez. **Nenhuma suíte virou serial por dentro**: a API continua em três
workers e a web no padrão dela. Nenhum timeout foi alterado, nenhum retry
existe, nenhum `.skip`, nenhuma cobertura saiu.

| `round-trip` sob `pnpm test` | mediana | p95 | máx | falhas |
|---|---|---|---|---|
| antes | 5014 ms | 5032 ms | 5041 ms | **8/10** |
| depois | 956 ms | 965 ms | 965 ms | **0/10** |

**Não é o banco.** Pico de 36 conexões (limite 100), no máximo **3 ativas**
simultâneas e **zero** esperas de lock em 24 amostras. **Não é fixture nem
sequence.** A concorrência que divide o banco — a própria API, três workers,
mesmas tabelas, mesmo `FOR UPDATE` da numeração — leva o teste de 694 ms a
928 ms. Quem o leva a 4347 ms é a web, que não toca o banco.

**Ao mexer no runner, mexer no runner.** Reduzir workers da web ou aumentar o
timeout do arquivo trataria o sintoma e precisaria de reajuste a cada arquivo
novo de teste. A concorrência também não estava pagando: execução completa que
passava custava 151–157 s concorrente e custa 146–147 s em sequência.

**A faixa serial ganhou um segundo arquivo.** Com a API deixando de disputar a
CPU, os três workers dela passaram a se sobrepor de verdade, e apareceu uma
colisão que a lentidão escondia: `gmp-execution.test.ts` cria revisões de
documento controlado e as **ativa** — "revisão ativa" é uma só por tipo, para o
banco inteiro —, e o RELEASE de qualquer Ordem de Produção congela o id da
revisão vigente dentro da transação. Quando a limpeza do GMP apagava a revisão
entre a leitura e a escrita de um vizinho, o release estourava
`P2003 production_orders_productionOrderRevisionId_fkey`, num arquivo diferente
a cada vez (`costs`, `picking`, `consumption`): **3 falhas em 22 execuções** da
suíte da API. O arquivo foi para `vitest.serial.config.ts` pelo critério que já
estava escrito lá — estado global inevitável —, e nenhuma expectativa mudou.
Custo: ~5 s a mais na suíte da API.

## Recusa de negócio tem o status de recusa de negócio (PROD-ERR-01, 2026-09-08)

`CustomerMismatchError` — produto de um cliente numa OP de outro — nasce em
`resolveOrderCustomerId` e é chamada de três lugares. O FIX-05b mapeou a rota do
Plano de Atendimento; as duas do próprio módulo de Produção ficaram sem
tratamento, e o mesmo erro de domínio saía como **HTTP 500** no `PATCH
/production-orders/:id` e no `POST /production-orders/:id/plan`. A mensagem
certa chegava à tela por acidente: o handler genérico do Fastify também carrega
`message`. Agora as três rotas respondem `400 customer_mismatch`, com a mensagem
do domínio intacta e o corpo só com `{ error, message }` — a mesma convenção do
módulo de Projetos (`ProjectProductCustomerMismatchError`). **Só o mapeamento
mudou:** nenhum service, nenhuma regra de detecção, nenhuma tela.

**A auditoria da rota achou o alcance real de cada uma.** Pelo PATCH, o caminho
é o fluxo normal — trocar o produto de uma OP nascida de Pedido resolve o dono
do material de novo. Pelo `/plan`, não: o serviço só resolve o cliente quando a
OP ainda não tem um (`order.customerId ?? resolveOrderCustomerId(…)`), e nenhuma
escrita atual grava `customerOrderId` sem gravar o cliente junto. A rota
continua coberta porque uma linha anterior ao preenchimento da coluna tem essa
forma — e era exatamente ela que produzia o 500.

## Próxima prioridade

**FIX-06** — a fila P1 da seção A (F-03-1, F-07-1).

**Antes de qualquer PREC-UI:** o roadmap afirma que PREC-UI-05 e PREC-UI-06 "já
são o comportamento atual". F-08-1 provou que não — e FIX-01 corrigiu só o campo
com teto, não a exibição em geral.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11). Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## DEV

Banco local `veridi_dev`. Reconstruído pelo caminho oficial em 2026-09-07 —
`drop/create` + as 56 migrations + seed de infraestrutura — e recarregado com os
dados mestres reais do corpus da Veridi, as referências de preço de mercado e o
pacote sintético de exemplos. Sem massa operacional de rodada anterior.

Caminho canônico, nesta ordem:

1. `pnpm exec dotenv -e .env -- node scripts/local-db-reset.mjs --confirmar`
2. `pnpm veridi:import:validate` → `:plan` → `:apply -- --apply` → `:verify`
3. `pnpm veridi:market-reference -- --apply`
4. `pnpm veridi:examples -- --apply`

Nunca `db push`, nunca edição manual de `_prisma_migrations`. Runbook do
importador em [`VERIDI_MIGRATION.md`](VERIDI_MIGRATION.md).

**Resíduos de laboratório declarados**, para a próxima reconstrução planejada —
nenhum é apagado por SQL, e nenhum estorno foi inventado para removê-los:
`OC-006794` e `OC-006795` recebidas pelo E2E do FIX-04, e a V2 em rascunho de
`PROD-000158`.

Os Pedidos que o E2E do FIX-05 deixava presos (`PED-003985`, `PED-003986`)
**deixaram de ser resíduo no FIX-05b**: foram cancelados pela interface, pelo
fluxo oficial, depois que a OP cancelada parou de prender. As suítes de E2E
comerciais passaram a encerrar a própria massa — cancelam as OPs que geraram e
depois o Pedido, nessa ordem.

## Produção

Railway, deploy automático da `main`. Carrega **dados mestres reais e
estruturas de referência marcadas como sintéticas** — nenhuma operação
fictícia: zero pedido, OP, recebimento, lote, movimento de estoque ou
faturamento criado por carga. Implantação em [`DEPLOY.md`](DEPLOY.md).

**Regra durável aprendida em 2026-09-07, e que custou uma recarga:**
`Item.code` (`MP-000372`) sai de uma **sequence do Postgres, uma por banco** —
o mesmo código nomeia itens DIFERENTES em DEV e em produção. Qualquer carga que
identifique registro por código interno grava no registro errado. A chave
estável entre ambientes é `externalCode`, o código da planilha original, que o
importador copia e nunca regenera. `scripts/veridi-market-reference/load.ts`
resolve por `externalCode` e recusa a linha que não o tiver.

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, próximo gate | este arquivo |
| Achados da auditoria de produto | [E2E_AUDIT_CURRENT.md](E2E_AUDIT_CURRENT.md) |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Precisão numérica: inventário e plano | [NUMERIC_PRECISION_AUDIT.md](NUMERIC_PRECISION_AUDIT.md) |
| Onde cada regra é protegida | [TEST_COVERAGE_MAP.md](TEST_COVERAGE_MAP.md) |
| Estratégia de E2E | [E2E_STRATEGY.md](E2E_STRATEGY.md) |
| Regras duráveis de UI e marca | [UI_BRAND.md](UI_BRAND.md) |
| Escopo do MVP · valor futuro | [MVP_PLAN.md](MVP_PLAN.md) · [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Stack e ambiente · implantação · migração do legado | [TECH_BASELINE.md](TECH_BASELINE.md) · [DEPLOY.md](DEPLOY.md) · [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Validação com o cliente · perguntas regulatórias | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) · [BLOCK_H_VALIDATION.md](BLOCK_H_VALIDATION.md) |
| Histórico — validações, deliveries e findings | [archive/E2E_VALIDATION_HISTORY.md](archive/E2E_VALIDATION_HISTORY.md) · [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) · [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

## Manutenção deste arquivo

Alvo de 110 linhas. Reescrever e condensar; nunca acumular diário.
