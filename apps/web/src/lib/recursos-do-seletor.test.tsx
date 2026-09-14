import { StrictMode } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { IndustrialResourceDTO, IndustrialResourceListResponse, IndustrialResourceType } from "@veridi/shared";

/**
 * A foundation dos seletores de recurso industrial (SELECTOR-CUTOFF-WAVE-02).
 *
 * O que as telas não conseguem provar sozinhas é a disciplina de pedidos:
 * primeira página uma vez e só quando o campo existe, um pedido por tipo do
 * recorte, e o id escolhido que veio de fora perguntado UMA vez — depois de a
 * página responder, porque antes disso ele podia estar nela.
 */

vi.mock("./industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(),
  getIndustrialResource: vi.fn(),
}));

import { getIndustrialResource, listIndustrialResources } from "./industrial-resources-api";
import { PAGINA_DE_RECURSOS, opcaoDeRecurso, useRecursosDoSeletor } from "./recursos-do-seletor";
import type { RecorteDeRecursos } from "./recursos-do-seletor";

function recurso(numero: number, type: IndustrialResourceType, extra: Partial<IndustrialResourceDTO> = {}) {
  return {
    id: `rin-${numero}`,
    code: `RIN-${String(numero).padStart(6, "0")}`,
    name: `Recurso ${numero}`,
    type,
    active: true,
    ...extra,
  } as IndustrialResourceDTO;
}

const PRIMEIRO = recurso(1, "LABOR");
const ALVO = recurso(901, "EQUIPMENT", { name: "Encapsuladora Zeta Alvo" });
const CAPACIDADE: RecorteDeRecursos = { tipos: ["LABOR", "EQUIPMENT"], somenteAtivos: true };
const TODOS: RecorteDeRecursos = { somenteAtivos: false };

type Props = { carregar: boolean; escolhidos: string[] };

function montar(recorte: RecorteDeRecursos, inicial: Props, wrapper?: (p: { children: ReactNode }) => ReactNode) {
  return renderHook((props: Props) => useRecursosDoSeletor(recorte, props), {
    initialProps: inicial,
    ...(wrapper ? { wrapper } : {}),
  });
}

const pagina = (resources: IndustrialResourceDTO[]): IndustrialResourceListResponse => ({
  resources,
  page: 1,
  pageSize: PAGINA_DE_RECURSOS,
  total: resources.length,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listIndustrialResources).mockImplementation(async (params) => {
    if (params.search) return pagina(params.type === "EQUIPMENT" ? [ALVO] : []);
    return pagina(params.type === "LABOR" || params.type === undefined ? [PRIMEIRO] : []);
  });
  vi.mocked(getIndustrialResource).mockImplementation(async (id) => {
    if (id === ALVO.id) return { ...ALVO, rates: [] };
    throw new Error("Recurso não encontrado");
  });
});

describe("primeira página", () => {
  it("nada é pedido antes de o campo existir; depois, um pedido por tipo, uma vez", async () => {
    const { rerender, result } = montar(CAPACIDADE, { carregar: false, escolhidos: [] });
    expect(listIndustrialResources).not.toHaveBeenCalled();

    rerender({ carregar: true, escolhidos: [] });
    await waitFor(() => expect(result.current.respondeu).toBe(true));
    rerender({ carregar: true, escolhidos: [PRIMEIRO.id] });
    rerender({ carregar: false, escolhidos: [] });
    rerender({ carregar: true, escolhidos: [] });

    expect(vi.mocked(listIndustrialResources).mock.calls.map(([params]) => params)).toEqual([
      { active: true, pageSize: PAGINA_DE_RECURSOS, type: "LABOR" },
      { active: true, pageSize: PAGINA_DE_RECURSOS, type: "EQUIPMENT" },
    ]);
    expect(result.current.catalogo).toEqual([PRIMEIRO]);
  });

  it("em StrictMode a montagem dobrada não dobra o pedido", async () => {
    const { result } = montar(CAPACIDADE, { carregar: true, escolhidos: [] }, ({ children }) => (
      <StrictMode>{children}</StrictMode>
    ));
    await waitFor(() => expect(result.current.respondeu).toBe(true));
    expect(listIndustrialResources).toHaveBeenCalledTimes(2);
  });

  it("recorte sem tipos: um pedido só, sem filtro de tipo nem de ativo", async () => {
    const { result } = montar(TODOS, { carregar: true, escolhidos: [] });
    await waitFor(() => expect(result.current.respondeu).toBe(true));
    expect(vi.mocked(listIndustrialResources).mock.calls.map(([params]) => params)).toEqual([
      { pageSize: PAGINA_DE_RECURSOS },
    ]);
  });
});

describe("escolhido que veio de fora", () => {
  it("é perguntado pelo id uma vez só, e só depois de a primeira página responder", async () => {
    const pendentes: (() => void)[] = [];
    vi.mocked(listIndustrialResources).mockImplementation(
      (params) =>
        new Promise((resolve) => {
          pendentes.push(() => resolve(pagina(params.type === "LABOR" ? [PRIMEIRO] : [])));
        }),
    );
    const { rerender, result } = montar(CAPACIDADE, { carregar: true, escolhidos: [ALVO.id] });
    await waitFor(() => expect(pendentes).toHaveLength(2));
    expect(getIndustrialResource).not.toHaveBeenCalled();

    await act(async () => {
      for (const responder of pendentes) responder();
    });
    await waitFor(() => expect(result.current.recurso(ALVO.id)?.name).toBe(ALVO.name));
    rerender({ carregar: true, escolhidos: [ALVO.id, ""] });
    rerender({ carregar: true, escolhidos: [PRIMEIRO.id, ALVO.id] });

    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(getIndustrialResource).toHaveBeenCalledWith(ALVO.id);
    // Nomear o escolhido não é oferecer: o catálogo continua sendo o do recorte.
    expect(result.current.catalogo.map((item) => item.id)).toEqual([PRIMEIRO.id]);
  });

  it("id que veio na primeira página não gera pergunta", async () => {
    const { result } = montar(CAPACIDADE, { carregar: true, escolhidos: [PRIMEIRO.id] });
    await waitFor(() => expect(result.current.respondeu).toBe(true));
    await act(async () => undefined);
    expect(getIndustrialResource).not.toHaveBeenCalled();
    expect(result.current.recurso(PRIMEIRO.id)).toEqual(PRIMEIRO);
  });

  it("id que não existe mais: uma pergunta, sem laço — nem quando a lista de escolhidos muda", async () => {
    const { rerender, result } = montar(CAPACIDADE, { carregar: true, escolhidos: ["rin-sumiu"] });
    await waitFor(() => expect(getIndustrialResource).toHaveBeenCalledTimes(1));
    rerender({ carregar: true, escolhidos: ["rin-sumiu"] });
    rerender({ carregar: true, escolhidos: ["rin-sumiu", PRIMEIRO.id] });
    await act(async () => undefined);
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(result.current.recurso("rin-sumiu")).toBeUndefined();
  });

  it("pergunta em andamento não se repete quando a tela muda de novo", async () => {
    let responder: () => void = () => undefined;
    vi.mocked(getIndustrialResource).mockImplementation(
      () =>
        new Promise((resolve) => {
          responder = () => resolve({ ...ALVO, rates: [] });
        }),
    );
    const { rerender, result } = montar(CAPACIDADE, { carregar: true, escolhidos: [ALVO.id] });
    await waitFor(() => expect(getIndustrialResource).toHaveBeenCalledTimes(1));

    rerender({ carregar: true, escolhidos: [ALVO.id, PRIMEIRO.id] });
    await act(async () => {
      await result.current.buscar("Zeta");
    });
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);

    await act(async () => responder());
    expect(result.current.recurso(ALVO.id)?.name).toBe(ALVO.name);
  });
});

describe("busca", () => {
  it("pergunta por tipo com o termo, e o achado entra no catálogo", async () => {
    const { result } = montar(CAPACIDADE, { carregar: true, escolhidos: [] });
    await waitFor(() => expect(result.current.respondeu).toBe(true));

    let achados: IndustrialResourceDTO[] = [];
    await act(async () => {
      achados = await result.current.buscar("Zeta");
    });

    expect(achados).toEqual([ALVO]);
    expect(listIndustrialResources).toHaveBeenCalledWith({
      active: true,
      search: "Zeta",
      pageSize: PAGINA_DE_RECURSOS,
      type: "LABOR",
    });
    expect(listIndustrialResources).toHaveBeenCalledWith({
      active: true,
      search: "Zeta",
      pageSize: PAGINA_DE_RECURSOS,
      type: "EQUIPMENT",
    });
    expect(result.current.catalogo.map((item) => item.id)).toEqual([PRIMEIRO.id, ALVO.id]);
    expect(result.current.recurso(ALVO.id)).toEqual(ALVO);
  });
});

describe("opção", () => {
  it("tipo quando o campo mistura tipos, e inativo sempre dito", () => {
    expect(opcaoDeRecurso(ALVO, { comTipo: true })).toEqual({
      id: ALVO.id,
      code: ALVO.code,
      name: ALVO.name,
      hint: "Equipamento",
    });
    expect(opcaoDeRecurso({ ...ALVO, active: false }, { comTipo: true }).hint).toBe("Equipamento, inativo");
    expect(opcaoDeRecurso({ ...ALVO, active: false }, { comTipo: false }).hint).toBe("inativo");
    expect(opcaoDeRecurso(ALVO, { comTipo: false })).not.toHaveProperty("hint");
  });
});
