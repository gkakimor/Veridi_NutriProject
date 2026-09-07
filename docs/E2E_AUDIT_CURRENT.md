# Auditoria E2E — rodada de 2026-09-07

**Base:** DEV local reconstruída do zero + carga mestra real do corpus da Veridi.
**Regra da rodada:** tudo pela INTERFACE. Zero chamada direta de API, zero SQL
como asserção, zero correção de código. Só observar, medir e registrar.

**Dado de cliente:** os cenários rodaram contra os clientes e produtos reais do
corpus da Veridi, mas este documento é versionado — por isso os registros
aparecem pelo código interno (`CLI-000001`), nunca pelo nome. É a mesma política
que mantém o corpus em `.local-data/`.

**Ambiente:** `main @ 0134674`, API 127.0.0.1:3333, web 127.0.0.1:5173,
navegador em 1280×720.

---

## E2E-01 — Cliente → Projeto → Produto

**Objetivo:** simular o começo de um relacionamento comercial.

**Passos, todos pela tela:** Cadastros › Clientes (lista com 80 clientes reais) →
Consulta de Cliente → CLI-000001 → aba Resumo → aba Projetos →
PROJ-000097 (detalhe dentro da consulta) → aba Produtos → Comercial › Projetos →
Novo projeto → tentativa inválida → preenchimento → **PROJ-000249 criado** →
"+ Adicionar produto" → **PROD-000215 criado** → Cadastros › Produtos (detalhe) →
**PA-000215 confirmado** → volta para Consulta de Cliente › Projetos.

**Resultado: PASS.**

**Happy path:** projeto, produto e item de produto acabado nasceram pela
interface. PA-000215 apareceu automaticamente com "controla lote · controla
validade · exige liberação da Qualidade". O bloco "VER RELACIONADOS" liga
Formulação, Custos industriais, CMV, Precificação, Ordens de produção e Projeto
de origem.

**Negative path:** "Criar projeto" com Cliente e Nome vazios — nada foi criado
(correto), mas ver F-01-2.

### Findings

**F-01-1 — MEDIUM — a coluna PRODUTO da consulta e a lista de produtos do projeto
discordam.**
Tela: Consulta de Cliente › Projetos e o detalhe do projeto dentro dela.
Repro: abrir CLI-000001 › Projetos. A linha PROJ-000097 mostra
PRODUTO = "CREATINA PURA PT 300g (produto do cliente)"; clicar na linha abre o detalhe,
que diz **"Nenhum produto associado a este projeto."** Na direção inversa,
PROJ-000249 (criado nesta rodada, com PROD-000215 dentro) aparece na lista com
PRODUTO = "—".
Esperado: as duas leituras do mesmo projeto concordam, ou os rótulos distinguem
os dois fatos.
Observado: contradizem-se, nas duas direções.
Impacto: quem consulta o cliente não sabe se o projeto tem produto.
Hipótese técnica (com evidência): a coluna lê o "produto resultante"
(`Project.productId`, que a própria tela diz que "nasce na aprovação") e a lista
lê os produtos em desenvolvimento do projeto. São fatos diferentes com o mesmo
nome.

**F-01-2 — UX — "Criar projeto" fica desabilitado sem dizer por quê.**
Tela: Comercial › Projetos › Novo projeto.
Repro: abrir o formulário e clicar em "Criar projeto" sem preencher nada.
Observado: o botão está `disabled`; nenhuma mensagem, nenhum campo destacado,
nenhum foco movido. Os únicos indícios são os asteriscos em "Cliente *" e
"Nome do projeto *".
Impacto: usuário pouco técnico clica, não acontece nada, e não sabe o que falta.

**F-01-3 — UX — a linha do cliente na lista de Cadastros não abre o cliente.**
Tela: Cadastros › Clientes. Código e nome não são clicáveis; as únicas ações são
"Editar" e um menu "⋯" que só oferece "Inativar". Abrir a visão 360° exige saber
que existe outra tela ("Consulta de Cliente"), em outro grupo do menu.

**F-01-4 — UX — os cadastros ficam no fim de um menu que exige rolagem.**
Na resolução de trabalho (1280×720) o grupo CADASTROS (Clientes, Fornecedores,
Itens, Produtos) só aparece depois de rolar a navegação lateral.

**F-01-5 — OBSERVATION — "Cadastrada em" mostra a data da importação.**
CLI-000001 exibe "Cadastrada em 07/09/2026, 06:01:20" — o instante da carga, não
a entrada real do cliente. As datas de negócio (entrada de projeto 26/01/2022)
foram preservadas corretamente.

**Notas A–J:** A 4 · B 4 · C 4 · D 5 · E 2 · F 4 · G 5 · H 4 · I — · J 4.

---

## E2E-02 — Formulação completa

**Objetivo:** montar uma formulação com vários componentes, cobrindo quantidade
física direta, pureza, doses por embalagem e ativação.

**Passos:** Formulação de PROD-000215 → rascunho V1 → modo "Por dose" → Doses por
embalagem 60 → 3 componentes → ajuste de pureza no terceiro → tentativa inválida
→ correção → Salvar rascunho → **Ativar versão**.

**Dados:** base 1 un, 60 doses. MP-000365 Cafeína 200 mg/dose (física informada);
MP-000120 Celulose microcristalina 101 253 mg/dose (física); MP-000167 Taurina
100 mg/dose teórica com **pureza 98 %**.

**Resultado: PASS.**

### Conferência numérica

| Grandeza | Esperado (conta independente) | Observado | Diferença |
|---|---|---|---|
| Cafeína, físico por unidade | 200 mg × 60 = 12 000 mg = **0,012 kg** | 0,012 kg | 0 |
| Celulose, físico por unidade | 253 mg × 60 = 15 180 mg = **0,01518 kg** | 0,01518 kg | 0 |
| Taurina sem ajuste | 100 mg × 60 = **0,006 kg** | 0,006 kg | 0 |
| Taurina com pureza 98 % | (100 ÷ 0,98) × 60 = 6 122,448979… mg = **0,006122448979 kg** | 0,006122 kg (6 casas) | arredondamento de exibição |
| Custo estimado da Cafeína | 0,0002 kg × R$ 700,00/kg = **R$ 0,14** | R$ 0,14 | 0 |
| Custo estimado da Taurina | 0,0001 kg × R$ 64,50/kg = R$ 0,00645 → **R$ 0,01** | R$ 0,01 | 0 |

### Happy path — o que funcionou bem

- Trocar para "Por dose" fez aparecer "Doses por embalagem *" com a explicação
  certa: *"Há componentes calculados por dose. Sem este número a formulação não
  pode ser ativada — e a quantidade de material não existe."*
- O painel de ajustes previne o erro clássico de dupla correção: *"Não marque a
  correção se a quantidade informada já estiver corrigida — ela seria aplicada
  duas vezes."*
- A ativação pede confirmação explícita, dizendo o que é irreversível.
- Componente sem referência de custo aparece como "Sem referência de custo", a
  qualidade vira "Parcial" e a tela diz: *"O subtotal conhecido (R$ 0,15) não
  representa o custo total da fórmula."* Ausência nunca virou R$ 0,00.

### Negative path

**N-02-1 — pureza com 8 casas decimais — REJEITADA CORRETAMENTE.**
Digitado `98,12345678`. `PATCH /formulation-versions/:id` → **HTTP 400**, campo
com `aria-invalid`, mensagem por `aria-describedby`:
*"MP-000167 — Valor com precisão acima do suportado: no máximo 6 casas
decimais."* É exatamente a regra §58. Melhor negativa observada na rodada.

### Findings

**F-02-1 — MEDIUM — "Equivalente estoque" muda de significado entre rascunho e
versão ativa.**
Tela: Formulação, coluna "EQUIVALENTE ESTOQUE E FÍSICO POR UNIDADE".
Repro: com o rascunho aberto, MP-000365 mostra `Equiv. 0,012 kg`. Depois de
ativar, a MESMA linha, sem nenhuma alteração de dado, mostra `Equiv. 0,0002 kg`.
Esperado: o mesmo rótulo, o mesmo número.
Observado: em edição o "Equiv." é o total por unidade acabada; em leitura é a
quantidade declarada convertida para a unidade de estoque (por dose).
Impacto: dois números com 60× de diferença sob o mesmo rótulo, e o usuário não
tem como saber qual está vendo.

**F-02-2 — MEDIUM — a tabela de custo estimado usa a quantidade POR DOSE, sem
dizer.**
Na mesma tela, a tabela de componentes mostra `0,012 kg` (físico por unidade
acabada) e a tabela "Custo estimado de materiais" mostra `0,0002 kg / 200 mg`
para o MESMO componente. O cabeçalho é "QUANTIDADE" nos dois casos, e os números
diferem por 60×. Nada na tela diz que uma é por dose e a outra por unidade.
Nota: "Custo estimado da base (1 un)" ficou "Indisponível" porque MP-000120 não
tinha referência, então a soma não pôde ser conferida contra o total. O motor
autoritativo de custo industrial (E2E-04) usa a quantidade FÍSICA corrigida
(6,122449 kg de Taurina), então o desvio é de apresentação nesta tela, não do
cálculo.

**F-02-3 — UX — a tabela de componentes não cabe na largura de trabalho.**
Medido no container: `clientWidth` 914 px, `scrollWidth` 1045 px — 131 px de
rolagem horizontal em 1280×720. A coluna cortada é justamente
"EQUIVALENTE ESTOQUE E FÍSICO POR UNIDADE", que é o número que o usuário precisa
conferir.

**Notas A–J:** A 4 · B 3 · C 5 · D 4 · E 5 · F 3 · G 4 · H 4 · I — · J 4.

---

## E2E-03 — Template → Formulação

**Objetivo:** provar que aplicar um template cria cópia independente.

**Passos:** Produção › Templates de Formulação → FT-000001 (registro dos valores
originais) → Cadastros › Produtos › Novo produto → **PROD-000216 / PA-000216**
para CLI-000002 → Formulação → "Usar template da biblioteca" →
revisão → "Usar este template" → alteração da cópia → Salvar rascunho →
volta ao template para conferir.

**Resultado: PASS.**

### Conferência numérica

| Grandeza | Esperado | Observado | Diferença |
|---|---|---|---|
| Cafeína copiada, físico/unidade | 0,0002 kg × 60 = **0,012 kg** | 0,012 kg | 0 |
| Cafeína depois da alteração | 0,00025 kg × 60 = **0,015 kg** | 0,015 kg | 0 |
| Custo da cafeína alterada | 0,00025 × R$ 700,00 = R$ 0,175 → **R$ 0,18** | R$ 0,18 | 0 (ROUND_HALF_UP) |
| Template depois da alteração da cópia | **0,0002 kg, intacto** | 0,0002 kg | 0 |

### Happy path — o que funcionou bem

- A tela de templates declara a semântica antes de qualquer clique: *"Usar um
  template cria uma cópia independente na formulação do produto — alterar o
  template depois não muda nenhuma formulação já criada."*
- Existe um passo de **revisão** antes de aplicar, mostrando base, modo, doses e
  os quatro componentes com quantidade e unidade.
- A cópia nasce com a proveniência escrita no topo: *"Criada a partir de
  FT-000001 · V1 — EXEMPLO — Cafeína 60 cápsulas"*.
- No template, o contador de formulações derivadas subiu de 0 para 1.
- A versão ativa do template é somente leitura: *"Versão ativa é histórica: para
  alterar, crie uma nova versão."*

### Findings

**F-03-1 — MEDIUM — o custo estimado não acompanha o salvamento.**
Tela: Formulação em rascunho, bloco "Custo estimado de materiais".
Repro: alterar a cafeína de 0,0002 para 0,00025 kg e clicar em "Salvar rascunho".
Esperado: ou o bloco atualiza, ou ele diz que se refere ao último salvamento.
Observado: continua exibindo `0,0002 kg` e `R$ 0,14` **depois de salvar**. Só
após recarregar a página passa a `0,00025 kg` e `R$ 0,18`. Não há rótulo de
"prévia" nem de "gravado" — é a situação que §54 proíbe.
Impacto: o usuário confere o custo pelo número errado, sem nenhum aviso.

**F-03-2 — LOW — a coluna ORIGEM do histórico de versões fica vazia.**
No Histórico de versões da formulação de PROD-000216, a V1 criada a partir de
FT-000001 aparece com ORIGEM = "—", embora o detalhe da versão mostre a
proveniência corretamente.

**Notas A–J:** A 5 · B 5 · C 5 · D 3 · E 5 · F 4 · G 5 · H 4 · I — · J 5.

---

## E2E-04 — Precificação

**Objetivo:** montar a cadeia econômica pela UI e conferir a aritmética do preço.

**Passos:** Custos industriais de PROD-000215 → "Usar template" → revisão de
TEC-000001 → **EC-000001 V1 criada e ativada** → "Calcular custo" → tentativa de
salvar custo incompleto → correção pelo recebimento real (E2E-06) → recálculo →
**CALC-000002 salvo** → "Criar precificação" → **PREC-000001 V1** → tentativa
inválida de faixa → faixa válida → **precificação ativada**.

**Resultado: PASS.**

### Conferência numérica — cadeia inteira

Base 1.000 un. Tarifas sintéticas do pacote de exemplos; materiais pela seleção
canônica de fonte.

| Grandeza | Esperado (conta independente) | Observado | Diferença |
|---|---|---|---|
| Energia derivada | 2,5×2 + 3,0×5 + 1,2×2 = **22,4 kWh** | 22,4 kWh | 0 |
| Cafeína | 0,012 kg/un × 1000 = 12 kg × R$ 700,00 = **R$ 8.400,00** | R$ 8.400,00 | 0 |
| Celulose | 15,18 kg × R$ 41,80 = 634,524 → **R$ 634,52** | R$ 634,52 | 0 |
| Taurina | 6,122449 kg × R$ 64,50 = 394,8979 → **R$ 394,90** | R$ 394,90 | 0 |
| Materiais Veridi | 8.400,00 + 634,52 + 394,90 = **R$ 9.429,42** | R$ 9.429,42 | 0 |
| Mão de obra | 8×38 + 2×45 = **R$ 394,00** | R$ 394,00 | 0 |
| Equipamentos | 2×32 + 5×45 + 2×28 = **R$ 345,00** | R$ 345,00 | 0 |
| Energia | 22,4 × 0,92 = 20,608 → **R$ 20,61** | R$ 20,61 | 0 |
| Custo industrial direto | 9.429,42 + 394 + 345 + 20,61 + 150 = **R$ 10.339,03** | R$ 10.339,03 | 0 |
| Custo industrial total | 10.339,03 + 350 = **R$ 10.689,03** | R$ 10.689,03 | 0 |
| Custo por unidade | 10.689,03 ÷ 1000 = 10,68903 → **R$ 10,69** | R$ 10,69 | 0 |
| **Preço sugerido** | P = C ÷ (1 − 0,30 − 0,05) = 10,68903 ÷ 0,65 = 16,4446615… → **R$ 16,44** | R$ 16,44 | 0 |
| Comissão por unidade | 5 % × 16,4446615 = 0,8222331 → **R$ 0,82** | R$ 0,82 | 0 |
| Contribuição por unidade | 16,4446615 − 0,8222331 − 10,68903 = 4,9333985 → **R$ 4,93** | R$ 4,93 | 0 |
| Margem resultante | 4,9333985 ÷ 16,4446615 = **30 %** | 30 % | 0 |
| Markup | (16,4446615 − 10,68903) ÷ 10,68903 = 53,8467 % → **53,85 %** | 53,85 % | 0 |
| Receita da faixa | 1000 × 16,4446615 = **R$ 16.444,66** | R$ 16.444,66 | 0 |
| Contribuição total | 1000 × 4,9333985 = **R$ 4.933,40** | R$ 4.933,40 | 0 |

**A precisão foi preservada ponta a ponta, e isso é demonstrável.** Se o motor
tivesse usado o custo unitário ARREDONDADO (R$ 10,69) em vez do valor cheio
(10,68903), o preço sugerido seria 10,69 ÷ 0,65 = 16,44615 → **R$ 16,45**. A tela
mostra R$ 16,44. O mesmo vale para a receita: 1000 × R$ 16,44 daria
R$ 16.440,00, e a tela mostra R$ 16.444,66. Nenhum arredondamento intermediário
entrou na conta.

### Happy path — o que funcionou bem

- O template de estrutura declara a fronteira do domínio antes de aplicar: "O
  template define o uso dos recursos. As tarifas — valor da hora, da energia —
  vêm do cadastro na data de cada cálculo, e não são copiadas para cá."
- Salvar um custo incompleto pede confirmação e **nomeia o que está em aberto**:
  "Congelar um custo incompleto? … O que está em aberto: MP-000120: sem custo
  conhecido." Com "Voltar e completar" ao lado de "Salvar assim mesmo".
- Com custo parcial, CUSTO/UNIDADE fica travessão. Não inventa um unitário
  dividindo um total que não existe.
- A seleção de fonte funcionou como §53 manda: assim que o recebimento real
  entrou, MP-000120 passou de "Sem referência de custo" para **"Compra real ·
  média 30 dias"**, na frente da referência de mercado.
- A troca de base do rascunho mostra exatamente o que muda: "Cálculo de custo:
  CALC-000001 → CALC-000002 · Qualidade do custo: Parcial → Completo — com
  estimativas".
- A prévia da faixa é rotulada como §54 exige: "Prévia: nada foi gravado.
  'Adicionar faixa' grava esta faixa com estes valores, recalculados pelo
  servidor."

### Negative path

**N-04-1 — margem + comissão maior ou igual a 100 % — REJEITADA CORRETAMENTE.**
Margem 70 % + comissão 35 % = 105 %. A prévia respondeu antes de qualquer
gravação: "Margem somada à comissão atinge 100% — não existe preço que
satisfaça." Forçando "Adicionar faixa", `POST /pricing-versions/:id/tiers`
respondeu **400** e nenhuma faixa foi criada.

### Findings

**F-04-1 — LOW — a mensagem diz "atinge 100%" quando o valor passa de 100 %.**
Com 70 % + 35 % = 105 %, o texto exibido é "atinge 100%". Correto no efeito,
impreciso no enunciado.

**F-04-2 — UX — ativar a estrutura de custos não pede confirmação; ativar a
formulação pede.** "Ativar estrutura" (EC-000001) executou direto; "Ativar
versão" (formulação) e "Ativar precificação" abrem diálogo. As três ações têm o
mesmo peso — a partir dali a versão vira histórico e não se edita mais.

**Notas A–J:** A 3 · B 4 · C 5 · D 4 · E 5 · F 5 · G 5 · H 4 · I 4 · J 4.

---

## E2E-06 — Compra → Recebimento → Qualidade

**Objetivo:** ciclo de aquisição com recebimento parcial, lote e liberação.

**Passos:** Compras › Ordens de Compra → "+ Nova OC" → FOR-000005 ADICEL →
MP-000120, 50 kg a R$ 42,3579 → Salvar rascunho → **Confirmar OC** →
"Receber materiais" → tentativa inválida (80 kg) → recebimento parcial de 30 kg
→ **REC-000003** → Lotes → **LT-20260907-000001** → Posição de Estoque →
Liberar lote → Posição de Estoque de novo.

**Resultado: PASS.**

### Conferência numérica

| Grandeza | Esperado | Observado | Diferença |
|---|---|---|---|
| Total da linha da OC | round(50 × 42,3579; 2) = round(2117,895) = **R$ 2.117,90** | R$ 2.117,90 | 0 (ROUND_HALF_UP, §61) |
| Preço unitário preservado | **R$ 42,3579** (4 casas, não cortado para 42,36) | R$ 42,3579 | 0 |
| Saldo em aberto após 30 kg | 50 − 30 = **20 kg** | "Em compra 20" | 0 |
| Físico do lote | **30 kg** | 30 kg | 0 |
| Disponível ANTES da liberação | **0 kg** | 0 kg, com "30 kg aguardando liberação da Qualidade" | 0 |
| Disponível DEPOIS da liberação | **30 kg** | 30 kg | 0 |
| Custo de aquisição do lote | **R$ 41,80 / kg**, origem "Real" | R$ 41,80 · Real | 0 |

### Happy path — o que funcionou bem

- O campo de custo separa preço da OC de custo real, com o texto certo: "Preço
  previsto da OC: R$ 42,3579 / kg. Opcional — o recebimento não depende do custo.
  Informe apenas o custo realmente praticado; o preço da OC nunca é assumido como
  custo real."
- Confirmar a OC e confirmar o recebimento pedem confirmação nomeando o que fica
  congelado e o que não pode ser apagado.
- O lote nasce **"Aguardando liberação"** e a Posição de Estoque explica o zero
  na própria linha, em vez de mostrar um zero mudo.
- A tela do lote separa qualidade operacional de qualidade documental: "Laudo/CoA
  é independente do status operacional: aprovar o documento não libera o lote."
- Rastreabilidade completa no lote: REC-000003, OC-000001, FOR-000005, e o lote
  do fornecedor preservado à parte do lote interno.
- Liberação registrada com autor e hora: "Liberado 07/09/2026, 07:04:26 por
  Administrador local".

### Negative path

**N-06-1 — receber mais do que o saldo em aberto — REJEITADA CORRETAMENTE.**
80 kg contra 50 kg em aberto. `POST /purchase-orders/:id/receipts` respondeu
**400** com "Quantidade recebida excede o saldo em aberto da linha: MP-000120".
Nenhum lote foi criado.

### Findings

**F-06-1 — MEDIUM/UX — o excesso só é detectado na confirmação.**
A tela mostra "Pedido: 50 kg · Recebido: 0 kg · Aberto: 50 kg" imediatamente
acima do campo, mas digitar 80 não produz aviso nenhum. O usuário preenche lote,
validade e custo, passa pelo diálogo de irreversibilidade e só então é recusado.
A tela de Expedição (#8B) já bloqueia ao vivo nessa mesma situação.

**F-06-2 — LOW — a mensagem de erro fica na tela depois de corrigida.**
Depois da recusa, alterar a quantidade para 30 não limpa o alerta "Quantidade
recebida excede o saldo em aberto da linha: MP-000120"; ele continua visível até
a próxima submissão.

**F-06-3 — OBSERVATION — tentativas recusadas consomem número de documento.**
O recebimento efetivado saiu como **REC-000003**: as duas tentativas rejeitadas
consumiram REC-000001 e REC-000002. É comportamento normal de sequence, mas a
numeração de documento fica com buracos e alguém vai perguntar por quê.

**Notas A–J:** A 5 · B 5 · C 5 · D 5 · E 3 · F 5 · G 5 · H 4 · I 4 · J 5.

---

## E2E-05 — Orçamento → Pedido

**Objetivo:** negociar, congelar e converter em pedido sem reescrever preço.

**Passos:** PROJ-000249 → "Criar nova versão" → **ORC-000010 V1** → adicionar
PROD-000215 → quantidade 1000 → "Usar precificação" → escolher a faixa →
validade e prazo → "Enviar ao cliente" → tentativa de editar documento congelado
→ "Registrar aceite" → "Aprovar projeto" → **"Gerar pedido a partir do orçamento
aceito"** → **PED-000001** → tentativa de alterar produto/preço → "Confirmar
pedido".

**Resultado: PASS.**

### Conferência numérica

| Grandeza | Esperado | Observado | Diferença |
|---|---|---|---|
| Preço da faixa oferecido | 16,4446615… fechado em 4 casas = **R$ 16,4447** | R$ 16,4447 | 0 (fronteira §60) |
| Total da linha do orçamento | round(1000 × 16,4447; 2) = **R$ 16.444,70** | R$ 16.444,70 | 0 (§55) |
| Total da proposta | **R$ 16.444,70** | R$ 16.444,70 | 0 |
| Plano de pagamento à vista | **R$ 16.444,70** | R$ 16.444,70 | 0 |
| Total acordado no Pedido | **R$ 16.444,70** — o subtotal da PROPOSTA, não um recálculo | R$ 16.444,70 | 0 (§15/§55) |

**Diferença deliberada entre dois documentos, e vale registrar:** a Precificação
mostra RECEITA de **R$ 16.444,66** (1000 × 16,4446615, precisão técnica cheia) e
o Orçamento mostra **R$ 16.444,70** (1000 × 16,4447, preço comercial fechado em
4 casas). Os R$ 0,04 são a fronteira técnico → comercial de §60, não um erro —
mas nenhuma das duas telas diz isso, e quem comparar vai perguntar.

### Happy path — o que funcionou bem

- O seletor de faixa mostra a regra junto: "A quantidade da linha precisa
  corresponder exatamente à faixa — o sistema não escolhe faixa aproximada nem
  interpola preço."
- Enviar pede confirmação explicando o congelamento: "Depois disso a versão fica
  somente leitura: renegociar exige criar uma versão nova."
- Aprovar o projeto lista nominalmente o que será aprovado: "A proposta aceita
  (ORC-000010 · V1) contém 1 de 1 produto deste projeto."
- O Pedido nasce com a cadeia inteira à vista: "ORIGEM COMERCIAL — O acordo que
  originou este pedido, congelado. Preço novo exige nova negociação", com
  Orçamento, Projeto, situação, total e forma de pagamento.
- A proveniência do preço viaja junto: "R$ 16,4447 · PREC-000001 · faixa 1000 un".

### Negative path

**N-05-1 — editar orçamento enviado — BLOQUEADO CORRETAMENTE.** Depois do envio,
validade, prazo, desconto, forma de pagamento e observações ficam todos
`disabled`. Não há caminho de edição pela tela.

**N-05-2 — alterar produto, quantidade ou preço no Pedido — IMPOSSÍVEL POR
CONSTRUÇÃO.** O Pedido não tem campo editável de produto/quantidade/preço: só
cliente e data de entrega enquanto rascunho. A tela diz por quê: "Produtos e
quantidades vieram do orçamento ORC-000010. Para mudar, renegocie criando uma
nova versão do orçamento."

### Findings

Nenhum defeito. Um ponto de atenção registrado acima (os R$ 0,04 da fronteira
§60 aparecem sem explicação em nenhuma das duas telas) — classificado como
**F-05-1 — UX**.

**Notas A–J:** A 4 · B 5 · C 5 · D 5 · E 5 · F 5 · G 4 · H 5 · I 4 · J 5.

---

## E2E-07 — Pedido → Planejamento → OP

**Objetivo:** ver o pedido virar necessidade, reserva e ordem de produção.

**Passos:** confirmação de PED-000001 → o **Plano de Atendimento** aparece
sozinho → leitura da necessidade de material → "Ver sugestão de compra" →
"Aplicar Plano de Atendimento" → **OP-000001** criada em rascunho.

**Resultado: PASS.**

### Conferência numérica

Necessidade para 1.000 un, calculada da formulação V1:

| Material | Esperado | Observado | Diferença |
|---|---|---|---|
| MP-000365 Cafeína | 0,012 kg/un × 1000 = **12 kg** | 12 kg | 0 |
| MP-000120 Celulose | 0,01518 × 1000 = **15,18 kg** | 15,18 kg | 0 |
| MP-000167 Taurina (com pureza) | 0,006122448979 × 1000 = **6,122449 kg** | 6,122449 kg | 0 |
| Falta de Celulose | 15,18 − 30 disponíveis = **0** | 0 | 0 |
| Situação do produto | 0 em estoque → **Requer produção** | Requer produção | 0 |

O plano usa a quantidade FÍSICA corrigida pela pureza, não a teórica.

### Happy path — o que funcionou bem

- Aplicar o plano avisa exatamente o que vai e o que **não** vai acontecer:
  "OPs serão criadas em rascunho para o déficit. Nenhuma OP será liberada
  automaticamente e nenhuma compra será criada automaticamente."
- A sugestão de compra respeita a ambiguidade de §53 em vez de escolher sozinha:
  "Vários homologados e nenhum preferencial — escolha o fornecedor", listando os
  sete fornecedores homologados reais do legado.
- "falta física e compra sugerida são conceitos diferentes" dito na própria
  seção.

### Findings

**F-07-1 — MEDIUM — quantidade crua e com separador errado na sugestão de
compra.**
Tela: Pedido › SUGESTÃO DE COMPRA.
Observado: a necessidade da Taurina aparece como **`6.122448979592`** — doze
casas decimais e **ponto** como separador decimal — enquanto o mesmo número, na
tabela logo acima da mesma página, aparece como `6,122449 kg`. É a única string
com decimal cru da tela.
Impacto: número ilegível para quem vai comprar, e o ponto sugere "6 mil" a um
leitor brasileiro.

**F-07-2 — MEDIUM — a coluna DISPONÍVEL da OP e a da Posição de Estoque
discordam.**
Depois de liberar a OP, a tela da OP mostra, para a Cafeína: FÍSICO 15,
RESERVADO 12, **DISPONÍVEL 15**. A Posição de Estoque, no mesmo instante:
Físico 15, Reservado 12, **Disponível 3**. Mesmos três rótulos, dois números.
Na mesma linha da OP a sugestão FEFO/FIFO diz "→3", ou seja, usa o outro
significado. Se a intenção é "disponível incluindo a minha própria reserva", o
rótulo não diz isso.

**Notas A–J:** A 5 · B 4 · C 5 · D 5 · E 5 · F 3 · G 2 · H 5 · I — · J 4.

---

## E2E-08 — Produção completa

**Objetivo:** executar a OP inteira pela tela, com caminho inválido.

**Passos:** OP-000001 → "Planejar OP" → "Liberar OP" (reserva FEFO/FIFO) →
Picking dos três lotes → tentativa de consumo acima do reservado → consumo dos
três → tentativa de concluir sem apontamento → "Registrar produção" 1.000 un →
"Concluir OP".

**Resultado: PASS, com um defeito HIGH no caminho.**

### Conferência numérica

| Grandeza | Esperado | Observado | Diferença |
|---|---|---|---|
| Cafeína consumida | **12 kg** × R$ 672,35 = **R$ 8.068,20** | R$ 8.068,20 | 0 |
| Celulose consumida | **15,18 kg** × R$ 41,80 = 634,524 → **R$ 634,52** | R$ 634,52 | 0 |
| Taurina consumida | **6,122448979592 kg** × R$ 61,90 = 378,9796 → **R$ 378,98** | R$ 378,98 | 0 |
| Materiais realizados | 8.068,20 + 634,52 + 378,98 = **R$ 9.081,70** | R$ 9.081,70 | 0 |
| Custos padrão aplicados | 394 + 345 + 20,61 + 150 + 350 = **R$ 1.259,61** | R$ 1.259,61 | 0 |
| Custo industrial da produção | 9.081,70 + 1.259,61 = **R$ 10.341,31** | R$ 10.341,31 | 0 |
| Custo por unidade produzida | 10.341,31 ÷ 1000 = **R$ 10,34** | R$ 10,34 | 0 |
| Custo material / unidade | 9.081,70 ÷ 1000 = **R$ 9,08** | R$ 9,08 | 0 |

Qualidade do custo: **"Real"** para material (compras reais) e **"Híbrido:
materiais reais + recursos padrão"** para o total — rótulo exato.

### Happy path — o que funcionou bem

- Liberar avisa o que faz e o que não faz: "Os materiais disponíveis serão
  reservados para esta OP usando a ordem FEFO/FIFO. O estoque físico ainda não
  será baixado."
- Picking e consumo são etapas separadas, com a diferença escrita: "Conferência
  física … nunca altera estoque" contra "Registra quanto efetivamente entrou na
  produção — baixa o estoque físico".
- Contador de reconciliação visível o tempo todo ("0 de 3", "3 de 3").
- Cada conferência e cada consumo grava autor e hora.
- Número oficial da OP (001/26) só nasce na liberação.
- Ao concluir, o lote de produto acabado (LT-20260907-000004) entra na trilha do
  cabeçalho: PEDIDO › OP › PRODUTO › LOTE.

### Negative path

**N-08-1 — consumir acima do reservado — BLOQUEADO AO VIVO, com saída.**
Digitando 20 kg contra 12 reservados, o botão desabilita e a tela diz: *"Máximo
disponível nesta reserva: 12 kg. Para consumir acima disso, use 'Adicionar
consumo extra'."* Impede o erro **e** ensina o caminho legítimo.

**N-08-2 — concluir sem apontamento — BLOQUEADO.** "Concluir OP" fica desabilitado
com "Registre ao menos um apontamento de produção para concluir."

### Findings

**F-08-1 — HIGH — a quantidade que a tela mostra é a única que ela recusa.**
Tela: Ordem de Produção › CONSUMO REAL.
Reprodução: OP com componente de quantidade não redonda (Taurina, reserva real
`6,122448979592 kg`). A coluna RESERVADO mostra **`6,122449 kg`** (arredondado
para 6 casas). Digitar exatamente `6,122449` no campo "CONSUMIR AGORA":
- esperado: aceito, é o valor impresso na tela;
- observado: **recusado** — "Máximo disponível nesta reserva: 6,122449 kg" — e o
  botão "Confirmar consumo" fica desabilitado.

Medido valor a valor, com o botão como sonda:

| Digitado | Confirmar consumo |
|---|---|
| `6,122449` (o valor exibido) | **desabilitado** |
| `6,12244897` | habilitado |
| `6,1224489` | habilitado |
| `6,122448` | habilitado |
| `6,122448979592` (a reserva real) | habilitado |

O display arredonda **para cima** (6,122448979592 → 6,122449) e a validação
compara contra o valor não arredondado. O único número que o operador não pode
digitar é o que está escrito na frente dele, e a mensagem de erro repete esse
mesmo número como se fosse o limite — o que torna o erro insolúvel sem adivinhar
casas que a tela nunca mostrou.

Impacto: trava o fluxo principal de produção para qualquer componente com mais
de seis casas — isto é, para toda formulação com correção de pureza ou overage.
A única saída oferecida ("Adicionar consumo extra") registra como EXTRA um
consumo que é exatamente o planejado, contaminando o histórico de variação.

**F-08-2 — MEDIUM — a OP em rascunho declara que o produto não tem item de
produto acabado válido.**
Tela: Ordem de Produção em Rascunho, seção PRODUTO.
Observado: o campo "Produto *" aparece **vazio** e abaixo dele a frase "Produto
sem item de produto acabado válido." — numa OP criada pelo Plano de Atendimento,
cujo cabeçalho já mostra PROD-000215 e cuja necessidade de materiais foi
calculada da formulação desse produto. PA-000215 existe.
Depois de "Planejar OP" o campo passa a exibir "PROD-000215 — E2E-01 Cafeina 60
caps" corretamente.
Impacto: não bloqueia, mas afirma um defeito de cadastro que não existe, na tela
mais crítica do fluxo industrial.

**F-08-3 — LOW — campos de consumo sem rótulo acessível.** Os três campos
"CONSUMIR AGORA" não têm `id`, `name`, `aria-label` nem `<label>` associado —
só o cabeçalho da coluna. Leitor de tela não os identifica.

**Notas A–J:** A 5 · B 4 · C 5 · D 5 · E 4 · F 5 · G 1 · H 5 · I 4 · J 3.

---

## E2E-09 — Expedição → Faturamento

**Objetivo:** expedir parcialmente e faturar o que saiu.

**Passos:** liberar o lote de produto acabado → PED-000001 › "Reservar
disponível" → "Preparar Expedição" → **EXP-000001** → tentativa de expedir acima
do pedido → expedição parcial de 400 un → conferência do lote → "Confirmar
expedição" → "Preparar faturamento" → **FAT-000001** → "Emitir faturamento".

**Resultado: PASS.**

### Conferência numérica

| Grandeza | Esperado | Observado | Diferença |
|---|---|---|---|
| Expedindo agora (prévia) com 400 | **400 un**, restante **600 un** | 400 / 600 | 0 |
| Reservado após expedir 400 | 1000 − 400 = **600 un** | 600 un | 0 |
| Já expedido (total) | **400 un**, falta expedir **600 un** | 400 / 600 | 0 |
| Total do faturamento | 400 × R$ 16,4447 = **R$ 6.577,88** | R$ 6.577,88 | 0 |
| Saldo do lote de PA | 1000 produzidos − 400 expedidos = **600 un físico**, 600 reservado, **0 disponível** | 600 / 600 / 0 | 0 |

### Happy path — o que funcionou bem

- A prévia de expedição (#8B) mostra as cinco grandezas ao vivo: quantidade do
  pedido, já expedido antes desta, falta expedir, expedindo agora e restante
  após esta expedição.
- Conferência de lote é etapa própria e o contador "Lotes conferidos: 0/1 → 1/1"
  gate a confirmação.
- A confirmação diz o que é irreversível: "A confirmação registrará a saída
  física do estoque e não poderá ser cancelada depois."
- O faturamento herda quantidade da expedição e diz que não é fiscal:
  "Quantidades vêm da expedição confirmada — nunca editáveis. Só o preço
  unitário é informado aqui" e "não emite Nota Fiscal e não movimenta estoque".
- Trilha completa no cabeçalho: PEDIDO › EXPEDIÇÃO › FATURAMENTO.

### Negative path

**N-09-1 — expedir acima do pedido — BLOQUEADO AO VIVO, com dois avisos.**
Digitando 1500 contra 1000: *"Acima do que falta expedir em 500 un — corrija a
separação"* e, na linha do lote, *"Máximo 1000 un — é o que está reservado"*.
Botão "Confirmar expedição" desabilitado.

### Findings

**F-09-1 — MEDIUM/UX — beco sem saída entre produzir e expedir.**
Tela: Pedido › RESERVAR PRODUTO ACABADO.
Reprodução: com a OP **Concluída** e 1.000 un produzidas, a linha mostra
"FALTA RESERVAR 1000 · DISPONÍVEL AGORA 0" e o botão "Reservar disponível"
desabilitado, **sem nenhuma explicação**. A causa é legítima — o lote de produto
acabado nasce "Aguardando liberação" porque o produto exige liberação da
Qualidade — mas essa palavra não aparece em lugar nenhum da tela do Pedido, nem
há link para o lote pendente. A Posição de Estoque, na mesma situação, escreve
"aguardando liberação da Qualidade" na própria linha.
Impacto: quem acabou de produzir mil unidades vê zero disponível e um botão
morto, sem saber o que fazer.

**Notas A–J:** A 4 · B 5 · C 4 · D 5 · E 5 · F 5 · G 5 · H 5 · I 4 · J 4.

---

## E2E-10 — Rastreabilidade + cliente + documentos

**Objetivo:** percorrer a cadeia inteira a partir do cliente, sem perder
contexto.

**Passos:** Consulta de Cliente › CLI-000001 → Resumo → Projetos → Produtos →
Produção → Faturamentos → lote de produto acabado → expedições do lote.

**Resultado: PASS.**

### O que a cadeia mostrou

| Onde | O que apareceu |
|---|---|
| Resumo do cliente | Projetos 5 · Pedidos 1 · Pedidos em aberto 1 · Produção 1 · Faturamentos 1 |
| Projetos | PROJ-000249 · E2E-01 Cafeina 60 caps · **Aprovado** · produto resultante preenchido |
| Produção | OP-000001 · PROD-000215 · PED-000001 · 1000/1000 · Concluída |
| Faturamentos | FAT-000001 · PED-000001 · Emitido · 400 · **R$ 6.577,88** |
| Lote LT-20260907-000004 | Origem Produção · Produzido por OP-000001 · Lote Veridi E2E08-001-26 · Físico 600 · Reservado 600 · Disponível 0 |
| Expedições do lote | EXP-000001 → PED-000001 → CLI-000001 · 400 un · Confirmada |

Todos os valores conferem com os documentos de origem. A cadeia
cliente → projeto → produto → orçamento → pedido → OP → lote → expedição →
faturamento fecha nos dois sentidos.

### Findings

**F-10-1 — resolução de F-01-1.** Depois da aprovação, PROJ-000249 passou a
mostrar o produto na coluna PRODUTO da consulta. Isso confirma que a coluna é o
**produto resultante** (que só nasce na aprovação), e não "os produtos do
projeto". A contradição de F-01-1 permanece nas duas pontas: projeto em
desenvolvimento com produtos mostra "—", e projeto legado com produto resultante
mostra o nome enquanto o detalhe diz "Nenhum produto associado a este projeto".
O que falta é o rótulo distinguir os dois fatos.

**Notas A–J:** A 5 · B 4 · C 5 · D — · E — · F 5 · G 5 · H 5 · I 3 · J 5.

---

# Consolidado

## Resultado dos dez cenários

| E2E | Cenário | Resultado |
|---|---|---|
| 01 | Cliente → Projeto → Produto | **PASS** |
| 02 | Formulação completa | **PASS** |
| 03 | Template → Formulação | **PASS** |
| 04 | Precificação | **PASS** |
| 05 | Orçamento → Pedido | **PASS** |
| 06 | Compra → Recebimento → Qualidade | **PASS** |
| 07 | Pedido → Planejamento → OP | **PASS** |
| 08 | Produção completa | **PASS** (com defeito HIGH no caminho) |
| 09 | Expedição → Faturamento | **PASS** |
| 10 | Rastreabilidade + cliente + documentos | **PASS** |

**10 PASS · 0 FAIL · 0 BLOCKED_BY_DEFECT.**

## Caminhos negativos executados

Onze recusas testadas, todas corretas no efeito:

| # | Cenário | Tentativa | Resposta |
|---|---|---|---|
| N-01-1 | 01 | Criar projeto sem cliente e sem nome | Botão desabilitado; nada criado — mas sem mensagem (F-01-2) |
| N-02-1 | 02 | Pureza com 8 casas decimais | HTTP 400 + campo marcado + mensagem nomeando componente e regra |
| N-03-1 | 03 | Editar versão ativa de template | Somente leitura, com a razão escrita na tela |
| N-04-1 | 04 | Margem 70 % + comissão 35 % | Prévia recusa antes de gravar; `POST /tiers` → 400 |
| N-05-1 | 05 | Editar orçamento já enviado | Todos os campos `disabled` |
| N-05-2 | 05 | Alterar produto/quantidade/preço no Pedido | Sem campo editável, com a razão escrita |
| N-06-1 | 06 | Receber 80 kg contra 50 em aberto | HTTP 400 nomeando o item; nenhum lote criado |
| N-06-2 | 06 | Usar lote antes da liberação da Qualidade | Disponível 0 com o motivo na linha |
| N-08-1 | 08 | Consumir 20 kg contra 12 reservados | Bloqueio ao vivo + caminho legítimo indicado |
| N-08-2 | 08 | Concluir OP sem apontamento | Botão desabilitado com o motivo |
| N-09-1 | 09 | Expedir 1500 contra 1000 | Dois avisos ao vivo + confirmação desabilitada |

## Findings por severidade

**CRITICAL: 0.**

### HIGH — 1

| ID | E2E | Tela | Resumo |
|---|---|---|---|
| **F-08-1** | 08 | Ordem de Produção › Consumo real | A quantidade reservada exibida (`6,122449 kg`) é arredondada para cima e a validação compara com o valor cheio (`6,122448979592`): digitar exatamente o que a tela mostra é recusado, e a mensagem de erro repete esse mesmo número como limite. Trava o consumo de qualquer componente com mais de 6 casas — ou seja, toda formulação com pureza ou overage |

### MEDIUM — 8

| ID | E2E | Tela | Resumo |
|---|---|---|---|
| **F-08-2** | 08 | OP em rascunho | "Produto sem item de produto acabado válido" numa OP cujo produto tem PA válido; o campo não carrega o valor existente |
| **F-07-2** | 07/08 | OP × Posição de Estoque | Coluna DISPONÍVEL com dois valores para o mesmo instante (15 contra 3) sob o mesmo rótulo |
| **F-07-1** | 07 | Sugestão de compra | `6.122448979592` — 12 casas e ponto decimal, contra `6,122449 kg` na mesma página |
| **F-09-1** | 09 | Pedido › Reservar produto acabado | Botão morto e "DISPONÍVEL AGORA 0" logo após produzir 1.000 un, sem dizer que o lote aguarda a Qualidade |
| **F-03-1** | 03 | Formulação em rascunho | Custo estimado não atualiza ao salvar e não se identifica como prévia nem como gravado (§54) |
| **F-02-1** | 02 | Formulação | "Equivalente estoque" mostra números diferentes em rascunho e em versão ativa, sem mudança de dado |
| **F-02-2** | 02 | Formulação | Duas tabelas da mesma tela mostram o mesmo componente com quantidades 60× diferentes, ambas sob "QUANTIDADE" |
| **F-01-1** | 01/10 | Consulta de Cliente | A coluna PRODUTO (produto resultante) e a lista de produtos do projeto se contradizem nas duas direções |

### LOW — 4

| ID | E2E | Resumo |
|---|---|---|
| **F-04-1** | 04 | "atinge 100%" exibido quando o valor é 105 % |
| **F-06-2** | 06 | Alerta de excesso permanece na tela depois de a quantidade ser corrigida |
| **F-03-2** | 03 | Coluna ORIGEM do histórico de versões vazia numa versão criada de template |
| **F-08-3** | 08 | Campos de consumo sem rótulo acessível |

### UX — 5

| ID | E2E | Resumo |
|---|---|---|
| **F-01-2** | 01 | "Criar projeto" desabilitado sem dizer o que falta |
| **F-01-3** | 01 | Linha do cliente no cadastro não abre o cliente; a visão 360° vive em outro item de menu |
| **F-01-4** | 01 | Grupo CADASTROS exige rolar a navegação em 1280×720 |
| **F-02-3** | 02 | Tabela de componentes com 131 px de rolagem horizontal; a coluna cortada é a do valor derivado |
| **F-04-2** | 04 | "Ativar estrutura" não pede confirmação; ativar formulação e precificação pedem |
| **F-05-1** | 05 | R$ 0,04 de diferença entre Precificação e Orçamento (fronteira §60) sem explicação em nenhuma das telas |
| **F-06-1** | 06 | Excesso no recebimento só detectado na confirmação, depois do diálogo de irreversibilidade |

### OBSERVATION — 2

| ID | E2E | Resumo |
|---|---|---|
| **F-01-5** | 01 | "Cadastrado em" mostra o instante da importação; as datas de negócio do legado foram preservadas |
| **F-06-3** | 06 | Tentativas recusadas consomem número de documento (REC-000001 e 000002 perdidos) |

## O que a auditoria confirmou funcionando

Vale registrar com a mesma clareza dos defeitos:

- **A aritmética está certa em toda a cadeia.** Trinta e nove conferências
  independentes — de `200 mg × 60` até `P = C ÷ (1 − margem − comissão)`, custo
  industrial, expedição parcial e faturamento — bateram **sem uma única
  diferença**.
- **A precisão sobrevive de ponta a ponta, e é demonstrável.** O preço sugerido
  saiu R$ 16,44 (custo cheio 10,68903) e não R$ 16,45 (custo arredondado 10,69);
  a receita saiu R$ 16.444,66 e não R$ 16.440,00.
- **Ausência nunca virou zero.** Custo desconhecido é "Sem referência de custo",
  total incompleto é "Indisponível", e a qualidade do custo é dita em toda tela
  que a usa.
- **A ordem de fontes de custo de §53 funcionou na prática:** a Celulose saiu de
  "Sem referência" para "Compra real · média 30 dias" assim que o recebimento
  entrou, passando à frente da referência de mercado.
- **Toda ação irreversível pede confirmação nomeando o que congela** — com a
  exceção de F-04-2.
- **As mensagens de recusa ensinam o caminho certo**, não só bloqueiam: "use
  'Adicionar consumo extra'", "renegocie criando uma nova versão do orçamento",
  "defina a oferta preferencial em Item × Fornecedor".

## Nota de método

Todos os dez cenários foram executados pela interface, no navegador, contra a
API real por trás das telas. Nenhuma chamada direta de API, nenhum SQL como
asserção de negócio, nenhuma correção de código durante a auditoria.

Uma ressalva de honestidade sobre a automação: parte dos cliques foi despachada
como evento de clique no próprio botão da página (via DOM), e não como
movimento de mouse, porque o painel de navegador estava sendo disputado por
outra tarefa. É a mesma interação da tela — o handler da página é o mesmo, e a
requisição HTTP que sai é a que a UI faria — mas não é um clique físico, e
registrar isso é mais honesto do que omitir.

---

## Apêndice — defeito de carga corrigido durante a rodada

Não é achado de produto: é defeito do carregador de referência de mercado
escrito nesta rodada, encontrado e corrigido antes do fechamento. Fica
registrado porque a causa vale como regra.

**O que aconteceu.** `scripts/veridi-market-reference/load.ts` identificava o
Item pelo `code` (`MP-000372`). Esse código sai de uma **sequence do Postgres, e
cada banco corre a sua**: os mesmos 581 itens foram importados em DEV e em
produção, mas receberam códigos diferentes. A carga em produção gravou os 266
preços nos itens errados — o preço da Taurina foi parar no Mel, o do Ácido
Cítrico no Extrato de alho em pó.

**Por que importa.** Referência manual é o último degrau do seletor canônico de
custo (§53): qualquer CMV ou precificação em produção teria usado o preço de
outro item.

**Correção.** As 266 linhas foram apagadas de produção — todas criadas nessa
mesma carga, todas erradas, e a tabela tinha zero linhas antes da rodada
(backup lógico em `handoff/backups/railway-prod-2026-09-07T13-20.json`). O
carregador passou a resolver por **`externalCode`**, o código da planilha
original, que o importador copia e nunca regenera — e recusa a linha que não o
tenha. Recarregado: DEV 293 e produção 293, conferidos item a item.

**Regra que fica:** carga que identifica registro por código interno grava no
registro errado assim que atravessa ambientes. A chave entre ambientes é o
código de origem, nunca o código gerado.

---

# Triagem do PO — 2026-09-07

Feita depois da auditoria, sobre esta mesma evidência, com leitura de código.
**Nada acima foi alterado**: a evidência original fica como foi registrada,
inclusive onde a triagem a contradiz. A severidade do auditor não é a
severidade final — esta seção diz qual prevaleceu e por quê.

Backlog operacional resultante em [`BACKLOG.md`](BACKLOG.md), seção A.

## Disposição, achado a achado

| ID | Auditor | Final | Disposição | Motivo |
|---|---|---|---|---|
| F-08-1 | HIGH | **HIGH · P0** | ACCEPT | Severidade mantida; **escopo corrigido** — alcança 125 das 212 formulações ativas (59 %), não apenas as com pureza/overage |
| F-02-2 | MEDIUM | **HIGH · P0** | RECLASSIFIED ↑ | Não é rótulo divergente: a aritmética do bloco está errada. Subestima 60× num produto de 60 doses, na direção perigosa |
| F-08-2 | MEDIUM | **HIGH · P1** | RECLASSIFIED ↑ | Atinge 164 dos 214 produtos aprovados (77 %) e afirma um defeito de cadastro que não existe |
| F-06-1 | UX | **MEDIUM · P1** | RECLASSIFIED ↑ | Não é clareza: é validação ausente. O servidor é a única barreira, e só depois do diálogo de irreversibilidade |
| F-06-3 | OBSERVATION | **LOW · P2** | RECLASSIFIED ↑ | Defeito real com correção provada no próprio repositório (`products.service.ts:314`) |
| F-09-1 | MEDIUM | **MEDIUM · P1** | ACCEPT | — |
| F-03-1 | MEDIUM | **MEDIUM · P1** | ACCEPT | Viola §54 ao pé da letra |
| F-02-1 | MEDIUM | **MEDIUM · P1** | ACCEPT | — |
| F-07-1 | MEDIUM | **MEDIUM · P1** | ACCEPT | — |
| F-06-2 | LOW | **LOW · P1** | ACCEPT | Sobe de prioridade, não de severidade: mesmo arquivo e mesmo mecanismo de F-06-1 |
| F-03-2 | LOW | **LOW · P2** | ACCEPT | — |
| F-08-3 | LOW | **LOW · P2** | ACCEPT | — |
| F-04-1 | LOW | **LOW · P3** | ACCEPT | Tamanho maior que a severidade sugere: a mesma condição está escrita três vezes |
| F-01-1 | MEDIUM | **UX · P2** | RECLASSIFIED ↓ | Os dois números estão certos para o que representam; o defeito é o rótulo |
| F-07-2 | MEDIUM | **UX · P2** | RECLASSIFIED ↓ | Divergência deliberada e documentada em `requirement-availability.ts:44` |
| F-01-2 | UX | **UX · P2** | ACCEPT | — |
| F-04-2 | UX | **UX · P2** | ACCEPT | Enunciado corrigido — ver abaixo |
| F-05-1 | UX | **UX · P3** | ACCEPT | — |
| F-01-3 | UX | **UX · P3** | RECLASSIFIED ↓ | Premissa do achado é falsa — ver abaixo |
| F-01-4 | UX | **DEFER** | DEFER | Ordem do menu é deliberada e justificada em `navigation.ts:4` |
| F-02-3 | UX | **DUPLICATE** | DUPLICATE | É o BACKLOG #4, aceito com residual pelo PO em 2026-09-04 |
| F-01-5 | OBSERVATION | **CLOSED** | CLOSED | Sem ação possível |
| F-10-1 | (nota) | **DUPLICATE** | DUPLICATE | É o próprio F-01-1 reconfirmado após a aprovação |

## Onde a triagem contradiz a auditoria

**F-01-3 — a premissa é falsa.** A auditoria registrou que "código e nome não
são clicáveis". `CustomersPage.tsx:212` aplica `table--clickable-rows` e
`:236-244` tem `<tr onClick>` com `tabIndex={0}` e Enter. A linha é clicável,
com teclado, e abre a edição — que contém o link "Consulta completa"
(`customer-form.tsx:369-391`). `git log` confirma que o arquivo não mudou desde
`0134674`: é o mesmo código que a auditoria rodou. Sobra um resíduo legítimo e
menor: a Consulta 360° só é alcançável de dentro do modal de edição.

**F-04-2 — o enunciado estava impreciso.** Não é "estrutura não confirma, as
outras duas confirmam". Estrutura (`IndustrialCostPage.tsx:611`) e Precificação
(`PricingPage.tsx:709`) confirmam **apenas quando o dado está incompleto**, e o
diálogo fala só da pendência. Formulação (`FormulationVersionPage.tsx:1007`)
confirma **sempre** e nomeia o congelamento e o impacto. No caminho comum — dado
completo — duas das três ações irreversíveis não confirmam nada.

**F-02-3 — não é achado novo.** É o BACKLOG #4, medido em 117 px de rolagem
residual e aceito pelo PO em 2026-09-04; a auditoria mediu 131 px na mesma
tabela. Reabrir é rever uma decisão, não corrigir um defeito.

**F-08-1 — a causa não é a que a auditoria supôs.** Não é conflito entre seis e
doze casas: é a **direção** do arredondamento. `formatQuantity` usa
`ROUND_HALF_UP`, correto para dinheiro e errado para um **teto** — arredondar um
limite para cima produz um número exibido maior que o real. O servidor recusaria
igual (`picking.service.ts:432` compara em `Prisma.Decimal` exato): `6,122449` é
genuinamente maior que `6,122448979592`. Não há erro de float em lugar nenhum.

## O que a triagem descobriu além dos achados

**A premissa do roadmap está errada.** `ROADMAP_POST_MVP.md` afirma que
"PREC-UI-05 e PREC-UI-06 já são o comportamento atual" — "modo de edição revela
precisão integral" e "salvar sem alterar preserva casas não exibidas". F-08-1
prova o contrário na tela de consumo. Qualquer trabalho de PREC-UI construído
sobre essa premissa herdaria o defeito.

**O comentário que justifica o corte envelheceu.** `quantity.ts:6` diz "o
domínio guarda quantidade como `Decimal(18,6)`: seis casas é a precisão que o
sistema realmente tem", e `:16` conclui "o corte é em seis casas porque é o que
o banco guarda". Desde o PREC-MIG-A o banco guarda `DECIMAL(24,12)` —
`schema.prisma:3080`. O corte em si continua sendo boa decisão de produto; a
justificativa é que precisa ser reescrita, e o efeito colateral em campo de
entrada é que precisa ser corrigido.

**O mesmo padrão de comparação está em três telas**, uma delas já remendada:

```
apps/web/src/pages/production-orders/ProductionOrderPage.tsx:419
apps/web/src/pages/shipments/ShipmentPage.tsx:626
apps/web/src/pages/customer-orders/CustomerOrderPage.tsx:871   ← com "+ 1e-6"
```

O `1e-6` é a tolerância que `reconciliation.ts:18` recusa por escrito: "NÃO HÁ
TOLERÂNCIA, e isso é deliberado". §66 proíbe a comparação por `Number` para
quantidade. Corrigir só a Ordem de Produção deixaria duas irmãs vivas.

**Três motores para a mesma conta.** "Quantidade por base" tem implementação em
`packages/shared/src/formulation-quantity.ts`, outra à mão em
`apps/api/src/lib/formulation-math.ts`, e um terceiro caminho que usa
`convertUomDecimal` cru como se fosse a conta. O comentário do pacote
compartilhado diz o porquê de isso ser proibido: "duas contas para o mesmo
número acabam discordando, e a que aparece na tela seria a que ninguém usa". G2
é o primeiro sintoma.

## Correção de contagem

O consolidado acima traz o cabeçalho "UX — 5" sobre uma tabela de **sete**
linhas. São sete. O total dos achados é **22**: 1 HIGH, 8 MEDIUM, 4 LOW, 7 UX,
2 observações.

---

# FIX-01 — F-08-1 corrigido (2026-09-07)

Registrado depois da triagem. **Nada acima foi alterado.**

**O que era.** A reserva vale `6,122448979592 kg`; a tela mostra `6,122449`
(seis casas, `ROUND_HALF_UP`) e a validação comparava com o valor cheio. O
número impresso era o único que o operador não podia digitar.

**O que se decidiu não fazer.** Arredondar o teto exibido para baixo resolveria
o campo e quebraria a OP: consumir menos que a reserva deixa resíduo, e
`reconciliation.ts` não tem tolerância — a ordem não fecharia sem justificar
variância de microgramas.

**A regra que ficou.** Round-trip: digitar o valor exibido significa "usar todo
o limite", e o que vai ao servidor é o valor **canônico**, com as doze casas.
Implementada em `apps/web/src/lib/quantity-limit.ts` e usada nas três telas que
comparavam quantidade digitada com teto — Consumo Real, Expedição e Plano de
Atendimento do Pedido. O `+ 1e-6` do Plano de Atendimento saiu. Domínio, API e
`reconciliation.ts` continuam exatos.

**Verificação pela interface, na OP-001157** (`PROD-000031`, quantidade 3):

| Passo | Observado |
|---|---|
| Reserva de `MP-000057` | RESTANTE exibe **`1,529842`** (real `1.529841916500`) |
| Digitar `1,529842` em CONSUMIR AGORA | campo aceito, sem alerta de máximo |
| "Confirmar consumo" | habilitado |
| Depois de confirmar | CONSUMIDO `1,529842` · RESTANTE **`0`** |
| Reconciliação | "0 de 2" → "1 de 2" → "2 de 2 materiais reconciliados" |
| Concluir OP | diálogo diz "Todos os materiais estão reconciliados"; OP **Concluída** |

Sem resíduo, sem variância justificada, sem tolerância no domínio.

**Observações colhidas no caminho, fora do escopo do conserto:**

- a API serializa resíduo pequeno em notação exponencial (`9.79592e-7`); a tela
  de quantidade não é preparada para esse formato — não é F-08-1 e não foi
  tocado;
- a lista de alertas de custo repete a chave React de um item consumido de dois
  lotes (`MATERIAL_COST_UNKNOWN-ME-000024`), gerando aviso de chave duplicada no
  console durante a OP acima. Defeito de apresentação preexistente, também não
  tocado.
