import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { env } from "../env";
import { authenticateCredentials } from "./credentials";
import { findOrCreateGoogleUser } from "./google-provision";
import { isRoleSlug } from "./rbac";
import type { AppJwt } from "./types";
import "./types";

const providers: Provider[] = [
  Credentials({
    id: "credentials",
    name: "Credentials",
    credentials: {
      identifier: { label: "Username or Email", type: "text" },
      password: { label: "Password", type: "password" },
    },
    authorize: async (credentials) => {
      const identifier = credentials?.identifier;
      const password = credentials?.password;
      if (typeof identifier !== "string" || typeof password !== "string") {
        return null;
      }
      return authenticateCredentials(identifier, password);
    },
  }),
];

if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      // Never auto-link Google to an arbitrary same-email password account.
      allowDangerousEmailAccountLinking: false,
    }),
  );
}

function asAppJwt(token: unknown): AppJwt {
  return token as AppJwt;
}

/**
 * Auth.js configuration.
 * JWT sessions: multiple devices allowed; bump users.sessionVersion to revoke all.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30,
  },
  trustHost: env.AUTH_TRUST_HOST,
  secret: env.AUTH_SECRET,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const provisioned = await findOrCreateGoogleUser({
          email: user.email ?? profile?.email,
          name: user.name ?? profile?.name,
          image: user.image ?? (profile as { picture?: string } | undefined)?.picture,
          providerAccountId: account.providerAccountId,
        });
        if (!provisioned) return false;
        user.id = provisioned.id;
        user.email = provisioned.email;
        user.username = provisioned.username;
        user.name = provisioned.name;
        user.role = provisioned.role;
        user.status = provisioned.status;
        user.emailVerified = provisioned.emailVerified;
        user.sessionVersion = provisioned.sessionVersion;
      }
      return true;
    },
    async jwt({ token, user }) {
      const appToken = asAppJwt(token);

      if (user) {
        appToken.id = user.id;
        appToken.email = user.email;
        appToken.username = user.username;
        appToken.name = user.name;
        appToken.role = user.role;
        appToken.status = user.status;
        appToken.emailVerified = user.emailVerified
          ? new Date(user.emailVerified).toISOString()
          : null;
        appToken.sessionVersion = user.sessionVersion;
      }

      if (!appToken.id) {
        return appToken;
      }

      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, appToken.id),
        with: { role: true },
      });

      if (!dbUser || dbUser.status !== "active") {
        appToken.status = dbUser?.status ?? "deleted";
        appToken.error = "InvalidSession";
        return appToken;
      }
      if (dbUser.sessionVersion !== appToken.sessionVersion) {
        appToken.error = "InvalidSession";
        return appToken;
      }

      const roleSlug = dbUser.role?.slug;
      if (!roleSlug || !isRoleSlug(roleSlug)) {
        appToken.error = "InvalidSession";
        return appToken;
      }

      appToken.email = dbUser.email;
      appToken.username = dbUser.username;
      appToken.name = dbUser.name;
      appToken.role = roleSlug;
      appToken.status = dbUser.status;
      appToken.emailVerified = dbUser.emailVerified
        ? dbUser.emailVerified.toISOString()
        : null;
      appToken.sessionVersion = dbUser.sessionVersion;
      delete appToken.error;

      return appToken;
    },
    async session({ session, token }) {
      const appToken = asAppJwt(token);

      if (appToken.error === "InvalidSession") {
        session.user = {
          id: "",
          email: "",
          username: "",
          name: "",
          role: "customer",
          status: "deleted",
          emailVerified: null,
          sessionVersion: -1,
        } as typeof session.user;
        return session;
      }

      session.user = {
        id: appToken.id,
        email: appToken.email,
        username: appToken.username,
        name: appToken.name,
        role: appToken.role,
        status: appToken.status,
        emailVerified: appToken.emailVerified,
        sessionVersion: appToken.sessionVersion,
      } as typeof session.user;
      return session;
    },
  },
});
