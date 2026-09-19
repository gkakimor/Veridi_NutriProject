# INTERNAL-CONSUMPTION-COST-CENTER-DISCOVERY-01 — Centro de Custo do consumo interno

## 1. Status

`DECIDIDO` — o PO respondeu P1–P4 em 2026-09-19 e fixou cadastro, permissões, legado e lugar no menu (seção 11).
Implementação: INTERNAL-CONSUMPTION-COST-CENTER-01, **P2**, abaixo dos P0/P1 da fila viva. Nada implementado (seção 16).

Discovery READ ONLY de 2026-09-19 sobre `main` `cf8d353e` (PROD `884a500d`, v1.0.0), entregue só no chat.
Persistido no mesmo dia por PRODUCT-BACKLOG-CONSOLIDATION-01. **O relatório completo não está acessível**: a sessão do
discovery não existe mais e o texto não ficou em arquivo. Este documento parte da nota registrada no fim da sessão
(recomendação e armadilhas) e não foi reconferido no código. Faltam, e não foram reconstruídos: o desenho de telas, o
plano de testes e o inventário completo de consultas afetadas. Depois de `cf8d353e`, INTERNAL-CONSUMPTION-BACKDATED-
AFTER-COUNT-01 (`ef7ca1c9`, §127) mexeu no mesmo `registerInternalConsumption`: reconferir as linhas na `main`.

## 2. Objetivo

Trocar o destino/uso em texto livre do consumo interno (`CI-`) por um Centro de Custo que agrupe de forma confiável —
"Escritorio", "escritório" e "ADM" hoje viram três destinos no R-21.

## 3. PO baseline

- INTERNAL-CONSUMPTION-01 deixou o Centro de Custo explicitamente fora da fatia (BACKLOG, seção G).
- Desde INTERNAL-CONSUMPTION-REPORT-01 (§117) o R-21 filtra e agrupa pelo texto EXATO do destino.
- Estorno do consumo interno (`ECI-`, §126) e recusa do consumo de data passada contado (§127) estão na `main`.

## 4. Estado atual

Destino/uso é texto livre e opcional no `CI-` (`purpose`), sem cadastro. O R-21 agrupa por ele.

## 5. Evidências (em `cf8d353e`, pela nota)

- O total e a paginação do R-21 (`listados`) somam os grupos POR DESTINO (`internal-consumption-report.service.ts:199-207`).
- Índice funcional `upper(btrim(name))` não tem precedente; só índices parciais em SQL cru passam no `migrate diff` do
  `validate:migrations:fresh`.
- Seed por migration obriga a registrar o model em `REFERENCIA_DAS_MIGRATIONS` (`restore-json-backup-check.mjs:53-58`).
- `prod-cleanup-sequences.mjs`: sequence de negócio exige o model nos ALVOS.
- Guarda de nome de cadastro mestre: `CadastroMestre` + `COLUNAS`; `master-data-names.test.ts` e
  `master-data-catalog.test.ts` fixam os nove cadastros.
- Precedente de trava contra inativação em curso: `FOR SHARE` em `receiving.service.ts:421-433`.
- PROD tinha 0 CI e 0 ECI na publicação de `ff861c90` ([`RELEASES.md`](../RELEASES.md)): o legado real tende a zero.

## 6. Findings

Os pontos que só aparecem juntando arquivos:

- Trocar o agrupamento do R-21 mexe no total e na paginação, não só no resumo.
- Nome único sem caixa por índice funcional precisa ser provado no primeiro commit (alternativa: guarda da aplicação ou
  coluna normalizada `@unique`).
- O Centro de Custo fica FORA do saneamento de duplicatas (exclusões de `master-data-catalog.ts`), mas a guarda de nome
  e os testes que fixam os nove cadastros mudam.
- Corrigir centro errado por estorno falha quando a posição foi contada depois do CI (`position_counted_after_consumption`).
- Classificar a sequence nova no `prod-cleanup` é decisão do PO.

## 7. Gaps

Não existe cadastro de Centro de Custo nem vínculo do `CI-` com ele.

## 8. Riscos

- Total do R-21 mudando junto com o agrupamento (seção 6).
- Migration com índice funcional sem precedente no `validate:migrations:fresh`.
- Centro inativado durante um registro de CI em curso (precedente de `FOR SHARE` na seção 5).

## 9. Alternativas consideradas

Cadastro de Centro de Custo × lista fechada de destinos (a pergunta registrada no BACKLOG, seção G). O PO escolheu o
cadastro próprio (seção 11).

## 10. Recomendação (da nota)

- Tabela `cost_centers`: código `CC-` por `cost_center_code_seq`, nome único sem caixa, ativo/inativo, autoria como no
  Recurso industrial.
- O CI ganha `costCenterId` anulável com FK RESTRICT, snapshot de código e nome, e CHECK do trio (os três juntos ou
  nenhum).
- O ECI não ganha coluna: herda pela relação com o CI.
- `purpose` vira legado só de leitura; `notes` vira "Observação / finalidade".
- Sem backfill; sem seed; só ADMIN escreve.

## 11. Decisões PO

Respondidas em 2026-09-19 (handoff PRODUCT-BACKLOG-CONSOLIDATION-01), com as palavras do PO:

- **CostCenter = cadastro próprio.**
- **P1:** obrigatório em CI novo.
- **P2:** criar, editar e inativar somente ADMIN; todo autenticado pode consultar.
- **P3:** o destino/uso livre sai do CI novo; `purpose` permanece só como legado de leitura; "Observação/finalidade"
  continua livre.
- **P4:** CIs antigos SEM backfill; o CI antigo aparece "Sem centro de custo" e preserva o destino antigo.
- Sem seed automático.
- Cadastro em **Cadastros e Configurações › Centros de custo**.
- Prioridade: a capability continua abaixo dos P0/P1 atuais (P2 na fila viva).

## 12. Pendências PO

- Classificar a sequence nova no `prod-cleanup` (seção 6), na implementação.

## 13. Escopo recomendado

Uma capability, INTERNAL-CONSUMPTION-COST-CENTER-01: cadastro, vínculo obrigatório no CI novo, leitura do legado e o
R-21 agrupando sem quebrar o total. **Migration aditiva** (`cost_centers` e as colunas do CI); o próximo prefixo livre
era `…093041` em `cf8d353e` — conferir na hora.

## 14. Fora do escopo

- Backfill de CI antigo e seed de centros.
- Saneamento de duplicatas do Centro de Custo (fica fora do catálogo do saneamento).
- Card do Painel para Uso e consumo (DASHBOARD-INTERNAL-CONSUMPTION-01, item próprio).

## 15. Próxima capability

INTERNAL-CONSUMPTION-COST-CENTER-01 (P2, fila viva de [`BACKLOG.md`](../BACKLOG.md)). Relacionados:
[INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01](INTERNAL-CONSUMPTION-REVERSAL-DISCOVERY-01.md), §117 (R-21), §126 (estorno)
e §127 (consumo de data passada).

## 16. Implementação

**NÃO IMPLEMENTADO.**

## 17. Histórico de decisões

- 2026-09-19 — discovery entregue no chat (READ ONLY, `cf8d353e`), `READY = NO` até P1–P4.
- 2026-09-19 — PO decide P1–P4, cadastro próprio, sem seed e o lugar no menu. Persistido da nota da sessão por
  PRODUCT-BACKLOG-CONSOLIDATION-01.
