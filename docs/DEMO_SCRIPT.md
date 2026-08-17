# Roteiro de demonstração — Veridi Nutrition (30–45 min)

> Objetivo: contar **uma história única** — um cliente pede um produto novo e a
> Veridi vai do briefing ao faturamento sem sair do sistema — e não passear por
> menus. Cada etapa abaixo tem: mensagem, dados necessários, CTA na tela,
> duração e o que fazer se o dado não existir.
>
> **DEMO READY = YES** (2026-08-17): 5 macrofluxos PASS, walkthrough PASS,
> zero CRITICAL e zero HIGH, verificado pelos auditores independentes.
>
> Base validada no gate pós-Bloco G e no sprint de hardening de UX. Total: **38 min** no ritmo
> normal; a coluna "corte" indica o que sai primeiro se o tempo apertar.

## Antes de começar (15 min de preparo, no dia anterior)

1. Subir API e web (`pnpm dev`) e confirmar `GET /health`.
2. Entrar com um usuário **ADMIN** e deixar a sessão aberta.
3. Preparar o cenário da história (ver "Dados necessários" de cada etapa). O
   caminho mais seguro é executar o roteiro inteiro uma vez na véspera com
   outro cliente/nome, para saber onde cada botão está.
4. Deixar abertas, em abas separadas: Dashboard, a lista de Projetos e o Hub de
   relatórios.
5. Conferir que existe **estoque liberado** das matérias-primas da formulação —
   sem isso a OP não libera e a demo trava na etapa 9.

> **Aviso honesto para a plateia:** o corpus legado (795 itens, 248 projetos,
> 214 produtos, 80 clientes) é dado real importado; a *história* da demo é
> criada na hora. Custo e preço históricos **não** foram migrados — a planilha
> antiga não preservou custo por produto —, então o cálculo mostrado é do motor
> atual, não uma reprodução do Excel.

---

## Etapa 1 — Dashboard: "o que precisa de mim hoje" · 3 min

- **Mensagem:** o sistema abre no trabalho pendente, não num painel de números.
- **Dados:** o dashboard já lê o banco real.
- **CTA:** partir de um grupo de atenção (ex.: lotes aguardando liberação) e
  mostrar que o link leva à lista já filtrada. Grupos curtos já abrem sozinhos;
  grupo grande começa recolhido — um clique expande, outro abre o destino.
- **Fallback:** se um grupo estiver vazio, use outro; não invente pendência.
- **Corte:** não.

## Etapa 2 — Projeto: o pedido do cliente vira documento · 3 min

- **Mensagem:** todo desenvolvimento começa como Projeto, com cliente, briefing
  e histórico de status auditável.
- **Dados:** um cliente ativo; criar o projeto ao vivo (nome, cliente, data de
  entrada, lote mínimo).
- **CTA:** "Novo projeto" na lista de Projetos.
- **Fallback:** se a criação falhar, abrir um dos 248 projetos legados — a tela
  é a mesma.
- **Corte:** não.

## Etapa 3 — Amostra: o laboratório testa antes de prometer · 4 min

- **Mensagem:** amostra é T1, T2, T3… com consumo de lote real; aprovar a
  amostra **não** aprova o projeto.
- **Dados:** um lote com saldo disponível da matéria-prima usada no teste.
- **CTA:** seção "Amostras / testes" na própria página do projeto → "Nova amostra" → registrar consumo →
  concluir → reprovar → criar T2 → aprovar.
- **Fallback:** se não houver lote com saldo, produza a amostra com
  "confirmar sem consumo" e diga em voz alta que o consumo é opcional, não
  automático.
- **Corte:** encurtar para T1 aprovada direto (2 min).

## Etapa 4 — Produto técnico e formulação · 4 min

- **Mensagem:** o produto nasce **em desenvolvimento**: já dá para custear e
  precificar, mas ele não entra em pedido nem em OP. Aprovar o projeto promove
  o **mesmo** produto — mesmo código, mesma formulação, mesmo histórico.
- **Dados:** unidade do produto acabado (un/kg); 2–3 matérias-primas e uma
  embalagem cadastradas.
- **CTA:** no projeto, "Preparar produto técnico" → abrir a formulação V1 →
  lançar componentes → ativar.
- **Prova cênica:** tentar incluir o produto em um pedido de cliente. A recusa é
  explícita: *"O produto PROD-… está em desenvolvimento e ainda não pode ser
  usado em operação comercial ou industrial."*
- **Fallback:** se a formulação der trabalho, use um produto legado já com
  formulação ativa e mostre só a promoção do lifecycle.
- **Corte:** não — é o coração do Bloco G.

## Etapa 5 — Custo industrial (EC → CALC) · 5 min

- **Mensagem:** o custo é montado por estrutura versionada (materiais, mão de
  obra, equipamento, energia, serviços, overhead) e **congelado** num cálculo
  com código próprio. O que não se sabe aparece como "—", nunca como zero.
- **Dados:** recursos industriais com tarifa vigente (um de mão de obra e um de
  energia bastam) e a estrutura de custos ativada.
- **CTA:** produto → "Estrutura de custos" → adicionar recurso/linha → ativar →
  "Calcular e salvar" (gera `CALC-000…`).
- **Prova cênica:** apagar a tarifa de um recurso e mostrar que o cálculo passa
  a acusar pendência em vez de assumir zero.
- **Fallback:** se a ativação reclamar de incompletude, ative confirmando —
  e mostre que o cálculo registra a qualidade "parcial".
- **Corte:** pular a prova cênica (−1,5 min).

## Etapa 6 — Precificação por faixa (PREC) · 4 min

- **Mensagem:** preço não é custo × fator no Excel: cada faixa de quantidade é
  um cenário fechado (lote, custos fixos, caixas) e a margem é **de
  contribuição**, nunca "lucro".
- **Dados:** o CALC da etapa anterior.
- **CTA:** produto → "Precificação" → nova versão a partir do cálculo → criar
  faixas (ex.: 500 e 1000 un, margem-alvo 35 %, comissão 5 %) → ativar.
- **Prova cênica:** a faixa de 1000 un sai mais barata que a de 500 un porque o
  custo fixo se dilui — mostre os dois custos/unidade lado a lado.
- **Fallback:** se a margem-alvo der preço estranho, use "preço manual" na faixa
  e mostre que o sistema calcula a margem resultante.
- **Corte:** demonstrar só uma faixa (−1,5 min).

## Etapa 7 — Orçamento com proveniência e envio · 4 min

- **Mensagem:** a proposta puxa o preço de uma faixa **ativa** e guarda a
  origem: PREC, faixa, CALC, estrutura, custo, margem. O documento do cliente
  não mostra nada disso.
- **Dados:** precificação ativa + orçamento na quantidade **exata** da faixa.
- **CTA:** projeto → "Novo orçamento" → informar quantidade → "Usar faixa de
  precificação" → enviar.
- **Provas cênicas (as duas melhores da demo):**
  1. pedir a faixa de 500 un para um orçamento de 700 un → recusa explicando que
     faixa é cenário fechado (sem interpolação, sem "faixa mais próxima");
  2. tentar digitar outro preço com a faixa vinculada → *"Quantidade, unidade e
     preço vêm da faixa de precificação."*
- **Depois:** abrir a impressão do orçamento e mostrar que **não** há custo,
  margem, comissão, CALC ou PREC no documento do cliente.
- **Corte:** não.

## Etapa 8 — Aceite e aprovação do projeto · 2 min

- **Mensagem:** aceito o orçamento, aprovar o projeto promove o mesmo produto a
  operacional. Nada é recriado.
- **CTA:** orçamento → "Aceitar" → projeto → "Aprovar".
- **Prova cênica:** o código do produto continua o mesmo; o badge muda de
  "Em desenvolvimento" para operacional.
- **Corte:** não.

## Etapa 9 — Pedido → OP → picking → produção · 6 min

- **Mensagem:** do pedido comercial sai o plano de atendimento (reservar o que
  há, produzir o que falta) e a OP nasce ligada ao pedido.
- **Dados:** estoque liberado das matérias-primas; produto aprovado.
- **CTA:** Pedidos → novo pedido → confirmar → "Plano de atendimento" →
  produzir → abrir a OP → liberar → picking (confirmar lote) → consumo →
  apontar produção → concluir.
- **Provas cênicas:**
  - reserva e consumo são coisas diferentes: a reserva não tira estoque físico;
  - o lote de produto acabado nasce **aguardando liberação da Qualidade**;
  - material de propriedade do cliente só pode ser usado na OP daquele cliente
    (*"Lote … pertence a outro proprietário"*).
- **Fallback:** sem estoque suficiente, mostre a tela de necessidade/falta
  (R-04) e a sugestão de compra — a história continua em Compras.
- **Corte:** pular o picking item a item, confirmando todos de uma vez (−2 min).

## Etapa 10 — Qualidade: laudo antes de liberar · 3 min

- **Mensagem:** CoA aprovado e liberação de qualidade são decisões distintas, e
  nenhuma delas é automática.
- **Dados:** um lote recebido de item que exige laudo.
- **CTA:** Qualidade → fila de documentos → anexar CoA → aprovar → liberar lote.
- **Provas cênicas:** liberar antes do laudo é recusado (*"CoA deste lote ainda
  não foi aprovado"*), e aprovar laudo sem documento anexado também
  (*"Anexe o CoA antes de aprovar"*).
- **Corte:** não — é a etapa que mais convence a Qualidade.

## Etapa 11 — Expedição e faturamento · 4 min

- **Mensagem:** expedir confere lote a lote e é irreversível; o faturamento só
  enxerga o que saiu de fato e o registro **não é documento fiscal**.
- **CTA:** pedido → "Nova expedição" → conferir linhas → confirmar (expedição
  parcial deixa o pedido "parcialmente expedido") → Faturamento → gerar a partir
  da expedição → informar preço → emitir.
- **Fallback:** se a conferência travar por lote, mostre a mensagem de
  divergência — ela é parte do argumento.
- **Corte:** faturar sem detalhar preço linha a linha (−1 min).

## Etapa 12 — Rastreabilidade e relatórios · 4 min

- **Mensagem:** de um lote de produto acabado chega-se aos lotes de matéria-prima
  e à OP; e há 20 relatórios prontos, todos imprimíveis.
- **CTA:** ache o lote de produto acabado buscando o **número comercial da
  etiqueta** (busca do topo ou Estoque → Lotes) → "Rastreabilidade" → mostrar a
  árvore → imprimir;
  depois Hub de relatórios → R-04 (necessidade), R-18 (custo industrial),
  R-19 (precificação), R-20 (orçamento × precificação, documento interno).
- **Prova cênica:** imprima o R-20. Ele cabe na folha em paisagem com a
  proveniência (PREC, faixa, CALC, qualidade do custo) numa linha de detalhe
  abaixo de cada proposta — e vem marcado como documento interno.
- **Prova cênica:** R-20 é restrito — Produção/Qualidade recebem 403.
- **Corte:** mostrar só R-20 e a rastreabilidade (−2 min).

## Encerramento — 2 min

Três frases, nesta ordem:

1. **Tudo que o sistema não sabe, ele diz que não sabe.** Não existe custo
   parcial disfarçado de total, nem pureza assumida como 100 %, nem tarifa
   inventada.
2. **História única, documentos ligados.** Projeto → orçamento → pedido → OP →
   lote → expedição → faturamento: cada documento aponta para a origem.
3. **O que falta está mapeado, não escondido:** regulatório/rotulagem (Bloco H)
   depende de validação de domínio com a Veridi — as perguntas estão em
   `docs/BLOCK_H_VALIDATION.md`.

---

## Riscos conhecidos da demo

| Risco | Sinal | O que fazer na hora |
|---|---|---|
| Sem estoque liberado, a OP não libera | erro ao liberar a OP | ir para R-04 (necessidade/falta) e seguir para Compras |
| Faixa e orçamento com quantidades diferentes | recusa `quantity_mismatch` | é prova cênica, não erro — explique e ajuste a quantidade |
| Produto ainda em desenvolvimento no pedido | recusa `product_not_operational` | idem: mostre o texto e aprove o projeto |
| Tela de Usuários poluída por contas de teste (`teste-…`) | lista com centenas de linhas | não abra a tela de Usuários na demo |
| Corpus sem custo/preço histórico | R-18/R-19 vazios para produtos legados | use o produto criado na demo, que tem CALC e PREC |
| Falta de material de propriedade do cliente | depende de haver o caso no cenário | com o cenário preparado a OP mostra "Fornecimento: Cliente" e nenhuma sugestão de compra — mostre ao vivo |
| Tela da OP não mostra quem criou/planejou a ordem | pergunta de auditoria | o histórico existe no Projeto; na OP está em backlog |
