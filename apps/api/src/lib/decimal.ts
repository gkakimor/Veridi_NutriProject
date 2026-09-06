import { Prisma } from "@prisma/client";
import { configurarDecimal } from "@veridi/shared";

/**
 * O `Prisma.Decimal` desta aplicação, na precisão canônica.
 *
 * `Prisma.Decimal` **não é** o `Decimal` de `decimal.js`. O Prisma empacota a
 * própria cópia da biblioteca, e os dois construtores têm configuração
 * independente: `Prisma.Decimal !== Decimal`, e `Decimal.set()` num não alcança
 * o outro. Como quase todo o cálculo de domínio de `apps/api` roda em
 * `Prisma.Decimal`, configurar só o pacote compartilhado deixaria a API inteira
 * em 20 dígitos — as "duas configurações divergentes" que
 * `PRODUCT_RULES.md` §59 proíbe.
 *
 * A configuração acontece no import deste módulo, e `Prisma.Decimal` é um
 * singleton: configurá-lo aqui configura todo `new Prisma.Decimal(...)` do
 * processo, inclusive os arquivos que continuam importando `Prisma` direto.
 * Este módulo é importado por `db/prisma.ts` e por `app.ts` — os dois pontos
 * por onde qualquer caminho de execução da API passa — e pelos módulos de
 * cálculo que dividem, para que a garantia não dependa de ordem de import.
 */

configurarDecimal(Prisma.Decimal);

/** O construtor canônico da API. Prefira este a `Prisma.Decimal` em cálculo. */
export const Decimal = Prisma.Decimal;

export type Decimal = Prisma.Decimal;
