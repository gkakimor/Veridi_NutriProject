# Backlog atual

Pendências reais e o que decidir sobre cada uma. Roadmap futuro, histórico de
auditoria e regras duráveis vivem em outros arquivos — ver [Referências](#referências).

**Release congelada:** `9a653a0` · **Próximo gate:** validação com a Veridi.

---

## Estado

| Severidade | Abertos |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 7 |

Nada operacional aberto. As três auditorias profundas (VAL-LEG-01, 02, 03), o
hardening pré-cliente e o polimento visual estão fechados — findings e
correções em [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md).

---

## Pendências abertas

### 1. Rótulos de ação divergentes entre telas — LOW

"Criar item", "Criar relação", "Criar fornecedor", "Salvar", "Registrar
tarifa", "Salvar rascunho", "Salvar base". Cada tela pede ao operador que
reaprenda qual botão confirma.

**Decisão / próxima ação:** uma passada de nomenclatura, não redesign. Definir o
vocabulário de commit e aplicar. Nenhum operador levantou isso nos três casos —
candidato natural a entrar depois do feedback da Veridi, que pode mudar o
vocabulário escolhido.

### 2. Diálogo de confirmação repete o rótulo de quem o abriu — LOW

"Ativar versão" abria diálogo cujo confirmar também era "Ativar versão"; idem
"Confirmar OC", "Confirmar recebimento" e "Ativar estrutura". O texto do
diálogo é bom — diz o que se torna imutável. Ambíguo é só o rótulo do botão.

**Estado parcial, sem fechamento comprovado:** hoje a maioria dos diálogos já
usa verbo curto ("Ativar", "Confirmar", "Liberar", "Inativar"), mas
`IndustrialResourceDetailPage`, `CancelProjectDialog` e `ApprovalPreviewDialog`
ainda repetem o rótulo inteiro. Não marcado como resolvido: a correção nunca
foi feita como passada deliberada.

**Decisão / próxima ação:** mesma passada de nomenclatura do item 1.

### 3. `pnpm test` quebra de forma intermitente no monorepo — LOW

Rodando api e web juntos, a suíte às vezes morre com
`Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` no encerramento dos workers
do vitest. Nenhuma asserção falha — as suítes passam inteiras quando rodadas
uma a uma. Reproduzido também em `96e2c07`, antes das mudanças de Cliente:
é anterior, não regressão.

**Decisão / próxima ação:** rodar as suítes separadas quando o gate precisar
ser confiável. Se incomodar, reduzir `maxWorkers` ou serializar os pacotes no
script `test` da raiz.

### 4. Aba Produção na Consulta do Cliente — candidato para próxima FAST

A Consulta do Cliente entregou Resumo, Projetos, Pedidos, Materiais e
Faturamentos. Produção ficou de fora: `GET /production-orders` não aceita
`customerId` (a coluna existe e é snapshot, o filtro é que não) e
`toProductionOrderDTO` faz três consultas extras por OP — vinte linhas
custariam cerca de sessenta consultas. Uma aba honesta exige read model
próprio, não um filtro colado no endpoint atual.

OPs geradas por um Pedido já aparecem no detalhe consultivo daquele Pedido,
então a informação não está inacessível — falta o corte por Cliente.

**Decisão / próxima ação:** promover como rodada curta própria, se o
acompanhamento por Cliente pedir Produção depois da validação com a Veridi.

### 5. Smoke autenticado em produção — pendente em duas rodadas — LOW

Nem a rodada do **cadastro de Cliente** (`cab5bf3`) nem a da **Consulta do
Cliente** (`7cd61f2`) tiveram smoke autenticado em produção. Nos dois casos o
deploy subiu e `/health` respondeu 200; o que falta é percorrer as telas com
sessão real.

As contas DEMO de produção existem em `.local-data/prod-demo.json`, mas login
em produção com senha armazenada é ação de quem opera, não do agente.

**Decisão / próxima ação:** rodar os dois roteiros, ambos somente leitura,
exceto onde indicado.

- *Cliente:* e-mail inválido rejeitado, telefone curto rejeitado, CNPJ válido
  aceito, CEP preenchendo endereço, salvar, conferir os metadados de autoria,
  inativar o cliente de teste pelo fluxo oficial.
- *Consulta do Cliente:* Gestão › Consulta de Cliente, buscar um cliente
  existente, abrir, Projetos, abrir um projeto, voltar pela trilha, Pedidos,
  Materiais, Faturamentos. Nada é criado.

### 6. Produtos do legado sem cliente e itens acabados órfãos — LOW

Diagnóstico feito na rodada de Produto + item de produto acabado, sobre a
base de desenvolvimento com o corpus legado importado:

- **348 dos 661 produtos não têm cliente**, todos ativos, e **91 já estão em
  uso** em pedido, ordem de produção ou orçamento;
- **8 produtos sem item de produto acabado** — todos são fixtures de teste
  antigas, não corpus real;
- **54 itens de produto acabado órfãos**, sem produto nenhum apontando para
  eles;
- zero item compartilhado entre produtos e zero divergência entre o cliente
  do produto e o do projeto de origem.

A regra nova vale só na criação, então nada disso bloqueia operação nem
edição. Não foi corrigido automaticamente: atribuir cliente a um produto em
uso é decisão de negócio, não de migração.

**Decisão / próxima ação:** decidir com a Veridi se vale um saneamento — a
quem pertencem os 348 — ou se eles ficam como estão, já que o histórico
deles é anterior ao sistema. Os 54 itens órfãos são candidatos a inativação,
não a exclusão.

### 7. O schema Prisma não descreve as ações de delete reais — LOW

Ao limpar o banco de produção, a ordem de remoção derivada do
`schema.prisma` quebrou: várias relações aparecem como opcionais ali — o que
sugeriria `SET NULL` —, mas as migrations criaram **`ON DELETE RESTRICT`** no
banco. A limpeza só passou calculando a ordem por ordenação topológica sobre
`pg_constraint`, que é a fonte da verdade.

Não afeta operação: o comportamento correto é o do banco, e ele está certo.
Afeta quem for escrever script de manutenção ou raciocinar sobre cascata
lendo o schema.

**Decisão / próxima ação:** nenhuma ação obrigatória. Se alguém for mexer em
relação com deleção, conferir `pg_constraint` antes de confiar no schema.

### 8. Bolha do InfoHint dentro de tabela rolável — LOW

O `InfoHint` posiciona a bolha em `position: absolute`. Nos cabeçalhos da
tabela de impacto de material do Plano de Atendimento, o ancestral
`.table-container` tem `overflow-x: auto`, que também recorta o eixo Y — com
poucas linhas na tabela a bolha pode aparecer cortada.

Não reproduzido: os cinco ⓘ abriram corretamente na validação em 1280, 1366
e 1600. Fica registrado porque a condição existe no CSS.

**Decisão / próxima ação:** se aparecer, dar folga vertical ao container ou
tratar `.info-hint__bubble` dentro de tabela. Verificar com tabela de uma
linha só.

### Decisões de produto em aberto — não bloqueantes

Herdadas de `PROJECT_STATE.md`, trazidas para cá para terem fonte única. Nenhuma
impede operação; cada uma tem hoje um padrão em uso que ninguém formalizou.

- algoritmo do número de lote automático de produto acabado;
- limiar exato do aviso de validade próxima;
- permissões detalhadas por papel;
- regras exatas de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- dimensões finais da etiqueta e impressora;
- se toda classe de item exige validade;
- provedor de armazenamento de arquivos em produção.

**Decisão / próxima ação:** boa pauta para a validação com a Veridi — a maioria
depende da prática real da casa, não de escolha técnica.

---

## Próximo gate

**Validação com a Veridi.** Nenhum desenvolvimento novo até a reunião acontecer
e o feedback ser classificado. Roteiro da sessão e grade de classificação em
[ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md).

Os três LOW acima não bloqueiam a validação e não devem ser corrigidos durante
a reunião.

---

## Mudanças de status desta revisão

Duas MEDIUM de política de migração estavam listadas como abertas e **já
estavam resolvidas** — a entrada era obsoleta, não pendência.

- **Endereço legado em linha única** e **validades legadas no passado**:
  decididos e implementados em `377a5d9` (*feat: validate legacy address and
  expiry migration*, 2026-08-20), com testes. O backlog foi fechado em
  `92c4ed2` (2026-08-22) ainda os listando como abertos.
- Prova: `scripts/veridi-data/legacy-address.ts` (decomposição conservadora,
  `ADDRESS_PARSE_REVIEW_REQUIRED`), `scripts/veridi-import/opening-stock.ts`
  (`EXPIRED_OPENING_LOT`), regra em [PRODUCT_RULES.md](PRODUCT_RULES.md) §38,
  política em [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md).

Se Product Ownership quiser política diferente, isso é pedido de mudança — não
pendência herdada.

---

## Referências

- **Decisões de domínio:** [PRODUCT_RULES.md](PRODUCT_RULES.md) — inclui a
  decisão deliberada de que compra não depende de aprovação de projeto (§38).
- **Política de migração:** [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md)
- **Valor futuro mapeado:** [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) — não
  ler nem implementar automaticamente.
- **Histórico de findings:** [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md)
  — não carregar no trabalho cotidiano.
- **Estado atual do projeto:** [PROJECT_STATE.md](PROJECT_STATE.md)
