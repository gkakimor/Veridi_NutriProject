# Backlog de Encerramento e Go-Live

Itens deliberadamente adiados até a preparação final do produto para produção.

> **STATUS: INATIVO DURANTE HOMOLOGAÇÃO / TESTES / FAST DEVELOPMENT.**
>
> Este backlog **não faz parte da Fila viva** de [`BACKLOG.md`](BACKLOG.md), não bloqueia feature, discovery,
> homologação nem teste proporcional, e nenhum item daqui é executado agora.
>
> **Ativação: somente por decisão explícita do PO**, com algo equivalente a "vamos preparar o produto final para
> go-live" ou "entramos na fase final de produção". A mudança de fase nunca é inferida.

Criado em 2026-09-15 (BACKLOG-CLOSURE-01), documental: nenhuma execução operacional ocorreu na criação.

---

## 1. Fase atual

**Homologação / testes em fast development.** O produto ainda pode mudar feature, regra, UX e domínio, receber
migration, refactor e rodada E2E. Não há freeze de produção final.

### "PROD" na infraestrutura não é go-live

O projeto usa, durante a homologação, um ambiente chamado `production` no Railway, a branch `release/prod`, dados
reais publicados (carga inicial de 2026-09-14), backup de PROD e smoke de PROD ([`DEPLOY.md`](DEPLOY.md)). Esses
ambientes **também servem à homologação**.

Nada disso ativa este backlog. A palavra "PROD" em infraestrutura, script ou branch **não significa GO-LIVE FINAL**.

---

## 2. Política

### Critério de entrada

Um item entra aqui quando as três condições valem juntas:

- **A.** é importante para o go-live final; **e**
- **B.** não precisa ser tratado durante homologação / fast development; **e**
- **C.** adiá-lo não compromete o funcionamento básico necessário agora.

### O que não entra

Continuam no [`BACKLOG.md`](BACKLOG.md) normal:

- feature atual;
- bug atual relevante;
- regressão;
- capability em andamento;
- discovery necessário agora;
- blocker de desenvolvimento;
- problema que possa corromper dados hoje;
- falha que impeça a homologação.

Na dúvida entre os dois, o item fica no BACKLOG normal: adiar para cá é decisão, não padrão.

### Relação com os outros documentos

- **BACKLOG** — o que se trabalha agora. Referencia este arquivo em uma linha, fora da Fila viva, sem copiar itens.
- **ROADMAP** ([`ROADMAP_POST_MVP.md`](ROADMAP_POST_MVP.md)) — evolução futura do produto. Nada de lá migra para cá
  automaticamente: closure é preparação para publicar o que existe, não escopo novo.
- **Itens vivos parecidos não são duplicata.** [`OPS-BACKUP-01`](BACKLOG.md#achados-do-fast-development-reset-02-2026-09-11)
  (proteção dos dados reais que já estão em PROD durante a homologação) e a *Estabilização final ampla* da Fila viva
  (varredura de LOW e UX abertos) continuam no BACKLOG normal. CLOSURE-04 e CLOSURE-08 partem do estado que eles
  deixarem; não os absorvem.

### Severidade

Cada item tem **HIGH**, **MEDIUM** ou **LOW**. Aqui a severidade é **prioridade quando o bloco for ativado** — não
significa "fazer agora".

### Estados

| Estado | Significado |
|---|---|
| `RESERVADO_PARA_GO_LIVE` | Registrado; nada a fazer até a ativação. Estado inicial e padrão durante a fase atual |
| `READY_WHEN_ACTIVATED` | Pré-condições do item já satisfeitas; pode começar assim que o PO ativar o bloco |
| `IN_PROGRESS` | Em execução, depois da ativação |
| `BLOCKED` | Parado por dependência ou decisão pendente (nomear qual) |
| `DONE` | Entregue e validado |
| `SKIPPED_BY_PO` | Descartado por decisão explícita do PO, registrada no item |

### Como adicionar um item

Um item novo pode entrar a qualquer momento do desenvolvimento, se passar no critério de entrada. Recebe o próximo
`CLOSURE-NN`, um ID de capability e todos os campos do modelo abaixo, em estado `RESERVADO_PARA_GO_LIVE`. Entrar aqui
não muda a Fila viva.

```markdown
### CLOSURE-NN — ID-DA-CAPABILITY-01 — Título

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH | MEDIUM | LOW
- **Motivo do adiamento:** por que não precisa ser tratado agora.
- **Objetivo no go-live:** o que precisa estar verdadeiro na publicação final.
- **Escopo previsto:** lista curta.
- **Pré-condições:** o que precisa existir antes de começar.
- **Risco:** o que acontece se chegar ao go-live sem ele.
```

---

## 3. Bloco final — Produção, segurança e encerramento

| # | ID | Tema | Severidade | Estado |
|---|---|---|---|---|
| CLOSURE-01 | FINAL-SCOPE-FREEZE-01 | Congelamento de escopo | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-02 | DATA-INTEGRITY-FINAL-AUDIT-01 | Auditoria final de dados | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-03 | SECURITY-HARDENING-01 | Segurança | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-04 | BACKUP-RECOVERY-STRATEGY-01 | Estratégia de backup | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-05 | BACKUP-RESTORE-DRILL-01 | Prova de restore | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-06 | PERFORMANCE-STRESS-01 | Performance, concorrência e stress | MEDIUM | RESERVADO_PARA_GO_LIVE |
| CLOSURE-07 | PRODUCTION-OBSERVABILITY-01 | Observabilidade mínima | MEDIUM | RESERVADO_PARA_GO_LIVE |
| CLOSURE-08 | FINAL-REGRESSION-01 | Regressão final ampla | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-09 | PRODUCTION-RELEASE-READINESS-01 | Gate final | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-10 | PRODUCTION-CUTOVER-01 | Execução do go-live | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-11 | POST-GO-LIVE-VALIDATION-01 | Validação pós-go-live | HIGH | RESERVADO_PARA_GO_LIVE |
| CLOSURE-12 | PROJECT-CLOSEOUT-01 | Encerramento técnico | MEDIUM | RESERVADO_PARA_GO_LIVE |

Ordem natural quando ativado: 01 abre o bloco; 02 a 08 podem correr em paralelo entre si (06 e 08 depois de 01, para
medir o produto congelado); 09 depende de 02 a 08; 10 depende de 09; 11 depende de 10; 12 fecha.

### CLOSURE-01 — FINAL-SCOPE-FREEZE-01 — Congelamento de escopo

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** o produto ainda está em fast development; congelar agora pararia a homologação.
- **Objetivo no go-live:** a partir da declaração do PO, nova feature só entra se bloquear a publicação.
- **Escopo previsto:** marco de congelamento (data e SHA); critério escrito do que é "bloqueia a publicação"; destino
  das demais demandas (BACKLOG normal ou ROADMAP, pós-go-live).
- **Pré-condições:** declaração explícita do PO de início do go-live final.
- **Risco:** sem freeze, as auditorias e a regressão final medem um alvo que continua mudando.
- **Não aplicar agora.**

### CLOSURE-02 — DATA-INTEGRITY-FINAL-AUDIT-01 — Auditoria final de dados

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** dados e regras ainda mudam; uma auditoria final agora envelhece na próxima migration.
- **Objetivo no go-live:** evidência de que os dados publicados respeitam as invariantes do produto.
- **Escopo previsto:** consistência de dados; migrations (cadeia × schema × banco publicado); invariantes críticas
  de [`PRODUCT_RULES.md`](PRODUCT_RULES.md); históricos; estoque; lotes; produção; comercial; faturamento; permissões;
  integridade cross-module.
- **Pré-condições:** CLOSURE-01; leitura do banco-alvo por caminho somente leitura.
- **Risco:** publicar sobre dado inconsistente que só aparece na operação real.
- **Não executar agora.**

### CLOSURE-03 — SECURITY-HARDENING-01 — Segurança

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** a revisão final de segurança precisa do produto estável; hoje credenciais e sessões de
  homologação são mantidas por decisão do PO (abaixo).
- **Objetivo no go-live:** nenhum achado HIGH de segurança aberto; segredos e contas técnicas sob controle.
- **Escopo previsto (checklist futuro):**
  - credenciais e secrets; contas técnicas e de demonstração; armazenamento e rotação;
  - autenticação; autorização; sessões; acessos indevidos;
  - proteção contra tentativas excessivas de autenticação, incluindo rate limiting quando aplicável;
  - CORS; cookies; headers; exposição de erros;
  - validação de entrada; upload/import;
  - revisão de scripts administrativos; dependências; busca de segredos;
  - testes adversariais.
- **Pré-condições:** CLOSURE-01.
- **Risco:** acesso indevido ou vazamento com o produto exposto na internet e dado real de cliente.

**Registro atual — credencial local de homologação.** Existe credencial local de homologação, não versionada e
protegida pelo `.gitignore`.

> **DECISÃO PO ATUAL:** não alterar credenciais, sessões ou caminhos durante fast development, desde que permaneçam
> fora do Git e sem evidência de vazamento. Revisar armazenamento, rotação e necessidade aqui, no
> SECURITY-HARDENING-01.

### CLOSURE-04 — BACKUP-RECOVERY-STRATEGY-01 — Estratégia de backup

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** a estratégia definitiva depende de infraestrutura, volume e operação finais. A proteção dos
  dados já publicados durante a homologação segue no BACKLOG normal (OPS-BACKUP-01).
- **Objetivo no go-live:** backup definido, agendado, protegido e documentado — não só "existe um dump".
- **Escopo previsto:** banco; arquivos (uploads); demais dados necessários; frequência; retenção; armazenamento; cópia
  fora do provedor; acesso; proteção; identificação; criptografia quando aplicável; backup pré-release; RPO; RTO;
  documentação de recuperação.
- **Pré-condições:** CLOSURE-01; estado de OPS-BACKUP-01 conhecido.
- **Risco:** perda de dado sem caminho de volta, ou backup que existe mas não cobre o que precisa.
- **Não assumir** que existir um dump, ou o backup lógico JSON atual, é estratégia suficiente.

### CLOSURE-05 — BACKUP-RESTORE-DRILL-01 — Prova de restore

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** o drill vale para a estratégia definitiva (CLOSURE-04), que ainda não existe.
- **Objetivo no go-live:** provar que o backup é recuperável.
- **Fluxo previsto:** backup real → ambiente isolado → restore → validação → migrations compatíveis → checks de
  integridade → smoke.
- **Pré-condições:** CLOSURE-04; ambiente isolado.
- **Risco:** descobrir que o backup não restaura no dia em que ele for necessário.
- **Nunca testar restore diretamente sobre PROD.**

### CLOSURE-06 — PERFORMANCE-STRESS-01 — Performance, concorrência e stress

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** MEDIUM
- **Motivo do adiamento:** medir antes do freeze mede um produto que ainda muda.
- **Objetivo no go-live:** operação real da Veridi atendida com margem razoável, sob uso simultâneo.
- **Escopo previsto:** grandes listas; inventário grande; pedidos; formulações; produção; relatórios; Painel
  Gerencial; PDFs; CSV; concorrência de estoque; múltiplos usuários; pool de banco; memória; endpoints lentos;
  recuperação após falha.
- **Pré-condições:** CLOSURE-01; volume de referência da operação real.
- **Risco:** lentidão ou falha sob carga real, ou corrida de estoque que só aparece com vários usuários.
- **Capability própria:** não misturar com regressão funcional (CLOSURE-08). Dimensionar para a Veridi; não criar
  teste de escala sem utilidade.

### CLOSURE-07 — PRODUCTION-OBSERVABILITY-01 — Observabilidade mínima

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** MEDIUM
- **Motivo do adiamento:** durante a homologação o diagnóstico é feito por quem desenvolve, com acesso direto.
- **Objetivo no go-live:** saber que algo quebrou e ter como diagnosticar, sem depender de reprodução manual.
- **Escopo previsto:** health; erros 5xx; logs; falha de login; falha de banco; latência; migrations; backup; release;
  capacidade de diagnóstico.
- **Pré-condições:** CLOSURE-01.
- **Risco:** falha silenciosa em operação real.
- Sem necessariamente introduzir plataforma pesada ([`TECH_BASELINE.md`](TECH_BASELINE.md)).

### CLOSURE-08 — FINAL-REGRESSION-01 — Regressão final ampla

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** durante fast development cada capability roda testes proporcionais; a rodada ampla só faz
  sentido sobre o escopo congelado.
- **Objetivo no go-live:** evidência de que o produto congelado funciona ponta a ponta.
- **Escopo previsto:** typecheck; build; fresh migrations; testes de shared, API e Web; E2E; WAVE 1–5; Golden Path;
  cenários adversariais; smoke; validações cross-module.
- **Pré-condições:** CLOSURE-01.
- **Risco:** regressão entre módulos publicada sem ser vista.
- **Somente no closure.** Não exigir esta rodada em cada capability durante fast development.

### CLOSURE-09 — PRODUCTION-RELEASE-READINESS-01 — Gate final

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** é o gate que consome os resultados de CLOSURE-02 a CLOSURE-08.
- **Objetivo no go-live:** decisão registrada `READY_FOR_GO_LIVE = YES/NO`.
- **Checagem prevista:** BLOCKER; HIGH; backup; restore; segurança; performance; permissões; regressão; migrations;
  rollback; documentação; configuração; secrets; versão/tag.
- **Pré-condições:** CLOSURE-02 a CLOSURE-08 em `DONE` ou `SKIPPED_BY_PO`.
- **Risco:** publicar por impulso, sem uma decisão única e verificável.

### CLOSURE-10 — PRODUCTION-CUTOVER-01 — Execução do go-live

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** só existe depois do gate final.
- **Objetivo no go-live:** publicação final controlada e reversível.
- **Plano previsto:** backup imediatamente anterior; versão; migrations; deploy; health; smoke; rollback; validação.
- **Pré-condições:** CLOSURE-09 com `READY_FOR_GO_LIVE = YES`; autorização explícita do PO.
- **Risco:** publicação sem caminho de volta.

### CLOSURE-11 — POST-GO-LIVE-VALIDATION-01 — Validação pós-go-live

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** HIGH
- **Motivo do adiamento:** só existe depois do cutover.
- **Objetivo no go-live:** confirmar módulos críticos e saúde operacional logo depois da publicação.
- **Escopo previsto:** módulos críticos; saúde operacional; preferir operações somente leitura ou controladas.
- **Pré-condições:** CLOSURE-10.
- **Risco:** problema da publicação descoberto pelo usuário final, e não por quem publicou.

### CLOSURE-12 — PROJECT-CLOSEOUT-01 — Encerramento técnico

- **Estado:** RESERVADO_PARA_GO_LIVE · **Severidade:** MEDIUM
- **Motivo do adiamento:** consolida o estado final, que ainda não existe.
- **Objetivo no go-live:** projeto entregue com estado, operação e riscos documentados para quem assume.
- **Escopo previsto:** tag final; estado arquitetural; documentação; deploy; backup; restore; operação;
  troubleshooting; scripts administrativos; riscos residuais; backlog futuro; handover; saúde final.
- **Pré-condições:** CLOSURE-11.
- **Risco:** conhecimento operacional preso em sessão, memória ou pessoa.
