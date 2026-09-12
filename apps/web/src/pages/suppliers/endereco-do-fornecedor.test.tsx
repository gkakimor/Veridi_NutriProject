import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { SupplierDTO } from "@veridi/shared";

/**
 * SUPPLIER-ADDRESS-01 — o endereço do Fornecedor na tela.
 *
 * Mesmo bloco do Cliente, mesma regra: o endereço pertence a UM CEP, a
 * consulta só completa o que está vazio e trocar o CEP apaga o bloco inteiro.
 * A diferença é de domínio, não de tela — fornecedor sem endereço é cadastro
 * completo, então "não preenchi nada" tem de sair daqui como payload sem
 * endereço, nunca como sete campos vazios inventados.
 *
 * O ViaCEP é mockado: teste de tela não depende de internet.
 */

vi.mock("../../lib/suppliers-api", () => ({
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
}));
vi.mock("../../lib/cep-api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/cep-api")>(
    "../../lib/cep-api",
  );
  return { ...actual, lookupCep: vi.fn() };
});

import { createSupplier, updateSupplier } from "../../lib/suppliers-api";
import { lookupCep } from "../../lib/cep-api";
import type { CepLookupResult } from "../../lib/cep-api";
import { SupplierFormModal } from "./SupplierFormModal";

const CEP_A = "04816100";
const CEP_B = "13010000";

const ENDERECO_A = {
  street: "Rua Vicente José de Almeida",
  district: "Cupecê",
  city: "São Paulo",
  state: "SP",
};

const ENDERECO_B = {
  street: "Avenida Francisco Glicério",
  district: "Centro",
  city: "Campinas",
  state: "SP",
};

const achou = (address: typeof ENDERECO_A): CepLookupResult => ({
  status: "found",
  address,
});

function fornecedor(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "for-1",
    code: "FOR-000001",
    legalName: "PURIFARMA DISTRIBUIDORA LTDA",
    tradeName: "PURIFARMA",
    cnpj: null,
    email: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    district: null,
    zipCode: null,
    city: null,
    state: null,
    notes: null,
    active: true,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
    ...overrides,
  };
}

function abrir(mode: "create" | "edit", supplier: SupplierDTO | null) {
  render(
    <MemoryRouter>
      <SupplierFormModal
        mode={mode}
        supplier={supplier}
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    </MemoryRouter>,
  );
}

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const cep = () => campo("supplier-zip");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSupplier).mockResolvedValue(fornecedor());
  vi.mocked(updateSupplier).mockResolvedValue(fornecedor());
  vi.mocked(lookupCep).mockResolvedValue({ status: "not_found" });
});

describe("Endereço do Fornecedor — cadastro novo", () => {
  it("abre com o bloco vazio e diz que é opcional", () => {
    abrir("create", null);

    expect(screen.getByRole("heading", { name: "Endereço" })).toBeInTheDocument();
    expect(screen.getByText(/válido sem endereço/i)).toBeInTheDocument();
    for (const id of [
      "supplier-zip",
      "supplier-street",
      "supplier-number",
      "supplier-complement",
      "supplier-district",
      "supplier-city",
    ]) {
      expect(campo(id).value).toBe("");
    }
  });

  it("criar sem tocar no endereço não manda campo de endereço nenhum", async () => {
    const user = userEvent.setup();
    abrir("create", null);

    fireEvent.change(campo("supplier-legal-name"), { target: { value: "PURIFARMA" } });
    await user.click(screen.getByRole("button", { name: "Criar fornecedor" }));

    await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createSupplier).mock.calls[0]![0] as unknown as Record<
      string,
      unknown
    >;
    for (const chave of [
      "zipCode",
      "street",
      "number",
      "complement",
      "district",
      "city",
      "state",
    ]) {
      expect(payload).not.toHaveProperty(chave);
    }
  });

  it("criar com endereço completo manda os campos, CEP com máscara e UF escolhida", async () => {
    const user = userEvent.setup();
    abrir("create", null);

    fireEvent.change(campo("supplier-legal-name"), { target: { value: "PURIFARMA" } });
    fireEvent.change(cep(), { target: { value: CEP_A } });
    fireEvent.change(campo("supplier-street"), { target: { value: ENDERECO_A.street } });
    fireEvent.change(campo("supplier-number"), { target: { value: "120" } });
    fireEvent.change(campo("supplier-complement"), { target: { value: "Galpão 3" } });
    fireEvent.change(campo("supplier-district"), { target: { value: ENDERECO_A.district } });
    fireEvent.change(campo("supplier-city"), { target: { value: ENDERECO_A.city } });
    fireEvent.change(document.getElementById("supplier-state")!, { target: { value: "SP" } });

    await user.click(screen.getByRole("button", { name: "Criar fornecedor" }));

    await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSupplier).mock.calls[0]![0]).toMatchObject({
      zipCode: "04816-100",
      street: ENDERECO_A.street,
      number: "120",
      complement: "Galpão 3",
      district: ENDERECO_A.district,
      city: ENDERECO_A.city,
      state: "SP",
    });
  });

  it("endereço PARCIAL é aceito: só cidade e UF viajam", async () => {
    const user = userEvent.setup();
    abrir("create", null);

    fireEvent.change(campo("supplier-legal-name"), { target: { value: "PURIFARMA" } });
    fireEvent.change(campo("supplier-city"), { target: { value: "Campinas" } });
    fireEvent.change(document.getElementById("supplier-state")!, { target: { value: "SP" } });

    await user.click(screen.getByRole("button", { name: "Criar fornecedor" }));

    await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createSupplier).mock.calls[0]![0] as unknown as Record<
      string,
      unknown
    >;
    expect(payload["city"]).toBe("Campinas");
    expect(payload["state"]).toBe("SP");
    expect(payload).not.toHaveProperty("zipCode");
    expect(payload).not.toHaveProperty("street");
  });

  it("CEP incompleto trava o envio com a mesma mensagem do Cliente", async () => {
    const user = userEvent.setup();
    abrir("create", null);

    fireEvent.change(campo("supplier-legal-name"), { target: { value: "PURIFARMA" } });
    fireEvent.change(cep(), { target: { value: "1234" } });
    await user.click(screen.getByRole("button", { name: "Criar fornecedor" }));

    expect(await screen.findByText("CEP deve ter 8 dígitos.")).toBeInTheDocument();
    expect(createSupplier).not.toHaveBeenCalled();
  });
});

describe("Endereço do Fornecedor — consulta de CEP", () => {
  it("preenche o que está vazio e respeita o que foi digitado", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    abrir("create", null);

    fireEvent.change(campo("supplier-city"), { target: { value: "Cidade da pessoa" } });
    fireEvent.change(cep(), { target: { value: CEP_A } });
    fireEvent.blur(cep());

    await waitFor(() => expect(campo("supplier-street").value).toBe(ENDERECO_A.street));
    expect(campo("supplier-district").value).toBe(ENDERECO_A.district);
    // Sob o MESMO CEP, o que o operador digitou é dele.
    expect(campo("supplier-city").value).toBe("Cidade da pessoa");
  });

  it("trocar o CEP apaga o bloco inteiro, número e complemento inclusive", async () => {
    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_A));
    abrir("create", null);

    fireEvent.change(cep(), { target: { value: CEP_A } });
    fireEvent.blur(cep());
    await waitFor(() => expect(campo("supplier-street").value).toBe(ENDERECO_A.street));

    fireEvent.change(campo("supplier-number"), { target: { value: "120" } });
    fireEvent.change(campo("supplier-complement"), { target: { value: "Galpão 3" } });

    vi.mocked(lookupCep).mockResolvedValue(achou(ENDERECO_B));
    fireEvent.change(cep(), { target: { value: CEP_B } });

    // Antes de qualquer consulta: o endereço anterior já não está na tela.
    expect(campo("supplier-street").value).toBe("");
    expect(campo("supplier-number").value).toBe("");
    expect(campo("supplier-complement").value).toBe("");
    expect(campo("supplier-city").value).toBe("");

    fireEvent.blur(cep());
    await waitFor(() => expect(campo("supplier-city").value).toBe(ENDERECO_B.city));
  });

  it("CEP fora do ar não impede o cadastro — o recado manda preencher à mão", async () => {
    vi.mocked(lookupCep).mockResolvedValue({ status: "unavailable" });
    abrir("create", null);

    fireEvent.change(cep(), { target: { value: CEP_A } });
    fireEvent.blur(cep());

    expect(
      await screen.findByText(/preencher o endereço manualmente/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("CEP deve ter 8 dígitos.")).toBeNull();
  });
});

describe("Endereço do Fornecedor — edição", () => {
  it("carrega o endereço gravado com o CEP mascarado", () => {
    abrir(
      "edit",
      fornecedor({
        zipCode: CEP_A,
        street: ENDERECO_A.street,
        number: "120",
        complement: "Galpão 3",
        district: ENDERECO_A.district,
        city: ENDERECO_A.city,
        state: "SP",
      }),
    );

    expect(cep().value).toBe("04816-100");
    expect(campo("supplier-street").value).toBe(ENDERECO_A.street);
    expect(campo("supplier-number").value).toBe("120");
    expect((document.getElementById("supplier-state") as HTMLSelectElement).value).toBe("SP");
  });

  it("apagar um campo opcional envia vazio — é assim que se limpa o gravado", async () => {
    const user = userEvent.setup();
    abrir(
      "edit",
      fornecedor({
        zipCode: CEP_A,
        street: ENDERECO_A.street,
        complement: "Galpão 3",
        city: ENDERECO_A.city,
        state: "SP",
      }),
    );

    fireEvent.change(campo("supplier-complement"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(updateSupplier).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateSupplier).mock.calls[0]![1]).toMatchObject({
      complement: "",
      city: ENDERECO_A.city,
    });
  });
});
