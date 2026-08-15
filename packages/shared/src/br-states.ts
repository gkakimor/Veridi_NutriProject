/** UFs brasileiras válidas — usado para validar o campo estado de Clientes. */
export const BR_STATE_CODES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type BrStateCode = (typeof BR_STATE_CODES)[number];
