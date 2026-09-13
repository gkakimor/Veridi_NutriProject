# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

Este arquivo responde quatro perguntas: onde estamos, o que está aberto, qual é
a próxima prioridade e como estão DEV e produção. **Não é changelog** — o log
cronológico vive no Git e em [`archive/`](archive/).

## Onde estamos

**MVP operacional validado internamente.** Blocos A a G
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
seis, e desde o PREC-MIG-A ele guarda doze. Os P0 da triagem saíram daí, e o
resíduo de exibição é o W7.

**`schema.prisma` e as migrations estão em sincronia** desde o #14: um banco
reconstruído do zero, DEV e produção são a mesma estrutura, campo a campo.

## O que está aberto

[`BACKLOG.md`](BACKLOG.md) — **zero CRITICAL, zero BLOCKER**. O que sobra:

- **achados triados da auditoria de 2026-09-07** — seção A do
  [`BACKLOG.md`](BACKLOG.md): **P0 e P1 vazias**, 6 P2 e 3 P3 (F-08-1 fechado em
  FIX-01; F-02-2 e F-02-1 em FIX-02; F-08-2 em FIX-03; F-06-1 e F-06-2 em
  FIX-04; F-09-1 e F-07-2 em FIX-05; F-03-1 e F-07-1 em FIX-06);
- **melhorias aprovadas, aguardando autorização do PO:** #8E, #8F, #8G;
- **aguardando validação com a Veridi:** #7 e #11;
- **manutenção:** #10;
- **watchlist** (observado, sem ação conhecida): W1 a W6.

Escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

## Correções da auditoria de produto (FIX-01 a FIX-05b, 2026-09-07/08)

Sete achados fechados. A regra durável de cada um está em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md) e o teste que a protege em
[`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md); aqui fica só o que ainda orienta
decisão.

**Campo com teto usa o round-trip (FIX-01/01b, F-08-1).** `formatQuantity` corta
em seis casas e o dado tem doze: digitar o valor exibido significa "usar todo o
limite", e o que vai ao servidor é o canônico. Está em
[`quantity-limit.ts`](../apps/web/src/lib/quantity-limit.ts) e é a única forma
de comparar quantidade digitada com teto — `Number(digitado) > Number(limite)`
na tela reabre o defeito e viola §66. O complemento do Plano de Atendimento, que
vai no payload, usa
[`quantity-complement.ts`](../apps/web/src/lib/quantity-complement.ts). O que
sobra da defasagem é exibição sem entrada (W7).

**Quantidade física tem um motor só (FIX-02, F-02-2/F-02-1).** A estimativa de
custo da Formulação chama `computeFormulationRequirements` — o mesmo motor da
OP, do cálculo industrial, do plano e da precificação (§52, seis consumidores).
Sem doses por embalagem ela falha fechada, com o motivo na tela, em vez de uma
lista de R$ 0,00. Nada foi persistido pelo caminho defeituoso.

**Tela de detalhe resolve a entidade por IDENTIDADE (FIX-03, F-08-2).** A OP
procurava o próprio produto entre os 50 da primeira página da listagem e
acusava 164 dos 214 produtos aprovados de estarem sem item de produto acabado.
Listagem serve às opções do campo; nunca é fonte de verdade. Carregando, não
encontrado e falha de rede deixaram de ser a mesma resposta.

**A tela recusa o que já sabe que o servidor recusaria (FIX-04, F-06-1/F-06-2).**
No Recebimento o excesso é barrado antes do diálogo de irreversibilidade, o
veredito é derivado (nunca guardado em estado) e a limpeza do erro é escopada à
linha editada. O servidor continua recusando igual.

**Ação bloqueada por disponibilidade diz POR QUÊ (FIX-05, F-09-1/F-07-2).** A
causa vem de `getUnavailabilityByItems`, o mesmo mecanismo da Posição de
Estoque, com as mesmas palavras. "Disponível" da OP e do Estoque podem divergir
legitimamente — a ordem não compete contra a própria reserva — e o RÓTULO diz de
quem é o número (`requirement-availability.ts:44`).

**Dependência resolvida devolve o documento (FIX-05b).** Cancelar Pedido conta
Ordens de Produção por um conjunto explícito de status que prendem; OP cancelada
não prende mais, e nada é apagado. `CustomerMismatchError` virou
`400 customer_mismatch` — o mesmo par que o módulo de Projetos já usava —, e o
PROD-ERR-01 estendeu o mapeamento às duas rotas do módulo de Produção.

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

## Número derivado diz de que momento ele é (FIX-06, 2026-09-08)

**F-03-1.** O bloco de custo da Formulação vem do servidor, e o efeito que o
buscava dependia de `version?.components.length`: mudar a quantidade de um
componente e salvar não muda o tamanho da lista, então a tela seguia mostrando o
custo anterior até um F5. Agora **quem salva pede a estimativa nova**, com o
mesmo guarda de geração da busca de entidades — resposta atrasada não
sobrescreve a seguinte. **Nada é recalculado no navegador**: a quantidade física
e a estimativa continuam autoritativas no servidor (§52). Salvamento que falha
não promove custo nenhum. E, com edição pendente, o bloco **se identifica** —
"Custo do último salvamento" —, que é a segunda opção do §54, a mesma que o
Faturamento usa pelo outro lado.

**F-07-1.** Cinco células da Sugestão de Compra imprimiam a string da API direto
no JSX: a necessidade saía `6.122448979592`, com PONTO decimal, ao lado do mesmo
número escrito `6,122449 kg` na tabela de cima. Passaram por `formatQuantity`, o
das colunas vizinhas. **Nenhum payload mudou** — o cru continua íntegro no DTO,
e o formatador nunca alimenta escrita.

## O mesmo projeto vende de novo (COM-CORE, 2026-09-09)

**Projeto aprovado deixou de ser fim de linha comercial.** `APPROVED` diz que o
desenvolvimento inicial foi aprovado; o projeto segue recebendo propostas para
os produtos que ele aprovou, e recompra não abre cadastro novo. Cancelado
continua fechado. Todo novo compromisso de compra tem a sua própria
QuoteVersion — não existe geração automática por data (§69).

**O invariante "uma aceita por projeto" caiu com a premissa que o sustentava.**
Aceitar continua superando as aceitas **em aberto**; a aceita que já virou
Pedido permanece `ACCEPTED`, porque é a origem daquele Pedido. A evidência é a
relação `sourcedCustomerOrder` — nenhum status novo foi criado (§70). A
cardinalidade não mudou: uma proposta gera no máximo um Pedido, e gerar duas
vezes devolve o mesmo.

**A validade passou a valer (§71).** Rascunho pode não ter; enviar exige;
proposta enviada e vencida não é aceita — erro de domínio em português, nunca
500. "Vencida" é derivado, calculado na leitura, sem status `EXPIRED` e sem
varredura noturna. Aceita não vence retroativamente — o Pedido pode nascer
depois, com o preço intacto.

**A validade é DATA CIVIL, e isso custou uma correção (COM-CORE-TZ).** A
primeira versão reusou o `fimDoDia` do domínio de custo — fim do dia em UTC — e
com isso a proposta vencia às **21h de São Paulo do próprio dia impresso nela**.
O `fimDoDia` responde certo lá: a pergunta é sobre uma janela de referência em
UTC. Aqui a pergunta é "o dia 15 já acabou na Veridi?", e ela se responde
comparando DIAS, não instantes.
[`business-day.ts`](../apps/api/src/lib/business-day.ts) compara o dia de hoje
em `America/Sao_Paulo` com o dia escrito na proposta, os dois em `YYYY-MM-DD`.
O fuso aparece uma vez no sistema inteiro, e não há offset fixo — horário de
verão volta a existir sem quebrar nada.

**COM-03 deixou de ser prova por composição.** A cadeia `QuoteLine.unitPrice →
CustomerOrderLine.agreedUnitPrice → BillingLine.agreedUnitPrice →
BillingLine.unitPrice` agora é percorrida inteira num teste só, e a pergunta é
feita na direção perigosa: precificação nova ativada DEPOIS do Pedido e DEPOIS
do Faturamento não muda nenhum dos dois.

**Zero migration.** O schema já tinha tudo — `sourcedCustomerOrder`,
`validUntil` e os status existentes. Investigação em
[`archive/SPIKE_COM_NEW_QUOTES.md`](archive/SPIKE_COM_NEW_QUOTES.md).

## O fuso da operação é um só (SYS-TZ-01, 2026-09-09)

**`America/Sao_Paulo` é o fuso operacional oficial (§72)**, definido uma vez em
[`business-timezone.ts`](../packages/shared/src/business-timezone.ts) e
importado pela API e pela web. Instante continua persistido em UTC; o que muda é
a LEITURA. Três conceitos e só três: instante, data civil e dia comercial.

**A auditoria transversal achou três defeitos que só aparecem entre 21h e a
meia-noite** — o horário em que ninguém confere:

- o KPI "hoje" do painel resolvia o dia pelos componentes locais do servidor.
  Em Railway isso é UTC: o dia começava às 21h da véspera;
- a numeração oficial da Ordem de Produção usava `getFullYear()` do servidor.
  Uma OP liberada em 31/12 às 22h levaria o número do ANO SEGUINTE, e consumiria
  a sequência 1 de um ano que não começou;
- o código do lote (`LT-YYYYMMDD-…`) usava o dia UTC do recebimento: material
  recebido às 21h de 31/12 saía etiquetado como 01/01.

Os três passaram a usar o dia comercial. Presentação: vinte telas tinham a
própria cópia de `formatDateTime`, e a API formatava CSV, alertas e textos no
fuso da máquina — tudo passou pelos helpers canônicos, e o filtro de período
resolve o dia da Veridi em vez do dia do navegador.

## A validade do lote vale o dia inteiro (TZ-LOTE-01, 2026-09-08)

**Validade de lote é DATA CIVIL INCLUSIVA (§73):** o lote vale até 23:59:59 do
dia impresso e vence às 00:00 do dia seguinte, em `America/Sao_Paulo`.
`isLotExpired` comparava o marcador do dia com o relógio
(`expiryDate.getTime() < Date.now()`), e como o marcador é a meia-noite UTC, o
lote de 15/09 aparecia vencido desde **as 21h de 14/09** — quase um dia antes
do rótulo, e sempre à noite.

Não há segunda implementação: `isLotExpired` responde pelo mesmo `venceuEm` de
[`business-day.ts`](../apps/api/src/lib/business-day.ts) que decide a validade
da proposta. Disponibilidade, FEFO, reserva, separação, consumo, amostra e
expedição já passavam por `isLotAvailableForUse` e foram corrigidas junto; os
quatro call sites que comparavam por fora — liberação da Qualidade, painel de
atenção, KPI do painel e relatório de validade — passaram a usar o marcador do
dia comercial, e `daysToExpiry` virou distância em DIAS CIVIS (`0` é "vence
hoje", não `-1`).

**"Vence hoje" ≠ "vencido":** no dia da validade o lote continua disponível e
sai como `LOT_NEAR_EXPIRY`; só na virada vira `LOT_EXPIRED`. Validade não é
bloqueio antecipado — quem quer travar consumo antes usa os estados de
Qualidade. Backend continua a autoridade; a tela apresenta `isExpired` e
`daysToExpiry` da API e não recalcula.

**Zero migration, zero dado tocado.** O defeito era de interpretação: os mesmos
lotes passaram a ser lidos corretamente.

## A recompra forma o preço, e diz de onde ele veio (COM-PRICE, 2026-09-09)

**O preço da proposta nova é uma DECISÃO por linha (§74)**: manter a condição
acordada, reajustá-la por um percentual, usar a precificação atual ou digitar.
A auditoria confirmou a suspeita do PO: `createQuoteVersion` já copiava
`unitPrice` da versão anterior com `priceSource = MANUAL`, e nada dizia que
aquele número tinha sido um acordo — nem se ainda valia, nem para qual
quantidade fora fechado.

**A condição anterior sai da QuoteLine de uma proposta ACEITA** do mesmo
Projeto e Produto, a mais recente por `acceptedAt`. Nenhum preço foi criado no
Projeto e nenhuma tabela de acordo comercial existe.

**Um caso só vem pronto**: condição vigente e mesma quantidade física (§68,
`Decimal` exato, unidade canônica do produto). Aí a versão nova nasce com o
preço e com a proveniência, e a validade da condição vem sugerida. Quantidade
diferente ou condição vencida não herdam sozinhas — manter mesmo assim exige
motivo, que fica gravado. Reajustar nunca exige motivo: cria preço novo usando
a condição como base, e o servidor é quem fecha o valor.

**Modelagem aditiva**, tudo nullable: `priceOrigin`, `inheritedFromQuoteLineId`
(FK para a QuoteLine reutilizada), `adjustmentPercent`, `priceOriginReason`.
`priceSource` não foi tocado — são duas perguntas diferentes, e um preço
herdado nunca aponta para a precificação atual. Linha legada fica com origem
nula: nada é classificado retroativamente.

**O envio passou a congelar o custo CORRENTE também em linha sem faixa.** Antes
`buildLineSnapshots` saía cedo em toda linha `MANUAL` e congelava só o produto:
preço herdado ia ao cliente sem base econômica nenhuma. Agora a referência é a
faixa da precificação ATIVA de mesma quantidade física — preço do acordo, custo
de hoje. É o que o CMV-VAR vai precisar para medir a variação entre ciclos.

## Criar migration virou um comando só (MIG-ORDER-01, 2026-09-09)

**O prefixo de 14 dígitos é uma CHAVE DE ORDENAÇÃO antes de ser data.** A ponta
da cadeia está em `20260925093008`, à frente do relógio real, então
`prisma migrate dev` carimbava a pasta nova com um nome que ordena ANTES de
migrations das quais ela depende — e a reconstrução de banco vazio quebrava.
Aconteceu de verdade no COM-PRICE (`relation "quote_lines" does not exist`), e
a correção foi renumerar à mão.

**`pnpm migration:create <nome>` é agora o caminho oficial.** Roda
`prisma migrate dev --create-only` (escreve, não aplica), renumera para o menor
prefixo livre depois da ponta e confere que a migration nova ficou lá. Exige
banco local pelo mesmo `local-db-guard.mjs` do `validate:migrations:fresh`, e
nunca aplica, faz deploy ou reseta — aplicar continua sendo `pnpm db:migrate`.

**O incremento é de um segundo civil, com carry** (`…093059` → `…093100`), e não
`+1` no inteiro. As duas ordenam igual; a civil mantém todo prefixo legível como
carimbo de verdade e evita gravar `…093060` no histórico. Nenhuma migration
histórica foi renomeada. Zero migration nova, zero schema.

**Criar e aplicar deixaram de ser o mesmo comando (MIG-ORDER-01b).** `pnpm
db:migrate` ainda era `prisma migrate dev`, que aplica **e** cria: bastava
`--name`, ou uma edição pendente em `schema.prisma`, para nascer uma pasta
carimbada com o relógio real — a porta que o `01` só havia fechado com
documentação. Agora é `prisma migrate deploy` embrulhado em
`scripts/apply-migrations.mjs`, que recusa qualquer argumento antes de o Prisma
vê-lo e passa pelo mesmo guarda de banco local. `migrate deploy` sequer possui
a opção `--name`: não existe caminho de criação por ali. Schema alterado sem
migration correspondente passou a ser **avisado**, com o comando certo na tela,
e nunca resolvido às escondidas. Produção continua em `pnpm deploy:prod`.

Os três comandos, e só eles: **criar** `pnpm migration:create <nome>`,
**aplicar** `pnpm db:migrate`, **provar** `pnpm validate:migrations:fresh`.

## O desconto acordado chega ao Faturamento (BILL-DISCOUNT-01b, 2026-09-09)

**O desconto é do CABEÇALHO do documento, nunca da linha.** `agreedUnitPrice`
continua sendo o preço que o cliente aceitou: nenhuma linha ganhou preço
líquido que ninguém negociou. O que mudou é que o desconto agora CHEGA — o
Faturamento apropria a sua parcela em `discountAmount`, e o documento que
**fecha comercialmente** o Pedido absorve o saldo.

**"Fecha" é cobertura, não cronologia**: é o documento depois do qual toda
linha do Pedido alcança a quantidade contratada, contando só Billings ATIVOS
(emitidos, não cancelados). Calculado na emissão, nunca persistido como flag.

**A apropriação é cumulativa**, jamais `round(bruto × percentual)` por
documento: cem faturamentos de R$ 0,01 com 50% apropriam R$ 0,50 no total, não
R$ 1,00. Cada um apropria o que o Pedido já deveria ter apropriado no seu bruto
acumulado, menos o que os anteriores apropriaram.

**F-C entrou na MESMA reconciliação.** Partir `3 × 33,3333` em três documentos
dá 99,99 contra os 100,00 do Pedido — **com desconto zero**. O
`commercialAdjustmentAmount` do fechamento cobre as duas fontes, e aparece
separado do desconto na tela e no impresso: são conceitos diferentes.

**Override de preço continua sendo exceção comercial deliberada.** A
reconciliação mira `acordado + delta do override`, então o ajuste absorve
arredondamento e nunca engole a decisão — a diferença entre acordado e faturado
segue sendo a evidência.

**Invariante durável:** pedido inteiramente faturado por documentos ativos soma
EXATAMENTE `CustomerOrder.agreedTotalAmount`, sem epsilon. Uma migration
estrutural (cinco colunas nullable em `billings`), zero backfill.

## A ajuda começa pela ação (UX-HELP-02, Fase 1, 2026-09-09)

**Modelo de conteúdo V2, aditivo.** `HelpTopicV2` convive com o `HelpTopic`
original no mesmo registro; o painel reconhece qual está lendo pelo campo
`version` e a migração é por tela. Dos 51 tópicos, **12 estão no modelo novo**
— os P0 da auditoria — e 39 continuam no anterior, renderizando como sempre.

**A ordem mudou, e era ela o defeito.** O nível 1 — o que é, quando usar,
próximo passo — vem primeiro e cabe em 80 palavras; o passo a passo em pares
"você faz / o sistema faz" vem aberto; termos, situações, ressalvas e exemplo
nascem recolhidos. O §45 foi revisto para isso: o glossário deixou de abrir a
ajuda. Interface: opção A da auditoria — o modal atual, reordenado. O painel
lateral (opção B) **não** foi implementado.

**Os P0 caíram de 8.715 para 6.713 palavras** com três tópicos a mais: média de
968 para 559. Nenhum acima do teto da classe, nenhum sem próximo passo, nenhum
link interno morto, dez com exemplo numérico. Sete conceitos compartilhados
(saldos, reserva × consumo, identidades do lote, versões, prévia × gravado,
custo desconhecido, material do cliente) passaram a ser escritos uma vez só.

**Três decisões de produto foram registradas, não alteradas:** o Orçamento
continua dentro do Projeto e ganhou tópico e botão próprios; produzir continua
não reservando, e a ajuda diz onde reservar; informar pureza continua registrando
e marcar continua aplicando, agora com exemplo — 100 mg a 80% viram 125 mg com o
ajuste marcado, e continuam 100 mg sem ele.

Guia de quem escreve: [`UX_HELP_GUIDE.md`](UX_HELP_GUIDE.md). Auditoria de
origem arquivada em
[`archive/AUDIT_UX_COMO_FUNCIONA.md`](archive/AUDIT_UX_COMO_FUNCIONA.md).

## A promessa de entrega virou documento (COM-04, 2026-09-09)

**`3 × 1.000` deixou de rodar na unha.** Um Pedido passa a registrar QUANDO
cada parte sai: `CustomerOrderDelivery` (data civil, sequência, cancelamento,
substituição) e `CustomerOrderDeliveryLine` (uma por linha do Pedido). Uma
migration estrutural, duas tabelas e uma coluna anulável em `shipment_lines`.

**Programar é promessa, não execução** (§75). Criar uma entrega programada não
reserva estoque, não escolhe lote, não move estoque, não abre OP, não expede e
não fatura. O Plano de Atendimento **não mudou**: continua cobrindo o Pedido
inteiro, e a reserva continua sendo dele.

**A situação é derivada, sempre.** Programada, parcial, atendida e atrasada
saem da comparação entre o prometido e o que as Expedições CONFIRMADAS
entregaram — o vínculo é a coluna
`ShipmentLine.customerOrderDeliveryLineId`, nunca "qualquer expedição do mesmo
produto". Atraso é data civil: no próprio dia a promessa ainda vale, e entrega
cumprida nunca vira atrasada depois. O único estado gravado é o cancelamento.

**Cancelar não apaga execução, e reprogramar não apaga a promessa anterior.**
Entrega de 400 com 250 confirmadas e depois cancelada devolve 150 ao saldo
programável — nunca os 400; as 250 continuam ligadas a ela. Reprogramar é
cancelar e criar a substituta com o pendente (`replacesDeliveryId`), e a cadeia
A → B → C fica legível inteira. Não existe edição de data no lugar.

**A matemática comercial não ganhou uma segunda versão.** Faturamento continua
nascendo de Expedição confirmada, e a regressão prova: Pedido com desconto
global, duas entregas, duas expedições e dois faturamentos continua fechando
exatamente em `agreedTotalAmount`.

**COM-04b endureceu a alocação.** A quantidade expedida ATRAVESSA promessas:
500 contra entregas de 400 e 600 atende 400 na primeira e 100 na segunda, em
duas linhas do mesmo lote e da mesma reserva — antes a linha só ganhava vínculo
quando cabia inteira numa promessa, e o cronograma jurava que nada tinha sido
entregue. Separação aberta PELA ENTREGA não atravessa: ela representa aquela
promessa, e a origem virou coluna (`Shipment.originDeliveryId`) porque deduzi-la
dos vínculos confundiria os dois fluxos. Entrega com separação em rascunho
deixou de aceitar cancelamento e reprogramação — o que bloqueia é o que está em
preparação, nunca o que já saiu.

## A oferta do fornecedor virou fonte real de custo (COST-SOURCE-01, 2026-09-09)

**O degrau 4 de §53 existia na regra e não existia na operação.** A auditoria
COST-VAR-01 mediu: 602 `SupplierItemOffer`, todas `LEGACY_IMPORT` sem
`effectiveAt`, zero válidas, zero preferenciais, 90 itens com vários
fornecedores homologados. Sem vigência, oferta é observação histórica — quem
cadastrava cinco preços abria o CMV e lia "sem custo conhecido", sem nada
ligando as duas telas.

**Nenhum backfill.** As 602 continuam sem vigência, sem preferencial e sem
data inferida de `createdAt`, da importação ou de hoje. O que mudou é a porta
de entrada: **oferta nova exige "válida a partir de"**, a tela sugere hoje de
forma visível e editável, e o servidor deixou de assumir `new Date()` quando o
campo não vinha — era um "hoje implícito" dentro da única fronteira que não
pode ter um. A coluna segue anulável porque o legado é legítimo.

**A vigência virou dia civil nas duas bordas** (§76): vale o dia inteiro do
início e o dia inteiro do fim, como §71 e §73. Consequência que o negócio
pediu: oferta com vigência FUTURA não é usada hoje e **é** usada num cálculo
com `referenceDate` naquele dia — previsão de custo sem motor novo.

**Ambiguidade continua sendo ausência de custo.** Um homologado com oferta
válida dispensa preferencial; vários sem preferencial deixam o material sem
custo e a tela diz o que fazer, em português. O sistema não escolhe o mais
barato, o mais novo nem o primeiro. A unicidade do preferencial é do banco
(índice parcial já existente) e a troca é transacional.

**Bug real corrigido na mesma fronteira:** `ItemCostReference.currencyCode`
existia e a seleção de fonte não o filtrava — uma referência em dólar entraria
como se fosse real. Só BRL alimenta custo, e o filtro é parte da ESCOLHA da
vigente: uma referência em dólar mais recente não esconde uma em real mais
antiga. Nenhum dado alterado; as 293 existentes são BRL.

**A tela passou a explicar.** Cada oferta carrega o diagnóstico da MESMA
condição do motor (serve / sem vigência / ainda não vigente / vencida / moeda
estrangeira / não homologado / unidade incompatível), e o detalhe mostra a
fonte que o motor usaria HOJE para o item — porque "serve de referência" não é
"está sendo usada", e uma compra real recente vence qualquer oferta.

**Sem migration.** O índice parcial único e o CHECK de preferencial já
existiam desde `20260908090000_supplier_items`.

## O walkthrough real mudou a fila (2026-09-09)

Acompanhar alguém da Veridi usando o sistema produziu seis itens que nenhuma
varredura de código tinha produzido, e a fila viva de
[`BACKLOG.md`](BACKLOG.md) foi reconciliada com eles no mesmo dia. Zero runtime,
zero migration nesta rodada.

**Os dois P0 vieram de uso, não de auditoria.** ORDER-CUSTOMER-PRODUCT-01 —
**fechado em 2026-09-09**, ver abaixo — nasceu da tela do Pedido listando produto
sem filtrar por cliente, com `customer-orders.service` sem comparar
`product.customerId` com o do Pedido nem ao montar a linha nem no `confirm`: a
única recusa era na Ordem de Produção, e um Pedido CONFIRMADO carregava a
combinação impossível. COST-BASIS-UX-01 — **fechado em 2026-09-09**, ver
abaixo — nasceu de uma base de produção 300 com a tela destacando "custo por
1.000", e a usuária sem saber qual dos dois o sistema calculou.

**Duas suspeitas foram reclassificadas pela auditoria, não aceitas como vieram.**
A vigência de tarifa industrial já respeita `referenceDate` (agosto usa a tarifa
de janeiro, setembro usa a de setembro) e os snapshots seguem intocados — o que
sobra é a mesma assimetria de dia civil que §76 corrigiu para a oferta, do lado
do `validUntil`, e em exibição. E "duplicar orçamento" já existe como "nova
versão", copiando condições comerciais e linhas; o que o pedido tem de novo é
escolher a versão de origem — e um **conflito com §74**, porque copiar preço é
exatamente o que COM-PRICE removeu.

**Duas decisões de produto saíram da mesma conversa.** Prospect e Cliente NÃO se
separam em cadastros: `Customer` continua sendo uma entidade só, e a situação
comercial (Prospect · Cliente ativo · Inativo) será **derivada** da história e
das datas, não um campo que alguém mantém —
CUSTOMER-COMMERCIAL-STATUS-01, P1. Conversão é histórica: quem teve Projeto
aprovado não regride por falta de atividade, e Inativo volta a Prospect sozinho
quando um Projeto novo abre, sem botão "Reativar". O gate é o que PROVA conversão:
`CustomerOrder` não exige Projeto nem Orçamento (`sourceQuoteVersionId` é
opcional e não existe `projectId`), então "Projeto aprovado" sozinho marcaria
como Inativo quem comprou direto. E contrato entrou como discovery P2
(COM-CONTRACT-01) com uma fronteira já decidida: **contrato não dirige a situação
comercial**.

## O produto do Pedido é do cliente do Pedido (2026-09-09)

**ORDER-CUSTOMER-PRODUCT-01 fechado.** A comparação
`Product.customerId × CustomerOrder.customerId` passou a existir num lugar só —
`apps/api/src/lib/product-customer-ownership.ts`, que também hospeda o
`CustomerMismatchError` (reexportado por `production-orders.errors.ts`, para que
`instanceof` continue sendo o mesmo tipo em todos os pontos de captura). Ela é
chamada em cada porta por onde uma Product entra num Pedido: criar Pedido,
salvar as linhas do rascunho, trocar o cliente do rascunho, **confirmar** o
Pedido e gerar Pedido a partir de proposta aceita. A resposta é sempre
`400 customer_mismatch` — o mesmo código que Ordem de Produção, Plano de
Atendimento e Projetos já devolviam —, nunca 500.
`resolveOrderCustomerId` continua onde estava: virou defesa em profundidade,
não a primeira linha.

Produto **sem** cliente continua aceito em qualquer Pedido. É o que
`resolveOrderCustomerId` e o vínculo Produto↔Projeto sempre fizeram, e a base
traz produtos importados do legado sem dono resolvido; recusá-los seria mudar o
modelo de Product, que é outra capacidade.

Na tela: o seletor de Produto só abre depois do Cliente e diz por quê; o
catálogo vem do servidor com `customerId` (busca e paginação inclusive, nunca
filtragem no navegador); trocar de cliente com produto no Pedido é bloqueado com
o motivo — **nunca** apagando linha; e a resposta atrasada de um cliente não
aparece no seletor do seguinte. Cliente sem produtos ganha estado vazio próprio.
Pedido herdado com produto de outro cliente continua abrindo, mostra o aviso e
não confirma — `CustomerOrderLineDTO.productCustomerMismatch`.

Zero migration, zero dado corrigido. Legado auditado: DEV com duas linhas
inconsistentes (PED-003984 CANCELADO, PED-026585 CONFIRMADO — nenhum com
expedição, OP, reserva ou faturamento); PROD sem nenhum Pedido.

## A base calculada manda; "por 1.000" é razão (2026-09-09)

**COST-BASIS-UX-01 fechado. Regra durável: §78.** A auditoria do motor veio
antes de qualquer mudança de tela e **absolveu a matemática**: rodando o motor
real sobre uma estrutura de base 300 com material proporcional, mão de obra fixa
por lote, equipamento com potência, energia derivada, premissa fixa por lote,
premissa por unidade, premissa por 1.000 e caixa inteira, os quatro casos
fecharam com a conta independente em Decimal — 200 un R$ 183,00 · 300 un
R$ 201,00 · 500 un R$ 384,00 (2 lotes) · 1.000 un R$ 767,00 (4 lotes).
`perUnit = total ÷ quantidade` e `per1000 = perUnit × 1.000` em todos.
**Classificação A: defeito exclusivamente de UX.**

A prova que a copy precisava: o equivalente por 1.000 da execução de 300 é
R$ 670,00, e produzir 1.000 de verdade custa R$ 767,00. Os dois números estão
certos e não são a mesma coisa — custo fixo por lote e caixa inteira não diluem.

Na apresentação: a quantidade calculada acompanha o total ("Custo industrial
total para 300 un", "CMV total para 300 un"), e o "por 1.000" virou
**"Equivalente por 1.000 un"**, secundário, com a ressalva impressa de que não
representa um novo cálculo de produção — texto único em `@veridi/shared`. A
varredura por `per1000` achou uma **sexta** superfície além das cinco mapeadas:
o relatório R-18 e o CSV, que exibiam "Custo total" e "Custo/1.000" lado a lado
sem quantidade nenhuma na linha; ganharam a coluna da base, que já estava
persistida no cálculo.

Zero migration, zero snapshot recalculado, zero dado PROD. **Finding aberto:**
"Base de produção", "Base de referência" e "Base de produção sugerida" nomeiam o
mesmo conceito em três telas — registrado no BACKLOG, sem sweep.

## A vigência da tarifa industrial é do DIA (2026-09-09)

**INDUSTRIAL-RATE-VALIDITY-01 fechado. Regra durável: §79.** A suspeita que
abriu o item — "agosto deveria usar A e usa B" — **não se confirmou**, e o caso
ficou travado em teste: com A vigente desde janeiro e B desde setembro, agosto
responde A e setembro responde B, com snapshots intocados.

O defeito REAL era a borda do dia. `isRateCurrent` comparava instantes crus, e
o marcador de "válida até 09/09" é `00:00:00.000`: qualquer relógio depois
disso já declarava a tarifa histórica — ela morria durante o próprio dia
impresso nela. A comparação passou a ser entre DIAS CIVIS, inclusiva nas duas
bordas, com o mesmo `diaDaColunaDeData` de §71 e §73. É a mesma assimetria que
§76 corrigiu para a oferta do fornecedor, do outro lado do custo.

O relógio saiu das decisões de vigência: `toResourceDTO` não aceita mais "hoje"
implícito, e detalhe, listagem, pendências da estrutura, DTO de uso e o
congelamento na ativação perguntam pelo **dia comercial**, não pelo relógio do
processo — em Railway, UTC. Tarifa registrada sem vigência informada passou a
nascer como marcador de dia civil, e não como o instante do clique.

**Auditoria somente leitura.** PROD: 10 tarifas, **zero** com `validUntil` e
zero com `effectiveAt` fora do marcador de dia — o defeito era latente lá, e
nenhuma linha muda de interpretação. DEV: 22 de 125 com `effectiveAt` gravado
como instante de madrugada pelo padrão antigo, todas de fixture. Zero backfill,
zero migration, zero snapshot alterado.

**A interface nunca ofereceu "válida até"** — o campo só é lido na coluna do
histórico. Por isso a borda corrigida só era alcançável por API ou carga, e o
E2E prova a borda de INÍCIO (a que a tela cria) com as bordas de fim provadas
de forma determinística em teste de API.

**Sobreposição continua em aberto, e agora é uma decisão só.** Criar B não
encerra A: as duas ficam vigentes e o histórico marca as duas como "Vigente"
sem dizer qual vence. **PROD já tem 1 recurso nesse estado.** A pergunta é
idêntica à de SUPPLIER-OFFER-OVERLAP-01 e foi reconciliada com ela — encerrar a
anterior, bloquear, alertar, ou permitir com prioridade explícita —, com o
estado atual travado em teste para que a mudança seja deliberada.

## O endereço pertence ao CEP (2026-09-09)

**CUSTOMER-CEP-02 fechado. Regra durável: §80.** Do walkthrough real: ao trocar
o CEP de um Cliente, campos do endereço anterior ficavam na tela.

A causa não era o que parecia. `handleZipLookup` preenchia o campo vazio e
substituía **apenas** o que a consulta anterior tinha posto — regra deliberada
para não apagar digitação. O efeito real era pior: o que fora digitado à mão
sobrevivia à troca de CEP, e número e complemento, que a consulta nunca conhece,
nunca eram tocados. O E2E reproduziu o defeito antes da correção: `Sala 2`, do
CEP de São Paulo, salvo debaixo do CEP de Campinas.

**Duas identidades no lugar do mapa de valores auto-preenchidos:** `typedZip`, o
CEP que está no campo, e `addressZip`, o CEP a que o endereço na tela pertence.
Enquanto são iguais, o endereço é de quem está na tela e a correção manual manda;
quando divergem, os seis campos são limpos **antes** da consulta — número e
complemento inclusive. `""` em `addressZip` é o endereço sem CEP dono: cadastro
manual, que o primeiro CEP completa em vez de apagar.

**A corrida foi eliminada por identidade, não por tempo.** A resposta é conferida
contra o CEP que está na tela no instante em que ela volta, antes de qualquer
escrita — inclusive a do recado de erro. Vale nos dois sentidos: a resposta
atrasada de A não invade B, e a resposta rápida de A não repovoa o endereço
enquanto B é esperado. Debounce maior só diminuiria a chance.

**Zero backend, zero schema, zero migration** — a API já aceitava cada campo de
endereço como opcional e independente, e continua aceitando. Nenhum dado de PROD
tocado. O achado extra: no cadastro salvo, sair do campo do CEP disparava uma
consulta redundante (a guarda dependia de `cepStatus`, que nascia `idle`); agora
o CEP que já é dono do endereço não é reconsultado.

## A fixture passou a falar a língua do domínio (2026-09-09)

**D-17 fechado.** `pnpm test` voltou a ser gate confiável em qualquer horário.

O defeito era da FIXTURE, não do produto. Um campo de data civil —
`effectiveAt`, `validUntil`, `effectiveFrom`, `expiryDate` — guarda a meia-noite
UTC como marcador do dia; o domínio o lê em UTC e compara contra o dia
comercial, em São Paulo. Escrever `new Date().toISOString()` ali escreve um
INSTANTE, e entre 00:00 e 03:00 UTC — 21:00 às 23:59 em São Paulo — os dois
calendários discordam: a oferta criada "para hoje" nascia `NOT_YET_EFFECTIVE`, e
o lote "vencido ontem" ainda estava válido. A suíte da API ficava vermelha três
horas por dia e verde nas outras vinte e uma, o que fazia o defeito parecer do
produto.

**Reproduzido antes de corrigir**, e sem depender do relógio da máquina: a mesma
suíte, com `vi.setSystemTime` em `2026-09-10T01:30Z` (10/09 em UTC, 09/09 na
Veridi), reprova **63 casos em 19 arquivos** — exatamente os números do
relatório de CUSTOMER-CEP-02. A 15:00Z, os mesmos 19 arquivos passam. Depois da
correção: **0 de 1421** na borda, e igual nos dois instantes que limitam o dia
comercial.

**Um helper, delegando à fundação.** `test-support/dia-comercial.ts` tem três
funções e nenhum calendário próprio — `hojeComercial`, `marcadorDoDiaCivil` e
`limitesDoDiaComercial` são os mesmos que o runtime usa. "Ontem" e "amanhã"
andam por DIA, não por 24 horas de relógio, então horário de verão não pula nem
repete um dia. Instante continua instante: `createdAt`, `occurredAt` e
`receivedAt` seguem sendo carimbo de tempo — o que mudou foi ancorar a ESCOLHA
do instante no dia comercial quando a fixture quer dizer "isto aconteceu hoje".

**O relógio da suíte NÃO foi congelado, e o `TZ` não foi fixado.** As duas coisas
deixariam a suíte verde sem corrigir nada, e a primeira quebra de verdade: com o
relógio parado, `createdAt` de registros que existem para ser ordenados empata, e
quatro testes de desempate — FEFO, "a criada por último vence", "a tarifa mais
recente vence" — falham sem nada estar errado. Isso apareceu no andaime de
MEDIÇÃO e é a razão de ele ter sido andaime, e não solução.

**COST-COMMERCIAL-DAY-01 fechado. Regra durável: §81.** Os dois pontos de
RUNTIME que D-17 desenterrou, corrigidos: a janela de compras terminava no fim do
dia UTC do marcador — 20:59 de São Paulo — e começava três horas cedo, então
recebimento lançado à noite ficava fora da média do próprio dia e a noite do dia
anterior entrava na janela; e a referência manual de custo sem data explícita
nascia com o dia UTC, valendo só amanhã. As duas bordas passaram a ser dias
comerciais inteiros (`limitesDaJanelaDeCusto`), e "hoje" implícito virou
`marcadorDeHojeComercial()` nas bordas que ainda inventavam um instante. É o
terceiro e último lugar do custo com a assimetria que §76 e §79 corrigiram nos
outros dois; nada da hierarquia, da matemática ou do filtro de moeda mudou.

Carimbo de tempo continua carimbo de tempo: `receivedAt` e `consumedAt` não
viraram marcador. O que mudou é a pergunta feita contra eles.

Auditoria de PROD somente leitura, sem nenhuma escrita: 295 `ItemCostReference`,
todas em marcador de meia-noite UTC, todas BRL, nenhuma na faixa 00:00–03:00 UTC;
zero `Receipt` e zero `ReceiptLine`; 2 `IndustrialCostCalculation`. Sem backfill,
sem migration — os dois calculados históricos não tocaram recebimento, porque não
existe nenhum.

Treze casos determinísticos novos em `lib/custo-no-dia-comercial.test.ts`, com
instantes absolutos e relógio congelado só onde a borda exige. Cinco deles
reprovavam antes da correção — os dois defeitos e a data errada no texto da
última compra; os outros oito são guardas de não-regressão, entre eles a
não-antecipação do dia seguinte.

**PROJECT-CUSTOMER-CONTACT-01 fechado. Regra durável: §82.** Do walkthrough
real: para ligar para o cliente, quem estava dentro de um Projeto saía da tela e
abria o cadastro. O Resumo do Projeto passou a mostrar telefone e e-mail do
Cliente, ao lado do link que já existia.

É PROJEÇÃO, não cópia: `ProjectDTO` ganhou `customerPhone` e `customerEmail`
lidos do `Customer` que o `include` do detalhe já trazia — zero consulta a mais,
zero coluna nova em `Project`, zero snapshot. Trocar o telefone no cadastro muda
o que o Projeto mostra na leitura seguinte, e é isso que o E2E prova clicando.
Contraste com o Orçamento, que continua congelando cliente e endereço no envio:
documento congela, ficha de trabalho projeta.

**"Contato principal" não existe no domínio** — `Customer` tem `phone` e
`email`, um de cada. Nada foi inventado para preencher a palavra do pedido.
Sem WhatsApp, sem `mailto:`, sem ação de copiar: o ganho pedido era o número
estar visível.

**PROJECT-COMMERCIAL-SUMMARY-01 fechado. Regra durável: §82.** O espaço vazio
à direita do bloco Resumo do Projeto virou a coluna **Comercial**: situação do
projeto, último orçamento, valor da proposta, itens orçados, condição de
pagamento, envio, validade e última atividade.

Read model puro, e **sem backend**: tudo sai de `ProjectDTO.quoteVersions`, que
já vinha inteiro no mesmo GET. Nenhum campo novo, nenhuma migration, nenhum
total recalculado — o valor é `QuoteVersionDTO.total`, que o servidor entrega
com o desconto aplicado. Layout com o `.field-grid-2` que já existia: duas
colunas no desktop, empilhadas abaixo de 720px.

A regra que a coluna existe para não quebrar: o último orçamento e a última
proposta ENVIADA são fatos diferentes. Com `V3 SENT` + `V4 DRAFT`, o valor é da
V4, "Enviado em" é travessão e a V3 aparece em linha própria — colar o rótulo
de uma na data da outra anunciaria um envio que não houve.

A condição de pagamento por extenso saiu de dentro da Origem Comercial do
Pedido e virou `lib/payment-condition.ts`: uma função, duas telas.

## O que foi digitado nas condições sobrevive à linha (QUOTE-DRAFT-STATE-01, 2026-09-10)

**Perda silenciosa de entrada, corrigida.** Mexer numa linha do Orçamento
recarrega o Projeto, e a versão volta como objeto novo com as mesmas condições
gravadas. O formulário tratava objeto novo como documento novo e apagava o que
estava digitado — as nove condições, não só a validade — dizendo "Tudo salvo".

Agora ele separa o GRAVADO do DIGITADO e decide pela identidade da versão
(`quote.id`) e pelo valor de cada campo, em
[`quote-conditions-draft.ts`](../apps/web/src/pages/projects/quote-conditions-draft.ts):
mesma versão com alteração preserva o digitado e acompanha o servidor no que
ninguém tocou; sem alteração, acompanha; outra versão, ou versão que deixou de
ser rascunho, mostra o gravado dela. "Alterações não salvas" compara VALOR. A
leitura é absorvida durante o render — com efeito, a E2E viu a V1 desenhada com
o rascunho da V2. Sem auto-salvar, sem `localStorage`, sem store global, zero
backend, zero migration.

Trocar de versão continua descartando o rascunho — decisão do PO, registrada
como QUOTE-VERSION-SWITCH-DIRTY-01.

## Enviar só com as condições salvas (QUOTE-SEND-DIRTY-01, 2026-09-10)

**P0 de integridade comercial, fechado.** O envio congela o que está gravado —
correto —, e a tela deixava enviar com uma condição alterada e não salva: o
cliente receberia a condição A enquanto a tela mostrava a B. Agora, com
qualquer uma das nove condições por salvar, "Enviar ao cliente" fica
indisponível e diz por quê, ao lado do botão. Sem auto-salvar e sem "enviar
mesmo assim": salvar e enviar são decisões separadas, e salvar libera o envio
na mesma tela. A pendência é a mesma de "Alterações não salvas"
(`condicoesAlteradas`), e o envio confere de novo no clique e na confirmação.
Servidor intocado. Regra durável: §48.

## A linha também (QUOTE-SEND-LINE-DRAFT-01, 2026-09-10)

**O mesmo P0, do lado das linhas.** Quantidade, preço e unidade gravam ao sair
do campo; se o salvamento falhava, o campo mantinha o digitado e o envio
congelava o valor antigo — a tela mostrava R$ 12,50 e o cliente recebia
R$ 10,00. Agora uma linha que mostra o que não foi gravado segura o orçamento
inteiro: desde a primeira tecla diferente, durante o salvamento e depois da
falha, até a nova tentativa passar. Pendência por valor (`Decimal`), não por
foco; condição e linha pendentes somam numa espera só. A unidade, que era
campo não-controlado, passou a ser acompanhada pela mesma razão. Sem
auto-salvar, sem descartar o digitado, zero backend.

## Passar pelo campo não é mudar (QUOTE-LINE-NOOP-BLUR-01, 2026-09-10)

**O terceiro P0 do dia, reproduzido pela interface antes da correção.** Um Tab
pela quantidade de uma linha de preço herdado mandava a mesma quantidade ao
servidor, e `updateQuoteLine` soltava o preço, a origem e o vínculo com o
acordo: a limpeza de §74 olhava a PRESENÇA do campo no pedido, não o valor.
Agora a tela não manda o que não mudou — a mesma comparação por valor da
pendência de envio — e o servidor compara cada campo com o gravado, em
`Decimal`, antes de qualquer efeito; pedido inteiramente igual nem faz UPDATE.
Mudança real de quantidade ou de unidade continua soltando o preço, como §74
manda. Zero migration.

## Texto em campo inteiro não apaga o gravado (QUOTE-INT-FIELDS-01, 2026-09-10)

**Integridade antes de estrutura, fechado.** `abc` no prazo virava `NaN`, o
JSON escrevia `null`, e salvar apagava o prazo gravado sem aviso. Agora prazo,
parcelas e intervalo passam por uma leitura estrita
([`integer-input.ts`](../apps/web/src/lib/integer-input.ts)): só dígitos, com
espaço nas pontas e zero à esquerda. O resto fica no campo como digitado, com o
erro ao lado, "Alterações não salvas", salvar e simular presos e nenhuma
requisição — e o envio continua preso pela pendência. Vazio segue sendo "não
informado". Os limites são os da API, de uma fonte só
(`LIMITES_INTEIROS_DAS_CONDICOES`, em `@veridi/shared`). Regra durável: §48.
Zero migration; o servidor já recusava o texto, e continua recusando.

## O mesmo, no cadastro do Projeto (PROJECT-INT-FIELDS-01, 2026-09-10)

**P0 de integridade de cadastro, fechado.** "Doses por embalagem" e "Vida útil
(meses)" saíam do formulário do Projeto por `Number(texto)`, e `abc` apagava o
valor gravado — reproduzido pela interface. Agora passam pela mesma leitura
estrita do Orçamento: inválido fica no campo com o erro ao lado e prende criar
e salvar; vazio segue "não informado". Limite da API (inteiro maior que zero,
sem teto), backend e semântica das doses e da vida útil intocados. Zero
migration.

## A unidade do Modelo vem do catálogo (FORM-UOM-01, 2026-09-10)

**O Modelo de Formulação alcançou a Formulação real.** Base e componente eram
texto livre; agora são escolha do catálogo `UnitOfMeasure` — o componente, só
na dimensão do seu Item, pela mesma lista da Formulação (`lib/uom-options.ts`).
Trocar de Item não deixa unidade incompatível escondida, e o que já estava
gravado fora da lista aparece como legado e prende o salvar. Na API, a base
fora do catálogo passou de 500 cru a 400 com nome, e ativar reconfere as
unidades — o componente já era recusado antes. DEV e PROD sem nenhum dado fora
do catálogo. Zero migration.

## Aplicar o Modelo preserva a base (TEMPLATE-APPLY-BASE-UOM-01, 2026-09-10)

**P0 de integridade física, fechado.** Aplicar um Modelo copiava só o número
da base: 1 kg num Produto em g nascia 1 g, e num Produto em `un` nascia 1 un.
Agora a mesma unidade copia, a mesma dimensão converte pelo fator do catálogo
em Decimal (1 kg → 1000 g), e dimensão diferente é recusada sem criar nada. Os
componentes por base não mudam; o que conta por unidade acabada recusa a troca
de unidade. Zero migration.

## Reset, golden path e dois bloqueios (FAST-DEVELOPMENT-RESET-02, 2026-09-11)

**Produção zerada de negócio, usuários preservados.** Backup lógico JSON (7.027
linhas) com restauração provada linha a linha num banco local descartável — o
snapshot manual do Railway foi recusado (`Not Authorized`) e o PITR está
desligado (OPS-BACKUP-01). `prod-cleanup.mjs --apply --reset-sequences` apagou
6.353 linhas de 63 tabelas numa transação e reiniciou as 23 sequences de
negócio e o contador anual da OP. Ficaram os 6 usuários (mesmos IDs e
e-mails), as sessões, as 6 unidades e `_prisma_migrations` — 61 linhas, as 60
do repositório e o nome antigo da migration renumerada. Login e telas
conferidos pelo smoke autenticado.

**Instalação nova nasce sozinha.** O catálogo de unidades só existia onde
alguém tinha rodado seed, e produção nunca roda seed. A migration
`20260925093012_reference_units_of_measure` o cria com `ON CONFLICT DO NOTHING`;
`seed-infra` passou a só conferir, e `validate:migrations:fresh` prova o
catálogo num banco que nunca viu seed.

**Golden path pela interface.** `scripts/e2e/private-label-golden-path.mjs`
atravessa o negócio inteiro numa base zerada, com conta independente em cada
número: materiais R$ 957,00 na base de 100 un (Σ quantidade × custo, e o
componente sem custo nunca vira total), CMV R$ 1.994,00 para 200 un em dois
lotes, faturamento R$ 2.848,58 − R$ 142,43 = R$ 2.706,15, exatamente o total
acordado — e a cadeia de rastreabilidade do lote recebido ao lote expedido.

**RECEIPT-BUSINESS-DAY-01 (P1, corrigido).** A tela do Recebimento mandava a
data como meia-noite UTC — 21h da véspera em São Paulo —, e todo lote recebido
pela interface nascia com o dia anterior no código, com o movimento de estoque
na véspera. Regressão silenciosa desde o SYS-TZ-01. `lib/receipt-instant.ts`:
hoje vira agora, outro dia vira o início do dia comercial (§81).

**E2E.** Na base com corpus, 24 de 27 passaram. `projeto-aprovado-vende-de-novo`
(#17) e `condicoes-do-orcamento-sobrevivem-a-linha` esperavam o que o produto
deixou de fazer de propósito e foram corrigidas; `troca-de-cep-do-cliente`
intermitia por abrir o cliente errado ao reabrir — nenhum dado perdido — e foi
corrigida. `base-calculada-e-equivalente-por-mil` só reprova entre 0h e 4h de
São Paulo em máquina fora do fuso (WEB-DATE-DEFAULT-TZ-01). Numa base zerada,
dez suítes não se aplicam por dependerem de massa do corpus
(E2E-CORPUS-MASS-01).

**Reset final e prova do zero.** Depois das correções o DEV foi recriado de
novo e o golden path passou do zero, sem nenhuma falha:
`CLI-000001 · PROD-000001 · ORC-000001 → PED-000001 → OC-000001 + OC-000002 →
OP-000001 (001/26) → LT-20260911-000007 → EXP-000001 → FAT-000001`, com os
lotes de recebimento no dia comercial. Gates em `main`: 3.164 testes em 239
arquivos, typecheck, build e `validate:migrations:fresh` (61 migrations).
Produção fica na versão anterior até o próximo deploy da `main`, que aplica a
migration do catálogo sem mudar nenhuma linha.

## O Cliente tem Perfil tributário (CUSTOMER-TAX-PROFILE-01, 2026-09-11)

**Classificação informada, não motor fiscal (§83).** `Customer.taxProfile`,
enum `CustomerTaxProfile` — Não informado · MEI · Simples Nacional · Lucro
Presumido · Lucro Real · Outro —, **não-nulo** com default `NOT_INFORMED`:
"Não informado" é valor, nunca `NULL`, e retirar a classificação é escolhê-lo
de novo. Uma migration (`20260925093013_customer_tax_profile`, enum + coluna):
todo cliente que já existia virou "Não informado" na criação da coluna, e
importador, fixtures e API que não mandam o campo recebem o mesmo. Valor fora
do enum é 400 de validação antes do Prisma; PATCH sem o campo não mexe.

Na tela, `<select>` nativo na Identificação, depois do CNPJ, com a dica "não
calcula impostos automaticamente"; o Resumo da Consulta mostra o rótulo, e o
formulário só envia o perfil quando ele muda. **Listagem, filtro e busca não
mudaram** — a tabela já tem sete colunas de dado. **Zero efeito em runtime:**
Projeto, Orçamento, Pedido, Faturamento e Precificação não leem o campo, e não
existe mapa perfil → alíquota. Quem vai consumi-lo é PRICING-TEMPLATE-FLEX-01,
para sugerir o Modelo.

## O Modelo de Precificação diz o que entra no custo (PRICING-TEMPLATE-FLEX-01, 2026-09-11)

**Regra durável: §84.** A auditoria confirmou o ponto de partida: o Modelo de
Precificação é a Política (TPP) e só guardava faixa, margem e comissão; o preço
saía de `P = C ÷ (1 − m − c)` com C = custo total do cálculo do ERP. Agora a
versão da política diz também o custo industrial (cálculo do ERP · não
considerar · % sobre materiais · R$/un · R$ total), os impostos estimados (não
considerar · % sobre a venda, no divisor · R$/un · R$ total), a gestão externa
e os perfis tributários indicados. A configuração é copiada para a
`PricingVersion` na aplicação e viaja com o plano comercial.

**Compatibilidade provada, não suposta:** o default de toda coluna é o
comportamento de antes (`CALCULATED`, `IGNORE`, `false`, `[]`), e o teste de
regressão compara o preço do Modelo padrão com a conta antiga, dígito a dígito.
Uma migration aditiva (`20260925093014_pricing_template_flex`), sem backfill.

**O efeito que o PO pediu:** Modelo que não usa a conversão do ERP forma preço
com energia sem tarifa e ativa sem "custo incompleto"; material sem custo
continua bloqueando. O CMV do cálculo segue à parte na faixa, no Orçamento e
nos relatórios; o custo que formou o preço congela em coluna própria. Na tela,
o rascunho ganhou rádios simples com o valor ao lado (só o do modo escolhido
habilita), a gestão externa e os perfis; a escolha da política num cálculo diz
se ela é indicada para o perfil do cliente, sem esconder nem travar.

## Duplicar como nova versão (QUOTE-DUPLICATE-01, 2026-09-11)

**Regra durável: §85.** A auditoria confirmou o BACKLOG: `createQuoteVersion`
sempre partia da versão mais recente, devolvia o rascunho aberto em vez de
criar e só trazia preço no caso seguro de §74. Agora cada versão que não é
rascunho oferece "Duplicar como nova versão": o diálogo mostra a origem ("Nova
versão baseada na V2 · Enviado"), pergunta como tratar os preços sem opção
marcada e só libera "Criar nova versão" depois da escolha.

Manter copia `unitPrice` exato, sem vínculo com precificação; revisar deixa a
linha sem preço. A origem e as demais versões não mudam de status, validade
vencida não é copiada e rascunho aberto recusa com 409. Uma função nova
(`duplicateQuoteVersion`) numa transação, provada com falha forçada no meio.
**Zero migration.** O caminho antigo ("Criar nova versão"/"Novo orçamento")
continua como estava.

## Situação comercial do Cliente (CUSTOMER-COMMERCIAL-STATUS-01, 2026-09-11)

**Regra durável: §86.** Com os dois gates resolvidos pelo PO — o que prova
conversão (Projeto aprovado OU Pedido confirmado, históricos) e o que é
Projeto aberto (aguardando e amostra; stand-by não) —, a situação virou uma
leitura derivada: Cliente ativo para sempre depois da primeira conversão;
Prospect com Projeto aberto ou até 15 dias civis da última atividade; Inativo
depois. `Customer.active` não entra, e continua sendo o cadastro.

Uma função canônica (`customers/commercial-status.ts`) deriva cada Cliente, e
o mesmo critério vira `where` para a listagem filtrar e contar no banco; os
fatos chegam num `include`, uma consulta por relação para a página inteira —
provado por teste que nenhum delegado de Projeto, Pedido ou histórico é
chamado por Cliente. Na tela, a lista de Clientes abre em "Clientes ativos"
(padrão registrado) com Prospects · Inativos · Todos, e a situação é coluna
própria ao lado do cadastro; a Consulta mostra situação, motivo, "cliente
desde" e o resumo de Projetos. Cliente recém-criado chega à lista pelo
contexto, porque nasce Prospect. **Zero migration.**

## Quantidade de recursos na Estrutura de Custos (COST-RESOURCE-MULTIPLIER-01, 2026-09-11)

**Regra durável: §87.** Com as seis decisões do PO — custo, não capacidade;
multiplica; só mão de obra e equipamento; entra na energia derivada; inteiro
≥ 1; uma linha por recurso —, a linha de recurso ganhou `resourceCount` (Int,
NOT NULL, default 1, CHECK >= 1) na Estrutura de Custos e no Modelo de
Estrutura. Uma migration aditiva (`20260925093015_cost_resource_count`): toda
linha existente nasceu 1, e nenhum custo mudou.

A multiplicação vive no helper canônico (`plannedUsageQuantity` /
`scaledUsageQuantity`), então cálculo, cálculo salvo, CMV, faixa de
precificação e energia derivada recebem o mesmo efeito sem conta paralela.
Energia direta recusa quantidade acima de 1 (400); Modelo, aplicar Modelo,
nova versão e salvar como Modelo copiam o valor. Na tela, "Quantidade de
recursos" aparece ao lado de "Tempo por recurso" só para mão de obra e
equipamento, e o uso se lê "2 × 2 hora · Total: 4 hora" na estrutura, no
impresso, na composição do cálculo, no CMV e no Modelo. Trocar a quantidade é
refazer a linha: a linha de recurso continua sem edição (COST-RESOURCE-EDIT-01).

## Ajustes da quantidade no Modelo e na Formulação (FORMULATION-ADJUSTMENTS-UX-01, 2026-09-11)

**Regra durável: §88.** O componente do Modelo de Formulação já tinha no banco
modo, marcas, pureza e overage, mas a API só recebia os percentuais, a nova
versão do Modelo e "salvar como Modelo" perdiam o modo, e a tela nem mostrava os
campos — todo Modelo aplicado virava física informada. Agora schema, DTO,
gravação (com a mesma `modoEFlags` da Formulação), nova versão, comparativo e
"salvar como Modelo" carregam a configuração inteira; aplicar já copiava.
**Zero migration.** A tela do Modelo passou a levar base, pureza, overage e
notas ao salvar — antes voltavam ao padrão do banco.

Na Formulação, o painel "O que a quantidade informada significa" edita um
rascunho: "Aplicar ajustes" confirma e resume a linha, "Cancelar" descarta, e
fechar, salvar ou ativar com alteração aberta é recusado com a linha nomeada. O
mesmo painel (`pages/formulations/AjustesDaQuantidade.tsx`) serve o Modelo.
"Equivalente estoque" e "Físico / unidade" ganharam coluna própria; abaixo de
720px a tabela vira cartão. O painel deixou de repetir quantidade informada e
físico por unidade, que já estão na linha. Impressos e PDF não foram tocados
(branch paralela).

## Documentos oficiais em PDF real (PDF-DOCUMENT-SYSTEM-01, 2026-09-11)

Os 22 impressos A4 deixaram de ser página HTML + `window.print()` — que saía
com URL, data e título do navegador e com a paginação dele. Agora são PDF
real, gerado no navegador pelo `@react-pdf/renderer` sobre a mesma API
autenticada: sem endpoint novo, sem Chromium no servidor, motor carregado sob
demanda. A fundação vive em `apps/web/src/pdf` — `PdfDocument` (A4,
cabeçalho, cabeçalho corrido, rodapé com "Página X de Y" e "Gerado em" no
fuso da operação), seções, grade por significado, tabela com cabeçalho
repetido e linha que não se divide, bloco de totais. A tela do documento
mostra o próprio arquivo, com "Baixar PDF" (nome do código real) e
"Imprimir"; os botões das telas viraram "PDF". O Orçamento é o documento de
referência. A quantidade de recursos (§87) chega aos PDFs de custo; pureza e
overage da Estrutura saem como registro, porque o DTO não traz modo nem
marcas. Etiquetas de lote e de amostra seguem com `window.print()` —
impressão física. **Zero migration**, nenhuma regra de negócio mudou.

Findings de dado registrados, sem correção nesta capability:
- OC imprime como "Valor previsto" a soma só das linhas com preço.
- Preço previsto da OC e do Recebimento (DECIMAL 20,8) sai com até 4 casas;
  custo unitário da OP, com 2.
- Pedido fala em "reservado", mas o dado é `shippedQuantity`.
- Folha de Receita não marca rascunho em OP DRAFT/PLANNED.
- FO-03 lista todos os lotes (sem `onlyPending`), corta em 100 e ignora
  vencimento; FO-04 imprime reserva substituída e "Qtd. separar" é
  `quantity`, não o saldo.
- Enum cru (FO-01; qualidade em R-05/R-09) e filtros crus nos relatórios;
  R-18 "Custo/1.000" diverge do CSV; R-14 não imprime reservas; CSV sem
  milhar nem R$.
- Unidade no singular nos custos ("18,5 hora").
- Instante via `formatDate`, no fuso do navegador: FO, R-06, R-14,
  Recebimento e Precificação.
- CMV aberto sem `referenceDate` na URL assume a data de hoje em UTC.
- Nenhum DTO impresso traz o modo nem as marcas de ajuste da Formulação; o da
  Estrutura traz só os valores de pureza e overage, e Folha de Receita, OP,
  CMV e Cálculo não trazem nem isso.

Três suítes E2E passaram a ler o PDF (`scripts/e2e/lib/pdf.mjs`) e ainda não
rodaram.

## Perfis de Produção — primeira fundação do Planejamento (PLANNING-PRODUCTION-PROFILE-01, 2026-09-11)

**Novo módulo Planejamento, tela Perfis de Produção**
(`/planejamento/perfis-producao`). Regra durável: §89. Roteiro reutilizável de
como um produto é produzido: etapas sequenciais, preparação × execução, modo
de escala (Proporcional · Por lote) e recursos de CAPACIDADE — 2 operadores por
2 h são etapa de 2 h e 4 horas-recurso. Versões com o ciclo das bibliotecas
(rascunho → ativa congelada → arquivada); simulação ao vivo pelo motor único
`planProductionProfile` (`@veridi/shared`), sem gravar; o produto aponta,
opcionalmente, para uma versão ativa como padrão.

Uma migration aditiva (`20260925093017_production_planning_profile`): quatro
tabelas, uma coluna anulável em `products`, CHECKs e dois índices parciais. O
prefixo pula o 093016, que é da `user_preferences` da NAVIGATION-SIDEBAR-01,
desenvolvida em paralelo. Custo, formulação, OP e estoque intocados.

**O padrão do produto acompanha o perfil.** Decisão do PO na segunda rodada:
ativar uma versão nova move, na mesma transação, os produtos que apontavam
para a versão anterior DESTE perfil — o padrão é a configuração que as
próximas ordens devem usar. Produto de outro perfil ou sem perfil não é
tocado, e ordem existente não muda (ela receberá cópia). A outra decisão da
rodada: recurso anexado à etapa fica ocupado na etapa inteira, preparação
inclusive (30 + 120 min com 2 recursos = 150 min de etapa e 300 min-recurso);
não há fase por recurso.

**Navegação:** a seção **Planejamento** entrou no menu novo (grupo `planning`,
tela `production-profiles`), entre Produção e Compras, com busca, favoritos e
preferência por usuário pelo mecanismo que a NAVIGATION-SIDEBAR-01 criou.
A cópia para a OP veio na capability seguinte (abaixo).

## Planejamento previsto na OP — a cópia do Perfil (PLANNING-OP-SNAPSHOT-01, 2026-09-11)

Criar uma Ordem de Produção passa a **copiar** o Perfil de Produção padrão do
Produto para dentro dela. É cópia por valor, nunca vínculo vivo: se o padrão é
a V2 naquele instante, a OP leva a V2, e ativar a V3 depois não alcança essa
ordem — nem quando ela ainda está em rascunho. Vale para a OP manual e para a
que nasce do Plano de Atendimento.

Migration aditiva `20260925093018_production_order_planning_snapshot`: uma
tabela 1:1 com `production_orders`, com a proveniência em colunas e as etapas
em `steps` (JSON), no formato do contrato `ProductionProfileSnapshot` do
`@veridi/shared`. Sem FK para perfil, versão ou recurso de propósito — os ids
guardados servem à capacidade futura, e renomear ou desativar um recurso não
reescreve o histórico da ordem. Nenhuma OP anterior é preenchida
retroativamente.

**A duração não é gravada.** Sai do motor canônico a cada leitura, pelo adapter
`planProductionProfileSnapshot`, para a `plannedQuantity` do momento: base de
1.000 un com 2 h de execução vira 6 h numa OP de 3.000 un. Mudar a quantidade
em rascunho refaz a projeção e **não** recopia o perfil. A tela recalcula ao
vivo com o mesmo motor enquanto a quantidade é digitada.

**Produto sem perfil padrão continua válido:** a OP nasce sem cópia, mostra
"Sem perfil de produção aplicado." e nada é bloqueado — nem a criação, nem o
planejamento, nem a liberação. *(Mudou em PRODUCTION-ROUTE-ASSIGNMENT-01: sem
roteiro a OP ainda nasce, mas não planeja, não programa e não libera.)* Para essa OP, e para a legada, o rascunho
oferece **Aplicar perfil de produção** quando o Produto tem padrão ativo; com
cópia antiga, um aviso discreto e **Atualizar perfil**, com confirmação. Trocar
o Produto em rascunho substitui a cópia inteira, atomicamente, pelo padrão do
produto novo — e a remove quando o novo não tem perfil. Fora de DRAFT a cópia é
imutável: aplicar e atualizar são recusados (`order_locked`), e a tela nem
recebe o padrão atual do produto.

Seção **Planejamento previsto** no detalhe da OP: perfil e versão de origem,
quantidade, tempo sequencial previsto, etapas com preparação/execução/duração e
recursos, e o resumo de **Recursos necessários** em horas-recurso. Demanda de
capacidade, nunca custo — Estrutura de Custos, CMV e Precificação seguem
separados e intocados, e o PDF da OP não mudou.

**Próximas capabilities:** PLANNING-CALENDAR-01 entregue em 2026-09-12 (a
jornada da fábrica e os dias sem operação, seção própria abaixo); a OP continua
sem data, turno, disponibilidade e quadro de capacidade — isso é
PLANNING-CAPACITY-BOARD-01, e não existe ainda.

## Cliente e projeto no Orçamento em rascunho (PDF-DATA-PARITY-01, 2026-09-11)

O PDF do Orçamento em rascunho saía com Cliente, CNPJ e Projeto "—". Causa:
o DTO só expunha o snapshot que o envio congela, e rascunho não tem snapshot
— o impresso HTML lia os mesmos campos e tinha a mesma falha. Agora o
rascunho traz o cadastro atual de cliente e projeto, carregado no mesmo
include (sem consulta por campo) e com o mesmo mapeamento que o envio
congela. Enviado segue só com o snapshot; versão fora de rascunho sem
snapshot (legado) não relê o cadastro. Sem migration e sem campo novo. A
auditoria de paridade dos outros 21 PDFs contra o HTML de `7b7a126` não achou
binding perdido.

Findings sem correção: 9 versões ARCHIVED do legado sem snapshot nem linhas;
o endereço do cliente existe no DTO do Pedido e nenhum documento o mostra;
as observações do Recebimento e da Expedição, idem.

Contrato da grade (`PdfDataGrid`): campo opcional some só sem dado (`null`,
texto em branco); "—" já formatado sai no papel, e campo fixo vazio sai "—",
nunca buraco. Antes, opcional com "—" sumia calado. A Rastreabilidade de
lote, único documento que escondia campo por "—", passa o dado cru — mesma
saída.

## Navegação moderna do ERP (NAVIGATION-SIDEBAR-01, 2026-09-11)

Menu em Painel + nove seções na ordem do fluxo (Comercial, Produção, Compras,
Estoque, Qualidade, Cadastros, Gestão, Modelos e Parâmetros, Administração),
com id estável por tela e por seção em `app/navigation.ts`. Nenhuma rota mudou
nem sumiu. Sidebar expandida ou compacta (trilho com um ícone por seção e
dica; o clique abre o menu por cima), seções recolhíveis — a da tela atual
abre sozinha, sem virar preferência —, ★ Favoritos acima das seções e "Buscar
telas…" no topo (Ctrl/Cmd+K, só navegação). No celular, drawer sempre
expandido.

Preferência do usuário (compacto, seções abertas, favoritos) em
`user_preferences`, 1:1 com `User`, JSON por seção (65ª migration), por
`GET/PATCH /me/preferences` — sempre do usuário da sessão. Grava sem botão,
com coalescência de 600 ms; falha de leitura ou gravação não trava o menu.

Decisões: **Produtos × Produto Acabado** são funções distintas — o cadastro
mestre é Cadastros › Produtos Acabados (`/cadastros/produtos`); a lista dos
lotes que saíram de OP (`/producao/produto-acabado`) virou Estoque › Lotes de
Produto Acabado. **Documentos controlados** (revisão de R.PRO.002 e R.COQ.003,
elaborado e aprovado por) é controle documental GMP e foi para Qualidade;
registrar e ativar revisão é da Qualidade e do ADMIN (QUALITY-DOC-WRITE-01).
Rótulos: Visão do Cliente (agora no Comercial), Modelos
de Formulação, Modelos de Estrutura de Custo. A visibilidade por perfil
espelha o gate de leitura que a API já tinha: Usuários só ADMIN; Precificação
só Comercial, Compras e ADMIN. F-01-4 fechado. NAV-PAGE-TITLES-01 e
QUALITY-DOC-WRITE-01 fecharam no mesmo dia, numa passada de acabamento:
títulos, trilhas e ajuda com os nomes do menu, e a Qualidade registrando e
ativando revisão. Seguem no BACKLOG, sem posição na fila: NAV-TWO-SEARCHES-01,
NAV-TEMPLATE-WORDING-01 e HELP-FORMULACAO-WORDCAP-01.

## Alterações não salvas têm guarda (UNSAVED-CHANGES-FOUNDATION-01, 2026-09-11)

Sair de uma tela com trabalho não salvo apagava o trabalho sem dizer nada:
com "Novo projeto" aberto, clicar em Pedidos no menu trocava a tela por baixo
do modal. Agora existe UMA guarda para o ERP inteiro.

`BrowserRouter` + `Routes` virou `createBrowserRouter` +
`createRoutesFromElements` + `RouterProvider` — troca de mecanismo, sem
`loader`/`action` e **sem mudar um endereço sequer** (as 109 rotas estão
travadas em `app/rotas-do-app.test.ts`). É o que faz `useBlocker` existir:
ele segura a navegação depois do clique, com o destino original em mãos.

`UnsavedChangesProvider` (rota de layout sem `path`, uma vez só) +
`useUnsavedChangesGuard({ isDirty, substantivo })` +
`UnsavedChangesDialog`. O hook recebe um BOOLEANO, nunca o formulário: cada
tela já sabe dizer se tem pendência, e a foundation não reimplementa essa
comparação. Várias fontes na mesma tela (formulário + subformulário) dão UMA
pergunta. Bloqueia troca de TELA; mudança só de query string na mesma rota
não é saída. `confirmarDescarte()` cobre o que o router não vê — Cancelar, ✕
e Esc — pelo MESMO diálogo; `liberarGuarda()` cobre o instante depois de
salvar e a saída deliberada para cadastrar no contexto, onde o rascunho vai
junto e volta. `beforeunload` existe exatamente enquanto há pendência (F5,
fechar aba), com o diálogo do navegador.

**Decisão do PO:** com um modal de workspace aberto a **sidebar** deixou de
ser inerte — ela é saída legítima de navegação, e o cadastro era beco sem
saída. O **masthead continua protegido**: a busca global do topo não é saída.

Primeiro corte adotado em quatro telas, sempre reusando o que a tela já
tinha: Projeto novo/editar (baseline do formulário; abrir e os defaults não
contam; salvar limpa antes de navegar), Condições do Orçamento
(`condicoesAlteradas`, sem tocar nas linhas que gravam no blur), Formulação
(rascunho × gravado **mais** ajuste por aplicar; o falso positivo da página
recém-carregada, de `gravado.current` vazio, foi fechado) e Perfil de
Produção (assinatura já existente). As outras 44 telas ficam para
UNSAVED-CHANGES-WAVE-01.

Achado corrigido na rodada: `onClose` recriado a cada render remontava o
efeito de foco/trap do `FullWorkspaceModal` a cada tecla e o campo ficava só
com a primeira letra. Fechado na raiz na wave seguinte.

## Primeiro bloco P1 e a saída no celular (UNSAVED-CHANGES-WAVE-01, 2026-09-11)

A foundation chegou a Pedido, OP e OC — novo e editar, sem provider, blocker
nem diálogo novos. Cada tela projeta o documento na forma que o salvamento
envia, normalizada em `lib/dirty-fields.ts`: decimal em forma canônica,
ausência e vazio como a mesma coisa, e fora tudo o que é do servidor (código,
nome, unidade, recebido). A referência é a assinatura dessa projeção, e
`syncFormFromServer` a invalida — então carregar, salvar, confirmar, cancelar,
reservar e planejar zeram a pendência sem cada caminho lembrar disso. Criar
navega (`/novo` → `/:id`) na mesma função que salvou, antes de qualquer
renderização: ali a referência é atualizada à mão e a navegação passa por
`liberarGuarda`.

**O Planejamento previsto da OP fica fora da assinatura**: é cópia congelada
do Perfil mais projeção derivada da quantidade, refeita pelo servidor a cada
leitura. Contá-lo contaria a mesma edição duas vezes — a quantidade já está
lá — e transformaria releitura do servidor em pendência do usuário.

**Decisão do PO, celular:** o masthead continua protegido, menos o
`.masthead__toggle`. No celular a sidebar É o drawer e o hambúrguer é o único
jeito de abri-la; com o masthead inteiro inerte, a liberação da sidebar não
chegava ao celular. `useInertBackground` passou a DESCER no bloco que contém
uma saída em vez de marcá-lo — a busca global do topo continua fora de
alcance, e no desktop, onde o hambúrguer não existe, nada mudou.

**Bug de foco fechado na raiz.** O mesmo defeito do `FullWorkspaceModal`
estava no `ModalDialog`: `onClose={() => setAberto(false)}` nasce a cada
renderização, a tecla re-renderiza a tela de trás, o efeito de foco e trap se
desmonta e remonta, e a remontagem devolve o foco ao primeiro botão. O motivo
do cancelamento da OC não recebia uma letra sequer. `onClose` virou ref de
leitura nos dois: vale para todos os diálogos do ERP, sem regra nova para quem
escreve tela.

Fixtures de OP: `planning` faltava em duas que montavam o DTO com
`as unknown as ProductionOrderDTO`, e a tela quebrava ao desestruturá-lo.
`PLANEJAMENTO_VAZIO` (`pages/production-orders/planning-fixture.ts`) é o
estado neutro legítimo — OP sem perfil. De 7 testes vermelhos no pacote web
sobraram 1: o teto de palavras da ajuda (HELP-FORMULACAO-WORDCAP-01).

## Doca, relação e contagem sob a guarda (UNSAVED-CHANGES-WAVE-02, 2026-09-11)

Recebimento de OC, material do cliente, Item × Fornecedor (cadastro e detalhe)
e Inventário Físico. Foundation intocada — nenhum provider, blocker ou diálogo
novo; a correção de `onClose` como ref de leitura, feita na Wave 01, já cobre
estes modais.

Cada tela projeta o que o salvamento envia, normalizado por
`lib/dirty-fields.ts`, que ganhou teste próprio: decimal em forma canônica,
ausência e vazio como a mesma coisa, ilegível diferente de tudo, milhar ainda
recusado, ordem das linhas fazendo parte do documento.

**Três decisões que valem como regra para as próximas waves.**

Escolher a OC no Recebimento e escolher o item no Inventário são ESCOPO, não
digitação: carregam a tela, e a referência é retomada depois deles. Sair dali
sem ter digitado nada não custa trabalho nenhum, e perguntar seria ruído.

Derivado não pesa. A diferença do Inventário, o veredito por linha do
Recebimento e a conta do rodapé saem do que já está na assinatura — contá-los
faria a mesma digitação valer duas vezes.

**Save parcial existe, e a pendência reflete só o que continua pendente.** O
detalhe de Item × Fornecedor tem três salvamentos independentes — dados
comerciais, nota da qualidade, oferta. Cada bloco compara contra o registro
que voltou do servidor, então gravar um limpa aquele e só aquele: com o código
salvo e o preço ainda digitado, a guarda continua perguntando.

O Inventário Físico é contagem de UMA linha por vez — item, lote, contagem,
motivo — e confirma criando o ajuste sem sair da tela. Não há contagem
multi-linha nem save parcial por linha para proteger.

## Os quatro cadastros mestres (UNSAVED-CHANGES-WAVE-03, 2026-09-11)

Item, Cliente, Fornecedor e Produto Acabado — criação e edição. Foundation
intocada.

Cada cadastro tem DUAS portas (a página `/novo`, com URL própria, e o modal da
listagem) e UM controller: `useItemForm`, `useCustomerForm`,
`useSupplierForm`, `useProductForm`. A guarda entrou no controller, então as
duas portas ficaram protegidas pelo mesmo caminho, e o `confirmarDescarte()`
que cobre Cancelar, ✕ e Esc sai de lá para o modal. O "← Voltar" e o
"Cancelar" das páginas não ganharam nada: trocam de endereço, e o blocker
global já resolve — um gesto, um diálogo.

`assinaturaDoFormulario` (em `lib/dirty-fields.ts`) compara formulário plano:
texto normalizado, marca de sim/não como está, e os campos que são NÚMERO em
forma canônica, por uma lista explícita por cadastro — que também documenta
quais campos daquele cadastro são número.

**O que NÃO entra no dirty, e por quê.** A situação comercial do Cliente é
derivada do histórico pelo servidor e muda sozinha: contá-la faria a tela se
declarar alterada sem ninguém tocar em nada. Do Produto ficam fora Formulação,
CMV, custo industrial, estoque e o **Perfil de Produção padrão** — o vínculo
não é editável no cadastro, é gravado do lado do Planejamento com salvamento
próprio. O código nasce no servidor nos quatro. Defaults não sujam, inclusive
o tipo pré-escolhido por `?tipo=` no Item, que traz consigo os controles de
lote, validade e liberação daquele tipo.

**Save parcial, segundo caso.** O modal de edição de Item tem "Salvar
alterações" e, dentro do bloco de Custo de referência, um botão só dele.
Gravar os campos do item com um custo digitado ao lado não libera a saída — a
pendência é a soma, e cada parcela some quando o seu botão grava. Mesma regra
do detalhe de Item × Fornecedor.

**Endereço do Fornecedor (SUPPLIER-ADDRESS-01, 2026-09-11).** O Fornecedor
passou a ter o MESMO endereço estruturado do Cliente — `street`, `number`,
`complement`, `district`, `zipCode`, `city`, `state` —, todos opcionais e com
as mesmas validações (CEP só dígitos, UF maiúscula da lista brasileira). O
cadastro continua completo sem endereço: homologação, oferta, preferência,
Ordem de Compra e Recebimento não passaram a exigir nada. O bloco entrou na
guarda de alterações não salvas junto com os outros campos, e a consulta de
CEP é a mesma do Cliente, com a mesma regra de que o endereço pertence a UM
CEP. Nenhum PDF mudou, e nenhum dado legado foi preenchido — o workbook de
Fornecedores será regenerado em MIGRATION-PACK-REVIEW-02 para a Veridi
enriquecer os campos à mão.

## Custo, preço e os três modelos (UNSAVED-CHANGES-WAVE-04, 2026-09-12)

Estrutura de Custo, Precificação, Modelo de Estrutura de Custo, Política de
Precificação e Modelo de Formulação. Foundation intocada.

**A regra desta wave.** Dirty é entrada do usuário ainda não persistida, e só
isso. Custo calculado, preço sugerido, margem e contribuição da prévia,
energia derivada dos equipamentos, totais e a base recalculada do rebase são
RESULTADO: saem de `computePrice` e do servidor a cada tecla e se refazem
sozinhos na próxima abertura. Quem causa a pergunta é o campo que provocou o
recálculo, nunca o recálculo.

**Save parcial, terceiro caso — e o bug que ele revelou.** Quatro das cinco
telas gravam em mais de um bloco, cada um com o seu botão:

| Tela | Blocos que gravam separado |
| --- | --- |
| Estrutura de Custo | base de produção · premissa nova · recurso novo |
| Modelo de Estrutura de Custo | identificação · rascunho |
| Política de Precificação | identificação · rascunho (Modelo + faixas) |
| Modelo de Formulação | identificação · rascunho · painel de ajustes da linha |
| Precificação | um só: a faixa em montagem |

A guarda é a SOMA do que continua pendente: gravar um bloco não absolve o
outro. Escrever o teste disso mostrou que a soma ainda não era verdade —
**toda ação termina em `load()`, e a releitura reescrevia os campos dos OUTROS
blocos com o que está gravado**. Salvar a identificação do Modelo apagava a
base do rascunho que estava sendo digitada, sem aviso e sem pergunta, porque a
tela achava que tinha acabado de ler a verdade. As quatro telas passaram a
guardar a leitura anterior do servidor e só substituir o campo que ainda está
como ele deixou — o que foi mexido fica como está. É a mesma regra de
QUOTE-DRAFT-STATE-01, aplicada onde faltava.

**O que não suja.** Defaults não são digitação: a margem de 30% e a comissão
de 5% da Precificação são a regra da PRÓXIMA faixa e continuam valendo depois
de gravar — contá-las deixaria a tela suja para sempre depois do primeiro
salvamento. A comissão de 5% da faixa nova da Política, idem. Linha em branco
de "+ Adicionar recurso/faixa/componente" também não: é o que o próprio
salvamento descarta. A base de produção sugerida pelo lote mínimo chega
preenchida e não é de ninguém até ser mudada.

**Ações de domínio não viram segunda pergunta.** Ativar, arquivar e criar
versão gravam na hora e não deixam pendência. O rebase da Precificação já foi
confirmado na sua própria caixa e leva para a versão nova pela própria ação:
navega por `liberarGuarda`. Sair para cadastrar um item ou um recurso a partir
do campo de busca também — o rascunho vai junto e volta aplicado na linha.

**Modelo de Formulação.** O dirty que existia era só o do painel de ajustes,
medido por `ajustes.alterado()` — o mesmo que prende "Salvar rascunho". Ele
continua inteiro e agora é UMA das três parcelas: a guarda usa a MESMA
comparação, para que não divirjam no primeiro campo novo. Quantidade física,
modo de cálculo, pureza, overage, marcas, unidade, fornecimento e notas entram
na assinatura do rascunho.

## Fundação de filtros, e o período do Faturamento (FILTER-FOUNDATION-01, 2026-09-12)

A auditoria de filtros apontou que o período do Faturamento interpretava
`yyyy-mm-dd` como INSTANTE. A causa era `z.coerce.date()` em
`listBillingsQuerySchema`: `2026-09-10` virava `2026-09-10T00:00:00.000Z` —
21h do dia 09 em São Paulo — e a consulta fechava o intervalo com
`issuedAt lte` disso. "De 10/09 até 10/09" não devolvia nada do dia 10, e o
CSV errava igual porque usa o mesmo schema.

**Regra.** Data de filtro operacional é DIA COMERCIAL, não instante digitado.
O filtro viaja como `YYYY-MM-DD` (string validada por `diaCivilDeFiltroSchema`,
que recusa `10/09/2026`, `2026-02-30` e ISO completo em vez de reinterpretá-los)
e só vira instante uma vez, no serviço, por `intervaloDeDiasComerciais` —
`@veridi/shared/business-timezone.ts`, a mesma definição de fuso do resto do
sistema. O intervalo usa **fim exclusivo** (`gte início`, `lt início do dia
seguinte`): `23:59:59.999` é um fim inventado que depende da precisão da
coluna. `limitesDoDiaComercial` passou a DERIVAR dele (`-1ms`) e não mudou de
comportamento. Nenhuma conta de fuso no frontend: `resolveListPeriod` resolve o
"hoje" por `hojeComercial`, então o operador fora do Brasil obtém a mesma
consulta.

**Foundation** (`lib/list-filters.ts`, `lib/list-period.ts`,
`components/filters/`): `useListFilters` põe o estado dos filtros na URL —
default não ocupa a URL, nenhum parâmetro duplicado, trocar filtro volta para
a página 1 —, `DateRangeFilter` dá os atalhos de período, `ActiveFilterChips`
mostra `Filtros (N)` com × por filtro, e `ClearFilters` é a saída única.
Precedência: URL (quando traz qualquer filtro da tela) > lembrança da sessão
(`persistScope`, chaves compatíveis com `usePersistentFilter`) > default. O
passo da URL é tudo ou nada, senão um endereço colado num chamado mostraria
listas diferentes para duas pessoas. Suporta status, busca, entidade, período
e paginação; agrupamento de status fica para quando uma tela precisar.

**Faturamento é a tela de referência.** Default operacional **Mês atual**
(decisão de Product Ownership), com Hoje, Últimos 7 dias, Últimos 30 dias e
Personalizado — este sem limite de recuo, para o relatório histórico. Busca,
status e cliente continuam como eram, agora com endereço. O CSV lê o MESMO
objeto de filtros da consulta da tela, não uma segunda lista de campos.

Nenhuma migration. As outras 51 telas não foram convertidas — próximo é
FILTER-OPERATIONS-WAVE-01.

## Primeira onda de filtros operacionais (FILTER-OPERATIONS-WAVE-01, 2026-09-12)

Quatro telas sobre a foundation da FILTER-FOUNDATION-01, e os problemas
operacionais que a auditoria tinha achado nelas. Nenhuma segunda foundation:
`useListFilters`, `list-period`, `DateRangeFilter`, `ActiveFilterChips`,
`ClearFilters`, `business-timezone` e `diaCivilDeFiltroSchema` foram reusados
como estavam.

**O mesmo bug de data, em dois lugares.** `receiving.schemas.ts` e
`finished-goods.schemas.ts` usavam `requiredDateSchema` (= `z.coerce.date`)
com `lte`: "até 10/09" encerrava o dia às 21h de 09/09 em São Paulo. Em
Produto Acabado havia um segundo defeito, na tela — `new Date(dia +
"T00:00:00")` e `...T23:59:59.999`, componentes LOCAIS do navegador —, então
o mesmo filtro devolvia conjuntos diferentes em São Paulo, em Vancouver e em
Tóquio, sem nada avisando. Os dois filtros passam a viajar como `YYYY-MM-DD`
e viram instante uma vez, no serviço, por `intervaloDeDiasComerciais`, com
fim exclusivo. `Receipt.receivedAt` e `ProductionOutput.producedAt` continuam
instantes; o que mudou é o DIA a que eles pertencem ser o da operação.

**CSV.** Produto Acabado exportava busca, qualidade e produto e deixava o
período de fora: a tela mostrava um recorte e o arquivo trazia a produção
inteira. As quatro telas agora montam UM objeto de filtros que alimenta a
consulta e o botão de exportação — não há segunda lista de campos.

**Picking/Consumo — o corte silencioso.** A fila era
`Promise.all([status=RELEASED pageSize=100, status=IN_PRODUCTION
pageSize=100])` concatenado no navegador, sem filtro e sem paginação: da 101ª
ordem em diante cada lado perdia linhas e o rodapé contava `orders.length`
como total. `listProductionOrdersQuerySchema.status` passou a aceitar lista
separada por vírgula (um valor só continua valendo — sem breaking change) e a
tela faz UMA consulta paginada com `status=RELEASED,IN_PRODUCTION`. Default
operacional **Em aberto**, que é esse par — nenhum status novo foi inventado.
`StatusGroupFilter` nasceu aqui, pequeno e reutilizável, e NÃO foi aplicado
às outras telas.

**Fila da Qualidade.** O achado real não era um corte em 100: era leitura
SEM teto. `listQualityQueue` carregava a tabela de lotes inteira, somava o
ledger de cada linha e cortava a página em memória. Agora pagina no banco;
"somente com saldo" virou `lotIdsComSaldoPositivo` (agregação sobre os
movimentos, em `inventory-ledger.ts`) que devolve ids para o próprio `where`,
e o `total` sai de um `count`. A tela ganhou **Todos** — o `<select>` obrigava
um recorte documental e a fila inteira era inalcançável —, e o sentinela de
pendências virou `pendencias`, para não conviver na URL com o `CoaStatus`
`PENDING`, que quer dizer outra coisa. `supplierId` e `ownerCustomerId`
existiam no servidor e o cliente não os enviava: contexto por link se perdia.

**Catálogo com teto fixo.** Produto Acabado carregava
`listProducts({ pageSize: 1000 })` num `<select>` e apresentava isso como
catálogo completo. `EntityFilterSelect` (novo, usado por Produto Acabado,
Picking e Recebimentos) faz busca no SERVIDOR e resolve o rótulo de um id que
veio da URL fora da primeira página — sem isso o filtro valia e a tela não
dizia por quê.

**Defaults preservados.** Recebimentos e Produto Acabado abrem em `Todo o
período`: nunca tiveram recorte, e impor "Mês atual" esconderia registros —
decisão de Product Ownership, não de migração. A CoA continua abrindo em
Pendências.

Nenhuma migration. Lotes, Liberação de Lotes, Pedidos, Expedições, OP, OC,
Relatórios e Dashboard não foram tocados — próximo é
FILTER-OPERATIONS-WAVE-02.

## Lotes: contexto de link deixou de ser adivinhação (FILTER-OPERATIONS-WAVE-02, 2026-09-12)

Uma tela só, e duas portas: "Liberação de lotes" é `/estoque/lotes?status=
AWAITING_RELEASE` (`app/navigation.ts`). É isso que tornava o contexto
residual grave aqui — não era uma lista secundária errando, era a fila da
Qualidade.

**A causa dos resíduos: merge por CAMPO.** `usePersistentFilter` recebia o
override da URL campo a campo. Chegando em `?status=AWAITING_RELEASE`, o
status vinha do link e `search` e `owner` caíam na LEMBRANÇA DA SESSÃO — quem
tinha filtrado qualquer coisa antes clicava em "Liberação de lotes" e recebia
o cruzamento, sem nada na tela dizendo isso. Na foundation a URL é conjunto
explícito: trouxe qualquer filtro da tela, ela responde por todos.

**`itemId` era um filtro fora do conjunto.** Lido direto de
`useSearchParams`, ficava fora de três lugares ao mesmo tempo: das
dependências do `reload` (trocar `?itemId=` sem desmontar a página deixava na
tela os lotes do item ANTERIOR, com a URL já no novo), do objeto que vai ao
CSV (a tela mostrava um item e o arquivo trazia a base inteira) e do "Limpar
filtros". Agora é filtro como os outros, com chip, × e endereço — e ganhou
controle próprio, com busca no servidor (`EntityFilterSelect` +
`itemFilterSource`): filtrar por item só era possível chegando por link,
embora a API sempre tenha respondido.

**Dois botões com o mesmo texto.** O "Limpar filtros" da barra zerava a
sessão e deixava o `?itemId=` de pé; o do aviso de contexto trocava de
endereço e deixava a sessão intacta. Sobrou um, e ele limpa tudo.

**`ownerType` entrou na URL.** O filtro funcionava e o endereço não o
reproduzia: "me manda o link do que você está vendo" mostrava outra lista.

**Foundation — a sessão guarda ESCOLHA, não link.** O smoke pegou o efeito
colateral: clicar em "Liberação de lotes" gravava aquele status na sessão, e
daí em diante "Lotes" (o mesmo endereço, sem query) abria na quarentena — um
link de contexto reescrevia em silêncio a visão padrão de quem o clicou, e o
menu apontava para um item enquanto a tela mostrava o recorte do outro.
`useListFilters` passou a persistir só depois de a pessoa mexer em algum
filtro na tela. "Filtrei, abri um registro, voltei" continua preservado, que
é para isso que a lembrança existe. Vale para as seis telas migradas.

Nenhuma mudança de backend e nenhuma migration: a API de Lotes já respondia
por `itemId`, `status`, `ownerType` e `search`, e já paginava. Regra de
liberação, validade, CoA e status de lote não foram tocados — só consulta,
filtro e contexto.

## Calendário de Produção (PLANNING-CALENDAR-01, 2026-09-12)

> Jornada única e exceção sempre fechada foram substituídas pela jornada por
> dia da semana e pela exceção com horário especial — ver
> PLANNING-CALENDAR-WEEKLY-SCHEDULE-01, abaixo.

A jornada operacional da fábrica, e os dias em que ela não opera. Em
`Planejamento → Calendário de Produção` (`/planejamento/calendario`).
**Absorve o OPS-CALENDAR-01 do BACKLOG (B · #9) por decisão do PO:** um
conceito só, e a entrada do backlog foi fechada apontando para cá.

**Um calendário, e o banco garante.** `production_calendars` tem chave
primária fixa `GLOBAL` com CHECK — não existe lista, não existe coluna
`active` e não há como uma segunda linha nascer. Mão de obra e equipamento
continuam POOLS e herdam esta jornada; calendário por recurso, setor ou
cliente fica para quando houver necessidade real.

**Hora do dia é MINUTO DO DIA, nunca `DateTime`.** `08:00` não tem data, não
tem fuso e não muda em outubro: guardar um instante fabricado para
representá-la faria a jornada andar uma hora cinco meses por ano. São
`startMinuteOfDay`/`endMinuteOfDay` inteiros (0…1440), com CHECK de janela
(`0 <= início < fim <= 1440`) e de intervalo (`0 <= intervalo < janela`). A
tela mostra `HH:mm` pelo controle nativo de hora.

**Dias operantes são sete colunas booleanas**, com CHECK de "ao menos um": um
array precisaria de regra de duplicata e de faixa, e "nenhum dia" vira uma
linha de SQL. Calendário novo nasce segunda a sexta, 08:00–17:00, 1 h de
intervalo — e esse padrão vale só no primeiro salvamento: **ler nunca cria**,
e o GET devolve a sugestão com `configured: false` enquanto ninguém salvou.

**Exceção é DIA CIVIL inteiro**, uma por data (decisão do PO), com tipo
`FERIADO`/`RECESSO`/`PARADA_OPERACIONAL`/`OUTRO` e motivo livre. A data
repetida é recusa explícita com o motivo que já está lá (409
`exception_date_taken`) — nunca sobrescrita silenciosa; editar troca tipo e
motivo, e a data não se move. Sem parada parcial por hora, sem turnos, sem
recorrência anual e sem API externa de feriados.

**Fuso reusado, não reinventado.** `FUSO_COMERCIAL`, `ehDiaCivil` e
`diaCivilDeslocado` vêm do `business-timezone`; a data da exceção é o marcador
de meia-noite UTC, igual a `scheduledDate` (§75) e a `validUntil`. Os helpers
novos — `diaDaSemanaComercial`, `ehDiaOperacional`, `minutosUteisDoDia`,
`proximoDiaOperacional`, `proximoInicioUtil` — vivem em dia civil e minuto do
dia, e por isso o horário de verão não os alcança. O teste prova com um caso
histórico: 02:30Z de 07/11/2018 é QUARTA em São Paulo, e um `-03:00` cravado
diria terça.

**Domínio exclusivo de planejamento produtivo.** Nada passa a depender de dia
útil: tarifa industrial, oferta de fornecedor, `ItemCostReference`, validade
de lote, faturamento e promessa de entrega ao cliente seguem exatamente como
estavam. `ProductionOrder` não foi tocada — sem `plannedStartAt`, sem agenda,
e `plannedAt` continua sendo o carimbo do ato de planejar.

Migration aditiva `20260925093020_production_calendar`: duas tabelas e um
enum, sem backfill. Escrita para ADMIN e PRODUCTION, leitura para todos — o
mesmo gate dos Perfis de Produção. **Próximo:** PLANNING-CAPACITY-BOARD-01
(capacidade de recurso, início/fim previstos da OP e quadro dia/semana), que
é onde `IndustrialResource.capacityQuantity` e a agenda da OP entram.

## A opção é a linha, e gravar responde (UX-ACTIONS-FEEDBACK-01, 2026-09-12)

Política de Precificação como implementação de referência; o padrão ficou em
`components.css` para as próximas telas. Nada de cálculo, regra ou
persistência mudou.

**`.selection-row` — a opção é uma linha inteira.** Custo industrial e
Impostos estimados eram `.field-grid-2`: radio à esquerda, campo do modo na
outra metade de uma tela de 1300px, e nada além da bolinha dizendo o que
estava escolhido. Agora rótulo e campo ficam lado a lado sob um teto de
640px, o rótulo cobre a coluna toda (clicar no texto escolhe) e "escolhida"
muda fundo, borda **e** peso do rótulo — cor sozinha não comunica estado. O
radio continua sendo o indicador semântico; o campo do modo desligado
continua desabilitado com o valor guardado.

**Custos externos viraram um bloco só** — caixa, título e explicação —, com a
explicação em `aria-describedby` para não ser engolida pelo nome acessível
do controle. Perfis tributários ganharam a variante `--plain`: alinhamento,
não card. Semântica e regra de compatibilidade intactas.

**`.form-actions` — barra de ações de formulário.** Mesmo gap e mesma quebra
da `.doc-actions`, com `--split` e `__group`; em 480px os grupos ocupam a
linha e os botões esticam, sem encolher fonte. As três ações do rascunho
deixaram de ter peso igual: `+ Adicionar faixa` terciária (ghost), `Salvar
rascunho` secundária, `Ativar versão` de commit (accent). **Não houve regra
global**: `.line-actions` — só `margin-top`, sem gap — continua como está
nos outros ~27 blocos com botões irmãos encostados, listados para a onda
seguinte.

**Gravar responde.** `Salvando…` no botão que está gravando (e só nele:
`saving` virou o NOME da ação em curso), desabilitado contra clique duplo, e
`Rascunho salvo.` no fim — uma frase, `role="status"`, sem modal e sem
empilhar. Erro continua em `role="alert"` e nunca vira sucesso. Sem
alteração pendente o botão fica desabilitado, pela mesma pendência que o
UNSAVED-CHANGES-WAVE-04 já calcula — nenhum `dirty` paralelo. Save parcial
preservado: gravar o rascunho não absolve o nome trocado. `Ativar versão`
segue independente e confirma com **outra** frase, exibida na Versão ativa
porque o bloco do rascunho deixa de existir ao ativar.

**Próximo:** UX-ACTIONS-FEEDBACK-WAVE-02 — migrar os `.line-actions` com
botões irmãos, a começar por Projetos (4 botões), Modelos e Formulação (3).

## O perfil virou roteiro (PRODUCTION-ROUTE-UX-01, 2026-09-12)

Decisão do Product Owner: na interface, **Roteiro de Produção**. No código,
`ProductionProfile` continua — rota `/planejamento/perfis-producao`, API,
schema e §89 inclusive. Nenhuma fórmula, regra, versão ou migração mudou.

**A palavra, onde o usuário a encontra:** menu, busca de telas (com o apelido
antigo preservado), trilha, título, listagem, detalhe, ajuda "Como funciona",
e as mensagens de erro da API que chegam à tela. A Ordem de Produção fala a
mesma língua — "Aplicar roteiro de produção", "Atualizar roteiro" —, porque
metade do ERP dizendo "perfil" era a confusão que a rodada veio desfazer.
"Quantidade-base" virou **quantidade de referência**; "Unidade da base",
**unidade de referência**; "Quantidade de recursos", **quantidade
necessária**. A Formulação e a Estrutura de Custos, que têm base própria, não
foram tocadas.

**O que a tela passou a explicar:** que o roteiro responde "como este produto é
fabricado" e a Formulação responde "o que entra nele"; que a quantidade de
referência é a que os tempos usam, com exemplo numérico; que as etapas
acontecem em ordem; que preparação é tempo fixo e execução acompanha a
quantidade pelo modo de escala, cada modo descrito em português; e que
recurso é o que precisa estar disponível AO MESMO TEMPO, com o caminho do
cadastro nomeado.

**Estado vazio deixou de ser linha cinza.** Sem etapa, a tela diz o que falta,
dá exemplos (Pesagem, Mistura, Encapsulamento, Embalagem) e oferece a ação.
Sem nenhum recurso de capacidade cadastrado, ela oferece "Cadastrar recurso" —
pela criação contextual que o ERP já tinha (`use-contextual-create`), com o
rascunho inteiro guardado e devolvido no retorno. Nada de navegação paralela.

**Resumo do roteiro**, quatro fatos do MESMO motor (`planProductionProfile`),
nenhuma conta nova: etapas, tempo sequencial para a própria quantidade de
referência, tipos de mão de obra e tipos de equipamento. Nada de capacidade,
pico simultâneo ou agenda — isso é PLANNING-CAPACITY-BOARD-01.

**Ações e feedback pelo padrão do UX-ACTIONS-FEEDBACK-01:** `.form-actions`
com grupos, "+ Adicionar etapa" terciária, "Salvar rascunho" secundária,
"Ativar versão" de commit; "Salvando…" só no botão clicado, "Rascunho salvo."
ao lado dele e "Versão ativada." na Versão ativa. Identificação ganhou
pendência própria na MESMA guarda de alterações não salvas, e a leitura que
vem com o salvamento deixou de reescrever o nome ainda não salvo.

**Próximo:** FILTER-OPERATIONS-WAVE-03 ou PLANNING-CAPACITY-BOARD-01, a
critério do Product Owner.

## Planejamento virou operação (PLANNING-CAPACITY-BOARD-01, 2026-09-12)

Roteiro + Calendário + capacidade viraram uma resposta: **quando cada ordem
está prevista e onde a fábrica aperta**. Regra durável em `PRODUCT_RULES.md`
§91. Duas migrations aditivas, sem backfill.

**O intervalo ganhou horário, e foi ele que destravou tudo.** O calendário
sabia QUANTO o intervalo dura e não ONDE ele cai — com isso não há como dizer
que uma etapa termina às 13:20. `breakStartMinuteOfDay`/`breakEndMinuteOfDay`
entram nulos para todo calendário existente, e nada é inferido: 12:00–13:00
seria a jornada de uma fábrica que ninguém consultou. Sem a posição, a agenda
com hora exata **recusa** e diz o que falta; o calendário segue válido para o
resto.

**Capacidade do recurso.** `capacityQuantity` em mão de obra e equipamento —
energia recusada por CHECK. NULL é "não cadastrada", nunca zero: o
planejamento avisa a lacuna em vez de acusar sobrecarga sobre um número que
ninguém informou. O recurso continua POOL.

**Agenda da OP.** `ProductionOrderSchedule`, 1:1, snapshot por valor, com
`workSegments` dentro de `steps`. **Envelope não é ocupação**: uma etapa que
começa sexta 16:00 e termina segunda 09:00 não ocupa recurso no fim de semana,
e é pelos segmentos que conflito e carga se contam. Mudar jornada, intervalo
ou feriado depois não reescreve agenda gravada; excluir a exceção que a
motivou também não. Recalcular é definir o início de novo.

**O início é humano.** Nada de autoagendamento: início fora da jornada é
recusado com o motivo E com a sugestão do próximo horário válido, e usá-la é
outro clique. `RELEASED` só move com confirmação explícita; em produção,
concluída, cancelada ou bloqueada a agenda vira histórico. Conflito é AVISO —
a programação grava do mesmo jeito.

**Tela nova:** `Planejamento → Planejamento de Produção`
(`/planejamento/quadro`), visão Dia/Semana, filtros de situação, produto e
recurso na URL, ordens programadas, "sem programação", carga por recurso e os
conflitos. A ação "Definir início previsto" é UMA só, com prévia antes de
confirmar, usada pela ordem e pelo quadro.

**De quebra:** o Calendário de Produção ganhou o "Como funciona" que faltava
desde o PLANNING-CALENDAR-01 — o contrato de ajuda estava vermelho havia três
rodadas.

**Próximo:** FILTER-OPERATIONS-WAVE-03, ou a onda de ações do
UX-ACTIONS-FEEDBACK-WAVE-02, a critério do Product Owner. Autoagendamento
continua fora de escopo.

## Cada dia com a sua jornada (PLANNING-CALENDAR-WEEKLY-SCHEDULE-01, 2026-09-12)

A jornada única com sete caixas de dia operante não descrevia a fábrica real
— segunda a quinta 08–17 com almoço, sexta e sábado 08–12, domingo fechado.
Regra durável em `PRODUCT_RULES.md` §90. Uma migration aditiva.

**Sete linhas, e a fonte é uma só.** `ProductionCalendarWeekday` (unique
calendário + dia): opera ou não, início, fim e intervalo opcional. Dia que não
opera não tem horário (CHECK). As colunas de jornada única de
`production_calendars` ficaram deprecadas e sem leitura — remoção em
CALENDAR-LEGACY-COLUMNS-CLEANUP-01 (BACKLOG D).

**Migração sem perda.** Dia marcado copiou jornada e intervalo; desmarcado
nasceu sem operação; exceção antiga virou `SEM_OPERACAO`. Intervalo com
duração e sem horário foi para `unpositionedBreakMinutes`: rende o mesmo, e a
agenda exata recusa nomeando o dia até alguém salvá-lo. O teste da API executa
o bloco de backfill da própria migration sobre calendários legados.

**Salvar é por linha.** `PUT /production-calendar/weekdays/:weekday`; o PUT da
semana inteira saiu. Primeiro salvamento cria os sete dias. Ao menos um dia
opera, conferido com o calendário travado na transação.

**Exceção = motivo + funcionamento.** `SEM_OPERACAO` (horários nulos) ou
`HORARIO_ESPECIAL` (jornada da data, para menos ou para mais, inclusive em dia
fechado). Sem "meio dia". Precedência canônica em `janelasDoDia`: exceção da
data, depois a jornada do dia da semana. A agenda da OP, o quadro e a prévia
consomem o mesmo motor; agenda gravada segue snapshot e recalcular usa o
calendário novo.

**Tela.** Tabela de sete dias (Dia, Opera, Início, Intervalo, Fim, Horas
úteis, Ação) com edição NO lugar, uma linha por vez — trocar de linha com
alteração passa pela guarda de alterações não salvas —, "Salvando…",
"Sexta-feira salva." em `role="status"` e erro em `role="alert"`. Em 390px
dias e exceções viram cartões. Exceções com Data, Motivo, Funcionamento,
Horário, Observação; horário só aparece em horário especial. "Como funciona"
reescrito.

**Testes em faixa serial.** `production-calendar.test.ts` e
`production-schedules.test.ts` regravam o calendário global e passaram para
`vitest.serial.config.ts`.

**Próximo:** PRODUCTION-ROUTE-ASSIGNMENT-01, depois do Bulk.

## As quatro filas abrem no que falta fazer (FILTER-OPERATIONS-WAVE-03, 2026-09-12)

Pedidos, Expedições, Ordens de Produção e Ordens de Compra sobre a foundation
(`useListFilters`, `StatusGroupFilter`, `EntityFilterSelect`, chips, "Limpar
filtros"), sem segunda foundation e sem migration.

**Default operacional "Em aberto", só com status que existem.** Pedidos:
rascunho, confirmado, em atendimento, parcialmente expedido (`SHIPPED` e
`CANCELLED` fora — faturar o expedido tem fila própria no Faturamento). OP:
rascunho, planejada, liberada, em produção. OC: rascunho, confirmada, recebida
parcialmente. Expedição: só o rascunho — a confirmada não se edita e o
faturamento dela é "Aguardando faturamento". O default não vira chip nem entra
na URL; "Todos os status" é a saída para o histórico, e remover o chip de
status volta para Em aberto. Na URL, `status` é `todos` ou o próprio status do
domínio. **`BLOCKED` não entrou em Em aberto**: nenhum serviço o escreve, então
não há semântica a assumir — continua opção própria e parte de "Todos".

**Vários status, um contrato.** `status=A,B,...` do Picking virou
`listaDeStatusSchema` (`apps/api/src/lib/status-list-schema.ts`) e passou a
valer em Pedidos e OC; OP só trocou a cópia pelo helper. Um valor continua
valendo. O `ExportCsvButton` aceita lista e manda a mesma vírgula: tela e CSV
leem o MESMO objeto nas quatro telas.

**Contexto de link.** `?customerId=` (Cliente → Pedidos), `?productId=`
(Produto → OP) e `?supplierId=` (Fornecedor → OC) viraram filtro com controle,
chip nomeado e endereço. Na OP o `productId` estava fora do recarregamento, do
CSV e do "Limpar filtros" — o mesmo defeito que Lotes teve. Expedições ganhou o
filtro por Pedido que a API sempre aceitou. Cliente e fornecedor deixaram o
`<select>` de `pageSize: 1000`.

**OC ganhou período pela data do pedido — em marcador de dia civil.**
`orderDate` é data de documento (a tela grava a meia-noite UTC do dia), então
o intervalo é `intervaloDeDiasCivis` (`lib/business-day.ts`): `gte` marcador do
dia, `lt` marcador do dia seguinte. `intervaloDeDiasComerciais` é para coluna
de instante; aqui ele erraria o dia inteiro ("10/09" traria as OCs de 11/09) —
o teste de fronteira prova com a mutação. Pedidos, OP e Expedições não
ganharam período: nenhum tinha suporte nem link, e o histórico por período
mora nos Relatórios.

Paginação: as quatro já paginavam no banco com total do `count`; nenhum corte
nas listas. Cortes achados fora do escopo, sem correção:
`ReceivePurchaseOrderPage.tsx` (Receber OC junta duas listas de 100) e
`CommercialReports.tsx` R-14 (`listCustomerOrders({ pageSize: 100 })`, para
REPORTS-PAGINATION-01). O achado de dado da rodada — Sugestão de Compra gravando
`orderDate: new Date()` — foi corrigido logo depois, em
PURCHASE-SUGGESTION-BUSINESS-DATE-01: a OC gerada grava
`marcadorDeHojeComercial()` (§81, "hoje implícito é o dia comercial"), e a OC
manual abre o campo em `hojeComercial()` em vez do dia UTC. Seed e demo de dev
foram junto. Sem backfill: OCs antigas ficam como estão.

**Próximo:** UX-ACTIONS-FEEDBACK-WAVE-02.

## A barra antiga saiu de onde havia ação irmã (UX-ACTIONS-FEEDBACK-WAVE-02, 2026-09-12)

O padrão da onda 01 (`.form-actions`, `--split`, `__group`, `.form-status`)
aplicado às telas com botões colados. Nenhum cálculo, status, lifecycle,
permissão, API ou migration mudou; diálogos de aprovar, cancelar, ativar e
inativar continuam onde estavam.

**`.line-actions`: 65 usos → 35, nenhum com ação irmã.** 28 barras tinham duas
ou mais ações encostadas; as 28 viraram `.form-actions`, mais os dois "Criar
nova versão" dos Modelos, para a frase "Versão ativada." morar como na
Precificação. As 35 que ficaram são botão isolado, `.table__actions` com gap
próprio ou bloco de espaçamento. `ux-acoes-onda-02.test.tsx` lê o fonte e recusa
barra antiga com irmãs — única exceção nomeada: a Qualidade do lote, cujos
botões dependem de status que nunca coexistem.

**Modelos** (Estrutura de Custos e Formulação) ganharam a barra da Precificação
inteira: `+ Adicionar` terciária, `Salvar rascunho` secundária e desabilitada
sem pendência, `Ativar versão` de commit; "Salvando…"/"Ativando…" só no botão
clicado, "Identificação salva.", "Rascunho salvo." e "Versão ativada." só com a
resposta. No Modelo de Formulação o ajuste aberto e não aplicado conta como
pendência — é o clique que diz qual linha espera decisão. **Formulação** e
**Pedido**: a pendência e a confirmação moram na barra do documento, e o
`saving` compartilhado deixou de pôr "Salvando…" no botão de salvar durante
ativar, confirmar ou cancelar. Na versão da Formulação o salvar continua
clicável sem pendência, porque é ele que valida e leva ao primeiro erro.

**Projeto:** a etapa (Amostra, Stand-by) de um lado; aprovar e cancelar do
outro, mesma ordem de tabulação. **Proposta:** PDF separado de enviar/aceitar/
recusar; nas condições, `Simular` longe de quem grava, e "Salvando…" segue a
promessa do salvamento. **Custos:** "Salvar base" com "Base salva." perto do
campo, ativação na outra ponta; "Calcular custo" continua accent e "Salvar
cálculo" secundária de propósito (salvar congela documento). **Item ×
Fornecedor:** a inativação virou grupo próprio — `btn--set-apart`, margem
avulsa, saiu do CSS — e "Dados comerciais salvos.". **Folha de Receita:**
pesar e concluir a parte em grupos, cada botão com o próprio "…ando".
Referência de custo do item confirma "Referência salva." quando o formulário
fecha. CoA, amostra, CMV, origem dos modelos e links do custeio: só gap.

**`.checkbox` ganhou regra** (alinhamento, gap, cursor; cor e fonte do lugar):
seis telas usavam a classe sem nenhuma. Em 480px, grupo vazio da barra (a
ação que só aparece com pendência) some em vez de virar linha em branco; no
desktop ele continua segurando a outra ponta. Smoke 1440 + 390 nas sete telas pedidas
e nas quatro com checkbox: nenhum overflow, nenhum botão colado ou com texto
vazando, fonte igual à do desktop, console limpo. Rascunho de Modelo e de
Estrutura de Custos simulado por interceptação no Playwright — o banco local
não tem nenhum, e o smoke não grava.

Achado sem correção: Faturamento, Ordem de Produção, Ordem de Compra,
Expedição e Recebimento dizem "Salvando…" e não confirmam o salvamento — fora
das telas desta onda.

**Próximo:** BULK-SELECTION-FOUNDATION-01.

## Página não é tudo (BULK-SELECTION-FOUNDATION-01, 2026-09-12)

Foundation de seleção em massa (`components/BulkSelection.tsx`: hook, barra,
checkbox e células), com piloto em Pedidos e Ordens de Produção. Nenhuma ação
em lote, nenhuma API nova, nenhuma migration.

**O cabeçalho marca a página; "todos os filtrados" é outro gesto.** Com 327
resultados e 20 à vista, o cabeçalho seleciona 20. Com a página inteira
marcada aparece "Selecionar todos os 327 resultados filtrados"; só esse clique
entra no modo `filtered`, que guarda filtro e exceções — desmarcar uma linha
ali vira `excludedIds` (326), remarcar tira da exceção. Nenhum id do filtro
inteiro é buscado: a tela continua pedindo só a página de 20.

**Contrato para BULK-DOCUMENTS-01.** `descriptor` é `{ mode: "ids", ids }` ou
`{ mode: "filtered", filters, excludedIds }`, com `filters` = o mesmo objeto da
consulta e do CSV; `null` sem seleção. Não conhece PDF. O schema do servidor
nasce com o primeiro endpoint que o receber.

**Regra escrita que mudou** (PRODUCT_RULES §5.11, UI_BRAND): a seleção deixou
de ser só da página — trocar de página preserva e o contador conta linhas de
outras páginas. Continua: trocar filtro limpa (comparação por valor, paginação
fora), nada vai para URL ou sessão, id estável, seleção não é mutação. Itens
segue com a seleção só de página. Gesto de seleção espera a consulta em
andamento (as linhas à vista podem ser do filtro anterior); `prune(ids)` fica
para a mutação na própria tela confirmada pelo servidor — recarregar não limpa.

**Próximo:** BULK-DOCUMENTS-01.

## A OP sem roteiro existe, mas não segue (PRODUCTION-ROUTE-ASSIGNMENT-01, 2026-09-12)

Decisão do PO: o Comercial não define como fabricar e o Pedido nunca para por
falta de roteiro — mas **sem roteiro a ordem não planeja, não programa e não
libera**. Regra durável em `PRODUCT_RULES.md` §89 e §91. Uma migration aditiva,
sem backfill: `20260925093024_production_route_application_source` (enum
`ProductionRouteApplicationSource`, `applicationSource` e `applicationReason`
na cópia do roteiro).

**Onde nasce o roteiro.** O padrão continua em
`Product.defaultProductionProfileVersionId`, agora também no cadastro do
Produto (seção "Roteiro padrão de produção", Produção e Administração, mesma
rota `PUT /products/:productId/production-profile`). Plano de Atendimento,
saldo e OP manual copiam o padrão compatível na criação
(`AUTO_PRODUCT_DEFAULT`); sem ele a OP nasce em rascunho sem cópia, e a
transação do Pedido não cai.

**Uma regra de compatibilidade, uma conversão.** `compatibilidadeDoRoteiro`
(shared) e `exigirRoteiroCompativel` (API, versão `FOR SHARE`) valem para o
padrão, para a escolha na ordem e para "definir padrão e aplicar". A quantidade
da OP é convertida para a unidade de referência (`converterQuantidadeDeUnidade`,
a mesma da Formulação) antes da conta: produto em kg com roteiro em g projetava
tempo mil vezes menor — mutação provada.

**Aplicar, escolher, trocar.** `POST /production-orders/:id/production-profile`
com a OP travada (`FOR UPDATE`): padrão atual (`PRODUCT_DEFAULT_APPLIED`), só
nesta OP (`MANUAL_ORDER`) ou padrão + aplicação na mesma transação
(`DEFAULT_AND_APPLIED`). Troca só em DRAFT e com motivo; programação gravada
sai junto, com confirmação. PLANNED/RELEASED sem cópia regularizam uma vez
(`LEGACY_REPAIR`, confirmação + motivo) e congelam; IN_PRODUCTION não recebe.
Tela velha e corrida viram 409, nunca 500.

**Portas.** `/plan` e `/release` recusam com `route_required`; programar recusa
com `order_without_route` antes de olhar o calendário. Criar, editar, aplicar,
planejar, liberar e cancelar pela porta direta da OP ficaram com Produção e
Administração (403 antes da validação); a OP que nasce do Pedido segue aberta
ao Comercial.

**Pendência derivada, nunca gravada** (`roteiroPendente`): filtro de roteiro na
lista de OPs (`semRoteiro` na URL, no CSV e na seleção em massa) com selo "Sem
roteiro"; "Pendências de planejamento" no quadro, com "Resolver" levando ao
bloco da própria OP; "OPs sem roteiro" no Dashboard; "Produção pendente de
roteiro." no Pedido. Na OP o bloco virou "Roteiro de produção — Pendente" ou
"Roteiro de produção aplicado".

**Validação.** Suítes afetadas de API, shared e web verdes; typecheck; smoke
real em 1440 e 390 (Pedido sem roteiro até planejar, padrão automático, padrão
novo não alcança OP antiga, troca com motivo, kg × g = 2 h, Comercial vê e leva
403), 31 conferências, console limpo, dados apagados. O smoke achou a lista do
seletor atrás do diálogo (60 × 101) — corrigido em `components.css`.

Achados sem correção: a tabela de "Documentos" alarga o modal do Produto em
390px (anterior à rodada); mudar a quantidade em DRAFT não refaz a programação
gravada (anterior — fechado em OP-SCHEDULE-STALE-ON-QUANTITY-01); picking, receita e apontamentos seguem sem `requireRole`;
cancelar a OP ainda grava `SYSTEM_ACTOR`; E2E do golden path e da busca de
produto ajustados (`scripts/e2e/lib/roteiro.mjs`) e não rodados.

**Próximo:** BULK-DOCUMENTS-01.

## Documentos da seleção (BULK-DOCUMENTS-01, 2026-09-12)

A seleção em massa ganhou as primeiras ações, só documentais, em Pedidos e
Ordens de Produção: **um PDF e um CSV com exatamente a seleção**. Nenhuma
mutação em lote, nenhuma migration. Regra durável em `PRODUCT_RULES.md` §5.11.

**O servidor resolve o conjunto.** `POST /customer-orders/bulk/documents` e
`…/bulk/export.csv` (idem em `/production-orders`) recebem o descritor: ids,
ou os filtros da listagem menos as exceções. Fundação pequena em
`apps/api/src/lib/bulk-selection.ts` (schema, recusas, resolução); os filtros
passam pelo schema da própria listagem, e campo desconhecido é recusado.
`whereDaListaDePedidos` e `whereDaListaDeOrdens` saíram do serviço: tela, CSV
e seleção usam o MESMO `where`, `semRoteiro` inclusive. Ordem da listagem
(código decrescente), também para ids. Filtrado é o filtro do momento da ação.

**Fail-closed.** Id escolhido que não existe recusa a geração inteira (404 com
amostra); conjunto vazio recusa; PDF acima de 500 recusa inteiro, nunca os
primeiros; CSV sem teto. Pedido e OP não têm regra real de elegibilidade de
documento (o botão "PDF" existe em qualquer status).

**PDF: o sistema de sempre, no navegador.** O repositório gera PDF no navegador
por desenho (`pdf/render.ts`: nenhuma URL de PDF no servidor); compor no
servidor exigiria portar o sistema. O servidor devolve o conjunto resolvido
(Pedido: o DTO do documento; OP: ordem e custo complementar) e `PdfBundle` põe
cada `CustomerOrderPdf`/`ProductionOrderPdf` num arquivo só — cabeçalho,
logo, rodapé e "Página X de Y" de cada documento (`subPageNumber`). O avulso
não mudou: o teste compara folha a folha.

**CSV: a exportação de sempre.** Colunas de `list-exports.ts` reusadas, UTF-8
com BOM. Nome pelo `Content-Disposition` (o CORS passou a expor o cabeçalho).

**Tela.** `BulkDocumentActions` na barra: "Baixar PDF" e "Exportar CSV"
secundárias, "Gerando PDF…"/"Gerando CSV…", clique duplo roda uma vez, "PDF
gerado."/"CSV exportado." ou alerta, seleção fica. Download por `fetch → blob`
(`lib/download-file.ts`, que o `downloadPdf` passou a usar).

**Validação.** API 20 testes novos e web 14 (mutação provada nos dois), gate API
95 e web 367, typecheck; smoke real em 1440 e 390 com 25 pedidos e 22 OPs
criados e apagados — ids, todos os filtrados menos 1, sem roteiro, um download
por clique, nome com o dia comercial, PDF válido (24 folhas; 42 para 21 OPs),
CSV com BOM, barra empilhada em 390 sem transbordo, console limpo.

Achados: PDF de 500 OPs no navegador não foi medido (render na thread
principal); o CSV da listagem continua `veridi_<slug>_<data UTC>.csv`, enquanto
o da seleção usa o dia comercial; com seleção, "Exportar CSV" aparece no
cabeçalho (lista inteira) e na barra (seleção).

**Próximo:** OP-SCHEDULE-STALE-ON-QUANTITY-01.

## Quantidade nova, programação nova (OP-SCHEDULE-STALE-ON-QUANTITY-01, 2026-09-12)

Bug de integridade fechado: a OP em rascunho mudava de 1.000 para 2.000 un e
mantinha a programação calculada para 1.000. Decisão do PO: **mudou a
quantidade, a programação antiga é invalidada e a pessoa programa de novo**.
Regra durável em `PRODUCT_RULES.md` §91. Sem migration, sem endpoint novo.

**Servidor.** O `PATCH /production-orders/:id` trava a OP (`FOR UPDATE`),
revalida a situação e compara a quantidade POR VALOR com a do banco. Mudou e
há programação: sem `confirmScheduleRemoval` é 409
`schedule_removal_needs_confirmation` (o mesmo código e a mesma flag da troca
de roteiro); com ela, quantidade, necessidades e remoção na mesma transação —
falha em qualquer ponto desfaz tudo. Roteiro aplicado fica. Do outro lado, a
gravação da agenda passou a conferir, com a OP travada, que a quantidade é a
da prévia (409 `quantity_changed`): a corrida inversa também não grava conta
velha.

**Tela.** "Salvar rascunho" com quantidade diferente e programação lida pelo
bloco do roteiro abre a confirmação ("Alterar quantidade e remover
programação"); a 409 que chegar mesmo assim abre a mesma. Cancelar mantém o
valor digitado e a pendência. Sucesso: "Quantidade atualizada. A programação
anterior foi removida e precisa ser refeita." ou "Ordem de produção
atualizada.", só com a resposta; o bloco relê a programação a cada gravação
da OP. A OP ganhou o padrão de estado da onda de feedback (nome da ação no
"Salvando…", "Alterações não salvas" antes da confirmação) — a parte dela em
SAVE-FEEDBACK-REMAINING-01.

**Validação.** API 13 testes novos (10 de contrato/atomicidade/concorrência,
3 de planejamento: 60 → 120 min, 2 kg → 5 kg = 300 min com almoço, corrida da
agenda) e web 10; mutação provada (4 na API, 6 na web). Gate: production-orders
165, schedules + GMP + calendário 81, shared 52, web OP/planejamento/unsaved
246, typecheck. Smoke real em 1440 e 390: 1000 un = 1 h, 409 sem confirmação,
pergunta sem PATCH, Cancelar mantém, confirmar remove, roteiro fica, quadro em
"sem programação", reprogramar = 2 h até 10:00, "2000,0" não pergunta; modal
em 390 empilhado sem transbordo; console limpo; massa e calendário apagados.

Achado: o `afterAll` de `production-calendar.test.ts` apaga o calendário do
`veridi_dev` — depois da suíte, smoke de programação precisa gravar a jornada
(foi o que este fez, e apagou no fim).

**Próximo:** REPORTS-PAGINATION-01.

## Próxima prioridade

A fila viva ficou congelada durante o FAST-DEVELOPMENT-RESET-02 e continua a
mesma. Os achados da rodada estão no BACKLOG, sem posição na fila.

**PRICING-TEMPLATE-FLEX-01 fechado em 2026-09-11** (§84). Três achados novos no
BACKLOG, sem posição na fila: PRICING-MODEL-VIEW-01, PRICING-MODEL-DIFF-01 e
PRICING-ACTIVATE-CONFIRM-01.

**Nenhum módulo é ocultado** — decisão da Veridi em 2026-09-10: Precificação,
Orçamento e Faturamento continuam disponíveis. Nenhum item do backlog propunha
ocultação.

**QUOTE-DUPLICATE-01 fechado em 2026-09-11** (§85). Dois achados novos no
BACKLOG, sem posição na fila: QUOTE-NEW-VERSION-PATHS-01 e
QUOTE-DUPLICATE-ORIGIN-01.

**CUSTOMER-COMMERCIAL-STATUS-01 fechado em 2026-09-11** (§86). Achados novos no
BACKLOG, sem posição na fila: CUSTOMER-LIST-DEFAULT-E2E-01 e
CUSTOMER-FACTS-LOAD-01. O terceiro, CUSTOMER-ACTIVITY-SCOPE-01, o PO respondeu
no mesmo dia, e a resposta entrou em §86: Pedido em rascunho e envio de
Orçamento não são atividade comercial — a situação mede o ciclo de oportunidade
e conversão, não o último contato. Nenhum runtime mudou.

**COST-BASELINE-01 absorvido em 2026-09-11, sem código.** O item pedia que
nascesse, para produtos reais, `IndustrialCostCalculation` →
`PricingVersion`/`PricingTier` → `QuoteLine` com CMV congelado, e já dizia que
o problema não era de código. Cada elo existe e está provado: fonte de custo
por §53 (`selectItemCostSource`), com oferta e referência manual nunca contadas
como compra real; matéria-prima e embalagem na mesma conta; componente sem
custo deixando o total "Indisponível", com o subtotal conhecido rotulado como
parcial (§5.12); material do Cliente fora da aquisição Veridi; e a linha do
Orçamento congelando no envio o CMV da faixa ativa da mesma quantidade,
inclusive a de preço herdado (§74). O golden path do FAST-DEVELOPMENT-RESET-02
atravessou essa cadeia pela interface numa base zerada. O que faltava era dado:
os números da auditoria (288 de 581 matérias-primas sem custo, 602 ofertas sem
vigência) eram do corpus que saiu de PROD no reset. Custo de produto real nasce
do que a Veridi lançar pela interface — compra, oferta com vigência, referência
manual —, e o sistema não faz escrita de massa.

**COST-RESOURCE-MULTIPLIER-01 fechado em 2026-09-11** (§87, seção própria
acima). **FORMULATION-ADJUSTMENTS-UX-01 fechado no mesmo dia** (§88), fora da
fila, por handoff do PO, e **NAVIGATION-SIDEBAR-01** também, com a passada de
acabamento NAV-PAGE-TITLES-01 + QUALITY-DOC-WRITE-01 (seção própria acima).
Próximo da fila viva: SUPPLIER-ADDRESS-01.

**COST-VAR-02** (comparação de CMV e proteção de margem) segue BLOQUEADO
aguardando as sete decisões do PO em
[`archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md);
o primeiro termo da comparação só existe quando houver, em produção, cálculo
salvo e Precificação ativa na quantidade do orçamento.

**PLAN-DATE-01** — usar as datas e quantidades das entregas programadas para
melhorar a Sugestão de Compra e a leitura da necessidade de produção. Registrado
no [`BACKLOG.md`](BACKLOG.md), **sem implementar**: exige decisão do PO e não
pode virar um segundo motor de reserva.

**Antes de qualquer PREC-UI:** o roadmap afirma que PREC-UI-05 e PREC-UI-06 "já
são o comportamento atual". F-08-1 provou que não — e FIX-01 corrigiu só o campo
com teto, não a exibição em geral.

**Gate paralelo:** validação com a Veridi para as regras que dependem do processo
real do cliente (#7, #11). Roteiro em
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).

## DEV

Banco local `veridi_dev`. Recriado pelo caminho oficial em 2026-09-11
(FAST-DEVELOPMENT-RESET-02) — `drop/create` + as 61 migrations + seed de
infraestrutura — **sem** o corpus da Veridi: as cargas grandes ficam para uma
rodada própria, decidida pelo PO. A 62ª migration (`customer_tax_profile`) e a
63ª (`pricing_template_flex`) entraram por `pnpm db:migrate`, e a 64ª
(`cost_resource_count`) e a 65ª (`user_preferences`) também. Contém só massa carimbada — o último golden path
e as E2E focadas.

Caminho canônico, nesta ordem (os passos 2 a 4 só quando o PO pedir a carga):

1. `pnpm exec dotenv -e .env -- node scripts/local-db-reset.mjs --confirmar` —
   no Git Bash. No PowerShell 5.1 o `--` é consumido, o `dotenv-cli` come o
   `--confirmar` e o script cai em simulação sem alterar nada
2. `pnpm veridi:import:validate` → `:plan` → `:apply -- --apply` → `:verify`
3. `pnpm veridi:market-reference -- --apply`
4. `pnpm veridi:examples -- --apply`

Nunca `db push`, nunca edição manual de `_prisma_migrations`. Runbook do
importador em [`VERIDI_MIGRATION.md`](VERIDI_MIGRATION.md). `pnpm test` escreve
no mesmo banco: rodar a suíte depois do reset avança a numeração (OP, lote,
expedição) antes de qualquer massa de rodada.

## Produção

Railway, deploy automático da `main`. **Zerada de negócio em 2026-09-11**
(FAST-DEVELOPMENT-RESET-02): só os 6 usuários, as sessões e o catálogo de
unidades; a numeração de negócio recomeça em 000001 e a da OP em 001. Nenhum
dado real subiu ainda. Implantação em [`DEPLOY.md`](DEPLOY.md); limpeza de
produção e prova de backup em `scripts/maintenance/`.

**Pacote de revisão da migração** (PROD-MASTER-MIGRATION-PACK-01,
2026-09-11): `scripts/veridi-migration-pack/` gera, do legado real, oito
planilhas para a Veridi revisar (fora do Git, em `handoff/`); nada foi
carregado. Depois de SUPPLIER-ADDRESS-01, regeneração curta do arquivo de
Fornecedores; a carga é PROD-MASTER-MIGRATION-APPLY-01. Runbook em
[`VERIDI_MIGRATION.md`](VERIDI_MIGRATION.md).

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
