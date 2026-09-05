# Roadmap pós-MVP — valor futuro mapeado

> **Este documento contém valor futuro mapeado. Não ler/implementar
> automaticamente. Consultar apenas quando Product Ownership estiver
> discutindo novas capacidades.**

Nada aqui é escopo. Um item só sai desta lista quando Product Ownership o
promove explicitamente para o MVP.

Pendências reais: [BACKLOG.md](BACKLOG.md).
Regras duráveis: [PRODUCT_RULES.md](PRODUCT_RULES.md).
Escopo do MVP: [MVP_PLAN.md](MVP_PLAN.md).

---

## Estoque e compras

**Ponto de reposição / estoque mínimo** — estoque mínimo, ponto de reposição,
alertas de baixo estoque. Alto valor: as planilhas atuais da Veridi já
raciocinam sobre falta e necessidade de compra. Gatilho diferente da Sugestão
de Compra já entregue (capacidade 26): aquela é puxada pelo déficit de um
Pedido do Cliente; esta é puxada pelo nível de estoque, independente de pedido.
Ambas alimentam OC em rascunho, nunca uma OC confirmada.

**MRP básico** — produção planejada, estoque disponível, estoque reservado, em
compra e lead time para sugerir necessidade de compra. A capacidade 26 é o
subconjunto disparado por pedido. MRP completo não entra no MVP inicial.

**Alertas de validade** — dias-para-vencer configuráveis, lista de vencimentos
próximos, notificação proativa depois.

**Código de barras do fornecedor no recebimento** — usar o código externo para
identificar item, localizar a OC e reduzir digitação. O QR interno continua
sendo a identidade operacional do lote na Veridi.

**RFQ / cotação de fornecedor** — solicitar cotações, comparar fornecedores,
aprovar.

**Aprovações de compra** — limites de alçada, fluxo multinível.

**Performance de fornecedor** — lead time, atrasos, ocorrências de qualidade,
histórico de preço.

**Landed cost** — rateio de frete, impostos e demais custos de aquisição.

---

## Relatórios analíticos

Tendências de estoque, lead time de compra, rendimento de produção, perdas por
validade, consumo por produto, performance de fornecedor.

Não construir dashboards antes dos dados serem confiáveis.

A camada gerencial básica já foi promovida e entregue como **Bloco E**
(capacidades 30–32): cockpit operacional, relatórios e exportações CSV/PDF.
Bloco E é cockpit, não BI — o que está listado acima é a parte analítica que
permanece futura.

---

## Qualidade e compliance

**Módulo de Qualidade completo** — inspeção de recebimento, especificações
parametrizadas, análises microbiológicas, regras de aprovação/rejeição,
não conformidade, reinspeção, quarentena, fluxo de liberação.

**CoA avançado** — cliente, NF, lote, validade, análises, status
aprovado/rejeitado, PDF com marca. O laudo por lote com estado próprio já
existe (capacidade 37); o que falta é a emissão formatada.

**Recall / não conformidade** — a rastreabilidade bidirecional já é MVP. O
fluxo formal de recall permanece futuro.

**Extração documental automática** — parsing de PDF, importação de XML,
extração de laudo de fornecedor, extração de XML de NF, normalização.

---

## Armazém / WMS

**Endereçamento avançado** — armazém, zonas, posições, putaway dirigido,
histórico de localização. O MVP precisa apenas de localização simples.

**Múltiplos armazéns** — adicionar só quando a operação exigir.

**Wave picking / otimização de rota** — item de escala.

**Contagem cíclica agendada** — o MVP tem inventário manual; o agendamento
avançado permanece futuro.

**Coletores industriais** — o MVP usa câmera de celular/tablet primeiro.
Hardware dedicado pode vir depois.

**GS1** — códigos GS1, GTIN, lote/validade em padrão codificado. Não
necessário para o MVP.

---

## Produção

**MRP avançado** — planejamento de produção, de compras e de capacidade.

**Centros de trabalho / máquinas** — equipamento, capacidade, programação.

**Controle de processo / encapsulação** — equipamento, lote, OP, quantidade
produzida, paradas operacionais, período, parâmetros de processo.

**Integração com máquinas** — leitura de contadores/microcomputadores onde for
viável.

**BOM multinível** — só se produtos/submontagens exigirem.

**Materiais substitutos** — regras formais de equivalência.

**Tolerâncias de perda/rendimento** — códigos de motivo, rendimento alvo,
limiares de alerta.

**Retrabalho / reprocesso** — fluxos formais.

**Unidade logística / volume / handling unit** — uma embalagem física
(caixa/palete) com identidade própria, contendo quantidade conhecida de um
único lote (`VOL-000001 → LT-PA-001 → 500 un`). Permitiria escanear uma caixa e
já obter a quantidade, em vez de escanear o lote e digitar. **Deixado fora do
MVP de propósito**: hoje o QR do lote responde só "qual lote?", e a quantidade
segue sendo decisão explícita e separada na linha de expedição. Unidades nunca
são serializadas — 400 unidades de um lote são uma leitura, não 400.

---

## Comercial / CRM

**CRM WhatsApp** — consolidação de conversas, histórico do cliente, contexto
comercial, apoio de IA depois.

**Portal do cliente** — não recomendado enquanto o modelo de venda consultiva
não provar a necessidade.

**Produto próprio Veridi** — hoje todo Produto pertence a um Cliente
(`Product.customerId` obrigatório), e isso permanece no escopo atual. Escopo
futuro, decidido pelo PO em 2026-09-04: Product sem cliente obrigatório,
produto acabado próprio da Veridi, estoque próprio de PA e venda do mesmo PA
a mais de um cliente. Matéria-prima e embalagem já são itens globais e os
lotes já suportam `VERIDI` e `CUSTOMER(customerId)`; a peça que falta é do
lado do Produto e atravessa pedido, precificação, CMV e isolamento por
cliente ao mesmo tempo.

Orçamentos e Pedidos saíram deste roadmap: foram entregues no **Bloco D**
(capacidades 26–28) e no **Bloco F/G** (capacidades 38, 46, 47).

---

## Fiscal / financeiro

**Nota fiscal** — integrar com provedor fiscal brasileiro. Distinto do
Faturamento comercial já entregue (capacidade 28), que reflete a quantidade
efetivamente entregue. Relacionados, mas não devem ser fundidos
prematuramente.

**Custeio / CMV — o que ainda falta.** A fundação de custo de material já foi
entregue (capacidade 29): custo efetivo de aquisição no recebimento, referência
de média ponderada com fallback 30d/90d/último real, estimativa de custo da
formulação e custo real a partir dos lotes consumidos, com qualidade explícita
`REAL`/`ESTIMATED`/`PARTIAL`/`NO_COST`. Mão de obra e energia entraram no
Bloco G (capacidade 45).

Permanece futuro: depreciação, overhead, custo padrão, valoração contábil
FIFO/LIFO, fechamento mensal, margem bruta/líquida, rateio de frete no landed
cost e tabela de preços de fornecedor. O schema nomeia o conceito como *custo
efetivo de aquisição* justamente para que frete e despesas diretamente
atribuíveis possam ser incorporados depois.

**Contas a pagar / financeiro** — fora do MVP operacional e explicitamente
distinto da fundação de custo: custo responde *quanto o material custou*, nunca
*quando e quanto dinheiro saiu do caixa*. Contas a pagar, vencimentos,
parcelas, fluxo de caixa, juros e pagamentos permanecem futuros, e nunca devem
ser inferidos de custo ou de preço de OC.

**Contas a receber** — mesma fronteira, do outro lado. O sistema calcula e
congela a condição de pagamento no pedido; não controla recebimento.

---

## RH

Só expandir além de identidade de usuário/acesso se houver valor de negócio
claro.

---

## Templates parametrizados / configurador técnico

Templates de formulação são hoje uma **cópia estruturada versionada**: escolhe
a matriz, ela é copiada para a formulação do próprio produto. Ficou de fora, de
propósito:

- placeholders e variáveis (apresentações de 30/60/90 dias a partir de uma
  matriz);
- fórmulas configuráveis e campos dinâmicos;
- sub-templates e herança entre matrizes;
- um configurador de produto sobre tudo isso.

Razão para esperar: parametrização multiplica as formas de expressar uma
receita, e cada uma delas precisa sobreviver a custeio, precificação e ordem de
produção. Quais parâmetros são realmente necessários deve vir de observar
pessoas reutilizando templates, não de antecipação. O que for construído
precisa manter a regra §35 intacta — a formulação do produto continua sendo
cópia independente, e nenhuma mudança de parâmetro alcança formulação que já
existe.

---

## Product Blueprint (formulação + estrutura de custo + política de preço)

Três bibliotecas existem e cada uma se sustenta sozinha: template de formulação,
template de estrutura de custos (TEC) e política de precificação (TPP). O
pedido óbvio seguinte é um pacote que aplique as três a um produto novo em um
passo — "cápsula 60 comprimidos private label" como escolha única.

Deliberadamente não construído agora:

- **As três não falham juntas.** Formulação aplica sem pré-condição; estrutura
  de custo exige formulação ativa e recusa com rascunho aberto; política exige
  *cálculo salvo*, que não pode existir antes da estrutura ser ativada e
  calculada. Um pacote de um clique teria de definir o que acontece quando o
  terceiro passo não roda — e qualquer resposta inventada antes do uso real
  será a errada.
- **Empacotar esconde qual camada está velha.** Hoje a proveniência nomeia uma
  origem por artefato, então "a política tem versão nova" é afirmação precisa.
  Uma versão de blueprint envolvendo três matrizes anunciaria atualizações cuja
  causa não é visível sem abrir cada uma.
- **O padrão de reúso é desconhecido.** Se as casas reutilizam as três juntas
  ou misturam a estrutura de custo de uma com a precificação de outra deve vir
  de observar as bibliotecas em uso.

O que for construído precisa manter as regras §35 e §36 intactas: cada
aplicação continua sendo cópia independente, nenhuma tarifa entra em template
de custo, nenhum preço entra em política, e nada propaga de volta para artefato
que já existe.
