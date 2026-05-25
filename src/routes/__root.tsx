import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-6xl font-display text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <Link to="/" className="mt-6 inline-block text-sm underline">Back to dashboard</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-display">Something broke</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >Try again</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AI-native PM job hunter" },
      { name: "description", content: "Hunt AI-native Product Manager roles (remote / France)" },
      { property: "og:title", content: "AI-native PM job hunter" },
      { name: "twitter:title", content: "AI-native PM job hunter" },
      { property: "og:description", content: "Hunt AI-native Product Manager roles (remote / France)" },
      { name: "twitter:description", content: "Hunt AI-native Product Manager roles (remote / France)" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eb3387d1-891a-443f-9695-24999a439dc6/id-preview-99f22b16--2ff3725a-c8a2-4420-9eb7-fc225d0563f8.lovable.app-1779696761451.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eb3387d1-891a-443f-9695-24999a439dc6/id-preview-99f22b16--2ff3725a-c8a2-4420-9eb7-fc225d0563f8.lovable.app-1779696761451.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      activeProps={{ className: "text-sm text-foreground font-semibold" }}
      activeOptions={{ exact: to === "/" }}
    >
      {label}
    </Link>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <Link to="/" className="flex items-baseline gap-2">
              <span className="font-display text-2xl">Pipeline</span>
              <span className="text-xs text-muted-foreground">AI-native PM hunt</span>
            </Link>
            <nav className="flex items-center gap-6">
              <NavLink to="/" label="Dashboard" />
              <NavLink to="/jobs" label="Jobs" />
              <NavLink to="/companies" label="Companies" />
              <NavLink to="/preferences" label="Preferences" />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
