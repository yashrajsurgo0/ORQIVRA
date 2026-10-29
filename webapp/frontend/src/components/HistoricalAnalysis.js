import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { request, download } from '../api';
import { fmt, pct, label, Metric, Notice, Warnings } from './shared';

export default function HistoricalAnalysis({ dataset, onBusy }) {
  const [filters, setFilters] = useState({ crop: dataset.crops[0], district: dataset.districts[0] || '', season: dataset.seasons[0] || '', year_min: dataset.year_min, year_max: dataset.year_max, split_year: Math.floor((dataset.year_min + dataset.year_max) / 2) + 1, yield_threshold: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState('Crop_Yield');
  const units = { Crop_Yield: dataset.yield_unit, Rainfall_mm: 'mm', Avg_Temperature_C: '°C', Market_Price: dataset.price_unit };
  const change = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setResult(null); setError(''); };
  const run = async e => {
    e.preventDefault(); setBusy(true); onBusy(true); setError(''); setResult(null);
    try { setResult(await request('history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); onBusy(false); }
  };
  return <section><p className="eyebrow">HISTORICAL ANALYSIS / PATTERNS & LIMITS</p><h2>Understand what changed.</h2><p className="muted">Compare observed periods within one crop, district and season. Investigate variability and climate associations before forming a hypothesis.</p>
    <form className="section" onSubmit={run}><fieldset disabled={busy}><div className="form-grid">
      {[['crop', 'Crop', dataset.crops], ['district', 'District', dataset.districts], ['season', 'Season', dataset.seasons]].filter(([, , values]) => values.length).map(([key, name, values]) => <label key={key}>{name}<select value={filters[key]} onChange={e => change(key, e.target.value)}>{values.map(value => <option key={value}>{value}</option>)}</select></label>)}
      {[['year_min', 'Start year'], ['year_max', 'End year'], ['split_year', 'Recent period starts']].map(([key, name]) => <label key={key}>{name}<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters[key]} onChange={e => change(key, e.target.value)} /></label>)}
      <label>Yield threshold ({dataset.yield_unit})<input required type="number" min="0" max="10000000" step="any" placeholder="Your comparison threshold" value={filters.yield_threshold} onChange={e => change('yield_threshold', e.target.value)} /></label>
    </div><button type="submit">{busy ? 'Analyzing history…' : 'Analyze historical patterns ↗'}</button></fieldset><p className="note">Choose a threshold in this dataset’s yield units. It is your screening criterion, not an agronomic safety limit.</p></form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <><div className="section-heading spaced"><h3>Evidence for this selection</h3><button className="secondary" onClick={() => download(JSON.stringify({ dataset: dataset.filename, units, ...result }, null, 2), 'orqivra-history.json', 'application/json')}>Export historical analysis ↓</button></div>
      <div className="summary-grid"><Metric title="Observed years" value={result.years} detail={`${result.rows} source rows`} /><Metric title="Mean annual yield" value={`${fmt(result.variability.mean)} ${dataset.yield_unit}`} /><Metric title="Yield variability (CV)" value={result.variability.cv_percent === null ? 'Unavailable' : `${fmt(result.variability.cv_percent)}%`} detail="Sample standard deviation / mean" /><Metric title="Years below your threshold" value={`${result.threshold.below_years.length} / ${result.years}`} detail={`${fmt(result.threshold.below_percent)}% of observed years`} /></div>
      <Notice>{result.threshold.note} Years: {result.threshold.below_years.join(', ') || 'None'}.</Notice>
      <div className="section spaced"><label>Chart measure<select value={metric} onChange={e => setMetric(e.target.value)}>{Object.keys(units).map(key => <option key={key} value={key}>{label(key)} ({units[key]})</option>)}</select></label><p className="note">Points show annual means. Lines connect observed years and do not fill missing observations.</p><ResponsiveContainer width="100%" height={300}><LineChart data={result.annual}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} /><YAxis /><Tooltip formatter={value => `${fmt(value)} ${units[metric]}`} /><Line type="linear" dataKey={metric} name={label(metric)} stroke="#28765a" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>
      <details className="section"><summary>View annual values and observation counts</summary><div className="table-scroll"><table><thead><tr><th>Year</th><th>Rows</th>{Object.keys(units).map(key => <th key={key}>{label(key)} ({units[key]})</th>)}</tr></thead><tbody>{result.annual.map(row => <tr key={row.Year}><th>{row.Year}</th><td>{row.observations}</td>{Object.keys(units).map(key => <td key={key}>{fmt(row[key])}</td>)}</tr>)}</tbody></table></div></details>
      <h3>Earlier versus recent period</h3><p className="note">Earlier: {result.earlier_years.join(', ')}. Recent: {result.recent_years.join(', ')}. Each observed year receives equal weight.</p><div className="table-scroll"><table><thead><tr><th>Measure</th><th>Earlier mean</th><th>Recent mean</th><th>Difference</th><th>Change</th></tr></thead><tbody>{result.comparisons.map(row => <tr key={row.metric}><th>{label(row.metric)} ({units[row.metric]})</th><td>{fmt(row.earlier)}</td><td>{fmt(row.recent)}</td><td>{fmt(row.difference)}</td><td>{pct(row.change_percent)}</td></tr>)}</tbody></table></div><p className="note">Percentage change is withheld for Celsius temperature and zero baselines.</p>
      <h3>Association with annual yield</h3><div className="summary-grid">{result.associations.map(row => <Metric key={row.metric} title={label(row.metric)} value={row.pearson_r === null ? 'Withheld' : `r = ${fmt(row.pearson_r, 3)}`} detail={`${row.years} years · ${row.status}`} />)}</div><p className="note">Pearson r ranges from −1 to +1 and describes a linear association. It is neither forecast accuracy nor evidence that changing rainfall or temperature will cause a yield change.</p><Warnings items={result.warnings} />
    </>}
  </section>;
}
