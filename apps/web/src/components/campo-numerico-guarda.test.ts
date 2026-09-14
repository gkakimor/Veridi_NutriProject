import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda estrutural dos campos numéricos pt-BR — nasceu com a foundation
 * (PTBR-NUMERIC-INPUT-FOUNDATION-01) e virou proibição no rollout
 * (PTBR-NUMERIC-INPUT-ROLLOUT-01), quando o último campo migrou.
 *
 * Quatro coisas, sobre o código web de PRODUÇÃO (testes e ajudantes de teste
 * ficam fora):
 *
 * 1. a foundation continua sem float e sem locale da máquina — o motivo de ela
 *    existir;
 * 2. `type="number"` não existe em lugar nenhum;
 * 3. `<input>` cru com teclado numérico (`inputMode="decimal"`/`"numeric"`) só
 *    existe para o que PARECE número e não é — CEP, na allowlist com o motivo.
 *    Campo de quantidade, preço ou percentual é `IntegerField`, `DecimalField`,
 *    `MoneyField` ou `PercentField`;
 * 4. nenhuma tela lê número à mão (`parseFloat`, `parseInt`, `valueAsNumber`,
 *    `Number(event.target.value)`, troca de vírgula por ponto): a leitura é
 *    `parsePtBrNumber`, direto ou pelos ajudantes da borda.
 *
 * Exceção nova entra na allowlist com o motivo escrito — e o motivo é revisado
 * como código.
 */

const RAIZ = join(process.cwd(), "src");

/** Comentários fora: explicar por que não usar `type="number"` não é usá-lo. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function relativo(arquivo: string): string {
  return relative(RAIZ, arquivo).split(sep).join("/");
}

/** Código de produção: `.ts`/`.tsx`, fora de teste e de ajudante de teste. */
function arquivosDeProducao(pasta: string, extensoes: readonly string[]): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) {
      return entrada.name === "testing" || entrada.name === "test-support"
        ? []
        : arquivosDeProducao(caminho, extensoes);
    }
    const ehTeste = /\.test\.tsx?$/.test(entrada.name) || entrada.name.startsWith("setup");
    return !ehTeste && extensoes.some((extensao) => entrada.name.endsWith(extensao)) ? [caminho] : [];
  });
}

interface InputCru {
  arquivo: string;
  id: string;
  rotulo: string;
  inputMode: string | null;
  atributos: string;
}

/** Cada `<input ... />` do JSX, com os atributos que a guarda lê. */
function inputsCrus(arquivo: string): InputCru[] {
  const fonte = semComentarios(readFileSync(arquivo, "utf8"));
  return [...fonte.matchAll(/<input\b([\s\S]*?)\/>/g)].map((achado) => {
    const atributos = achado[1] ?? "";
    return {
      arquivo: relativo(arquivo),
      id: /\bid=\{?["'`]([^"'`]+)["'`]/.exec(atributos)?.[1] ?? "",
      rotulo: /aria-label=\{?["'`]([^"'`]+)["'`]/.exec(atributos)?.[1] ?? "",
      inputMode: /inputMode=\{?["']([a-z]+)["']/.exec(atributos)?.[1] ?? null,
      atributos,
    };
  });
}

/**
 * O que parece número e não é: continua `<input>` de texto, com zeros à
 * esquerda e máscara próprios (`UI_BRAND.md`, "Quando NÃO usar").
 */
const TECLADO_NUMERICO_SEM_SER_NUMERO: Record<string, string> = {
  "pages/customers/customer-form.tsx#customer-zip":
    "CEP é identificador: zeros à esquerda e máscara 00000-000, não se soma.",
  "pages/suppliers/supplier-form.tsx#supplier-zip":
    "CEP é identificador: zeros à esquerda e máscara 00000-000, não se soma.",
};

/** Onde a leitura à mão é legítima — com o motivo. */
const LEITURA_A_MAO_PERMITIDA: Record<string, string> = {
  "lib/numeric-ptbr.ts":
    "A foundation: `parseInt` só no expoente de notação científica, que posiciona o ponto — nunca no valor.",
  "lib/decimal-format.ts":
    "Formatação por dígitos: `parseInt` só no expoente de notação científica.",
  "components/help/CalcHint.tsx":
    "Confere a própria explicação lendo o texto EXIBIDO de cada operando; não é campo nem borda de gravação.",
};

const LEITURAS_A_MAO: { nome: string; padrao: RegExp; exemplo: string }[] = [
  { nome: "parseFloat", padrao: /\bparseFloat\s*\(/, exemplo: "Number.parseFloat(texto)" },
  { nome: "parseInt", padrao: /\bparseInt\s*\(/, exemplo: "parseInt(texto, 10)" },
  { nome: "valueAsNumber", padrao: /\bvalueAsNumber\b/, exemplo: "event.target.valueAsNumber" },
  {
    nome: "Number(event.target.value)",
    padrao: /\bNumber\(\s*\w+\.(?:current)?[Tt]arget\.value\s*\)/,
    exemplo: "Number(event.currentTarget.value)",
  },
  {
    nome: "troca de vírgula por ponto",
    padrao: /\.replace(?:All)?\(\s*(?:["'],["']|\/,\/g?)\s*,\s*["']\.["']\s*\)/,
    exemplo: 'texto.replace(",", ".")',
  },
];

describe("campo numérico — guarda estrutural", () => {
  it("a foundation não passa valor por float nem pelo locale da máquina", () => {
    for (const arquivo of ["src/lib/numeric-ptbr.ts", "src/components/NumericField.tsx"]) {
      const corpo = semComentarios(readFileSync(join(process.cwd(), arquivo), "utf8"));
      expect(corpo, `${arquivo} usa type="number"`).not.toMatch(/type=\{?["']number["']/);
      expect(corpo, `${arquivo} usa valueAsNumber`).not.toContain("valueAsNumber");
      expect(corpo, `${arquivo} usa toLocaleString`).not.toContain("toLocaleString");
      expect(corpo, `${arquivo} usa Intl`).not.toContain("Intl.");
      expect(corpo, `${arquivo} usa parseFloat`).not.toContain("parseFloat");
      expect(corpo, `${arquivo} usa Math.round`).not.toContain("Math.round");
      expect(corpo, `${arquivo} usa toFixed`).not.toContain("toFixed(");
      // `\b`: `parsePtBrNumber(` é nome de função, não conversão.
      expect(corpo, `${arquivo} converte para Number`).not.toMatch(/\bNumber\(/);
    }
  });

  it('type="number" não existe no código de produção — campo numérico usa os campos pt-BR', () => {
    const TYPE_NUMBER = /type=\{?["']number["']/;
    const arquivos = arquivosDeProducao(RAIZ, [".tsx"]);
    // A varredura não é vazia e o padrão pega as duas grafias do JSX.
    expect(arquivos.length).toBeGreaterThan(100);
    expect(TYPE_NUMBER.test('<input type="number" />') && TYPE_NUMBER.test("<input type={'number'} />")).toBe(true);

    const comTypeNumber = arquivos
      .filter((arquivo) => TYPE_NUMBER.test(semComentarios(readFileSync(arquivo, "utf8"))))
      .map(relativo);

    expect(comTypeNumber).toEqual([]);
  });

  it("<input> cru com teclado numérico só existe para identificador — e com o motivo na allowlist", () => {
    const arquivos = arquivosDeProducao(RAIZ, [".tsx"]).filter(
      (arquivo) => relativo(arquivo) !== "components/NumericField.tsx",
    );
    const todos = arquivos.flatMap(inputsCrus);
    // A leitura dos atributos funciona: há campos de texto e o CEP é achado.
    expect(todos.length).toBeGreaterThan(50);
    expect(todos.some((input) => input.id === "customer-zip" && input.inputMode === "numeric")).toBe(true);

    const numericos = todos
      .filter((input) => input.inputMode === "decimal" || input.inputMode === "numeric")
      .map((input) => `${input.arquivo}#${input.id || input.rotulo}`);

    expect(numericos.filter((chave) => !(chave in TECLADO_NUMERICO_SEM_SER_NUMERO))).toEqual([]);
    // Allowlist sem sobra: exceção que deixou de existir sai da lista.
    expect(Object.keys(TECLADO_NUMERICO_SEM_SER_NUMERO).filter((chave) => !numericos.includes(chave))).toEqual([]);
  });

  it("campo de quantidade, preço ou percentual não é <input> de texto cru", () => {
    // O nome do campo denuncia o número mesmo sem `inputMode`.
    const NOME_DE_NUMERO = /quantity|quantidade|price|pre[cç]o|percent|amount|doses|capacity|capacidade|\bmoq\b/i;
    const suspeitos = arquivosDeProducao(RAIZ, [".tsx"])
      .filter((arquivo) => relativo(arquivo) !== "components/NumericField.tsx")
      .flatMap(inputsCrus)
      .filter((input) => !/type=\{?["'](?:checkbox|radio|date|time|file|hidden)["']/.test(input.atributos))
      .filter((input) => NOME_DE_NUMERO.test(`${input.id} ${input.rotulo} ${/value=\{([^}]*)\}/.exec(input.atributos)?.[1] ?? ""}`))
      .map((input) => `${input.arquivo}#${input.id || input.rotulo}`);

    expect(NOME_DE_NUMERO.test("Preço unitário de PRD-1") && NOME_DE_NUMERO.test("line.orderedQuantity")).toBe(true);
    expect(suspeitos).toEqual([]);
  });

  it.each(LEITURAS_A_MAO)("nenhuma tela lê número à mão: $nome", ({ nome, padrao, exemplo }) => {
    // O padrão pega o que diz pegar — guarda que não acusa nada não guarda nada.
    expect(padrao.test(exemplo)).toBe(true);

    const comLeitura = arquivosDeProducao(RAIZ, [".ts", ".tsx"])
      .filter((arquivo) => padrao.test(semComentarios(readFileSync(arquivo, "utf8"))))
      .map(relativo)
      .filter((arquivo) => !(arquivo in LEITURA_A_MAO_PERMITIDA));

    expect(comLeitura, `${nome} fora da allowlist`).toEqual([]);
  });

  it("a allowlist de leitura à mão não guarda arquivo que já não lê à mão", () => {
    const sobras = Object.keys(LEITURA_A_MAO_PERMITIDA).filter((arquivo) => {
      const corpo = semComentarios(readFileSync(join(RAIZ, arquivo), "utf8"));
      return !LEITURAS_A_MAO.some(({ padrao }) => padrao.test(corpo));
    });
    expect(sobras).toEqual([]);
  });
});
