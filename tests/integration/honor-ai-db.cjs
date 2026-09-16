// Run with an isolated PGlite package; never connects to production.
const { PGlite } = require(
  process.env.HONOR_PGLITE_PACKAGE || "@electric-sql/pglite",
);
const fs = require("fs");
const assert = require("assert/strict");
(async () => {
  const db = new PGlite();
  const root = process.cwd();
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role; CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`,
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/061_omnichannel_inbox.sql",
      "utf8",
    ),
  );
  await db.exec(
    `ALTER TABLE omnichannel_settings ADD COLUMN automation_config jsonb NOT NULL DEFAULT '{}';CREATE TABLE ecommerce_products(user_id uuid,company_id uuid,source text);CREATE TABLE ecommerce_orders(external_id text,user_id uuid,company_id uuid,source text,net_paid_amount numeric,paid_at timestamptz,cancelled_at timestamptz);`,
  );
  await db.exec(
    fs.readFileSync(
      root + "/supabase/migrations/202609160001_honor_ai_controls.sql",
      "utf8",
    ),
  );
  const one = async (q, p = []) => (await db.query(q, p)).rows[0];
  await db.exec(
    `UPDATE omnichannel_settings SET enabled=true,mode='auto';INSERT INTO omnichannel_contacts(id,channel,external_id) VALUES('11111111-1111-4111-8111-111111111111','whatsapp','sandbox');INSERT INTO omnichannel_conversations(id,channel,account_external_id,external_id,contact_id,auto_reply_override) VALUES('22222222-2222-4222-8222-222222222222','whatsapp','waweb:sandbox','sandbox','11111111-1111-4111-8111-111111111111',true);INSERT INTO omnichannel_messages(id,conversation_id,channel,external_message_id,direction,text,status,ai_confidence,metadata,occurred_at) VALUES('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','whatsapp','sandbox-in','in','test','processing',0.95,'{"providerTimestampTrusted":true}',now());`,
  );
  let n = 0;
  for (const mode of ["off", "draft", "assistant"]) {
    await db.query(
      "UPDATE omnichannel_settings SET mode=$1 WHERE channel='whatsapp'",
      [mode],
    );
    assert.equal(
      (
        await one(
          "select * from claim_omnichannel_auto_send('33333333-3333-4333-8333-333333333333')",
        )
      ).claimed,
      false,
    );
    n++;
  }
  await db.exec(
    `UPDATE omnichannel_settings SET mode='auto' WHERE channel='whatsapp';`,
  );
  assert.equal(
    (
      await one(
        "select * from claim_omnichannel_auto_send('33333333-3333-4333-8333-333333333333')",
      )
    ).claimed,
    true,
  );
  n++;
  await db.exec(
    `UPDATE omnichannel_messages SET status='processing';UPDATE omnichannel_settings SET automation_config='{"honor_ai":{"enabled":true,"account_id":"waweb:sandbox"}}' WHERE channel='whatsapp';`,
  );
  assert.equal(
    (
      await one(
        "select * from claim_omnichannel_auto_send('33333333-3333-4333-8333-333333333333')",
      )
    ).reason,
    "honor_live_canary_required",
  );
  n++;
  await db.exec(
    `INSERT INTO omnichannel_messages(conversation_id,channel,external_message_id,direction,text,status,metadata,occurred_at) VALUES('22222222-2222-4222-8222-222222222222','whatsapp','sandbox-out','out','human','sent','{"humanOutbound":true}',now());`,
  );
  assert.equal(
    (await one("select auto_reply_override from omnichannel_conversations"))
      .auto_reply_override,
    false,
  );
  n++;
  await db.exec(`select honor_ai_control('stop');`);
  assert.equal(
    (
      await one(
        "select count(*)::int n from omnichannel_settings where enabled or mode<>'off'",
      )
    ).n,
    0,
  );
  n++;
  await db.exec("SET ROLE authenticated");
  let denied = false;
  try {
    await db.exec("select honor_ai_control('stop')");
  } catch {
    denied = true;
  }
  assert.equal(denied, true);
  n++;
  await db.exec("RESET ROLE");

  const config = {
    enabled: true,
    account_id: "waweb:sandbox",
    user_id: "11111111-1111-4111-8111-111111111111",
    company_id: "22222222-2222-4222-8222-222222222222",
  };
  await db.query(
    `UPDATE omnichannel_settings SET enabled=true,mode='draft',automation_config=jsonb_build_object('honor_ai',$1::jsonb) WHERE channel='whatsapp'`,
    [JSON.stringify(config)],
  );
  await db.exec(
    `UPDATE omnichannel_messages SET ai_draft='verified card',ai_confidence=0.95 WHERE direction='in';`,
  );
  let rejected = false;
  try {
    await db.exec(
      `select honor_verify_live_canary('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444')`,
    );
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
  n++;
  await db.query(
    `select honor_mark_catalog_verified('33333333-3333-4333-8333-333333333333',$1::jsonb,now())`,
    [JSON.stringify(config)],
  );
  await db.exec(
    `INSERT INTO omnichannel_messages(id,conversation_id,channel,external_message_id,direction,text,status,metadata,occurred_at) VALUES('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','whatsapp','sandbox-manual','out','reviewed reply','sent','{"source":"giga_admin_manual","actorId":"44444444-4444-4444-8444-444444444444"}',now());`,
  );
  await db.exec(
    `select honor_verify_live_canary('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444')`,
  );
  assert.equal(
    (
      await one(
        `select mode,automation_config->>'honor_verified_account' account from omnichannel_settings where channel='whatsapp'`,
      )
    ).account,
    "waweb:sandbox",
  );
  assert.equal(
    (
      await one(
        `select mode from omnichannel_settings where channel='whatsapp'`,
      )
    ).mode,
    "draft",
  );
  n++;
  const evidence = {
    source_event_id: "sandbox-paid",
    message_id: "55555555-5555-4555-8555-555555555555",
    event_type: "paid",
    order_external_id: "sandbox-order",
    occurred_at: new Date().toISOString(),
  };
  rejected = false;
  try {
    await db.query("select honor_record_commerce_evidence($1::jsonb)", [
      JSON.stringify(evidence),
    ]);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
  n++;
  await db.exec(
    `INSERT INTO ecommerce_orders VALUES('sandbox-order','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','myhonor.shop',39000,now(),NULL);`,
  );
  await db.query("select honor_record_commerce_evidence($1::jsonb)", [
    JSON.stringify(evidence),
  ]);
  await db.query("select honor_record_commerce_evidence($1::jsonb)", [
    JSON.stringify(evidence),
  ]);
  assert.equal(
    (await one("select count(*)::int n from honor_commerce_evidence")).n,
    1,
  );
  assert.equal(
    Number(
      (await one("select confirmed_revenue from honor_commerce_evidence"))
        .confirmed_revenue,
    ),
    39000,
  );
  n++;
  rejected = false;
  try {
    await db.query("select honor_record_commerce_evidence($1::jsonb)", [
      JSON.stringify({ ...evidence, event_type: "order" }),
    ]);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
  n++;
  rejected=false;
  try { await db.query("select honor_mark_catalog_verified($1::uuid,$2::jsonb,now()-interval '10 minutes')", ['33333333-3333-4333-8333-333333333333',JSON.stringify(config)]); } catch { rejected=true; }
  assert.equal(rejected,true); n++;
  await db.exec('UPDATE ecommerce_orders SET net_paid_amount=29000');
  assert.equal(Number((await one('select confirmed_revenue from honor_commerce_metrics')).confirmed_revenue),29000); n++;
  await db.exec('UPDATE ecommerce_orders SET paid_at=NULL');
  assert.equal((await one('select confirmed_revenue from honor_commerce_metrics')).confirmed_revenue,null); n++;
  console.log(
    JSON.stringify({
      passed: n,
      database: "isolated PGlite PostgreSQL",
      productionWrites: 0,
    }),
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
