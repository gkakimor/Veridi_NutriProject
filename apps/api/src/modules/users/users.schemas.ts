import { z } from "zod";

/**
 * Senha mínima de 10 caracteres. Sem política de complexidade decorada
 * (maiúscula/símbolo): comprimento é o que realmente aumenta a entropia.
 */
const passwordSchema = z.string().min(10, "A senha deve ter ao menos 10 caracteres").max(200);

const roleSchema = z.enum([
  "ADMIN",
  "PRODUCTION",
  "QUALITY",
  "PURCHASING",
  "COMMERCIAL",
  "VIEWER",
]);

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Nome é obrigatório").max(200),
  email: z.string().trim().min(1, "E-mail é obrigatório").email("E-mail inválido").max(200),
  password: passwordSchema,
  role: roleSchema,
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(3).max(200).optional(),
  email: z.string().trim().email("E-mail inválido").max(200).optional(),
  role: roleSchema.optional(),
  active: z.boolean().optional(),
});

export const resetUserPasswordSchema = z.object({ password: passwordSchema });

export const listUsersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  role: roleSchema.optional(),
  active: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "true")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
