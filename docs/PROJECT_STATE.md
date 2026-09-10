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

## Próxima prioridade

**QUOTE-INT-FIELDS-01** — primeiro da fila viva, promovido pelo PO em
2026-09-10 pela mesma prioridade de integridade: prazo, parcelas e intervalo
aceitam texto, e salvar pode APAGAR o valor gravado em silêncio. **Não
iniciado.**

**FORM-UOM-01** — logo depois. A Formulação real já oferece a unidade certa —
`<select>` filtrado pela dimensão do Item —; o que sobra é o **Modelo de
Formulação**, onde a unidade ainda é texto livre, e unidade é dado estrutural
que alimenta conversão, custo e produção. **Não iniciado.**

**QUOTE-DUPLICATE-01** — terceiro da fila, e o **gate de preço foi resolvido**
pelo PO em 2026-09-10: sem herança silenciosa de `unitPrice`, com escolha
explícita entre manter os preços da versão de origem e revisá-los, nenhuma
opção pré-marcada. O que sobra de trabalho é escolher a versão de ORIGEM
(hoje `createQuoteVersion` sempre parte da mais recente) e a confirmação que
apresenta a escolha. **Não iniciado.**

**COST-BASELINE-01** — prontidão real de custo e precificação. A auditoria
mostrou o problema de fundo: PROD não tem nenhum recebimento, nenhum
`IndustrialCostCalculation` e nenhuma `PricingVersion`, e por isso **nenhuma
`QuoteLine` tem CMV congelado**. Enquanto isso não existir, qualquer comparação
"custo do orçamento × custo de hoje" não tem o primeiro termo. Registrado no
[`BACKLOG.md`](BACKLOG.md), **sem implementar**.

**COST-VAR-02** (comparação de CMV e proteção de margem) segue BLOQUEADO
aguardando as sete decisões do PO em
[`archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md).

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
