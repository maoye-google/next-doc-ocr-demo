import React from 'react';

function GlobalStatusBar({ 
  globalLoading, 
  jobType, 
  currentJobId, 
  jobProgress 
}) {
  if (!globalLoading) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: '#007bff',
      color: 'white',
      padding: '10px 20px',
      zIndex: 1000,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '15px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>⏳</span>
        <span style={{ fontWeight: '500' }}>
          Processing {jobType?.toUpperCase()} job: {currentJobId}
        </span>
      </div>
      
      {jobProgress && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
          {jobProgress.percentage !== undefined && (
            <span>Progress: {jobProgress.percentage.toFixed(1)}%</span>
          )}
          {jobProgress.processed_pages !== undefined && jobProgress.total_pages && (
            <span>Pages: {jobProgress.processed_pages}/{jobProgress.total_pages}</span>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default GlobalStatusBar;