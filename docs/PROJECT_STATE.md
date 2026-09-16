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
arredondado). Achados em [`archive/E2E_AUDIT_2026-09-07.md`](archive/E2E_AUDIT_2026-09-07.md): 22 no total, zero
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

[`BACKLOG.md`](BACKLOG.md) — **zero CRITICAL, zero BLOCKER**. A ordem vive só na fila viva de lá, reconciliada com o
estado real em 2026-09-15 (BACKLOG-RECONCILIATION-01). **`main` estável** em `0d81aae` (MAIN-STABILITY-FAST-GATE-01,
2026-09-15: MAIN_STABLE = YES); PROD em `release/prod` = `2400def`.

- **E2E:** WAVE 1–2 e WAVE 3 fechadas (merges `9c60845` e `6256ca9`); a próxima é a WAVE 4 (grupo C) e depois a WAVE 5
  (golden path);
- **discoveries persistidos** em [`discovery/`](discovery/README.md), `EM_ANALISE` e sem implementação: WAVE 4
  (E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01), golden path (WAVE-05-GOLDEN-PATH-DISCOVERY-01) e permissões da Produção
  (PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01); o do Painel Gerencial (FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01) está
  `IMPLEMENTADO`;
- **Inventário Físico:** discovery `DECIDIDO` (D1–D8 e P1–P7 fechadas pelo PO em 2026-09-15); Fatia 1 (domínio e API)
  entregue em 2026-09-15 (INVENTORY-PHYSICAL-COUNT-01); Fatia 2 (telas) e Fatia 3 (FO-01 de sessão e CSV) abertas;
- **Painel Gerencial:** entregue em 2026-09-15 — BILLED-VALUE-CANONICAL-01 (valor faturado = `Billing.totalAmount` em
  Painel, R-14 e R-15) e MANAGEMENT-DASHBOARD-V1-01 (Gestão → Painel Gerencial, D1–D5); G2, G5 e o G4 residual seguem sem
  posição;
- **Formulação — bancada:** EM HOMOLOGAÇÃO (FORMULATION-WORKBENCH-01, não fechada). O motor entrou em 2026-09-15: a
  versão guarda as premissas da apresentação (forma, apresentação, cápsulas por dose, dose e conteúdo do pó) como
  SNAPSHOT, e doses por embalagem virou resultado delas — cápsulas por embalagem ÷ cápsulas por dose, conteúdo ÷ dose,
  divisão que não fecha é recusada. Migration aditiva `20260925093028`. Os ajustes da homologação entraram no mesmo dia,
  **sem migration**: o painel "O que a quantidade informada significa" saiu da Formulação (segue no Modelo de
  Formulação, que não foi tocado) e **pureza** e **reserva de produção** — o antigo *overage*, em português — viraram
  COLUNAS da linha de matéria-prima. O contrato é um só: pureza informada corrige a quantidade física (alvo ÷ pureza/100,
  pelo mesmo motor de sempre) e a reserva fica registrada para o lote sem nunca multiplicar a dose. A forma do produto
  oferece só Pó e Cápsula — a forma de uma versão histórica continua na lista enquanto for a dela —, as colunas por
  cápsula só existem na cápsula, e o topo virou resumo de premissas em grade, com faixa etária, lote mínimo e caixa de
  embarque lidos do cadastro do Produto. Rascunho gravado sob o contrato antigo (pureza registrada sem autorizar a
  correção) entra corrigido e a tela DIZ quais linhas mudaram; versão ativa ou inativa entra como está gravada.
  A rodada final de UX (2026-09-15, migration aditiva `20260925093029`) fechou o refinamento: a UI diz **Pureza (%)** e
  **Reserva de matéria-prima (%)** — a palavra *overage* não aparece na tela —, a reserva continua POR LINHA, e a versão
  ganhou a premissa GLOBAL **Perda prevista de produção (%)** com o **Rendimento esperado** derivado (100 − perda) num
  bloco compacto "Premissas de produção", fora da grade. A perda não altera dose nem cápsula, não altera quantidade
  comercial nenhuma (guarda de alcance no repositório) e entra só no custo estimado interno: quantidade bruta = líquida ÷
  (1 − perda/100), aplicada pela base que a receita declara — `PER_DOSE`/`FIXED_BASIS` escalam, `PER_FINISHED_UNIT` não —
  com o custo unitário ainda dividido pela quantidade vendável. A grade ficou mais enxuta (resultado não parece campo,
  Base sai da linha quando não decide material) e passou a ter LARGURA DECLARADA pelo PO em `table-layout: fixed`,
  proporcional à área útil de 1.492px: composição 367/211/152/211/110/96/100/96/104/45 na cápsula — no pó os 96px de
  "Por cápsula" vão para o Ingrediente, que fica em 463 — e embalagem 879/216/204/134/59. A "Apresentação" virou
  **Apresentação comercial** com as opções coerentes com a Forma, e as frases fixas viraram ⓘ. A coluna da reserva
  ficou em **Reserva %**, com o significado no ⓘ, e o seletor de unidade da Embalagem saiu: a dimensão de contagem tem
  só `un` cadastrada, então a unidade vem do Item e o campo numérico ocupa a coluna inteira — o seletor por linha volta
  apenas quando o cadastro oferece mais de uma unidade compatível. Os campos da grade ganharam o desenho do campo do
  Ingrediente (altura, borda e canto), os dois percentuais alinham o valor à direita, e Pureza, Reserva e Perda
  prevista ganharam setas de passo dentro do campo — o passo é a ÚLTIMA CASA escrita (`1`→`2`, `1,1`→`1,2`), em
  aritmética inteira, parando onde a validação pararia. Larguras revistas pelo PO: Pureza e Alvo por dose usam a mesma
  da Reserva (96px em 1.492) e os 171px liberados foram para o Ingrediente (538 na cápsula, 634 no pó); a unidade do
  Alvo desceu para a segunda linha da célula, porque lado a lado sobravam 26px para o número. A linha do Ingrediente
  mostra o CÓDIGO LEGADO do Item (`Item.externalCode`) junto da unidade de estoque, quando existe
  ("Estoque em kg · Código legado: 1042"), e a referência de pureza do cadastro virou "Cadastro: 88,7%" — as duas
  linhas de apoio cabem numa linha só. A coluna do Alvo ficou em 156px para a unidade voltar ao lado da caixa, que
  mantém os 88px das demais. O bloco de premissas ganhou a SIMULAÇÃO: sobre um lote de referência de 1.000 unidades,
  quanto precisa entrar na produção para sair 1.000 vendáveis — com 4% de perda, 1.042 un, arredondado para cima em
  unidade contável. **Falta a avaliação
  visual do PO** — é dela que depende o fechamento;
- **LOW, UX, gates com a Veridi, melhorias aguardando o PO e watchlist:** seções A a E do BACKLOG, fora da fila.

Escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

**Fase atual: homologação/testes em fast development.** O bloco de go-live
([`BACKLOG_CLOSURE.md`](BACKLOG_CLOSURE.md)) permanece inativo até decisão explícita do PO.

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
impresso, na composição do cálculo, no CMV e no Modelo. Desde
COST-PRICING-CLARITY-WAVE-01 a linha se edita no lugar (tempo e quantidade).

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
- FO-03 ignora vencimento na coluna Qualidade (recorte `onlyPending` e corte
  em 100 fechados em FO03-PENDING-CUTOFF-01); FO-04 imprime reserva
  substituída e "Qtd. separar" é `quantity`, não o saldo.
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

Menu em Painel + nove seções na ordem do fluxo (Comercial, Produção,
Planejamento, Compras, Estoque, Qualidade, Cadastros e Configurações, Gestão,
Administração), com id estável por tela e por seção em `app/navigation.ts`.
Nenhuma rota mudou nem sumiu.

**NAVIGATION-INFORMATION-ARCHITECTURE-01 (2026-09-14):** Produção ficou só com
Ordens de Produção e Picking / Consumo. Cadastros (id `master-data`) virou
**Cadastros e Configurações**: Clientes, Fornecedores, Itens de estoque,
Produtos Acabados, Formulações, Modelos de Formulação, Recursos Industriais,
Modelos de Estrutura de Custo e Políticas de Precificação — o grupo "Modelos e
Parâmetros" deixou de existir. Gestão segue com Relatórios e Precificação. Ids
de tela e URLs intactos (favoritos e deep links valem; grupo aberto com o id
antigo é ignorado), então `/producao/formulacoes` acende Cadastros e
Configurações. "modelos e parâmetros" virou apelido de busca das quatro telas
que moravam lá; trilhas de criação dos cadastros e diálogos "Usar template"
citam a seção nova. O rótulo do menu seguiu "Modelos de Estrutura de Custo"
(o título da tela é o nome do menu). Para os rótulos longos caberem, a sidebar
passou de 236 para 312 px (`--sidebar-w`, ~2 cm, pedido do PO): coluna, espiada
do trilho, drawer do celular (`min(80vw, …)`) e modais de workspace seguem o token. Sidebar expandida ou compacta (trilho com um ícone por seção e
dica; o clique abre o menu por cima), seções recolhíveis — a da tela atual
abre sozinha, sem virar preferência —, ★ Favoritos acima das seções e "Buscar
telas…" no topo (Ctrl/Cmd+K, só navegação). No celular, drawer sempre
expandido.

Preferência do usuário (compacto, seções abertas, favoritos) em
`user_preferences`, 1:1 com `User`, JSON por seção (65ª migration), por
`GET/PATCH /me/preferences` — sempre do usuário da sessão. Grava sem botão,
com coalescência de 600 ms; falha de leitura ou gravação não trava o menu.

Decisões: **Produtos × Produto Acabado** são funções distintas — o cadastro
mestre é Cadastros e Configurações › Produtos Acabados (`/cadastros/produtos`); a lista dos
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

Achado sem correção na onda: Faturamento, Ordem de Produção, Ordem de Compra,
Expedição e Recebimento diziam "Salvando…" e não confirmavam o salvamento —
fechado em SAVE-FEEDBACK-REMAINING-01.

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
390px (anterior à rodada — fechado em MOBILE-UX-CLEANUP-WAVE-01); mudar a quantidade em DRAFT não refaz a programação
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

## Relatórios sem corte silencioso (REPORTS-PAGINATION-01, 2026-09-12)

Auditoria dos Relatórios (web e API) atrás de "primeiros N tratados como tudo".
**O read model já estava certo:** os serviços de relatório paginam no banco (ou
fatiam depois de montar o conjunto inteiro), com `total` de `count` no mesmo
`where`; o resumo do R-15 cobre o filtro inteiro; CSV e PDF pedem `ALL_ROWS`.
**O corte estava nos seletores das telas:** R-06 carregava 100 OPs, R-14 100
Pedidos, e os filtros de Cliente (R-12, R-13, R-15, R-16, R-17) e de Fornecedor
(R-08 a R-11) mil cadastros, num `<select>`. Da OP ou Pedido 101 e do cadastro
1001 em diante o registro existia e não era escolhível, sem aviso.

Os cinco passaram à foundation dos filtros: `EntityFilterSelect` com
`clienteFilterSource`, `fornecedorFilterSource`, `pedidoFilterSource` e a nova
`ordemDeProducaoFilterSource` (primeira página de 20, busca no servidor por
código ou produto, `porId` pela própria OP). Filtros, período, status, "trocar
filtro volta à página 1" e o recorte do CSV não mudaram. Como nas listagens, a
busca alcança cadastro inativo e a primeira página mostra só ativos; o rótulo
visível virou rótulo acessível + placeholder ("Todos os clientes", "Selecione a
OP…"). Nenhuma mudança de API, nenhuma migration.

**Validação.** Web 24 testes novos (`pages/reports/relatorios-sem-corte.test.tsx`:
registro fora da primeira página alcançado, consulta com o filtro na página 1,
CSV, resumo do servidor, estado vazio, guarda estrutural, 390px; mutação: as
telas antigas derrubam 15). API 5 (`modules/reports/reports-sem-corte.test.ts`:
137 pedidos, 137 OPs, 137 faturamentos com resumo R$ 1.370,00 estável entre
páginas, borda do dia comercial, 1.005 pedidos e 1.005 clientes; mutação: resumo
com `take: 100` e `ALL_ROWS` com teto 1000 falham). Gate web 288 (relacionados) e
147 (relatório, PDF, impressão, 390px), API 40, typecheck. Smoke com banco e
portas isolados, 1440 e 390: 31/31, console limpo, fixtures apagadas.

Achados: o seletor escolhido corta o rótulo em 240px com o "✕" por cima (visual
da foundation, igual nas listagens — fechado em MOBILE-UX-CLEANUP-WAVE-01); relatórios não guardam filtro na URL
(padrão atual mantido); na troca de filtro a tabela anterior fica visível com
"Carregando…" (`useReport`); o resumo do R-15 lê as linhas de todos os
faturamentos filtrados em memória — correto, candidato a agregação no banco se o
volume crescer.

**Próximo:** RECEIVING-OPEN-PO-CUTOFF-01.

## Receber OC sem corte silencioso (RECEIVING-OPEN-PO-CUTOFF-01, 2026-09-12)

O seletor de `ReceivePurchaseOrderPage.tsx` pedia `status=ORDERED` e
`status=PARTIALLY_RECEIVED` com `pageSize: 100` e somava as duas listas num
`<select>`: da 101ª OC de cada status em diante a ordem estava aberta, o servidor
aceitaria o recebimento, e a tela não a oferecia. As duas listas só alimentavam o
seletor — linhas, saldo e validação já vinham de `GET /purchase-orders/:id`.

`GET /purchase-orders` ganhou `receivable=true`: a fila de OCs que podem receber
agora, com o conjunto de `STATUS_QUE_RECEBEM`
(`modules/purchase-orders/purchase-order-receivable.ts`) — a MESMA constante que
`createReceipt` passou a usar nas duas travas de status (antes e sob lock). Regra
inalterada: `ORDERED` e `PARTIALLY_RECEIVED`; com `status` junto vale a
interseção; `false`/ausente não restringe. A tela não escreve status nenhum: o
seletor virou `EntityFilterSelect` com `ordemDeCompraParaReceberSource`
(`filter-sources.ts`) — primeira página de 20, busca no servidor por código da OC
ou fornecedor (snapshot `supplierName`), status como dica ("Recebido
parcialmente"). `?purchaseOrderId=` continua abrindo a OC pelo id, sem lista.
Erro ao carregar a OC escolhida agora aparece no seletor. Sem migration.

**Validação.** API 8 testes (`modules/purchase-orders/receber-oc-sem-corte.test.ts`:
210 OCs abertas montadas para que as duas listas de 100 percam a OC #150, a 101ª
parcial e a OC do fornecedor B; fila completa por páginas; busca por código e
fornecedor; parcial com saldo real até fechar; finalizada, cancelada e rascunho
fora; fila × recebimento status por status). Mutação: sem o filtro, 5 caem. Web
12 (`pages/receiving/receber-oc-sem-corte.test.tsx`, servidor falso que pagina 213
OCs; mutação: a tela antiga derruba 11, `buscar` sem `receivable` derruba 7). Gate
web 200 (Recebimento, OC, filtros, relatórios, 390px), API 105, typecheck. Smoke
na 3333/5173 com 130 OCs abertas, 1440 e 390: busca, seleção, fornecedor, linha,
saldo 10/4/6, rede só `receivable` com `pageSize=20`, console limpo, massa apagada.

Achados, sem correção: Receber material do cliente carrega itens com
`listItems({ pageSize: 1000 })` (`ReceiveCustomerMaterialPage.tsx`); o botão
"Receber materiais" da OC ainda decide por status no front
(`PurchaseOrderPage.tsx`, `isReceivable`); `?purchaseOrderId=` de OC cancelada ou
rascunho abre o formulário e só o servidor recusa ao confirmar (anterior); sem OC
aberta, a lista diz "Nada disponível para escolher." no lugar da frase própria.

**Próximo:** a definir pelo PO — da auditoria de filtros sobra FO-03
(`OperationalSheets.tsx`; fechado depois em FO03-PENDING-CUTOFF-01).

## Relatórios no dia da Veridi (REPORTS-BUSINESS-DATE-01, 2026-09-12)

Oito telas de relatório (R-02 personalizado, R-03, R-05, R-07, R-08, R-09, R-12,
R-15) mandavam o período como `new Date(dia + "T00:00:00").toISOString()` e
`...T23:59:59.999`: a meia-noite do NAVEGADOR. A mesma escolha de 12/09 era um
recorte em UTC (trazia a noite de 11/09 de São Paulo e perdia a de 12/09), outro
em UTC-07 e outro em São Paulo — e CSV e PDF, que levam os mesmos filtros,
erravam junto. O mesmo gesto tinha mais três efeitos: o R-02 personalizado
comparava esses instantes com a validade (marcador de meia-noite UTC) e errava o
dia inteiro até em São Paulo; campo de data limpo derrubava a tela
(`RangeError: Invalid time value`); e o nome do CSV saía com o dia seguinte no fim.

**Contrato.** `from`/`to` dos relatórios viraram DIA (`diaCivilDeFiltroSchema`;
instante ISO é recusado com 400, não reinterpretado) — o contrato das listas. O
serviço abre o dia uma vez, em `modules/reports/report-period.ts`, pela espécie
da coluna: `intervaloDeDiasComerciais` para instante (`issuedAt`, `occurredAt`,
`receivedAt`, `consumedAt`, `completedAt`/`createdAt`, `CustomerOrder.orderDate`,
`quoteDate`) e `intervaloDeDiasCivis` para marcador (`PurchaseOrder.orderDate`,
como a lista de OCs; `Lot.expiryDate`), sempre com fim exclusivo. A janela
inicial dos campos nasce em `hojeComercial` (`pages/reports/report-period.ts`),
não no dia do navegador. Quais dias entram, filtros, KPIs, ordenação e layout não
mudaram; o PDF lê o CSV com os mesmos parâmetros. Nenhuma migration.

**Validação.** API 27 testes novos (`reports-dia-comercial.test.ts`: bordas do dia
comercial com a virada das 01:30 UTC no R-12 e no R-05, marcadores no R-08 e no
R-02, intervalo início/fim sem off-by-one, ponta aberta, CSV com o mesmo recorte e
o nome com os dias pedidos, instante e formato inválido recusados nas 11 rotas e
nos 11 CSV, guarda estrutural; mutação: espécies trocadas e fim inclusivo derrubam
os 4 de borda). Web 19 (`relatorios-dia-comercial.test.tsx`: tela, CSV e PDF com o
mesmo dia em UTC, UTC-07 e São Paulo nas oito telas, janela padrão às 01:30 UTC,
campo limpo, guarda estrutural; mutação: a tela antiga do R-15 derruba 4) e 1 no
PDF (`report-content.test.tsx`). Smoke com banco e portas isolados, Chromium com
`timezoneId`: 61/61.

Achados (não corrigidos, fora do escopo): no R-20, `status`, cliente e período
escrevem a mesma chave `quoteVersion` no `where` e só o último vale (corrigido em
R20-QUOTE-FILTER-COMPOSITION-01, abaixo);
`QuoteVersion.quoteDate` é coluna mista (a tela grava instante, o importador grava
`entryDate`); OCs antigas com `orderDate` em instante seguem sem backfill; mudar o
período não volta à página 1 (corrigido em REPORTS-PAGE-RESET-ON-PERIOD-01,
abaixo); o R-15 vazio mostra "Valores incompletos"; o
Dashboard ainda semeia o período personalizado com o dia do navegador
(corrigido em DASHBOARD-BUSINESS-DATE-01, abaixo); o nome de
CSV sem período usa o dia UTC do servidor. Aba aberta antes do deploy recebe 400
nos relatórios até recarregar.

## R-20 combina todos os filtros (R20-QUOTE-FILTER-COMPOSITION-01, 2026-09-12)

No `where` do R-20, status, cliente e período eram três chaves `quoteVersion` no
mesmo objeto, e a última apagava as anteriores: cliente + status trazia todos os
status do cliente, e qualquer combinação com período virava o período inteiro, de
todos os clientes e status. JSON, contagem, CSV e PDF erravam juntos (mesmo
serviço). A tela do R-20 só oferece busca e origem do preço; cliente, status e
período chegam pela API, pelo CSV e pela rota de impressão.

O `where` sai de `quotePricingAuditWhere` (`cost-reports.service.ts`): UMA
condição `quoteVersion` com status, `project.customerId` e `quoteDate` pelo
`periodoDeInstante` da REPORTS-BUSINESS-DATE-01 (dia comercial, fim exclusivo),
com origem do preço e busca em AND. Página e contagem usam o mesmo objeto.
Semântica do status, associação cliente → projeto da versão e tipo de data não
mudaram. Sem migration.

**Validação.** API 15 testes (`r20-filtros-compostos.test.ts`: 9 orçamentos em que
cada vizinho erra um dos três filtros; sem filtro, cada filtro sozinho, as quatro
combinações e variações, bordas do dia comercial dentro da combinação, mesmo dia,
origem + busca, JSON = contagem = CSV, paginação; mutação: o `where` antigo derruba
9). Web 1 (tela, CSV e PDF com o mesmo objeto de filtros) e 1 no PDF (os três
filtros chegam juntos ao CSV do papel). Gate API 121, web 84, typecheck. Smoke com
banco e portas isolados: 11/11, console limpo.

Achados (sem correção): **o CSV do R-20 não exige perfil** — a rota JSON responde
403 a PRODUCTION, `.../quote-pricing/export.csv` responde 200 com custo e margem, e
a rota de impressão lê esse CSV; a tela não oferece cliente, status nem período; o
papel imprime o id do cliente no filtro "Cliente"; um orçamento com vários produtos
repete a `key` da linha da tabela (`quoteVersionId`).

## Receber material do cliente sem corte silencioso (CUSTOMER-MATERIAL-ITEM-CUTOFF-01, 2026-09-12)

O seletor de item de `ReceiveCustomerMaterialPage.tsx` pedia
`listItems({ type: "RAW_MATERIAL", active: true, pageSize: 1000 })` e o mesmo para
`PACKAGING`, e somava as duas listas num `<select>`: do item 1001 de cada tipo em
diante o material existia, o servidor aceitaria o recebimento, e a tela não o
oferecia.

`GET /items` ganhou `customerSupplied=true`: só item que pode entrar como material
do cliente, com o conjunto de `TIPOS_DE_MATERIAL_DO_CLIENTE`
(`modules/items/item-customer-supplied.ts`) — a MESMA constante que
`createCustomerSuppliedReceipt` passou a usar na trava de tipo. Regra inalterada:
matéria-prima e embalagem; com `type` junto vale a interseção; `false`/ausente não
restringe. A tela não escreve tipo: cada linha virou `EntityFilterSelect` com
`itemMaterialDoClienteSource` (`filter-sources.ts`) — primeira página de 20, pedida
uma vez para todas as linhas; busca no servidor por código ou nome; `porId` por
`ids` com os mesmos filtros. Unidade e controle de lote da linha vêm do item que o
servidor devolveu. Inativo continua fora do seletor (a tela manda `active=true`,
como antes); linha de rascunho restaurado cujo item deixou de poder entrar é
desfeita com aviso. Item sem controle de lote segue oferecido, com a orientação na
linha, e recusado ao gravar (anterior).

Dono: Item não tem proprietário no modelo — dono é o `Lot` (`ownerCustomerId`),
gravado pelo servidor com o cliente do recebimento. O seletor não depende de
cliente, e o isolamento não mudou. Sem migration.

**Validação.** API 12 testes (`modules/receiving/material-do-cliente-sem-corte.test.ts`:
1000 matérias-primas ativas com código menor que o do alvo; lista antiga de 1000
sem o #1001; primeira página de 20 com total acima de 1000; fila elegível completa
por páginas; busca por código e por nome; `ids`; interseção com `type`; inativo;
seletor × recebimento tipo por tipo; sem lote; recebimento do #1001 com quantidade,
unidade, lote, dono, movimento e rastreio; Clientes A e B com o mesmo item e o
mesmo lote do fabricante, cada um só vê o seu). Mutação: sem o filtro, 5 caem;
trava de tipo divergente, 1. Web 13 (`pages/receiving/material-do-cliente-sem-corte.test.tsx`,
servidor falso com 1005 itens; mutação: source sem `customerSupplied` derruba 11;
sem desfazer o item inelegível, 1; sem memorizar a primeira página, 1). Gate: API
101 (itens, recebimento, dono), web 105 (Recebimento, criação no contexto,
relatórios), typecheck. Smoke com banco e portas isolados, 1440 e 390, 1004 itens:
#1001 por código e por nome, acabado e inativo fora, recebimentos de A e B com o
mesmo lote do fabricante e cada dono só com o seu, rede só `customerSupplied` com
`pageSize=20`, 390 sem overflow aberto/busca/selecionado, console limpo — 38/38,
massa apagada.

Achados, sem correção: `POST /receipts/customer-supplied` NÃO recusa item inativo
(só a tela o esconde, antes e agora — corrigido em CUSTOMER-MATERIAL-INACTIVE-GATE-01,
abaixo); em 1440 a tabela de linhas ainda rola 28 px
dentro do contêiner (antes 484 px, com o `<select>` de 696 px — fechado em
MOBILE-UX-CLEANUP-WAVE-01); seguem com
`pageSize: 1000` em seletor, fora deste escopo, `CustomerMaterialsPage`,
`ProjectsPage`, `ProductsPage`, `BillingsPage`, `SupplierItemsPage`,
`CustomerOrderPage` e `ProjectProductsSection` — fechados em
SELECTOR-CUTOFF-WAVE-01, abaixo.

## Formato de saída não é permissão (R20-EXPORT-AUTHORIZATION-01, 2026-09-13)

P0. O R-20 (custo e margem por proposta) recusava PRODUCTION com 403 em JSON,
mas `GET /reports/commercial/quote-pricing/export.csv` respondia 200 com os mesmos
dados — e o PDF do R-20 é gerado a partir desse CSV. Causa: o dispatcher de CSV
(`exports.routes.ts`) só validava o filtro; a permissão existia apenas, escrita à
mão, na rota JSON.

**Regra.** Autorização é do relatório, não do formato: tela, JSON, CSV e o PDF que
lê o CSV respondem aos mesmos perfis. A autoridade do R-20 é UMA,
`PRICING_PROVENANCE_ROLES` (`@veridi/shared`, COMMERCIAL e ADMIN — a regra da
proveniência econômica, §5.11): a rota JSON aplica, a definição do CSV declara
(`roles`, conferido pelo dispatcher antes do filtro, com o 403 padrão
`{ error: "forbidden", message }`), e `canSeePricingProvenance` passou a ler a
mesma lista. A tela usa a lista só para não oferecer o recusado: o catálogo não
lista o R-20, a tela não consulta nem mostra CSV/PDF, a impressão não pede o CSV.
Conteúdo do relatório inalterado. Sem migration.

**Auditoria.** Todas as 20 listas e os R-01 a R-19 com CSV têm a rota JSON aberta
a qualquer perfil (sem bypass por formato); o R-20 era o único relatório com perfil.
Seleção em massa (`/bulk/…`) segue aberta como as listas.

**Validação.** API 9 testes (`modules/reports/r20-autorizacao.test.ts`: seis perfis ×
JSON, CSV e o CSV com a paginação que o PDF manda; 403 padrão sem dado no corpo;
perfil antes da validação; guarda genérica — para toda exportação e todo perfil,
JSON 403 ⇒ CSV 403; mutação: sem `roles` no CSV caem 6). Web 16
(`r20-autorizacao.test.tsx`: tela e catálogo nos seis perfis; `report-content`:
impressão recusada sem pedir o CSV, e gerada para COMMERCIAL; mutação: a UI antiga
derruba 12). Gate API 162, web 121, shared 29, typecheck. Smoke com banco e portas
isolados: ADMIN e COMMERCIAL abrem, baixam CSV e geram PDF; PRODUCTION e VIEWER
levam 403 em JSON, CSV e no CSV do PDF, sem R-20 no catálogo, tela e impressão
bloqueadas sem requisição — 26/26, console limpo.

Achado, sem correção (decisão de perfil): **R-19 mostra margem e markup a todos** —
PRODUCTION leva 403 em `/pricing-versions` (COMMERCIAL, PURCHASING e ADMIN) e 200
no R-19 em JSON e CSV. Não é bypass por formato; é o relatório mais aberto que a
origem. (Corrigido em R19-REPORT-AUTHORIZATION-01, abaixo.)

## R-19 é da proveniência econômica (R19-REPORT-AUTHORIZATION-01, 2026-09-13)

P0, decisão de PO: o R-19 (faixas ativas com margem de contribuição e markup)
usa a mesma autoridade do R-20, `PRICING_PROVENANCE_ROLES` (COMMERCIAL e ADMIN;
constante inalterada). Antes o R-19 respondia 200 em JSON, CSV e PDF a qualquer
perfil. Agora: o `register` dos relatórios aceita `roles` (conferido antes do filtro,
403 padrão) e o R-19 os declara; o CSV declara os mesmos `roles` pelo mecanismo da
R20-EXPORT-AUTHORIZATION-01; o catálogo, a tela (componente `ReportForbidden`) e a
impressão usam a mesma lista e não fazem requisição para perfil negado. PURCHASING
continua lendo `/pricing-versions`, mas não o R-19 — é o que a constante diz.
Conteúdo, fórmulas e R-20 sem mudança. Sem migration.

**Guarda automática estendida.** Além de "JSON 403 ⇒ CSV 403", toda exportação que
declara `roles` exige a rota JSON restrita aos MESMOS perfis — proteger só o arquivo
deixaria a tela aberta.

**R-18 (não alterado).** Mostra o último cálculo de custo industrial salvo por
produto: estrutura ativa, CALC, datas, qualidade, base, custo total, subtotal
conhecido, custo por unidade e por 1.000 — sem preço, margem ou markup. Origens
(`/products/:id/cost-calculations`, `/industrial-cost-calculations/:id`,
`/industrial-costs/:id`, `/products/:id/industrial-costs`) e o R-18 em JSON, CSV,
PDF e catálogo são abertos a qualquer perfil autenticado; o PDF sai marcado como
documento interno.

**Validação.** API: matriz dos seis perfis × JSON, CSV e CSV do PDF com precificação
ativa real (`pricing.test.ts`, "perfil × formato") e a guarda nos dois sentidos
(`r20-autorizacao.test.ts`); mutação: tirar `roles` do JSON ou do CSV derruba 3.
Web: tela e catálogo nos seis perfis (`r19-autorizacao.test.tsx`), impressão negada
em quatro perfis e gerada para COMMERCIAL e ADMIN (`report-content.test.tsx`);
mutação: a UI da main derruba 12. Gate API 188, web 139, shared 29, typecheck.
Smoke com banco e portas isolados e precificação ativa criada pela API: COMMERCIAL
vê, abre com margem e markup, baixa CSV e gera PDF; PRODUCTION leva 403 em JSON, CSV
e CSV do PDF, sem R-19 no catálogo, URL direta e impressão bloqueadas sem requisição
— 13/13, console limpo.

## Material do cliente exige Item ativo (CUSTOMER-MATERIAL-INACTIVE-GATE-01, 2026-09-13)

A tela do Receber material do cliente só oferece item ativo, mas
`POST /receipts/customer-supplied` aceitava item inativo chamado direto. Decisão de
PO: item inativo não recebe material novo, e o servidor é a autoridade. A checagem
acontece na chamada (estado de agora, antes de qualquer escrita) e de novo dentro
da transação, com `SELECT … FOR SHARE` nos itens — o mesmo "antes e sob trava" da
OC no recebimento de compra —, então uma inativação em curso é esperada e
respeitada. Recusa 400 `item_inactive`, "O item … está inativo e não pode receber
novo material."; nada é escrito (recebimento, linha, lote, movimento). Cliente
ativo, tipos por `TIPOS_DE_MATERIAL_DO_CLIENTE`, controle de lote, dono no lote e o
rascunho restaurado ficam como estavam. A tela já mostrava a mensagem da API; em
390px ela ficava fora da vista depois de confirmar, e agora é trazida para a vista
(o padrão da Ficha de Pesagem). Sem migration.

**Validação.** API 8 testes (`modules/receiving/material-do-cliente-item-inativo.test.ts`:
ativo recebe com lote do cliente; chamada direta com inativo; o mesmo item antes e
depois de inativar; embalagem inativa; linha inativa derruba o recebimento inteiro;
produto acabado e item sem lote como antes; corrida seletor → inativação → POST; e
inativação em curso durante o POST, com a transação parada na trava; mutação: sem a
checagem sob trava cai só a corrida em curso, sem nenhuma checagem caem 6). Web 2
(seletor sem inativo; recusa pelo cliente de API real com mensagem, foco, formulário
preservado e sem sucesso; mutação: engolir o erro derruba 1). Gate API 129, web 82,
typecheck. Smoke com banco e portas isolados: ativo recebe; inativado depois de
escolhido é recusado em 390px com o alerta à vista, sem estouro e sem linha, lote ou
movimento; inativo fora da busca — 10/10 (o único registro de console é o próprio
navegador anotando a resposta 400 esperada).

## Painel no dia da Veridi (DASHBOARD-BUSINESS-DATE-01, 2026-09-13)

O "Personalizado" do Painel nascia com o dia do NAVEGADOR (`dateInputValueOffset`):
às 01:30 UTC — 22:30 de 12/09 em São Paulo — um navegador em UTC abria os campos
terminando em 13/09. A faixa "No período" formatava os limites devolvidos no fuso do
navegador: o mesmo 12/09 aparecia "12/09 até 13/09" em UTC e "11/09 até 12/09" em
UTC-07. E o período viajava como instantes ISO montados na tela.

**Contrato.** `GET /dashboard` recebe `from`/`to` como DIA (`diaCivilDeFiltroSchema`;
instante ISO e formato inválido recusados com 400) — o contrato das listas e dos
Relatórios. O schema abre o dia uma vez, por `limitesDoDiaComercial` (começo e fim
inclusivo): o serviço segue com a mesma janela `gte`/`lte` e o mesmo eco
`period.from`/`period.to`. Ponta vazia ou ausente é hoje comercial, como antes. Na
tela, `lib/period.ts` resolve Hoje, 7 dias, 30 dias e Personalizado por
`resolveListPeriod` (os presets das listas, sem regra nova); os campos nascem em
`hojeComercial`; a faixa usa `formatEventDate`. `startOfDay`, `endOfDay`,
`toDateInputValue` e `dateInputValueOffset` saíram de `lib/period.ts` (só o Painel os
usava). KPIs, opções de período, gráfico e layout sem mudança; nenhuma persistência
nova; sem migration.

**Validação.** Web 8 (`dashboard-dia-comercial.test.tsx`: presets e personalizado com
o mesmo par de dias em UTC, UTC-07 e São Paulo às 01:30 UTC, mesmo dia, intervalo,
campo limpo, faixa, guarda estrutural; o código antigo derruba 7). API 6
(`dashboard-dia-comercial.test.ts`: hoje às 01:30 UTC com a máquina nos três fusos,
bordas do dia numa coluna de instante, intervalo, ISO recusado, ponta vazia; o schema
antigo derruba 6) e `dashboard.test.ts` passando a mandar dia. Smoke com banco e
portas isolados, Chromium com `timezoneId` e relógio fixo em 2026-09-13T01:30Z nos
três fusos: request, eco, faixa, "Pedidos criados" e KPIs idênticos, campo limpo sem
erro, console limpo; 390px sem overflow.

Achados (não corrigidos, fora do escopo): o gráfico de movimentações agrupa pelo dia
UTC (`occurredAt.toISOString().slice(0, 10)`), e o movimento das 22:30 de São Paulo
cai na barra do dia seguinte (corrigido em DASHBOARD-MOVEMENT-BUSINESS-DAY-01, abaixo);
"Atrasadas" de Compras (estado atual e atenção) compara
o marcador de `expectedDeliveryDate` com o instante de agora, e a OC prevista para
12/09 conta como atrasada desde 21h de 11/09 em São Paulo (corrigido em
PURCHASE-OVERDUE-CIVIL-DATE-01, abaixo). Aba aberta antes do deploy
recebe 400 no Painel até recarregar.

## Barra do gráfico no dia comercial (DASHBOARD-MOVEMENT-BUSINESS-DAY-01, 2026-09-13)

O gráfico "Movimentações por dia" agrupava `occurredAt` pelo dia UTC
(`toISOString().slice(0, 10)`): o movimento das 22:30 de São Paulo (01:30 UTC) caía
na barra do dia seguinte, e o período 12/09 → 12/09 desenhava uma barra 13/09. A
chave da barra agora é `diaCivil(occurredAt, FUSO_COMERCIAL)` (`@veridi/shared`),
em `buildMovementActivity`. Ordem, contagens, tipos, rótulos, dias sem movimento
(sem barra) e o período `from`/`to` em dia não mudaram; KPIs e tela intocados; sem
migration.

**Validação.** API 4 novos em `dashboard-dia-comercial.test.ts` (bordas 00:00,
23:59:59.999, instante anterior e seguinte num dia histórico sorteado; 01:30 UTC na
barra do próprio dia com o processo em UTC, UTC-07 e São Paulo; série somada igual ao
resumo; dia vazio sem barra; guarda contra o slice UTC; o serviço antigo derruba os
4). Smoke com banco e portas isolados, cinco movimentos de 11/09 23:59 a 13/09 00:00
(São Paulo) e Chromium em UTC, UTC-07 e São Paulo: API e barras da tela idênticas
(11/09, 12/09 com três segmentos, 13/09), console limpo.

Achado (fechado em PERFORMANCE-CLEANUP-WAVE-01): `diaCivil` monta um `Intl.DateTimeFormat` por chamada, ~54 µs
na máquina do laboratório — 10 mil movimentos na janela somam ~0,5 s ao Painel; um
formatador reaproveitado custa ~3 µs.

## OC atrasada no dia civil (PURCHASE-OVERDUE-CIVIL-DATE-01, 2026-09-13)

`expectedDeliveryDate` é data civil (a tela grava a meia-noite UTC do dia escolhido),
mas os três lugares que dizem "OC atrasada" a comparavam com o relógio: o contador
"Atrasadas" do Estado atual (`getOpenPurchaseOrderState`), a lista de atenção
(`PURCHASE_ORDER_LATE`) e o R-11 (tela, CSV e impressão). A OC prevista para 12/09
ficava atrasada desde 21h de 11/09 em São Paulo, e o R-11 a mostrava com "0 dias".

**Regra.** Atrasada quando o dia previsto já acabou no dia comercial: durante o dia
12 inteiro, até 23:59:59.999 de São Paulo, não está; a partir de 13/09 00:00 está, se
ainda aberta. Contador e R-11 usam `venceuEm`; a atenção filtra por
`marcadorDeHojeComercial` (a fronteira que já servia ao vencimento de lote); o
`daysLate` do R-11 é `diasCivisAte` com sinal trocado (1 no dia seguinte, nunca 0).
Status elegíveis sem mudança — ORDERED/PARTIALLY_RECEIVED com saldo aberto; RECEIVED,
CANCELLED e DRAFT seguem fora. `buildAttentionList` e `getLatePurchaseOrdersReport`
ganharam `now` opcional (padrão: agora). Sem migration, sem backfill; prazo, status e
Movimentações do Painel intocados.

**Validação.** API 3 (`dashboard/compras-atrasadas-dia-civil.test.ts`: OCs prevista
12/09, prevista 11/09, parcial, recebida, cancelada e rascunho em nove instantes de
11/09 12:00 a 13/09 12:00 de São Paulo, com a máquina em UTC, UTC-07 e São Paulo;
contador medido com e sem as OCs do teste no mesmo retrato REPEATABLE READ, desfeito
no fim; contador = lista = R-11 em cada borda; o código antigo derruba os três já em
11/09 12:00). Focados verdes (Painel serial e dia comercial, validade em uso, OCs,
Relatórios, exportações, dia civil, fuso) e typecheck. Smoke HTTP com banco e porta
isolados, relógio real: prevista hoje fora; prevista ontem no contador (+1), na
atenção, no R-11 com 1 dia e no CSV.

## Mudar o recorte volta à página 1 (REPORTS-PAGE-RESET-ON-PERIOD-01, 2026-09-13)

Nas oito telas de relatório com período (R-02 personalizado, R-03, R-05, R-07, R-08,
R-09, R-12, R-15), De e até mudavam o filtro e mantinham a página: quem estava na
página 6 e encurtava o período pedia a página 6 do universo novo e via a tabela
vazia ("Nenhum … no período") com registros no servidor. Cliente, fornecedor,
status, tipo, origem, janela e busca já voltavam à página 1; as outras dez telas
paginadas não têm período.

O reinício entrou no próprio evento do campo (`setPage(1)` junto de
`setFrom`/`setTo`), o padrão que os demais filtros das telas já usavam: as duas
atualizações saem num render só, e a primeira consulta do recorte novo já é a da
página 1 — sem efeito observando filtro, sem consulta da página antiga nem
repetida. Anterior/Próxima só mudam a página. "Incluir custo de material" (R-05)
não muda o universo e mantém a página. Datas seguem `YYYY-MM-DD`
(REPORTS-BUSINESS-DATE-01); CSV e PDF continuam sem página (`ALL_ROWS`); API,
layout e fórmulas intocados; sem migration.

**Validação.** Web 10 novos (`pages/reports/relatorios-pagina-ao-filtrar.test.tsx`:
nas oito telas, página 6 → De → página 1 do universo novo, até → 1, outro filtro →
1, Anterior/Próxima sem reinício, exatamente uma consulta por gesto, CSV sem
página; R-05 com custo mantém a página; guarda que amarra todo campo de data dos
Relatórios à lista do teste; o código antigo derruba as oito com "Página 6 de 2").
Focados (Relatórios, PDF de relatório, período) 140 verdes e typecheck. Smoke
390px com banco e portas isolados no R-03: 22/22, uma consulta por gesto, sem
rolagem horizontal, console limpo.

Achado que continua (fora do escopo): na troca de filtro a tabela anterior fica
visível com "Carregando…" até a resposta (`useReport`, já anotado em
REPORTS-PAGINATION-01).

## Um instante por requisição do Painel (DASHBOARD-CONSISTENT-NOW-01, 2026-09-13)

`GET /dashboard` lia o relógio em quatro pontos do mesmo retrato: o "hoje" da ponta
ausente do período (no parse), o estado atual (`buildCurrentState`: lotes
vencidos/perto e OCs atrasadas), a lista de atenção (`buildAttentionList` sem `now`)
e a disponibilidade da falta de material (`getAvailableByItems`, um relógio por lote,
chamada pelo contador e pela atenção). Na virada do dia comercial, contador e lista
podiam descrever dias diferentes.

**Regra.** A rota captura `now` uma vez e o entrega a `dashboardQuerySchemaEm(now)` (o
schema virou fábrica) e a `getDashboard(query, now)`; `buildCurrentState` e
`getProductionOrdersWithShortage` exigem `now`; `getAvailableByItems` ganhou `agora`
opcional (padrão: agora, um instante para a chamada inteira — os outros chamadores não
mudam). Dia comercial/civil, vencimento, atraso e período com a mesma semântica; tela
intocada; sem migration.

**Validação.** API 2 novos na faixa serial (`dashboard.test.ts`): dia sorteado de 2031
em diante, lote que vence na véspera (única fonte de uma OP em rascunho) e OC prevista
para a véspera, em véspera 12:00, 23:59:59.999, dia 00:00 e 12:00 de São Paulo —
contador e lista de atenção somam o mesmo em cada instante (perto, vencido, atrasada,
falta), total da atenção e período sem filtro no mesmo dia; guarda estrutural (a rota
lê o relógio uma vez; schema, serviço e consultas não leem). Atenção sem `now`,
contador com relógio próprio e disponibilidade sem `agora` derrubam o teste. De
passagem: `lib/dia-comercial-em-uso.test.ts` ainda mandava instante ISO, recusado desde
DASHBOARD-BUSINESS-DATE-01 — falhava no `origin/main`; agora manda dias.

## Período invertido do Painel é recusa (DASHBOARD-INVERTED-PERIOD-01, 2026-09-13)

`GET /dashboard` completava a ponta vazia com hoje comercial e não comparava as pontas:
"De" vazio com "Até" no passado virava `from` hoje e `to` no passado, e a janela
`gte`/`lte` invertida respondia 200 com todos os KPIs em zero. O mesmo com "De" depois de
"Até" e com "De" no futuro e "Até" vazio.

**Regra.** Ponta vazia continua hoje comercial (contrato de DASHBOARD-BUSINESS-DATE-01);
completada, `from` depois de `to` é 400 `validation_error` com a ponta e a frase — "A
data inicial não pode ser posterior à data final." (as duas preenchidas), "Sem data
inicial, o período começa hoje — a data final não pode ser anterior a hoje." e "Sem data
final, o período termina hoje — a data inicial não pode ser posterior a hoje.". Regra
única em `@veridi/shared` (`recusaDoPeriodoDoPainel`): o schema recusa (servidor é a
autoridade) e `lib/period.ts` usa a mesma para a tela não pedir o período recusado — a
frase fica junto dos campos (`role=alert`, `aria-invalid`), "No período" e
"Movimentações" saem, "Precisa de atenção" e "Operação atual" ficam. Recusa que ainda
venha do servidor chega à faixa com a frase dele (`apiErrorMessage`). KPIs, gráfico,
presets, fuso e Relatórios intocados; sem migration.

**Validação.** API 11 (`dashboard-periodo-invertido.test.ts`: schema com `now` injetado
nos casos, 01:30 UTC com a máquina em UTC, UTC-07 e São Paulo, rota direta com dia
histórico que tem pedido; o schema antigo derruba 8). Web 9
(`dashboard-periodo-invertido.test.tsx`: casos, nenhum pedido na recusa, blocos do
período fora, corrigir volta a consultar, três fusos às 01:30 UTC, frase do servidor).
14 mutações (tela, regra e schema) derrubam teste. Smoke com banco e portas isolados:
tela e API diretas nos oito casos, console limpo, 390px sem overflow com a frase à vista.

Achado: listas e Relatórios com as duas pontas invertidas respondiam 200 vazio
(`intervaloDeDiasComerciais` não compara; visto em
`/billings?dateFrom=2026-09-13&dateTo=2026-09-12` e
`/reports/inventory/movements?from=2026-09-13&to=2026-09-12`) — fechado em
PERIOD-RANGE-VALIDATION-WAVE-01.

## Gravou? Todas as telas respondem (SAVE-FEEDBACK-REMAINING-01, 2026-09-13)

Fecha o achado do UX-ACTIONS-FEEDBACK-WAVE-02: telas que diziam "Salvando…" e
voltavam ao normal sem confirmar. Só estado de interface — status, lifecycle,
permissão, cálculo, API e migration intocados.

**Faturamento, OC e Expedição.** O `saving` único virou o nome da ação em curso,
como no Pedido; o freio de clique duplo continua um só. "Salvando…" só no botão de
salvar; "Emitindo…", "Confirmando…" e "Cancelando…" no botão da própria ação.
Frases só com a resposta: "Rascunho salvo." (Faturamento, OC), "Previsão e
observações salvas." (OC fora do rascunho) e "Separação salva.". Emitir, confirmar
e cancelar não ganham frase — selo e tela somente leitura já dizem — e apagam a
anterior. Na OC a faixa lê a pendência da guarda antes da frase. Faturamento e
Expedição não têm guarda, e não ganharam uma: a frase sai na próxima edição
(preço, referência, quantidade, notas) ou ação (alterar preço acordado, conferir
lote). Recusa: `role="alert"` com a mensagem da API, como já era.

**Recebimento.** "Salvar custo" já tinha estado próprio; ganhou "Custo salvo." na
célula de ação da linha que gravou, embaixo do botão (a coluna fixa não alarga),
até alguma linha voltar a ser editada. Receber OC e Material do Cliente terminam
navegando ao recebimento: intocados.

**OP.** Feedback já vinha de OP-SCHEDULE-STALE-ON-QUANTITY-01. "Salvar rascunho" e
"Salvar observações" agora só habilitam com a pendência da guarda. Os dois testes
que salvavam sem alteração foram reescritos: um prova "sucesso só com a resposta"
desfazendo a edição durante a requisição; o outro, que a mesma quantidade escrita
de outro jeito não é pendência.

**Validação.** Web: 33 testes novos, 2 reescritos; 11 mutações (frase antes do
`await` nas cinco telas, rótulo pelo `saving`, frase que ignora a pendência, edição
e conferência que não limpam, OP sem a trava) — as 11 derrubam teste. Gate: pastas
das cinco telas, guarda, UX operacional, 390px e as páginas que as renderizam (44
arquivos, 462 testes) e typecheck. Smoke Playwright 1440 e 390: OC recebida, OP
liberada e custo de recebimento gravando de verdade, com retrato e restauro por
Prisma conferidos; Faturamento e Expedição em rascunho simulados por interceptação
(nada gravado); 400 controlado na OC com a mensagem na tela e a pendência mantida;
sem overflow, coluna fixa do Recebimento com a mesma largura; console limpo fora a
linha do Chromium do 400 controlado.

Achados no BACKLOG, P3: SAVE-ENABLED-NO-DIRTY-01, BILLING-SHIPMENT-UNSAVED-GUARD-01
e SAVE-THEN-COMMIT-STALE-01 — os três fechados em SAVE-FLOW-HARDENING-01.

## O teste devolve o calendário (TEST-ISOLATION-CALENDAR-01, 2026-09-13)

Os testes da API rodam no banco da `.env`. `production-calendar.test.ts` apagava
o Calendário de Produção no `beforeAll` e no `afterAll`, com as exceções de 2031;
`production-schedules.test.ts` regravava a semana e apagava as exceções de 2033.
Depois da faixa serial o `veridi_dev` ficava sem jornada, e toda prévia de
programação recusava.

**Regra.** Teste que usa o calendário o empresta:
`test-support/calendario-de-producao.ts` guarda, antes de qualquer escrita, as
linhas inteiras do calendário, dos dias e das exceções do ano reservado; no
`afterAll` tira o que ficou, regrava essas linhas numa transação (tipo da própria
tabela: mesmos ids, horários, autores e datas) e relê — divergência derruba a
suíte. Calendário ausente continua ausente; exceção de outro ano não é tocada.
Singleton, jornada, exceções e migrations intocados; os dois arquivos seguem na
faixa serial, porque o calendário é do arquivo enquanto ele roda. Limite: processo
morto no meio não chega ao `afterAll`. O `veridi_dev` segue sem calendário,
apagado por rodadas antigas — a suíte não o recria.

**Validação.** Banco isolado com sentinela (calendário legado, sete dias com datas
próprias, exceções em 2031, 2033 e 2027, duas nas datas dos testes): o código
antigo apagou calendário, dias e três exceções; o novo deixou tudo idêntico coluna
a coluna em duas execuções seguidas (64/64), com falha no meio dos dois arquivos,
com `--bail=1` em cada um, com `beforeAll` falhando depois de apagar, e sem
calendário prévio (nada fica). Devolução sem as exceções (mutação) derrubada pela
releitura. Typecheck.

## R-20: uma chave por linha e o cliente pelo nome no PDF (R20-UX-CLEANUP-WAVE-01, 2026-09-13)

Dois achados de UX do R-20, fast.

**Chave da linha.** O R-20 tem uma linha por linha de orçamento, e a tela usava
`quoteVersionId` como chave da `<tr>`: numa versão com vários produtos a chave
repetia, o React avisava e, ao trocar o recorte, a tabela mostrava linha
duplicada (reproduzido: cinco linhas para quatro). O DTO ganhou `quoteLineId`
(`QuoteLine.id`), e é a chave da tela. `quoteVersionId + productCode` não serve: o
código sai do snapshot, e a unicidade do banco é `(quoteVersionId, productId)`.

**Cliente no PDF.** A impressão dos relatórios escrevia o `?customerId=` cru em
"Filtros aplicados" — o UUID. `ReportPrintPage` resolve o id pelo `porId` do
`clienteFilterSource` (uma consulta por carga, só com filtro de cliente, depois da
checagem de perfil) e escreve `código · razão social`, como o seletor da tela. Sem
nome (id legado, consulta recusada) o campo sai "—", e o documento sai. Vale para
todo relatório impresso por essa página com `customerId` (R-12, R-13, R-15 a R-17
e R-20).

Perfis (`PRICING_PROVENANCE_ROLES`), autorização de JSON, CSV e PDF, catálogo,
custo, margem, fórmulas, filtros, paginação e colunas do CSV sem mudança. Sem
migration.

**Validação.** Reprodução antes do fix: aviso `same key` e linha duplicada na tela;
PDF com o UUID e com o id legado. API 3 (`r20-linha-por-produto.test.ts`: versão com
três produtos, identidade por linha, ordem, paginação, CSV com as mesmas colunas e
sem id) + 93 focados (R-20, pricing, exportações, dia comercial) + integração R-20;
web 161 focados (relatórios, impressão, PDF). Typecheck. Smoke com banco e portas
isolados: tela sem aviso de chave e sem duplicar ao trocar o recorte; PDF com
`CLI-… · razão social`, "—" para id legado, nenhuma consulta de cliente sem
filtro — 18/18, console limpo.

Achados, sem correção: no papel, `supplierId` (R-08 a R-11) ainda sai como UUID, e
status/tipo saem como código de enum (`SENT`, `RAW_MATERIAL`).

## Limpeza pequena de UX (SMALL-UX-CLEANUP-WAVE-01, 2026-09-13)

Quatro achados já conhecidos, só na tela. Sem API, sem migration, sem fórmula.

**R-15 sem documento.** Recorte sem faturamento emitido mostrava "Valores
incompletos" e "0 de 0": o servidor manda `totalAmount: null` quando não há
documento (o total exige TODOS completos) e a tela lia isso como preço faltando.
Com `billingCount` 0 o resumo não aparece e a tabela diz "Nenhum faturamento para
os filtros informados." (curta de propósito: célula de relatório não quebra
linha, e a frase longa sumia sob a rolagem em 390px). Documento sem preço segue
"Valores incompletos" com "N de M".

**R-11.** "1 dia" / "2 dias" / "0 dias", no ternário local que o produto já usa —
não havia helper de plural.

**CSV da seleção.** Com seleção, cabeçalho e barra tinham dois "Exportar CSV". O
da barra (`BulkDocumentActions`, Pedidos e OP) virou "Exportar selecionados em
CSV"; o do cabeçalho segue "Exportar CSV", lista filtrada inteira. Descritor,
`excludedIds`, CSV do servidor e limites intocados.

**Relatórios com filtro novo.** `useReport` guardava a resposta anterior até a nova
chegar — tabela, resumo e paginação do recorte velho debaixo de "Carregando…".
Agora a resposta só aparece para o mesmo recorte (filtros sem `page`/`pageSize`):
filtro novo esconde o anterior até a resposta; Anterior/Próxima mantêm a página
aberta até a próxima chegar. `loading` é derivado no render (chave da última
resposta ≠ chave atual), sem quadro intermediário, e a tabela não mostra a frase
de vazio durante a carga (contexto do `ReportPage`, `aria-busy`). Vale para os
vinte relatórios, inclusive R-06/R-14 (outra OP/pedido não mostra a genealogia
anterior). Página 1 e uma consulta por gesto (REPORTS-PAGE-RESET-ON-PERIOD-01)
mantidas.

**Validação.** Web: 2 arquivos novos (8 testes) e 1 teste novo em Pedidos; 7
mutações, todas derrubadas; focados 191/191 (relatórios, seleção em massa, CSV das
listas, conteúdo do PDF de relatório); typecheck. Smoke real (web do worktree
contra a API dev, respostas sintéticas por `route.fulfill`, nada gravado) em 1440
e 390: 36/36 cada — zero documentos pela API, uma consulta por gesto na página 1,
busca/De sem nada do recorte anterior durante 1,5 s de atraso, Próxima mantendo a
página, R-11 numa linha, barra da seleção sem transbordo (ids e 327 filtrados),
CSV da barra = cabeçalho + 2 selecionados e CSV do cabeçalho = 12 da lista,
console limpo.

**Achados.** Mesmo plural fixo em R-16 ("Aguardando há 1 dias") e R-02 ("Vence em
1 dias"); Painel mostra "Valores incompletos · 0 de 0 documentos" sem faturamento
no período (Dashboard fora do escopo); a busca dos relatórios consulta a cada tecla
e agora esvazia a tabela até cada resposta; erro de consulta mostra o alerta junto
da frase de vazio da tabela; célula de relatório é `nowrap`, então frase de vazio
acima de ~50 caracteres fica no limite de 390px (a maior hoje tem 52; não medida).

## Seletores sem corte silencioso (SELECTOR-CUTOFF-WAVE-01, 2026-09-13)

Os sete seletores que CUSTOMER-MATERIAL-ITEM-CUTOFF-01 deixou com catálogo de 1000,
e dois do mesmo padrão achados na varredura (Amostras com 100; `porId` do
Planejamento nos 20 primeiros), passaram à busca no servidor. Nenhum `pageSize`
de três dígitos do web era exportação ou cálculo; os tetos de 100 que sobram são
listagem ou contexto pequeno (BACKLOG W8). Sem API nova, sem migration.

**Filtros de listagem → `EntityFilterSelect`, universo de antes.** Projetos,
Amostras e Materiais de Clientes: `clienteAtivoFilterSource`; Item × Fornecedor:
`fornecedorAtivoFilterSource` — primeira página e busca só entre ativos, e `porId`
por `ids` dá nome ao id já aplicado (link, filtro lembrado), ativo ou não.
Produtos e Faturamento: `clienteFilterSource` (busca em todos, como a lista de
1000). O chip do Faturamento nomeia pelo `onResolve` — fora das 1000 mostrava o id.

**Formulários → `SearchableEntitySelect` com `onSearch`** (precisam de "+ Novo",
obrigatório ou rótulo visível). Nova relação Item × Fornecedor: a listagem passa
20 ativos, o campo busca ativos e resolve o escolhido que chega de fora (cadastro
no contexto, rascunho) por `ids` + `active`, como o Item do mesmo formulário.
Vincular produto ao projeto: 20 do cliente do projeto, busca sempre com
`customerId`, vinculado continua fora, escolhido fora da página volta por
`productId`. Sugestão de Compra do Pedido: o `<select>` "Homologados" + "Demais
fornecedores ativos" virou combobox por linha — homologados primeiro, com a dica
"Homologado"; 20 ativos uma vez para a seção; busca de ativos somada aos
homologados que casam; a página entra sem substituir. Quantidade recomendada,
reserva e geração intocadas.

**Validação.** Web: 5 arquivos novos com servidor falso honesto de 1002 registros
(primeira página sem o #1001; busca, escolha e uso/gravação; recarregar pelo id
sem busca; universo ativo/todos; exclusões do vínculo; guarda estrutural) e o
chip do Faturamento ajustado. 19 mutações, todas derrubadas. Gate: 79 arquivos,
934 testes, e typecheck. Smoke Playwright no `veridi_dev` com massa temporária
(1002 clientes, 1002 fornecedores, 1001 produtos de um cliente; alvos na posição
1086, 1117 e 1001): seis filtros, relação gravada com o fornecedor #1001, produto
#1001 vinculado ao PROJ-000007 e visto após recarregar, Planejamento pelo id;
Pedido com status e sugestão simulados por interceptação (o dev não tem pedido em
atendimento), POST capturado com o #1001, nada gravado; 390px nos três
formulários e num filtro sem transbordo; console limpo fora o 400 de
`reservation-status` que a simulação provoca; massa apagada.

Achado: Item × Fornecedor pede a primeira página de fornecedores duas vezes
(barra e formulário) — fechado, junto do `porId` duplicado, em PERFORMANCE-CLEANUP-WAVE-01.

## Um retrato do banco por requisição do Painel (DASHBOARD-SNAPSHOT-CONSISTENCY-01, 2026-09-13)

Depois de DASHBOARD-CONSISTENT-NOW-01 o relógio era um só, mas o banco não: cada
consulta de `getDashboard` saía do pool por conta própria e via o instante em que
rodou. Escrita no meio da montagem partia a resposta — lote desbloqueado contado no
estado atual e ausente da lista de atenção. E `getProductionOrdersWithIncompleteCost`
recebia o `prisma` do retrato, mas resolvia o custo por
`findProductionOrderMaterialCost`, que lia pelo `getPrisma()` global.

**Regra.** `getDashboard` monta período, estado atual, movimentos e atenção numa
transação interativa `RepeatableRead` (`maxWait` 10 s, o `pool_timeout` do Prisma;
`timeout` 30 s): no PostgreSQL toda leitura dela vê o retrato da primeira. Só SELECT —
nenhuma trava além da de qualquer leitura, nenhuma falha de serialização.
`findProductionOrderMaterialCost(id, prisma = getPrisma())` usa o contexto recebido, e
o Painel passa o da transação; Produtos Acabados, relatórios de produção, documentos da
seleção e o custo da OP seguem no global, sem mudança. Mesmo `now`, KPIs, fórmulas,
períodos, dia comercial, movimentos e regras da atenção; sem migration.

**Custo.** Transação é uma conexão: o `Promise.all` interno vira fila. Massa no banco
isolado (200 OPs concluídas sem custo com 2 consumos cada, 300 lotes-problema, 100 OCs,
60 OPs com falta, 30 pedidos): rota via `inject` de ~2,1 s para ~3,3 s (hoje) e ~2,1 s
para ~3,7 s (365 dias); cinco requisições simultâneas ~9,5 s cada antes e ~9,2 s depois
(o gargalo é o processo, não o pool). 5.270 SQL por requisição, quase todas do custo
incompleto.

**Validação.** `dashboard-retrato-unico.test.ts` (faixa serial): extensão de consulta no
cliente da aplicação segura por promise a lista de lotes da atenção e as OPs do custo
depois que o contador de lotes bloqueados leu; outra conexão desbloqueia o lote e informa
o custo do lote consumido; a resposta montada no meio é a de antes (contador, lista,
custo e o resto do DTO fora os movimentos recentes), e a seguinte difere em exatamente 1
lote bloqueado e 1 OP com custo incompleto, no contador e na atenção. Quatro mutações
derrubam: sem transação (contador 101 × lista 100), custo sem o `prisma` na chamada,
`ReadCommitted` e custo voltando ao global dentro da função. Sem escrita, serviço antigo e
novo devolvem o mesmo DTO em quatro períodos. Smoke no servidor real com a massa: 200 em
sequência e em 5 paralelas com respostas iguais; período invertido segue 400.

Achado (fechado em PERFORMANCE-CLEANUP-WAVE-01, abaixo): estado atual e atenção calculam duas vezes o
custo incompleto, a falta de material e os pedidos aguardando expedição. No mesmo
retrato o resultado é idêntico — resolver uma vez cortaria perto de metade das SQL em
fila. Com latência de rede entre API e banco, cada 1 ms por SQL soma ~5 s nessa massa.

## Salvar só com pendência, e a gravação vale por si (SAVE-FLOW-HARDENING-01, 2026-09-13)

Fecha os três achados de SAVE-FEEDBACK-REMAINING-01. Só estado de tela: API,
domínio, status, cálculo e migration intocados, e nenhum endpoint composto.

**Pedido e OC.** "Salvar rascunho", "Salvar prazo e observações" e "Salvar
previsão e observações" só acordam com a pendência que a guarda já calculava — a
mesma variável prende a saída, acende a faixa e habilita o botão. No documento
novo também: sem cliente ou fornecedor não há o que validar, e a primeira escolha
acorda o botão (não é a exceção da Formulação). Recusa mantém a pendência.

**Faturamento e Expedição sob a guarda.** Assinatura do que o salvar envia,
normalizada por `lib/dirty-fields.ts`, com a referência zerada em toda leitura do
servidor. Faturamento: referência externa, notas e preço das linhas sem preço
acordado (a acordada muda por "Alterar preço de faturamento", que grava na hora).
Expedição: notas e uma quantidade por lote reservado na forma do payload — vazio é
zero, e o reservado exibido em seis casas é o reservado inteiro; o lote lido para
conferir fica fora. Faixa "Alterações não salvas" e botão de salvar leem a mesma
pendência, como na OC e na OP; a edição deixou de apagar a frase à mão — a
pendência toma o lugar dela. `UI_BRAND.md` perdeu a exceção "tela sem guarda".

**Gravar antes de agir.** Emitir o Faturamento, confirmar e conferir na Expedição
seguem em duas chamadas; a tela relê a resposta da gravação antes da segunda (e
cada conferência de um lote em várias linhas). Recusada a segunda, fica o gravado
— preço e subtotal, linhas recriadas e entregas repartidas, conferência já feita
— com o erro na tela, sem pendência e sem frase de sucesso.

**Validação.** Web: 2 arquivos novos (21 testes, `fetch` falso com 409/500 pelo
cliente HTTP real), 10 testes novos em Pedido e OC e 20 ajustados (os que salvavam
sem alteração passaram a editar antes; "só com a resposta" provado desfazendo a
edição durante a requisição e depois da recusa). 23 mutações, todas derrubadas.
Gate focado: 66 arquivos (as quatro telas, Recebimento, guarda e suas waves,
feedback, telas que as renderizam) e typecheck. Smoke Playwright 1440 e 390 (web
do worktree contra a API dev, 74/74): Pedido PED-000002 e OC-001153 reais sem
gravar; Faturamento e Expedição simulados em rascunho com gravação 200 e ação 409
por interceptação; pergunta ao sair pela trilha, descanso ao desfazer, tela com o
gravado depois da recusa, sem transbordo, nenhuma escrita real, console limpo fora
os 409 simulados.

Achado no BACKLOG, P3: CONFIRM-DISCARDS-DIRTY-01.

## A suíte da API tem banco próprio (TEST-SUPPORT-ISOLATION-WAVE-01, 2026-09-13)

Os testes da API rodavam no banco da `DATABASE_URL` — no DEV, o `veridi_dev`. A
faixa serial dependia de guardar e devolver o Calendário, um kill antes do
`afterAll` deixava o DEV alterado, e o `buildTestApp` tinha deixado lá 683
usuários `USR-TEST-*` e 808 sessões.

**Regra.** A suíte escreve só em banco de teste: `TEST_DATABASE_URL` (contrato
de CI) ou, sem ela, `<banco da DATABASE_URL>_test` no mesmo servidor, criado e
migrado pelo `globalSetup`. Destino que não se prova de teste — nome sem a
palavra `test`, marca de produção, host gerenciado, o mesmo banco da
`DATABASE_URL`, credencial de produção no ambiente — recusa antes de qualquer
teste, no config, no `globalSetup` e em cada worker
(`test-support/banco-de-teste.ts`). Usuário e sessão do `buildTestApp` saem no
fim do arquivo que os criou: o `afterAll` do setup de arquivo roda depois dos do
próprio arquivo (`test-support/usuarios-de-teste.ts`); o que um kill deixou, a
rodada seguinte varre. A devolução do calendário continua, como defesa a mais.
Contrato em `TECH_BASELINE.md`; domínio, Calendário, auth e migrations
intocados.

**Validação.** `.env` do worktree apontando para um banco que NÃO existe
(canário): 13 arquivos — 11 paralelos, calendário e agenda na faixa serial, 251
testes — duas vezes seguidas; `users`, `user_sessions` e calendário 0 → 0, e na
segunda nenhuma tabela mudou de contagem. Kill forçado da árvore no meio do
calendário: o banco de teste ficou sem o calendário sentinela e com 1 usuário e
1 sessão; a rodada seguinte varreu e passou 64/64. Seis destinos proibidos
saíram com exit 1 e zero teste; 12 mutações derrubadas. Com a `.env` do checkout
principal (`veridi_dev`), a suíte criou e migrou `veridi_dev_test` sozinha e as
mesmas duas rodadas deram o mesmo resultado. No `veridi_dev`, nenhuma conexão
das rodadas (`pg_stat_database.sessions` parado em cada janela) e contadores de
escrita por tabela idênticos antes e depois.

**Fora do escopo.** A suíte de scripts ficou no banco da `.env` até
TEST-SCRIPTS-DB-ISOLATION-01 (seção seguinte), e os usuários de teste antigos
continuam no `veridi_dev` (TEST-USERS-LEGACY-RESIDUE-01).

## A suíte de scripts também escreve só em banco de teste (TEST-SCRIPTS-DB-ISOLATION-01, 2026-09-13)

A faixa de scripts da raiz (`vitest.scripts.config.ts`, último passo do `pnpm
test`) ainda entregava aos workers a `DATABASE_URL` da `.env`: com o corpus
presente, `importer.test.ts` gravava o master data no `veridi_dev`. Reproduzido
num banco descartável no lugar dele: 5.952 linhas em 13 tabelas numa rodada.

**Regra.** A mesma foundation, sem segunda solução: o config monta o ambiente
por `ambienteComBancoDeTeste` e usa o `globalSetup` e o `setupFiles` da API — o
corpus mora no mesmo banco de teste da API. O `globalSetup` acha a pasta da API
pelo próprio arquivo (a faixa tem a raiz do monorepo como `root`). Sem banco que
se prove de teste, nenhum arquivo da faixa roda, nem os puros do
`@veridi/shared`. `test-support/faixas-de-teste.test.ts` lê o `test` real da
raiz e dos pacotes que o `pnpm -r` alcança e reprova config de Vitest não
classificada: isolada pela foundation, ou de pacote sem client de banco (a web).
Importador, master data, domínio, auth e migrations intocados.

**Validação.** Config antiga contra banco descartável na `DATABASE_URL`: 13
tabelas de 0 a 5.952 linhas. Config nova, mesma `DATABASE_URL`: esse banco
idêntico (77 tabelas, contagem + md5 + contadores de escrita) e o `_test`
derivado criado, migrado e com as mesmas 5.952 linhas. Com a `.env` do checkout
principal (`veridi_dev`) e `TEST_DATABASE_URL` exclusivo, a faixa inteira duas
vezes seguidas — 24 arquivos, 405 testes, verdes: `veridi_dev` idêntico nas 77
tabelas, `pg_stat_database.sessions` parado em cada janela e nenhuma conexão
nova nele; no banco de teste, as mesmas contagens da primeira para a segunda.
Oito destinos proibidos saíram com exit 1 e zero teste; sem a camada do config
o `globalSetup` recusa, sem ele o `setupFiles` recusa nos 24 arquivos; 9
mutações do teste das faixas derrubadas. Onze arquivos comuns da API e o painel
da faixa serial passaram no banco de teste já com o corpus.

**Fora do escopo.** A massa antiga do `veridi_dev` — usuários `USR-TEST-*`,
sessões, bancos `veridi_apply_check_*` — fica para FRESH-DATA-E2E-BASELINE-01.

## Três transbordos conhecidos (MOBILE-UX-CLEANUP-WAVE-01, 2026-09-13)

Os três achados seguiam vivos na main (reproduzidos no Chromium em 390×844 e
1440×900 antes de mexer). Só CSS e uma classe; sem API, sem migration.

**Modal de workspace.** A coluna do formulário era `max-width: 880px` com trilha
`auto`, que cresce até o conteúdo mínimo do item sem olhar a tela: a tabela de
Documentos levava o modal do Produto a rolar 203px de lado em 390px, com toda
seção cortada — e o mesmo no Fornecedor (543px) e no Item (363px), e em 1024
(209px e 29px). Agora `width: min-content`, `min-width: min(880px, 100%)`,
`max-width: 100%` e trilha `minmax(auto, 100%)`: o máximo em porcentagem prende
o mínimo automático do item à coluna, e a tabela rola dentro do
`.table-container`. Em 1280 e 1440 as larguras são as de antes — 880px, e 964px
no Fornecedor, cuja tabela cabe inteira —, agora centradas (em 1280 o
Fornecedor passava 35px do corpo).

**Seletor por entidade.** O ✕ é absoluto sobre o campo e o padding direito era o
de campo sem botão: o nome escolhido corria 14px por baixo dele, cortado seco,
nas onze telas medidas. `.entity-select:has(.entity-select__clear) input`
reserva 36px, o campo termina em reticências e o ✕ passou de 19×21 a 28×28, com
anel de foco. Vale para `EntityFilterSelect` e `SearchableEntitySelect`; largura
do controle (240px, linha inteira em 390px), rótulo acessível, Tab até o ✕ e
limpar sem mudança. Contrato de SELECTOR-CUTOFF-WAVE-01 intocado.

**Receber material do cliente.** Em 1440 a tabela de linhas rolava 28px vazia,
45px com item e 324px com o aviso de item sem lote, e o ✕ de remover saía da
vista. `.table--customer-material-lines`: quantidade em 7,5rem, lote do
fabricante e localização a 100% da coluna (mínimo 6rem), cabeçalho e aviso
quebrando linha — 0px em 1440 e 1280. Em 390px segue rolando dentro do
contêiner (535px), por desenho; a lista de Materiais de Clientes rola por dentro
(140px em 1440) como toda listagem, sem transbordo de página.

**Validação.** Web: 4 arquivos novos (22 testes); 9 mutações, todas derrubadas.
Gate: 61 arquivos, 676 testes (componentes, Produtos, Recebimento, Estoque,
Faturamento, cadastros com modal, filtros, relatórios sem corte, criação no
contexto, guarda) e typecheck. Smoke Playwright (web do worktree contra a API
dev, nada gravado), antes na main e depois no worktree, em 390 e 1440: documento
sem rolagem lateral em todas as telas; corpo dos sete modais com 0px (também em
1024 e 1280); seletor com 0px sob o ✕ em onze telas, limpando por Tab + Enter e
pela borda do ✕; linhas do material do cliente com 0px também em 1280; console
limpo.

## Período invertido de listas e Relatórios é recusa (PERIOD-RANGE-VALIDATION-WAVE-01, 2026-09-13)

Fecha o achado do DASHBOARD-INVERTED-PERIOD-01: fora do Painel, as duas pontas
invertidas respondiam 200 vazio, lido como "nada no período".

**Regra (decisão do PO).** As duas datas preenchidas e a inicial depois da final
é intervalo inválido: 400 `validation_error` na ponta inicial, "A data inicial não
pode ser posterior à data final.". Nenhuma ponta, só a inicial, só a final,
inicial antes e o mesmo dia consultam, e a ponta vazia é ABERTA — completar com
hoje continua só no Painel. Primitiva única em `@veridi/shared`
(`period-range.ts`: `recusaDoPeriodo`, `MENSAGEM_DE_PERIODO_INVERTIDO`);
`recusaDoPeriodoDoPainel` a usa depois de completar as pontas, sem mudar o Painel.

**Servidor.** `recusarPeriodoInvertido(de, ate)` (`lib/date-schema.ts`) em
`.superRefine` de: Faturamento, Recebimentos, OC e Produto Acabado
(`dateFrom`/`dateTo`); Projetos (`entryFrom`/`entryTo`) e Amostras
(`producedFrom`/`producedTo`), que ainda chegam como `Date` e comparam instantes
(leitura de fuso intocada); exceções do Calendário e quadro de produção
(`from`/`to`); os dez schemas de relatório com `periodFields` — R-02 só na janela
personalizada. CSV usa o schema da tela e o PDF lê o CSV: a mesma recusa nos três.

**Tela.** Faturamento, Recebimentos, OC e Produto Acabado: Personalizado invertido
mostra a frase no `DateRangeFilter` (`role=alert`, `aria-invalid`), não consulta,
tira linhas, total e páginas, a tabela diz "Corrija o período para consultar." e
o CSV vira botão desabilitado. As oito telas de relatório com De/até: consulta
desligada (`useReport` `enabled`), a frase embaixo dos filtros (`ReportPage`
`periodRefusal`), a mesma dica na tabela, CSV e PDF desabilitados. Corrigir
consulta uma vez; filtro válido segue com uma consulta por gesto, página 1 e
`YYYY-MM-DD`. Impressão com período invertido na URL mostra a frase do servidor em
vez de "(400)". Fuso, fórmulas, paginação, auth e dados intocados; sem migration.

**De passagem.** R-02 personalizado sem nenhuma ponta dava 500 com lote sem
validade (`expiryDate: {}` trazia o lote e a linha quebrava em `toISOString`);
aberto dos dois lados agora é todo lote com validade (`{ not: null }`).

**Validação.** Shared 8 (`period-range.test.ts`). API 219
(`lib/periodo-invertido.test.ts`: 19 famílias × 6 casos no JSON e 17 no CSV, só a
inicial em 2999 e só a final em 2001 passando, R-02 fora do personalizado e sem
ponta, guarda de que todo CSV com par de datas está na matriz; o código antigo
derruba os 36 invertidos). Web 22 novos
(`pages/periodo-invertido-listas.test.tsx`,
`pages/reports/relatorios-periodo-invertido.test.tsx`) e 2 no PDF
(`pdf/documents/report-content.test.tsx`). 21 mutações — primitiva, schemas,
serviço, filtro, listas, esqueleto, telas e PDF — todas derrubam teste. Focados da
API (listas, Relatórios, exportações, dia comercial, Painel, inventário, suporte de
teste: 50 arquivos, 914 testes; faixa serial com Calendário, quadro e Painel: 74) e
da web (listas, Relatórios, PDF, período, 390px: 53 arquivos, 772), typecheck.
Smoke com banco e portas isolados, 1440 e 390: API direta em 12 rotas, Faturamento
e R-03 sem consulta no invertido e com uma ao corrigir, frase à vista sem rolagem
horizontal, CSV e PDF desabilitados, PDF com a frase — 108/108, console limpo fora
o 400 esperado do PDF.

## Confirmar grava antes de agir (CONFIRM-DISCARDS-DIRTY-01, 2026-09-13)

Continuação de SAVE-FLOW-HARDENING-01. "Confirmar pedido" e "Confirmar OC" chamavam
a confirmação direto, e o servidor confirma o documento GRAVADO. Reproduzido com
API e tela reais: Pedido com quantidade 12, entrega e notas digitadas confirmou com
10, sem entrega nem notas; OC com quantidade 12, preço 13,40, previsão e notas
confirmou com 10 a 12,50, sem previsão nem notas — e a releitura apagou tudo da
tela, sem aviso. Campos afetados: os da assinatura da guarda (Pedido: cliente,
entrega prevista, notas, produto e quantidade das linhas; OC: fornecedor, data do
pedido, previsão, notas, item, quantidade e preço das linhas).

**Regra (decisão do PO: gravar antes de agir).** Ação de domínio não descarta
edição. Sem a pendência da guarda (`alteracaoPendente` — a mesma que prende a
saída, acende a faixa e acorda o salvar), confirmar é só a confirmação, sem gravação
redundante. Com ela, a tela grava pelo salvar normal (`payloadDoRascunho`, o mesmo
funil do "Salvar rascunho"), espera a resposta real, fica com o gravado e só então
confirma — nunca as duas em paralelo. Gravação recusada não confirma: digitado,
pendência e mensagem ficam (campo a campo na recusa de validação). Gravação aceita
e confirmação recusada: fica o gravado, sem pendência, em rascunho, com o erro, e
tentar de novo só confirma. O botão de confirmar diz a etapa ("Salvando…",
"Confirmando…"), os demais ficam travados, e confirmar não passa pela pergunta de
alterações não salvas — a guarda de saída segue intacta. Documento novo não oferece
confirmar (o caminho continua sendo salvar o rascunho, que cria). API, lifecycle,
snapshot, permissão e diálogo intocados; sem endpoint composto, sem migration.

**Validação.** Web 22 novos (`customer-orders/pedido-confirmar-grava-antes.test.tsx`,
`purchase-orders/oc-confirmar-grava-antes.test.tsx`: `fetch` falso com estado — o
PATCH grava quando responde e a confirmação congela o gravado no instante em que
chega —, recusas 409/500 pelo cliente HTTP real; o código antigo derruba os 18
casos com pendência). 12 mutações (sem o save, confirm antes da resposta, tela com o
snapshot antigo, estado antigo depois do 409, confirmar após gravação recusada,
etapa sem "Salvando…"), todas derrubadas. Focados da web (Pedido, OC, guarda,
feedback de ações, 390px: 77 arquivos, 893 testes), API de Pedido e OC sem mudança
(12 arquivos, 169) e typecheck. Smoke com API, tela
e banco isolados, 1440 e 390: sem pendência só confirma; com pendência PATCH →
resposta → confirmação, com as duas etapas no botão, o congelado com o digitado lido
da API; quantidade zero recusada (400) sem confirmar, documento intacto; 409
simulado na confirmação com o gravado na tela e no servidor e a segunda tentativa
só confirmando; sem rolagem horizontal — 80/80, console limpo fora os 400/409
esperados.

Achado, sem correção: em 390px a mensagem de erro do Pedido e da OC mora no topo
da página, longe dos botões de ação no rodapé (padrão já existente).

## Apresentação dos Relatórios (REPORTS-PRESENTATION-WAVE-01, 2026-09-13)

Fecha os achados de apresentação de R20-UX-CLEANUP-WAVE-01 e SMALL-UX-CLEANUP-WAVE-01.
Só web: sem API, sem CSV, sem cálculo, sem permissão, sem migration. R-15 e backend do
Painel intocados.

**Plural.** R-02 ("Vence em 1 dia", "Vencido há 1 dia") e R-16 (1 dia aguardando) pelo
`emDias` de `pages/reports/report-period.ts`; a contagem continua a da API. O
cabeçalho da impressão HTML do `ReportPage` dizia "1 registros".

**Fornecedor no PDF.** `ReportPrintPage` resolve `supplierId` (R-08 a R-11) pelo
`porId` do `fornecedorFilterSource`, como já fazia com o cliente: `código · nome` do
seletor, uma consulta só com filtro e só depois do CSV aceito; sem nome, "—", e o
documento sai.

**Lista fechada no PDF.** Cada definição declara `filterValues` com o mapa que a tela
usa no seletor (status de lote, OP, OC, pedido e orçamento; tipo de item e de
movimento; origem da OC e do preço). `status` muda de sentido por relatório, por isso
o mapa é de cada um. A janela do R-02 virou `JANELAS_DE_VENCIMENTO`, lida pela tela e
pelo PDF. Liga/desliga (`onlyWithBalance`, `onlyShortage`, `includeCost`) sai
rotulado, Sim/Não. Valor fora do mapa sai como veio, sem cair no protótipo.

**Painel.** "Valor faturado" sem faturamento no período: "—" e "Sem faturamentos no
período.", sem cor de aviso; "documento" no singular com 1. Mesmo DTO.

**Validação.** Web: 29 testes novos (`dashboard-valor-faturado.test.tsx`,
`relatorios-vazio-e-plural.test.tsx`, `report-content.test.tsx`) e 3 asserções que
fixavam o enum cru (`AVAILABLE`, `SENT`) trocadas pelo rótulo; 3 mutações (fontes
antigas: 27 caem; guarda do protótipo: 1; consulta antes do CSV: 5). Focados 285/285
(Relatórios, Painel, conteúdo e arquivo do PDF, rotas, ajuda); typecheck. Smoke (web
do worktree contra a API dev, respostas sintéticas, nada gravado): 390px em R-02, R-16
e Painel (três casos) sem transbordo; PDF real de R-01, R-02, R-08 a R-11 e R-20 lido
de volta — fornecedor por código e nome, sem UUID, sem enum, nenhuma consulta sem
filtro — 23/23, console limpo.

**Achados, sem correção** (fechados em REPORTS-PRESENTATION-WAVE-02, menos as datas). CSV de R-05 e R-09 escreve "Qualidade do custo" como enum
(`REAL`, `ESTIMATED`), e o PDF repete — conteúdo gerado pela API; datas De/Até dos
filtros do PDF saem `YYYY-MM-DD`; plural fixo fora dos Relatórios (prazo e parcelas do
Orçamento: `QuotePdf`, `QuoteConditionsForm`, `CommercialOriginSection`); ids que a API
aceita e nenhuma tela manda (`itemId`, `lotId`, `productId`…) sairiam crus se digitados
na URL de impressão.

## Performance sem mudar regra (PERFORMANCE-CLEANUP-WAVE-01, 2026-09-13)

Cinco achados de performance já conhecidos, medidos antes e depois. Sem migration,
sem contrato de API novo, sem cache entre requisições; Pedido e OC intocados.

**Painel.** Estado atual e atenção calculavam cada um os pedidos aguardando
expedição, a falta de material e o custo incompleto — no mesmo retrato, com o mesmo
`now`. `carregarConjuntosDoRetrato` (`dashboard.queries.ts`) carrega os três uma vez
dentro da transação `RepeatableRead`, e `buildCurrentState`/`buildAttentionList`
leem a mesma promessa; nada volta ao `getPrisma()` no meio. A atenção chamada sozinha
carrega os três como antes. Massa de 200 OPs concluídas sem custo (2 consumos), 300
lotes-problema, 100 OCs, 60 OPs com falta e 30 pedidos, `now` fixo: 5.262 → 2.651 SQL;
mediana 4,27 → 1,44 s (hoje) e 4,29 → 1,63 s (período) — 1,60/1,76 s só com o
compartilhamento, o resto é o `diaCivil`; DTO idêntico nos dois períodos. Contagens
baratas do mesmo conjunto ficaram (expedições a faturar, lotes-problema: ~8 SQL).

**`diaCivil`.** Um `Intl.DateTimeFormat` por fuso, criado na primeira chamada e
reaproveitado: ~56 → ~2,6 µs, 100 mil instantes de 1900 a 2100 em São Paulo, UTC,
UTC-07 e Vancouver sem divergência. Fuso IANA de sempre, sem offset fixo.

**R-15.** O resumo lia todo faturamento do filtro com todas as linhas. Agora
`billingCount` é o `count` da paginação; completos, um `count` de documento com linha
e sem linha sem preço; valor, quantidade somada por preço (`groupBy`) × preço na
`Decimal` de 40 dígitos, só com todos completos (linha sem preço vista no meio também
tira o total). 2.000 faturamentos de 3 linhas: 8.101 → 108 registros devolvidos, 129
→ 16 ms, 6 SQL como antes; resumo, total, página e linhas idênticos em sete recortes.
Resumo segue do filtro inteiro; CSV e paginação iguais; índice novo não foi preciso.

**Seletores.** `EntityFilterSelect` pergunta o nome pelo id uma vez por valor: a
limpeza do efeito descartava a pergunta em andamento, e a primeira página chegando
antes do nome perguntava de novo (2 vezes; 4 com duas buscas no meio; 3 para id que
não existe mais). Item × Fornecedor pedia a mesma primeira página na barra e no
formulário, na mesma montagem: `fornecedoresAtivosDaTela` (`filter-sources.ts`, em
`useMemo`) pede uma vez e entrega aos dois; busca e id seguem no servidor.

**Validação.** API: `dashboard-conjuntos-uma-vez.test.ts` (faixa serial; cada
consulta-raiz uma vez, custo resolvido uma vez por OP, contador e atenção iguais a cada
conjunto calculado à parte), `dashboard-retrato-unico.test.ts` ajustado (uma leitura
das OPs do custo), `r15-resumo-agregado.test.ts` (0 documentos, incompleto, 45
documentos em 7 páginas, busca, resultado completo e CSV, resumo sem ler documento;
igual à conta de antes). Shared: `dia-civil-formatador.test.ts` (anterior × novo em
sete fusos, bordas, horário de verão, fuso do processo trocado). Web:
`filtro-por-id-uma-vez.test.tsx` e `fornecedores-primeira-pagina-uma-vez.test.tsx`
(servidor falso de 1002). 14 mutações, todas derrubadas. Focados: API serial 13, API
paralela 142 (Painel, Relatórios, exportações, validade em uso, dia comercial), shared
283, web 360 (filtros, Item × Fornecedor, Relatórios, Planejamento, Faturamento,
Painel); typecheck. Smoke com banco e portas isolados, web antiga (origin/main) × nova
contra a mesma API, dev com StrictMode: primeira página de fornecedores 4 → 1 na
listagem e no formulário, nome pelo id 2 → 1, busca da barra acha o #31; Painel 200 e
invertido 400; R-15 pela rota com o resumo de antes e CSV de 2.000; console limpo —
19/19.

**Achados.** Custo incompleto ainda resolve OP a OP (~2.600 das 2.651 SQL), e dentro
do retrato os `findUnique` não se compactam — DASHBOARD-COST-BATCH-01 (fechado, seção
abaixo). `instanteComercial`, `minutoDoDiaComercial` e `limitesDoDiaComercial` ainda
criam formatador por chamada — TZ-FORMATTER-REUSE-01 (fechado, seção própria). Os dois no
BACKLOG, P3.

## Custo incompleto do Painel em lote (DASHBOARD-COST-BATCH-01, 2026-09-13)

O Painel resolvia o custo de material das 200 OPs concluídas pela função unitária, uma
OP por vez: a leitura da OP com consumos, itens, lotes e produção (5 SQL, que dentro da
transação não se compactam) e até quatro consultas de recebimento por consumo — custo do
lote, janelas de 30 e 90 dias, último real. Na massa da PERFORMANCE-CLEANUP-WAVE-01 eram
2.600 das 2.650 SQL da requisição.

`findProductionOrderMaterialCosts` (`costs.service.ts`) lê as OPs numa consulta, e
`getConsumedLotCostReferences` (`lib/cost-reference.ts`) as referências de todos os
consumos em até três: o custo efetivo dos lotes consumidos (`lotId` é único na linha de
recebimento); as linhas com custo real dos itens no intervalo que cobre as janelas de
todos os consumos; e, só para item sem linha até o dia de algum consumo, o último real
anterior ao intervalo. A regra não mudou nem ganhou cópia: a hierarquia
(`referenciaDoConsumo`/`referenciaDoItem`) e a conta da OP (`materialCostOfOrder`) servem
à função unitária e ao lote, e só a origem dos dados muda. Pergunta da hierarquia fora
do que foi carregado é erro, nunca `NO_COST`. A janela de um dia fica guardada só dentro
da chamada — cada cálculo pergunta o fuso ao `Intl` (~0,5 ms) e era a maior parte do
tempo que sobrava. A função unitária mantém as mesmas consultas, e os outros chamadores
(Estoque acabado, Relatórios, lote de documentos, detalhe da OP) seguem nela. O Painel
chama o lote com o `prisma` da transação `RepeatableRead`; migration, contrato de API e
UI intocados.

**Medida** (mesmo `now`, 7 rodadas, banco isolado). Massa da wave anterior (200 OPs sem
custo, 2 consumos): Painel 2.650 → 58 SQL, mediana 1,79 → 0,10 s (hoje) e 1,77 → 0,09 s
(período), transação igual ao total; conjunto do custo sozinho 1.609 → 12 SQL, 1,13 s →
42 ms; 2.968 linhas devolvidas antes e depois. Mesma massa + 120 OPs com os casos de custo
(real, parcial, 30/90 dias, último real, cliente, sem lote, compra depois do consumo, custo
zero, consumo extra): 2.245 → 62 SQL, 1,77 → 0,10 s, 3.152 → 3.070 linhas. DTO do Painel
idêntico nas duas massas e nos dois períodos; lista do custo incompleto igual em ids e
ordem; função unitária igual à de antes nas 321 OPs; lote igual à unitária, salvo a
ordem de dois consumos com `createdAt` idêntico — empate que o `orderBy` da unitária
também não fixa.

**Validação.** `custo-de-material-em-lote.test.ts` (21 OPs, um caso da regra cada; lote
igual à unitária e ao valor escrito à mão; recortes; consultas constantes; lista do
Painel; retrato com escrita de outra conexão em cada caminho do lote) e
`dashboard-conjuntos-uma-vez.test.ts` ajustado (custo em lote, nenhuma OP lida por id).
18 mutações, todas derrubadas. Focados: API paralela 14 arquivos/198 testes (custos,
custo do cliente, precisão, consumo extra, estoque acabado, material do cliente, custo
industrial, relatórios, lote de documentos, dia comercial do custo, seleção de fonte),
serial 3/13 (Painel, retrato, conjuntos); typecheck.

**Achados.** Consumos com `createdAt` empatado saem em ordem não fixa no DTO de custo —
na função unitária também. Quantidade abaixo de `1e-7` sai como `"1e-12"` no DTO de custo
(Watchlist 15, já registrado). Janela de custo por consumo pesa na função unitária —
anotado em TZ-FORMATTER-REUSE-01 (fechado, seção própria).

## Busca e data digitadas nos Relatórios (REPORTS-SEARCH-UX-01, 2026-09-13)

Fecha os achados de consulta de SMALL-UX-CLEANUP-WAVE-01. Só web: sem API, sem filtro
do servidor, sem fórmula, sem migration.

**Digitação.** Busca (17 telas) e De/até (8) passam por `useFiltrosDigitados`
(`pages/reports`): o campo mostra cada tecla; consulta, recusa do período, CSV e PDF
leem o APLICADO, que recebe o digitado quando a digitação para por 300 ms — o mesmo
valor das buscas das listagens — ou no Enter. Um timer por tela (De e até em sequência
saem juntos), página 1 no mesmo render que aplica, valor que volta ao aplicado antes da
pausa não consulta, desmontar limpa o timer. Seletor e checkbox seguem imediatos.
Durante a pausa a tela é a do filtro aplicado; aplicado, vale o "Carregando…" de
SMALL-UX. Medido no Chromium pt-BR (main × worktree, mesma API): "abc" rápido 3 → 1
consulta e 3 → 1 "Carregando…"; 01/09/2026 digitado no De do R-03 8 → 1 (passava por
ponta aberta e anos 0002/0020/0202, que o servidor recusa com 400); 10/09/2026 no até
7 → 1, recusa piscando 1 → 0.

**CSV e PDF.** Com digitação pendente não se oferecem (`filtersPending` do
`ReportPage`, como na recusa do período): o arquivo nunca sai com "ab" diante de "abc".

**Erro.** Consulta que falha mostra o alerta e a tabela não diz mais "nenhum registro"
(contexto de erro no `ReportTable`); resposta vazia de verdade continua dizendo.

**Validação.** Web: `relatorios-busca-digitada.test.tsx` (38, relógio falso: rápida,
lenta, Enter, página, fora de ordem, primeira carga, erro, data digitada com os valores
medidos no Chromium, até invertido, CSV/PDF, desmontar, 17 + 8 telas, guarda
estrutural); consulta-em-curso, período invertido, página ao filtrar e dia comercial
passam a deixar a pausa passar (ou Enter). 10 mutações, todas derrubadas. Focados
Relatórios + conteúdo do PDF; typecheck. Smoke (web do worktree contra a API dev, 500
simulado por `route`, nada gravado) em 1440 e 390: 68/68 — sem transbordo com
digitação pendente, carregando, erro, vazio e recusa; console limpo além da linha do
500 simulado.

**Achados.** `DateRangeFilter` das listagens aplica a cada `change`: a mesma data
digitada consulta os valores do meio nas listas; dia mal formado que PARA no campo
(ano 0002) ainda vai ao servidor e volta como "Não foi possível carregar o relatório:
Data inválida", sem recusa da própria tela.

## Recurso industrial sem corte nos seletores (SELECTOR-CUTOFF-WAVE-02, 2026-09-13)

Revalidação dos oito tetos de 100 do BACKLOG W8, um por um. Três eram seletor de
verdade — todos de recurso industrial —, e a tarifa da Estrutura de Custos tinha o
mesmo corte com 50. Os outros cinco ficam, com motivo. Só web: sem API nova, sem
migration.

**Por que cortava.** `GET /industrial-resources` ordena por tipo e código, com energia
por último. O Modelo de Estrutura de Custo punha os 100 primeiros (todos os tipos,
inativos incluídos) num `<select>`; o Roteiro, os 100 primeiros ativos, filtrando
capacidade no navegador; a Estrutura de Custos tirava a tarifa do kWh derivado da
página de 50 ativos; o `porId` do Planejamento procurava o id nos 100 primeiros. Do
101º em diante o recurso não era escolhível e a energia sumia primeiro. No Modelo o
tipo da linha gravada saía da mesma lista: fora dela a linha perdia "Quantidade de
recursos", e o próximo "Salvar rascunho" gravava `resourceCount` 1 no lugar do número.

**Regra.** `lib/recursos-do-seletor.ts` (`useRecursosDoSeletor`): primeira página de 20
uma vez, só quando o campo existe, um pedido por tipo do recorte (o servidor filtra um
tipo só); busca no servidor com o mesmo recorte, e o achado entra no catálogo; id já
escolhido que não veio em nenhum dos dois é perguntado por `GET
/industrial-resources/:id` uma vez, depois de a página responder, e ganha nome sem
virar oferta. Campos → `SearchableEntitySelect` com `onSearch`, universo de antes:
linha do Modelo com todos os tipos e inativos; energia do Modelo só energia, inativa
incluída; etapa do Roteiro mão de obra e equipamento ativos; tarifa da Estrutura
energia ativa. Tipo da linha gravada vem do template; recurso gravado da etapa, do
roteiro. Reescolher a tarifa que já vale não grava. O Roteiro só diz "Nenhum recurso de
produção cadastrado." depois de a página responder. `porId` do Planejamento →
`getIndustrialResource`. UOM, `resourceCount`, `resourceQuantity`, roteiro ativo e
snapshot de OP intocados.

**Mantidos.** Dica de homologação da OC: apoio visual por linha — acima de 100 relações
do fornecedor ela some, mas fornecedor e item seguem com busca e a OC não depende
dela; Pedido/OC intocados. `SupplierItemsSection`: tabela só leitura, a lista completa
com filtro é Item × Fornecedor. Ficha do Projeto: as 100 amostras mais recentes; Amostras
não tinha outro teto. Usuários: listagem, fora da fase (Auth). FO-03: PDF de pendências,
lista operacional (fechado depois em FO03-PENDING-CUTOFF-01). Detalhe e medida do dev no
BACKLOG W8.

**Validação.** Web: 4 arquivos novos com servidor falso ordenado como o real (#112 fora
dos 100, nenhuma energia nos 100 nem nos 50 ativos, tarifa #25 fora da página de
energia) — foundation 9, Modelo 10, Roteiro 7, Estrutura 5 — e `quadro-produto-por-id`
com mais 3; dois testes do Roteiro trocaram `<select>` por combobox, com servidor que
filtra tipo. 17 mutações (16 âncoras e as telas de antes), todas derrubadas. Gate
focado: 100 arquivos, 1175 testes (componentes, lib, Planejamento, Modelos, Estrutura,
Recursos, Item × Fornecedor, Projetos, Amostras, impressos, OP, OC, filtros) e
typecheck. Smoke Playwright com banco e portas isolados e 138 recursos: Modelo com o
#112 achado pela busca e gravado com 3 recursos, recarregado e salvo de novo com 3;
tarifa #25 gravada e resolvida pelo id uma vez; Roteiro com o #111 ativo gravado, sem
inativo nem energia na busca; Planejamento pelo id uma vez; Estrutura com energia real e
estrutura simulada por interceptação (envio capturado); pedidos na abertura 1 (Modelo)
e 2 (Roteiro); 390px sem transbordo e listas dentro da tela; console limpo fora dois 404
do produto simulado — 51/51.

**Achados.** Roteiro: a volta de um cadastro no contexto restaura etapas, quantidade e
unidade, e a leitura do roteiro sobrescreve os três — ROUTE-CONTEXT-RESTORE-01.
Estrutura de Custos: recurso da linha criado no contexto fora dos 50 primeiros ativos
volta com o campo vazio — COST-USAGE-RESOURCE-BYID-01. Os dois no BACKLOG, P3.

Próximo recomendado: LISTS-LOADING-STALE-DATA-01.

## A volta do cadastro não perde o roteiro (ROUTE-CONTEXT-RESTORE-01, 2026-09-13)

Só web: sem API, sem domínio, sem migration.

**Causa.** "Cadastrar recurso" guarda o rascunho inteiro e a volta o restaura na
montagem. A carga do roteiro sai na mesma montagem e responde depois: `setBase`,
`setUnidade` e `setEtapas` sem condição trocavam o rascunho da pessoa pelo gravado —
"Etapa Restaurada" virava "Encapsulamento". Nome e descrição passavam pela leitura
anterior, menos o campo apagado: ela começa vazia, e o vazio restaurado parecia intocado.

**Regra.** Carga inicial é a que sai sem leitura anterior (`lido` nasce `null`). Com
rascunho restaurado — a trava `rascunhoRestaurado` de Template de Formulação,
Formulação, Pedido e OC —, ela não escreve nome, descrição, base, unidade nem etapas;
só registra o gravado (`salvo` e `lido`). A diferença fica pendente: "Alterações não
salvas", guarda de saída e "Ativar versão" bloqueado; restaurado igual ao gravado não
pende. A decisão é tomada na saída da carga e a trava não se desarma na primeira
resposta, porque o StrictMode do dev pede duas. Salvar, ativar e criar versão
recarregam depois da primeira leitura e trazem o servidor, como antes. A leitura
anterior por campo do Modelo de Estrutura não serve ao bloco do rascunho: depois de
salvar, manteria o texto não normalizado (`250,5` × `250.5`) e a pendência não sairia.
Save, ativação, validação, snapshot, `resourceQuantity` e roteiro ativo intocados.

**Validação.** `roteiro-volta-do-cadastro.test.tsx`, 7 testes: `startContextualCreate` +
`PARAM_RETOMAR` com a carga adiada até depois da restauração; StrictMode com as duas
respostas; ida e volta pela própria tela; carga normal sem `retomar`; pendente, salvar
grava o restaurado e a pendência some; igual ao gravado sem pendência; nome e
descrição apagados. Antes da correção, 5 dos 7 caíam. 12 mutações (cada `set` de volta,
trava consumida na primeira resposta, carga inicial decidida na volta, trava para toda
carga, `salvo` não gravado, nome e descrição fora da trava, trava não armada, trava sem
restauração), todas derrubadas. Gate focado: 11 arquivos, 189 testes (Roteiro, criação
contextual, cadastro de recurso, guarda) e typecheck. Smoke Playwright 390px contra a API
dev, só leitura (catálogo de capacidade vazio e leitura do roteiro atrasada 1,5 s por
interceptação; cadastro cancelado): main de antes volta com 1000 un, sem etapa e sem
pendência; a correção volta com 250,5 kg e "Etapa Restaurada" por lote 15/45, pendente,
duas leituras do StrictMode, guarda perguntando, sem transbordo e console limpo.

**Achados.** "Salvar identificação" com rascunho pendente recarrega e apaga base,
unidade e etapas digitadas — ROUTE-IDENTIFICATION-SAVE-DRAFT-01. O cadastro de recurso
aberto pelo Roteiro diz "← Voltar para tela anterior" — CONTEXT-ORIGIN-LABEL-ROUTE-01. Os
dois no BACKLOG.

## Lista não mostra o recorte anterior enquanto carrega (LISTS-LOADING-STALE-DATA-01, 2026-09-13)

O defeito que SMALL-UX-CLEANUP-WAVE-01 fechou nos Relatórios, visto de novo nas listas em
PERIOD-RANGE-VALIDATION-WAVE-01. Só web: sem API, sem contrato de filtro, sem migration.

**Causa.** Cada lista guardava linhas, total, `loading` e erro em `useState` soltos e trocava
tudo quando uma resposta chegava. Filtro novo deixava tabela, total e páginas do anterior à
vista, sem "Carregando…"; a resposta que CHEGAVA por último virava a tela, mesmo de filtro já
trocado; a falha aparecia junto das linhas de antes e, na primeira carga, junto do "Nenhum …
encontrado". Projetos e Amostras voltavam à página 1 por efeito: filtro trocado fora da
primeira página consultava duas vezes, e a página antiga podia responder por último.

**Regra.** `lib/list-query.ts` — `useListQuery`, o padrão do `useReport`: a resposta guarda a
chave da consulta que a pediu e a tela deriva no render. Recorte novo: nada do anterior,
"Carregando…" na tabela (`components/ListStatusRow.tsx`) e `aria-busy`, sem total nem
páginas. Outra página do mesmo recorte: a aberta fica até a próxima chegar (UX mantida). Só a
consulta atual escreve estado. Falha: o alerta, junto da tabela, sem vazio falso e sem linhas
de outro recorte ou página. Primeira carga nunca diz "nenhum" antes da resposta. `enabled:
false` (período recusado) não consulta nem carrega e esquece a resposta — voltar ao período
de antes consulta de novo. `reload` refaz recorte e página (Aprovar/Rejeitar da fila CoA).
`useFilteredPage` dá a Projetos e Amostras a página do recorte: filtro novo é página 1 no
mesmo render. Doze listas: Faturamento, Recebimentos, OC, Produto Acabado, Projetos,
Amostras, Pedidos, Expedições, OP, Lotes, Documentos/CoA e Picking. CSV segue lendo
`filtrosDaConsulta` — o filtro atual, também durante a carga. No Faturamento o alerta da
consulta desceu para junto da tabela de documentos: no topo, acima de "Aguardando
faturamento", ficava fora da vista de quem acabou de filtrar, em 390px.

**Validação.** Web: `lib/list-query.test.tsx` (17) e `pages/listas-consulta-em-curso.test.tsx`
(49: as 12 listas com os filtros de cada uma — busca, status, cliente, fornecedor, pedido,
produto, item, canal, saldo, datas —, primeira carga, uma consulta por gesto, CSV durante a
carga, página, fora de ordem C/B/A, falha e posição do alerta, recarga do Aprovar);
`periodo-invertido-listas` +4 (resposta atrasada depois da recusa, voltar ao período consulta
uma vez). As 12 telas de antes caem 48/48 no teste novo; 20 mutações, todas derrubadas. Gate
focado: 91 arquivos, 1174 testes (fundação de listas, filtros, seleção em massa, Faturamento,
Recebimentos, OC, Produto Acabado, Projetos, período invertido de listas, Relatórios e
Painel, Pedidos, Expedições, OP e Picking, Lotes, Qualidade, ajuda) e typecheck. Smoke (web
do worktree contra a API dev, listas interceptadas com atraso e 500, nada gravado):
Faturamento e Projetos em 1440 e 390, 25/25 — carregando, fora de ordem, falha, período
invertido com 0 consultas, página, uma consulta por gesto, CSV, sem transbordo em
carregando, falha e vazio; console limpo além da linha do 500 simulado.

**Achados.** LISTS-LOADING-STALE-DATA-02: as outras 16 listas paginadas e os quadros de
Planejamento ainda têm o padrão antigo. LISTS-FILTER-INPUT-UX-01 segue aberto. Os dois no
BACKLOG.

## Recurso da Estrutura de Custos pelo id (COST-USAGE-RESOURCE-BYID-01, 2026-09-13)

O campo "Recurso" da Estrutura de Custos tirava as opções dos 50 primeiros recursos
ativos e do que a busca achava. Só web: sem API nova, sem migration.

**Por que falhava.** O recurso criado no contexto, ou restaurado do rascunho, fora
dos 50 voltava com o campo vazio e o id escolhido por baixo; sem o tipo, "Quantidade
de recursos" sumia e "Adicionar recurso" mandava o uso sem ela — o servidor gravava 1
no lugar do número restaurado. O aviso de energia fora do modo direto procurava o
criado numa lista que, na volta, ainda estava vazia (a tela remonta e o retorno chega
antes da estrutura e dos recursos): não disparava nunca, nem dentro dos 50. A busca
devolvia o achado sem o recorte da tela — energia fora do modo direto e recurso que a
estrutura já usa —, e no modo direto a energia, última na ordem do servidor, não
aparecia na abertura.

**Regra.** O campo usa `useRecursosDoSeletor`: `ATIVOS_SEM_ENERGIA` (todo tipo ativo
menos energia, um pedido de 20 por tipo) e, só no modo direto, a página de
`ENERGIA_ATIVA` — a mesma da tarifa do kWh derivado, pedida uma vez por tela. A busca
vai ao servidor com os mesmos recortes; o que a estrutura já usa sai da abertura e da
busca. Id escolhido que não veio em página nenhuma é perguntado por `GET
/industrial-resources/:id` uma vez, depois de todas as páginas que a tela pediu (antes
disso ele podia estar na de energia), e ganha nome no campo. O criado no contexto fica
escolhido e é conferido com o recurso resolvido e a estrutura lida: energia fora do
modo direto volta o campo ao recurso do rascunho, com o aviso de sempre, sem aparecer
nem por um render; trocar de recurso antes da conferência vale. "Adicionar recurso"
espera o recurso resolvido — sem o tipo, a quantidade de recursos não iria (§87).
`resourceCount`, guarda de saída, cálculo, tarifa e API intocados.

**Validação.** Reprodução no código de antes: 5 afirmações do defeito passaram. Web:
`recurso-do-uso-sem-corte` com servidor falso ordenado como o real (108 ativos) — 14
testes: abertura, busca, modo direto, rascunho restaurado, id pendente travando o
botão, cadastro no contexto dentro e fora da página, energia recusada sem página de
energia e fora e dentro dela (com a página de energia respondendo por último), troca
antes da conferência e energia no modo direto, com contagem exata de pedidos e o
histórico do atributo `value` do campo. 23 mutações (a página de antes e 22 âncoras),
todas derrubadas. Gate focado: 39 arquivos, 386 testes (Estrutura, Recursos, Modelos,
foundation, criação contextual, guardas de saída) e typecheck. Smoke Playwright no Vite
do worktree, estrutura e recursos interceptados (nada gravado): 45/45 em 7 cenários,
390px sem transbordo, console limpo.

## Salvar identificação não apaga o rascunho (ROUTE-IDENTIFICATION-SAVE-DRAFT-01, 2026-09-13)

Só web: sem API, sem domínio, sem migration.

**Causa.** Identificação e rascunho gravam separado, mas `run()` recarrega o roteiro
depois de toda ação, e a leitura fazia `setBase`, `setUnidade` e `setEtapas` com o
rascunho gravado. "Salvar identificação" com base, unidade ou etapas pendentes trocava o
digitado pelo gravado: a assinatura voltava a bater com `salvo`, "Alterações não salvas"
sumia e a guarda deixava sair. "Definir padrão" e "Tirar padrão" passavam pelo mesmo
caminho.

**Regra.** Só as ações que gravam o rascunho — "Salvar rascunho", "Ativar versão" e
"Criar nova versão" (`ACOES_QUE_GRAVAM_O_RASCUNHO`) — trazem base, unidade e etapas do
servidor por cima da tela, normalizadas (`250,5` → `250.5`, `030` → `30`, nome aparado),
e a pendência some. Depois das outras, a releitura atualiza o que foi gravado (nome,
descrição, produtos) e mantém o bloco do rascunho quando ele está pendente no instante em
que a resposta chega (`rascunhoPendente`, o `alteradoNaTela` do último render): o que se
digitou durante a gravação também fica. `salvo` continua sendo o servidor, então a
pendência, a guarda e "Ativar versão" bloqueado seguem. Sem pendência, a releitura reflete
o servidor como antes. A trava da restauração contextual (carga inicial, StrictMode) não
mudou. Save, ativação, nova versão, snapshot, `resourceQuantity`, recursos e validação
intocados.

**Validação.** `roteiro-de-producao.test.tsx` +5, com a guarda real (router de dados):
nome salvo com base 500, kg e "Mistura Nova" mantidos, uma pendência, "Ativar versão"
bloqueado e "Sair sem salvar?"; digitação durante a gravação da identificação; sem
pendência, a releitura traz o servidor; "Salvar rascunho" troca `250,5`, `030` e nome com
espaços pelo normalizado e a guarda sai calada; "Tirar padrão" mantém o rascunho.
`roteiro-volta-do-cadastro.test.tsx` +1: depois da volta do cadastro, em StrictMode,
salvar a identificação não apaga o rascunho restaurado. Antes da correção, 4 dos 6
caíam; os outros 2 protegem o que já valia. 11 mutações (cada `set` de volta, pendência
limpa com os valores mantidos, guarda sem o rascunho, "Salvar rascunho" guardando o local,
pendência lida no clique, ref sem espelho, identificação guardando sem pendência e duas da
trava da restauração), todas derrubadas. Gate focado: 8 arquivos, 93 testes (Roteiro,
volta do cadastro, guarda do roteiro, recurso da etapa, criação contextual, guarda de
saída) e typecheck. Smoke Playwright contra a API dev, nada gravado (PPR-000027 com etapa
sintética sobre recurso real, PATCH da identificação interceptado, releitura real
reescrita): a main de antes volta 1000 un e "Encapsulamento", sem pendência, e sai sem
perguntar; a correção mantém 500 mg e "Mistura Nova", uma pendência, a guarda pergunta,
sem transbordo, console limpo — 18/18 em 390px e em 1440px.

**Achados.** O que se digita no rascunho durante "Salvar rascunho" é trocado pelo gravado,
sem pendência — ROUTE-DRAFT-SAVE-INFLIGHT-EDIT-01, no BACKLOG. CONTEXT-ORIGIN-LABEL-ROUTE-01
segue aberto.

## Custo, dias e ids no papel (REPORTS-PRESENTATION-WAVE-02, 2026-09-13)

Fecha os achados de REPORTS-PRESENTATION-WAVE-01, menos as datas `YYYY-MM-DD` dos filtros
do PDF (aceitas pelo PO). Sem migration, sem rota nem DTO novo, sem cálculo, sem permissão:
na API mudou só o texto de três colunas de CSV.

**Qualidade do custo.** O CSV de R-05, R-09 e Produto Acabado escrevia `REAL`,
`ESTIMATED`, `PARTIAL` e `NO_COST`, e o PDF dos relatórios, que lê o CSV, repetia. A coluna
sai pelo `COST_QUALITY_LABELS`, o mapa da tela: Real, Estimado, Parcial, Sem custo. O JSON
segue com o enum; o R-09 continua só REAL ou NO_COST, pela regra do serviço.

**Ids no PDF.** `FILTROS_POR_ID` (`ReportPrintPage`) lista todo id que os schemas dos
relatórios aceitam. Cliente e fornecedor, como antes; item, produto, pedido, OP, OC e
cliente proprietário, que só a URL manda, saem `código · nome` pelo `porId` do seletor que
já existe — em paralelo, uma consulta por filtro presente, só depois do CSV aceito (perfil
recusado ou CSV 403 não consultam ninguém). Lote não tem `porId`: nenhuma consulta
inventada, sai "—", como o id sem cadastro. `ownerType`, `sourceType` e `active` saem pelo
rótulo, e `purchaseOrderId`, `ownerType`, `ownerCustomerId`, `location` e `active` ganharam
nome no papel.

**Dias.** `emDias` saiu de `pages/reports/report-period.ts` para `lib/duration.ts` (e
`pdf/format.ts`): prazo de entrega e vencimento das parcelas no PDF do Orçamento,
vencimentos e "a cada N dias" das condições, vencimentos da Origem comercial do Pedido.
Prazo vazio segue "—"; intervalo vazio segue "por mês".

**Validação.** API: `qualidade-do-custo-no-csv.test.ts` (8 — as quatro qualidades no CSV
de R-05, R-09 e Produto Acabado, o filtro chegando ao serviço, o JSON com o enum) e o R-05
real sem custo de `exports.test.ts` com "Sem custo". Web: `report-content.test.tsx` +25 (id
válido, inexistente, consulta que falha, lote sem consulta, três ids e 40 linhas em três
consultas, sem filtro, R-19 e R-20 recusados, CSV 403, todo id aceito com rótulo e sem valor
cru, R-05 e R-09 sem enum no papel, `ownerType`/`sourceType`/`active`) e
`prazo-e-parcelas-em-dias.test.tsx` (15 — 0, 1 e 2 no helper, no PDF, no formulário e na
Origem comercial). 11 mutações, todas derrubadas. Focados depois do rebase: API 7 arquivos,
61 testes, em banco de teste próprio; web 55 arquivos, 729 testes; typecheck. Smoke
Playwright com API e Vite do worktree contra o `veridi_dev`, só leitura, e a main de antes
na 3333/5173 (versão do Orçamento e origem comercial sintéticas): CSV × JSON linha a linha
no R-05 (18 linhas, REAL e NO_COST) e no R-09 (26); PDF real lido de volta sem enum; ids por
código e nome, sem pedaço do UUID, uma consulta por filtro a cada carga; lote sem consulta;
"1 dia" no PDF do Orçamento; Origem comercial em 390px sem transbordo — 48/48, console
limpo.

**Achado.** "Filtros aplicados" lista toda chave da URL, inclusive a que o schema daquele
relatório não aceita e a API ignora — REPORTS-PRINT-UNACCEPTED-FILTER-01, no BACKLOG.

## Recorte novo sem o anterior nas listas restantes, abas e Quadro (LISTS-LOADING-STALE-DATA-02, 2026-09-13)

O que LISTS-LOADING-STALE-DATA-01 deixou no BACKLOG. Só web: sem API, sem contrato de
filtro, sem migration, sem debounce novo.

**Discovery.** As 16 listas — Clientes, Fornecedores, Itens de estoque, Produtos Acabados,
Item × Fornecedor, Formulações, Modelos de Formulação, Recursos industriais, Modelos de
Estrutura de Custo, Políticas de Precificação, Precificação, Roteiros de Produção, Estoque,
Movimentações, Materiais de Clientes e a busca da Visão do Cliente — eram paginadas com o
defeito da onda 01: recorte anterior à vista sem "Carregando…", a última resposta a chegar
virava a tela, a falha vinha com as linhas de antes (na primeira carga, com o vazio) e a
página voltava à 1 por efeito, numa consulta a mais. `useScopedList` (as 7 abas da Visão do
Cliente) tinha guarda de ordem, mas mostrava as linhas do cliente anterior durante a carga,
voltava à página por efeito e, na falha, deixava o vazio do cliente e "0 projetos" junto do
alerta. Quadro de Produção, quadro com o defeito: as seções já sumiam durante a carga, mas a
resposta atrasada virava quadro, a primeira a terminar tirava o "Carregando…", a falha
mostrava o quadro anterior e o aviso de calendário ficava do recorte anterior. Calendário de
Produção sem o defeito: chave fixa (a janela do ano), uma carga por montagem — mantido.

**Regra.** As 16 listas usam `useListQuery` + `useFilteredPage` + `ListStatusRow` da onda
01, sem segunda foundation: total e paginação só com a resposta do recorte, `aria-busy`, e
as ações da lista (inativar, salvar, fechar o detalhe) recarregam o mesmo recorte. Contexto
de link (`ids`, `productId`, `itemId`) é parte da chave: Clientes com `?ids=` consulta uma
vez — eram duas, porque a limpeza dos filtros por efeito trocava a situação comercial, que
não vai com o contexto —, e o produto do aviso de Produtos sai da resposta do próprio
recorte. A falha de criar template, política ou roteiro é estado da ação, fora do erro da
lista. `useScopedList` é `useListQuery` com a página do cliente; contagem e paginação da
Consulta só com resposta; as abas usam `ListStatusRow`. O Quadro usa `useListQuery` com a
tela de antes: seções só com a resposta, e a recarga depois de programar esconde o quadro até
a nova. A falha de `useListQuery` passa por `apiErrorMessage` — recusa de validação diz as
issues, como Roteiros e o Quadro já faziam. Guarda estrutural: nenhum fonte guarda o total da
consulta em `useState` (`setTotal`) nem volta a página à 1 por efeito.

**Validação.** Web: `listas-consulta-em-curso-restantes` (82 — as 16 listas com os filtros
de cada uma: primeira carga, filtro novo com uma consulta por gesto, página, fora de ordem
C/B/A, falha e posição do alerta, vazio real; chegada por link em Clientes e Produtos),
`customer-consultation/abas-consulta-em-curso` (8), `planning/quadro-consulta-em-curso` (7:
primeira carga, situação, período, fora de ordem, falha e issues de validação, vazio,
recarga depois de programar), `list-query` +1 e `listas-sem-consulta-solta` (3). O código de
antes derruba 92 dos 101 testes novos (os outros 9 protegem o que já valia); 18 mutações,
todas derrubadas. Gate focado depois do rebase: 94 arquivos, 1098 testes (foundation, as 28
listas, período invertido de listas, Relatórios e Painel, Visão do Cliente, Planejamento,
cadastros, modelos, custos, precificação, estoque, navegação e ajuda) e typecheck. Smoke
Playwright em 390px, Vite do worktree contra a API dev, listas interceptadas (atraso, 500,
fora de ordem, vazio; nada gravado): Clientes, Movimentações, busca e aba Projetos da Visão
do Cliente e Quadro — 35/35, sem transbordo, uma consulta por gesto, console limpo além do
500 simulado; a main de antes, no mesmo roteiro de Clientes, cai em 5.

**Achados.** No BACKLOG: LISTS-ERROR-FALSE-EMPTY-ADMIN-01 (Usuários e Documentos
controlados: falha da carga com o vazio junto do alerta), LISTS-EMPTY-ROW-390-01 (frase de
vazio com ação passa da borda do contêiner em 390px, igual antes) e
CONSULTATION-CUSTOMER-SWITCH-QUERY-01 (trocar de cliente pela mesma rota pede a aba duas
vezes, igual antes). LISTS-FILTER-INPUT-UX-01 segue aberto.

## Campos numéricos pt-BR — foundation (PTBR-NUMERIC-INPUT-FOUNDATION-01, 2026-09-13)

Só a foundation. Nenhuma tela de negócio migrada; sem API, DTO, Decimal, banco,
arredondamento de domínio ou migration. Regra de uso em `UI_BRAND.md`, "Campos numéricos e
valores pt-BR".

**Discovery.** Ficaram e foram reusados: `decimal-format.ts` (formatação por dígitos,
`ROUND_HALF_UP`, sem float — base de toda exibição nova), `currency.ts`, `percent.ts` e
`quantity.ts` (presets de leitura), a leitura vazio/válido/inválido de `integer-input.ts`, e o
desenho de foco já aprovado em `NUMERIC_PRECISION_AUDIT.md` §11.5. `decimal-input.ts` e
`decimal-field.ts` leem um separador só como decimal e recusam milhar: seguem servindo às telas
de hoje, sem mudança, até o rollout. Não existia campo numérico: cada tela monta o próprio
`<input type="text" inputMode="decimal">`, e três usam `type="number"`.

**Arquitetura.** `lib/numeric-ptbr.ts` + `components/NumericField.tsx` (`IntegerField`,
`DecimalField`, `MoneyField`, `PercentField`). O valor do campo é o texto digitado em português
(`""` é vazio); a string canônica sai de `parsePtBrNumber` na borda (`vazio`/`valido`/`invalido`
com motivo), e `toPtBrEditText` carrega o valor da API preservando os dígitos. Vírgula é decimal
e pontos antes dela são milhar em grupos de três; sem vírgula, um ponto que não forma milhar é
decimal (`1234.56`); `1.234` sozinho em campo decimal é ambíguo e recusado (em inteiro, 1234).
Casa além do `scale` só passa se for zero. O campo: formatado fora do foco, sem milhar no foco,
normalizado uma vez na saída; tecla inválida barrada em `beforeinput` (`onChange` como segunda
linha), apagar/selecionar/copiar nativos, colagem normalizada (`R$` na moeda, `%` no
percentual), `aria-invalid` + `is-invalid` só fora do foco, props do input e `ref` repassadas.
Símbolo no rótulo; dentro do campo, só em `readOnly`. Percentual em pontos, sem conversão.
Formatadores de leitura com `scale`/`minFractionDigits` sobre `formatarDecimalTexto`.

**Validação.** Web: `lib/numeric-ptbr.test.ts` (38), `components/numeric-field.test.tsx` (54),
`components/campo-numerico-guarda.test.ts` (2) e os helpers vizinhos (`decimal-input`,
`decimal-format`, `currency`, `integer-input`, `quantity`, `quantity-limit`,
`native-validation-ptbr`): 10 arquivos, 232 testes. 13 mutações, todas derrubadas. `pnpm
typecheck` (shared, api, web). Smoke Playwright com harness temporário, não commitado, no Vite do
worktree: 390px com toque — 7 campos cabem (358 px, sem rolagem horizontal), `inputmode` certo,
1·12·12,·12,3·12,34 com cursor no fim, letras, `R$`, sinal e terceira casa barrados; 1440 — Tab
formata e seleciona tudo, clique no meio do formatado põe o cursor entre os mesmos dígitos,
Backspace/Delete/Home/Ctrl+A/Ctrl+C, Ctrl+V real de `1.234,56`, `1234.56`, `1234,56` e
`R$ 1.234,56`, texto colado recusado, `12.5` vira `12,5`, `1.234` acusado, preço com 4 casas, 12
casas, inteiro `1.234`, `readOnly` com `R$`: 39/39, console limpo. Sem full test, E2E, build nem
fresh (FAST).

**Achados** — no item do rollout, no BACKLOG: teclado `decimal` do iOS não tem sinal de menos
(campo com `allowNegative` pode pedir `inputMode="text"`, que a prop aceita); trocar
`parseDecimalInput` pelo parser novo muda o `1.234` digitado de 1,234 para recusado;
`formatQuantity` não agrupa milhar e o campo agrupa fora do foco; o campo não limita os dígitos
da parte inteira — quem limita é a coluna. Próxima capability: PTBR-NUMERIC-INPUT-ROLLOUT-01.

## FO-03 com todas as pendências (FO03-PENDING-CUTOFF-01, 2026-09-13)

A folha "Pendências de qualidade / CoA" pedia `listQualityQueue({ pageSize: 100 })`, sem
`onlyPending`. A primeira página era de todos os lotes, na ordem do servidor (`coaStatus` pela
ordem do enum — sem exigência e aprovado antes das pendências — e depois código): lote que não é
pendência entrava, e da 101ª linha em diante nada entrava. "Lotes pendentes: N" contava o que
sobrou. Só web: sem API, sem contrato novo, sem migration.

**Regra.** FO-03 é o recorte "Pendências" de Documentos / CoA — o que a ajuda já dizia —, decidido
pelo servidor: `onlyPending`, laudo pendente, aguardando análise ou rejeitado. Vencimento não entra
no recorte (`onlyPending` é só documental). A rota não tem `all=true` e o `pageSize` vai até 100:
`loadAllPages` (`web lib/all-pages.ts`) lê página a página até o `total`, na ordem do servidor, uma
requisição por página. O `total` da primeira resposta é guarda: total diferente entre páginas,
página que não fecha com o que falta, chave repetida ou total inválido lançam, e falha de qualquer
página também — o `PdfScreen` diz "Não foi possível gerar o documento" e nenhum PDF sai parcial.
Documento sem `all=true` que precise do conjunto inteiro usa o mesmo helper.

**Validação.** Web: `all-pages` (23), `fo03-pendencias-sem-corte` (7, servidor falso que filtra,
ordena e pagina como `quality.service`, lendo o PDF: 0, 1, 100, 101 e 125 pendências entre 40 fora
do recorte; página 2 falhando; total mudando) e `operational-sheets` ajustado. Mutação 9/9. Gate
focado: 19 arquivos, 312 testes (folhas, qualidade, `src/pdf`, `src/print`, listas da fila) — a
primeira execução, fria, perdeu 2 do FO-02 por `waitFor` de 1 s (W9); isolado e em duas
reexecuções, verde. API `quality-documents` 18/18 em banco de teste isolado. `pnpm typecheck`.
Smoke Playwright com API, Vite e banco isolados (190 lotes, 130 pendências): PDF real lido com
130/130 na ordem do banco e nenhum dos 60 de fora; tela Documentos / CoA com 130; 101, 100, 1 e 0
no servidor real; 500 na página 2 e total mudando sem PDF, com alerta; 2 requisições por geração
acima de 100, 1 até 100 (o dev dobra pelo StrictMode); console limpo fora a linha do 500 simulado.

**Achados** (BACKLOG, P3): FO03-ROW-SITUATION-01 — a coluna Qualidade ignora `isExpired`
(pendência vencida sai "Aguardando liberação"; a tela diz "Vencido") e a Pendência do laudo
rejeitado sai "Aguardando liberação"; PAGED-DOCUMENT-SNAPSHOT-01 — leitura por deslocamento não
pega uma saída e uma entrada simultâneas entre as requisições (total igual, sem repetição).

## Formatador do fuso reaproveitado no relógio e na hora (TZ-FORMATTER-REUSE-01, 2026-09-13)

`instanteComercial`, `minutoDoDiaComercial` e `limitesDoDiaComercial` criavam um
`Intl.DateTimeFormat` por chamada — quatro por limite de dia, oito por janela de custo —, o
padrão que PERFORMANCE-CLEANUP-WAVE-01 tirou de `diaCivil`. Só `packages/shared`: sem API,
contrato, banco nem migration; fuso, dia civil, regra de custo e as duas passadas intocados.

**Cache.** `business-timezone.ts` tem uma forma de leitura por conjunto de opções — dia
(`diaCivil`), relógio até o segundo (o deslocamento das duas passadas) e hora e minuto —, com o
idioma e as opções de antes. Fica guardado por forma + fuso só o formatador, nunca data, "agora"
ou resultado. Fuso inválido lança na criação e não entra. Cada forma guarda até 16 fusos: o
`Intl` aceita o mesmo fuso escrito de muitos jeitos (`america/sao_paulo`), e passado o limite o
formatador sai novo a cada chamada, com o mesmo resultado. O cache por dia do custo em lote
(DASHBOARD-COST-BATCH-01) continua; quem ganha é a função unitária — Estoque acabado,
Relatórios, lote de documentos e detalhe da OP pagam até duas janelas por consumo sem custo de
lote —, a agenda e os filtros por período.

**Medida** (100 mil chamadas; antigo e novo intercalados no mesmo processo, Node 24, máquina com
outras sessões): `instanteComercial` ~137 → ~13 µs, `minutoDoDiaComercial` ~65 → ~5 µs,
`limitesDoDiaComercial` ~268 → ~24 µs; `limitesDaJanelaDeCusto` pela API, antes e depois do
build, ~615 → ~50–60 µs; `diaCivil` igual (~2,6 µs). Antigo × novo: 3.785.690 casos com UTC,
São Paulo, UTC-07 e Vancouver como fuso do processo — amostra de 1900 a 2100, 00:00/23:59/24:00
e ±1 ms das bordas, as 91 viradas de deslocamento de São Paulo no período ao milissegundo, cada
minuto dos dias de virada, anos de 1700 a 2500, entrada inválida com o mesmo erro —, 0
divergências; 100 mil janelas de custo, 0.

**Validação.** Shared: `fuso-comercial-formatadores.test.ts` (anterior copiado × novo nos quatro
fusos do processo com o deslocamento conferido, valores escritos à mão, um formatador por forma
num módulo novo, limite de 16 com fuso inválido fora). 11 mutações, todas derrubadas. Focados:
shared 4 arquivos/71 (com `dia-civil-formatador`, `business-timezone` e `production-schedule`),
API paralela 16/198 (custos, dia comercial do custo, fonte de custo, estoque acabado, relatórios,
lote de documentos, Painel no dia comercial), serial 2/28 (agenda, conjuntos do Painel), web 3/30
(período das listas, instante do recebimento); `pnpm typecheck`. Sem smoke (nada visual), full
test, E2E, build global nem fresh (FAST).

**Achados** (BACKLOG, P3): TZ-DST-MIDNIGHT-GAP-01 — no dia em que o horário de verão começava à
meia-noite (04/11/2018), `limitesDoDiaComercial` abre às 23:00 da véspera e `instanteComercial`
de 00:00 a 00:59 cai na véspera, contra `diaCivil`; histórico, mantido idêntico de propósito.
TZ-LOCALE-STRING-REUSE-01 — `toLocaleString`/`toLocaleDateString` com opções criam formatador a
cada chamada (~54 µs): extensos do shared, CSV e textos da API, `web lib/dates.ts` (fechado,
seção própria).

## Campos numéricos pt-BR em todas as telas (PTBR-NUMERIC-INPUT-ROLLOUT-01, 2026-09-13)

A foundation de PTBR-NUMERIC-INPUT-FOUNDATION-01 em todo campo de entrada que é número real. Só
web: sem API, DTO, Decimal, banco, arredondamento de domínio ou migration. Leitura (tabela, card,
PDF) fica para PTBR-NUMERIC-DISPLAY-AUDIT-01. Regra de uso em `UI_BRAND.md`, "Campos numéricos e
valores pt-BR".

**Inventário.** 85 inputs crus em 37 telas e componentes (67 `inputMode="decimal"`, 15
`inputMode="numeric"`, 3 `type="number"`), 90 campos na tela: 18 inteiros (`IntegerField`); 42
decimais (40 quantidades com 12 casas, 2 potências com 4); 16 dinheiros (6 com 4 casas — preço do
Orçamento, preço faturado na linha e no diálogo, tarifa do recurso, totais do modelo de preço — e
10 com 8 — preço da OC, oferta, preço manual da faixa, valores por unidade do modelo, custo de
referência, custo efetivo); 13 percentuais (pureza, overage e pureza padrão com 6; desconto,
entrada, juros, reajuste, margem, comissão e percentuais do modelo com 4); e o valor do custo
adicional, dinheiro ou percentual conforme a base (4). Nenhum aceita negativo, nenhum é dinheiro de
2 casas. Ficaram texto, de propósito: CEP (com `inputMode="numeric"`, na allowlist), telefone,
CNPJ, número do endereço, código de barras, lotes, códigos, nota e documento, unidade e moeda.

**Regras.** O `scale` é o da coluna (`web lib/numeric-scales.ts`, espelho de `decimal-schema.ts`).
Valor da API entra no campo por `toPtBrEditText` — nunca cru: `1.234` da API é um vírgula duzentos
e trinta e quatro, e escrito no campo seria o ambíguo. A borda lê com o parser do campo:
`exigirDecimal`/`exigirDecimalOpcional` com `scale`, `decimalLegivel` (prévia) e `erroDoDecimal`
(mensagem), e `lerInteiroOpcional` passou a ser o mesmo parser com `scale: 0`;
`parseDecimalInput`, `isValidDecimalInput`, `mensagemDecimalInvalido` e `AJUDA_DECIMAL` saíram.
Pendência pelo valor: `decimalComparavel` lê o texto do campo e `decimalDaApiComparavel` o canônico
da API; Formulação (`rascunhoComparavel`), Roteiro e Projeto comparam números por valor (`250,50` =
`250.5`, `030` = `30`), e sair do campo não suja. Payload semanticamente igual: onde ia o texto cru,
vai o canônico (potência na criação do recurso, base da nova estrutura, quantidade planejada da
OP, entregas programadas, quantidade do PDF do CMV). Percentual continua em pontos. Os três
`type="number"` saíram com leitura estrita; "Dividir produção em" vazio ou `0` segue indo como 1,
como antes. Sair da linha do Orçamento lê o texto do campo, não o DOM — fora do foco ele mostra o
formatado (`2.000`). O plano de atendimento põe o complemento no outro campo em português.

**Fechados junto.** QUOTE-PERCENT-FIELDS-01: erro do percentual com `id` e `aria-describedby`, e à
vista entrada e juros escondidos não travam salvar nem vão à API. FORMULATION-DOSES-INPUT-01:
doses como `IntegerField`, leitura estrita na prévia, na validação e no envio (inteiro segue como
texto, `1e2` não entra).

**Guarda.** `campo-numerico-guarda.test.ts` virou proibição sobre o código de produção: nenhum
`type="number"`; nenhum `<input>` cru com `inputMode` decimal/numeric fora da allowlist (os dois
CEPs, com motivo); nenhum input de texto com nome de quantidade, preço ou percentual; nenhuma leitura
à mão (`parseFloat`, `parseInt`, `valueAsNumber`, `Number(event.target.value)`, troca de vírgula por
ponto) fora da allowlist (foundation, `decimal-format`, `CalcHint`); allowlist sem sobra.

**Validação.** Web: `formulacao-campos-numericos` (11: carga de `1.234` e `250.5`, 13ª casa,
colagem, letra, zero, vazio, doses, pureza), `condicoes-percentuais` (10), guarda (10), helpers
(`dirty-fields`, `integer-input`, `quantity-limit`, `decimal-input`) e 34 arquivos de tela
ajustados ao contrato novo — letra não entra, o ilegível é o `1.234` ambíguo, o campo mostra
`1.000`/`12,50` fora do foco. 14 mutações, todas derrubadas. Gate focado: 173 arquivos, 1912 testes
(componentes, libs, app e as 22 pastas de tela tocadas); `pnpm typecheck`. Smoke Playwright 390px no
Vite do worktree contra a API da 3333, sem gravar (escrita barrada, 0 tentativas): Formulação e
Política de precificação com rascunho real, OC e Pedido novos, Roteiro com rascunho simulado —
`type=text` com `inputmode` certo, 12·12,·12,3·12,34 sem reescrita, letra, sinal e casa a mais
barrados, colagem `1.234,56`/`1234.5`/`5,5%`, `1.000` ambíguo acusado, formatado fora do foco, página
sem rolagem horizontal: 60/60, console limpo. Sem full test, E2E, golden path, build nem fresh
(FAST).

**Achados** (BACKLOG): PTBR-NUMERIC-DISPLAY-AUDIT-01 (próxima) — `formatQuantity` sem milhar ao lado
do campo que agrupa, e leituras cruas vistas no caminho; ORDER-LINE-390-OVERLAP-01 — no Pedido novo
em 390px o seletor de produto cobre o campo de quantidade (igual na main); OP-PARTS-ZERO-COERCION-01
— partes vazio ou `0` viram 1 em silêncio (herdado, preservado); NUMERIC-FOCUS-API-ZEROS-01 — preço
de 8 casas servido com `toFixed` aparece `12,50` fora do foco e `12,50000000` no foco.

## Contrato de entrada e data padrão (INPUT-DATE-CONTRACT-WAVE-01, 2026-09-13)

Três achados confirmados, fechados juntos. Sem migration, sem mudança de rota nem de DTO.

**API-INT-COERCION-01.** Inteiro de escrita na API é lido como decimal inteiro canônico
(`apps/api/src/lib/integer-schema.ts`: `lerInteiroDecimal`, `inteiroDecimalSchema`). Dígitos com
menos opcional e espaço nas pontas; número JSON só se já for inteiro seguro. `Number()` e
`z.coerce.number()` aceitavam `"1e2"` (100), `"0x1E"` (30), `"+1"`, `"1.0"`, `"Infinity"` e
`true` (1) — agora 400. Vale para `optionalPositiveInt` de `projects.schemas.ts` (doses e vida útil
do Projeto; prazo, parcelas e intervalo do Orçamento) e de `lib/industrial-schema.ts` (Produto,
Formulação) e para o `dosesPerPackage` do Modelo. Mínimo, tetos de
`LIMITES_INTEIROS_DAS_CONDICOES`, ausente, null e vazio como antes. Único teste que dependia da
coerção permissiva: a caracterização de `projeto-inteiros-api.test.ts` (4 casos esperavam 200),
que passou a esperar 400 com o gravado mantido. Paginação (`page`/`pageSize`) ficou em
`z.coerce` — API-PAGINATION-COERCION-01.

**FORMULATION-TEMPLATE-PURITY-RANGE-01.** Regra canônica conferida no domínio (cadastro do Item,
componente da Formulação, PREC-MIG-C): pureza `0 < x <= 100`, até seis casas, vazio/null =
desconhecida. O componente do Modelo passou a usar o mesmo `optionalPurityPercent`; antes só
limitava casas, aceitava 0 e acima de 100, e vazio era 400. Overage do Modelo intocado.

**WEB-DATE-DEFAULT-TZ-01.** "Hoje" padrão é `hojeComercial()` em CMV (`ProductCmvPage`), impresso
do CMV (`CmvPrintPage`), referência do cálculo padrão (`CostCalculationSection`) e — mesmo achado,
listados no BACKLOG — resumo de custo do Produto (`ProductIndustrialCostSummary`) e vigência da
referência manual do Item (`ItemCostReferenceSection`). Data vinda da URL ou digitada não muda;
`costReferenceDate`/`effectiveFrom` continuam saindo do dia escolhido como antes.
TZ-DST-MIDNIGHT-GAP-01 intocado.

**Validação.** API (banco de teste isolado): `integer-schema`, `projeto-inteiros-api`,
`condicoes-inteiras-api`, `product-optional-fields`, `pureza-do-modelo-api` (17 entradas, Modelo e
Formulação), pastas `formulation-templates` e `formulations`, `business-day`,
`custo-no-dia-comercial`, `dia-comercial-em-uso` — 17 arquivos, 390 testes. Shared:
`business-timezone` e `fuso-comercial-formatadores` (34). Web: `data-padrao-dia-comercial` (47:
22:30, 23:59:59 e 00:30 de SP × UTC, Vancouver, Tóquio, offset conferido), `product-cmv`,
`base-calculada-impressos`, `cost-source-override`, `item-cost-reference-section`,
`product-cmv-access`, `oc-data-do-pedido`, `receipt-instant` — 9 arquivos, 92 testes. Mutação:
fonte revertida derruba 41 testes da API e 28 da web. `pnpm typecheck`. Sem full test, E2E, build
global nem fresh (FAST).

**Achados** (BACKLOG): API-PAGINATION-COERCION-01; TEMPLATE-PURITY-LEGACY-DATA-01 — Modelo antigo
com pureza fora da faixa passa a dar 400 ao salvar o rascunho; PROD não conferido.

## Listas e navegação: data digitada, falha × vazio, vazio em 390, troca de cliente e volta do cadastro (LISTS-NAVIGATION-UX-WAVE-01, 2026-09-13)

Seis achados pequenos, só web. Sem API, sem migration.

**LISTS-FILTER-INPUT-UX-01.** `DateRangeFilter` (Faturamento, OC, Recebimentos, Produto Acabado)
separa as datas digitadas do período aplicado, o conceito de `useFiltrosDigitados`: aplica depois
de 300 ms sem digitar (`PAUSA_DO_PERIODO_MS`) ou no Enter, as duas pontas juntas, e só com as duas
aplicáveis — segmento pela metade (`validity.badInput`) e ano começando em 0 (0002/0020/0202) não
saem. Apagar a data inteira abre a ponta, como antes. Período invertido é aplicado e recusado: a
lista não consulta e a recusa aparece. Atalho aplica na hora; período aplicado por fora (Limpar)
substitui o digitado.

**LISTS-ERROR-FALSE-EMPTY-ADMIN-01.** Usuários e Documentos controlados: vazio só sem erro, e
recarregar limpa a falha anterior.

**LISTS-EMPTY-ROW-390-01.** `ListStatusRow` põe o conteúdo em `.table__empty-body`, com a largura
visível do contêiner (`100cqi`; container query só em `.table-container:has(td.table__empty)`) e
preso à esquerda da rolagem; `.table td.table__empty` quebra linha. Célula com `colspan` tem a
largura da tabela (1037px em Clientes, em 390) e ignora `max-width` — `white-space` sozinho não
mudava a medida. Tabela com linhas não muda.

**CONSULTATION-CUSTOMER-SWITCH-QUERY-01.** `ConsultationShell` guarda resumo, 404 e falha com o
`customerId` e deriva no render: a aba só monta com o resumo do cliente da rota e consulta uma vez;
resposta atrasada do cliente que saiu é descartada.

**CONTEXT-ORIGIN-LABEL-ROUTE-01.** `rotuloDaOrigem` (exportado) conhece
`/planejamento/perfis-producao`: "← Voltar para Roteiro de produção".

**F-11-1.** `EntityLink` para cadastro em lista com modal (produto, item, cliente, fornecedor) leva
`voltar` com a rota e a busca atuais (`rotaComRetorno`, `lib/contextual-create.ts`); o aviso de
lista reduzida (`RecordContextChip` e o de Produtos) mostra "← Voltar para …" (`RetornoDoContexto`)
quando a URL traz `voltar` interno (`isRotaInterna`). Sem token, armazenamento nem pilha: é a URL.
Link de documento e de menu não mudam. Com o modal aberto por `open`, a volta fica no aviso, depois
de fechar o modal.

**Validação.** Web: `DateRangeFilter` (6), `admin-falha-e-vazio` (4), `linha-de-vazio-390px` (3),
`troca-de-cliente-uma-consulta` (2 — o shell antigo derruba os dois), `rotulo-da-origem` (3),
`entity-link-retorno` (4), mais `components`, `list-query`, `contextual-create`, `admin`,
`customer-consultation`, `contato-do-cliente-no-projeto` (href com `voltar`),
`listas-consulta-em-curso-restantes`, `periodo-invertido-listas`, `referencia-e-link` — 32
arquivos, 458 testes, depois do rebase. `pnpm typecheck`. Smoke Chromium (`--lang=pt-BR`, Vite do
worktree contra a API dev, não-GET barrado): digitar 10/09/2026 = 0 consultas durante e 1 depois;
Enter, 1 na hora; invertido, 0 com a recusa; vazio de Clientes dentro do contêiner em 390 (texto
37–341 em 12–378; antes 25–437) e em 1440; células comuns `nowrap`; Usuários e Documentos com 500
simulado sem vazio; troca de cliente com 2 consultas de B no dev com StrictMode (main: 3); rótulo do
Roteiro; Projeto → Cliente → "← Voltar para Projeto" → Projeto; Clientes pelo endereço sem volta —
29/29, console limpo. A main de antes, no mesmo roteiro, cai em 12. Sem full test, E2E, build
global nem fresh (FAST).

**Achados** (BACKLOG): LISTS-EMPTY-ROW-390-RAW-01 — linha de vazio escrita à mão, fora do
`ListStatusRow`, não ganhou o corpo com a largura visível.

## Edição do usuário e feedback depois da ação (EDITING-INTEGRITY-WAVE-01, 2026-09-13)

Quatro achados confirmados, fechados juntos. Só web: sem API, domínio, migration nem redesign.

**ROUTE-DRAFT-SAVE-INFLIGHT-EDIT-01.** Roteiro de Produção: preservar, não bloquear — os campos
seguem editáveis durante "Salvar rascunho", como já era durante "Salvar identificação". A ação
que grava o rascunho (salvar, ativar, criar versão) guarda a assinatura da tela no clique; na
releitura, tela igual à do clique recebe o servidor normalizado (`250,5`, `030`, nome aparado),
tela diferente fica como está, pendente contra o GRAVADO — salvou 500, digitou 700 no ar: fica
700, "Alterações não salvas", "Ativar versão" preso e a guarda pergunta; voltar a 500 limpa. As
outras ações seguem a regra de ROUTE-IDENTIFICATION-SAVE-DRAFT-01; restauração contextual
intocada.

**TEMPLATE-ROW-DROP-01.** Modelo de Formulação: linha começada (item sem quantidade ou quantidade
sem item) prende "Salvar rascunho" — mensagem na própria linha ("Informe a quantidade deste
componente ou remova a linha." / "Escolha o item…"), `aria-invalid` + `aria-describedby` no
campo e foco nele. Nada é inventado; só a linha em branco continua fora do payload e fora da
pendência. Corrigir ou remover a linha apaga o aviso.

**PROJECT-RELOAD-ERROR-01.** Ficha do Projeto: só `NotFoundApiError` (404) vira "Projeto não
encontrado". Rede ou 500 na releitura mantém a ficha com o alerta "Não foi possível carregar o
projeto agora. A ficha abaixo pode estar desatualizada." e "Tentar novamente"; na primeira carga,
o mesmo alerta sem ficha. Leitura boa limpa o alerta.

**FORM-ERROR-VISIBILITY-01.** Pedido e OC: erro de AÇÃO (salvar, prazo/previsão, confirmar,
cancelar; no Pedido também plano, OCs, reserva, realocação, expedição e OP do saldo) passa por
`avisarErro`, que traz o alerta único do topo à vista (`scrollIntoView`) e dá foco a ele
(`tabIndex=-1`). Erro de carga não rola a tela. Com o diálogo de cancelamento aberto, o erro
aparece dentro dele (o do topo não é renderizado); abrir o diálogo limpa erro antigo.

**Validação.** Web focado (roteiro, roteiro-volta-do-cadastro, pastas `formulation-templates`,
`projects`, `customer-orders`, `purchase-orders`, `unsaved-changes*`): 50 arquivos, 588 testes
antes do rebase e de novo sobre a main final (447ad15, depois de dois rebases); no rebase
intermediário caiu a falha conhecida de `envio-com-linha-nao-salva` ("duas linhas…"), que passou
3/3 isolada. Novos: `roteiro-de-producao` ("Edição durante a
gravação do rascunho", 2), `modelo-linha-incompleta` (3), `projeto-recarga-com-erro` (6),
`pedido-`/`oc-confirmar-grava-antes` ("erro de ação vem à vista", 3 cada). Mutação: 13 derrubadas
(as quatro telas da main, tela do clique trocada pela pendência antiga ou lida na resposta, sem
foco no campo que falta, 404 como transitório, alerta que não limpa, sem foco no alerta, alerta
do topo com o diálogo aberto, confirmar sem `avisarErro`). Smoke 390px no navegador real, sem
gravar (confirmar e PATCH respondem 409 simulado, o resto abortado): Pedido e OC, confirmar e
salvar — alerta à vista (topo 186–265 px de 844), com foco, um só, `scrollWidth` 390; a main no
mesmo script deixa o alerta em −331 a −387 px e sem foco. `pnpm typecheck`. Sem full test, E2E,
build global nem fresh (FAST).

## Paginação da API é inteiro decimal (API-PAGINATION-COERCION-01, 2026-09-14)

Só API, só validação. Sem migration, sem mudança de rota, DTO, web ou tamanho de página.

`page`/`pageSize` das 28 consultas paginadas (26 arquivos `*.schemas.ts`, 56 campos; `paginationFields`
dos relatórios conta como uma) liam `z.coerce.number()`: `?page=1e1` abria a página 10,
`?pageSize=0x10` devolvia 16 linhas e `?page=99999999999999999999` passava (página sem teto). Agora
usam `inteiroDeConsultaSchema({ minimo, maximo?, padrao })` de `lib/integer-schema.ts`, que reaproveita
`inteiroDecimalSchema` e aplica a mesma faixa e o mesmo padrão de antes. Aceita `1`, `10`, `007`, espaço
nas pontas e número JSON inteiro; recusa com 400 `validation_error` expoente, hex, binário, decimal,
vírgula, `+1`, `Infinity`, `NaN`, texto, vazio, acima de 2^53, booleano e parâmetro repetido. Ausente
segue 1 e 20 (25 nos relatórios); mínimo 1; tetos 100, 500 (relatórios) e 1000 (catálogos de seletor).

**Validação.** `modules/paginacao-da-consulta.test.ts` (matriz das 28 consultas, rotas `/items`, `/users`,
`/reports/inventory/position` com 400 e 200, guarda estrutural contra `page`/`pageSize` montado direto no
zod e contagem que obriga consulta nova a entrar na matriz) e `integer-schema` — 800 testes; com
`items`, `items-search-alem-da-primeira-pagina`, `list-filter-options`, `reports-dia-comercial`,
`r20-autorizacao`, `customers`, `exports`, `lots`, `purchase-orders`, `customer-orders` — 12 arquivos,
945 testes, banco de teste isolado. Mutação (`page` de Itens de volta a `z.coerce`): 12 derrubadas —
matriz, rota e as duas guardas. `pnpm typecheck`. Sem full test, E2E, build global nem fresh (FAST).

**Achados** (BACKLOG): API-INT-COERCION-REMAINING-01; INVENTORY-EXPORT-ONLY-WITH-STOCK-01.

## Datas por extenso num formatador guardado (TZ-LOCALE-STRING-REUSE-01, 2026-09-14)

Só custo. Texto, fuso, dia civil, cálculo, DTO, rota, banco e migration intocados;
TZ-DST-MIDNIGHT-GAP-01 fora.

`toLocaleString`/`toLocaleDateString` com `{ timeZone }` criavam um `Intl.DateTimeFormat` por
chamada (~55 µs; o V8 só guarda o dele sem opções). `business-timezone.ts` ganhou duas formas de
leitura no mesmo cache de TZ-FORMATTER-REUSE-01 (forma + fuso, até 16 fusos, só o formatador):
data e hora e dia, `pt-BR`, com as opções que o `toLocale*` preenche sozinho (`numeric`).
`instanteComercialPorExtenso` e `diaDoInstantePorExtenso` passam por elas, e a nova
`dataCivilPorExtenso` (dia em UTC) substitui as cópias de `toLocaleDateString("pt-BR", { timeZone:
"UTC" })`: `csvDate`, `diaComercialPorExtenso`, `diaDaVigencia` (fonte de custo), validade da
Atenção, vencimento da origem de preço e `formatDate` do Orçamento na web. Data inválida segue
`"Invalid Date"`. Na web, `formatDate`/`formatDateTime`/`formatEventDate` usam os mesmos; o
fallback de `formatDate` para valor com hora continua no fuso do navegador, agora sem opções
(`undefined`, não `{}`), o que deixa o V8 reusar o formatador dele.

**Medida** (200 mil datas de 1900 a 2100, antigo e novo intercalados, Node 24, antes e depois do
rebase): instante por extenso ~56–60 → ~3 µs, dia do instante ~55–57 → ~1–3 µs, data civil ~56–59 →
~1,1–1,4 µs, fallback da web ~52–114 → ~0,9–2,4 µs; CSV de 10 mil linhas com três datas ~1,4 s →
~44 ms, bytes iguais. 0 divergências nas duas rodadas.

**Validação.** `shared extenso-formatador.test.ts` (anterior copiado × novo com UTC, São Paulo,
Vancouver, Tóquio e Etc/GMT+7 no processo, deslocamento conferido: anos 0001 a 99999, meia-noite
UTC, ±1 ms das bordas, cada minuto em volta das viradas de verão de São Paulo, viradas de
Vancouver, hora local média de 1914, `"Invalid Date"`; valores à mão; um formatador por forma e
fuso) e `web lib/dates-formatador.test.ts` (as três funções, ISO completo/curto/com deslocamento,
inválido e vazio, nos cinco fusos). 4 mutações derrubadas. Focados: shared 4 arquivos, API 11 +
serial 3 (fonte de custo, dia comercial, exports, CSV do custo, formação de preço, Painel),
web; `pnpm typecheck`. Sem full test, E2E, build global nem fresh (FAST).

## Leitura numérica pt-BR em tela e PDF (PTBR-NUMERIC-DISPLAY-AUDIT-01, 2026-09-14)

Só apresentação. API, banco, cálculo, `Decimal`, arredondamento de domínio, datas e campos
intocados; sem migration.

**Decisão.** `formatQuantity` agrupa milhar (`1.234,5`), como o campo fora do foco — a mesma
informação não tem mais duas caras. O motivo antigo (copiar de volta) cai no caso comum:
`1.234,5` é lido pelo parser do campo; só `1.234` sozinho, em campo decimal, é recusado como
ambíguo, com mensagem. `resolverQuantidadeContraLimite` tira os pontos do exibido antes do
round-trip (teto `1233,9999999` exibido `1.234` continua "usar tudo"). Horas de
`formatMinutes` também agrupam. `formatIntegerPtBr` aceita `number` para contagem.

**Corrigido** (a guarda contou 79 leituras cruas antes; o smoke achou mais 8 no Pedido):
recurso industrial (potência em 4 casas, tarifa vigente e histórico por `formatMoneyPtBr`,
capacidade, contagem de tarifas); Estrutura de Custos (tarifa de referência e congelada,
premissa R$/% em 4 casas, pureza e overage em 6); templates de custo (premissa pela base);
consumo extra (saldo livre do lote); Pedido (Disponível do Plano de Atendimento, reservado
restante, ainda a reservar, disponível atual, expedido e falta expedir, quantidade fora de
edição, em compra, total da OC, faixa do preço acordado, somas do Faturamento por `Decimal`
em vez de `Number`); OP (estoque não liberado por `Decimal`); Orçamento (quantidade fora de
edição); ofertas de fornecedor (preço em 8 casas, mínimo 2) e custo de hoje do item;
relatórios de custo, produção e comercial (percentuais por `formatPercent`, variação,
quantidade orçada, reservado); explicação da Formulação (pureza, overage, doses, fator);
precificação e CMV (lote mínimo, lotes); contagens (total das listas, rodapé e resumo de
relatório, Painel, células de tabela); anexos (MB com vírgula); PDFs (unidades de caixa,
lotes da faixa, recursos, inteiros da grade, registros, linhas, partes).

**CSV não mudou**: `csvDecimal`/`csvMoney`/`csvUnitPrice` da API já escrevem vírgula decimal
sem milhar — contrato de planilha, e a rodada não toca API. **Identificadores** (código, lote,
CNPJ, CEP, documento) continuam texto; nenhum formatador novo passa por eles.

**Guarda**: `web components/leitura-numerica-guarda.test.ts` proíbe `R$ ${…}`/`R$ {…}`,
`{valor}%` cru, decimal de domínio interpolado (lista fechada mais `*Quantity`, inclusive
`find(...)?.campo`), soma `+ Number(…Quantity), 0)` exibida e `{total} {total === 1`, com
allowlist justificada. Não vê variável solta nem ternário — resíduo em
PTBR-NUMERIC-DISPLAY-RESIDUAL-01.

**Validação.** Helpers: milhar, decimal, 12 casas, dinheiro, percentual, zero, null, acima de
um milhão, `1e21` e `1.5e-3` sem notação científica, round-trip do teto. 28 asserções de tela e
PDF passaram de `1000` para `1.000` (e do `12.000000` cru da API para `12`). Focados web depois
do rebase: 212 arquivos, 2426 testes; `pnpm typecheck`. Smoke 390 px (Vite do worktree contra a
API dev, só GET, valores inflados por `route` para `1.234.567,891`): Recurso Industrial,
Estrutura de Custos, Pedido e Orçamento sem transbordo (`scrollWidth` 390), sem notação
científica, sem número de 4+ dígitos sem milhar, console limpo, 0 escritas. Sem full test, E2E,
build global nem fresh (FAST).

## Booleano e inteiro estritos na API (API-STRICT-SCALAR-CONTRACT-WAVE-01, 2026-09-14)

Só API, só validação. Sem migration, rota, DTO nem mudança de tela. Fecha
INVENTORY-EXPORT-ONLY-WITH-STOCK-01 e API-INT-COERCION-REMAINING-01.

**Estoque.** `onlyWithStock` lia `z.coerce.boolean()`, e `Boolean("false")` é `true`. O `ExportCsvButton`
do Estoque manda a caixa desmarcada como `onlyWithStock=false`: o CSV saía só com os itens com saldo.
Reproduzido pela rota antes da correção (`false` devolveu só o item com estoque). Agora
`booleanoDeConsultaSchema` (`lib/boolean-schema.ts`): `"true"`/`"false"` exatos, booleano real para
quem chama o schema no código; `0`, `1`, `yes`, `no`, `on`, `off`, maiúsculas, espaço, vazio e texto são
400. Listagem e CSV: `true` só com estoque, `false` e ausente com todos (quem tem posição primeiro, como
antes). A tela não mudou — já mandava o literal certo. Era o único `z.coerce.boolean()` da API.

**Inteiros restantes.** `capacityQuantity` (Recurso industrial), minuto do dia (jornada e exceções do
Calendário) e `numberOfParts` (OP) leem `inteiroDecimalSchema(mensagem).pipe(z.number().min().max())`:
`1e1`, `0x10`, `0b10`, `1.0`, `12.5`, `12,5`, `+1`, `Infinity`, `NaN`, `10abc` e booleano são 400 (antes
`"1e1"` gravava 10 e `true` gravava 1). Faixa, `nullish`/opcional, vazio como "não informado" do
Calendário e mensagens de faixa intocados. Zero e vazio em `numberOfParts` seguem 400 — a troca por 1 é da
tela (OP-PARTS-ZERO-COERCION-01, fora desta rodada). Booleano, `null` e `NaN` param na união texto|número
com a mensagem genérica do zod, ainda 400.

**Guarda.** `lib/escalar-estrito-guarda.test.ts`: nenhum fonte de produção da API usa
`z.coerce.boolean()` nem `z.coerce.number()` com `.int()` na cadeia (uma linha ou quebrada, comentário
não conta); única exceção `config/env.ts` (portas do boot), com contagem que não deixa a lista envelhecer.

**Validação.** `boolean-schema`, `integer-schema`, guarda, `exports` (cenário A com estoque × B sem, CSV e
listagem, 10 valores recusados), `inventory`, `industrial-resources`, `paginacao-da-consulta` — 15 arquivos,
1118 testes; faixa serial `production-calendar`, `production-schedules`, `gmp-execution` — 84 testes, com
400 sem gravação (valor lido do banco antes e depois, contagem de OP/recurso/exceção); web
`estoque-exportar-somente-com-estoque` (href do "Exportar CSV" desmarcado `false`, marcado `true`) e
`operational-hardening` — 11 testes. Mutações: 8 de 8 derrubadas (coerção de volta nos quatro campos,
helper aceitando `"0"`, mínimo 0 na capacidade e nas partes, botão omitindo `false`). `pnpm typecheck`.
Sem full test, E2E, build global nem fresh (FAST).

**Achados** (BACKLOG): REPORTS-QUERY-BOOLEAN-PERMISSIVE-01; CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01.

## PRINT-CORRECTNESS-WAVE-01 — filtros do PDF pelo contrato do relatório; linha da FO-03 (2026-09-14)

Fecha REPORTS-PRINT-UNACCEPTED-FILTER-01 e FO03-ROW-SITUATION-01. Só web; API, schema e
migration intocados.

**Relatórios em PDF.** `reportAppliedFilters` montava "Filtros aplicados" com toda chave da URL
e `nomesDosFiltrosPorId` consultava todo id presente: `R-08?customerId=…` escrevia "Cliente:
CLI-… · Razão social" sobre OCs de todos os clientes (a API descarta a chave), e `foo=bar` saía
como veio. Agora cada definição de `REPORT_PRINT_DEFINITIONS` declara `filterKeys` — as chaves do
schema da API, sem paginação — e, quando o serviço só lê a chave em certa combinação,
`filterAppliesWhen` (R-02: `from`/`to` só com `window=CUSTOM`). Filtro e consulta de nome passam
pela mesma `filtroAceito`; o resto (rótulo, `filterValues`, nome resolvido de
REPORTS-PRESENTATION-WAVE-02, "—" sem nome) não mudou. O CSV continua recebendo a URL inteira.
A lista é cópia manual do schema — REPORTS-PRINT-FILTER-KEYS-DRIFT-01.

**FO-03.** Coluna Qualidade por `situacaoDoLote` (a mesma de FO-01/FO-02): vencido manda.
Pendência descreve o laudo com os rótulos da tela Documentos / CoA (decisão do PO): PENDING
"Pendente de documento", RECEIVED "Aguardando análise", REJECTED "Laudo rejeitado" — nunca
"Aguardando liberação". Recorte `onlyPending`, paginação, ordem, total e `loadAllPages`
intocados; PAGED-DOCUMENT-SNAPSHOT-01 segue aberto, sem piora.

**Validação.** Matriz `web pages/print/report-print-definitions.test.ts` (18 relatórios: aceito
aparece; de outro relatório, desconhecido, paginação e vazio não; id aceito × não aceito;
R-02 condicional; chave do protótipo). Mutação: contrato ignorado → 24 falhas; `LOT_STATUS_LABELS`
cru na FO-03 → falhas no conteúdo e no arquivo. Focados (print, relatórios, folhas, CoA): 199
passam; 1 falha anterior à rodada na `main` limpa (PRICING-PRINT-THOUSANDS-TEST-01).
`pnpm typecheck`. Smoke (Vite do worktree contra a API dev, só GET, PDF real lido): R-08 com
cliente e `foo=bar` — main declarava o cliente, worktree não declara nem consulta; R-20 com
cliente aceito sai pelo código, sem id; FO-03 com fila simulada — normal, vencido, recebido,
rejeitado com os textos acima; console limpo, 0 escritas. Sem full test, E2E, build global nem
fresh (FAST).

## Linha do Pedido e vazio de seção em 390px (SMALL-MOBILE-UX-WAVE-03, 2026-09-14)

Só web: sem API, domínio, `NumericField`, migration nem redesign. Fecha ORDER-LINE-390-OVERLAP-01 e
LISTS-EMPTY-ROW-390-RAW-01.

**Linha do Pedido.** Reproduzido na main: em 390px a tabela `table-layout: fixed` deixava a coluna Produto
com ~60px, e o seletor, preso ao mínimo de 15rem de `td .entity-select`, saía da célula por cima da
Quantidade (seletor x 50–290, campo x 82–259); o toque na quantidade abria a busca de produto. Com linhas
editáveis, a tabela ganha `table--order-lines--editable`, e abaixo de 640px a linha empilha em grade:
Produto na largura toda; Quantidade, unidade e remover na linha de baixo, cada um na sua trilha. Sem posição
absoluta nem transform; títulos das colunas recortados da vista, quantidade com nome próprio
("Quantidade de …"). Pedido só leitura e desktop seguem a tabela (1280 e 1440 com a mesma geometria de antes).

**Vazio de seção.** 49 linhas `td.table__empty` escritas à mão em 33 arquivos (seções e detalhes:
`SupplierItemsSection`, Lote, OP, Custos, Quadro, Calendário…) não tinham o `.table__empty-body` do
`ListStatusRow`: em 390px o link "Vincular em Compras → Item × Fornecedor" ia de x=351 a 618 com a borda em
349, e a frase do recurso sem tarifa terminava em 625. Todas eram vazio real e passaram por
`TableEmptyRow` (`web components/TableEmptyRow.tsx`), que o `ListStatusRow` também usa — nenhuma exceção.
CSS não mudou: a mesma estrutura central de LISTS-NAVIGATION-UX-WAVE-01; células comuns seguem `nowrap` e
tabela com dados segue rolando.

**Guarda.** `web components/linha-de-vazio-escrita-a-mao.test.ts`: `table__empty` em fonte de produção
fora do `TableEmptyRow` cai.

**Validação.** Web: `linha-de-vazio-390px` (frase longa, link e botão no corpo, Tab alcança os dois),
guarda, `produto-do-cliente-do-pedido` (modificador, células próprias, regra da grade), pastas
`customer-orders`, `items`, `suppliers`, `customers` e as telas com frase de vazio em teste — 30 arquivos.
Mutações: `table__empty` num fonte e grade sem `min-width: 0` — 2 de 2 derrubadas. `pnpm typecheck`. Smoke
Playwright 390 (toque real) e 1440 contra a main e o worktree: Pedido novo com linha (área de sobreposição
3717 → 0; tocar Quantidade foca o campo e não abre Produto; tocar Produto abre a lista), Clientes filtrado
(botão), `SupplierItemsSection` (link dentro de 42–349, clicável e navegando), recurso sem tarifa e
exceções do Calendário (frases longas dentro do contêiner); `scrollWidth` = viewport, 0 escritas, console
limpo. Sem full test, E2E, build global nem fresh (FAST).

## Custo e precificação sem pergunta a mais (COST-PRICING-CLARITY-WAVE-01, 2026-09-14)

Fecha COST-RESOURCE-EDIT-01, PRICING-MODEL-DIFF-01, PRICING-ACTIVATE-CONFIRM-01, F-04-1 e F-05-1. Sem
migration, sem mudança de fórmula, Decimal, arredondamento, legado `P = C ÷ (1 − m − c)`, Modelo flexível,
impostos ou qualidade de custo. Nenhum arquivo de PDF, impressão ou relatório tocado.

**Linha de recurso editável (§87).** `PATCH /industrial-cost-resource-usages/:id` troca tempo e/ou
quantidade de recursos da MESMA linha — id, recurso e ordem ficam; corpo estrito (recurso não se troca: a
linha é o recurso na estrutura), mesmas regras de criar (rascunho; >1 só mão de obra e equipamento; inteiro
≥ 1). Na tela, "Editar recurso" no menu da linha abre os dois campos ali mesmo (energia só o consumo), com
Salvar/Cancelar; salvar sem mudança fecha sem gravar; edição alterada entra na guarda de saída.

**Diff do Modelo (§84).** "Comparar versões" da política compara, além das faixas, o modo do custo
industrial e o valor que ESSE modo lê, o modo dos impostos e o valor dele, e a gestão externa (entrada
`MODEL_CHANGED`, "Modelo alterado"). Fora, de propósito: valor de modo desligado (não entra em preço) e
perfis tributários (só sugerem). Valor normalizado (`12.0000` = `12`); rótulo da versão é título, não
diferença.

**Confirmação de ativação (§84).** A faixa recalculada serve `pricingCostQuality` — a qualidade que
`activatePricingVersion` pesa. A tela pede "custo incompleto" por ela (sem o campo, vale `costQuality`, como
antes): Modelo que ignora a conversão ativa sem pergunta mesmo com cálculo parcial.

**Textos.** F-04-1: "A soma da margem e da comissão deve ser menor que 100%" (e a variante com impostos)
na API, no motor do shared e na prévia — 100% e 105% têm a mesma recusa. F-05-1: Precificação diz que preço
e receita são técnicos e que o orçamento fecha o preço na precisão comercial (quatro casas), então a
diferença de centavos é arredondamento; o Orçamento diz o mesmo na frase da faixa vigente, sem mexer no
layout.

**Validação.** Web: `industrial-costs/editar-linha-de-recurso` (duração, 2 → 3 → 1, zero/vazio, cancelar,
sem mudança, energia, guarda), `pricing/precificacao-clareza` (sem/com confirmação, leitura antiga, F-05-1),
`faixa-previa` (100% e 105%), `quote-cmv` (frase) — pastas industrial-costs, cost-templates, pricing e
components: 42 arquivos, 431 testes. API: `quantidade-de-recursos` (mesma linha e ordem, R$ 100 → 150,
3,5 h, energia derivada 30 → 40 kWh, energia direta, versão ativa 409, 404, dez corpos inválidos),
`pricing-policy-diff` (idêntico, só rótulo, faixa, modo+valor, impostos e gestão externa, escala, modo
desligado, os dois), `pricing-model-flex` (DTO e compare pela rota) + precificação, CMV e formação de preço
do orçamento: 17 arquivos, 287 testes; shared 29. Mutações: 11 de 11 derrubadas. `pnpm typecheck`. Smoke
Playwright em banco isolado (API e Vite do worktree), antes e depois do rebase: edição real da linha (só
PATCH, ids e ordem iguais, R$ 480), confirmação necessária no Modelo padrão parcial e ausente no Modelo que
ignora a conversão (ativação real 200), mensagem 105% na prévia, as duas explicações F-05-1; 390px sem
rolagem do documento; console limpo — 24 de 24. Sem full test, E2E, build global nem fresh (FAST).

## Envio pergunta pelo custo que formou o preço (QUOTE-SEND-CONFIRM-QUALITY-01, 2026-09-14)

Fecha o achado de COST-PRICING-CLARITY-WAVE-01. Sem mudança de fórmula, qualidade do CMV, regra de ativação,
auth ou segurança.

**Snapshot (§84).** `PricingTier.pricingCostQualitySnapshot`, anulável — migration aditiva
`20260925093025_pricing_tier_pricing_cost_quality`, sem backfill. A ativação grava a qualidade que o servidor
já pesa (`effect.pricingCostQuality`), nunca valor do navegador; `costQualitySnapshot` segue sendo a do
cálculo — fatos diferentes, os dois congelados. A faixa ativa serve o snapshot em
`PricingTierDTO.pricingCostQuality`; faixa anterior ao campo fica nula e o DTO não inventa.

**Envio.** `buildLineSnapshots` pede confirmação por `pricingCostQuality ?? costQuality`: Modelo que ignora a
conversão, com cálculo parcial e base de preço completa, envia sem pergunta; base parcial ou sem custo
continua pedindo; faixa antiga usa a do cálculo, como antes. A proveniência viva da linha serve
`pricingCostQuality`; a linha enviada não a congela (o `costQualitySnapshot` da linha segue do cálculo).
`QuoteVersionsSection` antecipa a confirmação e rotula a linha pela mesma qualidade, sem recalcular.

**Validação.** API `projects/envio-qualidade-do-custo-do-preco` — padrão completa, padrão parcial (409 →
confirmado 200), Modelo IGNORE sem confirmação, imutabilidade depois de Modelo, compra, tarifa, cálculo e
formulação novos, e matriz de 7 combinações preço × cálculo pelo banco (faixa antiga nula incluída): 11. Web
`projects/envio-qualidade-do-custo-do-preco`: 7. Mutação (decidir pela `costQuality` no servidor e na tela):
derrubou 6 de 11 e 4 de 7 — exatamente os casos em que as qualidades divergem. Gate FAST: API pricing +
projects + `pricing-model-flex` 19 arquivos/344 testes; web projects + pricing 28/335; `migration-order` e
`migration-prefix` 19; `pnpm typecheck`. Migration aplicada no banco isolado do worktree. Sem full test,
E2E, golden path nem `validate:migrations:fresh` (FAST).

## Booleano de query estrito em Relatórios e Materiais de clientes (QUERY-BOOLEAN-STRICTNESS-WAVE-02, 2026-09-14)

Só API, só validação: sem migration, rota, DTO nem tela. Fecha REPORTS-QUERY-BOOLEAN-PERMISSIVE-01 e
CUSTOMER-MATERIALS-ONLY-WITH-BALANCE-PERMISSIVE-01 sobre `booleanoDeConsultaSchema` (`lib/boolean-schema.ts`),
sem parser novo.

**Relatórios.** `booleanFlag` (`onlyWithBalance` de R-01/R-02, `onlyShortage`, `includeCost`) e `all` (os 16
relatórios paginados) liam todo texto fora de `false`/`0`/`no`/vazio como `true`. Reproduzido pela rota antes da
correção: `all=1|yes|on|off|abc|TRUE| true` devolvia o relatório inteiro em vez da página, e o mesmo texto em
`onlyWithBalance` escondia o item sem saldo, no JSON e no CSV; `0`, `no`, vazio e espaço valiam `false`. Agora
`booleanoDeConsultaSchema().default(<padrão>)`: `"true"`/`"false"` exatos (booleano real no código), ausente com o
padrão de antes (`onlyWithBalance` true; `onlyShortage`, `includeCost` e `all` false), o resto é 400 no JSON e no
CSV que o PDF lê. As telas já mandavam `String(boolean)` e a impressão `all=true`: web intocada.

**Materiais de clientes.** `onlyWithBalance` lia todo texto fora de `"true"` como `false`: `?onlyWithBalance=1`
listava o lote zerado, na lista e no CSV. Agora `booleanoDeConsultaSchema().default(false)`: ausente continua sem
filtro, `true` só com saldo, `false` todos, o resto 400. A tela manda `true` ou omite.

**semRoteiro.** Intocado — `1`/`0`/`true`/`false` de propósito (link do Dashboard e do Quadro). Exceção declarada
na guarda, com `activeOnly` dos Roteiros (`true`/`1` escritos no schema).

**Guarda.** `lib/escalar-estrito-guarda.test.ts` interroga cada campo de cada schema exportado (`*.schemas.ts`,
import dinâmico) pelo que ele aceita, não pelo jeito de escrever o parser: campo onde texto de URL vira booleano
aceita só `"true"`/`"false"`; `1`/`0` a mais só nas exceções declaradas; outro texto só na lista de dívida; as duas
listas reprovam entrada velha. Fora dos schemas, comparar texto com `"true"`/`"false"` à mão (ou `.includes` numa
lista de falsos) só no helper e na rota de anexos. Varredura: 40 schemas, 40 booleanos de URL — 32 estritos, 2
legado explícito, 6 permissivos em dívida; um deles a busca por texto não achava (`archived` das Políticas de
preço, herdado por `.extend`).

**Validação.** Antes da correção, os testes novos derrubaram 285 de 540 (matriz de schema, 10 casos de rota e a
guarda). Depois: `boolean-schema` (20 flags de relatório e o material do cliente: ausente, `true`, `false`,
booleano real, 18 recusados), `escalar-estrito-guarda`, `reports-booleanos-de-consulta` (efeito do `false` e do
`all` pela rota; 8 casos × 12 valores, JSON e CSV), `customer-materials-booleanos` (lista e CSV) — 4 arquivos, 540
testes, de novo depois do rebase. Regressão antes do rebase (a main nova não toca esses módulos): pastas reports,
inventory, exports e customer-consultation, com paginação, período invertido, material do cliente sem corte e
documentos da Qualidade — 25 arquivos, 1680 testes. Mutações: 3 de 3 derrubadas (posição ignorando `false`,
material sempre filtrado, `all` ignorando `true`). `pnpm typecheck`. Sem full test, E2E, build global nem fresh
(FAST).

**Achado** (BACKLOG): QUERY-BOOLEAN-PERMISSIVE-REMAINING-01.

## PDF da Precificação conta a história do Modelo (PRICING-MODEL-VIEW-01, 2026-09-14)

Só web, só o PDF de Precificação: sem API, schema, migration, conta de preço, Decimal, arredondamento,
`pricingCostQuality`, ativação, Orçamento nem relatório. Fecha PRICING-MODEL-VIEW-01 e
PRICING-PRINT-THOUSANDS-TEST-01.

**Antes.** Com Modelo não padrão o papel imprimia o custo do cálculo por unidade ao lado de preço, markup e
contribuição formados sobre outro custo, sem dizer o que o Modelo considerou. No texto do PDF real: R$ 0,85/un
saía "1.000 un R$ 12,87 … R$ 18,73 … 58,73%" (markup sobre R$ 11,80); imposto de 8% sobre a venda formava
R$ 23,41 sem nenhum 8% no papel; custo industrial fora da conta, com cálculo parcial, imprimia "margem não
calculável" acima da margem de 32% impressa; gestão externa mostrava R$ 12,87 com preço formado sobre R$ 10,95.

**Depois (§84).** Seção "Modelo de Precificação": o padrão em uma linha ("Modelo aplicado: Padrão — o preço se
forma sobre o custo do cálculo; impostos estimados não entram na conta."); o flexível em três — custo
industrial no preço, impostos estimados (% sobre a venda "no divisor do preço"; R$ "somados ao custo p/
preço") e custos adicionais administrados externamente —, mais "Política de origem" quando houver. Modo
desligado não imprime valor guardado; gestão externa escreve "Fora da conta". Com Modelo flexível, a tabela de
faixas usa "Custo p/ preço/un" (o `pricingCostPerUnit` que a API serve, congelado ou vivo), a de custo mostra
"Custo do cálculo da faixa" e "Custo do cálculo/un", a nota define os dois e diz que não precisam ser iguais, e
o cabeçalho diz "Qualidade do custo do cálculo". O aviso de custo incompleto segue o custo que formou o preço:
sem ele, "Custo p/ preço incompleto — margem não calculável"; cálculo parcial com preço formado, "Custo do
cálculo incompleto" e que o Modelo não usa a parte que falta. Tabelas do padrão sem mudança.
`web lib/pricing-cost.ts` (`custoQueFormaPreco`, `usaModeloFlexivel`) serve a tela e o PDF.

**Milhar.** `base-calculada-impressos` procura "1.000 un", como `formatQuantity` escreve; a formatação pt-BR
ficou.

**Orçamento e relatórios (auditoria, sem mudança).** Tela e PDF do Orçamento não mostram CMV nem margem. R-19,
R-20 e "Precificação vigente" do CMV mostram o custo do cálculo ao lado de margem formada pelo custo p/ preço —
achado, fora do escopo.

**Validação.** `web pdf/documents/cost-documents` com PDF real lido de volta — padrão (valor guardado de modo
desligado não sai), R$ por unidade, custo industrial fora sobre cálculo parcial, imposto % com política de
origem, gestão externa e Modelo que usa o cálculo sem custo p/ preço: 13 testes, fixtures pela mesma conta da
API (`computePricingModelEffect` + `computePrice`). No código antigo, os quatro cenários de Modelo e as
asserções novas do padrão caíram. Mutações: 14 de 14 derrubadas. Focados (cost documents, print, `src/print`,
pricing, cost-templates): 18 arquivos, 208 testes, de novo depois do rebase. `pnpm typecheck`. Smoke Playwright
(Vite do worktree × web da main, API dev, só GET): precificação real PREC-000001 (padrão) e cinco versões
sintéticas por `route.fulfill` — 43 de 43 conferências no texto do PDF gerado, 0 escritas, console limpo. Sem
full test, E2E nem fresh (FAST).

**Achado** (BACKLOG): PRICING-MODEL-VIEW-REPORTS-01.

## Orçamento com página própria (QUOTE-WORKSPACE-NAVIGATION-01, 2026-09-14)

Só web: sem API, shared, schema, migration, regra comercial, status, pricing, snapshot nem conteúdo de PDF. §92.

**Antes.** A seção Orçamentos do Projeto listava as versões e renderizava a escolhida logo abaixo: clicar em
"ORC-000444 · V1" trocava um bloco fora da vista, e parecia que nada tinha acontecido.

**Depois.** `/comercial/orcamentos/:id` (`QuoteVersionPage`) carrega `GET /quote-versions/:id` e o Projeto dela
(APIs de sempre): trilha, fluxo Projeto › Orçamento › Pedido, Resumo (código, versão, situação, data, validade,
cliente, projeto, produtos, total, envio/aceite/recusa), links para as outras versões e a Proposta
(`QuoteWorkspace`, o workspace de antes extraído sem mudar regra — linha que grava ao sair do campo, formação de
preço, condições com pendência, guarda de saída, envio com confirmação por `pricingCostQuality ?? costQuality`,
aceite, recusa, duplicação, Pedido e PDF). Histórico lê as condições gravadas como texto; rascunho segue editável.
A ficha do Projeto só lista (`QuoteVersionsSection`: linha clicável + "Abrir", vazio por `TableEmptyRow`), e criar
ou abrir rascunho navega para a página do que o servidor devolveu. `?voltar=` dá "← Voltar ao Projeto PROJ-…";
sem ele, a trilha. A URL antiga `?quoteVersionId=&quoteLineId=` redireciona (replace); CMV, origem comercial do
Pedido e "Voltar" do PDF do Orçamento usam a rota nova (`rotaDoOrcamento`, `entityHref("quoteVersion")`) — a mesma
de QUOTES-HUB-01.

**Validação.** Web: `projects/orcamento-pagina-propria` (26 — lista sem proposta embaixo, clique e Enter navegam,
histórico sem campo, rascunho editável, Novo orçamento e Abrir rascunho sem versão a mais, envio pela página nas
três qualidades, guarda na volta, PDF e o Voltar dele, duplicar, aceite, recusa, Pedido, link direto e recarga,
404, 500 e rede na primeira leitura e na releitura, URL antiga, CMV ida e volta, versões do projeto), os 13
arquivos que montavam o workspace pela seção, `product-cmv/cmv`, `quote-to-order`, `rotas-do-app`,
`help-topic-contract` e `rotulo-da-origem`. Mutações: 16 de 16 derrubadas. Focados depois do rebase (projects,
product-cmv, app, components, pdf, print, customer-orders, pricing, ajuda): 89 arquivos, 1174 testes.
`pnpm typecheck`. Smoke Playwright em banco isolado (API e Vite do worktree), 1440 e 390, antes e depois do rebase:
histórico → PDF → Voltar do PDF → Projeto; Criar nova versão / Abrir rascunho → editar linha → guarda → Projeto;
Orçamento → CMV → volta na linha; URL antiga, link direto, recarga e 404; sem rolagem horizontal, 0 escrita e V1
idêntica nos caminhos do histórico, console limpo (fora o 404 real do navegador) — 50 de 50. Sem full test, E2E,
golden path nem fresh (FAST).

**Achados** (BACKLOG): QUOTES-HUB-01 (próxima), E2E-QUOTE-PAGE-FLOW-01, QUOTE-PAGE-NAV-ACTIVE-01.

## Booleanos de query restantes estritos (QUERY-BOOLEAN-PERMISSIVE-REMAINING-01, 2026-09-14)

Só API, só validação: sem migration, DTO, domínio, auth nem tela. Fecha a dívida que a varredura de
QUERY-BOOLEAN-STRICTNESS-WAVE-02 deixou, sobre `booleanoDeConsultaSchema`, sem parser novo.

**Antes.** Sete booleanos liam todo texto fora de `"true"` como `false`, calados. Reproduzido pela rota:
`onlyPending=1` (e `0`, `yes`, `abc`, vazio…) na fila da Qualidade devolvia a fila inteira, com o laudo aprovado;
`onlyWithBalance=1` trazia o lote zerado; `active=1` em Usuários listava só o inativo; `archived=1` nos Modelos de
Estrutura de Custos, nas Políticas de preço (campo herdado por `.extend`) e nos Modelos de Formulação listava só o
não arquivado; `includeArchived=1` nos anexos escondia o arquivado — este lido cru de `request.query` e comparado com
`"true"` à mão.

**Depois.** `"true"`/`"false"` exatos, o resto é 400 (`validation_error` com o campo), ausente com o padrão de antes:
fila sem recorte (`default(false)` nos dois), Usuários sem filtro e bibliotecas sem o arquivado (`optional()`), anexos
só com os ativos (`default(false)`). Anexos ganham `attachments.schemas.ts` (`listAttachmentsQuerySchema`): a rota
confere a sessão, valida a query e só então lista. As telas já mandavam `true`/`false` ou omitiam: web intocada.

**Legado.** `semRoteiro` das OPs e `activeOnly` dos Roteiros intocados (`1`/`0` com o contrato escrito no schema).

**Guarda.** `lib/escalar-estrito-guarda.test.ts` perde a lista de dívida permissiva e a exceção de leitura crua da rota
de anexos: nenhum booleano de URL de schema exportado aceita outro texto; `1`/`0` só no `LEGADO_EXPLICITO`; os sete
corrigidos são conferidos na varredura como estritos; fora dos schemas, só o helper compara texto booleano.

**Validação.** Antes da correção, os testes de rota novos derrubaram 7 de 28 — exatamente os de texto fora de
`true`/`false`; `true`, `false` e ausente já tinham o efeito certo. Depois: `boolean-schema` (+7 campos: `1`, ausente,
`true`, `false`, booleano real, 18 recusados), `escalar-estrito-guarda` e as rotas `quality-booleanos-de-consulta`,
`users-booleanos-de-consulta`, `modelos-arquivados-booleanos` (3 bibliotecas) e `attachments-booleanos-de-consulta`,
junto das pastas quality, users, cost-templates, formulation-templates, attachments e `paginacao-da-consulta`: 16
arquivos, 1562 testes. `pnpm typecheck`. Sem full test, E2E nem fresh (FAST).

## Comercial → Orçamentos (QUOTES-HUB-01, 2026-09-14)

API e web; sem migration, status novo, precificação, auth nem E2E. §93. Fecha junto QUOTE-PAGE-NAV-ACTIVE-01.

**Antes.** Achar uma proposta exigia saber o Projeto dela. Na página da versão nenhum item do menu acendia e a aba
dizia só "Veridi Nutrition".

**Depois.** `GET /quote-versions` (`listQuoteVersionsQuerySchema`): `page`/`pageSize` estritos, `search` (código;
cliente e projeto no snapshot e no cadastro), `customerId`, `projectId`, `status` um ou vários e `dateFrom`/`dateTo`
em dia civil sobre `quoteDate`, com a recusa do invertido. DTO leve (`QuoteVersionListItemDTO`); o total é a mesma
conta do documento (`totaisDaVersao`, extraída de `toQuoteVersionDTO`). Web: `QuotesPage` (`/comercial/orcamentos`)
sobre `useListFilters`, `useListQuery`, `DateRangeFilter`, `EntityFilterSelect` (cliente e `projetoFilterSource`,
novo) e `ListStatusRow`. Abre em Em aberto (Rascunho + Enviado), com Todos e os seis status; linha, Enter e "Abrir"
vão a `rotaDoOrcamento(id, { voltar })` com a URL da lista, e "← Voltar para Orçamentos" devolve recorte e página;
falha com "Tentar novamente"; fila vazia, base vazia e recorte sem resultado são frases diferentes. Menu: item
Orçamentos, ativo na lista e em `/comercial/orcamentos/:id`. Aba: `useTituloDaTela` (`app/titulo-da-tela.ts`, pelo
contexto do AppShell) — "ORC-000444 · V1 · Veridi Nutrition". A página da versão sem origem volta para Orçamentos.
O período usa `dateFrom`/`dateTo`, o nome das listas e do `DateRangeFilter`, e não o `from`/`to` do handoff.

**Validação.** API: `projects/lista-geral-de-orcamentos` (8 — cliente, total do documento com desconto e sem preço,
status, projeto, busca, período, paginação, cliente renomeado), mais `paginacao-da-consulta` e `periodo-invertido`
com a rota nova. Web: `quotes/orcamentos-lista-geral` (22), `app/orcamentos-no-menu` (10), `orcamento-pagina-propria`
(título e 404), `filtros-390px`, `rotulo-da-origem`, `rotas-do-app`, `help-topic-contract`, `sidebar-navigation`.
Mutações: 20 de 20 derrubadas. Depois do rebase: web 41 arquivos, 604 testes (projects, quotes, app, list-query,
list-filters, contextual-create, guardas de lista, período, 390 e ajuda); API 20 arquivos, 1219 testes (projects,
paginação, período, guarda escalar, status); `pnpm typecheck`. Smoke Playwright em banco isolado (API e Vite do
worktree), 1440 e 390, antes e depois do rebase: fila, Todos, página 2, linha → versão (título e menu) → Voltar com
recorte e página, busca numa consulta, Enter, cliente, projeto e período pela URL, sessão, 500 simulado com Tentar
novamente, vazio de recorte, Abrir por toque em 390, sem rolagem horizontal, 0 escrita, console limpo — 69 de 69. O
smoke pegou o "Abrir" invisível na coluna fixa em 390 (`.table__actions` na própria `td`): corrigido e guardado no
teste. Sem full test, E2E, golden path nem fresh (FAST).

**Achados** (BACKLOG): E2E-QUOTE-PAGE-FLOW-01 continua aberto; LISTS-LOADING-DATES-GESTURE-01 (falha que já existia na
`main`, fora desta capability).

## Relatórios robustos: retrato da FO-03, contrato de filtros e Modelo nos relatórios (REPORT-ROBUSTNESS-WAVE-01, 2026-09-14)

Fecha PAGED-DOCUMENT-SNAPSHOT-01, REPORTS-PRINT-FILTER-KEYS-DRIFT-01 e PRICING-MODEL-VIEW-REPORTS-01. Sem migration,
sem conta de preço, Orçamento, regra econômica ou permissão mudadas.

**FO-03 num retrato só.** `GET /quality/coa-queue` aceita `all=true` (booleano estrito): o recorte inteiro sai de UMA
leitura de `Lot` dentro de transação `RepeatableRead`, e o saldo dos lotes e o "somente com saldo" enxergam o mesmo
instante. Teto `QUALITY_QUEUE_ALL_ROWS_LIMIT` = 1.000 (lê 1.001): acima, 400 `quality_queue_too_large` com "A fila tem
mais de 1.000 lotes neste recorte — acima do limite de um documento…", nunca os primeiros N. `page`/`pageSize` não cortam
o `all`; sem ele, a paginação é a de antes. A folha faz `listQualityQueue({ onlyPending: true, all: true })` e recusa
resposta cujas linhas não fecham com o `total`; `loadAllPages` (páginas por deslocamento) ficou sem uso e saiu com o
teste. Recorte `onlyPending`, ordem, situações, rótulos PENDING/RECEIVED/REJECTED e colunas intocados.

**Contrato de filtros.** `REPORT_FILTER_CONTRACTS` (`shared report-filter-contracts.ts`) guarda `csvPath` e
`filterKeys` dos 18 relatórios impressos; `REPORT_PRINT_DEFINITIONS` os espalha, sem cópia. Metadado, não schema: a web
não depende do zod. `api modules/exports/report-filter-contracts.test.ts` compara cada contrato com as chaves do schema
da rota CSV (sem `page`/`pageSize`/`all`) e prova que pega chave acrescentada e removida; o teste web confere que as
definições apontam para os arrays do shared. `filterAppliesWhen` (R-02) e rótulos seguem na web.

**Modelo nos relatórios.** As palavras do Modelo moram no shared (`textoDoCustoIndustrialNoPreco`,
`textoDosImpostosNoPreco`, `resumoDoModeloDePrecificacao`) e servem o PDF de Precificação (mesmo texto de antes), o CSV
e as telas. R-19: linha com `pricingModel`, `pricingCostPerUnit` e `pricingCostQuality` da faixa e da versão ativas
(congeladas); CSV/PDF com "Modelo de Precificação", "Qualidade do custo do cálculo", "Custo do cálculo/un", "Qualidade
do custo p/ preço" e "Custo p/ preço/un" (sai "Custo/unidade"); faixa sem o custo p/ preço congelado lê o do cálculo no
Modelo padrão e fica vazia no flexível. R-20: Modelo e custo p/ preço só na linha viva (rascunho, faixa ativa
vinculada); a enviada congelou custo do cálculo e margem, não o Modelo — `pricingModelNotFrozen` e "Não congelado no
envio", sem deduzir do vínculo ("Custo industrial/un" vira "Custo do cálculo/un"). CMV, "Precificação vigente" da tela:
Modelo da precificação ativa e, fora do padrão, "Custo p/ preço/un" ao lado da margem, com a nota dos dois custos. O
PDF do CMV não mostra margem e não mudou.

**Validação.** API: `fila-inteira-retrato` (0/1/100/101/500, `page` ignorado, `all=abc` 400, teto+1 recusa e teto exato
passa, fila mudando no meio por portão de consulta com escrita de outra conexão), `report-filter-contracts`,
`pricing.test.ts` (R-19 padrão/IGNORE/PER_UNIT/sem retrato; R-20 viva × enviada), `quality-documents`,
`quality-booleanos-de-consulta`, `escalar-estrito-guarda`, `boolean-schema`, `paginacao-da-consulta`,
`qualidade-do-custo-no-csv`, `r20-*`, `periodo-invertido` — 13 arquivos, 1703 testes depois do rebase. Mutações
derrubadas: sem `RepeatableRead`, sem teto, `all` ignorado, filtro novo no schema do R-19, `filterKeys` reescrito na web,
R-20 enviada deduzindo o Modelo, flexível sem retrato caindo no custo do cálculo. Web: FO-03, folhas operacionais,
definições e conteúdo/arquivo dos relatórios, `relatorios-modelo-de-precificacao`, R-19/R-20, CMV, PDF de Precificação
(`cost-documents`, `base-calculada-impressos`) e documentos — 17 arquivos, 332 testes. `pnpm typecheck`. Smoke
Playwright em banco isolado (API e Vite do worktree), PDF real lido do navegador: FO-03 com 150 pendências inteiras e
uma leitura `all=true` por carga; 1.001 pendências dão 400 e a frase na tela, sem PDF; CSV real do R-19/R-20 com os
cabeçalhos novos; PDF do R-19/R-20 com Modelo, os dois custos, "Não congelado no envio" e só filtros do contrato —
18 de 18, console limpo fora o 400 esperado do Chromium. Sem full test, E2E nem fresh (FAST).

**Achados** (BACKLOG): R20-SENT-PRICING-BASIS-SNAPSHOT-01 (snapshot do custo p/ preço e do Modelo no envio — schema
proposto, sem migration aqui) e R20-MANUAL-REFERENCE-MARGIN-01 (a conferir). As 4 falhas de
`listas-consulta-em-curso.test.tsx`, que já existiam na `main` em a5b9a73, são LISTS-LOADING-DATES-GESTURE-01.

## Programação × quantidade reconferida (OP-SCHEDULE-STALE-ON-QUANTITY-01, reaberto em 2026-09-14)

Handoff reemitido na homologação. A correção já estava na `main` desde a35ea76 (2026-09-12) e na tag
`homologacao-inicial-2026-09-14`: regra, schema, endpoint, permissão, roteiro, lifecycle, conversão e calendário
intocados. Reconferida sobre a `main` atual, depois das quatro rodadas que mexeram na tela da OP
(SAVE-FEEDBACK-REMAINING-01, PTBR-NUMERIC-INPUT-ROLLOUT-01, PTBR-NUMERIC-DISPLAY-AUDIT-01, SMALL-MOBILE-UX-WAVE-03).

**O que mudou.** A pergunta e a 409 dizem a frase do handoff: "Alterar a quantidade removerá a programação atual
desta ordem, pois a duração da produção pode mudar." Testes ganharam `1000.0` na API e, na tela, `1000,000`, `1000.0`
e `1000.000` digitados com o campo em foco — fora dele o campo mostra "1.000" e conferir o valor seria vazio.

**Validação.** API production-orders 163 e schedules + GMP 45; web OP e planejamento 229; `pnpm typecheck`. Smoke
Playwright em banco isolado (API e Vite do worktree), 24/24: pergunta antes de qualquer PATCH; Cancelar mantém banco e
pendência; confirmar envia a flag e remove a programação na mesma gravação (DRAFT, mesmo roteiro); reprogramar pela
tela dá 120 min para 2.000 un; `2000,0`/`2000.0`/`2000.000` sem pendência nem pergunta; OP sem programação salva
direto; PATCH direto 409 com a frase nova, 200 com a flag e 5.000 un reprogramadas = 300 min com almoço; 390px com
botões empilhados, sem transbordo; console limpo. Sem full test, E2E nem fresh (FAST).

## Data digitada nas listas: o gesto do teste espera a pausa (LISTS-LOADING-DATES-GESTURE-01, 2026-09-14)

Só teste. Sem API, tela, componente, schema ou migration.

**Reprodução e causa.** Na `main` (0d3f273), `web pages/listas-consulta-em-curso.test.tsx` caía sempre, sozinho, em
Faturamento, Recebimentos, Ordens de Compra e Produto Acabado: "datas: uma consulta", 4 consultas em vez de 5 (45 de
49). Teste desatualizado, não regressão: desde LISTS-FILTER-INPUT-UX-01 (695e9b3) o `DateRangeFilter` só aplica a data
digitada depois de `PAUSA_DO_PERIODO_MS` ou no Enter, e o gesto contava a consulta logo depois do `change`. O commit da
pausa já tinha este arquivo, mas a validação daquela onda rodou `listas-consulta-em-curso-restantes`, não ele. Causa
única: as quatro telas passam o período pelo mesmo `DateRangeFilter` → `useListFilters.set` → `useListQuery`, sem
diferença entre elas.

**Regra (a da tela, mantida).** "Personalizado" semeia com o período da tela, sem consulta. Data digitada não é filtro
até a pausa ou o Enter: nem consulta, nem URL, nem sessão. Na pausa, uma consulta, na página 1, URL (`replace`) e
sessão com a data, CSV com o filtro novo; "Carregando…" sem linhas, total ou páginas do recorte anterior; resposta de
recorte ou página anterior não sobrescreve a nova.

**Teste.** O gesto "datas" digita e espera: 1 ms antes da pausa nenhuma consulta, na pausa uma. Caso novo nas quatro
listas: página 2, Próxima em curso, data digitada — até a pausa nada muda e a página aberta fica à vista; na pausa uma
consulta na página 1, URL com `dateFrom` e sem `page`, sessão com a data, carregando sem nada do recorte anterior; a
página 3 atrasada, respondendo depois da nova, não vira tela. Guarda de que as quatro listas entram no caso.

**Validação.** `listas-consulta-em-curso` 54 de 54 (base: 45 de 49). Mutações, 6 de 6 derrubadas: sem pausa (8
testes), data que nunca aplica (8), Personalizado que consulta no clique (1 — Faturamento; nas outras o semear já é
vazio), resposta atrasada que escreve (16), filtro que mantém a página (14), sessão que não grava (4). Focados, antes e
depois do rebase: `components/filters`, `list-query`, `list-filters`, `list-period`, filtros de Faturamento,
Recebimentos, Produto Acabado e OC, `periodo-invertido-listas`, `listas-consulta-em-curso` (e `-restantes`),
`listas-sem-consulta-solta`, `quotes` — 15 arquivos, 315 testes; `pnpm typecheck`. Interface intocada: sem smoke nem
390. Sem full test, E2E nem fresh (FAST).

**Achado** (BACKLOG): LISTS-CUSTOM-PERIOD-PAGE-RESET-01 — "Personalizado" fora da página 1 volta à página 1 do mesmo
recorte, com uma consulta (medido nas quatro telas: 0 consultas a partir da página 1, 1 a partir da página 2).

## Backup de PROD restaura sobre a cadeia de migrations (BACKUP-RESTORE-CHECK-01, 2026-09-14)

Só script de manutenção e teste. Sem API, tela, schema ou migration.

**Defeito.** Na carga inicial de PROD o backup oficial (`prod-backup-json.mjs`) saiu certo e a prova
`restore-json-backup-check.mjs` quebrou com `Unique constraint failed on the fields: (code)`: desde
`20260925093012_reference_units_of_measure` (FAST-DEVELOPMENT-RESET-02) o banco que as migrations constroem nasce
com as 6 unidades, o arquivo traz as mesmas 6, e o `createMany` as inseria de novo. Reproduzido com o backup da
carga (`handoff/backups/railway-prod-carga-inicial-20260914T163209Z.json`, fora do Git) em banco local descartável.
Na carga, a prova só passou com uma cópia local que ignorava colisão em toda tabela (`skipDuplicates`) — descartada.

**Regra.** `REFERENCIA_DAS_MIGRATIONS` declara por model o dado que a cadeia grava num banco vazio (hoje só
`UnitOfMeasure`; as outras migrations com `INSERT` são backfill e não gravam nada num banco vazio). Antes da carga,
cada linha gravada pela migration é comparada com a do arquivo, campo a campo: idêntica conta como restaurada e não
é inserida de novo; mesma chave com campo diferente, linha da migration ausente do arquivo, chave repetida no
arquivo ou model fora da lista com linha logo depois das migrations reprovam como drift, sem carregar nada. Model
comum carrega sem `skipDuplicates`: duplicidade reprova. A conferência final segue contagem, linha a linha e
sequences, e ficou mais estrita: carregadas + referência = linhas lidas; contagem e linhas do arquivo coerentes;
sequence do banco ausente do arquivo é divergência. `migrate deploy` pelo `PRISMA_BIN`, sem shell.

**Validação.** `scripts/maintenance/restore-json-backup-check.test.ts`, 11 testes, com backup gerado pelo próprio
`prod-backup-json.mjs` sobre base migrada com dado de negócio: 9 de 9 mutações derrubadas, inclusive a cópia
temporária da carga (8 testes caem). **O backup da carga inicial é restaurável** pelo script oficial:
`RESTAURÁVEL: YES — 76 models, 687 linhas idênticas ao arquivo (681 carregadas + 6 de referência gravadas pelas
migrations), 25 sequences no mesmo ponto`, banco descartável removido. Focados: `apply-migrations`,
`migration-order`, `migration-prefix`, `schema-fk-actions` (32) e `faixas-de-teste` (5); `pnpm typecheck`. Sem full
test, E2E nem fresh (FAST). PROD e `release/prod` intocados.

## DEV com a carga real e base E2E reproduzível (DEV-REALDATA-BASELINE-RESET-01, 2026-09-14)

Decisão do PO: o DEV deixa de ser resíduo de teste e passa a ser a carga inicial que a Veridi recebeu em PROD —
**DEV_REALDATA_BASELINE** — e as E2E ganham base própria reconstruível. PROD, Railway, `release/prod` e o backup de
PROD intocados; unit e integração seguem nos bancos `*_test`. Nenhuma E2E reescrita ou executada.

**Limpeza local.** Antes: `veridi_dev` com resíduo (685 usuários, 943 sessões, 926 itens),
`veridi_apply_check_1789012909474` órfão de 2026-09-10, dois worktrees sem dono (limpos, já na `main`), 143 branches
locais, 13 dumps de DEV antigos, 2.078 anexos órfãos, `handoff/e2e-run.json`, checkpoint do golden path e log velho.
Saíram o banco órfão, os dois worktrees, as 141 branches já ancestrais da `main` (fica `feat/contextual-help-kit`,
com commit fora dela), os dumps antigos (fica o do reset) e os artefatos. Preservados: pacote, pendências e provas da
carga, `handoff/migracao-producao`, backups de PROD, planilhas e docs.

**DEV_REALDATA_BASELINE.** `local-db-reset.mjs --confirmar` (dump antes, 74 migrations, `seed-infra` com as 6
unidades da migration e o ADMIN local) e o importador oficial com o pacote aplicado em PROD
(`pacote-carga-final.json`, identidade `db8bdf94…`), sobre cópia do corpus em
`.local-data/veridi/carga-inicial/dev-baseline/` — CSVs e overrides iguais aos da carga de PROD por SHA-256. O PLAN
saiu idêntico ao que antecedeu o APPLY de PROD em fonte, ações, findings, pacote e `readyForLoad`; APPLY em 6 s;
VERIFY 10/10. Depois do APPLY, `findings.csv` e os sete de-para saem byte a byte iguais aos de PROD: mesmos códigos do
ERP para as mesmas chaves legadas. Contagens: 76 clientes, 113 fornecedores, 816 itens (643 + 173 PA), 173 produtos,
161 formulações (1.292 componentes), 182 projetos, 2 orçamentos legados, 721 item × fornecedor, 773 ofertas, 1.233
eventos de homologação, 6 unidades e 1 usuário — iguais a PROD pós-carga em 70 dos 76 models; os outros seis são dado
que PROD tem fora da carga (usuários, sessões, preferência, 1 Modelo de Formulação e o ORC-000003 criado por usuário).
Amostra contra pacote e corpus (5 clientes, 5 fornecedores, 10 itens, 5 produtos, 3 formulações, 3 projetos): 96
conferências, 0 divergência; nenhum nome com "teste", "homologação", "importado" ou alias.

**E2E_BASELINE_REBUILD.** `pnpm e2e:baseline:rebuild` (`scripts/e2e-baseline-rebuild.mjs`): drop → create →
migrations → ADMIN → VALIDATE → PLAN → APPLY → VERIFY em `veridi_e2e_baseline`, no servidor e com a credencial da
`.env`, só encadeando os comandos oficiais. A guarda recusa antes de qualquer efeito servidor não local, nome sem
`e2e_baseline`, o banco da `.env` e marca de produção (`scripts/e2e-baseline-rebuild.test.ts`, 12 testes). Duas
rodadas de 18 s, idênticas entre si e ao `veridi_dev` nos 76 models. Como usar, a regra de massa proposta e o mapa das
29 suítes contra a base: [`E2E_STRATEGY.md`](E2E_STRATEGY.md).

**Validação.** API 3333 e web 5173 no ar contra o DEV novo, sem reiniciar. Smoke sem gravar (todo não-GET abortado)
em Painel, Clientes, Fornecedores, Itens, Produtos, Formulações, Projetos e Orçamentos: dado real, 0 resposta 4xx/5xx,
0 erro de console. Clientes abre em 75 pelo filtro de situação comercial ativa, e Orçamentos em "em aberto" vazio —
os 2 legados são ARCHIVED; "Ver todos" mostra os dois.

## Fundação E2E nova e suítes simples (E2E-BASELINE-REDESIGN-WAVE-01-02, 2026-09-15)

Decisões do PO (A–I, em [`E2E_STRATEGY.md`](E2E_STRATEGY.md)): massa de pré-condição por API nas quatro condições —
não é o que se prova, economiza muito tempo, contrato da rota coberto, não pula a pré-condição —, GET livre,
Prisma/SQL proibido; clone por TEMPLATE só local; ADMIN próprio da execução; pronto por wave = clone novo verde +
mesma bateria no clone sujo + console limpo + nenhum "SEM MASSA". PROD, Railway PROD e `release/prod` intocados.

**Fundação.** `scripts/e2e/fixtures/`: `run.mjs` (runId de 6 base36 em memória — `handoff/e2e-run.json` saiu do
fluxo; `lib/run-id.mjs` ficou como compatibilidade sem arquivo e o golden path exige `--run` junto de `--desde`),
`api.mjs` (`exigir` falha com método, rota, status e corpo sem segredo; origem só `http://127.0.0.1`), `ui.mjs`
(`esperarRota` pelo pathname, `escolherOpcao` sem "+ Novo"), `datas.mjs`, `cadastros.mjs` e `producao.mjs`.
`lib/browser.mjs` abre em America/Sao_Paulo e pt-BR e junta em `erros` console, `pageerror` e 4xx/5xx da API não
declarados (`esperarErroHttp`). `lib/pdf.mjs`: espera de 90 s, `blob:` com `%PDF-`, NBSP como espaço, paridade com o
leitor da web.

**Runner.** `pnpm e2e:run` (`scripts/e2e-run.mjs`): recusa template montada com outras migrations (`baseline.json`
guarda total, última e assinatura de nome e conteúdo; rebuild nunca automático), clona por `CREATE DATABASE …
TEMPLATE` (`<template>_run_<runid>`, nunca a template nem o banco da `.env`, template sem conexão), cria o ADMIN da
execução, sobe API e Web em 127.0.0.1 contra o clone, roda em série (exit ≠ 0, estouro e "SEM MASSA" reprovam; 5xx
contados no log da API), encerra a árvore de processos e remove o clone (`--manter-clone`, `--clone=<nome>`).
`veridi_e2e_baseline` foi reconstruída uma vez para gravar o registro (74 migrations, 18 s).

**Provas.** `leitor-de-pdf-da-tela`: OC de massa por API; PDF real no iframe `.pdf-screen__frame` como `blob:`, texto
com o código da OC, o fornecedor carimbado e o item, 3 NBSP normalizados, gerado e lido em 1,9 s.
`roteiro-aplicado-planeja-ordem`: OP em rascunho sem roteiro é recusada ao planejar (400 `route_required`); com o
roteiro da fixture aplicado, fica PLANNED.

**Suítes.** As 11 da bateria `wave-01-02` (10 do grupo A + recebimento) usam `criarRun()`. Três esperavam a lista de
Clientes por regex terminando em `/cadastros/clientes` e agora esperam pelo caminho; `perfil-tributario` e
`troca-de-cep` reabrem o cliente pelo id (`?ids=`). O recebimento cria fornecedor e matéria-prima com lote e validade
por API — OC e recebimentos pela tela, sem estoque em item da carga real. Achado da primeira bateria (9/11): duas A
estavam velhas desde PTBR-NUMERIC-INPUT-ROLLOUT-01 — `modelo-aplicado-preserva-base` comparava a base com `1000` (a
tela mostra `1.000`) e `projeto-inteiro-invalido-nao-apaga` digitava `abc` num `IntegerField` que não deixa letra
entrar. As duas seguem o contrato de `projeto-inteiros.test.tsx` (letra não entra; zero entra e é recusado), e
`modelo-aplicado` declara o 409 provocado. A leitura estática do discovery dava as dez A como "passam como estão".

**Validação.** Clone novo: 11/11 em 3m03s (suítes 2m55s), SEM MASSA 0, console limpo, 5xx 0 (API: 941 × 200, 53 ×
201, 52 × 204 e o 409 declarado). Clone sujo — o mesmo, sem recriar, runIds novos, cada suíte sobre a massa das 11 da rodada anterior: 11/11 em
3m02s (suítes 2m54s), mesmas verificações por suíte, SEM MASSA 0, console limpo, 5xx 0; clone removido no fim. Focados: `e2e-run.test.ts`,
`fixtures.test.ts`, `pdf.test.ts` e `e2e-baseline-rebuild.test.ts` (77); `pnpm typecheck`. Sem `pnpm test` global,
full web/API, fresh nem golden path (FAST).

## Orçamento nas E2E: Hub e página própria da versão (E2E-BASELINE-REDESIGN-WAVE-03, 2026-09-15)

Só E2E: sem API, tela, shared, schema, migration ou regra. Fecha E2E-QUOTE-PAGE-FLOW-01. PROD, Railway PROD e
`release/prod` intocados.

**Fluxo nas suítes.** Ficha do Projeto → criar ou abrir a versão → `/comercial/orcamentos/:id` (linhas, condições, PDF,
envio, aceite ou recusa, Fechamento); aprovação na ficha; Pedido no Fechamento da versão aceita, com o Projeto
aprovado. Nenhum comportamento antigo restaurado para caber no teste.

**Helpers.** `fixtures/comercial.mjs`: Projeto, produto do Projeto, versão, linha achada pelo produto, condições, envio,
recusa e GET de conferência — por API, carimbados, código e rótulo lidos da resposta. `fixtures/comercial-ui.mjs`:
`abrirVersao` e `esperarVersaoNaTela` (o título do documento precisa mudar, não só a URL), `voltarAoProjeto`,
`criarNovaVersao` (o botão da ficha dito pela suíte), `aprovarProjeto`, `enviarAoCliente`, `registrarAceite`,
`gerarPedido` e `aguardarReleitura` (a versão e depois o Projeto) — esperam a tela e devolvem id, URL e rótulo, sem
afirmar regra. `ui.mjs` ganha `abrirPeloMenu`.

**Suítes (bateria `wave-03`).** `orcamentos-hub-e-pagina-da-versao`, nova, sobre 24 versões carimbadas por API: menu,
Em aberto (consulta `DRAFT,SENT`, fora da URL), Todos, busca numa consulta, cliente e projeto pelo id, período
personalizado e paginação; linha, Enter e "Abrir" com `?voltar=`, e a volta restaura os seis — busca, status,
cliente, projeto, período e página — na URL e na tela; menu ativo e aba na lista e na versão; vazio; 500 simulado com
Tentar novamente; 404; 390px. `envio-exige-condicoes-e-linhas-salvas` funde as duas do envio (decisão D; as antigas
saíram depois de cada verificação delas ter par na nova): condição suja, linha suja com 503 provocado e o servidor
ainda com o preço antigo, envio uma vez, enviada em leitura e o PDF de cada versão com a V2 existindo. Migradas para a
página da versão: `condicoes-do-orcamento-sobrevivem-a-linha` (V2 pela ficha; trocar de versão com condição suja passa
pela guarda — "Continuar editando" fica sem gravar, "Sair sem salvar" descarta —, decisão E),
`prazo-invalido-nao-apaga` (letra não entra; 0 e 121 recusados no campo; o 30 intacto na segunda aba),
`preco-herdado-sobrevive-ao-tab` (V1 aceita → ficha → "Criar nova versão"; Tab sem PATCH),
`resumo-comercial-do-projeto` (edita e envia na versão, lê na ficha), `projeto-aprovado-vende-de-novo` (aceite na
versão, aprovação na ficha, Pedido no Fechamento, vencida não aceita) e `formacao-de-preco-do-novo-orcamento` (cliente
da execução no lugar do código fixo; condição mantida até o Pedido, exceção com motivo e 409 declarado, reajuste de 8%).

**Guardas.** `scripts/e2e-run.test.ts`: bateria `wave-03` (8), as duas do envio não voltam como arquivo, e as suítes da
WAVE 3 sem código comercial fixo, sem escolha por posição (índice, primeira linha, `[0]` de lista da API), sem rótulo
de orçamento montado e com `criarRun()`. `fixtures.test.ts`: contrato das fixtures comerciais. Mutações: 9 de 9
derrubadas.

**Validação.** Clone novo: 8/8 em 1m27s (suítes 1m19s), SEM MASSA 0, console limpo, 5xx 0 (API: 745 × 200, 86 × 201,
47 × 204, os dois 404 e o 409 declarados; o 500 e o 503 são simulados na rede do navegador). Clone sujo — o mesmo, sem
recriar, runIds novos: 8/8 em 1m25s, as mesmas verificações por suíte (Hub 68, envio 65, condições 87, prazo 29, preço
herdado 21, resumo 37, recompra 36, formação 28), SEM MASSA 0, 5xx 0; clone removido. Regressão Wave 1–2 pelo runner,
uma vez, em clone novo depois do rebase: 11/11 em 3m05s, SEM MASSA 0, 5xx 0. Focados: `e2e-run.test.ts`,
`fixtures.test.ts`, `pdf.test.ts` e `e2e-baseline-rebuild.test.ts` (83); `pnpm typecheck`. A `main` andou no meio
(ERP-REVIEWER-SKILLS-01 e INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, só docs e skills): rebase limpo, nenhum gate de
código afetado. Sem `pnpm test` global, fresh nem golden path (FAST).

**Achados.** Nenhum bug de aplicação. Só rodando apareceu contrato velho nas suítes: o `IntegerField` não deixa letra
nem vírgula entrar (o prazo passou a testar `0` e `121`), `1,2,3` também não entra na quantidade (a linha recusada é
`1.234`), e preço e desconto aparecem em pt-BR (`12,50`, `7,5`).

## Inventário Físico em sessão — domínio e API (INVENTORY-PHYSICAL-COUNT-01, Fatia 1, 2026-09-15)

Discovery `DECIDIDO` (D1–D8 e P1–P7 fechadas pelo PO). Só domínio, schema, migration e API, sem tela nova. PROD e
`release/prod` intocados.

**Modelo.** `StockCount` (`INV-000001`; `SESSION` ou `QUICK`; `BLIND` ou `ASSISTED`; em contagem → em revisão →
encerrado, e cancelado a partir dos dois primeiros), `StockCountPosition` (item, ou item + lote, com retrato de cadastro
e saldo de referência), `StockCountEntry` (só acrescenta; cada registro guarda o esperado lido na própria transação) e
`StockCountFinding` (lote ou item sem cadastro — nunca cria cadastro nem movimento). Migration aditiva
`20260925093026_inventory_physical_count_sessions`; `inventory_movements` intocada, porque a FK 1:1 do ajuste mora na
posição.

**Regras (§16).** Ajuste = diferença congelada do registro que vale, aplicada como delta no encerramento, com item e lote
travados só nas posições ajustadas e recusa se o saldo ficar negativo ou abaixo do reservado. Uma posição física em no
máximo um inventário aberto, garantido por índice único (`openPositionKey`), inclusive entre transações simultâneas.
Divergência com movimentação durante o inventário fecha só recontada ou confirmada. Conflito otimista 409 entre
operadores. Contagem cega feita pela API. Encerrado e cancelado não reabrem. Escrita: ADMIN, PRODUCTION e QUALITY;
leitura: toda sessão autenticada.

**Contagem rápida.** `POST /stock-counts` mantém o contrato da tela atual (só ganhou campos) e passa a gravar `INV-` QUICK
com posição, registro e ajuste ligado, inclusive quando confere; recusa posição em inventário aberto; unidade COUNT exige
inteiro; `expectedSystemQuantity`, opcional, responde 409 quando o saldo mudou (a tela ainda não envia).

**Validação.** 22 testes novos em três arquivos (`stock-count-session`, `stock-count-quick`,
`stock-count-exclusividade-concorrente`), com a corrida de duas transações provada pelo `pg_stat_activity`; 5 mutações das
regras-chave derrubadas; o módulo de estoque inteiro (11 arquivos, 106 testes) antes e depois do rebase; `code-prefixes`;
typecheck da API e da web; os testes da tela atual (`inventario-alteracoes-nao-salvas`, `catalogo-busca-no-servidor`,
24); `pnpm validate:migrations:fresh` sem drift. Sem `pnpm test` global, E2E, golden path nem build (FAST).

**Aberto.** Fatia 2 (telas, e no montador os filtros de qualidade/validade, última contagem, movimentação e local) e
Fatia 3 (FO-01 de sessão e CSV controlado).

## Painel Gerencial (MANAGEMENT-DASHBOARD-V1-01, 2026-09-15)

Decisões D1–D5 do PO em FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01 (agora `IMPLEMENTADO`); regras em §94. Sem
migration, tabela, cache ou job. Painel Operacional intocado. PROD e `release/prod` intocados.

**Contrato.** `GET /management-dashboard?period=mes-atual|mes-anterior|acumulado-ano|custom` (Personalizado com
`dateFrom` e `dateTo`), só ADMIN e COMMERCIAL (`MANAGEMENT_DASHBOARD_ROLES`): os demais perfis levam 403 antes de o
filtro ser lido, sem sessão 401. Um instante e um retrato `RepeatableRead` por requisição. Período, comparação,
variação, granularidade e o DTO em `packages/shared/src/management-dashboard.ts`; read model em
`api modules/management-dashboard/`. O Faturado lê `billings/billed-value.ts` (`resumirValorFaturado` e
`valorDoFaturamento`) — nenhuma outra conta do valor faturado, com guarda estrutural no teste.

**Tela.** Gestão → Painel Gerencial (`/gestao/painel-gerencial`), primeiro item do grupo: resultado do período
(Faturado, Pedidos confirmados, Compras contratadas, Clientes faturados, com anterior e variação), posição atual (A
expedir, A faturar e a composição só com os dois completos), tendência do Faturado em barras de CSS, top 10 clientes e
produtos, próximos compromissos (hoje e os 29 dias seguintes), "Como funciona" e o rodapé do que a tela não mostra.
Período na URL. Sem documento, "—" e a frase; incompleto, "Valores incompletos", "N de M" e os documentos que faltam.

**Drill-down.** Faturamentos emitidos do intervalo (e do cliente), Ordens de Compra com o grupo novo "Contratadas" e o
período, Pedidos com o grupo novo "Carteira (a expedir)", R-16 para A faturar, Visão do Cliente e cada documento
citado. Pedidos confirmados fica sem link: a lista de Pedidos não filtra por data de confirmação (G4 residual).

**Validação.** shared 27, API 28 (faixa serial; agregados globais exatos num retrato `RepeatableRead` desfeito), web 32
na tela, mais menu, rotas, arquitetura da navegação, contrato da ajuda e filtros de Pedidos e OC; 34 mutações
derrubadas (7 do período, 19 do read model e da rota, 8 da tela); typecheck de shared, API e web. Smoke no navegador
(API e Vite do worktree contra o `veridi_dev`, escrita barrada): 14/14 em 1440 e 390px, com a base real e com DTO
sintético cheio. A `main` andou no meio (Fatia 1 do Inventário, com migration): rebase com conflito só em docs, e de
novo typecheck, shared 27, API 28 e web focados (298, em 27 arquivos). Sem `pnpm test` global, E2E nem build (FAST).

**Achados.** Em 390px a área de trabalho rolava de lado (869 × 390): o texto oculto das barras (`.sr-only`, absoluto)
escapava da rolagem do quadro da tendência, que passou a ser `position: relative`. Período sem faturamento mostra a
frase em vez de um quadro de barras zeradas. Abertos, sem posição: G2 (preço acordado em Pedido direto), G5 (encerrar
saldo de OC recebida em parte) e o G4 residual.

## Situação cadastral do Cliente (CUSTOMER-STATUS-LIFECYCLE-01, 2026-09-15)

**Regra durável: §95.** O cadastro passou a responder "posso vender para este cliente?" com três situações — Ativo ·
Bloqueado · Inativo —, derivadas de dois fatos persistidos: `active` (arquivado ou não, que já existia) e `blocked`
(novo). A situação comercial (§86) continua intocada e ao lado: coluna própria, filtro próprio, padrão próprio.

**Quatro ações, todas com motivo obrigatório** (`POST /customers/:id/block|unblock|deactivate|activate`), cada uma
numa transação com a linha do Cliente travada (`FOR UPDATE`), gravando um evento append-only em
`customer_status_history` (situação anterior, nova, motivo, usuário, data/hora). Desbloquear não apaga o motivo do
bloqueio; inativar não desbloqueia — o bloqueio fica latente e volta na reativação. Transição que não parte da
situação atual é 409. `GET /customers/:id/status-history` devolve o histórico, que a Visão do Cliente mostra junto do
motivo em vigor.

**Guardas de venda** (bloqueado e inativo recusam, com frase de negócio e o motivo): Projeto novo e troca de cliente
do Projeto, versão nova de Orçamento (criar e duplicar), envio, aceite, geração do Pedido da proposta aceita, Pedido
novo, troca de cliente do rascunho e confirmação do Pedido. Produto novo e material do cliente seguem recusando só o
inativo — não são venda. Documento existente não é tocado: nada é cancelado por mudança de situação.

**Tela.** Clientes abre no filtro "Ativos" (Bloqueados · Inativos · Todos, ao lado do filtro comercial), a coluna
"Situação cadastral" leva o motivo do bloqueio no rótulo, e cada linha só oferece as ações da própria situação, sempre
por um diálogo que exige motivo. Seletores de Pedido e de Projeto pedem `status=ACTIVE`. O CSV troca "Ativo" por
"Situação cadastral" + "Motivo do bloqueio".

**Migration aditiva** `20260925093027_customer_status_lifecycle`: coluna `blocked` (default false), enum
`CustomerStatus` e a tabela do histórico. Sem backfill de evento: cliente inativado antes desta capacidade continua
inativo, e o histórico dele começa vazio — inventar autor e motivo seria pior.

**Validação.** API: 74 na faixa de Clientes (10 casos novos, incluindo a corrida provada por `pg_stat_activity`
esperando na trava) e a faixa dos módulos afetados (Clientes, Pedidos, Consulta, Projetos, Exportações, Produtos,
Recebimento); web dos módulos afetados; typecheck dos três pacotes. Sem `pnpm test` global, E2E, build ou fresh (FAST).
`web pages/projects/envio-com-linha-nao-salva.test.tsx` seguiu instável, como já era na `main`.

## Próxima prioridade

**A ordem vive na fila viva do [`BACKLOG.md`](BACKLOG.md)**, reconciliada em 2026-09-15: WAVE 4; Inventário Físico em
fatias (a próxima é a Fatia 2, telas); decisões de permissões da Produção; WAVE 5; estabilização final. Os parágrafos
abaixo registram como cada assunto chegou até aqui.

**BILLED-VALUE-CANONICAL-01 fechado em 2026-09-15** (§30), o primeiro da fila: com a decisão D1 do PO,
`Billing.totalAmount` é a autoridade do valor faturado. Painel, R-14 e R-15 — tela, CSV e o PDF, que lê o CSV — leem
`billings/billed-value.ts` (`valorDoFaturamento` e `resumirValorFaturado`, com o `SUM` do total congelado no banco);
emitido legado sem total congelado vale a soma das linhas arredondadas, como o próprio documento. Sem migration.
**MANAGEMENT-DASHBOARD-V1-01 fechado no mesmo dia** (§94, seção própria acima): D2–D5 decididas, e o Painel Gerencial
lê o faturado por essas funções.

**INVENTORY-PHYSICAL-COUNT-01 — Fatia 1 entregue em 2026-09-15** (§16, seção própria acima): sessões de inventário no
domínio e na API, e a Contagem rápida gravando `INV-` QUICK. Próxima do assunto: Fatia 2 (telas).

**PRICING-TEMPLATE-FLEX-01 fechado em 2026-09-11** (§84). Os três achados fecharam:
PRICING-MODEL-DIFF-01 e PRICING-ACTIVATE-CONFIRM-01 em COST-PRICING-CLARITY-WAVE-01, e
PRICING-MODEL-VIEW-01 em 2026-09-14 (PDF de Precificação). O resto do assunto — R-19, R-20 e o CMV — fechou em
PRICING-MODEL-VIEW-REPORTS-01 (REPORT-ROBUSTNESS-WAVE-01, 2026-09-14); sobra R20-SENT-PRICING-BASIS-SNAPSHOT-01, que
pede decisão de schema, sem posição na fila.

**QUOTE-WORKSPACE-NAVIGATION-01 fechado em 2026-09-14** (§92): cada versão de orçamento tem página própria.
**QUOTES-HUB-01 fechado em 2026-09-14** (§93), com QUOTE-PAGE-NAV-ACTIVE-01: Comercial → Orçamentos, a lista geral
que só navega para a mesma rota. **E2E-QUOTE-PAGE-FLOW-01 fechado em 2026-09-15** pela WAVE 3 das E2E (seção própria
acima).

**E2E-BASELINE-REDESIGN-WAVE-01-02 fechado em 2026-09-15**: fundação nova das E2E (`pnpm e2e:run`, fixtures, runId
em memória) e as 11 suítes simples verdes em clone novo e sujo. **E2E-BASELINE-REDESIGN-WAVE-03 fechado em
2026-09-15**: o Orçamento nas E2E pelo fluxo da página própria da versão e o Hub de Orçamentos — o PO rodou a WAVE 3
como o fluxo do Orçamento, e o grupo C passou para a seguinte. Próxima: **WAVE 4** — grupo C com massa própria
(desconto → faturamento, entregas e expedição, produção, ajuda contextual); o golden path segue na reescrita D.

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
SUPPLIER-ADDRESS-01, então o próximo da fila viva, fechou no mesmo dia (merge b8d744b).

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

Banco local `veridi_dev` = **DEV_REALDATA_BASELINE** desde 2026-09-14 (DEV-REALDATA-BASELINE-RESET-01): as 74
migrations, o ADMIN local do `seed-infra` e a carga inicial que PROD recebeu — mesmo pacote, mesmos códigos do ERP,
mesmas contagens de negócio. Estoque, OP, pedido e custo real seguem vazios: é o que a Veridi ainda não lançou.

Reconstruir, nesta ordem, no Git Bash e na raiz. `W` é uma pasta de trabalho com cópia de `csv/`, `overrides/` e
`cmv-product-overrides.csv` de `../.local-data/veridi/` (o importador grava plano, findings e de-para ao lado dos
CSVs); `P` é `../.local-data/veridi/carga-inicial/pacote-carga-final.json`, em caminho absoluto:

1. `pnpm exec dotenv -e .env -- node scripts/local-db-reset.mjs --confirmar` — dump, drop/create, migrations e
   `seed-infra`. No PowerShell 5.1 o `--` é consumido e o script cai em simulação sem alterar nada
2. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:validate`
3. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:plan -- --devolucao=$P`
4. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:apply -- --apply --devolucao=$P`
5. `VERIDI_CORPUS_DIR=$W/csv pnpm veridi:import:verify`

A pasta da rodada de 2026-09-14 é `.local-data/veridi/carga-inicial/dev-baseline/`, com logs, contagens e a
comparação com PROD. Referência de mercado e cargas de exemplo (`veridi:market-reference`, `veridi:examples`) ficam
fora: PROD não as recebeu.

Nunca `db push`, nunca edição manual de `_prisma_migrations`. Runbook do importador em
[`VERIDI_MIGRATION.md`](VERIDI_MIGRATION.md). As suítes da API e de scripts escrevem em `<banco>_test`, não aqui
(TEST-SUPPORT-ISOLATION-WAVE-01 e TEST-SCRIPTS-DB-ISOLATION-01); as E2E ganharam a `veridi_e2e_baseline`
(`pnpm e2e:baseline:rebuild`), ainda não adotada pelas suítes.

## Produção

Railway; desde 2026-09-14 18:04Z publica só a partir de `release/prod` — push na `main` não troca PROD.
**Zerada de negócio em 2026-09-11** (FAST-DEVELOPMENT-RESET-02) e, **em 2026-09-14, carga inicial da Veridi**
(pacote técnico final, 4 clientes `NAO_IMPORTAR`): 76 clientes, 113 fornecedores, 816 itens, 173 produtos, 161
formulações e 182 projetos — o que o DEV reproduz. Implantação em [`DEPLOY.md`](DEPLOY.md); limpeza de produção e
prova de backup em `scripts/maintenance/`.

**Pacote de revisão da migração** (PROD-MASTER-MIGRATION-PACK-01,
2026-09-11): `scripts/veridi-migration-pack/` gera, do legado real, oito
planilhas para a Veridi revisar (fora do Git, em `handoff/`). A revisão 02, em cópia técnica, foi a carga
inicial de PROD em 2026-09-14. Runbook em
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
| Achados da auditoria de produto (rodada de 2026-09-07, histórico) | [archive/E2E_AUDIT_2026-09-07.md](archive/E2E_AUDIT_2026-09-07.md) |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Precisão numérica: inventário e plano | [NUMERIC_PRECISION_AUDIT.md](NUMERIC_PRECISION_AUDIT.md) |
| Onde cada regra é protegida | [TEST_COVERAGE_MAP.md](TEST_COVERAGE_MAP.md) |
| Estratégia de E2E | [E2E_STRATEGY.md](E2E_STRATEGY.md) |
| Regras duráveis de UI e marca | [UI_BRAND.md](UI_BRAND.md) |
| Escopo do MVP · valor futuro | [MVP_PLAN.md](MVP_PLAN.md) · [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Discoveries do produto: índice e regras | [discovery/README.md](discovery/README.md) |
| Stack e ambiente · implantação · migração do legado | [TECH_BASELINE.md](TECH_BASELINE.md) · [DEPLOY.md](DEPLOY.md) · [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Validação com o cliente · perguntas regulatórias | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) · [BLOCK_H_VALIDATION.md](BLOCK_H_VALIDATION.md) |
| Histórico — validações, deliveries e findings | [archive/E2E_VALIDATION_HISTORY.md](archive/E2E_VALIDATION_HISTORY.md) · [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) · [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

## Manutenção deste arquivo

Alvo de 110 linhas. Reescrever e condensar; nunca acumular diário.
