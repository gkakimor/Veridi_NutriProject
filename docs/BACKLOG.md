# Backlog atual

Pendências reais e o que decidir sobre cada uma. Roadmap futuro, histórico de
auditoria e regras duráveis vivem em outros arquivos — ver [Referências](#referências).

**Release congelada:** `9a653a0` · **Próximo gate:** validação com a Veridi.

---

## Estado

| Severidade | Abertos |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 3 |
| LOW | 6 |

A rodada de hardening pós-validação fechou tudo o que os três E2E e as duas
auditorias de UX levantaram como defeito de produto, e mais o que a
reauditoria achou nas próprias correções — ver
[VALIDACAO_E2E_UI.md](VALIDACAO_E2E_UI.md). As três auditorias profundas
(VAL-LEG-01, 02, 03), o hardening pré-cliente e o polimento visual estão
fechados — findings e correções em
[archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md).

Os onze itens abertos vêm todos da **rodada adversarial** posterior, que atacou
o núcleo operacional procurando o que o sistema aceita em silêncio — ver
[VALIDACAO_E2E_ADVERSARIAL_CORE.md](VALIDACAO_E2E_ADVERSARIAL_CORE.md). Nenhum é
corrupção de dado: os dois HIGH mais graves são uma consulta que responde errado
e um documento que exibe menos casas do que calcula. Os dois LOW herdados — o
flake do runner (3) e o legado local sem cliente (6) — continuam abertos e
seguem não sendo defeito do produto atual.

---

## Pendências abertas

### 1. Rótulos de ação divergentes entre telas — resolvido

"Criar item", "Criar relação", "Criar fornecedor", "Salvar", "Registrar
tarifa", "Salvar rascunho", "Salvar base". Cada tela pedia ao operador que
reaprendesse qual botão confirma.

O vocabulário foi definido e ficou registrado em
[UI_BRAND.md](UI_BRAND.md), seção *Commit-action vocabulary*: `Criar <coisa>`
para criar, `Salvar alterações` para editar, `Salvar <parte>` quando o botão
grava um pedaço de um documento maior, `Salvar rascunho` só onde o estado
salvo é mesmo rascunho.

Aplicado onde o rótulo era genérico. Os seis botões que diziam só "Salvar"
passaram a dizer o que salvam — "Salvar observações" (ordem de produção),
"Salvar prazo e observações" (pedido), "Salvar previsão e observações" (ordem
de compra), "Salvar custo" (linha do recebimento) — e o formulário de Projeto
passou a distinguir "Criar projeto" de "Salvar alterações". Nenhum bare
"Salvar" restou fora de diálogo.

**Decisão / próxima ação:** nenhuma. Se o feedback da Veridi trouxer outro
vocabulário, a mudança é editar a seção do `UI_BRAND.md` e reaplicar.

### 2. Diálogo de confirmação repete o rótulo de quem o abriu — resolvido

"Ativar versão" abria diálogo cujo confirmar também era "Ativar versão"; idem
"Confirmar OC", "Confirmar recebimento" e "Ativar estrutura". O texto do
diálogo é bom — diz o que se torna imutável. Ambíguo é só o rótulo do botão.

**Fechado como passada deliberada.** Auditados todos os `confirmLabel` do web
contra o rótulo do botão que abre cada diálogo. Oito repetiam a frase inteira
e passaram ao verbo curto, com o objeto migrando para o título:
`ApprovalPreviewDialog` ("Aprovar o projeto?" › "Aprovar"),
`IndustrialResourceDetailPage` e `SupplierItemDetailModal` ("Inativar"),
`CustomerOrderPage` e `ShipmentPage` ("Confirmar"), `ProductionOrderPage`
("Liberar"), `BillingPage` ("Emitir"), `PricingPage` ("Ativar") e
`CostCalculationSection` ("Salvar").

**Exceção deliberada, documentada no código:** `CancelProjectDialog` e
`CancelSampleDialog` mantêm o objeto ("Cancelar projeto", "Cancelar
amostra"). Num diálogo, "Cancelar" sozinho é lido como "desistir e fechar" —
a ação oposta. Encurtar devolveria a ambiguidade justamente no botão sem
volta.

**Decisão / próxima ação:** nenhuma. Regra em
[PRODUCT_RULES.md](PRODUCT_RULES.md) §45 e em [UI_BRAND.md](UI_BRAND.md).

### 3. `pnpm test` quebra de forma intermitente no monorepo — LOW

Rodando api e web juntos, a suíte às vezes morre com
`Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` no encerramento dos workers
do vitest. Nenhuma asserção falha — as suítes passam inteiras quando rodadas
uma a uma. Reproduzido também em `96e2c07`, antes das mudanças de Cliente:
é anterior, não regressão.

**Não reproduzido em 3 execuções consecutivas** de `pnpm test` na raiz, em
`fix/industrial-resource-create-page` (2026-09-02). As três saíram com exit 0
e nenhuma ocorrência de `ERR_IPC_CHANNEL_CLOSED`, `Channel closed`, falha de
segmentação ou `ELIFECYCLE`. Cada rodada: web 447 testes, api 895 + 7 na
configuração serial, scripts 25. `pnpm -r test` executa api e web em
paralelo, então a condição descrita foi de fato exercida — não é o caso de
"passou porque rodou serializado".

**Continua aberto de propósito.** Falha intermitente não se fecha com três
amostras limpas: a ausência em 3 execuções reduz a frequência estimada, não
demonstra que sumiu. Nenhuma mudança de tooling foi feita — corrigir sem
reproduzir seria mexer no runner às cegas.

**Decisão / próxima ação:** manter as suítes separadas quando o gate precisar
ser confiável. Se voltar a aparecer, anexar o log da execução aqui antes de
mexer em `maxWorkers` ou em serializar os pacotes — a correção precisa de uma
reprodução para ser verificável.

### 4. Aba Produção na Consulta do Cliente — resolvido

Produção era a única peça operacional ausente da Consulta. Ficou de fora
porque `GET /production-orders` não aceita `customerId` e o DTO operacional
custa caro por linha.

**A estimativa antiga estava otimista.** Medido agora com o log do Prisma:
`toProductionOrderDTO` gasta **548 consultas para uma página de 25** — não as
sessenta que este item supunha. Ele monta necessidade de material, reserva,
consumo e sugestão de lote, por requirement, em `await` sequencial. É a conta
que decide se dá para LIBERAR a ordem, e não é a pergunta da Consulta.

**Feito com read model próprio**, o segundo da Consulta depois de Produto
Acabado: `GET /customers/:id/consultation/production-orders`, paginado no
mesmo contrato das outras abas. Custo medido: **quatro consultas por página**,
independente do tamanho dela — as ordens, um `groupBy` dos apontamentos, os
lotes e o total. Teste de regressão conta as consultas pelo log do driver, para
a volta ao DTO pesado não passar como lentidão inexplicada.

**O filtro é `ProductionOrder.customerId`**, e os outros caminhos foram
descartados por medição, não por preferência: via Produto a cobertura é
idêntica e não recupera uma linha sequer; via Pedido alcança um oitavo das
ordens, deixando de fora toda a produção sem pedido.

**Fato do dado que a tela expõe:** 78 das 108 ordens do banco local não têm
cliente — todas de origem manual. A aba aparece vazia para a maioria dos
clientes **estando correta**, e o estado vazio diz isso em vez de fingir que
não há nada. Nenhum dado foi alterado para melhorar o número.

**Decisão / próxima ação:** nenhuma. Se a produção sem cliente precisar
aparecer para alguém, a pergunta é de negócio — a quem pertence uma ordem
manual sem pedido — e não de consulta.

### 5. Smoke autenticado em produção — resolvido

Três rodadas subiram sem smoke autenticado: cadastro de Cliente (`cab5bf3`),
Consulta do Cliente (`7cd61f2`) e a navegação (`cdcb235`). Nos três o deploy
respondeu `/health` 200, que não diz nada sobre uma tela que quebra ao montar
nem sobre migration pela metade.

**Feito e automatizado.** Product Ownership autorizou o uso da conta DEMO de
produção. O roteiro virou script:
[`smoke-prod.mjs`](../scripts/smoke-prod.mjs).

- Leitura, sempre: `/health`, login, `/auth/me`, onze endpoints de listagem, e
  oito telas abertas com sessão real conferindo que nenhuma cai no login.
  Console e rede vigiados — qualquer 4xx/5xx reprova.
- Escrita, só com `--escrita`: cria um cliente marcado `SMOKE`, prova que
  e-mail inválido e telefone curto são recusados na tela, que CNPJ válido
  passa, que o CEP preenche endereço, confere a autoria gravada a partir do
  usuário autenticado, e **inativa pelo fluxo oficial** — nada é apagado.

Rodado sobre a release da ajuda contextual: tudo passou, console limpo, zero
requisição 4xx/5xx. O cliente do smoke ficou como `CLI-000008`, inativo.

Um achado veio junto e era do próprio script, não do produto: `/estoque` não
tem sufixo, e a URL errada `/estoque/posicao` caía em `/estoque/:itemId`
buscando um item chamado "posicao".

**Decisão / próxima ação:** rodar antes de fechar cada rodada. A perna de
escrita continua atrás de flag de propósito.

### 6. Produtos do legado sem cliente e itens acabados órfãos — LOW

**Escopo: banco LOCAL de desenvolvimento, com o corpus legado importado.
Não é risco de produção.** A base de produção foi limpa, e produto novo exige
cliente desde a rodada de Produto + item de produto acabado — os números
abaixo são um retrato histórico do ambiente local, não algo que a operação
encontre.

Diagnóstico da época:

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

### 7. Ordem real de delete — resolvido com `fk-order.mjs`

Ao limpar o banco de produção, a ordem de remoção derivada do
`schema.prisma` quebrou: várias relações aparecem como opcionais ali — o que
sugeriria `SET NULL` —, mas as migrations criaram **`ON DELETE RESTRICT`** no
banco. A limpeza só passou calculando a ordem por ordenação topológica sobre
`pg_constraint`, que é a fonte da verdade.

Isso vivia só como parágrafo de backlog. Agora tem ferramenta:
[`fk-order.mjs`](../scripts/maintenance/fk-order.mjs), somente leitura, no
mesmo padrão dos outros scripts de manutenção —
`railway run --service Postgres node scripts/maintenance/fk-order.mjs`, ou
`pnpm exec dotenv -e .env -- node scripts/maintenance/fk-order.mjs` contra a
base local. Lê `pg_constraint` e imprime:

- toda FK do schema `public` — tabela filha, tabela pai, coluna e as ações
  reais de `ON DELETE` e `ON UPDATE`;
- a ordem topológica de remoção, filhas antes das pais, que é o que um script
  de limpeza precisa. RESTRICT, NO ACTION e CASCADE ordenam; SET NULL e SET
  DEFAULT não;
- ciclo de FK, quando existe, com as tabelas que fecham o anel — e sai com
  código 1, porque nesse caso a ordem impressa está incompleta;
- as divergências contra o `schema.prisma`, destacando a armadilha original:
  relação opcional sem `onDelete:` explícito que no banco trava o delete.

`--json` para outro script consumir a saída.

Na base local: **194 FKs, 64 tabelas, nenhum ciclo, 27 divergências — todas a
mesma armadilha** (`Tipo?` no Prisma, `RESTRICT` no banco), entre elas
`lots.productionOrderId`, a que derrubou a primeira limpeza. `ON UPDATE` é
`CASCADE` nas 194. Seis auto-referências, uma delas `RESTRICT`
(`material_reservation_lines.replacesLineId`), que importa para quem apagar
linha a linha.

O aviso também ficou no topo do `schema.prisma`, que é onde se tropeça nele.

**Decisão / próxima ação:** nenhuma. Conferir a ação real deixou de depender
de alguém lembrar deste parágrafo.

### 8. Bolha do InfoHint e menu de linha recortados por tabela — resolvido

O `InfoHint` posicionava a bolha em `position: absolute`. Dentro de
`.table-container`, cujo `overflow-x: auto` recorta o eixo Y junto, tabela com
poucas linhas cortava a explicação.

Era condição teórica quando foi registrado — havia cinco ⓘ no sistema, todos
em telas que não reproduziam. Deixou de ser: a rodada de ajuda contextual
levou o ícone a 98 pontos, e a maioria é cabeçalho de coluna, exatamente o
caso descrito.

**Corrigido na origem.** A bolha passou a ser `position: fixed`, com `top` e
`left` medidos a partir do gatilho — ancorada ao viewport, escapa de qualquer
ancestral recortado. Vira para dentro quando não cabe à direita, abre para
cima quando não cabe embaixo, e recalcula na rolagem (com captura, porque a
rolagem que importa é a do container, que não sobe por bubbling) e no resize.
Enquanto não foi medida fica invisível, para não piscar no canto.

Teste em `help-kit.test.tsx` renderiza o ⓘ dentro de um `.table-container` e
prova que a bolha recebeu coordenada.

**O menu `⋯` das linhas tinha o mesmo defeito** e foi corrigido junto: o menu
de uma linha perto do rodapé aparecia cortado no meio de um item. Mesmo
remédio — `position: fixed` com coordenada medida, abrindo para cima quando
não cabe embaixo. O `z-index: 3` que existia para contornar o sintoma na
célula fixa saiu junto, porque o menu deixou de ser pintado dentro dela.

**Decisão / próxima ação:** nenhuma.

### 9. Criar entidade só existe em modal, não em rota — resolvido

Cliente, Produto, Fornecedor, Item de estoque e Recurso industrial **não têm
tela de criação**. Cada um existe como modal (`CustomerFormModal` e irmãos),
aberto tanto pelo botão da listagem quanto pelo "+ Novo X" dos campos de
busca. Não há `/cadastros/clientes/novo` nem equivalente.

Não é duplicação: o modal É o formulário oficial, é `FullWorkspaceModal` com
breadcrumb e título, e a listagem abre exatamente o mesmo componente. Também
não custa rascunho — o modal renderiza por cima sem desmontar o formulário de
origem, então quem sai para cadastrar um cliente no meio de um pedido volta
com tudo preenchido.

O que faltava era só o que uma URL dá: refresh no meio da criação perdia o
formulário, e não havia link direto para "novo cliente".

**Feito.** Cliente, Produto, Item de estoque e Fornecedor têm página própria
em `/cadastros/<entidade>/novo`. Os campos foram extraídos para um módulo por
entidade (`customer-form.tsx` e irmãos), usado pela página E pelo modal — não
há segunda implementação a divergir. A extração saiu barata porque o botão de
commit já usava `type="submit" form="…"`, atributo que aciona um `<form>` em
que o botão não está aninhado e funciona igual nos dois hospedeiros.

O rascunho da origem sobrevive à navegação em `sessionStorage`, endereçado por
token de uso único levado na URL, com validade de horas e guarda contra
retorno para fora do sistema. Cancelar e o botão Voltar do navegador também
restauram. Os modais continuam servindo à edição, aberta pela linha da lista.

**Recurso industrial ficou de fora, e é decisão, não pendência** — ver item 11.

**Decisão / próxima ação:** nenhuma.

### 10. Três fontes divergem sobre quem pode criar cadastro — resolvido

O `POST` de Cliente, Produto, Fornecedor e Item **não tem `requireRole`** —
qualquer sessão autenticada cria. Os botões "+ Novo X" das telas de listagem
também não checam nada. Mas quatro campos de busca haviam inventado gates no
front (`COMMERCIAL || ADMIN` para Cliente, `PURCHASING || ADMIN` para
Fornecedor, `PURCHASING || QUALITY || ADMIN` para Item), mais restritivos que
o servidor e inconsistentes com o botão da listagem: o mesmo usuário via o
cadastro numa tela e não via na outra.

Alinhado com a listagem (2026-09-02): a ação aparece para quem está
autenticado, que é o que a API de fato permite. Recurso industrial é a
exceção e mantém `ADMIN` — ali o gate é real nos dois lados
(`industrial-resources.routes.ts`).

Isto **não** é regressão de segurança: nada foi afrouxado no servidor, só o
front deixou de esconder uma ação que ninguém recusa. A matriz de permissão
por papel está entre as decisões adiadas deste mesmo arquivo, e é lá que a
pergunta "quem pode cadastrar cliente?" será respondida.

**Auditado de novo com as telas oficiais no ar** (2026-09-02), e as três
fontes agora concordam para as cinco entidades:

| Entidade | Botão da lista | Campo de busca | Página nova | API |
|---|---|---|---|---|
| Cliente, Produto, Item, Fornecedor | sem gate | sem gate | sem gate | sem `requireRole` |
| Recurso industrial | `ADMIN` | `ADMIN` | não tem página | `requireRole("ADMIN")` |

Nenhuma regra documentada está sendo violada: a matriz por papel está entre as
decisões adiadas deste arquivo, e o que existe hoje é o modelo simples que
`PRODUCT_RULES` §1 descreve — autorização exigida no servidor, sem matriz por
botão nesta fase. Não inventamos gate novo em nenhum lado.

**Decisão / próxima ação:** nenhuma aqui. A matriz por papel continua sendo
pauta da validação com a Veridi, e quando ela existir a ordem é fechar no
servidor ANTES de esconder no front — a inversa dá falsa sensação de
controle.

### 11. Recurso industrial sem tela de criação — resolvido

As outras quatro entidades de cadastro ganharam página oficial; Recurso
industrial ficou no modal, deliberadamente.

O formulário é o mais simples dos cinco e seria o recorte mais barato. O que
falta é para quem: a listagem **já navega** para o detalhe depois de criar
(`IndustrialResourcesPage`), então a página não entregaria destino novo —
entregaria só a URL. Existe **um** único ponto de criação em contexto
(`IndustrialCostPage`), restrito a `ADMIN`. E a tela de edição do recurso não
compartilha formulário nenhum com o modal de criação: são edições inline campo
a campo, cada uma com sua regra. Não existe "o formulário de recurso" para os
dois lados reusarem.

**Feito**, alinhando a última das cinco entidades ao padrão das outras
quatro: `/gestao/recursos-industriais/novo`, com os campos extraídos para
`industrial-resource-form.tsx`. O campo Recurso da estrutura de custos passou
a navegar, guardando o rascunho da linha em edição e voltando com o recurso
selecionado pelo id; o botão da listagem virou link para a rota.

O argumento acima continua verdadeiro sobre o VALOR, e por isso vale
registrar o que mudou de fato: a criação ganhou URL, sobrevive a um F5 e
entra no histórico, e a regra de energia fora do modo direto — que recusa a
seleção com aviso em vez de escolher em silêncio — foi preservada.

**O modal foi removido.** Ele existia só para esta criação: recurso não tem
edição em modal, a edição é inline na tela de detalhe. Depois de mover a
listagem e o campo, ficou sem nenhum importador, e código morto num cadastro
é onde a próxima divergência nasce.

Três desvios do formulário antigo, todos para alinhar ao padrão dos outros
quatro: o botão de commit virou `type="submit" form="…"` com `required` no
nome, em vez de ficar desabilitado sem dizer o que faltava; `ApiValidationError`
passou a ser mapeado por campo, então `invalid_power` pousa na potência em vez
de virar faixa genérica; e salvar pelo acesso direto leva ao detalhe, que é
onde a tarifa entra — recurso sem tarifa não serve a estrutura nenhuma.

**Decisão / próxima ação:** nenhuma.

### 12. Catálogo truncado em silêncio nas telas de escolher item — resolvido

As telas que precisam de uma lista de itens carregam o catálogo inteiro com
`pageSize` fixo e filtram no navegador. Acima do teto, o item **existe e não
aparece na busca** — sem aviso, sem indicação de que a lista está cortada. E
como o campo oferece "+ Novo item de estoque" logo no topo, o caminho natural
de quem não acha é **cadastrar de novo o que já existe**.

Medido no banco local (2026-09-02):

| Tela | Teto | Existem | Invisíveis |
|---|---|---|---|
| `StockCountPage` (contagem física) | 1000 | 2.729 itens ativos | **1.729** |
| `FormulationTemplateDetailPage` | 200 | 2.729 itens ativos | **2.529** |
| `FormulationVersionPage` (matéria-prima) | 1000 | 1.211 ativas | **211** |
| `PurchaseOrderPage` (matéria-prima) | 1000 | 1.211 ativas | **211** |

Clientes (346 ativos), produtos (784 aprovados), fornecedores (300) e recursos
industriais (132) estão abaixo do teto hoje — o mesmo padrão está lá, só ainda
não estourou.

**Por que é MEDIUM e não LOW:** não é lentidão nem estética. É dado correto
que some da tela durante o lançamento, e o desfecho provável é duplicata no
cadastro de itens — que depois aparece como duas matérias-primas iguais com
saldos separados.

**Corrigido na busca, não no teto.** `SearchableEntitySelect` ganhou a
capacidade opcional `onSearch`: digitando, o campo consulta o SERVIDOR, que
conhece o catálogo inteiro. Debounce de 200ms, proteção de corrida por geração
de requisição — "caf" e "cafeína" voltam fora de ordem e a resposta velha não
sobrescreve a nova —, e três estados separados: procurando, vazio e erro.
Dizer "nenhum resultado" com a busca ainda no ar é o que fazia a pessoa
concluir que o registro não existia.

Ligado em **seis telas**: Contagem Física, Formulação, Template de Formulação,
Ordem de Compra, Amostras e Item × Fornecedor. A carga inicial caiu de 1000
(200 no template) para 50 — ela agora serve só à abertura, e a lista avisa que
dá para buscar o catálogo inteiro. Os outros catorze pontos de uso do
componente não mudaram: sem `onSearch`, tudo como antes.

Elegibilidade preservada em todas: os filtros de negócio que a carga inicial
usava foram para a busca, um a um. Achar não virou poder usar.

Dois defeitos vizinhos apareceram e foram corrigidos junto, porque a carga
menor os tornaria visíveis: na Contagem Física o item escolhido era estado
sincronizado por efeito sobre o catálogo, e uma busca posterior zerava lote e
saldo de uma contagem em andamento; na Ordem de Compra o atalho `?itemId=`
procurava o item na lista carregada e abria vazio quando ele estava fora dela.

O que sobrou está registrado como risco medido, não como conserto pendente —
itens 15 e 16.

**Decisão / próxima ação:** nenhuma. Regra em
[PRODUCT_RULES.md](PRODUCT_RULES.md) §48.

### 13. "Ativar versão" da formulação não salva o rascunho — resolvido

Na tela da versão de formulação, editar a receita e clicar em **Ativar versão**
sem antes clicar em **Salvar rascunho** ativa a versão **sem a alteração**, em
silêncio. `handleActivate` chama a API de ativação direto, sem gravar o estado
do formulário nem avisar que há edição pendente.

O agravante é a regra: versão ativa é documento histórico e não se edita. Quem
perceber depois não conserta — cria outra versão.

**Product Ownership escolheu salvar antes de ativar** (2026-09-02), e não
bloquear. Fica registrado o contra-argumento desta entrada — gravar por conta
própria decide pela pessoa o que ela talvez quisesse descartar —, porque ele
continua verdadeiro; a decisão foi que o clique redundante custa mais.

Ativar agora grava o formulário e só então ativa. A gravação é **condição**:
falhando por validação, por item inválido ou por rede, a ativação não acontece
e a versão continua rascunho, com o erro no campo certo. Sem alteração
pendente, nada é gravado — ativar continua uma chamada só.

"Pendente" é medido contra o que o servidor devolveu, serializado no mesmo
ponto em que o formulário é sincronizado. Não é flag por `onChange` nem
varredura de DOM: as duas quebram no primeiro campo novo que alguém esquecer
de instrumentar, e quebram em silêncio — o modo de falha que esta correção
existe para eliminar. Efeito colateral: reeditar até o valor original não conta
como alteração.

**Decisão / próxima ação:** nenhuma. Regra em
[PRODUCT_RULES.md](PRODUCT_RULES.md) §48.

### 14. Ativar estrutura de custos — resolvido no que era UX

Ativar uma estrutura de custos congela tarifas e torna a versão imutável. O
diálogo de confirmação só aparece **quando há pendência** — estrutura completa
ativa no primeiro clique. A formulação e o cálculo confirmam sempre; a
estrutura, não.

**Decisão / próxima ação:** confirmar sempre, dizendo o que se torna imutável,
como fazem os outros dois documentos da mesma cadeia.

### 15. Catálogos que ainda cabem no teto — resolvido nos campos de formulário

O conserto do item 12 levou busca no servidor às telas de ITEM, onde o
catálogo já tinha estourado. O mesmo padrão continua nas telas que carregam
**cliente, fornecedor, produto e recurso** com `pageSize` fixo e filtram no
navegador. Elas funcionam hoje só porque o catálogo ainda não passou do teto.

Medido em 2026-09-02, contra o teto de 1000:

| Catálogo | Ativos | Folga |
|---|---|---|
| Produtos aprovados | 784 | **216** |
| Clientes | 346 | 654 |
| Fornecedores | 300 | 700 |
| Recursos industriais | 132 | 868 |

**Produto é o próximo.** 216 cadastros separam a tela de Pedidos e a de Ordem
de Produção do mesmo defeito silencioso: produto que existe e não aparece na
busca, com "+ Novo produto" convidando a duplicar.

**Feito no hardening:** busca no servidor nos campos de FORMULÁRIO de
cliente (Produto, Projeto, Pedido, entrada de material do cliente), produto
(Ordem de Produção, Pedido), fornecedor (Ordem de Compra) e recurso (Estrutura
de Custos) — onze campos em sete telas, cada um repetindo os filtros de
elegibilidade da carga inicial. Ficaram de fora, por serem filtro de LISTAGEM
e não campo com "+ Novo": os `select` de filtro em Clientes, Projetos,
Faturamentos, Item × Fornecedor e relatórios.

**Decisão / próxima ação:** a ferramenta já existe — `SearchableEntitySelect`
aceita `onSearch`, e ligá-la é uma função por tela. Fazer quando o catálogo de
produtos passar de ~800, ou antes se a Veridi trouxer base maior na migração.
Não fazer agora seria escolha diferente se algum desses números fosse outro.

### 16. Item na entrada de material do cliente — resolvido

`ReceiveCustomerMaterialPage` carrega matéria-prima e embalagem com
`pageSize: 1000` — os mesmos 211 invisíveis das outras telas de item —, mas o
campo é um `<select>` nativo, não o `SearchableEntitySelect`. Não há onde
pendurar a busca no servidor sem antes trocar o componente.

**Resolvido.** O campo passou a usar o seletor pesquisável, com os mesmos
filtros de elegibilidade da carga anterior — matéria-prima e embalagem,
ativos. Achar não virou poder usar: tipo e situação continuam decidindo no
servidor, e o aviso de item que não controla lote segue onde estava.


### 17. Rota inválida redirecionava em silêncio — resolvido

`App.tsx` manda qualquer caminho desconhecido para `/` sem aviso, diferente
do "não encontrado" bem escrito que lote e pedido inexistentes já mostram.
Baixo impacto: só acontece com endereço digitado ou link quebrado.

**Resolvido.** `App.tsx` deixou de mandar endereço desconhecido para o
Dashboard com `Navigate replace` — que ainda apagava do histórico o endereço
errado, então nem dava para copiar num chamado. Agora há página de "não
encontrado" no padrão das telas de detalhe, mostrando o endereço pedido e o
caminho de volta.

### 18. Referência a Projeto que não parecia link — resolvido

Cliente, Produto, Item, Fornecedor e Recurso têm página canônica de criação;
Projeto — a entidade da qual tudo depende — não tem. Confirmado: F5 com o
modal aberto perde o rascunho.

**Resolvido, por outro caminho.** O Product Owner redirecionou: em vez de
criar uma segunda tela de Projeto, tornar real a referência que já existia. A
coluna "Cadeia técnica" e a barra "Ver do produto" pareciam link e não eram —
texto cinza, só o cursor mudava. Passaram a usar a mesma classe de link que
Cliente e Produto já usam na mesma tela. A rota canônica do Projeto continua
sendo a única.

### 19. Rastreabilidade nega expedição de lote que saiu por outro pedido — HIGH

`apps/api/src/modules/lots/traceability.service.ts:90` filtra as expedições do
lote por `customerOrderId` do Pedido **da Ordem de Produção**. O predicado
`lines: { some: { lotId } }`, que já está na mesma consulta, é o correto e
suficiente.

Estoque é fungível: um lote produzido para um pedido pode legitimamente atender
outro. Quando isso acontece, "Destino comercial" na tela do lote diz **"Este
lote ainda não foi expedido."** Medido: `LT-20260903-000803` saiu em
`EXP-000235` (`PED-000485`, 400 un), físico caiu de 800 para 400, e a tela
mostra zero expedições.

O dado está certo; a consulta é que erra. Pesa porque "por onde este lote saiu"
é a pergunta de recall.

**Decisão / próxima ação:** remover `customerOrderId` do `where` e derivar o
pedido de cada expedição encontrada — o destino comercial de um lote pode ser
mais de um pedido.

### 20. Documento de faturamento não fecha com os números que exibe — HIGH

O preço unitário sai com duas casas (`billings.service.ts:50`,
`formatMoney = value.toFixed(2)`) e o total da linha é calculado sobre o valor
cheio de quatro (`billings.service.ts:55`). Em `FAT-000152`: preço exibido
`R$ 4,05`, quantidade 123, total `R$ 498,53`. Quem confere faz
`4,05 × 123 = 498,15`. Diferença de R$ 0,38 sem explicação no papel.

A ordem de arredondamento está correta — somar e arredondar no fim. O defeito é
exibir menos casas do que o cálculo usa. Não é decisão de projeto: preço
unitário sai com quatro casas em `customer-orders`, `pricing`, `product-cmv` e
`quotes`; só `billings` e `purchase-orders` aplicam o formatador de dinheiro a
um preço unitário.

**Decisão / próxima ação:** decidir a precisão de exibição do preço no
faturamento e aplicá-la também ao cálculo, para que documento e conferência
usem o mesmo número. Rever `purchase-orders.service.ts:88` na mesma passada —
está na mesma classe e não foi medido.

### 21. Ajuste de estoque não registra quem fez, e não exige papel — HIGH

Ajustes gravam `createdBy = "Ambiente local"` (constante de sistema) enquanto
recebimento, consumo, produção e expedição gravam o usuário real.
`POST /inventory-adjustments` e `POST /stock-counts` não têm `requireRole`,
enquanto bloquear e liberar lote exigem QUALITY ou ADMIN.

Contraria `CLAUDE.md`: "Inventory history is auditable."

**Decisão / próxima ação:** gravar o ator real e definir o papel exigido para
ajuste e contagem. A escolha do papel é decisão de produto.

### 22. Filtros oferecem opções que a API recusa — HIGH e MEDIUM

Dois filtros renderizam o enum inteiro do domínio enquanto o schema de consulta
lista um subconjunto à mão. A tela responde `400`, mostra "Erro de validação" e
**mantém a tabela anterior com o contador intacto** — o operador lê um resultado
que não corresponde ao filtro escolhido.

- **HIGH · Pedidos** (`customer-orders.schemas.ts`): tela oferece 6 status, API
  aceita 4. `PARTIALLY_SHIPPED` e `SHIPPED` falham. Verificado por HTTP:
  200/200/200/400/400/200.
- **MEDIUM · Movimentações** (`inventory.schemas.ts:16`): tela oferece 9 tipos,
  API aceita 4. Falham `PRODUCTION_CONSUMPTION`, `SAMPLE_CONSUMPTION`,
  `OPENING_BALANCE`, `FINISHED_GOOD_PRODUCTION` e `SHIPMENT_OUT` — as consultas
  centrais de auditoria de estoque.

Não é classe do app: varridos os 32 mapas de rótulo contra os 18 enums de
filtro, o resto fecha. `reports` lista os 6 status completos e
`ProductionReports.tsx` escreve à mão o mesmo subconjunto que o schema aceita.
São dois desvios, não um padrão.

**Decisão / próxima ação:** derivar os dois schemas dos `readonly` já exportados
em `packages/shared` (`INVENTORY_MOVEMENT_TYPES`, `CUSTOMER_ORDER_STATUSES`),
para que um estado novo do domínio não nasça quebrando um filtro.

### 23. Achados MEDIUM e LOW da rodada adversarial

- **MEDIUM · Badge de Status fora da área visível** na lista de Pedidos
  (`scrollWidth` 1296 contra `clientWidth` 1138).
- **MEDIUM · "Preparar Expedição" habilitado sem nada reservado** — o botão
  convida a uma ação que o servidor recusa.
- **LOW · Liberar e bloquear lote sem entrada própria no menu** — ação existe,
  descoberta só por dentro da tela do lote.
- **LOW · Qualidade libera lote vencido** sem aviso.
- **LOW · Plano de Atendimento aceita digitar reserva acima do disponível** —
  só o servidor recusa.
- **LOW · Dois parsers decimais na API.** `projects.schemas.ts:9` não aceita
  vírgula e responde "Valor inválido (não pode ser negativo)" — mensagem que
  descreve outro defeito. Hoje não chega ao usuário: a tela converte antes.
  Latente.

**Decisão / próxima ação:** os dois MEDIUM valem correção antes da próxima
demonstração; os LOW cabem na próxima passada de UX.

### Não reproduzido — registrado para não reabrir

- **CEP inexistente "some sem erro".** Medido ao vivo: "CEP não encontrado.
  Preencha o endereço manualmente." aparece aos ~4 s, latência do ViaCEP. O
  auditor observou por menos tempo. Não é defeito.

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

Os dois LOW herdados — instabilidade da suíte (3) e o dado legado sem cliente
(6), este restrito ao banco local — não bloqueiam a validação e não devem ser
corrigidos durante a reunião. A matriz de permissão por papel é boa pauta PARA a
reunião.

Os quatro HIGH da rodada adversarial (19 a 22) são posteriores a este gate e
mudam a leitura dele. Nenhum corrompe dado, e nenhum aparece no caminho feliz da
demonstração — mas dois tocam o que a Veridi mais vai olhar: o documento de
faturamento (20) e a resposta de rastreabilidade de um lote (19). Decidir se
corrigir antes da reunião ou apresentar com a ressalva é chamada de Product
Ownership, não técnica.

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

### Sessões de produção — inventariadas, revogação dispensada

A tabela tem 542 sessões: **539 expiradas**, 4 já revogadas e **3 vigentes**,
todas de `admin@veridi.demo` e criadas nas horas anteriores à conferência.
Nenhum usuário inativo tinha sessão viva — o caso que exigiria ação.

Product Ownership dispensou a revogação (2026-09-02): as três vigentes são
sessões de trabalho em curso, e derrubá-las custaria login sem ganhar nada.
As expiradas não abrem porta e ficam como histórico de acesso.

Não é pendência. Reabrir só se aparecer sessão vigente de usuário inativo ou
de conta que não deveria existir — é o que
[`prod-sessions.mjs`](../scripts/maintenance/prod-sessions.mjs) confere, e
[`prod-sessions-revoke.mjs`](../scripts/maintenance/prod-sessions-revoke.mjs)
executa, simulando por padrão.

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
