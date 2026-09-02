import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FullWorkspaceModal } from "./FullWorkspaceModal";

/**
 * Cadastro dentro de cadastro virou rotina: um campo de busca oferece
 * "+ Novo item de estoque" e abre o cadastro de Item por cima da relação
 * Item × Fornecedor que estava sendo preenchida.
 *
 * O Escape ficava registrado no `document` por cada modal aberto, então os
 * dois fechavam na mesma tecla — quem desistia do item perdia junto a
 * relação inteira, sem ter pedido. Uma tecla, uma camada.
 */

function Empilhados({ fecharExterno }: { fecharExterno: () => void }) {
  const [internoAberto, setInternoAberto] = useState(false);

  return (
    <FullWorkspaceModal
      open
      onClose={fecharExterno}
      crumb="Compras"
      crumbActive="Nova relação"
      title="Nova relação"
      footer={null}
    >
      <button type="button" onClick={() => setInternoAberto(true)}>
        Novo item de estoque
      </button>
      {internoAberto && (
        <FullWorkspaceModal
          open
          onClose={() => setInternoAberto(false)}
          crumb="Cadastros"
          crumbActive="Novo item de estoque"
          title="Novo item de estoque"
          footer={null}
        >
          <p>Formulário do item</p>
        </FullWorkspaceModal>
      )}
    </FullWorkspaceModal>
  );
}

describe("modal sobre modal", () => {
  it("Escape fecha só a camada de cima", async () => {
    const user = userEvent.setup();
    const fecharExterno = vi.fn();
    render(<Empilhados fecharExterno={fecharExterno} />);

    await user.click(screen.getByRole("button", { name: "Novo item de estoque" }));
    expect(await screen.findByText("Formulário do item")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    // O de dentro sai…
    await waitFor(() => expect(screen.queryByText("Formulário do item")).toBeNull());
    // …e o de fora fica. Perder a relação aqui custaria o formulário inteiro.
    expect(fecharExterno).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Nova relação" })).toBeInTheDocument();
  });

  it("o segundo Escape fecha o que sobrou", async () => {
    const user = userEvent.setup();
    const fecharExterno = vi.fn();
    render(<Empilhados fecharExterno={fecharExterno} />);

    await user.click(screen.getByRole("button", { name: "Novo item de estoque" }));
    await screen.findByText("Formulário do item");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Formulário do item")).toBeNull());
    await user.keyboard("{Escape}");

    expect(fecharExterno).toHaveBeenCalledTimes(1);
  });

  /*
   * Cada camada precisa do próprio `id` de título. Com `id` fixo havia dois
   * elementos iguais no documento e o `aria-labelledby` do modal de cima
   * resolvia para o título do de baixo: o leitor de tela anunciava o
   * cadastro errado, que é pior do que não anunciar nada.
   */
  it("cada camada anuncia o próprio título", async () => {
    const user = userEvent.setup();
    render(<Empilhados fecharExterno={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Novo item de estoque" }));
    await screen.findByText("Formulário do item");

    const dialogos = screen.getAllByRole("dialog");
    expect(dialogos).toHaveLength(2);
    expect(dialogos[0]).toHaveAccessibleName("Nova relação");
    expect(dialogos[1]).toHaveAccessibleName("Novo item de estoque");
  });

  it("fechar a camada de cima não devolve a rolagem do fundo", async () => {
    const user = userEvent.setup();
    render(<Empilhados fecharExterno={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Novo item de estoque" }));
    await screen.findByText("Formulário do item");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Formulário do item")).toBeNull());

    // A página de trás continua escondida pelo modal externo: destravar a
    // rolagem aqui deixaria o fundo correndo atrás de um modal ainda aberto.
    expect(document.body.style.overflow).toBe("hidden");
  });
});
