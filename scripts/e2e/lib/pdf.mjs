import { inflateSync } from "node:zlib";

/**
 * Texto do PDF gerado pela tela do documento — para as suítes E2E.
 *
 * O impresso é PDF real gerado no navegador: a rota `/…/imprimir` monta o
 * arquivo, cria um `blob:` e o mostra no iframe `.pdf-screen__frame`
 * (`apps/web/src/pdf/PdfScreen.tsx`). A suíte lê o PRÓPRIO arquivo — os mesmos
 * bytes que "Baixar PDF" salva — e procura o texto nele:
 *
 *   const texto = await textoDoPdfDaTela(pagina);
 *   afirmar("o impresso traz a validade nova", texto.includes("31/10/2099"));
 *
 * Contrato provado contra o documento real em E2E-BASELINE-REDESIGN-WAVE-01-02
 * (`leitor-de-pdf-da-tela.mjs`): iframe `.pdf-screen__frame`, `src` em `blob:`
 * (com `#toolbar=0…` depois), arquivo começando por `%PDF-`. A primeira carga
 * do motor de PDF pode passar de um minuto — a espera padrão é 90 s. O texto
 * sai com espaço comum no lugar de NBSP: valor formatado pelo sistema
 * (`R$ 1.234,56`) traz U+00A0, e a suíte compara com espaço.
 *
 * `lerPdf` é gêmeo de `apps/web/src/pdf/testing/pdf-text.ts` (teste de
 * unidade), com paridade conferida em `lib/pdf.test.ts`. Não é leitor de PDF
 * genérico: entende o que o renderer do sistema escreve — objetos numerados,
 * FlateDecode, posição por `cm`/`Tm` e texto WinAnsi em `Tj`/`TJ`. Trechos na
 * mesma linha de base viram uma linha.
 */

/** NBSP (U+00A0) e espaço fino (U+202F) viram espaço comum. */
export function normalizarTexto(texto) {
  return texto.replace(/[  ]/g, " ");
}

/** Espera a tela terminar de gerar e devolve o texto do PDF, página após página. */
export async function textoDoPdfDaTela(pagina, { timeout = 90000 } = {}) {
  await pagina.locator("iframe.pdf-screen__frame").first().waitFor({ timeout });
  const lido = await pagina.evaluate(async () => {
    const src = document.querySelector("iframe.pdf-screen__frame")?.getAttribute("src") ?? "";
    const origem = src.split("#")[0];
    if (!origem.startsWith("blob:")) return { src, base64: null };
    const bytes = new Uint8Array(await (await fetch(origem)).arrayBuffer());
    let binario = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { src, base64: btoa(binario) };
  });
  if (!lido.base64) {
    throw new Error(`o documento não veio como blob gerado no navegador: src="${lido.src.slice(0, 80)}"`);
  }
  const bytes = Buffer.from(lido.base64, "base64");
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error(
      `o blob do iframe não é PDF (${bytes.length} bytes, começa com "${bytes.subarray(0, 8).toString("latin1")}")`,
    );
  }
  return normalizarTexto(lerPdf(bytes).paginas.join("\n"));
}

const IDENTIDADE = [1, 0, 0, 1, 0, 0];
const WIN_1252 = new TextDecoder("windows-1252");
const TOKEN = /<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\.)*\)|\[|\]|\/[^\s/[\]()<>]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+/g;

function multiplicar(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function lerObjetos(bytes) {
  const texto = bytes.toString("latin1");
  const objetos = new Map();
  const inicio = /(\d+) 0 obj\b/g;
  let achado;
  while ((achado = inicio.exec(texto)) !== null) {
    const numero = Number.parseInt(achado[1], 10);
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
    const fimDados = tamanho ? dados + Number.parseInt(tamanho[1], 10) : texto.indexOf("endstream", dados);
    objetos.set(numero, { dicionario, stream: bytes.subarray(dados, fimDados) });
    inicio.lastIndex = fim;
  }
  return objetos;
}

function referencia(dicionario, chave) {
  const achado = new RegExp(`/${chave} (\\d+) 0 R`).exec(dicionario);
  return achado ? Number.parseInt(achado[1], 10) : null;
}

function conteudoDe(objeto) {
  if (!objeto.stream) return "";
  const dados = objeto.dicionario.includes("/FlateDecode") ? inflateSync(objeto.stream) : objeto.stream;
  return dados.toString("latin1");
}

function decodificar(token) {
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return WIN_1252.decode(bytes);
  }
  if (token.startsWith("(")) {
    const simples = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    const cru = token
      .slice(1, -1)
      .replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, seq) =>
        /^[0-7]/.test(seq) ? String.fromCharCode(Number.parseInt(seq, 8)) : (simples[seq] ?? seq),
      );
    return WIN_1252.decode(Uint8Array.from(cru, (c) => c.charCodeAt(0)));
  }
  return "";
}

function trechosDoConteudo(conteudo) {
  const trechos = [];
  const pilha = [];
  let ctm = IDENTIDADE;
  let tm = IDENTIDADE;
  let tlm = IDENTIDADE;
  let operandos = [];
  let lista = null;

  const mostrar = (partes) => {
    const texto = partes
      .filter((parte) => typeof parte === "string")
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
    if (/^[<(/]/.test(token) || /^[-+.\d]/.test(token)) {
      const valor = /^[<(/]/.test(token) ? token : Number.parseFloat(token);
      if (lista) lista.push(valor);
      else operandos.push(valor);
      continue;
    }
    const numeros = operandos.filter((o) => typeof o === "number");
    switch (token) {
      case "q":
        pilha.push(ctm);
        break;
      case "Q":
        ctm = pilha.pop() ?? IDENTIDADE;
        break;
      case "cm":
        if (numeros.length >= 6) ctm = multiplicar(numeros.slice(-6), ctm);
        break;
      case "BT":
        tm = IDENTIDADE;
        tlm = IDENTIDADE;
        break;
      case "Tm":
        if (numeros.length >= 6) {
          tm = numeros.slice(-6);
          tlm = tm;
        }
        break;
      case "Td":
      case "TD":
        if (numeros.length >= 2) {
          tlm = multiplicar([1, 0, 0, 1, numeros[numeros.length - 2], numeros[numeros.length - 1]], tlm);
          tm = tlm;
        }
        break;
      case "Tj":
      case "'":
      case '"':
        mostrar(operandos.filter((o) => typeof o === "string"));
        break;
      case "TJ": {
        const partes = operandos.find((o) => Array.isArray(o));
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

function montarLinhas(trechos) {
  const linhas = [];
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

/** PDF → texto de cada página (uma linha do papel por linha) e `MediaBox`. */
export function lerPdf(arquivo) {
  const bytes = Buffer.from(arquivo);
  const objetos = lerObjetos(bytes);
  const catalogo = [...objetos.values()].find((objeto) => /\/Type\s*\/Catalog/.test(objeto.dicionario));
  const raiz = catalogo ? referencia(catalogo.dicionario, "Pages") : null;
  const arvore = raiz !== null ? objetos.get(raiz) : undefined;
  const filhos = arvore ? (/\/Kids\s*\[([^\]]*)\]/.exec(arvore.dicionario)?.[1] ?? "") : "";
  const idsPaginas = [...filhos.matchAll(/(\d+) 0 R/g)].map((m) => Number.parseInt(m[1], 10));

  const paginas = [];
  const folhas = [];
  for (const id of idsPaginas) {
    const pagina = objetos.get(id);
    if (!pagina) continue;
    folhas.push(/\/MediaBox\s*\[([^\]]*)\]/.exec(pagina.dicionario)?.[1]?.trim() ?? "");
    const conteudo = referencia(pagina.dicionario, "Contents");
    const fluxo = conteudo !== null ? objetos.get(conteudo) : undefined;
    paginas.push(fluxo ? montarLinhas(trechosDoConteudo(conteudoDe(fluxo))) : "");
  }
  return { paginas, folhas };
}
