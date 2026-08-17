# Bloco H — Inventário de dados regulatórios e perguntas de validação

> **Este documento não implementa nada.** O Bloco H (regulatório / rotulagem /
> ANVISA / IN 28) continua sendo um *hard gate*: nenhuma regra de dose, %VD,
> limite por faixa etária ou formato de rótulo foi codificada, e nenhuma
> resposta abaixo foi inferida. Aqui estão apenas (1) o que já existe no
> sistema, (2) o que falta, (3) o que é ambíguo e (4) o que precisamos ouvir
> da Veridi antes de qualquer especificação.
>
> Levantamento executado em 2026-08-16 sobre o banco `veridi_dev` com o corpus
> real importado (795 itens, 214 produtos, 248 projetos).

---

## 1. O que já existe hoje

### 1.1 No banco (campos de cadastro, sem regra associada)

| Onde | Campo | Preenchido | Observação |
|---|---|---|---|
| `Item` | `declaredNutrient` | 560 / 795 (465 de 478 matérias-primas) | denominação nutricional declarada ("Vitamina B1") |
| `Item` | `sourceName` | 581 / 795 (478 de 478 MP) | fonte / forma química ("Cloridrato de tiamina") — **texto livre**, não existe entidade `Source` |
| `Item` | `defaultPurityPercent` | 143 / 795 | pureza padrão; `null` significa DESCONHECIDA, nunca 100 % |
| `Item` | `family` | 454 / 795 | `VITAMIN` 46 · `AMINO_ACID` 30 · `EXCIPIENT` 3 · `OTHER_RAW_MATERIAL` 336 · `PACKAGING` 39 · sem família 341 |
| `FormulationComponent` | `purityPercentApplied` | 26 / 1701 | pureza congelada na formulação (só nas versões criadas pelo sistema; o legado importado não trouxe pureza) |
| `Product` | `dosageForm`, `presentationType`, `capsulesPerDose`, `doseAmount` + `doseUomCode`, `dosesPerPackage`, `targetAgeGroup`, `shelfLifeMonths`, `unitsPerShippingBox`, `minimumBatchQuantity`, `businessLotCode` | **0 / 214 em todos** | o schema existe desde a capacidade 33; o corpus legado não trouxe nenhum desses valores |
| `Project` | `dosageForm`, `presentationType`, `doseAmount`, `dosesPerPackage`, `targetAgeGroup` | **0 / 248 em todos** | idem |

Enums já modelados (descritivos, sem efeito regulatório):

- `DosageForm`: CAPSULE · POWDER · TABLET · LIQUID · OTHER
- `PresentationType`: POT · POUCH · CARTON · BULK · BOTTLE · OTHER
- `TargetAgeGroup`: ADULT · CHILD · PREGNANT · LACTATING · OTHER
- `ItemFamily`: VITAMIN · MINERAL · AMINO_ACID · PROTEIN · FIBER · CARBOHYDRATE · BIOACTIVE · EXCIPIENT · OTHER_RAW_MATERIAL · PACKAGING *(conforme schema)*

### 1.2 Nos CSVs do corpus (fora do banco)

**`in28_limites.csv` — 1016 linhas, `DEFERRED_IN28`, nunca importado.**

- colunas: `nutriente`, `faixa_etaria`, `minimo`, `maximo`, `raw`;
- 127 nutrientes distintos × 8 faixas etárias;
- faixas presentes: `0 a 6 meses`, `7 a 11 meses`, `1 a 3 anos`, `4 a 8 anos`,
  `9 a 18 anos`, `Maiores de 19 anos`, `Gestantes`, `Lactantes`;
- valores vêm como texto com unidade embutida (`"0,03mg"`), não como número + UOM.

**`itens_enriquecimento.csv` — 551 linhas, importado para os campos de `Item`.**

- colunas: `cod_item`, `familia`, `materia_prima_fonte`, `nutriente`, `grau_pureza`;
- 309 linhas **sem** grau de pureza; 96 linhas **sem** família;
- famílias no arquivo são texto legado (`MINERAIS` 135, `SUBT BIOATIVAS` 79,
  `VITAMINA` 46, `PROTEINAS` 45, `Embalagem` 32, `FIBRAS` 30, `AMINOÁCIDO` 30,
  `OUT. NUTRIENTES` 27, `CARBOIDRATOS` 19, …).

---

## 2. Lacunas

1. **Perfil regulatório do produto está 100 % vazio.** Forma farmacêutica, dose,
   doses por embalagem e público-alvo não existem para nenhum dos 214 produtos.
   Sem esses dados nenhuma regra de rotulagem pode ser aplicada a um produto real.
2. **Não existe "nutriente declarado" no nível do produto** — só no nível do
   item. A tabela nutricional de um produto não é derivável hoje: teria que ser
   composta a partir da formulação × pureza × dose, e a dose não existe.
3. **Pureza é majoritariamente desconhecida** (143 de 795 itens; 309 linhas do
   enriquecimento sem grau). A regra "desconhecido nunca é 100 %" impede
   qualquer cálculo silencioso de teor.
4. **Não há entidade de norma/limite.** Os limites da IN 28 vivem só em CSV, sem
   unidade estruturada, sem versão da norma, sem vigência e sem categoria de produto.
5. **Não há vínculo nutriente ↔ item.** `declaredNutrient` é texto livre; não há
   dicionário controlado que ligue "Vitamina B1" do item à "Vitamina B1" da IN 28.
6. **Não há %VD / IDR.** O CSV só traz mínimo e máximo por faixa etária; não há
   valor diário de referência para calcular percentual.
7. **Não há campo de responsável regulatório, aprovação ou versão de rótulo.**

---

## 3. Ambiguidades observadas (não resolver por inferência)

| # | Ambiguidade | Por que não decidimos sozinhos |
|---|---|---|
| A1 | `minimo`/`maximo` da IN 28: por dose? por dia? por porção? por 100 g? | O CSV não diz. Cada interpretação muda todo o cálculo. |
| A2 | Unidade embutida no texto (`"0,03mg"`, `"2,14mg"`) | Precisa normalização mg/mcg/UI, e UI depende do nutriente e da forma química. |
| A3 | Faixas etárias do CSV × enum `TargetAgeGroup` | O enum tem 5 valores descritivos; o CSV tem 8 faixas. Não são o mesmo eixo. |
| A4 | `declaredNutrient` × `sourceName` | "Magnésio" declarado pode vir de citrato, bisglicinato, óxido — cada um com teor elementar diferente. Não há tabela de teor. |
| A5 | Família legada (`SUBT BIOATIVAS`, `OUT. NUTRIENTES`) × `ItemFamily` | Mapeamento nunca foi classificado automaticamente, por decisão explícita. |
| A6 | Pureza `null` | Nunca lida como 100 %. Se a regulatória exigir teor, 309 itens ficam sem base. |
| A7 | Categoria do produto | Suplemento alimentar, alimento para fins especiais, uso enteral… nada disso está cadastrado. Os limites da IN 28 dependem da categoria. |

---

## 4. As 15 perguntas para a Veridi

Nenhuma destas foi respondida por inferência. Todas bloqueiam a especificação
do Bloco H.

1. **Categorias de produtos fabricadas.** Quais categorias regulatórias a Veridi
   efetivamente fabrica hoje (suplemento alimentar, alimento para fins especiais,
   composto lácteo, cosmético, uso veterinário…)? Alguma delas está fora da IN 28?
2. **Normas e fontes oficiais usadas.** Além da IN 28, quais atos são usados na
   prática (RDC 243/2018, RDC 429/2020, IN 75/2020, tabela de IDR)? Qual documento
   é a fonte de verdade quando dois divergem?
3. **Regra de dose e %VD.** O %VD é calculado sobre a dose diária recomendada,
   sobre a porção, ou sobre a unidade? Quando a dose diária tem faixa
   ("1 a 3 cápsulas"), qual valor entra no rótulo?
4. **Faixas etárias.** As 8 faixas do CSV são as oficiais que a Veridi usa? Como
   se relacionam com o público-alvo comercial (adulto / infantil / gestante)?
   Um produto pode declarar mais de uma faixa?
5. **Interpretação operacional da IN 28.** Os limites mínimo/máximo do arquivo
   valem por dose diária, por porção ou por unidade? Eles são limites de
   *declaração* ou de *adição*?
6. **Nutriente declarado × componente técnico.** Quando um item entra na
   formulação, o que vai ao rótulo: o nutriente declarado, a fonte, ou os dois?
   Excipientes entram na tabela nutricional?
7. **Forma química / fonte.** Precisamos de um cadastro estruturado de fonte com
   teor elementar (ex.: citrato de magnésio = 16 % de magnésio elementar)? Quem
   é o dono desse dado? Existe planilha atual?
8. **Pureza e potência no rótulo.** O valor declarado é calculado com a pureza
   real do lote, com a pureza padrão do item, ou é sempre o valor nominal de
   formulação? Como tratamos os 309 itens sem pureza conhecida?
9. **Tolerâncias.** Qual tolerância é aceita entre valor declarado e valor
   analisado (±20 %? por classe de nutriente?)? Ela é verificada no laudo do
   produto acabado? Quem aprova o desvio?
10. **Grupos especiais.** Gestantes, lactantes, crianças e idosos exigem
    advertência obrigatória, limite diferente, ou ambos? Existe lista de
    advertências padrão que a Veridi já usa?
11. **Formato de tabela / rotulagem.** Qual layout de tabela nutricional a Veridi
    entrega hoje (arquivo, modelo, exemplo real)? O sistema deve gerar o rótulo,
    gerar só a tabela, ou apenas conferir um rótulo feito fora?
12. **Alertar vs bloquear.** Quando uma formulação viola um limite: bloqueia a
    ativação da versão, bloqueia a aprovação do projeto, ou apenas alerta e
    registra? Existe alçada para liberar exceção?
13. **Responsável regulatório.** Quem assina/aprova a conformidade — papel novo
    no sistema (RT) ou responsabilidade da Qualidade? Precisa registro assinado
    e versionado?
14. **Versionamento da norma.** Quando a ANVISA atualiza um limite, o que
    acontece com produtos já aprovados: revalidação obrigatória, alerta, ou o
    rótulo permanece congelado com a norma vigente na aprovação?
15. **Documentos reais de validação.** A Veridi pode fornecer 3 a 5 rótulos
    reais aprovados (com a formulação correspondente) para usarmos como golden
    de validação? Sem isso, qualquer motor regulatório será testado só contra a
    nossa própria interpretação.

---

## 5. Consequência prática

Enquanto 1–15 não forem respondidas:

- nenhum campo regulatório novo é criado;
- `in28_limites.csv` continua `DEFERRED_IN28` (somente conferência);
- os campos de perfil do produto continuam sendo cadastro descritivo, sem regra;
- nenhuma tela de rotulagem é desenhada.
