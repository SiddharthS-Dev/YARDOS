import { redirect } from 'next/navigation';

/**
 * The console has no marketing landing page. Where a user lands depends on
 * their role, which is decided after authentication.
 */
export default function RootPage() {
  redirect('/gate');
}
