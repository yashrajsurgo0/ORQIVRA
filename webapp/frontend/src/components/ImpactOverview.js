import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fmt, pct, label, Metric, Notice, Term, Takeaway, Delta, Warnings, PageIntro } from './shared';

const median = values => {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};
const where = row => `${row.Crop} in ${row.District || 'all locations'}${row.Season ? ` (${row.Season})` : ''}`;
const statusOf = row => row.flags.length ? ['alert', 'Needs a look'] : row.reference_years.length >= 3 ? ['ok', 'Normal range'] : ['unknown', 'Not enough history'];
const listWords = items => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const COPY = {
  field: { eyebrow: 'FARMERS & EXTENSION · FIELD BRIEF', title: 'What needs attention this season?', purpose: 'Each crop in each district is compared with its own recent years. Groups where rain fell, heat rose or yield dropped past your thresholds are listed first, with what to check on the ground.', action: 'What to check in the field' },
  research: { eyebrow: 'RESEARCHERS & POLICY · RESEARCH BRIEF', title: 'How much can this evidence support?', purpose: 'How accurate the yield models are on years they never saw, what drives their predictions, how complete the data is, and which caveats apply before you interpret a pattern.', action: 'Evidence notes' },
  business: { eyebrow: 'BUSINESS & SUPPLY · SUPPLY BRIEF', title: 'Where is supply moving?', purpose: 'Each crop’s latest yield and price compared with recent years, how volatile it has been, and which locations to talk to first. Observed history, not a forecast.', action: 'Supply note' }
};

export default function ImpactOverview({ insights, dataset, audience, models, onNavigate = () => {} }) {
  const [crop, setCrop] = useState('');
  const [district, setDistrict] = useState('');
  const [showNormal, setShowNormal] = useState(audience !== 'field');
  const copy = COPY[audience];
  const sorters = {
    field: (a, b) => b.flags.length - a.flags.length || (a.yield_change_percent ?? 0) - (b.yield_change_percent ?? 0),
    research: (a, b) => a.reference_years.length - b.reference_years.length || a.rows - b.rows,
    business: (a, b) => (a.yield_change_percent ?? Infinity) - (b.yield_change_percent ?? Infinity)
  };
  const filtered = insights.signals.filter(row => (!crop || row.Crop === crop) && (!district || row.District === district)).sort(sorters[audience]);
  const attention = filtered.filter(row => row.flags.length);
  const normal = filtered.filter(row => !row.flags.length);
  const primary = audience === 'field' ? attention : filtered;
  // Notes that apply to every visible card are shown once, so each card only carries what is specific to it.
  const notesFor = row => audience === 'field' ? row.actions : audience === 'research' ? researchNotes(row) : supplyNotes(row, dataset);
  const noteSets = primary.map(notesFor);
  const shared = noteSets.length > 1 ? noteSets[0].filter(note => noteSets.every(set => set.includes(note))) : [];
  const selectedCrop = crop || dataset.crops[0];
  const trend = insights.annual.filter(row => row.Crop === selectedCrop);
  return <section className={`perspective-${audience}`}>
    <PageIntro eyebrow={copy.eyebrow} title={copy.title} purpose={copy.purpose} />
    {audience === 'field' && <FieldBrief insights={insights} onNavigate={onNavigate} />}
    {audience === 'research' && <ResearchBrief insights={insights} dataset={dataset} models={models} onNavigate={onNavigate} />}
    {audience === 'business' && <BusinessBrief insights={insights} dataset={dataset} onNavigate={onNavigate} />}

    <div className="section-heading spaced"><h3>{audience === 'field' ? <>Crop–location groups that need a look</> : audience === 'research' ? 'All groups, thinnest evidence first' : 'All locations, largest yield drop first'}</h3><span className="badge">Latest year: {insights.latest_year}</span></div>
    <p className="note">Each card compares {insights.latest_year} with the same crop and place in earlier years (<Term id="reference">reference years</Term>). <Term id="signal">How flags work</Term></p>
    <div className="filter-bar"><label>Crop<select value={crop} onChange={e => setCrop(e.target.value)}><option value="">All crops</option>{dataset.crops.map(x => <option key={x}>{x}</option>)}</select></label>{dataset.districts.length > 0 && <label>District<select value={district} onChange={e => setDistrict(e.target.value)}><option value="">All districts</option>{dataset.districts.map(x => <option key={x}>{x}</option>)}</select></label>}<span className="legend-inline"><span className="status alert">Needs a look</span> <span className="status ok">Normal range</span></span></div>
    {shared.length > 0 && <div className="shared-notes"><p className="action-label">Applies to every group below</p><ul className="action-list">{shared.map(note => <li key={note}>{note}</li>)}</ul></div>}
    {primary.length > 0 ? <div className="signal-grid">{primary.map((row, i) => <SignalCard key={i} row={row} audience={audience} actionLabel={copy.action} notes={noteSets[i].filter(note => !shared.includes(note))} />)}</div> : audience === 'field' && <Notice>No group crossed the review thresholds{crop || district ? ' for these filters' : ''}. Keep monitoring; this does not mean low future risk.</Notice>}
    {audience === 'field' && normal.length > 0 && <>
      <button className="secondary show-more" aria-expanded={showNormal} onClick={() => setShowNormal(!showNormal)}>{showNormal ? 'Hide' : 'Show'} {normal.length} group{normal.length === 1 ? '' : 's'} in the normal range</button>
      {showNormal && <div className="compact-cards">{normal.map((row, i) => <div className="compact-card" key={i}><div><strong>{row.Crop}</strong> · {row.District || 'All locations'}<small>Yield vs recent years</small></div><Delta value={row.yield_change_percent} good="up" /></div>)}</div>}
    </>}
    {!filtered.length && <Notice>No groups match these filters.</Notice>}
    <details className="method-details"><summary>How these comparisons are calculated</summary><p>{insights.signal_method}</p><p>{insights.scope_note}</p></details>

    <h3 className="spaced">{selectedCrop}: the longer view</h3>
    <div className="viz-grid"><div className="viz-card"><h3>Average yield per year ({dataset.yield_unit})</h3><p className="note">All locations combined. Choose a crop above to switch.</p><ResponsiveContainer width="100%" height={270}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" /><YAxis domain={['auto', 'auto']} /><Tooltip /><Line type="linear" dataKey="yield_mean" name="Average yield" stroke="#28765a" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
      {audience === 'business'
        ? <div className="viz-card"><h3>Average price per year ({dataset.price_unit})</h3><p className="note">Reported prices, not adjusted for inflation, not a forecast.</p><ResponsiveContainer width="100%" height={270}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" /><YAxis domain={['auto', 'auto']} /><Tooltip /><Line type="linear" dataKey="price_mean" name="Average price" stroke="#bc8b42" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
        : <div className="viz-card"><h3>Rainfall and temperature per year</h3><p className="note">Rainfall on the left axis, temperature on the right.</p><ResponsiveContainer width="100%" height={270}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="Year" /><YAxis yAxisId="rain" /><YAxis yAxisId="temp" orientation="right" /><Tooltip /><Legend /><Line yAxisId="rain" dataKey="rainfall_mean" name="Rainfall (mm)" stroke="#59859a" dot={false} /><Line yAxisId="temp" dataKey="temperature_mean" name="Temperature (°C)" stroke="#bc8b42" dot={false} /></LineChart></ResponsiveContainer></div>}
    </div>
    {audience === 'research' && <details className="section coverage-section"><summary><strong>Data coverage by crop and location</strong> <span className="note">({insights.coverage.length} groups)</span></summary><div className="table-scroll spaced"><table><thead><tr><th>Crop / location</th><th>Records</th><th>Years observed</th><th>Span</th></tr></thead><tbody>{insights.coverage.filter(row => (!crop || row.Crop === crop) && (!district || row.District === district)).map((row, i) => <tr key={i}><th>{row.Crop} / {row.District || 'Unspecified'} {row.Season || ''}</th><td>{row.rows}</td><td>{row.years}</td><td>{row.first_year}–{row.last_year}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

function Steps({ items, onNavigate }) {
  return <ol className="steps">{items.map(([title, text, view, sub]) => <li key={title}><button onClick={() => onNavigate(view, sub)}><strong>{title} →</strong><span>{text}</span></button></li>)}</ol>;
}

function FieldBrief({ insights, onNavigate }) {
  const types = ['Lower rainfall', 'Warmer conditions', 'Yield decline'];
  const count = flag => insights.signals.filter(row => row.flags.includes(flag)).length;
  const priorities = insights.signals.filter(row => row.flags.length).sort((a, b) => b.flags.length - a.flags.length || (a.yield_change_percent ?? 0) - (b.yield_change_percent ?? 0)).slice(0, 3);
  const top = priorities[0];
  const counts = types.map(t => [t, count(t)]).filter(([, n]) => n);
  const most = Math.max(0, ...counts.map(([, n]) => n));
  const leaders = counts.filter(([, n]) => n === most).map(([t]) => t.toLowerCase());
  const changeWords = v => `${v < 0 ? 'down' : 'up'} ${fmt(Math.abs(v), 1)}%`;
  const yieldDown = insights.signals.filter(r => r.flags.includes('Yield decline'));
  const summary = insights.review_count ? [
    `${insights.review_count} of ${insights.signals.length} crop–location groups need a look in ${insights.latest_year}.`,
    leaders.length === 1 ? `The most common issue is ${leaders[0]} (${most} group${most === 1 ? '' : 's'}).` : leaders.length > 1 ? `${listWords(leaders).replace(/^./, c => c.toUpperCase())} are equally common (${most} groups each).` : null,
    top ? `Start with ${where(top)}: ${listWords(top.flags.map(f => f.toLowerCase()))}${Number.isFinite(top.yield_change_percent) ? `, with yield ${changeWords(top.yield_change_percent)} on its recent years` : ''}.` : null,
    yieldDown.length ? null : 'No group shows a yield drop past your threshold yet.'
  ] : [`All ${insights.signals.length} crop–location groups are within their normal range for ${insights.latest_year}. Keep monitoring; normal history does not rule out future problems.`];
  return <div className="brief">
    <Takeaway items={summary} tone={insights.review_count ? 'watch' : 'good'} />
    <div className="summary-grid"><Metric title="Groups needing a look" value={`${insights.review_count} of ${insights.signals.length}`} tone={insights.review_count ? 'watch' : 'good'} detail="Crossed at least one threshold" />{types.map(t => <Metric key={t} title={t} value={count(t)} tone={count(t) ? 'watch' : undefined} detail={count(t) === 1 ? 'group' : 'groups'} />)}</div>
    {priorities.length > 0 && <div className="section brief-panel spaced"><h3>Where to look first</h3><ol className="priority-list">{priorities.map((row, i) => <li key={i}><strong>{where(row)}</strong><span className="feature-tags">{row.flags.map(flag => <span key={flag}>{flag}</span>)}</span><p className="note">{row.actions[0]}</p></li>)}</ol></div>}
    <Steps onNavigate={onNavigate} items={[['Check the weather', 'See current conditions, the 7-day forecast and soil moisture for a location.', 'regional'], ['Plan a field visit', 'Turn a flagged group into an action with an owner and due date.', 'operations', 'review'], ['Test a bad season', 'See how the model expects yield to respond to less rain or more heat.', 'scenarios']]} />
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
  const coverage = models?.uncertainty?.test_coverage;
  const relative = best && insights.annual.length ? best.mae / (insights.annual.reduce((s, r) => s + r.yield_mean, 0) / insights.annual.length) * 100 : null;
  const summary = best ? [
    `On years it never saw, the ${models.selected_name.toLowerCase()} model’s yield predictions were off by about ${fmt(best.mae, 2)} ${dataset.yield_unit} on average${Number.isFinite(relative) ? ` (roughly ${fmt(relative, 0)}% of a typical yield)` : ''}.`,
    Number.isFinite(models.baseline_improvement_percent) ? (models.baseline_improvement_percent > 0 ? `That is ${fmt(models.baseline_improvement_percent, 0)}% less error than simply using each crop’s average.` : 'It does not beat simply using each crop’s average yield, so treat its predictions with caution.') : null,
    Number.isFinite(coverage) ? `Its 90% prediction ranges contained the real yield ${fmt(coverage * 100, 0)}% of the time${coverage >= .85 ? ', close to target' : ', below target: ranges are too narrow'}.` : null,
    predictors.length >= 2 ? `Predictions lean most on ${label(predictors[0].feature).toLowerCase()} and ${label(predictors[1].feature).toLowerCase()}.` : null,
    thin ? `${thin} group${thin === 1 ? ' has' : 's have'} fewer than five years of data; read their results cautiously.` : `Data coverage is complete: every group is observed in all ${span} years.`
  ] : ['Not enough data to validate a yield model. Descriptive comparisons are still available.'];
  return <div className="brief">
    <Takeaway items={summary} tone={best && models.baseline_improvement_percent > 0 ? 'good' : 'watch'} />
    <div className="summary-grid">
      <Metric title="Best model" value={models?.available ? models.selected_name : 'Unavailable'} detail={best ? <>Chosen on earlier years, tested on later ones</> : 'Not enough data to validate models'} />
      <Metric title="Average error" term="mae" value={best ? `${fmt(best.mae, 3)} ${dataset.yield_unit}` : '—'} tone={best ? 'good' : undefined} detail={baseline ? `Baseline: ${fmt(baseline.mae, 3)} ${dataset.yield_unit}` : ''} />
      <Metric title="Beats the baseline by" term="baseline" value={models?.available ? pct(models.baseline_improvement_percent) : '—'} tone={models?.baseline_improvement_percent > 0 ? 'good' : models?.available ? 'bad' : undefined} detail="Less error than crop averages" />
      <Metric title="Prediction ranges held" term="interval" value={Number.isFinite(coverage) ? `${fmt(coverage * 100, 0)}%` : '—'} tone={Number.isFinite(coverage) ? (coverage >= .85 ? 'good' : 'watch') : undefined} detail="Target: 90% of the time" />
      <Metric title="Complete histories" value={`${complete} of ${insights.coverage.length}`} tone={thin ? 'watch' : 'good'} detail={`Groups seen in all ${span} years`} />
    </div>
    <div className="viz-grid spaced"><div className="section brief-panel"><h3>What the model relies on most</h3>{predictors.length ? <ul className="bar-list">{predictors.map(row => <li key={row.feature}><span>{label(row.feature)}</span><i style={{ width: `${Math.max(4, Math.min(100, row.importance / predictors[0].importance * 100))}%` }} /><small>{fmt(row.importance, 2)}</small></li>)}</ul> : <p className="muted">Not available for this dataset.</p>}<p className="note">Longer bar = the model leans on it more. <Term id="importance">What this shows</Term></p></div>
      <div className="section brief-panel"><h3>How it was tested</h3><ul className="caveat-list"><li>{temporal ? 'Fair test: the model was always scored on later years than it learned from, like predicting next season.' : 'Rows were split at random, so how well it predicts future years is untested.'}</li>{models?.evaluation?.cv_folds && <li>{models.evaluation.cv_folds} rounds of practice testing chose the model; a separate final test measured it.</li>}{dataset.source_type === 'synthetic' && <li>The data are synthetic: these numbers show the method works, not real-world accuracy.</li>}</ul><Warnings items={caveats} /></div></div>
    <Steps onNavigate={onNavigate} items={[['Inspect the model test', 'Compare all six models and see where predictions miss.', 'models'], ['Test a pattern', 'Trends, unusual years and climate links for one crop and place.', 'history'], ['Check the data', 'Browse records, exclusions and data quality.', 'data']]} />
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
  const ranked = [...rows].filter(row => row.yieldChange !== null).sort((a, b) => a.yieldChange - b.yieldChange);
  const weakest = ranked[0], strongest = ranked[ranked.length - 1];
  const volatile = [...rows].filter(row => row.volatility !== null).sort((a, b) => b.volatility - a.volatility)[0];
  const drops = rows.reduce((sum, row) => sum + row.declining, 0);
  const prices = rows.filter(r => r.priceChange !== null);
  const summary = [
    weakest ? `${weakest.crop} had the weakest year: yield ${weakest.yieldChange < 0 ? 'down' : 'up'} ${fmt(Math.abs(weakest.yieldChange), 1)}% on recent years at a typical location.${strongest && strongest !== weakest ? ` ${strongest.crop} held up best (${pct(strongest.yieldChange)}).` : ''}` : null,
    drops ? `${drops} location${drops === 1 ? '' : 's'} saw yield fall 15% or more. Start supplier conversations there.` : 'No location saw yield fall 15% or more.',
    volatile ? `${volatile.crop} has the bumpiest yield record (typical swing ±${fmt(volatile.volatility, 0)}%), so avoid relying on one source for it.` : null,
    prices.length ? (prices.every(r => r.priceChange > 0) ? 'Prices are up for every crop compared with recent years (not adjusted for inflation).' : prices.every(r => r.priceChange < 0) ? 'Prices are down for every crop compared with recent years.' : 'Price movements are mixed across crops.') : null
  ];
  return <div className="brief">
    <Takeaway items={summary} tone={drops ? 'watch' : 'good'} />
    <div className="summary-grid"><Metric title="Weakest crop this year" value={weakest ? weakest.crop : '—'} tone={weakest?.yieldChange < 0 ? 'bad' : undefined} detail={weakest ? <>Yield <Delta value={weakest.yieldChange} /> vs recent years</> : ''} /><Metric title="Most volatile crop" term="cv" value={volatile ? volatile.crop : '—'} tone="watch" detail={volatile ? `Typical swing ±${fmt(volatile.volatility, 1)}%` : ''} /><Metric title="Locations with a big drop" value={drops} tone={drops ? 'watch' : 'good'} detail="Yield down 15% or more" /><Metric title="Crops tracked" value={rows.length} detail={`${insights.signals.length} crop–location groups`} /></div>
    <div className="section brief-panel spaced"><h3>Crop supply snapshot, {insights.latest_year}</h3><div className="table-scroll"><table><thead><tr><th>Crop</th><th>Yield ({dataset.yield_unit})</th><th>Yield vs recent years</th><th>Price ({dataset.price_unit})</th><th>Price vs recent years</th><th><Term id="cv">Volatility</Term></th><th>Locations down 15%+</th></tr></thead><tbody>{rows.map(row => <tr key={row.crop}><th>{row.crop}</th><td>{fmt(row.yield, 2)}</td><td><Delta value={row.yieldChange} good="up" /></td><td>{fmt(row.price, 0)}</td><td><Delta value={row.priceChange} good="neutral" /></td><td>{row.volatility === null ? '—' : `±${fmt(row.volatility, 1)}%`}</td><td>{row.declining} of {row.groups}</td></tr>)}</tbody></table></div><p className="note">Changes compare {insights.latest_year} with up to five earlier years, for the typical (median) location. Yield per hectare is not total supply; confirm planted area and stocks before committing volumes.</p></div>
    <Steps onNavigate={onNavigate} items={[['Dig into one crop', 'Yield and price history plus every location for one crop.', 'markets'], ['Check your margins', 'Break-even yield and price for your costs.', 'operations', 'profit'], ['Spread the risk', 'Which crops balance each other’s bad years.', 'portfolio']]} />
  </div>;
}

function SignalCard({ row, audience, actionLabel, notes }) {
  const [tone, text] = statusOf(row);
  const values = audience === 'business'
    ? [['Yield', <Delta value={row.yield_change_percent} good="up" />], ['Price', <Delta value={row.price_change_percent} good="neutral" />], ['Volatility', row.yield_variability_percent === null ? '—' : `±${fmt(row.yield_variability_percent, 1)}%`]]
    : audience === 'research'
      ? [['Years compared', row.reference_years.length], ['Latest records', row.rows], ['Yield', <Delta value={row.yield_change_percent} good="up" />]]
      : [['Rainfall', <Delta value={row.rainfall_change_percent} good="neutral" />], ['Temperature', <Delta value={row.temperature_change_c} good="down" unit="°C" digits={2} />], ['Yield', <Delta value={row.yield_change_percent} good="up" />]];
  const years = row.reference_years;
  return <article className={`signal-card ${tone}`}><div className="section-heading"><h3>{row.Crop} <span className="muted">· {row.District || 'All locations'}{row.Season ? ` · ${row.Season}` : ''}</span></h3><span className={`status ${tone}`}>{text}</span></div>
    <div className="signal-values">{values.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
    <p className="compare-line">{years.length ? `${row.year} compared with ${years[0]}–${years[years.length - 1]} (${years.length} years)` : 'No earlier years to compare with'}</p>
    {row.flags.length > 0 && <div className="feature-tags">{row.flags.map(x => <span key={x}>{x}</span>)}</div>}
    {notes.length > 0 && <><p className="action-label">{actionLabel}</p><ul className="action-list">{notes.map(note => <li key={note}>{note}</li>)}</ul></>}</article>;
}

function researchNotes(row) {
  const notes = [];
  if (row.reference_years.length < 3) notes.push('Fewer than three earlier years: no comparison is reported.');
  else notes.push(`Compared with the middle value of ${row.reference_years.length} earlier yearly averages.`);
  if (row.rows < 3) notes.push(`Only ${row.rows} record${row.rows === 1 ? '' : 's'} in the latest year: one unusual field can move this result.`);
  if (row.yield_variability_percent !== null && Number.isFinite(row.yield_change_percent)) notes.push(Math.abs(row.yield_change_percent) > row.yield_variability_percent * 1.5 ? `This change is larger than the normal year-to-year swing (±${fmt(row.yield_variability_percent, 1)}%).` : `This change is within the normal year-to-year swing (±${fmt(row.yield_variability_percent, 1)}%).`);
  if (row.flags.length) notes.push('Treat flags as questions: check management, reporting and sampling before blaming the weather.');
  return notes;
}

function supplyNotes(row, dataset) {
  const notes = [];
  const y = row.yield_change_percent, p = row.price_change_percent;
  if (y === null) return ['Not enough history for a supply comparison; collect at least three earlier years.'];
  if (y <= -15) notes.push(`Yield down ${pct(y).replace('-', '')}: confirm expected volumes and quality with suppliers in ${row.District || 'this area'} early.`);
  else if (y >= 10) notes.push(`Yield up ${pct(y)}: possible surplus; check storage and buyer capacity.`);
  else notes.push('Yield close to recent years: no strong supply signal.');
  if (p !== null && Math.abs(p) >= 10) notes.push(`Price ${pct(p)} against recent years (${dataset.price_unit}, not adjusted for inflation).`);
  if (row.yield_variability_percent !== null && row.yield_variability_percent >= 15) notes.push(`Bumpy yield record (±${fmt(row.yield_variability_percent, 1)}% a year): avoid relying on a single source here.`);
  return notes;
}
