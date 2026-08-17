import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
} from "@veridi/shared";
import {
  DIRECT_INDUSTRIAL_COST_DEFINITION,
  ENERGY_CALCULATION_MODE_LABELS,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_VERSION_STATUS_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  INDUSTRIAL_USAGE_BASIS_LABELS,
} from "@veridi/shared";
import { formatUnitCost } from "../../components/CostBreakdown";
import { PrintSection, PrintTable, formatPrintDateTime } from "../../print/PrintLayout";
import { PrintSheet } from "../../print/PrintSheet";
import { getIndustrialCostVersion } from "../../lib/industrial-costs-api";

/**
 * Rascunho imprime a referência de hoje; versão ativa imprime o valor
 * congelado na ativação. Tarifa ausente permanece ausente no papel.
 */
function printRate(usage: IndustrialCostResourceUsageDTO, status: string): string {
  if (status === "DRAFT") {
    return usage.currentRate
      ? `${formatUnitCost(usage.currentRate.rateValue)} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.currentRate.rateUom]}`
      : "—";
  }
  if (!usage.rateValueSnapshot || !usage.rateUomSnapshot) return "—";
  return `${formatUnitCost(usage.rateValueSnapshot)} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.rateUomSnapshot]}`;
}

/**
 * Estrutura de custos industriais impressa.
 *
 * É documento de ESTRUTURA E PREMISSAS: não traz total, porque o custo
 * industrial consolidado é calculado em outra etapa. Chamar de CMV o que
 * ainda não foi calculado seria a forma mais fácil de alguém precificar
 * errado — por isso o aviso vai impresso.
 */
export function IndustrialCostPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [version, setVersion] = useState<IndustrialCostVersionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getIndustrialCostVersion(id)
      .then(setVersion)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o documento"),
      );
  }, [id]);

  if (error) {
    return (
      <div className="print-screen">
        <article className="print-doc">
          <p className="form-alert">{error}</p>
        </article>
      </div>
    );
  }
  if (!version) return <div className="print-screen">Carregando…</div>;

  // Snapshot congelado na ativação: renomear produto/cliente depois não
  // reescreve o documento já impresso.
  const productCode = version.productCodeSnapshot ?? version.productCode;
  const productName = version.productNameSnapshot ?? version.productName;
  const customerName = version.customerNameSnapshot ?? version.customerName;

  return (
    <PrintSheet
      sheetCode={version.code}
      title="Estrutura de custos industriais"
      subtitle={`Versão V${version.versionNumber} — ${INDUSTRIAL_COST_VERSION_STATUS_LABELS[version.status]}`}
      backTo={`/produtos/${version.productId}/custos`}
      meta={[
        { label: "Produto", value: `${productCode} — ${productName}` },
        { label: "Cliente", value: customerName ?? "—" },
        { label: "Formulação", value: `V${version.formulationVersionNumber}` },
        {
          label: "Base de referência",
          value: `${version.referenceOutputQuantity} ${version.referenceOutputUomCode}`,
        },
        { label: "Unidades por caixa", value: version.unitsPerShippingBox ?? "—" },
        { label: "Situação", value: version.complete ? "Completa" : "Com pendências" },
        { label: "Criada por", value: version.createdByName ?? "—" },
        {
          label: "Ativada",
          value: version.activatedAt
            ? `${formatPrintDateTime(version.activatedAt)} — ${version.activatedByName ?? "—"}`
            : "—",
        },
      ]}
    >
      <p className="print-doc__notice">
        Documento de estrutura e premissas de custo. O custo industrial consolidado é calculado
        separadamente.
      </p>

      <PrintSection title="Matérias-primas e embalagens (da formulação)">
        <PrintTable
          columns={["Item", "Quantidade", "Un.", "Base", "Pureza", "Overage", "Fornecimento"]}
          isEmpty={version.materials.length === 0}
          emptyMessage="A formulação vinculada não tem componentes."
        >
          {version.materials.map((material) => (
            <tr key={material.itemId}>
              <td>
                {material.itemCode} — {material.itemName}
              </td>
              <td className="is-number">{material.quantity}</td>
              <td>{material.unitCode}</td>
              <td>{material.basis}</td>
              <td>{material.purityPercentApplied ?? "—"}</td>
              <td>{material.overagePercent ?? "—"}</td>
              {/* Material do cliente pertence à estrutura física, não ao
                  custo de aquisição da Veridi. */}
              <td>{material.customerSupplied ? "Fornecido pelo cliente" : "Veridi"}</td>
            </tr>
          ))}
        </PrintTable>
      </PrintSection>

      <PrintSection title="Premissas de custo adicionais">
        <PrintTable
          columns={["Categoria", "Descrição", "Base de cálculo", "Valor"]}
          isEmpty={version.lines.length === 0}
          emptyMessage="Nenhuma premissa adicional registrada."
        >
          {version.lines.map((line) => (
            <tr key={line.id}>
              <td>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</td>
              <td>{line.description}</td>
              <td>{INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}</td>
              <td className="is-number">
                {/* Valor desconhecido continua "—": nunca R$ 0,00. */}
                {line.rateValue === null
                  ? "—"
                  : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                    ? `${line.rateValue}%`
                    : formatUnitCost(line.rateValue)}
              </td>
            </tr>
          ))}
        </PrintTable>
        <p className="print-doc__status">
          Custo industrial direto: {DIRECT_INDUSTRIAL_COST_DEFINITION}
        </p>
      </PrintSection>

      <PrintSection title="Recursos industriais">
        <PrintTable
          columns={[
            "Recurso",
            "Tipo",
            "Consumo",
            "Base",
            version.status === "DRAFT" ? "Tarifa de referência" : "Tarifa congelada",
            "Energia derivada",
          ]}
          isEmpty={version.resourceUsages.length === 0}
          emptyMessage="Nenhum recurso declarado nesta estrutura."
        >
          {version.resourceUsages.map((usage) => (
            <tr key={usage.id}>
              <td>
                {usage.resourceCode} — {usage.resourceNameSnapshot ?? usage.resourceName}
              </td>
              <td>{INDUSTRIAL_RESOURCE_TYPE_LABELS[usage.resourceType]}</td>
              <td className="is-number">
                {usage.usageQuantity} {INDUSTRIAL_RATE_UOM_LABELS[usage.usageUom]}
              </td>
              <td>{INDUSTRIAL_USAGE_BASIS_LABELS[usage.usageBasis]}</td>
              <td className="is-number">{printRate(usage, version.status)}</td>
              {/* Potência desconhecida deixa a energia em aberto — nunca 0 kWh. */}
              <td className="is-number">
                {usage.derivedEnergyKwh ? `${usage.derivedEnergyKwh} kWh` : "—"}
              </td>
            </tr>
          ))}
        </PrintTable>
        <p className="print-doc__status">
          Energia: {ENERGY_CALCULATION_MODE_LABELS[version.energyCalculationMode]}
          {version.energyCalculationMode === "FROM_EQUIPMENT"
            ? version.derivedEnergyKwh
              ? ` — ${version.derivedEnergyKwh} kWh por lote de referência`
              : " — em aberto: há equipamento sem potência informada"
            : ""}
          .{" "}
          {version.status === "DRAFT"
            ? "Rascunho: as tarifas exibidas são a referência de hoje e ainda podem mudar."
            : "As tarifas exibidas foram congeladas na ativação desta versão."}
        </p>
      </PrintSection>

      {version.pendencies.length > 0 && (
        <PrintSection title="Pendências">
          <PrintTable
            columns={["Pendência"]}
            isEmpty={false}
            emptyMessage=""
          >
            {version.pendencies.map((pendency) => (
              <tr key={pendency.description}>
                <td>{pendency.description}</td>
              </tr>
            ))}
          </PrintTable>
        </PrintSection>
      )}

      {version.notes && (
        <PrintSection title="Observações">
          <p>{version.notes}</p>
        </PrintSection>
      )}
    </PrintSheet>
  );
}
