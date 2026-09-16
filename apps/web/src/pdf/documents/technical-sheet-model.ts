import {
  DOSAGE_FORM_LABELS,
  FORMULATION_COMPONENT_BASIS_LABELS,
  FORMULATION_VERSION_STATUS_LABELS,
  ITEM_FAMILY_LABELS,
  PRESENTATION_TYPE_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
  TARGET_AGE_GROUP_LABELS,
  ajustesAutorizados,
  capsulasPorEmbalagem,
  rendimentoEsperado,
  resumirDoses,
  textoDecimal,
} from "@veridi/shared";
import type {
  FormulationComponentDTO,
  FormulationVersionDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { formatIntegerPtBr, formatPdfDateTime, formatQuantityWithUnit } from "../format";

/**
 * O READ MODEL da Ficha Técnica — neutro de propósito.
 *
 * O documento (`TechnicalSheetPdf`) não conhece `FormulationVersionDTO` nem
 * `FormulationTemplateVersionDTO`: conhece esta estrutura, que já é a ficha
 * pronta para desenhar. Ela tem duas partes.
 *
 * - A MOLDURA diz o que o papel é: título, cabeçalho, rodapé, identificação,
 *   avisos e nome do arquivo. Quem decide é o adaptador da fonte — a ficha do
 *   Produto (`fichaTecnicaDaVersao`, aqui) e a do Modelo de Formulação
 *   (`fichaTecnicaDoModelo`, em `technical-sheet-template-model.ts`). O
 *   documento não escreve "produto" nem "modelo" por conta própria.
 * - O CORPO TÉCNICO é o mesmo nas duas: forma e apresentação, premissas de
 *   produção, composição, embalagem e resumo da dose (`corpoTecnico`).
 *
 * NENHUMA CONTA NASCE AQUI. Alvo, física por dose, por cápsula e por embalagem
 * vêm do motor canônico de `@veridi/shared` — no DTO da Formulação, calculados
 * pela API; no Modelo, pelas mesmas funções que a bancada e a API chamam. O
 * que a ficha ainda soma — massa da dose, cápsulas por embalagem, rendimento —
 * sai dos MESMOS helpers. O PDF não é uma segunda autoridade matemática.
 *
 * E nenhum custo entra: ficha técnica é técnica. Preço, CMV, margem e
 * fornecedor comercial têm os seus próprios documentos.
 */

/** Uma linha da composição ou da embalagem, como o papel a lê. */
export interface FichaTecnicaLinha {
  key: string;
  codigo: string;
  nome: string;
  /** Fonte/função do ingrediente, pelo cadastro do Item. `null` some do papel. */
  fonte: string | null;
  /** Família e nutriente declarado, sob a fonte. */
  fonteDetalhe: string | null;
  /** SNAPSHOT da pureza aplicada NESTA versão — nunca a do cadastro de hoje. */
  purezaPercent: string | null;
  /** A pureza do cadastro ATUAL, só quando difere da histórica. */
  purezaDoCadastroHoje: string | null;
  /** Versão histórica com pureza gravada que a conta não usou. */
  purezaNaoAplicada: boolean;
  /** Alvo declarado para uma dose, na unidade da linha. */
  alvoPorDose: string | null;
  /** O que a fábrica pesa para uma dose, na unidade da linha. */
  fisicaPorDose: string | null;
  /** Física de uma cápsula, na unidade da linha; `null` fora da forma cápsula. */
  porCapsula: string | null;
  /** Unidade declarada da linha — a de `alvoPorDose`/`fisicaPorDose`. */
  unidade: string;
  /** Quantidade declarada, como está gravada na versão. */
  quantidade: string;
  reservaPercent: string | null;
  /** Necessidade física de uma embalagem acabada, na unidade de estoque. */
  porEmbalagem: string | null;
  unidadeDeEstoque: string;
  /** Propriedade do material declarada na fórmula: Veridi ou Cliente. */
  materialFornecidoPor: string;
  baseLabel: string;
  /** Item inativado no cadastro depois de a versão ter sido escrita. */
  itemInativo: boolean;
}

/** Grandeza da versão com a unidade em que ela foi declarada. */
export interface FichaTecnicaGrandeza {
  quantidade: string;
  unidade: string | null;
}

/** Um campo rotulado que a FONTE decide — já escrito como o papel o mostra. */
export interface CampoDaFicha {
  rotulo: string;
  /** `null` é dado ausente: sai "—", ou some do papel quando `opcional`. */
  valor: string | null;
  /** Largura em colunas de 12. */
  largura: number;
  opcional?: boolean;
}

/** Uma frase no topo da folha: rascunho, versão histórica, modelo fora da biblioteca. */
export interface AvisoDaFicha {
  destaque: string;
  texto: string;
}

/**
 * O que o papel É — decidido por quem adapta a fonte.
 *
 * Folha solta circula: o título, a primeira linha do cabeçalho e o rodapé têm
 * de dizer, sem ambiguidade, de que entidade a ficha fala.
 */
export interface MolduraDaFicha {
  titulo: string;
  /** Código que nomeia a fonte: "PROD-000174", "FT-000001". */
  codigo: string;
  /** Linhas curtas do cabeçalho, antes do carimbo da geração. */
  linhasDoCabecalho: string[];
  /** Natureza do documento, no rodapé de toda folha. */
  rodape: string;
  /** Prefixo do arquivo baixado: "ficha-tecnica", "ficha-tecnica-modelo". */
  prefixoDoArquivo: string;
  avisos: AvisoDaFicha[];
  identificacao: CampoDaFicha[];
  /** Campos só da fonte que fecham "Forma e apresentação" (faixa etária do Produto). */
  apresentacaoExtra: CampoDaFicha[];
  /** O que NÃO é snapshot da versão, sob um subtítulo que diz de onde vem. */
  foraDaVersao: { titulo: string; campos: CampoDaFicha[] } | null;
}

/**
 * Quais campos da forma o papel mostra.
 *
 * - `capsula`: cápsulas por dose e por embalagem, e a coluna "Por cápsula";
 * - `po`: dose e conteúdo da embalagem. É também o que a ficha do Produto
 *   mostra quando a versão não registrou forma — é o papel homologado;
 * - `omitida`: a forma não foi informada, e nada que dependa dela sai.
 */
export type CamposDaForma = "capsula" | "po" | "omitida";

export interface FichaTecnica {
  moldura: MolduraDaFicha;
  versaoLabel: string;
  versaoNumero: number;
  statusLabel: string;
  isDraft: boolean;

  camposDaForma: CamposDaForma;
  formaLabel: string | null;
  apresentacaoLabel: string | null;
  /** `true` só na forma cápsula: é o que liga as colunas e campos por cápsula. */
  porCapsula: boolean;
  capsulasPorDose: number | null;
  capsulasPorEmbalagem: number | null;
  /** Forma pó: dose e conteúdo da embalagem, com a unidade da versão. */
  dose: FichaTecnicaGrandeza | null;
  conteudoDaEmbalagem: FichaTecnicaGrandeza | null;
  dosesPorEmbalagem: number | null;

  perdaPrevistaPercent: string | null;
  rendimentoEsperadoPercent: string | null;

  composicao: FichaTecnicaLinha[];
  embalagem: FichaTecnicaLinha[];

  /** Totais técnicos da dose, em mg, pelo motor compartilhado. */
  massaPorDose: string | null;
  alvoPorDose: string | null;
  massaPorCapsula: string | null;
  /** Linhas por dose que ficaram fora da soma — unidade que não é massa. */
  linhasForaDaSoma: number;
}

/** O corpo técnico — a parte que a Formulação e o Modelo desenham igual. */
export type CorpoTecnico = Omit<
  FichaTecnica,
  "moldura" | "versaoLabel" | "versaoNumero" | "statusLabel" | "isDraft"
>;

/**
 * A linha como as duas fontes a entregam: o componente da Formulação já é
 * este contrato (a API calculou os derivados); o do Modelo chega a ele com os
 * derivados do mesmo motor. Os nomes são os do DTO — a bancada compartilhada
 * lê um contrato só, e a ficha também.
 */
export type ComponenteDaFicha = Pick<
  FormulationComponentDTO,
  | "id"
  | "itemCode"
  | "itemName"
  | "itemType"
  | "itemActive"
  | "itemSourceName"
  | "itemDeclaredNutrient"
  | "itemFamily"
  | "itemDefaultPurityPercent"
  | "quantity"
  | "unitCode"
  | "stockUnitCode"
  | "basis"
  | "supplyResponsibility"
  | "purityPercentApplied"
  | "overagePercent"
  | "quantityMode"
  | "applyPurityAdjustment"
  | "applyOverageAdjustment"
  | "position"
  | "theoreticalPerDose"
  | "physicalPerDose"
  | "physicalPerCapsule"
  | "physicalPerUnit"
>;

/** As premissas técnicas que a Formulação e o Modelo gravam com os MESMOS nomes. */
export type PremissasDaFicha = Pick<
  FormulationVersionDTO,
  | "dosageForm"
  | "presentationType"
  | "capsulesPerDose"
  | "doseAmount"
  | "doseUomCode"
  | "packageContentAmount"
  | "packageContentUomCode"
  | "dosesPerPackage"
  | "expectedLossPercent"
>;

/** Unidade de massa em que o resumo da dose é somado — a mesma da bancada. */
const UNIDADE_DO_RESUMO = "mg";

export const TECHNICAL_SHEET_FOOTER_NOTE =
  "Documento interno — descreve a versão da formulação registrada no sistema.";

/** As unidades como o motor compartilhado as consome. */
export function unidadesDoMotor(units: readonly UnitOfMeasureDTO[]) {
  return units.map((unit) => ({
    code: unit.code,
    dimension: unit.dimension,
    toBaseFactor: unit.toBaseFactor,
  }));
}

/**
 * As duas seções da ficha, pelo TIPO REAL do Item — nunca pelo nome.
 *
 * É a mesma regra da bancada: "cápsula" é matéria-prima num produto e
 * embalagem em outro, e quem responde isso é o cadastro. Produto acabado numa
 * receita é erro de versão em rascunho; fica na composição, onde a tela já
 * explica por que a versão não ativa.
 */
function ehEmbalagem(component: ComponenteDaFicha): boolean {
  return component.itemType === "PACKAGING";
}

/** Texto que o papel escreve, ou `null` quando não há dado. */
export function texto(valor: string | null | undefined): string | null {
  return valor !== null && valor !== undefined && valor.trim() !== "" ? valor : null;
}

/**
 * A pureza do cadastro de HOJE, e só quando difere da aplicada na versão.
 *
 * A ficha representa a VERSÃO: a pureza histórica nunca é substituída. Mas
 * calar a divergência esconderia justamente o que explica a receita antiga não
 * bater com o item de agora — a nota sai ao lado, jamais no lugar.
 *
 * A comparação é por TEXTO normalizado: "70" e "70.000000" são o mesmo número
 * e não podem virar divergência.
 */
function purezaDivergente(component: ComponenteDaFicha): string | null {
  const hoje = texto(component.itemDefaultPurityPercent);
  const aplicada = texto(component.purityPercentApplied);
  if (hoje === null) return null;
  if (aplicada !== null && mesmoDecimal(hoje, aplicada)) return null;
  return hoje;
}

/** Dois decimais-string são o mesmo número? Sem `Number` e sem aritmética. */
function mesmoDecimal(a: string, b: string): boolean {
  return normalizarDecimal(a) === normalizarDecimal(b);
}

function normalizarDecimal(valor: string): string {
  const limpo = valor.trim();
  if (!limpo.includes(".")) return limpo;
  return limpo.replace(/\.?0+$/, "");
}

/** Dois nomes que só diferem em caixa e espaço são o mesmo nome. */
function mesmoNome(a: string | null, b: string): boolean {
  return a !== null && a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");
}

function linhaDaFicha(component: ComponenteDaFicha, comCapsula: boolean): FichaTecnicaLinha {
  const familia = component.itemFamily ? ITEM_FAMILY_LABELS[component.itemFamily] : null;
  /*
   * O nutriente declarado só entra quando DIZ algo além do nome do
   * ingrediente. No dado real ele costuma ser o próprio nome ("Goma Xantana",
   * "ÁCIDO CÍTRICO"), e repeti-lo ao lado gastava a largura de uma coluna A4
   * para escrever duas vezes a mesma palavra. Quando ele é outra coisa —
   * "Vitamina B12" sob "Metilcobalamina" — é justamente o que a ficha existe
   * para dizer, e continua saindo.
   */
  const nutriente = mesmoNome(component.itemDeclaredNutrient, component.itemName)
    ? null
    : texto(component.itemDeclaredNutrient);
  const detalhe = [familia, nutriente]
    .filter((parte): parte is string => parte !== null)
    .join(" · ");
  return {
    key: component.id,
    codigo: component.itemCode,
    nome: component.itemName,
    fonte: texto(component.itemSourceName),
    fonteDetalhe: detalhe === "" ? null : detalhe,
    purezaPercent: texto(component.purityPercentApplied),
    purezaDoCadastroHoje: purezaDivergente(component),
    /*
     * Versão gravada sob o contrato antigo: a pureza está ali e não corrigiu
     * nada. Num documento fechado, "70%" ao lado de uma física não corrigida
     * mentiria por omissão.
     */
    purezaNaoAplicada:
      texto(component.purityPercentApplied) !== null && !ajustesAutorizados(component).purity,
    alvoPorDose: component.theoreticalPerDose,
    fisicaPorDose: component.physicalPerDose,
    porCapsula: comCapsula ? component.physicalPerCapsule : null,
    unidade: component.unitCode,
    quantidade: component.quantity,
    reservaPercent: texto(component.overagePercent),
    porEmbalagem: component.physicalPerUnit,
    unidadeDeEstoque: component.stockUnitCode,
    materialFornecidoPor: SUPPLY_RESPONSIBILITY_LABELS[component.supplyResponsibility],
    baseLabel: FORMULATION_COMPONENT_BASIS_LABELS[component.basis],
    itemInativo: !component.itemActive,
  };
}

/**
 * O CORPO TÉCNICO de uma versão — da Formulação ou do Modelo.
 *
 * Tudo que descreve a receita vem da VERSÃO: forma, apresentação, cápsulas por
 * dose, dose, conteúdo, perda prevista, pureza aplicada, reserva, base e
 * fornecimento são snapshots gravados nela, e mudar o cadastro do Produto ou do
 * Item depois não reescreve nenhum deles. É isso que torna o documento
 * reproduzível: gerar a ficha de uma versão hoje e daqui a um ano dá o mesmo
 * papel.
 *
 * `formaNaoInformada` é a única escolha da fonte: a ficha do Produto mostra os
 * campos do pó quando a versão não registrou forma (é o papel homologado); a
 * do Modelo legado omite o que depende da forma.
 */
export function corpoTecnico(
  premissas: PremissasDaFicha,
  componentes: readonly ComponenteDaFicha[],
  units: readonly UnitOfMeasureDTO[],
  formaNaoInformada: "po" | "omitida",
): CorpoTecnico {
  const forma = premissas.dosageForm;
  const comCapsula = forma === "CAPSULE";
  const capsulasNaDose = comCapsula ? premissas.capsulesPerDose : null;
  const camposDaForma: CamposDaForma = comCapsula
    ? "capsula"
    : forma === "POWDER"
      ? "po"
      : forma === null
        ? formaNaoInformada
        : "po";

  const ordenados = [...componentes].sort((a, b) => a.position - b.position);
  const composicao = ordenados.filter((component) => !ehEmbalagem(component));
  const embalagem = ordenados.filter((component) => ehEmbalagem(component));

  /*
   * Totais técnicos da dose pelo MESMO motor das linhas: soma em mg só o que é
   * massa e conta o que ficou de fora — total que omite linha em silêncio
   * parece completo e não é.
   */
  const resumo = resumirDoses(
    composicao
      .filter(
        (component) =>
          component.basis === "PER_DOSE" &&
          component.theoreticalPerDose !== null &&
          component.physicalPerDose !== null,
      )
      .map((component) => ({
        teorica: component.theoreticalPerDose as string,
        fisica: component.physicalPerDose as string,
        unitCode: component.unitCode,
      })),
    capsulasNaDose,
    unidadesDoMotor(units),
  );

  const rendimento = rendimentoEsperado(premissas.expectedLossPercent);

  return {
    camposDaForma,
    formaLabel: forma ? DOSAGE_FORM_LABELS[forma] : null,
    apresentacaoLabel: premissas.presentationType
      ? PRESENTATION_TYPE_LABELS[premissas.presentationType]
      : null,
    porCapsula: comCapsula,
    capsulasPorDose: capsulasNaDose,
    capsulasPorEmbalagem: capsulasPorEmbalagem(capsulasNaDose, premissas.dosesPerPackage),
    /*
     * Dose e conteúdo são a leitura do PÓ. Na cápsula eles não descrevem nada
     * que a pessoa reconheça — e a ficha da cápsula não os mostra.
     */
    dose:
      forma === "POWDER" && texto(premissas.doseAmount) !== null
        ? { quantidade: premissas.doseAmount as string, unidade: premissas.doseUomCode }
        : null,
    conteudoDaEmbalagem:
      forma === "POWDER" && texto(premissas.packageContentAmount) !== null
        ? {
            quantidade: premissas.packageContentAmount as string,
            unidade: premissas.packageContentUomCode,
          }
        : null,
    dosesPorEmbalagem: premissas.dosesPerPackage,

    perdaPrevistaPercent: texto(premissas.expectedLossPercent),
    rendimentoEsperadoPercent:
      rendimento === null || typeof rendimento === "string" ? null : textoDecimal(rendimento),

    composicao: composicao.map((component) => linhaDaFicha(component, comCapsula)),
    embalagem: embalagem.map((component) => linhaDaFicha(component, false)),

    massaPorDose: resumo.somadas === 0 ? null : textoDecimal(resumo.fisicaTotal),
    alvoPorDose: resumo.somadas === 0 ? null : textoDecimal(resumo.teoricaTotal),
    massaPorCapsula:
      resumo.somadas > 0 && resumo.porCapsulaTotal ? textoDecimal(resumo.porCapsulaTotal) : null,
    linhasForaDaSoma: resumo.foraDaSoma,
  };
}

/** Instante do domínio escrito como o papel o mostra; ausente continua ausente. */
export function dataDaFicha(instante: string | null): string | null {
  return instante === null ? null : formatPdfDateTime(instante);
}

/** A origem declarada da versão: outra versão do produto ou um modelo. */
function origemDaVersao(version: FormulationVersionDTO): string | null {
  if (version.originTemplateCode) {
    const nome = texto(version.originTemplateName);
    const versao =
      version.originTemplateVersionNumber === null
        ? ""
        : ` V${version.originTemplateVersionNumber}`;
    return `Modelo ${version.originTemplateCode}${versao}${nome ? ` — ${nome}` : ""}`;
  }
  if (version.sourceVersionNumber !== null) return `Versão V${version.sourceVersionNumber}`;
  return null;
}

/**
 * A versão da formulação vista como FICHA TÉCNICA DO PRODUTO.
 *
 * O corpo é o técnico, snapshot da versão. O que NÃO é da versão sai separado
 * e rotulado como do cadastro do Produto (faixa etária, lote mínimo, caixa de
 * embarque) — misturar as duas origens numa lista só faria o papel afirmar como
 * congelado o que não é.
 */
export function fichaTecnicaDaVersao(
  version: FormulationVersionDTO,
  units: readonly UnitOfMeasureDTO[],
): FichaTecnica {
  const isDraft = version.status === "DRAFT";
  const statusLabel = FORMULATION_VERSION_STATUS_LABELS[version.status];
  const perfil = version.productProfile;

  /*
   * DO CADASTRO DO PRODUTO, não da versão — e o papel diz isso onde as
   * escreve. Elas não são snapshot: mudar o cadastro do Produto muda o que
   * uma ficha gerada amanhã vai mostrar, e afirmá-las ao lado das premissas
   * congeladas, sem distinção, faria o documento prometer o que não cumpre.
   */
  const loteMinimo =
    texto(perfil.minimumBatchQuantity) !== null
      ? formatQuantityWithUnit(perfil.minimumBatchQuantity as string, version.outputUnitCode)
      : null;
  const caixaDeEmbarque =
    perfil.unitsPerShippingBox === null
      ? null
      : `${formatIntegerPtBr(perfil.unitsPerShippingBox)} por caixa`;

  return {
    moldura: {
      titulo: "Ficha técnica do produto",
      codigo: version.productCode,
      linhasDoCabecalho: [`Formulação · ${version.productName}`],
      rodape: TECHNICAL_SHEET_FOOTER_NOTE,
      prefixoDoArquivo: "ficha-tecnica",
      /*
       * RASCUNHO não é só um carimbo no canto: quem recebe a folha solta
       * precisa ler, em uma frase, o que ela significa. A marca do cabeçalho
       * continua lá — esta é a leitura dela.
       */
      avisos: isDraft
        ? [
            {
              destaque: "Versão em rascunho.",
              texto:
                "A receita ainda pode mudar até a ativação — esta ficha não representa uma formulação validada.",
            },
          ]
        : [],
      identificacao: [
        {
          rotulo: "Produto",
          valor: `${version.productCode} — ${version.productName}`,
          largura: 6,
        },
        /* Item de saída da versão — snapshot, nunca a associação atual do Produto. */
        {
          rotulo: "Item de saída",
          valor: `${version.outputItemCode} — ${version.outputItemName}`,
          largura: 4,
        },
        { rotulo: "Unidade", valor: version.outputUnitCode, largura: 2 },
        { rotulo: "Versão da formulação", valor: version.versionLabel, largura: 2 },
        { rotulo: "Situação", valor: statusLabel, largura: 2 },
        { rotulo: "Criada em", valor: formatPdfDateTime(version.createdAt), largura: 3 },
        { rotulo: "Ativada em", valor: dataDaFicha(version.activatedAt), largura: 3, opcional: true },
        {
          rotulo: "Inativada em",
          valor: dataDaFicha(version.inactivatedAt),
          largura: 3,
          opcional: true,
        },
        { rotulo: "Origem", valor: origemDaVersao(version), largura: 4, opcional: true },
      ],
      apresentacaoExtra: [
        {
          rotulo: "Faixa etária",
          valor: perfil.targetAgeGroup ? TARGET_AGE_GROUP_LABELS[perfil.targetAgeGroup] : null,
          largura: 2,
          opcional: true,
        },
      ],
      foraDaVersao:
        loteMinimo !== null || caixaDeEmbarque !== null
          ? {
              titulo: "Do cadastro do produto",
              campos: [
                { rotulo: "Lote mínimo", valor: loteMinimo, largura: 4, opcional: true },
                { rotulo: "Caixa de embarque", valor: caixaDeEmbarque, largura: 4, opcional: true },
              ],
            }
          : null,
    },
    versaoLabel: version.versionLabel,
    versaoNumero: version.versionNumber,
    statusLabel,
    isDraft,
    /*
     * AS OBSERVAÇÕES DA VERSÃO NÃO ENTRAM NA FICHA.
     *
     * São texto livre da bancada, e no dado real elas citam a planilha de CMV,
     * a palavra "overage" e o custo do lote — exatamente o vocabulário que a
     * ficha técnica não pode circular. Não há como prometer um documento sem
     * economia e ao mesmo tempo imprimir um campo em que qualquer pessoa pode
     * escrever qualquer coisa. Elas continuam inteiras na tela da Formulação,
     * que é onde quem monta a receita as lê.
     */
    ...corpoTecnico(version, version.components, units, "po"),
  };
}

/** A unidade em que o resumo da dose é somado — o papel precisa dizê-la. */
export { UNIDADE_DO_RESUMO };
