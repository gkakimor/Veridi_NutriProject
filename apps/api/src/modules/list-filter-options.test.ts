import { describe, expect, it } from "vitest";
import {
  CUSTOMER_ORDER_STATUS_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
} from "@veridi/shared";
import { buildTestApp } from "../test-support/authenticated-app.js";

/**
 * Todo valor que a tela OFERECE, a consulta ACEITA.
 *
 * Dois filtros renderizavam o enum inteiro do domínio enquanto o schema de
 * consulta listava um subconjunto escrito à mão. Escolher uma das opções
 * ausentes devolvia `400`, e a tela mantinha a tabela anterior com o
 * contador intacto: o operador lia um resultado que não correspondia ao
 * filtro selecionado. Em Movimentações, as cinco opções quebradas eram
 * justamente as de auditoria — consumo de produção, saída de expedição,
 * entrada de produção, consumo de amostra e saldo de abertura.
 *
 * O teste é escrito sobre os MAPAS DE RÓTULO porque é deles que a tela monta
 * o `<select>`. Amarrar a asserção à mesma fonte que a interface usa é o que
 * faz um estado novo do domínio quebrar o teste em vez de quebrar o filtro
 * em produção — se alguém acrescentar um rótulo sem acrescentar o valor ao
 * schema, isto falha antes de chegar ao operador.
 */

const FILTROS = [
  {
    nome: "Movimentações · tipo",
    rota: "/inventory-movements",
    campo: "type",
    opcoes: Object.keys(INVENTORY_MOVEMENT_TYPE_LABELS),
  },
  {
    nome: "Pedidos · status",
    rota: "/customer-orders",
    campo: "status",
    opcoes: Object.keys(CUSTOMER_ORDER_STATUS_LABELS),
  },
] as const;

describe("Filtro de lista não oferece opção que a consulta recusa", () => {
  for (const filtro of FILTROS) {
    it(`${filtro.nome}: as ${filtro.opcoes.length} opções da tela são aceitas`, async () => {
      const app = buildTestApp();
      await app.ready();

      const recusadas: string[] = [];
      for (const opcao of filtro.opcoes) {
        const resposta = await app.inject({
          method: "GET",
          url: `${filtro.rota}?${filtro.campo}=${opcao}&pageSize=1`,
        });
        if (resposta.statusCode !== 200) recusadas.push(`${opcao}=${resposta.statusCode}`);
      }

      expect(recusadas).toEqual([]);
      await app.close();
    });

    it(`${filtro.nome}: valor inventado continua sendo recusado`, async () => {
      const app = buildTestApp();
      await app.ready();

      const resposta = await app.inject({
        method: "GET",
        url: `${filtro.rota}?${filtro.campo}=NAO_EXISTE_NO_DOMINIO&pageSize=1`,
      });

      // Aceitar tudo seria a correção preguiçosa: o filtro deixaria de
      // validar e um erro de digitação viraria uma lista silenciosamente
      // completa em vez de um erro.
      expect(resposta.statusCode).toBe(400);
      await app.close();
    });
  }
});
