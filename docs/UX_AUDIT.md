# Auditoria de UX — gate pós-Bloco G

Três auditores independentes rodaram em modo somente-leitura sobre o produto em
execução (Chromium/Playwright, desktop 1440×900, base com o corpus real: 795
itens, 248 projetos, 214 produtos, 80 clientes, 113 fornecedores), sempre
entrando pelo Login/Dashboard/menu e **nunca** pela rota final. As definições
dos agentes estão em `.claude/agents/`:

- `ux-end-user-auditor` — orientação, descoberta, linguagem, recuperação de erro;
- `ux-operational-task-auditor` — tarefas ponta a ponta e continuidade entre módulos;
- `ux-visual-accessibility-auditor` — hierarquia visual, teclado, contraste, impressos.

Cada achado abaixo foi **verificado no código ou reproduzido** antes de entrar
neste documento; o que não se reproduziu está registrado como tal. As correções
foram revalidadas **pelo mesmo agente que encontrou o problema**.

---

## Executive summary

| Métrica | Nota |
|---|---|
| Facilidade de navegação sem treinamento | **5/10** (medida antes das correções; os dois bloqueios que puxaram a nota para baixo foram corrigidos e revalidados) |
| Continuidade entre módulos | **6/10** — com ressalva de cobertura (ver seção "Cobertura") |
| Legibilidade | **7/10** |
| Consistência visual | **8/10** |
| Acessibilidade básica | **4/10** (medida antes das correções de teclado e contraste) |
| Qualidade dos documentos impressos | **6/10** |

Contagem de findings de UX: **1 CRITICAL · 8 HIGH · 12 MEDIUM · 8 LOW**.
Corrigidos neste gate: **16**. Em backlog: **12**. Não confirmados: **1**.

## Top UX risks (observados)

1. **Caminho único para a formulação estava quebrado** — o botão "Abrir
   formulação" do projeto levava a "Produto não encontrado". Era o primeiro
   clique da história comercial. *(corrigido)*
2. **Cadastro travava com campo opcional em branco** — qualquer formulário que
   deixasse um texto opcional vazio recebia `Expected string, received null`,
   erro cru, sem indicação de campo. *(corrigido)*
3. **Estrutura de custos sem saída para produto sem lote mínimo** — o botão
   "Criar estrutura de custos" pedia a base de produção que a tela não oferecia.
   Afeta os 214 produtos legados, todos sem lote mínimo. *(corrigido)*
4. **Teclado não entrava nos modais de cadastro** — quem opera só por teclado
   não conseguia editar item, produto, fornecedor ou cliente. *(corrigido)*
5. **Material de propriedade do cliente aparecia sem dono na folha de contagem
   FO-01** — contar material de cliente junto com o da Veridi, sem dizer de
   quem é, é o caminho mais curto para tratar estoque alheio como próprio.
   *(corrigido na FO-01; a tela agregada de Posição de Estoque continua sem
   marcador — backlog)*
6. **Documentos internos de custo/preço perdem colunas no papel** — R-19 e R-20
   ainda estouram a folha A4 em paisagem. *(backlog: exige decidir quais
   colunas vão para o papel)*

## Task matrix

Resultado por tarefa, conforme executado pelos auditores (PASS / PASS WITH
FRICTION / FAIL). "Depois" reflete o estado após as correções revalidadas.

| Persona | Tarefa | Entrada | Resultado | Fricção | Evidência |
|---|---|---|---|---|---|
| Comercial | Criar projeto só com os campos obrigatórios | Sidebar → Projetos → Novo projeto | **FAIL → PASS** | erro cru `Expected string, received null` | reproduzido na API e corrigido com teste de regressão |
| Comercial | Abrir a formulação a partir do projeto | Projeto → Custo e precificação | **FAIL → PASS** | rota recebia id da versão onde se espera id do produto | `reaudit-formulacao.png` |
| Comercial | Criar a estrutura de custos de um produto novo | Projeto → Abrir custos | **FAIL → PASS** | botão exigia base de produção sem oferecer campo | campo "Base de produção" adicionado |
| Comercial | Enviar/aceitar orçamento e aprovar projeto | Projeto → Orçamento | **PASS** | avisos de irreversibilidade claros, bloqueios com texto de negócio | — |
| Comercial | Abrir produto a partir do projeto | Projeto → Abrir produto | **PASS WITH FRICTION** | deep link `?search=` não preenche a busca; cai em lista de 824 itens | backlog |
| Comercial | Escolher item na formulação | Formulação → adicionar componente | **PASS WITH FRICTION** | seletor lista 201 de 824 itens, sem busca | backlog |
| P&D | Criar amostra T1/T2 em projeto ativo | Projeto → Nova amostra | **PASS** | botão cria o rascunho no clique, sem tela intermediária (difere de Pedido/OC) | `reaudit-nova-amostra-waiting.png` |
| P&D | Entender por que "Nova amostra" some | Projeto aprovado | **PASS** (após correção) | texto vazio prometia ação indisponível | — |
| Produção | Localizar o que produzir e abrir a OP | Dashboard → OP com falta | **PASS** | tela da OP concentra necessidade, reserva, picking, consumo e custo | `audit-enduser-op-falta-material.png` |
| Produção | Resolver falta de material vista na OP | OP bloqueada / R-04 | **PASS WITH FRICTION** | sugestão de compra só existe dentro do Pedido em atendimento; nem a OP nem o R-04 apontam para lá | backlog |
| Expedição | Localizar pedido pronto e conferir lote | Dashboard → Precisa de atenção | **PASS** | "Lotes conferidos X/Y", lote errado devolve mensagem tratada | `audit-task-expedicao-confirm-dialog.png` |
| Expedição | Expedir parcial | Expedição rascunho | **PASS** | campo "Enviar agora" vem com o saldo total; parcial exige editar | quick win em backlog |
| Faturamento | Localizar pendente e emitir | Sidebar → Faturamento | **PASS** | seção "Aguardando faturamento" no topo; textos deixam claro que não é NF | `audit-task-expedicao-issue-dialog.png` |
| Estoque | Localizar item pela busca do topo | Busca do masthead | **FAIL → PASS parcial** | a busca só resolve lote; o placeholder prometia item e OP | placeholder corrigido; busca de item/OP é backlog |
| Estoque | Localizar item pelo menu | Estoque → Posição | **PASS** | filtra e abre detalhe com custo e quebra por lote | — |
| Estoque | Entender Físico/Reservado/Disponível/Em compra | Posição de estoque | **PASS WITH FRICTION** | nenhum tooltip define os quatro termos | backlog |
| Estoque | Abrir rastreabilidade do lote | Lotes → lote | **PASS** | cadeia nos dois sentidos (recebimento/OC → OP → lote de PA) e impressão dedicada | `audit-task-estoque-rastreabilidade-print.png` |
| Estoque | Imprimir FO-01 | Estoque → Inventário físico | **PASS** (após correção) | folha misturava material de cliente sem identificar o dono | coluna "Proprietário" adicionada |
| P&D | Consumir lote numa amostra | Amostra → Material consumido | **FAIL → PASS** | seletor de item mostrava 100 de 824; os itens do cenário eram inalcançáveis | teto do seletor corrigido |
| Compras | Gerar OC para fornecedor novo | Compras → Nova OC | **FAIL → PASS** | `<select>` trazia 100 de 113 fornecedores; FOR-000903 invisível | teto do seletor corrigido |
| Compras | Receber parcialmente | OC-009091 → Receber materiais | **PASS** | tela mostra Pedido/Recebido/Aberto por linha, sem ambiguidade | — |
| Qualidade | Liberar lote antes do laudo | Lote → Liberar | **PASS WITH FRICTION** | diálogo promete disponibilidade; o backend recusa depois, corretamente | backlog |
| Produção | Executar OP ponta a ponta | OP → picking → receita → consumo → output → concluir | **PASS WITH FRICTION** | usuário gravado como "Ambiente local" em consumo/output/conclusão | consumo corrigido; resto em backlog |
| Qualidade | Tratar laudo e liberar lote | Qualidade → documentos | **PASS** | recusa liberação sem CoA e aprovação de CoA sem anexo, com texto acionável | — |

## Findings

| ID | Sev. | Fluxo/Tela | Evidência | Impacto no usuário | Correção mínima | Backlog? |
|---|---|---|---|---|---|---|
| UX-01 | CRITICAL | Modais de cadastro (Itens, Produtos, Fornecedores, Clientes) | foco permanecia na `<tr>` de fundo; Tab percorria a tabela atrás do modal | operação 100 % teclado não editava nenhum cadastro | foco inicial no diálogo, Tab preso, foco devolvido ao fechar | corrigido |
| UX-02 | HIGH | Projeto → "Abrir formulação" | ia para `/producao/formulacoes/{formulationVersionId}` numa rota que espera `productId` → "Produto não encontrado" | trava o primeiro passo da história comercial | usar `productId` + rota da versão | corrigido |
| UX-03 | HIGH | Qualquer formulário com texto opcional em branco | `POST /projects` devolvia 400 `Expected string, received null` para concept/channel/externalCode/notes | impossível cadastrar sem preencher campos opcionais | `optionalNullableText` passa a aceitar `null` como "limpar" | corrigido + teste |
| UX-04 | HIGH | Produto → Custos → "Criar estrutura de custos" | POST sem corpo → "Informe a base de produção"; nenhum campo na tela | beco sem saída para os 214 produtos sem lote mínimo | campo "Base de produção" antes de criar | corrigido |
| UX-05 | HIGH | Estoque de material do cliente | FO-01 listava `ME-000545` (rótulo do cliente) sem identificar dono, junto com material Veridi | risco de contar/usar material alheio como próprio | coluna "Proprietário" na FO-01 (padrão que FO-02/FO-03 já usam) | corrigido; Posição de Estoque agregada segue sem marcador → backlog |
| UX-06 | HIGH | Navegação por teclado | ~37 Tabs até a primeira ação da página; sem skip link (WCAG 2.4.1) | quem usa teclado atravessa a navegação inteira em toda tela | link "Pular para o conteúdo" | corrigido (2 Tabs) |
| UX-07 | HIGH | Impressão R-19 e R-20 | 1319 px e 1398 px de conteúdo em 1047 px úteis de A4 paisagem | colunas da direita se perdem no papel | decidir quais colunas vão ao papel | **backlog** |
| UX-08 | MEDIUM | Menu "⋯" das listas | Enter no botão abria o cadastro (a linha capturava a tecla); Escape jogava o foco no `body` | menu inacessível por teclado | parar a propagação do evento e devolver o foco ao botão | corrigido |
| UX-09 | MEDIUM | Contraste `--ink-3` | 2,84:1 sobre canvas em `.table th` e `.field__hint` | cabeçalho de tabela e dica de campo pouco legíveis | trocar por `--ink-2` (5,19:1) nesses dois seletores | corrigido; demais usos → backlog |
| UX-10 | MEDIUM | Busca do hub de relatórios | "orcamento" e "necessidade de producao" não achavam R-20 e R-04 | quem digita sem acento conclui que o relatório não existe | normalizar acento e casar por palavra | corrigido |
| UX-11 | MEDIUM | Busca do masthead | placeholder prometia "lote, item, OP"; só resolve lote, e o erro dizia `Lote "MP-002876" não encontrado` | usuário conclui que o item não existe | placeholder passa a prometer só lote | corrigido; busca global de item/OP → **backlog** |
| UX-12 | MEDIUM | Posição de Estoque | listagem sem filtro abria com 20 linhas zeradas (só 5 dos 824 itens têm saldo) | módulo parecia vazio | quem tem posição vem primeiro; nada escondido | corrigido |
| UX-13 | MEDIUM | Impressão da Folha de Receita (R.COQ.003) | 892 px em 718 px úteis de A4 retrato; coluna "Observação" cortada | o campo onde a operação escreve não cabia no papel | documento passa a imprimir em paisagem | corrigido |
| UX-14 | MEDIUM | Relatórios R-13 e R-17 | duas colunas "Pedido" (código e quantidade) → aviso de chave duplicada no React | rótulo ambíguo e risco de célula duplicada/omitida | renomear para "Qtd. pedida" e indexar a chave | corrigido |
| UX-15 | MEDIUM | Seleção de cliente/fornecedor | `<select>` nativo com 80 clientes e 113 fornecedores, sem busca | achar o registro exige rolar a lista | combobox com busca | **backlog** |
| UX-16 | MEDIUM | Posição de Estoque / detalhe do item | nenhum tooltip define Físico, Reservado, Disponível e Em compra | termos operacionais sem definição onde são vistos | microtexto nos quatro cabeçalhos | **backlog** |
| UX-17 | LOW | Voltar da impressão do orçamento | `backTo` usava o id da versão do orçamento como se fosse o do projeto | "← Voltar" caía em rota inexistente | destino calculado a partir do documento carregado | corrigido |
| UX-18 | LOW | Impressão da Estrutura de Custos | tarifas saíam como "R$ 0.85 / kWh" (ponto) num documento todo em pt-BR | inconsistência de leitura | formatação pt-BR com até 6 casas | corrigido |
| UX-19 | LOW | Amostras em projeto aprovado | estado vazio prometia "Nova amostra" mesmo com o botão oculto | usuário procura um botão que não existe naquele status | texto condicionado ao status | corrigido |
| UX-20 | LOW | Painel "Precisa de atenção" | grupo é um acordeão fechado, com affordance fraca de clique | pendência fica escondida atrás de um clique não óbvio | reforçar indicação de expansível | **backlog** |
| UX-21 | LOW | Deep link "Abrir produto" | `/cadastros/produtos?search=CÓDIGO` não preenche o campo de busca | cai numa lista de 824 itens | ler o parâmetro na montagem da tela | **backlog** |
| UX-22 | LOW | Expedição parcial | "Enviar agora" vem com o saldo total | parcial exige perceber e editar | microtexto no campo | **backlog** |

| UX-23 | HIGH | Todo seletor de catálogo (itens, produtos, fornecedores, clientes) | listagens carregavam no máximo 100 registros: 478 matérias-primas, 214 produtos e 113 fornecedores ficavam parcialmente inacessíveis | formulação, OC, pedido, OP e amostra não conseguiam escolher a maior parte do cadastro | teto das listagens para 1000 e telas pedindo o catálogo inteiro | corrigido (busca no servidor continua em backlog — UX-15) |
| UX-24 | HIGH | Ações de produção | consumo, apontamento, conclusão e picking gravam "Ambiente local" em vez do usuário logado | trilha de auditoria de produção não identifica quem executou | levar o usuário autenticado aos serviços de produção | consumo corrigido; **backlog** para os demais |
| UX-25 | MEDIUM | OP concluída → Materiais Reservados | texto fixo "Reserva liberada (OP cancelada)" | histórico afirma cancelamento onde houve conclusão | texto condicionado ao status | corrigido |
| UX-26 | MEDIUM | Lote → Liberar | diálogo afirma que o lote "ficará disponível" mesmo com laudo pendente; o backend recusa em seguida | usuário confirma esperando sucesso e recebe recusa | desabilitar a ação ou avisar no diálogo quando o CoA está pendente | **backlog** |
| UX-27 | MEDIUM | OP com falta / R-04 | nenhuma ação leva à sugestão de compra, que vive dentro do Pedido em atendimento | quem vê a falta precisa reconstruir o caminho de memória | link "ver sugestão de compra" a partir da falta | **backlog** |
| UX-28 | LOW | Nova OC | preço de referência do item × fornecedor não chega às linhas da OC | referência útil se perde onde ajudaria | pré-preencher (nunca sobrescrever em silêncio) | **backlog** |
| UX-29 | LOW | Dashboard → "Pedido aguardando produção" | o grupo só cobre pedidos com OP em rascunho | sugere cobertura total que não existe | rótulo mais preciso | **backlog** |
| UX-30 | LOW | Recebimento | data padrão apareceu um dia atrás do dia corrente numa observação | possível problema de fuso na data padrão | investigar | **não confirmado** |

**Não reproduzidos** (registrados para não virarem lenda): o link Amostra →
Projeto existe e funciona (`SampleDetailPage.tsx:144`); PREC e FO-04 **cabem**
em A4 (a medição original usou largura de retrato em documentos que já são
paisagem).

## Cobertura

As cinco fatias operacionais foram percorridas: Comercial, Amostra,
Compras/Qualidade, Produção e Expedição/Faturamento, além das jornadas de
descoberta e da auditoria visual/impressos.

A nota **6/10** de continuidade foi dada pelo auditor de tarefas com esta
justificativa: o contexto de cliente/projeto nunca se perde e os documentos se
referenciam nos dois sentidos (breadcrumb clicável Pedido → Expedição →
Faturamento, rastreabilidade completa do lote), mas as junções mais usadas do
Comercial — abrir a formulação e abrir o produto a partir do projeto — falhavam
exatamente na transição entre módulos. Uma foi corrigida (UX-02), a outra
continua em backlog (UX-21). **A nota não foi reavaliada depois das correções.**

Duas observações de ambiente feitas pelos auditores **não são comportamento do
produto**: o "gerador de dados" e o "reset do banco" que eles perceberam eram o
cenário sintético desta auditoria sendo criado e removido. O que é real e fica
registrado é o efeito colateral: o banco de desenvolvimento é compartilhado
entre suíte de testes, auditoria e uso manual (ver F-12 em
`docs/PRODUCT_AUDIT.md`).

## Training required

Tarefas que hoje ainda exigiriam explicação de alguém que conhece o sistema:

1. Resolver uma falta de material vista na OP ou no R-04 — é preciso saber que a
   sugestão de compra mora dentro do Pedido em atendimento.
2. Encontrar um item pelo código na busca do topo — ela só resolve lote.
3. Entender a diferença entre Físico, Reservado, Disponível e Em compra sem
   ninguém explicar.
4. Escolher um item na formulação quando ele está fora dos 201 primeiros do
   seletor.
5. Saber que "Nova amostra" cria o rascunho no clique, sem tela de confirmação.

## What already works

Evidências positivas concretas, todas observadas:

- **Tela da OP como balcão único**: necessidade, reserva, picking, consumo e
  custo numa página, com bloqueio explicado ("Não é possível liberar: falta
  material.") ao lado do botão desabilitado.
- **Rastreabilidade honesta nos dois sentidos**: do lote de matéria-prima até a
  OP e o lote de produto acabado, com lote do fornecedor separado do lote
  interno e status de qualidade independente do saldo físico.
- **Conferência de expedição**: "Lotes conferidos X/Y", botão bloqueado até a
  conferência terminar e confirmação que diz, literalmente, que a saída física
  não poderá ser cancelada depois.
- **Faturamento sem ambiguidade fiscal**: "não emite Nota Fiscal e não movimenta
  estoque", repetido no diálogo de emissão.
- **Erros de negócio com texto de gente**: lote inexistente, faixa de preço com
  quantidade diferente, preço travado por vínculo, produto em desenvolvimento e
  laudo pendente — todos explicam a saída, não apenas o código HTTP.
- **Formulários que ensinam**: "Em branco significa pureza desconhecida — nunca
  100 %", "Controla lote: cada recebimento gera lote interno com QR Code".
- **Hub de relatórios com vocabulário do negócio**: 20 relatórios agrupados por
  área, com apelidos ("Kardex", "Falta de material") visíveis no card.
- **Filtro que persiste** ao voltar pelo navegador, com botão "Limpar".
- **Status sempre em texto**, nunca só por cor, inclusive nos impressos.
- **Zero requisição externa**: logo e favicon são arquivos locais; nenhuma
  chamada sai de 127.0.0.1.

---

# POST-FIX REVALIDATION

Rodada de **revalidação** executada em 2026-08-17 sobre os commits `4342ee7`
(correções) e `615f7f2` (documentação do gate). Não é auditoria nova: os mesmos
três agentes remediram, em modo somente-leitura, o que tinham apontado. Cenário
sintético novo (carimbo 219338) criado e removido ao final; corpus intacto.

Nenhuma correção foi aplicada nesta rodada, por instrução explícita. O que
aparece como aberto **fica aberto**.

## Scores — antes → depois

| Dimensão | Antes | Depois | Δ | Por quê |
|---|---|---|---|---|
| Navegação sem treinamento | 5/10 | **7/10** | +2 | 12 das 14 tarefas de descoberta concluídas sem conhecimento prévio; o bloqueio original (link da formulação) confirmado corrigido em dois registros distintos |
| Continuidade entre módulos | 6/10 | **6/10** | 0 | as correções confirmadas são de tela isolada, não de ligação entre módulos; e a trilha de auditoria da produção continua furada |
| Legibilidade | 7/10 | **8/10** | +1 | contraste de cabeçalho de tabela e dica de campo resolvido sistemicamente (5,19:1 e 5,54:1, medidos) |
| Consistência | 8/10 | **8/10** | 0 | ganhos (separador decimal, "← Voltar" do orçamento) anulados por inconsistência nova: rótulo de coluna diferente entre tela e impresso em R-13/R-17 |
| Acessibilidade básica | 4/10 | **7/10** | +3 | o CRITICAL do modal está resolvido com ciclo de foco fechado nos dois sentidos; skip link leva à primeira ação em 2 Tabs (eram ~37). Não subiu mais por causa da regressão do Escape no menu "⋯" |
| Documentos impressos | 6/10 | **7/10** | +1 | R-18, Folha de Receita, Estrutura de Custos e "← Voltar" confirmados. Não subiu mais: FO-01 regrediu e R-19/R-20 continuam estourando |

## HIGH antigos — veredito

| # | Finding | Veredito | Evidência |
|---|---|---|---|
| A | Seletores presos em 100 registros | **RESOLVED** | Nova OC 115 fornecedores (o de código mais alto aparece), formulação 584 itens, amostra 803 itens, pedido 218 produtos |
| B | Campo opcional em branco derrubando o cadastro | **RESOLVED** | payload real interceptado: todos os opcionais como `null`, aceitos pela API |
| C | "Abrir formulação" quebrado | **RESOLVED** | leva a `/producao/formulacoes/{productId}/versoes/{versionId}` com a formulação ativa |
| D | Estrutura de custos sem saída para produto sem lote mínimo | **RESOLVED** | campo "Base de produção (un)" presente, botão desabilitado até ser preenchido |
| E | Produção gravando "Ambiente local" | **PARTIALLY RESOLVED** | consumo mostra "Administrador Veridi" e liberação também; **saída de produção, conclusão, planejamento e criação continuam "Ambiente local"**, e o picking não tem nenhuma coluna de responsável |
| F | R-19 e R-20 perdendo coluna no papel | **STILL OPEN** | R-19 1319 px e R-20 1398 px contra 1047 px úteis (+26,0 % e +33,5 %), medidos com print media |

## Macrofluxos

| Macrofluxo | Veredito | Observação |
|---|---|---|
| Comercial (Projeto → Produto → Fórmula → Custo → Precificação → Orçamento) | **PASS** | a página do projeto reúne a cadeia inteira com links diretos |
| Compras/Qualidade (sugestão → OC → Recebimento → Lote → CoA) | **PASS** | OC parcial legível (25/40 kg), lote com genealogia até a OP |
| Produção (Pedido → OP → Picking → Receita → Output) | **PASS WITH FRICTION** | tudo executa; a fricção é a atribuição de usuário (finding E) |
| Expedição/Faturamento | **PASS** | trilha Pedido → OP → Expedição → Faturamento clicável nos dois sentidos |
| Estoque (Item → Lote → Rastreabilidade → FO-01) | **PASS** | FO-01 agora identifica o proprietário do material |

## Quick wins revalidados

PASS: seletores · campo opcional nulo · "Abrir formulação" · base de produção ·
foco e trap do modal · Enter no menu "⋯" · skip link · contraste · Proprietário
na FO-01 · Folha de Receita em paisagem · R-18 cabendo · busca sem acento ·
ordem do estoque · texto "OP concluída" · voltar da impressão do orçamento ·
separador decimal.

FAIL: **Escape no menu "⋯"** (regressão desta correção) e **"Qtd. pedida"**
(renomeado só na tela).

## Regressões introduzidas pelas correções do gate

| ID | Sev. | O que quebrou | Causa | Situação |
|---|---|---|---|---|
| REG-01 | HIGH | Escape não fecha mais o menu "⋯": `aria-expanded` continua `true` e o menu segue no DOM (clicar fora ainda fecha) | o `stopPropagation` que consertou o Enter também impede o Escape de chegar ao listener em `document` | aberto — `apps/web/src/components/RowActions.tsx` |
| REG-02 | HIGH | FO-01 passou a estourar a folha: 909 px em 718 px úteis (+26,6 %) | a coluna "Proprietário" foi acrescentada sem reajustar o layout do retrato | aberto — a coluna em si está correta |
| REG-03 | MEDIUM | Impressão e CSV de R-13/R-17 continuam com "Pedido (qtd)" | o rename foi feito no componente de tela; impressão e CSV herdam o cabeçalho de `apps/api/src/modules/exports/report-exports.ts` | aberto |

## Findings novos (não corrigidos nesta rodada)

| ID | Sev. | Finding | Evidência |
|---|---|---|---|
| NEW-01 | MEDIUM | "Abrir produto" a partir do projeto cai numa lista não filtrada de 20 produtos aleatórios | `/cadastros/produtos?search=PROD-021697` não aplica o parâmetro (era UX-21, agora medido como atrito real no fluxo mais repetido) |
| NEW-02 | MEDIUM | Não há volta ao projeto a partir de Formulação, Custos ou Precificação — "← Voltar" leva à lista do módulo | confirmado no código: nenhuma das três telas guarda o projeto de origem |
| NEW-03 | MEDIUM | Busca de lotes não reconhece o lote comercial impresso na etiqueta | `lots.service.ts` casa apenas código interno, lote do fornecedor e código/nome do item |
| NEW-04 | LOW | Picking não tem coluna de responsável — não há onde mostrar quem conferiu | tabela de picking da OP |
| NEW-05 | não confirmado | Pesagem da Folha de Receita não persistiu num teste, sem erro visível na tela | a API recusa corretamente com `exceeds_reserved` ("restam 0", porque o consumo já fora registrado); falta confirmar se a tela exibe essa mensagem |
| NEW-06 | LOW | FO-04 imprime conferência e assinatura em branco mesmo com o picking já confirmado | por desenho é formulário de papel; pode ler como "não separado" |

## Veredito de demo

**DEMO NOT READY.** Critérios atendidos: nenhum CRITICAL; nenhum macrofluxo em
FAIL; navegação 7/10; impressos 7/10; zero erro 5xx; console limpo (37 telas,
0 erro, contra 8 na rodada anterior).

Blockers reais, pelos critérios definidos pelo Product Owner:

1. **Continuidade entre módulos 6/10**, abaixo do mínimo de 7 — puxada por
   NEW-01, NEW-02 e pela trilha de auditoria da produção.
2. **R-19 e R-20 não cabem no papel** (+26 % e +33,5 %).
3. **Atribuição de usuário na produção** (finding E) — saída, conclusão,
   planejamento e picking. Deixa de ser blocker se o Product Owner aceitar
   formalmente o finding antes da demo.

REG-01 e REG-02 não bloqueiam o roteiro, mas são regressões das correções deste
gate e deveriam ser fechadas antes de qualquer demonstração pública.
