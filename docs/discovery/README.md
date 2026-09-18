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
| [ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01](ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01.md) | Itens de matéria-prima e embalagem com o mesmo nome antes do nome único | `EM_ANALISE` | 2026-09-17 | 18 grupos, 39 Itens em ondas A/B/C. D2 decidida: duplicado sem uso é removido. D4 decidida: de-para no arquivo de decisão da carga e na documentação, sem alias e sem migration. Onda A (G1, G12, G14, G16, G17, G18) autorizada. D1 decidida ("A · B · C" com os nutrientes únicos) e Onda 2 aprovada (G2, G3, G5, G8, G9, G10, G15 e o par da sílica). Entregue no chat e persistido na implementação da Onda A | D3 (café verde) e o resto de D5 (potes); V1–V7 com a Veridi para G4, G6, G7, G11 e G13; Ondas A e 2 em PROD | Parcial: Onda A por ITEM-DUPLICATE-SANITIZATION-01 (§110) e Onda 2 por MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01 (§118), 2026-09-17, aplicadas no `veridi_dev`, PROD intocado. Próximas: Ondas A e 2 em PROD, os cinco grupos em revisão, depois MASTER-DATA-NAME-UNIQUENESS-01 |
| [MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01](MASTER-DATA-INACTIVE-VISIBILITY-DISCOVERY-01.md) | Cadastro inativo (Item, Fornecedor, Produto): onde some do que ainda existe e onde vaza para operação nova | `EM_ANALISE` | 2026-09-17 | D1–D3 decididas pelo PO: inativo com posição (saldo, reservado ou em compra) aparece no Estoque marcado; sem posição só com "Incluir inativos sem saldo", CSV igual à tela; Contagem rápida, saída e perda permitidas, entrada manual recusada (sobra entra pela contagem). D6–D7 decididas pelo PO: Produto inativo não inicia compromisso novo (vincular, linha, envio, aceite, aprovação, Pedido, Amostra; OP planejada não libera), rascunho abre com aviso e nada é cancelado; Produto × PA sem cascata, PA inativo com recusa própria. D4, D5, D8 e D9 recomendadas: receber OC confirmada com marca, OP nova recusa componente inativo, relação com item/fornecedor inativo sem homologar/preferencial/oferta, R-18 em "Todos". Entregue só no chat e persistido na Fatia 1. D4 e D8 decididas pelo PO: relação com item ou fornecedor inativo recusa criar, reativar, homologar, preferencial e oferta; inativar o fornecedor limpa o preferencial dele; receber OC confirmada antes da inativação segue, com marca | D5 e D9, uma fatia por vez | Parcial: Fatia 1 por INVENTORY-INACTIVE-ITEM-VISIBILITY-01 (§107), Fatia 2 por PRODUCT-INACTIVE-COMMERCIAL-GATE-01 (§108) e Fatia 3 por SUPPLIER-ITEM-INACTIVE-GATE-01 (§112), 2026-09-17, na `main`, fora de PROD. Próximas: PRODUCTION-INACTIVE-COMPONENT-GATE-01, opcional INACTIVE-MARKERS-REPORTS-01 |
| [LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01](LABEL-ATTACHMENTS-ARCHITECTURE-DISCOVERY-01.md) | Arquivo versionado do Item Rótulo e armazenamento de objetos (disco local × Cloudflare R2) | `IMPLEMENTADO` | 2026-09-16 | Cloudflare R2 aprovado; bucket privado `veridi-homologacao` criado pelo PO; abstração única `StorageAdapter` com `LOCAL_FS` e `R2`; versões imutáveis com vigente derivada, anular com motivo sem apagar bytes, restaurar como nova versão; PDF/PNG/JPEG até 25 MB por extensão, tipo e assinatura; enviar e restaurar Compras, Qualidade, Comercial e ADMIN; anular Qualidade e ADMIN. Decidido no chat e persistido na implementação, a partir do handoff. Smoke real no bucket de homologação OK | Configurar o R2 no Railway (STORAGE-R2-ACTIVATION-01) | LABEL-ATTACHMENTS-01, entregue em 2026-09-16 (na `main`, fora de PROD). Próximas: ativação do R2; ATTACHMENTS-R2-MIGRATION-01 |
| [ITEM-SUPPLIER-UX-DISCOVERY-01](ITEM-SUPPLIER-UX-DISCOVERY-01.md) | Item × Fornecedor administrável no cadastro do Item e do Fornecedor | `IMPLEMENTADO` | 2026-09-16 | D1: a seção Fornecedores do Item passa a ser administrável — Compras e Administrador adicionam fornecedor com o Item fixo e definem o preferencial (confirmação, troca atômica da API), Qualidade e Administrador homologam e bloqueiam no detalhe aberto por cima do Item, os demais consultam; duplicidade leva à relação existente. D2: a tela geral permanece. D4: Fornecedor → Itens em capability separada. D5: lead time fora do escopo. D3 decidida: Compras cria a relação, os dados comerciais e a primeira oferta, e administra o preferencial quando elegível, mas a relação nasce `PENDING`; homologar e bloquear, também na criação, são de Qualidade e Administrador (403 com o motivo, nada gravado); voltar para pendente com Compras, Qualidade e Administrador; o Administrador mantém a criação com situação explícita. Entregue só no chat e persistido depois, a partir do resumo da sessão; D1, D2, D4 e D5 reapresentadas pelo PO no handoff de ITEM-SUPPLIER-UX-01 | Nenhuma para a Fatia 1. Com SUPPLIER-ITEMS-UX-01: levar à tela geral a confirmação da troca de preferencial | D3 por ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01 e D1 por ITEM-SUPPLIER-UX-01, entregues em 2026-09-16 (na `main`, fora de PROD). Próxima: SUPPLIER-ITEMS-UX-01 (Fatia 2, D4) |
| [MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01](MASTER-DATA-EDIT-PERMISSIONS-DISCOVERY-01.md) | Quem cria, edita, inativa e reativa Item, Fornecedor e Produto | `IMPLEMENTADO` | 2026-09-16 | DE1–DE12: Item — criar e editar ADMIN, Compras, Qualidade e Produção; os quatro controles só Qualidade e ADMIN, pela mudança de valor (criação no padrão do tipo); "Consumido na produção" só Produção e ADMIN; custo de referência, inclusive o inicial, só Comercial e ADMIN (recusado, nunca ignorado); inativar Compras, Qualidade e ADMIN, reativar Qualidade e ADMIN. Fornecedor — Compras e ADMIN; homologação segue na relação. Produto — Comercial e ADMIN, inclusive a criação direta aprovada; "Exige CoA" só para o PA que nasce junto. 403 antes do corpo e da existência; 409 de situação; consulta no mesmo modal; criação contextual por perfil | Nenhuma. Registrados sem posição: ACQUISITION-COST-PERMISSION-01 (P1), MASTER-DATA-STRUCTURAL-LOCKS-01 e MASTER-DATA-STATUS-HISTORY-01 | MASTER-DATA-EDIT-PERMISSIONS-01, entregue em 2026-09-16 (na `main`, fora de PROD) |
| [CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01](CUSTOMER-PAYMENT-DEFAULTS-DISCOVERY-01.md) | Forma e condição de pagamento padrão do Cliente como sugestão para novos orçamentos | `IMPLEMENTADO` | 2026-09-16 | D1–D6: "Forma de pagamento" = PIX/Boleto/Transferência/Cartão/Outro e à vista/parcelado = "Condição de pagamento"; padrão copiado só para a primeira proposta real (V1 ou primeira depois de só legado), nunca lido ao vivo; V2, recompra e duplicação partem da versão; troca de Cliente não sobrescreve, "Aplicar padrão do cliente" só na tela; Pedido congela a forma; parcelado exige parcelas | Nenhuma | CUSTOMER-PAYMENT-DEFAULTS-01, entregue em 2026-09-16 (na `main`, fora de PROD) |
| [CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01](CUSTOMER-EDIT-PERMISSIONS-DISCOVERY-01.md) | Quem cria e edita o cadastro do Cliente | `IMPLEMENTADO` | 2026-09-16 | Opção A: ADMIN e COMMERCIAL criam e editam o cadastro inteiro (`CUSTOMER_EDIT_ROLES`, lista própria, separada da situação cadastral); os demais perfis consultam; 403 na API antes do corpo e da existência; sem permissão por campo; `businessLotSuffix` no mesmo gate, sem campo na tela | Nenhuma. Registrados sem posição: CUSTOMER-MASTER-DATA-AUDIT-01 (P2, futuro). CUSTOMER-CNPJ-AUTOFILL-01 foi reconciliado em 2026-09-17 e entregue como CUSTOMER-CNPJ-LOOKUP-01 (§111) | CUSTOMER-EDIT-PERMISSIONS-01, entregue em 2026-09-16 (na `main`, fora de PROD) |
| [FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01](FINANCIAL-MANAGEMENT-DASHBOARD-DISCOVERY-01.md) | Painel Gerencial: o que o ERP mostra de dinheiro com confiança | `IMPLEMENTADO` | 2026-09-15 | D1–D5 decididas com as recomendações: "Faturado" = `Billing.totalAmount`; "Valores incompletos" sem subtotal; "Painel Gerencial" em Gestão, tela própria; ADMIN e COMMERCIAL com a recusa na API; A expedir e A faturar pelo preço acordado antes do desconto. Sem contas a pagar, contas a receber, caixa, margem ou imposto | Sem posição: encerramento de saldo de OC parcialmente recebida (G5) e preço acordado em Pedido direto (G2) | BILLED-VALUE-CANONICAL-01 e MANAGEMENT-DASHBOARD-V1-01, entregues em 2026-09-15 |
| [E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01](E2E-BASELINE-REDESIGN-WAVE-04-DISCOVERY-01.md) | Massa operacional própria para as E2E do grupo C e a OP fora da 1ª página | `EM_ANALISE` | 2026-09-15 | Recomendado: `produzirPa` por API (subwave 4A) antes das suítes; 4E (desconto → faturamento) por último | P2–P8. P1 e a espera da 4E pela WAVE 3 resolvidas por estado posterior (WAVE 3 em `6256ca9`), registrado na fila viva do [`BACKLOG.md`](../BACKLOG.md) | NÃO IMPLEMENTADO. Próxima: decisão PO de P2–P8, depois E2E-BASELINE-REDESIGN-WAVE-04 (4A pode começar) |
| [WAVE-05-GOLDEN-PATH-DISCOVERY-01](WAVE-05-GOLDEN-PATH-DISCOVERY-01.md) | Golden path private label na fundação E2E nova | `EM_ANALISE` | 2026-09-15 | Recomendado: opção B do runner (`--run`/`--desde`, `--clone`), checkpoint como mapa de entidades, `billingStatus === "BILLED"` | Q3 bloqueia; Q1, Q2, Q4, Q6–Q10. Q5 e B1 resolvidos por estado posterior (WAVE 3 em `6256ca9`; WAVE 5 depois da WAVE 4), registrado no [`BACKLOG.md`](../BACKLOG.md) | NÃO IMPLEMENTADO. Próxima: fechar Q3, depois E2E-BASELINE-REDESIGN-WAVE-05, depois da WAVE 4 |
| [PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01](PRODUCTION-PERMISSION-HARDENING-DISCOVERY-01.md) | Permissões de execução da Ordem de Produção | `EM_ANALISE` | 2026-09-15 | Recomendado: execução da OP só ADMIN + PRODUCTION; cancelamento com ator real (não `SYSTEM_ACTOR`); `ForbiddenError` mapeado para 403 | P1 e P6 bloqueiam; P2–P5, P7, P8 com recomendação | NÃO IMPLEMENTADO. Próxima: fechar P1/P6, depois PRODUCTION-PERMISSION-HARDENING-01 |
| [INVENTORY-PHYSICAL-COUNT-DISCOVERY-01](INVENTORY-PHYSICAL-COUNT-DISCOVERY-01.md) | Inventário Físico em sessões de inventário em lote (baseline INVENTORY-PHYSICAL-COUNT-PO-BASELINE-01, [BACKLOG §G](../BACKLOG.md)) | `DECIDIDO` | 2026-09-15 | Decidido pelo PO: sessão `StockCount` (`INV-`) em contagem → revisão → encerrado/cancelado; saldo de referência por posição + saldo esperado congelado em cada registro, ajuste = diferença congelada aplicada como delta no encerramento, sem bloquear movimentações (F); uma posição em uma sessão aberta; recontagem opcional; sem tolerância; Contagem rápida grava `INV-` QUICK; CSV controlado na Fatia 3. Telas (addendum INVENTORY-PHYSICAL-COUNT-UI-DISCOVERY-01, 2026-09-16): DU-1 a DU-6 — contagem em cartão abaixo de 640px, Contagem rápida sem item de menu, cega por padrão, sem diferença ao vivo, 0 digitado, API aditiva | Nenhuma bloqueante; P7 (regularização de material sem lote) é futuro | Parcial: Fatia 1 (domínio e API) entregue em 2026-09-15, Fatias 2A (telas até Em revisão) e 2B (revisão, recontagem, decisão e encerramento pela tela) em 2026-09-16, por INVENTORY-PHYSICAL-COUNT-01. Próxima: Fatia 3 (FO-01 de sessão e CSV); INVENTORY-CONFIRMATION-AFTER-DECISION-01 espera o PO |
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
