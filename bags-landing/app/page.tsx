import Link from 'next/link';
import {
  ShieldCheck,
  Wallet,
  Store,
  Database,
  GitBranch,
  KeyRound,
  FileCheck2,
  Coins,
  ReceiptText,
  ArrowRight,
  Sparkles,
  ChevronDown,
} from 'lucide-react';

function PaperBagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="16 14 66 74"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M 28 20 C 38 18 54 18 64 20" />
      <path d="M 28 20 C 24 23 24 30 31 33" />
      <path d="M 31 33 L 60 36.5" />
      <path d="M 60 36.5 L 59 25" />
      <path d="M 64 20 C 69 21 71.5 24 71.5 29 C 71.5 33 69 35 65 36" />
      <path d="M 59 25 C 61 22.5 66 22 67.5 25.5 C 68.5 28.5 66.5 31.5 62 31.5" />
      <path d="M 60 28.5 L 63.5 28.5 L 63.5 25" />
      <path d="M 31 33 C 29.5 45 26.5 61 23.5 74.5" />
      <path d="M 23.5 74.5 C 34 73 48 78 62.5 83" />
      <path d="M 60 36.5 C 61 48 61.8 66 62.5 83" />
      <path d="M 71 28.5 C 72.5 42 75 61 77 75" />
      <path d="M 77 75 L 62.5 83" />
      <path d="M 69.5 35 L 69 70.5" />
      <path d="M 69 70.5 L 62.5 83" />
      <path d="M 69 70.5 L 77 75" />
    </svg>
  );
}

const CONSOLE_URL = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000';

const subsystems = [
  {
    icon: ShieldCheck,
    title: 'Identity & Registry',
    tag: 'Novi',
    desc: 'Every agent is a verifiable identity with a human or organization guardian accountable for it — portable and interoperable.',
  },
  {
    icon: Wallet,
    title: 'Policy & Treasury',
    tag: 'Bagseven',
    desc: 'Deterministic spending limits and a custody layer the agent can never bypass. The planner proposes; policy and treasury dispose.',
  },
  {
    icon: Store,
    title: 'Tool Marketplace',
    tag: 'OnchainRouter',
    desc: 'Discover and pay for callable tools via x402 — policy-checked, settled on-chain to the provider\u2019s registered payout.',
  },
  {
    icon: Database,
    title: 'Data Marketplace',
    tag: 'OpenBook',
    desc: 'Buy verified, fresh data under an SLA, held in escrow and refunded automatically when delivery is stale or invalid.',
  },
  {
    icon: GitBranch,
    title: 'Evolution Engine',
    tag: 'Petri',
    desc: 'Benchmark, mutate, and promote improved agent versions in a sandbox — never risking production funds.',
  },
];

const pipeline = [
  { icon: Coins, step: 'Propose', desc: 'The agent (LLM) asks to spend — it can only propose.' },
  { icon: FileCheck2, step: 'Policy', desc: 'Deterministic rules decide allow / deny / pending approval, and mint a single-use spend_token.' },
  { icon: Wallet, step: 'Treasury', desc: 'Funds are reserved and co-signed only against a valid token.' },
  { icon: ReceiptText, step: 'Settle', desc: 'Real on-chain settlement with an immutable receipt and ledger.' },
];

export default function Home() {
  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,153,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(34,211,153,0.08),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/40 backdrop-blur-md py-4 px-6 border-b border-white/10">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0">
              <PaperBagIcon className="w-6 h-6 text-black" />
            </div>
            <span className="font-semibold text-lg tracking-tight">bagseven</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-white/70">
            <a href="#platform" className="hover:text-white transition-colors">Platform</a>
            <a href="#how" className="hover:text-white transition-colors">How it works</a>
            <a href="#security" className="hover:text-white transition-colors">Security</a>
            <a href="#ecosystem" className="hover:text-white transition-colors">Ecosystem</a>
          </div>
          <Link
            href={CONSOLE_URL}
            target="_blank"
            className="flex items-center gap-1.5 rounded-lg bg-emerald-400 text-black text-sm font-medium px-4 py-2 hover:bg-emerald-300 transition-colors"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex items-center min-h-screen">
        <div className="max-w-7xl mx-auto px-6 pt-24 grid gap-16 lg:grid-cols-2 items-center">
          <div className="fade-in">
            <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium mb-6">
              <Sparkles className="w-4 h-4" />
              Infrastructure for autonomous AI agents
            </div>
            <h1 className="font-serif text-4xl lg:text-6xl font-normal tracking-tight leading-tight mb-8">
              The trust &amp; settlement layer for <em className="text-emerald-300 not-italic">autonomous AI agents</em>
            </h1>
            <p className="text-gray-300 text-lg lg:text-xl font-light leading-relaxed mb-10 max-w-xl">
              Identity, policy, treasury, and marketplaces — so an agent can act, pay, and improve itself, while a
              human stays in ultimate control.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href={CONSOLE_URL}
                target="_blank"
                className="rounded-lg bg-emerald-400 text-black font-medium px-7 py-3 text-base hover:bg-emerald-300 hover:scale-[1.02] transition-all duration-300"
              >
                Get Started <ArrowRight className="inline w-4 h-4 ml-1" />
              </Link>
              <a
                href="#platform"
                className="rounded-lg border border-white/25 text-white font-medium px-7 py-3 text-base hover:bg-white/10 transition-colors"
              >
                Explore
              </a>
            </div>
          </div>

          {/* Animated hero visual — floating platform cards */}
          <div className="relative h-[420px] lg:h-[520px] hidden sm:block">
            {/* glowing core */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-emerald-400/20 blur-3xl animate-glow" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full border border-emerald-400/20 animate-spin-slow" style={{ borderStyle: 'dashed' }} />

            {/* spend token card */}
            <div className="absolute left-0 top-8 w-64 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-5 animate-floaty">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-white/40 font-mono">spend_token</span>
                <span className="text-[10px] font-medium rounded-full bg-emerald-400/20 text-emerald-300 px-2 py-0.5">allow</span>
              </div>
              <div className="font-mono text-[10px] text-white/60 leading-relaxed break-all">
                v1.eyJ2IjoxLCJhZ2VudF9pZC...
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                <div className="h-full w-3/4 rounded-full bg-emerald-400/70" />
              </div>
            </div>

            {/* balance card */}
            <div className="absolute right-0 top-16 w-60 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-5 animate-floaty-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-emerald-300" />
                </div>
                <span className="text-xs text-white/40">USDC balance</span>
              </div>
              <div className="text-2xl font-bold tracking-tight">$1,240.00</div>
              <div className="text-[11px] text-white/40 mt-1">reserved $80.00</div>
            </div>

            {/* receipt card */}
            <div className="absolute left-10 bottom-10 w-56 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-5 animate-floaty-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <ReceiptText className="w-4 h-4 text-emerald-300" />
                </div>
                <span className="text-xs text-white/40">receipt</span>
              </div>
              <div className="font-mono text-[10px] text-white/60">0x8f3a…c2e1 ✓</div>
              <div className="text-[11px] text-emerald-300 mt-2">immutable · on-chain</div>
            </div>

            {/* policy pill */}
            <div className="absolute right-6 bottom-16 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] backdrop-blur px-4 py-2 animate-floaty-2">
              <FileCheck2 className="w-4 h-4 text-emerald-300" />
              <span className="text-xs text-white/70">policy v3 · within budget</span>
            </div>

            {/* status chip */}
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 flex items-center gap-2 rounded-full bg-emerald-400 text-black px-4 py-2 animate-floaty">
              <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
              <span className="text-xs font-medium">agent active · settled on-chain</span>
            </div>
          </div>
        </div>
        <ChevronDown className="absolute bottom-6 left-1/2 -translate-x-1/2 w-6 h-6 text-white/40 animate-bounce" />
      </section>

      {/* Subsystems */}
      <section id="platform" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <div className="text-emerald-300 text-sm font-medium mb-3">Platform</div>
            <h2 className="font-serif text-3xl lg:text-5xl font-normal tracking-tight mb-4">
              Five subsystems, one coherent platform
            </h2>
            <p className="text-gray-300 text-lg font-light">
              Built like AWS — separate services, one shared identity and policy layer, talking over well-defined APIs
              and an event bus.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {subsystems.map((s) => (
              <div key={s.title} className="group relative bg-white/[0.03] border border-white/10 rounded-xl p-6 hover:border-emerald-400/40 transition-all duration-300">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-xl" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center group-hover:bg-emerald-400/20 transition-colors">
                      <s.icon className="w-5 h-5 text-emerald-300" />
                    </div>
                    <span className="font-mono text-xs text-white/40">{s.tag}</span>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                  <p className="text-sm text-gray-400 font-light leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
            <div className="bg-emerald-400 text-black rounded-xl p-6 flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-lg bg-black/10 flex items-center justify-center mb-4">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold mb-2">One guarantee</h3>
                <p className="text-sm text-black/70 font-light leading-relaxed">
                  No prompt, jailbreak, or hallucination can move money or exceed a budget — the model never has direct
                  write access to funds.
                </p>
              </div>
              <Link href={CONSOLE_URL} target="_blank" className="mt-6 flex items-center gap-1.5 text-sm font-medium hover:underline">
                Start building <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-24 px-6 bg-white/[0.02] border-y border-white/10">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-12">
            <div className="text-emerald-300 text-sm font-medium mb-3">How it works</div>
            <h2 className="font-serif text-3xl lg:text-5xl font-normal tracking-tight mb-4">
              Every spend goes through the same gate
            </h2>
            <p className="text-gray-300 text-lg font-light">
              One synchronous, low-latency pipeline for every write path in the platform.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            {pipeline.map((p, i) => (
              <div key={p.step} className="relative bg-white/[0.03] border border-white/10 rounded-xl p-6">
                <div className="text-5xl font-serif text-white/10 absolute top-4 right-5">{i + 1}</div>
                <div className="w-10 h-10 rounded-lg bg-emerald-400/15 flex items-center justify-center mb-4">
                  <p.icon className="w-5 h-5 text-emerald-300" />
                </div>
                <div className="text-emerald-300 text-sm font-medium mb-1">{p.step}</div>
                <p className="text-sm text-gray-400 font-light">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-24 px-6">
        <div className="max-w-7xl mx-auto grid gap-10 lg:grid-cols-2 items-center">
          <div>
            <div className="text-emerald-300 text-sm font-medium mb-3">Security</div>
            <h2 className="font-serif text-3xl lg:text-5xl font-normal tracking-tight mb-6">
              The LLM proposes. It never authorizes.
            </h2>
            <p className="text-gray-300 text-lg font-light mb-8">
              Policy, identity, and treasury are deterministic services. An agent only ever receives a signed,
              single-use, short-lived token for a pre-approved action — and the treasury co-signs against nothing else.
            </p>
            <div className="space-y-3">
              {[
                'No signing keys in the agent runtime — custody stays in a key-management boundary.',
                'Spend tokens are bound to exact amount, chain, category, and payee — single-use, 30-second expiry.',
                'Settlement goes only to the provider\u2019s registered payout address.',
                'Delegation can only narrow, never widen — enforced at every level.',
                'Every action produces an immutable, hash-chained receipt.',
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm text-gray-300 font-light">
                  <ShieldCheck className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-8">
            <div className="font-mono text-xs text-white/40 mb-4">POST /v1/spend-intents</div>
            <pre className="font-mono text-sm leading-relaxed overflow-auto">{`{
  "agent_id": "agt_7c81e2",
  "amount": "3.00",
  "category": "data-purchase",
  "chain": "polygon_amoy",
  "counterparty": "prv_aave"
}

→ {
  "decision": "allow",
  "spend_token": "v1.eyJ2IjoxLC...",
  "requires_human_approval": false
}`}</pre>
          </div>
        </div>
      </section>

      {/* Ecosystem / CTA */}
      <section id="ecosystem" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-gradient-to-br from-emerald-400 to-emerald-500 text-black rounded-2xl p-10 lg:p-14 text-center">
            <h2 className="font-serif text-3xl lg:text-5xl font-normal tracking-tight mb-4">
              Build an agent that can actually do things
            </h2>
            <p className="text-black/70 text-lg font-light max-w-2xl mx-auto mb-8">
              Register an agent, fund it, set a policy, and let it discover tools, buy data, transact with other
              agents — and measurably improve itself.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href={CONSOLE_URL}
                target="_blank"
                className="rounded-lg bg-black text-white font-medium px-8 py-3 text-base hover:bg-black/80 transition-colors"
              >
                Get Started <ArrowRight className="inline w-4 h-4 ml-1" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center">
              <PaperBagIcon className="w-4 h-4 text-black" />
            </div>
            <span className="text-sm font-medium">bagseven</span>
          </div>
          <p className="text-white/50 text-xs font-light">
            © {new Date().getFullYear()} bagseven. The trust &amp; settlement layer for autonomous AI agents.
          </p>
        </div>
      </footer>
    </div>
  );
}
