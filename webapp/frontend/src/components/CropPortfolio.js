import React, { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import { request, download } from '../api';
import { fmt, Metric, Notice, Warnings } from './shared';

const POOLED = '';
const signed = (value, digits = 1) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${fmt(value, digits)}` : '—';
const strength = r => r === null ? 'Withheld' : r >= .6 ? 'Move together strongly' : r >= .3 ? 'Move together' : r > -.3 ? 'Largely independent' : 'Tend to offset';
const corrColor = r => r === null ? 'transparent' : r >= 0 ? `rgba(180, 70, 47, ${Math.min(.65, Math.abs(r) * .65)})` : `rgba(40, 118, 90, ${Math.min(.65, Math.abs(r) * .65)})`;

export default function CropPortfolio({ dataset, onBusy }) {
  const [filters, setFilters] = useState({ district: POOLED, season: POOLED, year_min: dataset.year_min, year_max: dataset.year_max, crops: dataset.crops.slice(0, 8) });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setResult(null); setError(''); };
  const run = async e => {
    e.preventDefault(); setBusy(true); onBusy(true); setError(''); setResult(null);
    try { setResult(await request('portfolio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); onBusy(false); }
  };
  if (dataset.crops.length < 2) return <section><p className="eyebrow">CROP PORTFOLIO</p><h2>Compare crop stability.</h2><Notice>This dataset contains one crop. Upload observations for at least two crops to compare stability and diversification.</Notice></section>;
  const available = result?.summary.filter(row => row.status === 'Available') || [];
  const stablest = [...available].filter(row => row.cv_percent !== null).sort((a, b) => a.cv_percent - b.cv_percent)[0];
  const usable = available.map(row => row.crop);
  const corr = (a, b) => a === b ? 1 : result.correlations.find(row => (row.crop_a === a && row.crop_b === b) || (row.crop_a === b && row.crop_b === a))?.pearson_r ?? null;
  return <section><p className="eyebrow">CROP PORTFOLIO / STABILITY & DIVERSIFICATION</p><h2>Which crops have been steadiest — and do they move together?</h2><p className="muted">Compare year-to-year stability, worst-year shortfalls and long-run tendencies across crops, then check whether their yields historically rose and fell together. Unit-free measures make different crops comparable.</p>
    <form className="section" onSubmit={run}><fieldset disabled={busy}><div className="form-grid">
      {[['district', 'District', dataset.districts, 'All districts (pooled)'], ['season', 'Season', dataset.seasons, 'All seasons (pooled)']].filter(([, , values]) => values.length).map(([key, name, values, pooledLabel]) => <label key={key}>{name}<select value={filters[key]} onChange={e => change(key, e.target.value)}>{values.length > 1 && <option value={POOLED}>{pooledLabel}</option>}{values.map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>Start year<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.year_min} onChange={e => change('year_min', e.target.value)} /></label>
      <label>End year<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.year_max} onChange={e => change('year_max', e.target.value)} /></label>
    </div><p className="note">Choose 2–8 crops.</p><div className="district-options">{dataset.crops.map(crop => <label key={crop}><input type="checkbox" checked={filters.crops.includes(crop)} onChange={e => change('crops', e.target.checked ? [...filters.crops, crop] : filters.crops.filter(x => x !== crop))} />{crop}</label>)}</div>
      <button type="submit">{busy ? 'Comparing crops…' : 'Compare crop portfolio ↗'}</button></fieldset></form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <><div className="section-heading spaced"><h3>{usable.length} crops · {result.shared_years.length} shared years</h3><button className="secondary" onClick={() => download(JSON.stringify({ dataset: dataset.filename, fingerprint: dataset.quality.fingerprint, source: dataset.source_type, ...result }, null, 2), 'orqivra-crop-portfolio.json', 'application/json')}>Export portfolio ↓</button></div>
      <div className="summary-grid"><Metric title="Steadiest crop" value={stablest ? stablest.crop : '—'} detail={stablest ? `CV ${fmt(stablest.cv_percent)}%` : ''} />
        {result.diversification && <><Metric title="Average single-crop CV" value={`${fmt(result.diversification.average_crop_cv_percent)}%`} /><Metric title="Mixed-portfolio CV" value={`${fmt(result.diversification.portfolio_cv_percent)}%`} detail="Equal weight, relative yields" /><Metric title="Variability reduction" value={result.diversification.reduction_percent === null ? '—' : `${fmt(result.diversification.reduction_percent, 0)}%`} detail="Mix vs average crop" /></>}</div>
      <div className="viz-grid spaced"><div className="section"><h3>Year-to-year variability (CV %)</h3><p className="note">Lower bars mean steadier annual yields. Measured on each crop’s own scale.</p><ResponsiveContainer width="100%" height={260}><BarChart data={available}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="crop" /><YAxis unit="%" /><Tooltip formatter={value => `${fmt(value)}%`} /><Bar dataKey="cv_percent" name="Coefficient of variation" isAnimationActive={false}>{available.map(row => <Cell key={row.crop} fill={row === stablest ? '#28765a' : '#9dbfa9'} />)}</Bar></BarChart></ResponsiveContainer></div>
        {result.diversification && <div className="section"><h3>Mixed portfolio index</h3><p className="note">1.0 = each crop at its own average. Dips show years when crops struggled together.</p><ResponsiveContainer width="100%" height={260}><LineChart data={result.diversification.index}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} /><YAxis domain={['auto', 'auto']} /><Tooltip formatter={value => fmt(value, 3)} /><ReferenceLine y={1} stroke="#9a9a8a" strokeDasharray="4 4" /><Line type="linear" dataKey="index" name="Relative yield index" stroke="#28765a" strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}</div>
      <h3>Crop stability profile</h3><div className="table-scroll"><table><thead><tr><th>Crop</th><th>Years</th><th>Mean yield ({result.yield_unit})</th><th>CV</th><th>Worst year</th><th>Worst-year shortfall</th><th>Years &gt;1 SD below mean</th><th>Trend per year</th><th>Rainfall r</th></tr></thead><tbody>{result.summary.map(row => row.status !== 'Available' ? <tr key={row.crop}><th>{row.crop}</th><td>{row.years}</td><td colSpan={7}>{row.status}</td></tr> : <tr key={row.crop}><th>{row.crop}</th><td>{row.years}</td><td>{fmt(row.mean_yield, 3)}</td><td>{fmt(row.cv_percent)}%</td><td>{row.worst_year}</td><td>{signed(row.worst_shortfall_percent)}%</td><td>{fmt(row.low_years_percent, 0)}%</td><td title={row.trend_status}>{signed(row.trend_percent_per_year, 2)}%</td><td>{row.rainfall_r === null ? '—' : fmt(row.rainfall_r, 2)}</td></tr>)}</tbody></table></div><p className="note">Shortfall and trend are relative to each crop’s own mean. Rainfall r is a descriptive annual association, not a causal sensitivity.</p>
      {usable.length >= 2 && <><h3>Do yields move together?</h3><div className="table-scroll"><table className="corr-table"><thead><tr><th />{usable.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{usable.map(a => <tr key={a}><th>{a}</th>{usable.map(b => { const r = corr(a, b); return <td key={b} style={{ background: a === b ? 'transparent' : corrColor(r) }} title={a === b ? '' : strength(r)}>{a === b ? '—' : r === null ? 'n/a' : fmt(r, 2)}</td>; })}</tr>)}</tbody></table></div>
        <p className="note">Pearson r between annual yields over {result.shared_years.length} shared years. Green pairs tended to offset each other (natural hedge); red pairs rose and fell together.</p></>}
      {result.diversification && <Notice>{result.diversification.note}</Notice>}
      <Warnings items={result.warnings} />
    </>}
  </section>;
}
