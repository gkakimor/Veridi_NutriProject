import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { versaoCapsula, versaoPo } from "../testing/technical-sheet-fixtures";
import {
  UNIDADES,
  modeloCapsula,
  modeloDe,
  modeloLegado,
  modeloPo,
} from "../testing/technical-sheet-template-fixtures";
import { TechnicalSheetPdf, technicalSheetPdfFileName } from "./TechnicalSheetPdf";
import { fichaTecnicaDaVersao } from "./technical-sheet-model";
import { fichaTecnicaDoModelo } from "./technical-sheet-template-model";

/**
 * FICHA TÉCNICA DO MODELO DE FORMULAÇÃO, lida como DOM
 * (FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01).
 *
 * O documento é o MESMO da ficha do Produto; o que este arquivo prova é o que
 * o adaptador do Modelo decide — título, subtítulo de matriz, identificação,
 * situação e avisos — e que o corpo técnico sai IGUAL ao da ficha do Produto
 * para a mesma receita, recalculado pelo motor compartilhado. Folha A4 e
 * paginação vivem em `technical-sheet-template-documents.test.tsx`.
 */

vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../testing/react-pdf-dom")) }));

const GERADO_EM = new Date("2026-09-15T12:30:00.000Z");

type Versao = Parameters<typeof fichaTecnicaDoModelo>[0];

function desenhar(version: Versao, opcoes: { modeloArquivado?: boolean } = {}) {
  const ficha = fichaTecnicaDoModelo(version, UNIDADES, GERADO_EM, opcoes);
  return render(<TechnicalSheetPdf ficha={ficha} generatedAt={GERADO_EM} />);
}

/** A linha da tabela que contém o texto. */
function linha(texto: RegExp | string): HTMLElement {
  return screen.getByText(texto).closest('[data-pdf-role="row"]') as HTMLElement;
}

function celulas(elemento: Element): string[] {
  return Array.from(elemento.querySelectorAll('[data-pdf-role="cell"]')).map(
    (celula) => celula.textContent ?? "",
  );
}

/**
 * O campo rotulado da grade — o valor que sai sob o rótulo. Procura só entre
 * os campos: "Código" também é cabeçalho das duas tabelas.
 */
function campo(rotulo: string): string {
  const caixas = Array.from(document.querySelectorAll('[data-pdf-role="field"]')).filter(
    (caixa) => caixa.firstElementChild?.textContent === rotulo,
  );
  if (caixas.length !== 1) throw new Error(`campo "${rotulo}": ${caixas.length} na grade`);
  return (caixas[0]!.textContent ?? "").slice(rotulo.length).trim();
}

/** Todas as linhas de tabela do documento, célula a célula. */
function tabelas(container: HTMLElement): string[][] {
  return Array.from(container.querySelectorAll('[data-pdf-role="row"]')).map(celulas);
}

/** Os campos do resumo técnico, como o papel os escreve. */
function resumo(): Record<string, string> {
  return Object.fromEntries(
    ["Massa total por dose", "Alvo total por dose", "Linhas"].map((rotulo) => [rotulo, campo(rotulo)]),
  );
}

describe("Ficha do Modelo — o papel diz que é matriz, não produto", () => {
  it("título, subtítulo de matriz de biblioteca e o nome do modelo no cabeçalho", () => {
    desenhar(modeloCapsula());
    expect(screen.getByText("Ficha técnica do modelo de formulação")).toBeInTheDocument();
    expect(
      screen.getByText("Matriz de biblioteca — não é documento de Produto"),
    ).toBeInTheDocument();
    expect(screen.getByText("Modelo · Base multivitamínica — cápsula 120")).toBeInTheDocument();
    expect(screen.getByText("Ficha gerada em 15/09/2026 09:30")).toBeInTheDocument();
    // Cabeçalho e rodapé: o código FT e a versão aparecem nos dois.
    expect(screen.getAllByText("FT-000001 · V1").length).toBe(2);
  });

  it("nada da ficha do Produto aparece: título, item de saída, cadastro do produto", () => {
    const { container } = desenhar(modeloCapsula());
    expect(screen.queryByText("Ficha técnica do produto")).toBeNull();
    expect(screen.queryByText("Produto")).toBeNull();
    expect(screen.queryByText("Item de saída")).toBeNull();
    expect(screen.queryByText("Versão da formulação")).toBeNull();
    expect(screen.queryByText("Do cadastro do produto")).toBeNull();
    expect(screen.queryByText("Faixa etária")).toBeNull();
    expect(screen.queryByText("Lote mínimo")).toBeNull();
    expect(container.textContent).not.toMatch(/Formulação · /);
    // O rodapé diz a natureza do papel — do modelo, na biblioteca.
    expect(container.textContent).toContain(
      "Documento interno — descreve a versão do modelo de formulação registrada na biblioteca.",
    );
  });

  it("identificação: nome, código FT, versão, situação, criação e geração", () => {
    desenhar(modeloCapsula());
    expect(campo("Nome do modelo")).toBe("Base multivitamínica — cápsula 120");
    expect(campo("Código")).toBe("FT-000001");
    expect(campo("Versão")).toBe("V1");
    expect(campo("Situação")).toBe("Rascunho");
    expect(campo("Criado em")).toBe("01/09/2026 09:00");
    expect(campo("Gerado em")).toBe("15/09/2026 09:30");
  });

  it("nome do arquivo: ficha-tecnica-modelo, código FT e versão — nunca o nome longo", () => {
    expect(
      technicalSheetPdfFileName(fichaTecnicaDoModelo(modeloCapsula(), UNIDADES, GERADO_EM)),
    ).toBe("ficha-tecnica-modelo-FT-000001-v1.pdf");
    expect(
      technicalSheetPdfFileName(fichaTecnicaDoModelo(modeloPo(), UNIDADES, GERADO_EM)),
    ).toBe("ficha-tecnica-modelo-FT-000002-v2.pdf");
  });

  it("acento, barra e espaço no código não escapam para o nome do arquivo", () => {
    const ficha = fichaTecnicaDoModelo(
      modeloCapsula({ templateCode: "FT/ÁCIDO 001", versionNumber: 12, versionLabel: "V12" }),
      UNIDADES,
      GERADO_EM,
    );
    expect(technicalSheetPdfFileName(ficha)).toBe("ficha-tecnica-modelo-FT-ACIDO-001-v12.pdf");
  });
});

describe("Ficha do Modelo — situação da versão", () => {
  it("RASCUNHO: marca no cabeçalho e a frase de que a matriz ainda muda", () => {
    const { container } = desenhar(modeloCapsula());
    expect(container.querySelector('[data-pdf-role="draft"]')?.textContent).toBe("Rascunho");
    expect(screen.getByText("Matriz em rascunho.")).toBeInTheDocument();
    expect(screen.getByText(/A matriz ainda pode ser alterada até a ativação/)).toBeInTheDocument();
    expect(screen.getByText("Status: Rascunho")).toBeInTheDocument();
    expect(screen.queryByText("Ativado em")).toBeNull();
    expect(screen.queryByText("Arquivado em")).toBeNull();
  });

  it("ATIVO: sem marca de rascunho nem aviso, com a data da ativação", () => {
    const { container } = desenhar(modeloPo());
    expect(container.querySelector('[data-pdf-role="draft"]')).toBeNull();
    expect(container.querySelector('[data-pdf-role="notice"]')).toBeNull();
    expect(campo("Situação")).toBe("Ativo");
    expect(screen.getByText("Status: Ativo")).toBeInTheDocument();
    expect(campo("Ativado em")).toBe("02/09/2026 11:30");
    expect(screen.queryByText("Arquivado em")).toBeNull();
  });

  it("ARQUIVADO: diz que é versão histórica, e quando foi arquivada", () => {
    const { container } = desenhar(
      modeloPo({ status: "ARCHIVED", archivedAt: "2026-09-10T14:00:00.000Z" }),
    );
    expect(container.querySelector('[data-pdf-role="draft"]')).toBeNull();
    expect(screen.getByText("Versão histórica, arquivada.")).toBeInTheDocument();
    expect(screen.getByText(/não é a versão vigente do modelo/)).toBeInTheDocument();
    expect(campo("Situação")).toBe("Arquivado");
    expect(screen.getByText("Status: Arquivado")).toBeInTheDocument();
    expect(campo("Arquivado em")).toBe("10/09/2026 11:00");
    expect(campo("Ativado em")).toBe("02/09/2026 11:30");
  });

  it("modelo arquivado na biblioteca: o papel avisa, seja qual for a versão", () => {
    desenhar(modeloPo(), { modeloArquivado: true });
    expect(screen.getByText("Modelo arquivado.")).toBeInTheDocument();
    expect(screen.getByText(/não é aplicado a novos produtos/)).toBeInTheDocument();
    expect(campo("Situação")).toBe("Ativo");
  });

  it("origem: a versão do próprio modelo que serviu de molde", () => {
    desenhar(modeloPo());
    expect(campo("Origem")).toBe("Versão V1");
  });

  it("versão sem molde não mostra a linha de origem", () => {
    desenhar(modeloCapsula());
    expect(screen.queryByText("Origem")).toBeNull();
  });
});

describe("Ficha do Modelo — cápsula e pó", () => {
  it("cápsula: cápsulas por dose e por embalagem, coluna e massa por cápsula", () => {
    desenhar(modeloCapsula());
    expect(campo("Forma do produto")).toBe("Cápsula");
    expect(campo("Apresentação comercial")).toBe("Pote");
    expect(campo("Cápsulas por dose")).toBe("1");
    expect(campo("Cápsulas por embalagem")).toBe("120");
    expect(campo("Doses por embalagem")).toBe("120");
    expect(screen.queryByText("Dose")).toBeNull();
    expect(screen.queryByText("Conteúdo da embalagem")).toBeNull();
    expect(screen.getAllByText("Por cápsula").length).toBe(1);
    expect(campo("Massa por cápsula")).toBe("533,289429 mg");
  });

  it("pó: dose e conteúdo da embalagem, e nada de cápsula", () => {
    desenhar(modeloPo());
    expect(campo("Forma do produto")).toBe("Pó");
    expect(campo("Dose")).toBe("30.000 mg");
    expect(campo("Conteúdo da embalagem")).toBe("900.000 mg");
    expect(campo("Doses por embalagem")).toBe("30");
    expect(screen.queryByText("Cápsulas por dose")).toBeNull();
    expect(screen.queryByText("Por cápsula")).toBeNull();
    expect(screen.queryByText("Massa por cápsula")).toBeNull();
  });
});

describe("Ficha do Modelo — legado sem forma", () => {
  it("gera normalmente e omite o que depende da forma", () => {
    const { container } = desenhar(modeloLegado());
    expect(campo("Forma do produto")).toBe("Não informada");
    for (const ausente of [
      "Apresentação comercial",
      "Cápsulas por dose",
      "Cápsulas por embalagem",
      "Dose",
      "Conteúdo da embalagem",
      "Doses por embalagem",
      "Por cápsula",
    ]) {
      expect(screen.queryByText(ausente), ausente).toBeNull();
    }
    // A receita continua inteira: duas matérias-primas e a embalagem.
    expect(campo("Linhas")).toBe("2 na composição · 1 na embalagem");
    expect(container.textContent).toContain("L-metilfolato de cálcio");
  });

  it("base fixa: por dose é travessão, por embalagem sai da base pelo motor", () => {
    desenhar(modeloLegado());
    const folato = celulas(linha("L-metilfolato de cálcio"));
    // Alvo e física por dose não são grandeza de linha em base fixa.
    expect(folato[4]).toBe("—");
    expect(folato[5]).toBe("—");
    // 22 kg ÷ 300 un = 0,073333 kg; pureza 70% autorizada: 0,104762 kg.
    expect(folato).toContain("0,104762 kg");
    // Sem pureza registrada, a física é a teórica: 3 kg ÷ 300 = 0,01 kg.
    expect(celulas(linha("Cloridrato de piridoxina"))).toContain("0,01 kg");
    expect(campo("Massa total por dose")).toBe("—");
  });
});

describe("Ficha do Modelo — o corpo técnico é o da ficha do Produto", () => {
  it("cápsula: mesmas linhas, célula a célula, e o mesmo resumo", () => {
    const produto = render(
      <TechnicalSheetPdf ficha={fichaTecnicaDaVersao(versaoCapsula(), UNIDADES)} generatedAt={GERADO_EM} />,
    );
    const linhasDoProduto = tabelas(produto.container);
    const resumoDoProduto = resumo();
    produto.unmount();

    const modelo = desenhar(modeloDe(versaoCapsula()));
    expect(tabelas(modelo.container)).toEqual(linhasDoProduto);
    expect(resumo()).toEqual(resumoDoProduto);
  });

  it("pó: mesmas linhas, célula a célula, e o mesmo resumo", () => {
    const produto = render(
      <TechnicalSheetPdf ficha={fichaTecnicaDaVersao(versaoPo(), UNIDADES)} generatedAt={GERADO_EM} />,
    );
    const linhasDoProduto = tabelas(produto.container);
    const resumoDoProduto = resumo();
    produto.unmount();

    const modelo = desenhar(modeloDe(versaoPo()));
    expect(tabelas(modelo.container)).toEqual(linhasDoProduto);
    expect(resumo()).toEqual(resumoDoProduto);
  });
});

describe("Ficha do Modelo — composição e embalagem", () => {
  it("a linha traz código, ingrediente, fonte, pureza, alvo, física, unidade, reserva e por embalagem", () => {
    desenhar(modeloCapsula());
    const carbonato = celulas(linha("Carbonato de cálcio"));
    expect(carbonato[0]).toBe("MP-000259");
    expect(carbonato[1]).toBe("Carbonato de cálcio");
    expect(carbonato[2]).toBe("Mineral · Cálcio");
    expect(carbonato[3]).toBe("100%");
    expect(carbonato[4]).toBe("500");
    expect(carbonato[5]).toBe("500");
    expect(carbonato).toContain("mg");
    expect(carbonato).toContain("10%");
    // 500 mg × 120 doses = 60.000 mg = 0,06 kg, na unidade de estoque.
    expect(carbonato).toContain("0,06 kg");
  });

  it("embalagem em seção própria, sem pureza nem reserva", () => {
    desenhar(modeloCapsula());
    expect(screen.getByText("Embalagem")).toBeInTheDocument();
    const capsula = celulas(linha("Exemplo - CAPS 0 BCA/BCA 311/311"));
    expect(capsula).toEqual(["ME-000134", "Exemplo - CAPS 0 BCA/BCA 311/311", "120", "un", "120 un"]);
    const pote = celulas(linha(/POTE R220 PET 45/));
    expect(pote.length).toBe(5);
    expect(pote.join(" ")).not.toContain("%");
  });

  it("material do cliente aparece na linha; o da Veridi não vira ruído", () => {
    const version = modeloCapsula();
    version.components[0] = { ...version.components[0]!, supplyResponsibility: "CUSTOMER" };
    const { container } = desenhar(version);
    expect(linha("L-metilfolato de cálcio")).toHaveTextContent("Material do cliente");
    expect(container.textContent).not.toContain("Material da Veridi");
  });

  it("item inativado depois da versão continua na matriz, marcado", () => {
    const version = modeloCapsula();
    version.components[1] = { ...version.components[1]!, itemActive: false };
    desenhar(version);
    expect(linha("Cloridrato de piridoxina")).toHaveTextContent("Item inativo no cadastro");
  });

  it("modelo sem receita ainda gera a ficha, dizendo que não há linhas", () => {
    desenhar(modeloCapsula({ components: [] }));
    expect(screen.getByText("Nenhuma matéria-prima registrada nesta versão.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum item de embalagem registrado nesta versão.")).toBeInTheDocument();
  });
});

describe("Ficha do Modelo — snapshot da versão", () => {
  it("a pureza impressa é a da VERSÃO; a do cadastro de hoje sai ao lado", () => {
    desenhar(modeloCapsula());
    const folato = linha("L-metilfolato de cálcio");
    expect(folato).toHaveTextContent("70%");
    expect(folato).toHaveTextContent("hoje 88,7%");
    // A física continua a da pureza da versão: 0,4 mg ÷ 70%.
    expect(celulas(folato).filter((celula) => celula === "0,571429").length).toBe(2);
  });

  it("pureza registrada e não aplicada diz isso na linha", () => {
    const version = modeloCapsula();
    version.components[0] = {
      ...version.components[0]!,
      quantityMode: "PHYSICAL_DIRECT",
      applyPurityAdjustment: false,
    };
    desenhar(version);
    const folato = linha("L-metilfolato de cálcio");
    expect(folato).toHaveTextContent("não aplicada");
    // Sem ajuste autorizado, a física por dose é o próprio alvo.
    expect(celulas(folato).filter((celula) => celula === "0,4").length).toBe(3);
  });

  it("reserva é a da versão, sai como Reserva — nunca overage — e travessão quando ausente", () => {
    const version = modeloCapsula();
    version.components[0] = { ...version.components[0]!, overagePercent: null };
    const { container } = desenhar(version);
    expect(screen.getByText("Reserva (%)")).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toContain("overage");
    expect(celulas(linha("L-metilfolato de cálcio"))).toContain("—");
    expect(celulas(linha("Carbonato de cálcio"))).toContain("10%");
  });

  it("perda prevista e rendimento esperado saem da versão do modelo", () => {
    desenhar(modeloCapsula());
    expect(campo("Perda prevista de produção (%)")).toBe("4%");
    expect(campo("Rendimento esperado (%)")).toBe("96%");
  });

  it("perda não informada é travessão nos dois campos — nunca 0% nem 100%", () => {
    desenhar(modeloCapsula({ expectedLossPercent: null }));
    expect(campo("Perda prevista de produção (%)")).toBe("—");
    expect(campo("Rendimento esperado (%)")).toBe("—");
  });

  it("perda com casas decimais sai com as casas técnicas", () => {
    desenhar(modeloPo());
    expect(campo("Perda prevista de produção (%)")).toBe("2,5%");
    expect(campo("Rendimento esperado (%)")).toBe("97,5%");
  });
});

describe("Ficha do Modelo — nada de economia no papel", () => {
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

  for (const [nome, versao] of [
    ["cápsula", () => modeloCapsula()],
    ["pó", () => modeloPo()],
    ["legado", () => modeloLegado()],
    ["arquivado", () => modeloPo({ status: "ARCHIVED", archivedAt: "2026-09-10T14:00:00.000Z" })],
  ] as const) {
    it(`${nome}: nenhuma palavra de custo, preço ou fornecedor`, () => {
      const { container } = desenhar(versao(), { modeloArquivado: nome === "arquivado" });
      const texto = (container.textContent ?? "").toLowerCase();
      for (const proibido of PROIBIDOS) {
        expect(texto, `"${proibido}" não pode estar na ficha do modelo`).not.toContain(proibido);
      }
    });
  }

  it("as observações da versão do modelo não vão ao papel — texto livre não se controla", () => {
    /* A observação real da receita de referência cita CMV e "overage". */
    const { container } = desenhar(modeloPo());
    const texto = (container.textContent ?? "").toLowerCase();
    expect(texto).not.toContain("overage");
    expect(texto).not.toContain("base cálculo");
    expect(screen.queryByText(/Observações/)).toBeNull();
  });
});
