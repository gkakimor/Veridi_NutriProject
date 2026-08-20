# Migração Veridi — runbook

Processo one-shot para levar as planilhas da Veridi para o ERP.

```
VALIDATE → PLAN → (revisar findings / overrides) → APPLY → VERIFY → ABERTURA DE ESTOQUE → CUTOVER
```

Princípios que valem em todas as etapas:

- **dry-run é o padrão.** Só `apply` escreve, e só com `--apply`.
- **aditivo e idempotente.** Nada de TRUNCATE, DROP ou reset. Rodar de novo
  não duplica.
- **erro do legado não vira erro do ERP.** Dado ambíguo produz *finding* e
  fica de fora; nada é "corrigido" por adivinhação, e não existe
  fuzzy matching.
- **importar cadastro não movimenta estoque.** Saldo de abertura é um
  processo separado, com reconciliação humana por lote.

---

## 1. Pré-requisitos

- Node 22+, pnpm, PostgreSQL com as migrations aplicadas (`pnpm db:deploy`).
- **Backup do banco antes do APPLY** — obrigatório em produção. O ERP não
  tem sistema de backup próprio: use o do PostgreSQL (`pg_dump`).
- Nenhum usuário operando o sistema durante a janela de migração.

## 2. Onde colocar os CSVs

```
.local-data/veridi/csv/*.csv
```

`.local-data/` está no `.gitignore`: clientes, CNPJ, fornecedores,
formulações e preços reais **nunca** são versionados. Se o material chegar
como `veridi-dados-csv.zip`, extraia para esse diretório.

Arquivos esperados: `fornecedores`, `clientes`, `itens`,
`itens_enriquecimento`, `formulacoes`, `projetos`, `dominios_pipeline`,
`amostras`, `precos_fornecedores`, `estoque_saldos`,
`compras_recebimentos`, `cmv_*`, `in28_limites`.

## 3. Validate

```
pnpm veridi:import:validate
```

Lê a fonte, confere estrutura, roda o motor de formulação contra o golden e
lista findings por severidade. Não escreve nada — nem em disco de banco,
nem no ERP.

Falha (exit 1) só por problema **estrutural**: arquivo ausente, parser
quebrado ou golden divergente. Dado legado ruim é finding, não erro.

## 4. Plan

```
pnpm veridi:import:plan
```

Simula a migração inteira (mesmo código do APPLY, escritas desligadas) e
grava em `.local-data/veridi/out/`:

| Arquivo | Conteúdo |
| --- | --- |
| `import-plan.json` | Manifesto: SHA-256 de cada CSV, contagens, ações planejadas, findings |
| `findings.csv` | Todos os findings, linha a linha |
| `findings-summary.md` | Agrupado por código: severidade, quantidade, importado?, ação humana |
| `import-report.md` | Relatório legível da execução |
| `opening-inventory-template.csv` | Base para a abertura de estoque |

Templates de decisão humana vão para `.local-data/veridi/overrides/` e
**nunca são sobrescritos** — decisão registrada não se perde.

## 5. Revisar findings

| Severidade | Significado |
| --- | --- |
| `BLOCKING` | A linha não entra. O resto da migração continua. |
| `REVIEW` | Entrou o que era seguro; alguém precisa revisar depois. |
| `INFO` | Transformação conhecida e aceita. |
| `EXCLUDED_BY_POLICY` | Deliberadamente fora desta migração. |

Um dado ruim nunca impede os bons: 3 CNPJ inválidos não bloqueiam 77
clientes.

## 6. Overrides

Decisões humanas ficam em CSV, sem tela e sem estado escondido:

| Arquivo | Para quê | Ações |
| --- | --- | --- |
| `item-map-overrides.csv` | Códigos de item usados em preços que não existem no cadastro | `MAP` (apontar para item existente) / `IGNORE` |
| `supplier-price-uom-overrides.csv` | Preço por kg em item contado por unidade | `MAP_UOM` / `IGNORE_PRICE` |
| `sample-project-overrides.csv` | Amostras sem projeto inequívoco | `MAP` / `IGNORE` |

Nenhum override cria master data. `MAP` só aponta para algo que já existe —
uma linha de preço isolada não é fonte suficiente para criar um Item, e
converter R$/kg em R$/un exigiria um peso por unidade que ninguém tem.

Depois de editar overrides, rode `plan` de novo.

## 7. Apply

```
pnpm veridi:import:apply -- --apply
```

Três guardas antes de qualquer escrita:

1. `--apply` explícito;
2. plano existente **e** fonte com o mesmo SHA-256 — se um CSV mudou depois
   do `plan`, o comando aborta e pede `validate` + `plan` de novo;
3. alvo de produção exige, além do `--apply`:
   ```
   VERIDI_ALLOW_PRODUCTION_IMPORT=true
   pnpm veridi:import:apply -- --apply --confirm-database=<nome_do_banco>
   ```

Ordem aplicada: unidades → fornecedores → clientes → itens → produtos e
itens de produto acabado → formulações → projetos → orçamentos legados →
amostras resolvidas → item × fornecedor → ofertas.

Saem também os de-para (`customer-map.csv`, `item-map.csv`,
`product-map.csv`, `supplier-map.csv`, `project-map.csv`, `sample-map.csv`,
`supplier-item-map.csv`) — só em `.local-data`, para conferência humana.

## 8. Verify

```
pnpm veridi:import:verify
```

Consulta o **banco** (não as contagens do importador) e valida invariantes:
produto com item de produto acabado, no máximo uma formulação ACTIVE por
produto, projeto e produto ligados com o mesmo cliente, um único fornecedor
preferencial por item, nenhuma oferta legada vigente, códigos legados
preservados e — a mais importante — **nenhum movimento de estoque criado
pela importação de cadastro**.

Sai `verify-summary.json`. Falha (exit 1) se alguma invariante quebrar.

## 9. Abertura de estoque

A planilha traz saldo **agregado por item**; o ERP controla estoque por item
**e lote**. Inventar lote destruiria a rastreabilidade, então a abertura é
manual na parte que importa:

1. abra `.local-data/veridi/out/opening-inventory-template.csv`;
2. para cada item, informe os lotes físicos reais: quantidade, lote do
   fornecedor/lote Veridi, validade, localização, `qualityStatus`,
   `ownerType` (e `ownerCustomerCode` quando o material for do cliente) e a
   `cutoverDate`;
3. a soma das linhas precisa bater com `expectedLegacyTotal`;
4. valide e aplique:

```
pnpm veridi:opening-stock:validate
pnpm veridi:opening-stock:apply
```

Regras:

- o código interno do lote (`LT-…`) é **gerado pelo ERP**;
- o movimento é `OPENING_BALANCE`: não é recebimento de compra, não é
  produção e não é ajuste;
- sem `qualityStatus` explícito o lote nasce `AWAITING_RELEASE` — nunca
  disponível por omissão;
- `coaStatus=APPROVED` é recusado: laudo aprovado exige documento anexado e
  aprovação da Qualidade;
- saldo negativo ou zerado nunca entra;
- item que controla lote exige identificação de lote;
- cada linha tem chave estável: reaplicar não duplica estoque;
- correção posterior é Inventário Físico/Ajuste normal — a abertura não se
  repete.

## 10. Cutover

Até a data de corte, o Excel é o histórico legado. A partir do
`OPENING_BALANCE` aplicado, **o ERP é a fonte de verdade operacional**:
compras, produção, consumo, expedição e faturamento acontecem no sistema.

Documente a data de corte e comunique a equipe: conviver com as duas
fontes é o que trava migração.

## 11. O que NÃO é importado

| Fonte | Decisão |
| --- | --- |
| `compras_recebimentos.csv` | Não vira Receipt nem ledger. Temos as entradas históricas, mas não as saídas correspondentes: importá-las inflaria o On Hand. Também não se cria "Receipt sem efeito" — no domínio atual, recebimento confirmado significa entrada física real. Usado para conferência (inclusive estatística de laudo). |
| `estoque_saldos.csv` | Vira template de abertura. Negativo e ilegível nunca migram. |
| `cmv_*.csv` | Bloco G (custeio industrial). Só estrutura validada. |
| `in28_limites.csv` | Bloco H (regulatório) — continua gate. |
| Usuários | O corpus não tem colaboradores confiáveis. Nenhum usuário é criado por nome livre de planilha; o ADMIN inicial vem do bootstrap. |
| Revisão/data de documento controlado (R.PRO.002, R.COQ.003) | Sem dado oficial. O importador não inventa. |

## 12. Correções e roll-forward

Depois que o ERP começar a operar **não existe rollback mágico**: o caminho
é corrigir para frente, com documento auditável (ajuste de inventário,
edição do cadastro, nova versão de formulação).

Antes do cutover, o rollback é o backup do banco — por isso ele é
obrigatório antes do APPLY.

Reimportar é seguro: o processo é idempotente e não sobrescreve registro
que o ERP editou depois (isso vira finding `EXISTING_MANUAL_RECORD`, não
sobrescrita silenciosa).

---

## Aliases antigos

`pnpm veridi:data:validate` e `pnpm veridi:data:seed` continuam existindo
para não quebrar hábito antigo. `veridi:data:seed` executa **o mesmo
pipeline** do importador oficial — não existe uma segunda implementação.

## Política de dados históricos

Duas decisões que a auditoria VAL-LEG-01 forçou a explicitar. Ambas nascem da
mesma regra: o importador registra o que a planilha diz, e nunca melhora o
dado para ele caber.

### Validade: datas históricas são preservadas

**O importador nunca renova validade.** Um lote com validade 09/09/2023
continua com 09/09/2023 depois de importado, e portanto continua vencido.

Isso é inconveniente de propósito. Deslocar a data para o futuro tornaria o
lote utilizável, e a produção consumiria material vencido sem que ninguém
tivesse decidido isso — a decisão de aceitar, descartar ou reanalisar é da
Qualidade, não de um script de migração.

Os dois contextos não se misturam:

| | Validade |
|---|---|
| Importação histórica | preservada como está; lote vencido segue vencido |
| Simulação / validação | data futura pode ser criada, explicitamente, pelo operador — e classificada como SINTÉTICA |

O saldo inicial pode entrar com lote vencido, mas nunca como `AVAILABLE`: a
validação recusa com `EXPIRED_OPENING_LOT` e pede `AWAITING_RELEASE` ou
`BLOCKED`. O saldo existe; a disponibilidade é que não se presume.

### Endereço: decomposição conservadora, sem falsa precisão

O legado guarda o endereço numa string só — "Rua Vicente José de Almeida, n°
158, bairro Cupece" — e o ERP tem Logradouro, Número e Bairro separados.

`scripts/veridi-data/legacy-address.ts` resolve os padrões que o corpus
realmente usa:

- logradouro: só a primeira parte, e só quando começa com um tipo conhecido
  (Rua, Av., Travessa, Rodovia…);
- número: rotulado (`n°`, `nº`, `no`, `num`, `número`) ou uma parte que seja
  apenas dígitos. "Km 13" e "Apto 42" não são número de porta;
- bairro: **só quando vem rotulado**. Heurística posicional erra em endereço
  com complemento, e complemento é o que mais aparece no cadastro antigo.

Nos 80 clientes do corpus: 1 sem endereço, 65 começam com logradouro
reconhecível, 66 têm número rotulado e 69 têm bairro rotulado. O resto vai
para revisão.

**O que não dá para afirmar fica `null`** e gera
`ADDRESS_PARSE_REVIEW_REQUIRED` no plano, com o texto original junto. Nada de
`S/N`, número `0` ou bairro "desconhecido": campo que parece respondido não é
revisitado, e um cadastro errado com aparência de completo é pior que um
campo vazio.

A string original continua preservada nas notas de migração — é ela que
alguém vai ler para decidir os casos duvidosos.

