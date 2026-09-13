import { afterAll } from "vitest";
import { exigirBancoDeTeste } from "./banco-de-teste.js";
import { descartarUsuariosDoArquivo } from "./usuarios-de-teste.js";

/**
 * `setupFiles` das faixas que escrevem em banco — as duas da API e a de scripts
 * da raiz: roda antes de CADA arquivo de teste, no worker que vai executá-lo.
 *
 * - Antes de o arquivo importar qualquer coisa que abra o banco, o destino é
 *   conferido de novo — no processo que de fato escreve (`banco-de-teste.ts`).
 * - O `afterAll` daqui é registrado antes dos do arquivo, e o Vitest desempilha
 *   hooks de fim na ordem inversa: roda por último, depois que o arquivo já
 *   limpou as fixtures dele, e tira os usuários e as sessões que o arquivo criou
 *   (`usuarios-de-teste.ts`). Roda também com teste falhando e com `beforeAll`
 *   quebrado.
 */

exigirBancoDeTeste(process.env["DATABASE_URL"], process.env);

afterAll(async () => {
  await descartarUsuariosDoArquivo();
});
