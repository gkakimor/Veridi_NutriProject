import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PricingPolicyDTO, PricingPolicyVersionDTO } from "@veridi/shared";
import { DEFAULT_PRICING_MODEL } from "@veridi/shared";

/**
 * UX-ACTIONS-FEEDBACK-01 — Política de Precificação como implementação de
 * referência.
 *
 * Três coisas que a tela não dizia: qual opção está escolhida (o radio era a
 * única pista, e o campo dela ficava do outro lado da linha), qual botão
 * comanda o quê (três botões com o mesmo peso), e se "Salvar rascunho" salvou.
 *
 * O que está protegido aqui é a LEITURA da tela, não a conta: o cálculo, a
 * regra de preservação de valor e a guarda de alterações não salvas continuam
 * cobertos pelas suítes de sempre.
 */

const getPricingPolicy = vi.fn();
const updatePricingPolicy = vi.fn();
const updatePricingPolicyVersion = vi.fn();
const activatePricingPolicyVersion = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getPricingPolicy: (...a: unknown[]) => getPricingPolicy(...a),
  updatePricingPolicy: (...a: unknown[]) => updatePricingPolicy(...a),
  updatePricingPolicyVersion: (...a: unknown[]) => updatePricingPolicyVersion(...a),
  activatePricingPolicyVersion: (...a: unknown[]) => activatePricingPolicyVersion(...a),
  setPricingPolicyArchived: vi.fn(),
  createPolicyVersionFrom: vi.fn(),
  comparePricingPolicyVersions: vi.fn(),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { PricingPolicyDetailPage } from "./PricingPolicyDetailPage";

function rascunho(overrides: Partial<PricingPolicyVersionDTO> = {}): PricingPolicyVersionDTO {
  return {
    id: "tppv-2",
    pricingPolicyTemplateId: "tpp-1",
    templateCode: "TPP-000002",
    templateName: "Private Label — Padrão",
    versionNumber: 2,
    versionLabel: "TPP-000002 V2",
    status: "DRAFT",
    notes: null,
    tiers: [
      {
        id: "t1",
        quantity: "500",
        uomCode: "un",
        priceMode: "TARGET_MARGIN",
        targetContributionMarginPercent: "35.0000",
        commissionPercent: "5.0000",
        notes: null,
        sortOrder: 0,
      },
    ],
    pricingModel: { ...DEFAULT_PRICING_MODEL },
    applicableTaxProfiles: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    ...overrides,
  };
}

function policy(overrides: Partial<PricingPolicyDTO> = {}): PricingPolicyDTO {
  const draft = rascunho();
  return {
    id: "tpp-1",
    code: "TPP-000002",
    name: "Private Label — Padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: draft,
    versions: [draft],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

async function abrir() {
  const { container } = render(
    <MemoryRouter initialEntries={["/gestao/politicas-precificacao/tpp-1"]}>
      <Routes>
        <Route
          path="/gestao/politicas-precificacao/:policyId"
          element={<PricingPolicyDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByLabelText("Nome")).toHaveValue("Private Label — Padrão"));
  return container;
}

const industrial = () => screen.getByRole("group", { name: "Custo industrial" });
const impostos = () => screen.getByRole("group", { name: "Impostos estimados" });

/** A linha inteira da opção — o que carrega o estado visual de escolhida. */
function linha(grupo: HTMLElement, rotulo: string): HTMLElement {
  const opcao = within(grupo).getByRole("radio", { name: rotulo });
  const alvo = opcao.closest(".selection-row");
  if (!alvo) throw new Error(`sem linha de escolha para "${rotulo}"`);
  return alvo as HTMLElement;
}

const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });
const margem = () => screen.getAllByLabelText("Margem alvo")[0] as HTMLInputElement;

/** A leitura seguinte já traz a faixa com a margem gravada. */
function comMargemGravada(margemAlvo: string) {
  getPricingPolicy.mockResolvedValue(
    policy({
      draftVersion: rascunho({
        tiers: [
          {
            id: "t1",
            quantity: "500",
            uomCode: "un",
            priceMode: "TARGET_MARGIN",
            targetContributionMarginPercent: margemAlvo,
            commissionPercent: "5.0000",
            notes: null,
            sortOrder: 0,
          },
        ],
      }),
    }),
  );
}

const css = () => readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");

/** Todo bloco `@media` com esta condição, de chave a chave. */
function blocosDeMedia(condicao: string): string[] {
  const folha = css();
  const blocos: string[] = [];
  let de = folha.indexOf(`@media (${condicao})`);
  while (de >= 0) {
    let nivel = 0;
    let ate = folha.indexOf("{", de);
    for (let i = ate; i < folha.length; i += 1) {
      if (folha[i] === "{") nivel += 1;
      if (folha[i] === "}") {
        nivel -= 1;
        if (nivel === 0) {
          ate = i;
          break;
        }
      }
    }
    blocos.push(folha.slice(de, ate + 1));
    de = folha.indexOf(`@media (${condicao})`, ate);
  }
  return blocos;
}

/** O corpo de uma regra CSS, pelo seletor exato. */
function regra(seletor: string): string {
  const folha = css();
  const inicio = folha.indexOf(`\n${seletor} {`);
  if (inicio < 0) throw new Error(`regra ausente: ${seletor}`);
  return folha.slice(inicio, folha.indexOf("}", inicio));
}

beforeEach(() => {
  vi.clearAllMocks();
  getPricingPolicy.mockResolvedValue(policy());
  updatePricingPolicyVersion.mockResolvedValue(undefined);
  updatePricingPolicy.mockResolvedValue(undefined);
  activatePricingPolicyVersion.mockResolvedValue(undefined);
});

describe("Linha de escolha — a opção é a linha, não a bolinha", () => {
  it("a opção escolhida marca a linha inteira, e não só pela cor", async () => {
    await abrir();

    const escolhida = linha(industrial(), "Conforme a Estrutura de Custos (cálculo do ERP)");
    expect(escolhida).toHaveClass("selection-row--selected");
    expect(escolhida).toHaveAttribute("data-selected", "true");
    // Fundo, borda E peso do rótulo mudam juntos: quem não distingue as cores
    // ainda vê qual linha está escolhida.
    const destaque = regra(".selection-row--selected");
    expect(destaque).toContain("border-color");
    expect(destaque).toContain("background");
    expect(regra(".selection-row--selected .selection-row__label")).toContain(
      "font-weight: var(--fw-semibold)",
    );
  });

  it("escolher outra opção tira o estado da anterior", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(within(industrial()).getByRole("radio", { name: "R$ total" }));

    expect(linha(industrial(), "R$ total")).toHaveClass("selection-row--selected");
    expect(linha(industrial(), "Conforme a Estrutura de Custos (cálculo do ERP)")).not.toHaveClass(
      "selection-row--selected",
    );
    // Grupos diferentes não se contaminam.
    expect(linha(impostos(), "Não considerar")).toHaveClass("selection-row--selected");
  });

  it("clicar no texto da opção escolhe — não é preciso acertar a bolinha", async () => {
    const user = userEvent.setup();
    await abrir();

    const rotulo = within(impostos()).getByText("% sobre preço de venda");
    await user.click(rotulo);

    expect(within(impostos()).getByRole("radio", { name: "% sobre preço de venda" })).toBeChecked();
    expect(linha(impostos(), "% sobre preço de venda")).toHaveClass("selection-row--selected");
  });

  it("o rótulo continua sendo o label do próprio radio, e o foco continua visível", async () => {
    await abrir();

    const opcao = within(impostos()).getByRole("radio", { name: "R$ por unidade" });
    // Nome acessível vem do label — não de um `aria-label` inventado.
    expect(opcao.closest("label")).toHaveTextContent("R$ por unidade");

    opcao.focus();
    expect(opcao).toHaveFocus();
    fireEvent.click(opcao);
    expect(opcao).toBeChecked();
    // Foco visível é regra da folha base, não de cada tela.
    expect(readFileSync(join(process.cwd(), "src", "styles", "base.css"), "utf8")).toContain(
      "box-shadow: var(--focus-ring)",
    );
  });

  it("o campo à direita pertence à opção: só o do modo escolhido aceita digitação", async () => {
    const user = userEvent.setup();
    await abrir();

    const porUnidade = screen.getByLabelText("Custo industrial (R$ por unidade)");
    expect(porUnidade).toBeDisabled();

    await user.click(within(industrial()).getByRole("radio", { name: "R$ por unidade" }));

    expect(porUnidade).toBeEnabled();
    expect(screen.getByLabelText("Custo industrial (R$ total)")).toBeDisabled();
    expect(linha(industrial(), "R$ por unidade")).toContainElement(porUnidade);
  });

  it("trocar de opção não apaga o valor já digitado", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(within(industrial()).getByRole("radio", { name: "R$ total" }));
    const total = screen.getByLabelText("Custo industrial (R$ total)");
    fireEvent.change(total, { target: { value: "900" } });

    await user.click(within(industrial()).getByRole("radio", { name: "Não considerar" }));
    expect(total).toBeDisabled();
    expect(total).toHaveValue("900");

    await user.click(within(industrial()).getByRole("radio", { name: "R$ total" }));
    expect(total).toHaveValue("900");
  });

  it("custos externos: caixa, título e explicação como um bloco só", async () => {
    await abrir();

    const caixa = screen.getByRole("checkbox", {
      name: "Custos adicionais administrados externamente",
    });
    const bloco = caixa.closest(".selection-row");
    expect(bloco).not.toBeNull();
    // A explicação mora na mesma linha e é descrição da caixa, não texto solto.
    const ajuda = document.getElementById(caixa.getAttribute("aria-describedby") ?? "");
    expect(ajuda).not.toBeNull();
    expect(bloco).toContainElement(ajuda);
    expect(ajuda).toHaveTextContent(/ficam fora da conta/);
  });

  it("perfis tributários ganham alinhamento, não viram card", async () => {
    await abrir();

    const grupo = screen.getByRole("group", { name: "Perfis tributários aplicáveis" });
    const primeiro = within(grupo).getAllByRole("checkbox")[0] as HTMLElement;
    const bloco = primeiro.closest(".selection-row") as HTMLElement;
    expect(bloco).toHaveClass("selection-row--plain");
    expect(regra(".selection-row--plain")).toContain("border-color: transparent");
  });
});

describe("Barra de ações — gap, grupos e hierarquia", () => {
  it("as três ações do rascunho ficam em grupos, com gap e quebra de linha", async () => {
    const container = await abrir();

    const barra = botao("Salvar rascunho").closest(".form-actions") as HTMLElement;
    expect(barra).not.toBeNull();
    expect(barra).toHaveClass("form-actions--split");
    // Adicionar faixa de um lado; gravar e ativar do outro — juntas por
    // assunto, nunca coladas.
    const grupos = barra.querySelectorAll(".form-actions__group");
    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toContainElement(botao("+ Adicionar faixa"));
    expect(grupos[1]).toContainElement(botao("Ativar versão"));

    const estilo = regra(".form-actions");
    expect(estilo).toContain("gap: var(--sp-3)");
    expect(estilo).toContain("flex-wrap: wrap");
    expect(regra(".form-actions__group")).toContain("gap: var(--sp-2)");

    // Nenhuma ação sobrou na barra antiga, que não tem gap nenhum.
    expect(container.querySelectorAll(".line-actions")).toHaveLength(0);
  });

  it("as três ações têm pesos diferentes", async () => {
    await abrir();

    expect(botao("+ Adicionar faixa").className).toContain("btn--ghost");
    expect(botao("Salvar rascunho").className).toContain("btn--secondary");
    expect(botao("Ativar versão").className).toContain("btn--accent");
  });

  it("em tela estreita a barra empilha mantendo o gap, sem encolher a fonte", () => {
    const estreitas = blocosDeMedia("max-width: 480px");
    expect(estreitas.length).toBeGreaterThan(0);
    const texto = estreitas.join(" ");
    expect(texto).toContain(".form-actions__group");
    expect(texto).toContain("width: 100%");
    // Botão não cabe encolhendo a letra: ele ocupa a linha.
    expect(texto).toContain("flex: 1 1 auto");
    expect(texto).not.toContain("font-size");
    // A linha de escolha empilha em vez de espremer o campo até sumir.
    expect(texto).toContain(".selection-row");
    expect(texto).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});

describe("Salvar rascunho — o usuário fica sabendo", () => {
  it("sem alteração pendente não há o que gravar", async () => {
    await abrir();

    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(botao("Ativar versão")).toBeEnabled();
  });

  it("durante a gravação o botão diz Salvando… e não aceita um segundo clique", async () => {
    const user = userEvent.setup();
    let liberar: () => void = () => {};
    updatePricingPolicyVersion.mockImplementation(
      () => new Promise<void>((resolve) => (liberar = () => resolve())),
    );
    await abrir();

    fireEvent.change(margem(), { target: { value: "40" } });
    await user.click(botao("Salvar rascunho"));

    const emCurso = await screen.findByRole("button", { name: "Salvando…" });
    expect(emCurso).toBeDisabled();
    fireEvent.click(emCurso);
    expect(updatePricingPolicyVersion).toHaveBeenCalledTimes(1);

    liberar();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull());
  });

  it("sucesso diz Rascunho salvo., uma vez só", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(margem(), { target: { value: "40" } });
    comMargemGravada("40.0000");
    await user.click(botao("Salvar rascunho"));

    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    // Feedback curto e não modal: um aviso, não uma pilha deles.
    expect(screen.getAllByText("Rascunho salvo.")).toHaveLength(1);
    expect(screen.getByText("Rascunho salvo.")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("erro fica visível e não é lido como sucesso", async () => {
    const user = userEvent.setup();
    updatePricingPolicyVersion.mockRejectedValue(new Error("Margem alvo inválida"));
    await abrir();

    fireEvent.change(margem(), { target: { value: "40" } });
    await user.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Margem alvo inválida");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    // A alteração continua pendente, e o botão continua disponível.
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(botao("Salvar rascunho")).toBeEnabled();
  });

  it("gravar limpa a pendência do rascunho e deixa a identificação em paz", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Outro nome" } });
    fireEvent.change(margem(), { target: { value: "40" } });
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(2);

    comMargemGravada("40.0000");
    await user.click(botao("Salvar rascunho"));

    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    // Save parcial: o nome digitado continua pendente, e continua no campo.
    expect(screen.getByLabelText("Nome")).toHaveValue("Outro nome");
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(1);
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(botao("Salvar identificação")).toBeEnabled();
  });
});

describe("Ativar versão — decisão própria", () => {
  it("ativa sem depender de haver rascunho pendente, e confirma com outra frase", async () => {
    const user = userEvent.setup();
    const ativa = rascunho({ id: "tppv-2", status: "ACTIVE" });
    await abrir();

    getPricingPolicy.mockResolvedValue(
      policy({ activeVersion: ativa, draftVersion: null, versions: [ativa] }),
    );
    await user.click(botao("Ativar versão"));

    expect(activatePricingPolicyVersion).toHaveBeenCalledWith("tppv-2");
    expect(await screen.findByText("Versão ativada.")).toBeInTheDocument();
    // Ativar não é salvar: as duas frases não se confundem.
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
  });
});
