import { Fragment } from "react";
import { Navigate, Route } from "react-router-dom";
import { ConsultationSearchPage } from "./ConsultationSearchPage";
import { ConsultationShell } from "./ConsultationShell";
import { SummaryTab } from "./SummaryTab";
import { ProjectsTab } from "./ProjectsTab";
import { ProjectPage } from "./ProjectPage";
import { OrdersTab } from "./OrdersTab";
import { OrderPage } from "./OrderPage";
import { MaterialsTab } from "./MaterialsTab";
import { BillingsTab } from "./BillingsTab";
import { BillingPage } from "./BillingPage";

/**
 * Rotas da Consulta do Cliente, em um lugar só.
 *
 * Ficam fora do `App.tsx` porque o teste de navegação precisa montar
 * exatamente esta árvore. Se ela vivesse só lá, o teste teria que copiá-la —
 * e uma cópia que envelhece sozinha prova a navegação de ontem.
 *
 * O `:customerId` na URL é o contexto da Consulta. É isso que faz refresh,
 * deep link, nova aba e back/forward funcionarem sem estado global, e o que
 * mantém os módulos operacionais sem nenhuma noção de "cliente atual".
 */
export const consultationRoutes = (
  <Fragment>
    <Route path="/consultas/clientes" element={<ConsultationSearchPage />} />
    <Route path="/consultas/clientes/:customerId" element={<ConsultationShell />}>
      <Route index element={<Navigate to="resumo" replace />} />
      <Route path="resumo" element={<SummaryTab />} />
      <Route path="projetos" element={<ProjectsTab />} />
      <Route path="projetos/:projectId" element={<ProjectPage />} />
      <Route path="pedidos" element={<OrdersTab />} />
      <Route path="pedidos/:orderId" element={<OrderPage />} />
      <Route path="materiais" element={<MaterialsTab />} />
      <Route path="faturamentos" element={<BillingsTab />} />
      <Route path="faturamentos/:billingId" element={<BillingPage />} />
    </Route>
  </Fragment>
);
