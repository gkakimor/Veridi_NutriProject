import { z } from "zod";
import { hojeComercial, limitesDoDiaComercial } from "@veridi/shared";
import { diaCivilDeFiltroSchema } from "../../lib/date-schema.js";

/**
 * Período do Dashboard — dois DIAS (`YYYY-MM-DD`), nunca instantes: o mesmo
 * contrato das listas e dos Relatórios (DASHBOARD-BUSINESS-DATE-01).
 *
 * A tela mandava os limites já em ISO, montados no navegador, e o servidor os
 * usava como vinham. Agora o dia viaja como a pessoa o escolheu e vira
 * instante UMA vez, aqui, no fuso da operação: `from` é o começo do dia
 * comercial e `to` o fim dele, inclusive — a mesma janela `gte`/`lte` que o
 * serviço sempre leu. Instante ISO é recusado em vez de reinterpretado.
 *
 * Ponta ausente ou vazia é "hoje", e "hoje" é o dia civil da Veridi em
 * `America/Sao_Paulo` — não o dia do relógio da máquina. Em Railway o servidor
 * roda em UTC, e o KPI do dia passava a começar às 21h da véspera.
 */
export const dashboardQuerySchema = z
  .object({
    from: diaCivilDeFiltroSchema,
    to: diaCivilDeFiltroSchema,
  })
  .transform((value) => {
    const hoje = hojeComercial();
    return {
      from: limitesDoDiaComercial(value.from ?? hoje).inicio,
      to: limitesDoDiaComercial(value.to ?? hoje).fim,
    };
  });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
