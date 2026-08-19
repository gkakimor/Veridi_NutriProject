# Validação manual — sessão pós-incidente Railway

Registro do que o Product Owner pediu clicando no sistema local, o que foi
aplicado e o que virou backlog.

- **Branch:** `validacao/ajustes-ux` (9 commits)
- **`main`:** intocada em `4b8f714` — nada publicado, nenhum deploy disparado
- **Ambiente:** local (`127.0.0.1:3333` API / `127.0.0.1:5173` web)
- **Período:** a partir da interrupção do deploy Railway (incidente de
  plataforma, "Deployments are slow to progress")

Cada item foi verificado por clique real no navegador, não só por código.

---

## 1. Aproveitar a largura da tela

**Pedido:** "talves pudessemos expandir este componente pra aproveitar melhor o
espaco em tela? esta cortando ruim de ver" · "conseguimos usar o espaço da
página inteira? meu monitor eh o padrao 1920-1080"

**Resultado: APLICADO** — `8538b49`, `cdc153d`

A coluna de documento era fixa em 1040px e continuava 1040px num monitor de
1920 — quase 900px de mesa vazia. O limite existia para manter linha de texto
legível, o que é preocupação real; passou a viver onde pertence: nos parágrafos
explicativos (`max-width: 90ch`), não nas tabelas.

| | antes | depois |
|---|---|---|
| `.doc-body` | 1040px | `min(1600px, 100%)` |
| tabela de produtos do projeto @1920 | 990px | 1550px |

Medido em 1280, 1366, 1440 e 1920 — sem overflow horizontal em nenhuma.

**Trade-off registrado:** tabela esparsa (cinco colunas) agora se espalha, e a
coluna de ações fica longe dos dados. Tabelas densas — recebimento, componentes,
composição do CMV — são as que motivaram a mudança e ganham sem esse efeito.

**Erro no caminho:** eu disse "recarregue, o Vite já aplicou" sem ter medido. O
Vite servia CSS velho depois da troca de branch (`cssMax: "1040px"` medido, com
o arquivo em disco já em `min(1320px, 100%)`). Resolvido matando o dev server e
apagando `node_modules/.vite`.

---

## 2. Mostrar as quatro ações do produto, não duas

**Pedido:** "pq so mostra 2 itens? atualmente Formulação | CMV | ⋯ esta assim,
gostaria de ver todos ali"

**Resultado: APLICADO** — `409097a`

Formulação, CMV, Custos e Precificação são quatro passos de um caminho só,
percorrido nessa ordem. Dois estavam atrás de um menu `⋯` porque quatro botões
não cabiam em 1366px de uma coluna de 1040px. Com a coluna mais larga e a
célula de ação fixada, esconder metade do caminho virou escolha — e uma escolha
ruim: as auditorias vinham achando gente que não sabia onde a precificação
nascia.

Verificado em 1280, 1366, 1600 e 1950: a célula de ação fica inteira dentro da
área visível em todas.

---

## 3. Centralizar as ações e dar um título à coluna

**Pedido:** "centralize as 4 opcoes no espaco e tbm coloque um titulo coerente
'configuracoes produto?' algo assim"

**Resultado: APLICADO** — `f9cff3b`

A coluna ganhou o nome que o próprio sistema já usa para essas quatro telas um
parágrafo abaixo: **"Cadeia técnica"**. Grupo centralizado sob o cabeçalho
(`.table__actions--centered`, `th.is-actions-head`).

---

## 4. "Cadastrar novo" como primeira opção da lista

**Pedido:** "estas opcoes de novo produto, novo client ou qualquer novo na lista
teria como ser a primeira opcao da lista?"

**Resultado: APLICADO** — `81bf4a9`

Ficava no fim. Com 539 itens no catálogo, isso significa rolar até o fim para
cadastrar o que ainda não existe — a ação some exatamente quando a lista é
longa, que é quando ela mais importa.

Ordem visual, ordem no DOM e ordem do teclado seguem iguais, então nada foi
fixado onde um leitor de tela anunciaria fora de lugar. O que preserva a
garantia antiga é onde o item ativo começa: no primeiro resultado real, então
digitar e apertar Enter continua selecionando em vez de criar. Sem nenhum
resultado, Enter cai na única ação que sobra — cadastrar — em vez de não fazer
nada.

---

## 5. Cálculo salvo sem caminho para ativar a estrutura

**Pedido:** "cadastrei os custos e salvei, e fui direcionado pra esta tela, nela
nao tenho a opcao de ativar estrutura de custos"

**Resultado: APLICADO** — `c274a94`

Defeito real. A tela de cálculo se declarava como a tela de estrutura de custos
(`current="costs"`), e a barra de links relacionados esconde o link para onde
você já está — então ela removia "Custos industriais", o único destino onde um
rascunho é ativado. Salvar um cálculo deixava a pessoa numa página que avisava
que a estrutura era rascunho e não oferecia nada a respeito.

Cálculo não é estrutura: passou a `current="calculation"`, e o aviso de rascunho
carrega o caminho junto.

---

## 6. Hyperlink nos códigos de material

**Pedido:** "transforme entao os MP-000001 com hyperlink para eu conseguir desta
tela ja abrir a materia prima pra ajustar ela"

**Resultado: APLICADO** — `e7e14b3`

O detalhamento é onde "sem custo conhecido" é diagnosticado, e o item que ele
nomeia era texto puro. Material e recurso industrial agora abrem dali — o
recurso porque é onde mora a tarifa dele.

**Ressalva dita na hora:** abrir o item **não** resolve "sem custo conhecido".
Custo de matéria-prima não é campo de cadastro; vem de compra real (OC →
confirmar → Recebimento → "Definir custo" na linha).

---

## 7. Onde se define custo de matéria-prima

**Pedido:** "onde eu defino custo?"

**Resultado: RESPONDIDO — sem alteração de código**

Não existe campo de custo no item, de propósito. A referência sai de
recebimento com `actualUnitCost`, na hierarquia
`WEIGHTED_AVG_30D → WEIGHTED_AVG_90D → LAST_REAL_COST → NO_COST`
(`packages/shared/src/costs.ts`). Preço de OC nunca vira custo.

---

## 8. Por que o produto novo ficou sem custo

**Pedido:** "pq este produto esta sem custo neste novo projeto que estou
fazendo?"

**Resultado: DIAGNOSTICADO — e virou o item 9**

Os materiais tinham custo (`MP-000001` R$ 150,00/kg, `MP-000003` R$ 180,00/kg).
As causas eram outras duas: a estrutura `EC-001003` nunca tinha sido ativada, e
tinha uma pendência bloqueante — `ENERGY_RESOURCE_MISSING`.

**Achado colateral, NÃO corrigido (backlog):**
`GET /items/:id/cost-reference?referenceDate=2026-08-18` devolve `NO_COST` para
item recebido às 20:53 do mesmo dia — a data vira meia-noite e o recebimento
fica fora do `lte`. O CMV não sofre disso
([product-cmv.service.ts:30](../apps/api/src/modules/product-cmv/product-cmv.service.ts#L30)
normaliza para fim do dia), mas essa rota não normaliza.

---

## 9. Deixar as pendências evidentes

**Pedido:** "nao tem como deixarmos evidente de alguma forma estas pendencias de
configuracoes? pra ficar mais facil pro usuario saber oque falta?"

**Resultado: APLICADO** — `0fbbbe7`

A lista existia, em texto de dica cinza no meio do resumo. Virou painel de
destaque, e cada pendência leva para onde se resolve.

Mudança de contrato na API — `IndustrialCostPendencyDTO` ganhou:

| campo | serve para |
|---|---|
| `severity: "BLOCKING" \| "INFO"` | a mesma que decide `complete`; a tela não reimplementa a regra |
| `target` | `SELF` / `PRODUCT` / `FORMULATION` / `RESOURCE` |
| `resourceId` | link direto para o recurso quando a tarifa é o que falta |

Onde aparece: tela da estrutura (com âncora para a seção certa), tela de CMV e
resumo dentro do cadastro do produto — os dois lugares onde a ausência é
percebida. O diálogo de "Ativar com pendências?" passou a listar quais são, e o
badge conta ("1 pendência" em vez de "Com pendências").

---

## 10. Item removido da formulação continua aparecendo no CMV

**Pedido:** "eu mudei a formulacao de produto para o v2 sem um dos itens, mas
ele ainda ta mostrando o item ainda na formulacao, talves nesta tela tbm mostrar
qual formulacao estou usando com um hyperlink pra tela?"

**Resultado: APLICADO** — `d68fb3f`

Não era bug de cálculo — era rótulo mentindo. A seção "Base do cálculo" mostrava
a formulação **ativa do produto**, não a que o cálculo congelou. Depois de
publicar a V2, ela dizia "V2" ao lado de uma composição que descrevia a V1,
remoção de ingrediente incluída.

- API: campo novo `basisFormulationVersionNumber` — a versão que o cálculo
  congelou, ao lado da ativa
- Tela: mostra a congelada, com hyperlink em cada documento da cadeia
  (formulação, estrutura, cálculo), e declara a divergência quando existe
- Saída: criar versão de estrutura **copia** a formulação da origem, então
  "Nova versão" sozinha nunca chegava na V2. O diálogo passou a oferecer, com
  checkbox marcado por padrão

---

## Backlog — decidido, não construído

Ordem definida pelo PO: **C → B → A**.

### C. Criar nova versão a partir de qualquer versão do histórico

**Prioridade 1 — é o único que corrige defeito, não que adiciona conforto.**

[formulations.service.ts:304](../apps/api/src/modules/formulations/formulations.service.ts#L304)
só deixa forkar da ATIVA:

```ts
if (source.status !== "ACTIVE") throw new VersionNotActiveError();
```

Hoje não dá para voltar para a V1 — o histórico é guardado e não pode ser usado.
Guardar a história sem caminho de volta é meia história.

Verificações exigidas pelo PO:

1. Validar o clone: componente pode ter sido desativado ou removido desde então.
   Mostrar o que não veio, em vez de criar uma V3 quebrada.
2. Rotular a origem no histórico ("V3 — criada a partir da V1"). Sem isso, daqui
   a seis meses o salto de custo entre V2 e V3 fica sem explicação.

### B. Trazer rascunho de estrutura para a formulação ativa

**Prioridade 2 — transforma um aviso existente em ação.**

A pendência `FORMULATION_OUTDATED` já avisa que o rascunho ficou defasado, mas
não oferece saída. Rascunho não congelou nada, então repor a receita é seguro.

### A. Diálogo de impacto ao ativar formulação

**Prioridade 3 — e menor do que a proposta original.**

Antes de ativar a V2, listar o que fica defasado com link em cada um:
estruturas de custo ATIVAS (não mudam, e o diálogo diz isso), rascunhos de
estrutura, ordens de produção em rascunho apontando para a versão antiga.

**Pendência aberta:** ordens de produção em rascunho aparecem na lista de A, mas
nem B nem C as consertam. Ou ganham o mesmo botão de B, ou o diálogo lista um
item sem caminho de saída.

**Decisão de produto registrada:** propagação automática para estruturas ATIVAS
foi **recusada**. Uma estrutura ativa é referenciada por cálculo salvo,
precificação e OP liberada; se mudasse sozinha, o custo de uma OP já liberada
mudaria depois do fato. Congelar é o que torna o CMV reproduzível.

**Ressalva sobre fadiga de diálogo** (aceita pelo PO): cada aviso novo custa
atenção. Se toda ação abrir diálogo, o usuário passa a clicar "Confirmar" sem
ler. Poucos diálogos, nos pontos onde a ação muda o que outra tela vai mostrar.

---

## Backlog — oferecido, não aceito

- **Agrupar a tabela COMPONENTES** (10 colunas). Proposta: juntar
  pureza/overage/equivalente numa coluna só de "correções". Não houve decisão.
- **Melhorar a mensagem vazia** "Nada disponível para escolher."

---

## Backlog — Railway

Nada foi tentado desde a decisão de parar. Política combinada, porque cada
tentativa falha consome crédito do PO:

- zero tentativas até `status.railway.com` mostrar **Resolved**
- depois, **uma** tentativa por vez, via "Deploy latest commit" no painel
- **nenhum push para `main`** — cada push dispara um deploy e engrossa a fila

Pendente e já autorizado pelo PO, aguardando janela saudável:

- reset do PostgreSQL de produção + migrations versionadas + `db:demo`
- smokes de deploy
- tag `rc-multiproduto-cmv-2026-08-18`
- remover no painel o deployment travado `78432ba7` (a CLI não cancela)

Produção segue servindo `1575d63`, saudável. O banco **não** foi apagado de
propósito: derrubar o schema enquanto o binário antigo serve quebraria o app
publicado durante um incidente fora do nosso controle.

---

## Verificação

| | |
|---|---|
| Testes web | 90 passando |
| Testes API (CMV + custos industriais) | 35 passando |
| Typecheck | limpo em `apps/api` e `apps/web` |
| Validação de tela | Playwright headless, clique real, em cada item |

Nenhuma expectativa de teste foi relaxada para acomodar mudança de tela.
