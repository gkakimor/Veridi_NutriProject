/**
 * Contratos de Usuários/autenticação, consumidos por `apps/api` e
 * `apps/web`.
 *
 * Usuário existe para autenticação e, principalmente, para responder QUEM
 * executou uma ação GMP. Não é um módulo de RH.
 */

export const USER_CODE_PREFIX = "USR";

export type UserRole =
  | "ADMIN"
  | "PRODUCTION"
  | "QUALITY"
  | "PURCHASING"
  | "COMMERCIAL"
  | "VIEWER";

export const USER_ROLES: readonly UserRole[] = [
  "ADMIN",
  "PRODUCTION",
  "QUALITY",
  "PURCHASING",
  "COMMERCIAL",
  "VIEWER",
];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador",
  PRODUCTION: "Produção",
  QUALITY: "Qualidade",
  PURCHASING: "Compras",
  COMMERCIAL: "Comercial",
  VIEWER: "Consulta",
};

/** Usuário da sessão atual — nunca inclui hash de senha. */
export interface AuthenticatedUserDTO {
  id: string;
  code: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface UserDTO extends AuthenticatedUserDTO {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  users: UserDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  active?: boolean;
}

/** Reset explícito de senha — nunca acontece como efeito colateral de outra edição. */
export interface ResetUserPasswordInput {
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
