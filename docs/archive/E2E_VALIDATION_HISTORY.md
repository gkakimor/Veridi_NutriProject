# Histórico de validação — E2E, auditorias e rodadas adversariais

Consolidação de dez relatórios de rodada (≈4.200 linhas) escritos entre agosto e
setembro de 2026. Substitui `VALIDACAO_E2E_*`, `AUDITORIA_QUANTIDADE_FISICA`,
`ADVERSARIAL_FINDINGS`, `UX_AUDIT`, `PRODUCT_AUDIT`,
`VALIDACAO_MANUAL_POS_RAILWAY` e o gate pós-Bloco G.

Não é registro de execução. É o que cada rodada **descobriu** e que regra durável
nasceu dela. Onde a regra vive hoje: [`PRODUCT_RULES.md`](../PRODUCT_RULES.md).
Onde ela é protegida: [`TEST_COVERAGE_MAP.md`](../TEST_COVERAGE_MAP.md).

Logs, contagens de assert e IDs de execução ficaram de fora de propósito — eles
citam massa que não existe mais, e ler isso como estado atual já produziu falso
alarme nesta base.

---

## 2026-08 · Auditoria de produto (gate técnico)

Varredura do MVP contra o gate de 41 pontos: fluxo comercial, amostras, compras,
qualidade, material do cliente, produção e custo, expedição, faturamento,
estoque, rastreabilidade, confidencialidade, papéis, relatórios.

**Zero CRITICAL.** Nenhuma corrupção de dado. Achados concentrados em consulta,
apresentação e controle de acesso — não em cálculo nem em integridade.

**Regra durável:** confidencialidade por papel é do domínio, não da tela. Custo,
margem e comissão nunca chegam a quem não negocia, e o documento entregue ao
cliente não os carrega em nenhuma hipótese.

---

## 2026-08 · Validação por interface — três casos derivados do legado

Três cenários profundos, cada um pressionando uma parte diferente do domínio,
com **todo dado nascendo pela tela**.

| Caso | Cenário | Veredito |
|---|---|---|
| VAL-LEG-01 | Pedido ao faturamento, ponta a ponta | PASS |
| VAL-LEG-02 | Falta, compra complementar de fornecedor alternativo, recebimento parcial, FEFO entre três lotes, reserva multi-lote, consumo extra com motivo, produção parcial (147 de 150), segunda OP, faturamento herdando o preço acordado | PASS |
| VAL-LEG-03 | Material do cliente ponta a ponta: propriedade e segregação, recebimento sem OC da Veridi, templates de formulação e de custo, cálculo excluindo aquisição do cliente, política de preço, parcelamento com juros, produção, rastreabilidade e faturamento | PASS |

**O CMV divergiu da planilha de referência — e o problema era da referência.**
A planilha repetia `custo_por_1000_unid = 2431,872` em todos os nove produtos,
inclusive na linha chamada "CMV modelo": valores distintos na planilha inteira,
um. O custo de material derivado dos componentes da Coenzima Q10 dava
R$ 9.708,23/1000.

**Regra durável:** o sistema segue o modelo matemático correto. Cálculo errado
em planilha ou CSV externo não vira alvo — o sistema não muda para bater com a
referência.

**Regras duráveis do hardening que se seguiu:** OP não conclui com material por
reconciliar; vírgula decimal em português sem adivinhar milhar; quantidade não
inventa precisão; coluna fixa avisa o que esconde; referência a documento é link
real; mensagem de erro tem `role` e é anunciada.

---

## 2026-08/09 · Auditoria de UX e gate pós-Bloco G

Três auditores em papéis distintos — usuário final, tarefa operacional,
visual/acessibilidade — sobre personas de Comercial, Compras e Produção.

Baseline **7,1** ("bom com atritos"). Nenhum achado bloqueava operação.

**Regras duráveis:**

- rótulo de ação é o mesmo entre telas, e o diálogo de confirmação não repete o
  rótulo de quem o abriu;
- criar entidade tem rota própria (`/cadastros/<entidade>/novo`): sobrevive a
  F5, vale como link, entra no histórico e guarda o rascunho da origem;
- catálogo nunca é truncado em silêncio — a busca vai ao servidor, que conhece
  o catálogo inteiro;
- ativar uma versão de formulação **grava o rascunho antes**, e a gravação é
  condição: se falhar, não ativa.

Um achado foi registrado como **não reproduzido**: "CEP inexistente some sem
erro". Medido ao vivo, a mensagem aparece aos ~4 s, latência do ViaCEP. O
auditor observou por menos tempo.

---

## 2026-09-02 · Validação manual pós-Railway (PO)

Onze pontos levantados navegando o ambiente publicado. Todos de descoberta e
continuidade, nenhum de cálculo.

Os que viraram regra:

- **Item removido da formulação continuava aparecendo no CMV.** CMV salvo é
  documento e não se reescreve — mas a tela precisava dizer de que versão
  falava.
- **Alterar formulação ativa sem aviso de impacto.** Passou a existir diálogo de
  impacto na ativação, caminho para voltar a uma versão antiga e caminho para
  trazer o rascunho para a ativa.
- **Cálculo salvo sem caminho para ativar a estrutura de custos.**

---

## 2026-09-03 · Rodada adversarial — núcleo operacional

45 marcos e 352 verificações procurando o que o sistema aceita **em silêncio**
em estoque, movimentações, produção e faturamento.

**Zero CRITICAL. Nada de corrupção.** Doze achados, todos em consulta,
apresentação e controle de acesso.

| Achado | Sev. | O que era |
|---|---|---|
| ADV-F12 | HIGH | Rastreabilidade negava expedição de lote que saíra por **outro** pedido: a busca filtrava pelo Pedido da OP, confundindo a origem da produção com o destino do lote |
| ADV-F10 | HIGH | Documento de faturamento não fechava na conferência manual: preço exibido com 2 casas, total calculado sobre 4 |
| ADV-F5 | HIGH | Ajuste de estoque gravava autoria de sistema e não exigia papel |
| ADV-F1 | HIGH | Filtro de status do Pedido oferecia opções que a API recusava com 400, sem a tela dizer |
| ADV-F6 | MEDIUM | Filtro de tipo em Movimentações oferecia 9 opções, a API aceitava 4 |
| ADV-F11 | MEDIUM | Dois parsers decimais na API, com mensagem descrevendo outro defeito |
| ADV-F2, F3 | MEDIUM | Badge fora da área visível; "Preparar Expedição" habilitado sem nada reservado |
| ADV-F4, F7, F8 | LOW | Liberar/bloquear lote sem entrada no menu; Qualidade liberava lote vencido; Plano aceitava digitar reserva acima do disponível |

**Regras duráveis (`PRODUCT_RULES` §50):**

- rastreabilidade de lote é **física**, pela `ShipmentLine.lotId`, nunca pelo
  pedido da OP que o produziu — estoque acabado é fungível;
- preço unitário exibe de 2 a 4 casas e **nunca** é arredondado antes da
  aritmética; totais ficam em 2 e o total do documento é a soma das linhas
  impressas;
- filtro de lista deriva da lista canônica do domínio;
- ajuste e contagem de estoque gravam o usuário real e exigem papel.

---

## 2026-09-03 · Determinismo do laboratório adversarial

Antes da segunda onda, as quatro suítes precisaram virar reexecutáveis. O que
se descobriu vale mais que a onda:

- suíte que cria massa com **nome fixo** e depois a reencontra por esse nome
  soma a massa da execução anterior — contava 14 lotes onde afirmava 6;
- `--reset` limpava o arquivo de estado, nunca o banco: o laboratório dependia
  de base limpa, que é exatamente o que um E2E não pode exigir;
- o veredito ficava gravado por marco, então **reexecutar repetia o resultado
  anterior** em vez de reavaliar — inútil para provar correção;
- o próprio script de reset tinha dois defeitos que o impediam de rodar:
  quoting de shell quebrando caminhos com espaço, e `<>` em SQL lido como
  redirecionamento.

**Regra durável:** identidade de execução (`runId`) carimbada nos campos de
negócio, não limpeza de base. É a regra que sobrevive em
[`scripts/e2e/lib/run-id.mjs`](../../scripts/e2e/lib/run-id.mjs).

---

## 2026-09-04 · Capability — quantidade física canônica

A auditoria de domínio **corrigiu uma premissa do próprio handoff**: eu havia
relatado que `purityPercentApplied` era registro e não cálculo. Estava errado —
o motor sempre aplicou pureza. A afirmação viera de um comentário do schema e de
uma busca que não alcançou o calculador. Verificar a presença de um campo não é
verificar o comportamento.

**O dado se parte em duas populações com significados opostos** para
`component.quantity`:

- 26 componentes em versões ativas: quantidade **teórica**, com pureza e overage
  aplicados hoje, fator de 1,20 a 2,40;
- os outros 1.699: quantidade **já corrigida** de fora. A Coenzima Q10 guarda
  224,4898 mg, que é 220 ÷ 0,98, e a pureza não está registrada.

Achatar tudo em `PHYSICAL_DIRECT`, como o handoff pedia, reduziria a necessidade
física entre 1,2× e 2,4× em cinco formulações ativas — drift na direção mais
perigosa. O PO decidiu **preservar o comportamento**.

**Fórmula confirmada contra o legado:** reconstruindo o total que a fábrica
pesava a partir de `quantidade × (1 + overage) ÷ pureza × doses × unidades do
lote`, batem **26 de 26** com tolerância de 0,5%.

**Zero drift:** 1.725/1.725 componentes semanticamente idênticos, doze casas
decimais, por um conferente que **replica** a conta em vez de chamar a função
sob alteração.

**Regra durável (`PRODUCT_RULES` §52):** registrar um ajuste não é autorizá-lo.

---

## 2026-09-04 · Cálculo ao vivo e auditoria do painel de ajustes

A tela mostrava travessão até salvar: quem decidia a quantidade via o efeito
depois de confirmar. A matemática subiu para `packages/shared` e a API passou a
delegar — a mesma função, não uma cópia.

Ligar a prévia expôs dois defeitos que nenhum teste via:

- o **modo não viajava no payload**: salvar qualquer edição devolvia um
  componente teórico a `PHYSICAL_DIRECT`, derrubando a necessidade física pelo
  fator de pureza, em silêncio;
- **base desconhecida** devolvia `undefined` e estourava dentro do `decimal.js`,
  derrubando a página — tolerável quando a conta era só do servidor.

A auditoria de UX que se seguiu encontrou o aviso de dupla correção **20%
visível**: `.table td { white-space: nowrap }` herdado por prosa dentro da
célula. O painel virou linha de largura inteira, e o aviso passou a 100%.

E a explicação na tela estava **errada**: mostrava `22 kg × (1 + 23%) ÷ 99%`,
que dá 27,33, ao lado do valor exibido de 0,091111 kg — faltava a divisão pela
base. O `CalcHint`, feito para acusar exatamente isso, estava calado porque
`esperado` era opcional e ninguém passou.

**Regras duráveis:** a conta na tela reconstrói o número que explica, e a
conferência não depende de alguém lembrar dela. O modo é a autoridade: marca
ligada sob física direta é registro que mente.

---

## Padrões que atravessam todas as rodadas

**Nenhuma rodada encontrou corrupção de dado.** Em oito rodadas e centenas de
verificações, zero CRITICAL. Os defeitos moram em consulta, apresentação e
autorização — não em cálculo nem em integridade transacional.

**O erro de método mais caro foi meu, e repetido:** verificar a presença de um
campo em vez do comportamento. Custou uma premissa errada num handoff inteiro.

**Falso verde e falso vermelho são o mesmo defeito.** Suíte que cacheia
veredito, verificação que chama a própria função sob teste, checagem que conta
massa ausente como aprovação, teste que mede o banco inteiro enquanto vizinhos
escrevem. Todos aprovam ou reprovam sobre algo que não mediram.

**Explicação errada convence mais que explicação nenhuma.** Vale para a
aritmética na tela e para o relatório de rodada.
