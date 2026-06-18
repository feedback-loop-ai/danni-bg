import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import { openDb } from '../store/db.ts';
import { UsersRepo } from '../store/repos/users.ts';

/**
 * `danni admin <grant|revoke|list> [email]` — manage user tiers (spec 019). Roles live in the app
 * `users` table, not Kratos. A user must register + log in once (creating their row) before they can
 * be granted admin. This is the first-admin bootstrap path.
 */
export async function run(args: string[]): Promise<number> {
  const action = args[0];
  const email = args[1];
  if (action !== 'grant' && action !== 'revoke' && action !== 'list') {
    process.stderr.write('usage: danni admin <grant|revoke|list> [email]\n');
    return 2;
  }

  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  const db = openDb({ storeRoot, loadVec: false });
  try {
    const repo = new UsersRepo(db);
    if (action === 'list') {
      for (const u of repo.listAll()) {
        process.stdout.write(`${u.role}\t${u.email}\t${u.kratos_identity_id}\n`);
      }
      return 0;
    }
    if (!email) {
      process.stderr.write(`usage: danni admin ${action} <email>\n`);
      return 2;
    }
    const role = action === 'revoke' ? 'user' : 'admin';
    const ok = repo.setRoleByEmail(email, role);
    if (!ok) {
      process.stderr.write(
        `no user with email ${email}; they must register + log in once before being granted a role\n`,
      );
      return 4;
    }
    process.stdout.write(`${email} -> ${role}\n`);
    return 0;
  } finally {
    db.close();
  }
}
