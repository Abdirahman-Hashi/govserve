import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

/**
 * Creates (or updates the password of) the login role named in DATABASE_APP_URL as a member of
 * govserve_app_rw, connecting as the owner (DATABASE_URL). Locally the values come from .env; in
 * staging and production the migrate job runs this with both URLs from the secret store
 * (`*_FILE` → /run/secrets, ADR-0010). Never prints the password.
 */
function secret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file && !process.env[name]) return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  return process.env[name];
}

async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const owner = secret('DATABASE_URL');
  const app = secret('DATABASE_APP_URL');
  if (!owner || !app) {
    process.stderr.write('Set DATABASE_URL (owner) and DATABASE_APP_URL (application role).\n');
    process.exitCode = 1;
    return;
  }
  const { username, password } = new URL(app);
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(username) || !password) {
    process.stderr.write('DATABASE_APP_URL needs a simple role name and a password.\n');
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString: owner });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username]);
    // Role names cannot be bound parameters; the name is validated above. The password is quoted
    // with format('%L') so it is never spliced into SQL text by hand.
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    const { rows } = await client.query<{ sql: string }>(
      `SELECT format('${verb} ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql`,
      [username, decodeURIComponent(password)],
    );
    await client.query(rows[0]!.sql);
    await client.query(`GRANT govserve_app_rw TO ${username}`);
    process.stdout.write(
      `${exists.rowCount ? 'Updated' : 'Created'} role ${username} (member of govserve_app_rw)\n`,
    );
  } finally {
    await client.end();
  }
}

void main();
