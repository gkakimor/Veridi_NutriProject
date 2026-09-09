import type { HelpTopicV2 } from "../help-content";
import { alterarPrecoFaturamento } from "./comercial/alterar-preco-faturamento";
import { expedicao } from "./comercial/expedicao";
import { faturamento } from "./comercial/faturamento";
import { orcamento } from "./comercial/orcamento";
import { pedido } from "./comercial/pedido";
import { reservarProdutoAcabado } from "./comercial/reservar-produto-acabado";
import { estruturaCustos } from "./gestao/estrutura-custos";
import { precificacao } from "./gestao/precificacao";
import { formulacaoVersao } from "./producao/formulacao-versao";
import { ordemProducao } from "./producao/ordem-producao";
import { loteQualidade } from "./suprimentos/lote-qualidade";
import { receberOc } from "./suprimentos/receber-oc";

/**
 * Os tópicos escritos no modelo V2 — um arquivo por tela.
 *
 * A organização nova convive com a antiga de propósito. Os arquivos por
 * módulo (`content/base.ts`, `content/comercial.ts` e os outros) continuam
 * guardando os tópicos ainda em V1; migrar os quarenta e oito de uma vez
 * produziria um diff que ninguém revisa, e a auditoria pede o contrário —
 * revisão por tela, por quem conhece a operação daquela tela.
 *
 * O registro final (`help-content.ts`) junta os dois. Uma tela não sabe em
 * qual modelo o tópico dela está escrito, e não precisa saber.
 *
 * Os doze aqui são os P0 da auditoria: as telas onde a pessoa decide preço,
 * compromete estoque ou faz algo que não tem volta.
 */
export const topicosV2 = {
  /* Comercial — onde o preço é decidido e o pedido é atendido. */
  "comercial.orcamento": orcamento,
  "comercial.pedido": pedido,
  "comercial.reservarProdutoAcabado": reservarProdutoAcabado,
  "comercial.expedicao": expedicao,
  "faturamento.comoFunciona": faturamento,
  "faturamento.alterarPreco": alterarPrecoFaturamento,

  /* Produção — a receita e a execução. */
  "formulacao.comoFunciona": formulacaoVersao,
  "ordemProducao.comoFunciona": ordemProducao,

  /* Gestão — a cadeia de custo e preço. */
  "estruturaCusto.comoFunciona": estruturaCustos,
  "precificacao.comoFunciona": precificacao,

  /* Suprimentos e Qualidade — a entrada do material e a liberação. */
  "compras.recebimentos": receberOc,
  "estoque.lotes": loteQualidade,
} satisfies Record<string, HelpTopicV2>;

/** As chaves dos tópicos já migrados. Usada pelos testes editoriais. */
export type HelpTopicV2Id = keyof typeof topicosV2;
