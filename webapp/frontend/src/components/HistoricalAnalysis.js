import React, { useState } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { request, download } from '../api';
import { fmt, pct, label, Metric, Notice, Warnings } from './shared';

const POOLED = '';
const signed = (value, digits = 2) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${fmt(value, digits)}` : '—';

export default function HistoricalAnalysis({ dataset, onBusy }) {
  const [filters, setFilters] = useState({ crop: dataset.crops[0], district: dataset.districts[0] || POOLED, season: dataset.seasons[0] || POOLED, year_min: dataset.year_min, year_max: dataset.year_max, split_year: Math.floor((dataset.year_min + dataset.year_max) / 2) + 1, yield_threshold: '', aggregation: 'mean', rolling_window: 0, anomaly_z: 1.5 });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState('Crop_Yield');
  const [showTrend, setShowTrend] = useState(true);
  const units = { Crop_Yield: dataset.yield_unit, Rainfall_mm: 'mm', Avg_Temperature_C: '°C', Market_Price: dataset.price_unit };
  const change = (key, value) => { setFilters(previous => ({ ...previous, [key]: value })); setResult(null); setError(''); };
  const run = async e => {
    e.preventDefault(); setBusy(true); onBusy(true); setError(''); setResult(null);
    try { setResult(await request('history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); onBusy(false); }
  };
  const trend = result?.trends.find(row => row.metric === metric);
  const firstYear = result?.annual[0]?.Year;
  const chartData = result?.annual.map(row => ({ ...row, trend_line: showTrend && trend?.slope_per_year !== null && trend ? trendValue(result.annual, metric, trend.slope_per_year, row.Year) : null }));
  const anomalyYears = new Set(result?.anomalies.years.map(row => row.year) || []);
  return <section><p className="eyebrow">HISTORICAL ANALYSIS / PATTERNS & LIMITS</p><h2>Understand what changed.</h2><p className="muted">Compare observed periods for a crop, one location or all locations pooled. Investigate variability, trends, unusual years and climate associations before forming a hypothesis.</p>
    <form className="section" onSubmit={run}><fieldset disabled={busy}><div className="form-grid">
      <label>Crop<select value={filters.crop} onChange={e => change('crop', e.target.value)}>{dataset.crops.map(value => <option key={value}>{value}</option>)}</select></label>
      {[['district', 'District', dataset.districts, 'All districts (pooled)'], ['season', 'Season', dataset.seasons, 'All seasons (pooled)']].filter(([, , values]) => values.length).map(([key, name, values, pooledLabel]) => <label key={key}>{name}<select value={filters[key]} onChange={e => change(key, e.target.value)}>{values.length > 1 && <option value={POOLED}>{pooledLabel}</option>}{values.map(value => <option key={value}>{value}</option>)}</select></label>)}
      {[['year_min', 'Start year'], ['year_max', 'End year'], ['split_year', 'Recent period starts']].map(([key, name]) => <label key={key}>{name}<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters[key]} onChange={e => change(key, e.target.value)} /></label>)}
      <label>Yield threshold ({dataset.yield_unit})<input required type="number" min="0" max="10000000" step="any" placeholder="Your comparison threshold" value={filters.yield_threshold} onChange={e => change('yield_threshold', e.target.value)} /></label>
    </div>
      <details className="advanced-options"><summary>Advanced options</summary><div className="form-grid">
        <label>Annual summary<select value={filters.aggregation} onChange={e => change('aggregation', e.target.value)}><option value="mean">Mean of records</option><option value="median">Median of records (robust to outliers)</option></select></label>
        <label>Rolling average<select value={filters.rolling_window} onChange={e => change('rolling_window', Number(e.target.value))}><option value={0}>Off</option>{[3, 4, 5, 7].map(n => <option key={n} value={n}>{n}-year trailing</option>)}</select></label>
        <label>Unusual-year threshold<select value={filters.anomaly_z} onChange={e => change('anomaly_z', Number(e.target.value))}>{[1, 1.5, 2, 2.5].map(z => <option key={z} value={z}>±{z} standard deviations</option>)}</select></label>
      </div></details>
      <button type="submit">{busy ? 'Analyzing history…' : 'Analyze historical patterns ↗'}</button></fieldset><p className="note">Choose a threshold in this dataset’s yield units. It is your screening criterion, not an agronomic safety limit.</p></form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <><div className="section-heading spaced"><h3>Evidence for this selection{result.pooled.length ? ` · pooled ${result.pooled.map(c => c.toLowerCase() + 's').join(' & ')}` : ''}</h3><div className="button-group"><button className="secondary" onClick={() => download(csvFrom(result.annual), 'orqivra-history-annual.csv', 'text/csv')}>Annual CSV ↓</button><button className="secondary" onClick={() => download(JSON.stringify({ dataset: dataset.filename, units, ...result }, null, 2), 'orqivra-history.json', 'application/json')}>Export historical analysis ↓</button></div></div>
      <div className="summary-grid"><Metric title="Observed years" value={result.years} detail={`${result.rows} source rows`} /><Metric title={`${result.aggregation === 'median' ? 'Median-based' : 'Mean'} annual yield`} value={`${fmt(result.variability.mean)} ${dataset.yield_unit}`} detail={`Range ${fmt(result.variability.minimum)}–${fmt(result.variability.maximum)}`} /><Metric title="Yield variability (CV)" value={result.variability.cv_percent === null ? 'Unavailable' : `${fmt(result.variability.cv_percent)}%`} detail="Sample standard deviation / mean" /><Metric title="Years below your threshold" value={`${result.threshold.below_years.length} / ${result.years}`} detail={`${fmt(result.threshold.below_percent)}% of observed years`} /><Metric title="Yield trend" value={trendOf(result, 'Crop_Yield')} detail={statusOf(result, 'Crop_Yield')} /></div>
      <Notice>{result.threshold.note} Years: {result.threshold.below_years.join(', ') || 'None'}.</Notice>
      <div className="section spaced"><div className="chart-controls"><label>Chart measure<select value={metric} onChange={e => setMetric(e.target.value)}>{Object.keys(units).map(key => <option key={key} value={key}>{label(key)} ({units[key]})</option>)}</select></label><label className="inline-check"><input type="checkbox" checked={showTrend} onChange={e => setShowTrend(e.target.checked)} />Show linear trend</label></div>
        <p className="note">Points show annual {result.aggregation}s{metric === 'Crop_Yield' && anomalyYears.size ? '; larger amber points mark unusual years' : ''}. Lines connect observed years and do not fill missing observations.</p>
        <ResponsiveContainer width="100%" height={320}><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} /><YAxis /><Tooltip formatter={(value, name) => [`${fmt(value)} ${units[metric]}`, name]} /><Legend />
          {metric === 'Crop_Yield' && Number(filters.yield_threshold) > 0 && <ReferenceLine y={Number(result.threshold.value)} stroke="#b4462f" strokeDasharray="5 4" label={{ value: 'Your threshold', position: 'insideTopRight', fontSize: 11 }} />}
          <ReferenceLine x={result.recent_years[0] - .5} stroke="#9a9a8a" strokeDasharray="2 4" label={{ value: 'Recent period', position: 'insideTopLeft', fontSize: 11 }} />
          <Line type="linear" dataKey={metric} name={`Annual ${result.aggregation}`} stroke="#28765a" strokeWidth={2} dot={props => <AnomalyDot {...props} highlight={metric === 'Crop_Yield' && anomalyYears.has(props.payload.Year)} />} isAnimationActive={false} />
          {result.rolling_window > 0 && <Line type="monotone" dataKey={`${metric}_rolling`} name={`${result.rolling_window}-year rolling average`} stroke="#c8962e" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
          {showTrend && trend?.slope_per_year !== null && <Line type="linear" dataKey="trend_line" name="Linear trend" stroke="#6b7c8f" strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
        </ComposedChart></ResponsiveContainer>{firstYear && trend?.slope_per_year === null && showTrend && <p className="note">Trend withheld for this measure: {trend.status.toLowerCase()}.</p>}</div>
      <details className="section"><summary>View annual values and observation counts</summary><div className="table-scroll"><table><thead><tr><th>Year</th><th>Rows</th>{Object.keys(units).map(key => <th key={key}>{label(key)} ({units[key]})</th>)}</tr></thead><tbody>{result.annual.map(row => <tr key={row.Year} className={anomalyYears.has(row.Year) ? 'highlight-row' : ''}><th>{row.Year}</th><td>{row.observations}</td>{Object.keys(units).map(key => <td key={key}>{fmt(row[key])}</td>)}</tr>)}</tbody></table></div></details>
      <h3>Earlier versus recent period</h3><p className="note">Earlier: {result.earlier_years.join(', ')}. Recent: {result.recent_years.join(', ')}. Each observed year receives equal weight.</p><div className="table-scroll"><table><thead><tr><th>Measure</th><th>Earlier mean</th><th>Recent mean</th><th>Difference</th><th>Change</th></tr></thead><tbody>{result.comparisons.map(row => <tr key={row.metric}><th>{label(row.metric)} ({units[row.metric]})</th><td>{fmt(row.earlier)}</td><td>{fmt(row.recent)}</td><td>{fmt(row.difference)}</td><td>{pct(row.change_percent)}</td></tr>)}</tbody></table></div><p className="note">Percentage change is withheld for Celsius temperature and zero baselines.</p>
      <h3>Long-run linear trends</h3><div className="table-scroll"><table><thead><tr><th>Measure</th><th>Change per year</th><th>Change per decade</th><th>R²</th><th>p-value</th><th>Reading</th></tr></thead><tbody>{result.trends.map(row => <tr key={row.metric}><th>{label(row.metric)} ({units[row.metric]})</th><td>{signed(row.slope_per_year, 3)}</td><td>{signed(row.slope_per_decade)}</td><td>{fmt(row.r_squared, 2)}</td><td>{row.p_value === null ? '—' : row.p_value < .001 ? '< 0.001' : fmt(row.p_value, 3)}</td><td>{row.status}</td></tr>)}</tbody></table></div><p className="note">Ordinary least-squares line through observed annual values. A trend describes the past; it is not a projection.</p>
      <h3>Unusual years</h3>{result.anomalies.years.length ? <div className="table-scroll"><table><thead><tr><th>Year</th><th>Yield ({dataset.yield_unit})</th><th>Standard deviations</th><th>Direction</th><th>Rainfall vs average</th><th>Temperature vs average</th></tr></thead><tbody>{result.anomalies.years.map(row => <tr key={row.year}><th>{row.year}</th><td>{fmt(row.yield)}</td><td>{signed(row.z_score)}</td><td><span className={`badge ${row.direction === 'Low' ? 'amber' : ''}`}>{row.direction}</span></td><td>{signed(row.rainfall_vs_mean, 0)} mm</td><td>{signed(row.temperature_vs_mean)} °C</td></tr>)}</tbody></table></div> : <p className="muted">No observed year lies beyond ±{result.anomalies.threshold_z} standard deviations for this selection.</p>}<p className="note">{result.anomalies.note}</p>
      <h3>Association with annual yield</h3><div className="summary-grid">{result.associations.map(row => <Metric key={row.metric} title={label(row.metric)} value={row.pearson_r === null ? 'Withheld' : `r = ${fmt(row.pearson_r, 3)}`} detail={`${row.years} years · ${row.status}`} />)}</div><p className="note">Pearson r ranges from −1 to +1 and describes a linear association. It is neither forecast accuracy nor evidence that changing rainfall or temperature will cause a yield change.</p><Warnings items={result.warnings} />
    </>}
  </section>;

  function trendOf(data, key) {
    const row = data.trends.find(item => item.metric === key);
    return row?.slope_per_decade === null || !row ? 'Withheld' : `${signed(row.slope_per_decade)} ${units[key]}/decade`;
  }
  function statusOf(data, key) { return data.trends.find(item => item.metric === key)?.status || ''; }
}

function trendValue(annual, metric, slope, year) {
  const rows = annual.filter(row => Number.isFinite(row[metric]));
  const meanYear = rows.reduce((sum, row) => sum + row.Year, 0) / rows.length;
  const meanValue = rows.reduce((sum, row) => sum + row[metric], 0) / rows.length;
  return meanValue + slope * (year - meanYear);
}

function AnomalyDot({ cx, cy, highlight }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return highlight ? <circle cx={cx} cy={cy} r={6} fill="#c8962e" stroke="#7a5a12" strokeWidth={1.5} /> : <circle cx={cx} cy={cy} r={3} fill="#fffefa" stroke="#28765a" strokeWidth={2} />;
}

function csvFrom(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const cell = value => value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? '' : String(value);
  return [columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\n');
}
