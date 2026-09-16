import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  UNIDADES,
  versaoCapsula,
  versaoPo,
} from "../testing/technical-sheet-fixtures";
import { TechnicalSheetPdf, technicalSheetPdfFileName } from "./TechnicalSheetPdf";
import { fichaTecnicaDaVersao } from "./technical-sheet-model";

/**
 * FICHA TÉCNICA DO PRODUTO — FORMULAÇÃO, lida como DOM.
 *
 * O que este arquivo prova é CONTEÚDO: o que o papel escreve, o que ele
 * esconde por forma e o que ele se recusa a mostrar. Folha A4, paginação e
 * cabeçalho de tabela repetido são do arquivo real e vivem em
 * `technical-sheet-documents.test.tsx`.
 */

vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../testing/react-pdf-dom")) }));

const GERADO_EM = new Date("2026-09-15T12:30:00.000Z");

function desenhar(version: Parameters<typeof fichaTecnicaDaVersao>[0]) {
  const ficha = fichaTecnicaDaVersao(version, UNIDADES);
  return render(<TechnicalSheetPdf ficha={ficha} generatedAt={GERADO_EM} />);
}

/** A linha da tabela que contém o texto. */
function linha(texto: RegExp | string): HTMLElement {
  return screen.getByText(texto).closest('[data-pdf-role="row"]') as HTMLElement;
}

function celulas(elemento: HTMLElement): string[] {
  return Array.from(elemento.querySelectorAll('[data-pdf-role="cell"]')).map(
    (celula) => celula.textContent ?? "",
  );
}

/** O campo rotulado da grade — o valor que sai sob o rótulo. */
function campo(rotulo: string): string {
  const etiqueta = screen.getByText(rotulo);
  const caixa = etiqueta.closest('[data-pdf-role="field"]') as HTMLElement;
  return (caixa.textContent ?? "").replace(rotulo, "").trim();
}

describe("Ficha técnica — identidade do documento", () => {
  it("é ficha técnica, não orçamento nem documento de custo", () => {
    desenhar(versaoCapsula());
    expect(screen.getByText("Ficha técnica do produto")).toBeInTheDocument();
    expect(screen.getByText(/^Formulação · Exemplo - Ácido Fólico/)).toBeInTheDocument();
    // Cabeçalho e rodapé: a identificação da versão aparece nos dois.
    expect(screen.getAllByText("PROD-000174 · V1").length).toBe(2);
  });

  it("cabeçalho traz produto, código, versão, situação e o carimbo da geração", () => {
    desenhar(versaoPo());
    expect(screen.getAllByText("PROD-000175 · V2").length).toBe(2);
    expect(
      screen.getByText("Formulação · Exemplo - Beef Protein Abacaxi 900g Pote"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ficha gerada em 15/09/2026 09:30")).toBeInTheDocument();
    expect(campo("Versão da formulação")).toBe("V2");
    expect(campo("Situação")).toBe("Ativa");
  });

  it("nome do arquivo sai do código do produto e da versão, nunca do nome longo", () => {
    expect(technicalSheetPdfFileName(fichaTecnicaDaVersao(versaoCapsula(), UNIDADES))).toBe(
      "ficha-tecnica-PROD-000174-v1.pdf",
    );
    expect(technicalSheetPdfFileName(fichaTecnicaDaVersao(versaoPo(), UNIDADES))).toBe(
      "ficha-tecnica-PROD-000175-v2.pdf",
    );
  });

  it("acento e barra no código não escapam para o nome do arquivo", () => {
    const ficha = fichaTecnicaDaVersao(
      versaoCapsula({ productCode: "PROD/ÁCIDO 174", versionNumber: 12 }),
      UNIDADES,
    );
    expect(technicalSheetPdfFileName(ficha)).toBe("ficha-tecnica-PROD-ACIDO-174-v12.pdf");
  });
});

describe("Ficha técnica — rascunho e versão ativa", () => {
  it("rascunho sai marcado, no cabeçalho e em uma frase", () => {
    const { container } = desenhar(versaoCapsula());
    expect(container.querySelector('[data-pdf-role="draft"]')?.textContent).toBe("Rascunho");
    expect(screen.getByText(/Versão em rascunho/)).toBeInTheDocument();
    expect(screen.getByText(/não representa uma formulação validada/)).toBeInTheDocument();
    expect(campo("Situação")).toBe("Rascunho");
  });

  it("versão ativa mostra o status e a data da ativação, sem marca de rascunho", () => {
    const { container } = desenhar(versaoPo());
    expect(container.querySelector('[data-pdf-role="draft"]')).toBeNull();
    expect(screen.queryByText(/Versão em rascunho/)).toBeNull();
    expect(campo("Situação")).toBe("Ativa");
    expect(campo("Ativada em")).toBe("02/09/2026 11:30");
  });

  it("versão inativa diz quando foi inativada", () => {
    desenhar(
      versaoPo({ status: "INACTIVE", inactivatedAt: "2026-09-10T14:00:00.000Z" }),
    );
    expect(campo("Situação")).toBe("Inativa");
    expect(campo("Inativada em")).toBe("10/09/2026 11:00");
  });

  it("rascunho sem ativação não inventa a linha", () => {
    desenhar(versaoCapsula());
    expect(screen.queryByText("Ativada em")).toBeNull();
    expect(screen.queryByText("Inativada em")).toBeNull();
  });
});

describe("Ficha técnica — cápsula", () => {
  it("mostra cápsulas por dose e por embalagem, e não os campos do pó", () => {
    desenhar(versaoCapsula());
    expect(campo("Forma do produto")).toBe("Cápsula");
    expect(campo("Apresentação comercial")).toBe("Pote");
    expect(campo("Cápsulas por dose")).toBe("1");
    expect(campo("Cápsulas por embalagem")).toBe("120");
    expect(campo("Doses por embalagem")).toBe("120");
    expect(screen.queryByText("Dose")).toBeNull();
    expect(screen.queryByText("Conteúdo da embalagem")).toBeNull();
  });

  it("a coluna Por cápsula existe e traz o valor do motor", () => {
    desenhar(versaoCapsula());
    expect(screen.getAllByText("Por cápsula").length).toBe(1);
    // 0,4 mg de alvo com 70% de pureza: 0,571428… mg por dose e por cápsula.
    const folato = celulas(linha("L-metilfolato de cálcio"));
    expect(folato).toContain("0,4");
    expect(folato.filter((celula) => celula === "0,571429").length).toBe(2);
  });

  it("massa por cápsula entra no resumo da forma cápsula", () => {
    desenhar(versaoCapsula());
    /*
     * 532,3026 mg de alvo viram 533,289429 mg físicos — só as três vitaminas
     * de 70% de pureza sobem. Com uma cápsula por dose, a cápsula pesa o
     * mesmo que a dose.
     */
    expect(campo("Alvo total por dose")).toBe("532,3026 mg");
    expect(campo("Massa total por dose")).toBe("533,289429 mg");
    expect(campo("Massa por cápsula")).toBe("533,289429 mg");
  });

  it("as 7 matérias-primas e as 6 embalagens de referência estão na folha", () => {
    desenhar(versaoCapsula());
    expect(campo("Linhas")).toBe("7 na composição · 6 na embalagem");
  });
});

describe("Ficha técnica — pó", () => {
  it("mostra dose e conteúdo da embalagem, e nenhum campo de cápsula", () => {
    desenhar(versaoPo());
    expect(campo("Forma do produto")).toBe("Pó");
    expect(campo("Dose")).toBe("30.000 mg");
    expect(campo("Conteúdo da embalagem")).toBe("900.000 mg");
    expect(campo("Doses por embalagem")).toBe("30");
    expect(screen.queryByText("Cápsulas por dose")).toBeNull();
    expect(screen.queryByText("Cápsulas por embalagem")).toBeNull();
  });

  it("não existe coluna nem resumo Por cápsula no pó", () => {
    desenhar(versaoPo());
    expect(screen.queryByText("Por cápsula")).toBeNull();
    expect(screen.queryByText("Massa por cápsula")).toBeNull();
  });

  it("as 8 matérias-primas e as 5 embalagens de referência estão na folha", () => {
    desenhar(versaoPo());
    expect(campo("Linhas")).toBe("8 na composição · 5 na embalagem");
  });
});

describe("Ficha técnica — composição", () => {
  it("a linha traz código, ingrediente, fonte, pureza, alvo, física, unidade e reserva", () => {
    desenhar(versaoCapsula());
    const carbonato = celulas(linha("Carbonato de cálcio"));
    expect(carbonato[0]).toBe("MP-000259");
    expect(carbonato[1]).toBe("Carbonato de cálcio");
    // Fonte repete o nome do ingrediente: sobra o detalhe técnico.
    expect(carbonato[2]).toBe("Mineral · Cálcio");
    expect(carbonato[3]).toBe("100%");
    expect(carbonato[4]).toBe("500");
    expect(carbonato[5]).toBe("500");
    expect(carbonato).toContain("mg");
    expect(carbonato).toContain("10%");
  });

  it("Por embalagem sai na unidade de ESTOQUE do item, não na da linha", () => {
    desenhar(versaoCapsula());
    // 500 mg × 120 doses = 60.000 mg = 0,06 kg.
    expect(celulas(linha("Carbonato de cálcio"))).toContain("0,06 kg");
  });

  it("a pureza impressa é a da VERSÃO; a do cadastro de hoje sai ao lado", () => {
    desenhar(versaoCapsula());
    const folato = linha("L-metilfolato de cálcio");
    expect(folato).toHaveTextContent("70%");
    expect(folato).toHaveTextContent("hoje 88,7%");
  });

  it("pureza igual à do cadastro não gera nota nenhuma", () => {
    desenhar(versaoCapsula());
    expect(linha("Carbonato de cálcio").textContent).not.toContain("hoje");
  });

  it("versão histórica com pureza registrada e não aplicada diz isso na linha", () => {
    const version = versaoCapsula();
    const alvo = version.components[0]!;
    version.components[0] = {
      ...alvo,
      quantityMode: "PHYSICAL_DIRECT",
      applyPurityAdjustment: false,
    };
    desenhar(version);
    expect(linha("L-metilfolato de cálcio")).toHaveTextContent("não aplicada");
  });

  it("reserva de matéria-prima sai como Reserva — nunca overage", () => {
    const { container } = desenhar(versaoCapsula());
    expect(screen.getByText("Reserva (%)")).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain("overage");
    expect(celulas(linha("Carbonato de cálcio"))).toContain("10%");
  });

  it("reserva não informada vira travessão, nunca zero", () => {
    const version = versaoCapsula();
    version.components[0] = { ...version.components[0]!, overagePercent: null };
    desenhar(version);
    expect(celulas(linha("L-metilfolato de cálcio"))).toContain("—");
  });

  it("material do cliente aparece na linha; material da Veridi não vira ruído", () => {
    const version = versaoCapsula();
    version.components[0] = { ...version.components[0]!, supplyResponsibility: "CUSTOMER" };
    const { container } = desenhar(version);
    expect(linha("L-metilfolato de cálcio")).toHaveTextContent("Material do cliente");
    expect(container.textContent).not.toContain("Material da Veridi");
  });

  it("item inativado depois da versão continua na receita, marcado", () => {
    const version = versaoCapsula();
    version.components[1] = { ...version.components[1]!, itemActive: false };
    desenhar(version);
    expect(linha("Cloridrato de piridoxina")).toHaveTextContent("Item inativo no cadastro");
  });
});

describe("Ficha técnica — embalagem", () => {
  it("a seção existe com código, item, quantidade, unidade e por embalagem", () => {
    desenhar(versaoCapsula());
    expect(screen.getByText("Embalagem")).toBeInTheDocument();
    const capsula = celulas(linha("Exemplo - CAPS 0 BCA/BCA 311/311"));
    expect(capsula[0]).toBe("ME-000134");
    expect(capsula[2]).toBe("120");
    expect(capsula[3]).toBe("un");
    expect(capsula[4]).toBe("120 un");
  });

  it("embalagem não mostra pureza nem reserva", () => {
    desenhar(versaoCapsula());
    const pote = celulas(linha(/POTE R220 PET 45/));
    expect(pote.length).toBe(5);
    expect(pote.join(" ")).not.toContain("%");
  });
});

describe("Ficha técnica — premissas de produção", () => {
  it("perda prevista e rendimento esperado saem da versão, pelo helper canônico", () => {
    desenhar(versaoCapsula());
    expect(campo("Perda prevista de produção (%)")).toBe("4%");
    expect(campo("Rendimento esperado (%)")).toBe("96%");
  });

  it("perda não informada é travessão nos dois campos — nunca 0% nem 100%", () => {
    desenhar(versaoCapsula({ expectedLossPercent: null }));
    expect(campo("Perda prevista de produção (%)")).toBe("—");
    expect(campo("Rendimento esperado (%)")).toBe("—");
  });

  it("não há simulação de lote arbitrária no papel", () => {
    const { container } = desenhar(versaoCapsula());
    expect(container.textContent).not.toContain("Produzir para entregar");
    expect(container.textContent).not.toContain("1.000 un");
  });

  it("lote mínimo e caixa de embarque saem rotulados como do cadastro do produto", () => {
    desenhar(versaoCapsula());
    expect(screen.getByText("Do cadastro do produto")).toBeInTheDocument();
    expect(campo("Lote mínimo")).toBe("5.000 un");
    expect(campo("Caixa de embarque")).toBe("60 por caixa");
    expect(campo("Faixa etária")).toBe("Adulto");
  });

  it("sem lote mínimo nem caixa de embarque, o bloco do cadastro não aparece", () => {
    const version = versaoCapsula();
    desenhar({
      ...version,
      productProfile: {
        ...version.productProfile,
        minimumBatchQuantity: null,
        unitsPerShippingBox: null,
      },
    });
    expect(screen.queryByText("Do cadastro do produto")).toBeNull();
  });
});

describe("Ficha técnica — nada de economia no papel", () => {
  const PROIBIDOS = [
    "custo",
    "cmv",
    "r$",
    "preço",
    "preco",
    "margem",
    "markup",
    "frete",
    "fornecedor",
    "valor unitário",
    "venda",
  ];

  it("cápsula: nenhuma palavra de custo, preço ou fornecedor", () => {
    const { container } = desenhar(versaoCapsula());
    const texto = (container.textContent ?? "").toLowerCase();
    for (const proibido of PROIBIDOS) {
      expect(texto, `"${proibido}" não pode estar na ficha técnica`).not.toContain(proibido);
    }
  });

  it("pó: nenhuma palavra de custo, preço ou fornecedor", () => {
    const { container } = desenhar(versaoPo());
    const texto = (container.textContent ?? "").toLowerCase();
    for (const proibido of PROIBIDOS) {
      expect(texto, `"${proibido}" não pode estar na ficha técnica`).not.toContain(proibido);
    }
  });

  it("as observações da versão não vão ao papel — texto livre não se controla", () => {
    /*
     * A observação real da versão de referência cita a planilha de CMV e a
     * palavra "overage". Enquanto o campo for texto livre da bancada, nenhuma
     * promessa de documento sem economia sobrevive a imprimi-lo.
     */
    const { container } = desenhar(versaoPo());
    const texto = (container.textContent ?? "").toLowerCase();
    expect(texto).not.toContain("overage");
    expect(texto).not.toContain("base cálculo");
    expect(screen.queryByText(/Observações/)).toBeNull();
  });
});

describe("Ficha técnica — snapshot histórico", () => {
  it("a ficha lê a versão, não o cadastro atual do produto", () => {
    /*
     * O Produto virou pó de 60 doses depois desta versão. A ficha da versão
     * continua sendo de uma cápsula de 120 — o perfil do cadastro não reescreve
     * premissa nenhuma.
     */
    const version = versaoCapsula();
    desenhar({
      ...version,
      productProfile: {
        ...version.productProfile,
        dosageForm: "POWDER",
        presentationType: "POUCH",
        capsulesPerDose: null,
        dosesPerPackage: 60,
      },
    });
    expect(campo("Forma do produto")).toBe("Cápsula");
    expect(campo("Apresentação comercial")).toBe("Pote");
    expect(campo("Cápsulas por dose")).toBe("1");
    expect(campo("Doses por embalagem")).toBe("120");
  });

  it("origem da versão — de qual versão ou modelo ela nasceu", () => {
    desenhar(versaoPo());
    expect(campo("Origem")).toBe("Versão V1");
  });

  it("origem em modelo da biblioteca sai com código, versão e nome", () => {
    desenhar(
      versaoCapsula({
        sourceVersionId: null,
        sourceVersionNumber: null,
        originTemplateVersionId: "tpl-1",
        originTemplateCode: "MOD-000004",
        originTemplateVersionNumber: 2,
        originTemplateName: "Base multivitamínico",
      }),
    );
    expect(campo("Origem")).toBe("Modelo MOD-000004 V2 — Base multivitamínico");
  });

  it("versão sem molde não mostra a linha de origem", () => {
    desenhar(versaoCapsula());
    expect(screen.queryByText("Origem")).toBeNull();
  });
});
