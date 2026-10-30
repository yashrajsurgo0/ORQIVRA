import React, { useId, useRef, useState } from 'react';

export const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
export const pct = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${fmt(value, 1)}%` : '—';

// Plain names for dataset columns, so tables never read "Rainfall mm (mm)".
const NAMES = {
  Crop_Yield: 'Yield', Rainfall_mm: 'Rainfall', Avg_Temperature_C: 'Temperature', Market_Price: 'Price',
  Humidity_Percent: 'Humidity', Soil_pH: 'Soil pH', Irrigation_mm: 'Irrigation', Crop: 'Crop', District: 'District', Season: 'Season', Year: 'Year'
};
export const label = value => NAMES[value] || String(value).replaceAll('_', ' ');

// One place for every technical term the interface uses, explained in everyday language.
export const GLOSSARY = {
  cv: ['Year-to-year variation (CV)', 'How much a value typically swings from year to year, as a percentage of its average. 5% means a typical year lands within about ±5% of normal; above 15% is a bumpy record.'],
  mae: ['Average error (MAE)', 'On years the model never saw, how far its yield predictions were from the real values, on average. Lower is better; it is in the same unit as yield.'],
  rmse: ['RMSE', 'Like average error, but large misses count extra. If it is much bigger than MAE, the model occasionally misses badly.'],
  r2: ['R² (fit)', 'How much of the ups and downs in the data a line or model explains: 1 is a perfect fit, 0 explains nothing. For trends, a low R² means the year-to-year noise is bigger than the trend.'],
  pvalue: ['p-value', 'How likely a trend this steep would appear by chance if nothing were really changing. Below 0.05 is usually treated as a clear trend.'],
  pearson: ['Correlation (r)', 'Whether two things tend to rise and fall together, from −1 (opposite) through 0 (no link) to +1 (together). It does not show that one causes the other.'],
  sd: ['Standard deviations', 'How unusual a year is compared with the normal spread. ±1 is common; beyond ±1.5 is unusual; beyond ±2 is rare.'],
  interval: ['Prediction range (90%)', 'A range that should contain the real yield about 9 times in 10. Coverage shows how often that actually happened on held-out years.'],
  baseline: ['Baseline', 'The simplest possible guess: each crop’s average yield. A useful model must beat it.'],
  importance: ['Importance', 'How much worse the model gets when one input is scrambled. Bigger means the model leans on that input more; it does not mean that input causes yield.'],
  breakeven: ['Break-even', 'The yield or price at which revenue exactly covers costs. Headroom is how far your assumption can fall before you start losing money.'],
  sensitivity: ['Sensitivity grid', 'Your margin recalculated as yield and price each move up or down, so you can see which combinations lose money.'],
  diversification: ['Diversification', 'Growing several crops whose good and bad years do not line up. The portfolio index shows how much steadier the mix was than a single crop.'],
  pooled: ['Pooled', 'All districts or seasons combined into one yearly value. Useful for the big picture, but a change in which places were measured can move the numbers.'],
  median: ['Median', 'The middle value. Unlike the average, one extreme field cannot pull it far.'],
  rolling: ['Rolling average', 'Each point averages that year with the years just before it, smoothing out one-off spikes so the direction is easier to see.'],
  trend: ['Trend', 'A straight line fitted through the yearly values: the typical change per year. It describes the past; it is not a forecast.'],
  signal: ['Review signal', 'A crop–location group whose latest year moved past your thresholds (less rain, more heat, lower yield) compared with its own recent years.'],
  reference: ['Reference years', 'The earlier years each group is compared with. At least three are needed for a fair comparison.']
};

// An inline term with a definition on hover, focus or tap. Positioned in the viewport so tables and scroll areas never clip it.
export function Term({ id, children }) {
  const entry = GLOSSARY[id];
  const tipId = useId();
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  if (!entry) return children;
  const show = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.max(12, Math.min(box.left, window.innerWidth - width - 12));
    const below = box.bottom + 8 + 150 < window.innerHeight;
    setPos({ left, width, ...(below ? { top: box.bottom + 8 } : { bottom: window.innerHeight - box.top + 8 }) });
  };
  const hide = () => setPos(null);
  return <span className="term" ref={ref} tabIndex={0} role="button" aria-describedby={pos ? tipId : undefined} aria-label={`${typeof children === 'string' ? children : entry[0]}: what does this mean?`}
    onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={() => (pos ? hide() : show())} onKeyDown={e => e.key === 'Escape' && hide()}>
    {children || entry[0]}<span className="term-mark" aria-hidden="true">?</span>
    {pos && <span className="term-tip" role="tooltip" id={tipId} style={{ position: 'fixed', ...pos }}><strong>{entry[0]}</strong>{entry[1]}</span>}
  </span>;
}

// A short, plain-language reading of the numbers below it.
export function Takeaway({ title = 'In plain words', items = [], tone = 'info' }) {
  const lines = items.filter(Boolean);
  if (!lines.length) return null;
  return <div className={`takeaway ${tone}`} role="note"><p className="takeaway-title">{title}</p>{lines.length === 1 ? <p className="takeaway-text">{lines[0]}</p> : <ul>{lines.map((text, i) => <li key={i}>{text}</li>)}</ul>}</div>;
}

// A change with an arrow, coloured only when the direction is good or bad for the reader.
export function Delta({ value, good = 'up', unit = '%', digits = 1, threshold = 0 }) {
  if (!Number.isFinite(value)) return <span className="delta none">—</span>;
  const direction = Math.abs(value) <= threshold ? 'flat' : value > 0 ? 'up' : 'down';
  const tone = good === 'neutral' || direction === 'flat' ? 'neutral' : direction === good ? 'good' : 'bad';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  return <span className={`delta ${tone}`}><span aria-hidden="true">{arrow}</span> {value > 0 ? '+' : ''}{fmt(value, digits)}{unit === '%' ? '%' : ` ${unit}`}</span>;
}

export function Notice({ children, type = 'info' }) { return <div className={`notice ${type}`}>{children}</div>; }

// Caveats stay one click away instead of stacking up as a wall of boxes.
export function Warnings({ items = [], open = false, title = 'Keep in mind' }) {
  if (!items.length) return null;
  return <details className="caveats" open={open}><summary>{title} <span className="caveat-count">{items.length}</span></summary><ul>{items.map((text, i) => <li key={i}>{text}</li>)}</ul></details>;
}

export function Metric({ title, value, detail, tone, term }) {
  return <div className={`summary-card ${tone ? `tone-${tone}` : ''}`}><span>{term ? <Term id={term}>{title}</Term> : title}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function Empty({ children }) { return <section className="empty-state"><span className="empty-icon">↗</span><h2>More evidence needed</h2><p>{children}</p></section>; }

// Short guidance under a page title: what the page is for, in one line.
export function PageIntro({ eyebrow, title, purpose, children }) {
  return <header className="page-intro"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="purpose">{purpose}</p>{children}</header>;
}

export const strengthOf = r => {
  if (!Number.isFinite(r)) return 'Not enough data';
  const size = Math.abs(r) >= .6 ? 'Strong' : Math.abs(r) >= .3 ? 'Moderate' : 'Weak or no';
  return Math.abs(r) < .3 ? 'Weak or no link' : `${size} ${r > 0 ? 'positive' : 'negative'} link`;
};

export function Glossary() {
  return <dl className="glossary">{Object.values(GLOSSARY).map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}</dl>;
}
