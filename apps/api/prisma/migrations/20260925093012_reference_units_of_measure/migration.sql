-- Catálogo de referência de unidades de medida (FAST-DEVELOPMENT-RESET-02).
--
-- Até aqui o catálogo só existia onde alguém tinha rodado seed. Produção nunca
-- roda seed, então uma instalação nova nascia sem unidade nenhuma — e sem
-- unidade não se cadastra Item, nem Produto, nem nada depois deles. Não há
-- tela para unidade: ela é tabela de referência, e referência nasce com o
-- schema.
--
-- ON CONFLICT DO NOTHING: onde o catálogo já existe (DEV, produção), nada muda
-- — nem rótulo, nem fator. Fator de unidade em uso não se reescreve por
-- migration.
INSERT INTO "units_of_measure" ("code", "label", "dimension", "toBaseFactor") VALUES
  ('mg', 'Miligrama',  'MASS',   0.001),
  ('g',  'Grama',      'MASS',   1),
  ('kg', 'Quilograma', 'MASS',   1000),
  ('un', 'Unidade',    'COUNT',  1),
  ('mL', 'Mililitro',  'VOLUME', 0.001),
  ('L',  'Litro',      'VOLUME', 1)
ON CONFLICT ("code") DO NOTHING;
