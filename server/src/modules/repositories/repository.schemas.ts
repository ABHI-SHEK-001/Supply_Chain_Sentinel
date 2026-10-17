import { z } from "zod";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,99}$/,
    "must be 1-100 chars: lowercase letters, digits, '.', '_' or '-', starting with a letter or digit",
  );

export const repositoryIdSchema = slug;

export const createRepositorySchema = z.object({
  name: slug,
  ecosystem: z.enum(["npm"]).default("npm"),
  /** Raw contents of the lockfile (package-lock.json). */
  lockfile: z.string().min(2, "lockfile must not be empty"),
});

export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;