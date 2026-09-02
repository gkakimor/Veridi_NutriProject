/**
 * A entidade existe, mas NÃO é deste Cliente.
 *
 * Distinta de "não existe" no código, idêntica na resposta: a rota devolve
 * 404 nos dois casos. Confirmar a existência de um Projeto de outro Cliente
 * seria vazar a informação que o escopo existe para proteger.
 */
export class NotInThisCustomerError extends Error {
  constructor(kind: string, id: string, customerId: string) {
    super(`${kind} ${id} não pertence ao cliente ${customerId}`);
    this.name = "NotInThisCustomerError";
  }
}
