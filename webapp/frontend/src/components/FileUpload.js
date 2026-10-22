import React, { useRef, useState } from 'react';
import { request, download } from '../api';
function FileUpload({ onFileUpload, disabled, onBusy }) {
  const publicDemo = process.env.REACT_APP_PUBLIC_DEMO === 'true';
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceType, setSourceType] = useState('unverified');
  const [yieldUnit, setYieldUnit] = useState('unspecified');
  const [priceUnit, setPriceUnit] = useState('unspecified');
  const input = useRef(null);
  const upload = async file => {
    if (!file || disabled) return;
    setError('');
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Please choose a CSV file.'); return; }
    if (file.size > 50 * 1024 * 1024) { setError('Choose a CSV smaller than 50 MB.'); return; }
    onBusy(true);
    try {
      const form = new FormData(); form.append('file', file);
      Object.entries({ source_name: sourceName || 'User upload', source_type: sourceType, yield_unit: yieldUnit, price_unit: priceUnit }).forEach(([key, value]) => form.append(key, value));
      onFileUpload(await request('upload', { method: 'POST', body: form }));
    } catch (err) { setError(err.message); }
    finally { onBusy(false); if (input.current) input.current.value = ''; }
  };
  const sample = async load => {
    onBusy(true); setError('');
    try {
      if (load) onFileUpload(await request('demo', { method: 'POST' }));
      else { const data = await request('download-sample'); download(data.csv_sample, 'synthetic-agriculture-demo.csv', 'text/csv'); }
    } catch (err) { setError(err.message); }
    finally { onBusy(false); }
  };
  return <div className="file-upload">
    <div className="section-heading"><div><p className="eyebrow">DATA FOUNDATION</p><h2>Start with evidence.</h2></div><button className="text-button" disabled={disabled} onClick={() => sample(false)}>Download sample CSV ↓</button></div>
    {publicDemo && <p className="notice">Public portfolio demo · Explore synthetic data and live regional weather. Uploads are available when running the source locally. Workspaces are temporary; export anything you want to keep.</p>}
    {!publicDemo && <><div className="form-grid metadata-form">
      <label>Source / collection method<input disabled={disabled} value={sourceName} onChange={e => setSourceName(e.target.value)} maxLength={300} placeholder="e.g. district field survey, 2010–2025" /></label>
      <label>Data provenance<select value={sourceType} disabled={disabled} onChange={e => setSourceType(e.target.value)}><option value="unverified">Not yet verified</option><option value="observed">Observed (user declared)</option><option value="synthetic">Synthetic / simulated</option></select></label>
      <label>Yield unit<select disabled={disabled} value={yieldUnit} onChange={e => setYieldUnit(e.target.value)}><option value="unspecified">Unspecified</option><option value="t/ha">Tonnes / hectare</option><option value="kg/ha">Kilograms / hectare</option></select></label>
      <label>Price unit<select disabled={disabled} value={priceUnit} onChange={e => setPriceUnit(e.target.value)}><option value="unspecified">Unspecified</option>{['INR/t', 'INR/kg', 'USD/t', 'USD/kg'].map(unit => <option key={unit}>{unit}</option>)}</select></label>
    </div>
    <div className={`upload-area ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}>
      <span className="upload-icon" aria-hidden="true">↑</span><div><h3>Drop your agricultural dataset here</h3><p>CSV · Up to 50 MB / 10,000 rows · 10 rows to explore · 30 for models</p></div>
      <label className={`file-button ${disabled ? 'disabled' : ''}`}>Browse files<input ref={input} aria-label="Upload agricultural CSV" type="file" accept=".csv,text/csv" disabled={disabled} onChange={e => upload(e.target.files[0])} /></label>
    </div>
    </>}
    <div className="import-help"><p><button className="text-button" disabled={disabled} onClick={() => sample(true)}>Explore the resilience demo ↗</button><span className="muted"> 192 synthetic observations · 16 years · 4 districts.</span></p><details><summary>Dataset schema & units</summary><p>Required: Year, Crop, Rainfall_mm, Avg_Temperature_C, Crop_Yield, Market_Price. Optional: District, Season, Humidity_Percent, Soil_pH, Irrigation_mm. Match climate measurements to the crop’s growing period; keep measurement methods and units consistent. Repeated records should represent independent observations.</p></details></div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
export default FileUpload;
