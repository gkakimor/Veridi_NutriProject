import type {
  CancelShipmentInput,
  CustomerOrderDTO,
  ReallocateReservationLineInput,
  ReservationStatusDTO,
  ReserveAvailableInput,
  ShipmentDTO,
  ShipmentListResponse,
  ShipmentStatus,
  UpdateShipmentInput,
  VerifyShipmentLineInput,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListShipmentsParams {
  search?: string;
  customerOrderId?: string;
  status?: ShipmentStatus;
  page?: number;
  pageSize?: number;
}

export async function listShipments(params: ListShipmentsParams = {}): Promise<ShipmentListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.customerOrderId) query.set("customerOrderId", params.customerOrderId);
  if (params.status) query.set("status", params.status);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await fetch(`${API_URL}/shipments?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ShipmentListResponse;
}

export async function getShipment(id: string): Promise<ShipmentDTO> {
  const response = await fetch(`${API_URL}/shipments/${id}`);
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}

export async function createShipmentDraft(customerOrderId: string): Promise<ShipmentDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/shipments`, {
    method: "POST",
  });
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}

export async function updateShipment(id: string, input: UpdateShipmentInput): Promise<ShipmentDTO> {
  const response = await fetch(`${API_URL}/shipments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}

/**
 * Confere fisicamente o lote de uma linha. Aceita código puro ou payload de
 * QR (`LOT:LT-...`). Auditoria pura — nunca movimenta estoque.
 */
export async function verifyShipmentLine(
  shipmentId: string,
  lineId: string,
  input: VerifyShipmentLineInput,
): Promise<ShipmentDTO> {
  const response = await fetch(`${API_URL}/shipments/${shipmentId}/lines/${lineId}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}

export async function confirmShipment(id: string): Promise<ShipmentDTO> {
  const response = await fetch(`${API_URL}/shipments/${id}/confirm`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}

export async function cancelShipment(id: string, input: CancelShipmentInput): Promise<ShipmentDTO> {
  const response = await fetch(`${API_URL}/shipments/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ShipmentDTO;
}

export async function getReservationStatus(customerOrderId: string): Promise<ReservationStatusDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/reservation-status`);
  return (await parseJsonOrThrow(response)) as ReservationStatusDTO;
}

export async function reserveAvailable(
  customerOrderId: string,
  input: ReserveAvailableInput,
): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/reserve-available`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function reallocateReservationLine(
  customerOrderId: string,
  input: ReallocateReservationLineInput,
): Promise<CustomerOrderDTO> {
  const response = await fetch(
    `${API_URL}/customer-orders/${customerOrderId}/reallocate-reservation-line`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}
