import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./reports.css";

interface ReportLink {
  code: string;
  label: string;
  hint: string;
  path: string;
  /**
   * Como a Veridi chama esse relatório no dia a dia (o vocabulário da
   * planilha). É apelido de EXIBIÇÃO e de busca: o código oficial R-xx e o
   * endpoint continuam intactos.
   */
  aliases?: string[];
}

/**
 * Catálogo dos relatórios (R-01…R-17), agrupado por domínio. Cada relatório
 * é uma consulta somente leitura sobre as entidades operacionais — nenhum
 * deles é fonte de verdade.
 */
const GROUPS: { title: string; reports: ReportLink[] }[] = [
  {
    title: "Estoque",
    reports: [
      {
        code: "R-01",
        aliases: ["Posição de estoque", "Saldo", "Estoque atual"],
        label: "Posição de Estoque",
        hint: "Saldo atual por item e lote (Físico / Reservado / Disponível).",
        path: "/relatorios/estoque/posicao",
      },
      {
        code: "R-02",
        aliases: ["Validade", "Vencimento de lote"],
        label: "Vencimentos",
        hint: "Lotes vencidos e vencendo, com saldo.",
        path: "/relatorios/estoque/vencimentos",
      },
      {
        code: "R-03",
        aliases: ["Kardex", "Entradas e saídas", "Extrato de estoque"],
        label: "Movimentações",
        hint: "Histórico de entradas e saídas com documento de origem.",
        path: "/relatorios/estoque/movimentacoes",
      },
    ],
  },
  {
    title: "Produção",
    reports: [
      {
        code: "R-04",
        aliases: ["Necessidade p/ produção", "Falta de material", "Shortage"],
        label: "Necessidade / Falta para OP",
        hint: "Material necessário, disponível e faltante por Ordem de Produção.",
        path: "/relatorios/producao/necessidades",
      },
      {
        code: "R-05",
        aliases: ["Rendimento", "Produção realizada"],
        label: "Planejado x Realizado",
        hint: "Quantidade planejada, produzida, variação e rendimento.",
        path: "/relatorios/producao/planejado-realizado",
      },
      {
        code: "R-06",
        aliases: ["Rastreabilidade da OP", "Genealogia"],
        label: "Rastreabilidade por OP",
        hint: "Materiais realmente consumidos e produto acabado produzido.",
        path: "/relatorios/producao/rastreabilidade",
      },
      {
        code: "R-07",
        aliases: ["Consumo de materiais", "Baixa de estoque"],
        label: "Consumo por período",
        hint: "Consumo real de materiais, com custo e origem do custo.",
        path: "/relatorios/producao/consumo",
      },
    ],
  },
  {
    title: "Compras",
    reports: [
      {
        code: "R-08",
        aliases: ["Compras", "OCs"],
        label: "Ordens de Compra",
        hint: "Documentos por período, status e origem.",
        path: "/relatorios/compras/ordens",
      },
      {
        code: "R-09",
        aliases: ["Entradas", "Notas recebidas"],
        label: "Recebimentos",
        hint: "Recebido por linha, com lote, preço da OC e custo efetivo.",
        path: "/relatorios/compras/recebimentos",
      },
      {
        code: "R-10",
        aliases: ["Pedido em aberto ao fornecedor", "A receber"],
        label: "Em Compra",
        hint: "Quantidade ainda aberta em ordens confirmadas.",
        path: "/relatorios/compras/em-compra",
      },
      {
        code: "R-11",
        aliases: ["Atraso de fornecedor"],
        label: "OCs atrasadas",
        hint: "Previsão de entrega vencida com saldo em aberto.",
        path: "/relatorios/compras/atrasadas",
      },
    ],
  },
  {
    title: "Comercial",
    reports: [
      {
        code: "R-12",
        aliases: ["Vendas", "Carteira de pedidos"],
        label: "Pedidos do Cliente",
        hint: "Pedidos por período, com status operacional e de faturamento.",
        path: "/relatorios/comercial/pedidos",
      },
      {
        code: "R-13",
        aliases: ["Carteira", "Status de atendimento"],
        label: "Atendimento dos Pedidos",
        hint: "Pedido, reservado, produzido, expedido e faturado por produto.",
        path: "/relatorios/comercial/atendimento",
      },
      {
        code: "R-14",
        aliases: ["Do pedido à entrega", "Cadeia do pedido"],
        label: "Pedido → Operação",
        hint: "Cadeia completa de um pedido: reserva, OP, OC, expedição e faturamento.",
        path: "/relatorios/comercial/pedido-operacao",
      },
    ],
  },
  {
    title: "Faturamento",
    reports: [
      {
        code: "R-15",
        aliases: ["Faturamento", "Notas emitidas"],
        label: "Faturamento por período",
        hint: "Documentos emitidos, com valor quando a precificação está completa.",
        path: "/relatorios/faturamento/periodo",
      },
      {
        code: "R-16",
        aliases: ["A faturar", "Pendente de nota"],
        label: "Aguardando faturamento",
        hint: "Expedições confirmadas ainda sem faturamento emitido.",
        path: "/relatorios/faturamento/pendentes",
      },
      {
        code: "R-17",
        aliases: ["Pedido x entregue x faturado", "Conferência comercial"],
        label: "Pedido x Entregue x Faturado",
        hint: "Diferença entre o pedido, o que saiu e o que foi faturado.",
        path: "/relatorios/faturamento/pedido-entregue-faturado",
      },
    ],
  },
  {
    title: "Gestão industrial",
    reports: [
      {
        code: "R-18",
        aliases: ["Custo industrial", "Custo por produto", "CMV"],
        label: "Custo industrial por produto",
        hint: "Último cálculo de custo salvo por produto, com qualidade e custo por unidade.",
        path: "/relatorios/custos/industrial-por-produto",
      },
    ],
  },
];

/** Busca client-side: 17 relatórios não justificam índice no backend. */
function matches(report: ReportLink, term: string): boolean {
  if (!term) return true;
  const haystack = [report.code, report.label, report.hint, ...(report.aliases ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

export function ReportsHubPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const term = search.trim().toLowerCase();
  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        reports: group.reports.filter((report) => matches(report, term)),
      })).filter((group) => group.reports.length > 0),
    [term],
  );

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Relatórios</h1>
          <p className="page__subtitle">
            Consultas operacionais somente leitura — todos os números vêm dos documentos, nada é
            armazenado aqui.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="reports-search">
            Buscar relatório
          </label>
          <input
            id="reports-search"
            type="search"
            placeholder="Buscar por código, nome ou apelido (ex.: R-03, Kardex, falta de material)…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="report-hub">
        {groups.map((group) => (
          <section key={group.title} className="report-hub__group">
            <h2>{group.title}</h2>
            {group.reports.map((report) => (
              <button
                key={report.code}
                type="button"
                className="report-hub__item"
                onClick={() => navigate(report.path)}
              >
                <b>{report.code}</b>
                {report.label}
                <span>{report.hint}</span>
                {/* Apelido do dia a dia — nunca substitui o código oficial. */}
                {report.aliases && report.aliases.length > 0 && (
                  <span className="report-hub__aliases">{report.aliases.join(" · ")}</span>
                )}
              </button>
            ))}
          </section>
        ))}

        {groups.length === 0 && (
          <p className="muted">Nenhum relatório corresponde à busca.</p>
        )}
      </div>
    </>
  );
}
