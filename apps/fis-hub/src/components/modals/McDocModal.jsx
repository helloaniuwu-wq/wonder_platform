import React from 'react';
import { HelpCircle } from 'lucide-react';

const McDocModal = ({ showMcDoc, setShowMcDoc }) => {
  if (!showMcDoc) return null;
  return (
    <div className="modal-overlay" onClick={() => setShowMcDoc(false)}>
      <div className="modal-content glass-card" style={{ maxWidth: '860px', width: '92%', maxHeight: '85dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <HelpCircle style={{ color: 'var(--accent-color)' }} size={22} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Monte Carlo Simulation Guide</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowMcDoc(false)}
            className="action-btn-secondary"
            style={{ padding: '5px 12px' }}
          >
            Close
          </button>
        </div>

        <div style={{ overflowY: 'auto', paddingRight: '8px', fontSize: '0.92rem', lineHeight: '1.65', color: 'var(--text-secondary)' }}>
          <div style={{ background: 'var(--surface-subtle)', borderLeft: '3px solid var(--accent-color)', padding: '14px 16px', borderRadius: 'var(--card-radius)', marginBottom: '20px', color: 'var(--text-primary)' }}>
            <p style={{ margin: 0, fontWeight: 500 }}>This guide explains how the Monte Carlo engine works, what each parameter means, and how to interpret the projection results.</p>
          </div>

          <h3>1. Function Overview</h3>
          <p>Monte Carlo simulation is a statistical tool used to assess future portfolio performance through 10,000 random market scenarios. It is based on historical returns and volatility, providing a range of probable outcomes for your investment horizon.</p>

          <h3>2. Core Algorithm: Geometric Brownian Motion (GBM)</h3>
          <p>The system uses <b>Geometric Brownian Motion (GBM)</b>, the industry standard for modeling asset price paths. Unlike a simple average growth calculation, GBM accounts for <b>stochastic volatility</b> and logarithmic returns, ensuring that the simulated paths mirror real-world price behavior.</p>
          <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--border-subtle)', padding: '14px', borderRadius: 'var(--card-radius)', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '15px' }}>
            S(t) = S(0) * exp[(μ - 0.5 * σ²)t + σ * W(t)]
          </div>
          <p><b>Multi-Asset Alignment:</b> When multiple assets are optimized (Max Sharpe, etc.), the engine uses <b>Cholesky Decomposition</b> to correlate the random movements, ensuring that assets like VOO and QQQ which historically move together continue to do so in the simulation.</p>

          <h3>3. Parameter Guide</h3>
          <div className="table-container" style={{ marginBottom: '20px' }}>
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><b>Annual Add</b></td><td>Fixed nominal amount added every year. Overrides initial capital scale.</td></tr>
                <tr><td><b>Annual Draw</b></td><td style={{ color: 'var(--danger)' }}>Amount withdrawn annually. <b>Adjusted for inflation</b> every year automatically.</td></tr>
                <tr><td><b>Inflation %</b></td><td>Simulated annual price increase. Adjusts withdrawal targets and purchasing power.</td></tr>
                <tr><td><b>Stress Mode</b></td><td>Crisis scenario where all asset correlations spike to 0.8, testing diversification failure.</td></tr>
              </tbody>
            </table>
          </div>

          <h3>4. Interpreting Results</h3>
          <ul style={{ paddingLeft: '20px' }}>
            <li><b>P90 (Optimistic):</b> The top 10% of scenarios (Bull market).</li>
            <li><b>P50 (Neutral):</b> The median outcome. Most representable baseline for planning.</li>
            <li><b>P10 (Pessimistic):</b> The bottom 10% of outcomes (Bear market/Crisis).</li>
            <li><b>Real Purchasing Power (Dashed):</b> Nominal P50 adjusted by your inflation setting. Represents what the money is worth in "today's dollars."</li>
          </ul>

          <h3>5. Success Probability</h3>
          <p>The percentage shown in top-right identifies how many paths ended <b>above your target goal</b>.
            <span style={{ color: 'var(--success)', fontWeight: 600 }}> &gt;80% is considered safe</span>,
            <span style={{ color: 'var(--warning)', fontWeight: 600 }}> 50-80% has moderate risk</span>,
            <span style={{ color: 'var(--danger)', fontWeight: 600 }}> &lt;50% suggests your goals may be unrealistic</span>.
          </p>
        </div>

        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          Source: Wonder Financial Intelligence Engine v2.4 (Monte Carlo GBM)
        </div>
      </div>
    </div>
  );
};

export default McDocModal;
