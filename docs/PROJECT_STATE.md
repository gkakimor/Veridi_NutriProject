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

Promovidas pelo PO, sem módulo novo e sem mudança de domínio. A regra durável
de cada uma vive em [PRODUCT_RULES.md](PRODUCT_RULES.md); aqui fica só o que
mudou de estado.

- **Cadastro de Cliente** (`cab5bf3`, em produção) — e-mail, CNPJ (numérico e
  alfanumérico da IN RFB 2.229/2024) e telefone validados na tela e na API,
  com validador compartilhado que Fornecedor herdou; endereço por CEP via
  ViaCEP, falha nunca bloqueando; autoria do cadastro. §41.
- **Consulta do Cliente** (`7cd61f2`) — leitura em `/consultas/clientes/:id`,
  reusando os endpoints operacionais já filtrados; o novo é o resumo e o
  escopo, que recusa com 404 entidade de outro Cliente. Produção ficou de fora
  por exigir read model próprio. §42.
- **Produto + item de produto acabado** — o Produto cria o seu item na mesma
  transação, e "Produto acabado" saiu da criação manual em Itens. Cliente
  passou a ser obrigatório na criação. §43.
- **Prontidão para o cliente + navegação** (`cdcb235`) — Produtos e Estoque na
  Consulta, breadcrumb canônico nas telas principais. §44.
- **Ajuda contextual em todas as telas** (`344d00e`) — "Como funciona" abre
  modal, e a ordem é conceito › glossário da tela › fluxos numerados ›
  ressalvas. Product Ownership reprovou a primeira versão por explicar onde a
  tela ficava numa cadeia em vez do que ela é. 35 tópicos, 98 dicas de campo,
  37 telas. §45.
- **Tabelas** (`f6f93c0`) — a medição derrubou a suspeita: não havia estouro
  global em nenhuma das 24 telas em três viewports. Havia rolagem local em 18
  listagens, por `nowrap` sob `table-layout: auto` sem teto. Três classes de
  coluna e um teto para a coluna de ações; Lotes caiu de 1356px para 537px,
  oito telas zeraram.

**Telas oficiais de cadastro** (`feat/canonical-create-return`). Cliente,
Produto, Item de estoque e Fornecedor ganharam página própria de criação —
`/cadastros/<entidade>/novo`. Os campos vivem num módulo só por entidade,
usado pela página e pelo modal, então não há dois cadastros a divergir; o
botão de commit já usava `type="submit" form="…"`, que funciona igual nos
dois, e por isso o rodapé precisa de uma coisa só do formulário.

O que a página traz e o modal não tinha: **sobrevive a um F5**, vale como link
e entra no histórico. O preço é guardar o rascunho da origem enquanto a pessoa
está fora — `sessionStorage`, token de uso único na URL, validade de horas,
com guarda contra retorno para fora do sistema. Cancelar e o botão Voltar do
navegador também restauram. A trilha permanece canônica; a origem aparece como
ação secundária. Fecha os itens 9 e 10 do [BACKLOG.md](BACKLOG.md). Sem
migration. §46.


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
