# Auditoria de produto — gate pós-Bloco G

Auditoria executada em 2026-08-16/17 sobre o produto inteiro depois dos Blocos F
e G. **Não é uma capacidade nova**: nada de Bloco H, regulatório, rotulagem ou
módulo novo foi implementado aqui.

Método: cenário sintético completo executado ponta a ponta pela API e pela UI
(criado e removido ao final — o corpus real nunca foi alterado), varredura de
telas e relatórios em Chromium, sondas de erro intencionais, matriz de papéis e
reexecução dos scripts de corpus.

Só entram aqui **problemas observados**. Onde o comportamento está correto, isso
está registrado como evidência, não como elogio.

---

## 1. Resultado técnico geral

| Verificação | Resultado |
|---|---|
| Cenário funcional ponta a ponta (26 asserções) | **26/26 OK** |
| Sondas de erro intencionais | 8/8 recusadas com mensagem acionável |
| Telas e relatórios visitados (Chromium) | 37 · todas HTTP 200 · nenhuma vazia |
| Erros HTTP 5xx durante a varredura | **0** |
| Requisições a hosts externos | **0** (só 127.0.0.1) |
| Erros de console | 8, todos do mesmo defeito (corrigido — ver F-08) |
| `pnpm typecheck` | limpo |
| `pnpm test` | ver seção 12 |
| `pnpm build` | ver seção 12 |
| Corpus (`validate` / `plan` / `verify`) | baselines preservados, plano idempotente (+0), 10/10 checagens de integridade OK |

O fluxo comercial completo (projeto → produto técnico → formulação → estrutura
de custos → CALC → precificação → faixa → orçamento → envio → aceite →
aprovação → pedido → OP → picking → produção → lote de PA → expedição →
faturamento → rastreabilidade) **foi executado inteiro, sem workaround**.

---

## 2. Findings

Severidades conforme o gate: CRITICAL (corrupção, cross-customer, rastreabilidade,
custo errado silencioso, confidencialidade, fluxo principal impossível), HIGH
(fluxo principal exige workaround ou conhecimento prévio relevante), MEDIUM
(atrito recorrente), LOW (polimento).

### CRITICAL

**Nenhum.** Nenhuma corrupção de estoque, vazamento entre clientes, quebra de
rastreabilidade, custo silenciosamente errado, vazamento de confidencialidade
nem fluxo principal impossível **no motor**. Os bloqueios encontrados foram de
interface e estão listados abaixo — todos corrigidos ou registrados.

### HIGH

| ID | Finding | Evidência | Situação |
|---|---|---|---|
| F-01 | **Seletores de tela carregavam no máximo 100 registros.** Com 478 matérias-primas, 214 produtos e 113 fornecedores, a maior parte do catálogo era **impossível de escolher pela UI** — formulação, nova OC, pedido, OP, amostra e filtros de relatório | `GET /items?pageSize=100` devolvia 100 de 478; `FOR-000903` não aparecia em nenhum `<select>` de fornecedor | **corrigido**: teto das listagens usadas por seletor foi para 1000 e as telas passaram a pedir o catálogo inteiro (verificado: 113/113 fornecedores, 214/214 produtos, 478/478 matérias-primas, 108/108 clientes) |
| F-02 | **Cadastro travava quando um campo opcional ficava em branco.** O formulário envia `null`; o schema aceitava só `undefined` ou `""` | `POST /projects` com `concept/channel/externalCode/notes = null` → 400 `Expected string, received null` | **corrigido** em `optionalNullableText` (helper compartilhado por projetos, clientes, fornecedores, pedidos, faturamento) + teste de regressão |
| F-03 | **"Abrir formulação" no projeto levava a "Produto não encontrado"** — a rota recebia o id da versão de formulação onde espera o id do produto | `/producao/formulacoes/{formulationVersionId}` | **corrigido** (regressão introduzida na capacidade 47) |
| F-04 | **Criar a primeira estrutura de custos era um beco sem saída** para produto sem lote mínimo — o botão exigia a base de produção e a tela não oferecia campo. Atinge os 214 produtos legados, todos sem `minimumBatchQuantity` | `POST /products/:id/industrial-costs` sem corpo → "Informe a base de produção" | **corrigido**: campo "Base de produção" antes de criar; a regra de nunca assumir 1000 continua valendo |
| F-05 | **Ações de produção gravam "Ambiente local" no lugar do usuário.** Consumo, apontamento de produção, conclusão e picking atribuem a um ator de sistema; só a pesagem da Folha de Receita registra quem executou | OP-010725 e OP-010726, campo USUÁRIO | **parcialmente corrigido**: o consumo passou a registrar quem confirmou. Picking, saída de produção, conclusão e planejamento continuam com o ator de sistema — a correção exige levar o usuário autenticado a quatro serviços e revisar os campos de auditoria; ficou como item de backlog, não como ajuste de fim de gate |
| F-06 | **R-19 e R-20 perdem colunas no papel** — 1319 px e 1398 px de conteúdo em 1047 px úteis de A4 paisagem | medido com `emulateMedia("print")` | **não corrigido**: exige decidir quais colunas vão para o papel. R-18 e a Folha de Receita foram corrigidos |

### MEDIUM

| ID | Finding | Evidência | Situação |
|---|---|---|---|
| F-07 | Modais de cadastro não recebiam foco nem prendiam o Tab: operação só por teclado não editava item, produto, fornecedor ou cliente | `document.activeElement` permanecia na linha da tabela | **corrigido** |
| F-08 | R-13 e R-17 tinham duas colunas "Pedido" (código e quantidade), com aviso de chave duplicada no React | 4 avisos por carga | **corrigido** ("Qtd. pedida" + chave por índice) |
| F-09 | Folha de contagem FO-01 listava material de propriedade do cliente sem identificar o dono, junto do material da Veridi | `ME-000545` na FO-01 | **corrigido** (coluna "Proprietário", padrão que FO-02 e FO-03 já usavam) |
| F-10 | Diálogo "Liberar lote" afirma que o lote ficará disponível mesmo com laudo pendente; o backend recusa depois, corretamente | `400 coa_not_approved` após o diálogo | **não corrigido** — backlog |
| F-11 | Falta de material vista na OP e no R-04 não leva à sugestão de compra, que só existe dentro do Pedido em atendimento | OP-006627 e `/relatorios/producao/necessidades` | **não corrigido** — backlog |
| F-12 | Banco de desenvolvimento acumula **1.673 usuários `teste-*`** (1.269 ADMIN) criados pela suíte de testes, contra 1 usuário real; a suíte compartilha o banco com o ambiente de desenvolvimento e deixa resíduo (28 clientes e 2 projetos ficaram para trás nesta rodada, removidos manualmente) | `GET /users`; contagens do corpus | **não corrigido** — é higiene de ambiente e isolamento de testes |
| F-13 | 80 itens têm o texto legado `**` gravado em "nutriente declarado" — placeholder da planilha importado literalmente (92 linhas em `itens_enriquecimento.csv`) | `Item.declaredNutrient = "**"` | **não corrigido**: decidir com a Veridi o que `**` significava. Classificar por inferência é proibido |
| F-14 | Busca do topo prometia "lote, item, OP" mas só resolve lote, e o erro dizia `Lote "MP-002876" não encontrado` | `AppShell.handleSearchSubmit` chama apenas `lookupLot` | **corrigido no texto** (promete só lote); busca global de item/OP é backlog |

### LOW

| ID | Finding | Situação |
|---|---|---|
| F-15 | "← Voltar" da impressão do orçamento usava o id da versão como se fosse o do projeto | corrigido |
| F-16 | Impressão da Estrutura de Custos escrevia tarifas com ponto decimal ("R$ 0.85 / kWh") num documento em pt-BR | corrigido |
| F-17 | Enter no menu "⋯" abria o cadastro em vez do menu (a linha capturava a tecla); Escape jogava o foco no `body` | corrigido |
| F-18 | Cabeçalho de tabela e dica de campo em contraste 2,84:1 | corrigido nesses dois seletores (5,19:1); demais usos de `--ink-3` viram backlog |
| F-19 | Estado vazio de amostras prometia "Nova amostra" mesmo com o botão oculto por status | corrigido |
| F-20 | Seção "Materiais Reservados" de OP concluída dizia "(OP cancelada)" | corrigido |
| F-21 | Posição de estoque abria com 20 linhas zeradas (só 5 dos 824 itens têm saldo) | corrigido (quem tem posição vem primeiro; nada escondido) |
| F-22 | Busca do hub de relatórios era sensível a acento e só casava substring | corrigido (sem acento, por palavra) |
| F-23 | Data padrão do recebimento apareceu um dia atrás do dia corrente numa observação de auditoria (suspeita de fuso) | **não confirmado** — registrado para investigação |

## 3. Fluxo comercial (gate §6 e §7)

Executado com projeto novo, cliente novo e produto novo:

- produto técnico criado em `DEVELOPMENT`; **preparar de novo devolve o mesmo
  produto** (idempotente) e **não muda o status do projeto** (`WAITING`);
- produto em desenvolvimento é **recusado** em pedido de cliente:
  `product_not_operational` — *"O produto PROD-… está em desenvolvimento e ainda
  não pode ser usado em operação comercial ou industrial. Aprove o projeto…"*;
- cálculo salvo `CALC-000378`, qualidade `COMPLETE_REAL_REFERENCE`,
  custo/unidade 4,8145;
- precificação com duas faixas ativas: 500 un a 9,344167 e 1000 un a 8,024167 —
  **o ganho de escala aparece** porque o custo fixo se dilui;
- faixa de 500 un recusada para orçamento de 700 un (`quantity_mismatch`), com
  a explicação de que faixa é cenário econômico fechado;
- preço vindo de faixa **não pode ser editado** (`price_locked`);
- envio congelou a proveniência: `PREC-000304` · `CALC-000378` · custo/un
  5,6065 (custo da faixa de 500 un, diferente do custo de referência de 1000 un
  — comportamento correto, não divergência);
- aprovação promoveu **o mesmo produto** (mesmo id, mesmo código, lifecycle
  `APPROVED`), e a comparação antes/depois da aprovação mostrou **a mesma
  formulação e a mesma estrutura de custos** — nada foi duplicado ou recriado;
- **orçamento manual** (§7) percorreu envio → aceite → aprovação do projeto sem
  nenhuma precificação estruturada: o preço de exceção continua legítimo.

## 4. Amostras (gate §8)

T1 criada, consumo de lote registrado, produzida e **reprovada**; T2 criada,
produzida e **aprovada**. Depois disso o projeto continua em `SAMPLE` —
**aprovar a amostra não aprova o projeto**, como manda a regra.

## 5. Compras e Qualidade (gate §9 e §10)

- item × fornecedor homologado (`APPROVED`) e marcado preferencial, com oferta
  de preço e pedido mínimo;
- OC com três linhas → confirmada → **recebimento parcial** (25 de 40 kg):
  a OC ficou `PARTIALLY_RECEIVED` e a linha guarda o saldo remanescente;
- lote de item que exige laudo nasce `AWAITING_RELEASE` com CoA `PENDING`;
- liberar antes do laudo é recusado (`coa_not_approved`);
- aprovar o laudo **sem documento anexado** é recusado
  (`missing_coa_document` — *"Anexe o CoA antes de aprovar."*);
- com o CoA anexado e aprovado, a liberação leva o lote a `AVAILABLE`;
- OC para fornecedor inativo é recusada (`inactive_supplier`).

CoA aprovado e liberação de qualidade continuam sendo **duas decisões
distintas** — nenhuma acontece automaticamente por causa da outra.

## 6. Material de propriedade do cliente (gate §11)

- recebimento `customer-supplied` para o cliente A e para o cliente B do **mesmo
  item**, gerando dois lotes com `ownerType = CUSTOMER`;
- a OP de um produto do cliente A reservou **exatamente o lote do cliente A**;
- tentar substituir pelo lote do cliente B é recusado:
  `alternate_lot_owner_mismatch` — *"Lote LT-… pertence a outro proprietário —
  esta necessidade só aceita material de cliente desta OP."*

Nenhum caminho de mistura entre clientes foi encontrado.

## 7. Produção e custo da OP (gate §12 e §13)

- o plano de atendimento do pedido **criou a OP ligada ao pedido**;
- liberação gerou número oficial (`3449/26`) e três necessidades com reserva;
- picking confirmado lote a lote, consumo registrado, saída de 500 un para lote
  novo, OP concluída (`COMPLETED`);
- o lote de produto acabado nasce `AWAITING_RELEASE` — a Qualidade precisa
  liberar antes de reservar/expedir;
- reservar mais do que existe é recusado com o saldo no texto
  (`excessive_reserve_request` — *"máximo 500"*).

**Custo da OP:** materiais reais (`costSource: "REAL"`, custo do lote consumido
na data do consumo) somados a custos industriais **padrão aplicados** — os
campos são literalmente `standardApplied*`, com `allocationFactor 0,5` (500 un
produzidas sobre lote de referência de 1000 un). Não há campo, rótulo ou total
que afirme hora ou energia **medida**. Estrutura conferida:
`actualMaterialCostKnown 1.990,00` + `standardAppliedCostKnown 417,25` =
`knownSubtotal 2.407,25`, custo/unidade 4,8145.

## 8. Expedição, faturamento, estoque e rastreabilidade (§14, §15, §16)

- expedição parcial (200 de 500) confirmada com verificação de lote linha a
  linha; pedido foi para `PARTIALLY_SHIPPED`;
- faturamento gerado **a partir da expedição confirmada** e emitido
  (`FAT-001721` · `ISSUED`);
- estoque do insumo bate: 25 recebidos − 10 consumidos = **15 em mãos**,
  0 reservado, 15 disponível, **15 em compra** (saldo da OC parcial);
- rastreabilidade do lote de produto acabado cita a OP e os lotes de
  matéria-prima consumidos.

## 9. Confidencialidade e papéis (§26 e §40)

Sem autenticação, todas as rotas testadas respondem **401** (itens, projetos,
dashboard, usuários, estoque, lotes, relatório comercial e download de anexo).

Matriz observada (usuários criados só para a auditoria e removidos depois):

| Papel | Dashboard | Produtos | R-20 (orçamento × precificação) | Proveniência econômica no orçamento | Aprovar CoA | Criar usuário |
|---|---|---|---|---|---|---|
| COMMERCIAL | 200 | 200 | **200** | **sim** | 403 | 403 |
| PRODUCTION | 200 | 200 | **403** | não | 403 | 403 |
| QUALITY | 200 | 200 | **403** | não | 400 (erro de negócio, não de permissão) | 403 |
| PURCHASING | 200 | 200 | **403** | não | 403 | 403 |
| VIEWER | 200 | 200 | **403** | não | 403 | 403 |

Documentos impressos:

- **orçamento do cliente**: nenhuma ocorrência de custo, margem, markup,
  comissão, `CALC-` ou `PREC-`; traz "Documento comercial — não é documento
  fiscal";
- **R-20**: marcado *"Documento interno. Contém custo e margem — não é o
  orçamento entregue ao cliente."*

## 10. Relatórios e desempenho (§27 e §41)

Os 20 relatórios (R-01 a R-20) carregam com HTTP 200, nenhum vazio, nenhum
erro 5xx. O hub lista os quatro grupos.

Tempos de resposta da API com o corpus real (mediana de uma passada):

| Consulta | Tempo |
|---|---|
| itens (50 / 100 por página) | 20 ms / 7 ms |
| projetos (50) | 35 ms |
| item × fornecedor (50) | 24 ms |
| posição de estoque | 42 ms |
| dashboard | 30 ms |
| lotes (50) · movimentações (50) | 18 ms · 14 ms |
| fila de laudos · faturamento pendente | 15 ms · 12 ms |

Nenhum problema de desempenho perceptível ao usuário foi observado.

## 11. Corpus e migração (§28, §29, §30)

`pnpm veridi:import:validate`, `plan` e `verify` reexecutados. Baselines **iguais
aos esperados**:

| Baseline | Esperado | Observado |
|---|---|---|
| Formulações (motor × histórico) | 26 / 26 / 0 | **26 / 26 / 0** |
| CMV (comparáveis / match / divergentes / insuficientes) | 6 / 0 / 6 / 46 | **6 / 0 / 6 / 46** |
| Precificação histórica | 27 linhas / 9 produtos | **27 / 9** |
| Qualidade documental (linhas / SIM / NÃO / vazio) | 829 / 265 / 14 / 550 | **829 / 265 / 14 / 550** |
| Estoque legado (positivos / zerados / negativos / ilegíveis) | — | 106 / 316 / 103 / 9 |
| Rastreabilidade comercial | — | 248 projetos · 214 com produto · 34 sem produto técnico · 9 orçamentos, todos manuais/legados |

`plan` continua idempotente (`+0` em todas as entidades) e `verify` passou nas
10 checagens de integridade.

Os findings listados no gate §30 **não foram tocados**: razão ~1,2 do CMV,
8 produtos de CMV sem match, 60 códigos de item, 86 UOM de preço, 29 amostras,
saldos de abertura, CNPJ, revisões do R.PRO.002 e do R.COQ.003.

## 12. Testes, typecheck e build (§42)

- `pnpm typecheck`: limpo (shared, api, web).
- `pnpm test`: **599 testes da API + 25 de web + 14 de scripts, todos passando**
  depois das correções.
- `pnpm build`: OK (shared, api, web).
- **Um teste novo**: `POST /projects` com campos opcionais em `null` (F-02),
  incluindo a garantia de que `null` continua limpando o campo em atualização.
  Nenhuma outra correção mudou regra de negócio, e por isso não gerou teste.

## 13. O que ficou fora deste gate

Registrado como backlog, não implementado aqui:

- **Bloco H** (regulatório, IN 28, rotulagem) — hard gate; o inventário de dados
  e as 15 perguntas estão em `docs/BLOCK_H_VALIDATION.md`;
- **atribuição de usuário nas ações de produção** (F-05): levar o usuário
  autenticado a picking, apontamento, conclusão e planejamento;
- **colunas de R-19 e R-20 no papel** (F-06);
- **seletor com busca no servidor** — o teto de 1000 registros resolve hoje
  (795 itens), mas não é a solução definitiva;
- **ponte da falta de material para a sugestão de compra** (F-11);
- isolamento do banco de testes e limpeza dos 1.673 usuários `teste-*` (F-12);
- decisão sobre o placeholder `**` em nutriente declarado (F-13);
- busca global por item e OP (F-14);
- qualquer redesign de UX que não caiba em ajuste pequeno — ver a seção de
  backlog de `docs/UX_AUDIT.md`.
