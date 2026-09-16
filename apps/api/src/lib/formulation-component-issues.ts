import { Prisma } from "@prisma/client";
import type { Item, UnitOfMeasure } from "@prisma/client";
import type { FormulationComponentIssueDTO } from "@veridi/shared";
import { isUomCompatible } from "../modules/items/uom.js";

/**
 * O QUE, NOS COMPONENTES DE UMA RECEITA, VAI BARRAR A ATIVAÇÃO.
 *
 * Formulação de produto e Modelo de Formulação guardam a MESMA receita com o
 * MESMO estoque, e o cadastro do Item muda depois da gravação: o item é
 * inativado, vira produto acabado, troca de unidade. Uma regra só responde por
 * isso nas duas telas — duas cópias divergiriam no primeiro caso de borda
 * corrigido de um lado só (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3).
 *
 * Só entra o que depende do ITEM e da própria linha. O que depende do Produto
 * ou do Cliente — produto inativo, item acabado ausente, material do cliente
 * sem cliente — continua sendo motivo da ativação da Formulação, e não existe
 * no Modelo, que não tem Produto nem Cliente.
 */

export type ComponenteComItem = {
  quantity: Prisma.Decimal | string;
  unitCode: string;
  item: Pick<Item, "id" | "code" | "name" | "type" | "active" | "unitCode">;
};

export function problemasDosComponentes(
  components: readonly ComponenteComItem[],
  units: readonly UnitOfMeasure[],
): FormulationComponentIssueDTO[] {
  const issues: FormulationComponentIssueDTO[] = [];
  for (const component of components) {
    const item = component.item;
    const base = { itemId: item.id, itemCode: item.code, itemName: item.name };
    if (item.type === "FINISHED_PRODUCT") {
      issues.push({
        ...base,
        code: "ITEM_IS_FINISHED_PRODUCT",
        description: `${item.code} passou a ser produto acabado e não pode ser componente.`,
      });
    } else if (!item.active) {
      issues.push({
        ...base,
        code: "ITEM_INACTIVE",
        description: `${item.code} foi inativado no cadastro de itens.`,
      });
    }
    if (new Prisma.Decimal(component.quantity).lessThanOrEqualTo(0)) {
      issues.push({
        ...base,
        code: "INVALID_QUANTITY",
        description: `${item.code} está com quantidade inválida.`,
      });
    } else if (!isUomCompatible(component.unitCode, item.unitCode, units)) {
      issues.push({
        ...base,
        code: "UOM_INCOMPATIBLE",
        description: `${item.code} usa ${component.unitCode}, incompatível com a unidade de estoque ${item.unitCode}.`,
      });
    }
  }
  return issues;
}

/** O motivo curto de cada problema, para a recusa que lista vários itens numa frase. */
export const MOTIVO_CURTO_DO_PROBLEMA: Record<FormulationComponentIssueDTO["code"], string> = {
  ITEM_INACTIVE: "inativo",
  ITEM_IS_FINISHED_PRODUCT: "produto acabado",
  UOM_INCOMPATIBLE: "unidade incompatível",
  INVALID_QUANTITY: "quantidade inválida",
};
