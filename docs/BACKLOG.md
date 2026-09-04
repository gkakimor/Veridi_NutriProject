# Backlog

O que está **aberto**: defeito por corrigir, decisão pendente de Product
Ownership, melhoria adiada de propósito.

Achado fechado não fica aqui. O que virou regra está em
[`PRODUCT_RULES.md`](PRODUCT_RULES.md); o que cada rodada descobriu está em
[`archive/E2E_VALIDATION_HISTORY.md`](archive/E2E_VALIDATION_HISTORY.md); onde
cada regra é protegida está em [`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md).

**Próximo gate:** validação com a Veridi.

---

## Defeitos abertos

### 1. `pnpm test` quebra de forma intermitente no monorepo — LOW

Rodando api e web juntos, a suíte às vezes morre com `Error: Channel closed` /
`ERR_IPC_CHANNEL_CLOSED` no encerramento dos workers do vitest. Nenhuma asserção
falha; as suítes passam inteiras quando rodadas uma a uma. Reproduzido também em
`96e2c07`, antes das mudanças de Cliente — é anterior, não regressão.

Não reproduzido em três execuções consecutivas (2026-09-02) nem nas desta
rodada. **Continua aberto de propósito:** falha intermitente não se fecha com
amostras limpas, e nenhuma mudança de tooling foi feita — corrigir sem
reproduzir seria mexer no runner às cegas.

**Próxima ação:** se voltar a aparecer, anexar o log aqui antes de mexer em
`maxWorkers` ou serializar os pacotes. A correção precisa de uma reprodução para
ser verificável.

### 2. Produtos do legado sem cliente e itens acabados órfãos — LOW

**Escopo: banco LOCAL de desenvolvimento com o corpus legado importado. Não é
risco de produção** — a base de produção está limpa e produto novo exige cliente
desde a rodada de Produto + item de produto acabado.

Retrato local: 348 de 661 produtos sem cliente (91 já em uso), 8 produtos sem
item de produto acabado (fixtures antigas), 54 itens de produto acabado órfãos.
Zero item compartilhado entre produtos, zero divergência entre o cliente do
produto e o do projeto de origem.

**Próxima ação:** nenhuma automática. Atribuir cliente a um produto em uso é
decisão de negócio, não de migração.

### 3. Campos por componente sem `aria-invalid` nem rolagem até o erro — MEDIUM

Os oito campos de cada componente da Formulação não marcam o campo inválido nem
levam a pessoa até ele, ao contrário de `basisQuantity` e `dosesPerPackage`, que
têm `aria-invalid` e `field__error` sob o campo. Exige estado de erro por linha,
não só a mensagem no topo.

Risco reduzido: a mensagem passou a citar o código do item, então o pior caso
deixou de ser "procure em doze linhas".

### 4. Densidade da tabela de componentes — LOW

Em 1280×800 e 1440×900 a tabela mede 1621px numa área útil de 928px/1088px,
então "Equivalente estoque" e "Físico / unidade" ficam fora da tela na rolagem
natural. É anterior à capability de quantidade física — dez colunas — e a rodada
de legibilidade **reduziu** o problema (era 1925px). O painel de ajustes mostra
a quantidade física em texto, com a conta ao lado, então nenhum número exibido
depende dessas colunas. A página em si não estoura.

### 11. Rastreabilidade do material fornecido pelo cliente: regra por Item a definir — MEDIUM

`receiving/ReceiveCustomerMaterialPage.tsx` aceita confirmar com "Lote do
fabricante" e "Validade" em branco; o recebimento de OC exige os dois quando o
item controla lote e validade. Achado da revisão de ajuda (2026-09-04). A
ajuda descreve o que a tela faz hoje.

**Não** assumir que todo material do cliente exige validade: parte dele chega
sem lote de fabricante ou sem vencimento declarado, e isso pode ser legítimo.
O que falta é a **regra por tipo/configuração do Item** para material
fornecido pelo cliente — se o lote do fabricante é exigido, se a validade é
exigida, e o que a rastreabilidade precisa guardar quando não vêm. Decisão de
PO; mantido aberto de propósito, sem correção nesta rodada.

### 12. Custo estimado da Formulação usa só compra real — LOW

`FormulationVersionPage` lê `getFormulationCostEstimate`, que usa a fundação
(30d → 90d → última compra) e ignora oferta válida e referência manual. O
CMV e o cálculo padrão usam a seleção canônica completa (§53), então os dois
podem discordar num item sem compra. Pré-existente (oferta já era ignorada).
Corrigir é trocar a fundação pela seleção canônica nesse serviço e ampliar a
taxonomia `CostSource`.

---

## Decisões pendentes de Product Ownership

### 5. Rótulos dos dois modos de quantidade — LOW

"Quantidade física já ajustada" e "Calcular quantidade física automaticamente"
falam ambos de quantidade física, e a diferença é sutil numa leitura rápida. O
risco caiu com as frases de apoio — o resumo distingue "Física direta" de
"Calculada · nenhum ajuste marcado" —, mas o texto dos rótulos continua. Mudar
texto que o operador vai aprender é chamada do PO.

### 6. Produto próprio Veridi — fora de escopo, registrado

Todo Produto pertence a um Cliente (`Product.customerId` obrigatório). Isso
impede três coisas que a operação vai pedir: produto próprio da Veridi, estoque
de produto acabado próprio, e vender o **mesmo** produto acabado para mais de um
cliente.

Matéria-prima e embalagem continuam itens globais — a restrição é só do produto
acabado. Lotes já suportam `VERIDI` e `CUSTOMER(customerId)`, então a peça que
falta é do lado do Produto, não do estoque.

**Decisão:** nenhuma agora. Mexer em `Product.customerId` atravessa pedido,
precificação, CMV e isolamento por cliente ao mesmo tempo. Permanece futuro —
ver [`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md).

### 7a. "Dashboard" no título e no menu — LOW

A tela inicial se chama "Dashboard" na interface e "Painel" na ajuda. A regra
de vocabulário pede português; trocar o rótulo que o operador já aprendeu é
chamada do PO.

### 7. Convenções que ninguém formalizou

Cada uma tem hoje um padrão em uso; nenhuma impede operação. A maioria depende
da prática real da casa, não de escolha técnica — boa pauta para a validação
com a Veridi.

- algoritmo do número de lote automático de produto acabado;
- limiar exato do aviso de validade próxima;
- permissões detalhadas por papel;
- regras exatas de responsabilidade e liberação da Qualidade;
- códigos de motivo de perda/rendimento;
- dimensões finais da etiqueta e impressora;
- se toda classe de item exige validade;
- provedor de armazenamento de arquivos em produção.

Perguntas regulatórias abertas: [`BLOCK_H_VALIDATION.md`](BLOCK_H_VALIDATION.md).

---

## Melhorias adiadas de propósito

### 8. Cálculo ao vivo nas demais telas

Pedido do PO: *"idealmente todas as telas deveriam funcionar da mesma maneira
quando tiverem cálculos"*. O padrão nasceu na Formulação e tem três partes: o
valor derivado aparece **enquanto se digita**; a conta vem da **mesma função**
que a API usa; `CalcHint` mostra a aritmética com os números daquela linha.
Premissa ausente vira travessão, nunca zero.

Hoje no padrão: Faturamento, Formulação, CMV e a prévia de política de preço.

**Pior caso, e primeira prioridade — número vivo ao lado de número velho, sem
nada dizendo qual é qual:**

- `purchase-orders/PurchaseOrderPage.tsx` — numa OC salva, as linhas recalculam
  ao digitar e o rodapé mostra `orderTotal` da última gravação;
- `shipments/ShipmentPage.tsx` — "Expedindo agora" vem do read model e o Total
  do rodapé é conta do navegador; o rodapé ainda imprime número cru, sem
  `formatQuantity`.

**Calculam ao vivo, falta só `CalcHint`:** Contagem de Estoque (a *Diferença*
decide se o ajuste exige motivo), Ordem de Compra, Expedição, complemento
Reservar ↔ Produzir no Pedido do Cliente.

**Em branco até apertar botão** — legítimo quando a conta é cara, desde que a
tela diga que o valor é do que está salvo. Só `QuoteConditionsForm` faz isso.
Faltam: Custo Industrial, Precificação, impacto de materiais do Pedido.

**Precificação é caso próprio:** único lugar onde ver preço sugerido e margem
exige uma **gravação** (`Adicionar faixa`). Não existe caminho de leitura.

**Não derivam nada onde faria falta:** Recebimento (custo efetivo sem total nem
comparação com o previsto), override de preço no Faturamento (total só depois de
confirmar), Custo Industrial (consumo sem prévia de kWh), Ficha de Pesagem
(diferença só depois de confirmar), OP (mudar quantidade planejada não mexe nas
necessidades até salvar), Orçamento (campos não controlados, total velho durante
a digitação).

### 9. `CalcHint` que ainda não se confere

Faturamento e dois do CMV passam `esperado` e checam. "CMV por unidade" e "Preço
sugerido" não. Ligar é passar `numero` em cada operando, mas exige conferir cada
um contra dado real antes — alarme falso por padrão seria pior que o silêncio.

"Lotes de referência" é caso à parte: o resultado é arredondado para cima, então
a divisão crua nunca fecha e a conferência tem de continuar desligada ali.

### 10. `archive/DELIVERY_HISTORY.md` — 5.326 linhas de diário

O maior documento do repositório é um relato por entrega. Não foi tocado na
higiene de 2026-09-04 porque o handoff não o nomeou e porque é o único registro
do que cada entrega continha. Candidato natural à próxima rodada de compressão:
o Git já guarda a história, e o que virou regra está em `PRODUCT_RULES`.

---

## Próximo gate

**Validação com a Veridi.** Nenhum desenvolvimento novo até a conversa acontecer
e o feedback ser classificado — o que a operação real apontar vale mais que
qualquer item priorizado sozinho daqui.

Material pronto: `Guia_Fluxo_Comercial_Veridi.docx` (36 capítulos, não
versionado por política) e
[`ROTEIRO_VALIDACAO_CLIENTE.md`](ROTEIRO_VALIDACAO_CLIENTE.md).
