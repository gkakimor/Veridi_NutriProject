# Validação E2E adversarial — núcleo operacional

Estoque, movimentações, produção, expedição, faturamento e rastreabilidade.

**Não é smoke test.** Smoke pergunta se o caminho feliz anda. Esta rodada
pergunta o contrário: onde o sistema aceita, em silêncio, algo que não deveria.
O alvo declarado era corrupção silenciosa, saldo errado, movimento em
duplicidade, lote trocado, rastreabilidade rompida, faturamento duplicado,
estado impossível, regra contornável, erro de concorrência e tela que induz o
operador ao erro.

**Veredito da validação: PASS WITH FINDINGS.** Zero CRITICAL. Nenhum dado
corrompido em nenhuma das quatro ondas: todos os achados estão em consulta,
apresentação e controle de acesso — nenhum no que grava.

**Estado atual: fechada.** Os onze achados reproduzíveis foram corrigidos, mais
um décimo segundo que só apareceu durante a correção. Ver
[Fechamento](#fechamento) no fim deste documento; o corpo abaixo é o registro do
que foi encontrado, preservado como estava.

---

## Ambiente e segurança

Tudo local. `postgresql://…@localhost:5432/veridi_dev`.

Produção Railway não foi tocada em nenhum momento desta rodada: nada de
`DELETE`, `TRUNCATE`, reset ou seed. O guarda de reset
(`scripts/local-db-guard.mjs`) recusa execução quando a `DATABASE_URL` aponta
para Railway ou Neon, quando o nome do banco contém `prod`, ou quando
`RAILWAY_ENVIRONMENT` está presente — não confia em `NODE_ENV`.

Os dados reais usados na massa ficam no ambiente local, não aparecem aqui e não
foram enviados a serviço externo. Este documento identifica item, lote,
quantidade e valor quando eles são a prova; não reproduz CNPJ, telefone,
e-mail, endereço nem razão social.

## Regra da rodada

**Todo registro de negócio nasceu pela interface.** Nenhum `POST` de API,
nenhum SQL, nenhum seed, nenhuma fixture criou operação. Banco e API foram
usados só depois, para conferir invariante — nunca para fabricar o resultado
esperado.

## Método

Cada caso: **PRECONDIÇÃO · AÇÃO · ESPERADO · REAL · INVARIANTE**.

Caminho proibido termina como `BLOCKED_CORRECTLY` ou `BUG`, com foto do estado
antes e depois. "Deu erro na tela" não conta como prova: o que conta é o estado
não ter mudado.

---

## Ondas

| Onda | Suíte | Marcos | ok | nok |
|---|---|---|---|---|
| 1 · Estoque e movimentações | `scripts/validate-adversarial-stock.mjs` | 13 | 81 | 1 |
| 2 · Produção | `scripts/validate-adversarial-production.mjs` | 15 | 135 | 0 |
| 3 · Expedição e faturamento | `scripts/validate-adversarial-billing.mjs` | 12 | 106 | 1 |
| 3 · Rastreabilidade | `scripts/validate-adversarial-traceability.mjs` | 5 | 30 | 0 |
| **Total** | | **45** | **352** | **2** |

Console limpo nas quatro suítes: `console.error=0`, `pageerror=0`. Nenhuma
resposta `>=400` fora das deliberadas nos caminhos proibidos.

As suítes retomam por marco: rodar de novo pula o que já foi feito e não duplica
operação. Reproduzir um achado é rodar a suíte correspondente.

---

## Achados

| # | Severidade | Achado |
|---|---|---|
| ADV-F12 | **HIGH** | Rastreabilidade nega expedição de lote que saiu por outro pedido |
| ADV-F10 | **HIGH** | Documento de faturamento não fecha com os números que ele mesmo exibe |
| ADV-F5 | **HIGH** | Ajuste de estoque não registra quem fez, e não exige papel |
| ADV-F1 | HIGH | Filtro de status do Pedido: tela oferece 6, API aceita 4 |
| ADV-F2 | MEDIUM | Badge de Status fora da área visível na lista de Pedidos |
| ADV-F3 | MEDIUM | "Preparar Expedição" habilitado sem nada reservado |
| ADV-F6 | MEDIUM | Filtro de tipo em Movimentações: tela oferece 9, API aceita 4 |
| ADV-F4 | LOW | Liberar/bloquear lote sem entrada própria no menu |
| ADV-F7 | LOW | Qualidade libera lote vencido |
| ADV-F8 | LOW | Plano de Atendimento aceita digitar reserva acima do disponível |
| ADV-F11 | LOW | Dois parsers decimais na API; mensagem de erro descreve outro defeito |

Detalhe, reprodução e medição de cada um: [archive/ADVERSARIAL_FINDINGS.md](archive/ADVERSARIAL_FINDINGS.md).

### ADV-F12 — a pergunta de recall respondida com uma negativa falsa

`apps/api/src/modules/lots/traceability.service.ts:90` busca as expedições do
lote filtrando por `customerOrderId` do Pedido **da Ordem de Produção**. Estoque
é fungível: um lote produzido para um pedido pode legitimamente atender outro.
Quando isso acontece, a seção "Destino comercial" da tela do lote afirma que ele
não foi expedido.

Medido no banco local:

```
OP: OP-000659 | pedido da OP: PED-000484
expedições que levaram ESTE lote: 1
    EXP-000235 CONFIRMED pedido PED-000485 qtd 400
visíveis na tela do lote (filtro atual): 0
```

Os dados estão certos — o movimento existe, o físico caiu de 800 para 400, o
vínculo `shipment_lines.lotId` está gravado. A **consulta** é que está errada.

Não é defeito de apresentação. "Por onde este lote saiu" é a pergunta que se faz
quando um lote precisa ser recolhido do mercado.

### ADV-F10 — documento de faturamento que não fecha na conferência

O preço unitário sai da API com duas casas (`billings.service.ts:50`,
`formatMoney = value.toFixed(2)`), enquanto o total da linha é calculado sobre o
valor cheio de quatro casas (`billings.service.ts:55`).

Medido em `GET /billings/<id>` de `FAT-000152`:

```
qtd 123 | acordado 4.05 | faturado 4.05 | total linha 498.53 | total documento 498.53
```

O preço acordado real é `4.0531`. `4,0531 × 123 = 498,53`. Mas quem confere o
documento faz `4,05 × 123 = 498,15`. **R$ 0,38** que não sai de nenhuma conta
possível com os números impressos.

A ordem de arredondamento está certa — somar e arredondar no fim é o correto. O
defeito é **exibir o preço com menos casas do que o cálculo usa**.

Não é escolha de projeto: a convenção do repositório é preço unitário com quatro
casas (`customer-orders.service.ts:188`, `pricing.service.ts:96`,
`product-cmv.service.ts:45`, `quotes.service.ts:89`) e total com duas. Só
`billings.service.ts:71-72` e `purchase-orders.service.ts:88` aplicam o
formatador de dinheiro a um preço unitário.

---

## Caminhos proibidos

Todos terminaram `BLOCKED_CORRECTLY`, cada um com foto do estado antes e depois.

**Estoque e recebimento.** Receber acima do saldo da ordem de compra. Duplo
clique no recebimento. F5 antes e depois de confirmar. Quantidade zero e
negativa em recebimento, ajuste e ordem de compra. Correção que deixaria saldo
negativo. Item inativo em operação nova. Lote vencido elegível para uso.

**Produção.** Separar, consumir e reservar a partir de lote bloqueado. Consumir
acima do reservado. Bloquear lote já reservado. Concluir ordem com material não
reconciliado.

**Expedição.** Expedir 61 com saldo 60. Reenviar a mesma confirmação de uma aba
velha — o item ficou com exatamente duas saídas, 40 e 60, nunca três. Lote de
outro produto e de outro cliente na conferência, o que cobre também o isolamento
por cliente. Lote bloqueado na conferência. Cancelar expedição confirmada.

**Faturamento.** Faturar duas vezes a mesma expedição. Editar documento emitido.
Faturar antes do gatilho. Faturar pedido cancelado. Faturar acima do elegível.

## Invariantes

Ledger reconstruído em 11 lotes: soma dos movimentos igual ao saldo em todos.
Nenhum saldo negativo. Nenhum reservado acima do físico.

Seis buscas por órfão, todas vazias: reserva ativa em pedido expedido ou
cancelado; expedição sem pedido; faturamento ativo sem expedição confirmada;
expedição com dois faturamentos; expedição confirmada sem saída física do mesmo
tamanho; consumo sem documento de origem.

Preço histórico: `PED-000491` fechado a `R$ 4,0531`; precificação vigente depois
trocada para `R$ 9,99` na mesma faixa; expedição e faturamento posteriores
continuaram em `4,0531`. Controle em `PED-000490`, faturado em duas partes:
`162,12 + 243,19 = 405,31` = 100 × 4,0531.

Rastreabilidade da `OP-000659`: todo consumo declarado tem movimento
`PRODUCTION_CONSUMPTION` do mesmo tamanho. O requisito de `MP-000327` era 4 kg e
o consumo real 4,5 kg — a árvore mostra 4,5, com o extra de 0,5 kg atribuído ao
lote de origem, com motivo e autor. Nada reconciliado no papel. O lote devolvido
por substituição no picking e o lote bloqueado não aparecem na árvore, e a tela
explica o vazio.

## O que não foi exercitado, e por quê

**Drift de somatório entre linhas** (`Σ round(linha)` contra `round(Σ linha)`).
Um faturamento tem uma linha por linha de expedição, que vem de uma linha de
reserva, e um orçamento aceita cada produto uma única vez. Com um lote livre do
produto no substrato, não há caminho de tela para montar duas linhas no mesmo
documento. **Em aberto — não refutado.**

**Expedir acima do estoque físico.** Não é alcançável pela interface por
construção: ajuste e perda limitam em `onHand − reserved`, e a contagem tem
`CountBelowReservedError`. As duas portas foram batidas e recusaram. Registrado
como caminho fechado, não como lacuna.

**Cancelar expedição depois do faturamento.** O domínio barra antes: expedição
confirmada não oferece cancelamento, com ou sem faturamento.

---

## Reproduzir

```bash
node scripts/validate-adversarial-stock.mjs
node scripts/validate-adversarial-production.mjs
node scripts/validate-adversarial-billing.mjs
node scripts/validate-adversarial-traceability.mjs
```

Estado por suíte em `handoff/adversarial-*-state.json`; fotos em
`handoff/screens/adversarial/`. Apagar o arquivo de estado força a suíte a
montar a massa do zero — o que cria registros novos.

---

# Fechamento

Product Ownership decidiu **corrigir antes de apresentar**, e não apresentar os
HIGH com ressalva. Os onze achados reproduzíveis foram fechados na branch
`fix/adversarial-core-findings`, cada um com correção, regressão e verificação
na massa que carrega a prova original.

## O que mudou de regra

**Preço unitário e total são dois números com precisões diferentes.** Preço
unitário: de 2 a 4 casas, conforme o preço. Total de linha e de documento:
sempre 2, e o total do documento é a **soma das linhas impressas**, não a soma
dos produtos cheios. O preço acordado no banco nunca é arredondado — `4,0531`
continua sendo `4,0531`, porque é o valor histórico do acordo.

**Rastreabilidade de lote é física.** A relação autoritativa para "por onde este
lote saiu" é `ShipmentLine.lotId`, nunca o pedido associado à OP que o produziu.
Um lote produzido para um pedido pode legitimamente atender outro, e isso não é
anomalia — é estoque fungível.

**Filtro de lista deriva da lista canônica do domínio.** Nunca uma cópia à mão
dentro do schema da rota.

## Verificação na evidência original

Rodada pela interface, nos mesmos registros que falharam
(`scripts/check-adversarial-fixes.mjs`):

| Achado | Antes | Depois |
|---|---|---|
| ADV-F10 | `R$ 4,05 × 123` num documento de `R$ 498,53` | `R$ 4,0531 × 123 = R$ 498,53` |
| ADV-F12 | "Este lote ainda não foi expedido" | `EXP-000235 → PED-000485 · 400 un` |
| ADV-F6 | 5 das 9 opções davam 400 | 9 de 9 aceitas |
| ADV-F1 | 2 das 6 opções davam 400 | 6 de 6 aceitas |
| ADV-F5 | `createdBy = "Ambiente local"` | usuário real; VIEWER recebe 403 |
| ADV-F7 | lote vencido ia para Disponível | recusado, estado intacto |
| ADV-F4 | sem entrada no menu | Qualidade › Liberação de lotes |
| ADV-F2 | 158px cortados, Status fora | 0px cortados, Status visível |

11 verificações, 11 ok, zero `console.error`.

## O achado que a interface não alcançava

O drift de somatório multilinha estava registrado acima como **em aberto, não
refutado** — não havia caminho de tela para montar duas linhas no mesmo
faturamento. O teste de serviço foi escrito mesmo assim, e **falhou**: as linhas
impressas somavam `R$ 1.927,41` e o rodapé dizia `R$ 1.927,42`.

Um centavo por linha, em todo documento de mais de uma linha, num lugar onde o
cliente confere conta. Corrigido junto.

Vale como método: *"não consegui reproduzir pela tela"* não é o mesmo que *"não
acontece"*.
