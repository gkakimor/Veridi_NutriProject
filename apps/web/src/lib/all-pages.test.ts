import { describe, expect, it } from "vitest";
import { loadAllPages } from "./all-pages";

/**
 * `loadAllPages` contra um servidor falso que pagina como o real: fatia por
 * `skip`/`take`, `total` de um `count` e teto de `pageSize` (a fila da
 * Qualidade recusa acima de 100). A folha FO-03 lia uma página só; aqui se
 * prova a leitura inteira e cada guarda que impede um documento parcial de
 * parecer completo.
 */

type Linha = { id: string };

const PAGINA = 100;

function universo(tamanho: number): Linha[] {
  // Ordem do servidor que NÃO é a ordem do id: concatenar não pode reordenar.
  return Array.from({ length: tamanho }, (_, i) => ({ id: `L-${String((i * 37) % 1009).padStart(4, "0")}-${i}` }));
}

function servidor(linhas: Linha[], teto = PAGINA) {
  const pedidos: { page: number; pageSize: number }[] = [];
  const consultar = async ({ page, pageSize }: { page: number; pageSize: number }) => {
    pedidos.push({ page, pageSize });
    if (pageSize > teto) throw new Error(`pageSize acima de ${teto}`);
    return { rows: linhas.slice((page - 1) * pageSize, page * pageSize), total: linhas.length };
  };
  return { consultar, pedidos };
}

const opcoes = { pageSize: PAGINA, chave: (linha: Linha) => linha.id };

describe("loadAllPages — o conjunto inteiro, uma requisição por página", () => {
  it.each([
    [0, 1],
    [1, 1],
    [99, 1],
    [100, 1],
    [101, 2],
    [125, 2],
    [200, 2],
    [201, 3],
    [500, 5],
    [1000, 10],
  ])("%i linhas: todas, na ordem do servidor, em %i requisição(ões)", async (tamanho, requisicoes) => {
    const linhas = universo(tamanho);
    const { consultar, pedidos } = servidor(linhas);

    const lidas = await loadAllPages(consultar, opcoes);

    expect(lidas).toEqual(linhas);
    expect(pedidos).toEqual(Array.from({ length: requisicoes }, (_, i) => ({ page: i + 1, pageSize: PAGINA })));
  });
});

describe("loadAllPages — nada de documento parcial com cara de completo", () => {
  it("a segunda página falha: lança a falha dela, sem devolver a primeira", async () => {
    const linhas = universo(125);
    const falha = new Error("Erro interno do servidor (500). Tente novamente ou avise o suporte.");
    const pedidos: number[] = [];

    const leitura = loadAllPages(async ({ page, pageSize }) => {
      pedidos.push(page);
      if (page === 2) throw falha;
      return { rows: linhas.slice((page - 1) * pageSize, page * pageSize), total: linhas.length };
    }, opcoes);

    await expect(leitura).rejects.toBe(falha);
    expect(pedidos).toEqual([1, 2]);
  });

  it("o total muda entre uma página e outra: a lista mudou no meio, e lança", async () => {
    const linhas = universo(125);
    const leitura = loadAllPages(async ({ page, pageSize }) => {
      // Um lote aprovado entre a página 1 e a 2 sai do recorte.
      const atual = page === 1 ? linhas : linhas.slice(1);
      return { rows: atual.slice((page - 1) * pageSize, page * pageSize), total: atual.length };
    }, opcoes);

    await expect(leitura).rejects.toThrow("A lista mudou enquanto era lida.");
  });

  it("servidor que corta a página em silêncio (teto menor que o pedido): lança, e para", async () => {
    const linhas = universo(125);
    const pedidos: number[] = [];
    const leitura = loadAllPages(async ({ page }) => {
      pedidos.push(page);
      // Devolve 50 por página e mantém o total de 125.
      return { rows: linhas.slice((page - 1) * 50, page * 50), total: linhas.length };
    }, opcoes);

    await expect(leitura).rejects.toThrow("A página 1 não fecha com o total de 125 linha(s).");
    expect(pedidos).toEqual([1]);
  });

  it("página vazia antes do total: lança em vez de pedir para sempre", async () => {
    const linhas = universo(125);
    const pedidos: number[] = [];
    const leitura = loadAllPages(async ({ page, pageSize }) => {
      pedidos.push(page);
      return { rows: page === 1 ? linhas.slice(0, pageSize) : [], total: linhas.length };
    }, opcoes);

    await expect(leitura).rejects.toThrow("A página 2 não fecha com o total de 125 linha(s).");
    expect(pedidos).toEqual([1, 2]);
  });

  it("página com linha a mais do que falta: lança", async () => {
    const linhas = universo(101);
    const leitura = loadAllPages(async ({ page, pageSize }) => {
      const rows = linhas.slice((page - 1) * pageSize, page * pageSize);
      return { rows: page === 2 ? [...rows, { id: "sobra" }] : rows, total: linhas.length };
    }, opcoes);

    await expect(leitura).rejects.toThrow("A página 2 não fecha com o total de 101 linha(s).");
  });

  it("a mesma linha em duas páginas, com o total intacto: a lista mudou, e lança", async () => {
    const linhas = universo(125);
    const leitura = loadAllPages(async ({ page, pageSize }) => {
      // Um lote entrou antes do deslocamento e outro saiu depois: o total
      // não mudou, mas a última da página 1 escorregou para a página 2.
      const deslocada = [...linhas.slice(0, 1), ...linhas.slice(0, 124)];
      const atual = page === 1 ? linhas : deslocada;
      return { rows: atual.slice((page - 1) * pageSize, page * pageSize), total: atual.length };
    }, opcoes);

    await expect(leitura).rejects.toThrow("A lista mudou enquanto era lida.");
  });

  it.each([Number.NaN, -1, 1.5, undefined])("total inválido (%s): lança na primeira página", async (total) => {
    const pedidos: number[] = [];
    const leitura = loadAllPages(async ({ page }) => {
      pedidos.push(page);
      return { rows: [], total: total as number };
    }, opcoes);

    await expect(leitura).rejects.toThrow("A consulta não informou o total de linhas.");
    expect(pedidos).toEqual([1]);
  });

  it.each([0, -5, 2.5])("pageSize inválido (%s): lança sem consultar", async (pageSize) => {
    const { consultar, pedidos } = servidor(universo(10));

    await expect(loadAllPages(consultar, { ...opcoes, pageSize })).rejects.toThrow("Tamanho de página inválido");
    expect(pedidos).toEqual([]);
  });
});
