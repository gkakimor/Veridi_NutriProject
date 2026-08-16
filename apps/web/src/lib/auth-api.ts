import type {
  AuthenticatedUserDTO,
  ControlledDocumentRevisionListResponse,
  CreateControlledDocumentRevisionInput,
  ControlledDocumentRevisionDTO,
  CreateUserInput,
  LoginInput,
  ResetUserPasswordInput,
  UpdateUserInput,
  UserDTO,
  UserListResponse,
  UserRole,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export async function login(input: LoginInput): Promise<AuthenticatedUserDTO> {
  const response = await apiFetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as AuthenticatedUserDTO;
}

export async function logout(): Promise<void> {
  await apiFetch(`${API_URL}/auth/logout`, { method: "POST" });
}

/**
 * `null` quando não há sessão — é assim que o app decide mostrar o Login.
 * Usa `/auth/session`, que responde 200 mesmo sem sessão: "ninguém logado"
 * é estado esperado e não deve aparecer como erro no console do navegador.
 */
export async function fetchCurrentUser(): Promise<AuthenticatedUserDTO | null> {
  const response = await apiFetch(`${API_URL}/auth/session`);
  const body = (await parseJsonOrThrow(response)) as { user: AuthenticatedUserDTO | null };
  return body.user;
}

export interface ListUsersParams {
  search?: string;
  role?: UserRole;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listUsers(params: ListUsersParams = {}): Promise<UserListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.role) query.set("role", params.role);
  if (params.active !== undefined) query.set("active", String(params.active));
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/users?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as UserListResponse;
}

export async function createUser(input: CreateUserInput): Promise<UserDTO> {
  const response = await apiFetch(`${API_URL}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as UserDTO;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<UserDTO> {
  const response = await apiFetch(`${API_URL}/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as UserDTO;
}

export async function resetUserPassword(
  id: string,
  input: ResetUserPasswordInput,
): Promise<UserDTO> {
  const response = await apiFetch(`${API_URL}/users/${id}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as UserDTO;
}

export async function listControlledDocuments(): Promise<ControlledDocumentRevisionListResponse> {
  const response = await apiFetch(`${API_URL}/controlled-documents`);
  return (await parseJsonOrThrow(response)) as ControlledDocumentRevisionListResponse;
}

export async function createControlledDocumentRevision(
  input: CreateControlledDocumentRevisionInput,
): Promise<ControlledDocumentRevisionDTO> {
  const response = await apiFetch(`${API_URL}/controlled-documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ControlledDocumentRevisionDTO;
}

export async function activateControlledDocumentRevision(
  id: string,
): Promise<ControlledDocumentRevisionDTO> {
  const response = await apiFetch(`${API_URL}/controlled-documents/${id}/activate`, {
    method: "POST",
  });
  return (await parseJsonOrThrow(response)) as ControlledDocumentRevisionDTO;
}
