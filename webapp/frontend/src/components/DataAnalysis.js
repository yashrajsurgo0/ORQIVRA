import React from 'react';
const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
function DataAnalysis({ analysis }) {
  return <section className="data-analysis"><h2>Get to know your dataset.</h2><p className="muted">{analysis.quality.valid_rows} of {analysis.quality.original_rows} rows retained. {analysis.quality.removed_rows} invalid or duplicate rows excluded. Extreme climate observations are retained.</p><div className="table-scroll"><table><thead><tr>{['Variable', 'Count', 'Mean', 'Median', 'Std. deviation', 'Minimum', 'Maximum'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{Object.entries(analysis.descriptive_stats).map(([feature, stats]) => <tr key={feature}><th>{feature.replaceAll('_', ' ')}</th>{['count', 'mean', '50%', 'std', 'min', 'max'].map(key => <td key={key}>{format(stats[key])}</td>)}</tr>)}</tbody></table></div></section>;
}
export default DataAnalysis;
