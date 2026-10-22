import React from 'react';
export const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
export const pct = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${fmt(value, 1)}%` : '—';
export const label = value => value.replaceAll('_', ' ');
export function Notice({ children, type = 'info' }) { return <div className={`notice ${type}`}>{children}</div>; }
export function Warnings({ items = [] }) { return items.length ? <div className="warning-list">{items.map((text, i) => <Notice type="warning" key={i}>{text}</Notice>)}</div> : null; }
export function Metric({ title, value, detail }) { return <div className="summary-card"><span>{title}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
export function Empty({ children }) { return <section className="empty-state"><span className="empty-icon">↗</span><h2>More evidence needed</h2><p>{children}</p></section>; }
