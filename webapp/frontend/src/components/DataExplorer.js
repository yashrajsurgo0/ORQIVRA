import React, { useEffect, useState } from 'react';
import { request, exportFile } from '../api';
import { fmt, label, Warnings } from './shared';
export default function DataExplorer({ dataset, analysis }) {
  const [crop, setCrop] = useState('');
  const [district, setDistrict] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setData(null); setError('');
    const params = new URLSearchParams({ crop, district, page, size: 20 });
    request(`data?${params}`).then(result => { if (active) setData(result); }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [crop, district, page]);
  const save = async kind => { try { await exportFile(kind); } catch (err) { setError(err.message); } };
  const quality = dataset.quality;
  return <section><p className="eyebrow">RESEARCH / DATA AUDIT</p><div className="section-heading"><div><h2>Make every observation traceable.</h2><p className="muted">{quality.valid_rows} retained / {quality.original_rows} imported · {quality.removed_rows} excluded · extremes retained unless physically invalid.</p></div><div className="button-group"><button className="secondary" onClick={() => save('cleaned')}>Cleaned CSV ↓</button><button className="secondary" onClick={() => save('rejected')}>Exclusion audit ↓</button></div></div><Warnings items={quality.warnings} />
    {Object.keys(quality.reasons).length > 0 && <div className="section spaced"><h3>Why rows were excluded</h3>{Object.entries(quality.reasons).map(([reason, count]) => <div className="metric" key={reason}><span>{reason}</span><strong>{count}</strong></div>)}<p className="note">A row may have multiple exclusion reasons. Download the audit for original CSV line numbers.</p></div>}
    <div className="filter-bar"><label>Crop<select value={crop} onChange={e => { setCrop(e.target.value); setPage(1); }}><option value="">All crops</option>{dataset.crops.map(x => <option key={x}>{x}</option>)}</select></label>{dataset.districts.length > 0 && <label>District<select value={district} onChange={e => { setDistrict(e.target.value); setPage(1); }}><option value="">All districts</option>{dataset.districts.map(x => <option key={x}>{x}</option>)}</select></label>}<span className="muted">{loading ? 'Loading…' : `${data?.total ?? 0} matching rows`}</span></div>
    {error && <p className="error" role="alert">{error}</p>}
    {data && <><div className="table-scroll" aria-busy={loading}><table><thead><tr>{data.columns.map(col => <th key={col}>{label(col)}</th>)}</tr></thead><tbody>{data.rows.map((row, i) => <tr key={i}>{data.columns.map(col => <td key={col}>{col === 'Year' ? String(row[col]) : typeof row[col] === 'number' ? fmt(row[col], 3) : String(row[col] ?? '')}</td>)}</tr>)}</tbody></table></div><div className="pagination"><button className="secondary" disabled={page === 1 || loading} onClick={() => setPage(page-1)}>← Previous</button><span>Page {page} / {Math.max(1, Math.ceil(data.total/data.size))}</span><button className="secondary" disabled={page*data.size >= data.total || loading} onClick={() => setPage(page+1)}>Next →</button></div></>}
    {analysis && <details className="method-details"><summary>Descriptive statistics</summary><div className="table-scroll"><table><thead><tr><th>Variable</th><th>Count</th><th>Mean</th><th>Median</th><th>Std. dev.</th><th>Minimum</th><th>Maximum</th></tr></thead><tbody>{Object.entries(analysis.descriptive_stats).map(([key, stats]) => <tr key={key}><th>{label(key)}</th>{['count', 'mean', '50%', 'std', 'min', 'max'].map(stat => <td key={stat}>{fmt(stats[stat])}</td>)}</tr>)}</tbody></table></div></details>}
    <details className="method-details"><summary>Provenance and reproducibility</summary><p>Source: {dataset.source_name} · {dataset.source_type}</p><p>Uploaded: {dataset.uploaded_at}</p><p>Yield: {dataset.yield_unit} · Price: {dataset.price_unit}</p><p className="fingerprint">Canonical-data SHA-256: {quality.fingerprint}</p><p>Workspace data lives in server memory for up to two idle hours, subject to an eight-workspace capacity. A server restart clears it. Export your report to retain the analysis.</p></details>
  </section>;
}
