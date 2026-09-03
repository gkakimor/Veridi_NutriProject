import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as shared from "@veridi/shared";

/**
 * Prefixos de código de documento — contrato.
 *
 * O defeito que este arquivo impede já aconteceu: Recebimento e Recurso
 * Industrial usavam ambos `REC`, com sequences separadas. As duas contagens
 * começavam em 1, então `REC-000001` nomeava duas entidades diferentes ao
 * mesmo tempo, e ninguém percebeu por meses.
 *
 * Percebeu-se tarde por um motivo estrutural: quinze prefixos moravam em
 * `@veridi/shared`, onde a duplicata seria óbvia lado a lado, e um estava
 * cravado dentro de um serviço, longe dos outros. O segundo teste é o que
 * realmente protege — não basta os prefixos serem únicos hoje, eles precisam
 * continuar todos no mesmo lugar para que a unicidade seja verificável.
 */

const RAIZ_MODULOS = join(import.meta.dirname, "..", "modules");

function prefixosDoShared(): Record<string, string> {
  const encontrados: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(shared)) {
    if (nome.endsWith("_CODE_PREFIX") && typeof valor === "string") {
      encontrados[nome] = valor;
    }
  }
  return encontrados;
}

/** Percorre `src/modules` procurando prefixo declarado fora do pacote compartilhado. */
function prefixosCravadosNoServidor(): { arquivo: string; linha: string }[] {
  const achados: { arquivo: string; linha: string }[] = [];

  function visitar(diretorio: string) {
    for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
      const caminho = join(diretorio, entrada.name);
      if (entrada.isDirectory()) {
        visitar(caminho);
        continue;
      }
      if (!entrada.name.endsWith(".ts") || entrada.name.includes(".test.")) continue;

      const conteudo = readFileSync(caminho, "utf8");
      for (const linha of conteudo.split("\n")) {
        // `const ALGO_PREFIX = "XXX"` com string literal — declaração local.
        // Atribuir a partir de uma constante importada não casa, que é o
        // padrão correto e o que o serviço de recursos passou a fazer.
        if (/const\s+\w*(?:CODE_)?PREFIX\w*\s*(?::\s*string\s*)?=\s*["'][A-Z]{2,6}["']/.test(linha)) {
          achados.push({ arquivo: caminho.replace(RAIZ_MODULOS, "modules"), linha: linha.trim() });
        }
      }
    }
  }

  visitar(RAIZ_MODULOS);
  return achados;
}

describe("prefixos de código de documento", () => {
  it("nenhum prefixo canônico se repete", () => {
    const prefixos = prefixosDoShared();
    // Sanidade: se a coleta parar de achar prefixo, o teste vira decorativo.
    expect(Object.keys(prefixos).length).toBeGreaterThanOrEqual(15);

    const porValor = new Map<string, string[]>();
    for (const [nome, valor] of Object.entries(prefixos)) {
      porValor.set(valor, [...(porValor.get(valor) ?? []), nome]);
    }

    const duplicados = [...porValor.entries()]
      .filter(([, nomes]) => nomes.length > 1)
      .map(([valor, nomes]) => `${valor}: ${nomes.join(", ")}`);

    expect(duplicados).toEqual([]);
  });

  it("Recebimento e Recurso Industrial não voltam a colidir", () => {
    expect(shared.RECEIPT_CODE_PREFIX).toBe("REC");
    expect(shared.INDUSTRIAL_RESOURCE_CODE_PREFIX).toBe("RIN");
    expect(shared.RECEIPT_CODE_PREFIX).not.toBe(shared.INDUSTRIAL_RESOURCE_CODE_PREFIX);
  });

  it("nenhum prefixo fica cravado dentro de um serviço", () => {
    // Este é o teste que teria pegado a colisão original: ela existia porque
    // um prefixo estava fora do lugar onde os outros podiam ser comparados.
    expect(prefixosCravadosNoServidor()).toEqual([]);
  });
});
