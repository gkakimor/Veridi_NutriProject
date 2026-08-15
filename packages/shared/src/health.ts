/** Contrato da rota `GET /health`, consumido pelo frontend. */

export type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  status: HealthStatus;
  /** Resultado da checagem API -> Prisma -> PostgreSQL. */
  database: "up" | "down";
  /** Momento da checagem, em ISO-8601 UTC. */
  checkedAt: string;
}
