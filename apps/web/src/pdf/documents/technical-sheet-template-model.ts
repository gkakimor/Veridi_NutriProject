import {
  calcularQuantidadeDaDose,
  calcularQuantidadeDoComponente,
  textoDecimal,
} from "@veridi/shared";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateVersionDTO,
  FormulationTemplateVersionStatus,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { formatPdfDateTime } from "../format";
import {
  corpoTecnico,
  dataDaFicha,
  unidadesDoMotor,
  type AvisoDaFicha,
  type ComponenteDaFicha,
  type FichaTecnica,
} from "./technical-sheet-model";

/**
 * FICHA TÉCNICA DO MODELO DE FORMULAÇÃO — o adaptador da fonte.
 *
 * O Modelo é uma MATRIZ DE BIBLIOTECA, não um Produto: não tem cliente, item de
 * saída, faixa etária, lote mínimo nem caixa de embarque, e a ficha não inventa
 * nenhum deles. O corpo técnico é o MESMO da ficha do Produto
 * (`corpoTecnico`), e o documento é o mesmo (`TechnicalSheetPdf`); o que este
 * arquivo decide é a moldura — título, subtítulo, identificação e avisos.
 *
 * A versão do Modelo não traz os derivados calculados no DTO. Eles saem aqui
 * das MESMAS funções de `@veridi/shared` que a API usa para a Formulação e que
 * a bancada do Modelo usa na prévia, com as premissas da versão — nenhuma conta
 * nova. A pureza, a reserva e a perda impressas são as gravadas na VERSÃO do
 * Modelo; o cadastro do Item de hoje só aparece como nota ao lado da pureza,
 * nunca no lugar.
 */

/**
 * Situação da versão, como o PO a pediu para o papel do Modelo.
 *
 * A tela da biblioteca diz "Ativa"/"Arquivada" (a versão); a ficha fala do
 * MODELO, e diz "Ativo"/"Arquivado" (decisão do PO na
 * FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01).
 */
export const SITUACAO_DO_MODELO_NA_FICHA: Record<FormulationTemplateVersionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativo",
  ARCHIVED: "Arquivado",
};

export const TEMPLATE_TECHNICAL_SHEET_SUBTITLE = "Matriz de biblioteca — não é documento de Produto";

export const TEMPLATE_TECHNICAL_SHEET_FOOTER_NOTE =
  "Documento interno — descreve a versão do modelo de formulação registrada na biblioteca.";

/** O que o contexto da versão do Modelo entrega ao motor. */
type ContextoDaVersao = Pick<
  FormulationTemplateVersionDTO,
  "basisQuantity" | "dosesPerPackage" | "dosageForm" | "capsulesPerDose"
>;

/**
 * Os derivados de uma linha do Modelo, pelo motor canônico.
 *
 * É a leitura que a API monta para o componente da Formulação
 * (`toComponentDTO`): por embalagem, uma unidade acabada com a base e as doses
 * da versão; por dose e por cápsula, `calcularQuantidadeDaDose` com as
 * cápsulas da dose só na forma cápsula. Conta impossível (premissa ausente,
 * unidade incompatível) vira `null` — travessão no papel, nunca zero.
 */
function derivadosDaLinha(
  component: FormulationTemplateComponentDTO,
  versao: ContextoDaVersao,
  units: readonly UnitOfMeasureDTO[],
): Pick<
  ComponenteDaFicha,
  "theoreticalPerDose" | "physicalPerDose" | "physicalPerCapsule" | "physicalPerUnit"
> {
  const motor = unidadesDoMotor(units);
  const entrada = {
    basis: component.basis,
    quantity: component.quantity,
    unitCode: component.unitCode,
    purityPercent: component.purityPercentApplied,
    overagePercent: component.overagePercent,
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
  };
  const porEmbalagem = calcularQuantidadeDoComponente(
    { ...entrada, stockUnitCode: component.stockUnitCode },
    1,
    { basisQuantity: versao.basisQuantity, dosesPerPackage: versao.dosesPerPackage },
    motor,
  );
  const porDose = calcularQuantidadeDaDose(
    entrada,
    versao.dosageForm === "CAPSULE" ? versao.capsulesPerDose : null,
    motor,
  );
  const dose = porDose !== null && typeof porDose !== "string" ? porDose : null;
  return {
    theoreticalPerDose: dose ? textoDecimal(dose.teorica) : null,
    physicalPerDose: dose ? textoDecimal(dose.fisica) : null,
    physicalPerCapsule: dose && dose.porCapsula ? textoDecimal(dose.porCapsula) : null,
    physicalPerUnit: typeof porEmbalagem === "string" ? null : textoDecimal(porEmbalagem.physical),
  };
}

/**
 * Os avisos de uma frase no topo da folha.
 *
 * RASCUNHO: a matriz ainda muda. ARQUIVADA: é versão histórica — continua
 * registrada porque formulações nasceram dela, mas não é a que a biblioteca
 * oferece. MODELO ARQUIVADO: a biblioteca inteira do Modelo saiu de uso, seja
 * qual for a versão impressa.
 */
function avisosDaVersao(
  status: FormulationTemplateVersionStatus,
  modeloArquivado: boolean,
): AvisoDaFicha[] {
  const avisos: AvisoDaFicha[] = [];
  if (status === "DRAFT") {
    avisos.push({
      destaque: "Matriz em rascunho.",
      texto:
        "A matriz ainda pode ser alterada até a ativação — esta ficha não representa uma versão validada do modelo.",
    });
  }
  if (status === "ARCHIVED") {
    avisos.push({
      destaque: "Versão histórica, arquivada.",
      texto:
        "Esta não é a versão vigente do modelo; ela continua registrada porque formulações podem ter nascido dela.",
    });
  }
  if (modeloArquivado) {
    avisos.push({
      destaque: "Modelo arquivado.",
      texto: "Ele saiu da biblioteca e não é aplicado a novos produtos.",
    });
  }
  return avisos;
}

/**
 * A versão do Modelo de Formulação vista como FICHA TÉCNICA DO MODELO.
 *
 * `geradaEm` é o mesmo instante que o documento carimba — a identificação
 * mostra "Gerado em" como os outros campos. `modeloArquivado` vem do cadastro
 * do Modelo, que o DTO da versão não traz.
 */
export function fichaTecnicaDoModelo(
  version: FormulationTemplateVersionDTO,
  units: readonly UnitOfMeasureDTO[],
  geradaEm: Date,
  { modeloArquivado = false }: { modeloArquivado?: boolean } = {},
): FichaTecnica {
  const situacao = SITUACAO_DO_MODELO_NA_FICHA[version.status];
  const componentes: ComponenteDaFicha[] = version.components.map((component) => ({
    ...component,
    ...derivadosDaLinha(component, version, units),
  }));

  return {
    moldura: {
      titulo: "Ficha técnica do modelo de formulação",
      codigo: version.templateCode,
      /*
       * O subtítulo vem PRIMEIRO: folha solta de Modelo não pode ser lida como
       * a ficha de um produto que alguém vai fabricar.
       */
      linhasDoCabecalho: [
        TEMPLATE_TECHNICAL_SHEET_SUBTITLE,
        `Modelo · ${version.templateName}`,
      ],
      rodape: TEMPLATE_TECHNICAL_SHEET_FOOTER_NOTE,
      prefixoDoArquivo: "ficha-tecnica-modelo",
      avisos: avisosDaVersao(version.status, modeloArquivado),
      identificacao: [
        { rotulo: "Nome do modelo", valor: version.templateName, largura: 6 },
        /* "Código", curto: numa coluna de 2/12 o rótulo longo quebrava em duas linhas. */
        { rotulo: "Código", valor: version.templateCode, largura: 2 },
        { rotulo: "Versão", valor: version.versionLabel, largura: 2 },
        { rotulo: "Situação", valor: situacao, largura: 2 },
        { rotulo: "Criado em", valor: formatPdfDateTime(version.createdAt), largura: 3 },
        { rotulo: "Ativado em", valor: dataDaFicha(version.activatedAt), largura: 3, opcional: true },
        {
          rotulo: "Arquivado em",
          valor: dataDaFicha(version.archivedAt),
          largura: 3,
          opcional: true,
        },
        { rotulo: "Gerado em", valor: formatPdfDateTime(geradaEm), largura: 3 },
        {
          rotulo: "Origem",
          valor: version.sourceVersionNumber === null ? null : `Versão V${version.sourceVersionNumber}`,
          largura: 3,
          opcional: true,
        },
      ],
      apresentacaoExtra: [],
      foraDaVersao: null,
    },
    versaoLabel: version.versionLabel,
    versaoNumero: version.versionNumber,
    statusLabel: situacao,
    isDraft: version.status === "DRAFT",
    /*
     * As observações da versão do Modelo também não vão ao papel: texto livre
     * da bancada, com o mesmo risco de circular vocabulário comercial que a
     * ficha técnica promete não ter. A descrição do Modelo, idem.
     */
    ...corpoTecnico(version, componentes, units, "omitida"),
  };
}
