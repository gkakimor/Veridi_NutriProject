# E2E — estado e regras

As suítes E2E exploratórias e adversariais históricas foram **aposentadas em
2026-09-04**. Cobertura de regressão relevante foi preservada em testes de
domínio, API e web. Novas suítes E2E canônicas serão construídas depois das
capabilities atuais.

O mapa de qual regra está protegida onde está em
[`docs/TEST_COVERAGE_MAP.md`](../../docs/TEST_COVERAGE_MAP.md). O plano das
suítes futuras está em [`docs/E2E_STRATEGY.md`](../../docs/E2E_STRATEGY.md).

## Por que foram aposentadas

Eram roteiros de aceitação de uma entrega específica: provavam que a capability
`NN` funcionava no dia em que nasceu. Uma vez que a regra virou teste de
domínio, o roteiro deixa de proteger e passa a custar — leitura, execução,
manutenção e, pior, a chance de alguém rodar um script que depende de massa que
não existe mais e ler o resultado como defeito do produto.

Três defeitos de laboratório que isso já causou, e que as regras abaixo
existem para impedir:

- suíte com nome fixo reencontrava massa da execução anterior e contava 14 lotes
  onde afirmava 6;
- verificação citava `FAT-000152` numa base cujo maior faturamento era
  `FAT-000020`, e reportava isso como regressão;
- veredito ficava em arquivo de estado, então reexecutar repetia o resultado
  gravado em vez de reavaliar.

## Regras para as suítes novas

1. **Cada suíte cria a própria massa**, carimbada com o `runId` de
   `fixtures/run.mjs` — em memória, um por execução. Nunca "pegue o primeiro
   cliente", nunca `PROD-000123`; código oficial é lido da resposta.
2. **O que se prova, pela interface.** Pré-condição pode nascer por API
   (`fixtures/cadastros.mjs`, `fixtures/producao.mjs`) quando não é o
   comportamento sob teste, economiza muito tempo, a rota já tem teste de API e
   não pula a pré-condição do cenário. GET de conferência é livre; Prisma e SQL
   direto, nunca.
3. **Happy path e caminhos negativos na MESMA suíte.** Separar "o feliz agora, o
   adversarial daqui a meses" foi o que produziu as suítes que esta pasta
   aposentou.
4. **Console e rede sujos são reprovação.** `console.error`, `pageerror` e
   4xx/5xx da API não declarados contam; a recusa provocada pelo próprio teste
   se declara com `esperarErroHttp`.
5. **Sem estado entre execuções.** Nada de veredito nem de runId em arquivo:
   rodar de novo reavalia.
6. **Poucas, completas e determinísticas.** Quatro suítes vivas valem mais que
   quarenta roteiros mortos.

## Suítes vivas

| Suíte | O que prova |
|---|---|
| `formulacao-quantidade-fisica-e-custo.mjs` | a quantidade que a tela mostra, a que o custo estimado multiplica e a que o motor calcula são a MESMA — em versão ativa e em rascunho (FIX-02, F-02-2 e F-02-1) |
| `ordem-de-producao-produto-fora-da-primeira-pagina.mjs` | uma OP de produto fora da primeira página da listagem abre com o produto certo, sem bloqueio falso, e planeja (FIX-03, F-08-2) |
| `recebimento-validacao-viva.mjs` | o Recebimento recusa o excesso ANTES de enviar, o erro some ao corrigir e a rede prova que a tentativa inválida não virou requisição — com fornecedor e matéria-prima de lote e validade da própria execução, por API; OC e recebimentos pela tela (FIX-04, F-06-1 e F-06-2) |
| `leitor-de-pdf-da-tela.mjs` | prova do leitor de PDF das suítes contra documento real: a tela põe o PDF no iframe `.pdf-screen__frame` como `blob:`, o texto traz o código da OC lido da resposta, o fornecedor carimbado e o item, e sai sem NBSP (E2E-BASELINE-REDESIGN-WAVE-01-02) |
| `roteiro-aplicado-planeja-ordem.mjs` | prova do roteiro das fixtures: a OP em rascunho sem roteiro é recusada ao planejar; com o roteiro criado, ativado e aplicado, planeja (E2E-BASELINE-REDESIGN-WAVE-01-02) |
| `disponibilidade-comercial-explicada.mjs` | a reserva de produto acabado continua bloqueada, e diz por quê com as palavras que a Posição de Estoque usa para o mesmo item — retenção e ausência de estoque recebem explicações diferentes, e o link leva ao item (FIX-05, F-09-1) |
| `custo-estimado-acompanha-o-salvamento.mjs` | salvar a Formulação faz o custo estimado convergir na mesma montagem da página, dobrar a quantidade dobra o custo da linha, a segunda edição também aparece, e com edição pendente o bloco se identifica como o do último salvamento (FIX-06, F-03-1) |
| `projeto-aprovado-vende-de-novo.mjs` | um projeto novo percorre o primeiro ciclo até o Pedido e, JÁ APROVADO, recebe um segundo orçamento que vira um segundo Pedido — sem projeto novo, com a primeira aceita ainda aceita e ligada ao seu Pedido; e a proposta vencida não é aceita (COM-CORE) |
| `desconto-do-pedido-chega-ao-faturamento.mjs` | o desconto global acordado no orçamento atravessa aceite, Pedido, expedição e chega ao Faturamento: subtotal bruto, desconto comercial e total faturado batem com a condição acordada, na tela e no impresso, sem tocar o preço unitário da linha (BILL-DISCOUNT-01b) |
| `cancelamento-de-pedido-com-op-cancelada.mjs` | com a OP viva o Pedido recusa cancelamento **com 400 e motivo**; cancelada a OP, o Pedido cancela pela interface e a OP continua no histórico (FIX-05b) |
| `vigencia-de-tarifa-industrial.mjs` | a tarifa registrada com a vigência de HOJE aparece como **Vigente** no mesmo dia, em qualquer hora em que a suíte rode; a listagem concorda com o detalhe; e o reajuste entra como registro novo sem editar, encerrar ou apagar a anterior — com o estado atual de duas vigências abertas registrado como observação (INDUSTRIAL-RATE-VALIDITY-01, §79) |
| `base-calculada-e-equivalente-por-mil.mjs` | a cadeia inteira até o CMV, clicando: uma estrutura de base **300** com recurso fixo por lote, energia e caixa inteira responde R$ 150,00 para 300 un e R$ 0,50 por unidade; o "por 1.000" aparece rotulado como **Equivalente por 1.000 un**, secundário, com a ressalva de que não é novo cálculo; e calcular 1.000 de verdade dá R$ 577,00 — quatro lotes, mais que os R$ 500,00 do equivalente (COST-BASIS-UX-01, §78) |
| `troca-de-cep-do-cliente.mjs` | o endereço do Cliente pertence a UM CEP: o CEP A preenche e NÃO inventa número; trocar para B apaga os seis campos — número e complemento inclusive — **antes** de a resposta de B chegar; o que é salvo e reaberto é o endereço de B, sem resíduo de A; e abrir o cadastro salvo não reconsulta nem limpa. O ViaCEP é interceptado por `page.route` no formato real, sem internet pública; o cadastro salvo reabre pelo id (CUSTOMER-CEP-02, §80) |
| `perfil-tributario-do-cliente.mjs` | o Perfil tributário do Cliente pela tela: o cadastro novo abre em "Não informado" num `<select>` nativo com rótulo, dica ligada por `aria-describedby` e Tab vindo do CNPJ; criar sem mexer não manda o campo e o servidor grava "Não informado"; editar para Simples Nacional e depois, PELO TECLADO, para Lucro Presumido persiste através de reload, no cadastro e no Resumo da Consulta; salvar sem mexer não reenvia o perfil; o Cliente classificado e um "Não informado" abrem Projeto sem bloqueio; em 390px o seletor cabe no campo e no formulário (a rolagem da página é o finding de shell conhecido); console limpo; o cliente reabre pelo id (`?ids=`), sem depender do filtro "Clientes ativos" (CUSTOMER-TAX-PROFILE-01, §83) |
| `produto-do-cliente-do-pedido.mjs` | o Pedido só oferece produto DO cliente do Pedido: sem cliente não há o que escolher, toda consulta de catálogo leva `customerId`, o produto de outro cliente não é encontrado nem pelo código, e com produto no Pedido trocar o cliente é bloqueado sem apagar linha (ORDER-CUSTOMER-PRODUCT-01) |
| `contato-do-cliente-no-projeto.mjs` | o telefone e o e-mail do Cliente aparecem no Resumo do Projeto, com máscara; o link "Cliente" que já existia continua sendo UM e abre o cadastro certo; e o telefone alterado no cadastro aparece no Projeto na próxima abertura — o Projeto PROJETA o cadastro, não copia. Inclui a conferência do bloco em 390px — com um e-mail longo SEM espaço nem hífen, o pior caso de largura — e registra a rolagem lateral da PÁGINA como o finding de shell conhecido (PROJECT-CUSTOMER-CONTACT-01, §82) |
| `resumo-comercial-do-projeto.mjs` | a coluna Comercial da ficha do Projeto: aparece vazia e legível sem nenhuma proposta; com a V1 em rascunho mostra valor e itens e NÃO mostra data de envio; enviada, mostra a data; e criada a V2 em rascunho, o último orçamento passa a ser a V2 enquanto a última proposta enviada continua sendo a V1, em linha própria — o passo que impede colar o rótulo de uma versão na data de outra. Inclui a condição parcelada por extenso e a conferência do bloco em 390px (PROJECT-COMMERCIAL-SUMMARY-01, §82) |
| `condicoes-do-orcamento-sobrevivem-a-linha.mjs` | condições digitadas e NÃO salvas — validade, desconto, observação, forma de pagamento e parcelas — continuam nos campos depois de adicionar produto, editar quantidade e preço, remover linha e de uma edição de linha recusada, com "Alterações não salvas" e o botão de salvar habilitado; uma segunda aba prova que nada foi gravado às escondidas; salvar grava e reabrir mostra o gravado; e abrir outra versão mostra as condições DELA, nunca o rascunho da anterior — com a observação de que voltar à versão descarta o rascunho (QUOTE-DRAFT-STATE-01) |
| `envio-exige-condicoes-salvas.mjs` | com a validade alterada e NÃO salva, "Enviar ao cliente" fica indisponível, a mensagem aparece ligada ao botão, e insistir no clique não abre confirmação nem manda requisição de envio; adicionar e remover produto não liberam; salvar libera na mesma tela; enviado, a validade congelada é a NOVA — na lista de versões, na versão reaberta e no impresso (QUOTE-SEND-DIRTY-01) |
| `envio-exige-linhas-salvas.mjs` | o preço novo da linha segura o envio antes de sair do campo; a próxima atualização de linha é derrubada na própria requisição da tela (503, uma vez), e o campo continua com o preço novo, o erro aparece, o envio fica indisponível com o motivo ligado ao botão e insistir não abre confirmação nem manda envio; a nova tentativa passa sem recarregar; enviado, a versão reaberta e o impresso trazem o preço NOVO e não o antigo; o console só tem o 503 provocado (QUOTE-SEND-LINE-DRAFT-01) |
| `preco-herdado-sobrevive-ao-tab.mjs` | pelo fluxo real — proposta enviada, aceita e versão nova —, a linha nasce com o preço herdado; passar com Tab pela quantidade, pela unidade e pelo preço sem mudar nada não manda nenhuma atualização de linha, e a ficha reaberta mantém preço, origem e vínculo com o acordo, com o envio disponível; mudar a quantidade de verdade continua soltando o preço herdado (QUOTE-LINE-NOOP-BLUR-01) |
| `prazo-invalido-nao-apaga.mjs` | com prazo 30 e 3 parcelas gravados, trocar o prazo por `abc` mostra o erro no próprio campo, ligado por `aria-describedby`, mantém o texto digitado, diz "Alterações não salvas", prende "Salvar condições" e "Enviar ao cliente", e nenhuma gravação das condições sai do navegador; uma segunda aba prova que o prazo gravado continua 30; parcelas com vírgula também são recusadas no campo; corrigidos, prazo e parcelas salvam como inteiros e a ficha reaberta mostra 45 e 4; console limpo (QUOTE-INT-FIELDS-01) |
| `projeto-inteiro-invalido-nao-apaga.mjs` | o Projeto nasce pela interface com doses 60 e vida útil 24; na edição, `abc` — colado ou digitado — nem entra no campo (`IntegerField`), e doses `0` mostram o erro no próprio campo, ligado por `aria-describedby`, mantêm o texto, prendem "Salvar alterações", e nenhuma gravação do Projeto sai do navegador; uma segunda aba prova que as doses gravadas continuam 60; corrigidas para 90, salvam como inteiro e a edição reaberta mostra 90; a mesma prova para a vida útil — `30abc` não entra, `0` recusado, 24 intacto na segunda aba, 36 salvo e reaberto; console limpo (PROJECT-INT-FIELDS-01) |
| `modelo-formulacao-unidade-controlada.mjs` | com Cliente, insumo em kg e frasco em un criados pela interface, o Modelo novo tem a unidade da base como seleção do catálogo — sem caixa de texto —, salva e volta como escolhida; componente sem Item não tem unidade; escolhido o insumo, a unidade é kg e a lista só tem massa; `g` salva com o código do catálogo e volta; trocar para o frasco leva a unidade para `un` e a lista para contagem; em 390px cada unidade cabe na célula e a tabela rola no próprio cartão (a largura da página é a mesma da lista de Modelos, o finding de shell conhecido); ativado e aplicado a um Produto pelo "Usar template da biblioteca", a Formulação nasce com as unidades do Modelo e a base na mesma grandeza (TEMPLATE-APPLY-BASE-UOM-01); console limpo (FORM-UOM-01) |
| `modelo-aplicado-preserva-base.mjs` | um Modelo com base 1 kg e 100 g de insumo, criado e ativado pela interface; aplicado pelo "Usar template da biblioteca" a um Produto em g, a Formulação nasce com base 1000 e o componente intacto (100 g); aplicado a um Produto em un, a tela mostra "A unidade da base do Modelo (kg) não é compatível com a unidade do Produto (un).", fica no Produto, e ele continua sem formulação nenhuma; o 409 provocado é declarado e console e rede ficam limpos (TEMPLATE-APPLY-BASE-UOM-01) |
| `formacao-de-preco-do-novo-orcamento.mjs` | a recompra forma o preço clicando: condição vigente na mesma quantidade nasce com o preço acordado e a origem visível até o Pedido; quantidade diferente exige motivo para manter; reajuste de 8% fechado pelo servidor (COM-PRICE, §74) |
| `ajuda-contextual-nivel-1.mjs` | o painel de ajuda abre o nível 1 antes do passo a passo nas cinco telas, com a consulta recolhida (UX-HELP-02) — abre o primeiro documento de cada lista, então precisa de base com documentos |
| `entregas-programadas-do-pedido.mjs` | reprogramar preserva a entrega original e copia só o pendente; a cadeia A → B → C fica legível (COM-04) |
| `expedicao-geral-entre-entregas.mjs` | a quantidade expedida atravessa promessas: 500 contra entregas de 400 e 600 atende 400 + 100 (COM-04b) |
| `oferta-de-fornecedor-vira-custo.mjs` | dois homologados sem preferencial deixam o custo desconhecido, o preferencial define a referência sem escolher o mais barato, e oferta nova exige vigência (COST-SOURCE-01) |
| `private-label-golden-path.mjs` | o negócio inteiro numa base que só tem usuário e unidades, pela interface: cadastros; custo dos materiais (Σ quantidade × custo, e componente sem custo nunca vira total); estrutura, cálculo, CMV e precificação; projeto, orçamento, pedido e pedido direto; plano de atendimento, sugestão de compra, OCs, recebimento parcial e completo com o dia do lote no dia comercial; qualidade; OP com número oficial, separação por leitura do lote, consumo reconciliado, produção; PA liberado, reservado e expedido do lote real; faturamento fechando em bruto, desconto, ajuste e total contra o acordado. Checkpoint por etapa, retomável com `--run` e `--desde` (FAST-DEVELOPMENT-RESET-02) |

### Como rodar, e a base real

As suítes rodam num clone descartável da base E2E — a carga inicial real da
Veridi, `pnpm e2e:baseline:rebuild` —, com API, Web e usuário ADMIN próprios:

```bash
pnpm e2e:run --bateria=wave-01-02
pnpm e2e:run --suites=troca-de-cep-do-cliente --manter-clone
```

O runner recusa template montada com outras migrations, reprova suíte com exit
≠ 0 ou "SEM MASSA" e derruba tudo o que subiu. Regras, decisões do PO e o mapa de
cada suíte contra a base: [`docs/E2E_STRATEGY.md`](../../docs/E2E_STRATEGY.md).
Hoje: 11 suítes na bateria `wave-01-02` e 2 provas; 8 que ainda leem código fixo,
saldo ou primeiro registro (grupo C, E2E-CORPUS-MASS-01); 10 a reescrever — 9 pelo
fluxo antigo do Orçamento (E2E-QUOTE-PAGE-FLOW-01) e a de `PROD-000214`.

## `lib/`

| Arquivo | O que dá |
|---|---|
| `browser.mjs` | navegador autenticado por cookie da API, em America/Sao_Paulo e pt-BR; `erros` junta console, `pageerror` e 4xx/5xx da API (pela origem de `E2E_API`) não declarados — `esperarErroHttp` declara a recusa provocada |
| `pdf.mjs` | texto do PDF da tela (iframe `.pdf-screen__frame`, `blob:`, espera de até 90 s, NBSP como espaço); gêmeo de `apps/web/src/pdf/testing/pdf-text.ts`, paridade em `pdf.test.ts` |
| `roteiro.mjs` | compatibilidade: `aplicarRoteiroNaOrdem` de `fixtures/producao.mjs` |
| `run-id.mjs` | compatibilidade: `obterRun` sem arquivo — cada chamada é uma execução nova |

## `fixtures/`

| Arquivo | O que dá |
|---|---|
| `run.mjs` | `criarRun()` — runId de 6 caracteres base36 em memória e o carimbo `E2E<runId>` |
| `api.mjs` | `autenticar`, `clienteApi`, `exigir(api, método, rota, corpo)` — falha com método, rota, status e corpo sem segredo; `exigirOrigemLocal` |
| `ui.mjs` | `esperarRota` pelo pathname (consulta como `?ids=` não quebra), `escolherOpcao` ignorando "+ Novo…" |
| `datas.mjs` | dia comercial de São Paulo e data por extenso |
| `cadastros.mjs` | `criarCliente`, `criarFornecedor`, `criarItem`, `criarProdutoOperacional`, `criarFormulacaoAtiva` — por API, carimbados, id e código lidos da resposta |
| `producao.mjs` | `criarOrdemDeProducao`, `criarRoteiroAtivo`, `aplicarRoteiro`, `planejarOrdem` |

Nem helper nem fixture carrega registro de negócio — nenhum produto, cliente,
lote, pedido, preço ou finding específico da base. Fixture cria massa genérica
carimbada, não navega e não afirma regra: prepara. Se a suíte precisa de um
registro específico, ele pertence à suíte. Contrato das fixtures em
`fixtures/fixtures.test.ts`; guardas do runner em `scripts/e2e-run.test.ts`.
