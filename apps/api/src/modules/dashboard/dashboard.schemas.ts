import { z } from "zod";
import { hojeComercial, limitesDoDiaComercial, recusaDoPeriodoDoPainel } from "@veridi/shared";
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
 *
 * `agora` é o instante único da requisição (DASHBOARD-CONSISTENT-NOW-01): o
 * "hoje" da ponta ausente é o mesmo dia do estado atual e da lista de atenção,
 * e não uma segunda leitura do relógio feita no parse.
 *
 * Completada a ponta vazia, `from` depois de `to` é 400 — nunca 200 com KPIs
 * zerados (DASHBOARD-INVERTED-PERIOD-01): "De" vazio com "Até" no passado era
 * a janela invertida que a consulta lia como "nada aconteceu".
 */
export function dashboardQuerySchemaEm(agora: Date) {
  return z
    .object({
      from: diaCivilDeFiltroSchema,
      to: diaCivilDeFiltroSchema,
    })
    .transform((value, ctx) => {
      const hoje = hojeComercial(agora);
      const recusa = recusaDoPeriodoDoPainel(value.from, value.to, hoje);
      if (recusa) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [recusa.campo], message: recusa.mensagem });
        return z.NEVER;
      }
      return {
        from: limitesDoDiaComercial(value.from ?? hoje).inicio,
        to: limitesDoDiaComercial(value.to ?? hoje).fim,
      };
    });
}

export type DashboardQuery = z.output<ReturnType<typeof dashboardQuerySchemaEm>>;
