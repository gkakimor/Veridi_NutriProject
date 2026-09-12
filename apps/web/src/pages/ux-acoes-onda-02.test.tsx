import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UX-ACTIONS-FEEDBACK-WAVE-02 — o que vale para o ERP inteiro, lido do fonte.
 *
 * A onda 01 deixou `.form-actions` pronta e listou ~27 barras antigas com
 * botões colados. Esta onda migrou as que tinham ação irmã de verdade; o que
 * fica protegido aqui é que a barra antiga não volte a receber duas ações
 * lado a lado, e que as regras de apoio (checkbox, 390px) continuem de pé.
 */

const SRC = join(process.cwd(), "src");

function arquivosDeTela(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeTela(caminho);
    return nome.endsWith(".tsx") && !nome.endsWith(".test.tsx") ? [caminho] : [];
  });
}

/**
 * Quantas ações (`<button>`, `<Link>`, `<a>`) são filhas DIRETAS de cada
 * `.line-actions`. Ação dentro de um contêiner próprio — `.table__actions`,
 * `.field` — não conta: quem dá o espaçamento é o contêiner.
 */
function barrasAntigas(): { onde: string; acoes: number; corpo: string }[] {
  const barras: { onde: string; acoes: number; corpo: string }[] = [];
  for (const arquivo of arquivosDeTela(SRC)) {
    const texto = readFileSync(arquivo, "utf8");
    const abertura = /<div className="line-actions">/g;
    for (let achado = abertura.exec(texto); achado; achado = abertura.exec(texto)) {
      const etiqueta = /<(\/?)(div|button|Link|a)\b[^>]*?(\/?)>/g;
      etiqueta.lastIndex = achado.index;
      let nivel = 0;
      let acoes = 0;
      let fim = texto.length;
      for (let tag = etiqueta.exec(texto); tag; tag = etiqueta.exec(texto)) {
        const [, fecha, nome, autoFechada] = tag;
        if (nome === "div") {
          if (fecha) {
            nivel -= 1;
            if (nivel === 0) {
              fim = etiqueta.lastIndex;
              break;
            }
          } else if (!autoFechada) {
            nivel += 1;
          }
        } else if (!fecha && nivel === 1) {
          acoes += 1;
        }
      }
      const linha = texto.slice(0, achado.index).split("\n").length;
      barras.push({
        onde: `${relative(SRC, arquivo).split(sep).join("/")}:${linha}`,
        acoes,
        corpo: texto.slice(achado.index, fim),
      });
    }
  }
  return barras;
}

/**
 * Barra antiga com duas ações diretas que NUNCA aparecem juntas.
 *
 * O leitor de fonte não avalia condição; a exceção é nomeada pelo arquivo E
 * por um trecho da própria barra, com o motivo — outra barra do mesmo arquivo
 * não passa por ela.
 */
const EXCLUSIVAS_POR_ESTADO: { arquivo: string; trecho: string; motivo: string }[] = [
  {
    arquivo: "pages/lots/LotDetailPage.tsx",
    trecho: "setUnblockDialogOpen(true)",
    motivo:
      "Bloquear (lote disponível) e Desbloquear (lote bloqueado) dependem de status diferentes; Liberar + Bloquear já moram em `.table__actions`.",
  },
];

const excecao = ({ onde, corpo }: { onde: string; corpo: string }) =>
  EXCLUSIVAS_POR_ESTADO.some(
    ({ arquivo, trecho }) => onde.replace(/:\d+$/, "") === arquivo && corpo.includes(trecho),
  );

/** A folha com fim de linha único — o checkout do Windows traz CRLF. */
const css = () => readFileSync(join(SRC, "styles", "components.css"), "utf8").replace(/\r\n/g, "\n");
/** Só as regras: comentário que CITA o padrão proibido não é o padrão. */
const semComentarios = () => css().replace(/\/\*[\s\S]*?\*\//g, "");

/** O corpo de uma regra CSS, pelo seletor exato. */
function regra(seletor: string): string {
  const folha = css();
  const inicio = folha.indexOf(`\n${seletor} {`);
  if (inicio < 0) throw new Error(`regra ausente: ${seletor}`);
  return folha.slice(inicio, folha.indexOf("}", inicio));
}

describe("Barra antiga `.line-actions` — não recebe mais ações irmãs", () => {
  it("nenhuma `.line-actions` tem duas ações lado a lado sem contêiner de gap", () => {
    const coladas = barrasAntigas()
      .filter((barra) => barra.acoes >= 2 && !excecao(barra))
      .map(({ onde, acoes }) => ({ onde, acoes }));
    // Ação irmã vai para `.form-actions` (gap, grupos e quebra em 390px).
    expect(coladas).toEqual([]);
  });

  it("a classe continua existindo para os usos válidos, e cada exceção ainda existe", () => {
    const barras = barrasAntigas();
    expect(barras.length).toBeGreaterThan(0);
    expect(regra(".line-actions")).toContain("margin-top");
    // Exceção sem a barra que a justificava é exceção esquecida.
    for (const { arquivo, trecho } of EXCLUSIVAS_POR_ESTADO) {
      expect(
        barras.some((barra) => barra.onde.startsWith(`${arquivo}:`) && barra.corpo.includes(trecho)),
      ).toBe(true);
    }
  });

  it("separar ações é grupo, nunca margem avulsa entre botões", () => {
    const folha = semComentarios();
    expect(folha).not.toContain(".btn--set-apart");
    expect(folha).not.toMatch(/button\s*\+\s*button/);
    expect(folha).not.toMatch(/\.btn\s*\+\s*\.btn/);
    for (const seletor of [".form-actions", ".form-actions--split", ".form-actions__group"]) {
      expect(regra(seletor)).not.toContain("margin-left");
    }
    expect(regra(".form-actions")).toContain("gap: var(--sp-3)");
    expect(regra(".form-actions__group")).toContain("gap: var(--sp-2)");
  });
});

describe("390px — a barra quebra em vez de vazar", () => {
  it("grupos e botões quebram de linha, e nenhuma regra da barra proíbe a quebra", () => {
    expect(regra(".form-actions")).toContain("flex-wrap: wrap");
    expect(regra(".form-actions__group")).toContain("flex-wrap: wrap");

    const folha = css();
    const estreita = folha.slice(folha.indexOf("@media (max-width: 480px) {\n  .form-actions {"));
    const bloco = estreita.slice(0, estreita.indexOf("\n}\n"));
    expect(bloco).toContain("width: 100%");
    expect(bloco).toContain("flex: 1 1 auto");
    // Caber encolhendo a letra é o que a regra proíbe.
    expect(bloco).not.toContain("font-size");
    // `nowrap` num botão da barra empurraria a tela para o lado.
    expect(bloco).not.toContain("white-space: nowrap");
    // Grupo vazio não vira linha em branco quando os grupos empilham.
    expect(bloco).toMatch(/\.form-actions__group:empty \{\s*display: none;/);
  });
});

describe("`.checkbox` — rótulo e caixa alinhados, sem mudar o que está em volta", () => {
  it("tem regra própria: alinhamento, gap e cursor", () => {
    const rotulo = regra(".checkbox");
    expect(rotulo).toContain("display: inline-flex");
    expect(rotulo).toContain("align-items: center");
    expect(rotulo).toContain("gap: var(--sp-2)");
    expect(rotulo).toContain("cursor: pointer");
    // Cor e tamanho de letra continuam os do lugar onde o rótulo mora.
    expect(rotulo).not.toContain("font-size");
    expect(rotulo).not.toContain("color");

    const caixa = regra(".checkbox input");
    expect(caixa).toContain("margin: 0");
  });

  it("os usos continuam sendo a caixa DENTRO do rótulo — o nome acessível vem do texto", () => {
    const usos = arquivosDeTela(SRC).flatMap((arquivo) => {
      const texto = readFileSync(arquivo, "utf8");
      return [...texto.matchAll(/<label className="checkbox">([\s\S]*?)<\/label>/g)].map(
        (achado) => ({ arquivo: relative(SRC, arquivo), corpo: achado[1] ?? "" }),
      );
    });
    expect(usos.length).toBeGreaterThanOrEqual(6);
    for (const { corpo } of usos) {
      expect(corpo).toMatch(/type="checkbox"/);
    }
  });
});
