# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

---

## Onde estamos

**Release congelada:** `9a653a0`
**Ambiente:** Railway, deploy `8949e780`, health 200.

O MVP operacional está **validado internamente**. Deliveries 01 a 40+
concluídas: Blocos A a G fechados — cadastros, compras, recebimento e lotes,
estoque e FEFO, formulações versionadas, produção com consumo real e
rastreabilidade, pedido do cliente com plano de atendimento, expedição,
faturamento, fundação de custos, cockpit e relatórios, cadastros e formulação
industrial, material do cliente, GMP, qualidade documental, projetos e
orçamentos versionados, recursos e custo industrial, precificação e margem.

Detalhe por delivery: [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md).

## MVP validado?

Sim, internamente. Três casos profundos derivados de dados legados rodaram
ponta a ponta contra a interface publicada, cada um pressionando uma parte
diferente do domínio:

- **VAL-LEG-01 — PASS.** `PED-000001` do pedido ao faturamento.
- **VAL-LEG-02 — PASS.** Falta, compra complementar de fornecedor alternativo,
  recebimento parcial, FEFO entre três lotes, reserva multi-lote, consumo extra
  com motivo, produção parcial (147 de 150), saldo, segunda OP e faturamento
  herdando o preço acordado.
- **VAL-LEG-03 — PASS.** Material fornecido pelo cliente ponta a ponta:
  propriedade e segregação, recebimento sem OC da Veridi, templates de
  formulação e de custo, cálculo excluindo aquisição do cliente, política de
  preço, parcelamento com juros, produção, rastreabilidade e faturamento.

O hardening pré-cliente e o polimento visual que se seguiram não criaram
capacidade de negócio: fecharam o backlog funcional e de UX dos três casos, com
cobertura de regressão. Findings e correções em
[archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md); as regras que eles
viraram, em [PRODUCT_RULES.md](PRODUCT_RULES.md) §38 e §40.

## Próximo gate

**Validação com a Veridi.** Nenhum desenvolvimento novo até essa conversa
acontecer e o feedback ser classificado — o que a operação real apontar vale
mais do que qualquer item priorizado sozinho daqui.

Material preparado:

- `Guia_Fluxo_Comercial_Veridi.docx` — guia do usuário final em 36 capítulos,
  em português, sem termos de implementação. Não versionado no repositório,
  conforme a política atual.
- [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) — roteiro da
  reunião em quinze blocos, com perguntas abertas por etapa e a grade de
  classificação do feedback.

## Rodadas curtas sobre a release congelada

Promovidas pelo PO, sem módulo novo e sem mudança de domínio.

**Cadastro de Cliente** (`cab5bf3`, em produção). E-mail, CNPJ (numérico e a
forma alfanumérica da IN RFB nº 2.229/2024) e telefone com DDD validados na
tela e na API; validador compartilhado, então **Fornecedor herdou a regra de
CNPJ**. Endereço preenchido pelo CEP via ViaCEP, com falha nunca bloqueando o
cadastro. Autoria do cadastro reusando `createdByUserId`/`NameSnapshot`,
migration aditiva e nullable. Histórico detalhado por campo **não** foi
implementado: exigiria infraestrutura genérica de auditoria, que é capacidade
transversal. Regras em [PRODUCT_RULES.md](PRODUCT_RULES.md) §41.

**Consulta do Cliente** (`feat/customer-consultation`). Capacidade de leitura
em `/consultas/clientes/:customerId` (Gestão › Consulta de Cliente): shell
persistente com Resumo, Projetos, Pedidos, Materiais do cliente e
Faturamentos, e detalhe consultivo de Projeto, Pedido e Faturamento sem sair
do Cliente. Sem migration — lista reusa os endpoints operacionais já
filtrados por `customerId`; o que é novo é o resumo e o **escopo**, que
recusa com 404 entidade de outro Cliente. Produção/OP ficou de fora:
`GET /production-orders` não filtra por cliente e seu DTO faz três consultas
extras por linha, então a aba exigiria read model próprio. Regra durável em
[PRODUCT_RULES.md](PRODUCT_RULES.md) §42.

**Produto + item de produto acabado** (`feat/product-finished-item-simplification`).
O usuário cadastrava o item de produto acabado em Itens e depois o
selecionava no Produto — dois cadastros para uma coisa só. Agora o Produto
cria o seu item na mesma transação, e "Produto acabado" saiu da criação
manual em Itens, que virou **Itens de estoque**. Cliente passou a ser
obrigatório na criação do Produto, com busca por código, razão social,
fantasia e CNPJ e cadastro de cliente no contexto. Produto em uso não muda
de Cliente. Sem migration: `finishedProductItemId` já era `@unique`. Regras
em [PRODUCT_RULES.md](PRODUCT_RULES.md) §43.

**Prontidão para o cliente + navegação** (`feat/client-readiness-navigation`).
A Consulta do Cliente ganhou **Produtos** e **Estoque** — este com duas
visões separadas, produto acabado da Veridi e material do próprio Cliente.
Breadcrumb canônico chegou às telas principais; dentro da Consulta a trilha
contextual do Cliente permanece. O kit de ajuda contextual (InfoHint,
ContextHelp, FlowSteps) foi integrado em Formulação, Plano de Atendimento,
Ordem de Produção, CMV e Faturamento. Sem migration. Regras em
[PRODUCT_RULES.md](PRODUCT_RULES.md) §44.

Na mesma rodada, **Fornecedor passou a usar os validadores compartilhados de
e-mail e telefone** — antes texto livre. Nenhum dos 219 fornecedores tem esses
campos preenchidos, então nenhum registro existente deixou de ser editável.

**Ajuda contextual em todas as telas** (`fix/final-ux-readiness`). A ajuda da
rodada anterior cobria cinco telas, ficava embutida na página e explicava
onde a tela estava numa cadeia maior. Product Ownership reprovou o foco: a
ajuda tem de dizer **o que a própria tela é**. Agora "Como funciona" abre um
**modal** e a ordem é conceito › glossário da tela › fluxos numerados ›
ressalvas; as caixas do fluxo são clicáveis e destacam a explicação de mesmo
número. 35 tópicos e 98 dicas de campo cobrem os módulos comercial, produção,
compras, estoque, cadastros, qualidade, gestão e administração. Sem migration.

No mesmo passo, três correções no produto acabado: "Classificação industrial"
(fonte, nutriente, pureza) some no item `FINISHED_PRODUCT`, porque descreve um
item enquanto **componente** de receita e acabado nunca é componente; a tela
do Produto passou a mostrar os controles de estoque do item como fato; e
`Exige CoA / Laudo` virou campo da criação do Produto — o único dos quatro
controles que varia por produto. Regras em
[PRODUCT_RULES.md](PRODUCT_RULES.md) §45.

**Tabelas e criação no contexto** (`feat/contextual-create-and-table-ux`).
Duas frentes numa rodada. Nas tabelas, a medição derrubou a suspeita inicial:
**não havia estouro global em nenhuma das 24 telas em três viewports** — o que
havia era rolagem local em 18 listagens e coluna de ações desproporcional em
6. A causa era única: toda célula é `nowrap` sob `table-layout: auto`, então
duas colunas de texto livre definiam sozinhas a largura mínima da tabela, e a
sobra em telas largas engordava até a coluna de ações. Três classes de coluna
(`col-tight`, `col-flex`, `col-flex--truncate`) e um teto para a coluna de
ações. Lotes caiu de 1356px de rolagem para 537px, Amostras de 1220 para 424,
Projetos de 1044 para 493; oito telas zeraram. A coluna de ações parou de
crescer com o viewport.

Na criação, "+ Novo X" passou a encabeçar todo campo de busca de entidade
criável — 8 campos novos, além dos 4 que já tinham. A trava contra duplicata
mudou de lugar em vez de sumir: o item ativo continua sendo o primeiro
resultado, então Enter escolhe e nunca cria. **Continua sendo modal**, porque
nenhuma das cinco entidades tem tela de criação e o modal já é o formulário
oficial — decisão registrada em [BACKLOG.md](BACKLOG.md) item 9. Sem
migration. Regras em [PRODUCT_RULES.md](PRODUCT_RULES.md) §46.

Três defeitos fechados de passagem: Escape fechava os dois modais empilhados,
o menu `⋯` era recortado pelo `overflow` da tabela, e a ajuda contextual se
anunciava como `alertdialog`.

## Validação em produção

**Smoke autenticado feito** (`344d00e`, 2026-09-02), e automatizado em
[`scripts/smoke-prod.mjs`](../scripts/smoke-prod.mjs). Sessão real, oito telas
abertas, onze endpoints de listagem, console e rede limpos. A perna de escrita
(`--escrita`) criou um cliente, provou as validações de e-mail, telefone, CNPJ
e CEP, conferiu a autoria gravada a partir do usuário autenticado e inativou
pelo fluxo oficial. Tudo passou.

Era o que faltava desde a rodada do cadastro de Cliente. Rodar antes de fechar
cada rodada passa a ser o padrão.

## Blockers

Nenhum.

## Backlog aberto

Dois LOW: a instabilidade da suíte rodando api e web juntos, e o dado legado
sem cliente. Nenhum bloqueia. As duas passadas de nomenclatura, a ordem real
de delete, a bolha do `InfoHint` e o smoke autenticado foram fechados na
rodada de ajuda contextual. Ver [BACKLOG.md](BACKLOG.md).

## Decisões de produto ainda em aberto (não bloqueantes)

Listadas em [BACKLOG.md](BACKLOG.md) para terem fonte única.

---

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, release, próximo gate | este arquivo |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Valor futuro mapeado | [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Regras duráveis de UI e marca | [UI_BRAND.md](UI_BRAND.md) |
| Escopo e plano do MVP | [MVP_PLAN.md](MVP_PLAN.md) |
| Política de migração do legado | [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Stack e ambiente | [TECH_BASELINE.md](TECH_BASELINE.md) |
| Implantação | [DEPLOY.md](DEPLOY.md) |
| Roteiro da validação com o cliente | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) |
| Histórico de deliveries | [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) |
| Histórico de findings de auditoria | [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

---

## Manutenção deste arquivo

Manter curto. Reescrever/condensar após mudanças relevantes. Não transformar em
log cronológico — o log vive no arquivo de histórico.
