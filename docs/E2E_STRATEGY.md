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

## Base das suítes — E2E_BASELINE_REBUILD (2026-09-14)

Toda suíte começa de uma base conhecida: a carga inicial real da Veridi, a mesma de PROD e do DEV
(DEV_REALDATA_BASELINE, em [`PROJECT_STATE.md`](PROJECT_STATE.md)), num banco só das E2E.

```bash
pnpm e2e:baseline:rebuild
```

`scripts/e2e-baseline-rebuild.mjs` derruba e recria `veridi_e2e_baseline` no servidor local da `.env`, aplica as
migrations, cria o ADMIN do `seed-infra` (o mesmo que `lib/browser.mjs` usa) e roda VALIDATE → PLAN → APPLY → VERIFY
do importador oficial com o pacote aprovado — sem regra de carga própria. Opcionais: `E2E_BASELINE_DATABASE` (o nome
contém `e2e_baseline`), `VERIDI_REVIEW_PACKAGE`, `VERIDI_CORPUS_DIR`, `E2E_EMAIL`/`E2E_PASSWORD`. Relatórios da carga
e `baseline.json` (identidade do pacote e contagens) ficam em `../.local-data/veridi/e2e-baseline/<banco>/`. Recusa
servidor não local, nome fora do padrão, o banco da `.env` e marca de produção. Cerca de 20 s.

Servidores contra a base, no Git Bash e na raiz, em portas livres (`URL_E2E` é a `DATABASE_URL` da `.env` com o banco
trocado para `veridi_e2e_baseline`):

```bash
DATABASE_URL=$URL_E2E API_PORT=3334 WEB_ORIGIN=http://127.0.0.1:5174 pnpm dev:api
VITE_API_URL=http://127.0.0.1:3334 pnpm --filter @veridi/web exec vite --port 5174 --strictPort
E2E_API=http://127.0.0.1:3334 E2E_WEB=http://127.0.0.1:5174 node scripts/e2e/<suíte>.mjs
```

## Regra de massa sobre a base real (proposta, 2026-09-14)

1. Toda execução parte de `pnpm e2e:baseline:rebuild`, ou de uma base que se prova ela (`baseline.json`).
2. A base é leitura: o que a suíte muda, ela cria, carimbado com o `runId`. Registro da carga não é editado.
3. Registro da carga entra por consulta ("um produto com formulação ativa"), nunca por código fixo.
4. "SEM MASSA" é reprovação, não verde.
5. Nenhuma suíte depende de outra ter rodado antes — nem do `handoff/e2e-run.json` de outra execução.
6. Nenhuma suíte aponta para PROD.

## As 29 suítes atuais contra a base real (2026-09-14)

Leitura de código e da base, sem executar suíte nenhuma.

| Categoria | Suítes | Por quê |
|---|---|---|
| **A** — devem passar como estão | `base-calculada-e-equivalente-por-mil`, `contato-do-cliente-no-projeto`, `modelo-aplicado-preserva-base`, `modelo-formulacao-unidade-controlada`, `oferta-de-fornecedor-vira-custo`, `perfil-tributario-do-cliente`, `produto-do-cliente-do-pedido`, `projeto-inteiro-invalido-nao-apaga`, `troca-de-cep-do-cliente`, `vigencia-de-tarifa-industrial` | massa própria pela interface, carimbada pelo `runId`; não leem registro fixo |
| **B** — dependiam de massa que agora existe | `ajuda-contextual-nivel-1`, `recebimento-validacao-viva` | a primeira abre o primeiro registro de cada lista, agora cheia; a segunda usa `FOR-000001` e `MP-000001` como "algum fornecedor e alguma MP com lote e validade" — existem na base, sem relação homologada entre os dois (antes só passava depois de outra suíte criá-los) |
| **C** — precisam criar a própria massa | `cancelamento-de-pedido-com-op-cancelada`, `custo-estimado-acompanha-o-salvamento`, `desconto-do-pedido-chega-ao-faturamento`, `disponibilidade-comercial-explicada`, `entregas-programadas-do-pedido`, `expedicao-geral-entre-entregas`, `formulacao-quantidade-fisica-e-custo` | na base `PROD-000031` é de `CLI-000020`, não de `CLI-000013`; `CAFEÍNA PT 60 CAPS THE KING` (`PROD-000107`) não tem `MP-000365` nem `MP-000368`; não há referência de custo, lote nem PA com saldo — três sairiam "SEM MASSA". `desconto…` também usa o fluxo antigo do Orçamento |
| **D** — reescrever | `condicoes-do-orcamento-sobrevivem-a-linha`, `envio-exige-condicoes-salvas`, `envio-exige-linhas-salvas`, `formacao-de-preco-do-novo-orcamento`, `prazo-invalido-nao-apaga`, `preco-herdado-sobrevive-ao-tab`, `projeto-aprovado-vende-de-novo`, `resumo-comercial-do-projeto`, `private-label-golden-path`, `ordem-de-producao-produto-fora-da-primeira-pagina` | nove operam o Orçamento embutido no Projeto (E2E-QUOTE-PAGE-FLOW-01; o golden path para em `pedido`); a última procura `PROD-000214`, que não existe (173 produtos) — a premissa "fora da primeira página" segue válida com produto achado por consulta |
| **E** — dependem de ordem | `private-label-golden-path` (também D) | `--desde` sem `--run` retoma pelo `handoff/e2e-run.json` da última suíte que rodou, e o checkpoint mora em `handoff/golden-path-<runId>.json` |
