import { useNavigate } from "react-router-dom";
import "./reports.css";

interface ReportLink {
  code: string;
  label: string;
  hint: string;
  path: string;
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
        label: "Posição de Estoque",
        hint: "Saldo atual por item e lote (On Hand / Reservado / Disponível).",
        path: "/relatorios/estoque/posicao",
      },
      {
        code: "R-02",
        label: "Vencimentos",
        hint: "Lotes vencidos e vencendo, com saldo.",
        path: "/relatorios/estoque/vencimentos",
      },
      {
        code: "R-03",
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
        label: "Necessidade / Falta para OP",
        hint: "Material necessário, disponível e faltante por Ordem de Produção.",
        path: "/relatorios/producao/necessidades",
      },
      {
        code: "R-05",
        label: "Planejado x Realizado",
        hint: "Quantidade planejada, produzida, variação e rendimento.",
        path: "/relatorios/producao/planejado-realizado",
      },
      {
        code: "R-06",
        label: "Rastreabilidade por OP",
        hint: "Materiais realmente consumidos e produto acabado produzido.",
        path: "/relatorios/producao/rastreabilidade",
      },
      {
        code: "R-07",
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
        label: "Ordens de Compra",
        hint: "Documentos por período, status e origem.",
        path: "/relatorios/compras/ordens",
      },
      {
        code: "R-09",
        label: "Recebimentos",
        hint: "Recebido por linha, com lote, preço da OC e custo efetivo.",
        path: "/relatorios/compras/recebimentos",
      },
      {
        code: "R-10",
        label: "Em Compra",
        hint: "Quantidade ainda aberta em ordens confirmadas.",
        path: "/relatorios/compras/em-compra",
      },
      {
        code: "R-11",
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
        label: "Pedidos do Cliente",
        hint: "Pedidos por período, com status operacional e de faturamento.",
        path: "/relatorios/comercial/pedidos",
      },
      {
        code: "R-13",
        label: "Atendimento dos Pedidos",
        hint: "Pedido, reservado, produzido, expedido e faturado por produto.",
        path: "/relatorios/comercial/atendimento",
      },
      {
        code: "R-14",
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
        label: "Faturamento por período",
        hint: "Documentos emitidos, com valor quando a precificação está completa.",
        path: "/relatorios/faturamento/periodo",
      },
      {
        code: "R-16",
        label: "Aguardando faturamento",
        hint: "Expedições confirmadas ainda sem faturamento emitido.",
        path: "/relatorios/faturamento/pendentes",
      },
      {
        code: "R-17",
        label: "Pedido x Entregue x Faturado",
        hint: "Diferença entre o pedido, o que saiu e o que foi faturado.",
        path: "/relatorios/faturamento/pedido-entregue-faturado",
      },
    ],
  },
];

export function ReportsHubPage() {
  const navigate = useNavigate();

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

      <div className="report-hub">
        {GROUPS.map((group) => (
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
              </button>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
