import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";
import { PROJECT_STATUS_LABELS } from "@veridi/shared";
import { listProjects } from "../../lib/projects-api";
import { formatDate } from "../../lib/dates";
import { ConsultationTrail, consultationPath, useConsultationContext } from "./ConsultationShell";
import { ConsultationCount, ConsultationPager } from "./ConsultationPager";
import { useScopedList } from "./useScopedList";

/**
 * Projetos DESTE Cliente.
 *
 * Reusa `GET /projects?customerId=` — o mesmo endpoint e o mesmo filtro da
 * tela operacional. Como o recorte é feito no servidor, esta lista não tem
 * como mostrar projeto de outro cliente.
 *
 * Clicar numa linha abre o detalhe consultivo DENTRO do shell: o cabeçalho
 * do Cliente continua na tela. Sair para o módulo é ação separada, dentro do
 * detalhe.
 */
export function ProjectsTab() {
  const { customerId } = useConsultationContext();
  const navigate = useNavigate();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      const result = await listProjects({ customerId, page, pageSize });
      return { rows: result.projects, total: result.total };
    },
    [customerId],
  );

  const list = useScopedList<ProjectDTO>(load, customerId);

  function open(project: ProjectDTO) {
    navigate(consultationPath(customerId, "projetos", project.id));
  }

  return (
    <>
      <ConsultationTrail steps={[{ label: "Projetos" }]} />

      {list.error && <p className="form-alert" role="alert">{list.error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">Projeto</th>
              <th className="col-flex">Produto</th>
              <th className="col-tight">Situação</th>
              <th className="col-tight">Entrada</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((project) => (
              <tr
                key={project.id}
                tabIndex={0}
                onClick={() => open(project)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(project);
                }}
              >
                <td className="is-code col-tight">{project.code}</td>
                <td className="col-flex">{project.name}</td>
                <td className="col-flex">{project.productName ?? "—"}</td>
                <td className="col-tight">
                  <span
                    className={
                      project.status === "APPROVED"
                        ? "badge badge--active"
                        : project.status === "CANCELLED"
                          ? "badge badge--err"
                          : "badge badge--neutral"
                    }
                  >
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                </td>
                <td className="col-tight">{formatDate(project.entryDate)}</td>
              </tr>
            ))}

            {!list.loading && list.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="table__empty">
                  Nenhum projeto encontrado para este cliente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <ConsultationCount list={list} noun="projeto" pluralNoun="projetos" />
      </div>

      <ConsultationPager list={list} />
    </>
  );
}
