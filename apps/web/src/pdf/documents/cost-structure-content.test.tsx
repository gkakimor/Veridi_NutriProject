import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { IndustrialCostResourceUsageDTO } from "@veridi/shared";
import { calculoComRecursos, cmv, estrutura, usoDeRecurso } from "../testing/cost-structure-fixtures";
import { CmvPdf, cmvPdfFileName } from "./CmvPdf";
import { CostCalculationPdf } from "./CostCalculationPdf";
import { IndustrialCostPdf, PUREZA_OVERAGE_REGISTRO, industrialCostPdfFileName } from "./IndustrialCostPdf";
import { PdfResourceUsage } from "./resource-usage";

/**
 * PDF-DOCUMENT-SYSTEM-01b — o que a main trouxe depois da fundação PDF, lido
 * como DOM: quantidade de recursos equivalentes (§87) na Estrutura de custos,
 * no CMV e no Cálculo; energia sem multiplicador; pureza e overage como
 * registro, sem afirmar aplicação; `null` ≠ 0. O arquivo real é provado em
 * `cost-structure-documents.test.tsx`.
 */

vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../testing/react-pdf-dom")) }));

const GERADO_EM = new Date("2026-09-11T12:30:00.000Z");

/** A linha da tabela do PDF que contém o texto. */
function linha(texto: RegExp): HTMLElement {
  return screen.getByText(texto).closest('[data-pdf-role="row"]') as HTMLElement;
}

function celulas(elemento: HTMLElement): string[] {
  return Array.from(elemento.querySelectorAll('[data-pdf-role="cell"]')).map((celula) => celula.textContent ?? "");
}

describe("quantidade de recursos (§87) — a leitura no PDF", () => {
  it("mais de um recurso: 2 × 2 hora e, embaixo, o total que o servidor calculou", () => {
    render(<PdfResourceUsage resourceCount={2} usageQuantity="2" totalUsageQuantity="4" usageUom="HOUR" />);
    expect(screen.getByText("2 × 2 hora")).toBeInTheDocument();
    expect(screen.getByText("Total: 4 hora")).toBeInTheDocument();
  });

  it("um recurso: leitura simples, sem multiplicador nem total", () => {
    const { container } = render(
      <PdfResourceUsage resourceCount={1} usageQuantity="4" totalUsageQuantity="4" usageUom="HOUR" />,
    );
    expect(container.textContent).toBe("4 hora");
  });

  it("dado anterior ao campo, sem quantidade de recursos, lê-se como 1", () => {
    const { container } = render(<PdfResourceUsage usageQuantity="4" totalUsageQuantity="4" usageUom="HOUR" />);
    expect(container.textContent).toBe("4 hora");
  });

  it("energia: o kWh já é o total — nenhum multiplicador", () => {
    const { container } = render(
      <PdfResourceUsage resourceCount={1} usageQuantity="50" totalUsageQuantity="50" usageUom="KWH" />,
    );
    expect(container.textContent).toBe("50 kWh");
  });
});

describe("Estrutura de custos em PDF", () => {
  it("mão de obra com 2 recursos sai 2 × 2 hora com Total: 4 hora; equipamento com 1, simples", () => {
    render(<IndustrialCostPdf version={estrutura()} generatedAt={GERADO_EM} />);

    const operador = linha(/Operador de produção/);
    expect(operador).toHaveTextContent("2 × 2 hora");
    expect(operador).toHaveTextContent("Total: 4 hora");

    const misturador = linha(/Misturador em V/);
    expect(misturador).toHaveTextContent("3 hora");
    expect(misturador.textContent).not.toContain("×");
    expect(misturador.textContent).not.toContain("Total:");
    // Energia derivada: o valor do servidor, só formatado.
    expect(misturador).toHaveTextContent("22,5 kWh");
  });

  it("energia direta sai só em kWh, sem quantidade de recursos", () => {
    render(<IndustrialCostPdf version={estrutura()} generatedAt={GERADO_EM} />);
    const energia = linha(/Energia elétrica/);
    expect(energia).toHaveTextContent("50 kWh");
    expect(energia.textContent).not.toContain("×");
    expect(energia.textContent).not.toContain("Total:");
  });

  it("pureza e overage saem como registro, sem afirmar que ajustaram a quantidade", () => {
    const { container } = render(<IndustrialCostPdf version={estrutura()} generatedAt={GERADO_EM} />);
    const wpc = celulas(linha(/WPC 80/));
    // Colunas: Item, Quantidade, Un., Base, Pureza, Overage, Fornecimento.
    expect(wpc[4]).toBe("80%");
    expect(wpc[5]).toBe("2%");
    expect(screen.getByText(PUREZA_OVERAGE_REGISTRO)).toBeInTheDocument();
    // A estrutura não recebe modo nem flags do componente: não pode dizer "aplicada".
    expect(container.textContent).not.toMatch(/(pureza|overage)[^.]*aplicad/i);
  });

  it("null é não informado e 0% continua 0%", () => {
    render(<IndustrialCostPdf version={estrutura()} generatedAt={GERADO_EM} />);
    const vitaminaC = celulas(linha(/Vitamina C/));
    expect(vitaminaC[4]).toBe("0%");
    expect(vitaminaC[5]).toBe("—");
    const rotulo = celulas(linha(/Rótulo BOPP/));
    expect(rotulo[4]).toBe("—");
    expect(rotulo[5]).toBe("0%");
    expect(rotulo[6]).toBe("Fornecido pelo cliente");
  });

  it("premissa percentual é percentual, e o arquivo leva código e versão", () => {
    render(<IndustrialCostPdf version={estrutura()} generatedAt={GERADO_EM} />);
    expect(celulas(linha(/Overhead industrial/))[3]).toBe("8%");
    expect(industrialCostPdfFileName({ code: "EC-000012", versionNumber: 3 })).toBe("EC-000012-V3.pdf");
  });

  it("rascunho sai marcado, com a tarifa de referência de hoje", () => {
    const { container } = render(
      <IndustrialCostPdf
        version={estrutura({
          status: "DRAFT",
          resourceUsages: [
            usoDeRecurso({
              currentRate: { rateValue: "45.00", rateUom: "HOUR" } as IndustrialCostResourceUsageDTO["currentRate"],
              rateValueSnapshot: null,
              rateUomSnapshot: null,
            }),
          ],
        })}
        generatedAt={GERADO_EM}
      />,
    );
    expect(container.querySelector('[data-pdf-role="draft"]')).toHaveTextContent("Rascunho");
    expect(screen.getByText("Tarifa de referência")).toBeInTheDocument();
    expect(linha(/Operador de produção/)).toHaveTextContent(/45,00/);
  });
});

describe("CMV em PDF", () => {
  it("recurso com 2 equivalentes sai 2 × 4 hora com Total: 8 hora; energia só em kWh", () => {
    render(<CmvPdf data={cmv()} quantity="3000" referenceDate="2026-09-09" generatedAt={GERADO_EM} />);

    const operador = linha(/Operador de produção/);
    expect(operador).toHaveTextContent("2 × 4 hora");
    expect(operador).toHaveTextContent("Total: 8 hora");

    const energia = linha(/Energia elétrica/);
    expect(energia).toHaveTextContent("50 kWh");
    expect(energia.textContent).not.toContain("×");

    expect(linha(/WPC 80/)).toHaveTextContent("1450 kg");
  });

  it("nome do arquivo: produto, quantidade e data de referência", () => {
    expect(cmvPdfFileName({ productCode: "PROD-000045", outputUomCode: "un" }, "3000", "2026-09-09")).toBe(
      "CMV-PROD-000045-3000-un-2026-09-09.pdf",
    );
  });
});

describe("Cálculo de custo em PDF — quantidade de recursos", () => {
  it("2 × 2 hora com o total; cálculo salvo antes do campo e energia sem multiplicador", () => {
    render(<CostCalculationPdf calculation={calculoComRecursos()} generatedAt={GERADO_EM} />);

    const operador = linha(/Operador de produção/);
    expect(operador).toHaveTextContent("2 × 2 hora");
    expect(operador).toHaveTextContent("Total: 4 hora");

    const misturador = linha(/Misturador em V/);
    expect(misturador).toHaveTextContent("3 hora");
    expect(misturador.textContent).not.toContain("×");

    const energia = linha(/Energia elétrica/);
    expect(energia).toHaveTextContent("50 kWh");
    expect(energia.textContent).not.toContain("×");
  });
});
