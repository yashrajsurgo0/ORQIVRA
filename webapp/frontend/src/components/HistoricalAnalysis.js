import React, { useState } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { request, download } from '../api';
import { fmt, label, Metric, Warnings, Term, Takeaway, Delta, PageIntro, strengthOf } from './shared';

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
  const chartData = result?.annual.map(row => ({ ...row, trend_line: showTrend && trend && trend.slope_per_year !== null ? trendValue(result.annual, metric, trend.slope_per_year, row.Year) : null }));
  const anomalyYears = new Set(result?.anomalies.years.map(row => row.year) || []);
  const place = result ? [result.filters.district || 'all districts', result.filters.season || null].filter(Boolean).join(', ') : '';
  return <section><PageIntro eyebrow="HISTORICAL ANALYSIS" title="How has this crop changed over the years?" purpose="Pick a crop and place, then see its long-run trend, how bumpy its yields are, which years were unusual and whether yield moves with rainfall or temperature." />
    <form className="section" onSubmit={run}><fieldset disabled={busy}>
      <fieldset className="form-step"><legend>1 · What to analyze</legend><div className="form-grid">
        <label>Crop<select value={filters.crop} onChange={e => change('crop', e.target.value)}>{dataset.crops.map(value => <option key={value}>{value}</option>)}</select></label>
        {[['district', 'District', dataset.districts, 'All districts combined'], ['season', 'Season', dataset.seasons, 'All seasons combined']].filter(([, , values]) => values.length).map(([key, name, values, pooledLabel]) => <label key={key}>{name}<select value={filters[key]} onChange={e => change(key, e.target.value)}>{values.length > 1 && <option value={POOLED}>{pooledLabel}</option>}{values.map(value => <option key={value}>{value}</option>)}</select></label>)}
      </div></fieldset>
      <fieldset className="form-step"><legend>2 · Time period</legend><div className="form-grid three">
        <label>From<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.year_min} onChange={e => change('year_min', e.target.value)} /></label>
        <label>To<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.year_max} onChange={e => change('year_max', e.target.value)} /></label>
        <label>“Recent” starts in<input required type="number" min={dataset.year_min} max={dataset.year_max} step="1" value={filters.split_year} onChange={e => change('split_year', e.target.value)} /><span className="field-hint">Earlier years are compared with recent ones.</span></label>
      </div></fieldset>
      <details className="advanced-options"><summary>More options</summary><div className="form-grid">
        <label>Flag years below this yield ({dataset.yield_unit}) · optional<input type="number" min="0" max="10000000" step="any" placeholder="e.g. your break-even yield" value={filters.yield_threshold} onChange={e => change('yield_threshold', e.target.value)} /><span className="field-hint">Counts how many years fell short of it.</span></label>
        <label>Yearly value<select value={filters.aggregation} onChange={e => change('aggregation', e.target.value)}><option value="mean">Average of the year’s records</option><option value="median">Middle value (ignores extreme fields)</option></select></label>
        <label>Smoothing line<select value={filters.rolling_window} onChange={e => change('rolling_window', Number(e.target.value))}><option value={0}>None</option>{[3, 4, 5, 7].map(n => <option key={n} value={n}>{n}-year rolling average</option>)}</select></label>
        <label>What counts as an unusual year<select value={filters.anomaly_z} onChange={e => change('anomaly_z', Number(e.target.value))}>{[[1, 'Somewhat unusual (±1 SD)'], [1.5, 'Unusual (±1.5 SD)'], [2, 'Rare (±2 SD)'], [2.5, 'Very rare (±2.5 SD)']].map(([z, text]) => <option key={z} value={z}>{text}</option>)}</select></label>
      </div></details>
      <button type="submit">{busy ? 'Analyzing…' : 'Show the history ↗'}</button></fieldset></form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <>
      <div className="section-heading spaced"><h3>{result.filters.crop} · {place} · {result.annual[0].Year}–{result.annual[result.annual.length - 1].Year}</h3><div className="button-group"><button className="secondary" onClick={() => download(csvFrom(result.annual), 'orqivra-history-annual.csv', 'text/csv')}>Yearly values CSV ↓</button><button className="secondary" onClick={() => download(JSON.stringify({ dataset: dataset.filename, units, ...result }, null, 2), 'orqivra-history.json', 'application/json')}>Full report ↓</button></div></div>
      <Takeaway items={summaryOf(result, dataset)} />
      <div className="summary-grid">
        <Metric title="Long-run trend" term="trend" value={trendWords(result, 'Crop_Yield', units)} tone={toneOf(result, 'Crop_Yield')} detail={readingOf(result.trends.find(t => t.metric === 'Crop_Yield'))} />
        <Metric title="Typical yield" value={`${fmt(result.variability.mean)} ${dataset.yield_unit}`} detail={`Range ${fmt(result.variability.minimum)}–${fmt(result.variability.maximum)} over ${result.years} years`} />
        <Metric title="Year-to-year swing" term="cv" value={result.variability.cv_percent === null ? '—' : `±${fmt(result.variability.cv_percent, 1)}%`} tone={result.variability.cv_percent >= 15 ? 'watch' : 'good'} detail={result.variability.cv_percent === null ? '' : result.variability.cv_percent < 8 ? 'Steady' : result.variability.cv_percent < 15 ? 'Moderate' : 'Bumpy'} />
        <Metric title="Recent vs earlier yield" value={<Delta value={result.comparisons[0].change_percent} good="up" />} detail={`${result.recent_years[0]} onward vs before`} />
        {result.threshold && <Metric title={`Years below ${fmt(result.threshold.value)} ${dataset.yield_unit}`} value={`${result.threshold.below_years.length} of ${result.years}`} tone={result.threshold.below_years.length ? 'watch' : 'good'} detail={result.threshold.below_years.join(', ') || 'None'} />}
      </div>
      <div className="section spaced"><div className="chart-controls"><label>Show on chart<select value={metric} onChange={e => setMetric(e.target.value)}>{Object.keys(units).map(key => <option key={key} value={key}>{label(key)} ({units[key]})</option>)}</select></label><label className="inline-check"><input type="checkbox" checked={showTrend} onChange={e => setShowTrend(e.target.checked)} />Trend line</label></div>
        <p className="note">Each point is one year. {metric === 'Crop_Yield' && anomalyYears.size ? 'Large amber points are unusual years. ' : ''}Dashed vertical line: start of the “recent” period. Gaps are years with no data.</p>
        <ResponsiveContainer width="100%" height={320}><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} /><YAxis /><Tooltip formatter={(value, name) => [`${fmt(value)} ${units[metric]}`, name]} /><Legend />
          {metric === 'Crop_Yield' && result.threshold && <ReferenceLine y={Number(result.threshold.value)} stroke="#b4462f" strokeDasharray="5 4" label={{ value: 'Your threshold', position: 'insideTopRight', fontSize: 11 }} />}
          <ReferenceLine x={result.recent_years[0] - .5} stroke="#9a9a8a" strokeDasharray="2 4" label={{ value: 'Recent', position: 'insideTopLeft', fontSize: 11 }} />
          <Line type="linear" dataKey={metric} name={label(metric)} stroke="#28765a" strokeWidth={2} dot={props => <AnomalyDot {...props} highlight={metric === 'Crop_Yield' && anomalyYears.has(props.payload.Year)} />} isAnimationActive={false} />
          {result.rolling_window > 0 && <Line type="monotone" dataKey={`${metric}_rolling`} name={`${result.rolling_window}-year average`} stroke="#c8962e" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />}
          {showTrend && trend?.slope_per_year !== null && <Line type="linear" dataKey="trend_line" name="Trend" stroke="#6b7c8f" strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
        </ComposedChart></ResponsiveContainer>{trend?.slope_per_year === null && showTrend && <p className="note">No trend line: {trend.status.toLowerCase()}.</p>}</div>

      <h3 className="spaced">Unusual years</h3>
      {result.anomalies.years.length ? <div className="table-scroll"><table><thead><tr><th>Year</th><th>Yield ({dataset.yield_unit})</th><th>How unusual</th><th>Rainfall that year</th><th>Temperature that year</th></tr></thead><tbody>{result.anomalies.years.map(row => <tr key={row.year}><th>{row.year} <span className={`status ${row.direction === 'Low' ? 'alert' : 'ok'}`}>{row.direction === 'Low' ? 'Low' : 'High'}</span></th><td>{fmt(row.yield)}</td><td>{fmt(Math.abs(row.z_score), 1)} <Term id="sd">SD</Term> {row.direction === 'Low' ? 'below' : 'above'} normal</td><td>{signed(row.rainfall_vs_mean, 0)} mm vs average</td><td>{signed(row.temperature_vs_mean, 1)} °C vs average</td></tr>)}</tbody></table></div> : <p className="muted">No year stood out by ±{result.anomalies.threshold_z} <Term id="sd">standard deviations</Term>. Try a lower setting under More options.</p>}

      <h3 className="spaced">Does yield move with the weather?</h3>
      <div className="summary-grid">{result.associations.map(row => <Metric key={row.metric} title={`${label(row.metric)} and yield`} term="pearson" value={strengthOf(row.pearson_r)} detail={row.pearson_r === null ? row.status : `r = ${fmt(row.pearson_r, 2)} across ${row.years} years`} />)}</div>
      <p className="note">A link means they tended to move together in these years. It does not prove the weather caused the change.</p>

      <h3 className="spaced">Earlier vs recent years</h3>
      <div className="table-scroll"><table><thead><tr><th>Measure</th><th>Earlier ({result.earlier_years[0]}–{result.earlier_years[result.earlier_years.length - 1]})</th><th>Recent ({result.recent_years[0]}–{result.recent_years[result.recent_years.length - 1]})</th><th>Change</th></tr></thead><tbody>{result.comparisons.map(row => <tr key={row.metric}><th>{label(row.metric)} ({units[row.metric]})</th><td>{fmt(row.earlier)}</td><td>{fmt(row.recent)}</td><td>{row.change_percent === null ? <Delta value={row.difference} good="neutral" unit={units[row.metric]} digits={2} /> : <Delta value={row.change_percent} good={row.metric === 'Crop_Yield' ? 'up' : 'neutral'} />}</td></tr>)}</tbody></table></div>

      <h3 className="spaced">Long-run trends</h3>
      <div className="table-scroll"><table><thead><tr><th>Measure</th><th>Change per decade</th><th>Reading</th><th><Term id="r2">Fit (R²)</Term></th><th><Term id="pvalue">p-value</Term></th></tr></thead><tbody>{result.trends.map(row => <tr key={row.metric}><th>{label(row.metric)} ({units[row.metric]})</th><td>{signed(row.slope_per_decade)}</td><td><span className={`reading ${row.p_value !== null && row.p_value < .05 ? 'good' : ''}`}>{readingOf(row)}</span></td><td>{fmt(row.r_squared, 2)}</td><td>{row.p_value === null ? '—' : row.p_value < .001 ? '< 0.001' : fmt(row.p_value, 3)}</td></tr>)}</tbody></table></div>
      <p className="note">A trend describes the past, not the future.</p>

      <details className="section spaced"><summary>Yearly values and number of records</summary><div className="table-scroll spaced"><table><thead><tr><th>Year</th><th>Records</th>{Object.keys(units).map(key => <th key={key}>{label(key)} ({units[key]})</th>)}</tr></thead><tbody>{result.annual.map(row => <tr key={row.Year} className={anomalyYears.has(row.Year) ? 'highlight-row' : ''}><th>{row.Year}</th><td>{row.observations}</td>{Object.keys(units).map(key => <td key={key}>{fmt(row[key])}</td>)}</tr>)}</tbody></table></div></details>
      <Warnings items={[...(result.threshold ? [result.threshold.note] : []), result.anomalies.note, ...result.warnings]} />
    </>}
  </section>;
}

function readingOf(row) {
  if (!row || row.slope_per_year === null) return 'Not enough data';
  if (row.p_value !== null && row.p_value < .05) return row.slope_per_year > 0 ? 'Clear rise' : 'Clear fall';
  return 'No clear direction';
}

function trendWords(result, key, units) {
  const row = result.trends.find(item => item.metric === key);
  return !row || row.slope_per_decade === null ? '—' : `${signed(row.slope_per_decade)} ${units[key]}/decade`;
}

function toneOf(result, key) {
  const row = result.trends.find(item => item.metric === key);
  if (!row || row.p_value === null || row.p_value >= .05) return undefined;
  return row.slope_per_year > 0 ? 'good' : 'bad';
}

function summaryOf(result, dataset) {
  const crop = result.filters.crop;
  const y = result.trends.find(t => t.metric === 'Crop_Yield');
  const lines = [];
  if (y && y.slope_per_decade !== null) {
    const pctPerDecade = result.variability.mean > 0 ? y.slope_per_decade / result.variability.mean * 100 : null;
    lines.push(y.p_value !== null && y.p_value < .05
      ? `${crop} yield has ${y.slope_per_year > 0 ? 'risen' : 'fallen'} by about ${fmt(Math.abs(y.slope_per_decade), 2)} ${dataset.yield_unit} per decade${Number.isFinite(pctPerDecade) ? ` (${fmt(Math.abs(pctPerDecade), 0)}% of a typical yield)` : ''}, a clear long-run ${y.slope_per_year > 0 ? 'rise' : 'fall'}.`
      : `${crop} yield shows no clear long-run direction; year-to-year ups and downs outweigh any trend.`);
  }
  const cv = result.variability.cv_percent;
  if (cv !== null) lines.push(`A typical year lands within about ±${fmt(cv, 0)}% of normal: ${cv < 8 ? 'a steady record' : cv < 15 ? 'moderate swings' : 'a bumpy record'}.`);
  const low = result.anomalies.years.filter(a => a.direction === 'Low').map(a => a.year);
  const high = result.anomalies.years.filter(a => a.direction === 'High').map(a => a.year);
  if (low.length || high.length) lines.push(`Unusual years: ${[low.length ? `low in ${low.join(', ')}` : null, high.length ? `high in ${high.join(', ')}` : null].filter(Boolean).join('; ')}.`);
  const links = result.associations.filter(a => a.pearson_r !== null && Math.abs(a.pearson_r) >= .3);
  lines.push(links.length ? `Yield tended to move with ${links.map(a => `${label(a.metric).toLowerCase()} (${a.pearson_r > 0 ? 'together' : 'opposite'})`).join(' and ')}.` : 'Yield showed little link with rainfall or temperature in these years.');
  return lines;
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
