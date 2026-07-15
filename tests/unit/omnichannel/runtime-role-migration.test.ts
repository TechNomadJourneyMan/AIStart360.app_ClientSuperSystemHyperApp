import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/065_omnichannel_runtime_role.sql"),
  "utf8",
);

const role = "aistart360_omnichannel_runtime";

function tableSection(table: string, nextMarker: string): string {
  const start = migration.indexOf(`GRANT SELECT ON TABLE public.${table}`);
  const end = migration.indexOf(nextMarker, start + 1);
  if (start < 0 || end < 0) {
    throw new Error(`missing grant section for ${table}`);
  }
  return migration.slice(start, end);
}

describe("065 least-privilege omnichannel runtime role migration", () => {
  it("creates a capability role that cannot log in or bypass RLS", () => {
    expect(migration).toContain(`CREATE ROLE ${role}`);
    expect(migration).toMatch(
      /NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE[\s\S]*?NOREPLICATION NOBYPASSRLS/,
    );
    expect(migration).not.toContain(`ALTER ROLE ${role}`);
    for (const attribute of [
      "rolcanlogin",
      "rolinherit",
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolreplication",
      "rolbypassrls",
    ]) {
      expect(migration).toContain(`v_role.${attribute}`);
    }
    expect(migration).not.toMatch(/\bPASSWORD\b/i);
    expect(migration).not.toMatch(/CREATE ROLE[^;]*\bLOGIN\b/i);
    expect(migration).not.toMatch(/\bBYPASSRLS\b/i);
    expect(migration).not.toMatch(new RegExp(`(?:OWNER TO|GRANT ${role} TO)`));
    expect(migration).toMatch(
      new RegExp(
        `REVOKE ALL PRIVILEGES ON SCHEMA public\\s+FROM ${role};[\\s\\S]*?GRANT USAGE ON SCHEMA public TO ${role};`,
      ),
    );
    expect(migration).toContain(
      `GRANT CONNECT ON DATABASE postgres TO ${role};`,
    );
  });

  it("grants only required operations and column-scoped writes", () => {
    expect(migration).not.toMatch(/GRANT ALL(?: PRIVILEGES)?/i);
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE) ON TABLE/i);
    expect(migration).not.toMatch(
      /GRANT (?:DELETE|TRUNCATE|REFERENCES|TRIGGER)/i,
    );

    const settings = tableSection(
      "omnichannel_settings",
      "GRANT SELECT ON TABLE public.omnichannel_contacts",
    );
    expect(settings).toContain("GRANT UPDATE (");
    expect(settings).not.toContain("GRANT INSERT (");

    for (const [table, next] of [
      [
        "omnichannel_contacts",
        "GRANT SELECT ON TABLE public.omnichannel_conversations",
      ],
      [
        "omnichannel_conversations",
        "GRANT SELECT ON TABLE public.omnichannel_messages",
      ],
      ["omnichannel_messages", "GRANT SELECT (\n  id,"],
    ] as const) {
      const sql = tableSection(table, next);
      expect(sql).toContain("GRANT INSERT (");
      expect(sql).toContain("GRANT UPDATE (");
    }

    expect(migration).toMatch(
      /GRANT SELECT \([\s\S]*?\) ON TABLE public\.omnichannel_webhook_events/,
    );
  });

  it("keeps RLS enabled with operation-specific policies and no delete policy", () => {
    const tables = [
      "omnichannel_settings",
      "omnichannel_contacts",
      "omnichannel_conversations",
      "omnichannel_messages",
      "omnichannel_webhook_events",
    ];
    for (const table of tables) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
      expect(migration).toMatch(
        new RegExp(
          `CREATE POLICY omnichannel_runtime_select\\s+ON public\\.${table}\\s+FOR SELECT\\s+TO ${role}`,
        ),
      );
    }
    expect(
      migration.match(/CREATE POLICY omnichannel_runtime_insert/g),
    ).toHaveLength(4);
    expect(
      migration.match(/CREATE POLICY omnichannel_runtime_update/g),
    ).toHaveLength(5);
    expect(migration).not.toMatch(/FOR DELETE|omnichannel_runtime_delete/);
  });

  it("keeps processing jobs RPC-only and grants each exact queue signature", () => {
    expect(migration).toMatch(
      new RegExp(
        `REVOKE ALL PRIVILEGES ON TABLE public\\.omnichannel_processing_jobs\\s+FROM ${role};`,
      ),
    );
    expect(migration).not.toMatch(
      new RegExp(
        `GRANT[^;]+ON TABLE public\\.omnichannel_processing_jobs[^;]+TO ${role}`,
      ),
    );
    expect(migration).not.toMatch(
      /CREATE POLICY[^;]+ON public\.omnichannel_processing_jobs/,
    );

    for (const signature of [
      /enqueue_omnichannel_processing_job\(\s*UUID, BOOLEAN, TIMESTAMPTZ, INTEGER\s*\)/,
      /claim_omnichannel_processing_job\(INTEGER\)/,
      /complete_omnichannel_processing_job\(UUID, UUID\)/,
      /retry_omnichannel_processing_job\(\s*UUID, UUID, TEXT, BOOLEAN, INTEGER\s*\)/,
    ]) {
      expect(migration).toMatch(signature);
    }
  });

  it("grants only fifteen runtime RPCs after outbound pull is installed and closes unrelated definer functions", () => {
    expect(migration).toMatch(
      new RegExp(
        `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public\\s+FROM ${role};`,
      ),
    );
    const runtimeRpcSection = migration.slice(
      migration.indexOf("GRANT EXECUTE ON FUNCTION public.claim_omnichannel"),
      migration.indexOf("-- PUBLIC privileges cannot be denied"),
    );
    expect(
      runtimeRpcSection.match(/GRANT EXECUTE ON FUNCTION public\./g),
    ).toHaveLength(15);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.current_user_role\(\) FROM PUBLIC;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.current_user_role\(\)\s+TO anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.handle_new_user\(\)\s+TO supabase_auth_admin;/,
    );
    expect(runtimeRpcSection).not.toMatch(
      /GRANT[^;]+ON (?:TABLE|FUNCTION) public\.(?!omnichannel_|claim_omnichannel_|reserve_omnichannel_|list_omnichannel_|set_omnichannel_|finalize_omnichannel_|enqueue_omnichannel_|complete_omnichannel_|retry_omnichannel_|authorize_omnichannel_|report_omnichannel_)/,
    );
  });
});
