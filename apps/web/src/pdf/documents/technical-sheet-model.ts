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
  DosageForm,
  FormulationComponentDTO,
  FormulationVersionDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";

/**
 * O READ MODEL da Ficha Técnica do Produto — Formulação.
 *
 * O documento não conhece `FormulationVersionDTO`: conhece esta estrutura, que
 * já é a ficha pronta para desenhar — rótulos resolvidos, linhas separadas por
 * seção, grandezas na forma em que o papel as escreve. Quem produz a estrutura
 * é o adaptador da fonte (`fichaTecnicaDaVersao`); o Modelo de Formulação, que
 * é outra entidade com as mesmas perguntas técnicas, ganha o seu adaptador sem
 * copiar uma linha do documento (FORMULATION-TEMPLATE-WORKBENCH-01).
 *
 * NENHUMA CONTA NASCE AQUI. Alvo, física por dose, por cápsula e por embalagem
 * vêm calculados pelo motor canônico no DTO; o que a ficha ainda soma — massa
 * da dose, cápsulas por embalagem, rendimento — sai dos MESMOS helpers de
 * `@veridi/shared` que a tela e a API usam. O PDF não é uma segunda autoridade
 * matemática.
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

export interface FichaTecnica {
  produtoCodigo: string;
  produtoNome: string;
  versaoLabel: string;
  versaoNumero: number;
  statusLabel: string;
  isDraft: boolean;
  /** Item de saída da versão — snapshot, nunca a associação atual do Produto. */
  itemDeSaida: string;
  unidadeDeSaida: string;

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

  /*
   * DO CADASTRO DO PRODUTO, não da versão — e o papel diz isso onde as
   * escreve. Elas não são snapshot: mudar o cadastro do Produto muda o que
   * uma ficha gerada amanhã vai mostrar, e afirmá-las ao lado das premissas
   * congeladas, sem distinção, faria o documento prometer o que não cumpre.
   */
  faixaEtaria: string | null;
  loteMinimo: FichaTecnicaGrandeza | null;
  unidadesPorCaixaDeEmbarque: number | null;

  composicao: FichaTecnicaLinha[];
  embalagem: FichaTecnicaLinha[];

  /** Totais técnicos da dose, em mg, pelo motor compartilhado. */
  massaPorDose: string | null;
  alvoPorDose: string | null;
  massaPorCapsula: string | null;
  /** Linhas por dose que ficaram fora da soma — unidade que não é massa. */
  linhasForaDaSoma: number;

  criadaEm: string;
  ativadaEm: string | null;
  inativadaEm: string | null;
  /** Origem: versão ou modelo que serviu de molde. */
  origem: string | null;
}

/** Unidade de massa em que o resumo da dose é somado — a mesma da bancada. */
const UNIDADE_DO_RESUMO = "mg";

/** As unidades como o motor compartilhado as consome. */
function unidadesDoMotor(units: readonly UnitOfMeasureDTO[]) {
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
function ehEmbalagem(component: FormulationComponentDTO): boolean {
  return component.itemType === "PACKAGING";
}

/** Texto que o papel escreve, ou `null` quando não há dado. */
function texto(valor: string | null | undefined): string | null {
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
function purezaDivergente(component: FormulationComponentDTO): string | null {
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

function linhaDaFicha(component: FormulationComponentDTO, comCapsula: boolean): FichaTecnicaLinha {
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
 * A versão da formulação vista como ficha técnica.
 *
 * Tudo que descreve a receita vem da VERSÃO — forma, apresentação, cápsulas
 * por dose, dose, conteúdo, perda prevista, pureza aplicada, reserva, base e
 * fornecimento são snapshots gravados nela, e mudar o cadastro do Produto ou
 * do Item depois não reescreve nenhum deles. É isso que torna o documento
 * reproduzível: gerar a ficha de uma versão hoje e daqui a um ano dá o mesmo
 * papel.
 *
 * O que NÃO é da versão sai separado e rotulado como do cadastro do Produto
 * (faixa etária, lote mínimo, caixa de embarque) — misturar as duas origens
 * numa lista só faria o papel afirmar como congelado o que não é.
 */
export function fichaTecnicaDaVersao(
  version: FormulationVersionDTO,
  units: readonly UnitOfMeasureDTO[],
): FichaTecnica {
  const forma: DosageForm | null = version.dosageForm;
  const comCapsula = forma === "CAPSULE";
  const capsulasNaDose = comCapsula ? version.capsulesPerDose : null;

  const componentes = [...version.components].sort((a, b) => a.position - b.position);
  const composicao = componentes.filter((component) => !ehEmbalagem(component));
  const embalagem = componentes.filter((component) => ehEmbalagem(component));

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

  const rendimento = rendimentoEsperado(version.expectedLossPercent);

  const perfil = version.productProfile;

  return {
    produtoCodigo: version.productCode,
    produtoNome: version.productName,
    versaoLabel: version.versionLabel,
    versaoNumero: version.versionNumber,
    statusLabel: FORMULATION_VERSION_STATUS_LABELS[version.status],
    isDraft: version.status === "DRAFT",
    itemDeSaida: `${version.outputItemCode} — ${version.outputItemName}`,
    unidadeDeSaida: version.outputUnitCode,

    formaLabel: forma ? DOSAGE_FORM_LABELS[forma] : null,
    apresentacaoLabel: version.presentationType
      ? PRESENTATION_TYPE_LABELS[version.presentationType]
      : null,
    porCapsula: comCapsula,
    capsulasPorDose: capsulasNaDose,
    capsulasPorEmbalagem: capsulasPorEmbalagem(capsulasNaDose, version.dosesPerPackage),
    /*
     * Dose e conteúdo são a leitura do PÓ. Na cápsula eles não descrevem nada
     * que a pessoa reconheça — e a ficha da cápsula não os mostra.
     */
    dose:
      forma === "POWDER" && texto(version.doseAmount) !== null
        ? { quantidade: version.doseAmount as string, unidade: version.doseUomCode }
        : null,
    conteudoDaEmbalagem:
      forma === "POWDER" && texto(version.packageContentAmount) !== null
        ? {
            quantidade: version.packageContentAmount as string,
            unidade: version.packageContentUomCode,
          }
        : null,
    dosesPorEmbalagem: version.dosesPerPackage,

    perdaPrevistaPercent: texto(version.expectedLossPercent),
    rendimentoEsperadoPercent:
      rendimento === null || typeof rendimento === "string" ? null : textoDecimal(rendimento),

    faixaEtaria: perfil.targetAgeGroup ? TARGET_AGE_GROUP_LABELS[perfil.targetAgeGroup] : null,
    loteMinimo:
      texto(perfil.minimumBatchQuantity) !== null
        ? { quantidade: perfil.minimumBatchQuantity as string, unidade: version.outputUnitCode }
        : null,
    unidadesPorCaixaDeEmbarque: perfil.unitsPerShippingBox,

    composicao: composicao.map((component) => linhaDaFicha(component, comCapsula)),
    embalagem: embalagem.map((component) => linhaDaFicha(component, false)),

    massaPorDose: resumo.somadas === 0 ? null : textoDecimal(resumo.fisicaTotal),
    alvoPorDose: resumo.somadas === 0 ? null : textoDecimal(resumo.teoricaTotal),
    massaPorCapsula:
      resumo.somadas > 0 && resumo.porCapsulaTotal ? textoDecimal(resumo.porCapsulaTotal) : null,
    linhasForaDaSoma: resumo.foraDaSoma,

    criadaEm: version.createdAt,
    ativadaEm: version.activatedAt,
    inativadaEm: version.inactivatedAt,
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
    origem: origemDaVersao(version),
  };
}

/** A unidade em que o resumo da dose é somado — o papel precisa dizê-la. */
export { UNIDADE_DO_RESUMO };
