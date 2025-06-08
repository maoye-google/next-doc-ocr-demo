import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function LLMProcessor({ 
  selectedFile, 
  loading, 
  setLoading, 
  setError,
  currentJobId,
  setCurrentJobId,
  globalLoading,
  setGlobalLoading
}) {
  // LLM processing states
  const [llmModel, setLlmModel] = useState('gemini-2.5-flash');
  // Remove local currentJobId state - use the shared one from App component
  const [jobStatus, setJobStatus] = useState(null);
  const [llmResults, setLlmResults] = useState(null);
  const [documentHistory, setDocumentHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(null);
  const [lastHistoryUpdate, setLastHistoryUpdate] = useState(null);

  // Use refs to store the latest values for the interval callback
  const currentJobIdRef = useRef(currentJobId);
  const setGlobalLoadingRef = useRef(setGlobalLoading);
  const setLoadingRef = useRef(setLoading);
  const loadingRef = useRef(loading);
  const pollingIntervalRef = useRef(pollingInterval);

  // Update refs when values change
  useEffect(() => {
    currentJobIdRef.current = currentJobId;
  }, [currentJobId]);

  useEffect(() => {
    setGlobalLoadingRef.current = setGlobalLoading;
  }, [setGlobalLoading]);

  useEffect(() => {
    setLoadingRef.current = setLoading;
  }, [setLoading]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    pollingIntervalRef.current = pollingInterval;
  }, [pollingInterval]);

  // Reset states when file changes
  useEffect(() => {
    if (selectedFile) {
      // Only reset job states, not currentJobId (let App.jsx handle that)
      setJobStatus(null);
      setLlmResults(null);
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
    }
  }, [selectedFile, pollingInterval]);

  // Load document history on component mount and start periodic refresh
  useEffect(() => {
    loadDocumentHistory();
    
    // Set up periodic refresh of document history every 10 seconds
    const historyInterval = setInterval(loadDocumentHistory, 10000);
    
    // Cleanup interval on unmount
    return () => {
      clearInterval(historyInterval);
    };
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleLlmUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first.');
      return;
    }

    setLoading(true);
    setGlobalLoading(true); // Set global loading state
    setError(''); // Clear any previous errors from App component too
    setLlmResults(null);
    setJobStatus(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('llm_model', llmModel);

    try {
      const response = await axios.post('api/llm/process/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000,
      });

      if (response.data.success && response.data.job_id) {
        setCurrentJobId(response.data.job_id);
        // Immediately update the ref to ensure loadDocumentHistory can access it
        currentJobIdRef.current = response.data.job_id;
        startPolling(response.data.job_id);
      } else {
        setError(response.data.message || 'LLM processing failed to start.');
        setLoading(false);
      }
    } catch (err) {
      console.error('LLM Upload Error:', err);
      let errorMsg = 'LLM processing failed to start.';
      if (err.response) {
        errorMsg = err.response.data.detail || err.response.data.message || `Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMsg = 'No response from server. Check network or backend status.';
      }
      setError(errorMsg);
      setLoading(false);
    }
  };

  const startPolling = (jobId) => {
    
    // Check status immediately first
    const checkStatus = async () => {
      try {
        const response = await axios.get(`api/documents/${jobId}/status`);
        setJobStatus(response.data);
        
        if (response.data.status === 'completed') {
          setLlmResults(response.data.results);
          
          // Clear both loading states
          setGlobalLoading(false);
          setLoading(false);
          
          // Call the callback to update App component
          if (onJobStatusUpdate) {
            onJobStatusUpdate(jobId, 'completed', response.data.results);
          }
          
          if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
          }
          // Immediately refresh history when job completes
          setTimeout(() => loadDocumentHistory(), 500);
          return true; // Stop polling
        } else if (response.data.status === 'error') {
          
          // Clear both loading states
          setGlobalLoading(false);
          setLoading(false);
          
          // Call the callback to update App component
          if (onJobStatusUpdate) {
            onJobStatusUpdate(jobId, 'error', null);
          }
          
          if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
          }
          // Also refresh history on error to show updated status
          setTimeout(() => loadDocumentHistory(), 500);
          return true; // Stop polling
        } else {
          return false; // Continue polling
        }
      } catch (err) {
        console.error('Polling error:', err);
        // Continue polling on error, but add some basic error handling
        if (err.response && err.response.status === 404) {
          console.error(`Job ${jobId} not found. Stopping polling.`);
          setError('Job not found in system.');
          setGlobalLoading(false);
          setLoading(false);
          if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
          }
          return true; // Stop polling
        }
        return false; // Continue polling on other errors
      }
    };
    
    // Check immediately on start
    checkStatus().then(shouldStop => {
      if (shouldStop) {
        return;
      }
      
      // Start periodic polling
      const interval = setInterval(async () => {
        const shouldStop = await checkStatus();
        if (shouldStop) {
          clearInterval(interval);
          setPollingInterval(null);
        }
      }, 3000); // Poll every 3 seconds for faster response
      
      setPollingInterval(interval);
    });
  };

  const loadDocumentHistory = async () => {
    try {
      const response = await axios.get('api/documents/history');
      setDocumentHistory(response.data.documents || []);
      setLastHistoryUpdate(new Date());
      
      // Check if current job is in the history and call callback
      const currentJobId = currentJobIdRef.current;
      const setGlobalLoading = setGlobalLoadingRef.current;
      const setLoading = setLoadingRef.current;
      const pollingInterval = pollingIntervalRef.current;

      if (currentJobId && setGlobalLoading) {
        const currentJob = response.data.documents.find(doc => doc.job_id === currentJobId);
        if (currentJob) {
          
          if (currentJob.status === 'completed') {
            
            // Get full job results
            try {
              const jobResponse = await axios.get(`api/documents/${currentJobId}/status`);
              setJobStatus(jobResponse.data);
              setLlmResults(jobResponse.data.results);
              
              // Clear both loading states
              setGlobalLoading(false);
              if (setLoading) setLoading(false);
              
              // Clear polling if it's still running
              if (pollingInterval) {
                clearInterval(pollingInterval);
                setPollingInterval(null);
              }
            } catch (err) {
              console.error('Error fetching job results:', err);
              // Clear loading anyway
              setGlobalLoading(false);
              if (setLoading) setLoading(false);
            }
          } else if (currentJob.status === 'error') {
            
            // Clear both loading states
            setGlobalLoading(false);
            if (setLoading) setLoading(false);
            setError('LLM processing failed.');
            
            // Clear polling if it's still running
            if (pollingInterval) {
              clearInterval(pollingInterval);
              setPollingInterval(null);
            }
          }
        }
      }
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
      setError('Failed to delete documents.');
    }
  };

  const downloadMarkdown = () => {
    if (!llmResults || !llmResults.markdown_content) {
      setError('No markdown content to download.');
      return;
    }
    
    const blob = new Blob([llmResults.markdown_content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedFile.name}_analysis.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  return (
    <div>
      {/* LLM Processing Section */}
      {selectedFile && (
        <div className="llm-processing-section" style={{
          margin: '20px 0',
          padding: '20px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #dee2e6'
        }}>
          <h3 style={{ marginBottom: '15px', color: '#495057' }}>LLM Document Analysis</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="llm-model" style={{ 
              display: 'block', 
              marginBottom: '5px', 
              fontWeight: '500',
              color: '#495057'
            }}>
              Select LLM Model:
            </label>
            <select 
              id="llm-model"
              value={llmModel} 
              onChange={(e) => setLlmModel(e.target.value)}
              disabled={loading}
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid #ced4da',
                fontSize: '14px',
                minWidth: '200px',
                backgroundColor: loading ? '#e9ecef' : 'white'
              }}
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            </select>
          </div>

          <button 
            onClick={handleLlmUpload}
            disabled={globalLoading || !selectedFile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              fontSize: '16px',
              fontWeight: '500',
              border: 'none',
              borderRadius: '6px',
              cursor: (globalLoading || !selectedFile) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              backgroundColor: globalLoading ? '#6c757d' : '#17a2b8',
              color: 'white',
              opacity: (globalLoading || !selectedFile) ? 0.6 : 1
            }}
          >
            <span style={{ fontSize: '18px' }}>🤖</span>
            {globalLoading && currentJobId ? 'Processing with LLM...' : 'Upload for Process (LLM)'}
          </button>


          {/* Job Status Display */}
          {currentJobId && (
            <div style={{ marginTop: '15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <p style={{ margin: '0', fontSize: '14px', color: '#495057' }}>
                  <strong>Job ID:</strong> {currentJobId}
                </p>
              </div>
              {jobStatus && (
                <div style={{ 
                  padding: '10px', 
                  backgroundColor: '#e7f3ff', 
                  borderRadius: '4px',
                  border: '1px solid #b8daff'
                }}>
                  <p style={{ margin: '5px 0', fontSize: '14px' }}>
                    <strong>Status:</strong> <span style={{ 
                      color: jobStatus.status === 'completed' ? '#28a745' : 
                            jobStatus.status === 'error' ? '#dc3545' : '#007bff'
                    }}>
                      {jobStatus.status}
                    </span>
                  </p>
                  {jobStatus.progress && (
                    <>
                      {jobStatus.progress.total_pages && (
                        <p style={{ margin: '5px 0', fontSize: '14px' }}>
                          <strong>Total Pages:</strong> {jobStatus.progress.total_pages}
                        </p>
                      )}
                      {jobStatus.progress.processed_pages !== undefined && (
                        <p style={{ margin: '5px 0', fontSize: '14px' }}>
                          <strong>Processed Pages:</strong> {jobStatus.progress.processed_pages}
                        </p>
                      )}
                      {jobStatus.progress.percentage !== undefined && (
                        <p style={{ margin: '5px 0', fontSize: '14px' }}>
                          <strong>Progress:</strong> {jobStatus.progress.percentage.toFixed(1)}%
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* LLM Results Display */}
          {llmResults && (
            <div style={{ marginTop: '15px' }}>
              <h4 style={{ color: '#28a745', marginBottom: '10px' }}>LLM Analysis Complete!</h4>
              
              {llmResults.markdown_content && (
                <div style={{ marginBottom: '15px' }}>
                  <button 
                    onClick={downloadMarkdown}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      fontSize: '14px',
                      fontWeight: '500',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      backgroundColor: '#28a745',
                      color: 'white'
                    }}
                  >
                    <span style={{ fontSize: '16px' }}>📄</span>
                    Download Markdown Analysis
                  </button>
                </div>
              )}

              {llmResults.summary && (
                <div style={{ 
                  padding: '15px', 
                  backgroundColor: '#f8f9fa', 
                  borderRadius: '6px',
                  border: '1px solid #dee2e6',
                  marginTop: '10px'
                }}>
                  <h5 style={{ marginBottom: '10px', color: '#495057' }}>Document Summary:</h5>
                  <p style={{ fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
                    {llmResults.summary}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Document History Section */}
      <div style={{ margin: '20px 0' }}>
        <button 
          onClick={() => {
            setShowHistory(!showHistory);
            if (!showHistory) {
              loadDocumentHistory();
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: '500',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backgroundColor: '#6c757d',
            color: 'white',
            marginBottom: showHistory ? '15px' : '0'
          }}
        >
          <span style={{ fontSize: '16px' }}>📋</span>
          {showHistory ? 'Hide Document History' : 'Show Document History'}
        </button>

        {showHistory && (
          <div style={{
            padding: '15px',
            backgroundColor: '#f8f9fa',
            borderRadius: '6px',
            border: '1px solid #dee2e6'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div>
                <h4 style={{ margin: 0, color: '#495057' }}>Document Processing History</h4>
                {lastHistoryUpdate && (
                  <p style={{ 
                    margin: '2px 0 0 0', 
                    fontSize: '11px', 
                    color: '#6c757d',
                    fontStyle: 'italic'
                  }}>
                    Last updated: {lastHistoryUpdate.toLocaleTimeString()}
                  </p>
                )}
              </div>
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
              <p style={{ color: '#6c757d', fontStyle: 'italic' }}>No documents processed yet.</p>
            ) : (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {documentHistory.map((doc, index) => (
                  <div key={index} style={{
                    padding: '10px',
                    marginBottom: '10px',
                    backgroundColor: 'white',
                    borderRadius: '4px',
                    border: '1px solid #dee2e6'
                  }}>
                    <p style={{ margin: '5px 0', fontSize: '14px' }}>
                      <strong>File:</strong> {doc.filename}
                    </p>
                    <p style={{ margin: '5px 0', fontSize: '14px' }}>
                      <strong>Status:</strong> <span style={{ 
                        color: doc.status === 'completed' ? '#28a745' : 
                              doc.status === 'error' ? '#dc3545' : '#007bff'
                      }}>
                        {doc.status}
                      </span>
                    </p>
                    <p style={{ margin: '5px 0', fontSize: '12px', color: '#6c757d' }}>
                      {new Date(doc.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default LLMProcessor;