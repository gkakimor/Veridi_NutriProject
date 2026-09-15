# Arquivo histórico

## Política

Esta pasta guarda **documentação textual que deixou de ser vigente** e ainda
ajuda a entender uma decisão antiga. Não é contexto padrão de trabalho e não é
lixeira.

Onde está o que vale hoje:

| Assunto | Fonte |
|---|---|
| Estado atual da implementação | [`PROJECT_STATE.md`](../PROJECT_STATE.md) |
| Pendências abertas | [`BACKLOG.md`](../BACKLOG.md) |
| Regras duráveis de negócio | [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) |
| Discoveries de produto | [`discovery/README.md`](../discovery/README.md) |

**Entra aqui:** relatório, auditoria, spike ou plano substituído que registra
uma decisão útil, em texto.

**Não entra aqui:** ZIP, PNG, PDF, DOCX, XLSX, dump, backup, log, cache, código
morto, rascunho sem decisão ou cópia de documento vigente. Backup e dado real
moram fora do repositório (`../.local-data/veridi/`); material de entrega mora
em `../handoff/`.

Arquivo versionado removido **não volta para cá só para ser guardado**: o
histórico do Git já o preserva. A tabela "Arquivos removidos" diz como
recuperar. Artefato gerado ou ignorado não é registrado.

## Documentos nesta pasta

| Arquivo | Conteúdo |
|---|---|
| [`DELIVERY_HISTORY.md`](DELIVERY_HISTORY.md) | diário das deliveries 01 a 40+ |
| [`BACKLOG_HISTORY.md`](BACKLOG_HISTORY.md) | findings auditados e itens fechados do backlog |
| [`E2E_VALIDATION_HISTORY.md`](E2E_VALIDATION_HISTORY.md) | consolidação das rodadas E2E e adversariais |
| [`E2E_AUDIT_2026-09-07.md`](E2E_AUDIT_2026-09-07.md) | auditoria E2E pela interface de 2026-09-07 e sua triagem |
| [`AUDIT_UX_COMO_FUNCIONA.md`](AUDIT_UX_COMO_FUNCIONA.md) | auditoria UX-HELP-01 da ajuda contextual |
| [`COST-VAR-01_AUDITORIA_VARIACAO_CMV.md`](COST-VAR-01_AUDITORIA_VARIACAO_CMV.md) | auditoria de variação de CMV |
| [`SPIKE_COM_NEW_QUOTES.md`](SPIKE_COM_NEW_QUOTES.md) | spike de novos ciclos comerciais no Projeto |
| [`SPIKE_COM_DELIVERY_SCHEDULE.md`](SPIKE_COM_DELIVERY_SCHEDULE.md) | spike de entregas programadas |
| [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) | roteiro da demonstração de 2026-08-17 |

## Documentos arquivados

| Data | Arquivo atual | Caminho anterior | Motivo | Commit |
|---|---|---|---|---|
| 2026-09-15 | `docs/archive/DEMO_SCRIPT.md` | `docs/DEMO_SCRIPT.md` | roteiro da demo de 2026-08-17; não é documentação vigente | este commit (REPO-HYGIENE-CLEANUP-01) |
| 2026-09-15 | `docs/archive/E2E_AUDIT_2026-09-07.md` | `docs/E2E_AUDIT_CURRENT.md` | rodada de 2026-09-07, superada pelas waves E2E; renomeado pela data | este commit (REPO-HYGIENE-CLEANUP-01) |

## Arquivos removidos

| Data | Caminho removido | Motivo | Commit de remoção | Recuperação |
|---|---|---|---|---|
| 2026-09-15 | `docs/logo/logo-veridi-head.png` | cópia idêntica (mesmo blob) de `apps/web/src/assets/brand/veridi-logo.png`, sem referência viva | este commit (REPO-HYGIENE-CLEANUP-01) | `git show <commit>^:docs/logo/logo-veridi-head.png` |
| 2026-09-15 | `scripts/help-metrics.mjs` | métrica one-shot da UX-HELP-01 (antes × depois da ajuda), sem referência viva | este commit (REPO-HYGIENE-CLEANUP-01) | `git show <commit>^:scripts/help-metrics.mjs` |

"Este commit" é o commit que acrescenta a linha à tabela. Para achar o SHA:

```bash
git log --diff-filter=D --format=%h -1 -- <caminho removido>
```

Para restaurar o arquivo no checkout:

```bash
git restore --source=<commit>^ -- <caminho removido>
```
