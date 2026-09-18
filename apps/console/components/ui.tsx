'use client';

import { useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {title && (
        <div className="card-title">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
}

export function Button({ variant = 'primary', className = '', ...rest }: BtnProps) {
  const cls = variant === 'primary' ? 'btn' : variant === 'ghost' ? 'btn ghost' : 'btn danger';
  return <button className={`${cls} ${className}`} {...rest} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

const PILL_TONE: Record<string, string> = {
  allow: 'ok',
  ok: 'ok',
  active: 'ok',
  paid: 'ok',
  committed: 'ok',
  deny: 'bad',
  denied: 'bad',
  error: 'bad',
  suspended: 'bad',
  retired: 'bad',
  pending_approval: 'warn',
  pending: 'warn',
  expired: 'warn',
  info: 'info',
};

export function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`pill ${PILL_TONE[tone] ?? 'info'}`}>{children}</span>;
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return <pre className="code">{children}</pre>;
}

export function Copy({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      title="copy"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? '✓' : label ?? 'copy'}
    </button>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = ['active'].includes(status) ? 'active' : ['suspended', 'retired'].includes(status) ? status : 'pending';
  return (
    <span className={`status-pill pill ${PILL_TONE[tone] ?? 'warn'}`}>
      <span className={`led ${status}`} />
      {status}
    </span>
  );
}