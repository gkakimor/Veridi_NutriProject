import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextHelp, FlowSteps, InfoHint } from ".";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpTopic } from "../../help/help-content";

/**
 * O que estes testes protegem não é o texto da ajuda — é a promessa do kit:
 * explicação alcançável sem mouse, painel que não aparece sem ser chamado e
 * fluxo cuja ordem é a ordem real do processo.
 */

const topicoBase: HelpTopic = {
  module: "producao",
  title: "Como a versão ativa é escolhida",
  summary: "Só uma versão fica ativa por produto.",
  steps: [
    { label: "Rascunho", detail: "Editável à vontade." },
    { label: "Publicação" },
  ],
};

describe("InfoHint", () => {
  it("dá nome acessível ao ícone dizendo qual conceito ele explica", () => {
    render(<InfoHint label="Em compra">Pedido ao fornecedor, ainda não recebido.</InfoHint>);

    // "Ajuda" sozinho não diz nada numa tela com seis ícones iguais.
    expect(screen.getByRole("button", { name: "Ajuda sobre Em compra" })).toBeInTheDocument();
  });

  it("nasce fechado e abre no clique", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="Em compra">Pedido ao fornecedor, ainda não recebido.</InfoHint>);

    const icone = screen.getByRole("button", { name: "Ajuda sobre Em compra" });
    expect(icone).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/ainda não recebido/)).toBeNull();

    await user.click(icone);

    expect(icone).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/ainda não recebido/)).toBeInTheDocument();
  });

  it("fecha no segundo clique", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="Em compra">Pedido ao fornecedor, ainda não recebido.</InfoHint>);

    const icone = screen.getByRole("button", { name: "Ajuda sobre Em compra" });
    await user.click(icone);
    await user.click(icone);

    expect(icone).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/ainda não recebido/)).toBeNull();
  });

  it("abre pelo teclado e o Escape devolve o foco ao ícone", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="Disponível">Saldo livre para uso.</InfoHint>);

    await user.tab();
    const icone = screen.getByRole("button", { name: "Ajuda sobre Disponível" });
    expect(icone).toHaveFocus();

    // Sem passar o mouse: o conteúdo não pode depender de hover.
    await user.keyboard("{Enter}");
    expect(screen.getByText("Saldo livre para uso.")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Saldo livre para uso.")).toBeNull();
    // Sem devolver o foco, o Tab seguinte recomeçaria do topo da página.
    expect(icone).toHaveFocus();
  });

  it("o mouse também abre — hover é atalho, não a única porta", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="Em compra">Pedido ao fornecedor, ainda não recebido.</InfoHint>);

    const icone = screen.getByRole("button", { name: "Ajuda sobre Em compra" });
    await user.hover(icone);
    expect(screen.getByText(/ainda não recebido/)).toBeInTheDocument();

    await user.unhover(icone);
    expect(screen.queryByText(/ainda não recebido/)).toBeNull();
  });
});

describe("ContextHelp", () => {
  it("nasce fechado e nunca abre sozinho", () => {
    render(<ContextHelp topic={topicoBase} />);

    const gatilho = screen.getByRole("button", { name: /Como funciona/ });
    expect(gatilho).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(topicoBase.title)).toBeNull();
  });

  it("abre com título, descrição e etapas na ordem", async () => {
    const user = userEvent.setup();
    render(<ContextHelp topic={topicoBase} />);

    const gatilho = screen.getByRole("button", { name: /Como funciona/ });
    await user.click(gatilho);

    expect(gatilho).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: topicoBase.title })).toBeInTheDocument();
    expect(screen.getByText(topicoBase.summary)).toBeInTheDocument();

    const etapas = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(etapas[0]).toContain("Rascunho");
    expect(etapas[0]).toContain("Editável à vontade.");
    expect(etapas[1]).toContain("Publicação");
  });

  it("mostra observações quando o tópico tem ressalvas", async () => {
    const user = userEvent.setup();
    render(
      <ContextHelp topic={{ ...topicoBase, notes: ["Versão publicada não volta a rascunho."] }} />,
    );

    await user.click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(screen.getByRole("heading", { name: "O que costuma pegar" })).toBeInTheDocument();
    expect(screen.getByText("Versão publicada não volta a rascunho.")).toBeInTheDocument();
  });

  it("o link de documentação só aparece quando o tópico tem um", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ContextHelp topic={topicoBase} />);

    await user.click(screen.getByRole("button", { name: /Como funciona/ }));
    expect(screen.queryByRole("link")).toBeNull();
    unmount();

    render(
      <ContextHelp
        topic={{ ...topicoBase, doc: { label: "Manual da formulação", href: "/ajuda/formulacao" } }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Como funciona/ }));

    const link = screen.getByRole("link", { name: "Manual da formulação" });
    expect(link).toHaveAttribute("href", "/ajuda/formulacao");
    // Destino interno não abre em aba nova: sair do ERP custa o formulário.
    expect(link).not.toHaveAttribute("target");
  });

  it("fecha com Escape e devolve o foco ao gatilho", async () => {
    const user = userEvent.setup();
    render(<ContextHelp topic={topicoBase} />);

    const gatilho = screen.getByRole("button", { name: /Como funciona/ });
    await user.click(gatilho);
    expect(screen.getByRole("heading", { name: topicoBase.title })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText(topicoBase.title)).toBeNull();
    expect(gatilho).toHaveAttribute("aria-expanded", "false");
    expect(gatilho).toHaveFocus();
  });

  it("desenha o fluxo do tópico quando ele existe", async () => {
    const user = userEvent.setup();
    const topico = helpTopics["planoAtendimento.comoFunciona"];
    render(<ContextHelp topic={topico} />);

    await user.click(screen.getByRole("button", { name: /Como funciona/ }));

    const fluxo = screen.getByRole("list", { name: "Fluxo: Fluxo da tela" });
    // Derivado do próprio tópico: o teste prova a NUMERAÇÃO e a ordem, não
    // decora o conteúdo — que é revisado por quem conhece a regra.
    const esperado = (topico.flow ?? []).map((etapa, i) => `${i + 1}${etapa.label}`);
    expect(within(fluxo).getAllByRole("listitem").map((item) => item.textContent)).toEqual(
      esperado,
    );
    expect(esperado.length).toBeGreaterThan(1);
  });
});

describe("FlowSteps", () => {
  it("mantém as etapas na ordem em que o processo acontece", () => {
    render(
      <FlowSteps
        steps={[
          { label: "Pedido" },
          { label: "Estoque" },
          { label: "Falta" },
          { label: "Produção/Compra" },
        ]}
      />,
    );

    // As setas são desenho em CSS: não entram no texto lido nem no textContent.
    // O número entra, e é ele que o leitor usa para achar a etapa no texto.
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "1Pedido",
      "2Estoque",
      "3Falta",
      "4Produção/Compra",
    ]);
  });

  /*
   * O número é o que liga a caixa ao passo a passo logo abaixo. O detalhe
   * não fica na caixa de propósito: repetido nos dois lugares, polui o
   * desenho e a pessoa lê a mesma frase duas vezes.
   */
  it("numera as etapas para casar com o passo a passo", () => {
    render(<FlowSteps steps={[{ label: "Falta", detail: "Pedido maior que o disponível" }]} />);

    expect(screen.getByText("Falta")).toBeInTheDocument();
    expect(screen.queryByText("Pedido maior que o disponível")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("sem etapas não sobra lista vazia na tela", () => {
    const { container } = render(<FlowSteps steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("conteúdo centralizado", () => {
  it("cada dica traz o conceito e o texto que a tela vai exibir", async () => {
    const user = userEvent.setup();
    const dica = helpHints["planoAtendimento.emCompra"];
    render(<InfoHint label={dica.label}>{dica.text}</InfoHint>);

    await user.click(screen.getByRole("button", { name: `Ajuda sobre ${dica.label}` }));

    expect(screen.getByText(dica.text)).toBeInTheDocument();
  });
});
