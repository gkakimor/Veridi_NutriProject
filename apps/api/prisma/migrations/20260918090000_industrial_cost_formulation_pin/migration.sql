-- Rascunho de estrutura de custos segue a formulação ativa.
--
-- Congelar a receita protege compromisso — orçamento enviado, OP liberada.
-- Enquanto o produto está sendo definido não existe compromisso a proteger, e
-- o congelamento vira atrito: a receita mudava, o rascunho ficava para trás e
-- o CMV mostrava o retrato de outro dia.
--
-- Reapontar não perde nada digitado: a lista de materiais é reflexo puro da
-- formulação (não existe override por material na estrutura). O que o usuário
-- digita — premissas adicionais, recursos, energia, base de produção — não vem
-- da formulação e não é tocado.
--
-- A coluna existe para o caso contrário: quando ele escolheu explicitamente
-- outra versão, seguir sozinho sobrescreveria essa decisão.
ALTER TABLE "industrial_cost_versions"
  ADD COLUMN IF NOT EXISTS "formulationPinned" BOOLEAN NOT NULL DEFAULT false;
