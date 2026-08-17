# Gate pós-Bloco G — Auditoria completa + UX/UI + Demo Readiness

NÃO é uma nova capacidade.

NÃO numerar como 48.

NÃO iniciar Bloco H.

NÃO implementar ANVISA, IN28, regulatório, rotulagem ou novos módulos.

## 0. Agentes UX obrigatórios

Antes da auditoria, garantir estes project subagents em `.claude/agents/`:

- `ux-end-user-auditor`
- `ux-operational-task-auditor`
- `ux-visual-accessibility-auditor`

Usar os três como auditores independentes, em modo somente leitura.

Eles NÃO implementam correções.

Cada agente deve receber o mesmo contexto mínimo:
- sistema desktop-first;
- usuários vindos de Excel/papel e com diferentes níveis de familiaridade com computador;
- objetivo é avaliar facilidade de navegação e execução de tarefas;
- não propor features genéricas de ERP sem evidência;
- Playwright/Chromium deve ser usado;
- começar pelos menus/Dashboard, não por URLs diretas.

Executar os agentes separadamente para evitar que um contamine a conclusão do outro.

O agente principal consolida depois.

## 1. Objetivo do gate

Auditar o produto inteiro após os Blocos F e G e responder duas perguntas:

1. O sistema está tecnicamente consistente para demonstração?
2. Um usuário final da Veridi consegue navegar e concluir os principais trabalhos sem conhecer a arquitetura do ERP?

Somente corrigir:
- regressão;
- bug evidente;
- inconsistência UX pequena;
- quebra de regra já documentada.

Novo requisito ou redesign relevante:
- finding/backlog;
- não implementar durante o gate.

## 2. Critério UX principal

A auditoria NÃO pode se limitar a:
- testes verdes;
- ausência de console error;
- tela visualmente bonita.

Precisamos testar se o usuário consegue descobrir o caminho.

Para fluxos-chave, começar sempre por:
- Login;
- Dashboard;
- Sidebar;
- telas de lista.

NÃO navegar diretamente para a rota final na primeira tentativa.

Registrar momentos em que o auditor:
- não sabe para onde ir;
- precisa lembrar uma rota;
- precisa voltar ao menu;
- procura uma ação que não está visível;
- encontra termo técnico;
- perde contexto de Cliente/Projeto/Product/OP/Lote;
- recebe erro sem saber como corrigir.

## 3. Execução dos três agentes

### ux-end-user-auditor

Avaliar:
- orientação;
- descoberta;
- linguagem;
- próxima ação;
- recuperação de erro;
- necessidade de treinamento.

Entregar score:
`Facilidade de navegação sem treinamento: X/10`.

### ux-operational-task-auditor

Executar tarefas ponta a ponta.

Classificar:
- PASS;
- PASS WITH FRICTION;
- FAIL.

Entregar score:
`Continuidade entre módulos: X/10`.

### ux-visual-accessibility-auditor

Avaliar:
- hierarquia visual;
- legibilidade;
- tabelas;
- formulários;
- status;
- teclado/foco/labels;
- impressão.

Entregar scores:
- Legibilidade;
- Consistência;
- Acessibilidade básica;
- Documentos impressos.

## 4. Consolidação UX

Após os três agentes:

criar:

`docs/UX_AUDIT.md`

Não colar simplesmente as três respostas.

Consolidar findings duplicados.

Estrutura:

### Executive Summary

- score navegação sem treinamento;
- score continuidade;
- score visual;
- quantos CRITICAL/HIGH/MEDIUM/LOW.

### Top UX Risks

Somente riscos observados.

### Task Matrix

| Persona | Tarefa | Resultado | Fricção | Evidência |

### Findings

| ID | Severidade | Fluxo/Tela | Evidência | Impacto no usuário | Correção mínima | Backlog? |

### Training Required

Listar tarefas que atualmente exigiriam treinamento explícito.

### What Already Works

Somente evidências positivas concretas.

## 5. Personas de auditoria

Não criar dezenas.

Usar cinco perspectivas práticas:

### Comercial
Projeto, amostra, precificação, orçamento.

### Compras
Fornecedor, OC, recebimento.

### Produção
Pedido, OP, picking, folha de receita, consumo/output.

### Qualidade
CoA, lote, liberação/bloqueio.

### Administrativo/Gestão
Cadastros, relatórios, custos.

Cada agente deve considerar que o usuário não conhece nomes de entidades internas.

## 6. Fluxo comercial completo

Executar pela UI:

Dashboard
→ Projetos
→ Novo Projeto
→ produto técnico DEVELOPMENT
→ Formulação
→ EC
→ CALC
→ Precificação
→ faixas
→ Quote
→ Send
→ Accept
→ Approve Project
→ mesmo Product APPROVED.

Validar tecnicamente:
- não duplica Product;
- não duplica Formula;
- preserva EC/CALC/PREC.

Validar UX:
- próxima ação é encontrável;
- usuário não precisa voltar repetidamente ao menu;
- FlowContext ajuda;
- labels explicam o que está faltando;
- estados DEVELOPMENT/APPROVED são compreensíveis.

## 7. Quote manual

Executar:

Project
→ Quote MANUAL
→ SENT
→ ACCEPTED
→ Approve.

Confirmar:
- fluxo continua fácil de encontrar;
- pricing estruturado não parece obrigatório;
- diferença entre preço manual e precificação é clara.

## 8. Samples

Executar:

Project
→ Nova amostra T1
→ consumo de lote
→ PRODUCED
→ REJECTED
→ T2
→ APPROVED.

Avaliar:
- como usuário descobre "Nova amostra";
- como chega ao consumo;
- feedback de lot/quality;
- como cria próximo teste;
- Project não parece aprovado por causa da Sample APPROVED.

## 9. Compras

Executar pela navegação normal:

shortage
→ Purchase Suggestion
→ fornecedor
→ MOQ
→ Draft PO
→ ORDERED
→ Receipt parcial.

Avaliar:
- diferença entre shortage, sugestão e OC;
- fornecedor homologado/preferencial compreensível;
- price reference não parece custo real;
- remaining quantity está clara.

## 10. Recebimento / Qualidade

Executar:

Receipt
→ Lot
→ CoA
→ Quality Release.

Testar também um bloqueio.

UX deve dizer:
- por que lote não pode ser usado;
- qual é a próxima ação;
- CoA aprovado não significa automaticamente Quality Released.

## 11. Customer-owned material

Cliente A:
→ receipt customer-supplied
→ Lot owner A
→ utilização por Project/OP A.

Cliente B:
→ tentativa de utilização
→ recusada.

Avaliar se "Proprietário: Cliente X" é impossível de confundir com estoque Veridi.

## 12. Produção

Executar:

Customer Order
→ atendimento
→ OP
→ Release
→ reservation
→ picking
→ Recipe Sheet
→ consumption
→ output
→ completion.

UX:
- usuário sempre sabe qual Pedido/Cliente/Product está operando;
- diferença Planned/Pesado;
- lote escaneado retorna feedback útil;
- separação entre reserva e consumo é inteligível;
- conclusão tem feedback.

## 13. Custo da OP

Validar:

Materiais realizados
+
Custos industriais padrão aplicados.

Não permitir UX que pareça afirmar:
- horas reais;
- energia real;

quando não foram medidas.

## 14. Expedição

Executar:

Order
→ Shipment DRAFT
→ verification
→ partial/full confirmation.

UX:
- X/Y conferidos;
- lote esperado;
- quantidade;
- próxima ação;
- confirmação claramente irreversível.

## 15. Faturamento

Executar:

shipment confirmado
→ awaiting billing
→ Billing.

Confirmar:
- somente shipped;
- documento claramente não fiscal;
- usuário entende a origem.

## 16. Estoque

Auditar:

Posição
Lotes
Movimentações
Materiais de Clientes
Traceability.

Testar se usuário entende sem treinamento técnico:

Físico
Reservado
Disponível
Em Compra.

## 17. Localização de informação

Cada agente deve executar testes simples de descoberta:

"Quero saber o estoque deste item."
"Quero saber de qual lote saiu este pedido."
"Quero ver o que está aguardando CoA."
"Quero ver pedidos aguardando faturamento."
"Quero encontrar a precificação de um produto."
"Quero saber qual fornecedor está homologado."

Registrar:
- onde começou;
- quantos passos;
- se encontrou naturalmente;
- se teve de usar conhecimento prévio.

## 18. Dashboard

Auditar:

- ações rápidas;
- Attention Groups;
- nomes de cards;
- excesso/ausência de informação;
- links "Ver todos";
- destino filtrado;
- entendimento do que precisa de ação hoje.

Pergunta:

"O Dashboard ajuda a começar o dia ou é apenas um painel de números?"

## 19. Sidebar

Auditar com usuário mentalmente novo:

- agrupamentos;
- nomenclatura;
- ordem;
- itens que parecem pertencer a dois lugares;
- descoberta de Quality/Reports/Cost/Pricing;
- sidebar collapsed.

Não propor reestruturação sem evidência.

## 20. Lists / Tables

Com dados reais:

795 Items
248 Projects
639 SupplierItems
etc.

Avaliar:
- scanning;
- filtros;
- filtros persistentes;
- limpar filtros;
- ação principal;
- ⋯;
- código legado;
- status.

Não transformar tabelas em cards.

## 21. Forms

Auditar pelo menos:

Project
Item
PO
Receipt
Sample
Cost line
Pricing tier
Quote.

Verificar:
- obrigatórios;
- UOM;
- labels;
- ajuda;
- erros;
- Cancel/Save;
- campos financeiros;
- Decimal.

## 22. Errors

Criar erros intencionais seguros:

- Product DEVELOPMENT em Pedido;
- wrong Customer Lot;
- CoA pending;
- quantity > available;
- pricing tier quantity mismatch;
- quote linked price edit;
- inactive supplier candidate.

Avaliar mensagem para usuário.

HTTP 400/409 tecnicamente correto não basta.

Mensagem deve permitir recuperação.

## 23. Back/Continue navigation

Para cada fluxo, registrar:
- usuário consegue voltar;
- existe próximo CTA;
- precisa usar browser back;
- precisa retornar ao menu;
- perde filtro;
- perde contexto.

Finding HIGH se tarefa frequente vira "beco sem saída".

## 24. Prints

Visualmente validar:

FO-01
FO-02
FO-03
FO-04
FO-05
Quote
OC
Receipt
R.PRO.002
R.COQ.003
Shipment
Billing
Traceability
CALC
PREC
R-18
R-19
R-20.

UX visual agent lidera esta parte.

Critérios:
- logo;
- sem AppShell;
- A4;
- preto e branco;
- business codes;
- unknown = —;
- page breaks;
- campos para papel;
- confidencialidade.

## 25. Branding

Confirmar:
- logo oficial;
- favicon;
- shell;
- print;
- sem requests externas.

## 26. Roles

Smoke:

ADMIN
COMMERCIAL
PRODUCTION
QUALITY
PURCHASING
VIEWER.

Além de segurança, avaliar UX:

usuário vê ações que nunca poderá executar?

Se backend responde 403 para ação visível sem razão, registrar fricção.

Não criar RBAC novo.

## 27. Reports

Smoke R-01 a R-20:

- encontra no Hub;
- aliases ajudam;
- filtros;
- CSV quando aplicável;
- print;
- DocLinks.

Também testar descoberta:

"Kardex"
"necessidade de produção"
"orçamento x precificação".

## 28. Corpus / migration

Executar:

pnpm veridi:import:validate
pnpm veridi:import:plan
pnpm veridi:import:verify

Não APPLY sem necessidade.

Confirmar baselines.

## 29. Baselines esperados

Formula:
26 / 26 / 0.

CMV:
6 comparáveis
0 match
6 divergentes
46 insuficientes.

Pricing:
27 rows / 9 products.

CoA:
829 / 265 / 14 / 550.

Qualquer alteração deve ser explicada.

## 30. Findings que não devem ser corrigidos aqui

Não corrigir:

- CMV ~1,2;
- 8 Products CMV sem match;
- 60 item codes;
- 86 price UOM;
- 29 samples;
- opening balances;
- CNPJ;
- revisão R.PRO.002;
- revisão R.COQ.003.

## 31. Regulatory inventory only

NÃO implementar Bloco H.

Somente inventariar o que existe:

- declaredNutrient;
- chemical/source form;
- target age;
- dose;
- doses/package;
- purity;
- IN28 source fields;
- formula composition;
- presentation.

Criar:

`docs/BLOCK_H_VALIDATION.md`

com:
- dados existentes;
- lacunas;
- ambiguidades;
- perguntas para a Veridi.

## 32. Perguntas mínimas para Bloco H

Incluir:

1. categorias de produtos fabricadas;
2. normas/fontes oficiais usadas;
3. regra de dose e %VD;
4. faixas etárias;
5. interpretação operacional da IN28;
6. nutriente declarado vs componente técnico;
7. chemical/source form;
8. pureza/potência e rótulo;
9. tolerâncias;
10. grupos especiais;
11. formato de tabela/rotulagem;
12. alertar vs bloquear;
13. responsável regulatório;
14. versionamento da norma;
15. documentos reais de validação.

Não responder por inferência.

## 33. Demo readiness

Criar:

`docs/DEMO_SCRIPT.md`.

30–45 min.

História preferida:

Dashboard
→ Project
→ brief
→ Sample
→ Formula
→ Cost
→ Pricing
→ Quote
→ Approval
→ Order
→ Production
→ Quality/Lot
→ Shipment
→ Billing
→ Traceability
→ Reports/FO.

Para cada etapa registrar:
- mensagem que queremos demonstrar;
- dados necessários;
- CTA;
- duração aproximada;
- fallback se dado não existir.

## 34. UX Demo Walkthrough

Antes de considerar Demo Ready:

pedir ao `ux-end-user-auditor` para percorrer o roteiro de demo SEM instruções de rota.

Se o agente ficar perdido:

o roteiro não está pronto.

Corrigir apenas quick wins pequenos ou registrar HIGH.

## 35. Product audit

Criar:

`docs/PRODUCT_AUDIT.md`.

Somente problemas observados.

CRITICAL:
- corrupção/estoque;
- cross-customer;
- rastreabilidade;
- custo errado silencioso;
- confidencialidade;
- fluxo principal impossível.

HIGH:
- fluxo principal exige workaround/conhecimento prévio relevante.

MEDIUM:
- atrito recorrente.

LOW:
- polish.

## 36. UX evidence

Para findings HIGH/CRITICAL UX:

obrigatório incluir:
- rota/tela;
- ação tentada;
- resultado;
- screenshot quando útil;
- recomendação mínima.

Evitar opiniões abstratas.

## 37. Screenshots

Guardar em:

handoff/screens/audit-*

Não gerar centenas.

Capturar:
- principais HIGH/CRITICAL;
- dashboard;
- sidebar;
- Project flow;
- OP;
- Quality;
- Shipment;
- representative print.

## 38. Quick wins

Após consolidação dos agentes:

pode corrigir no gate SOMENTE quick win que:

- não muda regra de negócio;
- não cria entidade;
- não cria novo workflow;
- é pequeno;
- reduz finding HIGH/MEDIUM claramente.

Exemplos:
- label;
- CTA;
- link;
- ordem visual;
- empty state;
- mensagem de erro;
- filtro default.

Não implementar redesign grande.

## 39. Re-audit após correção

Se corrigir UX:

o MESMO agente que encontrou o problema deve validar de novo.

Não marcar resolvido apenas porque o código parece correto.

## 40. Security smoke

Checar:
- auth;
- customer ownership;
- attachments;
- pricing confidentiality;
- user admin;
- document download.

Não pentest.

## 41. Performance

Registrar somente problemas visíveis ao usuário.

Exemplo:
- lista demora perceptivelmente;
- filtro trava;
- tela dispara chamadas excessivas.

Não benchmark formal.

## 42. Tests

Executar:

pnpm test
pnpm typecheck
pnpm build
pnpm veridi:import:validate.

Adicionar teste apenas:
- bug corrigido;
- regressão real;
- UX behavior importante corrigido.

## 43. Commits

Se somente docs:

chore: complete post-block-g product and ux audit

Se correções:

fix: address post-block-g audit regressions
+
chore: complete post-block-g product and ux audit

## 44. Entrega final

Reportar SOMENTE:

1. resultado técnico geral;
2. score UX navegação;
3. score continuidade entre módulos;
4. scores visual/acessibilidade/print;
5. CRITICAL findings;
6. HIGH findings;
7. MEDIUM principais;
8. quick wins corrigidos;
9. itens UX em backlog;
10. fluxo comercial;
11. samples;
12. compras/qualidade;
13. produção;
14. expedição/faturamento;
15. estoque/rastreabilidade;
16. custos/precificação;
17. confidencialidade/roles;
18. prints;
19. reports;
20. migration/corpus baselines;
21. Demo Readiness;
22. treinamento necessário hoje;
23. perguntas Bloco H;
24. testes/typecheck/build;
25. commits.

NÃO implementar Bloco H.

PARAR após este gate.
