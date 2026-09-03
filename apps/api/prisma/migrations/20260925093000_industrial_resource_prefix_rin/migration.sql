-- Recurso Industrial deixa de usar o prefixo do Recebimento.
--
-- `REC` era usado pelos dois, com sequences separadas: as duas contagens
-- comecavam em 1, entao `REC-000001` nomeava um recebimento E um recurso
-- industrial ao mesmo tempo. O codigo e o identificador humano — o que se fala
-- e o que se digita na busca — e duplicado ele torna "confere o REC-000002"
-- uma frase ambigua.
--
-- Recebimento fica com `REC`, que e o mais antigo e o mais falado. Recurso
-- passa a `RIN`.
--
-- IDEMPOTENTE: so troca o prefixo de quem ainda o tem, e o resto da string
-- (a numeracao) e preservado byte a byte. Rodar duas vezes nao muda nada na
-- segunda. A sequence `industrial_resource_code_seq` NAO e tocada: a
-- numeracao continua de onde estava, e nenhum recebimento e renumerado.
--
-- Nao ha documento historico a reescrever: o schema congela
-- `resourceNameSnapshot` (o nome), nunca o codigo, que e sempre lido do
-- cadastro atual.

UPDATE "industrial_resources"
   SET "code" = 'RIN-' || substring("code" from 5)
 WHERE "code" LIKE 'REC-%';
