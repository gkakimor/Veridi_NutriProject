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
varredura noturna. "Válido até 15/09" cobre o dia 15 inteiro: a comparação usa o
fim do dia em [`business-day.ts`](../apps/api/src/lib/business-day.ts), a mesma
convenção da referência de custo. Aceita não vence retroativamente — o Pedido
pode nascer depois, com o preço intacto.

**COM-03 deixou de ser prova por composição.** A cadeia `QuoteLine.unitPrice →
CustomerOrderLine.agreedUnitPrice → BillingLine.agreedUnitPrice →
BillingLine.unitPrice` agora é percorrida inteira num teste só, e a pergunta é
feita na direção perigosa: precificação nova ativada DEPOIS do Pedido e DEPOIS
do Faturamento não muda nenhum dos dois.

**Zero migration.** O schema já tinha tudo — `sourcedCustomerOrder`,
`validUntil` e os status existentes. Investigação em
[`archive/SPIKE_COM_NEW_QUOTES.md`](archive/SPIKE_COM_NEW_QUOTES.md).

## Próxima prioridade

**COM-PRICE** — herança de preço entre ciclos: reajuste percentual, "manter
condição anterior", proveniência da herança. É o que falta para a recompra
propor sozinha um ponto de partida econômico; hoje a versão nova nasce com o
preço da anterior como texto, sem dizer de onde ele veio.

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
