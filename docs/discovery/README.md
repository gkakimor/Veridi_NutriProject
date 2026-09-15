# Discoveries do produto

Índice oficial dos discoveries do Veridi. Um discovery responde uma pergunta de
produto **antes** da implementação: o que existe, o que falta, o que é arriscado,
o que o PO precisa decidir e qual é a próxima capability. Discovery não
implementa — não cria endpoint, DTO, componente, migration nem schema.

O produto está em **fase de produto final / evolução**: o MVP foi entregue e
aprovado. Discovery novo não chama evolução de "MVP".

## Antes de abrir um discovery

1. Ler este índice.
2. Procurar discovery do mesmo tema (tabela abaixo e seção G do
   [`BACKLOG.md`](../BACKLOG.md)).
3. Reutilizar as decisões vigentes; não refazer discovery sem motivo declarado.
4. Ao terminar, atualizar a linha do discovery neste índice.

## Regras

**Um documento por discovery relevante**, nesta pasta, com o nome do capability
ID: `FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md`,
`INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md`. Sem data no nome quando o ID já é
único.

**Status permitidos:**

| Status | Significa |
|---|---|
| `EM_ANALISE` | há decisão de PO pendente ou pergunta estrutural aberta |
| `DECIDIDO` | decisões tomadas; implementação não começou ou está parcial |
| `IMPLEMENTADO` | a capability que o discovery pediu foi entregue |
| `ARQUIVADO` | a pergunta perdeu o sentido ou foi absorvida por outra |

**Histórico não se apaga.** Discovery implementado continua no índice, marcado
`IMPLEMENTADO`, com a capability, o commit de merge e a data. Decisão que muda
não é reescrita em silêncio: o documento ganha uma entrada em "Histórico de
decisões" com a data, a decisão anterior, a nova e o motivo.

**Worktree é temporário.** Discovery documental termina como arquivo nesta pasta,
integrado à `main`. Não manter cópia do projeto (`wt-*`) como armazenamento do
discovery; depois da integração, o worktree e a branch documental saem.

**Discoveries anteriores a esta pasta ficam onde estão.** Movê-los quebraria os
links de `PROJECT_STATE.md`, `BACKLOG.md` e `PRODUCT_RULES.md`. O índice aponta
para eles.

## Estrutura padrão

Todo discovery novo segue estas seções, nesta ordem:

1. **Status**
2. **Objetivo**
3. **PO baseline** — o que o PO já pediu ou decidiu explicitamente
4. **Estado atual** — o que existe no produto e no código
5. **Evidências** — arquivos, models, endpoints e regras, com caminho
6. **Findings**
7. **Gaps**
8. **Riscos**
9. **Alternativas consideradas**
10. **Recomendação**
11. **Decisões PO** — poucas, cada uma com recomendação, alternativa e impacto
12. **Pendências PO**
13. **Escopo recomendado**
14. **Fora do escopo**
15. **Próxima capability**
16. **Implementação** — começa como `NÃO IMPLEMENTADO`
17. **Histórico de decisões** — só acrescenta

Discovery que toca regra de negócio aplica o `/erp-functional-reviewer`
(`.claude/skills/erp-functional-reviewer/SKILL.md`): cada regra marcada como
EXISTE HOJE, PROPOSTO ou FUTURO, cenários adversariais com
YES / PARTIAL / NO e `READY_TO_IMPLEMENT` justificado.

## Índice

| ID | Tema | Status | Data | Principais decisões | Pendências PO | Implementação |
|---|---|---|---|---|---|---|
| [FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md) | Painel Gerencial: o que o ERP mostra de dinheiro com confiança | `IMPLEMENTADO` | 2026-09-15 | D1–D5 decididas com as recomendações: "Faturado" = `Billing.totalAmount`; "Valores incompletos" sem subtotal; "Painel Gerencial" em Gestão, tela própria; ADMIN e COMMERCIAL com a recusa na API; A expedir e A faturar pelo preço acordado antes do desconto. Sem contas a pagar, contas a receber, caixa, margem ou imposto | Sem posição: encerramento de saldo de OC parcialmente recebida (G5) e preço acordado em Pedido direto (G2) | BILLED-VALUE-CANONICAL-01 e MANAGEMENT-DASHBOARD-V1-01, entregues em 2026-09-15 |
| [E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01](E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01.md) | Massa operacional própria para as E2E do grupo C e a OP fora da 1ª página | `EM_ANALISE` | 2026-09-15 | Recomendado: `produzirPa` por API (subwave 4A) antes das suítes; 4E (desconto → faturamento) por último | P2–P8. P1 e a espera da 4E pela WAVE 3 resolvidas por estado posterior (WAVE 3 em `6256ca9`), registrado na fila viva do [`BACKLOG.md`](../BACKLOG.md) | NÃO IMPLEMENTADO. Próxima: decisão PO de P2–P8, depois E2E-BASELINE-REDESIGN-WAVE-04 (4A pode começar) |
| [WAVE-05-GOLDEN-PATH-DISCOVERY-01](WAVE-05-GOLDEN-PATH-DISCOVERY-01.md) | Golden path private label na fundação E2E nova | `EM_ANALISE` | 2026-09-15 | Recomendado: opção B do runner (`--run`/`--desde`, `--clone`), checkpoint como mapa de entidades, `billingStatus === "BILLED"` | Q3 bloqueia; Q1, Q2, Q4, Q6–Q10. Q5 e B1 resolvidos por estado posterior (WAVE 3 em `6256ca9`; WAVE 5 depois da WAVE 4), registrado no [`BACKLOG.md`](../BACKLOG.md) | NÃO IMPLEMENTADO. Próxima: fechar Q3, depois E2E-BASELINE-REDESIGN-WAVE-05, depois da WAVE 4 |
| [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md) | Permissões de execução da Ordem de Produção | `EM_ANALISE` | 2026-09-15 | Recomendado: execução da OP só ADMIN + PRODUCTION; cancelamento com ator real (não `SYSTEM_ACTOR`); `ForbiddenError` mapeado para 403 | P1 e P6 bloqueiam; P2–P5, P7, P8 com recomendação | NÃO IMPLEMENTADO. Próxima: fechar P1/P6, depois PRODUCTION-PERMISSION-HARDENING-01 |
| [INVENTORY-PHYSICAL-COUNT-DISCOVERY-01](INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md) | Inventário Físico em sessões de inventário em lote (baseline INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, [BACKLOG §G](../BACKLOG.md)) | `DECIDIDO` | 2026-09-15 | Decidido pelo PO: sessão `StockCount` (`INV-`) em contagem → revisão → encerrado/cancelado; saldo de referência por posição + saldo esperado congelado em cada registro, ajuste = diferença congelada aplicada como delta no encerramento, sem bloquear movimentações (F); uma posição em uma sessão aberta; recontagem opcional; sem tolerância; Contagem rápida grava `INV-` QUICK; CSV controlado na Fatia 3 | Nenhuma bloqueante; P7 (regularização de material sem lote) é futuro | Parcial: Fatia 1 (domínio e API) entregue em 2026-09-15 por INVENTORY-PHYSICAL-COUNT-01. Próxima: Fatia 2 (telas), depois Fatia 3 (FO-01 de sessão e CSV) |
| [COST-VAR-01](../archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) | Variação de CMV e proteção de margem | `EM_ANALISE` | 2026-09-09 | Não duplicar o CMV; comparar pelo motor canônico | As 7 decisões P1–P7 (§25 do documento); COST-VAR-02 bloqueado | NÃO IMPLEMENTADO. Achados usados por COST-SOURCE-01 (merge da3bacf) |
| [COM-CORE — spike](../archive/SPIKE_COM_NEW_QUOTES.md) | Novos ciclos comerciais no mesmo Projeto | `IMPLEMENTADO` | 2026-09-09 | Projeto aprovado continua vendendo; cada compra é um orçamento novo | — | COM-CORE, merge 1ed7aeb (2026-09-08); regras §69–§71 |
| [COM-04 — spike](../archive/SPIKE_COM_DELIVERY_SCHEDULE.md) | Quantidade contratada e entregas programadas | `IMPLEMENTADO` | 2026-09-09 | Entrega programada é promessa; Expedição é execução | — | COM-04, merge 9acd9c5; COM-04b, merge 592c126 (2026-09-09); regra §75 |
| [UX-HELP-01](../archive/AUDIT_UX_COMO_FUNCIONA.md) | Ajuda contextual "Como funciona" | `DECIDIDO` | 2026-09-09 | Opção A: modal atual reordenado, nível 1 antes do passo a passo | O que a Fase 1 deixou aberto (BACKLOG #13, UX-HELP-03) | Parcial: UX-HELP-02 Fase 1, merge b7dbf0f (2026-09-09) |
| [PREC-01](../NUMERIC_PRECISION_AUDIT.md) | Precisão numérica do domínio | `DECIDIDO` | 2026-09-05 | Matriz de precisão e motor decimal canônico (§57–§59) | Preferências de exibição PREC-UI (roadmap) | Parcial: publicação 0305704; Fundação A, merge 5f855cd (2026-09-05) |
| SUPPLIER-OFFER-OVERLAP-01 ([BACKLOG §G](../BACKLOG.md)) | Vigências sobrepostas de oferta e de tarifa industrial | `EM_ANALISE` | 2026-09-09 | Uma decisão só para oferta e tarifa | Escolher entre os caminhos A–D | NÃO IMPLEMENTADO |
| SUPPLIER-ADDRESS-01 ([histórico do BACKLOG](../archive/BACKLOG_HISTORY.md)) | Endereço do Fornecedor | `IMPLEMENTADO` | 2026-09-09 | Reusar a fundação de endereço e CEP do Cliente (§80) | — | SUPPLIER-ADDRESS-01, merge b8d744b (2026-09-11) |
| COM-CONTRACT-01 ([BACKLOG §G](../BACKLOG.md)) | Registro leve de contrato comercial | `EM_ANALISE` | 2026-09-09 | Contrato não dirige a situação comercial do Cliente | Escopo do registro | NÃO IMPLEMENTADO |
| SUPPLIER-MODE-01 ([BACKLOG §G](../BACKLOG.md)) | "Fornecedor — Virtual / Físico" | `EM_ANALISE` | 2026-09-09 | Não criar enum antes da definição | O que a Veridi decide com a informação | NÃO IMPLEMENTADO |
| ASSET-01 ([BACKLOG §G](../BACKLOG.md)) | "Cadastro de Ativos" | `EM_ANALISE` | 2026-09-09 | Não criar módulo; auditar `IndustrialResource` primeiro | Qual dos quatro significados está em jogo | NÃO IMPLEMENTADO |
