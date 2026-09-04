# Estratégia de E2E

As suítes exploratórias e adversariais históricas foram aposentadas em
2026-09-04. Este documento diz o que vem no lugar — **depois** das capabilities
atuais, não agora.

## O que E2E é para provar

Só o que não se prova em camada menor: a **cadeia** atravessando módulos, e a
navegação real entre eles. Se a regra cabe num teste de domínio, de API ou de
componente, é lá que ela mora — o mapa disso é
[`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md).

Um E2E que reprova o que a camada canônica já prova custa vinte minutos de
navegador para dizer o mesmo, e é o primeiro a apodrecer.

## Regras

1. **Massa própria, carimbada por `runId`.** Nunca "pegue o primeiro cliente",
   nunca `PROD-000123`. Suíte que reencontra massa por nome fixo conta lote da
   execução anterior junto com o seu.
2. **Mutação de negócio pela interface.** API e banco entram só como
   verificação. Fabricar pelo banco o estado que o teste deveria criar clicando
   prova que o banco aceita, não que o sistema funciona.
3. **Happy path e caminhos negativos na MESMA suíte.** Separar "o feliz agora, o
   adversarial daqui a meses" foi exatamente o que produziu as suítes
   aposentadas.
4. **Console sujo reprova.** `console.error` e `pageerror` contam como falha.
5. **Sem veredito gravado.** Nada de arquivo de estado que faça a reexecução
   repetir o resultado anterior em vez de reavaliar.
6. **Reexecutável em base suja.** É a condição para ser confiável.

## As quatro suítes previstas

### E2E 01 — Comercial completo
Cliente → Projeto → Produto → Formulação → Custos → CMV → Precificação →
Orçamento → Pedido → Produção → Expedição → Faturamento.

A cadeia que a Veridi mais olha, e a única que prova que preço, CMV e documento
citam os mesmos números.

### E2E 02 — Suprimentos e Qualidade
Fornecedor → Compra → Recebimento parcial → Lotes → CoA → FEFO → Produção.

Negativos que pertencem a ela: lote vencido, lote bloqueado, CoA pendente,
recebimento acima do pedido.

### E2E 03 — Material do cliente
Isolamento de propriedade → Formulação → CMV → OP → consumo → rastreabilidade.

Negativos: necessidade `VERIDI` tentando consumir estoque de cliente, e o
inverso.

### E2E 04 — Adversarial
Só caminhos proibidos de **alto valor** que não estão suficientemente protegidos
em teste menor. Se aparecer um caminho proibido que cabe num teste de API, ele
vai para lá — esta suíte não é o depósito do que não coube.

## Execução

Poucas, completas, determinísticas. Infraestrutura em
[`scripts/e2e/lib/`](../scripts/e2e/lib): navegador autenticado por cookie da
API, cliente HTTP e `runId`. Os helpers não carregam contexto de negócio — se
precisarem de um produto ou de um lote específico, isso pertence à suíte.
