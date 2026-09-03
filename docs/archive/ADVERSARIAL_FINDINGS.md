# Findings — E2E adversarial core

Registro corrido. Reproducao verificada por mim antes de entrar aqui.

---

## ADV-F1 — HIGH · filtro de status do Pedido recusado pela API, e a tela nao diz

**Tela:** Comercial > Pedidos (lista), "Filtrar por status".

**Reproducao:** selecionar "Parcialmente expedido" ou "Expedido".

**Causa:** `listCustomerOrdersQuerySchema` aceita
`["DRAFT","CONFIRMED","IN_FULFILLMENT","CANCELLED"]`
(`apps/api/src/modules/customer-orders/customer-orders.schemas.ts:36`), mas o
dominio tem seis status — `PARTIALLY_SHIPPED` e `SHIPPED` existem no enum, nos
rotulos e no `<select>` da tela.

**Medido:**

| status | HTTP |
|---|---|
| DRAFT | 200 |
| CONFIRMED | 200 |
| IN_FULFILLMENT | 200 |
| PARTIALLY_SHIPPED | **400** |
| SHIPPED | **400** |
| CANCELLED | 200 |

**Por que e HIGH e nao LOW:** a recusa nao limpa a tabela. O banner generico
"Erro de validacao" aparece no topo e a lista ANTERIOR continua na tela, com o
contador intacto. Quem filtra por "Expedido" recebe uma lista que contem
pedidos nao expedidos, e nada indica que o filtro nao foi aplicado. E o mesmo
modo de falha que o `PRODUCT_RULES` ja nomeia para link que carrega contexto e a
tela ignora: pior que nao existir, porque ensina a confiar.

**Invariante:** nenhuma escrita envolvida — defeito de leitura e de apresentacao.

**Status:** reproduzido, NAO corrigido nesta passada (regra da rodada: validar
primeiro). Nao contamina as ondas de Estoque e Producao.

---

## ADV-F2 — MEDIUM · badge de Status fora da area visivel na lista de Pedidos

`table-container` com `scrollWidth 1296` contra `clientWidth 1138` a 1440px:
~158px cortados. Mitigado em parte pela coluna "Atendimento", que espelha o
status real so para `SHIPPED` e `PARTIALLY_SHIPPED`; para `DRAFT`, `CONFIRMED` e
`CANCELLED`, quem nao rolar nao ve o status.

---

## ADV-F3 — MEDIUM · "Preparar Expedicao" habilitado sem nada reservado

`CustomerOrderPage.tsx` — o botao so desabilita durante o proprio envio. Com
"Reservado restante" e "Disponivel agora" zerados em todas as linhas, ele segue
clicavel e cria uma expedicao em rascunho vazia. Nao e destrutivo (rascunho nao
toca estoque), mas o botao irmao "Reservar disponivel" desabilita corretamente
no mesmo estado — a inconsistencia fica visivel lado a lado.

---

## ADV-F4 — LOW · liberar/bloquear lote sem entrada propria no menu

O grupo "Qualidade" so tem Documentos/CoA. A liberacao chega pelo Dashboard ou
por Estoque > Lotes filtrado a mao. Mitigado: a fila de CoA tem estado vazio que
ensina o caminho.

---

## Limitacoes de verificacao registradas

- Nenhuma OC em `PARTIALLY_RECEIVED` nem OP em `RELEASED`/`IN_PRODUCTION` foi
  capturada ao vivo pelo observador: a cadeia adversarial atravessa esses
  estados rapido demais para o poll. As respostas correspondentes vieram de
  leitura de codigo mais padrao analogo observado, e estao marcadas como tal.
- So existe usuario `ADMIN` na base, entao a promessa de que Liberar/Bloquear
  some para outros papeis nao pode ser confirmada visualmente.

---

## ADV-F5 — HIGH · ajuste de estoque nao registra quem fez, e nao exige papel

**Rotas:** `POST /inventory-adjustments` e `POST /stock-counts`
(`apps/api/src/modules/inventory/inventory.routes.ts:141` e `:159`).

**Duas faltas na mesma rota:**

1. **Sem autoria.** O handler chama `createInventoryAdjustment(parsed.data)` sem
   passar o ator, ao contrario de todas as outras rotas que movimentam estoque.

2. **Sem papel.** Nao ha `requireRole`. Bloquear, liberar ou desbloquear um lote
   exige `QUALITY` ou `ADMIN` (`lots.routes.ts:78,111,141`); ajustar o SALDO nao
   exige nada alem de estar autenticado.

**Medido no banco, agrupando por tipo e autor:**

| tipo de movimento | createdBy | qtd |
|---|---|---|
| RECEIPT_IN | Administrador local | 22 |
| PRODUCTION_CONSUMPTION | Administrador local | 16 |
| FINISHED_GOOD_PRODUCTION | Administrador local | 3 |
| SHIPMENT_OUT | Administrador local | 2 |
| **ADJUSTMENT_OUT** | **Ambiente local** | **3** |
| **LOSS** | **Ambiente local** | **1** |

`Ambiente local` e a constante de sistema usada como reserva quando nao ha ator.
Todo o resto grava o usuario autenticado; so ajuste e perda nao.

**Por que HIGH:** o `CLAUDE.md` declara que o historico de estoque e auditavel, e
o ajuste e a UNICA operacao que muda saldo sem documento de origem — nao ha OC,
recebimento, OP nem expedicao para responder por ela. E exatamente a operacao
mais sensivel a erro e a fraude, e e a unica sem autor. O motivo e gravado
("quebra de saco no armazem"), o que torna a lacuna mais visivel: o sistema
pergunta POR QUE e nao registra QUEM.

**Invariante:** o saldo resultante esta correto — a reconstrucao do ledger fecha
no digito. O defeito e de rastreabilidade e de autorizacao, nao de aritmetica.

**Status:** reproduzido, NAO corrigido nesta passada.

---

## ADV-F6 — MEDIUM · filtro de tipo em Movimentacoes oferece 9 opcoes e a API aceita 4

Mesma classe do ADV-F1, em outra tela. `/estoque/movimentacoes` renderiza os 9
tipos de `INVENTORY_MOVEMENT_TYPE_LABELS`; `listInventoryMovementsQuerySchema`
aceita `RECEIPT_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT` e `LOSS`. As outras cinco
devolvem 400 e a lista nao carrega.

**Padrao, nao coincidencia:** duas telas ja apareceram com o mesmo desenho — a
tela monta o seletor a partir do enum do dominio e o schema da consulta lista um
subconjunto a mao. Toda vez que o dominio ganha um estado novo, o filtro passa a
oferecer algo que a API recusa, e ninguem percebe ate alguem clicar.

---

## ADV-F7 — LOW · Qualidade libera lote vencido

Liberar um lote com validade passada e aceito e o status vai para Disponivel; a
listagem entao imprime "Vencido" por cima. O disponivel continua zero, entao nao
ha risco de dado — e acao inutil oferecida.

---

## ADV-F8 — LOW · Plano de Atendimento aceita digitar reserva acima do disponivel

`CustomerOrderPage.tsx` — `handleAdjustReserve` so confere que
`Reservar + Produzir = Pedido`; nunca compara com o disponivel, que esta
renderizado na coluna ao lado. O botao "Aplicar Plano" segue habilitado, o
servidor recusa com 400, e o preenchimento de TODAS as linhas e descartado.

Integridade intacta — a aplicacao e transacional e ficou provado que nada foi
escrito. E inconsistencia de tela, e a mesma OP faz o oposto no Consumo Real,
onde o campo mostra "Maximo disponivel nesta reserva" e desabilita antes do
envio.

---

# Checkpoints

| Onda | Veredito | Negativos | Ledger |
|---|---|---|---|
| 1 · Estoque e suprimentos | PASS WITH FINDINGS | 13/13 BLOCKED_CORRECTLY | fecha, 6 lotes |
| 2 · Pedido, reserva e producao | PASS WITH FINDINGS | 18/18 BLOCKED_CORRECTLY | fecha, 10 lotes |

Nenhum BUG. Nenhum CRITICAL. Nenhuma parada obrigatoria acionada.

## ADV-F9 — Escopo real da classe "filtro oferece o que a API recusa"

**Severidade:** análise (fecha ADV-F1 e ADV-F6; não é achado novo)

Levantei se F1 e F6 eram sintoma de uma classe do app: tela renderiza o enum
inteiro do domínio, schema de consulta lista um subconjunto à mão. Varri os 32
mapas de rótulo de `packages/shared` contra os 18 enums de filtro de
`apps/api/src/modules/**.schemas.ts`, e depois conferi par a par por entidade —
o cruzamento cego produz falso positivo em massa.

**Não é classe do app. São exatamente dois módulos.**

O resto do código faz certo, e de duas maneiras diferentes, as duas válidas:

- `reports/reports.schemas.ts` lista os **6** status de Pedido completos em
  `customerOrdersQuerySchema` e em `fulfillmentQuerySchema`; a tela
  `CommercialReports.tsx` mapeia `Object.keys(CUSTOMER_ORDER_STATUS_LABELS)` e
  nunca diverge.
- `ProductionReports.tsx` faz o contrário e também fecha: escreve à mão
  `["DRAFT","PLANNED","RELEASED","IN_PRODUCTION"]` no `<select>`, exatamente o
  subconjunto que `requirementsQuerySchema` aceita. Relatório de requisitos
  sobre OP aberta não deve mesmo oferecer OP concluída.
- `shipments` (3) e `billings` (3) batem membro a membro com
  `SHIPMENT_STATUS_LABELS` e `BILLING_STATUS_LABELS`.
- `reports.movementsQuerySchema` usa `type: z.string()`, sem enum: frouxo, mas
  aceita os 9. Por isso `InventoryReports.tsx` funciona e a tela operacional não.

Ou seja: `customer-orders` e `inventory` são **desvio**, não decisão de projeto.
O repositório já demonstra o padrão correto em quatro lugares.

### Prova HTTP de ADV-F6

`GET /inventory-movements?type=<T>`, sessão autenticada, os 9 tipos que
`InventoryMovementsPage.tsx:123` renderiza via `Object.entries(INVENTORY_MOVEMENT_TYPE_LABELS)`:

| Tipo | HTTP |
|---|---|
| RECEIPT_IN | 200 |
| ADJUSTMENT_IN | 200 |
| ADJUSTMENT_OUT | 200 |
| LOSS | 200 |
| PRODUCTION_CONSUMPTION | **400** |
| SAMPLE_CONSUMPTION | **400** |
| OPENING_BALANCE | **400** |
| FINISHED_GOOD_PRODUCTION | **400** |
| SHIPMENT_OUT | **400** |

`apps/api/src/modules/inventory/inventory.schemas.ts:16` aceita 4.

O peso operacional está no lado que quebra: consumo de produção, saída de
expedição e entrada de produção são as três perguntas centrais de auditoria de
estoque num ERP industrial — "o que saiu por expedição no período" é consulta
de rotina, e ela responde 400 com a tabela anterior ainda na tela.

**Correção sugerida (não aplicada — rodada de validação):** derivar os dois
schemas dos `readonly` já exportados em `packages/shared`
(`INVENTORY_MOVEMENT_TYPES`, `CUSTOMER_ORDER_STATUSES`) via `z.enum([...])`,
para que um estado novo do domínio não possa nascer quebrando um filtro.

## ADV-F10 — Preço acordado com 4 casas: pedido mostra 4, faturamento mostra 2, total usa 4

**Severidade:** HIGH **se** reproduzir pela interface — pendente de prova na Onda 3.
**Origem:** leitura de código + `information_schema`. Ainda NÃO provado por tela.

`agreedUnitPrice` é `Decimal(14,4)` — confirmado no banco local, não só no
`schema.prisma`:

```
billing_lines          agreedUnitPrice   scale 4
billing_lines          unitPrice         scale 4
customer_order_lines   agreedUnitPrice   scale 4
quote_lines            unitPrice         scale 4
```

Preço de 4 casas entra pela tela: `optionalDecimal`
(`apps/api/src/modules/projects/projects.schemas.ts:9`) valida com
`/^\d+(\.\d+)?$/`, sem limite de casas.

O mesmo campo sai com precisão diferente conforme a tela:

| Onde | Código | Casas |
|---|---|---|
| Pedido | `customer-orders.service.ts:188` `.toFixed(4)` | 4 |
| Faturamento | `billings.service.ts:50` `formatMoney = .toFixed(2)` | **2** |

E o total **não** é calculado sobre o que está exibido:

- total da linha (`billings.service.ts:55`): `quantity.times(unitPrice)` sobre o
  valor cheio de 4 casas, arredondado só na saída;
- total do documento (`billings.service.ts:93`): soma os produtos **não
  arredondados** e arredonda uma vez no fim.

Com preço `4.0531` e 123 un: total da linha exibido `R$ 498,53`; o operador
conferindo o documento faz `4,05 × 123 = R$ 498,15`. Documento de faturamento
que não fecha na conferência manual — 38 centavos de diferença que ninguém
consegue explicar olhando o papel.

Some-se a isso `Σ round(linha)` ≠ `round(Σ linha)` por construção: o total do
documento pode divergir da soma das linhas impressas.

**Ressalva honesta:** a soma no fim é a ordem CORRETA de arredondamento — o
defeito não é o cálculo, é **exibir o preço com menos casas do que o cálculo
usa**. Nenhum dado local prova hoje o cenário: a única linha existente tem
preço `3.6000`, exato em 2 casas, e `scale()` no Postgres devolve a escala
declarada, não as casas significativas. Por isso está como hipótese.

Repasse enviado à Onda 3 para prova por interface, com instrução explícita de
que refutar também é resultado.

## ADV-F11 — Dois parsers decimais na API, mensagem de erro descreve outro defeito

**Severidade:** LOW (latente — o caminho pela tela está protegido)

`apps/api/src/lib/decimal-schema.ts` normaliza vírgula para ponto. O módulo de
projetos ignora isso e define o seu (`projects.schemas.ts:9`), que só aceita
ponto e, ao recusar, responde:

> "Valor inválido (não pode ser negativo)"

`4,05` não é negativo. A mensagem descreve um defeito diferente do que ocorreu —
exatamente o tipo de texto que faz o operador procurar erro onde não há.

Hoje não chega ao usuário: `QuoteVersionsSection.tsx:468` passa o valor por
`exigirDecimalOpcional`, que converte a vírgula antes de enviar. Fica registrado
como latente: qualquer outro cliente da API, ou a remoção desse guarda na tela,
expõe a mensagem errada.

### F10 — evidência adicional: é desvio de convenção, não escolha

Varri as duas formatações no `apps/api/src/modules`. A convenção do repositório
é consistente e explícita:

**Preço unitário sai com 4 casas** — `customer-orders.service.ts:188`,
`pricing.service.ts:96/475/477`, `product-cmv.service.ts:45`,
`quotes.service.ts:89`.

**Total de linha e de documento saem com 2** — `customer-orders.service.ts:189`,
`quotes.service.ts:76`, `cost-reports.service.ts:257`.

Só dois módulos aplicam o formatador de DINHEIRO a um PREÇO UNITÁRIO:

- `billings.service.ts:71-72` (`agreedUnitPrice` e `unitPrice`);
- `purchase-orders.service.ts:88` (`unitPrice`).

Ou seja: o produto tem uma regra de precisão, ela está escrita em quatro
lugares, e o faturamento é onde ela não foi seguida — logo onde o número vira
documento. Isso remove a leitura de "decisão de apresentação do faturamento" e
deixa a de desvio.

Compras entra na mesma classe e não estava no escopo desta rodada: registrar
para verificação separada, sem afirmar impacto antes de medir.

## ADV-F10 — VEREDITO APÓS PROVA POR INTERFACE (Onda 3)

**Metade da minha hipótese estava errada. Corrijo antes de manter o achado.**

**Refutado — preço não perde casas entre telas.** Eu disse que o Pedido mostraria
`4,0531` e o Faturamento `4,05`. Falso. `formatBRL` usa
`toLocaleString("pt-BR", { style: "currency" })`, que fixa 2 casas nas duas
telas: as duas mostram `R$ 4,05`. A divergência `.toFixed(4)` × `.toFixed(2)`
existe na API e nunca chega ao usuário. Meu erro foi ler a formatação do
servidor e supor que ela sobrevivia até a tela, sem conferir a camada que
formata de novo — a mesma classe de erro das regressões da rodada anterior:
verificar que a regra foi aplicada, não que ela aparece.

**Confirmado, e mais grave do que a metade que caiu.** Justamente porque as
duas telas mostram `R$ 4,05`, o operador não tem como chegar ao total impresso.

Medido por mim em `GET /billings/<id>` de `FAT-000152`:

```
qtd 123 | acordado 4.05 | faturado 4.05 | total linha 498.53 | total documento 498.53
```

`4,05 × 123 = 498,15`. O documento diz `498,53`. **R$ 0,38** que não sai de
nenhuma conta possível com os números impressos, porque o total vem de
`quantity.times(unitPrice)` sobre o `4.0531` cheio
(`billings.service.ts:55`), e o preço sai por `formatMoney = .toFixed(2)`
(`billings.service.ts:50`).

Severidade **HIGH** mantida: é faturamento, é dinheiro, e é um documento que não
se sustenta na conferência. A causa é a que descrevi — formatador de dinheiro
aplicado a preço unitário — e a evidência de convenção segue valendo.

**Hipótese 3 (drift de somatório)** não pôde ser exercitada: um orçamento aceita
cada produto uma única vez e o substrato tinha um lote livre, então não há
caminho de tela para duas linhas no mesmo documento. Fica em aberto, não
refutada.

## ADV-F12 — Rastreabilidade nega expedição de lote que saiu por outro pedido

**Severidade:** HIGH · **Confirmado por mim, não só pelo executor**

`apps/api/src/modules/lots/traceability.service.ts:90` busca as expedições do
lote assim:

```ts
where: { customerOrderId: pedido.id, status: "CONFIRMED", lines: { some: { lotId: lot.id } } }
```

`pedido` é o Pedido **da Ordem de Produção**, não o pedido que consumiu o lote.
O segundo predicado já é suficiente e correto; o primeiro é o defeito.

Estoque é fungível: um lote produzido para um pedido pode legitimamente atender
outro. Quando isso acontece, a seção "Destino comercial" da tela do lote afirma
**"Este lote ainda não foi expedido."**

Medição minha, no banco local:

```
OP: OP-000659 | pedido da OP: PED-000484
expedicoes que levaram ESTE lote: 1
    EXP-000235 CONFIRMED pedido PED-000485 qtd 400
visiveis na tela do lote (filtro atual): 0
```

Os dados estão certos — o movimento existe, o físico caiu de 800 para 400, o
vínculo `shipment_lines.lotId` está lá. **A consulta é que está errada**, e ela
responde com uma negativa falsa.

O peso não é de apresentação. "Por onde este lote saiu" é a pergunta de
**recall** num ERP de nutrição: é o que se pergunta quando um lote precisa ser
recolhido do mercado. A tela responde que ele não saiu.

Correção sugerida (não aplicada): remover `customerOrderId: pedido.id` do
`where` e derivar o pedido de cada expedição encontrada, já que o destino
comercial de um lote pode ser mais de um pedido.

## ADV-F13 — Drift de centavo entre a soma das linhas e o total do documento

**Severidade:** HIGH · **Achado NOVO, encontrado na rodada de correção**

A Onda 3 não conseguiu exercitar este caso pela interface: um faturamento tem
uma linha por linha de expedição, que vem de uma linha de reserva, e um
orçamento aceita cada produto uma única vez — com um lote livre no substrato,
não havia caminho de tela para montar duas linhas no mesmo documento. Ficou
registrado como **em aberto, não refutado**.

O handoff de correção mandou escrever o teste barato de serviço mesmo assim, e
dizer que estava refutado se passasse. **Não passou.**

Duas linhas com preço de quatro casas:

```
123 × 4,0531 = 498,5313  →  linha impressa  R$   498,53
147 × 9,7203 = 1428,8841 →  linha impressa  R$ 1.428,88
                            soma das linhas R$ 1.927,41
                            total do rodapé R$ 1.927,42
```

O total somava os produtos **não arredondados** e arredondava uma vez no fim.
`Σ round(linha)` ≠ `round(Σ linha)`: um centavo que não sai de nenhuma conta
possível com o documento na mão, e que cresce com o número de linhas.

Somar e arredondar no fim é o correto em estatística e o errado num documento
— o que o cliente confere são as linhas. A ordem passou a ser a mesma da nota
fiscal: cada linha fecha em dois decimais, e o documento é a soma dessas
linhas.

Corrigido em `billings.service.ts`, com regressão em
`billing-price.test.ts` — o teste que o encontrou.

**Nota de método:** este achado só existe porque o handoff pediu o teste de um
caso que a interface não alcança. "Não consegui reproduzir pela tela" não é o
mesmo que "não acontece", e a diferença entre as duas frases era um centavo por
linha em todo documento de mais de uma linha.
