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


---

# UX HARDENING FINAL VALIDATION

Sprint de hardening executado em 2026-08-17 sobre os commits do gate
(`4342ee7`, `615f7f2`, `fd68e2c`). Não é capacidade nova: o objetivo foi tornar
o produto navegável de fato, não apenas aprovado em teste. Os mesmos três
agentes remediram depois, em modo somente-leitura, sem receber meta de nota.

## Evolução dos scores

| Dimensão | Antes do gate | Pós quick wins | Pós hardening |
|---|---|---|---|
| Navegação sem treinamento | 5/10 | 7/10 | **9/10** |
| Continuidade entre módulos | 6/10 | 6/10 | **8/10** |
| Legibilidade | 7/10 | 8/10 | **9/10** |
| Consistência | 8/10 | 8/10 | **9/10** |
| Acessibilidade básica | 4/10 | 7/10 | **9/10** |
| Documentos impressos | 6/10 | 7/10 | **9/10** |
| Descoberta (14 tarefas) | — | 12/14 | **14/14** |

## Regressões do gate — fechadas

| ID | O que era | Correção | Confirmação |
|---|---|---|---|
| REG-01 | Escape parou de fechar o menu "⋯" porque o `stopPropagation` que consertou o Enter também barrava o Escape | o handler só para Enter e Espaço; Escape volta a chegar ao listener que fecha e devolve o foco | auditor visual: `aria-expanded` volta a `false` e o foco retorna ao botão · teste de regressão |
| REG-02 | FO-01 estourou o retrato em 26,6% depois de ganhar a coluna "Proprietário" | folha passou a paisagem, mantendo a coluna e o espaço de escrita à mão | 1047px de conteúdo em 1047px úteis — 0% |
| REG-03 | "Qtd. pedida" foi renomeado só na tela; impressão e CSV seguiam "Pedido (qtd)" | rótulo corrigido na fonte do export | auditor visual confirmou em R-13 e R-17, papel e CSV |

## Impressos — redesenho, não compressão

R-18, R-19 e R-20 passaram a um layout de duas linhas por registro: as colunas
de decisão ficam na linha principal e a proveniência (PREC, CALC, comissão,
markup, faixa, datas, qualidade do custo) desce para uma linha de detalhe
rotulada logo abaixo. **Nenhum dado foi removido** — e, com menos colunas
disputando largura, ainda deu para **aumentar** a fonte de 10,5px para 11,5px.

Medição na largura útil real (retrato 718px, paisagem 1047px):

| Documento | Antes | Depois |
|---|---|---|
| R-19 | +26,0% | **0%** |
| R-20 | +33,5% | **0%** |
| R-18 | +12% | **0%** |
| FO-01 | +26,6% | **0%** |
| R.COQ.003 · PREC · CALC · R.PRO.002 · FO-04 | 0% | **0%** |

## Auditoria de usuário nas ações operacionais

Antes, só consumo e liberação de OP registravam quem executou. Agora a sessão é
a fonte em toda ação iniciada por usuário autenticado:

- **Produção**: criação da OP (inclusive a criada pelo plano de atendimento),
  planejamento, liberação, picking, pesagem da Folha de Receita, consumo,
  apontamento de produção e conclusão;
- **Compras e Qualidade**: recebimento, recebimento de material do cliente,
  criação de lote, bloqueio de lote, liberação de lote;
- **Comercial**: rascunho e confirmação de expedição, conferência de lote,
  criação e emissão de faturamento, cancelamentos;
- **Razão de estoque**: todos os `InventoryMovement` gerados por essas ações,
  incluindo o `SHIPMENT_OUT` que era o último resquício.

Verificado no banco depois de um ciclo completo: `RECEIPT_IN`,
`PRODUCTION_CONSUMPTION`, `FINISHED_GOOD_PRODUCTION`, `SHIPMENT_OUT` e
`SAMPLE_CONSUMPTION` — todos com o usuário real, nenhum "Ambiente local".

Regra preservada: **histórico antigo não foi reescrito**. Registro anterior ao
sprint continua com o ator que tinha; ninguém foi inventado.

## Continuidade comercial

- "Abrir produto" no projeto aplica o filtro de verdade (uma linha, o produto
  certo) em vez de abrir uma lista qualquer;
- Formulação, Estrutura de Custos e Precificação mostram "← Voltar ao projeto
  PROJ-…" quando o produto nasceu de um projeto — e **nada** quando é produto
  legado, sem adivinhação;
- a falta de material na OP leva a Compras **com o item e a quantidade que
  falta** já preenchidos; a decisão de comprar continua com a pessoa;
- material de propriedade do cliente continua sem CTA de compra, dizendo que
  aguarda o cliente.

## Seleção de entidade por digitação

Os `<select>` de catálogo grande (item da formulação, item da amostra, produto
do pedido, fornecedor da OC) viraram um combobox com busca: digita-se código ou
nome, sem acento, e a lista filtra. Padrão ARIA completo (`combobox` +
`listbox` + `aria-activedescendant`), ↑/↓ percorrem, Enter escolhe, Escape
fecha sem alterar. Veredito do auditor visual: *"não é pior que o `<select>`
nativo em nenhum aspecto testado"*.

## Outras correções do sprint

- Estoque explica o próprio vocabulário: legenda de Físico / Reservado /
  Disponível / Em Compra na lista, e a definição ao lado de cada número no
  detalhe do item;
- busca de lote passa a casar o **número comercial impresso na etiqueta**, na
  lista e na busca do topo — sem escolher por adivinhação quando o número se
  repete em mais de um lote;
- recusa da Folha de Receita aparece na tela, com `role="alert"` e rolagem até
  o alerta (o backend sempre respondeu certo: *"Quantidade excede o saldo ainda
  reservado desta linha (restam 0,1)"*);
- FO-04 separa a conferência de papel do picking já registrado no sistema, sem
  preencher o quadrado manual;
- anel de foco dos campos de formulário igualado ao do resto do sistema.

## Findings ainda abertos

| Sev. | Finding | Situação |
|---|---|---|
| MEDIUM | Falta de material **de propriedade do cliente** não pôde ser verificada na interface: não existe esse caso no banco. O comportamento está no código (sem CTA de compra, com aviso de que aguarda o cliente) | **não verificável** — fabricar um cenário só para provar isso seria encenação |
| LOW | Tela da OP não mostra histórico de criação/planejamento/liberação como o Projeto mostra. Não é regressão: nunca existiu | backlog |
| LOW | Campo de busca da lista de produtos não exibe o termo vindo do deep link, embora filtre corretamente | backlog |
| LOW | Combobox limita a exibição a 50 opções por vez, com aviso para refinar a busca | por desenho |

## Ambiente, não produto

A suíte compartilha o banco com o ambiente de desenvolvimento. Durante esta
rodada um teste de dashboard falhou por contagem global enquanto dois auditores
operavam no mesmo banco; com o banco quieto, os 601 testes da API passam. O
isolamento do banco de testes continua no backlog (F-12 em
`docs/PRODUCT_AUDIT.md`).


---

# DEMO READY — CONFIRMAÇÃO FORMAL

**DEMO READY = YES** (2026-08-17, reconfirmado em 2026-08-18 após a rodada
Entity Picker & Context Link Integrity — ver a última seção deste documento).

Os dois vereditos que faltavam foram emitidos pelos auditores depois das
correções, sem meta de nota:

| Critério | Resultado |
|---|---|
| Macrofluxos | **5/5 PASS** — Comercial, Compras/Qualidade, Produção, Expedição/Faturamento e Estoque |
| Demo walkthrough | **PASS** |
| CRITICAL / HIGH abertos | **0 / 0** |
| Navegação sem treinamento | 9/10 |
| Continuidade entre módulos | **9/10** |
| Acessibilidade básica | 9/10 |
| Documentos impressos | 9/10 |
| Descoberta | 14/14 |
| Erros 5xx · console | 0 · limpo (37 telas) |

O auditor operacional respondeu explicitamente à pergunta que restava:
**não há mais nenhum "Ambiente local" em ação iniciada por usuário** — incluindo
o lançamento `SHIPMENT_OUT` no razão de estoque, que era o último resquício.

O walkthrough saiu de PASS WITH FRICTION para PASS depois de duas correções:
grupos curtos do painel de atenção passam a abrir já expandidos (a pendência
não fica escondida atrás de um clique) e "Abrir produto" no projeto abre o
registro direto, com a lista filtrada atrás.


---

# FINDABILITY & LIST UX

Rodada executada em 2026-08-17, depois do Demo Ready formal. Objetivo único:
**encontrar rapidamente o registro certo** — sem rolar centenas de opções, sem
decorar código e sem abrir outro módulo para refazer a busca que o sistema já
sabia fazer.

## Selectors de entidade

Inventário: **106 `<select>`** no frontend, classificados em enum, entidade
pequena e entidade grande. Migrados para busca por digitação nesta rodada
(somando-se aos 4 já validados antes):

| Tela | Campo |
|---|---|
| Nova ordem de produção | Produto |
| Pedido de cliente | Cliente · Produto da linha |
| Contagem de estoque | Item |
| Recebimento de material do cliente | Cliente |
| Cadastro de produto | Cliente · Item de produto acabado |
| Cadastro de projeto | Cliente |
| Estrutura de custos | Recurso industrial |
| Faturamento (filtro) | Cliente |
| *(já migrados antes)* | Item da formulação · Item da amostra · Produto do pedido · Fornecedor da OC |

Mantidos como `<select>` simples, de propósito: status, tipo, perfil, sim/não,
moeda, modo, categoria, forma farmacêutica, faixa etária, UF. Enum pequeno não
precisa de busca — combobox ali é cerimônia.

Apresentação e busca seguem a regra registrada em `docs/UI_BRAND.md`: **código
de negócio + nome** (`MP-000245 · Vitamina C`), nunca UUID; busca sem acento e
sem caixa; ↑/↓, Enter e Escape; ARIA de combobox. A busca é no cliente, sobre o
catálogo já carregado (795 itens é o maior caso hoje); acima de alguns milhares
de registros isso passa a exigir busca no servidor — anotado como limite
conhecido, não como pendência.

## Listas e filtros

| Lista | Contexto vindo da URL | Filtros |
|---|---|---|
| Faturamento | `customerId`, `dateFrom`, `dateTo` | busca (FAT/PED/EXP/cliente), status, **cliente**, período, "Limpar filtros" |
| Pedidos | `customerId` | busca, cliente, status |
| Projetos | `customerId` | busca, cliente, status, canal |
| Ordens de compra | `supplierId` | busca, fornecedor, status |
| Item × fornecedor | `supplierId` | busca, homologação, preferencial, ativo |
| Materiais de clientes | `customerId` | busca, cliente |
| Lotes · Movimentações · Posição de estoque · Ordens de produção | `search` | filtros existentes preservados |

Precedência de filtro, agora explícita no código (`useInitialFilters` e o
parâmetro `override` de `usePersistentFilter`): **URL → sessão → default da
tela**. Quem clicou em "ver faturamentos deste cliente" está fazendo uma
pergunta específica; abrir com o filtro da visita anterior responderia outra.

Estado vazio deixou de ser uma frase só: com filtro aplicado, a tela diz
"Nenhum faturamento encontrado para os filtros atuais" e oferece limpar —
diferente de "Nenhum faturamento cadastrado".

## Links contextuais

Relação conhecida virou link, cada um abrindo o destino **já filtrado**:

- **Cliente** → Projetos · Pedidos · Faturamentos · Materiais do cliente
- **Produto** → Formulação · Custos · Ordens de produção · Projeto de origem
- **Item** → Estoque · Lotes · Movimentações · Fornecedores do item
- **Fornecedor** → Ordens de compra · Itens homologados

Produto sem projeto de origem não mostra link nenhum — continua valendo a regra
de nunca inventar relação.

## Seleção de linhas

`TableSelection` habilitado **apenas** na lista de Itens, porque só ali havia
ação segura e útil para entregar nesta rodada: **exportar exatamente o que foi
selecionado** (o CSV recebe os ids e mantém as regras de sempre — código de
negócio, pt-BR, sem UUID, proteção contra fórmula).

Decisões que ficaram no código e viram regra: seleção é da página atual, o
contador nunca descreve linha que a pessoa não vê mais, trocar filtro limpa a
seleção, e **seleção não implica mutação em massa**. Aprovar, liberar qualidade,
expedir, faturar e cancelar continuam com suas regras transacionais próprias —
nada disso foi adicionado.

## Resultado dos auditores

**Visual/acessibilidade**: comboboxes aprovados nas 7 superfícies testadas ao
vivo (ARIA correta, `aria-activedescendant` atualizando nas setas, Escape sem
alterar valor), barra de filtros do Faturamento cabendo numa linha em 1440×900 e
1280×720, estado vazio correto, checkbox sem conflito com o clique da linha e
contador honesto. Notas da rodada: Legibilidade **8**, Consistência **9**,
Acessibilidade básica **8**.

Os dois MEDIUM que rebaixaram essas notas foram **criados por esta rodada** e
corrigidos em seguida, com medição do próprio auditor:

| Finding | Correção | Verificação |
|---|---|---|
| Barra de filtros entre duas tabelas, sem dizer qual delas filtra | rótulo "Filtrar documentos de faturamento" acima da barra | "resolve — não acho mais que a barra precise mudar de lugar" |
| Linha de Itens continuava focável tendo checkbox, "Editar" e "⋯" dentro: +33% de paradas de Tab por página | `tabIndex` removido da `<tr>`; clique segue abrindo o cadastro | 4 → **3 paradas por linha**, sem perder alcance de teclado |

O auditor optou por **não subir as notas retroativamente** sem refazer a
auditoria completa — decisão dele, registrada aqui como está: as notas da rodada
são 8/9/8 e os dois motivos que as rebaixaram deixaram de existir.

Um LOW também foi corrigido: comentário de CSS que citava o token e o contraste
errados.

**Usuário final (findability)**: **10 de 10 tarefas** concluídas, e — o que
importava nesta rodada — **nenhuma exigiu rolar uma lista de centenas de
opções**. As quatro travessias por relação (cliente → faturamentos, produto →
OPs, item → lotes, fornecedor → OCs) chegaram ao destino já filtrado.
`Facilidade de navegação sem treinamento: 9/10` — mantida, sem mudança líquida.

Três achados dele, dois corrigidos e um recusado com motivo:

| Sev. | Finding | Desfecho |
|---|---|---|
| MEDIUM | Filtro de cliente em Produtos ainda era `<select>` nativo com 83 opções ordenadas por código | migrado para o mesmo combobox de busca; revalidado ao vivo por nome, por código e por teclado |
| LOW | Estado vazio de Produtos não distinguia filtro de catálogo vazio | padronizado com o de Faturamento; revalidado |
| MEDIUM | Busca global não acharia lote pelo número do fornecedor, apesar do placeholder | **não corrigido, de propósito** — existe teste `"nunca resolve por supplierLot — só pelo código interno"`: lote de fornecedor não é único entre fornecedores e escanear precisa resolver identidade interna. O que mudou foi a promessa: o placeholder passou a dizer "código interno ou lote comercial". Na revalidação o próprio auditor concluiu que havia testado o campo errado — o lote comercial sempre esteve coberto — e encerrou o ponto |

Esse último caso é o motivo de o gate exigir verificação antes de correção:
implementar o pedido teria quebrado uma regra deliberada do produto.


---

# ENTITY PICKER & CONTEXT LINK INTEGRITY

Rodada aberta por **dois problemas que o Product Owner encontrou usando o
sistema à mão** — não por auditoria. Demo Ready foi rebaixado para NO durante a
correção e reavaliado no fim.

## Problema 1 — escolher produto no Pedido

Sintomas relatados: área de linhas pequena com scroll próprio, combobox
espremido, lista de resultados minúscula, nomes longos impossíveis de comparar.

Causa **única**, medida: o painel de resultados renderizava dentro do container
da tabela, que tem `overflow`. Ele era recortado e ganhava barra de rolagem
própria — **93 px visíveis para 359 px de conteúdo**, com dois ancestrais
recortando.

Correções:

- a lista passou a sair por **portal**, ancorada em coordenadas de viewport,
  acompanhando o campo no scroll e abrindo para cima quando não há espaço
  abaixo;
- painel com até 360 px de altura e no mínimo 380 px de largura — **9
  resultados legíveis de uma vez**, contra um punhado truncado;
- nome longo **quebra em vez de truncar**, para dar para comparar;
- coluna Produto passou a ficar com a largura restante (quantidade 160 px,
  unidade 90 px), e a linha nova começa com quantidade vazia e o rótulo
  "Quantidade" em vez de um `0` que parecia válido.

Medições depois (auditor visual, ao vivo): sem barra de rolagem interna com 1,
3 e 8 linhas (93/93, 199/199, 464/464), painel sem recorte em 1440×900 e
1280×720, teclado (↑ ↓ Enter Escape) sem regressão, reposicionamento correto no
scroll e abertura para cima junto ao rodapé.

O auditor encontrou um **HIGH** no caminho: o input em si media 177 px numa
célula de 369 px — dentro de `.field` ele herdava largura, numa célula de tabela
não havia regra alguma. Corrigido em uma regra CSS; medido depois em **337 px
(1440×900)** e **307 px (1280×720)**, com o placeholder inteiro, sem efeito
sobre os outros comboboxes. Veredito final dele: **picker aprovado**.

## Problema 2 — link do projeto para o produto

O Product Owner clicou e caiu na lista inteira de produtos. Era bug real, e o
motivo é instrutivo: existiam **dois caminhos** para o mesmo destino na tela do
projeto. O botão "Abrir produto" funcionava; o **chip "Produto" da trilha de
navegação** apontava para `/cadastros/produtos?produto=CÓDIGO` — um parâmetro
que nenhuma tela lê. A lista abria completa, sem aviso nenhum de que o contexto
tinha sido perdido.

Além disso, a busca textual que o botão usava trazia **2 linhas** em vez do
produto exato.

Correções:

- a trilha passou a apontar para `?productId=<id>&open=<id>`, o mesmo padrão
  que já funcionava;
- a lista de produtos ganhou filtro por **identidade** (`productId`) no lugar de
  busca textual;
- o contexto é aplicado **por efeito**, não só no estado inicial: navegar de
  `/cadastros/produtos` para a mesma rota com outra query não remonta o
  componente, e era por isso que a query podia ser ignorada;
- chegando com contexto, a tela **descarta filtros incompatíveis** — combinar o
  cliente da visita anterior com o produto pedido agora daria lista vazia;
- e mostra por que está mostrando um recorte: "Mostrando apenas o produto
  PROD-… · Limpar filtros".

O mesmo aviso foi estendido a Lotes, Ordens de Produção e Item × Fornecedor,
por recomendação do auditor: serve de rede de segurança mesmo que um parâmetro
falhe em silêncio no futuro.

## Integridade de todos os links contextuais

Testados **por clique**, com um filtro conflitante deixado de propósito antes:

| Navegação | Filtro aplicado | Linhas |
|---|---|---|
| Projeto → Produto (botão e trilha) | `productId` exato | 1, com o produto aberto |
| Produto → Ordens de produção | `productId` | só as do produto |
| Item → Lotes | `itemId` | só os do item |
| Fornecedor → Ordens de compra | `supplierId` | só as do fornecedor |
| Cliente → Faturamentos | `customerId` | só os do cliente |

**5/5**, com filtro visível e limpável em todos, e o filtro antigo descartado em
vez de combinado.

Dois achados do auditor (Produto → OPs e Item → Lotes "sem filtro") foram
**retirados por ele mesmo** na revalidação: o seletor usado casava também o item
homônimo da barra lateral, e o clique caía na navegação lateral, não no bloco
"Ver relacionados". Vale o registro porque é uma armadilha real de teste, não
uma desculpa: o produto tem dois links com o mesmo nome, e só um carrega
contexto.

## Regra que fica

Link contextual usa **identidade**, nunca busca textual aproximada. Texto pode
casar mais de um registro, esbarrar em filtro anterior ou simplesmente não ser
aplicado — foi exatamente o que aconteceu aqui, nas três formas.

---

# Remediação pós-auditoria — HIGH (checkpoints 3H e 3I)

Estado de partida: 4 CRITICAL e 16 HIGH reconciliados a partir dos três
auditores (usuário final, operacional, visual/acessibilidade). Ao entrar no 3I
restavam **9 HIGH abertos**. Todos foram fechados, cada um com correção,
regressão e evidência medida no estado atual — nenhum fechado por leitura de
código.

| # | Finding | Auditor | Antes | Correção | Evidência |
|---|---|---|---|---|---|
| H01 | OC não mostra recebimentos | operacional | conferir uma entrega exigia sair para a lista geral e procurar pelo código da ordem | bloco "Recebimentos" na OC: código, data, nota fiscal, itens, quantidade, lotes gerados — cada código é link | `receiving.test.ts` (OC recarregada expõe o recebimento) + navegador: `OC lista recebimentos`, `link do recebimento abre o recebimento` |
| H02 | Recebimento → OC frágil | operacional | volta por botão fantasma, sem destino visível | `EntityLink` para a OC | navegador: `recebimento liga de volta a OC` |
| H03 | Recebimento → lotes frágil | operacional | lote gerado atrás de botão | `EntityLink` para o lote | navegador: `recebimento liga ao lote gerado`, `link do lote abre o lote` |
| H04 | Lote acabado não sabe para onde foi | operacional | do lote até a expedição só voltando pelo pedido | bloco "Expedições" no lote: expedição, pedido, cliente, quantidade daquele lote, status | `shipments.test.ts` (lote expõe a expedição) + navegador: `lote acabado lista expedicoes` |
| H05 | Sem alinhamento numérico | visual | quantidade, preço, total e custo à esquerda; `1.000` e `999` com a mesma largura | `.is-numeric` (direita + `tabular-nums`) em **57 tabelas**, cabeçalho junto; impressos idem, com o cabeçalho inferido do rótulo da coluna | navegador: `coluna numerica a direita com cabecalho junto` → `{th:right, td:right, tabular-nums}`; `impresso alinha cabecalho numerico` |
| H06 | Relatório longo sem identidade por página | visual | 15 páginas, identificação só na primeira | rodapé corrido repetido em toda folha impressa: tipo, código e documento controlado | navegador (mídia `print`): `impresso repete identidade no rodape` |
| H07 | Folha de receita de OP encerrada operável | operacional | ordem concluída ainda oferecia pesagem e conclusão de parte | folha vira documento de consulta e diz isso | navegador: `folha de OP encerrada nao registra pesagem`, `folha de OP encerrada se explica` |
| H08 | Faturamento emitido sem preço, sem aviso | usuário final | emitir é definitivo e a confirmação não citava nem o preço ausente nem a irreversibilidade | confirmação nomeia as linhas sem preço e diz que emitir não tem volta (faturamento quantitativo continua permitido) | revisão da confirmação em `BillingPage` |
| H09 | Movimentação sem documento de origem | operacional | consumo de produção e produção de acabado — as maiores saídas do ledger — com "—" na origem | movimento resolve OP e amostra em consulta em lote; origem virou link | `consumption.test.ts` (movimento expõe a OP) + navegador: `nenhuma movimentacao sem origem` → `["EXP-000001","OP-000001",...]` |

**Custo desconhecido sem caminho** (MEDIUM promovido junto, mesma raiz de H08):
formulação e OP diziam quais itens estão sem referência de custo sem dizer onde
a referência nasce. Agora apontam o preço de fornecedor que a resolve.

## Verificação

`scripts/ux-continuity-check.mjs` cresceu de 20 para **35 checagens** e roda
contra o navegador real com o cenário DEMO: **35/35 PASS**, zero erro de
console, zero resposta ≥ 400. As checagens clicam nos links e conferem o
conteúdo do destino — não apenas o `href`.

## O que o sistema não consegue fazer

**Número de página dentro da folha.** O Chrome não implementa as caixas de
margem de `@page`, então a aplicação não tem como escrever "Página X de Y" no
papel. O que ficou garantido é que toda página se identifica; o número em si vem
do diálogo de impressão do navegador. Registrado como limitação, não como
pendência de implementação.

---

# AUDITORIA CURTA — CMV COMO BASE DE PROPOSTA (checkpoint CMV 2B)

Uma tarefa, um auditor (`ux-end-user-auditor`), sem dizer menu, rota, botão
nem nome de tela:

> "Tenho um produto e preciso saber quanto custa produzir 1.000 potes e usar
> esse cenário como base para uma proposta."

## Resultado

| Passo | Veredito |
| --- | --- |
| Achar o produto | PASS — Cadastros → Produtos, busca e lista |
| Achar onde se responde "quanto custa produzir" | PASS — CMV pelo produto |
| Informar 1.000 e obter resultado | PASS — recalcula de fato (500 → R$ 6.193,60; 1.000 → R$ 12.043,60) |
| Entender o resultado | PASS — total, por unidade, por 1.000 e qualidade do custo |
| Ver o preço vigente da quantidade | PASS — R$ 38,90, faixa de 1.000 un |
| Chegar ao orçamento | PARCIAL — ver abaixo |

**Veredito do auditor: FAIL**, por dois CRITICAL no passo final. Verificados
um a um antes de qualquer correção:

**C1 — "Vincular produto existente" falharia em silêncio: NÃO REPRODUZ.**
Reproduzido com navegador real: a opção aparece, o campo passa a mostrar
`PROD-000003 · DEMO Pré-Treino Frutas Vermelhas 300g`, o botão fica
habilitado, o vínculo é criado e a seção passa a listar o produto. Zero
resposta HTTP ≥ 400. A página tem `<select>`/`<datalist>` que também expõem
`role=option`, e é neles que um clique automatizado por texto cai — foi o
que aconteceu com o próprio auditor. Não houve correção porque não havia
defeito.

**C2 — "gere uma precificação a partir do cálculo atual" não tinha onde
acontecer: PROCEDE, corrigido.** O aviso de base econômica divergente pedia
uma ação e o único link ao lado abria uma lista somente leitura. Criar
precificação nasce do cálculo salvo, na estrutura de custos — é para lá que o
aviso aponta agora, nomeando o caminho.

## Corrigido no mesmo checkpoint

| Severidade | Achado | Correção |
| --- | --- | --- |
| HIGH | Projeto aprovado oferecia "Criar nova versão" e só recusava depois do clique, no fim de um caminho já percorrido | A ação deixa de existir; a explicação toma o lugar dela e diz o que fazer ("crie um projeto novo") |
| CRITICAL (C2) | Aviso pedia ação sem caminho | Aviso passa a apontar Custos industriais → Cálculos salvos |
| MEDIUM | `HOUR` na composição do CMV | "hora", pela tabela de rótulos que já existia |
| MEDIUM | `FIXED_BASIS` na tabela de materiais da estrutura de custos | "Base da fórmula", pelo mesmo mapa usado no editor de formulação |
| MEDIUM | Preço vigente ao lado de CMV completo sem dizer que a faixa foi fechada sobre custo parcial | Aviso explícito de base divergente |
| LOW | Erro de quantidade trocava o título por "CMV · —" | Só o resultado sai; a identidade do produto fica |

## Não corrigido, e por quê

- **Busca do topo não encontra produto por nome** (HIGH do auditor).
  Pré-existente e fora do escopo: busca global é item explicitamente não
  implementado neste roteiro.
- **Dois botões "Cancelar" na tela do projeto** (MEDIUM) e **placeholder
  `0001PL`** (LOW). Pré-existentes, em tela fora do caminho do CMV.

## Fricção residual conhecida

Para um cliente cujo projeto já foi aprovado, propor de novo exige criar um
projeto novo. A regra agora é dita **antes** do clique e o caminho
alternativo funciona ponta a ponta (verificado: projeto novo → vincular
produto → versão de orçamento → linha com 1.000 un → faixa sugerida →
`Aplicar preço calculado` → `Simular CMV` → `Voltar ao orçamento`). O que
permanece é o número de passos, não um bloqueio.
