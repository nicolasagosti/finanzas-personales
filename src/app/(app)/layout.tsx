import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { telegramConfigured } from "@/lib/telegram";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <AppShell
      user={{ name: user.name, isDemo: user.isDemo, avatarUrl: user.avatarUrl, viaGoogle: user.viaGoogle }}
      logout={logout}
      telegram={telegramConfigured()}
    >
      {children}
    </AppShell>
  );
}
