-- Duas correções vindas do primeiro caso real ponta a ponta (VAL-LEG-01).
--
-- 1. CONSUMO ALÉM DA RESERVA
--
-- A reserva protege estoque, e continua protegendo: nada aqui permite que
-- um consumo maior que o reservado sirva-se sozinho do saldo livre. O que
-- passa a existir é o registro de uma AMPLIAÇÃO EXPLÍCITA — uma linha de
-- reserva nova, com motivo e autor, que só então habilita o consumo.
--
-- Por isso os campos moram na própria linha de reserva: uma linha com
-- `extra_reason` preenchido é uma ampliação, e a linha original permanece
-- intacta ao lado dela. Planejado, reservado originalmente, ampliação e
-- consumido real ficam todos legíveis na mesma tabela, sem que nenhum
-- deles sobrescreva o outro.
--
-- 2. PREÇO DO FATURAMENTO
--
-- `unit_price` já existia e continua sendo o preço EFETIVAMENTE FATURADO.
-- O que faltava era o outro lado: quanto foi acordado no Pedido. Sem esse
-- par, um preço faturado divergente é indistinguível de um preço acordado
-- — e foi exatamente o que aconteceu no VAL-LEG-01, onde o operador
-- redigitou à mão um valor que o sistema já conhecia.
--
-- `agreed_unit_price` é snapshot: cópia congelada de
-- CustomerOrderLine.agreedUnitPrice no instante da criação do Faturamento.
-- Precificação nova, CALC novo ou negociação futura não o reescrevem.
--
-- Tudo aditivo e anulável. Faturamentos e reservas existentes seguem
-- válidos com os campos nulos; nenhum backfill, porque não há como
-- inventar retroativamente o motivo de uma ampliação que nunca existiu
-- nem afirmar que um preço digitado à mão era o acordado.

-- ── 1. Ampliação explícita de reserva ────────────────────────────────────
ALTER TABLE "material_reservation_lines"
  ADD COLUMN "extraReason"       TEXT,
  ADD COLUMN "extraRequestedBy" TEXT,
  ADD COLUMN "extraRequestedAt" TIMESTAMP(3);

-- Motivo é obrigatório para uma ampliação e não existe fora dela: os três
-- campos andam juntos ou nenhum deles existe.
ALTER TABLE "material_reservation_lines"
  ADD CONSTRAINT "material_reservation_lines_extra_complete"
  CHECK (
    ("extraReason" IS NULL AND "extraRequestedAt" IS NULL)
    OR ("extraReason" IS NOT NULL AND "extraRequestedAt" IS NOT NULL)
  );

-- ── 2. Preço acordado × preço faturado ───────────────────────────────────
ALTER TABLE "billing_lines"
  ADD COLUMN "agreedUnitPrice" DECIMAL(14,4),
  ADD COLUMN "priceOverridden"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overrideReason"   TEXT,
  ADD COLUMN "overriddenBy"     TEXT,
  ADD COLUMN "overriddenAt"     TIMESTAMP(3);

-- Um override sem justificativa e sem data é indistinguível de um preço
-- simplesmente informado — o banco recusa esse estado.
ALTER TABLE "billing_lines"
  ADD CONSTRAINT "billing_lines_override_complete"
  CHECK (
    "priceOverridden" = false
    OR ("overrideReason" IS NOT NULL AND "overriddenAt" IS NOT NULL)
  );
