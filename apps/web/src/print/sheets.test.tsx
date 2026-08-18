import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PrintCheckCell, PrintSheet, PrintSignatureArea, PrintWriteCell } from "./PrintSheet";
import { PrintTable } from "./PrintLayout";

/**
 * Folhas operacionais impressas.
 *
 * O que estes testes protegem não é a aparência: é a promessa de que o
 * papel é um DOCUMENTO (identidade, código, filtros, quem gerou, espaço de
 * anotação) e não uma captura da tela operacional.
 */

function renderSheet(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Folha operacional impressa", () => {
  it("traz identidade, código do documento, filtros e quem gerou", () => {
    renderSheet(
      <PrintSheet
        sheetCode="FO-01"
        title="Folha de contagem física de estoque"
        backTo="/estoque/inventario"
        filters={[
          { label: "Busca", value: "vitamina" },
          { label: "Linhas", value: "12" },
        ]}
      >
        <PrintTable columns={["Item"]} isEmpty={false} emptyMessage="vazio">
          <tr>
            <td>MP-000001</td>
          </tr>
        </PrintTable>
      </PrintSheet>,
    );

    // Marca oficial vem de asset local — o papel nunca busca imagem na rede.
    const brand = screen.getByAltText("Veridi Nutrition") as HTMLImageElement;
    expect(brand.getAttribute("src")).toBeTruthy();
    expect(brand.getAttribute("src")).not.toMatch(/^https?:/);
    // O código aparece DUAS vezes de propósito: no cabeçalho e no rodapé
    // corrido, que se repete em toda folha impressa.
    expect(document.querySelector(".print-doc__doc-code")?.textContent).toBe("FO-01");
    expect(document.querySelector(".print-doc__kind")?.textContent).toBe(
      "Folha de contagem física de estoque",
    );
    // Filtros aplicados precisam viajar com o papel: sem isso ninguém sabe
    // o que a folha está mostrando.
    expect(screen.getByText("Busca")).toBeTruthy();
    expect(screen.getByText("vitamina")).toBeTruthy();
    // "Gerado por" existe mesmo sem sessão no teste — nunca um nome inventado.
    expect(screen.getByText(/Gerado por/)).toBeTruthy();
    expect(screen.getByText(/Gerado em/)).toBeTruthy();
  });

  /**
   * Relatório e folha operacional saem com dezenas de páginas. Sem rodapé
   * corrido a identidade documental existia só na folha 1, e a página que se
   * separa da pilha não dizia de que documento veio.
   */
  it("repete a identidade do documento em rodapé corrido", () => {
    renderSheet(
      <PrintSheet sheetCode="FO-01" title="Folha de contagem" backTo="/">
        <p>conteúdo</p>
      </PrintSheet>,
    );

    const runningFoot = document.querySelector(".print-running-foot");
    expect(runningFoot).toBeTruthy();
    expect(runningFoot?.textContent).toContain("FO-01");
    expect(runningFoot?.textContent).toContain("Folha de contagem");
  });

  it("mantém os controles fora do documento impresso", () => {
    const { container } = renderSheet(
      <PrintSheet sheetCode="FO-03" title="Pendências de qualidade / CoA" backTo="/qualidade/documentos">
        <p>conteúdo</p>
      </PrintSheet>,
    );

    // Pré-visualização: o usuário decide imprimir. O botão existe na tela e
    // fica dentro de `.print-actions`, que o CSS de impressão remove.
    const actions = container.querySelector(".print-actions");
    expect(actions).toBeTruthy();
    expect(actions?.textContent).toContain("Imprimir / Salvar PDF");

    // O documento em si não contém a barra de ações.
    const doc = container.querySelector(".print-doc");
    expect(doc?.querySelector(".print-actions")).toBeNull();
    // Nem qualquer resquício do shell operacional.
    expect(container.querySelector(".app-shell__sidebar")).toBeNull();
    expect(container.querySelector(".toolbar")).toBeNull();
  });

  it("imprime campos de anotação manual sem persistir nada", () => {
    const { container } = renderSheet(
      <PrintSheet sheetCode="FO-04" title="Folha de separação / picking da produção" backTo="/producao/ordens">
        <PrintTable columns={["Item", "Conferido", "Observação"]} isEmpty={false} emptyMessage="vazio">
          <tr>
            <td>MP-000001</td>
            <PrintCheckCell />
            <PrintWriteCell />
          </tr>
        </PrintTable>
        <PrintSignatureArea fields={["Separado por", "Data"]} />
      </PrintSheet>,
    );

    // Caixa de conferência é papel: não existe input, não existe estado.
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelector(".print-write--check")?.textContent).toBe("☐");
    expect(container.querySelectorAll(".print-write")).toHaveLength(2);
    expect(screen.getByText("Separado por")).toBeTruthy();
  });

  it("usa retrato por padrão e paisagem só quando pedido", () => {
    const { container: portrait } = renderSheet(
      <PrintSheet sheetCode="FO-01" title="Contagem" backTo="/">
        <p>x</p>
      </PrintSheet>,
    );
    expect(portrait.querySelector(".print-screen--landscape")).toBeNull();

    const { container: landscape } = renderSheet(
      <PrintSheet sheetCode="FO-02" title="Posição" backTo="/" landscape>
        <p>x</p>
      </PrintSheet>,
    );
    expect(landscape.querySelector(".print-screen--landscape")).toBeTruthy();
  });

  it("mostra valor desconhecido como travessão, nunca zero", () => {
    renderSheet(
      <PrintSheet sheetCode="FO-02" title="Posição" backTo="/">
        <PrintTable columns={["Lote", "Localização"]} isEmpty={false} emptyMessage="vazio">
          <tr>
            <td>LT-20260101-000001</td>
            <td>—</td>
          </tr>
        </PrintTable>
      </PrintSheet>,
    );

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("R$ 0,00")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });
});
