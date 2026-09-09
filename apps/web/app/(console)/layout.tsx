import { AppShell } from '@/components/domain/app-shell';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
