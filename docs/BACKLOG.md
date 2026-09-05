# Backlog

O que está **aberto**, consolidado com o Product Owner em 2026-09-04 após o
Repository Baseline v2, a referência manual de custo, a revisão global do
"Como funciona", o reparo da reconstrução de migrations e o deploy de
`main @ ffee5c6`.

Achado fechado não fica aqui. O que virou regra está em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md); o que cada rodada descobriu está em
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md); onde
cada regra é protegida está em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md);
escopo futuro vive só em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

**Próxima rodada, quando o PO autorizar:** #12 + #9 + #3 + #4 + #5 —
consistência de custos, explicabilidade matemática e UX da Formulação.

---

## A. Defeitos abertos

### 12. Formulação — estimativa de custo deve usar o seletor canônico de fonte — PRÓXIMA RODADA

`FormulationVersionPage` lê `getFormulationCostEstimate`, que usa só a fundação
de compras (30d → 90d → última compra) e ignora oferta válida e referência
manual. O CMV e o cálculo padrão usam a seleção canônica completa (§53), então
Formulação e CMV podem mostrar custos diferentes para o mesmo material na mesma
data.

**Decisão de PO.** Toda funcionalidade que responda "quanto custa este material
nesta data?" usa a **mesma** regra canônica, nesta ordem obrigatória:

1. compra real dos últimos 30 dias;
2. compra real dos últimos 90 dias;
3. última compra real;
4. oferta válida de fornecedor;
5. referência manual de custo;
6. desconhecido.

Ambiguidade em categoria superior é **fail-closed**: várias ofertas válidas sem
preferencial não caem para a referência manual. Material do cliente
(customer-owned) continua com custo de aquisição Veridi **não aplicável**. Não
criar segundo seletor: reusar `selectItemCostSource` (ou a fonte canônica
equivalente) e ampliar a taxonomia `CostSource` do serviço.

Severidade técnica original LOW; prioridade de produto **alta** — consistência.

### 3. Formulação — validação inline por componente — MEDIUM

Os campos de cada componente não têm tratamento completo de erro contextual:
falta `aria-invalid` no campo inválido, mensagem associada ao campo,
identificação clara do componente e foco ou rolagem até o primeiro erro
relevante — tudo com acessibilidade preservada. `basisQuantity` e
`dosesPerPackage` já fazem isso. Risco reduzido: a mensagem cita o código do
item. **ABERTO** — próxima rodada de UX/Formulação.

### 4. Formulação — densidade horizontal da tabela de componentes — LOW

A tabela mede ≈1621px; em 1440×900 parte das colunas exige rolagem horizontal.
Melhor que os ≈1925px anteriores, e nenhuma informação crítica depende só das
colunas escondidas (o painel de ajustes mostra a quantidade física em texto).
Desejado: reduzir densidade sem esconder contexto, degradar legibilidade, criar
cards altos demais ou quebrar a edição rápida de formulações grandes.
**ABERTO** — mesma rodada de #3 e #5.

---

## B. Melhorias aprovadas

### 5. Formulação — nomenclatura dos modos de quantidade — DECIDIDO PELO PO, IMPLEMENTAÇÃO PENDENTE

Os rótulos atuais ("Quantidade física já ajustada" / "Calcular quantidade
física automaticamente") sugerem correção ativa mesmo sem flag marcada.
Substituir por:

- **Modo 1 — "Quantidade física informada"**: "A quantidade digitada já
  representa o material que será usado. Pureza e overage podem ser registrados,
  mas não alteram automaticamente a quantidade."
- **Modo 2 — "Calcular quantidade física"**: "Informe a quantidade teórica e
  escolha quais ajustes de pureza e overage devem ser aplicados."

Motivo: eliminar a ambiguidade de "já ajustada" e "automaticamente". LOW/UX —
próxima rodada, junto de #3 e #4.

### 9. `CalcHint` — conferência matemática desligada em alguns cálculos — LOW

"CMV por unidade" e "Preço sugerido" não passam `esperado`; Faturamento e dois
do CMV passam e conferem. **Decisão de PO:** ligar **somente** depois de provar
a matemática de cada caso contra o valor canônico — nunca passar `esperado`
para silenciar ou forçar resultado. `CalcHint` explica e reconcilia; não vira
segundo motor de domínio. "Lotes de referência" arredonda para cima, então a
conferência ali continua desligada. **ABERTO** — próxima rodada, junto de #12.

### 8. Cálculo ao vivo nas demais telas — subdividido

Padrão nascido na Formulação: valor derivado aparece enquanto se digita, a
conta vem da **mesma função** que a API usa, `CalcHint` mostra a aritmética,
premissa ausente vira travessão. Hoje no padrão: Faturamento, Formulação, CMV
e a prévia de política de preço.

- **#8A — MEDIUM — Ordem de Compra, total vivo inconsistente.**
  `purchase-orders/PurchaseOrderPage.tsx`: linhas recalculam ao digitar
  enquanto o rodapé mostra `orderTotal` da última gravação. Número vivo ao lado
  de número velho.
- **#8B — MEDIUM — Expedição, quantidade viva × total anterior.**
  `shipments/ShipmentPage.tsx`: "Expedindo agora" vem do read model e o Total do
  rodapé é conta do navegador, impresso cru, sem `formatQuantity`. O usuário
  compara valores de momentos diferentes.
- **#8C — MEDIUM — Precificação, prévia antes de gravar faixa.** Preço sugerido
  e margem só aparecem depois de `Adicionar faixa`. Desejado: prévia antes da
  persistência.
- **#8D — LOW/MEDIUM — Faturamento, override de preço.** Mostrar o total
  resultante antes de confirmar a alteração.
- **#8E — LOW — Recebimento, custo efetivo.** Mostrar total e comparação com o
  custo previsto quando aplicável.
- **#8F — LOW — Ficha de Pesagem.** Mostrar a diferença antes da confirmação.
- **#8G — A AUDITAR — Ordem de Produção, quantidade planejada.** Mudar a
  quantidade não atualiza a prévia das necessidades até salvar. Auditar a regra
  histórica/snapshot **antes** de alterar: nenhum cálculo vivo pode mutilar OP
  já congelada.
- **#8H — MEDIUM — Orçamento.** Campos não controlados mantêm o total anterior
  durante a digitação. Desejado: prévia coerente antes de salvar.

Também no radar, sem item próprio: Contagem de Estoque, Ordem de Compra,
Expedição e Reservar ↔ Produzir calculam ao vivo mas ainda sem `CalcHint`;
Custo Industrial e impacto de materiais do Pedido ficam em branco até apertar
botão sem dizer que o valor é do que está salvo.

---

## C. Decisões aguardando negócio

### 11. Material do cliente — lote do fabricante e validade por configuração do Item — MEDIUM

`receiving/ReceiveCustomerMaterialPage.tsx` aceita confirmar com "Lote do
fabricante" e "Validade" em branco; o recebimento de OC exige os dois quando o
item controla lote e validade. Não existe regra canônica para dizer quando
material fornecido pelo cliente exige lote do fabricante, validade ou
rastreabilidade adicional.

**Decisão de PO:** não assumir que todo Item exige validade. A solução futura
considera regra/configuração por tipo ou por Item — hipótese de modelagem:
"exige lote do fabricante" e "exige validade" —, mas defaults e obrigatoriedade
operacional precisam ser validados com a Veridi. Relacionado ao #7.
**AGUARDANDO VALIDAÇÃO DE NEGÓCIO.**

### 7. Convenções operacionais ainda não formalizadas — AGUARDANDO VALIDAÇÃO COM A VERIDI

Cada uma tem um padrão em uso; nenhuma impede operação. Pauta consolidada para
a homologação — não implementar por suposição; com o feedback da Veridi,
quebrar em requirements independentes:

- regra de geração automática do número de lote;
- limiar/alerta de validade próxima;
- permissões detalhadas por papel;
- regras de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- conteúdo, formato e dimensões da etiqueta e impressora;
- validade por classe/tipo de Item;
- storage definitivo de arquivos/anexos em produção.

Perguntas regulatórias abertas: [`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md).

---

## D. Manutenção técnica

### 14. Drift `schema.prisma` × banco/migrations — LOW técnico, risco estrutural

`prisma migrate diff` do banco (novo ou produção, idênticos) para o
`schema.prisma` gera 86 comandos: 0 tabelas, 0 colunas e 0 tipos funcionais
divergentes; 27 chaves estrangeiras que o banco aplica com `ON DELETE
RESTRICT` e o schema declara `SET NULL` (`attachments.lotId`,
`lots.ownerCustomerId`, `production_orders.customerOrderId`,
`billing_lines.lotId`…); ≈32 índices e constraints com divergência nominal.
O banco é o lado mais restritivo.

**Decisão de PO:** não corrigir automaticamente. Cada FK exige decisão de
domínio — bloquear a exclusão, desassociar o relacionamento, ou arquivar em vez
de excluir. Fazer em rodada isolada: **"Schema Integrity Audit"**.

**Regra de segurança já vigente** ([`TECH_BASELINE.md`](TECH_BASELINE.md),
*Migration order*, e `CLAUDE.md`): migration nova não carrega drift incidental —
nem `RESTRICT → SET NULL`, nem renomeação de índice ou constraint, nem criação
ou remoção alheia. Todo SQL gerado é revisado linha a linha; diff gigante do
Prisma não se aprova. **ABERTO.**

### 10. Compactar `archive/DELIVERY_HISTORY.md` — MANUTENÇÃO / LOW

≈5.326 linhas de diário por entrega — contradiz o objetivo do Baseline v2 de
reduzir contexto histórico vivo. Consolidar para ≈200–400 linhas com só data,
capability, release/commit importante, decisão durável e breaking change
relevante. O Git guarda o detalhe. Não misturar com capability de negócio.

---

## E. Observação

### 1. `pnpm test` — `ERR_IPC_CHANNEL_CLOSED` ocasional no encerramento — LOW

Ocorrência histórica e intermitente (`Error: Channel closed`) no fechamento
dos workers do vitest com api e web juntos; nenhuma asserção falha. Sem
reprodução recente, suítes verdes, nenhum indício de regressão de produto.
**Decisão de PO:** não investigar preventivamente sem reprodução. Se
reaparecer, capturar versão do Node, worker/processo, ordem de shutdown, árvore
de processos, frequência e stack completa antes de mexer no runner.

### 2. Base local — dados legados inconsistentes — LOW

Só no banco **local** de desenvolvimento com o corpus legado importado:
348 produtos sem cliente (91 em uso), 54 itens de produto acabado órfãos.
Produção não é afetada — a base está limpa e produto novo exige cliente.
**Decisão de PO:** nenhuma feature nem migration para isso agora; deve sumir no
próximo reset canônico da base local/E2E. **ADIADO / MANUTENÇÃO LOCAL.**

---

## F. Resolvidos recentes (2026-09-04)

- **#7a "Dashboard" → "Painel"** — publicado: menu, título e interface visível
  sem "Dashboard".
- **#13 Reconstrução de banco vazio** — cadeia de migrations reconstrói banco
  vazio; `pnpm validate:migrations:fresh` verde; `scripts/migration-order.test.ts`
  em `pnpm test`; produção com `migrate status` em dia. A migration histórica
  antiga permanece registrada, de propósito, nos bancos que a executaram —
  nenhuma limpeza manual de `_prisma_migrations` é necessária. Detalhe em
  [`TECH_BASELINE.md`](TECH_BASELINE.md), *Migration order*.

## G. Roadmap

Escopo futuro não fica aqui. **Produto próprio Veridi** (Product sem cliente
obrigatório, estoque próprio de PA, venda do mesmo PA a vários clientes) vive
em [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md); `Product.customerId`
permanece obrigatório no escopo atual.

---

## Ordem de execução definida pelo PO (2026-09-04)

1. **Próxima rodada:** #12 + #9 + #3 + #4 + #5 — consistência de custos,
   explicabilidade matemática e UX da Formulação.
2. **Rodada seguinte:** #8A + #8B + #8C; avaliar #8D conforme o tamanho.
3. **Validação com a Veridi:** #7 + #11.
4. **Manutenção:** #10. #1 e #2 permanecem observação/adiados.
5. **Rodada técnica isolada:** #14 (Schema Integrity Audit).
6. **Roadmap:** produto próprio Veridi.

## Próximo gate

A validação com a Veridi continua gate para as regras que dependem do processo
real do cliente (#7, #11). Ela **não** impede os itens internos já decididos
pelo PO (#12, #9, #3, #4, #5) quando o PO autorizar a próxima capability.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
