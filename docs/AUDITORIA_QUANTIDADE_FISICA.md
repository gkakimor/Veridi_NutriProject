# Auditoria de domínio — quantidade física do componente

Fase 1 da capability "quantidade física canônica". A auditoria parou no portão
do item 16 e devolveu a decisão ao PO; ele escolheu **(a) preservar o
comportamento existente**, e a implementação está na segunda metade deste
documento.

---

## Correção de um relatório anterior

Eu relatei, ao fechar a rodada passada, que `purityPercentApplied` era registro
e não cálculo — que o motor não aplicava pureza à quantidade. **Isso está
errado**, e o handoff foi escrito sobre essa premissa.

A afirmação veio de um comentário do `schema.prisma` que fala em congelar a
pureza como capacidade futura, e de uma busca que não alcançou
`apps/api/src/lib/formulation-math.ts`. Verificar a presença de um campo não é
verificar o comportamento — o mesmo erro de método que esta sessão já corrigiu
duas vezes em outros contextos.

## O que já existe, e está correto

`apps/api/src/lib/formulation-math.ts` é o calculador canônico, declarado no
próprio arquivo como **fonte única**. Ele implementa exatamente a fórmula que o
handoff previu no item 25:

```
teórico = quantidade da base × fator da base
físico  = teórico ÷ (pureza/100) × (1 + overage/100)
```

Cinco consumidores, um motor só — o item 36 já está satisfeito:

| Consumidor | Arquivo |
|---|---|
| Plano de Atendimento | `customer-orders/fulfillment-plan.service.ts:87` |
| Tela da Formulação | `formulations/formulations.service.ts:79` |
| Cálculo industrial / CMV | `industrial-cost-calculation/calculation.service.ts:454` |
| Custo da precificação | `pricing/pricing-cost.ts:179` |
| Ordem de Produção | `production-orders/production-orders.service.ts:308` |

Também já atendidos: **item 30** (tudo em `Prisma.Decimal`, nenhum float),
**itens 40-41** (`FIXED_BASIS`, `PER_DOSE` e `PER_FINISHED_UNIT`, com o fator
decidido pela base do COMPONENTE e não pelo modo da versão), **item 42**
(`dosesPerPackage` nulo lança `FormulationContextIncompleteError` — fail-closed,
com o comentário registrando que a versão anterior fazia `?? 0` e produzia
custo R$ 0,00 anunciado como completo), e **item 31 parcial** (pureza `null` não
aplica correção e nunca assume 100%).

## Representação, medida no dado

**Percentual, não fração.** No banco: pureza `100`, `96`, `50`, `97.5`; overage
`20`. O schema declara `0 < x <= 100` e o dado confirma.

O CSV de referência traz `grau_pureza` como fração (`0.98`, `0.2`), então há
conversão na importação. Não é contradição: são representações diferentes em
camadas diferentes, cada uma coerente consigo mesma.

## A fórmula, confirmada contra o legado

`FormulationComponent` guarda `legacyTotalQuantity` e `legacyBatchUnits` — o
total que a fábrica pesava e o tamanho do lote correspondente, campos que o
próprio schema diz que **nunca entram no cálculo** e existem para comparar ERP
contra histórico.

Reconstruindo o total legado a partir da fórmula, nos 26 componentes que têm
pureza ou overage:

```
física por dose = quantidade × (1 + overage/100) ÷ (pureza/100)
total do lote   = física × dosesPerPackage × unidades do lote ÷ 1.000.000
```

**Batem 26 de 26**, com tolerância de 0,5%. Exemplos:

| Item | q | pureza | overage | doses | lote | calculado | legado |
|---|---|---|---|---|---|---|---|
| MP-000462 | 130 mg | 96 | 20 | 30 | 300 | 1,462500 | 1,4625 |
| MP-000503 | 5 mg | 100 | 20 | 30 | 300 | 0,054000 | 0,054 |
| MP-000504 | 20 mg | 100 | 20 | 30 | 300 | 0,216000 | 0,216 |

A fórmula do item 25 não é provável: é a que reproduz o histórico real.

---

## O conflito que interrompe a implementação

O dado se parte em **duas populações com significados opostos** para
`component.quantity`.

**População A — 26 componentes, todos em versões ACTIVE, 5 produtos.**
Quantidade é TEÓRICA. Pureza e overage estão registrados e **são aplicados
hoje** pelo motor. O fator de correção em uso vai de **1,20 a 2,40**.

**População B — os outros 1.699 componentes.** Sem pureza nem overage
registrados. A quantidade já vem corrigida de fora. Coenzima Q10 prova:
`0,134694 kg` para base 20 dá 224,4898 mg/dose, e `224,4898 × 0,98 = 220` — a
divisão por pureza já está embutida, e a pureza não está registrada.

### Por que isso trava os itens 19, 24, 91 e 92

O handoff manda que todo componente existente vire `PHYSICAL_DIRECT` com
`applyPurity = false` e `effectiveQuantity = quantity`, e que se prove
`effectiveQuantity == quantity anterior` para 100% dos migrados.

Para a população B isso é exato e inofensivo.

Para a população A, isso **reduziria silenciosamente a necessidade física de
material entre 1,2× e 2,4×** em cinco formulações ativas. É o oposto de zero
drift — e drift na direção mais perigosa, porque a fábrica passaria a separar
menos material do que a receita exige.

A ambiguidade está em "quantity anterior": o handoff quer dizer a quantidade
declarada, enquanto o valor que preserva o comportamento é a `requiredQuantity`
pós-correção.

### O risco que a capability resolve de verdade

Hoje, **preencher a pureza de um componente aplica a correção automaticamente**.
É exatamente o que o item 23 diz que não pode acontecer: campo preenchido não é
autorização para recalcular.

Se alguém preencher a pureza em qualquer componente da população B — cuja
quantidade já vem corrigida — a correção é aplicada uma **segunda vez**, em
silêncio. Com a Coenzima Q10 isso daria `224,49 ÷ 0,98 = 229,07` mg/dose no
lugar de 224,49.

A capability continua valendo. A justificativa é que muda: não é "passar a
aplicar pureza", é **tornar a aplicação explícita e opt-in**, para que o campo
documental deixe de ser gatilho silencioso de recálculo.

## Superfície afetada

| | Local | Produção |
|---|---|---|
| Componentes | 1.725 | 0 |
| Com pureza/overage | 26 | 0 |
| Versões ACTIVE | — | 0 |
| Ordens de Produção | 0 sobre essas versões | 0 |
| Cálculos salvos | — | 0 |

Produção está vazia de dado de negócio: o risco de migration lá é nulo hoje.

## Decisão necessária do PO

O item 16 manda parar quando a semântica for contraditória, e o item 127 proíbe
implementar fórmula por intuição. As duas condições se aplicam.

**Pergunta única:** para os 26 componentes da população A, que hoje têm pureza e
overage aplicados pelo motor, o backfill deve

- **(a) preservar o comportamento atual** — `THEORETICAL_WITH_ADJUSTMENTS` com
  `applyPurity` e `applyOverage` ligados, mantendo a necessidade física como
  está hoje; ou
- **(b) seguir o item 19 literalmente** — `PHYSICAL_DIRECT`, aceitando que a
  necessidade física dessas cinco formulações caia entre 1,2× e 2,4×?

A leitura técnica é que **(a)** é o que "nenhuma receita existente muda
silenciosamente" quer dizer, e que o item 19 foi escrito sob a premissa errada
que este documento corrige. Mas isso muda necessidade de material em formulação
ativa, e a regra do projeto é não reinterpretar comportamento de fórmula sem
decisão explícita.

---

# Implementação — decisão (a), preservar o comportamento

O PO decidiu preservar o comportamento existente e **não** executar o item que
mandava colocar todo componente legado em `PHYSICAL_DIRECT`. A auditoria acima
corrigiu a premissa do handoff.

## O modelo

`FormulationComponent` ganhou três colunas: `quantityMode`
(`PHYSICAL_DIRECT` | `THEORETICAL_WITH_ADJUSTMENTS`), `applyPurityAdjustment` e
`applyOverageAdjustment`. O mesmo trio foi para o componente de **template**,
porque template carrega configuração técnica, não resultado de cálculo.

Nada foi persistido além disso. `ProductionOrderRequirement` já congela
`formulaQuantity`, `theoreticalQuantity`, `purityPercentApplied`,
`overagePercent` e `requiredQuantity`, e a versão da formulação é imutável
quando ativa — o histórico já estava coberto, e duplicar campo "por segurança"
só cria duas fontes que podem divergir.

## O backfill

Espelha a **condição do motor**, não a presença do campo: `applyPurityAndOverage`
aplica pureza quando `purity > 0` e overage quando `overage >= 0`. Reproduzir
essas duas condições é o que garante que nenhuma receita mude de resultado —
"campo preenchido" trataria pureza zero como ativa, e ela não é.

| Modo | Componentes |
|---|---|
| `PHYSICAL_DIRECT`, ambos desligados | 1.699 |
| `THEORETICAL_WITH_ADJUSTMENTS`, ambos ligados | 26 |

## Zero drift

`scripts/zero-drift-quantidade-fisica.mjs` fotografa o resultado autoritativo de
**todos** os componentes antes da mudança e reconfere depois, a doze casas
decimais, linha a linha.

```
conferidos 1725 de 1725
ZERO DRIFT: 1725/1725 semanticamente idênticos.
```

O conferente **replica** a conta em vez de chamar a função que está sendo
alterada. Um conferente que chama o próprio alvo não confere nada.

## O motor

`computeComponentRequirement` passou a perguntar quais ajustes o componente
autoriza, via `ajustesHabilitados`. Os cinco consumidores seguem intactos, e
continua havendo **uma** matemática.

## Prova histórica

`historico-versao-e-op.test.ts` e o E2E
`scripts/validate-physical-quantity-consistency.mjs` provam a cadeia:

| | Necessidade |
|---|---|
| V1 teórica, pureza aplicada → OP-A | `0,224490 kg` |
| V2 física direta, mesma pureza registrada → OP-B | `0,220000 kg` |
| OP-A **depois** de ativar a V2 | `0,224490 kg` — intocada |

As duas ordens divergirem é o resultado **certo**. O E2E também confere pela
tela que a V1 se apresenta como "Calculada · pureza" e a V2 como "Física direta ·
registrado, não aplicado".

Um segundo teste prende a propriedade do motor único: o físico por unidade que a
tela da Formulação mostra, multiplicado pelo lote, é exatamente a necessidade
que a Ordem de Produção congelou — dois consumidores, um resultado.

## Reexecução

O E2E usa o token de execução do harness, então cria a própria massa e
reencontra só o que ele criou. Rodado **duas vezes sobre a mesma base**:
`10 ok / 0 nok` nas duas, sem console error.

## A prévia ao vivo, e os dois defeitos que ela revelou

A tela mostrava travessão nas colunas de equivalente e de físico até a versão
ser salva: os dois números vinham do DTO. Quem estava decidindo a quantidade só
via o efeito depois de gravar.

Recalcular no navegador criaria um segundo motor. Em vez disso a matemática
subiu para `packages/shared/src/formulation-quantity.ts` e a API passou a
delegar — a mesma função, não uma cópia. `decimal.js` é a biblioteca que o
`Prisma.Decimal` usa por dentro, então os dois lados fazem a mesma aritmética.
`UnitOfMeasureDTO` ganhou `toBaseFactor` para a tela converter unidade sem uma
ida ao servidor a cada tecla.

Ligar a prévia expôs dois defeitos que estavam no código e nenhum teste via:

**1. O modo não viajava no payload.** `montarRascunho` não enviava
`quantityMode`, `applyPurityAdjustment` nem `applyOverageAdjustment`, embora o
comparador de alteração pendente já os lesse. Consequências fora do teste: o
seletor de modo era decorativo, e salvar qualquer edição de um componente
teórico o devolvia a `PHYSICAL_DIRECT` — a necessidade física caía pelo fator de
pureza, em silêncio, e a tela mostrava o número novo como se fosse o pedido.

**2. Base desconhecida derrubava a tela.** O `switch` da base não tinha
`default`, devolvia `undefined`, e a multiplicação seguinte estourava dentro do
`decimal.js`. Enquanto a conta era só do servidor o tipo bastava; com a tela
chamando a mesma função, um DTO antigo derruba a página inteira. Agora bloqueia
com motivo — e não devolve zero, que seria a resposta plausível e errada.

Um terceiro ponto foi decidido junto: sair do modo teórico **desliga** as marcas
de pureza e overage, na tela e no servidor. Marca ligada sob física direta é
estado invisível que religa a correção quando alguém volta o modo.

## Fora de escopo, registrado

Produto próprio Veridi, estoque de produto acabado próprio e venda do mesmo
produto acabado para múltiplos clientes ficaram fora por decisão do PO — item 25
do `BACKLOG.md`. Matéria-prima e embalagem continuam itens globais.
