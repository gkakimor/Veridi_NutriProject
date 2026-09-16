import { Prisma } from "@prisma/client";
import type { UnitOfMeasure, User } from "@prisma/client";
import type {
  FormulationTemplateDiffDTO,
  FormulationTemplateDTO,
  FormulationTemplateUpdateAvailableDTO,
  FormulationVersionDTO,
} from "@veridi/shared";
import { capsulasPorEmbalagem } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { CASAS_QUANTIDADE } from "../../lib/decimal-schema.js";
import { convertUomDecimal, isUomCompatible } from "../items/uom.js";
import {
  getFormulationVersionById,
  listFormulationVersionsByProduct,
  modoEFlags,
} from "../formulations/formulations.service.js";
import {
  FormulationVersionNotFoundError,
  MissingFinishedItemError,
  ProductNotFoundError,
} from "../formulations/formulations.errors.js";
import {
  TemplateArchivedError,
  TemplateBaseUnitError,
  TemplateVersionNotActiveError,
} from "./formulation-templates.errors.js";
import {
  compararComposicoes,
  getFormulationTemplate,
  premissasDaGravacao,
  proximoCodigoDeModelo,
  receitaComparavel,
  requireTemplateVersion,
  versaoComparavel,
} from "./formulation-templates.service.js";
import type { CreateTemplateFromFormulationInput } from "./formulation-templates.schemas.js";

/**
 * Aplicar um template a um Produto — e voltar.
 *
 * A regra que governa este arquivo inteiro: **usar um template é copiar**.
 * Nenhuma linha é compartilhada, nenhum id é reaproveitado, nada se
 * sincroniza depois. Dois clientes podem partir da mesma matriz e seguir
 * caminhos completamente diferentes sem que um saiba do outro.
 *
 * O contrário — apontar a formulação de vários produtos para a mesma
 * receita — teria custado menos código e sido muito pior: a primeira
 * alteração pedida por um cliente reescreveria a fórmula do outro, e a
 * descoberta viria na produção.
 */

/** Uma V1 em rascunho, vazia e sem história, pode receber o template. */
function podeSerPreenchida(version: {
  status: string;
  components: unknown[];
  basisQuantity: Prisma.Decimal;
}): boolean {
  return version.status === "DRAFT" && version.components.length === 0;
}

/**
 * A base do Modelo na unidade da Formulação que vai recebê-la —
 * TEMPLATE-APPLY-BASE-UOM-01.
 *
 * A Formulação lê a base na unidade do Item acabado. Copiar só o número
 * reinterpretava a receita: "1 kg" num Produto em `g` nascia "1 g", mil vezes
 * menos produto para os mesmos componentes. A grandeza física atravessa:
 *
 * - mesma unidade: o número é o mesmo;
 * - mesma dimensão: converte pelo fator do catálogo, em Decimal. Os
 *   componentes por base não mudam — descrevem a proporção da base, e 100 g
 *   por 1 kg são 100 g por 1000 g;
 * - dimensão diferente: recusa. Massa não vira contagem nem volume sem uma
 *   regra — densidade, peso por unidade — que o domínio não tem.
 *
 * O que conta por UNIDADE ACABADA — componente por dose ou por unidade, dose
 * por embalagem — não atravessa a troca de unidade: "1 tampa por kg" num
 * Produto em g seria uma tampa por grama. Converter esses números é outra
 * decisão; até ela existir, recusa. E o que a base não guarda sem arredondar,
 * acima de 12 casas, também não entra.
 */
function baseNaUnidadeDaFormulacao(
  template: {
    basisQuantity: Prisma.Decimal;
    outputUnitCode: string;
    calculationMode: string;
    dosesPerPackage: number | null;
    components: readonly { basis: string }[];
  },
  unidade: string,
  units: readonly UnitOfMeasure[],
): Prisma.Decimal {
  const doModelo = template.outputUnitCode;
  if (doModelo === unidade) return template.basisQuantity;
  if (!isUomCompatible(doModelo, unidade, units)) {
    throw new TemplateBaseUnitError(
      `A unidade da base do Modelo (${doModelo}) não é compatível com a unidade do Produto (${unidade}).`,
    );
  }
  const contaPorUnidadeAcabada =
    template.calculationMode !== "FIXED_BASIS" ||
    template.dosesPerPackage !== null ||
    template.components.some((component) => component.basis !== "FIXED_BASIS");
  if (contaPorUnidadeAcabada) {
    throw new TemplateBaseUnitError(
      `O Modelo conta por unidade acabada — por dose, por embalagem ou por unidade — em ${doModelo}, e o Produto é medido em ${unidade}: nessa troca, essas quantidades mudariam de tamanho físico. Use um Modelo com a base em ${unidade}.`,
    );
  }
  const convertida = convertUomDecimal(template.basisQuantity, doModelo, unidade, units);
  if (convertida.decimalPlaces() > CASAS_QUANTIDADE) {
    throw new TemplateBaseUnitError(
      `A base do Modelo (${template.basisQuantity.toFixed()} ${doModelo}) em ${unidade} passaria de ${CASAS_QUANTIDADE} casas decimais, e a Formulação não guarda esse número sem arredondar.`,
    );
  }
  return convertida;
}

/**
 * Copia a versão do template para uma FormulationVersion do Produto.
 *
 * Preenche o rascunho vazio quando existe um — produto técnico nasce com a V1
 * em branco, e criar uma V2 só para não usá-la deixaria a V1 órfã na história
 * sem nunca ter significado nada. Se a versão de destino já tem conteúdo, uma
 * versão nova nasce e a anterior fica intacta.
 */
export async function applyTemplateToProduct(
  productId: string,
  templateVersionId: string,
  actor: User,
): Promise<FormulationVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);
  if (!product.finishedProductItemId) throw new MissingFinishedItemError();
  const outputItem = await prisma.item.findUnique({
    where: { id: product.finishedProductItemId },
  });
  if (!outputItem) throw new MissingFinishedItemError();

  const template = await requireTemplateVersion(templateVersionId);
  // Rascunho de template é trabalho em curso: copiá-lo para um produto que
  // vai ser vendido levaria uma matriz que ninguém revisou.
  if (template.status !== "ACTIVE") throw new TemplateVersionNotActiveError(template.status);
  if (template.formulationTemplate.archivedAt !== null) {
    throw new TemplateArchivedError(template.formulationTemplate.code);
  }

  const units = await prisma.unitOfMeasure.findMany();

  const versionId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const existentes = await tx.formulationVersion.findMany({
      where: { productId },
      include: { components: { select: { id: true } } },
      orderBy: { versionNumber: "asc" },
    });

    const rascunhoVazio = existentes.find((version) => podeSerPreenchida(version));
    // A Formulação lê a base na unidade dela: a do rascunho que vai ser
    // preenchido, ou a do Item acabado na versão que nasce. Recusa aqui
    // desfaz a transação inteira — nada nasce pela metade.
    const basisQuantity = baseNaUnidadeDaFormulacao(
      template,
      rascunhoVazio?.outputUnitCode ?? outputItem.unitCode,
      units,
    );

    const dadosDoTemplate = {
      basisQuantity,
      calculationMode: template.calculationMode,
      dosesPerPackage: template.dosesPerPackage,
      /*
       * PREMISSAS TECNICAS — copiadas como SNAPSHOT/DEFAULT
       * (FORMULATION-TEMPLATE-WORKBENCH-01).
       *
       * Sao a intencao tecnica da matriz: sem elas, a Formulacao nascia com as
       * quantidades certas e a leitura em branco — linha por dose sem forma nao
       * tem como ser lida por dose. Copia, nunca vinculo: dai em diante a
       * Formulacao DRAFT edita o que quiser, e o Modelo pode ganhar V4 sem
       * tocar no que ja nasceu.
       *
       * Premissa nula do Modelo entra nula: `null` e NAO INFORMADA, e inventar
       * forma na copia seria decidir pelo usuario o que ele nao declarou.
       */
      dosageForm: template.dosageForm,
      presentationType: template.presentationType,
      capsulesPerDose: template.capsulesPerDose,
      doseAmount: template.doseAmount,
      doseUomCode: template.doseUomCode,
      packageContentAmount: template.packageContentAmount,
      packageContentUomCode: template.packageContentUomCode,
      /*
       * A perda prevista tambem e DEFAULT: a Formulacao DRAFT pode altera-la, e
       * dai em diante ela e da versao. Continua interna — nao altera quantidade
       * comercial nenhuma.
       */
      expectedLossPercent: template.expectedLossPercent,
      notes: template.notes,
      // PROVENIÊNCIA — código e número gravados junto para o rótulo
      // sobreviver mesmo se o template sumir depois.
      originTemplateVersionId: template.id,
      originTemplateCode: template.formulationTemplate.code,
      originTemplateVersionNumber: template.versionNumber,
    };

    /*
     * Linhas SEMPRE novas. Nada de reaproveitar id de componente do template:
     * é isso que impede a edição de um produto de vazar para o outro.
     */
    const componentesNovos = template.components.map((component, index) => ({
      itemId: component.itemId,
      quantity: component.quantity,
      unitCode: component.unitCode,
      basis: component.basis,
      // Fornecimento vem como SUGESTÃO: o usuário ajusta no produto sem
      // tocar no template.
      supplyResponsibility: component.supplyResponsibility,
      purityPercentApplied: component.purityPercentApplied,
      overagePercent: component.overagePercent,
      // A configuracao tecnica viaja junto: sem isto, aplicar um template
      // produzia sempre PHYSICAL_DIRECT e a intencao de "corrija pela pureza"
      // se perdia na copia.
      quantityMode: component.quantityMode,
      applyPurityAdjustment: component.applyPurityAdjustment,
      applyOverageAdjustment: component.applyOverageAdjustment,
      notes: component.notes,
      position: index,
    }));

    if (rascunhoVazio) {
      await tx.formulationVersion.update({
        where: { id: rascunhoVazio.id },
        data: {
          ...dadosDoTemplate,
          components: { create: componentesNovos },
        },
      });
      return rascunhoVazio.id;
    }

    const maior = existentes.reduce(
      (maximo, version) => Math.max(maximo, version.versionNumber),
      0,
    );
    const criada = await tx.formulationVersion.create({
      data: {
        productId,
        versionNumber: maior + 1,
        status: "DRAFT",
        ...dadosDoTemplate,
        outputItemId: outputItem.id,
        outputItemCode: outputItem.code,
        outputItemName: outputItem.name,
        outputUnitCode: outputItem.unitCode,
        createdBy: actor.name,
        components: { create: componentesNovos },
      },
    });
    return criada.id;
  });

  return (await getFormulationVersionById(versionId))!;
}

/**
 * Existe versão de template mais recente do que a que originou esta formulação?
 *
 * Só informa. Não existe "atualizar para a V4" que sobrescreva a formulação —
 * o caminho é criar uma versão nova, e a atual continua histórica. Atualizar
 * no lugar reescreveria a receita que já serviu de base para custo, preço e
 * possivelmente produção.
 */
export async function getTemplateUpdateAvailable(
  formulationVersionId: string,
): Promise<FormulationTemplateUpdateAvailableDTO | null> {
  const prisma = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    select: { originTemplateVersionId: true },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);
  if (!version.originTemplateVersionId) return null;

  const origem = await requireTemplateVersion(version.originTemplateVersionId);
  const ativa = await prisma.formulationTemplateVersion.findFirst({
    where: { formulationTemplateId: origem.formulationTemplateId, status: "ACTIVE" },
    select: { id: true, versionNumber: true },
  });
  if (!ativa || ativa.id === origem.id) return null;
  // Uma versão ANTERIOR reativada não é novidade; só avisa para frente.
  if (ativa.versionNumber <= origem.versionNumber) return null;

  return {
    templateId: origem.formulationTemplateId,
    templateCode: origem.formulationTemplate.code,
    templateName: origem.formulationTemplate.name,
    originVersionId: origem.id,
    originVersionNumber: origem.versionNumber,
    latestVersionId: ativa.id,
    latestVersionNumber: ativa.versionNumber,
  };
}

/** O que muda entre a versão de origem e a versão atual do template. */
export async function compareFormulationWithTemplate(
  formulationVersionId: string,
  targetTemplateVersionId?: string,
): Promise<FormulationTemplateDiffDTO> {
  const prisma = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);

  const alvoId =
    targetTemplateVersionId ??
    (await getTemplateUpdateAvailable(formulationVersionId))?.latestVersionId;
  if (!alvoId) throw new FormulationVersionNotFoundError(formulationVersionId);
  const alvo = await requireTemplateVersion(alvoId);

  /*
   * Compara a FORMULAÇÃO ATUAL contra a versão nova do template — e não a
   * versão antiga do template contra a nova. Quem lê quer saber o que muda no
   * produto dela, incluindo os ajustes que ela mesma fez depois da cópia. O
   * lado da Formulação é lido pelo MESMO leitor do Modelo, premissas incluídas.
   */
  return compararComposicoes(
    receitaComparavel(`Formulação V${version.versionNumber}`, version),
    versaoComparavel(alvo),
  );
}

/**
 * Salvar uma formulação de produto como Modelo da biblioteca.
 *
 * É CÓPIA: a formulação original não se move, não se converte e não muda de
 * dono. Nada comercial vem junto — cliente, projeto, orçamento, custo, preço
 * e pedido ficam onde estão, porque uma matriz técnica reutilizável entre
 * clientes não pode carregar o nome de um deles.
 *
 * Nasce em RASCUNHO de propósito: quem vai reutilizar precisa revisar antes,
 * e ativar sozinho transformaria uma decisão em efeito colateral.
 *
 * NUMA ESCRITA SÓ (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3). Antes, o Modelo
 * nascia vazio e a receita entrava numa segunda gravação: se ela recusasse —
 * um item que o cadastro inativou depois da homologação bastava —, ficava na
 * biblioteca um Modelo sem receita que ninguém pediu. Agora toda recusa
 * possível acontece ANTES do código FT, e o Modelo nasce inteiro ou não nasce.
 *
 * A receita é copiada FIEL, como na cópia de versão da Formulação e como na
 * aplicação do Modelo (decisão D-6): item inativado, que virou produto acabado
 * ou com unidade que deixou de ser compatível atravessa, e aparece em
 * `componentIssues` do rascunho do Modelo — que é onde se corrige. A ativação
 * do Modelo continua fechada para eles.
 */
export async function createTemplateFromFormulation(
  formulationVersionId: string,
  input: CreateTemplateFromFormulationInput,
  actor: User,
): Promise<FormulationTemplateDTO> {
  const prisma = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);

  /*
   * PREMISSAS TECNICAS — vao junto (FORMULATION-TEMPLATE-WORKBENCH-01).
   *
   * A matriz que nascesse sem forma perdia a leitura da receita: "500 mg por
   * dose" sem saber se a dose sao duas capsulas ou cinco gramas nao se
   * reproduz em produto nenhum. Passam pela MESMA regra da gravacao do Modelo,
   * que deriva as doses por embalagem das premissas — e recusa divisao que nao
   * fecha, em vez de gravar a matriz pela metade.
   *
   * `capsulesPerPackage` e ENTRADA: sai do produto de capsulas por dose e
   * doses por embalagem da Formulacao, os mesmos numeros que a originaram. O
   * ponto de partida e o Modelo novo, sem premissa nenhuma, com as doses da
   * Formulacao quando ela as tinha.
   */
  const units = await prisma.unitOfMeasure.findMany();
  const dosesDaFormulacao = version.dosesPerPackage ? version.dosesPerPackage : null;
  const premissas = premissasDaGravacao(
    {
      calculationMode: version.calculationMode,
      dosageForm: null,
      presentationType: null,
      capsulesPerDose: null,
      doseAmount: null,
      doseUomCode: null,
      packageContentAmount: null,
      packageContentUomCode: null,
      dosesPerPackage: dosesDaFormulacao,
    },
    {
      dosageForm: version.dosageForm,
      presentationType: version.presentationType,
      capsulesPerDose: version.capsulesPerDose,
      capsulesPerPackage: capsulasPorEmbalagem(version.capsulesPerDose, version.dosesPerPackage),
      doseAmount: version.doseAmount ? version.doseAmount.toString() : null,
      doseUomCode: version.doseUomCode,
      packageContentAmount: version.packageContentAmount
        ? version.packageContentAmount.toString()
        : null,
      packageContentUomCode: version.packageContentUomCode,
    },
    version.components,
    units,
  );

  // Só agora o código: recusa acima não consome número da sequência.
  const code = await proximoCodigoDeModelo();
  const criado = await prisma.formulationTemplate.create({
    data: {
      code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdBy: actor.name,
      versions: {
        create: {
          versionNumber: 1,
          status: "DRAFT",
          basisQuantity: version.basisQuantity,
          calculationMode: version.calculationMode,
          dosesPerPackage: dosesDaFormulacao,
          ...premissas,
          // A perda prevista é DEFAULT da matriz, como na aplicação.
          expectedLossPercent: version.expectedLossPercent,
          outputUnitCode: version.outputUnitCode,
          notes: version.notes,
          createdBy: actor.name,
          /*
           * Nada comercial vem junto: Produto, Cliente, Projeto, Orcamento,
           * custo, preco, Pedido e faturamento ficam onde estao.
           */
          components: {
            create: version.components.map((component, index) => ({
              itemId: component.itemId,
              quantity: component.quantity,
              unitCode: component.unitCode,
              basis: component.basis,
              supplyResponsibility: component.supplyResponsibility,
              purityPercentApplied: component.purityPercentApplied,
              overagePercent: component.overagePercent,
              // Sem o modo, "salvar como Modelo" transformava componente
              // calculado em físico direto — e aplicar o Modelo de volta mudava
              // a receita. A MESMA normalização da gravação (§52).
              ...modoEFlags(component),
              notes: component.notes,
              position: index,
            })),
          },
        },
      },
    },
  });

  return getFormulationTemplate(criado.id);
}

/** Formulações do produto — reexportado para a rota de aplicação. */
export { listFormulationVersionsByProduct };
