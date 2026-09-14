import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ApiValidationError } from "./api-errors";
import { useFilteredPage, useListQuery } from "./list-query";

/**
 * `useListQuery` — a consulta das listagens paginadas (LISTS-LOADING-STALE-DATA-01).
 *
 * O que as listas não podem mais fazer, e o que continua igual:
 *
 *   - recorte novo não mostra a resposta do anterior enquanto carrega;
 *   - só a consulta ATUAL vira estado, em qualquer ordem de chegada;
 *   - falha não vem junto de linhas de outro recorte, nem de outra página;
 *   - recorte recusado (`enabled: false`) não consulta nem finge carregar;
 *   - trocar de PÁGINA mantém a página aberta até a próxima chegar;
 *   - recarregar consulta de novo o mesmo recorte e a mesma página.
 *
 * As telas são provadas em `pages/listas-consulta-em-curso.test.tsx`.
 */

interface Params {
  status?: string;
  page: number;
  pageSize: number;
}

interface Resposta {
  rotulo: string;
}

let pendentes: { params: Params; responder: (r: Resposta) => void; recusar: (e: unknown) => void }[];

function fetcher(params: Params): Promise<Resposta> {
  return new Promise<Resposta>((responder, recusar) => {
    pendentes.push({ params, responder, recusar });
  });
}

async function responder(indice: number, rotulo: string) {
  await act(async () => pendentes[indice]!.responder({ rotulo }));
}

async function recusar(indice: number, erro: unknown) {
  await act(async () => pendentes[indice]!.recusar(erro));
}

function montar(inicial: { params: Params; enabled?: boolean }) {
  return renderHook(
    ({ params, enabled }: { params: Params; enabled?: boolean }) =>
      useListQuery(fetcher, params, { enabled: enabled ?? true, fallbackError: "Falha genérica" }),
    { initialProps: inicial },
  );
}

beforeEach(() => {
  pendentes = [];
});

describe("primeira carga", () => {
  it("carrega sem resposta nem erro — nunca um vazio antes de saber", async () => {
    const { result } = montar({ params: { page: 1, pageSize: 20 } });
    expect(pendentes).toHaveLength(1);
    expect(result.current).toMatchObject({ data: null, loading: true, error: null });

    await responder(0, "A");
    expect(result.current).toMatchObject({ data: { rotulo: "A" }, loading: false, error: null });
  });
});

describe("recorte novo", () => {
  it("a resposta do recorte anterior some enquanto o novo carrega, numa consulta só", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A");

    rerender({ params: { status: "B", page: 1, pageSize: 20 } });
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.params).toEqual({ status: "B", page: 1, pageSize: 20 });
    expect(result.current).toMatchObject({ data: null, loading: true, error: null });

    await responder(1, "B");
    expect(result.current).toMatchObject({ data: { rotulo: "B" }, loading: false });
    expect(pendentes).toHaveLength(2);
  });

  it("o mesmo recorte vindo num objeto novo não consulta de novo", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A");
    rerender({ params: { status: "A", page: 1, pageSize: 20 } });
    expect(pendentes).toHaveLength(1);
    expect(result.current).toMatchObject({ data: { rotulo: "A" }, loading: false });
  });
});

describe("mesma consulta, outra página", () => {
  it("a página aberta fica à vista até a próxima chegar", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A1");

    rerender({ params: { status: "A", page: 2, pageSize: 20 } });
    expect(pendentes).toHaveLength(2);
    expect(result.current).toMatchObject({ data: { rotulo: "A1" }, loading: true, error: null });

    await responder(1, "A2");
    expect(result.current).toMatchObject({ data: { rotulo: "A2" }, loading: false });
  });

  it("a página que falha não deixa a anterior à vista junto do erro", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A1");

    rerender({ params: { status: "A", page: 2, pageSize: 20 } });
    await recusar(1, new Error("Serviço indisponível."));
    expect(result.current).toMatchObject({ data: null, loading: false, error: "Serviço indisponível." });
  });
});

describe("falha", () => {
  it("erro sem linhas do recorte anterior; a consulta seguinte tira o erro enquanto carrega", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A");

    rerender({ params: { status: "B", page: 1, pageSize: 20 } });
    await recusar(1, new Error("Serviço indisponível."));
    expect(result.current).toMatchObject({ data: null, loading: false, error: "Serviço indisponível." });

    rerender({ params: { status: "C", page: 1, pageSize: 20 } });
    expect(result.current).toMatchObject({ data: null, loading: true, error: null });
    await responder(2, "C");
    expect(result.current).toMatchObject({ data: { rotulo: "C" }, loading: false, error: null });
  });

  it("falha sem mensagem própria usa a frase da tela", async () => {
    const { result } = montar({ params: { page: 1, pageSize: 20 } });
    await recusar(0, "sem Error");
    expect(result.current.error).toBe("Falha genérica");
  });

  it("recusa de validação diz as issues, não \"Erro de validação\" (LISTS-LOADING-STALE-DATA-02)", async () => {
    const { result } = montar({ params: { status: "X", page: 1, pageSize: 20 } });
    await recusar(0, new ApiValidationError([{ path: "status", message: "Situação inválida." }]));
    expect(result.current).toMatchObject({ data: null, loading: false, error: "Situação inválida." });
  });
});

describe("resposta fora de ordem", () => {
  it("A → B → C respondendo C, B, A: só C vira estado", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    rerender({ params: { status: "B", page: 1, pageSize: 20 } });
    rerender({ params: { status: "C", page: 1, pageSize: 20 } });
    expect(pendentes.map((pendente) => pendente.params.status)).toEqual(["A", "B", "C"]);

    await responder(2, "C");
    expect(result.current).toMatchObject({ data: { rotulo: "C" }, loading: false });
    await responder(1, "B");
    expect(result.current).toMatchObject({ data: { rotulo: "C" }, loading: false });
    await responder(0, "A");
    expect(result.current).toMatchObject({ data: { rotulo: "C" }, loading: false, error: null });
  });

  it("falha atrasada de um recorte já trocado não vira erro do atual", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    rerender({ params: { status: "B", page: 1, pageSize: 20 } });
    await responder(1, "B");
    await recusar(0, new Error("Erro de A"));
    expect(result.current).toMatchObject({ data: { rotulo: "B" }, loading: false, error: null });
  });

  it("página antiga respondendo depois da nova não volta à vista", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A1");
    rerender({ params: { status: "A", page: 2, pageSize: 20 } });
    rerender({ params: { status: "A", page: 3, pageSize: 20 } });
    await responder(2, "A3");
    await responder(1, "A2");
    expect(result.current).toMatchObject({ data: { rotulo: "A3" }, loading: false });
  });
});

describe("recorte recusado (`enabled: false`)", () => {
  it("não consulta, não carrega, não mostra resposta nem erro de antes", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A");

    rerender({ params: { status: "X", page: 1, pageSize: 20 }, enabled: false });
    expect(pendentes).toHaveLength(1);
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });

  it("resposta pendente de antes da recusa não aparece quando chega", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    rerender({ params: { status: "X", page: 1, pageSize: 20 }, enabled: false });
    await responder(0, "A");
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });

  it("voltar ao recorte de antes da recusa consulta de novo, uma vez", async () => {
    const { result, rerender } = montar({ params: { status: "A", page: 1, pageSize: 20 } });
    await responder(0, "A velho");

    rerender({ params: { status: "X", page: 1, pageSize: 20 }, enabled: false });
    rerender({ params: { status: "A", page: 1, pageSize: 20 }, enabled: true });
    expect(pendentes).toHaveLength(2);
    expect(result.current).toMatchObject({ data: null, loading: true });

    await responder(1, "A novo");
    expect(result.current).toMatchObject({ data: { rotulo: "A novo" }, loading: false });
  });

  it("aberto já recusado: zero consultas", () => {
    const { result } = montar({ params: { status: "X", page: 1, pageSize: 20 }, enabled: false });
    expect(pendentes).toHaveLength(0);
    expect(result.current).toMatchObject({ data: null, loading: false, error: null });
  });
});

describe("recarregar", () => {
  it("consulta de novo o mesmo recorte e página, com a resposta à vista até a nova", async () => {
    const { result } = montar({ params: { status: "A", page: 2, pageSize: 20 } });
    await responder(0, "antes");

    act(() => result.current.reload());
    expect(pendentes).toHaveLength(2);
    expect(pendentes[1]!.params).toEqual({ status: "A", page: 2, pageSize: 20 });
    expect(result.current).toMatchObject({ data: { rotulo: "antes" }, loading: true });

    await responder(1, "depois");
    expect(result.current).toMatchObject({ data: { rotulo: "depois" }, loading: false });
  });
});

describe("desmontar", () => {
  it("resposta que chega depois da tela fechada não escreve nada", async () => {
    const { result, unmount } = montar({ params: { page: 1, pageSize: 20 } });
    const antes = result.current;
    unmount();
    await responder(0, "tarde");
    expect(result.current).toBe(antes);
  });
});

describe("`useFilteredPage` — página de lista com filtros em estado", () => {
  it("filtro novo é página 1 no mesmo render: uma consulta por troca", async () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: string }) => {
        const filtros = { status };
        const [page, setPage] = useFilteredPage(filtros);
        const consulta = useListQuery(fetcher, { ...filtros, page, pageSize: 20 });
        return { page, setPage, consulta };
      },
      { initialProps: { status: "A" } },
    );
    await responder(0, "A1");

    act(() => result.current.setPage(3));
    expect(pendentes.map((pendente) => pendente.params.page)).toEqual([1, 3]);
    await responder(1, "A3");

    rerender({ status: "B" });
    expect(result.current.page).toBe(1);
    expect(pendentes).toHaveLength(3);
    expect(pendentes[2]!.params).toEqual({ status: "B", page: 1, pageSize: 20 });

    // Voltar ao filtro de antes não ressuscita a página 3 dele.
    await responder(2, "B1");
    rerender({ status: "A" });
    expect(result.current.page).toBe(1);
    expect(pendentes).toHaveLength(4);
    expect(pendentes[3]!.params).toEqual({ status: "A", page: 1, pageSize: 20 });
  });
});
