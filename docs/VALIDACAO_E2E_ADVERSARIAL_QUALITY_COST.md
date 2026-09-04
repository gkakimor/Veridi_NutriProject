# Validação E2E adversarial — Qualidade, material do cliente, custos e precificação

Segunda onda adversarial. Alvo: Qualidade de matéria-prima e de produto acabado,
material fornecido pelo cliente, custo de materiais, CMV e precificação.

> **Em andamento.** Este documento é escrito durante a rodada. As seções
> fechadas trazem medição; as abertas dizem que estão abertas.

---

## Fase 1 — o laboratório reprodutível

A rodada anterior terminou com uma dívida de método: as quatro suítes só
passavam sobre banco limpo. `--reset` limpava o arquivo de estado do script e
nunca o banco, e a montagem de massa reaproveitava registros **por nome**. Numa
base que já continha a execução anterior isso produzia três falhas que pareciam
defeito de produto e não eram:

- a contagem somava lote novo com lote retido — "14 lotes onde afirma 6";
- o Produto reaproveitado já vinha com Formulação ativa, e o botão de criar
  formulação em branco deixava de existir;
- a Precificação reaproveitada já estava em R$ 9,99, valor que a execução
  anterior tinha ativado de propósito para provar preço histórico.

### A saída foi identidade, não limpeza

`scripts/adversarial-run.mjs` dá a cada execução um token curto — `0903TZ0` —
carimbado nos campos de **negócio** que a própria execução preenche: nome de
fornecedor, de item, de produto, de cliente. Os códigos oficiais continuam
nascendo da sequência do domínio.

Buscar pelo nome carimbado reencontra só o que aquela execução criou. A base
pode estar cheia de massa legítima sem interferir — que é o objetivo: um E2E que
exige banco vazio não é confiável, é frágil.

O token é compartilhado pelas quatro suítes, porque a cadeia tem dependência
real: produção precisa dos itens que estoque criou, e rastreabilidade precisa da
ordem que produção concluiu. Antes, a suíte de rastreabilidade trazia isso
**cravado no código** — `OP-000659`, `LT-20260903-000803` — códigos de uma
execução específica, que deixam de existir no instante em que a base é recriada.
Agora cada suíte publica o que produziu e a seguinte lê.

Só a suíte de estoque, cabeça da cadeia, abre execução nova. Se cada uma
abrisse a sua, `--reset` em todas geraria quatro execuções isoladas e a de
produção não acharia a massa da de estoque.

### CNPJ

O fornecedor da massa tinha CNPJ fixo. Numa base que já contém a execução
anterior, criar o segundo esbarra na unicidade do cadastro — e a suíte caía num
erro de laboratório que parecia recusa de domínio. O número passou a ser
derivado do token, com dígitos verificadores válidos: estável dentro da
execução, diferente entre execuções.

### Duas correções no próprio script de reset

O reset local nunca chegava a rodar. `shell: true` valia para todos os comandos,
e os binários do Postgres quebravam duas vezes: o caminho
`C:/Program Files/...` virava dois argumentos, e o `<>` do SQL de
`pg_terminate_backend` era lido como redirecionamento.

As duas falhas caíram do lado seguro — o drop só acontece depois de um dump
válido, e o dump falhava antes. Mas um reset que não roda não protege nada: só
adia. Shell agora vale só para quem precisa, o `pnpm`.

### Uma expectativa da suíte que envelheceu

A suíte de estoque afirmava que "a liberação levou **todos** os lotes a
Disponível". Ela foi escrita quando liberar lote vencido era aceito: o status ia
para AVAILABLE e a listagem imprimia "Vencido" por cima, com disponível zero.

O domínio passou a recusar essa liberação na rodada anterior, e a recusa é o
comportamento certo — liberar afirma que o lote pode ser usado. Quem esperava o
contrário era a suíte. A massa recebe três lotes com validade real de 2022/2023
justamente para provar FEFO, e eles chegam vencidos.

A asserção passou a separar os dois casos, e o invariante de disponível zero
deixou de depender do status — senão o filtro ficaria vazio e o `every` passaria
a vácuo, afirmando nada.

---

## Referência externa — a planilha de CMV

A rodada anterior registrou uma divergência aberta: o sistema calculava
**≈ R$ 11 mil por 1000 potes** de Coenzima Q10 contra **≈ R$ 2,4 mil** na
planilha de referência. A conclusão pendente era que o motor podia estar errado
por um fator de quatro.

**Medido agora, e a conclusão se inverte.**

`cmv_precificacao.csv` traz `custo_por_1000_unid = 2431.872` para **os nove
produtos**, inclusive para a linha chamada `CMV modelo`:

```
valores distintos de custo/1000 em toda a planilha: 1  →  2431.872
```

Creatina (um componente, pó de 300 g) não custa o mesmo que Magnésio Treonato
(seis componentes, lote de 20.000). A aba de precificação nunca foi recalculada
por produto — é a planilha-modelo copiada nove vezes.

Somando os próprios componentes da planilha — `kg_lote × preço_brl_kg` — o custo
de material por 1000 unidades sai assim:

| Produto | Componentes | Material por 1000 un |
|---|---|---|
| Coenzima Q10 60 caps | 5 | **R$ 9.708,23** |
| Resveratrol 60 caps | 10 | R$ 17.697,99 |
| Creatina 300 g | 1 | R$ 7.650,00 |
| Cúrcuma 60 caps | 6 | R$ 4.635,47 |
| Magnésio Treonato 180 caps | 6 | R$ 4.350,65 |
| Magnésio 120 caps | 5 | R$ 3.788,05 |
| Complexo B 60 caps | 12 | R$ 308,45 |

A própria planilha, pelos seus próprios números, diz **R$ 9.708,23** de material
para a Coenzima Q10 — não R$ 2.431,87. Contra isso, o resultado do sistema
(≈ R$ 11 mil, que inclui recursos, energia e overhead além do material) deixa de
ser uma divergência de fator quatro.

**Classificação: EXTERNAL_DATA_FINDING, sistemático.** A aba de componentes
contradiz a aba de precificação da mesma planilha. Não é defeito do produto, e o
motor não deve ser ajustado para "bater" com um valor de modelo.

### A aritmética de pureza da própria planilha

O dado real também expõe a regra que a Parte E manda validar:

```
kg_lote = mg_formula × n_cápsulas ÷ pureza ÷ 1.000.000
```

Confere nos dois produtos escolhidos. Coenzima Q10 fecha em 36.000 cápsulas —
item 351 com pureza 0,98: `7,34693878 × 0,98 = 7,2 kg`, e `7,2 kg ÷ 200 mg =
36.000`. Complexo B fecha em 1.980 cápsulas — item 199 com pureza 0,28:
`0,4455 × 0,28 = 0,12474 kg`, e `0,12474 kg ÷ 63 mg = 1.980`.

### Os dois produtos desta onda

Escolhidos por serem opostos em tudo o que importa ao cálculo:

| | Coenzima Q10 | Complexo B |
|---|---|---|
| Componentes | 5 | 12 |
| Purezas ≠ 1 | 0,98 · 0,5 | 0,2 · 0,28 · 0,85 |
| Lote mínimo | 1.000 | 30 |
| Cápsulas por dose | 2 | 1 |
| Material por 1000 un | R$ 9.708,23 | R$ 308,45 |

Faixas de venda reais, idênticas nas duas por causa do mesmo defeito de cópia da
planilha: 300 · 500 · 1000 unidades a R$ 4,00 · R$ 3,80 · R$ 3,60, com comissão
de 5%.

---

## Privacidade

Massa e conferências são locais. Nenhum dado real sai para serviço externo. Este
documento traz o que é necessário à prova — item, pureza, quantidade, preço — e
não reproduz CNPJ, telefone, e-mail, endereço nem razão social.
