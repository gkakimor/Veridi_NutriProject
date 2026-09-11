import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ResourceCountField,
  ResourceUsageAmount,
  descreverTotalDeUso,
  descreverUsoDeRecurso,
  exigirQuantidadeDeRecursos,
} from "./ResourceUsageAmount";

/**
 * Quantidade de recursos equivalentes na tela (COST-RESOURCE-MULTIPLIER-01,
 * PRODUCT_RULES §87).
 *
 * O que se protege: o campo existe só para o que se conta — mão de obra e
 * equipamento —, fala português, e o que a pessoa digita chega ao envio como
 * inteiro ≥ 1 ou volta como erro legível, nunca como 1 inventado. E a leitura:
 * "2 × 2 hora" com o total do servidor ao lado, enquanto a linha de um recurso
 * só continua lendo como sempre leu.
 */

describe("campo Quantidade de recursos", () => {
  it("aparece para mão de obra, dizendo que o tempo é o de cada operador", () => {
    render(<ResourceCountField id="qtd" resourceType="LABOR" value="2" onChange={() => {}} />);

    const campo = screen.getByLabelText("Quantidade de recursos");
    expect(campo).toHaveValue("2");
    expect(campo).toHaveAccessibleDescription(
      "Operadores equivalentes trabalhando ao mesmo tempo. O tempo ao lado é o de cada um.",
    );
  });

  it("aparece para equipamento, dizendo que a energia derivada conta todos", () => {
    render(<ResourceCountField id="qtd" resourceType="EQUIPMENT" value="3" onChange={() => {}} />);

    expect(screen.getByLabelText("Quantidade de recursos")).toHaveAccessibleDescription(
      /Equipamentos iguais funcionando ao mesmo tempo.*a energia derivada conta todos/,
    );
  });

  it("não aparece para energia: o kWh já é o total", () => {
    const { container } = render(
      <ResourceCountField id="qtd" resourceType="ENERGY" value="1" onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText("Quantidade de recursos")).toBeNull();
  });

  it("não aparece antes de escolher o recurso", () => {
    const { container } = render(
      <ResourceCountField id="qtd" resourceType={null} value="1" onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("a edição chega ao formulário como o texto digitado", () => {
    const onChange = vi.fn();
    render(<ResourceCountField id="qtd" resourceType="LABOR" value="2" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Quantidade de recursos"), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith("3");
  });
});

describe("leitura do campo antes de enviar", () => {
  it("inteiro ≥ 1 segue como número", () => {
    expect(exigirQuantidadeDeRecursos("2")).toBe(2);
    expect(exigirQuantidadeDeRecursos(" 3 ")).toBe(3);
  });

  it.each(["0", "-1", "1,5", "1.5", "1e2", "abc", ""])(
    "recusa %j em português, sem virar 1 em silêncio",
    (texto) => {
      expect(() => exigirQuantidadeDeRecursos(texto)).toThrow(
        "Quantidade de recursos: informe um número inteiro maior que zero.",
      );
    },
  );
});

describe("como o uso se lê", () => {
  it("2 × 2 hora, com o total do servidor ao lado", () => {
    const { container } = render(
      <ResourceUsageAmount resourceCount={2} usageQuantity="2" totalUsageQuantity="4" usageUom="HOUR" />,
    );
    expect(container).toHaveTextContent("2 × 2 hora Total: 4 hora");
  });

  it("um recurso só continua lendo como antes: 4 hora, sem total", () => {
    expect(descreverUsoDeRecurso({ resourceCount: 1, usageQuantity: "4", usageUom: "HOUR" })).toBe(
      "4 hora",
    );
    expect(
      descreverTotalDeUso({
        resourceCount: 1,
        usageQuantity: "4",
        totalUsageQuantity: "4",
        usageUom: "HOUR",
      }),
    ).toBeNull();
  });

  it("cálculo salvo antes do campo, sem contagem, lê como 1", () => {
    expect(descreverUsoDeRecurso({ usageQuantity: "4", usageUom: "HOUR" })).toBe("4 hora");
  });

  it("energia em kWh fica como está", () => {
    expect(descreverUsoDeRecurso({ resourceCount: 1, usageQuantity: "50", usageUom: "KWH" })).toBe(
      "50 kWh",
    );
  });

  it("sem unidade quando a tabela já tem a coluna dela", () => {
    expect(descreverUsoDeRecurso({ resourceCount: 3, usageQuantity: "2" })).toBe("3 × 2");
    expect(descreverTotalDeUso({ resourceCount: 3, usageQuantity: "2", totalUsageQuantity: "6" })).toBe(
      "Total: 6",
    );
  });
});
