# Roteiro de validação com a Veridi

**Release apresentada:** `9a653a0`
**Objetivo da reunião:** validar se o processo que o sistema desenha corresponde
ao processo real da Veridi — não treinar, não vender, não convencer.

---

## Antes de começar

**O que esta reunião é**
Uma demonstração de ponta a ponta com pausas para escuta. Percorremos o caminho
de uma demanda de cliente e, a cada bloco, perguntamos se aquilo é o que
acontece na casa.

**O que esta reunião não é**
Não é treinamento — o Guia do Fluxo Comercial cobre isso. Não é apresentação de
funcionalidades. Não é lugar de assumir compromisso de desenvolvimento.

**Postura de quem conduz**

- Mostrar, calar e ouvir. O silêncio depois de uma pergunta é parte do método.
- Quando alguém disser "aqui a gente faz diferente", registrar a frase dele, não
  a nossa interpretação dela.
- Quando alguém apontar algo que parece errado, **não defender o sistema**.
  Perguntar como funciona hoje e seguir.
- Nenhuma promessa de prazo ou de implementação sai desta sala.

**Preparação**

- Ambiente com dados de demonstração já carregados — evitar montar cadastro ao
  vivo, que consome o tempo da conversa.
- Não usar dados reais de cliente que exponham informação desnecessária.
- Ter à mão: Guia do Fluxo Comercial, este roteiro, e alguém dedicado a anotar.

**Duração sugerida:** 90 a 120 minutos, com o bloco N reservado desde o começo.

---

## A. Contexto (10 min)

Abrir dizendo em uma frase o que o sistema cobre hoje e o que ele não cobre.

Cobre: do projeto do cliente ao faturamento, passando por custo, preço,
orçamento, compra, produção, rastreabilidade e entrega.

Não cobre: nota fiscal, contas a receber, contabilidade, integração bancária,
folha, CRM.

> **Dizer explicitamente que o sistema não emite documento fiscal.** É a
> confusão mais provável da reunião, e é melhor desfazê-la no primeiro minuto do
> que no bloco M.

**Perguntar antes de mostrar qualquer tela:**

- Como uma demanda nova de cliente chega hoje?
- Quem recebe, quem responde e em quanto tempo?
- Onde essa informação fica antes de virar um pedido?

---

## B. Projeto de um cliente (10 min)

Mostrar: cadastro do cliente, criação do projeto, perfil técnico pretendido,
situação no pipeline.

**Perguntar:**

- O projeto é a unidade certa? Vocês pensam por projeto, por produto ou por
  cliente?
- Quais informações vocês precisam registrar no primeiro contato que não estão
  aqui?
- Quem cria o projeto na prática?
- Existe alguma aprovação que deveria acontecer antes de seguir?

---

## C. Formulação (15 min)

Mostrar: base por dose × base fixa, componentes com pureza e overage, físico por
unidade, versionamento, e o template de formulação como ponto de partida.

**Perguntar:**

- A fórmula é declarada assim hoje — por dose, com pureza e overage?
- Quem pode alterar uma fórmula? Precisa de aprovação?
- Vocês reaproveitam fórmulas entre produtos? Como?
- O que muda quando o cliente pede ajuste depois da aprovação?

> Ponto a validar com atenção: **template é cópia, não vínculo.** Alterar o
> template não muda produtos que já o usaram. Perguntar se essa é a expectativa
> deles.

---

## D. Custo e CMV (15 min)

Mostrar: estrutura de custos (recursos, energia, premissas), cálculo salvo com
data de referência, qualidade do custo, e a simulação de CMV por quantidade.

**Perguntar:**

- O CMV que vocês calculam hoje considera os mesmos elementos?
- O que vocês incluem no custo industrial que não está aqui?
- Como vocês tratam energia hoje — medida, rateada, estimada?
- Qual a frequência de atualização das tarifas de mão de obra e equipamento?
- Quando falta custo de um material, o que vocês fazem hoje?

> Ponto a validar: o sistema **mostra pendência em vez de assumir zero**.
> Perguntar se isso ajuda ou atrapalha o dia a dia deles.

---

## E. Precificação (10 min)

Mostrar: faixas de quantidade, margem alvo, comissão, preço sugerido × preço
escolhido, contribuição, e política de precificação reutilizável.

**Perguntar:**

- As faixas de quantidade são assim? Quais faixas vocês usam de fato?
- Margem e comissão são os parâmetros certos, ou há outros?
- Quem tem autonomia para alterar o preço sugerido?
- Impostos e frete entram na conta de vocês? Em que momento?

---

## F. Orçamento e condições de pagamento (10 min)

Mostrar: versão do orçamento, preço vindo da precificação, condição à vista e
parcelada com entrada e juros, simulação, e a proposta impressa.

**Perguntar:**

- A proposta que sai daqui serve para enviar ao cliente como está?
- Que informação falta no documento impresso?
- As condições de pagamento que vocês praticam cabem neste formato?
- Como vocês registram uma renegociação hoje?

> Ponto a validar: o sistema **calcula e congela a condição, mas não controla
> recebimento**. Perguntar onde o contas a receber vive hoje.

---

## G. Pedido (10 min)

Mostrar: aceite do orçamento, aprovação do projeto, geração do pedido, e a
proveniência do preço acordado.

**Perguntar:**

- Aceite e aprovação são duas decisões separadas na prática de vocês?
- Quem aprova um projeto?
- O pedido nascer travado (sem edição de preço e quantidade) é o comportamento
  esperado?
- Existe caso em que o pedido precisa mesmo nascer sem orçamento?

---

## H. Plano de Atendimento (15 min)

Mostrar: a linha do produto, a linha de cada material com necessário, físico,
reservado, disponível, em compra e falta, e o caminho para a sugestão de compra.

**Perguntar:**

- **O Plano de Atendimento mostra as informações que Compras precisa?**
- O que Compras olha hoje antes de decidir comprar?
- A distinção entre "em compra" e "disponível" faz sentido na operação de vocês?
- Quem decide o fornecedor quando há mais de um homologado?
- O pedido mínimo do fornecedor deveria bloquear a compra, ou só avisar?

---

## I. Ordem de Produção (15 min)

Mostrar: geração da OP, necessidade de materiais, sugestão de lotes por
validade, planejamento, liberação e reserva.

**Perguntar:**

- **Que informação vocês precisam enxergar na OP?**
- Quem libera uma ordem para produção hoje?
- A ordem sai impressa para a fábrica? Em que formato?
- A priorização por validade (o que vence antes sai primeiro) corresponde à
  prática de vocês?
- Existe caso em que vocês precisam usar um lote fora dessa ordem? Por quê?

---

## J. Estoque e lotes (10 min)

Mostrar: posição de estoque com físico × reservado × disponível, situação dos
lotes, liberação pela Qualidade, e a folha de contagem.

**Perguntar:**

- A liberação da Qualidade acontece assim — lote a lote?
- Quem libera? Precisa de laudo antes?
- Como vocês tratam lote bloqueado ou vencido hoje?
- O inventário físico é feito com que frequência?

---

## K. Produção (15 min)

Mostrar: separação com conferência de lote, consumo real, consumo extra com
motivo, apontamento de produção, e o saldo do pedido quando a produção fica
abaixo do planejado.

**Perguntar:**

- A conferência de lote na separação é viável no chão de fábrica?
- Quem registra o consumo real? Em que momento do dia?
- Quando a produção precisa de mais material, como isso é autorizado hoje?
- Perda de processo é registrada? Onde?
- Produzir menos que o pedido e deixar saldo aberto é o comportamento esperado?

> Ponto a validar: **consumo acima da reserva exige motivo escrito.** Perguntar
> se isso é excesso de controle ou se resolve um problema real deles.

---

## L. Rastreabilidade (10 min)

Mostrar: a genealogia do lote de produto acabado até fornecedor e lote de
origem, o destino comercial, o caminho inverso a partir de uma matéria-prima, e
o documento impresso.

**Perguntar:**

- Em uma auditoria ou recall, que perguntas vocês precisam responder?
- Este documento responderia a essas perguntas?
- Que informação falta nele?
- Quanto tempo leva hoje para montar essa cadeia?

---

## M. Expedição e faturamento (10 min)

Mostrar: reserva do produto acabado, expedição com conferência, e o faturamento
herdando o preço acordado sem redigitação.

**Perguntar:**

- **Os documentos impressos têm informação suficiente para a operação?**
- O faturamento aqui é o documento que antecede a nota fiscal de vocês?
- Quem teria permissão para alterar o preço faturado?
- Como a nota fiscal é emitida hoje? A partir de qual informação?

> Repetir: **isto não é nota fiscal.**

---

## N. Material fornecido pelo cliente (10 min)

Mostrar: recebimento sem ordem de compra, proprietário do lote, qualidade,
consumo na produção, exclusão do custo da Veridi e a segregação por cliente.

**Perguntar:**

- **Como vocês tratam material enviado pelo cliente hoje?**
- Com que frequência isso acontece?
- Vocês cobram armazenagem ou serviço sobre esse material?
- Material de um cliente jamais poder atender outro corresponde à prática?
- O que acontece com a sobra ao fim do pedido?

---

## O. Perguntas abertas e feedback (15 min)

Reservar tempo de verdade. Estas são as perguntas que mais rendem:

1. **O fluxo representa como vocês trabalham hoje?**
2. **Em que etapa vocês normalmente precisam voltar ou corrigir informação?**
3. **Quem deveria ser responsável por cada etapa?**
4. **Existe alguma aprovação que deveria acontecer antes de continuar?**
5. **O que vocês controlam hoje fora do sistema e ainda precisam continuar
   controlando?**
6. O que, nesta demonstração, pareceu mais trabalhoso do que o método atual?
7. O que resolveria um problema que vocês têm hoje?
8. Se pudessem mudar uma coisa antes de usar de verdade, qual seria?

---

## Registro do feedback

Anotar **a frase da pessoa**, não a interpretação. Classificar depois da
reunião, não durante.

| Classificação | O que é | Exemplo de fala |
|---|---|---|
| **BUG** | O sistema faz algo diferente do que ele mesmo promete. | "Salvei e o número mudou sozinho." |
| **REGRA DE NEGÓCIO** | O sistema faz o que foi construído para fazer, mas a regra da Veridi é outra. | "Aqui a Qualidade libera o lote inteiro, não por recebimento." |
| **MELHORIA** | A regra está certa e o caminho é mais longo do que precisa. | "Toda vez tenho que sair da tela para ver o fornecedor." |
| **NOVO MÓDULO** | Capacidade que não existe e não estava prevista. | "Precisamos emitir a nota daqui." |
| **DÚVIDA / TREINAMENTO** | O sistema resolve e a pessoa não sabia. | "Não sabia que dava para ver isso." |

### Planilha de registro sugerida

| # | Bloco | Quem falou | Fala registrada | Classificação | Impacto percebido |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |

**Regras do registro**

- Uma linha por observação. Não agrupar falas diferentes.
- Classificação preliminar; a definitiva sai da análise posterior.
- **Nada aqui é compromisso de implementação.** O registro é insumo de
  priorização, não backlog aprovado.
- Se a mesma observação aparecer de duas pessoas diferentes, registrar as duas —
  a repetição é sinal.

---

## Depois da reunião

1. Consolidar o registro em até 48 horas, enquanto o contexto está fresco.
2. Classificar em definitivo e separar o que é **bloqueante para uso real** do
   que é melhoria.
3. Devolver à Veridi um resumo do que foi ouvido — antes de qualquer proposta de
   solução. Mostrar que a escuta aconteceu vale mais do que responder rápido.
4. Só então discutir prioridade e prazo.

---

## O que não fazer

- Não corrigir nada durante a reunião, nem "só para mostrar que dá".
- Não explicar por que a regra atual está certa quando alguém discordar.
- Não prometer data.
- Não transformar dúvida de treinamento em pedido de mudança do produto.
- Não encerrar sem o bloco O.
