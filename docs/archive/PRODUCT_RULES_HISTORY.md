# Histórico do PRODUCT_RULES

> **Arquivo histórico. Não é contexto padrão de trabalho.** A regra vigente está em
> [`PRODUCT_RULES.md`](../PRODUCT_RULES.md).

Texto que a compactação de 2026-09-19 (DOCUMENTATION-HYGIENE-COMPACTION-01) tirou do corpo normativo do
PRODUCT_RULES, verbatim, agrupado pelo § de origem: narrativa de como a regra nasceu, medições e contagens da época,
o que o código fazia antes, notas de entrega e de migration, e apontadores de código. Nenhuma regra, condição ou
exceção saiu de lá — o que ficou no § é o texto normativo, e o § não mudou de número. A linha indica onde o bloco
estava no PRODUCT_RULES de `main` `8cf83861`, antes da compactação.

## 29. Customer Orders & Fulfillment Plan (Block D)

*linhas 1956–1960 — estado de entrega de 'Delivery 16', desatualizado: Sugestão de Compra, Expedição e Faturamento já existem.*

Customer Order, Fulfillment Plan, Finished-Product Reservation and
Suggested Production Orders (22-25) are implemented as of Delivery 16 —
see "Durable rules confirmed at implementation" below. Purchase
suggestion (26), Shipping (27) and Invoicing (28) remain future/not
started.

## §39 — Rules from the first end-to-end case (VAL-LEG-01)

*linhas 2900–2902 — desfecho do primeiro caso ponta a ponta.*

The first real order went from customer to invoice through the published UI.
It passed, and it left three places where the domain was right but the system
gave the operator no way to say so.

## §45 — Ajuda contextual e rótulos de ação

*linhas 3247–3253 — histórico das versões anteriores da regra da ajuda e a medição da UX-HELP-01.*

**Por que esta ordem, e o que ela substitui.** A versão anterior desta regra
mandava começar pelo conceito e apresentar o glossário antes do caminho. Ela
corrigiu um defeito real — uma versão ainda mais antiga explicava só onde a
tela ficava numa cadeia maior ("Produto › Formulação › Custo › Preço") e não
dizia o que a tela na frente da pessoa fazia. A correção, porém, produziu
outro defeito: a auditoria UX-HELP-01 mediu 31 mil palavras de ajuda em que a
resposta útil chegava depois de nove a treze termos de dicionário.

## §51 — A referência externa não manda no modelo

*linhas 3697–3712 — o caso da Coenzima Q10 que originou a regra.*

**Caso que originou a regra.** A rodada adversarial comparou o CMV da Coenzima
Q10 — sistema ≈ R$ 11 mil por 1000 potes contra ≈ R$ 2,4 mil na planilha — e
deixou aberta a hipótese de o motor estar errado por um fator de quatro.

Medido depois: `cmv_precificacao.csv` repete `custo_por_1000_unid = 2431.872`
nos **nove** produtos, inclusive na linha chamada `CMV modelo`. Valores
distintos na planilha inteira: um. Creatina, de um componente, não custa o mesmo
que Magnésio Treonato, de lote 20.000 — a aba de precificação nunca foi
recalculada por produto.

Somando os próprios componentes da planilha (`kg_lote × preço_brl_kg`), a
Coenzima Q10 dá **R$ 9.708,23** de material por 1000 unidades. A planilha
contradiz a si mesma, e o número que servia de referência era o do modelo.

Ajustar o motor para R$ 2,4 mil teria quebrado o cálculo de todos os produtos
para reproduzir um valor que a própria fonte não sustenta.

## §76 — A oferta do fornecedor só participa do custo com vigência, e só uma por item

*linhas 5096–5100 — motivação e contagem da base legada (602 ofertas).*

O degrau 4 de §53 — "oferta válida de fornecedor homologado" — existia na
regra e não existia na operação: as 602 ofertas da base vieram da planilha
sem data de cotação, e sem vigência uma oferta é observação histórica. Quem
cadastrava cinco preços e abria o CMV via "sem custo conhecido", sem nada
ligando as duas telas.

*linhas 5170–5171 — contagem de dados na correção.*

Nenhum dado foi alterado por essa correção. As 293 referências existentes são
todas BRL; a proteção vale para o que vier.

## §78 — O custo é da quantidade calculada; "por 1.000" é razão, não execução

*linhas 5278–5280 — nota de entrega: nada de domínio mudou.*

**Nada de domínio mudou.** Nenhum snapshot foi recalculado, nenhum campo
renomeado (`costPer1000`, `costPer1000Snapshot` seguem com o nome técnico) e
nenhuma migration nasceu disto: é copy e hierarquia.

## §79 — A vigência da tarifa industrial é dia civil, inclusiva nas duas bordas

*linhas 5294–5298 — o que o código fazia antes da correção.*

**O que estava errado.** `isRateCurrent` comparava INSTANTES: o marcador de
"válida até 09/09" é `00:00:00.000`, então qualquer relógio depois disso já a
declarava histórica. A tarifa morria durante o próprio dia impresso nela — e
`toRateDTO` decidia com `new Date()`, o relógio do processo, que em Railway é
UTC. Um teste feito de manhã nunca veria o defeito.

*linhas 5300–5304 — a suspeita do walkthrough e o resultado da auditoria.*

**A suspeita original era outra, e estava errada.** O walkthrough relatou
"agosto deveria usar A e usa B". A auditoria não confirmou: com A vigente desde
janeiro e B desde setembro, agosto sempre respondeu A e setembro sempre
respondeu B, e os snapshots econômicos sempre ficaram congelados. O defeito real
era a borda do dia, e só ela foi corrigida.

*linhas 5341–5342 — nota de migration.*

Nenhuma migration nasceu disto: a semântica é de leitura, e a coluna já era a
certa.

## §81 — Quais INSTANTES pertencem ao dia comercial da pergunta

*linhas 5481–5487 — subseção 'O que NÃO mudou': o que a mudança deixou intacto e a auditoria de PROD.*

### O que NÃO mudou

Hierarquia de fontes (§53), fórmula da média ponderada, filtro de moeda BRL,
`referenceDate` explícita no motor (§5.8) e snapshots já persistidos. A mudança
é de leitura e de padrão futuro: **nenhum dado gravado estava errado**, e a
auditoria de produção confirmou — 295 referências, todas em marcador de
meia-noite UTC, nenhuma na faixa problemática. Sem backfill e sem migration.

*linhas 5489–5495 — subseção 'Onde a regra vive': apontadores de código.*

### Onde a regra vive

`limitesDaJanelaDeCusto` em `apps/api/src/lib/cost-reference.ts` — a definição
da elegibilidade temporal, exportada porque é ela que os testes de borda
interrogam. Os limites do dia vêm de `limitesDoDiaComercial`, e o deslocamento
de calendário de `diaCivilDeslocado`, os dois na fundação de `@veridi/shared`.
Nenhum helper novo de fuso nasceu aqui.

## §106 — Base de cálculo do componente: o sistema deriva, a versão guarda

*linha 6942 — nota de migration.*

**Sem migration.** A coluna `basis` continua no schema, com o mesmo enum.

## §110 — Item duplicado: o canônico absorve, e a carga não recria

*linha 7126 — nota de entrega.*

**Sem migration.** Nenhuma tela nova.

## §112 — Item × Fornecedor: cadastro inativo não começa compromisso novo

*linha 7255 — nota de migration.*

**Sem migration.** Nenhuma coluna nova: `active` já existe em Item, Fornecedor e na relação.

## §113 — Uso e consumo: material que se compra e se estoca, e não entra em receita

*linha 7283 — nota de migration.*

**Migration.** `20260925093034_item_type_internal_consumable` — valor de enum e sequence, nada mais.

## §115 — Consumo interno: usar o material é uma saída, não um acerto de saldo

*linhas 7457–7458 — nota de migration.*

**Migration.** `20260925093035_internal_consumption` — enum `CostSource` (espelho do tipo do shared), os dois valores de
enum do ledger, a tabela `internal_consumptions` e a sequence `internal_consumption_code_seq`.

## §116 — Componente inativo não inicia compromisso novo de Produção

*linha 7506 — nota de migration.*

**Sem migration.** Nenhuma coluna nova: `active` já existe no Item.

## §117 — Relatório de Uso e consumo (R-21): a despesa como foi registrada, e o sem custo à vista

*linha 7573 — nota de migration.*

**Sem migration.**

## §118 — Onda 2 do saneamento: a decisão nomeia o grupo, e o canônico recebe só o que a decisão escreveu

*linha 7649 — nota de migration e de estado do índice único.*

**Sem migration**, e sem índice único ainda: MASTER-DATA-NAME-UNIQUENESS-01 continua depois do saneamento completo.

## §120 — Nunca zero ADMIN ativo, e ninguém tira de si o acesso administrativo

*linha 7771 — nota de migration.*

**Sem migration.**

## §121 — Roteiro de Produção arquivado: sai das escolhas, e o que já existe fica

*linhas 7825–7826 — nota de migration.*

**Sem migration.** `archivedAt` e `archivedBy` já existiam em `production_profiles`, e a lista já escondia o
arquivado — faltava a ação.

## §122 — Dados cadastrais do CNPJ: editáveis, consulta aditiva e histórico

*linhas 7880–7881 — nota de migration.*

**Migration aditiva** (`20260925093037_customer_cnpj_registration_history`): enum e tabela novos, sem backfill; as
colunas de `customers` e a migration da §119 ficam intocadas.

## §124 — Onda 3 do saneamento: fundir, renomear, excluir o agregado sem uso ou manter em revisão

*linha 7956 — nota de migration e de estado do índice único.*

**Sem migration.** O índice único de MASTER-DATA-NAME-UNIQUENESS-01 continua esperando os dois grupos em revisão.

## §127 — Consumo interno de data passada não atravessa uma contagem de inventário

*linha 8189 — nota de migration.*

**Migration.** Nenhuma.
