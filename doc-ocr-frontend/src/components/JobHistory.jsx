import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';

const JobHistory = forwardRef(({ 
  currentJobId, 
  jobStatus,
  onJobSelect,
  onJobDelete 
}, ref) => {
  const [documentHistory, setDocumentHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lastHistoryUpdate, setLastHistoryUpdate] = useState(null);
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');

  // Expose refresh function via ref
  useImperativeHandle(ref, () => ({
    refreshHistory: loadDocumentHistory
  }), []);

  // Load document history on component mount and start periodic refresh
  useEffect(() => {
    if (showHistory) {
      loadDocumentHistory();
      
      // Set up periodic refresh of document history every 10 seconds
      const historyInterval = setInterval(loadDocumentHistory, 10000);
      
      // Cleanup interval on unmount
      return () => {
        clearInterval(historyInterval);
      };
    }
  }, [showHistory]);

  const loadDocumentHistory = async () => {
    try {
      const response = await axios.get('api/documents/history');
      setDocumentHistory(response.data.documents || []);
      setLastHistoryUpdate(new Date());
    } catch (err) {
      console.error('Error loading document history:', err);
    }
  };

  const deleteAllDocuments = async () => {
    if (!window.confirm('Are you sure you want to delete all document history?')) {
      return;
    }
    
    try {
      await axios.delete('api/documents/all');
      setDocumentHistory([]);
      setShowHistory(false);
    } catch (err) {
      console.error('Error deleting documents:', err);
    }
  };

  const deleteJob = async (jobId) => {
    if (!window.confirm('Are you sure you want to delete this job?')) {
      return;
    }
    
    try {
      await axios.delete(`api/documents/${jobId}`);
      setDocumentHistory(prev => prev.filter(doc => doc.job_id !== jobId));
      if (onJobDelete) onJobDelete(jobId);
    } catch (err) {
      console.error('Error deleting job:', err);
    }
  };

  const viewJob = async (job) => {
    try {
      const response = await axios.get(`api/documents/${job.job_id}/status`);
      if (onJobSelect) onJobSelect(job, response.data);
    } catch (err) {
      console.error('Error viewing job:', err);
    }
  };

  const downloadJob = async (job) => {
    try {
      const response = await axios.get(`api/documents/${job.job_id}/status`);
      if (response.data.results && response.data.results.markdown_content) {
        const blob = new Blob([response.data.results.markdown_content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${job.filename}_analysis.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Error downloading job:', err);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedDocuments = [...documentHistory].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    
    if (sortField === 'created_at' || sortField === 'completed_at') {
      aVal = new Date(aVal || 0);
      bVal = new Date(bVal || 0);
    }
    
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return '🟢';
      case 'processing': return '🟡';
      case 'error': return '🔴';
      default: return '⚪';
    }
  };

  const getJobTypeInfo = (job) => {
    // Determine job type based on processing_type or presence of llm_model
    if (job.processing_type === 'llm' || job.llm_model) {
      return { type: 'LLM', color: '#7b1fa2' };
    }
    return { type: 'OCR', color: '#1976d2' };
  };

  return (
    <div style={{ margin: '20px 0' }}>
      <div style={{
        padding: '20px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #dee2e6'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, color: '#495057' }}>Job History</h3>
          <button 
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) {
                loadDocumentHistory();
              }
            }}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              backgroundColor: '#6c757d',
              color: 'white'
            }}
          >
            {showHistory ? 'Hide History' : 'Show History'}
          </button>
        </div>

        {showHistory && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              {lastHistoryUpdate && (
                <p style={{ 
                  margin: 0, 
                  fontSize: '12px', 
                  color: '#6c757d',
                  fontStyle: 'italic'
                }}>
                  Last updated: {lastHistoryUpdate.toLocaleTimeString()}
                </p>
              )}
              {documentHistory.length > 0 && (
                <button 
                  onClick={deleteAllDocuments}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    backgroundColor: '#dc3545',
                    color: 'white'
                  }}
                >
                  Delete All
                </button>
              )}
            </div>
            
            {documentHistory.length === 0 ? (
              <p style={{ color: '#6c757d', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                No jobs processed yet.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  backgroundColor: 'white',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                  <thead style={{ backgroundColor: '#e9ecef' }}>
                    <tr>
                      <th style={{ ...tableHeaderStyle, cursor: 'pointer' }} 
                          onClick={() => handleSort('job_id')}>
                        Job ID {sortField === 'job_id' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th style={tableHeaderStyle}>Type</th>
                      <th style={{ ...tableHeaderStyle, cursor: 'pointer' }} 
                          onClick={() => handleSort('filename')}>
                        File Name {sortField === 'filename' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th style={{ ...tableHeaderStyle, cursor: 'pointer' }} 
                          onClick={() => handleSort('status')}>
                        Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th style={tableHeaderStyle}>Model</th>
                      <th style={{ ...tableHeaderStyle, cursor: 'pointer' }} 
                          onClick={() => handleSort('created_at')}>
                        Created {sortField === 'created_at' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th style={tableHeaderStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDocuments.map((job, index) => {
                      const jobTypeInfo = getJobTypeInfo(job);
                      const isCurrentJob = job.job_id === currentJobId;
                      
                      return (
                        <tr key={job.job_id} style={{
                          backgroundColor: isCurrentJob ? '#fff3cd' : (index % 2 === 0 ? '#f8f9fa' : 'white'),
                          borderBottom: '1px solid #dee2e6'
                        }}>
                          <td style={tableCellStyle}>
                            <span style={{ 
                              fontFamily: 'monospace', 
                              fontSize: '12px',
                              fontWeight: isCurrentJob ? 'bold' : 'normal'
                            }}>
                              {job.job_id}
                            </span>
                          </td>
                          <td style={tableCellStyle}>
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '12px',
                              fontSize: '12px',
                              fontWeight: '500',
                              backgroundColor: jobTypeInfo.color + '20',
                              color: jobTypeInfo.color
                            }}>
                              {jobTypeInfo.type}
                            </span>
                          </td>
                          <td style={tableCellStyle}>{job.filename}</td>
                          <td style={tableCellStyle}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {getStatusIcon(job.status)}
                              <span style={{ 
                                color: job.status === 'completed' ? '#28a745' : 
                                       job.status === 'error' ? '#dc3545' : '#007bff',
                                fontWeight: '500'
                              }}>
                                {job.status}
                              </span>
                            </span>
                          </td>
                          <td style={tableCellStyle}>{job.llm_model || 'N/A'}</td>
                          <td style={tableCellStyle}>{formatDate(job.created_at)}</td>
                          <td style={tableCellStyle}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                onClick={() => viewJob(job)}
                                style={actionButtonStyle('#17a2b8')}
                                disabled={jobTypeInfo.type === 'OCR'}
                                title="View Job Details"
                              >
                                👁️
                              </button>
                              {job.status === 'completed' && (
                                <button
                                  onClick={() => downloadJob(job)}
                                  style={actionButtonStyle('#28a745')}
                                  title="Download Results"
                                >
                                  📥
                                </button>
                              )}
                              <button
                                onClick={() => deleteJob(job.job_id)}
                                style={actionButtonStyle('#dc3545')}
                                title="Delete Job"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const tableHeaderStyle = {
  padding: '12px 8px',
  textAlign: 'left',
  fontSize: '14px',
  fontWeight: '600',
  color: '#495057',
  borderBottom: '2px solid #dee2e6'
};

const tableCellStyle = {
  padding: '10px 8px',
  fontSize: '13px',
  color: '#495057',
  verticalAlign: 'middle'
};

const actionButtonStyle = (color) => ({
  padding: '4px 6px',
  fontSize: '12px',
  border: 'none',
  borderRadius: '3px',
  cursor: 'pointer',
  backgroundColor: color,
  color: 'white',
  transition: 'opacity 0.2s ease'
});

export default JobHistory;