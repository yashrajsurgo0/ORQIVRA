import React, { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';
import { request, download } from '../api';
import { fmt, Metric, Notice, Warnings, Term, Takeaway, PageIntro } from './shared';

const POOLED = '';
const signed = (value, digits = 1) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${fmt(value, digits)}` : '—';
const strength = r => r === null ? 'Not enough shared years' : r >= .6 ? 'Good and bad years strongly coincide' : r >= .3 ? 'Good and bad years often coincide' : r > -.3 ? 'Largely independent' : 'Tend to balance each other';
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
  return <section><PageIntro eyebrow="CROP PORTFOLIO" title="Which crops are steadiest, and do they balance each other?" purpose="Compares how much each crop’s yield swings from year to year and how bad its worst year was, then checks whether crops tend to have bad years at the same time. Crops that don’t move together spread your risk." />
    <form className="section" onSubmit={run}><fieldset disabled={busy}><div className="form-grid">
      {[['district', 'District', dataset.districts, 'All districts combined'], ['season', 'Season', dataset.seasons, 'All seasons combined']].filter(([, , values]) => values.length).map(([key, name, values, pooledLabel]) => <label key={key}>{name}<select value={filters[key]} onChange={e => change(key, e.target.value)}>{values.length > 1 && <option value={POOLED}>{pooledLabel}</option>}{values.map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>Start year<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.year_min} onChange={e => change('year_min', e.target.value)} /></label>
      <label>End year<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.year_max} onChange={e => change('year_max', e.target.value)} /></label>
    </div><p className="note">Choose 2–8 crops.</p><div className="district-options">{dataset.crops.map(crop => <label key={crop}><input type="checkbox" checked={filters.crops.includes(crop)} onChange={e => change('crops', e.target.checked ? [...filters.crops, crop] : filters.crops.filter(x => x !== crop))} />{crop}</label>)}</div>
      <button type="submit">{busy ? 'Comparing…' : 'Compare crops ↗'}</button></fieldset></form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <><div className="section-heading spaced"><h3>{usable.length} crops · {result.shared_years.length} shared years</h3><button className="secondary" onClick={() => download(JSON.stringify({ dataset: dataset.filename, fingerprint: dataset.quality.fingerprint, source: dataset.source_type, ...result }, null, 2), 'orqivra-crop-portfolio.json', 'application/json')}>Export portfolio ↓</button></div>
      <Takeaway items={portfolioSummary(result, available, stablest)} tone={result.diversification?.reduction_percent >= 20 ? 'good' : 'info'} />
      <div className="summary-grid"><Metric title="Steadiest crop" term="cv" value={stablest ? stablest.crop : '—'} tone="good" detail={stablest ? `Typical swing ±${fmt(stablest.cv_percent, 1)}% a year` : ''} />
        {result.diversification && <><Metric title="Swing growing one crop" value={`±${fmt(result.diversification.average_crop_cv_percent, 1)}%`} detail="Average across the crops" /><Metric title="Swing growing all of them" term="diversification" value={`±${fmt(result.diversification.portfolio_cv_percent, 1)}%`} tone="good" detail="Equal share of each crop" /><Metric title="Risk reduction from mixing" value={result.diversification.reduction_percent === null ? '—' : `${fmt(result.diversification.reduction_percent, 0)}%`} tone={result.diversification.reduction_percent >= 20 ? 'good' : undefined} detail="Steadier than a single crop" /></>}</div>
      <div className="viz-grid spaced"><div className="section"><h3>How much each crop swings year to year</h3><p className="note">Shorter bar = steadier yields. The steadiest crop is dark green.</p><ResponsiveContainer width="100%" height={260}><BarChart data={available}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="crop" /><YAxis unit="%" /><Tooltip formatter={value => `${fmt(value)}%`} /><Bar dataKey="cv_percent" name="Coefficient of variation" isAnimationActive={false}>{available.map(row => <Cell key={row.crop} fill={row === stablest ? '#28765a' : '#9dbfa9'} />)}</Bar></BarChart></ResponsiveContainer></div>
        {result.diversification && <div className="section"><h3>A mix of all crops, year by year</h3><p className="note">1.0 = every crop at its normal yield. Dips are years when the crops struggled together.</p><ResponsiveContainer width="100%" height={260}><LineChart data={result.diversification.index}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} /><YAxis domain={['auto', 'auto']} /><Tooltip formatter={value => fmt(value, 3)} /><ReferenceLine y={1} stroke="#9a9a8a" strokeDasharray="4 4" /><Line type="linear" dataKey="index" name="Relative yield index" stroke="#28765a" strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>}</div>
      <h3 className="spaced">Crop by crop</h3><div className="table-scroll"><table><thead><tr><th>Crop</th><th>Years</th><th>Typical yield ({result.yield_unit})</th><th><Term id="cv">Yearly swing</Term></th><th>Worst year</th><th>Worst year vs normal</th><th>Share of poor years</th><th><Term id="trend">Trend per year</Term></th><th><Term id="pearson">Link with rainfall</Term></th></tr></thead><tbody>{result.summary.map(row => row.status !== 'Available' ? <tr key={row.crop}><th>{row.crop}</th><td>{row.years}</td><td colSpan={7}>{row.status}</td></tr> : <tr key={row.crop}><th>{row.crop}</th><td>{row.years}</td><td>{fmt(row.mean_yield, 3)}</td><td>±{fmt(row.cv_percent, 1)}%</td><td>{row.worst_year}</td><td>{signed(row.worst_shortfall_percent)}%</td><td>{fmt(row.low_years_percent, 0)}%</td><td title={row.trend_status}>{signed(row.trend_percent_per_year, 2)}%</td><td>{row.rainfall_r === null ? '—' : `${Math.abs(row.rainfall_r) < .3 ? 'Little' : Math.abs(row.rainfall_r) < .6 ? 'Moderate' : 'Strong'}${Math.abs(row.rainfall_r) >= .3 ? (row.rainfall_r > 0 ? ', together' : ', opposite') : ''} (r ${fmt(row.rainfall_r, 2)})`}</td></tr>)}</tbody></table></div><p className="note">“Poor years” are more than one standard deviation below the crop’s own normal. Percentages compare each crop with itself, so different crops are fair to compare.</p>
      {usable.length >= 2 && <><h3 className="spaced">Do these crops have bad years at the same time?</h3><div className="table-scroll"><table className="corr-table"><thead><tr><th />{usable.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{usable.map(a => <tr key={a}><th>{a}</th>{usable.map(b => { const r = corr(a, b); return <td key={b} style={{ background: a === b ? 'transparent' : corrColor(r) }} title={a === b ? '' : strength(r)}>{a === b ? '—' : r === null ? 'n/a' : fmt(r, 2)}</td>; })}</tr>)}</tbody></table></div>
        <p className="note"><Term id="pearson">Correlation</Term> between yearly yields over {result.shared_years.length} shared years. <strong>Green</strong>: good and bad years tend not to coincide, so growing both spreads risk. <strong>Red</strong>: they rise and fall together. Hover a cell for a plain reading.</p></>}
      <Warnings items={[...(result.diversification ? [result.diversification.note] : []), ...result.warnings]} />
    </>}
  </section>;
}

function portfolioSummary(result, available, stablest) {
  const lines = [];
  const bumpiest = [...available].filter(r => r.cv_percent !== null).sort((a, b) => b.cv_percent - a.cv_percent)[0];
  if (stablest) lines.push(`${stablest.crop} has been the steadiest crop (a typical year within ±${fmt(stablest.cv_percent, 0)}% of normal)${bumpiest && bumpiest !== stablest ? `; ${bumpiest.crop} swings the most (±${fmt(bumpiest.cv_percent, 0)}%)` : ''}.`);
  const d = result.diversification;
  if (d && d.reduction_percent !== null) lines.push(d.reduction_percent >= 10 ? `Growing all ${available.length} crops together would have made yields about ${fmt(d.reduction_percent, 0)}% steadier than growing just one, because their bad years rarely lined up.` : 'Mixing these crops would barely have steadied yields: their good and bad years tended to coincide.');
  const pairs = result.correlations.filter(c => c.pearson_r !== null).sort((a, b) => a.pearson_r - b.pearson_r);
  if (pairs.length) lines.push(`Best natural pair: ${pairs[0].crop_a} and ${pairs[0].crop_b} (${strength(pairs[0].pearson_r).toLowerCase()}).`);
  return lines;
}
