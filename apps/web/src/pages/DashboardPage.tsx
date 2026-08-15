import { useEffect, useState } from "react";
import type { HealthResponse } from "@veridi/shared";
import { API_URL, fetchHealth } from "../lib/api";

type Probe =
  | { state: "loading" }
  | { state: "ok"; health: HealthResponse }
  | { state: "error"; message: string };

/**
 * Dashboard — bootstrap.
 *
 * Ainda nao e o dashboard operacional. Mostra apenas o estado real da
 * fundacao (API e PostgreSQL). Graficos e indicadores entram quando os
 * fluxos de compras/estoque/producao existirem.
 */
export function DashboardPage() {
  const [probe, setProbe] = useState<Probe>({ state: "loading" });

  useEffect(() => {
    let active = true;

    fetchHealth()
      .then((health) => {
        if (active) setProbe({ state: "ok", health });
      })
      .catch((error: unknown) => {
        if (active) {
          setProbe({
            state: "error",
            message:
              error instanceof Error ? error.message : "Falha desconhecida",
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Dashboard</h1>
          <p className="page__subtitle">
            Fundação do MVP. Os módulos operacionais entram por handoff.
          </p>
        </div>
      </div>

      <section className="card">
        <h2 className="card__title">Estado da fundação</h2>
        {probe.state === "loading" && (
          <p className="muted">Consultando a API…</p>
        )}

        {probe.state === "error" && (
          <>
            <p className="status-line">
              <span
                className="status-dot status-dot--down"
                aria-hidden="true"
              />
              API inacessível
            </p>
            <p className="muted">
              {probe.message} — verifique se a API está rodando em {API_URL}.
            </p>
          </>
        )}

        {probe.state === "ok" && (
          <dl className="definition-list">
            <dt>API</dt>
            <dd className="status-line">
              <span className="status-dot status-dot--up" aria-hidden="true" />
              respondendo
            </dd>

            <dt>PostgreSQL (via Prisma)</dt>
            <dd className="status-line">
              <span
                className={
                  probe.health.database === "up"
                    ? "status-dot status-dot--up"
                    : "status-dot status-dot--down"
                }
                aria-hidden="true"
              />
              {probe.health.database === "up" ? "conectado" : "sem conexão"}
            </dd>

            <dt>Verificado em</dt>
            <dd>{new Date(probe.health.checkedAt).toLocaleString("pt-BR")}</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Próximo passo</h2>
        <p className="muted">
          Cadastro de Itens — primeiro slice vertical do Bloco A.
        </p>
      </section>
    </>
  );
}
