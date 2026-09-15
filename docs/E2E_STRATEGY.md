# Estratégia de E2E

As suítes exploratórias e adversariais históricas foram aposentadas em
2026-09-04. Este documento diz o que vem no lugar, as regras das suítes vivas e
como elas rodam.

## O que E2E é para provar

Só o que não se prova em camada menor: a **cadeia** atravessando módulos, e a
navegação real entre eles. Se a regra cabe num teste de domínio, de API ou de
componente, é lá que ela mora — o mapa disso é
[`TEST_COVERAGE_MAP.md`](TEST_COVERAGE_MAP.md).

Um E2E que reprova o que a camada canônica já prova custa vinte minutos de
navegador para dizer o mesmo, e é o primeiro a apodrecer.

## Regras

1. **Massa própria, carimbada por `runId`.** Nunca "pegue o primeiro cliente",
   nunca `PROD-000123`. O `runId` nasce em memória a cada execução
   (`scripts/e2e/fixtures/run.mjs`, 6 caracteres base36) e carimba os nomes que a
   suíte cria; códigos oficiais (CLI-, PROD-, PED-, ORC-…) são sempre LIDOS das
   respostas, nunca inventados.
2. **O que se prova, pela interface.** A pré-condição pode nascer por API
   (decisão do PO, E2E-BASELINE-REDESIGN-WAVE-01-02) quando TODAS valem: não é o
   comportamento sob teste; economiza muito tempo; o contrato da rota já é
   coberto em teste de API; e não pula a pré-condição que o cenário pretende
   provar. GET de conferência é livre. Prisma e SQL direto numa suíte:
   proibidos.
3. **Happy path e caminhos negativos na MESMA suíte.** Separar "o feliz agora, o
   adversarial daqui a meses" foi exatamente o que produziu as suítes
   aposentadas.
4. **Console e rede sujos reprovam.** `console.error`, `pageerror` e resposta
   4xx/5xx da API que a suíte não declarou. Recusa provocada pelo próprio teste
   se declara antes de provocar (`esperarErroHttp` de `lib/browser.mjs`).
5. **Sem estado entre execuções.** Nada de veredito nem de runId em arquivo:
   rodar de novo reavalia. (`handoff/e2e-run.json` saiu do fluxo em
   E2E-BASELINE-REDESIGN-WAVE-01-02.)
6. **Reexecutável em base suja.** Provado por wave: a mesma bateria roda de novo
   no mesmo clone, sem recriar, e continua verde.
7. **"SEM MASSA" é reprovação.** Suíte que não achou o que avaliar não avaliou
   nada; o runner reprova mesmo com exit 0.

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
vai para lá — esta suíte não é o depósito do que não coube. Os perfis
COMMERCIAL e PRODUCTION entram aqui (decisão G abaixo).

## Execução

Poucas, completas, determinísticas — e num clone descartável da base E2E:

```bash
pnpm e2e:run --bateria=wave-01-02
```

Infraestrutura em [`scripts/e2e/`](../scripts/e2e): `lib/` (navegador autenticado
e leitor de PDF) e `fixtures/` (runId, API, gestos de tela, datas e cadastros
básicos por API). Os helpers não carregam registro de negócio: fixture cria massa
genérica carimbada; se a suíte precisa de um produto ou lote específico, ele
pertence à suíte.

## Base das suítes — E2E_BASELINE_REBUILD (2026-09-14)

Toda suíte começa de uma base conhecida: a carga inicial real da Veridi, a mesma de PROD e do DEV
(DEV_REALDATA_BASELINE, em [`PROJECT_STATE.md`](PROJECT_STATE.md)), num banco só das E2E.

```bash
pnpm e2e:baseline:rebuild
```

`scripts/e2e-baseline-rebuild.mjs` derruba e recria `veridi_e2e_baseline` no servidor local da `.env`, aplica as
migrations, cria o ADMIN do `seed-infra` e roda VALIDATE → PLAN → APPLY → VERIFY do importador oficial com o pacote
aprovado — sem regra de carga própria. Opcionais: `E2E_BASELINE_DATABASE` (o nome contém `e2e_baseline`),
`VERIDI_REVIEW_PACKAGE`, `VERIDI_CORPUS_DIR`, `E2E_EMAIL`/`E2E_PASSWORD`. Relatórios da carga e `baseline.json`
(identidade do pacote, contagens e o estado das migrations aplicadas — total, última e assinatura de nome e conteúdo)
ficam em `../.local-data/veridi/e2e-baseline/<banco>/`. Recusa servidor não local, nome fora do padrão, o banco da
`.env` e marca de produção. Cerca de 20 s.

A base é **template imutável**: nenhum servidor aponta para ela.

## Runner — `pnpm e2e:run` (E2E-BASELINE-REDESIGN-WAVE-01-02)

`scripts/e2e-run.mjs`, guardas em `scripts/e2e-run.test.ts`:

1. confere que a template foi montada com as migrations do repositório — `baseline.json` diferente (migration nova,
   editada, registro ausente) é recusado com a instrução `pnpm e2e:baseline:rebuild`; o runner nunca reconstrói
   sozinho;
2. cria o clone por `CREATE DATABASE … TEMPLATE`, só local — nome `<template>_run_<runid>`, sempre com `e2e_baseline`,
   nunca o banco da `.env` nem a própria template; template com conexão aberta é recusada, sem derrubar ninguém; o
   clone confere as migrations do repositório;
3. cria o ADMIN próprio da execução (`scripts/bootstrap-admin.ts`), com senha sorteada que só as suítes recebem;
4. sobe API e Web só em `127.0.0.1` (3334 e 5174 por padrão), contra o clone;
5. roda as suítes em série — exit ≠ 0, estouro de tempo ou "SEM MASSA" reprovam; conta 5xx no log da API;
6. derruba API e Web com a árvore de processos e remove o clone. `--manter-clone` mantém; `--clone=<nome>` reusa um
   clone existente (a rodada suja).

Opções: `--bateria=<nome>` ou `--suites=a,b`, `--api-porta`, `--web-porta`, `--timeout-suite` (minutos). Logs de API,
Web e de cada suíte em `../.local-data/veridi/e2e-runs/<clone>/<runId>/`.

Suíte avulsa contra servidores já no ar continua possível (`E2E_API`, `E2E_WEB`, `E2E_EMAIL`, `E2E_PASSWORD`), mas
só em `http://127.0.0.1:<porta>`: `lib/browser.mjs` recusa outra origem.

## Decisões do PO para o redesign (2026-09-14)

- **A. Massa por API** — aprovada nas quatro condições da regra 2; GET de conferência livre; Prisma/SQL proibido.
- **B.** `formulacao-quantidade-fisica-e-custo` ganha massa própria numa wave futura.
- **C.** `ajuda-contextual-nivel-1` fica em quatro telas por enquanto; Faturamento sai do E2E.
- **D.** Fundir no futuro `envio-exige-condicoes-salvas` com `envio-exige-linhas-salvas`, e
  `entregas-programadas-do-pedido` com `expedicao-geral-entre-entregas` — cenários separados dentro da suíte combinada.
- **E.** Condição suja: a guarda de saída é a regra atual correta.
- **F.** Base: clone por PostgreSQL TEMPLATE, só local.
- **G.** Usuário: o runner usa ADMIN próprio da execução; COMMERCIAL e PRODUCTION ficam para a adversarial.
- **H.** `guia-capturas.mjs` fica fora do gate.
- **I.** Pronto por wave: clone novo verde + a mesma bateria em clone sujo + console limpo + nenhum "SEM MASSA".

Massa sobre a base real: a base é leitura — o que a suíte muda, ela cria, carimbado; registro da carga não é editado
nem procurado por código fixo; nenhuma suíte depende de outra ter rodado antes; nenhuma aponta para PROD.

## Mapa das suítes (2026-09-15)

| Grupo | Suítes | Estado |
|---|---|---|
| **WAVE 1–2** — fundação nova | `base-calculada-e-equivalente-por-mil`, `contato-do-cliente-no-projeto`, `modelo-aplicado-preserva-base`, `modelo-formulacao-unidade-controlada`, `oferta-de-fornecedor-vira-custo`, `perfil-tributario-do-cliente`, `produto-do-cliente-do-pedido`, `projeto-inteiro-invalido-nao-apaga`, `troca-de-cep-do-cliente`, `vigencia-de-tarifa-industrial`, `recebimento-validacao-viva` | bateria `wave-01-02` do runner — verde em clone novo e, sem recriar, na mesma bateria sobre o clone sujo (2026-09-15). As três que esperavam a lista de Clientes por regex terminando em `/cadastros/clientes` esperam pelo caminho (`esperarRota`), e `perfil-tributario` e `troca-de-cep` reabrem o cliente pelo id (`?ids=`), sem depender do filtro "Clientes ativos". O recebimento cria fornecedor e matéria-prima com lote e validade por API; OC e recebimentos continuam pela tela |
| **Provas** das libs das próximas waves | `leitor-de-pdf-da-tela`, `roteiro-aplicado-planeja-ordem` | bateria `provas-wave-01-02`: iframe `.pdf-screen__frame`, `blob:`, texto e NBSP contra PDF real; roteiro criado, ativado e aplicado a OP em rascunho, que planeja (e sem roteiro é recusada) |
| **C** — precisam criar a própria massa | `ajuda-contextual-nivel-1` (quatro telas, decisão C), `cancelamento-de-pedido-com-op-cancelada`, `custo-estimado-acompanha-o-salvamento`, `desconto-do-pedido-chega-ao-faturamento`, `disponibilidade-comercial-explicada`, `entregas-programadas-do-pedido`, `expedicao-geral-entre-entregas`, `formulacao-quantidade-fisica-e-custo` | abrem o primeiro registro de lista ou leem código e saldo que a base não tem (`PROD-000031` é de outro cliente, não há lote nem PA com saldo; PA com saldo só nasce por produção). `desconto…` também usa o fluxo antigo do Orçamento |
| **D** — reescrever | `condicoes-do-orcamento-sobrevivem-a-linha`, `envio-exige-condicoes-salvas`, `envio-exige-linhas-salvas`, `formacao-de-preco-do-novo-orcamento`, `prazo-invalido-nao-apaga`, `preco-herdado-sobrevive-ao-tab`, `projeto-aprovado-vende-de-novo`, `resumo-comercial-do-projeto`, `private-label-golden-path`, `ordem-de-producao-produto-fora-da-primeira-pagina` | nove operam o Orçamento embutido no Projeto (E2E-QUOTE-PAGE-FLOW-01; o golden path para em `pedido`); a última procura `PROD-000214`, que não existe — a premissa "fora da primeira página" segue válida com produto achado por consulta |
| **E** — dependem de ordem | `private-label-golden-path` (também D) | `--desde` exige `--run=<runId>` desde WAVE-01-02 (antes retomava pelo arquivo global); o checkpoint de entidades segue em `handoff/golden-path-<runId>.json` |
