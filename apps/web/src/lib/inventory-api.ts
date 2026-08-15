import type {
  CreateInventoryAdjustmentInput,
  InventoryItemDetailDTO,
  InventoryListResponse,
  InventoryMovementListResponse,
  InventoryMovementDTO,
  InventoryMovementType,
  ItemType,
  StockCountInput,
  StockCountResultDTO,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListInventoryParams {
  search?: string;
  type?: ItemType;
  onlyWithStock?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listInventory(params: ListInventoryParams = {}): Promise<InventoryListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.type) query.set("type", params.type);
  if (params.onlyWithStock) query.set("onlyWithStock", "true");
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await fetch(`${API_URL}/inventory?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as InventoryListResponse;
}

export async function getInventoryItem(itemId: string): Promise<InventoryItemDetailDTO> {
  const response = await fetch(`${API_URL}/inventory/${itemId}`);
  return (await parseJsonOrThrow(response)) as InventoryItemDetailDTO;
}

export interface ListInventoryMovementsParams {
  search?: string;
  itemId?: string;
  lotId?: string;
  type?: InventoryMovementType;
  page?: number;
  pageSize?: number;
}

export async function listInventoryMovements(
  params: ListInventoryMovementsParams = {},
): Promise<InventoryMovementListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.itemId) query.set("itemId", params.itemId);
  if (params.lotId) query.set("lotId", params.lotId);
  if (params.type) query.set("type", params.type);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await fetch(`${API_URL}/inventory-movements?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as InventoryMovementListResponse;
}

export async function createInventoryAdjustment(
  input: CreateInventoryAdjustmentInput,
): Promise<InventoryMovementDTO> {
  const response = await fetch(`${API_URL}/inventory-adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as InventoryMovementDTO;
}

export async function createStockCount(input: StockCountInput): Promise<StockCountResultDTO> {
  const response = await fetch(`${API_URL}/stock-counts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as StockCountResultDTO;
}
