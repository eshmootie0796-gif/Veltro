import type { RoleSlug } from "./constants";

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  name: string;
  role: RoleSlug;
  status: string;
  emailVerified: string | null;
  sessionVersion: number;
};

export type AppJwt = {
  id: string;
  email: string;
  username: string;
  name: string;
  role: RoleSlug;
  status: string;
  emailVerified: string | null;
  sessionVersion: number;
  error?: string;
};

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }

  interface User {
    id: string;
    email: string;
    username: string;
    name: string;
    role: RoleSlug;
    status: string;
    emailVerified: Date | null;
    sessionVersion: number;
  }
}
