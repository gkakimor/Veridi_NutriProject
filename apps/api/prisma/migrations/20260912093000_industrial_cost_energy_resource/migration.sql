-- Tarifa que valoriza o kWh derivado dos equipamentos. Escolha explícita:
-- decidir sozinho entre vários cadastros de energia seria inventar premissa.
ALTER TABLE "industrial_cost_versions"
  ADD COLUMN "energyResourceId" TEXT;

ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_energyResourceId_fkey"
  FOREIGN KEY ("energyResourceId") REFERENCES "industrial_resources"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
