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
| [FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md) | Painel Gerencial: o que o ERP mostra de dinheiro com confiança | `EM_ANALISE` | 2026-09-15 | Recomendado: nome "Painel Gerencial" (não "Financeiro"), tela própria em Gestão, endpoint próprio; "Faturado" = `Billing.totalAmount` congelado; sem contas a pagar, contas a receber, caixa, margem ou imposto na versão 1 | D1 valor canônico do faturado · D2 valores incompletos · D3 nome e lugar · D4 quem vê · D5 valor de carteira e a faturar | NÃO IMPLEMENTADO. Próxima: BILLED-VALUE-CANONICAL-01, depois MANAGEMENT-DASHBOARD-V1-01 |
| [E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01](E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01.md) | Massa operacional própria para as E2E do grupo C e a OP fora da 1ª página | `EM_ANALISE` | 2026-09-15 | Recomendado: `produzirPa` por API (subwave 4A) antes das suítes; 4E (desconto → faturamento) por último | P1–P8; P1 (escopo WAVE 3 × grupo C) vem antes de tudo; 4E depende da WAVE 3 na `main` | NÃO IMPLEMENTADO. Próxima: decisão PO de P1–P8, depois E2E-BASELINE-REDESIGN-WAVE-04 |
| [WAVE-05-GOLDEN-PATH-DISCOVERY-01](WAVE-05-GOLDEN-PATH-DISCOVERY-01.md) | Golden path private label na fundação E2E nova | `EM_ANALISE` | 2026-09-15 | Recomendado: opção B do runner (`--run`/`--desde`, `--clone`), checkpoint como mapa de entidades, `billingStatus === "BILLED"` | Q3 e Q5 bloqueiam; B1 (trecho comercial com a WAVE 3) a combinar; Q1, Q2, Q4, Q6–Q10 | NÃO IMPLEMENTADO. Próxima: fechar Q3/Q5/B1, depois E2E-BASELINE-REDESIGN-WAVE-05 |
| [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md) | Permissões de execução da Ordem de Produção | `EM_ANALISE` | 2026-09-15 | Recomendado: execução da OP só ADMIN + PRODUCTION; cancelamento com ator real (não `SYSTEM_ACTOR`); `ForbiddenError` mapeado para 403 | P1 e P6 bloqueiam; P2–P5, P7, P8 com recomendação | NÃO IMPLEMENTADO. Próxima: fechar P1/P6, depois PRODUCTION-PERMISSION-HARDENING-01 |
| INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01 ([BACKLOG §G](../BACKLOG.md)) | Inventário Físico em sessões de inventário em lote | `EM_ANALISE` | 2026-09-15 | Objetivos aprovados pelo PO (baseline): sessões em lote, Contagem rápida mantida, inventário nunca sobrescreve saldo | Concorrência/cut-off (HIGH) e as demais abertas na baseline | NÃO IMPLEMENTADO. Baseline registrada em 04d97ad (merge 9b011aa). O discovery ganha documento próprio (`INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md`) quando a rodada acontecer |
| [COST-VAR-01](../archive/COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) | Variação de CMV e proteção de margem | `EM_ANALISE` | 2026-09-09 | Não duplicar o CMV; comparar pelo motor canônico | As 7 decisões P1–P7 (§25 do documento); COST-VAR-02 bloqueado | NÃO IMPLEMENTADO. Achados usados por COST-SOURCE-01 (merge da3bacf) |
| [COM-CORE — spike](../archive/SPIKE_COM_NEW_QUOTES.md) | Novos ciclos comerciais no mesmo Projeto | `IMPLEMENTADO` | 2026-09-09 | Projeto aprovado continua vendendo; cada compra é um orçamento novo | — | COM-CORE, merge 1ed7aeb (2026-09-08); regras §69–§71 |
| [COM-04 — spike](../archive/SPIKE_COM_DELIVERY_SCHEDULE.md) | Quantidade contratada e entregas programadas | `IMPLEMENTADO` | 2026-09-09 | Entrega programada é promessa; Expedição é execução | — | COM-04, merge 9acd9c5; COM-04b, merge 592c126 (2026-09-09); regra §75 |
| [UX-HELP-01](../archive/AUDIT_UX_COMO_FUNCIONA.md) | Ajuda contextual "Como funciona" | `DECIDIDO` | 2026-09-09 | Opção A: modal atual reordenado, nível 1 antes do passo a passo | O que a Fase 1 deixou aberto (BACKLOG #13, UX-HELP-03) | Parcial: UX-HELP-02 Fase 1, merge b7dbf0f (2026-09-09) |
| [PREC-01](../NUMERIC_PRECISION_AUDIT.md) | Precisão numérica do domínio | `DECIDIDO` | 2026-09-05 | Matriz de precisão e motor decimal canônico (§57–§59) | Preferências de exibição PREC-UI (roadmap) | Parcial: publicação 0305704; Fundação A, merge 5f855cd (2026-09-05) |
| SUPPLIER-OFFER-OVERLAP-01 ([BACKLOG §G](../BACKLOG.md)) | Vigências sobrepostas de oferta e de tarifa industrial | `EM_ANALISE` | 2026-09-09 | Uma decisão só para oferta e tarifa | Escolher entre os caminhos A–D | NÃO IMPLEMENTADO |
| SUPPLIER-ADDRESS-01 ([BACKLOG §G](../BACKLOG.md)) | Endereço do Fornecedor | `EM_ANALISE` | 2026-09-09 | Reusar a fundação de endereço e CEP do Cliente (§80) | — (P1-1 da fila viva) | NÃO IMPLEMENTADO |
| COM-CONTRACT-01 ([BACKLOG §G](../BACKLOG.md)) | Registro leve de contrato comercial | `EM_ANALISE` | 2026-09-09 | Contrato não dirige a situação comercial do Cliente | Escopo do registro | NÃO IMPLEMENTADO |
| SUPPLIER-MODE-01 ([BACKLOG §G](../BACKLOG.md)) | "Fornecedor — Virtual / Físico" | `EM_ANALISE` | 2026-09-09 | Não criar enum antes da definição | O que a Veridi decide com a informação | NÃO IMPLEMENTADO |
| ASSET-01 ([BACKLOG §G](../BACKLOG.md)) | "Cadastro de Ativos" | `EM_ANALISE` | 2026-09-09 | Não criar módulo; auditar `IndustrialResource` primeiro | Qual dos quatro significados está em jogo | NÃO IMPLEMENTADO |
