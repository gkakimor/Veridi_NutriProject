import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EntityOption } from "../SearchableEntitySelect";
import { EntityFilterSelect } from "./EntityFilterSelect";
import type { EntityFilterSource } from "./EntityFilterSelect";

/**
 * Nome longo escolhido no filtro por entidade (MOBILE-UX-CLEANUP-WAVE-01).
 *
 * O ✕ de limpar é absoluto sobre o campo, e o campo reservava à direita o mesmo
 * padding de um campo sem botão: o nome escolhido corria 14px por baixo do ✕,
 * cortado seco no meio da palavra — medido no Chromium em 390 e 1440, nas
 * barras de Projetos, Produtos, Faturamento, Materiais de Clientes, Pedidos,
 * Lotes, OP, Recebimentos, Quadro de Produção, relatório de Pedidos e no
 * formulário de Projeto.
 *
 * jsdom não faz layout. Aqui fica a REGRA — reserva que segue o botão,
 * reticências, alvo do ✕ — e a estrutura que a faz valer: o ✕ no mesmo
 * `.entity-select` do campo, que é o que o `:has` da regra enxerga. A medida em
 * pixel (texto sob o ✕ = 0) é do smoke com navegador.
 */

const LONGO: EntityOption = {
  id: "cli-134",
  code: "CLI-000134",
  name: "AMAZÔNIA DO BRASIL COMÉRCIO E DSITRIBUIÇÃO DE ALIMENTOS LTDA - ME",
};
const ROTULO_LONGO = `${LONGO.code} · ${LONGO.name}`;

const fonte: EntityFilterSource = {
  inicial: async () => [LONGO],
  buscar: async () => [LONGO],
  porId: async (id) => (id === LONGO.id ? LONGO : null),
};

function Barra({ inicial = "", aoMudar }: { inicial?: string; aoMudar?: (id: string) => void }) {
  const [valor, setValor] = useState(inicial);
  return (
    <div className="toolbar">
      <EntityFilterSelect
        id="filtro-cliente"
        label="Filtrar por cliente"
        placeholder="Todos os clientes"
        value={valor}
        onChange={(id) => {
          setValor(id);
          aoMudar?.(id);
        }}
        source={fonte}
      />
    </div>
  );
}

const campo = () => screen.getByRole("combobox", { name: "Filtrar por cliente" });

const folha = readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");
const tokens = readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf8");

/** Corpo da regra cujo seletor é exatamente `seletor`, no começo da linha. */
function regra(seletor: string): string {
  const inicio = folha.indexOf(`\n${seletor} {`);
  expect(inicio, `regra "${seletor}"`).toBeGreaterThanOrEqual(0);
  return folha.slice(inicio, folha.indexOf("}", inicio));
}

function propriedade(bloco: string, nome: string): string {
  const achado = bloco.match(new RegExp(`\\n\\s*${nome}:\\s*([^;]+);`));
  expect(achado, `propriedade "${nome}"`).not.toBeNull();
  return achado![1]!.trim();
}

/** Pixels de `28px`, `var(--sp-2)` ou `calc(28px + var(--sp-2))`. */
function px(valor: string): number {
  return [...valor.matchAll(/(\d+(?:\.\d+)?)px|var\((--[\w-]+)\)/g)].reduce((soma, [, numero, token]) => {
    if (numero) return soma + Number(numero);
    const definido = tokens.match(new RegExp(`${token}:\\s*(\\d+)px`));
    expect(definido, `token ${token}`).not.toBeNull();
    return soma + Number(definido![1]);
  }, 0);
}

describe("nome longo escolhido no filtro por entidade", () => {
  it("o campo mostra o nome inteiro, o ✕ mora no mesmo contêiner do campo e o rótulo continua associado", async () => {
    render(<Barra inicial={LONGO.id} />);
    await waitFor(() => expect(campo()).toHaveValue(ROTULO_LONGO));

    const limpar = screen.getByRole("button", { name: "Limpar seleção" });
    // A reserva à direita é `.entity-select:has(.entity-select__clear) input`:
    // só vale com botão e campo no MESMO `.entity-select`.
    expect(limpar.closest(".entity-select")).toBe(campo().closest(".entity-select"));
    expect(limpar.parentElement).toBe(campo().parentElement);
    expect(limpar).toHaveAttribute("type", "button");
    // Largura de filtro (240px no desktop, linha inteira em 390px) vem da barra.
    const barra = campo().closest(".toolbar__entity");
    expect(barra).not.toBeNull();
    expect(barra!.closest(".toolbar")).not.toBeNull();
    expect(campo().closest("[style]")).toBeNull();
  });

  it("✕ limpa: o filtro volta a todos, o foco fica no campo e o botão sai — com ele a reserva", async () => {
    const aoMudar = vi.fn();
    render(<Barra inicial={LONGO.id} aoMudar={aoMudar} />);
    await waitFor(() => expect(campo()).toHaveValue(ROTULO_LONGO));

    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));

    expect(aoMudar).toHaveBeenCalledWith("");
    await waitFor(() => expect(campo()).toHaveValue(""));
    expect(campo()).toHaveFocus();
    expect(campo().closest(".entity-select")!.querySelector(".entity-select__clear")).toBeNull();
  });

  it("lista aberta sobre um nome escolhido: sem ✕, a busca usa a largura inteira do campo", async () => {
    render(<Barra inicial={LONGO.id} />);
    await waitFor(() => expect(campo()).toHaveValue(ROTULO_LONGO));

    fireEvent.focus(campo());

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(campo().closest(".entity-select")!.querySelector(".entity-select__clear")).toBeNull();
    // Enquanto se busca, quem está escolhido segue à vista no placeholder.
    expect(campo()).toHaveAttribute("placeholder", ROTULO_LONGO);
  });
});

describe("a regra que tira o texto de baixo do ✕", () => {
  it("com o ✕ presente, o padding direito cobre o botão e o recuo dele — e passa o de campo sem botão", () => {
    const base = regra(".entity-select input");
    const comBotao = regra(".entity-select:has(.entity-select__clear) input");
    const botao = regra(".entity-select__clear");

    const reserva = px(propriedade(comBotao, "padding-right"));
    expect(reserva).toBeGreaterThanOrEqual(px(propriedade(botao, "width")) + px(propriedade(botao, "right")));
    expect(propriedade(botao, "position")).toBe("absolute");
    // Era a mesma reserva de campo sem botão — e o texto passava por baixo.
    const paddingSemBotao = propriedade(base, "padding").split(/\s+/).at(-1)!;
    expect(reserva).toBeGreaterThan(px(paddingSemBotao));
  });

  it("nome que não cabe termina em reticências, não num corte seco", () => {
    expect(propriedade(regra(".entity-select input"), "text-overflow")).toBe("ellipsis");
  });

  it("o ✕ não encolheu: alvo de 24 × 24 ou mais, dentro do campo, com foco visível", () => {
    const botao = regra(".entity-select__clear");
    const altura = px(propriedade(botao, "height"));
    expect(px(propriedade(botao, "width"))).toBeGreaterThanOrEqual(24);
    expect(altura).toBeGreaterThanOrEqual(24);
    expect(altura).toBeLessThanOrEqual(px(propriedade(regra(".entity-select input"), "height")) - 2);
    expect(folha).toMatch(/\n\.entity-select__clear:focus-visible \{[^}]*box-shadow: var\(--focus-ring\)/);
  });

  it("largura do controle intacta: 240px de filtro no desktop, linha inteira em tela estreita", () => {
    expect(propriedade(regra(".toolbar__entity"), "min-width")).toBe("240px");
    const estreita = folha.slice(folha.lastIndexOf("@media (max-width: 640px)"));
    expect(estreita).toMatch(/\.toolbar__search,\s*\.toolbar__entity \{\s*min-width: 100%;/);
  });
});
