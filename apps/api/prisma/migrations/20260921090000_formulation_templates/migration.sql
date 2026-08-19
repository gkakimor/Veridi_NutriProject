-- Biblioteca técnica de Formulações: matrizes reutilizáveis entre clientes.
--
-- Usar um template COPIA os dados para uma FormulationVersion do Produto. Não
-- existe vínculo vivo: o template pode ganhar V4 e a formulação copiada da V3
-- continua sendo o que era. A alternativa — vários produtos apontando para a
-- mesma formulação — reescreveria a receita de um cliente quando outro pedisse
-- mudança, e ninguém descobriria antes da produção.
--
-- Tudo aditivo. Formulações existentes seguem válidas com origem nula; nenhum
-- backfill, nenhum template criado automaticamente a partir do corpus atual.

CREATE TYPE "FormulationTemplateVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE SEQUENCE "formulation_template_code_seq" START 1;

CREATE TABLE "formulation_templates" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "archivedAt"  TIMESTAMP(3),
  "archivedBy"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"   TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "formulation_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formulation_templates_code_key" ON "formulation_templates"("code");
CREATE INDEX "formulation_templates_name_idx" ON "formulation_templates"("name");

CREATE TABLE "formulation_template_versions" (
  "id"                    TEXT NOT NULL,
  "formulationTemplateId" TEXT NOT NULL,
  "versionNumber"         INTEGER NOT NULL,
  "status"                "FormulationTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "basisQuantity"         DECIMAL(18,6) NOT NULL,
  "calculationMode"       "FormulationCalculationMode" NOT NULL DEFAULT 'FIXED_BASIS',
  "dosesPerPackage"       INTEGER,
  "outputUnitCode"        TEXT NOT NULL,
  "notes"                 TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"             TEXT,
  "activatedAt"           TIMESTAMP(3),
  "activatedBy"           TEXT,
  "archivedAt"            TIMESTAMP(3),
  "archivedBy"            TEXT,
  "sourceVersionId"       TEXT,
  "sourceVersionNumber"   INTEGER,
  CONSTRAINT "formulation_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formulation_template_versions_templateId_versionNumber_key"
  ON "formulation_template_versions"("formulationTemplateId", "versionNumber");
CREATE INDEX "formulation_template_versions_templateId_idx"
  ON "formulation_template_versions"("formulationTemplateId");
CREATE INDEX "formulation_template_versions_status_idx"
  ON "formulation_template_versions"("status");

-- UMA versão ativa por template, garantido pelo banco e não só pelo serviço.
-- Índice único PARCIAL: DRAFT e ARCHIVED podem coexistir à vontade.
CREATE UNIQUE INDEX "formulation_template_versions_one_active_per_template"
  ON "formulation_template_versions"("formulationTemplateId")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "formulation_template_components" (
  "id"                           TEXT NOT NULL,
  "formulationTemplateVersionId" TEXT NOT NULL,
  "itemId"                       TEXT NOT NULL,
  "quantity"                     DECIMAL(18,6) NOT NULL,
  "unitCode"                     TEXT NOT NULL,
  "basis"                        "FormulationComponentBasis" NOT NULL DEFAULT 'FIXED_BASIS',
  "supplyResponsibility"         "SupplyResponsibility" NOT NULL DEFAULT 'VERIDI',
  "purityPercentApplied"         DECIMAL(6,3),
  "overagePercent"               DECIMAL(6,3),
  "notes"                        TEXT,
  "position"                     INTEGER NOT NULL,
  "createdAt"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "formulation_template_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "formulation_template_components_versionId_itemId_key"
  ON "formulation_template_components"("formulationTemplateVersionId", "itemId");

ALTER TABLE "formulation_template_versions"
  ADD CONSTRAINT "formulation_template_versions_formulationTemplateId_fkey"
  FOREIGN KEY ("formulationTemplateId") REFERENCES "formulation_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formulation_template_versions"
  ADD CONSTRAINT "formulation_template_versions_outputUnitCode_fkey"
  FOREIGN KEY ("outputUnitCode") REFERENCES "units_of_measure"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "formulation_template_versions"
  ADD CONSTRAINT "formulation_template_versions_sourceVersionId_fkey"
  FOREIGN KEY ("sourceVersionId") REFERENCES "formulation_template_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "formulation_template_components"
  ADD CONSTRAINT "formulation_template_components_versionId_fkey"
  FOREIGN KEY ("formulationTemplateVersionId") REFERENCES "formulation_template_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "formulation_template_components"
  ADD CONSTRAINT "formulation_template_components_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Proveniência na formulação do Produto. SET NULL, e não CASCADE: arquivar ou
-- remover um template jamais pode apagar a formulação que nasceu dele. Código e
-- número ficam gravados para o rótulo sobreviver ao vínculo.
ALTER TABLE "formulation_versions"
  ADD COLUMN "originTemplateVersionId" TEXT,
  ADD COLUMN "originTemplateCode" TEXT,
  ADD COLUMN "originTemplateVersionNumber" INTEGER;

CREATE INDEX "formulation_versions_originTemplateVersionId_idx"
  ON "formulation_versions"("originTemplateVersionId");

ALTER TABLE "formulation_versions"
  ADD CONSTRAINT "formulation_versions_originTemplateVersionId_fkey"
  FOREIGN KEY ("originTemplateVersionId") REFERENCES "formulation_template_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
