import { ArrowLeft, Bot, MessageSquareText, Settings2 } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { browser } from 'wxt/browser';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { Button } from '@/components/ui/button';
import { getUiMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type SidebarLink = { label: string; to: string; icon: typeof Bot };

function OptionsSidebarLink({ label, to, icon: Icon }: SidebarLink) {
  return (
    <NavLink
      className={({ isActive }) => cn(
        'group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
      to={to}
    >
      {({ isActive }) => <><span className={cn('absolute left-0 h-5 w-0.5 rounded-full bg-primary transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} /><Icon className="size-4 shrink-0" /><span className="truncate">{label}</span></>}
    </NavLink>
  );
}

function isDetailRoute(pathname: string) { return pathname.split('/').filter(Boolean).length > 1; }

export function OptionsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const manifest = browser.runtime.getManifest();
  const messages = getUiMessages();
  const navLinks: SidebarLink[] = [
    { label: messages.options.navigation.models, to: '/models', icon: Bot },
    { label: messages.options.navigation.prompts, to: '/prompts', icon: MessageSquareText },
    { label: messages.options.navigation.general, to: '/general', icon: Settings2 },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex min-h-16 items-center gap-4 border-b border-border/70 bg-card/80 px-6 py-3 backdrop-blur max-sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <img alt="" className="size-6" src={browser.runtime.getURL('/icon/32.png')} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">{manifest.name}</h1>
            <p className="text-xs text-muted-foreground">AI webpage summarizer</p>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">v{manifest.version}</span>
        </div>
        <div className="grow" />
        <div className="flex items-center gap-2">
          <a aria-label="GitHub" className="grid size-9 place-items-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="https://github.com/lonemoonspace/KuaiKan" rel="noreferrer noopener" target="_blank" title="GitHub"><GithubIcon size={18} /></a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav aria-label={messages.options.navigationLabel} className="w-56 shrink-0 border-r border-border/70 bg-card/30 px-3 py-4 max-md:w-full max-md:border-b max-md:border-r-0 max-md:px-4">
          <div className="grid gap-1">
            {navLinks.map((link) => (
              <OptionsSidebarLink key={link.to} {...link} />
            ))}
          </div>
        </nav>
        <main className="relative min-w-0 flex-1 px-8 py-6 max-md:px-4 max-md:py-5">
          <div className="mx-auto w-full max-w-5xl">
            {isDetailRoute(location.pathname) ? <Button aria-label={messages.common.back} className="mb-3 size-8 rounded-lg p-0 [&_svg]:size-4" onClick={() => navigate(-1)} size="icon" type="button" variant="ghost"><ArrowLeft /></Button> : null}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
