import { describe, expect, it } from "vitest";
import {
  omnichannelPostgresConfigurationError,
  omnichannelPostgresConnectionString,
  shouldUseOmnichannelPostgres,
} from "@/lib/omnichannel/postgres-runtime";

describe("omnichannel Postgres runtime selection", () => {
  it("keeps the implicit fallback local-development only", () => {
    expect(
      shouldUseOmnichannelPostgres({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://local/database",
        SUPABASE_SERVICE_ROLE_KEY: "",
      }),
    ).toBe(true);
    expect(
      shouldUseOmnichannelPostgres({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://local/database",
        SUPABASE_SERVICE_ROLE_KEY: "configured",
      }),
    ).toBe(false);
    expect(
      shouldUseOmnichannelPostgres({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://broad-owner/database",
      }),
    ).toBe(false);
  });

  it("requires an explicit dedicated URL in production", () => {
    const configured: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      OMNICHANNEL_PERSISTENCE: "postgres",
      OMNICHANNEL_DATABASE_URL: "postgres://restricted/runtime",
      // Other modules in the shared Next deployment may still need this key.
      SUPABASE_SERVICE_ROLE_KEY: "shared-service-role",
    };
    expect(shouldUseOmnichannelPostgres(configured)).toBe(true);
    expect(omnichannelPostgresConnectionString(configured)).toBe(
      "postgres://restricted/runtime",
    );
    expect(
      shouldUseOmnichannelPostgres({
        NODE_ENV: "production",
        OMNICHANNEL_PERSISTENCE: "postgres",
        DATABASE_URL: "postgres://must-not-fallback/owner",
      }),
    ).toBe(false);
    expect(
      omnichannelPostgresConfigurationError({
        NODE_ENV: "production",
        OMNICHANNEL_PERSISTENCE: "postgres",
      }),
    ).toBe("omnichannel_database_url_missing");
  });

  it("supports the legacy explicit flag without weakening fail-closed behavior", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      OMNICHANNEL_DIRECT_POSTGRES_ENABLED: "true",
      OMNICHANNEL_DATABASE_URL: "postgres://restricted/runtime",
    };
    expect(shouldUseOmnichannelPostgres(env)).toBe(true);
    expect(
      shouldUseOmnichannelPostgres({
        ...env,
        OMNICHANNEL_DIRECT_POSTGRES_ENABLED: "false",
      }),
    ).toBe(false);
  });
});
