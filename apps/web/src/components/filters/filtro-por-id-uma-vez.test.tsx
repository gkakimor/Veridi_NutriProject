import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EntityOption } from "../SearchableEntitySelect";
import { EntityFilterSelect } from "./EntityFilterSelect";
import type { EntityFilterSource } from "./EntityFilterSelect";

/**
 * O nome do escolhido é perguntado UMA vez por valor (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * O efeito que resolve o rótulo do id escolhido dependia da lista de opções, e a
 * limpeza dele descartava a pergunta em andamento. A primeira página chegando
 * antes do nome mudava a lista, descartava a resposta que vinha e perguntava de
 * novo — duas consultas pelo mesmo id em toda barra restaurada com um valor fora
 * da primeira página. Cada busca que chegava antes do nome, e cada busca com um
 * id que não existe mais, perguntava outra vez.
 *
 * O servidor falso guarda 1002 registros e responde páginas de 20: o escolhido
 * é o #1001, fora da primeira página, e só o `porId` o nomeia sem busca.
 */

const PAGINA = 20;

function registro(numero: number): EntityOption {
  return {
    id: `cli-${numero}`,
    code: `CLI-${String(numero).padStart(6, "0")}`,
    name: `Cliente de Volume ${String(numero).padStart(4, "0")} Ltda`,
  };
}

const UNIVERSO = Array.from({ length: 1002 }, (_, indice) => registro(indice + 1));
const ALVO = UNIVERSO[1000]!;
const OUTRO = UNIVERSO[1001]!;
const NA_PRIMEIRA_PAGINA = UNIVERSO[3]!;
const rotulo = (opcao: EntityOption) => `${opcao.code} · ${opcao.name}`;

/** Promessa que o teste resolve quando quer — a ordem de chegada é o assunto. */
function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

/**
 * Fonte com o catálogo inteiro no "servidor". Cada resposta fica pendurada até
 * o teste soltar: `soltarInicial`, `soltarPorId`, `soltarBuscas`.
 */
function servidor() {
  const iniciais: ReturnType<typeof adiada<EntityOption[]>>[] = [];
  const nomes: { id: string; resposta: ReturnType<typeof adiada<EntityOption | null>> }[] = [];
  const buscas: { termo: string; resposta: ReturnType<typeof adiada<EntityOption[]>> }[] = [];
  const source: EntityFilterSource = {
    inicial: vi.fn(() => {
      const resposta = adiada<EntityOption[]>();
      iniciais.push(resposta);
      return resposta.promessa;
    }),
    buscar: vi.fn((termo: string) => {
      const resposta = adiada<EntityOption[]>();
      buscas.push({ termo, resposta });
      return resposta.promessa;
    }),
    porId: vi.fn((id: string) => {
      const resposta = adiada<EntityOption | null>();
      nomes.push({ id, resposta });
      return resposta.promessa;
    }),
  };
  return {
    source,
    async soltarInicial() {
      await act(async () => {
        for (const resposta of iniciais.splice(0)) resposta.resolver(UNIVERSO.slice(0, PAGINA));
      });
    },
    async soltarPorId() {
      await act(async () => {
        for (const { id, resposta } of nomes.splice(0)) resposta.resolver(UNIVERSO.find((opcao) => opcao.id === id) ?? null);
      });
    },
    async soltarBuscas() {
      await act(async () => {
        for (const { termo, resposta } of buscas.splice(0)) {
          const achados = UNIVERSO.filter((opcao) => `${opcao.code} ${opcao.name}`.includes(termo));
          resposta.resolver(achados.slice(0, PAGINA));
        }
      });
    },
    pedidosPorId: () => vi.mocked(source.porId).mock.calls.map(([id]) => id),
  };
}

function Barra({
  source,
  inicial,
  aoResolver,
}: {
  source: EntityFilterSource;
  inicial: string;
  aoResolver?: (opcao: EntityOption | null) => void;
}) {
  const [valor, setValor] = useState(inicial);
  return (
    <div className="toolbar">
      <EntityFilterSelect
        id="filtro-cliente"
        label="Filtrar por cliente"
        placeholder="Todos os clientes"
        value={valor}
        onChange={setValor}
        source={source}
        {...(aoResolver ? { onResolve: aoResolver } : {})}
      />
      {/* Troca de valor vinda de fora do campo — link, filtro lembrado, "Limpar". */}
      <button type="button" onClick={() => setValor(OUTRO.id)}>
        Ir para o outro
      </button>
      <button type="button" onClick={() => setValor(ALVO.id)}>
        Voltar ao alvo
      </button>
    </div>
  );
}

const campo = () => screen.getByRole("combobox", { name: "Filtrar por cliente" }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("valor restaurado fora da primeira página", () => {
  it("primeira página chega antes do nome: uma pergunta pelo id, e o nome aparece", async () => {
    const api = servidor();
    const aoResolver = vi.fn();
    render(<Barra source={api.source} inicial={ALVO.id} aoResolver={aoResolver} />);

    await api.soltarInicial();
    await api.soltarPorId();

    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    expect(api.pedidosPorId()).toEqual([ALVO.id]);
    // O chip recebe quem está escolhido.
    expect(aoResolver).toHaveBeenLastCalledWith(ALVO);
  });

  it("nome chega antes da primeira página: uma pergunta, e a página não pergunta de novo", async () => {
    const api = servidor();
    render(<Barra source={api.source} inicial={ALVO.id} />);

    await api.soltarPorId();
    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    await api.soltarInicial();

    expect(campo()).toHaveValue(rotulo(ALVO));
    expect(api.pedidosPorId()).toEqual([ALVO.id]);
  });

  it("buscas que chegam antes do nome não perguntam pelo id outra vez", async () => {
    const api = servidor();
    render(<Barra source={api.source} inicial={ALVO.id} />);
    await api.soltarInicial();

    fireEvent.focus(campo());
    for (const termo of ["Volume 00", "Volume 01"]) {
      fireEvent.change(campo(), { target: { value: termo } });
      await waitFor(() => expect(api.source.buscar).toHaveBeenCalledWith(termo));
      await api.soltarBuscas();
    }
    fireEvent.keyDown(campo(), { key: "Escape" });

    await api.soltarPorId();
    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    expect(api.pedidosPorId()).toEqual([ALVO.id]);
  });

  it("id que não existe mais: perguntado uma vez — página e buscas não repetem a pergunta", async () => {
    const api = servidor();
    render(<Barra source={api.source} inicial="cli-legado" />);
    await api.soltarPorId();
    await api.soltarInicial();

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: "Volume 1001" } });
    await waitFor(() => expect(api.source.buscar).toHaveBeenCalledWith("Volume 1001"));
    await api.soltarBuscas();
    await api.soltarPorId();

    expect(api.pedidosPorId()).toEqual(["cli-legado"]);
    // O filtro continua valendo; só o nome fica ausente.
    fireEvent.keyDown(campo(), { key: "Escape" });
    expect(campo()).toHaveValue("");
  });

  it("em StrictMode (dev): a montagem dobrada pergunta uma vez e o nome chega", async () => {
    const api = servidor();
    render(
      <StrictMode>
        <Barra source={api.source} inicial={ALVO.id} />
      </StrictMode>,
    );
    await api.soltarInicial();
    await api.soltarPorId();

    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    expect(api.pedidosPorId()).toEqual([ALVO.id]);
  });
});

describe("mudança de valor", () => {
  it("outro id fora da página pergunta uma vez por ele; voltar ao já nomeado não pergunta", async () => {
    const api = servidor();
    render(<Barra source={api.source} inicial={ALVO.id} />);
    await api.soltarInicial();
    await api.soltarPorId();
    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));

    fireEvent.click(screen.getByRole("button", { name: "Ir para o outro" }));
    await api.soltarPorId();
    await waitFor(() => expect(campo()).toHaveValue(rotulo(OUTRO)));

    fireEvent.click(screen.getByRole("button", { name: "Voltar ao alvo" }));
    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));

    expect(api.pedidosPorId()).toEqual([ALVO.id, OUTRO.id]);
  });

  it("escolha pela busca não pergunta pelo id: o nome veio na resposta", async () => {
    const api = servidor();
    render(<Barra source={api.source} inicial="" />);
    await api.soltarInicial();

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: ALVO.code } });
    await waitFor(() => expect(api.source.buscar).toHaveBeenCalledWith(ALVO.code));
    await api.soltarBuscas();
    fireEvent.mouseDown(await screen.findByRole("option", { name: new RegExp(`^${ALVO.code}`) }));

    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    expect(api.pedidosPorId()).toEqual([]);
  });

  it("valor da primeira página: o nome sai da página, e a pergunta da montagem é a única", async () => {
    const api = servidor();
    render(<Barra source={api.source} inicial={NA_PRIMEIRA_PAGINA.id} />);
    await api.soltarInicial();
    await waitFor(() => expect(campo()).toHaveValue(rotulo(NA_PRIMEIRA_PAGINA)));
    await api.soltarPorId();

    // Na montagem a lista ainda está vazia: a pergunta sai junto da página, e só ela.
    expect(api.pedidosPorId()).toEqual([NA_PRIMEIRA_PAGINA.id]);
    expect(campo()).toHaveValue(rotulo(NA_PRIMEIRA_PAGINA));
  });
});
