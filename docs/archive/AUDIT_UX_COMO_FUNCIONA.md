# Auditoria UX — "Como funciona" (UX-HELP-01)

| Item | Valor |
|---|---|
| Base | `main` |
| HEAD auditado | `d246475` (merge MIG-ORDER-01, 2026-09-09). Durante a auditoria a `main` avançou para `7ef0893` (`9ed26d4` db:migrate só aplica; `8473f0d` arquiva o spike de entregas): nenhum dos dois toca `apps/web/src/help` nem `apps/web/src/pages`, e o inventário permanece válido |
| Data da auditoria | 2026-09-09 |
| Modo | Investigação / UX / product writing. **Nenhum runtime, componente, schema, migration ou texto atual foi alterado.** |
| Working tree ao iniciar | limpa, exceto `docs/archive/SPIKE_COM_DELIVERY_SCHEDULE.md` (untracked, pré-existente; foi commitado por outra sessão em `8473f0d` durante a rodada). Ao encerrar, o único arquivo novo é este documento |
| Papéis assumidos | Product Designer sênior · UX Writer · Product Owner · Analista de processos · Especialista ERP/produção · Onboarding de usuário não técnico |
| Fontes | `App.tsx`, `navigation.ts`, `pages/customer-consultation/routes.tsx`, `help/help-content.ts`, `help/content/*.ts` (6 arquivos, 5.031 linhas), `components/help/*`, `components/FlowContext.tsx`, `styles/components.css`, testes `help-topic-contract.test.ts` e `help-kit.test.tsx`, `PRODUCT_RULES.md` (§45, §69–§74), `UI_BRAND.md`, `PROJECT_STATE.md`, `BACKLOG.md`, `MVP_PLAN.md`, `E2E_AUDIT_CURRENT.md`, `DEMO_SCRIPT.md`, `ROTEIRO_VALIDACAO_CLIENTE.md`, e a leitura das próprias telas (rótulos de botão, títulos de seção, subtítulos, callouts) |

Este documento é uma **recomendação**. Ele termina em decisão de Product Ownership, não em implementação. A proposta de guia editorial futuro (`docs/UX_HELP_GUIDE.md`) está descrita na seção 19 e **não foi criada**.

---

## 1. Sumário executivo

**O que existe.** O sistema já tem uma infraestrutura de ajuda madura, melhor do que a maioria dos ERPs internos: 48 painéis "Como funciona" (um por tela ou par lista/documento), 104 dicas ⓘ de termo, o `CalcHint` (que mostra a aritmética de um número com os valores da própria linha), o `FlowContext` (cadeia de documentos Projeto › Pedido › OP › Expedição › Faturamento no topo de cada documento) e subtítulos permanentes sob cada título de tela. Tudo isso vive em um registro único (`apps/web/src/help/content/`, um arquivo por módulo) e é protegido por testes de contrato: chave inexistente quebra a compilação, tela que abre o tópico do vizinho quebra o teste, tópico sem glossário ou sem fluxo quebra o teste, e dezesseis termos de código são proibidos em qualquer texto de ajuda.

**Cobertura.** 100% das telas roteadas do menu abrem um "Como funciona" (61 rotas de tela sob a casca; a Consulta do Cliente compartilha um tópico entre as sete abas e cinco detalhes). Sem ajuda, por desenho correto: Login, página 404 e as 24 rotas de impressão. Sem ajuda própria, e deveriam ter: o **Orçamento** (vive como seção dentro do Projeto e é explicado dentro da ajuda do Projeto), a **Sugestão de Compra** e o painel **Reservar Produto Acabado** (seções do Pedido), e os diálogos de decisão irreversível (Alterar preço de faturamento, Ajustar estoque, Consumo extra).

**O diagnóstico central: o problema não é falta de conteúdo. É forma, volume e ordem.** São 31.549 palavras de ajuda de tela (média de 657 por tópico, mediana 581), mais 3.151 palavras de dicas. Oito tópicos passam de 900 palavras; a Formulação tem 1.288 — um modal com 12 termos, 3 fluxos, 14 etapas e 9 ressalvas. O esqueleto fixo "resumo → glossário → fluxo → o que costuma pegar" responde bem "o que é esta tela" e "o que costuma dar errado", e responde mal exatamente as perguntas de quem começou hoje: **quando eu uso isto**, **o que preciso ter pronto antes**, **o que o sistema faz sozinho** e **qual é o próximo passo**. O glossário vem antes do caminho por decisão registrada em §45 — decisão defensável para quem já opera, mas para o iniciante ela entrega um dicionário antes de dizer o que fazer.

**Registro de escrita.** Os textos foram escritos por quem conhece as regras a fundo, em um registro autoral e denso: frases longas com travessões e ressalvas encadeadas, aforismos ("preencher REGISTRA; marcar AUTORIZA", "reserva é compromisso, consumo é baixa", "ver não é poder usar"), jargão de fábrica e de finanças sem glosa (overage, markup, FEFO, CoA, "na mesma transação"). O conteúdo está tecnicamente correto em quase tudo, e é justamente por isso que o custo de leitura é alto: cada frase carrega uma regra.

**Nota média atual: 6,8 / 10** (rubrica de nove critérios, seção 6). Os critérios que puxam para baixo são sempre os mesmos: concisão (média 2,5/5), próxima etapa (2,3/5) e linguagem para não técnico (3,0/5). Os melhores tópicos são os curtos e de tela simples (Escanear lote 8,4; Documentos/CoA, Inventário Físico e Expedições 7,8). Os piores são os das telas mais críticas: Projeto/Orçamento 4,9 (desatualizado), Estrutura de custos 5,8, Projetos, CMV, Picking e Templates de formulação 6,0.

**Desatualização confirmada no código.** A ajuda de Projetos e de Projeto afirma que projeto aprovado "é terminal" e "não aceita orçamento novo". Desde o COM-CORE (2026-09-09, §69) o projeto aprovado continua vendendo, a tela oferece o botão **"Novo orçamento"**, e o COM-PRICE (§74) introduziu a decisão de preço por linha — **Manter condição**, **Reajustar condição**, **Usar precificação**, **Usar preço manual** — com motivo obrigatório quando a quantidade é outra ou a condição venceu. Nada disso existe na ajuda. Também não existem: validade obrigatória para enviar (§71), "proposta vencida" como estado, e o fato de que o envio congela o custo corrente da faixa equivalente. A ajuda de Projeto é hoje a mais importante do sistema comercialmente e a mais defasada.

**Recomendação.** Manter a infraestrutura (registro central, testes de contrato, `FlowSteps`, `InfoHint`, `CalcHint`, `FlowContext`). Trocar o **modelo editorial** por um esqueleto em três níveis (seção 7), que começa por "em uma frase / quando usar / próximo passo" e empurra glossário e ressalvas para baixo, com seções recolhíveis. Criar **páginas de conceito compartilhadas** para as sete ideias que hoje se repetem em dez ou mais tópicos (Físico/Reservado/Disponível/Em compra; reserva × consumo; lote interno × lote do fornecedor × lote comercial; rascunho × ativa; prévia × gravado; custo desconhecido ≠ zero; material do cliente), reduzindo o volume total para cerca de 55% do atual. Evoluir o componente para um **painel lateral com abas e "Saiba mais"** (opção B, seção 8). Antes de escrever uma linha nova, seis decisões de Product Ownership (seção 20) — a primeira delas é se o Orçamento ganha tela e tópico próprios.

---

## 2. Mapa completo do produto

Inventário construído a partir de `App.tsx` e `pages/customer-consultation/routes.tsx`, não do menu. Tipo: **L** lista · **D** detalhe/documento · **C** criação · **E** edição · **O** operação · **Q** consulta · **R** relatório · **P** impressão. "Ajuda" é a chave do tópico que a tela abre hoje.

### 2.1 Painel

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Painel | `/` | (derivado de tudo) | Q | `painel.comoFunciona` |

### 2.2 Comercial

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Projetos | `/comercial/projetos` | Projeto | L | `comercial.projetos` |
| Projeto (ficha) — inclui **Orçamentos**, Produtos do projeto, Amostras, Documentos, Histórico | `/comercial/projetos/:id` | Projeto + QuoteVersion | D/E/O | `comercial.projeto` |
| Amostras | `/comercial/amostras` | Amostra (Tn) | L | `comercial.amostras` |
| Amostra | `/comercial/amostras/:id` | Amostra | D/O | `comercial.amostra` |
| Pedidos | `/comercial/pedidos` | Pedido do Cliente | L | `comercial.pedidos` |
| Novo pedido | `/comercial/pedidos/novo` | Pedido | C | `comercial.pedido` |
| Pedido (documento) — inclui **Plano de Atendimento**, **Sugestão de Compra**, OCs vinculadas, OPs, **Reservar Produto Acabado**, PA por lote, Expedições, Faturamento | `/comercial/pedidos/:id` | Pedido | D/O | `comercial.pedido` + `planoAtendimento.comoFunciona` (segundo botão, dentro da seção) |
| Expedições | `/comercial/expedicoes` | Expedição | L | `comercial.expedicoes` |
| Expedição | `/comercial/expedicoes/:id` | Expedição | D/O | `comercial.expedicao` |
| Faturamento (fila + documentos) | `/comercial/faturamento` | Billing | L | `faturamento.lista` |
| Faturamento (documento) | `/comercial/faturamento/:id` | Billing | D/O | `faturamento.comoFunciona` |

### 2.3 Produção

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Ordens de Produção | `/producao/ordens` | OP | L | `producao.ordens` |
| Nova OP | `/producao/ordens/nova` | OP | C | `ordemProducao.comoFunciona` |
| Ordem de Produção (documento) — Necessidade, Reserva, Picking, Consumo Real, Produção, Conclusão, Custo | `/producao/ordens/:id` | OP | D/O | `ordemProducao.comoFunciona` |
| Folha de Receita (R.COQ.003) | `/producao/ordens/:id/receita` | OP / pesagem | O | `producao.folhaReceita` |
| Picking / Consumo | `/producao/picking` | OP (liberadas/em produção) | L/Q | `producao.picking` |
| Formulações | `/producao/formulacoes` | Formulação por produto | L | `formulacao.lista` |
| Formulação do produto (histórico de versões) | `/producao/formulacoes/:productId` | FormulationVersion | D | `formulacao.comoFunciona` |
| Versão da formulação | `/producao/formulacoes/:productId/versoes/:versionId` | FormulationVersion | E/O | `formulacao.comoFunciona` |
| Templates de Formulação | `/producao/templates-formulacao` | Template | L | `producao.templates` |
| Template de formulação | `/producao/templates-formulacao/:id` | Template + versões | D/E | `producao.templateDetalhe` |
| Produto Acabado | `/producao/produto-acabado` | Lote PA | L/Q | `producao.produtoAcabado` |

### 2.4 Compras

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Ordens de Compra | `/compras/ordens` | OC | L | `compras.ordens` |
| Nova ordem de compra | `/compras/ordens/nova` | OC | C | `compras.ordens` |
| Ordem de compra | `/compras/ordens/:id` | OC | D/E/O | `compras.ordens` |
| Recebimentos | `/compras/recebimentos` | Recebimento | L | `compras.recebimentos` |
| Receber OC | `/compras/recebimentos/novo` | Recebimento | C/O | `compras.recebimentos` |
| Receber material do cliente | `/compras/recebimentos/material-do-cliente` | Recebimento (cliente proprietário) | C/O | `compras.recebimentos` |
| Recebimento (documento) | `/compras/recebimentos/:id` | Recebimento | D | `compras.recebimentos` |
| Item × Fornecedor | `/compras/item-fornecedor` | Relação item/fornecedor + ofertas | L/E | `compras.itemFornecedor` |

### 2.5 Estoque e Qualidade

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Posição de Estoque | `/estoque` | Saldo por item | Q | `estoque.posicao` |
| Item no estoque (saldo por lote, ajuste, sugestão FEFO) | `/estoque/:itemId` | Item + lotes | Q/O | `estoque.item` |
| Movimentações | `/estoque/movimentacoes` | Movimento (ledger) | Q | `estoque.movimentacoes` |
| Inventário Físico | `/estoque/inventario` | Contagem → ajuste | O | `estoque.inventario` |
| Materiais de Clientes | `/estoque/materiais-de-clientes` | Lote (proprietário = cliente) | Q | `estoque.materiaisCliente` |
| Lotes | `/estoque/lotes` | Lote | L | `estoque.lotes` |
| **Liberação de lotes** (menu Qualidade → mesma tela filtrada `?status=AWAITING_RELEASE`) | `/estoque/lotes?status=AWAITING_RELEASE` | Lote | L/O | `estoque.lotes` |
| Lote (documento: qualidade, laudo, saldo, rastreabilidade, custo) | `/estoque/lotes/:id` | Lote | D/O | `estoque.lotes` |
| Escanear lote | `/estoque/lotes/escanear` | Lote | Q | `estoque.escanear` |
| Documentos / CoA | `/qualidade/documentos` | Lote (situação documental) | L/O | `qualidadeDocumentos.comoFunciona` |

### 2.6 Cadastros

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Clientes / Novo cliente | `/cadastros/clientes`, `/novo` | Cliente | L+E (modal) / C | `cliente.comoFunciona` |
| Fornecedores / Novo fornecedor | `/cadastros/fornecedores`, `/novo` | Fornecedor | L+E / C | `fornecedor.comoFunciona` |
| Itens de estoque / Novo item | `/cadastros/itens`, `/novo` | Item (MP, ME, PA) | L+E / C | `item.comoFunciona` |
| Produtos / Novo produto | `/cadastros/produtos`, `/novo` | Produto (+ item PA) | L+E / C | `produto.comoFunciona` |
| Estrutura de custos do produto (+ cálculo padrão, cálculos salvos) | `/produtos/:productId/custos` | CostStructure + CostCalculation | D/E/O | `estruturaCusto.comoFunciona` |
| CMV do produto | `/produtos/:productId/cmv` | Simulação sobre cálculo salvo | Q | `cmv.comoFunciona` |
| Cálculo de custo salvo | `/calculos-custo/:id` | CostCalculation | D | `calculo.comoFunciona` |

Observação: Estrutura de custos, CMV e Cálculo não estão no menu. Chegam-se por atalhos de linha na lista de Produtos ("CMV", "Custos industriais") e por links entre documentos.

### 2.7 Gestão

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Relatórios (catálogo R-01…R-20) | `/relatorios` | — | Q | `relatorios.comoFunciona` |
| 20 relatórios (Estoque 3, Produção 4, Compras 4, Comercial 3, Faturamento 3, Gestão industrial 3) | `/relatorios/**` | leitura | R | `relatorio.comoFunciona` (o mesmo para os 20) |
| Consulta de Cliente — busca | `/consultas/clientes` | Cliente | Q | `consultaCliente.comoFunciona` |
| Consulta de Cliente — casca com 7 abas (Resumo, Produtos, Projetos, Pedidos, Produção, Estoque [Acabados/Materiais], Faturamentos) e 5 detalhes (projeto, pedido, OP, produto, faturamento) | `/consultas/clientes/:customerId/**` | Cliente como raiz | Q | `consultaCliente.comoFunciona` (um para tudo) |
| Recursos Industriais / Novo / Detalhe (tarifas) | `/gestao/recursos-industriais`, `/novo`, `/:id` | Recurso + tarifas | L / C / D | `recursoIndustrial.comoFunciona` |
| Templates de Estrutura / Detalhe | `/gestao/templates-estrutura`, `/:id` | Template de estrutura | L / D | `templateCusto.comoFunciona` |
| Políticas de Precificação / Detalhe | `/gestao/politicas-precificacao`, `/:id` | Política | L / D | `politicaPreco.comoFunciona` |
| Precificação (lista) | `/gestao/precificacao` | PricingVersion | L | `precificacao.comoFunciona` |
| Precificação (documento) | `/gestao/precificacao/:pricingId` | PricingVersion | D/E/O | `precificacao.comoFunciona` |

### 2.8 Administração

| Tela | Rota | Entidade | Tipo | Ajuda |
|---|---|---|---|---|
| Usuários | `/administracao/usuarios` | Usuário | L+E | `usuario.comoFunciona` |
| Documentos controlados | `/administracao/documentos` | Revisão de formulário | L+C | `documentoControlado.comoFunciona` |

### 2.9 Fora da casca (sem ajuda, por desenho)

Login; página 404; 24 rotas `/print/**` e `/**/imprimir` (etiqueta de lote, etiqueta de amostra, relatórios, folhas operacionais FO-01 a FO-05, documentos comerciais e industriais). Documento de papel não recebe botão de ajuda — correto.

### 2.10 Superfícies secundárias (dentro de uma tela, sem ajuda própria)

| Superfície | Onde mora | Tipo | Precisa de ajuda própria? |
|---|---|---|---|
| **Orçamentos** (versões, linhas, formação de preço, condições comerciais, envio, aceite, recusa, geração de pedido) | seção do Projeto (`QuoteVersionsSection`, 1.315 linhas) | O | **SIM** — é o documento comercial mais crítico do sistema (ver seção 13 e decisão PO-1) |
| Plano de Atendimento | seção do Pedido | O | já tem (`planoAtendimento.comoFunciona`) — bem posicionado |
| Sugestão de Compra + Gerar OCs em rascunho | seção do Pedido | O | SIM (curta) |
| Reservar Produto Acabado / PA já reservado por lote / Realocar | seção do Pedido | O | SIM (curta) |
| Gerar OP para saldo restante | ação condicional do Pedido | O | dentro da ajuda do Pedido |
| Condições comerciais + plano de parcelas | formulário do Orçamento | E | dentro da ajuda do Orçamento |
| Alterar preço de faturamento | diálogo | O | SIM (3 linhas dentro do diálogo) |
| Ajustar estoque (entrada/saída/perda) | diálogo do item | O | SIM (3 linhas) |
| Consumo extra | diálogo da OP | O | SIM (3 linhas) |
| Substituição de lote na separação | ação da OP | O | dentro da ajuda da OP |
| Aprovar projeto (prévia do que será promovido) | diálogo | O | dentro da ajuda do Orçamento/Projeto |
| Usar política de precificação / Usar template | diálogos | O | dentro das ajudas de Política/Template |
| Contagem cega (FO-01) | opção de impressão | P | não |

Total de rotas de tela sob a casca: **61** (incluindo criação e detalhe como rotas distintas; contando a Consulta do Cliente como 2: busca + casca). Total de tópicos de ajuda: **48**. Total de dicas ⓘ: **104** (cadastros 31, produção 22, suprimentos 21, comercial 19, base 11).

---

## 3. Mapa mental do processo (em português simples)

Construído a partir das regras reais (`PRODUCT_RULES.md`, `MVP_PLAN.md`), do roteiro de demonstração e do código das telas. É o mapa que cada ajuda deve usar para dizer "você está aqui".

```
CADASTROS — a base que tudo cita
  Cliente ── Fornecedor ── Item de estoque (matéria-prima, embalagem) ── Produto (cria o item de produto acabado)
                                                                              │
DESENVOLVIMENTO COMERCIAL (private label)                                      │
  Projeto do cliente ── Amostras T1, T2… (consomem estoque; nunca viram lote)  │
        │                                                                      │
        ├── Produto técnico ─► Formulação (versões) ─► Estrutura de custos ─► Cálculo salvo ─► Precificação por faixa
        │                                                     (CMV = simulação sobre o cálculo salvo)
        └── Orçamento (versões: rascunho → enviado → aceito) ─── aceite ─► Aprovar projeto (promove o produto)
                       │                                                          │
                       └── recompra: novo orçamento no mesmo projeto (mantém, reajusta ou reprecifica)
                                                                                  │
VENDA                                                                             ▼
  Pedido do Cliente (rascunho → confirmado → em atendimento → parcialmente expedido → expedido)
        │
        └── Plano de Atendimento: reservar o produto acabado que existe + produzir o resto
                  ├── cria Ordens de Produção em rascunho (ligadas ao pedido)
                  └── Sugestão de Compra → Ordens de Compra em rascunho (material em falta)

SUPRIMENTOS
  Ordem de Compra (rascunho → confirmada → parcialmente recebida → recebida)
        └─► Recebimento (cria o lote interno LT-…, entrada no histórico)   ◄── ou Remessa de material do cliente
                  └─► Lote: aguardando liberação ─► Qualidade: laudo (CoA) aprovado ─► Liberar ─► Disponível
                                                                                (ou Bloquear)
PRODUÇÃO
  Ordem de Produção (rascunho → planejada → liberada → em produção → concluída)
        Planejar (congela a versão da formulação) → Liberar (reserva lotes; nada sai do estoque)
        → Separação / picking (confere o lote) → Consumo real ou Folha de Receita (aqui o estoque cai)
        → Registrar produção (nasce o lote de produto acabado, aguardando Qualidade) → Concluir (reconcilia material)

ESTOQUE — o livro-razão
  Posição (físico · reservado · disponível · em compra) · Lotes · Movimentações · Inventário físico · Materiais de clientes

ENTREGA
  Reservar produto acabado ao pedido ─► Expedição (rascunho → conferência → confirmada: baixa o estoque)
        └─► Faturamento (rascunho → emitido) — documento comercial; não é Nota Fiscal, não é Contas a Receber

GESTÃO — leitura
  Painel · Relatórios R-01…R-20 · Consulta de Cliente (tudo de um cliente sob um cabeçalho)
```

**Três variantes que a ajuda precisa distinguir**, porque mudam o caminho da pessoa:

1. **Produção sob pedido × produção para estoque.** A OP pode nascer do Plano de Atendimento (ligada ao pedido) ou ser criada avulsa em "Nova OP". O produto acabado que nasce depois do plano **não entra sozinho no pedido**: precisa ser reservado explicitamente ("Reservar disponível").
2. **Material da Veridi × material do cliente.** Entra por remessa, sem OC, com dono; só serve a OPs do próprio cliente; nunca tem custo Veridi; falta dele não vira compra.
3. **Primeira venda × recompra.** A primeira passa por Projeto → Orçamento → Aceite → Aprovar projeto → Pedido. A recompra é um **novo orçamento no mesmo projeto aprovado**, com a decisão de preço por linha (§74). Não existe "pedido recorrente".

**Onde cada família de tela entra (antes → tela → depois):**

| Tela | Vem de | Vai para |
|---|---|---|
| Cliente | — | Projeto, Produto, Pedido, Material do cliente |
| Produto | Cliente (e Projeto, quando nasce técnico) | Formulação, Estrutura de custos, Pedido, OP |
| Formulação | Produto (ou Template) | Estrutura de custos; OP |
| Estrutura de custos → Cálculo salvo | Formulação ativa + Recursos + Premissas | CMV; Precificação |
| Precificação | Cálculo salvo (ou Política) | Orçamento (faixa exata) |
| Orçamento | Projeto + Produto + Precificação ativa (ou condição anterior, ou manual) | Aceite → Aprovar projeto → Pedido |
| Pedido | Orçamento aceito (ou digitado) | Plano → OP / OC; Reserva de PA; Expedição; Faturamento |
| OC | Sugestão de Compra ou manual; Item × Fornecedor | Recebimento |
| Recebimento | OC confirmada (ou remessa do cliente) | Lote → Qualidade → Estoque |
| Lote / Qualidade | Recebimento ou Registro de produção | Disponível para OP, amostra, expedição |
| OP | Plano do Pedido ou Nova OP; Formulação ativa; estoque disponível | Lote de produto acabado → Qualidade → Reserva ao pedido |
| Expedição | Pedido em atendimento com reserva | Faturamento |
| Faturamento | Expedição confirmada | (fim do ciclo no sistema; NF fora) |

---

## 4. O modelo atual — componente, conteúdo e proteção

### 4.1 Componentes

| Componente | O que é | Onde aparece | Observação |
|---|---|---|---|
| `ContextHelp` | Botão fantasma "ⓘ Como funciona" que abre um **modal** largo (`min(1100px, 92vw)`, altura `min(80vh, 900px)`, rolagem interna). Ordem fixa: título → resumo → "Nesta tela" (glossário `dl`) → fluxos (caixas numeradas clicáveis + passo a passo) → "Passo a passo" (quando há `steps` soltos) → "O que costuma pegar" (ressalvas) → link de documentação (nunca usado) → Fechar | 61 telas | Nasce fechado, nunca abre sozinho, fecha no Escape e clicando fora, devolve o foco ao botão. Não lembra nada (sem estado de "já vi"). Sem seções recolhíveis, sem abas, sem busca, sem âncoras |
| `FlowSteps` | Caixas numeradas `1 Pedido → 2 Estoque → 3 Falta` com tom neutro/destaque/aviso; clicar destaca a etapa no texto abaixo | dentro do modal | Só HTML/CSS; acessível; é o único "fluxo visual" da ajuda |
| `InfoHint` | Ícone ⓘ ao lado de rótulo ou cabeçalho de coluna; bolha ancorada ao viewport; abre no clique, teclado ou hover | 34 telas, 104 dicas | Texto médio de 30 palavras; três dicas passam de 60 (pureza 80, equivalente estoque 83, disponível para esta OP 63) |
| `CalcHint` | "Como este valor foi calculado", com os números **desta linha**, e conferência automática da própria conta | 6 telas (Faturamento, Alterar preço, Usar política, Formulação, Precificação ×2, CMV ×5) | Excelente. É o modelo para "o que o sistema faz automaticamente" em números |
| `FlowContext` | Cadeia de documentos no topo do documento (Projeto › Pedido › OP › Expedição › Faturamento), com links | Pedido, OP, Projeto, Amostra, Expedição, Faturamento | É navegação, não ajuda — mas responde "onde estou no processo" melhor que qualquer texto. Não existe em Lote, Recebimento, OC, Orçamento |
| Subtítulo da página (`page__subtitle`) | Uma linha permanente sob o título | 33 telas | É o "nível 1" que já existe. Qualidade desigual: "Base de clientes para associação futura com produtos e ordens de produção" (Clientes) diz pouco; "Aprovar o laudo não libera o lote" (Documentos/CoA) diz tudo |
| Subtítulo de seção (`FormSection subtitle`) | Uma linha sob o título de cada bloco | dezenas | Boas frases de regra: "Somente uma expedição confirmada altera o estoque", "Conferência física — nunca altera estoque" |
| Callout de lista | Aviso com link quando a lista não cria | Expedições, Amostras | Bom padrão: diz **onde** se cria e leva até lá |
| Dicas de campo (`field__hint`) | Frases sob campos e ações | Orçamento (recompra), formulários | A dica de "Novo orçamento" em projeto aprovado é a única explicação do §69 no sistema — e não está na ajuda |

### 4.2 Conteúdo

| Fato | Valor |
|---|---|
| Registro | `help/help-content.ts` monta `helpTopics` e `helpHints` a partir de `content/{base,cadastros,comercial,gestao,producao,suprimentos}.ts` |
| Tipo | `HelpTopic { module, title, summary, concepts[], flows[]/flow[], steps[], notes[], doc? }`; `HelpHint { module, label, text }` |
| Tópicos | 48 · 31.549 palavras · média 657 · mediana 581 · mínimo 247 (Escanear) · máximo 1.288 (Formulação) |
| Tópicos acima de 900 palavras | 8: Formulação 1.288, Item 1.140, Projeto 1.140, Recebimentos 1.079, Picking 1.059, Estrutura de custos 1.050, Lotes 995, OP 963 |
| Tópicos entre 500 e 900 | 27 |
| Tópicos abaixo de 500 | 13 |
| Termos por tópico | 4 a 14 (Projeto 14, Lotes 13, Pedido 13) |
| Ressalvas por tópico | 3 a 10 (OP 10, Produto 10) |
| Dicas ⓘ | 104 · 3.151 palavras · média 30 |
| Link `doc` | nunca preenchido — não existe nenhum "Saiba mais" |
| Última revisão ampla | `fc1d8b3` 2026-09-04 "review every Como funciona against the screen it opens on" — anterior ao COM-CORE e ao COM-PRICE (2026-09-09) |

### 4.3 Proteção

- `help-topic-contract.test.ts`: toda chave `helpTopics["…"]` citada em qualquer arquivo existe; cada tela da tabela `PARES` abre o tópico da própria área; termos proibidos (`DTO`, `endpoint`, `snapshot`, `fallback`, `override`, `backend`, `frontend`, `payload`, `upload`, `layout`, `gate`, `cockpit`, `BI`, `CRM`, `barcode`, `MOQ`); termos de glossário obrigatórios por tela (ex.: Pedido precisa de "Reserva", "Produzir", "Sugestão de Compra"…).
- `help-kit.test.tsx`: cada tópico tem resumo, ≥ 4 termos, ≥ 1 fluxo; chave repetida entre arquivos falha.
- `help-*-screens.test.tsx`: ligação tela → tópico por módulo, painel nasce fechado.

**Avaliação da arquitetura atual:** correta e rara de se ver — conteúdo central, tipado, testado, sem texto no JSX. O que ela **não** tem: forma para "quando usar", "antes de começar", "sistema faz", "próximo passo" e "saiba mais"; separação entre conceito compartilhado e conceito da tela; limite de tamanho; classe de tamanho; e um teste de vocabulário em inglês (o teste proíbe termos de código, não termos de negócio em inglês).

---

## 5. Diagnóstico sistêmico — o que se repete em quase todas as telas

Cada item abaixo aparece em pelo menos dez tópicos. São os problemas a corrigir por **modelo**, não tela a tela.

**S1. O esqueleto responde as perguntas erradas primeiro.** Ordem atual: o que é → dicionário → caminho → ressalvas. O iniciante pergunta: por que estou aqui, o que faço, o que acontece depois. A resposta chega na terceira seção, depois de 8 a 14 definições. Em Projeto, o glossário tem 14 termos e ocupa 60% do modal antes do primeiro passo.

**S2. Volume sem hierarquia.** 31.549 palavras exibidas em um único nível: tudo com o mesmo peso, nada recolhível. Um modal de 1.288 palavras exige rolar quatro a cinco telas. A regra §45 fixou um piso de 4 termos e nenhum teto de palavras. Resultado: quanto mais crítica a tela, mais longa a ajuda, e menos gente lê.

**S3. Falta "Quando usar" e "Antes de começar".** Só os fluxos nomeados têm `when` ("Na tela de uma versão em rascunho"). Pré-requisitos reais existem, mas espalhados em ressalvas: "Versão com componente do cliente só ativa se o produto tiver cliente", "Sem doses por embalagem a versão não ativa", "A precificação nasce de um cálculo de custo salvo. Sem ele o sistema recusa". O iniciante descobre o pré-requisito pelo erro.

**S4. "O que o sistema faz sozinho" está diluído.** As automações mais importantes (confirmar pedido congela preço; aplicar plano cria reserva + OPs e muda o status; liberar OP reserva lotes; registrar produção cria lote aguardando Qualidade; confirmar expedição baixa físico e reserva e muda o status do pedido; enviar orçamento congela custo corrente) estão dentro de `detail` de etapas e de ressalvas, com o mesmo peso de "Observações são texto livre".

**S5. Sem "Próximo passo".** 41 dos 48 tópicos terminam em ressalvas. Só Formulação ("C. Da versão ativa ao preço") e Produto ("B. Do produto ao preço") desenham o que vem depois. Nenhum tópico termina com um link.

**S6. Registro autoral, não operacional.** Frases como "É o que costuma gerar chamado", "ver não é poder usar", "preencher REGISTRA; marcar AUTORIZA", "reserva é compromisso, consumo é baixa física", "o desenho vira o índice do próprio conteúdo" são memoráveis para quem já entendeu e opacas para quem não entendeu. Travessões encadeados em 70% das frases. Média de 26 palavras por frase nas ressalvas.

**S7. Jargão sem glosa.** Overage, markup, FEFO, FIFO, CoA, Kardex, "por unidade acabada", "base de referência", "fronteira", "transação" ("entram na mesma transação", "numa transação só" — Plano e Pedido). O teste proíbe termos de código, mas não termos de negócio em inglês nem termos técnicos de banco.

**S8. Uma ajuda para telas diferentes.** Recebimentos: um tópico de 1.079 palavras com três fluxos serve quatro telas — a tela "Receber material do cliente" abre uma ajuda cujo primeiro fluxo é "Recebimento de OC", irrelevante ali. Lista + criação + documento compartilham tópico em Item, Produto, Cliente, Fornecedor, OC, Recurso (por regra §45, "a tela de criação abre a mesma ajuda da lista"). Os 20 relatórios abrem o mesmo texto genérico.

**S9. Duplicação de conceito.** "Físico / Reservado / Disponível / Em compra" é definido em Posição, Item, Produto Acabado, Plano, OP, Pedido, Materiais de clientes, Lotes (8 tópicos) e em 12 dicas ⓘ. "Reserva não movimenta estoque; consumo movimenta" aparece em 9 tópicos. "Material do cliente não tem custo Veridi" em 8. "Lote interno × lote do fornecedor" em 6. "Custo desconhecido nunca vira zero" em 7. "Rascunho × ativa; ativa é histórico" em 9. Cada cópia tem redação diferente, e cada revisão precisa achar todas.

**S10. Desatualização localizada, mas no ponto mais caro.** Projetos/Projeto (§69, §70, §71, §74 — ver seção 9.1). Pedido não menciona desconto global acordado (que hoje não chega ao Faturamento — BILL-DISCOUNT-01 é problema de produto, mas a ajuda do Faturamento diz "preço acordado" e silencia sobre o desconto). Lotes: "Vencido é calculado pela data" está certo, mas não diz que vale o dia inteiro (§73).

**S11. Sem exemplo numérico.** Zero exemplos com números em 31 mil palavras. Faixa exata ("750 entre 500 e 1.000 não tem preço vigente") é o único quase-exemplo. Conceitos que pedem número: unidade (1 kg = 1.000 g), por dose (60 doses × 250 mg), faixa de quantidade, reajuste (R$ 10,00 + 5% = R$ 10,50), pureza (80% → pesar 1,25×), entrega parcial (3 × 1.000).

**S12. Sem estado e sem memória.** O modal não sabe em que situação o documento está: a OP "Em produção" abre a mesma ajuda da OP em rascunho, começando por "Nova versão". Não há "já vi", nem "novidades desde a última vez".

**S13. Termos de tela × termos de ajuda.** A tela diz "Picking" e "Registrar produção"; a ajuda diz "Separação (picking)" e "Apontamento"; o fluxo diz "Produção realizada". "Status" (15 rótulos) e "Situação" (37 rótulos) convivem. Ver seção 14.

**S14. Mobile.** O modal usa 92vw e rola; funciona, mas o glossário `dl` em duas colunas e as caixas do fluxo empilham em 4–5 telas de altura. Não é prioridade (fase desktop), mas o painel lateral da opção B resolve melhor.

---

## 6. Notas por tela (rubrica 0–5)

Critérios: **A** clareza · **B** objetivo da tela · **C** contexto de processo · **D** explicação dos campos · **E** orientação sobre próxima etapa · **F** linguagem para não técnico · **G** capacidade de evitar erro · **H** concisão · **I** coerência com a tela real. Nota geral = soma ÷ 45 × 10. Tamanho ideal proposto: **S** ≤ 250 palavras, **M** ≤ 500, **L** ≤ 800 com níveis recolhíveis. Prioridade: **P0** erro operacional/financeiro sério · **P1** tela difícil · **P2** produtividade · **P3** simples.

| Tópico | Telas | Palavras | A | B | C | D | E | F | G | H | I | Nota | Tam. | Prior. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `formulacao.comoFunciona` | Formulação do produto; Versão | 1.288 | 3 | 4 | 3 | 5 | 2 | 2 | 4 | 1 | 4 | **6,2** | L | P0 |
| `formulacao.lista` | Formulações | 260 | 4 | 4 | 3 | 3 | 3 | 4 | 3 | 4 | 4 | 7,1 | S | P2 |
| `planoAtendimento.comoFunciona` | Plano (seção do Pedido) | 426 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 4 | 4 | 7,3 | M | P0 |
| `ordemProducao.comoFunciona` | Nova OP; OP | 963 | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 1 | 4 | 6,4 | L | P0 |
| `producao.ordens` | Ordens de Produção | 269 | 4 | 4 | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 6,9 | S | P2 |
| `cmv.comoFunciona` | CMV | 902 | 3 | 4 | 3 | 4 | 1 | 2 | 4 | 2 | 4 | 6,0 | M | P1 |
| `faturamento.comoFunciona` | Faturamento (doc) | 580 | 4 | 5 | 4 | 4 | 2 | 4 | 4 | 3 | 4 | 7,6 | M | P0 |
| `faturamento.lista` | Faturamento (fila) | 285 | 4 | 4 | 4 | 3 | 3 | 4 | 3 | 4 | 4 | 7,3 | S | P2 |
| `item.comoFunciona` | Itens; Novo item | 1.140 | 3 | 4 | 3 | 5 | 2 | 3 | 4 | 1 | 4 | 6,4 | M | P2 |
| `produto.comoFunciona` | Produtos; Novo produto | 942 | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 2 | 4 | 6,7 | M | P1 |
| `cliente.comoFunciona` | Clientes; Novo cliente | 490 | 4 | 4 | 3 | 4 | 2 | 4 | 4 | 3 | 4 | 7,1 | S | P3 |
| `fornecedor.comoFunciona` | Fornecedores; Novo | 420 | 4 | 4 | 3 | 3 | 3 | 4 | 3 | 4 | 4 | 7,1 | S | P3 |
| `recursoIndustrial.comoFunciona` | Recursos; Novo; Detalhe | 737 | 3 | 4 | 3 | 4 | 2 | 3 | 4 | 2 | 4 | 6,4 | M | P2 |
| `qualidadeDocumentos.comoFunciona` | Documentos / CoA | 521 | 4 | 5 | 4 | 4 | 3 | 3 | 5 | 3 | 4 | 7,8 | M | P1 |
| `usuario.comoFunciona` | Usuários | 485 | 4 | 4 | 2 | 4 | 2 | 4 | 4 | 3 | 4 | 6,9 | S | P3 |
| `documentoControlado.comoFunciona` | Documentos controlados | 410 | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 3 | 4 | 6,9 | S | P3 |
| `relatorios.comoFunciona` | Relatórios (catálogo) | 412 | 4 | 4 | 2 | 3 | 2 | 3 | 3 | 4 | 4 | 6,4 | S | P3 |
| `painel.comoFunciona` | Painel | 528 | 3 | 4 | 2 | 4 | 2 | 3 | 3 | 3 | 4 | 6,2 | S | P3 |
| `comercial.projetos` | Projetos | 630 | 3 | 4 | 3 | 4 | 2 | 3 | 3 | 3 | 2 | 6,0 | M | P1 |
| `comercial.projeto` | Projeto (ficha + Orçamentos) | 1.140 | 2 | 3 | 3 | 4 | 2 | 2 | 3 | 1 | 2 | **4,9** | L (dividir) | P0 |
| `comercial.amostras` | Amostras | 521 | 4 | 5 | 4 | 4 | 2 | 3 | 4 | 3 | 4 | 7,3 | S | P2 |
| `comercial.amostra` | Amostra | 581 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 3 | 4 | 7,1 | M | P2 |
| `comercial.pedidos` | Pedidos | 505 | 4 | 4 | 5 | 4 | 3 | 3 | 4 | 3 | 4 | 7,6 | M | P1 |
| `comercial.pedido` | Novo pedido; Pedido | 750 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 2 | 4 | 6,9 | L | P0 |
| `comercial.expedicoes` | Expedições | 459 | 4 | 4 | 5 | 4 | 3 | 4 | 4 | 3 | 4 | 7,8 | S | P2 |
| `comercial.expedicao` | Expedição | 876 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 2 | 4 | 6,9 | M | P0 |
| `precificacao.comoFunciona` | Precificação (lista); Precificação (doc) | 887 | 3 | 4 | 4 | 4 | 2 | 2 | 4 | 2 | 4 | 6,4 | L | P0 |
| `calculo.comoFunciona` | Cálculo salvo | 719 | 3 | 4 | 3 | 4 | 2 | 3 | 4 | 2 | 4 | 6,4 | M | P1 |
| `estruturaCusto.comoFunciona` | Estrutura de custos | 1.050 | 2 | 4 | 3 | 4 | 2 | 2 | 4 | 1 | 4 | **5,8** | L | P0 |
| `templateCusto.comoFunciona` | Templates de Estrutura; Detalhe | 517 | 3 | 4 | 3 | 3 | 2 | 2 | 4 | 3 | 4 | 6,2 | M | P2 |
| `politicaPreco.comoFunciona` | Políticas; Detalhe | 542 | 3 | 4 | 3 | 3 | 2 | 2 | 4 | 3 | 4 | 6,2 | M | P2 |
| `relatorio.comoFunciona` | os 20 relatórios | 427 | 4 | 4 | 2 | 3 | 2 | 4 | 3 | 4 | 3 | 6,4 | S | P2 |
| `consultaCliente.comoFunciona` | Consulta (busca, casca, abas) | 394 | 4 | 4 | 2 | 3 | 3 | 4 | 3 | 4 | 4 | 6,9 | M | P2 |
| `producao.picking` | Picking / Consumo | 1.059 | 3 | 4 | 4 | 4 | 2 | 2 | 4 | 1 | 3 | 6,0 | S | P1 |
| `producao.folhaReceita` | Folha de Receita | 738 | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 2 | 4 | 6,7 | M | P1 |
| `producao.produtoAcabado` | Produto Acabado | 834 | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 2 | 4 | 6,7 | M | P2 |
| `producao.templates` | Templates de Formulação | 643 | 3 | 4 | 3 | 3 | 2 | 2 | 4 | 2 | 4 | 6,0 | M | P2 |
| `producao.templateDetalhe` | Template (detalhe) | 651 | 3 | 4 | 3 | 3 | 2 | 3 | 4 | 2 | 4 | 6,2 | M | P2 |
| `compras.ordens` | OCs; Nova OC; OC | 750 | 4 | 5 | 4 | 4 | 3 | 3 | 4 | 2 | 4 | 7,3 | M | P1 |
| `compras.recebimentos` | Recebimentos; Receber OC; Material do cliente; Recebimento | 1.079 | 3 | 4 | 4 | 4 | 2 | 3 | 4 | 1 | 3 | 6,2 | L (dividir) | P0 |
| `compras.itemFornecedor` | Item × Fornecedor | 757 | 3 | 4 | 3 | 4 | 2 | 3 | 4 | 2 | 4 | 6,4 | M | P2 |
| `estoque.posicao` | Posição de Estoque | 583 | 4 | 5 | 4 | 5 | 2 | 3 | 4 | 3 | 4 | 7,6 | M | P1 |
| `estoque.item` | Item no estoque | 664 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 3 | 4 | 7,1 | M | P1 |
| `estoque.movimentacoes` | Movimentações | 513 | 4 | 5 | 3 | 4 | 3 | 4 | 4 | 3 | 4 | 7,6 | S | P2 |
| `estoque.inventario` | Inventário Físico | 420 | 4 | 5 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | 7,8 | M | P1 |
| `estoque.materiaisCliente` | Materiais de Clientes | 560 | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 3 | 4 | 7,1 | S | P2 |
| `estoque.lotes` | Lotes; Liberação de lotes; Lote | 995 | 3 | 4 | 4 | 4 | 2 | 2 | 4 | 1 | 4 | 6,2 | L (dividir) | P0 |
| `estoque.escanear` | Escanear lote | 247 | 5 | 5 | 3 | 3 | 4 | 4 | 4 | 5 | 5 | **8,4** | S | P3 |

**Média: 6,8 / 10.** Médias por critério: A 3,5 · B 4,1 · C 3,4 · D 3,9 · E 2,3 · F 3,0 · G 3,8 · H 2,5 · I 3,9.

Leitura: **B, D e G altos** (a ajuda sabe o que a tela é, explica os campos e antecipa erros). **E, H e F baixos** (não diz o próximo passo, é longa e fala difícil). Esse é o retrato de um conteúdo escrito por especialista para especialista.

---

## 7. Padrão editorial recomendado

### 7.1 O esqueleto (nível 1, 2 e 3)

Avaliei o formato proposto no briefing (O QUE É / PARA QUE SERVE / COMO FUNCIONA / PRINCIPAIS CAMPOS / SISTEMA FAZ / ONDE ENTRA / ATENÇÃO / PRÓXIMO PASSO). Ele é melhor que o atual. Proponho uma variação que funde "o que é" e "para que serve" em um parágrafo só, acrescenta **Quando usar** e **Antes de começar** (as duas perguntas que mais geram erro de iniciante), escreve cada passo como **você faz → o sistema faz**, e organiza tudo em três níveis para o componente poder recolher.

```
NÍVEL 1 — sempre visível (≤ 80 palavras)
  ■ Em uma frase        O que é esta tela e para que serve (1–2 frases).
  ■ Quando usar         2–3 situações concretas ("Use quando…").
  ■ Próximo passo       A ação mais provável depois, com link.

NÍVEL 2 — aberto por padrão (≤ 250 palavras)
  ■ Antes de começar    Pré-requisitos reais, com link para onde se resolve cada um.
  ■ Passo a passo       3–6 passos. Cada passo: "Você faz …" → "O sistema …".
  ■ O sistema faz sozinho   Lista curta das automações (calcula, reserva, cria lote, congela, muda situação).
  ■ Onde isto entra     Antes → ESTA TELA → Depois (FlowSteps, 3–5 caixas).

NÍVEL 3 — recolhido (sem teto rígido, mas com classe de tamanho)
  ■ Termos desta tela   Só os que confundem: nome ≠ significado, regra, cálculo, consequência.
  ■ Situações           Os estados que importam, em ordem, com o que cada um permite.
  ■ Atenção             Irreversível, erros comuns, o que a tela NÃO faz. Máximo 5.
  ■ Exemplo             Um exemplo numérico quando o conceito é difícil.
  ■ Saiba mais          Links para páginas de conceito compartilhadas e para a tela relacionada.
```

**Por que esta ordem e não a do §45.** O §45 decidiu "glossário antes do caminho" porque uma versão anterior explicava só a cadeia macro e ninguém entendia a tela. A decisão corrigiu um defeito real, mas produziu outro: a ajuda vira dicionário. O esqueleto acima preserva a lição (a primeira frase diz o que a tela **é**) e move o dicionário para o nível 3, onde ele é consultado, não lido. Os termos difíceis são explicados **dentro do passo** em que aparecem ("Ative a versão — a partir daqui ela não muda mais") e a dica ⓘ continua no campo. Isso exige revisar o §45, o que é decisão de PO (seção 20).

### 7.2 Regras de escrita (para o guia futuro)

1. **Frase de até 20 palavras, uma ideia por frase.** Travessão no máximo um por parágrafo. Sem aforismo: se a frase precisa ser "sacada", ela não foi entendida.
2. **Verbo no imperativo para o usuário, terceira pessoa para o sistema.** "Confirme o pedido. O sistema congela cliente, produtos, quantidades e preço."
3. **Nome da tela e do botão exatamente como estão na interface**, entre aspas na primeira citação: "Aplicar Plano de Atendimento", "Registrar produção", "Confirmar separação". A ajuda nunca cria um sinônimo para um botão que existe.
4. **Termo em inglês só com glosa e só quando a interface o usa**: "overage (excesso planejado)", "markup (quanto o preço está acima do custo)". FEFO, FIFO, Kardex, cockpit, draft não entram.
5. **Sem termo de implementação**: transação, DTO, snapshot, enum, status interno, ID, FK, endpoint, tier, "servidor" (dizer "o sistema").
6. **Número com exemplo quando há cálculo**: "1 kg e 1.000 g são a mesma quantidade"; "R$ 10,00 com 5% de reajuste vira R$ 10,50".
7. **Automação sempre marcada**: prefixo "O sistema" ou o selo ⚙ no componente.
8. **Irreversível sempre marcado**: prefixo "Não tem volta:" na seção Atenção.
9. **Papel de acesso dito uma vez**, na seção Atenção: "Só o perfil Qualidade libera lote."
10. **Uma explicação por conceito compartilhado.** Se a mesma ideia serve a mais de três telas, ela vira página de conceito e a tela linka, com uma frase de contexto.
11. **Tamanho por classe** (S/M/L) e teste que falha ao ultrapassar: S ≤ 250, M ≤ 500, L ≤ 800 palavras no total, e nível 1 ≤ 80 sempre.
12. **Português do Brasil, registro profissional.** Sem "você pode", "basta", "é só", "simplesmente"; sem tom de tutorial.

### 7.3 Classes de tamanho — critério

| Classe | Quando | Exemplos |
|---|---|---|
| **S** | Lista de consulta, tela com uma ação, cadastro simples | Escanear, Movimentações, Fornecedores, Clientes, Relatórios (catálogo), Formulações (lista), Expedições (lista) |
| **M** | Tela com 2–4 ações e uma regra de negócio importante | Posição de Estoque, Inventário, Faturamento (doc), Amostra, CMV, Cálculo, Produto, OC |
| **L** | Tela de fluxo com estados, várias ações irreversíveis, automações e pré-requisitos | Formulação (versão), Orçamento, Pedido, OP, Precificação, Estrutura de custos, Lote (qualidade), Recebimento (OC) |

Regra: L exige níveis recolhidos e "Saiba mais"; nunca tudo aberto.

### 7.4 Progressive disclosure na interface (avaliação)

| Recurso | Avaliação | Recomendação |
|---|---|---|
| Seções expansíveis | Necessárias em L; úteis em M | Nível 3 recolhido por padrão; lembrar o que a pessoa abriu |
| Cards | Bom para "Você faz / O sistema faz" lado a lado | Passo a passo em duas colunas no desktop, empilhado no mobile |
| Lista numerada | Mantém; já casa com `FlowSteps` | Passo = caixa do fluxo (já existe o clique que destaca) |
| Pequenos exemplos | Faltam completamente | Bloco "Exemplo" com número real, em 8–10 telas |
| Alertas | Mantém o tom `warn` do `FlowSteps`; acrescentar selo "Não tem volta" | Só em Atenção |
| Links para telas relacionadas | Faltam | "Antes de começar" e "Próximo passo" com links reais (o `RelatedLinks` já sabe filtrar destino) |
| Fluxo visual | `FlowSteps` é bom; falta o "antes/depois" da tela | Reusar `FlowSteps` com 3–5 caixas: anterior (cinza) → ESTA TELA (destaque) → seguinte |

---

## 8. Componente — três opções

Perguntas do briefing respondidas para o componente atual: aparece no lugar certo (sim: abaixo do cabeçalho, na barra de ações — mas o botão é fantasma pequeno e some entre "Exportar CSV" e "+ Novo"); é perceptível (pouco); ocupa espaço demais (não, é modal); deveria abrir drawer/modal/popover (drawer: ver B); deveria lembrar se já foi visto (sim, por usuário); deveria ter seções (sim); deveria mostrar fluxo (já mostra; falta antes/depois); deveria permitir "Saiba mais" (sim, o campo `doc` existe e nunca foi usado); mobile funciona (funciona, cansa); conteúdo longo fica legível (não em L).

### Opção A — Mínima (só conteúdo e ordem; zero componente novo)

- Reordenar as seções do modal para o esqueleto da seção 7.1: nível 1 no topo, glossário e ressalvas no fim.
- `notes` e `concepts` dentro de `<details>` nativo (recolhido), com contagem no título ("Termos desta tela (9)").
- Preencher `doc` com links internos para páginas de conceito (uma rota `/ajuda/conceitos/:slug` estática) e para telas relacionadas.
- Teto de palavras por classe de tamanho, testado.
- Custo: baixo. Ganho: resolve S1, S2, S5, parte de S9. Não resolve S12, S14, descoberta do botão.

### Opção B — Recomendada (painel lateral com abas e conceitos compartilhados)

- **Painel lateral direito** ("drawer contextual", previsto em `UI_BRAND` como "optional contextual right drawer only when useful") em vez de modal: a tela continua visível e operável enquanto a pessoa lê; largura ~420px, fixa; fecha no Escape, no X e ao navegar.
- **Abas**: *Resumo* (nível 1 + Antes de começar + Próximo passo) · *Passo a passo* (você faz / sistema faz + Onde isto entra) · *Termos* (glossário + dicas ⓘ da tela, reaproveitadas) · *Atenção* (irreversível, erros, papéis). Lembra a última aba por usuário.
- **Botão de ajuda promovido**: ícone "?" fixo no canto direito do cabeçalho da página (mesma posição em toda tela), com rótulo "Como funciona" no desktop; ponto de novidade quando o conteúdo mudou desde a última leitura do usuário.
- **Página de conceito** (`/ajuda/conceitos/:slug`): sete conceitos compartilhados (seção 19.2), cada um com exemplo numérico. A tela linka com uma frase de contexto. Também é a base de um futuro glossário geral.
- **Situação-consciente, versão simples**: o documento informa sua situação ao painel; a aba Passo a passo abre com o passo correspondente destacado (a OP liberada abre em "Separação"). Sem lógica nova de negócio: é o mesmo `FlowSteps` com `selected`.
- **Mobile**: painel vira folha de baixo para cima (bottom sheet) com as mesmas abas.
- Custo: médio (um componente novo, rotas estáticas de conceito, um campo `status` opcional). Ganho: resolve S1–S9, S12, S14 e a descoberta do botão.

### Opção C — Avançada (B + orientação ativa)

- **Primeiro acesso guiado** por tela e por usuário: um balão único apontando a ação principal ("Comece por 'Confirmar pedido'"), descartável, gravado por usuário — nunca um tour de dez passos.
- **Ajuda por campo em formulários P0** (Formulação, Orçamento, Precificação): o ⓘ passa a abrir a entrada correspondente da aba Termos, com exemplo.
- **Busca na ajuda** (topo do painel): procura em títulos, termos, apelidos e conceitos, com o mesmo índice de apelidos do catálogo de relatórios.
- **"O que mudou"**: o painel lista as regras novas desde a última versão lida (a data da revisão vive no conteúdo).
- **Métrica**: registrar abertura de painel por tela e por aba (sem texto digitado) para saber onde a ajuda é consultada — orienta a próxima rodada de escrita.
- **Impressão da ajuda** de uma tela (para o material de treinamento).
- Custo: alto. Ganho adicional: onboarding real, dados de uso. Recomendado como fase 3, não como primeiro passo.

**Recomendação: B**, com A como primeiro entregável (o conteúdo novo pode nascer no modal atual e migrar para o painel sem reescrita).

---

## 9. Cinco telas críticas no formato final recomendado

Os cinco exemplos abaixo mostram a experiência nova por inteiro: texto atual, problemas e a proposta completa nos três níveis. Os rótulos de botão e de seção são os que existem na tela hoje. Regra citada só quando o texto depende dela.

### 9.1 Orçamento — hoje dentro da ficha do Projeto (`/comercial/projetos/:id`, seção "Orçamentos")

**Texto atual** (`comercial.projeto`, compartilhado com a ficha inteira do Projeto). Título: *"O que a ficha do Projeto reúne — e o que a aprovação libera"*. Resumo: *"Esta é a ficha completa de uma negociação: o cliente, os produtos que o projeto desenvolve, a cadeia de custo e preço de cada um, as versões de orçamento e as amostras já feitas. O preço de cada linha da proposta ou vem de uma faixa da precificação ativa do produto, ou é digitado à mão — e a proposta continua editável só enquanto é rascunho. É a proposta aceita que autoriza aprovar o projeto, e é a aprovação que promove o produto de desenvolvimento a produto operacional."* Estrutura: 14 termos · 2 fluxos / 13 etapas · 8 ressalvas · 1.140 palavras. Nota 4,9.

**Problemas.**
- **Desatualizado.** Diz que "Aprovado e cancelado são terminais" e que projeto aprovado "não aceita orçamento novo". A tela mostra "Novo orçamento" em projeto aprovado e a dica *"Cada nova compra deste cliente é um orçamento novo, aqui mesmo"* (§69). A recompra é hoje o caminho normal de venda e não está na ajuda.
- **Não explica a formação de preço por linha** (§74): "Manter condição", "Reajustar condição" + "Aplicar reajuste", "Usar precificação", "Usar preço manual", nem quando a tela sugere sozinha (mesma quantidade e condição vigente) e quando exige motivo (quantidade diferente ou condição vencida).
- **Não explica validade** (§71): "Enviar ao cliente" fica desabilitado sem validade; proposta enviada e vencida não aceita ("Proposta vencida em … — crie uma nova versão"); aceita não vence.
- **Não diz que o envio congela também o custo corrente** da faixa equivalente (base do CMV-VAR futuro) e que várias versões podem estar "Aceito" ao mesmo tempo, cada uma com o seu Pedido (§70).
- Orçamento e ficha do Projeto dividem um só modal: quem está na linha da proposta lê antes sobre produto técnico, amostras e documentos do projeto.
- Registro: "Vínculo que sobrevivesse à edição manual seria mentira", "pelo estágio, não pela boa vontade da tela".
- Termos "Proveniência do preço", "Fechamento", "Simular CMV" sem contexto de uso.

**Proposta — tópico novo `comercial.orcamento`, classe L**, aberto pelo botão da seção "Orçamentos" (e pela futura tela própria, se o PO decidir criá-la — decisão PO-1). A ficha do Projeto fica com um tópico M reescrito (seção 10.2).

> **Em uma frase**
> O orçamento é a proposta de preço e condições que a Veridi apresenta ao cliente para um ou mais produtos deste projeto. Cada negociação é uma versão nova; a versão aceita é o que autoriza gerar o Pedido.
>
> **Quando usar**
> - Na primeira venda de um produto em desenvolvimento, depois que existe precificação ativa (ou quando o negócio não pode esperar por ela).
> - Em toda recompra: o cliente que voltou a comprar recebe um novo orçamento **neste mesmo projeto**, não um projeto novo.
> - Para registrar que o cliente aceitou ou recusou uma proposta já enviada.
>
> **Próximo passo**
> Proposta aceita em projeto ainda não aprovado → "Aprovar projeto". Projeto já aprovado → gerar o Pedido na seção Fechamento.
>
> ---
>
> **Antes de começar**
> - O projeto precisa estar aberto (não cancelado).
> - Para puxar o preço da precificação, o produto precisa ter uma **precificação ativa com uma faixa na quantidade exata** que será cotada (750 unidades não usam a faixa de 500 nem a de 1.000).
> - Para "Manter condição" ou "Reajustar condição", precisa existir uma proposta **aceita** anterior do mesmo produto neste projeto.
> - Para gerar o Pedido depois, o produto precisa estar aprovado (isso acontece na aprovação do projeto).
>
> **Passo a passo**
> 1. **Você** clica em "Criar nova versão" (ou "Novo orçamento", em projeto aprovado) → **o sistema** cria um rascunho numerado. Existe um rascunho por vez; se já houver, o botão é "Abrir rascunho".
> 2. **Você** adiciona as linhas: produto, quantidade e unidade → **o sistema** procura preço para cada linha e mostra "Como formar o preço?" com as opções que existem para aquela linha.
> 3. **Você** decide o preço **linha a linha**:
>    - "Manter condição": repete o preço que este cliente já aceitou para este produto. Vem sugerido quando a condição ainda vale e a quantidade é a mesma. Quantidade diferente ou condição vencida exigem um motivo, que fica gravado.
>    - "Reajustar condição": informe um percentual (0% ou mais) e "Aplicar reajuste" → o sistema calcula o novo preço sobre a condição anterior. Não exige motivo.
>    - "Usar precificação" / "Aplicar preço calculado": usa a faixa ativa da quantidade exata → o sistema trava quantidade, unidade e preço na faixa.
>    - "Usar preço manual": você digita o preço. É exceção comercial, aparece como aviso.
> 4. **Você** preenche as **condições comerciais** ("Salvar condições"): validade da proposta, prazo de entrega, desconto, forma de pagamento, entrada, parcelas, intervalo e juros → **o sistema** calcula o plano de parcelas e o "Total da proposta (prévia)" enquanto você digita; o total gravado aparece ao lado como "Total salvo".
> 5. **Você** clica em "Enviar ao cliente" → **o sistema** congela a versão (cliente, linhas, preços, condições, origem de cada preço e o custo de referência de hoje) e ela vira somente leitura. Enviar **não** manda e-mail: registra que a proposta foi apresentada.
> 6. **Você** registra a resposta: "Registrar aceite" ou "Registrar recusa" → **o sistema** marca a versão. Renegociar é criar outra versão; a anterior fica no histórico.
>
> **O sistema faz sozinho**
> - Sugere "Manter condição" só quando a condição anterior está vigente e a quantidade é idêntica (1 kg e 1.000 g contam como a mesma quantidade).
> - Solta o preço herdado ou reajustado se você mudar a quantidade da linha: aquele preço era de outra quantidade.
> - Recusa o envio sem validade, e recusa o aceite de proposta vencida.
> - Ao aceitar, supera as propostas aceitas em aberto deste projeto; a que já virou Pedido continua "Aceito", porque é a origem daquele Pedido.
> - Guarda de onde veio cada preço (precificação, condição anterior, reajuste, manual). Isso é informação interna: **não sai no documento do cliente**, assim como custo, margem, markup e comissão.
>
> **Onde isto entra**
> Precificação ativa (ou condição anterior) → **ORÇAMENTO** → Aceite → Aprovar projeto (1ª venda) → Pedido do Cliente
>
> ---
>
> **Termos desta tela**
> - *Versão*: cada proposta é uma versão com situação própria — Rascunho, Enviado, Aceito, Recusado ou Substituído. Só o rascunho se edita.
> - *Faixa de precificação*: um cenário fechado de quantidade e preço. A linha só se prende à faixa cuja quantidade é exatamente a cotada.
> - *Condição acordada*: o preço da última proposta aceita deste produto neste projeto, com a quantidade e a validade daquela negociação.
> - *Validade*: até que dia o cliente pode aceitar. Vale o dia inteiro. Depois disso a proposta não aceita mais; o caminho é uma versão nova.
> - *Prévia × salvo*: "prévia" acompanha o que está na tela; "salvo" é o que está gravado. Enviado e aceito não recalculam.
> - *Simular CMV*: abre a simulação de custo já na quantidade da linha. Não muda preço nem grava nada.
>
> **Situações**
> Rascunho (edita) → Enviado (congelado; aguarda resposta) → Aceito (pode gerar Pedido) ou Recusado. Substituído: uma versão aceita depois tomou o lugar desta.
>
> **Atenção**
> - **Não tem volta:** enviar congela a versão; aceitar autoriza pedido com aquele preço. Corrigir é criar outra versão.
> - Custo, margem e comissão só aparecem para os perfis Comercial e Administrador, e nunca no impresso.
> - Proposta com custo industrial incompleto pode ser enviada, mas o sistema pede confirmação e registra que a margem não era calculável.
> - Reajuste não abaixa preço: percentual negativo não existe. Para vender abaixo do acordo use preço manual ou o desconto das condições comerciais.
> - Uma versão aceita gera no máximo um Pedido; gerar de novo devolve o mesmo.
>
> **Exemplo**
> O cliente fechou 3.000 unidades a R$ 12,50 em março. Em junho pede 3.000 de novo: a linha vem com "Manter condição" sugerido. Se pedir 1.000, a condição aparece como referência, e manter o preço exige motivo; reajustar 4% dá R$ 13,00 sem motivo.
>
> **Saiba mais**
> Conceito: Prévia × valor gravado · Conceito: Faixa de quantidade · Tela: Precificação do produto · Tela: Pedido do Cliente

### 9.2 Formulação — versão (`/producao/formulacoes/:productId/versoes/:versionId`)

**Texto atual** (`formulacao.comoFunciona`, compartilhado com o histórico de versões). Título: *"Formulação: a receita em versões, e o que cada número significa"*. Resumo: *"A formulação é a receita oficial de um produto: quais matérias-primas e embalagens entram, quanto de cada uma, e sobre qual base essa quantidade é declarada. Ela não é editada no lugar — é escrita em versões. Uma versão vale enquanto é rascunho e vira documento no momento em que é ativada: dali em diante ela não muda mais, e é ela que a produção executa e que o custo e o preço leem. Esta ajuda cobre a lista de versões do produto e a tela de uma versão."* Estrutura: 12 termos · 3 fluxos / 14 etapas · 9 ressalvas · 1.288 palavras (a maior do sistema). Nota 6,2.

**Problemas.**
- O maior modal do sistema para a tela com mais regras difíceis: a pessoa precisa de ajuda **por campo** e recebe um tratado.
- O termo mais crítico ("Quantidade informada × equivalente estoque × físico por unidade") é explicado em 95 palavras sem um número.
- "Preencher REGISTRA; marcar AUTORIZA" e "Aviso de dupla correção" — regra difícil, explicada em aforismo. Sem exemplo de pureza.
- Nenhum "Antes de começar" (doses por embalagem, cliente vinculado para componente do cliente, item na unidade certa).
- Sem "Próximo passo" explícito; o fluxo C ("Da versão ativa ao preço") é o mais útil da ajuda inteira e está no fim.
- Não cita os botões reais: "Salvar rascunho", "Ativar versão", "Criar nova versão", "+ Adicionar componente", "Salvar como template", "Usar template da biblioteca", "Criar formulação em branco".
- Não diz que a estimativa de custo agora se atualiza ao salvar e se identifica como "Custo do último salvamento" quando há edição pendente (FIX-06).

**Proposta — `formulacao.versao`, classe L.** O histórico de versões (`/producao/formulacoes/:productId`) recebe um tópico S próprio (seção 11.1).

> **Em uma frase**
> A formulação é a receita oficial do produto: quais itens de estoque entram e quanto de cada um para produzir uma quantidade-base. É esta receita que a Ordem de Produção executa e que o custo e o preço leem.
>
> **Quando usar**
> - Para escrever a primeira receita de um produto novo.
> - Para mudar uma receita em uso: crie uma versão nova; a ativa continua valendo até você ativar a nova.
> - Para consultar a versão exata que uma ordem antiga executou.
>
> **Próximo passo**
> Versão ativada → crie ou atualize a Estrutura de custos do produto, ou abra uma Ordem de Produção.
>
> ---
>
> **Antes de começar**
> - Produto cadastrado (o item de produto acabado nasce junto com ele).
> - Cada matéria-prima e embalagem cadastrada como item de estoque, na unidade em que é comprada e pesada.
> - Se algum componente for declarado **por dose**, saiba quantas doses cabem em uma embalagem: sem esse número a versão não ativa e o custo não existe.
> - Se algum componente for **fornecido pelo cliente**, o produto precisa ter cliente vinculado.
>
> **Passo a passo**
> 1. **Você** cria a receita ("Criar formulação em branco" ou "Usar template da biblioteca") ou "Criar nova versão" a partir da ativa → **o sistema** abre uma versão em rascunho, já copiada da ativa quando existe.
> 2. **Você** define, em "Produto e base", a base da formulação (quanto de produto acabado a receita produz) e o modo de cálculo: **base fixa** (as quantidades produzem a base) ou **por dose** (a quantidade de cada componente é para UMA dose) → **o sistema** passa a interpretar todos os números abaixo em relação a essa base. Decida isto antes de digitar quantidades.
> 3. **Você** adiciona os componentes ("+ Adicionar componente"): item, quantidade, unidade, base da linha e quem fornece (Veridi ou cliente) → **o sistema** converte para a unidade de estoque do item e mostra ao lado "Equivalente estoque" e "Físico por unidade".
> 4. **Você** decide, por linha, o que a quantidade significa: **"Quantidade física informada"** (o número já é o que vai para a balança) ou **"Calcular quantidade física"** (o número é teórico e o sistema aplica os ajustes de pureza e overage que você marcar) → **o sistema** recalcula o físico e mostra a conta no ⓘ.
> 5. **Você** clica em "Salvar rascunho" quantas vezes precisar → **o sistema** guarda e atualiza o bloco "Custo estimado de materiais". Rascunho não produz nem custeia nada.
> 6. **Você** clica em "Ativar versão" → **o sistema** grava o que está na tela, fecha a versão, desativa a anterior e passa a usar esta em toda ordem, cálculo e preço novos.
>
> **O sistema faz sozinho**
> - Converte unidades (1 kg = 1.000 g) e calcula o físico por unidade acabada — é o físico que a ordem reserva e consome.
> - Multiplica componente por dose pelas doses por embalagem; embalagem nunca é multiplicada por dose.
> - Estima o custo de materiais com as fontes de custo de hoje, e avisa "Custo do último salvamento" enquanto há edição pendente. Essa estimativa não é gravada: o custo que vale é o cálculo salvo na Estrutura de custos.
> - Lista em "Pendências" o que impede ativar ou custear, com o caminho para resolver.
> - Congela a versão dentro de cada Ordem de Produção: ativar outra versão depois não muda ordem já emitida.
>
> **Onde isto entra**
> Produto → **FORMULAÇÃO** → Estrutura de custos → Cálculo salvo → Precificação · e Formulação → Ordem de Produção
>
> ---
>
> **Termos desta tela**
> - *Quantidade informada*: o que você digitou, na unidade que escolheu.
> - *Equivalente estoque*: a mesma quantidade por unidade acabada, na unidade de estoque do item, **antes** dos ajustes.
> - *Físico por unidade*: depois dos ajustes que a linha autoriza. É o que a fábrica pesa.
> - *Pureza*: teor real do insumo. Com 80% de pureza, entregar 100 mg de ativo exige pesar 125 mg. Em branco significa desconhecida, nunca 100%.
> - *Overage (excesso planejado)*: quantidade a mais, de propósito, para compensar perda de processo ou de validade. Não entra no que é declarado ao cliente.
> - *Fornecimento*: Veridi compra e custeia; cliente envia o material, que entra na receita e na necessidade, mas nunca no custo da Veridi.
>
> **Situações**
> Rascunho (edita e salva) → Ativa (produz, custeia; não edita) → Inativa (substituída; continua legível porque ordens antigas apontam para ela). Uma ativa por produto.
>
> **Atenção**
> - **Não tem volta:** versão ativada não se edita. Mudar a receita é criar outra versão.
> - Informar pureza ou overage **não** corrige nada sozinho. A correção só acontece em "Calcular quantidade física" com o ajuste marcado.
> - Se a quantidade informada já veio corrigida de origem, não marque a correção: o sistema dividiria pela pureza duas vezes e a ordem reservaria material a mais. A linha avisa.
> - "Ativar versão" grava antes o que está na tela — o que você vê é o que vira ativa.
> - Observações e notas técnicas não entram em cálculo.
>
> **Exemplo**
> Receita por dose, 60 doses por embalagem, 250 mg de vitamina C por dose com pureza 97% e ajuste marcado: equivalente estoque = 60 × 250 mg = 15 g por embalagem; físico = 15 g ÷ 0,97 = 15,46 g. É 15,46 g que a ordem reserva.
>
> **Saiba mais**
> Conceito: Versões — rascunho × ativa · Conceito: Pureza e overage · Tela: Estrutura de custos · Tela: Templates de formulação

### 9.3 Pedido do Cliente — documento (`/comercial/pedidos/:id`) com Plano de Atendimento

**Texto atual** (`comercial.pedido`). Título: *"Este pedido: onde ele está e o que falta"*. Resumo: *"Esta tela é o pedido inteiro: o que o cliente pediu, como será atendido, o que já foi reservado, o que está sendo produzido e o que já saiu. O que aparece muda conforme o status — em Rascunho há edição, em Confirmado aparece o Plano de Atendimento, e em atendimento aparecem reserva, ordens e saldo a expedir."* Estrutura: 13 termos · 1 fluxo / 8 etapas · 6 ressalvas · 750 palavras. Nota 6,9. Mais `planoAtendimento.comoFunciona` (426 palavras, nota 7,3) no botão da seção do Plano.

**Problemas.**
- A tela é o cockpit do atendimento inteiro (12 seções) e a ajuda lista 13 termos sem dizer a **ordem** em que as seções são usadas nem que várias só aparecem em certa situação.
- A automação mais surpreendente do sistema — **produto produzido depois do plano não entra sozinho no pedido; precisa de "Reservar disponível"** — está no meio do glossário. É pré-requisito invisível para expedir.
- "Gerar OP para o saldo restante" aparece só quando uma OP concluída produziu menos; a ajuda explica, mas a tela não diz por que o botão às vezes não existe.
- Não cita "Salvar rascunho", "Confirmar pedido", "Aplicar Plano de Atendimento", "Gerar OCs em rascunho", "Reservar disponível", "Realocar", "Cancelar pedido" pelo nome.
- Desconto acordado (vindo do orçamento) aparece na Origem comercial e não é explicado; hoje não chega ao Faturamento (problema de produto BILL-DISCOUNT-01 — a ajuda não deve prometer o contrário).
- Vocabulário: "numa transação só", "retrato histórico", "fatos operacionais com vida própria".

**Proposta — `comercial.pedido`, classe L**, com o Plano como aba/seção dentro da mesma ajuda (o botão da seção do Plano abre a ajuda já nessa parte).

> **Em uma frase**
> O Pedido do Cliente é a venda registrada: quem pediu, o que, quanto e por qual preço. Ele não movimenta estoque; é o documento que autoriza reservar, produzir, comprar material em falta, expedir e faturar.
>
> **Quando usar**
> - Para registrar uma venda vinda de um orçamento aceito (o pedido já nasce preenchido) ou digitada à mão.
> - Para decidir como atender: quanto sai do estoque pronto e quanto será produzido.
> - Para acompanhar o pedido até o fim: ordens de produção, compras, reservas, expedições e faturamento ficam todos aqui.
>
> **Próximo passo**
> Pedido confirmado → aplicar o Plano de Atendimento. Em atendimento → liberar as OPs geradas (Produção) e, com produto reservado, preparar a expedição.
>
> ---
>
> **Antes de começar**
> - Cliente ativo e produtos **aprovados** (produto em desenvolvimento é recusado).
> - Para o Plano: o pedido precisa estar **confirmado**.
> - Para expedir: precisa haver produto acabado **reservado a este pedido** (veja o passo 6).
>
> **Passo a passo**
> 1. **Você** informa cliente, datas e produtos ("+ Adicionar produto") e clica em "Salvar rascunho" → **o sistema** guarda sem prometer nada. Em rascunho tudo se edita.
> 2. **Você** clica em "Confirmar pedido" → **o sistema** congela cliente, produtos, quantidades e o preço acordado de cada linha. Daqui em diante mudar cadastro ou tabela de preço não altera este pedido.
> 3. **Você** abre a seção "Plano de Atendimento" e lê a proposta: por produto, quanto reservar do disponível e quanto produzir → **o sistema** calcula com o saldo livre de agora, sem gravar nada. Você pode mover quantidade entre reservar e produzir; a soma tem de fechar o pedido.
> 4. **Você** clica em "Aplicar Plano de Atendimento" → **o sistema** confere a disponibilidade de novo naquele instante, cria a reserva de produto acabado e uma Ordem de Produção em rascunho por linha em falta, tudo de uma vez, e passa o pedido para "Em atendimento". Se algo falhar, nada é gravado.
> 5. **Você** confere a "Sugestão de Compra" (material que as OPs vão exigir e que falta) e digita "Comprar agora" → "Gerar OCs em rascunho" → **o sistema** cria ordens de compra em rascunho por fornecedor. Confirmar cada uma é trabalho de Compras. Material do cliente em falta aparece à parte e não vira compra.
> 6. **Você** volta quando a produção terminar e usa "Reservar disponível" no painel "Reservar Produto Acabado" → **o sistema** prende ao pedido o produto que ficou pronto. **Produzir não reserva.**
> 7. **Você** prepara a expedição (seção "Expedições") com o que está reservado → confirma na tela da Expedição → **o sistema** baixa o estoque e marca o pedido "Parcialmente expedido" ou "Expedido".
> 8. O faturamento é preparado a partir de cada expedição confirmada, com o preço acordado no passo 2.
>
> **O sistema faz sozinho**
> - Congela preço e quantidades na confirmação.
> - Recalcula e revalida a disponibilidade no momento de aplicar o plano; cria reserva e OPs juntas.
> - Muda a situação do pedido por consequência: aplicar o plano, confirmar expedições. Não existe "marcar como expedido".
> - Oferece "Gerar OP para saldo restante" quando uma OP concluída produziu menos que o planejado e a linha continua descoberta.
> - Mostra, por lote reservado, o que já saiu e o que resta; permite "Realocar" a reserva de um lote que ficou inelegível (vencido, bloqueado).
>
> **Onde isto entra**
> Orçamento aceito → **PEDIDO** → Plano → OP / OC → Reserva de produto acabado → Expedição → Faturamento
>
> ---
>
> **Termos desta tela**
> - *Disponível*: o que existe em estoque menos o que já está reservado para outros; lote bloqueado, aguardando Qualidade ou vencido não conta.
> - *Reservar × Produzir*: as duas colunas do Plano. A soma deve ser exatamente a quantidade pedida.
> - *Falta expedir*: pedido menos expedido, por linha. Diz se o pedido acabou.
> - *Falta física × compra sugerida*: falta é o que não existe; a compra sugerida considera o pedido mínimo do fornecedor e o que já está em rascunho.
> - *Preço acordado*: o valor congelado na confirmação; o faturamento herda daqui.
> - *Origem comercial*: o projeto e a versão de orçamento de onde vieram os preços. Pedido digitado à mão não tem.
>
> **Situações**
> Rascunho → Confirmado → Em atendimento → Parcialmente expedido → Expedido. Cancelado exige motivo e não desfaz reserva nem OP já criadas.
>
> **Atenção**
> - **Não tem volta:** confirmar congela; aplicar o plano cria reserva e ordens.
> - O Plano é leitura até você aplicar. Abrir e ajustar não grava nada.
> - Material em compra não conta como disponível — só vira estoque no recebimento.
> - Produto produzido depois do plano **precisa ser reservado aqui** antes de aparecer na expedição.
> - O desconto acordado no orçamento aparece na Origem comercial. Confira o valor no faturamento.
>
> **Exemplo**
> Pedido de 3.000 unidades, 1.200 disponíveis: o plano propõe reservar 1.200 e produzir 1.800. Aplicado, nasce uma OP de 1.800 em rascunho. Quando ela produzir, use "Reservar disponível" e depois prepare as expedições — pode ser em várias entregas.
>
> **Saiba mais**
> Conceito: Físico, Reservado, Disponível e Em compra · Conceito: Reserva × consumo · Tela: Ordem de Produção · Tela: Expedição

### 9.4 Ordem de Produção — documento (`/producao/ordens/:id`)

**Texto atual** (`ordemProducao.comoFunciona`). Título: *"Como a ordem de produção movimenta o estoque"*. Resumo: *"A ordem de produção é o documento de uma produção: um produto, uma quantidade planejada, uma versão da formulação — e o registro do que foi separado, consumido e produzido de verdade. Dentro dela convivem dois momentos que costumam ser confundidos: reservar material é compromisso, consumir material é baixa física. Só o consumo tira quantidade do estoque."* Estrutura: 11 termos · 1 fluxo / 7 etapas + 7 passos · 10 ressalvas · 963 palavras. Nota 6,4.

**Problemas.**
- O fluxo desenhado começa em "OP → Reserva" e pula as duas ações que o iniciante precisa achar primeiro: "Planejar OP" (congela a versão) e "Liberar OP" (reserva). Os botões reais não são citados.
- A ordem tem seis situações e treze seções; a ajuda não diz **qual seção usar em qual situação**.
- Dois caminhos para a mesma baixa (Consumo Real na OP e Folha de Receita) são explicados em termos separados; o iniciante não sabe qual escolher.
- Não diz quem escolhe os lotes na liberação (o sistema, por FEFO) nem que a troca é manual e explícita.
- "Justificar diferença" é pré-requisito para "Concluir OP" e aparece como termo, não como passo.
- Vocabulário: "reconciliação", "híbrido", "apontamento" (a tela diz "Registrar produção").

**Proposta — `producao.ordem`, classe L**, com o painel abrindo no passo da situação atual (opção B).

> **Em uma frase**
> A Ordem de Produção é o documento de uma produção: o produto, a quantidade, a receita que será seguida e o registro do que foi reservado, separado, consumido e produzido de fato.
>
> **Quando usar**
> - Para produzir o que um Pedido exige (a OP já nasce ligada ao pedido pelo Plano de Atendimento).
> - Para produzir para estoque, com "Nova OP".
> - Para executar a produção: liberar material, conferir lotes, registrar consumo, registrar o que saiu e concluir.
>
> **Próximo passo**
> Depende da situação: Rascunho → "Planejar OP"; Planejada → "Liberar OP"; Liberada → conferir separação e registrar consumo (ou pesar na Folha de Receita); Em produção → "Registrar produção" e "Concluir OP"; Concluída → reservar o produto acabado ao pedido.
>
> ---
>
> **Antes de começar**
> - Produto aprovado e ativo, com item de produto acabado.
> - Formulação **ativa** (a OP pode nascer sem, mas sem versão não há necessidade de material nem liberação).
> - Para liberar: estoque **disponível** cobrindo todo material — material em compra não cobre; lote aguardando Qualidade não cobre.
> - Componente fornecido pelo cliente exige que a OP tenha cliente e que exista lote **daquele** cliente.
>
> **Passo a passo**
> 1. **Rascunho.** Você define produto, quantidade e, se for pesar por batelada, o número de partes → o sistema mostra a formulação ativa de hoje. Só aqui produto, versão e quantidade mudam.
> 2. **"Planejar OP".** → O sistema congela produto, item de saída e a versão da formulação dentro da ordem e calcula a "Necessidade de Materiais" (com físico, reservado, disponível para esta OP, em compra e falta).
> 3. **"Liberar OP".** → O sistema confere cobertura total, escolhe os lotes por validade (vence antes, sai antes) e os **reserva** para esta ordem. Nada sai do estoque ainda. Se uma linha não fecha, nenhuma reserva é feita e a tela diz por quê.
> 4. **Separação ("Picking").** Você lê o QR ou digita o lote na mão e clica "Confirmar separação" → o sistema registra quem conferiu e quando. Lote diferente do reservado não é aceito em silêncio: a troca é uma ação explícita, antes de qualquer consumo.
> 5. **Consumo.** Você informa "Consumir agora" por linha na seção "Consumo Real" — ou registra a pesagem na "Folha de Receita", que é o mesmo consumo pelo outro caminho → **aqui o estoque cai.** O primeiro consumo coloca a ordem "Em produção". Pesou mais que o reservado? "Adicionar consumo extra", com motivo.
> 6. **"Registrar produção".** Você informa a quantidade produzida, o lote comercial (Lote Veridi) e a validade → o sistema cria o lote interno de produto acabado e a entrada no estoque. Produção parcial é normal: registre quantas vezes precisar, sem passar do planejado.
> 7. **"Justificar diferença"** para cada material cujo consumido ficou diferente do reservado → o sistema grava motivo, autor e data na linha.
> 8. **"Concluir OP".** → O sistema exige as justificativas e, se produziu menos que o planejado, o motivo da variação; libera a sobra reservada (sem movimento) e fecha a ordem.
>
> **O sistema faz sozinho**
> - Congela a versão da formulação no planejamento; ativar outra versão depois não muda esta ordem.
> - Escolhe e reserva lotes na liberação; recalcula disponibilidade a cada abertura da tela (a coluna é "Disponível para esta OP": inclui a própria reserva).
> - Congela na liberação as revisões vigentes dos documentos controlados (R.PRO.002 e R.COQ.003).
> - Cria o lote de produto acabado no registro de produção, **aguardando liberação da Qualidade** quando o item exige; sugere validade pela vida útil do produto.
> - Calcula o custo industrial da ordem (material consumido lote a lote + custos padrão da estrutura na proporção do produzido). Material sem preço fica em aberto, nunca zero.
>
> **Onde isto entra**
> Pedido (Plano) ou Nova OP → **ORDEM DE PRODUÇÃO** → Lote de produto acabado → Qualidade → Reserva ao pedido → Expedição
>
> ---
>
> **Termos desta tela**
> - *Reserva*: compromisso do material com esta ordem. Reduz o disponível dos outros; não tira nada da prateleira.
> - *Consumo*: baixa física. Cada consumo gera um movimento de saída.
> - *Disponível para esta OP*: o disponível do estoque mais o que esta ordem já reservou. Na Posição de Estoque o mesmo item aparece menor.
> - *Planejado × produzido × restante*: planejado é o congelado; produzido é a soma dos registros; restante é a diferença antes de concluir. Depois de concluída, a diferença é "variação", não promessa.
> - *Lote interno × Lote Veridi*: o interno é o código que o sistema cria e vai no QR; o Lote Veridi é o número comercial do rótulo.
> - *Folha de Receita (R.COQ.003)*: documento de execução; a pesagem confirmada nela é o consumo. *Folha de separação (FO-04)*: papel de quem busca o material.
>
> **Situações**
> Rascunho → Planejada → Liberada → Em produção → Concluída. Cancelada só até o primeiro consumo.
>
> **Atenção**
> - **Não tem volta:** consumo registrado; produção registrada; ordem concluída. Depois do primeiro consumo a ordem não cancela.
> - Consumir é limitado ao reservado da linha. Além disso só com "Adicionar consumo extra" e motivo.
> - Concluir exige justificar toda diferença entre reservado e consumido.
> - O produto acabado produzido **não entra sozinho no pedido**: reserve-o no Pedido ("Reservar disponível").
> - Imprimir a OP, a folha de separação e o custo não altera nada.
>
> **Saiba mais**
> Conceito: Reserva × consumo · Conceito: Lote interno × lote comercial · Tela: Folha de Receita · Tela: Lote (Qualidade)

### 9.5 Precificação — documento (`/gestao/precificacao/:pricingId`)

**Texto atual** (`precificacao.comoFunciona`, compartilhado com a lista). Título: *"O que é uma Precificação e o que a ativação congela"*. Resumo: *"Precificação é o documento interno que transforma um custo já calculado em preço: faixas de quantidade, margem de contribuição desejada e comissão, tudo sobre a MESMA base de custo. Ela não é o cálculo de custo, não é orçamento ao cliente e não é documento fiscal — e não nasce do nada: parte sempre de um cálculo de custo salvo."* Estrutura: 9 termos · 1 fluxo / 5 etapas · 9 ressalvas · 887 palavras. Nota 6,4.

**Problemas.**
- Não diz **de onde se cria** uma precificação: da Estrutura de custos, lista "Cálculos salvos", botões "Criar precificação" ou "Usar política". A lista de precificações não cria nada, e a ajuda não avisa.
- Os dois modos de faixa ("calcular pela margem" e "preço informado") são um termo de 30 palavras; são a decisão central da tela.
- Nove ressalvas de 40 a 70 palavras cada; a mais importante ("Precificação ativa não muda mais") está diluída.
- Sem exemplo de faixa, margem e comissão.
- "Trocar a base" aparece nas ressalvas, mas o botão real diz "Trocar a base pelo custo atual (CALC-…)" com dois desfechos ("Trocar a base" no rascunho / "Criar nova versão" na ativa) — não explicado como decisão.
- Vocabulário: "cenário econômico fechado", "markup infinito não existe", "margem calculada sobre subtotal conhecido pareceria segura e não seria".

**Proposta — `precificacao.documento`, classe L.** A lista (`/gestao/precificacao`) recebe um tópico S (seção 11.26).

> **Em uma frase**
> A precificação transforma um custo já calculado em preço de venda por faixa de quantidade, com a margem de contribuição desejada e a comissão. Ativada, ela é o preço vigente do produto e é dela que o orçamento parte.
>
> **Quando usar**
> - Depois de salvar um cálculo de custo na Estrutura de custos do produto.
> - Quando o custo mudou de verdade (compra nova, tarifa nova, estrutura nova) e o preço precisa ser revisto: crie uma versão nova, não edite a ativa.
> - Quando a mesma regra comercial serve a vários produtos: aplique uma Política de precificação em vez de digitar faixa por faixa.
>
> **Próximo passo**
> Precificação ativada → o orçamento do projeto passa a oferecer "Usar precificação" para as quantidades das faixas.
>
> ---
>
> **Antes de começar**
> - Um **cálculo de custo salvo** do produto (Estrutura de custos → "Calcular custo" → "Salvar cálculo"). Sem ele não existe precificação.
> - O cálculo idealmente **completo**: com custo incompleto o preço por margem fica em branco.
> - Perfil Comercial ou Administrador.
>
> **Passo a passo**
> 1. **Você** cria a precificação na Estrutura de custos, lista "Cálculos salvos" → "Criar precificação" (ou "Usar política") → **o sistema** abre um rascunho com a "Base de custo" fixada naquele cálculo. Um rascunho por produto.
> 2. **Você** adiciona faixas em "Faixas de quantidade": quantidade, modo, margem e comissão → **o sistema** mostra a prévia da faixa (custo da quantidade, preço sugerido, comissão, contribuição e markup) antes de "Adicionar faixa".
>    - Modo **calcular pela margem**: você informa a margem desejada; o sistema devolve o preço.
>    - Modo **preço informado**: você digita o preço; o sistema devolve a margem que ele dá.
> 3. **Você** lê a "qualidade do custo" ao lado de cada faixa (completo com compra real, com estimativas, parcial, sem custo) — é ela que diz o quanto o número sustenta a decisão.
> 4. **Você** clica em "Ativar precificação" → **o sistema** refaz a conta inteira, congela custo, preço, comissão, contribuição e markup de cada faixa e coloca a versão ativa anterior como inativa. Com custo incompleto, pede confirmação.
>
> **O sistema faz sozinho**
> - Recalcula cada faixa para a própria quantidade: custo fixo por lote não dilui abaixo de um lote e caixa de embalagem é inteira, por isso o custo unitário de 300 não é o de 3.000.
> - Recusa margem + comissão em 100% ou mais.
> - Avisa quando a quantidade da faixa fica abaixo do lote mínimo do produto, sem corrigir.
> - Ao "Trocar a base pelo custo atual": no rascunho, troca nele mesmo; na versão ativa, cria uma versão nova com as faixas copiadas e mantém a ativa intacta.
> - Não arredonda preço: 15,3846 fica 15,3846 até alguém decidir.
>
> **Onde isto entra**
> Estrutura de custos → Cálculo salvo → **PRECIFICAÇÃO** → Orçamento (faixa da quantidade exata) → Pedido
>
> ---
>
> **Termos desta tela**
> - *Base de custo*: o cálculo salvo sobre o qual todas as faixas foram construídas. Uma base para a versão inteira.
> - *Faixa de quantidade*: um cenário de venda fechado. O orçamento só usa a faixa cuja quantidade é exatamente a cotada; 750 não usa a de 500 nem a de 1.000.
> - *Margem de contribuição*: (preço − comissão − custo industrial) ÷ preço. Não é lucro: imposto, frete e inadimplência não entram.
> - *Comissão*: percentual sobre o preço bruto de venda.
> - *Markup (quanto o preço está acima do custo)*: diferente de margem; fica em branco quando o custo é zero.
> - *Qualidade do custo*: de onde vieram os preços dos materiais.
>
> **Situações**
> Rascunho (edita) → Ativa (vigente; não edita) → Inativa (substituída). Uma ativa e um rascunho por produto.
>
> **Atenção**
> - **Não tem volta:** ativar congela. Para outra base, nasce outra versão.
> - Custo incompleto: preço pela margem fica em branco; preço informado é aceito, mas margem, markup e contribuição ficam em branco.
> - Contribuição negativa aparece como está: preço abaixo do custo é informação, não erro escondido.
> - Material do cliente fica fora do custo e não piora a qualidade do custo.
>
> **Exemplo**
> Custo por unidade R$ 10,00 na faixa de 1.000; margem desejada 30% e comissão 5%: preço = 10 ÷ (1 − 0,30 − 0,05) = R$ 15,38. Na faixa de 300 o custo unitário sobe (custo fixo do lote dividido por menos unidades) e o preço também.
>
> **Saiba mais**
> Conceito: Custo desconhecido não é zero · Conceito: Prévia × valor gravado · Tela: Estrutura de custos · Tela: Políticas de precificação

---

## 10. Reescritas — Comercial e Gestão

Formato de cada item: **Texto atual** (título, resumo verbatim e estrutura) · **Problemas** · **Proposta** no esqueleto da seção 7 (nível 1 completo; níveis 2 e 3 resumidos ao que muda; termos e ressalvas que continuam válidos são referidos, não repetidos). Nota da rubrica na seção 6.

### 10.1 `comercial.projetos` — Projetos (`/comercial/projetos`) · M · P1

**Texto atual.** Título: *"O que é um Projeto e como ele anda no funil"*. Resumo: *"Projeto é a negociação private label registrada antes de o produto existir: um cliente, um conceito, um canal, um responsável e o brief técnico do que se pretende fazer. Esta lista é o funil inteiro — cada linha diz em que estágio a conversa está e qual foi a última versão de orçamento. Projeto não é produto nem pedido: o produto operacional só nasce quando o projeto é aprovado."* 9 termos · 2 fluxos / 8 etapas · 5 ressalvas · 630 palavras.

**Problemas.** Desatualizado: "Aprovado e cancelado são terminais… não aceita… orçamento novo" contradiz §69 (projeto aprovado continua vendendo) — o próprio subtítulo da página já diz "orçamentos versionados". "Brief", "private label", "Stand-by" sem glosa. Não diz que a lista é o lugar de criar ("Novo projeto") nem que amostra e orçamento se criam **dentro** do projeto.

**Proposta (M).**
> **Em uma frase.** O Projeto é a conta de desenvolvimento e venda de um produto para um cliente: nele ficam o briefing, as amostras, o produto técnico, os orçamentos e o histórico da negociação. Esta lista é o funil: cada linha diz em que estágio o projeto está.
> **Quando usar.** Registrar uma oportunidade nova ("Novo projeto"); achar um projeto pelo código, código legado, nome ou cliente; ver quem está em Aguardando, Amostra, Em espera (Stand-by), Aprovado ou Cancelado.
> **Próximo passo.** Abrir o projeto: amostras, produto técnico e orçamentos se criam lá dentro.
> **Antes de começar.** Cliente ativo cadastrado (projeto sempre tem dono).
> **Passo a passo.** 1 "Novo projeto": cliente, conceito, canal, responsável, perfil técnico → nasce em Aguardando. 2 Abrir a linha para trabalhar. 3 Ler o estágio: a primeira amostra move para Amostra sozinha; Stand-by é pausa reversível; Aprovado exige orçamento aceito e promove o produto; Cancelado exige motivo e fecha.
> **O sistema faz sozinho.** Muda para Amostra na primeira amostra; registra toda mudança de estágio com autor, data e motivo; promove o produto na aprovação.
> **Onde entra.** Cliente → **PROJETO** → Amostras / Produto técnico / Orçamento → Aprovação → Pedido.
> **Situações.** Aguardando → Amostra → (Em espera) → Aprovado (continua recebendo orçamentos) · Cancelado (fecha).
> **Atenção.** Aprovado não é fim: o mesmo projeto recebe as próximas compras. Cancelado não reabre. Trocar o cliente só antes do primeiro orçamento. Projeto importado pode ter estágio incompleto e não é completado por dedução.

### 10.2 `comercial.projeto` — Ficha do Projeto (`/comercial/projetos/:id`) · L → M após separar o Orçamento · P0

**Texto atual e problemas:** ver 9.1. Além do Orçamento, a ficha tem "Resumo", "Produtos do projeto" ("+ Adicionar produto" → "Criar novo produto" / "Vincular produto existente"), "Amostras / testes", "Documentos do projeto", "Histórico do pipeline" e as ações "Mudar para Amostra", "Stand-by", "Aprovar projeto", "Cancelar projeto", "Editar".

**Proposta (M, sem o Orçamento).**
> **Em uma frase.** A ficha do projeto reúne tudo o que a Veridi está desenvolvendo e vendendo para este cliente: os produtos do projeto, com a cadeia técnica de cada um (formulação, custos, CMV, precificação), as amostras, os orçamentos e o histórico.
> **Quando usar.** Preparar o produto técnico e acompanhar sua cadeia de custo e preço; criar amostras; abrir a seção Orçamentos; aprovar ou cancelar o projeto.
> **Próximo passo.** Sem produto → "Criar novo produto" (nasce em desenvolvimento). Com precificação ativa → novo orçamento. Com orçamento aceito → "Aprovar projeto".
> **Antes de começar.** Para aprovar: um orçamento aceito. Para criar produto técnico: cliente definido (já vem do projeto).
> **Passo a passo.** 1 "Produtos do projeto": "Criar novo produto" cria um produto em desenvolvimento (aceita fórmula, custo e preço; recusado em pedido e OP) ou "Vincular produto existente". 2 Cadeia técnica pelos atalhos da tabela: Formulação → Custos → CMV → Precificação. 3 "Amostras / testes": cada amostra T1, T2… consome estoque real. 4 Seção "Orçamentos" (ajuda própria). 5 "Aprovar projeto": a prévia mostra quais produtos serão promovidos; os que não estão na proposta aceita continuam em desenvolvimento.
> **O sistema faz sozinho.** Promove **o mesmo** produto (mesmo código e história) na aprovação; nunca cria outro. Aprovar duas vezes não cria nada. Cancelar desativa apenas o produto em desenvolvimento criado por este projeto; nada é apagado.
> **Onde entra.** Cliente → **PROJETO** → Produto técnico → Formulação → Custo → Precificação → Orçamento → Pedido.
> **Atenção.** **Não tem volta:** aprovar e cancelar. Perfil Comercial/Administrador vê custo e margem; o impresso do orçamento não os mostra. Documentos anexados são referência, não travam nada.

### 10.3 `comercial.amostras` — Amostras (`/comercial/amostras`) · S · P2

**Texto atual.** Título: *"O que é uma amostra Tn — e o que ela nunca vira"*. Resumo: *"Amostra é o teste de desenvolvimento de um projeto, numerado Tn dentro daquele projeto: existe antes de haver produto, item de produto acabado ou fórmula operacional. Cada uma guarda o material realmente consumido, o que foi produzido e o parecer sobre o resultado. Não é lote e não é ordem de produção — o que sai dela nunca entra no estoque de produto acabado e não é vendável."* 6 termos · 1 fluxo / 4 etapas · 7 ressalvas · 521 palavras.

**Problemas.** Bom conteúdo; longo para uma lista de consulta que não cria nada. O callout da própria tela ("Novas amostras são criadas dentro de um Projeto…") já responde a dúvida principal. "Tn" é notação, não palavra.

**Proposta (S).**
> **Em uma frase.** Lista de todos os testes de desenvolvimento (T1, T2, T3… de cada projeto). Aqui só se busca, filtra e exporta; a amostra é criada e executada dentro do projeto.
> **Quando usar.** Achar uma amostra por projeto, cliente ou situação; ver quantos consumos ela teve e o resultado.
> **Próximo passo.** Abrir a amostra; para criar uma nova, abrir o projeto (seção "Amostras / testes").
> **Passo a passo.** Buscar → ler a situação (Rascunho, Em preparação, Produzida, Aprovada, Reprovada, Cancelada) → abrir.
> **O sistema faz sozinho.** Numera T1, T2… por projeto; move o projeto para o estágio Amostra na primeira; conta na coluna "Consumos" cada baixa de estoque registrada.
> **Onde entra.** Projeto → **AMOSTRAS** → decisão técnica (não gera lote nem pedido).
> **Atenção.** O material consumido saiu do estoque de verdade; reprovar ou cancelar não devolve. O que a amostra produz não é vendável. Etiqueta de amostra tem QR próprio e nunca abre um lote.

### 10.4 `comercial.amostra` — Amostra (`/comercial/amostras/:id`) · M · P2

**Texto atual.** Título: *"Como uma amostra consome estoque e recebe parecer"*. Resumo: *"Esta tela é o registro de um teste: quais itens e lotes foram usados, quanto se produziu, quem fez cada parte e qual foi a decisão sobre o resultado. O consumo registrado aqui é saída física de estoque no mesmo instante, e não volta atrás. A decisão técnica é uma etapa separada — e não decide nada sobre o projeto."* 7 termos · 2 fluxos / 9 etapas · 7 ressalvas · 581 palavras.

**Problemas.** Estrutura boa (dois fluxos com "quando"). Papéis explicados em ressalva ("Ação que não aparece costuma ser papel") — a tela deveria mostrar a ação desabilitada com motivo (problema de produto, seção 16). Sem "antes de começar" (lote elegível do dono certo).

**Proposta (M).**
> **Em uma frase.** Registro de um teste de desenvolvimento: o material e os lotes usados, o que foi produzido e a decisão sobre o resultado. Cada consumo registrado sai do estoque na hora.
> **Quando usar.** Registrar o que foi pesado no teste (Produção); concluir informando a quantidade produzida; aprovar ou reprovar o resultado (Comercial); imprimir a etiqueta da amostra.
> **Próximo passo.** Amostra aprovada não aprova o projeto: o projeto avança pelo orçamento aceito.
> **Antes de começar.** Lote elegível: liberado pela Qualidade, dentro da validade, com laudo quando exigido, com saldo livre e do dono certo (material de cliente só em amostra daquele cliente).
> **Passo a passo.** 1 Descrição, produto testado, observações. 2 Registrar consumo: item, lote e quantidade → o sistema baixa o estoque no ato. 3 "Concluir": quantidade produzida e unidade → o sistema congela cliente e projeto na etiqueta. Sem consumo registrado, concluir pede confirmação. 4 "Aprovar" ou "Reprovar" (reprovar exige motivo).
> **O sistema faz sozinho.** Baixa o estoque a cada consumo com tipo de movimento próprio; nunca toma estoque reservado para OP ou pedido; passa a amostra para "Em preparação" no primeiro consumo.
> **Onde entra.** Projeto → **AMOSTRA** → parecer → (o projeto segue pelo orçamento).
> **Atenção.** **Não tem volta:** consumo registrado; conclusão. Cancelar só em rascunho ou em preparação. Papéis: criar (Comercial ou Produção), consumir e concluir (Produção), aprovar/reprovar (Comercial).

### 10.5 `comercial.pedidos` — Pedidos (`/comercial/pedidos`) · M · P1

**Texto atual.** Título: *"O que é um Pedido do Cliente e o que ele decide"*. Resumo: *"Pedido do Cliente é a demanda comercial: quem pediu, o que pediu e quanto. Ele não é estoque e não reserva nada sozinho — é o documento que autoriza o resto a acontecer: reserva, produção, compra de material em falta, expedição e faturamento. Esta lista mostra todos os pedidos e três leituras de situação lado a lado: o status do pedido, o atendimento e o faturamento."* 10 termos · 1 fluxo / 6 etapas · 5 ressalvas · 505 palavras.

**Problemas.** Um dos melhores textos; ainda assim explica na lista o fluxo inteiro do documento (duplicando `comercial.pedido`). As três colunas de situação (Status, Atendimento, Faturamento) são o que a lista tem de difícil e merecem o centro.

**Proposta (M).**
> **Em uma frase.** Lista de todas as vendas registradas, com três leituras lado a lado: a situação do pedido, quanto já está coberto por reserva e produção (Atendimento) e quanto do que saiu já foi faturado.
> **Quando usar.** Achar um pedido; ver o que está em atendimento, o que falta expedir e o que falta faturar; criar um pedido digitado ("+ Novo pedido").
> **Próximo passo.** Abrir o pedido: confirmar, aplicar o plano, reservar, expedir e faturar acontecem lá.
> **Passo a passo.** Filtrar por situação e cliente → ler as três colunas → abrir a linha.
> **O sistema faz sozinho.** Deriva a situação de cada ato (confirmar, aplicar plano, confirmar expedição). Atendimento pode estar completo antes de qualquer expedição; Faturamento só avança com expedição confirmada e documento emitido.
> **Onde entra.** Orçamento aceito → **PEDIDOS** → Plano → Produção / Compras → Expedição → Faturamento.
> **Situações.** Rascunho → Confirmado → Em atendimento → Parcialmente expedido → Expedido · Cancelado.
> **Atenção.** Pedido nunca movimenta estoque. Entrega combinada é informativa. Exportar leva o recorte filtrado.

### 10.6 `planoAtendimento.comoFunciona` — Plano de Atendimento (seção do Pedido) · M · P0

**Texto atual.** Título: *"Como o Plano de Atendimento decide o que fazer"*. Resumo: *"O Plano de Atendimento é onde um pedido confirmado vira decisão linha a linha: quanto sai do produto acabado que já existe e quanto precisa ser produzido. Até você aplicar, ele é leitura — compara o pedido com o saldo livre de agora e propõe a divisão, sem reservar nada e sem criar ordem nenhuma."* 6 termos · 1 fluxo / 5 etapas · 3 ressalvas · 426 palavras. Nota 7,3 — o melhor tópico de fluxo do sistema.

**Problemas.** "Entram na mesma transação" (termo técnico). Não diz o nome do botão ("Aplicar Plano de Atendimento") nem que o pedido passa a "Em atendimento". Fica isolado da ajuda do Pedido.

**Proposta (M, integrada à ajuda do Pedido como parte "Plano", aberta pelo botão da seção).** Conteúdo em 9.3, passos 3–4 e termos "Reservar × Produzir", "Disponível", "Falta física × compra sugerida". Acrescentar: "Sem formulação ativa": a OP nasce mesmo assim, sem receita; a necessidade de material dela só aparece depois de escolher a versão.

### 10.7 `comercial.expedicoes` — Expedições (`/comercial/expedicoes`) · S · P2

**Texto atual.** Título: *"O que é uma expedição e por que ela nasce do pedido"*. 6 termos · 1 fluxo / 6 etapas · 5 ressalvas · 459 palavras. Nota 7,8.

**Problemas.** Bom. Ainda repete o fluxo inteiro do documento na lista. O callout da tela já diz onde se cria.

**Proposta (S).**
> **Em uma frase.** Lista das saídas de produto acabado: as que estão em separação (rascunho) e as que já saíram (confirmadas), sempre ligadas ao pedido de origem.
> **Quando usar.** Achar uma expedição; ver o que está em separação; conferir quantidade enviada por pedido.
> **Próximo passo.** Para criar uma expedição, abra o Pedido (seção "Expedições") — só pedido em atendimento com produto reservado.
> **O sistema faz sozinho.** Só a expedição confirmada baixa o estoque; o rascunho não muda nada. O status do pedido muda por consequência.
> **Onde entra.** Pedido com reserva → **EXPEDIÇÕES** → Faturamento.
> **Atenção.** Expedição confirmada não se edita nem se cancela. Entrega parcial é normal.

### 10.8 `comercial.expedicao` — Expedição (`/comercial/expedicoes/:id`) · M · P0

**Texto atual.** Título: *"O que muda o estoque numa expedição — e o que não muda"*. Resumo: *"Esta tela conduz uma expedição do rascunho até a saída: os lotes reservados a este pedido, quanto enviar de cada um, a conferência física de cada lote e a confirmação. Separar, conferir e expedir são três atos diferentes, e só o último move estoque. Depois de confirmada, a expedição é histórico — não se edita, não se reconfirma e não se cancela."* 11 termos · 2 fluxos / 12 etapas · 6 ressalvas · 876 palavras.

**Problemas.** Ótimo resumo; depois disso 11 termos e dois fluxos quase idênticos (total × parcial diferem em uma etapa). "Já expedido, expedindo agora e restante" explicados em 70 palavras. Sem exemplo de entrega parcial (o próprio briefing sugere um).

**Proposta (M).**
> **Em uma frase.** Aqui a expedição sai: você ajusta o que vai de cada lote reservado, confere o lote físico e confirma. Só a confirmação baixa o estoque.
> **Quando usar.** Separar e enviar produto de um pedido em atendimento; enviar uma parte agora e o resto depois.
> **Próximo passo.** Confirmada → "Preparar faturamento".
> **Antes de começar.** Reserva de produto acabado feita no Pedido; lote dentro da validade e liberado.
> **Passo a passo.** 1 O rascunho nasce preenchido com o reservado disponível de cada lote, limitado ao que falta expedir. 2 Ajuste "Enviar agora" por lote e anote observações. 3 Confira cada lote (leitura do QR ou código) — responde "o lote certo está aqui?", não quanto. 4 "Confirmar expedição" → o sistema baixa físico e reserva de uma vez e atualiza o pedido.
> **O sistema faz sozinho.** Limita a linha ao menor entre o reservado do lote e o que falta no pedido; mostra "Já expedido / Expedindo agora / Restante após esta expedição" enquanto você digita; revalida a validade e a situação do lote na confirmação; libera a reserva remanescente quando o pedido fecha.
> **Onde entra.** Pedido (reserva) → **EXPEDIÇÃO** → Faturamento (um por expedição).
> **Situações.** Rascunho → Confirmada · Cancelada (só rascunho).
> **Atenção.** **Não tem volta:** confirmar. Lote divergente não é trocado aqui: realoque a reserva no Pedido. Conferir não movimenta nada. Folha de separação (FO-05) é leitura.
> **Exemplo.** Pedido de 3.000; 1.000 reservadas hoje: confirme 1.000 → pedido "Parcialmente expedido". Quando mais 2.000 forem produzidas e reservadas no Pedido, uma segunda expedição fecha o pedido; cada uma gera o próprio faturamento.

### 10.9 `faturamento.lista` — Faturamento (`/comercial/faturamento`) · S · P2

**Texto atual.** Título: *"Faturamento: a fila de expedições e os documentos"*. 5 termos · 1 fluxo / 4 etapas · 3 ressalvas · 285 palavras. Nota 7,3.

**Problemas.** Adequado. Pequenos ajustes: "Status" → "Situação"; dizer que "Preparar faturamento" também existe na tela da Expedição.

**Proposta (S).**
> **Em uma frase.** Duas tabelas: a fila de expedições confirmadas que ainda não têm faturamento, e os documentos de faturamento já preparados, emitidos ou cancelados.
> **Quando usar.** Ver o que falta faturar; preparar o rascunho de uma expedição ("Preparar faturamento"); achar um documento.
> **Próximo passo.** Preparado → abrir o documento para conferir preços e "Emitir faturamento".
> **O sistema faz sozinho.** Coloca a expedição na fila ao ser confirmada; tira quando existe rascunho; devolve se o rascunho for cancelado.
> **Atenção.** Não é Nota Fiscal nem Contas a Receber. Faturamento nasce de expedição, nunca de pedido ou produção.

### 10.10 `faturamento.comoFunciona` — Faturamento, documento (`/comercial/faturamento/:id`) · M · P0

**Texto atual.** Título: *"O que o Faturamento faz — e o que ele não faz"*. 8 termos · 1 fluxo / 4 etapas · 6 ressalvas · 580 palavras. Nota 7,6.

**Problemas.** Um dos melhores. Faltam: o nome dos botões ("Alterar preço de faturamento", "Emitir faturamento", "Cancelar faturamento"); a ressalva de que o **desconto global acordado no pedido não é aplicado** hoje (problema de produto BILL-DISCOUNT-01 — a ajuda deve dizer o que a tela faz, não o que deveria); "prévia × gravado" pode virar link de conceito.

**Proposta (M).**
> **Em uma frase.** O faturamento é o documento comercial do que saiu em uma expedição: as quantidades vêm da expedição e não se editam; o preço vem do acordo do pedido. Não é Nota Fiscal, não movimenta estoque, não gera título.
> **Quando usar.** Conferir preços e emitir; alterar um preço com motivo (perfil Comercial/Administrador); cancelar um rascunho ou registrar o cancelamento de um emitido.
> **Próximo passo.** Emitido → a emissão fiscal acontece fora do sistema nesta fase.
> **Antes de começar.** Expedição confirmada. Preço acordado no pedido — onde não houver, o preço é informado aqui.
> **Passo a passo.** 1 Conferir "Itens faturados": quantidade da expedição, preço acordado, preço faturado. 2 Se precisar, "Alterar preço de faturamento": novo preço e motivo → o sistema guarda os dois valores, autor e data; "voltar ao acordado" desfaz. 3 "Emitir faturamento" → o sistema congela; corrigir depois é cancelar e preparar outro.
> **O sistema faz sozinho.** Copia quantidades e preço acordado; calcula o total (prévia enquanto rascunho; só existe quando toda linha tem preço); recusa alteração sem motivo ou sem perfil.
> **Onde entra.** Expedição confirmada → **FATURAMENTO** → (NF fora do sistema).
> **Situações.** Rascunho → Emitido · Cancelado.
> **Atenção.** **Não tem volta:** emitir. Valor total só com todas as linhas com preço — faltando, mostra "valores incompletos", nunca soma parcial. O desconto global do pedido **não** é aplicado neste documento hoje; o total é quantidade × preço da linha — confira com o acordo comercial.

### 10.11 `cmv.comoFunciona` — CMV (`/produtos/:productId/cmv`) · M · P1

**Texto atual.** Título: *"Como o CMV de uma quantidade é montado"*. Resumo: *"O CMV responde 'quanto custa produzir esta quantidade'. Não é um cadastro à parte: soma a formulação, os recursos e as premissas da estrutura de custos usando o cálculo em vigor na data de referência."* 10 termos · 1 fluxo / 6 etapas · 8 ressalvas · 902 palavras. Nota 6,0.

**Problemas.** Sigla CMV nunca é expandida (Custo da Mercadoria Vendida — aqui, custo de produzir). A ordem de seleção da fonte de custo (30 dias → 90 dias → última compra → oferta → referência manual) é repetida em três lugares (termo, etapa e ressalva) e ainda em Item, Cálculo e Estrutura. Sem "próximo passo": o CMV é simulação — e daí? Sem exemplo.

**Proposta (M).**
> **Em uma frase.** O CMV (custo de produzir uma quantidade) simula quanto custa fabricar a quantidade que você informar, usando o cálculo de custo salvo em vigor na data escolhida. É leitura: nada é gravado.
> **Quando usar.** Responder "quanto custa produzir 1.000 potes?" antes de precificar ou orçar; comparar o custo congelado com "os dados de hoje"; a partir do orçamento, pelo "Simular CMV".
> **Próximo passo.** Custo confortável → Precificação. Custo com pendência → resolver a fonte de custo no item, no recebimento ou em Item × Fornecedor.
> **Antes de começar.** Um cálculo de custo salvo do produto; sem ele não há CMV e a tela diz isso.
> **Passo a passo.** 1 Informe a quantidade e a data de referência. 2 Leia o total, o unitário e a composição por material, recurso, energia e premissa. 3 Leia a qualidade do custo. 4 Compare com a precificação vigente, se houver faixa nessa quantidade exata.
> **O sistema faz sozinho.** Converte a quantidade em lotes de referência (custo fixo por lote não dilui abaixo de um lote; caixa é inteira); escolhe a fonte de custo de cada material na ordem oficial (compra real 30 dias → 90 dias → última compra → oferta válida → referência manual); marca "Referência manual forçada" quando alguém forçou no cálculo salvo; mostra subtotal quando falta custo, nunca R$ 0,00.
> **Onde entra.** Cálculo salvo → **CMV** (simulação) → Precificação / Orçamento.
> **Atenção.** Custo desconhecido não é zero. Material do cliente fica fora e não piora a qualidade. Várias ofertas sem preferencial não escolhem sozinhas: "Ofertas disponíveis · seleção necessária". A data de referência pode trocar a base inteira.
> **Exemplo.** Lote de referência 500 potes com custo fixo de R$ 400: para 300 potes o custo fixo por pote é R$ 400 ÷ 300 = R$ 1,33; para 1.000 potes (dois lotes) é R$ 0,80.
> **Saiba mais.** Conceito: Fonte de custo do material · Conceito: Custo desconhecido não é zero.

### 10.12 `calculo.comoFunciona` — Cálculo de custo salvo (`/calculos-custo/:id`) · M · P1

**Texto atual.** Título: *"O cálculo de custo salvo: um retrato congelado"*. 9 termos · 1 fluxo / 4 etapas · 8 ressalvas · 719 palavras. Nota 6,4.

**Problemas.** Tela somente leitura com 719 palavras; ressalva sobre descartar ("Cálculo que nenhuma precificação cita pode ser descartado inteiro…", 70 palavras) explica ação que **não está nesta tela**. Sem "próximo passo".

**Proposta (M).**
> **Em uma frase.** Este documento é o retrato do custo do produto numa data: quantidades da receita, fonte e preço de cada material, tarifas e premissas. Nada aqui é recalculado; é a base que a precificação cita.
> **Quando usar.** Entender de onde veio o custo de uma precificação; conferir a fonte de cada material; imprimir.
> **Próximo passo.** Criar precificação a partir dele (na Estrutura de custos, lista "Cálculos salvos").
> **Passo a passo.** Ler cabeçalho (código, data de referência, estrutura, formulação, base) → materiais com fonte → recursos, energia, premissas → qualidade do custo.
> **O sistema faz sozinho.** Congelou tudo no salvamento; marca "estrutura em rascunho" quando o cálculo foi salvo antes de ativar a estrutura; registra referência manual forçada com motivo, autor e impacto.
> **Onde entra.** Estrutura de custos → **CÁLCULO SALVO** → CMV / Precificação.
> **Atenção.** Não se edita. Não é o custo de nenhuma produção real (esse está na OP). Descartar só na lista de cálculos salvos e só se nenhuma precificação o cita.

### 10.13 `estruturaCusto.comoFunciona` — Estrutura de custos (`/produtos/:productId/custos`) · L · P0

**Texto atual.** Título: *"Estrutura de custos: o que entra no custo de produzir este produto"*. Resumo (77 palavras) termina em *"A estrutura é versionada — o rascunho se edita, a versão ativa é história."* 12 termos · 2 fluxos / 9 etapas · 7 ressalvas · 1.050 palavras. Nota 5,8.

**Problemas.** É a tela mais longa de configuração e a ajuda a acompanha: 12 termos de 40–80 palavras. Três documentos convivem na mesma tela (estrutura, cálculo padrão, cálculos salvos) e a ajuda não separa "o que é configuração" de "o que é resultado" logo no início. "Ofertas disponíveis · seleção necessária" explicado em 80 palavras. Botões reais: "Criar estrutura de custos" / "Nova versão", "Salvar base", "Usar template", "Adicionar recurso", "Adicionar premissa", "Ativar estrutura", "Calcular custo", "Salvar cálculo", "Criar precificação", "Usar política", "Imprimir / Salvar PDF".

**Proposta (L, três níveis).**
> **Em uma frase.** A estrutura de custos declara o que entra no custo de produzir este produto além do material: base de produção, recursos (mão de obra, equipamento, energia) e premissas adicionais. O cálculo, no fim da tela, transforma a declaração em número; salvar um cálculo congela esse número como base da precificação.
> **Quando usar.** Depois de ativar a formulação; quando tarifa, premissa ou receita mudarem (nova versão); para gerar o cálculo que a precificação vai citar.
> **Próximo passo.** Cálculo salvo → "Criar precificação" ou "Usar política".
> **Antes de começar.** Formulação ativa do produto; recursos industriais cadastrados com tarifa vigente; "Unidades por caixa" no produto (entra no custo).
> **Passo a passo.** 1 "Criar estrutura de custos" (vazia ou "Usar template") ou "Nova versão" (copia a ativa); informe a base de referência ("Salvar base"; o lote mínimo é a sugestão). 2 "Adicionar recurso": quanto a base consome de cada recurso e em que base de uso. 3 Energia: não estruturada, informada direto ou derivada dos equipamentos — nunca as duas. 4 "Adicionar premissa": embalagem secundária, serviços, overhead; valor em branco é "não informado", nunca zero. 5 "Ativar estrutura" → o sistema congela tarifas, potências e unidades por caixa; com pendência, pede confirmação. 6 "Calcular custo" com a data de referência → o sistema resolve a fonte de cada material e mostra a composição. 7 Se algum material tem referência manual, escolha automático ou forçar (com motivo). 8 "Salvar cálculo" → documento imutável com código.
> **O sistema faz sozinho.** Lê a receita da formulação (não se redigita); escolhe a fonte de custo de cada material; avisa recurso inativo, potência faltando, oferta sem preferencial; mostra subtotal conhecido quando falta custo.
> **Onde entra.** Formulação ativa → **ESTRUTURA DE CUSTOS** → Cálculo salvo → CMV / Precificação.
> **Termos.** Rascunho × Ativa; Base de referência; Base de uso (por lote, por unidade, por mil); Completude; Qualidade do custo; Referência manual forçada.
> **Atenção.** **Não tem volta:** ativar a estrutura; salvar o cálculo. Formulação nova não reescreve a estrutura ativa: crie outra versão. Material do cliente fica fora do custo. Forçar referência manual vale só para aquele cálculo.
> **Exemplo.** Encapsuladora 4 h por lote a R$ 90/h = R$ 360 por lote de 500 potes = R$ 0,72 por pote na base; para 300 potes o lote inteiro ainda é pago: R$ 1,20 por pote.

### 10.14 `templateCusto.comoFunciona` — Templates de Estrutura (`/gestao/templates-estrutura`, `/:id`) · M · P2

**Texto atual.** Título: *"Templates de Estrutura de Custos: configuração reutilizável, sem tarifa"*. 6 termos · 1 fluxo / 5 etapas · 7 ressalvas · 517 palavras.

**Problemas.** "Template" e "matriz" para a mesma coisa (e "modelo" em lugar nenhum). A ressalva sobre a ausência de tarifa (80 palavras) é argumento de design, não instrução. Sem "próximo passo".

**Proposta (M).**
> **Em uma frase.** Um modelo de estrutura guarda a configuração industrial que se repete entre produtos parecidos (base, recursos e tempos, modo de energia, premissas) — sem tarifa nem valor. Aplicar cria uma cópia no produto.
> **Quando usar.** Vários produtos com o mesmo processo; salvar uma estrutura que deu certo como modelo ("Salvar como template", na estrutura do produto).
> **Próximo passo.** Modelo ativado → na Estrutura de custos do produto, "Usar template".
> **Passo a passo.** Criar → montar o rascunho → "Ativar" (exige ao menos um recurso ou premissa) → aplicar no produto → o custo entra pelo cálculo, com a tarifa da data.
> **O sistema faz sozinho.** Copia, nunca vincula: mudar o modelo depois não altera nenhuma estrutura; avisa quando há versão nova; recusa aplicar se o produto já tem rascunho com configuração própria.
> **Atenção.** Versão ativa não se edita: crie outra. Arquivar tira da escolha sem apagar nada. A comparação entre versões mostra configuração, não dinheiro.

### 10.15 `politicaPreco.comoFunciona` — Políticas de Precificação (`/gestao/politicas-precificacao`, `/:id`) · M · P2

**Texto atual.** Título: *"Políticas de Precificação: regra comercial reutilizável, nunca preço"*. 6 termos · 1 fluxo / 5 etapas · 8 ressalvas · 542 palavras.

**Problemas.** Mesmo padrão do template: bom conceito, ressalvas argumentativas ("copiar 'R$ 44,90' de um produto para outro levaria o custo alheio disfarçado…"). Botões: "Usar política" (na Estrutura), "Salvar como política" (na Precificação).

**Proposta (M).**
> **Em uma frase.** Uma política guarda a regra comercial que se repete — faixas de quantidade, margem desejada e comissão — sem nenhum preço. Aplicada a um produto, gera uma precificação em rascunho com os preços daquele produto.
> **Quando usar.** Mesma regra de margem para vários produtos; padronizar faixas (500 / 1.000 / 3.000).
> **Próximo passo.** Aplicar: na Estrutura de custos do produto, "Cálculos salvos" → "Usar política" → revisar e "Ativar precificação".
> **Antes de começar.** Cálculo de custo salvo do produto.
> **O sistema faz sozinho.** Calcula a prévia dos preços com a mesma conta da precificação; gera exatamente as quantidades da política; deixa fora faixas com preço manual ao "Salvar como política".
> **Atenção.** Versão ativa não se edita. Custo incompleto continua sem preço sugerido. Havendo rascunho de precificação aberto, é nele que a política entra.

### 10.16 `relatorios.comoFunciona` — Relatórios, catálogo (`/relatorios`) · S · P3

**Texto atual.** Título: *"Relatórios: consulta, nunca fonte de verdade"*. 5 termos · 1 fluxo / 4 etapas · 6 ressalvas · 412 palavras.

**Problemas.** Adequado. Pode encolher: a busca por apelido (Kardex, falta de material) já está no campo de busca.

**Proposta (S).**
> **Em uma frase.** Catálogo dos 20 relatórios (R-01 a R-20), por área. Todo relatório é uma consulta montada na hora sobre os documentos; nada é guardado nem alterado.
> **Quando usar.** Achar o relatório pelo código, nome ou apelido da fábrica ("Kardex", "falta de material", "carteira").
> **Próximo passo.** Abrir, filtrar, exportar CSV ou imprimir com os filtros no cabeçalho.
> **Atenção.** Relatório e documento divergindo: vale o documento. Custo desconhecido aparece como falta, não como zero. R-20 exige perfil Comercial/Administrador.

### 10.17 `relatorio.comoFunciona` — os 20 relatórios (`/relatorios/**`) · S · P2

**Texto atual.** Título: *"Como ler um relatório: filtro, recorte e o que vai para o papel"*. 6 termos · 1 fluxo / 4 etapas · 6 ressalvas · 427 palavras. Um texto para 20 relatórios.

**Problemas.** Genérico por desenho. O que falta é **uma frase por relatório**: qual pergunta ele responde, qual data usa e que filtro já vem ligado. `ReportPage` já recebe `subtitle`; o catálogo já tem `hint` e `aliases`.

**Proposta (S genérico + 1 frase específica por relatório).** Manter o tópico genérico reduzido a: filtro define o resultado inteiro; página é só o pedaço visível; exportar e imprimir levam o recorte completo; data de cada relatório; valor desconhecido fica vazio. E acrescentar ao tópico um bloco "Este relatório" preenchido pelo catálogo, por exemplo: *R-04 Necessidades de produção — "O que falta de material para as OPs abertas, por item. Usa a necessidade das ordens planejadas e liberadas contra o disponível de agora; material em compra aparece à parte."* (20 frases a escrever na rodada de conteúdo.)

### 10.18 `consultaCliente.comoFunciona` — Consulta de Cliente (`/consultas/clientes/**`) · M · P2

Ver seção 12 (análise dedicada).

### 10.19 `painel.comoFunciona` — Painel (`/`) · S · P3

**Texto atual.** Título: *"Painel: o que exige decisão hoje"*. 7 termos · 1 fluxo / 4 etapas · 6 ressalvas · 528 palavras.

**Problemas.** Adequado, longo para a primeira tela que a pessoa vê. "Mesa de comando" é metáfora. Falta dizer que é aqui que o trabalho pendente aparece por perfil e que cada item leva ao documento.

**Proposta (S).**
> **Em uma frase.** O painel mostra o que precisa de decisão agora (lotes aguardando Qualidade, ordens com falta, compras atrasadas, expedições a faturar), o que está aberto em cada área e a contagem do período. Tudo vem dos documentos; nada é guardado aqui.
> **Quando usar.** Ao começar o dia: partir de "Precisa de atenção"; usar as "Ações rápidas" do seu perfil.
> **Próximo passo.** Clicar no item: a decisão é tomada no documento, com as validações dele.
> **O sistema faz sozinho.** Deriva tudo a cada abertura; o filtro de período vale só para "No período" e "Movimentações"; conta documentos e eventos, não quantidades.
> **Atenção.** Alerta de lote só com saldo. Valor faturado some quando algum faturamento emitido não tem preço em todas as linhas. Ações rápidas mudam por perfil.

---

## 11. Reescritas — Produção, Compras/Estoque, Qualidade, Cadastros e Administração

### 11.1 `formulacao.lista` — Formulações (`/producao/formulacoes`) · S · P2

**Texto atual.** Título: *"Formulações: qual produto já tem receita ativa"*. 4 termos · 1 fluxo / 4 etapas · 3 ressalvas · 260 palavras. Nota 7,1.

**Problemas.** Adequado. O histórico de versões do produto (`/producao/formulacoes/:productId`) hoje abre a ajuda gigante da versão; merece o tópico curto abaixo, estendido.

**Proposta (S, cobrindo a lista e o histórico do produto).**
> **Em uma frase.** A lista diz, produto a produto, se existe receita e em que estado: versão ativa, rascunho sem ativa, ou sem formulação. O histórico do produto mostra a versão ativa, todas as anteriores e o botão "Criar nova versão".
> **Quando usar.** Descobrir se um produto pode ser produzido e custeado; abrir a receita; começar uma receita ("Criar formulação em branco" ou "Usar template da biblioteca").
> **Próximo passo.** Abrir a versão para escrever, salvar e ativar.
> **O sistema faz sozinho.** Mostra o item acabado que a receita produz (vem do Produto); mantém uma ativa por produto; guarda as inativas legíveis porque ordens antigas apontam para elas.
> **Onde entra.** Produto → **FORMULAÇÕES** → versão → Estrutura de custos / OP.
> **Atenção.** Rascunho não produz nem custeia. Produto novo nasce em Cadastros › Produtos, não aqui.

### 11.2 `producao.ordens` — Ordens de Produção (`/producao/ordens`) · S · P2

**Texto atual.** Título: *"Ordens de Produção: a fila da fábrica"*. 5 termos · 1 fluxo / 4 etapas · 3 ressalvas · 269 palavras. Nota 6,9.

**Problemas.** Adequado. "Materiais" (coluna) explicado como "se as necessidades já viraram reserva" — o rótulo da coluna deveria dizer isso (ver terminologia).

**Proposta (S).**
> **Em uma frase.** Todas as ordens de produção, com produto, cliente, versão da receita, quantidade planejada, se o material já está reservado e a situação. Executar é dentro da ordem.
> **Quando usar.** Ver a fila por situação; achar uma ordem por código, produto ou cliente; criar uma ordem avulsa ("+ Nova OP").
> **Próximo passo.** Abrir a ordem. Ordens de pedido já nascem ligadas ao pedido pelo Plano de Atendimento.
> **Situações.** Rascunho e Planejada aceitam mudança; Liberada e Em produção têm material comprometido; Concluída e Cancelada são histórico.
> **Atenção.** Quantidade produzida não aparece aqui: é a soma dos registros, dentro da ordem. Ordem em produção não cancela.

### 11.3 `producao.picking` — Picking / Consumo (`/producao/picking`) · S · P1

**Texto atual.** Título: *"Separar material é conferir; consumir é dar baixa"*. Resumo de 96 palavras. 8 termos · 2 fluxos / 10 etapas · 8 ressalvas · 1.059 palavras. Nota 6,0.

**Problemas.** A tela é uma **lista de progresso sem ação** (a própria ajuda diz "Não há botão nem formulário aqui") e recebeu 1.059 palavras que explicam a execução da OP — duplicando `ordemProducao`. Coerência com a tela: 3. Nome em inglês.

**Proposta (S).**
> **Em uma frase.** Lista das ordens liberadas ou em produção, com o progresso de duas coisas diferentes: quantas linhas de material já foram conferidas (separação) e quantas já foram baixadas (consumo).
> **Quando usar.** Ver o que a fábrica tem para separar e consumir hoje; abrir a ordem para executar.
> **Próximo passo.** "Abrir" a ordem: conferir, consumir, pedir material extra e registrar produção acontecem lá.
> **Termos.** Separação: conferência física do lote reservado; não movimenta estoque. Consumo: a baixa; cada consumo gera um movimento de saída.
> **Atenção.** Rascunho e planejada não aparecem aqui — estão em Ordens de Produção. Depois do primeiro consumo a ordem não cancela.
> **Saiba mais.** Conceito: Reserva × consumo · Tela: Ordem de Produção.

### 11.4 `producao.folhaReceita` — Folha de Receita R.COQ.003 (`/producao/ordens/:id/receita`) · M · P1

**Texto atual.** Título: *"A pesagem confirmada é o consumo real"*. 7 termos · 2 fluxos / 8 etapas · 8 ressalvas · 738 palavras. Nota 6,7.

**Problemas.** Conteúdo correto e importante (a pesagem É o consumo; embalagem não é fracionada). Dois fluxos quase iguais (parte única × fracionada). Sem "antes de começar" (ordem liberada, lote conferido).

**Proposta (M).**
> **Em uma frase.** A Folha de Receita é o registro da pesagem: para cada matéria-prima, quanto a receita pede, quanto foi pesado, de qual lote, por quem e quando. Confirmar uma pesagem **já é** a baixa do material — o mesmo consumo da ordem, pelo outro caminho.
> **Quando usar.** Na execução da produção, no lugar do "Consumo Real" da ordem, quando a fábrica pesa por batelada (partes).
> **Próximo passo.** Partes concluídas → voltar à ordem para "Registrar produção" e "Concluir OP".
> **Antes de começar.** Ordem liberada ou em produção; lote conferido na separação; número de partes definido antes da liberação (depois não muda).
> **Passo a passo.** 1 Escolha a parte. 2 Para cada matéria-prima: quantidade pesada e lote (leitura ou digitação) → o sistema baixa o estoque e mostra a diferença. 3 "Concluir parte" (exige ao menos uma pesagem por matéria-prima; não exige bater com o plano).
> **O sistema faz sozinho.** Rateia só a matéria-prima entre as partes (a última absorve o arredondamento); embalagem fica inteira no Consumo Real; recusa pesar linha já baixada pelo Consumo Real; registra quem pesou pela sessão.
> **Onde entra.** OP liberada → **FOLHA DE RECEITA** (= consumo) → Registrar produção → Concluir OP.
> **Atenção.** **Não tem volta:** pesagem confirmada. Não existe tolerância automática: a diferença fica registrada. A quantidade produzida não é informada aqui.

### 11.5 `producao.produtoAcabado` — Produto Acabado (`/producao/produto-acabado`) · M · P2

**Texto atual.** Título: *"Todo lote acabado nasce de um apontamento de produção"*. 7 termos · 2 fluxos / 9 etapas · 8 ressalvas · 834 palavras. Nota 6,7.

**Problemas.** Lista de consulta com 834 palavras; dois fluxos (total × parcial) que pertencem à ajuda da OP. "Apontamento" (a tela diz "Registrar produção"). Repete físico/reservado/disponível.

**Proposta (M).**
> **Em uma frase.** Cada linha é um lote de produto acabado criado por um registro de produção: quanto foi produzido, quanto ainda existe, quanto está reservado a pedidos, a situação na Qualidade e o custo de material por unidade. Consulta: ações acontecem no lote ou na ordem.
> **Quando usar.** Ver o que está pronto para vender; achar o lote por lote comercial, interno, produto ou ordem; imprimir etiqueta.
> **Próximo passo.** Lote "Aguardando liberação" → decidir na tela do Lote. Lote disponível → reservar ao pedido ("Reservar disponível", no Pedido).
> **Termos.** Produzido (soma dos registros; não muda) × Físico (o que ainda existe) × Reservado × Disponível. Lote Veridi (número comercial do rótulo) × Lote interno (identidade no sistema).
> **O sistema faz sozinho.** Cria o lote no "Registrar produção" da OP; deixa o disponível em zero enquanto aguarda Qualidade; resolve o custo de material pela ordem (lotes da mesma ordem compartilham); mostra "Parcial"/"Sem custo" quando falta preço.
> **Atenção.** Produzido não é saldo. Lote produzido é sempre da Veridi, mesmo com material do cliente. Material do cliente não entra no custo.

### 11.6 `producao.templates` — Templates de Formulação (`/producao/templates-formulacao`) · M · P2

**Texto atual.** Título: *"Template é matriz reutilizável — usar é copiar"*. 7 termos · 2 fluxos / 8 etapas · 6 ressalvas · 643 palavras. Nota 6,0.

**Problemas.** "Template", "matriz" e "biblioteca" para a mesma coisa. A regra "usar copia, não vincula" está certa e repetida seis vezes. Sem "próximo passo".

**Proposta (M).**
> **Em uma frase.** Um modelo de formulação é uma receita-base guardada para servir de ponto de partida a vários produtos e clientes. Usar o modelo copia a composição para a formulação do produto; a partir daí as duas seguem separadas.
> **Quando usar.** Receita padrão que se repete (mesma base para vários sabores ou clientes); salvar uma formulação que deu certo como modelo ("Salvar como template", na versão do produto).
> **Próximo passo.** Modelo ativado → no produto, "Usar template da biblioteca".
> **Passo a passo.** "Novo template" → montar o rascunho (base, unidade, componentes, fornecimento padrão) → "Ativar" → usar no produto.
> **O sistema faz sozinho.** Só a versão ativa pode ser usada; copia com identidade nova; avisa versão nova sem aplicar; arquivado sai da escolha sem afetar o que já nasceu dele.
> **Atenção.** Não existe "atualizar todos os produtos" — cada formulação decide se adota a versão nova. Nada comercial viaja com a cópia. Editar e ativar: perfis Administração ou Produção.

### 11.7 `producao.templateDetalhe` — Template de formulação (`/producao/templates-formulacao/:id`) · M · P2

**Texto atual.** Título: *"Rascunho edita, versão ativa é história"*. 7 termos · 2 fluxos / 9 etapas · 6 ressalvas · 651 palavras. Nota 6,2.

**Problemas.** Repete o tópico da lista quase inteiro. O que é específico daqui: um rascunho por modelo, "Comparar versões", "Usada por", "Salvar identificação".

**Proposta (M).**
> **Em uma frase.** A linha de versões de um modelo: só o rascunho se edita; a ativa é a que os produtos usam; as arquivadas continuam existindo porque formulações nasceram delas.
> **Quando usar.** Alterar um modelo já ativo ("Criar nova versão"); comparar duas versões antes de ativar; renomear ("Salvar identificação"); arquivar.
> **Próximo passo.** Ativada a nova versão, nada muda nos produtos: quem quiser adotá-la cria uma versão nova da formulação do produto.
> **O sistema faz sozinho.** Mantém um rascunho por modelo; mostra "Usada por" (quantas formulações nasceram de cada versão); nunca reescreve o que já foi copiado.
> **Atenção.** **Não tem volta:** ativar. Renomear não cria versão. Rascunho não pode ser usado por produto nenhum.

### 11.8 `compras.ordens` — Ordens de Compra (`/compras/ordens`, `/nova`, `/:id`) · M · P1

**Texto atual.** Título: *"A ordem de compra é um compromisso, não estoque"*. 10 termos · 1 fluxo / 5 etapas · 8 ressalvas · 750 palavras. Nota 7,3.

**Problemas.** Bom. Longo para servir lista, criação e documento. "Total (prévia)" explicado em 60 palavras (conceito compartilhado). Botões reais: "Confirmar", "Salvar previsão e observações", "Receber materiais", "Imprimir", cancelar com motivo.

**Proposta (M).**
> **Em uma frase.** A ordem de compra registra o que a Veridi pediu a um fornecedor: itens, quantidades e preço previsto. Enquanto rascunho não vale nada; confirmada, o que ainda não chegou aparece como "Em compra". Quem traz o material para o estoque é o Recebimento.
> **Quando usar.** Comprar matéria-prima ou embalagem (manual ou a partir da Sugestão de Compra de um pedido); acompanhar o que falta receber.
> **Próximo passo.** Confirmada → quando o material chegar, "Receber materiais".
> **Antes de começar.** Fornecedor ativo; itens ativos, do tipo matéria-prima ou embalagem (produto acabado não se compra). A dica sob cada item mostra o que Item × Fornecedor sabe: homologação, preferencial, preço de referência, pedido mínimo.
> **Passo a passo.** 1 Rascunho: fornecedor, datas, itens (um por linha, na unidade de estoque), quantidade, preço previsto → o total (prévia) acompanha a digitação. 2 "Confirmar" → o sistema revalida fornecedor e itens e trava a ordem; só "Salvar previsão e observações" continua. 3 Recebimentos abatem o saldo em aberto linha a linha.
> **O sistema faz sozinho.** Calcula "Em aberto" (pedido − recebido) e o expõe como Em compra; muda a situação pelos recebimentos reais (Parcialmente recebida / Recebida), nunca à mão.
> **Onde entra.** Sugestão de Compra ou necessidade → **ORDEM DE COMPRA** → Recebimento → Lote.
> **Situações.** Rascunho → Confirmada → Parcialmente recebida → Recebida · Cancelada (só sem recebimento; com motivo).
> **Atenção.** Preço previsto não vira custo: o custo real é informado no recebimento. Em compra não cobre reserva nem libera produção. Material do cliente nunca entra em OC.

### 11.9 `compras.recebimentos` — quatro telas com um tópico · dividir · P0

**Texto atual.** Título: *"Receber é o ato que faz o material existir no estoque"*. 10 termos · 3 fluxos (A Recebimento de OC, B Material do cliente sem OC, C Consultar) / 17 etapas · 7 ressalvas · 1.079 palavras. Nota 6,2.

**Problemas.** Um tópico para lista, "Receber OC", "Receber material do cliente" e o documento. A tela de material do cliente abre uma ajuda cujo primeiro fluxo é irrelevante ali. O recebimento é **irreversível e cria estoque** — merece a ajuda mais cuidadosa de Compras, não a mais longa. "Usar preço da OC" explicado corretamente; "custo efetivo" repetido três vezes.

**Proposta — dividir em quatro:**

**11.9a `compras.recebimentos.lista` (S).**
> **Em uma frase.** Todos os recebimentos, de compra ou de material do cliente, com ordem de compra, fornecedor ou cliente, data e itens. Recebimento não tem rascunho: a situação é sempre Confirmado.
> **Próximo passo.** "Receber OC" (material comprado) ou "Receber material do cliente" (material enviado pelo cliente, sem compra).

**11.9b `compras.receberOc` — Receber OC (L, classe por irreversibilidade).**
> **Em uma frase.** Aqui o material comprado passa a existir no estoque: cada linha recebida vira um lote interno com entrada no histórico. Confirmar é definitivo.
> **Quando usar.** Chegou material de uma ordem de compra confirmada, inteiro ou em parte.
> **Próximo passo.** Item que exige Qualidade → o lote nasce "Aguardando liberação": Qualidade decide na tela do Lote. Imprimir a etiqueta do lote.
> **Antes de começar.** OC confirmada com saldo em aberto (só essas aparecem); nota fiscal ou documento; lote impresso na embalagem e validade, para itens que controlam lote e validade.
> **Passo a passo.** 1 "Selecionar ordem de compra". 2 Data, nota fiscal, referência. 3 Por linha: quantidade recebida (receber menos é normal; mais que o saldo é recusado na hora), lote do fornecedor, validade (não anterior à data), localização, custo efetivo (opcional; "Usar preço da OC" copia o preço previsto — é você quem afirma que foi esse). 4 Confirmar → o sistema grava lote, movimento e novo saldo da OC de uma vez; falhando algo, nada é gravado.
> **O sistema faz sozinho.** Cria o código interno LT-… por linha; guarda o lote do fornecedor ao lado; define a situação inicial do lote pela configuração do item (liberação/laudo → aguardando); abate o saldo da OC; nunca assume o preço da OC como custo.
> **Onde entra.** OC confirmada → **RECEBER OC** → Lote → Qualidade → Estoque.
> **Atenção.** **Não tem volta:** recebimento não se edita nem se exclui. Diferença descoberta depois vira ajuste de estoque com motivo. A única coisa editável depois é o custo efetivo, no documento do recebimento.
> **Exemplo.** OC de 100 kg; chegam 60 kg com lote A e 40 kg com lote B: são duas linhas, dois lotes internos. Chegam só 60: a OC fica "Parcialmente recebida" e os 40 continuam em compra.

**11.9c `compras.receberMaterialCliente` — Receber material do cliente (M).**
> **Em uma frase.** Entrada de material que pertence ao cliente e foi enviado por ele: sem ordem de compra, sem fornecedor e sem custo da Veridi. O lote nasce com o cliente como proprietário.
> **Antes de começar.** Cliente ativo; itens de matéria-prima ou embalagem **com controle de lote** (sem isso o sistema recusa: saldo de terceiro precisa ser distinguível).
> **Passo a passo.** Cliente proprietário → documento de remessa (nota fiscal não é obrigatória) → itens, lote do fabricante, validade, localização → confirmar.
> **O sistema faz sozinho.** Cria o lote com dono; segrega: só OPs e amostras daquele cliente enxergam esse estoque; não oferece campo de custo.
> **Atenção.** **Não tem volta.** Falta desse material não vira compra da Veridi. Lote do fabricante e validade hoje podem ficar em branco — regra em validação com a Veridi (BACKLOG #11).

**11.9d `compras.recebimento` — Recebimento, documento (S).**
> **Em uma frase.** O que entrou, em qual lote, com qual documento e custo. Só leitura, exceto "Definir ou atualizar custo" da linha.
> **Próximo passo.** "Imprimir etiqueta" do lote; abrir o lote para a Qualidade.
> **Atenção.** Custo é custeio, não recebimento físico: mudar não altera quantidade, lote nem estoque. Linha de material do cliente mostra "Não aplicável".

### 11.10 `compras.itemFornecedor` — Item × Fornecedor (`/compras/item-fornecedor`) · M · P2

**Texto atual.** Título: *"Quem pode fornecer e a que preço são duas decisões diferentes"*. 9 termos · 2 fluxos / 10 etapas · 7 ressalvas · 757 palavras. Nota 6,4.

**Problemas.** Bom conceito (homologação ≠ preço), longo; "MOQ" está proibido mas "pedido mínimo" é explicado três vezes. Moeda sem conversão é ressalva boa.

**Proposta (M).**
> **Em uma frase.** A relação entre um item e um fornecedor: o código que ele usa, se está homologado para este item (decisão da Qualidade) e as ofertas de preço (registro de Compras). Preço aqui é referência, nunca custo.
> **Quando usar.** Cadastrar de quem a Veridi pode comprar cada item; homologar ou bloquear; registrar preço, pedido mínimo e vigência; escolher o preferencial.
> **Próximo passo.** Relação aprovada e ativa → aparece na Sugestão de Compra e na dica da linha da OC.
> **Passo a passo.** Criar a relação → homologação (Pendente não é recusa; só Bloqueado é) → nova oferta (preço, unidade, moeda, vigência) → pedido mínimo (opcional) → preferencial (no máximo um, entre aprovados e ativos).
> **O sistema faz sozinho.** Escolhe a oferta vigente (a mais recente que já começou e não expirou); registra toda mudança de homologação com autor e data; tira o preferencial ao bloquear ou desativar; nunca troca o preferencial por preço.
> **Atenção.** Oferta não se edita: corrigir é registrar outra. Unidade do preço tem de conversar com a unidade de estoque (R$/g e R$/kg sim; R$/g e R$/un não). Moedas não são convertidas. Falta de homologação não trava OC manual.

### 11.11 `estoque.posicao` — Posição de Estoque (`/estoque`) · M · P1

**Texto atual.** Título: *"Nenhum saldo desta tela é digitado — todos são calculados"*. 7 termos · 1 fluxo / 5 etapas · 6 ressalvas · 583 palavras. Nota 7,6.

**Problemas.** Um dos melhores. Os quatro saldos são o conceito compartilhado número um do sistema — devem virar página de conceito e a ajuda linkar. "Causa da indisponibilidade" é a parte mais útil e está no fim do glossário.

**Proposta (M).**
> **Em uma frase.** O saldo de cada item em quatro números que não querem dizer a mesma coisa: Físico (o que está na prateleira), Reservado (já comprometido), Disponível (o que dá para usar) e Em compra (pedido e não chegado). Nenhum é digitado: todos saem do histórico de movimentações.
> **Quando usar.** Responder "posso usar?" (Disponível), "por que o disponível é menor que o físico?" (a linha diz a causa), "o que já está pedido?" (Em compra).
> **Próximo passo.** Abrir o item: saldo lote a lote, ajuste com motivo e sugestão de qual lote usar.
> **O sistema faz sozinho.** Soma as movimentações; desconta reservas de OP liberadas e de pedidos; tira do disponível lote vencido, bloqueado, aguardando Qualidade ou sem laudo; diz a causa por linha.
> **Atenção.** Físico maior que disponível quase nunca é erro. Em compra não é estoque. Rascunho de OC não conta. Material de clientes aparece no físico com o dono explícito; para o saldo por dono use Materiais de Clientes. Não existe tela de editar saldo.
> **Saiba mais.** Conceito: Físico, Reservado, Disponível e Em compra (com exemplo).

### 11.12 `estoque.item` — Item no estoque (`/estoque/:itemId`) · M · P1

**Texto atual.** Título: *"Corrigir saldo e escolher lote — nenhum dos dois se faz na mão"*. 7 termos · 2 fluxos / 10 etapas · 5 ressalvas · 664 palavras. Nota 7,1.

**Problemas.** Bom: dois fluxos com "quando" claros. FEFO/FIFO como termos; podem ser glosados no passo. O diálogo "Ajustar estoque" merece três linhas próprias.

**Proposta (M).**
> **Em uma frase.** O saldo deste item aberto lote a lote, com validade, situação e localização, e as duas ações que não se fazem na mão: corrigir uma diferença (ajuste com motivo) e saber de qual lote tirar (sugestão por validade).
> **Quando usar.** Diferença já explicada (contagem tem tela própria: Inventário Físico); separar material e precisar saber qual lote vai primeiro.
> **Passo a passo — ajustar.** "Ajustar estoque" → tipo (entrada, saída ou perda), lote quando o item controla lote, quantidade, motivo → o sistema grava um lançamento novo; o histórico continua intacto. Saída e perda não passam do disponível.
> **Passo a passo — sugerir lote.** Informe a quantidade → o sistema lista os lotes elegíveis na ordem de consumo: vence primeiro, sai primeiro (item com validade) ou entrou primeiro, sai primeiro (item sem validade). É recomendação: nada é reservado nem gravado.
> **Atenção.** Não existe campo de saldo. Lote aguardando Qualidade, bloqueado ou vencido não entra na sugestão. A referência de custo mostrada vem só de custos efetivos de recebimento.

### 11.13 `estoque.movimentacoes` — Movimentações (`/estoque/movimentacoes`) · S · P2

**Texto atual.** Título: *"O histórico não se corrige — corrige-se com um lançamento novo"*. 8 termos · 1 fluxo / 5 etapas · 5 ressalvas · 513 palavras. Nota 7,6.

**Problemas.** Bom e longo para uma lista de consulta.

**Proposta (S).**
> **Em uma frase.** O histórico de estoque: cada entrada e saída, lote a lote, com data, tipo, documento de origem, motivo (quando exigido) e quem lançou. É a única fonte de saldo, por isso nada aqui se edita ou apaga.
> **Quando usar.** Refazer o caminho de um material; auditar um saldo; conferir quem fez um ajuste.
> **Próximo passo.** Para corrigir: ajuste no item ou Inventário Físico — um lançamento novo, nunca edição.
> **Termos.** Tipo diz o que aconteceu e o sentido (recebimento, produção, consumo, expedição, amostra, ajuste, perda, saldo de abertura); a quantidade é sempre positiva. Origem é o documento que gerou o movimento.
> **Atenção.** Reserva, liberação e bloqueio de lote não aparecem aqui: mudam o disponível, não o físico.

### 11.14 `estoque.inventario` — Inventário Físico (`/estoque/inventario`) · M · P1

**Texto atual.** Título: *"A contagem física não sobrescreve o saldo"*. 6 termos · 1 fluxo / 5 etapas · 5 ressalvas · 420 palavras. Nota 7,8.

**Problemas.** Muito bom. Só ajustes de forma: "Contagem cega" explicado duas vezes; falta "antes de começar" (imprimir a folha FO-01).

**Proposta (M).**
> **Em uma frase.** Compare o que foi contado no depósito com o saldo do sistema: você informa item, lote e quantidade contada; o sistema calcula a diferença e, se houver, cria um ajuste com motivo. O saldo nunca é digitado por cima.
> **Quando usar.** Contagem periódica; conferência de um lote específico.
> **Antes de começar.** Imprimir a folha de contagem (FO-01), em modo "Contagem cega" para não induzir quem conta.
> **Passo a passo.** Escopo (item e lote) → saldo do sistema (comparação) → contagem física → diferença calculada na hora → motivo, se diferente de zero → confirmar → ajuste gerado.
> **O sistema faz sozinho.** Cria ajuste de entrada ou saída pela diferença; nada quando confere; recusa contagem abaixo do reservado.
> **Atenção.** Contagem não muda qualidade nem dono do lote. Reveja as reservas da OP antes de ajustar para baixo.

### 11.15 `estoque.materiaisCliente` — Materiais de Clientes (`/estoque/materiais-de-clientes`) · S · P2

**Texto atual.** Título: *"Material do cliente está aqui, mas não é da Veridi"*. 6 termos · 1 fluxo / 5 etapas · 7 ressalvas · 560 palavras. Nota 7,1.

**Problemas.** Conceito compartilhado (material do cliente) explicado por inteiro pela quinta vez.

**Proposta (S).**
> **Em uma frase.** Saldo do material que está na Veridi mas pertence a um cliente, lote a lote, com o dono sempre visível. Proprietário é de quem o material é; fornecedor é quem vendeu — aqui, normalmente, não há fornecedor.
> **Quando usar.** Saber quanto material de cada cliente existe antes de liberar uma OP dele; achar um lote pelo cliente.
> **Próximo passo.** Falta → pedir nova remessa ao cliente (não vira compra). Lote aguardando Qualidade → decidir no lote.
> **Atenção.** Dono é definido na entrada e não muda. Só OPs e amostras do próprio cliente usam esse estoque. Sem custo Veridi. Qualidade, validade e reserva valem igual.
> **Saiba mais.** Conceito: Material do cliente.

### 11.16 `estoque.lotes` — Lotes, Liberação de lotes e Lote · dividir · P0

**Texto atual.** Título: *"O lote é a unidade de rastreabilidade — e ele tem duas identidades"*. 13 termos · 3 fluxos (Lote recebido, Lote produzido, Decisão da Qualidade) / 14 etapas · 9 ressalvas · 995 palavras. Nota 6,2. Serve à lista, ao filtro "Liberação de lotes" do menu Qualidade e ao documento com Liberar / Bloquear / Desbloquear / Aprovar CoA / Rejeitar CoA.

**Problemas.** A decisão mais sensível da Qualidade (liberar) divide um tópico de 995 palavras com a explicação de custo e rastreabilidade. Quem clica em "Liberação de lotes" no menu chega a uma tela chamada "Lotes" com a mesma ajuda. Botões reais não citados: "Liberar", "Bloquear lote", "Desbloquear lote", "Aprovar CoA", "Rejeitar CoA", "Imprimir etiqueta", "Imprimir rastreabilidade".

**Proposta — dividir em três:**

**11.16a `estoque.lotes.lista` (S).**
> **Em uma frase.** Todos os lotes, recebidos ou produzidos, com item, dono, situação na Qualidade, laudo, validade e saldo. O saldo é a soma das movimentações.
> **Quando usar.** Achar um lote; filtrar por dono ou situação; a fila da Qualidade é esta lista filtrada por "Aguardando liberação" (menu Qualidade › Liberação de lotes).
> **Próximo passo.** Abrir o lote para decidir, imprimir a etiqueta ou ver a rastreabilidade.

**11.16b `estoque.lote.qualidade` — Lote, decisão da Qualidade (L).**
> **Em uma frase.** O lote é a menor porção de material que a Veridi rastreia. Nesta tela a Qualidade decide se ele pode ser usado: liberar, bloquear, desbloquear, e aprovar ou rejeitar o laudo do fornecedor. Só o perfil Qualidade decide.
> **Quando usar.** Lote "Aguardando liberação" (nasce assim quando o item exige liberação ou laudo); tirar um lote de uso; devolver um lote bloqueado para análise.
> **Próximo passo.** Liberado → o lote passa a contar como disponível para OP, amostra e expedição.
> **Antes de começar.** Se o item exige laudo (CoA): documento anexado em "Documentos do lote" e "Aprovar CoA" antes de "Liberar" — aprovar o laudo **não** libera o lote.
> **Passo a passo.** 1 Conferir "Quantidade e validade", "Saldo" e "Qualidade documental". 2 Laudo exigido: "Aprovar CoA" (exige anexo) ou "Rejeitar CoA" (exige motivo e bloqueia o lote). 3 "Liberar" → disponível. Ou "Bloquear lote" com motivo → fora de uso, sem sair do físico. 4 "Desbloquear lote" → volta para "Aguardando liberação", nunca direto para disponível.
> **O sistema faz sozinho.** Calcula "Vencido" pela data de validade (vale o dia inteiro; vence à meia-noite seguinte); nunca gera movimento de estoque nas decisões; registra autor e data em "Auditoria"; recusa bloquear lote com quantidade reservada.
> **Onde entra.** Recebimento ou Registro de produção → **LOTE / QUALIDADE** → Disponível → OP / Amostra / Expedição.
> **Termos.** Situação (Aguardando liberação, Disponível, Bloqueado; Vencido é calculado) × Laudo (Não exigido, Pendente, Aguardando análise, Aprovado, Rejeitado). Código interno LT-… × lote do fornecedor × Lote Veridi (comercial, em lote produzido).
> **Atenção.** Lote não se exclui: zerar por ajuste e bloquear. Quantidade recebida não é saldo. Rejeitar laudo bloqueia na mesma ação.

**11.16c `estoque.lote.rastreabilidade` (M) — o resto do documento** (Rastreabilidade, Expedições, Destino comercial, Custo de aquisição × Custo material da produção, QR). Somente leitura; texto atual condensado em ~250 palavras.

### 11.17 `estoque.escanear` — Escanear lote (`/estoque/lotes/escanear`) · S · P3

**Texto atual.** 247 palavras. Nota 8,4 — o melhor do sistema: diz o que é, o que não é, e o próximo passo. **Manter, apenas ajustar ao esqueleto** (Em uma frase / Quando usar / Próximo passo / Atenção).

### 11.18 `item.comoFunciona` — Itens de estoque / Novo item · M · P2

**Texto atual.** Título: *"Item de estoque: o que o sistema controla de verdade"*. 11 termos · 2 fluxos / 10 etapas · 8 ressalvas · 1.140 palavras. Nota 6,4.

**Problemas.** Cadastro com a segunda maior ajuda do sistema. O que importa cabe em quatro decisões: tipo, unidade, controla lote, controla validade — travam no primeiro uso. "Fonte selecionada hoje" (ordem de 5 fontes) repetida de CMV/Cálculo. Fluxo B "O que muda depois do primeiro uso" é bom e único.

**Proposta (M).**
> **Em uma frase.** Item é a coisa física que o estoque controla: matéria-prima, embalagem ou produto acabado. Tudo o que tem saldo, lote e validade é um item. Ele não sabe de cliente, receita nem preço de venda.
> **Quando usar.** Cadastrar matéria-prima e embalagem ("Novo item de estoque"); ajustar nome, classificação, exigência de Qualidade e laudo, custo de referência; inativar. Produto acabado nasce no cadastro de Produtos.
> **Próximo passo.** Item criado → Item × Fornecedor (de quem comprar) e Formulação (onde ele entra).
> **Antes de começar.** Quatro decisões que travam assim que o item tiver compra, recebimento, lote ou movimento: **tipo**, **unidade** (a de compra e contagem), **controla lote**, **controla validade**.
> **Passo a passo.** Tipo e unidade → nome → classificação (fonte, nutriente declarado, família, pureza padrão — opcionais) → rastreabilidade (lote, validade, liberação da Qualidade, exige laudo) → custo de referência inicial (opcional; em branco é "não informado", nunca R$ 0,00) → "Criar item" (código MP-/ME- gerado).
> **O sistema faz sozinho.** Gera o código; copia liberação e laudo para cada lote novo (não altera lotes existentes); usa a referência manual de custo só quando não há compra real nem oferta válida.
> **Atenção.** Pureza em branco é desconhecida, não 100%. Inativar não apaga nem interrompe o que está em curso; só recusa vínculo novo.

### 11.19 `produto.comoFunciona` — Produtos / Novo produto · M · P1

**Texto atual.** Título: *"Produto: o registro comercial e o item acabado que ele carrega"*. 8 termos · 2 fluxos / 10 etapas · 10 ressalvas · 942 palavras. Nota 6,7.

**Problemas.** O conceito central (Produto ≠ Item acabado ≠ Projeto) está bem colocado. Dez ressalvas de 40–60 palavras. Não cita "Criar produto", os atalhos "CMV" e "Custos industriais" da lista, "Inativar/Reativar".

**Proposta (M).**
> **Em uma frase.** Produto é o que a Veridi fabrica e vende para um cliente: nome, cliente, perfil industrial, e a partir dele a formulação, o custo e o preço. Ele não é o estoque — todo produto tem um item de produto acabado, criado junto, que é quem tem lote e saldo. E não é o projeto — o projeto é a negociação que vem antes.
> **Quando usar.** Cadastrar produto que não passou por projeto ("Novo produto", nasce aprovado); consultar a cadeia técnica pelos atalhos "CMV" e "Custos industriais"; inativar.
> **Próximo passo.** Produto criado → Formulação → Estrutura de custos → Precificação. Produto em desenvolvimento só vira operacional quando o projeto é aprovado.
> **Antes de começar.** Cliente ativo (obrigatório; trava depois que existir pedido, OP, orçamento ou origem em projeto); unidade em que o produto é contado no estoque.
> **O sistema faz sozinho.** Cria o item PA com lote, validade e liberação da Qualidade ligados (só "Exige laudo" é escolha); gera o código; usa "Unidades por caixa" no custo e "Lote mínimo" como sugestão; sugere validade do lote pela "Vida útil".
> **Atenção.** Não há botão de aprovar: a aprovação do projeto promove. Produto em desenvolvimento é recusado em pedido e OP. Trocar cliente de produto em uso é recusado: cadastre outro produto.

### 11.20 `cliente.comoFunciona` — Clientes / Novo cliente · S · P3

**Texto atual.** Título: *"Cliente: a identidade que os documentos congelam"*. 6 termos · 1 fluxo / 4 etapas · 5 ressalvas · 490 palavras. Nota 7,1.

**Proposta (S).**
> **Em uma frase.** Cliente é a empresa que compra da Veridi e, em produto de marca própria, é dona da marca e às vezes do material. O cadastro guarda identificação, contato, endereço e notas; a negociação fica no Projeto.
> **Quando usar.** Cadastrar antes de abrir projeto, produto, pedido ou receber material do cliente. Consultar tudo de um cliente: "Consulta completa".
> **O sistema faz sozinho.** Gera o código CLI-; confere os dígitos do CNPJ (único entre clientes; fornecedor pode repetir); congela razão social e endereço nos documentos emitidos; registra quem criou e alterou.
> **Atenção.** Razão social é o único obrigatório. Inativar não bloqueia o que existe; passa a recusar produto, pedido e remessa novos. Observações são internas.

### 11.21 `fornecedor.comoFunciona` — Fornecedores / Novo fornecedor · S · P3

**Texto atual.** Título: *"Fornecedor: a identidade, e nada além dela"*. 5 termos · 1 fluxo / 4 etapas · 5 ressalvas · 420 palavras. Nota 7,1.

**Proposta (S).**
> **Em uma frase.** Fornecedor é de quem a Veridi compra: razão social, CNPJ e contato, só. O que ele vende, com que código, se está homologado e a que preço fica em Compras › Item × Fornecedor, porque isso é por item.
> **Próximo passo.** Fornecedor criado → Item × Fornecedor.
> **O sistema faz sozinho.** Gera o código FOR-; confere o CNPJ (único entre fornecedores).
> **Atenção.** Preço de fornecedor é referência; custo real vem do recebimento. Inativar não desfaz compras; recusa OC e relação novas.

### 11.22 `recursoIndustrial.comoFunciona` — Recursos Industriais / Novo / Detalhe · M · P2

**Texto atual.** Título: *"Recurso industrial: o que custa fora do material"*. 7 termos · 2 fluxos / 8 etapas · 8 ressalvas · 737 palavras. Nota 6,4.

**Proposta (M).**
> **Em uma frase.** Recurso industrial é o que a fábrica consome além do material — mão de obra, equipamento e energia — com uma tarifa por hora ou por kWh e o histórico das tarifas. Quanto de cada recurso um produto usa é declarado na estrutura de custos do produto, não aqui.
> **Quando usar.** Cadastrar recurso e tarifa (perfil Administrador); reajustar (tarifa nova com data de início); consultar o histórico.
> **Próximo passo.** Recurso com tarifa vigente → usar na Estrutura de custos.
> **Passo a passo.** "Novo recurso": tipo (define hora ou kWh; não muda depois), nome, potência em kW (só equipamento; em branco é desconhecida) → no detalhe, "Nova tarifa": valor e vigente desde.
> **O sistema faz sozinho.** Escolhe a tarifa vigente (início passado, validade não vencida, a mais recente); ignora tarifa sem data de início; congela tarifa e potência na ativação da estrutura.
> **Atenção.** Tarifa não se edita nem apaga. Recurso inativo impede ativar estrutura que o usa. Mão de obra aqui é categoria de custo, não pessoa.

### 11.23 `qualidadeDocumentos.comoFunciona` — Documentos / CoA · M · P1

**Texto atual.** Título: *"Laudo aprovado não é lote liberado"*. 6 termos · 1 fluxo / 4 etapas · 6 ressalvas · 521 palavras. Nota 7,8.

**Problemas.** Um dos melhores: o título já é a regra. "CoA" precisa da glosa "laudo do fornecedor" na primeira linha. Só forma.

**Proposta (M).**
> **Em uma frase.** Situação documental dos lotes: quem já mandou laudo (CoA, certificado de análise do fornecedor), quem aguarda análise, quem foi aprovado ou rejeitado. Aprovar o laudo **não libera o lote**: liberar é outra ação, na tela do Lote.
> **Quando usar.** Fila de análise documental (perfil Qualidade); anexar laudo (Compras também pode).
> **Próximo passo.** Laudo aprovado → abrir o lote → "Liberar".
> **Passo a passo.** Pendências (padrão) → conferir o lote → "Aprovar" (exige anexo) ou "Rejeitar" (exige motivo; bloqueia o lote) → liberar no lote.
> **Atenção.** Rejeitar bloqueia o lote na mesma ação; desbloquear devolve para aguardando, não para disponível. A folha FO-03 imprime o mesmo recorte.

### 11.24 `usuario.comoFunciona` — Usuários · S · P3

**Texto atual.** Título: *"Usuário: quem assina cada registro"*. 5 termos · 1 fluxo / 4 etapas · 6 ressalvas · 485 palavras. Nota 6,9.

**Proposta (S).**
> **Em uma frase.** Usuário existe para entrar no sistema e para responder quem fez cada ação: o nome de quem estava conectado é gravado no documento. Não é cadastro de RH.
> **Quando usar.** Criar acesso, trocar perfil, trocar senha, inativar (perfil Administrador).
> **Termos.** Perfil: Administrador, Produção, Qualidade, Compras, Comercial ou Consulta — controle por área. Inativo: acesso derrubado na hora; tudo o que assinou permanece.
> **Atenção.** Usuário nunca é excluído. Senha em branco na edição mantém a atual. Trocar senha não avisa a pessoa. Nada impede inativar o último administrador — confira antes.

### 11.25 `documentoControlado.comoFunciona` — Documentos controlados · S · P3

**Texto atual.** Título: *"Documento controlado: o cabeçalho da revisão, só isso"*. 5 termos · 1 fluxo / 4 etapas · 6 ressalvas · 410 palavras. Nota 6,9.

**Proposta (S).**
> **Em uma frase.** Guarda a revisão vigente dos dois formulários impressos (Ordem de Produção R.PRO.002 e Folha de Receita R.COQ.003): código, revisão, data e responsáveis, que vão no cabeçalho do papel. Não anexa arquivo, não desenha formulário, não assina.
> **Quando usar.** A Qualidade emitiu uma revisão nova (perfil Administrador).
> **O sistema faz sozinho.** Ativa a revisão criada e arquiva a anterior do mesmo tipo; congela as revisões vigentes em cada OP liberada.
> **Atenção.** Revisão não se edita nem repete. Sem revisão vigente a OP libera assim mesmo, com cabeçalho vazio.

### 11.26 `precificacao.lista` — Precificação, lista (`/gestao/precificacao`) · S · P1 (tópico novo)

> **Em uma frase.** Uma linha por versão de precificação: produto, cliente, situação (rascunho, ativa, inativa), cálculo e estrutura de origem, qualidade do custo e número de faixas. Aqui não se cria precificação.
> **Quando usar.** Ver o que está vigente e sobre qual custo; achar uma precificação pelo código dela, do cálculo ou do produto.
> **Próximo passo.** Criar: na Estrutura de custos do produto, "Cálculos salvos" → "Criar precificação" ou "Usar política".
> **Atenção.** Uma ativa e um rascunho por produto. Filtro por qualidade do custo responde "o que está vigente sobre custo real?".

---

## 12. Consulta de Cliente — análise dedicada

**O que existe.** Busca (`/consultas/clientes`) → casca com cabeçalho do cliente, "Trocar cliente" e sete abas (Resumo, Produtos, Projetos, Pedidos, Produção, Estoque [Acabados / Materiais], Faturamentos) → cinco páginas de detalhe somente leitura, cada uma com "Abrir … completo ↗". O cliente vive na URL (`:customerId`), a trilha volta sempre para dentro da consulta e documento de outro cliente não abre (§42, §44, §47). Um único tópico (`consultaCliente.comoFunciona`, 394 palavras, nota 6,9) serve a busca, a casca e as abas.

**O que a ajuda atual responde bem.** Por que usar a consulta ("sem precisar saber em qual módulo procurar" — o subtítulo da busca já diz isso), que o cliente é a raiz, que é somente leitura, que "Abrir … completo" é a única saída, que o endereço carrega o cliente.

**O que falta.**
- **O que cada aba apresenta** e o que não apresenta: Produtos (os produtos do cliente e a cadeia técnica), Projetos (funil deste cliente), Pedidos (com as três leituras de situação), Produção (OPs deste cliente; "em aberto" não é "em andamento" — §47), Estoque › Acabados (produto acabado da Veridi para este cliente) × Estoque › Materiais (material que é **do** cliente), Faturamentos (com "Valores incompletos" quando falta preço).
- **Como os dados se relacionam** dentro do cliente: projeto → produtos → pedidos → OPs → lotes → faturamentos. Um mini-fluxo com as abas na ordem do processo resolveria.
- **Quando sair**: a lista de ações que exigem o módulo completo (confirmar pedido, aplicar plano, liberar OP, faturar) está em uma etapa; deveria ser a seção "Próximo passo".
- **O termo "Produto"** nomeia dois fatos no Resumo/abas (produto resultante do projeto × produtos em desenvolvimento — F-01-1, aberto em backlog). Texto não resolve; rótulo sim.
- **"Criar projeto" desabilitado sem motivo** (F-01-2) e **"Consulta completa" só de dentro do modal de edição do cliente** (F-01-3) — problemas de produto, listados na seção 16.
- Nome inconsistente: menu "Consulta de Cliente", regras e ajuda "Consulta do Cliente".

**Proposta (M) — `consultaCliente.comoFunciona`:**
> **Em uma frase.** A Consulta de Cliente reúne, sob um cliente só, tudo o que já existe espalhado pelos módulos: produtos, projetos, pedidos, produção, estoque e faturamentos. É leitura: aqui nada se cria, altera ou cancela.
> **Quando usar.** Atender uma ligação do cliente sem saber em qual módulo procurar; conferir "onde está o pedido dele" passando de projeto a pedido, a OP, a lote e a faturamento sem perder o cliente; preparar uma reunião.
> **Próximo passo.** Para operar (confirmar pedido, aplicar plano, liberar OP, faturar), use "Abrir … completo": o módulo abre no mesmo documento.
> **Como navegar.** Busque o cliente → Resumo (contadores por área) → abas. Trocar de aba nunca troca de cliente; a trilha no topo volta sempre para dentro da consulta; "Trocar cliente" volta à busca. O endereço carrega o cliente: recarregar, abrir em outra aba e mandar o link funcionam.
> **O que cada aba mostra.** Produtos: os produtos deste cliente e os atalhos da cadeia técnica. Projetos: o funil dele. Pedidos: situação, atendimento e faturamento por pedido. Produção: as OPs deste cliente, com produzido e lotes. Estoque › Acabados: o produto pronto que a Veridi fez para ele. Estoque › Materiais: o material que é dele e está na fábrica. Faturamentos: os documentos emitidos e os rascunhos.
> **Onde entra.** Cliente → Projeto → Produto → Pedido → OP → Lote → Expedição → Faturamento — as abas seguem essa ordem.
> **Atenção.** Documento de outro cliente não abre por aqui, mesmo com o endereço certo. Os contadores mudam quando alguém opera em outra tela e são relidos ao voltar. As listas são as mesmas dos módulos, filtradas por este cliente.

---

## 13. Telas e superfícies sem "Como funciona"

| Tela / superfície | Deveria ter? | Justificativa / conteúdo proposto |
|---|---|---|
| Login | **NO** | Uma ação; mensagem de erro já orienta. |
| Página 404 | **NO** | Diz que o endereço não existe e oferece o painel. |
| 24 rotas de impressão | **NO** | Documento de papel; o cabeçalho impresso já traz filtros e revisão. |
| **Orçamento** (seção do Projeto) | **YES** | Tópico próprio `comercial.orcamento` (seção 9.1), aberto por botão na seção "Orçamentos". Hoje o único botão de ajuda da ficha explica a ficha inteira. |
| Sugestão de Compra (seção do Pedido) | **YES** (curta, 120 palavras) | "Por material das OPs deste pedido: a falta física, o que já está em compra, o necessário restante, o já em rascunho e o comprar sugerido (respeita o pedido mínimo). Digite 'Comprar agora' e 'Gerar OCs em rascunho' cria uma OC por fornecedor. Gerar não compra: confirmar é em Compras. Material do cliente em falta aparece à parte e não vira compra." |
| Reservar Produto Acabado (seção do Pedido) | **YES** (curta) | "Produto que ficou pronto depois do plano não entra sozinho no pedido. Por linha: expedido, reservado restante, falta reservar, disponível agora. 'Reservar disponível' prende ao pedido o que existe. Só o reservado pode ser expedido." |
| Produto Acabado já reservado — por lote / Realocar | dentro do Pedido | Uma frase: "Lote que ficou vencido ou bloqueado pode ser realocado para outro; o que já saiu fica no lote original." |
| Plano de Atendimento | já tem | Integrar à ajuda do Pedido (9.3). |
| Alterar preço de faturamento (diálogo) | **YES** (3 linhas no próprio diálogo) | "O preço acordado continua visível; o motivo é obrigatório e fica gravado com seu nome e a data. Voltar ao valor acordado desfaz a alteração. Só perfil Comercial ou Administrador." O `CalcHint` já mostra o total resultante. |
| Ajustar estoque (diálogo) | **YES** (3 linhas) | "Isto cria um lançamento novo com motivo; a movimentação original continua no histórico. Saída e perda não passam do disponível. Para diferença de contagem, use o Inventário Físico." |
| Consumo extra (diálogo) | **YES** (3 linhas) | "Amplia a reserva desta linha sobre o saldo realmente livre do lote, com motivo. Ampliar não consome: registre o consumo depois." |
| Substituição de lote na separação | dentro da OP | Já coberta; manter no passo 4 de 9.4. |
| Aprovar projeto (diálogo com prévia) | dentro do Projeto | Uma frase: "Serão promovidos só os produtos da proposta aceita; os outros continuam em desenvolvimento. Não tem volta." |
| Usar política / Usar template (diálogos) | dentro das ajudas de Política e Template | Já cobertos. |
| Liberação de lotes (menu Qualidade) | **YES** | É a fila da Qualidade e chega numa tela chamada "Lotes". Tópico 11.16b aberto já na parte "Decisão", e — problema de produto — título da tela conforme o filtro. |
| 20 relatórios individuais | **YES** (uma frase cada) | Bloco "Este relatório" no tópico genérico, preenchido pelo catálogo (10.17). |
| Abas da Consulta de Cliente | um tópico | Seção "O que cada aba mostra" (12). |
| Histórico de versões da formulação (`/producao/formulacoes/:productId`) | **YES** | Hoje abre a ajuda gigante da versão; cobrir no tópico S de 11.1. |
| Recebimento de material do cliente | **YES** | Tópico próprio 11.9c; hoje abre o de OC. |
| Documento de recebimento | **YES** (S) | 11.9d. |
| Lista de precificações | **YES** (S) | 11.26; hoje abre o tópico do documento. |
| Placeholder de módulo | **NO** | Não há rota ativa (todos os itens do menu estão implementados). |

---

## 14. Terminologia — auditoria de nomenclatura

Contagem de rótulos visíveis em `pages/`, `app/` e `components/` (exclui testes). Recomendações **não implementadas**.

| Achado | Onde | Recomendação |
|---|---|---|
| **"Status" × "Situação"** — 15 rótulos "Status" contra 37 "Situação"; a ajuda usa os dois (termo "Status" em Projetos, Amostras, Expedições; "Situação" em OP, Faturamento, Lote) | listas do Comercial, colunas | Padronizar **"Situação"** em rótulo, coluna e ajuda. |
| **"Picking / Consumo"** (menu), seção "Picking" na OP, botão "Confirmar separação", ajuda "Separação (picking)", Expedição "Conferência" | Produção, Expedição | Um nome para o ato de conferir o lote: **"Separação"** (menu "Separação e consumo", seção "Separação", botão "Confirmar separação"). "Conferência" fica para a Expedição, que é conferência de saída. |
| **"Template"** (menu: Templates de Formulação, Templates de Estrutura), "matriz" e "biblioteca" na ajuda; "Modelo" em lugar nenhum | Produção, Gestão | **"Modelo"**: "Modelos de formulação", "Modelos de estrutura de custos", botão "Usar modelo", "Salvar como modelo". Na ajuda, um termo só. |
| **"Stand-by"** (botão e situação do projeto) | Projeto | "Em espera". |
| **"Overage"**, **"Markup"** | Formulação, Precificação, CMV | Manter (termos de fábrica e de finanças usados pela Veridi), sempre com glosa na primeira ocorrência: "overage (excesso planejado)", "markup (quanto o preço está acima do custo)". |
| **"CoA"** — menu "Documentos / CoA", painel "Laudos / CoA", botões "Aprovar CoA", coluna "CoA"; ajuda "Laudo (CoA)" | Qualidade, Lote | **"Laudo (CoA)"** em todo lugar; botões "Aprovar laudo" / "Rejeitar laudo". |
| **FEFO / FIFO** | só na ajuda e em subtítulo | Não usar a sigla no texto para usuário: "vence primeiro, sai primeiro" / "entrou primeiro, sai primeiro". |
| **Siglas de documento** OC, OP, PA, MP, ME, CMV, EC, CALC, PREC, FO-01…05, R.PRO.002, R.COQ.003, R-01…R-20 | toda a interface | Manter (são a linguagem da fábrica), com um glossário de siglas na Central de ajuda e a forma longa no título da tela ("OP — Ordem de Produção"). |
| **"Apontamento" / "Registrar produção" / "Produção realizada"** — três nomes para o mesmo ato | OP (botão), ajuda, fluxo | **"Registrar produção"** em tudo. |
| **"Lote Veridi" × "Lote interno" × "Lote do fornecedor" × "Lote do fabricante" × "Lote externo"** — cinco rótulos para três conceitos; "Lote Veridi" soa como "lote interno da Veridi", mas é o **número comercial** do produto acabado | Lote, OP, Expedição, Materiais de clientes, Recebimento | Trio fixo: **"Código interno"** (LT-…), **"Lote do fornecedor"** (ou "do fabricante" em material do cliente), **"Lote comercial"** (o do rótulo; hoje "Lote Veridi"). Decisão de PO (PO-4). |
| **"Liberar"** para lote (Qualidade) e para OP (Produção) | Lote, OP | Manter os verbos, mas o objeto sempre junto: "Liberar lote", "Liberar OP". |
| **Verbos de congelamento** diferentes por documento: Confirmar (pedido, OC, expedição, recebimento), Enviar ao cliente (orçamento), Ativar (formulação, estrutura, precificação, modelo, política, revisão), Emitir (faturamento), Liberar (OP), Aprovar (projeto) | todos | Coerentes por família. A ajuda deve dizer, em cada tela, "este é o botão que congela". Glossário de verbos na Central de ajuda. |
| **"Estrutura de custos"** (título) × **"Custos industriais"** (atalho na lista de Produtos) × "Cálculo" × "CMV" (atalho e título) | Produto, Gestão | Atalhos com o mesmo nome do destino: "Estrutura de custos" e "CMV (custo de produzir)". |
| **"Consulta de Cliente"** (menu) × "Consulta do Cliente" (regras, ajuda, comentários) | Gestão | Um só; sugestão: "Consulta do Cliente". |
| **"Em Compra" / "Em compra"** | ajuda, colunas | Capitalização única: "Em compra". |
| **"Materiais"** (coluna da lista de OPs = "reserva feita?") | Ordens de Produção | "Material reservado" (Sim/Não). |
| **"Referências"** (coluna em Item × Fornecedor = número de ofertas) | Item × Fornecedor | "Ofertas". |
| **"Pedido recorrente"** | não existe na interface — correto | Não introduzir: não há recorrência automática (§69). Usar "recompra" ou "novo orçamento". |
| **"Faturamento"** para documento que não é NF | Comercial | Manter, com o subtítulo permanente "não emite Nota Fiscal" (já existe). Decisão de PO se o nome deve mudar (PO-5). |
| **"Brief", "private label", "funil", "pipeline"** | ajuda e título de seção ("Histórico do pipeline") | "briefing" (já usado no roteiro), "marca própria", "funil" pode ficar; "Histórico de estágios" no lugar de "pipeline". |
| **"Amostra Tn"** | ajuda | "amostras T1, T2, T3…". |
| Termos de implementação na ajuda: "transação" (Plano, Pedido), "servidor" (Precificação, CMV) | ajuda | Substituir por "de uma vez / ou tudo ou nada" e "o sistema". Acrescentar ao teste de termos proibidos. |
| Vocabulário de ação (§45): "Criar <coisa>", "Salvar alterações", "Salvar <parte>", "Salvar rascunho" | consistente | Manter. A ajuda deve citar o rótulo exato. |

---

## 15. O que está mal explicado — automações, pré-requisitos e próximos passos

### 15.1 Automações do sistema que a ajuda não deixa claras (ou deixa escondidas)

| Tela | O sistema faz sozinho | Situação na ajuda atual |
|---|---|---|
| Orçamento | Sugere "Manter condição" na recompra; congela custo corrente no envio; recusa envio sem validade e aceite vencido; supera aceitas em aberto | **Ausente** |
| Pedido | Muda a situação por consequência (aplicar plano, confirmar expedição); oferece "Gerar OP para saldo restante" só em condição específica | Dito em ressalva; a condição do botão não |
| OP | Escolhe os lotes por validade na liberação; congela revisões dos documentos controlados; cria o lote PA aguardando Qualidade; sugere validade pela vida útil; libera sobra na conclusão | Escolha automática do lote: **não dita**; demais: em `detail` |
| Recebimento | Gera LT-… por linha; situação inicial do lote pela configuração do item; abate a OC; nunca assume preço da OC como custo | Dito, diluído em 1.079 palavras |
| Lote | "Vencido" calculado, vale o dia inteiro (§73) | "Calculado pela data": sim; "dia inteiro": **não** |
| Expedição | Limita a linha ao menor dos dois tetos; revalida elegibilidade na confirmação; libera reserva restante ao fechar | Dito, em termo de 70 palavras |
| Faturamento | Copia preço acordado; total só com todas as linhas; **não** aplica o desconto global do pedido | Desconto: **ausente** (e o comportamento é um defeito aberto) |
| Formulação | Estimativa de custo atualiza ao salvar e se identifica ("Custo do último salvamento") | **Ausente** (FIX-06 posterior à ajuda) |
| Precificação | Ao "Trocar a base": no rascunho troca; na ativa cria versão | Dito; sem o rótulo real |
| Projeto | Primeira amostra muda o estágio; aprovação promove o mesmo produto; cancelar desativa só o produto criado pelo projeto | Dito |
| Item / Produto | Códigos gerados; item PA criado junto com três controles ligados | Dito |
| Amostra | "Em preparação" no primeiro consumo | Dito |
| Item × Fornecedor | Tira o preferencial ao bloquear/desativar; nunca por preço | Dito |
| Painel | Tudo derivado; período só afeta duas seções | Dito |

### 15.2 Pré-requisitos invisíveis (o usuário descobre pelo erro)

| Para | Precisa antes | Onde está hoje |
|---|---|---|
| Ativar formulação | doses por embalagem (por dose); cliente no produto (componente do cliente) | ressalvas |
| Calcular/salvar custo | formulação que consiga dizer quanto material entra; recursos com tarifa vigente; oferta preferencial quando há várias | ressalvas do Cálculo e da Estrutura |
| Criar precificação | cálculo de custo salvo | primeira etapa do fluxo |
| Preço da faixa no orçamento | precificação **ativa** com faixa na quantidade **exata** | termo |
| Enviar orçamento | validade preenchida | **ausente** |
| Gerar pedido da proposta | projeto aprovado; unidade da proposta = unidade do PA | etapa do fluxo |
| Plano de Atendimento | pedido confirmado | primeira etapa |
| Liberar OP | cobertura total por disponível; lote do cliente quando há componente do cliente; produto aprovado | termo "Liberação" |
| Consumir | separação confirmada na linha | ressalva |
| Concluir OP | justificativas de diferença; motivo de variação | termo |
| Expedir | pedido em atendimento; produto acabado **reservado a este pedido** (inclusive o produzido depois) | termo do Pedido; callout da lista |
| Faturar | expedição confirmada | dito |
| Liberar lote | laudo aprovado quando exigido | dito |
| Aprovar laudo | anexo | ressalva |
| Receber material do cliente | item com controle de lote; cliente ativo | etapa |
| Preferencial em Item × Fornecedor | relação aprovada e ativa | dito |
| Aplicar modelo de estrutura | produto sem rascunho com configuração própria | ressalva |
| Aprovar projeto | orçamento aceito | dito |

Todos existem no texto atual, mas **nenhum em uma seção "Antes de começar"**. É a mudança de forma com maior retorno por esforço.

### 15.3 Próximos passos ausentes

41 dos 48 tópicos não dizem o que fazer depois. Os que mais custam:
- Formulação ativada → Estrutura de custos (existe como fluxo C, no fim).
- Cálculo salvo → Criar precificação (o botão está em outra tela).
- Precificação ativa → Orçamento.
- Orçamento aceito → Aprovar projeto (1ª venda) / gerar Pedido.
- Plano aplicado → Liberar OP (em Produção) e Confirmar OC (em Compras).
- OP concluída → Reservar o produto acabado **no Pedido**.
- Lote aguardando → decidir no Lote (a fila é a lista filtrada).
- Recebimento confirmado → Etiqueta; Qualidade.
- Expedição confirmada → Preparar faturamento.
- Faturamento emitido → NF fora do sistema.

---

## 16. Problemas que não são de texto — são de fluxo ou produto

Registrados durante a tentativa de explicar. **Não corrigidos. Marcados para decisão.**

| # | Onde | Achado | Por que texto não resolve |
|---|---|---|---|
| F1 | Orçamento | **Não tem tela própria.** Vive numa seção da ficha do Projeto (1.315 linhas de componente) junto com produtos, amostras e documentos. Com a recompra (§69), o Projeto virou "conta do cliente" e o Orçamento virou o documento comercial mais usado — sem rota, sem lista, sem breadcrumb próprio. | A ajuda pode ganhar tópico próprio, mas a pessoa continua abrindo um Projeto para achar uma proposta. Decisão PO-1. |
| F2 | Qualidade › Liberação de lotes | O item do menu abre a tela **"Lotes"** filtrada; título, subtítulo e ajuda não mudam. Quem clicou em "Liberação" não vê "Liberação". | Título e subtítulo condicionais ao filtro; ou tela própria da fila. |
| F3 | Pedido | **12 seções em uma tela de 2.582 linhas**: a tela é o painel de controle do atendimento inteiro. Várias seções só aparecem por situação, e a ordem visual não é a ordem do processo (Sugestão de Compra antes de Ordens de produção; Reservar PA no meio). | Ajuda situacional atenua; reorganizar a página por etapa (ou abas por etapa) é produto. |
| F4 | Pedido → Expedição | **Produzir não reserva.** O produto acabado produzido depois do plano só entra na expedição depois de "Reservar disponível" no Pedido. É a automação ausente mais surpreendente do sistema e o pré-requisito invisível mais caro. | Texto avisa; o esperado pelo usuário é que a OP nascida do pedido reserve para ele ao produzir. Decisão PO-2. |
| F5 | Lote / Documentos-CoA | Aprovar laudo e liberar lote são **duas telas** para o mesmo material: Documentos/CoA aprova, Lote libera. A regra é correta (duas decisões), mas exige lembrar o segundo passo. | Ação "Liberar" acessível da fila de laudos, ou "próximo passo" na tela após aprovar. |
| F6 | Produto | Não há como promover um produto em desenvolvimento fora da aprovação do projeto; o cadastro do produto não diz isso nem leva ao projeto. | Link "Aprovado pelo projeto X / Em desenvolvimento no projeto Y" no produto. |
| F7 | Formulação | "Preencher pureza registra; marcar aplica", com risco de **dupla correção**. Regra difícil de justificar para iniciante; a interface pede uma decisão de modo por linha e um aviso. | Modo padrão explícito por item ou por versão; ou o campo de pureza só aparece no modo "calcular". Decisão PO-3. |
| F8 | Custo → Preço | Cadeia de três documentos e cinco botões (Salvar base, Ativar estrutura, Calcular custo, Salvar cálculo, Criar precificação) em telas que **não estão no menu** (só por atalho de linha em Produtos). A pessoa precisa lembrar de escolher a data de referência. | Entrada no menu ("Custos e preços") ou um passo a passo visual na tela do produto. |
| F9 | Modelos e políticas | Três bibliotecas com a mesma semântica (copiar, nunca vincular; avisar versão nova) em dois módulos (Produção: Templates de Formulação; Gestão: Templates de Estrutura, Políticas). | Agrupar em "Modelos" no menu. |
| F10 | Amostra, Lote, OP | Ação que o perfil não pode fazer **some** ("Ação que não aparece costuma ser papel, não falta de função"). A pessoa não sabe se falta permissão ou se a função não existe. | Botão desabilitado com motivo, ou mensagem "só o perfil Qualidade libera". |
| F11 | Faturamento | Desconto global acordado no pedido **não é aplicado** (BILL-DISCOUNT-01, já na fila). A ajuda diz "preço acordado" e a tela mostra total = Σ quantidade × preço. | Correção de produto já priorizada; até lá a ajuda avisa. |
| F12 | Pedido | "Gerar OP para saldo restante" só aparece quando uma OP concluída produziu menos e a linha está descoberta; sem o botão, não há explicação na tela. | Mostrar a condição ou a ausência com motivo. |
| F13 | Usuários | O sistema permite inativar o último administrador e o próprio usuário. | Guarda de produto. |
| F14 | Consulta de Cliente | "Produto" nomeia dois fatos (F-01-1); "Criar projeto" desabilitado sem motivo (F-01-2); "Consulta completa" só dentro do modal de edição (F-01-3). | Rótulos e ações — backlog aberto. |
| F15 | Precificação / Orçamento | Diferença de R$ 0,04 entre a faixa e a proposta (fronteira §60) sem explicação nas duas telas (F-05-1). | `CalcHint` na linha do orçamento mostrando o arredondamento comercial. |
| F16 | Recebimento de material do cliente | Aceita confirmar sem lote do fabricante e validade, enquanto o recebimento de OC exige; regra não definida (BACKLOG #11). | Regra por item, em validação com a Veridi. |
| F17 | Estrutura de custos / Precificação | Ativar com dado completo não pede confirmação (F-04-2) — e ativar é irreversível. | Confirmação padrão em toda ativação. |
| F18 | Menu | A ordem Comercial → Produção → Compras → Estoque é deliberada (fluxo da fábrica), mas o operador de recebimento e o de Qualidade começam o dia em Compras/Estoque. Painel resolve pelas "Ações rápidas". | Decisão registrada (F-01-4, defer). Sem ação. |
| F19 | Relatórios | Um só "Como funciona" para 20 relatórios; a única explicação específica é o subtítulo. | `hint` do catálogo como bloco "Este relatório" — conteúdo, não código. |
| F20 | Regras §45 | "Glossário antes do caminho" e "criação abre a mesma ajuda da lista" são regras que produzem os problemas S1 e S8. | Revisão das duas regras. Decisão PO-6. |

---

## 17. Matriz final — uma linha por tela

Legenda: Tem = tem ajuda hoje · Nota = nota atual do tópico · Tam. = tamanho ideal · Prior. = prioridade · T/F = problema principal é de **T**exto ou de **F**luxo/produto (ou ambos).

| Módulo | Tela | Rota | Tem | Nota | Tam. | Prior. | Principal problema | Ação recomendada | T/F |
|---|---|---|---|---|---|---|---|---|---|
| Painel | Painel | `/` | Sim | 6,2 | S | P3 | Longo; metáfora | Reescrever S (10.19) | T |
| Comercial | Projetos | `/comercial/projetos` | Sim | 6,0 | M | P1 | Desatualizado (§69) | Reescrever (10.1) | T |
| Comercial | Projeto (ficha) | `/comercial/projetos/:id` | Sim | 4,9 | M | P0 | Orçamento sem tópico; §69/§71/§74 ausentes | Separar Orçamento (9.1) + ficha M (10.2) | T+F (F1) |
| Comercial | Orçamento (seção) | idem | Não (próprio) | — | L | P0 | Sem ajuda própria; formação de preço | Tópico novo (9.1) | T+F (F1) |
| Comercial | Amostras | `/comercial/amostras` | Sim | 7,3 | S | P2 | Longo para lista | Encolher (10.3) | T |
| Comercial | Amostra | `/comercial/amostras/:id` | Sim | 7,1 | M | P2 | Papéis invisíveis | Reescrever (10.4) | T+F (F10) |
| Comercial | Pedidos | `/comercial/pedidos` | Sim | 7,6 | M | P1 | Duplica o documento | Focar nas 3 colunas (10.5) | T |
| Comercial | Novo pedido | `/comercial/pedidos/novo` | Sim | 6,9 | L | P0 | Mesma ajuda do documento | Parte "Rascunho" da 9.3 | T |
| Comercial | Pedido | `/comercial/pedidos/:id` | Sim | 6,9 | L | P0 | 12 seções; reserva manual invisível | Reescrever situacional (9.3) | T+F (F3, F4, F12) |
| Comercial | Plano de Atendimento | seção | Sim | 7,3 | M | P0 | Isolado; "transação" | Integrar (10.6) | T |
| Comercial | Sugestão de Compra | seção | Não | — | S | P1 | Sem ajuda | Tópico curto (13) | T |
| Comercial | Reservar Produto Acabado | seção | Não | — | S | P0 | Sem ajuda; pré-requisito invisível | Tópico curto (13) | T+F (F4) |
| Comercial | Expedições | `/comercial/expedicoes` | Sim | 7,8 | S | P2 | Duplica documento | Encolher (10.7) | T |
| Comercial | Expedição | `/comercial/expedicoes/:id` | Sim | 6,9 | M | P0 | 11 termos; sem exemplo parcial | Reescrever (10.8) | T |
| Comercial | Faturamento (fila) | `/comercial/faturamento` | Sim | 7,3 | S | P2 | "Status" | Ajustar (10.9) | T |
| Comercial | Faturamento (doc) | `/comercial/faturamento/:id` | Sim | 7,6 | M | P0 | Desconto não aplicado; botões | Reescrever (10.10) | T+F (F11) |
| Comercial | Alterar preço (diálogo) | diálogo | Não | — | S | P0 | Irreversível sem ajuda | 3 linhas (13) | T |
| Produção | Ordens de Produção | `/producao/ordens` | Sim | 6,9 | S | P2 | Coluna "Materiais" | Ajustar (11.2) | T |
| Produção | Nova OP | `/producao/ordens/nova` | Sim | 6,4 | L | P0 | Mesma ajuda do documento | Parte "Rascunho" da 9.4 | T |
| Produção | OP | `/producao/ordens/:id` | Sim | 6,4 | L | P0 | Fluxo pula Planejar/Liberar; sem situação | Reescrever situacional (9.4) | T+F (F10) |
| Produção | Consumo extra (diálogo) | diálogo | Não | — | S | P1 | Irreversível | 3 linhas (13) | T |
| Produção | Folha de Receita | `/producao/ordens/:id/receita` | Sim | 6,7 | M | P1 | Dois fluxos iguais | Reescrever (11.4) | T |
| Produção | Picking / Consumo | `/producao/picking` | Sim | 6,0 | S | P1 | 1.059 palavras para lista sem ação; nome | Encolher (11.3) | T+F (nome) |
| Produção | Formulações | `/producao/formulacoes` | Sim | 7,1 | S | P2 | OK | Ajustar (11.1) | T |
| Produção | Formulação do produto (histórico) | `/producao/formulacoes/:productId` | Sim | 6,2 | S | P1 | Abre ajuda gigante | Tópico S (11.1) | T |
| Produção | Versão da formulação | `/producao/formulacoes/:productId/versoes/:versionId` | Sim | 6,2 | L | P0 | 1.288 palavras; regra de pureza | Reescrever (9.2) | T+F (F7) |
| Produção | Templates de Formulação | `/producao/templates-formulacao` | Sim | 6,0 | M | P2 | Template/matriz/biblioteca | Reescrever (11.6) | T+F (F9) |
| Produção | Template (detalhe) | `/producao/templates-formulacao/:id` | Sim | 6,2 | M | P2 | Repete a lista | Reescrever (11.7) | T |
| Produção | Produto Acabado | `/producao/produto-acabado` | Sim | 6,7 | M | P2 | Fluxos da OP na lista | Reescrever (11.5) | T |
| Compras | Ordens de Compra | `/compras/ordens` | Sim | 7,3 | M | P1 | Serve 3 telas | Reescrever (11.8) | T |
| Compras | Nova OC / OC | `/compras/ordens/nova`, `/:id` | Sim | 7,3 | M | P1 | idem | idem | T |
| Compras | Recebimentos | `/compras/recebimentos` | Sim | 6,2 | S | P2 | Tópico de 4 telas | Dividir (11.9a) | T |
| Compras | Receber OC | `/compras/recebimentos/novo` | Sim | 6,2 | L | P0 | idem; irreversível | Dividir (11.9b) | T |
| Compras | Receber material do cliente | `/compras/recebimentos/material-do-cliente` | Sim | 6,2 | M | P1 | Fluxo A irrelevante | Dividir (11.9c) | T+F (F16) |
| Compras | Recebimento (doc) | `/compras/recebimentos/:id` | Sim | 6,2 | S | P2 | idem | Dividir (11.9d) | T |
| Compras | Item × Fornecedor | `/compras/item-fornecedor` | Sim | 6,4 | M | P2 | Longo; "Referências" | Reescrever (11.10) | T |
| Estoque | Posição de Estoque | `/estoque` | Sim | 7,6 | M | P1 | Conceito compartilhado | Reescrever + conceito (11.11) | T |
| Estoque | Item no estoque | `/estoque/:itemId` | Sim | 7,1 | M | P1 | FEFO/FIFO | Reescrever (11.12) | T |
| Estoque | Ajustar estoque (diálogo) | diálogo | Não | — | S | P1 | Irreversível | 3 linhas (13) | T |
| Estoque | Movimentações | `/estoque/movimentacoes` | Sim | 7,6 | S | P2 | Longo | Encolher (11.13) | T |
| Estoque | Inventário Físico | `/estoque/inventario` | Sim | 7,8 | M | P1 | OK | Ajustar (11.14) | T |
| Estoque | Materiais de Clientes | `/estoque/materiais-de-clientes` | Sim | 7,1 | S | P2 | Conceito repetido | Encolher + conceito (11.15) | T |
| Estoque | Lotes | `/estoque/lotes` | Sim | 6,2 | S | P1 | Tópico de 3 telas | Dividir (11.16a) | T |
| Qualidade | Liberação de lotes | `/estoque/lotes?status=AWAITING_RELEASE` | Sim (genérica) | 6,2 | M | P0 | Título "Lotes"; ajuda genérica | Tópico 11.16b + título | T+F (F2) |
| Estoque | Lote (doc) | `/estoque/lotes/:id` | Sim | 6,2 | L | P0 | Decisão da Qualidade misturada | Dividir (11.16b/c) | T+F (F5) |
| Estoque | Escanear lote | `/estoque/lotes/escanear` | Sim | 8,4 | S | P3 | — | Manter (11.17) | — |
| Qualidade | Documentos / CoA | `/qualidade/documentos` | Sim | 7,8 | M | P1 | "CoA" sem glosa | Ajustar (11.23) | T+F (F5) |
| Cadastros | Clientes / Novo | `/cadastros/clientes`, `/novo` | Sim | 7,1 | S | P3 | Longo | Encolher (11.20) | T |
| Cadastros | Fornecedores / Novo | `/cadastros/fornecedores`, `/novo` | Sim | 7,1 | S | P3 | OK | Ajustar (11.21) | T |
| Cadastros | Itens / Novo item | `/cadastros/itens`, `/novo` | Sim | 6,4 | M | P2 | 1.140 palavras | Reescrever (11.18) | T |
| Cadastros | Produtos / Novo produto | `/cadastros/produtos`, `/novo` | Sim | 6,7 | M | P1 | 10 ressalvas; promoção invisível | Reescrever (11.19) | T+F (F6) |
| Cadastros | Estrutura de custos | `/produtos/:productId/custos` | Sim | 5,8 | L | P0 | 1.050 palavras; 3 documentos; fora do menu | Reescrever (10.13) | T+F (F8, F17) |
| Cadastros | CMV | `/produtos/:productId/cmv` | Sim | 6,0 | M | P1 | Sigla; sem próximo passo | Reescrever (10.11) | T |
| Cadastros | Cálculo salvo | `/calculos-custo/:id` | Sim | 6,4 | M | P1 | Explica ação de outra tela | Reescrever (10.12) | T |
| Gestão | Relatórios | `/relatorios` | Sim | 6,4 | S | P3 | OK | Encolher (10.16) | T |
| Gestão | 20 relatórios | `/relatorios/**` | Sim (genérica) | 6,4 | S | P2 | Um texto para 20 | Bloco por relatório (10.17) | T+F (F19) |
| Gestão | Consulta — busca | `/consultas/clientes` | Sim | 6,9 | S | P3 | OK | Ajustar (12) | T |
| Gestão | Consulta — abas e detalhes | `/consultas/clientes/:id/**` | Sim | 6,9 | M | P2 | Não diz o que cada aba mostra | Reescrever (12) | T+F (F14) |
| Gestão | Recursos Industriais / Novo / Detalhe | `/gestao/recursos-industriais/**` | Sim | 6,4 | M | P2 | Longo | Reescrever (11.22) | T |
| Gestão | Templates de Estrutura / Detalhe | `/gestao/templates-estrutura/**` | Sim | 6,2 | M | P2 | Argumentativo | Reescrever (10.14) | T+F (F9) |
| Gestão | Políticas de Precificação / Detalhe | `/gestao/politicas-precificacao/**` | Sim | 6,2 | M | P2 | Argumentativo | Reescrever (10.15) | T+F (F9) |
| Gestão | Precificação (lista) | `/gestao/precificacao` | Sim (do doc) | 6,4 | S | P1 | Não diz onde criar | Tópico S (11.26) | T |
| Gestão | Precificação (doc) | `/gestao/precificacao/:pricingId` | Sim | 6,4 | L | P0 | Modos; sem exemplo | Reescrever (9.5) | T+F (F15, F17) |
| Administração | Usuários | `/administracao/usuarios` | Sim | 6,9 | S | P3 | OK | Encolher (11.24) | T+F (F13) |
| Administração | Documentos controlados | `/administracao/documentos` | Sim | 6,9 | S | P3 | OK | Encolher (11.25) | T |
| — | Login, 404, impressões | — | Não | — | — | — | Não precisam | — | — |

---

## 18. Top 10 melhorias de UX (insights de produto, não só de texto)

1. **Nível 1 obrigatório e sempre visível: "Em uma frase · Quando usar · Próximo passo".** É o que responde "o que faço aqui?" em cinco segundos. Hoje a resposta chega depois de um glossário.
2. **Orçamento como documento de primeira classe** — tela, lista e ajuda próprias. É onde o dinheiro é decidido e onde a regra mais nova (§74) vive sem explicação.
3. **"Antes de começar" com links.** Os pré-requisitos existem, espalhados em ressalvas; reuni-los e linkar para onde se resolve cada um elimina a descoberta pelo erro.
4. **Ajuda que sabe a situação do documento.** Uma OP "Liberada" deve abrir a ajuda em "Separação"; um pedido "Em atendimento", em "Reservar / Expedir". O `FlowSteps` já tem `selected`; falta o documento informar o passo.
5. **Sete páginas de conceito compartilhadas** (saldos; reserva × consumo; identidades do lote; rascunho × ativa; prévia × gravado; custo desconhecido ≠ zero; material do cliente), com exemplo numérico, no lugar de 40 cópias diferentes. Reduz o volume total pela metade e acaba com a divergência entre cópias.
6. **Tornar visível a automação ausente mais cara: "produzir não reserva".** Além de texto, um aviso no Pedido quando há produto acabado disponível não reservado, com o botão ao lado.
7. **Título e ajuda condicionais ao filtro em "Liberação de lotes".** A fila da Qualidade merece se chamar assim.
8. **Um nome por ato:** "Separação" (não Picking), "Registrar produção" (não apontamento), "Situação" (não Status), "Modelo" (não Template/matriz), "Laudo (CoA)", "Lote comercial" (não Lote Veridi). Cada sinônimo é um custo de treinamento.
9. **Ação indisponível com motivo, não ação sumida.** "Só o perfil Qualidade libera" no lugar do botão que não aparece.
10. **Exemplos numéricos nos oito conceitos difíceis** (unidade, por dose, pureza, faixa, reajuste, custo por lote, entrega parcial, diferença de contagem). Trinta e um mil palavras sem um número é a marca mais clara de que a ajuda foi escrita para quem já sabe.

---

## 19. Arquitetura de conteúdo recomendada e fases

### 19.1 Onde os textos estão hoje

| Camada | Local | Avaliação |
|---|---|---|
| Painéis "Como funciona" e dicas ⓘ | `help/content/*.ts` por módulo (500–1.100 linhas cada), registro em `help-content.ts` | Central, tipado, testado. Arquivos grandes por módulo tornam a revisão de uma tela um diff no meio de mil linhas |
| Subtítulos de página e de seção, callouts, dicas de campo | inline no JSX de cada página | Espalhado; alguns são a melhor frase de ajuda do sistema (Documentos/CoA) e não podem ser reaproveitados |
| `CalcHint` | inline, por número | Correto: depende dos valores da linha |
| Apelidos e dicas de relatório | catálogo em `ReportsHubPage.tsx` | Conteúdo em componente |
| Guias de processo (`Guia_Passo_a_Passo_Veridi.docx`, `Guia_Fluxo_Comercial_Veridi.docx`, `Guia_Produto_e_CMV_*.docx`) | `docs/` (binários, não versionados por política) | Fora do produto; sem link a partir da ajuda |

### 19.2 Arquitetura proposta (sem implementar)

```
apps/web/src/help/
  content/
    <modulo>/<tela>.ts        um arquivo por tópico (diff pequeno, dono claro)
    index.ts                  registro que monta helpTopics (mantém HelpTopicId tipado)
  concepts/
    saldos.ts                 Físico · Reservado · Disponível · Em compra (com exemplo)
    reserva-consumo.ts        Reserva compromete; consumo baixa
    identidades-do-lote.ts    Código interno · lote do fornecedor · lote comercial
    versoes.ts                Rascunho × ativa × inativa; ativar congela
    previa-gravado.ts         Prévia acompanha a tela; gravado é o documento
    custo-desconhecido.ts     Desconhecido não é zero; subtotal conhecido
    material-do-cliente.ts    Dono ≠ fornecedor; segregação; sem custo Veridi
  glossario/
    siglas.ts                 OC, OP, PA, MP, ME, CMV, FO-xx, R-xx, R.PRO/R.COQ
    verbos.ts                 Confirmar, Ativar, Enviar, Emitir, Liberar, Aprovar — o que cada um congela
```

Tipo proposto (evolução aditiva do `HelpTopic`):

```ts
interface HelpTopicV2 {
  module: HelpModule;
  size: "S" | "M" | "L";                       // teto de palavras testado por classe
  title: string;
  oneLiner: string;                             // nível 1
  whenToUse: string[];                          // nível 1
  nextSteps: { label: string; href?: string }[];// nível 1
  prerequisites?: { text: string; href?: string }[];
  steps: { you: string; system?: string }[];    // "você faz" / "o sistema"
  automations?: string[];
  process?: { before: string[]; here: string; after: string[] }; // FlowSteps
  terms?: (HelpHintId | HelpConcept)[];         // reaproveita as dicas ⓘ; sem duplicar
  states?: { name: string; allows: string }[];
  cautions?: string[];                          // "Não tem volta:" marcado
  example?: string;
  learnMore?: { concept?: ConceptId; screen?: string; href?: string }[];
  revisedAt: string;                            // "2026-09-09" — alimenta "novidades"
}
```

Testes a acrescentar aos existentes: teto de palavras por classe; nível 1 ≤ 80 palavras; todo tópico tem `nextSteps`; termos de negócio em inglês proibidos (Picking, Template, Draft, Stand-by, Dashboard, Shipment, Billing, Pricing, Fulfillment) fora de glosa; termos de implementação (transação, servidor, DTO…); toda `href` resolve para rota existente; todo `concept` existe.

Fluxo de revisão: quem conhece a regra edita um arquivo por tela; o teste diz o que falta; a data de revisão sobe sozinha no PR. Markdown/MDX foi considerado e descartado nesta fase: perderia a tipagem que hoje impede tela apontando para tópico inexistente.

### 19.3 Fases (estimativa qualitativa; nada iniciado)

| Fase | Entrega | Depende de |
|---|---|---|
| **0 — Decisões** | As seis decisões da seção 20; revisão do §45 | PO |
| **1 — Modelo e P0 (conteúdo)** | `HelpTopicV2` aditivo; sete conceitos; reescrita dos 12 tópicos P0 (Orçamento novo, Formulação versão, Pedido+Plano, OP, Precificação, Estrutura de custos, Receber OC, Lote/Qualidade, Expedição, Faturamento doc, Reservar PA, Alterar preço); testes de teto e nível 1; opção A no modal | Fase 0 |
| **2 — Componente B** | Painel lateral com abas; botão "?" fixo; rota `/ajuda/conceitos/:slug`; situação-consciente simples; memória de aba por usuário | Fase 1 |
| **3 — Restante do conteúdo** | 36 tópicos restantes no novo modelo; divisão de Recebimentos, Lotes, Precificação lista; uma frase por relatório; terminologia aprovada aplicada aos rótulos (isso é mudança de tela, separada) | Fase 1 |
| **4 — Opção C** | Primeiro acesso guiado, busca, "o que mudou", métrica de uso | Fase 2, validação com a Veridi |

---

## 20. Findings que exigem decisão de Product Ownership

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| **PO-1** | O Orçamento ganha tela e rota próprias (`/comercial/orcamentos`, lista + documento) ou continua seção do Projeto com tópico de ajuda próprio? | (a) tela própria; (b) só tópico próprio e botão na seção | (a) — a recompra (§69) fez do Orçamento o documento comercial recorrente; hoje ele não tem lista |
| **PO-2** | "Produzir não reserva": manter como está (reserva manual no Pedido) ou reservar automaticamente ao pedido de origem quando a OP nasceu do Plano? | (a) manter + aviso; (b) automático para OP de pedido | Registrar a regra atual na ajuda já; avaliar (b) como capability — mexe em reserva, exige handoff |
| **PO-3** | Regra de pureza/overage na Formulação ("informar registra, marcar aplica"): manter e explicar, ou simplificar a interface (campo só no modo "calcular")? | (a) manter; (b) simplificar | Explicar agora (9.2); simplificação é mudança de fluxo e de dado |
| **PO-4** | Nomes das identidades do lote: "Lote Veridi" permanece como número comercial? Trio "Código interno / Lote do fornecedor / Lote comercial"? | (a) manter; (b) renomear | (b), em rótulo e ajuda; sem mudança de dado |
| **PO-5** | Terminologia: adotar "Situação", "Separação", "Modelo", "Em espera", "Laudo (CoA)", "Registrar produção" como padrão de rótulo? "Faturamento" permanece? | por termo | Adotar a lista; manter "Faturamento" com subtítulo |
| **PO-6** | Revisar o §45: (i) permitir nível 1 antes do glossário; (ii) permitir tópico próprio para tela de criação quando o fluxo difere (Receber material do cliente); (iii) teto de palavras por classe | (a) revisar; (b) manter | (a) — as duas regras atuais produzem os problemas S1 e S8 |

Também aguardam validação com a Veridi (fora desta rodada): regra de lote/validade para material do cliente (#11), limiar de validade próxima e códigos de motivo (#7) — a ajuda deve dizer "regra em definição" onde couber.

---

## 21. Teste de qualidade das cinco propostas completas

| Pergunta | 9.1 Orçamento | 9.2 Formulação | 9.3 Pedido | 9.4 OP | 9.5 Precificação |
|---|---|---|---|---|---|
| Explica por que a tela existe? | Sim (1ª frase) | Sim | Sim | Sim | Sim |
| Explica o resultado? | Sim (versão aceita → pedido) | Sim (ativa → OP/custo) | Sim (situação por consequência) | Sim (lote acabado) | Sim (preço vigente) |
| Explica o que depende do usuário? | Sim (decisão por linha) | Sim (modo e ajustes) | Sim (plano, reserva) | Sim (planejar, liberar, consumir) | Sim (faixas, modo) |
| Explica o automático? | Sim (seção própria) | Sim | Sim | Sim | Sim |
| Explica o próximo passo? | Sim, com condição | Sim | Sim, por situação | Sim, por situação | Sim |
| Possui jargão? | "markup" não; "condição" definida | "overage" com glosa | não | "picking" citado como rótulo da tela | "markup" com glosa |
| Repete o que já está visível? | Não; cita botões | Não | Não | Não | Não |
| Está longa demais? | L: 780 palavras, 3 níveis | L: 760 | L: 720 | L: 800 | L: 690 |
| Pode gerar interpretação errada? | Risco: "Manter condição" sugerido só em um caso — dito | Risco: dupla correção — dito com aviso | Risco: "produzir reserva" — negado explicitamente | Risco: "liberar tira do estoque" — negado | Risco: "faixa mais próxima" — negado com exemplo |
| Entenderia quem começou hoje? | Com o exemplo, sim | Com o exemplo, sim | Sim | Sim | Com o exemplo, sim |

Ponto aberto de qualidade: as cinco propostas continuam entre 690 e 800 palavras. Só ficam legíveis com os níveis 2 e 3 recolhidos — o que confirma que **conteúdo e componente precisam mudar juntos**.

---

## 22. Fechamento

- Runtime alterado: **NÃO**. Código, schema, migration, componentes e textos atuais: **intocados**.
- Artefato criado: este documento.
- Guia editorial futuro (`docs/UX_HELP_GUIDE.md`): **não criado**; conteúdo proposto nas seções 7 e 19.
- Próximo passo: decisões PO-1 a PO-6; depois, Fase 1 por handoff.
