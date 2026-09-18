import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * Espaço entre blocos de cadastro — §123 (CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Regra global: todo cadastro tem o MESMO respiro vertical entre uma seção e a
 * próxima, e ele mora num lugar só — `.form-section + .form-section` com o
 * token `--block-gap` (o `--sp-5`, o mesmo `gap` que a coluna do modal e o corpo
 * do documento já usavam). jsdom não faz layout, e medir pixel aqui seria
 * frágil; o que se prova é o CONTRATO:
 *
 * 1. o CSS declara a regra, o token e a exceção dos containers com `gap`, e
 *    nenhuma outra regra dá margem à seção;
 * 2. nenhuma tela põe margem à mão numa seção (`style` inline);
 * 3. nos cadastros, os blocos são seções CONTÍGUAS — nada entre duas delas —,
 *    que é o que faz a regra central alcançar cada par.
 */

vi.mock("../lib/customers-api", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  listCustomers: vi.fn(),
  getCustomerCnpjRegistrationHistory: vi.fn(),
}));
vi.mock("../lib/suppliers-api", () => ({ createSupplier: vi.fn(), updateSupplier: vi.fn() }));
vi.mock("../lib/items-api", () => ({ createItem: vi.fn(), updateItem: vi.fn() }));
vi.mock("../lib/products-api", () => ({ createProduct: vi.fn(), updateProduct: vi.fn() }));
vi.mock("../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../lib/cep-api", async (original) => ({ ...(await original<object>()), lookupCep: vi.fn() }));
vi.mock("../app/AuthProvider", () => ({ useAuth: vi.fn(), useOptionalAuth: () => null }));
// Seções com rede própria: fora daqui, cada uma tem o seu teste.
vi.mock("./supplier-items/FornecedoresDoItem", () => ({ FornecedoresDoItemSection: () => null }));
vi.mock("../components/ItemCostReferenceSection", () => ({ ItemCostReferenceSection: () => null }));
vi.mock("../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("./products/ProductIndustrialCostSummary", () => ({ ProductIndustrialCostSummary: () => null }));
vi.mock("./products/ProductDefaultRouteSection", () => ({ ProductDefaultRouteSection: () => null }));

import { listCustomers } from "../lib/customers-api";
import { listUnits } from "../lib/units-api";
import { CustomerFormModal } from "./customers/CustomerFormModal";
import { SupplierFormModal } from "./suppliers/SupplierFormModal";
import { ItemFormModal } from "./items/ItemFormModal";
import { ProductFormModal } from "./products/ProductFormModal";

const RAIZ = process.cwd();
const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\r\n/g, "\n");
const folha = (nome: string) => semComentarios(readFileSync(join(RAIZ, "src", "styles", nome), "utf8"));

/** Toda regra da folha — as de dentro de `@media` também —, como [seletores, declarações]. */
function regras(css: string): [string[], string][] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, seletores = "", corpo = ""]) => [
    seletores.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    corpo.trim(),
  ]);
}

function declaracoesDe(css: string, seletor: string): string {
  return regras(css)
    .filter(([seletores]) => seletores.includes(seletor))
    .map(([, corpo]) => corpo)
    .join("\n");
}

/** Os arquivos `.tsx` de produção da Web. */
function telas(pasta = join(RAIZ, "src")): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) return telas(caminho);
    return nome.endsWith(".tsx") && !nome.includes(".test.") ? [caminho] : [];
  });
}

/**
 * Entre a primeira e a última seção de cada container, só seções: um elemento
 * no meio faria a regra central (`+`) pular aquele par.
 */
function blocosNaoContiguos(raiz: ParentNode): string[] {
  const problemas: string[] = [];
  const pais = new Set(
    [...raiz.querySelectorAll(".form-section")]
      .map((secao) => secao.parentElement)
      .filter((pai): pai is HTMLElement => pai !== null),
  );
  for (const pai of pais) {
    const filhos = [...pai.children];
    const indices = filhos.flatMap((filho, i) => (filho.classList.contains("form-section") ? [i] : []));
    for (let i = indices[0] ?? 0; i <= (indices.at(-1) ?? -1); i += 1) {
      const filho = filhos[i]!;
      if (!filho.classList.contains("form-section")) {
        problemas.push(`<${filho.tagName.toLowerCase()} class="${filho.className}"> entre dois blocos`);
      }
    }
  }
  return problemas;
}

/** O maior grupo de seções irmãs — a prova de que a regra `+` foi de fato exercida. */
function maiorGrupoDeBlocos(raiz: ParentNode): number {
  const porPai = new Map<Element, number>();
  for (const secao of raiz.querySelectorAll(".form-section")) {
    if (secao.parentElement) porPai.set(secao.parentElement, (porPai.get(secao.parentElement) ?? 0) + 1);
  }
  return Math.max(0, ...porPai.values());
}

function margemInline(raiz: ParentNode): string[] {
  return [...raiz.querySelectorAll(".form-section")]
    .map((secao) => secao.getAttribute("style") ?? "")
    .filter((estilo) => /margin/i.test(estilo));
}

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function cliente(): CustomerDTO {
  return {
    id: "cli-1",
    code: "CLI-000042",
    legalName: "VERIDI TESTE LTDA",
    tradeName: null,
    cnpj: "11444777000161",
    email: null,
    phone: null,
    taxProfile: "NOT_INFORMED",
    cnpjRegistration: null,
    street: null,
    number: null,
    complement: null,
    district: null,
    zipCode: null,
    city: null,
    state: null,
    notes: null,
    businessLotSuffix: null,
    defaultPaymentInstrument: null,
    defaultPaymentMethod: null,
    defaultDownPaymentPercent: null,
    defaultInstallmentCount: null,
    defaultInstallmentIntervalDays: null,
    defaultMonthlyInterestPercent: null,
    active: true,
    blocked: false,
    status: "ACTIVE",
    block: null,
    createdAt: "2026-08-31T17:32:00.000Z",
    createdByName: "João Silva",
    updatedAt: "2026-08-31T19:14:00.000Z",
    updatedByName: "Maria Souza",
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 });
});

describe("o contrato no CSS", () => {
  it("o respiro entre blocos é um token com nome, e é o --sp-5 — não um valor inventado", () => {
    expect(folha("tokens.css")).toMatch(/--block-gap:\s*var\(--sp-5\);/);
  });

  it("seção seguida de seção ganha o --block-gap, numa regra só", () => {
    const css = folha("components.css");
    expect(declaracoesDe(css, ".form-section + .form-section")).toMatch(/margin-top:\s*var\(--block-gap\)/);
    // A seção em si não tem margem: o espaço é ENTRE blocos, não em volta de cada um.
    expect(declaracoesDe(css, ".form-section")).not.toMatch(/margin/);
  });

  it("onde o container já separa por gap, o gap é o mesmo token e a margem sai", () => {
    const css = folha("components.css");
    for (const container of [".modal-fullscreen__form-wrap", ".doc-body"]) {
      expect(declaracoesDe(css, container), container).toMatch(/gap:\s*var\(--block-gap\)/);
      expect(declaracoesDe(css, `${container} > .form-section + .form-section`), container).toMatch(
        /margin-top:\s*0/,
      );
    }
  });

  it("nenhuma outra regra dá margem à seção de cadastro", () => {
    const permitidas = new Set([
      ".form-section + .form-section",
      ".modal-fullscreen__form-wrap > .form-section + .form-section",
      ".doc-body > .form-section + .form-section",
    ]);
    const concorrentes = regras(folha("components.css")).flatMap(([seletores, corpo]) =>
      seletores.filter(
        (seletor) => /\.form-section$/.test(seletor) && !permitidas.has(seletor) && /margin/.test(corpo),
      ),
    );
    expect(concorrentes).toEqual([]);
  });

  it("nenhuma tela põe margem à mão numa seção", () => {
    const manuais = telas().filter((arquivo) =>
      /<FormSection[^>]*\bstyle=|className="form-section[^"]*"[^>]*\bstyle=/.test(readFileSync(arquivo, "utf8")),
    );
    expect(manuais.map((arquivo) => relative(RAIZ, arquivo))).toEqual([]);
  });
});

describe("os cadastros montam os blocos contíguos, e a regra central alcança cada par", () => {
  it.each([
    ["Cliente — novo", () => <CustomerFormModal mode="create" customer={null} onClose={() => {}} onSaved={() => {}} />],
    ["Cliente — edição", () => <CustomerFormModal mode="edit" customer={cliente()} onClose={() => {}} onSaved={() => {}} />],
    [
      "Cliente — consulta",
      () => <CustomerFormModal mode="edit" customer={cliente()} readOnly onClose={() => {}} onSaved={() => {}} />,
    ],
    ["Fornecedor — novo", () => <SupplierFormModal mode="create" supplier={null} onClose={() => {}} onSaved={() => {}} />],
    [
      "Item — novo",
      () => <ItemFormModal mode="create" item={null} units={UNIDADES} onClose={() => {}} onSaved={() => {}} />,
    ],
    ["Produto — novo", () => <ProductFormModal mode="create" product={null} onClose={() => {}} onSaved={() => {}} />],
  ])("%s", async (cadastro, montar) => {
    render(<MemoryRouter>{montar()}</MemoryRouter>);
    await waitFor(() => expect(document.querySelectorAll(".form-section").length).toBeGreaterThan(1));
    await screen.findAllByRole("heading");

    expect(maiorGrupoDeBlocos(document), cadastro).toBeGreaterThanOrEqual(3);
    expect(blocosNaoContiguos(document), cadastro).toEqual([]);
    expect(margemInline(document), cadastro).toEqual([]);
  });

  /*
   * As telas de Modelo (e as de detalhe no mesmo molde) montam os blocos no
   * corpo do documento, cujo `gap` é o mesmo `--block-gap` — o contrato do CSS
   * acima. Aqui fica a outra metade: elas continuam usando esse corpo e a seção
   * compartilhada.
   */
  it.each([
    "cost-templates/CostTemplateDetailPage.tsx",
    "cost-templates/PricingPolicyDetailPage.tsx",
    "formulation-templates/FormulationTemplateDetailPage.tsx",
    "planning/ProductionProfileDetailPage.tsx",
    "industrial-resources/IndustrialResourceDetailPage.tsx",
  ])("%s monta os blocos com FormSection dentro do .doc-body", (arquivo) => {
    const fonte = readFileSync(join(RAIZ, "src", "pages", arquivo), "utf8");
    expect(fonte, arquivo).toContain('className="doc-body"');
    expect((fonte.match(/<FormSection\b/g) ?? []).length, arquivo).toBeGreaterThanOrEqual(2);
  });
});
