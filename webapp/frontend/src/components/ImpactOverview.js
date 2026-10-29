import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fmt, pct, label, Metric, Notice } from './shared';

const median = values => {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const where = row => `${row.Crop} / ${row.District || 'All locations'}${row.Season ? ` / ${row.Season}` : ''}`;

const COPY = {
  field: { eyebrow: 'FIELD INTELLIGENCE', title: 'Direct attention where it matters.', text: 'Your field brief: which crop and location groups crossed review thresholds this year, what changed, and what to check on the ground first.', action: 'What to check in the field' },
  research: { eyebrow: 'EVIDENCE & COVERAGE', title: 'See where the evidence is strong.', text: 'Your research brief: how well the models validate, which predictors matter, where data coverage is thin and which caveats apply before interpreting any pattern.', action: 'Evidence notes' },
  business: { eyebrow: 'SUPPLY-CHAIN CONTEXT', title: 'Plan with historical context.', text: 'Your supply brief: crop-level yield and price movements versus recent history, volatility and the locations where supply conversations should start. Observed signals, not forecasts.', action: 'Supply note' }
};

export default function ImpactOverview({ insights, dataset, audience, models, onNavigate = () => {} }) {
  const [crop, setCrop] = useState('');
  const [district, setDistrict] = useState('');
  const [flagged, setFlagged] = useState(false);
  const copy = COPY[audience];
  const sorters = {
    field: (a, b) => b.flags.length - a.flags.length || a.Crop.localeCompare(b.Crop),
    research: (a, b) => a.reference_years.length - b.reference_years.length || a.rows - b.rows,
    business: (a, b) => (a.yield_change_percent ?? Infinity) - (b.yield_change_percent ?? Infinity)
  };
  const signals = insights.signals.filter(row => (!crop || row.Crop === crop) && (!district || row.District === district) && (!flagged || row.flags.length)).sort(sorters[audience]);
  const selectedCrop = crop || dataset.crops[0];
  const trend = insights.annual.filter(row => row.Crop === selectedCrop);
  return <section className={`perspective-${audience}`}>
    <div className="section-heading"><div><p className="eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p className="muted">{copy.text}</p></div><span className="badge">Latest observation: {insights.latest_year}</span></div>
    {audience === 'field' && <FieldBrief insights={insights} onNavigate={onNavigate} />}
    {audience === 'research' && <ResearchBrief insights={insights} dataset={dataset} models={models} onNavigate={onNavigate} />}
    {audience === 'business' && <BusinessBrief insights={insights} dataset={dataset} onNavigate={onNavigate} />}
    <h3 className="spaced">{audience === 'field' ? 'Local review signals' : audience === 'research' ? 'Signals by evidence depth (thinnest first)' : 'Location supply signals (largest yield decline first)'}</h3>
    <div className="filter-bar"><label>Crop<select value={crop} onChange={e => setCrop(e.target.value)}><option value="">All crops</option>{dataset.crops.map(x => <option key={x}>{x}</option>)}</select></label>{dataset.districts.length > 0 && <label>District<select value={district} onChange={e => setDistrict(e.target.value)}><option value="">All districts</option>{dataset.districts.map(x => <option key={x}>{x}</option>)}</select></label>}<label className="checkbox-label"><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} /> Only groups needing review</label></div>
    <div className="signal-grid">{signals.map((row, i) => <SignalCard key={i} row={row} audience={audience} actionLabel={copy.action} dataset={dataset} />)}</div>
    {!signals.length && <Notice>No groups match these filters.</Notice>}
    <details className="method-details"><summary>How these review signals are calculated</summary><p>{insights.signal_method}</p><p>{insights.scope_note}</p></details>
    <div className="viz-grid"><div className="viz-card"><h3>{selectedCrop} · annual mean yield ({dataset.yield_unit})</h3><p className="note">Across all represented locations; changes in sample composition can change the mean.</p><ResponsiveContainer width="100%" height={270}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" /><YAxis domain={['auto', 'auto']} /><Tooltip /><Line type="linear" dataKey="yield_mean" name="Mean yield" stroke="#28765a" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
      {audience === 'business'
        ? <div className="viz-card"><h3>{selectedCrop} · nominal price ({dataset.price_unit})</h3><p className="note">Annual mean of reported prices; not inflation-adjusted and not a price forecast.</p><ResponsiveContainer width="100%" height={270}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" /><YAxis domain={['auto', 'auto']} /><Tooltip /><Line type="linear" dataKey="price_mean" name="Mean price" stroke="#bc8b42" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
        : <div className="viz-card"><h3>{selectedCrop} · climate observations</h3><ResponsiveContainer width="100%" height={300}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" /><YAxis yAxisId="rain" /><YAxis yAxisId="temp" orientation="right" /><Tooltip /><Legend /><Line yAxisId="rain" dataKey="rainfall_mean" name="Rainfall (mm)" stroke="#59859a" dot={false} /><Line yAxisId="temp" dataKey="temperature_mean" name="Temperature (°C)" stroke="#bc8b42" dot={false} /></LineChart></ResponsiveContainer></div>}
    </div>
    {audience === 'research' && <div className="section coverage-section"><h3>Coverage by crop and location</h3><div className="table-scroll"><table><thead><tr><th>Crop / location</th><th>Records</th><th>Distinct years</th><th>Span</th></tr></thead><tbody>{insights.coverage.filter(row => (!crop || row.Crop === crop) && (!district || row.District === district)).map((row, i) => <tr key={i}><th>{row.Crop} / {row.District || 'Unspecified'} {row.Season || ''}</th><td>{row.rows}</td><td>{row.years}</td><td>{row.first_year}–{row.last_year}</td></tr>)}</tbody></table></div></div>}
  </section>;
}

function Jump({ items, onNavigate }) {
  return <div className="jump-links">{items.map(([text, view, sub]) => <button key={text} className="secondary" onClick={() => onNavigate(view, sub)}>{text} →</button>)}</div>;
}

function FieldBrief({ insights, onNavigate }) {
  const count = flag => insights.signals.filter(row => row.flags.includes(flag)).length;
  const priorities = insights.signals.filter(row => row.flags.length).sort((a, b) => b.flags.length - a.flags.length).slice(0, 3);
  return <div className="brief">
    <div className="summary-grid"><Metric title="Groups needing review" value={insights.review_count} detail={`of ${insights.signals.length} crop/location groups`} /><Metric title="Lower rainfall" value={count('Lower rainfall')} detail="Groups flagged" /><Metric title="Warmer conditions" value={count('Warmer conditions')} detail="Groups flagged" /><Metric title="Yield decline" value={count('Yield decline')} detail="Groups flagged" /></div>
    <div className="section brief-panel"><h3>Where to look first</h3>{priorities.length ? <ol className="priority-list">{priorities.map((row, i) => <li key={i}><strong>{where(row)}</strong><span className="feature-tags">{row.flags.map(flag => <span key={flag}>{flag}</span>)}</span><p className="note">{row.actions[0]}</p></li>)}</ol> : <p className="muted">No group crossed the review thresholds in {insights.latest_year}. Keep monitoring; this does not establish low future risk.</p>}
      <Jump onNavigate={onNavigate} items={[['Check live weather for a location', 'regional'], ['Turn a signal into a field action', 'operations', 'review'], ['Test a drier or hotter season', 'scenarios']]} /></div>
  </div>;
}

function ResearchBrief({ insights, dataset, models, onNavigate }) {
  const best = models?.available ? models.models?.[models.selected_model] : null;
  const baseline = models?.available ? models.models?.crop_baseline : null;
  const span = dataset.year_max - dataset.year_min + 1;
  const complete = insights.coverage.filter(row => row.years >= span).length;
  const thin = insights.coverage.filter(row => row.years < 5).length;
  const predictors = (models?.permutation_importance || []).slice(0, 4);
  const caveats = [...(dataset.quality.warnings || []), ...(models?.warnings || [])];
  const temporal = models?.evaluation?.temporal ?? (models?.evaluation?.folds?.length > 0);
  return <div className="brief">
    <div className="summary-grid">
      <Metric title="Selected model" value={models?.available ? models.selected_name : 'Unavailable'} detail={best ? `Test MAE ${fmt(best.mae, 3)} ${dataset.yield_unit} · R² ${fmt(best.r2_score, 2)}` : 'Not enough data to validate models'} />
      <Metric title="Improvement over baseline" value={models?.available ? pct(models.baseline_improvement_percent) : '—'} detail={baseline ? `Crop-mean baseline MAE ${fmt(baseline.mae, 3)}` : ''} />
      <Metric title="Interval coverage (test)" value={models?.uncertainty?.test_coverage == null ? '—' : `${fmt(models.uncertainty.test_coverage * 100, 0)}%`} detail={models?.uncertainty ? `Nominal ${fmt(models.uncertainty.nominal_coverage * 100, 0)}%` : ''} />
      <Metric title="Full-period coverage" value={`${complete} / ${insights.coverage.length}`} detail={`Groups observed in all ${span} years · ${thin} with < 5 years`} />
    </div>
    <div className="viz-grid"><div className="section brief-panel"><h3>Most influential predictors</h3>{predictors.length ? <ul className="bar-list">{predictors.map(row => <li key={row.feature}><span>{label(row.feature)}</span><i style={{ width: `${Math.max(4, Math.min(100, row.importance / predictors[0].importance * 100))}%` }} /><small>{fmt(row.importance, 3)} ± {fmt(row.std, 3)}</small></li>)}</ul> : <p className="muted">Permutation importance is unavailable for this dataset.</p>}<p className="note">Permutation importance on held-out data: the drop in accuracy when a predictor is shuffled. Association within the model, not causation.</p></div>
      <div className="section brief-panel"><h3>Validation design & caveats</h3><ul className="caveat-list"><li>{temporal ? 'Chronological validation: models are scored on later years than they were trained on.' : 'Random split: years were not held out chronologically, so temporal generalization is untested.'}</li>{models?.evaluation?.cv_folds && <li>{models.evaluation.cv_folds} development folds; {models.evaluation.calibration_rows} calibration rows for intervals.</li>}{caveats.map(text => <li key={text}>{text}</li>)}{dataset.source_type === 'synthetic' && <li>Data are synthetic; metrics demonstrate the workflow, not real-world accuracy.</li>}</ul></div></div>
    <Jump onNavigate={onNavigate} items={[['Inspect model validation', 'models'], ['Test trends & unusual years', 'history'], ['Compare crop stability', 'portfolio'], ['Read methods & sources', 'method']]} />
  </div>;
}

function BusinessBrief({ insights, dataset, onNavigate }) {
  const rows = dataset.crops.map(crop => {
    const group = insights.signals.filter(row => row.Crop === crop);
    const annual = insights.annual.filter(row => row.Crop === crop);
    const latest = annual[annual.length - 1];
    return { crop, groups: group.length, yield: latest?.yield_mean, price: latest?.price_mean,
      yieldChange: median(group.map(row => row.yield_change_percent)), priceChange: median(group.map(row => row.price_change_percent)),
      declining: group.filter(row => row.yield_change_percent !== null && row.yield_change_percent <= -15).length,
      volatility: median(group.map(row => row.yield_variability_percent)) };
  });
  const weakest = [...rows].filter(row => row.yieldChange !== null).sort((a, b) => a.yieldChange - b.yieldChange)[0];
  const volatile = [...rows].filter(row => row.volatility !== null).sort((a, b) => b.volatility - a.volatility)[0];
  return <div className="brief">
    <div className="summary-grid"><Metric title="Crops tracked" value={rows.length} detail={`${insights.signals.length} location groups`} /><Metric title="Weakest yield movement" value={weakest ? weakest.crop : '—'} detail={weakest ? `Median ${pct(weakest.yieldChange)} vs recent years` : ''} /><Metric title="Most volatile yields" value={volatile ? volatile.crop : '—'} detail={volatile ? `Median CV ${fmt(volatile.volatility, 1)}%` : ''} /><Metric title="Locations with ≥15% yield drop" value={rows.reduce((sum, row) => sum + row.declining, 0)} detail="Start supplier conversations here" /></div>
    <div className="section brief-panel"><h3>Crop supply snapshot · {insights.latest_year}</h3><div className="table-scroll"><table><thead><tr><th>Crop</th><th>Latest mean yield ({dataset.yield_unit})</th><th>Yield vs recent years</th><th>Latest mean price ({dataset.price_unit})</th><th>Price vs recent years</th><th>Yield volatility</th><th>Locations down ≥15%</th></tr></thead><tbody>{rows.map(row => <tr key={row.crop}><th>{row.crop}</th><td>{fmt(row.yield, 3)}</td><td className={row.yieldChange < 0 ? 'negative' : ''}>{pct(row.yieldChange)}</td><td>{fmt(row.price, 0)}</td><td>{pct(row.priceChange)}</td><td>{row.volatility === null ? '—' : `${fmt(row.volatility, 1)}%`}</td><td>{row.declining} / {row.groups}</td></tr>)}</tbody></table></div><p className="note">Changes are medians across locations of the latest year versus up to five earlier annual means. Yield per hectare is not total supply; confirm area and stocks before committing volumes. Prices are nominal.</p>
      <Jump onNavigate={onNavigate} items={[['Open supply intelligence', 'markets'], ['Test margins & break-even', 'operations', 'profit'], ['Check diversification across crops', 'portfolio']]} /></div>
  </div>;
}

function SignalCard({ row, audience, actionLabel, dataset }) {
  const values = audience === 'business'
    ? [['Yield change', pct(row.yield_change_percent)], ['Price change', pct(row.price_change_percent)], ['Yield volatility', row.yield_variability_percent === null ? '—' : `${fmt(row.yield_variability_percent, 1)}%`]]
    : audience === 'research'
      ? [['Reference years', row.reference_years.length], ['Latest-year records', row.rows], ['Yield change', pct(row.yield_change_percent)]]
      : [['Rainfall change', pct(row.rainfall_change_percent)], ['Temperature change', row.temperature_change_c === null ? '—' : `${fmt(row.temperature_change_c)} °C`], ['Yield change', pct(row.yield_change_percent)]];
  const notes = audience === 'field' ? row.actions : audience === 'research' ? researchNotes(row) : supplyNotes(row, dataset);
  return <article className="signal-card"><div className="section-heading"><h3>{row.Crop} <span className="muted">/ {row.District || 'All locations'}{row.Season ? ` / ${row.Season}` : ''}</span></h3><span className={`badge ${row.flags.length ? 'amber' : ''}`}>{row.status}</span></div>
    <div className="signal-values">{values.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
    <p className="note">Reference years: {row.reference_years.join(', ') || 'None'} · Latest-year records: {row.rows}</p>
    {row.flags.length > 0 && <div className="feature-tags">{row.flags.map(x => <span key={x}>{x}</span>)}</div>}
    <p className="action-label">{actionLabel}</p><ul className="action-list">{notes.map(text => <li key={text}>{text}</li>)}</ul></article>;
}

function researchNotes(row) {
  const notes = [];
  if (row.reference_years.length < 3) notes.push('Below the three-year minimum: no comparison is reported for this group.');
  else notes.push(`Comparison uses the median of ${row.reference_years.length} earlier annual means (${row.reference_years[0]}–${row.reference_years[row.reference_years.length - 1]}).`);
  if (row.rows < 3) notes.push(`Only ${row.rows} latest-year record${row.rows === 1 ? '' : 's'}: one unusual field can move this signal.`);
  if (row.flags.length) notes.push('Treat flags as hypotheses; check management, reporting and sampling changes before attributing them to climate.');
  if (row.yield_variability_percent !== null) notes.push(`Historical yield CV ${fmt(row.yield_variability_percent, 1)}%: compare the change against this normal year-to-year spread.`);
  return notes;
}

function supplyNotes(row, dataset) {
  const notes = [];
  const y = row.yield_change_percent, p = row.price_change_percent;
  if (y === null) return ['Insufficient history for a supply comparison; collect at least three earlier years.'];
  if (y <= -15) notes.push(`Yield ${pct(y)} versus recent years: confirm expected volumes and quality with suppliers in ${row.District || 'this area'} early.`);
  else if (y >= 10) notes.push(`Yield ${pct(y)} versus recent years: possible surplus; check storage and buyer capacity.`);
  else notes.push(`Yield ${pct(y)} versus recent years: no strong supply signal from yield alone.`);
  if (p !== null && Math.abs(p) >= 10) notes.push(`Nominal price ${pct(p)} versus recent years (${dataset.price_unit}); not inflation-adjusted.`);
  if (row.yield_variability_percent !== null && row.yield_variability_percent >= 15) notes.push(`High historical volatility (CV ${fmt(row.yield_variability_percent, 1)}%): avoid single-source dependence here.`);
  return notes;
}
