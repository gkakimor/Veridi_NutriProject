import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProjectDTO, ProjectStatus } from "@veridi/shared";
import { QUOTE_STATUS_LABELS } from "@veridi/shared";
import { createQuoteVersion } from "../../lib/projects-api";
import { entityHref } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatBRL } from "../../lib/currency";
import { rotaDoOrcamento } from "../../lib/rota-do-orcamento";
import { formatQuoteDate, quoteBadgeClass } from "./quote-display";

/**
 * Orçamentos do projeto — a lista das versões.
 *
 * Cada versão é um documento com página própria (`/comercial/orcamentos/:id`,
 * QUOTE-WORKSPACE-NAVIGATION-01). Antes esta seção listava e abria a versão
 * escolhida logo abaixo, dentro do Projeto: clicar em "ORC-000444 · V1"
 * trocava um bloco fora da vista, e parecia que nada tinha acontecido. Agora
 * clicar NAVEGA — a mudança de contexto se vê, o endereço é da versão, e a
 * página dela oferece a volta a este Projeto.
 *
 * Criar a próxima versão continua aqui: o servidor devolve o rascunho que já
 * existe ou cria o próximo — nunca dois rascunhos —, e a tela abre a página dele.
 */
export function QuoteVersionsSection({
  project,
  canEdit,
  projectStatus,
}: {
  project: ProjectDTO;
  canEdit: boolean;
  /** Só para explicar por que a ação sumiu — nunca para liberar a ação. */
  projectStatus?: ProjectStatus;
}) {
  const navigate = useNavigate();
  /*
   * Projeto APROVADO recebe negociação nova; cancelado, não.
   *
   * Aprovado significa que o desenvolvimento inicial foi aprovado — não que a
   * relação com o cliente acabou. Quem comprou em janeiro e volta em março
   * negocia no mesmo projeto, com os mesmos produtos. Cancelado continua
   * fechado, e a explicação toma o lugar do botão.
   */
  const projectOpen = projectStatus !== "CANCELLED";
  const podeCriar = canEdit && projectOpen;
  const versions = project.quoteVersions;
  const draft = versions.find((quote) => quote.status === "DRAFT") ?? null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** A página da versão, com a volta explícita para a ficha deste Projeto. */
  const paginaDaVersao = (quoteVersionId: string) =>
    rotaDoOrcamento(quoteVersionId, { voltar: entityHref("project", project.id) });

  const rotuloDoBotao = draft
    ? "Abrir rascunho"
    : projectStatus === "APPROVED"
      ? "Novo orçamento"
      : "Criar nova versão";

  /*
   * Quem resolve é o servidor: com rascunho aberto ele devolve o próprio
   * rascunho; sem rascunho, cria a próxima versão. A tela só abre o que voltou.
   */
  async function abrirProximaVersao() {
    setSaving(true);
    setError(null);
    try {
      const versao = await createQuoteVersion(project.id);
      navigate(paginaDaVersao(versao.id));
    } catch (err) {
      setError(apiErrorMessage(err, "Falha na operação"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSection
      title="Orçamentos"
      subtitle="Cada negociação é uma versão. Enviado congela o snapshot e vira histórico — que continua acessível."
    >
      {/*
        O Orçamento tem ajuda PRÓPRIA. Até aqui o único botão da ficha
        explicava o Projeto inteiro, e quem estava numa linha de proposta lia
        antes sobre produto técnico, amostra e documento.
      */}
      <ContextHelp
        topic={helpTopics["comercial.orcamento"]}
        triggerLabel="Como funciona o Orçamento"
      />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Versão</th>
              <th>Data</th>
              <th>Produtos</th>
              {/* Lista de versões = documentos gravados: o total aqui é o do
                  último salvamento, e o rótulo diz isso. */}
              <th className="is-numeric">Total salvo</th>
              <th>Validade</th>
              <th>Status</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 && (
              <TableEmptyRow colSpan={7}>
                {/* A frase só promete a ação que está na tela. */}
                {podeCriar
                  ? `Nenhum orçamento neste projeto — use “${rotuloDoBotao}” para montar a primeira proposta.`
                  : "Nenhum orçamento neste projeto."}
              </TableEmptyRow>
            )}
            {versions.map((quote) => (
              <tr
                key={quote.id}
                tabIndex={0}
                onClick={() => navigate(paginaDaVersao(quote.id))}
                onKeyDown={(event) => {
                  // Enter no "Abrir" já navega pelo próprio link: a linha não repete.
                  if (event.key === "Enter" && event.target === event.currentTarget) {
                    navigate(paginaDaVersao(quote.id));
                  }
                }}
              >
                <td className="is-code">{quote.versionLabel}</td>
                <td>{formatQuoteDate(quote.quoteDate)}</td>
                <td>{quote.lines.length}</td>
                <td className="is-numeric">{quote.total ? formatBRL(quote.total) : "—"}</td>
                <td>
                  {formatQuoteDate(quote.validUntil)}
                  {/* Vencida é estado derivado, dito pelo servidor. Sem isto a
                      linha some no meio das outras e alguém tenta aceitar. */}
                  {quote.expired && <span className="badge badge--warn"> Vencido</span>}
                </td>
                <td>
                  <span className={quoteBadgeClass(quote.status)}>
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </span>
                  {/* Com várias aceitas no mesmo projeto, o que diferencia uma
                      da outra é o Pedido que cada uma originou. */}
                  {quote.sourcedOrder && (
                    <span className="field__hint"> · originou {quote.sourcedOrder.code}</span>
                  )}
                </td>
                <td className="table__actions">
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={paginaDaVersao(quote.id)}
                    aria-label={`Abrir ${quote.versionLabel}`}
                    // A linha inteira também navega: sem isto o clique chegaria duas vezes.
                    onClick={(event) => event.stopPropagation()}
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="line-actions">
        {podeCriar && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={saving}
            onClick={() => void abrirProximaVersao()}
          >
            {rotuloDoBotao}
          </button>
        )}
      </div>

      {podeCriar && projectStatus === "APPROVED" && !draft && (
        <p className="field__hint">
          Cada nova compra deste cliente é um orçamento novo, aqui mesmo — os produtos aprovados
          deste projeto continuam disponíveis, e as propostas anteriores permanecem no histórico
          com os pedidos que originaram.
        </p>
      )}

      {canEdit && !projectOpen && (
        <p className="field__hint">Projeto cancelado é histórico e não recebe proposta nova.</p>
      )}
    </FormSection>
  );
}
