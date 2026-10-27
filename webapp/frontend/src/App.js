import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import './brand.css';
import FileUpload from './components/FileUpload';
import ModelComparison from './components/ModelComparison';
import ImpactOverview from './components/ImpactOverview';
import ScenarioLab from './components/ScenarioLab';
import DataExplorer from './components/DataExplorer';
import MarketIntelligence from './components/MarketIntelligence';
import Methodology from './components/Methodology';
import Operations from './components/Operations';
import RegionalIntelligence from './components/RegionalIntelligence';
import { Notice } from './components/shared';
import { request, exportFile, getToken, clearToken } from './api';

const audiences = [['field', 'Farmers & extension'], ['research', 'Researchers & policy'], ['business', 'Business & supply']];
const tabs = [['impact', 'Impact overview'], ['scenarios', 'Scenario lab'], ['regional', 'Regional intelligence'], ['operations', 'Operations'], ['models', 'Model validation'], ['markets', 'Supply intelligence'], ['data', 'Data explorer'], ['method', 'Methods & sources']];
function App() {
  const [dataset, setDataset] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingOperations, setPendingOperations] = useState(0);
  const scenarioBusy = pendingOperations > 0;
  const setScenarioBusy = useCallback(value => setPendingOperations(count => Math.max(0, count + (value ? 1 : -1))), []);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('impact');
  const [audience, setAudience] = useState('field');
  const [showImport, setShowImport] = useState(true);
  const [exporting, setExporting] = useState(false);
  const busy = loading || uploading || restoring || scenarioBusy;
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const expire = () => setExpired(true);
    window.addEventListener('orqivra-workspace-expired', expire);
    return () => window.removeEventListener('orqivra-workspace-expired', expire);
  }, []);
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        if (getToken()) {
          const data = await request('workspace');
          if (active) { setDataset(data.dataset); setResults(data.results); setShowImport(!data.results); }
        }
      } catch (err) {
        if (err.status === 404) clearToken();
        else if (active) setError(err.message);
      } finally { if (active) setRestoring(false); }
    };
    restore(); return () => { active = false; };
  }, []);
  const handleFileUpload = data => { setExpired(false); setDataset(data); setResults(null); setError(''); setView('impact'); };
  const handleAnalyze = async () => {
    setLoading(true); setError('');
    try { const result = await request('analyze', { method: 'POST' }); setResults(result); setDataset(result.dataset); setShowImport(false); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const save = async kind => {
    setExporting(true); setError('');
    try { await exportFile(kind); } catch (err) { setError(err.message); }
    finally { setExporting(false); }
  };
  return <div className="App">
    <header className="topbar"><a className="brand" href="#main" aria-label="ORQIVRA home"><img className="brand-emblem" src={`${process.env.PUBLIC_URL}/brand/orqivra-mark.svg`} alt="" /><span className="brand-lockup"><span className="wordmark">ORQIVRA</span><span className="brand-tagline">INTELLIGENCE ROOTED IN NATURE</span></span></a><span className="topbar-label">AGRICULTURAL INTELLIGENCE</span><span className="badge brand-badge"><span aria-hidden="true" />Evidence before action</span></header>
    <main id="main" className="container">
      {!results && <section className="hero orqivra-hero"><div className="hero-story"><p className="eyebrow"><span className="gold-line" /> NATURE INFORMS. INTELLIGENCE EMPOWERS.</p><h1>Intelligence<br /><em>rooted in nature.</em></h1><p className="hero-copy">A deeper understanding of our fields. A more resilient future for our food. Turn agricultural observations into evidence for better decisions.</p><div className="hero-signature"><span>FIELD INSIGHT</span><i /><span>CLIMATE RESILIENCE</span><i /><span>MEANINGFUL IMPACT</span></div></div><div className="nature-panel" style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/brand/orqivra-botanical.svg)` }}><div className="nature-panel-top"><span>ORQIVRA / NATURE × TECHNOLOGY</span><span className="nature-sun" aria-hidden="true" /></div><img className="hero-emblem" src={`${process.env.PUBLIC_URL}/brand/orqivra-mark.svg`} alt="ORQIVRA leaf-shaped Q" /><div className="nature-panel-bottom"><p>Rooted in evidence.<br />Growing with purpose.</p><span>01 — AGRICULTURAL RESILIENCE</span></div></div></section>}
      <div className={`audience-bar ${results ? 'spaced' : ''}`}><span className="eyebrow">YOUR PERSPECTIVE</span><div className="audience-options">{audiences.map(([key, name]) => <button disabled={busy} key={key} aria-pressed={audience === key} className={audience === key ? 'active' : ''} onClick={() => { setAudience(key); setView(key === 'business' && results ? 'markets' : 'impact'); }}>{name}</button>)}</div></div>
      {restoring && <p role="status" className="loading">Reconnecting to your workspace… This may take up to 15 seconds.</p>}
      {expired && <div role="alert" className="notice">Your temporary workspace expired after a server restart or inactivity. <button disabled={busy} onClick={() => { clearToken(); setDataset(null); setResults(null); setShowImport(true); setExpired(false); setError(''); }}>Start a new workspace</button></div>}
      {results && <div className="workspace-heading"><div><p className="eyebrow">CONNECTED TO YOUR EVIDENCE</p><h1>{audience === 'research' ? 'Research & validation' : audience === 'business' ? 'Supply & resilience' : 'Field decision workspace'}</h1><p>{dataset.filename} · {dataset.valid_rows} observations · {dataset.year_min}–{dataset.year_max}</p></div><div className="button-group"><button className="secondary" disabled={busy} onClick={() => setShowImport(!showImport)}>{showImport ? 'Hide import' : 'Change dataset'}</button><button disabled={exporting || busy} onClick={() => save('report')}>{exporting ? 'Exporting…' : 'Export evidence report ↓'}</button></div></div>}
      {(showImport || !results) && <section className="section import-section"><FileUpload onFileUpload={handleFileUpload} disabled={busy} onBusy={setUploading} />{dataset && <div className="dataset-bar"><div><strong>{dataset.filename}</strong><p>{dataset.valid_rows} usable rows · {dataset.columns} columns · {dataset.removed_rows} exclusions</p></div><button onClick={handleAnalyze} disabled={busy}>{loading ? 'Validating models…' : 'Build evidence workspace ↗'}</button></div>}</section>}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <div className="loading" role="status"><span className="spinner" /> Comparing models across validation folds, calibrating uncertainty and auditing local signals…</div>}
      {dataset?.source_type === 'synthetic' && <Notice type="demo"><strong>Synthetic demonstration data.</strong> Locations are illustrative. Reported performance and review signals do not establish real-world agricultural accuracy.</Notice>}
      {dataset && dataset.source_type !== 'synthetic' && <Notice>Source: {dataset.source_name} · {dataset.source_type === 'observed' ? 'Observed, as declared by uploader' : 'Unverified provenance'}. Yield: {dataset.yield_unit} · Price: {dataset.price_unit}. Source and units have not been independently verified.</Notice>}
      {results ? <div key={dataset.quality.fingerprint}>
        <nav className="view-nav" aria-label="Workspace views">{tabs.map(([key, name]) => <button key={key} disabled={loading || uploading || restoring} aria-pressed={view === key} className={view === key ? 'selected' : ''} onClick={() => setView(key)}>{name}</button>)}</nav>
        {view === 'impact' && <ImpactOverview insights={results.insights} dataset={dataset} audience={audience} />}
        <div hidden={view !== 'scenarios'}><ScenarioLab options={results.scenario_options} dataset={dataset} onBusy={setScenarioBusy} /></div>
        <div hidden={view !== 'operations'}><Operations dataset={dataset} onBusy={setScenarioBusy} /></div>
        <div hidden={view !== 'regional'}><RegionalIntelligence dataset={dataset} onBusy={setScenarioBusy} /></div>
        {view === 'models' && <><ModelComparison models={results.models} dataset={dataset} />{results.models.available && <button className="secondary" disabled={exporting} onClick={() => save('predictions')}>Download held-out predictions CSV ↓</button>}</>}
        {view === 'markets' && <MarketIntelligence insights={results.insights} dataset={dataset} />}
        {view === 'data' && <DataExplorer dataset={dataset} analysis={results.analysis} />}
        {view === 'method' && <Methodology insights={results.insights} />}
      </div> : <section className="empty-state"><span className="empty-icon" aria-hidden="true">↗</span><h2>One evidence base. Three perspectives.</h2><p>Upload observations or explore the synthetic demo.<br />Identify historical changes, test models and investigate climate scenarios.</p><div className="feature-tags"><span>Temporal validation</span><span>Prediction intervals</span><span>Local review signals</span><span>Source audit</span></div></section>}
      <footer><span>ORQIVRA / Intelligence rooted in nature</span><span>Exploratory decision support · No guaranteed accuracy · Export to retain your work</span></footer>
    </main>
  </div>;
}
export default App;
