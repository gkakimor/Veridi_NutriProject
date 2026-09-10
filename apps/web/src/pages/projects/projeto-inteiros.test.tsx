import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";

/**
 * Os inteiros do Projeto — PROJECT-INT-FIELDS-01.
 *
 * "Doses por embalagem" e "Vida útil (meses)" saíam do formulário por
 * `Number(texto)`: `abc` virava `NaN`, o JSON escreve `NaN` como `null`, e
 * salvar apagava o valor gravado — o erro de digitação virava a decisão de
 * limpar o campo. É o defeito que QUOTE-INT-FIELDS-01 fechou no Orçamento, e a
 * mesma leitura estrita resolve: vazio é "não informado", inteiro é inteiro, e
 * o resto fica na tela como foi digitado, com o erro ao lado e o salvar preso.
 */

vi.mock("../../lib/projects-api", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  getProjectVocabulary: vi.fn(() => Promise.resolve({ concepts: [], channels: [] })),
}));
vi.mock("../../lib/customers-api", () => ({
  listCustomers: vi.fn(() =>
    Promise.resolve({
      customers: [
        { id: "cli-1", code: "CLI-000001", legalName: "Cliente Doses LTDA", tradeName: null, cnpj: null },
      ],
    }),
  ),
}));

import { createProject, updateProject } from "../../lib/projects-api";
import { ProjectFormModal } from "./ProjectFormModal";

/** Só o que o formulário lê do projeto: doses 60 e vida útil 24 gravadas. */
const GRAVADO = {
  id: "prj-1",
  code: "PROJ-000001",
  customerId: "cli-1",
  name: "Projeto Doses",
  concept: null,
  channel: null,
  externalCode: null,
  entryDate: "2026-09-01T12:00:00.000Z",
  notes: null,
  dosageForm: null,
  presentationType: null,
  doseAmount: null,
  dosesPerPackage: 60,
  targetAgeGroup: null,
  minimumBatchQuantity: null,
  shelfLifeMonths: 24,
} as ProjectDTO;

function abrir(project: ProjectDTO | null) {
  render(
    <StrictMode>
      <MemoryRouter>
        <ProjectFormModal project={project} onClose={() => {}} onSaved={() => {}} />
      </MemoryRouter>
    </StrictMode>,
  );
}

function campo(rotulo: string): HTMLInputElement {
  return screen.getByLabelText(rotulo) as HTMLInputElement;
}

function digitar(rotulo: string, valor: string) {
  fireEvent.change(campo(rotulo), { target: { value: valor } });
}

function botao(nome: string): HTMLButtonElement {
  return screen.getByRole("button", { name: nome }) as HTMLButtonElement;
}

/** O corpo como o `fetch` o mandaria: `NaN` vira `null` no JSON. */
function noFio(payload: unknown) {
  return JSON.parse(JSON.stringify(payload));
}

/** Um projeto novo com cliente e nome — o que libera "Criar projeto". */
async function preencherNovo() {
  abrir(null);
  const cliente = document.getElementById("project-customer") as HTMLInputElement;
  fireEvent.focus(cliente);
  fireEvent.mouseDown(await screen.findByRole("option", { name: /Cliente Doses LTDA/ }));
  fireEvent.change(screen.getByLabelText(/Nome do projeto/), { target: { value: "Projeto Novo" } });
}

const CAMPOS = [
  {
    chave: "dosesPerPackage",
    rotulo: "Doses por embalagem",
    erro: "project-doses-error",
    mensagem: "Doses por embalagem: informe um número inteiro maior que zero.",
  },
  {
    chave: "shelfLifeMonths",
    rotulo: "Vida útil (meses)",
    erro: "project-shelf-life-error",
    mensagem: "Vida útil (meses): informe um número inteiro maior que zero.",
  },
] as const;

/** Não é inteiro simples, ou é inteiro que a API recusa (zero e negativo). */
const INVALIDOS = ["abc", "30abc", "60abc", "60,5", "60.5", "1e2", "-1", "0"] as const;

const casos = CAMPOS.flatMap((c) => INVALIDOS.map((texto) => [c.rotulo, texto, c] as const));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createProject).mockResolvedValue(GRAVADO);
  vi.mocked(updateProject).mockResolvedValue(GRAVADO);
});

describe("PROJECT-INT-FIELDS-01 — inteiro inválido fica inválido na tela", () => {
  it.each(casos)("%s = %j: erro no campo, texto mantido, salvar preso, nada enviado", (_rotulo, texto, c) => {
    abrir(GRAVADO);

    digitar(c.rotulo, texto);

    // O texto fica: a pessoa vê o que escreveu, junto do erro.
    expect(campo(c.rotulo).value).toBe(texto);
    expect(document.getElementById(c.erro)?.textContent).toBe(c.mensagem);
    expect(campo(c.rotulo)).toHaveAttribute("aria-invalid", "true");
    expect(campo(c.rotulo)).toHaveAttribute("aria-describedby", c.erro);
    expect(botao("Salvar alterações").disabled).toBe(true);

    fireEvent.click(botao("Salvar alterações"));
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("abc sobre doses 60 nunca chega ao servidor como null", () => {
    abrir(GRAVADO);

    digitar("Doses por embalagem", "abc");
    fireEvent.click(botao("Salvar alterações"));

    // No código antigo, este é o pedido que apagava as doses gravadas.
    const enviados = vi.mocked(updateProject).mock.calls.map(([, payload]) => noFio(payload));
    expect(enviados).toEqual([]);
  });

  it("30abc sobre vida útil 24 nunca chega ao servidor como null", () => {
    abrir(GRAVADO);

    digitar("Vida útil (meses)", "30abc");
    fireEvent.click(botao("Salvar alterações"));

    const enviados = vi.mocked(updateProject).mock.calls.map(([, payload]) => noFio(payload));
    expect(enviados).toEqual([]);
  });
});

describe("PROJECT-INT-FIELDS-01 — edição: corrigir, limpar e escrever do mesmo jeito", () => {
  it("gravado 60 e 24, digitado inválido: nada vai; corrigido para 90 e 36, o pedido leva os inteiros", async () => {
    abrir(GRAVADO);

    digitar("Doses por embalagem", "abc");
    digitar("Vida útil (meses)", "24,5");
    fireEvent.click(botao("Salvar alterações"));
    expect(updateProject).not.toHaveBeenCalled();

    digitar("Doses por embalagem", "90");
    digitar("Vida útil (meses)", "36");
    expect(document.getElementById("project-doses-error")).toBeNull();
    expect(document.getElementById("project-shelf-life-error")).toBeNull();
    expect(campo("Doses por embalagem")).not.toHaveAttribute("aria-invalid");
    expect(botao("Salvar alterações").disabled).toBe(false);

    fireEvent.click(botao("Salvar alterações"));
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    const [id, payload] = vi.mocked(updateProject).mock.calls[0] ?? [];
    expect(id).toBe("prj-1");
    expect(payload).toEqual(expect.objectContaining({ dosesPerPackage: 90, shelfLifeMonths: 36 }));
    // Nenhum NaN no caminho: o JSON devolve exatamente o que saiu.
    expect(noFio(payload)).toEqual(payload);
  });

  it.each(CAMPOS)("apagar $rotulo é limpar de propósito: salva null", async (c) => {
    abrir(GRAVADO);

    digitar(c.rotulo, "   ");

    expect(document.getElementById(c.erro)).toBeNull();
    fireEvent.click(botao("Salvar alterações"));
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    expect(updateProject).toHaveBeenCalledWith("prj-1", expect.objectContaining({ [c.chave]: null }));
  });

  it.each(
    CAMPOS.flatMap((c) =>
      [
        [" 90 ", 90],
        ["090", 90],
      ].map(([texto, valor]) => [c.rotulo, texto, valor, c] as const),
    ),
  )("%s: %j é o inteiro %i", async (_rotulo, texto, valor, c) => {
    abrir(GRAVADO);

    digitar(c.rotulo, texto as string);

    expect(document.getElementById(c.erro)).toBeNull();
    fireEvent.click(botao("Salvar alterações"));
    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    expect(updateProject).toHaveBeenCalledWith("prj-1", expect.objectContaining({ [c.chave]: valor }));
  });
});

describe("PROJECT-INT-FIELDS-01 — criação", () => {
  it("doses inválidas não criam; corrigidas, createProject é chamado uma vez com os inteiros", async () => {
    await preencherNovo();

    digitar("Doses por embalagem", "60abc");
    digitar("Vida útil (meses)", "24");
    expect(botao("Criar projeto").disabled).toBe(true);
    fireEvent.click(botao("Criar projeto"));
    expect(createProject).not.toHaveBeenCalled();

    digitar("Doses por embalagem", "60");
    fireEvent.click(botao("Criar projeto"));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cli-1", dosesPerPackage: 60, shelfLifeMonths: 24 }),
    );
  });

  it("os dois vazios são permitidos: o projeto nasce com os dois como null", async () => {
    await preencherNovo();

    fireEvent.click(botao("Criar projeto"));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ dosesPerPackage: null, shelfLifeMonths: null }),
    );
  });
});
