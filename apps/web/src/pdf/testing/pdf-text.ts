import { inflateSync } from "node:zlib";

/**
 * Leitura de um PDF gerado pelo próprio sistema — só para teste.
 *
 * Não é leitor de PDF genérico: entende o que o renderer escreve — objetos
 * numerados, conteúdo em FlateDecode, posição por `cm`/`Tm` e texto em fonte
 * padrão (WinAnsi), em `Tj`/`TJ`. Os trechos que caem na mesma linha de base
 * viram uma linha, da esquerda para a direita, de cima para baixo. Basta para
 * provar paginação, rodapé em toda folha, cabeçalho de tabela repetido,
 * tamanho da folha e ausência de URL.
 */
export type PdfLido = {
  /** Texto de cada página, na ordem; uma linha do papel por linha. */
  paginas: string[];
  /** `MediaBox` de cada página, como escrito no arquivo. */
  folhas: string[];
  /** O arquivo inteiro em latin1 — cabeçalho, metadados, tudo. */
  bruto: string;
};

type Objeto = { dicionario: string; stream: Buffer | null };
type Matriz = [number, number, number, number, number, number];
type Operando = number | string | (number | string)[];
type Trecho = { x: number; y: number; texto: string };

const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];
const WIN_1252 = new TextDecoder("windows-1252");
const TOKEN = /<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\.)*\)|\[|\]|\/[^\s/[\]()<>]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+/g;

/** `m` aplicada antes de `n` (convenção do `cm`: CTM' = M × CTM). */
function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function lerObjetos(bytes: Buffer): Map<number, Objeto> {
  const texto = bytes.toString("latin1");
  const objetos = new Map<number, Objeto>();
  const inicio = /(\d+) 0 obj\b/g;
  let achado: RegExpExecArray | null;
  while ((achado = inicio.exec(texto)) !== null) {
    const numero = Number.parseInt(achado[1]!, 10);
    const corpoInicio = achado.index + achado[0].length;
    const fim = texto.indexOf("endobj", corpoInicio);
    const corpo = texto.slice(corpoInicio, fim);
    const marca = corpo.indexOf("stream");
    if (marca === -1) {
      objetos.set(numero, { dicionario: corpo, stream: null });
      continue;
    }
    const dicionario = corpo.slice(0, marca);
    let dados = corpoInicio + marca + "stream".length;
    if (texto[dados] === "\r") dados += 1;
    if (texto[dados] === "\n") dados += 1;
    const tamanho = /\/Length (\d+)/.exec(dicionario);
    const fimDados = tamanho ? dados + Number.parseInt(tamanho[1]!, 10) : texto.indexOf("endstream", dados);
    objetos.set(numero, { dicionario, stream: bytes.subarray(dados, fimDados) });
    inicio.lastIndex = fim;
  }
  return objetos;
}

function referencia(dicionario: string, chave: string): number | null {
  const achado = new RegExp(`/${chave} (\\d+) 0 R`).exec(dicionario);
  return achado ? Number.parseInt(achado[1]!, 10) : null;
}

function conteudoDe(objeto: Objeto): string {
  if (!objeto.stream) return "";
  const dados = objeto.dicionario.includes("/FlateDecode") ? inflateSync(objeto.stream) : objeto.stream;
  return dados.toString("latin1");
}

function decodificar(token: string): string {
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return WIN_1252.decode(bytes);
  }
  if (token.startsWith("(")) {
    const simples: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    const cru = token
      .slice(1, -1)
      .replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, seq: string) =>
        /^[0-7]/.test(seq) ? String.fromCharCode(Number.parseInt(seq, 8)) : (simples[seq] ?? seq),
      );
    return WIN_1252.decode(Uint8Array.from(cru, (c) => c.charCodeAt(0)));
  }
  return "";
}

/** Executa o fluxo de conteúdo o bastante para saber ONDE cada texto caiu. */
function trechosDoConteudo(conteudo: string): Trecho[] {
  const trechos: Trecho[] = [];
  const pilha: Matriz[] = [];
  let ctm: Matriz = IDENTIDADE;
  let tm: Matriz = IDENTIDADE;
  let tlm: Matriz = IDENTIDADE;
  let operandos: Operando[] = [];
  let lista: (number | string)[] | null = null;

  const mostrar = (partes: (number | string)[]) => {
    const texto = partes
      .filter((parte): parte is string => typeof parte === "string")
      .map(decodificar)
      .join("");
    if (texto === "") return;
    const [, , , , x, y] = multiplicar(tm, ctm);
    trechos.push({ x, y, texto });
  };

  for (const [token] of conteudo.matchAll(TOKEN)) {
    if (token === "[") {
      lista = [];
      continue;
    }
    if (token === "]") {
      if (lista) operandos.push(lista);
      lista = null;
      continue;
    }
    const ehValor = /^[<(/]/.test(token) || /^[-+.\d]/.test(token);
    if (ehValor) {
      const valor = /^[<(/]/.test(token) ? token : Number.parseFloat(token);
      if (lista) lista.push(valor);
      else operandos.push(valor);
      continue;
    }
    const numeros = operandos.filter((o): o is number => typeof o === "number");
    switch (token) {
      case "q":
        pilha.push(ctm);
        break;
      case "Q":
        ctm = pilha.pop() ?? IDENTIDADE;
        break;
      case "cm":
        if (numeros.length >= 6) ctm = multiplicar(numeros.slice(-6) as Matriz, ctm);
        break;
      case "BT":
        tm = IDENTIDADE;
        tlm = IDENTIDADE;
        break;
      case "Tm":
        if (numeros.length >= 6) {
          tm = numeros.slice(-6) as Matriz;
          tlm = tm;
        }
        break;
      case "Td":
      case "TD":
        if (numeros.length >= 2) {
          tlm = multiplicar([1, 0, 0, 1, numeros[numeros.length - 2]!, numeros[numeros.length - 1]!], tlm);
          tm = tlm;
        }
        break;
      case "Tj":
      case "'":
      case '"':
        mostrar(operandos.filter((o): o is string => typeof o === "string"));
        break;
      case "TJ": {
        const partes = operandos.find((o): o is (number | string)[] => Array.isArray(o));
        if (partes) mostrar(partes);
        break;
      }
      default:
        break;
    }
    operandos = [];
  }
  return trechos;
}

/** Mesma linha de base → uma linha, da esquerda para a direita; de cima para baixo. */
function montarLinhas(trechos: Trecho[]): string {
  const linhas: { y: number; trechos: Trecho[] }[] = [];
  for (const trecho of trechos) {
    const linha = linhas.find((candidata) => Math.abs(candidata.y - trecho.y) < 1.5);
    if (linha) linha.trechos.push(trecho);
    else linhas.push({ y: trecho.y, trechos: [trecho] });
  }
  return linhas
    .sort((a, b) => b.y - a.y)
    .map((linha) =>
      linha.trechos
        .sort((a, b) => a.x - b.x)
        .reduce(
          (texto, trecho) =>
            texto === ""
              ? trecho.texto
              : /\s$/.test(texto) || /^\s/.test(trecho.texto)
                ? texto + trecho.texto
                : `${texto} ${trecho.texto}`,
          "",
        ),
    )
    .join("\n");
}

export function lerPdf(arquivo: Uint8Array): PdfLido {
  const bytes = Buffer.from(arquivo);
  const objetos = lerObjetos(bytes);
  const catalogo = [...objetos.values()].find((objeto) => /\/Type\s*\/Catalog/.test(objeto.dicionario));
  const raiz = catalogo ? referencia(catalogo.dicionario, "Pages") : null;
  const arvore = raiz !== null ? objetos.get(raiz) : undefined;
  const filhos = arvore ? (/\/Kids\s*\[([^\]]*)\]/.exec(arvore.dicionario)?.[1] ?? "") : "";
  const idsPaginas = [...filhos.matchAll(/(\d+) 0 R/g)].map((m) => Number.parseInt(m[1]!, 10));

  const paginas: string[] = [];
  const folhas: string[] = [];
  for (const id of idsPaginas) {
    const pagina = objetos.get(id);
    if (!pagina) continue;
    folhas.push(/\/MediaBox\s*\[([^\]]*)\]/.exec(pagina.dicionario)?.[1]?.trim() ?? "");
    const conteudo = referencia(pagina.dicionario, "Contents");
    const fluxo = conteudo !== null ? objetos.get(conteudo) : undefined;
    paginas.push(fluxo ? montarLinhas(trechosDoConteudo(conteudoDe(fluxo))) : "");
  }
  return { paginas, folhas, bruto: bytes.toString("latin1") };
}
