# Guia da ajuda contextual

Como se escreve um "Como funciona" no Veridi. É curto de propósito: a
auditoria que originou este guia tem 1.886 linhas e está em
[`archive/AUDIT_UX_COMO_FUNCIONA.md`](archive/AUDIT_UX_COMO_FUNCIONA.md) — ela
é a evidência de setembro de 2026, não a regra do dia a dia.

A regra durável de produto continua em [`PRODUCT_RULES.md`](PRODUCT_RULES.md)
§45. Este arquivo é o manual de quem escreve.

---

## 1. Os três níveis

Um tópico responde três perguntas, nesta ordem, e o painel mostra nesta ordem.

**Nível 1 — sempre visível, no máximo 80 palavras somadas.**

| Campo | O que responde |
|---|---|
| `oneLiner` | O que esta tela é e para que serve. Uma ou duas frases. |
| `whenToUse` | Duas ou três situações concretas. |
| `nextSteps` | A ação mais provável depois desta tela. |

É o que responde "o que eu faço aqui?" em cinco segundos. Antes desta rodada a
resposta chegava depois de nove termos de glossário.

**Nível 2 — aberto por padrão.**

`prerequisites` (com link para onde cada um se resolve) · `steps` · `automations`
· `process`.

Cada passo é um par: **`you`** é o que a pessoa faz, no imperativo, citando o
botão pelo rótulo exato; **`system`** é o que o sistema faz em resposta, em
terceira pessoa. Separar os dois é o que transforma descrição em instrução.

**Nível 3 — recolhido.**

`terms` · `states` · `cautions` · `example` · `learnMore`.

É consulta, não leitura. Nasce em `<details>` fechado, com a contagem no
título ("Termos desta tela (9)").

---

## 2. Tamanho

| Classe | Quando | Teto |
|---|---|---|
| **S** | Lista de consulta, tela com uma ação, diálogo | 250 palavras |
| **M** | Duas a quatro ações e uma regra de negócio importante | 500 palavras |
| **L** | Tela de fluxo: situações, atos irreversíveis, pré-requisitos | 800 palavras |

O teto vale para o tópico inteiro, os três níveis somados, e é testado. O
nível 1 tem teto próprio: 80 palavras, sempre.

Tópico que não cabe quase nunca precisa de mais espaço — precisa de menos
assunto. A saída é dividir a tela em dois tópicos ou mandar o conceito
repetido para `help/concepts/`.

---

## 3. As doze regras de escrita

1. Frase de até 20 palavras, uma ideia por frase. No máximo um travessão por
   parágrafo. Sem aforismo: se a frase precisa ser uma sacada, ela não foi
   entendida.
2. Imperativo para o usuário, terceira pessoa para o sistema. "Confirme o
   pedido. O sistema congela cliente, produtos, quantidades e preço."
3. Nome de tela e de botão **exatamente** como estão na interface, entre aspas
   na primeira citação. A ajuda nunca inventa sinônimo para botão que existe.
4. Termo em inglês só com glosa, e só quando a interface o usa. A glosa vem na
   **primeira** aparição dentro do tópico; depois dela o termo circula
   sozinho. As formas aceitas estão em
   [`help/glossario/siglas.ts`](../apps/web/src/help/glossario/siglas.ts).
5. Sem termo de implementação: transação, snapshot, endpoint, DTO, ID,
   payload, backend. O sistema é "o sistema", nunca "o servidor".
6. Número com exemplo quando há cálculo. "1 kg e 1.000 g são a mesma
   quantidade"; "10 ÷ (1 − 0,30 − 0,05) = R$ 15,38".
7. Automação sempre marcada: a linha de `automations` começa por "O sistema".
8. Irreversível sempre marcado: a ressalva começa por "Não tem volta:".
9. Papel de acesso dito uma vez, em `cautions` ou `prerequisites`.
10. Uma explicação por conceito compartilhado. Ideia que serve a mais de três
    telas vira arquivo em `help/concepts/` e o tópico aponta para ela.
11. No máximo cinco ressalvas. Mais que isso deixa de ser ressalva e vira
    parede.
12. Português do Brasil, registro profissional. Sem "você pode", "basta", "é
    só", "simplesmente"; sem tom de tutorial.

---

## 4. Terminologia aprovada (PO-5)

| Use | Não use |
|---|---|
| Situação | Status |
| Separação | Picking |
| Modelo | Template, matriz, biblioteca |
| Em espera | Stand-by |
| Laudo (CoA) | CoA sozinho |
| Registrar produção | Apontamento, produção realizada |
| Faturamento | — (permanece) |

**Overage** e **markup** podem aparecer, sempre com glosa em português:
"overage (excesso planejado)", "markup (quanto o preço está acima do custo)".
**FEFO** e **FIFO** só em explicação secundária, nunca como única explicação —
escreva "vence antes, sai antes".

**Identidades do lote (PO-4).** A terminologia alvo é **código interno**,
**lote do fornecedor** e **lote comercial**. A renomeação dos rótulos de tela é
de outra capability: até lá, quando o tópico ensina onde clicar, ele usa o
rótulo **real de hoje** e explica o conceito canônico entre parênteses quando
precisa.

---

## 5. Arquitetura de conteúdo

```
apps/web/src/help/
  content/
    <modulo>.ts            tópicos ainda no modelo V1 (um arquivo por módulo)
    <modulo>/<tela>.ts     tópicos no modelo V2 (um arquivo por tela)
    v2.ts                  registro dos tópicos V2
  concepts/index.ts        os sete conceitos compartilhados
  glossario/siglas.ts      termos em inglês e as formas aceitas
  glossario/verbos.ts      o que cada verbo de ato congela
  help-content.ts          tipos e registro final
```

Os dois modelos convivem. `helpTopics` junta tudo e o painel reconhece qual
está lendo pelo campo `version`. Migrar é mover o tópico do arquivo do módulo
para um arquivo próprio e reescrevê-lo no modelo novo — uma tela por vez, e
não uma varredura que ninguém revisa.

**Os sete conceitos compartilhados:** saldos · reserva × consumo · identidades
do lote · versões · prévia × gravado · custo desconhecido · material do
cliente. Cada um tem exemplo numérico e é escrito uma vez só.

---

## 6. Como nasce um tópico novo

1. Escolha a classe de tamanho pela tela, não pelo texto que você quer
   escrever.
2. Escreva o nível 1 primeiro e conte as palavras. Se ele não cabe em 80, a
   tela ainda não foi entendida.
3. Abra a tela ao lado e cite os botões pelo rótulo exato.
4. Separe cada passo em "você faz" e "o sistema faz".
5. O que a tela faz sozinha vai para `automations`, nunca escondido num termo.
6. O que não tem volta vai para `cautions`, com o prefixo.
7. Conceito que já existe em `help/concepts/` entra por `learnMore`, não
   copiado.
8. Preencha `revisedAt` com a data da revisão.
9. Rode os testes: eles dizem o que falta.

---

## 7. O que os testes cobram

[`apps/web/src/pages/help-editorial.test.ts`](../apps/web/src/pages/help-editorial.test.ts)
— o padrão editorial: nível 1 completo e dentro de 80 palavras, teto por
classe, passo a passo, nenhuma seção declarada e vazia, no máximo cinco
ressalvas, `nextSteps` obrigatório, todo link interno resolvendo contra as
rotas reais do `App.tsx`, conceito citado existindo, inglês glosado na
primeira aparição, exemplo numérico onde a conta é o assunto.

[`apps/web/src/pages/help-topic-contract.test.ts`](../apps/web/src/pages/help-topic-contract.test.ts)
— a ligação entre tela e tópico, o inventário de rotas com ajuda, os
componentes essenciais de cada tela e os termos técnicos proibidos. Vale para
os dois modelos.

[`apps/web/src/components/help/help-kit.test.tsx`](../apps/web/src/components/help/help-kit.test.tsx)
— o painel: nasce fechado, nível 1 antes do passo a passo, consulta recolhida,
link fechando o painel ao navegar, e tópico V1 continuando a renderizar.

[`scripts/e2e/ajuda-contextual-nivel-1.mjs`](../scripts/e2e/ajuda-contextual-nivel-1.mjs)
— no navegador, em cinco telas P0: o próximo passo visível sem rolar, a
consulta recolhida abrindo no clique, o link navegando, e o painel não
piorando a rolagem no celular.

---

## 8. O que ainda não foi feito

- **Painel lateral com abas** (opção B da auditoria) — UX-HELP-03. O conteúdo
  escrito no modelo V2 migra para ele sem reescrita.
- **Rota `/ajuda/conceitos/:slug`** — enquanto ela não existe, o conceito
  compartilhado é exibido dentro do próprio painel, em "Saiba mais".
- **Os 39 tópicos ainda no modelo V1** — migram por tela.
- **Divisão de tópicos que servem a várias telas** — Recebimentos (quatro),
  Lotes (três) e a lista de Precificação.
- **Renomeação dos rótulos de tela** para a terminologia aprovada — é mudança
  de interface, não de ajuda.
