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

Sem módulo novo e sem mudança de domínio. A regra durável de cada uma vive em
[PRODUCT_RULES.md](PRODUCT_RULES.md); aqui fica só o que mudou de estado.

- **Cadastro de Cliente** (`cab5bf3`) — e-mail, CNPJ e telefone validados na
  tela e na API, validador compartilhado que Fornecedor herdou, endereço por
  CEP, autoria. §41.
- **Consulta do Cliente** (`7cd61f2`) — leitura em `/consultas/clientes/:id`
  reusando os endpoints já filtrados; o novo é o resumo e o escopo, que recusa
  com 404 entidade de outro Cliente. §42.
- **Produto + item de produto acabado** — o Produto cria o seu item na mesma
  transação; "Produto acabado" saiu da criação manual em Itens, e Cliente
  virou obrigatório. §43.
- **Prontidão para o cliente** (`cdcb235`) — Produtos e Estoque na Consulta,
  breadcrumb canônico. §44.
- **Ajuda contextual em todas as telas** (`344d00e`) — "Como funciona" abre
  modal: conceito › glossário da tela › fluxos numerados › ressalvas. 35
  tópicos, 98 dicas de campo, 37 telas. §45.
- **Tabelas** (`f6f93c0`) — não havia estouro global em nenhuma das 24 telas;
  havia rolagem local em 18 listagens, por `nowrap` sob `table-layout: auto`
  sem teto. Três classes de coluna e teto para a coluna de ações; Lotes caiu
  de 1356px para 537px, oito telas zeraram.

- **Telas oficiais de cadastro** (`feat/canonical-create-return`) — Cliente,
  Produto, Item, Fornecedor e Recurso ganharam página de criação em
  `/cadastros/<entidade>/novo`, com os campos num módulo só por entidade,
  usado pela página e pelo modal. O que a página traz: sobrevive a um F5, vale
  como link, entra no histórico. O preço é guardar o rascunho da origem em
  `sessionStorage`, por token de uso único na URL, com guarda contra retorno
  para fora do sistema. Cancelar e o Voltar do navegador também restauram. §46.
- **Produção na Consulta do Cliente** (`0657cd1`) — read model próprio: o DTO
  operacional custa **548 consultas por página de 25** montando a necessidade
  de material, que é a conta de liberar a ordem e não a pergunta da Consulta.
  A forma nova custa **quatro**, com teste que conta consultas pelo log do
  driver. 78 das 108 ordens locais não têm cliente, então a aba fica vazia
  para a maioria estando correta, e o estado vazio diz isso. §47.
- **Validação por interface + hardening** (`fix/release-hardening-e2e-ux`) —
  3 UI E2E executados com todo dado nascendo pela tela, e depois corrigidos e
  reexecutados: OP não conclui mais com material por reconciliar (§49), vírgula
  decimal em português, prefixo `RIN` para recurso industrial, sidebar com
  pista de rolagem, 125 mensagens de erro com `role`, ajuda própria em sete
  telas. Baseline UX 7,1; reauditoria 6,6–7,6 antes de desfazer três
  regressões da própria rodada. Ver
  [VALIDACAO_E2E_UI.md](VALIDACAO_E2E_UI.md).
- **Integridade de dado** (`fix/data-integrity-mediums`) — fecha os dois MEDIUM
  do guia passo a passo, ambos de falha silenciosa. Ativar formulação passou a
  gravar antes, com a gravação como condição: falhou, não ativa. E a busca de
  item foi para o servidor em seis telas — filtrar lista pré-carregada
  escondia 1.729 dos 2.729 itens ativos na Contagem Física, com "+ Novo"
  convidando a duplicar. §48.

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

Zero CRITICAL, HIGH e MEDIUM. Cinco LOW, nenhum bloqueante — flake do runner,
legado sem cliente, `select` nativo na entrada de material do cliente, rota
inválida sem página própria e Projeto sem rota de criação. Ver [BACKLOG.md](BACKLOG.md).

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
