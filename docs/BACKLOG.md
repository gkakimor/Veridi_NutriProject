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
| LOW | 3 |

Nada operacional aberto. As três auditorias profundas (VAL-LEG-01, 02, 03), o
hardening pré-cliente e o polimento visual estão fechados — findings e
correções em [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md).

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

### 11. Recurso industrial sem tela de criação — LOW

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

**Decisão / próxima ação:** fazer quando houver um segundo consumidor, ou
quando a edição do recurso virar formulário de verdade. Enquanto for uma tela
para um papel, o modal basta.

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

Os três LOW ainda abertos — instabilidade da suíte (3), dado legado sem
cliente (6) e a tela de Recurso industrial (11) — não bloqueiam a validação e
não devem ser corrigidos durante a reunião. A matriz de permissão por papel é
boa pauta PARA a reunião.

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
