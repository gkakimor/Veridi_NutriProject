import type {
  CancelDeliveryScheduleInput,
  CreateDeliveryScheduleInput,
  CustomerOrderDeliveryScheduleDTO,
  RescheduleDeliveryInput,
  ShipmentDTO,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Entregas programadas de um Pedido.
 *
 * Uma leitura só devolve o cronograma E o saldo programável: a tela precisa
 * dos dois para validar ao vivo, e duas chamadas dariam duas fotografias de
 * momentos diferentes.
 */
export async function getDeliverySchedule(
  customerOrderId: string,
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/deliveries`);
  return (await parseJsonOrThrow(response)) as CustomerOrderDeliveryScheduleDTO;
}

export async function createDeliverySchedule(
  customerOrderId: string,
  input: CreateDeliveryScheduleInput,
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/deliveries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDeliveryScheduleDTO;
}

export async function cancelDeliverySchedule(
  deliveryId: string,
  input: CancelDeliveryScheduleInput,
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const response = await apiFetch(`${API_URL}/customer-order-deliveries/${deliveryId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDeliveryScheduleDTO;
}

/**
 * Reprogramar não é editar a data: cancela a entrega e cria a substituta com
 * o saldo ainda pendente, na mesma transação. Por isso não existe um `PATCH`
 * correspondente aqui.
 */
export async function rescheduleDelivery(
  deliveryId: string,
  input: RescheduleDeliveryInput,
): Promise<CustomerOrderDeliveryScheduleDTO> {
  const response = await apiFetch(`${API_URL}/customer-order-deliveries/${deliveryId}/reschedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDeliveryScheduleDTO;
}

/**
 * Separação aberta A PARTIR de uma entrega programada: a Expedição nasce com
 * as quantidades daquela promessa e já ligada a ela. É o mesmo motor de
 * Expedição de sempre — só o ponto de partida muda.
 */
export async function prepareShipmentForDelivery(
  customerOrderId: string,
  deliveryId: string,
): Promise<ShipmentDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/shipments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryId }),
  });
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}
