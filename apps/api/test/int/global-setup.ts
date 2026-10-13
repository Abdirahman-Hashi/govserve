import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Point Testcontainers at the active Docker context when DOCKER_HOST is unset
 * (e.g. Colima or Rancher Desktop, whose sockets are not at /var/run/docker.sock).
 * CI runners use the default socket and skip this.
 */
export default function globalSetup(): void {
  // Each harness appends the audit actions its database saw; global-teardown checks coverage.
  const observed = join(tmpdir(), `govserve-audit-observed-${process.pid}.txt`);
  writeFileSync(observed, '');
  process.env['AUDIT_OBSERVED_FILE'] = observed;
  if (process.env['DOCKER_HOST']) return;
  try {
    const host = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      {
        encoding: 'utf8',
      },
    ).trim();
    if (host && host !== 'unix:///var/run/docker.sock') {
      process.env['DOCKER_HOST'] = host;
      // Ryuk (container reaper) mounts the socket path as seen inside the Docker VM.
      process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= '/var/run/docker.sock';
    }
  } catch {
    // No docker CLI: let Testcontainers report its own error.
  }
}
