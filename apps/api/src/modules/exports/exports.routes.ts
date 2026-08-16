import type { FastifyPluginAsync } from "fastify";
import type { ZodError } from "zod";
import type { CsvExportRoute } from "./csv-export.js";
import { listCsvExports } from "./list-exports.js";
import { reportCsvExports } from "./report-exports.js";

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Exportações CSV — sempre somente leitura e sempre sobre o MESMO read model
 * da tela correspondente, com os MESMOS filtros. A exportação nunca cria uma
 * fonte de verdade, nada é armazenado e não existe endpoint genérico que
 * receba nome de tabela/consulta: cada rota é declarada explicitamente.
 */
export const exportsRoutes: FastifyPluginAsync = async (app) => {
  const exports: CsvExportRoute[] = [...listCsvExports, ...reportCsvExports];

  for (const definition of exports) {
    app.get(definition.path, async (request, reply) => {
      const parsed = definition.schema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "validation_error", issues: formatZodError(parsed.error) });
      }

      const csv = await definition.build(parsed.data);
      const fileName = definition.fileName(parsed.data);

      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${fileName}"`)
        .send(csv);
    });
  }
};

/** Rotas registradas — usado nos testes para garantir cobertura. */
export const csvExportPaths: string[] = [...listCsvExports, ...reportCsvExports].map(
  (definition) => definition.path,
);
