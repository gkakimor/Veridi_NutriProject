# Veridi Nutrition — Project State

**Versão:** baseline v0.4 — post-benchmark · **Fase:** FAST MVP.

---

## Onde estamos

**Release congelada:** `9a653a0`
**Ambiente:** Railway, deploy `8949e780`, health 200.

O MVP operacional está **validado internamente**. Deliveries 01 a 40+
concluídas: Blocos A a G fechados — cadastros, compras, recebimento e lotes,
estoque e FEFO, formulações versionadas, produção com consumo real e
rastreabilidade, pedido do cliente com plano de atendimento, expedição,
faturamento, fundação de custos, cockpit e relatórios, cadastros e formulação
industrial, material do cliente, GMP, qualidade documental, projetos e
orçamentos versionados, recursos e custo industrial, precificação e margem.

Detalhe por delivery: [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md).

## MVP validado?

Sim, internamente. Três casos profundos derivados de dados legados rodaram
ponta a ponta contra a interface publicada, cada um pressionando uma parte
diferente do domínio:

- **VAL-LEG-01 — PASS.** `PED-000001` do pedido ao faturamento.
- **VAL-LEG-02 — PASS.** Falta, compra complementar de fornecedor alternativo,
  recebimento parcial, FEFO entre três lotes, reserva multi-lote, consumo extra
  com motivo, produção parcial (147 de 150), saldo, segunda OP e faturamento
  herdando o preço acordado.
- **VAL-LEG-03 — PASS.** Material fornecido pelo cliente ponta a ponta:
  propriedade e segregação, recebimento sem OC da Veridi, templates de
  formulação e de custo, cálculo excluindo aquisição do cliente, política de
  preço, parcelamento com juros, produção, rastreabilidade e faturamento.

O hardening pré-cliente e o polimento visual que se seguiram não criaram
capacidade de negócio: fecharam o backlog funcional e de UX dos três casos, com
cobertura de regressão. Findings e correções em
[archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md); as regras que eles
viraram, em [PRODUCT_RULES.md](PRODUCT_RULES.md) §38 e §40.

## Próximo gate

**Validação com a Veridi.** Nenhum desenvolvimento novo até essa conversa
acontecer e o feedback ser classificado — o que a operação real apontar vale
mais do que qualquer item priorizado sozinho daqui.

Material preparado:

- `Guia_Fluxo_Comercial_Veridi.docx` — guia do usuário final em 36 capítulos,
  em português, sem termos de implementação. Não versionado no repositório,
  conforme a política atual.
- [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) — roteiro da
  reunião em quinze blocos, com perguntas abertas por etapa e a grade de
  classificação do feedback.

## Em andamento — melhorias no cadastro de Cliente

Rodada curta promovida pelo PO, sobre a release congelada. Sem módulo novo.

- **E-mail, CNPJ e telefone passaram a ser validados** na tela e na API. CNPJ
  agora confere os dígitos verificadores e aceita as duas formas em
  circulação: a numérica e a alfanumérica da IN RFB nº 2.229/2024. O validador
  é compartilhado, então **Fornecedor herdou a mesma regra** — a importação do
  legado já rejeitava CNPJ com DV inválido, então não há registro existente
  que deixe de ser editável.
- **Endereço preenchido pelo CEP** via ViaCEP. Falha do serviço nunca bloqueia
  o cadastro; número nunca é preenchido automaticamente.
- **Autoria do cadastro** (quem criou, quem alterou por último) reusando o
  padrão `createdByUserId`/`NameSnapshot` já existente. Migration aditiva e
  nullable, sem backfill: cliente importado do legado mostra "Não disponível".
- **Histórico detalhado por campo NÃO foi implementado**: não existe
  infraestrutura genérica de auditoria para reusar — só duas tabelas de
  histórico de status com propósito próprio. Construir uma é capacidade
  transversal, não cabe numa rodada curta.

## Blockers

Nenhum.

## Backlog aberto

Duas passadas de nomenclatura de severidade LOW e uma instabilidade de
infraestrutura da suíte, todas não bloqueantes. Ver [BACKLOG.md](BACKLOG.md).

## Decisões de produto ainda em aberto (não bloqueantes)

Listadas em [BACKLOG.md](BACKLOG.md) para terem fonte única.

---

## Mapa de documentos

| Assunto | Fonte única |
|---|---|
| Estado atual, release, próximo gate | este arquivo |
| Pendências abertas | [BACKLOG.md](BACKLOG.md) |
| Valor futuro mapeado | [ROADMAP_POST_MVP.md](ROADMAP_POST_MVP.md) |
| Regras duráveis de negócio | [PRODUCT_RULES.md](PRODUCT_RULES.md) |
| Regras duráveis de UI e marca | [UI_BRAND.md](UI_BRAND.md) |
| Escopo e plano do MVP | [MVP_PLAN.md](MVP_PLAN.md) |
| Política de migração do legado | [VERIDI_MIGRATION.md](VERIDI_MIGRATION.md) |
| Stack e ambiente | [TECH_BASELINE.md](TECH_BASELINE.md) |
| Implantação | [DEPLOY.md](DEPLOY.md) |
| Roteiro da validação com o cliente | [ROTEIRO_VALIDACAO_CLIENTE.md](ROTEIRO_VALIDACAO_CLIENTE.md) |
| Histórico de deliveries | [archive/DELIVERY_HISTORY.md](archive/DELIVERY_HISTORY.md) |
| Histórico de findings de auditoria | [archive/BACKLOG_HISTORY.md](archive/BACKLOG_HISTORY.md) |

---

## Manutenção deste arquivo

Manter curto. Reescrever/condensar após mudanças relevantes. Não transformar em
log cronológico — o log vive no arquivo de histórico.
