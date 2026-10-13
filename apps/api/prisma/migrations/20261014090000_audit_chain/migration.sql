-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "chainSeq" BIGINT;

-- CreateTable
CREATE TABLE "audit_checkpoint" (
    "id" BIGSERIAL NOT NULL,
    "chainSeq" BIGINT NOT NULL,
    "hash" BYTEA NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_chainSeq_key" ON "audit_log"("chainSeq");


-- ─── Hand-written: tamper-evident, append-only audit trail (FR-131, ADR-0010) ─────────────

-- The canonical form of a row that the hash covers: every column except the hash fields.
CREATE FUNCTION audit_canonical(r "audit_log") RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', r."id",
    'chainSeq', r."chainSeq",
    'occurredAt', to_char(r."occurredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actorId', r."actorId",
    'actorRole', r."actorRole",
    'actorType', r."actorType",
    'action', r."action",
    'entityType', r."entityType",
    'entityId', r."entityId",
    'departmentId', r."departmentId",
    'before', r."before",
    'after', r."after",
    'ip', r."ip",
    'userAgent', r."userAgent",
    'requestId', r."requestId"
  )::text
$$;

CREATE SEQUENCE "audit_chain_seq";

-- Chain existing rows once, in id order (the app wrote them before the chain existed).
DO $$
DECLARE r "audit_log"; prev bytea := '\x'::bytea;
BEGIN
  FOR r IN SELECT * FROM "audit_log" ORDER BY "id" LOOP
    r."chainSeq" := nextval('audit_chain_seq');
    r."prevHash" := prev;
    r."hash" := sha256(prev || convert_to(audit_canonical(r), 'UTF8'));
    UPDATE "audit_log" SET "chainSeq" = r."chainSeq", "prevHash" = r."prevHash", "hash" = r."hash" WHERE "id" = r."id";
    prev := r."hash";
  END LOOP;
END $$;

-- Every insert joins the chain. The advisory lock is held until commit, so chain order is commit
-- order and no two transactions can link to the same predecessor.
CREATE FUNCTION audit_chain_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE last bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(74610001);
  NEW."chainSeq" := nextval('audit_chain_seq');
  SELECT a."hash" INTO last FROM "audit_log" a WHERE a."chainSeq" IS NOT NULL ORDER BY a."chainSeq" DESC LIMIT 1;
  NEW."prevHash" := COALESCE(last, '\x'::bytea);
  NEW."hash" := sha256(NEW."prevHash" || convert_to(audit_canonical(NEW), 'UTF8'));
  RETURN NEW;
END $$;
CREATE TRIGGER "audit_log_chain" BEFORE INSERT ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();

-- Append-only for everyone, owner included (grants below add a second layer for the app role).
CREATE FUNCTION audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "audit_log_no_change" BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER "audit_checkpoint_no_change" BEFORE UPDATE OR DELETE ON "audit_checkpoint" FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER "audit_checkpoint_no_truncate" BEFORE TRUNCATE ON "audit_checkpoint" FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

-- The first broken link in chain order, or no rows when the chain is intact. A row whose
-- prevHash does not match its predecessor means a row was removed or reordered; a row whose hash
-- does not match its contents means it was edited.
CREATE FUNCTION audit_verify() RETURNS TABLE ("chainSeq" bigint, "id" bigint, "problem" text)
LANGUAGE sql STABLE AS $$
  WITH c AS (
    SELECT a."chainSeq", a."id", a."prevHash", a."hash",
           COALESCE(lag(a."hash") OVER (ORDER BY a."chainSeq"), '\x'::bytea) AS "expectedPrev",
           sha256(a."prevHash" || convert_to(audit_canonical(a), 'UTF8')) AS "expectedHash"
    FROM "audit_log" a
  )
  SELECT c."chainSeq", c."id",
         CASE WHEN c."prevHash" IS DISTINCT FROM c."expectedPrev" THEN 'LINK_BROKEN' ELSE 'ROW_CHANGED' END
  FROM c
  WHERE c."prevHash" IS DISTINCT FROM c."expectedPrev" OR c."hash" IS DISTINCT FROM c."expectedHash"
  ORDER BY c."chainSeq"
  LIMIT 1
$$;

-- ─── Database roles: the application connects as a member of govserve_app_rw ────────────
-- (the login role and its password come from the secret store; see docs/adr/0010).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govserve_app_rw') THEN
    CREATE ROLE govserve_app_rw NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO govserve_app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO govserve_app_rw;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO govserve_app_rw;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO govserve_app_rw;
-- Audit tables: INSERT and SELECT only.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log", "audit_checkpoint" FROM govserve_app_rw;
-- Migration bookkeeping is not the application's business.
REVOKE ALL ON "_prisma_migrations" FROM govserve_app_rw;
-- Tables and sequences created by later migrations get the same rights.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO govserve_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO govserve_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO govserve_app_rw;
