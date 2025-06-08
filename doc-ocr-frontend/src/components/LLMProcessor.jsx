import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// Markdown Dialog Component
function MarkdownDialog({ markdownContent, onClose }) {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dialogRef = useRef(null);

  const handleMouseDown = (e) => {
    if (e.target.closest('.markdown-dialog-content') || e.target.closest('.close-button')) {
      return;
    }
    
    setIsDragging(true);
    const rect = dialogRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    setPosition({
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  // Simple markdown to HTML conversion
  const convertMarkdownToHTML = (markdown) => {
    if (!markdown) return '';
    
    let html = markdown
      // Headers
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      // Blockquotes
      .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
      // Lists (simple unordered and ordered)
      .replace(/^\* (.*$)/gm, '<ul><li>$1</li></ul>') // Unordered
      .replace(/^\- (.*$)/gm, '<ul><li>$1</li></ul>') // Unordered (alternative)
      .replace(/^\d+\. (.*$)/gm, '<ol><li>$1</li></ol>') // Ordered
      // Code blocks (simple inline and fenced)
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold and italic
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      // Wrap in paragraphs
      .replace(/^(.+)/, '<p>$1')
      .replace(/(.+)$/, '$1</p>');

    // Consolidate adjacent list items
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/<\/ol>\s*<ol>/g, '');

    return html;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div 
        ref={dialogRef}
        style={{
          position: 'relative',
          left: position.x,
          top: position.y,
          width: '80%',
          maxWidth: '800px',
          maxHeight: '80%',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          cursor: isDragging ? 'grabbing' : 'grab',
          display: 'flex',
          flexDirection: 'column'
        }}
        onMouseDown={handleMouseDown}
      >
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #dee2e6',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px 8px 0 0'
        }}>
          <h3 style={{ margin: 0, color: '#495057' }}>Document Analysis Result</h3>
          <button 
            className="close-button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6c757d',
              padding: '0',
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
        <div 
          className="markdown-dialog-content"
          style={{
            padding: '20px',
            overflowY: 'auto',
            flex: 1,
            cursor: 'auto'
          }}
        >
          <div 
            dangerouslySetInnerHTML={{ 
              __html: convertMarkdownToHTML(markdownContent) 
            }}
            style={{
              lineHeight: '1.6',
              color: '#333',
              fontSize: '14px',
              textAlign: 'left',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function LLMProcessor({ 
  selectedFile, 
  globalLoading,
  setGlobalLoading,
  currentJobId,
  setCurrentJobId,
  setJobType,
  setJobStatus,
  setLlmResults,
  setError,
  setJobProgress
}) {
  // LLM processing states
  const [llmModel, setLlmModel] = useState('gemini-2.5-flash');
  const [localJobStatus, setLocalJobStatus] = useState(null);
  const [localLlmResults, setLocalLlmResults] = useState(null); // This can still be used for local display within LLMProcessor if needed
  // const [showMarkdownDialog, setShowMarkdownDialog] = useState(false); // App.jsx will control dialog via llmResults prop

  // Use refs to store the latest values for the interval callback
  const currentJobIdRef = useRef(currentJobId);

  // Refs for props from App.jsx to ensure the latest functions are called from closures
  const setGlobalLoadingRef = useRef(setGlobalLoading);
  const setCurrentJobIdRef = useRef(setCurrentJobId);
  const setJobTypeRef = useRef(setJobType);
  const setJobStatusRef = useRef(setJobStatus);
  const setLlmResultsRef = useRef(setLlmResults);
  const setErrorRef = useRef(setError);
  const setJobProgressRef = useRef(setJobProgress);

  const pollingIntervalIdRef = useRef(null); // Stores the actual interval ID

  // Update refs when values change
  useEffect(() => {
    currentJobIdRef.current = currentJobId;
  }, [currentJobId]);

  // Update refs for callback props. These setters from App's useState are stable.
  useEffect(() => {
    setGlobalLoadingRef.current = setGlobalLoading;
    setCurrentJobIdRef.current = setCurrentJobId;
    setJobTypeRef.current = setJobType;
    setJobStatusRef.current = setJobStatus;
    setLlmResultsRef.current = setLlmResults;
    setErrorRef.current = setError;
    setJobProgressRef.current = setJobProgress;
  }, [setGlobalLoading, setCurrentJobId, setJobType, setJobStatus, setLlmResults, setError, setJobProgress]);

  // Reset states when file changes
  useEffect(() => {
    if (selectedFile) {
      setLocalJobStatus(null);
      // setLocalLlmResults(null); // App.jsx will manage llmResults prop
      // If a file changes, any ongoing polling for a previous file should stop.
      // This is handled by the cleanup effect below.
    }
  }, [selectedFile]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalIdRef.current) {
        clearInterval(pollingIntervalIdRef.current);
        pollingIntervalIdRef.current = null;
      }
    };
  }, []); // Empty dependency array means this runs only on mount and unmount.

  const handleLlmUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first.');
      return;
    }

    setGlobalLoadingRef.current(true);
    setJobTypeRef.current('llm');
    setJobStatusRef.current('processing');
    setErrorRef.current('');
    setLocalLlmResults(null);
    setLocalJobStatus(null);

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
        setCurrentJobIdRef.current(response.data.job_id);
        currentJobIdRef.current = response.data.job_id;
        startPolling(response.data.job_id);
      } else {
        setErrorRef.current(response.data.message || 'LLM processing failed to start.');
        setGlobalLoadingRef.current(false);
        setJobStatusRef.current('error');
      }
    } catch (err) {
      console.error('LLM Upload Error:', err);
      let errorMsg = 'LLM processing failed to start.';
      if (err.response) {
        errorMsg = err.response.data.detail || err.response.data.message || `Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMsg = 'No response from server. Check network or backend status.';
      }
      setErrorRef.current(errorMsg);
      setGlobalLoadingRef.current(false);
      setJobStatusRef.current('error');
    }
  };

  const startPolling = (jobId) => {
    // Clear any existing interval before starting a new one for this job instance
    console.log(`[LLM Polling ${jobId}] startPolling called. Clearing existing interval if any: ${pollingIntervalIdRef.current}`);
    const checkStatus = async () => {
      try {
        console.log(`[LLM Polling ${jobId}] checkStatus: Fetching status for ${jobId}`);
        const response = await axios.get(`api/documents/${jobId}/status`);
        setLocalJobStatus(response.data);
        
        if (response.data.progress) {
          setJobProgressRef.current(response.data.progress);
        }
        
        if (response.data.status === 'completed') {
          console.log(`[LLM Polling ${jobId}] === Job is Completed ===`)
          console.log(`currentJobIdRef.current is ${currentJobIdRef.current}`)

          // setLocalLlmResults(response.data.results); // App.jsx will receive this via setLlmResultsRef
          setLlmResultsRef.current(response.data.results);
          setGlobalLoadingRef.current(false);
          setJobStatusRef.current('completed');
          
          if (pollingIntervalIdRef.current) {
            clearInterval(pollingIntervalIdRef.current);
            pollingIntervalIdRef.current = null;
          }
          return true; // Stop polling
        } else if (response.data.status === 'error') {
          console.log(`[LLM Polling ${jobId}] checkStatus: Status is 'error'. Stop polling.`);
          setGlobalLoadingRef.current(false);
          setJobStatusRef.current('error');
          setErrorRef.current('LLM processing failed.');
          
          if (pollingIntervalIdRef.current) {
            clearInterval(pollingIntervalIdRef.current);
            pollingIntervalIdRef.current = null;
          }
          return true; // Stop polling
        } else if (response.data.status === 'processing') {
          console.log(`[LLM Polling ${jobId}] checkStatus: Status is 'processing'. Continue polling.`);
          return false; // Continue polling
        } else {
          console.log(`[LLM Polling ${jobId}] checkStatus: Status is '${response.data.status}'. Assuming non-terminal, continue polling.`);
          return false; // Continue polling
        }
      } catch (err) {
        console.error(`[LLM Polling ${jobId}] Polling error during checkStatus:`, err);
        if (err.response && err.response.status === 404) {
          console.error(`Job ${jobId} not found. Stopping polling.`);
          setErrorRef.current('Job not found in system.');
        }
        // For other polling errors, we might want to stop loading and set error status
        // to prevent UI from being stuck in loading indefinitely.
        setGlobalLoadingRef.current(false);
        setJobStatusRef.current('error');
        if (pollingIntervalIdRef.current) {
          clearInterval(pollingIntervalIdRef.current);
          pollingIntervalIdRef.current = null;
          }
        return true; // Stop polling on any error to prevent infinite loops on persistent issues
      }
    };
    
    // Initial check
    console.log(`[LLM Polling ${jobId}] Performing initial checkStatus call.`);
    checkStatus().then(shouldStopInitial => { // Renamed for clarity
      console.log(`[LLM Polling ${jobId}] Initial checkStatus returned: shouldStopInitial = ${shouldStopInitial}`);
      if (shouldStopInitial) {
        // If job is already completed or errored on the first check, do nothing more.
        // The global loading and status would have been set inside checkStatus.
        console.log(`[LLM Polling ${jobId}] Initial check indicates job is already terminal. Not starting interval.`);
        return;
      }
      
      // If the job is still processing, set up the interval.
      // The previous diff correctly changed this part to use pollingIntervalIdRef.
      console.log(`[LLM Polling ${jobId}] Initial check indicates job is NOT terminal. Setting up setInterval.`);
      pollingIntervalIdRef.current = setInterval(async () => {
        console.log(`[LLM Polling ${jobId}] Interval tick: Calling checkStatus. Current interval ID: ${pollingIntervalIdRef.current}`);
        const shouldStopInterval = await checkStatus();
        if (shouldStopInterval) {
          console.log(`[LLM Polling ${jobId}] Interval tick: checkStatus returned true (job terminal or error). Clearing interval.`);
          if (pollingIntervalIdRef.current) clearInterval(pollingIntervalIdRef.current);
          pollingIntervalIdRef.current = null;
        }
      }, 3000);
      console.log(`[LLM Polling ${jobId}] setInterval has been set. Interval ID: ${pollingIntervalIdRef.current}`);
    });
  };

  const downloadMarkdown = () => {
    if (!localLlmResults || !localLlmResults.markdown_content) {
      setError('No markdown content to download.');
      return;
    }
    
    const blob = new Blob([localLlmResults.markdown_content], { type: 'text/markdown' });
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
    <div style={{
      margin: '20px 0',
      padding: '20px',
      backgroundColor: '#f8f9fa',
      borderRadius: '8px',
      border: '1px solid #dee2e6'
    }}>
      <h3 style={{ marginBottom: '15px', color: '#495057' }}>LLM Processor</h3>
      
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
          disabled={globalLoading}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: '1px solid #ced4da',
            fontSize: '14px',
            minWidth: '200px',
            backgroundColor: globalLoading ? '#e9ecef' : 'white'
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
          padding: '12px 24px',
          fontSize: '16px',
          fontWeight: '500',
          border: 'none',
          borderRadius: '6px',
          cursor: (globalLoading || !selectedFile) ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease',
          backgroundColor: globalLoading ? '#6c757d' : '#17a2b8',
          color: 'white',
          opacity: (globalLoading || !selectedFile) ? 0.6 : 1,
          width: '100%',
          justifyContent: 'center',
          marginBottom: '15px'
        }}
      >
        <span style={{ fontSize: '18px' }}>🤖</span>
        {globalLoading && currentJobId ? 'Processing with LLM...' : 'Upload and Start LLM Process'}
      </button>

      {!selectedFile && (
        <p style={{ 
          fontSize: '14px', 
          color: '#6c757d',
          fontStyle: 'italic',
          textAlign: 'center' 
        }}>
          Please select a file first to start LLM processing.
        </p>
      )}

      {/* Job Status Display */}
      {currentJobId && localJobStatus && (
        <div style={{ marginTop: '15px' }}>
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#e7f3ff', 
            borderRadius: '4px',
            border: '1px solid #b8daff'
          }}>
            <p style={{ margin: '5px 0', fontSize: '14px' }}>
              <strong>Status:</strong> <span style={{ 
                color: localJobStatus.status === 'completed' ? '#28a745' : 
                      localJobStatus.status === 'error' ? '#dc3545' : '#007bff'
              }}>
                {localJobStatus.status}
              </span>
            </p>
            {localJobStatus.progress && (
              <>
                {localJobStatus.progress.total_pages && (
                  <p style={{ margin: '5px 0', fontSize: '14px' }}>
                    <strong>Total Pages:</strong> {localJobStatus.progress.total_pages}
                  </p>
                )}
                {localJobStatus.progress.processed_pages !== undefined && (
                  <p style={{ margin: '5px 0', fontSize: '14px' }}>
                    <strong>Processed Pages:</strong> {localJobStatus.progress.processed_pages}
                  </p>
                )}
                {localJobStatus.progress.percentage !== undefined && (
                  <p style={{ margin: '5px 0', fontSize: '14px' }}>
                    <strong>Progress:</strong> {localJobStatus.progress.percentage.toFixed(1)}%
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* LLM Results Display */}
      {localLlmResults && (
        <div style={{ marginTop: '15px' }}>
          <h4 style={{ color: '#28a745', marginBottom: '10px' }}>LLM Analysis Complete!</h4>
          
          {localLlmResults.markdown_content && (
            <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
              {/* <button 
                onClick={() => setShowMarkdownDialog(true)}
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
                  backgroundColor: '#6f42c1',
                  color: 'white'
                }}
              >
                <span style={{ fontSize: '16px' }}>👁️</span>
                Show Markdown Analysis
              </button>
               */}
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

          {localLlmResults.summary && (
            <div style={{ 
              padding: '15px', 
              backgroundColor: '#f8f9fa', 
              borderRadius: '6px',
              border: '1px solid #dee2e6',
              marginTop: '10px'
            }}>
              <h5 style={{ marginBottom: '10px', color: '#495057' }}>Document Summary:</h5>
              <p style={{ fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
                {localLlmResults.summary}
              </p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// Make MarkdownDialog accessible as a static property of LLMProcessor
LLMProcessor.MarkdownDialog = MarkdownDialog;
export default LLMProcessor;