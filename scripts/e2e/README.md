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
   `lib/run-id.mjs`. Nunca "pegue o primeiro cliente", nunca `PROD-000123`.
2. **Mutação de negócio pela interface.** API e banco entram só como
   verificação, nunca para fabricar o estado que o teste deveria criar clicando.
3. **Happy path e caminhos negativos na MESMA suíte.** Separar "o feliz agora, o
   adversarial daqui a meses" foi o que produziu as suítes que esta pasta
   aposentou.
4. **Console sujo é reprovação.** `console.error` e `pageerror` contam.
5. **Sem estado entre execuções.** Nada de veredito gravado: rodar de novo
   reavalia.
6. **Poucas, completas e determinísticas.** Quatro suítes vivas valem mais que
   quarenta roteiros mortos.

## Suítes vivas

| Suíte | O que prova |
|---|---|
| `formulacao-quantidade-fisica-e-custo.mjs` | a quantidade que a tela mostra, a que o custo estimado multiplica e a que o motor calcula são a MESMA — em versão ativa e em rascunho (FIX-02, F-02-2 e F-02-1) |
| `ordem-de-producao-produto-fora-da-primeira-pagina.mjs` | uma OP de produto fora da primeira página da listagem abre com o produto certo, sem bloqueio falso, e planeja (FIX-03, F-08-2) |
| `recebimento-validacao-viva.mjs` | o Recebimento recusa o excesso ANTES de enviar, o erro some ao corrigir e a rede prova que a tentativa inválida não virou requisição (FIX-04, F-06-1 e F-06-2) |
| `disponibilidade-comercial-explicada.mjs` | a reserva de produto acabado continua bloqueada, e diz por quê com as palavras que a Posição de Estoque usa para o mesmo item — retenção e ausência de estoque recebem explicações diferentes, e o link leva ao item (FIX-05, F-09-1) |
| `custo-estimado-acompanha-o-salvamento.mjs` | salvar a Formulação faz o custo estimado convergir na mesma montagem da página, dobrar a quantidade dobra o custo da linha, a segunda edição também aparece, e com edição pendente o bloco se identifica como o do último salvamento (FIX-06, F-03-1) |
| `projeto-aprovado-vende-de-novo.mjs` | um projeto novo percorre o primeiro ciclo até o Pedido e, JÁ APROVADO, recebe um segundo orçamento que vira um segundo Pedido — sem projeto novo, com a primeira aceita ainda aceita e ligada ao seu Pedido; e a proposta vencida não é aceita (COM-CORE) |
| `desconto-do-pedido-chega-ao-faturamento.mjs` | o desconto global acordado no orçamento atravessa aceite, Pedido, expedição e chega ao Faturamento: subtotal bruto, desconto comercial e total faturado batem com a condição acordada, na tela e no impresso, sem tocar o preço unitário da linha (BILL-DISCOUNT-01b) |
| `cancelamento-de-pedido-com-op-cancelada.mjs` | com a OP viva o Pedido recusa cancelamento **com 400 e motivo**; cancelada a OP, o Pedido cancela pela interface e a OP continua no histórico (FIX-05b) |
| `vigencia-de-tarifa-industrial.mjs` | a tarifa registrada com a vigência de HOJE aparece como **Vigente** no mesmo dia, em qualquer hora em que a suíte rode; a listagem concorda com o detalhe; e o reajuste entra como registro novo sem editar, encerrar ou apagar a anterior — com o estado atual de duas vigências abertas registrado como observação (INDUSTRIAL-RATE-VALIDITY-01, §79) |
| `base-calculada-e-equivalente-por-mil.mjs` | a cadeia inteira até o CMV, clicando: uma estrutura de base **300** com recurso fixo por lote, energia e caixa inteira responde R$ 150,00 para 300 un e R$ 0,50 por unidade; o "por 1.000" aparece rotulado como **Equivalente por 1.000 un**, secundário, com a ressalva de que não é novo cálculo; e calcular 1.000 de verdade dá R$ 577,00 — quatro lotes, mais que os R$ 500,00 do equivalente (COST-BASIS-UX-01, §78) |
| `troca-de-cep-do-cliente.mjs` | o endereço do Cliente pertence a UM CEP: o CEP A preenche e NÃO inventa número; trocar para B apaga os seis campos — número e complemento inclusive — **antes** de a resposta de B chegar; o que é salvo e reaberto é o endereço de B, sem resíduo de A; e abrir o cadastro salvo não reconsulta nem limpa. O ViaCEP é interceptado por `page.route` no formato real, sem internet pública (CUSTOMER-CEP-02, §80) |
| `produto-do-cliente-do-pedido.mjs` | o Pedido só oferece produto DO cliente do Pedido: sem cliente não há o que escolher, toda consulta de catálogo leva `customerId`, o produto de outro cliente não é encontrado nem pelo código, e com produto no Pedido trocar o cliente é bloqueado sem apagar linha (ORDER-CUSTOMER-PRODUCT-01) |
| `contato-do-cliente-no-projeto.mjs` | o telefone e o e-mail do Cliente aparecem no Resumo do Projeto, com máscara; o link "Cliente" que já existia continua sendo UM e abre o cadastro certo; e o telefone alterado no cadastro aparece no Projeto na próxima abertura — o Projeto PROJETA o cadastro, não copia. Inclui a conferência do bloco em 390px — com um e-mail longo SEM espaço nem hífen, o pior caso de largura — e registra a rolagem lateral da PÁGINA como o finding de shell conhecido (PROJECT-CUSTOMER-CONTACT-01, §82) |
| `resumo-comercial-do-projeto.mjs` | a coluna Comercial da ficha do Projeto: aparece vazia e legível sem nenhuma proposta; com a V1 em rascunho mostra valor e itens e NÃO mostra data de envio; enviada, mostra a data; e criada a V2 em rascunho, o último orçamento passa a ser a V2 enquanto a última proposta enviada continua sendo a V1, em linha própria — o passo que impede colar o rótulo de uma versão na data de outra. Inclui a condição parcelada por extenso e a conferência do bloco em 390px (PROJECT-COMMERCIAL-SUMMARY-01, §82) |
| `condicoes-do-orcamento-sobrevivem-a-linha.mjs` | condições digitadas e NÃO salvas — validade, desconto, observação, forma de pagamento e parcelas — continuam nos campos depois de adicionar produto, editar quantidade e preço, remover linha e de uma edição de linha recusada, com "Alterações não salvas" e o botão de salvar habilitado; uma segunda aba prova que nada foi gravado às escondidas; salvar grava e reabrir mostra o gravado; e abrir outra versão mostra as condições DELA, nunca o rascunho da anterior — com a observação de que voltar à versão descarta o rascunho (QUOTE-DRAFT-STATE-01) |
| `envio-exige-condicoes-salvas.mjs` | com a validade alterada e NÃO salva, "Enviar ao cliente" fica indisponível, a mensagem aparece ligada ao botão, e insistir no clique não abre confirmação nem manda requisição de envio; adicionar e remover produto não liberam; salvar libera na mesma tela; enviado, a validade congelada é a NOVA — na lista de versões, na versão reaberta e no impresso (QUOTE-SEND-DIRTY-01) |
| `envio-exige-linhas-salvas.mjs` | o preço novo da linha segura o envio antes de sair do campo; a próxima atualização de linha é derrubada na própria requisição da tela (503, uma vez), e o campo continua com o preço novo, o erro aparece, o envio fica indisponível com o motivo ligado ao botão e insistir não abre confirmação nem manda envio; a nova tentativa passa sem recarregar; enviado, a versão reaberta e o impresso trazem o preço NOVO e não o antigo; o console só tem o 503 provocado (QUOTE-SEND-LINE-DRAFT-01) |
| `preco-herdado-sobrevive-ao-tab.mjs` | pelo fluxo real — proposta enviada, aceita e versão nova —, a linha nasce com o preço herdado; passar com Tab pela quantidade, pela unidade e pelo preço sem mudar nada não manda nenhuma atualização de linha, e a ficha reaberta mantém preço, origem e vínculo com o acordo, com o envio disponível; mudar a quantidade de verdade continua soltando o preço herdado (QUOTE-LINE-NOOP-BLUR-01) |
| `prazo-invalido-nao-apaga.mjs` | com prazo 30 e 3 parcelas gravados, trocar o prazo por `abc` mostra o erro no próprio campo, ligado por `aria-describedby`, mantém o texto digitado, diz "Alterações não salvas", prende "Salvar condições" e "Enviar ao cliente", e nenhuma gravação das condições sai do navegador; uma segunda aba prova que o prazo gravado continua 30; parcelas com vírgula também são recusadas no campo; corrigidos, prazo e parcelas salvam como inteiros e a ficha reaberta mostra 45 e 4; console limpo (QUOTE-INT-FIELDS-01) |
| `projeto-inteiro-invalido-nao-apaga.mjs` | o Projeto nasce pela interface com doses 60 e vida útil 24; na edição, doses `abc` mostram o erro no próprio campo, ligado por `aria-describedby`, mantêm o texto, prendem "Salvar alterações", e nenhuma gravação do Projeto sai do navegador; uma segunda aba prova que as doses gravadas continuam 60; corrigidas para 90, salvam como inteiro e a edição reaberta mostra 90; a mesma prova para a vida útil — `30abc` recusado, 24 intacto na segunda aba, 36 salvo e reaberto; console limpo (PROJECT-INT-FIELDS-01) |
| `modelo-formulacao-unidade-controlada.mjs` | com Cliente, insumo em kg e frasco em un criados pela interface, o Modelo novo tem a unidade da base como seleção do catálogo — sem caixa de texto —, salva e volta como escolhida; componente sem Item não tem unidade; escolhido o insumo, a unidade é kg e a lista só tem massa; `g` salva com o código do catálogo e volta; trocar para o frasco leva a unidade para `un` e a lista para contagem; em 390px cada unidade cabe na célula e a tabela rola no próprio cartão (a largura da página é a mesma da lista de Modelos, o finding de shell conhecido); ativado e aplicado a um Produto pelo "Usar template da biblioteca", a Formulação nasce com as unidades do Modelo; console limpo (FORM-UOM-01) |

## `lib/`

| Arquivo | O que dá |
|---|---|
| `browser.mjs` | navegador autenticado por cookie da API, cliente HTTP, coletor de erros de console |
| `run-id.mjs` | token de execução para carimbar a massa desta rodada |

Os helpers não carregam contexto de negócio — nenhum produto, cliente, lote,
pedido, preço ou finding específico. Se um helper precisar disso, ele pertence à
suíte, não à `lib/`.
