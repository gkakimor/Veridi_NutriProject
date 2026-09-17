# ITEM-DUPLICATE-SANITIZATION-DISCOVERY-01 — Itens de estoque com o mesmo nome

## 1. Status

`EM_ANALISE` — Onda A decidida pelo PO e aplicada no `veridi_dev` em 2026-09-17 (ITEM-DUPLICATE-SANITIZATION-01).
D1, D3 e D5 do PO e V1–V7 da Veridi seguem abertas; PROD não foi lido nem escrito.

Discovery READ ONLY entregue no chat em 2026-09-17 sobre `origin/main` `0fc49e4` (`release/prod` `5b7c1a3`), lido no
`veridi_dev` em transação somente leitura. Este documento o persiste junto com a implementação da Onda A.

## 2. Objetivo

Sanear os Itens de matéria-prima e embalagem que repetem o nome (sem espaço nas pontas e sem caixa) antes de
ITEM-NAME-STANDARDIZATION-01 criar a garantia de nome único: o índice não nasce por cima de duplicata.

## 3. PO baseline

- ITEM-NAME-STANDARDIZATION-01 parou em 2026-09-17 (`a6fcbdd`) no passo de duplicidade: 18 grupos, 39 Itens MP/ME. O PO
  pediu o saneamento como capability separada, antes do índice, sem trigger e sem renomear.
- Handoff da Onda A (2026-09-17): sanear só os grupos inequívocos, só no DEV, por ferramenta PLAN → APPLY → VERIFY com
  transação única, trava consultiva, `SELECT FOR UPDATE`, impressão digital e falha fechada; duplicado sem uso é
  removido, não inativado; de-para no arquivo de decisão e na documentação, sem tabela de alias e sem migration; o
  importador segue a mesma decisão.

## 4. Estado atual

`veridi_dev` = carga inicial de PROD (2026-09-14), mesmos códigos do ERP. Antes da Onda A: 825 Itens (650 MP/ME, 175 PA),
18 grupos com 39 Itens, todos ativos, sem OC, recebimento, lote, movimento, OP, contagem ou custo — só formulação e
fornecedor. Depois: 819 Itens (644 MP/ME), 12 grupos com 27 Itens.

Origem das duplicatas na planilha: uma linha por nutriente declarado (fosfatos, membrana de casca de ovo, tomate,
arabinogalactana, beta-glucana, piridoxal), linhas vindas só do cadastro do CMV (tampas HECAPLAST, goma xantana) ou só da
tabela de preço (maçã, oliva), e materiais diferentes com o mesmo nome (oliva, guaraná, provavelmente não o café verde).

## 5. Evidências

- `Item.name` sem índice; `Item.code` sai de sequence por banco (o mesmo código pode nomear Itens diferentes em DEV e
  PROD); a chave estável entre ambientes é `externalCode`, o código da planilha.
- Catálogo real das FKs para `items` (21): `inventory_movements`, `stock_count_positions` e `item_cost_references` são
  `CASCADE`; `products.finishedProductItemId` e `stock_count_findings` são `SET NULL`; o resto é `RESTRICT`.
  `customer_order_lines.finishedItemId` não tem FK. Nove colunas JSON (`industrial_cost_calculations.result`,
  `production_order_cost_snapshots.breakdown`, `stock_counts.scopeFilters`, `user_preferences.ui` e outras).
- Relação Item × Fornecedor: `@@unique([supplierId, itemId])`, índice parcial de um preferencial por Item e `CHECK` de
  preferencial só ativo e homologado; oferta com `sourceKey` único; histórico de homologação imutável.
- Importador: Item por `externalCode`/CHAVE_MIGRACAO, oferta por CHAVE_ITEM do 07 e `sourceKey`, componente de formulação
  pelo código da planilha, template de abertura de estoque por código (`opening-stock.ts` lê um saldo legado por Item).
- `scripts/veridi-examples/load.ts` resolve Item por nome sem caixa e recusa dois candidatos: os grupos são "ambíguos"
  para a carga de exemplos até o saneamento.

## 6. Findings

| Onda | Grupo | Canônico (absorvidos) | Leitura |
|---|---|---|---|
| A | G1 Ácido nicotínico | MP-000032 (MP-000034) | Mesmo cadastro, sem uso dos dois lados |
| A | G12 Goma xantana | MP-000458 (MP-000509) | Cópia vazia do itens.csv; o canônico tem 1 rascunho e 4 relações |
| A | G14 L-triptofano | MP-000049 (MP-000507) | O canônico tem 7 componentes ACTIVE e 3 relações |
| A | G16 Tampa HP700BL Hecaplast | ME-000047 (ME-000084) | HECAPLAST dos dois lados |
| A | G17 Tampa HP900BL Hecaplast | ME-000049 (ME-000086) | HECAPLAST dos dois lados; SALOPET só no absorvido |
| A | G18 TAMPA SR 0.9 | ME-000127 (ME-000129) | Sem uso dos dois lados |
| B | G2 Arabinogalactana · G3 Beta-glucana · G5 Tomate · G8, G9 e G10 Fosfatos · G15 Membrana de casca de ovo | MP-000115 · MP-000118 · MP-000347 · MP-000269 · MP-000270 · MP-000204 · MP-000312 | Mesmo material, nutriente declarado diferente — depende de D1 |
| B | G4 Concentrado de maçã · G11 Fosfato de piridoxal | MP-000149 · MP-000014 | Dependem de V5 e V4 |
| C | G6 Café verde · G7 Oliva · G13 Guaraná | sem canônico | Não fundir sem a Veridi: G6 provável mesmo material com 2 componentes ACTIVE no MP-000348; G7 e G13 prováveis materiais distintos |

Fora do índice, apontados no discovery (D5): potes ME-000083 → ME-000046 e ME-000085 → ME-000048, acento ME-000021 ×
ME-000089.

## 7. Gaps

- Não existia caminho seguro para tirar um Item duplicado: excluir pela FK leva junto movimento, posição de contagem e
  custo de referência (`CASCADE`), e inativar mantém o nome repetido que o índice recusa.
- A carga recriaria o duplicado a cada reconstrução (`e2e:baseline:rebuild`, reexecução do importador).

## 8. Riscos

- Referência escondida: `CASCADE`, `SET NULL`, coluna sem FK e JSON não aparecem num `DELETE` que "passou".
- Relação duplicada com o mesmo fornecedor: preferencial dos dois lados, homologação divergente ou histórico feito por
  gente depois da carga não se fundem sem perder decisão.
- Formulação ACTIVE/INACTIVE é histórica: reescrever o componente muda o significado da versão (§106 e regras de versão).
- PROD está em uso desde 2026-09-14: o estado do DEV não prova o de PROD, e o código do ERP pode não ser o mesmo Item.

## 9. Alternativas consideradas

- **Inativar o duplicado** — mantém o nome repetido e o lixo histórico; conflita com o índice. Rejeitada (D2).
- **Migration Prisma com o saneamento** — decisão de dado não é schema, o banco de teste da suíte não tem os mesmos
  Itens, e a cadeia rodaria em qualquer banco sem conferência. Rejeitada.
- **Tabela de alias do código absorvido** — estrutura nova para um rastro que o arquivo de decisão e o backup já guardam.
  Rejeitada (D4).
- **Mapeamento fixo no importador** — segunda verdade, espalhada. Rejeitada: o importador lê o arquivo de decisão.

## 10. Recomendação

Arquivo de decisão único e versionado lido pelo importador e por uma ferramenta de manutenção PLAN → APPLY → VERIFY que
só executa a decisão com o banco no estado previsto, por onda, com backup restaurável antes do APPLY.

## 11. Decisões PO

- **D1 — nutrientes do mesmo material (Onda B).** Recomendado: um Item por material, com todos os nutrientes no campo
  atual ("A · B · C"), sem migration; estrutura Item × nutriente só com o Bloco H. **Decidida em 2026-09-17:** é isso
  mesmo — consolidar os valores ÚNICOS de `declaredNutrient` no canônico na forma "A · B · C", sem repetir termo.
  Aprovada para os grupos G2, G3, G5, G8, G9, G10 e G15, numa rodada própria
  (MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01); nada foi executado.
- **D2 — duplicado sem uso.** Remover (inativar exige nome distinto e conflita com o índice). **Decidido em 2026-09-17:
  remover; não inativar para manter lixo histórico.**
- **D3 — G6 café verde, se for o mesmo material.** Correção única da carga movendo os 2 componentes ACTIVE (reescrita
  explícita) × manter os dois. **Pendente** — em 2026-09-17 o PO manteve G6 (MP-000325 × MP-000348) em revisão, junto com
  G4, G7, G11 e G13: podem ser materiais tecnicamente diferentes, e nome igual com material diferente não se funde (§114).
- **D4 — rastro do código absorvido.** **Decidido em 2026-09-17:** de-para no arquivo de decisão da carga
  (`scripts/veridi-import/item-duplicate-decisions.ts`) e nesta documentação, backup JSON antes do APPLY, sem tabela de
  alias e sem migration.
- **D5 — extras fora do índice** (potes ME-000083 → 046 e ME-000085 → 048; acento ME-000021 × 089, e se a unicidade
  ignora acento). **Parcialmente decidida em 2026-09-17:** a unicidade **NÃO** ignora acento — a regra automática
  preserva acento (§114). O par ME-000021 × ME-000089 é duplicado verdadeiro **por decisão explícita do PO sobre este
  par**, a consolidar na Onda 2 depois de PLAN e impressão digital, sem mudar a regra geral. Os potes seguem pendentes.

## 12. Pendências PO

D1, D3 e D5. Perguntas à Veridi: V1 café verde FLORIEN (R$ 650/100 g × R$ 160/1 kg); V2 teor das olivas; V3 guaraná 22%
de quê e especificação SANRISIL; V4 significado de "*" e "**" no nutriente; V5 maçã APLINOVA; V6 materiais
multi-nutriente são um físico só; V7 SALOPET ligado às tampas e potes HP900BL.

Execução da Onda A em PROD: conferência READ ONLY em PROD, PLAN em PROD, backup restaurável e aprovação do PO antes.

## 13. Escopo recomendado

Onda A (feita no DEV) → Onda A em PROD → Onda B depois de D1 (e V4/V5 para G4/G11) → Onda C depois de V1–V3 e D3 →
ITEM-NAME-STANDARDIZATION-01 com a migration do índice, recontando duplicidades no DEV e em PROD antes.

## 14. Fora do escopo

Índice único e MAIÚSCULAS (ITEM-NAME-STANDARDIZATION-01), tela de fusão de cadastro, tabela de alias, migration,
Item acabado (PA), abertura de estoque.

## 15. Próxima capability

ITEM-DUPLICATE-SANITIZATION-PROD-01 (Onda A em PROD, com o APPLY liberado para produção sob confirmação explícita) ou a
Onda B, conforme o PO.

## 16. Implementação

**Onda A — ITEM-DUPLICATE-SANITIZATION-01 (2026-09-17), aplicada no `veridi_dev`; PROD intocado.**

- **Decisão:** `scripts/veridi-import/item-duplicate-decisions.ts` (grupo, nome, código do ERP e código da planilha dos
  dois lados); `item-duplicates.ts` valida (cadeia, absorvido repetido, tipo, padrão) e gera a impressão das decisões.
- **Ferramenta:** `scripts/maintenance/item-duplicate-sanitization.ts` `plan | apply | verify --onda=A`. Regras em
  [`PRODUCT_RULES.md`](../PRODUCT_RULES.md) §110; comandos em [`VERIDI_MIGRATION.md`](../VERIDI_MIGRATION.md)
  ("Duplicatas de Item absorvidas").
- **Importador:** com pacote, a duplicata nunca é criada, o código do ERP dela é consumido, o código da planilha resolve
  para o canônico; base que ainda tem a duplicata ou canônico fora da carga reprovam o plano; plano e APPLY carimbam a
  impressão das decisões.
- **DEV:** PLAN `plano-dev-20260917T103030Z.json` (6 grupos PRONTO; impressão do plano `096da2a0…`), backup
  `dev-pre-item-dup-onda-a-20260917T103047Z.json` (82 models, 5.854 linhas, `RESTAURÁVEL: YES`), APPLY numa transação
  (Itens −6; relações −2 e 1 movida; 2 ofertas e 4 eventos movidos; nada mais), VERIFY OK. Arquivos em
  `.local-data/veridi/saneamento-duplicatas/onda-a/` e `.local-data/veridi/backups/`.
- **Carga depois do saneamento:** PLAN do importador sobre o DEV saneado com `readyForLoad: true` e nada a criar; rebuild
  descartável da carga com os mesmos 637 Itens (código, planilha, tipo, nome), 719 relações, 773 ofertas e 1.292
  componentes ACTIVE do DEV saneado.

## 17. Histórico de decisões

- 2026-09-17 — Discovery entregue no chat (base `0fc49e4`); persistido neste arquivo na implementação da Onda A.
- 2026-09-17 — PO: Onda A autorizada (G1, G12, G14, G16, G17, G18), D2 = remover, D4 = arquivo de decisão e documentação
  sem alias; G2–G11 (fora os da Onda A), G13, G15, G6 e os extras de D5 ficam fora.
- 2026-09-17 — PO: a regra de duplicidade passa a valer para TODOS os cadastros mestre
  (MASTER-DATA-DUPLICATE-SANITIZATION-01, §114), com ferramenta genérica que descobre os grupos em vez de ler arquivo de
  decisão. Ela **recusa** os Itens deste discovery: código no arquivo de decisão vai pela ferramenta da §110. Os 12
  grupos restantes foram remedidos no `veridi_dev` e saíram todos BLOQUEADOS pelo mesmo motivo objetivo —
  `declaredNutrient` diferente entre os lados —, o que confirma que Ondas B e C dependem de D1/D3 e de V1–V7, e não de
  ferramenta. O extra de D5 (ME-000021 × ME-000089, acento) saiu na aba "Revisão necessária" da planilha, como variante
  que a regra não funde.
- 2026-09-17 — PO, na integração: D1 decidida ("A · B · C" com valores únicos) e Onda 2 aprovada para G2, G3, G5, G8,
  G9, G10 e G15 mais o par nomeado da sílica, **sem executar**; G4, G6, G7, G11 e G13 seguem em revisão; o Modelo "X"
  (FT-000001 × FT-000002) segue bloqueado até se saber conteúdo, versões, referências, descarte e o impacto da colisão
  de `versionNumber`. A execução é MASTER-DATA-DUPLICATE-SANITIZATION-WAVE-2-01, que precisa de escrita no canônico e
  de par nomeado — nenhuma das duas existe na ferramenta de hoje.
