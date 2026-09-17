/**
 * Nome de cadastro mestre: identidade de catálogo
 * (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * Decisão do PO (2026-09-17): em todo cadastro mestre, "ABC", "Abc" e "abc"
 * são o MESMO nome. O sistema não aceita dois cadastros que só diferem pela
 * caixa das letras.
 *
 * A comparação é `trim` + sem caixa. **Acento é preservado**: `ACIDO` e
 * `ÁCIDO` continuam sendo nomes diferentes, e fundi-los é decisão de gente,
 * não da regra.
 *
 * A autoridade da comparação é o banco — `upper(btrim(<coluna>))`, a mesma
 * expressão que o guarda da API usa no SELECT e que o índice único de
 * MASTER-DATA-NAME-UNIQUENESS-01 vai usar. `nomeDeCadastroNormalizado` é o
 * espelho dessa expressão em JavaScript, para mensagem, teste e ferramenta de
 * manutenção; quando os dois discordarem em algum caractere exótico, quem
 * vale é o banco.
 */

/** Cadastro mestre com nome como identidade de catálogo. */
export type CadastroMestre =
  | "ITEM"
  | "CUSTOMER"
  | "SUPPLIER"
  | "PRODUCT"
  | "INDUSTRIAL_RESOURCE"
  | "FORMULATION_TEMPLATE"
  | "INDUSTRIAL_COST_TEMPLATE"
  | "PRICING_POLICY_TEMPLATE"
  | "PRODUCTION_PROFILE";

/** Como cada cadastro se chama na tela — entra na mensagem de recusa. */
export const ROTULO_DO_CADASTRO_MESTRE: Record<CadastroMestre, string> = {
  ITEM: "Item",
  CUSTOMER: "Cliente",
  SUPPLIER: "Fornecedor",
  PRODUCT: "Produto",
  INDUSTRIAL_RESOURCE: "Recurso industrial",
  FORMULATION_TEMPLATE: "Modelo de formulação",
  INDUSTRIAL_COST_TEMPLATE: "Modelo de custo industrial",
  PRICING_POLICY_TEMPLATE: "Modelo de política de preço",
  PRODUCTION_PROFILE: "Perfil de produção",
};

export const CADASTROS_MESTRE: readonly CadastroMestre[] = Object.keys(
  ROTULO_DO_CADASTRO_MESTRE,
) as CadastroMestre[];

/**
 * A chave de duplicidade: sem espaço nas pontas e sem caixa.
 *
 * Espelho de `upper(btrim(<coluna>))`. Não tira acento, não junta espaço
 * interno e não remove pontuação — a regra do PO é o mínimo (`trim` +
 * caixa), e ampliar sozinho funde cadastro que ninguém mandou fundir.
 */
export function nomeDeCadastroNormalizado(nome: string): string {
  return nome.trim().toUpperCase();
}

/** Dois nomes de cadastro colidem? */
export function nomesDeCadastroIguais(um: string, outro: string): boolean {
  return nomeDeCadastroNormalizado(um) === nomeDeCadastroNormalizado(outro);
}

/**
 * A frase que a pessoa lê quando o nome já existe.
 *
 * Com o código do cadastro existente quando ele é conhecido: quem digitou
 * "Goma xantana" precisa saber que o MP-000458 é o que já está lá, senão
 * procura o nome na lista e não acha (a caixa é diferente).
 */
export function mensagemDeNomeDuplicado(
  cadastro: CadastroMestre,
  codigoExistente?: string | null,
): string {
  const rotulo = ROTULO_DO_CADASTRO_MESTRE[cadastro];
  return codigoExistente
    ? `Já existe um cadastro com este nome: ${rotulo} ${codigoExistente}.`
    : "Já existe um cadastro com este nome.";
}
