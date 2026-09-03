# Validação por interface — baseline, correção e revalidação

**Rodada:** VALIDATION RELEASE · setembro de 2026
**Base:** `bbabd2c` · branch `validation/full-ui-e2e`
**Estado:** baseline medido, corrigido, e revalidado com três E2E e nova auditoria

---

## Por que esta rodada existe

As validações anteriores (VAL-LEG-01 a 03) provaram que o domínio se comporta.
Elas não provaram que **uma pessoa consegue operar o sistema pela tela**: parte
dos dados nascia por seed, API ou fixture, e um seed que adianta o cadastro
prova que o banco aceita a linha, não que a tela deixa a pessoa criá-la.

A regra desta rodada é uma só: **todo dado de negócio nasce pela interface.**
Fora da interface, apenas `POST /auth/login` e `GET` de conferência. Cliente,
fornecedor, item, produto, formulação, custo, pedido, ordem e documento são
criados por clique. Onde a interface não permite concluir, o cenário **falha** —
e a falha é o resultado, não um obstáculo a contornar por API.

## Ambiente

| | |
|---|---|
| Banco | PostgreSQL local `veridi_dev`, recriado do zero |
| Aplicação | API `127.0.0.1:3333`, web `127.0.0.1:5173` |
| Usuário | `admin@veridi.local` — criado pelo seed de infraestrutura |
| Produção | **Não tocada.** Nenhuma leitura ou escrita no Railway nesta rodada |

### Preparação da base

`scripts/local-db-reset.mjs` faz backup, verifica, recria e semeia — nessa
ordem, que não se inverte: **primeiro o backup, e só depois o drop**. A
verificação não olha só o tamanho do arquivo; roda `pg_restore --list` e exige
tabelas com dados, porque um dump truncado tem bytes e não tem conteúdo.
Falhando qualquer etapa da verificação, nada é apagado.

Backup desta rodada: `handoff/backups/local-pre-e2e-2026-09-03T04-12-10.dump`,
3,8 MB, íntegro.

O destino passa por `scripts/local-db-guard.mjs`, cuja regra é inversa à
intuição: **não basta parecer produção para recusar; é preciso provar que é
local para permitir.** Qualquer dúvida recusa. A guarda exige host na lista
branca (`localhost`, `127.0.0.1`, `::1`), recusa marcas de banco gerenciado na
URL (Railway, Neon, Supabase, AWS, Azure, GCP, Render, Heroku, PlanetScale,
DigitalOcean), recusa nome de banco contendo `prod`, `production`, `producao`,
`railway` ou `live`, e recusa executar se `DATABASE_PUBLIC_URL`,
`RAILWAY_ENVIRONMENT` ou `RAILWAY_PROJECT_ID` estiverem no ambiente — porque ter
as duas credenciais à mão é exatamente como a errada acaba sendo usada.
`NODE_ENV` não entra na decisão: é convenção de aplicação, não propriedade do
banco, e continua valendo `development` numa máquina que acabou de exportar a
URL de produção. A guarda é chamada duas vezes, redundância deliberada. 13
testes cobrem as recusas.

### O que o seed planta

`apps/api/prisma/seed-infra.ts` — **e nada além disso**:

- as 6 unidades de medida, que não têm tela de cadastro e são tabela de
  referência: sem elas nenhum item salva;
- um usuário, porque criar o primeiro pela interface exigiria estar logado.

O seed **lança erro** se encontrar qualquer cliente, fornecedor, item ou produto
no banco. A contagem é a prova de que ele não adiantou trabalho: se alguém um
dia acrescentar um cliente "só para facilitar", o número deixa de ser zero e a
validação por interface para de valer.

## Método

Cada jornada é um script Playwright que dirige o navegador como um operador
faria, com captura de marcos, monitoração de `console.error`, `pageerror` e
respostas HTTP ≥ 400, separando as falhas deliberadas das inesperadas.

As três jornadas rodam **em sequência, nunca em paralelo** contra o mesmo banco:
duas escritas simultâneas embaralhariam sequences e tornariam qualquer defeito
de concorrência indistinguível de defeito de produto. A base **não** é limpa
entre elas — cada cenário herda o anterior, o que também exercita o sistema com
histórico, e não só em base vazia.

A auditoria de UX correu em paralelo por ser **estritamente somente leitura**:
sem criar, editar, confirmar ação, alterar banco ou commitar.

---

## E2E 1 — Comercial completo, do projeto ao faturamento

**Veredito: PASS WITH FINDINGS.** 27 de 27 marcos alcançados. Todo registro de
negócio criado pelo navegador.

Produto sintético de referência técnica: Coenzima Q10 200 mg, 30 doses, seis
componentes. Identidades fictícias.

### Documentos criados

| Etapa | Códigos |
|---|---|
| Cliente e fornecedores | `CLI-000001`, `FOR-000001`, `FOR-000002` |
| Itens | `MP-000001`…`MP-000005`, `ME-000001`, `PA-000001` |
| Compras | `OC-000001` (R$ 13.390,00), `OC-000002` (R$ 1.440,00) — ambas recebidas |
| Recebimentos | `REC-000001`, `REC-000002` → lotes `LT-20260903-000001`…`000006` |
| Projeto e produto | `PROJ-000001` → `PROD-000001`, formulação **V1 ativa, 6 componentes** |
| Custo industrial | recursos `REC-000001/2/3`, `EC-000001 · V1` ativa (base 1000, energia derivada 40 kWh), `CALC-000001` |
| Precificação | `PREC-000002 · V2` ativa, faixas 300/500/1000 |
| Comercial | `ORC-000001 · V1` enviado e aceito → `PED-000001` |
| Produção e saída | `OP-000001`, `EXP-000001`, `FAT-000001` (980 un, R$ 3.528,00) |
| Produto acabado | lote `LT-20260903-000007` · lote do cliente `E2E1-CQ10-001` |

### Provas exigidas

As sete passaram. Duas merecem registro:

**Salvar antes de ativar.** Embalagem adicionada e deliberadamente **não**
salva; clique direto em "Ativar versão". A versão ativa saiu com os seis
componentes. É a correção de `fix/data-integrity-mediums` confirmada por
comportamento, não por teste unitário.

**Planejado × realizado.** 1000 planejadas, 980 apontadas; o sistema exigiu
motivo da variação antes de concluir.

### Console e rede

Zero `console.error` inesperado. Zero resposta ≥ 400 inesperada. **14
`pageerror`**, todos da mesma recursão na validação nativa descrita abaixo.

21 estados vazios registrados, e a maioria explica onde a coisa nasce — por
exemplo, em Produtos: *"Nenhum produto ainda. O produto nasce aqui, em
desenvolvimento, e só vira operacional quando o projeto for aprovado com ele na
proposta aceita."*

### O CMV divergiu — e o problema está na referência

O sistema calculou **R$ 11.004,19 por 1000 potes**, ou R$ 11,00 por unidade,
contra R$ 2,43 da planilha de referência. Fator 4,52×.

A conta da própria planilha não fecha. Com 200 mg por dose e 30 doses por pote,
são 6 g de Coenzima Q10 por pote; aplicando pureza 0,98 e overage 0,2 chega-se
aos **7,347 kg por lote de mil** que a planilha registra. A R$ 1.200/kg, **só o
ativo custa R$ 8.816** — três vezes e meia o CMV total declarado de R$ 2.431,87.

Ou o preço do Q10 não é R$ 1.200/kg, ou o lote não é de mil potes. **O número do
sistema é o aritmeticamente defensável** a partir dos insumos informados. Isto é
um achado sobre a planilha de origem, não sobre o software — mas precisa de
confirmação de quem mantém o número real antes de servir de referência.

---

## E2E 2 — Suprimentos e produto direto

**Veredito: PASS WITH FINDINGS.** 18 de 18 marcos, 65 verificações, nenhuma
falha. A jornada inteira foi percorrida: fornecedor, itens, compra,
recebimento, qualidade, estoque, produto direto, formulação em branco,
estrutura de custos, cálculo, CMV, pedido e produção até o lote de produto
acabado.

Produto sintético: Vitamina D3 60 cápsulas — premix 100.000 UI/g, celulose 102,
estearato e pote PET. Cenário independente do E2E 1, como exigido.

### Documentos criados

`FOR-000003` · `MP-000006/7/8` · `ME-000002` · `OC-000003` (R$ 3.126,00,
recebida) · `REC-000003` → lotes `LT-20260903-000008`…`011` · `CLI-000002` ·
`PROD-000002` + `PA-000002` · formulação V1 ativa com 4 componentes · recursos
`REC-000004/5/6` · `EC-000002·V1` → `EC-000003·V2` · `CALC-000003/4` · **CMV
R$ 2.577,04 para 500 unidades, R$ 5,15 por unidade** · `PED-000002` ·
`OP-000002` (500 de 500) · `LT-20260903-000012`.

### O que o cenário provou

**Produto direto nasce diferente do produto de projeto.** Cliente é
obrigatório e barra o envio; `PA-000002` sai automático; o produto nasce
`APPROVED` com **zero versões de formulação** — contra `DEVELOPMENT` com V1
rascunho do produto nascido de projeto no E2E 1. As duas portas de entrada
produzem estados coerentes com a sua origem.

**Criação contextual sobrevive a um F5.** No campo Cliente de
`/cadastros/produtos/novo`, "+ Novo cliente" navega para a página canônica; a
página foi recarregada com F5 e continuou contextual, com a trilha canônica
(`Cadastros › Clientes › Novo cliente`) e não a da origem; salvou, voltou, e os
**11 campos do rascunho estavam idênticos**, com o cliente selecionado e
`produto.customerId` conferido por leitura.

**A busca de catálogo é do servidor, não do navegador.** `GET
/items?search=…&type=RAW_MATERIAL` observado na rede. `PA-000002` existe no
catálogo e **fica fora** da lista de matéria-prima — achar não virou poder usar.

**Exportação** em três telas, arquivos não vazios e respeitando o filtro
aplicado. **Breadcrumbs**: quatro subidas reais clicando na trilha.

### Console e rede

Zero `console.error`, `pageerror` e respostas ≥ 400 inesperados. Os deliberados
foram isolados: um `POST /industrial-resources/…/rates → 400` (vírgula
decimal) e sete `RangeError` (campo obrigatório vazio). Nenhum carregamento
acima de 4 s, nenhum salto de leiaute, nenhuma ação sem retorno visual.

9 estados vazios registrados. O melhor deles, na fila de CoA, chega a dizer
onde a decisão *não* é tomada: *"Esta fila mostra o andamento do laudo (CoA); a
liberação de lote para uso é decidida em Estoque › Lotes…"*.

---

## E2E 3 — Material do cliente e templates

*Pendente. Aguardando revisão dos dois primeiros antes de iniciar.*

---

## Auditoria de UX — nota 7,1, "bom com atritos"

Somente leitura, em paralelo às jornadas. Doze eixos:

| Eixo | | Nota | Eixo | | Nota |
|---|---|---|---|---|---|
| A | Clareza | 8 | G | Hierarquia visual | 8 |
| B | Navegação | 6 | H | Formulários | **9** |
| C | Eficiência | 7 | I | Tabelas | 6,5 |
| D | Consistência | 6 | J | Acessibilidade | 6 |
| E | Prevenção de erros | 7 | K | Feedback | 7 |
| F | Recuperação | 6,5 | L | Aprendizado | 8 |

O perfil é coerente: o sistema **explica bem** (clareza 8, aprendizado 8,
formulários 9 — fruto da ajuda contextual e das dicas de campo) e **navega
mal** (navegação 6, consistência 6, acessibilidade 6). Quem chega entende o que
a tela quer; quem opera todo dia tropeça em onde as coisas estão.

Navegação sem treinamento prévio: **6 de 10**. Cinco tarefas ainda exigiriam
treino explícito.

---

## Findings

Severidade atribuída por consequência, não por esforço de correção. **Falha
silenciosa que produz dado errado é HIGH**, mesmo quando o conserto é de uma
linha: o operador não descobre no momento em que ainda daria para consertar.

> **Nota de correção.** A primeira redação deste documento trazia três HIGH
> apoiados na premissa de que a recusa de vírgula decimal era **silenciosa**. O
> E2E 2 mediu o mesmo comportamento e a contradisse: a tela exibe "Erro de
> validação" e a rede devolve 400. Verifiquei os dois pontos diretamente, no
> banco e no código, e a segunda medição está certa. As severidades abaixo
> refletem a verificação, não o primeiro relato.

### HIGH

**H1 — Ordem de Produção conclui com material não consumido, sem aviso.**
`OP-000001` está `COMPLETED` com **6 requisitos e 1 item consumido**.
Confirmado nos dados e no código: `completeProductionOrder`
(`apps/api/src/modules/production-orders/production.service.ts:169`) exige
apenas que exista ao menos um `ProductionOutput`, e motivo quando a
*quantidade produzida* varia. **Consumo nunca é comparado com requisito.** A OP
conclui, libera as reservas ativas e congela o snapshot de custo.

Três consequências, não uma:

1. o lote de produto acabado nasce com a **árvore de rastreabilidade
   incompleta** — declara-se feito de seis materiais e tem registro de um;
2. os cinco materiais **nunca baixaram do estoque**, então o saldo em livro
   diverge do chão de fábrica sem que nenhum ajuste registre a diferença;
3. o custo congelado da OP fica **subestimado**, e ele é histórico.

Colide com três regras de `CLAUDE.md`: consumo real confirmado é o que baixa
estoque, histórico de estoque é auditável, e rastreabilidade é prioridade dois.
`OP-000002` fechou 4 de 4 — o sistema aceita os dois desfechos igualmente.
Causa direta de contribuição em L1. Registro preservado na base como evidência.

**H2 — Recursão infinita na validação nativa.** `apps/web/src/lib/native-validation-ptbr.ts:23`
— `aoInvalidar` chama `campo.reportValidity()`, que redispara o evento `invalid`
que o próprio handler escuta em `document`, fase de captura, sem guarda de
reentrância. Enviar formulário com campo obrigatório vazio gera séries de
`RangeError: Maximum call stack size exceeded` — 14 no E2E 1, 7 por submissão no
E2E 2. Nada quebra para o operador, porque o balão traduzido aparece; o custo é
que **todo formulário obrigatório polui o console**, e diagnóstico futuro passa
a começar filtrando ruído conhecido.

**H3 — Sidebar esconde 41% do menu sem indicação.** Em 1440×900, `scrollHeight`
1472 contra `clientHeight` 848. Itens inteiros de menu ficam fora da área
visível sem barra de rolagem perceptível. Quem não sabe que existem não os
encontra — é o eixo que puxa a navegação para 6.

### MEDIUM

**M1 — Vírgula decimal recusada com mensagem genérica.** Campos de dinheiro
aceitam `0.85` e recusam `0,85`. Confirmado em `#rate-value` (tarifa de
recurso), `#cost-rate` (premissa) e `#tier-price` (faixa de preço).
`decimalStringSchema` exige ponto e essas telas enviam o texto cru — diferente
de `#item-purity`, que normaliza. A tela mostra "Erro de validação" e a rede
devolve 400: **a operação falha visivelmente**, mas a mensagem não diz que o
problema é o separador. Num ERP inteiro em português, a vírgula é o que o
operador digita, e a mensagem não o leva à correção.

O efeito observado no E2E 1: `PREC-000001 · V1` ficou com **uma faixa em vez de
três**. Não foi perda definitiva — o operador percebeu e criou
`PREC-000002 · V2` com as três, e é assim que a base está hoje. A recuperação
por versão nova funcionou.

**M2 — Estrutura de custo ativa com pendência bloqueante.** A tela pergunta
*"Ativar estrutura com pendências?"* e permite ativar com
`ENERGY_NOT_CONFIGURED`. O cálculo resultante sai **sem "Custo por unidade"** e
a gravação passa a perguntar *"Congelar um custo incompleto?"*. O sistema avisa
duas vezes e a API exige `confirmIncomplete` explícito
(`industrial-costs.service.ts:1008`), então não é falha silenciosa — mas é um
caminho fácil de percorrer sem perceber, e o que sai dele alimenta preço.
Corrigido no E2E 2 pela própria tela, com `EC-000003 · V2`.

**M3 — Prefixo `REC` colide entre recebimento e recurso industrial.**
`RECEIPT_CODE_PREFIX = "REC"` em `packages/shared/src/receiving.ts:6` e
`CODE_PREFIX = "REC"` em `industrial-resources.service.ts:46`, com sequences
separadas, ambas começando em 1. Confirmado na base: `REC-000001`, `REC-000002`
e `REC-000003` nomeiam **duas entidades diferentes cada um**. O código é o
identificador humano — o que se fala, se escreve no papel e se digita na busca;
duplicá-lo torna "confere o REC-000002" uma frase ambígua. Causa raiz
estrutural: todo prefixo mora em `packages/shared`, menos este, cravado no
serviço — por isso a colisão passou.

**M4 — Ajuda contextual descreve a tela errada.** `/comercial/pedidos` abre "Como
o Plano de Atendimento decide o que fazer". `CustomerOrdersPage.tsx:141` usa
`helpTopics["planoAtendimento.comoFunciona"]` porque `pedido.comoFunciona` não
existe. Confirmado nos dois cenários.

**M5 — Pedido em atendimento fica sem ajuda nenhuma.** O único `ContextHelp` do
documento vive dentro da seção Plano (`CustomerOrderPage.tsx:1136`), que só
renderiza com status `CONFIRMED` (linha 334). Em "Em atendimento" — exatamente
quando aparecem reserva, OPs e saldo a expedir — não há ⓘ na tela. A ajuda some
no momento em que o documento fica mais complexo.

**M6 — "Cancelar" descarta dado sem confirmar.** `/cadastros/clientes/novo`:
texto digitado, "Cancelar", volta sem diálogo.

**M7 — Colunas cortadas em tabelas densas.** Clientes em 1280×720 perde
Telefone, Status e Editar; Documentos/CoA perde já em 1440×900.

**M8 — "Limpar filtros" aparece em algumas listas e não em outras.** Presente em
Precificação, ausente em Clientes.

### LOW e NIT

**L1 — "Confirmar consumo" parece ação de seção e é ação de linha.** Contribui
para H1: quem clica uma vez acredita ter confirmado tudo.

**L2 — Trilha `.doc-crumb` não é clicável** em CMV, Formulação, Pedido, OP e
Lote — texto puro, enquanto Cadastros e Compras usam `<nav class="page-crumbs">`
com `<Link>`. Dois padrões visualmente idênticos com comportamentos diferentes.

**L3** — Botão de criar em dois estilos ("Novo projeto" limão sem "+" contra
"+ Novo cliente" verde-escuro).
**L4** — Mesma aba com dois nomes: "Custos" no Produto, "Custos industriais" na
Formulação.
**L5** — Cadeia técnica do Projeto fora da ordem de dependência real.
**L6** — Modal "Como funciona" não fecha ao clicar fora.
**L7** — Rodapé difere entre criar e editar cliente.
**L8** — Origem do lote (Recebimento, Ordem de Compra) é texto, não link.
**L9** — `<title>` fixo em "Veridi Nutrition" em todas as telas.
**L10** — "Como funciona" ausente em Consulta de Cliente, Templates de Estrutura
de Custos e Políticas de Precificação.
**N1** — Nome acessível de `<dt>` contaminado pelo botão de dica: "Produto
resultantei".

---

## Recomendação

*Parcial — a ser fechada após o E2E 3.*

**O sistema é operável pela interface.** Duas jornadas completas, 45 marcos,
nenhuma etapa precisou de API, SQL ou banco para avançar. Isso não era garantido
por nenhuma validação anterior, e é o resultado principal desta rodada.

**H1 é o único achado que eu trataria como impeditivo.** É o único que produz
dado errado sem que ninguém perceba, e o dano é triplo: rastreabilidade do lote,
saldo de estoque e custo histórico. Os outros dois HIGH incomodam — poluem o
console, escondem menu — mas não corrompem registro.

O que a rodada **não** encontrou também importa: nenhuma perda de dado
irreversível, nenhuma transação pela metade, nenhuma resposta ≥ 400 inesperada
em duas jornadas completas, e as validações de integridade fechadas na rodada
anterior (salvar antes de ativar, busca de catálogo no servidor) confirmadas por
comportamento e não por teste.

Nenhuma correção foi feita durante a validação, por decisão de método: uma
rodada que conserta enquanto mede deixa de saber o que mediu.

---
---

# Parte II — Correção e revalidação

Tudo acima é o **baseline**: o que existia antes, medido. Fica registrado como
foi, inclusive a nota 7,1 e os defeitos. Reescrever essa parte como se nunca
tivessem acontecido tiraria a única prova de que a rodada mudou alguma coisa.

## O que foi corrigido

### A Ordem de Produção não conclui com material por reconciliar

O HIGH da rodada. Regra nova em [PRODUCT_RULES §49](PRODUCT_RULES.md), três
colunas anuláveis no requisito, portão no servidor e a mesma decisão repetida na
tela antes do clique. Sem tolerância, porque o domínio já tomou essa posição em
`RecipeWeighing`: *diferença é registrada, nunca escondida*.

Motivo de material e motivo de produção **não compartilham campo** — uma OP pode
fechar 100% do planejado com falta de material, e vice-versa.

Ordens já concluídas **não** foram reconciliadas retroativamente: a regra vale
para concluir, não para reescrever documento histórico.

### Vírgula decimal, e o que ela escondia

O relato inicial dizia recusa silenciosa. A segunda medição contradisse — a tela
mostra erro e a rede devolve 400 — e a verificação revelou algo pior que recusa:
em quatro lugares `Number(texto)` virava `NaN` e o resultado **seguia adiante**.

O total da Ordem de Compra pulava a linha com vírgula e exibia um valor **menor
do que a ordem vale**, sem sinal de linha faltando. O Plano de Atendimento
acusava "Reservar + Produzir precisa somar exatamente" quando as parcelas
somavam. Recusar é ruim; calcular errado com cara de certo é outra categoria.

Tradutor único, com regra conservadora: um separador é sempre casa decimal, dois
separadores devolvem inválido em vez de adivinhar milhar — `1.234` é ambíguo e
adivinhar erra por um fator de mil, em campo que costuma ser preço ou peso.

### Colisão de prefixo, e as três que vieram junto

`REC` nomeava Recebimento **e** Recurso Industrial, com sequences separadas: os
dois começavam em 1 e produziam códigos idênticos para coisas diferentes.
Recurso passou a `RIN`.

A correção não parou nas três letras. Um teste de contrato passou a afirmar duas
coisas: nenhum prefixo se repete, e **nenhum fica declarado dentro de um
serviço** — porque foi por estar fora do lugar onde a comparação acontece que a
colisão passou meses. Esse segundo teste achou mais três na primeira execução:
`CALC`, `EC` e `PREC`. Não colidiam ainda.

### Erro que não se ouvia

`.form-alert` é o padrão de erro do sistema: 125 usos, e **só 14 tinham `role`**.
As outras eram visíveis e mudas para leitor de tela. Numa rodada que trata falha
silenciosa como HIGH, mensagem que não chega a quem não vê é exatamente isso.

Erro leva `alert`; condição persistente leva `status` — usar `alert` para o que
fica parado na tela ensina a ignorar o alerta seguinte.

### Precisão que o domínio não tem

`0.0061224489795918367347 kg` numa tela onde alguém confere o número contra uma
balança. O banco guarda `Decimal(18,6)`; o resto é ruído de divisão com
aparência de exatidão. Corte em seis casas, e valor abaixo disso vira "≈ 0" e
nunca "0" — zero significa "não precisa de material".

### Navegação

Sidebar virou coluna com miolo rolável e pista visível. Trilha `.doc-crumb`
migrou para `PageBreadcrumbs` em todas as dezesseis telas, e a classe morta saiu
do CSS. Pedido ganhou ajuda própria — antes abria a do Plano de Atendimento, e
sumia justamente em "Em atendimento". Seis telas de gestão que não tinham
"Como funciona" ganharam tópico próprio, com teste de contrato ligando página a
tópico.

## A revalidação

Base recriada do zero, e as três jornadas rodadas em sequência.

| Cenário | Veredito | Marcos | Verificações |
|---|---|---|---|
| E2E 1 — comercial, do projeto ao faturamento | PASS WITH FINDINGS | 28/28 | 194 |
| E2E 2 — suprimentos e produto direto | PASS WITH FINDINGS | 18/18 | 68 |
| E2E 3 — material do cliente e templates | **PASS** | 27/27 | 265 |

Nenhum defeito de produto nos três. Os findings restantes são de método — por
exemplo, a prova do bloqueio da OP fica limitada à camada de tela, porque tirar
`disabled` do DOM não dispara o handler do React; a recusa do servidor existe e
tem teste próprio.

**Zero `RangeError` nos três**, inclusive em submissões provocadas com campo
obrigatório vazio. Zero `console.error`, zero `pageerror`, zero resposta ≥ 400
inesperada.

O E2E 3 nunca havia rodado, e é o cenário mais difícil do domínio. Três provas
merecem registro:

- **Isolamento testado do jeito certo.** Os dois clientes receberam o *mesmo
  item*, ambos com saldo — sem isso, "o dono foi gravado" seria só um rótulo.
- **Recusa por proprietário provada ativamente.** Informar o lote do cliente B
  no picking da OP do cliente A é recusado pelo servidor, e o lote de B fica
  intocado. Provar ausência por ausência não prova nada.
- **Falta sem caminho de compra, medida por assimetria.** Duas faltas
  simultâneas na mesma tela: a da Veridi ganha "Ver sugestão de compra", a do
  cliente ganha "depende de nova remessa do cliente", sem botão.

## A auditoria depois — e o que ela encontrou de mim

Três auditores independentes, mesma rubrica de doze eixos, sem saber o que fora
corrigido nem que nota se esperava.

| | Usuário final | Operacional | Visual e acessibilidade |
|---|---|---|---|
| Média | 6,6 | 7,6 | 6,9 |

**Faixa 6,6 – 7,6, média 7,03**, contra 7,1 do baseline. Praticamente parado — e
a razão é a parte mais útil desta rodada.

**Três dos defeitos encontrados foram criados pelas correções, e dois deles eu
havia declarado como feitos em mensagem de commit.**

- **`scrollIntoView` sequestrou o Tab.** Revelar o item ativo do menu deslocava
  o ponto de partida da navegação sequencial: o primeiro Tab depois de carregar
  qualquer rota pulava o skip-link e tudo antes do item ativo. Consertar a
  descoberta com o mouse custou a descoberta com o teclado.
- **`dismissOnBackdrop` não funcionava.** O fundo escurecido é *irmão* do
  diálogo no DOM, e a varredura que marca o fundo como `inert` o marcava junto:
  sumia do teste de acerto do ponteiro e o clique nunca chegava. O commit
  afirmava que a ajuda fechava clicando fora. Não fechava.
- **A pista de rolagem media 1,16:1.** A receita foi copiada de onde a sombra
  cai sobre superfície clara; sobre o verde escuro do menu, escurecer não
  contrasta com nada.

**Os três vieram do mesmo erro de método:** verificar a *presença da
propriedade* em vez do *comportamento*. Perguntei ao CSS se o gradiente estava
aplicado — estava, e era invisível.

`scripts/check-a11y-regressoes.mjs` existe por causa disso: mede as seis
correções por comportamento, incluindo `elementFromPoint` no ponto exato do
clique. Antes devolvia o shell da aplicação; agora devolve o overlay.

## Decisão de release

A ser tomada pelo Product Owner com os números acima. O que a rodada entrega é o
material para decidir, não a decisão:

- **O sistema é operável pela interface.** 73 marcos em três jornadas, nenhuma
  etapa precisou de API, SQL ou banco para avançar.
- **Nenhum defeito de integridade permanece aberto.** O HIGH que existia — a OP
  concluindo sem reconciliar — está fechado com regra, portão de servidor e
  teste que falha contra o código anterior.
- **A nota de UX não subiu**, e não subiu por um motivo específico e corrigível,
  não por limite do sistema. As três regressões foram desfeitas depois da
  auditoria; a nota atual não as reflete.
